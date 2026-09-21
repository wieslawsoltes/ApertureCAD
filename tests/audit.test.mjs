import test from 'node:test';
import assert from 'node:assert/strict';
import { ComputeCad } from '../packages/gpu/index.js';
import { AnnotationStore } from '../packages/annotations/index.js';
import { DxfWorkerClient } from '../packages/dxf/client.js';
import { PageBuilder, TYPE, UINT_MAX } from '../packages/model/index.js';
import { makeBuiltinFont } from '../packages/font/index.js';
const font = makeBuiltinFont();
test('Transform-free entity packing and repeated nodes retain GPU ABI', () => {
    const p = new PageBuilder(font, { pageSize: 3 });
    p.add({ type: TYPE.LINE, anchor: [1,2], p: [3,4,0,0] });
    assert.equal(p.u[22], UINT_MAX); assert.equal(p.aux.length, 0);
    const node = { translation: [10,20] }; const first = p.node(node); assert.equal(p.node(node), first); assert.equal(p.aux.length, 16);
});
test('Annotation failed transaction preserves items and redo history', () => {
    const a = new AnnotationStore(); a.add([{type:TYPE.POINT, anchor:[1,2]}]); a.undo();
    const before = a.toJSON(), redo = structuredClone(a.redoStack);
    assert.throws(() => a.transaction(items => { items.push({broken:true}); throw new Error('abort'); }), /abort/);
    assert.deepEqual(a.toJSON(), before); assert.deepEqual(a.redoStack, redo); assert.equal(a.undoStack.length, 0);
});
test('Annotation history rejects unbounded and invalid limits', () => {
    for (const limit of [0, -1, 1.5, Infinity, 10001]) assert.throws(() => new AnnotationStore({limit}), RangeError);
});
test('Same backing-size viewport change invalidates camera coverage and requests a frame', () => {
    const e = new ComputeCad({width:100,height:100}); e.device={limits:{maxTextureDimension2D:8192}}; e.pixelBuffer={};
    Object.assign(e,{cssWidth:100,cssHeight:100,ratio:1}); let frames=0; e.requestFrame=()=>frames++;
    const revision=e.planner.revision; e.setSize(100.1,100.1,1); assert.equal(frames,1); assert.equal(e.planner.revision,revision+1);
    e.setSize(100.1,100.1,1); assert.equal(frames,1);
});
test('Edit scratch allocation is budgeted and partial allocations are destroyed', async () => {
    const e=new ComputeCad({});e.pages=[{count:10}];e.allocatedBytes=()=>0;let calls=0,destroyed=0;
    const previous=globalThis.GPUBufferUsage;globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,MAP_READ:4};
    try { e.buffer=()=>{if(++calls===2)throw new Error('allocation failure');return{destroy(){destroyed++;}};};
        await assert.rejects(e.rebuildPages(e.pages),/allocation failure/);assert.equal(destroyed,1);
        calls=0;e.options.memoryBudget=1;await assert.rejects(e.rebuildPages(e.pages),/budget/);assert.equal(calls,0);
    } finally {globalThis.GPUBufferUsage=previous;}
});
test('Failed initialization destroys acquired device without secure-context spoofing', async () => {
    const e=new ComputeCad({});let destroyed=0;
    const device={addEventListener(){},lost:new Promise(()=>{}),limits:{maxStorageBufferBindingSize:1},destroy(){destroyed++;}};
    const adapter={features:new Set(),limits:{maxStorageBufferBindingSize:1,maxBufferSize:1},requestDevice:async()=>device};
    const previous=globalThis.GPUTextureUsage;globalThis.GPUTextureUsage={STORAGE_BINDING:1,RENDER_ATTACHMENT:2};
    try {await assert.rejects(e.initializeAdapter(font,adapter,{configure(){throw new Error('configuration failure');}}),/configuration failure/);
        assert.equal(destroyed,1);assert.equal(e.initializing,false);assert.equal(e.disposed,true);
    } finally {globalThis.GPUTextureUsage=previous;}
});
function workers(callback) {
    const old=globalThis.Worker,created=[];
    class FakeWorker {constructor(){created.push(this);}postMessage(message){this.message=message;}terminate(){this.terminated=true;}}
    globalThis.Worker=FakeWorker;
    return Promise.resolve().then(()=>callback(created,FakeWorker)).finally(()=>{globalThis.Worker=old;});
}
test('DXF cancellation isolates stale worker callbacks from a replacement request',()=>workers(async created=>{
    const client=new DxfWorkerClient();const first=client.parse(new ArrayBuffer(8),font);const stale=created[0].onmessage;
    const rejected=assert.rejects(first,e=>e.name==='AbortError');const second=client.parse(new ArrayBuffer(8),font);await rejected;
    stale({data:{id:1,model:{wrong:true}}});assert.equal(client.worker,created[1]);
    created[1].onmessage({data:{id:2,model:{correct:true}}});assert.deepEqual(await second,{correct:true});assert.equal(client.worker,null);
}));
test('DXF synchronous postMessage failure terminates the worker and clears pending state',()=>workers(async(created,Worker)=>{
    Worker.prototype.postMessage=()=>{throw new Error('clone failure');};const c=new DxfWorkerClient();
    await assert.rejects(c.parse(new ArrayBuffer(8),font),/clone failure/);assert.equal(c.pending,null);assert.equal(c.worker,null);assert.ok(created[0].terminated);
}));
test('DXF progress callback failure closes its worker',()=>workers(async created=>{
    const c=new DxfWorkerClient();const promise=c.parse(new ArrayBuffer(8),font,{onProgress(){throw new Error('consumer failure');}});
    created[0].onmessage({data:{id:1,progress:{entities:1}}});await assert.rejects(promise,/consumer failure/);assert.equal(c.pending,null);assert.ok(created[0].terminated);
}));
test('DXF invalid input rejects before worker allocation',()=>workers(async created=>{
    await assert.rejects(new DxfWorkerClient().parse(new Uint8Array(8),font),TypeError);assert.equal(created.length,0);
}));
