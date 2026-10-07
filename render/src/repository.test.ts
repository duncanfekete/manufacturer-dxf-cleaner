import { describe, expect, it } from "vitest";
import { drawingUrl, flattenEntries, folderEntries, formatBytes, type RepositoryEntry } from "./repository";

const folder: RepositoryEntry = {
  name: "datasets", path: "datasets", kind: "directory", size: null, modified: null,
  children: [
    { name: "part10.dxf", path: "datasets/part10.dxf", kind: "file", size: 400, modified: "2026-10-01" },
    { name: "part2.dxf", path: "datasets/part2.dxf", kind: "file", size: 800, modified: "2026-10-02" },
    { name: "nested", path: "datasets/nested", kind: "directory", size: null, modified: null,
      children: [{ name: "bracket.dxf", path: "datasets/nested/bracket.dxf", kind: "file", size: 200, modified: null }] },
  ],
};

describe("file browser", () => {
  it("lists immediate children with directories first and numeric filename sorting", () => {
    expect(folderEntries(folder, "", "name").map((entry) => entry.name)).toEqual(["nested", "part2.dxf", "part10.dxf"]);
    expect(folderEntries(folder, "", "name-desc").map((entry) => entry.name)).toEqual(["nested", "part10.dxf", "part2.dxf"]);
  });
  it("searches descendants case-insensitively and supports size/date sorting", () => {
    expect(folderEntries(folder, " BRACKET ", "name")[0].path).toBe("datasets/nested/bracket.dxf");
    expect(folderEntries(folder, "", "size")[1].name).toBe("part2.dxf");
    expect(folderEntries(folder, "", "modified")[1].name).toBe("part2.dxf");
    expect(flattenEntries([folder]).filter((entry) => entry.kind === "file")).toHaveLength(3);
  });
  it("formats metadata and encodes filenames safely", () => {
    expect(formatBytes(null)).toBe("-");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(drawingUrl("datasets/a #&?.dxf")).toBe("/api/dxf?path=datasets%2Fa%20%23%26%3F.dxf");
  });
});