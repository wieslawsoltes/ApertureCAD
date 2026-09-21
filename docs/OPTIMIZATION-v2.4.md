# GPU / host-boundary optimization audit — Aperture CAD 2.4.0

## Scope and execution ownership

This release optimizes the existing compute renderer; it does not introduce another renderer or expand the CAD/font conformance envelope. All drawing geometry evaluation, GPU font layout/atlas work, bounding/index construction, visibility, rasterization, viewport composition, picking and measurement remain compute pipelines. Native buffer fills/copies initialize resources or move existing GPU results. HTML/CSS renders the workbench. DXF/container decoding, block-reference normalization, packed model construction, event handling and camera parameter construction still run on the CPU. “GPU-only processing” does not mean a shader parses the DXF text file or runs the application's DOM.

The 128-byte entity ABI is unchanged. This release adds one compute entry point (`sumViewportCached`): five assembled modules, 28 pipelines. No vertex/fragment pipeline, WebGL, Canvas2D, CPU entity-raster path, external font network fetch, or remote drawing upload is introduced.

## 1. Per-viewport GPU visibility and indirect-argument ownership

In 2.3 each paper viewport reused the source page's visibility/statistics/indirect storage. Sharing geometry was correct, but a later viewport overwrote the earlier viewport's transient queue, so every pan had to repeat visibility and dispatch setup.

2.4 may allocate a private queue for each (viewport, Model page) pair. Entity, auxiliary, bounds, order and header buffers still reference the original resident Model page. Extra queue memory for N entities is exactly:

```
queue(N) = 4*N visible-index bytes + 64 statistics bytes + 48 indirect bytes
         = 4*N + 112 bytes
```

Each entity appears in at most one of the two-ended small/cooperative queues; capacity remains N. No CPU readback constructs those queues. The GPU writes counts and dispatch dimensions. Initial metadata needed by these queues is copied GPU-to-GPU from the prepared source page. Text-free pages preserve zero diagnostic dispatches.

The existing padded visibility planner can now retain each view's own queues. Fractional pans may need new pixels but reuse queues; scale, quality, layer, font, geometry or guarded-frustum changes rebuild them. A shared queue is used when the optional allocation budget cannot admit a private one. That path still performs normal compute culling and rasterization, not reduced-quality output.

## 2. Exact coverage reuse, not approximate image reprojection

If all queues for a viewport are private and the optional budget permits, the viewport receives a persistent 32-bit per-pixel coverage surface. Required bytes are `alignUp(width*height*4, 256)`. The existing shared scratch surface remains the serial fallback.

A `PaperRasterState` stores the relevant words of the 128-byte viewport uniform and the visibility revision. It compares **bit patterns**, not epsilon approximations. Camera high/low parts, local dimensions/scale/DPR, quality/text/batch modes and view rotation must agree. Selection, destination offset and global output dimensions are excluded only because they are applied later by the final resolve or `copyViewport` operation, not the local coverage kernels.

An integer-pixel sheet translation often changes only destination placement: local viewport coverage remains exactly the same. In that case the renderer skips clear, cull, indirect construction and entity raster for that viewport. It dispatches `sumViewportCached` to preserve candidate counts without reporting raster work that did not run, then `copyViewport` to place the unchanged coverage. All final selection and color resolution still use current state.

Fractional-pixel translation, zoom, changed visible clipping extent, viewport target/twist, layer palette, font/quality or source geometry edits invalidate the appropriate cached data. Fractional phases are **not** rounded to achieve a cache hit. This is not general Model-space raster reprojection. Zero-budget and cache-disabled configurations use the same baseline compute path with identical coverage.

## 3. Bounded memory and lifecycle

Constructor option `paperCacheBudget` defaults to **64 MiB** and must be a nonnegative safe integer. This is a limit on optional queue and persistent-surface resources, included within the existing total GPU budget (default 768 MiB), not an additional allowance outside it. It excludes mandatory per-view uniforms/palettes and shared scratch, which are separately counted in total allocation. No geometry is duplicated per view.

Optional admission reserves mandatory state for not-yet-created views. Failed partial allocations release their resources. Source edits invalidate affected view instances, even when the same Model page appears on several sheets. Layout/file changes dispose view resources; resize/font/annotation/edit pressure can evict optional caches before mandatory allocations. Cache resources remain bounded to the active layout, not an unlimited history or all open files.

Disabling `paperCache`, disabling visibility caching, setting `paperCacheBudget:0`, or exhausting the optional budget preserves rendering fidelity at the cost of recomputation. Only the active file occupies GPU entity storage; inactive file tabs retain packed CPU data as in 2.3.

## 4. Cheaper GPU-only diagnostic reduction

The detailed text diagnostic kernel is not the rendering kernel. Previously a 64-lane workgroup sampled at most 64 visible records before its shared reduction and global updates. Each lane now visits eight coalesced tiles, processing up to **512 records per workgroup**. The group performs one reduction, then at most three global atomic updates.

```
workgroups_old = ceil(visible / 64)
workgroups_new = ceil(visible / 512)
```

This is an up-to-eightfold reduction in diagnostic workgroup/reduction count, not a claimed eightfold GPU speedup. The exact old count predicates are retained. An odd-tail regression checks 1,025 generated numeric labels: three diagnostic workgroups, 1,025 visible labels and 12,300 logical source slots (four prefix characters and eight numeric positions per label). Density-text counts remain logical slots, not executed exact-glyph samples.

No global counter atomics were added to text rasterization. Full diagnostics remain explicit/on-demand and have their own measured wall time. Their cost is not hidden in a narrower GPU timestamp interval.

## 5. Timestamp-only readback and asynchronous sample provenance

`captureTiming()` copies exactly **16 bytes**: the two uint64 query endpoints already resolved by the actual compute submission. It does not traverse entity/visibility queues, dispatch the diagnostic kernel, copy page counters, or read geometry. A bounded existing staging pool supplies the mapped buffer. Duplicate same-frame requests reuse the result; concurrent calls share the pending promise.

The subtraction remains `Number(endNs - beginNs) / 1_000_000`, using validated BigInts. Unwritten, reversed, implausible and stale results are null with a reason. The reported 615296880.54-ms failure case remains rejected. Scene epochs prevent a map completing after a file/layout change from publishing into the new drawing. A monotonic timing-frame guard also prevents an older map replacing a newer valid timing sample.

`timingSampleFrame` and `countersSampleFrame` are separate. Taking a timing sample does not mark counters fresh. Detailed `captureMetrics()` remains available and preserves its own counter provenance. The resolution governor only consumes an increasing, matching, full-raster timing sample once, even when both APIs are called.

Automatic sampling is still off by default. Enabling the application's **Automatic GPU timing** now uses the 16-byte path; **Sample GPU counters** explicitly runs detailed diagnostics. The metric remains **GPU compute**, excluding native clears, uploads, CPU encoding, diagnostic processing, queue wait and browser presentation. It is not end-to-end frame latency or FPS. Sixteen payload bytes does not imply zero driver/map overhead or sixteen physical bus bytes.

## 6. CPU–GPU boundary and JS allocation review

Per-view uniform ArrayBuffer/typed views are reused, with aligned changed-span writes. Frozen-layer palettes now track a layer revision and frozen-layer key instead of allocating and joining a whole layer-state list on every pan. The CPU cache compares only a fixed-size uniform signature; it does not walk CAD entities to construct visible lists or glyph meshes. Existing sparse Model uniforms, eight-byte style patches, adjacent-record coalescing, local bounds readbacks and bounded staging leases remain.

No extra Model-space uniform transfer reduction is claimed: the release comparison records equal Model pan and selection payloads between versions. The demonstrated new gains come from paper dispatch/raster reuse and optional diagnostic sampling, not multiplying the previous sparse-upload savings a second time.

## 7. Reviewed but not changed

Model culling's conservative geometry, mask/scan compaction, line/curve/dimension rendering, exact glyph evaluation, atlas generation, SHX interpreter, OpenType subset, Morton indexing, opaque/ordered-alpha coverage, picking and measurement retain their established algorithms. Their native compiler and execution regressions were rerun. Exact text and heavy overlap remain costs; this release does not promise every raster workload improves.

A workgroup-frustum-hoisting experiment was measured and **removed** because the software-adapter evidence did not establish a reliable benefit. Its artifacts and source fingerprint are isolated under `artifacts/history-v2.4-experiment-frustum/`; they are not release-benchmark evidence. Final benchmark fingerprints identify the shipped engine and shaders.

## 8. Actual performance evidence and limitations

Read `../artifacts/history-v2.4/release-comparison.md` and the four raw profiles. Both releases use the same nonempty compute-pass interval, 640×480 output, two fresh-process rounds per version, six warmups and twenty measured frames per workload per round (40 samples per side). Order: candidate, baseline, baseline, candidate. Fixed quality and no adaptive resolution. All ten final trace-end coverage hashes match across releases and rounds.

This is native Dawn on **Vulkan/SwiftShader, a software adapter**. Neither CPU timing nor software-adapter GPU timestamps predict hardware GPU throughput. Exact text is used except for the named 100,000-label density workload. Paper cases reference 32,768 Model lines through two rectangular viewports; integer/fractional/zoom traces are reported separately. Full iteration results include diagnostics and mapping, so shifting work outside the compute timestamp cannot masquerade as eliminating it.

The released measurements include regressions: the exact-text full-cull and cached-pan cases have higher compute medians, and paper zoom has higher CPU encoding cost. No universal improvement claim is made. These finite results do not identify a proven root cause for the unchanged exact-text raster path's timing difference. Raw distributions and both rounds are retained for hardware investigation rather than discarded.

## 9. Regression coverage

`tests/performance24.test.mjs` covers uniform-signature dependencies, exact-phase invalidation, queue-byte accounting, timing/counter provenance, duplicate sampling and governor ownership. `tests/gpu-performance24-regressions.js` is shared by the real native and browser harnesses. It checks actual pixels, cached/uncached equivalence, integer/fractional/zoom paths, clipping, edits, layers, zero-budget fallback/eviction, timestamp words, stale maps and the 1,025-label diagnostic tail.

`docs/VALIDATION.md` distinguishes actual native compilation/execution, browser DOM checks, controller tests with declared boundary doubles, and blocked browser rendering. No hardware qualification, universal DXF conformance or browser presentation result is implied.
