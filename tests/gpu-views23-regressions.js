/** Real WebGPU regression suite for timing ownership and multi-layout composition. */
async function runViews23GpuRegressions(api) {
    const e=api.engine,d=e.device,checks=[];
    const assert=(v,m)=>{if(!v)throw new Error(m);};
    const settle=async()=>{await d.queue.onSubmittedWorkDone();if(e.pendingFrame){cancelAnimationFrame(e.pendingFrame);e.pendingFrame=0;}e.frameDirty=false;};
    const draw=async()=>{await settle();e.suspended=false;assert(e.render(),'No compute frame');e.suspended=true;await d.queue.onSubmittedWorkDone();};
    const read=async(buffer,size=buffer.size)=>{const dst=d.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const enc=d.createCommandEncoder();enc.copyBufferToBuffer(buffer,0,dst,0,size);d.queue.submit([enc.finish()]);await dst.mapAsync(GPUMapMode.READ);return new Uint8Array(dst.getMappedRange()).slice();}finally{dst.destroy();}};
    const pickPaper=async(x,y)=>e.pick(e.cssWidth/2+(x-e.model.origin[0]-e.camera.x)*e.camera.zoom,e.cssHeight/2-(y-e.model.origin[1]-e.camera.y)*e.camera.zoom,2);
    const save={flags:e.flags,cache:e.planner.cache,batch:e.planner.batch,compaction:e.compaction};
    try{
        e.suspended=true;e.flags=0;e.setCompositing('opaque');e.setPerformance({cache:true,batch:true,compaction:'mask'});
        const model=api.parseDxfDocument(api.layoutFixture,api.font,{name:'multi-layout.dxf'});
        await e.setModel(model);assert(e.activeSpace.name==='General arrangement','Default layout was lost');
        const resident=e.pages.map(p=>p.entities);e.camera={x:105-e.model.origin[0],y:74-e.model.origin[1],zoom:2,angle:0};await draw();
        assert(await pickPaper(30,85)===1,'Model line is missing from first viewport');
        assert(await pickPaper(60,105)===2,'Unfrozen layer missing from first viewport');
        assert(await pickPaper(155,55)===1,'Rotated line missing from second viewport');
        assert(await pickPaper(135,85)===0,'Viewport-frozen layer rendered in detail');
        assert(await pickPaper(18,85)===0,'Model coverage leaked outside rectangular viewport');
        const m=await e.captureMetrics();assert(m.visible===9,'Viewport instance counts must be 4 + 3 + 2 paper entities');assert(m.glyphs===null,'Sheet-instance glyph count must not masquerade as zero');
        checks.push('Paper-space composition renders two resident model viewports, 90-degree twist, frozen layers and clipped coverage with stable pick IDs');
        if(api.captureNative)await api.captureNative('native-paper-layout.png');
        const bytes=e.metrics.bytesUploaded;e.setSpace('model');assert(e.metrics.gpuMs===null,'Old GPU duration survived a layout switch');assert(e.metrics.bytesUploaded===bytes,'Layout switch uploaded geometry');
        assert(e.pages.every((p,i)=>p.entities===resident[i]),'Layout switch replaced resident entity buffers');e.camera={x:-e.model.origin[0],y:-e.model.origin[1],zoom:2,angle:0};await draw();
        assert(await e.pick(e.cssWidth/2,e.cssHeight/2,2)===1,'Model view failed after shared viewport queues');
        checks.push('Layout switching reuses every entity GPUBuffer and invalidates old timing and visibility state');
        e.setSpace('layout:Equipment detail');e.camera={x:105-e.model.origin[0],y:74-e.model.origin[1],zoom:2,angle:0};await draw();
        const v=model.spaces.find(s=>s.name==='Equipment detail').viewports.find(v=>v.number!==1);
        const ref=api.layoutReference.viewports.find(r=>r.handle===v.handle),point=ref.points.find(p=>p.model[0]===30&&p.model[1]===0);
        assert(await pickPaper(point.paper[0],point.paper[1])===1,'Nonzero viewport target/center/twist differs from independent reference');
        checks.push('Paper viewport target, view-center offset and 30-degree rotation agree with independent model-to-paper matrix');
        e.setSpace('layout:Empty sheet');e.camera={x:105-e.model.origin[0],y:74-e.model.origin[1],zoom:2,angle:0};await draw();const empty=await read(e.basePixelBuffer);assert(!empty.some(Boolean),'Empty layout retained previous layout coverage');assert((await e.captureMetrics()).visible===0,'Empty layout retained counters');
        checks.push('Empty layout clears preceding drawing coverage and returns zero visible candidates');
        e.setNamedView(model.namedViews.find(v=>v.supported));await draw();assert(e.activeSpace.id==='model','Named model view opened wrong space');const angle=e.camera.angle;
        assert(Math.abs(angle+Math.PI/6)<1e-8,'Named view twist has wrong sign');const before=e.worldAt(137,201);e.zoomAt(137,201,1.3);const after=e.worldAt(137,201);assert(before.every((x,i)=>Math.abs(x-after[i])<1e-8),'Rotated zoom drifts under pointer');
        let rejected=false;try{e.setNamedView(model.namedViews.find(v=>!v.supported));}catch{rejected=true;}assert(rejected,'Unsupported perspective view silently rendered');
        checks.push('Named views preserve rotation and cursor-centered zoom; unsupported projection is explicitly rejected');
        await draw();const actual=await e.captureMetrics({force:true});if(e.hasTimestamps){assert(Number.isFinite(actual.gpuMs)&&actual.gpuMs>=0&&actual.gpuMs<60000,'Real compute interval is invalid: '+JSON.stringify(actual));
            const data=await read(e.queryResolve,16),ticks=new BigUint64Array(data.buffer);assert(ticks[0]>0n&&ticks[1]>=ticks[0],'Same-pass endpoints not written');assert(Math.abs(actual.gpuMs-Number(ticks[1]-ticks[0])/1e6)<1e-6,'GPU UI metric differs from exact uint64 subtraction');
            const original=e.queryResolve,bad=d.createBuffer({size:256,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});
            try{e.queryResolve=bad;d.queue.writeBuffer(bad,0,new BigUint64Array([0n,615296880540000n]));const invalid=await e.captureMetrics({force:true});assert(invalid.gpuMs===null&&invalid.gpuTimingStatus==='unwritten-timestamp','Reported uptime was accepted');}
            finally{e.queryResolve=original;bad.destroy();}
            checks.push('Real nonempty-pass timestamps equal uint64 delta / 1e6; injected 615296880.54 ms uptime is rejected as unwritten');
        }
        await draw();const pending=e.captureMetrics({force:true});e.setSpace('layout:Empty sheet');await pending;assert(e.metrics.gpuMs===null&&e.metrics.measuredFrame===-1,'Stale asynchronous metrics overwrote a newly selected space');
        checks.push('An asynchronous counter readback from a previous space cannot publish into the new view');
        const large='0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n1000000000.125\n20\n2000000000.25\n11\n1000000001.125\n21\n2000000000.25\n0\nLINE\n67\n1\n410\nSheet\n10\n5\n20\n5\n11\n20\n21\n5\n0\nENDSEC\n0\nEOF\n';
        await e.setModel(api.parseDxfDocument(large,api.font));e.setSpace('model');e.camera={x:.5,y:0,zoom:150,angle:0};await draw();assert(await e.pick(e.cssWidth/2,e.cssHeight/2,2)===1,'Large-coordinate document lost rebased line');assert(Math.abs((e.extents[2]-e.extents[0])-1)<.01,'Per-space finite bounds lost large-coordinate precision');
        e.setSpace('layout:Sheet');await draw();assert(await e.pick(e.cssWidth/2,e.cssHeight/2,2)===2,'Small paper coordinates contaminated by model origin');
        checks.push('Independent space origins preserve billion-unit Model precision without contaminating millimeter-scale paper coordinates');
        assert(!e.errors.length,e.errors.join('\n'));return checks;
    }finally{await settle();e.flags=save.flags;e.setPerformance(save);e.suspended=true;}
}
