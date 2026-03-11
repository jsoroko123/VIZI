import { useCallback, useEffect, useMemo, useState } from "react";
import { toastError, toastSuccess } from "../utils/toast";

const LEVELS = ["all", "error", "warn", "info", "debug"];

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

export default function LoggerPanel({ embedded = false, canEdit = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterLevel, setFilterLevel] = useState("all");
  const [filterText, setFilterText] = useState("");
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const q = new URLSearchParams();
        q.set("limit", "300");
        if (filterLevel !== "all") q.set("level", filterLevel);
        if (String(filterText || "").trim()) q.set("q", String(filterText || "").trim());
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
    [filterLevel, filterText]
  );

  useEffect(() => {
    loadLogs(false);
  }, [loadLogs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadLogs(true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [loadLogs]);

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
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatWhen(row?.at)}</span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{String(row?.source || "server")}</span>
                </div>
                <div style={{ color: "var(--text)", fontWeight: 600, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {messageText}
                </div>
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
                    {formattedMetaJson || String(row?.meta || "")}
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
