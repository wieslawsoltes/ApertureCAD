# Aperture CAD 2.2 — GPU and CPU–GPU boundary audit

This document describes implemented source changes, not a proposal. The starting point is the delivered v2.1.0 source archive. The drawing is still evaluated and rasterized by WGSL compute pipelines. Resource initialization, buffer clearing, copies and presentation use the corresponding WebGPU API operations. There is no vertex/fragment, WebGL, SVG or Canvas2D CAD renderer.

## Audit scope and disposition

| Source / path | Reviewed responsibilities | Implemented change or reason retained |
|---|---|---|
| `scene.wgsl`: transforms and preparation | Compensated origins, OCS/INSERT chains, text transforms, bounds, style publication | Cache the complete text matrix in the existing TEXT `r` field; add finite-only leaf summaries; reduce roots from summaries rather than rescanning all entities; prepare one persistent text-presence flag per page. |
| `scene.wgsl`: visibility | Numerical/stroke padding, layer filtering, small/large classification, tails, queue capacity | Bounds-first field loads; cached text matrix in classification; portable mask compaction with the old scan retained; unchanged conservative guard band. |
| `scene.wgsl`: indirect scheduling | Two-dimensional dispatch limits, small/large queue sizes, persistent cached windows | Build all arguments only when visibility is rebuilt; reuse on guarded pans; add a diagnostic dispatch record which is zero on text-free pages. |
| `scene.wgsl`: line, point, conic and text raster | Cooperative versus lane assignment, clipping, antialiasing, decimal labels | Preserve shared exact geometry routines and v2.1 specialized batch call graph; remove per-text raster telemetry atomics; remove a redundant glyph metadata fetch; reuse prepared text transforms. No sampling tolerance or framebuffer reduction is used for the release comparison. |
| `scene.wgsl`: NURBS, path fills, clouds | Local-array pressure, divergence, work bounds and clipping | Retain the validated rational evaluator and explicit work caps. These heavier routines remain unreachable from the small-entity pipeline. General per-type queue expansion is not added without target-adapter evidence. |
| `hatch-common.wgsl` | Analytic crossings, nesting, spline boundaries, dash repetition | Prepare dash periods once. Cache each positive-weight rational edge's local control hull in unused edge words; reject impossible crossings before de Boor evaluation. No new auxiliary upload format is required. |
| `dimension-common.wgsl` | Seven kinds, arrows, extension geometry, direct numeric labels | Reviewed, unchanged in this release. These are already GPU-generated from compact definitions. Full associative/DIMSTYLE conformance is not inferred from this audit. |
| `index.wgsl` | Histogram, prefix offsets, scatter, Morton cluster bounds | Reviewed, retained as load/edit-time work. The 256-bucket hierarchy is not a BVH. Its scratch allocations remain bounded and reused per page. |
| `font-common.wgsl` | Glyph metadata, direct edge distances, quadratic roots, winding | Pass the already-loaded glyph into atlas sampling. Preserve the analytic distance and winding algorithms rather than introduce an unqualified approximation. |
| `font.wgsl` | One-time distance-atlas generation | Reviewed, retained. Atlas size, outline caps and font semantics are unchanged. |
| `layout-common.wgsl` | GSUB/GPOS tables, immutable originals, run layout | Reviewed, retained. Restoring original glyph IDs before layout remains essential for repeatable preparation. This is still a bounded horizontal shaping profile. |
| `stroke.wgsl` | SHP/SHX VM, bounded stack/program/edge output | Reviewed, retained. One-time execution and allocation guards are preferable to a new unmeasured cache which could invalidate source programs incorrectly. |
| `pixels.wgsl` | Clear, compositing, picking, measurements, grid | Separate opaque and exact resolve call graphs; skip an absent overlay; hoist frame-constant grid spacing; use native buffer clears on the hot path while keeping reference clear kernels. |
| `gpu/index.js`, `compiler.js` | Resource ownership, shader contracts, bindings, dispatch, mapping | Sparse uniform spans; persistent arguments; cached presentation bindings where texture identity permits; bounded readback pool; sparse style edits; coalesced geometry edits; only changed page roots cross back on edit. All pipelines still go through real compiler validation. |
| `performance/index.js` | Coverage/window invalidation and benchmark semantics | Allocation-free per-page visibility signature comparisons; page-local invalidation; reference scan profile; detailed frame, diagnostic and iteration timings. |
| `model`, `dxf`, workbench boundary | Parameter packing, transferable buffers, update ownership, telemetry | Preserve worker-transfer ownership and original parameter packing. No CPU per-frame entity walk. Automatic diagnostic sampling is now off by default and can be explicitly enabled. |

Review is not a formal verification claim. Real regression cases, source hashes and measured profiles accompany this package.

## 1. Prepared data replaces repeated arithmetic

A TEXT record already had sixteen spare bytes in `r`. Preparation now evaluates

```
T = objectToWorld * rotation(angle) * textSizeWidthOblique
```

and stores the two columns in `r.xy` and `r.zw`. The original size, alignment and angle parameters in `p/q`, and the original transform-chain reference, are retained. Subsequent preparation recomputes from those originals; it does not multiply an already-prepared matrix again. Culling and rasterization load the cached basis. Frame-dependent projection and inversion remain GPU work because zoom/DPR can change.

This costs **zero additional entity bytes** and avoids repeated rotation/oblique/fit calculations across culling and the 64 cooperative raster lanes. It does not change the f32 geometry representation or introduce CPU tessellation.

For hatches, family word 7 stores the prepared dash period. A rational edge's spare words 11–14 store its local positive-weight control hull. For a horizontal ray originating at `p`, an edge cannot cross when `p.y < minY`, `p.y >= maxY`, or `p.x >= maxX`. Those conditions avoid both repeated hull reconstruction and expensive spline sampling. The positive-weight assumption is validated by the model builder and remains part of the contract.

## 2. Portable bit-mask compaction

A 128-lane cull workgroup uses four `u32` words for each of the small and cooperative queues. A qualifying lane sets one bit in its queue's workgroup-local mask. The leader counts bits and reserves one contiguous span in each global queue. For lane bit `b` in word `w`, inclusive rank is:

```
rank = sum(popcount(mask[j]), j < w)
     + popcount(mask[w] & (b | (b - 1)))
```

The small queue writes forward at `baseSmall + rank - 1`; the cooperative queue writes backward at `pageCount - baseLarge - rank`. A source entity belongs to at most one queue, so both queues fit in the original `pageCount * 4` allocation. A masked-out tail lane participates in barriers but never reserves a slot.

For an active cluster, this changes the source-level synchronization schedule from the scan's 17 synchronization phases to three: initialize/publish cluster state; finish masks; publish queue reservations. The mask payload is 32 bytes rather than a 1,024-byte two-component prefix array, excluding shared flags and reservation offsets. These are source-level storage/work reductions, not claims about a driver's final occupancy or register allocation.

No subgroup size, subgroup feature, 64-bit atomic, or vendor-specific extension is assumed. `setPerformance({compaction:'scan'})` retains the original scan for correctness comparison and adapter-specific measurement. Zero-visible pages and odd-length pages are regression-tested.

## 3. Persisted queue counts and arguments

A visibility window represents geometry, layer visibility, zoom, DPR, text mode, font revision, batching mode and the padded world-space view. A camera pan within that window can reuse both its queues **and its indirect arguments**. Previously, arguments were still rebuilt every frame even when the queues were unchanged.

The page indirect buffer is now 48 bytes: cooperative raster at byte 0, lane-batched raster at byte 16, optional text sampling at byte 32. The extra sixteen bytes are per page, not per entity. GPU-prepared `stats[8]` identifies whether a page contains TEXT, so pure geometry pages schedule zero text-sampling workgroups. Frame counter resets preserve that flag; entity kind is immutable in the fixed-record edit API.

Selection, hover and palette changes can resolve existing opaque coverage. They do not rebuild queues. An affected-page edit invalidates that page's visibility window without throwing away unrelated page windows. Conservative stroke/DPR padding and zoom-driven classification invalidation are preserved.

## 4. Clearing and composition

Coverage storage is zeroed with `GPUCommandEncoder.clearBuffer`, rather than an atomic-store compute dispatch per 256 pixels. Counter resets clear only the relevant byte ranges. An inactive overlay is not cleared or rasterized: the frame's overlay-presence field prevents both resolve and pick from reading stale overlay coverage. Clearing the exact compositor's header/head region makes old fragment nodes unreachable; unused node storage is not cleared.

The default `resolve` pipeline has no fragment-arena binding or linked-list branch. `resolveExact` is independent. Thus the opaque path's compiled call graph no longer includes the ordered-alpha traversal. The exact algorithm itself remains bounded, potentially quadratic in overlap, and explicitly detects exhausted fragment storage.

Grid spacing depends on zoom, not the pixel coordinate. Its logarithm/power is calculated once into the existing uniform and reused across all resolve pixels. Presentation texture views and bind groups are cached by actual `GPUTexture` identity; this helps persistent offscreen textures. A browser which returns a new texture object each presentation can still require a new binding. There is no assumption that a canvas texture lasts indefinitely.

## 5. CPU–GPU transfers

The frame ABI remains 128 bytes. A reused staging block is compared with its last submitted contents. At most one aligned span is written:

| Operation | Host → GPU payload | GPU → host payload |
|---|---:|---:|
| Initial frame uniform | 128 B | 0 |
| Identical uniform | 0 | 0 |
| Pan-only camera change | 4–16 B, depending on changed components | 0 |
| Selection-only or hover-only change | 4 B | 0 |
| Arbitrary combined uniform change | At most 128 B | 0 |
| Color-only record edit | 8 B total: entity tag + global style table | 0 |
| Layer-only record edit | 8 B total | 0 |
| Color and layer together | 16 B total | 0 |
| Geometry edit | 128 B per changed record; adjacent records share a queue call | 16 B per changed page root |
| Layer palette/visibility change | 16 B | 0 |
| Pick | 16 B query | 16 B result |
| Measurement | 32 B query | 16 B result |
| Explicit statistics capture | No geometry upload | `32 + 32 * residentPageCount` B |

These counts are API payload sizes, **not measured PCIe traffic**. A WebGPU implementation may use staging, IPC or unified physical memory. Mappable CPU buffers and device storage ownership still follow WebGPU's rules; a persistent mapped STORAGE buffer is not used as a shortcut.

Color-only updates avoid geometry preparation, spatial scratch, root readback and visibility invalidation. Geometry batches sort changed records by page/offset and coalesce adjacent ranges without uploading unchanged gaps. Editing one page returns one sixteen-byte root; cached roots for the other pages are reused for host camera-fit aggregation. Those tiny page summaries are not a CPU geometry model.

The pre-edit whole-queue wait is removed: record writes and the rebuild submission use the same queue in order. Device readback mapping still awaits the explicitly requested result. Frame submission retains bounded backpressure (one frame in flight by default, configurable to two); deleting that mechanism would merely hide queued latency.

## 6. Diagnostic work is explicit, bounded and visible

Per-text global telemetry atomics are removed from rasterization. `captureMetrics()` optionally traverses visible queues through `sampleText`, reduces counts per workgroup and reads small counters. Pure geometry pages schedule no text work. A cached resolve-only frame reuses valid text counts. Repeated capture of the same frame returns its existing sample unless `{force:true}` is requested.

The new `ReadbackPool` owns at most four buffers and 64 KiB, uses aligned capacity classes, and leases storage until mapping is finished/unmapped. Busy leases are never reused or evicted. Pool bytes participate in allocation accounting. Sequential GPU query results reuse a buffer rather than repeatedly creating/destroying it.

Text/glyph counts are **on-demand diagnostics of resident visible queues and current viewport predicates**, not an atomic trace proving that every logical glyph was rasterized. Adaptive numeric text can represent many logical glyphs by one density stroke. The workbench labels those distinctions.

Automatic telemetry is off by default; the user can sample or enable it. Enabling the optional resolution governor enables automatic sampling because that mode requires actual timestamp feedback. Sampling a large text scene can itself be expensive; it is not presented as free.

Metrics distinguish:

* `cpuMs`: CPU encoding/submission; `sampledCpuMs` correlates it with an asynchronous GPU sample.
* `gpuMs`: timestamp interval beginning **before native fills** and ending after resolve. Clears have not been moved outside the measured rendering interval.
* `queueCompletionMs`: host-observed submission/completion, not browser presentation latency.
* `telemetryWallMs`: explicit diagnostic encoding, execution and readback/mapping wall time, outside the rendering timestamp.
* `iterationWallMs` in benchmark output: frame plus diagnostics, so moving diagnostics out of the raster is not hidden in the comparison.

No queue-map or geometry readback is needed for ordinary navigation when diagnostics are disabled.

## 7. Memory and complexity

The core persistent allocation is approximately `160.25 * N` bytes, plus auxiliary text/path/font data, fixed page buffers, layer/style reservation, framebuffers, optional fragments and driver overhead. The finite-leaf summaries add 0.125 B/entity compared with v2.1. Text matrix caching does not enlarge the 128-byte record. Exact-capacity visibility storage remains `4*N`; there is no per-frame glyph mesh or unlimited expanded primitive queue.

Preparation already computes each leaf. Root reduction now scans `ceil(N/128)` finite summaries rather than `N` entity bounds. This makes the single root workgroup's input approximately 128 times smaller; it does **not** make the entire model-preparation pipeline 128 times faster. Infinite XLINE/RAY bounds are excluded without dropping finite geometry in the same leaf.

Host frame scheduling is O(number of resident pages), plus fixed-size camera state, not O(number of entities). Raster time still depends strongly on projected length/area, exact glyph coverage, overlap, curve work and memory contention. A million subpixel labels and a million large exact text runs are different workloads.

## 8. Experiments rejected or constrained

An intermediate raster-time workgroup text-counter reduction regressed an exact-text workload. It is not the shipped path. The final design performs optional diagnostic reductions separately and skips text-free pages and unchanged samples. Earlier exploratory data is labeled under `artifacts/history-v2.2-experiments/`; current comparisons are the root-level paired profiles and `release-comparison.json`.

Subgroup-only prefix compaction, unbounded append queues, half-precision CAD coordinates, dropping antialiasing, lowering exact-text quality, reducing benchmark framebuffer size, unbounded frame queues and pretending buffer-clear time vanished were not used to manufacture a speedup. A universal hardware-optimal workgroup size is not asserted.

## 9. Qualification boundaries

Native validation uses Dawn with actual offscreen compute execution on Vulkan/SwiftShader. This validates executable shaders and finite regression cases. SwiftShader is a software adapter: timings are useful local comparisons, not hardware-GPU FPS or browser presentation qualification. Run the included harness on representative Metal, D3D12 and Vulkan devices before a production performance claim.

All seven release comparison workloads use fixed 640×480 output and identical traces. Exact text is used except for the explicitly named 100,000-label density workload. Final-frame raw coverage hashes are compared across releases and rounds. This comparison does not prove bit identity for every possible drawing or view.

The inherited 2D projection, partial DXF/font conformance, bounded spline work, opaque entity-order compositing, limited editing semantics and exact-alpha capacity constraints remain documented in `CONFORMANCE.md`. This optimization release does not claim to implement a 3D solid kernel or every remaining CAD feature.

## Primary technical references

Checked September 18, 2026:

- WebGPU Explainer, CPU/GPU timelines, mapping ownership, object lifetime and asynchronous validation: https://gpuweb.github.io/gpuweb/explainer/
- WGSL specification, host-shareable types, atomics, population count and workgroup synchronization: https://www.w3.org/TR/WGSL/
- Dawn's official Node bindings and native execution setup: https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/README.md

The repository's tests and raw artifacts, not those reference documents, are the evidence for Aperture's implementation and local measurements.
