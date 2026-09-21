/** Autodesk SHP/SHX container and instruction decoder. No host glyph geometry is evaluated.
 * Binary container details cross-checked against ezdxf (Manfred Moitzi, MIT).
 * Glyph programs execute in stroke.wgsl; supplied font files are never redistributed.
 */
import { packFont } from './index.js';
const decoder = new TextDecoder('windows-1252');
export class StrokeFontError extends Error { constructor(message) { super(message); this.name = 'StrokeFontError'; } }
function check(value, message) { if (!value) throw new StrokeFontError(message); }
function number(token) { const t = String(token).trim().replace(/[()]/g, ''); const n = /^-?0/.test(t) ? parseInt(t, 16) : Number(t); check(Number.isInteger(n), 'Invalid SHP integer: ' + token); return n; }
class Reader {
    constructor(bytes, offset = 0) { this.bytes = bytes; this.offset = offset; }
    byte() { check(this.offset < this.bytes.length, 'Truncated SHX data.'); return this.bytes[this.offset++]; }
    word() { return this.byte() | (this.byte() << 8); }
    signed() { const n = this.byte(); return n > 127 ? n - 256 : n; }
    octant() { const n = this.byte(); return n & 128 ? -(n & 127) : n; }
    string() { const a = []; for (;;) { const n = this.byte(); if (!n) break; a.push(n); check(a.length < 65536, 'Excessive SHX string.'); } return decoder.decode(new Uint8Array(a)); }
    bytesAt(n) { check(Number.isInteger(n) && n >= 0 && this.offset + n <= this.bytes.length, 'Invalid SHX record length.'); const a = this.bytes.subarray(this.offset, this.offset + n); this.offset += n; return a; }
}
function binaryCodes(bytes, unicode) {
    const r = new Reader(bytes), result = [];
    for (;;) {
        const op = r.byte(); result.push(op); if (op === 0) break;
        if ([1, 2, 5, 6, 14].includes(op) || op > 15) continue;
        if (op === 3 || op === 4) result.push(r.byte());
        else if (op === 7) result.push(unicode ? r.word() : r.byte());
        else if (op === 8) result.push(r.signed(), r.signed());
        else if (op === 9 || op === 13) { for (;;) { const x = r.signed(), y = r.signed(); result.push(x, y); if (!x && !y) break; if (op === 13) result.push(r.signed()); } }
        else if (op === 10) result.push(r.byte(), r.octant());
        else if (op === 11) result.push(r.byte(), r.byte(), r.byte(), r.byte(), r.octant());
        else if (op === 12) result.push(r.signed(), r.signed(), r.signed());
        else throw new StrokeFontError('Unsupported SHX opcode: ' + op);
    }
    return result;
}
function readBinary(bytes) {
    const signature = new TextDecoder().decode(bytes.subarray(0, 25));
    check(!signature.startsWith('AutoCAD-86 bigfont'), 'SHX BIGFONT encodings require a separate multibyte font map and are not supported.');
    const shapes = new Map(); let name = 'Local SHX', above = 0, below = 0, mode = 0, encoding = 0, embedding = 0;
    if (/^AutoCAD-86 shapes 1\.[01]/.test(signature)) {
        const r = new Reader(bytes, 0x17); check(r.byte() === 26, 'Invalid SHX signature.');
        const first = r.word(), last = r.word(), count = r.word(), table = [];
        check(count > 0, 'Empty SHX index.'); for (let i = 0; i < count; i++) table.push([r.word(), r.word()]);
        check(table[0][0] === first && table.at(-1)[0] === last, 'Invalid SHX index bounds.');
        for (const [cp, length] of table) { const record = new Reader(r.bytesAt(length)); const glyphName = record.string();
            const data = record.bytesAt(record.bytes.length - record.offset);
            if (cp === 0) { check(data.length >= 4 && data.at(-1) === 0, 'Invalid SHX font metrics.'); [above, below, mode] = data; name = glyphName || name; }
            else shapes.set(cp, { cp, name: glyphName, codes: binaryCodes(data, false) }); }
        check(new TextDecoder().decode(r.bytesAt(3)) === 'EOF', 'Missing SHX EOF.');
    } else if (signature.startsWith('AutoCAD-86 unifont 1.0')) {
        const r = new Reader(bytes, 0x18); check(r.byte() === 26, 'Invalid SHX Unicode signature.');
        const count = r.word(); r.word(); const definitionLength = r.word(), definitionStart = r.offset;
        name = r.string(); above = r.byte(); below = r.byte(); mode = r.byte(); encoding = r.byte(); embedding = r.byte(); check(r.byte() === 0, 'Invalid SHX Unicode metrics.');
        check(r.offset - definitionStart <= definitionLength, 'Invalid SHX Unicode definition size.'); r.bytesAt(definitionLength - (r.offset - definitionStart));
        while (r.offset < bytes.length) { const cp = r.word(), length = r.word(), record = new Reader(r.bytesAt(length)); const glyphName = record.string(); shapes.set(cp, { cp, name: glyphName, codes: binaryCodes(record.bytesAt(record.bytes.length - record.offset), true) }); }
        check(shapes.size === count - 1 || shapes.size === count, 'SHX Unicode record count mismatch.');
    } else throw new StrokeFontError('Unknown SHX signature.');
    return { shapes, name, above, below, mode, encoding, embedding };
}
function readAscii(text) {
    const records = []; let record;
    for (let line of text.split(/\r?\n/)) { line = line.split(';')[0].trim(); if (!line) continue;
        if (line.startsWith('*')) { const m = /^\*([^,]+),\s*([^,]+),\s*(.*)$/.exec(line); check(m, 'Malformed SHP record.'); record = { key: m[1].trim(), declared: number(m[2]), name: m[3], text: '' }; records.push(record); }
        else { check(record, 'SHP instructions precede a definition.'); record.text += ',' + line; }
    }
    const shapes = new Map(); let name = 'Local SHP', above = 0, below = 0, mode = 0, encoding = 0, embedding = 0;
    for (const r of records) { check(r.key !== 'BIGFONT', 'SHP BIGFONT is not supported.'); const codes = r.text.split(',').filter(t => t.replace(/[()\s]/g, '')).map(number);
        check(codes.at(-1) === 0, 'Unterminated SHP record: ' + r.key);
        if (r.key === 'UNIFONT' || r.key === '0') { [above, below, mode] = codes; name = r.name; if (r.key === 'UNIFONT') { encoding = codes[3]; embedding = codes[4]; } }
        else { const cp = number(r.key); check(cp >= 0 && cp <= 0x10ffff && !shapes.has(cp), 'Invalid or duplicate SHP character.'); shapes.set(cp, { cp, name: r.name, codes }); }
    }
    return { shapes, name, above, below, mode, encoding, embedding };
}
/** Canonical fixed-width instructions. Compound opcodes remain conditionally atomic. */
export function decodeStrokeProgram(codes) {
    const instructions = []; let i = 0, verticalOnly = false, ended = false;
    const take = () => { check(i < codes.length && Number.isInteger(codes[i]), 'Truncated stroke instruction.'); return codes[i++]; };
    const add = (op, args = []) => instructions.push([op, ...args, ...Array(6 - args.length).fill(0), Number(verticalOnly)]);
    while (i < codes.length) {
        const op = take(); check(op >= 0 && op <= 255 && op !== 15, 'Invalid stroke opcode.');
        if (op === 0) { add(0); ended = true; break; }
        if (op === 14) { verticalOnly = true; continue; }
        if (op > 15) add(16, [op >> 4, op & 15]);
        else if ([1, 2, 5, 6].includes(op)) add(op);
        else if (op === 3 || op === 4) { const f = take(); check(f > 0 && f <= 255, 'Invalid stroke scale factor.'); add(op, [f]); }
        else if (op === 7) add(op, [take()]);
        else if (op === 8) add(op, [take(), take()]);
        else if (op === 9 || op === 13) { for (;;) { const x = take(), y = take(); if (!x && !y) break; add(op === 9 ? 8 : 12, op === 9 ? [x, y] : [x, y, take()]); } }
        else if (op === 10) add(op, [take(), take()]);
        else if (op === 11) add(op, [take(), take(), take(), take(), take()]);
        else if (op === 12) add(op, [take(), take(), take()]);
        verticalOnly = false;
    }
    check(ended, 'Unterminated stroke program.'); return instructions;
}
export function parseStrokeFont(input, { name, vertical = false, maxGlyphs = 4096, maxEdges = 1000000, cellSize = 64 } = {}) {
    check(typeof input === 'string' || input instanceof ArrayBuffer || ArrayBuffer.isView(input), 'Expected SHP text or an SHX/SHP byte buffer.');
    const bytes = typeof input === 'string' ? null : new Uint8Array(input.buffer || input, input.byteOffset || 0, input.byteLength);
    const ascii = typeof input === 'string' || !new TextDecoder().decode(bytes.subarray(0, 10)).startsWith('AutoCAD-86');
    const font = ascii ? readAscii(typeof input === 'string' ? input : new TextDecoder().decode(bytes)) : readBinary(bytes);
    check(font.above > 0 && font.above <= 65535, 'A stroke font requires a positive cap height.');
    check(font.encoding === 0, 'Only single-byte/Unicode stroke fonts are supported, not packed multibyte encodings.');
    check(font.shapes.size > 0 && font.shapes.size <= maxGlyphs, 'Stroke glyph count exceeds the configured limit.');
    const definitions = [...font.shapes.values()], index = new Map(definitions.map((d, i) => [d.cp, i + 1]));
    // A small original missing-glyph box also executes on the GPU.
    definitions.unshift({ cp: 0xfffd, name: '.notdef', codes: [8, 0, font.above, 8, Math.round(font.above * .6), 0, 8, 0, -font.above, 8, -Math.round(font.above * .6), 0, 2, 8, Math.round(font.above * .8), 0, 0] });
    const programs = definitions.map(d => decodeStrokeProgram(d.codes));
    for (const program of programs) for (const op of program) if (op[0] === 7) { check(index.has(op[1]), 'Missing stroke subshape: ' + op[1]); op[1] = index.get(op[1]); }
    const counts = new Map();
    function edges(g, chain = new Set()) {
        check(!chain.has(g) && chain.size < 32, 'Cyclic or excessively deep stroke subshape.'); if (counts.has(g)) return counts.get(g);
        const next = new Set(chain); next.add(g); let n = 0;
        for (const op of programs[g]) { if (op[7] && !vertical) continue; if (op[0] === 7) n += edges(op[1], next); else if ([8, 10, 11, 12, 16].includes(op[0])) n++; }
        check(n <= 65536, 'A stroke glyph exceeds the edge budget.'); counts.set(g, n); return n;
    }
    let total = 0; const glyphs = definitions.map((_, i) => { const edgeCapacity = edges(i); total += edgeCapacity; return { edges: [], edgeCapacity, box: [-.15, -.4, 1.2, 1.3], advance: .8, mode: 0, stroke: .025 }; });
    check(total <= maxEdges, 'Stroke font exceeds the aggregate edge budget.');
    const words = new Int32Array(programs.length * 4 + programs.reduce((s, p) => s + p.length * 8, 0)); let offset = programs.length * 4;
    programs.forEach((program, i) => { words.set([offset, program.length, glyphs[i].edgeCapacity, 0], i * 4); for (const op of program) { words.set(op, offset); offset += 8; } });
    const map = new Map(definitions.map((d, i) => [d.cp, i])); map.set(0xfffd, 0);
    return packFont({ name: name || font.name, map, glyphs, missing: [], kind: 'stroke-program', strokeProgram: new Uint32Array(words.buffer), capHeight: font.above,
        vertical, embedding: font.embedding, cellSize, diagnostics: [], sourceFormat: ascii ? 'shp' : 'shx' });
}
