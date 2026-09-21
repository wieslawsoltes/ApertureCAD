/** Actual GPU integration probes. Invoked only after a real WebGPU adapter initializes.
 * Deliberate geometry/framebuffer readbacks are test instrumentation, not frame-path work.
 * No renderer stubs, generated screenshots, or CPU raster fallback are used.
 */
async function runGpuRegressions(api) {
    const e=api.engine,device=e.device,checks=[];
    const assert=(condition,message)=>{if(!condition)throw new Error(message);};
    const settle=async()=>{await device.queue.onSubmittedWorkDone();if(e.pendingFrame){cancelAnimationFrame(e.pendingFrame);e.pendingFrame=0;}e.frameDirty=false;};
    const draw=async()=>{await settle();e.suspended=false;assert(e.render(),'Expected actual GPU frame submission');e.suspended=true;await device.queue.onSubmittedWorkDone();};
    const read=async(buffer,offset=0,size=buffer.size)=>{const target=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try{const command=device.createCommandEncoder();command.copyBufferToBuffer(buffer,offset,target,0,size);device.queue.submit([command.finish()]);await target.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(target.getMappedRange()).slice();target.unmap();return bytes;}finally{target.destroy();}};
    const old={font:api.font,flags:e.flags,compositing:e.compositing,cache:e.planner.cache,batch:e.planner.batch};
    try {
        e.suspended=true;await settle();e.setCompositing('opaque');e.flags=0;
        const builder=new api.ModelBuilder(api.font,{name:'GPU queue equivalence'});
        for(let i=0;i<257;i++){const x=(i%20)*10,y=Math.floor(i/20)*10;builder.line([x,y],[x+2,y+1]);builder.text('AV',x,y+3,.7);}
        await e.setModel(builder.finish());e.camera={x:100,y:65,zoom:1};
        e.setPerformance({cache:false,batch:false});await draw();const reference=await read(e.basePixelBuffer);
        e.setPerformance({cache:false,batch:true});await draw();const optimized=await read(e.basePixelBuffer);
        assert(reference.length===optimized.length&&reference.every((v,i)=>v===optimized[i]),'Batched and cooperative coverage must be byte-identical');
        const counters=await e.captureMetrics();assert(counters.batchEntities>0,'The equivalence scene must exercise the small-entity queue');
        checks.push('Batched/cooperative GPU coverage equality on partial workgroups');
        e.setPerformance({cache:true,batch:true});await draw();e.selected=1;await draw();
        assert(e.metrics.baseRasterized===false&&e.metrics.overlayRasterized===false,'Selection must reuse opaque coverage');
        assert(e.metrics.cullPasses===0,'Selection must not execute visibility kernels');
        checks.push('Selection resolve reuses actual GPU coverage without culling or rasterization');
        e.pan(2,1);await draw();assert(e.metrics.visibilityCacheHits>0,'Small pan must reuse a guarded visible queue');
        checks.push('Guard-band visibility survives a conservative pan');
        const start=e.metrics.bytesUploaded;await e.patchEntities([{id:1,color:api.rgba('#ff1100')}]);
        assert(e.metrics.bytesUploaded-start===8,'Color-only patch uploads two four-byte style words');
        const first=new Uint32Array((await read(e.pages[0].entities,0,128)).buffer);
        assert(first[17]===api.rgba('#ff1100'),'GPU source record must contain the edit');
        checks.push('Eight-byte color edit updates actual GPU record and style table without rebuilding geometry');
        // A small independent compute resolve target permits an exact source-over pixel check.
        const alpha=new api.ModelBuilder(api.font,{name:'GPU ordered alpha'});
        for(const color of [0x800000ff,0x8000ff00])alpha.add({type:api.TYPE.TRIANGLE,anchor:[-10,-10],p:[40,0,0,40],color});
        await e.setModel(alpha.finish());e.camera={x:0,y:0,zoom:8};e.setCompositing('exact');await draw();
        const rgbaTexture=device.createTexture({size:[e.canvas.width,e.canvas.height],format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
        const target=device.createBuffer({size:256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try{
            const resources={0:e.frameBuffer,1:e.pixelBuffer,2:e.styleBuffer,3:e.layerBuffer,4:rgbaTexture.createView(),8:e.fragmentBuffer,9:e.basePixelBuffer};
            const group=device.createBindGroup({layout:e.pipelines.resolveExact.getBindGroupLayout(0),entries:[0,2,3,4,8].map(binding=>({binding,resource:binding===4?resources[binding]:{buffer:resources[binding]}}))});
            const command=device.createCommandEncoder(),pass=command.beginComputePass();pass.setPipeline(e.pipelines.resolveExact);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(e.canvas.width/8),Math.ceil(e.canvas.height/8));pass.end();
            command.copyTextureToBuffer({texture:rgbaTexture,origin:[Math.floor(e.canvas.width/2),Math.floor(e.canvas.height/2),0]},{buffer:target,bytesPerRow:256},{width:1,height:1,depthOrArrayLayers:1});device.queue.submit([command.finish()]);
            await target.mapAsync(GPUMapMode.READ);const pixel=new Uint8Array(target.getMappedRange()).slice(0,4);target.unmap();const a=128/255,bg=[.035,.047,.065];
            const expected=[a*(1-a)+bg[0]*(1-a)**2,a+bg[1]*(1-a)**2,bg[2]*(1-a)**2].map(v=>Math.round(v*255));
            assert(expected.every((v,i)=>Math.abs(v-pixel[i])<=1),'GPU source-over must match ordered encoded-RGB reference: '+pixel+' vs '+expected);
            assert(!(await e.captureMetrics()).fragmentOverflow,'Two-triangle test must not overflow fragments');
        } finally {target.destroy();rgbaTexture.destroy();}
        checks.push('GPU ordered source-over agrees with an independent interior-pixel reference');
        e.setCompositing('opaque');e.suspended=false;await api.loadFeatures();e.suspended=true;await draw();
        assert((await e.captureMetrics()).visible>0,'Feature gallery must produce visible candidates');
        checks.push('GPU pattern hatch and dimension feature gallery executes');
        const stroke=api.parseStrokeFont('*0,4,Original GPU fixture\n10,2,0,0\n*65,14,A\n8,0,10,8,6,0,8,0,-10,2,8,2,0,0\n');
        await e.setFont(stroke);const text=new api.ModelBuilder(stroke,{name:'GPU SHP glyph compilation'});text.text('AAA',0,0,12);await e.setModel(text.finish());await draw();
        const ink=new Uint32Array((await read(e.basePixelBuffer)).buffer);assert(ink.some(v=>v!==0),'GPU-compiled stroke glyph must create coverage');
        checks.push('GPU SHP bytecode compilation, atlas bake and text rasterization');
        assert(e.errors.length===0,'Uncaptured GPU validation errors: '+e.errors.join('\n'));
        return checks;
    } finally {
        await settle();e.suspended=true;await e.setFont(old.font);e.setCompositing(old.compositing);e.setPerformance(old);e.flags=old.flags;e.suspended=false;await api.loadDemo();
    }
}
