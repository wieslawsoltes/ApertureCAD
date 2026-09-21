# 2.4 continuation

The 2.3 timing and document contracts below remain. `captureTiming()` now provides a separate 16-byte, no-diagnostic timestamp path. Timing and counter sample frames are tracked independently, with monotonic/epoch guards and single-consumption governor updates. Optional automatic UI sampling uses that path. Paper view queues/coverage may be retained within a bounded optional budget; no geometry duplication or quality-changing reprojection is introduced. See `OPTIMIZATION-v2.4.md` and `API.md` for current contracts.

# Timing, layouts and document tabs — 2.3.0

## 1. Timing failure and repaired contract

The previous orchestration wrote a beginning timestamp in an empty compute pass, then resolved the shared query slots from later telemetry work. This combined an avoidable empty-pass path with weak sample ownership. A missing/zero beginning and a valid ending can look like GPU clock uptime instead of elapsed work. This is a code-path diagnosis, not proof that the user's exact adapter produced that specific endpoint pair.

The new pass descriptor writes both endpoints of the actual nonempty CAD pass. `resolveQuerySet` immediately follows `pass.end()` in the same encoder. A diagnostic copy observes the already resolved values before asynchronous mapping. A captured scene epoch prevents a completed map from publishing into a different file or layout.

```js
const pass = encoder.beginComputePass({
  timestampWrites: {
    querySet,
    beginningOfPassWriteIndex: 0,
    endOfPassWriteIndex: 1,
  },
});
// Actual visibility, rasterization and composition dispatches.
pass.end();
encoder.resolveQuerySet(querySet, 0, 2, queryResolve, 0);
queue.submit([encoder.finish()]);
// Read back when explicitly sampling; do not resolve reused queries here.
```

`packages/performance/timing.js` validates unsigned 64-bit BigInt endpoints. Conversion is `Number(endNs - beginNs) / 1_000_000`: subtraction precedes floating-point conversion. Zero endpoints are conservatively unavailable; reversed or malformed values are rejected. A configurable 60-second interval bound and a submission-to-map wall-time upper-bound sanity check reject inconsistent samples. Wall time is never used as the GPU measurement. The bound can reject a genuine extreme-duration operation; rejecting a sample is intentional and is reported, not represented as a fast frame.

A zero delta between nonzero endpoints is labeled `below-resolution`. Missing/unsupported/stale values have `gpuMs:null`, a reason in `gpuTimingStatus`, and an em dash in the UI. Valid sub-0.01ms samples display `<0.01`. The governor does not consume invalid values. Timing resets when changing file or space.

The standalone profile exporter records an explicit scope and rejects invalid measured samples. The comparison tool rejects mixed compute-pass/legacy-clearing scopes and unavailable timing status, so scope narrowing cannot become a reported speedup. These checks have their own process-level regression tests.

The native regression checks real timestamp data against BigInt subtraction and injects an unwritten start with an ending corresponding to **615296880.54 ms**. It also starts mapping in one layout and changes layout before completion. Both invalid ownership cases are rejected. Additional unit tests cover timestamps above JavaScript's exact integer range.

### Timing scope is explicit

`gpuTimingScope: 'compute-pass'` measures the nonempty pass, including the paper-view compute loops when present. Native buffer clears before that pass, host uploads, CPU encoding/queue waiting, diagnostic sampling, mapping and canvas presentation are excluded. `cpuMs`, `telemetryWallMs` and transfer counters remain separate. The UI calls this **GPU compute**, not whole-frame duration or FPS. Benchmark schema `aperture-benchmark/4` records sample status, invalid sample count and this scope.

**Do not directly compare this number to v2.2 intervals that included native clears.** A smaller interval from a scope change is not a speedup. Existing historical comparisons have been preserved as historical evidence, not reclassified as v2.3 performance claims.

## 2. DXF catalog and independent coordinate origins

`parseDxfDocument(input, font, options)` and worker option `{document:true}` produce a document model. Legacy `parseDxf()` retains its default Model-only behavior and optional model/paper/all filter for compatibility.

The catalog resolves entity group 410, group 67 and deferred entity owner → BLOCK_RECORD → LAYOUT references. Common-owner parsing does not confuse reactor handles with entity ownership. Layout and plot-setting subclasses are parsed separately even where group codes repeat. Model-space and paper-space root blocks are recognized without duplicating already-present entity handles. Named VIEW records are cataloged alongside VIEWPORT entities.

A document contains `spaces`, `namedViews`, `initialSpace`, `pages`, shared `layers`, and one stable globally contiguous entity-ID range. A space includes `id`, `name`, `kind`, `order`, `count`, `pageIndices`, `origin`, `viewports`, and optional `paperSize`. Empty registered layouts are retained. VIEWPORT metadata does not become a fake ordinary CAD entity.

Each space has its own double-precision host origin. Its page headers use the existing high/low coordinate path. This prevents a model near a billion world units from forcing a millimeter-size paper layout into the same subtraction frame. `setSpace` updates the active model origin, camera and annotation coordinate domain; paper viewport uniforms reference the Model-space origin while sheet geometry references the paper origin. Entity records remain 128 bytes.

## 3. Paper-view projection and compute composition

For supported top-plan views, let θ be DXF twist, T the target, C the DCS center, P a model point and Q the paper viewport center. The model-to-paper mapping is:

    paper(P) = Q + (paperHeight / modelViewHeight) × (R(θ) × (P − T) − C)

The camera is `T + R(−θ) × C` with angle `−θ`; screen projection uses its inverse rotation. The regression fixture was generated with ezdxf, and five point transforms for each of three viewports were independently evaluated by `Viewport.get_transformation_matrix()`. The included reference JSON is numeric data, not a copied rendering implementation.

Viewport dimensions and centers, model view heights, targets, view centers, twists, off flags and frozen layer handles are read from DXF metadata. Each visible supported viewport gets a reusable 128-byte frame and frozen-layer palette. All viewports reference the same Model entity, auxiliary, bounds, order and style resources. A single 4-bytes-per-canvas-pixel scratch coverage allocation is reused serially; the viewport rectangle is clipped to the canvas first for dispatch sizing, avoiding zoom-expanded pixel allocations.

The compute sequence for a sheet is:

    clear/init base and summaries
    for each visible supported model viewport:
        clear scratch → cull → indirect dispatch → rasterize
        sum instance candidates → copy clipped scratch into sheet coverage
    rasterize paper entities and review overlays
    resolve opaque coverage into the canvas texture

`sumViewport` and `copyViewport` are the two new compute pipelines. Work remains proportional to the visible views and geometry they show. No CPU tessellation or per-view geometry duplication is introduced. Model entity IDs remain stable in every viewport, so picks refer to the same original entity. Paper entities use separate stable ID ranges. Candidate counts include viewport instances; the current paper-instance glyph diagnostic is unavailable (`null`/`—`) rather than falsely zero.

Only opaque multi-viewport composition is supported. Selecting a composed paper layout leaves ordered-alpha mode explicitly; it does not silently pretend to produce exact transparency. Existing ordered alpha is retained for Model. Paper viewport overlap is deterministic, not a complete AutoCAD plotting-order implementation.

Unsupported perspective, non-top/3D and nonrectangularly clipped views remain discoverable with diagnostics. Named top-plan views are selectable; rotated whole-paper named views are explicitly unsupported because sheet composite rectangles currently assume an axis-aligned sheet camera. This is not complete UCS, hidden-surface, paper plotting, printer setup or viewport-override parity.

## 4. Document ownership and CPU–GPU boundary

`DocumentWorkspace` assigns identity independently of filename. Packed source models, original Files, font selection, display/layer configuration and per-space review/camera state belong to that identity. Two identically named files never share their review history.

Exactly one file is GPU-resident at a time. Changing files retains the GPU device, compiled pipelines and common surfaces but uploads/prepares that file's retained packed data. It does not reparse the DXF. All space partitions of the active file are resident; changing layout selects those page buffers without re-uploading them. Per-view constants and scratch resources are updated as needed. This bounds GPU entity residency instead of assuming all open large drawings fit simultaneously.

Default document admission is 32 tabs and 1.5 GiB of counted source/packed CPU storage. This is an admission estimate, not total-heap accounting: JavaScript metadata, font objects, history and browser/driver overhead are not all included. Existing GPU memory guards still apply. Closing a tab removes its retained ownership references; engine resources are disposed/replaced when changing active GPU ownership.

Imports, activations, layout changes, font changes, closes and workspace persistence pass through one asynchronous document-operation queue. Annotation flushing is drained before switching. Source identity is committed after activation succeeds; failure restores the prior tab rather than leaving Export original attached to the failed incoming file. Async picking, hover, measurement and note placement use scene ownership guards.

## 5. UI and persistence

The first tab strip is for files; the second is for Model/paper layouts. Both have tab roles, selected state, roving focus, arrow/Home/End navigation and constrained horizontal overflow. Ctrl/Command + Page Up/Page Down changes files. Close buttons retain independent labels. The view selector lists named views and viewport cameras; unsupported entries stay visible but disabled.

Cameras, selected IDs, annotations, undo and redo are per space. Layers, font and display options are per file. A new layout does not inherit another layout's review geometry. Close prompts protect dirty reviews. Workspace format v3 stores all documents and space states; older v2 single-file records can be read. Restoring appends saved documents rather than overwriting currently open unsaved work.

Public workbench operations:

```js
await Aperture.openFiles(fileList);
await Aperture.switchDocument(documentId);
await Aperture.switchSpace(spaceId);
await Aperture.closeDocument(documentId);
await Aperture.saveWorkspace();
await Aperture.restoreWorkspace();
console.table(Aperture.documents.documents);
```

A direct embedding of `ComputeCad.setSpace()` does not manage external annotations or undo stacks; that is the host's responsibility. The workbench wrapper handles it. Original DXF export remains unchanged source, and review JSON/DXF remain separate overlays. Multiple tabs do not imply edited lossless DXF export.

## 6. Evidence and sources

Core tests: `tests/timing23.test.mjs`, `tests/documents23.test.mjs`. Real GPU tests: `tests/gpu-views23-regressions.js`, run by native and permitted-browser harnesses. Numeric fixture: `tests/layout-reference.json`; optional regeneration: `python tools/make-layout-fixture.py` with ezdxf installed. The runtime has no ezdxf dependency.

`tests/workspace-ui.py` runs the real app controller and real import workers in a DOM using **explicit test engine and storage doubles**. These tests verify multi-file identity, state isolation, serialization and UI wiring, not GPU rendering or actual IndexedDB operation. The double is only in tests; it is not bundled into the app. Full browser GPU navigation remains policy-blocked in the tested environment. Real native execution uses Dawn/Vulkan/SwiftShader and is software-adapter evidence, not hardware-GPU or browser-presentation qualification.

Primary references consulted:
- WebGPU compute-pass timestamp writes: https://developer.mozilla.org/en-US/docs/Web/API/GPUCommandEncoder/beginComputePass
- Query resolution: https://developer.mozilla.org/en-US/docs/Web/API/GPUCommandEncoder/resolveQuerySet
- Autodesk VIEWPORT group codes: https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-DXF/files/GUID-2602B0FB-02E4-4B9A-B03C-B1D904753D34.htm
