import { describe, it, expect } from "vitest";
import {
  parseDxf,
  buildPickingIndex,
  buildEntityIndex,
  getEntitySnapPoints,
  findSnapPoint,
} from "dxf-render";
const mountingPlate = [
  "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
  "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "2",
  "0", "LAYER", "2", "CUT", "70", "0", "0", "LAYER", "2", "HOLES", "70", "0",
  "0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "BLOCKS", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  ...[30, 270].flatMap((x) => [30, 150].map((y) => [
    "0", "CIRCLE", "8", "HOLES", "10", String(x), "20", String(y), "30", "0", "40", "9",
  ])).flat(),
  "0", "LINE", "8", "CUT", "10", "0", "20", "0", "11", "1", "21", "0",
  "0", "ENDSEC", "0", "EOF",
].join("\n");
const geometryStudy = [
  "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
  "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "2",
  "0", "LAYER", "2", "CUT", "70", "0", "0", "LAYER", "2", "HOLES", "70", "0",
  "0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "BLOCKS",
  "0", "BLOCK", "5", "B01", "8", "CUT", "2", "BRACKET", "70", "0",
  "10", "0", "20", "0", "30", "0", "3", "BRACKET", "1", "",
  "0", "CIRCLE", "5", "B02", "8", "HOLES", "10", "12", "20", "10", "30", "0", "40", "4",
  "0", "ENDBLK", "5", "B03", "8", "CUT", "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  ...[
    ["64", "5", "10", "1", "1", "0"],
    ["65", "95", "0", "1", "1", "30"],
    ["66", "190", "5", "0.8", "0.8", "0"],
  ].flatMap(([handle, x, y, scaleX, scaleY, rotation]) => [
    "0", "INSERT", "5", handle, "8", "CUT", "2", "BRACKET", "10", x, "20", y,
    "30", "0", "41", scaleX, "42", scaleY, "43", "1", "50", rotation,
  ]),
  "0", "ENDSEC", "0", "EOF",
].join("\n");
const fixture = (name: string) =>
  parseDxf(name === "mounting-plate" ? mountingPlate : geometryStudy);
describe("installed DXF engine contracts", () => {
  it("reads the sample unit metadata and known hole spacing", () => {
    const data = fixture("mounting-plate");
    expect(data.header?.$INSUNITS).toBe(4);
    const circles = data.entities.filter((e) => e.type === "CIRCLE");
    expect(circles).toHaveLength(4);
    const index = buildPickingIndex(data),
      entities = buildEntityIndex(data);
    const a = findSnapPoint(index, entities, { x: 30, y: 30 }, 1);
    const b = findSnapPoint(index, entities, { x: 270, y: 30 }, 1);
    expect(a?.point.x).toBeCloseTo(30);
    expect(b?.point.x).toBeCloseTo(270);
    expect(b!.point.x - a!.point.x).toBeCloseTo(240);
  });
  it("excludes hidden layers from snapping", () => {
    const data = fixture("mounting-plate");
    expect(
      findSnapPoint(
        buildPickingIndex(data),
        buildEntityIndex(data),
        { x: 30, y: 30 },
        1,
        { visibleLayers: new Set(["CUT"]) },
      ),
    ).toBeNull();
  });
  it("distinguishes repeated block instances and applies scale and rotation", () => {
    const data = fixture("geometry-study"),
      index = buildPickingIndex(data),
      entities = buildEntityIndex(data);
    const entries = index.entries.filter(
      (e) => e.type === "CIRCLE" && e.layer === "HOLES",
    );
    expect(entries).toHaveLength(3);
    expect(new Set(entries.map((e) => e.id)).size).toBe(3);
    const centres = entries.map(
      (e) =>
        getEntitySnapPoints(
          entities.get(e.handle)!,
          e.worldMatrix ?? null,
        ).find((p) => p.type === "center")!.point,
    );
    expect(centres[0].x).toBeCloseTo(17);
    expect(centres[0].y).toBeCloseTo(20);
    expect(centres[1].x).toBeCloseTo(
      95 + 12 * Math.cos(Math.PI / 6) - 10 * Math.sin(Math.PI / 6),
    );
    expect(centres[2].x).toBeCloseTo(199.6);
    expect(centres[2].y).toBeCloseTo(13);
  });
});
