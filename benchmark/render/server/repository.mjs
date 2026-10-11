import { createReadStream } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const roots = ["datasets", "results"];
const maxBytes = 50 * 1024 * 1024;
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function inside(root, path) {
  const remainder = relative(root, path);
  return remainder === "" || (!remainder.startsWith(`..${sep}`) && remainder !== ".." && !isAbsolute(remainder));
}

async function directoryTree(repoRoot, path) {
  const absolute = resolve(repoRoot, path);
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) return null;
  const entry = {
    name: path.split("/").at(-1), path,
    kind: info.isDirectory() ? "directory" : "file",
    size: info.isFile() ? info.size : null,
    modified: info.mtime.toISOString(),
  };
  if (info.isDirectory()) {
    const names = await readdir(absolute, { withFileTypes: true });
    const children = await Promise.all(names
      .filter((item) => !item.isSymbolicLink() && (item.isDirectory() || (item.isFile() && /\.dxf$/i.test(item.name))))
      .map((item) => directoryTree(repoRoot, `${path}/${item.name}`)));
    entry.children = children.filter(Boolean).sort((first, second) =>
      (first.kind === second.kind ? 0 : first.kind === "directory" ? -1 : 1) || first.name.localeCompare(second.name, undefined, { numeric: true }));
  }
  return entry;
}

export async function readRepository(repoRoot = defaultRoot) {
  return Promise.all(roots.map(async (root) => {
    try {
      const entry = await directoryTree(repoRoot, root);
      if (!entry || entry.kind !== "directory") throw Object.assign(new Error("Unavailable root"), { code: "ENOENT" });
      return entry;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { name: root, path: root, kind: "directory", children: [], size: null, modified: null, unavailable: true };
    }
  }));
}

export async function resolveDrawing(repoRoot, path) {
  const parts = path.split("/");
  if (!roots.includes(parts[0]) || parts.some((part) => !part || part === "." || part === ".." || /[\\\0]/.test(part)) || !/\.dxf$/i.test(path)) {
    throw Object.assign(new Error("Only repository DXF files are accessible."), { status: 403 });
  }
  const allowedRoot = resolve(await realpath(repoRoot), parts[0]);
  const absolute = await realpath(resolve(repoRoot, path));
  if (!inside(allowedRoot, absolute)) throw Object.assign(new Error("Path is outside the repository root."), { status: 403 });
  const info = await lstat(absolute);
  if (!info.isFile()) throw Object.assign(new Error("Not a DXF file."), { status: 404 });
  if (info.size > maxBytes) throw Object.assign(new Error("DXF exceeds the viewer's 50 MB limit."), { status: 413 });
  return { absolute, size: info.size };
}

export function repositoryMiddleware(repoRoot = defaultRoot) {
  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/repository" && url.pathname !== "/api/dxf") return next();
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (request.headers["sec-fetch-site"] === "cross-site" || (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host)) {
        throw Object.assign(new Error("Cross-origin repository access is disabled."), { status: 403 });
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        response.setHeader("Allow", "GET, HEAD");
        throw Object.assign(new Error("Read-only endpoint."), { status: 405 });
      }
      if (url.pathname === "/api/repository") {
        const body = JSON.stringify(await readRepository(repoRoot));
        response.setHeader("Content-Type", "application/json");
        response.end(request.method === "HEAD" ? undefined : body);
      } else {
        const { absolute, size } = await resolveDrawing(repoRoot, url.searchParams.get("path") ?? "");
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Length", size);
        if (request.method === "HEAD") return response.end();
        const stream = createReadStream(absolute);
        request.on("close", () => stream.destroy());
        stream.on("error", () => response.destroy());
        stream.pipe(response);
      }
    } catch (error) {
      response.statusCode = error.status ?? (error.code === "ENOENT" ? 404 : 500);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: response.statusCode === 500 ? "Unable to read repository files." : response.statusCode === 404 ? "Drawing not found. Refresh the file browser." : error.message }));
    }
  };
}

export function repositoryPlugin() {
  return {
    name: "repository-dxf-browser",
    configureServer(server) { server.middlewares.use(repositoryMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use(repositoryMiddleware()); },
  };
}