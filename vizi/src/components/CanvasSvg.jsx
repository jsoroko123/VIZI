// src/components/CanvasSvg.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { GRID, pointsToAttr } from "../utils/geometry";

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
  editingId,
  onSvgMouseDown,
  onMouseMove,
  onMouseUp,
  onContextMenu,
  onShapeMouseDown,
  onShapeDoubleClick,
  onEditPolylineClick,
  onHandleMouseDown,
  onHandleDoubleClick,
  vbW,
  vbH,
  svgOverlays,
  setSvgOverlays, // ✅ ADD: pass from App.jsx
  selectedOverlayIds,
  singleSelectedOverlayId,
  setOverlayRef,
  onOverlayMouseDown,
  overlaySelectionUI,
  overlayLocalBBox,
  importAnchor,
  onCanvasDoubleClick,
  onSvgDoubleClick, // ✅ used in TopRuler + main svg
}) {
  const vb = useMemo(() => `0 0 ${vbW} ${vbH}`, [vbW, vbH]);
  const isLineMode = tool === "polyline";
  const isCrosshair = isLineMode || marquee;

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
  }, [selectedIds, selectedOverlayIds, zoom, setShapes, setSvgOverlays]);

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
          stroke="#666"
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
            fill="#333"
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
          background: "#f3f3f3",
          borderBottom: "1px solid #cfcfcf",
          pointerEvents: "none",
          zIndex: 10,
          userSelect: "none",
          WebkitUserSelect: "none",
          MozUserSelect: "none",
        }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget) return;
          onSvgDoubleClick?.(e);
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#f3f3f3" />
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
          stroke="#666"
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
            fill="#333"
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
          background: "#f3f3f3",
          borderLeft: "1px solid #cfcfcf",
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        <rect x={0} y={0} width={W} height={H} fill="#f3f3f3" />
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
          background: "#f3f3f3",
          borderLeft: "1px solid #cfcfcf",
          borderBottom: "1px solid #cfcfcf",
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
            background: "#fff",
            outline: "none",
            cursor: isCrosshair ? "crosshair" : "default",
          }}
          onWheel={onWheel}
          onMouseDown={onSvgMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          // ✅ NEW: forward dblclick on main svg (finish line in App)
          onDoubleClick={(e) => {
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
            <path
              d={gridPathD}
              fill="none"
              stroke="#d0d0d0"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />

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

              const lineStyle = s.lineStyle ?? "solid";
              const styleProps = strokeStyleProps(lineStyle, s.strokeWidth);

              const arrowStart = s.arrowStart ?? "none";
              const arrowEnd = s.arrowEnd ?? "none";

              const ptsForDisplay = pointsForMarker(s.points);

              if (s.type === "text") {
                const selected = selectedIds.includes(s.id);
                const isEditing = editingId === s.id;

                return (
                  <g
                    key={s.id}
                    onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                    onDoubleClick={(e) => onShapeDoubleClick(e, s.id)}
                    style={{ cursor: tool === "select" ? "move" : "default" }}
                  >
                    <text
                      x={s.x}
                      y={s.y}
                      fill={s.fill || "#111"}
                      fontSize={s.fontSize || 24}
                      fontFamily={s.fontFamily || "system-ui"}
                      textAnchor={s.anchor || "start"}
                      dominantBaseline="text-before-edge"
                      style={{ userSelect: "none" }}
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

              return (
                <g key={s.id}>
                  <polyline
                    points={pointsToAttr(s.points)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(16, (s.strokeWidth || 3) * 5)}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                    onDoubleClick={(e) => onShapeDoubleClick(e, s.id)}
                  />

                  <polyline
                    points={pointsToAttr(ptsForDisplay)}
                    fill="none"
                    stroke={isSelected ? "#2b6cff" : s.stroke}
                    strokeWidth={s.strokeWidth}
                    // ✅ Apply styleProps FIRST so our explicit defaults don’t overwrite it
                    {...styleProps}
                    strokeLinejoin={styleProps.strokeLinejoin ?? "round"}
                    strokeLinecap={styleProps.strokeLinecap ?? "round"}
                    markerStart={markerForStart(arrowStart)}
                    markerEnd={markerForEnd(arrowEnd)}
                    onMouseDown={(e) => onShapeMouseDown(e, s.id)}
                    onDoubleClick={(e) => onShapeDoubleClick(e, s.id)}
                  />

                  {isEditing && (
                    <>
                      <polyline
                        points={pointsToAttr(s.points)}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={Math.max(18, (s.strokeWidth || 3) * 6)}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => onEditPolylineClick(e, s.id)}
                      />

                      {s.points.map((pt, idx) => (
                        <g key={`${s.id}-h-${idx}`}>
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={HANDLE_R}
                            fill="white"
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
                <g key={o.id}>
                  <g
                    ref={(node) => setOverlayRef(o.id, node)}
                    transform={`translate(${o.tx} ${o.ty}) scale(${o.scale})`}
                    onMouseDown={(e) => onOverlayMouseDown(e, o.id)}
                    style={{ cursor: "move" }}
                  >
                    <g
                      style={{
                        fill: o.fill ?? "none",
                        stroke: o.stroke ?? "none",
                      }}
                      dangerouslySetInnerHTML={{ __html: o.inner }}
                    />
                  </g>

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
