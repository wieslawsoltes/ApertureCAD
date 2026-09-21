# Aperture CAD 2.1.0 — compiler repair, audit and optimization

## Reported defect

The v2 assembled `scene` module failed at **297:43** because a condition used `A || B && C` without grouping. WGSL does not import JavaScript/C logical precedence here. The shipped static checks were insufficient and missed this defect. Dawn reproduced the original diagnostic before the fix; the historical log is in `artifacts/history-v2/`.

The text batching predicate now uses explicit early returns, computes `textBasis` once, and bounds the projected size of a density-proxy candidate. Every generated shader and application bundle has been rebuilt. There is no runtime regex patch and no alternate renderer.

## Shader/runtime audit changes

* Isolate line, point and text helper functions. `rasterBatch` no longer calls the general dispatcher, so NURBS work arrays, dimension construction, hatches and conic loops are absent from its reachable call graph. `raster` shares the same helpers for identical coverage arithmetic.
* Replace per-pixel decimal-divisor construction with a constant eight-element unsigned divisor table. Exact numeric text remains glyph-rendered; adaptive proxies are still an explicit separate mode.
* Include world-space line width in GPU bounds. Previously a wide stroke could overlap the viewport while its centerline and bounds were culled. Width also affects batching eligibility.
* Include device-pixel ratio and point-marker radius in conservative visibility padding. Oversized point markers and wide lines remain cooperative.
* Invalidate and request rendering for CSS/ratio changes even when integer backing-buffer dimensions do not change.
* Remove per-entity type-array allocation and the default empty transform-ancestry Set from CPU serialization. Valid packed records remain byte-identical to v2 in the documented benchmark.
* Account for edit-index scratch before uploading any changed record. Clean up partially allocated rebuild buffers. Account for overlapping old/new transparency resources, and allocate replacement buffers before destroying old ones.
* Clean up a partially initialized device on failure; reject concurrent/repeated initialization of the same engine.
* Make worker requests own their completion, cancellation, listeners and cleanup. Failed Worker construction revokes its object URL; failed postMessage and progress callbacks terminate the worker; stale callbacks cannot complete a replacement request.
* Roll back failed annotation transactions without corrupting undo/redo history. Validate history-size limits.

## Compiler and build gates

`packages/gpu/compiler.js` is shared by browser initialization and native validation. It obtains real compilation messages, creates every compute pipeline with bounded concurrency, aggregates errors, and reports original-file locations with an assembled-source excerpt. Module error scopes are pushed/popped before yielding, avoiding accidental scope interleaving.

`tools/shader-sources.mjs` deterministically expands WGSL includes and generates compact source maps plus SHA-256 hashes. `npm run check` verifies those generated artifacts and checks that every distributed application contains the current shader source. A narrow lexical check catches unparenthesized logical mixing, including multiline expressions and nested comments; it is not substituted for a compiler.

`npm run test:wgsl` uses actual Dawn shader-module and compute-pipeline validation, not a parser imitation. Four intentional negative probes must be rejected: mixed logical operators, a nonuniform barrier, a vector type mismatch and a missing bind-group resource. The configured GitHub Actions compiler job is new; no hosted workflow execution is claimed by this archive.

## Actual release results

160 Node tests passed. Five real browser DOM checks passed. All five shader modules and all 22 compute pipelines passed native Dawn validation on the null backend and initialized on Vulkan/SwiftShader. The native execution suite passed 18 checks, plus the four negative compiler/binding probes. It exercised actual shader dispatch and GPU texture readback, including 100,000 and 1,000,000 unique generated text records with exact visible-queue counts. Screenshots in `artifacts/native-*.png` are actual compute-resolved textures.

The million-text checks enable adaptive density proxies. They are not one million exact-glyph render benchmarks. Exact numeric text, batching equivalence, ordered-alpha math, DXF import, picking, measurements, wide-line culling, high-DPR markers, zero-visible queues, incremental edits and overlay caching have separate finite tests.

## Measured performance, narrowly stated

The local CPU serialization comparison used 200,000 line records, two warmups, seven measured samples per version, alternating order, and matching SHA-256 hashes of the packed output. Median elapsed time was **165.21 ms for v2 packing versus 119.07 ms for v2.1 packing** (about 27.9% less time in this environment). This is CPU serialization, not GPU frame time.

The native software-adapter benchmark used 8,192 short lines, a fixed 640×480 output, the same sinusoidal camera trace, 6 warmups and 24 measured frames per profile, with exact-text mode and resolution adaptation disabled. Measured median GPU timestamps were **1,342.90 ms cooperative**, **34.60 ms batched**, and **27.33 ms batched with visibility cache**. These three profiles all use v2.1 shaders; they do not compare complete v2 and v2.1 releases. The eligible-workgroup count changes from 8,192 to 128. SwiftShader has a very different cost structure from hardware adapters, so these timings and ratios must not be projected onto a Mac, discrete GPU, or browser presentation FPS.

All raw samples and settings are preserved in `artifacts/native-gpu.json` and `artifacts/packing-benchmark.json`. Additional native benchmark runs can have different results, especially in a shared software-adapter environment.

## Qualification boundaries

Browser navigation remains blocked by `ERR_BLOCKED_BY_ADMINISTRATOR`; it was not bypassed. Native offscreen execution proves actual compiler/pipeline/dispatch behavior on the recorded software adapter, not browser swapchain presentation, Metal/D3D12 driver coverage, exhaustive CAD conformance or hardware frame-time improvement. The previous 2D/CAD/font feature boundaries remain in `CONFORMANCE.md`. No live-site publication is performed by this archive.

## Standards and toolchain provenance

* W3C WGSL, operator precedence and associativity: https://www.w3.org/TR/WGSL/#operator-precedence-associativity
* Official Dawn native Node bindings: https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/README.md
* Official node-webgpu source: https://github.com/dawn-gpu/node-webgpu

The local Linux Dawn artifact came from the official repository, workflow run 35258554671, artifact 10514373423, commit cb240259b1aa3225667211b6999a0bbcf6d3f85d. The archive is SHA-256 `a959dbba67f8172debcb7a00a3f677c9613f17893e5c42fdeb301f3c70370e58`. The exact binary hash is recorded in native reports. The third-party binary and all system/third-party font files are excluded from this distribution.
