import { useEffect, useMemo, useRef, useState } from "react";

export default function AiTableBuilder() {
  const storageKey = "vizi_ai_table_builder_v1";
  const hydratedRef = useRef(false);
  const loadState = () => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return { messages: [] };
      const parsed = JSON.parse(raw);
      return {
        messages: parsed?.messages || [],
      };
    } catch {
      return { messages: [] };
    }
  };
  const initial = loadState();
  const [messages, setMessages] = useState(initial.messages);
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [lastMode, setLastMode] = useState("");
  const [lastSql, setLastSql] = useState("");
  const [lastSummary, setLastSummary] = useState("");
  const [lastColumns, setLastColumns] = useState([]);
  const [lastRows, setLastRows] = useState([]);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportName, setReportName] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [savingReport, setSavingReport] = useState(false);
  const [runningReportId, setRunningReportId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applyStatus, setApplyStatus] = useState("");
  const chatScrollRef = useRef(null);

  function toDisplayText(value) {
    if (typeof value === "string") return value;
    if (value == null) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function inferColumns(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    const keys = new Set();
    rows.forEach((row) => {
      if (!row || typeof row !== "object") return;
      Object.keys(row).forEach((k) => keys.add(k));
    });
    return Array.from(keys);
  }

  function renderCell(value) {
    if (value == null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  useEffect(() => {
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (activeTab !== "chat") return;
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeTab, messages.length]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      const payload = JSON.stringify({ messages });
      window.localStorage.setItem(storageKey, payload);
    } catch {
      // ignore
    }
  }, [messages]);

  useEffect(() => {
    loadReports();
  }, []);

  const history = useMemo(
    () =>
      messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    [messages]
  );

  async function generate() {
    const text = prompt.trim();
    if (!text) return;

    setLoading(true);
    setError("");
    setApplyStatus("");

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setPrompt("");

    try {
      const historyWithNext = [
        ...history,
        { role: "user", content: text },
      ];
      const res = await fetch("/api/ai/table-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history: historyWithNext,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed.");

      const modeRaw = String(data.mode || "").trim().toLowerCase();
      const sqlText = String(data.sql || "").trim();
      const summaryText = toDisplayText(data.summary).trim();
      const columns = Array.isArray(data.columns) ? data.columns : [];
      const rows = Array.isArray(data.rows) ? data.rows : [];
      const suggestedReportName = String(data.reportName || "").trim();
      const looksLikeQuery = /^(select|with)\b/i.test(sqlText) || rows.length > 0;
      const mode = modeRaw || (looksLikeQuery ? "query" : sqlText ? "ddl" : "answer");

      setLastMode(mode);
      setLastSql(sqlText);
      setLastSummary(summaryText);
      setLastColumns(columns.length ? columns : inferColumns(rows));
      setLastRows(rows);
      if (suggestedReportName && !reportName) {
        setReportName(suggestedReportName);
      }

      if (mode === "query" || mode === "report") {
        const formattedRows =
          rows.length === 0
            ? "No rows returned."
            : JSON.stringify(rows, null, 2);
        setApplyStatus("");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              mode === "report"
                ? `${summaryText || `Report query returned ${rows.length} row(s).`}\n\n${formattedRows}\n\nSave this query as a report from below.`
                : `${summaryText || `Returned ${rows.length} row(s).`}\n\n${formattedRows}`,
          },
        ]);
      } else if (mode === "answer") {
        setApplyStatus("");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: summaryText || "Done.",
          },
        ]);
      } else {
        if (!sqlText) throw new Error("No SQL returned.");
        const applyRes = await fetch("/api/ai/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: sqlText }),
        });
        const applyData = await applyRes.json();
        if (!applyRes.ok) throw new Error(applyData?.error || "Apply failed.");
        setApplyStatus("Database updated successfully.");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: summaryText
              ? `${summaryText}\n\nApplied to database.`
              : "Applied to database.",
          },
        ]);
      }
    } catch (err) {
      const message = err?.message || "Failed to generate/apply.";
      setError(message);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function loadReports() {
    try {
      setReportsLoading(true);
      const res = await fetch("/api/reports");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load reports.");
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (err) {
      setError(err?.message || "Failed to load reports.");
    } finally {
      setReportsLoading(false);
    }
  }

  async function saveCurrentReport() {
    try {
      const sql = String(lastSql || "").trim();
      if (!/^(select|with)\b/i.test(sql)) {
        throw new Error("Only read-only query results can be saved as reports.");
      }
      const name = String(reportName || "").trim();
      if (!name) throw new Error("Report name is required.");
      setSavingReport(true);
      setError("");
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: String(reportDescription || "").trim(),
          sql,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save report.");
      setApplyStatus("Report saved.");
      await loadReports();
      setActiveTab("reports");
    } catch (err) {
      setError(err?.message || "Failed to save report.");
    } finally {
      setSavingReport(false);
    }
  }

  async function runReport(report) {
    try {
      setRunningReportId(String(report?.id || ""));
      const res = await fetch(`/api/reports/${encodeURIComponent(String(report?.id || ""))}/run`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to run report.");
      const columns = Array.isArray(data.columns) ? data.columns : [];
      const rows = Array.isArray(data.rows) ? data.rows : [];
      setLastMode("query");
      setLastSql(String(data?.report?.sql || ""));
      setLastSummary(`Report: ${String(data?.report?.name || "")} (${rows.length} row(s))`);
      setLastColumns(columns.length ? columns : inferColumns(rows));
      setLastRows(rows);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Report "${String(data?.report?.name || "")}" returned ${rows.length} row(s).\n\n${
            rows.length ? JSON.stringify(rows, null, 2) : "No rows returned."
          }`,
        },
      ]);
      setActiveTab("preview");
    } catch (err) {
      setError(err?.message || "Failed to run report.");
    } finally {
      setRunningReportId("");
    }
  }

  async function deleteReport(report) {
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(String(report?.id || ""))}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to delete report.");
      await loadReports();
    } catch (err) {
      setError(err?.message || "Failed to delete report.");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        color: "var(--text)",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: "16px 16px 28px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>VIZI AI</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => {
                setMessages([]);
                setPrompt("");
              }}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 10,
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Clear Session
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, flex: "1 1 auto", minHeight: 0 }}>
          <div
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 14,
              boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              height: "100%",
              marginTop: -10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setActiveTab("chat")}
                  style={{
                    border: "1px solid var(--border)",
                    background: activeTab === "chat" ? "#2b6cff" : "var(--bg-elev)",
                    color: activeTab === "chat" ? "white" : "var(--text)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab("preview")}
                  style={{
                    border: "1px solid var(--border)",
                    background: activeTab === "preview" ? "#2b6cff" : "var(--bg-elev)",
                    color: activeTab === "preview" ? "white" : "var(--text)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Preview
                </button>
                <button
                  onClick={() => setActiveTab("reports")}
                  style={{
                    border: "1px solid var(--border)",
                    background: activeTab === "reports" ? "#2b6cff" : "var(--bg-elev)",
                    color: activeTab === "reports" ? "white" : "var(--text)",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Reports
                </button>
              </div>
            </div>
            <div
              ref={chatScrollRef}
              style={{
                flex: 1,
                overflow: "auto",
                background: "var(--bg-soft)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: 10,
                fontSize: 13,
                marginBottom: 12,
                minHeight: 0,
              }}
            >
              {activeTab === "reports" ? (
                reportsLoading ? (
                  <div style={{ color: "var(--text-muted)" }}>Loading reports...</div>
                ) : reports.length === 0 ? (
                  <div style={{ color: "var(--text-muted)" }}>
                    No saved reports yet.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {reports.map((r) => (
                      <div
                        key={String(r.id)}
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          background: "var(--bg-elev)",
                          padding: 10,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{String(r.name || "")}</div>
                            {r.description ? (
                              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{String(r.description)}</div>
                            ) : null}
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              Updated {r.updated_at ? new Date(r.updated_at).toLocaleString() : "-"}
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "start" }}>
                            <button
                              onClick={() => runReport(r)}
                              disabled={runningReportId === String(r.id)}
                              style={{
                                border: "1px solid #2b6cff",
                                background: "#2b6cff",
                                color: "white",
                                borderRadius: 8,
                                padding: "6px 10px",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              {runningReportId === String(r.id) ? "Running..." : "Run"}
                            </button>
                            <button
                              onClick={() => deleteReport(r)}
                              style={{
                                border: "1px solid #d92d20",
                                background: "var(--bg-elev)",
                                color: "#d92d20",
                                borderRadius: 8,
                                padding: "6px 10px",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            padding: 10,
                            borderRadius: 8,
                            fontSize: 11,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {String(r.sql || "")}
                        </pre>
                      </div>
                    ))}
                  </div>
                )
              ) : activeTab === "preview" ? (
                lastSql ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Last Request</div>
                    {lastSummary && (
                      <div
                        style={{
                          background: "var(--bg-elev)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: 10,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {lastSummary}
                      </div>
                    )}
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                      {lastMode === "query" ? "Query SQL" : "SQL Applied"}
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        background: "#0f172a",
                        color: "#e2e8f0",
                        padding: 12,
                        borderRadius: 8,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {lastSql}
                    </pre>
                    {(lastMode === "query" || lastMode === "report") && (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                          Results ({lastRows.length})
                        </div>
                        {lastRows.length === 0 ? (
                          <div
                            style={{
                              margin: 0,
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              border: "1px solid var(--border)",
                              padding: 12,
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                          >
                            No rows returned.
                          </div>
                        ) : (
                          <div
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              background: "var(--bg-elev)",
                              overflow: "auto",
                              maxHeight: 320,
                            }}
                          >
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                              <thead>
                                <tr style={{ background: "var(--bg-soft)" }}>
                                  {(lastColumns.length ? lastColumns : inferColumns(lastRows)).map((col) => (
                                    <th
                                      key={`head-${col}`}
                                      style={{
                                        textAlign: "left",
                                        padding: "8px 10px",
                                        borderBottom: "1px solid var(--border)",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {String(col)}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {lastRows.map((row, rowIdx) => (
                                  <tr key={`row-${rowIdx}`}>
                                    {(lastColumns.length ? lastColumns : inferColumns(lastRows)).map((col) => (
                                      <td
                                        key={`cell-${rowIdx}-${col}`}
                                        style={{
                                          padding: "8px 10px",
                                          borderBottom: "1px solid var(--border)",
                                          verticalAlign: "top",
                                          whiteSpace: "pre-wrap",
                                          wordBreak: "break-word",
                                          minWidth: 120,
                                        }}
                                      >
                                        {renderCell(row?.[col])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: "var(--text-muted)" }}>
                    No preview yet. Send a request to see the SQL.
                  </div>
                )
              ) : messages.length === 0 ? (
                <div style={{ color: "var(--text-muted)" }}>
                  Ask for tables like: "Create a users table with email, name, and created_at."
                </div>
              ) : (
                messages.map((m, i) => (
                  <div
                    key={`${m.role}-${i}`}
                    style={{
                      marginBottom: 10,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background:
                        m.role === "user"
                          ? "color-mix(in srgb, #2b6cff 16%, var(--bg-elev))"
                          : "var(--bg-elev)",
                      border: "1px solid var(--border)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                      {m.role === "user" ? "You" : "AI"}
                    </div>
                    {toDisplayText(m.content)}
                  </div>
                ))
              )}
            </div>

            <div
              style={{
                marginTop: "auto",
                background: "var(--bg-elev)",
                paddingTop: 10,
                marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ask VIZI AI..."
                  style={{
                    flex: 1,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 13,
                    outline: "none",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      generate();
                    }
                  }}
                />
                <button
                  onClick={generate}
                  disabled={loading}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "white",
                    borderRadius: 10,
                    padding: "10px 14px",
                    cursor: "pointer",
                  }}
                >
                  {loading ? "Generating..." : "Send"}
                </button>
              </div>
              {/^(select|with)\b/i.test(String(lastSql || "").trim()) && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginTop: 8 }}>
                  <input
                    value={reportName}
                    onChange={(e) => setReportName(e.target.value)}
                    placeholder="Report name"
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg-elev)",
                      color: "var(--text)",
                      borderRadius: 10,
                      padding: "8px 10px",
                      fontSize: 12,
                    }}
                  />
                  <input
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    placeholder="Description (optional)"
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg-elev)",
                      color: "var(--text)",
                      borderRadius: 10,
                      padding: "8px 10px",
                      fontSize: 12,
                    }}
                  />
                  <button
                    onClick={saveCurrentReport}
                    disabled={savingReport}
                    style={{
                      border: "1px solid #12b76a",
                      background: "#12b76a",
                      color: "white",
                      borderRadius: 10,
                      padding: "8px 12px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {savingReport ? "Saving..." : "Save Report"}
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div style={{ marginTop: 10, color: "#b42318", fontSize: 12 }}>{error}</div>
            )}
          </div>

          {applyStatus && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#12b76a" }}>{applyStatus}</div>
          )}
        </div>
      </div>
    </div>
  );
}
