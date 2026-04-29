// src/components/ImportModal.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { stripOuterSvg } from "../utils/svgSanitize"; // ✅ for clean preview

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

export default function ImportModal({
  importOpen,
  setImportOpen,
  svgFiles,
  onPickSvg,
  svgLibrary, // ✅ NEW
  loadSvgRaw,
  helpText = "",
  librarySummary = "",
  onRefresh = null,
  refreshDisabled = false,
  docked = false,
  absoluteDocked = false,
  appearance = "default",
  attached = false,
  dockLeft = 0,
  dockTop = 0,
  dockBottom = 0,
  dockWidth = 320,
}) {
  const [query, setQuery] = useState("");
  const PREVIEW_CACHE_MAX = 80;

  // ---- Hover preview state ----
  const cacheRef = useRef(new Map()); // key -> { vb, inner } OR null (failed)
  const hoverTimerRef = useRef(null);
  const hoverTokenRef = useRef(0);

  const [hoverKey, setHoverKey] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const [preview, setPreview] = useState(null); // {vb, inner}
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!importOpen) {
      setHoverKey(null);
      setPreview(null);
      setPreviewLoading(false);
      setQuery("");
    }
  }, [importOpen]);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTokenRef.current += 1;
    };
  }, []);

  const darkDrawer = appearance === "ignition-drawer";
  const panelBg = darkDrawer
    ? "linear-gradient(180deg, rgba(6, 12, 28, 0.99) 0%, rgba(10, 18, 36, 0.98) 100%)"
    : "var(--bg-elev, rgba(15, 23, 42, 0.98))";
  const softBg = darkDrawer
    ? "rgba(11, 18, 34, 0.96)"
    : "var(--bg-soft, rgba(15, 23, 42, 0.92))";
  const borderColor = darkDrawer
    ? "rgba(87, 104, 143, 0.78)"
    : "var(--border, rgba(71, 85, 105, 0.9))";
  const textColor = darkDrawer ? "#eef4ff" : "var(--text, #f8fafc)";
  const mutedColor = darkDrawer ? "rgba(200, 214, 236, 0.74)" : "var(--text-muted, rgba(226, 232, 240, 0.72))";
  const rowBg = darkDrawer ? "rgba(13, 22, 40, 0.95)" : softBg;
  const rowBorder = darkDrawer ? "rgba(124, 144, 180, 0.65)" : borderColor;
  const stopInteractiveEvent = (event) => {
    event?.stopPropagation?.();
  };

  const closeBtnStyle = {
    border: `1px solid ${borderColor}`,
    background: softBg,
    borderRadius: 10,
    padding: "4px 8px",
    cursor: "pointer",
    lineHeight: 1,
    color: textColor,
    fontWeight: 700,
  };
  const secondaryBtnStyle = {
    ...closeBtnStyle,
    minWidth: 74,
    fontSize: 12,
    fontWeight: 700,
  };

  const grouped = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
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
  }, [svgFiles, query]);

  function setCachedPreview(fileKey, data) {
    const cache = cacheRef.current;
    if (cache.has(fileKey)) cache.delete(fileKey);
    cache.set(fileKey, data);
    while (cache.size > PREVIEW_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  // ✅ hover loader (lazy, cached, delayed)
  async function loadPreviewForKey(fileKey) {
    if (!svgLibrary) return;

    // cached?
    if (cacheRef.current.has(fileKey)) {
      const hit = cacheRef.current.get(fileKey);
      cacheRef.current.delete(fileKey);
      cacheRef.current.set(fileKey, hit);
      setPreview(hit);
      setPreviewLoading(false);
      return;
    }

    const entry = svgLibrary[fileKey];
    if (!entry) return;

    const myToken = ++hoverTokenRef.current;
    setPreviewLoading(true);

    try {
      const raw = typeof loadSvgRaw === "function"
        ? await loadSvgRaw(fileKey)
        : (typeof entry === "function" ? await entry() : entry);
      if (hoverTokenRef.current !== myToken) return; // stale hover

      const parsed = stripOuterSvg(raw);
      if (!parsed?.inner) {
        setCachedPreview(fileKey, null);
        setPreview(null);
        setPreviewLoading(false);
        return;
      }

      const vb = parsed.vb ? `${parsed.vb.x} ${parsed.vb.y} ${parsed.vb.w} ${parsed.vb.h}` : "0 0 100 100";
      const data = { vb, inner: parsed.inner };

      setCachedPreview(fileKey, data);
      setPreview(data);
    } catch {
      setCachedPreview(fileKey, null);
      setPreview(null);
    } finally {
      if (hoverTokenRef.current === myToken) setPreviewLoading(false);
    }
  }

  function onItemEnter(e, fileKey) {
    setHoverKey(fileKey);
    setPreview(null);

    // position preview near cursor (but inside viewport-ish)
    setHoverPos({ x: e.clientX, y: e.clientY });

    // delay so we don't fetch when skimming
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      loadPreviewForKey(fileKey);
    }, 150);
  }

  function onItemLeave() {
    setHoverKey(null);
    setPreview(null);
    setPreviewLoading(false);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    // bump token so any in-flight hover load gets ignored
    hoverTokenRef.current++;
  }

  function onItemMove(e) {
    setHoverPos({ x: e.clientX, y: e.clientY });
  }

  if (!importOpen) return null;

  const list = Array.isArray(svgFiles) ? svgFiles : [];

  // basic tooltip placement
  const tipW = 220;
  const tipH = 220;
  const pad = 12;
  const left = Math.min(window.innerWidth - tipW - pad, hoverPos.x + 14);
  const top = Math.min(window.innerHeight - tipH - pad, hoverPos.y + 14);

  return (
    <div
      data-vizi-import-drawer={docked ? "1" : undefined}
      style={{
        position: docked && absoluteDocked ? "absolute" : "fixed",
        ...(docked
          ? {
              left: Math.max(0, Number(dockLeft) || 0),
              top: Math.max(0, Number(dockTop) || 0),
              bottom: Math.max(0, Number(dockBottom) || 0),
              width: Math.max(240, Number(dockWidth) || 320),
              zIndex: 118,
              padding: 0,
              pointerEvents: "auto",
            }
          : {
              inset: 0,
              background: "rgba(0,0,0,0.25)",
              zIndex: 40,
              display: "grid",
              placeItems: "center",
              padding: 16,
            }),
      }}
      onMouseDown={docked ? undefined : () => setImportOpen(false)}
    >
      <div
        style={{
          width: docked ? "100%" : "min(560px, 92vw)",
          height: docked ? "100%" : undefined,
          minHeight: docked ? "100%" : "min(520px, 80vh)",
          maxHeight: docked ? "100%" : "min(520px, 80vh)",
          background: panelBg,
          borderRadius: docked ? (attached ? "0 18px 18px 0" : 18) : 16,
          border: `1px solid ${borderColor}`,
          boxShadow: docked
            ? (attached ? "18px 14px 36px rgba(2, 6, 23, 0.28)" : "24px 0 40px rgba(0,0,0,0.28)")
            : "0 14px 50px rgba(0,0,0,0.22)",
          position: "relative",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="vizi-scroll"
          style={{
            maxHeight: docked ? "100%" : "min(520px, 80vh)",
            height: docked ? "100%" : undefined,
            overflow: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            paddingRight: 26,
            marginRight: -26,
            boxSizing: "border-box",
          }}
          onWheel={(e) => e.stopPropagation()}
        >
          <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: panelBg,
            padding: 16,
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: textColor, letterSpacing: "0.01em" }}>Import SVG</div>
            <div style={{ display: "flex", gap: 8 }}>
              {typeof onRefresh === "function" ? (
                <button
                  type="button"
                  title="Refresh SVG library"
                  onPointerDown={stopInteractiveEvent}
                  onMouseDown={stopInteractiveEvent}
                  onClick={onRefresh}
                  disabled={refreshDisabled}
                  style={{
                    ...secondaryBtnStyle,
                    opacity: refreshDisabled ? 0.72 : 1,
                    cursor: refreshDisabled ? "default" : "pointer",
                  }}
                >
                  {refreshDisabled ? "Refreshing" : "Refresh"}
                </button>
              ) : null}
              <button
                title="Close"
                onPointerDown={stopInteractiveEvent}
                onMouseDown={stopInteractiveEvent}
                onClick={() => setImportOpen(false)}
                style={closeBtnStyle}
              >
                X
              </button>
            </div>
          </div>

          <div style={{ marginTop: 6, color: mutedColor, fontSize: 13, fontWeight: 800 }}>
            SVG Templates
          </div>
          {librarySummary ? (
            <div style={{ marginTop: 6, color: mutedColor, fontSize: 11, lineHeight: 1.35 }}>
              {librarySummary}
            </div>
          ) : null}
          {helpText ? (
            <div
              style={{
                marginTop: 10,
                border: `1px solid ${borderColor}`,
                background: softBg,
                borderRadius: 12,
                padding: "10px 12px",
                color: textColor,
                fontSize: 11,
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "Consolas, 'Courier New', monospace",
              }}
            >
              {helpText}
            </div>
          ) : null}

          <div style={{ marginTop: 10 }}>
            <div style={{ position: "relative" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onPointerDown={stopInteractiveEvent}
                onMouseDown={stopInteractiveEvent}
                onClick={stopInteractiveEvent}
                onDoubleClick={stopInteractiveEvent}
                onKeyDown={stopInteractiveEvent}
                onKeyUp={stopInteractiveEvent}
                onWheel={stopInteractiveEvent}
                placeholder="Search..."
                autoComplete="off"
                spellCheck={false}
                style={{
                  width: "100%",
                  border: `1px solid ${borderColor}`,
                  background: softBg,
                  borderRadius: 12,
                  padding: "8px 30px 8px 10px",
                  color: textColor,
                  outline: "none",
                  fontSize: 13,
                  fontWeight: 600,
                  boxShadow: darkDrawer ? "inset 0 1px 0 rgba(255,255,255,0.04)" : "none",
                  boxSizing: "border-box",
                }}
              />
              {query && (
                <button
                  type="button"
                  title="Clear"
                  onPointerDown={stopInteractiveEvent}
                  onMouseDown={stopInteractiveEvent}
                  onClick={() => setQuery("")}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 20,
                    height: 20,
                    borderRadius: 8,
                    border: `1px solid ${borderColor}`,
                    background: softBg,
                    cursor: "pointer",
                    lineHeight: 1,
                    color: textColor,
                    padding: 0,
                  }}
                >
                  X
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: "12px 18px 16px 14px" }}>
          <div style={{ marginTop: 0, display: "grid", gap: 8, color: mutedColor }}>
            {list.length === 0 ? (
              <div style={{ color: mutedColor, fontSize: 13 }}>
                No SVGs found. {helpText ? "Add files to the external folder above and click Refresh." : "Put files in src/assets/SVG Files."}
              </div>
            ) : grouped.length === 0 ? (
              <div style={{ color: mutedColor, fontSize: 13 }}>No matches.</div>
            ) : (
              grouped.map((group) => (
                <div key={group.folder} style={{ display: "grid", gap: 8 }}>
                  <div style={{ color: mutedColor, fontSize: 11, fontWeight: 800, padding: "2px 2px" }}>
                    {group.folder}
                  </div>

                  {group.files.map((f) => (
                    <button
                      key={f.key}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPickSvg(f.key);
                      }}
                      onMouseEnter={(e) => onItemEnter(e, f.key)}
                      onMouseMove={onItemMove}
                      onMouseLeave={onItemLeave}
                      style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: `1px solid ${rowBorder}`,
                    background: rowBg,
                    cursor: "pointer",
                    color: textColor,
                    fontSize: 13,
                    fontWeight: 600,
                    boxShadow: darkDrawer ? "inset 0 1px 0 rgba(255,255,255,0.03)" : "none",
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
        </div>

        {/* ✅ Hover preview tooltip (only appears when hovering an item) */}
        {hoverKey && (
          <div
            style={{
              position: "fixed",
              left,
              top,
              width: tipW,
              height: tipH,
              zIndex: 9999,
              background: "color-mix(in srgb, rgba(15, 23, 42, 0.98) 96%, transparent)",
              border: `1px solid ${borderColor}`,
              borderRadius: 14,
              boxShadow: "0 14px 50px rgba(0,0,0,0.18)",
              padding: 10,
              pointerEvents: "none",
              display: "grid",
              gridTemplateRows: "auto 1fr",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 11, color: mutedColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {hoverKey.split("/").pop()}
            </div>

            <div
              style={{
                border: `1px solid ${borderColor}`,
                borderRadius: 12,
                background: panelBg,
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
              }}
            >
              {previewLoading ? (
                <div style={{ fontSize: 11, color: mutedColor }}>Loading...</div>
              ) : preview?.inner ? (
                <svg
                  width="190"
                  height="190"
                  viewBox={preview.vb}
                  preserveAspectRatio="xMidYMid meet"
                  dangerouslySetInnerHTML={{ __html: preview.inner }}
                />
              ) : (
                <div style={{ fontSize: 11, color: mutedColor }}>No preview</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
