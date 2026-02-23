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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [serviceBusyAction, setServiceBusyAction] = useState("");
  const [serviceActionMessage, setServiceActionMessage] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [payload, setPayload] = useState({
    health: null,
    opcStatus: null,
    opcConfig: null,
    dbConfig: null,
    pgDiag: null,
    appDiag: null,
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
      const [healthRes, opcStatusRes, opcConfigRes, dbConfigRes, pgDiagRes, appDiagRes] = await Promise.allSettled([
        fetchJson("/api/health"),
        fetchJson("/api/opc/status"),
        fetchJson("/api/opc/config"),
        fetchJson("/api/db/config"),
        fetchJson("/api/db/diagnostics/postgres"),
        fetchJson("/api/diagnostics/app"),
      ]);

      const next = {
        health: healthRes.status === "fulfilled" ? healthRes.value : null,
        opcStatus: opcStatusRes.status === "fulfilled" ? opcStatusRes.value : null,
        opcConfig: opcConfigRes.status === "fulfilled" ? opcConfigRes.value : null,
        dbConfig: dbConfigRes.status === "fulfilled" ? dbConfigRes.value : null,
        pgDiag: pgDiagRes.status === "fulfilled" ? pgDiagRes.value : null,
        appDiag: appDiagRes.status === "fulfilled" ? appDiagRes.value : null,
      };

      setPayload(next);
      setUpdatedAt(Date.now());

      const errors = [healthRes, opcStatusRes, opcConfigRes, dbConfigRes, pgDiagRes, appDiagRes]
        .filter((r) => r.status === "rejected")
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
      background: ok ? "rgba(18,183,106,0.12)" : "rgba(240,68,56,0.12)",
      color: ok ? "#12b76a" : "#f04438",
      borderRadius: 999,
      padding: "4px 10px",
      fontSize: 11,
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
    fontSize: 10,
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
  const metricLabelStyle = { fontSize: 10, fontWeight: 700, color: "var(--text-muted)" };
  const metricValueStyle = { fontSize: 18, fontWeight: 800, lineHeight: 1.15 };
  const metricSubStyle = { fontSize: 10, color: "var(--text-muted)" };

  return (
    <div
      style={{
        height: "100%",
        boxSizing: "border-box",
        overflow: embedded ? "visible" : "auto",
        padding: embedded ? 0 : 16,
        display: "grid",
        gap: 12,
        alignContent: "start",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.01em" }}>Server Diagnostics</div>
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
            fontSize: 11,
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
              padding: "6px 12px",
              fontSize: 11,
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
              padding: "6px 12px",
              fontSize: 11,
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
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 700,
              cursor: serviceBusyAction ? "not-allowed" : "pointer",
            }}
          >
            {serviceBusyAction === "stop" ? "Stopping..." : "Stop All"}
          </button>
        </div>
        {serviceActionMessage ? (
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{serviceActionMessage}</div>
        ) : null}
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
            <div style={{ ...metricValueStyle, fontSize: 13 }}>{asDate(summary.opcLastAt)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Last Poll</div>
            <div style={{ ...metricValueStyle, fontSize: 13 }}>{asDate(summary.opcLastPollAt)}</div>
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>PC And App Runtime</div>
        <div style={statGridStyle}>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>Host CPU</div>
            <div style={metricValueStyle}>{asPct(summary.hostCpuUsagePct)}</div>
            <div style={metricSubStyle}>{asCount(summary.cpuCores)} cores</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>App CPU</div>
            <div style={metricValueStyle}>{asPct(summary.appCpuUsagePct)}</div>
            <div style={metricSubStyle}>Process usage</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>System Memory Used</div>
            <div style={metricValueStyle}>{asPct(summary.systemMemoryUsedPct)}</div>
            <div style={metricSubStyle}>
              {asBytes(summary.usedMemoryBytes)} / {asBytes(summary.totalMemoryBytes)}
            </div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>App Memory Used</div>
            <div style={metricValueStyle}>{asBytes(summary.appRssBytes)}</div>
            <div style={metricSubStyle}>RSS, {asPct(summary.appMemoryOfSystemPct)} of system RAM</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>App Heap Used</div>
            <div style={metricValueStyle}>{asBytes(summary.appHeapUsedBytes)}</div>
            <div style={metricSubStyle}>of {asBytes(summary.appHeapTotalBytes)}</div>
          </div>
          <div style={metricCardStyle}>
            <div style={metricLabelStyle}>App Checked</div>
            <div style={{ ...metricValueStyle, fontSize: 13 }}>{asDate(summary.appCheckedAt)}</div>
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
            <div style={{ ...metricValueStyle, fontSize: 13 }}>{asDate(summary.dbCheckedAt)}</div>
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>PostgreSQL Memory And Workers</div>
        <div style={statGridStyle}>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Shared Buffers</div><div style={metricValueStyle}>{asBytes(summary.sharedBuffersBytes)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Work Mem</div><div style={metricValueStyle}>{asBytes(summary.workMemBytes)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Maintenance Work Mem</div><div style={metricValueStyle}>{asBytes(summary.maintenanceWorkMemBytes)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Effective Cache Size</div><div style={metricValueStyle}>{asBytes(summary.effectiveCacheBytes)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Max Worker Processes</div><div style={metricValueStyle}>{asCount(summary.maxWorkerProcesses)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Max Parallel Workers</div><div style={metricValueStyle}>{asCount(summary.maxParallelWorkers)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Per Gather</div><div style={metricValueStyle}>{asCount(summary.maxParallelPerGather)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Parallel Maintenance</div><div style={metricValueStyle}>{asCount(summary.maxParallelMaintenanceWorkers)}</div></div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>PostgreSQL Runtime</div>
        <div style={statGridStyle}>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Connections</div><div style={metricValueStyle}>{asCount(summary.dbConnectionsTotal)}</div><div style={metricSubStyle}>Max {asCount(summary.maxConnections)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Active</div><div style={metricValueStyle}>{asCount(summary.dbConnectionsActive)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Idle</div><div style={metricValueStyle}>{asCount(summary.dbConnectionsIdle)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Waiting Sessions</div><div style={metricValueStyle}>{asCount(summary.dbConnectionsWaiting)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Cache Hit Ratio</div><div style={metricValueStyle}>{asPct(summary.cacheHitPct)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Temp Files</div><div style={metricValueStyle}>{asCount(summary.tempFiles)}</div><div style={metricSubStyle}>{asBytes(summary.tempBytes)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Deadlocks</div><div style={metricValueStyle}>{asCount(summary.deadlocks)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Uptime</div><div style={metricValueStyle}>{asCount(summary.uptimeSeconds, "--")}s</div><div style={metricSubStyle}>Checked {asDate(summary.pgCheckedAt)}</div></div>
        </div>
      </div>

      <div style={panelStyle}>
        <div style={sectionTitleStyle}>Storage, WAL, Checkpoints, Locks</div>
        <div style={statGridStyle}>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Database Size</div><div style={metricValueStyle}>{asBytes(summary.dbBytes)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Tables Size</div><div style={metricValueStyle}>{asBytes(summary.tablesBytes)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Indexes Size</div><div style={metricValueStyle}>{asBytes(summary.indexesBytes)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>WAL Bytes</div><div style={metricValueStyle}>{asBytes(summary.walBytes)}</div><div style={metricSubStyle}>{asCount(summary.walRecords)} records</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Timed Checkpoints</div><div style={metricValueStyle}>{asCount(summary.checkpointsTimed)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Requested Checkpoints</div><div style={metricValueStyle}>{asCount(summary.checkpointsReq)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Checkpoint Write Time</div><div style={metricValueStyle}>{asMs(summary.checkpointWriteMs)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Checkpoint Sync Time</div><div style={metricValueStyle}>{asMs(summary.checkpointSyncMs)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Total Locks</div><div style={metricValueStyle}>{asCount(summary.lockCount)}</div></div>
          <div style={metricCardStyle}><div style={metricLabelStyle}>Waiting Locks</div><div style={metricValueStyle}>{asCount(summary.lockWaiting)}</div></div>
        </div>
      </div>
    </div>
  );
}
