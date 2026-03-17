import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

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

const hoverSummaryPlugin = {
  id: "viziHoverSummary",
  afterDraw(chart, _args, pluginOptions) {
    const tooltip = chart?.tooltip;
    const active = typeof tooltip?.getActiveElements === "function" ? tooltip.getActiveElements() : [];
    if (!Array.isArray(active) || active.length === 0) return;
    const area = chart?.chartArea;
    const ctx = chart?.ctx;
    const data = chart?.data;
    if (!area || !ctx || !data) return;
    const index = Number(active[0]?.index);
    if (!Number.isFinite(index) || index < 0) return;
    const labels = Array.isArray(data.labels) ? data.labels : [];
    const datasets = Array.isArray(data.datasets) ? data.datasets : [];
    const title = String(labels[index] || "--:--:--");
    const rows = datasets
      .map((ds) => {
        const values = Array.isArray(ds?.data) ? ds.data : [];
        const v = Number(values[index]);
        if (!Number.isFinite(v)) return null;
        return {
          label: String(ds?.label || "Series"),
          value: Number.isInteger(v) ? String(v) : v.toFixed(2),
          color: String(ds?.borderColor || ds?.backgroundColor || "#94a3b8"),
        };
      })
      .filter(Boolean);
    if (!rows.length) return;
    ctx.save();
    const font = String(pluginOptions?.font || "11px sans-serif");
    ctx.font = font;
    const lineHeight = Number(pluginOptions?.lineHeight) > 0 ? Number(pluginOptions.lineHeight) : 14;
    const padding = Number(pluginOptions?.padding) > 0 ? Number(pluginOptions.padding) : 8;
    const gap = Number(pluginOptions?.gap) > 0 ? Number(pluginOptions.gap) : 10;
    const swatch = Number(pluginOptions?.swatchSize) > 0 ? Number(pluginOptions.swatchSize) : 8;
    const maxRows = Number(pluginOptions?.maxRows) > 0 ? Number(pluginOptions.maxRows) : 12;
    const textColor = String(pluginOptions?.textColor || "#e2e8f0");
    const bgColor = String(pluginOptions?.bgColor || "rgba(2,6,23,0.86)");
    const borderColor = String(pluginOptions?.borderColor || "rgba(148,163,184,0.38)");
    const showRows = rows.slice(0, maxRows);
    const clippedCount = rows.length - showRows.length;
    const widths = [ctx.measureText(title).width];
    showRows.forEach((r) => widths.push(ctx.measureText(`${r.label}: ${r.value}`).width + swatch + 6));
    if (clippedCount > 0) widths.push(ctx.measureText(`+${clippedCount} more`).width);
    const boxW = Math.ceil(Math.max(...widths, 140) + padding * 2);
    const boxH = Math.ceil((showRows.length + 1 + (clippedCount > 0 ? 1 : 0)) * lineHeight + padding * 2);
    const x = Math.round(area.right - boxW - gap);
    const y = Math.round(area.top + gap);
    const radius = 8;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + boxW - radius, y);
    ctx.quadraticCurveTo(x + boxW, y, x + boxW, y + radius);
    ctx.lineTo(x + boxW, y + boxH - radius);
    ctx.quadraticCurveTo(x + boxW, y + boxH, x + boxW - radius, y + boxH);
    ctx.lineTo(x + radius, y + boxH);
    ctx.quadraticCurveTo(x, y + boxH, x, y + boxH - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = textColor;
    let rowY = y + padding + lineHeight - 3;
    ctx.fillText(title, x + padding, rowY);
    showRows.forEach((r) => {
      rowY += lineHeight;
      ctx.fillStyle = r.color;
      ctx.fillRect(x + padding, rowY - swatch + 2, swatch, swatch);
      ctx.fillStyle = textColor;
      ctx.fillText(`${r.label}: ${r.value}`, x + padding + swatch + 6, rowY);
    });
    if (clippedCount > 0) {
      rowY += lineHeight;
      ctx.fillStyle = "rgba(148,163,184,0.9)";
      ctx.fillText(`+${clippedCount} more`, x + padding, rowY);
    }
    ctx.restore();
  },
};

const COLORS = [
  "#2563eb",
  "#0891b2",
  "#16a34a",
  "#dc2626",
  "#9333ea",
  "#ea580c",
  "#0d9488",
  "#4f46e5",
];
const TREND_SPLIT_WIDTH_KEY = "vizi_live_trend_split_left_w";
const ONE_HOUR_MS = 60 * 60 * 1000;
const MIN_TREND_RANGE_MS = 5 * 60 * 1000;

function normalizeTag(raw) {
  return String(raw || "").trim();
}

function splitTags(raw) {
  if (Array.isArray(raw)) return raw.map(normalizeTag).filter(Boolean);
  return String(raw || "")
    .split(/\r?\n|,/)
    .map(normalizeTag)
    .filter(Boolean);
}

function uniqTags(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const t = normalizeTag(raw);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function formatTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "--:--:--";
  return new Date(n).toLocaleTimeString();
}

function toDatetimeLocalInput(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "";
  const d = new Date(n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function parseDatetimeLocalInput(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function toNumberOrNull(value) {
  if (value == null) return null;
  if (typeof value === "boolean") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (value != null && typeof value === "object") {
    const candidates = [value.value, value.v, value.state, value.State, value.rawValue, value.raw];
    for (const c of candidates) {
      const n = toNumberOrNull(c);
      if (n != null) return n;
    }
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function LiveTrendBuilderPage({
  opcTags = [],
  opcLiveValues = {},
  savedTrends = [],
  onSaveTrend,
  onDeleteTrend,
  theme = "dark",
}) {
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [trendName, setTrendName] = useState("");
  const seriesRef = useRef(new Map());
  const [tick, setTick] = useState(0);
  const liveKeyListRef = useRef([]);
  const [trendTagKeys, setTrendTagKeys] = useState([]);
  const [leftPaneWidth, setLeftPaneWidth] = useState(() => {
    if (typeof window === "undefined") return 320;
    try {
      const raw = Number(window.localStorage.getItem(TREND_SPLIT_WIDTH_KEY));
      return Number.isFinite(raw) && raw >= 260 ? Math.round(raw) : 320;
    } catch {
      return 320;
    }
  });
  const splitRootRef = useRef(null);
  const splitterDragRef = useRef({ active: false, startX: 0, startWidth: 320 });
  const [rangeFromInput, setRangeFromInput] = useState(() => toDatetimeLocalInput(Date.now() - 24 * 60 * 60 * 1000));
  const [rangeToInput, setRangeToInput] = useState(() => toDatetimeLocalInput(Date.now()));
  const [appliedRange, setAppliedRange] = useState(() => ({
    from: Date.now() - 24 * 60 * 60 * 1000,
    to: Date.now(),
  }));
  const setLast24HoursFromNow = () => {
    const now = Date.now();
    setAppliedRangeAndInputs(now - 24 * 60 * 60 * 1000, now);
  };

  const setAppliedRangeAndInputs = (fromRaw, toRaw) => {
    let from = Number(fromRaw);
    let to = Number(toRaw);
    const now = Date.now();
    if (!Number.isFinite(from) || !Number.isFinite(to)) {
      to = now;
      from = to - 24 * 60 * 60 * 1000;
    }
    if (from > to) {
      const t = from;
      from = to;
      to = t;
    }
    if (to - from < MIN_TREND_RANGE_MS) from = to - MIN_TREND_RANGE_MS;
    setRangeFromInput(toDatetimeLocalInput(from));
    setRangeToInput(toDatetimeLocalInput(to));
    setAppliedRange({ from, to });
  };

  const zoomRangeByHour = (hoursDelta) => {
    const from = Number(appliedRange?.from);
    const to = Number(appliedRange?.to);
    const now = Date.now();
    const safeTo = Number.isFinite(to) ? to : now;
    const safeFrom = Number.isFinite(from) ? from : safeTo - 24 * 60 * 60 * 1000;
    const currentSpan = Math.max(MIN_TREND_RANGE_MS, safeTo - safeFrom);
    const nextSpan = Math.max(MIN_TREND_RANGE_MS, currentSpan + Number(hoursDelta || 0) * ONE_HOUR_MS);
    const nextFrom = safeTo - nextSpan;
    setAppliedRangeAndInputs(nextFrom, safeTo);
  };

  const allTagPaths = useMemo(() => {
    if (Array.isArray(trendTagKeys) && trendTagKeys.length) {
      return uniqTags(trendTagKeys).sort((a, b) => a.localeCompare(b));
    }
    const out = [];
    const push = (raw) => {
      const v = normalizeTag(raw);
      if (!v) return;
      out.push(v);
    };
    (Array.isArray(opcTags) ? opcTags : []).forEach((t) => {
      const topic = normalizeTag(t?.topic);
      const group = normalizeTag(t?.groupName);
      const member = normalizeTag(t?.tagPath || t?.name);
      if (topic && group && member) push(`${topic}.${group}.${member}`);
      if (topic && member) push(`${topic}.${member}`);
      if (group && member) push(`${group}.${member}`);
      if (member) push(member);
    });
    Object.keys(opcLiveValues || {}).forEach((k) => push(k));
    return uniqTags(out).sort((a, b) => a.localeCompare(b));
  }, [opcTags, opcLiveValues, trendTagKeys]);

  const filteredTags = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return allTagPaths;
    return allTagPaths.filter((t) => t.toLowerCase().includes(q));
  }, [allTagPaths, query]);

  const addTag = (raw) => {
    const tag = normalizeTag(raw);
    if (!tag) return;
    setSelectedTags((prev) => uniqTags([...prev, tag]));
  };

  const removeTag = (raw) => {
    const target = normalizeTag(raw).toLowerCase();
    setSelectedTags((prev) => prev.filter((t) => t.toLowerCase() !== target));
    seriesRef.current.delete(target);
  };

  useEffect(() => {
    liveKeyListRef.current = Object.keys(opcLiveValues || {})
      .map((k) => String(k || "").trim())
      .filter(Boolean);
  }, [opcLiveValues]);

  useEffect(() => {
    let alive = true;
    const loadTrendTagKeys = async () => {
      try {
        const res = await fetch("/api/opc/trends/tags");
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !alive) return;
        const keys = (Array.isArray(payload?.tags) ? payload.tags : [])
          .map((row) => String(row?.tagKey || "").trim())
          .filter(Boolean);
        setTrendTagKeys(uniqTags(keys));
      } catch {
        // ignore; page can still work from live keys
      }
    };
    void loadTrendTagKeys();
    const id = setInterval(() => {
      void loadTrendTagKeys();
    }, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const normalizePoints = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .map((p) => ({ t: Number(p?.t) || 0, v: toNumberOrNull(p?.v) }))
        .filter((p) => p.t > 0 && Number.isFinite(p.v));
    const buildCandidates = (rawTagPath) => {
      const tagPath = String(rawTagPath || "").trim();
      if (!tagPath) return [];
      const out = [];
      const push = (v) => {
        const s = String(v || "").trim();
        if (!s) return;
        if (!out.includes(s)) out.push(s);
      };
      push(tagPath);
      if (!tagPath.toLowerCase().startsWith("default.")) push(`Default.${tagPath}`);
      const lower = tagPath.toLowerCase();
      (Array.isArray(trendTagKeys) ? trendTagKeys : []).forEach((k) => {
        const key = String(k || "").trim();
        if (!key) return;
        const keyLower = key.toLowerCase();
        if (keyLower === lower || keyLower.endsWith(`.${lower}`)) push(key);
      });
      liveKeyListRef.current.forEach((k) => {
        const key = String(k || "").trim();
        if (!key) return;
        const keyLower = key.toLowerCase();
        if (keyLower === lower || keyLower.endsWith(`.${lower}`)) push(key);
      });
      return out;
    };
    const loadBestTrend = async (tagPath, from, to) => {
      const candidates = buildCandidates(tagPath);
      let bestPoints = [];
      let bestScore = -1;
      for (const tagKey of candidates) {
        const q = new URLSearchParams({
          tagKey: String(tagKey),
          from: String(from),
          to: String(to),
          maxPoints: "1200",
        });
        try {
          const res = await fetch(`/api/opc/trends?${q.toString()}`);
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) continue;
          const pts = normalizePoints(payload?.points);
          const total = Number(payload?.totalPoints);
          const score = Number.isFinite(total) ? total : pts.length;
          if (pts.length > bestPoints.length || (pts.length === bestPoints.length && score > bestScore)) {
            bestPoints = pts;
            bestScore = score;
          }
        } catch {
          // ignore and try next candidate
        }
      }
      return bestPoints;
    };
    const refresh = async () => {
      if (!selectedTags.length) return;
      const now = Date.now();
      let from = Number(appliedRange?.from);
      let to = Number(appliedRange?.to);
      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        to = now;
        from = to - 24 * 60 * 60 * 1000;
      }
      if (from > to) {
        const t = from;
        from = to;
        to = t;
      }
      const updates = await Promise.all(
        selectedTags.map(async (tagPath) => ({
          key: String(tagPath || "").trim().toLowerCase(),
          points: await loadBestTrend(tagPath, from, to),
        }))
      );
      if (!alive) return;
      let changed = false;
      updates.forEach(({ key, points }) => {
        if (!key) return;
        const prev = Array.isArray(seriesRef.current.get(key)) ? seriesRef.current.get(key) : [];
        const same =
          prev.length === points.length &&
          prev.every((p, idx) => Number(p?.t) === Number(points[idx]?.t) && Number(p?.v) === Number(points[idx]?.v));
        if (!same) {
          if (points.length) seriesRef.current.set(key, points);
          else seriesRef.current.delete(key);
          changed = true;
        }
      });
      if (changed) setTick((x) => x + 1);
    };
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [selectedTags, opcLiveValues, trendTagKeys, appliedRange]);

  useEffect(() => {
    const onMove = (e) => {
      const drag = splitterDragRef.current;
      if (!drag.active) return;
      const root = splitRootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const dx = (Number(e?.clientX) || 0) - Number(drag.startX || 0);
      const minLeft = 260;
      const maxLeft = Math.max(minLeft, Math.floor(rect.width * 0.62));
      const next = Math.max(minLeft, Math.min(maxLeft, Math.round(Number(drag.startWidth || 320) + dx)));
      setLeftPaneWidth(next);
      e.preventDefault();
    };
    const onUp = () => {
      splitterDragRef.current.active = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(TREND_SPLIT_WIDTH_KEY, String(Math.max(260, Math.round(Number(leftPaneWidth) || 320))));
    } catch {
      // ignore storage failures
    }
  }, [leftPaneWidth]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const appliedTo = Number(appliedRange?.to);
      if (Number.isFinite(appliedTo) && Math.abs(now - appliedTo) > ONE_HOUR_MS) return;
      let changed = false;
      const liveKeys = Object.keys(opcLiveValues || {});
      const findLiveValue = (tagPath) => {
        const direct = toNumberOrNull(opcLiveValues?.[tagPath]);
        if (direct != null) return direct;
        const lower = tagPath.toLowerCase();
        const exact = liveKeys.find((k) => String(k || "").toLowerCase() === lower);
        if (exact) {
          const n = toNumberOrNull(opcLiveValues?.[exact]);
          if (n != null) return n;
        }
        const suffix = liveKeys.find((k) => String(k || "").toLowerCase().endsWith(`.${lower}`));
        if (suffix) {
          const n = toNumberOrNull(opcLiveValues?.[suffix]);
          if (n != null) return n;
        }
        return NaN;
      };
      selectedTags.forEach((tagPath) => {
        const n = findLiveValue(tagPath);
        if (!Number.isFinite(n)) return;
        const key = tagPath.toLowerCase();
        const prev = Array.isArray(seriesRef.current.get(key)) ? seriesRef.current.get(key) : [];
        const last = prev.length ? prev[prev.length - 1] : null;
        if (!last || last.v !== n || now - Number(last.t || 0) >= 2000) {
          const next = [...prev, { t: now, v: n }].slice(-600);
          seriesRef.current.set(key, next);
          changed = true;
        }
      });
      if (changed) setTick((x) => x + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [selectedTags, opcLiveValues, appliedRange]);

  const chartData = useMemo(() => {
    void tick;
    const from = Number(appliedRange?.from);
    const to = Number(appliedRange?.to);
    const hasRange = Number.isFinite(from) && Number.isFinite(to);
    const timeline = Array.from(
      new Set(
        selectedTags.flatMap((tag) =>
          (seriesRef.current.get(tag.toLowerCase()) || [])
            .map((p) => Number(p.t))
            .filter((t) => !hasRange || (t >= Math.min(from, to) && t <= Math.max(from, to)))
        )
      )
    )
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    const labels = timeline.map((t) => formatTime(t));
    const datasets = selectedTags.map((tag, i) => {
      const points = (seriesRef.current.get(tag.toLowerCase()) || []).filter(
        (p) => !hasRange || (Number(p?.t) >= Math.min(from, to) && Number(p?.t) <= Math.max(from, to))
      );
      const byTs = new Map(points.map((p) => [Number(p.t), Number(p.v)]));
      const color = COLORS[i % COLORS.length];
      const visiblePointRadius = points.length <= 2 ? 3 : 0;
      let lastKnown = null;
      const alignedData = timeline.map((t) => {
        if (byTs.has(t)) {
          lastKnown = byTs.get(t);
          return lastKnown;
        }
        return lastKnown;
      });
      return {
        label: tag,
        data: alignedData,
        borderColor: color,
        backgroundColor: color,
        tension: 0.2,
        spanGaps: false,
        pointRadius: visiblePointRadius,
        pointHoverRadius: Math.max(4, visiblePointRadius),
        borderWidth: 2,
      };
    });
    return { labels, datasets };
  }, [selectedTags, tick, appliedRange]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: { mode: "index", intersect: false },
        viziHoverGuide: {
          color: theme === "dark" ? "rgba(148,163,184,0.42)" : "rgba(51,65,85,0.28)",
          lineWidth: 1,
        },
        viziHoverSummary: {
          textColor: theme === "dark" ? "#e2e8f0" : "#0f172a",
          bgColor: theme === "dark" ? "rgba(2,6,23,0.88)" : "rgba(248,250,252,0.95)",
          borderColor: theme === "dark" ? "rgba(148,163,184,0.38)" : "rgba(100,116,139,0.4)",
        },
      },
      scales: {
        x: { grid: { color: theme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(100,116,139,0.2)" } },
        y: { grid: { color: theme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(100,116,139,0.2)" } },
      },
    }),
    [theme]
  );

  const onDropTag = (e) => {
    e.preventDefault();
    const custom = String(e.dataTransfer?.getData("application/x-vizi-trend-tag") || "").trim();
    if (custom) {
      addTag(custom);
      return;
    }
    const text = String(e.dataTransfer?.getData("text/plain") || "").trim();
    if (text.toLowerCase().startsWith("vizi-trend-tag:")) {
      addTag(text.slice("vizi-trend-tag:".length));
    }
  };

  const selectedSummary = selectedTags.length ? selectedTags.join(", ") : "";

  return (
    <div ref={splitRootRef} style={{ height: "100%", display: "grid", gridTemplateColumns: `${Math.round(leftPaneWidth)}px 8px 1fr`, gap: 0, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 8, minHeight: 0 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", padding: 8, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 8, minHeight: 0 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags..."
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-elev)", color: "var(--text)" }}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Drag tags into graph area</div>
          <div className="vizi-scroll" style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10, padding: 6, background: "var(--bg)" }}>
            {filteredTags.map((tag) => (
              <div
                key={tag}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer?.setData("application/x-vizi-trend-tag", tag);
                  e.dataTransfer?.setData("text/plain", `vizi-trend-tag:${tag}`);
                }}
                onDoubleClick={() => addTag(tag)}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "6px 8px",
                  marginBottom: 6,
                  background: "var(--bg-elev)",
                  fontSize: 12,
                  cursor: "grab",
                }}
                title="Drag to graph or double-click to add"
              >
                {tag}
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", padding: 8, display: "grid", gridTemplateRows: "auto auto 1fr", gap: 8, minHeight: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800 }}>Saved Trends</div>
          <div style={{ display: "grid", gap: 6 }}>
            <input
              value={trendName}
              onChange={(e) => setTrendName(e.target.value)}
              placeholder="Trend name..."
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg)", color: "var(--text)" }}
            />
            <button
              onClick={() => onSaveTrend?.(trendName, selectedTags)}
              disabled={!selectedTags.length}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontWeight: 700 }}
            >
              Save Trend
            </button>
          </div>
          <div className="vizi-scroll" style={{ overflow: "auto", display: "grid", gap: 4 }}>
            {(Array.isArray(savedTrends) ? savedTrends : []).map((item) => (
              <div key={String(item?.id || item?.name || Math.random())} style={{ border: "1px solid var(--border)", borderRadius: 7, padding: "4px 6px", background: "var(--bg)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {String(item?.name || "Trend")}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                      {splitTags(item?.tags).join(", ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTags(uniqTags(splitTags(item?.tags)));
                      setLast24HoursFromNow();
                    }}
                    title="Load trend"
                    aria-label="Load trend"
                    style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-elev)", color: "var(--text)", width: 24, height: 20, display: "grid", placeItems: "center", padding: 0, cursor: "pointer" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M12 3v12m0 0-4-4m4 4 4-4M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteTrend?.(item?.id)}
                    title="Delete trend"
                    aria-label="Delete trend"
                    style={{ border: "1px solid #ef4444", borderRadius: 6, background: "#ef4444", color: "#fff", width: 24, height: 20, display: "grid", placeItems: "center", padding: 0, cursor: "pointer" }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M4 7h16M10 11v6m4-6v6M7 7l1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
                </div>
              </div>
            ))}
            {!savedTrends?.length ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No saved trends yet.</div>
            ) : null}
          </div>
        </div>
      </div>

      <div
        onMouseDown={(e) => {
          splitterDragRef.current = {
            active: true,
            startX: Number(e?.clientX) || 0,
            startWidth: Number(leftPaneWidth) || 320,
          };
          e.preventDefault();
        }}
        style={{
          cursor: "col-resize",
          background: "transparent",
          position: "relative",
          userSelect: "none",
        }}
        title="Resize panels"
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: 2,
            transform: "translateX(-50%)",
            background: "var(--border)",
            borderRadius: 2,
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateRows: "auto 1fr auto auto", gap: 10, minHeight: 0, paddingLeft: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto auto auto", gap: 8, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
            <span>From</span>
            <input
              type="datetime-local"
              value={rangeFromInput}
              onChange={(e) => setRangeFromInput(String(e.target.value || ""))}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", background: "var(--bg-elev)", color: "var(--text)" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
            <span>To</span>
            <input
              type="datetime-local"
              value={rangeToInput}
              onChange={(e) => setRangeToInput(String(e.target.value || ""))}
              style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", background: "var(--bg-elev)", color: "var(--text)" }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              const now = Date.now();
              const nextFrom = parseDatetimeLocalInput(rangeFromInput);
              const nextTo = parseDatetimeLocalInput(rangeToInput);
              setAppliedRangeAndInputs(
                Number.isFinite(nextFrom) ? nextFrom : now - 24 * 60 * 60 * 1000,
                Number.isFinite(nextTo) ? nextTo : now
              );
            }}
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", background: "var(--bg-elev)", color: "var(--text)", cursor: "pointer", fontWeight: 700, height: 32 }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => zoomRangeByHour(-1)}
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", background: "var(--bg-elev)", color: "var(--text)", cursor: "pointer", fontWeight: 700, height: 32 }}
            title="Zoom in 1 hour"
          >
            -1h
          </button>
          <button
            type="button"
            onClick={() => zoomRangeByHour(1)}
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", background: "var(--bg-elev)", color: "var(--text)", cursor: "pointer", fontWeight: 700, height: 32 }}
            title="Zoom out 1 hour"
          >
            +1h
          </button>
          <button
            type="button"
            onClick={setLast24HoursFromNow}
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "7px 10px", background: "var(--bg-elev)", color: "var(--text)", cursor: "pointer", fontWeight: 700, height: 32 }}
          >
            Last 24h
          </button>
        </div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={onDropTag}
          style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-elev)", minHeight: 0, padding: 10 }}
        >
          <div style={{ width: "100%", height: "100%" }}>
            <Line data={chartData} options={chartOptions} plugins={[hoverGuidePlugin, hoverSummaryPlugin]} />
          </div>
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", padding: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 800, marginBottom: 6 }}>Selected Tags</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {selectedTags.length ? (
              selectedTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => removeTag(tag)}
                  style={{ border: "1px solid #ef4444", borderRadius: 999, background: "#ef4444", color: "#fff", padding: "2px 8px", fontSize: 11, cursor: "pointer" }}
                  title="Remove"
                >
                  {tag} x
                </button>
              ))
            ) : (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No tags selected</span>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "none" }}>{selectedSummary}</div>
    </div>
  );
}
