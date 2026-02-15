import { useMemo } from "react";

const closeBtnStyle = {
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  borderRadius: 10,
  padding: "4px 8px",
  cursor: "pointer",
  lineHeight: 1,
  color: "var(--text)",
};

const sectionCardStyle = {
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  borderRadius: 12,
  padding: 12,
  display: "grid",
  gap: 8,
};

function HelpSection({ id, title, summary, items }) {
  return (
    <section id={id} style={sectionCardStyle}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{summary}</div>
      <div style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--text)" }}>
        {(items || []).map((item, idx) => (
          <div key={`${id}-${idx}`}>- {item}</div>
        ))}
      </div>
    </section>
  );
}

export default function HelpPanel({ showHelp = true, setShowHelp, inline = false, onClose }) {
  if (!inline && !showHelp) return null;

  const sections = useMemo(
    () => [
      {
        id: "getting-started",
        title: "Getting Started",
        summary: "Open a project, pick a tool, then edit the canvas.",
        items: [
          "Use top bar Project controls to open, save, create, and delete.",
          "Switch drawers from the top bar: AI, Data, Tags, OPC, and Help.",
          "Toggle Dark/Light mode in the top bar.",
        ],
      },
      {
        id: "selection",
        title: "Selection and Movement",
        summary: "Select one or many elements, then move and align through Properties.",
        items: [
          "Click an element to select it.",
          "Shift-click to multi-select.",
          "Drag selected items to move all selected together.",
          "Use arrow keys to nudge (Shift for larger steps).",
        ],
      },
      {
        id: "drawing",
        title: "Drawing and Polyline Editing",
        summary: "Draw paths quickly and refine points in edit mode.",
        items: [
          "Choose Polyline tool to start drawing segments.",
          "Press Enter or double-click to finish current polyline.",
          "Double-click an existing polyline to enter point edit mode.",
          "Right-click a point handle to delete segment entries.",
          "Hold Alt during drawing to constrain horizontal or vertical movement.",
        ],
      },
      {
        id: "svg",
        title: "SVG Overlays",
        summary: "Import symbols, position them, and map tag groups.",
        items: [
          "Import SVGs from the context menu or import panel.",
          "Drag an overlay to move; drag handles to resize.",
          "Double-click an SVG to open Properties.",
          "Use Tag Group mapping to bind RouteId/State style data.",
        ],
      },
      {
        id: "properties",
        title: "Properties Panel",
        summary: "Central place to edit IDs, tag paths, styles, text, and geometry.",
        items: [
          "Apply commits all draft fields at once.",
          "Apply and Close commits then hides the panel.",
          "X/Y/W/H affects the selected item or whole selection.",
          "Use Duplicate Offset to control duplicate spacing.",
          "For polylines, Convert creates SVG overlays from selected lines.",
        ],
      },
      {
        id: "tags-opc",
        title: "Tags and OPC",
        summary: "Configure tags, templates, mappings, and live diagnostics.",
        items: [
          "Tags drawer supports grouped topic and subgroup organization.",
          "Use Add Tag in group rows to insert directly in that group.",
          "Template and Mapping Set tools accelerate large tag setups.",
          "Tag Diagnostics table shows quality, error streak, and effective polling.",
        ],
      },
      {
        id: "data-ai",
        title: "Data and AI Pages",
        summary: "Use Data for table CRUD and AI for query/report workflows.",
        items: [
          "Data page supports table browsing, detail editing, and field ordering.",
          "AI page supports chat, SQL preview, and report saving/running.",
          "Saved reports can be rerun from the AI Reports tab.",
        ],
      },
      {
        id: "shortcuts",
        title: "Keyboard and Mouse Shortcuts",
        summary: "Core speed controls for editing and navigation.",
        items: [
          "Esc: close active popup, cancel draw/edit states, clear selection context.",
          "Ctrl/Cmd + D: duplicate current selection.",
          "Delete/Backspace: remove selected elements.",
          "Right-click canvas: open contextual actions for tools and operations.",
        ],
      },
      {
        id: "troubleshooting",
        title: "Troubleshooting",
        summary: "Quick checks for the most common issues.",
        items: [
          "If tags appear blank, verify topic, group name, and tag path mapping.",
          "If live values are stale, confirm OPC connection and diagnostics quality.",
          "If changes are not visible, ensure the correct project is active.",
          "If save behavior looks wrong, reopen the project and verify updated timestamp.",
        ],
      },
    ],
    []
  );

  const containerStyle = inline
    ? {
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-elev)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 12,
        boxSizing: "border-box",
        color: "var(--text-muted)",
      }
    : {
        position: "fixed",
        right: 60,
        top: 60,
        width: "min(920px, calc(100vw - 120px))",
        maxHeight: "calc(100vh - 120px)",
        display: "flex",
        flexDirection: "column",
        background: "color-mix(in srgb, var(--bg-elev) 92%, transparent)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 12,
        boxSizing: "border-box",
        boxShadow: "0 8px 28px rgba(0,0,0,0.2)",
        color: "var(--text-muted)",
        zIndex: 20,
      };

  return (
    <div style={containerStyle} onMouseDown={(e) => e.stopPropagation()}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          gap: 10,
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: "var(--text)" }}>Mesora Help Guide</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Detailed usage reference for canvas editing, tags, OPC, and data tools.
          </div>
        </div>
        <button
          title="Close"
          onClick={() => {
            if (onClose) onClose();
            if (setShowHelp) setShowHelp(false);
          }}
          style={closeBtnStyle}
        >
          X
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {sections.map((s) => (
          <a
            key={`jump-${s.id}`}
            href={`#${s.id}`}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "2px 8px",
              fontSize: 11,
              color: "var(--text)",
              textDecoration: "none",
              background: "var(--bg-soft)",
            }}
          >
            {s.title}
          </a>
        ))}
      </div>

      <div
        className="vizi-scroll"
        style={{
          overflow: "auto",
          minHeight: 0,
          flex: "1 1 auto",
          display: "grid",
          gap: 10,
          paddingRight: 2,
        }}
      >
        {sections.map((section) => (
          <HelpSection
            key={section.id}
            id={section.id}
            title={section.title}
            summary={section.summary}
            items={section.items}
          />
        ))}
      </div>
    </div>
  );
}
