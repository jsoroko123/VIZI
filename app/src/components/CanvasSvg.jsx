// src/components/CanvasSvg.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { GRID, pointsToAttr, bboxOfPoints } from "../utils/geometry";

const RULER = 24; // ruler thickness (px)

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
  overlayLocalBBox,
  importAnchor,
  onCanvasDoubleClick,
  tagStateColorsByPath,
  routeColorsBySvgKey,
  routeStrokeColorByGroupPath,
  svgLiveValuesByGroupPath,
  opcLiveValues,
  hiddenTagBubbleIds,
  onHideTagBubble,
  onSvgDoubleClick, // ✅ used in TopRuler + main svg
  collaboratorCursors,
  theme,
}) {
  const vb = useMemo(() => `0 0 ${vbW} ${vbH}`, [vbW, vbH]);
  const isLineMode = tool === "polyline" || tool === "rect";
  const isCrosshair = isLineMode || marquee;
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

  const getLiveValueForTagPath = (rawTagPath) => {
    const tagPath = String(rawTagPath || "").replace(/\r?\n/g, "").trim();
    if (!tagPath) return "";

    const candidates = [tagPath];
    const parts = tagPath.split(".").map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      candidates.push(parts.slice(i).join("."));
    }
    candidates.push(`Default.${tagPath}`);

    for (const key of candidates) {
      const direct = liveLookup.get(key);
      if (direct != null && direct !== "") return String(direct);
      const lower = liveLookup.get(String(key).toLowerCase());
      if (lower != null && lower !== "") return String(lower);
    }

    // Fallback: overlay tagPath may be a group path (e.g. Default.Group).
    // In that case, find a live value under that group key prefix.
    for (const groupKey of candidates) {
      const prefix = `${String(groupKey).toLowerCase()}.`;
      const preferred = [
        `${prefix}state`,
        `${prefix}stcode`,
        `${prefix}status`,
        `${prefix}routeid`,
        `${prefix}routenumber`,
        `${prefix}value`,
      ];
      for (const k of preferred) {
        const v = liveLookup.get(k);
        if (v != null && v !== "") return String(v);
      }
      for (const [k, v] of liveLookup.entries()) {
        if (typeof k !== "string") continue;
        if (!k.startsWith(prefix)) continue;
        if (v != null && v !== "") return String(v);
      }
    }
    return "";
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
      state: findBySuffixes(["state", "stcode", "status", "stat"]),
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

  const getOverlayColorAtPoint = (pt) => {
    if (!pt || !svgOverlays?.length) return "";
    for (const o of svgOverlays) {
      const color = getRouteColorForOverlay(o) || getTagColor(o.tagPath);
      if (!color) continue;
      const bb = overlayLocalBBox(o.id);
      if (!bb) continue;
      const x = o.tx + o.scale * bb.x;
      const y = o.ty + o.scale * bb.y;
      const w = o.scale * bb.width;
      const h = o.scale * bb.height;
      if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) {
        return color;
      }
    }
    return "";
  };


  // current transform values (WORLD -> SCREEN)
  const z = zoom || 1;
  const panX = pan?.x || 0;
  const panY = pan?.y || 0;

  // SCREEN(px) -> WORLD(units)
  const screenToWorldX = (sx) => (sx - panX) / z;
  const screenToWorldY = (sy) => (sy - panY) / z;

  // WORLD(units) -> SCREEN(px)
  const worldToScreenX = (wx) => wx * z + panX;
  const worldToScreenY = (wy) => wy * z + panY;

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
  const innerW = Math.max(0, (size.w || 0) - RULER);
  const innerH = Math.max(0, (size.h || 0) - RULER);

  const gridPathD = useMemo(() => {
    if (!innerW || !innerH) return "";

    // Visible area in WORLD units (based on current pan/zoom)
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
  }, [innerW, innerH, panX, panY, z]);

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
    const W = Math.max(0, size.w - RULER);
    const H = RULER;

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
    const W = RULER;
    const H = Math.max(0, size.h - RULER);

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
          top: RULER,
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

  return (
    <div
      ref={wrapRef}
      onDoubleClickCapture={(e) => {
        onCanvasDoubleClick?.(e);
      }}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      <TopRuler />
      <RightRuler />

      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: RULER,
          height: RULER,
          background: "var(--bg-soft)",
          borderLeft: "1px solid var(--border)",
          borderBottom: "1px solid var(--border)",
          pointerEvents: "none",
          zIndex: 11,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 0,
          top: RULER,
          right: RULER,
          bottom: 0,
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={vb}
          preserveAspectRatio="xMinYMid meet"
          ref={svgRef}
          tabIndex={0}
          style={{
            display: "block",
            background: "var(--canvas-bg)",
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
                    : dynamicColor || (theme === "dark" ? "#ffffff" : s.stroke || "#111111");
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
                        : touchColor || dynamicColor || (theme === "dark" ? "#ffffff" : s.stroke)
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
                    transform={`translate(${o.tx} ${o.ty}) scale(${o.scale})`}
                    onMouseDown={(e) => onOverlayMouseDown(e, o.id)}
                    onDoubleClick={(e) => onOverlayDoubleClick?.(e, o.id)}
                    onMouseEnter={() => setHoverOverlayId(o.id)}
                    onMouseLeave={() => setHoverOverlayId((prev) => (prev === o.id ? null : prev))}
                    style={{
                      cursor: tool === "select" ? "move" : "crosshair",
                      pointerEvents: "visiblePainted",
                    }}
                  >
                    {(() => {
                      const tagFill = getTagColor(o.tagPath);
                      const routeStroke = getRouteStrokeColorForOverlay(o);
                      if (tagFill) {
                        const key = String(o.tagPath || o.id || "");
                        const prev = lastTagColorRef.current.get(key);
                        if (prev !== tagFill) {
                          // eslint-disable-next-line no-console
                          console.log("SVG tag color changed", { tagPath: o.tagPath, color: tagFill });
                          lastTagColorRef.current.set(key, tagFill);
                        }
                      }
                      const inner = tagFill
                        ? overrideSvgColors(o.inner, tagFill)
                        : routeStroke
                        ? overrideSvgStrokeOnly(o.inner)
                        : o.inner;
                      return (
                        <g
                          style={{
                            fill: tagFill || o.fill || "none",
                            stroke: routeStroke || (o.stroke ?? "none"),
                            pointerEvents: "visiblePainted",
                          }}
                          dangerouslySetInnerHTML={{ __html: inner }}
                        />
                      );
                    })()}
                  </g>

                  {isLineMode && (() => {
                    const bb = overlayLocalBBox(o.id);
                    if (!bb) return null;
                    const x = o.tx + o.scale * bb.x;
                    const y = o.ty + o.scale * bb.y;
                    const w = o.scale * bb.width;
                    const h = o.scale * bb.height;
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
                        const x = o.tx + o.scale * bb.x;
                        const y = o.ty + o.scale * bb.y;
                        const w = o.scale * bb.width;
                        const h = o.scale * bb.height;
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
                  const x = o.tx + o.scale * (bb.x + bb.width / 2);
                  const anchorY = o.ty + o.scale * bb.y;
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
      </div>
    </div>
  );
}
