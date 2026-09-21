# Block-authoring additions — 2.5.0

The full semantic source API, controller usage and GPU editing contracts are in `BLOCKS.md`. New exports are `BlockDrawing` (`packages/blocks/document.js`), `BlockShelf` / `engineeringLibrary` (`library.js`), `placementPreview` / `ownerOf` (`preview.js`), and supported exploded-record serialization (`explode.js`). Engine additions: `reconcileModel`, `updateBlockPreview`, `selectEntities`, `snap`, `explode`. The workbench exposes `Aperture.blocks` and `Aperture.BlockDrawing`.

Direct authoring mutations require worker recompilation/reconciliation; use the workbench controller for serialized UI commands. The source graph remains separate from reviews and original-byte export. No shared-template GPU occurrence storage, dynamic blocks or complete native command parity is implied. See BLOCKS.md for exact budgets and failure behavior.

---

# Integration API — 2.4.0

The source modules are ordinary ESM. Serve the project root over localhost or HTTPS. Run `npm run build` after changing WGSL or the DXF worker so generated modules remain synchronized. No npm installation is required for the app/build.

## 2.4 performance APIs

```js
const engine = new ComputeCad(canvas, {
  memoryBudget: 768 * 1024 * 1024,
  paperCacheBudget: 64 * 1024 * 1024, // optional cache ceiling INSIDE total budget
});
await engine.initialize(font);
engine.setPerformance({cache:true, batch:true, guardBand:0.25, compaction:'mask', paperCache:true});
// Disable optional paper resources for a same-quality reference:
// engine.setPerformance({paperCache:false});

// Both are asynchronous, and neither reads model geometry:
const timing = await engine.captureTiming();       // 16-byte query payload only
const counters = await engine.captureMetrics();  // explicit diagnostic compute + counters
console.log(timing.gpuMs, timing.gpuTimingStatus, timing.timingSampleFrame);
console.log(counters.visible, counters.countersSampleFrame);
```

`paperCacheBudget` accepts a nonnegative safe integer. Zero disables optional private queues and coverage surfaces. Changing `paperCache` disposes prior optional resources; cache admission never duplicates entity/auxiliary geometry and never silently lowers visual quality. This toggle affects paper view caches; general visibility caching remains controlled by `cache`.

`captureTiming({force:false})` coalesces concurrent calls and skips a same-frame completed sample. `force:true` recaptures the current resolved query pair but does not submit a new drawing. Without timestamp support the result is null/unsupported, not a CPU fallback. `timingReadbackBytes` is 16 for an actual new transfer; `timingReadbackMs` measures its async wall cost. No sample is published after its scene epoch becomes stale. Only a matching, increasing full-raster timing sample can drive the optional resolution governor.

New metrics: `timingSampleFrame`, `countersSampleFrame`, `timingBaseRasterized`, `timingCpuMs`, `timingReadbackBytes`, `timingReadbackMs`, `viewportCoverageHits`, `viewportRasterized`, `viewportQueueHits`, `viewportQueueBuilds`, `paperCacheBytes`. Timing reads do not make old counters current. `viewportCoverageHits` counts surfaces reused, not skipped composition; `executedRasterWorkgroups` excludes cached viewport raster work. Counts for glyphs in composed paper views retain the previous explicitly-unavailable contract.

`benchmarkProfiles` accepts optional `paperCache` per profile and restores it afterward. Its default reference disables paper caching; its optimized profile enables it. Same-release toggles are **not** a substitute for `tools/profile-release.mjs`'s separate-release comparison.

## New document/layout API

The default workbench imports all spaces. For an embedding, use `parseDxfDocument(input,font,options)` from `packages/dxf/index.js`, or `DxfWorkerClient.parse(buffer,font,{document:true,name})`. Legacy `parseDxf` remains Model-only by default.

`await engine.setModel(document)` uploads all page partitions of one file. `engine.setSpace(spaceId,{fit:true})` selects resident buffers with no entity re-upload, resets stale timing and changes the coordinate origin. `engine.setNamedView(view)` selects a supported saved camera. `document.spaces` includes empty layouts; `document.namedViews` includes supported flags and diagnostics. Do not retain an origin from a different space when building overlays. The embedding host owns per-space overlay teardown/restore; the workbench's `Aperture.switchSpace` handles it automatically.

`Aperture.openFiles(files)`, `switchDocument(id)`, `closeDocument(id)`, `switchSpace(id)`, `saveWorkspace()` and `restoreWorkspace()` are asynchronous serialized workbench operations. Document identities are not filenames. Inactive files are CPU-resident, not simultaneously GPU-resident. See `TIMING-VIEWS-TABS.md` for complete state ownership.

`captureMetrics()` exposes `gpuMs:number|null`, `gpuTimingStatus` and `gpuTimingScope:'compute-pass'`. Only valid samples may be displayed as GPU durations. Use `formatGpuTiming` from `packages/performance/timing.js`; do not turn null into zero. This interval excludes native buffer clears, host uploads and diagnostic readback, unlike historical v2.2 timing. CPU encoding and telemetry wall time remain separate.

## Minimal independent viewer

Create `examples/viewer.html` as follows (a runnable copy is included):

```html
<!doctype html>
<meta charset="utf-8">
<title>Embedded compute CAD</title>
<style>
  body { margin: 0; font: 14px system-ui; background: #0b1118; color: white; }
  #toolbar { height: 48px; display: flex; align-items: center; gap: 16px; padding: 0 16px; }
  canvas { width: 100vw; height: calc(100vh - 48px); display: block; touch-action: none; }
</style>
<div id="toolbar"><input id="file" type="file" accept=".dxf"><span id="status">Starting…</span></div>
<canvas id="cad"></canvas>
<script type="module">
  import { ComputeCad } from '../packages/gpu/index.js';
  import { makeBuiltinFont } from '../packages/font/index.js';
  import { ModelBuilder, rgba } from '../packages/model/index.js';
  import { DxfWorkerClient } from '../packages/dxf/client.js';

  const canvas = document.querySelector('#cad');
  const status = document.querySelector('#status');
  const font = makeBuiltinFont();
  const engine = new ComputeCad(canvas, { memoryBudget: 768 * 1024 * 1024 });
  const importer = new DxfWorkerClient();
  let drag = null;
  const report = error => { status.textContent = error.message; console.error(error); };
  engine.addEventListener('error', event => report(event.detail));
  try {
    await engine.initialize(font);
    const builder = new ModelBuilder(font, { name: 'CAD-independent model' });
    builder.rect(0, 0, 200, 120);
    builder.circle(100, 60, 35, 0, rgba('#72e0b0'));
    builder.text('COMPUTE CAD', 20, 140, 15);
    await engine.setModel(builder.finish());
    status.textContent = 'Drag to pan · wheel to zoom';
  } catch (error) { report(error); }

  document.querySelector('#file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const model = await importer.parse(await file.arrayBuffer(), font, {
        name: file.name,
        onProgress: progress => { status.textContent = `${progress.phase}: ${progress.entities}`; }
      });
      await engine.setModel(model);
      status.textContent = `${model.count.toLocaleString()} entities`;
    } catch (error) { report(error); }
  };
  canvas.onpointerdown = event => {
    canvas.setPointerCapture(event.pointerId); drag = [event.clientX, event.clientY];
  };
  canvas.onpointermove = event => {
    if (!drag) return;
    engine.pan(event.clientX - drag[0], event.clientY - drag[1]);
    drag = [event.clientX, event.clientY];
  };
  canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    engine.zoomAt(event.clientX - rect.left, event.clientY - rect.top,
                  Math.exp(-Math.max(-600, Math.min(600, event.deltaY)) * .0015));
  }, { passive: false });
  window.addEventListener('beforeunload', () => { importer.cancel(); engine.dispose(); });
</script>
```

## ComputeCad

Constructor: `new ComputeCad(canvas, options)`.

Options: `memoryBudget` in bytes, `maxPixels`, `pixelRatio`, `powerPreference`, `cache`, `batch`, `maxFramesInFlight` (1 or 2), and `fragmentCapacity`. Defaults are documented in ARCHITECTURE.md. A WebGPU adapter and a secure context are mandatory.

- `await initialize(font)`: acquire the device, validate WGSL compilation, create pipelines, build the font atlas and resize resources. Propagates a CadGpuError with details on failure.
- `await setModel(model)`: upload/prepare a packed model, build its GPU index, calculate extents, and fit the camera. This is not a lossless DXF editing session. A failed allocation can clear the current GPU scene; retain/reload the source document at the integration boundary.
- `requestFrame()`: coalesced invalidation; preferred over a perpetual RAF loop.
- `render()`: explicit frame submission, primarily for test/benchmark use.
- `fit()`, `pan(dx,dy)`, `zoomAt(cssX,cssY,factor)`, `worldAt(cssX,cssY)`: camera operations using CSS pixels for input.
- `updateLayer(index, patch)`: changes color/visible/locked layer metadata and uploads its 16-byte record. Locking is metadata; the application must enforce editing policies.
- `await setAnnotations(packedModel)` and `await setPreview(packedModel)`: independent committed and transient overlay paths. Preserve base origin and non-overlapping ID ranges as AnnotationStore does.
- `await pick(cssX,cssY,radius)`: GPU pick result, zero for background.
- `await measure([x0,y0],[x1,y1])`: float result [distance, abs(dx), abs(dy), angle].
- `await captureMetrics({force:false})`: on-demand diagnostic compute and pooled small readback. Duplicate frame samples are reused; `force:true` explicitly resamples. It does not fetch geometry. Diagnostic wall time is reported separately.
- `await exportPng()`: explicit framebuffer readback, returns a PNG Blob.
- `dispose()`: release resources and cancel pending frame invalidation.

`camera` contains x/y/zoom/angle (angle is in radians). `settings` contains textLOD, curveTolerance, strokeWidth. Changes require `requestFrame()`. `flags` bits are grid=1, adaptive text=2, monochrome=4, ordered alpha=8. Use `setCompositing()` to change bit 8 because it owns the associated resources. Clearing bit 2 selects exact text. `metrics.gpuMs` is null when timestamp-query is unavailable; `cpuMs` is CPU encoding time, not GPU time. Error events carry the Error in `event.detail`. Device loss is fatal to the current instance; reload/reconstruct rather than silently claiming recovery.

## CAD-independent model and annotations

```js
import { ModelBuilder, TYPE, FLAGS, rgba } from './packages/model/index.js';
import { AnnotationStore } from './packages/annotations/index.js';

const builder = new ModelBuilder(font, {
  name: 'Factory plan',
  origin: [6_000_000, 4_000_000],
  layers: [{name: 'Equipment', color: rgba('#85d7ca'), visible: true}]
});
builder.line([6_000_000, 4_000_000], [6_000_500, 4_000_000]);
builder.text('P-101', 6_000_020, 4_000_030, 12);
const model = builder.finish();
await engine.setModel(model);

const annotations = new AnnotationStore();
annotations.add([{
  type: TYPE.POLYLINE,
  anchor: [6_000_000, 4_000_000],
  points: [[6_000_000,4_000_000], [6_000_100,4_000_000],
           [6_000_100,4_000_080], [6_000_000,4_000_080]],
  flags: FLAGS.CLOSED,
  color: rgba('#ffb05c')
}], {label: 'Inspect clearance', author: 'Reviewer'});

// setModel appends review and measurement layers after the base model's layers.
await engine.setAnnotations(annotations.build(font, model, model.layers.length));
const json = annotations.toJSON();
annotations.undo();
annotations.redo();
// annotations.load(json) replaces groups through an undoable transaction.
```

Annotation entities accept LINE, ELLIPSE, POLYLINE, TEXT, TRIANGLE, POINT and CLOUD, finite 2D anchor, four-element p/q/r arrays and optional points/text/color/flags. Validation rejects malformed geometry. `setPreview(entities)` changes only transient state; `buildPreview(font,baseModel,layer)` assigns IDs after committed groups. It is intentionally separate from `build`, so pointer motion does not rebuild committed geometry. `change` events distinguish `detail.kind === 'preview'` from committed changes. `LocalWorkspace` stores an explicit save in IndexedDB, scoped to the site and browser profile.

## DXF and font modules

`parseDxf(stringOrArrayBuffer,font,options)` is synchronous and suitable for a worker or Node tests. `DxfWorkerClient.parse` transfers ownership of the supplied ArrayBuffer; it is detached on the caller. `cancel()` terminates the parse worker. The result contains pages, layers, origin, count, diagnostics, and missing-codepoint information. Inspect diagnostics before treating an import as complete.

`makeBuiltinFont()` returns the original technical stroke face. `parseTrueType(arrayBuffer, codepoints, options)` supports static glyf-outline TTF and the bounded horizontal layout profile; unsupported containers/composite modes/variable fonts throw or report the documented limitations. Keep user font licensing obligations at the integration boundary. The distribution contains no imported/system font files.

## Workbench automation

The full application exposes `window.Aperture` after script initialization. Await `Aperture.ready`; success sets `Aperture.initialized`, failure sets `Aperture.initializationError`.

```js
await Aperture.ready;
if (!Aperture.initialized) throw new Error(Aperture.initializationError?.message);
await Aperture.loadStress(1_000_000, 2); // mode 2: unique numeric text
Aperture.engine.flags &= ~2;           // exact text, not density proxies
Aperture.engine.requestFrame();
await Aperture.engine.device.queue.onSubmittedWorkDone();
console.log(await Aperture.engine.captureMetrics());
```

Also exposed: engine, annotations, importer, font, model, ModelBuilder, TYPE, FLAGS, rgba, parseTrueType, parseStrokeFont, loadDxf(File), loadDemo(), loadFeatures(), version. The UI Compute Lab records warmups/samples and exports benchmark JSON. Do not read a GPU timestamp value as an end-to-end frame/presentation latency measurement.


## v2 performance/quality configuration

```js
const engine = new ComputeCad(canvas, {
  memoryBudget: 768 * 1024 * 1024,
  maxPixels: 8_294_400,
  pixelRatio: globalThis.devicePixelRatio || 1,
  cache: true,
  batch: true,
  maxFramesInFlight: 1,
  fragmentCapacity: 4_194_304
});
await engine.initialize(font);
await engine.setModel(model);
engine.setPerformance({cache: true, batch: true, guardBand: 0.25, compaction: 'mask'});
engine.flags &= ~2;  // exact glyph path; not density proxies
engine.setCompositing('opaque'); // or 'exact': bounded ordered source-over
engine.requestFrame();
```

`setPerformance` invalidates relevant coverage/visibility metadata. `setCompositing` allocates/frees fragment resources and rejects budget violations. `setAdaptiveResolution({targetMs:12,minScale:.5,maxScale:1,interval:24})` enables the optional governor; absence of real GPU timestamps is an error. `setAdaptiveResolution(null)` returns to the configured base pixel ratio. Resolution changes are a deliberate quality tradeoff, never silently applied by the fixed-quality A/B benchmark.

`setSize(cssWidth,cssHeight,pixelRatio)` handles resize with bounded allocation. Integrations using a governor should retain `engine.options.pixelRatio * (engine.governor?.scale || 1)` rather than resetting its scale on every ResizeObserver event. Failures must be surfaced to the user. Attach observers/listeners only after successful initialization and clean them up with the engine.

## Fixed-record GPU edits

```js
await engine.patchEntities([
  { id: 1, color: rgba('#f4ac72'), anchor: [6_000_010, 4_000_020] },
  { id: 2, p: [100, 0, 0, 0], layer: 0 }
]);
```

Accepted fields are `anchor` (two finite numbers), `p/q/r` (four finite numbers), color, layer and flags. IDs must be unique within the patch and refer to retained non-synthetic base records. The complete batch is validated before writes. The geometry-edit payload is 128 bytes per edited entity; adjacent records are coalesced and only affected pages are prepared/reindexed, returning 16 bytes per changed page. Color/layer-only updates instead write 8–16 bytes and skip geometry processing. No auxiliary topology or original-DXF writeback is implied. Changing generic `p/q/r` fields must respect the entity-kind ABI. This is not yet a semantic editing/constraint/undo system.

## Parametric hatch and dimension records

```js
const b = new ModelBuilder(font, {name: 'Parameters, not expanded geometry'});
const corners = [[0,0],[100,0],[100,60],[0,60]];
b.add({
  type: TYPE.HATCH, anchor: [0,0], layer: 0,
  hatch: {
    style: 0, solid: false,
    edges: corners.map((a,i) => ({kind:1,loop:0,flags:1,a,b:corners[(i+1)%4]})),
    families: [{angle:Math.PI/4,base:[0,0],offset:[-5,5],dashes:[8,-3]}]
  }
});
b.add({
  type: TYPE.DIMENSION, anchor: [0,0], layer: 0,
  dimension: {
    kind: 0, points: [[0,-15],[50,-12],[0,0],[0,0],[100,0],[0,0],[0,0]],
    text: '<>', precision: 2, textHeight: 3, arrowSize: 2,
    extensionOffset: 1, extensionLength: 2, gap: 1, measureScale: 1
  }
});
await engine.setModel(b.finish());
```

Hatch edge kinds: 1 line, 2 bulge edge, 3 conic, 4 spline. Conics use center/major/ratio/start/sweep; spline data uses degree/knots/points/positive weights. Pattern families contain radians, base/offset points and signed dash lengths. Dimension definition points correspond to DXF groups 10 through 16. Kinds are 0 rotated-linear, 1 aligned, 2 two-line angular, 3 diameter, 4 radius, 5 three-point angular, 6 ordinate. Style behavior is limited as documented in `CONFORMANCE.md`.

## Font selection and source preservation

```js
import { parseTrueType } from './packages/font/index.js';
import { parseStrokeFont } from './packages/font/stroke.js';
import { parseDxf, originalDxf } from './packages/dxf/index.js';

const nextFont = parseTrueType(await localFontFile.arrayBuffer(), codepoints, {
  maxGlyphs: 4096, cellSize: 64, script: 'latn',
  features: ['ccmp','liga','rlig','kern']
});
// Alternative: parseStrokeFont(await localStrokeFile.arrayBuffer()).
await engine.setFont(nextFont);
// Glyph IDs belong to the selected font. Rebuild/import the model after a font change.
const rebuilt = parseDxf(await drawingFile.arrayBuffer(), nextFont, {
  name: drawingFile.name, preserveSource: true,
  regenerateDimensions: true, space: 'model'
});
await engine.setModel(rebuilt);
const unchangedOriginal = originalDxf(rebuilt);
console.log(nextFont.diagnostics);
```

The same import options are forwarded by `DxfWorkerClient`. It detaches the input ArrayBuffer. `originalDxf` requires `preserveSource:true` and returns original data, not a rewrite containing patches. The app can export the original File directly without enabling a second source copy. Source preservation is optional because large files increase host memory pressure.

Never reuse old packed glyph IDs after replacing a font. `setFont` marks the current model as needing a rebuild and prevents rendering it with incompatible IDs. Full font files remain user-provided, local and subject to their licenses.

## A/B benchmark and telemetry

```js
engine.flags &= ~2;
const result = await engine.benchmarkProfiles({
  frames: 60, warmup: 8, panPixels: 160,
  profiles: [
    {name: 'reference', cache: false, batch: false, compaction: 'scan'},
    {name: 'optimized', cache: true, batch: true, compaction: 'mask'}
  ]
});
console.log(result.profiles.map(p => ({
  name: p.name, gpuP95: p.gpuMs.p95,
  cpuP95: p.cpuEncodeMs.p95, completionP95: p.queueCompletionMs.p95
})));
```

Run it only with an initialized, idle resident drawing. It temporarily suspends normal invalidation and adaptive resolution, restores camera/profile state in `finally`, rejects invalid quality changes or fragment overflow and leaves missing GPU timing as null. Model/font/layer/performance changes are rejected during a benchmark. It does not certify actual presentation FPS or automatically eliminate thermal effects.

New metrics include `visible` (guarded candidates), `glyphs` (logical source slots), `batchEntities`, `cooperativeEntities`, `cullPasses`, `visibilityCacheHits`, `baseRasterized`, `overlayRasterized`, `executedRasterWorkgroups`, `rasterWorkgroups` (queue-derived potential work), `curveCapHits`, `fragmentCount`, `fragmentOverflow`, `measuredFrame` and payload transfer counters. Some retained-page counters describe the last rasterization of that page; interpret them alongside `executedRasterWorkgroups` and cache state. Call `captureMetrics()` on demand rather than reading geometry every frame.

## Explicit native/offscreen initialization

Browser applications still call `await engine.initialize(font)` and retain secure-context and `navigator.gpu` checks. Native hosts may call:

```js
await engine.initializeAdapter(font, adapter, presentationContext);
```

The adapter must be a real WebGPU adapter. The presentation context must implement `configure(options)` and `getCurrentTexture()` returning a correctly sized `rgba8unorm` storage-writable GPUTexture. The host supplies canvas dimension properties and animation scheduling. This is not a fallback renderer or a secure-context override. See `tools/native-webgpu.mjs` for a complete runnable host.

After initialization, `engine.compilation` contains module and pipeline status/timing. `ShaderBuildError.details` carries original-file paths, line/column, assembled locations and excerpts; `.report` carries structured errors. Initialization failure disposes the partially created device; construct a new engine to retry.

The 128-byte edit API preflights spatial-index scratch before uploads. A budget rejection leaves retained host and GPU records unchanged. `DxfWorkerClient` cancels and terminates the previous request, rejects progress/postMessage failures, and ignores obsolete callbacks. Failed annotation transactions preserve undo/redo history.

## v2.2 transfer-aware integration

```js
engine.setPerformance({cache: true, batch: true, guardBand: 0.25, compaction: 'mask'});
// Use 'scan' for an actual reference comparison, not a different renderer.
await engine.patchEntities([{id: 1, color: rgba('#f09060')}]); // 8 bytes, no geometry rebuild
await engine.patchEntities([
  {id: 2, anchor: [20, 10]},
  {id: 3, anchor: [30, 10]}
]); // One 256-byte write when these adjacent IDs are in the same page.

// Do not capture diagnostics in every production animation frame.
const sample = await engine.captureMetrics();
console.log({gpuMs: sample.gpuMs, cpuMs: sample.sampledCpuMs,
  diagnosticWallMs: sample.telemetryWallMs, lastUniformBytes: sample.frameUniformBytes});

const comparison = await engine.benchmarkProfiles({frames: 60, warmup: 8, profiles: [
  {name:'scan / cooperative',cache:false,batch:false,compaction:'scan'},
  {name:'mask / batched / cached',cache:true,batch:true,compaction:'mask'}
]});
```

The browser comparison uses the **same current-release source** with explicit switches; `tools/profile-release.mjs` compares actual separate release source trees and `tools/compare-profiles.mjs` rejects different GPU timestamp scopes. Benchmark output schema 4 includes timing scope/status as well as `telemetryWallMs` and `iterationWallMs`. These are not added to `gpuMs` and mislabeled as device timestamps.

A geometry edit returns sixteen bytes per changed page, not every base page. Color/layer edits skip geometry rebuilds. `r` on TEXT is reserved for the prepared matrix in GPU records; change source `p/q` to alter text geometry. General `patchEntities` validation and the no-kind-change/no-aux-growth restrictions still apply. Retain source documents for recovery: fixed-record edits are not a transactional, lossless DXF database.
