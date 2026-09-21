/** CPU serialization benchmark; never presented as GPU rendering throughput.
 * node --expose-gc tools/benchmark-packing.mjs --baseline /path/to/aperture-cad-v2
 */
import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';
import {ModelBuilder} from '../packages/model/index.js';import {makeBuiltinFont} from '../packages/font/index.js';
import {summarizeSamples} from '../packages/performance/index.js';
const root=path.resolve(import.meta.dirname,'..'),at=process.argv.indexOf('--baseline');
const baseline=at>=0?path.resolve(process.argv[at+1]):null,font=makeBuiltinFont(),count=200000;
const profiles=[{name:'current',Builder:ModelBuilder,samples:[]}];
if(baseline)profiles.unshift({name:'v2-baseline-packing',Builder:(await import(pathToFileURL(path.join(baseline,'packages/model/index.js')))).ModelBuilder,samples:[]});
const hashes=new Set();
for(let round=-2;round<7;round++)for(const p of (round%2===0?[...profiles].reverse():profiles)){
    globalThis.gc?.();const t=performance.now(),b=new p.Builder(font,{name:'Serialization benchmark'});
    for(let i=0;i<count;i++)b.line([i%1000,Math.floor(i/1000)],[i%1000+1,Math.floor(i/1000)+.5]);
    const model=b.finish(),ms=performance.now()-t;if(round>=0)p.samples.push(ms);
    const hash=createHash('sha256');for(const page of model.pages){hash.update(new Uint8Array(page.entities));hash.update(new Uint8Array(page.aux));}hashes.add(hash.digest('hex'));
}
if(hashes.size!==1)throw new Error('Packing output changed between profiles');
const report={suite:'cpu-serialization',node:process.version,entityCount:count,rounds:7,warmup:2,ordering:'alternating',explicitGc:!!globalThis.gc,identicalPackedBufferSha256:[...hashes][0],
    caveat:'CPU serialization only. Not GPU frame time. Local process timing, not universal throughput.',profiles:profiles.map(p=>({name:p.name,samplesMs:p.samples,summary:summarizeSamples(p.samples)}))};
fs.writeFileSync(path.join(root,'artifacts/packing-benchmark.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
