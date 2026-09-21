# Changelog — 2.4.0

- Add bounded, private GPU visibility/statistics/indirect storage per paper viewport and Model page without duplicating geometry.
- Add bitwise-exact local coverage caching and compute-only viewport copy composition; rerasterize phase/zoom/clipping/geometry changes.
- Add `sumViewportCached`, preserving visible counts without falsely counting skipped raster workgroups.
- Add `paperCacheBudget` (64 MiB default), `paperCache` control, budget-aware optional eviction, transactional view preparation and per-view uniform reuse.
- Track layer revision for view palettes instead of rescanning all layer properties per pan.
- Tile GPU text diagnostics over 512 entries per 64-lane workgroup; preserve exact counts and zero dispatches on text-free pages.
- Add coalesced 16-byte `captureTiming()` with scene-epoch and monotonic-frame validation; separate counter and timing provenance.
- Route optional automatic UI sampling through timing only; retain detailed counters on demand.
- Prevent duplicate/out-of-order resolution-governor sampling across both readback APIs.
- Add 19 core tests and ten shared native/browser GPU regressions. Extend release profiles with separate paper integer/fractional/zoom traces and source fingerprints.
- Preserve all 2.3 DXF, model/paper, saved-view, multi-file, annotation and validated timestamp functionality and its limitations.
- Remove the experimental culling-frustum hoist after inconclusive profiling; retain rejected experiment evidence separately.

See `OPTIMIZATION-v2.4.md` for algorithms and `../artifacts/history-v2.4/release-comparison.md` for measurements, including regressions. No claim of a universal or hardware-GPU speedup is made.
