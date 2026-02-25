import { useEffect, useMemo, useRef, useState } from "react";
import { toastError, toastSuccess } from "../utils/toast";
import { showConfirmDialog } from "../utils/confirmDialog";
import SearchableSelect from "./SearchableSelect";

const TYPE_OPTIONS = [
  "text",
  "integer",
  "bigint",
  "smallint",
  "boolean",
  "date",
  "timestamp",
  "timestamptz",
  "real",
  "double precision",
  "uuid",
  "jsonb",
  "numeric(10,2)",
  "varchar(255)",
];

const FK_ACTIONS = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];
const FK_CONNECTION_TYPES = [
  { value: "many_to_one", label: "Many to One" },
  { value: "one_to_many", label: "One to Many" },
];
const NEW_COLUMN_KEY = "__new_column__";

function blankColumn(overrides = {}) {
  return {
    name: "",
    type: "text",
    nullable: true,
    defaultValue: "",
    primaryKey: false,
    locked: false,
    ...overrides,
  };
}

function defaultNewTableColumns() {
  return [
    blankColumn({ name: "id", type: "bigint", nullable: false, primaryKey: true, locked: true }),
    blankColumn({ name: "name", type: "text", nullable: false, primaryKey: false, locked: true }),
    blankColumn({ name: "description", type: "text", nullable: false, primaryKey: false, locked: true }),
  ];
}

function typeOptionsFor(currentType) {
  const current = String(currentType || "").trim();
  if (!current) return TYPE_OPTIONS;
  const hasCurrent = TYPE_OPTIONS.some((t) => String(t).toLowerCase() === current.toLowerCase());
  return hasCurrent ? TYPE_OPTIONS : [current, ...TYPE_OPTIONS];
}

function normalizeDraftType(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDraftDefault(value) {
  return value == null ? "" : String(value).trim();
}

export default function SqlDesigner({ embedded = false, selectedTableHint = "" }) {
  const [tables, setTables] = useState([]);
  const [schemaCatalog, setSchemaCatalog] = useState({});
  const [schemaTablesMeta, setSchemaTablesMeta] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [schemaRows, setSchemaRows] = useState([]);
  const [primaryKey, setPrimaryKey] = useState(null);
  const [foreignKeys, setForeignKeys] = useState({});

  const [newTableName, setNewTableName] = useState("");
  const [newTableColumns, setNewTableColumns] = useState(defaultNewTableColumns);

  const [renameTableTo, setRenameTableTo] = useState("");
  const [editingTableName, setEditingTableName] = useState(false);
  const [editingAllColumns, setEditingAllColumns] = useState(false);
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const renameInputRef = useRef(null);
  const [showAddColumnRow, setShowAddColumnRow] = useState(false);
  const [inlineColumnEdits, setInlineColumnEdits] = useState({});
  const [designerTab, setDesignerTab] = useState("schema");
  const [listFieldsConfig, setListFieldsConfig] = useState([]);
  const [hiddenDetailColumnsText, setHiddenDetailColumnsText] = useState("");

  const [fkDraft, setFkDraft] = useState({
    connectionType: "many_to_one",
    fromTable: "",
    fromColumn: "",
    toTable: "",
    toColumn: "",
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
    constraintName: "",
  });
  const [editingFk, setEditingFk] = useState(null);

  const cardStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg-elev)",
    borderRadius: 12,
    padding: 12,
  };
  const buttonStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg-soft)",
    color: "var(--text)",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  };
  const primaryButtonStyle = {
    ...buttonStyle,
    border: "1px solid #2b6cff",
    background: "#2b6cff",
    color: "white",
  };
  const dangerButtonStyle = {
    ...buttonStyle,
    border: "1px solid #f04438",
    background: "#f04438",
    color: "white",
  };
  const ghostButtonStyle = {
    ...buttonStyle,
    background: "transparent",
  };
  const disabledButtonStyle = {
    opacity: 0.55,
    cursor: "not-allowed",
  };
  const iconButtonStyle = {
    ...buttonStyle,
    width: 32,
    minWidth: 32,
    height: 30,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const inputStyle = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-soft)",
    color: "var(--text)",
    padding: "6px 8px",
    fontSize: 12,
  };
  const sectionHeaderStyle = {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  };
  const schemaHeaderCellStyle = {
    textAlign: "left",
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
  };
  const schemaCellStyle = {
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    verticalAlign: "middle",
  };
  const actionIconStyle = { width: 14, height: 14, display: "block" };
  const plusIconStyle = { width: 16, height: 16, display: "block" };

  const tableColumns = useMemo(
    () => schemaRows.map((r) => String(r?.column_name || "")).filter(Boolean),
    [schemaRows]
  );
  const incomingForeignKeys = useMemo(() => {
    const selected = String(selectedTable || "").trim();
    if (!selected) return [];
    const rows = Array.isArray(schemaTablesMeta) ? schemaTablesMeta : [];
    const out = [];
    const seen = new Set();
    rows.forEach((tableMeta) => {
      const fromTable = String(tableMeta?.name || "").trim();
      if (!fromTable || fromTable === selected) return;
      const fks = tableMeta?.foreignKeys && typeof tableMeta.foreignKeys === "object" ? tableMeta.foreignKeys : {};
      Object.values(fks).forEach((meta) => {
        const refTable = String(meta?.referencedTable || "").trim();
        if (refTable !== selected) return;
        const row = {
          fromTable,
          fromColumn: String(meta?.column || "").trim(),
          toTable: refTable,
          toColumn: String(meta?.referencedColumn || "").trim(),
          constraintName: String(meta?.constraintName || "").trim(),
          onDelete: String(meta?.onDelete || "NO ACTION").trim().toUpperCase(),
          onUpdate: String(meta?.onUpdate || "NO ACTION").trim().toUpperCase(),
        };
        const key = row.constraintName
          ? `c:${row.constraintName}`
          : `s:${row.fromTable}|${row.fromColumn}|${row.toTable}|${row.toColumn}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(row);
      });
    });
    return out;
  }, [schemaTablesMeta, selectedTable]);
  const foreignKeyRows = useMemo(() => {
    const seen = new Set();
    const out = [];
    Object.entries(foreignKeys || {}).forEach(([localColumn, meta]) => {
      const fromColumn = String(meta?.column || localColumn || "").trim();
      const toTable = String(meta?.referencedTable || "").trim();
      const toColumn = String(meta?.referencedColumn || "").trim();
      const constraintName = String(meta?.constraintName || "").trim();
      const key = constraintName ? `c:${constraintName}` : `s:${fromColumn}|${toTable}|${toColumn}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ localColumn: fromColumn, meta });
    });
    return out;
  }, [foreignKeys]);
  const fkFromColumns = useMemo(() => {
    const rows = schemaCatalog[String(fkDraft.fromTable || "")] || [];
    return rows.map((r) => String(r?.column_name || "")).filter(Boolean);
  }, [schemaCatalog, fkDraft.fromTable]);
  const fkToColumns = useMemo(() => {
    const rows = schemaCatalog[String(fkDraft.toTable || "")] || [];
    return rows.map((r) => String(r?.column_name || "")).filter(Boolean);
  }, [schemaCatalog, fkDraft.toTable]);
  const canEditTable = !!selectedTable && !editingTableName && !editingAllColumns;
  const canSaveTable =
    !!selectedTable &&
    editingTableName &&
    String(renameTableTo || "").trim().length > 0 &&
    String(renameTableTo || "").trim() !== String(selectedTable || "").trim();
  const canDeleteTable = !!selectedTable && !editingTableName && !editingAllColumns;

  async function loadTables() {
    try {
      const [tablesRes, schemaRes] = await Promise.allSettled([
        fetch("/api/db/tables"),
        fetch("/api/db/designer/schema"),
      ]);

      let names = [];
      if (tablesRes.status === "fulfilled") {
        const data = await tablesRes.value.json().catch(() => ({}));
        if (tablesRes.value.ok) {
          names = Array.isArray(data?.tables)
            ? data.tables.map((t) => String(t || "").trim()).filter(Boolean)
            : [];
        }
      }

      const schemaRows =
        schemaRes.status === "fulfilled"
          ? await schemaRes.value.json().then((data) => (schemaRes.value.ok ? (Array.isArray(data?.tables) ? data.tables : []) : []))
          : [];
      setSchemaTablesMeta(schemaRows);

      if (!names.length) {
        names = schemaRows.map((t) => String(t?.name || "").trim()).filter(Boolean);
      }

      const nextCatalog = {};
      schemaRows.forEach((t) => {
        const tableName = String(t?.name || "");
        if (!tableName) return;
        nextCatalog[tableName] = Array.isArray(t?.columns) ? t.columns : [];
      });
      setSchemaCatalog(nextCatalog);
      setTables(names);
      setSelectedTable((prev) => {
        if (prev && names.includes(prev)) return prev;
        return names[0] || "";
      });
      // Empty-table state is already shown in the table list panel.
    } catch (err) {
      toastError(String(err?.message || "Failed to load schema."));
    }
  }

  async function loadTableMeta(tableName) {
    const table = String(tableName || "").trim();
    if (!table) {
      setSchemaRows([]);
      setPrimaryKey(null);
      setForeignKeys({});
      return;
    }
    try {
      const [metaRes, cfgRes] = await Promise.all([
        fetch(`/api/db/${encodeURIComponent(table)}/meta`),
        fetch(`/api/db/${encodeURIComponent(table)}?limit=1&offset=0`),
      ]);
      const data = await metaRes.json();
      const cfgData = await cfgRes.json().catch(() => ({}));
      if (!metaRes.ok) throw new Error(String(data?.error || "Failed to load table metadata."));
      const cols = Array.isArray(data?.columns) ? data.columns : [];
      setSchemaRows(cols);
      setPrimaryKey(data?.primaryKey || null);
      setForeignKeys(data?.foreignKeys && typeof data.foreignKeys === "object" ? data.foreignKeys : {});
      setRenameTableTo(table);
      const listFields = Array.isArray(cfgData?.listFields) ? cfgData.listFields : [];
      const detailFields = Array.isArray(cfgData?.detailFields) ? cfgData.detailFields : [];
      setListFieldsConfig(listFields);
      const detailSet = new Set(detailFields.map((name) => String(name || "")));
      const hidden = cols
        .map((col) => String(col?.column_name || ""))
        .filter((name) => name && detailFields.length && !detailSet.has(name));
      setHiddenDetailColumnsText(hidden.join(", "));
    } catch (err) {
      toastError(String(err?.message || "Failed to load table metadata."));
    }
  }

  async function saveHiddenDetailColumns(hiddenColumnsText) {
    if (!selectedTable) return;
    const hiddenSet = new Set(
      String(hiddenColumnsText || "")
        .split(",")
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    );
    const detailFields = schemaRows
      .map((col) => String(col?.column_name || ""))
      .filter((name) => name && !hiddenSet.has(name));
    const listFields = Array.isArray(listFieldsConfig)
      ? listFieldsConfig
      : schemaRows
          .map((col) => String(col?.column_name || ""))
          .filter((name) => name && name !== "id");
    const res = await fetch(`/api/db/${encodeURIComponent(selectedTable)}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ list_fields: listFields, detail_fields: detailFields }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data?.error || "Failed to save detail fields."));
  }

  useEffect(() => {
    loadTables();
  }, []);

  useEffect(() => {
    loadTableMeta(selectedTable);
    setEditingFk(null);
    setFkDraft((prev) => ({
      ...prev,
      fromTable: selectedTable || prev.fromTable,
    }));
  }, [selectedTable]);

  useEffect(() => {
    if (!fkDraft.fromTable && tables.length) {
      setFkDraft((prev) => ({ ...prev, fromTable: tables[0] || "" }));
    }
    if (!fkDraft.toTable && tables.length > 1) {
      const alt = tables.find((t) => t !== (fkDraft.fromTable || tables[0])) || tables[0];
      setFkDraft((prev) => ({ ...prev, toTable: alt || "" }));
    }
  }, [tables, fkDraft.fromTable, fkDraft.toTable]);

  useEffect(() => {
    const col = tableColumns[0] || "";
    if (fkDraft.fromTable === selectedTable && fkDraft.fromColumn && tableColumns.includes(fkDraft.fromColumn)) {
      return;
    }
    if (fkDraft.fromTable === selectedTable) {
      setFkDraft((prev) => ({ ...prev, fromColumn: col }));
    }
  }, [selectedTable, tableColumns, fkDraft.fromTable, fkDraft.fromColumn]);

  useEffect(() => {
    if (fkFromColumns.length && !fkFromColumns.includes(fkDraft.fromColumn)) {
      setFkDraft((prev) => ({ ...prev, fromColumn: fkFromColumns[0] || "" }));
    }
  }, [fkFromColumns, fkDraft.fromColumn]);

  useEffect(() => {
    if (fkToColumns.length && !fkToColumns.includes(fkDraft.toColumn)) {
      setFkDraft((prev) => ({ ...prev, toColumn: fkToColumns[0] || "" }));
    }
  }, [fkToColumns, fkDraft.toColumn]);

  useEffect(() => {
    const hint = String(selectedTableHint || "").trim();
    if (!hint) return;
    if (!tables.includes(hint)) return;
    setSelectedTable(hint);
    setShowCreatePanel(false);
  }, [selectedTableHint, tables]);

  useEffect(() => {
    if (selectedTable) setShowCreatePanel(false);
  }, [selectedTable]);

  useEffect(() => {
    const next = {};
    schemaRows.forEach((row) => {
      const originalName = String(row?.column_name || "").trim();
      if (!originalName) return;
      next[originalName] = {
        newName: originalName,
        type: String(row?.data_type || ""),
        nullable: String(row?.is_nullable || "").toUpperCase() === "YES",
        defaultValue: row?.column_default == null ? "" : String(row.column_default),
        primaryKey: primaryKey === originalName,
      };
    });
    setInlineColumnEdits(next);
    setEditingAllColumns(false);
  }, [schemaRows, primaryKey]);

  async function runAction(fn, successMessage) {
    try {
      await fn();
      toastSuccess(successMessage);
      await loadTables();
      await loadTableMeta(selectedTable);
    } catch (err) {
      const msg = String(err?.message || "Operation failed.");
      toastError(msg);
    }
  }

  async function createTable() {
    const payload = {
      tableName: String(newTableName || "").trim(),
      columns: newTableColumns.map((c) => ({
        name: String(c.name || "").trim(),
        type: String(c.type || "").trim(),
        nullable: c.nullable !== false,
        defaultValue: String(c.defaultValue || "").trim(),
        primaryKey: c.primaryKey === true,
      })),
    };
    const res = await fetch("/api/db/designer/table", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Failed to create table."));
    setNewTableName("");
    setNewTableColumns(defaultNewTableColumns());
    if (payload.tableName) setSelectedTable(payload.tableName);
  }

  async function renameTable() {
    if (!selectedTable) throw new Error("Select a table first.");
    const res = await fetch(`/api/db/designer/table/${encodeURIComponent(selectedTable)}/rename`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newName: String(renameTableTo || "").trim() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Failed to rename table."));
    setSelectedTable(String(renameTableTo || "").trim());
  }

  async function deleteTable() {
    if (!selectedTable) throw new Error("Select a table first.");
    const res = await fetch(`/api/db/designer/table/${encodeURIComponent(selectedTable)}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data?.error || "Failed to delete table."));
  }

  function openAddColumnRow() {
    if (!selectedTable) return;
    setShowAddColumnRow(true);
    setInlineColumnEdits((prev) => ({
      ...prev,
      [NEW_COLUMN_KEY]: {
        newName: "",
        type: "text",
        nullable: true,
        defaultValue: "",
        primaryKey: false,
      },
    }));
  }

  function closeAddColumnRow() {
    setShowAddColumnRow(false);
    setInlineColumnEdits((prev) => {
      const next = { ...prev };
      delete next[NEW_COLUMN_KEY];
      return next;
    });
  }

  async function addColumnFromDraft(draft) {
    if (!selectedTable) throw new Error("Select a table first.");
    const next = draft && typeof draft === "object" ? draft : {};
    const columnName = String(next.newName || "").trim();
    if (!columnName) throw new Error("Column name is required.");
    const alreadyExists = schemaRows.some(
      (row) => String(row?.column_name || "").trim().toLowerCase() === columnName.toLowerCase()
    );
    if (alreadyExists) throw new Error(`Column "${columnName}" already exists.`);
    const columnType = String(next.type || "").trim();
    if (!columnType) throw new Error("Column type is required.");
    const res = await fetch(`/api/db/designer/table/${encodeURIComponent(selectedTable)}/column`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: columnName,
        type: columnType,
        nullable: next.nullable !== false,
        defaultValue: String(next.defaultValue || "").trim(),
        primaryKey: next.primaryKey === true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Failed to add column."));
    closeAddColumnRow();
  }

  async function saveInlineColumn(originalName) {
    const baseName = String(originalName || "").trim();
    if (!selectedTable) throw new Error("Select a table first.");
    if (!baseName) throw new Error("Invalid column.");
    const draft = inlineColumnEdits[baseName];
    if (!draft) throw new Error("Column draft not found.");
    const row = schemaRows.find((r) => String(r?.column_name || "").trim() === baseName);
    if (!row) throw new Error(`Column "${baseName}" not found.`);

    const payload = {};
    const nextName = String(draft.newName || "").trim();
    if (!nextName) throw new Error("Column name cannot be blank.");
    if (nextName !== baseName) payload.newName = nextName;

    const nextType = normalizeDraftType(draft.type);
    const baseType = normalizeDraftType(row?.data_type);
    if (nextType && nextType !== baseType) payload.type = String(draft.type || "").trim();

    const nextNullable = draft.nullable !== false;
    const baseNullable = String(row?.is_nullable || "").toUpperCase() === "YES";
    if (nextNullable !== baseNullable) payload.nullable = nextNullable;

    const nextDefault = normalizeDraftDefault(draft.defaultValue);
    const baseDefault = normalizeDraftDefault(row?.column_default);
    if (nextDefault !== baseDefault) payload.defaultValue = nextDefault;

    const nextPrimary = draft.primaryKey === true;
    const basePrimary = primaryKey === baseName;
    if (nextPrimary !== basePrimary) payload.primaryKey = nextPrimary;

    if (Object.keys(payload).length === 0) return;

    const res = await fetch(
      `/api/db/designer/table/${encodeURIComponent(selectedTable)}/column/${encodeURIComponent(baseName)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Failed to update column."));
  }

  async function saveAllColumnChanges() {
    if (!selectedTable) throw new Error("Select a table first.");
    const changed = schemaRows
      .map((row) => String(row?.column_name || "").trim())
      .filter(Boolean)
      .filter((name) => {
        const draft = inlineColumnEdits[name];
        const row = schemaRows.find((r) => String(r?.column_name || "").trim() === name);
        if (!draft || !row) return false;
        const rowType = String(row?.data_type || "").trim();
        const rowNullable = String(row?.is_nullable || "").toUpperCase() === "YES";
        const rowDefault = row?.column_default == null ? "" : String(row.column_default);
        const rowPrimaryKey = primaryKey === name;
        return (
          String(draft.newName || "").trim() !== name ||
          String(draft.type || "").trim() !== rowType ||
          (draft.nullable !== false) !== rowNullable ||
          String(draft.defaultValue || "").trim() !== rowDefault ||
          (draft.primaryKey === true) !== rowPrimaryKey
        );
      });
    for (const name of changed) {
      await saveInlineColumn(name);
    }
  }

  async function deleteColumn(columnName) {
    const baseName = String(columnName || "").trim();
    if (!selectedTable) throw new Error("Select a table first.");
    if (!baseName) throw new Error("Invalid column.");
    const res = await fetch(
      `/api/db/designer/table/${encodeURIComponent(selectedTable)}/column/${encodeURIComponent(baseName)}`,
      { method: "DELETE" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data?.error || "Failed to delete column."));
  }

  function setDraftPrimaryKey(columnName, enabled) {
    const target = String(columnName || "").trim();
    if (!target) return;
    setInlineColumnEdits((prev) => {
      const next = { ...prev };
      if (enabled) {
        Object.keys(next).forEach((key) => {
          next[key] = { ...(next[key] || {}), primaryKey: key === target };
        });
      } else if (next[target]) {
        next[target] = { ...(next[target] || {}), primaryKey: false };
      }
      return next;
    });
  }

  async function connectTables() {
    const connectionType = String(fkDraft.connectionType || "many_to_one").trim();
    const isOneToMany = connectionType === "one_to_many";
    const fromTable = isOneToMany ? fkDraft.toTable : fkDraft.fromTable;
    const fromColumn = isOneToMany ? fkDraft.toColumn : fkDraft.fromColumn;
    const toTable = isOneToMany ? fkDraft.fromTable : fkDraft.toTable;
    const toColumn = isOneToMany ? fkDraft.fromColumn : fkDraft.toColumn;
    const isEditing = editingFk && typeof editingFk === "object";
    const endpoint = "/api/db/designer/foreign-key";
    const method = isEditing ? "PUT" : "POST";
    const body = {
      fromTable,
      fromColumn,
      toTable,
      toColumn,
      onDelete: fkDraft.onDelete,
      onUpdate: fkDraft.onUpdate,
      constraintName: fkDraft.constraintName,
    };
    if (isEditing) {
      body.oldFromTable = editingFk.fromTable;
      body.oldConstraintName = editingFk.constraintName;
    }
    const res = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || (isEditing ? "Failed to update relationship." : "Failed to add relationship.")));
    if (isEditing) setEditingFk(null);
  }

  async function deleteConnection(fromTable, constraintName) {
    const res = await fetch("/api/db/designer/foreign-key", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromTable, constraintName }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(data?.error || "Failed to delete relationship."));
  }

  function startEditConnection(localColumn, meta, fromTableOverride = "") {
    const fromTable = String(fromTableOverride || selectedTable || "").trim();
    const fromColumn = String(meta?.column || localColumn || "").trim();
    const toTable = String(meta?.referencedTable || "").trim();
    const toColumn = String(meta?.referencedColumn || "").trim();
    const constraintName = String(meta?.constraintName || "").trim();
    if (!fromTable || !fromColumn || !toTable || !toColumn || !constraintName) return;
    setFkDraft((prev) => ({
      ...prev,
      connectionType: "many_to_one",
      fromTable,
      fromColumn,
      toTable,
      toColumn,
      onDelete: String(meta?.onDelete || "NO ACTION").trim().toUpperCase(),
      onUpdate: String(meta?.onUpdate || "NO ACTION").trim().toUpperCase(),
      constraintName,
    }));
    setEditingFk({ fromTable, constraintName });
  }

  function enterCreateMode() {
    setShowCreatePanel(true);
    setSelectedTable("");
    setEditingTableName(false);
    setEditingAllColumns(false);
  }

  function exitCreateMode() {
    setShowCreatePanel(false);
    if (!selectedTable && tables.length) setSelectedTable(tables[0] || "");
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        padding: embedded ? 10 : 16,
        boxSizing: "border-box",
        background: "var(--bg-elev)",
        color: "var(--text)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 10,
          flexShrink: 0,
          background: "var(--bg-elev)",
          position: "relative",
          zIndex: 2,
          padding: "4px 0",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 800 }}>SQL Designer</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            style={showCreatePanel ? { ...iconButtonStyle, ...disabledButtonStyle } : { ...buttonStyle, ...iconButtonStyle }}
            onClick={() => {
              if (showCreatePanel) return;
              enterCreateMode();
            }}
            disabled={showCreatePanel}
            title="New Table"
            aria-label="New Table"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" style={plusIconStyle}>
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            style={
              showCreatePanel || selectedTable
                ? iconButtonStyle
                : { ...iconButtonStyle, ...disabledButtonStyle }
            }
            onClick={() => {
              if (showCreatePanel) {
                exitCreateMode();
                return;
              }
              if (!selectedTable) return;
              if (editingTableName || editingAllColumns) {
                setRenameTableTo(selectedTable || "");
                setEditingTableName(false);
                setEditingAllColumns(false);
                loadTableMeta(selectedTable);
                return;
              }
              setEditingTableName(true);
              setEditingAllColumns(true);
              setTimeout(() => {
                if (!renameInputRef.current) return;
                renameInputRef.current.focus();
                renameInputRef.current.select?.();
              }, 0);
            }}
            disabled={!showCreatePanel && !selectedTable}
            title={showCreatePanel || editingTableName || editingAllColumns ? "Cancel edit" : "Edit"}
            aria-label={showCreatePanel || editingTableName || editingAllColumns ? "Cancel edit" : "Edit"}
                    >
            {showCreatePanel || editingTableName || editingAllColumns ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={actionIconStyle}>
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={actionIconStyle}>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            )}
          </button>
          <button
            style={
              selectedTable && (editingTableName || editingAllColumns)
                ? { ...primaryButtonStyle, ...iconButtonStyle }
                : { ...primaryButtonStyle, ...iconButtonStyle, ...disabledButtonStyle }
            }
            onClick={async () => {
              const renameChanged =
                String(renameTableTo || "").trim().length > 0 &&
                String(renameTableTo || "").trim() !== String(selectedTable || "").trim();
              const saveColumns = editingAllColumns;
              if (!renameChanged && !saveColumns) return;
              await runAction(
                async () => {
                  if (saveColumns) await saveAllColumnChanges();
                  if (renameChanged) await renameTable();
                },
                renameChanged && saveColumns
                  ? "Table and columns updated."
                  : renameChanged
                  ? "Table renamed."
                  : "Column updates saved."
              );
              setEditingTableName(false);
              setEditingAllColumns(false);
            }}
            disabled={!selectedTable || (!editingTableName && !editingAllColumns)}
            title="Save"
            aria-label="Save"
          >
            ✓
          </button>
<button
            style={canDeleteTable ? { ...dangerButtonStyle, ...iconButtonStyle } : { ...dangerButtonStyle, ...iconButtonStyle, ...disabledButtonStyle }}
            disabled={!canDeleteTable}
            title="Delete table"
            aria-label="Delete table"
            onClick={async () => {
              if (!selectedTable) return;
              const ok = await showConfirmDialog({
                title: "Delete Table",
                message: `Delete table "${selectedTable}"? This cannot be undone.`,
                confirmText: "Delete",
                danger: true,
              });
              if (!ok) return;
              try {
                await deleteTable();
                toastSuccess(`Table ${selectedTable} deleted.`);
                await loadTables();
              } catch (err) {
                const msg = String(err?.message || "Failed to delete table.");
                toastError(msg);
              }
            }}
          >
            🗑
          </button>
        </div>
      </div>
      {!showCreatePanel ? (
        <div
          style={{
            display: "grid",
            gap: 6,
            marginTop: 2,
            background: "var(--bg-elev)",
            position: "relative",
            zIndex: 2,
            padding: "6px 0",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Table</div>
          <SearchableSelect
            style={inputStyle}
            options={tables.map((t) => ({ value: t, label: t }))}
            value={selectedTable}
            placeholder="Search/select table..."
            onChange={(nextValue) => {
              const next = String(nextValue || "").trim();
              setSelectedTable(next);
              if (next) setShowCreatePanel(false);
            }}
            disabled={!tables.length}
            title="Select table"
          />
          {!tables.length ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No tables found.</div> : null}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setDesignerTab("schema")}
              style={designerTab === "schema" ? primaryButtonStyle : ghostButtonStyle}
            >
              Schema
            </button>
            <button
              type="button"
              onClick={() => setDesignerTab("relations")}
              style={designerTab === "relations" ? primaryButtonStyle : ghostButtonStyle}
            >
              Connect Tables
            </button>
          </div>
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      {showCreatePanel ? (
        <div
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg-soft)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>Create Table</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
            Build a new table and define its initial columns.
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              style={inputStyle}
              value={newTableName}
              placeholder="table_name"
              onChange={(e) => setNewTableName(e.target.value)}
            />
            {newTableColumns.map((col, idx) => (
              <div
                key={`new-col-${idx}`}
                style={{
                  display: "grid",
                  gap: 6,
                  padding: "8px 0 9px",
                  borderBottom:
                    idx < newTableColumns.length - 1
                      ? "1px solid color-mix(in srgb, var(--border) 72%, transparent)"
                      : "none",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 8,
                    padding: "0 2px",
                  }}
                >
                  <div style={{ padding: "0 2px" }}>
                    <input
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                      value={col.name}
                      placeholder="column_name"
                      disabled={col.locked}
                      onChange={(e) =>
                        setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))
                      }
                    />
                  </div>
                  <div style={{ padding: "0 2px" }}>
                    <select
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                      value={col.type}
                      disabled={col.locked}
                      onChange={(e) =>
                        setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, type: e.target.value } : r)))
                      }
                    >
                      {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={{ padding: "0 2px" }}>
                    <input
                      style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
                      value={col.defaultValue}
                      placeholder="default"
                      disabled={col.locked}
                      onChange={(e) =>
                        setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, defaultValue: e.target.value } : r)))
                      }
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    flexWrap: "wrap",
                    paddingTop: 0,
                    minHeight: 20,
                  }}
                >
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={col.nullable}
                      disabled={col.locked}
                      onChange={(e) =>
                        setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, nullable: e.target.checked } : r)))
                      }
                    />
                    Nullable
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={col.primaryKey}
                      disabled={col.locked}
                      onChange={(e) =>
                        setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, primaryKey: e.target.checked } : r)))
                      }
                    />
                    PK
                  </label>
                  <button
                    style={{ ...iconButtonStyle, marginLeft: "auto" }}
                    onClick={() => setNewTableColumns((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={Boolean(col.locked) || newTableColumns.length <= 3}
                    title="Remove column"
                    aria-label="Remove column"
                  >
                    −
                  </button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                style={iconButtonStyle}
                onClick={() => setNewTableColumns((prev) => [...prev, blankColumn()])}
                title="Add column"
                aria-label="Add column"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" style={plusIconStyle}>
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </button>
              <button
                style={{ ...primaryButtonStyle, ...iconButtonStyle }}
                onClick={() => runAction(createTable, "Table created.")}
                title="Create table"
                aria-label="Create table"
              >
                ✓
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 10, minHeight: 0 }}>
        <div style={{ display: "grid", gap: 10 }}>
          {designerTab === "schema" ? (
          <div style={cardStyle}>
            <div style={sectionHeaderStyle}>Schema</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 6, flexWrap: "wrap" }}>
              <input
                ref={renameInputRef}
                style={{ ...inputStyle, width: 260, maxWidth: "100%" }}
                value={renameTableTo}
                placeholder="new_table_name"
                disabled={!editingTableName}
                onChange={(e) => setRenameTableTo(e.target.value)}
                title="Table name"
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  style={iconButtonStyle}
                  onClick={() => {
                    if (showAddColumnRow) closeAddColumnRow();
                    else openAddColumnRow();
                  }}
                  disabled={!selectedTable}
                  title="Add column row"
                >
                  {showAddColumnRow ? "✕" : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" style={plusIconStyle}>
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 6, marginBottom: 8 }}>
              <input
                style={{ ...inputStyle, width: "100%" }}
                value={hiddenDetailColumnsText}
                placeholder="Hide on Details (comma-separated column names)"
                onChange={(e) => setHiddenDetailColumnsText(e.target.value)}
              />
              <button
                style={primaryButtonStyle}
                onClick={() =>
                  runAction(
                    () => saveHiddenDetailColumns(hiddenDetailColumnsText),
                    "Details hidden columns updated."
                  )
                }
                title="Save hidden details"
                aria-label="Save hidden details"
              >
                Save
              </button>
            </div>
            {selectedTable ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", tableLayout: "fixed", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "26%" }} />
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "10%" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={schemaHeaderCellStyle}>Column</th>
                      <th style={schemaHeaderCellStyle}>Type</th>
                      <th style={schemaHeaderCellStyle}>Nullable</th>
                      <th style={schemaHeaderCellStyle}>Default</th>
                      <th style={schemaHeaderCellStyle}>PK</th>
                      <th style={schemaHeaderCellStyle}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {showAddColumnRow ? (
                      <tr>
                        <td style={schemaCellStyle}>
                          <input
                            style={{ ...inputStyle, width: "100%" }}
                            value={inlineColumnEdits[NEW_COLUMN_KEY]?.newName || ""}
                            placeholder="column_name"
                            onChange={(e) =>
                              setInlineColumnEdits((prev) => ({
                                ...prev,
                                [NEW_COLUMN_KEY]: {
                                  ...(prev[NEW_COLUMN_KEY] || {}),
                                  newName: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td style={schemaCellStyle}>
                          <select
                            style={{ ...inputStyle, width: "100%" }}
                            value={inlineColumnEdits[NEW_COLUMN_KEY]?.type || "text"}
                            onChange={(e) =>
                              setInlineColumnEdits((prev) => ({
                                ...prev,
                                [NEW_COLUMN_KEY]: {
                                  ...(prev[NEW_COLUMN_KEY] || {}),
                                  type: e.target.value,
                                },
                              }))
                            }
                          >
                            {TYPE_OPTIONS.map((t) => (
                              <option key={`new-type-${t}`} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={schemaCellStyle}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={inlineColumnEdits[NEW_COLUMN_KEY]?.nullable !== false}
                              onChange={(e) =>
                                setInlineColumnEdits((prev) => ({
                                  ...prev,
                                  [NEW_COLUMN_KEY]: {
                                    ...(prev[NEW_COLUMN_KEY] || {}),
                                    nullable: e.target.checked,
                                  },
                                }))
                              }
                            />
                            {inlineColumnEdits[NEW_COLUMN_KEY]?.nullable !== false ? "YES" : "NO"}
                          </label>
                        </td>
                        <td style={schemaCellStyle}>
                          <input
                            style={{ ...inputStyle, width: "100%" }}
                            value={inlineColumnEdits[NEW_COLUMN_KEY]?.defaultValue || ""}
                            placeholder="default"
                            onChange={(e) =>
                              setInlineColumnEdits((prev) => ({
                                ...prev,
                                [NEW_COLUMN_KEY]: {
                                  ...(prev[NEW_COLUMN_KEY] || {}),
                                  defaultValue: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td style={schemaCellStyle}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={inlineColumnEdits[NEW_COLUMN_KEY]?.primaryKey === true}
                              onChange={(e) => setDraftPrimaryKey(NEW_COLUMN_KEY, e.target.checked)}
                            />
                            {inlineColumnEdits[NEW_COLUMN_KEY]?.primaryKey === true ? "Yes" : ""}
                          </label>
                        </td>
                        <td style={schemaCellStyle}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              style={iconButtonStyle}
                              title="Save column"
                              aria-label="Save column"
                              onClick={() =>
                                runAction(
                                  () => addColumnFromDraft(inlineColumnEdits[NEW_COLUMN_KEY]),
                                  `Column ${String(inlineColumnEdits[NEW_COLUMN_KEY]?.newName || "").trim()} added.`
                                )
                              }
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={actionIconStyle}>
                                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                                <path d="M17 21v-8H7v8" />
                                <path d="M7 3v5h8" />
                              </svg>
                            </button>
                            <button
                              style={iconButtonStyle}
                              title="Cancel add"
                              aria-label="Cancel add"
                              onClick={closeAddColumnRow}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={actionIconStyle}>
                                <path d="M18 6L6 18" />
                                <path d="M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {schemaRows.map((col) => (
                      <tr key={`schema-row-${col.column_name}`}>
                        <td style={schemaCellStyle}>
                          <input
                            style={{ ...inputStyle, width: "100%" }}
                            value={inlineColumnEdits[col.column_name]?.newName || ""}
                            disabled={!editingAllColumns}
                            onChange={(e) =>
                              setInlineColumnEdits((prev) => ({
                                ...prev,
                                [col.column_name]: {
                                  ...(prev[col.column_name] || {}),
                                  newName: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td style={schemaCellStyle}>
                          <select
                            style={{ ...inputStyle, width: "100%" }}
                            value={inlineColumnEdits[col.column_name]?.type || "text"}
                            disabled={!editingAllColumns}
                            onChange={(e) =>
                              setInlineColumnEdits((prev) => ({
                                ...prev,
                                [col.column_name]: {
                                  ...(prev[col.column_name] || {}),
                                  type: e.target.value,
                                },
                              }))
                            }
                          >
                            {typeOptionsFor(inlineColumnEdits[col.column_name]?.type || "").map((t) => (
                              <option key={`edit-type-${col.column_name}-${t}`} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={schemaCellStyle}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={inlineColumnEdits[col.column_name]?.nullable !== false}
                              disabled={!editingAllColumns}
                              onChange={(e) =>
                                setInlineColumnEdits((prev) => ({
                                  ...prev,
                                  [col.column_name]: {
                                    ...(prev[col.column_name] || {}),
                                    nullable: e.target.checked,
                                  },
                                }))
                              }
                            />
                            {inlineColumnEdits[col.column_name]?.nullable !== false ? "YES" : "NO"}
                          </label>
                        </td>
                        <td style={schemaCellStyle}>
                          <input
                            style={{ ...inputStyle, width: "100%" }}
                            value={inlineColumnEdits[col.column_name]?.defaultValue || ""}
                            placeholder="blank clears default"
                            disabled={!editingAllColumns}
                            onChange={(e) =>
                              setInlineColumnEdits((prev) => ({
                                ...prev,
                                [col.column_name]: {
                                  ...(prev[col.column_name] || {}),
                                  defaultValue: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td style={schemaCellStyle}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={inlineColumnEdits[col.column_name]?.primaryKey === true}
                              disabled={!editingAllColumns}
                              onChange={(e) => setDraftPrimaryKey(col.column_name, e.target.checked)}
                            />
                            {inlineColumnEdits[col.column_name]?.primaryKey === true ? "Yes" : ""}
                          </label>
                        </td>
                        <td style={schemaCellStyle}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              style={editingAllColumns ? { ...iconButtonStyle, ...disabledButtonStyle } : iconButtonStyle}
                              title="Delete column"
                              aria-label="Delete column"
                              disabled={editingAllColumns}
                              onClick={async () => {
                                const ok = await showConfirmDialog({
                                  title: "Delete Column",
                                  message: `Delete column "${col.column_name}" from ${selectedTable}?`,
                                  confirmText: "Delete",
                                  danger: true,
                                });
                                if (!ok) return;
                                await runAction(
                                  () => deleteColumn(col.column_name),
                                  `Column ${String(col.column_name)} deleted.`
                                );
                              }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={actionIconStyle}>
                                <path d="M3 6h18" />
                                <path d="M8 6V4h8v2" />
                                <path d="M19 6l-1 14H6L5 6" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Select a table to view schema.</div>
            )}
          </div>
          ) : null}
          {designerTab === "relations" ? (
          <div style={cardStyle}>
            <div style={sectionHeaderStyle}>Connect Tables</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Foreign key relationships</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 220px)", gap: 6, marginBottom: 6 }}>
              <select
                style={inputStyle}
                value={fkDraft.connectionType}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, connectionType: e.target.value }))}
              >
                {FK_CONNECTION_TYPES.map((opt) => (
                  <option key={`fk-type-${opt.value}`} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 6 }}>
              <select
                style={inputStyle}
                value={fkDraft.fromTable}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, fromTable: e.target.value, fromColumn: "" }))}
              >
                <option value="">
                  {fkDraft.connectionType === "one_to_many" ? "One table" : "From table"}
                </option>
                {tables.map((t) => <option key={`fk-from-${t}`} value={t}>{t}</option>)}
              </select>
              <select
                style={inputStyle}
                value={fkDraft.fromColumn}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, fromColumn: e.target.value }))}
              >
                <option value="">
                  {fkDraft.connectionType === "one_to_many" ? "One key column" : "From column"}
                </option>
                {fkFromColumns.map((c) => <option key={`fk-from-col-${c}`} value={c}>{c}</option>)}
              </select>
              <select
                style={inputStyle}
                value={fkDraft.toTable}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, toTable: e.target.value, toColumn: "" }))}
              >
                <option value="">
                  {fkDraft.connectionType === "one_to_many" ? "Many table" : "To table"}
                </option>
                {tables.map((t) => <option key={`fk-to-${t}`} value={t}>{t}</option>)}
              </select>
              <select
                style={inputStyle}
                value={fkDraft.toColumn}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, toColumn: e.target.value }))}
              >
                <option value="">
                  {fkDraft.connectionType === "one_to_many" ? "Many FK column" : "To column"}
                </option>
                {fkToColumns.map((c) => <option key={`fk-to-col-${c}`} value={c}>{c}</option>)}
              </select>
              <select
                style={inputStyle}
                value={fkDraft.onDelete}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, onDelete: e.target.value }))}
              >
                {FK_ACTIONS.map((a) => <option key={`del-${a}`} value={a}>{`ON DELETE ${a}`}</option>)}
              </select>
              <select
                style={inputStyle}
                value={fkDraft.onUpdate}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, onUpdate: e.target.value }))}
              >
                {FK_ACTIONS.map((a) => <option key={`upd-${a}`} value={a}>{`ON UPDATE ${a}`}</option>)}
              </select>
              <button
                style={{ ...primaryButtonStyle, ...iconButtonStyle, width: 32, minWidth: 32 }}
                onClick={() =>
                  runAction(
                    connectTables,
                    editingFk ? "Relationship updated." : "Relationship created."
                  )
                }
                title={editingFk ? "Update relationship" : "Create relationship"}
                aria-label={editingFk ? "Update relationship" : "Create relationship"}
              >
                🔗
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6, marginTop: 6 }}>
              <input
                style={{ ...inputStyle, width: "100%" }}
                value={fkDraft.constraintName}
                placeholder="constraint_name (optional)"
                onChange={(e) => setFkDraft((prev) => ({ ...prev, constraintName: e.target.value }))}
              />
              <button
                style={iconButtonStyle}
                onClick={() => {
                  setFkDraft((prev) => ({ ...prev, constraintName: "" }));
                  setEditingFk(null);
                }}
                title="Clear name"
                aria-label="Clear name"
              >
                ✕
              </button>
            </div>
            {editingFk ? (
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                Editing existing connection. Save to apply changes.
              </div>
            ) : null}
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
              Existing links for <strong>{selectedTable || "selected table"}</strong>
            </div>
            <div style={{ marginTop: 6, display: "grid", gap: 4, fontSize: 12 }}>
              {foreignKeyRows.length === 0 ? (
                <div style={{ color: "var(--text-muted)" }}>No foreign keys.</div>
              ) : (
                foreignKeyRows.map(({ localColumn, meta }) => (
                  <div
                    key={`fk-row-${String(meta?.constraintName || `${localColumn}-${String(meta?.referencedTable || "")}-${String(meta?.referencedColumn || "")}`)}`}
                    style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 6, alignItems: "center" }}
                  >
                    <div>
                      <strong>{localColumn}</strong>
                      {" -> "}
                      {String(meta?.referencedTable || "")}.{String(meta?.referencedColumn || "")}
                    </div>
                    <button
                      style={iconButtonStyle}
                      disabled={!String(meta?.constraintName || "").trim()}
                      onClick={() => startEditConnection(localColumn, meta)}
                      title="Edit relationship"
                      aria-label="Edit relationship"
                    >
                      Edit
                    </button>
                    <button
                      style={{ ...iconButtonStyle, ...dangerButtonStyle }}
                      disabled={!String(meta?.constraintName || "").trim()}
                      onClick={() =>
                        runAction(
                          () => deleteConnection(selectedTable, String(meta?.constraintName || "")),
                          "Relationship deleted."
                        )
                      }
                      title="Delete relationship"
                      aria-label="Delete relationship"
                    >
                      Del
                    </button>
                  </div>
                ))
              )}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
              Incoming links to <strong>{selectedTable || "selected table"}</strong>
            </div>
            <div style={{ marginTop: 6, display: "grid", gap: 4, fontSize: 12 }}>
              {!incomingForeignKeys.length ? (
                <div style={{ color: "var(--text-muted)" }}>No incoming foreign keys.</div>
              ) : (
                incomingForeignKeys.map((fk, idx) => (
                  <div
                    key={`fk-incoming-${idx}-${fk.fromTable}-${fk.fromColumn}-${fk.constraintName}`}
                    style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 6, alignItems: "center" }}
                  >
                    <div>
                      <strong>{fk.fromTable}.{fk.fromColumn}</strong>
                      {" -> "}
                      {fk.toTable}.{fk.toColumn}
                    </div>
                    <button
                      style={iconButtonStyle}
                      disabled={!String(fk.constraintName || "").trim()}
                      onClick={() => startEditConnection(fk.fromColumn, { ...fk, column: fk.fromColumn, referencedTable: fk.toTable, referencedColumn: fk.toColumn }, fk.fromTable)}
                      title="Edit relationship"
                      aria-label="Edit relationship"
                    >
                      Edit
                    </button>
                    <button
                      style={{ ...iconButtonStyle, ...dangerButtonStyle }}
                      disabled={!String(fk.constraintName || "").trim()}
                      onClick={() =>
                        runAction(
                          () => deleteConnection(fk.fromTable, fk.constraintName),
                          "Relationship deleted."
                        )
                      }
                      title="Delete relationship"
                      aria-label="Delete relationship"
                    >
                      Del
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
          ) : null}
          <div />
        </div>
      </div>
      </div>
    </div>
  );
}








