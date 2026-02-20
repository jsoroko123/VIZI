import { useEffect, useMemo, useRef, useState } from "react";
import { toastError, toastSuccess } from "../utils/toast";
import { showConfirmDialog } from "../utils/confirmDialog";

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

export default function SqlDesigner({ embedded = false, selectedTableHint = "" }) {
  const [tables, setTables] = useState([]);
  const [tableFilter, setTableFilter] = useState("");
  const [schemaCatalog, setSchemaCatalog] = useState({});
  const [selectedTable, setSelectedTable] = useState("");
  const [schemaRows, setSchemaRows] = useState([]);
  const [primaryKey, setPrimaryKey] = useState(null);
  const [foreignKeys, setForeignKeys] = useState({});

  const [newTableName, setNewTableName] = useState("");
  const [newTableColumns, setNewTableColumns] = useState(defaultNewTableColumns);

  const [renameTableTo, setRenameTableTo] = useState("");
  const [editingTableName, setEditingTableName] = useState(false);
  const [editingAllColumns, setEditingAllColumns] = useState(false);
  const renameInputRef = useRef(null);
  const [showAddColumnRow, setShowAddColumnRow] = useState(false);
  const [inlineColumnEdits, setInlineColumnEdits] = useState({});

  const [fkDraft, setFkDraft] = useState({
    fromTable: "",
    fromColumn: "",
    toTable: "",
    toColumn: "",
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
    constraintName: "",
  });

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
  const disabledButtonStyle = {
    opacity: 0.55,
    cursor: "not-allowed",
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

  const tableColumns = useMemo(
    () => schemaRows.map((r) => String(r?.column_name || "")).filter(Boolean),
    [schemaRows]
  );
  const fkFromColumns = useMemo(() => {
    const rows = schemaCatalog[String(fkDraft.fromTable || "")] || [];
    return rows.map((r) => String(r?.column_name || "")).filter(Boolean);
  }, [schemaCatalog, fkDraft.fromTable]);
  const fkToColumns = useMemo(() => {
    const rows = schemaCatalog[String(fkDraft.toTable || "")] || [];
    return rows.map((r) => String(r?.column_name || "")).filter(Boolean);
  }, [schemaCatalog, fkDraft.toTable]);
  const filteredTables = useMemo(() => {
    const q = String(tableFilter || "").trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => String(t || "").toLowerCase().includes(q));
  }, [tables, tableFilter]);
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
      const res = await fetch(`/api/db/${encodeURIComponent(table)}/meta`);
      const data = await res.json();
      if (!res.ok) throw new Error(String(data?.error || "Failed to load table metadata."));
      const cols = Array.isArray(data?.columns) ? data.columns : [];
      setSchemaRows(cols);
      setPrimaryKey(data?.primaryKey || null);
      setForeignKeys(data?.foreignKeys && typeof data.foreignKeys === "object" ? data.foreignKeys : {});
      setRenameTableTo(table);
    } catch (err) {
      toastError(String(err?.message || "Failed to load table metadata."));
    }
  }

  useEffect(() => {
    loadTables();
  }, []);

  useEffect(() => {
    loadTableMeta(selectedTable);
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
  }, [selectedTableHint, tables]);

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
    const res = await fetch(`/api/db/designer/table/${encodeURIComponent(selectedTable)}/column`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(next.newName || "").trim(),
        type: String(next.type || "").trim(),
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
    const res = await fetch(
      `/api/db/designer/table/${encodeURIComponent(selectedTable)}/column/${encodeURIComponent(baseName)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newName: String(draft.newName || "").trim(),
          type: String(draft.type || "").trim(),
          nullable: draft.nullable !== false,
          defaultValue: String(draft.defaultValue || "").trim(),
          primaryKey: draft.primaryKey === true,
        }),
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
    const res = await fetch("/api/db/designer/foreign-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromTable: fkDraft.fromTable,
        fromColumn: fkDraft.fromColumn,
        toTable: fkDraft.toTable,
        toColumn: fkDraft.toColumn,
        onDelete: fkDraft.onDelete,
        onUpdate: fkDraft.onUpdate,
        constraintName: fkDraft.constraintName,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Failed to add relationship."));
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minHeight: 0,
        overflow: "auto",
        padding: embedded ? 0 : 16,
        boxSizing: "border-box",
        background: "var(--bg-soft)",
        color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>SQL Designer</div>
        <button style={buttonStyle} onClick={loadTables}>Refresh</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: embedded ? "minmax(0, 1fr)" : "200px minmax(0, 1fr)", gap: 10, minHeight: 0 }}>
        {!embedded ? (
          <div style={{ ...cardStyle, display: "grid", gap: 6, alignContent: "start", minHeight: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
              Tables ({tables.length})
            </div>
            <select
              style={inputStyle}
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              disabled={!tables.length}
              title="Select table"
            >
              {!tables.length ? <option value="">No tables</option> : null}
              {tables.map((t) => (
                <option key={`designer-select-${t}`} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              style={inputStyle}
              value={tableFilter}
              placeholder="Search tables..."
              onChange={(e) => setTableFilter(e.target.value)}
            />
            <div style={{ display: "grid", gap: 6, maxHeight: "65vh", overflow: "auto", paddingRight: 4 }}>
              {filteredTables.map((t) => (
                <button
                  key={t}
                  style={{
                    ...buttonStyle,
                    textAlign: "left",
                    borderColor: selectedTable === t ? "var(--selected-border)" : "var(--border)",
                    background: selectedTable === t ? "var(--selected-bg)" : "var(--bg-soft)",
                    color: selectedTable === t ? "var(--selected-text)" : "var(--text)",
                    boxShadow: selectedTable === t ? "var(--selected-shadow)" : "none",
                  }}
                  onClick={() => setSelectedTable(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {!tables.length ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No tables found.</div> : null}
            {!!tables.length && !filteredTables.length ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No matching tables.</div>
            ) : null}
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 10 }}>
          {embedded ? (
            <div style={cardStyle}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
                  Table
                </div>
                <select
                  style={{ ...inputStyle, width: "100%" }}
                  value={selectedTable}
                  onChange={(e) => setSelectedTable(e.target.value)}
                  disabled={!tables.length}
                  title="Select table"
                >
                  {!tables.length ? <option value="">No tables</option> : null}
                  {tables.map((t) => (
                    <option key={`designer-embedded-select-${t}`} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
          <div
            style={{
              ...cardStyle,
              borderLeft: "3px solid #2b6cff",
              paddingLeft: 14,
            }}
          >
            <div style={sectionHeaderStyle}>Create</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Create Table</div>
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
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 6,
                    alignItems: "center",
                  }}
                >
                  <input
                    style={{ ...inputStyle, width: "100%" }}
                    value={col.name}
                    placeholder="column_name"
                    disabled={col.locked}
                    onChange={(e) =>
                      setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))
                    }
                  />
                  <select
                    style={{ ...inputStyle, width: "100%" }}
                    value={col.type}
                    disabled={col.locked}
                    onChange={(e) =>
                      setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, type: e.target.value } : r)))
                    }
                  >
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    style={{ ...inputStyle, width: "100%" }}
                    value={col.defaultValue}
                    placeholder="default"
                    disabled={col.locked}
                    onChange={(e) =>
                      setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, defaultValue: e.target.value } : r)))
                    }
                  />
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
                    style={{ ...buttonStyle, width: "100%" }}
                    onClick={() => setNewTableColumns((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={Boolean(col.locked) || newTableColumns.length <= 3}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={buttonStyle} onClick={() => setNewTableColumns((prev) => [...prev, blankColumn()])}>Add Column</button>
                <button style={primaryButtonStyle} onClick={() => runAction(createTable, "Table created.")}>Create Table</button>
              </div>
            </div>
          </div>

          <div
            style={{
              ...cardStyle,
              borderLeft: "3px solid var(--border)",
              paddingLeft: 14,
              marginTop: 4,
            }}
          >
            <div style={sectionHeaderStyle}>Edit</div>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>Update Table</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
              Rename or modify the selected table schema.
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                <input
                  ref={renameInputRef}
                  style={inputStyle}
                  value={renameTableTo}
                  placeholder="new_table_name"
                  disabled={!editingTableName}
                  onChange={(e) => setRenameTableTo(e.target.value)}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {editingTableName
                  ? "Editing table name. Save to apply or Cancel to discard."
                  : "Use Edit to change table name. Delete is disabled while editing."}
              </div>
            </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Connect Tables (Foreign Key)</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 6 }}>
              <select
                style={inputStyle}
                value={fkDraft.fromTable}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, fromTable: e.target.value, fromColumn: "" }))}
              >
                <option value="">From table</option>
                {tables.map((t) => <option key={`fk-from-${t}`} value={t}>{t}</option>)}
              </select>
              <select
                style={inputStyle}
                value={fkDraft.fromColumn}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, fromColumn: e.target.value }))}
              >
                <option value="">From column</option>
                {fkFromColumns.map((c) => <option key={`fk-from-col-${c}`} value={c}>{c}</option>)}
              </select>
              <select
                style={inputStyle}
                value={fkDraft.toTable}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, toTable: e.target.value, toColumn: "" }))}
              >
                <option value="">To table</option>
                {tables.map((t) => <option key={`fk-to-${t}`} value={t}>{t}</option>)}
              </select>
              <select
                style={inputStyle}
                value={fkDraft.toColumn}
                onChange={(e) => setFkDraft((prev) => ({ ...prev, toColumn: e.target.value }))}
              >
                <option value="">To column</option>
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
              <button style={{ ...primaryButtonStyle, width: "100%" }} onClick={() => runAction(connectTables, "Relationship created.")}>
                Connect
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 6, marginTop: 6 }}>
              <input
                style={{ ...inputStyle, width: "100%" }}
                value={fkDraft.constraintName}
                placeholder="constraint_name (optional)"
                onChange={(e) => setFkDraft((prev) => ({ ...prev, constraintName: e.target.value }))}
              />
              <button style={buttonStyle} onClick={() => setFkDraft((prev) => ({ ...prev, constraintName: "" }))}>Clear Name</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)" }}>
              Existing links for <strong>{selectedTable || "selected table"}</strong>
            </div>
            <div style={{ marginTop: 6, display: "grid", gap: 4, fontSize: 12 }}>
              {Object.keys(foreignKeys || {}).length === 0 ? (
                <div style={{ color: "var(--text-muted)" }}>No foreign keys.</div>
              ) : (
                Object.entries(foreignKeys).map(([localColumn, meta]) => (
                  <div key={`fk-row-${localColumn}`}>
                    <strong>{localColumn}</strong>
                    {" -> "}
                    {String(meta?.referencedTable || "")}.{String(meta?.referencedColumn || "")}
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>Selected Table Schema (Inline Editable)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  style={!selectedTable || editingAllColumns ? { ...buttonStyle, ...disabledButtonStyle } : buttonStyle}
                  onClick={() => setEditingAllColumns(true)}
                  disabled={!selectedTable || editingAllColumns}
                >
                  Edit Columns
                </button>
                <button
                  style={selectedTable && editingAllColumns ? primaryButtonStyle : { ...primaryButtonStyle, ...disabledButtonStyle }}
                  onClick={async () => {
                    await runAction(saveAllColumnChanges, "Column updates saved.");
                    setEditingAllColumns(false);
                  }}
                  disabled={!selectedTable || !editingAllColumns}
                >
                  Save Columns
                </button>
                <button
                  style={selectedTable && editingAllColumns ? buttonStyle : { ...buttonStyle, ...disabledButtonStyle }}
                  onClick={() => {
                    loadTableMeta(selectedTable);
                    setEditingAllColumns(false);
                  }}
                  disabled={!selectedTable || !editingAllColumns}
                >
                  Cancel
                </button>
                <button
                  style={buttonStyle}
                  onClick={() => {
                    if (showAddColumnRow) closeAddColumnRow();
                    else openAddColumnRow();
                  }}
                  disabled={!selectedTable}
                  title="Add column row"
                >
                  {showAddColumnRow ? "Cancel +" : "+ Column"}
                </button>
              </div>
            </div>
            {selectedTable ? (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Column</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Type</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Nullable</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Default</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>PK</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {showAddColumnRow ? (
                      <tr>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={inlineColumnEdits[NEW_COLUMN_KEY]?.primaryKey === true}
                              onChange={(e) => setDraftPrimaryKey(NEW_COLUMN_KEY, e.target.checked)}
                            />
                            {inlineColumnEdits[NEW_COLUMN_KEY]?.primaryKey === true ? "Yes" : ""}
                          </label>
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              style={buttonStyle}
                              onClick={() =>
                                runAction(
                                  () => addColumnFromDraft(inlineColumnEdits[NEW_COLUMN_KEY]),
                                  `Column ${String(inlineColumnEdits[NEW_COLUMN_KEY]?.newName || "").trim()} added.`
                                )
                              }
                            >
                              Save
                            </button>
                            <button
                              style={buttonStyle}
                              onClick={closeAddColumnRow}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {schemaRows.map((col) => (
                      <tr key={`schema-row-${col.column_name}`}>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
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
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              style={editingAllColumns ? { ...buttonStyle, ...disabledButtonStyle } : buttonStyle}
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
                              Delete
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
          <div
            style={{
              position: "sticky",
              bottom: 0,
              paddingTop: 8,
              marginTop: 4,
              borderTop: "1px solid var(--border)",
              background: "var(--bg-elev)",
              display: "flex",
              justifyContent: "flex-end",
              gap: 6,
            }}
          >
            <button
              style={canEditTable ? buttonStyle : { ...buttonStyle, ...disabledButtonStyle }}
              onClick={() => {
                setEditingTableName(true);
                setEditingAllColumns(true);
                setTimeout(() => {
                  if (!renameInputRef.current) return;
                  renameInputRef.current.focus();
                  renameInputRef.current.select?.();
                }, 0);
              }}
              disabled={!canEditTable}
            >
              Edit
            </button>
            <button
              style={selectedTable && (editingTableName || editingAllColumns) ? primaryButtonStyle : { ...primaryButtonStyle, ...disabledButtonStyle }}
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
            >
              Save
            </button>
            <button
              style={!selectedTable || (!editingTableName && !editingAllColumns) ? { ...buttonStyle, ...disabledButtonStyle } : buttonStyle}
              onClick={() => {
                setRenameTableTo(selectedTable || "");
                setEditingTableName(false);
                setEditingAllColumns(false);
                loadTableMeta(selectedTable);
              }}
              disabled={!selectedTable || (!editingTableName && !editingAllColumns)}
            >
              Cancel
            </button>
            <button
              style={canDeleteTable ? dangerButtonStyle : { ...dangerButtonStyle, ...disabledButtonStyle }}
              disabled={!canDeleteTable}
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
              Delete Table
            </button>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
