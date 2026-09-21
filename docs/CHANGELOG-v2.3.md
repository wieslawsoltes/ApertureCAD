# Changes in 2.3.0

## Timing correctness
- Timestamp both endpoints around the same actual compute pass; resolve in the same submitted encoder.
- Subtract uint64 BigInts before converting nanoseconds to milliseconds.
- Validate unwritten, reversed, stale and implausible intervals; display `—` with status rather than GPU uptime or CPU fallback.
- Bind mapped results to frame/scene ownership and reset on file/layout changes.
- Name the metric GPU compute; document excluded native clears and other costs. Benchmark schema is now `aperture-benchmark/4`.

## Documents, views and GPU resources
- Add all-space DXF parsing with deferred layout ownership, subclass-scoped names, empty sheets and named VIEW records.
- Rebase each space independently; maintain stable original entity IDs across model viewport instances.
- Implement top-plan rotated camera math and rectangular paper viewport composition using shared model buffers, per-view uniforms/frozen layers and one reusable scratch surface.
- Add `sumViewport` and `copyViewport`; 27 total actual compute pipelines.
- Keep unsupported perspective/3D/nonrectangular views discoverable with explicit diagnostics.
- Add file and layout tab strips, multi-file chooser/drop, source ownership, keyboard navigation and per-file/per-space state.
- Serialize document operations, isolate stale interactions, roll back failed activation, and preserve all tabs in workspace v3 with v2 migration.
- Retain only the active file on GPU; retain inactive packed CPU models without reparsing on tab activation.

## Regression and packaging
- Add 22 core tests (200 total), eight new real native GPU regressions, seven document-controller test-double checks and a multi-layout DXF with independent numeric viewport references.
- Native execution/scale suite passes 37 checks; five real WGSL modules, 27 pipelines and four negative probes pass.
- Keep browser DOM, test-double controller, native software execution and blocked real-browser GPU reports explicitly distinct.
- Archive v2.2 measurement evidence with its original timing scope; no new hardware performance result is asserted.
- Rebuild original/generated WGSL, worker code, modular application and complete standalone previews together.

Full contracts, coordinate formulas, API examples and limitations: `TIMING-VIEWS-TABS.md`.
