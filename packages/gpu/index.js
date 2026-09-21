import { EDIT_BINDINGS, selectRanges, snapPoint, explodeGeometry } from './edit-tools.js';
import { reconcileBlockModel, queuePlacement, uploadPlacement, encodePlacement } from './block-tools.js';
import { viewCamera, supportedPlanView } from '../dxf/spaces.js';
import { decodeGpuInterval } from '../performance/timing.js';
import { FramePlanner, ResolutionGovernor, summarizeSamples } from '../performance/index.js';
import { SHADERS, SHADER_MAPS } from './shaders.js';
import { compileKernels } from './compiler.js';
import { ReadbackPool } from './transfer.js';
import { PaperRasterState, paperQueueBytes } from './paper-cache.js';
import { ENTITY_BYTES, PAGE_ENTITIES, PageBuilder, rgba, split64 } from '../model/index.js';
const MiB = 1024 * 1024;
export const SCENE_BINDINGS = { identity: [1, 14], layoutText: [1, 3, 8, 12], generate: [1, 2], prepare: [1, 2, 3, 4, 6, 11, 12], reduceBounds: [1, 4], reset: [6], cull: [0, 1, 2, 4, 5, 6, 7, 14], cullScan: [0, 1, 2, 4, 5, 6, 7, 14], indirect: [6, 13], raster: [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16], rasterBatch: [0, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16], sampleText: [0, 1, 2, 3, 4, 5, 6], sumViewport: [6, 17], sumViewportCached: [6, 17] };
export const INDEX_BINDINGS = { spatialClear: [4], spatialAssign: [0, 1, 3, 4], spatialScan: [4], spatialScatter: [0, 2, 3, 4], spatialBounds: [0, 1, 2] };
export const PIXEL_BINDINGS = { clear: [0, 1], copyViewport: [0, 1, 9], resolve: [0, 1, 2, 3, 4, 9], resolveExact: [0, 2, 3, 4, 8], clearFragments: [0, 8], pick: [0, 1, 5, 6, 9], measure: [5, 7] };
export class CadGpuError extends Error {
    constructor(message, details = '') { super(message); this.name = 'CadGpuError'; this.details = details; }
}
function align(n, a = 4) { return Math.ceil(n / a) * a; }
function dispatchCount(n, size = 256) { const count = Math.ceil(n / size); return [Math.min(count, 65535), Math.ceil(count / 65535) || 1]; }
export class ComputeCad extends EventTarget {
    constructor(canvas, { memoryBudget = 768 * MiB, maxPixels = 8294400, pixelRatio = globalThis.devicePixelRatio || 1, powerPreference = 'high-performance', cache = true, batch = true, maxFramesInFlight = 1, fragmentCapacity = 4194304, paperCacheBudget = 64 * MiB } = {}) {
        super();
        if (!Number.isFinite(memoryBudget) || memoryBudget < 1048576 || !Number.isInteger(maxPixels) || maxPixels < 1 || !Number.isFinite(pixelRatio) || pixelRatio <= 0) throw new RangeError('Invalid GPU budget, pixel budget or pixel ratio.');
        this.canvas = canvas;
        this.options = { memoryBudget, maxPixels, pixelRatio, powerPreference, maxFramesInFlight, fragmentCapacity, paperCacheBudget };
        if (!Number.isSafeInteger(paperCacheBudget) || paperCacheBudget < 0) throw new RangeError('paperCacheBudget must be a non-negative safe integer.');
        this.paperCache = true; this.paperCacheBytes = 0; this.layerRevision = 0;
        if (![1, 2].includes(maxFramesInFlight)) throw new RangeError('maxFramesInFlight must be 1 or 2.');
        if (!Number.isInteger(fragmentCapacity) || fragmentCapacity < 1 || fragmentCapacity > 16777216) throw new RangeError('fragmentCapacity must be 1…16,777,216.');
        this.planner = new FramePlanner({ cache, batch }); this.overlayRevision = 0; this.fontRevision = 0;
        this.compositing = 'opaque'; this.governor = null;
        this.lastQueueMs = null; this.lastPlan = null;
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.flags = 3;
        this.selected = 0;
        this.hovered = 0;
        this.settings = { textLOD: 3.5, curveTolerance: .25, strokeWidth: 1 };
        this.frameData = new ArrayBuffer(128);
        this.frameF = new Float32Array(this.frameData);
        this.frameU = new Uint32Array(this.frameData);
        this.previousFrameU = new Uint32Array(32); this.uniformInitialized = false;
        this.resolveGroups = new WeakMap(); this.compaction = 'mask';
        this.metrics = { frames: 0, cpuMs: 0, gpuMs: null, gpuTimingStatus: 'not-sampled', gpuTimingScope: 'compute-pass', visible: 0, proxyTexts: 0, glyphs: 0, bytesUploaded: 0, bytesReadback: 0, frameUniformBytes: 0, uniformWriteCalls: 0, indirectBuilds: 0, indirectCacheHits: 0, clearCommands: 0, baseCacheHits: 0, overlayCacheHits: 0, cullPasses: 0, visibilityCacheHits: 0, dispatches: 0, batchEntities: 0, cooperativeEntities: 0, fragmentOverflow: false, queueCompletionMs: null };
        this.pages = []; this.viewPages = null; this.activeSpace = null; this.paperResources = new Map();
        this.annotationPages = [];
        this.previewPages = [];
        this.model = null;
        this.disposed = false;
        this.pendingFrame = 0;
        this.errors = [];
        this.gpuBytes = 0;
        this.lastFrameAt = 0;
        this.measuring = false;
        this.preparing = false;
        this.inFlight = 0;
        this.frameDirty = false;
        this.queryTail = Promise.resolve(); this.sceneEpoch = 0; this.timingFrame = null; this.timingPending = null;
    }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    async initialize(font) {
        if (!globalThis.isSecureContext)
            throw new CadGpuError('WebGPU requires HTTPS or localhost.', 'Serve this application on HTTPS or run npm start on localhost.');
        if (!navigator.gpu)
            throw new CadGpuError('WebGPU is not available in this browser.', 'No Canvas2D/WebGL fallback is used. Enable a supported WebGPU browser and GPU driver.');
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: this.options.powerPreference });
        if (!adapter) throw new CadGpuError('No WebGPU adapter is available.');
        return this.initializeAdapter(font, adapter, this.canvas.getContext('webgpu'));
    }
    /** Native/headless hosts supply an actual WebGPU adapter and texture presentation target.
     * Browser initialize() retains the HTTPS and navigator.gpu checks above. */
    async initializeAdapter(font, adapter, context) {
        if (this.device || this.initializing || this.disposed) throw new CadGpuError('The engine is already initialized, initializing, or disposed.');
        if (!adapter || !context) throw new CadGpuError('A WebGPU adapter and presentation context are required.');
        this.initializing = true;
        try {
        this.adapter = adapter;
        const optional = ['timestamp-query'].filter(f => this.adapter.features.has(f));
        this.hasTimestamps = optional.includes('timestamp-query');
        this.device = await this.adapter.requestDevice({ label: 'Aperture compute device', requiredFeatures: optional, requiredLimits: { maxStorageBufferBindingSize: Math.min(this.adapter.limits.maxStorageBufferBindingSize, 512 * MiB), maxBufferSize: Math.min(this.adapter.limits.maxBufferSize, 1024 * MiB) } });
        this.readbacks = new ReadbackPool((size) => {
            if (this.allocatedBytes() + size > this.options.memoryBudget) throw new CadGpuError('Readback pool exceeds the GPU allocation budget.');
            return this.buffer('Pooled explicit readback', size, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        });
        this.info = { vendor: this.adapter.info?.vendor || 'unknown', architecture: this.adapter.info?.architecture || '', device: this.adapter.info?.device || '', description: this.adapter.info?.description || 'WebGPU adapter', timestampQuery: this.hasTimestamps, maxBindingBytes: this.device.limits.maxStorageBufferBindingSize };
        this.device.addEventListener('uncapturederror', e => { this.errors.push(e.error.message); this.emit('error', new CadGpuError(e.error.message)); });
        this.device.lost.then(info => { if (!this.disposed) {
            this.lost = true;
            this.disposed = true;
            this.emit('error', new CadGpuError('The GPU device was lost.', info.message + ' Reload the application to rebuild GPU resources.'));
        } });
        this.context = context;
        if (!this.context)
            throw new CadGpuError('Cannot create a WebGPU canvas context.');
        // rgba8unorm is storage-writable without the optional bgra8unorm-storage feature.
        this.context.configure({ device: this.device, format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque', colorSpace: 'srgb' });
        this.atlasSampler = this.device.createSampler({ label: 'Bilinear distance atlas', minFilter: 'linear', magFilter: 'linear' });
        this.paperStats = this.buffer('Sheet viewport candidate summary', 64, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        this.fragmentBuffer = this.buffer('Inactive exact-fragment arena', 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        this.frameBuffer = this.buffer('Camera / frame (128 bytes)', 128, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.pickBuffer = this.buffer('Small query result', 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        this.pickParams = this.buffer('Pick query', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.measureParams = this.buffer('Measurement query', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        const compiled = await compileKernels(this.device, SHADERS, SHADER_MAPS,
            { scene: SCENE_BINDINGS, index: INDEX_BINDINGS, pixels: PIXEL_BINDINGS,
                font: { bake: [0, 1, 2] }, stroke: { compileStroke: [0, 1, 2] }, edit:EDIT_BINDINGS });
        this.pipelines = compiled.pipelines; this.compilation = compiled.report;
        if (this.hasTimestamps) {
            this.querySet = this.device.createQuerySet({ label: 'Frame GPU timings', type: 'timestamp', count: 2 });
            this.queryResolve = this.buffer('GPU timestamp resolve', 16, GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC);
        }
        await this.setFont(font);
        this.setSize(this.canvas.clientWidth || 1024, this.canvas.clientHeight || 700, this.options.pixelRatio);
        return this;
        } catch (error) { this.dispose(); throw error; }
        finally { this.initializing = false; }
    }
    buffer(label, size, usage, data = null) {
        size = align(Math.max(size, 4));
        if (size > this.device.limits.maxBufferSize)
            throw new CadGpuError(label + ' exceeds the adapter buffer limit.');
        if ((usage & GPUBufferUsage.STORAGE) && size > this.device.limits.maxStorageBufferBindingSize)
            throw new CadGpuError(label + ' exceeds the adapter storage-binding limit.');
        const buffer = this.device.createBuffer({ label, size, usage, mappedAtCreation: !!data });
        if (data) {
            new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength));
            buffer.unmap();
            this.metrics.bytesUploaded += data.byteLength;
        }
        return buffer;
    }
    group(entry, resources, bindings) { return this.device.createBindGroup({ label: entry + ' resources', layout: this.pipelines[entry].getBindGroupLayout(0), entries: bindings.map(binding => { const r = resources[binding]; if (!r)
            throw new CadGpuError(`Missing ${entry} resource ${binding}`); return { binding, resource: r instanceof GPUBuffer ? { buffer: r } : r }; }) }); }
    async setFont(font) {
        if (this.benchmarking) throw new CadGpuError('Cannot replace the font during a benchmark.');
        if (!font?.glyphs?.length || font.count !== font.glyphs.length) throw new CadGpuError('Invalid font model.');
        const extent = this.device.limits.maxTextureDimension2D;
        if (font.atlasWidth > extent || font.atlasHeight > extent) throw new CadGpuError('Font atlas exceeds the adapter texture limit. Use a smaller atlas cell or fewer glyphs.');
        const old = { fontBuffer: this.fontBuffer, fontInfo: this.fontInfo, atlas: this.atlas, atlasView: this.atlasView, font: this.font };
        let fontBuffer, fontInfo, atlas, programBuffer, readback;
        await this.device.queue.onSubmittedWorkDone();
        try {
            const all = new Uint8Array(font.meta.byteLength + font.edges.byteLength + (font.layoutData?.byteLength || 0));
            all.set(new Uint8Array(font.meta)); all.set(new Uint8Array(font.edges.buffer, font.edges.byteOffset, font.edges.byteLength), font.meta.byteLength);
            if (font.layoutData) all.set(new Uint8Array(font.layoutData.buffer, font.layoutData.byteOffset, font.layoutData.byteLength), font.meta.byteLength + font.edges.byteLength);
            this.trimPaperCaches(all.byteLength + font.atlasWidth * font.atlasHeight * 4 + 96 + (font.strokeProgram ? font.strokeProgram.byteLength + font.meta.byteLength : 0));
            const fontPeak = this.allocatedBytes() + all.byteLength + font.atlasWidth * font.atlasHeight * 4 + 96 + (font.strokeProgram ? font.strokeProgram.byteLength + font.meta.byteLength : 0);
            if (fontPeak > this.options.memoryBudget) throw new CadGpuError('Font replacement exceeds the GPU budget, including overlapping old/new resources.');
            fontBuffer = this.buffer('Glyph outlines, metrics and OpenType programs', all.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC, all);
            const info = new ArrayBuffer(96), u = new Uint32Array(info), f = new Float32Array(info);
            const fillInfo = () => {
                u.set([font.atlasWidth, font.atlasHeight, font.count, font.meta.byteLength / 4]);
                const digitIds = Array.from({ length: 10 }, (_, i) => font.map.get(48 + i) ?? 0);
                const advance = Math.max(.01, ...digitIds.map(i => font.glyphs[i].advance));
                f.set([advance, font.cellSize || 64, font.atlasWidth / (font.cellSize || 64), font.capHeight ? 1 / font.capHeight : 0], 4); u.set(digitIds, 8);
                u[18] = font.layoutData ? (font.meta.byteLength + font.edges.byteLength) / 4 : 0;
                u[19] = font.strokeProgram ? Number(font.vertical) : Number(!!font.layoutData);
                f.set([Math.min(...font.glyphs.map(g => g.box[0])), Math.max(...font.glyphs.map(g => g.box[2])), Math.min(...font.glyphs.map(g => g.box[1])), Math.max(...font.glyphs.map(g => g.box[3]))], 20);
            };
            fillInfo(); fontInfo = this.buffer('Font atlas ABI', 96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, info);
            if (font.strokeProgram) {
                programBuffer = this.buffer('Parsed SHX/SHP bytecode', font.strokeProgram.byteLength, GPUBufferUsage.STORAGE, font.strokeProgram);
                const encoder = this.device.createCommandEncoder({ label: 'Compile SHX/SHP glyph geometry on GPU' }), pass = encoder.beginComputePass();
                pass.setPipeline(this.pipelines.compileStroke); pass.setBindGroup(0, this.group('compileStroke', { 0: fontBuffer, 1: fontInfo, 2: programBuffer }, [0, 1, 2])); pass.dispatchWorkgroups(font.count); pass.end();
                readback = this.buffer('One-time font metrics and status', font.meta.byteLength, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
                encoder.copyBufferToBuffer(fontBuffer, 0, readback, 0, font.meta.byteLength); this.device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
                const data = readback.getMappedRange(), ru = new Uint32Array(data), rf = new Float32Array(data);
                for (let i = 0; i < font.count; i++) {
                    const o = i * 12; if (ru[o + 3]) throw new CadGpuError('Stroke glyph program rejected: glyph ' + i + ', status ' + ru[o + 3]);
                    const box = Array.from(rf.subarray(o + 4, o + 8)), advance = rf[o + 8];
                    if (!box.every(Number.isFinite) || !Number.isFinite(advance) || advance < 0) throw new CadGpuError('Unsupported non-finite or negative-advance SHX glyph.');
                    Object.assign(font.glyphs[i], { box, advance });
                }
                this.metrics.bytesReadback += data.byteLength; readback.unmap(); fillInfo(); this.device.queue.writeBuffer(fontInfo, 0, info); this.metrics.bytesUploaded += info.byteLength;
            }
            atlas = this.device.createTexture({ label: 'GPU-generated glyph SDF atlas', size: [font.atlasWidth, font.atlasHeight], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC });
            const atlasView = atlas.createView(), bind = this.group('bake', { 0: fontBuffer, 1: fontInfo, 2: atlasView }, [0, 1, 2]);
            const command = this.device.createCommandEncoder({ label: 'Bake glyph atlas on GPU' }), pass = command.beginComputePass();
            pass.setPipeline(this.pipelines.bake); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(font.atlasWidth / 8), Math.ceil(font.atlasHeight / 8)); pass.end();
            this.device.queue.submit([command.finish()]); await this.device.queue.onSubmittedWorkDone();
            Object.assign(this, { fontBuffer, fontInfo, atlas, atlasView, font }); this.fontRevision++; this.planner.invalidate(); this.needsModelRebuild = !!this.model;
            old.fontBuffer?.destroy(); old.fontInfo?.destroy(); old.atlas?.destroy();
        } catch (error) { fontBuffer?.destroy(); fontInfo?.destroy(); atlas?.destroy(); throw error; }
        finally { programBuffer?.destroy(); readback?.destroy(); }
    }
    setSize(width, height, pixelRatio = this.options.pixelRatio) {
        if (![width, height, pixelRatio].every(Number.isFinite) || width < 0 || height < 0 || pixelRatio <= 0) throw new RangeError('Viewport dimensions and pixel ratio must be finite and non-negative.');
        if (!this.device) return;
        width = Math.max(1, width); height = Math.max(1, height);
        const cap = Math.sqrt(this.options.maxPixels / (width * height));
        const ratio = Math.min(Math.max(.01, pixelRatio), 2, cap, this.device.limits.maxTextureDimension2D / width, this.device.limits.maxTextureDimension2D / height);
        const w = Math.max(1, Math.floor(width * ratio)), h = Math.max(1, Math.floor(height * ratio));
        if (w === this.canvas.width && h === this.canvas.height && this.pixelBuffer) {
            const changed = this.cssWidth !== width || this.cssHeight !== height || this.ratio !== ratio;
            this.cssWidth = width; this.cssHeight = height; this.ratio = ratio;
            if (changed) { this.planner.invalidate(); this.requestFrame(); }
            return;
        }
        const fragmentBytes = this.compositing === 'exact' ? 16 + w * h * 4 + this.options.fragmentCapacity * 8 : 0;
        this.trimPaperCaches(w * h * 8 + fragmentBytes);
        const peak = this.allocatedBytes() + w * h * 8 + fragmentBytes;
        if (peak > this.options.memoryBudget) throw new CadGpuError('Resizing would exceed the GPU allocation budget, including replacement surfaces. Reduce pixelRatio or maxPixels.');
        let base, overlay, fragments;
        try {
            base = this.buffer('Persistent base coverage / entity-ID surface', w * h * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
            overlay = this.buffer('Overlay coverage / entity-ID surface', w * h * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
            if (fragmentBytes) fragments = this.buffer('Bounded exact source-over fragment arena', fragmentBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        } catch (error) { base?.destroy(); overlay?.destroy(); fragments?.destroy(); throw error; }
        const previous = [this.basePixelBuffer, this.pixelBuffer, fragments ? this.fragmentBuffer : null];
        this.basePixelBuffer = base; this.pixelBuffer = overlay; if (fragments) this.fragmentBuffer = fragments;
        this.canvas.width = w; this.canvas.height = h; this.cssWidth = width; this.cssHeight = height; this.ratio = ratio;
        this.planner.invalidate();
        for (const p of [...this.pages, ...this.annotationPages, ...this.previewPages]) this.bindPage(p);
        this.bindPixels(); for (const resource of previous) resource?.destroy(); this.requestFrame();
    }
    bindPixels() { this.disposePaperResources(); this.resolveGroups = new WeakMap(); if (!this.pixelBuffer)
        return; const base = { 0: this.frameBuffer, 1: this.pixelBuffer, 2: this.styleBuffer, 3: this.layerBuffer, 5: this.pickBuffer, 6: this.pickParams, 7: this.measureParams, 8: this.fragmentBuffer, 9: this.basePixelBuffer }; this.pixelGroups = { clear: this.group('clear', base, PIXEL_BINDINGS.clear), clearBase: this.group('clear', { ...base, 1: this.basePixelBuffer }, PIXEL_BINDINGS.clear), clearFragments: this.group('clearFragments', base, PIXEL_BINDINGS.clearFragments), pick: this.group('pick', base, PIXEL_BINDINGS.pick), measure: this.group('measure', base, PIXEL_BINDINGS.measure) }; }
    bindPage(p) { const resources = { 0: this.frameBuffer, 1: p.header, 2: p.entities, 3: p.aux, 4: p.bounds, 5: p.visible, 6: p.stats, 7: this.layerBuffer, 8: this.fontBuffer, 9: p.overlay ? this.pixelBuffer : this.basePixelBuffer, 10: this.atlasView, 11: this.styleBuffer, 12: this.fontInfo, 13: p.indirect, 14: p.order, 15: this.fragmentBuffer, 16: this.atlasSampler, 17: this.paperStats }; p.groups = {}; for (const [entry, bindings] of Object.entries(SCENE_BINDINGS))
        p.groups[entry] = this.group(entry, resources, bindings); }
    makePage(source, origin, synthetic = null, overlay = false) {
        const n = source.count, leaves = Math.ceil(n / 128);
        const h = new ArrayBuffer(48), u = new Uint32Array(h), f = new Float32Array(h);
        const [xh, xl] = split64(origin[0]), [yh, yl] = split64(origin[1]);
        f.set([xh, yh, xl, yl]);
        u.set([n, leaves, source.idBase, source.runCount], 4);
        u.set([source.runTable, synthetic?.mode || 0, synthetic?.total || 0, synthetic?.run || 0], 8);
        const owned = []; const allocate = (...args) => { const resource = this.buffer(...args); owned.push(resource); return resource; };
        try {
        const p = { overlay, count: n, leaves, idBase: source.idBase, source, header: allocate('Page header', 48, GPUBufferUsage.UNIFORM, new Uint8Array(h)), entities: allocate('Packed source entities', n * ENTITY_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, source.entities), aux: allocate('Page paths, glyph runs, INSERT hierarchy', source.aux.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, source.aux), bounds: allocate('GPU entity and cluster bounds', (n + leaves * 2 + 1) * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC), order: allocate('GPU Morton-bucket entity order', n * 4, GPUBufferUsage.STORAGE), visible: allocate('Exact-capacity visible entity queue', n * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC), stats: allocate('Visible count and telemetry', 64, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST), indirect: allocate('Cooperative, batched and diagnostic indirect arguments', 48, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC) };
        p.bytes = p.entities.size + p.aux.size + p.bounds.size + p.visible.size + p.order.size + p.header.size + p.stats.size + p.indirect.size;
        p.destroy = () => { for (const key of ['header', 'entities', 'aux', 'bounds', 'visible', 'order', 'stats', 'indirect'])
            p[key].destroy(); };
        this.bindPage(p);
        return p;
        } catch (error) { for (const resource of owned) resource.destroy(); throw error; }
    }
    async setModel(model) {
        if (this.benchmarking) throw new CadGpuError('Cannot replace the drawing during a benchmark.');
        if (this.preparing)
            throw new CadGpuError("A model preparation is already in progress.");
        if ((!model.count || !model.pages.length) && !model.spaces)
            throw new CadGpuError("Cannot display an empty model.");
        if (model.count > 0x00ff0000)
            throw new CadGpuError('The deterministic picking/compositing ABI supports up to 16,711,680 base entities.');
        const estimated = model.pages.reduce((s, p) => s + p.count * 152 + p.aux.byteLength + Math.ceil(p.count / 128) * 32 + 176, 0) + (model.count + 65536) * 8 + this.canvas.width * this.canvas.height * 8 + this.fragmentBuffer.size + this.font.atlasWidth * this.font.atlasHeight * 4 + (this.fontBuffer?.size || 0) + (this.fontInfo?.size || 0) + (model.layers.length + 2) * 16 + Math.max(1, ...model.pages.map(p => p.count)) * 8 + 2048 + model.pages.length * 16 + 512;
        if (estimated > this.options.memoryBudget)
            throw new CadGpuError(`The model needs approximately ${(estimated / MiB).toFixed(0)} MiB GPU memory; the configured budget is ${(this.options.memoryBudget / MiB).toFixed(0)} MiB.`, `Raise memoryBudget explicitly only on a device with sufficient memory. The model was not silently truncated.`);
        // Validate every binding before replacing the resident scene.
        const limit = this.device.limits.maxStorageBufferBindingSize;
        if ((model.count + 65536) * 8 > limit || model.pages.some(p => p.count * ENTITY_BYTES > limit || p.aux.byteLength > limit))
            throw new CadGpuError('A model buffer exceeds this adapter’s storage-binding limit.');
        this.preparing = true;
        try {
            await this.device.queue.onSubmittedWorkDone();
            this.disposeScene(); this.planner.invalidate();
            this.model = model;
            this.layers = [...model.layers.map(l => ({ ...l })), { name: 'Annotations', color: rgba('#ffb05c'), visible: true }, { name: 'Measurements', color: rgba('#7df2d2'), visible: true }];
            this.annotationLayer = model.layers.length;
            this.layerBuffer = this.buffer('Layer palette and visibility', Math.max(16, this.layers.length * 16), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            this.uploadLayers();
            this.styleBuffer = this.buffer('Stable global entity style table', (model.count + 65536) * 8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
            this.device.pushErrorScope('out-of-memory');
            this.device.pushErrorScope('validation');
            try {
                for (const source of model.pages)
                    this.pages.push(this.makePage(source, source.origin || model.origin, model.synthetic ? { ...model.synthetic, run: source.demoRun } : null));
                const maxPage = Math.max(1, ...this.pages.map(p => p.count));
                this.indexRanks = this.buffer('Reused spatial rank scratch', maxPage * 8, GPUBufferUsage.STORAGE);
                this.indexBuckets = this.buffer('Reused Morton histogram and prefix', 2048, GPUBufferUsage.STORAGE);
                const encoder = this.device.createCommandEncoder({ label: 'GPU text layout, model transforms and hierarchy construction' }), pass = encoder.beginComputePass();
                for (const p of this.pages) {
                    if (model.synthetic) {
                        pass.setPipeline(this.pipelines.generate);
                        pass.setBindGroup(0, p.groups.generate);
                        pass.dispatchWorkgroups(Math.ceil(p.count / 128));
                    }
                    if (p.source.runCount) {
                        pass.setPipeline(this.pipelines.layoutText);
                        pass.setBindGroup(0, p.groups.layoutText);
                        pass.dispatchWorkgroups(Math.ceil(p.source.runCount / 64));
                    }
                    pass.setPipeline(this.pipelines.prepare);
                    pass.setBindGroup(0, p.groups.prepare);
                    pass.dispatchWorkgroups(p.leaves);
                    pass.setPipeline(this.pipelines.reduceBounds);
                    pass.setBindGroup(0, p.groups.reduceBounds);
                    pass.dispatchWorkgroups(1);
                    const indexResources = { 0: p.header, 1: p.bounds, 2: p.order, 3: this.indexRanks, 4: this.indexBuckets };
                    for (const [entry, bindings] of Object.entries(INDEX_BINDINGS)) {
                        pass.setPipeline(this.pipelines[entry]);
                        pass.setBindGroup(0, this.group(entry, indexResources, bindings));
                        pass.dispatchWorkgroups(entry === 'spatialClear' || entry === 'spatialScan' ? 1 : p.leaves);
                    }
                }
                pass.end();
                const readback = this.buffer('One-time bounds readback', Math.max(16, this.pages.length * 16), GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
                this.pages.forEach((p, i) => encoder.copyBufferToBuffer(p.bounds, (p.count + p.leaves) * 16, readback, i * 16, 16));
                this.device.queue.submit([encoder.finish()]);
                await readback.mapAsync(GPUMapMode.READ);
                const boxes = new Float32Array(readback.getMappedRange());
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (let i = 0; i < this.pages.length * 4; i += 4) {
                    this.pages[i / 4].finiteBounds = Array.from(boxes.subarray(i, i + 4));
                    minX = Math.min(minX, boxes[i]);
                    minY = Math.min(minY, boxes[i + 1]);
                    maxX = Math.max(maxX, boxes[i + 2]);
                    maxY = Math.max(maxY, boxes[i + 3]);
                }
                readback.unmap();
                readback.destroy();
                this.metrics.bytesReadback += this.pages.length * 16;
                this.extents = Number.isFinite(minX) && maxX >= minX && Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY)) < 1e20 ? [minX, minY, maxX, maxY] : [-100, -100, 100, 100];
            }
            catch (error) {
                await this.device.popErrorScope();
                await this.device.popErrorScope();
                throw error;
            }
            const validation = await this.device.popErrorScope(), memory = await this.device.popErrorScope();
            if (validation || memory)
                throw new CadGpuError((validation || memory).message);
            this.gpuBytes = estimated; this.needsModelRebuild = false;
            this.bindPixels();
            this.selected = 0;
            if (model.spaces) this.setSpace(model.initialSpace || 'model'); else { this.viewPages = this.pages; this.activeSpace = null; this.camera.angle = 0; this.fit(); }
            this.emit('model', model);
            return this;
        }
        catch (error) {
            this.disposeScene();
            throw error;
        }
        finally {
            this.indexRanks?.destroy();
            this.indexBuckets?.destroy();
            this.indexRanks = null;
            this.indexBuckets = null;
            this.preparing = false;
            this.requestFrame();
        }
    }
    selectEntities(ranges=[]){return selectRanges(this,ranges);}
    snap(x,y,options){return snapPoint(this,x,y,options);}
    explode(ranges,options){return explodeGeometry(this,ranges,options);}
    async reconcileModel(model) { return reconcileBlockModel(this,model,INDEX_BINDINGS); }
    updateBlockPreview(values) { queuePlacement(this,values); }
    uploadLayers() { this.layerRevision++; if (!this.layerBuffer)
        return; const a = new Uint32Array(this.layers.length * 4); this.layers.forEach((l, i) => a.set([l.color, l.visible ? 1 : 0, l.locked ? 1 : 0, 0], i * 4)); this.device.queue.writeBuffer(this.layerBuffer, 0, a); this.metrics.bytesUploaded += a.byteLength; }
    updateLayer(index, patch) { if (this.benchmarking) throw new CadGpuError('Cannot change layers during a benchmark.'); if (!this.layers[index])
        throw new RangeError('Unknown layer.'); Object.assign(this.layers[index], patch); if ('visible' in patch) { this.layerRevision++; this.planner.invalidate(); } const l = this.layers[index], a = new Uint32Array([l.color, l.visible ? 1 : 0, l.locked ? 1 : 0, 0]); this.device.queue.writeBuffer(this.layerBuffer, index * 16, a); this.metrics.bytesUploaded += 16; this.requestFrame(); }
    async setAnnotations(model) {
        await this.updateOverlay(model, 'annotationPages');
        for (const p of this.previewPages) p.destroy();
        this.previewPages = []; this.overlayRevision++; this.requestFrame();
    }
    async setPreview(model) { return this.updateOverlay(model, 'previewPages'); }
    async updateOverlay(model, key) {
        if (!this.model || this.preparing || this.benchmarking) throw new CadGpuError('An idle resident drawing is required for an annotation update.');
        const committed = key === 'previewPages' ? this.annotationPages.reduce((n, p) => n + p.count, 0) : 0;
        if (model.count + committed >= 65535) throw new CadGpuError('The annotation reservation is limited to 65,534 entities including the preview.');
        const nextBytes = model.pages.reduce((n, p) => n + p.count * 152 + p.aux.byteLength + Math.ceil(p.count / 128) * 32 + 176, 0);
        this.trimPaperCaches(nextBytes);
        if (this.allocatedBytes() + nextBytes > this.options.memoryBudget) throw new CadGpuError('Annotation replacement exceeds the GPU budget, including old and new pages.');
        for (const p of model.pages) if (p.aux.byteLength > this.device.limits.maxStorageBufferBindingSize || p.count * ENTITY_BYTES > this.device.limits.maxStorageBufferBindingSize) throw new CadGpuError('Annotation page exceeds the adapter binding limit.');
        const replacement=[];
        try {
            for (const source of model.pages) if(source.count) replacement.push(this.makePage(source,this.model.origin,null,true));
            if (replacement.length) {
                const encoder=this.device.createCommandEncoder({label:key==='previewPages'?'Transient overlay only':'Committed annotation replacement'}),pass=encoder.beginComputePass();
                for (const p of replacement) {
                    pass.setPipeline(this.pipelines.identity);pass.setBindGroup(0,p.groups.identity);pass.dispatchWorkgroups(p.leaves);
                    if(p.source.runCount){pass.setPipeline(this.pipelines.layoutText);pass.setBindGroup(0,p.groups.layoutText);pass.dispatchWorkgroups(Math.ceil(p.source.runCount/64));}
                    pass.setPipeline(this.pipelines.prepare);pass.setBindGroup(0,p.groups.prepare);pass.dispatchWorkgroups(p.leaves);
                }
                pass.end();this.device.queue.submit([encoder.finish()]);
            }
        } catch(error) {for(const page of replacement)page.destroy();throw error;}
        const previous=this[key];this[key]=replacement;this.overlayRevision++;for(const page of previous)page.destroy();this.requestFrame();
    }
    disposeScene() { this.selectionRanges=[]; this.disposePaperResources(); this.viewPages = null; this.activeSpace = null; this.sceneEpoch++; this.timingFrame = null; this.resetTiming(); this.planner.invalidate(); for (const p of [...this.pages, ...this.annotationPages, ...this.previewPages])
        p.destroy(); this.pages = []; this.annotationPages = []; this.previewPages = []; this.layerBuffer?.destroy(); this.styleBuffer?.destroy(); this.layerBuffer = null; this.styleBuffer = null; this.model = null; }
    fit(bounds = this.extents) { if (!bounds)
        return; this.camera.x = (bounds[0] + bounds[2]) * .5; this.camera.y = (bounds[1] + bounds[3]) * .5; const co=Math.abs(Math.cos(this.camera.angle||0)),si=Math.abs(Math.sin(this.camera.angle||0)),w=bounds[2]-bounds[0],h=bounds[3]-bounds[1];this.camera.zoom = Math.max(1e-8, Math.min(this.cssWidth * .88 / Math.max(1e-8, co*w+si*h), this.cssHeight * .84 / Math.max(1e-8, si*w+co*h))); this.requestFrame(); }
    worldAt(x, y) { return this.screenToWorld(x,y); }
    screenToWorld(x,y) { const dx=(x-this.cssWidth/2)/this.camera.zoom,dy=(this.cssHeight/2-y)/this.camera.zoom,c=Math.cos(this.camera.angle||0),s=Math.sin(this.camera.angle||0);return [this.camera.x+c*dx-s*dy+(this.model?.origin[0]||0),this.camera.y+s*dx+c*dy+(this.model?.origin[1]||0)]; }
    zoomAt(x,y,factor) { const p=this.screenToWorld(x,y);this.camera.zoom=Math.max(1e-8,Math.min(1e9,this.camera.zoom*factor));const q=this.screenToWorld(x,y);this.camera.x+=p[0]-q[0];this.camera.y+=p[1]-q[1];this.requestFrame(); }
    pan(dx,dy) { const c=Math.cos(this.camera.angle||0),s=Math.sin(this.camera.angle||0);this.camera.x-=(c*dx+s*dy)/this.camera.zoom;this.camera.y+=(c*dy-s*dx)/this.camera.zoom;this.requestFrame(); }
    requestFrame() { if (this.pendingFrame || this.disposed || !this.device)
        return; this.pendingFrame = requestAnimationFrame(() => { this.pendingFrame = 0; try {
        this.render();
    }
    catch (error) {
        this.emit('error', error);
    } }); }
    /** Reuse one host staging block. Only a changed, four-byte-aligned span crosses the queue. */
    writeFrame() {
        const f = this.frameF, u = this.frameU, c = this.camera;
        f[0] = Math.fround(c.x); f[1] = Math.fround(c.y); f[2] = c.x - f[0]; f[3] = c.y - f[1];
        f[4] = this.canvas.width; f[5] = this.canvas.height; f[6] = c.zoom * this.ratio; f[7] = this.ratio;
        f[8] = this.settings.textLOD; f[9] = this.settings.curveTolerance; f[10] = this.settings.strokeWidth;
        u[12] = this.selected; u[13] = this.flags; u[14] = this.hovered;
        f[16] = .035; f[17] = .047; f[18] = .065; f[19] = 1;
        f[20] = this.planner.guardBand; f[21] = Number(this.planner.batch);
        // Grid spacing depends only on the frame, never on a pixel. Keep the 128-byte ABI.
        f[22] = 10 ** Math.floor(Math.log(100 / f[6]) / Math.LN10);
        f[24] = Math.cos(c.angle || 0); f[25] = Math.sin(c.angle || 0);
        f[28] = this.options.fragmentCapacity;
        f[29] = Number(this.annotationPages.length > 0 || this.previewPages.length > 0);
        let first = 0, last = 31;
        if (this.uniformInitialized) {
            while (first < 32 && u[first] === this.previousFrameU[first]) first++;
            while (last >= first && u[last] === this.previousFrameU[last]) last--;
        }
        const bytes = Math.max(0, last - first + 1) * 4;
        if (bytes) {
            this.device.queue.writeBuffer(this.frameBuffer, first * 4, this.frameData, first * 4, bytes);
            this.previousFrameU.set(u); this.uniformInitialized = true;
            this.metrics.bytesUploaded += bytes; this.metrics.uniformWriteCalls++;
        }
        this.metrics.frameUniformBytes = bytes; return bytes;
    }
    frameDescriptor() { return { camera: this.camera, width: this.canvas.width, height: this.canvas.height, ratio: this.ratio, settings: this.settings, flags: this.flags, fontRevision: this.fontRevision }; }
    allocateFragments() {
        const size = 16 + this.canvas.width * this.canvas.height * 4 + this.options.fragmentCapacity * 8;
        const used = this.allocatedBytes() + size; // Old and replacement buffers overlap until the swap.
        if (used > this.options.memoryBudget) throw new CadGpuError('Exact compositing exceeds the configured GPU memory budget. Reduce fragmentCapacity or increase memoryBudget.');
        if (size === this.fragmentBuffer?.size) return;
        const next = this.buffer('Bounded exact source-over fragment arena', size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST);
        this.fragmentBuffer?.destroy(); this.fragmentBuffer = next;
    }
    setCompositing(mode = 'opaque') {
        if (this.benchmarking) throw new CadGpuError('Cannot change compositing during a benchmark.');
        if (!['opaque', 'exact'].includes(mode)) throw new RangeError('Unknown compositing mode.');
        if (mode === 'exact' && this.activeSpace?.viewports?.some(v => v.number !== 1 && v.supported)) throw new CadGpuError('Ordered alpha is not supported in composed paper viewports. Select Model space to use it.');
        if (mode === this.compositing) return;
        if (mode === 'exact') this.allocateFragments();
        else { const next = this.buffer('Disabled exact compositor', 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST); this.fragmentBuffer.destroy(); this.fragmentBuffer = next; }
        this.compositing = mode; this.flags = mode === 'exact' ? this.flags | 8 : this.flags & ~8;
        this.planner.invalidate(); for (const p of [...this.pages, ...this.annotationPages, ...this.previewPages]) this.bindPage(p);
        this.bindPixels(); this.requestFrame();
    }
    setPerformance({ cache = this.planner.cache, batch = this.planner.batch, guardBand = this.planner.guardBand, compaction = this.compaction, paperCache = this.paperCache } = {}) {
        if (this.benchmarking) throw new CadGpuError('Cannot change performance settings during a benchmark.');
        if (!Number.isFinite(guardBand) || !(guardBand >= 0 && guardBand <= 1)) throw new RangeError('guardBand must be between 0 and 1.');
        if (!['mask', 'scan'].includes(compaction)) throw new RangeError('compaction must be mask or scan.');
        if (this.paperCache !== !!paperCache) this.disposePaperResources();
        this.paperCache = !!paperCache; this.compaction = compaction; Object.assign(this.planner, { cache: !!cache, batch: !!batch, guardBand }); this.planner.invalidate(); this.requestFrame();
    }
    setAdaptiveResolution(options = null) { if (options && !this.hasTimestamps) throw new CadGpuError('Adaptive resolution requires actual GPU timestamp support; CPU encoding time is not substituted.'); this.governor = options ? new ResolutionGovernor(options) : null; if (!options) this.setSize(this.cssWidth, this.cssHeight, this.options.pixelRatio); }
    render() {
        if (!this.model || this.disposed || this.preparing || this.suspended || this.needsModelRebuild || !this.pixelBuffer) return false;
        if (this.inFlight >= this.options.maxFramesInFlight) { this.frameDirty = true; return false; }
        this.frameDirty = false; const start = performance.now(), frame = this.frameDescriptor(), basePages = this.viewPages || this.pages;
        const plan = this.planner.plan(frame, { overlayRevision: this.overlayRevision, exact: this.compositing === 'exact' });
        uploadPlacement(this); this.writeFrame(); const encoder = this.device.createCommandEncoder({ label: 'Compute CAD: persistent dispatch / sparse transfers' });
        let dispatches = 0, culled = 0, reused = 0, clearCommands = 0;
        // Both timestamps belong to the SAME nonempty pass. Native fills before it
        // are intentionally excluded; do not label this compute interval as presentation time.
        // Native buffer fills precede compute work. Queue counts/arguments survive guarded pans.
        const preparePage = p => {
            p.textSampleValid = false;
            p.rebuildVisibility = plan.exact || this.planner.visibility(p, frame);
            if (p.rebuildVisibility) { encoder.clearBuffer(p.stats, 0, 32); clearCommands++; }
            else { encoder.clearBuffer(p.stats, 24, 4); clearCommands++; }
        };
        if (plan.base) for (const p of basePages) preparePage(p);
        if (plan.overlay) { for (const p of this.annotationPages) preparePage(p); for (const p of this.previewPages) preparePage(p); }
        // Buffer clear operations do not need an atomic store shader or a workgroup per 256 pixels.
        if (plan.base) { encoder.clearBuffer(this.basePixelBuffer); clearCommands++; if(this.activeSpace?.kind==='paper'){encoder.clearBuffer(this.paperStats);clearCommands++;} }
        const overlayRasterized = plan.overlay && (this.annotationPages.length > 0 || this.previewPages.length > 0);
        if (overlayRasterized) { encoder.clearBuffer(this.pixelBuffer); clearCommands++; }
        if (plan.exact) { encoder.clearBuffer(this.fragmentBuffer, 0, 16 + this.canvas.width * this.canvas.height * 4); clearCommands++; }
        const sheetViews = plan.base ? this.preparePaperViews(encoder) : [];
        const timestampWrites = this.hasTimestamps ? { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined;
        const pass = encoder.beginComputePass({ label: 'Compute coverage and composition', timestampWrites });
        dispatches += encodePlacement(this,pass);
        const dispatch = (entry, group, ...args) => { pass.setPipeline(this.pipelines[entry]); pass.setBindGroup(0, group); pass.dispatchWorkgroups(...args); dispatches++; };
        const encodePage = p => {
            if (p.rebuildVisibility) {
                const cull = this.compaction === 'scan' ? 'cullScan' : 'cull';
                dispatch(cull, p.groups[cull], p.leaves); dispatch('indirect', p.groups.indirect, 1); culled++;
            } else reused++;
            pass.setPipeline(this.pipelines.raster); pass.setBindGroup(0, p.groups.raster); pass.dispatchWorkgroupsIndirect(p.indirect, 0);
            pass.setPipeline(this.pipelines.rasterBatch); pass.setBindGroup(0, p.groups.rasterBatch); pass.dispatchWorkgroupsIndirect(p.indirect, 16); dispatches += 2;
        };
        // Sequential compute dispatches reuse one viewport-sized coverage arena and the
        // resident model geometry. No expanded model copy per viewport or CPU readback.
        let viewportCoverageHits=0, viewportRasterized=0, viewportQueueHits=0, viewportQueueBuilds=0;
        for (const v of sheetViews) {
            clearCommands+=v.statsClearCommands;
            if(v.reuseCoverage) viewportCoverageHits++;
            else {
                viewportRasterized++; dispatch('clear', v.clearGroup, ...dispatchCount(v.width*v.height));
            }
            for (const p of this.modelSpacePages) {
                const q=v.queues.get(p),g=v.groups.get(p);
                if(!v.reuseCoverage){
                    if(q.rebuildVisibility){
                        if(!q.owned)dispatch('reset',g.reset,1);
                        const cull=this.compaction==='scan'?'cullScan':'cull';
                        dispatch(cull,g[cull],p.leaves);dispatch('indirect',g.indirect,1);culled++;viewportQueueBuilds++;
                    }else{reused++;viewportQueueHits++;}
                    pass.setPipeline(this.pipelines.raster);pass.setBindGroup(0,g.raster);pass.dispatchWorkgroupsIndirect(q.indirect,0);
                    pass.setPipeline(this.pipelines.rasterBatch);pass.setBindGroup(0,g.rasterBatch);pass.dispatchWorkgroupsIndirect(q.indirect,16);dispatches+=2;
                }
                const sum=v.reuseCoverage?'sumViewportCached':'sumViewport';dispatch(sum,g[sum],1);
            }
            dispatch('copyViewport',v.copyGroup,Math.ceil(v.width/8),Math.ceil(v.height/8));
            v.rasterState.commit(v.u,this.planner.revision);
        }
        if (plan.base) for (const p of basePages) encodePage(p);
        if (overlayRasterized) { for (const p of this.annotationPages) encodePage(p); for (const p of this.previewPages) encodePage(p); }
        const texture = this.context.getCurrentTexture(), resolve = plan.exact ? 'resolveExact' : 'resolve';
        let cached = this.resolveGroups.get(texture);
        if (!cached) { cached = { view: texture.createView() }; this.resolveGroups.set(texture, cached); }
        if (!cached[resolve]) cached[resolve] = this.group(resolve,
            { 0: this.frameBuffer, 1: this.pixelBuffer, 2: this.styleBuffer, 3: this.layerBuffer, 4: cached.view, 8: this.fragmentBuffer, 9: this.basePixelBuffer }, PIXEL_BINDINGS[resolve]);
        dispatch(resolve, cached[resolve], Math.ceil(this.canvas.width / 8), Math.ceil(this.canvas.height / 8)); pass.end();
        if (this.hasTimestamps) encoder.resolveQuerySet(this.querySet, 0, 2, this.queryResolve, 0);
        this.device.queue.submit([encoder.finish()]); this.planner.commit(plan); this.lastPlan = plan;
        this.timingFrame = { frameId: this.metrics.frames + 1, epoch: this.sceneEpoch, submittedAt: start };
        Object.assign(this.metrics, { cpuMs: performance.now() - start, frames: this.metrics.frames + 1, dispatches, clearCommands,
            indirectBuilds: culled, indirectCacheHits: reused, viewportCoverageHits, viewportRasterized, viewportQueueHits, viewportQueueBuilds, paperCacheBytes: this.paperCacheBytes,
            cullPasses: culled, visibilityCacheHits: reused, baseCacheHits: this.metrics.baseCacheHits + Number(!plan.base),
            overlayCacheHits: this.metrics.overlayCacheHits + Number(!overlayRasterized), compositing: this.compositing,
            baseRasterized: plan.base, overlayRasterized, paperViewportCount: this.activeSpace?.viewports?.filter(v=>v.number!==1&&v.supported&&v.status!==0&&!(v.flags&131072)).length || 0 });
        this.lastFrameAt = performance.now(); this.inFlight++;
        this.device.queue.onSubmittedWorkDone().then(() => {
            this.inFlight--; this.metrics.queueCompletionMs = performance.now() - start;
            if (this.frameDirty) this.requestFrame();
        }, error => { this.inFlight--; if (!this.disposed) this.emit('error', error); });
        this.emit('frame', { ...this.metrics, camera: { ...this.camera } }); return true;
    }
    /** Timestamp-only sampling: one 16-byte GPU->CPU payload, no entity traversal.
     * Counters retain their explicit countersSampleFrame; stale maps cannot publish.
     */
    captureTiming({ force = false } = {}) {
        if (this.timingPending) return this.timingPending;
        if (this.disposed || this.preparing || !this.model || !this.metrics.frames ||
            (!force && this.metrics.timingSampleFrame === this.metrics.frames)) return Promise.resolve({ ...this.metrics });
        if (!this.hasTimestamps) {
            Object.assign(this.metrics, {gpuMs:null,gpuTimingStatus:'unsupported'});
            this.emit('metrics',this.metrics);return Promise.resolve({...this.metrics});
        }
        const timing=this.timingFrame,frameId=this.metrics.frames,epoch=this.sceneEpoch;
        const sampledCpuMs=this.metrics.cpuMs,base=this.lastPlan?.base,overlay=this.lastPlan?.overlay;
        const sample=async()=>{
            let lease;const start=performance.now();
            try {
                lease=this.readbacks.acquire(16);
                const encoder=this.device.createCommandEncoder({label:'Timestamp only: no scene readback'});
                encoder.copyBufferToBuffer(this.queryResolve,0,lease.buffer,0,16);this.device.queue.submit([encoder.finish()]);
                await lease.buffer.mapAsync(GPUMapMode.READ);
                if(this.disposed || epoch!==this.sceneEpoch || frameId<(this.metrics.timingSampleFrame ?? -1))return {...this.metrics};
                const ticks=new BigUint64Array(lease.buffer.getMappedRange(0,16));
                const value=timing?.frameId===frameId && timing.epoch===epoch?
                    decodeGpuInterval(ticks[0],ticks[1],{wallUpperBoundMs:performance.now()-timing.submittedAt}):{gpuMs:null,gpuTimingStatus:'stale-sample'};
                Object.assign(this.metrics,value,{timingSampleFrame:frameId,timingBaseRasterized:base,timingCpuMs:sampledCpuMs,sampledCpuMs,sampledBaseRasterized:base,sampledOverlayRasterized:overlay,
                    bytesReadback:this.metrics.bytesReadback+16,timingReadbackBytes:16,timingReadbackMs:performance.now()-start});
                this.sampleResolutionGovernor(frameId,base);
                this.emit('metrics',this.metrics);return {...this.metrics};
            }finally{lease?.release();}
        };
        this.timingPending=sample().finally(()=>{this.timingPending=null;});return this.timingPending;
    }
    sampleResolutionGovernor(frameId, base) {
        if(this.governor && base && this.hasTimestamps && frameId===this.metrics.timingSampleFrame && frameId>(this.lastGovernorFrame ?? -1)){
            this.lastGovernorFrame=frameId;const scale=this.governor.sample(this.metrics.gpuMs);
            if(scale!==null)this.setSize(this.cssWidth,this.cssHeight,this.options.pixelRatio*scale);
        }
    }
    async captureMetrics({ force = false } = {}) {
        if (this.measuring || !this.model || !this.metrics.frames || (!force && this.metrics.measuredFrame === this.metrics.frames)) return { ...this.metrics };
        this.measuring = true; const pages = [...(this.viewPages || this.pages), ...this.annotationPages, ...this.previewPages];
        if (this.metrics.paperViewportCount) pages.push({ stats: this.paperStats, textSampleValid: true, isViewSummary: true });
        const timingFrame = this.timingFrame, epoch = this.sceneEpoch;
        const size = 32 + pages.length * 32, frameId = this.metrics.frames, sampledCpuMs = this.metrics.cpuMs, sampledCompositing = this.compositing, fullFrame = this.lastPlan?.base, overlayFrame = this.lastPlan?.overlay;
        let lease;
        try {
            const sampleStart = performance.now(), samplePages = pages.filter(p => !p.isViewSummary && (force || !p.textSampleValid)); lease = this.readbacks.acquire(size); const buffer = lease.buffer;
            const encoder = this.device.createCommandEncoder();
            if (this.hasTimestamps) encoder.copyBufferToBuffer(this.queryResolve, 0, buffer, 0, 16);
            // Text/glyph diagnostics are paid only by explicit capture, not every render.
            if (samplePages.length) {
                for (const p of samplePages) encoder.clearBuffer(p.stats, 4, 12);
                const diagnostics = encoder.beginComputePass({ label: 'On-demand text diagnostics (outside frame timing)' });
                diagnostics.setPipeline(this.pipelines.sampleText);
                for (const p of samplePages) { diagnostics.setBindGroup(0, p.groups.sampleText); diagnostics.dispatchWorkgroupsIndirect(p.indirect, 32); }
                diagnostics.end();
            }
            encoder.copyBufferToBuffer(this.fragmentBuffer, 0, buffer, 16, 16);
            pages.forEach((p, i) => encoder.copyBufferToBuffer(p.stats, 0, buffer, 32 + i * 32, 32));
            this.device.queue.submit([encoder.finish()]); for (const p of samplePages) p.textSampleValid = true; await buffer.mapAsync(GPUMapMode.READ);
            const mapped = buffer.getMappedRange(0, size), u = new Uint32Array(mapped);
            if (epoch !== this.sceneEpoch || this.disposed) return { ...this.metrics };
            if (this.hasTimestamps && timingFrame?.frameId === frameId && timingFrame.epoch === epoch) {
                const ticks = new BigUint64Array(mapped, 0, 2);
                if (frameId >= (this.metrics.timingSampleFrame ?? -1)) Object.assign(this.metrics, decodeGpuInterval(ticks[0], ticks[1], { wallUpperBoundMs: performance.now() - timingFrame.submittedAt }), { timingSampleFrame: frameId, timingBaseRasterized: fullFrame, timingCpuMs: sampledCpuMs });
            } else Object.assign(this.metrics, { gpuMs: null, gpuTimingStatus: this.hasTimestamps ? 'stale-sample' : 'unsupported' });
            let visible = 0, texts = 0, proxyTexts = 0, glyphs = 0, batchEntities = 0, cooperativeEntities = 0, curveCapHits = 0;
            for (let i = 0; i < pages.length; i++) { const o = 8 + i * 8; visible += u[o]; texts += u[o + 1]; proxyTexts += u[o + 2]; glyphs += u[o + 3]; batchEntities += u[o + 4]; cooperativeEntities += u[o + 5]; curveCapHits += u[o + 6]; }
            const fragmentOverflow = sampledCompositing === 'exact' && !!u[5], fragmentCount = sampledCompositing === 'exact' ? u[4] : 0;
            Object.assign(this.metrics, { visible, texts, proxyTexts, glyphs: this.metrics.paperViewportCount ? null : glyphs, batchEntities, cooperativeEntities, curveCapHits, fragmentOverflow, fragmentCount,
                sampledCpuMs, sampledBaseRasterized: fullFrame, sampledOverlayRasterized: overlayFrame, gpuBytes: this.allocatedBytes(), bytesReadback: this.metrics.bytesReadback + size, measuredFrame: frameId, countersSampleFrame: frameId,
                executedRasterWorkgroups: pages.reduce((n, p, i) => n + ((p.overlay ? overlayFrame : fullFrame) ? (p.isViewSummary ? u[8 + i * 8 + 7] : u[8 + i * 8 + 5] + Math.ceil(u[8 + i * 8 + 4] / 64)) : 0), 0),
                rasterWorkgroups: pages.reduce((n, p, i) => n + (p.isViewSummary ? u[8+i*8+7] : u[8+i*8+5]+Math.ceil(u[8+i*8+4]/64)), 0) });
            buffer.unmap();
            if (fragmentOverflow && !this.lastOverflow) this.emit('error', new CadGpuError('Exact compositing fragment arena overflow. This frame is incomplete; raise fragmentCapacity, reduce overlap, or choose opaque mode.'));
            this.lastOverflow = fragmentOverflow;
            // A cached resolve-only frame must never drive the raster-resolution governor.
            this.sampleResolutionGovernor(frameId, fullFrame);
            this.metrics.telemetryWallMs = performance.now() - sampleStart; this.metrics.telemetryDispatches = samplePages.length; this.metrics.telemetryCacheHits = pages.length - samplePages.length;
            this.emit('metrics', this.metrics); return { ...this.metrics };
        } finally { lease?.release(); this.measuring = false; }
    }
    /** Select resident page partitions. This operation uploads no entity geometry. */
    setSpace(id, { fit = true } = {}) {
        if(this.selectionRanges?.length)this.selectEntities([]);
        if (!this.model?.spaces) { if (id !== 'model') throw new CadGpuError('Unknown drawing space.'); return; }
        const space = this.model.spaces.find(s=>s.id===id); if (!space) throw new CadGpuError('Unknown drawing space: '+id);
        if (space.kind === 'paper' && this.compositing === 'exact' && space.viewports.some(v=>v.number!==1&&v.supported)) this.setCompositing('opaque');
        this.disposePaperResources(); this.activeSpace = space; this.model.origin = space.origin || [0,0];
        this.viewPages = space.pageIndices.map(i=>this.pages[i]);
        this.modelSpacePages = (this.model.spaces.find(s=>s.kind==='model')?.pageIndices || []).map(i=>this.pages[i]);
        const b=[Infinity,Infinity,-Infinity,-Infinity];
        const include=x=>{if(!x||x.some(v=>!Number.isFinite(v)||Math.abs(v)>=1e20)||x[2]<x[0]||x[3]<x[1])return; b[0]=Math.min(b[0],x[0]);b[1]=Math.min(b[1],x[1]);b[2]=Math.max(b[2],x[2]);b[3]=Math.max(b[3],x[3]);};
        for(const p of this.viewPages)include(p.finiteBounds);
        for(const v of space.viewports)if(v.number!==1&&v.width>0&&v.height>0)include([v.center[0]-v.width/2-this.model.origin[0],v.center[1]-v.height/2-this.model.origin[1],v.center[0]+v.width/2-this.model.origin[0],v.center[1]+v.height/2-this.model.origin[1]]);
        if(space.kind==='paper'&&space.paperSize)include([-this.model.origin[0],-this.model.origin[1],space.paperSize[0]-this.model.origin[0],space.paperSize[1]-this.model.origin[1]]);
        this.extents=Number.isFinite(b[0])?b:[-100,-100,100,100];
        this.selected=0;this.hovered=0;this.camera.angle=0;this.sceneEpoch++;this.resetTiming();this.planner.invalidate();
        if(fit)this.fit();this.requestFrame();this.emit('space',space);
    }
    setNamedView(view) {
        if((view.spaceId?.startsWith('layout:') && Math.abs(view.twist || 0)>1e-10) || !supportedPlanView(view))throw new CadGpuError('This saved view uses an unsupported projection or clipping boundary.');
        this.setSpace(view.kind==='viewport'?'model':view.spaceId || 'model',{fit:false});
        const c=viewCamera(view);this.camera={...c,x:c.x-this.model.origin[0],y:c.y-this.model.origin[1],zoom:Math.min(this.cssHeight/view.viewHeight,view.viewWidth>0?this.cssWidth/view.viewWidth:Infinity)};
        this.planner.invalidate();this.requestFrame();
    }
    /** Optional caches never make an otherwise admissible edit/resize fail. */
    trimPaperCaches(requiredBytes = 0) {
        if (this.paperCacheBytes && this.allocatedBytes() + requiredBytes > this.options.memoryBudget) this.disposePaperResources();
    }
    invalidatePageViews(pages) {
        const affected = new Set(pages); this.planner.invalidatePages(affected);
        for (const v of this.paperResources.values()) {
            for (const [source, q] of v.queues) if (affected.has(source)) {
                this.planner.invalidatePages([q]); v.rasterState.invalidate();
            }
        }
    }
    disposePaperResources() {
        if (!this.paperResources) return;
        for (const v of this.paperResources.values()) {
            v.frame.destroy(); v.layers.destroy(); v.surface?.destroy();
            for (const q of v.queues.values()) if (q.owned) { q.visible.destroy(); q.stats.destroy(); q.indirect.destroy(); }
        }
        this.paperResources.clear(); this.paperCacheBytes = 0;
        this.paperScratch?.destroy(); this.paperScratch = null;
    }
    canCachePaper(bytes) {
        return this.paperCache && this.planner.cache && this.paperCacheBytes + bytes <= this.options.paperCacheBudget &&
            this.allocatedBytes() + bytes + (this.paperStateReserve || 0) <= this.options.memoryBudget;
    }
    bindPaperView(v) {
        const surface = v.surface || this.paperScratch;
        v.clearGroup = this.group('clear', {0:v.frame,1:surface}, PIXEL_BINDINGS.clear);
        v.copyGroup = this.group('copyViewport', {0:v.frame,1:surface,9:this.basePixelBuffer}, PIXEL_BINDINGS.copyViewport);
        v.groups.clear();
        for (const p of this.modelSpacePages) {
            const q = v.queues.get(p);
            const resources={0:v.frame,1:p.header,2:p.entities,3:p.aux,4:p.bounds,5:q.visible,6:q.stats,7:v.layers,
                8:this.fontBuffer,9:surface,10:this.atlasView,12:this.fontInfo,13:q.indirect,14:p.order,
                15:this.fragmentBuffer,16:this.atlasSampler,17:this.paperStats};
            const groups={};
            for (const entry of ['cull','cullScan','raster','rasterBatch','reset','indirect','sumViewport','sumViewportCached'])
                groups[entry]=this.group(entry,resources,SCENE_BINDINGS[entry]);
            v.groups.set(p,groups);
        }
    }
    preparePaperViews(encoder) {
        try { return this.preparePaperViewsCore(encoder); }
        catch(error) { this.disposePaperResources(); this.planner.invalidate(); throw error; }
        finally { this.paperStateReserve=0; }
    }
    preparePaperViewsCore(encoder) {
        if(this.activeSpace?.kind!=='paper')return [];
        const views=this.activeSpace.viewports.filter(v=>v.number!==1&&v.supported&&v.status!==0&&!(v.flags&131072));
        if(!views.length||!this.modelSpacePages?.length)return [];
        const size=this.canvas.width*this.canvas.height*4;
        if(!this.paperScratch){if(this.allocatedBytes()+size>this.options.memoryBudget)throw new CadGpuError('Paper viewport scratch exceeds the GPU budget.');this.paperScratch=this.buffer('Reusable paper viewport coverage',size,GPUBufferUsage.STORAGE);}
        this.paperStateReserve=views.filter(view=>!this.paperResources.has(view.id)).length*(128+this.layers.length*16);
        const result=[], zoom=this.camera.zoom*this.ratio,modelOrigin=this.model.spaces.find(s=>s.kind==='model')?.origin || [0,0];
        for(const view of views){
            const cx=(view.center[0]-this.model.origin[0]-this.camera.x)*zoom+this.canvas.width/2,cy=-(view.center[1]-this.model.origin[1]-this.camera.y)*zoom+this.canvas.height/2;
            const x=Math.max(0,Math.ceil(cx-view.width*zoom/2)), y=Math.max(0,Math.ceil(cy-view.height*zoom/2));
            const width=Math.min(this.canvas.width,Math.ceil(cx+view.width*zoom/2))-x, height=Math.min(this.canvas.height,Math.ceil(cy+view.height*zoom/2))-y;
            if(width<=0||height<=0)continue;
            let v=this.paperResources.get(view.id), rebind=false;
            if(!v){
                const layerBytes=this.layers.length*16;
                this.paperStateReserve-=128+layerBytes;
                if(this.allocatedBytes()+128+layerBytes>this.options.memoryBudget)throw new CadGpuError('Paper viewport state exceeds the GPU budget.');
                let frame,layers;try{frame=this.buffer('Paper viewport camera',128,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);layers=this.buffer('Viewport frozen-layer palette',layerBytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);}catch(e){frame?.destroy();layers?.destroy();throw e;}
                const data=new ArrayBuffer(128);
                v={frame,layers,data,u:new Uint32Array(data),f:new Float32Array(data),previous:new Uint32Array(32),groups:new Map(),queues:new Map(),initialized:false,layerVersion:-1,frozenKey:null,rasterState:new PaperRasterState()};
                this.paperResources.set(view.id,v); rebind=true;
                for(const p of this.modelSpacePages){
                    const bytes=paperQueueBytes(p.count); let q;
                    if(this.canCachePaper(bytes)){
                        const owned=[];
                        try {
                            const alloc=(...args)=>{const b=this.buffer(...args);owned.push(b);return b;};
                            q={owned:true,visible:alloc('Viewport exact-capacity queue',p.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),
                                stats:alloc('Viewport GPU counts',64,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST),
                                indirect:alloc('Viewport persistent dispatch arguments',48,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC),bytes};
                            this.paperCacheBytes+=bytes;
                        }catch(error){for(const b of owned)b.destroy();throw error;}
                    }else q={owned:false,visible:p.visible,stats:p.stats,indirect:p.indirect,bytes:0};
                    v.queues.set(p,q);
                }
            }
            // Cache only exact coverage. Allocation limits fall back to the same compute raster path.
            const surfaceBytes=align(width*height*4,256);
            if(v.surface && v.surface.size<surfaceBytes){this.paperCacheBytes-=v.surface.size;v.surface.destroy();v.surface=null;v.rasterState.invalidate();rebind=true;}
            if(!v.surface && [...v.queues.values()].every(q=>q.owned) && this.canCachePaper(surfaceBytes)){
                v.surface=this.buffer('Persistent paper viewport coverage',surfaceBytes,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
                this.paperCacheBytes+=v.surface.size;v.rasterState.invalidate();rebind=true;
            }
            if(rebind)this.bindPaperView(v);
            const frozenKey=JSON.stringify(view.frozenLayers || []);
            if(this.layerRevision!==v.layerVersion || frozenKey!==v.frozenKey){
                const frozen=new Set(view.frozenLayers),a=new Uint32Array(this.layers.length*4);
                this.layers.forEach((l,i)=>a.set([l.color,Number(l.visible&&!frozen.has(l.name)),Number(l.locked),0],i*4));
                this.device.queue.writeBuffer(v.layers,0,a);this.metrics.bytesUploaded+=a.byteLength;
                v.layerVersion=this.layerRevision;v.frozenKey=frozenKey;v.rasterState.invalidate();
                this.planner.invalidatePages(v.queues.values());
            }
            const f=v.f,u=v.u;u.set(this.frameU);
            const c=viewCamera(view),scale=view.height*zoom/view.viewHeight,dx=(x+width/2-cx)/scale,dy=-(y+height/2-cy)/scale,co=Math.cos(c.angle),si=Math.sin(c.angle);
            const wx=c.x+co*dx-si*dy-modelOrigin[0],wy=c.y+si*dx+co*dy-modelOrigin[1];
            f[0]=Math.fround(wx);f[1]=Math.fround(wy);f[2]=wx-f[0];f[3]=wy-f[1];f[4]=width;f[5]=height;f[6]=scale;
            f[20]=this.planner.guardBand;f[24]=co;f[25]=si;f[26]=x;f[27]=y;f[30]=this.canvas.width;f[31]=this.canvas.height;
            u[12]=0;u[13]&=2;u[14]=0;f[29]=0; // Selection/grid/overlay state is applied only by final resolve.
            let first=0,last=31;if(v.initialized){while(first<32&&u[first]===v.previous[first])first++;while(last>=first&&u[last]===v.previous[last])last--;}
            if(last>=first){const bytes=(last-first+1)*4;this.device.queue.writeBuffer(v.frame,first*4,v.data,first*4,bytes);this.metrics.bytesUploaded+=bytes;this.metrics.frameUniformBytes+=bytes;v.previous.set(u);v.initialized=true;}
            v.width=width;v.height=height;
            v.reuseCoverage=!!v.surface && this.paperCache && this.planner.cache && v.rasterState.matches(u,this.planner.revision);
            const frame={camera:{x:wx,y:wy,zoom:scale/this.ratio,angle:c.angle},width,height,ratio:this.ratio,settings:this.settings,flags:this.flags,fontRevision:this.fontRevision};
            v.statsClearCommands=0;
            for(const [p,q] of v.queues){
                q.rebuildVisibility=!q.owned || !this.paperCache || this.planner.visibility(q,frame);
                if(!v.reuseCoverage && q.owned){
                    encoder.clearBuffer(q.stats,q.rebuildVisibility?0:24,q.rebuildVisibility?32:4);v.statsClearCommands++;
                    if(q.rebuildVisibility)encoder.copyBufferToBuffer(p.stats,32,q.stats,32,4);
                }
            }
            result.push(v);
        }
        this.paperStateReserve=0;return result;
    }
    resetTiming() { Object.assign(this.metrics, { gpuMs: null, gpuTimingStatus: this.hasTimestamps ? 'not-sampled' : 'unsupported', measuredFrame: -1, timingSampleFrame: -1, countersSampleFrame: -1 }); }
    allocatedBytes() {
        const pages = [...this.pages, ...this.annotationPages, ...this.previewPages];
        return pages.reduce((n, p) => n + p.bytes, 0) + [this.frameBuffer, this.fontBuffer, this.fontInfo, this.basePixelBuffer, this.pixelBuffer,
            this.fragmentBuffer, this.styleBuffer, this.layerBuffer, this.paperStats, this.paperScratch, this.queryResolve, this.pickBuffer, this.pickParams, this.measureParams].reduce((n, b) => n + (b?.size || 0), 0)
            + (this.font ? this.font.atlasWidth * this.font.atlasHeight * 4 : 0) + (this.readbacks?.bytes || 0) + [...this.paperResources.values()].reduce((n,v)=>n+v.frame.size+v.layers.size,0) + this.paperCacheBytes;
    }
    /** Strict-quality A/B: identical moving-camera trace and display settings in every profile. */
    async benchmarkProfiles({ frames = 60, warmup = 8, panPixels = 160, profiles = [{ name: 'reference', cache: false, batch: false, compaction: 'scan', paperCache: false }, { name: 'optimized', cache: true, batch: true, compaction: 'mask', paperCache: true }] } = {}) {
        if (!Number.isInteger(frames) || frames < 2 || frames > 10000 || !Number.isInteger(warmup) || warmup < 0 || warmup > 1000 || !Number.isFinite(panPixels)) throw new RangeError('Invalid benchmark configuration.');
        if (!this.model || this.benchmarking || this.preparing || this.needsModelRebuild) throw new CadGpuError('Benchmark requires an idle resident drawing.');
        if (!Array.isArray(profiles) || !profiles.length || profiles.some(p => typeof p.name !== 'string' || typeof p.cache !== 'boolean' || typeof p.batch !== 'boolean' || (p.compaction !== undefined && !['mask','scan'].includes(p.compaction)) || (p.paperCache !== undefined && typeof p.paperCache !== 'boolean'))) throw new RangeError('Benchmark profiles require names, cache/batch flags and a valid optional compaction mode.');
        this.benchmarking = true; const camera = { ...this.camera }, old = { cache: this.planner.cache, batch: this.planner.batch, guardBand: this.planner.guardBand }, governor = this.governor, oldCompaction = this.compaction, oldPaperCache = this.paperCache, wasSuspended = this.suspended;
        this.governor = null; this.suspended = true; if (this.pendingFrame) { cancelAnimationFrame(this.pendingFrame); this.pendingFrame = 0; }
        const result = { schema: 'aperture-benchmark/4', gpuTimingScope: 'compute-pass (excludes native fills, uploads, queue waits and presentation)', capturedAt: new Date().toISOString(), adapter: this.info, entityCount: this.model.count,
            viewport: [this.canvas.width, this.canvas.height], settings: { ...this.settings }, flags: this.flags, compositing: this.compositing,
            quality: { exactText: !(this.flags & 2), adaptiveResolution: false }, trace: { type: 'sinusoidal-pan', frames, warmup, panPixels }, profiles: [] };
        const signature = JSON.stringify([this.settings, this.flags, this.canvas.width, this.canvas.height, this.model.count, this.fontRevision, this.compositing]);
        try {
            await this.device.queue.onSubmittedWorkDone();
            for (const profile of profiles) {
                this.disposePaperResources(); this.paperCache = profile.paperCache ?? oldPaperCache;
                Object.assign(this.planner, old, { cache: profile.cache, batch: profile.batch }); this.compaction = profile.compaction || oldCompaction; this.planner.invalidate(); const samples = [];
                for (let i = -warmup; i < frames; i++) {
                    const t = Math.max(0, i) / (frames - 1); this.camera.x = camera.x + Math.sin(t * Math.PI * 2) * panPixels / camera.zoom;
                    this.camera.y = camera.y + Math.sin(t * Math.PI * 4) * panPixels * .2 / camera.zoom;
                    const start = performance.now(); this.suspended = false; const submitted = this.render(); this.suspended = true;
                    if (!submitted) throw new CadGpuError('Benchmark frame was not submitted.');
                    await this.device.queue.onSubmittedWorkDone(); const completionMs = performance.now() - start;
                    const m = await this.captureMetrics(); const iterationWallMs = performance.now() - start;
                    if (JSON.stringify([this.settings, this.flags, this.canvas.width, this.canvas.height, this.model.count, this.fontRevision, this.compositing]) !== signature) throw new CadGpuError('Benchmark cancelled: model or rendering quality changed.');
                    if (m.fragmentOverflow) throw new CadGpuError('Benchmark rejected an incomplete exact-compositing frame.');
                    if (i >= 0) samples.push({ cpuEncodeMs: m.cpuMs, gpuMs: m.gpuMs, gpuTimingStatus: m.gpuTimingStatus, queueCompletionMs: completionMs,
                        telemetryWallMs: m.telemetryWallMs, iterationWallMs, frameUniformBytes: m.frameUniformBytes, indirectBuilds: m.indirectBuilds, clearCommands: m.clearCommands, cullPasses: m.cullPasses, visibilityCacheHits: m.visibilityCacheHits, rasterWorkgroups: m.rasterWorkgroups,
                        visibleCandidates: m.visible, curveCapHits: m.curveCapHits });
                }
                result.profiles.push({ name: profile.name, cache: this.planner.cache, batch: this.planner.batch, compaction: this.compaction, samples, invalidGpuSamples: samples.filter(s=>s.gpuMs===null).length,
                    cpuEncodeMs: summarizeSamples(samples.map(s => s.cpuEncodeMs)), gpuMs: summarizeSamples(samples.map(s => s.gpuMs).filter(v => v !== null)),
                    queueCompletionMs: summarizeSamples(samples.map(s => s.queueCompletionMs)), telemetryWallMs: summarizeSamples(samples.map(s => s.telemetryWallMs)), iterationWallMs: summarizeSamples(samples.map(s => s.iterationWallMs)) });
            }
            return result;
        } finally { Object.assign(this.camera, camera); Object.assign(this.planner, old); this.compaction = oldCompaction; this.paperCache = oldPaperCache; this.disposePaperResources(); this.planner.invalidate(); this.governor = governor; this.benchmarking = false; this.suspended = wasSuspended; this.requestFrame(); }
    }
    /** Patch existing fixed-size source records; no scene-wide upload or CPU tessellation. */
    async patchEntities(changes) {
        if (!Array.isArray(changes) || !changes.length) return;
        if (!this.model || this.preparing || this.benchmarking || this.needsModelRebuild) throw new CadGpuError('The drawing is not available for editing.');
        const affected = new Set(), writes = [], seen = new Set();
        for (const change of changes) {
            const { id } = change; if (!Number.isInteger(id) || seen.has(id)) throw new RangeError('Patch IDs must be unique integers.'); seen.add(id);
            const page = this.pages.find(p => id > p.idBase && id <= p.idBase + p.count);
            if (!page?.source.entities) throw new CadGpuError('Patch requires a retained source record; synthetic pages are GPU-generated.');
            const offset = (id - page.idBase - 1) * ENTITY_BYTES, data = page.source.entities.slice(offset, offset + ENTITY_BYTES), f = new Float32Array(data), u = new Uint32Array(data);
            for (const key of Object.keys(change)) if (!['id', 'anchor', 'p', 'q', 'r', 'color', 'layer', 'flags'].includes(key)) throw new RangeError('Unsupported fixed-record patch: ' + key);
            for (const [key, at, size] of [['anchor', 0, 2], ['p', 4, 4], ['q', 8, 4], ['r', 12, 4]]) if (key in change) {
                const a = change[key]; if (!Array.isArray(a) || a.length !== size || a.some(v => !Number.isFinite(v) || !Number.isFinite(Math.fround(v)))) throw new RangeError('Invalid patch ' + key);
                if (key === 'anchor') { const [xh, xl] = split64(a[0]), [yh, yl] = split64(a[1]); f.set([xh, yh, xl, yl]); } else f.set(a, at);
            }
            for (const [key, at] of [['color', 17], ['layer', 18], ['flags', 23]]) if (key in change) {
                const n = change[key]; if (!Number.isInteger(n) || n < 0 || n > 0xffffffff || (key === 'layer' && n >= this.model.layers.length)) throw new RangeError('Invalid patch ' + key); u[at] = n;
            }
            const source = new Uint32Array(page.source.entities, offset, 32);
            if (u.every((value, i) => value === source[i])) continue;
            const geometry = ['anchor', 'p', 'q', 'r', 'flags'].some(key => key in change);
            const colorChanged = u[17] !== source[17], layerChanged = u[18] !== source[18];
            writes.push({ id, page, offset, data, geometry, colorChanged, layerChanged }); if (geometry) affected.add(page);
        }
        if (affected.size) this.trimPaperCaches(this.editScratchBytes([...affected]));
        if (affected.size && this.allocatedBytes() + this.editScratchBytes([...affected]) > this.options.memoryBudget)
            throw new CadGpuError('Entity edit exceeds the GPU budget including spatial-index scratch. No records were changed.');
        if (!writes.length) return;
        this.preparing = true;
        try {
            const geometryWrites = writes.filter(w => w.geometry).sort((a,b) => a.page.idBase - b.page.idBase || a.offset - b.offset);
            for (const { page, offset, data } of writes) new Uint8Array(page.source.entities, offset, ENTITY_BYTES).set(new Uint8Array(data));
            let uploaded = 0, calls = 0;
            const upload = (buffer, destinationOffset, source, sourceOffset, size) => {
                this.device.queue.writeBuffer(buffer, destinationOffset, source, sourceOffset, size); uploaded += size; calls++;
            };
            // Adjacent edited records share one queue write. Geometry processing remains on GPU.
            for (let i = 0; i < geometryWrites.length;) {
                const first = geometryWrites[i++]; let end = first.offset + ENTITY_BYTES;
                while (i < geometryWrites.length && geometryWrites[i].page === first.page && geometryWrites[i].offset === end) { end += ENTITY_BYTES; i++; }
                upload(first.page.entities, first.offset, first.page.source.entities, first.offset, end - first.offset);
            }
            for (const w of writes) if (!w.geometry) {
                const first = w.colorChanged ? 17 : 18, last = w.layerChanged ? 18 : 17, size = (last - first + 1) * 4;
                upload(w.page.entities, w.offset + first * 4, w.data, first * 4, size);
                upload(this.styleBuffer, w.id * 8 + (first - 17) * 4, w.data, first * 4, size);
                if (w.layerChanged) this.invalidatePageViews([w.page]);
            }
            this.metrics.bytesUploaded += uploaded; this.metrics.editUploadCalls = calls;
            // No pre-edit whole-queue wait: writes and the rebuild submission are ordered on one queue.
            if (affected.size) { await this.rebuildPages([...affected]); this.invalidatePageViews(affected); }
            this.emit('edit', { ids: writes.map(w => w.id), bytesUploaded: uploaded, writeCalls: calls, rebuiltPages: affected.size });
        } finally { this.preparing = false; this.requestFrame(); }
    }
    editScratchBytes(pages) { return pages.length ? Math.max(...pages.map(p => p.count)) * 8 + 2048 + Math.max(4, pages.length * 16) : 0; }
    async rebuildPages(pages) {
        if (!pages.length) return;
        if (this.allocatedBytes() + this.editScratchBytes(pages) > this.options.memoryBudget)
            throw new CadGpuError('Spatial-index rebuild exceeds the GPU allocation budget.');
        let ranks, buckets, readback;
        try {
            ranks = this.buffer('Edit spatial-rank scratch', Math.max(...pages.map(p => p.count)) * 8, GPUBufferUsage.STORAGE);
            buckets = this.buffer('Edit spatial-prefix scratch', 2048, GPUBufferUsage.STORAGE);
            readback = this.buffer('Changed page bounds only', pages.length * 16, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
            const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
            for (const p of pages) {
                pass.setPipeline(this.pipelines.prepare); pass.setBindGroup(0, p.groups.prepare); pass.dispatchWorkgroups(p.leaves);
                pass.setPipeline(this.pipelines.reduceBounds); pass.setBindGroup(0, p.groups.reduceBounds); pass.dispatchWorkgroups(1);
                const resources = { 0: p.header, 1: p.bounds, 2: p.order, 3: ranks, 4: buckets };
                for (const [entry, bindings] of Object.entries(INDEX_BINDINGS)) { pass.setPipeline(this.pipelines[entry]); pass.setBindGroup(0, this.group(entry, resources, bindings)); pass.dispatchWorkgroups(entry === 'spatialClear' || entry === 'spatialScan' ? 1 : p.leaves); }
            }
            pass.end(); pages.forEach((p, i) => encoder.copyBufferToBuffer(p.bounds, (p.count + p.leaves) * 16, readback, i * 16, 16));
            this.device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ); const f = new Float32Array(readback.getMappedRange());
            for (let i = 0; i < pages.length; i++) pages[i].finiteBounds = Array.from(f.subarray(i * 4, i * 4 + 4));
            const box = [Infinity, Infinity, -Infinity, -Infinity];
            // These are 16-byte page roots already returned by explicit preparation, not host entity geometry.
            for (const page of (this.viewPages || this.pages)) { const b = page.finiteBounds; if (!b || b[2] < b[0] || b[3] < b[1]) continue;
                box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]); }
            this.extents = box.every(v => Number.isFinite(v) && Math.abs(v) < 1e20) && box[2] >= box[0] ? box : [-100,-100,100,100];
            readback.unmap(); this.metrics.bytesReadback += pages.length * 16;
        } finally { ranks?.destroy(); buckets?.destroy(); readback?.destroy(); }
    }
    query(entry, params) { const work = this.queryTail.catch(() => { }).then(() => this.executeQuery(entry, params)); this.queryTail = work; return work; }
    async executeQuery(entry, params) { this.queryBusy = true; let lease; try {
        if (this.disposed) throw new CadGpuError('Cannot query a disposed engine.');
        const target = entry === 'pick' ? this.pickParams : this.measureParams;
        this.device.queue.writeBuffer(target, 0, params);
        this.metrics.bytesUploaded += params.byteLength;
        const encoder = this.device.createCommandEncoder(), pass = encoder.beginComputePass();
        pass.setPipeline(this.pipelines[entry]);
        pass.setBindGroup(0, this.pixelGroups[entry]);
        pass.dispatchWorkgroups(1);
        pass.end();
        lease = this.readbacks.acquire(16); const readback = lease.buffer;
        encoder.copyBufferToBuffer(this.pickBuffer, 0, readback, 0, 16);
        this.device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const result = readback.getMappedRange(0, 16).slice(0);
        readback.unmap();
        this.metrics.bytesReadback += 16;
        return result;
    }
    finally {
        lease?.release();
        this.queryBusy = false;
    } }
    async pick(x, y, radius = 5, baseOnly = false) { if (!this.model)
        return 0; const result = await this.query('pick', new Uint32Array([Math.round(x * this.ratio), Math.round(y * this.ratio), Math.round(radius * this.ratio), Number(baseOnly)])); return result ? new Uint32Array(result)[0] : 0; }
    async measure(a, b) { const origin = this.model?.origin || [0, 0], [ax, alx] = split64(a[0] - origin[0]), [ay, aly] = split64(a[1] - origin[1]), [bx, blx] = split64(b[0] - origin[0]), [by, bly] = split64(b[1] - origin[1]); const result = await this.query('measure', new Float32Array([ax, ay, alx, aly, bx, by, blx, bly])); return result ? Array.from(new Float32Array(result)) : null; }
    describe(id) {
        const p = [...this.pages, ...this.annotationPages, ...this.previewPages].find(p => id > p.idBase && id <= p.idBase + p.count);
        if (!p)
            return null;
        let type = null, layer = null, color = null;
        if (p.source.entities) {
            const u = new Uint32Array(p.source.entities), j = (id - p.idBase - 1) * 32;
            type = u[j + 16];
            color = u[j + 17];
            layer = u[j + 18];
        }
        else if (this.model?.synthetic) {
            const global = id - 1, typeIndex = this.model.synthetic.mode === 2 ? 4 : global % 10 === 9 ? 2 : global % 10 >= 6 ? 4 : 1;
            type = typeIndex;
            layer = type === 4 ? 2 : type === 2 ? 1 : 0;
        }
        return { id, type, layer: layer === null ? 'Unknown' : this.layers[layer]?.name, color, handle: p.source.handles?.[id - p.idBase - 1] || null, gpuResident: true };
    }
    async exportPng() { await this.device.queue.onSubmittedWorkDone(); this.render(); await this.device.queue.onSubmittedWorkDone(); return new Promise((resolve, reject) => this.canvas.toBlob(blob => blob ? resolve(blob) : reject(new CadGpuError('Canvas export failed.')), 'image/png')); }
    dispose() { this.disposed = true; if (this.pendingFrame)
        cancelAnimationFrame(this.pendingFrame); this.paperStats?.destroy(); this.readbacks?.dispose(); this.disposeScene(); for (const b of [this.frameBuffer, this.fontBuffer, this.fontInfo, this.pixelBuffer, this.basePixelBuffer, this.fragmentBuffer, this.pickBuffer, this.pickParams, this.measureParams, this.queryResolve])
        b?.destroy(); this.atlas?.destroy(); this.querySet?.destroy(); this.device?.destroy(); }
}
/** No million-record CPU array: raw records, IDs and unique numeric labels are GPU-generated. */
export function makeSyntheticModel(font, count = 1000000, mode = 1) {
    if (!Number.isInteger(count) || count < 1 || count > 16000000)
        throw new RangeError('Synthetic entity count must be 1…16,000,000.');
    const pages = [];
    for (let base = 0; base < count; base += PAGE_ENTITIES) {
        const n = Math.min(PAGE_ENTITIES, count - base), builder = new PageBuilder(font, { pageSize: 1, idBase: base });
        const demoRun = builder.run(mode === 2 ? 'TAG ' : 'EQ ');
        const template = builder.finish();
        pages.push({ count: n, idBase: base, entities: null, aux: template.aux, runTable: template.runTable, runCount: template.runCount, demoRun, handles: null, missing: [] });
    }
    return { version: 1, name: mode === 2 ? 'Unique text / ' + count.toLocaleString() : 'GPU stress scene / ' + count.toLocaleString(), origin: [0, 0], count, pages, layers: [{ name: 'Geometry', color: rgba('#5ecbbd'), visible: true }, { name: 'Equipment', color: rgba('#eab879'), visible: true }, { name: 'Unique text', color: rgba('#afc2d8'), visible: true }], diagnostics: [], missing: [], synthetic: { mode, total: count } };
}
