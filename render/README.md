# Manufacturer DXF Cleaner Viewer

The app uses React/TSX, pnpm, Vite, and a portable CAD module. The host provides a Dashboard and a File Browser alongside the viewer. No editing, accounts, or measurement persistence.

## Run

```sh
cd render
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:5173. If that port is occupied, use `pnpm dev --port 5174`. The server binds to loopback only. `pnpm build` checks TypeScript and builds production assets; `pnpm test` runs viewer, browser, and filesystem/API tests. `pnpm preview --port 5174` serves the production build with the same repository API.

## Repository Browser

The Dashboard opens first and provides dataset/result shortcuts, DXF counts, drawing shortcuts, and a File Browser button. The browser includes an expandable folder tree, breadcrumbs, parent navigation, recursive search within the current folder, sorting, file sizes, modification dates, and refresh. Opening a DXF leaves the browser beside the viewer; on narrow screens they stack, and the browser can be hidden with the panel toggle.

The read-only Vite plugin reads `../datasets` and `../results` directly from disk. Only directories and case-insensitive `.dxf` filenames appear; empty folders remain visible. Refresh picks up newly generated results. Browser back/forward navigates folders, and folder URLs can be bookmarked. Local file picking, drag/drop, and the viewer tools remain available.

Repository paths are restricted to these two roots. Non-DXF requests, path traversal, out-of-root symlinks, cross-origin requests, and write methods are rejected. Symbolic links are excluded from listings. Private dataset contents and names are available to this local app, so keep the server on loopback and do not expose it publicly.

The built frontend is not a standalone filesystem browser: it needs `pnpm dev` or `pnpm preview` to supply the API. Do not open the built HTML directly or serve it through a static-only server. The repository folders remain outside `dist` and are never bundled into the frontend.

## Try it

Open a repository DXF in File Browser, or choose a local DXF from the empty viewer state.

- Open or drop a text DXF.
- **V** selects; hover previews geometry and click keeps it highlighted. Cmd-click (macOS) or Shift-click toggles entities in a multi-selection. Clicking empty space clears it. Drag to pan.
- **H** pans; **F** fits; wheel/pinch zooms around the cursor. Toolbar buttons also zoom.
- **M** starts a two-click line ruler; **B** starts a two-click axis-aligned box ruler.
- Snap finds endpoints, midpoints, centres, quadrants and point nodes within a 12 CSS-pixel aperture. It excludes hidden layers.
- Completed rulers remain visible; select them from the canvas or list and press Delete, use the trash button, or clear all.
- **Esc** cancels a draft and clears selection. Space + drag temporarily pans.
- Layers can be hidden, shown, or isolated.

Changing files clears the current selection and measurements.

## Port boundary

`src/App.tsx`, `src/FileBrowser.tsx`, and `src/workspace.css` implement the new host; `src/style.css` preserves the demo styles. `server/repository.mjs` supplies the local read-only API. The portable module is `src/cad-viewer/`; it has its own `viewer.css` stylesheet and is unchanged from the demo. The remainder of this document records the original viewer's architecture and limitations.

```tsx
import { CadViewer } from "./cad-viewer";
import "./cad-viewer/viewer.css";

// Keep the source object stable across unrelated parent renders.
<CadViewer
  source={{ kind: "blob", blob: file, name: file.name }}
  onEntitySelect={(entity) => console.log(entity)}
  onMeasurementCreate={(measurement) => console.log(measurement)}
/>;
```

Sources accept Blob/File, URL, or raw text. The containing element must have a defined height. In Next.js, mount this as a client-only dynamically imported component. The source identity is the load identity; memoize it when constructing it inside a frequently rerendering host.

| Module                   | Responsibility                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `CadViewer.tsx`          | React lifecycle, tool state, selection, measurements, keyboard/pointer coordination         |
| `dxf-adapter.ts`         | All DXF/Three.js imports, parsing, scene/camera, normalization, snapping, picking, disposal |
| `measurements.ts`        | Pure measurement and segment-distance calculations shared by tools and inspection           |
| `MeasurementOverlay.tsx` | Small SVG overlay for rulers and snap indicators; the CAD drawing itself stays WebGL        |
| `controls.tsx`           | Toolbar, layers, properties, measurement list                                               |
| `types.ts`               | Library-independent public data and error types                                             |
| `selection.ts`           | Pure single/multi-selection transition                                                      |

The `dxf-react` wrapper was inspected first. Its public component handle does not expose the camera required for a shared custom line/box overlay. This demo uses the same project's `dxf-render` directly rather than reaching into private React wrapper state or maintaining two independent measurement systems. No speculative multi-renderer framework is introduced.

## Reading order and component hierarchy

Read these in order:

1. `src/App.tsx` — app host: local file picker and lazy loading.
2. `src/cad-viewer/types.ts` — the portable public contract and every supported configuration value.
3. `src/cad-viewer/CadViewer.tsx` — composition root and interaction coordinator.
4. `src/cad-viewer/dxf-adapter.ts` — the DXF/Three.js effect boundary.
5. `src/cad-viewer/measurements.ts` and `selection.ts` — pure domain transitions/calculations.
6. `src/cad-viewer/controls.tsx`, `MeasurementOverlay.tsx` and `viewer.css` — presentation.

```text
App (demo only)
└── CadViewer (portable composition root)
    ├── DxfAdapter (parse/render/pick/snap/highlight; imperative effect boundary)
    ├── Toolbar (configured commands)
    ├── MeasurementOverlay (SVG projection of model-space measurements)
    └── Panels
        ├── Inspector (single properties or multi-selection summary)
        ├── Layers
        └── Measurement list
```

Data flows down as values; user intentions flow up as callbacks. The adapter never imports React, controls never import DXF/Three.js types, and the demo shell never reaches into the adapter.

## Configuration surface

All defaults live in `DEFAULT_CAD_CONFIG` in `src/cad-viewer/types.ts`. A caller overrides only what it needs:

```tsx
<CadViewer
  source={{ kind: "blob", blob: file, name: file.name }}
  config={{
    tools: {
      select: true,
      pan: true,
      lineMeasure: true,
      boxMeasure: false,
      layers: true,
      snap: true,
      zoom: true,
      fit: true,
    },
    theme: {
      background: "#fcfcfa",
      hover: "#4c9b78",
      selection: "#f2693d",
      measurement: "#c78748",
      snap: "#479d78",
    },
    initialTool: "select",
    initialSnapEnabled: true,
    enableHoverHighlight: true,
    enableMultiSelect: true,
    snapRadiusPx: 12,
    pickRadiusPx: 7,
    maxFileBytes: 50 * 1024 * 1024,
  }}
  onEntityHover={(entity) => console.log(entity)}
  onSelectionChange={(entities) => console.log(entities)}
/>
```

The nested `tools` and `theme` values are partial at the prop boundary, so `{ tools: { boxMeasure: false } }` is valid. Keep a supplied `config` object stable across unrelated host renders; changing it intentionally recreates the renderer so init-time settings remain coherent.

Configuration deliberately excludes arbitrary renderer objects. Add a setting only when it expresses a stable viewer capability, interaction policy, resource limit or theme token. Document-specific state—selected entities, hidden layers and measurements—belongs in state/ports rather than static configuration.

## Proposed Docuflow RNODE shape

For the first port, use one composable UI RNODE rather than splitting the interactive viewer into several independently scheduled RNODEs:

```text
CadViewer RNODE
inputs:
  source: FileHandle | Blob | signed URL | DXF text
  config: CadViewerConfig
  initialState?: { hiddenLayers; measurements; selectedEntityIds }

outputs/events:
  loaded: CadDocument
  selectionChanged: CadEntity[]
  entityHovered: CadEntity | null
  measurementCreated: Measurement
  stateChanged: { hiddenLayers; measurements; selectedEntityIds }
  error: CadError
```

Keep acquisition separate when a workflow needs it:

```text
FileHandle/URL ──> ResolveFile RNODE ──> Blob ──> CadViewer RNODE
                                             ├──> selectionChanged
                                             ├──> measurementCreated
                                             └──> error
```

This makes `ResolveFile` reusable for permissions/storage and keeps the viewer client-side. A later `PersistCadReview` RNODE can consume `stateChanged`; persistence should not be embedded in the viewer. A headless `ParseDxf` RNODE is justified only when non-UI workflows need entity metadata or validation. Rendering, camera, hover, selection and measurement should stay together because they share one live coordinate system and scene lifecycle.

## Correctness and prototype limits

- Measurements use XY model coordinates, not screen pixels; no implicit conversion to millimetres. `$INSUNITS` supplies labels. Missing/unrecognized units are explicitly unknown.
- Exact line/circle/arc inspection uses transformed source geometry. Nonuniform circular transforms are identified as elliptical rather than assigned a false radius. Polyline lengths are explicitly approximate because the engine's outline is tessellated.
- Picking uses the engine's entity bounds to cull candidates, then distance to visible outlines. Text/dimension entities use a bounding-box fallback. Block children are independently selected using instance IDs; selecting a whole INSERT is deferred.
- Model-space, text DXF only. No binary DXF, DWG, editing, external references, printing or export. Font fidelity follows the engine's bundled fonts.
- Box rulers are axis aligned and use two clicks. Rulers report XY projections for nonplanar drawings. No intersection or nearest-curve snapping.
- File cap is 50 MB. URL fetches need normal CORS permission. Large/high-entity-count production drawings have not been benchmarked. Picking/snapping scan the engine index; a spatial index should only be added if representative files justify it.
- The CAD chunk is loaded lazily but includes Three.js and the engine's embedded font. This is not a tiny dependency payload; see the build output for measured sizes.
- Rendering support is inherited from the pinned engine. This is a working demo, not a guarantee of fidelity for every DXF variant. Validate real manufacturing files before porting.
- No file contents are uploaded. JavaScript and bundled fonts are served locally; a caller-provided URL is fetched directly. The documentation link opens GitHub only when clicked.

## Documentation consulted

Package versions are pinned in `package.json` and `pnpm-lock.yaml`. Published TypeScript declarations and compiled implementation were checked locally; online main-branch docs may describe newer behavior.

- [DXF kit repository and license](https://github.com/arbaev/dxf-kit)
- [React wrapper API](https://github.com/arbaev/dxf-kit/blob/main/packages/dxf-react/README.md)
- [Renderer API: parsing, picking, transforms, snapping, fonts](https://github.com/arbaev/dxf-kit/blob/main/packages/dxf-render/README.md)
- [Interaction implementation](https://github.com/arbaev/dxf-kit/tree/main/packages/dxf-interaction)
- [Autodesk DXF reference](https://help.autodesk.com/cloudhelp/2020/ENU/AutoCAD-DXF/files/index.htm)
- [Autodesk header variables and units](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-DXF/files/GUID-A85E8E67-27CD-4C59-BE61-4DC9FADBE74A.htm)
- [Autodesk object coordinate systems](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-D99F1509-E4E4-47A3-8691-92EA07DC88F5.htm)
- [Vite guide](https://vite.dev/guide/)

## Validation

Eight automated tests cover known distances, signed deltas, zero-length direction, invariance under translation/rotation/reversal, box dimensions, bounded segment picking, hidden-layer snapping, and transformed block instance snaps. Browser checks exercise rendering, selection, measurements, layers, zoom/fit and file switching. Real customer drawing evaluation remains the next step.
