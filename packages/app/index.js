import { BlockWorkbench } from './blocks.js';
import { BlockDrawing } from '../blocks/document.js';
import { DocumentWorkspace } from './documents.js';
import { formatGpuTiming } from '../performance/timing.js';
import { parseStrokeFont } from '../font/stroke.js';
import { ComputeCad, makeSyntheticModel } from '../gpu/index.js';
import { makeBuiltinFont, parseTrueType } from '../font/index.js';
import { makeFeatureGallery } from '../model/features.js';
import { makeCampus } from '../model/demo.js';
import { ModelBuilder, TYPE, FLAGS, rgba, colorHex } from '../model/index.js';
import { DxfWorkerClient } from '../dxf/client.js';
import { annotationsToDxf, parseDxfDocument } from '../dxf/index.js';
import { AnnotationStore, LocalWorkspace } from '../annotations/index.js';
const $ = id => document.getElementById(id), q = s => document.querySelectorAll(s);
const ICONS = { folder: 'M3 6h6l2 2h10v11H3z M3 10h18', save: 'M5 3h12l3 3v15H4V3z M8 3v6h8V3 M8 21v-8h8v8', export: 'M12 16V3 M7 8l5-5 5 5 M4 14v7h16v-7', help: 'M9 8a3 3 0 1 1 4 2.8L12 12v2 M12 17h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', cursor: 'M5 3l14 10-7 1-3 7z', hand: 'M8 12V6a2 2 0 0 1 3 0V4a2 2 0 0 1 3 0v2a2 2 0 0 1 3 0v3a2 2 0 0 1 3 0v7l-4 5H9l-5-8a2 2 0 0 1 3-2z', line: 'M5 19L19 5 M3 17h4v4H3z M17 3h4v4h-4z', rect: 'M4 5h16v14H4z', circle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', text: 'M4 5h16 M12 5v15 M8 20h8', cloud: 'M6 17a4 4 0 0 1-3-6 4 4 0 0 1 4-6 5 5 0 0 1 9-1 4 4 0 0 1 5 6 5 5 0 0 1-4 9 4 4 0 0 1-7 1 4 4 0 0 1-4-3z', ruler: 'M3 16L16 3l5 5L8 21z M7 12l3 3 M11 8l3 3 M15 4l3 3', undo: 'M9 4L4 9l5 5 M4 9h10a6 6 0 0 1 0 12', redo: 'M15 4l5 5-5 5 M20 9H10a6 6 0 0 0 0 12', fit: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6 M8 8h8v8H8z', layers: 'M12 3L2 8l10 5 10-5z M2 12l10 5 10-5 M2 16l10 5 10-5', panel: 'M3 4h18v16H3z M15 4v16', history: 'M3 10a9 9 0 1 1 1 8 M3 4v6h6 M12 7v6l4 2', drawing: 'M6 2h8l5 5v15H6z M14 2v6h5 M9 12h7 M9 16h5', shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z M8 11l3 3 5-6', report: 'M5 3h14v18H5z M9 7h6 M9 11h6 M9 15h6 M9 18h3', chip: 'M6 6h12v12H6z M9 9h6v6H9z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4', grid: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18', pulse: 'M2 12h5l3-8 4 16 3-8h5', close: 'M5 5l14 14 M19 5L5 19', trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7', lock: 'M7 10V7a5 5 0 0 1 10 0v3 M5 10h14v11H5z M12 14v3' };
function icon(name) { return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.chip}"/></svg>`; }
function decorate(root = document) { for (const node of root.querySelectorAll('[data-icon]')) {
    if (node.querySelector('svg'))
        continue;
    node.insertAdjacentHTML('afterbegin', icon(node.dataset.icon));
} }
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = n => Number(n || 0).toLocaleString('en-US'), bytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const waitFrame = () => new Promise(requestAnimationFrame);
let toastTimer;
function toast(message, error = false) { $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, error ? 7500 : 4300); }
function status(message, error = false) { $('status-message').textContent = message; $('status-dot').classList.toggle('error', error); }
function busy(title, detail, cancel = false) { $('busy-title').textContent = title; $('busy-detail').textContent = detail; $('busy').hidden = false; $('cancel-import').hidden = !cancel; }
function hideBusy() { $('busy').hidden = true; }
function showError(error, fatal = false) { console.error(error); status(error.message || String(error), true); if (fatal) {
    $('unsupported').hidden = false;
    $('error-title').textContent = error.message || 'Unable to initialize the GPU';
    $('error-detail').textContent = 'Aperture draws CAD entities exclusively with WebGPU compute shaders. No alternate renderer is substituted.';
    $('error-extra').textContent = error.details || 'Serve the ZIP locally with npm start, or deploy dist/ to an HTTPS host. Check that your browser and graphics driver support WebGPU.';
    $('engine-state').textContent = 'GPU UNAVAILABLE';
}
else
    toast(error.message || String(error), true); hideBusy(); }
function dialog(title, content, eyebrow = 'APERTURE CAD') { $('dialog-title').textContent = title; $('dialog-eyebrow').textContent = eyebrow; $('dialog-content').innerHTML = content; decorate($('dialog')); if (!$('dialog').open)
    $('dialog').showModal(); }
function closeDialog() { $('dialog').close(); }
function download(data, name, type = 'application/json') { const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 15000); }
const canvas = $('cad-canvas'), engine = new ComputeCad(canvas), annotations = new AnnotationStore(), workspace = new LocalWorkspace(), importer = new DxfWorkerClient();
let font = makeBuiltinFont(), fontFile = null, sourceFile = null, sourceKind = 'demo', tool = 'select', ready = false, loading = false, gesture = null, space = false, annotationFrame = 0, annotationBusy = false, annotationDirty = false, annotationCommitDirty = false, lastHover = 0, lastTelemetryFrame = -1, benchmarking = false;
const documents = new DocumentWorkspace();
let documentQueue = Promise.resolve();
const pointers = new Map();
let pinch = null;
const api = { engine, annotations, importer, workspace, saveWorkspace, restoreWorkspace, documents, openFiles, switchDocument, closeDocument, switchSpace, renderTabs, font, ready: null, loadDxf, loadStress, loadDemo, loadFeatures, ModelBuilder, parseDxfDocument, parseStrokeFont, parseTrueType, makeSyntheticModel, TYPE, FLAGS, rgba, version: '2.5.0' };
globalThis.Aperture = api;
const blocks = new BlockWorkbench({ engine, canvas, current:()=>documents.current, font:()=>font, run, enqueue:enqueueDocument,
    dialog, closeDialog, download, toast, setTool, hint:message=>$('tool-hint').textContent=message,
    quiet:quietAnnotations, clearPreview:async()=>{if(engine.model&&!engine.preparing)await engine.setPreview(annotations.buildPreview(font,engine.model,engine.annotationLayer));},
    openDrawing:openBlockDrawing, commit:commitBlockDrawing, prepare:prepareBlockDrawing });
api.blocks=blocks;api.BlockDrawing=BlockDrawing;
function openBlockDrawing(drawing){return enqueueDocument(async()=>{
    if(!ready||loading||benchmarking)throw new Error('The workbench is busy.');loading=true;busy('Opening '+drawing.name,'Retaining block definitions, attributes and editable reference identities.');
    try {const file=new File([drawing.write()],drawing.name,{type:'application/dxf'}),model=await importer.parse(await file.arrayBuffer(),font,{name:drawing.name,document:true,editMap:'inserts'});
        const doc=await useModel(model,{sourceKind:'dxf',sourceFile:file});doc.blockDrawing=drawing;doc.blockPrepared=true;blocks.onDocument();return doc;
    }finally{loading=false;hideBusy();}
});}
function prepareBlockDrawing(drawing){return enqueueDocument(async()=>{if(documents.current?.blockDrawing!==drawing)return;await commitBlockDrawing(drawing,{dirty:false});});}
async function commitBlockDrawing(drawing,{dirty=true}={}){
    const doc=documents.current;if(!doc||doc.blockDrawing!==drawing)throw new Error('The edited drawing is no longer active.');
    const oldModel=doc.model,oldSpace=doc.activeSpace;loading=true;engine.suspended=true;
    busy('Preparing block edit','Parsing source parameters in a worker; retaining unchanged GPU pages.');
    try{await quietAnnotations();snapshotDocument();const model=await importer.parse(new TextEncoder().encode(drawing.write()).buffer,font,{name:doc.name,document:true,editMap:'inserts'});
        const size=DocumentWorkspace.modelBytes(model,doc.sourceFile);if(documents.residentBytes-doc.residentBytes+size>documents.maxResidentBytes)throw new Error('Block edit exceeds the open-document CPU budget.');
        const oldLayers=new Map(engine.layers.slice(0,oldModel.layers.length).map(l=>[l.name,l]));model.layers=model.layers.map(l=>({...l,visible:oldLayers.get(l.name)?.visible??l.visible}));
        await engine.reconcileModel(model);documents.replaceModel(doc.id,model);doc.blockPrepared=true;doc.activeSpace=model.spaces.some(sp=>sp.id===oldSpace)?oldSpace:'model';
        // Preserve world camera coordinates across a changed per-space floating origin.
        for(const [id,state] of doc.spaceStates){const before=oldModel.spaces?.find(sp=>sp.id===id)?.origin||oldModel.origin,after=model.spaces.find(sp=>sp.id===id)?.origin||model.origin;if(state.camera){state.camera.x+=before[0]-after[0];state.camera.y+=before[1]-after[1];}state.selected=0;}
        if(engine.activeSpace?.id!==doc.activeSpace)engine.setSpace(doc.activeSpace,{fit:false});await restoreSpaceState(doc);doc.dirty=doc.dirty||dirty;
        onModel(model);renderTabs();if(dirty)status('Block edit committed · '+(engine.metrics.blockPagesReused||0)+' GPU pages reused · '+(engine.metrics.blockEntityUploadBytes||0)+' geometry bytes uploaded');
    }finally{loading=false;engine.suspended=false;hideBusy();engine.requestFrame();}
}

function setTool(value) { tool = value; canvas.parentElement.dataset.tool = value; q('[data-tool]').forEach(el => el.classList.toggle('active', el.dataset.tool === value)); $('tool-hint').textContent = ({ select: 'Wheel to zoom · Drag to pan · Click to select', pan: 'Drag to pan · Wheel or pinch to zoom', text: 'Click to place a text annotation', line: 'Drag to add a review line', rect: 'Drag to create a review box', circle: 'Drag from center to set the radius', cloud: 'Drag to create a revision cloud', measure: 'Drag to measure · computed on the GPU' })[value]; annotations.setPreview(null); }
function updateLayers() { if (!ready || !engine.layers)
    return; const filter = $('layer-filter').value.toLowerCase(); $('layer-count').textContent = engine.layers.length; $('layers').replaceChildren(); engine.layers.forEach((layer, index) => { if (!layer.name.toLowerCase().includes(filter))
    return; const row = document.createElement('div'); row.className = 'layer-row' + (layer.visible ? '' : ' dimmed'); row.innerHTML = `<input type="checkbox" aria-label="Show ${esc(layer.name)}" ${layer.visible ? 'checked' : ''}><input class="layer-color" type="color" value="${colorHex(layer.color)}" aria-label="Color of ${esc(layer.name)}"><span class="layer-name" title="${esc(layer.name)}">${esc(layer.name)}</span>${layer.locked ? '<span class="layer-lock">' + icon('lock') + '</span>' : ''}`; row.querySelector('[type=checkbox]').onchange = e => { engine.updateLayer(index, { visible: e.target.checked }); row.classList.toggle('dimmed', !e.target.checked); }; row.querySelector('[type=color]').oninput = e => engine.updateLayer(index, { color: rgba(e.target.value) }); $('layers').append(row); }); }
function updateAnnotations() { const items = annotations.items; $('annotation-count').textContent = items.length; $('undo').disabled = !annotations.undoStack.length; $('redo').disabled = !annotations.redoStack.length; $('annotations').innerHTML = items.length ? '' : '<p class="empty-hint">Draw a cloud, add a note, or measure a distance. Your source drawing stays untouched.</p>'; for (const item of items) {
    const row = document.createElement('div');
    row.className = 'annotation-item';
    row.innerHTML = `<button>${esc(item.label)}<span>${item.entities.length} ${item.entities.length === 1 ? 'entity' : 'entities'} · ${esc(item.author)}</span></button><button class="icon-button" aria-label="Delete ${esc(item.label)}">${icon('trash')}</button>`;
    row.firstElementChild.onclick = () => { const e = item.entities[0]; engine.camera.x = e.anchor[0] - engine.model.origin[0]; engine.camera.y = e.anchor[1] - engine.model.origin[1]; engine.requestFrame(); };
    row.lastElementChild.onclick = () => annotations.remove(item.id);
    $('annotations').append(row);
} }
async function flushAnnotations() { annotationFrame = 0; if (!ready || loading || benchmarking || !engine.model)
    return; annotationDirty = true; if (annotationBusy)
    return; annotationBusy = true; try {
    while (annotationDirty) {
        annotationDirty = false;
        if (annotationCommitDirty) {
            annotationCommitDirty = false;
            const model = annotations.build(font, engine.model, engine.model.layers.length);
            await engine.setAnnotations(model);
        }
        const preview = annotations.buildPreview(font, engine.model, engine.model.layers.length);
        await engine.setPreview(preview);
    }
}
catch (e) {
    showError(e);
}
finally {
    annotationBusy = false;
} }
annotations.addEventListener('change', e => { if (e.detail?.kind !== 'preview') {
    annotationCommitDirty = true;
    if (documents.current) { documents.current.dirty = true; renderTabs(); }
    updateAnnotations();
} if (!annotationFrame)
    annotationFrame = requestAnimationFrame(flushAnnotations); });
function frameUI() { const m = engine.metrics; $('cpu-ms').textContent = m.cpuMs.toFixed(2) + ' ms'; $('zoom-value').textContent = (engine.camera.zoom * 100 < .1 ? (engine.camera.zoom * 100).toFixed(3) : Math.round(engine.camera.zoom * 100)) + '%'; $('resolution').textContent = canvas.width + ' × ' + canvas.height; $('transfer-stats').textContent = '↑ ' + bytes(m.bytesUploaded) + '  ↓ ' + bytes(m.bytesReadback); }
function metricsUI(m) {
    $('gpu-ms').textContent = formatGpuTiming(m);
    $('gpu-memory').textContent = bytes(m.gpuBytes || engine.gpuBytes);
    $('visible-count').textContent = number(m.visible); $('glyph-count').textContent = m.glyphs === null ? '—' : number(m.glyphs);
    $('visible-summary').textContent = number(m.visible) + ' candidates';
    $('telemetry-note').textContent = (m.gpuTimingStatus === 'valid' || m.gpuTimingStatus === 'below-resolution' ? `GPU compute pass · frame ${m.timingSampleFrame ?? m.measuredFrame}. ` : `GPU time unavailable (${m.gpuTimingStatus || 'not sampled'}). `) +
        ((m.timingBaseRasterized ?? m.sampledBaseRasterized) ? 'Base redrawn. ' : 'Base coverage reused. ') + `Counters from frame ${m.countersSampleFrame ?? m.measuredFrame ?? '—'}. ` + number(m.executedRasterWorkgroups) + ' raster workgroups. ' +
        (m.proxyTexts ? number(m.proxyTexts) + ' text proxies. ' : 'No active text proxies. ') +
        (m.curveCapHits ? 'WARNING: ' + number(m.curveCapHits) + ' curve sampling caps. ' : '') +
        (m.fragmentOverflow ? 'ERROR: fragment capacity exceeded. ' : '') +
        'Last uniform upload: ' + (m.frameUniformBytes || 0) + ' B. Diagnostics: ' + (m.telemetryWallMs || 0).toFixed(2) + ' ms wall time, outside GPU compute. Uploads, native clears, queue waits and presentation are excluded. ' + (m.paperViewportCount ? m.paperViewportCount + ' sheet viewports (' + (m.viewportCoverageHits || 0) + ' exact coverage hits); counts include repeated model instances. Glyph counts are not sampled for sheet instances. ' : 'Counts include guard-band candidates and logical glyph slots. ') + 'Allocation is an estimate.';
    frameUI();
}
engine.addEventListener('frame', frameUI);
engine.addEventListener('metrics', e => metricsUI(e.detail));
engine.addEventListener('error', e => { if (engine.lost)
    ready = false; showError(e.detail, !ready); });
async function selectAt(x, y, add=false) { const epoch = engine.sceneEpoch; const id = await engine.pick(x, y); if (epoch !== engine.sceneEpoch) return; engine.selected = id; engine.requestFrame(); const blockRoot=blocks.selectEntity(id,{add}); const d = engine.describe(id); $('selection-id').textContent = id ? '#' + id : 'NONE'; if (!d) {
    $('selection').innerHTML = '<div class="selection-placeholder">' + icon('cursor') + '</div><p>Select an entity to inspect its ID, source handle, and layer.</p>';
    return;
} const item = annotations.itemForEntity(id, engine.model.count); const type = Object.entries(TYPE).find(([, v]) => v === d.type)?.[0] || 'ENTITY'; $('selection').innerHTML = `<div class="selection-table"><span>Entity</span><span>${type}</span><span>GPU ID</span><span>${id}</span><span>Layer</span><span title="${esc(d.layer)}">${esc(d.layer)}</span><span>DXF handle</span><span>${esc(d.handle || '—')}</span><span>Storage</span><span>GPU-resident</span></div>${item ? '<button class="button wide small" id="delete-selection" style="margin-top:14px">Delete annotation</button>' : ''}`; if(blockRoot?.type==='INSERT'){$('selection').insertAdjacentHTML('beforeend',`<div class="block-selection-chip"><strong>INSERT · ${esc(blockRoot.block)}</strong><br>Source #${esc(blockRoot.handle)}${buttonBlockInspector()}</div>`);$('inspect-block-reference').onclick=()=>run(()=>blocks.referenceDialog());$('inspect-block-tree').onclick=()=>run(()=>blocks.showSelectionTree());} if (item)
    $('delete-selection').onclick = () => { annotations.remove(item.id); engine.selected = 0; }; }
function buttonBlockInspector(){return '<div><button class="button small" id="inspect-block-reference">Edit INSERT</button> <button class="button small" id="inspect-block-tree">Show in tree</button></div>';}
function onModel(model) { $('drawing-name').textContent = model.name.toUpperCase(); $('drawing-short').textContent = model.name.replace(/\.dxf$/i, ''); $('source-kind').textContent = sourceKind === 'dxf' ? 'Local DXF · ' + (model.binary ? 'binary' : 'text') : sourceKind === 'stress' ? 'Generated directly on GPU' : 'Built-in engineering scene'; $('entity-summary').textContent = number(model.count) + ' entities'; $('diagnostic-count').textContent = model.diagnostics.length; $('engine-state').textContent = 'GPU RESIDENT · ' + model.pages.length + ' PAGES'; $('gpu-memory').textContent = bytes(engine.gpuBytes); $('selection-id').textContent = 'NONE'; updateLayers(); status(number(model.count) + ' entities · ' + model.pages.length + ' GPU pages · ' + model.diagnostics.length + ' import notices'); api.model = model; }
function enqueueDocument(action) {
    const job = documentQueue.then(action); documentQueue = job.catch(() => {}); return job;
}
function snapshotDocument() {
    documents.capture({ spaceId: engine.activeSpace?.id || 'model', camera: engine.camera, selected: engine.selected,
        items: annotations.items, undo: annotations.undoStack, redo: annotations.redoStack, layers: engine.layers,
        display: { flags: engine.flags, settings: {...engine.settings}, compositing: engine.compositing } });
}
async function quietAnnotations() {
    if(blocks?.placement||blocks?.pickPoint)await blocks.cancel();
    if (annotationFrame) cancelAnimationFrame(annotationFrame); annotationFrame=0;
    while (annotationBusy) await waitFrame();
    gesture=null;pinch=null;pointers.clear();annotations.preview=null;annotationDirty=false;annotationCommitDirty=false;
}
function sourceFor(doc) { sourceKind=doc.sourceKind;sourceFile=doc.sourceFile;fontFile=doc.fontFile;font=doc.font;api.font=font;
    $('font-name').textContent=(fontFile?.name || 'Aperture Engineering')+' · '+font.count+' glyphs'; }
async function restoreSpaceState(doc) {
    const state=documents.restore(doc.activeSpace,doc);
    annotations.items=state.items;annotations.undoStack=state.undo;annotations.redoStack=state.redo;annotations.preview=null;
    if(state.camera)engine.camera={...state.camera};engine.selected=state.selected;
    await engine.setAnnotations(annotations.build(font,doc.model,doc.model.layers.length));
    await engine.setPreview(annotations.buildPreview(font,doc.model,doc.model.layers.length));
    annotationDirty=false;annotationCommitDirty=false;updateAnnotations();syncDisplay();renderTabs();metricsUI(engine.metrics);
}
async function activateDocument(doc,{remember=true}={}) {
    await quietAnnotations();if(remember)snapshotDocument();engine.suspended=true;
    try {
        if(engine.font!==doc.font)await engine.setFont(doc.font);
        await engine.setModel(doc.model);documents.activate(doc.id);sourceFor(doc);
        if(doc.display){engine.flags=doc.display.flags;Object.assign(engine.settings,doc.display.settings);}
        if(doc.model.spaces)engine.setSpace(doc.activeSpace);
        if(doc.layers)doc.layers.forEach((l,i)=>{if(engine.layers[i])engine.updateLayer(i,l);});
        if(doc.display?.compositing && !(engine.activeSpace?.kind==='paper'&&engine.activeSpace.viewports.some(v=>v.number!==1&&v.supported)))await engine.setCompositing(doc.display.compositing);
        await restoreSpaceState(doc);onModel(doc.model);renderTabs();blocks.onDocument();
    } finally {engine.suspended=false;engine.requestFrame();}
}
async function useModel(model,{sourceKind:kind='demo',sourceFile:file=null}={}) {
    // Keep the old tab and its packed records until the candidate has uploaded successfully.
    const previous=documents.current;await quietAnnotations();snapshotDocument();
    const doc=documents.add(model,{sourceKind:kind,sourceFile:file,font,fontFile});
    try {await activateDocument(doc,{remember:false});}
    catch(error){documents.close(doc.id);if(previous)await activateDocument(previous,{remember:false});throw error;}
    await waitFrame();engine.render();await engine.captureMetrics();return doc;
}
function switchDocument(id) { return enqueueDocument(async()=>{
    if(!ready||benchmarking||documents.activeId===id)return;
    const doc=documents.get(id);if(!doc)return;
    const old=documents.current;loading=true;busy('Opening '+doc.name,'Uploading the existing packed model. DXF is not reparsed.');
    try {await activateDocument(doc);}catch(e){if(old)await activateDocument(old,{remember:false});throw e;}
    finally {loading=false;hideBusy();}
}); }
function switchSpace(id) { return enqueueDocument(async()=>{
    if(!ready||benchmarking||!documents.current)return;loading=true;
    try {await quietAnnotations();snapshotDocument();const doc=documents.current;
        engine.suspended=true;const wasExact=engine.compositing==='exact';engine.setSpace(id);doc.activeSpace=id;
        await restoreSpaceState(doc);onModel(doc.model);renderTabs();blocks.onDocument();
        if(wasExact&&engine.compositing==='opaque')toast('Paper viewports use opaque composition. Ordered alpha remains available in Model.');
    }finally{engine.suspended=false;loading=false;engine.requestFrame();}
}); }
function closeDocument(id) {return enqueueDocument(async()=>{
    const doc=documents.get(id);if(!doc||!ready||benchmarking)return;
    if(doc.dirty&&!confirm('Close '+doc.name+'? Unsaved block edits and review changes in this tab will be discarded.'))return;
    if(id!==documents.activeId){documents.close(id);renderTabs();return;}
    loading=true;try{await quietAnnotations();snapshotDocument();const index=documents.documents.indexOf(doc);
        const next=documents.documents[index+1] || documents.documents[index-1];
        if(next){await activateDocument(next,{remember:false});documents.close(id);}
        else {await engine.device.queue.onSubmittedWorkDone();engine.disposeScene();documents.close(id);
            annotations.items=[];annotations.undoStack=[];annotations.redoStack=[];annotations.preview=null;sourceFile=null;
            // An empty resident Model keeps the canvas, controls and compute path valid without retaining a closed file.
            const empty=new ModelBuilder(font,{name:'No open drawing'}).finish();empty.spaces=[{id:'model',name:'Model',kind:'model',pageIndices:[],count:0,viewports:[]}];empty.initialSpace='model';
            await engine.setModel(empty);api.model=null;updateAnnotations();$('drawing-short').textContent='Open a drawing';$('drawing-name').textContent='NO OPEN DRAWING';$('entity-summary').textContent='0 entities';$('layers').replaceChildren();}
        renderTabs();metricsUI(engine.metrics);blocks.onDocument();
    }finally{loading=false;engine.requestFrame();}
});}
function renderTabs() {
    const focusDocument=document.activeElement?.dataset.documentId,focusSpace=document.activeElement?.dataset.spaceId;
    const tabs=$('file-tabs'),fileScroll=tabs.scrollLeft,spaceScroll=$('space-tabs').scrollLeft;tabs.replaceChildren();
    for(const doc of documents.documents){const row=document.createElement('div');row.className='file-tab'+(doc.id===documents.activeId?' active':'');
        const b=document.createElement('button');b.className='file-tab-title';b.type='button';b.role='tab';b.id=doc.id+'-tab';b.dataset.documentId=doc.id;b.setAttribute('aria-selected',String(doc.id===documents.activeId));b.setAttribute('aria-controls','canvas-wrap');b.tabIndex=doc.id===documents.activeId?0:-1;b.textContent=doc.name+(doc.dirty?' •':'');b.title=doc.name+' · '+number(doc.model.count)+' entities';b.onclick=()=>run(()=>switchDocument(doc.id));
        const close=document.createElement('button');close.className='file-tab-close';close.type='button';close.setAttribute('aria-label','Close '+doc.name);close.textContent='×';close.onclick=()=>run(()=>closeDocument(doc.id));row.append(b,close);tabs.append(row);
    }
    if(!documents.documents.length){const t=document.createElement('span');t.className='empty-tabs';t.textContent='Open DXF drawings · multiple files supported';tabs.append(t);}
    const spaces=$('space-tabs');spaces.replaceChildren();for(const sp of documents.spaces()){const b=document.createElement('button');b.className='view-tab'+(sp.id===documents.current.activeSpace?' active':'');b.role='tab';b.dataset.spaceId=sp.id;b.setAttribute('aria-selected',String(sp.id===documents.current.activeSpace));b.tabIndex=sp.id===documents.current.activeSpace?0:-1;b.textContent=sp.name;b.title=(sp.kind==='model'?'Model space':'Paper space')+' · '+number(sp.count)+' entities';b.onclick=()=>run(()=>switchSpace(sp.id));spaces.append(b);}
    const doc=documents.current, select=$('named-views');select.replaceChildren(new Option('Saved views & viewports…',''));
    if(doc){const all=[...(doc.model.namedViews || []),...documents.spaces(doc).flatMap(sp=>(sp.viewports || []).filter(v=>v.number!==1).map(v=>({...v,label:sp.name+' / '+v.name+(v.status===0?' (off)':'')})))];
        all.forEach((v,i)=>{const option=new Option((v.label||v.name)+(v.supported?'':' · unsupported projection'),String(i));option.disabled=!v.supported;select.add(option);});select.disabled=!all.length;
        select.onchange=()=>{const view=all[Number(select.value)];if(select.value==='')return;run(()=>enqueueDocument(async()=>{if(!ready||loading)return;loading=true;engine.suspended=true;try{await quietAnnotations();snapshotDocument();engine.setNamedView(view);doc.activeSpace=engine.activeSpace?.id || 'model';const camera={...engine.camera};await restoreSpaceState(doc);engine.camera=camera;renderTabs();}finally{loading=false;engine.suspended=false;engine.requestFrame();}}));};
    }else select.disabled=true;
    $('document-space').textContent=doc?(documents.spaces(doc).find(s=>s.id===doc.activeSpace)?.name || 'Model'):'EMPTY';
    tabs.scrollLeft=fileScroll;spaces.scrollLeft=spaceScroll;
    if(doc)$('canvas-wrap').setAttribute('aria-labelledby',doc.id+'-tab');else $('canvas-wrap').removeAttribute('aria-labelledby');
    const focus=[...tabs.querySelectorAll('[role=tab]'),...spaces.querySelectorAll('[role=tab]')].find(b=>(focusDocument&&b.dataset.documentId===focusDocument)||(focusSpace&&b.dataset.spaceId===focusSpace));
    focus?.focus({preventScroll:true});tabs.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function tabKeys(event) {
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=[...event.currentTarget.querySelectorAll('[role=tab]')];if(!buttons.length)return;
    let index=buttons.indexOf(event.target);if(index<0)return;
    index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
    event.preventDefault();buttons[index].focus();buttons[index].click();
}
$('file-tabs').addEventListener('keydown',tabKeys);$('space-tabs').addEventListener('keydown',tabKeys);
function loadDemo(){return enqueueDocument(loadDemoInternal);}
function loadFeatures(){return enqueueDocument(loadFeaturesInternal);}
function loadStress(count=1000000,mode=1){return enqueueDocument(()=>loadStressInternal(count,mode));}
function loadDxf(file){return enqueueDocument(()=>loadDxfInternal(file));}
function openFiles(files){const list=Array.from(files);return enqueueDocument(async()=>{const results=[];for(const file of list){try{if(!/\.dxf$/i.test(file.name))throw new Error(file.name+': not a DXF drawing.');const doc=await loadDxfInternal(file);if(doc)results.push(doc);}catch(error){showError(error);}}return results;});}
async function loadDemoInternal() { if (loading || benchmarking || !ready)
    return; loading = true; busy('Opening Eastworks campus', 'Building the original sample drawing and uploading compact GPU pages.'); try {
    await useModel(makeCampus(font),{sourceKind:'demo'});
}
finally {
    loading = false;
    hideBusy();
} }
async function loadFeaturesInternal() {
    if (loading || benchmarking || !ready) return;
    loading = true; busy('Opening the compute feature gallery', 'Uploading parameter records for hatches, dimensions, text and overlapping transparent fills.');
    try { await useModel(makeFeatureGallery(font),{sourceKind:'features'}); }
    finally { loading = false; hideBusy(); }
}
async function loadStressInternal(count = 1000000, mode = 1) { if (loading || benchmarking || !ready)
    return; loading = true; busy('Generating ' + number(count) + ' entities on the GPU', mode === 2 ? 'Every text entity receives a unique eight-digit identifier. No CPU glyph expansion.' : 'Raw entities, transforms and bounds are created by compute kernels.'); await waitFrame(); try {
    await useModel(makeSyntheticModel(font, count, mode),{sourceKind:'stress'});
}
finally {
    loading = false;
    hideBusy();
} }
async function loadDxfInternal(file) { if (loading || benchmarking || !ready)
    return; loading = true; busy('Importing ' + file.name, 'Parsing DXF records in an isolated worker. Your drawing never leaves this device.', true); try {
    const buffer = await file.arrayBuffer();
    const model = await importer.parse(buffer, font, { name: file.name, document: true, editMap: 'inserts', onProgress: p => { $('busy-detail').textContent = p.phase + ' · ' + number(p.entities) + ' entities'; } });
    $('cancel-import').hidden = true;
    busy('Preparing GPU model', 'Projecting transforms, laying out glyphs, computing bounds and building the GPU pages.');
    const doc = await useModel(model,{sourceKind:'dxf',sourceFile:file});
    if (model.diagnostics.length)
        toast('Imported with ' + model.diagnostics.length + ' diagnostic categories. Review Import diagnostics.');
    return doc;
}
catch (e) {
    if (e.name === 'AbortError')
        toast('DXF import cancelled.');
    else
        throw e;
}
finally {
    loading = false;
    hideBusy();
} }
async function run(action) { try {
    await action();
}
catch (e) {
    showError(e);
} }
function showReport() { const m = engine.model; if (!m) {
    toast('Open a drawing first.');
    return;
} dialog('Import diagnostics', `<p class="dialog-intro">${esc(m.name)} · ${number(m.count)} rendered entities · ${number(m.sourceCount ?? m.count)} source records. Unsupported constructs and substitutions are reported here; an empty report is not a claim of full DXF conformance.</p>${[...m.diagnostics,...(font.diagnostics || []).map(message=>({code:'FONT-LAYOUT',count:1,message}))].length ? [...m.diagnostics,...(font.diagnostics || []).map(message=>({code:'FONT-LAYOUT',count:1,message}))].map(d => `<div class="report-row"><strong>${esc(d.code)}</strong><span>${number(d.count)} occurrences</span><p>${esc(d.message)}</p></div>`).join('') : '<div class="lab-note">No import diagnostics were emitted for this drawing.</div>'}<div class="lab-options"><button class="button" id="export-report">Export report JSON</button></div>`, 'DXF / NORMALIZATION'); $('export-report').onclick = () => download({ name: m.name, diagnostics: m.diagnostics, header: m.header || {}, count: m.count }, 'aperture-import-report.json'); }
function showHelp() {
    dialog('GPU-resident by construction.', `<p class="dialog-intro">Aperture 2 is a local-first 2D drawing and review workbench. CAD marks, text, pattern evaluation, dimensions, picking and compositing use WebGPU compute pipelines. HTML and CSS provide the workbench interface.</p>
    <div class="help-grid"><div><h3>Navigation & review</h3><div class="shortcuts"><kbd>Wheel / pinch</kbd><span>Pointer-centered zoom</span><kbd>Drag / Space</kbd><span>Pan the drawing</span><kbd>F</kbd><span>Fit drawing extents</span><kbd>V / H</kbd><span>Select / Pan</span><kbd>L / R / C</kbd><span>Line / Box / Circle</span><kbd>T / M</kbd><span>Text / Measure</span><kbd>G</kbd><span>Compute grid</span><kbd>Ctrl / ⌘ + O</kbd><span>Open DXF</span><kbd>Ctrl / ⌘ + Z</kbd><span>Undo annotations</span><kbd>Shift + Ctrl / ⌘ + Z</kbd><span>Redo annotations</span><kbd>Escape</kbd><span>Cancel / Select</span></div>
    <h3>Two render modes</h3><p>Opaque CAD prioritizes frame work reduction: batched small entities, cached visibility and separate base/overlay coverage. Ordered alpha uses a bounded fragment arena and source-over in entity order; it costs more and reports overflow explicitly.</p></div>
    <div><h3>Files, layouts and views</h3><p>Open several DXF files at once or drop a group of drawings. File tabs retain independent cameras, layer settings and per-layout reviews. The second tab strip lists Model and every paper layout, including empty sheets. The saved-view menu lists named VIEW records and paper viewports. Rectangular top-XY viewports compose model geometry on the sheet, including twist and viewport-frozen layers. Unsupported 3D/perspective/nonrectangular views stay listed with diagnostics. Only the active file occupies GPU model memory; switching its layouts reuses resident geometry.</p><h3>Implemented in this revision</h3><p>Pattern hatches with line, bulge, conic and rational-spline boundaries; seven parametric dimension kinds; SHP/SHX GPU glyph compilation; horizontal OpenType single substitutions, ligatures and pair/class kerning; closed-form quadratic glyph distance; fixed-record GPU edits.</p>
    <h3>Conformance boundaries</h3><p>This remains a top/XY engine, not a 3D solid modeler. Full DXF rewrite, associative constraints, complete DIMSTYLE, wide polyline ribbons, gradient hatches and complex linetypes remain outside this build. The original file can be exported unchanged.</p><p>Font support is bounded: no general bidirectional or complex-script shaping, variable-font deltas, CFF, BIGFONT, or automatic per-style font resolution. Unsupported layout lookups produce diagnostics.</p>
    <p>Use HTTPS or localhost in a WebGPU-enabled browser. Browser/driver GPU validation and measured frame times must be obtained on the target hardware. This package does not assert unmeasured throughput.</p></div></div>
    <div class="lab-note" style="margin-top:22px">The host parses file containers and serializes compact parameters. All CAD geometry evaluation and drawing kernels stay on the GPU. Analytic curves use f32 arithmetic; general spline sampling still has explicit caps rather than a universal geometric-error proof.</div>`, 'ARCHITECTURE / SHORTCUTS');
}
function showLab() {
    dialog('Less frame work. More drawing.', `<p class="dialog-intro">Inspect the new compute features, generate million-entity workloads, or compare optimization-off and optimization-on profiles on the same camera trace. No generated result is presented as a measurement.</p>
    <div class="lab-grid">${[[100000,1,'100 K','Mixed entities','Pipeline validation'],[1000000,1,'1 M','Mixed entities','60% lines · 30% text · 10% circles'],[3000000,1,'3 M','Mixed entities','Preflight GPU memory guard'],[100000,2,'100 K','Unique TEXT','~1.2 million logical slots'],[1000000,2,'1 M','Unique TEXT','~12 million logical slots'],[2000000,2,'2 M','Unique TEXT','~24 million logical slots']].map(([count,mode,title,desc,note])=>`<button class="lab-card ${mode===2?'text-card':''}" data-count="${count}" data-mode="${mode}"><strong>${title}</strong><span>${desc}</span><small>${note}</small></button>`).join('')}</div>
    <div class="lab-options"><button class="button primary" id="load-features">Open feature gallery</button><button class="button" id="load-demo">Campus sample</button></div>
    <div class="lab-controls"><label class="setting-row">Small-entity batching<input id="perf-batch" type="checkbox" ${engine.planner.batch?'checked':''}></label>
    <label class="setting-row">Coverage / visibility cache<input id="perf-cache" type="checkbox" ${engine.planner.cache?'checked':''}></label>
    <label class="setting-row">Paper viewport caches<input id="perf-paper-cache" type="checkbox" ${engine.paperCache?'checked':''}></label>
    <label class="setting-row">Visibility guard<select id="perf-guard"><option value="0">None</option><option value="0.25">25% per side</option><option value="0.5">50% per side</option></select></label>
    <label class="setting-row">GPU queue compaction<select id="perf-compaction"><option value="mask">Bit mask · default</option><option value="scan">Prefix scan · reference</option></select></label>
    <label class="setting-row">Compositing<select id="perf-alpha"><option value="opaque">Opaque CAD · fast</option><option value="exact">Ordered alpha · bounded</option></select></label>
    <label class="setting-row">Adaptive resolution · 12 ms target<input id="perf-resolution" type="checkbox" ${engine.governor?'checked':''} ${engine.hasTimestamps?'':'disabled'}></label>
    <label class="setting-row">Benchmark quality<select id="benchmark-quality"><option value="exact">Exact text · fixed resolution</option><option value="current">Current text mode · fixed resolution</option></select></label></div>
    <div class="lab-note">Exact text disables density proxies. Adaptive resolution is opt-in, requires real GPU timestamps and changes pixel density; it is disabled for A/B runs. Paper queues and exact coverage share a ${bytes(engine.options.paperCacheBudget)} optional cache cap; integer-phase pan can reuse coverage, subpixel pan rerasterizes. Ordered alpha uses extra memory and can be slower under overlap. The reference profile is this same v2.5 renderer with scan compaction, batching and caches disabled—not the previous release.</div>
    <div class="lab-options"><button class="button primary" id="benchmark">Run moving-camera A/B · 60 + 60 frames</button></div>
    <h3 class="dialog-subtitle">Measured results</h3><pre id="benchmark-result" class="benchmark-result">No benchmark has been run in this session.</pre><button id="download-benchmark" class="button small" hidden>Export raw benchmark JSON</button>`, 'COMPUTE LAB / REPRODUCIBLE PROFILES');
    q('.lab-card').forEach(b=>b.onclick=()=>{closeDialog();run(()=>loadStress(Number(b.dataset.count),Number(b.dataset.mode)));});
    $('load-demo').onclick=()=>{closeDialog();run(loadDemo);}; $('load-features').onclick=()=>{closeDialog();run(loadFeatures);};
    $('perf-compaction').value=engine.compaction; $('perf-guard').value=String(engine.planner.guardBand); $('perf-alpha').value=engine.compositing;
    const update=()=>run(()=>engine.setPerformance({cache:$('perf-cache').checked,batch:$('perf-batch').checked,guardBand:Number($('perf-guard').value),compaction:$('perf-compaction').value,paperCache:$('perf-paper-cache').checked}));
    $('perf-batch').onchange=update; $('perf-cache').onchange=update; $('perf-guard').onchange=update; $('perf-compaction').onchange=update; $('perf-paper-cache').onchange=update;
    $('perf-alpha').onchange=()=>run(async()=>{try {await engine.setCompositing($('perf-alpha').value);}finally {$('perf-alpha').value=engine.compositing;}});
    $('perf-resolution').onchange=()=>run(()=>{try {engine.setAdaptiveResolution($('perf-resolution').checked?{targetMs:12}:null);if(engine.governor)$('auto-metrics').checked=true;}finally {$('perf-resolution').checked=!!engine.governor;}});
    $('benchmark').onclick=()=>run(benchmark);
    if (api.lastBenchmark) displayBenchmark(api.lastBenchmark);
    if (!ready) { for (const node of $('dialog-content').querySelectorAll('button,input,select')) node.disabled=true; $('benchmark-result').textContent='WebGPU is unavailable here. The controls become active after the engine initializes on a supported HTTPS/localhost page.'; }
}
function displayBenchmark(data) {
    if (!$('benchmark-result')) return;
    $('benchmark-result').textContent=JSON.stringify({...data,profiles:data.profiles.map(({samples,...summary})=>summary)},null,2);
    $('download-benchmark').hidden=false; $('download-benchmark').onclick=()=>download(data,'aperture-benchmark-v2.5.json');
}
async function benchmark() {
    if (!ready || loading || benchmarking) return;
    benchmarking=true; gesture=null; pointers.clear(); pinch=null;
    const controls=[...$('dialog-content').querySelectorAll('button,input,select')].map(node=>[node,node.disabled]);
    const oldFlags=engine.flags, exact=$('benchmark-quality').value==='exact';
    controls.forEach(([node])=>node.disabled=true);
    $('benchmark-result').textContent='Measuring identical moving-camera traces. Raw CPU encode, GPU timestamp and queue-completion samples remain separate.';
    try {
        if (exact) engine.flags &= ~2;
        const data=await engine.benchmarkProfiles({frames:60,warmup:8,panPixels:160});
        Object.assign(data,{application:'Aperture CAD',version:api.version,browser:navigator.userAgent,scene:engine.model.name});
        api.lastBenchmark=data; displayBenchmark(data); toast('A/B trace captured on this GPU. Inspect the raw result before drawing conclusions.');
    } catch(error) { if($('benchmark-result')) $('benchmark-result').textContent='No valid result: '+error.message; throw error; }
    finally { engine.flags=oldFlags; syncDisplay(); benchmarking=false; controls.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});engine.requestFrame(); }
}
function showExport() { dialog('Keep your work portable.', `<p class="dialog-intro">Annotations are independent of the source drawing. Export them losslessly as JSON, or exchange supported review entities as a DXF overlay. Local workspace saves include the original file and camera state.</p><div class="export-grid"><button class="export-card" id="export-png"><strong>Viewport snapshot · PNG</strong><span>Capture the current compute-rendered surface at its current pixel resolution.</span></button><button class="export-card" id="export-json"><strong>Annotations · JSON</strong><span>Lossless review groups, text, measurement marks, colors and revision clouds.</span></button><button class="export-card" id="export-dxf"><strong>Review overlay · DXF</strong><span>Export annotation geometry as a separate editable exchange drawing.</span></button><button class="export-card" id="import-json"><strong>Import annotations</strong><span>Replace current annotation groups with a previously exported JSON file.</span></button></div><div class="lab-options">${documents.current?.blockDrawing?'<button class="button primary" id="export-edited">Edited drawing · BLOCK / INSERT DXF</button>':''}${sourceFile?'<button class="button" id="export-original">Original source DXF · unchanged</button>':''}<button class="button" id="save-dialog">Save local workspace</button><button class="button" id="restore-dialog">Restore saved workspace</button></div>`, 'LOCAL FILES / EXPORT'); if($('export-edited'))$('export-edited').onclick=()=>run(()=>blocks.exportDrawing()); if ($('export-original')) $('export-original').onclick = () => download(sourceFile, sourceFile.name, 'application/dxf'); $('export-png').onclick = () => run(async () => { download(await engine.exportPng(), 'aperture-viewport.png'); toast('PNG exported.'); }); $('export-json').onclick = () => download(annotations.toJSON(), 'aperture-annotations.json'); $('export-dxf').onclick = () => run(() => download(annotationsToDxf(annotations.items.flatMap(x => x.entities)), 'aperture-review.dxf', 'application/dxf')); $('import-json').onclick = () => $('annotations-file').click(); $('save-dialog').onclick = () => run(saveWorkspace); $('restore-dialog').onclick = () => { closeDialog(); run(restoreWorkspace); }; }
function saveWorkspace() { return enqueueDocument(async()=>{
    if(!ready||loading||benchmarking)return;snapshotDocument();
    const data={version:3,activeIndex:documents.documents.findIndex(d=>d.id===documents.activeId),savedAt:new Date().toISOString(),
        performance:{cache:engine.planner.cache,batch:engine.planner.batch,guardBand:engine.planner.guardBand,compaction:engine.compaction},
        documents:documents.documents.map(d=>({sourceKind:d.sourceKind,sourceFile:d.sourceFile,fontFile:d.fontFile,synthetic:d.model.synthetic || null,
            activeSpace:d.activeSpace,spaceStates:[...d.spaceStates],layers:d.layers,display:d.display,blockState:d.blockDrawing?.toState()||null}))};
    await workspace.save(data);for(const doc of documents.documents)doc.dirty=false;renderTabs();toast('All '+data.documents.length+' drawing tabs and layout reviews saved in this browser.');
});}
async function parseLocalFont(file,previous=font,missing=[]) {
    if(!file)return makeBuiltinFont();const buffer=await file.arrayBuffer();
    return /\.(shx|shp)$/i.test(file.name)?parseStrokeFont(buffer,{name:file.name}):parseTrueType(buffer,[...new Set([...previous.map.keys(),...missing.map(c=>c.codePointAt(0))])]);
}
async function sourceModel(entry,face) {
    if(entry.blockDrawing||entry.blockState){const drawing=entry.blockDrawing||BlockDrawing.fromState(entry.blockState);return importer.parse(new TextEncoder().encode(drawing.write()).buffer,face,{name:drawing.name,document:true,editMap:'inserts'});}
    if(entry.sourceKind==='dxf'&&entry.sourceFile)return importer.parse(await entry.sourceFile.arrayBuffer(),face,{name:entry.sourceFile.name,document:true,editMap:'inserts'});
    if(entry.sourceKind==='features')return makeFeatureGallery(face);
    if(entry.synthetic)return makeSyntheticModel(face,entry.synthetic.total,entry.synthetic.mode);
    return makeCampus(face);
}
function restoreWorkspace() {return enqueueDocument(async()=>{
    if(!ready||loading||benchmarking)return;const saved=await workspace.load();if(!saved){toast('There is no saved workspace in this browser.');return;}
    // v2 migration opens a new document; never overwrite an unsaved open tab.
    const entries=saved.version===3?saved.documents:[{...saved,activeSpace:'model',display:{flags:saved.flags,settings:saved.settings,compositing:saved.compositing},
        spaceStates:[['model',{camera:saved.camera,items:saved.annotations?.items || [],undo:[],redo:[],selected:0}]]}];
    if(!Array.isArray(entries)||entries.length>documents.maxDocuments)throw new Error('Invalid saved document list.');
    if(entries.length+documents.documents.length>documents.maxDocuments)throw new Error('Close some tabs before restoring this workspace; no tabs have been replaced.');
    loading=true;busy('Restoring saved drawing tabs','Rebuilding packed models from browser-local source files. Existing tabs are retained.');
    const added=[];try{await quietAnnotations();snapshotDocument();
        for(const entry of entries){const face=await parseLocalFont(entry.fontFile),model=await sourceModel(entry,face),doc=documents.add(model,{...entry,font:face});
            doc.activeSpace=documents.spaces(doc).some(s=>s.id===entry.activeSpace)?entry.activeSpace:'model';
            if(entry.blockState){doc.blockDrawing=BlockDrawing.fromState(entry.blockState);doc.blockPrepared=true;}doc.spaceStates=new Map(entry.spaceStates || []);doc.layers=entry.layers;doc.display=entry.display;added.push(doc);}
        if(saved.performance)engine.setPerformance(saved.performance);
        if(added.length)await activateDocument(added[Math.max(0,Math.min(added.length-1,saved.activeIndex || 0))],{remember:false});
        toast('Restored '+added.length+' saved tabs. Existing open drawings were kept.');
    }finally{loading=false;hideBusy();renderTabs();}
});}
function replaceFont(file) {return enqueueDocument(async()=>{
    if(!ready||loading||benchmarking)return;loading=true;engine.suspended=true;
    const doc=documents.current,oldFont=font,oldFile=fontFile,oldModel=doc?.model;
    try{await quietAnnotations();snapshotDocument();const parsed=await parseLocalFont(file,font,engine.model?.missing || []);
        if(doc){const model=await sourceModel({...doc,synthetic:doc.model.synthetic},parsed);documents.replaceModel(doc.id,model);doc.font=parsed;doc.fontFile=file;
            try{await activateDocument(doc,{remember:false});}catch(error){documents.replaceModel(doc.id,oldModel);doc.font=oldFont;doc.fontFile=oldFile;await activateDocument(doc,{remember:false});throw error;}
            doc.dirty=true;renderTabs();
        }else{await engine.setFont(parsed);font=parsed;fontFile=file;api.font=parsed;}
        if(parsed.diagnostics?.length)toast('Font loaded with '+parsed.diagnostics.length+' explicit notices; see Import diagnostics.');
    }finally{loading=false;engine.suspended=false;engine.requestFrame();}
});}
function syncDisplay() { $('grid').classList.toggle('active', !!(engine.flags & 1)); $('exact').classList.toggle('active', !(engine.flags & 2)); $('text-quality').value = engine.flags & 2 ? 'adaptive' : 'exact'; $('view-quality').textContent = engine.flags & 2 ? 'ADAPTIVE TEXT' : 'EXACT TEXT'; $('monochrome').checked = !!(engine.flags & 4); $('curve-quality').value = String(engine.settings.curveTolerance); $('stroke-width').value = String(engine.settings.strokeWidth); }
function noteAt(point) { const epoch=engine.sceneEpoch;dialog('Place a text annotation', `<form class="note-form" id="note-form"><label for="note-text">Review note</label><textarea id="note-text" required maxlength="16384" placeholder="Add your note…">REVIEW: </textarea><div class="note-fields"><div><label for="note-height">Height · units</label><input type="number" id="note-height" min="0.000001" step="any" value="${(12 / engine.camera.zoom).toPrecision(4)}" required></div><div><label for="note-color">Ink</label><input type="color" id="note-color" value="#ffb05c"></div><button class="button primary" type="submit">Place annotation</button></div></form>`, 'REVIEW / TEXT'); $('note-text').focus(); $('note-text').setSelectionRange(8, 8); $('note-form').onsubmit = e => { e.preventDefault(); if(epoch!==engine.sceneEpoch){closeDialog();toast('The drawing view changed; place the note again.');return;} const text = $('note-text').value, height = Number($('note-height').value); if (!(height > 0 && Number.isFinite(height)))
    return; annotations.add([{ type: TYPE.TEXT, anchor: point, p: [height, 1, 0, 0], text, color: rgba($('note-color').value) }], { label: text.slice(0, 48) }); closeDialog(); }; }
function geometryFor(kind, a, b, preview = true) { const dx = b[0] - a[0], dy = b[1] - a[1], color = rgba(preview ? '#ddc27e' : '#ffb05c'); if (kind === 'line' || kind === 'measure')
    return [{ type: TYPE.LINE, anchor: a, p: [dx, dy, 0, 0], color }]; if (kind === 'rect')
    return [{ type: TYPE.POLYLINE, anchor: a, points: [a, [b[0], a[1]], b, [a[0], b[1]]], flags: FLAGS.CLOSED, color }]; if (kind === 'circle')
    return [{ type: TYPE.ELLIPSE, anchor: a, p: [Math.hypot(dx, dy), 0, 1, 0], q: [0, Math.PI * 2, 0, 0], color }]; if (kind === 'cloud') {
    const origin = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
    return [{ type: TYPE.CLOUD, anchor: origin, p: [Math.abs(dx), Math.abs(dy), 0, 0], q: [18 / engine.camera.zoom, 0, 0, 0], color }];
} return []; }
async function finishGeometry(kind, a, b) { const epoch=engine.sceneEpoch; if (kind === 'measure') {
    const m = await engine.measure(a, b);
    if (!m || epoch !== engine.sceneEpoch)
        return;
    const height = 11 / engine.camera.zoom;
    annotations.add([{ type: TYPE.LINE, anchor: a, p: [b[0] - a[0], b[1] - a[1], 0, 0], measurement: true, color: rgba('#bbacff') }, { type: TYPE.TEXT, anchor: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + height * .8], p: [height, 1, 0, 0], text: m[0].toFixed(3) + ' units', measurement: true, color: rgba('#bbacff') }, { type: TYPE.POINT, anchor: a, measurement: true, color: rgba('#bbacff') }, { type: TYPE.POINT, anchor: b, measurement: true, color: rgba('#bbacff') }], { label: 'Measure · ' + m[0].toFixed(3) });
    toast('GPU length ' + m[0].toFixed(6) + ' · ΔX ' + m[1].toFixed(4) + ' · ΔY ' + m[2].toFixed(4));
}
else
    annotations.add(geometryFor(kind, a, b, false), { label: ({ line: 'Review line', rect: 'Review box', circle: 'Review circle', cloud: 'Revision cloud' })[kind] }); }
function position(e) { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function pinchState() { const p = [...pointers.values()]; return { distance: Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), center: [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] }; }
canvas.addEventListener('pointerdown', e => { if (!ready || loading || benchmarking || !engine.model)
    return; if(blocks.pointerDown(e,space||tool==='pan')){e.preventDefault();canvas.focus();return;} e.preventDefault(); canvas.focus(); canvas.setPointerCapture(e.pointerId); const p = position(e); pointers.set(e.pointerId, p); if (pointers.size === 2) {
    gesture = null;
    annotations.setPreview(null);
    pinch = pinchState();
    return;
} const pan = e.button === 1 || e.button === 2 || space || tool === 'pan'; gesture = { kind: pan ? 'pan' : tool, start: p, last: p, world: engine.worldAt(...p), moved: 0 }; });
canvas.addEventListener('pointermove', e => { if (!ready || !engine.model || loading || benchmarking)
    return; const p = position(e), world = engine.worldAt(...p); $('cursor-position').textContent = 'X ' + world[0].toFixed(3) + '   Y ' + world[1].toFixed(3); if (pointers.has(e.pointerId))
    pointers.set(e.pointerId, p); if (pointers.size >= 2 && pinch) {
    const current = pinchState();
    engine.pan(current.center[0] - pinch.center[0], current.center[1] - pinch.center[1]);
    if (pinch.distance > 0)
        engine.zoomAt(...current.center, current.distance / pinch.distance);
    pinch = current;
    return;
} if(!gesture&&blocks.pointerMove(e))return; if (gesture) {
    const dx = p[0] - gesture.last[0], dy = p[1] - gesture.last[1];
    gesture.moved = Math.max(gesture.moved, Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]));
    if (gesture.kind === 'pan' || gesture.kind === 'select')
        engine.pan(dx, dy);
    else if (gesture.kind !== 'text')
        annotations.setPreview(geometryFor(gesture.kind, gesture.world, world));
    gesture.last = p;
}
else if (tool === 'select' && !engine.queryBusy && performance.now() - lastHover > 120) {
    lastHover = performance.now();
    const epoch=engine.sceneEpoch;engine.pick(...p, 3).then(id => { if (epoch===engine.sceneEpoch && id !== engine.hovered) {
        engine.hovered = id;
        engine.requestFrame();
    } }).catch(e => showError(e));
} });
async function pointerUp(e, cancelled = false) { pointers.delete(e.pointerId); if (pinch) {
    pinch = null;
    gesture = null;
    return;
} const g = gesture; gesture = null; if (!g)
    return; annotations.setPreview(null); if (cancelled)
    return; const p = position(e); if (g.kind === 'select' && g.moved < 4)
    await selectAt(...p,e.shiftKey);
else if (g.kind === 'text' && g.moved < 5)
    noteAt(engine.worldAt(...p));
else if (!['select', 'pan', 'text'].includes(g.kind) && g.moved >= 2)
    await finishGeometry(g.kind, g.world, engine.worldAt(...p)); }
canvas.addEventListener('pointerup', e => run(() => pointerUp(e)));
canvas.addEventListener('pointercancel', e => run(() => pointerUp(e, true)));
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('wheel', e => { if (!ready || loading || benchmarking)
    return; e.preventDefault(); const p = position(e), delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1); engine.zoomAt(...p, Math.exp(-Math.max(-600, Math.min(600, delta)) * .0015)); }, { passive: false });
window.addEventListener('keydown', e => { if (benchmarking) return; if (e.target.matches('input,textarea,select') || $('dialog').open)
    return; if(blocks.key(e))return; if (e.code === 'Space') {
    space = true;
    e.preventDefault();
    return;
} if ((e.ctrlKey || e.metaKey) && ['PageUp','PageDown'].includes(e.key)) {e.preventDefault();const list=documents.documents,index=list.findIndex(d=>d.id===documents.activeId);if(list.length)run(()=>switchDocument(list[(index+(e.key==='PageUp'?-1:1)+list.length)%list.length].id));return;} const key = e.key.toLowerCase(); if ((e.metaKey || e.ctrlKey) && key === 'o') {
    e.preventDefault();
    $('dxf-file').click();
    return;
} if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    e.shiftKey ? annotations.redo() : annotations.undo();
    return;
} if ((e.metaKey || e.ctrlKey) && key === 'y') {
    e.preventDefault();
    annotations.redo();
    return;
} if (key === 'escape') {
    gesture = null;
    annotations.setPreview(null);
    setTool('select');
    return;
} if (key === 'f') {
    engine.fit();
    return;
} if (key === 'g') {
    $('grid').click();
    return;
} const map = { v: 'select', h: 'pan', l: 'line', r: 'rect', c: 'circle', t: 'text', m: 'measure' }; if (map[key])
    setTool(map[key]); });
window.addEventListener('keyup', e => { if (e.code === 'Space')
    space = false; });
window.addEventListener('blur', () => { space = false; gesture = null; pointers.clear(); pinch = null; annotations.setPreview(null); });
let dragDepth = 0;
window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) {
    e.preventDefault();
    dragDepth++;
    $('drop-zone').hidden = false;
} });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) {
    dragDepth = 0;
    $('drop-zone').hidden = true;
} });
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('drop-zone').hidden = true; const files = [...e.dataTransfer.files]; if (files.length) run(() => openFiles(files)); });
decorate();renderTabs();
q('[data-tool]').forEach(el => el.onclick = () => setTool(el.dataset.tool));
$('open-dxf').onclick = () => $('dxf-file').click();
$('dxf-file').onchange = e => { const files = [...e.target.files]; if (files.length) run(() => openFiles(files)); e.target.value = ''; };
$('cancel-import').onclick = () => importer.cancel();
$('load-font').onclick = () => $('font-file').click();
$('font-file').onchange = e => { const file = e.target.files[0]; if (file)
    run(async () => { if (!ready || loading || benchmarking)
        return; busy('Compiling the GPU font', 'Decoding the font container and layout tables; glyph compilation and atlas generation run on compute shaders.'); try {
        await replaceFont(file);
    }
    finally {
        hideBusy();
    } }); e.target.value = ''; };
$('annotations-file').onchange = e => { const file = e.target.files[0]; if (file)
    run(async () => { annotations.load(JSON.parse(await file.text())); closeDialog(); }); e.target.value = ''; };
$('fit').onclick = () => engine.fit();
$('zoom-value').onclick = () => engine.fit();
$('zoom-in').onclick = () => engine.zoomAt(engine.cssWidth / 2, engine.cssHeight / 2, 1.25);
$('zoom-out').onclick = () => engine.zoomAt(engine.cssWidth / 2, engine.cssHeight / 2, .8);
$('undo').onclick = () => annotations.undo();
$('redo').onclick = () => annotations.redo();
$('grid').onclick = () => { engine.flags ^= 1; syncDisplay(); engine.requestFrame(); };
$('exact').onclick = () => { engine.flags ^= 2; syncDisplay(); engine.requestFrame(); };
$('text-quality').onchange = e => { engine.flags = e.target.value === 'adaptive' ? engine.flags | 2 : engine.flags & ~2; syncDisplay(); engine.requestFrame(); };
$('curve-quality').onchange = e => { engine.settings.curveTolerance = Number(e.target.value); engine.requestFrame(); };
$('stroke-width').oninput = e => { engine.settings.strokeWidth = Number(e.target.value); engine.requestFrame(); };
$('monochrome').onchange = e => { engine.flags = e.target.checked ? engine.flags | 4 : engine.flags & ~4; engine.requestFrame(); };
$('layer-filter').oninput = updateLayers;
$('sample-metrics').onclick = () => run(async () => { engine.render(); await engine.captureMetrics(); });
$('help').onclick = showHelp;
$('error-help').onclick = showHelp;
$('reload').onclick = () => location.reload();
$('lab-tab').onclick = showLab;
$('import-report').onclick = showReport;
$('export').onclick = showExport;
$('save').onclick = () => run(saveWorkspace);
$('restore').onclick = () => run(restoreWorkspace);
$('dialog-close').onclick = closeDialog;
$('dialog').onclick = e => { if (e.target === $('dialog')) {
    const r = $('dialog').getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        closeDialog();
} };
$('toggle-left').onclick = () => document.body.classList.toggle('left-open');
$('toggle-right').onclick = () => { if (innerWidth <= 980)
    document.body.classList.toggle('right-open');
else
    document.body.classList.toggle('hide-inspector'); };
const resize = new ResizeObserver(entries => { if (ready) {
    const { width, height } = entries[0].contentRect;
    try { engine.setSize(width, height, engine.options.pixelRatio * (engine.governor?.scale || 1)); } catch(error) { showError(error); }
} });
resize.observe($('canvas-wrap'));
setInterval(() => { if (ready && !loading && !benchmarking && $('auto-metrics').checked && document.visibilityState === 'visible' && engine.metrics.frames !== lastTelemetryFrame) {
    lastTelemetryFrame = engine.metrics.frames;
    engine.captureTiming().catch(e => showError(e));
} }, 1500);
api.ready = (async () => { try {
    await engine.initialize(font);
    ready = true;
    $('adapter-name').textContent = [engine.info.vendor, engine.info.architecture, engine.info.description].filter(Boolean).join(' · ');
    engine.setSize($('canvas-wrap').clientWidth, $('canvas-wrap').clientHeight, devicePixelRatio || 1);
    await loadDemo();
    setTool('select');
    syncDisplay();
    api.initialized = true;
    return api;
}
catch (error) {
    showError(error, true);
    api.initializationError = { message: error.message, details: error.details };
    return api;
} })();
window.addEventListener('pagehide', e => { if (!e.persisted) {
    importer.cancel();
    engine.dispose();
} });
