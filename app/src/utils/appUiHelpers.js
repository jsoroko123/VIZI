import { normalizeAlarmOperatorValue, normalizeTagValue } from "./appDataTransforms";

export const MAIN_DRAWER_WIDTH_VIEW_KEYS = [
  "ai",
  "reports",
  "code-gen-pro",
  "plc",
  "server",
  "logger",
  "database",
  "tags",
  "logs",
  "diagnostics",
  "opc",
  "help",
];

export function normalizeMainDrawerWidthViewKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return key || "ai";
}

export function getMainDrawerWidthForView(drawerSizes, drawerView) {
  const fallback = Number(drawerSizes?.main?.w) || 760;
  const byView =
    drawerSizes?.mainByView && typeof drawerSizes.mainByView === "object"
      ? drawerSizes.mainByView
      : {};
  const key = normalizeMainDrawerWidthViewKey(drawerView);
  const saved = Number(byView?.[key]);
  return Number.isFinite(saved) && saved > 0 ? saved : fallback;
}

export function readStoredDrawerFullscreen(name, storageKey = "vizi_drawer_fullscreen") {
  if (typeof window === "undefined") return false;
  const key = String(name || "").trim().toLowerCase();
  if (!key) return false;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed[key] === true : false;
  } catch {
    return false;
  }
}

export function isSvgMarkup(value) {
  const text = String(value || "").trimStart();
  return text.startsWith("<svg") || text.startsWith("<?xml");
}

export function coerceAlarmComparable(value) {
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

export function evaluateAlarmCondition(liveValue, operator, threshold) {
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

export function normalizeRouteTagKey(value) {
  return normalizeTagValue(value).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function inferETypeFromFileKey(fileKey) {
  const raw = String(fileKey || "").trim();
  if (!raw) return "";
  const leaf = raw.split("/").pop() || raw;
  return leaf.replace(/\.svg$/i, "").trim();
}

export function resolveOverlayEType(overlay) {
  const explicit = String(overlay?.eType || "").trim();
  if (explicit) return explicit;
  return inferETypeFromFileKey(overlay?.sourceKey || overlay?.name || "");
}

export function isMotorEType(value) {
  const key = normalizeRouteTagKey(value);
  return key === "motor" || key.startsWith("motor");
}

export function isBinEType(value) {
  const key = normalizeRouteTagKey(value);
  return key === "bin" || key.startsWith("bin");
}

export function isOverlayETypeAutoManaged(overlay) {
  if (!overlay || typeof overlay !== "object") return false;
  if (overlay.eTypeAuto === false) return false;
  const sourceKey = String(overlay.sourceKey || "").trim();
  if (!sourceKey || sourceKey.startsWith("__generated__/")) return false;
  return true;
}

export function isRouteIdTagKey(value) {
  const key = normalizeRouteTagKey(value);
  return key === "routeid" || key === "routenumber" || key === "routeno" || key === "route";
}

export function isStateTagKey(value) {
  const key = normalizeRouteTagKey(value);
  return (
    key === "state" ||
    key === "stcode" ||
    key === "status" ||
    key === "stat" ||
    key === "hmistate"
  );
}

export function parseDbTagPath(value) {
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

export function readFirstInnerSvgText(inner) {
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

export function writeFirstInnerSvgText(inner, nextText) {
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

export function normalizeSeriesTagsValue(rawSeries, fallbackTagPath = "") {
  const tags = (Array.isArray(rawSeries) ? rawSeries : String(rawSeries || "").split(/\r?\n|,/))
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
  if (tags.length) return tags;
  const primary = String(fallbackTagPath || "").trim();
  return primary ? [primary] : [];
}

export function toDatetimeLocalInput(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = new Date(ms);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
