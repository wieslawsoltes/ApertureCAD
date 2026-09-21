# Current-release architecture additions — 2.4

Read `OPTIMIZATION-v2.4.md` for bounded per-viewport queues, bitwise-exact coverage reuse, GPU diagnostic tiling and the 16-byte timing-only path. The additional `sumViewportCached` pipeline brings the total to **28 compute pipelines in five assembled modules**. Model entity and auxiliary resources are never duplicated per paper viewport. The active layout owns optional private queues/surfaces; a shared scratch/queue path remains the same-quality fallback. Memory accounting includes both mandatory and optional resources.

The 2.3 hierarchy in `TIMING-VIEWS-TABS.md` remains: one active file occupies GPU entity storage, all its spaces share resident partitions/stable IDs, and paper view instances use per-view cameras and frozen-layer palettes with independent coordinate origins. General document state is in `packages/app/documents.js`, DXF discovery in `packages/dxf/spaces.js`, exact cache metadata in `packages/gpu/paper-cache.js`, and time decoding in `packages/performance/timing.js`.

Both timestamps bound the same real compute pass, resolved before its encoder is submitted. `captureTiming` reads only those endpoints, while `captureMetrics` explicitly dispatches detailed diagnostics. Compute time excludes native clears/uploads/diagnostics/presentation. Older whole-frame explanations below are historical and superseded by this contract. All host and compute ownership below remains explicit.

# Compute architecture and mathematical contracts — 2.4.0

## Execution ownership

The HTML/CSS workbench is host-rendered UI. The application-controlled CAD canvas uses compute pipelines only: no vertex/fragment render pipeline, render pass, WebGL, SVG entity renderer or Canvas2D fallback. Browser/driver presentation remains a platform operation.

The CPU reads file containers, decodes DXF records/font tables, resolves structural references, expands block occurrences, interns strings, serializes compact records and handles input/application state. These are explicit host responsibilities, not falsely described as GPU parsing. GPU kernels apply geometric transform chains, compile SHX/SHP glyph programs, generate atlases, shape/layout supported text, compute bounds/indexes, cull/compact, evaluate curves/patterns/dimensions, rasterize, resolve, pick and measure.

```
File / CAD adapter
  -> worker: parse + structural normalization + packed parameters
  -> transferable ArrayBuffers
  -> GPU upload
  -> text substitution/positioning and transform/bounds preparation
  -> GPU bounds reduction
  -> Morton bucket histogram/scan/scatter/cluster bounds
  -> one-time 16-byte-per-page bounds result for camera fit

Camera change -> changed aligned uniform span (pan: at most 16 bytes)
  -> guarded queue/argument reuse OR GPU cull + mask/scan compaction
  -> indirect cooperative raster + small-entity lane raster
  -> persistent base / overlay coverage OR bounded fragment arena
  -> compute resolve -> WebGPU canvas presentation

Hover / selection / palette / grid change
  -> changed uniform/style words -> compute resolve of cached opaque coverage
```

## Entity ABI

Each entity is 128 bytes, aligned to 16-byte vector fields. Packed records are input parameters plus GPU-prepared transform fields, not a CPU tessellation cache.

| Byte offset | Field | Meaning |
|---:|---|---|
| 0 | `anchor: vec4<f32>` | Absolute XY high components, then low components |
| 16 | `p: vec4<f32>` | Kind-specific endpoints, axes, text sizing or other parameters |
| 32 | `q: vec4<f32>` | Angle/sweep/alignment and additional kind parameters |
| 48 | `r: vec4<f32>` | Line-style parameters; GPU-prepared text basis for TEXT |
| 64 | `tag: vec4<u32>` | Type, packed RGBA, layer ID, immutable entity ID |
| 80 | `data: vec4<u32>` | Auxiliary word offset, count/numeric data, transform-node offset, flags |
| 96 | `basis: vec4<f32>` | GPU-prepared 2×2 object-to-world matrix |
| 112 | `world: vec4<f32>` | GPU-prepared origin-relative XY high/low components |

Kinds 1–13: line, ellipse/arc/circle, polyline, text, triangle, spline, point, path fill, xline, ray, cloud, hatch, dimension. A default page contains at most 65,536 records. Auxiliary arenas contain paths, knots/weights, text runs, transform chains and parameterized hatch/dimension data. They are typed word-addressed buffers; no shader pointer follows a JavaScript object graph.

Entity IDs are 24-bit because the opaque key reserves eight coverage bits. Base count is limited to 16,711,680 by the API; the parser's default ceiling is 16,000,000. Global style storage reserves 65,536 additional IDs; accepted committed-plus-preview annotations are limited to 65,534 entities. Device memory/binding limits typically constrain practical loads earlier. Exceeding a guard is an error, not silent truncation.

## Coordinate precision

For host coordinate x, upload `h=fround(x)`, `l=fround(x-h)`. The GPU stores the pair rather than immediately discarding the residual. Addition/subtraction uses compensated high/low formulas. Matrix products use high/low terms and fma residuals where expressed. The object origin is reduced relative to the model origin before screen projection, then relative to a split camera origin:

```
delta = (world_hi - camera_hi) + (world_lo - camera_lo)
pixel = viewport_center + (delta.x, -delta.y) * zoom * pixelRatio
```

This reduces cancellation at large CAD origins. It is not native f64 and does not promise exact behavior for every f64 input, singular transform or arbitrarily deep chain. Local geometry, matrix parameters and raster arithmetic remain f32. Bounds receive conservative numerical padding. Nonfinite/invalid input is rejected where validated; reference comparisons remain necessary for precision-critical drawings.

## Transform and spatial preparation

A node stores translation/base high-low terms, scale/rotation or an OCS normal/elevation, and a parent offset. GPU preparation composes the chain (maximum 128 levels). Structural INSERT occurrences are expanded by the CPU parser, but their coordinate transformations are GPU operations. This model does not yet share one geometry record across all instances.

Bounds are conservative per type: endpoint extrema for lines; full conic extrema rather than tight arc extrema; positive-weight spline control hulls; transformed text extents; boundary and dimension parameter extents. Hatches/dimensions remain individual entities. A page-level bounds reduction supports initial fit and index construction.

The index has 256 Morton buckets on a normalized 16×16 cell grid. `spatialAssign` writes each entity's bucket/rank; `spatialScan` produces exclusive offsets; `spatialScatter` writes order; `spatialBounds` reduces consecutive 128-record clusters. Histogram/rank storage is reused per page and then released. It is a bucket hierarchy, not a full BVH, radix-sorted global tree or globally optimal partition. Immutable entity IDs preserve drawing order independently of nondeterministic bucket reservation order.

## Visibility, raster and compositing

The cull workgroup first rejects a cluster, then evaluates candidate visibility/layer state. Portable workgroup masks (or the retained scan reference) reserve disjoint small/cooperative queue ranges. Indirect records are rebuilt only when those queues change. Both raster entries call common entity routines; they differ in work assignment, not an intentional quality substitution.

Lines use clipped pixel traversal and edge distance for coverage. Triangles use signed edge distances. Path/hatch coverage evaluates inside tests at four subpixel offsets. Curve strokes evaluate parameterized points; viewport clipping avoids offscreen traversal for large conics. Text maps pixel centers into glyph/run coordinates and evaluates distance-based coverage. No unbounded CPU-generated vertex/primitive stream is introduced.

Opaque rasterization writes `atomicMax(ID<<8 | coverage8)`. It is deterministic entity-order compositing, not general antialiasing-aware multilayer source-over: lower-ID contributions are not retained. The separate ordered-alpha mode retains all accepted contributions in a bounded fragment list, unions same-entity coverage and applies source-over in descending entity order. See `PERFORMANCE.md` for its O(k²) resolve cost and explicit overflow behavior.

## Font model and GPU layout

A glyph record is 48 bytes: edge range/type/status, bounds and metrics. An edge is 32 bytes: endpoint/control or circular-arc parameters plus kind. The 96-byte font uniform identifies atlas dimensions, glyph count, edge offset, metrics, numeric digit glyphs, optional OpenType program offset and aggregate ink bounds.

TrueType `glyf` contours are decoded into line/quadratic outline parameters, not a CPU-rasterized atlas. Supported substitution closure is included before glyph IDs are densely remapped. SHX/SHP containers are decoded into 8-word instruction records; a GPU bounded interpreter evaluates pen/vector/arc/stack/subshape operations into a pre-reserved edge arena. Subshape capacity is statically bounded; cycles, excessive depth, instruction count and invalid programs are rejected or emit status. One-time glyph metrics/status readback is explicit; glyph geometry is not read back to construct CPU meshes.

A text run has a 4-word header and `n*5` words: n shaped slots `[glyphId,x,y,advance]` and n immutable original glyph IDs. GPU layout restores originals before applying supported substitutions, then computes advances/wrap/positions. Consumed ligature slots and newlines have distinct sentinels. Supported GPOS class tables remain compact class matrices rather than being expanded into all glyph-pair combinations. Text position search assumes monotonic horizontal advances; nonnegative clamping maintains that invariant and marks the scope as a bounded horizontal profile.

The GPU builds a finite signed-distance atlas. Supported cell sizes are 32,64,128. Default selected/closure glyph limit is 4096 and an explicit higher limit can be requested within parser/device budgets. Large projected glyphs use direct edge distance instead of relying entirely on the atlas. Stroke fonts evaluate unsigned edge distances minus stroke radius; filled contours use nonzero winding.

## Quadratic-distance mathematics

For endpoints a,b and quadratic control c:

```
Q(t) = a + u*t + v*t²
u = 2(c-a), v = a-2c+b, w = a-p
```

Interior candidates for the squared distance to p satisfy:

```
2(v·v)t³ + 3(u·v)t² + (u·u + 2w·v)t + w·u = 0.
```

The kernel normalizes this cubic, solves the depressed cubic with Cardano/trigonometric branches, clips candidate parameters, applies two guarded Newton corrections and compares both endpoints. Near-linear quadratics use segment distance. Winding solves the y-coordinate quadratic and applies half-open crossing conventions, instead of tessellating the quadratic into a bounded polyline. All of this uses f32; the numerical reference test quantifies a finite corpus rather than proving every input.

## NURBS, patterns and dimensions

Rational de Boor operates on homogeneous control points `(w*x,w*y,w)` for degree 1–31. For knot interval and recursion level r, the standard interpolation coefficient is `(t-U_i)/(U_{i+p-r+1}-U_i)` with guarded degenerate denominators. After recursive interpolation, divide by the positive homogeneous weight. Geometry evaluation is GPU work; the finite sampling heuristic is documented separately.

Pattern-family lines are expressed by base b, tangent t=(cos a,sin a), normal n=(-sin a,cos a), and repeat offset d. The family index comes from projection onto n using `n·d`; the along-line coordinate selects the dash/gap phase. Inverse-transpose pixel-distance scaling handles transformed patterns. Island classification and pattern coverage are evaluated in the entity's local coordinates without materializing each hatch line on the CPU.

A dimension auxiliary record contains kind/flags/custom-run/precision, seven definition points and selected style scalars. Linear/aligned branches project measured endpoints onto the dimension line; radial/diametric branches derive endpoint distance; angular branches intersect/select rays and derive swept angle; ordinate branches select the measured coordinate. GPU rasterization emits extension geometry/arrows and formatted text under one entity ID. This is parametric regeneration, not associative constraint solving or full DIMSTYLE parity.

## Editing, lifetime and failures

`patchEntities()` validates the complete batch before submitting 128-byte fixed records, then rebuilds affected page preparation/bounds/indexes. It does not mutate auxiliary topology or rewrite original DXF bytes. Annotation replacement builds new pages before committing them; base coverage remains independent. Font replacement holds the old font until new resource work has completed. Surface/font/overlay budget checks include replacement overlap. Full scene replacement is not a crash-safe transactional document engine.

Errors propagate as `CadGpuError` or import/font diagnostics. Device loss is terminal for an engine instance; reconstruct/reload explicitly. No fallback renderer conceals failure. Sparse readbacks are serialized and explicit; normal geometry remains resident.

## Primary specifications consulted

- WebGPU: https://www.w3.org/TR/webgpu/
- WGSL: https://www.w3.org/TR/WGSL/
- OpenType GSUB: https://learn.microsoft.com/en-us/typography/opentype/spec/gsub
- OpenType GPOS: https://learn.microsoft.com/en-us/typography/opentype/spec/gpos
- OpenType glyf: https://learn.microsoft.com/en-us/typography/opentype/spec/glyf
- OpenType gvar (not implemented here): https://learn.microsoft.com/en-us/typography/opentype/spec/gvar
- DXF dimension reference: https://ezdxf.readthedocs.io/en/stable/dxfentities/dimension.html
- DXF hatch reference: https://ezdxf.readthedocs.io/en/stable/dxfentities/hatch.html
- Stroke-font container/opcode cross-check: ezdxf's MIT-licensed shapefile implementation and Autodesk SHP documentation; no external font data is redistributed.

Source-format specifications are reference material, not evidence that this implementation conforms to every part of them. `VALIDATION.md` records actual native compilation/execution and the separately blocked browser run.

## 2.1 compiler provenance and specialization

The shader assembler expands includes deterministically and records compact original-file line ranges plus SHA-256 hashes. The runtime compiler reports both original and assembled locations. Pipeline creation is asynchronous with bounded concurrency. The native gate uses the identical assembled sources and compiler helper as the browser.

`rasterBatch` reaches only shared line, point and text helpers. It cannot reach the generic raster dispatcher's NURBS working array, hatch loops, dimensions or conic splitting. Both paths retain shared coverage math. Text batching bounds the density-proxy span; line bounds include source world-width, and cull padding includes device-pixel ratio and point radius. ABI sizes and the 128-byte camera upload remain unchanged.

## v2.2 internal-layout and boundary update

`GPU-AUDIT-v2.2.md` is the authoritative description of the 48-byte indirect buffer, finite leaf summaries, persistent `stats[8]` text-presence flag, native fills, prepared TEXT `r` matrix, sparse uploads and optional diagnostic sampling. Entity size remains 128 bytes. Page-bound roots keep their original offset; finite-only leaf summaries follow the root.
