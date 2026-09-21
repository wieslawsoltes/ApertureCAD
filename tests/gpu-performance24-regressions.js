/** Actual-device paper-cache, tiled diagnostics and timestamp-only regression suite. */
async function runPerformance24GpuRegressions(api) {
    const e=api.engine,d=e.device,checks=[];
    const assert=(v,m)=>{if(!v)throw new Error(m);};
    const same=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
    const settle=async()=>{await d.queue.onSubmittedWorkDone();if(e.pendingFrame){cancelAnimationFrame(e.pendingFrame);e.pendingFrame=0;}e.frameDirty=false;};
    const draw=async()=>{await settle();e.suspended=false;assert(e.render(),'Missing compute frame');e.suspended=true;await d.queue.onSubmittedWorkDone();};
    const read=async(buffer,size=buffer.size)=>{const out=d.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});try{const c=d.createCommandEncoder();c.copyBufferToBuffer(buffer,0,out,0,size);d.queue.submit([c.finish()]);await out.mapAsync(GPUMapMode.READ);return new Uint8Array(out.getMappedRange()).slice();}finally{out.destroy();}};
    const ink=()=>read(e.basePixelBuffer);
    const save={flags:e.flags,budget:e.options.paperCacheBudget,memory:e.options.memoryBudget,cache:e.planner.cache,batch:e.planner.batch,paperCache:e.paperCache};
    const compare=async name=>{const cached=await ink();e.setPerformance({paperCache:false});await draw();assert(same(cached,await ink()),name+' differs from uncached compute coverage');e.setPerformance({paperCache:true});await draw();};
    try {
        e.suspended=true;e.flags=0;e.setCompositing('opaque');e.options.paperCacheBudget=64*1024*1024;e.setPerformance({cache:true,batch:true,paperCache:false});
        await e.setModel(api.parseDxfDocument(api.layoutFixture,api.font));e.camera={x:105-e.model.origin[0],y:74-e.model.origin[1],zoom:2,angle:0};await draw();
        const reference=await ink(),entities=e.pages.map(p=>p.entities);
        e.setPerformance({paperCache:true});await draw();assert(same(reference,await ink()),'Cold cache changes paper coverage');
        assert(e.paperCacheBytes>0&&e.paperCacheBytes<=e.options.paperCacheBudget,'Unbounded cache allocation');assert(e.pages.every((p,i)=>p.entities===entities[i]),'Paper cache duplicated model geometry');
        assert([...e.paperResources.values()].every(v=>v.surface&&[...v.queues.values()].every(q=>q.owned)),'Small fixture did not receive private state');
        checks.push('Paper caches allocate bounded exact-capacity queues and coverage, retain every geometry GPUBuffer and match uncached pixels byte-for-byte');
        const queueBuffers=[...e.paperResources.values()].flatMap(v=>[...v.queues.values()].map(q=>q.visible));
        e.camera.x+=.5;await draw();assert(e.metrics.viewportCoverageHits===2&&e.metrics.viewportRasterized===0,'Integer sheet pan rerasterized local viewport coverage');
        const cachedCounts=await e.captureMetrics();assert(cachedCounts.visible===9,'Coverage hit lost viewport candidates');
        assert(e.metrics.viewportQueueBuilds===0,'Coverage hit rebuilt queues');assert([...e.paperResources.values()].flatMap(v=>[...v.queues.values()].map(q=>q.visible)).every((q,i)=>q===queueBuffers[i]),'Pan replaced private queues');
        await compare('Integer paper pan');checks.push('Integer-pixel sheet pan copies two exact cached viewports without culling/rasterization and preserves candidate counts and queue identities');
        e.camera.x+=.1375;await draw();assert(e.metrics.viewportRasterized===2&&e.metrics.viewportCoverageHits===0,'Subpixel pan falsely reused coverage');assert(e.metrics.viewportQueueHits===2&&e.metrics.viewportQueueBuilds===0,'Subpixel pan rebuilt guarded viewport queues');
        await compare('Fractional paper pan');checks.push('Fractional sheet pan rerasterizes at exact subpixel phase while reusing GPU visibility and indirect arguments');
        e.camera.zoom*=1.05;await draw();assert(e.metrics.viewportQueueBuilds===2,'Zoom reused view-dependent batching');await compare('Zoomed paper');
        e.camera.x+=70;await draw();await compare('Clipped paper pan');checks.push('Zoom and clipped-viewport extent changes invalidate classification/coverage and match uncached output');
        e.camera={x:105-e.model.origin[0],y:74-e.model.origin[1],zoom:2,angle:0};await draw();
        await e.patchEntities([{id:1,anchor:[7,3]}]);await draw();assert(e.metrics.viewportQueueBuilds===2&&e.metrics.viewportCoverageHits===0,'Model edit failed to invalidate sheet instances');await compare('Edited model instances');
        checks.push('Fixed-record model edits invalidate every related sheet instance while retaining shared geometry and exact coverage');
        const idx=e.layers.findIndex(l=>l.name==='FROZEN');if(idx>=0){e.updateLayer(idx,{visible:false});await draw();await compare('Layer visibility');e.updateLayer(idx,{visible:true});}
        const detail=e.activeSpace.viewports.find(v=>v.number!==1),frozen=detail.frozenLayers;detail.frozenLayers=[...frozen,e.layers[0].name];e.planner.invalidate();await draw();await compare('Viewport frozen layer');detail.frozenLayers=frozen;e.planner.invalidate();await draw();
        checks.push('Global visibility and viewport frozen-layer changes invalidate private palettes and cached paper coverage');
        e.options.paperCacheBudget=0;e.disposePaperResources();e.planner.invalidate();await draw();assert(e.paperCacheBytes===0,'Zero cache budget allocated optional GPU memory');const zero=await ink();
        e.options.paperCacheBudget=64*1024*1024;e.disposePaperResources();e.planner.invalidate();await draw();assert(same(zero,await ink()),'Budget fallback changes coverage');
        const before=e.allocatedBytes();e.options.memoryBudget=before-1;e.trimPaperCaches(0);assert(e.paperCacheBytes===0&&e.paperResources.size===0,'Optional cache was not evicted');e.options.memoryBudget=save.memory;e.planner.invalidate();await draw();
        checks.push('Zero-budget compute fallback is byte-identical; optional caches are evicted before blocking mandatory allocations');
        const budgetBytes=e.metrics.bytesReadback;await draw();assert(e.metrics.bytesReadback===budgetBytes,'Ordinary draw performs a readback');
        if(e.hasTimestamps){
            const measured=e.metrics.measuredFrame,before=e.metrics.bytesReadback,a=e.captureTiming({force:true}),b=e.captureTiming({force:true});assert(a===b,'Concurrent timing requests did not coalesce');const m=await a;
            assert(e.metrics.bytesReadback-before===16,'Timing sample downloads scene counters');assert(m.measuredFrame===measured,'Timing sample pretends counters were refreshed');
            const ticks=new BigUint64Array((await read(e.queryResolve,16)).buffer);assert(Math.abs(m.gpuMs-Number(ticks[1]-ticks[0])/1e6)<1e-6,'Timestamp-only readback differs from uint64 interval');
            const n=e.metrics.bytesReadback;await e.captureTiming();assert(e.metrics.bytesReadback===n,'Duplicate timestamp mapped again');
            checks.push('Timestamp-only sampling coalesces concurrent requests, copies exactly 16 bytes, retains counter generation and equals the actual uint64 interval');
            const original=e.queryResolve,bad=d.createBuffer({size:16,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
            try{e.queryResolve=bad;d.queue.writeBuffer(bad,0,new BigUint64Array([0n,615296880540000n]));const invalid=await e.captureTiming({force:true});assert(invalid.gpuMs===null&&invalid.gpuTimingStatus==='unwritten-timestamp','Invalid timestamp accepted');}finally{e.queryResolve=original;bad.destroy();}
            await draw();const pending=e.captureTiming({force:true});e.setSpace('layout:Empty sheet');await pending;assert(e.metrics.gpuMs===null&&e.metrics.timingSampleFrame===-1,'Stale timestamp overwrote newly selected sheet');
            checks.push('Timestamp-only path rejects the reported uptime-like sample and cannot publish after a layout-generation change');
        }
        e.flags=2;await e.setModel(api.makeSyntheticModel(api.font,1025,2));await draw();const args=new Uint32Array((await read(e.pages[0].indirect)).buffer);
        assert(args[8]===3,'Diagnostics do not use 512-slot workgroups');const m=await e.captureMetrics({force:true});assert(m.visible===1025&&m.texts===1025&&m.glyphs===12300,'Tiled diagnostics dropped a tail or glyph slot');
        const again=await e.captureMetrics({force:true});assert(again.texts===m.texts&&again.glyphs===m.glyphs,'Tiled diagnostic counts accumulated');
        checks.push('512-slot diagnostic tiles preserve exact 1,025-entity tail counts and 12,300 logical glyph slots (four-character prefix plus eight digits) without accumulation');
        assert(!e.errors.length,e.errors.join('\n'));return checks;
    }finally{await settle();e.flags=save.flags;e.options.paperCacheBudget=save.budget;e.options.memoryBudget=save.memory;e.setPerformance(save);e.suspended=true;}
}
