import { useMemo, useState } from "react";

const WIDGETS = [
  { key: "lineChart", name: "Line Chart", group: "Graphs", desc: "Trend lines over time." },
  { key: "barChart", name: "Bar Chart", group: "Graphs", desc: "Category comparison bars." },
  { key: "areaChart", name: "Area Chart", group: "Graphs", desc: "Filled trend graph." },
  { key: "gauge", name: "Gauge", group: "Indicators", desc: "Dial style value." },
  { key: "kpi", name: "KPI Card", group: "Indicators", desc: "Large single metric." },
  { key: "displayBox", name: "Display Box", group: "Indicators", desc: "Live tag read/write with units." },
  { key: "statusTable", name: "Status Table", group: "Tables", desc: "Compact status rows." },
];

export default function WidgetSelectorModal({
  open,
  onClose,
  onPickWidget,
}) {
  const [query, setQuery] = useState("");

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
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.25)",
        zIndex: 45,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: "min(680px, 94vw)",
          maxHeight: "min(620px, 86vh)",
          overflow: "auto",
          background: "var(--bg-elev)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          boxShadow: "0 14px 50px rgba(0,0,0,0.22)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            padding: 16,
            background: "var(--bg-elev)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontWeight: 800, color: "var(--text)" }}>Widget Selector</div>
            <button
              onClick={onClose}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 10,
                padding: "4px 8px",
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
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
              color: "var(--text)",
              borderRadius: 10,
              padding: "8px 10px",
              fontSize: 13,
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          {grouped.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No matching widgets.</div>
          ) : (
            grouped.map((g) => (
              <div key={g.group} style={{ display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)" }}>{g.group}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
                  {g.items.map((w) => (
                    <button
                      key={w.key}
                      onClick={() => onPickWidget?.(w.key)}
                      style={{
                        textAlign: "left",
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        color: "var(--text)",
                        borderRadius: 12,
                        padding: "10px 12px",
                        cursor: "pointer",
                        display: "grid",
                        gap: 4,
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{w.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{w.desc}</div>
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
