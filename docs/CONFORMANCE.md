# Current conformance update — 2.5.0

The new static block profile is detailed in `BLOCKS.md`: real reusable definitions and nested INSERT/MINSERT references; editable attributes; libraries; create/rename/redefine/purge; graphical isolated editing; insertion/copy/replace/arrays; compute previews, snaps, selection and supported recursive 2D explode; independent edited-DXF export. This expands source authoring beyond the previous fixed-record GPU patch API. Historical statements below describe their releases; the current profile and current VALIDATION.md take precedence.

**Not full AutoCAD block/insert parity:** no DWG codec, dynamic actions/constraints/lookup or visibility states, XREF resolution/binding, full annotative/field/3D-UCS behavior, native one-level EXPLODE semantics, all WBLOCK modes, path/associative arrays, every snap mode, or complete edited DXF object round-trip. Geometry is still occurrence-expanded in GPU storage. Definitions are shared semantically, not a new template-instanced GPU scene. Block Studio is a static 2D member editor, not a full solid/constraint system.

Current evidence is265 core tests, 6 modules/34 actual pipelines, 4 negative probes, 62 native software-adapter execution/scale checks, 9 independently audited R2007 fixtures and declared DOM/controller suites. Hardware/browser presentation and independent large CAD corpus qualification remain outstanding. Old numerical benchmark results are not relabeled as2.5 performance. Unknown dynamic/external content is protected; silent format corruption is not an acceptable substitute for support.

---

# Conformance update — 2.4.0

This release changes performance/lifecycle behavior, not the supported DXF, font or 3D feature envelope. Paper caching is exact and phase-sensitive; it is not arbitrary image reprojection or nonrectangular/perspective support. Optional memory-budget fallback changes work, not image quality. New native and CPU regression counts are in `VALIDATION.md`. Detailed diagnostics and timing now have separate frame identities.

Actual software-adapter profiles include both gains and regressions. Hardware GPU performance and browser presentation are not certified. Multi-file, empty-layout, named-view, annotation and validated-timer behavior from 2.3 remains.

# Conformance update — 2.3.0

All registered Model/paper spaces are discoverable, including empty layouts. Supported top-plan named views and rectangular paper viewports render with scale, target, center, twist and frozen layers. This is **not universal CAD view parity**: general perspective, side/3D, nonrectangular clipping, rotated whole-sheet views, complete UCS/plot/viewport overrides and ordered-alpha composed sheets remain outside support. Unsupported views are labeled and diagnosed. Multi-file state is independent per tab and per space; active-file-only GPU residency is intentional.

The reported timer defect is covered by native and unit regressions. GPU time is validated compute-pass duration, not wall-frame time, and unavailable samples remain unavailable. Browser presentation and hardware-GPU performance are not qualified here. Controller tests use explicit test doubles and do not change that boundary.

# v2.2 conformance note

This release optimizes scheduling and the CPU–GPU boundary. It does not broaden the inherited CAD/font conformance scope below. Real compiler/execution results are in `VALIDATION.md`; software-adapter measurements are not a hardware/browser qualification.

# Capability and conformance ledger — 2.2.0

“Implemented” means the code path exists and the recorded tests cover the stated subset. It does not mean GPU execution or exhaustive format conformance was certified. Native Dawn compilation and Vulkan/SwiftShader execution passed the documented finite suite. Browser navigation remains blocked; hardware/browser qualification is outstanding. No row implies that the original request for every remaining limit has been completely fulfilled.

| Previous limitation | Change in v2 | Still outside the contract |
|---|---|---|
| One cooperative group per entity | Two-ended bounded visible queues and lane batching | Universal speedup or optimal classification on every adapter |
| Full scene redraw for interaction | Cached base/overlay coverage and guarded visibility | General Model raster reprojection and unbounded cache history; 2.4 adds bounded exact paper-local coverage reuse only |
| Opaque-only order | Capacity-bounded ordered source-over | Unbounded overlap, linear-light color management, low O(k) resolve cost |
| Pattern/edge-list HATCH | Pattern families; line, bulge, conic and positive-weight spline boundaries | Gradient hatches, all degenerate/topological edge cases, reference-certified parity |
| Cached dimensions only | Seven parametric kinds and GPU decimal labels; optional cached-block fallback | Associative constraints, complete DIMSTYLE/overrides/tolerances/format units/custom arrows |
| SHX unsupported | SHP plus SHX shapes 1.0/1.1 and unifont 1.0 container decoding; GPU stroke VM | BIGFONT/multibyte mapping, all legacy codepages, original font resolution per style |
| No glyph shaping | GSUB single/ligature plus GPOS pair/class x-advance, extension wrappers, legacy horizontal kern | General bidi, complex scripts, contextual/chained layout, mark attachment, cursive, vertical text layout |
| Quadratic glyph sampling cap | Closed-form stationary distance/winding equations with f32 refinement | General f32 exactness proof, cubic CFF outlines, perfectly lossless finite-resolution SDF |
| Small atlas limit | Configurable 32/64/128 cells; default max 4096 requested/closure glyphs | Arbitrary atlas size, dynamic paging/residency, color glyphs, emoji, variable deltas |
| Static glyf TTF only | Stronger bounds checks and selected OpenType layout support | CFF/WOFF, variable-font delta application, point-attached compound modes |
| Spline degree ≤7 | Degrees 1–31, positive rational weights, stronger data validation | Unlimited degree, arbitrary malformed/negative-weight splines, universal approximation proof |
| No source preservation | Optional exact original byte/text retention and unchanged original export | Lossless edited round-trip, DXF object graph/proxy execution |
| No GPU edits | Fixed-record patches and affected-page GPU rebuild | Arbitrary auxiliary topology edits, source-DXF writeback, full editing undo/constraints |
| Model space only | All-space document catalog, empty layouts, named views, shared-geometry rectangular top-plan paper composition | Perspective/3D/nonrectangular views, rotated whole-paper views, plotting, full viewport overrides, ordered-alpha composed sheets |
| 2D top projection | Retained | 3D mesh depth/hidden-surface pipeline, B-rep/NURBS solid kernel, booleans, assemblies |
| Dense overlap contention | Batching and visibility reduce unrelated work | Opaque atomic contention still exists; ordered alpha can be more expensive |
| No hardware results | Five modules / 27 pipelines validated; 37 native software-adapter execution/scale checks and actual texture captures | Representative hardware and browser presentation, exhaustive visual/driver qualification, hardware frame-time improvement |
| No live publication | Standalone and split static deployment builds included | No ChatGPT Sites/live-site publication performed |

## Font profile details

The default requested profile is horizontal `latn`, optional language selection, with `ccmp`, `liga`, `rlig`, `kern` feature tags. `DFLT` is used only as the available script fallback. Selected lookups preserve font lookup order and ligature rule priority. Lookup flags requiring mark filtering are diagnosed and skipped. GPOS placement/device adjustments beyond first-glyph x-advance are diagnosed and skipped. Unsupported selected lookups never imply full shaping.

Glyph IDs are densely remapped after closure over supported substitution outputs. Source glyph IDs remain immutable in text-run auxiliary data; GPU preparation restores them before shaping, so repeated preparation does not cumulatively substitute already-shaped runs. A consumed slot is distinct from a newline. Ligatures preserve source slot storage; telemetry reports logical source slots, not a count of final glyph paint operations. Nonnegative advance clamping maintains the monotonic horizontal-search invariant; pathological negative-advance layout is not full typographic parity.

The native HarfBuzz comparison uses one locally installed static font and nine Latin samples. It validates the CPU-decoded compact layout program with an independent native reference. It does not certify all scripts, all fonts, every supported table form, or GPU application of the program.

## Editing and document ownership

The source drawing and custom annotations remain separate. `patchEntities()` updates the resident source-record copy used by this renderer. It does not rewrite the originally loaded file. Original export returns unchanged source bytes; annotations export as JSON or a separate DXF overlay. Full document round-trip/semantic editing must not be inferred from either operation. Fonts/styles and unsupported records are not silently restored during an edited export.

## Readiness statement

Core and DOM checks are reproducible, and static distribution files are provided. Actual finite WGSL compilation and native execution have been performed. Production qualification still needs broader visual comparisons against independent CAD output, real drawing corpora, long-running stress/memory testing and representative GPU/browser/driver coverage. The package deliberately fails rather than silently switching to a different rendering backend.
