import { describe, expect, it } from "vitest";
import { measureLine, measureBox, segmentDistance } from "./measurements";
describe("model-coordinate measurement", () => {
  it("returns signed deltas and a direction, with exact 3-4-5 distance", () => {
    const m = measureLine({ x: 2, y: 3 }, { x: -1, y: 7 });
    expect(m.distance).toBe(5);
    expect(m.dx).toBe(-3);
    expect(m.dy).toBe(4);
    expect(m.angle).toBeCloseTo(126.86989765);
  });
  it("does not invent an angle for a zero-length ruler", () => {
    expect(measureLine({ x: 2, y: 3 }, { x: 2, y: 3 }).angle).toBeNull();
  });
  it("preserves distance under translation, rotation, and point reversal", () => {
    for (let i = 1; i <= 30; i++) {
      const a = { x: i * 3.3, y: -i * 1.7 },
        b = { x: -i * 0.8, y: i * 6 };
      const distance = measureLine(a, b).distance;
      expect(measureLine(b, a).distance).toBeCloseTo(distance, 9);
      expect(
        measureLine(
          { x: a.x + 1e5, y: a.y - 1e5 },
          { x: b.x + 1e5, y: b.y - 1e5 },
        ).distance,
      ).toBeCloseTo(distance, 8);
      expect(
        measureLine({ x: -a.y, y: a.x }, { x: -b.y, y: b.x }).distance,
      ).toBeCloseTo(distance, 9);
    }
  });
  it("measures reversed box corners with nonnegative dimensions", () => {
    expect(measureBox({ x: 300, y: 180 }, { x: 0, y: 0 })).toEqual({
      width: 300,
      height: 180,
      diagonal: Math.hypot(300, 180),
      area: 54000,
    });
  });
  it("picks against bounded segments rather than infinite lines", () => {
    expect(
      segmentDistance({ x: 15, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }),
    ).toBe(5);
    expect(
      segmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }),
    ).toBe(3);
  });
});
