// src/App.jsx
import { Fragment, Suspense, lazy, useMemo, useRef, useState, useEffect } from "react";
import PropertiesPanel from "./components/PropertiesPanel";
import ImportModal from "./components/ImportModal";
import WidgetSelectorModal from "./components/WidgetSelectorModal";
import CanvasSvg from "./components/CanvasSvg";
import ViewBoxModal from "./components/ViewBoxModal";
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
import appLogo from "./assets/Images/logo.png";

const HelpPanel = lazy(() => import("./components/HelpPanel"));
const OpcConfig = lazy(() => import("./components/OpcConfig"));
const DataBrowser = lazy(() => import("./components/DataBrowser"));
const DatasetBuilder = lazy(() => import("./components/DatasetBuilder"));
const DatabaseConfigPanel = lazy(() => import("./components/DatabaseConfigPanel"));
const SqlDesigner = lazy(() => import("./components/SqlDesigner"));
const PlcAnalyzer = lazy(() => import("./components/PlcAnalyzer"));
const ServerDiagnosticsPanel = lazy(() => import("./components/ServerDiagnosticsPanel"));
const SecurityManager = lazy(() => import("./components/SecurityManager"));
const THEME_KEY = "vizi_theme";
const SHOW_GRID_KEY = "vizi_show_grid";
const SHOW_TAG_PATHS_KEY = "vizi_show_tag_paths";
const DRAWER_SIZES_KEY = "vizi_drawer_sizes";
const DRAWER_FULLSCREEN_KEY = "vizi_drawer_fullscreen";
const PROJECT_DRAFT_KEY_PREFIX = "vizi_project_draft:";
const PROJECT_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// (no eager:true)

const SVG_RAW_CACHE_MAX = 96;
const DEFAULT_CANVAS_BG_LIGHT = "#ffffff";
const DEFAULT_CANVAS_BG_DARK = "#0f141c";
const LIVE_ALARM_BAR_H = 44;
const LIVE_ALARM_MARQUEE_DURATION_SEC = 30;
function normalizeProjectMode(value) {
  return String(value || "").trim().toLowerCase() === "live" ? "live" : "design";
}

function readStoredProjectMode(projectId = "") {
  if (typeof window === "undefined") return "design";
  const key = `vizi_project_mode:${String(projectId || "default")}`;
  try {
    const byProject = localStorage.getItem(key);
    if (byProject != null) return normalizeProjectMode(byProject);
    const last = localStorage.getItem("vizi_project_mode:last");
    if (last != null) return normalizeProjectMode(last);
  } catch {
    // ignore storage read errors
  }
  return "design";
}

function readStoredActiveProjectId() {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem("vizi_active_project_id") || "").trim();
  } catch {
    return "";
  }
}

function readProjectDraft(projectId) {
  if (typeof window === "undefined") return null;
  const id = String(projectId || "").trim();
  if (!id) return null;
  try {
    const raw = localStorage.getItem(`${PROJECT_DRAFT_KEY_PREFIX}${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const savedAt = Number(parsed.savedAt || 0);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > PROJECT_DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(`${PROJECT_DRAFT_KEY_PREFIX}${id}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearProjectDraft(projectId) {
  if (typeof window === "undefined") return;
  const id = String(projectId || "").trim();
  if (!id) return;
  try {
    localStorage.removeItem(`${PROJECT_DRAFT_KEY_PREFIX}${id}`);
  } catch {
    // ignore
  }
}

function readStoredDrawerFullscreen(name) {
  if (typeof window === "undefined") return false;
  const key = String(name || "").trim().toLowerCase();
  if (!key) return false;
  try {
    const raw = localStorage.getItem(DRAWER_FULLSCREEN_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed[key] === true : false;
  } catch {
    return false;
  }
}

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

function normalizeProjectUiPreferences(raw, fallback = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const pickBool = (key, defaultValue) => {
    if (typeof src[key] === "boolean") return src[key];
    if (typeof fb[key] === "boolean") return fb[key];
    return defaultValue;
  };
  return {
    showGrid: pickBool("showGrid", true),
    showTagPaths: pickBool("showTagPaths", false),
    liveMenuCollapsed: pickBool("liveMenuCollapsed", false),
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

function tokenizeSvgCatalogText(value) {
  return Array.from(
    new Set(
      String(value || "")
        .replace(/[_/.-]+/g, " ")
        .replace(/\.svg$/i, "")
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean)
    )
  );
}

function normalizeTagValue(value) {
  return String(value || "")
    .replace(/\r?\n/g, "")
    .trim();
}

function normalizeTableDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeAlarmOperatorValue(value) {
  const op = String(value || "").trim();
  return ["==", "!=", ">", ">=", "<", "<="].includes(op) ? op : "==";
}

function isTruthyFlag(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const raw = String(value).trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function coerceAlarmComparable(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { raw, lower: "", num: null, bool: null };
  const lower = raw.toLowerCase();
  const num = Number(raw);
  const bool =
    lower === "true" || lower === "1"
      ? true
      : lower === "false" || lower === "0"
      ? false
      : null;
  return { raw, lower, num: Number.isFinite(num) ? num : null, bool };
}

function evaluateAlarmCondition(liveValue, operator, threshold) {
  const left = coerceAlarmComparable(liveValue);
  const right = coerceAlarmComparable(threshold);
  const op = normalizeAlarmOperatorValue(operator);
  if (left.raw === "" || right.raw === "") return false;
  if (op === ">" || op === ">=" || op === "<" || op === "<=") {
    if (left.num == null || right.num == null) return false;
    if (op === ">") return left.num > right.num;
    if (op === ">=") return left.num >= right.num;
    if (op === "<") return left.num < right.num;
    return left.num <= right.num;
  }
  if (left.num != null && right.num != null) {
    return op === "==" ? left.num === right.num : left.num !== right.num;
  }
  if (left.bool != null && right.bool != null) {
    return op === "==" ? left.bool === right.bool : left.bool !== right.bool;
  }
  return op === "==" ? left.lower === right.lower : left.lower !== right.lower;
}

function defaultLiveMenuGroupsFromScreens(sourceScreens) {
  const screens = Array.isArray(sourceScreens) ? sourceScreens : [];
  const items = screens
    .filter((screen) => screen?.showInLiveMenu !== false)
    .map((screen) => ({
      id: `live-item-${uid()}`,
      type: "screen",
      screenId: String(screen?.id || ""),
      label: "",
      restricted: false,
      allowedRoleIds: [],
    }))
    .filter((item) => item.screenId);
  return [
    {
      id: `live-group-${uid()}`,
      name: "Main",
      items,
    },
  ];
}

function normalizeRoleIdList(value) {
  const list = Array.isArray(value) ? value : [];
  const ids = list
    .map((x) => Number.parseInt(String(x), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(ids));
}

function normalizeLiveMenuGroups(rawGroups, sourceScreens) {
  const screens = Array.isArray(sourceScreens) ? sourceScreens : [];
  const screenIds = new Set(screens.map((s) => String(s?.id || "")).filter(Boolean));
  const groups = Array.isArray(rawGroups) ? rawGroups : [];
  const normalized = groups
    .map((group) => {
      const name = String(group?.name ?? "");
      const items = (Array.isArray(group?.items) ? group.items : [])
        .map((item) => {
          const type = String(item?.type || "").toLowerCase() === "data" ? "data" : "screen";
          if (type === "screen") {
            const screenId = String(item?.screenId || "").trim();
            if (!screenId || !screenIds.has(screenId)) return null;
            return {
              id: String(item?.id || `live-item-${uid()}`),
              type,
              screenId,
              label: String(item?.label || "").trim(),
              restricted: Boolean(item?.restricted),
              allowedRoleIds: normalizeRoleIdList(item?.allowedRoleIds),
            };
          }
          return {
            id: String(item?.id || `live-item-${uid()}`),
            type: "data",
            dataTable: String(item?.dataTable || "").trim(),
            label: String(item?.label || "").trim(),
            restricted: Boolean(item?.restricted),
            allowedRoleIds: normalizeRoleIdList(item?.allowedRoleIds),
          };
        })
        .filter(Boolean);
      return {
        id: String(group?.id || `live-group-${uid()}`),
        name,
        items,
      };
    })
    .filter((group) => group.items.length > 0 || String(group.name || "").trim());

  if (!normalized.length) return defaultLiveMenuGroupsFromScreens(screens);
  return normalized;
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

function readFirstInnerSvgText(inner) {
  const source = String(inner || "");
  if (!source.trim()) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`,
      "image/svg+xml"
    );
    if (doc.querySelector("parsererror")) return null;
    const firstText = doc.querySelector("text");
    if (!firstText) return null;
    return String(firstText.textContent ?? "");
  } catch {
    return null;
  }
}

function writeFirstInnerSvgText(inner, nextText) {
  const source = String(inner || "");
  if (!source.trim()) return source;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`,
      "image/svg+xml"
    );
    if (doc.querySelector("parsererror")) return source;
    const firstText = doc.querySelector("text");
    if (!firstText) return source;
    firstText.textContent = String(nextText ?? "");
    const serializer = new XMLSerializer();
    const root = doc.documentElement;
    return Array.from(root.childNodes)
      .map((node) => serializer.serializeToString(node))
      .join("");
  } catch {
    return source;
  }
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
    countdownBar: {
      name: "Widget-CountdownBar.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 72"><rect x="12" y="8" width="296" height="14" rx="7" fill="#111827" stroke="#334155"/><rect x="12" y="8" width="168" height="14" rx="7" fill="#2b6cff"/><text x="12" y="40" fill="#94a3b8" font-size="12" font-family="system-ui" font-weight="700">Countdown</text><text x="160" y="20" text-anchor="middle" fill="#ffffff" font-size="10" font-family="system-ui" font-weight="800">4.0s</text></svg>`,
    },
    pushButton: {
      name: "Widget-PushButton.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 150"><rect x="1" y="1" width="258" height="148" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">Push Button</text><rect x="34" y="52" width="192" height="70" rx="12" fill="#1e293b" stroke="#334155"/><rect x="40" y="58" width="180" height="58" rx="10" fill="#2563eb"/><text x="130" y="94" text-anchor="middle" fill="#ffffff" font-size="16" font-family="system-ui" font-weight="800">PRESS</text></svg>`,
    },
    onOffButton: {
      name: "Widget-OnOffButton.svg",
      raw: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 160"><rect x="1" y="1" width="278" height="158" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/><text x="16" y="26" fill="#e2e8f0" font-size="14" font-family="system-ui" font-weight="700">On/Off Button</text><rect x="34" y="52" width="212" height="74" rx="14" fill="#111827" stroke="#334155"/><rect x="40" y="58" width="98" height="62" rx="10" fill="#16a34a"/><rect x="142" y="58" width="98" height="62" rx="10" fill="#334155"/><text x="89" y="96" text-anchor="middle" fill="#ffffff" font-size="16" font-family="system-ui" font-weight="800">ON</text><text x="191" y="96" text-anchor="middle" fill="#cbd5e1" font-size="16" font-family="system-ui" font-weight="800">OFF</text></svg>`,
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
  if (kind === "countdownBar") return { ...base, historyPoints: 10, decimals: 1 };
  if (kind === "pushButton") return { ...base, historyPoints: 10, decimals: 0 };
  if (kind === "onOffButton") return { ...base, historyPoints: 10, decimals: 0 };
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
  const { user, logout, updateProfile, changePassword, refresh } = useAuth();
  const [tool, setTool] = useState("select"); // "select" | "polyline" | "rect"
  const DEFAULT_STROKE = "#808080";
  const DEFAULT_FILL = "#cccccc";
  const [shapes, setShapes] = useState([]); // polyline | rect | text

  // Multi-selection
  const [selectedIds, setSelectedIds] = useState([]); // polyline ids
  const [selectedOverlayIds, setSelectedOverlayIds] = useState([]); // overlay ids

  // drawing = { mode:"draw-poly"|"draw-rect", id, start?:{x,y} }
  const [drawing, setDrawing] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null); // { id, value, kind: "shape" | "overlay" }

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
  const [overlayResize, setOverlayResize] = useState(null); // single: { id, anchorLocal, anchorWorld, startDist, origScaleX, origScaleY } | group: { kind:"group", anchorWorld, startDist, overlays:[{id, tx, ty, sx, sy}] }

  // ✅ Export settings (dynamic)
  const [exportVB, setExportVB] = useState({ x: 0, y: 0, w: 1600, h: 900 });
  const [exportBasis, setExportBasis] = useState({ w: 1600, h: 900 }); // affects Perspective "basis"
  const [showZoom, setShowZoom] = useState(true);
  const [showGrid, setShowGrid] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(SHOW_GRID_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [showTagPaths, setShowTagPaths] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(SHOW_TAG_PATHS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [hiddenTagBubbleIds, setHiddenTagBubbleIds] = useState([]);
  const [liveEquipmentOverlayIds, setLiveEquipmentOverlayIds] = useState([]);
  const liveEquipmentCardRefs = useRef(new Map());
  const [liveEquipmentDockTick, setLiveEquipmentDockTick] = useState(0);
  const [liveEquipmentDrawerOverlayId, setLiveEquipmentDrawerOverlayId] = useState("");
  const liveEquipmentDockScrollRafRef = useRef(0);
  const liveAlarmMarqueeViewportRef = useRef(null);
  const liveAlarmMarqueeTrackRef = useRef(null);
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
  const [projectNameDraft, setProjectNameDraft] = useState("Untitled");
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [projectModeDraft, setProjectModeDraft] = useState("design");
  const [projectCanvasBackground, setProjectCanvasBackground] = useState(() =>
    normalizeProjectCanvasBackground(null)
  );
  const [projectCanvasBackgroundDraft, setProjectCanvasBackgroundDraft] = useState(() =>
    normalizeProjectCanvasBackground(null)
  );
  const [projectPlcs, setProjectPlcs] = useState([]);
  const [screens, setScreens] = useState([
    {
      id: "screen-1",
      name: "Screen 1",
      shapes: [],
      svgOverlays: [],
      vbW: 1600,
      vbH: 900,
      pan: { x: 0, y: 0 },
      zoom: 1,
      showInLiveMenu: true,
    },
  ]);
  const [activeScreenId, setActiveScreenId] = useState("screen-1");
  const [screenName, setScreenName] = useState("Screen 1");
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(() => readStoredActiveProjectId());
  const [projectRouteRows, setProjectRouteRows] = useState([]);
  const [projectStatus, setProjectStatus] = useState("");
  const [activeProjectUpdatedAt, setActiveProjectUpdatedAt] = useState("");
  const [activeProjectUpdatedBy, setActiveProjectUpdatedBy] = useState("");
  const [projectCursors, setProjectCursors] = useState([]);
  const [showProjectNameInput, setShowProjectNameInput] = useState(false);
  const [showProjectDrawer, setShowProjectDrawer] = useState(false);
  const [projectMode, setProjectMode] = useState(() =>
    readStoredProjectMode(readStoredActiveProjectId())
  );
  const isLiveMode = projectMode === "live";
  const [liveMenuCollapsed, setLiveMenuCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("vizi_live_menu_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [mainDrawerFullscreen, setMainDrawerFullscreen] = useState(() => readStoredDrawerFullscreen("main"));
  const [userDrawerFullscreen, setUserDrawerFullscreen] = useState(() => readStoredDrawerFullscreen("user"));
  const [projectDrawerFullscreen, setProjectDrawerFullscreen] = useState(() => readStoredDrawerFullscreen("project"));
  const [projectDrawerTab, setProjectDrawerTab] = useState("project");
  const [databaseEmbeddedPath, setDatabaseEmbeddedPath] = useState("");
  const [databaseDataOnlyMode, setDatabaseDataOnlyMode] = useState(false);
  const [databaseTablesForMenu, setDatabaseTablesForMenu] = useState([]);
  const [securityRolesForMenu, setSecurityRolesForMenu] = useState([]);
  const [showTeamChat, setShowTeamChat] = useState(false);
  const [teamChatMessages, setTeamChatMessages] = useState([]);
  const [teamChatDraft, setTeamChatDraft] = useState("");
  const [teamChatLoading, setTeamChatLoading] = useState(false);
  const [teamChatSending, setTeamChatSending] = useState(false);
  const [teamChatUnreadCount, setTeamChatUnreadCount] = useState(0);
  const [teamChatLastSeenId, setTeamChatLastSeenId] = useState(0);
  const teamChatBodyRef = useRef(null);
  const [liveActiveAlarmsDb, setLiveActiveAlarmsDb] = useState([]);
  const [liveActiveAlarmsDbLoaded, setLiveActiveAlarmsDbLoaded] = useState(false);
  const [svgCatalogFiles, setSvgCatalogFiles] = useState([]);
  const [liveMenuGroups, setLiveMenuGroups] = useState(() =>
    defaultLiveMenuGroupsFromScreens([
      { id: "screen-1", name: "Screen 1", showInLiveMenu: true },
    ])
  );
  const [collapsedLiveGroupIds, setCollapsedLiveGroupIds] = useState([]);
  const lastProjectSignatureRef = useRef("");
  const projectSaveInFlightRef = useRef(false);
  const autoSaveTimerRef = useRef(null);
  const pendingSilentSaveRef = useRef(false);
  const queuedSaveAfterFlightRef = useRef(null); // null | "silent" | "manual"
  const uiPreferenceAutosaveReadyRef = useRef(false);
  const isInteractingRef = useRef(false);
  const lastCursorSentRef = useRef({ at: 0, x: NaN, y: NaN });
  const projectNameRef = useRef(projectName);
  const showGridRef = useRef(showGrid);
  const showTagPathsRef = useRef(showTagPaths);
  const liveMenuCollapsedRef = useRef(liveMenuCollapsed);
  const projectCanvasBackgroundRef = useRef(projectCanvasBackground);
  const projectPlcsRef = useRef(projectPlcs);
  const screensRef = useRef(screens);
  const activeProjectIdRef = useRef(activeProjectId);
  const projectModeRef = useRef(projectMode);
  const activeScreenIdRef = useRef(activeScreenId);
  const screenNameRef = useRef(screenName);
  const vbWRef = useRef(vbW);
  const vbHRef = useRef(vbH);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const projectModeStorageKey = useMemo(
    () => `vizi_project_mode:${String(activeProjectId || "default")}`,
    [activeProjectId]
  );
  const projectDraftStorageKey = useMemo(
    () => `${PROJECT_DRAFT_KEY_PREFIX}${String(activeProjectId || "").trim()}`,
    [activeProjectId]
  );

  useEffect(() => {
    projectNameRef.current = projectName;
    showGridRef.current = showGrid;
    showTagPathsRef.current = showTagPaths;
    liveMenuCollapsedRef.current = liveMenuCollapsed;
    projectCanvasBackgroundRef.current = projectCanvasBackground;
    projectPlcsRef.current = projectPlcs;
    screensRef.current = screens;
    activeProjectIdRef.current = activeProjectId;
    projectModeRef.current = projectMode;
    activeScreenIdRef.current = activeScreenId;
    screenNameRef.current = screenName;
    vbWRef.current = vbW;
    vbHRef.current = vbH;
    panRef.current = pan;
    zoomRef.current = zoom;
  }, [projectName, showGrid, showTagPaths, liveMenuCollapsed, projectCanvasBackground, projectPlcs, screens, activeProjectId, projectMode, activeScreenId, screenName, vbW, vbH, pan, zoom]);

  useEffect(() => {
    setSvgOverlays((prev) => {
      let changed = false;
      const next = prev.map((o) => {
        const kind = String(o?.widget?.kind || "").trim();
        const bb = o?.bbox;
        if (kind !== "countdownBar" || !bb) return o;
        const width = Number(bb.width);
        const height = Number(bb.height);
        // One-time migration for legacy countdown widgets created from the old 320x180 template.
        if (
          Number.isFinite(width) &&
          Number.isFinite(height) &&
          Math.abs(width - 320) <= 1 &&
          Math.abs(height - 180) <= 1
        ) {
          changed = true;
          return {
            ...o,
            bbox: {
              ...bb,
              height: 72,
            },
          };
        }
        return o;
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (projectNameEditing) return;
    setProjectNameDraft(projectName || "");
    setProjectModeDraft(normalizeProjectMode(projectMode));
    setProjectCanvasBackgroundDraft(normalizeProjectCanvasBackground(projectCanvasBackground));
  }, [projectName, projectMode, projectCanvasBackground, projectNameEditing]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("vizi_live_menu_collapsed", liveMenuCollapsed ? "1" : "0");
    } catch {
      // ignore storage write errors
    }
  }, [liveMenuCollapsed]);

  useEffect(() => {
    const nextMode = readStoredProjectMode(activeProjectId || "");
    setProjectMode(nextMode);
  }, [activeProjectId]);

  useEffect(() => {
    let alive = true;
    async function loadDbTablesForMenu() {
      try {
        const res = await fetch("/api/db/tables");
        const data = await res.json();
        if (!res.ok || !alive) return;
        const tables = Array.isArray(data?.tables)
          ? data.tables.map((t) => String(t || "").trim()).filter(Boolean)
          : [];
        setDatabaseTablesForMenu(tables);
      } catch {
        if (alive) setDatabaseTablesForMenu([]);
      }
    }
    loadDbTablesForMenu();
    return () => {
      alive = false;
    };
  }, [isPageVisible]);

  async function loadTeamChatMessages({ silent = false } = {}) {
    if (!silent) setTeamChatLoading(true);
    try {
      const res = await fetch("/api/chat/messages");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load chat.");
      const next = Array.isArray(data?.messages) ? data.messages : [];
      setTeamChatMessages(next);
      return next;
    } catch (err) {
      if (!silent) toastError(err?.message || "Failed to load chat.");
      return [];
    } finally {
      if (!silent) setTeamChatLoading(false);
    }
  }

  async function sendTeamChatMessage() {
    const msg = String(teamChatDraft || "").trim();
    if (!msg || teamChatSending) return;
    setTeamChatSending(true);
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to send message.");
      setTeamChatDraft("");
      const next = await loadTeamChatMessages({ silent: true });
      const latestId = next.reduce((maxId, row) => Math.max(maxId, Number(row?.id) || 0), 0);
      if (latestId > 0) setTeamChatLastSeenId((prev) => Math.max(prev, latestId));
      setTeamChatUnreadCount(0);
    } catch (err) {
      toastError(err?.message || "Failed to send message.");
    } finally {
      setTeamChatSending(false);
    }
  }

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    let timer = 0;
    const pollMs = isPageVisible ? 2500 : 7000;
    const run = async () => {
      const next = await loadTeamChatMessages({ silent: true });
      if (cancelled) return;
      const latestId = next.reduce((maxId, row) => Math.max(maxId, Number(row?.id) || 0), 0);
      if (showTeamChat) {
        if (latestId > 0) setTeamChatLastSeenId((prev) => Math.max(prev, latestId));
        setTeamChatUnreadCount(0);
      } else if (latestId > teamChatLastSeenId) {
        const currentUserId = Number(user?.id || 0);
        const unread = next.filter((row) => {
          const rowId = Number(row?.id || 0);
          if (!(rowId > teamChatLastSeenId)) return false;
          const authorId = Number(row?.user_id || 0);
          if (currentUserId > 0 && authorId === currentUserId) return false;
          return true;
        }).length;
        setTeamChatUnreadCount(unread);
      }
      timer = window.setTimeout(run, pollMs);
    };
    run();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [user?.id, isPageVisible, showTeamChat, teamChatLastSeenId]);

  useEffect(() => {
    if (!showTeamChat) return;
    const latestId = teamChatMessages.reduce((maxId, row) => Math.max(maxId, Number(row?.id) || 0), 0);
    if (latestId > 0) setTeamChatLastSeenId((prev) => Math.max(prev, latestId));
    setTeamChatUnreadCount(0);
    const el = teamChatBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [showTeamChat, teamChatMessages]);

  useEffect(() => {
    if (!isLiveMode) {
      setLiveActiveAlarmsDb([]);
      setLiveActiveAlarmsDbLoaded(false);
      return undefined;
    }
    let cancelled = false;
    let timer = 0;
    const pollMs = isPageVisible ? 2000 : 6000;
    const fetchActiveAlarms = async () => {
      try {
        const res = await fetch("/api/alarms?activeOnly=true");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load alarms.");
        if (cancelled) return;
        const rows = Array.isArray(data?.active) ? data.active : [];
        setLiveActiveAlarmsDb(
          rows.map((row, idx) => {
            const occurredAt = Number(new Date(row?.first_triggered_at || 0).getTime() || 0);
            return {
              id: String(row?.alarm_key || `${row?.topic || "alarm"}.${row?.label || idx}.${idx}`),
              label: String(row?.label || row?.tag_path || `Alarm ${idx + 1}`),
              topic: String(row?.topic || ""),
              operator: String(row?.operator || ""),
              threshold: String(row?.threshold ?? ""),
              value: row?.last_value == null || row?.last_value === "" ? "-" : String(row?.last_value),
              occurredAt,
            };
          })
        );
        setLiveActiveAlarmsDbLoaded(true);
      } catch {
        if (cancelled) return;
        setLiveActiveAlarmsDb([]);
        setLiveActiveAlarmsDbLoaded(true);
      } finally {
        if (cancelled) return;
        timer = window.setTimeout(fetchActiveAlarms, pollMs);
      }
    };
    fetchActiveAlarms();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [isLiveMode, isPageVisible]);

  useEffect(() => {
    let alive = true;
    async function loadSvgCatalog() {
      try {
        const res = await fetch("/api/svg/catalog");
        const data = await res.json();
        if (!res.ok || !alive) return;
        const files = Array.isArray(data?.files)
          ? data.files
              .map((f) => ({
                key: String(f?.key || "").trim(),
                name: String(f?.name || "").trim(),
                url: String(f?.url || "").trim(),
              }))
              .filter((f) => f.key && f.name && f.url)
          : [];
        setSvgCatalogFiles(files);
      } catch {
        if (alive) setSvgCatalogFiles([]);
      }
    }
    loadSvgCatalog();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!importOpen) return undefined;
    let alive = true;
    async function loadSvgCatalogOnOpen() {
      try {
        const res = await fetch("/api/svg/catalog");
        const data = await res.json();
        if (!res.ok || !alive) return;
        const files = Array.isArray(data?.files)
          ? data.files
              .map((f) => ({
                key: String(f?.key || "").trim(),
                name: String(f?.name || "").trim(),
                url: String(f?.url || "").trim(),
              }))
              .filter((f) => f.key && f.name && f.url)
          : [];
        if (files.length) setSvgCatalogFiles(files);
      } catch {
        // keep existing catalog if refresh fails
      }
    }
    loadSvgCatalogOnOpen();
    return () => {
      alive = false;
    };
  }, [importOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(projectModeStorageKey, normalizeProjectMode(projectMode));
      localStorage.setItem("vizi_project_mode:last", normalizeProjectMode(projectMode));
    } catch {
      // ignore storage write errors
    }
  }, [projectMode, projectModeStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = String(activeProjectId || "").trim();
    if (!id) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          projectDraftStorageKey,
          JSON.stringify({ savedAt: Date.now(), payload: getProjectPayloadFromRefs() })
        );
      } catch {
        // ignore draft persistence failures
      }
    }, 180);
    return () => clearTimeout(t);
  }, [
    activeProjectId,
    projectDraftStorageKey,
    projectMode,
    projectName,
    projectCanvasBackground,
    projectPlcs,
    screens,
    activeScreenId,
    screenName,
    vbW,
    vbH,
    pan,
    zoom,
    shapes,
    svgOverlays,
    liveMenuGroups,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onBeforeUnload = () => {
      const id = String(activeProjectIdRef.current || "").trim();
      if (!id) return;
      try {
        localStorage.setItem(
          `${PROJECT_DRAFT_KEY_PREFIX}${id}`,
          JSON.stringify({ savedAt: Date.now(), payload: getProjectPayloadFromRefs() })
        );
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [projectMode, liveMenuGroups]);

  useEffect(() => {
    isInteractingRef.current = Boolean(dragAll || dragHandle || overlayResize || marquee || drawing);
  }, [dragAll, dragHandle, overlayResize, marquee, drawing]);

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
    const id = setInterval(
      pollStatus,
      isPageVisible ? (isLiveMode ? 1200 : 3000) : 10000
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isPageVisible, isLiveMode]);

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
      const bindings = widgetBindings
        .map((b) => {
          const expr = b.tagPath.slice(3).trim();
          const dot = expr.indexOf(".");
          if (dot <= 0 || dot === expr.length - 1) return null;
          const table = expr.slice(0, dot).trim();
          const field = expr.slice(dot + 1).trim();
          if (!table || !field) return null;
          return { overlayId: b.id, table, field };
        })
        .filter(Boolean);
      if (!bindings.length) {
        if (alive) setWidgetDbValues({});
        return;
      }
      let next = {};
      try {
        const res = await fetch("/api/db/batch-first-values", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bindings }),
        });
        const data = await res.json();
        if (res.ok && data?.values && typeof data.values === "object") {
          next = data.values;
        }
      } catch {
        // ignore batch errors
      }
      if (!alive) return;
      setWidgetDbValues(next);
    }
    pollWidgetDbValues();
    const id = setInterval(
      pollWidgetDbValues,
      isPageVisible ? (isLiveMode ? 3000 : 4500) : 10000
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [svgOverlays, isPageVisible, isLiveMode]);

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

  const liveActiveAlarmsComputed = useMemo(() => {
    const live = opcLiveValues || {};
    const alarms = [];
    const buildTestAlarmValue = (operator, thresholdRaw) => {
      const thresholdNum = Number(thresholdRaw);
      if (Number.isFinite(thresholdNum)) {
        if (operator === ">") return thresholdNum + 1;
        if (operator === ">=") return thresholdNum;
        if (operator === "<") return thresholdNum - 1;
        if (operator === "<=") return thresholdNum;
        if (operator === "!=") return thresholdNum + 1;
        return thresholdNum;
      }
      const thresholdText = normalizeTagValue(thresholdRaw || "");
      if (operator === "!=") return thresholdText ? `${thresholdText}_test` : "1";
      return thresholdText || "1";
    };
    (opcTags || []).forEach((tag, idx) => {
      if (!isTruthyFlag(tag?.alarmEnabled)) return;
      const threshold = normalizeTagValue(tag?.alarmValue || "");
      if (!threshold) return;
      const topic = normalizeTagValue(tag?.topic || "");
      const group = normalizeTagValue(tag?.groupName || "");
      const tagPath = normalizeTagValue(tag?.tagPath || "");
      const name = normalizeTagValue(tag?.name || tagPath || `Tag ${idx + 1}`);
      const candidates = [
        topic && group && tagPath ? `${topic}.${group}.${tagPath}` : "",
        topic && group && name ? `${topic}.${group}.${name}` : "",
        topic && tagPath ? `${topic}.${tagPath}` : "",
        topic && name ? `${topic}.${name}` : "",
        group && tagPath ? `${group}.${tagPath}` : "",
        group && name ? `${group}.${name}` : "",
        tagPath,
        name,
      ]
        .map((x) => normalizeTagValue(x))
        .filter(Boolean);
      let liveValue = "";
      for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(live, key)) {
          liveValue = live[key];
          break;
        }
        const lower = key.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(live, lower)) {
          liveValue = live[lower];
          break;
        }
      }
      const operator = normalizeAlarmOperatorValue(tag?.alarmOperator);
      if ((liveValue == null || liveValue === "") && isTruthyFlag(tag?.alarmTest)) {
        liveValue = buildTestAlarmValue(operator, threshold);
      }
      if (!evaluateAlarmCondition(liveValue, operator, threshold)) return;
      alarms.push({
        id: `${topic}.${name}.${idx}`,
        label: name,
        topic,
        operator,
        threshold,
        value: liveValue == null || liveValue === "" ? "-" : String(liveValue),
      });
    });
    return alarms;
  }, [opcTags, opcLiveValues]);
  const liveTestAlarms = useMemo(
    () => [
      {
        id: "test.alarm.high_pressure",
        label: "TEST High Pressure",
        topic: "TEST",
        operator: ">",
        threshold: "120",
        value: "128",
        occurredAt: Date.now() - 60_000,
      },
      {
        id: "test.alarm.motor_fault",
        label: "TEST Motor Fault",
        topic: "TEST",
        operator: "==",
        threshold: "1",
        value: "1",
        occurredAt: Date.now() - 15_000,
      },
    ],
    []
  );
  const liveActiveAlarms = useMemo(() => {
    const source = liveActiveAlarmsDbLoaded ? liveActiveAlarmsDb : liveActiveAlarmsComputed;
    if (Array.isArray(source) && source.length) return source;
    return liveTestAlarms;
  }, [liveActiveAlarmsDbLoaded, liveActiveAlarmsDb, liveActiveAlarmsComputed, liveTestAlarms]);
  const buildLiveEquipmentDetails = (overlay) => {
    if (!overlay) return [];
    const path = String(overlay.tagPath || "").trim();
    const rows = [];
    const groupLive = path
      ? svgLiveValuesByGroupPath.get(path) || svgLiveValuesByGroupPath.get(path.toLowerCase()) || null
      : null;
    if (groupLive?.routeId) rows.push({ key: "Route", value: String(groupLive.routeId) });
    if (groupLive?.state) rows.push({ key: "State", value: String(groupLive.state) });
    if (path) {
      const lowerPath = path.toLowerCase();
      const direct = Object.entries(opcLiveValues || {}).filter(([k]) => {
        const key = String(k || "").toLowerCase();
        return key === lowerPath || key.endsWith(`.${lowerPath}`) || key.includes(`${lowerPath}.`);
      });
      direct.slice(0, 12).forEach(([k, v]) => {
        const label = String(k || "").split(".").pop() || String(k || "");
        rows.push({ key: label, value: v == null || v === "" ? "-" : String(v) });
      });
    }
    return rows;
  };
  const liveEquipmentOverlays = useMemo(() => {
    const byId = new Map((svgOverlays || []).map((o) => [String(o.id || ""), o]));
    return (liveEquipmentOverlayIds || [])
      .map((id) => byId.get(String(id || "")))
      .filter(Boolean)
      .map((overlay) => ({
        overlay,
        details: buildLiveEquipmentDetails(overlay),
      }));
  }, [svgOverlays, liveEquipmentOverlayIds, svgLiveValuesByGroupPath, opcLiveValues]);
  const liveEquipmentDrawerEntry = useMemo(() => {
    const id = String(liveEquipmentDrawerOverlayId || "").trim();
    if (!id) return null;
    return (
      liveEquipmentOverlays.find((entry) => String(entry?.overlay?.id || "") === id) || null
    );
  }, [liveEquipmentOverlays, liveEquipmentDrawerOverlayId]);
  const liveEquipmentDockEntries = useMemo(() => {
    const drawerId = String(liveEquipmentDrawerOverlayId || "").trim();
    if (!drawerId) return liveEquipmentOverlays;
    return liveEquipmentOverlays.filter(
      (entry) => String(entry?.overlay?.id || "") !== drawerId
    );
  }, [liveEquipmentOverlays, liveEquipmentDrawerOverlayId]);
  const liveEquipmentConnectorLines = useMemo(() => {
    if (!isLiveMode || !svgRef.current || !liveEquipmentDockEntries.length) return [];
    const svgRect = svgRef.current.getBoundingClientRect();
    const z = zoom || 1;
    const lines = [];
    for (const entry of liveEquipmentDockEntries) {
      const overlay = entry?.overlay;
      if (!overlay) continue;
      let fromX = NaN;
      let fromY = NaN;
      let overlayNode = null;
      try {
        const rawId = String(overlay.id || "");
        const escapedId =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(rawId)
            : rawId.replace(/"/g, '\\"');
        overlayNode = document.querySelector(`[data-overlay-id="${escapedId}"]`);
      } catch {
        overlayNode = null;
      }
      if (overlayNode && typeof overlayNode.getBoundingClientRect === "function") {
        const r = overlayNode.getBoundingClientRect();
        fromX = r.left + r.width / 2;
        fromY = r.bottom;
      } else {
        const bb = overlayLocalBBox(overlay.id);
        if (!bb) continue;
        const wr = overlayWorldRect(overlay, bb);
        fromX = svgRect.left + (pan?.x || 0) + (wr.x + wr.w / 2) * z;
        fromY = svgRect.top + (pan?.y || 0) + (wr.y + wr.h) * z;
      }
      const cardEl = liveEquipmentCardRefs.current.get(String(overlay.id || ""));
      if (!cardEl) continue;
      const cardRect = cardEl.getBoundingClientRect();
      const toX = cardRect.left + cardRect.width / 2;
      const toY = cardRect.top + 2;
      if (![fromX, fromY, toX, toY].every((n) => Number.isFinite(n))) continue;
      lines.push({
        id: String(overlay.id || ""),
        fromX,
        fromY,
        toX,
        toY,
      });
    }
    return lines;
  }, [isLiveMode, liveEquipmentDockEntries, pan, zoom, liveEquipmentDockTick]);

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
    const pan =
      screen?.pan && Number.isFinite(screen.pan.x) && Number.isFinite(screen.pan.y)
        ? { x: screen.pan.x, y: screen.pan.y }
        : fallback?.pan && Number.isFinite(fallback.pan.x) && Number.isFinite(fallback.pan.y)
        ? { x: fallback.pan.x, y: fallback.pan.y }
        : { x: 0, y: 0 };
    const zoom = Number.isFinite(screen?.zoom) ? screen.zoom : Number.isFinite(fallback?.zoom) ? fallback.zoom : 1;
    const designPan =
      screen?.designPan && Number.isFinite(screen.designPan.x) && Number.isFinite(screen.designPan.y)
        ? { x: screen.designPan.x, y: screen.designPan.y }
        : fallback?.designPan && Number.isFinite(fallback.designPan.x) && Number.isFinite(fallback.designPan.y)
        ? { x: fallback.designPan.x, y: fallback.designPan.y }
        : pan;
    const designZoom = Number.isFinite(screen?.designZoom)
      ? screen.designZoom
      : Number.isFinite(fallback?.designZoom)
      ? fallback.designZoom
      : zoom;
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
      pan,
      zoom,
      designPan,
      designZoom,
      showInLiveMenu:
        typeof screen?.showInLiveMenu === "boolean"
          ? screen.showInLiveMenu
          : typeof fallback?.showInLiveMenu === "boolean"
          ? fallback.showInLiveMenu
          : true,
    };
  }

  function commitCurrentScreenState(sourceScreens = screensRef.current) {
    const list = Array.isArray(sourceScreens) ? sourceScreens.map((s) => normalizeScreenPayload(s)) : [];
    const fallbackId = list[0]?.id || `screen-${Date.now()}`;
    const currentId = String(activeScreenIdRef.current || fallbackId);
    const currentScreen = list.find((s) => s.id === currentId) || {};
    const isDesignMode = normalizeProjectMode(projectModeRef.current) === "design";
    const designPan =
      isDesignMode
        ? (panRef.current && Number.isFinite(panRef.current.x) && Number.isFinite(panRef.current.y)
            ? { x: panRef.current.x, y: panRef.current.y }
            : { x: 0, y: 0 })
        : (currentScreen?.designPan && Number.isFinite(currentScreen.designPan.x) && Number.isFinite(currentScreen.designPan.y)
            ? { x: currentScreen.designPan.x, y: currentScreen.designPan.y }
            : (currentScreen?.pan && Number.isFinite(currentScreen.pan.x) && Number.isFinite(currentScreen.pan.y)
                ? { x: currentScreen.pan.x, y: currentScreen.pan.y }
                : { x: 0, y: 0 }));
    const designZoom =
      isDesignMode
        ? (Number.isFinite(zoomRef.current) ? zoomRef.current : 1)
        : (Number.isFinite(currentScreen?.designZoom)
            ? currentScreen.designZoom
            : (Number.isFinite(currentScreen?.zoom) ? currentScreen.zoom : 1));
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
        designPan,
        designZoom,
      },
      {
        ...currentScreen,
        id: currentId,
        name: screenNameRef.current || currentScreen.name || "Screen 1",
      }
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
    const normalizedMenuGroups = normalizeLiveMenuGroups(liveMenuGroups, committed.list);
    return {
      version: 1,
      name: projectName || "Untitled",
      canvasBackground: normalizeProjectCanvasBackground(projectCanvasBackground),
      plcs: normalizeProjectPlcEntries(projectPlcs, { includeRawText: true }),
      activeScreenId: effectiveScreenId,
      projectMode: normalizeProjectMode(projectMode),
      uiPreferences: normalizeProjectUiPreferences(
        {
          showGrid,
          showTagPaths,
          liveMenuCollapsed,
        },
        { showGrid: true, showTagPaths: false, liveMenuCollapsed: false }
      ),
      screens: committed.list,
      liveMenuGroups: normalizedMenuGroups,
      savedAt: new Date().toISOString(),

      shapes: shapesRef.current ?? [],
      svgOverlays: overlaysRef.current ?? [],

      vbW: vbWRef.current,
      vbH: vbHRef.current,
      pan: panRef.current,
      zoom: zoomRef.current,
    };
  }

  function getProjectPayloadFromRefs() {
    const committed = commitCurrentScreenState(screensRef.current);
    const effectiveScreenId = committed.currentId || committed.list[0]?.id || "";
    const normalizedMenuGroups = normalizeLiveMenuGroups(liveMenuGroups, committed.list);
    return {
      version: 1,
      name: projectNameRef.current || "Untitled",
      canvasBackground: normalizeProjectCanvasBackground(projectCanvasBackgroundRef.current),
      plcs: normalizeProjectPlcEntries(projectPlcsRef.current, { includeRawText: true }),
      activeScreenId: effectiveScreenId,
      projectMode: normalizeProjectMode(projectMode),
      uiPreferences: normalizeProjectUiPreferences(
        {
          showGrid: showGridRef.current,
          showTagPaths: showTagPathsRef.current,
          liveMenuCollapsed: liveMenuCollapsedRef.current,
        },
        { showGrid: true, showTagPaths: false, liveMenuCollapsed: false }
      ),
      screens: committed.list,
      liveMenuGroups: normalizedMenuGroups,
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
      projectMode: normalizeProjectMode(payload.projectMode),
      uiPreferences: normalizeProjectUiPreferences(payload.uiPreferences || payload.ui, {
        showGrid: true,
        showTagPaths: false,
        liveMenuCollapsed: false,
      }),
      screens: normalizedScreens,
      liveMenuGroups: normalizeLiveMenuGroups(payload.liveMenuGroups, normalizedScreens),
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

  function applyRemoteProjectPayload(data, options = {}) {
    setProjectCanvasBackground(
      normalizeProjectCanvasBackground(data?.canvasBackground || data?.canvasBackgroundByTheme)
    );
    setProjectPlcs(normalizeProjectPlcEntries(data?.plcs || data?.plcLibrary));
    const uiPreferences = normalizeProjectUiPreferences(data?.uiPreferences || data?.ui, {
      showGrid: showGridRef.current,
      showTagPaths: showTagPathsRef.current,
      liveMenuCollapsed: liveMenuCollapsedRef.current,
    });
    setShowGrid(uiPreferences.showGrid);
    setShowTagPaths(uiPreferences.showTagPaths);
    setLiveMenuCollapsed(uiPreferences.liveMenuCollapsed);
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
    if (Object.prototype.hasOwnProperty.call(data || {}, "projectMode")) {
      setProjectMode(normalizeProjectMode(data?.projectMode));
    } else {
      setProjectMode(readStoredProjectMode(options?.projectId || activeProjectIdRef.current));
    }
    setLiveMenuGroups(normalizeLiveMenuGroups(data?.liveMenuGroups, incoming));
    setScreens(incoming);
    hydrateScreenState(active);
  }

  function applyProjectPayload(data, options = {}) {
    setProjectCanvasBackground(
      normalizeProjectCanvasBackground(data?.canvasBackground || data?.canvasBackgroundByTheme)
    );
    setProjectPlcs(normalizeProjectPlcEntries(data?.plcs || data?.plcLibrary));
    const uiPreferences = normalizeProjectUiPreferences(data?.uiPreferences || data?.ui, {
      showGrid: showGridRef.current,
      showTagPaths: showTagPathsRef.current,
      liveMenuCollapsed: liveMenuCollapsedRef.current,
    });
    setShowGrid(uiPreferences.showGrid);
    setShowTagPaths(uiPreferences.showTagPaths);
    setLiveMenuCollapsed(uiPreferences.liveMenuCollapsed);
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
    if (Object.prototype.hasOwnProperty.call(data || {}, "projectMode")) {
      setProjectMode(normalizeProjectMode(data?.projectMode));
    } else {
      setProjectMode(readStoredProjectMode(options?.projectId || activeProjectIdRef.current));
    }
    setLiveMenuGroups(normalizeLiveMenuGroups(data?.liveMenuGroups, incoming));

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
      const keepalive = options?.keepalive === true;
      const skipListReload = options?.skipListReload === true;
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
        keepalive,
        body: JSON.stringify({
          id: activeProjectId || undefined,
          name: effectiveName,
          data: { ...payload, name: effectiveName },
          baseUpdatedAt: activeProjectUpdatedAt || undefined,
          teamMerge: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && String(data?.code || "") === "PROJECT_CONFLICT") {
          const remote = data?.project && typeof data.project === "object" ? data.project : null;
          if (remote?.updated_at) setActiveProjectUpdatedAt(String(remote.updated_at));
          setActiveProjectUpdatedBy(String(remote?.updated_by_username || ""));
          const by = String(remote?.updated_by_username || "").trim();
          setProjectStatus(
            by
              ? `Save blocked: newer remote changes by ${by}. Reload project to merge.`
              : "Save blocked: newer remote changes detected. Reload project to merge."
          );
          return;
        }
        throw new Error(data?.error || "Save failed.");
      }
      const next = data.project;
      const localSig = projectPayloadSignature(payload);
      const remoteSig = next?.data ? projectPayloadSignature(next.data) : "";
      lastProjectSignatureRef.current = remoteSig && remoteSig === localSig ? remoteSig : localSig;
      if (next?.id) setActiveProjectId(next.id);
      if (next?.updated_at) setActiveProjectUpdatedAt(String(next.updated_at));
      setActiveProjectUpdatedBy(String(next?.updated_by_username || ""));
      if (!silent) {
        const by = String(next?.updated_by_username || "").trim();
        setProjectStatus(by ? `Saved (by ${by})` : "Saved");
      }
      clearProjectDraft(next?.id || activeProjectId);
      setShowProjectNameInput(false);
      if (!keepalive && !skipListReload) {
        const reload = await fetch("/api/projects");
        const payloadList = await reload.json();
        if (reload.ok) setProjects(payloadList.projects || []);
      }
    } catch (err) {
      const message = err?.message || "Save failed.";
      setProjectStatus(options?.silent ? `Autosave failed: ${message}` : message);
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
    if (projectNameEditing) {
      autoSaveTimerRef.current = setTimeout(flushScheduledProjectSave, 350);
      return;
    }
    if (projectSaveInFlightRef.current) {
      autoSaveTimerRef.current = setTimeout(flushScheduledProjectSave, 350);
      return;
    }
    pendingSilentSaveRef.current = false;
    saveProjectToDb({ silent: true });
  }

  function hasUnsavedProjectChangesFromRefs() {
    const sig = projectPayloadSignature(getProjectPayloadFromRefs());
    if (!sig) return false;
    return sig !== lastProjectSignatureRef.current;
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

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const flushForLifecycle = () => {
      if (projectNameEditing) return;
      if (projectSaveInFlightRef.current) return;
      if (!hasUnsavedProjectChangesFromRefs()) return;
      saveProjectToDb({ silent: true, keepalive: true, skipListReload: true });
    };
    const onPageHide = () => flushForLifecycle();
    const onVisibilityChange = () => {
      if (document.hidden) flushForLifecycle();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [projectNameEditing]);

  async function openProjectFromDb(id) {
    if (!id) return;
    try {
      setProjectStatus("");
      const res = await fetch(`/api/projects/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Load failed.");
      const remoteUpdatedAtMs = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
      const localDraft = readProjectDraft(data?.id || id);
      const localDraftPayload =
        localDraft && localDraft.payload && typeof localDraft.payload === "object"
          ? localDraft.payload
          : null;
      const useLocalDraft =
        !!localDraftPayload &&
        Number(localDraft?.savedAt || 0) > Math.max(0, Number(remoteUpdatedAtMs || 0));
      applyProjectPayload(useLocalDraft ? localDraftPayload : data?.data || {}, { projectId: data?.id || id });
      setProjectName(data?.name || "Untitled");
      setActiveProjectId(data?.id || "");
      setActiveProjectUpdatedAt(String(data?.updated_at || ""));
      setActiveProjectUpdatedBy(String(data?.updated_by_username || ""));
      lastProjectSignatureRef.current = projectPayloadSignature(
        useLocalDraft ? localDraftPayload : data?.data || {}
      );
      projectHandleRef.current = null;
      const by = String(data?.updated_by_username || "").trim();
      if (useLocalDraft) {
        setProjectStatus("Loaded local draft");
      } else {
        setProjectStatus(by ? `Loaded (last update by ${by})` : "Loaded");
      }
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
      clearProjectDraft(id);
      if (activeProjectId === id) setActiveProjectId("");
      setProjectStatus("Deleted");
    } catch (err) {
      setProjectStatus(err?.message || "Delete failed.");
    }
  }

  function newProjectFromDb() {
    const defaultScreens = [
      {
        id: "screen-1",
        name: "Screen 1",
        shapes: [],
        svgOverlays: [],
        vbW: 1600,
        vbH: 900,
        pan: { x: 0, y: 0 },
        zoom: 1,
        showInLiveMenu: true,
      },
    ];
    const defaultMenuGroups = defaultLiveMenuGroupsFromScreens(defaultScreens);
    applyProjectPayload({
      projectMode: "design",
      activeScreenId: "screen-1",
      screens: defaultScreens,
      liveMenuGroups: defaultMenuGroups,
    });
    setProjectName("Untitled");
    setProjectMode("design");
    setProjectCanvasBackground(normalizeProjectCanvasBackground(null));
    setScreenName("Screen 1");
    setActiveScreenId("screen-1");
    setScreens(defaultScreens);
    setLiveMenuGroups(defaultMenuGroups);
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
      projectMode: "design",
      activeScreenId: "screen-1",
      screens: defaultScreens,
      liveMenuGroups: defaultMenuGroups,
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

  async function saveProjectNameFromSettings() {
    const nextName = String(projectNameDraft || "").trim() || "Untitled";
    const nextMode = normalizeProjectMode(projectModeDraft);
    const nextCanvasBackground = normalizeProjectCanvasBackground(projectCanvasBackgroundDraft);
    setProjectName(nextName);
    setProjectNameDraft(nextName);
    setProjectMode(nextMode);
    setProjectModeDraft(nextMode);
    setProjectCanvasBackground(nextCanvasBackground);
    setProjectCanvasBackgroundDraft(nextCanvasBackground);
    setProjectNameEditing(false);
    await saveProjectToDb();
  }

  function cancelProjectNameEditFromSettings() {
    setProjectNameDraft(projectName || "");
    setProjectModeDraft(normalizeProjectMode(projectMode));
    setProjectCanvasBackgroundDraft(normalizeProjectCanvasBackground(projectCanvasBackground));
    setProjectNameEditing(false);
  }

  function beginProjectDrawerEdit() {
    setProjectNameDraft(projectName || "");
    setProjectModeDraft(normalizeProjectMode(projectMode));
    setProjectCanvasBackgroundDraft(normalizeProjectCanvasBackground(projectCanvasBackground));
    setProjectNameEditing(true);
  }

  useEffect(() => {
    if (!activeProjectId) return;
    let alive = true;
    async function pollProject() {
      if (!isPageVisible) return;
      if (isInteractingRef.current) return;
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
          const by = String(data?.updated_by_username || "").trim();
          setProjectStatus(
            by
              ? `Remote update by ${by} detected; local unsaved edits preserved. Reload to sync.`
              : "Remote update detected; local unsaved edits preserved. Reload to sync."
          );
          setActiveProjectUpdatedAt(remoteUpdatedAt);
          setActiveProjectUpdatedBy(by);
          return;
        }
        if (remoteSig && remoteSig !== localSig) {
          setProjectStatus("Remote differs from local snapshot; reload to sync.");
          return;
        }
        applyRemoteProjectPayload(data?.data || {}, { projectId: activeProjectId });
        lastProjectSignatureRef.current = remoteSig;
        setActiveProjectUpdatedAt(remoteUpdatedAt);
        const by = String(data?.updated_by_username || "");
        setActiveProjectUpdatedBy(by);
        setProjectStatus(by ? `Synced (updated by ${by})` : "Synced");
      } catch {
        // ignore sync failures
      }
    }
    const id = setInterval(pollProject, isPageVisible ? 8000 : 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [activeProjectId, activeProjectUpdatedAt, isPageVisible]);

  useEffect(() => {
    if (!activeProjectId || !isPageVisible || projectNameEditing) return;
    const id = setInterval(() => {
      const sig = projectPayloadSignature(getProjectPayload());
      if (!sig) return;
      if (sig === lastProjectSignatureRef.current) return;
      saveProjectToDb({ silent: true });
    }, 5000);
    return () => clearInterval(id);
  }, [activeProjectId, projectName, projectCanvasBackground, projectPlcs, activeScreenId, screenName, screens, vbW, vbH, pan, zoom, shapes, svgOverlays, isPageVisible, projectNameEditing]);

  useEffect(() => {
    if (!uiPreferenceAutosaveReadyRef.current) {
      uiPreferenceAutosaveReadyRef.current = true;
      return;
    }
    if (projectNameEditing) return;
    scheduleProjectAutoSave(180);
  }, [showGrid, showTagPaths, liveMenuCollapsed, projectNameEditing]);

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
    const id = setInterval(pollCursors, isPageVisible ? 2500 : 8000);
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
  const [isAppFullscreen, setIsAppFullscreen] = useState(() => {
    if (typeof document === "undefined") return false;
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  });
  const zoomDragRef = useRef({ dragging: false, ox: 0, oy: 0, panelW: 64, panelH: 240 });
  const zoomPosRef = useRef(zoomPos);
  const zoomPanelRef = useRef(null);
  const canvasViewportSizeRef = useRef({ w: 0, h: 0 });
  const [showHUD, setShowHUD] = useState(false);
  const [showMainDrawer, setShowMainDrawer] = useState(false);
  const [drawerView, setDrawerView] = useState("ai");
  const [databaseTab, setDatabaseTab] = useState("data");
  const [showUserDrawer, setShowUserDrawer] = useState(false);
  const [showSecurityDrawer, setShowSecurityDrawer] = useState(false);
  const getViewportSize = () => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1400,
    h: typeof window !== "undefined" ? window.innerHeight : 900,
  });
  const { w: initialVpW } = getViewportSize();
  const [drawerSizes, setDrawerSizes] = useState(() => {
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const defaults = {
      main: { w: Math.min(900, Math.floor(initialVpW * 0.96)) },
      user: { w: Math.min(620, Math.floor(initialVpW * 0.96)) },
      project: { w: Math.min(360, Math.floor(initialVpW * 0.92)) },
    };
    if (typeof window === "undefined") return defaults;
    try {
      const raw = localStorage.getItem(DRAWER_SIZES_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw);
      const mainW = clamp(Number(parsed?.main?.w) || defaults.main.w, 420, Math.max(420, Math.floor(initialVpW * 0.96)));
      const userW = clamp(Number(parsed?.user?.w) || defaults.user.w, 420, Math.max(420, Math.floor(initialVpW * 0.96)));
      const projectW = clamp(Number(parsed?.project?.w) || defaults.project.w, 280, Math.max(280, Math.floor(initialVpW * 0.92)));
      return {
        main: { w: mainW },
        user: { w: userW },
        project: { w: projectW },
      };
    } catch {
      return defaults;
    }
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
  const [userSettingsEditing, setUserSettingsEditing] = useState(false);
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(DRAWER_SIZES_KEY, JSON.stringify(drawerSizes));
    } catch {
      // ignore storage write errors
    }
  }, [drawerSizes]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        DRAWER_FULLSCREEN_KEY,
        JSON.stringify({
          main: Boolean(mainDrawerFullscreen),
          user: Boolean(userDrawerFullscreen),
          project: Boolean(projectDrawerFullscreen),
        })
      );
    } catch {
      // ignore storage write errors
    }
  }, [mainDrawerFullscreen, userDrawerFullscreen, projectDrawerFullscreen]);

  useEffect(() => {
    const captureInitialSize = () => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      canvasViewportSizeRef.current = {
        w: Math.max(1, Number(rect.width) || 0),
        h: Math.max(1, Number(rect.height) || 0),
      };
    };

    const keepViewportCenterStable = () => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nextW = Math.max(1, Number(rect.width) || 0);
      const nextH = Math.max(1, Number(rect.height) || 0);
      const prevW = Math.max(1, Number(canvasViewportSizeRef.current?.w) || nextW);
      const prevH = Math.max(1, Number(canvasViewportSizeRef.current?.h) || nextH);
      const z = Math.max(0.0001, Number(zoomRef.current) || 1);
      const p = panRef.current && Number.isFinite(panRef.current.x) && Number.isFinite(panRef.current.y)
        ? panRef.current
        : { x: 0, y: 0 };
      const worldCx = (prevW / 2 - p.x) / z;
      const worldCy = (prevH / 2 - p.y) / z;
      const nextPan = {
        x: nextW / 2 - worldCx * z,
        y: nextH / 2 - worldCy * z,
      };
      canvasViewportSizeRef.current = { w: nextW, h: nextH };
      setPan(nextPan);
    };

    captureInitialSize();
    const onResize = () => window.requestAnimationFrame(keepViewportCenterStable);
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onResize);
    document.addEventListener("webkitfullscreenchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onResize);
      document.removeEventListener("webkitfullscreenchange", onResize);
    };
  }, []);

  const [altDown, setAltDown] = useState(false);
  useEffect(() => {
    zoomPosRef.current = zoomPos;
  }, [zoomPos]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const syncFullscreenState = () => {
      setIsAppFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    };
    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    document.addEventListener("webkitfullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      document.removeEventListener("webkitfullscreenchange", syncFullscreenState);
    };
  }, []);

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

  function openDrawer(view, options = {}) {
    const next = view || "ai";
    const areaForView =
      next === "plc"
        ? "plc"
        : next === "opc" || next === "logs" || next === "diagnostics"
        ? "opc"
        : next === "tags"
        ? "tags"
        : next === "server"
        ? "server"
        : next === "database"
        ? "database"
        : next === "reports"
        ? "reports"
        : next === "ai"
        ? "ai"
        : next === "help"
        ? "help"
        : "";
    if (areaForView && !canViewArea(areaForView)) {
      toastError("You do not have permission to open this page.");
      return;
    }
    setShowUserDrawer(false);
    setShowSecurityDrawer(false);
    setMainDrawerFullscreen(false);
    setDrawerView(next);
    if (next === "database") {
      const forceDataOnly = options?.forceDatabaseDataTab === true && isLiveMode;
      setDatabaseDataOnlyMode(forceDataOnly);
      if (options?.forceDatabaseDataTab === true) {
        setDatabaseTab("data");
      } else {
        setDatabaseTab((prev) => (prev === "dataset" || prev === "config" || prev === "designer" ? prev : "data"));
      }
      const requested = String(options?.databasePath || "").trim();
      if (requested) {
        const normalized = requested.startsWith("/data/")
          ? requested
          : `/data/${requested.replace(/^\/+/, "")}`;
        setDatabaseEmbeddedPath(normalized);
      }
    } else {
      setDatabaseDataOnlyMode(false);
    }
    setShowMainDrawer(true);
  }

  useEffect(() => {
    if (!user) return;
    if (userSettingsEditing) return;
    setProfileDraft({
      username: user.username || "",
      display_name: user.display_name || "",
      avatar_url: user.avatar_url || "",
    });
  }, [user, userSettingsEditing]);

  function resetUserSettingsDraftsFromUser() {
    setProfileDraft({
      username: user?.username || "",
      display_name: user?.display_name || "",
      avatar_url: user?.avatar_url || "",
    });
    setPasswordDraft({ current: "", next: "" });
  }

  function beginUserSettingsEdit() {
    resetUserSettingsDraftsFromUser();
    setProfileError("");
    setProfileStatus("");
    setUserSettingsEditing(true);
  }

  function cancelUserSettingsEdit() {
    resetUserSettingsDraftsFromUser();
    setProfileError("");
    setProfileStatus("");
    setUserSettingsEditing(false);
  }

  async function saveUserSettingsEdit() {
    setProfileError("");
    setProfileStatus("");
    try {
      await updateProfile({
        username: profileDraft.username,
        display_name: profileDraft.display_name,
        avatar_url: profileDraft.avatar_url,
      });
      await refresh();
      setProfileStatus("Profile updated.");
      setUserSettingsEditing(false);
    } catch (err) {
      setProfileError(err?.message || "Profile update failed.");
    }
  }

  async function saveSecurityPassword() {
    setProfileError("");
    setProfileStatus("");
    try {
      const hasCurrentPassword = String(passwordDraft.current || "").trim().length > 0;
      const hasNextPassword = String(passwordDraft.next || "").trim().length > 0;
      if (!hasCurrentPassword || !hasNextPassword) {
        throw new Error("Enter both current and new password.");
      }
      await changePassword(passwordDraft.current, passwordDraft.next);
      setPasswordDraft({ current: "", next: "" });
      setProfileStatus("Password updated.");
    } catch (err) {
      setProfileError(err?.message || "Password update failed.");
    }
  }

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(SHOW_GRID_KEY, showGrid ? "1" : "0");
    } catch {
      // ignore
    }
  }, [showGrid]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(SHOW_TAG_PATHS_KEY, showTagPaths ? "1" : "0");
    } catch {
      // ignore
    }
  }, [showTagPaths]);

  const avatarLabel = useMemo(() => {
    const name = String(user?.display_name || user?.username || "").trim();
    if (!name) return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }, [user]);
  const canManageSecurity = useMemo(
    () => Boolean(user?.permissions?.security?.can_edit),
    [user]
  );
  const hasUserPermissions = useMemo(
    () => Boolean(user?.permissions && typeof user.permissions === "object"),
    [user]
  );
  const canViewArea = (areaKey) => {
    if (!areaKey) return true;
    if (!hasUserPermissions) return true;
    return Boolean(user?.permissions?.[areaKey]?.can_view || user?.permissions?.[areaKey]?.can_edit);
  };
  const canViewScreenPages = canViewArea("project");
  const canViewDataPages = canViewArea("database");
  const currentUserRoleIds = useMemo(
    () =>
      new Set(
        (Array.isArray(user?.roles) ? user.roles : [])
          .map((r) => Number(r?.id))
          .filter((id) => Number.isFinite(id) && id > 0)
      ),
    [user]
  );
  const canAccessLiveMenuItem = (item) => {
    const areaAllowed =
      String(item?.type || "").toLowerCase() === "data" ? canViewDataPages : canViewScreenPages;
    if (!areaAllowed) return false;
    const restricted = Boolean(item?.restricted);
    if (!restricted) return true;
    const allowedRoleIds = normalizeRoleIdList(item?.allowedRoleIds);
    if (!allowedRoleIds.length) return false;
    for (const id of allowedRoleIds) {
      if (currentUserRoleIds.has(id)) return true;
    }
    return false;
  };
  const isLiveMenuItemRoleRestricted = (item) => {
    const restricted = Boolean(item?.restricted);
    if (!restricted) return false;
    const allowedRoleIds = normalizeRoleIdList(item?.allowedRoleIds);
    if (!allowedRoleIds.length) return true;
    for (const id of allowedRoleIds) {
      if (currentUserRoleIds.has(id)) return false;
    }
    return true;
  };

  useEffect(() => {
    if (!canManageSecurity) {
      setSecurityRolesForMenu([]);
      return;
    }
    let cancelled = false;
    async function loadSecurityRoles() {
      try {
        const res = await fetch("/api/security/roles");
        const data = await res.json();
        if (!res.ok || cancelled) return;
        const roles = Array.isArray(data?.roles)
          ? data.roles
              .map((r) => ({
                id: Number(r?.id),
                name: String(r?.name || "").trim(),
              }))
              .filter((r) => Number.isFinite(r.id) && r.id > 0 && r.name)
          : [];
        setSecurityRolesForMenu(roles);
      } catch {
        if (!cancelled) setSecurityRolesForMenu([]);
      }
    }
    loadSecurityRoles();
    return () => {
      cancelled = true;
    };
  }, [canManageSecurity]);


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
  function fitViewToCanvas() {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewW = Math.max(1, Number(rect.width) || 0);
    const viewH = Math.max(1, Number(rect.height) || 0);
    const worldW = Math.max(1, Number(vbW) || 0);
    const worldH = Math.max(1, Number(vbH) || 0);
    const nextZoom = clampZoom(Math.min(viewW / worldW, viewH / worldH));
    setZoom(nextZoom);
    setPan({
      x: (viewW - worldW * nextZoom) / 2,
      y: (viewH - worldH * nextZoom) / 2,
    });
  }

  function zoomIn() {
    setZoom((z) => clampZoom(+(z * ZOOM_STEP).toFixed(4)));
  }
  function zoomOut() {
    setZoom((z) => clampZoom(+(z / ZOOM_STEP).toFixed(4)));
  }
  function resetZoomToActual100() {
    const el = svgRef.current;
    if (!el) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    const rect = el.getBoundingClientRect();
    const viewW = Math.max(1, Number(rect.width) || 0);
    const viewH = Math.max(1, Number(rect.height) || 0);
    const worldW = Math.max(1, Number(vbW) || 0);
    const worldH = Math.max(1, Number(vbH) || 0);
    setZoom(1);
    setPan({
      x: (viewW - worldW) / 2,
      y: (viewH - worldH) / 2,
    });
  }
  function zoomReset() {
    resetZoomToActual100();
  }

  async function toggleAppFullscreen() {
    if (typeof document === "undefined") return;
    const doc = document;
    const root = doc.documentElement;
    const active = Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
    try {
      if (active) {
        if (typeof doc.exitFullscreen === "function") {
          await doc.exitFullscreen();
        } else if (typeof doc.webkitExitFullscreen === "function") {
          doc.webkitExitFullscreen();
        }
      } else if (root) {
        if (typeof root.requestFullscreen === "function") {
          await root.requestFullscreen();
        } else if (typeof root.webkitRequestFullscreen === "function") {
          root.webkitRequestFullscreen();
        }
      }
    } catch {
      // ignore fullscreen errors (browser/user policy)
    }
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
    const activeId = String(activeScreenIdRef.current || "");
    const sourceScreens = Array.isArray(screensRef.current) ? screensRef.current : [];
    const active = sourceScreens.find((s) => String(s?.id || "") === activeId) || sourceScreens[0] || null;
    const next = normalizeScreenPayload(active || {}, { id: activeId || "screen-1", name: screenNameRef.current || "Screen 1" });
    setZoom(Number.isFinite(next.designZoom) ? next.designZoom : 1);
    setPan(
      next.designPan && Number.isFinite(next.designPan.x) && Number.isFinite(next.designPan.y)
        ? { x: next.designPan.x, y: next.designPan.y }
        : { x: 0, y: 0 }
    );
  }

  function rectsIntersect(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }

  // ✅ Mouse wheel zoom handler
  function onWheelZoom(e) {
    const target = e.target;
    const interactiveSelector =
      "[data-widget-control='true'],button,input,select,textarea,label,option";
    if (target && typeof target.closest === "function" && target.closest(interactiveSelector)) {
      return;
    }

    // Ctrl/Cmd + wheel is handled globally in capture phase.
    if (e.ctrlKey || e.metaKey) {
      return;
    }

    e.preventDefault();

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

  useEffect(() => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const isCanvasTarget = (target) =>
      !!(target && typeof target.closest === "function" && target.closest("[data-canvas-zoom-root='true']"));

    const onWheelBlockPageZoom = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      if (!isCanvasTarget(e.target)) return;
      const direction = e.deltaY < 0 ? 1 : -1;
      const factor = direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setZoom((z) => clampZoom(+(z * factor).toFixed(4)));
    };

    const onKeyDownBlockPageZoom = (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const k = String(e.key || "").toLowerCase();
      if (!["=", "+", "-", "_", "0"].includes(k)) return;
      if (isCanvasTarget(e.target)) return;
      e.preventDefault();
    };

    const onGestureBlockPageZoom = (e) => {
      if (isCanvasTarget(e.target)) return;
      e.preventDefault();
    };

    window.addEventListener("wheel", onWheelBlockPageZoom, { passive: false, capture: true });
    window.addEventListener("keydown", onKeyDownBlockPageZoom, true);
    window.addEventListener("gesturestart", onGestureBlockPageZoom, { passive: false, capture: true });
    window.addEventListener("gesturechange", onGestureBlockPageZoom, { passive: false, capture: true });
    window.addEventListener("gestureend", onGestureBlockPageZoom, { passive: false, capture: true });
    return () => {
      window.removeEventListener("wheel", onWheelBlockPageZoom, true);
      window.removeEventListener("keydown", onKeyDownBlockPageZoom, true);
      window.removeEventListener("gesturestart", onGestureBlockPageZoom, true);
      window.removeEventListener("gesturechange", onGestureBlockPageZoom, true);
      window.removeEventListener("gestureend", onGestureBlockPageZoom, true);
    };
  }, []);



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

  const svgCatalogMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(svgCatalogFiles) ? svgCatalogFiles : []).forEach((f) => {
      const key = String(f?.key || "").trim();
      if (!key) return;
      map.set(key, {
        key,
        name: String(f?.name || key.split("/").pop() || key).trim(),
        url: String(f?.url || "").trim(),
      });
    });
    return map;
  }, [svgCatalogFiles]);

  const svgLibraryMap = useMemo(() => {
    const obj = {};
    svgCatalogMap.forEach((value, key) => {
      obj[key] = value.url;
    });
    generatedSvgMap.forEach((raw, key) => {
      obj[key] = raw;
    });
    return obj;
  }, [svgCatalogMap, generatedSvgMap]);

  const svgFiles = useMemo(() => {
    const base = Array.from(svgCatalogMap.values()).map((entry) => ({
      key: entry.key,
      name: entry.name || entry.key.split("/").pop() || entry.key,
    }));
    const generated = generatedSvgs.map((g) => ({
      key: g.key,
      name: g.name || g.key.split("/").pop() || g.key,
    }));
    return [...base, ...generated].sort((a, b) => a.name.localeCompare(b.name));
  }, [generatedSvgs, svgCatalogMap]);

  const aiSvgCatalog = useMemo(() => {
    return (Array.isArray(svgFiles) ? svgFiles : [])
      .map((file) => {
        const key = String(file?.key || "").trim();
        const name = String(file?.name || "").trim();
        if (!key || !name) return null;
        const folder = getFolderFromKey(key);
        const tags = tokenizeSvgCatalogText(`${name} ${folder}`);
        return { key, name, tags };
      })
      .filter(Boolean)
      .slice(0, 450);
  }, [svgFiles]);

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
        const wr = overlayWorldRect(o, bb);
        const ox = wr.x;
        const oy = wr.y;
        const ow = wr.w;
        const oh = wr.h;
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
    setInlineEdit({ id, value: String(t.text || ""), kind: "shape" });
    setShowHUD(false);
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

  function overlayScaleX(o) {
    const sx = Number(o?.scaleX);
    if (Number.isFinite(sx) && sx > 0) return sx;
    const s = Number(o?.scale);
    return Number.isFinite(s) && s > 0 ? s : 1;
  }

  function overlayScaleY(o) {
    const sy = Number(o?.scaleY);
    if (Number.isFinite(sy) && sy > 0) return sy;
    const s = Number(o?.scale);
    return Number.isFinite(s) && s > 0 ? s : 1;
  }

  function overlayWorldRect(o, bb) {
    const sx = overlayScaleX(o);
    const sy = overlayScaleY(o);
    return {
      x: o.tx + sx * bb.x,
      y: o.ty + sy * bb.y,
      w: sx * bb.width,
      h: sy * bb.height,
    };
  }

  function worldFromLocal(o, lx, ly) {
    const sx = overlayScaleX(o);
    const sy = overlayScaleY(o);
    return { x: o.tx + sx * lx, y: o.ty + sy * ly };
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
    return svgCatalogMap.get(fileKey)?.url || null;
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
    while (generatedSvgMap.has(key) || svgCatalogMap.has(key)) {
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
      const wr = overlayWorldRect(o, bb);
      items.push({
        x: wr.x,
        y: wr.y,
        w: wr.w,
        h: wr.h,
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
        const wr = overlayWorldRect(o, bb);
        boxes.push({
          x: wr.x,
          y: wr.y,
          w: wr.w,
          h: wr.h,
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
    setTool("select");
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
    const hasShapeSelection = selectedIds.length > 0;
    const hasOverlaySelection = selectedOverlayIds.length > 0;
    if (!hasShapeSelection && !hasOverlaySelection) return;
    pushHistory();
    if (selectedIds.length) {
      setShapes((prev) => prev.filter((s) => !selectedIds.includes(s.id)));
      if (editingId && selectedIds.includes(editingId)) setEditingId(null);
    }
    if (selectedOverlayIds.length) {
      setSvgOverlays((prev) => prev.filter((o) => !selectedOverlayIds.includes(o.id)));
    }
    clearSelection();
    exitEditMode();
    scheduleProjectAutoSave();
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
    const p = svgPoint(e);

    const s = shapes.find((x) => x.id === id);
    if (s?.type === "text") {
      setSelectedIds([id]);
      setSelectedOverlayIds([]);
      setEditingId(null);
      setInlineEdit({ id, value: String(s.text || ""), kind: "shape" });
      setShowHUD(false);
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
    if (isLiveMode && target && typeof target.closest === "function") {
      if (target.closest(interactiveSelector)) return;
    }
    const nativeEvent = e.nativeEvent;
    if (isLiveMode && nativeEvent && typeof nativeEvent.composedPath === "function") {
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
    const p = svgPoint(e);

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
      beginDragAll(p, [], [id]);
      return;
    }

    exitEditMode();
    setDrawing(null);

    beginDragAll(p, selectedIds, selectedOverlayIds);
  }

  function onOverlayDoubleClick(e, id) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    const overlay = svgOverlays.find((x) => x.id === id);
    const firstText = overlay && !overlay.widget ? readFirstInnerSvgText(overlay.inner) : null;
    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    setEditingId(null);
    if (firstText != null) {
      setInlineEdit({ id, value: firstText, kind: "overlay" });
      setShowHUD(false);
      return;
    }
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
      origScaleX: overlayScaleX(o),
      origScaleY: overlayScaleY(o),
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

    const normalizedInner = inner;
    const id = uid();
    setSvgOverlays((prev) => [
      ...prev,
      {
        id,
        sourceKey: fileKey,
        name: fileKey.split("/").pop() || fileKey,
        inner: normalizedInner,
        tx,
        ty,
        scale,
        fill: DEFAULT_FILL,
        tagPath: "",
        bbox,
        ...overlayExtras,
        stroke: DEFAULT_STROKE,
        strokeMode: "preserve",
      },
    ]);

    setSelectedOverlayIds([id]);
    setSelectedIds([]);
    setImportOpen(false);
    exitEditMode();
    setShowHUD(false);
    setImportAnchor(null);
    setTool("select");
    setDrawing(null);
    scheduleProjectAutoSave();
  }

  async function handleAiInsertSvg(rawSelection) {
    const selected = String(rawSelection || "").trim();
    if (!selected) return { ok: false, error: "No SVG key provided." };
    const byExactKey = (Array.isArray(svgFiles) ? svgFiles : []).find(
      (file) => String(file?.key || "").trim().toLowerCase() === selected.toLowerCase()
    );
    const byName = (Array.isArray(svgFiles) ? svgFiles : []).find(
      (file) => String(file?.name || "").trim().toLowerCase() === selected.toLowerCase()
    );
    const target = byExactKey || byName || null;
    if (!target?.key) {
      return { ok: false, error: `SVG not found: ${selected}` };
    }
    try {
      await onPickSvg(target.key, lastContextPoint ?? undefined);
      return { ok: true, key: target.key, name: target.name || target.key };
    } catch (err) {
      return { ok: false, error: String(err?.message || "Failed to add SVG.") };
    }
  }

  function resolveSvgSelection(rawSelection) {
    const selected = String(rawSelection || "").trim();
    if (!selected) return null;
    const entries = Array.isArray(svgFiles) ? svgFiles : [];
    const byExactKey = entries.find(
      (file) => String(file?.key || "").trim().toLowerCase() === selected.toLowerCase()
    );
    const byName = entries.find(
      (file) => String(file?.name || "").trim().toLowerCase() === selected.toLowerCase()
    );
    const match = byExactKey || byName || null;
    if (!match?.key) return null;
    return {
      key: String(match.key),
      name: String(match.name || match.key.split("/").pop() || match.key),
    };
  }

  async function applyAiTagSvgBatchPlan(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const incomingTags = Array.isArray(source.tags) ? source.tags : [];
    const incomingItems = Array.isArray(source.items) ? source.items : [];
    const normalizedItems = [];
    const pushItem = (row, idx) => {
      const rawTagPath = normalizeTagValue(
        row?.tagPath || row?.tag || row?.name || incomingTags[idx] || ""
      );
      if (!rawTagPath) return;
      const rawSvg = String(row?.svgKey || row?.svgName || source?.svgKey || source?.svgName || "").trim();
      const choice = resolveSvgSelection(rawSvg);
      if (!choice) return;
      const label = String(row?.label || row?.name || rawTagPath).trim() || `Tag ${idx + 1}`;
      normalizedItems.push({
        tagPath: rawTagPath,
        label,
        svgKey: choice.key,
      });
    };

    if (incomingItems.length) {
      incomingItems.forEach((row, idx) => pushItem(row, idx));
    } else {
      incomingTags.forEach((tag, idx) =>
        pushItem({ tagPath: tag, name: String(tag || "").trim() }, idx)
      );
    }
    if (!normalizedItems.length) {
      throw new Error("No valid tags or SVG selection provided.");
    }

    const layout = source.layout && typeof source.layout === "object" ? source.layout : {};
    const count = normalizedItems.length;
    const columns = Math.max(
      1,
      Math.min(
        count,
        Number.isFinite(Number(layout.columns))
          ? Math.floor(Number(layout.columns))
          : Math.ceil(Math.sqrt(count))
      )
    );
    const cellW = Math.max(50, Number(layout.cellW) || Number(layout.targetW) || 120);
    const cellH = Math.max(40, Number(layout.cellH) || Math.round(cellW * 0.92));
    const gapX = Math.max(0, Number(layout.gapX) || 24);
    const gapY = Math.max(0, Number(layout.gapY) || 24);
    const rows = Math.max(1, Math.ceil(count / columns));
    const totalW = columns * cellW + Math.max(0, columns - 1) * gapX;
    const totalH = rows * cellH + Math.max(0, rows - 1) * gapY;
    const startX = Number.isFinite(Number(layout.startX))
      ? Number(layout.startX)
      : Math.max(8, Math.round((vbW - totalW) / 2));
    const startY = Number.isFinite(Number(layout.startY))
      ? Number(layout.startY)
      : Math.max(8, Math.round((vbH - totalH) / 2));

    const overlays = (
      await Promise.all(
        normalizedItems.map(async (item, idx) => {
          const col = idx % columns;
          const row = Math.floor(idx / columns);
          const center = {
            x: startX + col * (cellW + gapX) + cellW / 2,
            y: startY + row * (cellH + gapY) + cellH / 2,
          };
          const overlay = await buildOverlayFromKey(item.svgKey, center, cellW);
          return {
            ...overlay,
            name: item.label || overlay.name,
            tagPath: item.tagPath,
          };
        })
      )
    ).filter(Boolean);

    if (!overlays.length) throw new Error("No overlays could be created.");

    pushHistory();
    setSvgOverlays((prev) => [...prev, ...overlays]);
    setSelectedIds([]);
    setSelectedOverlayIds(overlays.map((o) => o.id));
    setTool("select");
    setDrawing(null);
    setShowHUD(false);
    scheduleProjectAutoSave();
    return { count: overlays.length };
  }

  useEffect(() => {
    const onAiMessage = (event) => {
      if (event?.origin !== window.location.origin) return;
      const data = event?.data && typeof event.data === "object" ? event.data : null;
      if (!data || data.type !== "vizi.ai.add-tag-svgs") return;
      const requestId = String(data.requestId || "");
      Promise.resolve(applyAiTagSvgBatchPlan(data.payload || {}))
        .then((result) => {
          try {
            event.source?.postMessage(
              { type: "vizi.ai.add-tag-svgs:result", requestId, ok: true, result },
              event.origin || window.location.origin
            );
          } catch {
            // ignore postMessage response failures
          }
        })
        .catch((err) => {
          try {
            event.source?.postMessage(
              {
                type: "vizi.ai.add-tag-svgs:result",
                requestId,
                ok: false,
                error: String(err?.message || "Failed to add SVG tags."),
              },
              event.origin || window.location.origin
            );
          } catch {
            // ignore postMessage response failures
          }
        });
    };
    window.addEventListener("message", onAiMessage);
    return () => window.removeEventListener("message", onAiMessage);
  }, [applyAiTagSvgBatchPlan]);

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
    setTool("select");
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
    setTool("select");
    setDrawing(null);
  }

  async function swapOverlayTemplate(overlayId, fileKey) {
    const o = overlaysRef.current.find((x) => x.id === overlayId);
    if (!o) return;
    const bb = overlayLocalBBox(overlayId);
    if (!bb) return;

    const wr = overlayWorldRect(o, bb);
    const worldX = wr.x;
    const worldY = wr.y;
    const worldW = wr.w;
    const worldH = wr.h;
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
      const wr = overlayWorldRect(o, bb);

      boxes.push({
        x: wr.x,
        y: wr.y,
        w: wr.w,
        h: wr.h,
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
    widgetTimerPreTag: "",
    widgetTimerAccTag: "",
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
        widgetTimerPreTag: "",
        widgetTimerAccTag: "",
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
          widgetTimerPreTag: String(w.timerPreTag || ""),
          widgetTimerAccTag: String(w.timerAccTag || ""),
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
          widgetTimerPreTag: "",
          widgetTimerAccTag: "",
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
      widgetTimerPreTag: "",
      widgetTimerAccTag: "",
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
    const timerPreTag = String(source.widgetTimerPreTag || "").trim();
    const timerAccTag = String(source.widgetTimerAccTag || "").trim();
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
        } else if (kind === "countdownBar" && timerAccTag) {
          nextTagPath = timerAccTag;
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
            timerPreTag,
            timerAccTag,
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
          o.id === singleId ? { ...o, stroke: c, strokeMode: "force" } : o
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

  function applyBBoxFromHud(next, options = {}) {
    const aspectLocked = options?.aspectLocked !== false;
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

      let nextScaleX = overlayScaleX(o);
      let nextScaleY = overlayScaleY(o);

      if (aspectLocked) {
        let nextScale = nextScaleX;
        if (W != null && bb.width > 0) nextScale = W / bb.width;
        if (W == null && H != null && bb.height > 0) nextScale = H / bb.height;
        if (W != null && H != null && bb.width > 0 && bb.height > 0) {
          nextScale = W / bb.width;
        }
        nextScale = Math.max(0.05, nextScale);
        nextScaleX = nextScale;
        nextScaleY = nextScale;
      } else {
        if (W != null && bb.width > 0) nextScaleX = Math.max(0.05, W / bb.width);
        if (H != null && bb.height > 0) nextScaleY = Math.max(0.05, H / bb.height);
      }

      // Make top-left match targetX/targetY using per-axis scale
      const newTx = targetX - nextScaleX * bb.x;
      const newTy = targetY - nextScaleY * bb.y;

      setSvgOverlays((prev) =>
        prev.map((x) =>
          x.id === id
            ? { ...x, tx: newTx, ty: newTy, scale: nextScaleX, scaleX: nextScaleX, scaleY: nextScaleY }
            : x
        )
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
      setSvgOverlays((prev) =>
        prev.map((o) => {
          if (!selectedOverlayIds.includes(o.id)) return o;

          const newTx = base.x + (o.tx - base.x) * sx + dx;
          const newTy = base.y + (o.ty - base.y) * sy + dy;
          const newScaleX = Math.max(0.05, overlayScaleX(o) * sx);
          const newScaleY = Math.max(0.05, overlayScaleY(o) * sy);

          return { ...o, tx: newTx, ty: newTy, scale: newScaleX, scaleX: newScaleX, scaleY: newScaleY };
        })
      );
    }
  }

  function toggleProjectModeShortcut() {
    let nextMode = normalizeProjectMode(projectMode);
    setProjectMode((prev) => {
      nextMode = prev === "live" ? "design" : "live";
      return nextMode;
    });
    setProjectModeDraft(nextMode);
    setProjectStatus(nextMode === "live" ? "Switched to Live mode" : "Switched to Design mode");
    scheduleProjectAutoSave(120);
  }

  // ---------- Mouse / Keyboard ----------
  useKeyboardShortcuts({
    disabled: isLiveMode,
    allowModeToggleWhenDisabled: true,
    toggleProjectMode: toggleProjectModeShortcut,
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

  useEffect(() => {
    if (!isLiveMode) return;
    setShowMainDrawer(false);
    setShowProjectDrawer(false);
    setShowHUD(false);
    setImportOpen(false);
    setWidgetOpen(false);
    setContextMenu(null);
    setContextSvgMenuOpen(false);
    setTool("select");
    setDrawing(null);
    setInlineEdit(null);
    setSelectedIds([]);
    setSelectedOverlayIds([]);
    exitEditMode();
  }, [isLiveMode]);

  useEffect(() => {
    if (isLiveMode) return;
    setLiveEquipmentOverlayIds([]);
    setLiveEquipmentDrawerOverlayId("");
  }, [isLiveMode]);

  useEffect(() => {
    const id = String(liveEquipmentDrawerOverlayId || "").trim();
    if (!id) return;
    const exists = liveEquipmentOverlays.some(
      (entry) => String(entry?.overlay?.id || "") === id
    );
    if (!exists) setLiveEquipmentDrawerOverlayId("");
  }, [liveEquipmentDrawerOverlayId, liveEquipmentOverlays]);

  useEffect(() => {
    if (!isLiveMode) return;
    if (projectDrawerTab !== "project") setProjectDrawerTab("project");
  }, [isLiveMode, projectDrawerTab]);

  function onLiveOverlayMouseDown(e, id) {
    const overlay = (svgOverlays || []).find((o) => String(o?.id || "") === String(id || ""));
    if (overlay?.widget) return;
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
        return typeof el.matches === "function" && el.matches(interactiveSelector);
      });
      if (hitInteractive) return;
    }
    e.stopPropagation();
    const nextId = String(id || "").trim();
    if (!nextId) return;
    setLiveEquipmentOverlayIds((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (list.some((x) => String(x || "") === nextId)) return list;
      const without = list.filter((x) => String(x || "") !== nextId);
      return [...without, nextId];
    });
  }

  useEffect(() => {
    setLiveEquipmentOverlayIds((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      if (!list.length) return list;
      const keep = list.filter((id) => {
        const overlay = (svgOverlays || []).find((o) => String(o?.id || "") === String(id || ""));
        return overlay && !overlay.widget;
      });
      return keep.length === list.length ? list : keep;
    });
    if (String(liveEquipmentDrawerOverlayId || "").trim()) {
      const drawerOverlay = (svgOverlays || []).find(
        (o) => String(o?.id || "") === String(liveEquipmentDrawerOverlayId || "")
      );
      if (drawerOverlay?.widget) setLiveEquipmentDrawerOverlayId("");
    }
  }, [svgOverlays, liveEquipmentDrawerOverlayId]);

  function closeLiveEquipmentCard(id) {
    const nextId = String(id || "").trim();
    if (!nextId) return;
    if (String(liveEquipmentDrawerOverlayId || "") === nextId) {
      setLiveEquipmentDrawerOverlayId("");
    }
    setLiveEquipmentOverlayIds((prev) => (Array.isArray(prev) ? prev.filter((x) => String(x || "") !== nextId) : []));
  }

  function onLiveEquipmentDockScroll() {
    if (liveEquipmentDockScrollRafRef.current) return;
    liveEquipmentDockScrollRafRef.current = window.requestAnimationFrame(() => {
      liveEquipmentDockScrollRafRef.current = 0;
      setLiveEquipmentDockTick((v) => v + 1);
    });
  }

  useEffect(
    () => () => {
      if (liveEquipmentDockScrollRafRef.current) {
        window.cancelAnimationFrame(liveEquipmentDockScrollRafRef.current);
        liveEquipmentDockScrollRafRef.current = 0;
      }
    },
    []
  );

  useEffect(() => {
    if (!isLiveMode || !liveEquipmentDockEntries.length) return undefined;
    const onResize = () => setLiveEquipmentDockTick((v) => v + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isLiveMode, liveEquipmentDockEntries.length]);

  useEffect(() => {
    const isTypingTarget = (target) => {
      if (!target) return false;
      const tag = String(target.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || target.isContentEditable;
    };
    const onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      if (isTypingTarget(e.target)) return;
      if (!isLiveMode) return;
      if (!liveEquipmentOverlayIds.length && !String(liveEquipmentDrawerOverlayId || "").trim()) return;
      e.preventDefault();
      if (String(liveEquipmentDrawerOverlayId || "").trim()) {
        setLiveEquipmentDrawerOverlayId("");
        return;
      }
      setLiveEquipmentOverlayIds((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        if (!list.length) return list;
        return list.slice(0, -1);
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isLiveMode, liveEquipmentOverlayIds, liveEquipmentDrawerOverlayId]);

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
        const wr = overlayWorldRect(o, bb);
        const r = {
          x: wr.x,
          y: wr.y,
          w: wr.w,
          h: wr.h,
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
      if (overlayResize?.kind === "group") {
        const anchorWorld = overlayResize.anchorWorld || { x: 0, y: 0 };
        const startDist = Math.max(1, Number(overlayResize.startDist || 1));
        const d = Math.max(1, distance(p, anchorWorld));
        const ratio = d / startDist;
        const base = Array.isArray(overlayResize.overlays) ? overlayResize.overlays : [];
        const byId = new Map(base.map((o) => [String(o.id), o]));
        setSvgOverlays((prev) =>
          prev.map((o) => {
            const rec = byId.get(String(o.id));
            if (!rec) return o;
            const sx = Math.max(0.05, Number(rec.sx || 1) * ratio);
            const sy = Math.max(0.05, Number(rec.sy || 1) * ratio);
            const tx = anchorWorld.x + (Number(rec.tx || 0) - anchorWorld.x) * ratio;
            const ty = anchorWorld.y + (Number(rec.ty || 0) - anchorWorld.y) * ratio;
            return { ...o, tx, ty, scale: sx, scaleX: sx, scaleY: sy };
          })
        );
        return;
      }
      const { id, isWidget, anchorLocal, anchorWorld, startDist, origScaleX, origScaleY } = overlayResize;
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
                  scaleX: 1,
                  scaleY: 1,
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
      const newScaleX = Math.max(0.05, origScaleX * ratio);
      const newScaleY = Math.max(0.05, origScaleY * ratio);

      const newTx = anchorWorld.x - newScaleX * anchorLocal.x;
      const newTy = anchorWorld.y - newScaleY * anchorLocal.y;

      setSvgOverlays((prev) =>
        prev.map((x) =>
          x.id === id
            ? { ...x, scale: newScaleX, scaleX: newScaleX, scaleY: newScaleY, tx: newTx, ty: newTy }
            : x
        )
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
          const worldRect = overlayWorldRect(o, bb);
          return rectsIntersect(r, worldRect);
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
    const wr = overlayWorldRect(o, bb);

    const x = wr.x;
    const y = wr.y;
    const w = wr.w;
    const h = wr.h;

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

  function getSelectedOverlayGroupBBox(ids = selectedOverlayIds) {
    const list = Array.isArray(ids) ? ids : [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let hit = 0;
    for (const id of list) {
      const o = svgOverlays.find((x) => x.id === id);
      if (!o) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      minX = Math.min(minX, wr.x);
      minY = Math.min(minY, wr.y);
      maxX = Math.max(maxX, wr.x + wr.w);
      maxY = Math.max(maxY, wr.y + wr.h);
      hit += 1;
    }
    if (!hit || !Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function onOverlayGroupHandleDown(e, corner) {
    if (tool !== "select") return;
    e.stopPropagation();
    e.preventDefault();
    if (selectedIds.length > 0 || selectedOverlayIds.length < 2) return;

    const group = getSelectedOverlayGroupBBox(selectedOverlayIds);
    if (!group) return;
    const TL = { x: group.x, y: group.y };
    const TR = { x: group.x + group.w, y: group.y };
    const BR = { x: group.x + group.w, y: group.y + group.h };
    const BL = { x: group.x, y: group.y + group.h };
    const corners = { TL, TR, BR, BL };
    const opposite = { TL: BR, TR: BL, BR: TL, BL: TR };
    const startWorld = corners[corner];
    const anchorWorld = opposite[corner];
    if (!startWorld || !anchorWorld) return;
    const startDist = Math.max(1, distance(startWorld, anchorWorld));
    const overlays = (selectedOverlayIds || [])
      .map((id) => {
        const o = svgOverlays.find((x) => x.id === id);
        if (!o) return null;
        return {
          id: o.id,
          tx: Number(o.tx || 0),
          ty: Number(o.ty || 0),
          sx: overlayScaleX(o),
          sy: overlayScaleY(o),
        };
      })
      .filter(Boolean);
    if (!overlays.length) return;
    pushHistory();
    setOverlayResize({
      kind: "group",
      anchorWorld,
      startDist,
      overlays,
    });
  }

  function overlayGroupSelectionUI() {
    if (selectedIds.length > 0 || selectedOverlayIds.length < 2) return null;
    const group = getSelectedOverlayGroupBBox(selectedOverlayIds);
    if (!group) return null;
    const x = group.x;
    const y = group.y;
    const w = group.w;
    const h = group.h;
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
          strokeDasharray="8 5"
          pointerEvents="none"
        />
        {corners.map((c) => (
          <g key={`group-resize-${c.key}`}>
            <circle cx={c.cx} cy={c.cy} r={8} fill="white" stroke="#2b6cff" strokeWidth={2} />
            <circle
              cx={c.cx}
              cy={c.cy}
              r={16}
              fill="transparent"
              style={{ cursor: "nwse-resize" }}
              onMouseDown={(e) => onOverlayGroupHandleDown(e, c.key)}
            />
          </g>
        ))}
      </g>
    );
  }

  const inlineEditPos = useMemo(() => {
    if (!inlineEdit?.id || !svgRef.current) return null;
    if (inlineEdit?.kind === "overlay") {
      const o = svgOverlays.find((x) => x.id === inlineEdit.id);
      if (!o) return null;
      const bb = overlayLocalBBox(o.id);
      if (!bb) return null;
      const wr = overlayWorldRect(o, bb);
      const rect = svgRef.current.getBoundingClientRect();
      const z = zoom || 1;
      const x = rect.left + (pan?.x || 0) + Number(wr.x || 0) * z;
      const y = rect.top + (pan?.y || 0) + Number(wr.y || 0) * z;
      const estW = Math.max(140, Number(wr.w || 0) * z - 8);
      return {
        x: x + 4,
        y: y + 4,
        fontSize: Math.max(12, 18 * z),
        fontFamily: "system-ui",
        fontWeight: "500",
        width: estW,
      };
    }
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
  }, [inlineEdit?.id, inlineEdit?.kind, shapes, svgOverlays, pan, zoom]);

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
  const isLiveMobile = isLiveMode && winW > 0 && winW <= 900;
  const showLiveIdentityChips = !isLiveMode || winW > 900;
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
    border: "1px solid var(--danger)",
    background: enabled ? "var(--danger)" : "color-mix(in srgb, var(--danger) 55%, transparent)",
    color: "var(--danger-text)",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.9,
  });
  const topMenuIconSize = 14;
  const topMenuModeButtonStyle = (active) => ({
    ...topMenuIconButtonStyle,
    border: active ? "1px solid var(--selected-border)" : topMenuTextButtonStyle.border,
    color: active ? "var(--selected-text)" : topMenuTextButtonStyle.color,
    background: active ? "var(--selected-bg)" : topMenuIconButtonStyle.background,
    boxShadow: active ? "var(--selected-shadow)" : "none",
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
  const rightDrawerHeaderPadding = "12px 14px";
  const rightDrawerBodyPadding = 14;
  const drawerContentPadding = rightDrawerBodyPadding;
  const drawerContentShellStyle = {
    height: "100%",
    overflow: "auto",
    padding: drawerContentPadding,
    boxSizing: "border-box",
  };
  const drawerTabButtonStyle = (active) => ({
    border: "none",
    borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    background: "transparent",
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderRadius: 0,
    minWidth: 0,
    height: 30,
    padding: "0 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "none",
    transition: "color 140ms ease, border-color 140ms ease, background-color 140ms ease",
  });
  const projectDrawerContentStyle = {
    flex: "1 1 auto",
    minHeight: 0,
    overflow: "auto",
    padding: "10px 14px 10px 10px",
    display: "grid",
    gap: 8,
    alignContent: "start",
  };
  const projectDrawerCardStyle = {
    display: "grid",
    gap: 8,
    padding: 10,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-elev)",
  };
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );
  const activeScreen = useMemo(() => {
    if (!Array.isArray(screens) || !screens.length) return null;
    return screens.find((s) => s.id === activeScreenId) || screens[0];
  }, [screens, activeScreenId]);
  const liveMenuGroupsForRender = useMemo(
    () => normalizeLiveMenuGroups(liveMenuGroups, screens),
    [liveMenuGroups, screens]
  );
  const liveMenuGroupsVisible = useMemo(
    () =>
      (Array.isArray(liveMenuGroupsForRender) ? liveMenuGroupsForRender : [])
        .map((group) => ({ ...group, items: Array.isArray(group?.items) ? group.items : [] }))
        .filter((group) => group.items.length > 0),
    [liveMenuGroupsForRender]
  );
  const liveMenuMobileItems = useMemo(
    () =>
      liveMenuGroupsVisible.flatMap((group) =>
        (Array.isArray(group?.items) ? group.items : []).map((item) => ({
          groupName: String(group?.name || "Group"),
          item,
        }))
      ),
    [liveMenuGroupsVisible]
  );
  const activeDatabaseTable = useMemo(() => {
    const raw = String(databaseEmbeddedPath || "").trim();
    if (!raw) return "";
    const normalized = raw.startsWith("/data/") ? raw : `/data/${raw.replace(/^\/+/, "")}`;
    const m = normalized.match(/^\/data\/([^/]+)(?:\/([^/]+))?$/i);
    if (!m) return "";
    return decodeURIComponent(String(m[1] || "")).trim();
  }, [databaseEmbeddedPath]);
  const activeMenuLabel = useMemo(() => {
    const fallback = activeScreen?.name || screenName || "None";
    if (!isLiveMode) return fallback;
    for (const group of liveMenuGroupsVisible) {
      const items = Array.isArray(group?.items) ? group.items : [];
      for (const item of items) {
        const isData = item?.type === "data";
        if (isData) {
          const configuredTable = String(item?.dataTable || "").trim();
          const isActiveData =
            showMainDrawer &&
            drawerView === "database" &&
            (configuredTable ? configuredTable === activeDatabaseTable : true);
          if (!isActiveData) continue;
          return String(item?.label || "").trim() || normalizeTableDisplayName(configuredTable) || "Data";
        }
        const screenId = String(item?.screenId || "");
        if (!screenId || screenId !== String(activeScreenId || "")) continue;
        const screen = screens.find((s) => String(s?.id || "") === screenId) || null;
        return String(item?.label || "").trim() || String(screen?.name || "Screen");
      }
    }
    return fallback;
  }, [
    activeDatabaseTable,
    activeScreen?.name,
    activeScreenId,
    drawerView,
    isLiveMode,
    liveMenuGroupsVisible,
    screenName,
    screens,
    showMainDrawer,
  ]);

  useEffect(() => {
    const valid = new Set(liveMenuGroupsVisible.map((group) => String(group.id || "")));
    setCollapsedLiveGroupIds((prev) =>
      (Array.isArray(prev) ? prev : []).filter((id) => valid.has(String(id || "")))
    );
  }, [liveMenuGroupsVisible]);

  useEffect(() => {
    if (!showMainDrawer) return;
    if (
      (drawerView === "database" && !canViewDataPages) ||
      (drawerView === "plc" && !canViewArea("plc")) ||
      ((drawerView === "opc" || drawerView === "logs" || drawerView === "diagnostics") &&
        !canViewArea("opc")) ||
      (drawerView === "tags" && !canViewArea("tags")) ||
      (drawerView === "server" && !canViewArea("server")) ||
      (drawerView === "reports" && !canViewArea("reports")) ||
      (drawerView === "ai" && !canViewArea("ai")) ||
      (drawerView === "help" && !canViewArea("help"))
    ) {
      setShowMainDrawer(false);
    }
  }, [showMainDrawer, drawerView, canViewDataPages, hasUserPermissions, user]);

  useEffect(() => {
    if (!showUserDrawer) return;
    setShowSecurityDrawer(false);
    setShowMainDrawer(false);
  }, [showUserDrawer]);

  useEffect(() => {
    if (showUserDrawer) return;
    setUserSettingsEditing(false);
    setPasswordDraft({ current: "", next: "" });
  }, [showUserDrawer]);

  useEffect(() => {
    if (!showSecurityDrawer) return;
    setShowUserDrawer(false);
    setShowMainDrawer(false);
  }, [showSecurityDrawer]);

  useEffect(() => {
    if (showSecurityDrawer) return;
    setPasswordDraft({ current: "", next: "" });
  }, [showSecurityDrawer]);

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
        showInLiveMenu: true,
      }),
    ];
    setScreens(next);
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, next);
      if (!normalized.length) return normalized;
      const firstGroup = normalized[0];
      return normalized.map((group, idx) =>
        idx === 0
          ? {
              ...group,
              items: [
                ...group.items,
                { id: `live-item-${uid()}`, type: "screen", screenId: id, label: "", restricted: false, allowedRoleIds: [] },
              ],
            }
          : group
      );
    });
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
    screensRef.current = filtered;
    if (target) {
      activeScreenIdRef.current = target.id;
      screenNameRef.current = target.name;
      shapesRef.current = target.shapes;
      overlaysRef.current = target.svgOverlays;
      vbWRef.current = target.vbW;
      vbHRef.current = target.vbH;
      panRef.current = target.pan;
      zoomRef.current = target.zoom;
    }
    setScreens(filtered);
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, filtered);
      return normalized.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !(item.type === "screen" && String(item.screenId || "") === String(committed.currentId))
        ),
      }));
    });
    if (target) hydrateScreenState(target);
    setProjectStatus(`Deleted ${removed?.name || "screen"}`);
    scheduleProjectAutoSave();
  }

  function deleteScreenById(screenId) {
    if (!projectNameEditing) return;
    const committed = commitCurrentScreenState(screens);
    if (committed.list.length <= 1) return;
    const removeId = String(screenId || "");
    if (!removeId) return;
    const removed = committed.list.find((s) => s.id === removeId);
    if (!removed) return;
    const filtered = committed.list.filter((s) => s.id !== removeId);
    const target =
      removeId === committed.currentId
        ? filtered[0] || null
        : filtered.find((s) => s.id === committed.currentId) || filtered[0] || null;
    screensRef.current = filtered;
    if (removeId === committed.currentId && target) {
      activeScreenIdRef.current = target.id;
      screenNameRef.current = target.name;
      shapesRef.current = target.shapes;
      overlaysRef.current = target.svgOverlays;
      vbWRef.current = target.vbW;
      vbHRef.current = target.vbH;
      panRef.current = target.pan;
      zoomRef.current = target.zoom;
    }
    setScreens(filtered);
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, filtered);
      return normalized.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => !(item.type === "screen" && String(item.screenId || "") === removeId)
        ),
      }));
    });
    if (removeId === committed.currentId && target) {
      hydrateScreenState(target);
    }
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

  function renameScreenById(screenId, value) {
    if (!projectNameEditing) return;
    const id = String(screenId || "");
    if (!id) return;
    const nextName = String(value ?? "");
    setScreens((prev) =>
      (Array.isArray(prev) ? prev : []).map((s) =>
        String(s?.id || "") === id ? { ...s, name: nextName } : s
      )
    );
    if (String(activeScreenId || "") === id) {
      setScreenName(nextName);
    }
    scheduleProjectAutoSave();
  }

  function addLiveMenuGroup() {
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, screens);
      return [
        ...normalized,
        {
          id: `live-group-${uid()}`,
          name: `Group ${normalized.length + 1}`,
          items: [],
        },
      ];
    });
    scheduleProjectAutoSave();
  }

  function renameLiveMenuGroup(groupId, nextName) {
    if (!projectNameEditing) return;
    const id = String(groupId || "");
    if (!id) return;
    setLiveMenuGroups((prev) =>
      normalizeLiveMenuGroups(prev, screens).map((group) =>
        group.id === id ? { ...group, name: String(nextName ?? "") } : group
      )
    );
    scheduleProjectAutoSave();
  }

  function deleteLiveMenuGroup(groupId) {
    if (!projectNameEditing) return;
    const id = String(groupId || "");
    if (!id) return;
    setLiveMenuGroups((prev) => {
      const normalized = normalizeLiveMenuGroups(prev, screens);
      const remaining = normalized.filter((group) => group.id !== id);
      return remaining.length ? remaining : defaultLiveMenuGroupsFromScreens(screens);
    });
    scheduleProjectAutoSave();
  }

  function addLiveMenuItem(groupId, type = "screen") {
    const id = String(groupId || "");
    if (!id) return;
    const normalizedType = String(type || "").toLowerCase() === "data" ? "data" : "screen";
    if (!projectNameEditing && normalizedType !== "screen") return;
    setLiveMenuGroups((prev) =>
      normalizeLiveMenuGroups(prev, screens).map((group) => {
        if (group.id !== id) return group;
        const screenId = screens[0]?.id || "";
        const item =
          normalizedType === "data"
            ? {
                id: `live-item-${uid()}`,
                type: "data",
                dataTable: String(databaseTablesForMenu[0] || "").trim(),
                label: "",
                restricted: false,
                allowedRoleIds: [],
              }
            : { id: `live-item-${uid()}`, type: "screen", screenId, label: "", restricted: false, allowedRoleIds: [] };
        return { ...group, items: [...group.items, item] };
      })
    );
    scheduleProjectAutoSave();
  }

  function updateLiveMenuItem(groupId, itemId, patch = {}) {
    if (!projectNameEditing) return;
    const gId = String(groupId || "");
    const iId = String(itemId || "");
    if (!gId || !iId) return;
    setLiveMenuGroups((prev) =>
      normalizeLiveMenuGroups(prev, screens).map((group) => {
        if (group.id !== gId) return group;
        return {
          ...group,
          items: group.items.map((item) => {
            if (item.id !== iId) return item;
            const nextType = String(patch?.type || item.type || "").toLowerCase() === "data" ? "data" : "screen";
            if (nextType === "data") {
              return {
                id: item.id,
                type: "data",
                dataTable: String(patch?.dataTable ?? item.dataTable ?? "").trim(),
                label: String(patch?.label ?? item.label ?? "").trim(),
                restricted: Boolean(patch?.restricted ?? item?.restricted),
                allowedRoleIds: normalizeRoleIdList(patch?.allowedRoleIds ?? item?.allowedRoleIds),
              };
            }
            const fallbackScreenId = screens[0]?.id || "";
            const screenId = String(patch?.screenId ?? item.screenId ?? fallbackScreenId);
            return {
              id: item.id,
              type: "screen",
              screenId: screens.some((s) => s.id === screenId) ? screenId : fallbackScreenId,
              label: String(patch?.label ?? item.label ?? "").trim(),
              restricted: Boolean(patch?.restricted ?? item?.restricted),
              allowedRoleIds: normalizeRoleIdList(patch?.allowedRoleIds ?? item?.allowedRoleIds),
            };
          }),
        };
      })
    );
    scheduleProjectAutoSave();
  }

  function deleteLiveMenuItem(groupId, itemId) {
    if (!projectNameEditing) return;
    const gId = String(groupId || "");
    const iId = String(itemId || "");
    if (!gId || !iId) return;
    setLiveMenuGroups((prev) =>
      normalizeLiveMenuGroups(prev, screens).map((group) =>
        group.id === gId ? { ...group, items: group.items.filter((item) => item.id !== iId) } : group
      )
    );
    scheduleProjectAutoSave();
  }

  function moveLiveMenuItem(groupId, itemId, delta) {
    if (!projectNameEditing) return;
    const gId = String(groupId || "");
    const iId = String(itemId || "");
    if (!gId || !iId || !Number.isInteger(delta) || delta === 0) return;
    setLiveMenuGroups((prev) =>
      normalizeLiveMenuGroups(prev, screens).map((group) => {
        if (group.id !== gId) return group;
        const index = group.items.findIndex((item) => item.id === iId);
        if (index < 0) return group;
        const target = index + delta;
        if (target < 0 || target >= group.items.length) return group;
        const nextItems = [...group.items];
        const [item] = nextItems.splice(index, 1);
        nextItems.splice(target, 0, item);
        return { ...group, items: nextItems };
      })
    );
    scheduleProjectAutoSave();
  }

  function activateLiveMenuItem(item) {
    if (!item || typeof item !== "object") return;
    if (!canAccessLiveMenuItem(item)) {
      const roleRestricted = isLiveMenuItemRoleRestricted(item);
      toastError(
        roleRestricted
          ? "This menu item is locked for your role."
          : "You do not have permission to open this page."
      );
      return;
    }
    if (item.type === "data") {
      const table = String(item.dataTable || "").trim();
      if (table) {
        openDrawer("database", {
          forceDatabaseDataTab: true,
          databasePath: `/data/${encodeURIComponent(table)}`,
        });
        return;
      }
      openDrawer("database", { forceDatabaseDataTab: true });
      return;
    }
    const screenId = String(item.screenId || "");
    if (!screenId) return;
    switchToScreen(screenId);
  }

  function toggleLiveMenuGroupCollapse(groupId) {
    const id = String(groupId || "");
    if (!id) return;
    setCollapsedLiveGroupIds((prev) => {
      const list = Array.isArray(prev) ? prev : [];
      return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    });
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
  const projectDrawerInsetPx = showProjectDrawer && !projectDrawerFullscreen ? Math.round(drawerSizes.project.w) : 0;
  const projectDrawerInset = `${projectDrawerInsetPx}px`;
  const liveMenuIsExpanded = !liveMenuCollapsed;
  const liveMenuExpandedWidthPx = isLiveMode
    ? isLiveMobile
      ? Math.min(220, Math.max(176, Math.floor(winW * 0.62)))
      : 248
    : 0;
  const liveMenuCollapsedWidthPx = isLiveMode ? (isLiveMobile ? 54 : 72) : 0;
  const liveMenuRailWidthPx = isLiveMode
    ? (isLiveMobile ? 0 : liveMenuIsExpanded ? liveMenuExpandedWidthPx : liveMenuCollapsedWidthPx)
    : 0;
  const liveCanvasMenuGapPx = isLiveMode ? (isLiveMobile ? 6 : 10) : 0;
  const liveBottomCarouselHeightPx = isLiveMode && isLiveMobile ? 84 : 0;
  const liveEquipmentDrawerWidthPx =
    isLiveMode && liveEquipmentDrawerEntry ? 360 : 0;
  const canvasLeftInsetBasePx =
    projectDrawerInsetPx + liveMenuRailWidthPx + liveEquipmentDrawerWidthPx;
  const canvasLeftInsetPx = canvasLeftInsetBasePx + liveCanvasMenuGapPx;
  const mainDrawerAppendFromLeft =
    isLiveMode && drawerView === "database" && databaseDataOnlyMode;
  const mainDrawerAppendLeftPx =
    projectDrawerInsetPx + liveMenuRailWidthPx + liveEquipmentDrawerWidthPx;
  const liveAlarmBarOffset = isLiveMode ? LIVE_ALARM_BAR_H : 0;
  const previousCanvasLeftInsetRef = useRef(canvasLeftInsetBasePx);
  const [liveAlarmOccurredAtById, setLiveAlarmOccurredAtById] = useState({});
  const liveActiveAlarmsWithOccurred = useMemo(
    () =>
      (liveActiveAlarms || []).map((alarm) => ({
        ...alarm,
        occurredAt: Number(liveAlarmOccurredAtById?.[alarm.id] || alarm?.occurredAt || 0),
      })),
    [liveActiveAlarms, liveAlarmOccurredAtById]
  );
  const hasLiveAlarms = liveActiveAlarmsWithOccurred.length > 0;
  const liveAlarmMarqueeItems = useMemo(() => {
    return (liveActiveAlarmsWithOccurred || []).map((alarm) => {
      const at =
        Number(alarm?.occurredAt || 0) > 0
          ? new Date(alarm.occurredAt).toLocaleString()
          : "";
      return {
        id: String(alarm.id || ""),
        label: `${alarm.label}: ${alarm.value} ${alarm.operator} ${alarm.threshold}`,
        at,
        title: `${alarm.topic ? `${alarm.topic} • ` : ""}${alarm.label}: ${alarm.value} ${alarm.operator} ${alarm.threshold}${at ? ` • ${at}` : ""}`,
      };
    });
  }, [liveActiveAlarmsWithOccurred]);
  const [liveAlarmMarqueeDurationSec, setLiveAlarmMarqueeDurationSec] = useState(
    LIVE_ALARM_MARQUEE_DURATION_SEC
  );
  const useLightLiveDataSurface = isLiveMode && databaseDataOnlyMode && theme !== "dark";
  const alarmDatabasePath = useMemo(() => {
    const list = Array.isArray(databaseTablesForMenu) ? databaseTablesForMenu : [];
    const lowered = list.map((t) => String(t || "").trim()).filter(Boolean);
    const exactOpcAlarmState = lowered.find((t) => t.toLowerCase() === "opc_alarm_state");
    if (exactOpcAlarmState) return exactOpcAlarmState;
    const exactAlarms = lowered.find((t) => t.toLowerCase() === "alarms");
    if (exactAlarms) return exactAlarms;
    const containsAlarm = lowered.find((t) => t.toLowerCase().includes("alarm"));
    if (containsAlarm) return containsAlarm;
    return "opc_alarm_state";
  }, [databaseTablesForMenu]);
  const projectDrawerTabs = isLiveMode
    ? [{ key: "project", label: "Project", title: "Project Settings" }]
    : [
        { key: "project", label: "Project", title: "Project Settings" },
        { key: "menu", label: "Menu", title: "Menu Config" },
        { key: "screens", label: "Screens", title: "Manage Screens" },
      ];

  useEffect(() => {
    const activeIds = new Set((liveActiveAlarms || []).map((a) => String(a?.id || "")).filter(Boolean));
    const byIdOccurred = new Map(
      (liveActiveAlarms || [])
        .map((a) => [String(a?.id || ""), Number(a?.occurredAt || 0)])
        .filter(([id]) => !!id)
    );
    const now = Date.now();
    setLiveAlarmOccurredAtById((prev) => {
      const next = {};
      let changed = false;
      activeIds.forEach((id) => {
        const existing = Number(prev?.[id] || 0);
        if (existing > 0) {
          next[id] = existing;
          return;
        }
        const fromAlarm = Number(byIdOccurred.get(id) || 0);
        if (fromAlarm > 0) {
          next[id] = fromAlarm;
          changed = true;
          return;
        }
        next[id] = now;
        changed = true;
      });
      const prevKeys = Object.keys(prev || {});
      if (!changed && prevKeys.length === Object.keys(next).length) return prev;
      return next;
    });
  }, [liveActiveAlarms]);

  useEffect(() => {
    const prev = Number(previousCanvasLeftInsetRef.current || 0);
    const next = Number(canvasLeftInsetBasePx || 0);
    const dx = next - prev;
    previousCanvasLeftInsetRef.current = next;
    if (!Number.isFinite(dx) || Math.abs(dx) < 0.01) return;
    setPan((p) => ({
      x: Number((p?.x || 0) + dx),
      y: Number(p?.y || 0),
    }));
  }, [canvasLeftInsetBasePx]);

  useEffect(() => {
    const viewport = liveAlarmMarqueeViewportRef.current;
    const track = liveAlarmMarqueeTrackRef.current;
    if (!viewport || !track || !hasLiveAlarms) {
      setLiveAlarmMarqueeDurationSec(LIVE_ALARM_MARQUEE_DURATION_SEC);
      return undefined;
    }

    const pxPerSec = 52; // keep scroll speed visually constant
    const compute = () => {
      const total = Number(track.scrollWidth || 0);
      // track is rendered as three identical segments (group+gap x3)
      const oneLoopDistance = total > 0 ? total / 3 : 0;
      if (!Number.isFinite(oneLoopDistance) || oneLoopDistance <= 0) return;
      const next = Math.max(18, Math.min(240, oneLoopDistance / pxPerSec));
      setLiveAlarmMarqueeDurationSec((prev) =>
        Math.abs(Number(prev || 0) - next) >= 0.25 ? next : prev
      );
    };

    compute();
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(viewport);
    ro.observe(track);
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [hasLiveAlarms, liveAlarmMarqueeItems, theme]);

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
        paddingTop: TOP_BAR_H + liveAlarmBarOffset,
        paddingLeft: `${canvasLeftInsetPx}px`,
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
        @keyframes live-menu-arrow-pulse {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(2px); }
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
        svgLibrary={svgLibraryMap}
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
          viewportTopOffset={TOP_BAR_H + liveAlarmBarOffset}
          viewportLeftOffset={canvasLeftInsetPx}
          liveClickable={isLiveMode}
          zoom={zoom}          // ✅ NEW
          onWheel={onWheelZoom} // ✅ NEW
          vbW={vbW}
          vbH={vbH}
          tool={isLiveMode ? "select" : tool}
          shapes={shapes}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          setSelectedOverlayIds={setSelectedOverlayIds}
          inlineEditId={inlineEdit?.id || null}
          selectedSegment={selectedSegment}
          editingId={editingId}
        showTagPaths={showTagPaths}
        showGrid={!isLiveMode && showGrid}
        showRulers={!isLiveMode}
        onSvgMouseDown={isLiveMode ? () => {} : onSvgMouseDown}
        onMouseMove={isLiveMode ? () => {} : onMouseMove}
        onMouseUp={isLiveMode ? () => {} : onMouseUp}
        onContextMenu={isLiveMode ? undefined : onContextMenu}
        onShapeMouseDown={isLiveMode ? () => {} : onShapeMouseDown}
        onShapeDoubleClick={isLiveMode ? () => {} : onShapeDoubleClick}
        onEditPolylineClick={isLiveMode ? () => {} : onEditPolylineClick}
        onHandleMouseDown={isLiveMode ? () => {} : onHandleMouseDown}
        onHandleDoubleClick={isLiveMode ? () => {} : onHandleDoubleClick}
        onHandleContextMenu={isLiveMode ? undefined : onHandleContextMenu}
        onSegmentMouseDown={isLiveMode ? () => {} : onSegmentMouseDown}
        setShapes={setShapes}
        svgOverlays={svgOverlays}
        setSvgOverlays={setSvgOverlays}
        selectedOverlayIds={selectedOverlayIds}
        singleSelectedOverlayId={singleSelectedOverlayId}
        setOverlayRef={setOverlayRef}
        onOverlayMouseDown={isLiveMode ? onLiveOverlayMouseDown : onOverlayMouseDown}
        onOverlayDoubleClick={isLiveMode ? onLiveOverlayMouseDown : onOverlayDoubleClick}
        overlaySelectionUI={overlaySelectionUI}
        overlayGroupSelectionUI={overlayGroupSelectionUI}
        overlayLocalBBox={overlayLocalBBox}
        marquee={marquee}
        pan={pan}
        importAnchor={importAnchor}
        onSvgDoubleClick={isLiveMode ? undefined : onSvgDoubleClick}
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

      {isLiveMode && liveEquipmentDrawerEntry ? (
        <div
          style={{
            position: "fixed",
            left: projectDrawerInsetPx + liveMenuRailWidthPx + 8,
            top: TOP_BAR_H + liveAlarmBarOffset + 8,
            bottom: 8,
            width: liveEquipmentDrawerWidthPx - 16,
            zIndex: 208,
            pointerEvents: "auto",
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "var(--bg-elev)",
            boxShadow: "0 16px 32px rgba(2,8,23,0.22)",
            display: "grid",
            gridTemplateRows: "auto auto 1fr",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 10px 8px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
              {String(liveEquipmentDrawerEntry.overlay?.name || "Equipment")}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setLiveEquipmentDrawerOverlayId("")}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  borderRadius: 7,
                  padding: "2px 8px",
                  cursor: "pointer",
                  color: "var(--text)",
                  fontSize: 11,
                  fontWeight: 700,
                }}
                title="Return to bottom dock"
              >
                Dock
              </button>
              <button
                onClick={() => closeLiveEquipmentCard(liveEquipmentDrawerEntry.overlay?.id)}
                style={{
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  borderRadius: 7,
                  padding: "2px 6px",
                  cursor: "pointer",
                  color: "var(--text)",
                  fontSize: 11,
                }}
                aria-label="Close equipment info"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>
          <div style={{ padding: "8px 10px 0", display: "grid", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Tag Path: {String(liveEquipmentDrawerEntry.overlay?.tagPath || "-")}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Overlay ID: {String(liveEquipmentDrawerEntry.overlay?.id || "-")}
            </div>
          </div>
          <div className="vizi-scroll" style={{ overflow: "auto", padding: "8px 10px 10px", display: "grid", gap: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>Live Data</div>
            {Array.isArray(liveEquipmentDrawerEntry.details) &&
            liveEquipmentDrawerEntry.details.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 10px", fontSize: 11 }}>
                {liveEquipmentDrawerEntry.details.map((row, idx) => (
                  <Fragment key={`live-equipment-drawer-row-${liveEquipmentDrawerEntry.overlay?.id}-${idx}`}>
                    <div style={{ color: "var(--text-muted)" }}>{row.key}</div>
                    <div style={{ color: "var(--text)", fontWeight: 700, textAlign: "right" }}>{row.value}</div>
                  </Fragment>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                No live values found for this equipment.
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isLiveMode && liveEquipmentDockEntries.length > 0 ? (
        <div
          style={{
            position: "fixed",
            left: projectDrawerInsetPx + liveMenuRailWidthPx + liveEquipmentDrawerWidthPx + 10,
            right: 10,
            bottom: 10,
            zIndex: 205,
            pointerEvents: "none",
          }}
        >
          {liveEquipmentConnectorLines.length ? (
            <svg
              style={{
                position: "fixed",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: 204,
                overflow: "visible",
              }}
            >
              {liveEquipmentConnectorLines.map((line) => {
                const midY = line.toY - 26;
                const d = `M ${line.fromX} ${line.fromY} C ${line.fromX} ${midY}, ${line.toX} ${midY}, ${line.toX} ${line.toY}`;
                return (
                  <g key={`live-eq-link-${line.id}`}>
                    <path d={d} fill="none" stroke="rgba(43,108,255,0.24)" strokeWidth="6" strokeLinecap="round" />
                    <path d={d} fill="none" stroke="rgba(255,255,255,0.62)" strokeWidth="1.3" strokeLinecap="round" />
                    <circle cx={line.fromX} cy={line.fromY} r="3.2" fill="rgba(43,108,255,0.8)" />
                  </g>
                );
              })}
            </svg>
          ) : null}
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="vizi-live-equipment-dock vizi-scroll"
            style={{
              display: "flex",
              gap: 10,
              overflowX: "auto",
              overflowY: "hidden",
              paddingBottom: 2,
              pointerEvents: "auto",
              scrollSnapType: "x mandatory",
            }}
            onScroll={onLiveEquipmentDockScroll}
          >
            {liveEquipmentDockEntries.map(({ overlay, details }) => (
              <div
                key={`live-equipment-card-${overlay.id}`}
                ref={(node) => {
                  const id = String(overlay.id || "");
                  if (!id) return;
                  if (node) liveEquipmentCardRefs.current.set(id, node);
                  else liveEquipmentCardRefs.current.delete(id);
                }}
                style={{
                  scrollSnapAlign: "start",
                  flex: "0 0 min(300px, 68vw)",
                  maxHeight: "34vh",
                  overflow: "auto",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-elev)",
                  boxShadow: "0 12px 26px rgba(0,0,0,0.28)",
                  padding: 9,
                  display: "grid",
                  gap: 6,
                }}
                className="vizi-scroll"
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                    {String(overlay.name || "Equipment")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => setLiveEquipmentDrawerOverlayId(String(overlay.id || ""))}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        borderRadius: 7,
                        cursor: "pointer",
                        color: "var(--text)",
                        fontSize: 11,
                        width: 26,
                        height: 24,
                        display: "grid",
                        placeItems: "center",
                        padding: 0,
                      }}
                      title="Expand to left drawer"
                      aria-label="Expand to left drawer"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => closeLiveEquipmentCard(overlay.id)}
                      style={{ border: "1px solid var(--border)", background: "var(--bg)", borderRadius: 7, padding: "2px 6px", cursor: "pointer", color: "var(--text)", fontSize: 11 }}
                      aria-label="Close equipment info"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Tag Path: {String(overlay.tagPath || "-")}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Overlay ID: {String(overlay.id || "-")}
                </div>
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 5, color: "var(--text)" }}>Live Data</div>
                  {details.length ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 8px", fontSize: 10 }}>
                      {details.map((row, idx) => (
                        <Fragment key={`live-equipment-row-${overlay.id}-${idx}`}>
                          <div style={{ color: "var(--text-muted)" }}>{row.key}</div>
                          <div style={{ color: "var(--text)", fontWeight: 700, textAlign: "right" }}>{row.value}</div>
                        </Fragment>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>No live values found for this equipment.</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!isLiveMode && inlineEdit && inlineEditPos && (
        <input
          autoFocus
          value={inlineEdit.value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setInlineEdit((p) => ({ ...p, value: e.target.value }))}
          onBlur={() => {
            const next = inlineEdit.value;
            if (next != null) {
              pushHistory();
              if (inlineEdit.kind === "overlay") {
                setSvgOverlays((prev) =>
                  prev.map((x) =>
                    x.id === inlineEdit.id
                      ? { ...x, inner: writeFirstInnerSvgText(x.inner, String(next)) }
                      : x
                  )
                );
              } else {
                setShapes((prev) =>
                  prev.map((x) => (x.id === inlineEdit.id ? { ...x, text: String(next) } : x))
                );
              }
              scheduleProjectAutoSave();
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
            left: isLiveMode ? undefined : Math.max(zoomPos.x, 8),
            right: isLiveMode ? 72 : undefined,
            bottom: 16,
            zIndex: 80,
            boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
            display: "flex",
            flexDirection: isLiveMode ? "row" : "column",
            gap: isLiveMode ? 4 : 6,
            padding: isLiveMode ? "6px 8px" : 8,
            background: "color-mix(in srgb, var(--bg-elev) 92%, transparent)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            alignItems: "center",
          }}
          onMouseDown={isLiveMode ? undefined : startZoomDrag}
          onPointerDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {/* Zoom buttons */}
          {[
            { label: "+", onClick: zoomIn, title: "Zoom In" },
            { label: "−", onClick: zoomOut, title: "Zoom Out" },
            { label: "⟲", onClick: resetView, title: "Reset View" },
            {
              label: isAppFullscreen ? "⤢" : "⛶",
              onClick: toggleAppFullscreen,
              title: isAppFullscreen ? "Exit Full Screen" : "Full Screen",
            },
          ].map((btn) => (
            <button
              key={btn.title}
              title={btn.title}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={btn.onClick}
              style={{
                width: isLiveMode ? 30 : 34,
                height: isLiveMode ? 30 : 34,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                cursor: "pointer",
                boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
                color: "var(--text)",
                display: "grid",
                placeItems: "center",
                padding: 0,
                fontSize: isLiveMode ? 14 : 16,
                lineHeight: 1,
              }}
            >
              {btn.label}
            </button>
          ))}

          {/* zoom % */}
          <div
            style={{
              fontSize: isLiveMode ? 11 : 12,
              opacity: 0.7,
              marginTop: isLiveMode ? 0 : 2,
              marginLeft: isLiveMode ? 4 : 0,
              marginRight: isLiveMode ? 2 : 0,
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
              width: isLiveMode ? 30 : 34,
              height: isLiveMode ? 30 : 34,
              marginTop: isLiveMode ? 0 : 6,
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
              cursor: "pointer",
              boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
              color: "var(--text)",
              display: "grid",
              placeItems: "center",
              padding: 0,
              fontSize: isLiveMode ? 12 : 14,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {!isLiveMode && contextMenu && (
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
            top: TOP_BAR_H + (isLiveMode ? liveAlarmBarOffset : 0),
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 220,
            pointerEvents: mainDrawerAppendFromLeft ? "none" : "auto",
          }}
        >
          <div
            ref={mainDrawerRef}
            style={{
              position: "absolute",
              right: mainDrawerFullscreen || mainDrawerAppendFromLeft ? undefined : 0,
              left: mainDrawerFullscreen
                ? (mainDrawerAppendFromLeft ? mainDrawerAppendLeftPx : 0)
                : mainDrawerAppendFromLeft
                ? mainDrawerAppendLeftPx
                : undefined,
              top: 0,
              height: "100%",
              width: mainDrawerFullscreen
                ? (mainDrawerAppendFromLeft
                    ? `calc(100% - ${mainDrawerAppendLeftPx}px)`
                    : "100%")
                : `${Math.round(drawerSizes.main.w)}px`,
              background: "var(--bg-soft)",
              boxShadow:
                mainDrawerFullscreen || mainDrawerAppendFromLeft
                  ? "none"
                  : "-24px 0 48px rgba(0,0,0,0.34), -8px 0 20px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              borderLeft: mainDrawerFullscreen || mainDrawerAppendFromLeft ? "none" : "1px solid var(--border)",
              borderRight: mainDrawerAppendFromLeft ? "1px solid var(--border)" : "none",
              color: "var(--text)",
              transform: "translate(0px, 0px)",
              animation: mainDrawerAppendFromLeft
                ? "drawer-slide-in-left 220ms ease-out"
                : "drawer-slide-in-right 220ms ease-out",
              pointerEvents: "auto",
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                padding: rightDrawerHeaderPadding,
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
                    ? (isLiveMode && databaseDataOnlyMode
                        ? (normalizeTableDisplayName(activeDatabaseTable) || "Data")
                        : "Database")
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
              <Suspense
                fallback={
                  <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--text-muted)" }}>
                    Loading...
                  </div>
                }
              >
              {drawerView === "tags" ? (
                <div style={drawerContentShellStyle}>
                  <OpcConfig embedded mode="tags" />
                </div>
              ) : drawerView === "logs" ? (
                <div style={drawerContentShellStyle}>
                  <OpcConfig embedded mode="logs" onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "diagnostics" ? (
                <div style={drawerContentShellStyle}>
                  <OpcConfig embedded mode="diagnostics" onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "opc" ? (
                <div style={drawerContentShellStyle}>
                  <OpcConfig embedded onDrawerViewChange={setDrawerView} />
                </div>
              ) : drawerView === "help" ? (
                <div style={{ height: "100%", overflow: "hidden", padding: drawerContentPadding, boxSizing: "border-box" }}>
                  <HelpPanel inline onClose={() => setShowMainDrawer(false)} />
                </div>
              ) : drawerView === "plc" ? (
                <div style={drawerContentShellStyle}>
                  <PlcAnalyzer
                    plcItems={projectPlcs}
                    onChange={setProjectPlcs}
                    svgCatalog={aiSvgCatalog}
                    onInsertSvg={handleAiInsertSvg}
                  />
                </div>
              ) : drawerView === "server" ? (
                <div style={drawerContentShellStyle}>
                  <ServerDiagnosticsPanel embedded />
                </div>
              ) : drawerView === "database" ? (
                <div
                  style={{
                    ...drawerContentShellStyle,
                    background: useLightLiveDataSurface ? "#ffffff" : "var(--bg-soft)",
                  }}
                >
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    minHeight: 0,
                    background: useLightLiveDataSurface ? "#ffffff" : "var(--bg-soft)",
                  }}
                >
                  {!databaseDataOnlyMode ? (
                    <div style={{ display: "flex", gap: 8, padding: `10px ${drawerContentPadding}px`, borderBottom: "1px solid var(--border)", background: "var(--bg-elev)" }}>
	                      <button
	                        data-preserve-style="true"
	                        onClick={() => setDatabaseTab("data")}
	                        style={drawerTabButtonStyle(databaseTab === "data")}
	                        title="Data"
	                      >
	                        Data
	                      </button>
	                      <button
	                        data-preserve-style="true"
	                        onClick={() => setDatabaseTab("dataset")}
	                        style={drawerTabButtonStyle(databaseTab === "dataset")}
	                        title="Dataset"
	                      >
	                        Dataset
	                      </button>
	                      <button
	                        data-preserve-style="true"
	                        onClick={() => setDatabaseTab("config")}
	                        style={drawerTabButtonStyle(databaseTab === "config")}
	                        title="Config"
	                      >
	                        Config
	                      </button>
	                      <button
	                        data-preserve-style="true"
	                        onClick={() => setDatabaseTab("designer")}
	                        style={drawerTabButtonStyle(databaseTab === "designer")}
	                        title="Designer"
	                      >
	                        Designer
	                      </button>
                    </div>
                  ) : null}
                  <div style={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}>
                    {databaseDataOnlyMode ? (
                      <DataBrowser
                        embedded
                        embeddedPath={databaseEmbeddedPath}
                        hideTableSelector={isLiveMode && databaseDataOnlyMode}
                        hideListFieldControls={isLiveMode && databaseDataOnlyMode}
                        useWhiteBackground={useLightLiveDataSurface}
                      />
                    ) : databaseTab === "dataset" ? (
                      <DatasetBuilder embedded />
                    ) : databaseTab === "designer" ? (
                      <SqlDesigner embedded selectedTableHint={activeDatabaseTable} />
                    ) : databaseTab === "config" ? (
                      <DatabaseConfigPanel embedded />
                    ) : (
                      <DataBrowser
                        embedded
                        embeddedPath={databaseEmbeddedPath}
                        hideTableSelector={isLiveMode && databaseDataOnlyMode}
                        hideListFieldControls={isLiveMode && databaseDataOnlyMode}
                        useWhiteBackground={useLightLiveDataSurface}
                      />
                    )}
                  </div>
                </div>
                </div>
              ) : drawerView === "reports" ? (
                <div style={drawerContentShellStyle}>
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      overflow: "hidden",
                      background: "var(--bg-elev)",
                    }}
                  >
                    <iframe
                      key={`drawer-reports-${theme}`}
                      title="Report Designer"
                      src={`/report-designer?theme=${theme}`}
                      style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                    />
                  </div>
                </div>
              ) : (
                <iframe
                  key={`drawer-ai-${theme}`}
                  title="AI"
                  src={`/ai?theme=${theme}`}
                  style={{ width: "100%", height: "100%", border: "none", display: "block" }}
                />
              )}
              </Suspense>
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
            top: TOP_BAR_H + (isLiveMode ? liveAlarmBarOffset : 0),
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 220,
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
              background: "var(--bg-soft)",
              boxShadow: "-24px 0 48px rgba(0,0,0,0.34), -8px 0 20px rgba(0,0,0,0.18)",
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
                padding: rightDrawerHeaderPadding,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elev)",
                gap: 10,
                cursor: "default",
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "0.02em" }}>
                  User Settings
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Profile and session preferences
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
            <div
              style={{
                flex: "1 1 auto",
                overflow: "auto",
                padding: rightDrawerBodyPadding,
                scrollbarGutter: "stable both-edges",
                display: "grid",
                gap: 12,
                alignContent: "start",
              }}
            >
              <div
                style={{
                  width: "100%",
                  maxWidth: 1120,
                  boxSizing: "border-box",
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4, minWidth: 0, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                    Display Name
                    <input
                      value={profileDraft.display_name}
                      onChange={(e) =>
                        setProfileDraft((p) => ({ ...p, display_name: e.target.value }))
                      }
                      readOnly={!userSettingsEditing}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        minHeight: 32,
                        fontSize: 12,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                        opacity: userSettingsEditing ? 1 : 0.82,
                        cursor: userSettingsEditing ? "text" : "default",
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, minWidth: 0, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                    Username
                    <input
                      value={profileDraft.username}
                      onChange={(e) => setProfileDraft((p) => ({ ...p, username: e.target.value }))}
                      readOnly={!userSettingsEditing}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        minHeight: 32,
                        fontSize: 12,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                        opacity: userSettingsEditing ? 1 : 0.82,
                        cursor: userSettingsEditing ? "text" : "default",
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
                    readOnly={!userSettingsEditing}
                    placeholder="https://..."
                    style={{
                      border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                      borderRadius: 8,
                      padding: "6px 8px",
                      minHeight: 32,
                      fontSize: 12,
                      background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                      color: "var(--text)",
                      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      opacity: userSettingsEditing ? 1 : 0.82,
                      cursor: userSettingsEditing ? "text" : "default",
                    }}
                  />
                </label>
              </div>

              <div
                style={{
                  width: "100%",
                  maxWidth: 1120,
                  boxSizing: "border-box",
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4, minWidth: 0, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                    Current Password
                    <input
                      type="password"
                      value={passwordDraft.current}
                      onChange={(e) => setPasswordDraft((p) => ({ ...p, current: e.target.value }))}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        minHeight: 32,
                        fontSize: 12,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, minWidth: 0, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                    New Password
                    <input
                      type="password"
                      value={passwordDraft.next}
                      onChange={(e) => setPasswordDraft((p) => ({ ...p, next: e.target.value }))}
                      style={{
                        border: "1px solid color-mix(in srgb, var(--border) 80%, white 20%)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        minHeight: 32,
                        fontSize: 12,
                        background: "color-mix(in srgb, var(--bg) 90%, var(--bg-elev) 10%)",
                        color: "var(--text)",
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                      }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => void saveSecurityPassword()}
                    style={{
                      border: "1px solid #2f6dff",
                      background: "linear-gradient(180deg, #3a7bff 0%, #2b6cff 100%)",
                      color: "white",
                      borderRadius: 8,
                      padding: "6px 12px",
                      minHeight: 32,
                      minWidth: 102,
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 700,
                      boxShadow: "0 8px 16px rgba(43,108,255,0.32)",
                    }}
                  >
                    Update
                  </button>
                </div>
              </div>

              <div
                style={{
                  width: "100%",
                  maxWidth: 1120,
                  boxSizing: "border-box",
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
                    borderRadius: 8,
                    padding: "6px 10px",
                    minHeight: 32,
                    minWidth: 86,
                    fontSize: 11,
                    cursor: "pointer",
                    fontWeight: 700,
                    boxShadow: "0 8px 16px rgba(240,68,56,0.35)",
                  }}
                >
                  Logout
                </button>
              </div>
            </div>
            <div
              style={{
                borderTop: "1px solid var(--border)",
                background: "var(--bg-elev)",
                padding: "12px 14px",
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              {userSettingsEditing ? (
                <button
                  onClick={cancelUserSettingsEdit}
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    minHeight: 34,
                    minWidth: 92,
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  Cancel
                </button>
              ) : null}
              <button
                onClick={() => {
                  if (!userSettingsEditing) {
                    beginUserSettingsEdit();
                    return;
                  }
                  void saveUserSettingsEdit();
                }}
                style={{
                  border: "1px solid #2f6dff",
                  background: "linear-gradient(180deg, #3a7bff 0%, #2b6cff 100%)",
                  color: "white",
                  borderRadius: 8,
                  padding: "8px 12px",
                  minHeight: 34,
                  minWidth: 110,
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: 700,
                  boxShadow: "0 8px 18px rgba(43,108,255,0.32)",
                }}
              >
                {userSettingsEditing ? "Save" : "Edit"}
              </button>
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

      {showSecurityDrawer && (
        <div
          style={{
            position: "fixed",
            top: TOP_BAR_H + (isLiveMode ? liveAlarmBarOffset : 0),
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 220,
          }}
        >
          <div
            style={{
              position: "absolute",
              right: 0,
              left: userDrawerFullscreen ? 0 : undefined,
              top: 0,
              height: "100%",
              width: userDrawerFullscreen ? "100%" : `${Math.round(drawerSizes.user.w)}px`,
              background: "var(--bg-soft)",
              boxShadow: "-24px 0 48px rgba(0,0,0,0.34), -8px 0 20px rgba(0,0,0,0.18)",
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
                padding: rightDrawerHeaderPadding,
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-elev)",
                gap: 10,
                cursor: "default",
              }}
            >
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "0.02em" }}>
                  Security
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Users, roles and access areas
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
                  onClick={() => setShowSecurityDrawer(false)}
                  style={drawerHeaderButtonStyle}
                  title="Close"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div
              style={{
                flex: "1 1 auto",
                overflow: "auto",
                padding: rightDrawerBodyPadding,
                scrollbarGutter: "stable both-edges",
                display: "grid",
                gap: 12,
              }}
            >
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
                <Suspense fallback={<div style={{ color: "var(--text-muted)" }}>Loading...</div>}>
                  <SecurityManager canManage={canManageSecurity} currentUserId={user?.id} />
                </Suspense>
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
          <button
            onClick={() => setShowProjectDrawer((v) => !v)}
            title={showProjectDrawer ? "Hide Project Drawer" : "Show Project Drawer"}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              margin: 0,
              cursor: "pointer",
              display: "block",
            }}
            aria-label={showProjectDrawer ? "Hide Project Drawer" : "Show Project Drawer"}
          >
            <img
              src={appLogo}
              alt="Mesora"
              style={{ height: 34, width: "auto", display: "block" }}
            />
          </button>
          <div style={{ width: 1, height: 18, background: "var(--border)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {showLiveIdentityChips ? (
              <>
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
                  {activeProject?.name || projectName || "None"}
                </div>
                <div
                  title={isLiveMode ? activeMenuLabel || "No menu selected" : activeScreen?.name || screenName || "No screen selected"}
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
                  {isLiveMode ? activeMenuLabel || "None" : activeScreen?.name || screenName || "None"}
                </div>
              </>
            ) : null}
            {!isLiveMode ? (
              <>
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
              <button
                title="Add SVG"
                onClick={() => setImportOpen(true)}
                style={topMenuIconButtonStyle}
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M12 11v6M9 14h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
              </>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { key: "theme", label: "Theme", alwaysVisible: true },
              { key: "plc", label: "PLC", areaKey: "plc" },
              { key: "opc", label: "OPC", areaKey: "opc" },
              { key: "server", label: "Server", areaKey: "server" },
              { key: "tags", label: "Tag", areaKey: "tags" },
              { key: "database", label: "Database", areaKey: "database" },
              { key: "reports", label: "Reports", areaKey: "reports" },
              { key: "ai", label: "AI", areaKey: "ai" },
              { key: "security", label: "Security", areaKey: "security" },
              { key: "help", label: "Help", areaKey: "help" },
            ]
              .filter((item) => (item.alwaysVisible || !isLiveMode) && canViewArea(item.areaKey))
              .map((item) => {
                const isActiveView =
                  drawerView === item.key ||
                  (item.key === "opc" && (drawerView === "logs" || drawerView === "diagnostics"));
                const isActive =
                  item.key === "theme"
                    ? false
                    : item.key === "security"
                    ? showSecurityDrawer || (showMainDrawer && drawerView === "security")
                    : (showMainDrawer && isActiveView);
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
                      if (item.key === "security") {
                        setShowMainDrawer(false);
                        setShowUserDrawer(false);
                        setShowSecurityDrawer(true);
                        return;
                      }
                      openDrawer(item.key);
                    }}
                    style={{
                      border: `1px solid ${isActive ? "var(--selected-border)" : "var(--border)"}`,
                      background: isActive ? "var(--selected-bg)" : "var(--bg-elev)",
                      color: isActive ? "var(--selected-text)" : "var(--text)",
                      borderRadius: 999,
                      padding: item.key === "theme" ? "4px 8px" : "4px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      minWidth: item.key === "theme" ? 34 : undefined,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: isActive ? "var(--selected-shadow)" : "0 6px 16px rgba(15, 23, 42, 0.08)",
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
              })}
          </div>
          <button
            onClick={() => {
              setShowMainDrawer(false);
              setShowSecurityDrawer(false);
              setShowUserDrawer(true);
            }}
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

      {isLiveMode ? (
        <div
          className={`vizi-live-alarmbar vizi-scroll ${hasLiveAlarms ? "is-alert" : "is-clear"}`}
          onClick={() => {
            setLiveMenuCollapsed(false);
            openDrawer("database", { forceDatabaseDataTab: true, databasePath: alarmDatabasePath });
          }}
          title="Open alarms"
          style={{
            position: "fixed",
            top: TOP_BAR_H,
            left: projectDrawerInsetPx,
            right: 0,
            height: LIVE_ALARM_BAR_H,
            zIndex: 205,
            borderBottom: "1px solid var(--border)",
            background:
              hasLiveAlarms
                ? theme === "dark"
                  ? "linear-gradient(180deg, color-mix(in srgb, #f04438 18%, var(--bg-elev) 82%) 0%, color-mix(in srgb, #f04438 12%, var(--bg) 88%) 100%)"
                  : "linear-gradient(180deg, color-mix(in srgb, #f04438 40%, #ffffff 60%) 0%, color-mix(in srgb, #dc2626 32%, #ffffff 68%) 100%)"
                : "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 94%, #0b2448 6%) 0%, color-mix(in srgb, var(--bg) 92%, #040d1f 8%) 100%)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
            overflowX: "hidden",
            overflowY: "visible",
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
        >
            <div
              className="vizi-live-alarmbar-title"
              style={{
                fontSize: 11,
                fontWeight: 800,
              color: hasLiveAlarms ? (theme === "dark" ? "#fca5a5" : "#7f1d1d") : "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                flex: "0 0 auto",
              }}
            >
            {hasLiveAlarms ? `Alarms (${liveActiveAlarmsWithOccurred.length})` : "Alarms clear"}
          </div>
          {hasLiveAlarms ? (
            <div ref={liveAlarmMarqueeViewportRef} className="vizi-live-alarm-marquee">
              <div
                ref={liveAlarmMarqueeTrackRef}
                className="vizi-live-alarm-marquee-track"
                style={{ ["--alarm-marquee-duration"]: `${liveAlarmMarqueeDurationSec}s` }}
              >
                {[0, 1, 2].map((segment) => (
                  <Fragment key={`alarm-marquee-segment-${segment}`}>
                    <div
                      className="vizi-live-alarm-marquee-group"
                      aria-hidden={segment > 0 ? "true" : undefined}
                    >
                      {liveAlarmMarqueeItems.map((item, idx) => (
                        <div
                          key={`alarm-marquee-${segment}-${item.id || idx}`}
                          className="vizi-live-alarm-marquee-item"
                          title={item.title}
                        >
                          <span className="vizi-live-alarm-marquee-item-label">{item.label}</span>
                          {item.at ? <span className="vizi-live-alarm-marquee-item-time">{item.at}</span> : null}
                        </div>
                      ))}
                    </div>
                    <div className="vizi-live-alarm-marquee-gap" aria-hidden="true" />
                  </Fragment>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {isLiveMode && isLiveMobile ? (
        <div
          style={{
            position: "fixed",
            left: projectDrawerInsetPx + 8,
            right: 8,
            bottom: 8,
            height: liveBottomCarouselHeightPx,
            zIndex: 210,
            border: "1px solid color-mix(in srgb, var(--border) 88%, #2b6cff 12%)",
            borderRadius: 12,
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 92%, #0b2448 8%) 0%, color-mix(in srgb, var(--bg) 90%, #040d1f 10%) 100%)",
            boxShadow: "0 10px 24px rgba(0,0,0,0.24)",
            overflow: "hidden",
            display: "flex",
            alignItems: "stretch",
          }}
        >
          <div
            className="vizi-scroll"
            style={{
              flex: "1 1 auto",
              overflowX: "auto",
              overflowY: "hidden",
              display: "flex",
              gap: 8,
              padding: "8px",
              scrollSnapType: "x mandatory",
            }}
          >
            {liveMenuMobileItems.length ? (
              liveMenuMobileItems.map(({ groupName, item }, idx) => {
                const isData = item?.type === "data";
                const screen = !isData ? screens.find((s) => s.id === item.screenId) || null : null;
                const label =
                  String(item?.label || "").trim() ||
                  (isData
                    ? normalizeTableDisplayName(String(item?.dataTable || "").trim()) || "Data"
                    : String(screen?.name || "Screen"));
                const active = isData
                  ? showMainDrawer &&
                    drawerView === "database" &&
                    (String(item?.dataTable || "").trim()
                      ? String(item?.dataTable || "").trim() === activeDatabaseTable
                      : true)
                  : String(item?.screenId || "") === String(activeScreenId);
                const locked = !canAccessLiveMenuItem(item);
                const initials = label
                  .split(/\s+/)
                  .filter(Boolean)
                  .join(" ")
                  .replace(/[^a-zA-Z0-9]/g, "")
                  .slice(0, 3)
                  .toUpperCase() || (isData ? "DAT" : "SCR");
                return (
                  <button
                    key={`live-menu-mobile-item-${item?.id || idx}`}
                    onClick={locked ? undefined : () => activateLiveMenuItem(item)}
                    disabled={locked}
                    data-preserve-style="true"
                    title={locked ? `${label} (Locked)` : label}
                    style={{
                      flex: "0 0 auto",
                      width: 172,
                      minHeight: "100%",
                      borderRadius: 10,
                      border: `1px solid ${
                        locked
                          ? "color-mix(in srgb, #f59e0b 55%, var(--border) 45%)"
                          : active
                          ? "var(--selected-border)"
                          : "var(--border)"
                      }`,
                      background: active ? "var(--selected-bg)" : "color-mix(in srgb, var(--bg) 88%, #0b1729 12%)",
                      color: active ? "var(--selected-text)" : "var(--text)",
                      boxShadow: active ? "var(--selected-shadow)" : "none",
                      padding: "8px 10px",
                      cursor: locked ? "not-allowed" : "pointer",
                      opacity: locked ? 0.78 : 1,
                      display: "grid",
                      alignContent: "space-between",
                      gap: 4,
                      textAlign: "left",
                      scrollSnapAlign: "start",
                    }}
                  >
                    <span style={{ fontSize: 9, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {groupName}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {label}
                    </span>
                    <span
                      style={{
                        width: 28,
                        height: 18,
                        borderRadius: 8,
                        border: "1px solid color-mix(in srgb, #ffffff 46%, var(--border) 54%)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 9,
                        fontWeight: 900,
                        background: "rgba(255,255,255,0.12)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      {initials}
                    </span>
                  </button>
                );
              })
            ) : (
              <div
                style={{
                  minWidth: "100%",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                No live menu items configured.
              </div>
            )}
          </div>
          <div
            style={{
              width: 58,
              borderLeft: "1px solid color-mix(in srgb, var(--border) 82%, #2b6cff 18%)",
              background: "color-mix(in srgb, var(--bg-elev) 88%, #0f274d 12%)",
              display: "grid",
              alignContent: "center",
              justifyItems: "center",
              gap: 8,
              padding: "8px 6px",
              boxSizing: "border-box",
            }}
          >
            <button
              title={showZoom ? "Hide zoom controls" : "Show zoom controls"}
              onClick={() => setShowZoom((v) => !v)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: "1px solid color-mix(in srgb, var(--border) 70%, #2b6cff 30%)",
                background: showZoom ? "var(--selected-bg)" : "var(--bg-elev)",
                color: showZoom ? "var(--selected-text)" : "var(--text)",
                boxShadow: showZoom ? "var(--selected-shadow)" : "0 6px 16px rgba(0,0,0,0.16)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
                <path d="M20 20l-4.2-4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              title="Team Chat"
              onClick={() => setShowTeamChat((v) => !v)}
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                border: "1px solid color-mix(in srgb, var(--border) 70%, #2b6cff 30%)",
                background: showTeamChat ? "var(--selected-bg)" : "var(--bg-elev)",
                color: showTeamChat ? "var(--selected-text)" : "var(--text)",
                boxShadow: showTeamChat ? "var(--selected-shadow)" : "0 6px 16px rgba(0,0,0,0.16)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                padding: 0,
                position: "relative",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 7.25C4 5.73 5.23 4.5 6.75 4.5h10.5C18.77 4.5 20 5.73 20 7.25v6.5c0 1.52-1.23 2.75-2.75 2.75h-5.4l-3.55 2.95c-.62.51-1.55.07-1.55-.74V16.5h0c-1.52 0-2.75-1.23-2.75-2.75v-6.5Z"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {teamChatUnreadCount > 0 ? (
                <span
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    minWidth: 14,
                    height: 14,
                    borderRadius: 999,
                    background: "#ef4444",
                    color: "#fff",
                    fontSize: 8,
                    fontWeight: 800,
                    display: "grid",
                    placeItems: "center",
                    border: "1px solid rgba(255,255,255,0.6)",
                    padding: "0 3px",
                    boxSizing: "border-box",
                  }}
                >
                  {teamChatUnreadCount > 99 ? "99+" : String(teamChatUnreadCount)}
                </span>
              ) : null}
            </button>
          </div>
        </div>
      ) : null}

      {isLiveMode ? (
        <div
          style={{
            position: "fixed",
            left: projectDrawerInsetPx,
            top: TOP_BAR_H + liveAlarmBarOffset,
            bottom: 0,
            width: liveMenuRailWidthPx,
            zIndex: 210,
            border: "1px solid color-mix(in srgb, var(--border) 88%, #2b6cff 12%)",
            borderRight: "1px solid color-mix(in srgb, var(--border) 92%, #2b6cff 8%)",
            borderRadius: 0,
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 92%, #0b2448 8%) 0%, color-mix(in srgb, var(--bg) 90%, #040d1f 10%) 100%)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
            backdropFilter: "blur(8px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            transition: "width 180ms ease, left 180ms ease",
            animation: "drawer-slide-in-left 220ms ease-out",
          }}
        >
          <div
            style={{
              padding: liveMenuIsExpanded ? (isLiveMobile ? "6px 8px" : "4px 8px") : "6px 8px",
              minHeight: liveMenuIsExpanded ? (isLiveMobile ? 38 : 32) : (isLiveMobile ? 42 : 38),
              display: "flex",
              alignItems: "center",
              justifyContent: liveMenuIsExpanded ? "flex-end" : "center",
              gap: 4,
            }}
          >
	            <button
	              onClick={() => setLiveMenuCollapsed((v) => !v)}
	              title={liveMenuCollapsed ? "Expand menu" : "Collapse menu"}
	              aria-label={liveMenuCollapsed ? "Expand live menu" : "Collapse live menu"}
		              style={{
	                width: isLiveMobile ? 32 : 28,
	                height: isLiveMobile ? 32 : 28,
	                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--bg-elev) 86%, #0f274d 14%)",
                color: "var(--text)",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                flex: "0 0 auto",
                padding: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d={liveMenuCollapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    animation: liveMenuCollapsed ? "live-menu-arrow-pulse 1s ease-in-out infinite" : "none",
                    transition: "transform 180ms ease",
                  }}
                />
              </svg>
            </button>
          </div>
          <div
	            style={{
	              flex: "1 1 auto",
	              minHeight: 0,
	              overflow: "auto",
	              padding: liveMenuIsExpanded ? (isLiveMobile ? 10 : 8) : 6,
	              display: "grid",
	              alignContent: "start",
	              gap: 6,
            }}
            className="vizi-scroll"
          >
            {liveMenuGroupsVisible.some((group) => Array.isArray(group.items) && group.items.length) ? (
              liveMenuGroupsVisible.map((group) => (
                <div key={`live-menu-group-${group.id}`} style={{ display: "grid", gap: 6 }}>
                  {liveMenuIsExpanded ? (
	                    <button
	                      onClick={() => toggleLiveMenuGroupCollapse(group.id)}
	                      title={`Toggle group ${group.name || "Group"}`}
	                      style={{
                        border: "none",
                        background: "transparent",
                        padding: "6px 2px 4px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-start",
                        gap: 8,
                        cursor: "pointer",
                        outline: "none",
                        boxShadow: "none",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 900,
                          letterSpacing: "0.08em",
                          color: "color-mix(in srgb, var(--text-muted) 88%, #9fb8ff 12%)",
                          textTransform: "uppercase",
                          textAlign: "left",
                        }}
                      >
                        {group.name || "Group"}
                      </span>
                    </button>
                  ) : (
                    <div
                      title={group.name || "Group"}
                      style={{
                        display: "grid",
                        justifyItems: "center",
                        gap: 2,
                        padding: "4px 0",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 8,
                          fontWeight: 900,
                          letterSpacing: "0.1em",
                          color: "color-mix(in srgb, var(--text-muted) 84%, #b7cbff 16%)",
                          textTransform: "uppercase",
                          lineHeight: 1,
                          border: "1px solid color-mix(in srgb, var(--border) 82%, #2b6cff 18%)",
                          borderRadius: 999,
                          padding: "2px 6px",
                          background: "color-mix(in srgb, var(--bg-elev) 86%, #0f274d 14%)",
                        }}
                      >
                        {(String(group.name || "GRP").trim().replace(/[^a-z0-9]/gi, "").slice(0, 3) || "GRP").toUpperCase()}
                      </span>
                      <span
                        style={{
                          width: 30,
                          height: 1,
                          background: "color-mix(in srgb, var(--border) 84%, transparent)",
                        }}
                      />
                    </div>
                  )}
                  {!collapsedLiveGroupIds.includes(String(group.id || "")) && group.items.map((item) => {
                    const isData = item.type === "data";
                    const screen = !isData ? screens.find((s) => s.id === item.screenId) || null : null;
                    const label =
                      String(item.label || "").trim() ||
                      (isData
                        ? String(item.dataTable || "").trim() || "Data"
                        : String(screen?.name || "Screen"));
                    const active = isData
                      ? showMainDrawer &&
                        drawerView === "database" &&
                        (String(item.dataTable || "").trim()
                          ? String(item.dataTable || "").trim() === activeDatabaseTable
                          : true)
                      : String(item.screenId || "") === String(activeScreenId);
                    const locked = !canAccessLiveMenuItem(item);
                    const initials = label
                      .split(/\s+/)
                      .filter(Boolean)
                      .join(" ")
                      .replace(/[^a-zA-Z0-9]/g, "")
                      .slice(0, 3)
                      .toUpperCase() || (isData ? "DAT" : "SCR");
                    return (
                      <button
                        key={`live-menu-item-${item.id}`}
                        onClick={locked ? undefined : () => activateLiveMenuItem(item)}
                        disabled={locked}
                        data-preserve-style="true"
	                        style={{
	                          width: "100%",
	                          minHeight: liveMenuIsExpanded
                              ? (isLiveMobile ? 38 : 30)
                              : (isLiveMobile ? 42 : 38),
	                          borderRadius: 10,
                          border: `1px solid ${
                            locked
                              ? "color-mix(in srgb, #f59e0b 55%, var(--border) 45%)"
                              : active
                              ? "var(--selected-border)"
                              : "var(--border)"
                          }`,
                          background: active
                            ? isData
                              ? "var(--bg-elev)"
                              : "var(--selected-bg)"
                            : "color-mix(in srgb, var(--bg) 88%, #0b1729 12%)",
                          color: active
                            ? isData
                              ? "var(--selected-border)"
                              : "var(--selected-text)"
                            : "var(--text)",
                          boxShadow: active
                            ? isData
                              ? "none"
                              : "var(--selected-shadow)"
                            : "none",
	                          padding: liveMenuIsExpanded
                              ? (isLiveMobile ? "8px 10px" : "5px 8px")
                              : "6px 6px",
	                          fontSize: 11,
                          fontWeight: active ? 800 : 700,
                          textAlign: "left",
                          cursor: locked ? "not-allowed" : "pointer",
                          opacity: locked ? 0.78 : 1,
                          display: "grid",
                          gridTemplateColumns: liveMenuIsExpanded ? "22px 1fr auto" : "1fr",
                          alignItems: "center",
                          gap: liveMenuIsExpanded ? 8 : 0,
                          transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
                        }}
                        title={locked ? `${label} (Locked)` : label}
                      >
                        <span
                          style={{
                            width: liveMenuIsExpanded ? 22 : 36,
                            height: liveMenuIsExpanded ? 18 : 24,
                            borderRadius: liveMenuIsExpanded ? 7 : 8,
                            border: active
                              ? "1px solid color-mix(in srgb, #ffffff 56%, var(--selected-border) 44%)"
                              : "1px solid var(--border)",
                            background: active
                              ? "rgba(255,255,255,0.2)"
                              : "color-mix(in srgb, var(--bg-elev) 85%, transparent)",
                            color: "inherit",
                            display: "grid",
                            placeItems: "center",
                            fontSize: liveMenuIsExpanded ? 9 : 10,
                            fontWeight: 900,
                            margin: liveMenuIsExpanded ? 0 : "0 auto",
                            letterSpacing: liveMenuIsExpanded ? "0.02em" : "0.06em",
                          }}
                        >
                          {initials}
                        </span>
                        {liveMenuIsExpanded ? (
                          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {label}
                          </span>
                        ) : null}
                        {liveMenuIsExpanded && locked ? (
                          <span style={{ display: "inline-grid", placeItems: "center", width: 14, height: 14, marginLeft: 4 }} aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path d="M7 10V7a5 5 0 1110 0v3" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
                              <rect x="5" y="10" width="14" height="10" rx="2" stroke="#f59e0b" strokeWidth="2" />
                            </svg>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: 6, textAlign: liveMenuIsExpanded ? "left" : "center" }}>
                No live menu items configured.
              </div>
            )}
          </div>
        </div>
      ) : null}

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
            <div style={{ display: "grid" }}>
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: "0.02em", color: "var(--text)" }}>
                Project
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
            style={
              projectDrawerTab === "screens" || projectDrawerTab === "menu"
                ? { ...projectDrawerContentStyle, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }
                : projectDrawerContentStyle
            }
            className="vizi-scroll"
          >
            <div style={{ ...projectDrawerCardStyle, padding: 6, flex: "0 0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${projectDrawerTabs.length}, minmax(0, 1fr))`,
                  gap: 6,
                }}
              >
                {projectDrawerTabs.map((tab) => (
                  <button
                    key={`project-tab-${tab.key}`}
                    onClick={() => setProjectDrawerTab(tab.key)}
                    style={drawerTabButtonStyle(projectDrawerTab === tab.key)}
                    title={tab.title}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {projectDrawerTab === "project" ? (
              <>
            <div style={{ ...projectDrawerCardStyle, gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Current Project</div>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Project Name</span>
                {projectNameEditing ? (
                  <input
                    value={projectNameDraft}
                    onChange={(e) => setProjectNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void saveProjectNameFromSettings();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        cancelProjectNameEditFromSettings();
                      }
                    }}
                    style={{
                      border: "1px solid var(--border)",
                      background: "#ffffff",
                      color: "#111827",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      borderRadius: 8,
                      padding: "8px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {projectName || "Untitled"}
                  </div>
                )}
              </label>
              <div style={{ display: "grid", gap: 4 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Mode</span>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 11,
                      color: projectModeDraft === "design" ? "var(--text)" : "var(--text-muted)",
                      fontWeight: 700,
                    }}
                  >
                    Design
                  </span>
                  <button
                    data-preserve-style="true"
                    onClick={() =>
                      projectNameEditing
                        ? setProjectModeDraft((current) =>
                            normalizeProjectMode(current) === "live" ? "design" : "live"
                          )
                        : undefined
                    }
                    disabled={!projectNameEditing}
                    title={projectNameEditing ? "Toggle Project Mode" : "Click Edit to change mode"}
                    aria-label="Toggle Project Mode"
                    style={{
                      width: 44,
                      height: 24,
                      borderRadius: 999,
                      border: `1px solid ${projectModeDraft === "live" ? "#2b6cff" : "var(--border)"}`,
                      background: projectModeDraft === "live" ? "#2b6cff" : "var(--bg-soft)",
                      padding: 2,
                      cursor: projectNameEditing ? "pointer" : "not-allowed",
                      position: "relative",
                      transition: "all 140ms ease",
                      opacity: projectNameEditing ? 1 : 0.55,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 2,
                        left: projectModeDraft === "live" ? 22 : 2,
                        width: 18,
                        height: 18,
                        borderRadius: "50%",
                        background: "#ffffff",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.24)",
                        transition: "left 140ms ease",
                      }}
                    />
                  </button>
                  <span
                    style={{
                      fontSize: 11,
                      color: projectModeDraft === "live" ? "var(--text)" : "var(--text-muted)",
                      fontWeight: 700,
                    }}
                  >
                    Live
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginTop: 4 }}>
                SVG Background Colors
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text)" }}>Light</div>
                <input
                  type="color"
                  value={projectCanvasBackgroundDraft.light || DEFAULT_CANVAS_BG_LIGHT}
                  onChange={(e) => {
                    const next = normalizeProjectCanvasBackground({
                      ...projectCanvasBackgroundDraft,
                      light: e.target.value,
                    });
                    setProjectCanvasBackgroundDraft(next);
                  }}
                  disabled={!projectNameEditing}
                  style={{ width: "100%", height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}
                  title="Canvas background color in light mode"
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{projectCanvasBackgroundDraft.light}</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text)" }}>Dark</div>
                <input
                  type="color"
                  value={projectCanvasBackgroundDraft.dark || DEFAULT_CANVAS_BG_DARK}
                  onChange={(e) => {
                    const next = normalizeProjectCanvasBackground({
                      ...projectCanvasBackgroundDraft,
                      dark: e.target.value,
                    });
                    setProjectCanvasBackgroundDraft(next);
                  }}
                  disabled={!projectNameEditing}
                  style={{ width: "100%", height: 32, border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}
                  title="Canvas background color in dark mode"
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{projectCanvasBackgroundDraft.dark}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    const next = normalizeProjectCanvasBackground(null);
                    setProjectCanvasBackgroundDraft(next);
                  }}
                  style={{
                    ...topMenuTextButtonStyle,
                    fontSize: 11,
                    padding: "6px 10px",
                    opacity: projectNameEditing ? 1 : 0.45,
                    cursor: projectNameEditing ? "pointer" : "not-allowed",
                  }}
                  title="Reset canvas background colors to defaults"
                  disabled={!projectNameEditing}
                >
                  Reset Defaults
                </button>
              </div>
              {activeProjectUpdatedAt ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {formatProjectTime(activeProjectUpdatedAt)}
                </div>
              ) : null}
            </div>
              </>
            ) : null}

            {projectDrawerTab === "screens" ? (
            <div style={{ display: "grid", gap: 8, minHeight: 0 }}>
              <fieldset
                style={{ border: "none", margin: 0, padding: 0, minWidth: 0, display: "grid", gap: 8, minHeight: 0 }}
              >
              <div style={{ ...projectDrawerCardStyle }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Canvas Screens</div>
                  <button
                    onClick={addScreen}
                    style={{
                      ...topMenuTextButtonStyle,
                      border: "1px solid #2b6cff",
                      background: "#2b6cff",
                      color: "#ffffff",
                      fontSize: 11,
                      padding: "6px 10px",
                      cursor: "pointer",
                      opacity: 1,
                    }}
                    title="Add Canvas Screen"
                  >
                    Add Screen
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Choose the active design screen.
                </div>
                <div style={{ display: "grid", gap: 6, maxHeight: 180, overflow: "auto" }} className="vizi-scroll">
                  {(screens || []).map((s) => {
                    const active = s.id === activeScreenId;
                    return (
                      <div
                        key={`screen-item-${s.id}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => switchToScreen(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            switchToScreen(s.id);
                          }
                        }}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: active
                            ? "color-mix(in srgb, var(--bg-elev) 88%, #2b6cff 12%)"
                            : "var(--bg)",
                          padding: "6px 8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          cursor: "pointer",
                          outline: "none",
                          boxShadow: "none",
                        }}
                      >
                        <input
                          value={String(s.name || "")}
                          onClick={(e) => {
                            e.stopPropagation();
                            switchToScreen(s.id);
                          }}
                          onFocus={() => switchToScreen(s.id)}
                          onKeyDown={(e) => e.stopPropagation()}
                          onChange={(e) => renameScreenById(s.id, e.target.value)}
                          onBlur={() => {
                            if (String(s.name || "").trim()) return;
                            renameScreenById(s.id, "Screen");
                          }}
                          readOnly={!projectNameEditing}
                          style={{
                            color: "var(--text)",
                            fontSize: 12,
                            fontWeight: active ? 800 : 600,
                            textAlign: "left",
                            padding: "4px 6px",
                            flex: "1 1 auto",
                            minWidth: 0,
                            border: projectNameEditing ? "1px solid var(--border)" : "1px solid transparent",
                            borderRadius: 6,
                            background: projectNameEditing ? "var(--bg-elev)" : "transparent",
                            outline: "none",
                            cursor: projectNameEditing ? "text" : "pointer",
                          }}
                          title={s.name}
                        />
                        {active ? (
                          <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 800, flex: "0 0 auto" }}>Active</span>
                        ) : null}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteScreenById(s.id);
                          }}
                          disabled={screens.length <= 1 || !projectNameEditing}
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            border: "1px solid #f04438",
                            background: screens.length > 1 && projectNameEditing ? "#f04438" : "rgba(244,68,56,0.45)",
                            color: "#fff",
                            cursor: screens.length > 1 && projectNameEditing ? "pointer" : "not-allowed",
                            opacity: screens.length > 1 && projectNameEditing ? 1 : 0.65,
                            padding: 0,
                            flex: "0 0 auto",
                          }}
                          title={`Delete ${s.name || "screen"}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              </fieldset>
            </div>
            ) : null}

            {projectDrawerTab === "menu" ? (
            <div style={{ display: "grid", gap: 8, minHeight: 0, flex: "1 1 auto" }}>
              <fieldset
                style={{ border: "none", margin: 0, padding: 0, minWidth: 0, display: "grid", gap: 8, minHeight: 0, height: "100%" }}
              >
              <div style={{ ...projectDrawerCardStyle, minHeight: 0, display: "flex", flexDirection: "column", flex: "1 1 auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>Menu Config</div>
                  <button
                    onClick={addLiveMenuGroup}
                    style={{ ...topMenuTextButtonStyle, fontSize: 11, padding: "6px 10px" }}
                    title="Add Menu Group"
                  >
                    Add Group
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Build grouped live menu entries from canvas screens or data tables.
                </div>
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    flex: "1 1 auto",
                    minHeight: 0,
                    overflow: "auto",
                    alignContent: "start",
                    gridAutoRows: "max-content",
                  }}
                  className="vizi-scroll"
                >
                  {liveMenuGroupsForRender.map((group) => (
                    <div
                      key={`menu-group-${group.id}`}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 8,
                        display: "grid",
                        gap: 6,
                        background: "var(--bg)",
                        alignSelf: "start",
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6, alignItems: "center" }}>
                        <input
                          value={group.name}
                          onChange={(e) => renameLiveMenuGroup(group.id, e.target.value)}
                          placeholder="Group name"
                          style={{
                            border: "1px solid var(--border)",
                            background: "var(--bg-elev)",
                            color: "var(--text)",
                            borderRadius: 7,
                            padding: "6px 8px",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        />
                        <button
                          onClick={() => addLiveMenuItem(group.id, "screen")}
                          style={{ ...topMenuTextButtonStyle, fontSize: 11, padding: "6px 8px" }}
                          title="Add Canvas Screen Item"
                        >
                          + Screen
                        </button>
                        <button
                          onClick={() => addLiveMenuItem(group.id, "data")}
                          style={{ ...topMenuTextButtonStyle, fontSize: 11, padding: "6px 8px" }}
                          title="Add Data Screen Item"
                        >
                          + Data
                        </button>
                      </div>
                      <div style={{ display: "grid", gap: 6 }}>
                        {group.items.map((item, index) => (
                          <div
                            key={`menu-item-${item.id}`}
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 7,
                              padding: 6,
                              display: "grid",
                              gridTemplateColumns: "82px 1fr 1fr auto auto auto auto",
                              gap: 6,
                              alignItems: "center",
                              background: "var(--bg-elev)",
                            }}
                          >
                            <select
                              value={item.type}
                              onChange={(e) => updateLiveMenuItem(group.id, item.id, { type: e.target.value })}
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                color: "var(--text)",
                                borderRadius: 6,
                                padding: "5px 6px",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              <option value="screen">Canvas</option>
                              <option value="data">Data</option>
                            </select>
                            {item.type === "data" ? (
                              <select
                                value={String(item.dataTable || "").trim()}
                                onChange={(e) => updateLiveMenuItem(group.id, item.id, { dataTable: e.target.value })}
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg)",
                                  color: "var(--text)",
                                  borderRadius: 6,
                                  padding: "5px 6px",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                {databaseTablesForMenu.length ? (
                                  databaseTablesForMenu.map((table) => (
                                    <option key={`data-table-option-${table}`} value={table}>
                                      {table}
                                    </option>
                                  ))
                                ) : (
                                  <option value="">No tables</option>
                                )}
                              </select>
                            ) : (
                              <select
                                value={item.screenId || ""}
                                onChange={(e) => updateLiveMenuItem(group.id, item.id, { screenId: e.target.value })}
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg)",
                                  color: "var(--text)",
                                  borderRadius: 6,
                                  padding: "5px 6px",
                                  fontSize: 11,
                                  fontWeight: 600,
                                }}
                              >
                                {screens.map((screen) => (
                                  <option key={`menu-screen-option-${screen.id}`} value={screen.id}>
                                    {screen.name || "Screen"}
                                  </option>
                                ))}
                              </select>
                            )}
                            <input
                              value={item.label || ""}
                              onChange={(e) => updateLiveMenuItem(group.id, item.id, { label: e.target.value })}
                              placeholder="Label (optional)"
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                color: "var(--text)",
                                borderRadius: 6,
                                padding: "5px 6px",
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            />
                            <button
                              onClick={() =>
                                updateLiveMenuItem(group.id, item.id, {
                                  restricted: !Boolean(item?.restricted),
                                })
                              }
                              style={{
                                width: 24,
                                height: 22,
                                borderRadius: 6,
                                border: `1px solid ${
                                  item?.restricted
                                    ? "color-mix(in srgb, #f59e0b 64%, var(--border) 36%)"
                                    : "var(--border)"
                                }`,
                                background: item?.restricted
                                  ? "color-mix(in srgb, #f59e0b 12%, var(--bg))"
                                  : "var(--bg)",
                                color: item?.restricted ? "#f59e0b" : "var(--text-muted)",
                                cursor: "pointer",
                                padding: 0,
                                display: "grid",
                                placeItems: "center",
                              }}
                              title={item?.restricted ? "Unlock item" : "Lock item by role"}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M7 10V7a5 5 0 1110 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                              </svg>
                            </button>
                            <button
                              onClick={() => moveLiveMenuItem(group.id, item.id, -1)}
                              disabled={index === 0}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                cursor: index === 0 ? "not-allowed" : "pointer",
                                opacity: index === 0 ? 0.45 : 1,
                                padding: 0,
                              }}
                              title="Move up"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveLiveMenuItem(group.id, item.id, 1)}
                              disabled={index >= group.items.length - 1}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                cursor: index >= group.items.length - 1 ? "not-allowed" : "pointer",
                                opacity: index >= group.items.length - 1 ? 0.45 : 1,
                                padding: 0,
                              }}
                              title="Move down"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => deleteLiveMenuItem(group.id, item.id)}
                              style={{
                                width: 22,
                                height: 22,
                                borderRadius: 6,
                                border: "1px solid #f04438",
                                background: "#f04438",
                                color: "#fff",
                                padding: 0,
                              }}
                              title="Delete item"
                            >
                              ×
                            </button>
                            {item?.restricted ? (
                              <div
                                style={{
                                  gridColumn: "1 / -1",
                                  border: "1px solid color-mix(in srgb, #f59e0b 34%, var(--border) 66%)",
                                  borderRadius: 6,
                                  padding: "6px 8px",
                                  display: "grid",
                                  gap: 6,
                                  background: "color-mix(in srgb, #f59e0b 6%, var(--bg))",
                                }}
                              >
                                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>
                                  Allowed Roles
                                </div>
                                {securityRolesForMenu.length ? (
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                    {securityRolesForMenu.map((role) => {
                                      const checked = normalizeRoleIdList(item?.allowedRoleIds).includes(role.id);
                                      return (
                                        <label
                                          key={`menu-item-role-${item.id}-${role.id}`}
                                          style={{
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 5,
                                            fontSize: 11,
                                            color: "var(--text)",
                                          }}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              const next = normalizeRoleIdList(item?.allowedRoleIds);
                                              const updated = e.target.checked
                                                ? Array.from(new Set([...next, role.id]))
                                                : next.filter((id) => id !== role.id);
                                              updateLiveMenuItem(group.id, item.id, { allowedRoleIds: updated });
                                            }}
                                          />
                                          {role.name}
                                        </label>
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                    No roles loaded. Open Security to create roles first.
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center" }}>
                        <button
                          onClick={() => deleteLiveMenuGroup(group.id)}
                          style={{
                            ...topMenuTextButtonStyle,
                            fontSize: 11,
                            padding: "6px 10px",
                            minHeight: 30,
                            border: "1px solid #f04438",
                            background: "#f04438",
                            color: "#fff",
                          }}
                          title="Delete Group"
                        >
                          Delete Group
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              </fieldset>
            </div>
            ) : null}
          </div>
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
          {showProjectDrawer ? (
            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "10px 10px 12px",
                background: "var(--bg-soft)",
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button
                  onClick={cancelProjectNameEditFromSettings}
                  disabled={!projectNameEditing}
                  style={{
                    ...topMenuTextButtonStyle,
                    fontSize: 12,
                    padding: "8px 10px",
                    opacity: projectNameEditing ? 1 : 0.45,
                    cursor: projectNameEditing ? "pointer" : "not-allowed",
                  }}
                  title="Cancel Project Changes"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!projectNameEditing) {
                      beginProjectDrawerEdit();
                      return;
                    }
                    void saveProjectNameFromSettings();
                  }}
                  style={{
                    ...topMenuTextButtonStyle,
                    fontSize: 12,
                    padding: "8px 10px",
                    border: projectNameEditing ? "1px solid #2b6cff" : topMenuTextButtonStyle.border,
                    background: projectNameEditing ? "#2b6cff" : topMenuTextButtonStyle.background,
                    color: projectNameEditing ? "#ffffff" : topMenuTextButtonStyle.color,
                  }}
                  title={projectNameEditing ? "Save Project Changes" : "Edit Project"}
                >
                  {projectNameEditing ? "Save" : "Edit"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showTeamChat ? (
        <div
          style={{
            position: "fixed",
            top: isLiveMode && isLiveMobile ? TOP_BAR_H + liveAlarmBarOffset : undefined,
            left: isLiveMode && isLiveMobile ? projectDrawerInsetPx : undefined,
            right: isLiveMode && isLiveMobile ? 0 : (isLiveMode ? 16 : 52),
            bottom: isLiveMode && isLiveMobile ? liveBottomCarouselHeightPx + 8 : 72,
            width: isLiveMode && isLiveMobile ? "auto" : 360,
            maxWidth: isLiveMode && isLiveMobile ? "none" : "calc(100vw - 24px)",
            height: isLiveMode && isLiveMobile ? "auto" : 420,
            maxHeight: isLiveMode && isLiveMobile ? "none" : "62vh",
            zIndex: isLiveMode && isLiveMobile ? 221 : 215,
            border: "1px solid var(--border)",
            borderRadius: isLiveMode && isLiveMobile ? 0 : 12,
            background: "var(--bg-elev)",
            boxShadow: "0 18px 42px rgba(0,0,0,0.34)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: 42,
              padding: "0 10px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "color-mix(in srgb, var(--bg-soft) 78%, var(--bg-elev) 22%)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>Team Chat</div>
            <button
              onClick={() => setShowTeamChat(false)}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
          <div
            ref={teamChatBodyRef}
            className="vizi-scroll"
            style={{
              flex: "1 1 auto",
              overflowY: "auto",
              padding: 10,
              display: "grid",
              alignContent: "start",
              gap: 8,
              background: "var(--bg-soft)",
            }}
          >
            {teamChatLoading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading chat...</div>
            ) : teamChatMessages.length ? (
              teamChatMessages.map((row, idx) => {
                const id = Number(row?.id || 0);
                const mine = Number(row?.user_id || 0) === Number(user?.id || 0);
                const at = row?.created_at ? new Date(row.created_at) : null;
                return (
                  <div
                    key={`team-chat-msg-${id || idx}`}
                    style={{
                      justifySelf: mine ? "end" : "start",
                      maxWidth: "88%",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "6px 8px",
                      background: mine
                        ? "linear-gradient(180deg, color-mix(in srgb, var(--accent) 22%, var(--bg-elev) 78%) 0%, color-mix(in srgb, var(--accent) 14%, var(--bg-elev) 86%) 100%)"
                        : "var(--bg-elev)",
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 2 }}>
                      {String(row?.author || "User")}
                      {at && !Number.isNaN(at.getTime()) ? ` • ${at.toLocaleString()}` : ""}
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.35, color: "var(--text)", whiteSpace: "pre-wrap" }}>
                      {String(row?.message || "")}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No messages yet.</div>
            )}
          </div>
          <div
            style={{
              borderTop: "1px solid var(--border)",
              background: "var(--bg-elev)",
              padding: 8,
              display: "grid",
              gap: 8,
            }}
          >
            <textarea
              value={teamChatDraft}
              onChange={(e) => setTeamChatDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendTeamChatMessage();
                }
              }}
              placeholder="Type message..."
              rows={2}
              style={{
                resize: "none",
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg)",
                color: "var(--text)",
                padding: "6px 8px",
                fontSize: 12,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => void sendTeamChatMessage()}
                disabled={teamChatSending || !String(teamChatDraft || "").trim()}
                style={{
                  border: "1px solid var(--accent)",
                  background: "linear-gradient(180deg, var(--accent) 0%, var(--accent-strong) 100%)",
                  color: "var(--accent-text)",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: teamChatSending ? "wait" : "pointer",
                  opacity: teamChatSending || !String(teamChatDraft || "").trim() ? 0.55 : 1,
                }}
              >
                {teamChatSending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!(isLiveMode && isLiveMobile) ? (
        <button
          title="Team Chat"
          onClick={() => setShowTeamChat((v) => !v)}
          style={{
            position: "fixed",
            right: isLiveMode ? 16 : 52,
            bottom: isLiveMode && isLiveMobile ? liveBottomCarouselHeightPx + 10 : 16,
            width: 44,
            height: 44,
            zIndex: 216,
            borderRadius: 12,
            padding: 0,
            lineHeight: 0,
            border: "1px solid color-mix(in srgb, var(--accent) 36%, var(--border) 64%)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--accent) 34%, var(--bg-elev) 66%) 0%, color-mix(in srgb, var(--accent) 20%, var(--bg-elev) 80%) 58%, color-mix(in srgb, var(--accent-strong) 22%, var(--bg-elev) 78%) 100%)",
            color: "var(--text)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            boxShadow: showTeamChat
              ? "0 12px 28px rgba(37, 99, 235, 0.34), inset 0 1px 0 rgba(255,255,255,0.26)"
              : "0 10px 24px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.18)",
            outline: showTeamChat ? "2px solid color-mix(in srgb, var(--accent) 42%, transparent)" : "none",
            outlineOffset: 1,
            transition: "transform 120ms ease, box-shadow 160ms ease, outline-color 160ms ease",
          }}
        >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
          <path
            d="M4 7.25C4 5.73 5.23 4.5 6.75 4.5h10.5C18.77 4.5 20 5.73 20 7.25v6.5c0 1.52-1.23 2.75-2.75 2.75h-5.4l-3.55 2.95c-.62.51-1.55.07-1.55-.74V16.5h0c-1.52 0-2.75-1.23-2.75-2.75v-6.5Z"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="9" cy="10.6" r="1.1" fill="currentColor" />
          <circle cx="12" cy="10.6" r="1.1" fill="currentColor" />
          <circle cx="15" cy="10.6" r="1.1" fill="currentColor" />
        </svg>
        {teamChatUnreadCount > 0 ? (
          <span
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 17,
              height: 17,
              borderRadius: 999,
              background: "#ef4444",
              color: "#fff",
              fontSize: 9,
              fontWeight: 800,
              display: "grid",
              placeItems: "center",
              border: "1px solid rgba(255,255,255,0.6)",
              padding: "0 4px",
              boxSizing: "border-box",
            }}
          >
            {teamChatUnreadCount > 99 ? "99+" : String(teamChatUnreadCount)}
          </span>
        ) : null}
        </button>
      ) : null}

      {!showZoom && !(isLiveMode && isLiveMobile) && (
        <button
          title="Show Zoom"
          onClick={() => setShowZoom(true)}
          style={{
            position: "fixed",
            left: isLiveMode ? undefined : Math.max(zoomPos.x, 8),
            right: isLiveMode ? (isLiveMobile ? 68 : 72) : undefined,
            bottom: isLiveMode && isLiveMobile ? liveBottomCarouselHeightPx + 10 : 16,
            zIndex: 92,
            padding: isLiveMode ? "4px 8px" : "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-elev)",
            cursor: "pointer",
            boxShadow: "0 6px 14px rgba(0,0,0,0.10)",
            color: "var(--text)",
            fontSize: isLiveMode ? 11 : 12,
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
