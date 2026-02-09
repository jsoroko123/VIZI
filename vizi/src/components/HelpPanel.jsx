const closeBtnStyle = {
  border: "1px solid #e6e6e6",
  background: "white",
  borderRadius: 10,
  padding: "4px 8px",
  cursor: "pointer",
  lineHeight: 1,
  color: "#111",
};

import { useState } from "react";

export default function HelpPanel({ showHelp, setShowHelp }) {
  if (!showHelp) return null;

  const [open, setOpen] = useState({
    selection: false,
    polylines: false,
    text: false,
    overlays: false,
    props: false,
    shortcuts: false,
  });

  function Toggle({ id, title }) {
    const isOpen = !!open[id];
    return (
      <button
        type="button"
        onClick={() => setOpen((p) => ({ ...p, [id]: !p[id] }))}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          padding: "6px 0",
          cursor: "pointer",
          color: "#111",
          fontWeight: 700,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{title}</span>
        <span style={{ opacity: 0.6 }}>{isOpen ? "-" : "+"}</span>
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        right: 60,
        top: 60,
        background: "rgba(255,255,255,0.9)",
        border: "1px solid #e6e6e6",
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 13,
        lineHeight: 1.35,
        maxWidth: 760,
        boxShadow: "0 6px 18px rgba(0,0,0,0.10)",
        color: "#808080",
        zIndex: 20,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 800, color: "#111" }}>Controls</div>
        <button title="Close" onClick={() => setShowHelp(false)} style={closeBtnStyle}>
          X
        </button>
      </div>

      <div style={{ marginTop: 6 }}>
        <Toggle id="selection" title="Selection & Move" />
        {open.selection && (
          <div style={{ paddingLeft: 6 }}>
            <div>- <b>Shift-click</b> to multi-select</div>
            <div>- Drag any selected item to move the whole selection</div>
            <div>- Arrow keys nudge selection (Shift = 10x)</div>
            <div>- Delete/Backspace deletes all selected</div>
            <div>- Right-click empty space for tools (Polyline/Text/Move)</div>
          </div>
        )}

        <Toggle id="polylines" title="Polylines" />
        {open.polylines && (
          <div style={{ paddingLeft: 6 }}>
            <div>- Double-click a polyline to enter edit mode</div>
            <div>- Click a point handle to move that point with arrow keys</div>
            <div>- Right-click a point handle to delete (menu)</div>
            <div>- Double-click the line while editing to add a new segment</div>
            <div>- While drawing: <b>Enter</b> or double-click to finish</div>
            <div>- Right-click while drawing removes the last segment</div>
            <div>- Hold <b>Alt</b> while drawing to lock horizontal/vertical</div>
          </div>
        )}

        <Toggle id="text" title="Text" />
        {open.text && (
          <div style={{ paddingLeft: 6 }}>
            <div>- Double-click text to open Properties</div>
          </div>
        )}

        <Toggle id="overlays" title="SVG Overlays" />
        {open.overlays && (
          <div style={{ paddingLeft: 6 }}>
            <div>- Drag to move; drag corner handles to resize</div>
            <div>- Hold <b>Alt</b> while dragging a resize handle to move instead of scale</div>
            <div>- Double-click SVG to open Properties</div>
          </div>
        )}

        <Toggle id="props" title="Properties Panel" />
        {open.props && (
          <div style={{ paddingLeft: 6 }}>
            <div>- X/Y/W/H edits one item or a whole group</div>
            <div>- Use <b>Apply</b> to commit all fields</div>
            <div>- For polylines, use <b>Convert</b> to turn into SVG overlays</div>
            <div>- SVG Template can be swapped while keeping position & tag path</div>
            <div>- Dup Offset controls duplicate spacing</div>
          </div>
        )}

        <Toggle id="shortcuts" title="Shortcuts" />
        {open.shortcuts && (
          <div style={{ paddingLeft: 6 }}>
            <div>- ESC closes import, cancels drawing, exits edit, clears selection, and clears import anchor</div>
            <div>- Ctrl/Cmd + D duplicates selection</div>
            <div>- Right-double-click sets the import anchor</div>
            <div>- Zoom popup has a Tag toggle to show Tag Path overlays</div>
          </div>
        )}
      </div>
    </div>
  );
}
