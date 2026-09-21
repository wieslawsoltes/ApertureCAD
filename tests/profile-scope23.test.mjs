import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tool=fileURLToPath(new URL('../tools/compare-profiles.mjs',import.meta.url));
function compare(a,b){const dir=mkdtempSync(path.join(tmpdir(),'aperture-profile-'));try{
 const base={schema:'aperture-release-profile/2',status:'passed',version:'2.3.0',adapter:{vendor:'test'},width:64,height:64,frames:1,warmup:0,quality:'exact',startedAt:'2026-09-18',cases:[]};
 const paths=[path.join(dir,'a.json'),path.join(dir,'b.json')];[a,b].forEach((r,i)=>writeFileSync(paths[i],JSON.stringify({...base,...r})));
 return spawnSync(process.execPath,[tool,'--baseline',paths[0],'--candidate',paths[1],'--output',path.join(dir,'out.json')],{encoding:'utf8'});
}finally{rmSync(dir,{recursive:true,force:true});}}
test('Release comparison rejects legacy clearing-inclusive versus corrected compute-only timing',()=>{
 const result=compare({gpuTimingScope:'legacy-rendering-with-clears'},{gpuTimingScope:'compute-pass'});
 assert.notEqual(result.status,0);assert.match(result.stderr,/timestamp scopes differ/);
});
test('Release comparison rejects unavailable timing even when an old numeric value is present',()=>{
 const profile={gpuTimingScope:'compute-pass',cases:[{name:'invalid',samples:[{gpuMs:615296880.54,gpuTimingStatus:'unwritten-timestamp'}]}]};
 const result=compare(profile,profile);assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid GPU timing status/);
});
