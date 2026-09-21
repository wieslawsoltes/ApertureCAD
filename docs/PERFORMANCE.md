# Performance interpretation — 2.4.0

The current separate-release comparison is `../artifacts/history-v2.4/release-comparison.md`. It measures untouched 2.3.0 and shipped 2.4.0 source under the same fixed resolution/quality and nonempty compute-pass interval. Read the **full-iteration table and regressions**, not only the integer-pixel paper-cache best case. Raw distributions, adapter data, source fingerprints and final coverage hashes are included. SwiftShader is software, not hardware GPU performance.

The 2.3 timing fix remains unchanged: `gpuMs` is a validated timestamp delta around the real compute pass, excluding native clears, uploads, CPU encoding, wait, diagnostics, mapping and presentation. Do not compare it to legacy v2.2 clearing-inclusive intervals. Invalid samples are null plus a status, not zero or CPU duration.

2.4 adds bounded per-viewport private queues and exact coverage reuse. Integer-phase pans may skip viewport rasterization; fractional pans rerasterize but can retain queues; zoom and changed clipping rebuild as needed. Zero cache budget retains fidelity. Text diagnostics now process up to 512 visible slots per workgroup. `captureTiming` copies only sixteen timestamp bytes; detailed counters remain explicit. `OPTIMIZATION-v2.4.md` is the current contract and supersedes historical repeated-paper-raster statements.

No new Model uniform payload reduction or universal exact-text improvement is claimed. Inactive tabs remain CPU-resident; active-file layout switching does not re-upload entities. Optional cache state is part of the total budget, not an unlimited extra allocation.

# Performance contracts

**Retained v2.2 optimization background:** read `GPU-AUDIT-v2.2.md` and `BENCHMARK-v2.2.md` first. Those supersede earlier frame-uniform, reset, telemetry and edit-transfer descriptions below. The following remains useful background for unchanged geometry/quality and compositing algorithms.

# Frame work, memory and measurement

## 1. Small-entity lane batching

The default cull workgroup uses two four-word masks for its 128 candidates; a retained scan reference computes two prefix sums. For each live entity, the classifier chooses either the small lane-serial queue or the cooperative queue. Small records grow from the front of the page's `visible[n]`; cooperative records grow from its back. Every live entity is appended once, so the queues cannot collide: `smallCount + largeCount <= pageEntityCount`. There is no per-frame generated primitive arena or overflow-prone glyph expansion.

The indirect kernel writes raster dispatch records at byte offsets 0 and 16, plus optional diagnostic arguments at byte 32. Cached visibility also reuses those arguments. Cooperative rasterization uses one 64-lane workgroup per entity. Batched rasterization uses one lane per small entity and calls the same raster functions with stride 1 rather than 64.

```
W_reference = N_small + N_large
W_batched   = ceil(N_small / 64) + N_large
```

Across multiple pages, apply the ceiling per page. For one million eligible small entities in the mathematical single-queue example, the cooperative workgroup count is 1,000,000 and the batched count is 15,625. **This is an algorithmic dispatch-count reduction, not a 64× timing claim.** A page boundary can add a partially filled group. Classification is conservative and view-dependent: short lines/points and small or density-proxy text qualify. Divergent, wide or long work stays cooperative. A poorly matched classifier can reduce occupancy or worsen lane divergence; use the measured A/B result on the target drawing.

## 2. Guarded visibility reuse

For a view with half-width `hx = width / (2 * zoom * pixelRatio)`, the cull rectangle grows by `(1 + 2*g)` where `g` is the per-side guard fraction. The default is `g=0.25`. A queue is reused only while the current unexpanded view rectangle remains inside the cached expanded rectangle. GPU culling itself includes stroke/point padding.

Zoom, DPR, stroke weight, text classification mode, font revision, layer visibility and model changes invalidate classification or coverage as required. The CPU examines camera metadata and revisions only; it does not inspect per-entity bounds or reconstruct a visible list. Larger guard bands trade less repeated culling for more candidate raster work. They are not universally faster.

## 3. Persistent coverage domains

Base drawing and overlays have separate 32-bit coverage/ID surfaces. The opaque coverage key is `(entityId << 8) | coverage8`; atomicMax provides deterministic ID priority and max coverage within an entity.

A base rerasterization occurs when its camera, model, geometric quality, text mode or font changes. Overlay changes do not invalidate the base surface. Selection, hover, grid and palette changes are resolved from cached ID/coverage where possible. Layer visibility invalidates queues and coverage because it changes which entity contributes. The exact compositing mode intentionally rerasterizes both domains: its shared fragment arena cannot be represented by the opaque max key.

A normal stationary selection frame can therefore execute a resolve pass without clear, cull or entity raster work. This is useful for interaction latency; it does not establish full-scene rendering throughput. Annotation uploads are independent from base geometry and can replace transient preview pages without rebuilding committed annotation pages.

## 4. Queue pressure and frame submission

`requestFrame()` coalesces invalidations. Default `maxFramesInFlight=1` avoids deep queues of stale camera frames. A pending view change is redrawn after the current submission completes. A limit of 2 is available through the constructor for adapters/workloads that benefit. This targets queue latency rather than promising a universal throughput improvement. Browser scheduling, compositor presentation, driver buffering and display scanout remain outside the measured CPU encoding interval.

## 5. Curves and text quality

Ellipses use a viewport-boundary intersection path for large projected curves. The kernel solves `A cos(t)+B sin(t)=C` for viewport edges, sorts the resulting interval boundaries, rejects invisible intervals and samples retained intervals to the configured chord heuristic. This avoids blindly walking a huge offscreen arc at deep zoom. An interval cap still exists and is counted.

General positive-weight NURBS use de Boor evaluation for degrees 1–31. Their sample count remains heuristic and capped; no universal Hausdorff/error proof is asserted. Rational hatch boundary classification similarly has a numerical sampling policy. Precision-critical consumers must inspect caps and compare target drawings against an independent reference.

Text has three distinct policies. Exact text evaluates glyph coverage without substituting density strokes. Adaptive text replaces labels below the projected-size threshold with density strokes. Adaptive resolution changes backing pixel density; it is disabled by default and requires actual timestamp-query samples. These changes must not be mixed in a same-fidelity performance claim.

The ordinary glyph path bilinearly samples a GPU-baked signed-distance atlas. Very large glyphs use direct edge distance and winding. Quadratic edges no longer use a capped polyline approximation: stationary distances come from a cubic equation with endpoint checks and guarded numerical refinement. The atlas remains finite-resolution and direct arithmetic remains f32.

## 6. Ordered alpha is bounded and more expensive

Each coverage contribution appends `[next, packedIdAndCoverage]` to a GPU fragment arena. The resolve kernel finds distinct entity IDs in descending draw order, takes maximum coverage per entity and applies front-to-back source-over. Duplicate segments in one entity therefore do not repeatedly darken the same pixel.

```
alpha_i = coverage_i * entityAlpha_i
C = sum_i (product_{j<i}(1-alpha_j)) * alpha_i * color_i
    + product_i(1-alpha_i) * background
```

Colors are composed in the current encoded RGB space; this mode does not claim a linear-light color-management pipeline. List traversal and repeated distinct-ID selection are O(k²) in dense overlap. It is a correctness-oriented bounded mode, not the preferred million-overlapping-entities fast path.

Overflow sets a GPU flag, draws an unmistakable magenta/black strip, emits a `CadGpuError` on metric capture and invalidates benchmark results. It is never silently described as exact. `fragmentCapacity` is fixed at construction; reduce overlap, recreate with a larger permitted arena, or use opaque mode. Default capacity is 4,194,304 contributions, maximum 16,777,216.

## 7. Persistent memory and transfer accounting

Approximate per base entity before auxiliary data:

| Allocation | Bytes/entity |
|---|---:|
| Fixed source/working entity | 128 |
| Bounds | 16 |
| GPU spatial order | 4 |
| Exact-capacity visible index | 4 |
| Global style | 8 |
| Core records total, excluding clusters | 160 |

Add approximately 16 bytes per 128-entity cluster, page headers/counters/indirect arguments, layer records, a 65,536-ID overlay style reservation, paths, glyph metadata/edges/layout programs and atlas storage. Text run storage is a 16-byte header plus 20 bytes per original codepoint (four layout words and one immutable original glyph ID); interned runs share this storage within a page. One-million unique numeric labels in the synthetic mode do not require one-million host-side strings.

Two cluster summaries add approximately 0.25 bytes per entity. Base and overlay coverage cost `8*width*height` bytes. Exact compositing adds `16 + 4*width*height + 8*fragmentCapacity` bytes. A 1920×1080 surface with the default exact arena adds about 39.9 MiB for that arena alone, in addition to 15.8 MiB for the two coverage surfaces. Atlas storage is `width*height*4`. These figures omit driver allocation granularity and browser presentation resources.

The default budget is 768 MiB and the default pixel ceiling is 8,294,400. Budget guards check model/binding limits, font replacement peaks, annotation replacement peaks and surface replacement peaks. They are estimates, not device-memory telemetry or an OOM impossibility proof. Some driver allocations are asynchronous. A failed model replacement can clear the prior GPU scene; the host retains the source and must reload/reconstruct rather than assume rollback.

The frame block remains 128 bytes, but only the changed span is uploaded: unchanged 0 B, selection-only 4 B, pan-only at most 16 B. Layer palette edits upload 16 bytes. Geometry patches upload 128 bytes per affected entity; color/layer-only patches use 8–16 bytes total and skip geometry preparation. These are payload figures, not driver transaction counts. A geometry patch triggers re-preparation and reindexing for affected pages, not only the edited entity. Extents readback is 16 bytes per affected page. Routine telemetry reads `32 + 32*pageCount` bytes per explicit/sample request. Picking and measurement use 16-byte result buffers. Font compilation reads glyph metadata once; PNG export deliberately reads pixels. No per-frame geometry readback is introduced.

## 8. Benchmark protocol

The Compute Lab A/B runs 8 warmup frames and 60 measured frames per profile along the same sinusoidal camera pan, at the same text mode, stroke weight, curve tolerance, pixel size and compositing mode. The default UI choice enables exact text and disables the resolution governor for the run. The reference profile is the same current renderer with batching and cache disabled; the optimized profile enables both. This is not a v1-v2 comparison, and order/thermal effects still require independent repeated runs.

Each sample reports CPU encode, optional GPU timestamp duration, queue-completion wall time, cull/cache counters, visible candidates, workgroup counts and curve caps. Summaries include min, median, p95, p99, max and mean. Missing GPU timestamps stay null; CPU encoding is never substituted. The run drains the queue per sample, so completion time is an isolated host-to-queue metric, not presentation FPS. Raw telemetry maps/readbacks happen outside that measured completion interval but can affect pacing and thermal behavior between samples.

Run representative target files at fixed resolution and exact text first; then test the separately labeled adaptive options. Repeat with reversed profile order through the API, and compare distributions rather than one lucky frame. Check output/coverage equivalence and all diagnostics before accepting a speedup. Include adapter, driver/browser version, resolution, drawing hash, mode and settings with every published number. **Native software-adapter timing results are provided in BENCHMARK-v2.2.md; hardware-GPU and browser-presentation qualification remain outstanding.**

## Recorded 2.1 measurements

See `CHANGELOG-v2.1.md` for the local CPU packing comparison and native software-adapter A/B. Full raw samples/settings are in `artifacts/history-v2.1/packing-benchmark.json` and the v2.1 source package; current native results are `artifacts/native-gpu.json`. The shader split removes large-entity code from the batched call graph; no measured hardware-register occupancy or universal hardware speedup is asserted. The million-text probe enables density proxies and is a correctness/queue-scale check, not an exact-glyph throughput claim.
