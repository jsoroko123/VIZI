import { useEffect, useMemo, useState } from "react";
import { toastError, toastSuccess } from "../utils/toast";

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

function blankColumn() {
  return { name: "", type: "text", nullable: true, defaultValue: "", primaryKey: false };
}

export default function SqlDesigner({ embedded = false }) {
  const [tables, setTables] = useState([]);
  const [tableFilter, setTableFilter] = useState("");
  const [schemaCatalog, setSchemaCatalog] = useState({});
  const [selectedTable, setSelectedTable] = useState("");
  const [schemaRows, setSchemaRows] = useState([]);
  const [primaryKey, setPrimaryKey] = useState(null);
  const [foreignKeys, setForeignKeys] = useState({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [newTableName, setNewTableName] = useState("");
  const [newTableColumns, setNewTableColumns] = useState([blankColumn()]);

  const [renameTableTo, setRenameTableTo] = useState("");
  const [newColumn, setNewColumn] = useState({ name: "", type: "text", nullable: true, defaultValue: "" });
  const [updateColumnName, setUpdateColumnName] = useState("");
  const [updateColumnDraft, setUpdateColumnDraft] = useState({
    newName: "",
    type: "",
    nullable: true,
    defaultValue: "",
  });
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

  const inputStyle = {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-soft)",
    color: "var(--text)",
    padding: "6px 8px",
    fontSize: 12,
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
      if (!names.length) {
        setError("No tables found.");
      } else {
        setError("");
      }
    } catch (err) {
      setError(String(err?.message || "Failed to load schema."));
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
      setUpdateColumnName((prev) => {
        if (prev && cols.some((c) => c?.column_name === prev)) return prev;
        return cols[0]?.column_name || "";
      });
    } catch (err) {
      setError(String(err?.message || "Failed to load table metadata."));
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
    const row = schemaRows.find((r) => r?.column_name === updateColumnName);
    if (!row) {
      setUpdateColumnDraft({ newName: "", type: "", nullable: true, defaultValue: "" });
      return;
    }
    setUpdateColumnDraft({
      newName: String(row.column_name || ""),
      type: String(row.data_type || ""),
      nullable: String(row.is_nullable || "").toUpperCase() === "YES",
      defaultValue: row.column_default == null ? "" : String(row.column_default),
    });
  }, [updateColumnName, schemaRows]);

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
      };
    });
    setInlineColumnEdits(next);
  }, [schemaRows]);

  async function runAction(fn, successMessage) {
    setError("");
    setStatus("");
    try {
      await fn();
      setStatus(successMessage);
      toastSuccess(successMessage);
      await loadTables();
      await loadTableMeta(selectedTable);
    } catch (err) {
      const msg = String(err?.message || "Operation failed.");
      setError(msg);
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
    setNewTableColumns([blankColumn()]);
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

  async function addColumn() {
    if (!selectedTable) throw new Error("Select a table first.");
    const res = await fetch(`/api/db/designer/table/${encodeURIComponent(selectedTable)}/column`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(newColumn.name || "").trim(),
        type: String(newColumn.type || "").trim(),
        nullable: newColumn.nullable !== false,
        defaultValue: String(newColumn.defaultValue || "").trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Failed to add column."));
    setNewColumn({ name: "", type: "text", nullable: true, defaultValue: "" });
  }

  async function updateColumn() {
    if (!selectedTable) throw new Error("Select a table first.");
    if (!updateColumnName) throw new Error("Select a column first.");
    const res = await fetch(
      `/api/db/designer/table/${encodeURIComponent(selectedTable)}/column/${encodeURIComponent(updateColumnName)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newName: String(updateColumnDraft.newName || "").trim(),
          type: String(updateColumnDraft.type || "").trim(),
          nullable: updateColumnDraft.nullable !== false,
          defaultValue: String(updateColumnDraft.defaultValue || "").trim(),
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Failed to update column."));
    setUpdateColumnName(String(updateColumnDraft.newName || updateColumnName));
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
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(String(data?.error || "Failed to update column."));
    if (updateColumnName === baseName) {
      setUpdateColumnName(String(draft.newName || baseName));
    }
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
        padding: embedded ? 12 : 16,
        boxSizing: "border-box",
        background: "var(--bg-soft)",
        color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>SQL Designer</div>
        <button style={buttonStyle} onClick={loadTables}>Refresh</button>
      </div>
      {error ? (
        <div style={{ ...cardStyle, marginBottom: 10, borderColor: "#f04438", color: "#b42318" }}>{error}</div>
      ) : null}
      {status ? (
        <div style={{ ...cardStyle, marginBottom: 10, borderColor: "#12b76a", color: "#067647" }}>{status}</div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr)", gap: 10, minHeight: 0 }}>
        <div style={{ ...cardStyle, display: "grid", gap: 6, alignContent: "start", minHeight: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>
            Tables ({tables.length})
          </div>
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
                  borderColor: selectedTable === t ? "#2b6cff" : "var(--border)",
                  background: selectedTable === t ? "#2b6cff" : "var(--bg-soft)",
                  color: selectedTable === t ? "#ffffff" : "var(--text)",
                  boxShadow: selectedTable === t ? "0 0 0 1px rgba(43,108,255,0.35), 0 6px 14px rgba(43,108,255,0.22)" : "none",
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

        <div style={{ display: "grid", gap: 10 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Create Table</div>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                style={inputStyle}
                value={newTableName}
                placeholder="table_name"
                onChange={(e) => setNewTableName(e.target.value)}
              />
              {newTableColumns.map((col, idx) => (
                <div key={`new-col-${idx}`} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr auto auto auto auto", gap: 6 }}>
                  <input
                    style={inputStyle}
                    value={col.name}
                    placeholder="column_name"
                    onChange={(e) =>
                      setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))
                    }
                  />
                  <select
                    style={inputStyle}
                    value={col.type}
                    onChange={(e) =>
                      setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, type: e.target.value } : r)))
                    }
                  >
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    style={inputStyle}
                    value={col.defaultValue}
                    placeholder="default"
                    onChange={(e) =>
                      setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, defaultValue: e.target.value } : r)))
                    }
                  />
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={col.nullable}
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
                      onChange={(e) =>
                        setNewTableColumns((prev) => prev.map((r, i) => (i === idx ? { ...r, primaryKey: e.target.checked } : r)))
                      }
                    />
                    PK
                  </label>
                  <button
                    style={buttonStyle}
                    onClick={() => setNewTableColumns((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={newTableColumns.length <= 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6 }}>
                <button style={buttonStyle} onClick={() => setNewTableColumns((prev) => [...prev, blankColumn()])}>Add Column</button>
                <button style={primaryButtonStyle} onClick={() => runAction(createTable, "Table created.")}>Create Table</button>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Update Table</div>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                <input
                  style={inputStyle}
                  value={renameTableTo}
                  placeholder="new_table_name"
                  onChange={(e) => setRenameTableTo(e.target.value)}
                />
                <button style={buttonStyle} onClick={() => runAction(renameTable, "Table renamed.")} disabled={!selectedTable}>
                  Rename Table
                </button>
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Add Column</div>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr auto auto", gap: 6 }}>
                  <input
                    style={inputStyle}
                    value={newColumn.name}
                    placeholder="column_name"
                    onChange={(e) => setNewColumn((prev) => ({ ...prev, name: e.target.value }))}
                  />
                  <select
                    style={inputStyle}
                    value={newColumn.type}
                    onChange={(e) => setNewColumn((prev) => ({ ...prev, type: e.target.value }))}
                  >
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <input
                    style={inputStyle}
                    value={newColumn.defaultValue}
                    placeholder="default"
                    onChange={(e) => setNewColumn((prev) => ({ ...prev, defaultValue: e.target.value }))}
                  />
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={newColumn.nullable}
                      onChange={(e) => setNewColumn((prev) => ({ ...prev, nullable: e.target.checked }))}
                    />
                    Nullable
                  </label>
                  <button style={buttonStyle} onClick={() => runAction(addColumn, "Column added.")} disabled={!selectedTable}>
                    Add
                  </button>
                </div>
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Update Column</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto auto", gap: 6 }}>
                  <select
                    style={inputStyle}
                    value={updateColumnName}
                    onChange={(e) => setUpdateColumnName(e.target.value)}
                  >
                    <option value="">Select column</option>
                    {tableColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input
                    style={inputStyle}
                    value={updateColumnDraft.newName}
                    placeholder="new_name"
                    onChange={(e) => setUpdateColumnDraft((prev) => ({ ...prev, newName: e.target.value }))}
                  />
                  <input
                    style={inputStyle}
                    value={updateColumnDraft.type}
                    placeholder="type (optional)"
                    onChange={(e) => setUpdateColumnDraft((prev) => ({ ...prev, type: e.target.value }))}
                  />
                  <input
                    style={inputStyle}
                    value={updateColumnDraft.defaultValue}
                    placeholder="default (blank clears)"
                    onChange={(e) => setUpdateColumnDraft((prev) => ({ ...prev, defaultValue: e.target.value }))}
                  />
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={updateColumnDraft.nullable}
                      onChange={(e) => setUpdateColumnDraft((prev) => ({ ...prev, nullable: e.target.checked }))}
                    />
                    Nullable
                  </label>
                  <button style={buttonStyle} onClick={() => runAction(updateColumn, "Column updated.")} disabled={!selectedTable || !updateColumnName}>
                    Update
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Connect Tables (Foreign Key)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr auto", gap: 6 }}>
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
              <button style={primaryButtonStyle} onClick={() => runAction(connectTables, "Relationship created.")}>
                Connect
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginTop: 6 }}>
              <input
                style={inputStyle}
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
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Selected Table Schema (Inline Editable)</div>
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
                    {schemaRows.map((col) => (
                      <tr key={`schema-row-${col.column_name}`}>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                          <input
                            style={{ ...inputStyle, width: "100%" }}
                            value={inlineColumnEdits[col.column_name]?.newName || ""}
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
                          <input
                            style={{ ...inputStyle, width: "100%" }}
                            value={inlineColumnEdits[col.column_name]?.type || ""}
                            onChange={(e) =>
                              setInlineColumnEdits((prev) => ({
                                ...prev,
                                [col.column_name]: {
                                  ...(prev[col.column_name] || {}),
                                  type: e.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={inlineColumnEdits[col.column_name]?.nullable !== false}
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
                          {primaryKey && primaryKey === col.column_name ? "Yes" : ""}
                        </td>
                        <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                          <button
                            style={buttonStyle}
                            onClick={() =>
                              runAction(
                                () => saveInlineColumn(col.column_name),
                                `Column ${String(inlineColumnEdits[col.column_name]?.newName || col.column_name)} updated.`
                              )
                            }
                          >
                            Save
                          </button>
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
        </div>
      </div>
    </div>
  );
}
