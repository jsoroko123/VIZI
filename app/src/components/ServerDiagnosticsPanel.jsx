import { useEffect, useMemo, useState } from "react";

function asCount(value, fallback = "--") {
  return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : fallback;
}

function asMs(value, fallback = "--") {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))} ms` : fallback;
}

function asDate(value, fallback = "--") {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return fallback;
  return new Date(ts).toLocaleString();
}

function cardStyle(accent = "var(--border)") {
  return {
    border: `1px solid ${accent}`,
    borderRadius: 12,
    background: "var(--bg-elev)",
    padding: 12,
    display: "grid",
    gap: 8,
  };
}

export default function ServerDiagnosticsPanel() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [payload, setPayload] = useState({
    health: null,
    opcStatus: null,
    opcConfig: null,
    dbConfig: null,
  });

  const load = async () => {
    setLoading(true);
    setError("");
    const fetchJson = async (url) => {
      const res = await fetch(url, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || `Failed to load ${url}`));
      return data;
    };

    try {
      const [healthRes, opcStatusRes, opcConfigRes, dbConfigRes] = await Promise.allSettled([
        fetchJson("/api/health"),
        fetchJson("/api/opc/status"),
        fetchJson("/api/opc/config"),
        fetchJson("/api/db/config"),
      ]);

      const next = {
        health: healthRes.status === "fulfilled" ? healthRes.value : null,
        opcStatus: opcStatusRes.status === "fulfilled" ? opcStatusRes.value : null,
        opcConfig: opcConfigRes.status === "fulfilled" ? opcConfigRes.value : null,
        dbConfig: dbConfigRes.status === "fulfilled" ? dbConfigRes.value : null,
      };

      setPayload(next);
      setUpdatedAt(Date.now());

      const errors = [healthRes, opcStatusRes, opcConfigRes, dbConfigRes]
        .filter((r) => r.status === "rejected")
        .map((r) => String(r.reason?.message || "Request failed"));
      if (errors.length) setError(errors[0]);
    } catch (err) {
      setError(String(err?.message || "Failed to load diagnostics."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, []);

  const summary = useMemo(() => {
    const health = payload.health && typeof payload.health === "object" ? payload.health : {};
    const opcStatus = payload.opcStatus && typeof payload.opcStatus === "object" ? payload.opcStatus : {};
    const opcConfig = payload.opcConfig && typeof payload.opcConfig === "object" ? payload.opcConfig : {};
    const dbConfig = payload.dbConfig && typeof payload.dbConfig === "object" ? payload.dbConfig : {};

    const tags = Array.isArray(opcConfig.tags) ? opcConfig.tags : [];
    const topics = Array.isArray(opcConfig.topics) ? opcConfig.topics : [];
    const plcs = Array.isArray(opcConfig.plcs) ? opcConfig.plcs : [];
    const diagnostics =
      opcStatus.diagnostics && typeof opcStatus.diagnostics === "object" ? Object.values(opcStatus.diagnostics) : [];

    const connectionMap =
      opcStatus.connections && typeof opcStatus.connections === "object" ? opcStatus.connections : {};
    const connectedCount = Object.values(connectionMap).filter(Boolean).length;
    const plcCount = Math.max(plcs.length, Object.keys(connectionMap).length);

    let longestReadMs = null;
    let avgAccumulator = 0;
    let avgCount = 0;
    let firstReadAt = null;
    let lastReadAt = null;

    diagnostics.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const maxRead = Number(item.maxReadDurationMs);
      if (Number.isFinite(maxRead)) {
        longestReadMs = longestReadMs == null ? maxRead : Math.max(longestReadMs, maxRead);
      }
      const avgRead = Number(item.avgReadDurationMs);
      if (Number.isFinite(avgRead)) {
        avgAccumulator += avgRead;
        avgCount += 1;
      }
      const readAt = Number(item.lastReadAt);
      if (Number.isFinite(readAt) && readAt > 0) {
        firstReadAt = firstReadAt == null ? readAt : Math.min(firstReadAt, readAt);
        lastReadAt = lastReadAt == null ? readAt : Math.max(lastReadAt, readAt);
      }
    });

    const readCycleMs =
      firstReadAt != null && lastReadAt != null && lastReadAt >= firstReadAt ? lastReadAt - firstReadAt : null;

    return {
      aiHealthy: health.ok === true,
      opcConnected: opcStatus.connected === true,
      dbConnected: dbConfig?.health?.connected === true,
      tagCount: tags.length,
      enabledTagCount: tags.filter((t) => t?.enabled !== false).length,
      mutedTagCount: tags.filter((t) => t?.muted === true).length,
      topicCount: topics.length,
      plcCount,
      connectedCount,
      opcLastAt: Number(opcStatus.at || 0),
      opcLastPollAt: Number(opcStatus.lastPollAt || 0),
      longestReadMs,
      avgReadMs: avgCount > 0 ? avgAccumulator / avgCount : null,
      readCycleMs,
      writes: opcStatus?.runtime?.writeMetrics || {},
      dbLatencyMs: Number(dbConfig?.health?.latencyMs),
      dbCheckedAt: Number(dbConfig?.health?.checkedAt),
    };
  }, [payload]);

  const pill = (ok, textOk, textBad) => ({
    text: ok ? textOk : textBad,
    style: {
      border: `1px solid ${ok ? "#12b76a" : "#f04438"}`,
      background: ok ? "rgba(18,183,106,0.12)" : "rgba(240,68,56,0.12)",
      color: ok ? "#12b76a" : "#f04438",
      borderRadius: 999,
      padding: "4px 10px",
      fontSize: 12,
      fontWeight: 700,
      width: "fit-content",
      whiteSpace: "nowrap",
      alignSelf: "start",
    },
  });

  const aiPill = pill(summary.aiHealthy, "AI Healthy", "AI Offline");
  const opcPill = pill(summary.opcConnected, "OPC Connected", "OPC Disconnected");
  const dbPill = pill(summary.dbConnected, "DB Connected", "DB Disconnected");

  const panelStyle = {
    border: "1px solid var(--border)",
    borderRadius: 14,
    background: "var(--bg-elev)",
    padding: 14,
    display: "grid",
    gap: 12,
    boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
  };
  const sectionTitleStyle = {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  };
  const statGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 10,
  };
  const metricCardStyle = {
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "color-mix(in srgb, var(--bg-soft) 92%, var(--bg-elev) 8%)",
    padding: "10px 12px",
    display: "grid",
    gap: 2,
  };
  const metricLabelStyle = { fontSize: 11, fontWeight: 700, color: "var(--text-muted)" };
  const metricValueStyle = { fontSize: 20, fontWeight: 800, lineHeight: 1.15 };
  const metricSubStyle = { fontSize: 11, color: "var(--text-muted)" };

  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        overflow: "auto",
        padding: 16,
        display: "grid",
        gap: 12,
        alignContent: "start",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "0.01em" }}>Server Diagnostics</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Updated: {asDate(updatedAt)}
          </div>
        </div>
        <button
          type="button"
          data-preserve-style="true"
          onClick={() => void load()}
          disabled={loading}
          style={{
            border: "1px solid #2b6cff",
            background: loading ? "var(--bg-soft)" : "#2b6cff",
            color: loading ? "var(--text-muted)" : "#fff",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <div style={{ ...cardStyle("#f04438"), color: "#b42318" }}>{error}</div> : null}

      <div style={{ ...panelStyle, gap: 8 }}>
        <div style={sectionTitleStyle}>Service Health</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={aiPill.style}>{aiPill.text}</div>
        <div style={opcPill.style}>{opcPill.text}</div>
        <div style={dbPill.style}>{dbPill.text}</div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>OPC Inventory</div>
        <div style={statGridStyle}>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>PLCs</div>
            <div style={metricValueStyle}>{asCount(summary.plcCount)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Connected PLCs</div>
            <div style={metricValueStyle}>{asCount(summary.connectedCount)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Topics</div>
            <div style={metricValueStyle}>{asCount(summary.topicCount)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Total Tags</div>
            <div style={metricValueStyle}>{asCount(summary.tagCount)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Enabled Tags</div>
            <div style={metricValueStyle}>{asCount(summary.enabledTagCount)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Muted Tags</div>
            <div style={metricValueStyle}>{asCount(summary.mutedTagCount)}</div>
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>OPC Performance</div>
        <div style={statGridStyle}>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Longest Read</div>
            <div style={metricValueStyle}>{asMs(summary.longestReadMs)}</div>
            <div style={metricSubStyle}>Peak single read duration</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Average Read</div>
            <div style={metricValueStyle}>{asMs(summary.avgReadMs)}</div>
            <div style={metricSubStyle}>Across active diagnostics</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Read Cycle Span</div>
            <div style={metricValueStyle}>{asMs(summary.readCycleMs)}</div>
            <div style={metricSubStyle}>First to last read in cycle</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Last OPC Publish</div>
            <div style={{ ...metricValueStyle, fontSize: 14 }}>{asDate(summary.opcLastAt)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Last Poll</div>
            <div style={{ ...metricValueStyle, fontSize: 14 }}>{asDate(summary.opcLastPollAt)}</div>
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>Database And Writes</div>
        <div style={statGridStyle}>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>DB Latency</div>
            <div style={metricValueStyle}>{asMs(summary.dbLatencyMs)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Write Count</div>
            <div style={metricValueStyle}>{asCount(summary.writes?.count)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Write Avg</div>
            <div style={metricValueStyle}>{asMs(summary.writes?.avgMs)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Write Max</div>
            <div style={metricValueStyle}>{asMs(summary.writes?.maxMs)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>DB Health Checked</div>
            <div style={{ ...metricValueStyle, fontSize: 14 }}>{asDate(summary.dbCheckedAt)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
