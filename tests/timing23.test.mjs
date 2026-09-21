import test from 'node:test';import assert from 'node:assert/strict';
import {decodeGpuInterval,formatGpuTiming}from'../packages/performance/timing.js';
import {readFileSync}from'node:fs';
test('Nanosecond conversion subtracts uint64 values before lossy Number conversion',()=>{
 const start=(1n<<62n)+17n;assert.deepEqual(decodeGpuInterval(start,start+12500123n),{gpuMs:12.500123,gpuTimingStatus:'valid'});
});
test('Reported 615296880.54 ms uptime cannot enter GPU duration telemetry',()=>{
 const end=615296880540000n;assert.equal(decodeGpuInterval(0n,end).gpuTimingStatus,'unwritten-timestamp');
 const bad=decodeGpuInterval(1n,end);assert.equal(bad.gpuMs,null);assert.equal(formatGpuTiming(bad),'—');
});
test('Missing, reversed, invalid and impossible endpoints are unavailable rather than zero or clamped',()=>{
 for(const [a,b]of[[0n,0n],[1n,0n],[2n,1n],[-1n,2n],[1,2],[1n,1n<<64n]])assert.equal(decodeGpuInterval(a,b).gpuMs,null);
 assert.equal(decodeGpuInterval(1n,10000000001n,{wallUpperBoundMs:5}).gpuTimingStatus,'inconsistent-clock');
});
test('Equal written timestamps are a below-resolution result, not an invented duration',()=>{
 assert.deepEqual(decodeGpuInterval(100n,100n),{gpuMs:0,gpuTimingStatus:'below-resolution'});assert.equal(formatGpuTiming(decodeGpuInterval(100n,100n)),'<0.01');
});
test('Formatting requires validated status and never displays stale numeric fields',()=>{
 for(const gpuMs of[NaN,Infinity,-1,615296880.54])assert.equal(formatGpuTiming({gpuMs,gpuTimingStatus:'unsupported'}),'—');
 assert.equal(formatGpuTiming({gpuMs:12.345,gpuTimingStatus:'valid'}),'12.35');
});
test('Query resolution belongs to the same submission as both nonempty-pass endpoints',()=>{
 const s=readFileSync(new URL('../packages/gpu/index.js',import.meta.url),'utf8');
 assert.match(s,/beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1/);
 const render=s.slice(s.indexOf('    render('),s.indexOf('    async captureMetrics('));assert.ok(render.includes('encoder.resolveQuerySet(this.querySet'));
 const capture=s.slice(s.indexOf('    async captureMetrics('),s.indexOf('    setSpace('));assert.ok(!capture.includes('resolveQuerySet('));assert.match(capture,/epoch !== this.sceneEpoch/);
});
