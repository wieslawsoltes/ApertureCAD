import { split64 } from '../model/index.js';
function equalBuffer(a,b){if(a===b)return true;if(!a||!b||a.byteLength!==b.byteLength)return false;const x=new Uint32Array(a),y=new Uint32Array(b);for(let i=0;i<x.length;i++)if(x[i]!==y[i])return false;return true;}
export function samePackedPage(a,b,originA,originB){return a.count===b.count&&a.idBase===b.idBase&&a.runCount===b.runCount&&a.runTable===b.runTable&&originA[0]===originB[0]&&originA[1]===originB[1]&&equalBuffer(a.entities,b.entities)&&equalBuffer(a.aux,b.aux);}
/** Transactional page reconciliation. CPU parsing is still explicit, but unchanged
 * entity/auxiliary arenas are NOT uploaded or prepared again. Old scene remains
 * valid until all candidate allocations, GPU preparation and readbacks succeed. */
export async function reconcileBlockModel(e,model,indexBindings){
 if(!e.model||e.model.synthetic)return e.setModel(model);
 if(e.preparing||e.benchmarking||e.disposed)throw new Error('The GPU drawing is busy.');
 if(!model.spaces||model.count>0x00ff0000)throw new RangeError('Invalid block drawing capacity.');
 if(e.selectionRanges?.length)e.selectEntities([]);
 const old={model:e.model,pages:e.pages,layers:e.layers,layerBuffer:e.layerBuffer,styleBuffer:e.styleBuffer},camera={...e.camera},spaceId=e.activeSpace?.id||'model';
 const byBase=new Map(e.pages.map(p=>[p.idBase,p])),keep=new Set(),changed=[],candidates=model.pages.map(source=>{
  const previous=byBase.get(source.idBase),origin=source.origin||model.origin;
  if(previous&&samePackedPage(source,previous.source,origin,previous.source.origin||e.model.origin)){keep.add(previous);return {source,page:previous};}
  changed.push(source);return {source,page:null};
 });
 const layers=[...model.layers.map(l=>({...l})),{name:'Annotations',color:0xff5cb0ff,visible:true},{name:'Measurements',color:0xffd2f27d,visible:true}],styleSize=(model.count+65536)*8,paletteSize=Math.max(16,layers.length*16);
 const newPageBytes=changed.reduce((n,p)=>n+p.count*152+p.aux.byteLength+Math.ceil(p.count/128)*32+176,0),scratch=changed.length?Math.max(...changed.map(p=>p.count))*8+2048+changed.length*16:0;
 const peak=newPageBytes+styleSize+paletteSize+scratch;e.trimPaperCaches(peak);
 if(e.allocatedBytes()+peak>e.options.memoryBudget)throw new Error('Block edit exceeds the GPU budget including transactional old/new resources. The current drawing was kept.');
 const limit=e.device.limits.maxStorageBufferBindingSize;if(styleSize>limit||model.pages.some(p=>p.count*128>limit||p.aux.byteLength>limit))throw new Error('Block edit exceeds this adapter’s storage-buffer limit.');
 let newStyle,newPalette,ranks,buckets,readback;const created=[];let scopes=0,committed=false;e.preparing=true;
 try{
  await e.queryTail.catch(()=>{});
  e.device.pushErrorScope('out-of-memory');e.device.pushErrorScope('validation');scopes=2;
  newStyle=e.buffer('Block edit style table',styleSize,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST);
  const palette=new Uint32Array(paletteSize/4);layers.forEach((l,i)=>palette.set([l.color>>>0,Number(l.visible!==false),Number(!!l.locked),0],i*4));
  newPalette=e.buffer('Block edit layer table',paletteSize,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,palette);
  e.styleBuffer=newStyle;e.layerBuffer=newPalette;
  for(const item of candidates)if(!item.page){item.page=e.makePage(item.source,item.source.origin||model.origin);created.push(item.page);}
  const encoder=e.device.createCommandEncoder({label:'Transactional block page reconciliation'});
  encoder.copyBufferToBuffer(old.styleBuffer,0,newStyle,0,Math.min(old.styleBuffer.size,newStyle.size));
  if(created.length){
   ranks=e.buffer('Block edit ranks',Math.max(...created.map(p=>p.count))*8,GPUBufferUsage.STORAGE);buckets=e.buffer('Block edit buckets',2048,GPUBufferUsage.STORAGE);readback=e.buffer('Block edit page bounds',created.length*16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
   const pass=encoder.beginComputePass({label:'Changed block pages only'});
   for(const p of created){
    if(p.source.runCount){pass.setPipeline(e.pipelines.layoutText);pass.setBindGroup(0,p.groups.layoutText);pass.dispatchWorkgroups(Math.ceil(p.source.runCount/64));}
    for(const entry of ['prepare','reduceBounds']){pass.setPipeline(e.pipelines[entry]);pass.setBindGroup(0,p.groups[entry]);pass.dispatchWorkgroups(entry==='prepare'?p.leaves:1);}
    const resources={0:p.header,1:p.bounds,2:p.order,3:ranks,4:buckets};for(const [entry,bindings] of Object.entries(indexBindings)){pass.setPipeline(e.pipelines[entry]);pass.setBindGroup(0,e.group(entry,resources,bindings));pass.dispatchWorkgroups(entry==='spatialClear'||entry==='spatialScan'?1:p.leaves);}
   }pass.end();created.forEach((p,i)=>encoder.copyBufferToBuffer(p.bounds,(p.count+p.leaves)*16,readback,i*16,16));
  }
  e.device.queue.submit([encoder.finish()]);
  if(readback){await readback.mapAsync(GPUMapMode.READ);const values=new Float32Array(readback.getMappedRange());created.forEach((p,i)=>p.finiteBounds=Array.from(values.subarray(i*4,i*4+4)));readback.unmap();e.metrics.bytesReadback+=created.length*16;}
  const validation=await e.device.popErrorScope();scopes--;const memory=await e.device.popErrorScope();scopes--;if(validation||memory)throw new Error((validation||memory).message);
  // Commit after preparation. Bind-group creation cannot touch the old GPU buffers.
  e.pages=candidates.map(x=>{x.page.source=x.source;return x.page;});e.model=model;e.layers=layers;e.annotationLayer=model.layers.length;
  for(const p of [...e.annotationPages,...e.previewPages])p.destroy();e.annotationPages=[];e.previewPages=[];
  e.viewPages=null;for(const p of e.pages)e.bindPage(p);e.bindPixels();e.setSpace(model.spaces.some(s=>s.id===spaceId)?spaceId:'model',{fit:false});e.camera=camera;e.layerRevision++;e.overlayRevision++;e.planner.invalidate();
  for(const p of old.pages)if(!keep.has(p))p.destroy();old.styleBuffer.destroy();old.layerBuffer.destroy();committed=true;
  Object.assign(e.metrics,{blockPagesReused:keep.size,blockPagesPrepared:created.length,blockEntityUploadBytes:changed.reduce((n,p)=>n+p.entities.byteLength+p.aux.byteLength,0)});
  e.gpuBytes=e.allocatedBytes();e.emit('model',model);return e;
 }catch(error){if(!committed){e.model=old.model;e.pages=old.pages;e.layers=old.layers;e.styleBuffer=old.styleBuffer;e.layerBuffer=old.layerBuffer;for(const p of created)p.destroy();newStyle?.destroy();newPalette?.destroy();}throw error;}
 finally{while(scopes>0){await e.device.popErrorScope();scopes--;}ranks?.destroy();buckets?.destroy();readback?.destroy();e.preparing=false;e.requestFrame();}
}
/** Queues a root transform, consumed once by the next compute frame. */
export function queuePlacement(e,{x=0,y=0,angle=0,scale=1}={}){
 if(![x,y,angle,scale].every(Number.isFinite)||Math.abs(scale)<1e-12)throw new RangeError('Invalid preview placement.');
 for(const p of e.previewPages)if(p.source.placementNode!==undefined){
  const n=p.source.placementNode,data=p.placementData??=new Float32Array(8),[xh,xl]=split64(x),[yh,yl]=split64(y);data.set([scale,scale,angle,0,xh,yh,xl,yl]);
  p.pendingPlacement=true;e.planner.windows.delete(p);p.textSampleValid=false;
 }
 e.overlayRevision++;e.requestFrame();
}
/** One prepare dispatch per changed preview page; no glyph layout, root readback,
 * spatial rebuild, GPU allocation, or full-scene upload during pointer movement. */
export function encodePlacement(e,pass){let count=0;for(const p of e.previewPages)if(p.pendingPlacement){p.pendingPlacement=false;pass.setPipeline(e.pipelines.prepare);pass.setBindGroup(0,p.groups.prepare);pass.dispatchWorkgroups(p.leaves);count++;}return count;}
export function uploadPlacement(e){let bytes=0;for(const p of e.previewPages)if(p.pendingPlacement){e.device.queue.writeBuffer(p.aux,p.source.placementNode*4,p.placementData);bytes+=32;}e.metrics.bytesUploaded+=bytes;e.metrics.blockPreviewUploadBytes=bytes;return bytes;}
