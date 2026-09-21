import { explodedRecords, validateExplodable } from '../packages/blocks/explode.js';
import { EDIT_BINDINGS } from '../packages/gpu/edit-tools.js';
import { BlockDrawing,group as blockGroup } from '../packages/blocks/document.js';
import { blockSampleDxf,engineeringLibrary } from '../packages/blocks/library.js';
import { placementPreview } from '../packages/blocks/preview.js';
/** Real Dawn compiler and real offscreen compute execution. No browser policy overrides.
 * DAWN_MODULE=/absolute/path/dawn.node npm run test:wgsl
 * VK_ICD_FILENAMES=/path/to/vk_swiftshader_icd.json npm run test:native
 * Alternatively install optional test dependency: npm install --no-save webgpu@0.6.1
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ComputeCad, makeSyntheticModel, SCENE_BINDINGS, PIXEL_BINDINGS, INDEX_BINDINGS } from '../packages/gpu/index.js';
import { compileKernels, ShaderBuildError } from '../packages/gpu/compiler.js';
import { SHADERS, SHADER_MAPS, SHADER_HASHES } from '../packages/gpu/shaders.js';
import { ModelBuilder, TYPE, rgba } from '../packages/model/index.js';
import { makeBuiltinFont } from '../packages/font/index.js';
import { makeCampus } from '../packages/model/demo.js';
import { makeFeatureGallery } from '../packages/model/features.js';
import { parseStrokeFont } from '../packages/font/stroke.js';
import { parseDxf, parseDxfDocument } from '../packages/dxf/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=new Set(process.argv.slice(2)),execute=args.has('--execute'),stress=args.has('--stress');
const report={suite:execute?'native-webgpu-execution':'native-wgsl-compiler',version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,status:'running',startedAt:new Date().toISOString(),
    node:process.version,backend:process.env.CAD_BACKEND||(execute?'vulkan':'null'),shaderHashes:SHADER_HASHES,
    gpuExecuted:false,checks:[],negativeProbes:[],limitations:['Native offscreen textures do not validate browser canvas presentation.','Software-adapter timings are not hardware-GPU performance claims.']};
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
const out=path.join(root,'artifacts',execute?'native-gpu.json':'native-compiler.json');
let engine,device,texture,gpu;
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
async function negativeProbes(d) {
    const cases={
        'Mixed logical operators are rejected': '@compute @workgroup_size(1) fn main(){let a=true;let b=false;let c=true;let bad=a||b&&c;}',
        'Nonuniform workgroup barrier is rejected': '@compute @workgroup_size(64) fn main(@builtin(local_invocation_index) lane:u32){if(lane==0u){workgroupBarrier();}}',
        'Vector type mismatch is rejected': '@compute @workgroup_size(1) fn main(){let bad:vec2<f32>=vec3<f32>(1.);}'
    };
    for(const [name,code] of Object.entries(cases)) {
        let failure;
        try{await compileKernels(d,{fixture:code},{},{fixture:{main:[]}});}catch(error){failure=error;}
        assert(failure instanceof ShaderBuildError, 'Compiler did not reject negative probe: '+name);
        report.negativeProbes.push({name,status:'passed',diagnostic:failure.details});
    }
    const code='@group(0) @binding(0) var<storage,read_write> values:array<u32>; @compute @workgroup_size(1) fn main(){values[0]=1u;}';
    const {pipelines}=await compileKernels(d,{fixture:code},{},{fixture:{main:[0]}});
    d.pushErrorScope('validation');d.createBindGroup({layout:pipelines.main.getBindGroupLayout(0),entries:[]});
    const error=await d.popErrorScope();assert(error,'Missing-resource binding probe unexpectedly passed');
    report.negativeProbes.push({name:'Missing bind-group resource is rejected',status:'passed',diagnostic:error.message});
}
async function draw() {
    await device.queue.onSubmittedWorkDone();
    if(engine.pendingFrame){cancelAnimationFrame(engine.pendingFrame);engine.pendingFrame=0;}
    engine.frameDirty=false;engine.suspended=false;assert(engine.render(),'Expected GPU submission');engine.suspended=true;
    await device.queue.onSubmittedWorkDone();
}
function crc32(data) {let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function pngChunk(name,data) {const tag=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);}
async function screenshot(name) {
    await draw();const width=engine.canvas.width,height=engine.canvas.height,pitch=Math.ceil(width*4/256)*256;
    const dst=device.createBuffer({size:pitch*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
        const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer:dst,bytesPerRow:pitch},{width,height,depthOrArrayLayers:1});device.queue.submit([encoder.finish()]);
        await dst.mapAsync(GPUMapMode.READ);const mapped=new Uint8Array(dst.getMappedRange()),rows=Buffer.alloc((width*4+1)*height);
        for(let y=0;y<height;y++)rows.set(mapped.subarray(y*pitch,y*pitch+width*4),y*(width*4+1)+1);
        dst.unmap();const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
        const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(rows)),pngChunk('IEND',Buffer.alloc(0))]);
        fs.writeFileSync(path.join(root,'artifacts',name),bytes);
        (report.captures??=[]).push({file:name,width,height,sha256:createHash('sha256').update(bytes).digest('hex'),source:'Actual compute-resolved rgba8unorm texture readback'});
    }finally{dst.destroy();}
}
try {
    let native;
    try {native=process.env.DAWN_MODULE?createRequire(import.meta.url)(path.resolve(process.env.DAWN_MODULE)):await import('webgpu');}
    catch(error){throw new Error('Native validation requires Dawn. Set DAWN_MODULE to dawn.node or install optional test dependency webgpu@0.6.1. '+error.message);}
    Object.assign(globalThis,native.globals);
    if(process.env.DAWN_MODULE)report.dawnBinarySha256=createHash('sha256').update(fs.readFileSync(path.resolve(process.env.DAWN_MODULE))).digest('hex');
    gpu=native.create(['backend='+report.backend]);const adapter=await gpu.requestAdapter();assert(adapter,'No native WebGPU adapter found for '+report.backend);
    report.adapter=Object.fromEntries(['vendor','architecture','device','description'].map(key=>[key,adapter.info?.[key]||'']));
    report.softwareAdapter=/swiftshader|llvmpipe|lavapipe|software|warp/i.test(Object.values(report.adapter).join(' '));
    if(!execute) {
        device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
        const result=await compileKernels(device,SHADERS,SHADER_MAPS,{scene:SCENE_BINDINGS,index:INDEX_BINDINGS,pixels:PIXEL_BINDINGS,font:{bake:[0,1,2]},stroke:{compileStroke:[0,1,2]},edit:EDIT_BINDINGS});
        report.compilation=result.report;await negativeProbes(device);assert(!errors.length,errors.join('\n'));
        report.checks.push('All '+result.report.modules.length+' assembled modules and all '+result.report.pipelines.length+' actual compute pipelines compile and validate');
    } else {
        assert(report.backend!=='null','The null backend cannot execute the GPU regression suite');
        globalThis.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);globalThis.cancelAnimationFrame=clearTimeout;
        const canvas={width:640,height:480,clientWidth:640,clientHeight:480};
        const context={configure(options){device=options.device;},getCurrentTexture(){
            if(texture&&(texture.width!==canvas.width||texture.height!==canvas.height)){texture.destroy();texture=null;}
            return texture??=device.createTexture({label:'Native offscreen presentation',size:[canvas.width,canvas.height],format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});
        }};
        const font=makeBuiltinFont();engine=new ComputeCad(canvas,{pixelRatio:1,maxPixels:640*480});engine.suspended=true;
        await engine.initializeAdapter(font,adapter,context);report.compilation=engine.compilation;
        await negativeProbes(device);
        const api={engine,font,explodedRecords,validateExplodable,BlockDrawing,blockGroup,blockSampleDxf,engineeringLibrary,placementPreview,parseDxfDocument,layoutFixture:fs.readFileSync(path.join(root,'examples/multi-layout.dxf')),layoutReference:JSON.parse(fs.readFileSync(path.join(root,'tests/layout-reference.json'))),captureNative:screenshot,ModelBuilder,TYPE,rgba,parseStrokeFont,makeSyntheticModel,loadDemo:()=>engine.setModel(makeCampus(font)),loadFeatures:()=>engine.setModel(makeFeatureGallery(font))};
        await api.loadDemo();await screenshot('native-campus.png');report.gpuExecuted=true;
        for(const [file,entry] of [['gpu-regressions.js','runGpuRegressions'],['gpu-audit-regressions.js','runAuditGpuRegressions'],['gpu-performance22-regressions.js','runPerformance22GpuRegressions'],['gpu-views23-regressions.js','runViews23GpuRegressions'],['gpu-performance24-regressions.js','runPerformance24GpuRegressions'],['gpu-blocks25-regressions.js','runBlocks25GpuRegressions']]) {
            if(process.argv.includes('--blocks-only')&&!file.includes('blocks25'))continue;
            vm.runInThisContext(fs.readFileSync(path.join(root,'tests',file),'utf8'),{filename:file});
            const checks=await globalThis[entry](api);report.checks.push(...checks);console.log('PASS',file,checks.length);
        }
        const dxf='0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n100\n21\n0\n0\nTEXT\n10\n5\n20\n8\n40\n6\n1\nDXF GPU\n0\nENDSEC\n0\nEOF\n';
        await engine.setModel(parseDxf(new TextEncoder().encode(dxf).buffer,font));await draw();const dxfMetrics=await engine.captureMetrics();
        assert(dxfMetrics.visible===2,'Both parsed DXF records must reach GPU visibility');report.checks.push('Parsed DXF LINE and TEXT complete model upload, preparation and compute rendering');
        await api.loadFeatures();await screenshot('native-feature-gallery.png');
        if(stress){
            for(const count of [100000,1000000]) {
                engine.flags=2;await engine.setModel(makeSyntheticModel(font,count,2));await draw();const metrics=await engine.captureMetrics();
                assert(metrics.visible===count&&metrics.batchEntities+metrics.cooperativeEntities===count,'Stress visibility queues lost or duplicated entities');
                assert(!metrics.fragmentOverflow,'Opaque stress must not overflow fragments');
                (report.stress??=[]).push({count,mode:'GPU-generated unique numeric text; adaptive density proxies enabled',metrics});
                report.checks.push(count.toLocaleString('en-US')+' unique GPU-generated text records execute with exact visible-queue counts');
                console.log('PASS stress',count,'visible',metrics.visible,'GPU ms',metrics.gpuMs);
            }
            await screenshot('native-million-text.png');
        }
        // Fixed workload and fixed resolution. Not a before/after release comparison.
        if(!process.argv.includes('--blocks-only')){const b=new ModelBuilder(font,{name:'Small-entity scheduling benchmark'});
        for(let i=0;i<8192;i++){const x=(i%128)*3,y=Math.floor(i/128)*3;b.line([x,y],[x+1,y+.5]);}
        await engine.setModel(b.finish());engine.flags=0;await draw();
        report.benchmark=await engine.benchmarkProfiles({frames:24,warmup:6,profiles:[{name:'cooperative-scan',cache:false,batch:false,compaction:'scan'},{name:'batched-scan',cache:false,batch:true,compaction:'scan'},{name:'batched-mask',cache:false,batch:true,compaction:'mask'},{name:'batched-mask+cache',cache:true,batch:true,compaction:'mask'}]});
        report.benchmarkContext='Same v2.5 shaders: reference scan/cooperative switches versus optimized mask/batching/cache. Fixed resolution. Native software timings are diagnostic, not hardware qualification.';
        }
        assert(!engine.errors.length,'Uncaptured GPU errors: '+engine.errors.join('\n'));report.uncapturedErrors=[...engine.errors];
    }
    report.status='passed';
}catch(error){report.status='failed';report.error={name:error.name,message:error.message,details:error.details||'',stack:error.stack};if(error.report)report.failedCompilation=error.report;console.error(error,error.details||'');process.exitCode=1;}
finally {
    if(engine)engine.dispose();else device?.destroy();texture?.destroy();
    report.finishedAt=new Date().toISOString();fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(report.status.toUpperCase(),out);
}
// Dawn retains an event-loop reference; explicitly end the CLI after all awaited GPU work and report writes.
process.exit(process.exitCode||0);
