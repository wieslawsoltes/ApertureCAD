/** Real-device v2.2 regression tests. Shared by Dawn native and browser integration. */
async function runPerformance22GpuRegressions(api) {
    const e=api.engine,d=e.device,checks=[];
    const assert=(value,message)=>{if(!value)throw new Error(message);};
    const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
    const settle=async()=>{await d.queue.onSubmittedWorkDone();if(e.pendingFrame){cancelAnimationFrame(e.pendingFrame);e.pendingFrame=0;}e.frameDirty=false;};
    const draw=async()=>{await settle();e.suspended=false;assert(e.render(),'Missing frame');e.suspended=true;await d.queue.onSubmittedWorkDone();};
    const read=async(buffer,size=buffer.size,offset=0)=>{const dst=d.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const enc=d.createCommandEncoder();enc.copyBufferToBuffer(buffer,offset,dst,0,size);d.queue.submit([enc.finish()]);await dst.mapAsync(GPUMapMode.READ);return new Uint8Array(dst.getMappedRange()).slice();}finally{dst.destroy();}};
    const words=async(buffer,size=buffer.size,offset=0)=>new Uint32Array((await read(buffer,size,offset)).buffer);
    const ink=()=>words(e.basePixelBuffer);
    const queues=async()=>{const result=[];for(const p of e.pages){const s=await words(p.stats),v=await words(p.visible);const a=[...v.slice(0,s[4]),...v.slice(p.count-s[5])].sort((x,y)=>x-y);assert(new Set(a).size===a.length,'Duplicate index in visible queue');assert(a.every(x=>x<p.count),'Queue index exceeds page');result.push(a);}return result;};
    const save={flags:e.flags,cache:e.planner.cache,batch:e.planner.batch,guardBand:e.planner.guardBand,compaction:e.compaction};
    try {
        e.suspended=true;await settle();e.setCompositing('opaque');e.flags=0;e.setPerformance({cache:false,batch:true,compaction:'scan'});
        const b=new api.ModelBuilder(api.font,{name:'Mask/scan mixed tail equivalence',pageSize:129,layers:[{name:'Shown',color:api.rgba('#7ad4b7'),visible:true},{name:'Hidden',color:api.rgba('#d4797a'),visible:false}]});
        for(let i=0;i<513;i++){const x=(i%39)*7,y=Math.floor(i/39)*9,layer=i%19===0?1:0;if(i%3===0)b.text('A'+i,x,y,2,layer);else b.add({type:i%3===1?api.TYPE.LINE:api.TYPE.POINT,anchor:[x,y],p:[2,.75,0,0],layer});}
        await e.setModel(b.finish());e.camera={x:135,y:55,zoom:1.6};await draw();const scan=await ink(),scanQueues=await queues(),scanMetrics=await e.captureMetrics();
        e.setPerformance({compaction:'mask'});await draw();const mask=await ink(),maskQueues=await queues(),maskMetrics=await e.captureMetrics();
        assert(same(scan,mask),'Mask/scan coverage mismatch');assert(JSON.stringify(scanQueues)===JSON.stringify(maskQueues),'Mask/scan visible sets differ');assert(scanMetrics.visible===maskMetrics.visible&&scanMetrics.texts===maskMetrics.texts,'Mask/scan diagnostics differ');
        checks.push('Mask versus scan: identical mixed line/point/exact-text coverage and duplicate-free queues across four odd-tail pages with hidden layers');
        e.setPerformance({cache:true,compaction:'mask'});await draw();const args=await Promise.all(e.pages.map(p=>words(p.indirect)));
        e.camera.x+=.1;await draw();assert(e.metrics.cullPasses===0&&e.metrics.indirectBuilds===0,'Cached pan rebuilt queues/arguments');assert(e.metrics.indirectCacheHits===e.pages.length,'Missing cached arguments');
        for(let i=0;i<args.length;i++)assert(same(args[i],await words(e.pages[i].indirect)),'Cached indirect arguments changed');
        assert(e.metrics.frameUniformBytes<=16,'Pan uploaded more than camera span');e.camera.zoom*=1.01;await draw();assert(e.metrics.cullPasses===e.pages.length,'Zoom did not rebuild classification');
        await e.captureMetrics();checks.push('Cached pan reuses all indirect buffers, uploads at most 16 bytes, and zoom invalidates every page');
        let before=e.metrics.bytesUploaded;await e.patchEntities([{id:2,color:api.rgba('#f2476a')}]);assert(e.metrics.bytesUploaded-before===8&&e.metrics.editUploadCalls===2,'Color patch is not two four-byte writes');await draw();assert(!e.metrics.baseRasterized,'Color patch rerasterized geometry');
        const style=await words(e.styleBuffer,8,16),record=await words(e.pages[0].entities,128,128);assert(style[0]===api.rgba('#f2476a')&&record[17]===style[0],'Sparse color writes disagree');
        const cachedSample=await e.captureMetrics();assert(cachedSample.telemetryDispatches===0,'Resolve-only frame repeated text diagnostics');
        checks.push('Eight-byte color edit updates both GPU tables and reuses stationary base coverage and text diagnostics');
        const oldVisible=(await e.captureMetrics()).visible;before=e.metrics.bytesReadback;await e.patchEntities([{id:2,layer:1}]);assert(e.metrics.bytesReadback===before,'Layer-only patch read geometry back');await draw();assert(e.metrics.cullPasses===1,'Layer-only patch invalidated unrelated queues');assert((await e.captureMetrics()).visible===oldVisible-1,'Layer patch did not remove entity');
        checks.push('Layer-only edit performs no geometry readback and rebuilds only the affected visibility queue');
        before=e.metrics.bytesReadback;const uploaded=e.metrics.bytesUploaded;
        await e.patchEntities([{id:4,anchor:[30,20]},{id:5,anchor:[35,20]},{id:6,anchor:[40,20]}]);
        assert(e.metrics.editUploadCalls===1&&e.metrics.bytesUploaded-uploaded===384,'Adjacent source records did not coalesce');assert(e.metrics.bytesReadback-before===16,'One edited page returned more than one root');
        const updated=new Float32Array((await read(e.pages[0].entities,384,384)).buffer);assert(updated[0]===30&&updated[32]===35&&updated[64]===40,'Coalesced GPU anchors mismatch');
        await draw();assert(e.metrics.cullPasses===1,'Geometry patch rebuilt unaffected visibility pages');
        checks.push('Three adjacent geometry edits use one 384-byte upload, one 16-byte page-root readback, and page-local visibility invalidation');
        const t=new api.ModelBuilder(api.font,{name:'Text diagnostic and matrix cache'});for(let i=0;i<33;i++)t.text('TEXT'+i,(i%11)*20,Math.floor(i/11)*20,4);
        await e.setModel(t.finish());e.flags=0;await draw();let counts=await words(e.pages[0].stats);assert(counts[1]===0&&counts[2]===0&&counts[3]===0,'Rasterization still updated text telemetry');
        let m=await e.captureMetrics();assert(m.texts===33&&m.proxyTexts===0&&m.glyphs>0&&m.telemetryDispatches===1,'Explicit text sampling failed');const readBytes=e.metrics.bytesReadback;
        const duplicate=await e.captureMetrics();assert(e.metrics.bytesReadback===readBytes&&duplicate.measuredFrame===m.measuredFrame,'Duplicate frame caused another readback');
        const forced=await e.captureMetrics({force:true});assert(forced.texts===m.texts&&forced.glyphs===m.glyphs,'Repeated sampling accumulated counters');
        checks.push('Rasterization does not write text counters; on-demand exact-text diagnostics are idempotent and duplicate captures do not map again');
        await e.patchEntities([{id:1,p:[4,1.2,.4,.2]}]);const textMatrix=(await words(e.pages[0].entities,128)).slice(12,16);
        await e.patchEntities([{id:1,anchor:[5,7]}]);assert(same(textMatrix,(await words(e.pages[0].entities,128)).slice(12,16)),'Repeated prepare compounded text transform');
        assert(new Float32Array((await read(e.pages[0].entities,128)).buffer)[4]===4,'Source text parameters overwritten');
        checks.push('GPU-prepared text basis survives repeated geometry edits without compounding or overwriting source parameters');
        await draw();await e.measure([0,0],[3,4]);const allocations=e.readbacks.allocations;
        for(let i=0;i<6;i++){const measure=await e.measure([i,0],[i+3,4]);assert(Math.abs(measure[0]-5)<1e-5,'Pooled readback measurement corrupt');}
        assert(e.readbacks.allocations===allocations&&e.readbacks.reuses>=6,'Query readbacks allocate repeatedly');assert(e.readbacks.entries.every(s=>!s.busy&&s.buffer.mapState==='unmapped'),'Lease remained busy/mapped');
        checks.push('Six sequential compute queries reuse native MAP_READ storage with correct results and no retained maps');
        const finite=new api.ModelBuilder(api.font,{name:'Finite page roots with infinite lines'});finite.line([10,20],[20,30]);finite.add({type:api.TYPE.XLINE,anchor:[1e6,1e6],p:[1,0,0,0]});finite.add({type:api.TYPE.RAY,anchor:[-1e6,0],p:[1,1,0,0]});
        await e.setModel(finite.finish());assert(e.extents.every((x,i)=>Math.abs(x-[10,20,20,30][i])<.001),'Infinite primitive poisoned finite page root');
        await draw();assert((await words(e.pages[0].indirect))[8]===0,'Text-free page launches text diagnostics');
        await e.patchEntities([{id:1,anchor:[30,40]}]);assert(e.extents.every((x,i)=>Math.abs(x-[30,40,40,50][i])<.001),'Edited finite root reduction failed');
        checks.push('Hierarchical page-root reduction excludes XLINE/RAY sentinels while retaining finite geometry in the same leaf');
        const points=[[0,0],[50,0],[50,30],[0,30],[0,0]],family={angle:Math.PI/4,base:[0,0],offset:[-4,4],dashes:[8,-3,0,-2]};
        const h=new api.ModelBuilder(api.font,{name:'Prepared rational-hatch metadata'});h.add({type:api.TYPE.HATCH,anchor:[0,0],hatch:{solid:false,style:0,families:[family],edges:[{kind:4,flags:1,spline:{degree:1,points,knots:[0,0,1,2,3,4,4],weights:[1,1,1,1,1]}}]}});
        await e.setModel(h.finish());e.camera={x:25,y:15,zoom:5};await draw();const hatchInk=await ink(),aux=await words(e.pages[0].aux),floats=new Float32Array(aux.buffer),source=new Uint32Array(e.pages[0].source.entities),o=source[20],edge=aux[o+4],row=aux[o+5];
        assert(floats[row+7]===13,'Prepared dash period incorrect');assert(same([...floats.slice(edge+11,edge+15)],[0,0,50,30]),'Prepared spline hull incorrect');assert(hatchInk.some(Boolean),'NURBS hatch emitted no coverage');
        const reference=new api.ModelBuilder(api.font);reference.add({type:api.TYPE.HATCH,anchor:[0,0],hatch:{solid:false,style:0,families:[family],edges:points.slice(0,4).map((a,i)=>({kind:1,flags:1,a,b:points[i+1]}))}});
        await e.setModel(reference.finish());e.camera={x:25,y:15,zoom:5};await draw();assert(same(hatchInk,await ink()),'Positive-weight degree-1 hatch differs from line-edge reference');
        checks.push('Prepared hatch dash period and positive-weight rational control hull produce byte-identical coverage to independent line boundaries');
        const base=new api.ModelBuilder(api.font);base.line([-80,-40],[-60,-40]);await e.setModel(base.finish());e.camera={x:0,y:0,zoom:2};e.setPerformance({cache:true,batch:true});await draw();
        const overlay=new api.ModelBuilder(api.font,{idBase:base.count||e.model.count,origin:e.model.origin});overlay.add({type:api.TYPE.POINT,anchor:[0,0],layer:e.annotationLayer});await e.setAnnotations(overlay.finish());await draw();assert(await e.pick(e.cssWidth/2,e.cssHeight/2)===2,'Overlay not picked');
        await e.setAnnotations(new api.ModelBuilder(api.font,{idBase:e.model.count,origin:e.model.origin}).finish());await draw();assert(!e.metrics.baseRasterized&&!e.metrics.overlayRasterized,'Empty overlay removal redrew coverage');assert((await words(e.pixelBuffer)).some(Boolean),'Test needs deliberately stale overlay storage');assert(await e.pick(e.cssWidth/2,e.cssHeight/2)===0,'Empty-overlay resolver/picker consumed stale data');
        checks.push('Removing the last overlay skips clearing/rasterization and safely ignores stale overlay pixels in resolve and pick');
        assert(!e.errors.length,e.errors.join('\n'));return checks;
    } finally {await settle();e.flags=save.flags;e.setPerformance(save);e.suspended=true;}
}
