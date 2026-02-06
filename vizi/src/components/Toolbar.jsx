// src/components/Toolbar.jsx
import React from "react";

function IconButton({ title, active, onClick, children }) {
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
        borderRadius: 12,
        border: active ? "2px solid #2b6cff" : "1px solid #d6d6d6",
        background: active ? "#e8f0ff" : "white",
        cursor: "pointer",
        boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
        color: active ? "#2b6cff" : "#111",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        boxSizing: "border-box",
        outline: "none",
        WebkitTapHighlightColor: "transparent",
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

export default function Toolbar({
  tool,
  setTool,
  importOpen,
  setImportOpen,
  exportSVG,
  exportIgnitionJson,

  // ✅ project save/load
  exportProjectJson,
  exportProjectJsonAs,
  importProjectJson,

  setDrawing,
  exitEditMode,
  setSelectedOverlayIds,
  deleteSelected,
  showToolbar,
  setShowToolbar,
}) {
  if (!showToolbar) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        top: 35,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 8,
        borderRadius: 14,
        background: "rgba(255,255,255,0.9)",
        border: "1px solid #e6e6e6",
        backdropFilter: "blur(8px)",
        boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
        zIndex: 30,
        alignItems: "center",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
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

      <IconButton title="Import SVG" active={importOpen} onClick={() => setImportOpen?.(true)}>
        {Icons.import}
      </IconButton>

      <IconButton title="Export SVG" active={false} onClick={exportSVG}>
        {Icons.export}
      </IconButton>

      <IconButton title="Export Ignition JSON" active={false} onClick={exportIgnitionJson}>
        {Icons.json}
      </IconButton>

      <IconButton title="Save Project" active={false} onClick={exportProjectJson}>
        {Icons.save}
      </IconButton>

      <IconButton title="Save Project As..." active={false} onClick={exportProjectJsonAs}>
        {Icons.saveAs}
      </IconButton>

      <IconButton title="Load Project (JSON)" active={false} onClick={importProjectJson}>
        {Icons.load}
      </IconButton>

      <IconButton title="Delete selected" active={false} onClick={deleteSelected}>
        {Icons.trash}
      </IconButton>

      <IconButton title="Close toolbar" active={false} onClick={() => setShowToolbar?.(false)}>
        {Icons.close}
      </IconButton>
    </div>
  );
}
