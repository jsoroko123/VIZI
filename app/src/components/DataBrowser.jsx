import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toastError, toastSuccess } from "../utils/toast";

export default function DataBrowser({ embedded = false }) {
  const { table, id } = useParams();
  const navigate = useNavigate();
  const [embeddedTable, setEmbeddedTable] = useState("");
  const [embeddedDetailId, setEmbeddedDetailId] = useState("");
  const currentTable = embedded ? String(embeddedTable || "") : String(table || "");
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

  const tableList = useMemo(() => tables || [], [tables]);
  const isNewDetail = detailId === "new";
  const tableTitle = currentTable
    ? currentTable
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase())
    : "";
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

  const pageStyle = {
    position: "fixed",
    inset: 0,
    background: "var(--bg-soft)",
    color: "var(--text)",
    overflow: "hidden",
  };
  const shellStyle = {
    width: "100%",
    height: "100%",
    margin: 0,
    padding: 0,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    paddingBottom: 30,
  };
  const cardStyle = {
    background: "color-mix(in srgb, var(--bg-elev) 92%, transparent)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 16,
    boxShadow:
      "0 20px 40px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.7)",
    backdropFilter: "blur(6px)",
  };
  const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    marginBottom: 0,
  };
  const sectionTitleStyle = {
    fontSize: 13,
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
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.01em",
  };
  const primaryButton = {
    ...buttonBase,
    border: "1px solid #2b6cff",
    background: "linear-gradient(180deg, #2b6cff 0%, #1f5ce6 100%)",
    color: "white",
    boxShadow: "0 8px 18px rgba(43,108,255,0.25)",
  };
  const dangerButton = {
    ...buttonBase,
    border: "1px solid #f04438",
    background: "linear-gradient(180deg, #f04438 0%, #d92d20 100%)",
    color: "white",
    boxShadow: "0 8px 18px rgba(240,68,56,0.25)",
  };
  const ghostButton = {
    ...buttonBase,
    background: "transparent",
  };
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
      try {
        const pk = primaryKey ? `?pk=${encodeURIComponent(primaryKey)}` : "";
        const res = await fetch(`/api/db/${currentTable}/${selectedId}${pk}`);
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
    } catch (err) {
      setError(err?.message || "Save failed.");
    }
  }

  async function deleteRow() {
    if (!currentTable || !selectedId) return;
    if (!window.confirm("Delete this row?")) return;
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

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gridTemplateRows: "auto minmax(0, 1fr)",
            rowGap: 12,
            flex: 1,
            height: "100%",
            minHeight: 0,
          }}
        >
          <div style={{ ...cardStyle }}>
            <div style={sectionTitleStyle}>Tables</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "stretch" }}>
              {tableList.map((t) => (
                <button
                  key={t}
                  onClick={() => navigateData(`/data/${t}`)}
                  style={{
                    textAlign: "left",
                    border: "1px solid var(--border)",
                    background:
                      t === currentTable
                        ? "color-mix(in srgb, #2b6cff 16%, var(--bg-elev))"
                        : "var(--bg-elev)",
                    padding: "8px 12px",
                    borderRadius: 12,
                    cursor: "pointer",
                    fontWeight: t === currentTable ? 700 : 500,
                    fontSize: 12,
                    height: "100%",
                  }}
                >
                  {labelize(t)}
                </button>
              ))}
              {!tableList.length && (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No tables found.</div>
              )}
            </div>
          </div>


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
                <button onClick={() => navigateData(`/data/${currentTable}`)} style={ghostButton}>
                  Back to List
                </button>
              </div>
              {!currentTable ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Select a table to begin.</div>
              ) : (
                <>
                  <div
                    style={{
                      display: "grid",
                      rowGap: 12,
                      columnGap: 10,
                      overflowY: "auto",
                      padding: 12,
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--bg-soft)",
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
                          gridTemplateColumns: "180px 1fr",
                          alignItems: "center",
                          gap: 10,
                          fontSize: 12,
                          color: "var(--text)",
                          fontWeight: 600,
                          paddingBottom: 2,
                          cursor: formEnabled ? "grab" : "default",
                        }}
                      >
                        <span style={{ textAlign: "left" }}>{labelize(c.column_name)}</span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            height: 30,
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
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: "4px 8px",
                                fontSize: 12,
                                outline: "none",
                                background: formEnabled ? "var(--bg-elev)" : "var(--bg-soft)",
                                height: 28,
                                width: "100%",
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
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: "4px 8px",
                                fontSize: 12,
                                outline: "none",
                                background: formEnabled ? "var(--bg-elev)" : "var(--bg-soft)",
                                height: 28,
                                width: "100%",
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
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: "4px 8px",
                                fontSize: 12,
                                outline: "none",
                                background: formEnabled ? "var(--bg-elev)" : "var(--bg-soft)",
                                height: 28,
                                width: "100%",
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
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: inputTypeFor(c.column_name) === "checkbox" ? 0 : "4px 8px",
                                fontSize: 12,
                                outline: "none",
                                background: formEnabled ? "var(--bg-elev)" : "var(--bg-soft)",
                                height: inputTypeFor(c.column_name) === "checkbox" ? 16 : 28,
                                width: inputTypeFor(c.column_name) === "checkbox" ? 16 : "100%",
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

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: "auto",
                      justifyContent: "flex-end",
                      background: "var(--bg-elev)",
                      paddingTop: 12,
                      paddingBottom: 16,
                      borderTop: "1px solid var(--border)",
                      flexShrink: 0,
                    }}
                  >
                    <button
                      onClick={() => {
                        if (detail) {
                          setFormDraft(detail || {});
                        } else {
                          setFormDraft({});
                        }
                        setFormEnabled(false);
                      }}
                      disabled={!formEnabled}
                      style={{
                        ...ghostButton,
                        background: formEnabled ? "var(--bg-elev)" : "var(--bg-soft)",
                        color: formEnabled ? "var(--text)" : "var(--text-muted)",
                        cursor: formEnabled ? "pointer" : "not-allowed",
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveRow}
                      disabled={!formEnabled}
                      style={{
                        ...primaryButton,
                        background: formEnabled
                          ? "linear-gradient(180deg, #2b6cff 0%, #1f5ce6 100%)"
                          : "#e2e8f0",
                        color: formEnabled ? "white" : "var(--text-muted)",
                        cursor: formEnabled ? "pointer" : "not-allowed",
                        boxShadow: formEnabled ? primaryButton.boxShadow : "none",
                      }}
                    >
                      {selectedId ? "Save" : "Insert"}
                    </button>
                    <button
                      onClick={() => {
                        if (!detail) return;
                        setFormDraft(detail || {});
                        setFormEnabled(true);
                      }}
                      disabled={!detail}
                      style={{
                        ...ghostButton,
                        color: detail ? "#2b6cff" : "var(--text-muted)",
                        border: "1px solid rgba(43,108,255,0.35)",
                        background: detail ? "var(--bg-elev)" : "var(--bg-soft)",
                        cursor: detail ? "pointer" : "not-allowed",
                      }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={deleteRow}
                      disabled={!selectedId}
                      style={{
                        ...dangerButton,
                        background: selectedId
                          ? "linear-gradient(180deg, #f04438 0%, #d92d20 100%)"
                          : "#f2f4f7",
                        color: selectedId ? "white" : "var(--text-muted)",
                        cursor: selectedId ? "pointer" : "not-allowed",
                        boxShadow: selectedId ? dangerButton.boxShadow : "none",
                      }}
                    >
                      Delete
                    </button>
                  </div>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                {currentTable ? (
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
              {!currentTable ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8 }}>
                  Select a table to view rows.
                </div>
              ) : (
                <>
                  {columns.length > 0 && (
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
                                  ? "color-mix(in srgb, #2b6cff 16%, var(--bg-elev))"
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
                  <div style={{ ...subtleText, marginBottom: 8 }}>Primary key: {primaryKey || "none"}</div>
                  <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
                    {rows.length === 0 ? (
                      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No rows.</div>
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
                            {getVisibleFields(rows[0] || {}).map((f) => (
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
                                  const current = getVisibleFields(rows[0] || {});
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
                                  borderBottom: "1px solid var(--border)",
                                  color: "var(--text-muted)",
                                  position: "sticky",
                                  top: 0,
                                  background: "var(--bg-elev)",
                                  zIndex: 1,
                                  cursor: "grab",
                                }}
                              >
                                {labelize(f)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r, i) => {
                            const rowId = primaryKey ? r[primaryKey] : i;
                            const visibleFields = getVisibleFields(r || {});
                            return (
                              <tr
                                key={`${rowId}-${i}`}
                                onClick={() => navigateData(`/data/${currentTable}/${rowId}`)}
                                style={{
                                  background: "var(--bg-elev)",
                                  cursor: "pointer",
                                }}
                              >
                                {visibleFields.map((f) => (
                                  <td
                                    key={`${rowId}-${f}`}
                                    style={{
                                      padding: "6px 8px",
                                      borderBottom: "1px solid var(--border)",
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
