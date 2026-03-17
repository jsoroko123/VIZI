import { useEffect, useMemo, useRef, useState } from "react";

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
    trendDatabaseUrl: "",
    trendPoolMax: "10",
    logDatabaseUrl: "",
    logPoolMax: "10",
    reportQueryTimeoutMs: "12000",
    reportMaxResultRows: "2000",
    reportMaxConcurrentQueries: "3",
    reportRateWindowMs: "10000",
    reportRateMaxRequests: "6",
  });
  const [backupConfig, setBackupConfig] = useState({
    enabled: false,
    intervalMinutes: 1440,
    keepBackups: 30,
    includeTrendDb: true,
    redundancyEnabled: false,
    redundancyCopies: 1,
    lastRunAt: 0,
  });
  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupSaving, setBackupSaving] = useState(false);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupRestoringId, setBackupRestoringId] = useState("");
  const [backupDownloadingId, setBackupDownloadingId] = useState("");
  const [backupImporting, setBackupImporting] = useState(false);
  const [backupError, setBackupError] = useState("");
  const [backupOk, setBackupOk] = useState("");
  const backupImportInputRef = useRef(null);

  const fetchJson = async (url, options = undefined) => {
    const res = await fetch(url, {
      credentials: "include",
      ...(options && typeof options === "object" ? options : {}),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(payload?.error || `Failed to load ${url}.`));
    return payload && typeof payload === "object" ? payload : {};
  };

  const loadBackupData = async () => {
    setBackupLoading(true);
    setBackupError("");
    try {
      const payload = await fetchJson("/api/db/backups");
      const cfg = payload?.config && typeof payload.config === "object" ? payload.config : {};
      setBackupConfig((prev) => ({
        ...prev,
        enabled: cfg.enabled === true,
        intervalMinutes: Number.isFinite(Number(cfg.intervalMinutes)) ? Number(cfg.intervalMinutes) : 1440,
        keepBackups: Number.isFinite(Number(cfg.keepBackups)) ? Number(cfg.keepBackups) : 30,
        includeTrendDb: cfg.includeTrendDb !== false,
        redundancyEnabled: cfg.redundancyEnabled === true,
        redundancyCopies: Number.isFinite(Number(cfg.redundancyCopies)) ? Number(cfg.redundancyCopies) : 1,
        lastRunAt: Number.isFinite(Number(cfg.lastRunAt)) ? Number(cfg.lastRunAt) : 0,
      }));
      setBackups(Array.isArray(payload?.backups) ? payload.backups : []);
    } catch (err) {
      setBackupError(String(err?.message || "Failed to load backup data."));
    } finally {
      setBackupLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const config = await fetchJson("/api/db/config");
      setData(config);
      const dbClient = String(config?.dbClient || "postgres").trim().toLowerCase();
      const jobs = [fetchJson("/api/diagnostics/app")];
      if (dbClient === "postgres") jobs.push(fetchJson("/api/db/diagnostics/postgres"));
      const settled = await Promise.allSettled(jobs);
      const appRes = settled[0];
      const pgRes = settled.length > 1 ? settled[1] : null;

      if (appRes?.status === "fulfilled") setAppDiag(appRes.value);
      else setAppDiag(null);

      if (pgRes?.status === "fulfilled") setPgDiag(pgRes.value);
      else setPgDiag(null);

      const errors = [appRes, pgRes]
        .filter((r) => r && r.status === "rejected")
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
    await loadBackupData();
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!data || typeof data !== "object") return;
    const editable = data?.editable && typeof data.editable === "object" ? data.editable : {};
    const connection = data?.connection && typeof data.connection === "object" ? data.connection : {};
    const pool = data?.pool && typeof data.pool === "object" ? data.pool : {};
    const trendConnection = data?.trendConnection && typeof data.trendConnection === "object" ? data.trendConnection : {};
    const trendPool = data?.trendPool && typeof data.trendPool === "object" ? data.trendPool : {};
    const logConnection = data?.logConnection && typeof data.logConnection === "object" ? data.logConnection : {};
    const logPool = data?.logPool && typeof data.logPool === "object" ? data.logPool : {};
    const sqlGuards = data?.sqlGuards && typeof data.sqlGuards === "object" ? data.sqlGuards : {};
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
      trendDatabaseUrl: String(
        editable?.trendDatabaseUrl || trendConnection?.maskedUrl || prev.trendDatabaseUrl || ""
      ),
      trendPoolMax: String(
        Number.isFinite(Number(editable?.trendPoolMax))
          ? Number(editable.trendPoolMax)
          : Number.isFinite(Number(trendPool?.configuredMax))
          ? Number(trendPool.configuredMax)
          : Number.isFinite(Number(prev.trendPoolMax))
          ? Number(prev.trendPoolMax)
          : 10
      ),
      logDatabaseUrl: String(
        editable?.logDatabaseUrl || logConnection?.maskedUrl || prev.logDatabaseUrl || ""
      ),
      logPoolMax: String(
        Number.isFinite(Number(editable?.logPoolMax))
          ? Number(editable.logPoolMax)
          : Number.isFinite(Number(logPool?.configuredMax))
          ? Number(logPool.configuredMax)
          : Number.isFinite(Number(prev.logPoolMax))
          ? Number(prev.logPoolMax)
          : 10
      ),
      reportQueryTimeoutMs: String(
        Number.isFinite(Number(sqlGuards?.reportQueryTimeoutMs))
          ? Number(sqlGuards.reportQueryTimeoutMs)
          : Number.isFinite(Number(prev.reportQueryTimeoutMs))
          ? Number(prev.reportQueryTimeoutMs)
          : 12000
      ),
      reportMaxResultRows: String(
        Number.isFinite(Number(sqlGuards?.reportMaxResultRows))
          ? Number(sqlGuards.reportMaxResultRows)
          : Number.isFinite(Number(prev.reportMaxResultRows))
          ? Number(prev.reportMaxResultRows)
          : 2000
      ),
      reportMaxConcurrentQueries: String(
        Number.isFinite(Number(sqlGuards?.reportMaxConcurrentQueries))
          ? Number(sqlGuards.reportMaxConcurrentQueries)
          : Number.isFinite(Number(prev.reportMaxConcurrentQueries))
          ? Number(prev.reportMaxConcurrentQueries)
          : 3
      ),
      reportRateWindowMs: String(
        Number.isFinite(Number(sqlGuards?.reportRateWindowMs))
          ? Number(sqlGuards.reportRateWindowMs)
          : Number.isFinite(Number(prev.reportRateWindowMs))
          ? Number(prev.reportRateWindowMs)
          : 10000
      ),
      reportRateMaxRequests: String(
        Number.isFinite(Number(sqlGuards?.reportRateMaxRequests))
          ? Number(sqlGuards.reportRateMaxRequests)
          : Number.isFinite(Number(prev.reportRateMaxRequests))
          ? Number(prev.reportRateMaxRequests)
          : 6
      ),
    }));
  }, [data]);

  const connection = data?.connection && typeof data.connection === "object" ? data.connection : {};
  const versions = data?.versions && typeof data.versions === "object" ? data.versions : {};
  const health = data?.health && typeof data.health === "object" ? data.health : {};
  const pool = data?.pool && typeof data.pool === "object" ? data.pool : {};
  const trendPoolConfig = data?.trendPool && typeof data.trendPool === "object" ? data.trendPool : {};
  const logPoolConfig = data?.logPool && typeof data.logPool === "object" ? data.logPool : {};
  const trendConnectionConfig =
    data?.trendConnection && typeof data.trendConnection === "object" ? data.trendConnection : {};
  const logConnectionConfig =
    data?.logConnection && typeof data.logConnection === "object" ? data.logConnection : {};
  const catalog = data?.catalog && typeof data.catalog === "object" ? data.catalog : {};
  const pgSettings = pgDiag?.settings && typeof pgDiag.settings === "object" ? pgDiag.settings : {};
  const pgConn = pgDiag?.connections && typeof pgDiag.connections === "object" ? pgDiag.connections : {};
  const pgDb = pgDiag?.database && typeof pgDiag.database === "object" ? pgDiag.database : {};
  const pgSize = pgDiag?.size && typeof pgDiag.size === "object" ? pgDiag.size : {};
  const pgWal = pgDiag?.wal && typeof pgDiag.wal === "object" ? pgDiag.wal : {};
  const pgBg = pgDiag?.bgwriter && typeof pgDiag.bgwriter === "object" ? pgDiag.bgwriter : {};
  const pgLocks = pgDiag?.locks && typeof pgDiag.locks === "object" ? pgDiag.locks : {};
  const pgUptime = pgDiag?.uptime && typeof pgDiag.uptime === "object" ? pgDiag.uptime : {};
  const trendDiag = pgDiag?.trend && typeof pgDiag.trend === "object" ? pgDiag.trend : null;
  const trendConn = trendDiag?.connections && typeof trendDiag.connections === "object" ? trendDiag.connections : {};
  const trendDb = trendDiag?.database && typeof trendDiag.database === "object" ? trendDiag.database : {};
  const trendSize = trendDiag?.size && typeof trendDiag.size === "object" ? trendDiag.size : {};
  const trendWal = trendDiag?.wal && typeof trendDiag.wal === "object" ? trendDiag.wal : {};
  const trendBg = trendDiag?.bgwriter && typeof trendDiag.bgwriter === "object" ? trendDiag.bgwriter : {};
  const trendLocks = trendDiag?.locks && typeof trendDiag.locks === "object" ? trendDiag.locks : {};
  const trendUptime = trendDiag?.uptime && typeof trendDiag.uptime === "object" ? trendDiag.uptime : {};
  const trendPool = trendDiag?.pool && typeof trendDiag.pool === "object" ? trendDiag.pool : {};
  const trendConnectionInfo =
    trendDiag?.connection && typeof trendDiag.connection === "object" ? trendDiag.connection : {};
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
  const trendCacheHitPct = useMemo(() => {
    const hit = Number(trendDb?.blks_hit);
    const read = Number(trendDb?.blks_read);
    if (!Number.isFinite(hit) || !Number.isFinite(read) || hit + read <= 0) return null;
    return (hit / (hit + read)) * 100;
  }, [trendDb?.blks_hit, trendDb?.blks_read]);

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
  const trendCheckedAtText = useMemo(() => {
    const ts = Number(trendDiag?.checkedAt || 0);
    if (!Number.isFinite(ts) || ts <= 0) return "--";
    return new Date(ts).toLocaleString();
  }, [trendDiag?.checkedAt]);
  const backupLastRunText = useMemo(() => {
    const ts = Number(backupConfig?.lastRunAt || 0);
    if (!Number.isFinite(ts) || ts <= 0) return "--";
    return new Date(ts).toLocaleString();
  }, [backupConfig?.lastRunAt]);

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
          client: form.protocol,
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
          trendDatabaseUrl: form.trendDatabaseUrl,
          trendPoolMax: form.trendPoolMax,
          logDatabaseUrl: form.logDatabaseUrl,
          logPoolMax: form.logPoolMax,
          sqlGuards: {
            reportQueryTimeoutMs: form.reportQueryTimeoutMs,
            reportMaxResultRows: form.reportMaxResultRows,
            reportMaxConcurrentQueries: form.reportMaxConcurrentQueries,
            reportRateWindowMs: form.reportRateWindowMs,
            reportRateMaxRequests: form.reportRateMaxRequests,
          },
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

  const onBackupField = (key, value) => {
    setBackupError("");
    setBackupOk("");
    setBackupConfig((prev) => ({ ...prev, [key]: value }));
  };

  const saveBackupConfig = async () => {
    setBackupSaving(true);
    setBackupError("");
    setBackupOk("");
    try {
      const payload = await fetchJson("/api/db/backup/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: backupConfig }),
      });
      const cfg = payload?.config && typeof payload.config === "object" ? payload.config : {};
      setBackupConfig((prev) => ({
        ...prev,
        enabled: cfg.enabled === true,
        intervalMinutes: Number.isFinite(Number(cfg.intervalMinutes)) ? Number(cfg.intervalMinutes) : prev.intervalMinutes,
        keepBackups: Number.isFinite(Number(cfg.keepBackups)) ? Number(cfg.keepBackups) : prev.keepBackups,
        includeTrendDb: cfg.includeTrendDb !== false,
        redundancyEnabled: cfg.redundancyEnabled === true,
        redundancyCopies: Number.isFinite(Number(cfg.redundancyCopies)) ? Number(cfg.redundancyCopies) : prev.redundancyCopies,
        lastRunAt: Number.isFinite(Number(cfg.lastRunAt)) ? Number(cfg.lastRunAt) : prev.lastRunAt,
      }));
      setBackupOk("Backup config saved.");
      await loadBackupData();
    } catch (err) {
      setBackupError(String(err?.message || "Failed to save backup config."));
    } finally {
      setBackupSaving(false);
    }
  };

  const runBackupNow = async () => {
    setBackupRunning(true);
    setBackupError("");
    setBackupOk("");
    try {
      await fetchJson("/api/db/backups/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeTrendDb: backupConfig.includeTrendDb !== false }),
      });
      setBackupOk("Backup created.");
      await loadBackupData();
    } catch (err) {
      setBackupError(String(err?.message || "Failed to create backup."));
    } finally {
      setBackupRunning(false);
    }
  };

  const restoreBackup = async (backupId) => {
    const id = String(backupId || "").trim();
    if (!id) return;
    const proceed = window.confirm(
      "Restore this backup now? This will overwrite current database contents and may disrupt active users."
    );
    if (!proceed) return;
    setBackupRestoringId(id);
    setBackupError("");
    setBackupOk("");
    try {
      await fetchJson("/api/db/backups/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupId: id }),
      });
      setBackupOk("Restore completed.");
      await loadBackupData();
      await load();
    } catch (err) {
      setBackupError(String(err?.message || "Failed to restore backup."));
    } finally {
      setBackupRestoringId("");
    }
  };

  const downloadBackup = async (backupItem) => {
    const id = String(backupItem?.id || "").trim();
    if (!id) return;
    setBackupDownloadingId(id);
    setBackupError("");
    setBackupOk("");
    try {
      const kinds = Array.from(
        new Set(
          (Array.isArray(backupItem?.files) ? backupItem.files : [])
            .map((f) => String(f?.kind || "").trim().toLowerCase())
            .filter((k) => k === "main" || k === "trend")
        )
      );
      if (!kinds.length) throw new Error("No backup dump files found.");
      const downloaded = [];
      for (const kind of kinds) {
        const res = await fetch(`/api/db/backups/file/${encodeURIComponent(id)}/${encodeURIComponent(kind)}`, {
          method: "GET",
          credentials: "include",
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(String(payload?.error || `Failed to download ${kind} dump.`));
        }
        const blob = await res.blob();
        const cd = String(res.headers.get("content-disposition") || "");
        const nameMatch = cd.match(/filename=\"?([^\";]+)\"?/i);
        const fileName = nameMatch?.[1] ? String(nameMatch[1]).trim() : `${id}__${kind}.dump`;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        downloaded.push(fileName);
      }
      setBackupOk(`Backup downloaded: ${downloaded.join(", ")}`);
    } catch (err) {
      setBackupError(String(err?.message || "Failed to download backup."));
    } finally {
      setBackupDownloadingId("");
    }
  };

  const onImportBackupClick = () => {
    const el = backupImportInputRef.current;
    if (!el) return;
    el.value = "";
    el.click();
  };

  const importBackupFromFile = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    setBackupImporting(true);
    setBackupError("");
    setBackupOk("");
    try {
      const text = await file.text();
      let parsed = null;
      try {
        parsed = JSON.parse(String(text || "").trim());
      } catch {
        throw new Error("Backup file is not valid JSON.");
      }
      await fetchJson("/api/db/backups/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle: parsed }),
      });
      setBackupOk("Backup imported.");
      await loadBackupData();
    } catch (err) {
      setBackupError(String(err?.message || "Failed to import backup."));
    } finally {
      setBackupImporting(false);
      if (event?.target) event.target.value = "";
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
            <option value="sqlserver">sqlserver</option>
          </select>
          <input value={form.host} onChange={(e) => onField("host", e.target.value)} style={inputStyle} placeholder="host" />
          <input value={form.port} onChange={(e) => onField("port", e.target.value)} style={inputStyle} placeholder="port" />
          <input value={form.database} onChange={(e) => onField("database", e.target.value)} style={inputStyle} placeholder="database" />
          <input value={form.user} onChange={(e) => onField("user", e.target.value)} style={inputStyle} placeholder="user" />
          <input value={form.password} onChange={(e) => onField("password", e.target.value)} style={inputStyle} placeholder="password (leave blank to keep)" type="password" />
          <input value={form.sslMode} onChange={(e) => onField("sslMode", e.target.value)} style={inputStyle} placeholder="sslmode (optional)" />
          <input value={form.applicationName} onChange={(e) => onField("applicationName", e.target.value)} style={inputStyle} placeholder="application_name (optional)" />
          <input value={form.poolMax} onChange={(e) => onField("poolMax", e.target.value)} style={inputStyle} placeholder="pool max" />
          <input
            value={form.trendDatabaseUrl}
            onChange={(e) => onField("trendDatabaseUrl", e.target.value)}
            style={inputStyle}
            placeholder="trend database url (postgres://...)"
          />
          <input
            value={form.trendPoolMax}
            onChange={(e) => onField("trendPoolMax", e.target.value)}
            style={inputStyle}
            placeholder="trend pool max"
            type="number"
            min="1"
            max="200"
          />
          <input
            value={form.logDatabaseUrl}
            onChange={(e) => onField("logDatabaseUrl", e.target.value)}
            style={inputStyle}
            placeholder="logger database url (postgres://...)"
          />
          <input
            value={form.logPoolMax}
            onChange={(e) => onField("logPoolMax", e.target.value)}
            style={inputStyle}
            placeholder="logger pool max"
            type="number"
            min="1"
            max="200"
          />
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
          <div><strong>Trend DB:</strong> {asText(trendConnectionConfig?.database)}</div>
          <div><strong>Trend Pool Max:</strong> {asNumber(trendPoolConfig?.configuredMax ?? trendPoolConfig?.max)}</div>
          <div><strong>Trend Same As Main:</strong> {trendPoolConfig?.sameAsMain ? "Yes" : "No"}</div>
          <div><strong>Logger DB:</strong> {asText(logConnectionConfig?.database)}</div>
          <div><strong>Logger Pool Max:</strong> {asNumber(logPoolConfig?.configuredMax ?? logPoolConfig?.max)}</div>
          <div><strong>Logger Same As Main:</strong> {logPoolConfig?.sameAsMain ? "Yes" : "No"}</div>
        </div>
      </div>
      ) : null}

      {showConfig ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>SQL Safety</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <label
            style={{ display: "grid", gap: 6, fontSize: 12 }}
            title="Maximum time a report/SQL preview query can run before it is canceled by the server. Lower values protect responsiveness; higher values allow heavier queries."
          >
            Report Query Timeout (ms)
            <input
              value={form.reportQueryTimeoutMs}
              onChange={(e) => onField("reportQueryTimeoutMs", e.target.value)}
              style={inputStyle}
              type="number"
              min="1000"
              max="120000"
              placeholder="12000"
            />
          </label>
          <label
            style={{ display: "grid", gap: 6, fontSize: 12 }}
            title="Hard cap on rows returned by report/SQL preview queries. Prevents oversized results from freezing the UI or overloading memory."
          >
            Report Max Rows
            <input
              value={form.reportMaxResultRows}
              onChange={(e) => onField("reportMaxResultRows", e.target.value)}
              style={inputStyle}
              type="number"
              min="1"
              max="20000"
              placeholder="2000"
            />
          </label>
          <label
            style={{ display: "grid", gap: 6, fontSize: 12 }}
            title="Maximum number of report/SQL preview queries allowed to execute at the same time."
          >
            Report Max Concurrent Queries
            <input
              value={form.reportMaxConcurrentQueries}
              onChange={(e) => onField("reportMaxConcurrentQueries", e.target.value)}
              style={inputStyle}
              type="number"
              min="1"
              max="50"
              placeholder="3"
            />
          </label>
          <label
            style={{ display: "grid", gap: 6, fontSize: 12 }}
            title="Sliding time window used for per-user report query rate limiting."
          >
            Report Rate Window (ms)
            <input
              value={form.reportRateWindowMs}
              onChange={(e) => onField("reportRateWindowMs", e.target.value)}
              style={inputStyle}
              type="number"
              min="1000"
              max="300000"
              placeholder="10000"
            />
          </label>
          <label
            style={{ display: "grid", gap: 6, fontSize: 12 }}
            title="Maximum report/SQL preview requests allowed per user within the rate window."
          >
            Report Rate Max Requests
            <input
              value={form.reportRateMaxRequests}
              onChange={(e) => onField("reportRateMaxRequests", e.target.value)}
              style={inputStyle}
              type="number"
              min="1"
              max="200"
              placeholder="6"
            />
          </label>
        </div>
      </div>
      ) : null}

      {showConfig ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Backup And Restore</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 8, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span>Auto Backup</span>
            <select
              value={backupConfig.enabled ? "on" : "off"}
              onChange={(e) => onBackupField("enabled", e.target.value === "on")}
              style={inputStyle}
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span>Interval (minutes)</span>
            <input
              value={backupConfig.intervalMinutes}
              onChange={(e) => onBackupField("intervalMinutes", e.target.value)}
              style={inputStyle}
              type="number"
              min="15"
              max="10080"
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span>Keep Backups</span>
            <input
              value={backupConfig.keepBackups}
              onChange={(e) => onBackupField("keepBackups", e.target.value)}
              style={inputStyle}
              type="number"
              min="3"
              max="500"
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span>Include Trend DB</span>
            <select
              value={backupConfig.includeTrendDb === false ? "no" : "yes"}
              onChange={(e) => onBackupField("includeTrendDb", e.target.value === "yes")}
              style={inputStyle}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span>Redundancy</span>
            <select
              value={backupConfig.redundancyEnabled ? "on" : "off"}
              onChange={(e) => onBackupField("redundancyEnabled", e.target.value === "on")}
              style={inputStyle}
            >
              <option value="off">Off</option>
              <option value="on">On</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span>Redundant Copies</span>
            <input
              value={backupConfig.redundancyCopies}
              onChange={(e) => onBackupField("redundancyCopies", e.target.value)}
              style={inputStyle}
              type="number"
              min="1"
              max="3"
              disabled={!backupConfig.redundancyEnabled}
            />
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <input
            ref={backupImportInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => void importBackupFromFile(e)}
          />
          <button
            type="button"
            data-preserve-style="true"
            onClick={() => void saveBackupConfig()}
            disabled={backupSaving}
            style={{
              border: "1px solid #2b6cff",
              background: backupSaving ? "var(--bg-soft)" : "#2b6cff",
              color: backupSaving ? "var(--text-muted)" : "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: backupSaving ? "not-allowed" : "pointer",
            }}
          >
            {backupSaving ? "Saving..." : "Save Backup Settings"}
          </button>
          <button
            type="button"
            data-preserve-style="true"
            onClick={() => void runBackupNow()}
            disabled={backupRunning || backupLoading}
            style={{
              border: "1px solid #16a34a",
              background: backupRunning ? "var(--bg-soft)" : "#16a34a",
              color: backupRunning ? "var(--text-muted)" : "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: backupRunning ? "not-allowed" : "pointer",
            }}
          >
            {backupRunning ? "Backing up..." : "Run Backup Now"}
          </button>
          <button
            type="button"
            data-preserve-style="true"
            onClick={() => onImportBackupClick()}
            disabled={backupImporting || !!backupRestoringId || backupRunning}
            style={{
              border: "1px solid #7c3aed",
              background: backupImporting ? "var(--bg-soft)" : "#7c3aed",
              color: backupImporting ? "var(--text-muted)" : "#fff",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: backupImporting ? "not-allowed" : "pointer",
            }}
          >
            {backupImporting ? "Importing..." : "Import Backup File"}
          </button>
          <button
            type="button"
            data-preserve-style="true"
            onClick={() => void loadBackupData()}
            disabled={backupLoading}
            style={{
              border: "1px solid var(--border)",
              background: "var(--bg-soft)",
              color: "var(--text)",
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 700,
              cursor: backupLoading ? "not-allowed" : "pointer",
            }}
          >
            {backupLoading ? "Refreshing..." : "Refresh Backups"}
          </button>
          <div style={{ fontSize: 12, color: backupError ? "#b42318" : "var(--text-muted)" }}>
            {backupError || backupOk || ""}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <strong>Last Auto/Manual Run:</strong> {backupLastRunText}
        </div>
        <div
          className="vizi-scroll"
          style={{
            maxHeight: 220,
            overflow: "auto",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg-soft)",
            padding: 8,
            display: "grid",
            gap: 6,
          }}
        >
          {Array.isArray(backups) && backups.length ? (
            backups.map((item) => {
              const id = String(item?.id || "").trim();
              const createdAt = Number(item?.createdAt || 0);
              const createdText = Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt).toLocaleString() : "--";
              const fileSummary = Array.isArray(item?.files)
                ? item.files
                    .map((f) => `${String(f?.kind || "db")}:${String(f?.dbName || "--")}`)
                    .join(" | ")
                : "--";
              const restoring = backupRestoringId && backupRestoringId === id;
              const downloading = backupDownloadingId && backupDownloadingId === id;
              return (
                <div
                  key={id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elev)",
                    padding: 8,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{id}</div>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={() => void downloadBackup(item)}
                      disabled={!!backupRestoringId || backupRunning || backupImporting}
                      style={{
                        border: "1px solid #2b6cff",
                        background: downloading ? "var(--bg-soft)" : "#2b6cff",
                        color: downloading ? "var(--text-muted)" : "#fff",
                        borderRadius: 8,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: downloading ? "not-allowed" : "pointer",
                      }}
                    >
                      {downloading ? "Downloading..." : "Download"}
                    </button>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={() => void restoreBackup(id)}
                      disabled={!!backupRestoringId || backupRunning || backupImporting}
                      style={{
                        border: "1px solid #f59e0b",
                        background: restoring ? "var(--bg-soft)" : "#f59e0b",
                        color: restoring ? "var(--text-muted)" : "#111827",
                        borderRadius: 8,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: restoring ? "not-allowed" : "pointer",
                      }}
                    >
                      {restoring ? "Restoring..." : "Restore"}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    <strong>Created:</strong> {createdText} | <strong>Reason:</strong> {asText(item?.reason, "manual")}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    <strong>Files:</strong> {fileSummary}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    <strong>Redundancy:</strong>{" "}
                    {item?.redundancy?.enabled ? `On (${Number(item?.redundancy?.copies || 1)} copy${Number(item?.redundancy?.copies || 1) > 1 ? "ies" : ""})` : "Off"}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              No backups found yet.
            </div>
          )}
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
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>App Performance (App + OPC Runtime)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>PID:</strong> {asNumber(appInfo?.pid)}</div>
          <div><strong>Uptime:</strong> {asNumber(appInfo?.uptimeSec)} s</div>
          <div><strong>Node:</strong> {asText(appInfo?.nodeVersion)}</div>
          <div><strong>Platform:</strong> {asText(appInfo?.platform)} / {asText(appInfo?.arch)}</div>
          <div><strong>Host CPU:</strong> {asPct(appInfo?.hostCpuUsagePct)}</div>
          <div><strong>App CPU:</strong> {asPct(appInfo?.cpuUsagePct)}</div>
          <div><strong>System Memory:</strong> {asPct(appInfo?.systemMemoryUsedPct)}</div>
          <div><strong>RAM Used:</strong> {asBytes(appInfo?.usedMemoryBytes)} / {asBytes(appInfo?.totalMemoryBytes)}</div>
          <div><strong>App Memory Used:</strong> {asBytes(appInfo?.rssBytes)}</div>
          <div><strong>App RAM Share:</strong> {asPct(appInfo?.appMemoryOfSystemPct)}</div>
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

      {showDiagnostics && trendDiag ? (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700 }}>Trend Database Diagnostics</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>Database:</strong> {asText(trendConnectionInfo?.database)}</div>
          <div><strong>Host:</strong> {asText(trendConnectionInfo?.host)}</div>
          <div><strong>Pool Max:</strong> {asNumber(trendPool?.max)}</div>
          <div><strong>Same As Main:</strong> {trendDiag?.sameAsMain ? "Yes" : "No"}</div>
          <div><strong>Connections:</strong> {asNumber(trendConn?.total)}</div>
          <div><strong>Active:</strong> {asNumber(trendConn?.active)}</div>
          <div><strong>Waiting:</strong> {asNumber(trendConn?.waiting)}</div>
          <div><strong>Cache Hit:</strong> {asPct(trendCacheHitPct)}</div>
          <div><strong>DB Size:</strong> {asBytes(trendSize?.db_bytes)}</div>
          <div><strong>Tables:</strong> {asBytes(trendSize?.tables_bytes)}</div>
          <div><strong>Indexes:</strong> {asBytes(trendSize?.indexes_bytes)}</div>
          <div><strong>WAL:</strong> {asBytes(trendWal?.wal_bytes)}</div>
          <div><strong>Temp Files:</strong> {asNumber(trendDb?.temp_files)}</div>
          <div><strong>Temp Bytes:</strong> {asBytes(trendDb?.temp_bytes)}</div>
          <div><strong>Deadlocks:</strong> {asNumber(trendDb?.deadlocks)}</div>
          <div><strong>Uptime:</strong> {asNumber(trendUptime?.uptime_seconds)} s</div>
          <div><strong>Timed Checkpoints:</strong> {asNumber(trendBg?.checkpoints_timed)}</div>
          <div><strong>Req Checkpoints:</strong> {asNumber(trendBg?.checkpoints_req)}</div>
          <div><strong>Total Locks:</strong> {asNumber(trendLocks?.total)}</div>
          <div><strong>Waiting Locks:</strong> {asNumber(trendLocks?.waiting)}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <strong>Checked:</strong> {trendCheckedAtText}
        </div>
      </div>
      ) : null}
    </div>
  );
}
