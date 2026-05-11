import { useMemo, useState } from "react";

const WIDGETS = [
  { key: "lineChart", name: "Line Chart", group: "Graphs", desc: "Trend lines over time." },
  { key: "barChart", name: "Bar Chart", group: "Graphs", desc: "Category comparison bars." },
  { key: "areaChart", name: "Area Chart", group: "Graphs", desc: "Filled trend graph." },
  { key: "gauge", name: "Gauge", group: "Indicators", desc: "Dial style value." },
  { key: "weather", name: "Weather", group: "Indicators", desc: "Current weather card." },
  { key: "kpi", name: "KPI Card", group: "Indicators", desc: "Large single metric." },
  { key: "displayBox", name: "Display Box", group: "Indicators", desc: "Live tag read/write with units." },
  { key: "routeDisplay", name: "Route Display", group: "Operations", desc: "Job and route state summary from a parent route tag." },
  { key: "scaleAdapter", name: "Scale Adapter", group: "Operations", desc: "Scale state, flowrate, and job weight from a ScaleAdaptor tag." },
  { key: "countdownBar", name: "Countdown Bar", group: "Indicators", desc: "PLC timer PRE/ACC countdown progress." },
  { key: "pushButton", name: "Push Button", group: "Controls", desc: "Momentary PLC write while pressed." },
  { key: "openViewButton", name: "Open View Button", group: "Controls", desc: "Button that opens a Perspective view path." },
  { key: "onOffButton", name: "On/Off Button", group: "Controls", desc: "Toggle PLC write 1/0 from tag state." },
  { key: "statusTable", name: "Status Table", group: "Tables", desc: "Compact status rows." },
];

export default function WidgetSelectorModal({
  open,
  onClose,
  onPickWidget,
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

  const grouped = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    const filtered = WIDGETS.filter((w) => {
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.group.toLowerCase().includes(q) ||
        w.key.toLowerCase().includes(q)
      );
    });
    const map = new Map();
    filtered.forEach((w) => {
      if (!map.has(w.group)) map.set(w.group, []);
      map.get(w.group).push(w);
    });
    return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
  }, [query]);

  if (!open) return null;

  return (
    <div
      data-vizi-widget-drawer={docked ? "1" : undefined}
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
              zIndex: 45,
              display: "grid",
              placeItems: "center",
              padding: 16,
            }),
      }}
      onMouseDown={docked ? undefined : onClose}
    >
      <div
        style={{
          width: docked ? "100%" : "min(680px, 94vw)",
          height: docked ? "100%" : undefined,
          maxHeight: docked ? "100%" : "min(620px, 86vh)",
          overflow: "auto",
          background: panelBg,
          border: `1px solid ${borderColor}`,
          borderRadius: docked ? (attached ? "0 18px 18px 0" : 18) : 16,
          boxShadow: docked
            ? (attached ? "18px 14px 36px rgba(2, 6, 23, 0.28)" : "24px 0 40px rgba(0,0,0,0.28)")
            : "0 14px 50px rgba(0,0,0,0.22)",
          overscrollBehavior: "contain",
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            padding: 16,
            background: panelBg,
            borderBottom: `1px solid ${borderColor}`,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: textColor, letterSpacing: "0.01em" }}>Widgets</div>
            <button
              onClick={onClose}
              style={{
                border: `1px solid ${borderColor}`,
                background: softBg,
                color: textColor,
                borderRadius: 10,
                padding: "4px 8px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              X
            </button>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search widgets..."
            style={{
              marginTop: 10,
              width: "100%",
              border: `1px solid ${borderColor}`,
              background: softBg,
              color: textColor,
              borderRadius: 12,
              padding: "8px 10px",
              fontSize: 13,
              fontWeight: 600,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          {grouped.length === 0 ? (
            <div style={{ color: mutedColor, fontSize: 12 }}>No matching widgets.</div>
          ) : (
            grouped.map((g) => (
              <div key={g.group} style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: mutedColor, textTransform: "uppercase", letterSpacing: "0.08em" }}>{g.group}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
                  {g.items.map((w) => (
                    <button
                      key={w.key}
                      onClick={() => onPickWidget?.(w.key)}
                      style={{
                        textAlign: "left",
                        border: `1px solid ${borderColor}`,
                        background: softBg,
                        color: textColor,
                        borderRadius: 12,
                        padding: "10px 12px",
                        cursor: "pointer",
                        display: "grid",
                        gap: 5,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{w.name}</div>
                      <div style={{ fontSize: 11, color: mutedColor, lineHeight: 1.45 }}>{w.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
