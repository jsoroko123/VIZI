import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toastError, toastSuccess } from "../utils/toast";
import { showConfirmDialog } from "../utils/confirmDialog";

export default function DataBrowser({
  embedded = false,
  embeddedPath = "",
  hideTableSelector = false,
  hideListFieldControls = false,
  useWhiteBackground = false,
}) {
  const { table, id } = useParams();
  const navigate = useNavigate();
  const [embeddedTable, setEmbeddedTable] = useState("");
  const [embeddedDetailId, setEmbeddedDetailId] = useState("");
  const currentTable = embedded ? String(embeddedTable || "") : String(table || "");
  const hideTopSelector = hideTableSelector || (!embedded && currentTable === "routes");
  const detailId = embedded ? String(embeddedDetailId || "") : id ? String(id) : "";
  const [tables, setTables] = useState([]);
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [primaryKey, setPrimaryKey] = useState(null);
  const [listFields, setListFields] = useState([]);
  const [tableColumnOrder, setTableColumnOrder] = useState([]);
  const [dragColumn, setDragColumn] = useState("");
  const [detailFieldOrder, setDetailFieldOrder] = useState([]);
  const [dragDetailField, setDragDetailField] = useState("");
  const [projects, setProjects] = useState([]);
  const [opcTags, setOpcTags] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(() => {
    return localStorage.getItem("vizi_active_project_id") || "";
  });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [formDraft, setFormDraft] = useState({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [typeMap, setTypeMap] = useState({});
  const [foreignKeyMeta, setForeignKeyMeta] = useState({});
  const [formEnabled, setFormEnabled] = useState(false);
  const [alarmViewTab, setAlarmViewTab] = useState("active");

  const tableList = useMemo(() => tables || [], [tables]);
  const isNewDetail = detailId === "new";
  const labelize = (value) => {
    const raw = String(value || "").trim();
    const withoutId = raw.replace(/_id$/i, "").replace(/Id$/, "");
    const source = withoutId || raw;
    return source.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  };
  const isHiddenColumn = (name) => {
    const key = String(name || "");
    if (!key) return false;
    if (key === "id") return true;
    return primaryKey ? key === primaryKey : false;
  };
  const getVisibleFields = (rowSample) => {
    let base = tableColumnOrder.length
      ? tableColumnOrder
      : listFields.length
        ? listFields
      : primaryKey
        ? [primaryKey]
        : Object.keys(rowSample || {}).filter((f) => !isHiddenColumn(f)).slice(0, 2);
    let visible = base.filter((f) => !isHiddenColumn(f));
    if (!visible.length) {
      const keys = Object.keys(rowSample || {}).filter((f) => !isHiddenColumn(f));
      visible = keys.slice(0, 2);
    }
    return visible;
  };
  const equipmentTagGroupOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    (opcTags || []).forEach((tag) => {
      const topic = String(tag?.topic || "").trim();
      const group = String(tag?.groupName || "").trim();
      if (!topic || !group) return;
      const value = `${topic}.${group}`;
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ value, label: group, topic });
    });
    out.sort((a, b) => {
      const t = a.topic.localeCompare(b.topic);
      if (t !== 0) return t;
      return a.label.localeCompare(b.label);
    });
    return out;
  }, [opcTags]);
  const isAlarmTable = useMemo(() => {
    const t = String(currentTable || "").trim().toLowerCase();
    if (!t) return false;
    return t.includes("alarm");
  }, [currentTable]);
  const isManagedAlarmTable = useMemo(
    () => String(currentTable || "").trim().toLowerCase() === "opc_alarm_state",
    [currentTable]
  );
  const hasAlarmActiveColumn = useMemo(() => {
    if (!isAlarmTable) return false;
    return (columns || []).some((c) => String(c?.column_name || "").toLowerCase() === "is_active");
  }, [columns, isAlarmTable]);
  const hasAlarmShelvedColumn = useMemo(() => {
    if (!isAlarmTable) return false;
    return (columns || []).some((c) => String(c?.column_name || "").toLowerCase() === "shelved_until");
  }, [columns, isAlarmTable]);
  const isRowActiveAlarm = (row) => {
    const value = row?.is_active;
    if (value === true || value === 1) return true;
    const text = String(value ?? "").trim().toLowerCase();
    return text === "true" || text === "1" || text === "t" || text === "yes" || text === "y" || text === "on";
  };
  const isRowShelvedAlarm = (row) => {
    const raw = row?.shelved_until;
    if (!raw) return false;
    const at = Number(new Date(raw).getTime() || 0);
    if (!Number.isFinite(at) || at <= 0) return false;
    return at > Date.now();
  };
  const displayedRows = useMemo(() => {
    if (!hasAlarmActiveColumn) return rows || [];
    if (alarmViewTab === "active") return (rows || []).filter((r) => isRowActiveAlarm(r));
    if (alarmViewTab === "shelved" && hasAlarmShelvedColumn) return (rows || []).filter((r) => isRowShelvedAlarm(r));
    return rows || [];
  }, [rows, hasAlarmActiveColumn, hasAlarmShelvedColumn, alarmViewTab]);

  useEffect(() => {
    if (isAlarmTable) setAlarmViewTab("active");
    else setAlarmViewTab("all");
  }, [isAlarmTable, currentTable]);

  const pageStyle = embedded
    ? {
        position: "relative",
        width: "100%",
        height: "100%",
        background: useWhiteBackground
          ? "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)"
          : "var(--bg-soft)",
        color: "var(--text)",
        overflow: "hidden",
      }
    : {
        position: "fixed",
        inset: 0,
        background: useWhiteBackground
          ? "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)"
          : "var(--bg-soft)",
        color: "var(--text)",
        overflow: "hidden",
      };
  const shellStyle = {
    width: "100%",
    height: "100%",
    margin: 0,
    padding: embedded ? "0 0 30px" : "0 0 30px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  };
  const cardStyle = {
    background: useWhiteBackground ? "rgba(255,255,255,0.92)" : "transparent",
    border: useWhiteBackground ? "1px solid #d2def6" : "none",
    borderRadius: 16,
    padding: 14,
    boxShadow: useWhiteBackground
      ? "0 8px 24px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.85)"
      : "0 20px 40px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.7)",
    backdropFilter: "blur(6px)",
  };
  const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    marginBottom: 0,
  };
  const sectionTitleStyle = {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 10,
  };
  const subtleText = { fontSize: 12, color: "var(--text-muted)" };
  const buttonBase = {
    border: "1px solid var(--border)",
    background: "var(--bg-elev)",
    color: "var(--text)",
    borderRadius: 10,
    padding: "7px 11px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.01em",
  };
  const primaryButton = {
    ...buttonBase,
    border: "1px solid var(--accent)",
    background: "linear-gradient(180deg, var(--accent) 0%, var(--accent-strong) 100%)",
    color: "var(--accent-text)",
    boxShadow: "0 8px 18px color-mix(in srgb, var(--accent) 25%, transparent)",
  };
  const dangerButton = {
    ...buttonBase,
    border: "1px solid var(--danger)",
    background: "linear-gradient(180deg, var(--danger) 0%, var(--danger-strong) 100%)",
    color: "var(--danger-text)",
    boxShadow: "0 8px 18px color-mix(in srgb, var(--danger) 24%, transparent)",
  };
  const ghostButton = {
    ...buttonBase,
    background: "transparent",
  };
  const iconActionButton = {
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--text)",
    width: 30,
    height: 30,
    borderRadius: 8,
    display: "inline-grid",
    placeItems: "center",
    padding: 0,
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  };
  const formFieldBackground = useWhiteBackground ? "#ffffff" : "var(--bg-elev)";
  const formFieldDisabledBackground = useWhiteBackground ? "#f3f6fc" : "var(--bg-soft)";
  const formFieldBorder = useWhiteBackground ? "#cfdcf6" : "var(--border)";
  const formFieldStyle = (enabled) => ({
    border: `1px solid ${formFieldBorder}`,
    borderRadius: 8,
    padding: "4px 8px",
    fontSize: 12,
    outline: "none",
    background: enabled ? formFieldBackground : formFieldDisabledBackground,
    boxShadow: enabled && useWhiteBackground ? "inset 0 1px 2px rgba(15,23,42,0.05)" : "none",
    height: 28,
    width: "100%",
  });
  useEffect(() => {
    const msg = String(status || "").trim();
    if (!msg) return;
    toastSuccess(msg);
  }, [status]);

  useEffect(() => {
    const msg = String(error || "").trim();
    if (!msg) return;
    toastError(msg);
  }, [error]);

  useEffect(() => {
    async function loadTables() {
      try {
        const res = await fetch("/api/db/tables");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load tables.");
        setTables(data.tables || []);
      } catch (err) {
        setError(err?.message || "Failed to load tables.");
      }
    }
    loadTables();
  }, []);

  useEffect(() => {
    if (!embedded) return;
    if (currentTable) return;
    if (!Array.isArray(tableList) || !tableList.length) return;
    setEmbeddedTable(String(tableList[0] || ""));
    setEmbeddedDetailId("");
  }, [embedded, currentTable, tableList]);

  useEffect(() => {
    if (!embedded) return;
    const raw = String(embeddedPath || "").trim();
    if (!raw) return;
    const normalized = raw.startsWith("/data/") ? raw : `/data/${raw.replace(/^\/+/, "")}`;
    const m = normalized.match(/^\/data\/([^/]+)(?:\/([^/]+))?$/i);
    if (!m) return;
    const nextTable = decodeURIComponent(String(m[1] || "")).trim();
    const nextDetailId = decodeURIComponent(String(m[2] || "")).trim();
    if (nextTable) setEmbeddedTable(nextTable);
    setEmbeddedDetailId(nextDetailId);
  }, [embedded, embeddedPath]);

  useEffect(() => {
    function handleStorage(event) {
      if (event.key === "vizi_active_project_id") {
        setActiveProjectId(event.newValue || "");
      }
    }
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (!activeProjectId) return;
    localStorage.setItem("vizi_active_project_id", activeProjectId);
  }, [activeProjectId]);

  useEffect(() => {
    async function loadProjects() {
      try {
        const res = await fetch("/api/projects");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load projects.");
        setProjects(data.projects || []);
      } catch {
        // ignore
      }
    }
    loadProjects();
  }, []);

  useEffect(() => {
    async function loadOpcTags() {
      try {
        const res = await fetch("/api/opc/tags");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load OPC tags.");
        setOpcTags(Array.isArray(data?.tags) ? data.tags : []);
      } catch {
        setOpcTags([]);
      }
    }
    loadOpcTags();
  }, []);

  useEffect(() => {
    async function loadMeta() {
      if (!currentTable) return;
      setError("");
      setColumns([]);
      setRows([]);
      setPrimaryKey(null);
      setListFields([]);
      setTableColumnOrder([]);
      setDetailFieldOrder([]);
      setSelectedId(null);
      setDetail(null);
      setTypeMap({});
      setForeignKeyMeta({});
      setFormDraft({});
      setFormEnabled(false);
      try {
        const res = await fetch(`/api/db/${currentTable}/meta`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load metadata.");
        setColumns(data.columns || []);
        setPrimaryKey(data.primaryKey || null);
        const nextTypeMap = {};
        (data.columns || []).forEach((c) => {
          nextTypeMap[c.column_name] = String(c.data_type || "").toLowerCase();
        });
        setTypeMap(nextTypeMap);
        setForeignKeyMeta(
          data?.foreignKeys && typeof data.foreignKeys === "object" ? data.foreignKeys : {}
        );
      } catch (err) {
        setError(err?.message || "Failed to load metadata.");
      }
    }
    loadMeta();
  }, [currentTable]);

  useEffect(() => {
    async function loadRows() {
      if (!currentTable) return;
      try {
        const projectParam =
          currentTable === "routes" && activeProjectId
            ? `&project_id=${encodeURIComponent(activeProjectId)}`
            : "";
        const res = await fetch(`/api/db/${currentTable}?limit=100${projectParam}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load rows.");
        setRows(data.rows || []);
        if (data.primaryKey) setPrimaryKey(data.primaryKey);
        if (Array.isArray(data.listFields)) {
          setListFields(data.listFields);
          setTableColumnOrder(data.listFields);
        }
        if (Array.isArray(data.detailFields)) {
          setDetailFieldOrder(data.detailFields);
        }
      } catch (err) {
        setError(err?.message || "Failed to load rows.");
      }
    }
    loadRows();
  }, [currentTable, activeProjectId]);

  useEffect(() => {
    if (detailId) {
      if (detailId === "new") {
        setSelectedId(null);
        setDetail(null);
        setFormDraft({});
        setFormEnabled(true);
        return;
      }
      setSelectedId(detailId);
      return;
    }
    setSelectedId(null);
  }, [detailId]);

  useEffect(() => {
    async function loadDetail() {
      if (!currentTable || !selectedId || isNewDetail) return;
      await reloadDetailRow(selectedId);
    }
    loadDetail();
  }, [currentTable, selectedId, primaryKey, isNewDetail]);

  async function reloadRows() {
    if (!currentTable) return;
    try {
      const projectParam =
        currentTable === "routes" && activeProjectId
          ? `&project_id=${encodeURIComponent(activeProjectId)}`
          : "";
      const res = await fetch(`/api/db/${currentTable}?limit=100${projectParam}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load rows.");
      setRows(data.rows || []);
      if (data.primaryKey) setPrimaryKey(data.primaryKey);
      if (Array.isArray(data.listFields)) {
        setListFields(data.listFields);
        setTableColumnOrder(data.listFields);
      }
      if (Array.isArray(data.detailFields)) {
        setDetailFieldOrder(data.detailFields);
      }
    } catch (err) {
      setError(err?.message || "Failed to load rows.");
    }
  }

  async function reloadDetailRow(rowId = selectedId) {
    const rowKey = String(rowId || "").trim();
    if (!currentTable || !rowKey || rowKey === "new") return;
    try {
      const pk = primaryKey ? `?pk=${encodeURIComponent(primaryKey)}` : "";
      const res = await fetch(`/api/db/${currentTable}/${encodeURIComponent(rowKey)}${pk}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load detail.");
      const row = data.row || null;
      setDetail(row);
      setFormDraft(row || {});
      setFormEnabled(false);
    } catch (err) {
      setError(err?.message || "Failed to load detail.");
    }
  }

  async function acknowledgeAlarm() {
    if (!isManagedAlarmTable || !selectedId) return;
    setError("");
    try {
      const res = await fetch(`/api/alarms/${encodeURIComponent(String(selectedId))}/ack`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to acknowledge alarm.");
      setStatus("Alarm acknowledged.");
      await reloadRows();
      await reloadDetailRow(selectedId);
    } catch (err) {
      setError(err?.message || "Failed to acknowledge alarm.");
    }
  }

  async function shelveAlarm(minutes) {
    if (!isManagedAlarmTable || !selectedId) return;
    setError("");
    const mins = Number.isFinite(Number(minutes)) ? Number(minutes) : 60;
    try {
      const res = await fetch(`/api/alarms/${encodeURIComponent(String(selectedId))}/shelve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: mins }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to shelve alarm.");
      setStatus(`Alarm shelved for ${mins} minute${mins === 1 ? "" : "s"}.`);
      await reloadRows();
      await reloadDetailRow(selectedId);
    } catch (err) {
      setError(err?.message || "Failed to shelve alarm.");
    }
  }

  async function unshelveAlarm() {
    if (!isManagedAlarmTable || !selectedId) return;
    setError("");
    try {
      const res = await fetch(`/api/alarms/${encodeURIComponent(String(selectedId))}/unshelve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to unshelve alarm.");
      setStatus("Alarm unshelved.");
      await reloadRows();
      await reloadDetailRow(selectedId);
    } catch (err) {
      setError(err?.message || "Failed to unshelve alarm.");
    }
  }

  async function saveRow() {
    if (!currentTable) return;
    setError("");
    const payload = buildPayload(formDraft);
    const pendingDetailOrder = Array.isArray(detailFieldOrder) ? [...detailFieldOrder] : [];
    if (currentTable === "routes" && activeProjectId && !payload.project_id) {
      payload.project_id = activeProjectId;
    }
    try {
      if (selectedId) {
        const pk = primaryKey ? `?pk=${encodeURIComponent(primaryKey)}` : "";
        const res = await fetch(`/api/db/${currentTable}/${selectedId}${pk}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Update failed.");
        setDetail(data.row || null);
        setFormDraft(data.row || {});
      } else {
        const res = await fetch(`/api/db/${currentTable}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Insert failed.");
        setDetail(data.row || null);
        setFormDraft(data.row || {});
      }
      await saveDetailFields(pendingDetailOrder);
      await reloadRows();
      setFormEnabled(false);
      navigateData(`/data/${currentTable}`);
    } catch (err) {
      setError(err?.message || "Save failed.");
    }
  }

  async function deleteRow() {
    if (!currentTable || !selectedId) return;
    const confirmed = await showConfirmDialog({
      title: "Delete Row",
      message: "Delete this row?",
      confirmText: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    setError("");
    try {
      const pk = primaryKey ? `?pk=${encodeURIComponent(primaryKey)}` : "";
      const res = await fetch(`/api/db/${currentTable}/${selectedId}${pk}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed.");
      setSelectedId(null);
      setDetail(null);
      setFormDraft({});
      setFormEnabled(false);
      await reloadRows();
      navigateData(`/data/${currentTable}`);
    } catch (err) {
      setError(err?.message || "Delete failed.");
    }
  }

  function inputTypeFor(columnName) {
    const t = typeMap[columnName] || "";
    if (t.includes("bool")) return "checkbox";
    if (t.includes("date") && !t.includes("time")) return "date";
    if (t.includes("timestamp") || t.includes("time")) return "datetime-local";
    if (
      t.includes("int") ||
      t.includes("numeric") ||
      t.includes("decimal") ||
      t.includes("real") ||
      t.includes("double")
    ) {
      return "number";
    }
    return "text";
  }

  function coerceValue(columnName, value) {
    const t = typeMap[columnName] || "";
    if (value === "" || value === undefined) return null;
    if (t.includes("bool")) return Boolean(value);
    if (
      t.includes("int") ||
      t.includes("numeric") ||
      t.includes("decimal") ||
      t.includes("real") ||
      t.includes("double")
    ) {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return value;
  }

  function formatValue(columnName, value) {
    if (value == null) return "";
    const fkMeta =
      foreignKeyMeta && typeof foreignKeyMeta === "object"
        ? foreignKeyMeta[String(columnName || "")]
        : null;
    const fkOptions = Array.isArray(fkMeta?.options) ? fkMeta.options : [];
    if (fkOptions.length) {
      const valueText = String(value);
      let match = fkOptions.find((opt) => String(opt?.value ?? "") === valueText);
      if (!match) {
        const valueNum = Number(value);
        if (Number.isFinite(valueNum)) {
          match = fkOptions.find((opt) => {
            const optNum = Number(opt?.value);
            return Number.isFinite(optNum) && optNum === valueNum;
          });
        }
      }
      if (match) return String(match?.label || match?.value || "");
    }
    const t = typeMap[columnName] || "";
    if (t.includes("date") || t.includes("time")) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        return t.includes("date") && !t.includes("time")
          ? date.toLocaleDateString()
          : date.toLocaleString();
      }
    }
    return String(value);
  }

  function buildPayload(draft) {
    const out = {};
    Object.keys(draft || {}).forEach((k) => {
      out[k] = coerceValue(k, draft[k]);
    });
    return out;
  }

  async function saveListFields() {
    if (!currentTable) return;
    setError("");
    setStatus("");
    try {
      const visibleListFields = (tableColumnOrder.length ? tableColumnOrder : listFields || []).filter(
        (f) => !isHiddenColumn(f)
      );
      const res = await fetch(`/api/db/${currentTable}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_fields: visibleListFields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save list config.");
      setStatus("List fields saved.");
    } catch (err) {
      setError(err?.message || "Failed to save list config.");
    }
  }

  async function saveDetailFields(orderOverride = null) {
    if (!currentTable) return;
    setError("");
    setStatus("");
    try {
      const sourceOrder = Array.isArray(orderOverride) ? orderOverride : detailFieldOrder || [];
      const visibleDetailFields = sourceOrder.filter((f) => !isHiddenColumn(f));
      const res = await fetch(`/api/db/${currentTable}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_fields: listFields || [], detail_fields: visibleDetailFields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save detail config.");
      setStatus("Detail fields saved.");
    } catch (err) {
      setError(err?.message || "Failed to save detail config.");
    }
  }

  const navigateData = (path) => {
    const next = String(path || "").trim();
    if (!next) return;
    if (!embedded) {
      navigate(next);
      return;
    }
    const m = next.match(/^\/data\/([^/]+)(?:\/([^/]+))?$/i);
    if (!m) return;
    setEmbeddedTable(decodeURIComponent(String(m[1] || "")));
    setEmbeddedDetailId(decodeURIComponent(String(m[2] || "")));
  };

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gridTemplateRows: hideTopSelector ? "minmax(0, 1fr)" : "auto minmax(0, 1fr)",
            rowGap: 12,
            flex: 1,
            height: "100%",
            minHeight: 0,
          }}
        >
          {!hideTopSelector ? (
            <div style={{ ...cardStyle }}>
              <div style={sectionTitleStyle}>Tables</div>
              <div style={{ display: "grid", gap: 8 }}>
                <select
                  value={currentTable || ""}
                  onChange={(e) => navigateData(`/data/${e.target.value}`)}
                  disabled={!tableList.length}
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    padding: "8px 10px",
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {!tableList.length ? <option value="">No tables found</option> : null}
                  {tableList.map((t) => (
                    <option key={`table-select-${t}`} value={t}>
                      {labelize(t)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}


          {detailId ? (
            <div
              style={{
                ...cardStyle,
                minHeight: 0,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                marginBottom: 0,
                overflow: "hidden",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>Details</div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {!isAlarmTable ? (
                    <>
                      <button
                        onClick={() => {
                          if (!detail && !isNewDetail) return;
                          setFormDraft(detail || {});
                          setFormEnabled(true);
                        }}
                        disabled={formEnabled || (!detail && !isNewDetail)}
                        title="Edit"
                        aria-label="Edit"
                        style={{
                          ...iconActionButton,
                          opacity: formEnabled || (!detail && !isNewDetail) ? 0.45 : 1,
                          cursor: formEnabled || (!detail && !isNewDetail) ? "not-allowed" : "pointer",
                        }}
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => void saveRow()}
                        disabled={!formEnabled}
                        title={selectedId ? "Save" : "Insert"}
                        aria-label={selectedId ? "Save" : "Insert"}
                        style={{
                          ...iconActionButton,
                          border: `1px solid ${formEnabled ? "var(--accent)" : "var(--border)"}`,
                          background: "transparent",
                          color: formEnabled ? "var(--accent)" : iconActionButton.color,
                          boxShadow: "none",
                          opacity: formEnabled ? 1 : 0.45,
                          cursor: formEnabled ? "pointer" : "not-allowed",
                        }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => {
                          if (isNewDetail && currentTable) {
                            navigateData(`/data/${currentTable}`);
                            return;
                          }
                          if (detail) {
                            setFormDraft(detail || {});
                          } else {
                            setFormDraft({});
                          }
                          setFormEnabled(false);
                        }}
                        disabled={!formEnabled}
                        title="Cancel"
                        aria-label="Cancel"
                        style={{
                          ...iconActionButton,
                          opacity: formEnabled ? 1 : 0.45,
                          cursor: formEnabled ? "pointer" : "not-allowed",
                        }}
                      >
                        ✕
                      </button>
                      <button
                        onClick={deleteRow}
                        disabled={!selectedId || formEnabled}
                        title="Delete"
                        aria-label="Delete"
                        style={{
                          ...iconActionButton,
                          border: `1px solid ${!selectedId || formEnabled ? "var(--border)" : "var(--danger)"}`,
                          background: "transparent",
                          color: !selectedId || formEnabled ? iconActionButton.color : "var(--danger)",
                          boxShadow: "none",
                          opacity: !selectedId || formEnabled ? 0.45 : 1,
                          cursor: !selectedId || formEnabled ? "not-allowed" : "pointer",
                        }}
                      >
                        🗑
                      </button>
                    </>
                  ) : null}
                  <button onClick={() => navigateData(`/data/${currentTable}`)} style={ghostButton}>
                    Back to List
                  </button>
                </div>
              </div>
              {!currentTable ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Select a table to begin.</div>
              ) : (
                <>
                  <div
                    style={{
                      display: "grid",
                      rowGap: 8,
                      columnGap: 10,
                      overflowY: "auto",
                      padding: 10,
                      borderRadius: 12,
                      border: useWhiteBackground ? "1px solid #d7e5fb" : "none",
                      background: useWhiteBackground ? "#f6f9ff" : "var(--bg-soft)",
                      flex: 1,
                      minHeight: 0,
                      alignContent: "start",
                      marginBottom: 10,
                    }}
                  >
                    {(detailFieldOrder.length
                      ? detailFieldOrder
                      : columns.filter((c) => !isHiddenColumn(c.column_name)).map((c) => c.column_name)
                    )
                      .filter((name) => !isHiddenColumn(name))
                      .map((columnName) => {
                        const c = columns.find((col) => col.column_name === columnName);
                        if (!c) return null;
                        return (
                      (() => {
                        const fkMeta =
                          foreignKeyMeta && typeof foreignKeyMeta === "object"
                            ? foreignKeyMeta[c.column_name]
                            : null;
                        const fkOptions = Array.isArray(fkMeta?.options) ? fkMeta.options : [];
                        const isForeignKeyField = Boolean(
                          fkMeta &&
                            String(fkMeta?.referencedTable || "").trim() &&
                            String(fkMeta?.referencedColumn || "").trim()
                        );
                        const isProjectField =
                          currentTable === "routes" && c.column_name === "project_id";
                        const isEquipmentTagGroupField =
                          currentTable === "equipment" && c.column_name === "tag_path";
                        return (
                      <label
                        key={`form-${c.column_name}`}
                        draggable={formEnabled}
                        onDragStart={(e) => {
                          if (!formEnabled) return;
                          setDragDetailField(c.column_name);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => setDragDetailField("")}
                        onDragOver={(e) => {
                          if (!formEnabled) return;
                          if (!dragDetailField || dragDetailField === c.column_name) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          if (!formEnabled) return;
                          if (!dragDetailField || dragDetailField === c.column_name) return;
                          e.preventDefault();
                          const current = detailFieldOrder.length
                            ? detailFieldOrder
                            : columns.filter((col) => !isHiddenColumn(col.column_name)).map((col) => col.column_name);
                          const from = current.indexOf(dragDetailField);
                          const to = current.indexOf(c.column_name);
                          if (from < 0 || to < 0) return;
                          const next = [...current];
                          next.splice(from, 1);
                          next.splice(to, 0, dragDetailField);
                          setDetailFieldOrder(next);
                          setDragDetailField("");
                        }}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "160px 1fr",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 11,
                          color: "var(--text)",
                          fontWeight: 600,
                          paddingBottom: 0,
                          cursor: formEnabled ? "grab" : "default",
                        }}
                      >
                        <span style={{ textAlign: "left" }}>{labelize(c.column_name)}</span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            height: 28,
                          }}
                        >
                          {isForeignKeyField ? (
                            <select
                              value={formDraft?.[c.column_name] == null ? "" : String(formDraft?.[c.column_name])}
                              onChange={(e) =>
                                setFormDraft((p) => ({
                                  ...p,
                                  [c.column_name]: e.target.value === "" ? null : e.target.value,
                                }))
                              }
                              disabled={!formEnabled}
                              style={{
                                ...formFieldStyle(formEnabled),
                              }}
                            >
                              <option value="">Unassigned</option>
                              {fkOptions.map((opt, idx) => (
                                <option
                                  key={`fk-opt-${c.column_name}-${idx}-${String(opt?.value ?? "")}`}
                                  value={String(opt?.value ?? "")}
                                >
                                  {String(opt?.label || opt?.value || "")}
                                </option>
                              ))}
                            </select>
                          ) : isProjectField ? (
                            <select
                              value={formDraft?.[c.column_name] || ""}
                              onChange={(e) =>
                                setFormDraft((p) => ({
                                  ...p,
                                  [c.column_name]: e.target.value || null,
                                }))
                              }
                              disabled={!formEnabled}
                              style={{
                                ...formFieldStyle(formEnabled),
                              }}
                            >
                              <option value="">Unassigned</option>
                              {projects.map((p) => (
                                <option key={`proj-${p.id}`} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          ) : isEquipmentTagGroupField ? (
                            <select
                              value={formDraft?.[c.column_name] || ""}
                              onChange={(e) =>
                                setFormDraft((p) => ({
                                  ...p,
                                  [c.column_name]: e.target.value || "",
                                }))
                              }
                              disabled={!formEnabled}
                              style={{
                                ...formFieldStyle(formEnabled),
                              }}
                            >
                              <option value="">Unassigned</option>
                              {equipmentTagGroupOptions.map((opt) => (
                                <option key={`equip-tag-${opt.value}`} value={opt.value}>
                                  {opt.topic} / {opt.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={inputTypeFor(c.column_name)}
                              checked={
                                inputTypeFor(c.column_name) === "checkbox"
                                  ? Boolean(formDraft?.[c.column_name])
                                  : undefined
                              }
                              value={
                                inputTypeFor(c.column_name) === "checkbox"
                                  ? undefined
                                  : formDraft?.[c.column_name] != null
                                    ? String(formDraft[c.column_name])
                                    : ""
                              }
                              onChange={(e) =>
                                setFormDraft((p) => ({
                                  ...p,
                                  [c.column_name]:
                                    inputTypeFor(c.column_name) === "checkbox"
                                      ? e.target.checked
                                      : e.target.value,
                                }))
                              }
                              disabled={!formEnabled}
                              style={{
                                border: `1px solid ${formFieldBorder}`,
                                borderRadius: 8,
                                padding: inputTypeFor(c.column_name) === "checkbox" ? 0 : "4px 8px",
                                fontSize: 11,
                                outline: "none",
                                background: formEnabled ? formFieldBackground : formFieldDisabledBackground,
                                height: inputTypeFor(c.column_name) === "checkbox" ? 16 : 26,
                                width: inputTypeFor(c.column_name) === "checkbox" ? 16 : "100%",
                                boxShadow:
                                  formEnabled && useWhiteBackground && inputTypeFor(c.column_name) !== "checkbox"
                                    ? "inset 0 1px 2px rgba(15,23,42,0.05)"
                                    : "none",
                              }}
                            />
                          )}
                        </div>
                      </label>
                        );
                      })()
                        );
                      })}
                  </div>

                  {isManagedAlarmTable ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: "auto",
                        justifyContent: "flex-end",
                        background: useWhiteBackground ? "rgba(248, 251, 255, 0.96)" : "var(--bg-elev)",
                        paddingTop: 10,
                        paddingBottom: 12,
                        borderTop: useWhiteBackground ? "1px solid #e4ecfb" : "1px solid var(--border)",
                        flexShrink: 0,
                      }}
                    >
                      <button
                        onClick={acknowledgeAlarm}
                        disabled={!selectedId || Boolean(detail?.is_acknowledged)}
                        style={{
                          ...primaryButton,
                          background:
                            !selectedId || Boolean(detail?.is_acknowledged)
                              ? "#e2e8f0"
                              : "linear-gradient(180deg, var(--accent) 0%, var(--accent-strong) 100%)",
                          color: !selectedId || Boolean(detail?.is_acknowledged) ? "var(--text-muted)" : "white",
                          cursor: !selectedId || Boolean(detail?.is_acknowledged) ? "not-allowed" : "pointer",
                          boxShadow:
                            !selectedId || Boolean(detail?.is_acknowledged) ? "none" : primaryButton.boxShadow,
                        }}
                      >
                        {Boolean(detail?.is_acknowledged) ? "Acknowledged" : "Acknowledge"}
                      </button>
                      <button onClick={() => shelveAlarm(15)} disabled={!selectedId} style={ghostButton}>
                        Shelve 15m
                      </button>
                      <button onClick={() => shelveAlarm(60)} disabled={!selectedId} style={ghostButton}>
                        Shelve 1h
                      </button>
                      <button
                        onClick={unshelveAlarm}
                        disabled={!selectedId || !detail?.shelved_until}
                        style={{
                          ...ghostButton,
                          cursor: !selectedId || !detail?.shelved_until ? "not-allowed" : "pointer",
                          color: !selectedId || !detail?.shelved_until ? "var(--text-muted)" : "var(--text)",
                        }}
                      >
                        Unshelve
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <div
              style={{
                ...cardStyle,
                minHeight: 0,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                marginBottom: 0,
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 10 }}>
                  {hasAlarmActiveColumn ? (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <button
                        onClick={() => setAlarmViewTab("active")}
                        style={{
                          ...(alarmViewTab === "active" ? primaryButton : ghostButton),
                          padding: "6px 10px",
                          fontSize: 11,
                        }}
                      >
                        Active Alarms
                      </button>
                      {hasAlarmShelvedColumn ? (
                        <button
                          onClick={() => setAlarmViewTab("shelved")}
                          style={{
                            ...(alarmViewTab === "shelved" ? primaryButton : ghostButton),
                            padding: "6px 10px",
                            fontSize: 11,
                          }}
                        >
                          Shelved
                        </button>
                      ) : null}
                      <button
                        onClick={() => setAlarmViewTab("all")}
                        style={{
                          ...(alarmViewTab === "all" ? primaryButton : ghostButton),
                          padding: "6px 10px",
                          fontSize: 11,
                        }}
                      >
                        All Alarms
                      </button>
                    </div>
                  ) : (
                    <div />
                  )}
                  {currentTable && !isAlarmTable ? (
                    <button
                      onClick={() => {
                        navigateData(`/data/${currentTable}/new`);
                      }}
                      style={primaryButton}
                    >
                      New
                    </button>
                  ) : null}
                </div>
              </div>
              {!currentTable ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8 }}>
                  Select a table to view rows.
                </div>
              ) : (
                <>
                  {columns.length > 0 && !hideListFieldControls && (
                    <div style={{ marginBottom: 8, ...subtleText }}>
                      List fields:
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {columns.filter((c) => !isHiddenColumn(c.column_name)).map((c) => {
                          const checked = listFields.includes(c.column_name);
                          return (
                            <label
                              key={`list-field-${c.column_name}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                border: "1px solid var(--border)",
                                borderRadius: 999,
                                padding: "2px 8px",
                                background: checked
                                  ? "color-mix(in srgb, var(--accent) 16%, var(--bg-elev))"
                                  : "var(--bg-elev)",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...listFields, c.column_name]
                                    : listFields.filter((f) => f !== c.column_name);
                                  setListFields(next);
                                  if (e.target.checked) {
                                    setTableColumnOrder((prev) => {
                                      if (!prev.length) return next;
                                      if (prev.includes(c.column_name)) return prev;
                                      return [...prev, c.column_name];
                                    });
                                  } else {
                                    setTableColumnOrder((prev) =>
                                      prev.length ? prev.filter((f) => f !== c.column_name) : prev
                                    );
                                  }
                                }}
                              />
                              {labelize(c.column_name)}
                            </label>
                          );
                        })}
                        <button
                          onClick={saveListFields}
                          style={{ ...primaryButton, padding: "2px 10px", fontSize: 11, marginLeft: 6 }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
                    {displayedRows.length === 0 ? (
                      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        {hasAlarmActiveColumn && alarmViewTab === "active"
                          ? "No active alarms."
                          : hasAlarmShelvedColumn && alarmViewTab === "shelved"
                          ? "No shelved alarms."
                          : "No rows."}
                      </div>
                    ) : (
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: 12,
                          tableLayout: "fixed",
                        }}
                      >
                        <thead>
                          <tr>
                            {getVisibleFields(displayedRows[0] || {}).map((f) => (
                              <th
                                key={`head-${f}`}
                                draggable
                                onDragStart={(e) => {
                                  setDragColumn(f);
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onDragEnd={() => setDragColumn("")}
                                onDragOver={(e) => {
                                  if (!dragColumn || dragColumn === f) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                }}
                                onDrop={(e) => {
                                  if (!dragColumn || dragColumn === f) return;
                                  e.preventDefault();
                                  const current = getVisibleFields(displayedRows[0] || {});
                                  const from = current.indexOf(dragColumn);
                                  const to = current.indexOf(f);
                                  if (from < 0 || to < 0) return;
                                  const next = [...current];
                                  next.splice(from, 1);
                                  next.splice(to, 0, dragColumn);
                                  setTableColumnOrder(next);
                                  setDragColumn("");
                                }}
                                style={{
                                  textAlign: "left",
                                  padding: "6px 8px",
                                  borderBottom: useWhiteBackground ? "1px solid #e6eefc" : "1px solid var(--border)",
                                  color: "var(--text-muted)",
                                  position: "sticky",
                                  top: 0,
                                  background: useWhiteBackground ? "#f3f7ff" : "var(--bg-elev)",
                                  zIndex: 1,
                                  cursor: "grab",
                                  fontWeight: 700,
                                  letterSpacing: "0.02em",
                                }}
                              >
                                {labelize(f)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {displayedRows.map((r, i) => {
                            const rowId = primaryKey ? r[primaryKey] : i;
                            const visibleFields = getVisibleFields(r || {});
                            return (
                              <tr
                                key={`${rowId}-${i}`}
                                onClick={() => navigateData(`/data/${currentTable}/${rowId}`)}
                                style={{
                                  background: useWhiteBackground
                                    ? i % 2 === 0
                                      ? "#ffffff"
                                      : "#f8fbff"
                                    : "var(--bg-elev)",
                                  cursor: "pointer",
                                }}
                              >
                                {visibleFields.map((f) => (
                                  <td
                                    key={`${rowId}-${f}`}
                                    style={{
                                      padding: "6px 8px",
                                      borderBottom: useWhiteBackground ? "1px solid #eef3fd" : "1px solid var(--border)",
                                      color: "var(--text)",
                                      whiteSpace: "nowrap",
                                      maxWidth: 200,
                                      textOverflow: "ellipsis",
                                      overflow: "hidden",
                                    width: visibleFields[0] === f ? 100 : undefined,
                                    }}
                                  >
                                    {formatValue(f, r?.[f])}
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
