# 2.4.0 versus 2.3.0 — actual release comparison

**Native Vulkan/SwiftShader only. These are software-adapter measurements, not hardware GPU FPS.** Output is fixed at 640×480. 2 separate-process rounds per release provide 40 measured samples per workload after 6 warmup frames per round. The order is candidate, baseline, baseline, candidate. Both releases use the same scene construction and camera trace. Adaptive resolution is disabled.

## Rendering interval

GPU timestamp scope: **compute-pass**. This interval excludes native clears, uploads, diagnostics, queue waits and presentation. CPU values are encoding/submission medians.

| Workload | Entities | 2.3.0 GPU ms | 2.4.0 GPU ms | GPU time reduction | CPU encode ms, 2.3.0 → 2.4.0 |
|---|---:|---:|---:|---:|---:|
| lines-full-cull | 32,768 | 64.42 | 58.79 | 8.7% | 0.214 → 0.222 |
| lines-cached-pan | 32,768 | 48.76 | 45.88 | 5.9% | 0.179 → 0.186 |
| exact-text-full-cull | 2,048 | 104.92 | 111.97 | -6.7% | 0.244 → 0.241 |
| exact-text-cached-pan | 2,048 | 97.09 | 115.64 | -19.1% | 0.236 → 0.218 |
| density-text-100k | 100,000 | 139.10 | 146.67 | -5.4% | 0.367 → 0.348 |
| feature-gallery | 32 | 75.30 | 70.62 | 6.2% | 0.220 → 0.206 |
| selection-resolve | 32,768 | 9.01 | 9.08 | -0.7% | 0.150 → 0.114 |
| paper-integer-pan | 32,768 | 104.10 | 9.01 | 91.3% | 0.426 → 0.180 |
| paper-fractional-pan | 32,768 | 97.85 | 80.02 | 18.2% | 0.385 → 0.370 |
| paper-zoom | 32,768 | 102.73 | 101.42 | 1.3% | 0.350 → 0.513 |

All 10 workloads have identical final-frame raw coverage hashes across both releases and rounds. Exact text is used except for the explicitly named **density-text-100k** workload. Selection-resolve is a stationary cached-coverage interaction, not full geometry-render throughput.

## Include diagnostic cost instead of hiding it

The profiler explicitly requests counters each frame. The shipped app does not: automatic sampling defaults to off, and in v2.4 optional automatic timing copies only two timestamp words; detailed counters remain on-demand. Sampling large text queues can be costly; moving it outside the rendering timestamp is not the same as eliminating that work. The following full iteration includes rendering, diagnostics and mapping.

| Workload | 2.3.0 frame + diagnostics ms | 2.4.0 frame + diagnostics ms | Full iteration reduction | Diagnostic wall ms, 2.3.0 → 2.4.0 |
|---|---:|---:|---:|---:|
| lines-full-cull | 67.39 | 61.21 | 9.2% | 0.95 → 0.52 |
| lines-cached-pan | 53.64 | 49.36 | 8.0% | 0.40 → 0.40 |
| exact-text-full-cull | 112.73 | 121.60 | -7.9% | 5.95 → 5.66 |
| exact-text-cached-pan | 106.24 | 122.88 | -15.7% | 7.03 → 5.93 |
| density-text-100k | 201.43 | 172.59 | 14.3% | 56.81 → 21.84 |
| feature-gallery | 78.69 | 74.73 | 5.0% | 0.84 → 0.72 |
| selection-resolve | 9.55 | 9.55 | 0.0% | 0.21 → 0.17 |
| paper-integer-pan | 110.86 | 9.99 | 91.0% | 4.45 → 0.15 |
| paper-fractional-pan | 104.27 | 86.23 | 17.3% | 4.63 → 0.61 |
| paper-zoom | 108.56 | 107.84 | 0.7% | 2.92 → 4.58 |

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
# Repeat in reversed order with round2 output names, then compare both pairs.
node tools/compare-profiles.mjs --baseline artifacts/profile-v2.3.0-round1.json,artifacts/profile-v2.3.0-round2.json --candidate artifacts/profile-v2.4.0-round1.json,artifacts/profile-v2.4.0-round2.json
```

The default execution backend is Vulkan; `CAD_BACKEND` and `DAWN_MODULE` can be set as described in VALIDATION.md. Never use the null backend for timing. Raw samples, adapter metadata and hashes are in `artifacts/profile-v2.*-round*.json` and `artifacts/release-comparison.json`. This benchmark is separate from the UI's same-release on/off profiles.
