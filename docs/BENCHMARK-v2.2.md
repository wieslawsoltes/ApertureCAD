# 2.2.0 versus 2.1.0 — actual release comparison

**Native Vulkan/SwiftShader only. These are software-adapter measurements, not hardware GPU FPS.** Output is fixed at 640×480. 2 separate-process rounds per release provide 32 measured samples per workload after 5 warmup frames per round. The order is candidate, baseline, baseline, candidate. Both releases use the same scene construction and camera trace. Adaptive resolution is disabled.

## Rendering interval

GPU time includes coverage clearing, culling where required, rasterization and resolve. CPU values are encoding/submission medians.

| Workload | Entities | 2.1.0 GPU ms | 2.2.0 GPU ms | GPU time reduction | CPU encode ms, 2.1.0 → 2.2.0 |
|---|---:|---:|---:|---:|---:|
| lines-full-cull | 32,768 | 71.86 | 47.74 | 33.6% | 0.281 → 0.176 |
| lines-cached-pan | 32,768 | 47.12 | 38.70 | 17.9% | 0.220 → 0.147 |
| exact-text-full-cull | 2,048 | 93.85 | 84.08 | 10.4% | 0.244 → 0.179 |
| exact-text-cached-pan | 2,048 | 93.68 | 85.43 | 8.8% | 0.227 → 0.166 |
| density-text-100k | 100,000 | 177.14 | 112.69 | 36.4% | 0.316 → 0.283 |
| feature-gallery | 32 | 70.71 | 60.62 | 14.3% | 0.230 → 0.148 |
| selection-resolve | 32,768 | 13.53 | 7.90 | 41.6% | 0.152 → 0.073 |

All 7 workloads have identical final-frame raw coverage hashes across both releases and rounds. Exact text is used except for the explicitly named **density-text-100k** workload. Selection-resolve is a stationary cached-coverage interaction, not full geometry-render throughput.

## Include diagnostic cost instead of hiding it

The profiler explicitly requests counters each frame. The shipped app does not: automatic sampling defaults to off. Sampling large text queues can be costly; moving it outside the rendering timestamp is not the same as eliminating that work. The following full iteration includes rendering, diagnostics and mapping.

| Workload | 2.1.0 frame + diagnostics ms | 2.2.0 frame + diagnostics ms | Full iteration reduction | Diagnostic wall ms, 2.1.0 → 2.2.0 |
|---|---:|---:|---:|---:|
| lines-full-cull | 74.21 | 50.83 | 31.5% | 0.53 → 0.41 |
| lines-cached-pan | 50.42 | 41.68 | 17.3% | 0.30 → 0.35 |
| exact-text-full-cull | 100.43 | 91.10 | 9.3% | 3.82 → 6.11 |
| exact-text-cached-pan | 99.46 | 88.46 | 11.1% | 3.77 → 5.10 |
| density-text-100k | 180.22 | 161.17 | 10.6% | 0.58 → 44.88 |
| feature-gallery | 74.17 | 62.76 | 15.4% | 2.21 → 0.68 |
| selection-resolve | 14.19 | 8.28 | 41.7% | 0.24 → 0.15 |

The GPU table is not mislabeled as an end-to-end interaction measurement. Median sums need not equal the median of per-iteration sums. Native queue waits isolate each sample; neither series measures browser compositor/display latency.

## Transfers

For **lines-cached-pan**, 32 measured frames uploaded 4,096 bytes in 2.1.0 and 480 bytes in 2.2.0: **88.28% fewer API payload bytes**. For **selection-resolve**, 32 measured frames uploaded 4,096 bytes in 2.1.0 and 120 bytes in 2.2.0: **97.07% fewer API payload bytes**. The first measured frame can equal the final warmup state and thus need no updated bytes. These counts are not physical bus traffic.

## Reproduce

```sh
# Optional native test dependency only; the application itself remains dependency-free.
npm install --no-save webgpu@0.6.1
# Select a valid execution backend/driver for your machine.
node tools/profile-release.mjs --root ../aperture-cad-v2.1.0 --frames 16 --warmup 5 --output artifacts/profile-v2.1-round1.json
node tools/profile-release.mjs --root . --frames 16 --warmup 5 --output artifacts/profile-v2.2-round1.json
# Repeat in reversed order for a second pair, then use --baseline and --candidate comma-separated paths.
node tools/compare-profiles.mjs
```

The default execution backend is Vulkan; `CAD_BACKEND` and `DAWN_MODULE` can be set as described in VALIDATION.md. Never use the null backend for timing. Raw samples, adapter metadata and hashes are in `artifacts/profile-v2.*-round*.json` and `artifacts/release-comparison.json`. This benchmark is separate from the UI's same-release on/off profiles.
