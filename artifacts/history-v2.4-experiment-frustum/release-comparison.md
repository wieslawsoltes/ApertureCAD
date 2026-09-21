# 2.4.0 versus 2.3.0 — actual release comparison

**Native Vulkan/SwiftShader only. These are software-adapter measurements, not hardware GPU FPS.** Output is fixed at 640×480. 2 separate-process rounds per release provide 40 measured samples per workload after 6 warmup frames per round. The order is candidate, baseline, baseline, candidate. Both releases use the same scene construction and camera trace. Adaptive resolution is disabled.

## Rendering interval

GPU timestamp scope: **compute-pass**. This interval excludes native clears, uploads, diagnostics, queue waits and presentation. CPU values are encoding/submission medians.

| Workload | Entities | 2.3.0 GPU ms | 2.4.0 GPU ms | GPU time reduction | CPU encode ms, 2.3.0 → 2.4.0 |
|---|---:|---:|---:|---:|---:|
| lines-full-cull | 32,768 | 56.23 | 55.93 | 0.5% | 0.198 → 0.203 |
| lines-cached-pan | 32,768 | 46.99 | 45.12 | 4.0% | 0.182 → 0.183 |
| exact-text-full-cull | 2,048 | 104.92 | 109.48 | -4.3% | 0.265 → 0.250 |
| exact-text-cached-pan | 2,048 | 93.00 | 98.01 | -5.4% | 0.223 → 0.241 |
| density-text-100k | 100,000 | 125.96 | 146.28 | -16.1% | 0.348 → 0.338 |
| feature-gallery | 32 | 74.29 | 72.88 | 1.9% | 0.197 → 0.204 |
| selection-resolve | 32,768 | 8.36 | 11.80 | -41.2% | 0.099 → 0.149 |
| paper-integer-pan | 32,768 | 91.36 | 9.18 | 90.0% | 0.433 → 0.212 |
| paper-fractional-pan | 32,768 | 102.96 | 78.41 | 23.8% | 0.366 → 0.344 |
| paper-zoom | 32,768 | 100.30 | 106.07 | -5.7% | 0.350 → 0.436 |

All 10 workloads have identical final-frame raw coverage hashes across both releases and rounds. Exact text is used except for the explicitly named **density-text-100k** workload. Selection-resolve is a stationary cached-coverage interaction, not full geometry-render throughput.

## Include diagnostic cost instead of hiding it

The profiler explicitly requests counters each frame. The shipped app does not: automatic sampling defaults to off, and in v2.4 optional automatic timing copies only two timestamp words; detailed counters remain on-demand. Sampling large text queues can be costly; moving it outside the rendering timestamp is not the same as eliminating that work. The following full iteration includes rendering, diagnostics and mapping.

| Workload | 2.3.0 frame + diagnostics ms | 2.4.0 frame + diagnostics ms | Full iteration reduction | Diagnostic wall ms, 2.3.0 → 2.4.0 |
|---|---:|---:|---:|---:|
| lines-full-cull | 62.05 | 60.04 | 3.2% | 0.56 → 0.55 |
| lines-cached-pan | 48.29 | 48.74 | -0.9% | 0.44 → 0.39 |
| exact-text-full-cull | 114.21 | 114.42 | -0.2% | 5.78 → 5.57 |
| exact-text-cached-pan | 103.15 | 107.95 | -4.7% | 5.60 → 4.99 |
| density-text-100k | 177.60 | 170.92 | 3.8% | 48.48 → 21.35 |
| feature-gallery | 81.02 | 79.74 | 1.6% | 0.71 → 0.83 |
| selection-resolve | 8.75 | 12.26 | -40.0% | 0.13 → 0.24 |
| paper-integer-pan | 99.98 | 9.98 | 90.0% | 2.52 → 0.20 |
| paper-fractional-pan | 112.32 | 82.46 | 26.6% | 5.47 → 0.34 |
| paper-zoom | 107.20 | 111.26 | -3.8% | 4.84 → 5.12 |

The GPU table is not mislabeled as an end-to-end interaction measurement. Median sums need not equal the median of per-iteration sums. Native queue waits isolate each sample; neither series measures browser compositor/display latency.

## Transfers

For **lines-cached-pan**, 40 measured frames uploaded 608 bytes in 2.3.0 and 608 bytes in 2.4.0: **0.00% fewer API payload bytes**. For **selection-resolve**, 40 measured frames uploaded 152 bytes in 2.3.0 and 152 bytes in 2.4.0: **0.00% fewer API payload bytes**. The first measured frame can equal the final warmup state and thus need no updated bytes. These counts are not physical bus traffic.

## Reproduce

```sh
# Optional native test dependency only; the application itself remains dependency-free.
npm install --no-save webgpu@0.6.1
# Select a valid execution backend/driver for your machine.
node tools/profile-release.mjs --root ../aperture-cad-v2.3.0 --suite extended --frames 20 --warmup 6 --output artifacts/profile-v2.3.0-round1.json
node tools/profile-release.mjs --root . --suite extended --frames 20 --warmup 6 --output artifacts/profile-v2.4.0-round1.json
# Repeat in reversed order for a second pair, then use --baseline and --candidate comma-separated paths.
node tools/compare-profiles.mjs
```

The default execution backend is Vulkan; `CAD_BACKEND` and `DAWN_MODULE` can be set as described in VALIDATION.md. Never use the null backend for timing. Raw samples, adapter metadata and hashes are in `artifacts/profile-v2.*-round*.json` and `artifacts/release-comparison.json`. This benchmark is separate from the UI's same-release on/off profiles.
