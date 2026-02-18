import { useEffect, useMemo, useRef, useState } from "react";
import { toastError, toastSuccess } from "../utils/toast";

function normalizeTagToken(value) {
  return String(value || "").trim().replace(/^["']|["']$/g, "");
}

function extractTagsFromPrompt(prompt) {
  const text = String(prompt || "");
  if (!text.trim()) return [];
  const fromLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(add|use|layout|lay\s*out|set|tag|tags|svg|with|for)\b/i.test(line))
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const fromCsv = text
    .replace(/\r?\n/g, ",")
    .split(",")
    .map((part) => normalizeTagToken(part))
    .filter(Boolean)
    .filter((part) => /[A-Za-z]/.test(part));
  const source = fromCsv.length > 1 ? fromCsv : fromLines;
  const out = [];
  const seen = new Set();
  source.forEach((raw) => {
    const next = normalizeTagToken(raw);
    if (!next) return;
    const key = next.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(next);
  });
  return out.slice(0, 200);
}

function getFolderFromSvgKey(key) {
  const parts = String(key || "").split("/");
  const i = parts.findIndex((p) => p === "SVG_Files" || p === "SVG Files");
  if (i >= 0) {
    const rest = parts.slice(i + 1);
    if (rest.length <= 1) return "Root";
    return rest.slice(0, -1).join(" / ");
  }
  if (parts.length <= 2) return "Root";
  return parts.slice(0, -1).slice(-1)[0] || "Root";
}

function tokenizeSvgCatalogText(value) {
  return Array.from(
    new Set(
      String(value || "")
        .replace(/[_/.-]+/g, " ")
        .replace(/\.svg$/i, "")
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean)
    )
  );
}

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
  const [lastSummaryRow, setLastSummaryRow] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportName, setReportName] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [selectedReportId, setSelectedReportId] = useState("");
  const [reportFiltersById, setReportFiltersById] = useState({});
  const [reportPositionalById, setReportPositionalById] = useState({});
  const [savingReport, setSavingReport] = useState(false);
  const [runningReportId, setRunningReportId] = useState("");
  const [loading, setLoading] = useState(false);
  const [svgSuggesting, setSvgSuggesting] = useState(false);
  const [svgCatalogBase, setSvgCatalogBase] = useState([]);
  const [pendingTagBatch, setPendingTagBatch] = useState(null); // { tags, choices:[{key,name}], selectedKey }
  const [error, setError] = useState("");
  const [applyStatus, setApplyStatus] = useState("");
  const chatScrollRef = useRef(null);
  const aiRequestSeqRef = useRef(1);
  const aiRequestResolversRef = useRef(new Map());

  useEffect(() => {
    const msg = String(error || "").trim();
    if (!msg) return;
    toastError(msg);
  }, [error]);

  useEffect(() => {
    const msg = String(applyStatus || "").trim();
    if (!msg) return;
    toastSuccess(msg);
  }, [applyStatus]);

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

  function extractFilterNames(sql) {
    const text = String(sql || "");
    const names = [];
    const seen = new Set();
    const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    let m;
    while ((m = re.exec(text)) != null) {
      const name = String(m[1] || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names;
  }

  function extractPositionalParamCount(sql) {
    const text = String(sql || "");
    const refs = Array.from(text.matchAll(/\$([1-9]\d*)\b/g)).map((m) => Number(m[1]));
    return refs.length ? Math.max(...refs) : 0;
  }

  function extractPositionalParamLabels(sql) {
    const text = String(sql || "");
    const labelsByIndex = {};
    const pattern =
      /(\b(?:"?[a-zA-Z_][a-zA-Z0-9_]*"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?)\s*(=|!=|<>|>=|<=|>|<|like|ilike)\s*\$([1-9]\d*)/gi;
    let m;
    while ((m = pattern.exec(text)) != null) {
      const field = String(m[2] || "").replace(/"/g, "").trim();
      const idx = Number(m[4]);
      if (!Number.isFinite(idx) || idx <= 0) continue;
      if (!labelsByIndex[idx]) {
        labelsByIndex[idx] = field || `param_${idx}`;
      }
    }
    return labelsByIndex;
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

  useEffect(() => {
    let alive = true;
    async function loadSvgCatalog() {
      try {
        const res = await fetch("/api/svg/catalog");
        const data = await res.json();
        if (!res.ok || !alive) return;
        const files = Array.isArray(data?.files)
          ? data.files.map((f) => ({
              key: String(f?.key || "").trim(),
              name: String(f?.name || "").trim(),
            }))
          : [];
        setSvgCatalogBase(files.filter((f) => f.key && f.name));
      } catch {
        if (alive) setSvgCatalogBase([]);
      }
    }
    loadSvgCatalog();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const res = await fetch("/api/svg/catalog");
        const data = await res.json();
        if (!res.ok || !alive) return;
        const files = Array.isArray(data?.files)
          ? data.files.map((f) => ({
              key: String(f?.key || "").trim(),
              name: String(f?.name || "").trim(),
            }))
          : [];
        if (files.length) setSvgCatalogBase(files.filter((f) => f.key && f.name));
      } catch {
        // keep existing catalog on refresh errors
      }
    };
    const id = setInterval(refresh, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const history = useMemo(
    () =>
      messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    [messages]
  );

  const selectedReport = useMemo(
    () => reports.find((r) => String(r.id) === String(selectedReportId || "")) || null,
    [reports, selectedReportId]
  );

  const svgCatalog = useMemo(() => {
    return (Array.isArray(svgCatalogBase) ? svgCatalogBase : [])
      .map(({ key, name }) => {
        const folder = getFolderFromSvgKey(key);
        return {
          key,
          name,
          tags: tokenizeSvgCatalogText(`${name} ${folder}`),
        };
      })
      .slice(0, 450);
  }, [svgCatalogBase]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event?.origin !== window.location.origin) return;
      const data = event?.data && typeof event.data === "object" ? event.data : null;
      if (!data || data.type !== "vizi.ai.add-tag-svgs:result") return;
      const requestId = String(data.requestId || "");
      if (!requestId) return;
      const pending = aiRequestResolversRef.current.get(requestId);
      if (!pending) return;
      aiRequestResolversRef.current.delete(requestId);
      if (data.ok) pending.resolve(data.result || {});
      else pending.reject(new Error(String(data.error || "Failed to add SVG tags.")));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function requestSvgSuggestionForTags(tags, userPrompt) {
    const cleanedTags = (Array.isArray(tags) ? tags : []).map((t) => String(t || "").trim()).filter(Boolean);
    if (!cleanedTags.length) throw new Error("No tags detected.");
    setSvgSuggesting(true);
    try {
      const res = await fetch("/api/ai/plc-svg-suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:
            String(userPrompt || "").trim() ||
            `Pick one SVG for these tags: ${cleanedTags.join(", ")}`,
          history,
          svgCatalog,
          plc: {
            controllerTags: cleanedTags.map((name) => ({ name })),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to suggest SVG.");
      const choices = [];
      const seen = new Set();
      const pushChoice = (row) => {
        const key = String(row?.key || "").trim();
        const name = String(row?.name || key.split("/").pop() || "").trim();
        if (!key) return;
        const lower = key.toLowerCase();
        if (seen.has(lower)) return;
        seen.add(lower);
        choices.push({ key, name });
      };
      pushChoice(data?.picked);
      (Array.isArray(data?.alternatives) ? data.alternatives : []).forEach(pushChoice);
      if (!choices.length) {
        throw new Error("No SVG choices were returned.");
      }
      setPendingTagBatch({
        tags: cleanedTags,
        choices,
        selectedKey: choices[0].key,
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `I found ${cleanedTags.length} tag(s). Which SVG should I use?\n${choices
            .map((c, i) => `${i + 1}. ${c.name}`)
            .join("\n")}`,
        },
      ]);
    } finally {
      setSvgSuggesting(false);
    }
  }

  async function sendBatchToEditor(payload) {
    if (window.parent === window) {
      throw new Error("Open AI inside the main app drawer to place SVGs on canvas.");
    }
    const requestId = `ai-batch-${Date.now()}-${aiRequestSeqRef.current++}`;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        aiRequestResolversRef.current.delete(requestId);
        reject(new Error("No response from canvas editor."));
      }, 15000);
      aiRequestResolversRef.current.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });
      window.parent.postMessage(
        {
          type: "vizi.ai.add-tag-svgs",
          requestId,
          payload,
        },
        window.location.origin
      );
    });
  }

  async function applyPendingTagBatch(overrideKey = "") {
    const pending = pendingTagBatch;
    if (!pending || !Array.isArray(pending.tags) || !pending.tags.length) return;
    const selectedKey = String(overrideKey || pending.selectedKey || "").trim();
    if (!selectedKey) throw new Error("Pick an SVG first.");
    const payload = {
      svgKey: selectedKey,
      tags: pending.tags,
      layout: {
        mode: "grid",
      },
    };
    const result = await sendBatchToEditor(payload);
    const count = Number(result?.count || pending.tags.length || 0);
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: `Added ${count} SVG item(s) with tagPath set.`,
      },
    ]);
    setPendingTagBatch(null);
  }

  async function generate() {
    const text = prompt.trim();
    if (!text) return;

    const detectedTags = extractTagsFromPrompt(text);
    const wantsSvgBatch =
      detectedTags.length >= 2 &&
      /\b(tag|tags|svg|layout|lay\s*out|canvas|tagpath|tag path)\b/i.test(text);
    if (wantsSvgBatch) {
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setPrompt("");
      setError("");
      setApplyStatus("");
      try {
        await requestSvgSuggestionForTags(detectedTags, text);
      } catch (err) {
        const message = String(err?.message || "Failed to suggest SVG.");
        setError(message);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${message}` },
        ]);
      }
      return;
    }

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
          reportContext: selectedReport
            ? {
                id: selectedReport.id,
                name: selectedReport.name || "",
                description: selectedReport.description || "",
                sql:
                  /^(select|with)\b/i.test(String(lastSql || "").trim()) && (lastMode === "query" || lastMode === "report")
                    ? String(lastSql || "")
                    : selectedReport.sql || "",
              }
            : null,
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
      setLastSummaryRow(data?.summaryRow && typeof data.summaryRow === "object" ? data.summaryRow : null);
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
                ? `${summaryText || `Report query returned ${rows.length} row(s).`}\n\n${formattedRows}\n\n${
                    selectedReport
                      ? `Click "Update Selected Report" below to save changes to "${String(selectedReport.name || "")}".`
                      : "Save this query as a report from below."
                  }`
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
      const currentSelectedId = String(selectedReport?.id || "").trim();
      setSavingReport(true);
      setError("");
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentSelectedId || undefined,
          name,
          description: String(reportDescription || "").trim(),
          sql,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save report.");
      setApplyStatus(currentSelectedId ? "Report updated." : "Report saved.");
      await loadReports();
      if (data?.report?.id) {
        setSelectedReportId(String(data.report.id));
      }
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
      const reportId = String(report?.id || "");
      const expectedFilterNames = extractFilterNames(report?.sql || "");
      const positionalCount = extractPositionalParamCount(report?.sql || "");
      const currentFilters = reportFiltersById[reportId] || {};
      const currentPositional = reportPositionalById[reportId] || [];
      const activeFilters = Object.fromEntries(
        expectedFilterNames.map((name) => {
          const raw = currentFilters[name];
          const value = raw == null ? "" : String(raw);
          return [name, value.trim() === "" ? null : raw];
        })
      );
      const positional = Array.from({ length: positionalCount }, (_, idx) => {
        const raw = currentPositional[idx];
        const value = raw == null ? "" : String(raw);
        return value.trim() === "" ? null : raw;
      });
      const res = await fetch(`/api/reports/${encodeURIComponent(String(report?.id || ""))}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: activeFilters, positional }),
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
      setLastSummaryRow(data?.summaryRow && typeof data.summaryRow === "object" ? data.summaryRow : null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Report "${String(data?.report?.name || "")}" returned ${rows.length} row(s)${
            Array.isArray(data?.report?.expectedFilters) && data.report.expectedFilters.length
              ? ` using filters: ${data.report.expectedFilters
                  .map((k) => `${k}=${String(activeFilters?.[k] ?? "")}`)
                  .join(", ")}`
              : ""
          }${
            Number(data?.report?.expectedPositionalParams || 0) > 0
              ? ` using params: ${Array.from(
                  { length: Number(data?.report?.expectedPositionalParams || 0) },
                  (_, idx) => `$${idx + 1}=${String(positional[idx] ?? "")}`
                ).join(", ")}`
              : ""
          }.\n\n${
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
      if (String(report?.id || "") === String(selectedReportId || "")) {
        setSelectedReportId("");
      }
      await loadReports();
    } catch (err) {
      setError(err?.message || "Failed to delete report.");
    }
  }

  function beginEditReport(report) {
    if (!report) return;
    setSelectedReportId(String(report.id || ""));
    setReportName(String(report.name || ""));
    setReportDescription(String(report.description || ""));
    setLastMode("report");
    setLastSql(String(report.sql || ""));
      setLastSummary(`Editing report: ${String(report.name || "")}`);
      setLastColumns([]);
      setLastRows([]);
      setLastSummaryRow(null);
    setActiveTab("chat");
    setApplyStatus(`Editing "${String(report.name || "")}". Ask AI to add filters, grouping, sorting, or columns.`);
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
                setSelectedReportId("");
                setPendingTagBatch(null);
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
                          outline:
                            String(selectedReportId || "") === String(r.id)
                              ? "2px solid #2b6cff"
                              : "none",
                        }}
                      >
                        {extractFilterNames(r.sql).length > 0 || extractPositionalParamCount(r.sql) > 0 ? (
                          <div
                            style={{
                              border: "1px dashed var(--border)",
                              borderRadius: 8,
                              background: "var(--bg-soft)",
                              padding: 8,
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}>
                              Filters
                            </div>
                            {extractFilterNames(r.sql).length > 0 ? (
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
                                {extractFilterNames(r.sql).map((name) => (
                                  <input
                                    key={`${String(r.id)}-filter-${name}`}
                                    value={String(reportFiltersById[String(r.id)]?.[name] ?? "")}
                                    onChange={(e) => {
                                      const nextValue = e.target.value;
                                      setReportFiltersById((prev) => ({
                                        ...prev,
                                        [String(r.id)]: {
                                          ...(prev[String(r.id)] || {}),
                                          [name]: nextValue,
                                        },
                                      }));
                                    }}
                                    placeholder={name}
                                    style={{
                                      border: "1px solid var(--border)",
                                      background: "var(--bg-elev)",
                                      color: "var(--text)",
                                      borderRadius: 8,
                                      padding: "6px 8px",
                                      fontSize: 12,
                                    }}
                                  />
                                ))}
                              </div>
                            ) : null}
                            {extractPositionalParamCount(r.sql) > 0 ? (
                              <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700 }}>
                                  Params
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                                  {Array.from({ length: extractPositionalParamCount(r.sql) }, (_, idx) => (
                                    <div key={`${String(r.id)}-param-${idx + 1}`} style={{ display: "grid", gap: 4 }}>
                                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                        {`${extractPositionalParamLabels(r.sql)[idx + 1] || `param_${idx + 1}`} ($${idx + 1})`}
                                      </div>
                                      <input
                                        value={String(reportPositionalById[String(r.id)]?.[idx] ?? "")}
                                        onChange={(e) => {
                                          const nextValue = e.target.value;
                                          setReportPositionalById((prev) => {
                                            const arr = Array.isArray(prev[String(r.id)]) ? [...prev[String(r.id)]] : [];
                                            arr[idx] = nextValue;
                                            return {
                                              ...prev,
                                              [String(r.id)]: arr,
                                            };
                                          });
                                        }}
                                        placeholder={extractPositionalParamLabels(r.sql)[idx + 1] || `param_${idx + 1}`}
                                        style={{
                                          border: "1px solid var(--border)",
                                          background: "var(--bg-elev)",
                                          color: "var(--text)",
                                          borderRadius: 8,
                                          padding: "6px 8px",
                                          fontSize: 12,
                                        }}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
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
                              onClick={() => beginEditReport(r)}
                              style={{
                                border: "1px solid var(--border)",
                                background:
                                  String(selectedReportId || "") === String(r.id)
                                    ? "color-mix(in srgb, #2b6cff 28%, var(--bg-elev))"
                                    : "var(--bg-elev)",
                                color: "var(--text)",
                                borderRadius: 8,
                                padding: "6px 10px",
                                fontSize: 12,
                                cursor: "pointer",
                              }}
                            >
                              Edit with AI
                            </button>
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
                                border: "1px solid #f04438",
                                background: "#f04438",
                                color: "#ffffff",
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
                                {lastSummaryRow ? (
                                  <tr
                                    style={{
                                      background: "color-mix(in srgb, #2b6cff 14%, var(--bg-elev))",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {(lastColumns.length ? lastColumns : inferColumns(lastRows)).map((col) => (
                                      <td
                                        key={`summary-${col}`}
                                        style={{
                                          padding: "8px 10px",
                                          borderTop: "1px solid var(--border)",
                                          verticalAlign: "top",
                                          whiteSpace: "pre-wrap",
                                          wordBreak: "break-word",
                                          minWidth: 120,
                                        }}
                                      >
                                        {renderCell(lastSummaryRow?.[col])}
                                      </td>
                                    ))}
                                  </tr>
                                ) : null}
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
              {selectedReport ? (
                <div
                  style={{
                    marginBottom: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-soft)",
                    color: "var(--text)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <div>
                    Editing report: <strong>{String(selectedReport.name || "")}</strong>
                  </div>
                  <button
                    onClick={() => setSelectedReportId("")}
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg-elev)",
                      color: "var(--text)",
                      borderRadius: 8,
                      padding: "4px 8px",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
              {pendingTagBatch ? (
                <div
                  style={{
                    marginBottom: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-soft)",
                    color: "var(--text)",
                    borderRadius: 10,
                    padding: "8px 10px",
                    display: "grid",
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <div>
                    Tags ready: <strong>{pendingTagBatch.tags.length}</strong>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(Array.isArray(pendingTagBatch.choices) ? pendingTagBatch.choices : []).map((choice) => {
                      const active =
                        String(pendingTagBatch.selectedKey || "").toLowerCase() ===
                        String(choice.key || "").toLowerCase();
                      return (
                        <button
                          key={`ai-svg-choice-${choice.key}`}
                          onClick={() =>
                            setPendingTagBatch((prev) =>
                              !prev
                                ? prev
                                : {
                                    ...prev,
                                    selectedKey: String(choice.key || ""),
                                  }
                            )
                          }
                          style={{
                            border: `1px solid ${active ? "#2b6cff" : "var(--border)"}`,
                            background: active
                              ? "color-mix(in srgb, #2b6cff 18%, var(--bg-elev))"
                              : "var(--bg-elev)",
                            color: "var(--text)",
                            borderRadius: 8,
                            padding: "6px 8px",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          {String(choice.name || choice.key)}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() =>
                        applyPendingTagBatch().catch((err) => {
                          const message = String(err?.message || "Failed to add SVG tags.");
                          setError(message);
                        })
                      }
                      style={{
                        border: "1px solid #2b6cff",
                        background: "#2b6cff",
                        color: "#fff",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Add to Canvas
                    </button>
                    <button
                      onClick={() => setPendingTagBatch(null)}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        color: "var(--text)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    selectedReport
                      ? `Update "${String(selectedReport.name || "")}" (filters, grouping, sorting, columns)...`
                      : "Ask VIZI AI..."
                  }
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
                  disabled={loading || svgSuggesting}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "white",
                    borderRadius: 10,
                    padding: "10px 14px",
                    cursor: "pointer",
                  }}
                >
                  {loading ? "Generating..." : svgSuggesting ? "Suggesting..." : "Send"}
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
                    {savingReport
                      ? "Saving..."
                      : selectedReport
                      ? "Update Selected Report"
                      : "Save Report"}
                  </button>
                </div>
              )}
            </div>

          </div>

        </div>
      </div>
    </div>
  );
}
