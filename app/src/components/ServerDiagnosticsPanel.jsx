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
    padding: 14,
    display: "grid",
    gap: 10,
  };
}

function asBytes(value, fallback = "--") {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function asPct(value, fallback = "--") {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return `${n.toFixed(1)}%`;
}

export default function ServerDiagnosticsPanel({ embedded = false }) {
  const [activeTab, setActiveTab] = useState("diagnostics");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [serviceBusyAction, setServiceBusyAction] = useState("");
  const [serviceActionMessage, setServiceActionMessage] = useState("");
  const [authSaveBusy, setAuthSaveBusy] = useState(false);
  const [authSaveMessage, setAuthSaveMessage] = useState("");
  const [authDraft, setAuthDraft] = useState({
    enabled: true,
    tenant: "common",
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    scopes: "openid profile email User.Read",
  });
  const [updatedAt, setUpdatedAt] = useState(0);
  const [payload, setPayload] = useState({
    health: null,
    opcStatus: null,
    opcConfig: null,
    dbConfig: null,
    pgDiag: null,
    appDiag: null,
    authSettings: null,
  });

  const load = async () => {
    setLoading(true);
    setError("");
    const fetchJson = async (url) => {
      const res = await fetch(url, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(String(data?.error || `Failed to load ${url}`));
        err.status = Number(res.status || 0);
        err.url = url;
        throw err;
      }
      return data;
    };

    try {
      const [healthRes, opcStatusRes, opcConfigRes, dbConfigRes, pgDiagRes, appDiagRes, authSettingsRes] = await Promise.allSettled([
        fetchJson("/api/health"),
        fetchJson("/api/opc/status"),
        fetchJson("/api/opc/config"),
        fetchJson("/api/db/config"),
        fetchJson("/api/db/diagnostics/postgres"),
        fetchJson("/api/diagnostics/app"),
        fetchJson("/api/server/settings/auth"),
      ]);

      const next = {
        health: healthRes.status === "fulfilled" ? healthRes.value : null,
        opcStatus: opcStatusRes.status === "fulfilled" ? opcStatusRes.value : null,
        opcConfig: opcConfigRes.status === "fulfilled" ? opcConfigRes.value : null,
        dbConfig: dbConfigRes.status === "fulfilled" ? dbConfigRes.value : null,
        pgDiag: pgDiagRes.status === "fulfilled" ? pgDiagRes.value : null,
        appDiag: appDiagRes.status === "fulfilled" ? appDiagRes.value : null,
        authSettings: authSettingsRes.status === "fulfilled" ? authSettingsRes.value : null,
      };

      setPayload(next);
      setUpdatedAt(Date.now());

      const errors = [healthRes, opcStatusRes, opcConfigRes, dbConfigRes, pgDiagRes, appDiagRes, authSettingsRes]
        .filter((r) => r.status === "rejected")
        .filter((r) => {
          const reason = r.reason || {};
          const status = Number(reason?.status || 0);
          const url = String(reason?.url || "");
          if (url === "/api/server/settings/auth" && (status === 401 || status === 403)) return false;
          return true;
        })
        .map((r) => String(r.reason?.message || "Request failed"));
      if (errors.length) setError(errors[0]);
    } catch (err) {
      setError(String(err?.message || "Failed to load diagnostics."));
    } finally {
      setLoading(false);
    }
  };

  const runServiceAction = async (action) => {
    const op = String(action || "").trim().toLowerCase();
    if (!op) return;
    if (serviceBusyAction) return;
    setServiceActionMessage("");
    setServiceBusyAction(op);
    try {
      const res = await fetch(`/api/server/services/${op}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || `Failed to ${op} services.`));
      setServiceActionMessage(String(data?.message || `Service ${op} requested.`));
      if (op !== "stop") {
        setTimeout(() => {
          void load();
        }, 2000);
      }
    } catch (err) {
      setServiceActionMessage(String(err?.message || `Failed to ${op} services.`));
    } finally {
      setTimeout(() => setServiceBusyAction(""), 1200);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const src = payload?.authSettings?.microsoft && typeof payload.authSettings.microsoft === "object"
      ? payload.authSettings.microsoft
      : null;
    if (!src) return;
    setAuthDraft((prev) => ({
      ...prev,
      enabled: Boolean(src.enabled),
      tenant: String(src.tenant || "common"),
      clientId: String(src.clientId || ""),
      clientSecret: "",
      redirectUri: String(src.redirectUri || ""),
      scopes: String(src.scopes || "openid profile email User.Read"),
    }));
  }, [payload?.authSettings]);

  const saveAuthSettings = async () => {
    setAuthSaveBusy(true);
    setAuthSaveMessage("");
    try {
      const res = await fetch("/api/server/settings/auth", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          microsoft: {
            enabled: Boolean(authDraft.enabled),
            tenant: String(authDraft.tenant || "common").trim() || "common",
            clientId: String(authDraft.clientId || "").trim(),
            clientSecret: String(authDraft.clientSecret || "").trim(),
            redirectUri: String(authDraft.redirectUri || "").trim(),
            scopes: String(authDraft.scopes || "openid profile email User.Read").trim() || "openid profile email User.Read",
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || "Failed to save server auth settings."));
      setAuthSaveMessage("Server auth settings saved.");
      await load();
      setAuthDraft((prev) => ({ ...prev, clientSecret: "" }));
    } catch (err) {
      setAuthSaveMessage(String(err?.message || "Failed to save server auth settings."));
    } finally {
      setAuthSaveBusy(false);
    }
  };

  const summary = useMemo(() => {
    const health = payload.health && typeof payload.health === "object" ? payload.health : {};
    const opcStatus = payload.opcStatus && typeof payload.opcStatus === "object" ? payload.opcStatus : {};
    const opcConfig = payload.opcConfig && typeof payload.opcConfig === "object" ? payload.opcConfig : {};
    const dbConfig = payload.dbConfig && typeof payload.dbConfig === "object" ? payload.dbConfig : {};
    const pgDiag = payload.pgDiag && typeof payload.pgDiag === "object" ? payload.pgDiag : {};
    const appDiag = payload.appDiag && typeof payload.appDiag === "object" ? payload.appDiag : {};
    const appInfo = appDiag?.app && typeof appDiag.app === "object" ? appDiag.app : {};

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

    const settings = pgDiag?.settings && typeof pgDiag.settings === "object" ? pgDiag.settings : {};
    const settingValue = (key) => Number(settings?.[key]?.setting);
    const unitValue = (key) => String(settings?.[key]?.unit || "");
    const toBytes = (raw, unit) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) return null;
      const u = String(unit || "").toLowerCase();
      if (u === "8kb") return n * 8 * 1024;
      if (u === "kb") return n * 1024;
      if (u === "mb") return n * 1024 * 1024;
      if (u === "gb") return n * 1024 * 1024 * 1024;
      return n;
    };

    const blksHit = Number(pgDiag?.database?.blks_hit);
    const blksRead = Number(pgDiag?.database?.blks_read);
    const cacheHitPct =
      Number.isFinite(blksHit) && Number.isFinite(blksRead) && blksHit + blksRead > 0
        ? (blksHit / (blksHit + blksRead)) * 100
        : null;

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
      appCheckedAt: Number(appDiag?.checkedAt),
      appCpuUsagePct: Number(appInfo?.cpuUsagePct),
      hostCpuUsagePct: Number(appInfo?.hostCpuUsagePct),
      cpuCores: Number(appInfo?.cpuCores),
      appRssBytes: Number(appInfo?.rssBytes),
      appHeapUsedBytes: Number(appInfo?.heapUsedBytes),
      appHeapTotalBytes: Number(appInfo?.heapTotalBytes),
      totalMemoryBytes: Number(appInfo?.totalMemoryBytes),
      usedMemoryBytes: Number(appInfo?.usedMemoryBytes),
      systemMemoryUsedPct: Number(appInfo?.systemMemoryUsedPct),
      appMemoryOfSystemPct: Number(appInfo?.appMemoryOfSystemPct),
      pgCheckedAt: Number(pgDiag?.checkedAt),
      sharedBuffersBytes: toBytes(settingValue("shared_buffers"), unitValue("shared_buffers")),
      workMemBytes: toBytes(settingValue("work_mem"), unitValue("work_mem")),
      maintenanceWorkMemBytes: toBytes(settingValue("maintenance_work_mem"), unitValue("maintenance_work_mem")),
      effectiveCacheBytes: toBytes(settingValue("effective_cache_size"), unitValue("effective_cache_size")),
      maxConnections: settingValue("max_connections"),
      maxWorkerProcesses: settingValue("max_worker_processes"),
      maxParallelWorkers: settingValue("max_parallel_workers"),
      maxParallelPerGather: settingValue("max_parallel_workers_per_gather"),
      maxParallelMaintenanceWorkers: settingValue("max_parallel_maintenance_workers"),
      dbConnectionsTotal: Number(pgDiag?.connections?.total),
      dbConnectionsActive: Number(pgDiag?.connections?.active),
      dbConnectionsIdle: Number(pgDiag?.connections?.idle),
      dbConnectionsWaiting: Number(pgDiag?.connections?.waiting),
      cacheHitPct,
      tempFiles: Number(pgDiag?.database?.temp_files),
      tempBytes: Number(pgDiag?.database?.temp_bytes),
      deadlocks: Number(pgDiag?.database?.deadlocks),
      dbBytes: Number(pgDiag?.size?.db_bytes),
      tablesBytes: Number(pgDiag?.size?.tables_bytes),
      indexesBytes: Number(pgDiag?.size?.indexes_bytes),
      walBytes: Number(pgDiag?.wal?.wal_bytes),
      walRecords: Number(pgDiag?.wal?.wal_records),
      checkpointsTimed: Number(pgDiag?.bgwriter?.checkpoints_timed),
      checkpointsReq: Number(pgDiag?.bgwriter?.checkpoints_req),
      checkpointWriteMs: Number(pgDiag?.bgwriter?.checkpoint_write_time),
      checkpointSyncMs: Number(pgDiag?.bgwriter?.checkpoint_sync_time),
      lockCount: Number(pgDiag?.locks?.total),
      lockWaiting: Number(pgDiag?.locks?.waiting),
      uptimeSeconds: Number(pgDiag?.uptime?.uptime_seconds),
    };
  }, [payload]);

  const pill = (ok, textOk, textBad) => ({
    text: ok ? textOk : textBad,
    style: {
      border: `1px solid ${ok ? "#12b76a" : "#f04438"}`,
      background: "var(--bg-soft)",
      color: ok ? "#067647" : "#b42318",
      borderRadius: 999,
      padding: "4px 10px",
      fontSize: 12,
      fontWeight: 700,
      width: "fit-content",
      whiteSpace: "nowrap",
      alignSelf: "start",
    },
  });

  const aiPill = pill(summary.aiHealthy, "App Healthy", "App Offline");
  const opcPill = pill(summary.opcConnected, "OPC Connected", "OPC Disconnected");
  const dbPill = pill(summary.dbConnected, "DB Connected", "DB Disconnected");

  const panelStyle = cardStyle();
  const sectionTitleStyle = {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-muted)",
  };
  const statGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 8,
  };
  const tabButtonStyle = (active) => ({
    border: "none",
    borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    background: "transparent",
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderRadius: 0,
    minWidth: 0,
    height: 30,
    padding: "0 10px",
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "none",
    transition: "color 140ms ease, border-color 140ms ease, background-color 140ms ease",
  });
  const kvStyle = { fontSize: 12, color: "var(--text)" };
  const kvSubStyle = { fontSize: 12, color: "var(--text-muted)" };

  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        overflow: embedded ? "auto" : "visible",
        padding: embedded ? 10 : 12,
        display: "grid",
        gap: 12,
        alignContent: "start",
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>Server Diagnostics</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
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
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "2px 2px 10px",
          borderBottom: "1px solid var(--border)",
          marginBottom: 2,
        }}
      >
          <button
            type="button"
            data-preserve-style="true"
            onClick={() => setActiveTab("diagnostics")}
            style={tabButtonStyle(activeTab === "diagnostics")}
          >
            Diagnostics
          </button>
          <button
            type="button"
            data-preserve-style="true"
            onClick={() => setActiveTab("settings")}
            style={tabButtonStyle(activeTab === "settings")}
          >
            Settings
          </button>
      </div>

      {activeTab === "settings" ? (
        <div style={panelStyle}>
          <div style={sectionTitleStyle}>Microsoft Login</div>
          <div style={{ display: "grid", gridTemplateColumns: "180px minmax(0,1fr)", gap: 8, alignItems: "center" }}>
            <div style={kvStyle}>Enabled</div>
            <input
              type="checkbox"
              checked={Boolean(authDraft.enabled)}
              onChange={(e) => setAuthDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            <div style={kvStyle}>Tenant</div>
            <input
              value={authDraft.tenant}
              onChange={(e) => setAuthDraft((prev) => ({ ...prev, tenant: e.target.value }))}
              style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
            />
            <div style={kvStyle}>Client ID</div>
            <input
              value={authDraft.clientId}
              onChange={(e) => setAuthDraft((prev) => ({ ...prev, clientId: e.target.value }))}
              style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
            />
            <div style={kvStyle}>Client Secret</div>
            <input
              type="password"
              value={authDraft.clientSecret}
              onChange={(e) => setAuthDraft((prev) => ({ ...prev, clientSecret: e.target.value }))}
              placeholder="Leave blank to keep current"
              style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
            />
            <div style={kvStyle}>Redirect URI</div>
            <input
              value={authDraft.redirectUri}
              onChange={(e) => setAuthDraft((prev) => ({ ...prev, redirectUri: e.target.value }))}
              placeholder="Auto if blank"
              style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
            />
            <div style={kvStyle}>Scopes</div>
            <input
              value={authDraft.scopes}
              onChange={(e) => setAuthDraft((prev) => ({ ...prev, scopes: e.target.value }))}
              style={{ border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", fontSize: 12 }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ ...kvSubStyle, fontSize: 11 }}>
              Changes save to server settings (`ai-server/.env`) and apply immediately.
            </div>
            <button
              type="button"
              data-preserve-style="true"
              onClick={() => void saveAuthSettings()}
              disabled={authSaveBusy}
              style={{
                border: "1px solid #2b6cff",
                background: authSaveBusy ? "var(--bg-soft)" : "#2b6cff",
                color: authSaveBusy ? "var(--text-muted)" : "#fff",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 700,
                cursor: authSaveBusy ? "not-allowed" : "pointer",
              }}
            >
              {authSaveBusy ? "Saving..." : "Save Settings"}
            </button>
          </div>
          {authSaveMessage ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-soft)", padding: "6px 8px" }}>
              {authSaveMessage}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "diagnostics" ? (
        <>

      {error ? <div style={{ ...cardStyle("#f04438"), color: "#b42318" }}>{error}</div> : null}

      <div style={{ ...panelStyle, gap: 8 }}>
        <div style={sectionTitleStyle}>Service Health</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={aiPill.style}>{aiPill.text}</div>
        <div style={opcPill.style}>{opcPill.text}</div>
        <div style={dbPill.style}>{dbPill.text}</div>
        </div>
      </div>

      <div style={{ ...panelStyle, gap: 10 }}>
        <div style={sectionTitleStyle}>Service Control</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            data-preserve-style="true"
            disabled={Boolean(serviceBusyAction)}
            onClick={() => void runServiceAction("start")}
            style={{
              border: "1px solid #12b76a",
              background: serviceBusyAction === "start" ? "var(--bg-soft)" : "#12b76a",
              color: serviceBusyAction === "start" ? "var(--text-muted)" : "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: serviceBusyAction ? "not-allowed" : "pointer",
            }}
          >
            {serviceBusyAction === "start" ? "Starting..." : "Start All"}
          </button>
          <button
            type="button"
            data-preserve-style="true"
            disabled={Boolean(serviceBusyAction)}
            onClick={() => void runServiceAction("restart")}
            style={{
              border: "1px solid #2b6cff",
              background: serviceBusyAction === "restart" ? "var(--bg-soft)" : "#2b6cff",
              color: serviceBusyAction === "restart" ? "var(--text-muted)" : "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: serviceBusyAction ? "not-allowed" : "pointer",
            }}
          >
            {serviceBusyAction === "restart" ? "Restarting..." : "Restart All"}
          </button>
          <button
            type="button"
            data-preserve-style="true"
            disabled={Boolean(serviceBusyAction)}
            onClick={() => void runServiceAction("stop")}
            style={{
              border: "1px solid #f04438",
              background: serviceBusyAction === "stop" ? "var(--bg-soft)" : "#f04438",
              color: serviceBusyAction === "stop" ? "var(--text-muted)" : "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: serviceBusyAction ? "not-allowed" : "pointer",
            }}
          >
            {serviceBusyAction === "stop" ? "Stopping..." : "Stop All"}
          </button>
        </div>
        {serviceActionMessage ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--bg-soft)",
              padding: "6px 8px",
              whiteSpace: "normal",
              wordBreak: "break-word",
            }}
          >
            {serviceActionMessage}
          </div>
        ) : null}
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>OPC Inventory</div>
        <div style={statGridStyle}>
          <div style={kvStyle}><strong>PLCs:</strong> {asCount(summary.plcCount)}</div>
          <div style={kvStyle}><strong>Connected PLCs:</strong> {asCount(summary.connectedCount)}</div>
          <div style={kvStyle}><strong>Topics:</strong> {asCount(summary.topicCount)}</div>
          <div style={kvStyle}><strong>Total Tags:</strong> {asCount(summary.tagCount)}</div>
          <div style={kvStyle}><strong>Enabled Tags:</strong> {asCount(summary.enabledTagCount)}</div>
          <div style={kvStyle}><strong>Muted Tags:</strong> {asCount(summary.mutedTagCount)}</div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>OPC Performance</div>
        <div style={statGridStyle}>
          <div style={kvStyle}><strong>Longest Read:</strong> {asMs(summary.longestReadMs)}</div>
          <div style={kvStyle}><strong>Average Read:</strong> {asMs(summary.avgReadMs)}</div>
          <div style={kvStyle}><strong>Read Cycle Span:</strong> {asMs(summary.readCycleMs)}</div>
          <div style={kvStyle}><strong>Last OPC Publish:</strong> {asDate(summary.opcLastAt)}</div>
          <div style={kvStyle}><strong>Last Poll:</strong> {asDate(summary.opcLastPollAt)}</div>
          <div style={kvSubStyle}>Peak single read duration and cycle timing.</div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>PC And App Runtime</div>
        <div style={statGridStyle}>
          <div style={kvStyle}><strong>Host CPU:</strong> {asPct(summary.hostCpuUsagePct)}</div>
          <div style={kvStyle}><strong>App CPU:</strong> {asPct(summary.appCpuUsagePct)}</div>
          <div style={kvStyle}><strong>CPU Cores:</strong> {asCount(summary.cpuCores)}</div>
          <div style={kvStyle}><strong>System Memory Used:</strong> {asPct(summary.systemMemoryUsedPct)}</div>
          <div style={kvStyle}><strong>RAM Used:</strong> {asBytes(summary.usedMemoryBytes)} / {asBytes(summary.totalMemoryBytes)}</div>
          <div style={kvStyle}><strong>App Memory Used:</strong> {asBytes(summary.appRssBytes)}</div>
          <div style={kvStyle}><strong>App RAM Share:</strong> {asPct(summary.appMemoryOfSystemPct)}</div>
          <div style={kvStyle}><strong>App Heap Used:</strong> {asBytes(summary.appHeapUsedBytes)}</div>
          <div style={kvStyle}><strong>App Heap Total:</strong> {asBytes(summary.appHeapTotalBytes)}</div>
          <div style={kvStyle}><strong>App Checked:</strong> {asDate(summary.appCheckedAt)}</div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>Database And Writes</div>
        <div style={statGridStyle}>
          <div style={kvStyle}><strong>DB Latency:</strong> {asMs(summary.dbLatencyMs)}</div>
          <div style={kvStyle}><strong>Write Count:</strong> {asCount(summary.writes?.count)}</div>
          <div style={kvStyle}><strong>Write Avg:</strong> {asMs(summary.writes?.avgMs)}</div>
          <div style={kvStyle}><strong>Write Max:</strong> {asMs(summary.writes?.maxMs)}</div>
          <div style={kvStyle}><strong>DB Health Checked:</strong> {asDate(summary.dbCheckedAt)}</div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>PostgreSQL Memory And Workers</div>
        <div style={statGridStyle}>
          <div style={kvStyle}><strong>Shared Buffers:</strong> {asBytes(summary.sharedBuffersBytes)}</div>
          <div style={kvStyle}><strong>Work Mem:</strong> {asBytes(summary.workMemBytes)}</div>
          <div style={kvStyle}><strong>Maintenance Work Mem:</strong> {asBytes(summary.maintenanceWorkMemBytes)}</div>
          <div style={kvStyle}><strong>Effective Cache Size:</strong> {asBytes(summary.effectiveCacheBytes)}</div>
          <div style={kvStyle}><strong>Max Worker Processes:</strong> {asCount(summary.maxWorkerProcesses)}</div>
          <div style={kvStyle}><strong>Max Parallel Workers:</strong> {asCount(summary.maxParallelWorkers)}</div>
          <div style={kvStyle}><strong>Per Gather:</strong> {asCount(summary.maxParallelPerGather)}</div>
          <div style={kvStyle}><strong>Parallel Maintenance:</strong> {asCount(summary.maxParallelMaintenanceWorkers)}</div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>PostgreSQL Runtime</div>
        <div style={statGridStyle}>
          <div style={kvStyle}><strong>Connections:</strong> {asCount(summary.dbConnectionsTotal)} / {asCount(summary.maxConnections)}</div>
          <div style={kvStyle}><strong>Active:</strong> {asCount(summary.dbConnectionsActive)}</div>
          <div style={kvStyle}><strong>Idle:</strong> {asCount(summary.dbConnectionsIdle)}</div>
          <div style={kvStyle}><strong>Waiting Sessions:</strong> {asCount(summary.dbConnectionsWaiting)}</div>
          <div style={kvStyle}><strong>Cache Hit Ratio:</strong> {asPct(summary.cacheHitPct)}</div>
          <div style={kvStyle}><strong>Temp Files:</strong> {asCount(summary.tempFiles)}</div>
          <div style={kvStyle}><strong>Temp Bytes:</strong> {asBytes(summary.tempBytes)}</div>
          <div style={kvStyle}><strong>Deadlocks:</strong> {asCount(summary.deadlocks)}</div>
          <div style={kvSubStyle}><strong>Uptime:</strong> {asCount(summary.uptimeSeconds, "--")} s | <strong>Checked:</strong> {asDate(summary.pgCheckedAt)}</div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>Storage, WAL, Checkpoints, Locks</div>
        <div style={statGridStyle}>
          <div style={kvStyle}><strong>Database Size:</strong> {asBytes(summary.dbBytes)}</div>
          <div style={kvStyle}><strong>Tables Size:</strong> {asBytes(summary.tablesBytes)}</div>
          <div style={kvStyle}><strong>Indexes Size:</strong> {asBytes(summary.indexesBytes)}</div>
          <div style={kvStyle}><strong>WAL Bytes:</strong> {asBytes(summary.walBytes)}</div>
          <div style={kvStyle}><strong>WAL Records:</strong> {asCount(summary.walRecords)}</div>
          <div style={kvStyle}><strong>Timed Checkpoints:</strong> {asCount(summary.checkpointsTimed)}</div>
          <div style={kvStyle}><strong>Requested Checkpoints:</strong> {asCount(summary.checkpointsReq)}</div>
          <div style={kvStyle}><strong>Checkpoint Write Time:</strong> {asMs(summary.checkpointWriteMs)}</div>
          <div style={kvStyle}><strong>Checkpoint Sync Time:</strong> {asMs(summary.checkpointSyncMs)}</div>
          <div style={kvStyle}><strong>Total Locks:</strong> {asCount(summary.lockCount)}</div>
          <div style={kvStyle}><strong>Waiting Locks:</strong> {asCount(summary.lockWaiting)}</div>
        </div>
      </div>
      </>
      ) : null}
    </div>
  );
}
