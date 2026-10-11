import { useDeferredValue, useEffect, useState } from "react";
import { ArrowUp, ChevronDown, ChevronRight, File, Folder, FolderOpen, RefreshCw, Search, X } from "lucide-react";
import { folderEntries, formatBytes, type RepositoryEntry } from "./repository";

type Props = {
  roots: RepositoryEntry[];
  folder: string;
  selected: string | null;
  loading: boolean;
  error: string;
  onNavigate: (path: string) => void;
  onOpen: (entry: RepositoryEntry) => void;
  onRefresh: () => void;
};

export default function FileBrowser({ roots, folder, selected, loading, error, onNavigate, onOpen, onRefresh }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("name");
  const [expanded, setExpanded] = useState(new Set(["datasets", "results"]));
  const deferredQuery = useDeferredValue(query);
  useEffect(() => {
    setQuery("");
    const parts = folder.split("/");
    setExpanded((previous) => new Set([...previous, ...parts.map((_, index) => parts.slice(0, index + 1).join("/"))]));
  }, [folder]);
  const findFolder = (entries: RepositoryEntry[]): RepositoryEntry | undefined => {
    for (const entry of entries) {
      if (entry.path === folder) return entry;
      const nested = findFolder(entry.children ?? []);
      if (nested) return nested;
    }
  };
  const current = findFolder(roots);
  const entries = current ? folderEntries(current, deferredQuery, sort) : [];
  const parts = folder.split("/");
  const renderTree = (items: RepositoryEntry[], depth = 0): React.ReactNode => items.filter((entry) => entry.kind === "directory").map((entry) => {
    const hasFolders = entry.children?.some((child) => child.kind === "directory");
    const isExpanded = expanded.has(entry.path);
    return <div key={entry.path}>
      <div className={`folder-row ${entry.path === folder ? "current" : ""}`} style={{ paddingLeft: 8 + depth * 12 }}>
        <button className="tree-toggle" disabled={!hasFolders} aria-label={`${isExpanded ? "Collapse" : "Expand"} ${entry.name}`} aria-expanded={hasFolders ? isExpanded : undefined} title={`${isExpanded ? "Collapse" : "Expand"} ${entry.name}`} onClick={() => setExpanded((previous) => {
          const next = new Set(previous);
          if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path);
          return next;
        })}>{hasFolders ? isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : <span />}</button>
        <button className="folder-name" title={entry.path} aria-current={entry.path === folder ? "location" : undefined} onClick={() => onNavigate(entry.path)}>
          {entry.path === folder ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{entry.name}</span>
        </button>
      </div>
      {isExpanded && renderTree(entry.children ?? [], depth + 1)}
    </div>;
  });
  return <aside className="repository-browser" aria-label="File Browser">
    <div className="browser-heading"><h1>File Browser</h1><button className="icon-button" title="Refresh repository" aria-label="Refresh repository" disabled={loading} onClick={onRefresh}><RefreshCw size={17} className={loading ? "spinning" : ""} /></button></div>
    <div className="browser-search"><Search size={15} /><input aria-label="Search this folder and subfolders" placeholder="Search this folder" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button title="Clear search" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
    <div className="browser-content">
      <nav className="folder-tree" aria-label="Repository folders">{renderTree(roots)}</nav>
      <section className="folder-list" aria-label="Folder contents">
        <nav className="folder-breadcrumbs" aria-label="Folder breadcrumbs"><button className="icon-button" title="Parent folder" aria-label="Parent folder" disabled={parts.length < 2} onClick={() => onNavigate(parts.slice(0, -1).join("/"))}><ArrowUp size={14} /></button>{parts.map((part, index) => <span key={index}>{index > 0 && <ChevronRight size={11} />}<button title={parts.slice(0, index + 1).join("/")} onClick={() => onNavigate(parts.slice(0, index + 1).join("/"))}>{part}</button></span>)}</nav>
        <div className="list-toolbar"><span>{entries.length} {entries.length === 1 ? "item" : "items"}</span><select aria-label="Sort files" value={sort} onChange={(event) => setSort(event.target.value)}><option value="name">Name A-Z</option><option value="name-desc">Name Z-A</option><option value="modified">Newest first</option><option value="size">Largest first</option></select></div>
        <div className="file-list" aria-busy={loading}>
          {error ? <div className="browser-empty" role="alert"><p>{error}</p><button className="text-action" onClick={onRefresh}><RefreshCw size={14} /> Retry</button></div> : !current ? <div className="browser-empty"><FolderOpen size={24} /><p>{loading ? "Loading repository..." : "Folder no longer exists."}</p>{!loading && <button className="text-action" onClick={() => onNavigate("datasets")}>Datasets</button>}</div> : current.unavailable ? <div className="browser-empty"><FolderOpen size={24} /><p>Folder unavailable</p></div> : entries.length === 0 ? <div className="browser-empty"><FolderOpen size={24} /><p>{deferredQuery ? "No matching files or folders" : "No DXF files in this folder"}</p></div> : entries.map((entry) => <button key={entry.path} className={`file-row ${selected === entry.path ? "selected" : ""}`} title={entry.path} aria-pressed={entry.kind === "file" ? selected === entry.path : undefined} onClick={() => entry.kind === "directory" ? onNavigate(entry.path) : onOpen(entry)}>
            {entry.kind === "directory" ? <Folder size={20} className="directory-icon" /> : <File size={20} />}
            <span className="file-details"><strong>{entry.name}</strong>{deferredQuery && <small className="search-path">{entry.path.slice(folder.length + 1)}</small>}<small>{entry.kind === "directory" ? `${entry.children?.length ?? 0} items` : formatBytes(entry.size)}<span> · </span>{entry.modified ? new Date(entry.modified).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-"}</small></span>{entry.kind === "directory" && <ChevronRight size={13} />}
          </button>)}
        </div>
      </section>
    </div>
    <div className="browser-status"><span className="green-dot" />{loading ? "Refreshing..." : "Repository / DXF"}</div>
  </aside>;
}