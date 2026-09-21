import {readOpenTypeLayout, glyphClosure, packOpenTypeLayout} from './layout.js';
/** Original engineering stroke face and a small, defensive TrueType outline reader.
 * No browser text rasterizer, third-party font, or pre-rasterized atlas is used.
 * Outlines remain line/quadratic records; the GPU creates the distance atlas.
 */
export const CELL = 64;
export const ATLAS_COLUMNS = 16;
export const MAX_GLYPHS = 4096;
const S = {
    'A': '0,0 .3,1 .6,0|.12,.4 .48,.4', 'B': '0,0 0,1 .38,1 .58,.85 .58,.66 .38,.51 0,.51|.38,.51 .6,.35 .6,.16 .38,0 0,0',
    'C': '.6,.85 .45,1 .15,1 0,.8 0,.2 .15,0 .45,0 .6,.15', 'D': '0,0 0,1 .34,1 .6,.75 .6,.25 .34,0 0,0',
    'E': '.6,1 0,1 0,0 .6,0|0,.5 .48,.5', 'F': '0,0 0,1 .6,1|0,.53 .48,.53',
    'G': '.6,.83 .44,1 .16,1 0,.8 0,.2 .16,0 .44,0 .6,.16 .6,.48 .34,.48', 'H': '0,0 0,1|.6,0 .6,1|0,.5 .6,.5',
    'I': '.08,1 .52,1|.3,1 .3,0|.08,0 .52,0', 'J': '.6,1 .6,.2 .44,0 .16,0 0,.18|.26,1 .6,1',
    'K': '0,0 0,1|.6,1 0,.44|.22,.65 .6,0', 'L': '0,1 0,0 .6,0', 'M': '0,0 0,1 .3,.48 .6,1 .6,0',
    'N': '0,0 0,1 .6,0 .6,1', 'O': '.16,0 0,.2 0,.8 .16,1 .44,1 .6,.8 .6,.2 .44,0 .16,0',
    'P': '0,0 0,1 .4,1 .6,.83 .6,.66 .4,.5 0,.5', 'Q': '.16,0 0,.2 0,.8 .16,1 .44,1 .6,.8 .6,.2 .44,0 .16,0|.36,.25 .67,-.08',
    'R': '0,0 0,1 .4,1 .6,.83 .6,.66 .4,.5 0,.5|.3,.5 .6,0', 'S': '.6,.84 .44,1 .16,1 0,.84 0,.67 .16,.52 .44,.48 .6,.32 .6,.16 .44,0 .16,0 0,.16',
    'T': '0,1 .6,1|.3,1 .3,0', 'U': '0,1 0,.2 .16,0 .44,0 .6,.2 .6,1', 'V': '0,1 .3,0 .6,1',
    'W': '0,1 .12,0 .3,.5 .48,0 .6,1', 'X': '0,0 .6,1|0,1 .6,0', 'Y': '0,1 .3,.5 .6,1|.3,.5 .3,0', 'Z': '0,1 .6,1 0,0 .6,0',
    '0': '.16,0 0,.2 0,.8 .16,1 .44,1 .6,.8 .6,.2 .44,0 .16,0|.08,.18 .52,.82', '1': '.1,.8 .3,1 .3,0|.06,0 .54,0',
    '2': '0,.82 .16,1 .44,1 .6,.82 .6,.64 0,0 .6,0', '3': '0,1 .6,1 .29,.54 .47,.54 .6,.36 .6,.18 .43,0 .14,0 0,.13',
    '4': '.46,0 .46,1 0,.3 .64,.3', '5': '.6,1 0,1 0,.54 .42,.54 .6,.37 .6,.18 .43,0 .15,0 0,.13',
    '6': '.57,.88 .43,1 .18,1 0,.75 0,.2 .16,0 .44,0 .6,.2 .6,.38 .44,.55 .16,.55 0,.38',
    '7': '0,1 .6,1 .15,0', '8': '.16,.51 0,.68 0,.84 .16,1 .44,1 .6,.84 .6,.68 .44,.51 .16,.51 0,.32 0,.16 .16,0 .44,0 .6,.16 .6,.32 .44,.51',
    '9': '.03,.12 .17,0 .42,0 .6,.25 .6,.8 .44,1 .16,1 0,.8 0,.62 .16,.45 .44,.45 .6,.62',
    '.': '.29,0 .31,.02', ',': '.33,.05 .24,-.16', ':': '.29,.2 .31,.22|.29,.73 .31,.75', ';': '.33,.22 .24,.01|.29,.73 .31,.75',
    '-': '.08,.48 .52,.48', '_': '0,-.14 .6,-.14', '+': '.06,.5 .54,.5|.3,.22 .3,.78', '=': '.04,.35 .56,.35|.04,.65 .56,.65',
    '/': '0,-.06 .6,1.06', '\\': '0,1.06 .6,-.06', '|': '.3,-.15 .3,1.1', '!': '.3,1 .3,.28|.29,0 .31,.02',
    '?': '0,.83 .16,1 .44,1 .6,.83 .6,.68 .3,.42 .3,.26|.29,0 .31,.02', '(': '.45,1.1 .23,.85 .14,.5 .23,.15 .45,-.1',
    ')': '.15,1.1 .37,.85 .46,.5 .37,.15 .15,-.1', '[': '.46,1.1 .18,1.1 .18,-.1 .46,-.1', ']': '.14,1.1 .42,1.1 .42,-.1 .14,-.1',
    '{': '.48,1.1 .26,1.1 .2,.95 .2,.65 .08,.5 .2,.35 .2,.05 .26,-.1 .48,-.1', '}': '.12,1.1 .34,1.1 .4,.95 .4,.65 .52,.5 .4,.35 .4,.05 .34,-.1 .12,-.1',
    '<': '.54,.86 .08,.5 .54,.14', '>': '.06,.86 .52,.5 .06,.14', '"': '.18,1 .18,.77|.42,1 .42,.77', "'": '.3,1 .3,.77',
    '#': '.18,0 .28,1|.36,0 .46,1|.04,.3 .57,.3|.07,.7 .6,.7', '*': '.3,.22 .3,.84|.03,.39 .57,.69|.03,.69 .57,.39',
    '%': '.02,0 .58,1|.12,.64 0,.74 0,.9 .12,1 .24,.9 .24,.74 .12,.64|.48,0 .36,.1 .36,.26 .48,.36 .6,.26 .6,.1 .48,0',
    '&': '.6,0 .1,.64 .08,.83 .2,1 .36,1 .5,.84 .46,.67 .08,.32 0,.16 .14,0 .35,0 .6,.36',
    '@': '.47,.18 .58,.34 .58,.73 .43,.92 .15,.92 0,.7 0,.24 .15,.06 .48,.06|.45,.7 .24,.7 .17,.58 .17,.39 .27,.3 .44,.42 .44,.72',
    '$': '.6,.85 .45,1 .15,1 0,.8 .15,.56 .45,.44 .6,.2 .45,0 .15,0 0,.15|.3,-.12 .3,1.12',
    '^': '.04,.65 .3,1 .56,.65', '~': '0,.42 .15,.56 .3,.5 .45,.44 .6,.58', '`': '.22,1 .36,.83',
    'a': '.04,.59 .16,.7 .43,.7 .55,.57 .55,0|.55,.42 .14,.42 0,.28 0,.12 .14,0 .39,0 .55,.14',
    'b': '0,1 0,0|0,.55 .15,.7 .41,.7 .57,.53 .57,.17 .41,0 .15,0 0,.16',
    'c': '.56,.57 .42,.7 .16,.7 0,.52 0,.18 .16,0 .42,0 .56,.13',
    'd': '.57,1 .57,0|.57,.55 .42,.7 .16,.7 0,.53 0,.17 .16,0 .42,0 .57,.16',
    'e': '0,.36 .57,.36 .57,.53 .41,.7 .16,.7 0,.53 0,.18 .16,0 .42,0 .57,.12',
    'f': '.18,0 .18,.83 .31,1 .53,1|.03,.65 .46,.65', 'g': '.57,.7 .57,-.15 .43,-.3 .16,-.3 .03,-.2|.57,.55 .42,.7 .16,.7 0,.53 0,.17 .16,0 .42,0 .57,.16',
    'h': '0,0 0,1|0,.52 .17,.7 .4,.7 .57,.53 .57,0', 'i': '.3,0 .3,.7|.29,.96 .31,.98',
    'j': '.42,.7 .42,-.16 .27,-.3 .06,-.3|.41,.96 .43,.98', 'k': '0,0 0,1|.55,.7 0,.25|.2,.41 .58,0',
    'l': '.2,1 .2,.12 .3,0 .47,0', 'm': '0,0 0,.7|0,.55 .13,.7 .27,.7 .3,.52 .3,0|.3,.52 .43,.7 .56,.7 .6,.53 .6,0',
    'n': '0,0 0,.7|0,.52 .17,.7 .4,.7 .57,.53 .57,0', 'o': '.16,0 0,.18 0,.52 .16,.7 .41,.7 .57,.52 .57,.18 .41,0 .16,0',
    'p': '0,-.3 0,.7|0,.55 .15,.7 .41,.7 .57,.53 .57,.17 .41,0 .15,0 0,.16',
    'q': '.57,-.3 .57,.7|.57,.55 .42,.7 .16,.7 0,.53 0,.17 .16,0 .42,0 .57,.16',
    'r': '.05,0 .05,.7|.05,.51 .22,.7 .42,.7 .55,.58', 's': '.56,.57 .42,.7 .15,.7 0,.56 .15,.39 .42,.32 .57,.17 .42,0 .15,0 0,.13',
    't': '.28,1 .28,.14 .41,0 .58,0|.06,.7 .52,.7', 'u': '0,.7 0,.18 .16,0 .4,0 .57,.18 .57,.7|.57,.18 .57,0',
    'v': '0,.7 .3,0 .6,.7', 'w': '0,.7 .12,0 .3,.4 .48,0 .6,.7', 'x': '0,0 .57,.7|0,.7 .57,0',
    'y': '0,.7 .3,0|.6,.7 .18,-.3 .02,-.3', 'z': '0,.7 .57,.7 0,0 .57,0',
    '°': '.16,.63 .04,.75 .04,.91 .16,1.03 .32,1.03 .44,.91 .44,.75 .32,.63 .16,.63',
    '±': '.04,.62 .56,.62|.3,.34 .3,.9|.04,.1 .56,.1', 'Ø': '.16,0 0,.2 0,.8 .16,1 .44,1 .6,.8 .6,.2 .44,0 .16,0|-.04,-.08 .64,1.08',
    'Δ': '0,0 .3,1 .6,0 0,0', 'Ω': '0,0 .2,0 .2,.15 .03,.35 0,.65 .16,.9 .44,.9 .6,.65 .57,.35 .4,.15 .4,0 .6,0',
    'μ': '0,-.3 0,.7|0,.2 .17,0 .35,0 .52,.2 .52,.7|.52,.2 .62,0', '→': '0,.5 .65,.5|.4,.75 .65,.5 .4,.25',
    '□': '0,0 0,1 .6,1 .6,0 0,0', ' ': ''
};
const accent = { 'á': ['a', '.24,.86 .43,1.06'], 'é': ['e', '.24,.86 .43,1.06'], 'ó': ['o', '.24,.86 .43,1.06'], 'ú': ['u', '.24,.86 .43,1.06'], 'í': ['i', '.24,.86 .43,1.06'], 'ń': ['n', '.24,.86 .43,1.06'], 'ć': ['c', '.24,.86 .43,1.06'], 'ś': ['s', '.24,.86 .43,1.06'], 'ź': ['z', '.24,.86 .43,1.06'], 'ż': ['z', '.29,.95 .31,.97'], 'ł': ['l', '.04,.36 .49,.62'], 'ą': ['a', '.49,0 .39,-.19 .51,-.27 .63,-.22'], 'ę': ['e', '.41,0 .31,-.19 .43,-.27 .55,-.22'], 'ä': ['a', '.16,.93 .18,.95|.42,.93 .44,.95'], 'ö': ['o', '.16,.93 .18,.95|.42,.93 .44,.95'], 'ü': ['u', '.16,.93 .18,.95|.42,.93 .44,.95'] };
for (const [c, [base, path]] of Object.entries(accent))
    S[c] = S[base] + '|' + path;
function strokeEdges(path) {
    const out = [];
    for (const piece of path.split('|')) {
        if (!piece)
            continue;
        const p = piece.trim().split(/\s+/).map(v => v.split(',').map(Number));
        for (let i = 1; i < p.length; i++)
            out.push([p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], 0, 0, 0, 0]);
    }
    return out;
}
export function makeBuiltinFont() {
    const glyphs = [], map = new Map();
    const chars = ['□', ' ', ...Object.keys(S).filter(c => c !== '□' && c !== ' ')];
    for (const c of chars) {
        map.set(c.codePointAt(0), glyphs.length);
        glyphs.push({ edges: strokeEdges(S[c]), box: [-.12, -.4, .8, 1.22], advance: c === ' ' ? .46 : .73, stroke: .032, mode: 0 });
    }
    return packFont({ name: 'Aperture Technical', glyphs, map, missing: [] });
}
export function packFont(font) {
    const cellSize = font.cellSize || CELL;
    if (![32, 64, 128].includes(cellSize)) throw new RangeError('Font atlas cell size must be 32, 64 or 128.');
    const columns = 2 ** Math.ceil(Math.log2(Math.max(1, Math.sqrt(font.glyphs.length))));
    const meta = new ArrayBuffer(font.glyphs.length * 48), u = new Uint32Array(meta), f = new Float32Array(meta);
    const edgeCount = font.glyphs.reduce((n, g) => n + Math.max(g.edges.length, g.edgeCapacity || 0), 0), edges = new Float32Array(edgeCount * 8);
    let offset = 0;
    font.glyphs.forEach((g, i) => {
        const j = i * 12; u[j] = offset; u[j + 1] = g.edges.length; u[j + 2] = g.mode || 0;
        f.set(g.box, j + 4); f.set([g.advance, g.stroke || 0, 0, 0], j + 8);
        for (const e of g.edges) { if (e.length !== 8 || e.some(x => !Number.isFinite(x))) throw new RangeError('Invalid font edge.'); edges.set(e, offset++ * 8); }
        offset += Math.max(0, (g.edgeCapacity || 0) - g.edges.length);
    });
    return { ...font, meta, edges, cellSize, count: font.glyphs.length, atlasWidth: columns * cellSize, atlasHeight: Math.ceil(font.glyphs.length / columns) * cellSize };
}
/** TrueType glyf/cmap/hmtx reader. CFF/CFF2, WOFF and variable deltas intentionally fail closed. */
export function parseTrueType(buffer, requestedCodepoints = [], { maxGlyphs = MAX_GLYPHS, cellSize = CELL, script = 'latn', language = null, features = ['ccmp', 'liga', 'rlig', 'kern'] } = {}) {
    if (!(buffer instanceof ArrayBuffer) || !Number.isInteger(maxGlyphs) || maxGlyphs < 1 || maxGlyphs > 16384) throw new TypeError('Expected a TrueType ArrayBuffer and a 1..16384 glyph budget.');
    const d = new DataView(buffer), len = buffer.byteLength;
    const need = (o, n) => { if (o < 0 || o + n > len)
        throw new Error('Truncated TrueType table.'); };
    need(0, 12);
    const sig = d.getUint32(0);
    if (sig !== 0x00010000 && sig !== 0x74727565)
        throw new Error('Use an uncompressed TrueType .ttf with glyf outlines. CFF/WOFF are not supported.');
    const tables = {};
    let nt = d.getUint16(4);
    if (nt > 256)
        throw new Error('Invalid TrueType table count.');
    need(12, nt * 16);
    for (let i = 0; i < nt; i++) {
        let a = 12 + i * 16, k = String.fromCharCode(...new Uint8Array(buffer, a, 4)), o = d.getUint32(a + 8), n = d.getUint32(a + 12);
        need(o, n);
        tables[k] = { o, n };
    }
    if (tables.fvar || tables.gvar)
        throw new Error('Variable TrueType fonts are not supported. Supply a static TrueType instance.');
    for (const t of ['head', 'maxp', 'hhea', 'hmtx', 'loca', 'glyf', 'cmap'])
        if (!tables[t])
            throw new Error('Missing TrueType ' + t + ' table.');
    for (const [name, length] of [['head', 54], ['maxp', 6], ['hhea', 36], ['cmap', 4]]) if (tables[name].n < length) throw new Error('Truncated TrueType ' + name + ' table.');
    const head = tables.head.o, units = d.getUint16(head + 18), ng = d.getUint16(tables.maxp.o + 4), long = d.getInt16(head + 50) === 1, nh = d.getUint16(tables.hhea.o + 34);
    if (units < 16 || nh < 1 || nh > ng)
        throw new Error('Invalid TrueType metrics.');
    if (tables.hmtx.n < nh * 4 + (ng - nh) * 2 || tables.loca.n < (ng + 1) * (long ? 4 : 2)) throw new Error('Truncated TrueType location or metric table.');
    const loc = i => { need(tables.loca.o + i * (long ? 4 : 2), long ? 4 : 2); return long ? d.getUint32(tables.loca.o + i * 4) : d.getUint16(tables.loca.o + i * 2) * 2; };
    const cm = tables.cmap.o;
    need(cm, 4);
    let sub = -1, rank = -1;
    for (let i = 0; i < d.getUint16(cm + 2); i++) {
        const a = cm + 4 + i * 8;
        need(a, 8);
        const o = cm + d.getUint32(a + 4);
        need(o, 2);
        const fmt = d.getUint16(o), p = d.getUint16(a), e = d.getUint16(a + 2), r = fmt === 12 ? 30 : fmt === 4 ? 20 : -1;
        if (r + (p === 3 ? 2 : 0) + (e === 10 ? 1 : 0) > rank && r >= 0) {
            sub = o;
            rank = r + (p === 3 ? 2 : 0) + (e === 10 ? 1 : 0);
        }
    }
    if (sub < 0)
        throw new Error('No Unicode cmap format 4 or 12.');
    const cmap = cp => {
        if (d.getUint16(sub) === 12) {
            need(sub, 16);
            let lo = 0, hi = d.getUint32(sub + 12) - 1;
            if (hi > 1000000)
                throw new Error('Invalid cmap groups.');
            need(sub + 16, (hi + 1) * 12);
            while (lo <= hi) {
                const m = (lo + hi) >>> 1, a = sub + 16 + m * 12, s = d.getUint32(a), e = d.getUint32(a + 4);
                if (cp < s)
                    hi = m - 1;
                else if (cp > e)
                    lo = m + 1;
                else
                    return d.getUint32(a + 8) + cp - s;
            }
            return 0;
        }
        if (cp > 65535)
            return 0;
        const n = d.getUint16(sub + 6) / 2, end = sub + 14, start = end + n * 2 + 2, delta = start + n * 2, range = delta + n * 2;
        need(range, n * 2);
        for (let i = 0; i < n; i++) {
            const e = d.getUint16(end + i * 2);
            if (cp > e)
                continue;
            const s = d.getUint16(start + i * 2);
            if (cp < s)
                return 0;
            const off = d.getUint16(range + i * 2), v = d.getInt16(delta + i * 2);
            if (!off)
                return (cp + v) & 65535;
            const a = range + i * 2 + off + (cp - s) * 2;
            need(a, 2);
            const g = d.getUint16(a);
            return g ? (g + v) & 65535 : 0;
        }
        return 0;
    };
    function outline(g, depth = 0, stack = new Set()) {
        if (g >= ng || depth > 12 || stack.has(g))
            throw new Error('Invalid or cyclic TrueType composite glyph.');
        const start = loc(g), end = loc(g + 1);
        if (start === end)
            return [];
        if (end < start || end > tables.glyf.n)
            throw new Error('Invalid glyph location.');
        const a = tables.glyf.o + start;
        const need = (offset, length) => { if (offset < a || offset + length > tables.glyf.o + end) throw new Error('Truncated TrueType glyph record.'); };
        need(a, 10);
        const nc = d.getInt16(a), out = [];
        let p = a + 10;
        if (nc >= 0) {
            if (nc > 32767)
                throw new Error('Excessive contours.');
            need(p, nc * 2);
            const ends = [];
            for (let i = 0; i < nc; i++)
                ends.push(d.getUint16(p + i * 2));
            p += nc * 2;
            need(p, 2);
            const ni = d.getUint16(p);
            p += 2 + ni;
            const n = nc ? ends[nc - 1] + 1 : 0;
            if (n > 65536)
                throw new Error('Excessive glyph points.');
            const flags = [];
            while (flags.length < n) {
                need(p, 1);
                const f = d.getUint8(p++);
                flags.push(f);
                if (f & 8) {
                    need(p, 1);
                    let r = d.getUint8(p++);
                    if (flags.length + r > n)
                        throw new Error('Bad glyph flag run.');
                    while (r--)
                        flags.push(f);
                }
            }
            const xs = [], ys = [];
            let x = 0, y = 0;
            for (const f of flags) {
                if (f & 2) {
                    need(p, 1);
                    x += (f & 16 ? 1 : -1) * d.getUint8(p++);
                }
                else if (!(f & 16)) {
                    need(p, 2);
                    x += d.getInt16(p);
                    p += 2;
                }
                xs.push(x / units);
            }
            for (const f of flags) {
                if (f & 4) {
                    need(p, 1);
                    y += (f & 32 ? 1 : -1) * d.getUint8(p++);
                }
                else if (!(f & 32)) {
                    need(p, 2);
                    y += d.getInt16(p);
                    p += 2;
                }
                ys.push(y / units);
            }
            let first = 0;
            for (const last of ends) {
                const pts = [];
                for (let i = first; i <= last; i++)
                    pts.push([xs[i], ys[i], !!(flags[i] & 1)]);
                first = last + 1;
                if (!pts.length)
                    continue;
                const expanded = [];
                for (let i = 0; i < pts.length; i++) {
                    const u = pts[i], v = pts[(i + 1) % pts.length];
                    expanded.push(u);
                    if (!u[2] && !v[2])
                        expanded.push([(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, true]);
                }
                let s = expanded.findIndex(p => p[2]);
                if (s < 0)
                    continue;
                const pp = expanded.slice(s).concat(expanded.slice(0, s));
                pp.push(pp[0]);
                let cur = pp[0];
                for (let i = 1; i < pp.length; i++) {
                    const v = pp[i];
                    if (v[2]) {
                        out.push([cur[0], cur[1], v[0], v[1], 0, 0, 0, 0]);
                        cur = v;
                    }
                    else {
                        const e = pp[++i];
                        out.push([cur[0], cur[1], e[0], e[1], v[0], v[1], 1, 0]);
                        cur = e;
                    }
                }
            }
        }
        else {
            stack = new Set(stack);
            stack.add(g);
            let flags = 0;
            do {
                need(p, 4);
                flags = d.getUint16(p);
                const child = d.getUint16(p + 2);
                p += 4;
                let ax, ay;
                if (flags & 1) {
                    need(p, 4);
                    ax = d.getInt16(p);
                    ay = d.getInt16(p + 2);
                    p += 4;
                }
                else {
                    need(p, 2);
                    ax = d.getInt8(p);
                    ay = d.getInt8(p + 1);
                    p += 2;
                }
                if (!(flags & 2))
                    throw new Error('TrueType point-matched composites are not supported; use XY-positioned outlines.');
                let xx = 1, xy = 0, yx = 0, yy = 1;
                const read = () => { need(p, 2); const v = d.getInt16(p) / 16384; p += 2; return v; };
                if (flags & 8) {
                    xx = yy = read();
                }
                else if (flags & 64) {
                    xx = read();
                    yy = read();
                }
                else if (flags & 128) {
                    xx = read();
                    yx = read();
                    xy = read();
                    yy = read();
                }
                let dx = ax / units, dy = ay / units;
                if (flags & 2048) {
                    [dx, dy] = [xx * dx + xy * dy, yx * dx + yy * dy];
                }
                for (const e of outline(child, depth + 1, stack)) {
                    const q = e.slice();
                    for (let k = 0; k < 6; k += 2) {
                        q[k] = xx * e[k] + xy * e[k + 1] + dx;
                        q[k + 1] = yx * e[k] + yy * e[k + 1] + dy;
                    }
                    out.push(q);
                }
            } while (flags & 32);
        }
        return out;
    }
    const cps = [...new Set([0x25a1, 32, ...Array.from({ length: 95 }, (_, i) => i + 32), ...requestedCodepoints])];
    if (cps.some(cp => !Number.isInteger(cp) || cp < 0 || cp > 0x10ffff)) throw new RangeError('Invalid requested Unicode codepoint.');
    const layout = readOpenTypeLayout(d, tables, units, { script, language, features });
    const mapped = cps.map(cp => [cp, cmap(cp)]), missing = mapped.filter(([cp, g]) => !g && cp !== 0x25a1).map(([cp]) => cp);
    const glyphIds = glyphClosure(layout, mapped.map(([, g]) => g), maxGlyphs);
    if (glyphIds.length > maxGlyphs) throw new Error(`This atlas supports ${maxGlyphs} distinct glyphs; requested ${glyphIds.length}.`);
    const glyphs = [], map = new Map(), dense = new Map(glyphIds.map((g, i) => [g, i]));
    for (const g of glyphIds) {
        if (g >= ng) throw new Error('OpenType substituted glyph is outside the glyph table.');
        const edges = outline(g), adv = d.getUint16(tables.hmtx.o + Math.min(g, nh - 1) * 4) / units;
        let box = [0, -.25, Math.max(adv, .2), 1];
        if (edges.length) {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const e of edges) for (let k = 0; k < (e[6] ? 6 : 4); k += 2) { x0 = Math.min(x0, e[k]); y0 = Math.min(y0, e[k + 1]); x1 = Math.max(x1, e[k]); y1 = Math.max(y1, e[k + 1]); }
            box = [x0 - .1, y0 - .1, x1 + .1, y1 + .1];
        }
        glyphs.push({ edges, box, advance: adv, mode: 1, stroke: 0, originalId: g });
    }
    for (const [cp, gid] of mapped) map.set(cp, dense.get(gid));
    return packFont({ name: 'Imported TrueType', glyphs, map, missing, cellSize, glyphIds,
        layoutData: packOpenTypeLayout(layout, glyphIds), layoutProfile: { script, language, features }, diagnostics: layout.diagnostics });
}
