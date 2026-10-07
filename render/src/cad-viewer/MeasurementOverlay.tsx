import type { Measurement, Point, SnapHit } from "./types";
import { formatNumber as n, measureLine, measureBox } from "./measurements";

export function MeasurementOverlay({
  measurements,
  draft,
  project,
  units,
  snap,
  selected,
  onSelect,
  interactive,
}: {
  measurements: readonly Measurement[];
  draft: Measurement | null;
  project: (point: Point) => Point;
  units: string;
  snap: SnapHit | null;
  selected: string | null;
  onSelect: (id: string) => void;
  interactive: boolean;
}) {
  return (
    <svg
      className={`measurement-overlay ${interactive ? "" : "noninteractive"}`}
      aria-label="Measurement overlays"
    >
      {[...measurements, ...(draft ? [draft] : [])].map((m) => {
        const a = project(m.start),
          b = project(m.end),
          box = measureBox(m.start, m.end);
        const label =
          m.kind === "line"
            ? `${n(measureLine(m.start, m.end).distance)} ${units}`
            : `${n(box.width)} × ${n(box.height)} ${units}`;
        const x = Math.min(a.x, b.x),
          y = Math.min(a.y, b.y);
        const labelX = (a.x + b.x) / 2,
          labelY = m.kind === "box" ? y - 13 : (a.y + b.y) / 2 - 14;
        return (
          <g
            key={m.id}
            className={
              selected === m.id ? "measurement selected" : "measurement"
            }
            data-measurement={m.id}
            onPointerDown={(e) => {
              if (m.id !== "draft") {
                e.stopPropagation();
                onSelect(m.id);
              }
            }}
          >
            {m.kind === "line" ? (
              <>
                <line
                  className="measure-hit"
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
              </>
            ) : (
              <rect
                x={x}
                y={y}
                width={Math.abs(b.x - a.x)}
                height={Math.abs(b.y - a.y)}
                className="measure-box"
              />
            )}
            <circle cx={a.x} cy={a.y} r="3.5" />
            <circle cx={b.x} cy={b.y} r="3.5" />
            <rect
              className="measure-label-bg"
              x={labelX - label.length * 3.5 - 9}
              y={labelY - 13}
              width={label.length * 7 + 18}
              height="24"
              rx="5"
            />
            <text x={labelX} y={labelY + 3} textAnchor="middle">
              {label}
            </text>
          </g>
        );
      })}
      {snap &&
        (() => {
          const p = project(snap.point);
          return (
            <g className="snap-marker">
              <rect x={p.x - 6} y={p.y - 6} width="12" height="12" />
              <text x={p.x + 13} y={p.y - 12}>
                {snap.kind}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}
