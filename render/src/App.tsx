import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, File, FilePlus2, FolderOpen, Hexagon, LayoutDashboard, LockKeyhole, PanelLeft, Upload, X } from "lucide-react";
import type { CadSource } from "./cad-viewer";
import FileBrowser from "./FileBrowser";
import { drawingUrl, flattenEntries, formatBytes, type RepositoryEntry } from "./repository";
import "./workspace.css";

const Viewer = lazy(() => import("./cad-viewer").then((module) => ({ default: module.CadViewer })));

function locationState() {
  const [page, search = ""] = window.location.hash.slice(1).split("?");
  return { page: page === "files" ? "files" : "dashboard", folder: new URLSearchParams(search).get("folder") || "datasets" };
}

export default function App() {
  const [route, setRoute] = useState(locationState);
  const [roots, setRoots] = useState<RepositoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [source, setSource] = useState<CadSource | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [browserVisible, setBrowserVisible] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const update = () => setRoute(locationState());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch("/api/repository", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Repository unavailable. Refresh to retry.");
      return response.json() as Promise<RepositoryEntry[]>;
    }).then(setRoots).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Repository unavailable.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  const navigate = (page: string, folder = route.folder) => {
    window.location.hash = page === "files" ? `files?folder=${encodeURIComponent(folder)}` : "dashboard";
  };
  const browse = (folder = route.folder) => {
    setBrowserVisible(true);
    navigate("files", folder);
  };
  const openFile = (file?: File) => {
    if (!file) return;
    if (!/\.dxf$/i.test(file.name)) { setNotice("Please choose a DXF file."); return; }
    if (file.size > 50 * 1024 * 1024) { setNotice("DXF exceeds the viewer's 50 MB limit."); return; }
    setNotice("");
    setSelectedPath(null);
    setSource({ kind: "blob", blob: file, name: file.name });
    navigate("files");
  };
  const openDrawing = (entry: RepositoryEntry) => {
    setNotice("");
    setSelectedPath(entry.path);
    setSource({ kind: "url", url: drawingUrl(entry.path), name: entry.name });
    navigate("files");
  };
  const allFiles = flattenEntries(roots).filter((entry) => entry.kind === "file");

  return <div className="app-shell workspace-shell" onDragOver={(event) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault(); setDragging(true);
  }} onDragLeave={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
  }} onDrop={(event) => {
    event.preventDefault(); setDragging(false); openFile(event.dataTransfer.files[0]);
  }}>
    <header className="app-header">
      <a className="brand" href="#dashboard" aria-label="Manufacturer DXF Cleaner dashboard"><span className="brand-icon"><Hexagon size={23} strokeWidth={1.8} /><i /></span><strong>Manufacturer<span>/</span><b>DXF Cleaner</b></strong></a>
      <nav className="page-navigation" aria-label="Pages"><button className={route.page === "dashboard" ? "active" : ""} aria-current={route.page === "dashboard" ? "page" : undefined} onClick={() => navigate("dashboard")}><LayoutDashboard size={16} /><span>Dashboard</span></button><button className={route.page === "files" ? "active" : ""} aria-current={route.page === "files" ? "page" : undefined} onClick={() => browse()}><FolderOpen size={16} /><span>File Browser</span></button></nav>
      <div className="header-right"><span><LockKeyhole size={13} /> Local</span></div>
    </header>
    <input ref={input} type="file" accept=".dxf" hidden aria-label="Open DXF file" onChange={(event) => { openFile(event.target.files?.[0]); event.target.value = ""; }} />
    {notice && <div className="notice workspace-notice" role="alert">{notice}<button title="Dismiss message" aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}
    {route.page === "dashboard" ? <main className="dashboard">
      <div className="dashboard-heading"><div><div className="breadcrumb">MANUFACTURER DXF CLEANER</div><h1>Dashboard</h1></div><button className="open-file" onClick={() => browse()}><FolderOpen size={17} /> File Browser <ArrowRight size={16} /></button></div>
      {error && <div className="notice" role="alert">{error}<button className="text-action" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>}
      <section className="repository-overview" aria-label="Repository overview">{["datasets", "results"].map((path) => {
        const root = roots.find((entry) => entry.path === path);
        const files = flattenEntries(root?.children ?? []).filter((entry) => entry.kind === "file");
        return <button className="root-shortcut" key={path} onClick={() => browse(path)}><span className={`root-icon ${path}`}><FolderOpen size={27} /></span><span><strong>{path === "datasets" ? "Datasets" : "Results"}</strong><small>{root?.unavailable ? "Folder unavailable" : loading ? "Loading..." : `${files.length} DXF files`}</small></span><ArrowUpRight size={19} /></button>;
      })}</section>
      <section className="dashboard-files"><div className="section-heading"><h2>Drawings</h2><span>{loading ? "Loading..." : `${allFiles.length} total`}</span></div>{!loading && !error && allFiles.length === 0 && <div className="browser-empty"><FolderOpen size={28} /><p>No repository drawings</p></div>}<div className="drawing-table">{allFiles.slice(0, 8).map((entry) => <button key={entry.path} onClick={() => openDrawing(entry)}><File size={19} /><span><strong>{entry.name}</strong><small>{entry.path.slice(0, entry.path.lastIndexOf("/"))}</small></span><small>{formatBytes(entry.size)}</small><ArrowRight size={15} /></button>)}</div></section>
    </main> : <div className={`repository-workbench ${browserVisible ? "" : "browser-hidden"}`}>
      {browserVisible && <FileBrowser roots={roots} folder={route.folder} selected={selectedPath} loading={loading} error={error} onNavigate={(folder) => navigate("files", folder)} onOpen={openDrawing} onRefresh={() => setRevision((value) => value + 1)} />}
      <main className="viewer-pane"><div className="document-heading"><button className="icon-button browser-toggle" title={browserVisible ? "Hide file browser" : "Show file browser"} aria-label={browserVisible ? "Hide file browser" : "Show file browser"} aria-expanded={browserVisible} onClick={() => setBrowserVisible((value) => !value)}><PanelLeft size={18} /></button><div className="document-title"><div className="breadcrumb">{selectedPath ? selectedPath.slice(0, selectedPath.lastIndexOf("/")) : source?.kind === "blob" ? "Local files" : source ? "Sample drawings" : "Repository"}</div><h1 title={source?.name}>{source?.name ?? "Drawing bench"}{source && <span>DXF</span>}</h1></div></div>
        {source ? <Suspense fallback={<div className="initial-loading">Opening drawing...</div>}><Viewer source={source} /></Suspense> : <div className="viewer-empty"><File size={42} strokeWidth={1} /><h2>No drawing selected</h2><button className="text-action" onClick={() => input.current?.click()}><FilePlus2 size={16} /> Open DXF</button></div>}
        <footer className="app-footer"><span>CAD LAB / 0.1</span><span>DXF-KIT</span></footer>
      </main>
    </div>}
    {dragging && <div className="drop-curtain"><Upload size={36} /><strong>Drop your DXF here</strong><span>Local file</span></div>}
  </div>;
}
