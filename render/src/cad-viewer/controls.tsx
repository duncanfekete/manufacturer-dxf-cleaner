import {
  MousePointer2,
  Hand,
  Ruler,
  Scan,
  Maximize,
  Plus,
  Minus,
  Magnet,
  Trash2,
  Layers,
  SlidersHorizontal,
  X,
  Eye,
} from "lucide-react";
import type {
  CadDocument,
  CadEntity,
  Measurement,
  Tool,
  CadToolConfig,
} from "./types";
import { measureLine, measureBox, formatNumber as n } from "./measurements";

export function Toolbar({
  tool,
  setTool,
  snap,
  setSnap,
  fit,
  zoom,
  disabled,
  tools,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  snap: boolean;
  setSnap: (v: boolean) => void;
  fit: () => void;
  zoom: (f: number) => void;
  disabled: boolean;
  tools: CadToolConfig;
}) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <div className="tool-group">
        {(
          [
            ["select", MousePointer2, "Select", "V", tools.select],
            ["pan", Hand, "Pan", "H", tools.pan],
            ["line", Ruler, "Line ruler", "M", tools.lineMeasure],
            ["box", Scan, "Box ruler", "B", tools.boxMeasure],
          ] as const
        )
          .filter((item) => item[4])
          .map(([id, Icon, label, key]) => (
            <button
              key={id}
              disabled={disabled}
              className={tool === id ? "tool active" : "tool"}
              onClick={() => setTool(id)}
              aria-pressed={tool === id}
              title={`${label} (${key})`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
      </div>
      {tools.snap && (
        <div className="tool-group">
          <button
            className={snap ? "tool snap active" : "tool"}
            aria-pressed={snap}
            onClick={() => setSnap(!snap)}
            title="Snap to geometry"
          >
            <Magnet size={16} />
            <span>Snap</span>
          </button>
        </div>
      )}
      {(tools.zoom || tools.fit) && (
        <div className="tool-group zoom-tools">
          {tools.zoom && (
            <>
              <button
                className="tool"
                disabled={disabled}
                onClick={() => zoom(1 / 1.3)}
                title="Zoom out"
                aria-label="Zoom out"
              >
                <Minus size={16} />
              </button>
              <button
                className="tool"
                disabled={disabled}
                onClick={() => zoom(1.3)}
                title="Zoom in"
                aria-label="Zoom in"
              >
                <Plus size={16} />
              </button>
            </>
          )}
          {tools.fit && (
            <button
              className="tool"
              disabled={disabled}
              onClick={fit}
              title="Fit drawing (F)"
            >
              <Maximize size={16} />
              <span>Fit</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Panels({
  document,
  entities,
  hidden,
  setHidden,
  measurements,
  selectedMeasurement,
  selectMeasurement,
  removeMeasurement,
  clearMeasurements,
  clearEntity,
  tab,
  setTab,
  showLayers,
}: {
  document: CadDocument | null;
  entities: readonly CadEntity[];
  hidden: ReadonlySet<string>;
  setHidden: (s: Set<string>) => void;
  measurements: readonly Measurement[];
  selectedMeasurement: string | null;
  selectMeasurement: (id: string) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;
  clearEntity: () => void;
  tab: "inspect" | "layers";
  setTab: (t: "inspect" | "layers") => void;
  showLayers: boolean;
}) {
  const entity = entities.at(-1) ?? null;
  return (
    <aside className="inspector">
      <div className="panel-tabs">
        <button
          className={tab === "inspect" ? "current" : ""}
          onClick={() => setTab("inspect")}
        >
          <SlidersHorizontal size={15} />
          Inspector
        </button>
        {showLayers && (
          <button
            className={tab === "layers" ? "current" : ""}
            onClick={() => setTab("layers")}
          >
            <Layers size={15} />
            Layers <small>{document?.layers.length ?? 0}</small>
          </button>
        )}
      </div>
      <div className="panel-scroll">
        {tab === "inspect" ? (
          <>
            <div className="section-title">
              {entities.length > 1
                ? `${entities.length} ENTITIES SELECTED`
                : "ENTITY PROPERTIES"}{" "}
              {entity && (
                <button
                  onClick={clearEntity}
                  aria-label="Clear entity selection"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {entities.length > 1 ? (
              <div className="multi-selection-list">
                {entities.map((selected) => (
                  <div key={selected.id}>
                    <span>{selected.type}</span>
                    <small>{selected.layer}</small>
                  </div>
                ))}
                <p>Cmd/Shift-click selected geometry to remove it.</p>
              </div>
            ) : entity ? (
              <>
                <div className="entity-heading">
                  <span className="entity-symbol">
                    {entity.type === "CIRCLE"
                      ? "○"
                      : entity.type === "ARC"
                        ? "◜"
                        : "⌁"}
                  </span>
                  <div>
                    <strong>{entity.type}</strong>
                    <p>Layer: {entity.layer}</p>
                  </div>
                </div>
                <dl className="properties">
                  {entity.properties.map((p, i) => (
                    <div key={i}>
                      <dt>{p.label}</dt>
                      <dd>{p.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <div className="empty-inspector">
                <MousePointer2 size={27} strokeWidth={1.3} />
                <strong>A closer look</strong>
                <p>
                  Select an entity to inspect its
                  <br />
                  geometry and dimensions.
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="section-title">
              DRAWING LAYERS{" "}
              <button
                onClick={() =>
                  setHidden(
                    hidden.size
                      ? new Set()
                      : new Set(document?.layers.map((l) => l.id)),
                  )
                }
              >
                {hidden.size ? "Show all" : "Hide all"}
              </button>
            </div>
            <div className="layer-list">
              {document?.layers.map((layer) => (
                <div className="layer-row" key={layer.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!hidden.has(layer.id)}
                      onChange={() => {
                        const next = new Set(hidden);
                        next.has(layer.id)
                          ? next.delete(layer.id)
                          : next.add(layer.id);
                        setHidden(next);
                      }}
                    />
                    <span
                      className="layer-swatch"
                      style={{ background: layer.color }}
                    />
                    <span>{layer.id}</span>
                    <small>{layer.count}</small>
                  </label>
                  <button
                    aria-label={`Isolate ${layer.id}`}
                    title="Isolate layer"
                    onClick={() =>
                      setHidden(
                        new Set(
                          document.layers
                            .filter((l) => l.id !== layer.id)
                            .map((l) => l.id),
                        ),
                      )
                    }
                  >
                    <Eye size={14} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="measurement-section">
          <div className="section-title">
            MEASUREMENTS{" "}
            <span>{measurements.length.toString().padStart(2, "0")}</span>
            {measurements.length > 0 && (
              <button onClick={clearMeasurements}>Clear all</button>
            )}
          </div>
          {measurements.length === 0 ? (
            <div className="measurement-empty">
              <Ruler size={20} />
              <p>
                Two points. Exact distance.
                <br />
                <span>Choose a ruler to get started.</span>
              </p>
            </div>
          ) : (
            measurements.map((m, i) => {
              const line = measureLine(m.start, m.end),
                box = measureBox(m.start, m.end),
                unit = document?.units ?? "drawing units";
              return (
                <div
                  className={
                    selectedMeasurement === m.id
                      ? "measurement-card chosen"
                      : "measurement-card"
                  }
                  key={m.id}
                >
                  <button
                    className="measurement-card-main"
                    onClick={() => selectMeasurement(m.id)}
                  >
                    <span className="measurement-title">
                      {m.kind === "line" ? (
                        <Ruler size={14} />
                      ) : (
                        <Scan size={14} />
                      )}{" "}
                      {m.kind === "line" ? "Distance" : "Rectangle"}{" "}
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <strong>
                      {m.kind === "line"
                        ? n(line.distance)
                        : `${n(box.width)} × ${n(box.height)}`}{" "}
                      <small>{unit}</small>
                    </strong>
                    <span className="measurement-details">
                      {m.kind === "line"
                        ? `ΔX ${n(line.dx)} ${unit} · ΔY ${n(line.dy)} ${unit}`
                        : `Diagonal ${n(box.diagonal)} ${unit}`}
                    </span>
                    <span className="measurement-details">
                      {m.kind === "line"
                        ? `Angle ${line.angle === null ? "undefined" : n(line.angle) + "°"}`
                        : `Area ${n(box.area)} ${unit}²`}
                    </span>
                  </button>
                  <button
                    className="delete-measurement"
                    aria-label={`Delete measurement ${i + 1}`}
                    onClick={() => removeMeasurement(m.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
        {document?.warnings.length ? (
          <div className="warnings">
            <strong>Drawing notes</strong>
            {document.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        ) : null}
      </div>
      <div className="panel-foot">
        <span className="green-dot" /> Processed locally in your browser
      </div>
    </aside>
  );
}
