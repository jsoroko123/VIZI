import { useEffect, useMemo, useState } from "react";

function asText(value, fallback = "--") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function asNumber(value, fallback = "--") {
  return Number.isFinite(Number(value)) ? String(Number(value)) : fallback;
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

export default function DatabaseConfigPanel({ embedded = false, mode = "all" }) {
  const [data, setData] = useState(null);
  const [pgDiag, setPgDiag] = useState(null);
  const [appDiag, setAppDiag] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState("");
  const [aligningVersion, setAligningVersion] = useState(false);
  const [form, setForm] = useState({
    protocol: "postgres",
    host: "",
    port: "5432",
    database: "",
    user: "",
    password: "",
    sslMode: "",
    applicationName: "",
    poolMax: "10",
  });

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const fetchJson = async (url) => {
        const res = await fetch(url, { credentials: "include" });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(payload?.error || `Failed to load ${url}.`));
        return payload && typeof payload === "object" ? payload : {};
      };

      const [configRes, pgRes, appRes] = await Promise.allSettled([
        fetchJson("/api/db/config"),
        fetchJson("/api/db/diagnostics/postgres"),
        fetchJson("/api/diagnostics/app"),
      ]);

      if (configRes.status === "fulfilled") setData(configRes.value);
      else setData(null);

      if (pgRes.status === "fulfilled") setPgDiag(pgRes.value);
      else setPgDiag(null);

      if (appRes.status === "fulfilled") setAppDiag(appRes.value);
      else setAppDiag(null);

      const errors = [configRes, pgRes, appRes]
        .filter((r) => r.status === "rejected")
        .map((r) => String(r.reason?.message || "Request failed"));
      if (errors.length) setError(errors[0]);
    } catch (err) {
      setError(String(err?.message || "Failed to load database config."));
      setData(null);
      setPgDiag(null);
      setAppDiag(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!data || typeof data !== "object") return;
    const editable = data?.editable && typeof data.editable === "object" ? data.editable : {};
    const connection = data?.connection && typeof data.connection === "object" ? data.connection : {};
    const pool = data?.pool && typeof data.pool === "object" ? data.pool : {};
    setForm((prev) => ({
      ...prev,
      protocol: String(editable?.protocol || connection?.protocol || prev.protocol || "postgres"),
      host: String(editable?.host || connection?.host || prev.host || ""),
      port: String(
        Number.isFinite(Number(editable?.port))
          ? Number(editable.port)
          : Number.isFinite(Number(connection?.port))
          ? Number(connection.port)
          : Number.isFinite(Number(prev.port))
          ? Number(prev.port)
          : 5432
      ),
      database: String(editable?.database || connection?.database || prev.database || ""),
      user: String(editable?.user || connection?.user || prev.user || ""),
      password: "",
      sslMode: String(editable?.sslMode || connection?.sslMode || prev.sslMode || ""),
      applicationName: String(
        editable?.applicationName || connection?.applicationName || prev.applicationName || ""
      ),
      poolMax: String(
        Number.isFinite(Number(pool?.configuredMax))
          ? Number(pool.configuredMax)
          : Number.isFinite(Number(pool?.max))
          ? Number(pool.max)
          : 10
      ),
    }));
  }, [data]);

  const connection = data?.connection && typeof data.connection === "object" ? data.connection : {};
  const versions = data?.versions && typeof data.versions === "object" ? data.versions : {};
  const health = data?.health && typeof data.health === "object" ? data.health : {};
  const pool = data?.pool && typeof data.pool === "object" ? data.pool : {};
  const catalog = data?.catalog && typeof data.catalog === "object" ? data.catalog : {};
  const pgSettings = pgDiag?.settings && typeof pgDiag.settings === "object" ? pgDiag.settings : {};
  const pgConn = pgDiag?.connections && typeof pgDiag.connections === "object" ? pgDiag.connections : {};
  const pgDb = pgDiag?.database && typeof pgDiag.database === "object" ? pgDiag.database : {};
  const pgSize = pgDiag?.size && typeof pgDiag.size === "object" ? pgDiag.size : {};
  const pgWal = pgDiag?.wal && typeof pgDiag.wal === "object" ? pgDiag.wal : {};
  const pgBg = pgDiag?.bgwriter && typeof pgDiag.bgwriter === "object" ? pgDiag.bgwriter : {};
  const pgLocks = pgDiag?.locks && typeof pgDiag.locks === "object" ? pgDiag.locks : {};
  const pgUptime = pgDiag?.uptime && typeof pgDiag.uptime === "object" ? pgDiag.uptime : {};
  const appInfo = appDiag?.app && typeof appDiag.app === "object" ? appDiag.app : {};
  const appDb = appDiag?.db && typeof appDiag.db === "object" ? appDiag.db : {};
  const appOpc = appDiag?.opc && typeof appDiag.opc === "object" ? appDiag.opc : {};
  const appOpcRuntime = appOpc?.runtime && typeof appOpc.runtime === "object" ? appOpc.runtime : {};

  const settingVal = (key) => Number(pgSettings?.[key]?.setting);
  const settingUnit = (key) => String(pgSettings?.[key]?.unit || "").toLowerCase();
  const settingToBytes = (key) => {
    const n = settingVal(key);
    const unit = settingUnit(key);
    if (!Number.isFinite(n)) return null;
    if (unit === "8kb") return n * 8 * 1024;
    if (unit === "kb") return n * 1024;
    if (unit === "mb") return n * 1024 * 1024;
    if (unit === "gb") return n * 1024 * 1024 * 1024;
    return n;
  };

  const cacheHitPct = useMemo(() => {
    const hit = Number(pgDb?.blks_hit);
    const read = Number(pgDb?.blks_read);
    if (!Number.isFinite(hit) || !Number.isFinite(read) || hit + read <= 0) return null;
    return (hit / (hit + read)) * 100;
  }, [pgDb?.blks_hit, pgDb?.blks_read]);

  const checkedAtText = useMemo(() => {
    const ts = Number(health?.checkedAt || 0);
    if (!Number.isFinite(ts) || ts <= 0) return "--";
    return new Date(ts).toLocaleString();
  }, [health?.checkedAt]);
  const pgCheckedAtText = useMemo(() => {
    const ts = Number(pgDiag?.checkedAt || 0);
    if (!Number.isFinite(ts) || ts <= 0) return "--";
    return new Date(ts).toLocaleString();
  }, [pgDiag?.checkedAt]);
  const appCheckedAtText = useMemo(() => {
    const ts = Number(appDiag?.checkedAt || 0);
    if (!Number.isFinite(ts) || ts <= 0) return "--";
    return new Date(ts).toLocaleString();
  }, [appDiag?.checkedAt]);

  const cardStyle = {
    border: "1px solid var(--border)",
    borderRadius: 12,
    background: "var(--bg-elev)",
    padding: 14,
    display: "grid",
    gap: 10,
  };
  const inputStyle = {
    width: "100%",
    minHeight: 30,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-soft)",
    color: "var(--text)",
    padding: "6px 8px",
    boxSizing: "border-box",
    fontSize: 12,
  };
  const panelMode = String(mode || "all").trim().toLowerCase();
  const showConfig = panelMode !== "diagnostics";
  const showDiagnostics = panelMode !== "config";
  const panelTitle =
    panelMode === "config"
      ? "Database Config"
      : panelMode === "diagnostics"
      ? "Database Diagnostics"
      : "Database Configuration";

  const onField = (key, value) => {
    setSaveError("");
    setSaveOk("");
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const saveConfig = async () => {
    setSaving(true);
    setSaveError("");
    setSaveOk("");
    try {
      const res = await fetch("/api/db/config", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection: {
            protocol: form.protocol,
            host: form.host,
            port: form.port,
            database: form.database,
            user: form.user,
            password: form.password,
            sslMode: form.sslMode,
            applicationName: form.applicationName,
          },
          poolMax: form.poolMax,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(payload?.error || "Failed to save database config."));
      setSaveOk("Saved.");
      await load();
    } catch (err) {
      setSaveError(String(err?.message || "Failed to save database config."));
    } finally {
      setSaving(false);
    }
  };

  const alignVersion = async () => {
    setAligningVersion(true);
    setSaveError("");
    setSaveOk("");
    try {
      const res = await fetch("/api/system/version/align", {
        method: "PUT",
        credentials: "include",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(payload?.error || "Failed to align versions."));
      setSaveOk("Version aligned.");
      await load();
    } catch (err) {
      setSaveError(String(err?.message || "Failed to align versions."));
    } finally {
      setAligningVersion(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflow: embedded ? "auto" : "visible",
        padding: embedded ? 10 : 12,
        display: "grid",
        gap: 12,
        alignContent: "start",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{panelTitle}</div>
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

      {showConfig ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Version Alignment</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>App:</strong> {asText(versions?.appVersion)}</div>
          <div><strong>DB:</strong> {asText(versions?.dbVersion)}</div>
          <div><strong>Expected DB:</strong> {asText(versions?.expectedDbVersion)}</div>
          <div><strong>Status:</strong> {versions?.aligned ? "Aligned" : "Mismatch"}</div>
        </div>
        {!versions?.aligned ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              data-preserve-style="true"
              onClick={() => void alignVersion()}
              style={{
                border: "1px solid #2b6cff",
                background: aligningVersion ? "var(--bg-soft)" : "#2b6cff",
                color: aligningVersion ? "var(--text-muted)" : "#fff",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 700,
                cursor: aligningVersion ? "not-allowed" : "pointer",
              }}
              disabled={aligningVersion}
            >
              {aligningVersion ? "Aligning..." : "Align DB Version"}
            </button>
          </div>
        ) : null}
      </div>
      ) : null}

      {showConfig ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Connection</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          <select value={form.protocol} onChange={(e) => onField("protocol", e.target.value)} style={inputStyle}>
            <option value="postgres">postgres</option>
            <option value="postgresql">postgresql</option>
          </select>
          <input value={form.host} onChange={(e) => onField("host", e.target.value)} style={inputStyle} placeholder="host" />
          <input value={form.port} onChange={(e) => onField("port", e.target.value)} style={inputStyle} placeholder="port" />
          <input value={form.database} onChange={(e) => onField("database", e.target.value)} style={inputStyle} placeholder="database" />
          <input value={form.user} onChange={(e) => onField("user", e.target.value)} style={inputStyle} placeholder="user" />
          <input value={form.password} onChange={(e) => onField("password", e.target.value)} style={inputStyle} placeholder="password (leave blank to keep)" type="password" />
          <input value={form.sslMode} onChange={(e) => onField("sslMode", e.target.value)} style={inputStyle} placeholder="sslmode (optional)" />
          <input value={form.applicationName} onChange={(e) => onField("applicationName", e.target.value)} style={inputStyle} placeholder="application_name (optional)" />
          <input value={form.poolMax} onChange={(e) => onField("poolMax", e.target.value)} style={inputStyle} placeholder="pool max" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            data-preserve-style="true"
            onClick={() => void saveConfig()}
            style={{
              border: "1px solid #2b6cff",
              background: saving ? "var(--bg-soft)" : "#2b6cff",
              color: saving ? "var(--text-muted)" : "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: saving ? "not-allowed" : "pointer",
            }}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save Config"}
          </button>
          <div style={{ fontSize: 12, color: saveError ? "#b42318" : "var(--text-muted)" }}>
            {saveError || saveOk || ""}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>Status:</strong> {connection?.configured ? "Configured" : "Not configured"}</div>
          <div><strong>SSL:</strong> {connection?.ssl === true ? "Enabled" : "Disabled"}</div>
          <div><strong>Current Pool Max:</strong> {asNumber(pool?.configuredMax ?? pool?.max)}</div>
        </div>
      </div>
      ) : null}

      {showConfig ? (
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
      ) : null}

      {showConfig ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Pool</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>Max:</strong> {asNumber(pool?.max)}</div>
          <div><strong>Total:</strong> {asNumber(pool?.total)}</div>
          <div><strong>Idle:</strong> {asNumber(pool?.idle)}</div>
          <div><strong>Waiting:</strong> {asNumber(pool?.waiting)}</div>
        </div>
      </div>
      ) : null}

      {showDiagnostics ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>App Performance (AI + OPC Runtime)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>PID:</strong> {asNumber(appInfo?.pid)}</div>
          <div><strong>Uptime:</strong> {asNumber(appInfo?.uptimeSec)} s</div>
          <div><strong>Node:</strong> {asText(appInfo?.nodeVersion)}</div>
          <div><strong>Platform:</strong> {asText(appInfo?.platform)} / {asText(appInfo?.arch)}</div>
          <div><strong>RSS:</strong> {asBytes(appInfo?.rssBytes)}</div>
          <div><strong>Heap Used:</strong> {asBytes(appInfo?.heapUsedBytes)}</div>
          <div><strong>Heap Total:</strong> {asBytes(appInfo?.heapTotalBytes)}</div>
          <div><strong>External:</strong> {asBytes(appInfo?.externalBytes)}</div>
          <div><strong>CPU User:</strong> {asNumber(appInfo?.cpuUserMs)} ms</div>
          <div><strong>CPU Sys:</strong> {asNumber(appInfo?.cpuSystemMs)} ms</div>
          <div><strong>Load 1m:</strong> {asNumber(appInfo?.loadAvg1m)}</div>
          <div><strong>Load 5m:</strong> {asNumber(appInfo?.loadAvg5m)}</div>
          <div><strong>DB Ping:</strong> {Number.isFinite(Number(appDb?.pingMs)) ? `${Math.round(Number(appDb.pingMs))} ms` : "--"}</div>
          <div><strong>OPC Connected:</strong> {appOpc?.connected ? "Yes" : "No"}</div>
          <div><strong>Last Poll Age:</strong> {Number.isFinite(Number(appOpc?.lastPollAgeMs)) ? `${Math.round(Number(appOpc.lastPollAgeMs))} ms` : "--"}</div>
          <div><strong>Tag Values:</strong> {asNumber(appOpc?.valueCount)}</div>
          <div><strong>Diagnostics:</strong> {asNumber(appOpc?.diagnosticCount)}</div>
          <div><strong>Multi-Read:</strong> {appOpcRuntime?.multiReadEnabled === false ? "Off" : "On"}</div>
          <div><strong>Batch Size:</strong> {asNumber(appOpcRuntime?.multiReadBatchSize)}</div>
          <div><strong>MQTT:</strong> {appOpcRuntime?.mqttEnabled ? (appOpcRuntime?.mqttConnected ? "Connected" : "Enabled") : "Off"}</div>
          <div><strong>Read Timeout:</strong> {Number.isFinite(Number(appOpcRuntime?.readTimeoutMs)) ? `${Math.round(Number(appOpcRuntime.readTimeoutMs))} ms` : "--"}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <strong>Quality Counts:</strong> {Object.keys(appOpc?.qualityCounts || {}).length
            ? Object.entries(appOpc.qualityCounts).map(([k, v]) => `${k}:${v}`).join(" | ")
            : "--"}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <strong>Checked:</strong> {appCheckedAtText}
        </div>
        {String(appDb?.error || "").trim() ? (
          <div style={{ fontSize: 12, color: "#b42318" }}>
            <strong>DB Error:</strong> {String(appDb.error)}
          </div>
        ) : null}
      </div>
      ) : null}

      {showDiagnostics ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>PostgreSQL Memory And Workers</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>Shared Buffers:</strong> {asBytes(settingToBytes("shared_buffers"))}</div>
          <div><strong>Work Mem:</strong> {asBytes(settingToBytes("work_mem"))}</div>
          <div><strong>Maint Work Mem:</strong> {asBytes(settingToBytes("maintenance_work_mem"))}</div>
          <div><strong>Effective Cache:</strong> {asBytes(settingToBytes("effective_cache_size"))}</div>
          <div><strong>Max Workers:</strong> {asNumber(settingVal("max_worker_processes"))}</div>
          <div><strong>Parallel Workers:</strong> {asNumber(settingVal("max_parallel_workers"))}</div>
          <div><strong>Per Gather:</strong> {asNumber(settingVal("max_parallel_workers_per_gather"))}</div>
          <div><strong>Parallel Maint:</strong> {asNumber(settingVal("max_parallel_maintenance_workers"))}</div>
        </div>
      </div>
      ) : null}

      {showDiagnostics ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>PostgreSQL Runtime</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>Connections:</strong> {asNumber(pgConn?.total)} / {asNumber(settingVal("max_connections"))}</div>
          <div><strong>Active:</strong> {asNumber(pgConn?.active)}</div>
          <div><strong>Idle:</strong> {asNumber(pgConn?.idle)}</div>
          <div><strong>Waiting:</strong> {asNumber(pgConn?.waiting)}</div>
          <div><strong>Cache Hit:</strong> {asPct(cacheHitPct)}</div>
          <div><strong>Temp Files:</strong> {asNumber(pgDb?.temp_files)}</div>
          <div><strong>Temp Bytes:</strong> {asBytes(pgDb?.temp_bytes)}</div>
          <div><strong>Deadlocks:</strong> {asNumber(pgDb?.deadlocks)}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <strong>Uptime:</strong> {asNumber(pgUptime?.uptime_seconds)} s | <strong>Checked:</strong> {pgCheckedAtText}
        </div>
      </div>
      ) : null}

      {showDiagnostics ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>PostgreSQL Storage, WAL, Checkpoints, Locks</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>DB Size:</strong> {asBytes(pgSize?.db_bytes)}</div>
          <div><strong>Tables:</strong> {asBytes(pgSize?.tables_bytes)}</div>
          <div><strong>Indexes:</strong> {asBytes(pgSize?.indexes_bytes)}</div>
          <div><strong>WAL:</strong> {asBytes(pgWal?.wal_bytes)}</div>
          <div><strong>WAL Records:</strong> {asNumber(pgWal?.wal_records)}</div>
          <div><strong>Timed Checkpoints:</strong> {asNumber(pgBg?.checkpoints_timed)}</div>
          <div><strong>Req Checkpoints:</strong> {asNumber(pgBg?.checkpoints_req)}</div>
          <div><strong>Write Time:</strong> {asNumber(pgBg?.checkpoint_write_time)} ms</div>
          <div><strong>Sync Time:</strong> {asNumber(pgBg?.checkpoint_sync_time)} ms</div>
          <div><strong>Total Locks:</strong> {asNumber(pgLocks?.total)}</div>
          <div><strong>Waiting Locks:</strong> {asNumber(pgLocks?.waiting)}</div>
        </div>
      </div>
      ) : null}
    </div>
  );
}
