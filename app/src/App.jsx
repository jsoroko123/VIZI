// src/App.jsx
import { useMemo, useRef, useState, useEffect } from "react";
import PropertiesPanel from "./components/PropertiesPanel";
import HelpPanel from "./components/HelpPanel";
import ImportModal from "./components/ImportModal";
import WidgetSelectorModal from "./components/WidgetSelectorModal";
import CanvasSvg from "./components/CanvasSvg";
import ViewBoxModal from "./components/ViewBoxModal";
import OpcConfig from "./components/OpcConfig";
import DataBrowser from "./components/DataBrowser";
import DatasetBuilder from "./components/DatasetBuilder";
import DatabaseConfigPanel from "./components/DatabaseConfigPanel";
import SqlDesigner from "./components/SqlDesigner";
import PlcAnalyzer from "./components/PlcAnalyzer";
import ServerDiagnosticsPanel from "./components/ServerDiagnosticsPanel";
import { useAuth } from "./components/AuthContext.jsx";

import { uid } from "./utils/ids";
import { stripOuterSvg } from "./utils/svgSanitize";
import {
  VB_W,
  VB_H,
  GRID,
  snap,
  fmt,
  numOrNull,
  dist2,
  distance,
  clonePoints,
  closestPointOnSegment,
  bboxOfPoints,
  toggleIn,
} from "./utils/geometry";

import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { exportToIgnitionJson, downloadIgnitionJson } from "./utils/ignitionExport";
import { toastError, toastSuccess } from "./utils/toast";

// Vite: keep SVG modules as URLs and fetch raw text only when needed.
const SVG_LIBRARY = import.meta.glob("./assets/SVG_Files/**/*.svg", {
  import: "default",
  query: "?url",
});
const THEME_KEY = "vizi_theme";
// (no eager:true)

const SVG_RAW_CACHE_MAX = 96;
const DEFAULT_CANVAS_BG_LIGHT = "#ffffff";
const DEFAULT_CANVAS_BG_DARK = "#0f141c";

function isSvgMarkup(value) {
  const text = String(value || "").trimStart();
  return text.startsWith("<svg") || text.startsWith("<?xml");
}

function normalizeProjectCanvasBackground(raw) {
  const fallback = {
    light: DEFAULT_CANVAS_BG_LIGHT,
    dark: DEFAULT_CANVAS_BG_DARK,
  };
  const src = raw && typeof raw === "object" ? raw : {};
  const normalizeColor = (value, defaultColor) => {
    const text = String(value || "").trim();
    if (!text) return defaultColor;
    if (/^#[0-9a-fA-F]{6}$/.test(text) || /^#[0-9a-fA-F]{3}$/.test(text)) return text;
    return defaultColor;
  };
  return {
    light: normalizeColor(src.light, fallback.light),
    dark: normalizeColor(src.dark, fallback.dark),
  };
}

function normalizeProjectPlcEntries(raw, options = {}) {
  const includeRawText = options?.includeRawText !== false;
  const maxRawText =
    Number.isFinite(Number(options?.maxRawText)) && Number(options.maxRawText) > 0
      ? Math.floor(Number(options.maxRawText))
      : null;
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((item, idx) => {
      const analysis = item?.analysis && typeof item.analysis === "object" ? item.analysis : null;
      const rawText = includeRawText ? String(item?.rawText || "") : "";
      const normalizedRaw = maxRawText == null ? rawText : rawText.slice(0, maxRawText);
      return {
        id: String(item?.id || `plc-${idx + 1}`),
        name: String(item?.name || "").trim(),
        size: Number.isFinite(Number(item?.size)) ? Number(item.size) : 0,
        uploadedAt: Number.isFinite(Number(item?.uploadedAt)) ? Number(item.uploadedAt) : Date.now(),
        debugSessionId: String(item?.debugSessionId || "").trim(),
        rawText: normalizedRaw,
        analysis,
        chatHistory: Array.isArray(item?.chatHistory)
          ? item.chatHistory
              .map((msg) => ({
                role: String(msg?.role || "").toLowerCase() === "assistant" ? "assistant" : "user",
                content: String(msg?.content || "").slice(0, 8000),
              }))
              .filter((msg) => String(msg.content || "").trim())
              .slice(-80)
          : [],
        opcPlan: item?.opcPlan && typeof item.opcPlan === "object" ? item.opcPlan : null,
      };
    })
    .filter((item) => item.name || item.rawText);
}

function getFolderFromKey(key) {
  const parts = String(key).split("/");
  const i = parts.findIndex((p) => p === "SVG_Files" || p === "SVG Files");
  if (i >= 0) {
    const rest = parts.slice(i + 1);
    if (rest.length <= 1) return "Root";
    return rest.slice(0, -1).join(" / ");
  }
  if (parts.length <= 2) return "Root";
  return parts.slice(0, -1).slice(-1)[0] || "Root";
}

function normalizeTagValue(value) {
  return String(value || "")
    .replace(/\r?\n/g, "")
    .trim();
}

function normalizeRouteTagKey(value) {
  return normalizeTagValue(value).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isRouteIdTagKey(value) {
  const key = normalizeRouteTagKey(value);
  return (
    key === "routeid" ||
    key === "routenumber" ||
    key === "routeno" ||
    key === "route"
  );
}

function isStateTagKey(value) {
  const key = normalizeRouteTagKey(value);
  return (
    key === "state" ||
    key === "stcode" ||
    key === "status" ||
    key === "stat" ||
    key === "hmistate"
  );
}

function parseDbTagPath(value) {
  const raw = String(value || "").trim();
  if (!raw.toLowerCase().startsWith("db:")) return null;
  const expr = raw.slice(3).trim();
  const dot = expr.indexOf(".");
  if (dot <= 0 || dot >= expr.length - 1) return null;
  const table = expr.slice(0, dot).trim();
  const field = expr.slice(dot + 1).trim();
  if (!table || !field) return null;
  return { table, field };
}

function widgetTemplate(widgetKey) {
  const templates = {
    lineChart: {
      name: "Widget-LineChart.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Line Chart</text><line x1="36" y1="142" x2="292" y2="142" stroke="#475569" stroke-width="2"/><line x1="36" y1="42" x2="36" y2="142" stroke="#475569" stroke-width="2"/><polyline points="42,130 92,108 136,118 180,84 232,98 286,60" fill="none" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    },
    barChart: {
      name: "Widget-BarChart.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Bar Chart</text><line x1="36" y1="142" x2="292" y2="142" stroke="#475569" stroke-width="2"/><rect x="58" y="96" width="30" height="46" rx="4" fill="#22c55e"/><rect x="104" y="76" width="30" height="66" rx="4" fill="#38bdf8"/><rect x="150" y="52" width="30" height="90" rx="4" fill="#f59e0b"/><rect x="196" y="88" width="30" height="54" rx="4" fill="#a78bfa"/><rect x="242" y="66" width="30" height="76" rx="4" fill="#fb7185"/></svg>`,
    },
    areaChart: {
      name: "Widget-AreaChart.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Area Chart</text><line x1="36" y1="142" x2="292" y2="142" stroke="#475569" stroke-width="2"/><path d="M42,128 L90,102 L138,114 L186,80 L234,96 L286,70 L286,142 L42,142 Z" fill="#22c55e55" stroke="#22c55e" stroke-width="3"/></svg>`,
    },
    gauge: {
      name: "Widget-Gauge.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 180"><rect x="1" y="1" width="258" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Gauge</text><path d="M46 132a84 84 0 0 1 168 0" fill="none" stroke="#334155" stroke-width="16" stroke-linecap="round"/><path d="M46 132a84 84 0 0 1 126 -72" fill="none" stroke="#22c55e" stroke-width="16" stroke-linecap="round"/><line x1="130" y1="132" x2="192" y2="88" stroke="#e2e8f0" stroke-width="4" stroke-linecap="round"/><circle cx="130" cy="132" r="6" fill="#e2e8f0"/></svg>`,
    },
    kpi: {
      name: "Widget-KPI.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"><rect x="1" y="1" width="238" height="138" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">KPI</text><text x="20" y="84" fill="#22c55e" font-size="42" font-family="system-ui" font-weight="700">98.7%</text><text x="20" y="112" fill="#94a3b8" font-size="12" font-family="system-ui">Target: 95%</text></svg>`,
    },
    displayBox: {
      name: "Widget-DisplayBox.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect x="1" y="1" width="318" height="178" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Display Box</text><text x="20" y="92" fill="#22c55e" font-size="40" font-family="system-ui" font-weight="700">123.4</text><text x="214" y="92" fill="#93c5fd" font-size="16" font-family="system-ui" font-weight="700">psi</text><rect x="20" y="122" width="194" height="30" rx="8" fill="#111827" stroke="#334155"/><rect x="222" y="122" width="78" height="30" rx="8" fill="#2b6cff"/><text x="242" y="141" fill="#ffffff" font-size="12" font-family="system-ui" font-weight="700">Write</text></svg>`,
    },
    statusTable: {
      name: "Widget-StatusTable.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 340 190"><rect x="1" y="1" width="338" height="188" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Status Table</text><rect x="16" y="40" width="308" height="28" rx="6" fill="#1e293b"/><text x="28" y="58" fill="#94a3b8" font-size="11" font-family="system-ui">Tag</text><text x="170" y="58" fill="#94a3b8" font-size="11" font-family="system-ui">State</text><text x="252" y="58" fill="#94a3b8" font-size="11" font-family="system-ui">Quality</text><rect x="16" y="74" width="308" height="30" rx="6" fill="#111827"/><rect x="16" y="108" width="308" height="30" rx="6" fill="#111827"/><rect x="16" y="142" width="308" height="30" rx="6" fill="#111827"/></svg>`,
    },
  };
  return templates[widgetKey] || templates.lineChart;
}

function defaultWidgetSettings(widgetKey) {
  const kind = String(widgetKey || "").trim();
  const base = {
    kind: kind || "lineChart",
    title: "",
    min: 0,
    max: 100,
    decimals: 0,
    unit: "",
    historyPoints: 40,
    rowCount: 4,
    rangeFrom: null,
    rangeTo: null,
    windowMinutes: 60,
    durationPreset: "1h",
    maxPoints: 500,
    lineTension: 0.34,
    showPoints: true,
    seriesTags: [],
    axisMode: "auto",
    barSourceMode: "table",
    barTable: "",
    barField: "",
    barLabelField: "",
    barQuery: "",
    barQueryValueField: "",
    barQueryLabelField: "",
  };
  if (kind === "statusTable") return { ...base, historyPoints: 12, rowCount: 6 };
  if (kind === "kpi") return { ...base, historyPoints: 10 };
  if (kind === "displayBox") return { ...base, historyPoints: 10 };
  if (kind === "gauge") return { ...base, min: 0, max: 100, historyPoints: 16 };
  if (kind === "barChart") return { ...base, historyPoints: 20 };
  if (kind === "areaChart") return { ...base, historyPoints: 40 };
  return base;
}

function normalizeSeriesTagsValue(rawSeries, fallbackTagPath = "") {
  const tags = (Array.isArray(rawSeries) ? rawSeries : String(rawSeries || "").split(/\r?\n|,/))
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
  if (tags.length) return tags;
  const primary = String(fallbackTagPath || "").trim();
  return primary ? [primary] : [];
}

function toDatetimeLocalInput(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}




export default function App() {
  const { user, logout, updateProfile, changePassword } = useAuth();
  const [tool, setTool] = useState("select"); // "select" | "polyline" | "rect"
  const DEFAULT_STROKE = "#808080";
  const DEFAULT_FILL = "#cccccc";
  const [shapes, setShapes] = useState([]); // polyline | rect | text

  // Multi-selection
  const [selectedIds, setSelectedIds] = useState([]); // polyline ids
  const [selectedOverlayIds, setSelectedOverlayIds] = useState([]); // overlay ids

  // drawing = { mode:"draw-poly"|"draw-rect", id, start?:{x,y} }
  const [drawing, setDrawing] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null); // { id, value }

  // unified drag for moving ALL selected items
  // { startWorld, polylines:[{id, origPoints}], overlays:[{id, origTx, origTy}] }
  const [dragAll, setDragAll] = useState(null);

  // editing a polyline
  const [editingId, setEditingId] = useState(null); // double-click line to edit
  const [dragHandle, setDragHandle] = useState(null); // { id, index }
  const [selectedSegment, setSelectedSegment] = useState(null); // { id, index, kind: "point" }

  // Import picker UI
  const [importOpen, setImportOpen] = useState(false);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [lastContextPoint, setLastContextPoint] = useState(null);
  const [panelCursor, setPanelCursor] = useState(null);
  const [contextImportQuery, setContextImportQuery] = useState("");
  const [contextSvgTagQuery, setContextSvgTagQuery] = useState("");
  const [contextSvgMenuOpen, setContextSvgMenuOpen] = useState(false);
  const [contextSvgMenuPos, setContextSvgMenuPos] = useState({ x: 0, y: 0 });
  const contextSvgMenuTimerRef = useRef(null);
  const svgMenuInputRef = useRef(null);
  const [duplicateOffset, setDuplicateOffset] = useState(20);
  const duplicateOffsetRef = useRef(20);
  const [polyHandleMenu, setPolyHandleMenu] = useState(null);

  // SVG overlays (imported files): { id, name, inner, tx, ty, scale, fill, stroke, tagPath }
  const [svgOverlays, setSvgOverlays] = useState([]);

  // overlay resize
  const [overlayResize, setOverlayResize] = useState(null); // { id, anchorLocal, anchorWorld, startDist, origScale }

  // ✅ Export settings (dynamic)
  const [exportVB, setExportVB] = useState({ x: 0, y: 0, w: 1600, h: 900 });
  const [exportBasis, setExportBasis] = useState({ w: 1600, h: 900 }); // affects Perspective "basis"
  const [showZoom, setShowZoom] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showTagPaths, setShowTagPaths] = useState(false);
  const [hiddenTagBubbleIds, setHiddenTagBubbleIds] = useState([]);
  const [marquee, setMarquee] = useState(null);

  const [vbW, setVbW] = useState(1600);
  const [vbH, setVbH] = useState(900);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [viewBoxOpen, setViewBoxOpen] = useState(false);

  const [importAnchor, setImportAnchor] = useState(null);

  const [opcTags, setOpcTags] = useState([]);
  const [opcTemplates, setOpcTemplates] = useState([]);
  const [opcLiveValues, setOpcLiveValues] = useState({});
  const [opcTagMappings, setOpcTagMappings] = useState([]);
  const [opcMappingSets, setOpcMappingSets] = useState([]);
  const [widgetDbValues, setWidgetDbValues] = useState({});
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden
  );


  const overlayRefs = useRef(new Map()); // id -> <g> element containing imported inner
  const svgRef = useRef(null);
  const clipboardRef = useRef({ shapes: [], overlays: [], pasteCount: 0 });

  const shapesRef = useRef(shapes);
  const overlaysRef = useRef(svgOverlays);
  const selPolyRef = useRef(selectedIds);
  const selOverRef = useRef(selectedOverlayIds);
  const projectFileRef = useRef(null);
  const svgRawCacheRef = useRef(new Map());
  const [projectHandle, setProjectHandle] = useState(null);
  const [projectName, setProjectName] = useState("Untitled");
  const [projectCanvasBackground, setProjectCanvasBackground] = useState(() =>
    normalizeProjectCanvasBackground(null)
  );
  const [projectPlcs, setProjectPlcs] = useState([]);
  const [screens, setScreens] = useState([
    { id: "screen-1", name: "Screen 1", shapes: [], svgOverlays: [], vbW: 1600, vbH: 900, pan: { x: 0, y: 0 }, zoom: 1 },
  ]);
  const [activeScreenId, setActiveScreenId] = useState("screen-1");
  const [screenName, setScreenName] = useState("Screen 1");
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [projectRouteRows, setProjectRouteRows] = useState([]);
  const [projectStatus, setProjectStatus] = useState("");
  const [activeProjectUpdatedAt, setActiveProjectUpdatedAt] = useState("");
  const [activeProjectUpdatedBy, setActiveProjectUpdatedBy] = useState("");
  const [projectCursors, setProjectCursors] = useState([]);
  const [showProjectNameInput, setShowProjectNameInput] = useState(false);
  const [showProjectDrawer, setShowProjectDrawer] = useState(false);
  const [mainDrawerFullscreen, setMainDrawerFullscreen] = useState(false);
  const [userDrawerFullscreen, setUserDrawerFullscreen] = useState(false);
  const [projectDrawerFullscreen, setProjectDrawerFullscreen] = useState(false);
  const lastProjectSignatureRef = useRef("");
  const projectSaveInFlightRef = useRef(false);
  const autoSaveTimerRef = useRef(null);
  const pendingSilentSaveRef = useRef(false);
  const queuedSaveAfterFlightRef = useRef(null); // null | "silent" | "manual"
  const lastCursorSentRef = useRef({ at: 0, x: NaN, y: NaN });
  const projectNameRef = useRef(projectName);
  const projectCanvasBackgroundRef = useRef(projectCanvasBackground);
  const projectPlcsRef = useRef(projectPlcs);
  const screensRef = useRef(screens);
  const activeScreenIdRef = useRef(activeScreenId);
  const screenNameRef = useRef(screenName);
  const vbWRef = useRef(vbW);
  const vbHRef = useRef(vbH);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);

  useEffect(() => {
    projectNameRef.current = projectName;
    projectCanvasBackgroundRef.current = projectCanvasBackground;
    projectPlcsRef.current = projectPlcs;
    screensRef.current = screens;
    activeScreenIdRef.current = activeScreenId;
    screenNameRef.current = screenName;
    vbWRef.current = vbW;
    vbHRef.current = vbH;
    panRef.current = pan;
    zoomRef.current = zoom;
  }, [projectName, projectCanvasBackground, projectPlcs, screens, activeScreenId, screenName, vbW, vbH, pan, zoom]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const onVis = () => setIsPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadConfig() {
      try {
        const res = await fetch("/api/opc/config");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load OPC config.");
        if (!alive) return;
        const tags = Array.isArray(data?.tags) ? data.tags : [];
        setOpcTags(tags);
      } catch {
        // ignore
      }
    }
    async function loadTemplates() {
      try {
        const res = await fetch("/api/opc/templates");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load templates.");
        if (!alive) return;
        setOpcTemplates(data.templates || []);
      } catch {
        // ignore
      }
    }
    async function loadTagMappings() {
      try {
        const res = await fetch("/api/opc/tag-mappings");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load mappings.");
        if (!alive) return;
        setOpcTagMappings(data.mappings || []);
      } catch {
        // ignore
      }
    }
    async function loadMappingSets() {
      try {
        const res = await fetch("/api/opc/mapping-sets");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load mapping sets.");
        if (!alive) return;
        setOpcMappingSets(data.sets || []);
      } catch {
        // ignore
      }
    }
    loadConfig();
    loadTemplates();
    loadTagMappings();
    loadMappingSets();
    const configId = setInterval(loadConfig, isPageVisible ? 5000 : 25000);
    const templateId = setInterval(loadTemplates, isPageVisible ? 10000 : 30000);
    const mappingId = setInterval(loadTagMappings, isPageVisible ? 10000 : 30000);
    const mappingSetId = setInterval(loadMappingSets, isPageVisible ? 10000 : 30000);
    return () => {
      alive = false;
      clearInterval(configId);
      clearInterval(templateId);
      clearInterval(mappingId);
      clearInterval(mappingSetId);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function pollStatus() {
      if (!isPageVisible) return;
      try {
        const res = await fetch("/api/opc/status");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load status.");
        if (!alive) return;
        setOpcLiveValues(data.values || {});
      } catch {
        // ignore
      }
    }
    pollStatus();
    const id = setInterval(pollStatus, isPageVisible ? 1000 : 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isPageVisible]);

  useEffect(() => {
    let alive = true;
    const pollSessionKeepAlive = async () => {
      if (!alive) return;
      const sessionIds = Array.from(
        new Set(
          (Array.isArray(projectPlcs) ? projectPlcs : [])
            .map((plc) => String(plc?.debugSessionId || "").trim())
            .filter(Boolean)
        )
      );
      if (!sessionIds.length) return;
      await Promise.all(
        sessionIds.map(async (id) => {
          try {
            await fetch(`/api/ai/plc-debug-sessions/${encodeURIComponent(id)}`, {
              credentials: "include",
            });
          } catch {
            // keepalive is best-effort only
          }
        })
      );
    };
    void pollSessionKeepAlive();
    const id = setInterval(pollSessionKeepAlive, isPageVisible ? 12000 : 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectPlcs, isPageVisible]);

  useEffect(() => {
    let alive = true;
    async function pollWidgetDbValues() {
      if (!isPageVisible) return;
      const overlays = Array.isArray(svgOverlays) ? svgOverlays : [];
      const widgetBindings = overlays
        .map((o) => ({
          id: String(o?.id || ""),
          tagPath: String(o?.tagPath || "").trim(),
          isWidget: !!o?.widget,
        }))
        .filter((x) => x.isWidget && x.id && x.tagPath.toLowerCase().startsWith("db:"));
      if (!widgetBindings.length) {
        if (alive) setWidgetDbValues({});
        return;
      }
      const next = {};
      await Promise.all(
        widgetBindings.map(async (b) => {
          const expr = b.tagPath.slice(3).trim();
          const dot = expr.indexOf(".");
          if (dot <= 0 || dot === expr.length - 1) return;
          const table = expr.slice(0, dot).trim();
          const field = expr.slice(dot + 1).trim();
          if (!table || !field) return;
          try {
            const res = await fetch(`/api/db/${encodeURIComponent(table)}?limit=1`);
            const data = await res.json();
            if (!res.ok) return;
            const row = Array.isArray(data?.rows) ? data.rows[0] : null;
            if (!row || typeof row !== "object") return;
            const value = row[field];
            if (value == null) return;
            next[b.id] = value;
          } catch {
            // ignore per-widget db errors
          }
        })
      );
      if (!alive) return;
      setWidgetDbValues(next);
    }
    pollWidgetDbValues();
    const id = setInterval(pollWidgetDbValues, isPageVisible ? 2000 : 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [svgOverlays, isPageVisible]);

  const opcTemplateMap = useMemo(() => {
    const map = new Map();
    (opcTemplates || []).forEach((t) => map.set(t.name, t));
    return map;
  }, [opcTemplates]);

  const opcTagMappingMap = useMemo(() => {
    const map = new Map();
    (opcTagMappings || []).forEach((m) => {
      const key = String(m.tag_key || "").trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({
        field: String(m.field ?? ""),
        state: String(m.state ?? ""),
        color: String(m.color ?? ""),
      });
    });
    return map;
  }, [opcTagMappings]);

  const opcMappingSetMap = useMemo(() => {
    const map = new Map();
    (opcMappingSets || []).forEach((set) => {
      const name = String(set?.name || "").trim();
      if (!name) return;
      map.set(name, set);
    });
    return map;
  }, [opcMappingSets]);

  const resolveTemplateStateMappings = (name) => {
    const visited = new Set();
    const map = new Map();
    function walk(n) {
      if (!n || visited.has(n)) return;
      visited.add(n);
      const tmpl = opcTemplateMap.get(n);
      if (!tmpl) return;
      if (tmpl.parent_name) {
        walk(tmpl.parent_name);
      }
      if (Array.isArray(tmpl.state_mappings)) {
        tmpl.state_mappings.forEach((m) => {
          const fieldVal = String(m?.field ?? "").trim();
          const stateVal = String(m?.state ?? "").trim();
          if (!stateVal) return;
          const key = `${fieldVal}::${stateVal}`;
          map.set(key, String(m?.color || "").trim());
        });
      }
    }
    walk(name);
    return Array.from(map.entries()).map(([key, color]) => {
      const [field, state] = key.split("::");
      return { field, state, color };
    });
  };

  const tagStateColorsByPath = useMemo(() => {
    const map = new Map();
    const live = opcLiveValues || {};

    const inferGroupName = (tag) => {
      const explicit = normalizeTagValue(tag?.groupName || "");
      if (explicit) return explicit;
      const rawPath = normalizeTagValue(tag?.tagPath || tag?.name || "");
      if (!rawPath.includes(".")) return "";
      return normalizeTagValue(rawPath.slice(0, rawPath.indexOf(".")));
    };

    const readLiveTagValue = (tag, topicName, groupName) => {
      const candidates = [
        topicName && groupName && tag?.tagPath ? `${topicName}.${groupName}.${tag.tagPath}` : "",
        topicName && groupName && tag?.name ? `${topicName}.${groupName}.${tag.name}` : "",
        topicName && tag?.tagPath ? `${topicName}.${tag.tagPath}` : "",
        topicName && tag?.name ? `${topicName}.${tag.name}` : "",
        groupName && tag?.tagPath ? `${groupName}.${tag.tagPath}` : "",
        groupName && tag?.name ? `${groupName}.${tag.name}` : "",
        tag?.tagPath || "",
        tag?.name || "",
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      for (const k of candidates) {
        if (live[k] != null && live[k] !== "") return live[k];
        const lower = k.toLowerCase();
        if (live[lower] != null && live[lower] !== "") return live[lower];
      }
      return null;
    };

    (opcTags || []).forEach((tag) => {
      const tagPath = normalizeTagValue(tag?.tagPath || "");
      const tagName = normalizeTagValue(tag?.name || "");
      const topicName = normalizeTagValue(tag?.topic || "");
      const groupName = inferGroupName(tag);
      const keyCandidates = [
        tagPath,
        topicName && tagName ? `${topicName}.${tagName}` : "",
        topicName && tagPath ? `${topicName}.${tagPath}` : "",
        groupName,
        topicName && groupName ? `${topicName}.${groupName}` : "",
      ].filter(Boolean);
      if (!keyCandidates.length) return;
      const rawValue = readLiveTagValue(tag, topicName, groupName);
      const scale = Number.isFinite(Number(tag?.scale)) ? Number(tag.scale) : 1;
      const value =
        rawValue != null && rawValue !== "" && !Number.isNaN(Number(rawValue))
          ? Number(rawValue) * scale
          : rawValue;
      const templateName = String(tag?.plcType || "").trim();
      const mappingSetName = String(tag?.mappingSet || "").trim();
      if (value == null || value === "") return;
      const mappingKeys = [
        topicName && tagName ? `${topicName}.${tagName}` : "",
        topicName && tagPath ? `${topicName}.${tagPath}` : "",
        tagName,
        tagPath,
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      const tagMappings =
        mappingKeys.map((k) => opcTagMappingMap.get(k)).find((rows) => Array.isArray(rows) && rows.length) ||
        [];
      const setMappings = mappingSetName
        ? (opcMappingSetMap.get(mappingSetName)?.mappings || [])
        : [];
      const normalizedSetMappings = (setMappings || []).map((m) => ({
        field: String(m?.field ?? ""),
        state: String(m?.state ?? ""),
        color: String(m?.color ?? ""),
      }));
      const mappings = tagMappings.length
        ? tagMappings
        : normalizedSetMappings.length
        ? normalizedSetMappings
        : resolveTemplateStateMappings(templateName);
      if (!mappings.length) return;
      const fieldName = String(tag?.name || "").trim();
      const valStr = String(value).trim();
      const valNum = Number(value);
      const valLower = valStr.toLowerCase();
      const valBool =
        valLower === "true" || valLower === "1"
          ? true
          : valLower === "false" || valLower === "0"
          ? false
          : null;
      const match = mappings.find((m) => {
        const stateStr = String(m?.state ?? "").trim();
        if (!stateStr) return false;
        const stateLower = stateStr.toLowerCase();
        const numeric = Number(stateStr);
        if (Number.isFinite(valNum) && Number.isFinite(numeric) && numeric === valNum) return true;
        const stateBool =
          stateLower === "true" || stateLower === "1"
            ? true
            : stateLower === "false" || stateLower === "0"
            ? false
            : null;
        if (valBool !== null && stateBool !== null && valBool === stateBool) return true;
        return stateLower === valLower;
      });
      if (match?.color) {
        const color = String(match.color);
        keyCandidates.forEach((k) => map.set(k, color));
      }
    });
    return map;
  }, [opcTags, opcLiveValues, opcTemplateMap, opcTagMappingMap, opcMappingSetMap]);

  const routeColorsBySvgKey = useMemo(() => {
    const map = new Map();
    const pickRouteColor = (row) => {
      if (!row || typeof row !== "object") return "";
      const direct =
        row?.routecolor ??
        row?.route_color ??
        row?.routeColor ??
        row?.color ??
        "";
      const directColor = normalizeTagValue(direct);
      if (directColor) return directColor;
      for (const [field, value] of Object.entries(row)) {
        const f = String(field || "").toLowerCase();
        if (!f.includes("color")) continue;
        const c = normalizeTagValue(value);
        if (c) return c;
      }
      return "";
    };

    const addKey = (raw, color) => {
      const key = normalizeTagValue(raw);
      if (!key || !color) return;
      map.set(key, color);
      map.set(key.toLowerCase(), color);
      const base = key.split("/").pop() || "";
      const baseTrim = normalizeTagValue(base);
      if (baseTrim) {
        map.set(baseTrim, color);
        map.set(baseTrim.toLowerCase(), color);
        const noExt = baseTrim.replace(/\.svg$/i, "");
        if (noExt && noExt !== baseTrim) {
          map.set(noExt, color);
          map.set(noExt.toLowerCase(), color);
        }
      }
    };

    const addRowKeys = (row, color) => {
      if (!row || typeof row !== "object") return;
      Object.entries(row).forEach(([field, value]) => {
        const fieldKey = String(field || "").toLowerCase();
        if (!fieldKey) return;
        if (fieldKey.includes("color")) return;
        if (fieldKey === "project_id" || fieldKey === "projectid") return;
        if (value == null) return;
        if (typeof value === "string" || typeof value === "number") {
          addKey(value, color);
        }
      });
    };

    (projectRouteRows || []).forEach((row) => {
      const color = pickRouteColor(row);
      if (!color) return;

      addKey(row?.tag_path, color);
      addKey(row?.tagPath, color);
      addKey(row?.svg_tag_path, color);
      addKey(row?.svgTagPath, color);
      addKey(row?.svg_path, color);
      addKey(row?.svgPath, color);
      addKey(row?.svg_name, color);
      addKey(row?.svgName, color);
      addKey(row?.route, color);
      addKey(row?.route_name, color);
      addKey(row?.routeName, color);
      addKey(row?.name, color);
      addKey(row?.path, color);
      addKey(row?.id, color);
      addRowKeys(row, color);
    });

    return map;
  }, [projectRouteRows]);

  const routeColorByRouteNumber = useMemo(() => {
    const map = new Map();
    const pickRouteColor = (row) => {
      if (!row || typeof row !== "object") return "";
      const direct =
        row?.routecolor ??
        row?.route_color ??
        row?.routeColor ??
        row?.color ??
        "";
      const directColor = normalizeTagValue(direct);
      if (directColor) return directColor;
      for (const [field, value] of Object.entries(row)) {
        if (!String(field || "").toLowerCase().includes("color")) continue;
        const c = normalizeTagValue(value);
        if (c) return c;
      }
      return "";
    };
    const pickRouteNumber = (row) => {
      if (!row || typeof row !== "object") return "";
      const direct =
        row?.["Route Number"] ??
        row?.route_number ??
        row?.routeNumber ??
        row?.routenumber ??
        "";
      const d = normalizeTagValue(direct);
      if (d) return d;
      for (const [field, value] of Object.entries(row)) {
        const f = String(field || "").toLowerCase();
        if (!f.includes("route")) continue;
        if (!f.includes("number") && f !== "route" && f !== "routeid") continue;
        const v = normalizeTagValue(value);
        if (v) return v;
      }
      return "";
    };

    (projectRouteRows || []).forEach((row) => {
      const routeNum = pickRouteNumber(row);
      const color = pickRouteColor(row);
      if (!routeNum || !color) return;
      map.set(routeNum, color);
      map.set(routeNum.toLowerCase(), color);
    });
    return map;
  }, [projectRouteRows]);

  const routeStrokeColorByGroupPath = useMemo(() => {
    const map = new Map();
    const live = opcLiveValues || {};

    const readLiveTagValue = (tag, topic) => {
      const group = normalizeTagValue(tag?.groupName || "");
      const cands = [
        topic && group && tag?.name ? `${topic}.${group}.${tag.name}` : "",
        topic && group && tag?.tagPath ? `${topic}.${group}.${tag.tagPath}` : "",
        topic && tag?.name ? `${topic}.${tag.name}` : "",
        topic && tag?.tagPath ? `${topic}.${tag.tagPath}` : "",
        group && tag?.name ? `${group}.${tag.name}` : "",
        group && tag?.tagPath ? `${group}.${tag.tagPath}` : "",
        tag?.name || "",
        tag?.tagPath || "",
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      for (const k of cands) {
        if (Object.prototype.hasOwnProperty.call(live, k)) return live[k];
        const lower = k.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(live, lower)) return live[lower];
      }
      return null;
    };

    (opcTags || []).forEach((tag) => {
      const topic = normalizeTagValue(tag?.topic || "");
      const group = normalizeTagValue(tag?.groupName || "");
      if (!topic || !group) return;

      const tagKeyA = tag?.name || "";
      const tagKeyB = tag?.tagPath || "";
      if (!isRouteIdTagKey(tagKeyA) && !isRouteIdTagKey(tagKeyB)) return;

      const routeValueRaw = readLiveTagValue(tag, topic);
      const routeValue = normalizeTagValue(routeValueRaw);
      if (!routeValue) return;
      const color =
        routeColorByRouteNumber.get(routeValue) ||
        routeColorByRouteNumber.get(routeValue.toLowerCase()) ||
        "";
      if (!color) return;

      const groupPath = `${topic}.${group}`;
      map.set(groupPath, color);
      map.set(groupPath.toLowerCase(), color);
      map.set(group, color);
      map.set(group.toLowerCase(), color);
    });

    return map;
  }, [opcTags, opcLiveValues, routeColorByRouteNumber]);

  const svgLiveValuesByGroupPath = useMemo(() => {
    const map = new Map();
    const live = opcLiveValues || {};

    const readLiveTagValue = (tag, topic) => {
      const group = normalizeTagValue(tag?.groupName || "");
      const candidates = [
        topic && group && tag?.tagPath ? `${topic}.${group}.${tag.tagPath}` : "",
        topic && group && tag?.name ? `${topic}.${group}.${tag.name}` : "",
        topic && tag?.tagPath ? `${topic}.${tag.tagPath}` : "",
        topic && tag?.name ? `${topic}.${tag.name}` : "",
        group && tag?.tagPath ? `${group}.${tag.tagPath}` : "",
        group && tag?.name ? `${group}.${tag.name}` : "",
        tag?.tagPath || "",
        tag?.name || "",
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);

      for (const key of candidates) {
        if (live[key] != null && live[key] !== "") return live[key];
        const lower = key.toLowerCase();
        if (live[lower] != null && live[lower] !== "") return live[lower];
      }
      return "";
    };

    const groups = new Map();
    (opcTags || []).forEach((tag) => {
      const topic = normalizeTagValue(tag?.topic || "Default") || "Default";
      const group = normalizeTagValue(tag?.groupName || "");
      if (!group) return;

      const groupPath = `${topic}.${group}`;
      const routeKeyA = tag?.name || "";
      const routeKeyB = tag?.tagPath || "";
      const value = normalizeTagValue(readLiveTagValue(tag, topic));
      if (!value) return;

      const entry = groups.get(groupPath) || { routeId: "", state: "" };
      if (!entry.routeId && (isRouteIdTagKey(routeKeyA) || isRouteIdTagKey(routeKeyB))) {
        entry.routeId = value;
      }
      if (!entry.state && (isStateTagKey(routeKeyA) || isStateTagKey(routeKeyB))) {
        entry.state = value;
      }
      groups.set(groupPath, entry);
    });

    groups.forEach((entry, groupPath) => {
      if (!entry?.routeId && !entry?.state) return;
      const group = normalizeTagValue(groupPath.split(".").slice(1).join("."));
      map.set(groupPath, entry);
      map.set(groupPath.toLowerCase(), entry);
      if (group) {
        map.set(group, entry);
        map.set(group.toLowerCase(), entry);
      }
    });

    return map;
  }, [opcTags, opcLiveValues]);

  const svgTagGroupMenuOptions = useMemo(() => {
    const options = [{ value: "", label: "Select tag group" }];
    const seen = new Set();
    (opcTags || []).forEach((tag) => {
      const topic = normalizeTagValue(tag?.topic || "Default") || "Default";
      const explicitGroup = normalizeTagValue(tag?.groupName || "");
      const rawPath = normalizeTagValue(tag?.tagPath || tag?.name || "");
      const inferredGroup =
        !explicitGroup && rawPath.includes(".")
          ? normalizeTagValue(rawPath.slice(0, rawPath.indexOf(".")))
          : "";
      const group = explicitGroup || inferredGroup;
      if (!group) return;
      const value = `${topic}.${group}`;
      const dedupe = value.toLowerCase();
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      options.push({ value, label: group, group: topic });
    });

    const currentOverlay =
      selectedOverlayIds.length === 1 && selectedIds.length === 0
        ? svgOverlays.find((o) => o.id === selectedOverlayIds[0]) || null
        : null;
    const current = normalizeTagValue(currentOverlay?.tagPath || "");
    if (current && !options.some((opt) => opt.value === current)) {
      options.push({ value: current, label: current, group: "Custom" });
    }
    return options;
  }, [opcTags, selectedOverlayIds, selectedIds, svgOverlays]);


  const PAN_SPEED = 0.05; // 🔥 adjust this to taste

  const svgTagGroupMenuFilteredOptions = useMemo(() => {
    const q = normalizeTagValue(contextSvgTagQuery).toLowerCase();
    if (!q) return svgTagGroupMenuOptions;

    const filtered = svgTagGroupMenuOptions.filter((opt) =>
      `${opt?.group || ""} ${opt?.label || ""} ${opt?.value || ""}`.toLowerCase().includes(q)
    );

    const currentOverlay =
      selectedOverlayIds.length === 1 && selectedIds.length === 0
        ? svgOverlays.find((o) => o.id === selectedOverlayIds[0]) || null
        : null;
    const current = normalizeTagValue(currentOverlay?.tagPath || "");
    if (current && !filtered.some((opt) => opt.value === current)) {
      const selected = svgTagGroupMenuOptions.find((opt) => opt.value === current);
      if (selected) return [selected, ...filtered];
    }
    return filtered;
  }, [
    contextSvgTagQuery,
    selectedOverlayIds,
    selectedIds,
    svgOverlays,
    svgTagGroupMenuOptions,
  ]);

  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { overlaysRef.current = svgOverlays; }, [svgOverlays]);
  useEffect(() => { selPolyRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { selOverRef.current = selectedOverlayIds; }, [selectedOverlayIds]);
  useEffect(() => { duplicateOffsetRef.current = Number(duplicateOffset) || 0; }, [duplicateOffset]);
  useEffect(() => {
    if (!selectedSegment) return;
    if (!selectedIds.includes(selectedSegment.id) || editingId !== selectedSegment.id) {
      setSelectedSegment(null);
    }
  }, [selectedIds, editingId, selectedSegment]);

  // ---- Project file handle (for Save / Save As) ----
  const projectHandleRef = useRef(null);

  function normalizeScreenPayload(screen, fallback = {}) {
    const name = String(screen?.name || fallback?.name || "Screen 1").trim() || "Screen 1";
    return {
      id: String(screen?.id || fallback?.id || uid()),
      name,
      shapes: Array.isArray(screen?.shapes) ? screen.shapes : Array.isArray(fallback?.shapes) ? fallback.shapes : [],
      svgOverlays: Array.isArray(screen?.svgOverlays)
        ? screen.svgOverlays
        : Array.isArray(fallback?.svgOverlays)
        ? fallback.svgOverlays
        : [],
      vbW: Number.isFinite(screen?.vbW) ? screen.vbW : Number.isFinite(fallback?.vbW) ? fallback.vbW : 1600,
      vbH: Number.isFinite(screen?.vbH) ? screen.vbH : Number.isFinite(fallback?.vbH) ? fallback.vbH : 900,
      pan:
        screen?.pan && Number.isFinite(screen.pan.x) && Number.isFinite(screen.pan.y)
          ? { x: screen.pan.x, y: screen.pan.y }
          : fallback?.pan && Number.isFinite(fallback.pan.x) && Number.isFinite(fallback.pan.y)
          ? { x: fallback.pan.x, y: fallback.pan.y }
          : { x: 0, y: 0 },
      zoom: Number.isFinite(screen?.zoom) ? screen.zoom : Number.isFinite(fallback?.zoom) ? fallback.zoom : 1,
    };
  }

  function commitCurrentScreenState(sourceScreens = screensRef.current) {
    const list = Array.isArray(sourceScreens) ? sourceScreens.map((s) => normalizeScreenPayload(s)) : [];
    const fallbackId = list[0]?.id || `screen-${Date.now()}`;
    const currentId = String(activeScreenIdRef.current || fallbackId);
    const snapshot = normalizeScreenPayload(
      {
        id: currentId,
        name: screenNameRef.current,
        shapes: shapesRef.current ?? [],
        svgOverlays: overlaysRef.current ?? [],
        vbW: vbWRef.current,
        vbH: vbHRef.current,
        pan: panRef.current,
        zoom: zoomRef.current,
      },
      { id: currentId, name: screenNameRef.current || "Screen 1" }
    );
    const idx = list.findIndex((s) => s.id === currentId);
    if (idx >= 0) list[idx] = snapshot;
    else list.push(snapshot);
    return { list, currentId };
  }

  function hydrateScreenState(screen) {
    const next = normalizeScreenPayload(screen);
    setActiveScreenId(next.id);
    setScreenName(next.name);
    setShapes(next.shapes);
    setSvgOverlays(next.svgOverlays);
    setVbW(next.vbW);
    setVbH(next.vbH);
    setPan(next.pan);
    setZoom(next.zoom);
  }


  function getProjectPayload() {
    const committed = commitCurrentScreenState(screens);
    const effectiveScreenId = committed.currentId || committed.list[0]?.id || "";
    return {
      version: 1,
      name: projectName || "Untitled",
      canvasBackground: normalizeProjectCanvasBackground(projectCanvasBackground),
      plcs: normalizeProjectPlcEntries(projectPlcs, { includeRawText: true }),
      activeScreenId: effectiveScreenId,
      screens: committed.list,
      savedAt: new Date().toISOString(),

      shapes: shapesRef.current ?? [],
      svgOverlays: overlaysRef.current ?? [],

      vbW: vbWRef.current,
      vbH: vbHRef.current,
      pan: panRef.current,
      zoom: zoomRef.current,
    };
  }

  function projectPayloadSignature(payload) {
    if (!payload || typeof payload !== "object") return "";
    const normalizedScreens = Array.isArray(payload.screens)
      ? payload.screens.map((s) => normalizeScreenPayload(s))
      : [];
    const compact = {
      name: payload.name || "",
      canvasBackground: normalizeProjectCanvasBackground(payload.canvasBackground),
      plcs: normalizeProjectPlcEntries(payload.plcs || payload.plcLibrary, { includeRawText: false }),
      activeScreenId: payload.activeScreenId || "",
      screens: normalizedScreens,
      vbW: payload.vbW,
      vbH: payload.vbH,
      pan: payload.pan || { x: 0, y: 0 },
      zoom: payload.zoom,
      shapes: Array.isArray(payload.shapes) ? payload.shapes : [],
      svgOverlays: Array.isArray(payload.svgOverlays) ? payload.svgOverlays : [],
    };
    try {
      return JSON.stringify(compact);
    } catch {
      return "";
    }
  }

  function applyRemoteProjectPayload(data) {
    setProjectCanvasBackground(
      normalizeProjectCanvasBackground(data?.canvasBackground || data?.canvasBackgroundByTheme)
    );
    setProjectPlcs(normalizeProjectPlcEntries(data?.plcs || data?.plcLibrary));
    const fallbackScreen = normalizeScreenPayload(
      {
        id: data?.activeScreenId || "screen-1",
        name: data?.screenName || "Screen 1",
        shapes: Array.isArray(data?.shapes) ? data.shapes : [],
        svgOverlays: Array.isArray(data?.svgOverlays) ? data.svgOverlays : [],
        vbW: data?.vbW,
        vbH: data?.vbH,
        pan: data?.pan,
        zoom: data?.zoom,
      },
      { id: "screen-1", name: "Screen 1" }
    );
    const incoming = Array.isArray(data?.screens) && data.screens.length
      ? data.screens.map((s) => normalizeScreenPayload(s))
      : [fallbackScreen];
    const nextActiveId = String(data?.activeScreenId || incoming[0]?.id || "screen-1");
    const active = incoming.find((s) => s.id === nextActiveId) || incoming[0];
    setScreens(incoming);
    hydrateScreenState(active);
  }

  function applyProjectPayload(data) {
    setProjectCanvasBackground(
      normalizeProjectCanvasBackground(data?.canvasBackground || data?.canvasBackgroundByTheme)
    );
    setProjectPlcs(normalizeProjectPlcEntries(data?.plcs || data?.plcLibrary));
    const fallbackScreen = normalizeScreenPayload(
      {
        id: data?.activeScreenId || "screen-1",
        name: data?.screenName || "Screen 1",
        shapes: Array.isArray(data?.shapes) ? data.shapes : [],
        svgOverlays: Array.isArray(data?.svgOverlays) ? data.svgOverlays : [],
        vbW: data?.vbW,
        vbH: data?.vbH,
        pan: data?.pan,
        zoom: data?.zoom,
      },
      { id: "screen-1", name: "Screen 1" }
    );
    const incoming = Array.isArray(data?.screens) && data.screens.length
      ? data.screens.map((s) => normalizeScreenPayload(s))
      : [fallbackScreen];
    const nextActiveId = String(data?.activeScreenId || incoming[0]?.id || "screen-1");
    const active = incoming.find((s) => s.id === nextActiveId) || incoming[0];

    pushHistory();
    setScreens(incoming);
    hydrateScreenState(active);

    setSelectedIds([]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing(null);
    setDragAll(null);
    setDragHandle(null);
    setOverlayResize(null);
    setMarquee(null);
    setImportAnchor(null);
  }

  function downloadTextFile(filename, text, mime = "application/json;charset=utf-8") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function saveProjectAs() {
    const payload = getProjectPayload();
    const text = JSON.stringify(payload, null, 2);

    // ✅ Best: overwrite same file via File System Access API
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${(projectName || "project").replace(/[^\w\- ]+/g, "").trim() || "project"}.json`,
        types: [
          {
            description: "Project JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();

      projectHandleRef.current = handle;
      // update name from file (nice UX)
      if (handle?.name) setProjectName(handle.name.replace(/\.json$/i, ""));
      return;
    }

    // ✅ Fallback: browser can't overwrite → downloads a new file
    downloadTextFile(`${projectName || "project"}.json`, text);
  }

  async function saveProject() {
    const payload = getProjectPayload();
    const text = JSON.stringify(payload, null, 2);

    // ✅ If we already have a handle, overwrite the same file
    const handle = projectHandleRef.current;
    if (handle?.createWritable) {
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    }

    // otherwise do Save As
    await saveProjectAs();
  }

  async function loadProjectViaPicker() {
    // ✅ Best: File System Access API open picker
    if (window.showOpenFilePicker) {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Project JSON",
            accept: { "application/json": [".json"] },
          },
        ],
      });

      const file = await handle.getFile();
      const text = await file.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        alert("Invalid JSON file.");
        return;
      }

      applyProjectPayload(data);

      // ✅ remember this file so Save overwrites it next time
      projectHandleRef.current = handle;
      if (handle?.name) setProjectName(handle.name.replace(/\.json$/i, ""));
      return;
    }

    // ✅ Fallback: trigger hidden <input type=file> (your existing projectFileRef approach)
    projectFileRef.current?.click();
  }


  // optional: remember last project name across reloads
  useEffect(() => {
    const savedName = localStorage.getItem("vizi_project_name");
    if (savedName) setProjectName(savedName);
  }, []);

  useEffect(() => {
    let alive = true;
    let bootstrappedProject = false;
    async function loadProjects() {
      try {
        const res = await fetch("/api/projects");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load projects.");
        if (!alive) return;
        const list = Array.isArray(data.projects) ? data.projects : [];
        setProjects(list);
        if (!bootstrappedProject && list.length) {
          const stored = localStorage.getItem("vizi_active_project_id") || "";
          const preferred = list.find((p) => p?.id === stored) || list[0];
          if (preferred?.id) {
            bootstrappedProject = true;
            setActiveProjectId(preferred.id);
            openProjectFromDb(preferred.id);
          }
        } else if (!bootstrappedProject && !list.length) {
          bootstrappedProject = true;
          setTimeout(() => {
            saveProjectToDb({ silent: true });
          }, 0);
        }
      } catch {
        // ignore
      }
    }
    loadProjects();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadProjects();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;

    const filterRowsForActiveProject = (rows) => {
      const list = Array.isArray(rows) ? rows : [];
      const pid = normalizeTagValue(activeProjectId);
      if (!pid) return list;
      const hasProjectField = list.some(
        (row) =>
          row &&
          typeof row === "object" &&
          (Object.prototype.hasOwnProperty.call(row, "project_id") ||
            Object.prototype.hasOwnProperty.call(row, "projectId"))
      );
      if (!hasProjectField) return list;
      return list.filter((row) => {
        const rowPid = normalizeTagValue(row?.project_id ?? row?.projectId ?? "");
        return rowPid === pid;
      });
    };

    async function loadProjectRoutes() {
      if (!activeProjectId) {
        if (alive) setProjectRouteRows([]);
        return;
      }
      try {
        const pid = encodeURIComponent(normalizeTagValue(activeProjectId));
        const res = await fetch(`/api/db/routes?limit=2000&project_id=${pid}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load routes.");
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        if (rows.length > 0) {
          if (alive) setProjectRouteRows(filterRowsForActiveProject(rows));
          return;
        }

        // Fallback for schemas/endpoints that do not support project_id filtering.
        const allRes = await fetch("/api/db/routes?limit=2000");
        const allData = await allRes.json();
        if (!allRes.ok) throw new Error(allData?.error || "Failed to load routes.");
        const allRows = Array.isArray(allData?.rows) ? allData.rows : [];
        if (alive) setProjectRouteRows(filterRowsForActiveProject(allRows));
      } catch {
        if (alive) setProjectRouteRows([]);
      }
    }

    loadProjectRoutes();
    return () => {
      alive = false;
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem("vizi_active_project_id", activeProjectId);
    } else {
      localStorage.removeItem("vizi_active_project_id");
    }
  }, [activeProjectId]);

  async function saveProjectToDb(options = {}) {
    try {
      const silent = options?.silent === true;
      if (projectSaveInFlightRef.current) {
        const nextMode = silent ? "silent" : "manual";
        const prevMode = queuedSaveAfterFlightRef.current;
        if (prevMode !== "manual") queuedSaveAfterFlightRef.current = nextMode;
        if (!silent) setProjectStatus("Saving...");
        return;
      }
      projectSaveInFlightRef.current = true;
      if (!silent) setProjectStatus("");
      const payload = getProjectPayload();
      const trimmedName = String(payload?.name || "").trim();
      const effectiveName = trimmedName || "Untitled";
      if (!trimmedName && projectName !== effectiveName) {
        setProjectName(effectiveName);
      }
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeProjectId || undefined,
          name: effectiveName,
          data: { ...payload, name: effectiveName },
          teamMerge: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed.");
      const next = data.project;
      if (next?.data) {
        applyRemoteProjectPayload(next.data);
        lastProjectSignatureRef.current = projectPayloadSignature(next.data);
      } else {
        lastProjectSignatureRef.current = projectPayloadSignature(payload);
      }
      if (next?.id) setActiveProjectId(next.id);
      if (next?.updated_at) setActiveProjectUpdatedAt(String(next.updated_at));
      setActiveProjectUpdatedBy(String(next?.updated_by_username || ""));
      if (!silent) {
        const by = String(next?.updated_by_username || "").trim();
        setProjectStatus(by ? `Saved (by ${by})` : "Saved");
      }
      setShowProjectNameInput(false);
      const reload = await fetch("/api/projects");
      const payloadList = await reload.json();
      if (reload.ok) setProjects(payloadList.projects || []);
    } catch (err) {
      if (!options?.silent) setProjectStatus(err?.message || "Save failed.");
    } finally {
      projectSaveInFlightRef.current = false;
      const queued = queuedSaveAfterFlightRef.current;
      if (queued) {
        queuedSaveAfterFlightRef.current = null;
        setTimeout(() => {
          saveProjectToDb({ silent: queued !== "manual" });
        }, 0);
      }
    }
  }

  function flushScheduledProjectSave() {
    if (!pendingSilentSaveRef.current) return;
    if (projectSaveInFlightRef.current) {
      autoSaveTimerRef.current = setTimeout(flushScheduledProjectSave, 350);
      return;
    }
    pendingSilentSaveRef.current = false;
    saveProjectToDb({ silent: true });
  }

  function scheduleProjectAutoSave(delayMs = 450) {
    pendingSilentSaveRef.current = true;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(flushScheduledProjectSave, delayMs);
  }

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    },
    []
  );

  async function openProjectFromDb(id) {
    if (!id) return;
    try {
      setProjectStatus("");
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Load failed.");
      applyProjectPayload(data?.data || {});
      setProjectName(data?.name || "Untitled");
      setActiveProjectId(data?.id || "");
      setActiveProjectUpdatedAt(String(data?.updated_at || ""));
      setActiveProjectUpdatedBy(String(data?.updated_by_username || ""));
      lastProjectSignatureRef.current = projectPayloadSignature(data?.data || {});
      projectHandleRef.current = null;
      const by = String(data?.updated_by_username || "").trim();
      setProjectStatus(by ? `Loaded (last update by ${by})` : "Loaded");
      setShowProjectNameInput(false);
    } catch (err) {
      setProjectStatus(err?.message || "Load failed.");
    }
  }

  async function deleteProjectFromDb(id) {
    if (!id) return;
    try {
      setProjectStatus("");
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed.");
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProjectId === id) setActiveProjectId("");
      setProjectStatus("Deleted");
    } catch (err) {
      setProjectStatus(err?.message || "Delete failed.");
    }
  }

  function newProjectFromDb() {
    applyProjectPayload({
      activeScreenId: "screen-1",
      screens: [
        {
          id: "screen-1",
          name: "Screen 1",
          shapes: [],
          svgOverlays: [],
          vbW: 1600,
          vbH: 900,
          pan: { x: 0, y: 0 },
          zoom: 1,
        },
      ],
    });
    setProjectName("Untitled");
    setProjectCanvasBackground(normalizeProjectCanvasBackground(null));
    setScreenName("Screen 1");
    setActiveScreenId("screen-1");
    setScreens([
      {
        id: "screen-1",
        name: "Screen 1",
        shapes: [],
        svgOverlays: [],
        vbW: 1600,
        vbH: 900,
        pan: { x: 0, y: 0 },
        zoom: 1,
      },
    ]);
    setActiveProjectId("");
    localStorage.removeItem("vizi_active_project_id");
    setActiveProjectUpdatedAt("");
    setActiveProjectUpdatedBy("");
    lastProjectSignatureRef.current = projectPayloadSignature({
      name: "Untitled",
      canvasBackground: normalizeProjectCanvasBackground(null),
      vbW: 1600,
      vbH: 900,
      pan: { x: 0, y: 0 },
      zoom: 1,
      activeScreenId: "screen-1",
      screens: [
        {
          id: "screen-1",
          name: "Screen 1",
          shapes: [],
          svgOverlays: [],
          vbW: 1600,
          vbH: 900,
          pan: { x: 0, y: 0 },
          zoom: 1,
        },
      ],
      shapes: [],
      svgOverlays: [],
    });
    projectHandleRef.current = null;
    setProjectStatus("");
    setShowProjectNameInput(true);
  }

  function cancelNewProjectInput() {
    setShowProjectNameInput(false);
    if (!activeProjectId) setProjectName("Untitled");
  }

  useEffect(() => {
    if (!activeProjectId) return;
    let alive = true;
    async function pollProject() {
      if (!isPageVisible) return;
      try {
        const res = await fetch(`/api/projects/${activeProjectId}`);
        const data = await res.json();
        if (!res.ok || !alive) return;
        const remoteUpdatedAt = String(data?.updated_at || "");
        if (!remoteUpdatedAt || remoteUpdatedAt === activeProjectUpdatedAt) return;
        const remoteSig = projectPayloadSignature(data?.data || {});
        const localSig = projectPayloadSignature(getProjectPayload());
        const localDirty = localSig !== lastProjectSignatureRef.current;
        if (localDirty) {
          setProjectStatus("Remote update detected. Auto-merging...");
          await saveProjectToDb({ silent: true });
          return;
        }
        applyRemoteProjectPayload(data?.data || {});
        lastProjectSignatureRef.current = remoteSig;
        setActiveProjectUpdatedAt(remoteUpdatedAt);
        const by = String(data?.updated_by_username || "");
        setActiveProjectUpdatedBy(by);
        setProjectStatus(by ? `Synced (updated by ${by})` : "Synced");
      } catch {
        // ignore sync failures
      }
    }
    const id = setInterval(pollProject, isPageVisible ? 3000 : 12000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [activeProjectId, activeProjectUpdatedAt, isPageVisible]);

  useEffect(() => {
    if (!activeProjectId || !isPageVisible) return;
    const id = setInterval(() => {
      const sig = projectPayloadSignature(getProjectPayload());
      if (!sig) return;
      if (sig === lastProjectSignatureRef.current) return;
      saveProjectToDb({ silent: true });
    }, 2500);
    return () => clearInterval(id);
  }, [activeProjectId, projectName, projectCanvasBackground, projectPlcs, activeScreenId, screenName, screens, vbW, vbH, pan, zoom, shapes, svgOverlays, isPageVisible]);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectCursors([]);
      lastCursorSentRef.current = { at: 0, x: NaN, y: NaN };
      return;
    }
    let alive = true;
    async function pollCursors() {
      if (!isPageVisible) return;
      try {
        const res = await fetch(`/api/projects/${activeProjectId}/cursors`);
        const data = await res.json();
        if (!res.ok || !alive) return;
        setProjectCursors(Array.isArray(data?.cursors) ? data.cursors : []);
      } catch {
        // ignore cursor polling failures
      }
    }
    pollCursors();
    const id = setInterval(pollCursors, isPageVisible ? 1000 : 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [activeProjectId, isPageVisible]);

  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return;
      const key = (e.key || "").toLowerCase();
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      if (key === "c") {
        e.preventDefault();
        copySelection();
      } else if (key === "v") {
        e.preventDefault();
        pasteClipboard();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    function onDown() {
      if (contextMenu) setContextMenu(null);
      if (polyHandleMenu) setPolyHandleMenu(null);
    }
    function onKey(e) {
      if (e.key === "Escape") setContextMenu(null);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) {
      setContextSvgMenuOpen(false);
      setContextSvgTagQuery("");
    }
  }, [contextMenu]);

  useEffect(() => {
    function onKeyDown(e) {
      if (!contextSvgMenuOpen) return;
      const t = e.target;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
      const input = svgMenuInputRef.current;
      if (!input) return;
      if (e.key.length === 1 || e.key === "Backspace") {
        input.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextSvgMenuOpen]);
  useEffect(() => {
    localStorage.setItem("vizi_project_name", projectName || "Untitled");
  }, [projectName]);


  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return;

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (!mod) return;

      const k = (e.key || "").toLowerCase();

      // Undo: Cmd/Ctrl+Z
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Cmd/Ctrl+Shift+Z (common on Mac)
      if (k === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      // Redo: Cmd/Ctrl+Y (common on Windows)
      if (k === "y") {
        e.preventDefault();
        redo();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);


  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return;

      const key = (e.key || "").toLowerCase();
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && key === "d") {
        e.preventDefault();
        e.stopPropagation();
        duplicateSelectedStable();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);



  // Floating panel visibility
  const TOP_BAR_H = 56;
  const RULER_SIZE = 24;
  const [zoomPos, setZoomPos] = useState({
    x: 16,
    y: TOP_BAR_H + RULER_SIZE + 140,
  });
  const zoomDragRef = useRef({ dragging: false, ox: 0, oy: 0, panelW: 64, panelH: 240 });
  const zoomPosRef = useRef(zoomPos);
  const zoomPanelRef = useRef(null);
  const [showHUD, setShowHUD] = useState(false);
  const [showMainDrawer, setShowMainDrawer] = useState(false);
  const [drawerView, setDrawerView] = useState("ai");
  const [databaseTab, setDatabaseTab] = useState("data");
  const [showUserDrawer, setShowUserDrawer] = useState(false);
  const getViewportSize = () => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1400,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  });
  const { w: initialVpW } = getViewportSize();
  const [drawerSizes, setDrawerSizes] = useState({
    main: { w: Math.min(900, Math.floor(initialVpW * 0.96)) },
    user: { w: Math.min(620, Math.floor(initialVpW * 0.96)) },
    project: { w: Math.min(360, Math.floor(initialVpW * 0.92)) },
  });
  const drawerResizeRef = useRef({
    active: null,
    startX: 0,
    originW: 0,
  });
  const mainDrawerRef = useRef(null);
  const userDrawerRef = useRef(null);
  const projectDrawerRef = useRef(null);
  const [theme, setTheme] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "dark" || stored === "light") return stored;
    } catch {
      // ignore
    }
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  });
  const [profileDraft, setProfileDraft] = useState({ username: "", display_name: "", avatar_url: "" });
  const [passwordDraft, setPasswordDraft] = useState({ current: "", next: "" });
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");

  useEffect(() => {
    if (!showMainDrawer) return;
    setContextMenu(null);
    setPolyHandleMenu(null);
    setContextSvgMenuOpen(false);
    setContextSvgTagQuery("");
  }, [showMainDrawer, drawerView]);

  useEffect(() => {
    const msg = String(projectStatus || "").trim();
    if (!msg) return;
    if (msg.toLowerCase() === "saving...") return;
    toastSuccess(msg);
  }, [projectStatus]);

  useEffect(() => {
    const ok = String(profileStatus || "").trim();
    if (ok) toastSuccess(ok);
    const err = String(profileError || "").trim();
    if (err) toastError(err);
  }, [profileStatus, profileError]);

  function beginDrawerResize(which, e, disabled = false) {
    if (disabled) return;
    if (e.button !== 0) return;
    const current = drawerSizes?.[which] || { w: 0 };
    drawerResizeRef.current = {
      active: which,
      startX: e.clientX,
      originW: Number(current.w) || 0,
    };
    e.preventDefault();
    e.stopPropagation();
  }

  useEffect(() => {
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    function onMove(e) {
      const resize = drawerResizeRef.current;
      if (resize?.active) {
        const key = resize.active;
        const vpW = window.innerWidth;
        const minW = key === "project" ? 280 : 420;
        const maxW = Math.max(minW, Math.floor(vpW * (key === "project" ? 0.92 : 0.96)));
        const dx = e.clientX - resize.startX;
        const widthDelta = key === "project" ? dx : -dx;
        const nextW = clamp(resize.originW + widthDelta, minW, maxW);
        setDrawerSizes((prev) => ({
          ...prev,
          [key]: { w: nextW },
        }));
      }
    }
    function onUp() {
      drawerResizeRef.current.active = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [TOP_BAR_H]);

  useEffect(() => {
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const onResize = () => {
      const vpW = window.innerWidth;
      setDrawerSizes((prev) => ({
        main: {
          w: clamp(prev.main.w, 420, Math.max(420, Math.floor(vpW * 0.96))),
        },
        user: {
          w: clamp(prev.user.w, 420, Math.max(420, Math.floor(vpW * 0.96))),
        },
        project: {
          w: clamp(prev.project.w, 280, Math.max(280, Math.floor(vpW * 0.92))),
        },
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [TOP_BAR_H]);

  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    zoomPosRef.current = zoomPos;
  }, [zoomPos]);

  useEffect(() => {
    function onMove(e) {
      if (!zoomDragRef.current.dragging) return;
      const minTop = TOP_BAR_H + RULER_SIZE + 8;
      const panelW = zoomDragRef.current.panelW || zoomPanelRef.current?.getBoundingClientRect()?.width || 64;
      const panelH = zoomDragRef.current.panelH || zoomPanelRef.current?.getBoundingClientRect()?.height || 240;
      const nextLeft = Math.max(8, e.clientX - zoomDragRef.current.ox);
      const maxLeft = Math.max(8, window.innerWidth - panelW - 8);
      const nextTop = Math.max(minTop, e.clientY - zoomDragRef.current.oy);
      const maxTop = Math.max(minTop, window.innerHeight - panelH - 8);
      setZoomPos({
        x: Math.min(nextLeft, maxLeft),
        y: Math.min(nextTop, maxTop),
      });
    }

    function onUp() {
      zoomDragRef.current.dragging = false;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [TOP_BAR_H, RULER_SIZE]);

  function startZoomDrag(e) {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = zoomPanelRef.current?.getBoundingClientRect();
    zoomDragRef.current.dragging = true;
    zoomDragRef.current.ox = e.clientX - (zoomPosRef.current?.x ?? 16);
    zoomDragRef.current.oy = e.clientY - (zoomPosRef.current?.y ?? TOP_BAR_H + RULER_SIZE + 140);
    zoomDragRef.current.panelW = rect?.width || 64;
    zoomDragRef.current.panelH = rect?.height || 240;
  }

  useEffect(() => {
    if (!showHUD) setPanelCursor(null);
  }, [showHUD]);
  useEffect(() => {
    if (!showTagPaths && hiddenTagBubbleIds.length) {
      setHiddenTagBubbleIds([]);
    }
  }, [showTagPaths, hiddenTagBubbleIds.length]);
  useEffect(() => {
    if (importOpen) setShowHUD(false);
  }, [importOpen]);
  useEffect(() => {
    if (widgetOpen) setShowHUD(false);
  }, [widgetOpen]);

  useEffect(() => {
    if (tool === "polyline") setShowHUD(false);
  }, [tool]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Alt") setAltDown(true);
    }
    function onKeyUp(e) {
      if (e.key === "Alt") setAltDown(false);
    }
    function onBlur() {
      setAltDown(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  function openDrawer(view) {
    const next = view || "ai";
    setMainDrawerFullscreen(false);
    setDrawerView(next);
    if (next === "database")
      setDatabaseTab((prev) => (prev === "dataset" || prev === "config" || prev === "designer" ? prev : "data"));
    setShowMainDrawer(true);
  }

  useEffect(() => {
    if (!user) return;
    setProfileDraft({
      username: user.username || "",
      display_name: user.display_name || "",
      avatar_url: user.avatar_url || "",
    });
  }, [user]);

  useEffect(() => {
    const next = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document.body.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  }, [theme]);

  const avatarLabel = useMemo(() => {
    const name = String(user?.display_name || user?.username || "").trim();
    if (!name) return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }, [user]);


  // ✅ ZOOM (main svg)
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 8;
  const ZOOM_STEP = 1.15;


  const applySingleTextValue = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, text: String(v ?? "") } : s)));
  };

  const applySingleFontSize = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    const n = Number.parseFloat(v);
    if (!Number.isFinite(n) || n <= 1) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, fontSize: n } : s)));
  };

  const applySingleFontFamily = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    setShapes((prev) =>
      prev.map((s) => (s.id === singleId ? { ...s, fontFamily: String(v ?? "").trim() } : s))
    );
  };

  const applySingleFontWeight = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    const next = String(v ?? "").trim();
    if (!next) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, fontWeight: next } : s)));
  };

  const applySingleTextAlign = (v) => {
    if (!isSingle || singleKind !== "Text" || !singleId) return;
    const a = v === "middle" || v === "end" ? v : "start";
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, anchor: a } : s)));
  };

  function lineStyleToStrokeProps(style, strokeWidth) {
    const sw = Math.max(1, Number(strokeWidth) || 1);
    switch (style) {
      case "dashed":
        return { dasharray: `${sw * 4} ${sw * 2}` };
      case "dotted":
        return { dasharray: `${sw} ${sw * 2}`, linecap: "round" };
      case "wavy":
        return { dasharray: `${sw * 1.5} ${sw * 1.5}`, linecap: "round", linejoin: "round" };
      default:
        return {};
    }
  }

  function convertSelectedPolylinesToSvg() {
    const ids = selectedIds || [];
    if (!ids.length) return;

    const selectedShapes = shapes.filter((s) => ids.includes(s.id));
    if (!selectedShapes.length) return;

    const escapeXml = (v) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const polyParts = [];
    const rectParts = [];
    const textParts = [];

    for (const s of selectedShapes) {
      if (s.type === "polyline" || Array.isArray(s.points)) {
        if (!Array.isArray(s.points) || s.points.length < 2) continue;
        const bb = bboxOfPoints(s.points);
        if (!bb) continue;

        minX = Math.min(minX, bb.minX);
        minY = Math.min(minY, bb.minY);
        maxX = Math.max(maxX, bb.maxX);
        maxY = Math.max(maxY, bb.maxY);

        polyParts.push(s);
        continue;
      }

      if (s.type === "rect") {
        const x = Number(s.x ?? 0);
        const y = Number(s.y ?? 0);
        const w = Math.max(0, Number(s.width ?? 0));
        const h = Math.max(0, Number(s.height ?? 0));
        if (w <= 0 || h <= 0) continue;

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
        rectParts.push(s);
        continue;
      }

      if (s.type === "text") {
        const fontSize = Number(s.fontSize ?? 24);
        const text = String(s.text ?? "");
        const estW = Math.max(10, text.length * fontSize * 0.6);
        const estH = Math.max(10, fontSize * 1.2);
        const anchor = s.anchor || "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;

        minX = Math.min(minX, Number(s.x ?? 0) + ax);
        minY = Math.min(minY, Number(s.y ?? 0));
        maxX = Math.max(maxX, Number(s.x ?? 0) + ax + estW);
        maxY = Math.max(maxY, Number(s.y ?? 0) + estH);

        textParts.push({
          ...s,
          _estW: estW,
          _estH: estH,
          _anchor: anchor,
        });
      }
    }

    if ((!polyParts.length && !rectParts.length && !textParts.length) || !Number.isFinite(minX)) {
      return;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    const polyInner = polyParts
      .map((s) => {
        const localPoints = s.points.map((p) => ({
          x: Number(p.x) - minX,
          y: Number(p.y) - minY,
        }));

        const pointsAttr = localPoints.map((p) => `${p.x},${p.y}`).join(" ");
        const stroke = s.stroke || DEFAULT_STROKE;
        const fill = s.fill || DEFAULT_FILL;
        const strokeWidth = Number(s.strokeWidth) || 3;
        const style = lineStyleToStrokeProps(s.lineStyle ?? "solid", strokeWidth);

        const dashAttr = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : "";
        const linecap = style.linecap ?? "round";
        const linejoin = style.linejoin ?? "round";

        return `<polyline points="${pointsAttr}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />`;
      })
      .join("");

    const rectInner = rectParts
      .map((s) => {
        const x = Number(s.x ?? 0) - minX;
        const y = Number(s.y ?? 0) - minY;
        const width = Math.max(0, Number(s.width ?? 0));
        const height = Math.max(0, Number(s.height ?? 0));
        const stroke = s.stroke || DEFAULT_STROKE;
        const fill = s.fill || "transparent";
        const strokeWidth = Number(s.strokeWidth) || 3;
        const style = lineStyleToStrokeProps(s.lineStyle ?? "solid", strokeWidth);
        const dashAttr = style.dasharray ? ` stroke-dasharray="${style.dasharray}"` : "";
        const linecap = style.linecap ?? "round";
        const linejoin = style.linejoin ?? "round";

        return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${linecap}" stroke-linejoin="${linejoin}"${dashAttr} />`;
      })
      .join("");

    const textInner = textParts
      .map((t) => {
        const x = Number(t.x ?? 0) - minX;
        const y = Number(t.y ?? 0) - minY;
        const fill = t.fill || "#808080";
        const fontSize = Number(t.fontSize ?? 24);
        const fontFamily = t.fontFamily || "system-ui";
        const fontWeight = t.fontWeight || "400";
        const textAnchor = t._anchor || "start";
        const text = escapeXml(t.text ?? "");

        return `<text x="${x}" y="${y}" fill="${fill}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="${fontWeight}" text-anchor="${textAnchor}" dominant-baseline="text-before-edge">${text}</text>`;
      })
      .join("");

    // Ensure text is always on top
    const inner = `${polyInner}${rectInner}${textInner}`;

    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${inner}</svg>`;
    const genKey = addGeneratedSvg(
      `Selection-Group-${polyParts.length + rectParts.length + textParts.length}`,
      raw
    );
    const stroke = polyParts[0]?.stroke || rectParts[0]?.stroke || DEFAULT_STROKE;
    const fill = polyParts[0]?.fill || rectParts[0]?.fill || textParts[0]?.fill || DEFAULT_FILL;
    const tagPath =
      selectedShapes.length === 1 ? (selectedShapes[0]?.tagPath || "") : "";

    const overlaysToAdd = [
      {
        id: uid(),
        sourceKey: genKey,
        name: genKey.split("/").pop() || "Selection-Group",
        inner,
        tx: minX,
        ty: minY,
        scale: 1,
        fill,
        stroke,
        tagPath,
        bbox: { x: 0, y: 0, width, height },
      },
    ];

    pushHistory();
    setShapes((prev) => prev.filter((x) => !ids.includes(x.id)));
    setSvgOverlays((prev) => [...prev, ...overlaysToAdd]);
    setSelectedIds([]);
    setSelectedOverlayIds(overlaysToAdd.map((o) => o.id));
    setEditingId(null);
  }


  const applyViewBox = ({ w, h }) => {
    setVbW(w);
    setVbH(h);
    // resetView?.(); // if you want
  };

  const clampZoom = (z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

  function zoomIn() {
    setZoom((z) => clampZoom(+(z * ZOOM_STEP).toFixed(4)));
  }
  function zoomOut() {
    setZoom((z) => clampZoom(+(z / ZOOM_STEP).toFixed(4)));
  }
  function zoomReset() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  async function onPickProjectFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      alert("Invalid JSON file.");
      return;
    }

    applyProjectPayload(data || {});
  }

  function buildProjectPayload() {
    const committed = commitCurrentScreenState(screens);
    return {
      version: 1,
      name: projectName,
      plcs: normalizeProjectPlcEntries(projectPlcs),
      activeScreenId: committed.currentId,
      screens: committed.list,
      savedAt: new Date().toISOString(),
      vbW,
      vbH,
      pan,
      zoom,
      shapes,
      svgOverlays,
    };
  }

  function exportProjectJson() {
    const payload = buildProjectPayload();

    async function saveProjectAs() {
      const data = buildProjectPayload();
      const json = JSON.stringify(data, null, 2);

      // ✅ Preferred: File System Access API (real overwrite)
      if ("showSaveFilePicker" in window) {
        const handle = await window.showSaveFilePicker({
          suggestedName: `${projectName || "project"}.json`,
          types: [
            {
              description: "Mesora Project",
              accept: { "application/json": [".json"] },
            },
          ],
        });

        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();

        setProjectHandle(handle);

        // best-effort name
        if (handle?.name) setProjectName(handle.name.replace(/\.json$/i, ""));
        return;
      }

      // 🟡 Fallback: download (cannot overwrite same file in most browsers)
      downloadTextFile(`${projectName || "project"}.json`, json, "application/json;charset=utf-8");
    }

    async function saveProject() {
      const data = buildProjectPayload();
      const json = JSON.stringify(data, null, 2);

      // If we already have a handle, overwrite it
      if (projectHandle && "showSaveFilePicker" in window) {
        const writable = await projectHandle.createWritable();
        await writable.write(json);
        await writable.close();
        return;
      }

      // otherwise behave like Save As
      await saveProjectAs();
    }

    function newProject() {
      pushHistory();

      setShapes([]);
      setSvgOverlays([]);
      setSelectedIds([]);
      setSelectedOverlayIds([]);
      setEditingId(null);
      setDrawing(null);
      setDragAll(null);
      setDragHandle(null);
      setOverlayResize(null);
      setMarquee(null);
      setImportAnchor(null);

      setZoom(1);
      setPan({ x: 0, y: 0 });

      // “forget” current file
      setProjectHandle(null);
      setProjectName("Untitled");
    }


    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "vizi-project.json";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  }

  function importProjectJson() {
    const input = projectFileRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }




  function approxTextBBox(t) {
    if (!t) return null;

    const x = Number(t.x ?? 0);
    const y = Number(t.y ?? 0);

    const fontSize = Number(t.fontSize ?? 16);
    const text = String(t.text ?? "");

    // ✅ If you store width/height, prefer that
    const wStored = Number(t.w);
    const hStored = Number(t.h);
    if (Number.isFinite(wStored) && Number.isFinite(hStored)) {
      return { x, y, w: wStored, h: hStored };
    }

    // ✅ Cheap approximation so properties panel works immediately
    const w = Math.max(8, text.length * fontSize * 0.6);
    const h = Math.max(8, fontSize * 1.2);

    return { x, y, w, h };
  }


  // --- Undo / Redo -------------------------------------------------
  const historyRef = useRef({ past: [], future: [] });

  const lastRightClickRef = useRef(0);
  const RIGHT_DBL_MS = 350;

  // Use structuredClone if available (best), fallback to JSON
  function deepClone(v) {
    if (typeof structuredClone === "function") return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  function getSnapshot() {
    return {
      shapes: deepClone(shapesRef.current),
      svgOverlays: deepClone(overlaysRef.current),
      selectedIds: deepClone(selPolyRef.current),
      selectedOverlayIds: deepClone(selOverRef.current),
      editingId,
      // optional: include these if you want undo to restore them too
      // pan, zoom, vbW, vbH,
    };
  }

  function applySnapshot(snap) {
    setShapes(snap.shapes || []);
    setSvgOverlays(snap.svgOverlays || []);
    setSelectedIds(snap.selectedIds || []);
    setSelectedOverlayIds(snap.selectedOverlayIds || []);
    setEditingId(snap.editingId ?? null);
    setDrawing(null);
    setDragAll(null);
    setDragHandle(null);
    setOverlayResize(null);
    setMarquee(null);
  }

  function pushHistory() {
    historyRef.current.past.push(getSnapshot());
    historyRef.current.future = []; // clear redo on new action
  }

  function undo() {
    const h = historyRef.current;
    if (!h.past.length) return;
    const current = getSnapshot();
    const prev = h.past.pop();
    h.future.push(current);
    applySnapshot(prev);
  }

  function redo() {
    const h = historyRef.current;
    if (!h.future.length) return;
    const current = getSnapshot();
    const next = h.future.pop();
    h.past.push(current);
    applySnapshot(next);
  }

  function parseLen(v) {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const n = Number.parseFloat(s); // handles "3.8mm", "800px", "800"
    return Number.isFinite(n) ? n : null;
  }

  function extractKeySize(rawSvg) {
    try {
      const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) return null;

      // ✅ 1) Root <svg> itself (your Inkscape files store it here)
      const rootW = parseLen(svg.getAttribute("kewidth"));
      const rootH = parseLen(svg.getAttribute("keheight"));
      if (rootW > 0 && rootH > 0) return { w: rootW, h: rootH };

      // ✅ 2) Any descendant element with kewidth/keheight
      const node = svg.querySelector("[kewidth][keheight]");
      if (node) {
        const w = parseLen(node.getAttribute("kewidth"));
        const h = parseLen(node.getAttribute("keheight"));
        if (w > 0 && h > 0) return { w, h };
      }

      // 3) Fallback: svg width/height (supports units via parseFloat)
      const wAttr = parseLen(svg.getAttribute("width"));
      const hAttr = parseLen(svg.getAttribute("height"));
      if (wAttr > 0 && hAttr > 0) return { w: wAttr, h: hAttr };

      // 4) Fallback: viewBox
      const vb = svg.getAttribute("viewBox");
      if (vb) {
        const parts = vb.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4) {
          const vbW = parts[2];
          const vbH = parts[3];
          if (Number.isFinite(vbW) && Number.isFinite(vbH) && vbW > 0 && vbH > 0) {
            return { w: vbW, h: vbH };
          }
        }
      }
    } catch { }
    return null;
  }



  function rectFrom2Points(a, b) {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function constrainHV(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // lock to whichever axis is stronger
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: to.x, y: from.y }; // horizontal
    }
    return { x: from.x, y: to.y }; // vertical
  }


  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function rectsIntersect(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }

  // ✅ Mouse wheel zoom handler
  function onWheelZoom(e) {
    e.preventDefault();

    // Zoom wins first
    if (e.ctrlKey || e.metaKey) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        setZoom((z) => clampZoom(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP));
        return;
      }
      return;
    }

    const factor = e.deltaMode === 1 ? 20 : 1; // line → px

    let dx = 0;
    let dy = 0;

    if (e.shiftKey) {
      // 🔥 SHIFT = horizontal pan
      dx = e.deltaY * factor;
    } else {
      // normal vertical pan
      dy = e.deltaY * factor;
      dx = e.deltaX * factor; // trackpad horizontal still works
    }

    setPan((p) => ({
      x: p.x - dx * PAN_SPEED,
      y: p.y - dy * PAN_SPEED,
    }));
  };



  const [generatedSvgs, setGeneratedSvgs] = useState([]);
  const persistSvgMeta = async (w, h) => {
    if (!isSingle || singleKind !== "SVG" || !singleId) return;
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    const o = svgOverlays.find((x) => x.id === singleId);
    if (!o?.sourceKey) return;
    if (String(o.sourceKey).startsWith("__generated__/")) return;
    try {
      await fetch("/__vizi__/set-svg-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileKey: o.sourceKey,
          kewidth: w,
          keheight: h,
        }),
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("viziGeneratedSvgs");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data)) setGeneratedSvgs(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("viziGeneratedSvgs", JSON.stringify(generatedSvgs));
    } catch {
      // ignore
    }
  }, [generatedSvgs]);

  const generatedSvgMap = useMemo(() => {
    const map = new Map();
    for (const g of generatedSvgs) {
      if (!g?.key || !g?.raw) continue;
      map.set(g.key, g.raw);
    }
    return map;
  }, [generatedSvgs]);

  const svgFiles = useMemo(() => {
    const base = Object.keys(SVG_LIBRARY).map((k) => ({ key: k, name: k.split("/").pop() || k }));
    const generated = generatedSvgs.map((g) => ({
      key: g.key,
      name: g.name || g.key.split("/").pop() || g.key,
    }));
    return [...base, ...generated].sort((a, b) => a.name.localeCompare(b.name));
  }, [generatedSvgs]);

  const contextGrouped = useMemo(() => {
    const q = String(contextImportQuery || "").trim().toLowerCase();
    const list = Array.isArray(svgFiles) ? svgFiles : [];

    const filtered = list.filter((f) => {
      if (!q) return true;
      const name = String(f?.name || "").toLowerCase();
      const key = String(f?.key || "").toLowerCase();
      return name.includes(q) || key.includes(q);
    });

    const map = new Map();
    for (const f of filtered) {
      const folder = getFolderFromKey(f.key);
      if (!map.has(folder)) map.set(folder, []);
      map.get(folder).push(f);
    }

    const folders = Array.from(map.keys()).sort((a, b) => {
      if (a === "Root") return -1;
      if (b === "Root") return 1;
      const da = a.split(" / ").length;
      const db = b.split(" / ").length;
      if (da !== db) return da - db;
      return a.localeCompare(b);
    });

    return folders.map((folder) => ({
      folder,
      files: map.get(folder).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [svgFiles, contextImportQuery]);

  const selCount = selectedIds.length + selectedOverlayIds.length;
  const isSingle = selCount === 1;
  const singleSelectedOverlayId =
    selectedOverlayIds.length === 1 && selectedIds.length === 0 ? selectedOverlayIds[0] : null;
  const singleKind = useMemo(() => {
    if (!isSingle) return null;

    if (selectedIds.length === 1) {
      const id = selectedIds[0];
      const s = shapes.find((x) => x.id === id);
      if (!s) return null;

      if (s.type === "text") return "Text";
      if (s.type === "rect") return "Polyline";
      if (s.type === "polyline" || Array.isArray(s.points)) return "Polyline";

      return "Shape";
    }

    if (selectedOverlayIds.length === 1) {
      const id = selectedOverlayIds[0];
      const o = svgOverlays.find((x) => x.id === id);
      if (o?.widget) return "Widget";
      return "SVG";
    }
    return null;
  }, [isSingle, selectedIds, selectedOverlayIds, shapes, svgOverlays]);

  const singleOverlay = useMemo(
    () => svgOverlays.find((o) => o.id === singleSelectedOverlayId),
    [svgOverlays, singleSelectedOverlayId]
  );
  const singleSvgTemplateKey =
    singleOverlay?.sourceKey ||
    svgFiles.find((f) => f.name === (singleOverlay?.name ?? ""))?.key ||
    "";
  const singleGeneratedTemplate = useMemo(
    () => generatedSvgs.find((g) => g.key === singleSvgTemplateKey),
    [generatedSvgs, singleSvgTemplateKey]
  );



  const singleId = useMemo(() => {
    if (!isSingle) return null;
    if (selectedIds.length === 1) return selectedIds[0];
    if (selectedOverlayIds.length === 1) return selectedOverlayIds[0];
    return null;
  }, [isSingle, selectedIds, selectedOverlayIds]);

  function clearSelection() {
    setSelectedIds([]);
    setSelectedOverlayIds([]);
  }

  function selectAll() {
    const allShapeIds = (shapesRef.current || []).map((s) => s.id);
    const allOverlayIds = (overlaysRef.current || []).map((o) => o.id);
    setSelectedIds(allShapeIds);
    setSelectedOverlayIds(allOverlayIds);
    setTool("select");
    setEditingId(null);
    setSelectedSegment(null);
  }

  function setOverlayRef(id, node) {
    if (!id) return;
    if (node) overlayRefs.current.set(id, node);
    else overlayRefs.current.delete(id);
  }

  function svgPoint(evt) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };

    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;

    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };

    const p = pt.matrixTransform(ctm.inverse());

    let x = (p.x - (pan?.x || 0)) / (zoom || 1);
    let y = (p.y - (pan?.y || 0)) / (zoom || 1);

    if (tool === "polyline" && !evt.altKey) {
      const snapRadius = 10 / (zoom || 1);
      let best = null;
      let bestDist = Infinity;
      for (const o of svgOverlays) {
        const bb = overlayLocalBBox(o.id);
        if (!bb) continue;
        const ox = o.tx + o.scale * bb.x;
        const oy = o.ty + o.scale * bb.y;
        const ow = o.scale * bb.width;
        const oh = o.scale * bb.height;
        const cx = ox + ow / 2;
        const cy = oy + oh / 2;
        const candidates = [
          { x: cx, y: oy },
          { x: ox + ow, y: cy },
          { x: cx, y: oy + oh },
          { x: ox, y: cy },
        ];
        for (const c of candidates) {
          const dx = x - c.x;
          const dy = y - c.y;
          const d = Math.hypot(dx, dy);
          if (d < bestDist) {
            bestDist = d;
            best = c;
          }
        }
      }
      if (best && bestDist <= snapRadius) {
        x = best.x;
        y = best.y;
        return { x, y };
      }
    }

    // ✅ SNAP LOGIC (final)
    // - no modifier → free
    // - Shift → snap
    // - Alt → never snap
    if (evt.shiftKey && !evt.altKey) {
      x = snap(x, GRID);
      y = snap(y, GRID);
    }

    return { x, y };
  }

  function startTextAt(p) {
    pushHistory();
    const id = uid();

    const t = {
      id,
      type: "text",
      x: p.x,
      y: p.y,
      text: "Text",
      fontSize: 24,
      fill: theme === "dark" ? "#ffffff" : "#808080",
      fontFamily: "system-ui",
      fontWeight: "400",
      anchor: "start", // start | middle | end
    };

    setShapes((prev) => [...prev, t]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setShowHUD(false);
    scheduleProjectAutoSave();
  }

  function startRectAt(p) {
    pushHistory();
    const id = uid();
    const rect = {
      id,
      type: "rect",
      x: p.x,
      y: p.y,
      width: 0,
      height: 0,
      stroke: "#808080",
      strokeWidth: 3,
      fill: "transparent",
      lineStyle: "solid",
      tagPath: "",
    };

    setShapes((prev) => [...prev, rect]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing({ mode: "draw-rect", id, start: { x: p.x, y: p.y } });
    setShowHUD(false);
    scheduleProjectAutoSave();
  }


  function exitEditMode() {
    setEditingId(null);
    setDragHandle(null);
  }

  function toggleEditMode() {
    if (editingId) {
      exitEditMode();
      return;
    }

    if (selectedIds.length !== 1) return;
    const id = selectedIds[0];
    const s = shapes.find((x) => x.id === id);
    if (!s || (s.type !== "polyline" && !Array.isArray(s.points))) return;
    setEditingId(id);
  }

  // ---------- Overlay bbox helpers ----------
  function overlayLocalBBox(overlayId) {
    // ✅ FIRST: use stored bbox if present (this is your kewidth/keheight box)
    const o = svgOverlays.find((x) => x.id === overlayId);
    if (o?.bbox) return o.bbox;

    // then try live DOM bbox
    const node = overlayRefs.current.get(overlayId);
    if (node) {
      try {
        return node.getBBox();
      } catch { }
    }

    return null;
  }



  function worldFromLocal(o, lx, ly) {
    return { x: o.tx + o.scale * lx, y: o.ty + o.scale * ly };
  }

  // ---------- Multi-drag ----------
  function beginDragAll(startWorld, nextSelectedIds, nextSelectedOverlayIds) {
    const shapePayload = shapes
      .filter((s) => nextSelectedIds.includes(s.id))
      .map((s) => {
        if (s?.type === "text") {
          return { id: s.id, kind: "text", origX: Number(s.x ?? 0), origY: Number(s.y ?? 0) };
        }
        if (s?.type === "rect") {
          return {
            id: s.id,
            kind: "rect",
            origX: Number(s.x ?? 0),
            origY: Number(s.y ?? 0),
            origW: Number(s.width ?? 0),
            origH: Number(s.height ?? 0),
          };
        }
        if (Array.isArray(s?.points)) {
          return { id: s.id, kind: "poly", origPoints: s.points.map((p) => ({ ...p })) };
        }
        return null;
      })
      .filter(Boolean);

    const overlayPayload = svgOverlays
      .filter((o) => nextSelectedOverlayIds.includes(o.id))
      .map((o) => ({ id: o.id, origTx: o.tx, origTy: o.ty }));

    if (!shapePayload.length && !overlayPayload.length) return;

    pushHistory();
    setDragAll({ startWorld, shapes: shapePayload, overlays: overlayPayload });
  }



  // ---------- Duplicate ----------
  function getDupOffset() {
    return Math.max(0, Number(duplicateOffsetRef.current) || 0);
  }

  function getSvgEntry(fileKey) {
    if (generatedSvgMap.has(fileKey)) return generatedSvgMap.get(fileKey);
    return SVG_LIBRARY[fileKey];
  }

  function cacheSvgRawByUrl(url, raw) {
    const cache = svgRawCacheRef.current;
    if (!cache) return;
    if (cache.has(url)) cache.delete(url);
    cache.set(url, raw);
    while (cache.size > SVG_RAW_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  async function readSvgRaw(entry) {
    if (entry == null) return null;
    let value = typeof entry === "function" ? await entry() : entry;
    if (value && typeof value === "object" && typeof value.default === "string") {
      value = value.default;
    }
    if (typeof value !== "string") return null;
    if (isSvgMarkup(value)) return value;
    const url = String(value || "").trim();
    if (!url) return null;
    const cache = svgRawCacheRef.current;
    if (cache?.has(url)) {
      const hit = cache.get(url);
      cache.delete(url);
      cache.set(url, hit);
      return hit;
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const raw = await res.text();
    cacheSvgRawByUrl(url, raw);
    return raw;
  }

  async function readSvgRawByKey(fileKey) {
    return readSvgRaw(getSvgEntry(fileKey));
  }

  function ensureGeneratedKey(name) {
    const clean = String(name || "Generated.svg").replace(/[\\/:*?"<>|]/g, "_");
    const base = clean.toLowerCase().endsWith(".svg") ? clean : `${clean}.svg`;
    let key = `__generated__/${base}`;
    let i = 2;
    while (generatedSvgMap.has(key) || Object.prototype.hasOwnProperty.call(SVG_LIBRARY, key)) {
      const stem = base.replace(/\.svg$/i, "");
      key = `__generated__/${stem}-${i}.svg`;
      i += 1;
    }
    return key;
  }

  function addGeneratedSvg(name, raw) {
    const key = ensureGeneratedKey(name);
    setGeneratedSvgs((prev) => [
      ...prev,
      { key, name: name || key.split("/").pop(), raw, createdAt: Date.now() },
    ]);
    return key;
  }

  function renameGeneratedSvg(key, nextName) {
    const name = String(nextName || "").trim();
    if (!name) return;
    setGeneratedSvgs((prev) =>
      prev.map((g) => (g.key === key ? { ...g, name } : g))
    );
    setSvgOverlays((prev) =>
      prev.map((o) => (o.sourceKey === key ? { ...o, name } : o))
    );
  }

  async function buildOverlayFromKey(fileKey, center, targetW) {
    const entry = getSvgEntry(fileKey);
    if (!entry) {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: center.x - w / 2,
        ty: center.y - h / 2,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        bbox: { x: 0, y: 0, width: w, height: h },
      };
    }

    const raw = await readSvgRaw(entry);
    if (typeof raw !== "string") {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: center.x - w / 2,
        ty: center.y - h / 2,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        bbox: { x: 0, y: 0, width: w, height: h },
      };
    }

    const parsed = stripOuterSvg(raw);
    if (!parsed) {
      const w = Math.max(40, Number(targetW) || 120);
      const h = Math.max(30, w * 0.6);
      return {
        id: uid(),
        sourceKey: fileKey || "__unknown__",
        name: fileKey ? fileKey.split("/").pop() || fileKey : "Unknown",
        inner: `<rect x="0" y="0" width="${w}" height="${h}" fill="${DEFAULT_FILL}" stroke="${DEFAULT_STROKE}" stroke-width="2" />`,
        tx: center.x - w / 2,
        ty: center.y - h / 2,
        scale: 1,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        bbox: { x: 0, y: 0, width: w, height: h },
      };
    }

    const key = extractKeySize(raw);
    const hasKey = !!(key && key.w > 0 && key.h > 0);
    const baseVb = parsed.vb;
    let localVb = key ? { x: 0, y: 0, w: key.w, h: key.h } : baseVb;
    if (!localVb || !Number.isFinite(localVb.w) || !Number.isFinite(localVb.h) || localVb.w <= 0 || localVb.h <= 0) {
      localVb = { x: 0, y: 0, w: 100, h: 100 };
    }

    let inner = parsed.inner;
    if (key && baseVb?.w > 0 && baseVb?.h > 0) {
      const sx = key.w / baseVb.w;
      const sy = key.h / baseVb.h;
      inner = `
      <g transform="translate(${-baseVb.x},${-baseVb.y}) scale(${sx},${sy})">
        ${parsed.inner}
      </g>
    `;
    }

    const srcW = Math.max(localVb.w, 1);
    const scale = hasKey ? 1 : targetW ? Math.max(0.01, targetW / srcW) : 1;
    const srcCx = localVb.x + localVb.w / 2;
    const srcCy = localVb.y + localVb.h / 2;
    const tx = center.x - scale * srcCx;
    const ty = center.y - scale * srcCy;

    return {
      id: uid(),
      sourceKey: fileKey,
      name: fileKey.split("/").pop() || fileKey,
      inner,
      tx,
      ty,
      scale,
      fill: DEFAULT_FILL,
      stroke: DEFAULT_STROKE,
      tagPath: "",
      bbox: { x: localVb.x, y: localVb.y, width: localVb.w, height: localVb.h },
    };
  }

  function layoutPoint(p, origin, scale) {
    return { x: origin.x + p.x * scale, y: origin.y + p.y * scale };
  }

  async function autoLayoutPage1(targetRect) {
    const baseW = 1600;
    const baseH = 900;
    const scale = targetRect
      ? Math.min(targetRect.w / baseW, targetRect.h / baseH)
      : 1;
    const origin = targetRect ? { x: targetRect.x, y: targetRect.y } : { x: 0, y: 0 };

    const placements = [];
    const leftStartX = 200;
    const leftY = 360;
    const leftGap = 90;
    const leftW = 70;
    const leftBins = [
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
      "Terra_Bin_Skinny.svg",
    ];

    leftBins.forEach((key, i) => {
      placements.push({
        key: `./assets/SVG_Files/${key}`,
        center: layoutPoint({ x: leftStartX + i * leftGap, y: leftY }, origin, scale),
        w: leftW * scale,
      });
    });

    // right top bins (51/52)
    placements.push({
      key: "./assets/SVG_Files/Terra_Bin_Skinny.svg",
      center: layoutPoint({ x: 1080, y: 260 }, origin, scale),
      w: 90 * scale,
    });
    placements.push({
      key: "./assets/SVG_Files/Terra_Bin_Skinny.svg",
      center: layoutPoint({ x: 1180, y: 260 }, origin, scale),
      w: 90 * scale,
    });

    // right bottom bank
    const rightStartX = 980;
    const rightY = 560;
    const rightGap = 70;
    const rightW = 60;
    for (let i = 0; i < 8; i++) {
      placements.push({
        key: "./assets/SVG_Files/Terra_Bin_Skinny.svg",
        center: layoutPoint({ x: rightStartX + i * rightGap, y: rightY }, origin, scale),
        w: rightW * scale,
      });
    }

    // center equipment column (approximate)
    placements.push({
      key: "./assets/SVG_Files/BlowerSimple.svg",
      center: layoutPoint({ x: 740, y: 700 }, origin, scale),
      w: 80 * scale,
    });
    placements.push({
      key: "./assets/SVG_Files/Cyclone.svg",
      center: layoutPoint({ x: 720, y: 520 }, origin, scale),
      w: 90 * scale,
    });
    placements.push({
      key: "./assets/SVG_Files/FilterBinTop.svg",
      center: layoutPoint({ x: 740, y: 420 }, origin, scale),
      w: 90 * scale,
    });

    const overlays = (await Promise.all(
      placements.map((p) => buildOverlayFromKey(p.key, p.center, p.w))
    )).filter(Boolean);

    if (!overlays.length) return;

    pushHistory();
    setSvgOverlays((prev) => [...prev, ...overlays]);
    setSelectedIds([]);
    setSelectedOverlayIds(overlays.map((o) => o.id));
    setShowHUD(false);

    const line = (pts) => ({
      id: uid(),
      type: "polyline",
      points: pts,
      stroke: DEFAULT_STROKE,
      strokeWidth: 3,
      lineStyle: "solid",
      arrowStart: "none",
      arrowEnd: "none",
    });

    const newLines = [
      line([layoutPoint({ x: 160, y: 240 }, origin, scale), layoutPoint({ x: 700, y: 240 }, origin, scale), layoutPoint({ x: 700, y: 520 }, origin, scale)]),
      line([layoutPoint({ x: 700, y: 520 }, origin, scale), layoutPoint({ x: 900, y: 520 }, origin, scale)]),
      line([layoutPoint({ x: 900, y: 520 }, origin, scale), layoutPoint({ x: 1470, y: 520 }, origin, scale)]),
      line([layoutPoint({ x: 980, y: 320 }, origin, scale), layoutPoint({ x: 1180, y: 320 }, origin, scale)]),
      line([layoutPoint({ x: 980, y: 320 }, origin, scale), layoutPoint({ x: 980, y: 500 }, origin, scale)]),
      line([layoutPoint({ x: 1180, y: 320 }, origin, scale), layoutPoint({ x: 1180, y: 500 }, origin, scale)]),
      line([layoutPoint({ x: 160, y: 300 }, origin, scale), layoutPoint({ x: 700, y: 300 }, origin, scale)]),
    ];

    setShapes((prev) => [...prev, ...newLines]);
  }


  function getSelectionBoxes(curShapes, curOverlays, selShapes, selOvers) {
    const items = [];

    for (const id of selShapes) {
      const s = curShapes.find((x) => x.id === id);
      if (!s) continue;

      if (s.type === "text") {
        const fontSize = Number(s.fontSize ?? 24);
        const txt = String(s.text ?? "");
        const estW = Math.max(10, txt.length * fontSize * 0.6);
        const estH = Math.max(10, fontSize * 1.2);
        const anchor = s.anchor ?? "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
        items.push({
          x: Number(s.x ?? 0) + ax,
          y: Number(s.y ?? 0) - estH,
          w: estW,
          h: estH,
        });
        continue;
      }

      if (s.type === "rect") {
        items.push({
          x: Number(s.x ?? 0),
          y: Number(s.y ?? 0),
          w: Math.max(0, Number(s.width ?? 0)),
          h: Math.max(0, Number(s.height ?? 0)),
        });
        continue;
      }

      if (Array.isArray(s.points)) {
        const bb = bboxOfPoints(s.points);
        if (!bb) continue;
        items.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
      }
    }

    for (const id of selOvers) {
      const o = curOverlays.find((x) => x.id === id);
      if (!o) continue;
      const bb = overlayLocalBBox(id);
      if (!bb) continue;
      items.push({
        x: o.tx + o.scale * bb.x,
        y: o.ty + o.scale * bb.y,
        w: o.scale * bb.width,
        h: o.scale * bb.height,
      });
    }

    return items;
  }

  function duplicateSelected() {
    const pad = getDupOffset();
    if (!selectedIds.length && !selectedOverlayIds.length) return;
    if (!selectedBBox) return;

    const items = getSelectionBoxes(shapes, svgOverlays, selectedIds, selectedOverlayIds);
    let refW = Math.max(0, selectedBBox.w);
    if (items.length) {
      const leftmost = items.reduce((a, b) => (b.x < a.x ? b : a), items[0]);
      refW = Math.max(0, leftmost.w);
    }
    const dx = refW + pad;

    pushHistory();

    const shapeDups = shapes
      .filter((s) => selectedIds.includes(s.id))
      .map((s) => {
        const id = uid();

        // text
        if (s.type === "text") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        if (s.type === "rect") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        // polyline (or any shape with points)
        if (Array.isArray(s.points)) {
          return {
            ...s,
            id,
            points: clonePoints(s.points).map((p) => ({ x: p.x + dx, y: p.y })),
          };
        }

        return null;
      })
      .filter(Boolean);

    const overlayDups = svgOverlays
      .filter((o) => selectedOverlayIds.includes(o.id))
      .map((o) => {
        const id = uid();
        return { ...o, id, tx: o.tx + dx, ty: o.ty };
      });

    if (shapeDups.length) setShapes((prev) => [...prev, ...shapeDups]);
    if (overlayDups.length) setSvgOverlays((prev) => [...prev, ...overlayDups]);

    setSelectedIds(shapeDups.map((s) => s.id));
    setSelectedOverlayIds(overlayDups.map((o) => o.id));

    exitEditMode();
    setDrawing(null);
    setTool("select");
  }


  function duplicateSelectedStable() {
    const pad = getDupOffset();

    const refShapes = Array.isArray(shapesRef.current) ? shapesRef.current : [];
    const refOverlays = Array.isArray(overlaysRef.current) ? overlaysRef.current : [];
    const refSelShapes = Array.isArray(selPolyRef.current) ? selPolyRef.current : [];
    const refSelOvers = Array.isArray(selOverRef.current) ? selOverRef.current : [];
    const curShapes = refShapes.length ? refShapes : shapes;
    const curOverlays = refOverlays.length ? refOverlays : svgOverlays;
    const curSelShapes = refSelShapes.length ? refSelShapes : selectedIds;
    const curSelOvers = refSelOvers.length ? refSelOvers : selectedOverlayIds;

    if (!curSelShapes.length && !curSelOvers.length) return;

    const boxes = getSelectionBoxes(curShapes, curOverlays, curSelShapes, curSelOvers);
    if (!boxes.length) return;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }

    const groupW = Math.max(0, maxX - minX);
    let refW = groupW;
    if (boxes.length) {
      const leftmost = boxes.reduce((a, b) => (b.x < a.x ? b : a), boxes[0]);
      refW = Math.max(0, leftmost.w);
    }

    const dx = refW + pad; // ✅ width of leftmost element + offset

    // build duplicates
    pushHistory();

    const shapeDups = curShapes
      .filter((s) => curSelShapes.includes(s.id))
      .map((s) => {
        const id = uid();

        // ✅ Text duplicate (shift right only)
        if (s.type === "text") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        if (s.type === "rect") {
          return { ...s, id, x: Number(s.x ?? 0) + dx, y: Number(s.y ?? 0) };
        }

        // ✅ Polyline duplicate
        if (Array.isArray(s.points)) {
          return {
            ...s,
            id,
            points: clonePoints(s.points).map((p) => ({ x: p.x + dx, y: p.y })),
          };
        }

        return null;
      })
      .filter(Boolean);

    const overlayDups = curOverlays
      .filter((o) => curSelOvers.includes(o.id))
      .map((o) => {
        const id = uid();
        return { ...o, id, tx: o.tx + dx, ty: o.ty }; // ✅ keep Y
      });

    if (shapeDups.length) setShapes((prev) => [...prev, ...shapeDups]);
    if (overlayDups.length) setSvgOverlays((prev) => [...prev, ...overlayDups]);

    // ✅ IMPORTANT: set selection AFTER state applies (so next Ctrl+D sees selection)
    queueMicrotask(() => {
      setSelectedIds(shapeDups.map((s) => s.id));
      setSelectedOverlayIds(overlayDups.map((o) => o.id));
    });

    exitEditMode();
    setDrawing(null);
    setTool("select");
  }

  function handleDuplicate() {
    duplicateSelectedStable();
  }

  function copySelection() {
    const refShapes = Array.isArray(shapesRef.current) ? shapesRef.current : [];
    const refOverlays = Array.isArray(overlaysRef.current) ? overlaysRef.current : [];
    const refSelShapes = Array.isArray(selPolyRef.current) ? selPolyRef.current : [];
    const refSelOvers = Array.isArray(selOverRef.current) ? selOverRef.current : [];
    const curShapes = refShapes.length ? refShapes : shapes;
    const curOverlays = refOverlays.length ? refOverlays : svgOverlays;
    const curSelShapes = refSelShapes.length ? refSelShapes : selectedIds;
    const curSelOvers = refSelOvers.length ? refSelOvers : selectedOverlayIds;

    const shapesCopy = curShapes
      .filter((s) => curSelShapes.includes(s.id))
      .map((s) => deepClone(s));

    const overlaysCopy = curOverlays
      .filter((o) => curSelOvers.includes(o.id))
      .map((o) => deepClone(o));

    if (!shapesCopy.length && !overlaysCopy.length) return;

    clipboardRef.current = { shapes: shapesCopy, overlays: overlaysCopy, pasteCount: 0 };
  }

  function pasteClipboard() {
    const clip = clipboardRef.current;
    if (!clip || (!clip.shapes.length && !clip.overlays.length)) return;

    const n = (clip.pasteCount ?? 0) + 1;
    const dx = lastContextPoint ? 0 : 20 * n;
    const dy = lastContextPoint ? 0 : 20 * n;

    pushHistory();

    let offsetX = dx;
    let offsetY = dy;
    if (lastContextPoint) {
      const boxes = [];
      for (const s of clip.shapes) {
        if (s.type === "text") {
          const fontSize = Number(s.fontSize ?? 24);
          const txt = String(s.text ?? "");
          const estW = Math.max(10, txt.length * fontSize * 0.6);
          const estH = Math.max(10, fontSize * 1.2);
          const anchor = s.anchor ?? "start";
          const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
          boxes.push({
            x: Number(s.x ?? 0) + ax,
            y: Number(s.y ?? 0) - estH,
            w: estW,
            h: estH,
          });
        } else if (s.type === "rect") {
          boxes.push({
            x: Number(s.x ?? 0),
            y: Number(s.y ?? 0),
            w: Math.max(0, Number(s.width ?? 0)),
            h: Math.max(0, Number(s.height ?? 0)),
          });
        } else if (Array.isArray(s.points)) {
          const bb = bboxOfPoints(s.points);
          if (bb) boxes.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
        }
      }
      for (const o of clip.overlays) {
        const bb = o.bbox || overlayLocalBBox(o.id);
        if (!bb) continue;
        boxes.push({
          x: o.tx + o.scale * bb.x,
          y: o.ty + o.scale * bb.y,
          w: o.scale * bb.width,
          h: o.scale * bb.height,
        });
      }
      if (boxes.length) {
        let minX = Infinity, minY = Infinity;
        for (const b of boxes) {
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
        }
        offsetX = lastContextPoint.x - minX;
        offsetY = lastContextPoint.y - minY;
      }
    }

    const shapeDups = clip.shapes
      .map((s) => {
        const id = uid();
        if (s.type === "text") {
          return { ...s, id, x: Number(s.x ?? 0) + offsetX, y: Number(s.y ?? 0) + offsetY };
        }
        if (s.type === "rect") {
          return { ...s, id, x: Number(s.x ?? 0) + offsetX, y: Number(s.y ?? 0) + offsetY };
        }
        if (Array.isArray(s.points)) {
          return {
            ...s,
            id,
            points: clonePoints(s.points).map((p) => ({ x: p.x + offsetX, y: p.y + offsetY })),
          };
        }
        return null;
      })
      .filter(Boolean);

    const overlayDups = clip.overlays.map((o) => {
      const id = uid();
      return { ...o, id, tx: o.tx + offsetX, ty: o.ty + offsetY };
    });

    if (shapeDups.length) setShapes((prev) => [...prev, ...shapeDups]);
    if (overlayDups.length) setSvgOverlays((prev) => [...prev, ...overlayDups]);

    setSelectedIds(shapeDups.map((s) => s.id));
    setSelectedOverlayIds(overlayDups.map((o) => o.id));

    clip.pasteCount = n;
    exitEditMode();
    setDrawing(null);
    setTool("select");
  }



  // ---------- Polyline drawing/editing ----------
  function startPolylineAt(p) {
    pushHistory();
    const id = uid();
    const poly = {
      id,
      type: "polyline",
      tagPath: "", // ✅ NEW
      points: [p, { x: p.x, y: p.y }], // last is preview
      stroke: "#808080",
      strokeWidth: 3,
      lineStyle: "solid",
    };

    setShapes((prev) => [...prev, poly]);
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(null);
    setDrawing({ mode: "draw-poly", id });
    setShowHUD(false);
    scheduleProjectAutoSave();
  }

  function addPolylinePoint(p) {
    pushHistory();
    if (!drawing || drawing.mode !== "draw-poly") return;
    const id = drawing.id;

    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;

        const fixed = s.points.slice(0, -1);
        const lastFixed = fixed[fixed.length - 1];
        const firstFixed = fixed[0];
        const SNAP_DIST = 12;
        let nextP = p;
        if (firstFixed && distance(p, firstFixed) <= SNAP_DIST) {
          nextP = { x: firstFixed.x, y: firstFixed.y };
        }

        const newFixed =
          lastFixed && lastFixed.x === nextP.x && lastFixed.y === nextP.y ? fixed : [...fixed, nextP];

        const tail = newFixed[newFixed.length - 1];
        return { ...s, points: [...newFixed, { x: tail.x, y: tail.y }] };
      })
    );
  }

  function finishPolyline() {
    pushHistory();
    if (!drawing || drawing.mode !== "draw-poly") return;
    const id = drawing.id;

    setShapes((prev) =>
      prev.flatMap((s) => {
        // keep everything else (including text)
        if (s.id !== id) return [s];

        // only polylines can be finished here
        if (s.type !== "polyline" || !Array.isArray(s.points)) return [s];

        const fixed = s.points.slice(0, -1); // remove preview point

        // if too short, drop ONLY this polyline
        if (fixed.length < 2) return [];

        return [{ ...s, points: fixed }];
      })
    );

    setDrawing(null);
    clearSelection();
    scheduleProjectAutoSave();
  }


  function cancelPolyline() {
    pushHistory();
    if (!drawing || drawing.mode !== "draw-poly") return;
    const id = drawing.id;

    setShapes((prev) => prev.filter((s) => s.id !== id));
    setDrawing(null);
    clearSelection();
    setTool("select");
  }

  function deleteSelected() {
    if (selectedIds.length) {
      setShapes((prev) => prev.filter((s) => !selectedIds.includes(s.id)));
      if (editingId && selectedIds.includes(editingId)) setEditingId(null);
    }
    if (selectedOverlayIds.length) {
      setSvgOverlays((prev) => prev.filter((o) => !selectedOverlayIds.includes(o.id)));
    }
    clearSelection();
    exitEditMode();
  }

  function onShapeMouseDown(e, id) {
    if (tool !== "select") return;
    e.stopPropagation();

    if (editingId === id) {
      if (e.shiftKey) {
        setSelectedIds((prev) => toggleIn(prev, id));
        return;
      }
      setSelectedIds([id]);
      setSelectedOverlayIds([]);
      return;
    }

    if (e.shiftKey) {
      setSelectedIds((prev) => toggleIn(prev, id));
      return;
    }

    const isAlreadySelected = selectedIds.includes(id);
    if (!isAlreadySelected) {
      setSelectedIds([id]);
      setSelectedOverlayIds([]);
      return;
    }

    const p = svgPoint(e);
    beginDragAll(p, selectedIds, selectedOverlayIds);
  }

  function onShapeDoubleClick(e, id) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();

    const s = shapes.find((x) => x.id === id);
    if (s?.type === "text") {
      setSelectedIds([id]);
      setSelectedOverlayIds([]);
      setEditingId(null);
      setInlineEdit(null);
      setPanelCursor({ x: e.clientX, y: e.clientY });
      setShowHUD(true);
      return;
    }

    // existing polyline logic...
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(id);
    setDrawing(null);
  }


  function insertPointOnPolyline(id, p) {
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const pts = s.points;
        if (pts.length < 2) return s;

        let best = { i: 0, d2: Infinity, cp: null };

        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const cp = closestPointOnSegment(p, a, b);
          const d = dist2(p, cp);
          if (d < best.d2) best = { i, d2: d, cp };
        }

        const insertAt = best.i + 1;
        const newPt = { x: best.cp.x, y: best.cp.y };
        const next = pts.slice(0, insertAt).concat([newPt], pts.slice(insertAt));
        return { ...s, points: next };
      })
    );
  }

  function removeVertex(id, index) {
    setShapes((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        if (s.points.length <= 2) return s;
        const next = s.points.slice();
        next.splice(index, 1);
        return { ...s, points: next };
      })
    );
  }

  // function onCanvasDoubleClick(e) {
  //   // don't set marker while drawing
  //   if (tool === "polyline") return;

  //   e.preventDefault();
  //   e.stopPropagation();

  //   const p = svgPoint(e);      // uses clientX/clientY → world coords
  //   setImportAnchor(p);
  //   console.log("IMPORT MARKER SET:", p);
  // }

  function onHandleMouseDown(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    pushHistory();
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(id);
    setDragHandle({ id, index });
    setSelectedSegment({ id, index, kind: "point" });
  }


  function onHandleDoubleClick(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    removeVertex(id, index);
    setSelectedSegment(null);
  }

  function onHandleContextMenu(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    setPolyHandleMenu({
      x: e.clientX,
      y: e.clientY,
      id,
      index,
    });
    setContextMenu(null);
  }

  function onEditPolylineClick(e, id) {
    if (tool !== "select") return;
    if (editingId !== id) return;
    e.stopPropagation();
    const p = svgPoint(e);
    insertPointOnPolyline(id, p);
    setSelectedSegment(null);
  }

  function onSegmentMouseDown(e, id, index) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    if (e.altKey) {
      const p = svgPoint(e);
      insertPointOnPolyline(id, p);
      setSelectedSegment(null);
      return;
    }
    setSelectedIds([id]);
    setSelectedOverlayIds([]);
    setEditingId(id);
    setSelectedSegment({ id, index, kind: "point" });
  }

  // ---------- Overlay selection / move / resize ----------
  function onOverlayMouseDown(e, id) {
    if (tool !== "select") return;
    const target = e.target;
    const interactiveSelector = "[data-widget-control='true'],button,input,select,textarea,label,option";
    if (target && typeof target.closest === "function") {
      if (target.closest(interactiveSelector)) return;
    }
    const nativeEvent = e.nativeEvent;
    if (nativeEvent && typeof nativeEvent.composedPath === "function") {
      const path = nativeEvent.composedPath();
      const hitInteractive = path.some((node) => {
        if (!node || typeof node !== "object") return false;
        const el = node;
        if (typeof el.matches === "function" && el.matches(interactiveSelector)) return true;
        return false;
      });
      if (hitInteractive) return;
    }
    e.stopPropagation();
    e.preventDefault();

    if (e.shiftKey) {
      setSelectedOverlayIds((prev) => toggleIn(prev, id));
      exitEditMode();
      setDrawing(null);
      return;
    }

    const isAlreadySelected = selectedOverlayIds.includes(id);
    if (!isAlreadySelected) {
      setSelectedOverlayIds([id]);
      setSelectedIds([]);
      exitEditMode();
      setDrawing(null);
      return;
    }

    exitEditMode();
    setDrawing(null);

    const p = svgPoint(e);
    beginDragAll(p, selectedIds, selectedOverlayIds);
  }

  function onOverlayDoubleClick(e, id) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    setEditingId(null);
    setInlineEdit(null);
    setPanelCursor({ x: e.clientX, y: e.clientY });
    setShowHUD(true);
  }

  function onOverlayHandleDown(e, id, corner) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();

    if (e.altKey) {
      // Alt = move overlay instead of resize
      setSelectedOverlayIds([id]);
      setSelectedIds([]);
      exitEditMode();
      setDrawing(null);

      const p = svgPoint(e);
      beginDragAll(p, [], [id]);
      return;
    }

    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    exitEditMode();

    const p = svgPoint(e);
    const o = svgOverlays.find((x) => x.id === id);
    if (!o) return;

    const bb = overlayLocalBBox(id);
    if (!bb) return;

    const TL = { x: bb.x, y: bb.y };
    const TR = { x: bb.x + bb.width, y: bb.y };
    const BR = { x: bb.x + bb.width, y: bb.y + bb.height };
    const BL = { x: bb.x, y: bb.y + bb.height };

    const corners = { TL, TR, BR, BL };
    const opposite = { TL: BR, TR: BL, BR: TL, BL: TR };

    const startLocal = corners[corner];
    const anchorLocal = opposite[corner];

    const startWorld = worldFromLocal(o, startLocal.x, startLocal.y);
    const anchorWorld = worldFromLocal(o, anchorLocal.x, anchorLocal.y);

    const startDist = Math.max(1, distance(startWorld, anchorWorld));
    pushHistory(); // ✅ UNDO: start of overlay resize
    setOverlayResize({
      id,
      isWidget: !!o?.widget,
      anchorLocal,
      anchorWorld,
      startDist,
      origScale: o.scale,
    });
  }

  function extractSvgSize(rawSvg) {
    try {
      const doc = new DOMParser().parseFromString(rawSvg, "image/svg+xml");
      const svg = doc.querySelector("svg");
      if (!svg) return null;

      // 1️⃣ Ignition-style properties
      const kw = svg.getAttribute("kewidth");
      const kh = svg.getAttribute("keheight");

      if (kw && kh) {
        const w = parseFloat(kw);
        const h = parseFloat(kh);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          return { w, h, source: "key" };
        }
      }

      // 2️⃣ Standard width/height
      const wAttr = svg.getAttribute("width");
      const hAttr = svg.getAttribute("height");

      if (wAttr && hAttr) {
        const w = parseFloat(wAttr);
        const h = parseFloat(hAttr);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          return { w, h, source: "attr" };
        }
      }

      // 3️⃣ ViewBox fallback
      const vb = svg.getAttribute("viewBox");
      if (vb) {
        const [, , vw, vh] = vb.split(/\s+/).map(Number);
        if (Number.isFinite(vw) && Number.isFinite(vh)) {
          return { w: vw, h: vh, source: "viewBox" };
        }
      }
    } catch {
      return null;
    }

    return null;
  }



  // ✅ Lazy/eager compatible SVG import
  async function onPickSvg(fileKey, anchorOverride, overlayExtras = {}, rawOverride = null) {
    const entry = rawOverride ?? getSvgEntry(fileKey);
    if (!entry) return;

    const raw = await readSvgRaw(entry);
    if (typeof raw !== "string") return;

    const parsed = stripOuterSvg(raw);
    if (!parsed) return;

    pushHistory(); // ✅ undo import

    const pad = 40;
    const availW = vbW - pad * 2;
    const availH = vbH - pad * 2;

    const key = extractKeySize(raw);
    console.log("🔑 extractKeySize:", key);
    const baseVb = parsed.vb; // {x,y,w,h}

    // ✅ If key exists, overlay local coords become 0..key.w / 0..key.h
    let localVb = key ? { x: 0, y: 0, w: key.w, h: key.h } : baseVb;
    if (!localVb || !Number.isFinite(localVb.w) || !Number.isFinite(localVb.h) || localVb.w <= 0 || localVb.h <= 0) {
      localVb = { x: 0, y: 0, w: 100, h: 100 };
    }

    // ✅ Normalize inner so geometry matches localVb
    let inner = parsed.inner;

    if (key && baseVb?.w > 0 && baseVb?.h > 0) {
      const sx = key.w / baseVb.w;
      const sy = key.h / baseVb.h;

      inner = `
      <g transform="translate(${-baseVb.x},${-baseVb.y}) scale(${sx},${sy})">
        ${parsed.inner}
      </g>
    `;
    }

    const srcW = Math.max(localVb.w, 1);
    const srcH = Math.max(localVb.h, 1);

    // ✅ If kewidth/keheight exists, import at EXACT size (1 world unit = 1 key unit)
    // Otherwise default to 350 width.
    const scale = key ? 1 : Math.min(350 / srcW, vbH / srcH);

    const srcCx = localVb.x + localVb.w / 2;
    const srcCy = localVb.y + localVb.h / 2;

    const anchor = anchorOverride ?? importAnchor ?? { x: vbW / 2, y: vbH / 2 };

    const tx = anchor.x - scale * srcCx;
    const ty = anchor.y - scale * srcCy;

    // ✅ bbox must be in the SAME local coordinate system the overlay uses
    const bbox = { x: localVb.x, y: localVb.y, width: localVb.w, height: localVb.h };

    const id = uid();
    setSvgOverlays((prev) => [
      ...prev,
      {
        id,
        sourceKey: fileKey,
        name: fileKey.split("/").pop() || fileKey,
        inner,
        tx,
        ty,
        scale,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        tagPath: "",
        bbox,
        ...overlayExtras,
      },
    ]);

    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    setImportOpen(false);
    exitEditMode();
    setShowHUD(false);
    setImportAnchor(null);
    scheduleProjectAutoSave();
  }

  function finishRectDrawing(rectId) {
    if (!rectId) return;
    setShapes((prev) =>
      prev.filter((s) => {
        if (s.id !== rectId) return true;
        const w = Math.max(0, Number(s.width ?? 0));
        const h = Math.max(0, Number(s.height ?? 0));
        return w >= 2 && h >= 2;
      })
    );
    setDrawing(null);
    scheduleProjectAutoSave();
  }

  async function onPickWidget(widgetKey, anchorOverride) {
    const tmpl = widgetTemplate(widgetKey);
    const key = addGeneratedSvg(tmpl.name, tmpl.raw);
    await onPickSvg(key, anchorOverride ?? lastContextPoint ?? undefined, {
      tagPath: "",
      widget: defaultWidgetSettings(widgetKey),
    }, tmpl.raw);
    setWidgetOpen(false);
    setContextMenu(null);
  }

  async function swapOverlayTemplate(overlayId, fileKey) {
    const o = overlaysRef.current.find((x) => x.id === overlayId);
    if (!o) return;
    const bb = overlayLocalBBox(overlayId);
    if (!bb) return;

    const worldX = o.tx + o.scale * bb.x;
    const worldY = o.ty + o.scale * bb.y;
    const worldW = o.scale * bb.width;
    const worldH = o.scale * bb.height;
    const center = { x: worldX + worldW / 2, y: worldY + worldH / 2 };

    const nextOverlay = await buildOverlayFromKey(fileKey, center, worldW || undefined);
    if (!nextOverlay) return;

    setSvgOverlays((prev) =>
      prev.map((x) => {
        if (x.id !== overlayId) return x;
        return {
          ...x,
          ...nextOverlay,
          id: x.id,
          tagPath: x.tagPath,
          fill: x.fill,
          stroke: x.stroke,
        };
      })
    );
  }





  // ---------- Selected BBox (world coords, group-aware) ----------
  const selectedBBox = useMemo(() => {
    const boxes = [];

    for (const id of selectedIds) {
      const s = shapes.find((x) => x.id === id);
      if (!s) continue;

      // ✅ Polyline
      if (s.type === "polyline" || Array.isArray(s.points)) {
        if (!Array.isArray(s.points)) continue;
        const bb = bboxOfPoints(s.points);
        if (!bb) continue;
        boxes.push({ x: bb.minX, y: bb.minY, w: bb.w, h: bb.h });
        continue;
      }

      // ✅ Text
      if (s.type === "text") {
        const fontSize = Number(s.fontSize ?? 24);
        const txt = String(s.text ?? "");
        const estW = Math.max(10, txt.length * fontSize * 0.6); // rough width
        const estH = Math.max(10, fontSize * 1.2);

        // anchor: start | middle | end
        const anchor = s.anchor ?? "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;

        boxes.push({
          x: Number(s.x ?? 0) + ax,
          y: Number(s.y ?? 0) - estH, // ✅ better bbox: y is top; text y is baseline
          w: estW,
          h: estH,
        });
        continue;
      }

      // ✅ Rectangle
      if (s.type === "rect") {
        boxes.push({
          x: Number(s.x ?? 0),
          y: Number(s.y ?? 0),
          w: Math.max(0, Number(s.width ?? 0)),
          h: Math.max(0, Number(s.height ?? 0)),
        });
        continue;
      }
    }

    for (const id of selectedOverlayIds) {
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) continue;
      const bb = overlayLocalBBox(id);
      if (!bb) continue;

      boxes.push({
        x: o.tx + o.scale * bb.x,
        y: o.ty + o.scale * bb.y,
        w: o.scale * bb.width,
        h: o.scale * bb.height,
      });
    }

    if (boxes.length === 0) return null;

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }

    return {
      kind: boxes.length === 1 ? "Selected" : `Group (${boxes.length})`,
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
    };
  }, [selectedIds, selectedOverlayIds, shapes, svgOverlays]);


  // ---------- Properties (ID, Tag Path, Fill, Stroke, X/Y/W/H) ----------
  const [hudFields, setHudFields] = useState({
    id: "",
    tagPath: "",
    fill: DEFAULT_FILL,
    stroke: DEFAULT_STROKE,
    strokeWidth: "",
    arrowStart: "none",
    arrowEnd: "none",
    lineStyle: "solid",   // ✅ NEW
    x: "",
    y: "",
    w: "",
    h: "",
    text: "",
    fontSize: "24",
    fontFamily: "system-ui",
    fontWeight: "400",
    textAlign: "start",
    widgetKind: "",
    widgetTitle: "",
    widgetMin: "0",
    widgetMax: "100",
    widgetDecimals: "0",
    widgetUnit: "",
    widgetHistoryPoints: "40",
    widgetRowCount: "4",
    widgetRangeFrom: "",
    widgetRangeTo: "",
    widgetWindowMinutes: "60",
    widgetDurationPreset: "1h",
    widgetMaxPoints: "500",
    widgetLineTension: "0.34",
    widgetShowPoints: "true",
    widgetSeriesTags: "",
    widgetAxisMode: "auto",
  });


  useEffect(() => {
    if (!selectedBBox) {
      setHudFields({
        id: "",
        tagPath: "",
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        strokeWidth: "",
        arrowStart: "none",
        arrowEnd: "none",
        x: "",
        y: "",
        w: "",
        h: "",
        lineStyle: "solid",
        text: "",
        fontSize: "24",
        fontFamily: "system-ui",
        fontWeight: "400",
        textAlign: "start",
        widgetKind: "",
        widgetTitle: "",
        widgetMin: "0",
        widgetMax: "100",
        widgetDecimals: "0",
        widgetUnit: "",
        widgetHistoryPoints: "40",
        widgetRowCount: "4",
        widgetRangeFrom: "",
        widgetRangeTo: "",
        widgetWindowMinutes: "60",
        widgetDurationPreset: "1h",
        widgetMaxPoints: "500",
        widgetLineTension: "0.34",
        widgetShowPoints: "true",
        widgetSeriesTags: "",
        widgetAxisMode: "auto",
      });
      return;
    }

    let idText = "";
    let tagPath = "";
    let fill = DEFAULT_FILL;
    let stroke = DEFAULT_STROKE;
    let strokeWidth = "";
    let arrowStart = "none";
    let arrowEnd = "none";
    let lineStyle = "solid"; // ✅ NEW

    if (isSingle && singleKind === "Polyline") {
      const s = shapes.find((x) => x.id === singleId);
      if (s) {
        idText = s.id;
        tagPath = s.tagPath || "";
        stroke = s.stroke || DEFAULT_STROKE;
        arrowStart = s.arrowStart ?? "none";
        arrowEnd = s.arrowEnd ?? "none";
        lineStyle = s.lineStyle ?? "solid"; // ✅ NEW
      }
    } else if (isSingle && (singleKind === "SVG" || singleKind === "Widget")) {
      const o = svgOverlays.find((x) => x.id === singleId);
      if (o) {
        const w = o.widget || {};
        const overlayTagPath = String(o.tagPath || "");
        const parsedDb = parseDbTagPath(overlayTagPath);
        const parsedQuery = overlayTagPath.trim().toLowerCase().startsWith("dbq:")
          ? overlayTagPath.trim().slice(4)
          : "";
        const rawBarSourceMode = String(w.barSourceMode || "").trim().toLowerCase();
        const barSourceMode = rawBarSourceMode === "query"
          ? "query"
          : rawBarSourceMode === "tags"
          ? "tags"
          : (String(w.barQuery || parsedQuery).trim() ? "query" : "table");
        idText = o.id;
        tagPath = overlayTagPath;
        fill = !o.fill || o.fill === "none" ? DEFAULT_FILL : o.fill;
        stroke = !o.stroke || o.stroke === "none" ? DEFAULT_STROKE : o.stroke;
        strokeWidth = String(
          Number.isFinite(Number(o.strokeWidth)) && Number(o.strokeWidth) > 0
            ? Number(o.strokeWidth)
            : ""
        );
        setHudFields({
          id: idText,
          tagPath,
          fill,
          stroke,
          strokeWidth,
          arrowStart: "none",
          arrowEnd: "none",
          lineStyle: "solid",
          x: String(fmt(selectedBBox.x)),
          y: String(fmt(selectedBBox.y)),
          w: String(fmt(selectedBBox.w)),
          h: String(fmt(selectedBBox.h)),
          text: "",
          fontSize: "24",
          fontFamily: "system-ui",
          fontWeight: "400",
          textAlign: "start",
          widgetKind: String(w.kind || ""),
          widgetTitle: String(w.title || ""),
          widgetMin: String(Number.isFinite(Number(w.min)) ? Number(w.min) : 0),
          widgetMax: String(Number.isFinite(Number(w.max)) ? Number(w.max) : 100),
          widgetDecimals: String(Number.isFinite(Number(w.decimals)) ? Number(w.decimals) : 0),
          widgetUnit: String(w.unit || ""),
          widgetHistoryPoints: String(Number.isFinite(Number(w.historyPoints)) ? Number(w.historyPoints) : 40),
          widgetRowCount: String(Number.isFinite(Number(w.rowCount)) ? Number(w.rowCount) : 4),
          widgetRangeFrom: toDatetimeLocalInput(w.rangeFrom),
          widgetRangeTo: toDatetimeLocalInput(w.rangeTo),
          widgetWindowMinutes: String(Number.isFinite(Number(w.windowMinutes)) ? Number(w.windowMinutes) : 60),
          widgetDurationPreset: String(w.durationPreset || ""),
          widgetMaxPoints: String(Number.isFinite(Number(w.maxPoints)) ? Number(w.maxPoints) : 500),
          widgetLineTension: String(Number.isFinite(Number(w.lineTension)) ? Number(w.lineTension) : 0.34),
          widgetShowPoints: String(w.showPoints !== false),
          widgetSeriesTags: normalizeSeriesTagsValue(w.seriesTags, tagPath).join("\n"),
          widgetAxisMode: String(w.axisMode === "manual" ? "manual" : "auto"),
          widgetBarSourceMode: barSourceMode,
          widgetBarTable: String(w.barTable || parsedDb?.table || ""),
          widgetBarField: String(w.barField || parsedDb?.field || ""),
          widgetBarLabelField: String(w.barLabelField || ""),
          widgetBarQuery: String(w.barQuery || parsedQuery || ""),
          widgetBarQueryValueField: String(w.barQueryValueField || ""),
          widgetBarQueryLabelField: String(w.barQueryLabelField || ""),
        });
        return;
      }
    } else if (isSingle && singleKind === "Text") {
      const t = shapes.find((x) => x.id === singleId);
      if (t) {
        idText = t.id;
        tagPath = t.tagPath || "";
        fill = t.fill ?? "#808080";
        stroke = t.stroke ?? "#808080"; // optional if you support stroke on text

        setHudFields({
          id: idText,
          tagPath,
          fill,
          stroke,
          strokeWidth: "",
          arrowStart: "none",
          arrowEnd: "none",
          lineStyle: "solid",
          x: String(fmt(selectedBBox.x)),
          y: String(fmt(selectedBBox.y)),
          w: String(fmt(selectedBBox.w)),
          h: String(fmt(selectedBBox.h)),
          text: String(t.text ?? ""),
          fontSize: String(t.fontSize ?? 24),
          fontFamily: String(t.fontFamily ?? "system-ui"),
          fontWeight: String(t.fontWeight ?? "400"),
          textAlign: String(t.anchor ?? "start"),
          widgetKind: "",
          widgetTitle: "",
          widgetMin: "0",
          widgetMax: "100",
          widgetDecimals: "0",
          widgetUnit: "",
          widgetHistoryPoints: "40",
          widgetRowCount: "4",
          widgetRangeFrom: "",
          widgetRangeTo: "",
          widgetWindowMinutes: "60",
          widgetDurationPreset: "1h",
          widgetMaxPoints: "500",
          widgetLineTension: "0.34",
          widgetShowPoints: "true",
          widgetSeriesTags: "",
          widgetAxisMode: "auto",
          widgetBarSourceMode: "table",
          widgetBarTable: "",
          widgetBarField: "",
          widgetBarLabelField: "",
          widgetBarQuery: "",
          widgetBarQueryValueField: "",
          widgetBarQueryLabelField: "",
        });
        return;
      }
    }


    setHudFields({
      id: idText,
      tagPath,
      fill,
      stroke,
      strokeWidth,
      arrowStart,
      arrowEnd,
      lineStyle, // ✅ NEW
      x: String(fmt(selectedBBox.x)),
      y: String(fmt(selectedBBox.y)),
      w: String(fmt(selectedBBox.w)),
      h: String(fmt(selectedBBox.h)),
      text: "",
      fontSize: "24",
      fontFamily: "system-ui",
      fontWeight: "400",
      textAlign: "start",
      widgetKind: "",
      widgetTitle: "",
      widgetMin: "0",
      widgetMax: "100",
      widgetDecimals: "0",
      widgetUnit: "",
      widgetHistoryPoints: "40",
      widgetRowCount: "4",
      widgetRangeFrom: "",
      widgetRangeTo: "",
      widgetWindowMinutes: "60",
      widgetDurationPreset: "1h",
      widgetMaxPoints: "500",
      widgetLineTension: "0.34",
      widgetShowPoints: "true",
      widgetSeriesTags: "",
      widgetAxisMode: "auto",
      widgetBarSourceMode: "table",
      widgetBarTable: "",
      widgetBarField: "",
      widgetBarLabelField: "",
      widgetBarQuery: "",
      widgetBarQueryValueField: "",
      widgetBarQueryLabelField: "",
    });

  }, [selectedBBox, isSingle, singleKind, singleId, shapes, svgOverlays]);


  function idExistsAnywhere(id) {
    return shapes.some((s) => s.id === id) || svgOverlays.some((o) => o.id === id);
  }

  function applySingleId(nextIdRaw) {
    if (!isSingle || !singleId) return;
    const nextId = String(nextIdRaw || "").trim();
    if (!nextId) return;
    if (nextId === singleId) return;
    if (idExistsAnywhere(nextId)) return;

    if (singleKind === "Polyline" || singleKind === "Text") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, id: nextId } : s)));
      setSelectedIds([nextId]);
    } else if (singleKind === "SVG" || singleKind === "Widget") {
      setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, id: nextId } : o)));
      setSelectedOverlayIds([nextId]);
    }
  }

  function applySingleTagPath(nextRaw) {
    if (!isSingle || !singleId) return;
    const v = String(nextRaw ?? "").trim();

    if (singleKind === "Polyline" || singleKind === "Text") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, tagPath: v } : s)));
    } else if (singleKind === "SVG" || singleKind === "Widget") {
      setSvgOverlays((prev) => prev.map((o) => (o.id === singleId ? { ...o, tagPath: v } : o)));
    }
    scheduleProjectAutoSave();
  }

  function applySingleWidgetSettings(next) {
    if (!isSingle || singleKind !== "Widget" || !singleId) return;
    const source = next && typeof next === "object" ? next : {};
    const title = String(source.widgetTitle ?? "").trim();
    const unit = String(source.widgetUnit ?? "").trim();
    const min = Number(source.widgetMin);
    const max = Number(source.widgetMax);
    const decimals = Number(source.widgetDecimals);
    const historyPoints = Number(source.widgetHistoryPoints);
    const rowCount = Number(source.widgetRowCount);
    const windowMinutes = Number(source.widgetWindowMinutes);
    const durationPresetRaw = String(source.widgetDurationPreset || "").trim().toLowerCase();
    const maxPoints = Number(source.widgetMaxPoints);
    const lineTension = Number(source.widgetLineTension);
    const showPoints = String(source.widgetShowPoints ?? "true").toLowerCase() !== "false";
    const axisMode = String(source.widgetAxisMode || "").trim().toLowerCase() === "manual"
      ? "manual"
      : "auto";
    const rawBarSourceMode = String(source.widgetBarSourceMode || "table").trim().toLowerCase();
    const barSourceMode = rawBarSourceMode === "query"
      ? "query"
      : rawBarSourceMode === "tags"
      ? "tags"
      : "table";
    const barTable = String(source.widgetBarTable || "").trim();
    const barField = String(source.widgetBarField || "").trim();
    const barLabelField = String(source.widgetBarLabelField || "").trim();
    const barQuery = String(source.widgetBarQuery || "").trim();
    const barQueryValueField = String(source.widgetBarQueryValueField || "").trim();
    const barQueryLabelField = String(source.widgetBarQueryLabelField || "").trim();
    const parseDateMs = (raw) => {
      const text = String(raw ?? "").trim();
      if (!text) return null;
      if (/^\d+$/.test(text)) {
        const n = Number(text);
        return Number.isFinite(n) && n > 0 ? n : null;
      }
      const ms = Date.parse(text);
      return Number.isFinite(ms) ? ms : null;
    };
    let rangeFrom = parseDateMs(source.widgetRangeFrom);
    let rangeTo = parseDateMs(source.widgetRangeTo);
    const presetToMinutes = {
      "15m": 15,
      "30m": 30,
      "1h": 60,
      "2h": 120,
      "6h": 360,
      "12h": 720,
      "24h": 1440,
      "7d": 10080,
    };
    let resolvedWindowMinutes = Number.isFinite(windowMinutes)
      ? Math.max(1, Math.min(10080, Math.round(windowMinutes)))
      : null;
    let durationPreset = durationPresetRaw;
    if (durationPreset && Object.prototype.hasOwnProperty.call(presetToMinutes, durationPreset)) {
      resolvedWindowMinutes = presetToMinutes[durationPreset];
      rangeFrom = null;
      rangeTo = null;
    } else if (!durationPreset) {
      durationPreset = "";
    }
    if (rangeFrom != null && rangeTo != null && rangeFrom > rangeTo) {
      const t = rangeFrom;
      rangeFrom = rangeTo;
      rangeTo = t;
    }
    setSvgOverlays((prev) =>
      prev.map((o) => {
        if (o.id !== singleId) return o;
        const current = o.widget || {};
        const kind = String(current.kind || "").trim();
        let nextTagPath = String(o.tagPath || "").trim();
        if (kind === "barChart") {
          if (barSourceMode === "table" && barTable && barField) {
            nextTagPath = `db:${barTable}.${barField}`;
          } else if (barSourceMode === "query" && barQuery) {
            nextTagPath = `dbq:${barQuery}`;
          }
        }
        const sourceHasSeriesTags = Object.prototype.hasOwnProperty.call(source, "widgetSeriesTags");
        const sourceSeriesTags = normalizeSeriesTagsValue(source.widgetSeriesTags, nextTagPath);
        const currentSeriesTags = normalizeSeriesTagsValue(current.seriesTags, nextTagPath);
        const isSeriesEdit = source.__seriesTagsEdited === true;
        const allowSeriesTags =
          kind === "lineChart" || (kind === "barChart" && barSourceMode === "tags");
        const seriesTags = allowSeriesTags
          ? isSeriesEdit
            ? sourceSeriesTags
            : (currentSeriesTags.length ? currentSeriesTags : sourceSeriesTags)
          : (sourceHasSeriesTags ? sourceSeriesTags : currentSeriesTags);
        if (kind === "barChart" && barSourceMode === "tags" && seriesTags.length) {
          nextTagPath = String(seriesTags[0] || "").trim() || nextTagPath;
        }
        return {
          ...o,
          tagPath: nextTagPath,
          widget: {
            ...current,
            title,
            unit,
            min: Number.isFinite(min) ? min : Number(current.min ?? 0) || 0,
            max: Number.isFinite(max) ? max : Number(current.max ?? 100) || 100,
            decimals: Number.isFinite(decimals) ? Math.max(0, Math.round(decimals)) : Number(current.decimals ?? 0) || 0,
            historyPoints: Number.isFinite(historyPoints) ? Math.max(5, Math.min(200, Math.round(historyPoints))) : Number(current.historyPoints ?? 40) || 40,
            rowCount: Number.isFinite(rowCount) ? Math.max(1, Math.min(20, Math.round(rowCount))) : Number(current.rowCount ?? 4) || 4,
            rangeFrom,
            rangeTo,
            windowMinutes: Number.isFinite(resolvedWindowMinutes) ? resolvedWindowMinutes : Number(current.windowMinutes ?? 60) || 60,
            durationPreset,
            maxPoints: Number.isFinite(maxPoints) ? Math.max(50, Math.min(10000, Math.round(maxPoints))) : Number(current.maxPoints ?? 500) || 500,
            lineTension: Number.isFinite(lineTension) ? Math.max(0, Math.min(1, lineTension)) : Number(current.lineTension ?? 0.34),
            showPoints,
            seriesTags,
            axisMode,
            barSourceMode,
            barTable,
            barField,
            barLabelField,
            barQuery,
            barQueryValueField,
            barQueryLabelField,
          },
        };
      })
    );
    scheduleProjectAutoSave();
  }

  function onWidgetDurationPresetChange(overlayId, preset, minutes) {
    if (!isSingle || singleKind !== "Widget" || !singleId) return;
    if (String(singleId) !== String(overlayId)) return;
    const mins = Number.isFinite(Number(minutes)) ? Math.max(1, Math.min(10080, Math.round(Number(minutes)))) : 60;
    const presetText = String(preset || "").trim().toLowerCase();
    setHudFields((prev) => ({
      ...prev,
      widgetDurationPreset: presetText || "",
      widgetWindowMinutes: String(mins),
      widgetRangeFrom: "",
      widgetRangeTo: "",
    }));
  }

  const applySingleArrowStart = (v) => {
    if (!isSingle || singleKind !== "Polyline" || !singleId) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, arrowStart: v } : s)));
  };

  const applySingleArrowEnd = (v) => {
    if (!isSingle || singleKind !== "Polyline" || !singleId) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, arrowEnd: v } : s)));
  };

  const applySingleLineStyle = (v) => {
    if (!isSingle || singleKind !== "Polyline" || !singleId) return;
    setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, lineStyle: v } : s)));
  };

  function updateSvgInnerStroke(inner, stroke) {
    if (!inner) return inner;

    let next = inner;

    // Replace attribute form: stroke="..."
    next = next.replace(/stroke=['"][^'"]*['"]/gi, `stroke="${stroke}"`);

    // Replace style form: style="...; stroke: ...; ..."
    next = next.replace(/stroke:\s*[^;\"']+/gi, `stroke:${stroke}`);

    // If no stroke attribute present, inject into first shape element.
    if (!/stroke=['"][^'"]*['"]/i.test(next)) {
      next = next.replace(
        /<(polyline|polygon|path|rect|circle|ellipse|line)\b([^>]*)>/i,
        `<$1$2 stroke="${stroke}">`
      );
    }

    return next;
  }

  function updateSvgInnerFill(inner, fill) {
    if (!inner) return inner;

    let next = inner;

    // Replace attribute form: fill="..."
    next = next.replace(/fill=['"][^'"]*['"]/gi, `fill="${fill}"`);

    // Replace style form: style="...; fill: ...; ..."
    next = next.replace(/fill:\s*[^;\"']+/gi, `fill:${fill}`);

    // If no fill attribute present, inject into first shape element.
    if (!/fill=['"][^'"]*['"]/i.test(next)) {
      next = next.replace(
        /<(polyline|polygon|path|rect|circle|ellipse|line)\b([^>]*)>/i,
        `<$1$2 fill="${fill}">`
      );
    }

    return next;
  }

  function updateSvgInnerStrokeWidth(inner, strokeWidth) {
    if (!inner) return inner;
    const sw = Number.parseFloat(strokeWidth);
    if (!Number.isFinite(sw) || sw <= 0) return inner;
    const value = String(sw);

    let next = inner;
    next = next.replace(/stroke-width\s*=\s*['"][^'"]*['"]/gi, `stroke-width="${value}"`);
    next = next.replace(/stroke-width\s*:\s*[^;\"']+/gi, `stroke-width:${value}`);

    next = next.replace(
      /<(polyline|polygon|path|rect|circle|ellipse|line)\b([^>]*?)(\/?)>/gi,
      (match, tag, attrs, selfClose) => {
        const hasStroke = /stroke\s*=|stroke\s*:/i.test(attrs);
        const strokeIsNone = /stroke\s*=\s*['"]\s*none\s*['"]|stroke\s*:\s*none/i.test(attrs);
        if (!hasStroke || strokeIsNone) return match;
        if (/stroke-width\s*=|stroke-width\s*:/i.test(attrs)) return match;
        return `<${tag}${attrs} stroke-width="${value}"${selfClose}>`;
      }
    );

    return next;
  }

  function applySingleStroke(nextStroke) {
    if (!isSingle || !singleId) return;
    const c = String(nextStroke || "").trim();
    if (!c) return;

    if (singleKind === "Polyline") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, stroke: c } : s)));
    } else if (singleKind === "SVG") {
      setSvgOverlays((prev) =>
        prev.map((o) =>
          o.id === singleId ? { ...o, stroke: c, inner: updateSvgInnerStroke(o.inner, c) } : o
        )
      );
    }
  }

  function applySingleFill(nextFill) {
    if (!isSingle || !singleId) return;
    const c = String(nextFill || "").trim();
    if (!c) return;

    if (singleKind === "SVG") {
      setSvgOverlays((prev) =>
        prev.map((o) =>
          o.id === singleId ? { ...o, fill: c, inner: updateSvgInnerFill(o.inner, c) } : o
        )
      );
    } else if (singleKind === "Text") {
      setShapes((prev) => prev.map((s) => (s.id === singleId ? { ...s, fill: c } : s)));
    }
  }

  function applySingleSvgStrokeWidth(nextStrokeWidth) {
    if (!isSingle || singleKind !== "SVG" || !singleId) return;
    const sw = Number.parseFloat(nextStrokeWidth);
    if (!Number.isFinite(sw) || sw <= 0) return;
    const clamped = Math.max(0.1, sw);

    setSvgOverlays((prev) =>
      prev.map((o) =>
        o.id === singleId
          ? {
              ...o,
              strokeWidth: clamped,
              inner: updateSvgInnerStrokeWidth(o.inner, clamped),
            }
          : o
      )
    );
    scheduleProjectAutoSave();
  }

  function applyBBoxFromHud(next) {
    const X = numOrNull(next.x);
    const Y = numOrNull(next.y);
    const W = numOrNull(next.w);
    const H = numOrNull(next.h);

    if (!selectedBBox) return;

    if (selectedOverlayIds.length === 1 && selectedIds.length === 0) {
      const id = selectedOverlayIds[0];
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) return;

      // use your key-based bbox first (this is {width: 25, height: 25} for your files)
      const bb = o.bbox || overlayLocalBBox(id);
      if (!bb) return;

      const targetX = X == null ? selectedBBox.x : X;
      const targetY = Y == null ? selectedBBox.y : Y;

      // compute scale from desired W/H
      let nextScale = o.scale;

      // If user typed W, scale must be W / bb.width
      if (W != null && bb.width > 0) nextScale = W / bb.width;

      // If user typed H (and not W), scale must be H / bb.height
      if (W == null && H != null && bb.height > 0) nextScale = H / bb.height;

      // If they typed BOTH, we cannot satisfy both unless aspect matches (uniform scale).
      // We'll prefer W (so "exact W" works). If you prefer "fit inside", use Math.min().
      if (W != null && H != null && bb.width > 0 && bb.height > 0) {
        nextScale = W / bb.width; // ✅ prefer exact W
        // alternative: nextScale = Math.min(W / bb.width, H / bb.height);
      }

      nextScale = Math.max(0.05, nextScale);

      // Make top-left match targetX/targetY
      const newTx = targetX - nextScale * bb.x;
      const newTy = targetY - nextScale * bb.y;

      setSvgOverlays((prev) =>
        prev.map((x) => (x.id === id ? { ...x, tx: newTx, ty: newTy, scale: nextScale } : x))
      );

      return; // ✅ stop here so old min(sx,sy) logic doesn't interfere
    }

    const base = selectedBBox;
    const baseW = Math.max(base.w, 1e-6);
    const baseH = Math.max(base.h, 1e-6);

    const targetX = X == null ? base.x : X;
    const targetY = Y == null ? base.y : Y;

    const sx = W == null ? 1 : W / baseW;
    const sy = H == null ? 1 : H / baseH;

    const dx = targetX - base.x;
    const dy = targetY - base.y;

    // Polylines: non-uniform scale
    // Shapes (polylines + text)
    if (selectedIds.length) {
      const sUni = Math.max(0.05, Math.min(sx, sy)); // useful for text/font scaling

      setShapes((prev) =>
        prev.map((s) => {
          if (!selectedIds.includes(s.id)) return s;

          // ✅ Polyline
          if ((s.type === "polyline" || Array.isArray(s.points)) && Array.isArray(s.points)) {
            const pts = s.points.map((p) => ({
              x: base.x + (p.x - base.x) * sx + dx,
              y: base.y + (p.y - base.y) * sy + dy,
            }));
            return { ...s, points: pts };
          }

          // ✅ Text
          if (s.type === "text") {
            const newX = base.x + (Number(s.x ?? 0) - base.x) * sx + dx;
            const newY = base.y + (Number(s.y ?? 0) - base.y) * sy + dy;

            // If user is resizing via W/H, scale fontSize uniformly (optional but feels right)
            const fs0 = Number(s.fontSize ?? 24);
            const newFontSize =
              Number.isFinite(fs0) ? Math.max(1, fs0 * sUni) : s.fontSize;

            return { ...s, x: newX, y: newY, fontSize: newFontSize };
          }

          if (s.type === "rect") {
            const x0 = Number(s.x ?? 0);
            const y0 = Number(s.y ?? 0);
            const w0 = Math.max(0, Number(s.width ?? 0));
            const h0 = Math.max(0, Number(s.height ?? 0));
            const x1 = x0 + w0;
            const y1 = y0 + h0;

            const nx0 = base.x + (x0 - base.x) * sx + dx;
            const ny0 = base.y + (y0 - base.y) * sy + dy;
            const nx1 = base.x + (x1 - base.x) * sx + dx;
            const ny1 = base.y + (y1 - base.y) * sy + dy;

            return {
              ...s,
              x: Math.min(nx0, nx1),
              y: Math.min(ny0, ny1),
              width: Math.abs(nx1 - nx0),
              height: Math.abs(ny1 - ny0),
            };
          }

          // unknown shape type: just move by dx/dy
          return s;
        })
      );
    }


    // Overlays: uniform scale only
    if (selectedOverlayIds.length) {
      const sUni = Math.max(0.05, Math.min(sx, sy));
      setSvgOverlays((prev) =>
        prev.map((o) => {
          if (!selectedOverlayIds.includes(o.id)) return o;

          const newTx = base.x + (o.tx - base.x) * sx + dx;
          const newTy = base.y + (o.ty - base.y) * sy + dy;
          const newScale = Math.max(0.05, o.scale * sUni);

          return { ...o, tx: newTx, ty: newTy, scale: newScale };
        })
      );
    }
  }

  // ---------- Mouse / Keyboard ----------
  useKeyboardShortcuts({
    drawing,
    editingId,
    importOpen,
    selCount,
    duplicateSelected: handleDuplicate,
    cancelPolyline,
    exitEditMode,
    toggleEditMode,
    setTool,
    closeImport: () => setImportOpen(false),
    clearSelection,
    selectAll,
    clearImportAnchor: () => setImportAnchor(null),
    deleteSelected,
  });

  function onSvgMouseDown(e) {
    if (e.button === 2) return;
    if (importOpen) return;
    if (showProjectNameInput) cancelNewProjectInput();

    const p = svgPoint(e);

    if (tool === "polyline") {
      let p2 = p;

      if (e.altKey && drawing?.mode === "draw-poly") {
        const cur = shapesRef.current.find((s) => s.id === drawing.id);
        if (cur?.type === "polyline" && Array.isArray(cur.points) && cur.points.length >= 2) {
          const fixed = cur.points.slice(0, -1);
          const last = fixed[fixed.length - 1];
          if (last) p2 = constrainHV(last, p2);
        }
      }

      if (!drawing) startPolylineAt(p2);
      else addPolylinePoint(p2);
      return;
    }

    if (tool === "text") {
      startTextAt(p);
      return;
    }

    if (tool === "rect") {
      startRectAt(p);
      return;
    }

    if (tool === "select") {
      setMarquee({ start: p, cur: p, additive: !!e.shiftKey });
      exitEditMode();
      setDrawing(null);
    }
  }


  function onSvgDoubleClick(e) {
    // while drawing, dblclick finishes line
    if (tool === "polyline" && drawing) {
      e.preventDefault();
      e.stopPropagation();
      finishPolyline();
      return;
    }

    // (optional) keep your non-drawing dblclick behavior here if you want later
  }

  useEffect(() => {
    function isTypingTarget(t) {
      if (!t) return false;
      const tag = (t.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || t.isContentEditable;
    }

    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return;
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      if (editingId) {
        setSelectedSegment(null);
        exitEditMode();
        return;
      }
      if (!drawing) return;
      if (drawing.mode === "draw-poly") {
        finishPolyline();
        return;
      }
      if (drawing.mode === "draw-rect") {
        finishRectDrawing(drawing.id);
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [tool, drawing, editingId]);


  function onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();

    // ✅ While drawing: right-click removes the last SAVED segment (2 entries back)
    if (tool === "polyline" && drawing?.mode === "draw-poly") {
      const id = drawing.id;

      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;

          // points = [...fixed, preview]
          // need at least [p0, p1, preview] to undo a segment
          if (!s.points || s.points.length < 3) return s;

          // remove last fixed + preview
          const fixedMinusLast = s.points.slice(0, -2);

          // if only one point left, keep preview at that point
          const tail = fixedMinusLast[fixedMinusLast.length - 1] ?? s.points[0];
          return { ...s, points: [...fixedMinusLast, { x: tail.x, y: tail.y }] };
        })
      );

      return;
    }

    // ✅ Not drawing: keep your import-marker right-double-click
    const now = performance.now();
    const dt = now - (lastRightClickRef.current || 0);
    lastRightClickRef.current = now;

    if (dt > 0 && dt < RIGHT_DBL_MS) {
      const p = svgPoint(e);
      setImportAnchor(p);
      setContextMenu(null);
      return;
    }

    if (importOpen) return;

    const p = svgPoint(e);
    function pointInRect(pt, r) {
      return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
    }

    let hit = false;
    let hitShapeId = null;
    let hitOverlayId = null;

    for (const s of shapesRef.current || []) {
      if (s.type === "text") {
        const fontSize = Number(s.fontSize ?? 24);
        const txt = String(s.text ?? "");
        const estW = Math.max(10, txt.length * fontSize * 0.6);
        const estH = Math.max(10, fontSize * 1.2);
        const anchor = s.anchor ?? "start";
        const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
        const pad = 8;
        const r = {
          x: Number(s.x ?? 0) + ax - pad,
          y: Number(s.y ?? 0) - pad,
          w: Math.max(estW + pad * 2, 60),
          h: Math.max(estH + pad * 2, 28),
        };
        if (pointInRect(p, r)) { hit = true; hitShapeId = s.id; break; }
      } else if (s.type === "rect") {
        const r = {
          x: Number(s.x ?? 0),
          y: Number(s.y ?? 0),
          w: Math.max(0, Number(s.width ?? 0)),
          h: Math.max(0, Number(s.height ?? 0)),
        };
        if (pointInRect(p, r)) { hit = true; hitShapeId = s.id; break; }
      } else if (Array.isArray(s.points)) {
        const bb = bboxOfPoints(s.points);
        if (bb) {
          const r = { x: bb.minX, y: bb.minY, w: bb.w, h: bb.h };
          if (pointInRect(p, r)) { hit = true; hitShapeId = s.id; break; }
        }
      }
    }

    if (!hit) {
      for (const o of overlaysRef.current || []) {
        const bb = o.bbox || overlayLocalBBox(o.id);
        if (!bb) continue;
        const r = {
          x: o.tx + o.scale * bb.x,
          y: o.ty + o.scale * bb.y,
          w: o.scale * bb.width,
          h: o.scale * bb.height,
        };
        if (pointInRect(p, r)) { hit = true; hitOverlayId = o.id; break; }
      }
    }

    // ✅ If nothing directly hit, allow right-click on current group bbox
    if (!hit && selectedBBox) {
      const r = { x: selectedBBox.x, y: selectedBBox.y, w: selectedBBox.w, h: selectedBBox.h };
      if (pointInRect(p, r)) {
        hit = true;
      }
    }

    const curSelShapes = selPolyRef.current || [];
    const curSelOvers = selOverRef.current || [];
    const curSelCount = curSelShapes.length + curSelOvers.length;

    if (hitShapeId) {
      if (!(curSelCount > 1 && curSelShapes.includes(hitShapeId))) {
        setSelectedIds([hitShapeId]);
        setSelectedOverlayIds([]);
      }
    } else if (hitOverlayId) {
      if (!(curSelCount > 1 && curSelOvers.includes(hitOverlayId))) {
        setSelectedOverlayIds([hitOverlayId]);
        setSelectedIds([]);
      }
    }

    setContextMenu({ x: e.clientX, y: e.clientY, mode: hit ? "element" : "empty" });
    setLastContextPoint(p);
    if (!hit) setContextImportQuery("");
    setContextSvgMenuOpen(false);
  }




  async function publishProjectCursor(point) {
    if (!activeProjectId || !point) return;
    const now = Date.now();
    const last = lastCursorSentRef.current || { at: 0, x: NaN, y: NaN };
    const dx = Math.abs(Number(point.x) - Number(last.x));
    const dy = Math.abs(Number(point.y) - Number(last.y));
    if (now - Number(last.at || 0) < 120 && dx < 0.5 && dy < 0.5) return;
    lastCursorSentRef.current = { at: now, x: Number(point.x), y: Number(point.y) };
    try {
      await fetch(`/api/projects/${activeProjectId}/cursor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: Number(point.x), y: Number(point.y) }),
      });
    } catch {
      // ignore cursor publish failures
    }
  }

  function onMouseMove(e) {
    const p =
      drawing?.mode === "draw-poly"
        ? svgPoint(e, { snapToGrid: true })
        : svgPoint(e, { snapToGrid: false });
    publishProjectCursor(p);
    if (marquee) {
      setMarquee((m) => (m ? { ...m, cur: p } : m));
      return;
    }

    if (drawing?.mode === "draw-poly") {
      const id = drawing.id;

      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;

          const pts = s.points.slice();
          const fixed = pts.slice(0, -1);             // points excluding preview
          const last = fixed[fixed.length - 1] || pts[0];

          let nextP = svgPoint(e);

          // ✅ ALT = straight line (horizontal/vertical) from last fixed point
          if (e.altKey && last) {
            nextP = constrainHV(last, nextP);
          }

          const first = fixed[0];
          const SNAP_DIST = 12;
          if (first && distance(nextP, first) <= SNAP_DIST) {
            nextP = { x: first.x, y: first.y };
          }

          pts[pts.length - 1] = { x: nextP.x, y: nextP.y };
          return { ...s, points: pts };
        })
      );
      return;
    }

    if (overlayResize) {
      const { id, isWidget, anchorLocal, anchorWorld, startDist, origScale } = overlayResize;
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) return;

      if (isWidget) {
        const minW = 80;
        const minH = 60;
        const leftRaw = Math.min(anchorWorld.x, p.x);
        const rightRaw = Math.max(anchorWorld.x, p.x);
        const topRaw = Math.min(anchorWorld.y, p.y);
        const bottomRaw = Math.max(anchorWorld.y, p.y);
        const width = Math.max(minW, rightRaw - leftRaw);
        const height = Math.max(minH, bottomRaw - topRaw);
        setSvgOverlays((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  scale: 1,
                  tx: leftRaw,
                  ty: topRaw,
                  bbox: { x: 0, y: 0, width, height },
                }
              : x
          )
        );
        return;
      }

      const d = Math.max(1, distance(p, anchorWorld));
      const ratio = d / startDist;
      const newScale = Math.max(0.05, origScale * ratio);

      const newTx = anchorWorld.x - newScale * anchorLocal.x;
      const newTy = anchorWorld.y - newScale * anchorLocal.y;

      setSvgOverlays((prev) =>
        prev.map((x) => (x.id === id ? { ...x, scale: newScale, tx: newTx, ty: newTy } : x))
      );
      return;
    }

    if (dragHandle) {
      setShapes((prev) =>
        prev.map((s) => {
          if (s.id !== dragHandle.id) return s;
          const pts = s.points.slice();
          pts[dragHandle.index] = { x: p.x, y: p.y };
          return { ...s, points: pts };
        })
      );
      return;
    }

    if (dragAll) {
      const dx = p.x - dragAll.startWorld.x;
      const dy = p.y - dragAll.startWorld.y;

      if (dragAll.shapes?.length) {
        setShapes((prev) =>
          prev.map((s) => {
            const rec = dragAll.shapes.find((x) => x.id === s.id);
            if (!rec) return s;

            if (rec.kind === "text" && s.type === "text") {
              return { ...s, x: rec.origX + dx, y: rec.origY + dy };
            }

            if (rec.kind === "rect" && s.type === "rect") {
              return {
                ...s,
                x: rec.origX + dx,
                y: rec.origY + dy,
                width: rec.origW,
                height: rec.origH,
              };
            }

            if (rec.kind === "poly" && Array.isArray(s.points)) {
              return { ...s, points: rec.origPoints.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })) };
            }

            return s;
          })
        );
      }

      if (dragAll.overlays?.length) {
        setSvgOverlays((prev) =>
          prev.map((o) => {
            const rec = dragAll.overlays.find((x) => x.id === o.id);
            if (!rec) return o;
            return { ...o, tx: rec.origTx + dx, ty: rec.origTy + dy };
          })
        );
      }
      return;
    }

    if (drawing?.mode === "draw-rect" && drawing.id) {
      const sx = Number(drawing.start?.x ?? p.x);
      const sy = Number(drawing.start?.y ?? p.y);
      const x = Math.min(sx, p.x);
      const y = Math.min(sy, p.y);
      const width = Math.abs(p.x - sx);
      const height = Math.abs(p.y - sy);
      setShapes((prev) =>
        prev.map((s) => (s.id === drawing.id ? { ...s, x, y, width, height } : s))
      );
      return;
    }

  }

  function onMouseUp() {
    const hadDragHandle = !!dragHandle;
    if (marquee) {
      const r = rectFrom2Points(marquee.start, marquee.cur);

      // ✅ Shapes (polylines + text + rect) in rect
      const hitShapeIds = shapes
        .filter((s) => {
          // Polyline bbox
          if (s.type === "polyline" && Array.isArray(s.points)) {
            const bb = bboxOfPoints(s.points);
            if (!bb) return false;
            const br = { x: bb.minX, y: bb.minY, w: bb.w, h: bb.h };
            return rectsIntersect(r, br);
          }

          // Text bbox (approx)
          if (s.type === "text") {
            const fontSize = Number(s.fontSize ?? 24);
            const txt = String(s.text ?? "");
            const estW = Math.max(10, txt.length * fontSize * 0.6);
            const estH = Math.max(10, fontSize * 1.2);

            const anchor = s.anchor ?? "start";
            const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;

            const br = {
              x: Number(s.x ?? 0) + ax,
              y: Number(s.y ?? 0) - estH, // baseline -> top
              w: estW,
              h: estH,
            };
            return rectsIntersect(r, br);
          }

          if (s.type === "rect") {
            const br = {
              x: Number(s.x ?? 0),
              y: Number(s.y ?? 0),
              w: Math.max(0, Number(s.width ?? 0)),
              h: Math.max(0, Number(s.height ?? 0)),
            };
            return rectsIntersect(r, br);
          }

          return false;
        })
        .map((s) => s.id);

      // ✅ Overlays in rect
      const hitOvers = svgOverlays
        .filter((o) => {
          const bb = overlayLocalBBox(o.id);
          if (!bb) return false;
          const wr = {
            x: o.tx + o.scale * bb.x,
            y: o.ty + o.scale * bb.y,
            w: o.scale * bb.width,
            h: o.scale * bb.height,
          };
          return rectsIntersect(r, wr);
        })
        .map((o) => o.id);

      if (marquee.additive) {
        if (hitShapeIds.length || hitOvers.length) {
          setSelectedIds((prev) => Array.from(new Set([...(prev || []), ...hitShapeIds])));
          setSelectedOverlayIds((prev) => Array.from(new Set([...(prev || []), ...hitOvers])));
        }
      } else if (hitShapeIds.length || hitOvers.length) {
        setSelectedIds(hitShapeIds);
        setSelectedOverlayIds(hitOvers);
      } else {
        clearSelection();
      }

      setMarquee(null);
      setDragAll(null);
      setDragHandle(null);
      setOverlayResize(null);
      return;
    }

    const movedSomething = !!(dragAll || dragHandle || overlayResize);
    setDragAll(null);
    setDragHandle(null);
    setOverlayResize(null);
    if (hadDragHandle) {
      setSelectedSegment(null);
      exitEditMode();
    }
    if (movedSomething) scheduleProjectAutoSave();
    if (drawing?.mode === "draw-rect" && drawing.id) finishRectDrawing(drawing.id);
  }



  function exportSVG() {
    const svg = svgRef.current;
    if (!svg) return;

    const serializer = new XMLSerializer();
    const svgText = serializer.serializeToString(svg);

    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "drawing.svg";
    a.click();

    URL.revokeObjectURL(url);
  }

  function exportIgnitionJson() {
    const payload = exportToIgnitionJson(
      { svgRef, shapes, svgOverlays, overlayRefs },
      { name: "Exported Drawing" }
    );

    downloadIgnitionJson(payload, "ignition-shapes.json");
  }

  function overlaySelectionUI(o) {
    const bb = overlayLocalBBox(o.id);
    if (!bb) return null;

    const x = o.tx + o.scale * bb.x;
    const y = o.ty + o.scale * bb.y;
    const w = o.scale * bb.width;
    const h = o.scale * bb.height;

    const corners = [
      { key: "TL", cx: x, cy: y },
      { key: "TR", cx: x + w, cy: y },
      { key: "BR", cx: x + w, cy: y + h },
      { key: "BL", cx: x, cy: y + h },
    ];

    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke="#2b6cff"
          strokeWidth={2}
          strokeDasharray="6 4"
          pointerEvents="none"
        />

        {corners.map((c) => (
          <g key={c.key}>
            <circle cx={c.cx} cy={c.cy} r={3} fill="white" stroke="#2b6cff" strokeWidth={2} />
            <circle
              cx={c.cx}
              cy={c.cy}
              r={16}
              fill="transparent"
              style={{ cursor: altDown ? "move" : "nwse-resize" }}
              onMouseDown={(e) => onOverlayHandleDown(e, o.id, c.key)}
            />
          </g>
        ))}
      </g>
    );
  }

  const inlineEditPos = useMemo(() => {
    if (!inlineEdit?.id || !svgRef.current) return null;
    const s = shapes.find((x) => x.id === inlineEdit.id);
    if (!s) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const z = zoom || 1;
    const x = rect.left + (pan?.x || 0) + Number(s.x ?? 0) * z;
    const y = rect.top + (pan?.y || 0) + Number(s.y ?? 0) * z;
    const fontSize = Math.max(10, Number(s.fontSize ?? 24) * z);
    const fontFamily = s.fontFamily || "system-ui";
    const fontWeight = s.fontWeight || "400";
    const anchor = s.anchor || "start";
    const text = String(s.text ?? "");
    const estW = Math.max(10, text.length * Number(s.fontSize ?? 24) * 0.6 * z);
    const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
    return { x: x + ax, y: y + 2, fontSize, fontFamily, fontWeight, width: Math.max(120, estW + 12) };
  }, [inlineEdit?.id, shapes, pan, zoom]);

  const panelAnchor = useMemo(() => {
    if (!selectedBBox || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const z = zoom || 1;
    const px = rect.left + (pan?.x || 0) + (selectedBBox.x || 0) * z;
    const py = rect.top + (pan?.y || 0) + (selectedBBox.y || 0) * z;
    const pw = (selectedBBox.w || 0) * z;
    const ph = (selectedBBox.h || 0) * z;
    return { x: px, y: py, w: pw, h: ph };
  }, [selectedBBox, pan, zoom]);

  const panelAnchorKey = useMemo(() => {
    if (!selectedBBox) return "";
    const selShapeKey = (selectedIds || []).join(",");
    const selOverlayKey = (selectedOverlayIds || []).join(",");
    return `${selCount}-${singleKind}-${selShapeKey}-${selOverlayKey}`;
  }, [selectedBBox, selCount, singleKind, selectedIds, selectedOverlayIds]);

  const freezePanel = !!(dragAll || dragHandle || overlayResize);
  const isEmptyMenu = contextMenu?.mode === "empty";
  const menuSize = isEmptyMenu ? { w: 210, h: 260 } : { w: 190, h: 240 };
  const winW = typeof window !== "undefined" ? window.innerWidth : 0;
  const winH = typeof window !== "undefined" ? window.innerHeight : 0;
  const menuLeft = contextMenu
    ? Math.min(Math.max(12, contextMenu.x), Math.max(12, winW - menuSize.w - 12))
    : 0;
  const menuTop = contextMenu
    ? Math.min(Math.max(12, contextMenu.y), Math.max(12, winH - menuSize.h - 12))
    : 0;
  const subMenuSize = { w: 260, h: 360 };
  const subMenuLeft = Math.min(
    Math.max(12, contextSvgMenuPos.x),
    Math.max(12, winW - subMenuSize.w - 12)
  );
  const subMenuTop = Math.min(
    Math.max(12, contextSvgMenuPos.y),
    Math.max(12, winH - subMenuSize.h - 12)
  );
  const contextSingleSvg =
    selectedOverlayIds.length === 1 && selectedIds.length === 0
      ? svgOverlays.find((o) => o.id === selectedOverlayIds[0]) || null
      : null;
  const topMenuTextButtonStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg-elev)",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const topMenuIconButtonStyle = {
    ...topMenuTextButtonStyle,
    width: 30,
    height: 28,
    padding: 0,
    display: "grid",
    placeItems: "center",
  };
  const topMenuDeleteButtonStyle = (enabled = true) => ({
    ...topMenuIconButtonStyle,
    border: "1px solid #f04438",
    background: enabled ? "#f04438" : "rgba(244,68,56,0.55)",
    color: "#ffffff",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.9,
  });
  const topMenuIconSize = 14;
  const topMenuModeButtonStyle = (active) => ({
    ...topMenuIconButtonStyle,
    border: topMenuTextButtonStyle.border,
    color: active ? (theme === "dark" ? "#0b1220" : "#ffffff") : topMenuTextButtonStyle.color,
    background: active
      ? theme === "dark"
        ? "linear-gradient(180deg, #cfd4dc 0%, #aeb7c4 100%)"
        : "#2b6cff"
      : topMenuIconButtonStyle.background,
    boxShadow: "none",
  });
  const drawerHeaderButtonStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg-elev)",
    color: "var(--text)",
    borderRadius: 10,
    width: 34,
    height: 34,
    padding: 0,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    display: "grid",
    placeItems: "center",
  };
  const drawerTabButtonStyle = (active) => ({
    border: `1px solid ${active ? "#2b6cff" : "var(--border)"}`,
    background: active ? "#2b6cff" : "var(--bg-soft)",
    color: active ? "#ffffff" : "var(--text)",
    borderRadius: 10,
    minWidth: 96,
    height: 34,
    padding: "0 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: active ? "0 0 0 1px rgba(43,108,255,0.3)" : "none",
  });
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );
  const activeScreen = useMemo(() => {
    if (!Array.isArray(screens) || !screens.length) return null;
    return screens.find((s) => s.id === activeScreenId) || screens[0];
  }, [screens, activeScreenId]);

  function switchToScreen(nextScreenId) {
    const committed = commitCurrentScreenState(screens);
    const target = committed.list.find((s) => s.id === nextScreenId) || committed.list[0];
    setScreens(committed.list);
    if (!target) return;
    hydrateScreenState(target);
    scheduleProjectAutoSave();
  }

  function addScreen() {
    const committed = commitCurrentScreenState(screens);
    const existingIds = new Set(committed.list.map((s) => String(s.id || "")));
    let id = `screen-${uid()}`;
    while (existingIds.has(id)) id = `screen-${uid()}`;
    const existingNames = new Set(committed.list.map((s) => String(s.name || "").trim().toLowerCase()));
    let n = committed.list.length + 1;
    let name = `Screen ${n}`;
    while (existingNames.has(name.toLowerCase())) {
      n += 1;
      name = `Screen ${n}`;
    }
    const next = [
      ...committed.list,
      normalizeScreenPayload({
        id,
        name,
        shapes: [],
        svgOverlays: [],
        vbW: 1600,
        vbH: 900,
        pan: { x: 0, y: 0 },
        zoom: 1,
      }),
    ];
    setScreens(next);
    hydrateScreenState(next[next.length - 1]);
    setProjectStatus(`Added ${name}`);
    scheduleProjectAutoSave();
  }

  function deleteActiveScreen() {
    const committed = commitCurrentScreenState(screens);
    if (committed.list.length <= 1) return;
    const removed = committed.list.find((s) => s.id === committed.currentId);
    const filtered = committed.list.filter((s) => s.id !== committed.currentId);
    const target = filtered[0] || null;
    setScreens(filtered);
    if (target) hydrateScreenState(target);
    setProjectStatus(`Deleted ${removed?.name || "screen"}`);
    scheduleProjectAutoSave();
  }

  function renameActiveScreen(value) {
    const nextName = String(value || "").trim() || "Screen";
    setScreenName(nextName);
    setScreens((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) =>
        s.id === activeScreenId ? { ...s, name: nextName } : s
      )
    );
    scheduleProjectAutoSave();
  }

  const formatProjectTime = (value) => {
    const t = String(value || "").trim();
    if (!t) return "";
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  };
  const activeCanvasBackgroundColor =
    theme === "dark" ? projectCanvasBackground.dark : projectCanvasBackground.light;
  const projectDrawerInset =
    showProjectDrawer && !projectDrawerFullscreen ? `${Math.round(drawerSizes.project.w)}px` : "0px";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        color: "var(--text)",
        overflow: "hidden",
        fontFamily: "system-ui",
        userSelect: "none",
        WebkitUserSelect: "none",
        paddingTop: TOP_BAR_H,
        paddingLeft: projectDrawerInset,
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes drawer-slide-in-right {
          from { transform: translateX(18px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes drawer-slide-in-left {
          from { transform: translateX(-18px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
      <ViewBoxModal
        open={viewBoxOpen}
        onClose={() => setViewBoxOpen(false)}
        vbW={vbW}
        vbH={vbH}
        onApply={applyViewBox}
      />

      <PropertiesPanel
        showHUD={showHUD}
        setShowHUD={setShowHUD}
        selectedBBox={selectedBBox}
        selCount={selCount}
        isSingle={isSingle}
        singleKind={singleKind}
        selectedIds={selectedIds}
        singleOverlayId={singleSelectedOverlayId}
        svgFiles={svgFiles}
        svgTemplateKey={singleSvgTemplateKey}
        swapSvgTemplate={swapOverlayTemplate}
        svgTemplateName={singleGeneratedTemplate?.name || ""}
        isGeneratedTemplate={!!singleGeneratedTemplate}
        renameSvgTemplate={renameGeneratedSvg}
        persistSvgMeta={persistSvgMeta}
        panelAnchor={panelAnchor}
        panelAnchorKey={panelAnchorKey}
        panelCursor={panelCursor}
        freezePanel={freezePanel}
        hudFields={hudFields}
        setHudFields={setHudFields}
        applySingleId={applySingleId}
        applySingleTagPath={applySingleTagPath}
        applySingleFill={applySingleFill}
        applySingleStroke={applySingleStroke}
        applySingleSvgStrokeWidth={applySingleSvgStrokeWidth}
        applyBBoxFromHud={applyBBoxFromHud}
        applySingleArrowStart={applySingleArrowStart}
        applySingleArrowEnd={applySingleArrowEnd}
        applySingleLineStyle={applySingleLineStyle}
        applySingleTextValue={applySingleTextValue}
        applySingleFontSize={applySingleFontSize}
        applySingleFontFamily={applySingleFontFamily}
        applySingleFontWeight={applySingleFontWeight}
        applySingleTextAlign={applySingleTextAlign}
        applySingleWidgetSettings={applySingleWidgetSettings}
        opcTags={opcTags}
        duplicateOffset={duplicateOffset}
        setDuplicateOffset={setDuplicateOffset}
        convertPolylinesToSvg={convertSelectedPolylinesToSvg}
        bounds={{
          top: TOP_BAR_H + RULER_SIZE + 8,
          left: RULER_SIZE + 8,
          right: RULER_SIZE + 8,
          bottom: 8,
        }}
      />

      <ImportModal
        importOpen={importOpen}
        setImportOpen={setImportOpen}
        svgFiles={svgFiles}
        svgLibrary={SVG_LIBRARY}
        loadSvgRaw={readSvgRawByKey}
        onPickSvg={onPickSvg}
      />
      <WidgetSelectorModal
        open={widgetOpen}
        onClose={() => setWidgetOpen(false)}
        onPickWidget={(key) => onPickWidget(key)}
      />

      <CanvasSvg
          svgRef={svgRef}
          theme={theme}
          canvasBackgroundColor={activeCanvasBackgroundColor}
          zoom={zoom}          // ✅ NEW
          onWheel={onWheelZoom} // ✅ NEW
          vbW={vbW}
          vbH={vbH}
          tool={tool}
          shapes={shapes}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          setSelectedOverlayIds={setSelectedOverlayIds}
          inlineEditId={inlineEdit?.id || null}
          selectedSegment={selectedSegment}
          editingId={editingId}
        showTagPaths={showTagPaths}
        showGrid={showGrid}
        onSvgMouseDown={onSvgMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
        onShapeMouseDown={onShapeMouseDown}
        onShapeDoubleClick={onShapeDoubleClick}
        onEditPolylineClick={onEditPolylineClick}
        onHandleMouseDown={onHandleMouseDown}
        onHandleDoubleClick={onHandleDoubleClick}
        onHandleContextMenu={onHandleContextMenu}
        onSegmentMouseDown={onSegmentMouseDown}
        setShapes={setShapes}
        svgOverlays={svgOverlays}
        setSvgOverlays={setSvgOverlays}
        selectedOverlayIds={selectedOverlayIds}
        singleSelectedOverlayId={singleSelectedOverlayId}
        setOverlayRef={setOverlayRef}
        onOverlayMouseDown={onOverlayMouseDown}
        onOverlayDoubleClick={onOverlayDoubleClick}
        overlaySelectionUI={overlaySelectionUI}
        overlayLocalBBox={overlayLocalBBox}
        marquee={marquee}
        pan={pan}
        importAnchor={importAnchor}
        onSvgDoubleClick={onSvgDoubleClick}
        tagStateColorsByPath={tagStateColorsByPath}
        routeColorsBySvgKey={routeColorsBySvgKey}
        routeStrokeColorByGroupPath={routeStrokeColorByGroupPath}
        svgLiveValuesByGroupPath={svgLiveValuesByGroupPath}
        opcLiveValues={opcLiveValues}
        widgetDbValues={widgetDbValues}
        onWidgetDurationPresetChange={onWidgetDurationPresetChange}
        hiddenTagBubbleIds={hiddenTagBubbleIds}
        onHideTagBubble={(id) =>
          setHiddenTagBubbleIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
        }
        collaboratorCursors={projectCursors}
      />

      {inlineEdit && inlineEditPos && (
        <input
          autoFocus
          value={inlineEdit.value}
          onChange={(e) => setInlineEdit((p) => ({ ...p, value: e.target.value }))}
          onBlur={() => {
            const next = inlineEdit.value;
            if (next != null) {
              pushHistory();
              setShapes((prev) =>
                prev.map((x) => (x.id === inlineEdit.id ? { ...x, text: String(next) } : x))
              );
            }
            setInlineEdit(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setInlineEdit(null);
            }
          }}
          style={{
            position: "fixed",
            left: inlineEditPos.x,
            top: inlineEditPos.y,
            transform: "translateY(0)",
            fontSize: inlineEditPos.fontSize,
            fontFamily: inlineEditPos.fontFamily,
            fontWeight: inlineEditPos.fontWeight,
            color: "var(--text)",
            border: "1px solid #2b6cff",
            borderRadius: 6,
            padding: "2px 6px",
            background: "var(--bg-elev)",
            zIndex: 200,
            outline: "none",
            minWidth: inlineEditPos.width,
          }}
        />
      )}

      <input
        ref={projectFileRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={async (e) => {
          const input = e.currentTarget;
          const file = input.files?.[0];

          // ✅ allow selecting same file again later
          input.value = "";

          if (!file) return;

          const text = await file.text();

          let data;
          try {
            data = JSON.parse(text);
          } catch {
            alert("Invalid JSON file.");
            return;
          }

          const nextShapes = Array.isArray(data.shapes) ? data.shapes : [];
          const nextOverlays = Array.isArray(data.svgOverlays) ? data.svgOverlays : [];

          pushHistory(); // undo support

          setShapes(nextShapes);
          setSvgOverlays(nextOverlays);

          if (Number.isFinite(data.vbW)) setVbW(data.vbW);
          if (Number.isFinite(data.vbH)) setVbH(data.vbH);

          if (data.pan && Number.isFinite(data.pan.x) && Number.isFinite(data.pan.y)) {
            setPan({ x: data.pan.x, y: data.pan.y });
          }

          if (Number.isFinite(data.zoom)) setZoom(data.zoom);

          // ✅ update project metadata
          setProjectHandle(null); // loaded from download; no writable handle
          setProjectName(
            (data?.name && String(data.name)) ||
            (file.name ? file.name.replace(/\.json$/i, "") : "Untitled")
          );

          // clear transient editor state
          setSelectedIds([]);
          setSelectedOverlayIds([]);
          setEditingId(null);
          setDrawing(null);
          setDragAll(null);
          setDragHandle(null);
          setOverlayResize(null);
          setMarquee(null);
          setImportAnchor(null);
        }}
      />




      {showZoom && (
        <div
          ref={zoomPanelRef}
          style={{
            position: "fixed",
            left: Math.max(zoomPos.x, 8),
            bottom: 16,
            zIndex: 80,
            boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 10,
            background: "color-mix(in srgb, var(--bg-elev) 92%, transparent)",
            border: "1px solid var(--border)",
            borderRadius: 14,
            alignItems: "center",
          }}
          onMouseDown={startZoomDrag}
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Zoom buttons */}
          {[
            { label: "+", onClick: zoomIn, title: "Zoom In" },
            { label: "−", onClick: zoomOut, title: "Zoom Out" },
            { label: "⟲", onClick: resetView, title: "Reset View" },
          ].map((btn) => (
            <button
              key={btn.title}
              title={btn.title}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={btn.onClick}
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                cursor: "pointer",
                boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
                color: "var(--text)",
                display: "grid",
                placeItems: "center",
                padding: 0,
                fontSize: 18,
                lineHeight: 1,
              }}
            >
              {btn.label}
            </button>
          ))}

          {/* zoom % */}
          <div
            style={{
              fontSize: 12,
              opacity: 0.6,
              marginTop: 2,
              userSelect: "none",
            }}
          >
            {Math.round((zoom || 1) * 100)}%
          </div>

          {/* ❌ Hide button (toolbar style, bottom) */}
          <button
            title="Hide Zoom"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setShowZoom(false)}
            style={{
              width: 38,
              height: 38,
              marginTop: 6,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
              color: "var(--text)",
              display: "grid",
              placeItems: "center",
              padding: 0,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: menuLeft,
            top: menuTop,
            zIndex: 200,
            background: "var(--bg-elev)",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            padding: isEmptyMenu ? 0 : "6px 0",
            minWidth: isEmptyMenu ? menuSize.w : 160,
            maxHeight: isEmptyMenu ? menuSize.h : undefined,
            overflow: isEmptyMenu ? "hidden" : "visible",
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            const target = e.target;
            const isFormControl =
              target instanceof Element &&
              !!target.closest("select, option, input, textarea, button");
            if (!isFormControl) {
              e.preventDefault();
            }
          }}
          onMouseLeave={() => {
            if (contextSvgMenuTimerRef.current) clearTimeout(contextSvgMenuTimerRef.current);
            contextSvgMenuTimerRef.current = setTimeout(() => {
              setContextSvgMenuOpen(false);
            }, 120);
          }}
        >
          {contextMenu.mode === "element" && (selectedIds.length > 0 || selectedOverlayIds.length > 0) && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
              onClick={() => {
                copySelection();
                setContextMenu(null);
              }}
            >
              Copy
            </div>
          )}

          {contextMenu.mode === "element" &&
            (clipboardRef.current.shapes.length > 0 || clipboardRef.current.overlays.length > 0) && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
              onClick={() => {
                pasteClipboard();
                setContextMenu(null);
              }}
            >
              Paste
            </div>
          )}

          {contextMenu.mode === "element" && (selectedIds.length > 0 || selectedOverlayIds.length > 0) && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
              onClick={() => {
                handleDuplicate();
                setContextMenu(null);
              }}
            >
              Duplicate
            </div>
          )}

          {contextMenu.mode === "element" && selectedIds.length === 1 && (() => {
            const s = shapes.find((x) => x.id === selectedIds[0]);
            return s && (s.type === "polyline" || Array.isArray(s.points));
          })() && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
              onClick={() => {
                const id = selectedIds[0];
                setEditingId(id);
                setDrawing(null);
                setContextMenu(null);
              }}
            >
              Edit Polyline
            </div>
          )}

          {contextMenu.mode === "element" && (selectedIds.length > 0 || selectedOverlayIds.length > 0) && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#f04438" }}
              onClick={() => {
                deleteSelected();
                setContextMenu(null);
              }}
            >
              Delete
            </div>
          )}

          {contextMenu.mode === "empty" && (
            <>
              <div
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--text)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
                onMouseEnter={(e) => {
                  if (contextSvgMenuTimerRef.current) {
                    clearTimeout(contextSvgMenuTimerRef.current);
                    contextSvgMenuTimerRef.current = null;
                  }
                  const rect = e.currentTarget.getBoundingClientRect();
                  setContextSvgMenuPos({ x: rect.right + 6, y: rect.top });
                  setContextSvgMenuOpen(true);
                }}
                onMouseLeave={() => {
                  contextSvgMenuTimerRef.current = setTimeout(() => {
                    setContextSvgMenuOpen(false);
                  }, 120);
                }}
              >
                SVG's
                <span style={{ color: "var(--text-muted)" }}>▸</span>
              </div>
              {(clipboardRef.current.shapes.length > 0 || clipboardRef.current.overlays.length > 0) && (
                <div
                  style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                  onClick={() => {
                    pasteClipboard();
                    setContextMenu(null);
                  }}
                >
                  Paste
                </div>
              )}
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                onClick={() => {
                  undo();
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>↶</span>
                Undo
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                onClick={() => {
                  redo();
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>↷</span>
                Redo
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                onClick={() => {
                  setTool("polyline");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>／</span>
                Polyline
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                onClick={() => {
                  setTool("rect");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>▭</span>
                Rectangle
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                onClick={() => {
                  setTool("text");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>T</span>
                Text
              </div>
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                onClick={() => {
                  setTool("select");
                  setContextMenu(null);
                }}
              >
                <span style={{ display: "inline-flex", width: 16, justifyContent: "center", marginRight: 8 }}>↔</span>
                Move
              </div>
              
              <div
                style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
                onClick={() => {
                  setWidgetOpen(true);
                  setContextMenu(null);
                }}
              >
                Widgets...
              </div>
            </>
          )}

          {contextMenu.mode === "element" && selectedBBox && !showHUD && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
              onClick={() => {
                setPanelCursor({ x: contextMenu.x, y: contextMenu.y });
                setShowHUD(true);
                setContextMenu(null);
              }}
            >
              Show Properties
            </div>
          )}
          {contextMenu.mode === "element" && showHUD && (
            <div
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
              onClick={() => {
                setShowHUD(false);
                setContextMenu(null);
              }}
            >
              Hide Properties
            </div>
          )}
          {contextMenu.mode === "element" && contextSingleSvg && !contextSingleSvg.widget && (
            <div style={{ padding: "8px 12px", display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Tag</div>
              <input
                type="text"
                value={contextSvgTagQuery}
                placeholder="Search tags..."
                onChange={(e) => setContextSvgTagQuery(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
              style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  color: "var(--text)",
                  background: "var(--bg-elev)",
                }}
              />
              <select
                value={String(contextSingleSvg.tagPath || "")}
                onChange={(e) => {
                  const v = String(e.target.value || "").trim();
                  applySingleTagPath(v);
                  setContextMenu(null);
                }}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "6px 8px",
                  fontSize: 12,
                  color: "var(--text)",
                  background: "var(--bg-elev)",
                  cursor: "pointer",
                }}
              >
                {svgTagGroupMenuFilteredOptions.length === 0 ? (
                  <option value="" disabled>
                    No matches
                  </option>
                ) : (
                  svgTagGroupMenuFilteredOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.group} / {opt.label}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}
          {contextMenu.mode === "element" && !selectedBBox && (
            <div style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-muted)" }}>
              No selection
            </div>
          )}
        </div>
      )}

      {polyHandleMenu && (
        <div
          style={{
            position: "fixed",
            left: polyHandleMenu.x,
            top: polyHandleMenu.y,
            zIndex: 210,
            background: "var(--bg-elev)",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            padding: "6px 0",
            minWidth: 160,
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <div
            style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "#f04438" }}
            onClick={() => {
              removeVertex(polyHandleMenu.id, polyHandleMenu.index);
              setSelectedSegment(null);
              setPolyHandleMenu(null);
            }}
          >
            Delete Segment
          </div>
          <div
            style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, color: "var(--text)" }}
            onClick={() => setPolyHandleMenu(null)}
          >
            Cancel
          </div>
        </div>
      )}

      {contextMenu && isEmptyMenu && contextSvgMenuOpen && (
        <div
          style={{
            position: "fixed",
            left: subMenuLeft,
            top: subMenuTop,
            zIndex: 210,
            width: subMenuSize.w,
            maxHeight: subMenuSize.h,
            background: "var(--bg-elev)",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 10,
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            overflow: "hidden",
          }}
          onMouseEnter={() => {
            if (contextSvgMenuTimerRef.current) {
              clearTimeout(contextSvgMenuTimerRef.current);
              contextSvgMenuTimerRef.current = null;
            }
            setContextSvgMenuOpen(true);
          }}
          onMouseLeave={() => {
            contextSvgMenuTimerRef.current = setTimeout(() => {
              setContextSvgMenuOpen(false);
            }, 120);
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev)" }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: "var(--text)" }}>SVG Files</div>
                <div
                  style={{ marginTop: 6, position: "relative" }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
              <input
                ref={svgMenuInputRef}
                value={contextImportQuery}
                onChange={(e) => setContextImportQuery(e.target.value)}
                placeholder="Search..."
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: "100%",
                  border: "1px solid var(--border)",
                  background: "var(--bg-elev)",
                  borderRadius: 8,
                  padding: "7px 26px 7px 8px",
                  color: "var(--text)",
                  outline: "none",
                  fontSize: 12,
                  boxSizing: "border-box",
                }}
              />
                  {contextImportQuery && (
                    <button
                      type="button"
                      title="Clear"
                      onClick={() => setContextImportQuery("")}
                      onMouseDown={(e) => e.stopPropagation()}
                      style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    cursor: "pointer",
                    lineHeight: 1,
                    color: "var(--text)",
                    padding: 0,
                    fontSize: 11,
                  }}
                >
                      X
                    </button>
                  )}
                </div>
          </div>

          <div
            className="vizi-scroll"
            style={{
              maxHeight: subMenuSize.h - 86,
              overflow: "auto",
              padding: "8px 10px 10px",
            }}
          >
            {contextGrouped.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No matches.</div>
            ) : (
              contextGrouped.map((group) => (
                <div key={group.folder} style={{ display: "grid", gap: 6 }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 800, padding: "2px 2px" }}>
                    {group.folder}
                  </div>
                  {group.files.map((f) => (
                    <button
                      key={f.key}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPickSvg(f.key, lastContextPoint);
                        setContextMenu(null);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        cursor: "pointer",
                        color: "var(--text)",
                        fontSize: 12,
                      }}
                      title={f.key}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showMainDrawer && (
        <div
          style={{
            position: "fixed",
            top: TOP_BAR_H,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 220,
          }}
        >
          <div
            ref={mainDrawerRef}
            style={{
              position: "absolute",
              right: 0,
              left: mainDrawerFullscreen ? 0 : undefined,
              top: 0,
              height: "100%",
              width: mainDrawerFullscreen ? "100%" : `${Math.round(drawerSizes.main.w)}px`,
              background: "var(--bg-soft)",
              boxShadow: "-24px 0 48px rgba(0,0,0,0.34), -8px 0 20px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              borderLeft: mainDrawerFullscreen ? "none" : "1px solid var(--border)",
              color: "var(--text)",
              transform: "translate(0px, 0px)",
              animation: "drawer-slide-in-right 220ms ease-out",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elev)",
                gap: 12,
                flexWrap: "wrap",
                cursor: "default",
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.02em" }}>
                  {drawerView === "ai"
                    ? "AI"
                    : drawerView === "reports"
                    ? "Report Designer"
                    : drawerView === "plc"
                    ? "PLC"
                    : drawerView === "server"
                    ? "Server Diagnostics"
                    : drawerView === "database"
                    ? "Database"
                    : drawerView === "tags"
                    ? "Tags"
                  : drawerView === "logs"
                  ? "Logs"
                  : drawerView === "diagnostics"
                  ? "Diagnostics"
                  : drawerView === "opc"
                  ? "OPC Configuration"
                  : "Help"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setMainDrawerFullscreen((v) => !v)}
                  style={drawerHeaderButtonStyle}
                  title={mainDrawerFullscreen ? "Windowed" : "Fullscreen"}
                  aria-label={mainDrawerFullscreen ? "Windowed" : "Fullscreen"}
                >
                  {mainDrawerFullscreen ? "❐" : "⛶"}
                </button>
                <button
                  onClick={() => setShowMainDrawer(false)}
                  style={drawerHeaderButtonStyle}
                  title="Close"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div style={{ flex: "1 1 auto", overflow: "hidden" }}>
              {drawerView === "tags" ? (
                <div style={{ height: "100%", overflow: "auto" }}>
                  <OpcConfig embedded mode="tags" />
                </div>
              ) : drawerView === "logs" ? (
                <div style={{ height: "100%", overflow: "auto" }}>
                  <OpcConfig embedded mode="logs" onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "diagnostics" ? (
                <div style={{ height: "100%", overflow: "auto" }}>
                  <OpcConfig embedded mode="diagnostics" onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "opc" ? (
                <div style={{ height: "100%", overflow: "auto", padding: 16, boxSizing: "border-box" }}>
                  <OpcConfig embedded onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "help" ? (
                <div style={{ height: "100%", overflow: "hidden", padding: 16, boxSizing: "border-box" }}>
                  <HelpPanel inline onClose={() => setShowMainDrawer(false)} />
                </div>
              ) : drawerView === "plc" ? (
                <div style={{ height: "100%", overflow: "auto", padding: 16, boxSizing: "border-box" }}>
                  <PlcAnalyzer plcItems={projectPlcs} onChange={setProjectPlcs} />
                </div>
              ) : drawerView === "server" ? (
                <ServerDiagnosticsPanel />
              ) : drawerView === "database" ? (
                <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev)" }}>
                    <button
                      data-preserve-style="true"
                      onClick={() => setDatabaseTab("data")}
                      style={drawerTabButtonStyle(databaseTab === "data")}
                    >
                      Data
                    </button>
                    <button
                      data-preserve-style="true"
                      onClick={() => setDatabaseTab("dataset")}
                      style={drawerTabButtonStyle(databaseTab === "dataset")}
                    >
                      Dataset
                    </button>
                    <button
                      data-preserve-style="true"
                      onClick={() => setDatabaseTab("config")}
                      style={drawerTabButtonStyle(databaseTab === "config")}
                    >
                      Config
                    </button>
                    <button
                      data-preserve-style="true"
                      onClick={() => setDatabaseTab("designer")}
                      style={drawerTabButtonStyle(databaseTab === "designer")}
                    >
                      Designer
                    </button>
                  </div>
                  <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
                    {databaseTab === "dataset" ? (
                      <DatasetBuilder embedded />
                    ) : databaseTab === "designer" ? (
                      <SqlDesigner embedded />
                    ) : databaseTab === "config" ? (
                      <DatabaseConfigPanel embedded />
                    ) : (
                      <DataBrowser embedded />
                    )}
                  </div>
                </div>
              ) : drawerView === "reports" ? (
                <iframe
                  key={`drawer-reports-${theme}`}
                  title="Report Designer"
                  src={`/report-designer?theme=${theme}`}
                  style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                />
              ) : (
                <iframe
                  key={`drawer-ai-${theme}`}
                  title="AI"
                  src={`/ai?theme=${theme}`}
                  style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                />
              )}
            </div>
            {!mainDrawerFullscreen ? (
              <div
                onMouseDown={(e) => beginDrawerResize("main", e, mainDrawerFullscreen)}
                title="Resize"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 10,
                  cursor: "ew-resize",
                  borderRight: "1px solid var(--border)",
                  background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
                  zIndex: 2,
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      {showUserDrawer && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 230,
          }}
        >
          <div
            ref={userDrawerRef}
            style={{
              position: "absolute",
              right: 0,
              left: userDrawerFullscreen ? 0 : undefined,
              top: 0,
              height: "100%",
              width: userDrawerFullscreen ? "100%" : `${Math.round(drawerSizes.user.w)}px`,
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--bg-soft) 96%, white 4%) 0%, color-mix(in srgb, var(--bg-soft) 90%, black 10%) 100%)",
              boxShadow: "-24px 0 52px rgba(0,0,0,0.36), -8px 0 22px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              borderLeft: userDrawerFullscreen ? "none" : "1px solid var(--border)",
              color: "var(--text)",
              transform: "translate(0px, 0px)",
              animation: "drawer-slide-in-right 220ms ease-out",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 14px",
                borderBottom: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--bg-elev) 94%, transparent)",
                gap: 10,
                cursor: "default",
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "0.02em" }}>
                  User Settings
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Profile, security and session preferences
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setUserDrawerFullscreen((v) => !v)}
                  style={drawerHeaderButtonStyle}
                  title={userDrawerFullscreen ? "Windowed" : "Fullscreen"}
                  aria-label={userDrawerFullscreen ? "Windowed" : "Fullscreen"}
                >
                  {userDrawerFullscreen ? "❐" : "⛶"}
                </button>
                <button
                  onClick={() => setShowUserDrawer(false)}
                  style={drawerHeaderButtonStyle}
                  title="Close"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div style={{ flex: "1 1 auto", overflow: "auto", padding: 14, display: "grid", gap: 12 }}>
              <div
                style={{
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, white 6%) 0%, color-mix(in srgb, var(--bg-elev) 90%, black 10%) 100%)",
                  border: "1px solid color-mix(in srgb, var(--border) 82%, white 18%)",
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 10,
                  boxShadow: "0 8px 16px rgba(0,0,0,0.16)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>Profile</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "2px 7px",
                      background: "color-mix(in srgb, var(--bg-elev) 94%, transparent)",
                    }}
                  >
                    Public info
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                    Display Name
                    <input
                      value={profileDraft.display_name}
                      onChange={(e) =>
                        setProfileDraft((p) => ({ ...p, display_name: e.target.value }))
                      }
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 10,
                        padding: "9px 10px",
                        minHeight: 38,
                        fontSize: 13,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                    Username
                    <input
                      value={profileDraft.username}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, username: e.target.value }))}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 10,
                        padding: "9px 10px",
                        minHeight: 38,
                        fontSize: 13,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    />
                  </label>
                </div>
                <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                  Avatar URL
                  <input
                    value={profileDraft.avatar_url}
                    onChange={(e) =>
                      setProfileDraft((p) => ({ ...p, avatar_url: e.target.value }))
                    }
                    placeholder="https://..."
                    style={{
                      border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                      borderRadius: 10,
                      padding: "9px 10px",
                      minHeight: 38,
                      fontSize: 13,
                      background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                      color: "var(--text)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                    }}
                  />
                </label>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onClick={async () => {
                      setProfileError("");
                      setProfileStatus("");
                      try {
                        await updateProfile({
                          username: profileDraft.username,
                          display_name: profileDraft.display_name,
                          avatar_url: profileDraft.avatar_url,
                        });
                        setProfileStatus("Profile updated.");
                      } catch (err) {
                        setProfileError(err?.message || "Update failed.");
                      }
                    }}
                    style={{
                      border: "1px solid #2f6dff",
                      background: "linear-gradient(180deg, #3a7bff 0%, #2b6cff 100%)",
                      color: "white",
                      borderRadius: 10,
                      padding: "8px 14px",
                      minHeight: 38,
                      minWidth: 132,
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 700,
                      boxShadow: "0 8px 18px rgba(43,108,255,0.35)",
                    }}
                  >
                    Save Changes
                  </button>
                </div>
              </div>

              <div
                style={{
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, white 6%) 0%, color-mix(in srgb, var(--bg-elev) 90%, black 10%) 100%)",
                  border: "1px solid color-mix(in srgb, var(--border) 82%, white 18%)",
                  borderRadius: 12,
                  padding: 14,
                  display: "grid",
                  gap: 10,
                  boxShadow: "0 8px 16px rgba(0,0,0,0.16)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>Security</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      border: "1px solid var(--border)",
                      borderRadius: 999,
                      padding: "2px 7px",
                      background: "color-mix(in srgb, var(--bg-elev) 94%, transparent)",
                    }}
                  >
                    Update password
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                    Current Password
                    <input
                      type="password"
                      value={passwordDraft.current}
                      onChange={(e) => setPasswordDraft((p) => ({ ...p, current: e.target.value }))}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 10,
                        padding: "9px 10px",
                        minHeight: 38,
                        fontSize: 13,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                    New Password
                    <input
                      type="password"
                      value={passwordDraft.next}
                      onChange={(e) => setPasswordDraft((p) => ({ ...p, next: e.target.value }))}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 10,
                        padding: "9px 10px",
                        minHeight: 38,
                        fontSize: 13,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onClick={async () => {
                      setProfileError("");
                      setProfileStatus("");
                      try {
                        await changePassword(passwordDraft.current, passwordDraft.next);
                        setPasswordDraft({ current: "", next: "" });
                        setProfileStatus("Password updated.");
                      } catch (err) {
                        setProfileError(err?.message || "Password update failed.");
                      }
                    }}
                    style={{
                      border: "1px solid color-mix(in srgb, var(--border) 70%, #9ca3af 30%)",
                      background: "linear-gradient(180deg, #273445 0%, #1b2533 100%)",
                      color: "white",
                      borderRadius: 10,
                      padding: "8px 14px",
                      minHeight: 38,
                      minWidth: 132,
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 700,
                      boxShadow: "0 8px 16px rgba(0,0,0,0.28)",
                    }}
                  >
                    Update Password
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background:
                    "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, #3b0b0b 6%) 0%, color-mix(in srgb, var(--bg-elev) 90%, black 10%) 100%)",
                  border: "1px solid color-mix(in srgb, #f2c6c2 75%, #f04438 25%)",
                  borderRadius: 12,
                  padding: "11px 14px",
                  boxShadow: "0 8px 16px rgba(0,0,0,0.16)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#b42318" }}>Sign out</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>End your current session.</div>
                </div>
                <button
                  onClick={async () => {
                    await logout();
                  }}
                  style={{
                    border: "1px solid #f04438",
                    background: "linear-gradient(180deg, #f75b51 0%, #f04438 100%)",
                    color: "white",
                    borderRadius: 10,
                    padding: "8px 14px",
                    minHeight: 38,
                    minWidth: 100,
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 700,
                    boxShadow: "0 8px 16px rgba(240,68,56,0.35)",
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
            {!userDrawerFullscreen ? (
              <div
                onMouseDown={(e) => beginDrawerResize("user", e, userDrawerFullscreen)}
                title="Resize"
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 10,
                  cursor: "ew-resize",
                  borderRight: "1px solid var(--border)",
                  background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
                  zIndex: 2,
                }}
              />
            ) : null}
          </div>
        </div>
      )}

      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          zIndex: 95,
          background: "var(--topbar-grad)",
          borderBottom: "1px solid var(--topbar-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          backdropFilter: "blur(8px)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img
            src="/mesora-wordmark.svg"
            alt="Mesora"
            style={{ height: 34, width: "auto", display: "block" }}
          />
          <div style={{ width: 1, height: 18, background: "var(--border)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="top-menu-btn"
              onClick={() => setShowProjectDrawer((v) => !v)}
              title={showProjectDrawer ? "Hide Project Drawer" : "Show Project Drawer"}
              style={topMenuModeButtonStyle(!!showProjectDrawer)}
            >
              <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <div
              title={activeProject?.name || projectName || "No project selected"}
              style={{
                maxWidth: 220,
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Project: {activeProject?.name || projectName || "None"}
            </div>
            <div
              title={activeScreen?.name || screenName || "No screen selected"}
              style={{
                maxWidth: 180,
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Screen: {activeScreen?.name || screenName || "None"}
            </div>
            <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                maxWidth: "44vw",
                overflowX: "auto",
              }}
            >
              <button title="Export SVG" style={topMenuIconButtonStyle} onClick={exportSVG}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3v10m0 0l-4-4m4 4l4-4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button title="Export Ignition" style={topMenuIconButtonStyle} onClick={exportIgnitionJson}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M9 4c-2 0-3 1-3 3v1c0 1-.5 2-2 2 1.5 0 2 1 2 2v1c0 2 1 3 3 3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path
                    d="M15 4c2 0 3 1 3 3v1c0 1 .5 2 2 2-1.5 0-2 1-2 2v1c0 2-1 3-3 3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button title="Add SVG" style={topMenuIconButtonStyle} onClick={() => setImportOpen(true)}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 21V11m0 0l4 4m-4-4l-4 4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path d="M5 7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button title="Add Widget" style={topMenuIconButtonStyle} onClick={() => setWidgetOpen(true)}>
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="12" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="10" y="8" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
                  <rect x="17" y="5" width="4" height="15" rx="1" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Move"
                style={topMenuModeButtonStyle(tool === "select")}
                onClick={() => {
                  setTool("select");
                  setDrawing(null);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path d="M4 3l7 18 2-7 7-2L4 3z" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Polyline"
                style={topMenuModeButtonStyle(tool === "polyline")}
                onClick={() => {
                  setTool("polyline");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 6h5l4 6h5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="5" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="10" cy="6" r="1.5" fill="currentColor" />
                  <circle cx="14" cy="12" r="1.5" fill="currentColor" />
                  <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Rectangle"
                style={topMenuModeButtonStyle(tool === "rect")}
                onClick={() => {
                  setTool("rect");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="6" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Text"
                style={topMenuModeButtonStyle(tool === "text")}
                onClick={() => {
                  setTool("text");
                  setDrawing(null);
                  exitEditMode();
                  setSelectedOverlayIds([]);
                }}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 6V4h16v2M9 20h6M12 4v16"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Toggle Tag Paths"
                style={topMenuModeButtonStyle(!!showTagPaths)}
                onClick={() => setShowTagPaths((v) => !v)}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 12l8-8h6l2 2v6l-8 8-8-8z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <circle cx="16" cy="8" r="1.5" fill="currentColor" />
                </svg>
              </button>
              <button
                className="top-menu-btn"
                title="Toggle Grid"
                style={topMenuModeButtonStyle(!!showGrid)}
                onClick={() => setShowGrid((v) => !v)}
              >
                <svg width={topMenuIconSize} height={topMenuIconSize} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { key: "theme", label: "Theme" },
              { key: "plc", label: "PLC" },
              { key: "opc", label: "OPC" },
              { key: "server", label: "Server" },
              { key: "tags", label: "Tag" },
              { key: "database", label: "Database" },
              { key: "reports", label: "Reports" },
              { key: "ai", label: "AI" },
              { key: "help", label: "Help" },
            ].map((item) => (
              (() => {
                const isActiveView =
                  drawerView === item.key ||
                  (item.key === "opc" && (drawerView === "logs" || drawerView === "diagnostics"));
                const isActive = item.key === "theme" ? false : (showMainDrawer && isActiveView);
                return (
                  <button
                    key={`top-nav-${item.key}`}
                    data-preserve-style="true"
                    title={
                      item.key === "theme"
                        ? theme === "dark"
                          ? "Switch to light mode"
                          : "Switch to dark mode"
                        : item.label
                    }
                    onClick={() => {
                      if (item.key === "theme") {
                        setTheme((t) => (t === "dark" ? "light" : "dark"));
                        return;
                      }
                      openDrawer(item.key);
                    }}
                    style={{
                      border: `1px solid ${isActive ? "#2b6cff" : "var(--border)"}`,
                      background: isActive ? "#2b6cff" : "var(--bg-elev)",
                      color: isActive ? "#ffffff" : "var(--text)",
                      borderRadius: 999,
                      padding: item.key === "theme" ? "4px 8px" : "4px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      minWidth: item.key === "theme" ? 34 : undefined,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: isActive ? "0 0 0 1px rgba(43,108,255,0.35)" : "0 6px 16px rgba(15, 23, 42, 0.08)",
                    }}
                  >
                    {item.key === "theme" ? (
                      theme === "dark" ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2" />
                          <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )
                    ) : (
                      item.label
                    )}
                  </button>
                );
              })()
            ))}
          </div>
          <button
            onClick={() => setShowUserDrawer(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: "1px solid var(--border)",
              background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
              borderRadius: 999,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt="avatar"
                style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
              />
            ) : (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: theme === "dark" ? "#ffffff" : "#111827",
                  color: theme === "dark" ? "#111827" : "white",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {avatarLabel}
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
              {user?.display_name || user?.username || "User"}
            </div>
          </button>
        </div>
      </div>

      {showProjectDrawer && (
        <div
          ref={projectDrawerRef}
          style={{
            position: "fixed",
            top: TOP_BAR_H,
            left: 0,
            right: projectDrawerFullscreen ? 0 : undefined,
            bottom: 0,
            width: projectDrawerFullscreen ? "auto" : `${Math.round(drawerSizes.project.w)}px`,
            zIndex: 220,
            borderRight: projectDrawerFullscreen ? "none" : "1px solid var(--border)",
            background: "var(--bg-soft)",
            boxShadow: "24px 0 48px rgba(0,0,0,0.34), 8px 0 20px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transform: "translate(0px, 0px)",
            animation: "drawer-slide-in-left 220ms ease-out",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-elev)",
              cursor: "default",
            }}
          >
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.02em", color: "var(--text)" }}>
                Project
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                One app project
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setProjectDrawerFullscreen((v) => !v)}
                style={drawerHeaderButtonStyle}
                title="Toggle Project Drawer Fullscreen"
                aria-label={projectDrawerFullscreen ? "Windowed" : "Fullscreen"}
              >
                {projectDrawerFullscreen ? "❐" : "⛶"}
              </button>
              <button
                onClick={() => setShowProjectDrawer(false)}
                style={drawerHeaderButtonStyle}
                title="Close Project Drawer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>
          {!projectDrawerFullscreen ? (
            <div
              onMouseDown={(e) => beginDrawerResize("project", e, projectDrawerFullscreen)}
              title="Resize"
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 10,
                cursor: "ew-resize",
                borderLeft: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--bg-elev) 90%, transparent)",
                zIndex: 2,
              }}
            />
          ) : null}

          <div
            style={{
              margin: 12,
              marginBottom: 8,
              padding: 12,
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg-elev)",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Current Project</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
              {activeProject?.name || projectName || "Untitled"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Active Screen: {activeScreen?.name || screenName || "Screen 1"}
            </div>
            {activeProjectUpdatedBy ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Updated by {activeProjectUpdatedBy}
              </div>
            ) : null}
            {activeProjectUpdatedAt ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {formatProjectTime(activeProjectUpdatedAt)}
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6, padding: "0 12px 12px" }}>
            <button
              onClick={saveProjectToDb}
              style={{
                ...topMenuTextButtonStyle,
                fontSize: 11,
                padding: "7px 10px",
                border: "1px solid #2b6cff",
                background: "#2b6cff",
                color: "#ffffff",
              }}
              title="Save Project"
            >
              Save Project
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              padding: 12,
              margin: "0 12px 12px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg-elev)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
              SVG Background Colors
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "var(--text)" }}>Light</div>
              <input
                type="color"
                value={projectCanvasBackground.light || DEFAULT_CANVAS_BG_LIGHT}
                onChange={(e) => {
                  const next = normalizeProjectCanvasBackground({
                    ...projectCanvasBackground,
                    light: e.target.value,
                  });
                  setProjectCanvasBackground(next);
                  scheduleProjectAutoSave();
                }}
                style={{ width: "100%", height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}
                title="Canvas background color in light mode"
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{projectCanvasBackground.light}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "center" }}>
              <div style={{ fontSize: 12, color: "var(--text)" }}>Dark</div>
              <input
                type="color"
                value={projectCanvasBackground.dark || DEFAULT_CANVAS_BG_DARK}
                onChange={(e) => {
                  const next = normalizeProjectCanvasBackground({
                    ...projectCanvasBackground,
                    dark: e.target.value,
                  });
                  setProjectCanvasBackground(next);
                  scheduleProjectAutoSave();
                }}
                style={{ width: "100%", height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}
                title="Canvas background color in dark mode"
              />
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{projectCanvasBackground.dark}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  const next = normalizeProjectCanvasBackground(null);
                  setProjectCanvasBackground(next);
                  scheduleProjectAutoSave();
                }}
                style={{ ...topMenuTextButtonStyle, fontSize: 11, padding: "6px 10px" }}
                title="Reset canvas background colors to defaults"
              >
                Reset Defaults
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 10,
              padding: 12,
              margin: "0 12px 12px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg-elev)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Project Name</div>
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                saveProjectToDb();
              }}
              placeholder="Project name"
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 12,
                fontWeight: 600,
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                onClick={saveProjectToDb}
                style={{
                  ...topMenuTextButtonStyle,
                  fontSize: 11,
                  padding: "6px 10px",
                  border: "1px solid #2b6cff",
                  background: "#2b6cff",
                  color: "#ffffff",
                }}
                title="Save Project Name"
              >
                Save Name
              </button>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 8,
              padding: 12,
              margin: "0 12px 12px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg-elev)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Screens</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{screens.length} total</div>
            </div>
            <input
              value={screenName}
              onChange={(e) => renameActiveScreen(e.target.value)}
              placeholder="Screen name"
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "9px 10px",
                fontSize: 12,
                fontWeight: 600,
              }}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button
                onClick={addScreen}
                style={{
                  ...topMenuTextButtonStyle,
                  fontSize: 11,
                  padding: "8px 10px",
                  border: "1px solid #2b6cff",
                  background: "#2b6cff",
                  color: "#ffffff",
                  fontWeight: 800,
                }}
                title="Add Screen"
              >
                + New Screen
              </button>
              <button
                onClick={deleteActiveScreen}
                disabled={screens.length <= 1}
                style={{
                  ...topMenuTextButtonStyle,
                  fontSize: 11,
                  padding: "8px 10px",
                  border: "1px solid #f04438",
                  background: screens.length > 1 ? "#f04438" : "rgba(244,68,56,0.55)",
                  color: "#fff",
                  cursor: screens.length > 1 ? "pointer" : "not-allowed",
                  opacity: screens.length > 1 ? 1 : 0.6,
                  fontWeight: 800,
                }}
                title="Delete Active Screen"
              >
                Delete
              </button>
            </div>
            <div style={{ maxHeight: 220, overflow: "auto", paddingRight: 2 }} className="vizi-scroll">
              {(screens || []).map((s) => {
                const active = s.id === activeScreenId;
                return (
                  <button
                    key={`screen-item-${s.id}`}
                    data-preserve-style="true"
                    onClick={() => switchToScreen(s.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      marginBottom: 6,
                      border: active ? "1px solid #2b6cff" : "1px solid var(--border)",
                      background: active ? "#2b6cff" : "var(--bg)",
                      color: active ? "#ffffff" : "var(--text)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: active ? 800 : 600,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                    title={s.name}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingRight: 8 }}>
                      {s.name || "Screen"}
                    </span>
                    {active ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          border: "1px solid rgba(255,255,255,0.7)",
                          color: "#ffffff",
                          borderRadius: 999,
                          padding: "2px 6px",
                          background: "rgba(255,255,255,0.14)",
                          flex: "0 0 auto",
                        }}
                      >
                        Active
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ flex: 1 }} />
          {!!projectStatus && (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "10px 12px",
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              {projectStatus}
            </div>
          )}
        </div>
      )}

      {!showZoom && (
        <button
          title="Show Zoom"
          onClick={() => setShowZoom(true)}
          style={{
            position: "fixed",
            left: Math.max(zoomPos.x, 8),
            bottom: 16,
            zIndex: 92,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            cursor: "pointer",
            boxShadow: "0 6px 14px rgba(0,0,0,0.10)",
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.02em",
          }}
        >
          Zoom
        </button>
      )}
    </div>
  );
}






