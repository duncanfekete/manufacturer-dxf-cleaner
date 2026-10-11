import { describe, expect, it } from "vitest";
import { updateEntitySelection } from "./selection";
import type { CadEntity } from "./types";

const entity = (id: string): CadEntity => ({
  id,
  type: "LINE",
  layer: "CUT",
  properties: [],
});

describe("entity selection", () => {
  it("replaces selection on an ordinary click", () => {
    expect(
      updateEntitySelection([entity("a")], entity("b"), false, true).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
  });
  it("adds and removes membership on modifier clicks", () => {
    const selected = updateEntitySelection(
      [entity("a")],
      entity("b"),
      true,
      true,
    );
    expect(selected.map((item) => item.id)).toEqual(["a", "b"]);
    expect(
      updateEntitySelection(selected, entity("a"), true, true).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
  });
  it("clears on empty canvas and respects disabled multi-select", () => {
    expect(updateEntitySelection([entity("a")], null, true, true)).toEqual([]);
    expect(
      updateEntitySelection([entity("a")], entity("b"), true, false).map(
        (item) => item.id,
      ),
    ).toEqual(["b"]);
  });
});
