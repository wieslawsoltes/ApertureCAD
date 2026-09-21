# Static block libraries and insertion — 2.5.0

## 1. Scope and data ownership

A block definition is a reusable named DXF record set; a reference retains an INSERT record, optional array dimensions and attached ATTRIB/SEQEND records. The semantic graph preserves this distinction instead of treating imported blocks only as anonymous rendered primitives. Root identities map to contiguous ranges in the expanded GPU model, which supports reference selection and editing without CPU per-frame hit geometry.

The authoritative authoring state is `BlockDrawing`. GPU buffers are derived, not the sole copy of a file. Review annotations have a separate state/history. Source commands are undoable without removing reviews. Each file owns its authoring graph, selected space, view/reviews and source file. Block Studio has a separate working graph and temporary compute engine; its changes do not affect the parent until Save.

This implementation is a **static 2D/top-plan DXF workflow**. Naming familiar commands does not imply an Autodesk command interpreter or complete compatibility. The profile below is authoritative.

## 2. Everyday usage

Open Blocks from the toolbar. **Workshop** creates a six-reference example with fourteen definitions; **New drawing** opens a separate blank tab. Importing a library adds a named local collection rather than modifying the active drawing. Drawing, Libraries, Recent and Favorites are independent palette filters. Search covers names, descriptions and tags. The list renders the first 500 matches, with a visible refine-search notice; all definitions remain searchable. Only the selected definition receives a compute thumbnail, not hundreds of simultaneous GPU canvases.

Select or double-click a definition and open Insert. Numeric controls specify XYZ, independent scales and rotation. Mirror X/Y toggles the corresponding sign. Unit conversion initializes the scale from block and destination drawing insertion units; unitless-to/from-unitless uses a factor of one. Arrays use MINSERT rows, columns and independent spacing along rotated array axes; scale does not scale that spacing. The form validates before importing definitions or closing. Locked layers cannot be chosen for insertion.

For interactive placement, position is followed by optional angle and optional uniform-scale stages. Numeric nonuniform scales are multiplied by the interactive uniform factor. Fifty screen pixels is the initial 1× scale reference. Shift quantizes the angle to 15°; Escape cancels. Repeat reuses the newly imported definition after the first placement instead of creating a new duplicate each time. Dragging a palette item into the drawing opens its insertion flow. When the pointer stops, snapping can refine the preview; the final position click issues its own fresh query and cannot be overwritten by an earlier asynchronous result.

Shift-click rendered source geometry to select a root source object/reference. The whole INSERT range highlights. Reference properties edit the real INSERT and its values, not a detached render proxy. Use the tree and references dialogs to inspect nested references, handles, layers, transforms and array dimensions. Nested rows describe their location inside a definition, not a separate flattened authoring object. The reference list visibly caps display at 5, 000 rows. Count expands nested multiplicities and checks integer precision.

Create block accepts selected entities from one space, a base point and convert/retain/delete-originals policy. Existing nested INSERTs remain nested. Convert places a new reference at the selected base point, retaining world placement. Definition properties include description, units, base, uniform-scale restriction, explode policy, and advanced raw DXF record editing. The graphical editor is the normal geometry-editing path; raw editing is an expert escape hatch, not an arbitrary DXF object validator.

## 3. Graphical Block Studio

Choose a current-drawing definition and Block Studio. A library definition must first be added to the drawing. The editor isolates the definition's members and dependency closure, assigns unique working handles, and draws with the same compute engine. Tools create lines, rectangles, circles, points, TEXT and ATTDEF, and place nested INSERTs. Pan, wheel zoom, fit, picking, deletion, numeric properties, undo and redo operate on the working state. ATTDEF is displayed as a tag placeholder in the editor; it is not converted to TEXT in the saved definition.

Nested INSERT property edits regenerate attached attribute coordinates. Save commits the member list in one parent transaction and updates all rendered uses. Cancel discards all local work. This is not a constraints/parametric action editor: grip-based arbitrary stretch, native dynamic blocks, lookup/visibility states, action graphs, assemblies, B-rep solids and dimensional constraints are outside this editor.

## 4. Attributes

The manager supports tag, prompt, value, position, height, rotation and the four basic flags, plus edit/remove/reorder. Duplicate tags and invalid heights are rejected. Existing instances do not silently acquire every template edit; explicit **Synchronize attributes** regenerates attached ATTRIBs at root and nested references, follows template order, and preserves values for matching tags. Changing a tag is a new attribute identity, so the previous value is not automatically associated with it.

Invisible/constant handling participates in rendering/value admission. Verify/preset flags are retained and labeled; AutoCAD's exact interactive prompt/verification sequence is not implemented. General multiline attributes, fields, annotative contexts, full text styles and dynamic evaluation are not claimed. Attribute data extraction emits source values and nested occurrence counts, not a spreadsheet calculation engine.

On DXF output, text axes are decomposed from the reference affine transform into ordinary WCS text position, height, width, rotation, obliquity and reflection flags. This is CPU file serialization math; glyph layout, bounds and rasterization remain GPU work. An attached root ATTRIB is not multiplied by its INSERT transform a second time. A nested ATTRIB receives the containing ancestry transform exactly once. Independent DXF matrices and real GPU regressions exercise these cases.

## 5. Command profile

| Entry | Implemented semantics | Not implied |
|---|---|---|
| INSERT | Numeric/on-screen point, scale, angle, units, mirror, attributes, repeat and rectangular MINSERT | Native DWG insertion, geographic positioning, full 3D/UCS/annotative/dynamic behavior |
| BLOCK | Create named definition from one-space source selection; base and original-object policy | Every native selection/preview/basepoint option |
| BEDIT | Isolated graphical static definition editor | Dynamic actions, constraints, every CAD drawing command |
| BPROPERTIES | Name, description, base, units, explode/uniform policy and raw record editor | Complete BLOCK_RECORD/XDATA/extension-dictionary UI |
| EATTEDIT | Root INSERT placement and attached attribute values | General fields, multiline/annotative contexts, full formatting |
| BATTMAN | Add/edit/remove/reorder ATTDEF; explicit tag-preserving sync | Exact native prompt/verify behavior or dynamic evaluation |
| BCOUNT | Nested/array expanded counts, attribute CSV | Unbounded instance enumeration or SQL-style extraction |
| EXPLODE / BURST | GPU affine bake of supported visible 2D primitive records; BURST retains supported visible attributes as TEXT | Native one-level explode: this implementation recursively removes rendered nested references |
| BREPLACE / BCOPY | Replace reference definition preserving placement/matching tags; reference offset copies | Native express-tool syntax or every property-matching option |
| BARRAY | Polar copy as independent INSERTs; rectangular arrays are in INSERT | Associative array objects, path arrays, adaptive constraints |
| WBLOCK | Selected definition and dependencies exported as DXF/JSON library | Every WBLOCK selection/base-point mode; exported DXF has definitions, not automatically a root placement |
| BREFS / PURGE | Nested reference graph; dependency-aware unused-definition cleanup with undo | External-reference binding or arbitrary proxy dependency interpretation |
| LIBRARIES | Local named collections, favorites/recent, portable import/export | DWG DesignCenter, cloud sharing, network catalogs or thumbnails for every tile |

External references are inspectable but not fetched/bound. Potential dynamic/evaluated definitions detected from known metadata/names are read-only with a warning. Detection is conservative, not a universal dynamic-object validator. Static evaluated geometry already contained in an input can render within the existing entity profile; dynamic parameters are never executed. Missing dependencies, cycles, protected content and unsupported conversions produce errors instead of pretending to implement them.

## 6. GPU contracts and algorithms

### 6.1 Compilation and page reconciliation

An authoring transaction validates the graph, writes an edited DXF and asks the parser worker to serialize parameter records. Existing compact entities remain 128 bytes, with auxiliary arrays for paths, text and transform ancestry. **Occurrences are still structurally expanded into primitive records.** Definitions are shared in authoring, not as a newly implemented GPU template/instance scene. Paper viewports continue sharing Model buffers independently of this block representation.

Reconciliation compares candidate packed pages with existing sources by IDs, counts, origins, text/auxiliary metadata and bytes. Identical pages keep entity/aux buffers and prepared contents. Changed/new pages allocate separately, upload, and run GPU transform/text/bounds/spatial preparation. Root readback is sixteen bytes per changed page. The handoff is transactional; old and new allocations coexist in peak admission accounting. A budget failure leaves the previous scene renderable. Style/palette/index resources may still be rebuilt, so “zero geometry upload” does not mean every commit is zero work or zero transfer. CPU serialization/reparse remains per committed drawing and can be expensive.

### 6.2 Preview

`placementPreview` appends one shared 64-byte root transform node per page and attaches original ancestry roots to it. Pointer motion coalesces into a reusable 32-byte payload updating the mutable node fields. The next frame uploads once per preview page and dispatches GPU prepare; geometry and glyph arrays keep their buffer identities. The base raster remains cached, and only the preview/overlay plus resolve change. No per-pointer DXF parse, primitive expansion, text-run layout or CPU tessellation occurs. Changing the definition/font/array shape builds a new preview rather than claiming transform-only cost.

### 6.3 Selection

Source handles map to compact `{first,count}` GPU ID intervals. Clearing old and marking new ranges runs compute kernels against the style buffer's selection bit. Resolve masks the bit when fetching layer metadata. Selection-only updates reuse base coverage. Input has a 4, 096-interval bound and safe integer/range checks. Buffers allocated for the queued command are destroyed after submission according to WebGPU resource lifetime rules.

### 6.4 Snap

`snapCandidates` dispatches one 64-lane workgroup per 128-entity spatial leaf. Bounds and layer visibility conservatively reject impossible candidates. Kernels evaluate supported endpoints, midpoints (including circular bulges), centers, ellipse quadrants and point/text origins, then reduce to a minimum; `reduceSnap` chooses the global winner. The CPU receives only 32 bytes, not candidate geometry. Stable scene/space ownership prevents stale asynchronous results from being applied after a tab change. High/low coordinates are preserved; a regression checks a center near (1e9, 2e9).

Snap modes are a bit mask: endpoint=1, center=2, midpoint=4, quadrant=8. Radius is 0–24 CSS pixels (exclusive zero), default 12. Intersections, tangent/perpendicular/nearest, full spline snaps, arbitrary INSERT origins and snapping Model geometry through a paper viewport are not supported. Paper-space source entities are queried in their own space. Preview/annotation geometry is excluded. Hover is throttled; commit requests a fresh snap.

### 6.5 GPU explode

Explode allocates private copies of selected entity/aux storage, evaluates the affine bake on the GPU, reads the explicitly requested result back, serializes supported DXF primitives, then commits. Original scene data is untouched until success. Supported cases include line/point/ray, conics, spline control points, straight or similarity-transformed bulged paths, triangles and supported single-line text. Source HATCH/DIMENSION, nonplanar cases, nonuniform bulged paths and unsupported text forms reject before replacing source records. Hidden geometry is not a promise of full source-level reconstruction. Attributes can be omitted or retained as ordinary supported text.

Conic baking derives principal axes algebraically from the transformed covariance matrix. A range-reduced polynomial atan2 is used for export-sensitive parameter/angle reconstruction: the software driver's ordinary trig approximation proved too inaccurate for the mirrored-ellipse regression. This explicit-command kernel change does not replace the hot raster shader. Independent endpoint/interior samples verify the mirrored sweep orientation within the finite tested tolerance (1e-4 drawing units for that fixture), not a universal exactness theorem. f32 geometry and extreme condition numbers remain limitations.

## 7. Budgets and lifecycle

| Resource | Bound / behavior |
|---|---|
| Editable input | Default 256 MiB source admission and two million records; not a total JS heap guarantee |
| Portable library | 64 MiB serialized admission/export; at most 10, 000 definitions in schema validation |
| Nesting | Cycle validation and maximum graph depth 48 |
| MINSERT | Rows/columns 1..32, 767; product at most 1, 000, 000, with additional renderer/GPU admission |
| Preview | At most65, 534 expanded entities; current renderer/overlay and allocation limits apply |
| Source history | 64 operations; structurally shared records, but no fixed heap budget for all undo data |
| Source selection | At most4, 096 submitted intervals |
| GPU explode | Explicit command limited to 100, 000 expanded entities /128 MiB returned scratch result; peak budget checks also apply |
| Thumbnail | Separate 128 MiB compute-device budget, one active selection |
| Block Studio | Separate 192 MiB compute-device budget; thumbnail is disposed before opening |
| Main drawing | Existing configured GPU budget (default 768 MiB), including transactional old/new pages and optional caches |

The device budgets are **additive**, not a single physical-memory guarantee. Inactive file tabs retain CPU packed/source/authoring state; only the active file occupies main-engine entity storage. Session history and semantic graph allocations are not completely represented by the existing source+packed CPU admission counter. Per-page reallocation, snapping and high-density geometry still have driver costs; this release claims tested transfer behavior, not a universal FPS increase.

## 8. Source API example

```js
import { BlockDrawing, group } from '../packages/blocks/document.js';
import { engineeringLibrary } from '../packages/blocks/library.js';
import { DxfWorkerClient } from '../packages/dxf/client.js';

const source = new BlockDrawing(null, { name: 'Pump assembly.dxf' });
source.importLibrary(engineeringLibrary(), { conflict: 'rename' });
const handle = source.insert('VALVE_GATE', {
  position: [100, 200, 0], scale: [-2, 3, 1], rotation: 30,
  rows: 2, columns: 3, rowSpacing: 25, columnSpacing: 40,
  layer: '0', space: 'model', attributes: { TAG: 'V-204' },
});
source.editInsert(handle, { rotation: 45 });
source.addAttribute('VALVE_GATE', {
  tag: 'SERVICE', prompt: 'Service', value: 'STEAM', x: 0, y: -12,
  height: 2.5,
});
source.syncAttributes('VALVE_GATE');
const portable = source.exportLibrary(['VALVE_GATE']);
const editedDxf = source.write();

// engine and font are the initialized application/embedding objects.
const worker = new DxfWorkerClient();
const model = await worker.parse(new TextEncoder().encode(editedDxf).buffer, font, {
  name: source.name, document: true, editMap: true,
});
await engine.reconcileModel(model);
// Host schedules/presents a frame before interaction.
engine.selectEntities(model.editRoots.filter(r => r.handle === handle));
const snap = await engine.snap(200, 150, { radius: 12, modes: 15 });
console.log(snap?.kind, snap?.point);
// worker.cancel(); engine.dispose(); on host teardown.
```

`insert()` returns a root source handle. `editInsert(handle, patch)` preserves unspecified reference parameters. `transaction(label, callback)` wraps multiple graph edits into one undo operation and rolls back on failure. `undo()` / `redo()` mutate the graph; hosts must then repack/reconcile it. `toState()` / `BlockDrawing.fromState()` persist authored state, not live GPU resources or session history. `BlockShelf` owns local collection persistence. Direct graph edits do not automatically refresh the UI: the shipped controller wraps them in its serialized transaction/reconcile operation.

Low-level engine additions are `reconcileModel(model)`, `updateBlockPreview({x,y,angle,scale})` (angle radians, uniform multiplier), `selectEntities(ranges)`, `snap(cssX,cssY,options)` and `explode(ranges,limits)`. Explode output is GPU-baked data, not automatically an edited source: validate the source profile and pass it through the block serializer before committing. The application performs that admission and transaction.

## 9. File interoperability and boundaries

DXF serialization emits proper subclasses/handles/owners for the implemented records, including INSERT/ATTRIB/SEQEND and classic polyline compounds. Definition member handles are isolated on copying/editing. Incoming handles reserve allocator space to prevent future collisions. Model and active paper-space entities go in ENTITIES; inactive paper layouts are written into their special paper-space BLOCK containers with matching BLOCK_RECORD/LAYOUT ownership. On import the editable graph normalizes all those root records into a canonical one-space-labeled list before the renderer partitions them.

Independent ezdxf 1.4.4 reads and audits nine exported R2007 fixtures without repair, checks mirrored attribute matrices/MINSERT cells, dependency conflict renaming, nonzero base point, isolated handles, separate paper owners and synchronization order. This does **not** certify AutoCAD DWG interoperability, every DXF version, complex extension dictionaries/reactors, proxies, dynamic objects, styles/fonts or lossless edited round-tripping. The unchanged original-source export remains the only exact preservation path for original bytes. Library table conflicts retain existing named layer/style resources; definition collision policies are not full resource remapping.

Relevant primary format references: Autodesk DXF reference, INSERT/BLOCK/ATTRIB/LAYOUT/BLOCK_RECORD sections; ezdxf DXF internals Layout Management (https://ezdxf.readthedocs.io/en/stable/dxfinternals/layout_management.html). Source reference is for format semantics, not a claim of third-party certification.

## 10. Evidence

`tests/blocks.test.mjs`:46 new finite CPU/data contracts. `tests/gpu-blocks25-regressions.js`:15 new actual native GPU checks shared with the production modules. `tests/blocks-ui.py`:10 real DOM/controller/worker checks with explicit engine/storage doubles. `tests/blocks_interop.py`:seven independent checks over nine exported files. `artifacts/native-block-workshop.png` is a real compute capture. UI test-double captures are explicitly named and not used as GPU-rendering evidence. Full counts and qualifications are in `VALIDATION.md`.
