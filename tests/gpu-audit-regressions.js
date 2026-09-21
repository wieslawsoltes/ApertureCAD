/** Additional real-device regressions; shared by native Dawn and browser harnesses. */
async function runAuditGpuRegressions(api) {
    const e=api.engine,d=e.device,checks=[];
    const assert=(condition,message)=>{if(!condition)throw new Error(message);};
    const settle=async()=>{await d.queue.onSubmittedWorkDone();if(e.pendingFrame){cancelAnimationFrame(e.pendingFrame);e.pendingFrame=0;}e.frameDirty=false;};
    const draw=async()=>{await settle();e.suspended=false;assert(e.render(),'Expected GPU frame');e.suspended=true;await d.queue.onSubmittedWorkDone();};
    const read=async(buffer,size=buffer.size)=>{
        const dst=d.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try{const enc=d.createCommandEncoder();enc.copyBufferToBuffer(buffer,0,dst,0,size);d.queue.submit([enc.finish()]);await dst.mapAsync(GPUMapMode.READ);return new Uint8Array(dst.getMappedRange()).slice();}finally{dst.destroy();}
    };
    const ink=async()=>new Uint32Array((await read(e.basePixelBuffer)).buffer);
    const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
    const save={flags:e.flags,strokeWidth:e.settings.strokeWidth,cache:e.planner.cache,batch:e.planner.batch,ratio:e.options.pixelRatio};
    try {
        e.suspended=true;await settle();e.setCompositing('opaque');e.flags=0;e.setPerformance({cache:false,batch:true});
        // The centerline lies outside both viewport and guard band; only its width overlaps.
        const wide=new api.ModelBuilder(api.font,{name:'Wide line offscreen culling'});
        const x=e.cssWidth*.9;wide.add({type:api.TYPE.LINE,anchor:[x,-30],p:[0,60,e.cssWidth,0]});
        await e.setModel(wide.finish());e.camera={x:0,y:0,zoom:1};await draw();assert((await ink()).some(v=>v!==0),'Visible portion of offscreen wide line was culled');
        const metrics=await e.captureMetrics();assert(metrics.visible===1&&metrics.cooperativeEntities===1,'Wide line must use the cooperative queue');
        checks.push('Offscreen wide-line coverage survives GPU bounds/culling and avoids lane batching');
        // A 2x-DPR marker at the edge of the guard band: radius must include CSS->device scaling.
        e.setPerformance({cache:false,batch:true,guardBand:0});e.setSize(320,240,2);
        const marker=new api.ModelBuilder(api.font,{name:'High-DPR point culling'});marker.add({type:api.TYPE.POINT,anchor:[163.25,0]});
        await e.setModel(marker.finish());e.camera={x:0,y:0,zoom:1};await draw();assert((await ink()).some(v=>v!==0),'High-DPR edge marker was culled');
        checks.push('High-DPR point edge padding is conservative');
        e.setSize(640,480,1);e.setPerformance({cache:false,batch:false,guardBand:.25});
        const pages=new api.ModelBuilder(api.font,{name:'Multi-page queue tails',pageSize:129});
        for(let i=0;i<777;i++){const x=(i%37)*4,y=Math.floor(i/37)*5;pages.line([x,y],[x+1.5,y+.75]);}
        await e.setModel(pages.finish());e.camera={x:74,y:50,zoom:2};await draw();const reference=await ink();
        e.setPerformance({cache:false,batch:true});await draw();assert(same(reference,await ink()),'Multipage tail batching differs');
        const c=await e.captureMetrics();assert(c.visible===777&&c.batchEntities===777,'All multipage entities must be in queues exactly once');
        checks.push('777 entities across seven odd-length pages retain byte-identical batched/cooperative coverage');
        e.camera={x:1e7,y:1e7,zoom:1};await draw();assert((await ink()).every(v=>v===0),'Empty visible queue retained old pixels');assert((await e.captureMetrics()).visible===0,'Empty-view visibility counters not reset');
        checks.push('Zero-visible indirect dispatch clears stale coverage');
        // Real numeric glyphs, not adaptive proxies, must render through both scheduling paths.
        await e.setModel(api.makeSyntheticModel(api.font,129,2));e.flags=0;e.camera.zoom=1;
        e.setPerformance({cache:false,batch:false});await draw();const numeric=await ink();
        e.setPerformance({cache:false,batch:true});await draw();assert(same(numeric,await ink()),'Numeric exact-text paths differ');assert(numeric.some(v=>v!==0),'Numeric exact text produced no coverage');
        assert((await e.captureMetrics()).proxyTexts===0,'Exact numeric test must not use density proxies');
        checks.push('129 unique GPU-generated numeric labels render exact glyphs identically in both paths');
        const edit=new api.ModelBuilder(api.font,{name:'Edit budget transaction'});edit.line([0,0],[10,0]);await e.setModel(edit.finish());await draw();
        const before=await read(e.pages[0].entities,128),budget=e.options.memoryBudget,uploaded=e.metrics.bytesUploaded;
        e.options.memoryBudget=e.allocatedBytes()+1;
        let rejected=false;try{await e.patchEntities([{id:1,anchor:[19,23]}]);}catch(error){rejected=/budget/.test(error.message);}finally{e.options.memoryBudget=budget;}
        assert(rejected,'Insufficient edit scratch must reject');assert(e.metrics.bytesUploaded===uploaded,'Rejected edit must not upload');assert(same(before,await read(e.pages[0].entities,128)),'Rejected edit changed a GPU record');
        checks.push('Insufficient edit budget rejects before changing GPU or host source records');
        e.camera={x:5,y:0,zoom:20};await draw();assert(await e.pick(e.cssWidth/2,e.cssHeight/2,5)===1,'GPU ID pick mismatch');
        const measure=await e.measure([0,0],[3,4]);assert(Math.abs(measure[0]-5)<1e-5,'GPU measurement mismatch');
        checks.push('Actual compute ID picking and 3-4-5 measurement');
        // Committed and preview changes must not rerasterize a stationary base drawing.
        e.setPerformance({cache:true,batch:true});await draw();
        const overlay=new api.ModelBuilder(api.font,{idBase:e.model.count,origin:e.model.origin});overlay.add({type:api.TYPE.POINT,anchor:[5,0],layer:e.model.layers.length});
        await e.setAnnotations(overlay.finish());await draw();assert(!e.metrics.baseRasterized&&e.metrics.overlayRasterized,'Annotation change rerasterized the base');
        checks.push('Committed annotation updates preserve stationary base coverage');
        assert(!e.errors.length,'Uncaptured GPU errors: '+e.errors.join('\n'));
        return checks;
    } finally {
        await settle();e.flags=save.flags;e.settings.strokeWidth=save.strokeWidth;e.setPerformance(save);e.setSize(640,480,save.ratio);e.suspended=true;
    }
}
