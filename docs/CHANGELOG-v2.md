# 2.0 implementation delta

Historical release notes. The original compiler failure and validation gap are repaired and superseded by `CHANGELOG-v2.1.md`; the statements below describe v2 at its release.

## Frame architecture

Added the `performance` module, two-queue prefix compaction, indirect small-entity lane batching, guard-band visibility reuse, two persistent coverage surfaces, one-frame-in-flight default, executed-workgroup counters and a timestamp-based optional resolution governor. New moving-camera A/B profiles keep quality fixed and export raw distributions. Coverage cache invalidation is distinct from visibility classification invalidation.

## Rendering and quality

Added bounded per-pixel fragment lists and ordered source-over, deterministic union of same-entity coverage, overflow errors/visible indicators, deep-zoom conic interval clipping, degree-31 rational spline evaluation, analytic quadratic glyph distance/winding, bilinear atlas sampling and explicit sampling-cap telemetry.

## CAD/font capabilities

Added pattern families and edge-list hatch data, GPU parameterized dimension kinds 0–6, original source preservation, model/paper/all import filters, fixed-record entity patching, SHP/SHX program decoding and GPU stroke geometry compilation, GSUB single/ligature support and GPOS direct/class horizontal advances. TrueType parsing validates table and glyph-local bounds and expands supported substitution closure before dense glyph packing.

## Workbench and robustness

Added a parameterized feature gallery, runtime batching/cache/guard/alpha/resolution controls, exact-quality benchmark choice, updated font diagnostics and unchanged original-file export. Corrected mobile lab layout, font host-state commit ordering, empty failed-record pages, allocation preflight accounting and replacement cleanup. Font, surface and overlay replacements account for overlapping resources rather than destroying working resources before an obvious preflight failure. The resident scene itself is not a fully transactional document engine.

## Validation and scope

Expanded 53 core tests to 135 Node tests, added independent native HarfBuzz and quadratic numerical references, and expanded the real-GPU test harness. Actual GPU execution remains blocked in the build environment. All prior format/modeling limits are not closed; see `CONFORMANCE.md`. No production qualification, universal speedup or live deployment is asserted.
