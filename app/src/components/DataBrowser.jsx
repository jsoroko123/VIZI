import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toastError, toastSuccess } from "../utils/toast";
import { showConfirmDialog } from "../utils/confirmDialog";
import SearchableSelect from "./SearchableSelect";

export default function DataBrowser({
  embedded = false,
  embeddedPath = "",
  embeddedRouteId = "",
  embeddedRouteName = "",
  hideTableSelector = false,
  hideListFieldControls = false,
  useWhiteBackground = false,
}) {
  const { table, id } = useParams();
  const navigate = useNavigate();
  const normalizeTableName = (value) => {
    const v = String(value || "").trim();
    if (v === "routes") return "route";
    if (v === "projects") return "project";
    return v;
  };
  const [embeddedTable, setEmbeddedTable] = useState("");
  const [embeddedDetailId, setEmbeddedDetailId] = useState("");
  const currentTable = embedded ? normalizeTableName(embeddedTable) : normalizeTableName(table);
  const hideTopSelector = hideTableSelector || (!embedded && currentTable === "route");
  const detailId = embedded ? String(embeddedDetailId || "") : id ? String(id) : "";
  const [tables, setTables] = useState([]);
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [primaryKey, setPrimaryKey] = useState(null);
  const [listFields, setListFields] = useState([]);
  const [tableColumnOrder, setTableColumnOrder] = useState([]);
  const [dragColumn, setDragColumn] = useState("");
  const [dragListField, setDragListField] = useState("");
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
  const [fkFallbackOptions, setFkFallbackOptions] = useState({});
  const [formEnabled, setFormEnabled] = useState(false);
  const [alarmViewTab, setAlarmViewTab] = useState("active");
  const [rowsTruncated, setRowsTruncated] = useState(false);
  const [childRelations, setChildRelations] = useState([]);
  const [childRelationPickByTable, setChildRelationPickByTable] = useState({});
  const [childRelationBusyByTable, setChildRelationBusyByTable] = useState({});
  const [childRelationErrorByTable, setChildRelationErrorByTable] = useState({});
  const [childRelationActiveTab, setChildRelationActiveTab] = useState("");
  const [detailViewTab, setDetailViewTab] = useState("fields");
  const [listFieldEditMode, setListFieldEditMode] = useState(false);
  const [listFieldSavedSignature, setListFieldSavedSignature] = useState("");
  const TABLE_FETCH_BATCH = 200;
  const TABLE_FETCH_MAX = 10000;

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
    const selectedSet = new Set((listFields || []).map((f) => String(f || "").trim()).filter(Boolean));
    let base = (tableColumnOrder.length ? tableColumnOrder : listFields || []).filter(
      (f) => selectedSet.has(String(f || "").trim())
    );
    if (!base.length) {
      base = listFields.length
        ? listFields
        : primaryKey
        ? [primaryKey]
        : Object.keys(rowSample || {}).filter((f) => !isHiddenColumn(f)).slice(0, 2);
    }
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
  const normalizedEmbeddedRouteId = String(embeddedRouteId || "").trim();
  const normalizedEmbeddedRouteName =
    String(embeddedRouteName || "").trim() || normalizedEmbeddedRouteId;
  const isJobsTable = String(currentTable || "").trim().toLowerCase() === "jobs";
  const showJobsRouteContext = isJobsTable && !!normalizedEmbeddedRouteId;
  const rowRouteId = (row) =>
    String(row?.route_id ?? row?.routeid ?? row?.routeId ?? row?.route ?? "").trim();
  const applyEmbeddedRouteFilter = (items) => {
    const list = Array.isArray(items) ? items : [];
    if (!showJobsRouteContext) return list;
    return list.filter((row) => rowRouteId(row) === normalizedEmbeddedRouteId);
  };
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
  const detailRenderOrder = useMemo(() => {
    const all = (columns || []).map((c) => String(c?.column_name || "")).filter(Boolean);
    if (!detailFieldOrder.length) return all;
    const known = new Set(all);
    const seen = new Set();
    const out = [];
    detailFieldOrder.forEach((name) => {
      const key = String(name || "");
      if (!key || !known.has(key) || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
    all.forEach((name) => {
      if (seen.has(name)) return;
      out.push(name);
    });
    return out;
  }, [columns, detailFieldOrder]);
  const listFieldCandidates = useMemo(() => {
    const available = (columns || [])
      .map((c) => String(c?.column_name || "").trim())
      .filter((name) => name && !isHiddenColumn(name));
    const availableSet = new Set(available);
    const seen = new Set();
    const ordered = [];
    const push = (name) => {
      const key = String(name || "").trim();
      if (!key || !availableSet.has(key) || seen.has(key)) return;
      seen.add(key);
      ordered.push(key);
    };
    (tableColumnOrder || []).forEach(push);
    available.forEach(push);
    return ordered;
  }, [columns, tableColumnOrder, primaryKey]);
  const buildVisibleListFields = () => {
    const selectedSet = new Set((listFields || []).map((f) => String(f || "").trim()).filter(Boolean));
    const baseOrder = (tableColumnOrder.length ? tableColumnOrder : columns.map((c) => c?.column_name))
      .map((f) => String(f || "").trim())
      .filter(Boolean);
    return Array.from(new Set(baseOrder.filter((f) => selectedSet.has(f) && !isHiddenColumn(f))));
  };
  const listFieldCurrentSignature = useMemo(
    () => JSON.stringify(buildVisibleListFields()),
    [listFields, tableColumnOrder, columns, primaryKey]
  );
  const listFieldDirty = listFieldCurrentSignature !== listFieldSavedSignature;

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
          : "var(--bg-elev)",
        color: "var(--text)",
        overflow: "hidden",
      }
    : {
        position: "fixed",
        inset: 0,
        background: useWhiteBackground
          ? "linear-gradient(180deg, #f8fbff 0%, #ffffff 100%)"
          : "var(--bg-elev)",
        color: "var(--text)",
        overflow: "hidden",
      };
  const shellStyle = {
    width: "100%",
    height: "100%",
    margin: 0,
    padding: embedded ? "10px" : "0 0 30px",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  };
  const cardStyle = {
    background: embedded
      ? "var(--bg-elev)"
      : useWhiteBackground
      ? "rgba(255,255,255,0.92)"
      : "transparent",
    border: embedded ? "1px solid var(--border)" : useWhiteBackground ? "1px solid #d2def6" : "none",
    borderRadius: embedded ? 12 : 16,
    padding: embedded ? 12 : 14,
    boxShadow: embedded
      ? "none"
      : useWhiteBackground
      ? "0 8px 24px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.85)"
      : "0 20px 40px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.7)",
    backdropFilter: embedded ? "none" : "blur(6px)",
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
    if (!hideTableSelector) return;
    const raw = String(embeddedPath || "").trim();
    if (!raw) return;
    const normalized = raw.startsWith("/data/") ? raw : `/data/${raw.replace(/^\/+/, "")}`;
    const m = normalized.match(/^\/data\/([^/]+)(?:\/([^/]+))?$/i);
    if (!m) return;
    const nextTable = decodeURIComponent(String(m[1] || "")).trim();
    const nextDetailId = decodeURIComponent(String(m[2] || "")).trim();
    const normalizedNextTable = normalizeTableName(nextTable);
    if (normalizedNextTable) {
      setEmbeddedTable(normalizedNextTable);
    }
    if (nextDetailId) {
      setEmbeddedDetailId(nextDetailId);
      return;
    }
    const normalizedCurrent = normalizeTableName(embeddedTable);
    if (
      normalizedNextTable &&
      normalizedCurrent &&
      normalizedNextTable.toLowerCase() !== normalizedCurrent.toLowerCase()
    ) {
      setEmbeddedDetailId("");
    }
  }, [embedded, embeddedPath, hideTableSelector, embeddedTable]);

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
      setFkFallbackOptions({});
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

  async function fetchRowsSnapshot() {
    if (!currentTable) return { rows: [] };
    const projectParam =
      currentTable === "route" && activeProjectId
        ? `&project_id=${encodeURIComponent(activeProjectId)}`
        : "";
    let offset = 0;
    let allRows = [];
    let lastPayload = {};
    while (offset < TABLE_FETCH_MAX) {
      const res = await fetch(
        `/api/db/${currentTable}?limit=${TABLE_FETCH_BATCH}&offset=${offset}${projectParam}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load rows.");
      const chunk = Array.isArray(data.rows) ? data.rows : [];
      allRows = allRows.concat(chunk);
      lastPayload = data;
      if (chunk.length < TABLE_FETCH_BATCH) break;
      offset += TABLE_FETCH_BATCH;
    }
    const truncated = allRows.length >= TABLE_FETCH_MAX;
    setRowsTruncated(truncated);
    return { ...lastPayload, rows: allRows };
  }

  useEffect(() => {
    async function loadRows() {
      if (!currentTable) return;
      try {
        const data = await fetchRowsSnapshot();
        setRows(applyEmbeddedRouteFilter(data.rows || []));
        if (data.primaryKey) setPrimaryKey(data.primaryKey);
        if (Array.isArray(data.listFields)) {
          setListFields(data.listFields);
          setTableColumnOrder(data.listFields);
          setListFieldSavedSignature(JSON.stringify(data.listFields));
        }
        if (Array.isArray(data.detailFields)) {
          setDetailFieldOrder(data.detailFields);
        }
      } catch (err) {
        setError(err?.message || "Failed to load rows.");
      }
    }
    loadRows();
  }, [currentTable, activeProjectId, showJobsRouteContext, normalizedEmbeddedRouteId]);

  useEffect(() => {
    let alive = true;
    const readRowValue = (row, key) => {
      if (!row || typeof row !== "object") return undefined;
      const exact = String(key || "").trim();
      if (!exact) return undefined;
      if (Object.prototype.hasOwnProperty.call(row, exact)) return row[exact];
      const lower = exact.toLowerCase();
      const match = Object.keys(row).find((k) => String(k || "").toLowerCase() === lower);
      if (match && Object.prototype.hasOwnProperty.call(row, match)) return row[match];
      if (exact.includes("_")) {
        const camel = exact.replace(/_([a-z])/g, (_m, ch) => String(ch || "").toUpperCase());
        if (Object.prototype.hasOwnProperty.call(row, camel)) return row[camel];
      }
      return undefined;
    };
    const filterRowsForActiveProject = (items) => {
      const list = Array.isArray(items) ? items : [];
      const pid = String(activeProjectId || "").trim();
      if (!pid) return list;
      const hasProjectField = list.some((row) => {
        const value = readRowValue(row, "project_id");
        return value != null && String(value).trim() !== "";
      });
      if (!hasProjectField) return list;
      const scoped = list.filter((row) => String(readRowValue(row, "project_id") ?? "").trim() === pid);
      if (scoped.length) return scoped;
      const globalRows = list.filter((row) => String(readRowValue(row, "project_id") ?? "").trim() === "");
      return globalRows.length ? globalRows : list;
    };
    const buildRefTableCandidates = (localColumn, refTable) => {
      const out = [];
      const seen = new Set();
      const push = (name) => {
        const value = String(name || "").trim();
        if (!value) return;
        const key = value.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(value);
      };
      const local = String(localColumn || "").trim().toLowerCase();
      if (local === "product_id") {
        push(refTable || "product");
        return out;
      }
      const stem = String(localColumn || "").trim().replace(/_id$/i, "");
      push(refTable);
      if (stem) {
        push(stem);
        push(`${stem}s`);
        push(`${stem}es`);
        if (stem.endsWith("y") && stem.length > 1) push(`${stem.slice(0, -1)}ies`);
        push(`tbl_${stem}`);
      }
      return out;
    };
    const mapRowsToOptions = (items, refColumn, labelColumn) => {
      const seen = new Set();
      return (Array.isArray(items) ? items : [])
        .map((row) => {
          const rawValue = readRowValue(row, refColumn);
          if (rawValue == null || String(rawValue).trim() === "") return null;
          const value = String(rawValue).trim();
          const rawLabel = readRowValue(row, labelColumn);
          const label = rawLabel == null || String(rawLabel).trim() === "" ? value : String(rawLabel).trim();
          return { value, label };
        })
        .filter((opt) => {
          if (!opt) return false;
          if (seen.has(opt.value)) return false;
          seen.add(opt.value);
          return true;
        });
    };
    const fetchOptionsForTable = async (tableName, refColumn, labelColumn) => {
      const queries = [];
      if (activeProjectId) queries.push(`?limit=1000&project_id=${encodeURIComponent(activeProjectId)}`);
      queries.push("?limit=1000");
      for (const query of queries) {
        try {
          const res = await fetch(`/api/db/${encodeURIComponent(tableName)}${query}`);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) continue;
          const baseRows = Array.isArray(data?.rows) ? data.rows : [];
          const rows = query.includes("project_id=") ? baseRows : filterRowsForActiveProject(baseRows);
          const options = mapRowsToOptions(rows, refColumn, labelColumn);
          if (options.length) return options;
        } catch {
          // ignore fallback load failures
        }
      }
      return [];
    };
    const fkEntries = Object.entries(foreignKeyMeta || {}).filter(([, meta]) => {
      const hasRelation =
        meta &&
        String(meta?.referencedTable || "").trim() &&
        String(meta?.referencedColumn || "").trim();
      const hasOptions = Array.isArray(meta?.options) && meta.options.length > 0;
      return hasRelation && !hasOptions;
    });
    if (!fkEntries.length) {
      setFkFallbackOptions({});
      return () => {
        alive = false;
      };
    }
    (async () => {
      const next = {};
      for (const [localColumn, meta] of fkEntries) {
        const refTable = String(meta?.referencedTable || "").trim();
        const refColumn = String(meta?.referencedColumn || "").trim();
        const labelColumn = String(meta?.labelColumn || "name").trim();
        if (!refTable || !refColumn) continue;
        const tableCandidates = buildRefTableCandidates(localColumn, refTable);
        for (const tableName of tableCandidates) {
          const options = await fetchOptionsForTable(tableName, refColumn, labelColumn);
          if (!options.length) continue;
          next[localColumn] = options;
          break;
        }
      }
      if (!alive) return;
      setFkFallbackOptions(next);
    })();
    return () => {
      alive = false;
    };
  }, [foreignKeyMeta, activeProjectId]);

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
    if (!isNewDetail) return;
    if (!showJobsRouteContext) return;
    setFormDraft((prev) => {
      const current =
        prev?.route_id ??
        prev?.routeid ??
        prev?.routeId ??
        prev?.route ??
        "";
      if (String(current || "").trim()) return prev || {};
      return { ...(prev || {}), route_id: normalizedEmbeddedRouteId };
    });
  }, [isNewDetail, showJobsRouteContext, normalizedEmbeddedRouteId]);

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
      const data = await fetchRowsSnapshot();
      setRows(applyEmbeddedRouteFilter(data.rows || []));
      if (data.primaryKey) setPrimaryKey(data.primaryKey);
      if (Array.isArray(data.listFields)) {
        setListFields(data.listFields);
        setTableColumnOrder(data.listFields);
        setListFieldSavedSignature(JSON.stringify(data.listFields));
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
      setFormDraft(normalizeDraftForForm(row || {}));
      setFormEnabled(false);
    } catch (err) {
      setError(err?.message || "Failed to load detail.");
    }
  }

  const readRowValueLoose = (row, key) => {
    if (!row || typeof row !== "object") return undefined;
    const exact = String(key || "").trim();
    if (!exact) return undefined;
    if (Object.prototype.hasOwnProperty.call(row, exact)) return row[exact];
    const lower = exact.toLowerCase();
    const match = Object.keys(row).find((k) => String(k || "").toLowerCase() === lower);
    if (match && Object.prototype.hasOwnProperty.call(row, match)) return row[match];
    return undefined;
  };

  const getRelationRowId = (row, relation) => {
    const pk = String(relation?.primaryKey || "").trim();
    if (pk) {
      const v = readRowValueLoose(row, pk);
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    const fallback = readRowValueLoose(row, "id");
    return fallback == null ? "" : String(fallback).trim();
  };

  const getRelationRowLabel = (row, relation) => {
    const candidates = ["name", "title", "label", "description"];
    for (const key of candidates) {
      const v = readRowValueLoose(row, key);
      if (v != null && String(v).trim()) return String(v).trim();
    }
    const idValue = getRelationRowId(row, relation);
    return idValue || "(row)";
  };

  async function fetchAllRowsForTable(tableName) {
    const rowsOut = [];
    let offset = 0;
    while (offset < TABLE_FETCH_MAX) {
      const res = await fetch(
        `/api/db/${encodeURIComponent(tableName)}?limit=${TABLE_FETCH_BATCH}&offset=${offset}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Failed to load ${tableName}.`);
      const chunk = Array.isArray(data?.rows) ? data.rows : [];
      rowsOut.push(...chunk);
      if (chunk.length < TABLE_FETCH_BATCH) break;
      offset += TABLE_FETCH_BATCH;
    }
    return rowsOut;
  }

  useEffect(() => {
    let alive = true;
    async function loadChildRelations() {
      const parentTable = String(currentTable || "").trim();
      if (!parentTable || !selectedId || isNewDetail) {
        if (alive) {
          setChildRelations([]);
          setChildRelationPickByTable({});
          setChildRelationBusyByTable({});
          setChildRelationErrorByTable({});
        }
        return;
      }
      const parentRow = detail && typeof detail === "object" ? detail : null;
      try {
        const schemaRes = await fetch("/api/db/designer/schema");
        const schemaData = await schemaRes.json();
        if (!schemaRes.ok) throw new Error(schemaData?.error || "Failed to load relation schema.");
        const tablesMeta = Array.isArray(schemaData?.tables) ? schemaData.tables : [];
        const relations = [];
        for (const tableMeta of tablesMeta) {
          const childTable = String(tableMeta?.name || "").trim();
          if (!childTable || childTable === parentTable) continue;
          const fks = tableMeta?.foreignKeys && typeof tableMeta.foreignKeys === "object" ? tableMeta.foreignKeys : {};
          const fkCandidates = [];
          const seenFk = new Set();
          for (const fk of Object.values(fks)) {
            const referencedTable = String(fk?.referencedTable || "").trim();
            const referencedColumn = String(fk?.referencedColumn || "").trim();
            const childFkColumn = String(fk?.column || "").trim();
            const constraintName = String(fk?.constraintName || "").trim();
            if (!referencedTable || !referencedColumn || !childFkColumn) continue;
            if (referencedTable !== parentTable) continue;
            const key = constraintName
              ? `c:${constraintName}`
              : `s:${childFkColumn}->${referencedTable}.${referencedColumn}`;
            if (seenFk.has(key)) continue;
            seenFk.add(key);
            fkCandidates.push({ referencedColumn, childFkColumn, constraintName });
          }
          if (!fkCandidates.length) continue;
          const allChildRows = await fetchAllRowsForTable(childTable);
          for (const fk of fkCandidates) {
            const referencedColumn = String(fk?.referencedColumn || "").trim();
            const childFkColumn = String(fk?.childFkColumn || "").trim();
            const constraintName = String(fk?.constraintName || "").trim();
            if (!referencedColumn || !childFkColumn) continue;
            const parentValueRaw =
              readRowValueLoose(parentRow, referencedColumn) ??
              (String(primaryKey || "").trim() === referencedColumn ? selectedId : undefined);
            const parentValue = parentValueRaw == null ? "" : String(parentValueRaw).trim();
            if (!parentValue) continue;
            const linkedRows = allChildRows.filter((row) => {
              const v = readRowValueLoose(row, childFkColumn);
              return String(v ?? "").trim() === parentValue;
            });
            const unlinkedRows = allChildRows.filter((row) => {
              const v = readRowValueLoose(row, childFkColumn);
              return String(v ?? "").trim() === "";
            });
            relations.push({
              table: childTable,
              primaryKey: String(tableMeta?.primaryKey || "").trim(),
              childFkColumn,
              referencedColumn,
              constraintName,
              parentValue,
              linkedRows,
              unlinkedRows,
            });
          }
        }
        if (!alive) return;
        setChildRelations(relations);
        setChildRelationPickByTable((prev) => {
          const next = {};
          relations.forEach((rel) => {
            const key = getChildRelationTabKey(rel);
            if (!key) return;
            const current = String(prev?.[key] || "").trim();
            const valid = rel.unlinkedRows.some((row) => getRelationRowId(row, rel) === current);
            next[key] = valid ? current : "";
          });
          return next;
        });
      } catch (err) {
        if (!alive) return;
        setChildRelations([]);
        setChildRelationErrorByTable({
          __global__: String(err?.message || "Failed to load one-to-many relations."),
        });
      }
    }
    loadChildRelations();
    return () => {
      alive = false;
    };
  }, [currentTable, selectedId, isNewDetail, detail, primaryKey]);

  useEffect(() => {
    const currentKey = String(childRelationActiveTab || "").trim();
    if (!childRelations.length) {
      if (currentKey) setChildRelationActiveTab("");
      return;
    }
    const hasCurrent = childRelations.some((relation) => getChildRelationTabKey(relation) === currentKey);
    if (!hasCurrent) {
      setChildRelationActiveTab(getChildRelationTabKey(childRelations[0]));
    }
  }, [childRelations, childRelationActiveTab]);

  useEffect(() => {
    if (!childRelations.length && detailViewTab === "relations") {
      setDetailViewTab("fields");
    }
  }, [childRelations, detailViewTab]);

  useEffect(() => {
    // Default to field editing when switching records/tables so columns are never "missing" by default.
    setDetailViewTab("fields");
  }, [currentTable, selectedId, detailId]);

  useEffect(() => {
    setListFieldEditMode(false);
    setDragListField("");
  }, [currentTable]);

  async function updateChildRelationLink(relation, rowId, parentValueRaw) {
    const relationKey = getChildRelationTabKey(relation);
    const table = String(relation?.table || "").trim();
    const rowKey = String(rowId || "").trim();
    const childPk = String(relation?.primaryKey || "").trim();
    const childFkColumn = String(relation?.childFkColumn || "").trim();
    if (!relationKey || !table || !rowKey || !childFkColumn) return;
    const parentValue = parentValueRaw == null ? null : String(parentValueRaw).trim();
    setChildRelationBusyByTable((prev) => ({ ...(prev || {}), [relationKey]: true }));
    setChildRelationErrorByTable((prev) => ({ ...(prev || {}), [relationKey]: "" }));
    try {
      const pkQuery = childPk ? `?pk=${encodeURIComponent(childPk)}` : "";
      const res = await fetch(`/api/db/${encodeURIComponent(table)}/${encodeURIComponent(rowKey)}${pkQuery}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [childFkColumn]: parentValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update relation.");
      await reloadRows();
      if (selectedId && !isNewDetail) await reloadDetailRow(selectedId);
      toastSuccess("Relation updated.");
    } catch (err) {
      const msg = String(err?.message || "Failed to update relation.");
      setChildRelationErrorByTable((prev) => ({ ...(prev || {}), [relationKey]: msg }));
      toastError(msg);
    } finally {
      setChildRelationBusyByTable((prev) => ({ ...(prev || {}), [relationKey]: false }));
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
    if (currentTable === "route" && activeProjectId && !payload.project_id) {
      payload.project_id = activeProjectId;
    }
    if (
      String(currentTable || "").trim().toLowerCase() === "jobs" &&
      normalizedEmbeddedRouteId &&
      !payload.route_id &&
      !payload.routeid &&
      !payload.routeId &&
      !payload.route
    ) {
      payload.route_id = normalizedEmbeddedRouteId;
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
        setFormDraft(normalizeDraftForForm(data.row || {}));
      } else {
        const res = await fetch(`/api/db/${currentTable}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Insert failed.");
        setDetail(data.row || null);
        setFormDraft(normalizeDraftForForm(data.row || {}));
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

  function toLocalDateInputValue(raw) {
    if (raw == null || String(raw).trim() === "") return "";
    const text = String(raw).trim();
    const plainDate = text.match(/^\d{4}-\d{2}-\d{2}$/);
    if (plainDate) return text;
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function toLocalDateTimeInputValue(raw) {
    if (raw == null || String(raw).trim() === "") return "";
    const text = String(raw).trim();
    const d = new Date(text);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${hh}:${mm}`;
  }

  function normalizeDraftForForm(rawDraft) {
    const draft = rawDraft && typeof rawDraft === "object" ? rawDraft : {};
    const out = { ...draft };
    Object.keys(out).forEach((key) => {
      const t = String(typeMap?.[key] || "").toLowerCase();
      if (!t) return;
      if (t.includes("date") && !t.includes("time")) {
        out[key] = toLocalDateInputValue(out[key]);
        return;
      }
      if (t.includes("timestamp") || t.includes("time")) {
        out[key] = toLocalDateTimeInputValue(out[key]);
      }
    });
    return out;
  }

  function coerceValue(columnName, value) {
    const t = typeMap[columnName] || "";
    if (value === "" || value === undefined) return null;
    if (t.includes("date") && !t.includes("time")) {
      return String(value).trim() || null;
    }
    if (t.includes("timestamp") || t.includes("time")) {
      const parsed = new Date(String(value));
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString();
    }
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

  const getChildRelationTabKey = (relation) => {
    const tableKey = String(relation?.table || "").trim();
    const fkKey = String(relation?.childFkColumn || "").trim();
    return `${tableKey}:${fkKey}`;
  };

  function buildPayload(draft) {
    const out = {};
    Object.keys(draft || {}).forEach((k) => {
      out[k] = coerceValue(k, draft[k]);
    });
    return out;
  }

  function getActiveChildRelation() {
    if (isNewDetail || !String(selectedId || "").trim()) return null;
    if (!childRelations.length && !childRelationErrorByTable?.__global__) return null;
    const activeTabKey = String(childRelationActiveTab || "").trim();
    const activeRelation =
      childRelations.find((relation) => getChildRelationTabKey(relation) === activeTabKey) || childRelations[0] || null;
    return activeRelation;
  }

  function renderChildRelationTabs() {
    if (isNewDetail || !String(selectedId || "").trim()) return null;
    if (childRelations.length <= 1) return null;
    const activeRelation = getActiveChildRelation();
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {childRelations.map((relation) => {
          const tabKey = getChildRelationTabKey(relation);
          const linkedRows = Array.isArray(relation?.linkedRows) ? relation.linkedRows : [];
          const active = tabKey === getChildRelationTabKey(activeRelation);
          return (
            <button
              key={`relation-tab-${tabKey}`}
              type="button"
              onClick={() => setChildRelationActiveTab(tabKey)}
              style={{
                ...(active ? primaryButton : ghostButton),
                padding: "5px 9px",
                fontSize: 11,
                borderRadius: 8,
                boxShadow: active ? primaryButton.boxShadow : "none",
              }}
            >
              {labelize(relation?.table)}.{String(relation?.childFkColumn || "")} ({linkedRows.length})
            </button>
          );
        })}
      </div>
    );
  }

  function renderChildRelationsSection() {
    const activeRelation = getActiveChildRelation();
    if (!activeRelation && !childRelationErrorByTable?.__global__) return null;
    return (
      <div style={{ display: "grid", gap: 8, marginTop: 0, marginBottom: 8 }}>
        {activeRelation ? (() => {
          const relation = activeRelation;
          const tableKey = String(relation?.table || "");
          const relationKey = getChildRelationTabKey(relation);
          const linkedRows = Array.isArray(relation?.linkedRows) ? relation.linkedRows : [];
          const unlinkedRows = Array.isArray(relation?.unlinkedRows) ? relation.unlinkedRows : [];
          const pickValue = String(childRelationPickByTable?.[relationKey] || "").trim();
          const busy = childRelationBusyByTable?.[relationKey] === true;
          const relError = String(childRelationErrorByTable?.[relationKey] || "").trim();
          return (
            <div
              key={`relation-panel-${relationKey}`}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 8,
                background: "var(--bg-soft)",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text)" }}>
                {labelize(tableKey)} via {String(relation?.childFkColumn || "")} ({linkedRows.length})
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  value={pickValue}
                  onChange={(e) =>
                    setChildRelationPickByTable((prev) => ({
                      ...(prev || {}),
                      [relationKey]: String(e.target.value || ""),
                    }))
                  }
                  disabled={busy}
                  style={{
                    flex: "1 1 auto",
                    minWidth: 0,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 6,
                    padding: "4px 6px",
                    fontSize: 11,
                  }}
                >
                  <option value="">Select {labelize(tableKey)}...</option>
                  {unlinkedRows.map((row) => {
                    const rowId = getRelationRowId(row, relation);
                    if (!rowId) return null;
                    const rowLabel = getRelationRowLabel(row, relation);
                    return (
                      <option key={`relation-unlinked-${tableKey}-${rowId}`} value={rowId}>
                        {rowLabel}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  disabled={!pickValue || busy}
                  onClick={() => updateChildRelationLink(relation, pickValue, relation.parentValue)}
                  style={{
                    ...primaryButton,
                    padding: "6px 10px",
                    fontSize: 11,
                    opacity: !pickValue || busy ? 0.6 : 1,
                    cursor: !pickValue || busy ? "not-allowed" : "pointer",
                  }}
                >
                  Add
                </button>
              </div>
              {linkedRows.length ? (
                <div style={{ display: "grid", gap: 4 }}>
                  {linkedRows.map((row) => {
                    const rowId = getRelationRowId(row, relation);
                    if (!rowId) return null;
                    const rowLabel = getRelationRowLabel(row, relation);
                    return (
                      <div
                        key={`relation-linked-${tableKey}-${rowId}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          padding: "4px 6px",
                          background: "var(--bg-elev)",
                        }}
                      >
                        <div style={{ fontSize: 11, color: "var(--text)" }}>{rowLabel}</div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => updateChildRelationLink(relation, rowId, null)}
                          style={{
                            ...iconActionButton,
                            width: 24,
                            height: 24,
                            border: "1px solid var(--danger)",
                            color: "var(--danger)",
                            background: "transparent",
                            boxShadow: "none",
                            opacity: busy ? 0.55 : 1,
                          }}
                          title="Remove from this list"
                        >
                          {"\u2715"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No linked rows.</div>
              )}
              {relError ? <div style={{ fontSize: 10, color: "var(--danger)" }}>{relError}</div> : null}
            </div>
          );
        })() : null}
        {childRelationErrorByTable?.__global__ ? (
          <div style={{ fontSize: 11, color: "var(--danger)" }}>
            {String(childRelationErrorByTable.__global__ || "")}
          </div>
        ) : null}
      </div>
    );
  }

  async function saveListFields() {
    if (!currentTable) return;
    setError("");
    setStatus("");
    try {
      const visibleListFields = buildVisibleListFields();
      const res = await fetch(`/api/db/${currentTable}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_fields: visibleListFields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save list config.");
      setListFields(visibleListFields);
      setTableColumnOrder((prev) => {
        const seen = new Set();
        const next = [];
        (visibleListFields || []).forEach((f) => {
          const key = String(f || "").trim();
          if (!key || seen.has(key)) return;
          seen.add(key);
          next.push(key);
        });
        (prev || []).forEach((f) => {
          const key = String(f || "").trim();
          if (!key || seen.has(key)) return;
          seen.add(key);
          next.push(key);
        });
        return next;
      });
      setListFieldSavedSignature(JSON.stringify(visibleListFields));
      await reloadRows();
      setStatus("List fields saved.");
      return true;
    } catch (err) {
      setError(err?.message || "Failed to save list config.");
      return false;
    }
  }

  async function saveDetailFields(orderOverride = null) {
    if (!currentTable) return;
    setError("");
    setStatus("");
    try {
      const sourceOrder = Array.isArray(orderOverride) ? orderOverride : detailFieldOrder || [];
      const visibleDetailFields = sourceOrder.filter((f) => !isHiddenColumn(f));
      const selectedSet = new Set((listFields || []).map((f) => String(f || "").trim()).filter(Boolean));
      const baseOrder = (tableColumnOrder.length ? tableColumnOrder : columns.map((c) => c?.column_name))
        .map((f) => String(f || "").trim())
        .filter(Boolean);
      const visibleListFields = Array.from(
        new Set(baseOrder.filter((f) => selectedSet.has(f) && !isHiddenColumn(f)))
      );
      const res = await fetch(`/api/db/${currentTable}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_fields: visibleListFields, detail_fields: visibleDetailFields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save detail config.");
      await reloadRows();
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

  const handleTableSelectChange = (nextValue) => {
    const nextTable = String(nextValue || "").trim();
    if (!nextTable) {
      if (embedded) {
        setEmbeddedTable("");
        setEmbeddedDetailId("");
      } else {
        navigate("/data");
      }
      return;
    }
    const normalizedCurrent = normalizeTableName(currentTable).toLowerCase();
    const normalizedNext = normalizeTableName(nextTable).toLowerCase();
    if (normalizedCurrent && normalizedCurrent === normalizedNext) {
      return;
    }
    navigateData(`/data/${nextTable}`);
  };

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gridTemplateRows: hideTopSelector ? "minmax(0, 1fr)" : "auto minmax(0, 1fr)",
            rowGap: embedded ? 10 : 12,
            flex: 1,
            height: "100%",
            minHeight: 0,
          }}
        >
          {!hideTopSelector ? (
            <div style={{ ...cardStyle }}>
              <div style={sectionTitleStyle}>Tables</div>
              <div style={{ display: "grid", gap: 8 }}>
                <SearchableSelect
                  value={currentTable || ""}
                  onChange={handleTableSelectChange}
                  disabled={!tableList.length}
                  options={tableList.map((t) => ({ value: t, label: labelize(t) }))}
                  placeholder="Search/select table..."
                  title="Select table"
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    padding: "8px 10px",
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
                {!tableList.length ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No tables found</div> : null}
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
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>Details</div>
                  <button
                    type="button"
                    onClick={() => setDetailViewTab("fields")}
                    style={{ ...(detailViewTab === "fields" ? primaryButton : ghostButton), padding: "5px 9px", fontSize: 11 }}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailViewTab("relations")}
                    disabled={!childRelations.length}
                    style={{
                      ...(detailViewTab === "relations" ? primaryButton : ghostButton),
                      padding: "5px 9px",
                      fontSize: 11,
                      opacity: childRelations.length ? 1 : 0.45,
                      cursor: childRelations.length ? "pointer" : "not-allowed",
                    }}
                  >
                    Relations
                  </button>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  {!isAlarmTable ? (
                    <>
                      <button
                        onClick={() => {
                          if (!detail && !isNewDetail) return;
                          setFormDraft(normalizeDraftForForm(detail || {}));
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
                            setFormDraft(normalizeDraftForForm(detail || {}));
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
              {showJobsRouteContext ? (
                <div
                  style={{
                    marginBottom: 10,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "6px 8px",
                    background: useWhiteBackground ? "#f6f9ff" : "var(--bg-soft)",
                  }}
                >
                  Route: {normalizedEmbeddedRouteName}
                </div>
              ) : null}
              {!currentTable ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Select a table to begin.</div>
              ) : (
                <>
                  {detailViewTab === "relations" ? (
                    <>
                      {renderChildRelationTabs()}
                      {renderChildRelationsSection()}
                    </>
                  ) : null}
                  {detailViewTab === "fields" ? (
                  <div
                    style={{
                      display: "grid",
                      rowGap: 12,
                      columnGap: 10,
                      overflowY: "auto",
                      padding: 10,
                      borderRadius: 12,
                      border: embedded ? "1px solid var(--border)" : useWhiteBackground ? "1px solid #d7e5fb" : "none",
                      background: embedded ? "var(--bg-soft)" : useWhiteBackground ? "#f6f9ff" : "var(--bg-soft)",
                      flex: 1,
                      minHeight: 0,
                      alignContent: "start",
                      marginBottom: 10,
                    }}
                  >
                      {detailRenderOrder
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
                        const fkMetaOptions = Array.isArray(fkMeta?.options) ? fkMeta.options : [];
                        const fkClientFallback = Array.isArray(fkFallbackOptions?.[c.column_name])
                          ? fkFallbackOptions[c.column_name]
                          : [];
                        const fkOptions = fkMetaOptions.length ? fkMetaOptions : fkClientFallback;
                        const isForeignKeyField = Boolean(
                          fkMeta &&
                            String(fkMeta?.referencedTable || "").trim() &&
                            String(fkMeta?.referencedColumn || "").trim()
                        );
                        const isProjectField =
                          currentTable === "route" && c.column_name === "project_id";
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
                          const current = detailRenderOrder.filter((name) => !isHiddenColumn(name));
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
                          gridTemplateColumns: "140px minmax(0, 1fr)",
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
                  ) : null}
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
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 6, width: "100%" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: currentTable && !isAlarmTable ? "minmax(0, 1fr) auto" : "minmax(0, 1fr)",
                    alignItems: "center",
                    width: "100%",
                    gap: 10,
                  }}
                >
                  {hasAlarmActiveColumn ? (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: hasAlarmShelvedColumn ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))",
                        alignItems: "center",
                        gap: 6,
                        width: "100%",
                        minWidth: 0,
                      }}
                    >
                      <button
                        onClick={() => setAlarmViewTab("active")}
                        style={{
                          ...(alarmViewTab === "active" ? primaryButton : ghostButton),
                          padding: "6px 10px",
                          fontSize: 11,
                          width: "100%",
                          justifyContent: "center",
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
                            width: "100%",
                            justifyContent: "center",
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
                          width: "100%",
                          justifyContent: "center",
                        }}
                      >
                        All Alarms
                      </button>
                    </div>
                  ) : (
                    <div style={{ width: "100%" }} />
                  )}
                  {currentTable && !isAlarmTable ? (
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <button
                        onClick={() => {
                          navigateData(`/data/${currentTable}/new`);
                        }}
                        title="New row"
                        aria-label="New row"
                        style={{
                          ...iconActionButton,
                          border: "1px solid var(--accent)",
                          background: "linear-gradient(180deg, var(--accent) 0%, var(--accent-strong) 100%)",
                          color: "var(--accent-text)",
                        }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M12 5v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                          <path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                        </svg>
                      </button>
                      {columns.length > 0 && !hideListFieldControls ? (
                        <>
                          <button
                            onClick={() => {
                              if (listFieldEditMode) {
                                void (async () => {
                                  if (listFieldDirty) {
                                    const ok = await saveListFields();
                                    if (!ok) return;
                                  }
                                  setListFieldEditMode(false);
                                  setDragListField("");
                                })();
                              } else {
                                setListFieldEditMode(true);
                              }
                            }}
                            title={listFieldEditMode ? "Done editing list fields" : "Edit list fields"}
                            aria-label={listFieldEditMode ? "Done editing list fields" : "Edit list fields"}
                            style={{ ...iconActionButton }}
                          >
                            {listFieldEditMode ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={async () => {
                              const ok = await saveListFields();
                              if (ok) setListFieldEditMode(false);
                            }}
                            disabled={!listFieldEditMode || !listFieldDirty}
                            title="Save list fields and order"
                            aria-label="Save list fields and order"
                            style={{
                              ...iconActionButton,
                              border: "1px solid var(--accent)",
                              background: "linear-gradient(180deg, var(--accent) 0%, var(--accent-strong) 100%)",
                              color: "var(--accent-text)",
                              opacity: listFieldEditMode && listFieldDirty ? 1 : 0.5,
                              cursor: listFieldEditMode && listFieldDirty ? "pointer" : "not-allowed",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="2" />
                              <path d="M17 21v-8H7v8" stroke="currentColor" strokeWidth="2" />
                              <path d="M7 3v5h8" stroke="currentColor" strokeWidth="2" />
                            </svg>
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              {showJobsRouteContext ? (
                <div
                  style={{
                    marginBottom: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "6px 8px",
                    background: useWhiteBackground ? "#f6f9ff" : "var(--bg-soft)",
                  }}
                >
                  Route: {normalizedEmbeddedRouteName}
                </div>
              ) : null}
              {!currentTable ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8 }}>
                  Select a table to view rows.
                </div>
              ) : (
                <>
                  {columns.length > 0 && !hideListFieldControls && (
                    <div style={{ marginBottom: 8, ...subtleText }}>
                      List fields:
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
                        {listFieldCandidates.map((columnName) => {
                          const checked = listFields.includes(columnName);
                          return (
                            <div
                              key={`list-field-${columnName}`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                const source =
                                  dragListField ||
                                  String(e.dataTransfer?.getData("text/vizi-list-field") || "").trim();
                                if (!source || source === columnName) return;
                                e.dataTransfer.dropEffect = "move";
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                const source =
                                  dragListField ||
                                  String(e.dataTransfer?.getData("text/vizi-list-field") || "").trim();
                                if (!source || source === columnName) return;
                                const current = listFieldCandidates.slice();
                                const from = current.indexOf(source);
                                const to = current.indexOf(columnName);
                                if (from < 0 || to < 0) return;
                                const next = [...current];
                                next.splice(from, 1);
                                next.splice(to, 0, source);
                                setTableColumnOrder(next);
                                setDragListField("");
                              }}
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
                                cursor: "default",
                              }}
                            >
                              <span
                                draggable={listFieldEditMode}
                                onDragStart={(e) => {
                                  if (!listFieldEditMode) return;
                                  setDragListField(columnName);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/vizi-list-field", columnName);
                                }}
                                onDragEnd={() => setDragListField("")}
                                title="Drag to reorder"
                                style={{ cursor: listFieldEditMode ? "grab" : "default", userSelect: "none", opacity: listFieldEditMode ? 0.8 : 0.4 }}
                              >
                                :: 
                              </span>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!listFieldEditMode}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...listFields, columnName]
                                      : listFields.filter((f) => f !== columnName);
                                    setListFields(next);
                                    if (e.target.checked) {
                                      setTableColumnOrder((prev) => {
                                        if (!prev.length) return next;
                                        if (prev.includes(columnName)) return prev;
                                        return [...prev, columnName];
                                      });
                                    }
                                  }}
                                />
                                {labelize(columnName)}
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {rowsTruncated ? (
                    <div
                      style={{
                        marginBottom: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--text-muted)",
                      }}
                    >
                      Showing first {TABLE_FETCH_MAX} rows.
                    </div>
                  ) : null}
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
                                draggable={listFieldEditMode}
                                onDragStart={(e) => {
                                  if (!listFieldEditMode) return;
                                  setDragColumn(f);
                                  e.dataTransfer.effectAllowed = "move";
                                }}
                                onDragEnd={() => setDragColumn("")}
                                onDragOver={(e) => {
                                  if (!listFieldEditMode) return;
                                  if (!dragColumn || dragColumn === f) return;
                                  e.preventDefault();
                                  e.dataTransfer.dropEffect = "move";
                                }}
                                onDrop={(e) => {
                                  if (!listFieldEditMode) return;
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
                                  cursor: listFieldEditMode ? "grab" : "default",
                                  fontWeight: 700,
                                  letterSpacing: "0.02em",
                                }}
                              >
                                {labelize(f)}
                              </th>
                            ))}
                            <th
                              style={{
                                textAlign: "right",
                                padding: "6px 8px",
                                borderBottom: useWhiteBackground ? "1px solid #e6eefc" : "1px solid var(--border)",
                                color: "var(--text-muted)",
                                position: "sticky",
                                top: 0,
                                background: useWhiteBackground ? "#f3f7ff" : "var(--bg-elev)",
                                zIndex: 1,
                                fontWeight: 700,
                                letterSpacing: "0.02em",
                                width: 94,
                              }}
                            >
                              Details
                            </th>
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
                                <td
                                  style={{
                                    padding: "6px 8px",
                                    borderBottom: useWhiteBackground ? "1px solid #eef3fd" : "1px solid var(--border)",
                                    textAlign: "right",
                                    width: 94,
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigateData(`/data/${currentTable}/${rowId}`);
                                    }}
                                    style={{
                                      border: "1px solid var(--border)",
                                      background: "var(--bg-soft)",
                                      color: "var(--text)",
                                      borderRadius: 8,
                                      padding: "4px 8px",
                                      fontSize: 11,
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                  >
                                    View
                                  </button>
                                </td>
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
