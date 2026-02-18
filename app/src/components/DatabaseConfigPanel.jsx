import { useEffect, useMemo, useState } from "react";

function asText(value, fallback = "--") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asNumber(value, fallback = "--") {
  return Number.isFinite(Number(value)) ? String(Number(value)) : fallback;
}

export default function DatabaseConfigPanel({ embedded = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/db/config", { credentials: "include" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(payload?.error || "Failed to load database config."));
      setData(payload && typeof payload === "object" ? payload : {});
    } catch (err) {
      setError(String(err?.message || "Failed to load database config."));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const connection = data?.connection && typeof data.connection === "object" ? data.connection : {};
  const health = data?.health && typeof data.health === "object" ? data.health : {};
  const pool = data?.pool && typeof data.pool === "object" ? data.pool : {};
  const catalog = data?.catalog && typeof data.catalog === "object" ? data.catalog : {};

  const checkedAtText = useMemo(() => {
    const ts = Number(health?.checkedAt || 0);
    if (!Number.isFinite(ts) || ts <= 0) return "--";
    return new Date(ts).toLocaleString();
  }, [health?.checkedAt]);

  const cardStyle = {
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "var(--bg-elev)",
    padding: 12,
    display: "grid",
    gap: 8,
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflow: embedded ? "auto" : "visible",
        padding: embedded ? 0 : 12,
        display: "grid",
        gap: 10,
        alignContent: "start",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>Database Configuration</div>
        <button
          type="button"
          data-preserve-style="true"
          onClick={() => void load()}
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
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div style={{ ...cardStyle, border: "1px solid #f04438", color: "#b42318" }}>{error}</div>
      ) : null}

      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Connection</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>Status:</strong> {connection?.configured ? "Configured" : "Not configured"}</div>
          <div><strong>Protocol:</strong> {asText(connection?.protocol)}</div>
          <div><strong>Host:</strong> {asText(connection?.host)}</div>
          <div><strong>Port:</strong> {asNumber(connection?.port)}</div>
          <div><strong>Database:</strong> {asText(connection?.database)}</div>
          <div><strong>User:</strong> {asText(connection?.user)}</div>
          <div><strong>SSL:</strong> {connection?.ssl === true ? "Enabled" : "Disabled"}</div>
          <div><strong>SSL Mode:</strong> {asText(connection?.sslMode)}</div>
          <div><strong>App Name:</strong> {asText(connection?.applicationName)}</div>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Health</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>Connected:</strong> {health?.connected ? "Yes" : "No"}</div>
          <div><strong>Latency:</strong> {Number.isFinite(Number(health?.latencyMs)) ? `${Math.round(Number(health.latencyMs))} ms` : "--"}</div>
          <div><strong>Checked:</strong> {checkedAtText}</div>
          <div><strong>Schema:</strong> {asText(catalog?.schema, "public")}</div>
          <div><strong>Total Tables:</strong> {asNumber(catalog?.tableCount)}</div>
          <div><strong>Total Routines:</strong> {asNumber(catalog?.routineCount)}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
          <strong>Server Time:</strong> {asText(health?.serverTime)}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
          <strong>Server Version:</strong> {asText(health?.serverVersion)}
        </div>
        {String(health?.error || "").trim() ? (
          <div style={{ fontSize: 12, color: "#b42318" }}>
            <strong>Error:</strong> {String(health.error)}
          </div>
        ) : null}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Pool</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>Max:</strong> {asNumber(pool?.max)}</div>
          <div><strong>Total:</strong> {asNumber(pool?.total)}</div>
          <div><strong>Idle:</strong> {asNumber(pool?.idle)}</div>
          <div><strong>Waiting:</strong> {asNumber(pool?.waiting)}</div>
        </div>
      </div>
    </div>
  );
}
