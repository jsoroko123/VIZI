// src/components/Toolbar.jsx
import React, { useEffect, useRef } from "react";

function IconButton({ title, active, onClick, children, danger = false }) {
  return (
    <button
      type="button" // ✅ important
      title={title}
      onMouseDown={(e) => e.stopPropagation()} // ✅ keep canvas from grabbing
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      style={{
        width: 38,
        height: 38,
        borderRadius: 10,
        border: danger
          ? "1px solid #f04438"
          : active
          ? "2px solid #2b6cff"
          : "1px solid rgba(0,0,0,0.08)",
        background: danger
          ? "linear-gradient(180deg, #f04438 0%, #d92d20 100%)"
          : active
          ? "linear-gradient(180deg, #eef3ff 0%, #e2ecff 100%)"
          : "linear-gradient(180deg, #ffffff 0%, #f7f7f7 100%)",
        cursor: "pointer",
        boxShadow: danger
          ? "0 8px 20px rgba(240,68,56,0.35)"
          : active
          ? "0 8px 20px rgba(43,108,255,0.25)"
          : "0 6px 18px rgba(0,0,0,0.08)",
        color: danger ? "#fff" : active ? "#1f56cc" : "#111",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        boxSizing: "border-box",
        WebkitTapHighlightColor: "transparent",
        transition: "transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
      }}
    >
      <span style={{ width: 20, height: 20, display: "grid", placeItems: "center" }}>
        {children}
      </span>
    </button>
  );
}

const Icons = {
  select: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path d="M4 3l7 18 2-7 7-2L4 3z" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  poly: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M5 6h5l4 6h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="6" r="2" fill="currentColor" />
      <circle cx="10" cy="6" r="2" fill="currentColor" />
      <circle cx="14" cy="12" r="2" fill="currentColor" />
      <circle cx="19" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  trunk: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path d="M12 4v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 14h16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M19 11l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  rect: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <rect x="5" y="6" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  text: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M4 6V4h16v2M9 20h6M12 4v16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  ),
  import: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M12 21V11m0 0l4 4m-4-4l-4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 7h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M7 7V4h10v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  widget: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <rect x="3" y="12" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="10" y="8" width="4" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
      <rect x="17" y="5" width="4" height="15" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  export: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M12 3v10m0 0l-4-4m4 4l4-4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  json: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
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
  ),
  trash: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M6 7h12m-10 0l1 14h6l1-14M9 7V5h6v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  close: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M7 7l10 10M17 7L7 17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  tag: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M4 12l8-8h6l2 2v6l-8 8-8-8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="8" r="1.5" fill="currentColor" />
    </svg>
  ),
  grid: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  ),
  edit: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M4 20h4l10-10-4-4L4 16v4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M14 6l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  save: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M4 4h12l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M8 4v6h8V4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <rect x="8" y="14" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="2" />
    </svg>
  ),
  load: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
      <path
        d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 11v6m0 0l-3-3m3 3l3-3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  saveAs: (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path d="M4 4h12l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M8 4v6h8V4" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="M14.5 13.5l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M15 18.5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
),
};

function Divider({ vertical = false }) {
  return (
    <div
      style={
        vertical
          ? {
              width: 1,
              alignSelf: "stretch",
              background:
                "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0) 100%)",
              margin: "0 6px",
            }
          : {
              height: 1,
              width: "100%",
              background:
                "linear-gradient(90deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0) 100%)",
              margin: "6px 0",
            }
      }
    />
  );
}

function GroupLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: "#ffffff",
        marginBottom: 4,
        marginLeft: 2,
        userSelect: "none",
      }}
    >
      {children}
    </div>
  );
}

export default function Toolbar({
  tool,
  setTool,
  importOpen,
  setImportOpen,
  widgetOpen,
  setWidgetOpen,
  exportSVG,
  exportIgnitionJson,
  editingId,
  toggleEditMode,
  toolbarPos,
  setToolbarPos,

  // ✅ project save/load
  exportProjectJson,
  exportProjectJsonAs,
  importProjectJson,

  setDrawing,
  exitEditMode,
  setSelectedOverlayIds,
  deleteSelected,
  showTagPaths,
  setShowTagPaths,
  showGrid,
  setShowGrid,
  bounds = { top: 8, left: 8, right: 8, bottom: 8 },
}) {
  const dragRef = useRef({ dragging: false, ox: 0, oy: 0 });
  const posRef = useRef(toolbarPos);
  const panelRef = useRef(null);

  useEffect(() => {
    posRef.current = toolbarPos;
  }, [toolbarPos]);

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current.dragging) return;
      const panelW = dragRef.current.panelW || panelRef.current?.getBoundingClientRect()?.width || 260;
      const panelH = dragRef.current.panelH || panelRef.current?.getBoundingClientRect()?.height || 100;
      const nextLeft = Math.max(bounds.left, e.clientX - dragRef.current.ox);
      const maxLeft = Math.max(bounds.left, window.innerWidth - panelW - bounds.right);
      const nextTop = Math.max(bounds.top, e.clientY - dragRef.current.oy);
      const maxTop = Math.max(bounds.top, window.innerHeight - panelH - bounds.bottom);
      setToolbarPos?.({
        x: Math.min(nextLeft, maxLeft),
        y: Math.min(nextTop, maxTop),
      });
    }

    function onUp() {
      dragRef.current.dragging = false;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startToolbarDrag(e) {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    dragRef.current.dragging = true;
    dragRef.current.ox = e.clientX - (posRef.current?.x ?? 16);
    dragRef.current.oy = e.clientY - (posRef.current?.y ?? 50);
    dragRef.current.panelW = rect?.width || 260;
    dragRef.current.panelH = rect?.height || 100;
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        left: toolbarPos?.x ?? 16,
        top: toolbarPos?.y ?? 50,
        display: "flex",
        flexDirection: "row",
        gap: 12,
        padding: "10px 12px",
        paddingRight: 34,
        borderRadius: 14,
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--bg-elev) 98%, white 2%) 0%, color-mix(in srgb, var(--bg-elev) 92%, black 8%) 100%)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(10px)",
        boxShadow: "0 16px 34px color-mix(in srgb, var(--text) 24%, transparent)",
        zIndex: 31,
        alignItems: "flex-start",
      }}
      onMouseDown={startToolbarDrag}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <GroupLabel>File</GroupLabel>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <IconButton title="Export SVG" active={false} onClick={exportSVG}>
            {Icons.export}
          </IconButton>
          <IconButton title="Export Ignition JSON" active={false} onClick={exportIgnitionJson}>
            {Icons.json}
          </IconButton>
        </div>
      </div>

      <Divider vertical />

      <div style={{ display: "flex", flexDirection: "column" }}>
        <GroupLabel>Tools</GroupLabel>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <IconButton title="Import SVG" active={importOpen} onClick={() => setImportOpen?.(true)}>
            {Icons.import}
          </IconButton>
          <IconButton title="Add Widget" active={widgetOpen} onClick={() => setWidgetOpen?.(true)}>
            {Icons.widget}
          </IconButton>
          <IconButton
            title="Select / Move (Shift-click for multi-select)"
            active={tool === "select"}
            onClick={() => {
              setTool("select");
              setDrawing?.(null);
            }}
          >
            {Icons.select}
          </IconButton>
          <IconButton
            title="Multi-segment line"
            active={tool === "polyline"}
            onClick={() => {
              setTool("polyline");
              setDrawing?.(null);
              exitEditMode?.();
              setSelectedOverlayIds?.([]);
            }}
          >
            {Icons.poly}
          </IconButton>
          <IconButton
            title="Trunk connector (click start → click end, auto-routes with right angles)"
            active={tool === "trunkconn"}
            onClick={() => {
              setTool("trunkconn");
              setDrawing?.(null);
              exitEditMode?.();
              setSelectedOverlayIds?.([]);
            }}
          >
            {Icons.trunk}
          </IconButton>
          <IconButton
            title="Rectangle"
            active={tool === "rect"}
            onClick={() => {
              setTool("rect");
              setDrawing?.(null);
              exitEditMode?.();
              setSelectedOverlayIds?.([]);
            }}
          >
            {Icons.rect}
          </IconButton>
          <IconButton
            title="Text (click to place)"
            active={tool === "text"}
            onClick={() => {
              setTool("text");
              setDrawing?.(null);
              exitEditMode?.();
              setSelectedOverlayIds?.([]);
            }}
          >
            {Icons.text}
          </IconButton>
        </div>
      </div>

      <Divider vertical />

      <div style={{ display: "flex", flexDirection: "column" }}>
        <GroupLabel>Edit</GroupLabel>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <IconButton title="Delete selected" active={false} danger onClick={deleteSelected}>
            {Icons.trash}
          </IconButton>
          <IconButton
            title={editingId ? "Exit Edit Mode" : "Enter Edit Mode"}
            active={!!editingId}
            onClick={toggleEditMode}
          >
            {Icons.edit}
          </IconButton>
        </div>
      </div>

      <Divider vertical />

      <div style={{ display: "flex", flexDirection: "column" }}>
        <GroupLabel>Display</GroupLabel>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <IconButton
            title="Toggle Tag Paths"
            active={!!showTagPaths}
            onClick={() => setShowTagPaths?.((v) => !v)}
          >
            {Icons.tag}
          </IconButton>
          <IconButton
            title="Toggle Grid"
            active={!!showGrid}
            onClick={() => setShowGrid?.((v) => !v)}
          >
            {Icons.grid}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
