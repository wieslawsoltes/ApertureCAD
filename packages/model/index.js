/** Host-shareable CAD ABI. Host work is parsing/serialization, not tessellation. */
export const ENTITY_BYTES = 128;
export const PAGE_ENTITIES = 65536;
export const TYPE = Object.freeze({ LINE: 1, ELLIPSE: 2, POLYLINE: 3, TEXT: 4, TRIANGLE: 5, SPLINE: 6, POINT: 7, FILL: 8, XLINE: 9, RAY: 10, CLOUD: 11, HATCH: 12, DIMENSION: 13 });
const ENTITY_TYPES = new Set(Object.values(TYPE));
export const FLAGS = Object.freeze({ CLOSED: 1, NUMERIC: 256, ANNOTATION: 512 });
export const UINT_MAX = 0xffffffff;
export function split64(x) { if (!Number.isFinite(x) || !Number.isFinite(Math.fround(x)))
    throw new RangeError('Coordinate is not finite in the GPU representation.'); const hi = Math.fround(x); return [hi, Math.fround(x - hi)]; }
export function rgba(hex) { if (typeof hex === 'number')
    return hex >>> 0; let h = String(hex).replace('#', ''); if (h.length === 3)
    h = h.split('').map(c => c + c).join(''); return ((parseInt(h.slice(0, 2), 16) || 0) | ((parseInt(h.slice(2, 4), 16) || 0) << 8) | ((parseInt(h.slice(4, 6), 16) || 0) << 16) | 0xff000000) >>> 0; }
export function colorHex(v) { return '#' + [v & 255, (v >>> 8) & 255, (v >>> 16) & 255].map(x => x.toString(16).padStart(2, '0')).join(''); }
export class WordArena {
    constructor(cap = 4096) { this.buffer = new ArrayBuffer(cap * 4); this.u = new Uint32Array(this.buffer); this.f = new Float32Array(this.buffer); this.length = 0; }
    alloc(n) { const o = this.length; this.length += n; if (this.length > this.u.length) {
        const b = new ArrayBuffer(Math.max(this.length, 2 * this.u.length) * 4);
        new Uint32Array(b).set(this.u);
        this.buffer = b;
        this.u = new Uint32Array(b);
        this.f = new Float32Array(b);
    } return o; }
    finish() { return this.buffer.slice(0, Math.max(this.length, 4) * 4); }
}
export class PageBuilder {
    constructor(font, { origin = [0, 0], idBase = 0, pageSize = PAGE_ENTITIES } = {}) { this.font = font; this.origin = origin; this.idBase = idBase; this.capacity = pageSize; this.buffer = new ArrayBuffer(pageSize * ENTITY_BYTES); this.u = new Uint32Array(this.buffer); this.f = new Float32Array(this.buffer); this.count = 0; this.aux = new WordArena(); this.runs = []; this.runMap = new Map(); this.nodeMap = new Map(); this.missing = new Set(); this.handles = []; }
    node(n, ancestors = null) {
        if (!n)
            return UINT_MAX;
        if (ancestors?.has(n) || (ancestors?.size || 0) >= 192)
            throw new RangeError('Cyclic or excessively deep GPU transform chain.');
        if (this.nodeMap.has(n))
            return this.nodeMap.get(n);
        const next = new Set(ancestors || []);
        next.add(n);
        const parent = this.node(n.parent, next);
        const o = this.aux.alloc(16);
        this.nodeMap.set(n, o);
        const t = n.translation || [0, 0], b = n.base || [0, 0], [tx, tlx] = split64(t[0]), [ty, tly] = split64(t[1]), [bx, blx] = split64(b[0]), [by, bly] = split64(b[1]);
        this.aux.f.set([n.sx ?? 1, n.sy ?? 1, n.angle || 0, 0, tx, ty, tlx, tly, bx, by, blx, bly], o);
        this.aux.u[o + 12] = parent;
        if (n.ocs) {
            this.aux.f.set([...n.ocs, n.elevation || 0], o);
            this.aux.u[o + 13] = 2;
        }
        return o;
    }
    run(text, wrap = 0) {
        const key = wrap + '\0' + text;
        if (this.runMap.has(key))
            return this.runMap.get(key);
        const cps = Array.from(text);
        if (cps.length > 16384)
            throw new RangeError('A GPU glyph run is limited to 16,384 codepoints. Split the text into multiple entities.');
        const o = this.aux.alloc(4 + cps.length * 5);
        this.aux.u[o] = cps.length;
        this.aux.f[o + 3] = wrap;
        cps.forEach((c, i) => { let gid = c === '\n' ? UINT_MAX : this.font.map.get(c.codePointAt(0)); if (gid === undefined) {
            this.missing.add(c);
            gid = 0;
        } this.aux.u[o + 4 + i * 4] = gid; this.aux.u[o + 4 + cps.length * 4 + i] = gid; });
        this.runs.push(o);
        this.runMap.set(key, o);
        return o;
    }
    add(e) {
        const state = [this.count, this.aux.length, this.runs.length, this.handles.length];
        try { return this.appendEntity(e); }
        catch (error) {
            [this.count, this.aux.length, this.runs.length, this.handles.length] = state;
            // Failure-only rollback: no per-entity map cloning on the successful import path.
            for (const [key, offset] of this.runMap) if (offset >= state[1]) this.runMap.delete(key);
            for (const [key, offset] of this.nodeMap) if (offset >= state[1]) this.nodeMap.delete(key);
            throw error;
        }
    }
    appendEntity(e) {
        if (!e || !ENTITY_TYPES.has(e.type))
            throw new TypeError('Unknown CAD entity type.');
        const finite = a => Array.isArray(a) && a.every(x => Number.isFinite(x) && Number.isFinite(Math.fround(x)));
        for (const key of ['anchor', 'p', 'q', 'r'])
            if (e[key] && (!finite(e[key]) || e[key].length !== (key === 'anchor' ? 2 : 4)))
                throw new RangeError('Invalid GPU entity ' + key + '.');
        if (e.points && (!Array.isArray(e.points) || e.points.length > 1000000 || e.points.some(p => !finite(p) || p.length < 2 || p.length > 4)))
            throw new RangeError('Invalid or excessive GPU path points.');
        if (e.type === TYPE.POLYLINE && (!e.points || e.points.length < 2))
            throw new RangeError('A polyline requires at least two points.');
        if (e.type === TYPE.SPLINE) {
            const v = e.spline;
            if (!v || !Number.isInteger(v.degree) || v.degree < 1 || v.degree > 31 || !Array.isArray(v.points) || !Array.isArray(v.knots) || v.points.length <= v.degree || v.knots.length !== v.points.length + v.degree + 1 || !finite(v.knots) || v.points.some(p => !finite(p)) || v.knots.some((x, i) => i > 0 && x < v.knots[i - 1]) || v.points.some(p => p.length !== 2) || (v.weights && (v.weights.length !== v.points.length || v.weights.some(w => !Number.isFinite(w) || w <= 0))))
                throw new RangeError('Invalid rational spline.');
        }
        if (this.count >= this.capacity)
            throw new Error('Page capacity exceeded.');
        const i = this.count++, j = i * 32, id = this.idBase + i + 1, anchor = e.anchor || [0, 0], [xh, xl] = split64(anchor[0]), [yh, yl] = split64(anchor[1]);
        this.f.set([xh, yh, xl, yl], j);
        this.f.set(e.p || [0, 0, 0, 0], j + 4);
        this.f.set(e.q || [0, 0, 0, 0], j + 8);
        this.f.set(e.r || [0, 0, 0, 0], j + 12);
        this.u.set([e.type, e.color ?? 0, e.layer || 0, id], j + 16);
        let offset = 0, count = 0, flags = e.flags || 0;
        if (e.type === TYPE.TEXT) {
            offset = this.run(e.text || '', e.wrap || 0);
            count = e.numeric || 0;
        }
        else if (e.type === TYPE.HATCH) {
            const h = e.hatch;
            if (!h || !Array.isArray(h.edges) || !h.edges.length || h.edges.length > 1000000 || !Array.isArray(h.families) || h.families.length > 4096 || ![0, 1, 2].includes(h.style || 0)) throw new RangeError('Invalid hatch data.');
            const point = p => finite(p) && p.length === 2;
            for (const edge of h.edges) {
                if (!Number.isInteger(edge.loop || 0) || (edge.loop || 0) < 0) throw new RangeError('Invalid hatch loop ID.');
                if ([1, 2].includes(edge.kind) && (!point(edge.a) || !point(edge.b) || !Number.isFinite(edge.bulge || 0))) throw new RangeError('Invalid hatch line/bulge.');
                if (edge.kind === 3 && (!point(edge.center) || !point(edge.major) || !finite([edge.ratio, edge.start, edge.sweep]) || edge.ratio <= 0 || Math.abs(edge.sweep) > Math.PI * 2 + 1e-6)) throw new RangeError('Invalid hatch conic.');
                if (edge.kind === 4) { const v = edge.spline;
                    if (!v || !Number.isInteger(v.degree) || v.degree < 1 || v.degree > 31 || !Array.isArray(v.points) || v.points.length <= v.degree || v.points.some(p => !point(p)) || !finite(v.knots) || v.knots.length !== v.points.length + v.degree + 1 || v.knots.some((x, i) => i > 0 && x < v.knots[i - 1]) || (v.weights && (v.weights.length !== v.points.length || v.weights.some(w => !Number.isFinite(w) || w <= 0)))) throw new RangeError('Invalid hatch spline.'); }
                if (![1, 2, 3, 4].includes(edge.kind)) throw new RangeError('Unknown hatch edge kind.');
            }
            for (const line of h.families) if (!Number.isFinite(line.angle) || !point(line.base) || !point(line.offset) || !finite(line.dashes) || line.dashes.length > 4096) throw new RangeError('Invalid hatch pattern family.');
            offset = this.aux.alloc(8); count = h.edges.length;
            const edgeTable = this.aux.alloc(h.edges.length * 16), families = this.aux.alloc(h.families.length * 8);
            this.aux.u.set([h.edges.length, h.families.length, h.style || 0, h.solid ? 1 : 0, edgeTable, families, 0, 0], offset);
            h.edges.forEach((edge, i) => {
                const o = edgeTable + i * 16;
                this.aux.u.set([edge.kind, edge.loop || 0, edge.flags || 0, 0], o);
                if (edge.kind === 1 || edge.kind === 2) this.aux.f.set([edge.a[0] - anchor[0], edge.a[1] - anchor[1], edge.b[0] - anchor[0], edge.b[1] - anchor[1], edge.bulge || 0], o + 4);
                else if (edge.kind === 3) this.aux.f.set([edge.center[0] - anchor[0], edge.center[1] - anchor[1], ...edge.major, edge.ratio, edge.start, edge.sweep], o + 4);
                else if (edge.kind === 4) {
                    const v = edge.spline, so = this.aux.alloc(4 + v.knots.length + v.points.length * 4);
                    this.aux.u[o + 3] = so; this.aux.u.set([v.degree, v.knots.length, v.points.length, 0], so); this.aux.f.set(v.knots, so + 4);
                    v.points.forEach((pt, j) => this.aux.f.set([pt[0] - anchor[0], pt[1] - anchor[1], v.weights?.[j] ?? 1, 0], so + 4 + v.knots.length + j * 4));
                } else throw new RangeError('Unknown hatch edge kind.');
            });
            h.families.forEach((line, i) => {
                const o = families + i * 8, dash = this.aux.alloc(line.dashes.length);
                this.aux.f.set([line.angle, line.base[0] - anchor[0], line.base[1] - anchor[1], ...line.offset], o);
                this.aux.u.set([line.dashes.length, dash, 0], o + 5); this.aux.f.set(line.dashes, dash);
            });
        }
        else if (e.type === TYPE.DIMENSION) {
            const d = e.dimension;
            if (!d || !Number.isInteger(d.kind) || d.kind < 0 || d.kind > 6 || !Array.isArray(d.points) || d.points.length !== 7 || d.points.some(p => !finite(p) || p.length !== 2)) throw new RangeError('Invalid dimension definition.');
            for (const key of ['angle', 'textHeight', 'arrowSize', 'extensionOffset', 'extensionLength', 'gap', 'measureScale', 'rounding']) if (key in d && (!Number.isFinite(d[key]) || !Number.isFinite(Math.fround(d[key])))) throw new RangeError('Invalid dimension ' + key);
            if ((d.textHeight ?? 2.5) < 0 || (d.arrowSize ?? 2.5) < 0 || (d.rounding ?? 0) < 0 || !Number.isInteger(d.precision ?? 2) || (d.precision ?? 2) < 0 || (d.precision ?? 2) > 8) throw new RangeError('Invalid dimension formatting.');
            offset = this.aux.alloc(32); count = 7;
            this.aux.u.set([d.kind, d.flags || 0, this.run(d.text && d.text !== '<>' ? d.text : ''), Math.max(0, Math.min(8, d.precision ?? 2))], offset);
            d.points.forEach((pt, i) => this.aux.f.set([pt[0] - anchor[0], pt[1] - anchor[1]], offset + 4 + i * 2));
            this.aux.f.set([d.angle || 0, d.textHeight ?? 2.5, d.arrowSize ?? 2.5, d.extensionOffset ?? .625, d.extensionLength ?? 1.25, d.gap ?? .625, d.measureScale ?? 1, d.rounding ?? 0], offset + 18);
            this.aux.u[offset + 26] = d.text && d.text !== '<>' ? 1 : 0;
            this.aux.u[offset + 27] = this.font.map.get(46) ?? 0;
            this.aux.u[offset + 28] = this.font.map.get(45) ?? 0;
            this.aux.u[offset + 29] = this.font.map.get(82) ?? 0;
            this.aux.u[offset + 30] = this.font.map.get(216) ?? 0;
            this.aux.u[offset + 31] = this.font.map.get(176) ?? 0;
        }
        else if (e.points) {
            count = e.points.length;
            offset = this.aux.alloc(count * 4);
            e.points.forEach((p, k) => this.aux.f.set([p[0] - anchor[0], p[1] - anchor[1], p[2] || 0, p[3] ?? 1], offset + k * 4));
        }
        else if (e.spline) {
            const { degree, knots, points, weights } = e.spline;
            count = points.length;
            offset = this.aux.alloc(4 + knots.length + points.length * 4);
            this.aux.u.set([degree, knots.length, points.length, 0], offset);
            this.aux.f.set(knots, offset + 4);
            points.forEach((p, k) => this.aux.f.set([p[0] - anchor[0], p[1] - anchor[1], weights?.[k] ?? 1, 0], offset + 4 + knots.length + k * 4));
        }
        this.u.set([offset, count, this.node(e.node), flags], j + 20);
        this.f.set([1, 0, 0, 1], j + 24);
        this.handles.push(e.handle || null);
        return id;
    }
    finish() { const table = this.aux.alloc(this.runs.length); this.aux.u.set(this.runs, table); return { count: this.count, idBase: this.idBase, entities: this.buffer.slice(0, Math.max(this.count, 1) * ENTITY_BYTES), aux: this.aux.finish(), runTable: table, runCount: this.runs.length, handles: this.handles, missing: [...this.missing] }; }
}
export class ModelBuilder {
    constructor(font, { name = 'Untitled', origin = [0, 0], layers, pageSize = PAGE_ENTITIES, idBase = 0 } = {}) { this.font = font; this.name = name; this.origin = origin; this.layers = layers || [{ name: '0', color: rgba('#c3cfda'), visible: true }]; this.pageSize = pageSize; this.count = 0; this.idBase = idBase; this.pages = []; this.current = null; this.diagnostics = []; }
    add(e) { if (!this.current || this.current.count === this.pageSize || this.current.aux.length > 16 * 1024 * 1024) {
        if (this.current)
            this.pages.push(this.current.finish());
        this.current = new PageBuilder(this.font, { origin: this.origin, idBase: this.idBase + this.count, pageSize: this.pageSize });
    } const id = this.current.add(e); this.count++; return id; }
    line(a, b, layer = 0, color = 0, width = 0, node = null) { return this.add({ type: TYPE.LINE, anchor: a, p: [b[0] - a[0], b[1] - a[1], width, 0], layer, color, node }); }
    rect(x, y, w, h, layer = 0, color = 0) { return this.add({ type: TYPE.POLYLINE, anchor: [x, y], points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], flags: FLAGS.CLOSED, layer, color }); }
    circle(x, y, r, layer = 0, color = 0) { return this.add({ type: TYPE.ELLIPSE, anchor: [x, y], p: [r, 0, 1, 0], q: [0, Math.PI * 2, 0, 0], layer, color }); }
    text(text, x, y, height = 10, layer = 0, color = 0, rotation = 0) { return this.add({ type: TYPE.TEXT, anchor: [x, y], p: [height, 1, rotation, 0], text, layer, color }); }
    finish() { if (this.current) {
        if (this.current.count) this.pages.push(this.current.finish());
        this.current = null;
    } return { version: 1, name: this.name, origin: this.origin, layers: this.layers, pages: this.pages, count: this.count, idBase: this.idBase, diagnostics: this.diagnostics, missing: [...new Set(this.pages.flatMap(p => p.missing))] }; }
}
export function transferList(model) { const list = model.pages.flatMap(p => [p.entities, p.aux]).filter(Boolean); if (model.source?.kind === 'bytes') list.push(model.source.data); return [...new Set(list)]; }
export function modelBytes(model) { return model.pages.reduce((n, p) => n + (p.entities?.byteLength || 0) + p.aux.byteLength, 0); }
