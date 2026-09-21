import { ModelBuilder, TYPE, FLAGS, rgba } from '../model/index.js';
const clone = x => structuredClone(x);
export class AnnotationStore extends EventTarget {
    constructor({ limit = 100 } = {}) { super(); if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new RangeError('Annotation history limit must be 1–10,000.'); this.items = []; this.undoStack = []; this.redoStack = []; this.limit = limit; this.preview = null; }
    changed(kind = 'items') { this.dispatchEvent(new CustomEvent('change', { detail: { kind } })); }
    transaction(mutator) { const before = clone(this.items); try { mutator(this.items); } catch (error) { this.items = before; throw error; } this.undoStack.push(before); if (this.undoStack.length > this.limit)
        this.undoStack.shift(); this.redoStack = []; this.preview = null; this.changed(); }
    add(entities, { label = 'Annotation', author = 'Local reviewer' } = {}) { const item = { id: crypto.randomUUID(), label, author, createdAt: new Date().toISOString(), entities: entities.map(validateEntity) }; this.transaction(items => items.push(item)); return item.id; }
    remove(id) { if (!this.items.some(x => x.id === id))
        return; this.transaction(items => items.splice(items.findIndex(x => x.id === id), 1)); }
    undo() { if (!this.undoStack.length)
        return; this.redoStack.push(clone(this.items)); this.items = this.undoStack.pop(); this.preview = null; this.changed(); }
    redo() { if (!this.redoStack.length)
        return; this.undoStack.push(clone(this.items)); this.items = this.redoStack.pop(); this.preview = null; this.changed(); }
    setPreview(entities) { if (!entities && !this.preview)
        return; this.preview = entities; this.changed('preview'); }
    clear() { this.transaction(items => items.splice(0)); }
    build(font, baseModel, layer) {
        const builder = new ModelBuilder(font, { name: 'Annotations', origin: baseModel.origin, idBase: baseModel.count, pageSize: 2048 });
        const mapping = [];
        for (const item of this.items)
            for (const e of item.entities) {
                builder.add({ ...e, layer: e.measurement ? layer + 1 : layer, flags: (e.flags || 0) | FLAGS.ANNOTATION });
                mapping.push(item.id);
            }
        this.mapping = mapping;
        return builder.finish();
    }
    buildPreview(font, baseModel, layer) { const count = this.items.reduce((n, item) => n + item.entities.length, 0); const builder = new ModelBuilder(font, { name: 'Transient review preview', origin: baseModel.origin, idBase: baseModel.count + count, pageSize: 64 }); for (const e of this.preview || [])
        builder.add({ ...e, layer, flags: (e.flags || 0) | FLAGS.ANNOTATION }); return builder.finish(); }
    itemForEntity(id, baseCount) { return this.items.find(x => x.id === this.mapping?.[id - baseCount - 1]) || null; }
    toJSON() { return { format: 'aperture-annotations', version: 1, items: clone(this.items) }; }
    load(value) { if (value?.format !== 'aperture-annotations' || value.version !== 1 || !Array.isArray(value.items))
        throw new Error('Not an Aperture annotations file.'); if (value.items.length > 8192)
        throw new Error('Too many annotation groups.'); let count = 0; const items = value.items.map(item => { if (!Array.isArray(item.entities))
        throw new Error('Invalid annotation group.'); count += item.entities.length; if (count > 65534)
        throw new Error('Annotation entity limit exceeded.'); return { id: typeof item.id === 'string' ? item.id : crypto.randomUUID(), label: String(item.label || 'Annotation').slice(0, 200), author: String(item.author || '').slice(0, 200), createdAt: String(item.createdAt || ''), entities: item.entities.map(validateEntity) }; }); this.transaction(() => { this.items = items; }); }
}
export function validateEntity(e) { if (!e || ![TYPE.LINE, TYPE.ELLIPSE, TYPE.POLYLINE, TYPE.TEXT, TYPE.TRIANGLE, TYPE.POINT, TYPE.CLOUD].includes(e.type))
    throw new Error('Unsupported annotation entity.'); const finite = a => Array.isArray(a) && a.every(x => typeof x === 'number' && Number.isFinite(x) && Number.isFinite(Math.fround(x))); if (!finite(e.anchor) || e.anchor.length !== 2)
    throw new Error('Annotation anchor must contain two finite coordinates.'); for (const key of ['p', 'q', 'r'])
    if (e[key] && (!finite(e[key]) || e[key].length !== 4))
        throw new Error('Invalid annotation parameter ' + key); if (e.points && (!Array.isArray(e.points) || e.points.length > 4096 || e.points.some(p => !finite(p) || p.length < 2 || p.length > 4)))
    throw new Error('Invalid annotation path.'); if (e.type === TYPE.POLYLINE && (!e.points || e.points.length < 2))
    throw new Error('An annotation path needs at least two points.'); if (e.type === TYPE.TEXT && String(e.text || '').length > 16384)
    throw new Error('Annotation text exceeds the GPU run limit.'); return { type: e.type, anchor: clone(e.anchor), p: clone(e.p || [0, 0, 0, 0]), q: clone(e.q || [0, 0, 0, 0]), r: clone(e.r || [0, 0, 0, 0]), points: e.points ? clone(e.points) : undefined, text: e.type === TYPE.TEXT ? String(e.text || '') : undefined, color: e.color === undefined ? rgba('#ffb05c') : Number(e.color) >>> 0, flags: Number(e.flags || 0) >>> 0, measurement: !!e.measurement }; }
export class LocalWorkspace {
    async open() { return new Promise((resolve, reject) => { const request = indexedDB.open('aperture-cad', 1); request.onupgradeneeded = () => request.result.createObjectStore('workspaces'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
    async save(value) { const db = await this.open(); try {
        await new Promise((resolve, reject) => { const tx = db.transaction('workspaces', 'readwrite'); tx.objectStore('workspaces').put(value, 'last'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    }
    finally {
        db.close();
    } }
    async load() { const db = await this.open(); try {
        return await new Promise((resolve, reject) => { const request = db.transaction('workspaces').objectStore('workspaces').get('last'); request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); });
    }
    finally {
        db.close();
    } }
}
