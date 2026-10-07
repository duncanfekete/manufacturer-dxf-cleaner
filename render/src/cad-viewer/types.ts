export type Point = Readonly<{ x: number; y: number }>;
export type CadSource =
  | { kind: "blob"; blob: Blob; name: string }
  | { kind: "url"; url: string; name: string }
  | { kind: "text"; text: string; name: string };
export type Tool = "select" | "pan" | "line" | "box";
export type CadToolConfig = Readonly<{
  select: boolean;
  pan: boolean;
  lineMeasure: boolean;
  boxMeasure: boolean;
  layers: boolean;
  snap: boolean;
  zoom: boolean;
  fit: boolean;
}>;
export type CadTheme = Readonly<{
  background: string;
  selection: string;
  hover: string;
  measurement: string;
  snap: string;
}>;
export type CadViewerConfig = Readonly<{
  tools: CadToolConfig;
  theme: CadTheme;
  initialTool: Tool;
  initialSnapEnabled: boolean;
  snapRadiusPx: number;
  pickRadiusPx: number;
  maxFileBytes: number;
  enableHoverHighlight: boolean;
  enableMultiSelect: boolean;
}>;
export type Measurement = Readonly<{
  id: string;
  kind: "line" | "box";
  start: Point;
  end: Point;
}>;
export type CadProperty = Readonly<{ label: string; value: string }>;
export type CadEntity = Readonly<{
  id: string;
  type: string;
  layer: string;
  properties: readonly CadProperty[];
}>;
export type CadLayer = Readonly<{ id: string; color: string; count: number }>;
export type CadDocument = Readonly<{
  name: string;
  entityCount: number;
  units: string;
  layers: readonly CadLayer[];
  warnings: readonly string[];
}>;
export type SnapHit = Readonly<{ point: Point; kind: string }>;
export type CadErrorCode =
  "fetch" | "unsupported" | "malformed" | "too-large" | "render";
export class CadError extends Error {
  constructor(
    public code: CadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CadError";
  }
}
export interface CadViewerProps {
  source: CadSource;
  config?: Partial<Omit<CadViewerConfig, "tools" | "theme">> & {
    tools?: Partial<CadToolConfig>;
    theme?: Partial<CadTheme>;
  };
  onEntitySelect?: (entity: CadEntity | null) => void;
  onSelectionChange?: (entities: readonly CadEntity[]) => void;
  onEntityHover?: (entity: CadEntity | null) => void;
  onMeasurementCreate?: (measurement: Measurement) => void;
  onLoad?: (document: CadDocument) => void;
  onError?: (error: CadError) => void;
}

export const DEFAULT_CAD_CONFIG: CadViewerConfig = {
  tools: {
    select: true,
    pan: true,
    lineMeasure: true,
    boxMeasure: true,
    layers: true,
    snap: true,
    zoom: true,
    fit: true,
  },
  theme: {
    background: "#fcfcfa",
    selection: "#f2693d",
    hover: "#4c9b78",
    measurement: "#c78748",
    snap: "#479d78",
  },
  initialTool: "select",
  initialSnapEnabled: true,
  snapRadiusPx: 12,
  pickRadiusPx: 7,
  maxFileBytes: 50 * 1024 * 1024,
  enableHoverHighlight: true,
  enableMultiSelect: true,
};
