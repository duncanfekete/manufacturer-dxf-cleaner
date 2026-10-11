import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { readRepository, resolveDrawing, repositoryMiddleware } from "./repository.mjs";

let root;
let server;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dxf-browser-"));
  await mkdir(join(root, "datasets/nested/deeper"), { recursive: true });
  await writeFile(join(root, "datasets/nested/deeper/part.DXF"), "0\nEOF\n");
  await writeFile(join(root, "datasets/manifest.csv"), "ignored");
  await writeFile(join(root, "secret.dxf"), "private");
  await symlink(join(root, "secret.dxf"), join(root, "datasets/escape.dxf"));
});
afterEach(async () => {
  if (server) await new Promise((done) => server.close(done));
  server = undefined;
  await rm(root, { recursive: true, force: true });
});
describe("repository browsing", () => {
  it("preserves nesting and empty folders, filters non-DXF files and symlinks, and tolerates missing roots", async () => {
    await mkdir(join(root, "datasets/empty"));
    const tree = await readRepository(root);
    expect(tree[0].children.map((entry) => entry.name)).toEqual(["empty", "nested"]);
    expect(tree[0].children[0].children).toEqual([]);
    expect(tree[0].children[1].children[0].children[0]).toMatchObject({ path: "datasets/nested/deeper/part.DXF", kind: "file", size: 6 });
    expect(tree[1]).toMatchObject({ path: "results", children: [], unavailable: true });
  });
  it("resolves DXFs and refuses traversal, unrelated roots, non-DXFs, and escaped symlinks", async () => {
    expect(await resolveDrawing(root, "datasets/nested/deeper/part.DXF")).toMatchObject({ size: 6 });
    for (const path of ["datasets/../secret.dxf", "secret.dxf", "datasets/manifest.csv", "datasets/escape.dxf", "datasets/..\\secret.dxf", "datasets//part.dxf"]) {
      await expect(resolveDrawing(root, path)).rejects.toMatchObject({ status: 403 });
    }
  });
  it("serves listings and DXF bytes, with read-only and same-origin restrictions", async () => {
    server = createServer(repositoryMiddleware(root));
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${server.address().port}`;
    expect((await (await fetch(`${url}/api/repository`)).json()).length).toBe(2);
    expect(await (await fetch(`${url}/api/dxf?path=datasets/nested/deeper/part.DXF`)).text()).toBe("0\nEOF\n");
    expect((await fetch(`${url}/api/dxf?path=datasets/nope.dxf`)).status).toBe(404);
    expect((await fetch(`${url}/api/repository`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${url}/api/repository`, { headers: { Origin: "https://untrusted.example" } })).status).toBe(403);
  });
});