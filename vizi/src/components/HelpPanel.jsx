const closeBtnStyle = {
  border: "1px solid #e6e6e6",
  background: "white",
  borderRadius: 10,
  padding: "4px 8px",
  cursor: "pointer",
  lineHeight: 1,
  color: "#111",
};

export default function HelpPanel({ showHelp, setShowHelp }) {
  if (!showHelp) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: 60,
        bottom: 60,
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
          ✕
        </button>
      </div>

      <div style={{ marginTop: 6 }}>
        <div>• <b>Shift-click</b> to multi-select</div>
        <div>• Drag any selected item to move the whole selection</div>
        <div>• Delete/Backspace deletes all selected</div>
        <div>• X/Y/W/H edits one item or a whole group (overlays keep aspect ratio)</div>
        <div>• ID editable only for single selection</div>
        <div>• Fill editable for single SVG overlay; Stroke editable for single item</div>
        <div>• Double-click a polyline to edit points; click line to insert; double-click point to remove</div>
        <div>• Right-click while drawing a polyline to finish; ESC cancels drawing / exits edit</div>
        <div style={{ marginTop: 6, opacity: 0.9 }}>Tip: hold Shift while placing points to snap to grid.</div>
      </div>
    </div>
  );
}
