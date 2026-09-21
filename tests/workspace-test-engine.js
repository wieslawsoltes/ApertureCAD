/** TEST ONLY: controller/DOM boundary double; never shipped or used by the application.
 * These tests exercise file import workers and UI state, not GPU rendering. Real GPU
 * coverage and timing use the separate Dawn test harness. */
class WorkspaceTestEngine extends EventTarget {
    constructor(canvas){super();this.canvas=canvas;this.metrics={cpuMs:0,gpuMs:null,gpuTimingStatus:'not-sampled',bytesUploaded:0,bytesReadback:0,frames:0};this.camera={x:0,y:0,zoom:1,angle:0};this.options={pixelRatio:1,memoryBudget:768*1024*1024};this.ratio=1;this.annotationPages=[];this.previewPages=[];this.flags=2;this.settings={curveTolerance:.25,strokeWidth:1};this.planner={cache:true,batch:true,guardBand:.25};this.compaction='mask';this.compositing='opaque';this.sceneEpoch=0;this.fontRevision=0;this.info={description:'UI TEST DOUBLE — no GPU rendering'};this.errors=[];this.device={queue:{onSubmittedWorkDone:async()=>{}}};this.layers=[];this.pages=[];this.gpuBytes=0;this.cssWidth=640;this.cssHeight=480;}
    async initialize(font){this.font=font;}
    async setFont(font){this.font=font;}
    async setModel(model){this.model=model;this.layers=structuredClone(model.layers);this.annotationLayer=this.layers.length;this.layers.push({name:'Review',visible:true,color:0xffffffff});this.pages=model.pages;this.sceneEpoch++;this.selected=0;this.setSpace(model.initialSpace || 'model');}
    async reconcileModel(model){const camera={...this.camera},id=this.activeSpace?.id;await this.setModel(model);if(id&&model.spaces.some(s=>s.id===id))this.setSpace(id);this.camera=camera;this.metrics.blockPagesReused=0;this.metrics.blockEntityUploadBytes=model.pages.reduce((n,p)=>n+p.entities.byteLength+p.aux.byteLength,0);}
    selectEntities(ranges){this.selectionRanges=ranges;}
    async snap(){return this.snapResult||null;}
    updateBlockPreview(values){this.lastBlockPreview=values;this.metrics.blockPreviewUploadBytes=32*this.previewPages.length;}
    setSpace(id){this.activeSpace=this.model?.spaces?.find(s=>s.id===id);if(this.model?.spaces&&!this.activeSpace)throw new Error('Unknown space');this.camera={x:0,y:0,zoom:1,angle:0};this.sceneEpoch++;this.resetTiming();}
    setNamedView(v){this.setSpace(v.kind==='viewport'?'model':v.spaceId);}
    resetTiming(){Object.assign(this.metrics,{gpuMs:null,gpuTimingStatus:'not-sampled',measuredFrame:-1});}
    updateLayer(i,values){Object.assign(this.layers[i],values);}
    async setAnnotations(model){this.annotationModel=model;this.annotationPages=model.pages;this.previewPages=[];}
    async setPreview(model){this.previewModel=model;this.previewPages=model.pages;}
    setPerformance(p){Object.assign(this.planner,p);}
    async setCompositing(mode){this.compositing=mode;}
    setSize(w,h){this.canvas.width=w;this.canvas.height=h;this.cssWidth=w;this.cssHeight=h;}
    fit(){this.camera={x:0,y:0,zoom:1,angle:0};}
    requestFrame(){}
    render(){this.metrics.frames++;return true;}
    async captureMetrics(){this.dispatchEvent(new CustomEvent('metrics',{detail:this.metrics}));return this.metrics;}
    async pick(){return 0;}
    describe(){return null;}
    worldAt(x,y){return[x,y];}
    pan(){}
    zoomAt(){}
    disposeScene(){this.model=null;this.pages=[];this.sceneEpoch++;}
    dispose(){}
}
globalThis.WorkspaceTestEngine=WorkspaceTestEngine;
// UUID API is secure-context-only. This deterministic test identity avoids pretending
// about:blank is secure; it is never included in production scripts.
if(!crypto.randomUUID){let id=0;crypto.randomUUID=()=>`00000000-0000-4000-8000-${String(++id).padStart(12,'0')}`;}
