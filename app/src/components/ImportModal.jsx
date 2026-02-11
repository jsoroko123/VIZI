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
}) {
  const [query, setQuery] = useState("");

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

  const closeBtnStyle = {
    border: "1px solid #e6e6e6",
    background: "white",
    borderRadius: 10,
    padding: "4px 8px",
    cursor: "pointer",
    lineHeight: 1,
    color: "#111",
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

  // ✅ hover loader (lazy, cached, delayed)
  async function loadPreviewForKey(fileKey) {
    if (!svgLibrary) return;

    // cached?
    if (cacheRef.current.has(fileKey)) {
      setPreview(cacheRef.current.get(fileKey));
      setPreviewLoading(false);
      return;
    }

    const entry = svgLibrary[fileKey];
    if (!entry) return;

    const myToken = ++hoverTokenRef.current;
    setPreviewLoading(true);

    try {
      const raw = typeof entry === "function" ? await entry() : entry;
      if (hoverTokenRef.current !== myToken) return; // stale hover

      const parsed = stripOuterSvg(raw);
      if (!parsed?.inner) {
        cacheRef.current.set(fileKey, null);
        setPreview(null);
        setPreviewLoading(false);
        return;
      }

      const vb = parsed.vb ? `${parsed.vb.x} ${parsed.vb.y} ${parsed.vb.w} ${parsed.vb.h}` : "0 0 100 100";
      const data = { vb, inner: parsed.inner };

      cacheRef.current.set(fileKey, data);
      setPreview(data);
    } catch {
      cacheRef.current.set(fileKey, null);
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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        zIndex: 40,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onMouseDown={() => setImportOpen(false)}
    >
      <div
        style={{
          width: "min(560px, 92vw)",
          minHeight: "min(520px, 80vh)",
          maxHeight: "min(520px, 80vh)",
          background: "white",
          borderRadius: 16,
          border: "1px solid #e6e6e6",
          boxShadow: "0 14px 50px rgba(0,0,0,0.22)",
          position: "relative",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="vizi-scroll"
          style={{
            maxHeight: "min(520px, 80vh)",
            overflow: "auto",
            paddingRight: 26,
            marginRight: -26,
            boxSizing: "border-box",
          }}
        >
          <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: "white",
            padding: 16,
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontWeight: 800 }}>Import SVG</div>
            <button title="Close" onClick={() => setImportOpen(false)} style={closeBtnStyle}>
              X
            </button>
          </div>

          <div style={{ marginTop: 8, color: "#808080", fontSize: 16, fontWeight: "bold" }}>
            SVG Templates
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ position: "relative" }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search..."
                style={{
                  width: "100%",
                  border: "1px solid #e6e6e6",
                  background: "white",
                  borderRadius: 12,
                  padding: "10px 34px 10px 12px",
                  color: "#111",
                  outline: "none",
                  fontSize: 13,
                  boxSizing: "border-box",
                }}
              />
              {query && (
                <button
                  type="button"
                  title="Clear"
                  onClick={() => setQuery("")}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 22,
                    height: 22,
                    borderRadius: 8,
                    border: "1px solid #e6e6e6",
                    background: "white",
                    cursor: "pointer",
                    lineHeight: 1,
                    color: "#111",
                    padding: 0,
                  }}
                >
                  X
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: "18px 22px 22px 18px" }}>
          <div style={{ marginTop: 0, display: "grid", gap: 8, color: "#808080" }}>
            {list.length === 0 ? (
              <div style={{ color: "#808080" }}>
                No SVGs found. Put files in <b>src/assets/SVG Files</b>.
              </div>
            ) : grouped.length === 0 ? (
              <div style={{ color: "#808080" }}>No matches.</div>
            ) : (
              grouped.map((group) => (
                <div key={group.folder} style={{ display: "grid", gap: 8 }}>
                  <div style={{ color: "#808080", fontSize: 13, fontWeight: 800, padding: "4px 2px" }}>
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
                        border: "1px solid #e6e6e6",
                        background: "white",
                        cursor: "pointer",
                        color: "#808080",
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
              background: "rgba(255,255,255,0.98)",
              border: "1px solid #e6e6e6",
              borderRadius: 14,
              boxShadow: "0 14px 50px rgba(0,0,0,0.18)",
              padding: 10,
              pointerEvents: "none",
              display: "grid",
              gridTemplateRows: "auto 1fr",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {hoverKey.split("/").pop()}
            </div>

            <div
              style={{
                border: "1px solid #f0f0f0",
                borderRadius: 12,
                background: "white",
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
              }}
            >
              {previewLoading ? (
                <div style={{ fontSize: 12, color: "#888" }}>Loading...</div>
              ) : preview?.inner ? (
                <svg
                  width="190"
                  height="190"
                  viewBox={preview.vb}
                  preserveAspectRatio="xMidYMid meet"
                  dangerouslySetInnerHTML={{ __html: preview.inner }}
                />
              ) : (
                <div style={{ fontSize: 12, color: "#888" }}>No preview</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
