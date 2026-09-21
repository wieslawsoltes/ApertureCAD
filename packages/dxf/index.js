import { SpaceCatalog } from './spaces.js';
import { decodeHatch } from './hatch.js';
import { ModelBuilder, TYPE, FLAGS, rgba } from '../model/index.js';
export class DxfError extends Error {
    constructor(message, line = 0) { super(line ? `${message} (line ${line})` : message); this.name = 'DxfError'; this.line = line; }
}
const DEG = Math.PI / 180;
const BASE = ['#000000', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff', '#808080', '#c0c0c0'];
export function aciColor(index) {
    index = Math.abs(index);
    if (index < 10)
        return rgba(BASE[index]);
    if (index >= 250)
        return rgba('#' + [51, 80, 105, 130, 190, 255][Math.min(index - 250, 5)].toString(16).padStart(2, '0').repeat(3));
    const h = Math.floor((index - 10) / 10) * 15 / 60, slot = (index - 10) % 10, v = [255, 255, 165, 165, 127, 127, 76, 76, 38, 38][slot] / 255, s = slot % 2 ? .5 : 1, c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
    const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return (0xff000000 | Math.round((rgb[0] + m) * 255) | (Math.round((rgb[1] + m) * 255) << 8) | (Math.round((rgb[2] + m) * 255) << 16)) >>> 0;
}
export function decodeDxfText(s, mtext = false) {
    s = s.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => { const cp = parseInt(h, 16); return cp <= 0x10ffff ? String.fromCodePoint(cp) : '□'; }).replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[cC]/g, 'Ø').replace(/%%[uUoOkK]/g, '');
    if (mtext)
        s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ').replace(/\\S([^;]*);/g, (_, v) => v.replace(/[\^#]/g, '/')).replace(/\\[ACFHQTWacfhtw][^;]*;/g, '').replace(/\\[LlOoKk]/g, '').replace(/[{}]/g, '').replace(/\\\\/g, '\\');
    return s;
}
function groupType(c) {
    if ((c >= 10 && c <= 59) || (c >= 110 && c <= 149) || (c >= 210 && c <= 239) || (c >= 460 && c <= 469) || (c >= 1010 && c <= 1059))
        return 'double';
    if ((c >= 60 && c <= 79) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289) || (c >= 370 && c <= 389) || (c >= 400 && c <= 409) || (c >= 1060 && c <= 1070))
        return 'short';
    if ((c >= 90 && c <= 99) || (c >= 420 && c <= 429) || (c >= 440 && c <= 459) || c === 1071)
        return 'int';
    if (c >= 160 && c <= 169)
        return 'long';
    if (c >= 290 && c <= 299)
        return 'bool';
    if ((c >= 310 && c <= 319) || c === 1004)
        return 'binary';
    return 'string';
}
export function* asciiGroups(text) {
    let p = 0, line = 0;
    const next = () => { if (p >= text.length)
        return null; const start = p, k = text.indexOf('\n', p); p = k < 0 ? text.length : k + 1; line++; return text.slice(start, k < 0 ? text.length : k).replace(/\r$/, ''); };
    while (p < text.length) {
        let cs = next();
        if (cs !== null && !cs.trim() && p >= text.length)
            break;
        const n = line;
        if (cs === null)
            break;
        cs = cs.replace(/^\uFEFF/, '');
        if (!/^\s*\d+\s*$/.test(cs))
            throw new DxfError('Invalid DXF group code', n);
        const code = Number(cs), vs = next();
        if (vs === null)
            throw new DxfError('Missing DXF group value', n);
        if (code > 1071)
            throw new DxfError('DXF group code out of range', n);
        const type = groupType(code);
        let value = type === 'string' || type === 'binary' ? vs.trimEnd() : Number(vs.trim());
        if (typeof value === 'number' && !Number.isFinite(value))
            throw new DxfError('Non-finite DXF numeric value', n + 1);
        yield { code, value, line: n };
    }
}
export function* binaryGroups(buffer) {
    const d = new DataView(buffer);
    let p = 22;
    let decoder = new TextDecoder('windows-1252'), headerKey = '', unicode = false;
    const need = n => { if (p + n > d.byteLength)
        throw new DxfError('Truncated binary DXF', p); };
    need(2);
    const wide = d.getUint8(p + 1) === 0;
    while (p < d.byteLength) {
        let code;
        need(wide ? 2 : 1);
        if (wide) {
            code = d.getUint16(p, true);
            p += 2;
        }
        else {
            code = d.getUint8(p++);
            if (code === 255) {
                need(2);
                code = d.getUint16(p, true);
                p += 2;
            }
        }
        const type = groupType(code);
        let value;
        if (type === 'double') {
            need(8);
            value = d.getFloat64(p, true);
            p += 8;
        }
        else if (type === 'short') {
            need(2);
            value = d.getInt16(p, true);
            p += 2;
        }
        else if (type === 'int') {
            need(4);
            value = d.getInt32(p, true);
            p += 4;
        }
        else if (type === 'long') {
            need(8);
            value = Number(d.getBigInt64(p, true));
            p += 8;
        }
        else if (type === 'bool') {
            need(1);
            value = d.getUint8(p++);
        }
        else if (type === 'binary') {
            need(1);
            let n = d.getUint8(p++);
            need(n);
            value = Array.from(new Uint8Array(buffer, p, n), v => v.toString(16).padStart(2, '0')).join('');
            p += n;
        }
        else {
            const start = p;
            while (p < d.byteLength && d.getUint8(p) !== 0)
                p++;
            if (p >= d.byteLength)
                throw new DxfError('Unterminated binary DXF string', start);
            value = decoder.decode(new Uint8Array(buffer, start, p - start));
            p++;
        }
        if (code === 9)
            headerKey = value;
        if (headerKey === '$ACADVER' && code === 1 && /^AC/.test(value) && Number(value.slice(2)) >= 1021) {
            unicode = true;
            decoder = new TextDecoder('utf-8');
        }
        if (!unicode && headerKey === '$DWGCODEPAGE' && code === 3 && /^ANSI_\d+$/.test(value)) {
            try {
                decoder = new TextDecoder('windows-' + value.slice(5));
            }
            catch {
                decoder = new TextDecoder('windows-1252');
            }
        }
        if (typeof value === 'number' && !Number.isFinite(value))
            throw new DxfError('Non-finite binary DXF numeric value', p);
        yield { code, value, line: p };
    }
}
export function* records(groups) { let rec = null; for (const g of groups) {
    if (g.code === 0) {
        if (rec)
            yield rec;
        rec = { type: String(g.value).trim().toUpperCase(), groups: [], line: g.line };
    }
    else if (rec)
        rec.groups.push(g);
    else {
        if (!rec)
            rec = { type: 'PREAMBLE', groups: [], line: g.line };
        rec.groups.push(g);
    }
} if (rec)
    yield rec; }
const get = (r, c, def = 0) => { for (const g of r.groups)
    if (g.code === c)
        return g.value; return def; };
const all = (r, c) => r.groups.filter(g => g.code === c).map(g => g.value);
const pt = (r, c = 10) => [Number(get(r, c)), Number(get(r, c + 10))];
const has = (r, c) => r.groups.some(g => g.code === c);
const trueColor = v => ((0xff000000 | ((v >>> 16) & 255) | (v & 0xff00) | ((v & 255) << 16)) >>> 0);
/** Streaming records: raw BLOCK records are retained; ordinary ENTITIES are immediately serialized. */
export function parseDxf(input, font, { name = 'Drawing.dxf', onProgress = () => { }, maxEntities = 16000000, regenerateDimensions = true, preserveSource = false, space = 'model', document = false, editMap = false, pageSize = 65536 } = {}) {
    if (!['model', 'paper', 'all'].includes(space)) throw new DxfError('Space must be model, paper or all.');
    if (!Number.isInteger(maxEntities) || maxEntities < 1 || maxEntities > 16000000) throw new DxfError('Invalid entity import limit.');
    let text = null, binary = false;
    if (typeof input === 'string')
        text = input;
    else {
        const prefix = new TextDecoder().decode(new Uint8Array(input, 0, Math.min(128, input.byteLength)));
        binary = prefix.startsWith('AutoCAD Binary DXF');
        if (!binary) {
            const head = new TextDecoder().decode(new Uint8Array(input, 0, Math.min(65536, input.byteLength)));
            const v = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*AC(\d+)/.exec(head);
            const utf8 = v && Number(v[1]) >= 1021;
            const cp = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/.exec(head);
            let encoding = utf8 ? 'utf-8' : cp ? 'windows-' + cp[1] : 'windows-1252';
            try {
                text = new TextDecoder(encoding).decode(input);
            }
            catch {
                text = new TextDecoder('windows-1252').decode(input);
            }
        }
    }
    const blocks = new Map(), layers = [{ name: '0', color: aciColor(7), visible: true, locked: false }], layerMap = new Map([['0', 0]]), ltypes = new Map(), dimStyles = new Map(), header = {}, diagnostics = new Map();
    const warn = (code, message, n = 1) => { const old = diagnostics.get(code); if (old)
        old.count += n;
    else
        diagnostics.set(code, { code, message, count: n, severity: 'warning' }); };
    const editRoots = [];
    const catalog = new SpaceCatalog(), builders = new Map(), rootHandles = new Set(), originBuilders = new WeakSet();
    let model = new ModelBuilder(font, { name, layers, pageSize }), totalCount = 0;
    builders.set('model', model);
    function documentBuilder(key) { if (!builders.has(key)) builders.set(key, new ModelBuilder(font, { name, layers, pageSize: Math.min(8192,pageSize) })); return builders.get(key); }
    let section = '', block = null, poly = null, seenEOF = false, originSet = document, sourceCount = 0;
    function layerFor(n) { if (!layerMap.has(n)) {
        layerMap.set(n, layers.length);
        layers.push({ name: n, color: aciColor(7), visible: true, locked: false });
    } return layerMap.get(n); }
    function style(r, context) { const ln = String(get(r, 8, '0')), layer = ln === '0' && context ? context.layer : layerFor(ln); let c = Number(get(r, 62, 256)); let color = has(r, 420) ? trueColor(get(r, 420)) : c === 256 ? 0 : c === 0 ? (context?.color || 0) : aciColor(c); if (has(r, 440) && (get(r, 440) & 0x02000000)) { const alpha = get(r, 440) & 255; color = (((color || layers[layer].color) & 0xffffff) | (alpha << 24)) >>> 0; } const lt = String(get(r, 6, 'BYLAYER')), pattern = ltypes.get(lt === 'BYLAYER' ? layers[layer].linetype : lt), scale = Number(get(r, 48, 1)); const dash = pattern?.find(x => x > 0) || 0, gap = Math.abs(pattern?.find(x => x < 0) || 0); return { layer, color, r: [dash * scale, gap * scale, Number(get(r, 370, 0)), 0] }; }
    function append(e, r) { if (totalCount >= maxEntities)
        throw new DxfError('Entity safety limit reached; split this drawing or increase maxEntities explicitly.'); e.handle = String(get(r, 5, '')); model.add(e); totalCount++; if ((totalCount & 8191) === 0)
        onProgress({ phase: 'Packing GPU records', entities: totalCount }); }
    function process(r, node = null, context = null, chain = []) {
        if (!editMap || node || (editMap==='inserts' && r.type!=='INSERT')) return processEntity(r,node,context,chain);
        const key=catalog.key(r), builder=document?documentBuilder(key):model, first=builder.count;
        processEntity(r,node,context,chain);
        if(builder.count>first) editRoots.push({handle:String(get(r,5,'')),type:r.type,block:r.type==='INSERT'?String(get(r,2,'')):null,key,first,count:builder.count-first});
    }
    function processEntity(r, node = null, context = null, chain = []) {
        sourceCount++;
        const rootKey = !node ? catalog.key(r) : null;
        if (document && !node) { model = documentBuilder(rootKey); const h = String(get(r, 5, '')).toUpperCase(); if(h) rootHandles.add(h); }
        if (document && r.type === 'VIEWPORT' && !node) { catalog.addViewport(r, rootKey); return; }
        if (!document && !node && ((space === 'model' && rootKey !== 'model') || (space === 'paper' && rootKey === 'model'))) {
            warn('PAPER_SPACE', 'Entities outside the selected drawing space were excluded.');
            return;
        }
        if (get(r, 60, 0) === 1)
            return;
        const type = r.type, s = style(r, context);
        let localNode = node;
        if (['CIRCLE', 'ARC', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'TEXT', 'ATTRIB', 'ATTDEF', 'HATCH', 'SOLID', 'TRACE', 'INSERT'].includes(type)) {
            const normal = [get(r, 210, 0), get(r, 220, 0), get(r, 230, 1)];
            if (normal.every(v => v === 0)) {
                warn('INVALID_OCS', 'Entities with a zero extrusion normal were rejected.');
                return;
            }
            if (normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 1) {
                localNode = { ocs: normal, elevation: get(r, 30, get(r, 38, 0)), parent: node };
                warn('OCS_PROJECTED', 'Non-XY object coordinate systems are projected to a top-down XY view on the GPU.');
            }
        }
        const common = { ...s, node: localNode };
        const a = pt(r);
        if (!node && type !== 'ATTDEF' && (document ? !originBuilders.has(model) : !originSet)) {
            model.origin = a; originBuilders.add(model);
            originSet = true;
        }
        if (type === 'LINE') {
            const b = pt(r, 11);
            append({ ...common, type: TYPE.LINE, anchor: a, p: [b[0] - a[0], b[1] - a[1], 0, 0] }, r);
        }
        else if (type === 'XLINE' || type === 'RAY') {
            append({ ...common, type: TYPE[type], anchor: a, p: [get(r, 11), get(r, 21), 0, 0] }, r);
        }
        else if (type === 'CIRCLE' || type === 'ARC') {
            const radius = get(r, 40);
            if (!(radius > 0)) {
                warn('BAD_RADIUS', 'Entities with nonpositive radii were rejected.');
                return;
            }
            let start = type === 'ARC' ? get(r, 50) * DEG : 0, end = type === 'ARC' ? get(r, 51) * DEG : Math.PI * 2, sweep = end - start;
            sweep = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2;
            append({ ...common, type: TYPE.ELLIPSE, anchor: a, p: [radius, 0, 1, 0], q: [start, sweep, 0, 0] }, r);
        }
        else if (type === 'ELLIPSE') {
            const start = get(r, 41, 0), end = get(r, 42, Math.PI * 2);
            let sweep = end - start;
            sweep = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2;
            append({ ...common, type: TYPE.ELLIPSE, anchor: a, p: [get(r, 11), get(r, 21), get(r, 40, 1), 0], q: [start, sweep, 0, 0] }, r);
        }
        else if (type === 'LWPOLYLINE' || type === 'POLYLINE' || type === 'LEADER') {
            let points = [];
            if (r.vertices)
                points = r.vertices.map(v => [get(v, 10), get(v, 20), get(v, 42), get(v, 40, 0)]);
            else {
                let p = null;
                for (const g of r.groups) {
                    if (g.code === 10) {
                        p = [g.value, 0, 0, 0];
                        points.push(p);
                    }
                    else if (p && g.code === 20)
                        p[1] = g.value;
                    else if (p && g.code === 42)
                        p[2] = g.value;
                    else if (p && g.code === 40)
                        p[3] = g.value;
                }
            }
            if (points.length < 2) {
                warn('EMPTY_POLY', 'Empty/one-vertex polylines were rejected.');
                return;
            }
            if (type === 'POLYLINE' && (get(r, 70) & (16 | 64))) {
                warn('POLY_MESH', 'Polyface and polygon meshes are not imported by the 2D path kernel.');
                return;
            }
            if (points.some(p => p[3] > 0) || get(r, 43) > 0)
                warn('POLY_WIDTH', 'Variable/constant polyline widths are represented as centerline strokes, not swept ribbons.');
            append({ ...common, type: TYPE.POLYLINE, anchor: points[0].slice(0, 2), points, flags: (get(r, 70) & 1) ? FLAGS.CLOSED : 0 }, r);
        }
        else if (['TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF'].includes(type)) {
            if (type === 'ATTDEF' && !(get(r, 70) & 2))
                return;
            if ((type === 'ATTRIB' || type === 'ATTDEF') && (get(r, 70) & 1))
                return;
            let value = type === 'MTEXT' ? r.groups.filter(g => g.code === 3 || g.code === 1).map(g => g.value).join('') : String(get(r, 1, ''));
            value = decodeDxfText(value, type === 'MTEXT');
            let anchor = a, angle = get(r, 50) * DEG, hAlign = get(r, 72, 0), vAlign = get(r, type === 'ATTRIB' || type === 'ATTDEF' ? 74 : 73, 0), flags = 0, q = [0, 0, 0, 0], wrap = 0;
            if (type === 'MTEXT') {
                const attach = Math.max(1, Math.min(9, get(r, 71, 1)));
                hAlign = (attach - 1) % 3;
                vAlign = 3 - Math.floor((attach - 1) / 3);
                if (has(r, 11)) {
                    flags |= 16;
                    q[0] = get(r, 11);
                    q[1] = get(r, 21);
                }
                wrap = get(r, 41) / Math.max(get(r, 40, 1), 1e-20);
            }
            else if (hAlign === 3 || hAlign === 5) {
                flags |= hAlign === 3 ? 8 : 4;
                q[0] = get(r, 11) - a[0];
                q[1] = get(r, 21) - a[1];
                hAlign = 0;
            }
            else if ((hAlign || vAlign) && has(r, 11))
                anchor = pt(r, 11);
            q[2] = hAlign === 4 ? 1 : hAlign;
            q[3] = hAlign === 4 ? 2 : vAlign;
            if (/\\[ACFHQTW]/.test(String(get(r, 1, ''))) && type === 'MTEXT')
                warn('MTEXT_FORMAT', 'MTEXT text, paragraph breaks, attachment and wrapping are supported; inline font/color/height overrides and stacked typography are simplified.');
            if(type!=='MTEXT') {if(get(r,71)&2)flags|=32;if(get(r,71)&4)flags|=64;}
            append({ ...common, type: TYPE.TEXT, anchor, text: value, p: [Math.max(get(r, 40, 1), 1e-6), type === 'MTEXT' ? 1 : (get(r, 41, 1) || 1), angle, get(r, 51, 0) * DEG], q, flags, wrap }, r);
        }
        else if (type === 'DIMENSION' && regenerateDimensions) {
            const kind = get(r, 70) & 7;
            if (kind > 6) { warn('DIMENSION_KIND', 'Unsupported dimension kind; preserveSource retains original bytes, not an edited round-trip.'); return; }
            const ds = dimStyles.get(String(get(r, 3, 'STANDARD')));
            const dim = (code, headerName, fallback) => ds ? get(ds, code, header[headerName]?.[0]?.value ?? fallback) : header[headerName]?.[0]?.value ?? fallback;
            const scale = Number(dim(40, '$DIMSCALE', 1)) || 1;
            append({ ...common, type: TYPE.DIMENSION, anchor: a, dimension: { kind, flags: get(r, 70), points: Array.from({ length: 7 }, (_, i) => pt(r, 10 + i)),
                angle: get(r, 50) * DEG, text: decodeDxfText(String(get(r, 1, '<>')), true), precision: dim(271, '$DIMDEC', 2),
                textHeight: dim(140, '$DIMTXT', 2.5) * scale, arrowSize: dim(41, '$DIMASZ', 2.5) * scale,
                extensionOffset: dim(42, '$DIMEXO', .625) * scale, extensionLength: dim(44, '$DIMEXE', 1.25) * scale,
                gap: dim(147, '$DIMGAP', .625) * scale, measureScale: dim(144, '$DIMLFAC', 1), rounding: dim(45, '$DIMRND', 0) } }, r);
        }
        else if (type === 'INSERT' || type === 'DIMENSION') {
            const name = String(get(r, 2, '')), b = blocks.get(name.toUpperCase());
            if (!b) {
                warn('MISSING_BLOCK', `Missing block definitions (including dimensions without cached block graphics) were not rendered.`);
                return;
            }
            if (chain.includes(name.toUpperCase()) || chain.length >= 48) {
                warn('CYCLIC_BLOCK', 'Cyclic/excessively nested INSERT references were rejected.');
                return;
            }
            const rows = Math.max(1, Math.trunc(get(r, 71, 1))), cols = Math.max(1, Math.trunc(get(r, 70, 1)));
            if (rows * cols > 1e6)
                throw new DxfError('Excessive MINSERT grid.');
            for (let row = 0; row < rows; row++)
                for (let col = 0; col < cols; col++) {
                    const n = type === 'DIMENSION' ? node : { parent: localNode, translation: a, angle: get(r, 50) * DEG };
                    const childNode = type === 'DIMENSION' ? n : { parent: n, translation: [col * get(r, 44), row * get(r, 45)], base: b.base, sx: get(r, 41, 1), sy: get(r, 42, 1) };
                    for (const child of b.records)
                        process(child, childNode, s, chain.concat(name.toUpperCase()));
                    // ATTRIB coordinates belong to the enclosing coordinate system, not
                    // the INSERT's scaled block-local basis. MINSERT offsets rotate but
                    // do not scale. This also handles ATTRIB sequences inside BLOCKs.
                    const angle=get(r,50)*DEG;
                    const attrNode=(row||col)?{parent:{parent:{parent:localNode,angle},translation:[col*get(r,44),row*get(r,45)]},angle:-angle}:node;
                    for(const attr of r.attributes||[]) {
                        const normalized=!attrNode?{...attr,groups:[...attr.groups.filter(g=>g.code!==67&&g.code!==410&&g.code!==330),...r.groups.filter(g=>g.code===67||g.code===410||g.code===330)]}:attr;
                        processEntity(normalized,attrNode,s,chain.concat(name.toUpperCase()));
                    }
                }
            if (type === 'DIMENSION')
                warn('DIMENSION_BLOCK', 'Dimensions use their supplied anonymous block graphics; dimension constraints are not regenerated.');
        }
        else if (type === 'SOLID' || type === 'TRACE' || type === '3DFACE') {
            const b = pt(r, 11), c = pt(r, 12), d = pt(r, 13);
            const ordered = type === '3DFACE' ? [a, b, c, d] : [a, b, d, c];
            for (const t of [[ordered[0], ordered[1], ordered[2]], [ordered[0], ordered[2], ordered[3]]])
                append({ ...common, type: TYPE.TRIANGLE, anchor: t[0], p: [t[1][0] - t[0][0], t[1][1] - t[0][1], t[2][0] - t[0][0], t[2][1] - t[0][1]] }, r);
        }
        else if (type === 'SPLINE') {
            const xs = all(r, 10), ys = all(r, 20), points = xs.map((x, i) => [x, ys[i] || 0]), knots = all(r, 40), weights = all(r, 41), degree = get(r, 71, 3);
            if (!Number.isInteger(degree) || degree < 1 || degree > 31 || weights.some(w => w <= 0) || ((weights.length !== 0) && (weights.length !== points.length)) || !(knots[points.length] > knots[degree]) || points.length <= degree || knots.length !== points.length + degree + 1 || knots.some((v, i) => i && v < knots[i - 1])) {
                warn('BAD_SPLINE', 'Invalid, nonpositive-weight, degenerate-knot or degree > 31 splines are rejected (no fit-point reconstruction).');
                return;
            }
            append({ ...common, type: TYPE.SPLINE, anchor: points[0].slice(0, 2), spline: { degree, knots, points, weights: weights.length === points.length ? weights : null } }, r);
        }
        else if (type === 'POINT')
            append({ ...common, type: TYPE.POINT, anchor: a }, r);
        else if (type === 'HATCH') {
            try { const hatch = decodeHatch(r.groups); append({ ...common, type: TYPE.HATCH, anchor: a, hatch }, r); }
            catch (error) { warn('HATCH_INVALID', error.message); }
        }
        else if (!['SEQEND', 'VERTEX', 'ENDBLK', 'VIEWPORT'].includes(type))
            warn('UNSUPPORTED_' + type, `${type} entities are not supported by the 2D kernel.`);
    }
    function flushPoly() { if (!poly)
        return; const r = poly; poly = null; if (block)
        block.records.push(r);
    else if (section === 'ENTITIES')
        process(r); }
    let pendingInsert=null;
    function accept(r){if(block)block.records.push(r);else if(section==='ENTITIES')process(r);}
    function flushInsert(){if(pendingInsert){const r=pendingInsert;pendingInsert=null;accept(r);}}
    for (const r of records(binary ? binaryGroups(input) : asciiGroups(text))) {
        if(pendingInsert) {
            if(r.type==='ATTRIB'){pendingInsert.attributes.push(r);continue;}
            if(r.type==='SEQEND'){flushInsert();continue;}
            flushInsert();
        }
        if (r.type === 'SECTION') {
            flushPoly();
            section = String(get(r, 2, ''));
            if (section === 'HEADER') {
                let key = null;
                for (const g of r.groups) {
                    if (g.code === 9)
                        key = g.value;
                    else if (key)
                        (header[key] ??= []).push(g);
                }
            }
            continue;
        }
        if (r.type === 'ENDSEC') {
            flushPoly();
            section = '';
            block = null;
            continue;
        }
        if (r.type === 'EOF') {
            flushPoly();
            seenEOF = true;
            break;
        }
        if (section === 'HEADER') {
            let key = null;
            for (const g of r.groups) {
                if (g.code === 9)
                    key = g.value;
                else if (key) {
                    (header[key] ??= []).push(g);
                }
            }
            continue;
        }
        catalog.record(r, section);
        if (section === 'TABLES') {
            if (r.type === 'DIMSTYLE') dimStyles.set(String(get(r, 2, 'STANDARD')), r);
            if (r.type === 'LAYER') {
                const name = String(get(r, 2, '0')), i = layerFor(name), flags = get(r, 70);
                layers[i] = { name, color: has(r, 420) ? trueColor(get(r, 420)) : aciColor(get(r, 62, 7)), visible: get(r, 62, 7) >= 0 && !(flags & 1), locked: !!(flags & 4), linetype: String(get(r, 6, 'CONTINUOUS')) };
            }
            if (r.type === 'LTYPE') {
                const name = String(get(r, 2, '')), pattern = all(r, 49);
                ltypes.set(name, pattern);
                if (pattern.length > 2)
                    warn('COMPLEX_LINETYPE', 'Complex linetypes are simplified to their first dash/gap pair.');
            }
            if (r.type === 'STYLE' && get(r, 3, ''))
                warn('FONT_SUBSTITUTION', 'DXF font styles use the single selected engineering/TrueType/SHX font; original per-style fonts are not automatically resolved.');
            continue;
        }
        if (section !== 'BLOCKS' && section !== 'ENTITIES')
            continue;
        if (r.type === 'BLOCK') {
            flushPoly();
            block = { name: String(get(r, 2, '')), base: pt(r), header: r, records: [] };
            blocks.set(block.name.toUpperCase(), block);
            continue;
        }
        if (r.type === 'ENDBLK') {
            flushPoly();
            block = null;
            continue;
        }
        if (r.type === 'POLYLINE') {
            flushPoly();
            poly = { ...r, vertices: [] };
            continue;
        }
        if (r.type === 'VERTEX' && poly) {
            poly.vertices.push(r);
            continue;
        }
        if (r.type === 'SEQEND') {
            flushPoly();
            continue;
        }
        flushPoly();
        if(r.type==='INSERT'&&get(r,66,0)===1){pendingInsert={...r,attributes:[]};continue;}
        accept(r);
    }
    flushInsert();
    if (document) {
        // Some writers store layout entities in the special space BLOCKs rather than ENTITIES.
        for (const b of blocks.values()) if (/^[*$](?:model_space|paper_space)/i.test(b.name)) {
            const h=b.header, paper=/^[*$]paper_space/i.test(b.name), owner=String(get(h,330,''));
            for(const r of b.records) { const handle=String(get(r,5,'')).toUpperCase(); if(handle && rootHandles.has(handle))continue;
                const groups=r.groups.filter(g=>g.code!==67 && g.code!==330);
                groups.push({code:67,value:paper?1:0}); if(owner)groups.push({code:330,value:owner});
                process({...r,groups});
            }
        }
    }
    if (!seenEOF)
        warn('MISSING_EOF', 'The DXF has no EOF marker; complete records before the end were imported.');
    if (!document && !model.count)
        throw new DxfError('No supported drawable entities were found in the selected space.');
    const result = document ? catalog.finish(builders, layers, name, [...diagnostics.values()], { header, sourceCount, binary, space: 'document' }) : model.finish();
    if (!document) result.diagnostics = [...diagnostics.values()];
    if(editMap) {
        const offsets=new Map(),sums=new Map();if(document)for(const [key,builder] of builders){const id=catalog.resolve(key),offset=sums.get(id)||0;offsets.set(key,offset);sums.set(id,offset+builder.count);}result.editRoots=editRoots.map(r=>{const id=document?catalog.resolve(r.key):'model',space=result.spaces?.find(s=>s.id===id);return {...r,spaceId:id,first:r.first+(offsets.get(r.key)||0)+(space?.idBase||0)+1};}).sort((a,b)=>a.first-b.first);
    }
    result.blockCatalog=[...blocks.values()].filter(b=>!(/^[*$](model_space|paper_space)/i.test(b.name))).map(b=>({name:b.name,base:b.base,flags:get(b.header,70,0),count:b.records.length,
        dependencies:[...new Set(b.records.filter(r=>r.type==='INSERT').map(r=>String(get(r,2,''))))],attributes:b.records.filter(r=>r.type==='ATTDEF').map(r=>({tag:String(get(r,2,'')),value:String(get(r,1,'')),flags:get(r,70,0)}))}));
    result.header = header;
    result.sourceCount = sourceCount;
    result.binary = binary;
    result.space = document ? 'document' : space;
    if (preserveSource) result.source = typeof input === 'string' ? { kind: 'text', data: input } : { kind: 'bytes', data: input.slice(0) };
    if (result.missing.length)
        result.diagnostics.push({ code: 'MISSING_GLYPHS', severity: 'warning', count: result.missing.length, message: 'Missing glyphs use an explicit □ placeholder: ' + result.missing.join(' ') });
    return result;
}
/** Parse every layout once into partitioned GPU pages with globally stable IDs. */
export function parseDxfDocument(input, font, options = {}) { return parseDxf(input, font, { ...options, document: true, space: 'all' }); }
/** Export overlays, not a lossless rewrite of the original DXF. */
export function annotationsToDxf(annotations) {
    const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1021', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
    const add = (...v) => lines.push(...v.map(String));
    const safe = s => String(s).replace(/[\r\n]/g, ' ');
    for (const a of annotations) {
        const layer = safe(a.layerName || 'APERTURE_ANNOTATIONS'), color = a.color ?? rgba('#ffb15c'), tc = ((color & 255) << 16) | (color & 0xff00) | ((color >>> 16) & 255), p = a.p || [0, 0, 0, 0], q = a.q || [0, 0, 0, 0];
        const base = t => add(0, t, 8, layer, 420, tc);
        if (a.type === TYPE.TEXT) {
            const text = String(a.text || '');
            if (text.includes('\n')) {
                base('MTEXT');
                add(10, a.anchor[0], 20, a.anchor[1], 40, p[0], 71, 7, 50, (p[2] || 0) / DEG, 1, text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\P'));
            }
            else {
                base('TEXT');
                add(10, a.anchor[0], 20, a.anchor[1], 40, p[0], 41, p[1] || 1, 1, safe(text), 50, (p[2] || 0) / DEG);
            }
        }
        else if (a.type === TYPE.LINE) {
            base('LINE');
            add(10, a.anchor[0], 20, a.anchor[1], 11, a.anchor[0] + p[0], 21, a.anchor[1] + p[1]);
        }
        else if (a.type === TYPE.POLYLINE) {
            base('LWPOLYLINE');
            add(90, a.points.length, 70, (a.flags || 0) & 1);
            for (const point of a.points)
                add(10, point[0], 20, point[1], 42, point[2] || 0);
        }
        else if (a.type === TYPE.ELLIPSE) {
            base('ELLIPSE');
            add(10, a.anchor[0], 20, a.anchor[1], 11, p[0], 21, p[1], 40, p[2], 41, q[0], 42, q[0] + q[1]);
        }
        else if (a.type === TYPE.POINT) {
            base('POINT');
            add(10, a.anchor[0], 20, a.anchor[1]);
        }
        else if (a.type === TYPE.TRIANGLE) {
            base('SOLID');
            add(10, a.anchor[0], 20, a.anchor[1], 11, a.anchor[0] + p[0], 21, a.anchor[1] + p[1], 12, a.anchor[0] + p[2], 22, a.anchor[1] + p[3], 13, a.anchor[0] + p[2], 23, a.anchor[1] + p[3]);
        }
        else if (a.type === TYPE.CLOUD) {
            // Serialize the exact raw scallop endpoints and bulges, never CPU-render them.
            const nx = Math.min(256, Math.max(1, Math.ceil(Math.abs(p[0]) / Math.max(q[0], .01)))), ny = Math.min(256, Math.max(1, Math.ceil(Math.abs(p[1]) / Math.max(q[0], .01))));
            const points = [];
            for (let i = 0; i < nx; i++)
                points.push([p[0] * i / nx, 0]);
            for (let i = 0; i < ny; i++)
                points.push([p[0], p[1] * i / ny]);
            for (let i = 0; i < nx; i++)
                points.push([p[0] * (1 - i / nx), p[1]]);
            for (let i = 0; i < ny; i++)
                points.push([0, p[1] * (1 - i / ny)]);
            base('LWPOLYLINE');
            add(90, points.length, 70, 1);
            for (const point of points)
                add(10, a.anchor[0] + point[0], 20, a.anchor[1] + point[1], 42, .45);
        }
        else
            throw new DxfError('Unsupported annotation export type: ' + a.type);
    }
    add(0, 'ENDSEC', 0, 'EOF');
    return lines.join('\n') + '\n';
}

/** Byte/text preserving round-trip. This does not apply model edits to the DXF document. */
export function originalDxf(model) {
    if (!model.source) throw new DxfError('Load with preserveSource:true to retain the original DXF.');
    return model.source.kind === 'bytes' ? model.source.data.slice(0) : model.source.data;
}
