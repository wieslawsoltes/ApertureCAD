/** Fixed-quality release benchmark. Run each release in a fresh process on the same adapter. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const arg = (name, fallback) => { const i=process.argv.indexOf(name); return i<0?fallback:process.argv[i+1]; };
const root=path.resolve(arg('--root',path.join(import.meta.dirname,'..'))), output=path.resolve(arg('--output',path.join(root,'artifacts/release-profile.json')));
const count=Number(arg('--frames','20')), warmup=Number(arg('--warmup','6'));
const suite=arg('--suite','core');if(!['core','extended'].includes(suite))throw new Error('Invalid suite');
const compaction=arg('--compaction','mask');if(!['mask','scan'].includes(compaction))throw new Error('Invalid compaction');
if(!Number.isInteger(count)||count<2||!Number.isInteger(warmup)||warmup<0)throw new Error('Invalid sample count');
const load = name => import(pathToFileURL(path.join(root,name)).href);
const {ComputeCad,makeSyntheticModel}=await load('packages/gpu/index.js'),{ModelBuilder}=await load('packages/model/index.js'),{makeBuiltinFont}=await load('packages/font/index.js');
const {makeFeatureGallery}=await load('packages/model/features.js');
const native=process.env.DAWN_MODULE?createRequire(import.meta.url)(path.resolve(process.env.DAWN_MODULE)):await import('webgpu');Object.assign(globalThis,native.globals);
globalThis.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);globalThis.cancelAnimationFrame=clearTimeout;
const gpu=native.create(['backend='+(process.env.CAD_BACKEND||'vulkan')]),adapter=await gpu.requestAdapter();if(!adapter)throw new Error('No execution adapter');
const canvas={width:640,height:480,clientWidth:640,clientHeight:480};let device,texture,engine;
const context={configure(o){device=o.device;},getCurrentTexture(){return texture??=device.createTexture({size:[canvas.width,canvas.height],format:'rgba8unorm',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_SRC});}};
const font=makeBuiltinFont(),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const report={schema:'aperture-release-profile/2',version,startedAt:new Date().toISOString(),node:process.version,
 adapter:Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,adapter.info?.[k]||''])),
 width:canvas.width,height:canvas.height,frames:count,warmup,compaction,suite,quality:'Fixed pixels, no adaptive resolution; exact glyphs except the explicitly named density-proxy workload',
 gpuTimingScope:null,timestampScope:null,
 sourceHashes:Object.fromEntries(['packages/gpu/index.js','packages/gpu/shaders.js','packages/gpu/paper-cache.js','packages/performance/index.js'].filter(name=>fs.existsSync(path.join(root,name))).map(name=>[name,createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex')])),cases:[],status:'running'};
async function draw(){if(engine.pendingFrame){cancelAnimationFrame(engine.pendingFrame);engine.pendingFrame=0;}engine.frameDirty=false;engine.suspended=false;const start=performance.now();if(!engine.render())throw new Error('Missing render');engine.suspended=true;const renderReturnMs=performance.now()-start;await device.queue.onSubmittedWorkDone();return {renderReturnMs,completionMs:performance.now()-start};}
async function digest(buffer){const dst=device.createBuffer({size:buffer.size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});try{const enc=device.createCommandEncoder();enc.copyBufferToBuffer(buffer,0,dst,0,buffer.size);device.queue.submit([enc.finish()]);await dst.mapAsync(GPUMapMode.READ);const bytes=Buffer.from(dst.getMappedRange());const hash=createHash('sha256').update(bytes).digest('hex');dst.unmap();return hash;}finally{dst.destroy();}}
function summary(a){a=a.filter(v=>typeof v==='number'&&Number.isFinite(v));if(!a.length)return {count:0,available:false};a=[...a].sort((x,y)=>x-y);return {count:a.length,min:a[0],median:a[Math.ceil(a.length*.5)-1],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)};}
function lines(n=32768){const b=new ModelBuilder(font,{name:'Release comparison lines'});for(let i=0;i<n;i++){let x=(i%256)*3,y=Math.floor(i/256)*3;b.line([x,y],[x+1,y+.5]);}return b.finish();}
function text(){const b=new ModelBuilder(font,{name:'Release comparison exact labels'});for(let i=0;i<2048;i++){let x=(i%64)*18,y=Math.floor(i/64)*9;b.text('V-'+i,x,y,3);}return b.finish();}
function paper(){
 const m=lines(32768);m.name='Two cached paper viewports / 32,768 shared lines';
 const model={id:'model',name:'Model',kind:'model',order:0,origin:[0,0],pageIndices:m.pages.map((_,i)=>i),count:m.count,idBase:0,viewports:[]};
 const sheet={id:'layout:Benchmark',name:'Benchmark',kind:'paper',order:1,origin:[0,0],pageIndices:[],count:0,idBase:m.count,paperSize:[460,200],viewports:[]};
 sheet.viewports=[110,350].map((x,i)=>({id:'profile-view-'+i,number:i+2,name:'View '+i,kind:'viewport',center:[x,100],width:200,height:125,status:1,
     viewCenter:[0,0],direction:[0,0,1],target:[384,192,0],viewHeight:500,twist:i?Math.PI/12:0,flags:0,frozenLayers:[],spaceId:sheet.id,supported:true}));
 m.spaces=[model,sheet];m.initialSpace=sheet.id;return m;
}
try{
 engine=new ComputeCad(canvas,{pixelRatio:1,maxPixels:640*480});engine.suspended=true;await engine.initializeAdapter(font,adapter,context);report.gpuTimingScope=engine.metrics.gpuTimingScope || 'legacy-rendering-with-clears';report.timestampScope=report.gpuTimingScope==='compute-pass'?'Nonempty CAD compute pass only; excludes native clears, uploads, diagnostic readback, queue wait and presentation':'Legacy encoded rendering interval including native clears; excludes uploads and diagnostic readbacks';report.requestedCompaction=compaction;report.compaction=engine.compaction || 'scan';
 const workloads=[
  ['lines-full-cull',()=>lines(),false,0,'pan'],['lines-cached-pan',()=>lines(),true,0,'pan'],
  ['exact-text-full-cull',text,false,0,'pan'],['exact-text-cached-pan',text,true,0,'pan'],
  ['density-text-100k',()=>makeSyntheticModel(font,100000,2),false,2,'pan'],
  ['feature-gallery',()=>makeFeatureGallery(font),true,0,'pan'],['selection-resolve',()=>lines(),true,0,'select']
 ];
 if(suite==='extended')workloads.push(['paper-integer-pan',paper,true,0,'paper-integer'],['paper-fractional-pan',paper,true,0,'paper-fractional'],['paper-zoom',paper,true,0,'paper-zoom']);
 for(const [name,make,cache,flags,trace]of workloads){
  engine.flags=flags;engine.setPerformance({cache,batch:true,compaction});const before=performance.now();await engine.setModel(make());const preparationMs=performance.now()-before;if(trace.startsWith('paper-'))engine.camera={x:230,y:100,zoom:1,angle:0};const camera={...engine.camera};const samples=[];
  for(let i=-warmup;i<count;i++){
   const t=Math.max(0,i)/(count-1);
   if(trace==='paper-integer'){engine.camera.x=camera.x+Math.round(Math.sin(t*Math.PI*2)*24);engine.camera.y=camera.y+Math.round(Math.sin(t*Math.PI*4)*4);}
   else if(trace==='paper-fractional'){engine.camera.x=camera.x+Math.max(0,i)*.173;engine.camera.y=camera.y+Math.max(0,i)*.071;}
   else if(trace==='paper-zoom'){engine.camera.zoom=camera.zoom*(1+Math.sin(t*Math.PI*2)*.025);}
   else if(trace==='pan'){engine.camera.x=camera.x+Math.sin(t*Math.PI*2)*40/camera.zoom;engine.camera.y=camera.y+Math.sin(t*Math.PI*4)*8/camera.zoom;}
   else engine.selected=1+Math.max(0,i);
   const uploaded=engine.metrics.bytesUploaded,iterationStart=performance.now(),host=await draw(),sampleStart=performance.now(),m=await engine.captureMetrics();const telemetryWallMs=performance.now()-sampleStart,iterationWallMs=performance.now()-iterationStart;
   if(m.fragmentOverflow)throw new Error('Incomplete frame');
   if(i>=0&&(!Number.isFinite(m.gpuMs)||m.gpuMs<0||(report.gpuTimingScope==='compute-pass'&&!['valid','below-resolution'].includes(m.gpuTimingStatus))))throw new Error('Invalid GPU timestamp sample: '+(m.gpuTimingStatus || 'unavailable'));
   if(i>=0)samples.push({cpuMs:m.cpuMs,gpuMs:m.gpuMs,gpuTimingStatus:m.gpuTimingStatus || 'legacy-unvalidated',gpuTimingScope:report.gpuTimingScope,...host,telemetryWallMs,iterationWallMs,uploadedBytes:engine.metrics.bytesUploaded-uploaded,dispatches:m.dispatches,clearCommands:m.clearCommands??null,cullPasses:m.cullPasses,visible:m.visible,texts:m.texts,proxyTexts:m.proxyTexts,viewportCoverageHits:m.viewportCoverageHits??0,viewportQueueBuilds:m.viewportQueueBuilds??null,viewportQueueHits:m.viewportQueueHits??0,paperCacheBytes:m.paperCacheBytes??0,executedRasterWorkgroups:m.executedRasterWorkgroups});
  }
  const coverageSHA256=await digest(engine.basePixelBuffer);
  report.cases.push({name,entityCount:engine.model.count,cache,flags,trace,preparationMs,coverageSHA256,samples,
   gpuMs:summary(samples.map(s=>s.gpuMs)),cpuMs:summary(samples.map(s=>s.cpuMs)),completionMs:summary(samples.map(s=>s.completionMs)),telemetryWallMs:summary(samples.map(s=>s.telemetryWallMs)),iterationWallMs:summary(samples.map(s=>s.iterationWallMs)),uploadedBytes:samples.reduce((n,s)=>n+s.uploadedBytes,0),
   readbackPool:engine.readbacks?{allocations:engine.readbacks.allocations,reuses:engine.readbacks.reuses,bytes:engine.readbacks.bytes}:null});
  console.log(version,name,'GPU',report.cases.at(-1).gpuMs.median,'CPU',report.cases.at(-1).cpuMs.median,'upload',report.cases.at(-1).uploadedBytes);
 }
 if(engine.errors.length)throw new Error(engine.errors.join('\n'));report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};console.error(error);process.exitCode=1;}
finally{engine?.dispose();texture?.destroy();report.finishedAt=new Date().toISOString();fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
process.exit(process.exitCode||0);
