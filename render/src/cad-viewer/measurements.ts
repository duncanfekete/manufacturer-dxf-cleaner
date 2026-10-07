import type { Point } from "./types";
export function measureLine(a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  return {
    distance,
    dx,
    dy,
    angle: distance === 0 ? null : (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}
export function measureBox(a: Point, b: Point) {
  const width = Math.abs(b.x - a.x),
    height = Math.abs(b.y - a.y);
  return {
    width,
    height,
    diagonal: Math.hypot(width, height),
    area: width * height,
  };
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const square = dx * dx + dy * dy;
  const t = square
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function formatNumber(value: number) {
  return value.toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
