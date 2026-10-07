import * as THREE from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import {
  parseDxfAsync,
  createThreeObjectsFromDXF,
  buildPickingIndex,
  buildEntityIndex,
  buildHighlightGeometry,
  findSnapPoint,
  isLineEntity,
  isCircleEntity,
  isArcEntity,
  isPolylineEntity,
  isTextEntity,
  isInsertEntity,
  isEllipseEntity,
  type DxfEntity,
  type PickingEntry,
  type PickingIndex,
} from "dxf-render";
import {
  CadError,
  type CadSource,
  type CadDocument,
  type CadEntity,
  type Point,
  type SnapHit,
  type Tool,
  type CadTheme,
} from "./types";
import {
  formatNumber as n,
  measureLine,
  segmentDistance,
} from "./measurements";

const UNIT_NAMES: Record<number, string> = {
  1: "in",
  2: "ft",
  3: "mi",
  4: "mm",
  5: "cm",
  6: "m",
  7: "km",
  8: "µin",
  9: "mil",
  10: "yd",
  11: "Å",
  12: "nm",
  13: "µm",
  14: "dm",
  15: "dam",
  16: "hm",
  17: "Gm",
  18: "au",
  19: "ly",
  20: "pc",
  21: "US survey ft",
};

// The only module that knows DXF and Three.js. Public coordinates are model units.
export function createDxfAdapter(
  host: HTMLElement,
  events: {
    phase: (phase: string) => void;
    frame: () => void;
  },
  config: { theme: CadTheme; maxFileBytes: number; pickRadiusPx: number },
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.theme.background);
  const camera = new THREE.OrthographicCamera(-200, 200, 150, -150, 0.01, 1e9);
  camera.position.set(0, 0, 10000);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.setAttribute("aria-label", "DXF drawing viewport");
  host.appendChild(renderer.domElement);
  const controls = new MapControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  const origin = new THREE.Vector3();
  const abort = new AbortController();
  let disposed = false;
  let root: THREE.Group | null = null;
  let selection: THREE.Group | null = null;
  let hover: THREE.Group | null = null;
  let index: PickingIndex = {
    entries: [],
    byHandle: new Map(),
    byId: new Map(),
  };
  let entities = new Map<string, DxfEntity>();
  let visible = new Set<string>();
  let units = "drawing units";
  const outlines = new Map<string, ReturnType<typeof buildHighlightGeometry>>();

  const render = () => {
    if (!disposed) {
      renderer.render(scene, camera);
      events.frame();
    }
  };
  controls.addEventListener("change", render);
  const resize = () => {
    const width = Math.max(host.clientWidth, 1),
      height = Math.max(host.clientHeight, 1);
    const halfHeight = (camera.top - camera.bottom) / 2;
    camera.left = (-halfHeight * width) / height;
    camera.right = -camera.left;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const disposeGroup = (group: THREE.Group) => {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material)
        for (const material of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          material.dispose();
    });
    scene.remove(group);
  };
  const outline = (entry: PickingEntry) => {
    let value = outlines.get(entry.id);
    if (!value) {
      const entity = entities.get(entry.handle);
      value = entity
        ? buildHighlightGeometry(entity, entry.worldMatrix ?? null)
        : { polylines: [], fallbackToBBox: true };
      outlines.set(entry.id, value);
    }
    return value;
  };
  const makeHighlight = (ids: readonly string[], color: string) => {
    const group = new THREE.Group();
    for (const id of ids) {
      const entry = index.byId.get(id);
      if (!entry || !visible.has(entry.layer)) continue;
      const geometry = outline(entry);
      const lines = geometry.fallbackToBBox
        ? [
            [
              new THREE.Vector3(entry.bbox.min.x, entry.bbox.min.y),
              new THREE.Vector3(entry.bbox.max.x, entry.bbox.min.y),
              new THREE.Vector3(entry.bbox.max.x, entry.bbox.max.y),
              new THREE.Vector3(entry.bbox.min.x, entry.bbox.max.y),
              new THREE.Vector3(entry.bbox.min.x, entry.bbox.min.y),
            ],
          ]
        : geometry.polylines;
      for (const points of lines) {
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(
            points.map((p) => p.clone().sub(origin)),
          ),
          new THREE.LineBasicMaterial({ color, depthTest: false }),
        );
        line.renderOrder = 1000;
        group.add(line);
      }
    }
    scene.add(group);
    return group;
  };
  const worldPoint = (
    point: { x: number; y: number; z?: number },
    entry: PickingEntry,
  ) => {
    const v = new THREE.Vector3(point.x, point.y, point.z ?? 0);
    return entry.worldMatrix ? v.applyMatrix4(entry.worldMatrix) : v;
  };
  const modelAt = (x: number, y: number): Point => {
    const bounds = host.getBoundingClientRect();
    const point = new THREE.Vector3(
      (x / bounds.width) * 2 - 1,
      1 - (y / bounds.height) * 2,
      0,
    )
      .unproject(camera)
      .add(origin);
    return { x: point.x, y: point.y };
  };
  const project = (point: Point): Point => {
    const v = new THREE.Vector3(
      point.x - origin.x,
      point.y - origin.y,
      0,
    ).project(camera);
    return {
      x: ((v.x + 1) * host.clientWidth) / 2,
      y: ((1 - v.y) * host.clientHeight) / 2,
    };
  };
  const pixelSize = () =>
    (camera.top - camera.bottom) / camera.zoom / Math.max(host.clientHeight, 1);
  const fit = () => {
    if (!root) return;
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()),
      centre = box.getCenter(new THREE.Vector3());
    const aspect =
      Math.max(host.clientWidth, 1) / Math.max(host.clientHeight, 1);
    const height = Math.max(size.y, size.x / aspect, 1) * 1.35;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.left = (-height * aspect) / 2;
    camera.right = -camera.left;
    camera.zoom = 1;
    camera.position.set(centre.x, centre.y, Math.max(size.z + 10000, 10000));
    controls.target.set(centre.x, centre.y, centre.z);
    camera.updateProjectionMatrix();
    controls.update();
    render();
  };

  return {
    async load(source: CadSource): Promise<CadDocument | null> {
      events.phase(
        source.kind === "url" ? "Fetching drawing…" : "Reading drawing…",
      );
      let text: string;
      if (source.kind === "text") text = source.text;
      else {
        let blob: Blob;
        if (source.kind === "blob") blob = source.blob;
        else {
          let response: Response;
          try {
            response = await fetch(source.url, { signal: abort.signal });
          } catch {
            throw new CadError(
              "fetch",
              "Could not fetch this drawing. Check the URL and connection.",
            );
          }
          if (!response.ok)
            throw new CadError(
              "fetch",
              `Drawing request failed (${response.status}).`,
            );
          if (
            Number(response.headers.get("content-length")) > config.maxFileBytes
          )
            throw new CadError(
              "too-large",
              `File exceeds the configured ${Math.round(config.maxFileBytes / 1024 / 1024)} MB limit.`,
            );
          blob = await response.blob();
        }
        if (blob.size > config.maxFileBytes)
          throw new CadError(
            "too-large",
            `File exceeds the configured ${Math.round(config.maxFileBytes / 1024 / 1024)} MB limit.`,
          );
        text = await blob.text();
      }
      if (disposed) return null;
      if (text.length > config.maxFileBytes)
        throw new CadError(
          "too-large",
          `File exceeds the configured ${Math.round(config.maxFileBytes / 1024 / 1024)} MB limit.`,
        );
      if (/^AutoCAD Binary DXF|^AC10/.test(text))
        throw new CadError(
          "unsupported",
          "This demo accepts text DXF files. Binary DXF and DWG are not supported.",
        );
      if (!/\bSECTION\b/.test(text) || !/\bEOF\b/.test(text))
        throw new CadError(
          "malformed",
          "This is not a complete text DXF file (SECTION / EOF missing).",
        );
      events.phase("Parsing DXF…");
      let data;
      try {
        data = await parseDxfAsync(text);
      } catch (error) {
        throw new CadError(
          "malformed",
          `DXF parse failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (disposed) return null;
      // The prototype displays model space only. Preserve blocks for INSERT expansion.
      data = {
        ...data,
        entities: data.entities.filter(
          (e) => !e.inPaperSpace && e.visible !== false,
        ),
      };
      if (!data.entities.length)
        throw new CadError(
          "unsupported",
          "No visible model-space entities were found.",
        );
      index = buildPickingIndex(data);
      entities = buildEntityIndex(data);
      units = UNIT_NAMES[data.header?.$INSUNITS ?? 0] ?? "drawing units";
      events.phase("Rendering drawing…");
      const result = await createThreeObjectsFromDXF(data, {
        darkTheme: false,
        signal: abort.signal,
      });
      if (disposed) {
        disposeGroup(result.group);
        result.materials.disposeAll();
        return null;
      }
      root = result.group;
      scene.add(root);
      origin.set(
        result.originOffset.x,
        result.originOffset.y,
        result.originOffset.z,
      );
      visible = new Set(index.entries.map((e) => e.layer));
      const layerNames = new Set([
        ...Object.keys(data.tables?.layer?.layers ?? {}),
        ...visible,
      ]);
      const layers = [...layerNames].map((id) => ({
        id,
        color:
          "#" +
          (data.tables?.layer?.layers[id]?.color ?? 0x637d79)
            .toString(16)
            .padStart(6, "0"),
        count: index.entries.filter(
          (e) => e.layer === id && e.type !== "INSERT",
        ).length,
      }));
      visible = new Set(layerNames);
      const warnings = [
        ...(result.unsupportedEntities?.length
          ? [`Unsupported entities: ${result.unsupportedEntities.join(", ")}`]
          : []),
        ...(result.warnings ? [result.warnings] : []),
      ];
      if (
        index.entries.some((e) => {
          const points = outline(e).polylines.flat();
          return (
            points.length > 1 &&
            points.some((p) => Math.abs(p.z - points[0].z) > 1e-6)
          );
        })
      )
        warnings.push(
          "Nonplanar geometry detected. Rulers report XY projected distances.",
        );
      fit();
      return {
        name: source.name,
        entityCount: data.entities.length,
        units,
        layers,
        warnings,
      };
    },
    modelAt,
    project,
    fit,
    zoom(factor: number) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 0.00001, 1e6);
      camera.updateProjectionMatrix();
      render();
    },
    setTool(tool: Tool) {
      controls.enablePan = tool === "select" || tool === "pan";
    },
    panTemporarily(enabled: boolean) {
      controls.enablePan = enabled;
    },
    setLayers(hidden: ReadonlySet<string>) {
      visible = new Set(
        [...index.entries.map((e) => e.layer)].filter((id) => !hidden.has(id)),
      );
      root?.traverse((obj) => {
        if (typeof obj.userData.layerName === "string")
          obj.visible = !hidden.has(obj.userData.layerName);
      });
      render();
    },
    snap(point: Point, radiusPx = 12): SnapHit | null {
      const hit = findSnapPoint(
        index,
        entities,
        point,
        pixelSize() * radiusPx,
        { visibleLayers: visible },
      );
      return hit
        ? { point: { x: hit.point.x, y: hit.point.y }, kind: hit.type }
        : null;
    },
    pick(point: Point): CadEntity | null {
      const tolerance = pixelSize() * config.pickRadiusPx;
      let best: PickingEntry | null = null,
        bestDistance = Infinity;
      for (const entry of index.entries) {
        if (!visible.has(entry.layer) || entry.type === "INSERT") continue;
        const { min, max } = entry.bbox;
        if (
          point.x < min.x - tolerance ||
          point.x > max.x + tolerance ||
          point.y < min.y - tolerance ||
          point.y > max.y + tolerance
        )
          continue;
        const geometry = outline(entry);
        let distance = Infinity;
        for (const line of geometry.polylines)
          for (let i = 1; i < line.length; i++)
            distance = Math.min(
              distance,
              segmentDistance(point, line[i - 1], line[i]),
            );
        if (geometry.fallbackToBBox) distance = tolerance * 0.9;
        if (distance <= tolerance && distance < bestDistance) {
          best = entry;
          bestDistance = distance;
        }
      }
      return best ? this.inspect(best.id) : null;
    },
    inspect(id: string): CadEntity | null {
      const entry = index.byId.get(id);
      if (!entry) return null;
      const entity = entities.get(entry.handle);
      if (!entity) return null;
      const properties: { label: string; value: string }[] = [];
      const length = (label: string, value: number) =>
        properties.push({ label, value: `${n(value)} ${units}` });
      const point = (label: string, value: Point) =>
        properties.push({
          label,
          value: `${n(value.x)}, ${n(value.y)} ${units}`,
        });
      if (isLineEntity(entity)) {
        const a = worldPoint(entity.vertices[0], entry),
          b = worldPoint(entity.vertices[1], entry),
          m = measureLine(a, b);
        length("Length (XY)", m.distance);
        length("ΔX", m.dx);
        length("ΔY", m.dy);
        properties.push({
          label: "Angle",
          value: m.angle === null ? "Undefined" : `${n(m.angle)}°`,
        });
        point("Start", a);
        point("End", b);
      } else if (isCircleEntity(entity) || isArcEntity(entity)) {
        const c = worldPoint(entity.center, entry);
        const x = worldPoint(
          {
            x: entity.center.x + entity.radius,
            y: entity.center.y,
            z: entity.center.z,
          },
          entry,
        ).sub(c);
        const y = worldPoint(
          {
            x: entity.center.x,
            y: entity.center.y + entity.radius,
            z: entity.center.z,
          },
          entry,
        ).sub(c);
        const radius = x.length();
        if (
          Math.abs(radius - y.length()) < Math.max(radius, 1) * 1e-8 &&
          Math.abs(x.dot(y)) < Math.max(radius * radius, 1) * 1e-8
        ) {
          length("Radius", radius);
          length("Diameter", radius * 2);
          if (isCircleEntity(entity))
            length("Circumference", 2 * Math.PI * radius);
          else {
            const sweep =
              (((entity.endAngle - entity.startAngle) % (Math.PI * 2)) +
                Math.PI * 2) %
              (Math.PI * 2);
            length("Arc length", sweep * radius);
            properties.push({
              label: "Sweep",
              value: `${n((sweep * 180) / Math.PI)}°`,
            });
          }
        } else
          properties.push({
            label: "Transform",
            value: "Nonuniform scale — elliptical geometry",
          });
        point("Centre", c);
      } else if (isPolylineEntity(entity)) {
        properties.push(
          { label: "Vertices", value: String(entity.vertices.length) },
          { label: "Closed", value: entity.shape ? "Yes" : "No" },
        );
        const lines = outline(entry).polylines;
        let total = 0;
        for (const line of lines)
          for (let i = 1; i < line.length; i++)
            total += line[i].distanceTo(line[i - 1]);
        length("Length (approx.)", total);
      } else if (isTextEntity(entity)) {
        properties.push({ label: "Content", value: String(entity.text ?? "") });
      } else if (isInsertEntity(entity))
        properties.push({ label: "Block", value: entity.name });
      else if (isEllipseEntity(entity)) {
        point("Centre", worldPoint(entity.center, entry));
        properties.push({
          label: "Axis ratio (source)",
          value: n(entity.axisRatio),
        });
      }
      length("Bounds width", entry.bbox.max.x - entry.bbox.min.x);
      length("Bounds height", entry.bbox.max.y - entry.bbox.min.y);
      properties.push({ label: "Source handle", value: entry.handle });
      return { id, type: entity.type, layer: entry.layer, properties };
    },
    select(ids: readonly string[]) {
      if (selection) {
        disposeGroup(selection);
        selection = null;
      }
      if (ids.length) selection = makeHighlight(ids, config.theme.selection);
      render();
    },
    hover(id: string | null) {
      if (hover) {
        disposeGroup(hover);
        hover = null;
      }
      if (id) hover = makeHighlight([id], config.theme.hover);
      render();
    },
    dispose() {
      disposed = true;
      abort.abort();
      observer.disconnect();
      controls.dispose();
      if (selection) disposeGroup(selection);
      if (hover) disposeGroup(hover);
      if (root) disposeGroup(root);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      outlines.clear();
    },
  };
}
export type DxfAdapter = ReturnType<typeof createDxfAdapter>;
