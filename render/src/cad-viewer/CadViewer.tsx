import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { createDxfAdapter, type DxfAdapter } from "./dxf-adapter";
import {
  CadError,
  type CadViewerProps,
  type CadDocument,
  type CadEntity,
  type Measurement,
  type Point,
  type SnapHit,
  type Tool,
  DEFAULT_CAD_CONFIG,
} from "./types";
import { Toolbar, Panels } from "./controls";
import { MeasurementOverlay } from "./MeasurementOverlay";
import { formatNumber as n, measureLine, measureBox } from "./measurements";
import { updateEntitySelection } from "./selection";

export function CadViewer(props: CadViewerProps) {
  const config = useMemo(
    () => ({
      ...DEFAULT_CAD_CONFIG,
      ...props.config,
      tools: { ...DEFAULT_CAD_CONFIG.tools, ...props.config?.tools },
      theme: { ...DEFAULT_CAD_CONFIG.theme, ...props.config?.theme },
    }),
    [props.config],
  );
  const host = useRef<HTMLDivElement>(null),
    adapter = useRef<DxfAdapter | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [document, setDocument] = useState<CadDocument | null>(null);
  const [phase, setPhase] = useState("Reading drawing…"),
    [error, setError] = useState<CadError | null>(null);
  const [tool, setTool] = useState<Tool>(config.initialTool),
    [snapEnabled, setSnapEnabled] = useState(config.initialSnapEnabled);
  const [entities, setEntities] = useState<CadEntity[]>([]),
    [hidden, setHidden] = useState(new Set<string>());
  const [measurements, setMeasurements] = useState<Measurement[]>([]),
    [anchor, setAnchor] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null),
    [snap, setSnap] = useState<SnapHit | null>(null);
  const [selectedMeasurement, setSelectedMeasurement] = useState<string | null>(
    null,
  );
  const [tab, setTab] = useState<"inspect" | "layers">("inspect");
  const [, repaint] = useState(0),
    [retry, setRetry] = useState(0);
  const pointerDown = useRef<{ x: number; y: number; button: number } | null>(
    null,
  );
  const space = useRef(false),
    frame = useRef(0);

  useEffect(() => {
    let alive = true;
    setDocument(null);
    setError(null);
    setEntities([]);
    setMeasurements([]);
    setHidden(new Set());
    setAnchor(null);
    setCursor(null);
    setSnap(null);
    setSelectedMeasurement(null);
    setTool(config.initialTool);
    setSnapEnabled(config.initialSnapEnabled);
    callbacks.current.onEntitySelect?.(null);
    let current: DxfAdapter | null = null;
    const fail = (cause: unknown) => {
      if (!alive) return;
      const next =
        cause instanceof CadError
          ? cause
          : new CadError(
              "render",
              cause instanceof Error
                ? cause.message
                : "The drawing could not be rendered.",
            );
      setError(next);
      setPhase("");
      callbacks.current.onError?.(next);
    };
    try {
      current = createDxfAdapter(
        host.current!,
        {
          phase: (p) => alive && setPhase(p),
          frame: () => {
            cancelAnimationFrame(frame.current);
            frame.current = requestAnimationFrame(
              () => alive && repaint((v) => v + 1),
            );
          },
        },
        {
          theme: config.theme,
          maxFileBytes: config.maxFileBytes,
          pickRadiusPx: config.pickRadiusPx,
        },
      );
      adapter.current = current;
      current
        .load(props.source)
        .then((doc) => {
          if (alive && doc) {
            setDocument(doc);
            setPhase("");
            callbacks.current.onLoad?.(doc);
          }
        })
        .catch(fail);
    } catch (cause) {
      fail(cause);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(frame.current);
      current?.dispose();
      adapter.current = null;
    };
  }, [props.source, retry, config]);

  const chooseTool = (next: Tool) => {
    setTool(next);
    setAnchor(null);
    setSnap(null);
    adapter.current?.setTool(next);
  };
  const commitSelection = (next: CadEntity[]) => {
    setEntities(next);
    adapter.current?.select(next.map((entity) => entity.id));
    callbacks.current.onSelectionChange?.(next);
    callbacks.current.onEntitySelect?.(next.at(-1) ?? null);
    if (next.length) {
      setSelectedMeasurement(null);
      setTab("inspect");
    }
  };
  const selectEntity = (next: CadEntity | null, additive = false) => {
    commitSelection(
      updateEntitySelection(entities, next, additive, config.enableMultiSelect),
    );
  };
  const selectMeasurement = (id: string) => {
    setSelectedMeasurement(id);
    selectEntity(null);
    setTab("inspect");
  };
  const removeMeasurement = (id: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
    if (selectedMeasurement === id) setSelectedMeasurement(null);
  };
  const changeLayers = (next: Set<string>) => {
    setHidden(next);
    adapter.current?.setLayers(next);
    if (entities.some((entity) => next.has(entity.layer)))
      commitSelection(entities.filter((entity) => !next.has(entity.layer)));
    setSnap(null);
  };
  const pointer = (clientX: number, clientY: number) => {
    const rect = host.current!.getBoundingClientRect();
    const p = adapter.current!.modelAt(clientX - rect.left, clientY - rect.top);
    const hit =
      snapEnabled && (tool === "line" || tool === "box")
        ? adapter.current!.snap(p, config.snapRadiusPx)
        : null;
    return { point: hit?.point ?? p, hit };
  };
  const unit = document?.units ?? "drawing units";
  const draft: Measurement | null =
    anchor && cursor && (tool === "line" || tool === "box")
      ? { id: "draft", kind: tool, start: anchor, end: cursor }
      : null;

  return (
    <section
      className="cad-viewer"
      style={
        {
          "--cad-measurement": config.theme.measurement,
          "--cad-snap": config.theme.snap,
        } as CSSProperties
      }
      tabIndex={0}
      aria-label="CAD viewer"
      onKeyDown={(e) => {
        if (
          (e.target as HTMLElement).matches("input, textarea, select") ||
          e.metaKey ||
          e.ctrlKey ||
          e.altKey
        )
          return;
        if (e.code === "Space") {
          e.preventDefault();
          space.current = true;
          adapter.current?.panTemporarily(true);
        }
        const key = e.key.toLowerCase();
        if (key === "escape") {
          setAnchor(null);
          setSnap(null);
          setSelectedMeasurement(null);
          selectEntity(null);
        }
        if (key === "v" && config.tools.select) chooseTool("select");
        if (key === "h" && config.tools.pan) chooseTool("pan");
        if (key === "m" && config.tools.lineMeasure) chooseTool("line");
        if (key === "b" && config.tools.boxMeasure) chooseTool("box");
        if (key === "f" && config.tools.fit) adapter.current?.fit();
        if (key === "delete" || key === "backspace") {
          if (selectedMeasurement) {
            e.preventDefault();
            removeMeasurement(selectedMeasurement);
          }
        }
      }}
      onKeyUp={(e) => {
        if (e.code === "Space") {
          space.current = false;
          adapter.current?.setTool(tool);
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          space.current = false;
          adapter.current?.setTool(tool);
        }
      }}
    >
      <div className="drawing-column">
        <Toolbar
          tool={tool}
          setTool={chooseTool}
          snap={snapEnabled}
          setSnap={(v) => {
            setSnapEnabled(v);
            setSnap(null);
          }}
          fit={() => adapter.current?.fit()}
          zoom={(f) => adapter.current?.zoom(f)}
          disabled={!document}
          tools={config.tools}
        />
        <div
          className={`drawing-stage tool-${tool}`}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDownCapture={(e) => {
            if (e.button === 1) adapter.current?.panTemporarily(true);
          }}
          onPointerDown={(e) => {
            e.currentTarget
              .closest<HTMLElement>(".cad-viewer")
              ?.focus({ preventScroll: true });
            pointerDown.current = {
              x: e.clientX,
              y: e.clientY,
              button: e.button,
            };
            if (e.button === 1) adapter.current?.panTemporarily(true);
          }}
          onPointerMove={(e) => {
            if (!document || !adapter.current) return;
            const result = pointer(e.clientX, e.clientY);
            setCursor(result.point);
            setSnap(result.hit);
            if (
              tool === "select" &&
              config.enableHoverHighlight &&
              !pointerDown.current
            ) {
              const hovered = adapter.current.pick(result.point);
              adapter.current.hover(
                hovered && !entities.some((entity) => entity.id === hovered.id)
                  ? hovered.id
                  : null,
              );
              callbacks.current.onEntityHover?.(hovered);
            } else adapter.current.hover(null);
          }}
          onPointerLeave={() => {
            setSnap(null);
            adapter.current?.hover(null);
            callbacks.current.onEntityHover?.(null);
            pointerDown.current = null;
            adapter.current?.setTool(tool);
          }}
          onPointerUp={(e) => {
            const down = pointerDown.current;
            pointerDown.current = null;
            adapter.current?.setTool(tool);
            if (
              !down ||
              !document ||
              !adapter.current ||
              down.button !== 0 ||
              space.current ||
              Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4
            )
              return;
            const { point } = pointer(e.clientX, e.clientY);
            if (tool === "select") {
              setSelectedMeasurement(null);
              const next = adapter.current.pick(point);
              selectEntity(next, Boolean((e.metaKey || e.shiftKey) && next));
              adapter.current.hover(null);
            }
            if (tool === "line" || tool === "box") {
              if (!anchor) setAnchor(point);
              else {
                const measurement: Measurement = {
                  id: crypto.randomUUID(),
                  kind: tool,
                  start: anchor,
                  end: point,
                };
                setMeasurements((prev) => [...prev, measurement]);
                setAnchor(null);
                setSelectedMeasurement(measurement.id);
                setTab("inspect");
                callbacks.current.onMeasurementCreate?.(measurement);
              }
            }
          }}
        >
          <div ref={host} className="webgl-host" />
          {document && (
            <>
              <div className="viewport-caption">
                <span>MODEL SPACE</span>
                <small>2D / TOP VIEW</small>
              </div>
              <div className="axis-marker">
                <span className="axis-y">Y</span>
                <span className="axis-x">X</span>
                <i />
              </div>
              <MeasurementOverlay
                measurements={measurements}
                draft={draft}
                project={(p) => adapter.current?.project(p) ?? p}
                units={unit}
                snap={snap}
                selected={selectedMeasurement}
                onSelect={selectMeasurement}
                interactive={tool === "select"}
              />
              <div className="canvas-hint">
                {tool === "line" || tool === "box" ? (
                  <>
                    <span className="live-dot" />
                    {anchor
                      ? "Choose the second point"
                      : tool === "box"
                        ? "Choose the first corner"
                        : "Choose the first point"}
                    <kbd>ESC</kbd> cancel
                  </>
                ) : (
                  <>
                    {tool === "select" && config.enableMultiSelect ? (
                      <><kbd>⌘ / ⇧</kbd> multi-select <span>·</span></>
                    ) : null}
                    Drag to pan <span>·</span> Scroll to zoom <span>·</span>{" "}
                    <kbd>F</kbd> fit
                  </>
                )}
              </div>
              {draft && (
                <div className="live-readout">
                  {draft.kind === "line"
                    ? (() => {
                        const m = measureLine(draft.start, draft.end);
                        return (
                          <>
                            <strong>
                              {n(m.distance)} {unit}
                            </strong>
                            <span>
                              ΔX {n(m.dx)} · ΔY {n(m.dy)} {unit} ·{" "}
                              {m.angle === null ? "—" : n(m.angle) + "°"}
                            </span>
                          </>
                        );
                      })()
                    : (() => {
                        const m = measureBox(draft.start, draft.end);
                        return (
                          <>
                            <strong>
                              {n(m.width)} × {n(m.height)} {unit}
                            </strong>
                            <span>
                              Diagonal {n(m.diagonal)} {unit}
                            </span>
                          </>
                        );
                      })()}
                </div>
              )}
            </>
          )}
          {phase && !error && (
            <div className="loading-state">
              <LoaderCircle className="spin" size={25} />
              <strong>{phase}</strong>
              <span>Your drawing stays in your browser.</span>
            </div>
          )}
          {error && (
            <div className="loading-state error-state">
              <AlertCircle size={28} />
              <strong>Couldn’t open this drawing</strong>
              <span>{error.message}</span>
              <button onClick={() => setRetry((v) => v + 1)}>Try again</button>
            </div>
          )}
        </div>
        <div className="status-bar">
          <span>
            <i className={document ? "green-dot" : "muted-dot"} />
            {document ? "Ready" : error ? "Error" : "Loading"}
          </span>
          <span>{document?.entityCount ?? "—"} entities</span>
          <span>Units: {unit === "drawing units" ? "Unknown" : unit}</span>
          <span className="coordinates">
            X {cursor ? n(cursor.x) : "—"} <b>/</b> Y{" "}
            {cursor ? n(cursor.y) : "—"} <small>{unit}</small>
          </span>
        </div>
      </div>
      <Panels
        document={document}
        entities={entities}
        hidden={hidden}
        setHidden={changeLayers}
        measurements={measurements}
        selectedMeasurement={selectedMeasurement}
        selectMeasurement={selectMeasurement}
        removeMeasurement={removeMeasurement}
        clearMeasurements={() => {
          setMeasurements([]);
          setSelectedMeasurement(null);
        }}
        clearEntity={() => selectEntity(null)}
        showLayers={config.tools.layers}
        tab={tab}
        setTab={setTab}
      />
    </section>
  );
}
