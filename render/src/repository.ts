export type RepositoryEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number | null;
  modified: string | null;
  children?: RepositoryEntry[];
  unavailable?: boolean;
};

export function flattenEntries(entries: RepositoryEntry[]): RepositoryEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenEntries(entry.children ?? [])]);
}

export function folderEntries(folder: RepositoryEntry, query: string, sort: string): RepositoryEntry[] {
  const term = query.trim().toLowerCase();
  const entries = term
    ? flattenEntries(folder.children ?? []).filter((entry) => entry.path.slice(folder.path.length + 1).toLowerCase().includes(term))
    : [...(folder.children ?? [])];
  return entries.sort((first, second) => {
    if (first.kind !== second.kind) return first.kind === "directory" ? -1 : 1;
    const nameOrder = first.name.localeCompare(second.name, undefined, { numeric: true });
    if (sort === "modified") return (second.modified ?? "").localeCompare(first.modified ?? "") || nameOrder;
    if (sort === "size") return (second.size ?? 0) - (first.size ?? 0) || nameOrder;
    return sort === "name-desc" ? -nameOrder : nameOrder;
  });
}

export function formatBytes(size: number | null): string {
  if (size === null) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function drawingUrl(path: string): string {
  return `/api/dxf?path=${encodeURIComponent(path)}`;
}