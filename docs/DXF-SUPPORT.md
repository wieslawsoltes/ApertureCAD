# Authoring update — 2.5.0

Static BLOCK/INSERT/MINSERT definitions/references now have an editable semantic graph in addition to the existing occurrence-expanded renderer. Attached attributes, nested dependencies, handle ownership, Model/active/inactive paper layout serialization, and authored DXF export are implemented under `BLOCKS.md`. Libraries support DXF and portable JSON, not DWG. The graph/editor has its own source/record/history budgets and is not a constant-memory parser. Definition editing does not add GPU template instancing, dynamic actions, external-reference resolution or exhaustive DXF object round-tripping.

Source layer locks are enforced by the shipped block-authoring commands. Original export is still exact original data; **Save edited DXF** is a separate supported-record writer. Unknown object preservation is best effort, not a lossless edited object-graph guarantee. The renderer's retained entity/font profile below still applies, including rich text, 3D and proxy limitations.

---

# DXF support contract — v2

The importer is a 2D GPU-model adapter, not a complete AutoCAD document engine. Inspect `model.diagnostics` after every import. Empty diagnostics are not exhaustive conformance evidence. The parser preserves compact parameters and handle/layer mappings; CPU structural normalization is allowed, while geometric evaluation and rendering use GPU kernels.

| Input | Implemented behavior | Boundary |
|---|---|---|
| ASCII/binary DXF | Typed group and record decoding, modern/legacy group code forms | Entire file is resident in worker memory; not a constant-memory streaming file parser |
| Encoding | UTF-8 for modern files, selected legacy codepage detection, Unicode escapes | Verify unsupported codepages/substitution notices |
| LINE / POINT | XY endpoints and markers | Not a 3D hidden-surface system; full point-style parity not claimed |
| CIRCLE / ARC / ELLIPSE | Parameterized GPU curve evaluation and clipped sampling | Finite caps and f32 arithmetic |
| POLYLINE / LWPOLYLINE | Open/closed vertex paths, bulges | Wide ribbons and complete mesh/polyface semantics not implemented |
| SPLINE | Rational de Boor, degree 1–31, positive weights and validated knots | Sampling heuristic/cap rather than universal geometric tolerance proof |
| TEXT / ATTRIB / ATTDEF | Text, height, rotation and selected alignment | One selected font replaces original font styles; full formatting parity not guaranteed |
| MTEXT | Plain runs, paragraph breaks, wrapping, selected escapes; bounded horizontal font profile | Rich formatting flattened; general bidi/complex scripts not implemented |
| INSERT / MINSERT | Structural occurrence expansion; transform chains evaluated on GPU | Occurrences duplicate primitive records; no shared INSERT occurrence geometry; paper VIEWPORT instances do share the Model buffers; recursion guarded |
| DIMENSION | Seven parametric kinds by default; `regenerateDimensions:false` uses cached block graphics | Full DIMSTYLE, constraints, tolerances, custom arrows and units not implemented |
| SOLID / TRACE / 3DFACE | Triangle decomposition and compute fill | Top projection, not solid/mesh modeling |
| HATCH | Solid/pattern families, polyline/bulge/line/conic/NURBS boundaries, selected island styles | Gradients rejected with diagnostics; numerical edge-case parity not certified |
| XLINE / RAY | Viewport-clipped infinite/half-infinite line | XY only |
| LEADER | Vertex path | Not full semantic multileader regeneration |
| Layers | Global visibility/color and per-viewport frozen layer handles | Full plotting/viewport overrides and editing lock enforcement are host concerns |
| Colors | ACI, truecolor, BYLAYER/BYBLOCK and explicit entity alpha normalization | Ordered source-over is opt-in and capacity bounded; not a full color-management pipeline |
| Linetypes | First positive dash and negative gap pair | Full sequences and embedded shapes/text not implemented |
| OCS | GPU top projection for selected extrusion entities | No 3D interactive camera/depth pipeline |
| Spaces/layouts | App and `{document:true}` import all Model/paper partitions, empty layouts, named views and rectangular top-plan paper viewports | General perspective/3D/nonrectangular views and printing parity unsupported; legacy parser filtering remains available |
| Draw order | Packed stable entity-ID order | SORTENTSTABLE not honored |
| Unknown/proxy/application objects | Counted diagnostics | No object enablers or arbitrary application-object rendering |
| Original preservation | `preserveSource:true`; `originalDxf(model)` returns original data | Original data only, not an edited lossless rewrite |

## Parameters remain parameters

Hatch patterns are uploaded as families of angle, base, offset and dash lengths. No CPU hatch-line expansion occurs. Boundary conics and splines stay as equations/control data. Dimensions retain definition points and selected formatting parameters; the GPU derives extension lines, arrows, arc geometry and numeric labels. Parametric geometry is therefore not inflated into host-side line/text entity lists.

Dimension numeric formatting is decimal with precision 0–8, optional measurement scaling/rounding, basic radius/diameter/degree symbols and custom text/suppression. Radial, diametric, angular, ordinate, aligned and rotated-linear branches exist. Their presence does not imply full native CAD dimension style behavior. Cached anonymous blocks remain available as an explicit import option for files whose supplied graphics are preferred.

## Source and worker transfers

`DxfWorkerClient.parse` transfers ownership of the supplied ArrayBuffer, detaching it from the caller. The worker receives a compact font map, parses and serializes page buffers, then transfers those buffers back without constructing another per-entity JavaScript graph. BLOCK records are retained as needed for expansion. Optional original preservation increases CPU memory use. The app separately retains the original File for local workspace save/reload and unchanged original export.

Text escapes include `\U+XXXX`, `%%d`, `%%p`, `%%c` and selected MTEXT controls. Flattened styling cannot recreate every original visual effect. Loading a TTF or stroke font does not resolve separate fonts for every DXF STYLE automatically. The font reader reports unsupported layout behavior independently of the file importer.

Review DXF export contains only accepted annotation types: line/path/circle/ellipse/text/point/triangle/cloud forms. It is a separate overlay, not a complete updated source document. JSON preserves review groups and history-independent annotation state. New HATCH and DIMENSION kernel support does not automatically extend the annotation JSON/DXF schema to those new entity forms.

## Document import in 2.3

See `TIMING-VIEWS-TABS.md` for owner/layout resolution, per-space rebasing, named-view support, view projection formulas, file ownership, independent transform fixtures and unsupported-view diagnostics. Rectangular sheet composition currently uses opaque coverage only; this is not general AutoCAD plotting parity.
