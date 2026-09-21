# 2.2.0 — GPU hot paths and transfer-boundary optimization

See `GPU-AUDIT-v2.2.md` for the per-module review and algorithm/data contracts; `BENCHMARK-v2.2.md` for actual results; and `VALIDATION.md` for reproduction.

Implemented: GPU-prepared TEXT matrices in existing record storage; cached hatch periods/control hulls; finite leaf-root reduction; portable bit-mask visibility compaction with retained scan reference; persistent indirect arguments; native buffer fills inside the measured GPU interval; distinct opaque/exact resolvers; absent-overlay fast path; frame-constant grid spacing; sparse uniform uploads; bounded pooled query/statistics readback; style-only eight-byte edits; adjacent geometry-write coalescing; only changed page-root readback; page-local visibility invalidation; optional sampled text telemetry with a GPU text-presence gate and cached samples; explicit diagnostic and full-iteration benchmark timing.

New code: `packages/gpu/transfer.js`, `tests/performance22.test.mjs`, `tests/gpu-performance22-regressions.js`, `tools/profile-release.mjs`, `tools/compare-profiles.mjs`. The build remains dependency-free. Default automatic telemetry is now off; enabling the optional governor enables sampling.

Compatibility: the public entity record remains 128 bytes, but the GPU-prepared TEXT `r` field is now reserved for its text basis. Internal bounds layout, page statistics and indirect-buffer size changed. Consume the matching v2.2 host/shader modules together; rebuild generated bundles after changing kernels. Do not combine a v2.1 host with v2.2 WGSL or vice versa. Source model parameters remain preserved for editing.

No new rendering fallback, CAD quality reduction, unlimited feature-parity claim, hardware performance claim, or live publication is part of this release.
