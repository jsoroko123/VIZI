import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

export default function DataBrowser() {
  const { table, id } = useParams();
  const navigate = useNavigate();
  const [tables, setTables] = useState([]);
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [primaryKey, setPrimaryKey] = useState(null);
  const [listFields, setListFields] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [formDraft, setFormDraft] = useState({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [typeMap, setTypeMap] = useState({});
  const [formEnabled, setFormEnabled] = useState(false);

  const tableList = useMemo(() => tables || [], [tables]);
  const currentTable = table || "";
  const detailId = id ? String(id) : "";
  const isNewDetail = detailId === "new";
  const tableTitle = currentTable
    ? currentTable
        .replace(/_/g, " ")
        .replace(/\b\w/g, (m) => m.toUpperCase())
    : "";
  const labelize = (value) =>
    String(value || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());

  const pageStyle = {
    position: "fixed",
    inset: 0,
    background:
      "radial-gradient(1200px 700px at 20% -10%, #eef2ff 0%, transparent 60%), radial-gradient(1000px 600px at 120% 0%, #e8f7ff 0%, transparent 55%), #f7f8fb",
    color: "#0b1220",
    overflow: "auto",
  };
  const shellStyle = {
    width: "100%",
    height: "100%",
    margin: 0,
    padding: "28px 28px 80px",
    boxSizing: "border-box",
  };
  const cardStyle = {
    background: "rgba(255,255,255,0.9)",
    border: "1px solid rgba(17, 24, 39, 0.08)",
    borderRadius: 16,
    padding: 16,
    boxShadow:
      "0 20px 40px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.7)",
    backdropFilter: "blur(6px)",
  };
  const headerStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  };
  const titlePillStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid rgba(43,108,255,0.25)",
    background: "rgba(43,108,255,0.08)",
    color: "#1f3b8a",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  };
  const sectionTitleStyle = {
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#475467",
    marginBottom: 10,
  };
  const subtleText = { fontSize: 12, color: "#667085" };
  const buttonBase = {
    border: "1px solid #d0d7e2",
    background: "white",
    color: "#0b1220",
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
    async function loadMeta() {
      if (!currentTable) return;
      setError("");
      setColumns([]);
      setRows([]);
      setPrimaryKey(null);
      setListFields([]);
      setSelectedId(null);
      setDetail(null);
      setTypeMap({});
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
        const res = await fetch(`/api/db/${currentTable}?limit=100`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load rows.");
        setRows(data.rows || []);
        if (data.primaryKey) setPrimaryKey(data.primaryKey);
        if (Array.isArray(data.listFields)) setListFields(data.listFields);
      } catch (err) {
        setError(err?.message || "Failed to load rows.");
      }
    }
    loadRows();
  }, [currentTable]);

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
      const res = await fetch(`/api/db/${currentTable}?limit=100`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load rows.");
      setRows(data.rows || []);
      if (data.primaryKey) setPrimaryKey(data.primaryKey);
      if (Array.isArray(data.listFields)) setListFields(data.listFields);
    } catch (err) {
      setError(err?.message || "Failed to load rows.");
    }
  }

  async function saveRow() {
    if (!currentTable) return;
    setError("");
    const payload = buildPayload(formDraft);
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
      const res = await fetch(`/api/db/${currentTable}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ list_fields: listFields }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save list config.");
      setStatus("List fields saved.");
    } catch (err) {
      setError(err?.message || "Failed to save list config.");
    }
  }

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <div style={headerStyle}>
          <div style={titlePillStyle}>Data</div>
          {currentTable && (
            <div style={{ fontSize: 12, color: "#667085" }}>{tableTitle}</div>
          )}
        </div>

        {error && <div style={{ marginBottom: 12, color: "#b42318" }}>{error}</div>}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gridTemplateRows: "minmax(160px, 20%) 16px minmax(420px, 1fr)",
            rowGap: 18,
            minHeight: "calc(100vh - 120px)",
          }}
        >
          <div style={{ ...cardStyle, height: "100%" }}>
            <div style={sectionTitleStyle}>Tables</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "stretch" }}>
              {tableList.map((t) => (
                <button
                  key={t}
                  onClick={() => navigate(`/data/${t}`)}
                  style={{
                    textAlign: "left",
                    border: "1px solid #e4e7ec",
                    background: t === currentTable ? "#eef4ff" : "white",
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
                <div style={{ color: "#98a2b3", fontSize: 12 }}>No tables found.</div>
              )}
            </div>
          </div>

          <div
            style={{
              height: 1,
              background: "rgba(17, 24, 39, 0.12)",
              margin: "0 8px",
            }}
          />

          {detailId ? (
            <div style={{ ...cardStyle, minHeight: 420 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={sectionTitleStyle}>Details</div>
                <button onClick={() => navigate(`/data/${currentTable}`)} style={ghostButton}>
                  Back to List
                </button>
              </div>
              {!currentTable ? (
                <div style={{ color: "#98a2b3", fontSize: 12 }}>Select a table to begin.</div>
              ) : (
                <>
                  <div style={{ display: "grid", gap: 6 }}>
                    {columns.map((c) => (
                      <label
                        key={`form-${c.column_name}`}
                        style={{
                          display: "grid",
                          gap: 4,
                          fontSize: 12,
                          color: "#475467",
                        }}
                      >
                        {labelize(c.column_name)}
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
                            border: "1px solid #d0d7e2",
                            borderRadius: 8,
                            padding: "6px 8px",
                            fontSize: 12,
                            outline: "none",
                            background: formEnabled ? "white" : "#f8fafc",
                          }}
                        />
                      </label>
                    ))}
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
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
                        background: formEnabled ? "white" : "#f2f4f7",
                        color: formEnabled ? "#0b1220" : "#98a2b3",
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
                        color: formEnabled ? "white" : "#667085",
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
                        color: detail ? "#2b6cff" : "#98a2b3",
                        border: "1px solid rgba(43,108,255,0.35)",
                        background: detail ? "white" : "#f2f4f7",
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
                        color: selectedId ? "white" : "#98a2b3",
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
            <div style={{ ...cardStyle, minHeight: 420 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={sectionTitleStyle}>{tableTitle || "No Table Selected"}</div>
                {currentTable ? (
                  <button
                    onClick={() => {
                      navigate(`/data/${currentTable}/new`);
                    }}
                    style={primaryButton}
                  >
                    New
                  </button>
                ) : null}
              </div>
              {!currentTable ? (
                <div style={{ color: "#98a2b3", fontSize: 12, marginTop: 8 }}>
                  Select a table to view rows.
                </div>
              ) : (
                <>
                  {status && <div style={{ marginBottom: 8, fontSize: 12, color: "#12b76a" }}>{status}</div>}
                  {columns.length > 0 && (
                    <div style={{ marginBottom: 8, ...subtleText }}>
                      List fields:
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {columns.map((c) => {
                          const checked = listFields.includes(c.column_name);
                          return (
                            <label
                              key={`list-field-${c.column_name}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                border: "1px solid #e4e7ec",
                                borderRadius: 999,
                                padding: "2px 8px",
                                background: checked ? "#eef4ff" : "white",
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
                  <div style={{ overflow: "auto", maxHeight: 520 }}>
                    {rows.length === 0 ? (
                      <div style={{ color: "#98a2b3", fontSize: 12 }}>No rows.</div>
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
                            {(listFields.length
                              ? listFields
                              : primaryKey
                                ? [primaryKey]
                                : Object.keys(rows[0] || {}).slice(0, 2)
                            ).map((f) => (
                              <th
                                key={`head-${f}`}
                                style={{
                                  textAlign: "left",
                                  padding: "6px 8px",
                                  borderBottom: "1px solid #e4e7ec",
                                  color: "#667085",
                                  position: "sticky",
                                  top: 0,
                                  background: "#fff",
                                  zIndex: 1,
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
                            const fields = listFields.length
                              ? listFields
                              : primaryKey
                                ? [primaryKey]
                                : Object.keys(r || {}).slice(0, 2);
                            return (
                              <tr
                                key={`${rowId}-${i}`}
                                onClick={() => navigate(`/data/${currentTable}/${rowId}`)}
                                style={{
                                  background: "white",
                                  cursor: "pointer",
                                }}
                              >
                                {fields.map((f) => (
                                  <td
                                    key={`${rowId}-${f}`}
                                    style={{
                                      padding: "6px 8px",
                                      borderBottom: "1px solid #eef2f6",
                                      color: "#111",
                                      whiteSpace: "nowrap",
                                      maxWidth: 200,
                                      textOverflow: "ellipsis",
                                      overflow: "hidden",
                                      width: fields[0] === f ? 100 : undefined,
                                    }}
                                  >
                                    {r?.[f] != null ? String(r[f]) : ""}
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
