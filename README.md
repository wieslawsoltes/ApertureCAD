# Aperture CAD 2.5.0

A modular, local-first HTML/JavaScript CAD workbench with **compute-only WebGPU entity evaluation and rendering**, now with an editable static DXF block graph, reusable libraries, insertion tools, and a graphical definition editor. The application, build, and core tests require no npm dependencies. No graphics-pipeline, WebGL, Canvas2D, CPU CAD rasterizer, remote drawing upload, or network-font fallback is introduced.

## Start with blocks

Run `npm run build`, then `npm start`, and open `http://localhost:4173/`. Choose **Blocks** in the top toolbar, then **Workshop** for a populated drawing or **New drawing** for a blank document; existing file tabs remain open. Libraries contains fourteen original engineering and architectural definitions. Select a definition for its compute preview; double-click it or choose **Insert…**.

The INSERT form offers numeric or on-screen positioning, independent XYZ scales, mirrors, rotation, drawing-unit conversion, rows/columns with spacing, attribute values, grid/GPU object snap, and repeat placement. Optional on-screen angle and uniform-scale stages follow the position click. Shift constrains the angle to 15° increments. Escape cancels without editing the source.

Choose **Block Studio** on a definition in the current drawing to edit it graphically in isolation. Add lines, rectangles, circles, points, text, attributes, and nested INSERTs; inspect/edit source properties; undo/redo locally. **Save definition** updates its uses in one parent-document transaction. Cancel leaves the parent unchanged.

**Save edited DXF** exports the authored drawing, including blocks and attached attributes. The existing original-source export remains unchanged. **Save libraries locally** and **Save local** are explicit browser-storage operations; edited graph state is retained across workspace restore, but session undo history is not persisted.

## Implemented block workflow

| Area | Functionality |
|---|---|
| Library palette | Drawing, Libraries, Recent, Favorites, search, named collections, one selected compute thumbnail, dependency tree, references and counts. |
| Portable content | Import DXF/JSON libraries; selected definition plus dependencies; rename/keep/replace conflicts; local library save/load; fourteen original symbols. |
| Definitions | Create from selected source entities with base point; convert/retain/delete originals; rename; description, units, uniform-scale and explode policies; graphical and raw-record editing; undoable dependency-aware purge. |
| References | Nested INSERT/MINSERT identity; position, independent scale, mirror, rotation, arrays, attributes, copy, polar-copy array, replace, delete, independent source undo/redo. |
| Attributes | ATTDEF create/edit/remove/reorder; Attached ATTRIB/SEQEND; tag/value/prompt; explicit synchronization of root and nested references preserving matching-tag values; count/data CSV. |
| Placement | Resident compute preview, 32-byte shared-transform writes per preview page; GPU endpoint/midpoint/center/quadrant queries; grid snap; repeat; cancellation. |
| Selection and explode | Compact source-interval selection masks; GPU affine bake of supported rendered 2D primitives, with or without visible attribute text; atomic failure on unsupported conversion. |
| Documents | Multiple-file tabs, Model and paper layouts, cameras, reviews, original exports and updated-source exports remain separate. Inactive paper-space ownership is normalized correctly for export. |

This is a substantial **static DXF block-authoring implementation, not complete AutoCAD block/INSERT parity**. Native DWG, dynamic actions/constraints, XREF resolution, 3D/UCS insertion and other limits are explicit in `docs/BLOCKS.md`. EXPLODE recursively flattens supported rendered 2D geometry, not AutoCAD's one-level command semantics. WBLOCK is a dependency-library export, not every native WBLOCK mode.

## GPU and CPU boundary

The editable CPU graph stores real definitions and references. At commit, a worker parses/serializes the authored DXF into the existing compact GPU ABI; unchanged GPU pages are reused byte-for-byte, and only changed/new pages are uploaded and prepared. **Primitive records are still expanded per occurrence**: there is no new shared-template GPU block instancing claim. CPU commit serialization can remain substantial for large drawings.

Pointer movement does not reparse DXF or rebuild glyph buffers. It writes one 32-byte root transform per preview page and runs GPU preparation. The cached base drawing is not rerasterized for a preview-only update. GPU snapping traverses spatial clusters and returns just a 32-byte winning result. A source selection uploads compact intervals and changes GPU style masks without rerasterizing base coverage. GPU explode reads back transformed geometry only for an explicit committed editing command.

No-op reconciliation tests verify zero geometry uploads and preserved entity/aux buffer identity. Appending an INSERT preserves stable prefix pages. Transactional old/new allocations are budgeted together; a rejected allocation leaves the old drawing usable. Thumbnail and isolated-editor devices have separate budgets and are disposed when replaced/closed. All previous paper-cache, sparse-uniform, readback-pool and validated-timing functionality remains.

## Run and validate

```sh
npm run build
npm test
npm run check
npm start
```

Node 20.11 or later is required. `dist/index.html` and `dist/aperture-cad-preview.html` are self-contained; `dist/index.modular.html` uses adjacent `app.js`/`styles.css`. Use localhost or HTTPS. Header **2.5** and `Aperture.version === '2.5.0'` identify the updated build. Replace older embedded previews completely.

Actual validation: **265 core tests; six WGSL modules and 34 compute pipelines compiled; four negative probes rejected; 62 native execution/scale checks passed on Vulkan/SwiftShader**. Fifteen new native block tests exercise transform preview, page reuse, selection, snap, and explode. Independent ezdxf 1.4.4 checks read nine authored R2007 DXFs with zero audit errors or requested repairs. Five browser DOM, seven workspace-controller, and ten block-controller checks pass; controller tests explicitly double the engine/storage boundaries. See `docs/VALIDATION.md` and `artifacts/release-validation.json`.

```sh
# Optional validation dependencies, not application dependencies:
npm install --no-save webgpu@0.6.1
npm run test:wgsl
# Requires an execution backend/driver:
npm run test:native
python -m pip install -r tests/requirements.txt
python -m pip install -r tests/requirements-interop.txt
npm run test:dom
npm run test:workspace
npm run test:blocks-ui
npm run test:blocks-interop
```

SwiftShader is a **software adapter**. Actual browser WebGPU navigation is policy-blocked here (`ERR_BLOCKED_BY_ADMINISTRATOR`), so hardware performance and browser canvas presentation are not qualified. This release makes no before/after FPS claim. Prior release comparisons remain explicitly historical under `artifacts/history-v2.4/`. Native images are real compute captures; files named `*-dom-test-*` or `workspace-ui-test-*` use declared test doubles and are not rendering evidence.

## Modules

`packages/blocks` owns the editable graph, standard DXF serialization, portable library, placement model and supported explode serialization. `packages/app/blocks.js` and `block-studio.js` own the palette and authoring workflow. `packages/gpu/block-tools.js`, `edit-tools.js`, and `shaders/edit.wgsl` own page reconciliation, preview writes, GPU selection/snapping/affine baking. Existing model, DXF, font, annotation, performance and GPU modules retain their responsibilities.

See `docs/BLOCKS.md` for the usage guide, command compatibility profile, APIs, safety budgets and algorithms; `docs/API.md` for the complete existing engine interface; and `docs/CONFORMANCE.md` for retained DXF/font/view limits. `examples/block-workshop.dxf`, `engineering.blocks.json`, and `block-layouts.dxf` provide reproducible content. No external font or native test binaries are redistributed. No live-site publication is claimed.
