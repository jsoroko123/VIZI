import { useMemo, useState } from "react";

function extractAttr(attrText, name) {
  if (!attrText) return "";
  const re = new RegExp(`\\b${name}="([^"]*)"`, "i");
  const m = attrText.match(re);
  return m ? String(m[1] || "").trim() : "";
}

function scanNamedElements(xmlText, elementName, maxNames = 8) {
  const out = { count: 0, names: [] };
  const re = new RegExp(`<${elementName}\\b([^>]*)>`, "gi");
  let match = re.exec(xmlText);
  while (match) {
    out.count += 1;
    if (out.names.length < maxNames) {
      const name = extractAttr(match[1], "Name");
      if (name) out.names.push(name);
    }
    match = re.exec(xmlText);
  }
  return out;
}

function formatBytes(n) {
  const size = Number(n);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function analyzeL5x(xmlText) {
  const rootMatch = xmlText.match(/<RSLogix5000Content\b([^>]*)>/i);
  const controllerMatch = xmlText.match(/<Controller\b([^>]*)>/i);
  const rootAttrs = rootMatch ? rootMatch[1] : "";
  const controllerAttrs = controllerMatch ? controllerMatch[1] : "";
  const sections = [
    { label: "Tasks", key: "Task" },
    { label: "Programs", key: "Program" },
    { label: "Routines", key: "Routine" },
    { label: "Controller Tags", key: "Tag" },
    { label: "Modules", key: "Module" },
    { label: "AOIs", key: "AddOnInstructionDefinition" },
    { label: "Data Types", key: "DataType" },
  ].map((s) => ({ ...s, ...scanNamedElements(xmlText, s.key) }));

  const parserError = xmlText.match(/<parsererror[\s>]/i);
  return {
    isLikelyL5x: /<RSLogix5000Content\b/i.test(xmlText),
    hasParserError: !!parserError,
    metadata: {
      schemaRevision: extractAttr(rootAttrs, "SchemaRevision"),
      softwareRevision: extractAttr(rootAttrs, "SoftwareRevision"),
      targetName: extractAttr(rootAttrs, "TargetName"),
      targetType: extractAttr(rootAttrs, "TargetType"),
      containsContext: extractAttr(rootAttrs, "ContainsContext"),
      owner: extractAttr(rootAttrs, "Owner"),
      exportDate: extractAttr(rootAttrs, "ExportDate"),
      controllerName: extractAttr(controllerAttrs, "Name"),
      processorType: extractAttr(controllerAttrs, "ProcessorType"),
      majorRev: extractAttr(controllerAttrs, "MajorRev"),
      minorRev: extractAttr(controllerAttrs, "MinorRev"),
      projectCreationDate: extractAttr(controllerAttrs, "ProjectCreationDate"),
      lastModifiedDate: extractAttr(controllerAttrs, "LastModifiedDate"),
    },
    sections,
  };
}

export default function PlcAnalyzer({ plcItems = [], onChange }) {
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => {
    const list = Array.isArray(plcItems) ? plcItems : [];
    if (!list.length) return null;
    const exact = list.find((x) => String(x?.id) === String(selectedId));
    return exact || list[0];
  }, [plcItems, selectedId]);

  const analysis = selected?.analysis || null;

  const commit = (next) => {
    if (typeof onChange === "function") onChange(next);
  };

  const onFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const rawText = String(text || "");
      const analysis = analyzeL5x(rawText);
      const id = `plc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next = [
        ...(Array.isArray(plcItems) ? plcItems : []),
        {
          id,
          name: String(file.name || "PLC"),
          size: Number(file.size) || 0,
          uploadedAt: Date.now(),
          rawText,
          analysis,
        },
      ];
      commit(next);
      setSelectedId(id);
    } catch {
      setError("Failed to read file.");
    }
    event.target.value = "";
  };

  const onDelete = (id) => {
    const next = (Array.isArray(plcItems) ? plcItems : []).filter((x) => String(x?.id) !== String(id));
    commit(next);
    if (String(selectedId) === String(id)) setSelectedId("");
  };

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 12, boxSizing: "border-box", display: "grid", gap: 8 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>PLC L5X Analyzer</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Upload an <code>.l5x</code> file to scan controller metadata, tags, programs, routines, modules, and AOIs.
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <label
          style={{
            border: "1px solid #2b6cff",
            background: "#2b6cff",
            color: "#fff",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          Upload L5X
          <input type="file" accept=".l5x,.xml,text/xml,application/xml" onChange={onFileChange} style={{ display: "none" }} />
        </label>
        {selected ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--text)" }}>{selected.name}</strong> ({formatBytes(selected.size)})
          </div>
        ) : null}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", overflow: "hidden" }}>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 12 }}>
          PLC Files ({Array.isArray(plcItems) ? plcItems.length : 0})
        </div>
        <div style={{ display: "grid", gap: 0, maxHeight: 160, overflow: "auto" }}>
          {(Array.isArray(plcItems) ? plcItems : []).length ? (
            (plcItems || []).map((item) => {
              const isActive = String(item?.id) === String(selected?.id || "");
              return (
                <div
                  key={item.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "6px 10px",
                    borderTop: "1px solid var(--border)",
                    background: isActive ? "color-mix(in srgb, #2b6cff 14%, var(--bg-elev))" : "transparent",
                  }}
                >
                  <button
                    type="button"
                    data-preserve-style="true"
                    onClick={() => setSelectedId(String(item.id))}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--text)",
                      textAlign: "left",
                      padding: 0,
                      cursor: "pointer",
                      display: "grid",
                      gap: 1,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{item.name || "PLC"}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{formatBytes(item.size)}</span>
                  </button>
                  <button
                    type="button"
                    data-preserve-style="true"
                    onClick={() => onDelete(item.id)}
                    style={{
                      border: "1px solid #f04438",
                      background: "#f04438",
                      color: "#fff",
                      borderRadius: 8,
                      padding: "3px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              );
            })
          ) : (
            <div style={{ padding: "10px", fontSize: 12, color: "var(--text-muted)" }}>No PLC files uploaded.</div>
          )}
        </div>
      </div>

      {error ? (
        <div style={{ border: "1px solid #f04438", background: "rgba(240,68,56,0.08)", color: "#f04438", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
          {error}
        </div>
      ) : null}

      {analysis ? (
        <>
          {!analysis.isLikelyL5x ? (
            <div style={{ border: "1px solid #f59e0b", background: "rgba(245,158,11,0.08)", color: "#f59e0b", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
              This file does not look like an L5X export (`RSLogix5000Content` not found), but scan results are shown.
            </div>
          ) : null}
          {analysis.hasParserError ? (
            <div style={{ border: "1px solid #f59e0b", background: "rgba(245,158,11,0.08)", color: "#f59e0b", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
              XML parser hints that this file may be malformed; counts may be incomplete.
            </div>
          ) : null}

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", overflow: "hidden" }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 12 }}>
              Metadata
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 6, padding: 10 }}>
              {Object.entries({
                "Controller Name": analysis.metadata.controllerName,
                "Processor Type": analysis.metadata.processorType,
                "Major/Minor Rev": [analysis.metadata.majorRev, analysis.metadata.minorRev].filter(Boolean).join("."),
                "Target Name": analysis.metadata.targetName,
                "Target Type": analysis.metadata.targetType,
                "Software Revision": analysis.metadata.softwareRevision,
                "Schema Revision": analysis.metadata.schemaRevision,
                "Contains Context": analysis.metadata.containsContext,
                "Owner": analysis.metadata.owner,
                "Export Date": analysis.metadata.exportDate,
                "Project Created": analysis.metadata.projectCreationDate,
                "Last Modified": analysis.metadata.lastModifiedDate,
              }).map(([k, v]) => (
                <div key={k} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", background: "var(--bg-soft)" }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, marginTop: 2, color: "var(--text)" }}>{v || "-"}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", overflow: "hidden" }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 12 }}>
              Scan Summary
            </div>
            <div style={{ display: "grid", gap: 0 }}>
              {analysis.sections.map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "180px 64px 1fr",
                    gap: 6,
                    alignItems: "start",
                    padding: "8px 10px",
                    borderTop: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{row.label}</div>
                  <div style={{ color: "var(--text-muted)" }}>{row.count}</div>
                  <div style={{ color: "var(--text-muted)", wordBreak: "break-word" }}>
                    {row.names.length ? row.names.join(", ") : "-"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
          No file loaded.
        </div>
      )}
    </div>
  );
}
