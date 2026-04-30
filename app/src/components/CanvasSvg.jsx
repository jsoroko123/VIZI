// src/components/CanvasSvg.jsx
import { useEffect, useCallback, useMemo, useRef, useState, memo } from "react";
import { GRID, pointsToAttr, bboxOfPoints } from "../utils/geometry";
import { writeOpcValue } from "../api/opcApi";
import {
  getOpcLiveSnapshot,
  getOpcLiveValuesForKeys,
  patchOpcLiveSnapshot,
  subscribeOpcLiveKeys,
} from "../state/opcLiveStore";
import { normalizeTagValue } from "../utils/appDataTransforms";
import { isDiverterEType, isRouteIdTagKey, isStateTagKey } from "../utils/appUiHelpers";
import { resolveWidgetOpcServer, resolveWidgetWriteMode } from "../utils/widgetTemplates";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Filler,
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";

const RULER = 24; // ruler thickness (px)
const SCROLLBAR_RESERVE = 14; // keep native scrollbars visible (not under rulers)
const LIVE_ROUTE_ID_MEMBER_ALIASES = ["RouteID", "RouteNumber", "RouteNo", "Route"];
const LIVE_ROUTE_COLOR_MEMBER_ALIASES = ["RouteColor", "Route Color", "routeColor", "route_color"];
const LIVE_STATE_MEMBER_ALIASES = [
  "HMI State",
  "HMI_State",
  "hmi_state",
  "HMIState",
  "hmistate",
  "i_HMIState",
  "o_HMIState",
  "State",
];
const LIVE_MODE_STATUS_MEMBER_ALIASES = [
  "Mode_Status",
  "ModeStatus",
  "Control_Status",
  "ControlStatus",
  "i_ModeStatus",
  "o_ModeStatus",
  "StsMode",
  "HMI_ModeStatus",
];
const LIVE_MANUAL_MODE_MEMBER_ALIASES = [
  "i_ManualMode",
  "o_ManualMode",
  "ManualMode",
  "StsManual",
  "ManualActive",
  "i_HandMode",
  "o_HandMode",
  "HandMode",
  "StsHand",
  "HandActive",
];
const LIVE_AUTO_MODE_MEMBER_ALIASES = [
  "i_AutoMode",
  "o_AutoMode",
  "AutoMode",
  "StsAuto",
  "AutoActive",
];
const LIVE_MAINTENANCE_MODE_MEMBER_ALIASES = [
  "i_MaintenanceMode",
  "o_MaintenanceMode",
  "MaintenanceMode",
  "MaintMode",
  "StsMaint",
  "MaintActive",
];
const BIN_LOCK_FILL_GROUP_IDS = ["Lock_Filling", "LockFill"];
const BIN_LOCK_DISCHARGE_GROUP_IDS = ["Lock_Discharge", "LockDischarge"];

const getTagPathLeaf = (value) => {
  const raw = normalizeTagValue(value);
  if (!raw) return "";
  const parts = raw.split(/[./]/).map((entry) => entry.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : raw;
};

const isStateTagPathKey = (value) => isStateTagKey(value) || isStateTagKey(getTagPathLeaf(value));

const buildStateTagParentPathCandidates = (tagPath, tagName, groupName, topicName) => {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const value = normalizeTagValue(raw);
    if (!value) return;
    const lower = value.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    out.push(value);
  };
  if (!(isStateTagPathKey(tagName) || isStateTagPathKey(tagPath))) return out;
  const path = normalizeTagValue(tagPath);
  const leaf = getTagPathLeaf(path);
  if (path && isStateTagPathKey(leaf)) {
    const cut = Math.max(path.lastIndexOf("."), path.lastIndexOf("/"));
    if (cut > 0) {
      const parent = path.slice(0, cut);
      push(parent);
      if (topicName) push(`${topicName}.${parent}`);
    }
  }
  push(groupName);
  if (topicName && groupName) push(`${topicName}.${groupName}`);
  return out;
};

const normalizeIgnitionStyleClassName = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  let classText = "";
  let singleStyleName = false;
  if (lower.startsWith("style:")) {
    classText = raw.slice(raw.indexOf(":") + 1).trim();
    singleStyleName = true;
  } else if (lower.startsWith("class:")) {
    classText = raw.slice(raw.indexOf(":") + 1).trim();
  } else if (lower.startsWith(".")) {
    classText = raw.slice(1).trim();
  } else if (lower.startsWith("psc-")) {
    classText = raw;
  } else if (
    raw.includes("/") &&
    !lower.startsWith("url(") &&
    !/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw) &&
    !/^(?:rgb|hsl)a?\(/i.test(raw) &&
    !lower.startsWith("var(")
  ) {
    classText = raw;
    singleStyleName = true;
  }
  if (!classText) return "";
  const entries = singleStyleName ? [classText] : classText.split(/\s+/);
  return entries
    .map((entry) => {
      const cleaned = String(entry || "")
        .trim()
        .replace(/^\./, "")
        .replace(/^style:/i, "")
        .replace(/^class:/i, "");
      if (!cleaned) return "";
      return cleaned.toLowerCase().startsWith("psc-") ? cleaned : `psc-${cleaned}`;
    })
    .filter(Boolean)
    .join(" ");
};

const isIgnitionStyleReference = (value) => Boolean(normalizeIgnitionStyleClassName(value));

const isDocOrDicStatePaintEType = (value) => {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return key.startsWith("doc") || key.startsWith("dic");
};

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Tooltip,
  Filler
);

const hoverGuidePlugin = {
  id: "viziHoverGuide",
  afterDraw(chart, _args, pluginOptions) {
    const tooltip = chart?.tooltip;
    const active = typeof tooltip?.getActiveElements === "function" ? tooltip.getActiveElements() : [];
    if (!Array.isArray(active) || active.length === 0) return;
    const x = Number(active[0]?.element?.x);
    if (!Number.isFinite(x)) return;
    const area = chart?.chartArea;
    const ctx = chart?.ctx;
    if (!area || !ctx) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.lineWidth = Number(pluginOptions?.lineWidth) > 0 ? Number(pluginOptions.lineWidth) : 1;
    ctx.strokeStyle = String(pluginOptions?.color || "rgba(148,163,184,0.35)");
    if (Array.isArray(pluginOptions?.dash)) ctx.setLineDash(pluginOptions.dash);
    ctx.stroke();
    ctx.restore();
  },
};

function CanvasSvg({
  svgRef,
  zoom, // ✅ already passed from App.jsx
  pan,
  onWheel, // ✅ already passed from App.jsx
  marquee, // ✅ NEW: drag-select rectangle

  tool,
  shapes,
  setShapes, // ✅ ADD: pass from App.jsx
  selectedIds,
  setSelectedIds,
  setSelectedOverlayIds,
  inlineEditId,
  selectedSegment,
  editingId,
  showTagPaths,
  showGrid,
  showRulers = true,
  useWindowPointerTracking = false,
  onSvgMouseDown,
  onMouseMove,
  onMouseUp,
  onContextMenu,
  onShapeMouseDown,
  onShapeDoubleClick,
  onEditPolylineClick,
  onHandleMouseDown,
  onHandleDoubleClick,
  onHandleContextMenu,
  onSegmentMouseDown,
  vbW,
  vbH,
  svgOverlays,
  setSvgOverlays, // ✅ ADD: pass from App.jsx
  selectedOverlayIds,
  singleSelectedOverlayId,
  setOverlayRef,
  onOverlayMouseDown,
  onOverlayDoubleClick,
  onOverlayContextMenu,
  overlaySelectionUI,
  overlayGroupSelectionUI,
  shapeSelectionUI,
  mixedSelectionUI,
  overlayLocalBBox,
  importAnchor,
  onCanvasDoubleClick,
  tagStateColorsByPath,
  routeColorsBySvgKey,
  routeStrokeColorByGroupPath,
  svgLiveValuesByGroupPath,
  ignitionTagValuesByPath,
  writeIgnitionTagValue = null,
  writeIgnitionOpcValue = null,
  liveTagKeys,
  opcTags,
  opcTemplateMap,
  opcTagMappingMap,
  opcMappingSetMap,
  widgetDbValues,
  binProductLabelByOverlayId,
  binNameLabelByOverlayId,
  binLevelRatioByOverlayId,
  binLockedInByOverlayId,
  binLockedOutByOverlayId,
  overlayHmiStateColorByOverlayId,
  overlayConnectionIssueByOverlayId = {},
  onWidgetDurationPresetChange,
  onTrendTagDrop,
  hiddenTagBubbleIds,
  onHideTagBubble,
  onSvgDoubleClick, // ✅ used in TopRuler + main svg
  collaboratorCursors,
  liveUpdatesEnabled = true,
  interactionActive = false,
  theme,
  canvasBackgroundColor,
  liveClickable = false,
  isLiveMode = false,
  perspectiveClientStore = null,
  preserveAspectRatioMode = "xMinYMin meet",
  forceStaticVisuals = false,
  viewportTopOffset = 0,
  viewportLeftOffset = 0,
  viewportScrollTarget = null,
  onViewportScroll = null,
  absoluteViewportLayout = true,
}) {
  const renderLiveVisuals = Boolean(isLiveMode && !forceStaticVisuals);
  const liveCanvasEnabled = Boolean(liveUpdatesEnabled && renderLiveVisuals);
  const widgetInteractionEnabled = Boolean(isLiveMode || liveClickable);
  const EmbeddedPerspectiveView =
    typeof window !== "undefined" ? window.PerspectiveClient?.View || null : null;
  const watchedLiveKeys = useMemo(() => {
    const source = liveCanvasEnabled && Array.isArray(liveTagKeys) ? liveTagKeys : [];
    const seen = new Set();
    const out = [];
    source.forEach((raw) => {
      const key = String(raw || "").replace(/\r?\n/g, "").trim();
      if (!key) return;
      const lower = key.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      out.push(key);
    });
    return out;
  }, [liveTagKeys, liveCanvasEnabled]);
  const opcLiveValuesRef = useRef(
    liveCanvasEnabled ? getOpcLiveValuesForKeys(watchedLiveKeys) : {}
  );
  const [liveRenderTick, setLiveRenderTick] = useState(0);
  const liveRenderRafRef = useRef(0);
  const interactionActiveRef = useRef(Boolean(interactionActive));
  useEffect(() => {
    interactionActiveRef.current = Boolean(interactionActive);
  }, [interactionActive]);
  const scheduleLiveRenderTick = useCallback(
    (force = false) => {
      if (!force && interactionActiveRef.current) return;
      if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
        setLiveRenderTick((x) => (x + 1) % 1000000);
        return;
      }
      if (liveRenderRafRef.current) return;
      liveRenderRafRef.current = window.requestAnimationFrame(() => {
        liveRenderRafRef.current = 0;
        if (!force && interactionActiveRef.current) return;
        setLiveRenderTick((x) => (x + 1) % 1000000);
      });
    },
    []
  );
  useEffect(
    () => () => {
      if (!liveRenderRafRef.current || typeof window === "undefined" || typeof window.cancelAnimationFrame !== "function") {
        return;
      }
      window.cancelAnimationFrame(liveRenderRafRef.current);
      liveRenderRafRef.current = 0;
    },
    []
  );
  useEffect(() => {
    if (!liveCanvasEnabled) {
      const emptyValues = {};
      opcLiveValuesRef.current = emptyValues;
      syncLiveInputSnapshot(emptyValues);
      if (liveRenderRafRef.current && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(liveRenderRafRef.current);
        liveRenderRafRef.current = 0;
      }
      setLiveRenderTick((x) => (x + 1) % 1000000);
      return undefined;
    }
    const nextLiveValues = getOpcLiveValuesForKeys(watchedLiveKeys);
    opcLiveValuesRef.current = nextLiveValues;
    syncLiveInputSnapshot(nextLiveValues);
    requestWorkerResolve(nextLiveValues);
    if (!watchedLiveKeys.length) return undefined;
    return subscribeOpcLiveKeys(watchedLiveKeys, () => {
      const updatedLiveValues = getOpcLiveValuesForKeys(watchedLiveKeys);
      opcLiveValuesRef.current = updatedLiveValues;
      syncLiveInputSnapshot(updatedLiveValues);
      requestWorkerResolve(updatedLiveValues);
    });
  }, [liveCanvasEnabled, watchedLiveKeys]);
  const opcLiveValues = liveCanvasEnabled ? opcLiveValuesRef.current : {};
  const vb = useMemo(() => `0 0 ${vbW} ${vbH}`, [vbW, vbH]);
  const rulerSize = showRulers ? RULER : 0;
  const isLineMode = tool === "polyline" || tool === "rect" || tool === "circle";
  const isCrosshair = isLineMode || marquee;
  const themeStrokeDefault = "#808080";
  const themeFillDefault = "#D7DADE";
  const isDarkTheme = String(theme || "").toLowerCase() === "dark";
  const [hoverOverlayId, setHoverOverlayId] = useState(null);
  const [viewportScroll, setViewportScroll] = useState({ x: 0, y: 0 });
  const [smoothedCollabCursors, setSmoothedCollabCursors] = useState([]);
  const collabCursorTargetsRef = useRef(new Map());
  const collabCursorRafRef = useRef(0);
  const collabCursorLastTsRef = useRef(0);
  const nudgeRafRef = useRef(0);
  const nudgePendingRef = useRef({ dx: 0, dy: 0 });
  const nudgeSelectedIdsRef = useRef(Array.isArray(selectedIds) ? selectedIds : []);
  const nudgeSelectedOverlayIdsRef = useRef(Array.isArray(selectedOverlayIds) ? selectedOverlayIds : []);
  const nudgeSelectedSegmentRef = useRef(selectedSegment || null);
  const nudgeZoomRef = useRef(Number(zoom) || 1);
  const getTextBounds = (shape, options = {}) => {
    if (!shape) return null;
    const minW = Number.isFinite(Number(options.minW)) ? Number(options.minW) : 40;
    const minH = Number.isFinite(Number(options.minH)) ? Number(options.minH) : 24;
    const charWidth = Number.isFinite(Number(options.charWidth)) ? Number(options.charWidth) : 0.6;
    const fontSize = Math.max(8, Number(shape.fontSize || 24));
    const text = String(shape.text || "");
    const w = Math.max(minW, text.length * fontSize * charWidth);
    const h = Math.max(minH, fontSize * 1.2);
    const anchor = shape.anchor === "middle" || shape.anchor === "end" ? shape.anchor : "start";
    const ax = anchor === "middle" ? -w / 2 : anchor === "end" ? -w : 0;
    return {
      x: Number(shape.x || 0) + ax,
      y: Number(shape.y || 0),
      w,
      h,
    };
  };
  const replaceSvgTextPlaceholdersCacheRef = useRef(new Map());
  const replaceSvgTextPlaceholders = (innerSvg, labels = {}) => {
    const source = String(innerSvg || "");
    const productLabel = String(labels?.product || "").trim();
    const binNoLabel = String(labels?.binNo || "").trim();
    if (!source.trim()) return source;
    const cacheKey = `${source}|${productLabel}|${binNoLabel}`;
    const cached = replaceSvgTextPlaceholdersCacheRef.current.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`,
        "image/svg+xml"
      );
      if (doc.querySelector("parsererror")) return source;
      const nodes = Array.from(doc.querySelectorAll("text"));
      let changed = 0;
      nodes.forEach((node) => {
        const current = String(node?.textContent || "").trim();
        if (!current) return;
        if (/^product$/i.test(current) || /^\{\{?\s*product\s*\}?\}$/i.test(current)) {
          if (productLabel) {
            node.textContent = productLabel;
          } else {
            node.textContent = "";
          }
          changed += 1;
          return;
        }
        if (
          binNoLabel &&
          (/^bin\s*no$/i.test(current) || /^\{\{?\s*bin\s*no\s*\}?\}$/i.test(current))
        ) {
          node.textContent = binNoLabel;
          changed += 1;
        }
      });
      if (!changed) {
        replaceSvgTextPlaceholdersCacheRef.current.set(cacheKey, source);
        return source;
      }
      const serializer = new XMLSerializer();
      const root = doc.documentElement;
      const result = Array.from(root.childNodes)
        .map((node) => serializer.serializeToString(node))
        .join("");
      if (replaceSvgTextPlaceholdersCacheRef.current.size > 200) {
        replaceSvgTextPlaceholdersCacheRef.current.clear();
      }
      replaceSvgTextPlaceholdersCacheRef.current.set(cacheKey, result);
      return result;
    } catch {
      return source;
    }
  };

  // wrapper size for rulers
  const wrapRef = useRef(null);
  const scrollThrottleRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    nudgeSelectedIdsRef.current = Array.isArray(selectedIds) ? selectedIds : [];
  }, [selectedIds]);
  useEffect(() => {
    nudgeSelectedOverlayIdsRef.current = Array.isArray(selectedOverlayIds) ? selectedOverlayIds : [];
  }, [selectedOverlayIds]);
  useEffect(() => {
    nudgeSelectedSegmentRef.current = selectedSegment || null;
  }, [selectedSegment]);
  useEffect(() => {
    nudgeZoomRef.current = Number(zoom) || 1;
  }, [zoom]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const x = Number(viewportScrollTarget?.x);
    const y = Number(viewportScrollTarget?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Math.abs(el.scrollLeft - x) > 0.5) el.scrollLeft = x;
    if (Math.abs(el.scrollTop - y) > 0.5) el.scrollTop = y;
    setViewportScroll({ x: Number(el.scrollLeft || 0), y: Number(el.scrollTop || 0) });
  }, [viewportScrollTarget?.x, viewportScrollTarget?.y]);

  // ✅ marquee rect coords (WORLD coords)
  const marqueeRect = useMemo(() => {
    if (!marquee) return null;
    const x = Math.min(marquee.start.x, marquee.cur.x);
    const y = Math.min(marquee.start.y, marquee.cur.y);
    const w = Math.abs(marquee.cur.x - marquee.start.x);
    const h = Math.abs(marquee.cur.y - marquee.start.y);
    return { x, y, w, h };
  }, [marquee]);

  const normalizeStickyActiveColor = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (isIgnitionStyleReference(raw)) return "";
    const lower = raw.toLowerCase();
    if (
      lower === "#808080" ||
      lower === "#d7dade" ||
      lower === "rgb(215,218,222)" ||
      lower === "rgba(215,218,222,1)" ||
      lower === "rgb(128,128,128)" ||
      lower === "gray" ||
      lower === "grey" ||
      lower === "#fff" ||
      lower === "#ffffff" ||
      lower === "white" ||
      lower === "rgb(255,255,255)" ||
      lower === "rgba(255,255,255,1)"
    ) {
      return "";
    }
    return raw;
  };
  const parseCssRgbChannels = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return null;
    const hex = raw.replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return hex.split("").map((ch) => parseInt(ch + ch, 16));
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    const rgbMatch = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!rgbMatch) return null;
    return rgbMatch.slice(1, 4).map((entry) => {
      const num = Number(entry);
      return Number.isFinite(num) ? Math.max(0, Math.min(255, num)) : 0;
    });
  };
  const normalizeOverlayActiveFillColor = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (isIgnitionStyleReference(raw)) return "";
    const lower = raw.toLowerCase();
    if (
      lower === "none" ||
      lower === "transparent" ||
      lower === "#fff" ||
      lower === "#ffffff" ||
      lower === "white" ||
      lower === "rgb(255,255,255)" ||
      lower === "rgba(255,255,255,1)"
    ) {
      return "";
    }
    const channels = parseCssRgbChannels(raw);
    if (Array.isArray(channels) && channels.length === 3) {
      const [r, g, b] = channels;
      if (Math.max(r, g, b) - Math.min(r, g, b) <= 24) return "";
    }
    return raw;
  };
  const getStateMappingPaint = (mapping) => String(
    mapping?.color ??
    mapping?.class ??
    mapping?.styleClass ??
    mapping?.className ??
    mapping?.style ??
    mapping?.cssClass ??
    ""
  ).trim();
  const matchStateMappingColor = (mappings, rawValue) => {
    const valueText = String(rawValue ?? "").trim();
    if (!valueText) return "";
    const valueNum = Number(rawValue);
    const valueLower = valueText.toLowerCase();
    const valueBool =
      valueLower === "true" || valueLower === "1"
        ? true
        : valueLower === "false" || valueLower === "0"
        ? false
        : null;
    for (const mapping of Array.isArray(mappings) ? mappings : []) {
      const color = getStateMappingPaint(mapping);
      if (!color) continue;
      const candidates = [mapping?.state, mapping?.field, mapping?.value, mapping?.input, mapping?.key];
      for (const candidateRaw of candidates) {
        const candidateText = String(candidateRaw ?? "").trim();
        if (!candidateText) continue;
        const candidateLower = candidateText.toLowerCase();
        const candidateNum = Number(candidateText);
        if (Number.isFinite(valueNum) && Number.isFinite(candidateNum) && candidateNum === valueNum) {
          return color;
        }
        const candidateBool =
          candidateLower === "true" || candidateLower === "1"
            ? true
            : candidateLower === "false" || candidateLower === "0"
            ? false
            : null;
        if (valueBool !== null && candidateBool !== null && candidateBool === valueBool) {
          return color;
        }
        if (candidateLower === valueLower) return color;
      }
    }
    return "";
  };
  const stateMappingsByPath = useMemo(() => {
    const map = new Map();
    const inferGroupName = (tag) => {
      const explicit = normalizeTagValue(tag?.groupName || "");
      if (explicit) return explicit;
      const rawPath = normalizeTagValue(tag?.tagPath || tag?.name || "");
      if (!rawPath.includes(".")) return "";
      return normalizeTagValue(rawPath.slice(0, rawPath.indexOf(".")));
    };
    const resolveTemplateStateMappings = (name) => {
      const visited = new Set();
      const out = new Map();
      const walk = (rawName) => {
        const lookupName = String(rawName || "").trim();
        if (!lookupName || visited.has(lookupName.toLowerCase())) return;
        visited.add(lookupName.toLowerCase());
        const template =
          opcTemplateMap?.get?.(lookupName) ||
          opcTemplateMap?.get?.(lookupName.toLowerCase()) ||
          null;
        if (!template) return;
        if (template.parent_name) walk(template.parent_name);
        if (Array.isArray(template.state_mappings)) {
          template.state_mappings.forEach((mapping) => {
            const field = String(mapping?.field ?? "").trim();
            const state = String(mapping?.state ?? "").trim();
            if (!field && !state) return;
            out.set(`${field}::${state}`, {
              field,
              state,
              color: getStateMappingPaint(mapping),
            });
          });
        }
      };
      walk(name);
      return Array.from(out.values());
    };
    (Array.isArray(opcTags) ? opcTags : []).forEach((tag) => {
      const tagPath = normalizeTagValue(tag?.tagPath || "");
      const tagName = normalizeTagValue(tag?.name || "");
      const topicName = normalizeTagValue(tag?.topic || "");
      const groupName = inferGroupName(tag);
      if (!(isStateTagPathKey(tagName) || isStateTagPathKey(tagPath))) return;
      const keyCandidates = Array.from(new Set([
        tagPath,
        topicName && tagName ? `${topicName}.${tagName}` : "",
        topicName && tagPath ? `${topicName}.${tagPath}` : "",
        ...buildStateTagParentPathCandidates(tagPath, tagName, groupName, topicName),
        groupName,
        topicName && groupName ? `${topicName}.${groupName}` : "",
      ]
        .map((entry) => normalizeTagValue(entry))
        .filter(Boolean)));
      if (!keyCandidates.length) return;
      const mappingKeys = [
        topicName && groupName && tagName ? `${topicName}.${groupName}.${tagName}` : "",
        topicName && groupName && tagPath ? `${topicName}.${groupName}.${tagPath}` : "",
        groupName && tagName ? `${groupName}.${tagName}` : "",
        groupName && tagPath ? `${groupName}.${tagPath}` : "",
        topicName && tagName ? `${topicName}.${tagName}` : "",
        topicName && tagPath ? `${topicName}.${tagPath}` : "",
        tagName,
        tagPath,
      ]
        .map((entry) => normalizeTagValue(entry))
        .filter(Boolean);
      const tagMappings = [];
      const seen = new Set();
      mappingKeys.forEach((key) => {
        const rows =
          opcTagMappingMap?.get?.(key) ||
          opcTagMappingMap?.get?.(key.toLowerCase()) ||
          [];
        rows.forEach((row) => {
          const signature = `${String(row?.field || "")}::${String(row?.state || "")}::${String(row?.color || "")}`;
          if (seen.has(signature)) return;
          seen.add(signature);
          tagMappings.push({
            field: String(row?.field ?? "").trim(),
            state: String(row?.state ?? "").trim(),
            color: getStateMappingPaint(row),
          });
        });
      });
      const mappingSetName = String(tag?.mappingSet || "").trim();
      const mappingSet =
        opcMappingSetMap?.get?.(mappingSetName) ||
        opcMappingSetMap?.get?.(mappingSetName.toLowerCase()) ||
        null;
      const setMappings = Array.isArray(mappingSet?.mappings)
        ? mappingSet.mappings.map((mapping) => ({
            field: String(mapping?.field ?? "").trim(),
            state: String(mapping?.state ?? "").trim(),
            color: getStateMappingPaint(mapping),
          }))
        : [];
      const templateMappings = resolveTemplateStateMappings(tag?.plcType);
      const mappings = tagMappings.length
        ? tagMappings
        : setMappings.length
        ? setMappings
        : templateMappings;
      if (!mappings.length) return;
      keyCandidates.forEach((key) => {
        map.set(key, mappings);
        map.set(key.toLowerCase(), mappings);
      });
    });
    return map;
  }, [opcTags, opcTemplateMap, opcTagMappingMap, opcMappingSetMap]);
  const getConfiguredHmiStateColor = (rawValue, rawTagPath = "") => {
    const candidates = buildTagPathCandidates(rawTagPath);
    for (const candidate of candidates) {
      const mappings =
        stateMappingsByPath.get(candidate) ||
        stateMappingsByPath.get(String(candidate || "").toLowerCase()) ||
        null;
      const configuredColor = matchStateMappingColor(mappings, rawValue);
      if (configuredColor) return configuredColor;
    }
    return "";
  };
  const renderTagColorCache = new Map();
  const renderRouteColorCache = new Map();
  const renderRouteStrokeColorCache = new Map();
  const renderOverlayLiveValueCache = new Map();
  const renderPolylineDisplayedColorCache = new Map();

  const getOverlayFillBinding = (overlay) => {
    const direct = overlay?.bindings?.fill;
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      return direct;
    }
    const legacy = overlay?.fillBinding;
    if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
      return legacy;
    }
    return null;
  };
  const getOverlayFillBindingTagPath = (overlay) => {
    const binding = getOverlayFillBinding(overlay);
    return String(
      binding?.tagPath ??
      binding?.path ??
      binding?.sourcePath ??
      overlay?.tagPath ??
      ""
    ).trim();
  };
  const getOverlayFillBindingMappings = (overlay) => {
    const binding = getOverlayFillBinding(overlay);
    if (!binding) return [];
    return Array.isArray(binding?.transform?.mappings)
      ? binding.transform.mappings
      : Array.isArray(binding?.mappings)
      ? binding.mappings
      : [];
  };
  const getOverlayFillBindingFallbackColor = (overlay) => {
    const binding = getOverlayFillBinding(overlay);
    return String(
      binding?.transform?.fallbackColor ??
      binding?.fallbackColor ??
      overlay?.fill ??
      ""
    ).trim();
  };
  const readIgnitionTagValueForPath = (rawTagPath) => {
    const key = String(rawTagPath || "").trim();
    if (!key) return undefined;
    if (ignitionTagValuesByPath instanceof Map) {
      return ignitionTagValuesByPath.get(key) ?? ignitionTagValuesByPath.get(key.toLowerCase());
    }
    if (ignitionTagValuesByPath && typeof ignitionTagValuesByPath === "object") {
      return ignitionTagValuesByPath[key] ?? ignitionTagValuesByPath[key.toLowerCase()];
    }
    return undefined;
  };
  const readIgnitionMemberValueForPath = (rawTagPath, aliases = []) => {
    const candidates = buildTagPathMemberCandidates(rawTagPath, aliases);
    for (const candidate of candidates) {
      const value = readIgnitionTagValueForPath(candidate);
      if (value != null && String(value).trim() !== "") {
        return value;
      }
    }
    return undefined;
  };
  const readOverlayFillBindingValue = (overlay) => {
    const key = getOverlayFillBindingTagPath(overlay);
    const direct = readIgnitionTagValueForPath(key);
    if (direct != null && String(direct).trim() !== "") {
      return direct;
    }

    const keyLeaf = String(key || "").split(/[/.]/).filter(Boolean).pop() || "";
    if (key && !isStateTagKey(keyLeaf)) {
      const memberValue = readIgnitionMemberValueForPath(key, LIVE_STATE_MEMBER_ALIASES);
      if (memberValue != null && String(memberValue).trim() !== "") {
        return memberValue;
      }
    }

    const overlayTagPath = String(overlay?.tagPath || "").trim();
    if (overlayTagPath && overlayTagPath.toLowerCase() !== String(key || "").toLowerCase()) {
      const overlayLeaf = overlayTagPath.split(/[/.]/).filter(Boolean).pop() || "";
      if (!isStateTagKey(overlayLeaf)) {
        const overlayMemberValue = readIgnitionMemberValueForPath(overlayTagPath, LIVE_STATE_MEMBER_ALIASES);
        if (overlayMemberValue != null && String(overlayMemberValue).trim() !== "") {
          return overlayMemberValue;
        }
      }
    }

    return direct;
  };
  const getOverlayBoundFillColor = (overlay) => {
    if (isDiverterEType(overlay?.eType)) return "";
    const binding = getOverlayFillBinding(overlay);
    if (!binding) return "";
    const rawValue = readOverlayFillBindingValue(overlay);
    const fallbackColor = getOverlayFillBindingFallbackColor(overlay);
    if (rawValue == null || String(rawValue).trim() === "") {
      return fallbackColor;
    }
    return matchStateMappingColor(getOverlayFillBindingMappings(overlay), rawValue) || fallbackColor;
  };
  const getOverlayBoundActiveFillColor = (overlay) => {
    if (isDiverterEType(overlay?.eType)) return "";
    const binding = getOverlayFillBinding(overlay);
    if (!binding) return "";
    const rawValue = readOverlayFillBindingValue(overlay);
    if (rawValue == null || String(rawValue).trim() === "") {
      return "";
    }
    const mappedColor = matchStateMappingColor(getOverlayFillBindingMappings(overlay), rawValue);
    if (isIgnitionStyleReference(mappedColor)) return String(mappedColor || "").trim();
    return normalizeActiveLineColor(mappedColor);
  };
  const getOverlayDisplayedFlowFillColor = (overlay) => {
    if (isDiverterEType(overlay?.eType)) return "";
    return normalizeOverlayActiveFillColor(
      getOverlayBoundFillColor(overlay) ||
      overlay?.fill ||
      ""
    );
  };
  const readLookupValue = (lookup, rawKey) => {
    const key = String(rawKey || "").trim();
    if (!key || !lookup) return "";
    if (lookup instanceof Map) {
      return lookup.get(key) || lookup.get(key.toLowerCase()) || "";
    }
    if (typeof lookup === "object") {
      return lookup[key] || lookup[key.toLowerCase()] || "";
    }
    return "";
  };

  const getTagColor = (tagPath) => {
    if (!renderLiveVisuals) return "";
    if (!effectiveTagStateColorsByPath) return "";
    const key = String(tagPath || "").replace(/\r?\n/g, "").trim();
    if (!key) return "";
    const cacheKey = key.toLowerCase();
    if (renderTagColorCache.has(cacheKey)) {
      return renderTagColorCache.get(cacheKey);
    }
    const resolveStickyColor = (resolvedColor) => {
      if (!liveCanvasEnabled) return String(resolvedColor || "").trim();
      const activeColor = normalizeStickyActiveColor(resolvedColor);
      if (activeColor) {
        lastTagColorRef.current.set(cacheKey, activeColor);
        return activeColor;
      }
      const raw = String(resolvedColor || "").trim();
      if (raw) {
        lastTagColorRef.current.delete(cacheKey);
        return raw;
      }
      return String(lastTagColorRef.current.get(cacheKey) || "").trim();
    };
    const direct =
      effectiveTagStateColorsByPath.get(key) ||
      effectiveTagStateColorsByPath.get(cacheKey) ||
      "";
    if (direct) {
      const resolved = resolveStickyColor(direct);
      renderTagColorCache.set(cacheKey, resolved);
      return resolved;
    }
    const parts = key.split(".").map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      const suffix = parts.slice(i).join(".");
      const match =
        effectiveTagStateColorsByPath.get(suffix) ||
        effectiveTagStateColorsByPath.get(suffix.toLowerCase()) ||
        "";
      if (match) {
        const resolved = resolveStickyColor(match);
        renderTagColorCache.set(cacheKey, resolved);
        return resolved;
      }
    }
    const mappedMemberCandidates = buildTagPathMemberCandidates(
      key,
      LIVE_STATE_MEMBER_ALIASES
    );
    for (const candidate of mappedMemberCandidates) {
      const match =
        effectiveTagStateColorsByPath.get(candidate) ||
        effectiveTagStateColorsByPath.get(String(candidate || "").toLowerCase()) ||
        "";
      if (match) {
        const resolved = resolveStickyColor(match);
        renderTagColorCache.set(cacheKey, resolved);
        return resolved;
      }
    }
    const stateCandidates = [key, ...parts.slice(1).map((_, idx) => parts.slice(idx + 1).join("."))];
    for (const candidate of stateCandidates) {
      const liveStateEntry =
        effectiveSvgLiveValuesByGroupPath?.get(candidate) ||
        effectiveSvgLiveValuesByGroupPath?.get(String(candidate || "").toLowerCase()) ||
        null;
      const fallbackColor = getConfiguredHmiStateColor(liveStateEntry?.state, candidate);
      if (fallbackColor) {
        const resolved = resolveStickyColor(fallbackColor);
        renderTagColorCache.set(cacheKey, resolved);
        return resolved;
      }
    }
    const resolved = resolveStickyColor("");
    renderTagColorCache.set(cacheKey, resolved);
    return resolved;
  };

  const getRouteColorForOverlay = (overlay) => {
    const cacheKey = String(overlay?.id || overlay?.tagPath || overlay?.name || "").trim().toLowerCase();
    if (cacheKey && renderRouteColorCache.has(cacheKey)) {
      return renderRouteColorCache.get(cacheKey);
    }
    const routeColorFromIgnition = String(
      readIgnitionMemberValueForPath(overlay?.tagPath, LIVE_ROUTE_COLOR_MEMBER_ALIASES) ??
      readIgnitionMemberValueForPath(getOverlayFillBindingTagPath(overlay), LIVE_ROUTE_COLOR_MEMBER_ALIASES) ??
      ""
    ).trim();
    if (routeColorFromIgnition) {
      if (cacheKey) renderRouteColorCache.set(cacheKey, routeColorFromIgnition);
      return routeColorFromIgnition;
    }
    const routeColorFromLive = String(
      getLiveMemberValueForTagPath(overlay?.tagPath, LIVE_ROUTE_COLOR_MEMBER_ALIASES) ??
      ""
    ).trim();
    if (routeColorFromLive) {
      if (cacheKey) renderRouteColorCache.set(cacheKey, routeColorFromLive);
      return routeColorFromLive;
    }
    if (!routeColorsBySvgKey) {
      if (cacheKey) renderRouteColorCache.set(cacheKey, "");
      return "";
    }
    const lookup = (raw) => {
      const key = String(raw || "").replace(/\r?\n/g, "").trim();
      if (!key) return "";
      const base = (key.split("/").pop() || "").trim();
      return (
        readLookupValue(routeColorsBySvgKey, key) ||
        (base ? readLookupValue(routeColorsBySvgKey, base) : "") ||
        ""
      );
    };
    const resolved = lookup(overlay?.tagPath) || lookup(overlay?.name) || lookup(overlay?.id) || "";
    if (cacheKey) renderRouteColorCache.set(cacheKey, resolved);
    return resolved;
  };

  const getRouteStrokeColorForOverlay = (overlay) => {
    if (!effectiveRouteStrokeColorByGroupPath) return "";
    const key = String(overlay?.tagPath || "").replace(/\r?\n/g, "").trim();
    const cacheKey = key.toLowerCase();
    if (cacheKey && renderRouteStrokeColorCache.has(cacheKey)) {
      return renderRouteStrokeColorCache.get(cacheKey);
    }
    const direct = (
      readLookupValue(effectiveRouteStrokeColorByGroupPath, key) ||
      readLookupValue(effectiveRouteStrokeColorByGroupPath, cacheKey) ||
      ""
    );
    if (direct) {
      if (cacheKey) renderRouteStrokeColorCache.set(cacheKey, direct);
      return direct;
    }

    const groupLive = getLiveValuesForOverlay(overlay);
    const fallbackGroupState = getGroupRouteStateForTagPath(overlay?.tagPath);
    const routeId = String(groupLive?.routeId || fallbackGroupState?.routeId || "").trim();
    if (!routeId) return "";
    const routeIdLower = routeId.toLowerCase();
    const routeColor = routeColorsBySvgKey
      ? readLookupValue(routeColorsBySvgKey, routeId) ||
        readLookupValue(routeColorsBySvgKey, routeIdLower) ||
        ""
      : "";
    const normalizedColor = String(routeColor || "").trim();
    if (normalizedColor) {
      if (cacheKey) renderRouteStrokeColorCache.set(cacheKey, normalizedColor);
      return normalizedColor;
    }
    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(routeId)) {
      if (cacheKey) renderRouteStrokeColorCache.set(cacheKey, routeId);
      return routeId;
    }
    if (cacheKey) renderRouteStrokeColorCache.set(cacheKey, "");
    return "";
  };

  const getLiveValuesForOverlay = (overlay) => {
    if (!effectiveSvgLiveValuesByGroupPath) return null;
    const key = String(overlay?.tagPath || "").replace(/\r?\n/g, "").trim();
    if (!key) return null;
    const cacheKey = key.toLowerCase();
    if (renderOverlayLiveValueCache.has(cacheKey)) {
      return renderOverlayLiveValueCache.get(cacheKey);
    }
    const resolved = (
      effectiveSvgLiveValuesByGroupPath.get(key) ||
      effectiveSvgLiveValuesByGroupPath.get(cacheKey) ||
      null
    );
    renderOverlayLiveValueCache.set(cacheKey, resolved);
    return resolved;
  };

  const getOverlayGroupLabel = (overlay) => {
    if (overlay?.embeddedView) return "";
    const raw = String(overlay?.tagPath || "").replace(/\r?\n/g, "").trim();
    if (!raw) return "";
    const parts = raw.split(".").map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.slice(1).join(".");
    return raw;
  };

  const liveLookupKeyListRef = useRef([]);
  const liveLookupKeyList = useMemo(() => {
    const source = Array.isArray(watchedLiveKeys) ? watchedLiveKeys : [];
    const seen = new Set();
    const out = [];
    source.forEach((raw) => {
      const key = String(raw || "").replace(/\r?\n/g, "").trim();
      if (!key) return;
      const lower = key.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        out.push(key);
      }
      if (key !== lower && !seen.has(`${lower}::lower`)) {
        seen.add(`${lower}::lower`);
        out.push(lower);
      }
    });
    // Return same array reference when content is unchanged to prevent cascade re-renders
    const prev = liveLookupKeyListRef.current;
    if (out.length === prev.length && out.every((v, i) => v === prev[i])) return prev;
    liveLookupKeyListRef.current = out;
    return out;
  }, [watchedLiveKeys]);
  const liveLookupRef = useRef(opcLiveValues && typeof opcLiveValues === "object" ? opcLiveValues : {});
  const liveResolvedKeyByPathRef = useRef(new Map());
  const liveValueByPathRef = useRef(new Map());
  const liveResolvedValueByPathRef = useRef(new Map());
  const liveGroupRouteStateByPathRef = useRef(new Map());
  const liveResolvedTagColorByPathRef = useRef(new Map());
  const liveResolvedRouteStrokeByPathRef = useRef(new Map());
  const liveResolvedDiverterEntryColorByIdRef = useRef(new Map());
  const liveResolvedPolylineColorByIdRef = useRef(new Map());
  const liveResolvedPolylineSplitCarryByIdRef = useRef({});
  const liveResolvedPolylineSplitCarrySerializedRef = useRef("");
  const liveEmptyTagColorMapRef = useRef(new Map());
  const liveEmptyRouteStrokeMapRef = useRef(new Map());
  const liveEmptyGroupValuesMapRef = useRef(new Map());
  const liveDerivedVisualState = useMemo(() => {
    const fallbackTagColors =
      tagStateColorsByPath instanceof Map ? tagStateColorsByPath : new Map();
    const fallbackRouteColors =
      routeStrokeColorByGroupPath instanceof Map ? routeStrokeColorByGroupPath : new Map();
    const fallbackGroupValues =
      svgLiveValuesByGroupPath instanceof Map ? svgLiveValuesByGroupPath : new Map();
    if (!liveCanvasEnabled) {
      return {
        tagStateColorsByPath: fallbackTagColors,
        routeStrokeColorByGroupPath: fallbackRouteColors,
        svgLiveValuesByGroupPath: fallbackGroupValues,
      };
    }
    return {
      tagStateColorsByPath:
        liveResolvedTagColorByPathRef.current instanceof Map && liveResolvedTagColorByPathRef.current.size
          ? liveResolvedTagColorByPathRef.current
          : fallbackTagColors,
      routeStrokeColorByGroupPath:
        liveResolvedRouteStrokeByPathRef.current instanceof Map && liveResolvedRouteStrokeByPathRef.current.size
          ? liveResolvedRouteStrokeByPathRef.current
          : fallbackRouteColors,
      svgLiveValuesByGroupPath:
        liveGroupRouteStateByPathRef.current instanceof Map && liveGroupRouteStateByPathRef.current.size
          ? liveGroupRouteStateByPathRef.current
          : fallbackGroupValues,
    };
  }, [
    liveCanvasEnabled,
    liveRenderTick,
    tagStateColorsByPath,
    routeStrokeColorByGroupPath,
    svgLiveValuesByGroupPath,
  ]);
  const effectiveTagStateColorsByPath = liveDerivedVisualState.tagStateColorsByPath;
  const effectiveRouteStrokeColorByGroupPath = liveDerivedVisualState.routeStrokeColorByGroupPath;
  const effectiveSvgLiveValuesByGroupPath = liveDerivedVisualState.svgLiveValuesByGroupPath;
  const selectedShapeIdSet = useMemo(
    () => new Set(Array.isArray(selectedIds) ? selectedIds : []),
    [selectedIds]
  );
  const shapeById = useMemo(() => {
    const map = new Map();
    (Array.isArray(shapes) ? shapes : []).forEach((shape) => {
      const id = String(shape?.id || "").trim();
      if (!id || map.has(id)) return;
      map.set(id, shape);
    });
    return map;
  }, [shapes]);
  const overlayById = useMemo(() => {
    const map = new Map();
    (Array.isArray(svgOverlays) ? svgOverlays : []).forEach((overlay) => {
      const id = String(overlay?.id || "").trim();
      if (!id) return;
      map.set(id, overlay);
    });
    return map;
  }, [svgOverlays]);
  const overlayHandlerRefs = useRef({
    setOverlayRef,
    onOverlayMouseDown,
    onOverlayDoubleClick,
  });
  useEffect(() => {
    overlayHandlerRefs.current = {
      setOverlayRef,
      onOverlayMouseDown,
      onOverlayDoubleClick,
    };
  }, [setOverlayRef, onOverlayMouseDown, onOverlayDoubleClick]);
  const applyOverlayNodeRef = useCallback((id, node) => {
    overlayHandlerRefs.current.setOverlayRef?.(id, node);
  }, []);
  const handleOverlayMouseDown = useCallback(
    (event, overlay) => {
      if (widgetInteractionEnabled && overlay?.widget) return;
      overlayHandlerRefs.current.onOverlayMouseDown?.(event, overlay?.id);
    },
    [widgetInteractionEnabled]
  );
  const handleOverlayDoubleClick = useCallback(
    (event, overlay, options = {}) => {
      if (!options.force && widgetInteractionEnabled && overlay?.widget) return;
      overlayHandlerRefs.current.onOverlayDoubleClick?.(event, overlay?.id);
    },
    [widgetInteractionEnabled]
  );
  const opcTagCount = Array.isArray(opcTags) ? opcTags.length : 0;
  const shapeCount = Array.isArray(shapes) ? shapes.length : 0;
  const polylineCount = useMemo(
    () =>
      (Array.isArray(shapes) ? shapes : []).reduce(
        (count, shape) => (shape?.type === "polyline" ? count + 1 : count),
        0
      ),
    [shapes]
  );
  const overlayCount = Array.isArray(svgOverlays) ? svgOverlays.length : 0;
  const liveTopologyStressMode =
    renderLiveVisuals &&
    (
      watchedLiveKeys.length >= 24 ||
      polylineCount >= 80 ||
      overlayCount >= 140 ||
      polylineCount + overlayCount >= 180
    );
  // Disable widget data-polling (trends, bar charts, weather, live-series sampling) only when
  // liveUpdatesEnabled is false or too many OPC tags, or in design mode with many items.
  // Do NOT disable in live mode — charts must load data and sparklines must accumulate.
  const disableWidgetBackgroundWork =
    !liveUpdatesEnabled || opcTagCount >= 120 ||
    (!renderLiveVisuals && shapeCount + overlayCount >= 20);
  // In live mode OPC values already flow at 220ms via the subscription, so the sample tick
  // should be slower to avoid stacking re-renders on top of the subscription renders.
  const widgetLiveSampleIntervalMs = renderLiveVisuals ? 2000 : 450;
  const liveResolveWorkerRef = useRef(null);
  const liveResolveRequestIdRef = useRef(0);
  const syncLiveInputSnapshot = useCallback((nextValues) => {
    liveLookupRef.current =
      nextValues && typeof nextValues === "object" ? nextValues : {};
    liveValueByPathRef.current = new Map();
  }, []);
  const plainObjectMatchesMap = (map, rawObj) => {
    const src = rawObj && typeof rawObj === "object" ? rawObj : {};
    const keys = Object.keys(src);
    if (!(map instanceof Map)) return keys.length === 0;
    if (map.size !== keys.length) return false;
    for (const key of keys) {
      if (!Object.is(map.get(key), src[key])) return false;
    }
    return true;
  };
  const groupStateObjectMatchesMap = (map, rawObj) => {
    const src = rawObj && typeof rawObj === "object" ? rawObj : {};
    const keys = Object.keys(src);
    if (!(map instanceof Map)) return keys.length === 0;
    if (map.size !== keys.length) return false;
    for (const key of keys) {
      const nextValue = src[key] && typeof src[key] === "object" ? src[key] : {};
      const prevValue = map.get(key) || {};
      if (
        String(prevValue?.routeId || "") !== String(nextValue?.routeId || "") ||
        String(prevValue?.state || "") !== String(nextValue?.state || "")
      ) {
        return false;
      }
    }
    return true;
  };
  const requestWorkerResolve = useCallback(
    (nextValues) => {
      if (!liveCanvasEnabled) return;
      const worker = liveResolveWorkerRef.current;
      if (!worker) return;
      const id = Number(liveResolveRequestIdRef.current || 0) + 1;
      liveResolveRequestIdRef.current = id;
      worker.postMessage({
        type: "resolve",
        id,
        liveValues:
          nextValues && typeof nextValues === "object" ? nextValues : {},
      });
    },
    [liveCanvasEnabled]
  );
  const liveResolveTagPaths = useMemo(() => {
    if (!liveCanvasEnabled) return [];
    const seen = new Set();
    const out = [];
    const push = (raw) => {
      const key = String(raw || "").replace(/\r?\n/g, "").trim();
      if (!key) return;
      const lower = key.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      out.push(key);
    };
    (Array.isArray(shapes) ? shapes : []).forEach((shape) => {
      push(shape?.tagPath);
    });
    (Array.isArray(svgOverlays) ? svgOverlays : []).forEach((overlay) => {
      push(overlay?.tagPath);
      const widget = overlay?.widget || {};
      push(widget?.timerAccTag);
      push(widget?.timerPresetTag);
      push(widget?.timerDoneTag);
      push(widget?.timerEnableTag);
      const seriesTags = Array.isArray(widget?.seriesTags) ? widget.seriesTags : [];
      seriesTags.forEach((entry) => {
        if (typeof entry === "string") {
          push(entry);
          return;
        }
        if (entry && typeof entry === "object") {
          push(entry?.tagPath);
          push(entry?.tag);
          push(entry?.key);
        }
      });
    });
    return out.slice(0, 480);
  }, [shapes, svgOverlays, liveCanvasEnabled]);
  const liveResolveScenePayload = useMemo(() => {
    if (!liveCanvasEnabled) return null;
    return {
      tagPaths: Array.isArray(liveResolveTagPaths) ? liveResolveTagPaths : [],
      shapes: (Array.isArray(shapes) ? shapes : [])
        .filter((shape) => shape?.type === "polyline" && Array.isArray(shape?.points) && shape.points.length >= 2)
        .map((shape) => ({
          id: String(shape?.id || "").trim(),
          type: "polyline",
          tagPath: String(shape?.tagPath || "").trim(),
          stroke: String(shape?.stroke || "").trim(),
          points: shape.points.map((point) => ({
            x: Number(point?.x) || 0,
            y: Number(point?.y) || 0,
          })),
        })),
      overlays: (Array.isArray(svgOverlays) ? svgOverlays : [])
        .filter((overlay) => !overlay?.widget && overlay?.bbox)
        .map((overlay) => ({
          id: String(overlay?.id || "").trim(),
          tagPath: String(overlay?.tagPath || "").trim(),
          name: String(overlay?.name || "").trim(),
          sourceKey: String(overlay?.sourceKey || "").trim(),
          eType: String(overlay?.eType || "").trim(),
          diverterMode: String(overlay?.diverterMode || "").trim(),
          tx: Number(overlay?.tx) || 0,
          ty: Number(overlay?.ty) || 0,
          scale: Number(overlay?.scale) || 1,
          scaleX: Number.isFinite(Number(overlay?.scaleX)) ? Number(overlay.scaleX) : null,
          scaleY: Number.isFinite(Number(overlay?.scaleY)) ? Number(overlay.scaleY) : null,
          bbox: overlay?.bbox
            ? {
                x: Number(overlay.bbox?.x) || 0,
                y: Number(overlay.bbox?.y) || 0,
                width: Number(overlay.bbox?.width) || 0,
                height: Number(overlay.bbox?.height) || 0,
              }
            : null,
        })),
      tags: Array.isArray(opcTags) ? opcTags : [],
      routeColorEntries: routeColorsBySvgKey instanceof Map ? Array.from(routeColorsBySvgKey.entries()) : [],
      templateEntries: opcTemplateMap instanceof Map ? Array.from(opcTemplateMap.entries()) : [],
      tagMappingEntries: opcTagMappingMap instanceof Map ? Array.from(opcTagMappingMap.entries()) : [],
      mappingSetEntries: opcMappingSetMap instanceof Map ? Array.from(opcMappingSetMap.entries()) : [],
    };
  }, [
    liveCanvasEnabled,
    liveResolveTagPaths,
    shapes,
    svgOverlays,
    opcTags,
    routeColorsBySvgKey,
    opcTemplateMap,
    opcTagMappingMap,
    opcMappingSetMap,
  ]);
  useEffect(() => {
    if (liveCanvasEnabled) return;
    liveResolvedValueByPathRef.current = new Map();
    liveGroupRouteStateByPathRef.current = new Map();
    liveResolvedTagColorByPathRef.current = new Map();
    liveResolvedRouteStrokeByPathRef.current = new Map();
    liveResolvedDiverterEntryColorByIdRef.current = new Map();
    liveResolvedPolylineColorByIdRef.current = new Map();
    liveResolvedPolylineSplitCarryByIdRef.current = {};
    liveResolvedPolylineSplitCarrySerializedRef.current = "";
  }, [liveCanvasEnabled]);
  useEffect(() => {
    if (!liveCanvasEnabled) return undefined;
    if (typeof Worker === "undefined") return undefined;
    let worker;
    try {
      worker = new Worker(new URL("../workers/canvasLiveResolveWorker.js", import.meta.url), {
        type: "module",
      });
    } catch {
      return undefined;
    }
    liveResolveWorkerRef.current = worker;
    const onMessage = (event) => {
      const data = event?.data || {};
      if (String(data?.type || "") !== "resolved") return;
      const phase = String(data?.phase || "full").toLowerCase();
      const isBasicPhase = phase === "basic";
      const id = Number(data?.id || 0);
      if (!id || id !== Number(liveResolveRequestIdRef.current || 0)) return;
      const byPathRaw = data?.byTagPath && typeof data.byTagPath === "object" ? data.byTagPath : {};
      const groupRaw =
        data?.groupByTagPath && typeof data.groupByTagPath === "object"
          ? data.groupByTagPath
          : {};
      const tagColorRaw =
        data?.tagColorByPath && typeof data.tagColorByPath === "object"
          ? data.tagColorByPath
          : {};
      const routeStrokeRaw =
        data?.routeStrokeByPath && typeof data.routeStrokeByPath === "object"
          ? data.routeStrokeByPath
          : {};
      const diverterEntryRaw =
        data?.diverterEntryColorById && typeof data.diverterEntryColorById === "object"
          ? data.diverterEntryColorById
          : {};
      const polylineRaw =
        data?.polylineColorById && typeof data.polylineColorById === "object"
          ? data.polylineColorById
          : {};
      const polylineSplitCarryRaw =
        data?.polylineSplitCarryById && typeof data.polylineSplitCarryById === "object"
          ? data.polylineSplitCarryById
          : {};
      const resolvedValueChanged = !plainObjectMatchesMap(liveResolvedValueByPathRef.current, byPathRaw);
      const groupStateChanged = !groupStateObjectMatchesMap(liveGroupRouteStateByPathRef.current, groupRaw);
      const tagColorChanged = !plainObjectMatchesMap(liveResolvedTagColorByPathRef.current, tagColorRaw);
      const routeStrokeChanged = !plainObjectMatchesMap(liveResolvedRouteStrokeByPathRef.current, routeStrokeRaw);
      const diverterChanged = !plainObjectMatchesMap(
        liveResolvedDiverterEntryColorByIdRef.current,
        diverterEntryRaw
      );
      const polylineChanged = !plainObjectMatchesMap(
        liveResolvedPolylineColorByIdRef.current,
        polylineRaw
      );
      const polylineSplitCarrySerialized = JSON.stringify(polylineSplitCarryRaw);
      const polylineSplitCarryChanged =
        liveResolvedPolylineSplitCarrySerializedRef.current !== polylineSplitCarrySerialized;
      if (resolvedValueChanged) {
        liveResolvedValueByPathRef.current = new Map(Object.entries(byPathRaw));
        liveValueByPathRef.current = new Map();
      }
      if (groupStateChanged) {
        liveGroupRouteStateByPathRef.current = new Map(
          Object.entries(groupRaw).map(([key, value]) => [
            key,
            {
              routeId: String(value?.routeId || ""),
              state: String(value?.state || ""),
            },
          ])
        );
      }
      if (tagColorChanged) {
        liveResolvedTagColorByPathRef.current = new Map(Object.entries(tagColorRaw));
      }
      if (routeStrokeChanged) {
        liveResolvedRouteStrokeByPathRef.current = new Map(Object.entries(routeStrokeRaw));
      }
      if (!isBasicPhase && diverterChanged) {
        liveResolvedDiverterEntryColorByIdRef.current = new Map(Object.entries(diverterEntryRaw));
      }
      if (!isBasicPhase && polylineChanged) {
        liveResolvedPolylineColorByIdRef.current = new Map(Object.entries(polylineRaw));
      }
      if (!isBasicPhase && polylineSplitCarryChanged) {
        liveResolvedPolylineSplitCarryByIdRef.current = polylineSplitCarryRaw;
        liveResolvedPolylineSplitCarrySerializedRef.current = polylineSplitCarrySerialized;
      }
      if (
        resolvedValueChanged ||
        groupStateChanged ||
        tagColorChanged ||
        routeStrokeChanged ||
        (!isBasicPhase && diverterChanged) ||
        (!isBasicPhase && polylineChanged) ||
        (!isBasicPhase && polylineSplitCarryChanged)
      ) {
        scheduleLiveRenderTick(false);
      }
    };
    worker.addEventListener("message", onMessage);
    return () => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      if (liveResolveWorkerRef.current === worker) {
        liveResolveWorkerRef.current = null;
      }
    };
  }, [scheduleLiveRenderTick, liveCanvasEnabled]);
  useEffect(() => {
    if (!liveCanvasEnabled) return;
    const worker = liveResolveWorkerRef.current;
    if (!worker || !liveResolveScenePayload) return;
    worker.postMessage({
      type: "setScene",
      scene: liveResolveScenePayload,
    });
    requestWorkerResolve(opcLiveValuesRef.current);
  }, [liveCanvasEnabled, liveResolveScenePayload, requestWorkerResolve]);

  const readLiveValue = (rawKey) => {
    const src = liveLookupRef.current && typeof liveLookupRef.current === "object"
      ? liveLookupRef.current
      : {};
    const key = String(rawKey || "").replace(/\r?\n/g, "").trim();
    if (!key) return undefined;
    if (Object.prototype.hasOwnProperty.call(src, key)) return src[key];
    const lower = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(src, lower)) return src[lower];
    if (!liveCanvasEnabled) return undefined;
    const globalSnapshot = getOpcLiveSnapshot();
    if (globalSnapshot && typeof globalSnapshot === "object") {
      if (Object.prototype.hasOwnProperty.call(globalSnapshot, key)) return globalSnapshot[key];
      if (Object.prototype.hasOwnProperty.call(globalSnapshot, lower)) return globalSnapshot[lower];
    }
    return undefined;
  };

  const buildTagPathCandidates = (rawTagPath) => {
    const tagPath = String(rawTagPath || "").replace(/\r?\n/g, "").trim();
    if (!tagPath) return [];
    const parts = tagPath.split(".").map((x) => x.trim()).filter(Boolean);
    const seen = new Set();
    const out = [];
    const push = (raw) => {
      const value = String(raw || "").replace(/\r?\n/g, "").trim();
      if (!value) return;
      const lower = value.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      out.push(value);
    };
    push(tagPath);
    for (let i = 1; i < parts.length; i += 1) {
      push(parts.slice(i).join("."));
    }
    if (!tagPath.toLowerCase().startsWith("default.")) {
      push(`Default.${tagPath}`);
    }
    return out;
  };

  const buildTagPathMemberCandidates = (rawTagPath, aliases = []) => {
    const parents = buildTagPathCandidates(rawTagPath);
    if (!parents.length || !Array.isArray(aliases) || aliases.length === 0) return [];
    const seen = new Set();
    const out = [];
    const push = (raw) => {
      const value = String(raw || "").replace(/\r?\n/g, "").trim();
      if (!value) return;
      const lower = value.toLowerCase();
      if (seen.has(lower)) return;
      seen.add(lower);
      out.push(value);
    };
    parents.forEach((parent) => {
      aliases.forEach((alias) => {
        const member = String(alias || "").replace(/\r?\n/g, "").trim();
        if (!member) return;
        push(`${parent}.${member}`);
        push(`${parent}/${member}`);
      });
    });
    return out;
  };

  const getFirstLiveValueForCandidates = (candidates) => {
    const list = Array.isArray(candidates) ? candidates : [];
    for (const rawKey of list) {
      const key = String(rawKey || "").replace(/\r?\n/g, "").trim();
      if (!key) continue;
      const exact = readLiveValue(key);
      if (exact != null && exact !== "") return exact;
      const lowerKey = key.toLowerCase();
      const lowerExact = readLiveValue(lowerKey);
      if (lowerExact != null && lowerExact !== "") return lowerExact;
      const dotSuffix = `.${lowerKey}`;
      const slashSuffix = `/${lowerKey}`;
      for (const mapKey of liveLookupKeyList) {
        const mapValue = readLiveValue(mapKey);
        if (mapValue == null || mapValue === "") continue;
        const textKey = String(mapKey || "").trim().toLowerCase();
        if (
          textKey === lowerKey ||
          textKey.endsWith(dotSuffix) ||
          textKey.endsWith(slashSuffix)
        ) {
          return mapValue;
        }
      }
    }
    return null;
  };

  const getLiveMemberValueForTagPath = (rawTagPath, aliases = []) => {
    const candidates = buildTagPathMemberCandidates(rawTagPath, aliases);
    return getFirstLiveValueForCandidates(candidates);
  };

  const getLiveValueForTagPath = (rawTagPath) => {
    const tagPath = String(rawTagPath || "").replace(/\r?\n/g, "").trim();
    if (!tagPath) return "";
    const cacheKey = tagPath.toLowerCase();
    if (liveResolvedValueByPathRef.current.has(cacheKey)) {
      const fromWorker = liveResolvedValueByPathRef.current.get(cacheKey);
      const safe = fromWorker == null ? "" : fromWorker;
      liveValueByPathRef.current.set(cacheKey, safe);
      return safe;
    }
    if (liveValueByPathRef.current.has(cacheKey)) {
      return liveValueByPathRef.current.get(cacheKey);
    }

    const resolvedCache = liveResolvedKeyByPathRef.current.get(cacheKey);
    if (resolvedCache === "__miss__") {
      liveValueByPathRef.current.set(cacheKey, "");
      return "";
    }
    if (resolvedCache) {
      const value = readLiveValue(resolvedCache);
      const safe = value == null ? "" : value;
      if (safe !== "") {
        liveValueByPathRef.current.set(cacheKey, safe);
        return safe;
      }
    }

    const candidates = [tagPath];
    const parts = tagPath.split(".").map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      candidates.push(parts.slice(i).join("."));
    }
    candidates.push(`Default.${tagPath}`);

    for (const key of candidates) {
      const direct = readLiveValue(key);
      if (direct != null && direct !== "") {
        liveResolvedKeyByPathRef.current.set(cacheKey, key);
        liveValueByPathRef.current.set(cacheKey, direct);
        return direct;
      }
      const lower = readLiveValue(String(key).toLowerCase());
      if (lower != null && lower !== "") {
        liveResolvedKeyByPathRef.current.set(cacheKey, String(key).toLowerCase());
        liveValueByPathRef.current.set(cacheKey, lower);
        return lower;
      }
    }
    // Support short tag bindings (e.g. "Group.Tag") when live keys are "Topic.Group.Tag".
    // Prefer exact suffix match to align with trend candidate behavior.
    for (const key of candidates) {
      const suffix = `.${String(key || "").toLowerCase()}`;
      for (const mapKey of liveLookupKeyList) {
        const mapValue = readLiveValue(mapKey);
        if (mapValue == null || mapValue === "") continue;
        const textKey = String(mapKey || "").toLowerCase();
        if (textKey === String(key || "").toLowerCase() || textKey.endsWith(suffix)) {
          liveResolvedKeyByPathRef.current.set(cacheKey, mapKey);
          liveValueByPathRef.current.set(cacheKey, mapValue);
          return mapValue;
        }
      }
    }

    // Fallback: overlay tagPath may be a group path (e.g. Default.Group).
    // In that case, find a live value under that group key prefix.
    for (const groupKey of candidates) {
      const prefixes = [`${String(groupKey).toLowerCase()}.`, `${String(groupKey).toLowerCase()}/`];
      const preferred = [
        "state",
        "stcode",
        "status",
        "hmi_state",
        "hmistate",
        "routeid",
        "routenumber",
        "value",
      ];
      for (const prefix of prefixes) {
        for (const suffix of preferred) {
          const nextKey = `${prefix}${suffix}`;
          const v = readLiveValue(nextKey);
          if (v != null && v !== "") {
            liveResolvedKeyByPathRef.current.set(cacheKey, nextKey);
            liveValueByPathRef.current.set(cacheKey, v);
            return v;
          }
        }
      }
      for (const k of liveLookupKeyList) {
        const v = readLiveValue(k);
        const lowerKey = String(k || "").toLowerCase();
        if (!prefixes.some((prefix) => lowerKey.startsWith(prefix))) continue;
        if (v != null && v !== "") {
          liveResolvedKeyByPathRef.current.set(cacheKey, k);
          liveValueByPathRef.current.set(cacheKey, v);
          return v;
        }
      }
    }
    liveResolvedKeyByPathRef.current.set(cacheKey, "__miss__");
    liveValueByPathRef.current.set(cacheKey, "");
    return "";
  };

  const getWidgetValueForOverlay = (overlay) => {
    if (!overlay?.widget) return "";
    const tagPath = String(overlay?.tagPath || "").trim();
    if (!tagPath) return "";
    const ignitionValue = readIgnitionTagValueForPath(tagPath);
    if (ignitionValue !== undefined) return ignitionValue;
    if (tagPath.toLowerCase().startsWith("db:")) {
      const id = String(overlay?.id || "");
      const v = widgetDbValues && Object.prototype.hasOwnProperty.call(widgetDbValues, id)
        ? widgetDbValues[id]
        : "";
      return v == null ? "" : v;
    }
    return getLiveValueForTagPath(tagPath);
  };
  const getTextShapeValueForShape = (shape) => {
    const tagPath = String(shape?.tagPath || "").trim();
    if (!tagPath) return String(shape?.text || "");

    const ignitionValue = readIgnitionTagValueForPath(tagPath);
    const rawValue = ignitionValue !== undefined ? ignitionValue : getLiveValueForTagPath(tagPath);
    if (rawValue == null || rawValue === "") {
      return String(shape?.text || "");
    }

    const rawText =
      rawValue != null && typeof rawValue === "object"
        ? String(
            rawValue?.value
            ?? rawValue?.v
            ?? rawValue?.state
            ?? rawValue?.State
            ?? rawValue?.rawValue
            ?? rawValue?.raw
            ?? ""
          ).trim()
        : String(rawValue).trim();
    if (!rawText) {
      return String(shape?.text || "");
    }

    const scaleFactorRaw = Number.parseFloat(String(shape?.scaleFactor ?? "").trim());
    const scaleFactor = Number.isFinite(scaleFactorRaw) ? scaleFactorRaw : 1;
    const decimalsRaw = Number.parseInt(String(shape?.decimals ?? "").trim(), 10);
    const decimals = Number.isInteger(decimalsRaw) ? Math.max(0, Math.min(6, decimalsRaw)) : null;
    const unit = String(shape?.unit || "").trim();
    const numericValue = Number(rawText);

    let displayValue = rawText;
    if (Number.isFinite(numericValue)) {
      const scaledValue = numericValue * scaleFactor;
      displayValue =
        decimals == null
          ? String(scaledValue)
          : scaledValue.toFixed(decimals);
    }

    return unit ? `${displayValue} ${unit}` : displayValue;
  };
  const toNumberOrNull = (value) => {
    if (value == null) return null;
    if (typeof value === "boolean") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    if (value != null && typeof value === "object") {
      const obj = value;
      const candidates = [obj.value, obj.v, obj.state, obj.State, obj.rawValue, obj.raw];
      for (const c of candidates) {
        const n = toNumberOrNull(c);
        if (n != null) return n;
      }
      return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const widgetHistoryRef = useRef(new Map()); // overlayId -> [{t,v}]
  const widgetLiveSeriesRef = useRef(new Map()); // overlayId -> [{ tagPath, tagKey, points:[{t,v}] }] from live opc values
  const widgetBackgroundDisabledRef = useRef(false);
  const [widgetRenderTick, setWidgetRenderTick] = useState(0);
  const widgetTrendSeriesRef = useRef(new Map()); // overlayId -> [{ tagPath, tagKey, points:[{t,v}] }] from /api/opc/trends
  const [widgetTrendTick, setWidgetTrendTick] = useState(0);
  const [widgetLiveSampleTick, setWidgetLiveSampleTick] = useState(0);
  const [widgetTrendReloadNonce, setWidgetTrendReloadNonce] = useState(0);
  const widgetBarDatasetRef = useRef(new Map()); // overlayId -> { labels: string[], values: number[], updatedAt: number }
  const [widgetBarTick, setWidgetBarTick] = useState(0);
  const [widgetWriteDraftByOverlay, setWidgetWriteDraftByOverlay] = useState({});
  const [widgetWriteBusyByOverlay, setWidgetWriteBusyByOverlay] = useState({});
  const [widgetWriteErrorByOverlay, setWidgetWriteErrorByOverlay] = useState({});
  const [widgetPressByOverlay, setWidgetPressByOverlay] = useState({});
  const [weatherByOverlayId, setWeatherByOverlayId] = useState({});
  const widgetPulseTimersRef = useRef(new Map());
  const widgetWriteChainRef = useRef(new Map());
  const weatherCacheRef = useRef(new Map());
  const trendLiveKeyListRef = useRef([]);
  const trendTagCandidateCacheRef = useRef(new Map());

  useEffect(() => {
    if (disableWidgetBackgroundWork) return undefined;
    const id = window.setInterval(() => {
      setWidgetLiveSampleTick((x) => (x + 1) % 1000000);
    }, widgetLiveSampleIntervalMs);
    return () => window.clearInterval(id);
  }, [disableWidgetBackgroundWork, widgetLiveSampleIntervalMs]);

  const decodeWeatherCode = (codeRaw) => {
    const code = Number(codeRaw);
    if (!Number.isFinite(code)) return "";
    if (code === 0) return "Clear";
    if (code === 1) return "Mostly Clear";
    if (code === 2) return "Partly Cloudy";
    if (code === 3) return "Overcast";
    if (code === 45 || code === 48) return "Fog";
    if (code === 51 || code === 53 || code === 55) return "Drizzle";
    if (code === 56 || code === 57) return "Freezing Drizzle";
    if (code === 61 || code === 63 || code === 65) return "Rain";
    if (code === 66 || code === 67) return "Freezing Rain";
    if (code === 71 || code === 73 || code === 75 || code === 77) return "Snow";
    if (code === 80 || code === 81 || code === 82) return "Rain Showers";
    if (code === 85 || code === 86) return "Snow Showers";
    if (code === 95) return "Thunderstorm";
    if (code === 96 || code === 99) return "Thunderstorm Hail";
    return "Unknown";
  };

  const setWidgetPressed = (overlayId, pressed) => {
    const key = String(overlayId || "").trim();
    if (!key) return;
    setWidgetPressByOverlay((prev) => {
      if (Boolean(prev?.[key]) === Boolean(pressed)) return prev;
      return { ...prev, [key]: Boolean(pressed) };
    });
  };

  const pulseWidgetPress = (overlayId, ms = 170) => {
    const key = String(overlayId || "").trim();
    if (!key) return;
    const timers = widgetPulseTimersRef.current;
    const prev = timers.get(key);
    if (prev) {
      clearTimeout(prev);
      timers.delete(key);
    }
    setWidgetPressed(key, true);
    const t = setTimeout(() => {
      setWidgetPressed(key, false);
      timers.delete(key);
    }, Math.max(80, Number(ms) || 170));
    timers.set(key, t);
  };

  const coerceWidgetWriteValue = (raw) => {
    const text = String(raw ?? "").trim();
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
    if (text !== "") {
      const n = Number(text);
      if (Number.isFinite(n)) return n;
    }
    return raw;
  };
  const toBooleanLike = (raw) => {
    if (typeof raw === "boolean") return raw;
    if (raw == null) return false;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw !== 0 : false;
    const text = String(raw).trim().toLowerCase();
    if (!text) return false;
    if (["1", "true", "on", "yes", "active", "open"].includes(text)) return true;
    if (["0", "false", "off", "no", "inactive", "closed"].includes(text)) return false;
    const n = Number(text);
    if (Number.isFinite(n)) return n !== 0;
    return false;
  };

  const getWritableWidgetTagPath = (overlay) => {
    const tagPath = String(overlay?.tagPath || "").trim();
    if (!tagPath) return "";
    const lower = tagPath.toLowerCase();
    if (lower.startsWith("db:") || lower.startsWith("dbq:")) return "";
    return tagPath;
  };
  const getMissingWidgetWriteTargetMessage = (overlay) => {
    const writeMode = resolveWidgetWriteMode(overlay?.widget, overlay?.tagPath);
    return writeMode === "opc"
      ? "Configure OPC item path to enable write."
      : "Configure Ignition tag path to enable write.";
  };
  const getWidgetOptimisticWriteKeys = useCallback(
    (overlay) => {
      const tagPath = normalizeTagValue(getWritableWidgetTagPath(overlay));
      if (!tagPath) return [];
      const out = [];
      const seen = new Set();
      const addKey = (rawKey) => {
        const key = normalizeTagValue(rawKey || "");
        if (!key) return;
        const lower = key.toLowerCase();
        if (seen.has(lower)) return;
        seen.add(lower);
        out.push(key);
      };
      addKey(tagPath);
      const cacheKey = tagPath.toLowerCase();
      const resolvedKey = liveResolvedKeyByPathRef.current.get(cacheKey);
      if (resolvedKey && resolvedKey !== "__miss__") addKey(resolvedKey);
      const lowerTagPath = tagPath.toLowerCase();
      const dotSuffix = `.${lowerTagPath}`;
      const slashSuffix = `/${lowerTagPath}`;
      const matchesTagPath = (rawKey) => {
        const key = normalizeTagValue(rawKey || "");
        if (!key) return false;
        const lower = key.toLowerCase();
        return lower === lowerTagPath || lower.endsWith(dotSuffix) || lower.endsWith(slashSuffix);
      };
      (Array.isArray(watchedLiveKeys) ? watchedLiveKeys : []).forEach((key) => {
        if (matchesTagPath(key)) addKey(key);
      });
      Object.keys(getOpcLiveSnapshot() || {}).forEach((key) => {
        if (matchesTagPath(key)) addKey(key);
      });
      return out;
    },
    [watchedLiveKeys]
  );
  const applyOptimisticWidgetWrite = useCallback(
    (overlay, nextValue) => {
      const keys = getWidgetOptimisticWriteKeys(overlay);
      if (!keys.length) return;
      const patch = {};
      keys.forEach((rawKey) => {
        const key = normalizeTagValue(rawKey || "");
        if (!key) return;
        patch[key] = nextValue;
        const lower = key.toLowerCase();
        if (lower !== key) patch[lower] = nextValue;
      });
      if (!Object.keys(patch).length) return;
      const currentLiveValues =
        opcLiveValuesRef.current && typeof opcLiveValuesRef.current === "object"
          ? opcLiveValuesRef.current
          : {};
      const nextLiveValues = { ...currentLiveValues };
      let changed = false;
      Object.entries(patch).forEach(([key, value]) => {
        if (Object.is(nextLiveValues[key], value)) return;
        nextLiveValues[key] = value;
        changed = true;
      });
      if (changed) {
        opcLiveValuesRef.current = nextLiveValues;
        syncLiveInputSnapshot(nextLiveValues);
        requestWorkerResolve(nextLiveValues);
        scheduleLiveRenderTick(true);
      }
      patchOpcLiveSnapshot(patch);
    },
    [
      getWidgetOptimisticWriteKeys,
      requestWorkerResolve,
      scheduleLiveRenderTick,
      syncLiveInputSnapshot,
    ]
  );

  const submitWidgetWrite = async (overlay, writeValue) => {
    const overlayId = String(overlay?.id || "").trim();
    const tagPath = getWritableWidgetTagPath(overlay);
    if (!overlayId || !tagPath) return;
    const payloadValue = coerceWidgetWriteValue(writeValue);
    const writeMode = resolveWidgetWriteMode(overlay?.widget, tagPath);
    const isIgnitionTarget = writeMode === "ignition";
    const isDirectOpcTarget = writeMode === "opc";
    const opcServerName = resolveWidgetOpcServer(overlay?.widget);
    const runWrite = async () => {
      setWidgetWriteBusyByOverlay((prev) => ({ ...prev, [overlayId]: true }));
      setWidgetWriteErrorByOverlay((prev) => ({ ...prev, [overlayId]: "" }));
      try {
        const data = isIgnitionTarget && typeof writeIgnitionTagValue === "function"
          ? await writeIgnitionTagValue(tagPath, payloadValue)
          : isDirectOpcTarget && typeof writeIgnitionOpcValue === "function"
          ? await writeIgnitionOpcValue(tagPath, payloadValue, opcServerName)
          : await writeOpcValue({
              tagKey: tagPath,
              legacyTagKey: tagPath,
              value: payloadValue,
            });
        const nextValue = Object.prototype.hasOwnProperty.call(data || {}, "value")
          ? data.value
          : payloadValue;
        if (!isIgnitionTarget) {
          applyOptimisticWidgetWrite(overlay, nextValue);
        }
        setWidgetWriteDraftByOverlay((prev) => ({
          ...prev,
          [overlayId]: String(nextValue ?? ""),
        }));
      } catch (err) {
        setWidgetWriteErrorByOverlay((prev) => ({
          ...prev,
          [overlayId]: err?.message || "Write failed.",
        }));
      } finally {
        setWidgetWriteBusyByOverlay((prev) => ({ ...prev, [overlayId]: false }));
      }
    };
    const previous = widgetWriteChainRef.current.get(overlayId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(runWrite);
    widgetWriteChainRef.current.set(overlayId, next);
    try {
      await next;
    } finally {
      if (widgetWriteChainRef.current.get(overlayId) === next) {
        widgetWriteChainRef.current.delete(overlayId);
      }
    }
  };

  const parseDbBinding = (rawTagPath) => {
    const tagPath = String(rawTagPath || "").trim();
    if (!tagPath.toLowerCase().startsWith("db:")) return null;
    const expr = tagPath.slice(3).trim();
    const dot = expr.indexOf(".");
    if (dot <= 0 || dot >= expr.length - 1) return null;
    const table = expr.slice(0, dot).trim();
    const field = expr.slice(dot + 1).trim();
    if (!table || !field) return null;
    return { table, field };
  };
  const parseDbQueryBinding = (rawTagPath) => {
    const tagPath = String(rawTagPath || "").trim();
    if (!tagPath.toLowerCase().startsWith("dbq:")) return "";
    return tagPath.slice(4).trim();
  };
  const getBarDataSource = (overlay) => {
    const widget = overlay?.widget || {};
    const seriesTagPaths = parseWidgetSeriesTags(overlay).filter((tp) => {
      const text = String(tp || "").trim().toLowerCase();
      return text && !text.startsWith("db:") && !text.startsWith("dbq:");
    });
    const mode = String(widget?.barSourceMode || "").trim().toLowerCase();
    if (mode === "tags") {
      return {
        mode: "tags",
        tagPaths: seriesTagPaths,
      };
    }
    if (mode === "query") {
      const sql = String(widget?.barQuery || "").trim() || parseDbQueryBinding(overlay?.tagPath);
      if (!sql) return null;
      return {
        mode: "query",
        sql,
        labelField: String(widget?.barQueryLabelField || "").trim(),
        valueField: String(widget?.barQueryValueField || "").trim(),
      };
    }
    const table = String(widget?.barTable || "").trim();
    const field = String(widget?.barField || "").trim();
    if (table && field) {
      return {
        mode: "table",
        table,
        field,
        labelField: String(widget?.barLabelField || "").trim(),
      };
    }
    const parsedDb = parseDbBinding(overlay?.tagPath);
    if (parsedDb) {
      return {
        mode: "table",
        table: parsedDb.table,
        field: parsedDb.field,
        labelField: String(widget?.barLabelField || "").trim(),
      };
    }
    const parsedQuery = parseDbQueryBinding(overlay?.tagPath);
    if (parsedQuery) {
      return {
        mode: "query",
        sql: parsedQuery,
        labelField: String(widget?.barQueryLabelField || "").trim(),
        valueField: String(widget?.barQueryValueField || "").trim(),
      };
    }
    // Backward-compatible fallback: if table/query is not configured but live tags exist, use tags mode.
    if (seriesTagPaths.length) {
      return {
        mode: "tags",
        tagPaths: seriesTagPaths,
      };
    }
    return null;
  };

  useEffect(() => {
    if (disableWidgetBackgroundWork) {
      trendLiveKeyListRef.current = [];
      trendTagCandidateCacheRef.current.clear();
      return;
    }
    trendLiveKeyListRef.current = (Array.isArray(liveLookupKeyList) ? liveLookupKeyList : [])
      .map((k) => String(k || "").trim())
      .filter(Boolean);
    trendTagCandidateCacheRef.current.clear();
  }, [liveLookupKeyList, disableWidgetBackgroundWork]);

  useEffect(() => {
    const activeIds = new Set((Array.isArray(svgOverlays) ? svgOverlays : []).map((o) => String(o?.id || "")));
    const pruneMap = (prev) => {
      const next = {};
      let changed = false;
      Object.entries(prev || {}).forEach(([k, v]) => {
        if (!activeIds.has(String(k || ""))) {
          changed = true;
          return;
        }
        next[k] = v;
      });
      return changed ? next : prev;
    };
    setWidgetWriteDraftByOverlay(pruneMap);
    setWidgetWriteBusyByOverlay(pruneMap);
    setWidgetWriteErrorByOverlay(pruneMap);
    setWidgetPressByOverlay(pruneMap);
  }, [svgOverlays, liveUpdatesEnabled]);

  useEffect(
    () => () => {
      const timers = widgetPulseTimersRef.current;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
    []
  );

  const parseWidgetSeriesTagsCacheRef = useRef(new Map());
  const parseWidgetSeriesTags = useCallback((overlay) => {
    const widget = overlay?.widget || {};
    const cacheKey = `${String(overlay?.tagPath || "")}|${String(widget?.kind || "")}|${JSON.stringify(widget?.seriesTags ?? "")}`;
    const cached = parseWidgetSeriesTagsCacheRef.current.get(cacheKey);
    if (cached) return cached;
    const out = [];
    const push = (raw) => {
      const tag = String(raw || "").trim();
      if (!tag) return;
      const key = tag.toLowerCase();
      if (out.some((x) => x.toLowerCase() === key)) return;
      out.push(tag);
    };
    const primary = String(overlay?.tagPath || "").trim();
    const kind = String(widget?.kind || "").trim().toLowerCase();
    const isLineChart = kind === "linechart" || kind === "line_chart" || kind === "line-chart";
    const isBarChart = kind === "barchart" || kind === "bar_chart" || kind === "bar-chart";
    const rawSeries = widget?.seriesTags;
    const parsedSeries = Array.isArray(rawSeries)
      ? rawSeries
      : String(rawSeries || "").split(/\r?\n|,/);
    if (isLineChart) {
      parsedSeries.forEach((t) => push(t));
      push(primary);
    } else if (isBarChart) {
      parsedSeries.forEach((t) => push(t));
      push(primary);
    } else {
      push(primary);
      if (!out.length) parsedSeries.forEach((t) => push(t));
    }
    // Bound cache size to avoid unbounded growth
    if (parseWidgetSeriesTagsCacheRef.current.size > 500) {
      parseWidgetSeriesTagsCacheRef.current.clear();
    }
    parseWidgetSeriesTagsCacheRef.current.set(cacheKey, out);
    return out;
  }, []);

  useEffect(() => {
    if (disableWidgetBackgroundWork) {
      if (!widgetBackgroundDisabledRef.current) {
        widgetBackgroundDisabledRef.current = true;
        widgetHistoryRef.current = new Map();
        widgetLiveSeriesRef.current = new Map();
        setWidgetRenderTick((x) => x + 1);
      }
      return;
    }
    widgetBackgroundDisabledRef.current = false;
    const now = Date.now();
    let changed = false;
    const keep = new Set();
    const lineKindSet = new Set(["linechart", "line_chart", "line-chart"]);
    (svgOverlays || []).forEach((o) => {
      if (!o?.widget) return;
      const id = String(o.id || "");
      if (!id) return;
      keep.add(id);
      const kind = String(o?.widget?.kind || "").trim().toLowerCase();
      const seriesForValue = parseWidgetSeriesTags(o).filter(
        (tp) => !String(tp || "").trim().toLowerCase().startsWith("db:")
      );
      const rawPrimarySeries =
        (kind === "linechart" || kind === "line_chart" || kind === "line-chart" ||
          kind === "areachart" || kind === "area_chart" || kind === "area-chart") &&
        seriesForValue.length
          ? getLiveValueForTagPath(seriesForValue[0])
          : null;
      const raw = rawPrimarySeries != null && rawPrimarySeries !== ""
        ? rawPrimarySeries
        : getWidgetValueForOverlay(o);
      const n = toNumberOrNull(raw);
      if (n == null) return;
      const maxHist = Math.max(
        50,
        Math.min(
          10000,
          Number(o?.widget?.maxPoints) ||
            Number(o?.widget?.historyPoints) ||
            500
        )
      );
      const prev = widgetHistoryRef.current.get(id) || [];
      const last = prev.length ? prev[prev.length - 1] : null;
      if (!last || last.v !== n || now - last.t >= 2000) {
        const next = [...prev, { t: now, v: n }];
        const clipped = next.slice(-maxHist);
        widgetHistoryRef.current.set(id, clipped);
        changed = true;
      }

      if (!lineKindSet.has(kind)) return;
      const seriesTags = parseWidgetSeriesTags(o).filter(
        (tp) => !String(tp || "").trim().toLowerCase().startsWith("db:")
      );
      if (!seriesTags.length) return;
      const prevSeries = Array.isArray(widgetLiveSeriesRef.current.get(id))
        ? widgetLiveSeriesRef.current.get(id)
        : [];
      const prevByTag = new Map(
        prevSeries.map((s) => [String(s?.tagPath || s?.tagKey || "").trim().toLowerCase(), s])
      );
      const nextSeries = seriesTags.map((tagPath) => {
        const key = String(tagPath || "").trim().toLowerCase();
        const prevItem = prevByTag.get(key) || { tagPath, tagKey: tagPath, points: [] };
        const prevPoints = Array.isArray(prevItem.points) ? prevItem.points : [];
        const liveRaw = getLiveValueForTagPath(tagPath);
        const liveNum = toNumberOrNull(liveRaw);
        if (liveNum == null) {
          return { ...prevItem, tagPath, tagKey: prevItem.tagKey || tagPath, points: prevPoints };
        }
        const lastPoint = prevPoints.length ? prevPoints[prevPoints.length - 1] : null;
        if (!lastPoint || lastPoint.v !== liveNum || now - Number(lastPoint.t || 0) >= 2000) {
          changed = true;
          return {
            ...prevItem,
            tagPath,
            tagKey: prevItem.tagKey || tagPath,
            points: [...prevPoints, { t: now, v: liveNum }].slice(-maxHist),
          };
        }
        return { ...prevItem, tagPath, tagKey: prevItem.tagKey || tagPath, points: prevPoints };
      });
      widgetLiveSeriesRef.current.set(id, nextSeries);
    });
    // cleanup removed widgets
    Array.from(widgetHistoryRef.current.keys()).forEach((id) => {
      if (!keep.has(id)) {
        widgetHistoryRef.current.delete(id);
        changed = true;
      }
    });
    Array.from(widgetLiveSeriesRef.current.keys()).forEach((id) => {
      if (!keep.has(id)) {
        widgetLiveSeriesRef.current.delete(id);
        changed = true;
      }
    });
    if (changed) setWidgetRenderTick((x) => x + 1);
  }, [svgOverlays, widgetDbValues, disableWidgetBackgroundWork, widgetLiveSampleTick]);

  useEffect(() => {
    if (disableWidgetBackgroundWork) {
      widgetTrendSeriesRef.current = new Map();
      setWidgetTrendTick((x) => x + 1);
      return;
    }
    let alive = true;
    const chartKinds = new Set(["lineChart", "areaChart", "statusTable"]);
    const parseRangeMs = (raw) => {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
      const text = String(raw ?? "").trim();
      if (!text) return null;
      const ms = Date.parse(text);
      return Number.isFinite(ms) ? ms : null;
    };
    const normalizePoints = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .map((p) => ({ t: Number(p?.t) || 0, v: toNumberOrNull(p?.v) }))
        .filter((p) => p.t > 0 && Number.isFinite(p.v));
    const buildTagCandidates = (raw) => {
      const tagPath = String(raw || "").trim();
      if (!tagPath) return [];
      const cacheKey = tagPath.toLowerCase();
      const cached = trendTagCandidateCacheRef.current.get(cacheKey);
      if (Array.isArray(cached) && cached.length) return cached;
      const out = [];
      const push = (v) => {
        const s = String(v || "").trim();
        if (!s) return;
        if (!out.includes(s)) out.push(s);
      };
      push(tagPath);
      if (!tagPath.toLowerCase().startsWith("default.")) push(`Default.${tagPath}`);
      // Add exact key matches from live values (e.g. Topic.TagPath), same pattern used by Tags pages.
      trendLiveKeyListRef.current.forEach((k) => {
        const key = String(k || "").trim();
        if (!key) return;
        if (key.toLowerCase() === tagPath.toLowerCase()) push(key);
        if (key.toLowerCase().endsWith(`.${tagPath.toLowerCase()}`)) push(key);
      });
      trendTagCandidateCacheRef.current.set(cacheKey, out);
      return out;
    };
    const loadBestTrendPointsForTagPath = async (tagPath, from, to, maxPoints) => {
      const candidates = buildTagCandidates(tagPath);
      let bestPoints = null;
      let bestTotal = -1;
      let bestTagKey = "";
      for (const tagKey of candidates) {
        const q = new URLSearchParams({
          tagKey: String(tagKey),
          from: String(from),
          to: String(to),
          maxPoints: String(maxPoints),
        });
        try {
          const res = await fetch(`/api/opc/trends?${q.toString()}`);
          const data = await res.json();
          if (!res.ok) continue;
          const points = normalizePoints(data?.points);
          const total = Number(data?.totalPoints);
          const safeTotal = Number.isFinite(total) ? total : points.length;
          if (
            !bestPoints ||
            points.length > bestPoints.length ||
            (points.length === bestPoints.length && safeTotal > bestTotal)
          ) {
            bestPoints = points;
            bestTotal = safeTotal;
            bestTagKey = String(tagKey || "").trim();
          }
        } catch {
          // ignore per-key errors, try next candidate
        }
      }
      return {
        tagKey: bestTagKey || String(tagPath || "").trim(),
        points: Array.isArray(bestPoints) ? bestPoints : [],
      };
    };

    async function loadWidgetTrends() {
      if (typeof document !== "undefined" && document.hidden) return;
      const overlays = Array.isArray(svgOverlays) ? svgOverlays : [];
      const targets = overlays.filter((o) => {
        if (!o?.widget) return false;
        const kind = String(o?.widget?.kind || "").trim();
        if (!chartKinds.has(kind)) return false;
        const tagPaths = parseWidgetSeriesTags(o);
        const trendTagPaths = tagPaths.filter((tp) => !String(tp).toLowerCase().startsWith("db:"));
        return trendTagPaths.length > 0;
      });
      if (!targets.length) {
        if (!alive) return;
        widgetTrendSeriesRef.current = new Map();
        setWidgetTrendTick((x) => x + 1);
        return;
      }

      const now = Date.now();
      const prevMap = widgetTrendSeriesRef.current;
      const nextMap = new Map();
      await Promise.allSettled(
        targets.map(async (o) => {
          const id = String(o?.id || "");
          if (!id) return;
          const cfg = o?.widget || {};
          const windowMinutes = Math.max(1, Math.min(10080, Number(cfg?.windowMinutes) || 60));
          const maxPoints = Math.max(50, Math.min(10000, Number(cfg?.maxPoints) || 500));
          let from = parseRangeMs(cfg?.rangeFrom);
          let to = parseRangeMs(cfg?.rangeTo);
          if (from != null && to != null && from > to) {
            const t = from;
            from = to;
            to = t;
          }
          if (from == null && to == null) {
            from = now - windowMinutes * 60 * 1000;
            to = now;
          } else {
            if (from == null) from = Math.max(0, (to || now) - windowMinutes * 60 * 1000);
            if (to == null) to = now;
          }
          const tagPaths = parseWidgetSeriesTags(o).filter(
            (tp) => !String(tp).toLowerCase().startsWith("db:")
          );
          const seriesList = await Promise.all(
            tagPaths.map(async (tagPath) => {
              const result = await loadBestTrendPointsForTagPath(tagPath, from, to, maxPoints);
              return {
                tagPath: String(tagPath || "").trim(),
                tagKey: String(result?.tagKey || tagPath || "").trim(),
                points: Array.isArray(result?.points) ? result.points : [],
              };
            })
          );
          const prevSeries = Array.isArray(prevMap.get(id)) ? prevMap.get(id) : [];
          const prevByTag = new Map(
            prevSeries.map((s) => {
              const key = String(s?.tagPath || s?.tagKey || "").trim().toLowerCase();
              return [key, s];
            })
          );
          const mergedSeries = seriesList.map((series) => {
            if (Array.isArray(series?.points) && series.points.length > 0) return series;
            const lookupKey = String(series?.tagPath || series?.tagKey || "").trim().toLowerCase();
            const prev = prevByTag.get(lookupKey);
            if (prev && Array.isArray(prev.points) && prev.points.length > 0) {
              return {
                ...series,
                tagKey: String(series?.tagKey || prev?.tagKey || "").trim(),
                points: prev.points,
              };
            }
            return series;
          });
          nextMap.set(id, mergedSeries);
        })
      );
      if (!alive) return;
      widgetTrendSeriesRef.current = nextMap;
      setWidgetTrendTick((x) => x + 1);
    }

    loadWidgetTrends();
    const id = setInterval(
      loadWidgetTrends,
      typeof document !== "undefined" && document.hidden
        ? 9000
        : liveClickable
        ? 3000
        : 5000
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [svgOverlays, widgetTrendReloadNonce, liveClickable, liveUpdatesEnabled, disableWidgetBackgroundWork]);

  useEffect(() => {
    if (disableWidgetBackgroundWork) {
      widgetBarDatasetRef.current = new Map();
      setWidgetBarTick((x) => x + 1);
      return;
    }
    let alive = true;

    async function loadBarChartDatasets() {
      if (typeof document !== "undefined" && document.hidden) return;
      const overlays = Array.isArray(svgOverlays) ? svgOverlays : [];
      const targets = overlays.filter((o) => {
        const kind = String(o?.widget?.kind || "").trim();
        if (kind !== "barChart") return false;
        return !!getBarDataSource(o);
      });

      const nextMap = new Map();
      await Promise.allSettled(
        targets.map(async (o) => {
          const overlayId = String(o?.id || "");
          if (!overlayId) return;
          const source = getBarDataSource(o);
          if (!source) return;
          const cfg = o?.widget || {};
          const maxRows = Math.max(
            1,
            Math.min(
              200,
              Number(cfg?.historyPoints) || Number(cfg?.rowCount) || Number(cfg?.maxPoints) || 20
            )
          );
          try {
            const labelKeyRegex = /(name|label|title|code|id)$/i;
            const labels = [];
            const values = [];
            if (source.mode === "tags") {
              const formatTagLabel = (raw) => {
                const text = String(raw || "").trim();
                if (!text) return "";
                const parts = text.split(".").map((x) => x.trim()).filter(Boolean);
                if (!parts.length) return text;
                if (parts.length === 1) return parts[0];
                return parts.slice(-2).join(".");
              };
              const makeUniqueLabel = (rawLabel, index) => {
                const base = String(rawLabel || "").trim() || `Tag ${index + 1}`;
                if (!labels.includes(base)) return base;
                let n = 2;
                let next = `${base} (${n})`;
                while (labels.includes(next)) {
                  n += 1;
                  next = `${base} (${n})`;
                }
                return next;
              };
              (Array.isArray(source.tagPaths) ? source.tagPaths : []).forEach((tagPath) => {
                const v = toNumberOrNull(getLiveValueForTagPath(tagPath));
                labels.push(makeUniqueLabel(formatTagLabel(tagPath), labels.length));
                values.push(v == null ? 0 : Number(v));
              });
            } else if (source.mode === "table") {
              const table = source.table;
              const field = source.field;
              const labelField = String(source.labelField || "").trim();
              const res = await fetch(`/api/db/${encodeURIComponent(table)}?limit=${maxRows}`);
              const data = await res.json();
              if (!res.ok) return;
              const rows = Array.isArray(data?.rows) ? data.rows : [];
              const pk = String(data?.primaryKey || "").trim();
              rows.forEach((row, idx) => {
                if (!row || typeof row !== "object") return;
                const v = toNumberOrNull(row[field]);
                if (v == null) return;
                let label = "";
                if (labelField && row[labelField] != null && String(row[labelField]).trim() !== "") {
                  label = String(row[labelField]);
                } else if (pk && pk !== field && row[pk] != null && row[pk] !== "") {
                  label = String(row[pk]);
                } else {
                  const keys = Object.keys(row);
                  const alt = keys.find(
                    (k) =>
                      k !== field &&
                      labelKeyRegex.test(String(k || "")) &&
                      row[k] != null &&
                      String(row[k]).trim() !== ""
                  );
                  if (alt) label = String(row[alt]);
                }
                if (!label) label = String(idx + 1);
                labels.push(label);
                values.push(v);
              });
            } else if (source.mode === "query") {
              const res = await fetch("/api/reports/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: "sql", sql: source.sql }),
              });
              const data = await res.json();
              if (!res.ok) return;
              const rowsAll = Array.isArray(data?.rows) ? data.rows : [];
              const rows = rowsAll.slice(0, maxRows);
              const valueFieldPref = String(source.valueField || "").trim();
              const labelFieldPref = String(source.labelField || "").trim();
              const cols = Array.isArray(data?.columns) ? data.columns.map((c) => String(c || "").trim()).filter(Boolean) : [];
              const inferValueField = () => {
                if (valueFieldPref) return valueFieldPref;
                for (const c of cols) {
                  const anyNumeric = rows.some((r) => toNumberOrNull(r?.[c]) != null);
                  if (anyNumeric) return c;
                }
                return "";
              };
              const valueField = inferValueField();
              const inferLabelField = () => {
                if (labelFieldPref) return labelFieldPref;
                const preferred = cols.find((c) => c !== valueField && labelKeyRegex.test(c));
                if (preferred) return preferred;
                const firstText = cols.find((c) => c !== valueField);
                return firstText || "";
              };
              const labelField = inferLabelField();
              rows.forEach((row, idx) => {
                if (!row || typeof row !== "object") return;
                const v = toNumberOrNull(row[valueField]);
                if (v == null) return;
                let label = "";
                if (labelField && row[labelField] != null && String(row[labelField]).trim() !== "") {
                  label = String(row[labelField]);
                }
                if (!label) label = String(idx + 1);
                labels.push(label);
                values.push(v);
              });
            }
            nextMap.set(overlayId, { labels, values, updatedAt: Date.now(), mode: source.mode });
          } catch {
            // ignore per-widget db errors
          }
        })
      );

      if (!alive) return;
      widgetBarDatasetRef.current = nextMap;
      setWidgetBarTick((x) => x + 1);
    }

    loadBarChartDatasets();
    const id = setInterval(
      loadBarChartDatasets,
      typeof document !== "undefined" && document.hidden
        ? 10000
        : liveClickable
        ? 4500
        : 6500
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [svgOverlays, liveClickable, liveUpdatesEnabled, disableWidgetBackgroundWork]);

  useEffect(() => {
    if (disableWidgetBackgroundWork) {
      setWeatherByOverlayId({});
      return undefined;
    }
    let alive = true;
    const weatherOverlays = (Array.isArray(svgOverlays) ? svgOverlays : []).filter((o) => {
      const kind = String(o?.widget?.kind || "").trim().toLowerCase();
      return kind === "weather";
    });
    if (!weatherOverlays.length) {
      setWeatherByOverlayId({});
      return () => {
        alive = false;
      };
    }

    const applyCached = () => {
      const next = {};
      weatherOverlays.forEach((overlay) => {
        const overlayId = String(overlay?.id || "").trim();
        if (!overlayId) return;
        const title = String(overlay?.widget?.title || "").trim();
        const location = String(overlay?.widget?.location || title || "").trim();
        if (!location) return;
        const unitRaw = String(overlay?.widget?.unit || "F").trim().toUpperCase();
        const unit = unitRaw === "C" ? "C" : "F";
        const cacheKey = `${location.toLowerCase()}|${unit}`;
        const cached = weatherCacheRef.current.get(cacheKey);
        if (cached && Number.isFinite(Number(cached.expiresAt)) && cached.expiresAt > Date.now()) {
          next[overlayId] = cached.payload;
        }
      });
      if (Object.keys(next).length) {
        setWeatherByOverlayId((prev) => ({ ...prev, ...next }));
      }
    };
    applyCached();

    const fetchOne = async (overlay) => {
      const overlayId = String(overlay?.id || "").trim();
      if (!overlayId) return;
      const title = String(overlay?.widget?.title || "").trim();
      const locationRaw = String(overlay?.widget?.location || title || "Chicago, IL").trim();
      const unitRaw = String(overlay?.widget?.unit || "F").trim().toUpperCase();
      const unit = unitRaw === "C" ? "celsius" : "fahrenheit";
      const unitLabel = unitRaw === "C" ? "C" : "F";
      const cacheKey = `${locationRaw.toLowerCase()}|${unitLabel}`;
      const cached = weatherCacheRef.current.get(cacheKey);
      if (cached && Number.isFinite(Number(cached.expiresAt)) && cached.expiresAt > Date.now()) {
        if (alive) {
          setWeatherByOverlayId((prev) => ({ ...prev, [overlayId]: cached.payload }));
        }
        return;
      }
      try {
        const apiUrl = `/api/weather/current?location=${encodeURIComponent(locationRaw)}&unit=${encodeURIComponent(unitLabel)}`;
        const weatherRes = await fetch(apiUrl);
        if (!weatherRes.ok) {
          const errData = await weatherRes.json().catch(() => null);
          if (alive) {
            setWeatherByOverlayId((prev) => ({
              ...prev,
              [overlayId]: {
                location: locationRaw,
                temp: null,
                humidity: null,
                windMph: null,
                condition: String(errData?.error || "Weather unavailable"),
                unit: unitLabel,
                fetchedAt: Date.now(),
              },
            }));
          }
          return;
        }
        const cur = await weatherRes.json().catch(() => null);
        const temp = Number(cur?.temperature_2m);
        const humidity = Number(cur?.relative_humidity_2m);
        const windMph = Number(cur?.wind_speed_10m);
        const payload = {
          location: String(cur?.location || locationRaw).trim() || locationRaw,
          temp: Number.isFinite(Number(cur?.temp)) ? Number(cur.temp) : Number.isFinite(temp) ? temp : null,
          humidity: Number.isFinite(Number(cur?.humidity)) ? Number(cur.humidity) : Number.isFinite(humidity) ? humidity : null,
          windMph: Number.isFinite(Number(cur?.windMph)) ? Number(cur.windMph) : Number.isFinite(windMph) ? windMph : null,
          condition: decodeWeatherCode(cur?.weatherCode ?? cur?.weather_code),
          unit: String(cur?.unit || unitLabel).trim() || unitLabel,
          fetchedAt: Number.isFinite(Number(cur?.fetchedAt)) ? Number(cur.fetchedAt) : Date.now(),
        };
        weatherCacheRef.current.set(cacheKey, {
          payload,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
        if (!alive) return;
        setWeatherByOverlayId((prev) => ({ ...prev, [overlayId]: payload }));
      } catch {
        if (!alive) return;
        setWeatherByOverlayId((prev) => ({
          ...prev,
          [overlayId]: {
            location: locationRaw,
            temp: null,
            humidity: null,
            windMph: null,
            condition: "Weather unavailable",
            unit: unitLabel,
            fetchedAt: Date.now(),
          },
        }));
      }
    };

    weatherOverlays.forEach((overlay) => {
      fetchOne(overlay);
    });
    const id = setInterval(
      () => weatherOverlays.forEach((overlay) => fetchOne(overlay)),
      typeof document !== "undefined" && document.hidden ? 300000 : 120000
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [svgOverlays, liveUpdatesEnabled, disableWidgetBackgroundWork]);

  const renderWidgetOverlay = (overlay) => {
    if (!overlay?.widget) return null;
    const kind = String(overlay?.widget?.kind || "").trim();
    const cfg = overlay?.widget || {};
    const rawVal = getWidgetValueForOverlay(overlay);
    const n = toNumberOrNull(rawVal);
    const decimals = Math.max(0, Math.min(6, Number(cfg?.decimals) || 0));
    const unit = String(cfg?.unit || "").trim();
    const title = String(cfg?.title || "").trim();
    const minCfg = Number.isFinite(Number(cfg?.min)) ? Number(cfg.min) : 0;
    const maxCfg = Number.isFinite(Number(cfg?.max)) ? Number(cfg.max) : 100;
    const rowCount = Math.max(1, Math.min(20, Number(cfg?.rowCount) || 4));
    const formatNum = (v) =>
      Number.isFinite(Number(v)) ? `${Number(v).toFixed(decimals)}${unit ? ` ${unit}` : ""}` : "";
    const seriesTags = parseWidgetSeriesTags(overlay);
    const primaryTagPath = String(seriesTags[0] || "").trim();
    const label = primaryTagPath || String(overlay?.tagPath || "").trim() || "Unbound";
    const bb = overlay?.bbox || { x: 0, y: 0, width: 320, height: 180 };
    const x = Number(bb.x) || 0;
    const y = Number(bb.y) || 0;
    const w = Math.max(80, Number(bb.width) || 320);
    const h = Math.max(60, Number(bb.height) || 180);
    const overlayId = String(overlay?.id || "");
    const apiSeriesRaw = widgetTrendSeriesRef.current.get(overlayId);
    const apiSeries = Array.isArray(apiSeriesRaw) ? apiSeriesRaw : [];
    const liveSeriesRaw = widgetLiveSeriesRef.current.get(overlayId);
    const liveSeries = Array.isArray(liveSeriesRaw) ? liveSeriesRaw : [];
    const configuredSeriesTags = parseWidgetSeriesTags(overlay);
    const toSeriesKey = (raw) => String(raw || "").trim().toLowerCase();
    const byTag = (list) => {
      const map = new Map();
      (Array.isArray(list) ? list : []).forEach((s) => {
        const key = toSeriesKey(s?.tagPath || s?.tagKey || "");
        if (!key || map.has(key)) return;
        map.set(key, s);
      });
      return map;
    };
    const apiByTag = byTag(apiSeries);
    const liveByTag = byTag(liveSeries);
    const effectiveSeries = configuredSeriesTags.map((tagPath) => {
      const key = toSeriesKey(tagPath);
      const api = apiByTag.get(key);
      const apiPoints = Array.isArray(api?.points) ? api.points : [];
      if (apiPoints.length > 0) {
        return { ...api, tagPath: tagPath || api?.tagPath || api?.tagKey };
      }
      const live = liveByTag.get(key);
      const livePoints = Array.isArray(live?.points) ? live.points : [];
      if (livePoints.length > 0) {
        return {
          ...live,
          tagPath: tagPath || live?.tagPath || live?.tagKey,
          tagKey: api?.tagKey || live?.tagKey || tagPath,
          points: livePoints,
        };
      }
      return {
        tagPath,
        tagKey: api?.tagKey || live?.tagKey || tagPath,
        points: [],
      };
    });
    const firstApiWithPoints = effectiveSeries.find(
      (s) => Array.isArray(s?.points) && s.points.length > 0
    );
    const primaryApiSeries = effectiveSeries.find((s) => {
      const tag = String(s?.tagPath || "").trim().toLowerCase();
      const key = String(s?.tagKey || "").trim().toLowerCase();
      const target = String(primaryTagPath || "").trim().toLowerCase();
      if (!target) return false;
      return tag === target || key === target;
    });
    const apiHist = Array.isArray(primaryApiSeries?.points)
      ? primaryApiSeries.points
      : Array.isArray(firstApiWithPoints?.points)
      ? firstApiWithPoints.points
      : [];
    const localHist = widgetHistoryRef.current.get(overlayId) || [];
    const isTrendWidgetKind = kind === "lineChart" || kind === "areaChart" || kind === "statusTable";
    const hasApiSeries = Array.isArray(effectiveSeries) && effectiveSeries.some(
      (s) => Array.isArray(s?.points) && s.points.length > 0
    );
    const barBinding = kind === "barChart" ? getBarDataSource(overlay) : null;
    const barDataset = kind === "barChart" ? widgetBarDatasetRef.current.get(overlayId) : null;
    const barValues = Array.isArray(barDataset?.values)
      ? barDataset.values.map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : [];
    const barLabelsRaw = Array.isArray(barDataset?.labels) ? barDataset.labels : [];
    const histAll = isTrendWidgetKind
      ? (hasApiSeries ? (Array.isArray(apiHist) ? apiHist : []) : localHist)
      : localHist;
    const parseRangeMs = (raw) => {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
      const text = String(raw ?? "").trim();
      if (!text) return null;
      const ms = Date.parse(text);
      return Number.isFinite(ms) ? ms : null;
    };
    let rangeFrom = parseRangeMs(cfg?.rangeFrom);
    let rangeTo = parseRangeMs(cfg?.rangeTo);
    const windowMinutes = Math.max(1, Math.min(10080, Number(cfg?.windowMinutes) || 60));
    const maxPoints = Math.max(50, Math.min(10000, Number(cfg?.maxPoints) || 500));
    if (rangeFrom != null && rangeTo != null && rangeFrom > rangeTo) {
      const t = rangeFrom;
      rangeFrom = rangeTo;
      rangeTo = t;
    }
    if (rangeFrom == null && rangeTo == null) {
      const now = Date.now();
      rangeFrom = now - windowMinutes * 60 * 1000;
      rangeTo = now;
    }
    const hasRange = rangeFrom != null || rangeTo != null;
    const histFiltered = histAll.filter((p) => {
      const t = Number(p?.t);
      if (!Number.isFinite(t)) return false;
      if (rangeFrom != null && t < rangeFrom) return false;
      if (rangeTo != null && t > rangeTo) return false;
      return true;
    });
    const hist =
      histFiltered.length > maxPoints
        ? histFiltered.slice(-maxPoints)
        : histFiltered;
    const latestPoint = hist.length ? hist[hist.length - 1] : null;
    const displayN = latestPoint ? latestPoint.v : n;
    const compact = w < 220 || h < 130;
    const dense = w < 160 || h < 100;
    const widgetScale = Math.max(0.68, Math.min(1.15, Math.min(w, h) / 220));
    const scaledFont = (base, min = 7, max = 40) =>
      Math.max(min, Math.min(max, Math.round(Number(base || 0) * widgetScale)));
    const explicitTitleFontSizeRaw = Number.parseFloat(String(cfg?.titleFontSize ?? "").trim());
    const explicitTitleFontSize =
      Number.isFinite(explicitTitleFontSizeRaw) && explicitTitleFontSizeRaw > 0
        ? explicitTitleFontSizeRaw
        : null;
    const resolveWidgetTitleFontSize = (fallback, min = 7, max = 40) => {
      if (explicitTitleFontSize == null) return fallback;
      return Math.max(min, Math.min(max, explicitTitleFontSize));
    };
    const openWidgetProperties = (event) => {
      if (isLiveMode) return;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      handleOverlayDoubleClick(event, overlay, { force: true });
    };
    const widgetSurfaceCursor = isLiveMode
      ? (widgetInteractionEnabled ? "pointer" : "default")
      : (tool === "select" ? "move" : "crosshair");
    const headH = dense ? 20 : compact ? 24 : 28;
    const pad = dense ? 6 : compact ? 8 : 10;
    const cardTitle = title || "";
    const titleSize = resolveWidgetTitleFontSize(dense ? 8 : compact ? 9 : 10, 7, 40);
    const valueSize = scaledFont(dense ? 12 : compact ? 16 : 19, 9, 36);
    const valueColor = "var(--text)";
    const accent = "#2b8cff";
    const accentSoft = "#2b8cff33";
    const subdued = "var(--text-muted)";
    const formatTime = (ts) => {
      const nTs = Number(ts);
      if (!Number.isFinite(nTs)) return "--:--:--";
      try {
        return new Intl.DateTimeFormat([], {
          month: "short",
          day: "2-digit",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date(nTs));
      } catch {
        return "--:--:--";
      }
    };
    const formatAxisTime = (ts, withDate = false) => {
      const nTs = Number(ts);
      if (!Number.isFinite(nTs)) return "";
      try {
        return new Intl.DateTimeFormat([], withDate
          ? {
              month: "short",
              day: "2-digit",
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
            }
          : {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(nTs));
      } catch {
        return "";
      }
    };
    const formatTooltipTime = (ts) => {
      const nTs = Number(ts);
      if (!Number.isFinite(nTs)) return "--";
      try {
        return new Intl.DateTimeFormat([], {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(new Date(nTs));
      } catch {
        return "--";
      }
    };
    const latestTime = formatTime(latestPoint?.t);
    const formatDuration = (valueMs, precision = 1, unitOverride = "") => {
      const ms = Number(valueMs);
      if (!Number.isFinite(ms)) return "--";
      const abs = Math.max(0, ms);
      const normalizedUnit = String(unitOverride || "").trim().toLowerCase();
      if (normalizedUnit === "ms") {
        return `${Math.max(0, Math.round(abs)).toFixed(0)} ms`;
      }
      if (normalizedUnit === "s") {
        return `${(abs / 1000).toFixed(Math.max(0, precision))} s`;
      }
      if (abs >= 10000) return `${(abs / 1000).toFixed(Math.max(0, precision))} s`;
      return `${Math.max(0, Math.round(abs)).toFixed(0)} ms`;
    };

    if (kind === "kpi") {
      const display =
        displayN != null
          ? formatNum(displayN)
          : rawVal !== ""
          ? String(rawVal)
          : "--";
      return (
        <g pointerEvents="none">
          <rect x={x + 1} y={y + 1} width={w - 2} height={headH} rx={10} fill="var(--bg-elev)" />
          <text x={x + pad} y={y + headH - 7} fill={subdued} fontSize={titleSize} fontFamily="system-ui" fontWeight={700}>
            {cardTitle}
          </text>
          <text x={x + pad} y={y + Math.max(headH + 26, h * 0.62)} fill={valueColor} fontSize={valueSize} fontFamily="system-ui" fontWeight={800}>
            {display}
          </text>
          {!dense ? (
            <text x={x + pad} y={y + h - 10} fill={subdued} fontSize={scaledFont(10, 8, 18)} fontFamily="system-ui" fontWeight={600}>
              {`Updated ${latestTime}`}
            </text>
          ) : null}
          <line x1={x + pad} y1={y + headH + 4} x2={x + w - pad} y2={y + headH + 4} stroke="var(--border)" />
        </g>
      );
    }

    if (kind === "gauge") {
      const spanCfg = Math.max(1e-9, maxCfg - minCfg);
      const pct = displayN == null ? 0 : Math.max(0, Math.min(100, ((displayN - minCfg) / spanCfg) * 100));
      const gaugeTop = Math.round(y + headH + 2);
      const gaugeH = Math.max(26, Math.round(h - headH - 34));
      const gaugeW = Math.max(60, Math.round(w - pad * 2));
      const gaugeX = Math.round(x + pad);
      const viewScale = Math.max(1, Number(zoom) || 1);
      const overlayScale = Math.max(overlayScaleX(overlay), overlayScaleY(overlay), 1);
      const viewportDprBoost = Math.max(1, Number(viewportScale) || 1);
      const dpr =
        typeof window !== "undefined"
          ? Math.max(
              1,
              Math.min(8, (window.devicePixelRatio || 1) * viewScale * overlayScale * viewportDprBoost)
            )
          : 1;
      const gaugeKey = `g-${overlay.id}-${kind}-${gaugeW}x${gaugeH}-z${viewScale.toFixed(3)}-s${overlayScale.toFixed(3)}-vp${viewportDprBoost.toFixed(3)}`;
      const rootStyle =
        typeof window !== "undefined" ? window.getComputedStyle(document.documentElement) : null;
      const borderColor = rootStyle?.getPropertyValue("--border")?.trim() || "#334155";
      const textColor = rootStyle?.getPropertyValue("--text")?.trim() || "#e2e8f0";
      const gaugeData = {
        datasets: [
          {
            data: [pct, Math.max(0, 100 - pct)],
            backgroundColor: ["#2b6cff", borderColor],
            borderWidth: 0,
            circumference: 180,
            rotation: 270,
            cutout: "72%",
          },
        ],
      };
      const gaugeOptions = {
        responsive: true,
        maintainAspectRatio: false,
        devicePixelRatio: dpr,
        resizeDelay: 0,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      };
      return (
        <g pointerEvents="none">
          <rect x={x + 1} y={y + 1} width={w - 2} height={headH} rx={10} fill="var(--bg-elev)" />
          <text x={x + pad} y={y + headH - 7} fill={subdued} fontSize={titleSize} fontFamily="system-ui" fontWeight={700}>
            {cardTitle}
          </text>
          <foreignObject x={gaugeX} y={gaugeTop} width={gaugeW} height={gaugeH}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: "100%", height: "100%", pointerEvents: "none", position: "relative" }}>
              <Doughnut key={gaugeKey} data={gaugeData} options={gaugeOptions} />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 4,
                  textAlign: "center",
                  color: textColor,
                  fontSize: dense ? 10 : 11,
                  fontWeight: 700,
                  fontFamily: "system-ui",
                }}
              >
                {Number(pct).toFixed(1)}%
              </div>
            </div>
          </foreignObject>
          <text x={x + w / 2} y={y + h - (dense ? 8 : 10)} fill={valueColor} fontSize={dense ? 10 : compact ? 11 : 12} fontFamily="system-ui" fontWeight={700} textAnchor="middle">
            {displayN != null ? formatNum(displayN) : rawVal !== "" ? String(rawVal) : "--"}
          </text>
          {!dense ? (
            <text x={x + w / 2} y={y + h - 22} fill={subdued} fontSize={scaledFont(9, 7, 16)} fontFamily="system-ui" textAnchor="middle">
              {latestTime}
            </text>
          ) : null}
          {!dense ? (
            <text x={x + pad} y={y + h - 10} fill={subdued} fontSize={scaledFont(9, 7, 16)} fontFamily="system-ui">
              {minCfg.toFixed(decimals)}
            </text>
          ) : null}
          {!dense ? (
            <text x={x + w - pad} y={y + h - 10} fill={subdued} fontSize={scaledFont(9, 7, 16)} fontFamily="system-ui" textAnchor="end">
              {maxCfg.toFixed(decimals)}
            </text>
          ) : null}
        </g>
      );
    }

    if (kind === "weather") {
      const weatherLive = weatherByOverlayId?.[overlayId] || null;
      const tempValue = Number.isFinite(Number(weatherLive?.temp)) ? Number(weatherLive.temp) : displayN;
      const displayTemp =
        tempValue != null
          ? Number(tempValue).toFixed(Math.max(0, Number.isFinite(decimals) ? decimals : 0))
          : rawVal !== ""
          ? String(rawVal)
          : "--";
      const unitText = String(weatherLive?.unit || unit || "F").trim() || "F";
      const conditionText = String(weatherLive?.condition || cfg?.condition || cfg?.subtitle || "Partly Cloudy").trim() || "Partly Cloudy";
      const locationText = String(weatherLive?.location || cfg?.location || title || "Local").trim() || "Local";
      const humidityText = Number.isFinite(Number(weatherLive?.humidity))
        ? `Humidity ${Math.round(Number(weatherLive.humidity))}%`
        : "";
      const windText = Number.isFinite(Number(weatherLive?.windMph))
        ? `Wind ${Math.round(Number(weatherLive.windMph))} mph`
        : "";
      const cloudColor = isDarkTheme ? "#cbd5e1" : "#94a3b8";
      const sunColor = "#fbbf24";
      return (
        <g pointerEvents="none">
          <rect x={x + 1} y={y + 1} width={w - 2} height={h - 2} rx={12} fill={isDarkTheme ? "#0f172a" : "#f8fafc"} stroke="var(--border)" />
          <text x={x + pad} y={y + headH - 7} fill={subdued} fontSize={titleSize} fontFamily="system-ui" fontWeight={700}>
            {locationText}
          </text>
          <circle cx={x + pad + 40} cy={y + headH + 42} r={20} fill={sunColor} />
          <path
            d={`M ${x + pad + 66} ${y + headH + 66}
                h ${Math.max(70, w * 0.42)}
                a 18 18 0 0 0 0 -36
                a 24 24 0 0 0 -44 -8
                a 16 16 0 0 0 -26 14
                a 14 14 0 0 0 -16 30 z`}
            fill={cloudColor}
            opacity={0.95}
          />
          <text x={x + pad} y={y + h - 30} fill={valueColor} fontSize={scaledFont(30, 16, 42)} fontFamily="system-ui" fontWeight={800}>
            {displayTemp}
          </text>
          <text x={x + pad + 72} y={y + h - 34} fill={accent} fontSize={scaledFont(14, 10, 24)} fontFamily="system-ui" fontWeight={700}>
            {unitText}
          </text>
          <text x={x + pad} y={y + h - 10} fill={subdued} fontSize={scaledFont(11, 9, 18)} fontFamily="system-ui" fontWeight={600}>
            {conditionText}
          </text>
          {humidityText ? (
            <text x={x + w - pad} y={y + h - 24} fill={subdued} fontSize={scaledFont(10, 8, 16)} fontFamily="system-ui" textAnchor="end">
              {humidityText}
            </text>
          ) : null}
          {windText ? (
            <text x={x + w - pad} y={y + h - 10} fill={subdued} fontSize={scaledFont(10, 8, 16)} fontFamily="system-ui" textAnchor="end">
              {windText}
            </text>
          ) : null}
        </g>
      );
    }

    if (kind === "statusTable") {
      const rows = hist.slice(-rowCount).reverse();
      const rangeLatest = hist.length ? hist[hist.length - 1] : null;
      const showVal = rangeLatest
        ? formatNum(rangeLatest.v)
        : !hasRange && rawVal !== ""
        ? (n == null ? String(rawVal) : formatNum(n))
        : "--";
      const startY = y + headH + 14;
      const rowStep = dense ? 11 : 13;
      return (
        <g pointerEvents="none">
          <rect x={x + 1} y={y + 1} width={w - 2} height={headH} rx={10} fill="var(--bg-elev)" />
          <text x={x + pad} y={y + headH - 7} fill={subdued} fontSize={titleSize} fontFamily="system-ui" fontWeight={700}>
            {cardTitle}
          </text>
          <line x1={x + pad} y1={startY - 8} x2={x + w - pad} y2={startY - 8} stroke="var(--border)" />
          <text x={x + pad} y={startY} fill="var(--text)" fontSize={scaledFont(dense ? 8 : 9, 7, 16)} fontFamily="system-ui" fontWeight={700}>Source</text>
          <text x={x + Math.max(108, w * 0.43)} y={startY} fill="var(--text)" fontSize={scaledFont(dense ? 8 : 9, 7, 16)} fontFamily="system-ui" fontWeight={700}>Value</text>
          <text x={x + w - pad} y={startY} fill="var(--text)" fontSize={scaledFont(dense ? 8 : 9, 7, 16)} fontFamily="system-ui" fontWeight={700} textAnchor="end">Time</text>
          <text x={x + pad} y={startY + rowStep} fill={subdued} fontSize={scaledFont(dense ? 8 : 9, 7, 16)} fontFamily="system-ui">{label}</text>
          <text x={x + Math.max(108, w * 0.43)} y={startY + rowStep} fill={valueColor} fontSize={scaledFont(dense ? 8 : 9, 7, 16)} fontFamily="system-ui" fontWeight={700}>{showVal}</text>
          <text x={x + w - pad} y={startY + rowStep} fill={subdued} fontSize={scaledFont(dense ? 7 : 8, 6, 14)} fontFamily="system-ui" textAnchor="end">{latestTime}</text>
          {rows.slice(0, Math.max(0, rowCount - 1)).map((p, i) => (
            <g key={`wrow-${overlay.id}-${i}`}>
              <text
                x={x + Math.max(108, w * 0.43)}
                y={startY + rowStep * (i + 2)}
                fill={subdued}
                fontSize={scaledFont(dense ? 7 : 8, 6, 14)}
                fontFamily="system-ui"
              >
                {formatNum(p.v)}
              </text>
              <text
                x={x + w - pad}
                y={startY + rowStep * (i + 2)}
                fill={subdued}
                fontSize={scaledFont(dense ? 7 : 8, 6, 14)}
                fontFamily="system-ui"
                textAnchor="end"
              >
                {formatTime(p.t)}
              </text>
            </g>
          ))}
        </g>
      );
    }

    if (kind === "countdownBar") {
      const preTagPath = String(cfg?.timerPreTag || "").trim();
      const accTagPath = String(cfg?.timerAccTag || "").trim() || String(overlay?.tagPath || "").trim();
      const inferredPreFromAcc =
        !preTagPath && /\.acc$/i.test(accTagPath)
          ? accTagPath.replace(/\.acc$/i, ".PRE")
          : "";
      const resolvedPreTagPath = preTagPath || inferredPreFromAcc;
      const resolvedAccTagPath = accTagPath;
      const preRaw = resolvedPreTagPath ? getLiveValueForTagPath(resolvedPreTagPath) : "";
      const accRaw = resolvedAccTagPath ? getLiveValueForTagPath(resolvedAccTagPath) : "";
      const preMs = toNumberOrNull(preRaw);
      const accMs = toNumberOrNull(accRaw);
      const validTimer = Number.isFinite(preMs) && preMs > 0 && Number.isFinite(accMs);
      const safePre = validTimer ? Math.max(1, Number(preMs)) : 0;
      const safeAcc = validTimer ? Math.max(0, Math.min(Number(accMs), safePre)) : 0;
      const remainingMs = validTimer ? Math.max(0, safePre - safeAcc) : null;
      const completePct = validTimer ? Math.max(0, Math.min(100, (safeAcc / safePre) * 100)) : 0;
      const countdownPad = Math.max(5, Math.min(14, Math.round(w * 0.06)));
      const barX = x + countdownPad;
      const barW = Math.max(24, w - countdownPad * 2);
      const labelText = cardTitle;
      const showLabel = h >= 52 && Boolean(labelText);
      const labelFont = resolveWidgetTitleFontSize(
        scaledFont(dense ? 11 : 14, 10, 24),
        10,
        40
      );
      const topInset = Math.max(4, Math.round(h * 0.06));
      const bottomInset = Math.max(4, Math.round(h * 0.08));
      const gapAfterLabel = showLabel ? Math.max(2, Math.round(h * 0.03)) : 0;
      const labelY = y + topInset + labelFont;
      const barAreaTop = showLabel ? labelY + gapAfterLabel : y + topInset;
      const barAreaBottom = y + h - bottomInset;
      const barAreaH = Math.max(8, barAreaBottom - barAreaTop);
      const targetBarH = Math.round(barAreaH * 0.72);
      const barH = Math.max(10, Math.min(34, targetBarH));
      const barY = barAreaTop + Math.max(0, Math.round((barAreaH - barH) / 2));
      const barR = Math.max(4, Math.round(barH / 2));
      const fillW = Math.max(0, Math.min(barW, (barW * completePct) / 100));
      const valueText = validTimer ? formatDuration(remainingMs, decimals, unit) : "Unbound";
      const valueFont = Math.max(
        8,
        Math.min(16, Math.round(Math.min(barH * 0.42, barW * 0.09)))
      );
      return (
        <g pointerEvents="none">
          {showLabel ? (
            <text
              x={barX + barW / 2}
              y={labelY}
              fill={subdued}
              fontSize={labelFont}
              fontFamily="system-ui"
              fontWeight={800}
              textAnchor="middle"
            >
              {labelText}
            </text>
          ) : null}
          <rect x={barX} y={barY} width={barW} height={barH} rx={barR} fill="transparent" stroke="var(--border)" />
          <rect x={barX} y={barY} width={fillW} height={barH} rx={barR} fill={remainingMs === 0 ? "#16a34a" : accent} />
          <text
            x={barX + barW / 2}
            y={barY + barH / 2 + Math.max(2, Math.round(barH * 0.16))}
            fill={theme === "dark" ? "#ffffff" : "#111827"}
            fontSize={valueFont}
            fontFamily="system-ui"
            fontWeight={800}
            textAnchor="middle"
          >
            {valueText}
          </text>
        </g>
      );
    }

    if (kind === "displayBox") {
      const display =
        displayN != null
          ? formatNum(displayN)
          : rawVal !== ""
          ? String(rawVal)
          : "--";
      const tagPath = getWritableWidgetTagPath(overlay);
      const canWrite = Boolean(tagPath);
      const initialDraft =
        displayN != null
          ? String(Number(displayN))
          : rawVal !== ""
          ? String(rawVal)
          : "";
      const writeDraft = Object.prototype.hasOwnProperty.call(widgetWriteDraftByOverlay, overlayId)
        ? String(widgetWriteDraftByOverlay[overlayId] ?? "")
        : initialDraft;
      const writeBusy = widgetWriteBusyByOverlay?.[overlayId] === true;
      const writeError = String(widgetWriteErrorByOverlay?.[overlayId] || "");
      const inputH = dense ? 22 : 26;
      const controlsY = y + h - inputH - 8;
      const controlsW = Math.max(40, w - pad * 2);
      const btnW = Math.max(52, Math.min(88, Math.round(controlsW * 0.26)));
      const showControls = h >= (dense ? 96 : 108);
      return (
        <g>
          <rect x={x + 1} y={y + 1} width={w - 2} height={headH} rx={10} fill="var(--bg-elev)" />
          <text
            x={x + w / 2}
            y={y + headH - 7}
            fill={subdued}
            fontSize={titleSize}
            fontFamily="system-ui"
            fontWeight={700}
            textAnchor="middle"
          >
            {cardTitle}
          </text>
          <text x={x + pad} y={y + Math.max(headH + 26, h * 0.54)} fill={valueColor} fontSize={valueSize} fontFamily="system-ui" fontWeight={800}>
            {display}
          </text>
          {!dense ? (
            <text x={x + pad} y={y + headH + 16} fill={subdued} fontSize={10} fontFamily="system-ui" fontWeight={600}>
              {label}
            </text>
          ) : null}
          {!dense ? (
            <text x={x + w - pad} y={y + headH + 16} fill={subdued} fontSize={10} fontFamily="system-ui" fontWeight={600} textAnchor="end">
              {`Updated ${latestTime}`}
            </text>
          ) : null}
          {showControls ? (
            <foreignObject
              x={x + pad}
              y={controlsY}
              width={controlsW}
              height={inputH}
              style={{ pointerEvents: widgetInteractionEnabled ? "auto" : "none" }}
            >
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                onDoubleClickCapture={openWidgetProperties}
                style={{
                  display: "grid",
                  gridTemplateColumns: `${Math.max(20, controlsW - btnW - 6)}px ${btnW}px`,
                  gap: 6,
                  width: "100%",
                  height: "100%",
                  pointerEvents: widgetInteractionEnabled ? "auto" : "none",
                  cursor: widgetSurfaceCursor,
                }}
              >
                <input
                  data-widget-control="true"
                  onDoubleClick={openWidgetProperties}
                  value={writeDraft}
                  onMouseDown={(e) => {
                    if (!widgetInteractionEnabled) return;
                    e.stopPropagation();
                  }}
                  onChange={(e) => {
                    if (!widgetInteractionEnabled) return;
                    const nextVal = e.target.value;
                    setWidgetWriteDraftByOverlay((prev) => ({ ...prev, [overlayId]: nextVal }));
                    if (widgetWriteErrorByOverlay?.[overlayId]) {
                      setWidgetWriteErrorByOverlay((prev) => ({ ...prev, [overlayId]: "" }));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!widgetInteractionEnabled) return;
                    if (e.key !== "Enter" || writeBusy || !canWrite) return;
                    e.preventDefault();
                    submitWidgetWrite(overlay, writeDraft);
                  }}
                  placeholder={canWrite ? "Write value" : "Bind OPC tag to write"}
                  disabled={!widgetInteractionEnabled || !canWrite || writeBusy}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 7,
                    padding: "0 8px",
                    fontSize: dense ? 11 : 12,
                    boxSizing: "border-box",
                    cursor: widgetSurfaceCursor,
                  }}
                />
                <button
                  data-widget-control="true"
                  onDoubleClick={openWidgetProperties}
                  onMouseDown={(e) => {
                    if (!widgetInteractionEnabled) return;
                    e.stopPropagation();
                  }}
                  onClick={() => {
                    if (!widgetInteractionEnabled) return;
                    submitWidgetWrite(overlay, writeDraft);
                  }}
                  disabled={!widgetInteractionEnabled || !canWrite || writeBusy}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "white",
                    borderRadius: 7,
                    fontSize: dense ? 10 : 11,
                    fontWeight: 700,
                    cursor: !widgetInteractionEnabled
                      ? widgetSurfaceCursor
                      : (!canWrite || writeBusy ? "default" : "pointer"),
                    opacity: !canWrite || writeBusy ? 0.7 : 1,
                  }}
                >
                  {writeBusy ? "..." : "Write"}
                </button>
              </div>
            </foreignObject>
          ) : null}
          {writeError ? (
            <text x={x + pad} y={showControls ? controlsY - 4 : y + h - 8} fill="#f04438" fontSize={9} fontFamily="system-ui" fontWeight={700}>
              {writeError}
            </text>
          ) : null}
          <line x1={x + pad} y1={y + headH + 4} x2={x + w - pad} y2={y + headH + 4} stroke="var(--border)" />
        </g>
      );
    }

    if (kind === "pushButton") {
      const tagPath = getWritableWidgetTagPath(overlay);
      const canWrite = Boolean(tagPath);
      const writeBusy = widgetWriteBusyByOverlay?.[overlayId] === true;
      const writeError = String(widgetWriteErrorByOverlay?.[overlayId] || "");
      const pressValue = Object.prototype.hasOwnProperty.call(cfg || {}, "writeValue") ? cfg.writeValue : 1;
      const releaseValue = Object.prototype.hasOwnProperty.call(cfg || {}, "releaseValue") ? cfg.releaseValue : 0;
      const pressed = toBooleanLike(rawVal);
      const localPressed = widgetPressByOverlay?.[overlayId] === true;
      const visualPressed = localPressed || pressed;
      const titleText = cardTitle || "Push Button";
      const titleFont = resolveWidgetTitleFontSize(
        scaledFont(dense ? 11 : 13, 9, 20),
        9,
        40
      );
      const contentPadX = Math.max(6, Math.min(14, Math.round(w * 0.06)));
      const topInset = Math.max(4, Math.round(h * 0.06));
      const bottomInset = Math.max(4, Math.round(h * 0.08));
      const showTitle = Boolean(titleText);
      const titleY = y + topInset + titleFont;
      const contentTop = showTitle
        ? titleY + Math.max(8, Math.round(h * 0.08))
        : y + topInset;
      const buttonW = Math.max(40, Math.round(w - contentPadX * 2));
      const buttonH = Math.max(18, Math.round(y + h - bottomInset - contentTop));
      const buttonX = x + contentPadX;
      const buttonY = contentTop;
      return (
        <g>
          {showTitle ? (
            <text
              x={buttonX + buttonW / 2}
              y={titleY}
              fill="rgba(248, 250, 252, 0.96)"
              fontSize={titleFont}
              fontFamily="system-ui"
              fontWeight={800}
              textAnchor="middle"
            >
              {titleText}
            </text>
          ) : null}
          <foreignObject
            x={buttonX}
            y={buttonY}
            width={buttonW}
            height={buttonH}
            style={{ pointerEvents: "none" }}
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              onDoubleClickCapture={openWidgetProperties}
              style={{ width: "100%", height: "100%", pointerEvents: "none", cursor: widgetSurfaceCursor }}
            >
              <button
                data-widget-control={widgetInteractionEnabled ? "true" : undefined}
                onMouseDown={(e) => {
                  if (!widgetInteractionEnabled) return;
                  e.stopPropagation();
                  setWidgetPressed(overlayId, true);
                  if (writeBusy) return;
                  if (!canWrite) {
                    setWidgetWriteErrorByOverlay((prev) => ({
                      ...prev,
                      [overlayId]: getMissingWidgetWriteTargetMessage(overlay),
                    }));
                    return;
                  }
                  submitWidgetWrite(overlay, pressValue);
                }}
                onMouseUp={(e) => {
                  if (!widgetInteractionEnabled) return;
                  e.stopPropagation();
                  setWidgetPressed(overlayId, false);
                  if (writeBusy || !canWrite) return;
                  submitWidgetWrite(overlay, releaseValue);
                }}
                onMouseLeave={() => {
                  if (!widgetInteractionEnabled) return;
                  setWidgetPressed(overlayId, false);
                  if (writeBusy || !canWrite) return;
                  submitWidgetWrite(overlay, releaseValue);
                }}
                onTouchStart={(e) => {
                  if (!widgetInteractionEnabled) return;
                  e.stopPropagation();
                  setWidgetPressed(overlayId, true);
                  if (writeBusy) return;
                  if (!canWrite) {
                    setWidgetWriteErrorByOverlay((prev) => ({
                      ...prev,
                      [overlayId]: getMissingWidgetWriteTargetMessage(overlay),
                    }));
                    return;
                  }
                  submitWidgetWrite(overlay, pressValue);
                }}
                onTouchEnd={() => {
                  if (!widgetInteractionEnabled) return;
                  setWidgetPressed(overlayId, false);
                  if (writeBusy || !canWrite) return;
                  submitWidgetWrite(overlay, releaseValue);
                }}
                disabled={!widgetInteractionEnabled || writeBusy}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  borderRadius: Math.max(8, Math.round(buttonH * 0.22)),
                  background: visualPressed
                    ? "linear-gradient(180deg, #1d4ed8 0%, #1e40af 100%)"
                    : "linear-gradient(180deg, #4f8dff 0%, #2b6cff 100%)",
                  color: "white",
                  fontSize: Math.max(8, Math.min(16, Math.round(buttonH * 0.34))),
                  fontWeight: 800,
                  cursor: !widgetInteractionEnabled ? widgetSurfaceCursor : (writeBusy ? "default" : "pointer"),
                  opacity: !canWrite ? 0.65 : 1,
                  boxShadow: visualPressed
                    ? "inset 0 4px 10px rgba(2,6,23,0.38), inset 0 -1px 2px rgba(255,255,255,0.12)"
                    : "inset 0 1px 0 rgba(255,255,255,0.35), 0 6px 12px rgba(43,108,255,0.2)",
                  transform: visualPressed ? "translateY(1px) scale(0.99)" : "translateY(0) scale(1)",
                  transition: "transform 80ms ease, box-shadow 120ms ease, filter 120ms ease",
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: Math.max(8, Math.round(buttonH * 0.16)),
                  padding: `0 ${Math.max(10, Math.round(buttonW * 0.08))}px`,
                }}
              >
                <span
                  style={{
                    fontSize: Math.max(9, Math.min(18, Math.round(buttonH * 0.34))),
                    fontWeight: 900,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.98)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {writeBusy ? "Writing..." : visualPressed ? "Pressed" : "Press"}
                </span>
              </button>
            </div>
          </foreignObject>
          {widgetInteractionEnabled ? (
            <rect
              x={buttonX}
              y={buttonY}
              width={buttonW}
              height={buttonH}
              rx={Math.max(8, Math.round(buttonH * 0.22))}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: writeBusy ? "default" : "pointer" }}
              onDoubleClick={openWidgetProperties}
              onMouseDown={(e) => {
                e.stopPropagation();
                setWidgetPressed(overlayId, true);
                if (writeBusy) return;
                if (!canWrite) {
                  setWidgetWriteErrorByOverlay((prev) => ({
                    ...prev,
                    [overlayId]: getMissingWidgetWriteTargetMessage(overlay),
                  }));
                  return;
                }
                submitWidgetWrite(overlay, pressValue);
              }}
              onMouseUp={(e) => {
                e.stopPropagation();
                setWidgetPressed(overlayId, false);
                if (writeBusy || !canWrite) return;
                submitWidgetWrite(overlay, releaseValue);
              }}
              onMouseLeave={() => {
                setWidgetPressed(overlayId, false);
                if (writeBusy || !canWrite) return;
                submitWidgetWrite(overlay, releaseValue);
              }}
            />
          ) : null}
          {writeError ? (
            <text x={buttonX} y={Math.max(y + 10, buttonY - 4)} fill="#f04438" fontSize={9} fontFamily="system-ui" fontWeight={700}>
              {writeError}
            </text>
          ) : null}
        </g>
      );
    }

    if (kind === "onOffButton") {
      const tagPath = getWritableWidgetTagPath(overlay);
      const canWrite = Boolean(tagPath);
      const writeBusy = widgetWriteBusyByOverlay?.[overlayId] === true;
      const writeError = String(widgetWriteErrorByOverlay?.[overlayId] || "");
      const isOn = toBooleanLike(rawVal);
      const localPressed = widgetPressByOverlay?.[overlayId] === true;
      const titleText = cardTitle || "On / Off";
      const titleFont = resolveWidgetTitleFontSize(
        scaledFont(dense ? 11 : 13, 9, 20),
        9,
        40
      );
      const contentPadX = Math.max(6, Math.min(14, Math.round(w * 0.06)));
      const topInset = Math.max(4, Math.round(h * 0.06));
      const bottomInset = Math.max(4, Math.round(h * 0.08));
      const showTitle = Boolean(titleText);
      const titleY = y + topInset + titleFont;
      const contentTop = showTitle
        ? titleY + Math.max(8, Math.round(h * 0.08))
        : y + topInset;
      const buttonW = Math.max(54, Math.round(w - contentPadX * 2));
      const buttonH = Math.max(28, Math.round(y + h - bottomInset - contentTop));
      const buttonX = x + contentPadX;
      const buttonY = contentTop;
      return (
        <g>
          {showTitle ? (
            <text
              x={buttonX + buttonW / 2}
              y={titleY}
              fill="rgba(248, 250, 252, 0.96)"
              fontSize={titleFont}
              fontFamily="system-ui"
              fontWeight={800}
              textAnchor="middle"
            >
              {titleText}
            </text>
          ) : null}
          <foreignObject
            x={buttonX}
            y={buttonY}
            width={buttonW}
            height={buttonH}
            style={{ pointerEvents: "none" }}
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              onDoubleClickCapture={openWidgetProperties}
              style={{ width: "100%", height: "100%", pointerEvents: "none", cursor: widgetSurfaceCursor }}
            >
              <button
                data-widget-control={widgetInteractionEnabled ? "true" : undefined}
                onMouseDown={(e) => {
                  if (!widgetInteractionEnabled) return;
                  e.stopPropagation();
                  setWidgetPressed(overlayId, true);
                }}
                onMouseUp={() => setWidgetPressed(overlayId, false)}
                onMouseLeave={() => setWidgetPressed(overlayId, false)}
                onClick={(e) => {
                  if (!widgetInteractionEnabled) return;
                  e.stopPropagation();
                  pulseWidgetPress(overlayId, 180);
                  if (writeBusy) return;
                  if (!canWrite) {
                    setWidgetWriteErrorByOverlay((prev) => ({
                      ...prev,
                      [overlayId]: getMissingWidgetWriteTargetMessage(overlay),
                    }));
                    return;
                  }
                  submitWidgetWrite(overlay, isOn ? 0 : 1);
                }}
                disabled={!widgetInteractionEnabled || writeBusy}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  borderRadius: 0,
                  background: "transparent",
                  color: "white",
                  fontSize: Math.max(8, Math.min(16, Math.round(buttonH * 0.34))),
                  fontWeight: 800,
                  cursor: !widgetInteractionEnabled ? widgetSurfaceCursor : (writeBusy ? "default" : "pointer"),
                  opacity: !canWrite ? 0.65 : 1,
                  boxShadow: "none",
                  transform: localPressed ? "translateY(1px) scale(0.99)" : "translateY(0) scale(1)",
                  transition: "transform 80ms ease, box-shadow 120ms ease, filter 120ms ease",
                  pointerEvents: "none",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: Math.max(6, Math.round(buttonW * 0.025)),
                  padding: 0,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: Math.max(8, Math.round(buttonH * 0.18)),
                    background: isOn
                      ? "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)"
                      : "linear-gradient(180deg, rgba(51, 65, 85, 0.92) 0%, rgba(30, 41, 59, 0.94) 100%)",
                    border: isOn
                      ? "1px solid rgba(187, 247, 208, 0.65)"
                      : "1px solid rgba(100, 116, 139, 0.6)",
                    boxShadow: isOn
                      ? "inset 0 1px 0 rgba(255,255,255,0.28), 0 6px 14px rgba(22,163,74,0.22)"
                      : "inset 0 1px 0 rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.98)",
                    fontSize: Math.max(9, Math.min(16, Math.round(buttonH * 0.28))),
                    fontWeight: 900,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    minHeight: "100%",
                  }}
                >
                  ON
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: Math.max(8, Math.round(buttonH * 0.18)),
                    background: !isOn
                      ? "linear-gradient(180deg, #64748b 0%, #334155 100%)"
                      : "linear-gradient(180deg, rgba(51, 65, 85, 0.92) 0%, rgba(30, 41, 59, 0.94) 100%)",
                    border: !isOn
                      ? "1px solid rgba(203, 213, 225, 0.55)"
                      : "1px solid rgba(100, 116, 139, 0.6)",
                    boxShadow: !isOn
                      ? "inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px rgba(51,65,85,0.22)"
                      : "inset 0 1px 0 rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.98)",
                    fontSize: Math.max(9, Math.min(16, Math.round(buttonH * 0.28))),
                    fontWeight: 900,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    minHeight: "100%",
                  }}
                >
                  OFF
                </span>
              </button>
            </div>
          </foreignObject>
          {widgetInteractionEnabled ? (
            <rect
              x={buttonX}
              y={buttonY}
              width={buttonW}
              height={buttonH}
              rx={Math.max(8, Math.round(buttonH * 0.22))}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: writeBusy ? "default" : "pointer" }}
              onDoubleClick={openWidgetProperties}
              onMouseDown={(e) => {
                e.stopPropagation();
                setWidgetPressed(overlayId, true);
              }}
              onMouseUp={() => setWidgetPressed(overlayId, false)}
              onMouseLeave={() => setWidgetPressed(overlayId, false)}
              onClick={(e) => {
                e.stopPropagation();
                pulseWidgetPress(overlayId, 180);
                if (writeBusy) return;
                if (!canWrite) {
                  setWidgetWriteErrorByOverlay((prev) => ({
                    ...prev,
                    [overlayId]: getMissingWidgetWriteTargetMessage(overlay),
                  }));
                  return;
                }
                submitWidgetWrite(overlay, isOn ? 0 : 1);
              }}
            />
          ) : null}
          {writeError ? (
            <text x={x + pad} y={buttonY - 4} fill="#f04438" fontSize={9} fontFamily="system-ui" fontWeight={700}>
              {writeError}
            </text>
          ) : null}
        </g>
      );
    }

    const pointsRaw = kind === "barChart"
      ? barValues.map((v, idx) => ({ t: idx + 1, v: Number(v) }))
      : hist.length
      ? hist.map((p) => ({ t: Number(p?.t), v: Number(p?.v) }))
      : !isTrendWidgetKind && !hasRange && n != null
      ? [{ t: Date.now(), v: n }]
      : [];
    const pointsSorted = pointsRaw
      .filter((p) => Number.isFinite(p.t) && p.t > 0 && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    const pointsDeduped = [];
    for (let i = 0; i < pointsSorted.length; i += 1) {
      const pt = pointsSorted[i];
      const prev = pointsDeduped[pointsDeduped.length - 1];
      if (prev && prev.t === pt.t) pointsDeduped[pointsDeduped.length - 1] = pt;
      else pointsDeduped.push(pt);
    }
    const smoothTransientZeroSpikes = (arr) => {
      const src = Array.isArray(arr) ? arr : [];
      if (src.length < 3) return src;
      const out = src.map((p) => ({ ...p }));
      for (let i = 1; i < out.length - 1; i += 1) {
        const prev = out[i - 1];
        const cur = out[i];
        const next = out[i + 1];
        if (!prev || !cur || !next) continue;
        if (!Number.isFinite(prev.v) || !Number.isFinite(cur.v) || !Number.isFinite(next.v)) continue;
        if (cur.v !== 0) continue;
        if (prev.v === 0 || next.v === 0) continue;
        const near = Math.max(Math.abs(prev.v), Math.abs(next.v), 1);
        if (Math.abs(prev.v - next.v) > near * 0.15) continue;
        out[i].v = (prev.v + next.v) / 2;
      }
      return out;
    };
    const pointsSmoothed = smoothTransientZeroSpikes(pointsDeduped);
    const maxRenderPoints = Math.max(120, Math.min(1800, Number(cfg?.maxPoints) || 800));
    const downsampleMinMax = (arr, limit) => {
      if (!Array.isArray(arr) || arr.length <= limit) return arr || [];
      if (limit <= 2) return [arr[0], arr[arr.length - 1]];
      const out = [arr[0]];
      const interior = arr.length - 2;
      const bucket = Math.max(1, Math.ceil(interior / Math.max(1, limit - 2)));
      for (let start = 1; start < arr.length - 1; start += bucket) {
        const end = Math.min(arr.length - 1, start + bucket);
        let minIdx = start;
        let maxIdx = start;
        for (let i = start + 1; i < end; i += 1) {
          if (arr[i].v < arr[minIdx].v) minIdx = i;
          if (arr[i].v > arr[maxIdx].v) maxIdx = i;
        }
        if (minIdx === maxIdx) {
          out.push(arr[minIdx]);
        } else if (minIdx < maxIdx) {
          out.push(arr[minIdx], arr[maxIdx]);
        } else {
          out.push(arr[maxIdx], arr[minIdx]);
        }
      }
      out.push(arr[arr.length - 1]);
      if (out.length <= limit) return out;
      const stride = (out.length - 1) / (limit - 1);
      return Array.from({ length: limit }, (_, i) => out[Math.min(out.length - 1, Math.round(i * stride))]);
    };
    const points = downsampleMinMax(pointsSmoothed, maxRenderPoints);
    const valuesSource = pointsSmoothed.length ? pointsSmoothed : points;
    const formatLineSeriesLabel = (rawTag) => {
      const value = String(rawTag || "").trim();
      if (!value) return "Series";
      const bits = value.split(".").map((x) => x.trim()).filter(Boolean);
      if (!bits.length) return value;
      if (bits.length === 1) return bits[0];
      return bits.slice(-2).join(".");
    };
    const palette = ["#2563eb", "#0891b2", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0284c7", "#4f46e5"];
    const lineSeriesMultiRaw =
      kind === "lineChart"
        ? effectiveSeries
            .map((s, idx) => {
              const pts = (Array.isArray(s?.points) ? s.points : [])
                .map((p) => ({ t: Number(p?.t) || 0, v: toNumberOrNull(p?.v) }))
                .filter((p) => Number.isFinite(p.t) && p.t > 0 && Number.isFinite(p.v))
                .filter((p) => (rangeFrom == null || p.t >= rangeFrom) && (rangeTo == null || p.t <= rangeTo));
              const clipped = pts.length > maxPoints ? pts.slice(-maxPoints) : pts;
              const sampled = downsampleMinMax(smoothTransientZeroSpikes(clipped), maxRenderPoints);
              return {
                key: String(s?.tagKey || s?.tagPath || `series-${idx}`),
                label: formatLineSeriesLabel(s?.tagPath || s?.tagKey || `Series ${idx + 1}`),
                color: palette[idx % palette.length],
                points: sampled,
              };
            })
        : [];
    const useMultiLine = kind === "lineChart" && lineSeriesMultiRaw.length > 1;
    const multiTimeline = useMultiLine
      ? Array.from(
          new Set(
            lineSeriesMultiRaw.flatMap((s) => s.points.map((p) => Number(p.t))).filter((t) => Number.isFinite(t))
          )
        ).sort((a, b) => a - b)
      : [];
    const values = useMultiLine
      ? lineSeriesMultiRaw.flatMap((s) => s.points.map((p) => p.v))
      : valuesSource.map((p) => p.v);
    const axisMode =
      (kind === "lineChart" || kind === "areaChart" || kind === "barChart")
        ? (String(cfg?.axisMode || "").trim().toLowerCase() === "manual" ? "manual" : "auto")
        : "auto";
    const dataMin = values.length ? Math.min(...values) : minCfg;
    const dataMax = values.length ? Math.max(...values) : maxCfg;
    const manualMin = Number.isFinite(Number(cfg?.min)) ? Number(cfg.min) : null;
    const manualMax = Number.isFinite(Number(cfg?.max)) ? Number(cfg.max) : null;
    let minV =
      axisMode === "manual" && manualMin != null && manualMax != null
        ? Math.min(manualMin, manualMax)
        : dataMin;
    let maxV =
      axisMode === "manual" && manualMin != null && manualMax != null
        ? Math.max(manualMin, manualMax)
        : dataMax;
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
      minV = 0;
      maxV = 1;
    }
    // Graph widgets should anchor at zero in auto mode.
    if ((kind === "lineChart" || kind === "areaChart" || kind === "barChart") && axisMode !== "manual") {
      minV = 0;
      if (maxV <= minV) maxV = 1;
    }
    if (minV === maxV) {
      const padV = Math.max(1, Math.abs(minV) * 0.05);
      minV -= padV;
      maxV += padV;
    }
    const footerH = dense ? 0 : 16;
    const chartTop = Math.round(y + headH + 4);
    const minChartH = kind === "barChart" ? 14 : 30;
    const minChartW = kind === "barChart" ? 20 : 60;
    const chartH = Math.max(minChartH, Math.round(h - headH - 14 - footerH));
    const chartW = Math.max(minChartW, Math.round(w - pad * 2));
    const chartX = Math.round(x + pad);
    const applyWindowZoom = (factor) => {
      const safeFactor = Number(factor);
      if (!Number.isFinite(safeFactor) || safeFactor <= 0) return;
      const nowTs = Date.now();
      const currentFrom = Number.isFinite(rangeFrom) ? Number(rangeFrom) : nowTs - windowMinutes * 60 * 1000;
      const currentTo = Number.isFinite(rangeTo) ? Number(rangeTo) : nowTs;
      const left = Math.min(currentFrom, currentTo);
      const right = Math.max(currentFrom, currentTo);
      const span = Math.max(60_000, right - left);
      const nextSpan = Math.max(60_000, Math.min(10080 * 60 * 1000, span * safeFactor));
      const center = left + span / 2;
      const nextFrom = Math.round(center - nextSpan / 2);
      const nextTo = Math.round(center + nextSpan / 2);
      const nextMinutes = Math.max(1, Math.min(10080, Math.round(nextSpan / 60000)));
      setSvgOverlays?.((prev) =>
        prev.map((o) =>
          o.id !== overlay.id
            ? o
            : {
                ...o,
                widget: {
                  ...(o.widget || {}),
                  durationPreset: "",
                  windowMinutes: nextMinutes,
                  rangeFrom: nextFrom,
                  rangeTo: nextTo,
                },
              }
        )
      );
      widgetTrendSeriesRef.current.set(String(overlay.id || ""), []);
      setWidgetTrendTick((x) => x + 1);
      setWidgetTrendReloadNonce((n) => n + 1);
    };
    const toDateInput = (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) return "";
      const d = new Date(n);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
      return local.toISOString().slice(0, 10);
    };
    const parseDateInput = (raw, endOfDay = false) => {
      const text = String(raw || "").trim();
      if (!text) return null;
      const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
      const ms = Date.parse(`${text}${suffix}`);
      return Number.isFinite(ms) ? ms : null;
    };
    const applyRangeFromTo = (nextFromRaw, nextToRaw) => {
      let nextFrom = parseDateInput(nextFromRaw, false);
      let nextTo = parseDateInput(nextToRaw, true);
      if (nextFrom != null && nextTo != null && nextFrom > nextTo) {
        const t = nextFrom;
        nextFrom = nextTo;
        nextTo = t;
      }
      const nextWindowMinutes =
        nextFrom != null && nextTo != null
          ? Math.max(1, Math.min(10080, Math.round((nextTo - nextFrom) / 60000)))
          : windowMinutes;
      setSvgOverlays?.((prev) =>
        prev.map((o) =>
          o.id !== overlay.id
            ? o
            : {
                ...o,
                widget: {
                  ...(o.widget || {}),
                  durationPreset: "",
                  windowMinutes: nextWindowMinutes,
                  rangeFrom: nextFrom,
                  rangeTo: nextTo,
                },
              }
        )
      );
      widgetTrendSeriesRef.current.set(String(overlay.id || ""), []);
      setWidgetTrendTick((x) => x + 1);
      setWidgetTrendReloadNonce((n) => n + 1);
    };
    const resetZoomWindow = () => {
      setSvgOverlays?.((prev) =>
        prev.map((o) =>
          o.id !== overlay.id
            ? o
            : {
                ...o,
                widget: {
                  ...(o.widget || {}),
                  rangeFrom: null,
                  rangeTo: null,
                },
              }
        )
      );
      widgetTrendSeriesRef.current.set(String(overlay.id || ""), []);
      setWidgetTrendTick((x) => x + 1);
      setWidgetTrendReloadNonce((n) => n + 1);
    };
    const activeDurationLabel = `${windowMinutes}m`;
    const isDateRangeWidget = kind === "lineChart" || kind === "areaChart" || kind === "statusTable";
    const rangeFromInput = toDateInput(rangeFrom);
    const rangeToInput = toDateInput(rangeTo);
    const viewScale = Math.max(1, Number(zoom) || 1);
    const overlayScale = Math.max(overlayScaleX(overlay), overlayScaleY(overlay), 1);
    const viewportDprBoost = Math.max(1, Number(viewportScale) || 1);
    const dpr =
      typeof window !== "undefined"
        ? Math.max(
            1,
            Math.min(8, (window.devicePixelRatio || 1) * viewScale * overlayScale * viewportDprBoost)
          )
        : 1;
    const chartKey = `c-${overlay.id}-${kind}-${chartW}x${chartH}-z${viewScale.toFixed(3)}-s${overlayScale.toFixed(3)}-vp${viewportDprBoost.toFixed(3)}`;
    const rootStyle =
      typeof window !== "undefined" ? window.getComputedStyle(document.documentElement) : null;
    const isDark = String(theme || "").toLowerCase() === "dark";
    const textColor = rootStyle?.getPropertyValue("--text-muted")?.trim() || (isDark ? "#b7c4d8" : "#5d6b82");
    const chartPanelFill = isDark ? "#0b1220" : "#ffffff";
    const gridColor = isDark ? "rgba(148,163,184,0.24)" : "rgba(100,116,139,0.22)";
    const axisColor = isDark ? "#d4deee" : "#334155";
    const accentLine = isDark ? "#22d3ee" : "#2563eb";
    const accentFillTop = isDark ? "rgba(34,211,238,0.42)" : "rgba(37,99,235,0.32)";
    const accentFillBottom = isDark ? "rgba(34,211,238,0.06)" : "rgba(37,99,235,0.05)";
    const barFill = isDark ? "rgba(45,212,191,0.9)" : "rgba(59,130,246,0.9)";
    const tooltipBg = isDark ? "rgba(8,14,24,0.96)" : "rgba(255,255,255,0.96)";
    const tooltipText = isDark ? "#e6eefc" : "#1b2a41";
    const tooltipBorder = isDark ? "rgba(118,149,195,0.32)" : "rgba(54,96,163,0.22)";
    const trimTick = (nVal, maxFractionDigits) => {
      const safeDigits = Math.max(0, Math.min(3, Number(maxFractionDigits) || 0));
      return Number(nVal).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: safeDigits,
      });
    };
    const yTickFmt = (v) => {
      const nVal = Number(v);
      if (!Number.isFinite(nVal)) return "";
      const abs = Math.abs(nVal);
      const approxTickCount = dense ? 3 : 5;
      const spanForTicks = Math.max(1e-9, Math.abs(maxV - minV));
      const tickStep = spanForTicks / approxTickCount;
      const compact = kind === "lineChart" || kind === "areaChart" || kind === "barChart";
      if (compact && abs >= 1_000_000_000) return `${trimTick(nVal / 1_000_000_000, 1)}B`;
      if (compact && abs >= 1_000_000) return `${trimTick(nVal / 1_000_000, 1)}M`;
      if (compact && abs >= 1_000) return `${trimTick(nVal / 1_000, 1)}K`;
      const stepDigits =
        tickStep >= 1
          ? 0
          : Math.max(1, Math.min(3, Math.ceil(-Math.log10(tickStep))));
      const axisDigits = Math.max(
        stepDigits,
        abs < 1 ? 3 : abs < 10 ? 2 : abs < 100 ? 1 : 0
      );
      return trimTick(nVal, axisDigits);
    };
    const axisTimeline = kind === "barChart"
      ? barValues.map((_, idx) => idx)
      : useMultiLine
      ? multiTimeline
      : points.map((p) => Number(p.t)).filter((t) => Number.isFinite(t));
    const firstTs = axisTimeline.length ? Number(axisTimeline[0]) : null;
    const lastTs = axisTimeline.length ? Number(axisTimeline[axisTimeline.length - 1]) : null;
    const spanMs =
      Number.isFinite(firstTs) && Number.isFinite(lastTs) ? Math.max(0, lastTs - firstTs) : 0;
    const showDateOnAxis = spanMs >= 24 * 60 * 60 * 1000;
    const labels = kind === "barChart"
      ? axisTimeline.map((_, idx) => String(barLabelsRaw[idx] || idx + 1))
      : axisTimeline.map((ts) => formatAxisTime(ts, showDateOnAxis));
    const rangeStartTs = Number.isFinite(rangeFrom) ? Number(rangeFrom) : null;
    const rangeEndTs = Number.isFinite(rangeTo) ? Number(rangeTo) : null;
    const rangeStartLabel = rangeStartTs != null ? formatAxisTime(rangeStartTs, true) : "--";
    const rangeEndLabel = rangeEndTs != null ? formatAxisTime(rangeEndTs, true) : "--";
    const footerValue =
      displayN != null
        ? formatNum(displayN)
        : rawVal !== ""
        ? String(rawVal)
        : "--";
    const samplesCount = axisTimeline.length;
    const lastUpdateTs = kind === "barChart"
      ? Number(barDataset?.updatedAt) || null
      : Number.isFinite(lastTs)
      ? lastTs
      : null;
    const lastUpdateLabel = lastUpdateTs != null ? formatTooltipTime(lastUpdateTs) : "--";
    const lineTension = Math.max(0, Math.min(1, Number(cfg?.lineTension) || 0.34));
    const lineStyle = String(cfg?.lineStyle || "").trim().toLowerCase() === "step" ? "step" : "smooth";
    const isStepLine = lineStyle === "step";
    const lineWidth = Math.max(1, Math.min(8, Number(cfg?.lineWidth) || 2.4));
    const showLegend = cfg?.showLegend !== false;
    const showGrid = cfg?.showGrid !== false;
    const markSpots = cfg?.markSpots !== false;
    const markerSize = Math.max(2, Math.min(12, Number(cfg?.markerSize) || 4.2));
    const yAxisSide = String(cfg?.yAxisSide || "").trim().toLowerCase() === "right" ? "right" : "left";
    const effectiveTension = isStepLine ? 0 : (axisTimeline.length > 240 ? 0 : lineTension);
    const showPoints = cfg?.showPoints !== false;
    const basePointRadius = !showPoints || dense ? 0 : axisTimeline.length <= 2 ? 3.6 : 2.2;
    const markColor = isDark ? "#f59e0b" : "#d97706";
    const makeMarkIndexSet = (vals) => {
      const set = new Set();
      if (!Array.isArray(vals) || !vals.length) return set;
      let minIdx = -1;
      let maxIdx = -1;
      let minVal = Infinity;
      let maxVal = -Infinity;
      vals.forEach((raw, idx) => {
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        if (minIdx < 0) minIdx = idx;
        if (maxIdx < 0) maxIdx = idx;
        if (n < minVal) {
          minVal = n;
          minIdx = idx;
        }
        if (n > maxVal) {
          maxVal = n;
          maxIdx = idx;
        }
      });
      if (minIdx >= 0) set.add(minIdx);
      if (maxIdx >= 0) set.add(maxIdx);
      for (let i = vals.length - 1; i >= 0; i -= 1) {
        if (Number.isFinite(Number(vals[i]))) {
          set.add(i);
          break;
        }
      }
      return set;
    };
    const singleMarkIndexes = makeMarkIndexSet(points.map((p) => Number(p?.v)));
    const multiMarkIndexes = new Map(
      lineSeriesMultiRaw.map((series) => {
        const byTs = new Map(series.points.map((p) => [Number(p.t), Number(p.v)]));
        const vals = axisTimeline.map((ts) => (byTs.has(Number(ts)) ? byTs.get(Number(ts)) : null));
        return [series.label, makeMarkIndexSet(vals)];
      })
    );
    const baseScales = dense
      ? { x: { display: false }, y: { display: false } }
      : {
          x: {
            display: true,
            alignToPixels: true,
            offset: false,
            ticks: {
              color: axisColor,
              maxTicksLimit: dense ? 3 : 6,
              minRotation: 0,
              maxRotation: 0,
              autoSkip: true,
              autoSkipPadding: 10,
              font: { size: 10, weight: "600" },
            },
            grid: { color: showGrid ? gridColor : "transparent", drawBorder: false },
            border: { display: false },
          },
          y: {
            display: true,
            alignToPixels: true,
            position: yAxisSide,
            ticks: {
              color: axisColor,
              font: { size: 10, weight: "600" },
              maxTicksLimit: 5,
              callback: yTickFmt,
            },
            grid: { color: showGrid ? gridColor : "transparent", borderDash: [4, 4], drawBorder: false },
            border: { display: false },
            min: minV,
            max: maxV,
            grace: 0,
          },
        };
    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio: dpr,
      resizeDelay: 0,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: showLegend,
          position: "top",
          labels: {
            color: axisColor,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: "line",
            padding: 10,
            font: { size: 10, weight: "600" },
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: tooltipBg,
          titleColor: tooltipText,
          bodyColor: tooltipText,
          borderColor: tooltipBorder,
          borderWidth: 1,
          displayColors: false,
          padding: 10,
          callbacks: {
            title: (items) => {
              const idx = items?.[0]?.dataIndex;
              if (kind === "barChart") return String(labels?.[idx] || `Row ${Number(idx) + 1}`);
              const ts = axisTimeline?.[idx];
              return formatTooltipTime(ts);
            },
            label: (ctx) => {
              const name = String(ctx?.dataset?.label || "Value");
              return `${name} ${formatNum(ctx?.parsed?.y) || "--"}`;
            },
          },
        },
        viziHoverGuide: {
          color: isDark ? "rgba(148,163,184,0.42)" : "rgba(51,65,85,0.28)",
          lineWidth: 1,
        },
      },
      scales: baseScales,
      elements: {
        line: { borderJoinStyle: "round", capBezierPoints: true },
        point: {
          radius: basePointRadius,
          hoverRadius: !showPoints || dense ? 0 : 5,
          hitRadius: !showPoints || dense ? 0 : 8,
          pointStyle: "circle",
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.95)",
          backgroundColor: accentLine,
        },
      },
    };
    const lineOptions = {
      ...commonOptions,
      elements: {
        ...commonOptions.elements,
        line: { ...commonOptions.elements.line, tension: effectiveTension, borderWidth: lineWidth },
      },
    };
    const areaOptions = {
      ...commonOptions,
      elements: {
        ...commonOptions.elements,
        line: { ...commonOptions.elements.line, tension: effectiveTension, borderWidth: lineWidth },
      },
    };
    const barCount = Math.max(1, labels.length || 0);
    const pxPerBar = Math.max(1, chartW / barCount);
    const dynamicMaxBarThickness = Math.max(2, Math.min(24, Math.floor(pxPerBar * 0.72)));
    const dynamicBarRadius = Math.max(0, Math.min(6, Math.floor(dynamicMaxBarThickness / 2)));
    const barOptions = {
      ...commonOptions,
      elements: {
        ...commonOptions.elements,
        bar: {
          borderRadius: dynamicBarRadius,
          borderSkipped: false,
          barPercentage: 0.7,
          categoryPercentage: 0.74,
          maxBarThickness: dynamicMaxBarThickness,
        },
      },
    };
    const lineLikeData = useMultiLine
      ? {
          labels,
          datasets: lineSeriesMultiRaw.map((series) => {
            const byTs = new Map(series.points.map((p) => [Number(p.t), Number(p.v)]));
            return {
              label: series.label,
              data: axisTimeline.map((ts) => (byTs.has(Number(ts)) ? byTs.get(Number(ts)) : null)),
              borderColor: series.color,
              backgroundColor: series.color,
              borderWidth: lineWidth,
              fill: false,
              spanGaps: true,
              tension: effectiveTension,
              stepped: isStepLine,
              cubicInterpolationMode: isStepLine ? undefined : "monotone",
              pointRadius: (ctx) => {
                const idx = Number(ctx?.dataIndex);
                if (!Number.isFinite(idx)) return basePointRadius;
                if (!markSpots) return basePointRadius;
                const set = multiMarkIndexes.get(series.label);
                return set?.has(idx) ? Math.max(basePointRadius, markerSize) : basePointRadius;
              },
              pointBackgroundColor: (ctx) => {
                const idx = Number(ctx?.dataIndex);
                if (!Number.isFinite(idx) || !markSpots) return series.color;
                const set = multiMarkIndexes.get(series.label);
                return set?.has(idx) ? markColor : series.color;
              },
            };
          }),
        }
      : {
          labels,
          datasets: [
            {
              label: cardTitle || "Trend",
              data: points.map((p) => p.v),
              borderColor: accentLine,
              backgroundColor:
                kind === "areaChart"
                  ? (ctx) => {
                      const chart = ctx?.chart;
                      const area = chart?.chartArea;
                      if (!chart || !area) return accentFillTop;
                      const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                      g.addColorStop(0, accentFillTop);
                      g.addColorStop(1, accentFillBottom);
                      return g;
                    }
                  : accentLine,
              borderWidth: lineWidth,
              fill: kind === "areaChart",
              tension: effectiveTension,
              stepped: isStepLine,
              cubicInterpolationMode: isStepLine ? undefined : "monotone",
              pointRadius: (ctx) => {
                const idx = Number(ctx?.dataIndex);
                if (!Number.isFinite(idx) || !markSpots) return basePointRadius;
                return singleMarkIndexes.has(idx) ? Math.max(basePointRadius, markerSize) : basePointRadius;
              },
              pointBackgroundColor: (ctx) => {
                const idx = Number(ctx?.dataIndex);
                if (!Number.isFinite(idx) || !markSpots) return accentLine;
                return singleMarkIndexes.has(idx) ? markColor : accentLine;
              },
            },
          ],
        };
    const barData = {
      labels,
      datasets: [
        {
          label: cardTitle || "Trend",
          data: points.map((p) => p.v),
          backgroundColor: barFill,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    };
    // Keep charts rendered inside their widget foreignObject to avoid
    // coordinate drift between SVG and detached HTML overlay layers.
    const usesHtmlChartLayer = false;
    if (usesHtmlChartLayer) {
      const scaleVal = Number(overlay?.scale) || 1;
      const worldChartX = Number(overlay?.tx || 0) + scaleVal * chartX;
      const worldChartY = Number(overlay?.ty || 0) + scaleVal * chartTop;
      const viewportW = Math.max(1, Number(size?.w || 0) - rulerSize);
      const viewportH = Math.max(1, Number(size?.h || 0) - rulerSize);
      const vbWidth = Math.max(1, Number(vbW) || 1);
      const vbHeight = Math.max(1, Number(vbH) || 1);
      const svgToCssScale = Math.min(viewportW / vbWidth, viewportH / vbHeight);
      const svgOffsetX = (viewportW - vbWidth * svgToCssScale) / 2;
      const svgOffsetY = (viewportH - vbHeight * svgToCssScale) / 2;
      const svgX = worldChartX * z + panX;
      const svgY = worldChartY * z + panY;
      htmlChartLayers.push({
        id: `${overlay.id}-${kind}`,
        kind,
        chartKey,
        x: svgX * svgToCssScale + svgOffsetX,
        y: svgY * svgToCssScale + svgOffsetY,
        w: Math.max(1, chartW * scaleVal * z * svgToCssScale),
        h: Math.max(1, chartH * scaleVal * z * svgToCssScale),
        lineLikeData,
        lineOptions: kind === "areaChart" ? areaOptions : lineOptions,
        barData,
        barOptions,
      });
    }
    return (
      <g>
        <rect x={x + 1} y={y + 1} width={w - 2} height={headH} rx={10} fill="var(--bg-elev)" />
        <text x={x + pad} y={y + headH - 7} fill={subdued} fontSize={titleSize} fontFamily="system-ui" fontWeight={700}>
          {cardTitle}
        </text>
        {!dense && !(kind === "lineChart" || kind === "areaChart" || kind === "barChart") ? (
          <text
            x={x + pad + Math.min(230, Math.max(120, cardTitle.length * 6 + 26))}
            y={y + headH - 7}
            fill={textColor}
            fontSize={10}
            fontFamily="system-ui"
            fontWeight={600}
          >
            {`Updated ${lastUpdateLabel}`}
          </text>
        ) : null}
        {!dense && kind !== "barChart" ? (() => {
          const chipGap = 4;
          const chipH = Math.max(18, Math.min(24, headH - 8));
          const chipY = Math.max(y + 2, Math.min(y + (headH - chipH) / 2, y + headH - chipH - 2));
          const chipWByLabel = (label) => Math.max(24, 10 + String(label || "").length * 5.5);
          const zoomChipOptions = [
            { key: "zoom-out", label: "-", onClick: () => applyWindowZoom(2) },
            { key: "zoom-in", label: "+", onClick: () => applyWindowZoom(0.5) },
            { key: "zoom-reset", label: "Reset", onClick: () => resetZoomWindow() },
          ];
          const zoomChipWidths = zoomChipOptions.map((opt) => chipWByLabel(opt.label));
          const zoomW = zoomChipWidths.reduce((a, b) => a + b, 0) + chipGap * Math.max(0, zoomChipOptions.length - 1);
          const zoomStartX = Math.max(x + pad, x + w - pad - zoomW);
          const desiredDateW = isDateRangeWidget ? Math.max(180, Math.min(280, Math.round(w * 0.44))) : 0;
          const maxDateW = Math.max(0, zoomStartX - (x + pad) - chipGap);
          const dateControlsW = Math.min(desiredDateW, maxDateW);
          const showDateControls = isDateRangeWidget && dateControlsW >= 120;
          const centeredDateX = x + Math.round((w - dateControlsW) / 2);
          const dateMaxX = zoomStartX - chipGap - dateControlsW;
          const dateStartX = Math.max(x + pad, Math.min(centeredDateX, dateMaxX));
          let cursorX = zoomStartX;
          return (
            <g data-widget-control="true">
              {showDateControls ? (
                <>
                  <foreignObject x={dateStartX} y={chipY} width={dateControlsW} height={chipH}>
                    <div
                      xmlns="http://www.w3.org/1999/xhtml"
                      data-widget-control="true"
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 4,
                        pointerEvents: "auto",
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <input
                        data-widget-control="true"
                        type="date"
                        value={rangeFromInput}
                        onChange={(e) => applyRangeFromTo(e.target.value, rangeToInput)}
                        title="From"
                        style={{
                          width: "100%",
                          height: "100%",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--bg-elev)",
                          color: "var(--text)",
                          fontSize: 9,
                          padding: "0 4px",
                          boxSizing: "border-box",
                        }}
                      />
                      <input
                        data-widget-control="true"
                        type="date"
                        value={rangeToInput}
                        onChange={(e) => applyRangeFromTo(rangeFromInput, e.target.value)}
                        title="To"
                        style={{
                          width: "100%",
                          height: "100%",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "var(--bg-elev)",
                          color: "var(--text)",
                          fontSize: 9,
                          padding: "0 4px",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  </foreignObject>
                </>
              ) : null}
              {zoomChipOptions.map((opt, i) => {
                const cw = zoomChipWidths[i];
                const cx = cursorX;
                cursorX += cw + chipGap;
                return (
                  <g
                    key={`${overlay.id}-${opt.key}`}
                    data-widget-control="true"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      opt.onClick();
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={cx}
                      y={chipY}
                      width={cw}
                      height={chipH}
                      rx={6}
                      fill="var(--bg-elev)"
                      stroke="var(--border)"
                    />
                    <text
                      x={cx + cw / 2}
                      y={chipY + chipH / 2 + 2.8}
                      textAnchor="middle"
                      fill={axisColor}
                      fontSize={9}
                      fontFamily="system-ui"
                      fontWeight={700}
                      pointerEvents="none"
                    >
                      {opt.label}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })() : null}
        <rect x={chartX} y={chartTop} width={chartW} height={chartH} rx={8} fill={chartPanelFill} stroke={isDark ? "#1e293b" : "#dbe3ef"} />
        {!usesHtmlChartLayer ? (
          <foreignObject x={chartX} y={chartTop} width={chartW} height={chartH}>
            <div xmlns="http://www.w3.org/1999/xhtml" style={{ width: "100%", height: "100%", pointerEvents: "none" }}>
              {kind === "barChart" ? (
                <Bar key={chartKey} data={barData} options={barOptions} />
              ) : (
                <Line key={chartKey} data={lineLikeData} options={kind === "areaChart" ? areaOptions : lineOptions} plugins={[hoverGuidePlugin]} />
              )}
            </div>
          </foreignObject>
        ) : null}
        {!dense ? (
          <>
            <text
              x={kind === "barChart" ? x + w - pad : x + w / 2}
              y={y + h - 6}
              fill={axisColor}
              fontSize={10}
              fontFamily="system-ui"
              fontWeight={600}
              textAnchor={kind === "barChart" ? "end" : "middle"}
            >
              {kind === "barChart"
                ? (barBinding?.mode === "tags"
                    ? `Tags ${samplesCount} bars`
                    : `Dataset ${samplesCount} rows`)
                : `${activeDurationLabel} ${rangeStartLabel} - ${rangeEndLabel}`}
            </text>
          </>
        ) : null}
        {points.length === 0 ? (
          <text x={x + w / 2} y={y + h / 2 + 4} fill={textColor} fontSize={dense ? 9 : 11} fontFamily="system-ui" fontWeight={600} textAnchor="middle">
            {kind === "barChart" && !barBinding ? "Configure dataset or tags source" : "Waiting for data"}
          </text>
        ) : null}
      </g>
    );
  };

  const getGroupRouteStateForTagPath = (rawTagPath) => {
    const tagPath = String(rawTagPath || "").replace(/\r?\n/g, "").trim();
    if (!tagPath) return { routeId: "", state: "" };
    const cacheKey = tagPath.toLowerCase();
    if (liveGroupRouteStateByPathRef.current.has(cacheKey)) {
      const cached = liveGroupRouteStateByPathRef.current.get(cacheKey) || {};
      return {
        routeId: String(cached?.routeId || ""),
        state: String(cached?.state || ""),
      };
    }

    const candidates = [tagPath];
    const parts = tagPath.split(".").map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      candidates.push(parts.slice(i).join("."));
    }
    candidates.push(`Default.${tagPath}`);

    const directRouteId = getLiveMemberValueForTagPath(tagPath, LIVE_ROUTE_ID_MEMBER_ALIASES);
    const directState = getLiveMemberValueForTagPath(tagPath, LIVE_STATE_MEMBER_ALIASES);

    const findBySuffixes = (suffixes) => {
      for (const groupKey of candidates) {
        const prefixes = [`${String(groupKey).toLowerCase()}.`, `${String(groupKey).toLowerCase()}/`];
        for (const prefix of prefixes) {
          for (const suffix of suffixes) {
            const v = readLiveValue(`${prefix}${suffix}`);
            if (v != null && v !== "") return String(v);
          }
        }
      }
      return "";
    };

    return {
      routeId:
        String(directRouteId ?? "") ||
        findBySuffixes(["routeid", "routenumber", "routeno", "route"]),
      state:
        String(directState ?? "") ||
        findBySuffixes(["state", "stcode", "status", "stat", "hmi_state", "hmistate"]),
    };
  };

  const knownOverlayTagPaths = useMemo(() => {
    const out = new Set();
    (Array.isArray(opcTags) ? opcTags : []).forEach((tag) => {
      const topic = String(tag?.topic || "").trim();
      const group = String(tag?.groupName || "").trim();
      if (!group) return;
      const full = topic ? `${topic}.${group}` : group;
      if (full) out.add(full.toLowerCase());
      out.add(group.toLowerCase());
    });
    return out;
  }, [opcTags]);

  const hasKnownOverlayTagPath = (rawPath) => {
    const path = String(rawPath || "").trim().toLowerCase();
    if (!path) return false;
    if (!knownOverlayTagPaths.size) return true;
    if (knownOverlayTagPaths.has(path)) return true;
    for (const known of knownOverlayTagPaths) {
      if (known === path || known.endsWith(`.${path}`) || path.endsWith(`.${known}`)) return true;
    }
    return false;
  };

  const parseLiveBool = (value) => {
    if (typeof value === "boolean") return value;
    if (Number.isFinite(Number(value))) return Number(value) !== 0;
    const text = String(value || "").trim().toLowerCase();
    if (!text) return null;
    if (["true", "on", "yes", "manual", "hand"].includes(text)) return true;
    if (["false", "off", "no", "auto"].includes(text)) return false;
    return null;
  };

  const getLiveValueForExactOrSuffixKey = (rawKey) => {
    const key = String(rawKey || "").replace(/\r?\n/g, "").trim();
    if (!key) return null;
    const ignitionExact = readIgnitionTagValueForPath(key);
    if (ignitionExact != null) return ignitionExact;
    const exact = readLiveValue(key);
    if (exact != null) return exact;
    const lowerKey = key.toLowerCase();
    const ignitionLowerExact = readIgnitionTagValueForPath(lowerKey);
    if (ignitionLowerExact != null) return ignitionLowerExact;
    const lowerExact = readLiveValue(lowerKey);
    if (lowerExact != null) return lowerExact;
    const dotSuffix = `.${lowerKey}`;
    const slashSuffix = `/${lowerKey}`;
    for (const mapKey of liveLookupKeyList) {
      const mapValue = readLiveValue(mapKey);
      const k = String(mapKey || "").trim().toLowerCase();
      if (!k) continue;
      if (mapValue == null) continue;
      if (k === lowerKey || k.endsWith(dotSuffix) || k.endsWith(slashSuffix)) return mapValue;
    }
    return null;
  };

  const buildOverlayMemberCandidates = (overlay, aliases = []) => {
    const tagPath = String(overlay?.tagPath || "").trim();
    if (!tagPath || !Array.isArray(aliases) || aliases.length === 0) return [];
    const parts = tagPath.split(".").map((x) => String(x || "").trim()).filter(Boolean);
    const parentSet = new Set();
    const parents = [];
    const pushParent = (rawValue) => {
      const value = String(rawValue || "").trim();
      if (!value) return;
      const lower = value.toLowerCase();
      if (parentSet.has(lower)) return;
      parentSet.add(lower);
      parents.push(value);
    };
    if (parts.length > 0) pushParent(parts.join("."));
    if (parts.length > 1) pushParent(parts.slice(1).join("."));
    if (parts.length > 1) pushParent(parts.slice(0, -1).join("."));
    if (parts.length > 2) pushParent(parts.slice(1, -1).join("."));
    const seen = new Set();
    const out = [];
    for (const parent of parents) {
      for (const alias of aliases) {
        const base = String(parent || "").trim();
        const member = String(alias || "").trim();
        if (!base || !member) continue;
        const dotPath = `${base}.${member}`;
        const slashPath = `${base}/${member}`;
        const dotKey = dotPath.toLowerCase();
        const slashKey = slashPath.toLowerCase();
        if (!seen.has(dotKey)) {
          seen.add(dotKey);
          out.push(dotPath);
        }
        if (!seen.has(slashKey)) {
          seen.add(slashKey);
          out.push(slashPath);
        }
      }
    }
    return out;
  };

  const getOverlayModeState = (overlay) => {
    if (!renderLiveVisuals || overlay?.widget) return "";
    const modeStatusCandidates = buildOverlayMemberCandidates(overlay, LIVE_MODE_STATUS_MEMBER_ALIASES);
    const manualCandidates = buildOverlayMemberCandidates(overlay, LIVE_MANUAL_MODE_MEMBER_ALIASES);
    const autoCandidates = buildOverlayMemberCandidates(overlay, LIVE_AUTO_MODE_MEMBER_ALIASES);
    const maintenanceCandidates = buildOverlayMemberCandidates(
      overlay,
      LIVE_MAINTENANCE_MODE_MEMBER_ALIASES
    );
    const manualValue = parseLiveBool(
      manualCandidates
        .map((key) => getLiveValueForExactOrSuffixKey(key))
        .find((v) => v != null && String(v) !== "")
    );
    const autoValue = parseLiveBool(
      autoCandidates
        .map((key) => getLiveValueForExactOrSuffixKey(key))
        .find((v) => v != null && String(v) !== "")
    );
    const maintenanceValue = parseLiveBool(
      maintenanceCandidates
        .map((key) => getLiveValueForExactOrSuffixKey(key))
        .find((v) => v != null && String(v) !== "")
    );
    const parsedModeFromStatus = (() => {
      const raw = modeStatusCandidates
        .map((key) => getLiveValueForExactOrSuffixKey(key))
        .find((v) => v != null && String(v) !== "");
      if (raw == null || raw === "") return "";
      const text = String(raw || "").trim();
      const lower = text.toLowerCase();
      if (lower.includes("manual") || lower.includes("hand")) return "manual";
      if (lower.includes("auto")) return "auto";
      if (lower.includes("maint")) return "maintenance";
      const num = Number(text);
      if (Number.isFinite(num)) {
        if (num === 3) return "manual";
        const mask = Math.trunc(num);
        if ((mask & 8) === 8) return "maintenance";
        if ((mask & 4) === 4) return "manual";
        if ((mask & 2) === 2) return "auto";
      }
      return "";
    })();
    if (maintenanceValue === true) return "maintenance";
    if (manualValue === true) return "manual";
    if (autoValue === true) return "auto";
    if (parsedModeFromStatus) return parsedModeFromStatus;
    return "";
  };
  const applyBinVisualStateToSvg = (innerSvg, options = {}) => {
    const source = String(innerSvg || "");
    if (!source.trim()) return source;
    const ratio = Math.max(0, Math.min(1, Number(options?.ratio) || 0));
    const showFillLock = options?.showFillLock === true;
    const showDischargeLock = options?.showDischargeLock === true;
    const hasBarGraph = /id=["']BarGraph["']/i.test(source);
    const hasLockGroup =
      /id=["']Lock_Filling["']/i.test(source) ||
      /id=["']Lock_Discharge["']/i.test(source) ||
      /id=["']LockFill["']/i.test(source) ||
      /id=["']LockDischarge["']/i.test(source);
    if (!hasBarGraph && !hasLockGroup) return source;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`,
        "image/svg+xml"
      );
      if (doc.querySelector("parsererror")) return source;
      const bar = doc.getElementById("BarGraph");
      if (bar) {
        const rawY = Number(bar.getAttribute("y"));
        const rawHeight = Number(bar.getAttribute("height"));
        if (Number.isFinite(rawY) && Number.isFinite(rawHeight) && rawHeight > 0) {
          const nextHeight = rawHeight * ratio;
          bar.setAttribute("height", String(nextHeight));
          bar.setAttribute("y", String(rawY));
        }
      }
      const setGroupVisible = (ids, visible) => {
        (Array.isArray(ids) ? ids : []).forEach((id) => {
          const node = doc.getElementById(String(id || ""));
          if (!node) return;
          if (visible) {
            node.removeAttribute("display");
            node.removeAttribute("visibility");
          } else {
            node.setAttribute("display", "none");
            node.setAttribute("visibility", "hidden");
          }
        });
      };
      setGroupVisible(BIN_LOCK_FILL_GROUP_IDS, showFillLock);
      setGroupVisible(BIN_LOCK_DISCHARGE_GROUP_IDS, showDischargeLock);
      const serializer = new XMLSerializer();
      const root = doc.documentElement;
      return Array.from(root.childNodes)
        .map((node) => serializer.serializeToString(node))
        .join("");
    } catch {
      return source;
    }
  };

  const parseDiverterStateValue = (raw) => {
    if (raw == null || raw === "") return "";
    const text = String(raw || "").trim();
    if (!text) return "";
    const lower = text.toLowerCase();
    if (lower.includes("fault")) return "";
    if (lower.includes("no position")) return "";
    if (lower.includes("moving straight")) return "straight";
    if (lower.includes("moving divert")) return "divert";
    if (lower.includes("straight")) return "straight";
    if (lower.includes("divert")) return "divert";
    const num = Number(text);
    if (!Number.isFinite(num)) return "";
    if (num === 1 || num === 8) return "straight";
    if (num === 2 || num === 16) return "divert";
    return "";
  };

  const getOverlayDiverterState = (overlay) => {
    if (overlay?.widget) return "";
    const directIgnitionState = parseDiverterStateValue(
      readIgnitionMemberValueForPath(overlay?.tagPath, LIVE_STATE_MEMBER_ALIASES)
    );
    if (directIgnitionState) return directIgnitionState;
    const bindingPath = getOverlayFillBindingTagPath(overlay);
    if (bindingPath && bindingPath.toLowerCase() !== String(overlay?.tagPath || "").trim().toLowerCase()) {
      const bindingIgnitionState = parseDiverterStateValue(
        readIgnitionMemberValueForPath(bindingPath, LIVE_STATE_MEMBER_ALIASES)
      );
      if (bindingIgnitionState) return bindingIgnitionState;
    }
    const directLiveState = parseDiverterStateValue(
      getLiveMemberValueForTagPath(overlay?.tagPath, LIVE_STATE_MEMBER_ALIASES)
    );
    if (directLiveState) return directLiveState;
    const directTagState = parseDiverterStateValue(readIgnitionTagValueForPath(overlay?.tagPath));
    if (directTagState) return directTagState;
    const boundState = parseDiverterStateValue(readOverlayFillBindingValue(overlay));
    if (boundState) return boundState;
    const groupState = parseDiverterStateValue(
      getGroupRouteStateForTagPath(overlay?.tagPath)?.state
    );
    if (groupState) return groupState;
    const stateCandidates = buildOverlayMemberCandidates(overlay, LIVE_STATE_MEMBER_ALIASES);
    const raw = stateCandidates
      .map((key) => getLiveValueForExactOrSuffixKey(key))
      .find((v) => v != null && String(v) !== "");
    return parseDiverterStateValue(raw);
  };

  const getEffectiveDiverterState = (overlay) => {
    return (
      parseDiverterStateValue(getOverlayDiverterState(overlay)) ||
      parseDiverterStateValue(overlay?.diverterMode) ||
      ""
    );
  };

  const getDiverterBranchAtLocalPoint = (localX, localY, bb) => {
    const bx = Number(bb?.x) || 0;
    const by = Number(bb?.y) || 0;
    const bw = Math.max(0.0001, Number(bb?.width) || 1);
    const bh = Math.max(0.0001, Number(bb?.height) || 1);
    const nx = (Number(localX) - bx) / bw;
    const ny = (Number(localY) - by) / bh;

    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return "";
    if (nx < -0.25 || nx > 1.25 || ny < -0.25 || ny > 1.25) return "";

    // Shared inlet and junction area.
    if (nx <= 0.46 && ny <= 0.44) return "entry";
    if (nx <= 0.62 && ny >= 0.08 && ny <= 0.54) return "entry";

    // Straight outlet occupies the upper-right run.
    if (nx >= 0.48 && ny >= -0.04 && ny <= 0.38) return "straight";

    // Divert outlet occupies the lower-right diagonal outlet area.
    if (nx >= 0.18 && ny >= 0.30) return "divert";

    return "";
  };

  const getDiverterBranchAtWorldPointByConnector = (overlay, pt, bb, threshold = 24) => {
    if (!overlay || !pt || !bb) return "";
    const sx = overlayScaleX(overlay);
    const sy = overlayScaleY(overlay);
    const bx = Number(bb?.x) || 0;
    const by = Number(bb?.y) || 0;
    const bw = Math.max(0.0001, Number(bb?.width) || 1);
    const bh = Math.max(0.0001, Number(bb?.height) || 1);
    const tx = Number(overlay?.tx || 0);
    const ty = Number(overlay?.ty || 0);
    const px = Number(pt?.x || 0);
    const py = Number(pt?.y || 0);
    const connectors = [
      { branch: "entry", x: tx + sx * (bx + bw * 0.12), y: ty + sy * (by + bh * 0.25) },
      { branch: "straight", x: tx + sx * (bx + bw * 0.92), y: ty + sy * (by + bh * 0.18) },
      { branch: "divert", x: tx + sx * (bx + bw * 0.82), y: ty + sy * (by + bh * 0.78) },
    ];
    let best = "";
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of connectors) {
      const d = Math.hypot(px - c.x, py - c.y);
      if (d < bestDist) {
        bestDist = d;
        best = c.branch;
      }
    }
    return bestDist <= threshold ? best : "";
  };

  const isDiverterEntryPoint = (overlay, pt, bb) => {
    if (!overlay || !pt || !bb) return false;
    const sx = overlayScaleX(overlay);
    const sy = overlayScaleY(overlay);
    const bx = Number(bb?.x) || 0;
    const by = Number(bb?.y) || 0;
    const bw = Math.max(0.0001, Number(bb?.width) || 1);
    const bh = Math.max(0.0001, Number(bb?.height) || 1);
    const localX = (Number(pt.x) - Number(overlay?.tx || 0)) / Math.max(0.0001, sx);
    const localY = (Number(pt.y) - Number(overlay?.ty || 0)) / Math.max(0.0001, sy);
    const nx = (localX - bx) / bw;
    const ny = (localY - by) / bh;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
    if (nx <= 0.32 && ny >= -0.28 && ny <= 0.72) return true;
    const mirroredKey = String(overlay?.sourceKey || overlay?.name || "").toLowerCase();
    if (mirroredKey.includes("mirrored") && nx >= 0.68 && ny >= -0.28 && ny <= 0.72) return true;
    return false;
  };

  const getDiverterOutputBranchAtWorldPoint = (overlay, pt, bb, threshold = 40) => {
    if (!overlay || !pt || !bb) return "";
    const sx = overlayScaleX(overlay);
    const sy = overlayScaleY(overlay);
    const bx = Number(bb?.x) || 0;
    const by = Number(bb?.y) || 0;
    const bw = Math.max(0.0001, Number(bb?.width) || 1);
    const bh = Math.max(0.0001, Number(bb?.height) || 1);
    const tx = Number(overlay?.tx || 0);
    const ty = Number(overlay?.ty || 0);
    const px = Number(pt?.x || 0);
    const py = Number(pt?.y || 0);
    const outputs = [
      { branch: "straight", x: tx + sx * (bx + bw * 0.92), y: ty + sy * (by + bh * 0.18) },
      { branch: "divert", x: tx + sx * (bx + bw * 0.82), y: ty + sy * (by + bh * 0.78) },
    ];
    let best = "";
    let bestDist = Number.POSITIVE_INFINITY;
    for (const c of outputs) {
      const d = Math.hypot(px - c.x, py - c.y);
      if (d < bestDist) {
        bestDist = d;
        best = c.branch;
      }
    }
    return bestDist <= threshold ? best : "";
  };

  const userColor = (value) => {
    const raw = String(value || "");
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
      hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    return `hsl(${hue} 75% 45%)`;
  };

  const collabCursors = useMemo(() => {
    if (!Array.isArray(collaboratorCursors)) return [];
    return collaboratorCursors
      .map((entry) => {
        const x = Number(entry?.x);
        const y = Number(entry?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const username = String(entry?.username || "User").trim() || "User";
        const userId = String(entry?.user_id || username);
        return { userId, username, x, y, color: userColor(userId) };
      })
      .filter(Boolean);
  }, [collaboratorCursors]);

  useEffect(() => {
    const targets = new Map();
    collabCursors.forEach((cursor) => {
      targets.set(String(cursor.userId || ""), cursor);
    });
    collabCursorTargetsRef.current = targets;

    setSmoothedCollabCursors((prev) => {
      const byId = new Map((Array.isArray(prev) ? prev : []).map((c) => [String(c?.userId || ""), c]));
      return collabCursors.map((target) => {
        const existing = byId.get(String(target.userId || ""));
        if (!existing) return { ...target };
        return { ...target, x: Number(existing.x), y: Number(existing.y) };
      });
    });
  }, [collabCursors]);

  useEffect(() => {
    const step = (ts) => {
      const lastTs = Number(collabCursorLastTsRef.current || ts);
      const dt = Math.max(1, Math.min(48, ts - lastTs));
      collabCursorLastTsRef.current = ts;
      const alpha = 1 - Math.pow(0.001, dt / 120);
      let needsNext = false;

      setSmoothedCollabCursors((prev) => {
        if (!Array.isArray(prev) || !prev.length) return [];
        const targets = collabCursorTargetsRef.current || new Map();
        const next = [];

        for (const cur of prev) {
          const id = String(cur?.userId || "");
          const target = targets.get(id);
          if (!target) continue;
          const curX = Number(cur?.x) || 0;
          const curY = Number(cur?.y) || 0;
          const tx = Number(target?.x) || 0;
          const ty = Number(target?.y) || 0;
          const nx = curX + (tx - curX) * alpha;
          const ny = curY + (ty - curY) * alpha;
          const snap = Math.abs(tx - nx) + Math.abs(ty - ny) < 0.08;
          if (!snap) needsNext = true;
          next.push({ ...target, x: snap ? tx : nx, y: snap ? ty : ny });
        }

        return next;
      });

      if (needsNext) {
        collabCursorRafRef.current = window.requestAnimationFrame(step);
      } else {
        collabCursorRafRef.current = 0;
      }
    };

    if (!collabCursorRafRef.current && collabCursors.length) {
      collabCursorLastTsRef.current = 0;
      collabCursorRafRef.current = window.requestAnimationFrame(step);
    }

    return () => {
      if (collabCursorRafRef.current) {
        window.cancelAnimationFrame(collabCursorRafRef.current);
        collabCursorRafRef.current = 0;
      }
    };
  }, [collabCursors]);
  const hiddenBubbleSet = useMemo(
    () => new Set(Array.isArray(hiddenTagBubbleIds) ? hiddenTagBubbleIds : []),
    [hiddenTagBubbleIds]
  );
  const extractDraggedTrendTag = (dataTransfer) => {
    if (!dataTransfer) return "";
    const custom = String(dataTransfer.getData("application/x-vizi-trend-tag") || "").trim();
    if (custom) return custom;
    const text = String(dataTransfer.getData("text/plain") || "").trim();
    if (text.toLowerCase().startsWith("vizi-trend-tag:")) {
      return text.slice("vizi-trend-tag:".length).trim();
    }
    return "";
  };

  const lastTagColorRef = useRef(new Map());
  useEffect(() => {
    if (liveCanvasEnabled) return;
    lastTagColorRef.current = new Map();
  }, [liveCanvasEnabled]);

  const overrideSvgColors = (inner, color) => {
    if (!inner || !color) return inner;
    const fillRe = /fill\s*=\s*["'][^"']*["']/gi;
    const strokeRe = /stroke\s*=\s*["'][^"']*["']/gi;
    const styleRe = /style\s*=\s*["']([^"']*)["']/gi;
    let out = inner.replace(fillRe, "").replace(strokeRe, "");
    out = out.replace(styleRe, (match, styleBody) => {
      let next = styleBody
        .replace(/fill\s*:\s*[^;]+;?/gi, "")
        .replace(/stroke\s*:\s*[^;]+;?/gi, "")
        .trim();
      if (!next) return "";
      return `style="${next}"`;
    });
    return out;
  };

  const overrideSvgStrokeOnly = (inner) => {
    if (!inner) return inner;
    const strokeRe = /stroke\s*=\s*["'][^"']*["']/gi;
    const styleRe = /style\s*=\s*["']([^"']*)["']/gi;
    let out = inner.replace(strokeRe, "");
    out = out.replace(styleRe, (match, styleBody) => {
      let next = styleBody.replace(/stroke\s*:\s*[^;]+;?/gi, "").trim();
      if (!next) return "";
      return `style="${next}"`;
    });
    return out;
  };

  const applyOverlayPaintOverrides = (inner, { fillColor = "", strokeColor = "", strokeWidth } = {}) => {
    if (!inner) return inner;
    const nextFill = String(fillColor || "").trim();
    const nextStroke = String(strokeColor || "").trim();
    const nextStrokeWidth =
      Number.isFinite(Number(strokeWidth)) && Number(strokeWidth) >= 0
        ? Number(strokeWidth)
        : null;
    if (!nextFill && !nextStroke && nextStrokeWidth == null) {
      return inner;
    }

    const isProtectedFill = (value) => {
      const v = String(value || "").trim().toLowerCase();
      return !v || v === "none" || v === "transparent";
    };
    const isProtectedStroke = (value) => {
      const v = String(value || "").trim().toLowerCase();
      return !v || v === "none" || v === "transparent";
    };

    let out = String(inner);

    if (nextFill) {
      const isDefaultRecolorFill = (value) => {
        const fill = String(value || "").replace(/\s+/g, "").trim().toLowerCase();
        return fill === "#d7dade" ||
          fill === "rgb(215,218,222)" ||
          fill === "rgba(215,218,222,1)" ||
          fill === "#808080" ||
          fill === "#888" ||
          fill === "gray" ||
          fill === "grey" ||
          fill === "rgb(128,128,128)" ||
          fill === "rgba(128,128,128,1)" ||
          fill === "#cccccc" ||
          fill === "#ccc" ||
          fill === "rgb(204,204,204)" ||
          fill === "rgba(204,204,204,1)";
      };
      const shouldRecolorPrimaryElement = (elementStart) => {
        const fillAttrMatch = String(elementStart || "").match(/\bfill\s*=\s*(["'])([^"']*)\1/i);
        if (isDefaultRecolorFill(fillAttrMatch?.[2])) {
          return true;
        }
        const styleMatch = String(elementStart || "").match(/\bstyle\s*=\s*(["'])([^"']*)\1/i);
        const styleFillMatch = String(styleMatch?.[2] || "").match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i);
        if (isDefaultRecolorFill(styleFillMatch?.[1])) {
          return true;
        }
        const idMatch = String(elementStart || "").match(/\bid\s*=\s*(["'])([^"']+)\1/i);
        const elementId = String(idMatch?.[2] || "").trim().toLowerCase();
        if (!elementId) {
          return false;
        }
        return /^(body|bodyouter|bodyinner|cyclone|shell|housing|vessel|casing|main|machine|rect5|path4|vent|vent_open|vent_closed)$/i.test(elementId);
      };
      out = out.replace(/(<(path|rect|circle|ellipse|polygon|polyline)[^>]*)(\/?>)/gi, (match, start, _tag, end) => {
        if (!shouldRecolorPrimaryElement(start)) {
          return match;
        }
        let next = String(start || "");
        if (/\bfill\s*=/.test(next)) {
          next = next.replace(/\bfill\s*=\s*(["'])([^"']*)\1/gi, (fillMatch, quote, fillValue) => (
            isProtectedFill(fillValue) ? fillMatch : `fill=${quote}${nextFill}${quote}`
          ));
        } else {
          next += ` fill="${nextFill}"`;
        }
        next = next.replace(/style\s*=\s*(["'])([^"']*)\1/gi, (styleMatch, quote, styleBody) => {
          let cleaned = String(styleBody || "").replace(
            /fill\s*:\s*([^;]+)(;?)/gi,
            (fillStyleMatch, fillValue, suffix) => (
              isProtectedFill(fillValue) ? fillStyleMatch : `fill:${nextFill}${suffix || ";"}`
            )
          );
          return `style=${quote}${cleaned}${quote}`;
        });
        return `${next}${end}`;
      });
    }

    if (nextStroke) {
      out = out.replace(/\bstroke\s*=\s*(["'])([^"']*)\1/gi, (match, quote, strokeValue) => (
        isProtectedStroke(strokeValue) ? match : `stroke=${quote}${nextStroke}${quote}`
      ));
    }

    if (nextStrokeWidth != null) {
      out = out.replace(/\bstroke-width\s*=\s*(["'])([^"']*)\1/gi, `stroke-width="${
        nextStrokeWidth
      }"`);
    }

    out = out.replace(/style\s*=\s*(["'])([^"']*)\1/gi, (match, quote, styleBody) => {
      let next = String(styleBody || "");
      if (nextFill) {
        next = next.replace(/fill\s*:\s*([^;]+)(;?)/gi, (fillMatch, fillValue, suffix) => (
          isProtectedFill(fillValue) ? fillMatch : `fill:${nextFill}${suffix || ";"}`
        ));
      }
      if (nextStroke) {
        next = next.replace(/stroke\s*:\s*([^;]+)(;?)/gi, (strokeMatch, strokeValue, suffix) => (
          isProtectedStroke(strokeValue) ? strokeMatch : `stroke:${nextStroke}${suffix || ";"}`
        ));
      }
      if (nextStrokeWidth != null) {
        next = next.replace(/stroke-width\s*:\s*([^;]+)(;?)/gi, `stroke-width:${nextStrokeWidth}$2`);
      }
      return `style=${quote}${next}${quote}`;
    });

    return out;
  };

  const applyOverlayOuterStrokeColor = (inner, color) => {
    if (!inner || !color) return inner;
    const PRIMARY_ELEMENT_ID_RE = /^(body|bodyouter|bodyinner|cyclone|shell|housing|vessel|casing|main|machine)$/i;
    const EXCLUDED_ANCESTOR_ID_RE = /^(insidelines|bargraph|lock_filling|lock_discharge|lockfill|lockdischarge)$/i;
    const SHAPE_SELECTOR = "path,rect,circle,ellipse,polygon,polyline,line";
    const isProtectedStroke = (value) => {
      const v = String(value || "").trim().toLowerCase();
      return (
        !v ||
        v === "none" ||
        v === "transparent" ||
        v === "currentcolor" ||
        v === "inherit" ||
        v.startsWith("url(")
      );
    };
    const isProtectedFill = (value) => {
      const v = String(value || "").trim().toLowerCase();
      return !v || v === "none" || v === "transparent";
    };
    const readStylePaint = (el, name) => {
      const style = String(el?.getAttribute?.("style") || "");
      if (!style) return "";
      const match = style.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, "i"));
      return String(match?.[1] || "").trim();
    };
    const readPaint = (el, name) => {
      const attrValue = String(el?.getAttribute?.(name) || "").trim();
      if (attrValue) return attrValue;
      return readStylePaint(el, name);
    };
    const setPaint = (el, name, value) => {
      if (!el) return;
      el.setAttribute(name, value);
      const style = String(el.getAttribute("style") || "");
      if (!style) return;
      if (new RegExp(`${name}\\s*:`, "i").test(style)) {
        el.setAttribute(
          "style",
          style.replace(new RegExp(`${name}\\s*:\\s*([^;]+)(;?)`, "gi"), `${name}:${value}$2`)
        );
      }
    };
    const hasExcludedAncestor = (el, root) => {
      let node = el?.parentNode || null;
      while (node && node !== root) {
        if (node?.nodeType === 1) {
          const id = String(node.getAttribute?.("id") || "").trim();
          if (id && EXCLUDED_ANCESTOR_ID_RE.test(id)) {
            return true;
          }
        }
        node = node.parentNode || null;
      }
      return false;
    };

    try {
      const wrapped = `<svg xmlns="http://www.w3.org/2000/svg">${String(inner || "")}</svg>`;
      const doc = new DOMParser().parseFromString(wrapped, "image/svg+xml");
      if (doc.querySelector("parsererror")) return inner;
      const root = doc.documentElement;
      if (!root) return inner;
      const shapes = Array.from(root.querySelectorAll(SHAPE_SELECTOR));
      if (!shapes.length) return inner;

      const primaryTargets = shapes.filter((el) => {
        const id = String(el.getAttribute("id") || "").trim();
        return id && PRIMARY_ELEMENT_ID_RE.test(id) && !hasExcludedAncestor(el, root);
      });

      const targetElements = primaryTargets.length
        ? primaryTargets
        : (() => {
            let best = null;
            let bestScore = Number.NEGATIVE_INFINITY;
            shapes.forEach((el, index) => {
              if (hasExcludedAncestor(el, root)) return;
              const id = String(el.getAttribute("id") || "").trim();
              const fillValue = readPaint(el, "fill");
              const strokeValue = readPaint(el, "stroke");
              let score = 0;
              if (id && PRIMARY_ELEMENT_ID_RE.test(id)) score += 1000;
              if (!isProtectedFill(fillValue)) score += 80;
              if (!isProtectedStroke(strokeValue)) score += 60;
              if (index === 0) score += 20;
              if (String(el.tagName || "").toLowerCase() === "rect") score += 10;
              if (score > bestScore) {
                best = el;
                bestScore = score;
              }
            });
            return best ? [best] : [];
          })();

      if (!targetElements.length) return inner;
      targetElements.forEach((el) => setPaint(el, "stroke", color));

      const serializer = new XMLSerializer();
      return Array.from(root.childNodes)
        .map((node) => serializer.serializeToString(node))
        .join("");
    } catch {
      return inner;
    }
  };

  const forceSvgStrokeColor = (inner, color) => {
    if (!inner || !color) return inner;
    const isProtectedStroke = (value) => {
      const v = String(value || "").trim().toLowerCase();
      return (
        !v ||
        v === "none" ||
        v === "transparent" ||
        v === "currentcolor" ||
        v === "inherit" ||
        v.startsWith("url(")
      );
    };
    const strokeAttrRe = /stroke\s*=\s*(["'])([^"']*)\1/gi;
    const styleAttrRe = /style\s*=\s*(["'])([^"']*)\1/gi;

    let out = inner.replace(strokeAttrRe, (match, quote, strokeValue) => {
      if (isProtectedStroke(strokeValue)) return match;
      return `stroke=${quote}${color}${quote}`;
    });

    out = out.replace(styleAttrRe, (match, quote, styleBody) => {
      const next = String(styleBody || "").replace(
        /stroke\s*:\s*([^;]+)(;?)/gi,
        (strokeMatch, strokeValue, suffix) => {
          if (isProtectedStroke(strokeValue)) return strokeMatch;
          return `stroke:${color}${suffix || ";"}`;
        }
      );
      return `style=${quote}${next}${quote}`;
    });
    return out;
  };

  const recolorSvgElementById = (inner, elementId, color) => {
    if (!inner || !elementId || !color) return inner;
    return String(inner).replace(
      new RegExp(`(<[^>]*\\bid\\s*=\\s*["']${String(elementId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*)(/?>)`, "gi"),
      (match, start, end) => {
        let next = String(start || "");
        if (/\bfill\s*=/.test(next)) next = next.replace(/\bfill\s*=\s*(["'])[^"']*\1/gi, `fill="${color}"`);
        else next += ` fill="${color}"`;
        if (/\bstroke\s*=/.test(next)) next = next.replace(/\bstroke\s*=\s*(["'])[^"']*\1/gi, `stroke="${color}"`);
        return `${next}${end}`;
      }
    );
  };

  const recolorSvgElementFillOnlyById = (inner, elementId, color) => {
    if (!inner || !elementId || !color) return inner;
    return String(inner).replace(
      new RegExp(`(<[^>]*\\bid\\s*=\\s*["']${String(elementId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*)(/?>)`, "gi"),
      (match, start, end) => {
        let next = String(start || "");
        if (/\bfill\s*=/.test(next)) next = next.replace(/\bfill\s*=\s*(["'])[^"']*\1/gi, `fill="${color}"`);
        else next += ` fill="${color}"`;
        next = next.replace(/\bstroke\s*=\s*(["'])[^"']*\1/gi, "");
        next = next.replace(/style\s*=\s*(["'])([^"']*)\1/gi, (m, q, body) => {
          let cleaned = String(body || "")
            .replace(/fill\s*:\s*[^;]+;?/gi, "")
            .replace(/stroke\s*:\s*[^;]+;?/gi, "")
            .trim();
          cleaned = cleaned ? `${cleaned};fill:${color}` : `fill:${color}`;
          return `style=${q}${cleaned}${q}`;
        });
        return `${next}${end}`;
      }
    );
  };

  const recolorSvgElementStrokeOnlyById = (inner, elementId, color) => {
    if (!inner || !elementId) return inner;
    const strokeColor = String(color || "none").trim() || "none";
    return String(inner).replace(
      new RegExp(`(<[^>]*\\bid\\s*=\\s*["']${String(elementId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*)(/?>)`, "gi"),
      (match, start, end) => {
        let next = String(start || "");
        if (/\bstroke\s*=/.test(next)) next = next.replace(/\bstroke\s*=\s*(["'])[^"']*\1/gi, `stroke="${strokeColor}"`);
        else next += ` stroke="${strokeColor}"`;
        if (/\bfill\s*=/.test(next)) next = next.replace(/\bfill\s*=\s*(["'])[^"']*\1/gi, `fill="none"`);
        else next += ` fill="none"`;
        next = next.replace(/style\s*=\s*(["'])([^"']*)\1/gi, (m, q, body) => {
          let cleaned = String(body || "")
            .replace(/fill\s*:\s*[^;]+;?/gi, "")
            .replace(/stroke\s*:\s*[^;]+;?/gi, "")
            .trim();
          cleaned = cleaned ? `${cleaned};fill:none;stroke:${strokeColor}` : `fill:none;stroke:${strokeColor}`;
          return `style=${q}${cleaned}${q}`;
        });
        return `${next}${end}`;
      }
    );
  };

  const DIVERTER_POSITION_COLOR = "#22c55e";
  const DIVERTER_NEUTRAL_STROKE = "#2c2f34";
  const DIVERTER_NEUTRAL_FILL = "#ffffff";
  const DIVERTER_ENTRY_ELEMENT_IDS = ["entryPath", "EntryPath", "entry", "Entry"];
  const DIVERTER_STRAIGHT_ELEMENT_IDS = ["straightPath", "StraightPath", "Straight_Path", "Left_Valve", "Straight_Valve"];
  const DIVERTER_DIVERT_ELEMENT_IDS = ["divertPath", "DivertPath", "Divert_Path", "Right_Valve", "Divert_Valve"];

  const getEffectiveOverlayFlowColor = (overlay, overlayEType, entryColor = "") => {
    const incomingEntryColor = normalizeActiveLineColor(entryColor);
    if (isDiverterEType(overlayEType)) {
      return incomingEntryColor;
    }
    return normalizeActiveLineColor(
      getRouteColorForOverlay(overlay) ||
      getTagColor(overlay?.tagPath) ||
      getOverlayBoundActiveFillColor(overlay) ||
      getOverlayDisplayedFlowFillColor(overlay) ||
      getRouteStrokeColorForOverlay(overlay)
    );
  };

  const applyDiverterFlowColorToSvg = (inner, color, modeRaw, outerStrokeColor = "") => {
    if (!inner) return inner;
    try {
      const wrapped = `<svg xmlns="http://www.w3.org/2000/svg">${String(inner || "")}</svg>`;
      const doc = new DOMParser().parseFromString(wrapped, "image/svg+xml");
      if (doc.querySelector("parsererror")) return inner;
      const root = doc.documentElement;
      if (!root) return inner;

      const mode = parseDiverterStateValue(modeRaw);
      const flowColor = normalizeActiveLineColor(color);
      const outlineStrokeColor = String(outerStrokeColor || "").trim() || DIVERTER_NEUTRAL_STROKE;
      const activeBranchIds =
        mode === "divert" ? DIVERTER_DIVERT_ELEMENT_IDS : mode === "straight" ? DIVERTER_STRAIGHT_ELEMENT_IDS : [];

      const getNodesByIds = (ids) =>
        (Array.isArray(ids) ? ids : [])
          .map((id) => doc.getElementById(id))
          .filter(Boolean);
      const paintBranchNode = (node, nextColor = "") => {
        if (!node) return;
        const id = String(node.getAttribute("id") || "");
        const lineLike =
          /valve/i.test(id) ||
          ["line", "polyline"].includes(String(node.tagName || "").toLowerCase());
        if (lineLike) {
          node.setAttribute("fill", "transparent");
          node.setAttribute("stroke", nextColor || DIVERTER_NEUTRAL_STROKE);
          return;
        }
        node.setAttribute("fill", nextColor || DIVERTER_NEUTRAL_FILL);
        node.setAttribute("stroke", "none");
      };
      const setNodesVisible = (ids, visible) => {
        getNodesByIds(ids).forEach((node) => {
          if (visible) {
            node.removeAttribute("display");
            node.removeAttribute("visibility");
          } else {
            node.setAttribute("display", "none");
            node.setAttribute("visibility", "hidden");
          }
        });
      };

      const body = doc.getElementById("body");
      if (body) {
        const gradientId =
          Array.from(root.querySelectorAll("linearGradient[id]"))
            .map((node) => String(node?.getAttribute?.("id") || "").trim())
            .find(Boolean) || "";
        if (gradientId) {
          body.setAttribute("fill", `url(#${gradientId})`);
        }
        body.setAttribute("stroke", outlineStrokeColor);
      }

      [
        ...DIVERTER_ENTRY_ELEMENT_IDS,
        ...DIVERTER_STRAIGHT_ELEMENT_IDS,
        ...DIVERTER_DIVERT_ELEMENT_IDS,
      ].forEach((id) => paintBranchNode(doc.getElementById(id)));

      if (mode === "straight" || mode === "divert") {
        setNodesVisible(DIVERTER_STRAIGHT_ELEMENT_IDS, mode === "straight");
        setNodesVisible(DIVERTER_DIVERT_ELEMENT_IDS, mode === "divert");
      }

      if (flowColor) {
        getNodesByIds(DIVERTER_ENTRY_ELEMENT_IDS).forEach((node) =>
          paintBranchNode(node, flowColor || DIVERTER_POSITION_COLOR)
        );
      }

      if (activeBranchIds.length && flowColor) {
        getNodesByIds(activeBranchIds).forEach((node) =>
          paintBranchNode(node, flowColor || DIVERTER_POSITION_COLOR)
        );
      }

      const serializer = new XMLSerializer();
      return Array.from(root.childNodes)
        .map((node) => serializer.serializeToString(node))
        .join("");
    } catch {
      return inner;
    }
  };

  const renderWidgetOverlayRef = useRef(null);
  renderWidgetOverlayRef.current = renderWidgetOverlay;

  const normalizeActiveLineColor = (value) => {
    return normalizeStickyActiveColor(value);
  };

  const appendSvgClassName = (node, className) => {
    if (!node || !className) return;
    const existing = String(node.getAttribute("class") || "").trim();
    const next = Array.from(new Set(`${existing} ${className}`.trim().split(/\s+/).filter(Boolean))).join(" ");
    if (next) node.setAttribute("class", next);
  };

  const stripSvgStyleProperty = (styleText, propertyName) => {
    const property = String(propertyName || "").trim();
    if (!property) return String(styleText || "").trim();
    return String(styleText || "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part && !part.toLowerCase().startsWith(`${property.toLowerCase()}:`))
      .join("; ");
  };

  const stripSvgStylePaintProperty = (styleText, propertyName) => {
    const property = String(propertyName || "").trim().toLowerCase();
    if (!property) return String(styleText || "").trim();
    return String(styleText || "")
      .split(";")
      .map((part) => part.trim())
      .filter((part) => {
        if (!part) return false;
        const colon = part.indexOf(":");
        if (colon < 0) return true;
        const name = part.slice(0, colon).trim().toLowerCase();
        if (name !== property) return true;
        const value = part.slice(colon + 1).trim().toLowerCase();
        return value === "none" || value === "transparent";
      })
      .join("; ");
  };

  const applyIgnitionStyleClassToSvg = (inner, className) => {
    const classText = String(className || "").trim();
    const source = String(inner || "");
    if (!source || !classText || typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return source;
    try {
      const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${source}</svg>`, "image/svg+xml");
      const root = doc.documentElement;
      if (!root || root.nodeName.toLowerCase() !== "svg") return source;
      appendSvgClassName(root, classText);
      const nodes = root.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line,text,use,g");
      nodes.forEach((node) => {
        const fillAttr = String(node.getAttribute("fill") || "").trim().toLowerCase();
        const styleAttr = String(node.getAttribute("style") || "");
        const hasFillNone = fillAttr === "none" || /(?:^|;)\s*fill\s*:\s*none\s*(?:;|$)/i.test(styleAttr);
        if (hasFillNone) return;
        appendSvgClassName(node, classText);
        if (node.hasAttribute("fill") && fillAttr !== "none" && fillAttr !== "transparent") {
          node.removeAttribute("fill");
        }
        if (styleAttr) {
          const nextStyle = stripSvgStylePaintProperty(styleAttr, "fill");
          if (nextStyle) node.setAttribute("style", nextStyle);
          else node.removeAttribute("style");
        }
      });
      const serializer = new XMLSerializer();
      return Array.from(root.childNodes)
        .map((node) => serializer.serializeToString(node))
        .join("");
    } catch {
      return source;
    }
  };

  const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const setSvgElementVisibleById = (inner, elementId, visible) => {
    if (!inner || !elementId) return inner;
    const re = new RegExp(`(<[^>]*\\bid\\s*=\\s*["']${escapeRegExp(elementId)}["'][^>]*>)`, "gi");
    return String(inner).replace(re, (tag) => {
      let next = String(tag);
      const hasDisplayAttr = /\sdisplay\s*=\s*["'][^"']*["']/i.test(next);
      if (visible) {
        if (hasDisplayAttr) next = next.replace(/\sdisplay\s*=\s*["'][^"']*["']/gi, "");
        if (/style\s*=\s*["'][^"']*["']/i.test(next)) {
          next = next.replace(/style\s*=\s*(["'])([^"']*)\1/gi, (m, q, body) => {
            const cleaned = String(body || "").replace(/display\s*:\s*none\s*;?/gi, "").trim();
            if (!cleaned) return "";
            return `style=${q}${cleaned}${q}`;
          });
        }
        return next;
      }
      if (hasDisplayAttr) {
        return next.replace(/\sdisplay\s*=\s*["'][^"']*["']/gi, ` display="none"`);
      }
      return next.replace(/^<([a-zA-Z0-9:_-]+)/, `<$1 display="none"`);
    });
  };

  const applyDiverterModeToSvg = (inner, modeRaw) => {
    const mode = parseDiverterStateValue(modeRaw);
    let out = String(inner || "");
    if (mode !== "straight" && mode !== "divert") return out;
    DIVERTER_STRAIGHT_ELEMENT_IDS.forEach((id) => {
      out = setSvgElementVisibleById(out, id, mode === "straight");
    });
    DIVERTER_DIVERT_ELEMENT_IDS.forEach((id) => {
      out = setSvgElementVisibleById(out, id, mode === "divert");
    });
    return out;
  };

  const overlayScaleX = (o) => {
    const sx = Number(o?.scaleX);
    if (Number.isFinite(sx) && sx > 0) return sx;
    const s = Number(o?.scale);
    return Number.isFinite(s) && s > 0 ? s : 1;
  };

  const overlayScaleY = (o) => {
    const sy = Number(o?.scaleY);
    if (Number.isFinite(sy) && sy > 0) return sy;
    const s = Number(o?.scale);
    return Number.isFinite(s) && s > 0 ? s : 1;
  };

  const overlayWorldRect = (o, bb) => {
    const sx = overlayScaleX(o);
    const sy = overlayScaleY(o);
    return {
      x: o.tx + sx * bb.x,
      y: o.ty + sy * bb.y,
      w: sx * bb.width,
      h: sy * bb.height,
    };
  };

  // Per-render cache for getDirectEntryActiveColorForDiverter.
  // Each overlay's entry color is computed at most once per render; subsequent calls
  // hit the Map in O(1). _diverterVisiting handles cycle detection for chained diverters.
  const _diverterColorCache = new Map();
  const _diverterVisiting = new Set();

  const getDiverterEntryConnectorWorldPoint = (overlay, bb) => {
    if (!overlay || !bb) return null;
    const sx = overlayScaleX(overlay);
    const sy = overlayScaleY(overlay);
    const bx = Number(bb?.x) || 0;
    const by = Number(bb?.y) || 0;
    const bw = Math.max(0.0001, Number(bb?.width) || 1);
    const bh = Math.max(0.0001, Number(bb?.height) || 1);
    return {
      x: Number(overlay?.tx || 0) + sx * (bx + bw * 0.12),
      y: Number(overlay?.ty || 0) + sy * (by + bh * 0.25),
    };
  };

  const getDirectEntryActiveColorForDiverter = (overlay, options = {}) => {
    const overlayId = String(overlay?.id || "").trim();
    const cacheKey = `${overlayId}::${String(options?.excludeOverlayId || "")}::${
      Array.isArray(options?.excludedOverlayIds)
        ? options.excludedOverlayIds.map((entry) => String(entry || "")).join("|")
        : ""
    }`;
    if (_diverterColorCache.has(cacheKey)) {
      return _diverterColorCache.get(cacheKey);
    }
    if (_diverterVisiting.has(cacheKey)) {
      return "";
    }
    _diverterVisiting.add(cacheKey);
    try {
      if (!overlay || !Array.isArray(shapes) || !shapes.length) {
        _diverterColorCache.set(cacheKey, "");
        return "";
      }
      const bb = overlay?.bbox || overlayLocalBBox?.(overlay.id);
      if (!bb) {
        _diverterColorCache.set(cacheKey, "");
        return "";
      }
      const wr = overlayWorldRect(overlay, bb);
      const threshold = 28;
      const excludedOverlayIds = new Set(
        [
          options?.excludeOverlayId,
          ...(Array.isArray(options?.excludedOverlayIds) ? options.excludedOverlayIds : []),
        ]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      );
      let bestColor = "";
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const s of shapes) {
        if (s?.type !== "polyline" || !Array.isArray(s.points) || s.points.length < 2) continue;
        const endpoints = [s.points[0], s.points[s.points.length - 1]].filter(Boolean);
        for (let idx = 0; idx < endpoints.length; idx += 1) {
          const pt = endpoints[idx];
          const dist = distancePointToRect(pt, wr);
          if (dist > threshold || dist >= bestDistance) continue;
          const sx = overlayScaleX(overlay);
          const sy = overlayScaleY(overlay);
          const localX = (Number(pt?.x) - Number(overlay?.tx || 0)) / Math.max(0.0001, sx);
          const localY = (Number(pt?.y) - Number(overlay?.ty || 0)) / Math.max(0.0001, sy);
          const branch =
            getDiverterBranchAtWorldPointByConnector(overlay, pt, bb, 40) ||
            getDiverterBranchAtLocalPoint(localX, localY, bb);
          if (branch !== "entry" && !isDiverterEntryPoint(overlay, pt, bb)) continue;
          const oppositePt = idx === 0 ? s.points[s.points.length - 1] : s.points[0];
          const upstreamActiveColor = normalizeActiveLineColor(
            oppositePt
              ? getOverlayColorAtPoint(oppositePt, {
                  ...options,
                  excludeOverlayId: overlay?.id,
                }) ||
                  getOverlayColorNearPoint(oppositePt, 42, {
                    ...options,
                    excludeOverlayId: overlay?.id,
                  })
              : ""
          );
          const workerResolvedColor = normalizeActiveLineColor(
            liveResolvedPolylineColorByIdRef.current.get(String(s?.id || "")) || ""
          );
          const c = normalizeActiveLineColor(
            upstreamActiveColor ||
              workerResolvedColor ||
              getTagColor(s?.tagPath) ||
              s?.stroke
          );
          if (!c) continue;
          bestDistance = dist;
          bestColor = c;
        }
      }
      if (!bestColor && liveCanvasEnabled) {
        const workerCachedColor = liveResolvedDiverterEntryColorByIdRef.current.get(overlayId);
        if (workerCachedColor) {
          bestColor = String(workerCachedColor || "");
        }
      }
      if (!bestColor && excludedOverlayIds.size) {
        _diverterColorCache.set(cacheKey, "");
        return "";
      }
      _diverterColorCache.set(cacheKey, bestColor);
      return bestColor;
    } finally {
      _diverterVisiting.delete(cacheKey);
    }
  };

  const OVERLAY_TOUCH_COLOR_THRESHOLD = 8;
  const SPLIT_CARRY_TOUCH_THRESHOLD = 16;

  const getOverlayColorAtPoint = (pt, options = {}) => {
    if (!pt || !svgOverlays?.length) return "";
    const excludedOverlayIds = new Set(
      [
        options?.excludeOverlayId,
        ...(Array.isArray(options?.excludedOverlayIds) ? options.excludedOverlayIds : []),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    for (const o of svgOverlays) {
      const overlayId = String(o?.id || "").trim();
      if (overlayId && excludedOverlayIds.has(overlayId)) continue;
      const overlayEType = String(o?.eType || o?.name || "").trim().toLowerCase();
      const entryColor = isDiverterEType(overlayEType)
        ? getDirectEntryActiveColorForDiverter(o, {
            excludedOverlayIds: [...excludedOverlayIds, overlayId],
          })
        : "";
      const incomingEntryColor = normalizeActiveLineColor(entryColor);
      const color = getEffectiveOverlayFlowColor(o, overlayEType, entryColor);
      if (isDiverterEType(overlayEType) && !incomingEntryColor) continue;
      if (!color) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      const x = wr.x;
      const y = wr.y;
      const w = wr.w;
      const h = wr.h;
      if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) {
        if (isDiverterEType(overlayEType)) {
          const sx = overlayScaleX(o);
          const sy = overlayScaleY(o);
          const localX = (Number(pt.x) - Number(o.tx || 0)) / Math.max(0.0001, sx);
          const localY = (Number(pt.y) - Number(o.ty || 0)) / Math.max(0.0001, sy);
          const branch = getDiverterBranchAtLocalPoint(localX, localY, bb);
          const activeBranch = getEffectiveDiverterState(o);
          if (branch === "entry") return color;
          if (branch && activeBranch && branch === activeBranch) return color;
          if (branch) continue;
        }
        return color;
      }
    }
    return "";
  };

  const getOverlayColorNearPoint = (pt, threshold = 28, options = {}) => {
    if (!pt || !svgOverlays?.length) return "";
    const excludedOverlayIds = new Set(
      [
        options?.excludeOverlayId,
        ...(Array.isArray(options?.excludedOverlayIds) ? options.excludedOverlayIds : []),
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    let bestColor = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const o of svgOverlays) {
      const overlayId = String(o?.id || "").trim();
      if (overlayId && excludedOverlayIds.has(overlayId)) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      const dist = distancePointToRect(pt, wr);
      if (dist > threshold || dist >= bestDistance) continue;
      const overlayEType = String(o?.eType || o?.name || "").trim().toLowerCase();
      const entryColor = isDiverterEType(overlayEType)
        ? getDirectEntryActiveColorForDiverter(o, {
            excludedOverlayIds: [...excludedOverlayIds, overlayId],
          })
        : "";
      const incomingEntryColor = normalizeActiveLineColor(entryColor);
      const color = getEffectiveOverlayFlowColor(o, overlayEType, entryColor);
      if (isDiverterEType(overlayEType) && !incomingEntryColor) continue;
      if (!color) continue;
      if (isDiverterEType(overlayEType)) {
        const sx = overlayScaleX(o);
        const sy = overlayScaleY(o);
        const localX = (Number(pt.x) - Number(o.tx || 0)) / Math.max(0.0001, sx);
        const localY = (Number(pt.y) - Number(o.ty || 0)) / Math.max(0.0001, sy);
        const branch = getDiverterBranchAtLocalPoint(localX, localY, bb);
        const activeBranch = getEffectiveDiverterState(o);
        if (!(branch === "entry" || (branch && activeBranch && branch === activeBranch))) continue;
      }
      bestDistance = dist;
      bestColor = color;
    }
    return bestColor;
  };

  const getActiveDiverterOutputColorAtPoint = (pt, options = {}) => {
    if (!pt || !Array.isArray(svgOverlays) || !svgOverlays.length) return "";
    let bestColor = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const o of svgOverlays) {
      const overlayEType = String(o?.eType || o?.name || "").trim().toLowerCase();
      if (!isDiverterEType(overlayEType)) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      const dist = distancePointToRect(pt, wr);
      if (dist > OVERLAY_TOUCH_COLOR_THRESHOLD || dist >= bestDistance) continue;

      const incomingEntryColor = normalizeActiveLineColor(
        getDirectEntryActiveColorForDiverter(o, {
          ...options,
          excludeOverlayId: String(o?.id || ""),
        })
      );
      if (!incomingEntryColor) continue;

      const sx = overlayScaleX(o);
      const sy = overlayScaleY(o);
      const localX = (Number(pt.x) - Number(o.tx || 0)) / Math.max(0.0001, sx);
      const localY = (Number(pt.y) - Number(o.ty || 0)) / Math.max(0.0001, sy);
      const connectorOutputBranch = getDiverterOutputBranchAtWorldPoint(o, pt, bb, 30);
      const localBranch = getDiverterBranchAtLocalPoint(localX, localY, bb);
      const branch =
        connectorOutputBranch ||
        (localBranch === "straight" || localBranch === "divert" ? localBranch : "");
      const activeBranch = getEffectiveDiverterState(o);
      if (!(branch && branch !== "entry" && activeBranch && branch === activeBranch)) continue;

      const color = getEffectiveOverlayFlowColor(o, overlayEType, incomingEntryColor);
      if (!color) continue;
      bestDistance = dist;
      bestColor = color;
    }
    return bestColor;
  };

  const getDiverterOutputMatchAtPoint = (pt, options = {}) => {
    if (!pt || !Array.isArray(svgOverlays) || !svgOverlays.length) {
      return { matched: false, active: false, color: "" };
    }
    let best = { matched: false, active: false, color: "", dist: Number.POSITIVE_INFINITY };
    for (const o of svgOverlays) {
      const overlayEType = String(o?.eType || o?.name || "").trim().toLowerCase();
      if (!isDiverterEType(overlayEType)) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      const dist = distancePointToRect(pt, wr);
      if (dist > 42 || dist >= best.dist) continue;

      const sx = overlayScaleX(o);
      const sy = overlayScaleY(o);
      const localX = (Number(pt.x) - Number(o.tx || 0)) / Math.max(0.0001, sx);
      const localY = (Number(pt.y) - Number(o.ty || 0)) / Math.max(0.0001, sy);
      const branch =
        getDiverterOutputBranchAtWorldPoint(o, pt, bb, 42) ||
        (["straight", "divert"].includes(getDiverterBranchAtLocalPoint(localX, localY, bb))
          ? getDiverterBranchAtLocalPoint(localX, localY, bb)
          : "");
      if (!branch) continue;

      const incomingEntryColor = normalizeActiveLineColor(
        getDirectEntryActiveColorForDiverter(o, {
          ...options,
          excludeOverlayId: String(o?.id || ""),
        })
      );
      const activeBranch = getEffectiveDiverterState(o);
      const active = !!incomingEntryColor && !!activeBranch && branch === activeBranch;
      const color = getEffectiveOverlayFlowColor(o, overlayEType, incomingEntryColor);
      best = { matched: true, active, color: color || incomingEntryColor || "#22c55e", dist };
    }
    return { matched: best.matched, active: best.active, color: best.color };
  };

  const isPointNearDiverter = (pt, threshold = 30) => {
    if (!pt || !Array.isArray(svgOverlays) || !svgOverlays.length) return false;
    for (const o of svgOverlays) {
      const overlayEType = String(o?.eType || o?.name || "").trim().toLowerCase();
      if (!isDiverterEType(overlayEType)) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      if (distancePointToRect(pt, wr) <= threshold) return true;
    }
    return false;
  };

  const getNonDiverterStartSourceColorAtPoint = (pt, options = {}) => {
    if (!pt || !Array.isArray(svgOverlays) || !svgOverlays.length) return "";
    let bestColor = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const o of svgOverlays) {
      const overlayEType = String(o?.eType || o?.name || "").trim().toLowerCase();
      if (isDiverterEType(overlayEType)) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      const dist = distancePointToRect(pt, wr);
      if (dist > OVERLAY_TOUCH_COLOR_THRESHOLD || dist >= bestDistance) continue;
      const color = normalizeActiveLineColor(
        getRouteColorForOverlay(o) ||
        getTagColor(o.tagPath) ||
        getRouteStrokeColorForOverlay(o)
      );
      if (!color) continue;
      bestDistance = dist;
      bestColor = color;
    }
    return bestColor;
  };

  const getLiveStartActivationColor = (pt, options = {}) => {
    if (!pt) return "";
    const diverterColor = normalizeActiveLineColor(getActiveDiverterOutputColorAtPoint(pt, options));
    if (diverterColor) return diverterColor;
    return normalizeActiveLineColor(getNonDiverterStartSourceColorAtPoint(pt, options));
  };

  const getConnectedOverlaySourceColorAtPoint = (pt, options = {}) => {
    if (!pt) return "";
    const diverterMatch = getDiverterOutputMatchAtPoint(pt, options);
    if (diverterMatch.matched) {
      return diverterMatch.active
        ? normalizeActiveLineColor(diverterMatch.color) || "#22c55e"
        : null;
    }
    const directOverlayColor = normalizeActiveLineColor(
      getOverlayColorNearPoint(pt, OVERLAY_TOUCH_COLOR_THRESHOLD, {
        ...options,
        allowDiverterPolylineFallback: false,
      })
    );
    return directOverlayColor || "";
  };

  const findConnectedSourceColorFromPolyline = (
    shape,
    entryEndpointIndex,
    options = {},
    visited = new Set(),
    depth = 0
  ) => {
    if (shape?.type !== "polyline" || !Array.isArray(shape.points) || shape.points.length < 2) return "";
    if (depth > 16) return "";
    const shapeId = String(shape?.id || "");
    if (shapeId && visited.has(shapeId)) return "";
    const nextVisited = new Set(visited);
    if (shapeId) nextVisited.add(shapeId);

    const points = shape.points;
    const oppositeIndex = entryEndpointIndex === 0 ? points.length - 1 : 0;
    const oppositePoint = points[oppositeIndex];
    const directSourceColor = getConnectedOverlaySourceColorAtPoint(oppositePoint, options);
    if (directSourceColor === null) return "";
    if (directSourceColor) return directSourceColor;

    for (const other of Array.isArray(shapes) ? shapes : []) {
      if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
      if (String(other?.id || "") === shapeId) continue;
      const otherStart = other.points[0];
      const otherEnd = other.points[other.points.length - 1];
      if (pointsNear(oppositePoint, otherStart)) {
        const found = findConnectedSourceColorFromPolyline(other, 0, options, nextVisited, depth + 1);
        if (found) return found;
      }
      if (pointsNear(oppositePoint, otherEnd)) {
        const found = findConnectedSourceColorFromPolyline(
          other,
          other.points.length - 1,
          options,
          nextVisited,
          depth + 1
        );
        if (found) return found;
      }
    }

    return "";
  };

  const getPolylineStartSourceColor = (shape, options = {}) => {
    if (shape?.type !== "polyline" || !Array.isArray(shape.points) || !shape.points.length) return "";
    const startPoint = shape.points[0];
    const directStartColor = getConnectedOverlaySourceColorAtPoint(startPoint, options);
    if (directStartColor === null) return "";
    if (directStartColor) return directStartColor;
    return normalizeActiveLineColor(
      findConnectedSourceColorFromPolyline(
        shape,
        Math.max(1, shape.points.length - 1),
        options
      )
    );
  };

  const distancePointToRect = (pt, rect) => {
    if (!pt || !rect) return Number.POSITIVE_INFINITY;
    const rx = Number(rect.x) || 0;
    const ry = Number(rect.y) || 0;
    const rw = Number(rect.w) || 0;
    const rh = Number(rect.h) || 0;
    const px = Number(pt.x) || 0;
    const py = Number(pt.y) || 0;
    const dx = px < rx ? rx - px : px > rx + rw ? px - (rx + rw) : 0;
    const dy = py < ry ? ry - py : py > ry + rh ? py - (ry + rh) : 0;
    return Math.hypot(dx, dy);
  };

  const getPolylineDisplayedColor = (shape, options = {}) => {
    if (shape?.type !== "polyline" || !Array.isArray(shape.points) || !shape.points.length) return "";
    const includeThemeDefault = options?.includeThemeDefault !== false;
    const activeOnly = options?.includeThemeDefault === false;
    const allowExplicitStroke = options?.allowExplicitStroke === true;
    const cacheKey = [
      String(shape?.id || ""),
      includeThemeDefault ? "1" : "0",
      allowExplicitStroke ? "1" : "0",
      String(options?.excludeOverlayId || ""),
      Array.isArray(options?.excludedOverlayIds)
        ? options.excludedOverlayIds.map((entry) => String(entry || "")).join("|")
        : "",
      options?.allowDiverterPolylineFallback === false ? "0" : "1",
    ].join("::");
    if (renderPolylineDisplayedColorCache.has(cacheKey)) {
      return renderPolylineDisplayedColorCache.get(cacheKey);
    }
    const finish = (value) => {
      const resolved = String(value || "");
      renderPolylineDisplayedColorCache.set(cacheKey, resolved);
      return resolved;
    };
    const workerResolvedColor = String(
      liveResolvedPolylineColorByIdRef.current.get(String(shape?.id || "")) || ""
    ).trim();
    if (workerResolvedColor) {
      return finish(workerResolvedColor);
    }
    if (!liveCanvasEnabled) {
      const dynamicColor = normalizeActiveLineColor(getTagColor(shape.tagPath));
      if (dynamicColor) return finish(dynamicColor);
      const connectedStartColor = normalizeActiveLineColor(getPolylineStartSourceColor(shape, options));
      if (connectedStartColor) return finish(connectedStartColor);
      if (!activeOnly || allowExplicitStroke) {
        const explicitStroke = normalizeActiveLineColor(shape?.stroke);
        if (explicitStroke) return finish(explicitStroke);
      }
      return finish(includeThemeDefault ? (isDarkTheme ? "#ffffff" : themeStrokeDefault) : "");
    }
    const dynamicColor = normalizeActiveLineColor(getTagColor(shape.tagPath));
    if (dynamicColor) return finish(dynamicColor);
    const connectedStartColor = normalizeActiveLineColor(getPolylineStartSourceColor(shape, options));
    if (connectedStartColor) return finish(connectedStartColor);
    if (!activeOnly || allowExplicitStroke) {
      const explicitStroke = normalizeActiveLineColor(shape?.stroke);
      if (explicitStroke) return finish(explicitStroke);
    }
    return finish(includeThemeDefault ? (isDarkTheme ? "#ffffff" : themeStrokeDefault) : "");
  };

  const getWorkerResolvedPolylineSplitCarrySegments = (shapeId) => {
    if (!liveCanvasEnabled) return [];
    const key = String(shapeId || "").trim();
    if (!key) return [];
    const byId =
      liveResolvedPolylineSplitCarryByIdRef.current &&
      typeof liveResolvedPolylineSplitCarryByIdRef.current === "object"
        ? liveResolvedPolylineSplitCarryByIdRef.current
        : {};
    const segments = byId[key];
    return Array.isArray(segments) ? segments : [];
  };

  const pointsNear = (a, b, threshold = 12) => {
    if (!a || !b) return false;
    const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
    const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
    return dx * dx + dy * dy <= threshold * threshold;
  };

  const findNetworkColorFromPolyline = (shape, entryEndpointIndex, options = {}, visited = new Set(), depth = 0) => {
    if (shape?.type !== "polyline" || !Array.isArray(shape.points) || shape.points.length < 2) return "";
    if (depth > 16) return "";
    const shapeId = String(shape?.id || "");
    if (shapeId && visited.has(shapeId)) return "";
    const nextVisited = new Set(visited);
    if (shapeId) nextVisited.add(shapeId);

    const dynamicColor = getTagColor(shape.tagPath);
    if (dynamicColor) return dynamicColor;

    const points = shape.points;
    const oppositeIndex = entryEndpointIndex === 0 ? points.length - 1 : 0;
    const oppositePoint = points[oppositeIndex];
    const oppositeOverlayColor = oppositePoint
      ? getOverlayColorAtPoint(oppositePoint, {
          ...options,
          allowDiverterPolylineFallback: false,
        })
      : "";
    if (oppositeOverlayColor) return oppositeOverlayColor;

    for (const other of Array.isArray(shapes) ? shapes : []) {
      if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
      if (String(other?.id || "") === shapeId) continue;
      const otherStart = other.points[0];
      const otherEnd = other.points[other.points.length - 1];
      if (pointsNear(oppositePoint, otherStart)) {
        const found = findNetworkColorFromPolyline(other, 0, options, nextVisited, depth + 1);
        if (found) return found;
      }
      if (pointsNear(oppositePoint, otherEnd)) {
        const found = findNetworkColorFromPolyline(other, other.points.length - 1, options, nextVisited, depth + 1);
        if (found) return found;
      }
    }

    return String(shape?.stroke || "").trim();
  };

  const getPolylineEndpointInheritedColor = (shape, endpointIndex, overlay, options = {}) => {
    if (shape?.type !== "polyline" || !Array.isArray(shape.points) || shape.points.length < 2) return "";
    const dynamicColor = getTagColor(shape.tagPath);
    if (dynamicColor) return dynamicColor;
    return findNetworkColorFromPolyline(
      shape,
      endpointIndex,
      {
        ...options,
        excludeOverlayId: overlay?.id,
      }
    );
  };

  const getPolylineStrokeColorNearOverlay = (overlay, branchFilter = "", options = {}) => {
    if (!overlay || !Array.isArray(shapes) || !shapes.length) return "";
    const bb = overlay?.bbox || overlayLocalBBox?.(overlay.id);
    if (!bb) return "";
    const wr = overlayWorldRect(overlay, bb);
    const threshold = 28;
    let bestColor = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    const normalizedBranchFilter = String(branchFilter || "").trim().toLowerCase();
    for (const s of shapes) {
      if (s?.type !== "polyline" || !Array.isArray(s.points) || !s.points.length) continue;
      const endpoints = [s.points[0], s.points[s.points.length - 1]].filter(Boolean);
      for (let idx = 0; idx < endpoints.length; idx += 1) {
        const pt = endpoints[idx];
        const dist = distancePointToRect(pt, wr);
        if (dist > threshold) continue;
        if (normalizedBranchFilter) {
          const sx = overlayScaleX(overlay);
          const sy = overlayScaleY(overlay);
          const localX = (Number(pt.x) - Number(overlay?.tx || 0)) / Math.max(0.0001, sx);
          const localY = (Number(pt.y) - Number(overlay?.ty || 0)) / Math.max(0.0001, sy);
          const branch = getDiverterBranchAtLocalPoint(localX, localY, bb);
          if (branch !== normalizedBranchFilter) continue;
        }
        const polyStroke =
          getPolylineEndpointInheritedColor(s, idx, overlay, options) ||
          getPolylineDisplayedColor(s, options);
        if (!polyStroke) continue;
        if (dist <= threshold && dist < bestDistance) {
          bestDistance = dist;
          bestColor = polyStroke;
        }
      }
    }
    return bestColor;
  };

  const projectPointToSegment = (pt, a, b) => {
    const ax = Number(a?.x) || 0;
    const ay = Number(a?.y) || 0;
    const bx = Number(b?.x) || 0;
    const by = Number(b?.y) || 0;
    const px = Number(pt?.x) || 0;
    const py = Number(pt?.y) || 0;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 <= 1e-9) {
      const ddx = px - ax;
      const ddy = py - ay;
      return { t: 0, point: { x: ax, y: ay }, dist2: ddx * ddx + ddy * ddy };
    }
    const rawT = ((px - ax) * dx + (py - ay) * dy) / len2;
    const t = Math.max(0, Math.min(1, rawT));
    const x = ax + dx * t;
    const y = ay + dy * t;
    const ddx = px - x;
    const ddy = py - y;
    return { t, point: { x, y }, dist2: ddx * ddx + ddy * ddy };
  };

  const distancePointToPolyline = (pt, polylinePoints) => {
    if (!pt || !Array.isArray(polylinePoints) || polylinePoints.length < 2) {
      return Number.POSITIVE_INFINITY;
    }
    let bestDist2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < polylinePoints.length - 1; i += 1) {
      const proj = projectPointToSegment(pt, polylinePoints[i], polylinePoints[i + 1]);
      if (proj.dist2 < bestDist2) bestDist2 = proj.dist2;
    }
    return Math.sqrt(bestDist2);
  };

  const findSplitTouchCandidates = (shape, threshold = 30) => {
    if (shape?.type !== "polyline" || !Array.isArray(shape.points) || shape.points.length < 2) return null;
    const shapeId = String(shape?.id || "");
    const pts = shape.points;
    const threshold2 = threshold * threshold;
    const matches = [];
    for (const other of Array.isArray(shapes) ? shapes : []) {
      if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
      const otherId = String(other?.id || "");
      if (!otherId || otherId === shapeId) continue;
      const endpoints = [other.points[0], other.points[other.points.length - 1]].filter(Boolean);
      for (const endpoint of endpoints) {
        // If trunk is already split, endpoint may land exactly on an interior vertex.
        for (let nodeIndex = 1; nodeIndex < pts.length - 1; nodeIndex += 1) {
          const node = pts[nodeIndex];
          const dx = (Number(endpoint?.x) || 0) - (Number(node?.x) || 0);
          const dy = (Number(endpoint?.y) || 0) - (Number(node?.y) || 0);
          const dist2 = dx * dx + dy * dy;
          if (dist2 > threshold2) continue;
          matches.push({
            sourcePolylineId: otherId,
            nodeIndex,
            touchPoint: { x: Number(node?.x) || 0, y: Number(node?.y) || 0 },
            score: dist2,
          });
        }
        for (let i = 0; i < pts.length - 1; i += 1) {
          const a = pts[i];
          const b = pts[i + 1];
          const proj = projectPointToSegment(endpoint, a, b);
          if (proj.dist2 > threshold2) continue;
          if ((Number(proj.t) || 0) <= 0.02 || (Number(proj.t) || 0) >= 0.98) continue;
          matches.push({
            sourcePolylineId: otherId,
            segmentIndex: i,
            t: proj.t,
            touchPoint: { x: Number(proj.point?.x) || 0, y: Number(proj.point?.y) || 0 },
            score: proj.dist2,
          });
        }
      }
    }
    if (!matches.length) return null;
    matches.sort((a, b) => Number(a.score || 0) - Number(b.score || 0));
    return matches;
  };

  const getPolylineFlowMeta = (polyline) => {
    if (polyline?.type !== "polyline" || !Array.isArray(polyline.points) || polyline.points.length < 2) return null;
    const pts = polyline.points;
    const minX = Math.min(...pts.map((p) => Number(p?.x) || 0));
    const maxX = Math.max(...pts.map((p) => Number(p?.x) || 0));
    const minY = Math.min(...pts.map((p) => Number(p?.y) || 0));
    const maxY = Math.max(...pts.map((p) => Number(p?.y) || 0));
    const xSpan = Math.max(0, maxX - minX);
    const ySpan = Math.max(0, maxY - minY);
    const startPt = pts[0];
    const endPt = pts[pts.length - 1];
    const downstreamIsEnd =
      (Number(endPt?.x) || 0) > (Number(startPt?.x) || 0) ||
      ((Number(endPt?.x) || 0) === (Number(startPt?.x) || 0) &&
        (Number(endPt?.y) || 0) >= (Number(startPt?.y) || 0));
    const downstreamPoint = downstreamIsEnd ? endPt : startPt;
    const upstreamPoint = downstreamIsEnd ? startPt : endPt;
    return {
      pts,
      downstreamIsEnd,
      downstreamPoint,
      upstreamPoint,
      orderedPoints: downstreamIsEnd ? pts : [...pts].reverse(),
      isTrunkLike: xSpan >= 24 && xSpan >= ySpan * 1.5,
    };
  };

  const getBranchStartActiveColor = (polyline, options = {}) => {
    if (!polyline || polyline?.type !== "polyline" || !Array.isArray(polyline.points) || !polyline.points.length) {
      return "";
    }
    const dynamic = normalizeActiveLineColor(getTagColor(polyline.tagPath));
    if (dynamic) return dynamic;
    const explicitStroke = normalizeActiveLineColor(polyline?.stroke);
    if (explicitStroke) return explicitStroke;
    const startPt = polyline.points[0];
    const endPt = polyline.points[polyline.points.length - 1];
    const startOverlayColor = normalizeActiveLineColor(startPt ? getOverlayColorAtPoint(startPt, options) : "");
    if (startOverlayColor) return startOverlayColor;
    const endOverlayColor = normalizeActiveLineColor(endPt ? getOverlayColorAtPoint(endPt, options) : "");
    if (endOverlayColor) return endOverlayColor;
    const nearStartColor = normalizeActiveLineColor(
      startPt ? getOverlayColorNearPoint(startPt, OVERLAY_TOUCH_COLOR_THRESHOLD, options) : ""
    );
    if (nearStartColor) return nearStartColor;
    const nearEndColor = normalizeActiveLineColor(
      endPt ? getOverlayColorNearPoint(endPt, OVERLAY_TOUCH_COLOR_THRESHOLD, options) : ""
    );
    if (nearEndColor) return nearEndColor;
    // Active indication can be centered on the branch node, not only endpoints.
    // Keep this tight so a line that only passes near equipment does not inherit color.
    const pts = Array.isArray(polyline.points) ? polyline.points : [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const c = normalizeActiveLineColor(
        getOverlayColorAtPoint(p, options) || getOverlayColorNearPoint(p, OVERLAY_TOUCH_COLOR_THRESHOLD, options)
      );
      if (c) return c;
    }
    return "";
  };

  const getDirectSplitCarryCandidates = (shape, options = {}) => {
    const meta = getPolylineFlowMeta(shape);
    if (!meta?.isTrunkLike) return [];
    const pts = meta.orderedPoints;
    const prefix = [0];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot((Number(b?.x) || 0) - (Number(a?.x) || 0), (Number(b?.y) || 0) - (Number(a?.y) || 0));
      prefix.push(prefix[prefix.length - 1] + len);
    }
    const collect = (maxDistPx) => {
      const candidates = [];
      const maxDist2 = maxDistPx * maxDistPx;
      for (const other of Array.isArray(shapes) ? shapes : []) {
        if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
        const otherId = String(other?.id || "");
        if (!otherId || otherId === String(shape?.id || "")) continue;
        const otherMeta = getPolylineFlowMeta(other);
        if (otherMeta?.isTrunkLike) continue;
        const startPt = other.points[0];
        const endPt = other.points[other.points.length - 1];
        if (!startPt || !endPt) continue;
        const color = getBranchStartActiveColor(other, options);
        if (!color) continue;
        const testPoints = [endPt, startPt];
        let bestTouch = null;
        for (const tp of testPoints) {
          for (let i = 0; i < pts.length - 1; i += 1) {
            const proj = projectPointToSegment(tp, pts[i], pts[i + 1]);
            if (proj.dist2 > maxDist2) continue;
            const segLen = Math.hypot(
              (Number(pts[i + 1]?.x) || 0) - (Number(pts[i]?.x) || 0),
              (Number(pts[i + 1]?.y) || 0) - (Number(pts[i]?.y) || 0)
            );
            const downstreamProgress = prefix[i] + segLen * (Number(proj.t) || 0);
            const next = {
              sourcePolylineId: otherId,
              segmentIndex: i,
              t: proj.t,
              touchPoint: { x: Number(proj.point?.x) || 0, y: Number(proj.point?.y) || 0 },
              color,
              score: proj.dist2,
              downstreamProgress,
            };
            if (!bestTouch || Number(next.score || 0) < Number(bestTouch.score || 0)) bestTouch = next;
          }
        }
        if (bestTouch) candidates.push(bestTouch);
      }
      return candidates;
    };
    const candidates = collect(SPLIT_CARRY_TOUCH_THRESHOLD);
    candidates.sort(
      (a, b) =>
        Number(a.downstreamProgress || 0) - Number(b.downstreamProgress || 0) ||
        Number(a.score || 0) - Number(b.score || 0)
    );
    return candidates;
  };

  const resolveInheritedTrunkCarryColor = (shape, options = {}, visited = new Set(), depth = 0) => {
    if (depth > 24) return "";
    const shapeId = String(shape?.id || "");
    if (!shapeId || visited.has(shapeId)) return "";
    const meta = getPolylineFlowMeta(shape);
    if (!meta?.isTrunkLike || !meta.upstreamPoint) return "";
    const nextVisited = new Set(visited);
    nextVisited.add(shapeId);

    const ownDirect = getDirectSplitCarryCandidates(shape, options);
    if (ownDirect.length) {
      const c = normalizeActiveLineColor(ownDirect[0]?.color);
      if (c) return c;
    }

    let best = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    const shapeEndpoints = [meta.pts[0], meta.pts[meta.pts.length - 1]].filter(Boolean);
    for (const other of Array.isArray(shapes) ? shapes : []) {
      if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
      const otherId = String(other?.id || "");
      if (!otherId || otherId === shapeId || nextVisited.has(otherId)) continue;
      const otherMeta = getPolylineFlowMeta(other);
      if (!otherMeta?.isTrunkLike) continue;
      const otherEndpoints = [otherMeta.pts[0], otherMeta.pts[otherMeta.pts.length - 1]].filter(Boolean);
      let connectDist = Number.POSITIVE_INFINITY;
      for (const a of shapeEndpoints) {
        for (const b of otherEndpoints) {
          const d = Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
          if (d < connectDist) connectDist = d;
        }
      }
      for (const b of otherEndpoints) {
        const d = distancePointToPolyline(b, meta.pts);
        if (d < connectDist) connectDist = d;
      }
      for (const a of shapeEndpoints) {
        const d = distancePointToPolyline(a, otherMeta.pts);
        if (d < connectDist) connectDist = d;
      }
      if (connectDist > 260) continue;
      const c =
        resolveInheritedTrunkCarryColor(other, options, nextVisited, depth + 1);
      if (!c) continue;
      if (connectDist < bestDistance) {
        bestDistance = connectDist;
        best = c;
      }
    }
    return normalizeActiveLineColor(best);
  };

  const resolveConnectedTrunkCarryColor = (shape, options = {}) => {
    const seedMeta = getPolylineFlowMeta(shape);
    if (!seedMeta?.isTrunkLike) return "";
    const seedId = String(shape?.id || "");
    if (!seedId) return "";
    const trunkById = new Map();
    for (const s of Array.isArray(shapes) ? shapes : []) {
      if (s?.type !== "polyline") continue;
      const id = String(s?.id || "");
      if (!id) continue;
      const m = getPolylineFlowMeta(s);
      if (!m?.isTrunkLike) continue;
      trunkById.set(id, { shape: s, meta: m });
    }
    if (!trunkById.has(seedId)) return "";

    const connected = new Set([seedId]);
    const queue = [seedId];
    while (queue.length) {
      const curId = queue.shift();
      const cur = trunkById.get(curId);
      if (!cur) continue;
      const curEndpoints = [cur.meta.pts[0], cur.meta.pts[cur.meta.pts.length - 1]].filter(Boolean);
      for (const [otherId, other] of trunkById.entries()) {
        if (connected.has(otherId) || otherId === curId) continue;
        const otherEndpoints = [other.meta.pts[0], other.meta.pts[other.meta.pts.length - 1]].filter(Boolean);
        let connectDist = Number.POSITIVE_INFINITY;
        for (const a of curEndpoints) {
          for (const b of otherEndpoints) {
            const d = Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
            if (d < connectDist) connectDist = d;
          }
        }
        for (const a of curEndpoints) {
          const d = distancePointToPolyline(a, other.meta.pts);
          if (d < connectDist) connectDist = d;
        }
        for (const b of otherEndpoints) {
          const d = distancePointToPolyline(b, cur.meta.pts);
          if (d < connectDist) connectDist = d;
        }
        if (connectDist > 260) continue;
        connected.add(otherId);
        queue.push(otherId);
      }
    }

    let bestColor = "";
    let bestProgress = Number.POSITIVE_INFINITY;
    const pickProgress = (cand, meta) => {
      if (!cand) return Number.POSITIVE_INFINITY;
      const p = Number(cand.downstreamProgress);
      if (Number.isFinite(p)) return p;
      const x = Number(cand?.touchPoint?.x) || 0;
      return meta?.downstreamIsEnd ? x : -x;
    };
    for (const id of connected) {
      const rec = trunkById.get(id);
      if (!rec) continue;
      const local = getDirectSplitCarryCandidates(rec.shape, options);
      if (!local.length) continue;
      const color = normalizeActiveLineColor(local[0]?.color);
      if (!color) continue;
      const progress = pickProgress(local[0], rec.meta);
      if (progress < bestProgress) {
        bestProgress = progress;
        bestColor = color;
      }
    }
    return normalizeActiveLineColor(bestColor);
  };

  const resolveCollinearTrunkBandCarryColor = (shape, options = {}) => {
    const targetMeta = getPolylineFlowMeta(shape);
    if (!targetMeta?.isTrunkLike) return "";
    const targetPts = targetMeta.pts;
    const targetMinY = Math.min(...targetPts.map((p) => Number(p?.y) || 0));
    const targetMaxY = Math.max(...targetPts.map((p) => Number(p?.y) || 0));
    const targetMidY = (targetMinY + targetMaxY) / 2;

    let bestColor = "";
    let bestDx = Number.POSITIVE_INFINITY;
    for (const other of Array.isArray(shapes) ? shapes : []) {
      if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
      const otherMeta = getPolylineFlowMeta(other);
      if (!otherMeta?.isTrunkLike) continue;
      const local = getDirectSplitCarryCandidates(other, options);
      if (!local.length) continue;
      const color = normalizeActiveLineColor(local[0]?.color);
      if (!color) continue;

      const otherPts = otherMeta.pts;
      const otherMinY = Math.min(...otherPts.map((p) => Number(p?.y) || 0));
      const otherMaxY = Math.max(...otherPts.map((p) => Number(p?.y) || 0));
      const otherMidY = (otherMinY + otherMaxY) / 2;
      const dy = Math.abs(otherMidY - targetMidY);
      if (dy > 24) continue;

      const targetMinX = Math.min(...targetPts.map((p) => Number(p?.x) || 0));
      const otherMinX = Math.min(...otherPts.map((p) => Number(p?.x) || 0));
      const dx = Math.abs(otherMinX - targetMinX);
      if (dx < bestDx) {
        bestDx = dx;
        bestColor = color;
      }
    }
    return normalizeActiveLineColor(bestColor);
  };

  const getPolylineSplitCarrySegments = (shape, options = {}) => {
    if (liveTopologyStressMode) return [];
    const meta = getPolylineFlowMeta(shape);
    if (!meta?.isTrunkLike) return [];
    const collectConnectedTrunks = () => {
      const seedId = String(shape?.id || "");
      if (!seedId) return [];
      const trunkById = new Map();
      for (const s of Array.isArray(shapes) ? shapes : []) {
        if (s?.type !== "polyline") continue;
        const id = String(s?.id || "");
        if (!id) continue;
        const m = getPolylineFlowMeta(s);
        if (!m?.isTrunkLike) continue;
        trunkById.set(id, { shape: s, meta: m });
      }
      if (!trunkById.has(seedId)) return [];
      const connected = new Set([seedId]);
      const queue = [seedId];
      while (queue.length) {
        const curId = queue.shift();
        const cur = trunkById.get(curId);
        if (!cur) continue;
        const curEndpoints = [cur.meta.pts[0], cur.meta.pts[cur.meta.pts.length - 1]].filter(Boolean);
        for (const [otherId, other] of trunkById.entries()) {
          if (connected.has(otherId) || otherId === curId) continue;
          const otherEndpoints = [other.meta.pts[0], other.meta.pts[other.meta.pts.length - 1]].filter(Boolean);
          let connectDist = Number.POSITIVE_INFINITY;
          for (const a of curEndpoints) {
            for (const b of otherEndpoints) {
              const d = Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
              if (d < connectDist) connectDist = d;
            }
          }
          for (const a of curEndpoints) {
            const d = distancePointToPolyline(a, other.meta.pts);
            if (d < connectDist) connectDist = d;
          }
          for (const b of otherEndpoints) {
            const d = distancePointToPolyline(b, cur.meta.pts);
            if (d < connectDist) connectDist = d;
          }
          if (connectDist > 260) continue;
          connected.add(otherId);
          queue.push(otherId);
        }
      }
      return Array.from(connected)
        .map((id) => trunkById.get(id))
        .filter(Boolean);
    };

    const buildOrderedCarryFromTouch = (orderedPoints, touch) => {
      if (!Array.isArray(orderedPoints) || orderedPoints.length < 2 || !touch) return [];
      const seg = Math.max(0, Math.min(orderedPoints.length - 2, Number(touch.segmentIndex) || 0));
      const out = [
        { x: Number(touch.touchPoint?.x) || 0, y: Number(touch.touchPoint?.y) || 0 },
        ...orderedPoints.slice(seg + 1),
      ];
      const compact = [];
      for (const pt of out) {
        if (!compact.length || !pointsNear(compact[compact.length - 1], pt, 0.001)) compact.push(pt);
      }
      return compact.length >= 2 ? compact : [];
    };
    const trimOrderedPointsFromStartX = (orderedPoints, startX, downstreamIsEnd) => {
      if (!Array.isArray(orderedPoints) || orderedPoints.length < 2) return [];
      const want = (x) => (downstreamIsEnd ? x >= startX : x <= startX);
      const out = [];
      for (let i = 0; i < orderedPoints.length - 1; i += 1) {
        const a = orderedPoints[i];
        const b = orderedPoints[i + 1];
        const ax = Number(a?.x) || 0;
        const bx = Number(b?.x) || 0;
        const aOk = want(ax);
        const bOk = want(bx);
        if (!out.length) {
          if (aOk) out.push(a);
          if (!aOk && bOk) {
            const dx = bx - ax;
            const t = Math.abs(dx) < 1e-9 ? 0 : (startX - ax) / dx;
            const y = (Number(a?.y) || 0) + ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * t;
            out.push({ x: startX, y });
          }
        }
        if (out.length && bOk) out.push(b);
      }
      const compact = [];
      for (const pt of out) {
        if (!compact.length || !pointsNear(compact[compact.length - 1], pt, 0.001)) compact.push(pt);
      }
      return compact.length >= 2 ? compact : [];
    };

    const connected = collectConnectedTrunks();
    let allCandidates = [];
    for (const rec of connected) {
      const local = getDirectSplitCarryCandidates(rec.shape, options);
      for (const c of local) allCandidates.push(c);
    }
    if (!allCandidates.length) {
      const targetMidY =
        (Math.min(...meta.pts.map((p) => Number(p?.y) || 0)) +
          Math.max(...meta.pts.map((p) => Number(p?.y) || 0))) /
        2;
      const bandCandidates = [];
      for (const s of Array.isArray(shapes) ? shapes : []) {
        if (s?.type !== "polyline") continue;
        const m = getPolylineFlowMeta(s);
        if (!m?.isTrunkLike) continue;
        const midY =
          (Math.min(...m.pts.map((p) => Number(p?.y) || 0)) +
            Math.max(...m.pts.map((p) => Number(p?.y) || 0))) /
          2;
        if (Math.abs(midY - targetMidY) > 24) continue;
        const local = getDirectSplitCarryCandidates(s, options);
        for (const c of local) bandCandidates.push(c);
      }
      if (bandCandidates.length) allCandidates = bandCandidates;
    }

    if (!allCandidates.length) {
      const inherited =
        resolveInheritedTrunkCarryColor(shape, options) ||
        resolveConnectedTrunkCarryColor(shape, options) ||
        resolveCollinearTrunkBandCarryColor(shape, options);
      return inherited ? [{ color: inherited, points: meta.orderedPoints }] : [];
    }

    const sortByFlow = [...allCandidates].sort(
      (a, b) =>
        Number(a?.downstreamProgress || 0) - Number(b?.downstreamProgress || 0) ||
        Number(a?.score || 0) - Number(b?.score || 0)
    );
    const first = sortByFlow[0];
    const chainColor = normalizeActiveLineColor(first?.color);
    if (!chainColor) return [];
    const startX = Number(first?.touchPoint?.x) || 0;
    const points = trimOrderedPointsFromStartX(meta.orderedPoints, startX, meta.downstreamIsEnd);
    if (!points.length) return [];
    return [{ color: chainColor, points }];
  };

  const viewportShiftX = Math.max(0, Number(viewportLeftOffset) || 0);
  const rightEdgeReserve = showRulers ? SCROLLBAR_RESERVE : 0;
  const bottomEdgeReserve = 0;
  const viewportW = Math.max(1, Number(size.w || 0));
  const viewportH = Math.max(1, Number(size.h || 0));
  const stageW = Math.max(1, viewportW);
  const stageH = Math.max(1, viewportH);
  const innerW = Math.max(0, viewportW - rulerSize - rightEdgeReserve);
  const innerH = Math.max(0, viewportH - rulerSize - bottomEdgeReserve);
  const vbWidth = Math.max(1, Number(vbW) || 1);
  const vbHeight = Math.max(1, Number(vbH) || 1);
  const preserveAspectRatioRaw = String(preserveAspectRatioMode || "xMinYMin meet").trim() || "xMinYMin meet";
  const preserveAspectRatioLower = preserveAspectRatioRaw.toLowerCase();
  const preserveAspectRatioParts = preserveAspectRatioRaw.split(/\s+/).filter(Boolean);
  const preserveAlignToken = preserveAspectRatioParts[0] || "xMinYMin";
  const preserveMeetOrSliceToken = preserveAspectRatioParts[1] || "meet";
  const preserveAlignX = /xmax/i.test(preserveAlignToken) ? "max" : /xmid/i.test(preserveAlignToken) ? "mid" : "min";
  const preserveAlignY = /ymax/i.test(preserveAlignToken) ? "max" : /ymid/i.test(preserveAlignToken) ? "mid" : "min";
  const preserveIsNone = preserveAspectRatioLower === "none";
  const uniformViewportScale = preserveIsNone
    ? null
    : preserveMeetOrSliceToken.toLowerCase() === "slice"
    ? Math.max(innerW / vbWidth, innerH / vbHeight)
    : Math.min(innerW / vbWidth, innerH / vbHeight);
  const renderedViewportWidth = preserveIsNone ? innerW : vbWidth * Math.max(1e-9, uniformViewportScale || 1);
  const renderedViewportHeight = preserveIsNone ? innerH : vbHeight * Math.max(1e-9, uniformViewportScale || 1);
  const viewportOffsetX =
    preserveIsNone
      ? 0
      : preserveAlignX === "max"
      ? innerW - renderedViewportWidth
      : preserveAlignX === "mid"
      ? (innerW - renderedViewportWidth) / 2
      : 0;
  const viewportOffsetY =
    preserveIsNone
      ? 0
      : preserveAlignY === "max"
      ? innerH - renderedViewportHeight
      : preserveAlignY === "mid"
      ? (innerH - renderedViewportHeight) / 2
      : 0;
  const viewportScaleX = preserveIsNone ? innerW / vbWidth : Math.max(1e-9, uniformViewportScale || 1);
  const viewportScaleY = preserveIsNone ? innerH / vbHeight : Math.max(1e-9, uniformViewportScale || 1);
  const viewportScale = Math.max(viewportScaleX, viewportScaleY);

  // current transform values (WORLD -> SCREEN)
  const z = zoom || 1;
  const panX = pan?.x || 0;
  const panY = pan?.y || 0;

  // SCREEN(px) -> WORLD(units)
  const screenToWorldX = (sx) =>
    ((sx - viewportOffsetX) / Math.max(1e-9, viewportScaleX) - panX) / z;
  const screenToWorldY = (sy) =>
    ((sy - viewportOffsetY) / Math.max(1e-9, viewportScaleY) - panY) / z;

  // WORLD(units) -> SCREEN(px)
  const worldToScreenX = (wx) => (wx * z + panX) * viewportScaleX + viewportOffsetX;
  const worldToScreenY = (wy) => (wy * z + panY) * viewportScaleY + viewportOffsetY;

  // choose a nice step so tick spacing stays visually consistent
  function niceStep(target) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(target, 1e-9))));
    const n = target / p;
    if (n <= 1) return 1 * p;
    if (n <= 2) return 2 * p;
    if (n <= 5) return 5 * p;
    return 10 * p;
  }

  // ✅ Line style -> SVG props
  function strokeStyleProps(style, strokeWidth) {
    const sw = Math.max(1, Number(strokeWidth) || 1);

    switch (style) {
      case "dashed":
        return {
          strokeDasharray: `${sw * 4} ${sw * 2}`,
        };

      case "dotted":
        return {
          strokeDasharray: `${sw} ${sw * 2}`,
          strokeLinecap: "round",
        };

      case "wavy":
        // SVG has no native “wavy stroke”.
        // Lightweight wavy-ish look: small rounded dashes.
        return {
          strokeDasharray: `${sw * 1.5} ${sw * 1.5}`,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        };

      default:
        return {}; // solid
    }
  }

  /* =========================================================
     GRID (TRUE WORLD GRID)
     ========================================================= */
  const gridPathD = useMemo(() => {
    if (!innerW || !innerH) return "";

    // Visible area in WORLD units (based on current pan/zoom + SVG viewBox units)
    const x0 = screenToWorldX(0);
    const x1 = screenToWorldX(innerW);
    const y0 = screenToWorldY(0);
    const y1 = screenToWorldY(innerH);

    const startX = Math.floor(Math.min(x0, x1) / GRID) * GRID - GRID;
    const endX = Math.ceil(Math.max(x0, x1) / GRID) * GRID + GRID;
    const startY = Math.floor(Math.min(y0, y1) / GRID) * GRID - GRID;
    const endY = Math.ceil(Math.max(y0, y1) / GRID) * GRID + GRID;

    let d = "";

    for (let x = startX; x <= endX; x += GRID) d += `M ${x} ${startY} L ${x} ${endY} `;
    for (let y = startY; y <= endY; y += GRID) d += `M ${startX} ${y} L ${endX} ${y} `;

    return d.trim();
  }, [innerW, innerH, panX, panY, z, viewportScaleX, viewportScaleY, viewportOffsetX, viewportOffsetY]);

  /* =========================================================
     KEYBOARD NUDGE (ARROWS)
     ========================================================= */
  useEffect(() => {
    const flushNudge = () => {
      nudgeRafRef.current = 0;
      const pending = nudgePendingRef.current || { dx: 0, dy: 0 };
      const dx = Number(pending.dx) || 0;
      const dy = Number(pending.dy) || 0;
      if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return;
      nudgePendingRef.current = { dx: 0, dy: 0 };

      const selectedShapeIds = Array.isArray(nudgeSelectedIdsRef.current) ? nudgeSelectedIdsRef.current : [];
      const selectedOverlayIdsNow = Array.isArray(nudgeSelectedOverlayIdsRef.current)
        ? nudgeSelectedOverlayIdsRef.current
        : [];
      const hasShapeSel = selectedShapeIds.length > 0;
      const hasOverlaySel = selectedOverlayIdsNow.length > 0;
      if (!hasShapeSel && !hasOverlaySel) return;

      if (hasShapeSel && typeof setShapes === "function") {
        const selectedSegmentNow = nudgeSelectedSegmentRef.current;
        if (
          selectedSegmentNow?.id &&
          selectedShapeIds.includes(selectedSegmentNow.id) &&
          selectedSegmentNow.kind === "point"
        ) {
          const ptIndex = selectedSegmentNow.index;
          setShapes((prev) =>
            prev.map((s) => {
              if (s.id !== selectedSegmentNow.id) return s;
              if (!Array.isArray(s.points)) return s;
              if (ptIndex < 0 || ptIndex >= s.points.length) return s;
              const pts = s.points.map((pt) => ({ ...pt }));
              pts[ptIndex] = { x: pts[ptIndex].x + dx, y: pts[ptIndex].y + dy };
              return { ...s, points: pts };
            })
          );
          return;
        }

        const shapeSet = new Set(selectedShapeIds);
        setShapes((prev) =>
          prev.map((s) => {
            if (!shapeSet.has(s.id)) return s;
            if (s.type === "text") {
              return {
                ...s,
                x: Number(s.x ?? 0) + dx,
                y: Number(s.y ?? 0) + dy,
              };
            }
            if (Array.isArray(s.points)) {
              return {
                ...s,
                points: s.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })),
              };
            }
            return s;
          })
        );
      }

      if (hasOverlaySel && typeof setSvgOverlays === "function") {
        const overlaySet = new Set(selectedOverlayIdsNow);
        setSvgOverlays((prev) =>
          prev.map((o) => {
            if (!overlaySet.has(o.id)) return o;
            return { ...o, tx: o.tx + dx, ty: o.ty + dy };
          })
        );
      }
    };

    const handleKeyDown = (e) => {
      const selectedShapeIds = Array.isArray(nudgeSelectedIdsRef.current) ? nudgeSelectedIdsRef.current : [];
      const selectedOverlayIdsNow = Array.isArray(nudgeSelectedOverlayIdsRef.current)
        ? nudgeSelectedOverlayIdsRef.current
        : [];
      const hasShapeSel = selectedShapeIds.length > 0;
      const hasOverlaySel = selectedOverlayIdsNow.length > 0;
      if (!hasShapeSel && !hasOverlaySel) return;

      // Don’t interfere with typing in inputs
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;

      let dx = 0;
      let dy = 0;

      const base = e.shiftKey ? 10 : 1;
      const step = base / (nudgeZoomRef.current || 1);

      switch (e.key) {
        case "ArrowLeft":
          dx = -step;
          break;
        case "ArrowRight":
          dx = step;
          break;
        case "ArrowUp":
          dy = -step;
          break;
        case "ArrowDown":
          dy = step;
          break;
        default:
          return;
      }

      e.preventDefault();
      nudgePendingRef.current = {
        dx: Number(nudgePendingRef.current?.dx || 0) + dx,
        dy: Number(nudgePendingRef.current?.dy || 0) + dy,
      };
      if (!nudgeRafRef.current) {
        nudgeRafRef.current = window.requestAnimationFrame(flushNudge);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (nudgeRafRef.current) {
        window.cancelAnimationFrame(nudgeRafRef.current);
        nudgeRafRef.current = 0;
      }
      nudgePendingRef.current = { dx: 0, dy: 0 };
    };
  }, [setShapes, setSvgOverlays]);

  /* ============================
     RULERS (SCREEN-PIXEL)
     ============================ */
  function TopRuler() {
    const W = Math.max(0, size.w - rulerSize - rightEdgeReserve);
    const H = rulerSize;

    const majorPx = 100;
    const minorPx = 20;
    const scrollX = Math.max(0, Number(viewportScroll?.x) || 0);
    const startTick = Math.floor(scrollX / minorPx) * minorPx;
    const endTick = scrollX + W;

    const ticks = [];
    for (let tick = startTick; tick <= endTick; tick += minorPx) {
      const x = tick - scrollX;
      const isMajor = tick % majorPx === 0;
      const len = isMajor ? 12 : 7;

      ticks.push(
        <line
          key={`t-${tick}`}
          x1={x + 0.5}
          y1={H}
          x2={x + 0.5}
          y2={H - len}
          stroke="var(--ruler-line)"
          strokeWidth={1}
        />
      );

      if (isMajor) {
        const labelPx = Math.max(0, Math.round(tick));
        ticks.push(
          <text
            key={`tl-${tick}`}
            x={x + 2}
            y={12}
            fontSize={10}
            fill="var(--ruler-text)"
            style={{ userSelect: "none" }}
          >
            {labelPx}px
          </text>
        );
      }
    }

    return (
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          background: "var(--bg-soft)",
          borderBottom: "1px solid var(--border)",
          pointerEvents: "none",
          zIndex: 10,
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
        }}
        onDoubleClick={(e) => {
          const target = e.target;
          const hit = target?.closest?.("[data-overlay-id]");
          if (hit) {
            const id = hit.getAttribute("data-overlay-id");
            if (id) {
              onOverlayDoubleClick?.(e, id);
              return;
            }
          }
          if (e.target !== e.currentTarget) return;
          onSvgDoubleClick?.(e);
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="var(--bg-soft)" />
        {ticks}
      </svg>
    );
  }

  function RightRuler() {
    const W = rulerSize;
    const H = Math.max(0, size.h - rulerSize - bottomEdgeReserve);
    const majorPx = 100;
    const minorPx = 20;

    const ticks = [];
    for (let y = 0; y <= H; y += minorPx) {
      const isMajor = y % majorPx === 0;
      const len = isMajor ? 12 : 7;

      ticks.push(
        <line
          key={`r-${y}`}
          x1={0}
          y1={y + 0.5}
          x2={len}
          y2={y + 0.5}
          stroke="var(--ruler-line)"
          strokeWidth={1}
        />
      );

      if (isMajor) {
        const labelPx = Math.max(0, Math.round(y));
        ticks.push(
          <text
            key={`rl-${y}`}
            x={4}
            y={Math.min(H - 2, y + 10)}
            fontSize={10}
            fill="var(--ruler-text)"
            style={{ userSelect: "none" }}
          >
            {labelPx}px
          </text>
        );
      }
    }

    return (
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{
          position: "absolute",
          right: rightEdgeReserve,
          top: rulerSize,
          background: "var(--bg-soft)",
          borderLeft: "1px solid var(--border)",
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="var(--bg-soft)" />
        {ticks}
      </svg>
    );
  }

  // keep edit handles and strokes same size on screen
  const inv = 1 / z;
  const HANDLE_R = 7 * inv;
  const HANDLE_STROKE = 2 * inv;
  const DOT_R = 3 * inv;
  const HIT_R = 14 * inv;

  const EPS = 1e-6;

  function lastNonZeroSeg(pts) {
    for (let i = pts.length - 1; i > 0; i--) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (dx * dx + dy * dy > EPS) return { a, b };
    }
    return null;
  }

  function pointsForMarker(pts) {
    if (!pts || pts.length < 2) return pts;

    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dx = last.x - prev.x;
    const dy = last.y - prev.y;
    if (dx * dx + dy * dy > EPS) return pts;

    const seg = lastNonZeroSeg(pts);
    if (!seg) return pts;

    const ddx = seg.b.x - seg.a.x;
    const ddy = seg.b.y - seg.a.y;
    const len = Math.hypot(ddx, ddy) || 1;

    const nx = ddx / len;
    const ny = ddy / len;

    const nudged = pts.slice();
    nudged[nudged.length - 1] = { x: last.x + nx * 0.001, y: last.y + ny * 0.001 };
    return nudged;
  }

  const markerForStart = (val) => {
    if (val === "out") return "url(#arrow-rev)";
    if (val === "in") return "url(#arrow-fwd)";
    return undefined;
  };

  const markerForEnd = (val) => {
    if (val === "out") return "url(#arrow-fwd)";
    if (val === "in") return "url(#arrow-rev)";
    return undefined;
  };

  const renderTagBubble = ({ key, bubbleId, x, anchorY, lines, anchor = "middle" }) => {
    if (!Array.isArray(lines) || lines.length === 0) return null;
    const fontSize = 8 * inv;
    const lineH = 9.5 * inv;
    const padX = 4 * inv;
    const padY = 3.5 * inv;
    const radius = 7 * inv;
    const maxChars = lines.reduce((m, line) => Math.max(m, String(line || "").length), 0);
    const textW = Math.max(22 * inv, maxChars * 5.4 * inv);
    const w = textW + padX * 2;
    const h = lineH * lines.length + padY * 2;
    const top = anchorY - h - 8 * inv;
    const left = anchor === "start" ? x : x - w / 2;
    const textX = anchor === "start" ? x + padX : x;
    const textAnchor = anchor === "start" ? "start" : "middle";

    return (
      <g key={key}>
        <line
          x1={x}
          y1={top + h}
          x2={x}
          y2={anchorY}
          stroke="#0f172a"
          strokeWidth={1.2 * inv}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          rx={radius}
          ry={radius}
          fill="rgba(255,255,255,0.92)"
          stroke="rgba(15,23,42,0.35)"
          strokeWidth={1 * inv}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: onHideTagBubble ? "pointer" : "default" }}
          onClick={
            onHideTagBubble
              ? (e) => {
                  e.stopPropagation();
                  if (bubbleId) onHideTagBubble(bubbleId);
                }
              : undefined
          }
        />
        <text
          x={textX}
          y={top + padY}
          fontSize={fontSize}
          fill="#0f172a"
          textAnchor={textAnchor}
          dominantBaseline="hanging"
          pointerEvents="none"
        >
          {lines.map((line, idx) => (
            <tspan key={`${key}-${idx}`} x={textX} dy={idx === 0 ? 0 : lineH}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  };

  const htmlChartLayers = [];
  const selectedOverlayAlwaysIncludeIds =
    renderLiveVisuals && Array.isArray(selectedOverlayIds) ? selectedOverlayIds : [];
  const selectedOverlayAlwaysIncludeKey = renderLiveVisuals
    ? selectedOverlayAlwaysIncludeIds.map((id) => String(id || "").trim()).filter(Boolean).join("|")
    : "";
  const overlayRenderOverlays = useMemo(() => {
    const list = Array.isArray(svgOverlays) ? svgOverlays : [];
    if (!list.length) return [];
    const alwaysInclude = new Set(
      [
        ...selectedOverlayAlwaysIncludeIds,
        String(hoverOverlayId || "").trim(),
      ]
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    );
    const wx0 = Math.min(screenToWorldX(0), screenToWorldX(innerW));
    const wx1 = Math.max(screenToWorldX(0), screenToWorldX(innerW));
    const wy0 = Math.min(screenToWorldY(0), screenToWorldY(innerH));
    const wy1 = Math.max(screenToWorldY(0), screenToWorldY(innerH));
    const pad = Math.max(80, 180 / Math.max(0.25, z));
    const minX = wx0 - pad;
    const maxX = wx1 + pad;
    const minY = wy0 - pad;
    const maxY = wy1 + pad;
    const out = [];
    list.forEach((overlay) => {
      const id = String(overlay?.id || "").trim();
      if (!id) return;
      if (alwaysInclude.has(id)) {
        out.push(overlay);
        return;
      }
      const bb = overlay?.bbox;
      if (!bb) {
        // Keep overlays with unknown local bounds mounted to avoid accidental dropouts.
        out.push(overlay);
        return;
      }
      const wr = overlayWorldRect(overlay, bb);
      const x0 = Number(wr?.x || 0);
      const y0 = Number(wr?.y || 0);
      const x1 = x0 + Math.max(1, Number(wr?.w || 0));
      const y1 = y0 + Math.max(1, Number(wr?.h || 0));
      const intersects = !(x1 < minX || x0 > maxX || y1 < minY || y0 > maxY);
      if (intersects) out.push(overlay);
    });
    return out;
  }, [
    svgOverlays,
    selectedOverlayAlwaysIncludeKey,
    hoverOverlayId,
    innerW,
    innerH,
    panX,
    panY,
    z,
    viewportScaleX,
    viewportScaleY,
    viewportOffsetX,
    viewportOffsetY,
  ]);
  const overlayVisualById = useMemo(() => {
    const out = new Map();
    const list = Array.isArray(overlayRenderOverlays) ? overlayRenderOverlays : [];
    list.forEach((overlay) => {
      const id = String(overlay?.id || "").trim();
      if (!id) return;
      if (overlay?.widget) {
        const bb = overlay?.bbox || { x: 0, y: 0, width: 320, height: 180 };
        const widgetKind = String(overlay?.widget?.kind || "").trim();
        const suppressFrame = widgetKind === "pushButton" || widgetKind === "onOffButton";
        out.set(id, {
          widgetFrame: suppressFrame
            ? null
            : {
                x: Number(bb.x) || 0,
                y: Number(bb.y) || 0,
                w: Math.max(80, Number(bb.width) || 320),
                h: Math.max(60, Number(bb.height) || 180),
                isCountdownBar: widgetKind === "countdownBar",
              },
        });
        return;
      }

      if (overlay?.embeddedView) {
        const bb = overlay?.bbox || { x: 0, y: 0, width: 360, height: 220 };
        out.set(id, {
          embeddedViewFrame: {
            x: Number(bb.x) || 0,
            y: Number(bb.y) || 0,
            w: Math.max(140, Number(bb.width) || 360),
            h: Math.max(90, Number(bb.height) || 220),
          },
        });
        return;
      }

      const overlayEType = String(overlay?.eType || "").trim().toLowerCase();
      const isDiverterOverlay = isDiverterEType(overlayEType);
      const isBinOverlay = overlayEType === "bin" || overlayEType.startsWith("bin");
      const statePaintsStroke = isDocOrDicStatePaintEType(overlayEType);
      const dynamicBinProductLabel = String(
        binProductLabelByOverlayId?.[id] || ""
      ).trim();
      const dynamicBinNameLabel = String(
        binNameLabelByOverlayId?.[id] || ""
      ).trim();
      const binLevelRatio = Math.max(
        0,
        Math.min(1, Number(binLevelRatioByOverlayId?.[id]) || 0)
      );
      const binLockedIn = binLockedInByOverlayId?.[id] === true;
      const binLockedOut = binLockedOutByOverlayId?.[id] === true;
      const shouldReplaceBinText =
        isBinOverlay && (!!dynamicBinProductLabel || !!dynamicBinNameLabel);
      const overlayStatePaint = String(overlayHmiStateColorByOverlayId?.[id] || "").trim();
      const overlayStateStyleClass = isDiverterOverlay || isBinOverlay
        ? ""
        : normalizeIgnitionStyleClassName(overlayStatePaint);
      const overlayStateColor = overlayStateStyleClass
        ? ""
        : normalizeOverlayActiveFillColor(overlayStatePaint);
      const routeOutlineStroke = isBinOverlay
        || isDiverterOverlay
        ? ""
        : normalizeActiveLineColor(
            getRouteColorForOverlay(overlay) || getRouteStrokeColorForOverlay(overlay)
          );
      const diverterOuterStroke = isDiverterOverlay
        ? String(getRouteColorForOverlay(overlay) || getRouteStrokeColorForOverlay(overlay) || "").trim()
        : "";
      const strokeModeRaw = String(overlay?.strokeMode || "").trim().toLowerCase();
      const preserveStrokeMode = !strokeModeRaw || strokeModeRaw === "preserve";
      if (!renderLiveVisuals) {
        const boundActiveFillPaint = String(getOverlayBoundActiveFillColor(overlay) || "").trim();
        const boundFillPaint = String(getOverlayBoundFillColor(overlay) || "").trim();
        const boundActiveStyleClass = isDiverterOverlay || isBinOverlay
          ? ""
          : normalizeIgnitionStyleClassName(boundActiveFillPaint);
        const boundFillStyleClass = isDiverterOverlay || isBinOverlay
          ? ""
          : normalizeIgnitionStyleClassName(boundFillPaint);
        const boundActiveFillColor = boundActiveStyleClass
          ? ""
          : normalizeOverlayActiveFillColor(boundActiveFillPaint);
        const boundFillColor = boundFillStyleClass
          ? ""
          : normalizeOverlayActiveFillColor(boundFillPaint);
        const overlayFill = String(boundActiveFillColor || boundFillColor || overlay?.fill || "").trim();
        const overlayStroke = String(overlay?.stroke || "").trim();
        const overlayStrokeWidth =
          Number.isFinite(Number(overlay?.strokeWidth)) && Number(overlay.strokeWidth) > 0
            ? Number(overlay.strokeWidth)
            : undefined;
        const hasCustomOverlayFill =
          Boolean(overlayFill) && (!preserveStrokeMode || overlayFill.toLowerCase() !== themeFillDefault);
        const hasCustomOverlayStroke =
          Boolean(overlayStroke) && (!preserveStrokeMode || overlayStroke.toLowerCase() !== themeStrokeDefault.toLowerCase());
        let inner = String(overlay?.inner || "");
        if (shouldReplaceBinText) {
          inner = replaceSvgTextPlaceholders(inner, {
            product: dynamicBinProductLabel,
            binNo: dynamicBinNameLabel,
          });
        }
        if (
          isBinOverlay &&
          (
            /id=["']BarGraph["']/i.test(String(inner || "")) ||
            /id=["']Lock_Filling["']/i.test(String(inner || "")) ||
            /id=["']Lock_Discharge["']/i.test(String(inner || "")) ||
            /id=["']LockFill["']/i.test(String(inner || "")) ||
            /id=["']LockDischarge["']/i.test(String(inner || ""))
          )
        ) {
          inner = applyBinVisualStateToSvg(inner, {
            ratio: binLevelRatio,
            showFillLock: binLockedIn,
            showDischargeLock: binLockedOut,
          });
        }
        if (isDiverterOverlay) {
          const diverterMode = getEffectiveDiverterState(overlay);
          const diverterFlowColor = normalizeActiveLineColor(
            getDirectEntryActiveColorForDiverter(overlay, {
              excludedOverlayIds: [id],
            })
          );
          inner = applyDiverterModeToSvg(inner, diverterMode);
          inner = applyDiverterFlowColorToSvg(inner, diverterFlowColor, diverterMode, diverterOuterStroke);
          out.set(id, {
            inner,
            className: undefined,
            style: {
              pointerEvents: "visiblePainted",
            },
            isConveyorScrew: false,
          });
          return;
        }
        out.set(id, {
          inner: (() => {
            const defaultOverlayFill = hasCustomOverlayFill ? overlayFill : themeFillDefault;
            const stateStyleClass = isBinOverlay
              ? ""
              : (overlayStateStyleClass || boundActiveStyleClass || boundFillStyleClass);
            const stateStrokeColor = statePaintsStroke && !stateStyleClass
              ? (overlayStateColor || boundActiveFillColor || "")
              : "";
            const strokeColor = hasCustomOverlayStroke ? overlayStroke : stateStrokeColor;
            let nextInner = applyOverlayPaintOverrides(inner, {
              fillColor: isBinOverlay || stateStyleClass ? "" : (overlayStateColor || defaultOverlayFill),
              strokeColor,
              strokeWidth: overlayStrokeWidth,
            });
            if (stateStyleClass) {
              nextInner = applyIgnitionStyleClassToSvg(nextInner, stateStyleClass);
            }
            if (strokeColor) {
              nextInner = forceSvgStrokeColor(nextInner, strokeColor);
            }
            if (routeOutlineStroke) {
              nextInner = applyOverlayOuterStrokeColor(nextInner, routeOutlineStroke);
            }
            return nextInner;
          })(),
          className: (
            isBinOverlay
              ? ""
              : (overlayStateStyleClass || boundActiveStyleClass || boundFillStyleClass)
          ) || undefined,
          style: {
            fill: isBinOverlay
              ? undefined
              : (overlayStateStyleClass || boundActiveStyleClass || boundFillStyleClass)
              ? (hasCustomOverlayFill ? overlayFill : themeFillDefault)
              : (overlayStateColor || (hasCustomOverlayFill ? overlayFill : undefined)),
            stroke: hasCustomOverlayStroke ? overlayStroke : undefined,
            strokeWidth: overlayStrokeWidth,
            pointerEvents: "visiblePainted",
          },
          isConveyorScrew: false,
        });
        return;
      }

      const boundActiveFill = String(getOverlayBoundActiveFillColor(overlay) || "").trim();
      const tagStatePaint = String(getTagColor(overlay.tagPath) || "").trim();
      const activeFillPaint = boundActiveFill || tagStatePaint || overlayStatePaint;
      const activeFillStyleClass = isDiverterOverlay || isBinOverlay
        ? ""
        : normalizeIgnitionStyleClassName(activeFillPaint);
      const tagFill = isDiverterOverlay || isBinOverlay
        ? ""
        : activeFillStyleClass
        ? ""
        : normalizeOverlayActiveFillColor(activeFillPaint || overlayStateColor);
      const routeStroke = normalizeActiveLineColor(getRouteStrokeColorForOverlay(overlay));
      const diverterIncomingColor =
        isDiverterOverlay
          ? normalizeActiveLineColor(
              getDirectEntryActiveColorForDiverter(overlay, {
                excludedOverlayIds: [id],
              })
            )
          : "";
      const connectedPolylineColor = isDiverterOverlay
        ? diverterIncomingColor
        : "";
      const diverterFlowColor = isDiverterOverlay
        ? String(connectedPolylineColor || "").trim()
        : "";
      const liveDiverterMode =
        isDiverterOverlay
          ? getEffectiveDiverterState(overlay)
          : "";
      const isFaultSimulated = Boolean(overlay.faultSimulated);
      const compactEType = overlayEType.replace(/[^a-z0-9]/g, "");
      const isConveyorScrew =
        compactEType.includes("conveyorscrew") ||
        (compactEType.includes("conveyor") && compactEType.includes("screw"));
      const faultColor = "#ff3b30";
      const overlayFill = String(overlay?.fill || "").trim();
      const overlayStroke = String(overlay?.stroke || "").trim();
      const overlayStrokeWidth =
        Number.isFinite(Number(overlay?.strokeWidth)) && Number(overlay.strokeWidth) > 0
          ? Number(overlay.strokeWidth)
          : undefined;
      const hasCustomOverlayFill =
        Boolean(overlayFill) && (!preserveStrokeMode || overlayFill.toLowerCase() !== themeFillDefault);
      const hasCustomOverlayStroke =
        Boolean(overlayStroke) && (!preserveStrokeMode || overlayStroke.toLowerCase() !== themeStrokeDefault.toLowerCase());
      const useForcedStroke = String(overlay.strokeMode || "").trim().toLowerCase() === "force";
      const effectiveFillColor = isDiverterOverlay
        ? ""
        : isBinOverlay
        ? ""
        : activeFillStyleClass
        ? ""
        : (tagFill || overlayStateColor || (hasCustomOverlayFill ? overlayFill : themeFillDefault));
      const effectiveStrokeColor = isDiverterOverlay
        ? ""
        : (routeOutlineStroke || (hasCustomOverlayStroke ? overlayStroke : (useForcedStroke ? routeStroke : "")));
      const stateStrokeColor = statePaintsStroke && !activeFillStyleClass
        ? (tagFill || overlayStateColor || "")
        : "";

      if (tagFill) {
        const key = String(overlay.tagPath || overlay.id || "");
        const prev = lastTagColorRef.current.get(key);
        if (prev !== tagFill) {
          lastTagColorRef.current.set(key, tagFill);
        }
      }

      let inner = overlay.inner;

      if (shouldReplaceBinText) {
        inner = replaceSvgTextPlaceholders(inner, {
          product: dynamicBinProductLabel,
          binNo: dynamicBinNameLabel,
        });
      }
      if (
        isBinOverlay &&
        (
          /id=["']BarGraph["']/i.test(String(inner || "")) ||
          /id=["']Lock_Filling["']/i.test(String(inner || "")) ||
          /id=["']Lock_Discharge["']/i.test(String(inner || "")) ||
          /id=["']LockFill["']/i.test(String(inner || "")) ||
          /id=["']LockDischarge["']/i.test(String(inner || ""))
        )
      ) {
        inner = applyBinVisualStateToSvg(inner, {
          ratio: binLevelRatio,
          showFillLock: binLockedIn,
          showDischargeLock: binLockedOut,
        });
      }
      if (isDiverterOverlay) {
        inner = applyDiverterModeToSvg(inner, liveDiverterMode);
      }
      if (isFaultSimulated && !isBinOverlay) {
        inner = inner
          .replace(/fill=['"][^'"]*['"]/gi, `fill="${faultColor}"`)
          .replace(/fill:\s*[^;\"']+/gi, `fill:${faultColor}`);
      }
      if (!isDiverterOverlay) {
        inner = applyOverlayPaintOverrides(inner, {
          fillColor: isFaultSimulated ? "" : effectiveFillColor,
          strokeColor: hasCustomOverlayStroke ? overlayStroke : (isFaultSimulated ? "" : stateStrokeColor),
          strokeWidth: overlayStrokeWidth,
        });
      }
      if (!isDiverterOverlay && activeFillStyleClass && !isFaultSimulated) {
        inner = applyIgnitionStyleClassToSvg(inner, activeFillStyleClass);
      }
      if (!isDiverterOverlay && hasCustomOverlayStroke) {
        inner = forceSvgStrokeColor(inner, overlayStroke);
      }
      if (!isDiverterOverlay && routeOutlineStroke) {
        inner = applyOverlayOuterStrokeColor(inner, routeOutlineStroke);
      }
      if (isDiverterOverlay) {
        inner = applyDiverterFlowColorToSvg(inner, diverterFlowColor, liveDiverterMode, diverterOuterStroke);
      }

      out.set(id, {
        inner,
        className:
          [activeFillStyleClass, isFaultSimulated ? "vizi-svg-fault-flash" : ""].filter(Boolean).join(" ") || undefined,
        style: isDiverterOverlay
          ? {
              pointerEvents: "visiblePainted",
            }
          : {
              fill: activeFillStyleClass ? (hasCustomOverlayFill ? overlayFill : themeFillDefault) : undefined,
              pointerEvents: "visiblePainted",
            },
        isConveyorScrew,
      });
      if (isConveyorScrew) {
        // Keep data shape explicit for future conveyor-specific visual optimizations.
      }
    });
    return out;
  }, [
    overlayRenderOverlays,
    renderLiveVisuals,
    liveRenderTick,
    liveTopologyStressMode,
    effectiveTagStateColorsByPath,
    effectiveRouteStrokeColorByGroupPath,
    routeColorsBySvgKey,
    effectiveSvgLiveValuesByGroupPath,
    ignitionTagValuesByPath,
    binProductLabelByOverlayId,
    binNameLabelByOverlayId,
    binLevelRatioByOverlayId,
    binLockedInByOverlayId,
    binLockedOutByOverlayId,
    overlayHmiStateColorByOverlayId,
    themeStrokeDefault,
  ]);
  const staticOverlayRenderOverlays = useMemo(
    () => overlayRenderOverlays.filter((overlay) => !overlay?.widget && !overlay?.embeddedView),
    [overlayRenderOverlays]
  );
  const widgetOverlayRenderOverlays = useMemo(
    () => overlayRenderOverlays.filter((overlay) => !!overlay?.widget),
    [overlayRenderOverlays]
  );
  const embeddedViewOverlayRenderOverlays = useMemo(
    () => overlayRenderOverlays.filter((overlay) => !!overlay?.embeddedView),
    [overlayRenderOverlays]
  );
  const selectedSingleOverlay = useMemo(
    () => overlayById.get(String(singleSelectedOverlayId || "")) || null,
    [overlayById, singleSelectedOverlayId]
  );
  const staticOverlayNodes = useMemo(
    () =>
      staticOverlayRenderOverlays.map((o) => {
        const overlayVisual = overlayVisualById.get(String(o?.id || "").trim());
        const overlayCursor = isLiveMode
          ? "pointer"
          : (tool === "select" ? "move" : "crosshair");
        return (
          <g
            key={o.id}
            data-overlay-id={o.id}
            onDoubleClick={(e) => handleOverlayDoubleClick(e, o, { force: true })}
          >
            <g
              ref={(node) => applyOverlayNodeRef(o.id, node)}
              transform={`translate(${o.tx} ${o.ty}) scale(${overlayScaleX(o)} ${overlayScaleY(o)})`}
              onMouseDown={(e) => handleOverlayMouseDown(e, o)}
              onDoubleClick={(e) => handleOverlayDoubleClick(e, o)}
              onContextMenu={(e) => onOverlayContextMenu?.(e, o)}
              onMouseEnter={isLineMode ? () => setHoverOverlayId(o.id) : undefined}
              onMouseLeave={isLineMode ? () => setHoverOverlayId((prev) => (prev === o.id ? null : prev)) : undefined}
              style={{
                cursor: overlayCursor,
                pointerEvents: "visiblePainted",
              }}
            >
              <g
                className={overlayVisual?.className}
                style={
                  overlayVisual?.style || {
                    fill: o.fill || "none",
                    stroke: themeStrokeDefault,
                    strokeWidth:
                      Number.isFinite(Number(o.strokeWidth)) && Number(o.strokeWidth) > 0
                        ? Number(o.strokeWidth)
                        : undefined,
                    pointerEvents: "visiblePainted",
                  }
                }
              >
                <g dangerouslySetInnerHTML={{ __html: overlayVisual?.inner ?? String(o.inner || "") }} />
              </g>
            </g>

            {isLineMode && (() => {
              const bb = overlayLocalBBox(o.id);
              if (!bb) return null;
              const wr = overlayWorldRect(o, bb);
              const x = wr.x;
              const y = wr.y;
              const w = wr.w;
              const h = wr.h;
              const cx = x + w / 2;
              const cy = y + h / 2;
              const snapR = 4 * inv;
              const isHover = hoverOverlayId === o.id;
              const stroke = isHover ? "#f79009" : "#2b6cff";
              const fill = isHover ? "rgba(247,144,9,0.18)" : "white";
              return (
                <g pointerEvents="none">
                  <circle cx={cx} cy={y} r={snapR} fill={fill} stroke={stroke} strokeWidth={2 * inv} />
                  <circle cx={x + w} cy={cy} r={snapR} fill={fill} stroke={stroke} strokeWidth={2 * inv} />
                  <circle cx={cx} cy={y + h} r={snapR} fill={fill} stroke={stroke} strokeWidth={2 * inv} />
                  <circle cx={x} cy={cy} r={snapR} fill={fill} stroke={stroke} strokeWidth={2 * inv} />
                </g>
              );
            })()}
          </g>
        );
      }),
    [
      staticOverlayRenderOverlays,
      overlayVisualById,
      isLiveMode,
      liveClickable,
      tool,
      isLineMode,
      themeStrokeDefault,
      applyOverlayNodeRef,
      handleOverlayMouseDown,
      handleOverlayDoubleClick,
      overlayLocalBBox,
      hoverOverlayId,
      inv,
    ]
  );
  const widgetOverlayNodes = useMemo(() => {
    const renderWidget = renderWidgetOverlayRef.current;
    return widgetOverlayRenderOverlays.map((o) => {
      const overlayVisual = overlayVisualById.get(String(o?.id || "").trim());
      const overlayCursor = isLiveMode
        ? (widgetInteractionEnabled ? "pointer" : "default")
        : (tool === "select" ? "move" : "crosshair");
      const widgetBounds = o?.bbox || { x: 0, y: 0, width: 320, height: 180 };
      const showDesignWidgetHitbox = !isLiveMode;
      return (
        <g
          key={o.id}
          data-overlay-id={o.id}
          onDoubleClickCapture={(e) => handleOverlayDoubleClick(e, o, { force: true })}
          onDoubleClick={(e) => handleOverlayDoubleClick(e, o, { force: true })}
        >
          <g
            ref={(node) => applyOverlayNodeRef(o.id, node)}
            transform={`translate(${o.tx} ${o.ty}) scale(${overlayScaleX(o)} ${overlayScaleY(o)})`}
            onMouseDown={(e) => handleOverlayMouseDown(e, o)}
            onDoubleClick={(e) => handleOverlayDoubleClick(e, o)}
            onMouseEnter={isLineMode ? () => setHoverOverlayId(o.id) : undefined}
            onMouseLeave={isLineMode ? () => setHoverOverlayId((prev) => (prev === o.id ? null : prev)) : undefined}
            style={{
              cursor: overlayCursor,
              pointerEvents: "all",
            }}
          >
            {overlayVisual?.widgetFrame ? (
              <g style={{ pointerEvents: "visiblePainted" }}>
                <rect
                  x={overlayVisual.widgetFrame.x}
                  y={overlayVisual.widgetFrame.y}
                  width={overlayVisual.widgetFrame.w}
                  height={overlayVisual.widgetFrame.h}
                  rx={12}
                  fill={overlayVisual.widgetFrame.isCountdownBar ? "transparent" : "var(--bg-elev)"}
                  stroke={overlayVisual.widgetFrame.isCountdownBar ? "none" : "var(--border)"}
                  strokeWidth={2}
                />
              </g>
            ) : null}
            {o.widget && renderWidget ? renderWidget(o) : null}
            {showDesignWidgetHitbox ? (
              <rect
                x={Number(widgetBounds.x) || 0}
                y={Number(widgetBounds.y) || 0}
                width={Math.max(1, Number(widgetBounds.width) || 320)}
                height={Math.max(1, Number(widgetBounds.height) || 180)}
                fill="transparent"
                pointerEvents="all"
                style={{ cursor: overlayCursor }}
                onMouseDown={(e) => handleOverlayMouseDown(e, o)}
                onDoubleClick={(e) => handleOverlayDoubleClick(e, o, { force: true })}
                onMouseEnter={isLineMode ? () => setHoverOverlayId(o.id) : undefined}
                onMouseLeave={isLineMode ? () => setHoverOverlayId((prev) => (prev === o.id ? null : prev)) : undefined}
              />
            ) : null}
          </g>
        </g>
      );
    });
  }, [
    widgetOverlayRenderOverlays,
    overlayVisualById,
    isLiveMode,
    widgetInteractionEnabled,
    tool,
    isLineMode,
    handleOverlayDoubleClick,
    applyOverlayNodeRef,
    handleOverlayMouseDown,
    widgetRenderTick,
    widgetTrendTick,
    widgetBarTick,
    weatherByOverlayId,
    widgetWriteDraftByOverlay,
    widgetWriteBusyByOverlay,
    widgetWriteErrorByOverlay,
    widgetPressByOverlay,
    zoom,
    viewportScale,
    theme,
  ]);
  const embeddedViewOverlayNodes = useMemo(() => {
    return embeddedViewOverlayRenderOverlays.map((o) => {
      const overlayVisual = overlayVisualById.get(String(o?.id || "").trim());
      const overlayCursor = isLiveMode
        ? "default"
        : (tool === "select" ? "move" : "crosshair");
      const embeddedBounds = o?.bbox || { x: 0, y: 0, width: 360, height: 220 };
      const embeddedConfig = o?.embeddedView || {};
      const viewPath = String(embeddedConfig?.viewPath || "").trim();
      const paramsJson = String(embeddedConfig?.paramsJson ?? "{}").trim();
      const runtimeInteractive = embeddedConfig?.runtimeInteractive !== false;
      const interactionEnabled = isLiveMode ? runtimeInteractive : false;
      const showDesignHitbox = !isLiveMode;
      const mountPath = `EV${String(o?.id || "").replace(/[^a-zA-Z0-9_-]+/g, "")}`;

      let parsedParams = {};
      let paramsError = "";
      if (paramsJson) {
        try {
          const nextValue = JSON.parse(paramsJson);
          if (nextValue != null && typeof nextValue === "object" && !Array.isArray(nextValue)) {
            parsedParams = nextValue;
          } else {
            paramsError = "Params must be a JSON object.";
          }
        } catch (error) {
          paramsError = String(error?.message || "Invalid params JSON.");
        }
      }

      const showPerspectiveView =
        Boolean(EmbeddedPerspectiveView)
        && Boolean(perspectiveClientStore)
        && Boolean(viewPath)
        && !paramsError;
      const placeholderTitle = String(o?.name || "Embedded View").trim() || "Embedded View";

      return (
        <g
          key={o.id}
          data-overlay-id={o.id}
          onDoubleClickCapture={(e) => handleOverlayDoubleClick(e, o, { force: true })}
          onDoubleClick={(e) => handleOverlayDoubleClick(e, o, { force: true })}
        >
          <g
            ref={(node) => applyOverlayNodeRef(o.id, node)}
            transform={`translate(${o.tx} ${o.ty})`}
            onMouseDown={!isLiveMode ? (e) => handleOverlayMouseDown(e, o) : undefined}
            onDoubleClick={(e) => handleOverlayDoubleClick(e, o, { force: true })}
            style={{
              cursor: overlayCursor,
              pointerEvents: "all",
            }}
          >
            {overlayVisual?.embeddedViewFrame ? (
              <rect
                x={(overlayVisual.embeddedViewFrame.x) * overlayScaleX(o)}
                y={(overlayVisual.embeddedViewFrame.y) * overlayScaleY(o)}
                width={overlayVisual.embeddedViewFrame.w * overlayScaleX(o)}
                height={overlayVisual.embeddedViewFrame.h * overlayScaleY(o)}
                fill="rgba(15, 23, 42, 0.86)"
              />
            ) : null}
            <foreignObject
              x={(Number(embeddedBounds.x) || 0) * overlayScaleX(o)}
              y={(Number(embeddedBounds.y) || 0) * overlayScaleY(o)}
              width={Math.max(1, (Number(embeddedBounds.width) || 360) * overlayScaleX(o))}
              height={Math.max(1, (Number(embeddedBounds.height) || 220) * overlayScaleY(o))}
              style={{ pointerEvents: interactionEnabled ? "auto" : "none" }}
            >
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  width: "100%",
                  height: "100%",
                  boxSizing: "border-box",
                  overflow: "hidden",
                  pointerEvents: interactionEnabled ? "auto" : "none",
                  background: "rgba(15, 23, 42, 0.2)",
                }}
              >
                {showPerspectiveView ? (
                  <div className="view-parent" style={{ width: "100%", height: "100%" }}>
                    <EmbeddedPerspectiveView
                      store={perspectiveClientStore}
                      resourcePath={viewPath}
                      key={`${mountPath}:${viewPath}:${paramsJson}`}
                      mountPath={mountPath}
                      params={parsedParams}
                      useDefaultWidth={false}
                      useDefaultHeight={false}
                    />
                  </div>
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                      padding: "16px",
                      boxSizing: "border-box",
                      textAlign: "center",
                      color: "#e2e8f0",
                      background: "linear-gradient(180deg, rgba(15, 23, 42, 0.92) 0%, rgba(2, 6, 23, 0.92) 100%)",
                    }}
                  >
                    <div style={{ display: "grid", gap: 8, maxWidth: "100%" }}>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>{placeholderTitle}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(226, 232, 240, 0.74)" }}>
                        {paramsError
                          ? paramsError
                          : viewPath
                            ? viewPath
                            : "Set View Path in properties to load a Perspective view here."}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </foreignObject>
            {showDesignHitbox ? (
              <rect
                x={(Number(embeddedBounds.x) || 0) * overlayScaleX(o)}
                y={(Number(embeddedBounds.y) || 0) * overlayScaleY(o)}
                width={Math.max(1, (Number(embeddedBounds.width) || 360) * overlayScaleX(o))}
                height={Math.max(1, (Number(embeddedBounds.height) || 220) * overlayScaleY(o))}
                fill="transparent"
                pointerEvents="all"
                style={{ cursor: overlayCursor }}
                onMouseDown={(e) => handleOverlayMouseDown(e, o)}
                onDoubleClick={(e) => handleOverlayDoubleClick(e, o, { force: true })}
              />
            ) : null}
          </g>
        </g>
      );
    });
  }, [
    embeddedViewOverlayRenderOverlays,
    overlayVisualById,
    isLiveMode,
    tool,
    handleOverlayDoubleClick,
    applyOverlayNodeRef,
    handleOverlayMouseDown,
    EmbeddedPerspectiveView,
    perspectiveClientStore,
  ]);
  const tagBubbleLayer = useMemo(() => {
    if (!showTagPaths || interactionActive) return null;
    const includeLiveOverlayLines = renderLiveVisuals;
    return (
      <g>
        {shapes.map((s) => {
          const text = String(s.tagPath || "").trim();
          if (!text) return null;
          if (hiddenBubbleSet.has(s.id)) return null;
          const lines = [text];
          const yOffset = 0;
          if (s.type === "text") {
            const x = Number(s.x ?? 0);
            const anchorY = Number(s.y ?? 0);
            return renderTagBubble({
              key: `tag-${s.id}`,
              bubbleId: s.id,
              x,
              anchorY: anchorY + yOffset,
              lines,
              anchor: "start",
            });
          }
          if (s.type === "rect" || s.type === "circle") {
            const x = Number(s.x ?? 0) + Math.max(0, Number(s.width ?? 0)) / 2;
            const anchorY = Number(s.y ?? 0) + Math.max(0, Number(s.height ?? 0)) / 2 + yOffset;
            return renderTagBubble({
              key: `tag-${s.id}`,
              bubbleId: s.id,
              x,
              anchorY,
              lines,
              anchor: "middle",
            });
          }
          if (Array.isArray(s.points) && s.type !== "polyline") {
            const bb = bboxOfPoints(s.points);
            if (!bb) return null;
            const x = bb.minX + bb.w / 2;
            return renderTagBubble({
              key: `tag-${s.id}`,
              bubbleId: s.id,
              x,
              anchorY: bb.minY + yOffset,
              lines,
              anchor: "middle",
            });
          }
          return null;
        })}
        {overlayRenderOverlays.map((o) => {
          if (o?.embeddedView) return null;
          if (hiddenBubbleSet.has(o.id)) return null;
          const text = getOverlayGroupLabel(o);
          const lines = [];
          if (text) lines.push(text);
          if (includeLiveOverlayLines) {
            const live = getLiveValuesForOverlay(o);
            const groupLive = getGroupRouteStateForTagPath(o?.tagPath);
            if (live?.routeId || groupLive.routeId) {
              lines.push(`RouteID: ${live?.routeId || groupLive.routeId}`);
            }
            if (live?.state || groupLive.state) {
              lines.push(`State: ${live?.state || groupLive.state}`);
            }
          }
          if (!lines.length) return null;
          const bb = o?.bbox || overlayLocalBBox(o.id);
          if (!bb) return null;
          const sx = overlayScaleX(o);
          const sy = overlayScaleY(o);
          const x = o.tx + sx * (bb.x + bb.width / 2);
          const anchorY = o.ty + sy * (bb.y + bb.height / 2);
          return renderTagBubble({
            key: `tag-${o.id}`,
            bubbleId: o.id,
            x,
            anchorY,
            lines,
            anchor: "middle",
          });
        })}
      </g>
    );
  }, [
    showTagPaths,
    interactionActive,
    renderLiveVisuals,
    shapes,
    hiddenBubbleSet,
    overlayRenderOverlays,
    liveRenderTick,
    effectiveSvgLiveValuesByGroupPath,
    routeColorsBySvgKey,
    liveLookupKeyList,
    inv,
    onHideTagBubble,
  ]);
  const overlayModeBadgeLayer = useMemo(() => {
    if (!renderLiveVisuals || interactionActive || !overlayRenderOverlays.length) {
      return null;
    }
    return (
      <g>
        {overlayRenderOverlays.map((o) => {
          if (o?.widget) return null;
          const overlayModeState = getOverlayModeState(o);
          if (overlayModeState !== "manual" && overlayModeState !== "maintenance") return null;
          const bb = o?.bbox || overlayLocalBBox(o.id);
          if (!bb) return null;
          const wr = overlayWorldRect(o, bb);
          const isMaintenance = overlayModeState === "maintenance";
          const bubbleR = 9 * inv;
          const bubbleCx = wr.x + wr.w + 12 * inv;
          const bubbleCy = wr.y + 10 * inv;
          const anchorX = wr.x + wr.w;
          const anchorY = wr.y + Math.max(6 * inv, Math.min(wr.h - 6 * inv, 10 * inv));
          const dx = bubbleCx - anchorX;
          const dy = bubbleCy - anchorY;
          const dist = Math.max(1e-6, Math.hypot(dx, dy));
          const ux = dx / dist;
          const uy = dy / dist;
          const lineEndX = bubbleCx - ux * bubbleR;
          const lineEndY = bubbleCy - uy * bubbleR;
          return (
            <g key={`overlay-mode-badge-${o.id}`} pointerEvents="none" aria-hidden="true">
              <line
                x1={anchorX}
                y1={anchorY}
                x2={lineEndX}
                y2={lineEndY}
                stroke={isMaintenance ? "#b45309" : "#7e22ce"}
                strokeWidth={1.35 * inv}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={bubbleCx}
                cy={bubbleCy}
                r={bubbleR}
                fill={isMaintenance ? "rgba(255,247,237,0.98)" : "rgba(255,255,255,0.95)"}
                stroke={isMaintenance ? "#f59e0b" : "#a855f7"}
                strokeWidth={1.25 * inv}
                vectorEffect="non-scaling-stroke"
              />
              <g
                transform={`translate(${bubbleCx} ${bubbleCy}) scale(${0.6 * inv}) translate(-12 -12)`}
                fill="none"
                stroke={isMaintenance ? "#b45309" : "#7e22ce"}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {isMaintenance ? (
                  <>
                    <path d="M20 4.5 14.2 10.3" />
                    <path d="M10.2 14.3 4.2 20.3 2.7 18.8l6-6" />
                    <path d="M14.8 7.2a4.1 4.1 0 0 1-5.6 5.6l-2.6 2.6a1.8 1.8 0 0 0 2.5 2.5l2.6-2.6a4.1 4.1 0 0 1 5.6-5.6l3.2-3.2-2.5-2.5-3.2 3.2Z" />
                  </>
                ) : (
                  <>
                    <path d="M7.5 12.8V6.6a1.2 1.2 0 0 1 2.4 0v4.5" />
                    <path d="M9.9 11.7V5.8a1.2 1.2 0 0 1 2.4 0v5.3" />
                    <path d="M12.3 11.4V6.5a1.2 1.2 0 0 1 2.4 0v5.1" />
                    <path d="M14.7 12V8.2a1.2 1.2 0 0 1 2.4 0v6.1c0 3-2.2 5.1-5.2 5.1h-1.8c-3.2 0-5.6-2.3-5.6-5.4v-2.2a1.2 1.2 0 0 1 2.4 0v1" />
                  </>
                )}
              </g>
            </g>
          );
        })}
      </g>
    );
  }, [
    renderLiveVisuals,
    interactionActive,
    overlayRenderOverlays,
    liveRenderTick,
    effectiveSvgLiveValuesByGroupPath,
    ignitionTagValuesByPath,
    liveLookupKeyList,
    overlayLocalBBox,
    inv,
  ]);
  const overlayIndicatorLayer = useMemo(() => {
    if (liveTopologyStressMode || interactionActive || !overlayRenderOverlays.length) {
      return null;
    }
    return (
      <g>
        {overlayRenderOverlays.map((o) => {
          if (o?.embeddedView) return null;
          const overlayId = String(o?.id || "").trim();
          const connectionIssue = renderLiveVisuals && overlayId
            ? overlayConnectionIssueByOverlayId?.[overlayId]
            : null;
          const connectionWarning = String(connectionIssue?.message || "").trim();
          const connectionPath = String(connectionIssue?.path || "").trim();
          const connectionQuality = String(connectionIssue?.quality || "").trim();
          const connectionError = String(connectionIssue?.error || "").trim();
          const overlayTagPath = String(o?.tagPath || "").trim();
          const overlayEType = String(o?.eType || o?.name || "").trim();
          const widgetKind = String(o?.widget?.kind || "").trim().toLowerCase();
          const widgetBarMode = String(o?.widget?.barSourceMode || "table").trim().toLowerCase();
          const widgetUsesSeriesTags =
            widgetKind === "linechart" ||
            widgetKind === "line_chart" ||
            widgetKind === "line-chart" ||
            ((widgetKind === "barchart" || widgetKind === "bar_chart" || widgetKind === "bar-chart") &&
              widgetBarMode === "tags");
          const widgetSeriesTags = widgetUsesSeriesTags
            ? parseWidgetSeriesTags(o).filter((tp) => !String(tp || "").toLowerCase().startsWith("db:"))
            : [];
          const isBinOverlay = String(overlayEType || "").trim().toLowerCase().startsWith("bin");
          const hasBinDbBinding =
            !!String(o?.binBindingKey || "").trim() ||
            !!String(binNameLabelByOverlayId?.[String(o?.id || "")] || "").trim() ||
            !!String(binProductLabelByOverlayId?.[String(o?.id || "")] || "").trim();
          const designTagWarning = renderLiveVisuals
            ? ""
            : isBinOverlay
              ? hasBinDbBinding
                ? ""
                : "Bin not bound to database row"
              : widgetUsesSeriesTags
              ? !widgetSeriesTags.length
                ? "Widget series tags missing"
                : ""
              : !overlayTagPath
              ? "SVG not tagged"
              : !hasKnownOverlayTagPath(overlayTagPath)
              ? "Bad tag mapping"
              : "";
          const overlayTagWarning = connectionWarning || designTagWarning;
          if (!overlayTagWarning) return null;
          const bb = o?.bbox || overlayLocalBBox(o.id);
          if (!bb) return null;
          const wr = overlayWorldRect(o, bb);
          const isConnectionWarning = Boolean(connectionWarning);
          const badgeStroke = isConnectionWarning ? "#dc2626" : "#ef4444";
          const badgeFill = isConnectionWarning ? "rgba(254,242,242,0.98)" : "rgba(255,245,245,0.98)";
          const badgeText = isConnectionWarning ? "!" : "!";
          const titlePath = connectionPath || overlayTagPath || "-";
          const titleDetail = isConnectionWarning
            ? [
                connectionQuality ? `Quality: ${connectionQuality}` : "",
                connectionError ? `Error: ${connectionError}` : "",
              ].filter(Boolean).join(" | ")
            : "";
          const r = 8 * inv;
          const cx = wr.x + wr.w + 12 * inv;
          const cy = wr.y + Math.max(10 * inv, r + 1 * inv);
          const anchorX = wr.x + wr.w;
          const anchorY = wr.y + Math.max(r, Math.min(wr.h - r, 10 * inv));
          const dx = cx - anchorX;
          const dy = cy - anchorY;
          const dist = Math.max(1e-6, Math.hypot(dx, dy));
          const ux = dx / dist;
          const uy = dy / dist;
          const lineEndX = cx - ux * r;
          const lineEndY = cy - uy * r;
          return (
            <g key={`overlay-warning-badge-${o.id}`} pointerEvents="none" aria-hidden="true">
              <line
                x1={anchorX}
                y1={anchorY}
                x2={lineEndX}
                y2={lineEndY}
                stroke={badgeStroke}
                strokeWidth={1.15 * inv}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={badgeFill}
                stroke={badgeStroke}
                strokeWidth={1.2 * inv}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={cx}
                y={cy + 0.5 * inv}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#b91c1c"
                fontSize={10 * inv}
                fontWeight={900}
                pointerEvents="none"
              >
                {badgeText}
              </text>
              <title>{`${overlayTagWarning}: ${titlePath}${titleDetail ? ` (${titleDetail})` : ""}`}</title>
            </g>
          );
        })}
      </g>
    );
  }, [
    renderLiveVisuals,
    liveTopologyStressMode,
    interactionActive,
    overlayRenderOverlays,
    binNameLabelByOverlayId,
    binProductLabelByOverlayId,
    knownOverlayTagPaths,
    overlayConnectionIssueByOverlayId,
    inv,
  ]);
  const handleDelegatedShapeMouseDown = useCallback((e) => {
    const hit = e.target.closest("[data-shape-id]");
    if (!hit) return;
    const id = hit.getAttribute("data-shape-id");
    if (id) onShapeMouseDown(e, id);
  }, [onShapeMouseDown]);
  const handleDelegatedShapeDoubleClick = useCallback((e) => {
    const hit = e.target.closest("[data-shape-id]");
    if (!hit) return;
    const id = hit.getAttribute("data-shape-id");
    if (!id) return;
    if (id === editingId) {
      onEditPolylineClick?.(e, id);
    } else {
      onShapeDoubleClick(e, id);
    }
  }, [editingId, onEditPolylineClick, onShapeDoubleClick]);
  const handleDelegatedShapeContextMenu = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const hit = e.target.closest("[data-shape-id]");
    const id = hit?.getAttribute("data-shape-id");
    if (id && tool === "select") {
      setSelectedIds?.([id]);
      setSelectedOverlayIds?.([]);
    }
    onContextMenu?.(e);
  }, [tool, setSelectedIds, setSelectedOverlayIds, onContextMenu]);
  const staticShapeNodes = useMemo(
    () =>
      (Array.isArray(shapes) ? shapes : []).map((s) => {
        const dynamicColor = getTagColor(s.tagPath);

        if (s.type === "text") {
          const isInline = inlineEditId === s.id;
          const displayText = getTextShapeValueForShape(s);
          return (
            <g key={s.id} data-shape-id={s.id}>
              {(() => {
                const tb = getTextBounds(s);
                if (!tb) return null;
                return (
                  <rect
                    x={tb.x - 6}
                    y={tb.y - 6}
                    width={tb.w + 12}
                    height={tb.h + 12}
                    fill="rgba(0,0,0,0.001)"
                    pointerEvents="all"
                  />
                );
              })()}
              <text
                x={s.x}
                y={s.y}
                fill={
                  dynamicColor ||
                  (theme === "dark" && (!s.fill || ["#808080", "#d7dade"].includes(String(s.fill).toLowerCase()))
                    ? "#ffffff"
                    : s.fill || "#D7DADE")
                }
                fontSize={s.fontSize || 24}
                fontFamily={s.fontFamily || "system-ui"}
                fontWeight={s.fontWeight || "400"}
                textAnchor={s.anchor || "start"}
                dominantBaseline="text-before-edge"
                style={{ userSelect: "none", visibility: isInline ? "hidden" : "visible" }}
              >
                {displayText}
              </text>
            </g>
          );
        }

        if (s.type === "rect") {
          const rx = Number(s.x ?? 0);
          const ry = Number(s.y ?? 0);
          const rw = Math.max(0, Number(s.width ?? 0));
          const rh = Math.max(0, Number(s.height ?? 0));
          const lineStyle = s.lineStyle ?? "solid";
          const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
          const stroke = dynamicColor || (isDarkTheme ? "#ffffff" : themeStrokeDefault);
          const fill = s.fill ?? "transparent";

          return (
            <g key={s.id} data-shape-id={s.id}>
              <rect
                x={rx - 6}
                y={ry - 6}
                width={rw + 12}
                height={rh + 12}
                fill="rgba(0,0,0,0.001)"
                pointerEvents="all"
              />
              <rect
                x={rx}
                y={ry}
                width={rw}
                height={rh}
                fill={fill}
                stroke={stroke}
                strokeWidth={s.strokeWidth}
                {...styleProps}
                strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                strokeLinecap={styleProps.strokeLinecap ?? "round"}
                vectorEffect="non-scaling-stroke"
                pointerEvents="auto"
              />
            </g>
          );
        }

        if (s.type === "circle") {
          const rx = Number(s.x ?? 0);
          const ry = Number(s.y ?? 0);
          const rw = Math.max(0, Number(s.width ?? 0));
          const rh = Math.max(0, Number(s.height ?? 0));
          const cx = rx + rw / 2;
          const cy = ry + rh / 2;
          const erx = rw / 2;
          const ery = rh / 2;
          const lineStyle = s.lineStyle ?? "solid";
          const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
          const stroke = dynamicColor || (isDarkTheme ? "#ffffff" : themeStrokeDefault);
          const fill = s.fill ?? "transparent";

          return (
            <g key={s.id} data-shape-id={s.id}>
              <rect
                x={rx - 6}
                y={ry - 6}
                width={rw + 12}
                height={rh + 12}
                fill="rgba(0,0,0,0.001)"
                pointerEvents="all"
              />
              <ellipse
                cx={cx}
                cy={cy}
                rx={erx}
                ry={ery}
                fill={fill}
                stroke={stroke}
                strokeWidth={s.strokeWidth}
                {...styleProps}
                strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                strokeLinecap={styleProps.strokeLinecap ?? "round"}
                vectorEffect="non-scaling-stroke"
                pointerEvents="auto"
              />
            </g>
          );
        }

        const lineStyle = s.lineStyle ?? "solid";
        const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
        const arrowStart = s.arrowStart ?? "none";
        const arrowEnd = s.arrowEnd ?? "none";
        const ptsForDisplay = pointsForMarker(s.points);
        const polyFillRaw = String(s.fill ?? "").trim().toLowerCase();
        const polyFill =
          !polyFillRaw || polyFillRaw === "none" || polyFillRaw === "transparent"
            ? "none"
            : String(s.fill);
        const resolvedPolylineStroke = normalizeActiveLineColor(
          getPolylineDisplayedColor(s, { includeThemeDefault: false })
        );
        const activeStrokeColor = resolvedPolylineStroke;
        const splitCarrySegments =
          !activeStrokeColor && liveCanvasEnabled
            ? getWorkerResolvedPolylineSplitCarrySegments(s?.id)
            : [];
        const renderSplitCarry =
          !activeStrokeColor &&
          Array.isArray(splitCarrySegments) &&
          splitCarrySegments.length > 0;

        return (
          <g key={s.id} data-shape-id={s.id}>
            <polyline
              points={pointsToAttr(s.points)}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(16, (s.strokeWidth || 3) * 5)}
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="auto"
            />
            <polyline
              points={pointsToAttr(ptsForDisplay)}
              fill={polyFill}
              stroke={activeStrokeColor || (isDarkTheme ? "#ffffff" : themeStrokeDefault)}
              strokeWidth={s.strokeWidth}
              {...styleProps}
              strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
              strokeLinecap={styleProps.strokeLinecap ?? "round"}
              markerStart={markerForStart(arrowStart)}
              markerEnd={markerForEnd(arrowEnd)}
              pointerEvents="auto"
            />
            {renderSplitCarry ? (
              <>
                {splitCarrySegments.map((segment, idx) => {
                  const segStroke = normalizeActiveLineColor(segment?.color);
                  if (!segStroke) return null;
                  return (
                    <polyline
                      key={`${s.id}-split-carry-${idx}`}
                      points={pointsToAttr(segment.points)}
                      fill="none"
                      stroke={segStroke}
                      strokeWidth={s.strokeWidth}
                      {...styleProps}
                      strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                      strokeLinecap={styleProps.strokeLinecap ?? "round"}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                    />
                  );
                })}
              </>
            ) : null}
          </g>
        );
      }),
    [
      shapes,
      svgOverlays,
      ignitionTagValuesByPath,
      inlineEditId,
      theme,
      isDarkTheme,
      themeStrokeDefault,
      liveTopologyStressMode,
      isLiveMode,
      liveRenderTick,
      effectiveTagStateColorsByPath,
      effectiveRouteStrokeColorByGroupPath,
      effectiveSvgLiveValuesByGroupPath,
    ]
  );
  const activeShapeNodes = useMemo(() => {
    const selectedIdSet = selectedShapeIdSet;
    const activeIds = [];
    const seen = new Set();
    (Array.isArray(selectedIds) ? selectedIds : []).forEach((id) => {
      const key = String(id || "").trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      activeIds.push(key);
    });
    const editingKey = String(editingId || "").trim();
    if (editingKey && !seen.has(editingKey)) {
      seen.add(editingKey);
      activeIds.push(editingKey);
    }
    if (!activeIds.length) return null;
    return activeIds.map((activeId) => {
      const s = shapeById.get(activeId);
      if (!s) return null;
      const isSelected = selectedIdSet.has(s.id);
      const isEditing = s.id === editingId;
      if (!isSelected && !isEditing) return null;

      if (s.type === "rect") {
        if (!isSelected) return null;
        const rx = Number(s.x ?? 0);
        const ry = Number(s.y ?? 0);
        const rw = Math.max(0, Number(s.width ?? 0));
        const rh = Math.max(0, Number(s.height ?? 0));
        const lineStyle = s.lineStyle ?? "solid";
        const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
        return (
          <rect
            key={`active-shape-${s.id}`}
            data-active-shape-id={s.id}
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill="none"
            stroke="#2b6cff"
            strokeWidth={s.strokeWidth}
            {...styleProps}
            strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
            strokeLinecap={styleProps.strokeLinecap ?? "round"}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        );
      }

      if (s.type === "circle") {
        if (!isSelected) return null;
        const rx = Number(s.x ?? 0);
        const ry = Number(s.y ?? 0);
        const rw = Math.max(0, Number(s.width ?? 0));
        const rh = Math.max(0, Number(s.height ?? 0));
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;
        const erx = rw / 2;
        const ery = rh / 2;
        const lineStyle = s.lineStyle ?? "solid";
        const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
        return (
          <ellipse
            key={`active-shape-${s.id}`}
            data-active-shape-id={s.id}
            cx={cx}
            cy={cy}
            rx={erx}
            ry={ery}
            fill="none"
            stroke="#2b6cff"
            strokeWidth={s.strokeWidth}
            {...styleProps}
            strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
            strokeLinecap={styleProps.strokeLinecap ?? "round"}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        );
      }

      if (s.type === "text") {
        return null;
      }

      if (isEditing) {
        return null;
      }

      const lineStyle = s.lineStyle ?? "solid";
      const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
      const arrowStart = s.arrowStart ?? "none";
      const arrowEnd = s.arrowEnd ?? "none";
      const ptsForDisplay = pointsForMarker(s.points);
      const selectionHaloWidth = Math.max((Number(s.strokeWidth) || 3) + 6, (Number(s.strokeWidth) || 3) * 2.5);
      return (
        <g key={`active-shape-${s.id}`} data-active-shape-id={s.id}>
          {isSelected ? (
            <polyline
              points={pointsToAttr(ptsForDisplay)}
              fill="none"
              stroke="rgba(43,108,255,0.45)"
              strokeWidth={selectionHaloWidth}
              {...styleProps}
              strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
              strokeLinecap={styleProps.strokeLinecap ?? "round"}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
          {isEditing ? (
            <>
              {selectedSegment?.id === s.id &&
                selectedSegment.kind === "point" &&
                Array.isArray(s.points) &&
                (() => {
                  const idx = selectedSegment.index;
                  if (idx < 0 || idx >= s.points.length) return null;
                  const p = s.points[idx];
                  return (
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={Math.max(10, (s.strokeWidth || 3) * 3)}
                      fill="rgba(43,108,255,0.18)"
                      stroke="#2b6cff"
                      strokeWidth={2}
                      pointerEvents="none"
                    />
                  );
                })()}
              {Array.isArray(s.points)
                ? s.points.slice(0, -1).map((pt, idx) => {
                    const nextPt = s.points[idx + 1];
                    if (!nextPt) return null;
                    return (
                      <line
                        key={`${s.id}-segment-hit-${idx}`}
                        x1={pt.x}
                        y1={pt.y}
                        x2={nextPt.x}
                        y2={nextPt.y}
                        stroke="transparent"
                        strokeWidth={Math.max(18, (s.strokeWidth || 3) * 5)}
                        strokeLinecap="round"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          onSegmentMouseDown?.(e, s.id, idx);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          onEditPolylineClick?.(e, s.id);
                        }}
                        style={{ cursor: "pointer" }}
                      />
                    );
                  })
                : null}
              {Array.isArray(s.points)
                ? s.points.map((pt, idx) => (
                    <g key={`${s.id}-h-${idx}`}>
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={HANDLE_R}
                        fill={
                          selectedSegment?.id === s.id &&
                          selectedSegment.kind === "point" &&
                          selectedSegment.index === idx
                            ? "#e8f0ff"
                            : "white"
                        }
                        stroke="#2b6cff"
                        strokeWidth={HANDLE_STROKE}
                      />
                      <circle cx={pt.x} cy={pt.y} r={DOT_R} fill="#2b6cff" />
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={HIT_R}
                        fill="transparent"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          onHandleMouseDown(e, s.id, idx);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          onHandleDoubleClick(e, s.id, idx);
                        }}
                        onContextMenu={(e) => {
                          e.stopPropagation();
                          onHandleContextMenu?.(e, s.id, idx);
                        }}
                        style={{ cursor: "grab" }}
                      />
                    </g>
                  ))
                : null}
            </>
          ) : null}
        </g>
      );
    });
  }, [
    selectedIds,
    shapeById,
    selectedShapeIdSet,
    svgOverlays,
    ignitionTagValuesByPath,
    editingId,
    selectedSegment,
    theme,
    isDarkTheme,
    themeStrokeDefault,
    isLiveMode,
    liveTopologyStressMode,
    liveRenderTick,
    effectiveTagStateColorsByPath,
    effectiveRouteStrokeColorByGroupPath,
    effectiveSvgLiveValuesByGroupPath,
    onEditPolylineClick,
    onHandleMouseDown,
    onHandleDoubleClick,
    onHandleContextMenu,
    onSegmentMouseDown,
  ]);
  const activeEditingPolylineNodes = useMemo(() => {
    const editingKey = String(editingId || "").trim();
    if (!editingKey) return null;
    const s = shapeById.get(editingKey);
    if (!s || s.type !== "polyline") return null;
    const isSelected = selectedShapeIdSet.has(s.id);
    const lineStyle = s.lineStyle ?? "solid";
    const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
    const arrowStart = s.arrowStart ?? "none";
    const arrowEnd = s.arrowEnd ?? "none";
    const ptsForDisplay = pointsForMarker(s.points);
    const selectionHaloWidth = Math.max((Number(s.strokeWidth) || 3) + 6, (Number(s.strokeWidth) || 3) * 2.5);
    return (
      <g key={`active-editing-polyline-${s.id}`}>
        {isSelected ? (
          <polyline
            points={pointsToAttr(ptsForDisplay)}
            fill="none"
            stroke="rgba(43,108,255,0.45)"
            strokeWidth={selectionHaloWidth}
            {...styleProps}
            strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
            strokeLinecap={styleProps.strokeLinecap ?? "round"}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        ) : null}
        {selectedSegment?.id === s.id &&
          selectedSegment.kind === "point" &&
          Array.isArray(s.points) &&
          (() => {
            const idx = selectedSegment.index;
            if (idx < 0 || idx >= s.points.length) return null;
            const p = s.points[idx];
            return (
              <circle
                cx={p.x}
                cy={p.y}
                r={Math.max(10, (s.strokeWidth || 3) * 3)}
                fill="rgba(43,108,255,0.18)"
                stroke="#2b6cff"
                strokeWidth={2}
                pointerEvents="none"
              />
            );
          })()}
        {Array.isArray(s.points)
          ? s.points.slice(0, -1).map((pt, idx) => {
              const nextPt = s.points[idx + 1];
              if (!nextPt) return null;
              return (
                <line
                  key={`${s.id}-active-segment-hit-${idx}`}
                  x1={pt.x}
                  y1={pt.y}
                  x2={nextPt.x}
                  y2={nextPt.y}
                  stroke="transparent"
                  strokeWidth={Math.max(18, (s.strokeWidth || 3) * 5)}
                  strokeLinecap="round"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onSegmentMouseDown?.(e, s.id, idx);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onEditPolylineClick?.(e, s.id);
                  }}
                  style={{ cursor: "pointer" }}
                />
              );
            })
          : null}
        {Array.isArray(s.points)
          ? s.points.map((pt, idx) => (
              <g key={`${s.id}-overlay-h-${idx}`}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={HANDLE_R}
                  fill={
                    selectedSegment?.id === s.id &&
                    selectedSegment.kind === "point" &&
                    selectedSegment.index === idx
                      ? "#e8f0ff"
                      : "white"
                  }
                  stroke="#2b6cff"
                  strokeWidth={HANDLE_STROKE}
                />
                <circle cx={pt.x} cy={pt.y} r={DOT_R} fill="#2b6cff" />
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={HIT_R}
                  fill="transparent"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    onHandleMouseDown(e, s.id, idx);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onHandleDoubleClick(e, s.id, idx);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    onHandleContextMenu?.(e, s.id, idx);
                  }}
                  style={{ cursor: "grab" }}
                />
              </g>
            ))
          : null}
      </g>
    );
  }, [
    editingId,
    shapeById,
    selectedShapeIdSet,
    svgOverlays,
    ignitionTagValuesByPath,
    selectedSegment,
    theme,
    isDarkTheme,
    themeStrokeDefault,
    isLiveMode,
    liveTopologyStressMode,
    liveRenderTick,
    effectiveTagStateColorsByPath,
    effectiveRouteStrokeColorByGroupPath,
    effectiveSvgLiveValuesByGroupPath,
    onEditPolylineClick,
    onHandleMouseDown,
    onHandleDoubleClick,
    onHandleContextMenu,
    onSegmentMouseDown,
  ]);

  return (
    <div
      style={{
        position: absoluteViewportLayout ? "absolute" : "relative",
        top: absoluteViewportLayout ? viewportTopOffset : undefined,
        left: absoluteViewportLayout ? viewportShiftX : undefined,
        right: absoluteViewportLayout ? 0 : undefined,
        bottom: absoluteViewportLayout ? 0 : undefined,
        width: absoluteViewportLayout ? undefined : "100%",
        height: absoluteViewportLayout ? undefined : "100%",
        minWidth: 0,
        minHeight: 0,
        flex: absoluteViewportLayout ? undefined : "1 1 auto",
        alignSelf: absoluteViewportLayout ? undefined : "stretch",
        userSelect: "none",
        transition: absoluteViewportLayout ? "left 280ms cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
        willChange: absoluteViewportLayout ? "left" : undefined,
      }}
    >
      <div
        ref={wrapRef}
        className="vizi-scroll"
        onScroll={(e) => {
          const target = e.currentTarget;
          if (scrollThrottleRef.current) return;
          scrollThrottleRef.current = requestAnimationFrame(() => {
            scrollThrottleRef.current = null;
            const next = {
              x: Number(target?.scrollLeft || 0),
              y: Number(target?.scrollTop || 0),
            };
            setViewportScroll(next);
            if (typeof onViewportScroll === "function") {
              onViewportScroll({ x: next.x, y: next.y });
            }
          });
        }}
        onDoubleClickCapture={(e) => {
          onCanvasDoubleClick?.(e);
        }}
        style={{
          position: "absolute",
          inset: 0,
          overflowX: "auto",
          overflowY: "hidden",
          scrollbarGutter: "stable",
          paddingRight: rightEdgeReserve,
          paddingBottom: bottomEdgeReserve,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            position: "relative",
            width: stageW,
            height: stageH,
          }}
        >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: rulerSize,
          right: rulerSize + rightEdgeReserve,
          bottom: bottomEdgeReserve,
          overflow: "hidden",
          background: canvasBackgroundColor || "var(--canvas-bg)",
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={vb}
          preserveAspectRatio={preserveAspectRatioMode}
          data-canvas-zoom-root="true"
          ref={svgRef}
          tabIndex={0}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            display: "block",
            width: "100%",
            height: "100%",
            minWidth: "100%",
            minHeight: "100%",
            outline: "none",
            cursor: isCrosshair ? "crosshair" : "default",
          }}
          onWheel={onWheel}
          onMouseDown={onSvgMouseDown}
          onMouseMove={useWindowPointerTracking ? undefined : onMouseMove}
          onMouseUp={useWindowPointerTracking ? undefined : onMouseUp}
          // ✅ NEW: forward dblclick on main svg (finish line in App)
          onDoubleClick={(e) => {
            const target = e.target;
            const hit = target?.closest?.("[data-overlay-id]");
            if (hit) {
              const id = hit.getAttribute("data-overlay-id");
              if (id) {
                onOverlayDoubleClick?.(e, id);
                return;
              }
            }
            onSvgDoubleClick?.(e);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu?.(e);
          }}
        >
          <defs>
            <marker
              id="arrow-fwd"
              viewBox="0 0 10 10"
              refX="2"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L10,5 L0,10 Z" fill="context-stroke" />
            </marker>

            <marker
              id="arrow-rev"
              viewBox="0 0 10 10"
              refX="2"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M10,0 L0,5 L10,10 Z" fill="context-stroke" />
            </marker>
          </defs>

          <g transform={`translate(${panX} ${panY}) scale(${z})`}>
            {showGrid && (
              <path
                d={gridPathD}
                fill="none"
                stroke="#d0d0d0"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}

            {importAnchor && (
              <g pointerEvents="none">
                <circle
                  cx={importAnchor.x}
                  cy={importAnchor.y}
                  r={10}
                  fill="rgba(43,108,255,0.12)"
                  stroke="#2b6cff"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={importAnchor.x - 16}
                  y1={importAnchor.y}
                  x2={importAnchor.x + 16}
                  y2={importAnchor.y}
                  stroke="#2b6cff"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={importAnchor.x}
                  y1={importAnchor.y - 16}
                  x2={importAnchor.x}
                  y2={importAnchor.y + 16}
                  stroke="#2b6cff"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}

            {/* Single delegated container: replaces N per-shape inline handlers with 3 stable handlers */}
            <g
              style={{ cursor: isLiveMode ? "default" : tool === "select" ? "move" : "crosshair" }}
              onMouseDown={handleDelegatedShapeMouseDown}
              onDoubleClick={handleDelegatedShapeDoubleClick}
              onContextMenu={handleDelegatedShapeContextMenu}
            >
              {staticShapeNodes}
              {activeShapeNodes}
              {false ? (
                shapes.map((s) => {
              const isSelected = selectedShapeIdSet.has(s.id);
              const isEditing = s.id === editingId;
              const dynamicColor = getTagColor(s.tagPath);

              if (s.type === "text") {
                const isInline = inlineEditId === s.id;
                const textCursor = isLiveMode
                  ? "default"
                  : tool === "select"
                  ? "move"
                  : "crosshair";

                return (
                  <g
                    key={s.id}
                    data-shape-id={s.id}
                    data-drag-selected-shape={isSelected ? "1" : undefined}
                  >
                    {/* Invisible hitbox so events fire anywhere over text bounds */}
                    {(() => {
                      const tb = getTextBounds(s);
                      if (!tb) return null;
                      return (
                        <rect
                          x={tb.x - 6}
                          y={tb.y - 6}
                          width={tb.w + 12}
                          height={tb.h + 12}
                          fill="rgba(0,0,0,0.001)"
                          pointerEvents="all"
                        />
                      );
                    })()}
                    <text
                      x={s.x}
                      y={s.y}
                      fill={
                        dynamicColor ||
                        (theme === "dark" && (!s.fill || ["#808080", "#d7dade"].includes(String(s.fill).toLowerCase()))
                          ? "#ffffff"
                          : s.fill || "#D7DADE")
                      }
                      fontSize={s.fontSize || 24}
                      fontFamily={s.fontFamily || "system-ui"}
                      fontWeight={s.fontWeight || "400"}
                      textAnchor={s.anchor || "start"}
                      dominantBaseline="text-before-edge"
                      style={{ userSelect: "none", visibility: isInline ? "hidden" : "visible" }}
                    >
                      {s.text || ""}
                    </text>

                    {/* Selection box is rendered centrally via shapeSelectionUI to avoid duplicates */}
                  </g>
                );
              }

              if (s.type === "rect") {
                const rx = Number(s.x ?? 0);
                const ry = Number(s.y ?? 0);
                const rw = Math.max(0, Number(s.width ?? 0));
                const rh = Math.max(0, Number(s.height ?? 0));
                const lineStyle = s.lineStyle ?? "solid";
                const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
                const stroke =
                  isSelected
                    ? "#2b6cff"
                    : dynamicColor || (isDarkTheme ? "#ffffff" : themeStrokeDefault);
                const fill = s.fill ?? "transparent";

                return (
                  <g key={s.id} data-shape-id={s.id} data-drag-selected-shape={isSelected ? "1" : undefined}>
                    <rect
                      x={rx - 6}
                      y={ry - 6}
                      width={rw + 12}
                      height={rh + 12}
                      fill="rgba(0,0,0,0.001)"
                      pointerEvents="all"
                    />
                    <rect
                      x={rx}
                      y={ry}
                      width={rw}
                      height={rh}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={s.strokeWidth}
                      {...styleProps}
                      strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                      strokeLinecap={styleProps.strokeLinecap ?? "round"}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="auto"
                    />
                  </g>
                );
              }

              if (s.type === "circle") {
                const rx = Number(s.x ?? 0);
                const ry = Number(s.y ?? 0);
                const rw = Math.max(0, Number(s.width ?? 0));
                const rh = Math.max(0, Number(s.height ?? 0));
                const cx = rx + rw / 2;
                const cy = ry + rh / 2;
                const erx = rw / 2;
                const ery = rh / 2;
                const lineStyle = s.lineStyle ?? "solid";
                const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
                const stroke =
                  isSelected
                    ? "#2b6cff"
                    : dynamicColor || (isDarkTheme ? "#ffffff" : themeStrokeDefault);
                const fill = s.fill ?? "transparent";

                return (
                  <g key={s.id} data-shape-id={s.id} data-drag-selected-shape={isSelected ? "1" : undefined}>
                    <rect
                      x={rx - 6}
                      y={ry - 6}
                      width={rw + 12}
                      height={rh + 12}
                      fill="rgba(0,0,0,0.001)"
                      pointerEvents="all"
                    />
                    <ellipse
                      cx={cx}
                      cy={cy}
                      rx={erx}
                      ry={ery}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={s.strokeWidth}
                      {...styleProps}
                      strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                      strokeLinecap={styleProps.strokeLinecap ?? "round"}
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="auto"
                    />
                  </g>
                );
              }

              const lineStyle = s.lineStyle ?? "solid";
              const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
              const arrowStart = s.arrowStart ?? "none";
              const arrowEnd = s.arrowEnd ?? "none";
              const polyCursor = isLiveMode
                ? "default"
                : tool === "select"
                ? "move"
                : "crosshair";
              const ptsForDisplay = pointsForMarker(s.points);
              const polyFillRaw = String(s.fill ?? "").trim().toLowerCase();
              const polyFill =
                !polyFillRaw || polyFillRaw === "none" || polyFillRaw === "transparent"
                  ? "none"
                  : String(s.fill);
              const resolvedPolylineStroke = normalizeActiveLineColor(
                getPolylineDisplayedColor(s, { includeThemeDefault: false })
              );
              const splitCarrySegments =
                !resolvedPolylineStroke && liveCanvasEnabled
                  ? getWorkerResolvedPolylineSplitCarrySegments(s?.id)
                  : [];
              const hasSplitCarry = Array.isArray(splitCarrySegments) && splitCarrySegments.length > 0;
              const splitCarryColor = hasSplitCarry
                ? normalizeActiveLineColor(splitCarrySegments[0]?.color)
                : "";
              const activeDynamicColor = normalizeActiveLineColor(dynamicColor);
              const activeStrokeColor = resolvedPolylineStroke;
              const renderSplitCarry =
                !activeStrokeColor &&
                Array.isArray(splitCarrySegments) &&
                splitCarrySegments.length > 0;

              return (
                <g key={s.id} data-shape-id={s.id} data-drag-selected-shape={isSelected ? "1" : undefined}>
                  {/* wide transparent hit-area polyline — handlers delegated to parent g */}
                  <polyline
                    points={pointsToAttr(s.points)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(16, (s.strokeWidth || 3) * 5)}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    pointerEvents="auto"
                  />

                  {isEditing && (
                    <>
                      {selectedSegment?.id === s.id &&
                        selectedSegment.kind === "point" &&
                        Array.isArray(s.points) && (
                          (() => {
                            const idx = selectedSegment.index;
                            if (idx < 0 || idx >= s.points.length) return null;
                            const p = s.points[idx];
                            return (
                              <circle
                                cx={p.x}
                                cy={p.y}
                                r={Math.max(10, (s.strokeWidth || 3) * 3)}
                                fill="rgba(43,108,255,0.18)"
                                stroke="#2b6cff"
                                strokeWidth={2}
                                pointerEvents="none"
                              />
                            );
                          })()
                        )}
                      {Array.isArray(s.points)
                        ? s.points.slice(0, -1).map((pt, idx) => {
                            const nextPt = s.points[idx + 1];
                            if (!nextPt) return null;
                            return (
                              <line
                                key={`${s.id}-segment-hit-${idx}`}
                                x1={pt.x}
                                y1={pt.y}
                                x2={nextPt.x}
                                y2={nextPt.y}
                                stroke="transparent"
                                strokeWidth={Math.max(18, (s.strokeWidth || 3) * 5)}
                                strokeLinecap="round"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  onSegmentMouseDown?.(e, s.id, idx);
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  onEditPolylineClick?.(e, s.id);
                                }}
                                style={{ cursor: "pointer" }}
                              />
                            );
                          })
                        : null}
                    </>
                  )}

                  <polyline
                    points={pointsToAttr(ptsForDisplay)}
                    fill={polyFill}
                    stroke={
                      isSelected
                        ? "#2b6cff"
                        : activeStrokeColor || (isDarkTheme ? "#ffffff" : themeStrokeDefault)
                    }
                    strokeWidth={s.strokeWidth}
                    {...styleProps}
                    strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                    strokeLinecap={styleProps.strokeLinecap ?? "round"}
                    markerStart={markerForStart(arrowStart)}
                    markerEnd={markerForEnd(arrowEnd)}
                    pointerEvents="auto"
                  />
                  {!isSelected && renderSplitCarry ? (
                    <>
                      {splitCarrySegments.map((segment, idx) => {
                        const segStroke = normalizeActiveLineColor(segment?.color);
                        if (!segStroke) return null;
                        return (
                          <polyline
                            key={`${s.id}-split-carry-${idx}`}
                            points={pointsToAttr(segment.points)}
                            fill="none"
                            stroke={segStroke}
                            strokeWidth={s.strokeWidth}
                            {...styleProps}
                            strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                            strokeLinecap={styleProps.strokeLinecap ?? "round"}
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="none"
                          />
                        );
                      })}
                    </>
                  ) : null}

                  {isEditing && (
                    <>
                      {s.points.map((pt, idx) => (
                        <g key={`${s.id}-h-${idx}`}>
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={HANDLE_R}
                            fill={
                              selectedSegment?.id === s.id &&
                              selectedSegment.kind === "point" &&
                              selectedSegment.index === idx
                                ? "#e8f0ff"
                                : "white"
                            }
                            stroke="#2b6cff"
                            strokeWidth={HANDLE_STROKE}
                          />
                          <circle cx={pt.x} cy={pt.y} r={DOT_R} fill="#2b6cff" />
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={HIT_R}
                            fill="transparent"
                            onMouseDown={(e) => { e.stopPropagation(); onHandleMouseDown(e, s.id, idx); }}
                            onDoubleClick={(e) => { e.stopPropagation(); onHandleDoubleClick(e, s.id, idx); }}
                            onContextMenu={(e) => { e.stopPropagation(); onHandleContextMenu?.(e, s.id, idx); }}
                            style={{ cursor: "grab" }}
                          />
                        </g>
                      ))}
                    </>
                  )}
                </g>
              );
                })
              ) : null}
            </g>{/* end delegated shapes container */}

              {staticOverlayNodes}
              {embeddedViewOverlayNodes}
              {widgetOverlayNodes}
            {activeEditingPolylineNodes}
            {selectedOverlayIds?.length === 1 && selectedIds?.length === 0 && selectedSingleOverlay && overlaySelectionUI
              ? (
                <g data-drag-selected-overlay-ui="1">
                  {overlaySelectionUI(selectedSingleOverlay, z)}
                </g>
              )
              : null}
            {selectedOverlayIds?.length > 1 && selectedIds?.length === 0 && overlayGroupSelectionUI
              ? (
                <g data-drag-selected-overlay-ui="1">
                  {overlayGroupSelectionUI(z)}
                </g>
              )
              : null}
            {selectedIds?.length > 0 && selectedOverlayIds?.length === 0 && shapeSelectionUI
              ? (
                <g data-drag-selected-shape-ui="1">
                  {shapeSelectionUI(z)}
                </g>
              )
              : null}
            {selectedIds?.length > 0 && selectedOverlayIds?.length > 0 && mixedSelectionUI
              ? (
                <g data-drag-selected-mixed-ui="1">
                  {mixedSelectionUI(z)}
                </g>
              )
              : null}

            {smoothedCollabCursors.length > 0 && (
              <g pointerEvents="none">
                {smoothedCollabCursors.map((c) => {
                  const label = c.username.length > 24 ? `${c.username.slice(0, 24)}...` : c.username;
                  const labelW = Math.max(44, label.length * 7 + 12);
                  return (
                    <g
                      key={`cursor-${c.userId}`}
                      transform={`translate(${c.x} ${c.y}) scale(${1 / (z || 1)})`}
                    >
                      <path
                        d="M0 0 L0 17 L4.5 12.8 L8 20 L11 18.7 L7.7 11.8 L14 11.8 Z"
                        fill={c.color}
                        stroke="#ffffff"
                        strokeWidth={1.1}
                      />
                      <rect
                        x={16}
                        y={-4}
                        width={labelW}
                        height={18}
                        rx={6}
                        ry={6}
                        fill={c.color}
                        opacity={0.9}
                      />
                      <text x={22} y={8.5} fill="#fff" fontSize={11} fontWeight={600}>
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            )}

            {marqueeRect && (
              <rect
                x={marqueeRect.x}
                y={marqueeRect.y}
                width={marqueeRect.w}
                height={marqueeRect.h}
                fill="rgba(43,108,255,0.12)"
                stroke="#2b6cff"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </g>
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "hidden",
            zIndex: 2,
          }}
        >
          {htmlChartLayers.map((layer) => (
            <div
              key={layer.id}
              style={{
                position: "absolute",
                left: layer.x,
                top: layer.y,
                width: layer.w,
                height: layer.h,
                pointerEvents: "none",
              }}
            >
              {layer.kind === "barChart" ? (
                <Bar key={layer.chartKey} data={layer.barData} options={layer.barOptions} />
              ) : (
                <Line key={layer.chartKey} data={layer.lineLikeData} options={layer.lineOptions} plugins={[hoverGuidePlugin]} />
              )}
            </div>
          ))}
        </div>
        <svg
          width="100%"
          height="100%"
          viewBox={vb}
          preserveAspectRatio={preserveAspectRatioMode}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "hidden",
            zIndex: 3,
          }}
        >
          <g transform={`translate(${panX} ${panY}) scale(${z})`}>{overlayIndicatorLayer}</g>
          <g transform={`translate(${panX} ${panY}) scale(${z})`}>{overlayModeBadgeLayer}</g>
        </svg>
        {showTagPaths ? (
          <svg
            width="100%"
            height="100%"
            viewBox={vb}
            preserveAspectRatio={preserveAspectRatioMode}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: onHideTagBubble ? "auto" : "none",
              overflow: "hidden",
              zIndex: 4,
            }}
          >
            <g transform={`translate(${panX} ${panY}) scale(${z})`}>{tagBubbleLayer}</g>
          </svg>
        ) : null}
      </div>
      </div>
      </div>
      {showRulers ? <TopRuler /> : null}
      {showRulers ? <RightRuler /> : null}
      {showRulers ? (
        <div
          style={{
            position: "absolute",
            right: rightEdgeReserve,
            top: 0,
            width: rulerSize,
            height: rulerSize,
            background: "var(--bg-soft)",
            borderLeft: "1px solid var(--border)",
            borderBottom: "1px solid var(--border)",
            pointerEvents: "none",
            zIndex: 11,
          }}
        />
      ) : null}
    </div>
  );
}

export default memo(CanvasSvg);
