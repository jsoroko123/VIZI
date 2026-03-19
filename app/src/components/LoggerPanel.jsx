import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toastError, toastSuccess } from "../utils/toast";

const LEVELS = ["all", "error", "warn", "info", "debug"];
const CATEGORIES = [
  "all",
  "general",
  "api",
  "opc",
  "database",
  "auth",
  "security",
  "client",
  "process",
  "system",
];
const DATA_TYPES = [
  "all",
  "text",
  "json_object",
  "json_array",
  "error",
  "number",
  "boolean",
  "null",
  "unknown",
];

function formatWhen(value) {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return "-";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "-";
  }
}

function levelColor(level) {
  const key = String(level || "").toLowerCase();
  if (key === "error") return "#ef4444";
  if (key === "warn") return "#f59e0b";
  if (key === "info") return "#3b82f6";
  return "var(--text-muted)";
}

function tryParseJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (!(text.startsWith("{") || text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatJsonBlock(value) {
  const parsed = tryParseJson(value);
  if (!parsed) return "";
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return "";
  }
}

function toFriendlyLabel(value) {
  return String(value || "")
    .replace(/[_\-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function summarizeMeta(value) {
  const parsed = tryParseJson(value) || (value && typeof value === "object" ? value : null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed)
    .filter(([, v]) => v == null || ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 6)
    .map(([k, v]) => ({ key: k, value: v == null ? "-" : String(v) }));
}

export default function LoggerPanel({ embedded = false, canEdit = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterLevel, setFilterLevel] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterDataType, setFilterDataType] = useState("all");
  const [filterSource, setFilterSource] = useState("");
  const [filterText, setFilterText] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const q = new URLSearchParams();
        q.set("limit", "300");
        if (filterLevel !== "all") q.set("level", filterLevel);
        if (filterCategory !== "all") q.set("category", filterCategory);
        if (filterDataType !== "all") q.set("data_type", filterDataType);
        if (String(filterSource || "").trim()) q.set("source", String(filterSource || "").trim());
        if (String(filterText || "").trim()) q.set("q", String(filterText || "").trim());
        if (String(filterFrom || "").trim()) {
          const iso = new Date(String(filterFrom)).toISOString();
          q.set("from", iso);
        }
        if (String(filterTo || "").trim()) {
          const iso = new Date(String(filterTo)).toISOString();
          q.set("to", iso);
        }
        const res = await fetch(`/api/logs?${q.toString()}`, { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load logs.");
        setRows(Array.isArray(data?.rows) ? data.rows : []);
        setUpdatedAt(Date.now());
        setError("");
      } catch (err) {
        const msg = String(err?.message || "Failed to load logs.");
        setError(msg);
        if (!silent) toastError(msg);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filterLevel, filterCategory, filterDataType, filterSource, filterText, filterFrom, filterTo]
  );

  const loadLogsRef = useRef(loadLogs);
  useEffect(() => {
    loadLogsRef.current = loadLogs;
  }, [loadLogs]);

  useEffect(() => {
    loadLogs(false);
  }, [loadLogs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadLogsRef.current(true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const hasRows = rows.length > 0;
  const list = useMemo(() => rows, [rows]);

  async function clearLogs() {
    try {
      const res = await fetch("/api/logs", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to clear logs.");
      toastSuccess("Logs cleared.");
      await loadLogs(false);
    } catch (err) {
      toastError(String(err?.message || "Failed to clear logs."));
    }
  }

  async function addTestLogs() {
    const route =
      typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "";
    const samples = [
      {
        level: "info",
        source: "logger.test",
        message: "Test info log from Logger panel",
        route,
        meta: { sample: true, kind: "info" },
      },
      {
        level: "warn",
        source: "logger.test",
        message: "Test warning log from Logger panel",
        route,
        meta: { sample: true, kind: "warn" },
      },
      {
        level: "error",
        source: "logger.test",
        message: "Test error log from Logger panel",
        route,
        meta: { sample: true, kind: "error" },
      },
    ];
    try {
      await Promise.all(
        samples.map((entry) =>
          fetch("/api/logs/client", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
          })
        )
      );
      toastSuccess("Test logs added.");
      await loadLogs(false);
    } catch (err) {
      toastError(String(err?.message || "Failed to add test logs."));
    }
  }

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: embedded ? 12 : 16,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(String(e.target.value || "all"))}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            padding: "8px 10px",
            fontWeight: 600,
          }}
        >
          {LEVELS.map((level) => (
            <option key={level} value={level}>
              {level === "all" ? "All levels" : level.toUpperCase()}
            </option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(String(e.target.value || "all"))}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            padding: "8px 10px",
            fontWeight: 600,
          }}
        >
          {CATEGORIES.map((v) => (
            <option key={v} value={v}>
              {v === "all" ? "All categories" : toFriendlyLabel(v)}
            </option>
          ))}
        </select>
        <select
          value={filterDataType}
          onChange={(e) => setFilterDataType(String(e.target.value || "all"))}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            padding: "8px 10px",
            fontWeight: 600,
          }}
        >
          {DATA_TYPES.map((v) => (
            <option key={v} value={v}>
              {v === "all" ? "All data types" : toFriendlyLabel(v)}
            </option>
          ))}
        </select>
        <input
          value={filterSource}
          onChange={(e) => setFilterSource(String(e.target.value || ""))}
          placeholder="Source filter"
          style={{
            flex: "0 1 180px",
            minWidth: 140,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            padding: "8px 10px",
          }}
        />
        <input
          value={filterText}
          onChange={(e) => setFilterText(String(e.target.value || ""))}
          placeholder="Search logs"
          style={{
            flex: "1 1 260px",
            minWidth: 180,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            padding: "8px 10px",
          }}
        />
        <input
          type="datetime-local"
          value={filterFrom}
          onChange={(e) => setFilterFrom(String(e.target.value || ""))}
          title="From date/time"
          style={{
            flex: "0 1 200px",
            minWidth: 180,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            padding: "8px 10px",
          }}
        />
        <input
          type="datetime-local"
          value={filterTo}
          onChange={(e) => setFilterTo(String(e.target.value || ""))}
          title="To date/time"
          style={{
            flex: "0 1 200px",
            minWidth: 180,
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            padding: "8px 10px",
          }}
        />
        <button
          data-preserve-style="true"
          onClick={() => loadLogs(false)}
          disabled={loading}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            fontWeight: 700,
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
        <button
          data-preserve-style="true"
          onClick={addTestLogs}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-elev)",
            color: "var(--text)",
            fontWeight: 700,
            padding: "8px 12px",
            cursor: "pointer",
          }}
          title="Add sample logs"
        >
          Test Logs
        </button>
        {canEdit ? (
          <button
            data-preserve-style="true"
            onClick={clearLogs}
            style={{
              border: "1px solid color-mix(in srgb, #ef4444 62%, var(--border) 38%)",
              borderRadius: 8,
              background: "color-mix(in srgb, #ef4444 14%, var(--bg-elev) 86%)",
              color: "#fecaca",
              fontWeight: 700,
              padding: "8px 12px",
              cursor: "pointer",
            }}
            title="Clear all logs"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: 12 }}>
        <span>{hasRows ? `${rows.length} logs` : "No logs"}</span>
        <span>Updated {formatWhen(updatedAt)}</span>
      </div>
      {error ? <div style={{ color: "#fca5a5", fontSize: 12 }}>{error}</div> : null}
      <div
        className="vizi-scroll"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "var(--bg-elev)",
          overflow: "auto",
        }}
      >
        {hasRows ? (
          <div style={{ display: "grid" }}>
            {list.map((row, idx) => (
              (() => {
                const messageText = String(row?.message || "");
                const formattedMessageJson = formatJsonBlock(messageText);
                const formattedMetaJson = formatJsonBlock(row?.meta);
                return (
              <div
                key={String(row?.id || `log-${idx}`)}
                style={{
                  borderBottom: "1px solid var(--border)",
                  padding: "8px 10px",
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: levelColor(row?.level) }}>
                    {String(row?.level || "info").toUpperCase()}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 6px" }}>
                    {toFriendlyLabel(row?.category || "general")}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 6px" }}>
                    {toFriendlyLabel(row?.data_type || row?.dataType || "unknown")}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatWhen(row?.at)}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{String(row?.source || "server")}</span>
                  {Number(row?.count || 1) > 1 ? (
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>x{Number(row?.count || 1)}</span>
                  ) : null}
                </div>
                <div style={{ color: "var(--text)", fontWeight: 600, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {messageText}
                </div>
                {summarizeMeta(row?.meta).length ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {summarizeMeta(row?.meta).map((pair) => (
                      <span
                        key={`${row?.id || idx}-${pair.key}`}
                        style={{
                          fontSize: 10,
                          color: "var(--text-muted)",
                          border: "1px solid var(--border)",
                          borderRadius: 999,
                          padding: "1px 6px",
                        }}
                      >
                        {toFriendlyLabel(pair.key)}: {pair.value}
                      </span>
                    ))}
                  </div>
                ) : null}
                {formattedMessageJson ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      borderRadius: 8,
                      background: "color-mix(in srgb, var(--bg-soft) 90%, transparent)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      lineHeight: 1.4,
                      overflow: "auto",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    }}
                  >
                    {formattedMessageJson}
                  </pre>
                ) : null}
                {row?.meta && Object.keys(row.meta || {}).length ? (
                  <pre
                    style={{
                      margin: 0,
                      padding: 8,
                      borderRadius: 8,
                      background: "color-mix(in srgb, var(--bg-soft) 90%, transparent)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      lineHeight: 1.4,
                      overflow: "auto",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    }}
                  >
                    {String(row?.meta_pretty || formattedMetaJson || String(row?.meta || ""))}
                  </pre>
                ) : null}
              </div>
                );
              })()
            ))}
          </div>
        ) : (
          <div style={{ padding: 16, color: "var(--text-muted)" }}>{loading ? "Loading logs..." : "No logs found."}</div>
        )}
      </div>
    </div>
  );
}
