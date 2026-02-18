// src/components/CanvasSvg.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { GRID, pointsToAttr, bboxOfPoints } from "../utils/geometry";
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

export default function CanvasSvg({
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
  overlaySelectionUI,
  overlayGroupSelectionUI,
  overlayLocalBBox,
  importAnchor,
  onCanvasDoubleClick,
  tagStateColorsByPath,
  routeColorsBySvgKey,
  routeStrokeColorByGroupPath,
  svgLiveValuesByGroupPath,
  opcLiveValues,
  widgetDbValues,
  onWidgetDurationPresetChange,
  hiddenTagBubbleIds,
  onHideTagBubble,
  onSvgDoubleClick, // ✅ used in TopRuler + main svg
  collaboratorCursors,
  theme,
  canvasBackgroundColor,
  liveClickable = false,
  viewportTopOffset = 0,
  viewportLeftOffset = 0,
}) {
  const vb = useMemo(() => `0 0 ${vbW} ${vbH}`, [vbW, vbH]);
  const rulerSize = showRulers ? RULER : 0;
  const isLineMode = tool === "polyline" || tool === "rect";
  const isCrosshair = isLineMode || marquee;
  const themeStrokeDefault = String(theme || "").toLowerCase() === "dark" ? "#ffffff" : "#808080";
  const [hoverOverlayId, setHoverOverlayId] = useState(null);

  // wrapper size for rulers
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

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

  // ✅ marquee rect coords (WORLD coords)
  const marqueeRect = useMemo(() => {
    if (!marquee) return null;
    const x = Math.min(marquee.start.x, marquee.cur.x);
    const y = Math.min(marquee.start.y, marquee.cur.y);
    const w = Math.abs(marquee.cur.x - marquee.start.x);
    const h = Math.abs(marquee.cur.y - marquee.start.y);
    return { x, y, w, h };
  }, [marquee]);

  const getTagColor = (tagPath) => {
    if (!tagStateColorsByPath) return "";
    const key = String(tagPath || "").replace(/\r?\n/g, "").trim();
    if (!key) return "";
    return tagStateColorsByPath.get(key) || "";
  };

  const getRouteColorForOverlay = (overlay) => {
    if (!routeColorsBySvgKey) return "";
    const lookup = (raw) => {
      const key = String(raw || "").replace(/\r?\n/g, "").trim();
      if (!key) return "";
      const base = (key.split("/").pop() || "").trim();
      return (
        routeColorsBySvgKey.get(key) ||
        routeColorsBySvgKey.get(key.toLowerCase()) ||
        (base ? routeColorsBySvgKey.get(base) : "") ||
        (base ? routeColorsBySvgKey.get(base.toLowerCase()) : "") ||
        ""
      );
    };
    return lookup(overlay?.tagPath) || lookup(overlay?.name) || lookup(overlay?.id) || "";
  };

  const getRouteStrokeColorForOverlay = (overlay) => {
    if (!routeStrokeColorByGroupPath) return "";
    const key = String(overlay?.tagPath || "").replace(/\r?\n/g, "").trim();
    if (!key) return "";
    return (
      routeStrokeColorByGroupPath.get(key) ||
      routeStrokeColorByGroupPath.get(key.toLowerCase()) ||
      ""
    );
  };

  const getLiveValuesForOverlay = (overlay) => {
    if (!svgLiveValuesByGroupPath) return null;
    const key = String(overlay?.tagPath || "").replace(/\r?\n/g, "").trim();
    if (!key) return null;
    return (
      svgLiveValuesByGroupPath.get(key) ||
      svgLiveValuesByGroupPath.get(key.toLowerCase()) ||
      null
    );
  };

  const getOverlayGroupLabel = (overlay) => {
    const raw = String(overlay?.tagPath || "").replace(/\r?\n/g, "").trim();
    if (!raw) return "";
    const parts = raw.split(".").map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.slice(1).join(".");
    return raw;
  };

  const liveLookup = useMemo(() => {
    const map = new Map();
    const src = opcLiveValues || {};
    Object.entries(src).forEach(([key, value]) => {
      const k = String(key || "").replace(/\r?\n/g, "").trim();
      if (!k) return;
      map.set(k, value);
      map.set(k.toLowerCase(), value);
    });
    return map;
  }, [opcLiveValues]);
  const liveLookupRef = useRef(liveLookup);
  useEffect(() => {
    liveLookupRef.current = liveLookup;
  }, [liveLookup]);

  const getLiveValueForTagPath = (rawTagPath) => {
    const lookupMap = liveLookupRef.current || liveLookup;
    const tagPath = String(rawTagPath || "").replace(/\r?\n/g, "").trim();
    if (!tagPath) return "";

    const candidates = [tagPath];
    const parts = tagPath.split(".").map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      candidates.push(parts.slice(i).join("."));
    }
    candidates.push(`Default.${tagPath}`);

    for (const key of candidates) {
      const direct = lookupMap.get(key);
      if (direct != null && direct !== "") return direct;
      const lower = lookupMap.get(String(key).toLowerCase());
      if (lower != null && lower !== "") return lower;
    }
    // Support short tag bindings (e.g. "Group.Tag") when live keys are "Topic.Group.Tag".
    // Prefer exact suffix match to align with trend candidate behavior.
    for (const key of candidates) {
      const suffix = `.${String(key || "").toLowerCase()}`;
      for (const [mapKey, mapValue] of lookupMap.entries()) {
        if (mapValue == null || mapValue === "") continue;
        const textKey = String(mapKey || "").toLowerCase();
        if (textKey === String(key || "").toLowerCase() || textKey.endsWith(suffix)) {
          return mapValue;
        }
      }
    }

    // Fallback: overlay tagPath may be a group path (e.g. Default.Group).
    // In that case, find a live value under that group key prefix.
    for (const groupKey of candidates) {
      const prefix = `${String(groupKey).toLowerCase()}.`;
      const preferred = [
        `${prefix}state`,
        `${prefix}stcode`,
        `${prefix}status`,
        `${prefix}hmi_state`,
        `${prefix}hmistate`,
        `${prefix}routeid`,
        `${prefix}routenumber`,
        `${prefix}value`,
      ];
      for (const k of preferred) {
        const v = lookupMap.get(k);
        if (v != null && v !== "") return v;
      }
      for (const [k, v] of lookupMap.entries()) {
        if (typeof k !== "string") continue;
        if (!k.startsWith(prefix)) continue;
        if (v != null && v !== "") return v;
      }
    }
    return "";
  };

  const getWidgetValueForOverlay = (overlay) => {
    if (!overlay?.widget) return "";
    const tagPath = String(overlay?.tagPath || "").trim();
    if (!tagPath) return "";
    if (tagPath.toLowerCase().startsWith("db:")) {
      const id = String(overlay?.id || "");
      const v = widgetDbValues && Object.prototype.hasOwnProperty.call(widgetDbValues, id)
        ? widgetDbValues[id]
        : "";
      return v == null ? "" : v;
    }
    return getLiveValueForTagPath(tagPath);
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
  const [, setWidgetRenderTick] = useState(0);
  const widgetTrendSeriesRef = useRef(new Map()); // overlayId -> [{ tagPath, tagKey, points:[{t,v}] }] from /api/opc/trends
  const [, setWidgetTrendTick] = useState(0);
  const [widgetTrendReloadNonce, setWidgetTrendReloadNonce] = useState(0);
  const widgetBarDatasetRef = useRef(new Map()); // overlayId -> { labels: string[], values: number[], updatedAt: number }
  const [, setWidgetBarTick] = useState(0);
  const [widgetWriteDraftByOverlay, setWidgetWriteDraftByOverlay] = useState({});
  const [widgetWriteBusyByOverlay, setWidgetWriteBusyByOverlay] = useState({});
  const [widgetWriteErrorByOverlay, setWidgetWriteErrorByOverlay] = useState({});
  const [widgetPressByOverlay, setWidgetPressByOverlay] = useState({});
  const widgetPulseTimersRef = useRef(new Map());
  const trendLiveKeyListRef = useRef([]);
  const trendTagCandidateCacheRef = useRef(new Map());

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

  const submitWidgetWrite = async (overlay, writeValue) => {
    const overlayId = String(overlay?.id || "").trim();
    const tagPath = getWritableWidgetTagPath(overlay);
    if (!overlayId || !tagPath) return;
    setWidgetWriteBusyByOverlay((prev) => ({ ...prev, [overlayId]: true }));
    setWidgetWriteErrorByOverlay((prev) => ({ ...prev, [overlayId]: "" }));
    try {
      const payloadValue = coerceWidgetWriteValue(writeValue);
      const res = await fetch("/api/opc/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tagKey: tagPath,
          legacyTagKey: tagPath,
          value: payloadValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Write failed.");
      const nextValue = Object.prototype.hasOwnProperty.call(data || {}, "value")
        ? data.value
        : payloadValue;
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
    trendLiveKeyListRef.current = Object.keys(opcLiveValues || {}).map((k) => String(k || "").trim()).filter(Boolean);
    trendTagCandidateCacheRef.current.clear();
  }, [opcLiveValues]);

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
  }, [svgOverlays]);

  useEffect(
    () => () => {
      const timers = widgetPulseTimersRef.current;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
    []
  );

  const parseWidgetSeriesTags = (overlay) => {
    const out = [];
    const push = (raw) => {
      const tag = String(raw || "").trim();
      if (!tag) return;
      const key = tag.toLowerCase();
      if (out.some((x) => x.toLowerCase() === key)) return;
      out.push(tag);
    };
    const primary = String(overlay?.tagPath || "").trim();
    const widget = overlay?.widget || {};
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
      return out;
    }
    if (isBarChart) {
      parsedSeries.forEach((t) => push(t));
      push(primary);
      return out;
    }
    push(primary);
    if (!out.length) parsedSeries.forEach((t) => push(t));
    return out;
  };

  useEffect(() => {
    const now = Date.now();
    let changed = false;
    const keep = new Set();
    const lineKindSet = new Set(["linechart", "line_chart", "line-chart"]);
    (svgOverlays || []).forEach((o) => {
      if (!o?.widget) return;
      const id = String(o.id || "");
      if (!id) return;
      keep.add(id);
      const raw = getWidgetValueForOverlay(o);
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

      const kind = String(o?.widget?.kind || "").trim().toLowerCase();
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
  }, [svgOverlays, opcLiveValues, widgetDbValues]);

  useEffect(() => {
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
  }, [svgOverlays, widgetTrendReloadNonce, liveClickable]);

  useEffect(() => {
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
  }, [svgOverlays, liveClickable]);

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
    const widgetScale = Math.max(0.72, Math.min(1.9, Math.min(w, h) / 170));
    const scaledFont = (base, min = 7, max = 40) =>
      Math.max(min, Math.min(max, Math.round(Number(base || 0) * widgetScale)));
    const headH = dense ? 20 : compact ? 24 : 28;
    const pad = dense ? 6 : compact ? 8 : 10;
    const cardTitle = title || "";
    const titleSize = dense ? 8 : compact ? 9 : 10;
    const valueSize = scaledFont(dense ? 14 : compact ? 18 : 22, 10, 56);
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
      const overlayScale = Math.max(1, Number(overlay?.scale) || 1);
      const dpr =
        typeof window !== "undefined"
          ? Math.max(1, Math.min(8, (window.devicePixelRatio || 1) * viewScale * overlayScale))
          : 1;
      const gaugeKey = `g-${overlay.id}-${kind}-${gaugeW}x${gaugeH}-z${viewScale.toFixed(3)}-s${overlayScale.toFixed(3)}`;
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
      const labelFont = scaledFont(dense ? 11 : 14, 10, 24);
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
        Math.min(20, Math.round(Math.min(barH * 0.52, barW * 0.11)))
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
              style={{ pointerEvents: liveClickable ? "auto" : "none" }}
            >
              <div
                xmlns="http://www.w3.org/1999/xhtml"
                style={{
                  display: "grid",
                  gridTemplateColumns: `${Math.max(20, controlsW - btnW - 6)}px ${btnW}px`,
                  gap: 6,
                  width: "100%",
                  height: "100%",
                  pointerEvents: liveClickable ? "auto" : "none",
                }}
              >
                <input
                  data-widget-control="true"
                  value={writeDraft}
                  onMouseDown={(e) => {
                    if (!liveClickable) return;
                    e.stopPropagation();
                  }}
                  onChange={(e) => {
                    if (!liveClickable) return;
                    const nextVal = e.target.value;
                    setWidgetWriteDraftByOverlay((prev) => ({ ...prev, [overlayId]: nextVal }));
                    if (widgetWriteErrorByOverlay?.[overlayId]) {
                      setWidgetWriteErrorByOverlay((prev) => ({ ...prev, [overlayId]: "" }));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!liveClickable) return;
                    if (e.key !== "Enter" || writeBusy || !canWrite) return;
                    e.preventDefault();
                    submitWidgetWrite(overlay, writeDraft);
                  }}
                  placeholder={canWrite ? "Write value" : "Bind OPC tag to write"}
                  disabled={!liveClickable || !canWrite || writeBusy}
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
                  }}
                />
                <button
                  data-widget-control="true"
                  onMouseDown={(e) => {
                    if (!liveClickable) return;
                    e.stopPropagation();
                  }}
                  onClick={() => {
                    if (!liveClickable) return;
                    submitWidgetWrite(overlay, writeDraft);
                  }}
                  disabled={!liveClickable || !canWrite || writeBusy}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "white",
                    borderRadius: 7,
                    fontSize: dense ? 10 : 11,
                    fontWeight: 700,
                    cursor: !liveClickable || !canWrite || writeBusy ? "default" : "pointer",
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
      const pressed = toBooleanLike(rawVal);
      const localPressed = widgetPressByOverlay?.[overlayId] === true;
      const visualPressed = localPressed || pressed;
      const titleText = cardTitle;
      const titleFont = scaledFont(dense ? 11 : 13, 10, 22);
      const contentPadX = Math.max(6, Math.min(14, Math.round(w * 0.06)));
      const topInset = Math.max(4, Math.round(h * 0.06));
      const bottomInset = Math.max(4, Math.round(h * 0.08));
      const showTitle = h >= 50 && Boolean(titleText);
      const titleY = y + topInset + titleFont;
      const contentTop = showTitle ? titleY + Math.max(2, Math.round(h * 0.03)) : y + topInset;
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
              fill={subdued}
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
              style={{ width: "100%", height: "100%", pointerEvents: "none" }}
            >
              <button
                data-widget-control={liveClickable ? "true" : undefined}
                onMouseDown={(e) => {
                  if (!liveClickable) return;
                  e.stopPropagation();
                  setWidgetPressed(overlayId, true);
                  if (writeBusy) return;
                  if (!canWrite) {
                    setWidgetWriteErrorByOverlay((prev) => ({
                      ...prev,
                      [overlayId]: "Bind OPC tag to enable write.",
                    }));
                    return;
                  }
                  submitWidgetWrite(overlay, 1);
                }}
                onMouseUp={(e) => {
                  if (!liveClickable) return;
                  e.stopPropagation();
                  setWidgetPressed(overlayId, false);
                  if (writeBusy || !canWrite) return;
                  submitWidgetWrite(overlay, 0);
                }}
                onMouseLeave={() => {
                  if (!liveClickable) return;
                  setWidgetPressed(overlayId, false);
                  if (writeBusy || !canWrite) return;
                  submitWidgetWrite(overlay, 0);
                }}
                onTouchStart={(e) => {
                  if (!liveClickable) return;
                  e.stopPropagation();
                  setWidgetPressed(overlayId, true);
                  if (writeBusy) return;
                  if (!canWrite) {
                    setWidgetWriteErrorByOverlay((prev) => ({
                      ...prev,
                      [overlayId]: "Bind OPC tag to enable write.",
                    }));
                    return;
                  }
                  submitWidgetWrite(overlay, 1);
                }}
                onTouchEnd={() => {
                  if (!liveClickable) return;
                  setWidgetPressed(overlayId, false);
                  if (writeBusy || !canWrite) return;
                  submitWidgetWrite(overlay, 0);
                }}
                disabled={!liveClickable || writeBusy}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: Math.max(8, Math.round(buttonH * 0.22)),
                  background: visualPressed
                    ? "linear-gradient(180deg, #1d4ed8 0%, #1e40af 100%)"
                    : "linear-gradient(180deg, #4f8dff 0%, #2b6cff 100%)",
                  color: "white",
                  fontSize: Math.max(9, Math.min(20, Math.round(buttonH * 0.42))),
                  fontWeight: 800,
                  cursor: !liveClickable || writeBusy ? "default" : "pointer",
                  opacity: !canWrite ? 0.65 : 1,
                  boxShadow: visualPressed
                    ? "inset 0 4px 10px rgba(2,6,23,0.38), inset 0 -1px 2px rgba(255,255,255,0.12)"
                    : "inset 0 1px 0 rgba(255,255,255,0.35), 0 8px 16px rgba(43,108,255,0.26)",
                  transform: visualPressed ? "translateY(1px) scale(0.99)" : "translateY(0) scale(1)",
                  transition: "transform 80ms ease, box-shadow 120ms ease, filter 120ms ease",
                  pointerEvents: "none",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    width: Math.max(10, Math.round(buttonH * 0.28)),
                    height: Math.max(10, Math.round(buttonH * 0.28)),
                    borderRadius: "999px",
                    border: "1px solid rgba(255,255,255,0.72)",
                    background: writeBusy
                      ? "rgba(255,255,255,0.45)"
                      : visualPressed
                      ? "rgba(255,255,255,0.35)"
                      : "rgba(255,255,255,0.22)",
                    boxShadow: visualPressed
                      ? "inset 0 1px 2px rgba(2,6,23,0.35)"
                      : "0 0 0 2px rgba(255,255,255,0.08)",
                  }}
                />
              </button>
            </div>
          </foreignObject>
          {liveClickable ? (
            <rect
              x={buttonX}
              y={buttonY}
              width={buttonW}
              height={buttonH}
              rx={Math.max(8, Math.round(buttonH * 0.22))}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: writeBusy ? "default" : "pointer" }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setWidgetPressed(overlayId, true);
                if (writeBusy) return;
                if (!canWrite) {
                  setWidgetWriteErrorByOverlay((prev) => ({
                    ...prev,
                    [overlayId]: "Bind OPC tag to enable write.",
                  }));
                  return;
                }
                submitWidgetWrite(overlay, 1);
              }}
              onMouseUp={(e) => {
                e.stopPropagation();
                setWidgetPressed(overlayId, false);
                if (writeBusy || !canWrite) return;
                submitWidgetWrite(overlay, 0);
              }}
              onMouseLeave={() => {
                setWidgetPressed(overlayId, false);
                if (writeBusy || !canWrite) return;
                submitWidgetWrite(overlay, 0);
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
      const buttonW = Math.max(54, Math.round(w - pad * 2));
      const buttonH = Math.max(26, Math.round(Math.min(52, h - headH - 16)));
      const buttonX = x + pad;
      const buttonY = Math.max(y + headH + 8, y + h - buttonH - 8);
      return (
        <g>
          <rect x={x + 1} y={y + 1} width={w - 2} height={headH} rx={10} fill="var(--bg-elev)" />
          <text x={x + pad} y={y + headH - 7} fill={subdued} fontSize={titleSize} fontFamily="system-ui" fontWeight={700}>
            {cardTitle}
          </text>
          <foreignObject
            x={buttonX}
            y={buttonY}
            width={buttonW}
            height={buttonH}
            style={{ pointerEvents: "none" }}
          >
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style={{ width: "100%", height: "100%", pointerEvents: "none" }}
            >
              <button
                data-widget-control={liveClickable ? "true" : undefined}
                onMouseDown={(e) => {
                  if (!liveClickable) return;
                  e.stopPropagation();
                  setWidgetPressed(overlayId, true);
                }}
                onMouseUp={() => setWidgetPressed(overlayId, false)}
                onMouseLeave={() => setWidgetPressed(overlayId, false)}
                onClick={(e) => {
                  if (!liveClickable) return;
                  e.stopPropagation();
                  pulseWidgetPress(overlayId, 180);
                  if (writeBusy) return;
                  if (!canWrite) {
                    setWidgetWriteErrorByOverlay((prev) => ({
                      ...prev,
                      [overlayId]: "Bind OPC tag to enable write.",
                    }));
                    return;
                  }
                  submitWidgetWrite(overlay, isOn ? 0 : 1);
                }}
                disabled={!liveClickable || writeBusy}
                style={{
                  width: "100%",
                  height: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: Math.max(8, Math.round(buttonH * 0.22)),
                  background: isOn
                    ? "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)"
                    : "linear-gradient(180deg, #64748b 0%, #334155 100%)",
                  color: "white",
                  fontSize: Math.max(9, Math.min(20, Math.round(buttonH * 0.42))),
                  fontWeight: 800,
                  cursor: !liveClickable || writeBusy ? "default" : "pointer",
                  opacity: !canWrite ? 0.65 : 1,
                  boxShadow: isOn
                    ? "inset 0 1px 0 rgba(255,255,255,0.32), 0 8px 16px rgba(22,163,74,0.26)"
                    : "inset 0 1px 0 rgba(255,255,255,0.22), 0 8px 16px rgba(51,65,85,0.24)",
                  transform: localPressed ? "translateY(1px) scale(0.99)" : "translateY(0) scale(1)",
                  transition: "transform 80ms ease, box-shadow 120ms ease, filter 120ms ease",
                  pointerEvents: "none",
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: Math.max(6, Math.round(buttonH * 0.14)),
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: Math.max(10, Math.round(buttonH * 0.28)),
                      height: Math.max(10, Math.round(buttonH * 0.28)),
                      borderRadius: "999px",
                      border: "1px solid rgba(255,255,255,0.72)",
                      background: writeBusy
                        ? "rgba(255,255,255,0.45)"
                        : isOn
                        ? "rgba(255,255,255,0.28)"
                        : "rgba(255,255,255,0.18)",
                      boxShadow: isOn
                        ? "0 0 0 2px rgba(255,255,255,0.12), 0 0 12px rgba(255,255,255,0.25)"
                        : "0 0 0 2px rgba(255,255,255,0.08)",
                    }}
                  />
                  <span
                    style={{
                      fontSize: Math.max(9, Math.min(18, Math.round(buttonH * 0.38))),
                      fontWeight: 800,
                      letterSpacing: "0.02em",
                      color: "rgba(255,255,255,0.96)",
                    }}
                  >
                    {writeBusy ? "..." : (isOn ? "ON" : "OFF")}
                  </span>
                </span>
              </button>
            </div>
          </foreignObject>
          {liveClickable ? (
            <rect
              x={buttonX}
              y={buttonY}
              width={buttonW}
              height={buttonH}
              rx={Math.max(8, Math.round(buttonH * 0.22))}
              fill="transparent"
              pointerEvents="all"
              style={{ cursor: writeBusy ? "default" : "pointer" }}
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
                    [overlayId]: "Bind OPC tag to enable write.",
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
    const durationPresetMap = {
      "15m": 15,
      "1h": 60,
      "6h": 360,
      "24h": 1440,
      "7d": 10080,
    };
    const durationChipOptions = [
      { value: "15m", label: "15m" },
      { value: "1h", label: "1h" },
      { value: "6h", label: "6h" },
      { value: "24h", label: "24h" },
      { value: "7d", label: "7d" },
    ];
    const applyDurationPreset = (presetValue) => {
      const mins = durationPresetMap[presetValue] || 60;
      setSvgOverlays?.((prev) =>
        prev.map((o) =>
          o.id !== overlay.id
            ? o
            : {
                ...o,
                widget: {
                  ...(o.widget || {}),
                  durationPreset: presetValue,
                  windowMinutes: mins,
                  rangeFrom: null,
                  rangeTo: null,
                },
              }
        )
      );
      onWidgetDurationPresetChange?.(overlay.id, presetValue, mins);
      widgetTrendSeriesRef.current.set(String(overlay.id || ""), []);
      setWidgetTrendTick((x) => x + 1);
      setWidgetTrendReloadNonce((n) => n + 1);
    };
    const inferDurationPreset = () => {
      const raw = String(cfg?.durationPreset || "").trim().toLowerCase();
      if (raw && Object.prototype.hasOwnProperty.call(durationPresetMap, raw)) return raw;
      const wm = Number(cfg?.windowMinutes);
      if (!Number.isFinite(wm)) return "1h";
      const found = Object.entries(durationPresetMap).find(([, mins]) => Number(mins) === Math.round(wm));
      return found?.[0] || "1h";
    };
    const activeDurationPreset = inferDurationPreset();
    const activeDurationLabel = activeDurationPreset ? activeDurationPreset.toUpperCase() : `${windowMinutes}m`;
    const viewScale = Math.max(1, Number(zoom) || 1);
    const overlayScale = Math.max(1, Number(overlay?.scale) || 1);
    const dpr =
      typeof window !== "undefined"
        ? Math.max(1, Math.min(8, (window.devicePixelRatio || 1) * viewScale * overlayScale))
        : 1;
    const chartKey = `c-${overlay.id}-${kind}-${chartW}x${chartH}-z${viewScale.toFixed(3)}-s${overlayScale.toFixed(3)}`;
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
    const effectiveTension = axisTimeline.length > 240 ? 0 : lineTension;
    const showPoints = cfg?.showPoints !== false;
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
            grid: { color: "transparent", drawBorder: false },
            border: { display: false },
          },
          y: {
            display: true,
            alignToPixels: true,
            ticks: {
              color: axisColor,
              font: { size: 10, weight: "600" },
              maxTicksLimit: 5,
              callback: yTickFmt,
            },
            grid: { color: gridColor, borderDash: [4, 4], drawBorder: false },
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
          display: useMultiLine,
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
      },
      scales: baseScales,
      elements: {
        line: { borderJoinStyle: "round", capBezierPoints: true },
        point: {
          radius: !showPoints || dense ? 0 : axisTimeline.length <= 2 ? 3.6 : 2.2,
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
        line: { ...commonOptions.elements.line, tension: effectiveTension, borderWidth: 2.6 },
      },
    };
    const areaOptions = {
      ...commonOptions,
      elements: {
        ...commonOptions.elements,
        line: { ...commonOptions.elements.line, tension: effectiveTension, borderWidth: 2.4 },
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
              borderWidth: 2.3,
              fill: false,
              spanGaps: true,
              tension: effectiveTension,
              cubicInterpolationMode: "monotone",
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
              borderWidth: kind === "areaChart" ? 2.2 : 2.4,
              fill: kind === "areaChart",
              tension: effectiveTension,
              cubicInterpolationMode: "monotone",
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
    const usesHtmlChartLayer = kind === "lineChart" || kind === "areaChart" || kind === "barChart";
    if (usesHtmlChartLayer) {
      const scaleVal = Number(overlay?.scale) || 1;
      const worldChartX = Number(overlay?.tx || 0) + scaleVal * chartX;
      const worldChartY = Number(overlay?.ty || 0) + scaleVal * chartTop;
      const viewportW = Math.max(1, Number(size?.w || 0) - RULER);
      const viewportH = Math.max(1, Number(size?.h || 0) - RULER);
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
          const chipH = Math.max(12, headH - 12);
          const chipY = y + (headH - chipH) / 2;
          const chipWByLabel = (label) => Math.max(24, 10 + String(label || "").length * 5.5);
          const chipWidths = durationChipOptions.map((opt) => chipWByLabel(opt.label));
          const totalW = chipWidths.reduce((a, b) => a + b, 0) + chipGap * Math.max(0, durationChipOptions.length - 1);
          const startX = Math.max(x + pad, x + w - pad - totalW);
          let cursorX = startX;
          return (
            <g data-widget-control="true">
              {durationChipOptions.map((opt, i) => {
                const active = activeDurationPreset === opt.value;
                const cw = chipWidths[i];
                const cx = cursorX;
                cursorX += cw + chipGap;
                return (
                  <g
                    key={`${overlay.id}-dur-${opt.value}`}
                    data-widget-control="true"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      applyDurationPreset(opt.value);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={cx}
                      y={chipY}
                      width={cw}
                      height={chipH}
                      rx={6}
                      fill={active ? (isDark ? "rgba(34,211,238,0.2)" : "rgba(37,99,235,0.16)") : "var(--bg-elev)"}
                      stroke={active ? accentLine : "var(--border)"}
                    />
                    <text
                      x={cx + cw / 2}
                      y={chipY + chipH / 2 + 2.8}
                      textAnchor="middle"
                      fill={active ? (isDark ? "#9be8ff" : "#1d4ed8") : axisColor}
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
                <Line key={chartKey} data={lineLikeData} options={kind === "areaChart" ? areaOptions : lineOptions} />
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

    const candidates = [tagPath];
    const parts = tagPath.split(".").map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      candidates.push(parts.slice(i).join("."));
    }
    candidates.push(`Default.${tagPath}`);

    const findBySuffixes = (suffixes) => {
      for (const groupKey of candidates) {
        const prefix = `${String(groupKey).toLowerCase()}.`;
        for (const suffix of suffixes) {
          const v = liveLookup.get(`${prefix}${suffix}`);
          if (v != null && v !== "") return String(v);
        }
      }
      return "";
    };

    return {
      routeId: findBySuffixes(["routeid", "routenumber", "routeno", "route"]),
      state: findBySuffixes(["state", "stcode", "status", "stat", "hmi_state", "hmistate"]),
    };
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
  const hiddenBubbleSet = useMemo(
    () => new Set(Array.isArray(hiddenTagBubbleIds) ? hiddenTagBubbleIds : []),
    [hiddenTagBubbleIds]
  );

  const lastTagColorRef = useRef(new Map());

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

  const getOverlayColorAtPoint = (pt) => {
    if (!pt || !svgOverlays?.length) return "";
    for (const o of svgOverlays) {
      const color = getRouteColorForOverlay(o) || getTagColor(o.tagPath);
      if (!color) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const wr = overlayWorldRect(o, bb);
      const x = wr.x;
      const y = wr.y;
      const w = wr.w;
      const h = wr.h;
      if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) {
        return color;
      }
    }
    return "";
  };


  const innerW = Math.max(0, (size.w || 0) - rulerSize);
  const innerH = Math.max(0, (size.h || 0) - rulerSize);
  const vbWidth = Math.max(1, Number(vbW) || 1);
  const vbHeight = Math.max(1, Number(vbH) || 1);
  const viewportScale =
    innerW > 0 && innerH > 0 ? Math.min(innerW / vbWidth, innerH / vbHeight) : 1;
  const viewportOffsetX = (innerW - vbWidth * viewportScale) / 2;
  const viewportOffsetY = (innerH - vbHeight * viewportScale) / 2;

  // current transform values (WORLD -> SCREEN)
  const z = zoom || 1;
  const panX = pan?.x || 0;
  const panY = pan?.y || 0;

  // SCREEN(px) -> WORLD(units)
  const screenToWorldX = (sx) =>
    ((sx - viewportOffsetX) / Math.max(1e-9, viewportScale) - panX) / z;
  const screenToWorldY = (sy) =>
    ((sy - viewportOffsetY) / Math.max(1e-9, viewportScale) - panY) / z;

  // WORLD(units) -> SCREEN(px)
  const worldToScreenX = (wx) => (wx * z + panX) * viewportScale + viewportOffsetX;
  const worldToScreenY = (wy) => (wy * z + panY) * viewportScale + viewportOffsetY;

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
  }, [innerW, innerH, panX, panY, z, viewportScale, viewportOffsetX, viewportOffsetY]);

  /* =========================================================
     KEYBOARD NUDGE (ARROWS)
     ========================================================= */
  useEffect(() => {
    const handleKeyDown = (e) => {
      const hasShapeSel = selectedIds?.length > 0;
      const hasOverlaySel = selectedOverlayIds?.length > 0;
      if (!hasShapeSel && !hasOverlaySel) return;

      // Don’t interfere with typing in inputs
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;

      let dx = 0;
      let dy = 0;

      const base = e.shiftKey ? 10 : 1;
      const step = base / (zoom || 1);

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

      if (hasShapeSel && typeof setShapes === "function") {
        if (selectedSegment?.id && selectedIds.includes(selectedSegment.id) && selectedSegment.kind === "point") {
          const ptIndex = selectedSegment.index;
          setShapes((prev) =>
            prev.map((s) => {
              if (s.id !== selectedSegment.id) return s;
              if (!Array.isArray(s.points)) return s;
              if (ptIndex < 0 || ptIndex >= s.points.length) return s;
              const pts = s.points.map((pt) => ({ ...pt }));
              pts[ptIndex] = { x: pts[ptIndex].x + dx, y: pts[ptIndex].y + dy };
              return { ...s, points: pts };
            })
          );
          return;
        }

        setShapes((prev) =>
          prev.map((s) => {
            if (!selectedIds.includes(s.id)) return s;
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
        setSvgOverlays((prev) =>
          prev.map((o) => {
            if (!selectedOverlayIds.includes(o.id)) return o;
            return { ...o, tx: o.tx + dx, ty: o.ty + dy };
          })
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIds, selectedOverlayIds, selectedSegment, zoom, setShapes, setSvgOverlays]);

  /* ============================
     RULERS (SCREEN-PIXEL)
     ============================ */
  function TopRuler() {
    const W = Math.max(0, size.w - rulerSize);
    const H = rulerSize;

    const majorPx = 100;
    const minorPx = 20;

    const ticks = [];
    for (let x = 0; x <= W; x += minorPx) {
      const isMajor = x % majorPx === 0;
      const len = isMajor ? 12 : 7;

      ticks.push(
        <line
          key={`t-${x}`}
          x1={x + 0.5}
          y1={H}
          x2={x + 0.5}
          y2={H - len}
          stroke="var(--ruler-line)"
          strokeWidth={1}
        />
      );

      if (isMajor) {
        ticks.push(
          <text
            key={`tl-${x}`}
            x={x + 2}
            y={12}
            fontSize={10}
            fill="var(--ruler-text)"
            style={{ userSelect: "none" }}
          >
            {x}px
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
    const H = Math.max(0, size.h - rulerSize);

    const pxPerMajor = 80;
    const worldPerPx = 1 / z;

    const majorStepWorld = niceStep(pxPerMajor * worldPerPx);
    const minorStepWorld = majorStepWorld / 5;

    const worldTop = screenToWorldY(0);
    const worldBottom = screenToWorldY(H);

    const start = Math.floor(worldTop / minorStepWorld) * minorStepWorld;

    const ticks = [];
    for (let wy = start; wy <= worldBottom + minorStepWorld; wy += minorStepWorld) {
      const sy = worldToScreenY(wy);
      if (sy < 0 || sy > H) continue;

      const isMajor = Math.abs(wy / majorStepWorld - Math.round(wy / majorStepWorld)) < 1e-6;
      const len = isMajor ? 12 : 7;

      ticks.push(
        <line
          key={`r-${wy}`}
          x1={0}
          y1={sy + 0.5}
          x2={len}
          y2={sy + 0.5}
          stroke="var(--ruler-line)"
          strokeWidth={1}
        />
      );

      if (isMajor) {
        ticks.push(
          <text
            key={`rl-${wy}`}
            x={4}
            y={sy + 10}
            fontSize={10}
            fill="var(--ruler-text)"
            style={{ userSelect: "none" }}
          >
            {Math.round(wy)}
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
          right: 0,
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
          y2={anchorY - 2}
          stroke="#0f172a"
          strokeWidth={1 * inv}
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

  return (
    <div
      ref={wrapRef}
      onDoubleClickCapture={(e) => {
        onCanvasDoubleClick?.(e);
      }}
      style={{
        position: "absolute",
        top: viewportTopOffset,
        left: Math.max(0, Number(viewportLeftOffset) || 0),
        right: 0,
        bottom: 0,
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {showRulers ? <TopRuler /> : null}
      {showRulers ? <RightRuler /> : null}

      {showRulers ? (
        <div
          style={{
            position: "absolute",
            right: 0,
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

      <div
        style={{
          position: "absolute",
          left: 0,
          top: rulerSize,
          right: rulerSize,
          bottom: 0,
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={vb}
          preserveAspectRatio="xMidYMid meet"
          data-canvas-zoom-root="true"
          ref={svgRef}
          tabIndex={0}
          style={{
            display: "block",
            background: canvasBackgroundColor || "var(--canvas-bg)",
            outline: "none",
            cursor: isCrosshair ? "crosshair" : "default",
          }}
          onWheel={onWheel}
          onMouseDown={onSvgMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
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

            {shapes.map((s) => {
              const isSelected = selectedIds.includes(s.id);
              const isEditing = s.id === editingId;
              const dynamicColor = getTagColor(s.tagPath);

              if (s.type === "text") {
                const selected = selectedIds.includes(s.id);
                const isEditing = editingId === s.id;
                const isInline = inlineEditId === s.id;

                return (
                  <g
                    key={s.id}
                    onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                    onDoubleClick={(e) => onShapeDoubleClick(e, s.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (tool === "select") {
                        setSelectedIds?.([s.id]);
                        setSelectedOverlayIds?.([]);
                      }
                      onContextMenu?.(e);
                    }}
                    style={{ cursor: tool === "select" ? "move" : "crosshair" }}
                  >
                    {/* Invisible hitbox so right-click works anywhere over text bounds */}
                    {(() => {
                      const fontSize = s.fontSize || 24;
                      const text = s.text || "";
                      const estW = Math.max(40, text.length * fontSize * 0.6);
                      const estH = Math.max(24, fontSize * 1.2);
                      const anchor = s.anchor || "start";
                      const ax = anchor === "middle" ? -estW / 2 : anchor === "end" ? -estW : 0;
                      const onCtx = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (tool === "select") {
                          setSelectedIds?.([s.id]);
                          setSelectedOverlayIds?.([]);
                        }
                        onContextMenu?.(e);
                      };
                      return (
                        <rect
                          x={s.x + ax - 6}
                          y={s.y - estH - 6}
                          width={estW + 12}
                          height={estH + 12}
                          fill="rgba(0,0,0,0.001)"
                          pointerEvents="all"
                          onMouseDown={(e) => {
                            if (tool !== "select") return;
                            onShapeMouseDown(e, s.id);
                          }}
                          onDoubleClick={(e) => onShapeDoubleClick(e, s.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (tool === "select") {
                              setSelectedIds?.([s.id]);
                              setSelectedOverlayIds?.([]);
                            }
                            onContextMenu?.(e);
                          }}
                        />
                      );
                    })()}
                    <text
                      x={s.x}
                      y={s.y}
                      fill={
                        dynamicColor ||
                        (theme === "dark" && (!s.fill || String(s.fill).toLowerCase() === "#808080")
                          ? "#ffffff"
                          : s.fill || "#808080")
                      }
                      fontSize={s.fontSize || 24}
                      fontFamily={s.fontFamily || "system-ui"}
                      fontWeight={s.fontWeight || "400"}
                      textAnchor={s.anchor || "start"}
                      dominantBaseline="text-before-edge"
                      style={{ userSelect: "none", visibility: isInline ? "hidden" : "visible" }}
                      onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                      onDoubleClick={(e) => onShapeDoubleClick(e, s.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (tool === "select") {
                          setSelectedIds?.([s.id]);
                          setSelectedOverlayIds?.([]);
                        }
                        onContextMenu?.(e);
                      }}
                    >
                      {s.text || ""}
                    </text>

                    {/* optional selection box/handle (easy version: underline) */}
                    {(selected || isEditing) && (
                      <rect
                        x={s.x - 4}
                        y={s.y - 4}
                        width={Math.max(40, (s.text?.length || 1) * (s.fontSize || 24) * 0.6)}
                        height={(s.fontSize || 24) + 8}
                        fill="none"
                        stroke="#2b6cff"
                        strokeWidth={1.5}
                        strokeDasharray="6 4"
                        pointerEvents="none"
                      />
                    )}
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
                    : dynamicColor || themeStrokeDefault;
                const fill = s.fill ?? "transparent";

                return (
                  <g key={s.id}>
                    <rect
                      x={rx - 6}
                      y={ry - 6}
                      width={rw + 12}
                      height={rh + 12}
                      fill="rgba(0,0,0,0.001)"
                      pointerEvents="all"
                      onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                      onDoubleClick={(e) => onShapeDoubleClick(e, s.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (tool === "select") {
                          setSelectedIds?.([s.id]);
                          setSelectedOverlayIds?.([]);
                        }
                        onContextMenu?.(e);
                      }}
                      style={{ cursor: tool === "select" ? "move" : "crosshair" }}
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
                      onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                      onDoubleClick={(e) => onShapeDoubleClick(e, s.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (tool === "select") {
                          setSelectedIds?.([s.id]);
                          setSelectedOverlayIds?.([]);
                        }
                        onContextMenu?.(e);
                      }}
                      style={{ cursor: tool === "select" ? "move" : "crosshair" }}
                    />
                  </g>
                );
              }

              const lineStyle = s.lineStyle ?? "solid";
              const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);
              const arrowStart = s.arrowStart ?? "none";
              const arrowEnd = s.arrowEnd ?? "none";
              const ptsForDisplay = pointsForMarker(s.points);
              const startPoint =
                Array.isArray(s.points) && s.points.length ? s.points[0] : null;
              const touchColor = startPoint ? getOverlayColorAtPoint(startPoint) : "";

              return (
                <g key={s.id}>
                  {(() => {
                    const onPolyDbl = (e) => {
                      if (isEditing) {
                        onEditPolylineClick?.(e, s.id);
                      } else {
                        onShapeDoubleClick(e, s.id);
                      }
                    };
                    return null;
                  })()}
                  <polyline
                    points={pointsToAttr(s.points)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(16, (s.strokeWidth || 3) * 5)}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                    onDoubleClick={(e) => {
                      if (isEditing) {
                        onEditPolylineClick?.(e, s.id);
                      } else {
                        onShapeDoubleClick(e, s.id);
                      }
                    }}
                    pointerEvents="auto"
                    style={{ cursor: tool === "select" ? "move" : "crosshair" }}
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
                    </>
                  )}

                  <polyline
                    points={pointsToAttr(ptsForDisplay)}
                    fill="none"
                    stroke={
                      isSelected
                        ? "#2b6cff"
                        : touchColor || dynamicColor || themeStrokeDefault
                    }
                    strokeWidth={s.strokeWidth}
                    // ✅ Apply styleProps FIRST so our explicit defaults don’t overwrite it
                    {...styleProps}
                    strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                    strokeLinecap={styleProps.strokeLinecap ?? "round"}
                    markerStart={markerForStart(arrowStart)}
                    markerEnd={markerForEnd(arrowEnd)}
                    onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                    onDoubleClick={(e) => {
                      if (isEditing) {
                        onEditPolylineClick?.(e, s.id);
                      } else {
                        onShapeDoubleClick(e, s.id);
                      }
                    }}
                    pointerEvents="auto"
                    style={{ cursor: tool === "select" ? "move" : "crosshair" }}
                  />

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
                            onMouseDown={(e) => onHandleMouseDown(e, s.id, idx)}
                            onDoubleClick={(e) => onHandleDoubleClick(e, s.id, idx)}
                            onContextMenu={(e) => onHandleContextMenu?.(e, s.id, idx)}
                            style={{ cursor: "grab" }}
                          />
                        </g>
                      ))}
                    </>
                  )}
                </g>
              );
            })}

            {svgOverlays.map((o) => {
              const isSel = selectedOverlayIds.includes(o.id);
              const showHandles = singleSelectedOverlayId === o.id;

              return (
                <g
                  key={o.id}
                  data-overlay-id={o.id}
                  onDoubleClick={(e) => onOverlayDoubleClick?.(e, o.id)}
                >
                <g
                  ref={(node) => setOverlayRef(o.id, node)}
                  transform={`translate(${o.tx} ${o.ty}) scale(${overlayScaleX(o)} ${overlayScaleY(o)})`}
                  onMouseDown={(e) => {
                    if (liveClickable && o.widget) return;
                    onOverlayMouseDown(e, o.id);
                  }}
                  onDoubleClick={(e) => {
                    if (liveClickable && o.widget) return;
                    onOverlayDoubleClick?.(e, o.id);
                  }}
                  onMouseEnter={() => setHoverOverlayId(o.id)}
                  onMouseLeave={() => setHoverOverlayId((prev) => (prev === o.id ? null : prev))}
                  style={{
                      cursor: liveClickable ? "pointer" : tool === "select" ? "move" : "crosshair",
                      pointerEvents: o.widget ? "all" : "visiblePainted",
                    }}
                  >
                    {(() => {
                      if (o.widget) {
                        const bb = o?.bbox || { x: 0, y: 0, width: 320, height: 180 };
                        const widgetKind = String(o?.widget?.kind || "").trim();
                        const isCountdownBar = widgetKind === "countdownBar";
                        const wx = Number(bb.x) || 0;
                        const wy = Number(bb.y) || 0;
                        const ww = Math.max(80, Number(bb.width) || 320);
                        const wh = Math.max(60, Number(bb.height) || 180);
                        return (
                          <g style={{ pointerEvents: "visiblePainted" }}>
                            <rect
                              x={wx}
                              y={wy}
                              width={ww}
                              height={wh}
                              rx={12}
                              fill={isCountdownBar ? "transparent" : "var(--bg-elev)"}
                              stroke={isCountdownBar ? "none" : "var(--border)"}
                              strokeWidth={2}
                            />
                          </g>
                        );
                      }
                      const tagFill = getTagColor(o.tagPath);
                      const routeStroke = getRouteStrokeColorForOverlay(o);
                      if (tagFill) {
                        const key = String(o.tagPath || o.id || "");
                        const prev = lastTagColorRef.current.get(key);
                        if (prev !== tagFill) {
                          lastTagColorRef.current.set(key, tagFill);
                        }
                      }
                      const useForcedStroke = String(o.strokeMode || "").trim().toLowerCase() === "force";
                      let inner = tagFill
                        ? overrideSvgColors(o.inner, tagFill)
                        : routeStroke
                        ? overrideSvgStrokeOnly(o.inner)
                        : useForcedStroke
                        ? overrideSvgStrokeOnly(o.inner)
                        : o.inner;
                      if (!routeStroke) {
                        inner = forceSvgStrokeColor(inner, themeStrokeDefault);
                      }
                      return (
                        <g
                          style={{
                            fill: tagFill || o.fill || "none",
                            stroke: routeStroke || themeStrokeDefault,
                            strokeWidth:
                              Number.isFinite(Number(o.strokeWidth)) && Number(o.strokeWidth) > 0
                                ? Number(o.strokeWidth)
                                : undefined,
                            pointerEvents: "visiblePainted",
                          }}
                          dangerouslySetInnerHTML={{ __html: inner }}
                        />
                      );
                    })()}
                    {o.widget ? renderWidgetOverlay(o) : null}
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

                  {isSel && showHandles && overlaySelectionUI(o, z)}
                  {isSel && !showHandles && (
                    <>
                      {(() => {
                        const bb = overlayLocalBBox(o.id);
                        if (!bb) return null;
                        const wr = overlayWorldRect(o, bb);
                        const x = wr.x;
                        const y = wr.y;
                        const w = wr.w;
                        const h = wr.h;
                        return (
                          <rect
                            x={x}
                            y={y}
                            width={w}
                            height={h}
                            fill="none"
                            stroke="#2b6cff"
                            strokeWidth={2}
                            strokeDasharray="6 4"
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="none"
                          />
                        );
                      })()}
                    </>
                  )}
                </g>
              );
            })}
            {selectedOverlayIds?.length > 1 && selectedIds?.length === 0 && overlayGroupSelectionUI
              ? overlayGroupSelectionUI(z)
              : null}

            {collabCursors.length > 0 && (
              <g pointerEvents="none">
                {collabCursors.map((c) => {
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

            {showTagPaths && (
              <g>
                {(() => {
                  return shapes.map((s) => {
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
                  if (s.type === "rect") {
                    const x = Number(s.x ?? 0) + Math.max(0, Number(s.width ?? 0)) / 2;
                    const anchorY = Number(s.y ?? 0) + yOffset;
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
                });
                })()}
                {(() => {
                  return svgOverlays.map((o) => {
                  if (hiddenBubbleSet.has(o.id)) return null;
                  const text = getOverlayGroupLabel(o);
                  const live = getLiveValuesForOverlay(o);
                  const groupLive = getGroupRouteStateForTagPath(o?.tagPath);
                  const lines = [];
                  if (text) lines.push(text);
                  if (live?.routeId || groupLive.routeId) {
                    lines.push(`RouteID: ${live?.routeId || groupLive.routeId}`);
                  }
                  if (live?.state || groupLive.state) {
                    lines.push(`State: ${live?.state || groupLive.state}`);
                  }
                  if (!lines.length) return null;
                  const bb = o?.bbox || overlayLocalBBox(o.id);
                  if (!bb) return null;
                  const sx = overlayScaleX(o);
                  const sy = overlayScaleY(o);
                  const x = o.tx + sx * (bb.x + bb.width / 2);
                  const anchorY = o.ty + sy * bb.y;
                  return renderTagBubble({
                    key: `tag-${o.id}`,
                    bubbleId: o.id,
                    x,
                    anchorY,
                    lines,
                    anchor: "middle",
                  });
                });
                })()}
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
                <Line key={layer.chartKey} data={layer.lineLikeData} options={layer.lineOptions} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
