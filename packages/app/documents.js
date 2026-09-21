/** CPU-side document ownership. Only the active document is uploaded to the GPU.
 * File identity is deliberately independent of display name; two files named a.dxf
 * must never share annotations, cameras, layers or undo history. */
export class DocumentWorkspace {
    constructor({ maxDocuments = 32, maxResidentBytes = 1536 * 1024 * 1024 } = {}) {
        if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 1 || !Number.isSafeInteger(maxResidentBytes) || maxResidentBytes < 1)
            throw new RangeError('Invalid document residency limits.');
        this.maxDocuments = maxDocuments; this.maxResidentBytes = maxResidentBytes;
        this.documents = []; this.activeId = null; this.serial = 0;
    }
    get current() { return this.get(this.activeId); }
    get residentBytes() { return this.documents.reduce((n, d) => n + d.residentBytes, 0); }
    get(id) { return this.documents.find(d => d.id === id) || null; }
    static modelBytes(model, sourceFile = null) {
        return (sourceFile?.size || 0) + (model?.source?.data?.byteLength || model?.source?.byteLength || 0) + (model?.pages || []).reduce((n,p)=>
            n + (p.entities?.byteLength || 0) + (p.aux?.byteLength || 0) + (p.handles?.byteLength || 0), 0);
    }
    add(model, { sourceKind = 'dxf', sourceFile = null, font = null, fontFile = null } = {}) {
        if (!model || !Array.isArray(model.pages)) throw new TypeError('A packed drawing model is required.');
        if (this.documents.length >= this.maxDocuments) throw new Error(`Close a drawing before opening more than ${this.maxDocuments} documents.`);
        const residentBytes = DocumentWorkspace.modelBytes(model, sourceFile);
        if (this.residentBytes + residentBytes > this.maxResidentBytes) throw new Error('Open-document CPU storage budget exceeded. Close unused drawings first.');
        const doc = { id: 'document-' + (++this.serial), name: model.name, model, sourceKind, sourceFile, font, fontFile,
            residentBytes, activeSpace: model.initialSpace || 'model', spaceStates: new Map(), layers: null, display: null, dirty: false };
        this.documents.push(doc); return doc;
    }
    activate(id) { const doc = this.get(id); if (!doc) throw new Error('The requested drawing tab is no longer open.'); this.activeId=id; return doc; }
    replaceModel(id, model) {
        const doc=this.get(id); if(!doc) throw new Error('Drawing is closed.');
        const size=DocumentWorkspace.modelBytes(model,doc.sourceFile);
        if(this.residentBytes-doc.residentBytes+size>this.maxResidentBytes) throw new Error('Updated drawing exceeds the CPU storage budget.');
        doc.model=model;doc.name=model.name;doc.residentBytes=size;
    }
    close(id) {
        const index=this.documents.findIndex(d=>d.id===id); if(index<0)return null;
        this.documents.splice(index,1);
        if(this.activeId===id)this.activeId=this.documents[Math.min(index,this.documents.length-1)]?.id || null;
        return this.current;
    }
    spaces(doc=this.current) {
        return doc?.model.spaces || (doc ? [{id:'model',name:'Model',kind:'model',count:doc.model.count,pageIndices:doc.model.pages.map((_,i)=>i),viewports:[]}] : []);
    }
    /** Camera and annotation state belong to a space, not to a transient viewport selection. */
    capture(state, doc=this.current) {
        if(!doc)return;
        doc.activeSpace=state.spaceId || doc.activeSpace;
        doc.spaceStates.set(doc.activeSpace,structuredClone({camera:state.camera,selected:state.selected || 0,
            items:state.items || [],undo:state.undo || [],redo:state.redo || []}));
        if(state.layers)doc.layers=structuredClone(state.layers);
        if(state.display)doc.display=structuredClone(state.display);
    }
    restore(spaceId,doc=this.current) {
        if(!doc)return null;
        return structuredClone(doc.spaceStates.get(spaceId) || {camera:null,selected:0,items:[],undo:[],redo:[]});
    }
}
