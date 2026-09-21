/** DXF boundary/pattern decoding only: no sampled paths, clipping, or hatch-line expansion. */
export function decodeHatch(groups) {
    let p = groups.findIndex(g => g.code === 91);
    if (p < 0) throw new Error('HATCH is missing boundary count.');
    const get = (code, fallback = 0) => groups.find(g => g.code === code)?.value ?? fallback;
    const take = code => { const g = groups[p++]; if (!g || g.code !== code) throw new Error(`HATCH expected group ${code}, received ${g?.code ?? 'EOF'}.`); return Number(g.value); };
    const optional = (code, fallback = 0) => groups[p]?.code === code ? take(code) : fallback;
    const point = (x = 10, y = x + 10) => [take(x), take(y)];
    const count = (code, limit = 1000000) => { const n = take(code); if (!Number.isInteger(n) || n < 0 || n > limit) throw new Error(`Invalid HATCH count ${code}.`); return n; };
    const loops = count(91), edges = [];
    for (let loop = 0; loop < loops; loop++) {
        const flags = take(92);
        if (flags & 2) {
            const bulges = take(72), closed = take(73), n = count(93), vertices = [];
            for (let i = 0; i < n; i++) { const a = point(); vertices.push({ point: a, bulge: bulges ? optional(42) : 0 }); }
            for (let i = 0; i < n - (closed ? 0 : 1); i++) {
                const a = vertices[i], b = vertices[(i + 1) % n];
                edges.push({ kind: 2, loop, flags, a: a.point, b: b.point, bulge: a.bulge });
            }
        } else {
            const n = count(93);
            for (let i = 0; i < n; i++) {
                const kind = take(72);
                if (kind === 1) edges.push({ kind: 1, loop, flags, a: point(), b: point(11) });
                else if (kind === 2 || kind === 3) {
                    const center = point(); let major, ratio;
                    if (kind === 2) { major = [take(40), 0]; ratio = 1; }
                    else { major = point(11); ratio = take(40); }
                    const start = take(50) * Math.PI / 180, end = take(51) * Math.PI / 180, ccw = take(73);
                    let sweep = ((end - start) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
                    if (!ccw) sweep = sweep === 0 ? -2 * Math.PI : sweep - 2 * Math.PI;
                    else if (sweep === 0) sweep = 2 * Math.PI;
                    edges.push({ kind: 3, loop, flags, center, major, ratio, start, sweep });
                } else if (kind === 4) {
                    const degree = take(94), rational = take(73), periodic = take(74), nk = count(95), np = count(96);
                    const knots = Array.from({ length: nk }, () => take(40)), points = [], weights = [];
                    for (let j = 0; j < np; j++) { points.push(point()); weights.push(rational ? optional(42, 1) : 1); }
                    if (groups[p]?.code === 97) { const fit = count(97); for (let j = 0; j < fit; j++) point(11); if (groups[p]?.code === 12) point(12); if (groups[p]?.code === 13) point(13); }
                    if (degree < 1 || degree > 31 || np <= degree || nk !== np + degree + 1 || weights.some(w => !(w > 0)) || knots.some((v, j) => j > 0 && v < knots[j - 1])) throw new Error('Invalid HATCH spline edge.');
                    edges.push({ kind: 4, loop, flags, spline: { degree, knots, points, weights, periodic } });
                } else throw new Error(`Unsupported HATCH boundary edge type ${kind}.`);
            }
        }
        if (groups[p]?.code === 97) { const handles = count(97); for (let i = 0; i < handles; i++) take(330); }
    }
    const families = []; p = groups.findIndex(g => g.code === 78);
    if (p >= 0) {
        const n = count(78, 4096);
        for (let i = 0; i < n; i++) {
            const angle = take(53) * Math.PI / 180, base = point(43, 44), offset = point(45, 46), nd = count(79, 4096);
            const dashes = Array.from({ length: nd }, () => take(49));
            families.push({ angle, base, offset, dashes });
        }
    }
    if (!edges.length) throw new Error('HATCH has no boundary edges.');
    if (!get(70) && !families.length) throw new Error('Pattern HATCH has no pattern line definitions.');
    if (get(450)) throw new Error('Gradient HATCH requires a per-pixel material backend; not treated as a solid fill.');
    return { edges, families: get(70) ? [] : families, style: get(75), solid: !!get(70), name: String(get(2, 'SOLID')) };
}
