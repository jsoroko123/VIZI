import { useEffect, useMemo, useRef, useState } from "react";
import defaultReportLogo from "../assets/Images/logo.png";
import SearchableSelect from "./SearchableSelect";
import { toastError, toastSuccess } from "../utils/toast";
import "./ReportDesigner.css";

const LAYOUT_KEY = "vizi_report_designer_layouts_v1";
const DATASET_LAYOUT_ID = "__dataset_builder__";
const DEFAULT_REPORT_LOGO = defaultReportLogo;
const DEFAULT_LOGO_KEY = "vizi_report_default_logo_v1";
const TEXT_FONTS = [
  "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  "Arial, Helvetica, sans-serif",
  "Georgia, Times New Roman, serif",
  "Trebuchet MS, Verdana, sans-serif",
  "Courier New, monospace",
];
const PAPER_SIZES = {
  letter: { label: "Letter (8.5 x 11 in)", width: 816, height: 1056 },
  legal: { label: "Legal (8.5 x 14 in)", width: 816, height: 1344 },
  a4: { label: "A4 (210 x 297 mm)", width: 794, height: 1123 },
  a3: { label: "A3 (297 x 420 mm)", width: 1123, height: 1587 },
};
const TABLE_FILTER_OPERATORS = [
  { value: "=", label: "=" },
  { value: "!=", label: "!=" },
  { value: ">", label: ">" },
  { value: ">=", label: ">=" },
  { value: "<", label: "<" },
  { value: "<=", label: "<=" },
  { value: "like", label: "LIKE" },
  { value: "ilike", label: "ILIKE" },
  { value: "is_null", label: "IS NULL" },
  { value: "is_not_null", label: "IS NOT NULL" },
];

function parseJsonSafe(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
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
    if (!labelsByIndex[idx]) labelsByIndex[idx] = field || `param_${idx}`;
  }
  return labelsByIndex;
}

function renderCell(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function Icon({ children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function toDisplayLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const spaced = text
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  return spaced
    .split(" ")
    .map((w) => {
      if (!w) return w;
      if (/^(id|api|opc|sql|url|ua|plc)$/i.test(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function sanitizeFileName(value, fallback = "report") {
  const text = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_");
  return text || fallback;
}

function nextDatasetName(existingNames, preferred) {
  const base = String(preferred || "Dataset").trim() || "Dataset";
  const set = new Set((Array.isArray(existingNames) ? existingNames : []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean));
  if (!set.has(base.toLowerCase())) return base;
  let i = 2;
  while (set.has(`${base} ${i}`.toLowerCase())) i += 1;
  return `${base} ${i}`;
}

function normalizeEditorTab(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "datasets" || v === "tables" || v === "text" ? v : "design";
}

export default function ReportDesigner({
  initialEditorTab = "design",
  lockEditorTab = false,
  hideTopTabs = false,
  embedded = false,
  datasetOnly = false,
  titleOverride = "",
  hideEditorTitle = false,
}) {
  function readDefaultLogo() {
    try {
      const stored = String(window.localStorage.getItem(DEFAULT_LOGO_KEY) || "").trim();
      return stored || DEFAULT_REPORT_LOGO;
    } catch {
      return DEFAULT_REPORT_LOGO;
    }
  }

  function writeDefaultLogo(nextLogo) {
    try {
      const value = String(nextLogo || "").trim() || DEFAULT_REPORT_LOGO;
      window.localStorage.setItem(DEFAULT_LOGO_KEY, value);
    } catch {
      // ignore storage errors
    }
  }

  const [reports, setReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [sourceMode, setSourceMode] = useState("table");
  const [dbTables, setDbTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableColumns, setTableColumns] = useState([]);
  const [selectedColumns, setSelectedColumns] = useState({});
  const [tableFilters, setTableFilters] = useState([]);
  const [tableGroupByColumns, setTableGroupByColumns] = useState([]);
  const [foreignKeysByTable, setForeignKeysByTable] = useState({});
  const [tableLimit, setTableLimit] = useState(100);
  const [routines, setRoutines] = useState([]);
  const [selectedRoutineOid, setSelectedRoutineOid] = useState("");
  const [routineArgs, setRoutineArgs] = useState([]);
  const [activeReportId, setActiveReportId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sql, setSql] = useState("");
  const [headerText, setHeaderText] = useState("Production Report");
  const [subHeaderText, setSubHeaderText] = useState("");
  const [footerText, setFooterText] = useState("Generated by Mesora");
  const [reportTimestamp, setReportTimestamp] = useState(() => new Date().toLocaleString());
  const [signatureEnabled, setSignatureEnabled] = useState(false);
  const [signatureLabel, setSignatureLabel] = useState("Signature");
  const [signatureName, setSignatureName] = useState("");
  const [signatureAlign, setSignatureAlign] = useState("right");
  const [signatureLineWidth, setSignatureLineWidth] = useState(220);
  const [headerFormat, setHeaderFormat] = useState({
    align: "left",
    variant: "plain",
  });
  const [textStyles, setTextStyles] = useState({
    header: { fontSize: 28, color: "#111827", fontFamily: TEXT_FONTS[0] },
    subHeader: { fontSize: 13, color: "#475467", fontFamily: TEXT_FONTS[0] },
    description: { fontSize: 12, color: "#667085", fontFamily: TEXT_FONTS[0] },
    footer: { fontSize: 12, color: "#667085", fontFamily: TEXT_FONTS[0] },
  });
  const [selectedTextKey, setSelectedTextKey] = useState("header");
  const [selectedPreviewTextKey, setSelectedPreviewTextKey] = useState("");
  const [logoSrc, setLogoSrc] = useState(() => readDefaultLogo());
  const [logoWidth, setLogoWidth] = useState(170);
  const [logoSelected, setLogoSelected] = useState(false);
  const [namedFilters, setNamedFilters] = useState({});
  const [positionalFilters, setPositionalFilters] = useState([]);
  const [columns, setColumns] = useState([]);
  const [columnLabels, setColumnLabels] = useState({});
  const [rows, setRows] = useState([]);
  const [summaryRow, setSummaryRow] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [datasetDraftName, setDatasetDraftName] = useState("");
  const [datasetEditing, setDatasetEditing] = useState(false);
  const [selectedTextDatasetId, setSelectedTextDatasetId] = useState("");
  const [selectedTextDatasetColumn, setSelectedTextDatasetColumn] = useState("");
  const [textWidgets, setTextWidgets] = useState([]);
  const [selectedTextWidgetId, setSelectedTextWidgetId] = useState("");
  const [tableWidgets, setTableWidgets] = useState([]);
  const [selectedWidgetId, setSelectedWidgetId] = useState("");
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [editorWidth, setEditorWidth] = useState(380);
  const [paperSize, setPaperSize] = useState("letter");
  const [paperOrientation, setPaperOrientation] = useState("portrait");
  const [previewZoom, setPreviewZoom] = useState(100);
  const [pagePadding, setPagePadding] = useState(24);
  const [designerReady, setDesignerReady] = useState(() => datasetOnly);
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const [editorTab, setEditorTab] = useState(() =>
    normalizeEditorTab(datasetOnly ? "datasets" : initialEditorTab)
  );
  const [layoutWidgetsTab, setLayoutWidgetsTab] = useState("tables");
  const tabBtnClass = (isActive) => `rd-tab-btn${isActive ? " is-active" : ""}`;
  const autoPreviewTimerRef = useRef(null);
  const previewRequestSeqRef = useRef(0);
  const foreignMetaFetchRef = useRef(new Set());
  const resizeRef = useRef(null);
  const logoResizeRef = useRef(null);
  const textResizeRef = useRef(null);
  const textWidgetDragRef = useRef(null);
  const textStylesRef = useRef(textStyles);
  const tableDragRef = useRef(null);
  const tableResizeRef = useRef(null);
  const previewLayoutRef = useRef(null);
  const reportPrintRef = useRef(null);
  const tableWidgetsRef = useRef([]);
  const datasetsSectionRef = useRef(null);

  useEffect(() => {
    if (!lockEditorTab && !datasetOnly) return;
    const locked = normalizeEditorTab(datasetOnly ? "datasets" : initialEditorTab);
    if (editorTab !== locked) setEditorTab(locked);
  }, [lockEditorTab, datasetOnly, initialEditorTab, editorTab]);

  const rootStyle = embedded
    ? {
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--bg-elev)",
        color: "var(--text)",
        overflow: "hidden",
        padding: 10,
        boxSizing: "border-box",
        fontFamily: "system-ui, Avenir, Helvetica, Arial, sans-serif",
      }
    : {
        position: "fixed",
        inset: 0,
        background: "var(--bg-elev)",
        color: "var(--text)",
        overflow: "hidden",
        fontFamily: "system-ui, Avenir, Helvetica, Arial, sans-serif",
      };
  const editorTitle = String(titleOverride || "").trim() || (datasetOnly ? "Dataset Builder" : "Report Designer");
  const workspaceColumns = datasetOnly ? "1fr" : `${editorWidth}px 8px 1fr`;
  const compactDatasetLayout = datasetOnly;
  const datasetGap = compactDatasetLayout ? 10 : 8;
  const datasetControlPadding = compactDatasetLayout ? "8px 10px" : "8px 10px";
  const datasetToolbarButtonStyle = {
    border: "1px solid var(--border)",
    background: "var(--bg-soft)",
    color: "var(--text)",
    borderRadius: 8,
    width: 32,
    minWidth: 32,
    height: 30,
    padding: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  };
  const datasetToolbarPrimaryButtonStyle = {
    ...datasetToolbarButtonStyle,
    border: "1px solid #12b76a",
    background: "#12b76a",
    color: "white",
  };
  const datasetToolbarDangerButtonStyle = {
    ...datasetToolbarButtonStyle,
    border: "1px solid #f04438",
    background: "#f04438",
    color: "white",
  };
  const datasetToolbarDisabledStyle = {
    opacity: 0.55,
    cursor: "not-allowed",
  };
  const datasetReadOnly = Boolean(selectedDatasetId) && !datasetEditing;
  const canDatasetEdit = Boolean(selectedDatasetId) && !datasetEditing;
  const canDatasetSave = !running && (!selectedDatasetId || datasetEditing);
  const canDatasetCancel = datasetEditing;
  const canDatasetDelete = Boolean(selectedDatasetId) && !datasetEditing;

  const activeReport = useMemo(
    () => reports.find((r) => String(r.id) === String(activeReportId || "")) || null,
    [reports, activeReportId]
  );

  const filterNames = useMemo(() => extractFilterNames(sql), [sql]);
  const positionalCount = useMemo(() => extractPositionalParamCount(sql), [sql]);
  const positionalLabels = useMemo(() => extractPositionalParamLabels(sql), [sql]);
  const selectedRoutine = useMemo(
    () => routines.find((r) => String(r.oid) === String(selectedRoutineOid || "")) || null,
    [routines, selectedRoutineOid]
  );
  const effectiveLogoSrc = useMemo(() => {
    const raw = String(logoSrc || "").trim();
    return raw || DEFAULT_REPORT_LOGO;
  }, [logoSrc]);
  const selectedDataset = useMemo(
    () => (Array.isArray(datasets) ? datasets : []).find((d) => String(d?.id || "") === String(selectedDatasetId || "")) || null,
    [datasets, selectedDatasetId]
  );
  const datasetPreviewColumns = useMemo(() => {
    if (Array.isArray(selectedDataset?.columns) && selectedDataset.columns.length) {
      return selectedDataset.columns.map((c) => String(c)).filter(Boolean);
    }
    return Array.isArray(columns) ? columns.map((c) => String(c)).filter(Boolean) : [];
  }, [selectedDataset, columns]);
  const datasetPreviewRows = useMemo(() => {
    if (Array.isArray(selectedDataset?.rows) && selectedDataset.rows.length) {
      return selectedDataset.rows;
    }
    return Array.isArray(rows) ? rows : [];
  }, [selectedDataset, rows]);
  const selectedTextDataset = useMemo(
    () => (Array.isArray(datasets) ? datasets : []).find((d) => String(d?.id || "") === String(selectedTextDatasetId || "")) || null,
    [datasets, selectedTextDatasetId]
  );
  const selectedTextDatasetColumns = useMemo(() => {
    if (!Array.isArray(selectedTextDataset?.columns)) return [];
    return selectedTextDataset.columns.map((c) => String(c)).filter(Boolean);
  }, [selectedTextDataset]);

  function applyDatasetToDraft(dataset) {
    const ds = dataset && typeof dataset === "object" ? dataset : null;
    if (!ds) return;
    const source = ds.source && typeof ds.source === "object" ? ds.source : null;
    if (!source) return;
    const sourceModeValue =
      String(source.mode || "") === "table"
        ? "table"
        : String(source.mode || "") === "routine"
          ? "routine"
          : "sql";
    setSourceMode(sourceModeValue);
    setSelectedTable(String(source.table || ""));
    setSelectedColumns(
      source.selectedColumns && typeof source.selectedColumns === "object" ? source.selectedColumns : {}
    );
    setTableFilters(Array.isArray(source.tableFilters) ? source.tableFilters : []);
    setTableGroupByColumns(
      Array.isArray(source.groupByColumns)
        ? source.groupByColumns.map((c) => String(c || "")).filter(Boolean)
        : []
    );
    setTableLimit(Math.min(1000, Math.max(1, Number(source.limit) || 100)));
    setSql(String(source.sql || ""));
    setSelectedRoutineOid(String(source.routineOid || ""));
    setRoutineArgs(Array.isArray(source.routineArgs) ? source.routineArgs : []);
    setColumns(Array.isArray(ds.columns) ? ds.columns.map((c) => String(c || "")).filter(Boolean) : []);
    setRows(Array.isArray(ds.rows) ? ds.rows : []);
    setSummaryRow(ds?.summaryRow ?? null);
  }

  function createDefaultTextWidget() {
    return {
      id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label: "Text Field",
      value: "Text",
      datasetId: "",
      column: "",
      x: 24,
      y: 24,
      fontSize: 14,
      fontFamily: TEXT_FONTS[0],
      color: "#111827",
      isHeaderField: false,
    };
  }

  function normalizeTextWidget(raw) {
    const widget = raw && typeof raw === "object" ? raw : {};
    return {
      id: String(widget.id || `txt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      label: String(widget.label || "Text Field"),
      value: String(widget.value || "Text"),
      datasetId: String(widget.datasetId || ""),
      column: String(widget.column || ""),
      x: Math.max(0, Number(widget.x) || 0),
      y: Math.max(0, Number(widget.y) || 0),
      fontSize: Math.min(72, Math.max(8, Number(widget.fontSize) || 14)),
      fontFamily: String(widget.fontFamily || TEXT_FONTS[0]),
      color: String(widget.color || "#111827"),
      isHeaderField: Boolean(widget.isHeaderField),
    };
  }

  useEffect(() => {
    if (selectedDataset) {
      setDatasetDraftName(String(selectedDataset.name || ""));
    } else if (!selectedDatasetId) {
      setDatasetDraftName("");
    }
  }, [selectedDataset, selectedDatasetId]);

  useEffect(() => {
    if (!selectedDatasetId || !selectedDataset) return;
    if (datasetEditing) return;
    applyDatasetToDraft(selectedDataset);
  }, [selectedDatasetId, selectedDataset, datasetEditing]);
  const reportFilterControls = useMemo(() => {
    const rows = [];
    (Array.isArray(tableWidgets) ? tableWidgets : []).forEach((tbl) => {
      const source = tbl?.source && typeof tbl.source === "object" ? tbl.source : {};
      if (String(source?.mode || "") !== "table") return;
      const filters = Array.isArray(source?.tableFilters) ? source.tableFilters : [];
      filters.forEach((f, filterIndex) => {
        const op = String(f?.operator || "=").toLowerCase();
        if (op === "is_null" || op === "is_not_null") return;
        rows.push({
          widgetId: String(tbl.id || ""),
          filterIndex,
          label: `${String(tbl.title || "Table")} - ${toDisplayLabel(String(f?.column || "Parameter"))}`,
          value: String(f?.value ?? ""),
          isForeign: hasForeignLookupForTableColumn(source?.table, f?.column),
          options: getForeignOptionsForTableColumn(source?.table, f?.column),
        });
      });
    });
    return rows;
  }, [tableWidgets, foreignKeysByTable]);

  useEffect(() => {
    tableWidgetsRef.current = Array.isArray(tableWidgets) ? tableWidgets : [];
  }, [tableWidgets]);

  useEffect(() => {
    const tableNames = Array.from(
      new Set(
        (Array.isArray(tableWidgets) ? tableWidgets : [])
          .map((tbl) =>
            String(tbl?.source?.mode || "") === "table" ? String(tbl?.source?.table || "") : ""
          )
          .filter((t) => /^[a-zA-Z0-9_]+$/.test(t))
      )
    );
    tableNames.forEach((tableName) => {
      const hasMeta =
        foreignKeysByTable &&
        typeof foreignKeysByTable === "object" &&
        Object.prototype.hasOwnProperty.call(foreignKeysByTable, tableName);
      if (hasMeta || foreignMetaFetchRef.current.has(tableName)) return;
      foreignMetaFetchRef.current.add(tableName);
      fetch(`/api/db/${encodeURIComponent(tableName)}/meta`)
        .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          if (!ok) return;
          const foreignKeys =
            data?.foreignKeys && typeof data.foreignKeys === "object" ? data.foreignKeys : {};
          setForeignKeysByTable((prev) => ({
            ...(prev && typeof prev === "object" ? prev : {}),
            [tableName]: foreignKeys,
          }));
        })
        .catch(() => {
          // keep UI usable even if FK metadata fails
        })
        .finally(() => {
          foreignMetaFetchRef.current.delete(tableName);
        });
    });
  }, [tableWidgets, foreignKeysByTable]);

  useEffect(() => {
    if (!selectedTextDatasetId) return;
    const ds = (Array.isArray(datasets) ? datasets : []).find((d) => String(d?.id || "") === String(selectedTextDatasetId));
    if (!ds) return;
    const cols = Array.isArray(ds?.columns) ? ds.columns.map((c) => String(c)).filter(Boolean) : [];
    if (!cols.length) {
      setSelectedTextDatasetColumn("");
      return;
    }
    if (!cols.includes(String(selectedTextDatasetColumn || ""))) {
      setSelectedTextDatasetColumn(cols[0]);
    }
  }, [datasets, selectedTextDatasetId, selectedTextDatasetColumn]);

  useEffect(() => {
    if (!selectedTextDatasetId || !selectedTextDatasetColumn) return;
    const ds = (Array.isArray(datasets) ? datasets : []).find((d) => String(d?.id || "") === String(selectedTextDatasetId));
    if (!ds) return;
    const first = Array.isArray(ds.rows) ? ds.rows[0] : null;
    const next = first ? renderCell(first[selectedTextDatasetColumn]) : "";
    if (next && next !== headerText) {
      setHeaderText(next);
    }
  }, [datasets, selectedTextDatasetId, selectedTextDatasetColumn, headerText]);

  useEffect(() => {
    setTextWidgets((prev) =>
      (Array.isArray(prev) ? prev : []).map((w) => {
        const datasetId = String(w?.datasetId || "");
        if (!datasetId) return w;
        const ds = (Array.isArray(datasets) ? datasets : []).find(
          (d) => String(d?.id || "") === datasetId
        );
        if (!ds) return { ...w, datasetId: "", column: "" };
        const cols = Array.isArray(ds?.columns)
          ? ds.columns.map((c) => String(c)).filter(Boolean)
          : [];
        if (!cols.length) return { ...w, column: "" };
        const current = String(w?.column || "");
        if (current && cols.includes(current)) return w;
        return { ...w, column: cols[0] };
      })
    );
  }, [datasets]);

  function loadLayouts() {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    return parseJsonSafe(raw || "{}", {});
  }

  function buildLayoutSnapshot(overrides = {}) {
    return {
      headerText: overrides.headerText ?? headerText,
      subHeaderText: overrides.subHeaderText ?? subHeaderText,
      footerText: overrides.footerText ?? footerText,
      signatureEnabled: overrides.signatureEnabled ?? signatureEnabled,
      signatureLabel: overrides.signatureLabel ?? signatureLabel,
      signatureName: overrides.signatureName ?? signatureName,
      signatureAlign: overrides.signatureAlign ?? signatureAlign,
      signatureLineWidth: overrides.signatureLineWidth ?? signatureLineWidth,
      headerFormat: overrides.headerFormat ?? headerFormat,
      logoSrc: overrides.logoSrc ?? logoSrc,
      logoWidth: overrides.logoWidth ?? logoWidth,
      textStyles: overrides.textStyles ?? textStyles,
      columnLabels: overrides.columnLabels ?? columnLabels,
      paperSize: overrides.paperSize ?? paperSize,
      paperOrientation: overrides.paperOrientation ?? paperOrientation,
      previewZoom: overrides.previewZoom ?? previewZoom,
      pagePadding: overrides.pagePadding ?? pagePadding,
      datasets: overrides.datasets ?? datasets,
      selectedDatasetId: overrides.selectedDatasetId ?? selectedDatasetId,
      datasetDraftName: overrides.datasetDraftName ?? datasetDraftName,
      selectedTextDatasetId: overrides.selectedTextDatasetId ?? selectedTextDatasetId,
      selectedTextDatasetColumn: overrides.selectedTextDatasetColumn ?? selectedTextDatasetColumn,
      sourceMode: overrides.sourceMode ?? sourceMode,
      selectedTable: overrides.selectedTable ?? selectedTable,
      tableLimit: overrides.tableLimit ?? tableLimit,
      selectedColumns: overrides.selectedColumns ?? selectedColumns,
      tableFilters: overrides.tableFilters ?? tableFilters,
      tableGroupByColumns: overrides.tableGroupByColumns ?? tableGroupByColumns,
      sql: overrides.sql ?? sql,
      selectedRoutineOid: overrides.selectedRoutineOid ?? selectedRoutineOid,
      routineArgs: overrides.routineArgs ?? routineArgs,
      textWidgets: overrides.textWidgets ?? textWidgets,
      tableWidgets: overrides.tableWidgets ?? tableWidgets,
    };
  }

  function saveLayoutFor(reportId, overrides = {}) {
    if (!reportId) return;
    const all = loadLayouts();
    all[String(reportId)] = buildLayoutSnapshot(overrides);
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
  }

  function applyLayoutFor(reportId, layoutOverride = null) {
    const all = loadLayouts();
    const fromOverride =
      layoutOverride && typeof layoutOverride === "object" && !Array.isArray(layoutOverride)
        ? layoutOverride
        : null;
    const layout = fromOverride || all[String(reportId)] || {};
    if (fromOverride && reportId) {
      all[String(reportId)] = fromOverride;
      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(all));
    }
    setHeaderText(String(layout.headerText || "Production Report"));
    setSubHeaderText(String(layout.subHeaderText || ""));
    setFooterText(String(layout.footerText || "Generated by Mesora"));
    setSignatureEnabled(layout.signatureEnabled === true);
    setSignatureLabel(String(layout.signatureLabel || "Signature"));
    setSignatureName(String(layout.signatureName || ""));
    setSignatureAlign(
      String(layout.signatureAlign || "") === "left"
        ? "left"
        : String(layout.signatureAlign || "") === "center"
        ? "center"
        : "right"
    );
    setSignatureLineWidth(
      Math.min(420, Math.max(120, Number(layout.signatureLineWidth) || 220))
    );
    setHeaderFormat(
      layout?.headerFormat && typeof layout.headerFormat === "object"
        ? {
            align:
              String(layout.headerFormat?.align || "") === "center"
                ? "center"
                : String(layout.headerFormat?.align || "") === "right"
                ? "right"
                : "left",
            variant:
              String(layout.headerFormat?.variant || "") === "band"
                ? "band"
                : "plain",
          }
        : { align: "left", variant: "plain" }
    );
    setLogoSrc(String(layout.logoSrc || readDefaultLogo()));
    setLogoWidth(Math.min(360, Math.max(80, Number(layout.logoWidth) || 170)));
    setTextStyles(
      layout?.textStyles && typeof layout.textStyles === "object"
        ? {
            header: {
              fontSize: Number(layout.textStyles?.header?.fontSize) || 28,
              color: String(layout.textStyles?.header?.color || "#111827"),
              fontFamily: String(layout.textStyles?.header?.fontFamily || TEXT_FONTS[0]),
            },
            subHeader: {
              fontSize: Number(layout.textStyles?.subHeader?.fontSize) || 13,
              color: String(layout.textStyles?.subHeader?.color || "#475467"),
              fontFamily: String(layout.textStyles?.subHeader?.fontFamily || TEXT_FONTS[0]),
            },
            description: {
              fontSize: Number(layout.textStyles?.description?.fontSize) || 12,
              color: String(layout.textStyles?.description?.color || "#667085"),
              fontFamily: String(layout.textStyles?.description?.fontFamily || TEXT_FONTS[0]),
            },
            footer: {
              fontSize: Number(layout.textStyles?.footer?.fontSize) || 12,
              color: String(layout.textStyles?.footer?.color || "#667085"),
              fontFamily: String(layout.textStyles?.footer?.fontFamily || TEXT_FONTS[0]),
            },
          }
        : {
            header: { fontSize: 28, color: "#111827", fontFamily: TEXT_FONTS[0] },
            subHeader: { fontSize: 13, color: "#475467", fontFamily: TEXT_FONTS[0] },
            description: { fontSize: 12, color: "#667085", fontFamily: TEXT_FONTS[0] },
            footer: { fontSize: 12, color: "#667085", fontFamily: TEXT_FONTS[0] },
          }
    );
    setColumnLabels(
      layout?.columnLabels && typeof layout.columnLabels === "object"
        ? layout.columnLabels
        : {}
    );
    setPaperSize(
      Object.prototype.hasOwnProperty.call(PAPER_SIZES, String(layout.paperSize || ""))
        ? String(layout.paperSize)
        : "letter"
    );
    setPaperOrientation(
      String(layout.paperOrientation || "") === "landscape" ? "landscape" : "portrait"
    );
    setPreviewZoom(Math.min(140, Math.max(60, Number(layout.previewZoom) || 100)));
    setPagePadding(Math.min(64, Math.max(8, Number(layout.pagePadding) || 24)));
    setDatasets(Array.isArray(layout.datasets) ? layout.datasets : []);
    setSelectedDatasetId(String(layout.selectedDatasetId || ""));
    setDatasetDraftName(String(layout.datasetDraftName || ""));
    setSelectedTextDatasetId(String(layout.selectedTextDatasetId || ""));
    setSelectedTextDatasetColumn(String(layout.selectedTextDatasetColumn || ""));
    setSourceMode(
      String(layout.sourceMode || "") === "sql"
        ? "sql"
        : String(layout.sourceMode || "") === "routine"
          ? "routine"
          : "table"
    );
    setSelectedTable(String(layout.selectedTable || ""));
    setTableLimit(Math.min(1000, Math.max(1, Number(layout.tableLimit) || 100)));
    setSelectedColumns(
      layout?.selectedColumns && typeof layout.selectedColumns === "object"
        ? layout.selectedColumns
        : {}
    );
    setTableFilters(Array.isArray(layout.tableFilters) ? layout.tableFilters : []);
    setTableGroupByColumns(
      Array.isArray(layout.tableGroupByColumns) ? layout.tableGroupByColumns : []
    );
    setSql(String(layout.sql || ""));
    setSelectedRoutineOid(String(layout.selectedRoutineOid || ""));
    setRoutineArgs(Array.isArray(layout.routineArgs) ? layout.routineArgs : []);
    setTextWidgets(
      Array.isArray(layout.textWidgets)
        ? layout.textWidgets.map((w) => normalizeTextWidget(w))
        : []
    );
    setSelectedTextWidgetId("");
    setTableWidgets(Array.isArray(layout.tableWidgets) ? layout.tableWidgets : []);
    setSelectedWidgetId("");
  }

  async function loadReports() {
    try {
      setLoadingReports(true);
      const res = await fetch("/api/reports");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load reports.");
      setReports(Array.isArray(data.reports) ? data.reports : []);
    } catch (err) {
      setError(err?.message || "Failed to load reports.");
    } finally {
      setLoadingReports(false);
    }
  }

  useEffect(() => {
    if (datasetOnly) {
      setDesignerReady(true);
      setReports([]);
      setLoadingReports(false);
      applyLayoutFor(DATASET_LAYOUT_ID);
      return;
    }
    loadReports();
  }, [datasetOnly]);

  useEffect(() => {
    if (!datasetOnly) return;
    saveLayoutFor(DATASET_LAYOUT_ID, {
      datasets,
      selectedDatasetId,
      datasetDraftName,
      selectedTextDatasetId,
      selectedTextDatasetColumn,
      sourceMode,
      selectedTable,
      tableLimit,
      selectedColumns,
      tableFilters,
      tableGroupByColumns,
      sql,
      selectedRoutineOid,
      routineArgs,
    });
  }, [
    datasetOnly,
    datasets,
    selectedDatasetId,
    datasetDraftName,
    selectedTextDatasetId,
    selectedTextDatasetColumn,
    sourceMode,
    selectedTable,
    tableLimit,
    selectedColumns,
    tableFilters,
    tableGroupByColumns,
    sql,
    selectedRoutineOid,
    routineArgs,
  ]);

  useEffect(() => {
    let alive = true;
    async function loadTables() {
      try {
        const res = await fetch("/api/db/tables");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load tables.");
        if (!alive) return;
        const tables = Array.isArray(data?.tables) ? data.tables : [];
        setDbTables(tables);
      } catch (err) {
        if (!alive) return;
        setError(err?.message || "Failed to load tables.");
      }
    }
    loadTables();
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    async function loadRoutines() {
      try {
        const res = await fetch("/api/db/routines");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load routines.");
        if (!alive) return;
        const next = Array.isArray(data?.routines) ? data.routines : [];
        setRoutines(next);
      } catch (err) {
        if (!alive) return;
        setError(err?.message || "Failed to load routines.");
      }
    }
    loadRoutines();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadColumns() {
      if (!selectedTable) {
        setTableColumns([]);
        setSelectedColumns({});
        setTableFilters([]);
        setTableGroupByColumns([]);
        return;
      }
      try {
        const res = await fetch(`/api/db/${encodeURIComponent(selectedTable)}/meta`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load columns.");
        if (!alive) return;
        const foreignKeys =
          data?.foreignKeys && typeof data.foreignKeys === "object" ? data.foreignKeys : {};
        setForeignKeysByTable((prev) => ({
          ...(prev && typeof prev === "object" ? prev : {}),
          [String(selectedTable)]: foreignKeys,
        }));
        const cols = Array.isArray(data?.columns)
          ? data.columns.map((c) => String(c?.column_name || "")).filter(Boolean)
          : [];
        setTableColumns(cols);
        setSelectedColumns(Object.fromEntries(cols.map((c) => [c, true])));
        setTableFilters((prev) =>
          (Array.isArray(prev) ? prev : [])
            .filter((f) => cols.includes(String(f?.column || "")))
            .map((f) => ({
              ...f,
              column: String(f?.column || cols[0] || ""),
            }))
        );
        setTableGroupByColumns((prev) =>
          normalizeGroupByColumns(prev, cols)
        );
      } catch (err) {
        if (!alive) return;
        setError(err?.message || "Failed to load columns.");
      }
    }
    loadColumns();
    return () => {
      alive = false;
    };
  }, [selectedTable]);

  function buildSqlFromSelection() {
    if (!selectedTable) return;
    const cols = tableColumns.filter((c) => !!selectedColumns[c]);
    const selectCols = cols.length
      ? cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(", ")
      : "*";
    const tableIdent = `"${String(selectedTable).replace(/"/g, '""')}"`;
    setSql(`SELECT ${selectCols}\nFROM ${tableIdent}\nLIMIT 100`);
    setStatus(`SQL updated from table "${selectedTable}" selection.`);
  }

  function placeholderNameForArg(rawName, idx) {
    const base = String(rawName || "")
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^[^a-zA-Z_]+/, "")
      .trim();
    return base || `arg_${idx + 1}`;
  }

  function buildTableSqlTemplate() {
    if (!selectedTable) throw new Error("Select a table first.");
    const cols = tableColumns.filter((c) => !!selectedColumns[c]);
    const groupByCols = normalizeGroupByColumns(tableGroupByColumns, cols);
    const selectCols = cols.length
      ? cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(", ")
      : "*";
    const tableIdent = `"${String(selectedTable).replace(/"/g, '""')}"`;
    const lim = Math.min(1000, Math.max(1, Number(tableLimit) || 100));
    const groupBySql = groupByCols.length
      ? `\nGROUP BY ${groupByCols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(", ")}`
      : "";
    return `SELECT ${selectCols}\nFROM ${tableIdent}${groupBySql}\nLIMIT ${lim}`;
  }

  function buildRoutineSqlTemplate() {
    if (!selectedRoutine) throw new Error("Select a stored routine first.");
    if (String(selectedRoutine.kind || "") === "p") {
      throw new Error("Procedures are not supported for report preview. Use a function.");
    }
    const fnIdent = `"${String(selectedRoutine.schema || "").replace(/"/g, '""')}"."${String(
      selectedRoutine.name || ""
    ).replace(/"/g, '""')}"`;
    const args = Array.isArray(selectedRoutine.args) ? selectedRoutine.args : [];
    const placeholders = args
      .map((arg, idx) => `{{${placeholderNameForArg(arg?.name, idx)}}}`)
      .join(", ");
    if (selectedRoutine.returnsSet) {
      return `SELECT *\nFROM ${fnIdent}(${placeholders})\nLIMIT 100`;
    }
    return `SELECT ${fnIdent}(${placeholders}) AS result\nLIMIT 1`;
  }

  function openReport(report) {
    if (!report) return;
    if (activeReportId && String(activeReportId) !== String(report.id || "")) {
      saveLayoutFor(activeReportId);
    }
    setDesignerReady(true);
    setActiveReportId(String(report.id || ""));
    setName(String(report.name || ""));
    setDescription(String(report.description || ""));
    setSql(String(report.sql || ""));
    setNamedFilters({});
    setPositionalFilters([]);
    setSourceMode("sql");
    setTableFilters([]);
    setTableGroupByColumns([]);
    setColumns([]);
    setColumnLabels({});
    setRows([]);
    setSummaryRow(null);
    setDatasets([]);
    setSelectedDatasetId("");
    setDatasetEditing(false);
    setSelectedTextDatasetId("");
    setSelectedTextDatasetColumn("");
    setTextWidgets([]);
    setSelectedTextWidgetId("");
    setTableWidgets([]);
    setSelectedWidgetId("");
    applyLayoutFor(report.id, report?.layout_json || null);
    setStatus(`Editing report "${String(report.name || "")}".`);
    setError("");
  }

  function newReport() {
    if (activeReportId) {
      saveLayoutFor(activeReportId);
    }
    setDesignerReady(true);
    setActiveReportId("");
    setName("");
    setDescription("");
    setSql("SELECT * FROM equipment LIMIT 100");
    setSourceMode("table");
    setTableFilters([]);
    setTableGroupByColumns([]);
    setNamedFilters({});
    setPositionalFilters([]);
    setColumns([]);
    setColumnLabels({});
    setRows([]);
    setSummaryRow(null);
    setDatasets([]);
    setSelectedDatasetId("");
    setDatasetEditing(false);
    setSelectedTextDatasetId("");
    setSelectedTextDatasetColumn("");
    setTextWidgets([]);
    setSelectedTextWidgetId("");
    setTableWidgets([]);
    setSelectedWidgetId("");
    setHeaderText("Production Report");
    setSubHeaderText("");
    setFooterText("Generated by Mesora");
    setSignatureEnabled(false);
    setSignatureLabel("Signature");
    setSignatureName("");
    setSignatureAlign("right");
    setSignatureLineWidth(220);
    setHeaderFormat({ align: "left", variant: "plain" });
    setLogoSrc(readDefaultLogo());
    setLogoWidth(170);
    setPaperSize("letter");
    setPaperOrientation("portrait");
    setPreviewZoom(100);
    setPagePadding(24);
    setTextStyles({
      header: { fontSize: 28, color: "#111827", fontFamily: TEXT_FONTS[0] },
      subHeader: { fontSize: 13, color: "#475467", fontFamily: TEXT_FONTS[0] },
      description: { fontSize: 12, color: "#667085", fontFamily: TEXT_FONTS[0] },
      footer: { fontSize: 12, color: "#667085", fontFamily: TEXT_FONTS[0] },
    });
    setSelectedTextKey("header");
    setSelectedPreviewTextKey("");
    setLogoSelected(false);
    setStatus("New Report Draft.");
    setError("");
  }

  function updateSelectedTextStyle(partial) {
    const key = selectedTextKey || "header";
    setTextStyles((prev) => {
      const next = {
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          ...partial,
        },
      };
      if (activeReportId) saveLayoutFor(activeReportId, { textStyles: next });
      return next;
    });
  }

  function resolveTextWidgetValue(widget) {
    if (!widget || typeof widget !== "object") return "";
    const datasetId = String(widget.datasetId || "");
    const column = String(widget.column || "");
    if (!datasetId || !column) return String(widget.value || "");
    const ds = (Array.isArray(datasets) ? datasets : []).find(
      (d) => String(d?.id || "") === datasetId
    );
    if (!ds) return String(widget.value || "");
    // Text widgets always resolve from the first returned row (Top 1 behavior).
    const first = Array.isArray(ds.rows) ? ds.rows[0] : null;
    return first ? renderCell(first[column]) : "";
  }

  function addTextWidget() {
    const next = createDefaultTextWidget();
    setTextWidgets((prev) => [...(Array.isArray(prev) ? prev : []), next]);
    setSelectedTextWidgetId(next.id);
    setSelectedWidgetId("");
    setSelectedPreviewTextKey("");
    setLogoSelected(false);
    setStatus("Added text field.");
  }

  function updateTextWidget(widgetId, patch) {
    const id = String(widgetId || "");
    if (!id) return;
    setTextWidgets((prev) =>
      (Array.isArray(prev) ? prev : []).map((w) =>
        String(w?.id || "") === id ? { ...w, ...patch } : w
      )
    );
  }

  function removeTextWidget(widgetId) {
    const id = String(widgetId || "");
    if (!id) return;
    setTextWidgets((prev) =>
      (Array.isArray(prev) ? prev : []).filter((w) => String(w?.id || "") !== id)
    );
    setSelectedTextWidgetId((prev) => (String(prev || "") === id ? "" : prev));
    setStatus("Text field removed.");
  }

  function estimateTextWidgetWidth(widget) {
    const txt = String(resolveTextWidgetValue(widget) || widget?.value || widget?.label || "Text");
    const size = Math.min(72, Math.max(8, Number(widget?.fontSize) || 14));
    return Math.max(70, Math.round(txt.length * size * 0.58 + 24));
  }

  function lineUpHeaderTextWidgets() {
    const headerWidgets = (Array.isArray(textWidgets) ? textWidgets : []).filter((w) => Boolean(w?.isHeaderField));
    if (!headerWidgets.length) {
      setError("Mark at least one text widget as Header Field.");
      return;
    }
    const lineY = Math.min(...headerWidgets.map((w) => Math.max(0, Number(w?.y) || 0)));
    setTextWidgets((prev) =>
      (Array.isArray(prev) ? prev : []).map((w) =>
        w?.isHeaderField ? { ...w, y: lineY } : w
      )
    );
    setStatus("Header fields lined up.");
  }

  function spaceHeaderTextWidgets() {
    const headerWidgets = (Array.isArray(textWidgets) ? textWidgets : [])
      .filter((w) => Boolean(w?.isHeaderField))
      .slice()
      .sort((a, b) => (Number(a?.x) || 0) - (Number(b?.x) || 0));
    if (headerWidgets.length < 2) {
      setError("Need at least two Header Field text widgets to space.");
      return;
    }
    const usableWidth = Math.max(220, pageWidthPx - pagePadding * 2 - 16);
    const totalWidth = headerWidgets.reduce((sum, w) => sum + estimateTextWidgetWidth(w), 0);
    const slots = headerWidgets.length - 1;
    const gap = slots > 0 ? Math.max(8, Math.floor((usableWidth - totalWidth) / slots)) : 8;
    const lineY = Math.min(...headerWidgets.map((w) => Math.max(0, Number(w?.y) || 0)));
    let cursor = 8;
    const positions = new Map();
    headerWidgets.forEach((w) => {
      positions.set(String(w.id), { x: cursor, y: lineY });
      cursor += estimateTextWidgetWidth(w) + gap;
    });
    setTextWidgets((prev) =>
      (Array.isArray(prev) ? prev : []).map((w) => {
        const pos = positions.get(String(w?.id || ""));
        return pos ? { ...w, x: pos.x, y: pos.y } : w;
      })
    );
    setStatus("Header fields spaced.");
  }

  const selectedTextStyle = textStyles[selectedTextKey] || textStyles.header;
  const selectedTextValue =
    selectedTextKey === "header"
      ? headerText
      : selectedTextKey === "subHeader"
      ? subHeaderText
      : footerText;
  const canAddTableToLayout =
    Boolean(selectedDataset) &&
    Array.isArray(selectedDataset?.columns) &&
    selectedDataset.columns.length > 0;
  const previewPaper = PAPER_SIZES[paperSize] || PAPER_SIZES.letter;
  const pageWidthPx =
    paperOrientation === "landscape"
      ? Number(previewPaper.height || 1056)
      : Number(previewPaper.width || 816);
  const pageHeightPx =
    paperOrientation === "landscape"
      ? Number(previewPaper.width || 816)
      : Number(previewPaper.height || 1056);
  const previewScale = Math.min(1.4, Math.max(0.6, Number(previewZoom || 100) / 100));
  const previewDisplayWidth = Math.round(pageWidthPx * previewScale);
  const previewDisplayHeight = Math.round(pageHeightPx * previewScale);
  const previewDisplayPadding = Math.round(pagePadding * previewScale);
  const previewTableMinHeight = Math.max(260, pageHeightPx - 220);

  function setSelectedTextValue(next) {
    const value = String(next ?? "");
    if (selectedTextKey === "header") setHeaderText(value);
    else if (selectedTextKey === "subHeader") setSubHeaderText(value);
    else setFooterText(value);
    if (activeReportId) {
      saveLayoutFor(activeReportId, {
        headerText: selectedTextKey === "header" ? value : headerText,
        subHeaderText: selectedTextKey === "subHeader" ? value : subHeaderText,
        footerText: selectedTextKey === "footer" ? value : footerText,
      });
    }
  }

  function normalizeTableFilters(rawFilters) {
    return (Array.isArray(rawFilters) ? rawFilters : [])
      .map((f) => ({
        column: String(f?.column || "").trim(),
        operator: String(f?.operator || "=").trim().toLowerCase(),
        value: f?.value ?? "",
      }))
      .filter((f) => !!f.column)
      .filter(
        (f) =>
          f.operator === "is_null" ||
          f.operator === "is_not_null" ||
          String(f.value ?? "").trim() !== ""
      );
  }

  function normalizeGroupByColumns(rawColumns, allowedColumns = []) {
    const allowed = new Set((Array.isArray(allowedColumns) ? allowedColumns : []).map((c) => String(c)));
    return Array.from(
      new Set(
        (Array.isArray(rawColumns) ? rawColumns : [])
          .map((c) => String(c || "").trim())
          .filter(Boolean)
          .filter((c) => !allowed.size || allowed.has(c))
      )
    );
  }

  function getForeignOptionsForTableColumn(tableName, columnName) {
    const table = String(tableName || "");
    const column = String(columnName || "");
    if (!table || !column) return [];
    const tableMeta =
      foreignKeysByTable && typeof foreignKeysByTable === "object"
        ? foreignKeysByTable[table]
        : null;
    const columnMeta =
      tableMeta && typeof tableMeta === "object" ? tableMeta[column] : null;
    return Array.isArray(columnMeta?.options) ? columnMeta.options : [];
  }

  function hasForeignLookupForTableColumn(tableName, columnName) {
    const table = String(tableName || "");
    const column = String(columnName || "");
    if (!table || !column) return false;
    const tableMeta =
      foreignKeysByTable && typeof foreignKeysByTable === "object"
        ? foreignKeysByTable[table]
        : null;
    const columnMeta =
      tableMeta && typeof tableMeta === "object" ? tableMeta[column] : null;
    return Boolean(
      columnMeta &&
        String(columnMeta?.referencedTable || "").trim() &&
        String(columnMeta?.referencedColumn || "").trim()
    );
  }

  function buildCurrentSourceSnapshot() {
    const filters = Object.fromEntries(
      filterNames.map((k) => {
        const raw = namedFilters[k];
        const txt = raw == null ? "" : String(raw);
        return [k, txt.trim() === "" ? null : raw];
      })
    );
    const positional = Array.from({ length: positionalCount }, (_, idx) => {
      const raw = positionalFilters[idx];
      const txt = raw == null ? "" : String(raw);
      return txt.trim() === "" ? null : raw;
    });
    if (sourceMode === "table") {
      const selectedCols = tableColumns.filter((c) => !!selectedColumns[c]);
      const groupByCols = normalizeGroupByColumns(tableGroupByColumns, selectedCols);
      return {
        mode: "table",
        table: selectedTable,
        selectedColumns: selectedCols,
        limit: Math.min(1000, Math.max(1, Number(tableLimit) || 100)),
        tableFilters: normalizeTableFilters(tableFilters),
        groupByColumns: groupByCols,
        sql: buildTableSqlTemplate(),
      };
    }
    if (sourceMode === "routine") {
      return {
        mode: "routine",
        routineOid: selectedRoutineOid,
        routineName:
          selectedRoutine && selectedRoutine.schema && selectedRoutine.name
            ? `${String(selectedRoutine.schema)}.${String(selectedRoutine.name)}`
            : "",
        routineArgs: (Array.isArray(routineArgs) ? routineArgs : []).map((v) =>
          String(v ?? "").trim() === "" ? null : v
        ),
        sql: buildRoutineSqlTemplate(),
      };
    }
    return {
      mode: "sql",
      sql,
      filters,
      positional,
    };
  }

  function describeWidgetSource(source) {
    const mode = String(source?.mode || "");
    if (mode === "table") return `Table: ${String(source?.table || "(none)")}`;
    if (mode === "routine") {
      return `Routine: ${String(source?.routineName || source?.routineOid || "(none)")}`;
    }
    return "Custom Query";
  }

  function buildSourceKey(source) {
    const mode = String(source?.mode || "");
    if (mode === "table") {
      const table = String(source?.table || "");
      const cols = Array.isArray(source?.selectedColumns)
        ? [...source.selectedColumns].map((c) => String(c)).sort().join(",")
        : "";
      const groupBy = Array.isArray(source?.groupByColumns)
        ? [...source.groupByColumns].map((c) => String(c)).sort().join(",")
        : "";
      const lim = Number(source?.limit) || 0;
      const filters = Array.isArray(source?.tableFilters)
        ? source.tableFilters
            .map(
              (f) =>
                `${String(f?.column || "")}:${String(f?.operator || "")}:${String(
                  f?.value ?? ""
                )}`
            )
            .join("|")
        : "";
      return `table:${table}|cols:${cols}|groupBy:${groupBy}|limit:${lim}|filters:${filters}`;
    }
    if (mode === "routine") {
      const oid = String(source?.routineOid || "");
      const args = Array.isArray(source?.routineArgs)
        ? source.routineArgs.map((v) => String(v ?? "")).join("|")
        : "";
      return `routine:${oid}|args:${args}`;
    }
    return `sql:${String(source?.sql || "").trim()}`;
  }

  function addCurrentTableToPreview() {
    const chosenDataset = selectedDataset;
    if (!chosenDataset) {
      setError("Select a dataset first.");
      return;
    }
    const sourceColumns = Array.isArray(chosenDataset.columns) ? chosenDataset.columns : [];
    const sourceRows = Array.isArray(chosenDataset.rows) ? chosenDataset.rows : [];
    const sourceSummary =
      chosenDataset?.summaryRow && typeof chosenDataset.summaryRow === "object"
        ? chosenDataset.summaryRow
        : null;
    if (!sourceColumns.length) {
      setError("Selected dataset has no columns. Save/refresh the dataset first.");
      return;
    }
    const id = `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const idx = tableWidgets.length;
    const sourceSnapshot = chosenDataset?.source;
    if (!sourceSnapshot || typeof sourceSnapshot !== "object") {
      setError("Selected dataset is missing source settings. Save or refresh the dataset first.");
      return;
    }
    const nextWidgetBase = {
      id,
      datasetId: String(chosenDataset?.id || ""),
      title: chosenDataset
        ? String(chosenDataset.name || `Dataset ${idx + 1}`)
        : (sourceMode === "table" && selectedTable
          ? toDisplayLabel(selectedTable)
          : String(name || "").trim() || `Table ${idx + 1}`),
      columns: sourceColumns.map((c) => String(c)),
      rows: sourceRows,
      summaryRow: sourceSummary,
      rowLimit: Math.min(200, Math.max(1, sourceRows.length || 20)),
      fontSize: 12,
      fontFamily: TEXT_FONTS[0],
      x: 16 + idx * 22,
      y: 16 + idx * 22,
      width: Math.min(820, Math.max(300, sourceColumns.length * 120)),
      height: 280,
      source: sourceSnapshot,
      sourceKey: buildSourceKey(sourceSnapshot),
    };
    const nextWidget = clampWidgetToPreview(nextWidgetBase);
    setTableWidgets((prev) => [...prev, nextWidget]);
    setSelectedWidgetId(id);
    setStatus(`Added "${nextWidget.title}" to preview layout.`);
  }

  function removeTableFromPreview(id) {
    setTableWidgets((prev) => prev.filter((t) => t.id !== id));
    setSelectedWidgetId((prev) => (prev === id ? "" : prev));
    setStatus("Removed table from preview.");
  }

  function removeSelectedTableWidget() {
    if (!selectedWidgetId) {
      setError("Select a table in the preview first.");
      return;
    }
    removeTableFromPreview(selectedWidgetId);
  }

  function updateTableWidget(id, patch) {
    if (!id) return;
    setTableWidgets((prev) =>
      prev.map((tbl) =>
        tbl.id === id ? clampWidgetToPreview({ ...tbl, ...patch }) : tbl
      )
    );
  }

  function updateTableSource(id, sourcePatch) {
    if (!id) return;
    setTableWidgets((prev) =>
      prev.map((tbl) => {
        if (tbl.id !== id) return tbl;
        const nextSource = {
          ...(tbl?.source && typeof tbl.source === "object" ? tbl.source : {}),
          ...(sourcePatch && typeof sourcePatch === "object" ? sourcePatch : {}),
        };
        return clampWidgetToPreview({
          ...tbl,
          source: nextSource,
          sourceKey: buildSourceKey(nextSource),
        });
      })
    );
  }

  function updateTableRoutineArg(id, idx, value) {
    if (!id || idx < 0) return;
    setTableWidgets((prev) =>
      prev.map((tbl) => {
        if (tbl.id !== id) return tbl;
        const source = tbl?.source && typeof tbl.source === "object" ? tbl.source : {};
        if (String(source?.mode || "") !== "routine") return tbl;
        const args = Array.isArray(source.routineArgs) ? [...source.routineArgs] : [];
        args[idx] = String(value ?? "").trim() === "" ? null : value;
        const nextSource = { ...source, routineArgs: args };
        return clampWidgetToPreview({
          ...tbl,
          source: nextSource,
          sourceKey: buildSourceKey(nextSource),
        });
      })
    );
  }

  function getWidgetColumnOptions(widget) {
    const fromSource = Array.isArray(widget?.source?.selectedColumns)
      ? widget.source.selectedColumns.map((c) => String(c))
      : [];
    const fromCols = Array.isArray(widget?.columns) ? widget.columns.map((c) => String(c)) : [];
    const rowKeys = Array.isArray(widget?.rows)
      ? widget.rows.flatMap((r) => Object.keys(r || {})).map((k) => String(k))
      : [];
    const summaryKeys =
      widget?.summaryRow && typeof widget.summaryRow === "object"
        ? Object.keys(widget.summaryRow).map((k) => String(k))
        : [];
    return Array.from(new Set([...fromSource, ...fromCols, ...rowKeys, ...summaryKeys])).filter(Boolean);
  }

  function setWidgetColumns(id, nextColumns) {
    updateTableWidget(id, {
      columns: Array.from(new Set((Array.isArray(nextColumns) ? nextColumns : []).map((c) => String(c)))),
    });
  }

  function clampWidgetToPreview(tbl) {
    const boundsW = Math.max(0, Number(previewLayoutRef.current?.clientWidth) || 0);
    const boundsH = Math.max(0, Number(previewLayoutRef.current?.clientHeight) || 0);
    if (!boundsW || !boundsH) return tbl;
    const chromeH = 0;
    const maxBodyH = Math.max(60, boundsH - chromeH);
    const minWidth = Math.min(240, boundsW);
    const minHeight = Math.min(140, maxBodyH);
    const width = Math.max(minWidth, Math.min(Number(tbl.width) || 420, boundsW));
    const height = Math.max(minHeight, Math.min(Number(tbl.height) || 280, maxBodyH));
    const maxX = Math.max(0, boundsW - width);
    const maxY = Math.max(0, boundsH - (height + chromeH));
    const x = Math.max(0, Math.min(Number(tbl.x) || 0, maxX));
    const y = Math.max(0, Math.min(Number(tbl.y) || 0, maxY));
    return { ...tbl, x, y, width, height };
  }

  async function refreshTableWidget(id) {
    const widget = tableWidgets.find((t) => t.id === id);
    if (widget?.datasetId) {
      await refreshDatasetById(widget.datasetId);
      return;
    }
    if (!widget?.source) {
      setError("This table has no saved source.");
      return;
    }
    try {
      setRunning(true);
      setError("");
      const res = await fetch("/api/reports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(widget.source),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to refresh table.");
      setTableWidgets((prev) =>
        prev.map((tbl) =>
          tbl.id === id
            ? {
                ...tbl,
                columns: Array.isArray(data.columns) ? data.columns : [],
                rows: Array.isArray(data.rows) ? data.rows : [],
                summaryRow:
                  data?.summaryRow && typeof data.summaryRow === "object"
                    ? data.summaryRow
                    : null,
                rowLimit: Math.min(
                  200,
                  Math.max(
                    1,
                    Number(tbl?.rowLimit) ||
                      (Array.isArray(data.rows) ? data.rows.length : 0) ||
                      20
                  )
                ),
              }
            : tbl
        )
      );
      setStatus(`Refreshed "${String(widget.title || "Table")}".`);
    } catch (err) {
      setError(err?.message || "Failed to refresh table.");
    } finally {
      setRunning(false);
    }
  }

  function updateWidgetFilterValue(widgetId, filterIndex, value) {
    if (!widgetId || filterIndex < 0) return;
    setTableWidgets((prev) => {
      const next = prev.map((tbl) => {
        if (String(tbl?.id || "") !== String(widgetId)) return tbl;
        const source = tbl?.source && typeof tbl.source === "object" ? tbl.source : {};
        if (String(source?.mode || "") !== "table") return tbl;
        const filters = Array.isArray(source?.tableFilters) ? [...source.tableFilters] : [];
        if (!filters[filterIndex]) return tbl;
        filters[filterIndex] = { ...filters[filterIndex], value };
        const nextSource = { ...source, tableFilters: filters };
        return {
          ...tbl,
          source: nextSource,
          sourceKey: buildSourceKey(nextSource),
        };
      });
      tableWidgetsRef.current = next;
      return next;
    });
  }

  async function runHeaderFilters() {
    const targets = (Array.isArray(tableWidgetsRef.current) ? tableWidgetsRef.current : []).filter((tbl) => {
      const source = tbl?.source && typeof tbl.source === "object" ? tbl.source : null;
      return (
        String(source?.mode || "") === "table" &&
        String(source?.table || "").trim().length > 0
      );
    });
    if (!targets.length) return;
    try {
      setRunning(true);
      setError("");
      const settled = await Promise.allSettled(
        targets.map(async (tbl) => {
          const source = tbl?.source && typeof tbl.source === "object" ? tbl.source : {};
          const nextSource = {
            ...source,
            tableFilters: normalizeTableFilters(source?.tableFilters),
          };
          const res = await fetch("/api/reports/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(nextSource),
          });
          const data = await res.json();
          if (!res.ok) {
            throw new Error(data?.error || `Failed to refresh "${String(tbl.title || "Table")}".`);
          }
          return { id: String(tbl.id || ""), data };
        })
      );
      const results = settled
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
      const failures = settled
        .filter((r) => r.status === "rejected")
        .map((r) => String(r.reason?.message || "Failed to refresh a table."));
      const byId = new Map(results.map((r) => [r.id, r.data]));
      setTableWidgets((prev) =>
        prev.map((tbl) => {
          const data = byId.get(String(tbl.id || ""));
          if (!data) return tbl;
          return {
            ...tbl,
            columns: Array.isArray(data.columns) ? data.columns : [],
            rows: Array.isArray(data.rows) ? data.rows : [],
            summaryRow: data?.summaryRow && typeof data.summaryRow === "object" ? data.summaryRow : null,
            rowLimit: Math.min(
              200,
              Math.max(1, Number(tbl?.rowLimit) || (Array.isArray(data.rows) ? data.rows.length : 0) || 20)
            ),
          };
        })
      );
      if (failures.length) {
        setError(failures[0]);
      } else {
        setStatus("Report filters applied.");
      }
    } catch (err) {
      setError(err?.message || "Failed to run report filters.");
    } finally {
      setRunning(false);
    }
  }

  function startTextResize(e, key) {
    e.preventDefault();
    e.stopPropagation();
    const base = Number(textStyles?.[key]?.fontSize) || 12;
    textResizeRef.current = {
      key,
      startY: Number(e.clientY || 0),
      startSize: base,
    };
    setSelectedTextKey(key);
  }

  function exportPreviewToExcel() {
    try {
      const tables = Array.isArray(tableWidgets) && tableWidgets.length
        ? tableWidgets
        : [
            {
              title: name || "Report",
              columns: Array.isArray(columns) ? columns : [],
              rows: Array.isArray(rows) ? rows : [],
              summaryRow: summaryRow && typeof summaryRow === "object" ? summaryRow : null,
            },
          ];
      if (!tables.length || !Array.isArray(tables[0]?.columns) || !tables[0].columns.length) {
        setError("No table data available to export.");
        return;
      }
      const esc = (v) =>
        String(v == null ? "" : v)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const sections = tables
        .map((tbl, idx) => {
          const cols = Array.isArray(tbl?.columns) ? tbl.columns.map((c) => String(c)) : [];
          if (!cols.length) return "";
          const head = cols
            .map((col) => `<th>${esc(String(columnLabels[String(col)] || toDisplayLabel(col)))}</th>`)
            .join("");
          const bodyRows = (Array.isArray(tbl?.rows) ? tbl.rows : []).map((row) => {
            const cells = cols.map((col) => `<td>${esc(renderCell(row?.[col]))}</td>`).join("");
            return `<tr>${cells}</tr>`;
          });
          const summary = tbl?.summaryRow
            ? `<tr>${cols.map((col) => `<td><strong>${esc(renderCell(tbl.summaryRow?.[col]))}</strong></td>`).join("")}</tr>`
            : "";
          return `
            <h3>${esc(String(tbl?.title || `Table ${idx + 1}`))}</h3>
            <table border="1" cellspacing="0" cellpadding="4">
              <thead><tr>${head}</tr></thead>
              <tbody>${bodyRows.join("")}${summary}</tbody>
            </table>
            <br/>
          `;
        })
        .filter(Boolean)
        .join("");
      if (!sections) {
        setError("No table data available to export.");
        return;
      }
      const html = `
        <html>
          <head>
            <meta charset="utf-8" />
          </head>
          <body>${sections}</body>
        </html>
      `;
      const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${sanitizeFileName(name || activeReport?.name || "report")}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("Excel export downloaded.");
    } catch (err) {
      setError(err?.message || "Failed to export Excel file.");
    }
  }

  function printReportArea() {
    try {
      setIsPreparingPrint(true);
      const source = reportPrintRef.current;
      if (!source) {
        setIsPreparingPrint(false);
        setError("Report preview is not ready to print.");
        return;
      }
      window.setTimeout(() => {
        try {
          const printSource = reportPrintRef.current;
          if (!printSource) throw new Error("Report preview is not ready to print.");
          const iframe = document.createElement("iframe");
          iframe.setAttribute("aria-hidden", "true");
          iframe.style.position = "fixed";
          iframe.style.right = "0";
          iframe.style.bottom = "0";
          iframe.style.width = "0";
          iframe.style.height = "0";
          iframe.style.border = "0";
          document.body.appendChild(iframe);

          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!doc) throw new Error("Unable to prepare print document.");
          const orientation = paperOrientation === "landscape" ? "landscape" : "portrait";
          doc.open();
          doc.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Report Print</title>
    <style>
      @page { size: ${orientation}; margin: 8mm; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111827; }
      #report-print-scope { margin: 0 !important; width: 100% !important; max-width: none !important; min-height: auto !important; padding: ${Math.round(pagePadding)}px; box-sizing: border-box; background: #fff; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; transform: none !important; }
      [data-print-hide="true"] { display: none !important; }
      [data-print-panel="layout-canvas"] { overflow: visible !important; min-height: 0 !important; height: auto !important; background: #fff !important; border: 0 !important; border-radius: 0 !important; }
      [data-print-panel="text-widget"] { position: static !important; left: auto !important; top: auto !important; width: auto !important; margin: 0 0 8px 0 !important; box-shadow: none !important; outline: 0 !important; }
      [data-print-panel="table-widget"] { position: static !important; left: auto !important; top: auto !important; width: 100% !important; margin: 0 0 12px 0 !important; break-inside: auto; page-break-inside: auto; box-shadow: none !important; border: 0 !important; border-radius: 0 !important; outline: 0 !important; }
      [data-print-panel="table-widget"][data-selected="true"] { box-shadow: none !important; border: 0 !important; outline: 0 !important; }
      [data-print-panel="table-body-wrap"] { overflow: visible !important; height: auto !important; max-height: none !important; }
      table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed; page-break-inside: auto; border: 0 !important; }
      thead { display: table-header-group; }
      tfoot { display: table-footer-group; }
      tr { page-break-inside: avoid; break-inside: avoid; }
      th, td { border-bottom: 1px solid #d9dee7 !important; padding: 6px 8px !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    </style>
  </head>
  <body>
    ${printSource.outerHTML}
  </body>
</html>`);
          doc.close();

          iframe.onload = () => {
            const win = iframe.contentWindow;
            if (!win) return;
            window.setTimeout(() => {
              win.focus();
              win.print();
              window.setTimeout(() => {
                iframe.remove();
              }, 400);
            }, 120);
          };
        } catch (err) {
          setError(err?.message || "Failed to print report.");
        } finally {
          setIsPreparingPrint(false);
        }
      }, 80);
    } catch (err) {
      setIsPreparingPrint(false);
      setError(err?.message || "Failed to print report.");
    }
  }

  function getCurrentPreviewBody() {
    const filters = Object.fromEntries(
      filterNames.map((k) => {
        const raw = namedFilters[k];
        const txt = raw == null ? "" : String(raw);
        return [k, txt.trim() === "" ? null : raw];
      })
    );
    const positional = Array.from({ length: positionalCount }, (_, idx) => {
      const raw = positionalFilters[idx];
      const txt = raw == null ? "" : String(raw);
      return txt.trim() === "" ? null : raw;
    });
    return sourceMode === "table"
      ? (() => {
          const selectedCols = tableColumns.filter((c) => !!selectedColumns[c]);
          const groupByCols = normalizeGroupByColumns(tableGroupByColumns, selectedCols);
          return {
            mode: "table",
            table: selectedTable,
            selectedColumns: selectedCols,
            limit: Math.min(1000, Math.max(1, Number(tableLimit) || 100)),
            tableFilters: normalizeTableFilters(tableFilters),
            groupByColumns: groupByCols,
            sql: buildTableSqlTemplate(),
          };
        })()
      : sourceMode === "routine"
        ? {
            mode: "routine",
            routineOid: selectedRoutineOid,
            routineArgs: (Array.isArray(routineArgs) ? routineArgs : []).map((v) =>
              String(v ?? "").trim() === "" ? null : v
            ),
            sql: buildRoutineSqlTemplate(),
          }
        : {
            sql,
            filters,
            positional,
          };
  }

  function ensureCurrentSourceReady({ silent = false } = {}) {
    if (sourceMode === "sql") {
      if (!sql.trim()) throw new Error("SQL required.");
      if (!/^(select|with)\b/i.test(sql.trim())) {
        if (!silent) throw new Error("Preview supports SELECT queries only.");
        return false;
      }
    }
    if (sourceMode === "table" && !selectedTable) {
      if (!silent) throw new Error("Select a table first.");
      return false;
    }
    if (sourceMode === "routine") {
      if (!selectedRoutineOid) {
        if (!silent) throw new Error("Select a stored routine first.");
        return false;
      }
      if (String(selectedRoutine?.kind || "") === "p") {
        if (!silent) throw new Error("Procedures are not supported for preview. Use a function.");
        return false;
      }
    }
    return true;
  }

  async function executePreviewBody(previewBody) {
    const res = await fetch("/api/reports/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(previewBody),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Failed to preview report.");
    const nextColumns = Array.isArray(data.columns) ? data.columns : [];
    const nextRows = Array.isArray(data.rows) ? data.rows : [];
    return {
      columns: nextColumns,
      rows: nextRows,
      summaryRow: data?.summaryRow && typeof data.summaryRow === "object" ? data.summaryRow : null,
    };
  }

  async function persistCurrentReportLayout(overrides = {}) {
    const reportId = String(activeReportId || "").trim();
    if (!reportId) return;
    const reportName = String(name || "").trim();
    if (!reportName) return;
    let sqlToSave = String(sql || "").trim();
    if (!sqlToSave) {
      if (sourceMode === "table" && selectedTable) {
        sqlToSave = buildTableSqlTemplate();
      } else if (sourceMode === "routine" && selectedRoutineOid) {
        sqlToSave = buildRoutineSqlTemplate();
      } else {
        sqlToSave = "SELECT 1 AS value";
      }
    }
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reportId,
        name: reportName,
        description: String(description || "").trim(),
        sql: sqlToSave,
        layout: buildLayoutSnapshot(overrides),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Failed to persist report layout.");
  }

  async function upsertDatasetFromCurrentSource(nameOverride = "") {
    try {
      if (!ensureCurrentSourceReady({ silent: false })) return;
      setRunning(true);
      setError("");
      const previewBody = getCurrentPreviewBody();
      const result = await executePreviewBody(previewBody);
      setColumns(result.columns);
      setRows(result.rows);
      setSummaryRow(result.summaryRow);
      const mode = String(previewBody?.mode || "sql");
      const preferredName =
        mode === "table"
          ? toDisplayLabel(String(previewBody?.table || "Table Dataset"))
          : mode === "routine"
            ? toDisplayLabel(String(selectedRoutine?.name || "Routine Dataset"))
            : toDisplayLabel(String(name || "Query Dataset"));
      const requestedName = String(nameOverride || "").trim();
      const targetId = String(selectedDatasetId || "").trim();
      let nextDatasets = [];
      let persistedDatasetId = targetId;
      setDatasets((prev) => {
        const list = Array.isArray(prev) ? prev : [];
        const idx = targetId ? list.findIndex((d) => String(d?.id || "") === targetId) : -1;
        if (idx >= 0) {
          const existing = list[idx] || {};
          const updated = {
            ...existing,
            name: requestedName || String(existing?.name || preferredName || "Dataset"),
            source: previewBody,
            columns: result.columns,
            rows: result.rows,
            summaryRow: result.summaryRow,
            updatedAt: Date.now(),
          };
          const next = [...list];
          next[idx] = updated;
          nextDatasets = next;
          persistedDatasetId = String(updated?.id || targetId || "");
          return next;
        }
        const id = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const uniqueName = nextDatasetName(
          list.map((d) => d?.name),
          requestedName || preferredName
        );
        const created = {
          id,
          name: uniqueName,
          source: previewBody,
          columns: result.columns,
          rows: result.rows,
          summaryRow: result.summaryRow,
          updatedAt: Date.now(),
        };
        setSelectedDatasetId(id);
        const next = [...list, created];
        nextDatasets = next;
        persistedDatasetId = id;
        return next;
      });
      const layoutTargetId = datasetOnly ? DATASET_LAYOUT_ID : activeReportId;
      if (layoutTargetId && nextDatasets.length) {
        saveLayoutFor(layoutTargetId, {
          datasets: nextDatasets,
          selectedDatasetId: persistedDatasetId,
        });
      }
      if (activeReportId) {
        await persistCurrentReportLayout({
          datasets: nextDatasets,
          selectedDatasetId: persistedDatasetId,
        });
      }
      setStatus(
        datasetOnly || activeReportId
          ? "Dataset saved."
          : "Dataset saved in draft. Save report to persist it."
      );
      return true;
    } catch (err) {
      setError(err?.message || "Failed to save dataset.");
      return false;
    } finally {
      setRunning(false);
    }
  }

  async function refreshDatasetById(datasetId) {
    const id = String(datasetId || "");
    const ds = (Array.isArray(datasets) ? datasets : []).find((d) => String(d?.id || "") === id);
    if (!ds?.source) {
      setError("Dataset source not found.");
      return;
    }
    try {
      setRunning(true);
      setError("");
      const result = await executePreviewBody(ds.source);
      setDatasets((prev) =>
        (Array.isArray(prev) ? prev : []).map((item) =>
          String(item?.id || "") !== id
            ? item
            : {
                ...item,
                columns: result.columns,
                rows: result.rows,
                summaryRow: result.summaryRow,
                updatedAt: Date.now(),
              }
        )
      );
      setTableWidgets((prev) =>
        (Array.isArray(prev) ? prev : []).map((tbl) =>
          String(tbl?.datasetId || "") !== id
            ? tbl
            : {
                ...tbl,
                source: ds.source,
                sourceKey: buildSourceKey(ds.source),
                columns: result.columns,
                rows: result.rows,
                summaryRow: result.summaryRow,
              }
        )
      );
      setStatus(`Dataset "${String(ds?.name || "")}" refreshed.`);
      const layoutTargetId = datasetOnly ? DATASET_LAYOUT_ID : activeReportId;
      if (layoutTargetId) {
        saveLayoutFor(layoutTargetId);
      }
    } catch (err) {
      setError(err?.message || "Failed to refresh dataset.");
    } finally {
      setRunning(false);
    }
  }

  function removeDatasetById(datasetId) {
    const id = String(datasetId || "");
    if (!id) return;
    const nextDatasets = (Array.isArray(datasets) ? datasets : []).filter(
      (d) => String(d?.id || "") !== id
    );
    const nextTableWidgets = (Array.isArray(tableWidgets) ? tableWidgets : []).map((tbl) =>
      String(tbl?.datasetId || "") === id ? { ...tbl, datasetId: "" } : tbl
    );
    const nextSelectedDatasetId = String(selectedDatasetId || "") === id ? "" : selectedDatasetId;
    const nextSelectedTextDatasetId =
      String(selectedTextDatasetId || "") === id ? "" : selectedTextDatasetId;
    const nextSelectedTextDatasetColumn =
      String(selectedTextDatasetId || "") === id ? "" : selectedTextDatasetColumn;

    setDatasets(nextDatasets);
    setTableWidgets(nextTableWidgets);
    setSelectedDatasetId(nextSelectedDatasetId);
    setDatasetEditing(false);
    setSelectedTextDatasetId(nextSelectedTextDatasetId);
    setSelectedTextDatasetColumn(nextSelectedTextDatasetColumn);
    const layoutTargetId = datasetOnly ? DATASET_LAYOUT_ID : activeReportId;
    if (layoutTargetId) {
      saveLayoutFor(layoutTargetId, {
        datasets: nextDatasets,
        tableWidgets: nextTableWidgets,
        selectedDatasetId: nextSelectedDatasetId,
        selectedTextDatasetId: nextSelectedTextDatasetId,
        selectedTextDatasetColumn: nextSelectedTextDatasetColumn,
      });
    }
    setStatus("Dataset removed.");
  }

  function createNewDatasetDraft() {
    const suggested = nextDatasetName(
      (Array.isArray(datasets) ? datasets : []).map((d) => d?.name),
      "Dataset"
    );
    setSelectedDatasetId("");
    setDatasetDraftName(suggested);
    setDatasetEditing(true);
    setStatus("New dataset draft.");
  }

  function bindWidgetToDataset(widgetId, datasetId) {
    const id = String(datasetId || "");
    if (!id) {
      updateTableWidget(widgetId, { datasetId: "" });
      return;
    }
    const ds = (Array.isArray(datasets) ? datasets : []).find((d) => String(d?.id || "") === id);
    if (!ds) {
      setError("Dataset not found.");
      return;
    }
    updateTableWidget(widgetId, {
      datasetId: id,
      title: String(ds.name || "Dataset"),
      source: ds.source,
      sourceKey: buildSourceKey(ds.source),
      columns: Array.isArray(ds.columns) ? ds.columns : [],
      rows: Array.isArray(ds.rows) ? ds.rows : [],
      summaryRow: ds?.summaryRow && typeof ds.summaryRow === "object" ? ds.summaryRow : null,
    });
  }

  async function runPreview({ silent = false } = {}) {
    try {
      if (!ensureCurrentSourceReady({ silent })) return;
      setRunning(true);
      if (!silent) setError("");
      const reqSeq = ++previewRequestSeqRef.current;
      const previewBody = getCurrentPreviewBody();
      const data = await executePreviewBody(previewBody);
      if (reqSeq !== previewRequestSeqRef.current) return;
      const nextColumns = Array.isArray(data.columns) ? data.columns : [];
      setColumns(nextColumns);
      setColumnLabels((prev) => {
        const next = {};
        nextColumns.forEach((col) => {
          const key = String(col);
          next[key] = prev[key] || "";
        });
        return next;
      });
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setSummaryRow(data?.summaryRow && typeof data.summaryRow === "object" ? data.summaryRow : null);
      setReportTimestamp(new Date().toLocaleString());
      setStatus(
        `${silent ? "Live Preview" : "Preview"} returned ${
          Array.isArray(data.rows) ? data.rows.length : 0
        } row(s).`
      );
    } catch (err) {
      if (!silent) {
        setError(err?.message || "Failed to preview report.");
      }
    } finally {
      setRunning(false);
    }
  }

  async function saveReport() {
    try {
      if (!name.trim()) throw new Error("Report name required.");
      let sqlToSave = sql.trim();
      if (sourceMode === "table" && selectedTable) {
        sqlToSave = buildTableSqlTemplate();
        setSql(sqlToSave);
      } else if (sourceMode === "routine" && selectedRoutineOid) {
        sqlToSave = buildRoutineSqlTemplate();
        setSql(sqlToSave);
      } else if (!sqlToSave && selectedTable) {
        // Graceful fallback: if a table is selected, derive SQL automatically.
        sqlToSave = buildTableSqlTemplate();
        setSql(sqlToSave);
      } else if (!sqlToSave) {
        // Allow saving layout-only reports without requiring table/query selection.
        sqlToSave = "SELECT 1 AS value";
        setSql(sqlToSave);
      }
      setSaving(true);
      setError("");
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeReportId || undefined,
          name: name.trim(),
          description: description.trim(),
          sql: sqlToSave,
          layout: buildLayoutSnapshot(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to save report.");
      const next = data?.report || null;
      if (next?.id) {
        setActiveReportId(String(next.id));
        saveLayoutFor(next.id);
      }
      await loadReports();
      setStatus(activeReportId ? "Report updated." : "Report created.");
    } catch (err) {
      setError(err?.message || "Failed to save report.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteReport() {
    try {
      if (!activeReportId) throw new Error("Select a saved report first.");
      setDeleting(true);
      setError("");
      const res = await fetch(`/api/reports/${encodeURIComponent(activeReportId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to delete report.");
      await loadReports();
      newReport();
      setStatus("Report deleted.");
    } catch (err) {
      setError(err?.message || "Failed to delete report.");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (sourceMode === "routine") {
      const argCount = Array.isArray(selectedRoutine?.args) ? selectedRoutine.args.length : 0;
      setRoutineArgs((prev) => {
        const next = Array.from({ length: argCount }, (_, idx) => prev[idx] ?? "");
        return next;
      });
    }
  }, [sourceMode, selectedRoutine]);

  useEffect(() => {
    if (autoPreviewTimerRef.current) {
      clearTimeout(autoPreviewTimerRef.current);
      autoPreviewTimerRef.current = null;
    }
    if (
      (sourceMode === "sql" && !sql.trim()) ||
      (sourceMode === "table" && !selectedTable) ||
      (sourceMode === "routine" && !selectedRoutineOid)
    ) {
      setColumns([]);
      setRows([]);
      setSummaryRow(null);
      return;
    }
    autoPreviewTimerRef.current = setTimeout(() => {
      runPreview({ silent: true });
    }, 450);
    return () => {
      if (autoPreviewTimerRef.current) {
        clearTimeout(autoPreviewTimerRef.current);
        autoPreviewTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sourceMode,
    sql,
    selectedTable,
    tableLimit,
    JSON.stringify(tableFilters),
    JSON.stringify(tableGroupByColumns),
    JSON.stringify(selectedColumns),
    selectedRoutineOid,
    JSON.stringify(routineArgs),
    JSON.stringify(namedFilters),
    JSON.stringify(positionalFilters),
  ]);

  useEffect(() => {
    const onMove = (e) => {
      if (!resizeRef.current) return;
      const min = 300;
      const max = Math.max(560, window.innerWidth - 360);
      const next = Math.min(max, Math.max(min, Number(e.clientX || 0)));
      setEditorWidth(next);
    };
    const onUp = () => {
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    textStylesRef.current = textStyles;
  }, [textStyles]);

  useEffect(() => {
    const onMove = (e) => {
      if (!logoResizeRef.current) return;
      const dx = Number(e.clientX || 0) - Number(logoResizeRef.current.startX || 0);
      const next = Math.min(360, Math.max(80, Number(logoResizeRef.current.startW || 170) + dx));
      setLogoWidth(next);
    };
    const onUp = () => {
      if (!logoResizeRef.current) return;
      logoResizeRef.current = null;
      if (activeReportId) saveLayoutFor(activeReportId, { logoWidth });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [activeReportId, logoWidth]);

  useEffect(() => {
    const onMove = (e) => {
      if (!textResizeRef.current) return;
      const { key, startY, startSize } = textResizeRef.current;
      const dy = Number(startY || 0) - Number(e.clientY || 0);
      const next = Math.min(96, Math.max(8, Math.round(Number(startSize || 12) + dy / 2)));
      setTextStyles((prev) => ({
        ...prev,
        [key]: {
          ...(prev[key] || {}),
          fontSize: next,
        },
      }));
    };
    const onUp = () => {
      if (!textResizeRef.current) return;
      textResizeRef.current = null;
      if (activeReportId) saveLayoutFor(activeReportId, { textStyles: textStylesRef.current });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [activeReportId]);

  useEffect(() => {
    const onMove = (e) => {
      if (!tableDragRef.current) return;
      const drag = tableDragRef.current;
      const dx = Number(e.clientX || 0) - Number(drag.startX || 0);
      const dy = Number(e.clientY || 0) - Number(drag.startY || 0);
      setTableWidgets((prev) =>
        prev.map((t) =>
          t.id !== drag.id
            ? t
            : clampWidgetToPreview({
                ...t,
                x: Math.round(Number(drag.startLeft || 0) + dx),
                y: Math.round(Number(drag.startTop || 0) + dy),
              })
        )
      );
    };
    const onUp = () => {
      if (!tableDragRef.current) return;
      tableDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!textWidgetDragRef.current) return;
      const drag = textWidgetDragRef.current;
      const dx = Number(e.clientX || 0) - Number(drag.startX || 0);
      const dy = Number(e.clientY || 0) - Number(drag.startY || 0);
      updateTextWidget(drag.id, {
        x: Math.max(0, Math.round(Number(drag.startLeft || 0) + dx)),
        y: Math.max(0, Math.round(Number(drag.startTop || 0) + dy)),
      });
    };
    const onUp = () => {
      if (!textWidgetDragRef.current) return;
      textWidgetDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!tableResizeRef.current) return;
      const resize = tableResizeRef.current;
      const dx = Number(e.clientX || 0) - Number(resize.startX || 0);
      const dy = Number(e.clientY || 0) - Number(resize.startY || 0);
      const mode = String(resize.mode || "xy");
      setTableWidgets((prev) =>
        prev.map((t) =>
          t.id !== resize.id
            ? t
            : clampWidgetToPreview({
                ...t,
                width:
                  mode === "y"
                    ? Math.round(Number(resize.startWidth || 420))
                    : Math.round(Number(resize.startWidth || 420) + dx),
                height:
                  mode === "x"
                    ? Math.round(Number(resize.startHeight || 280))
                    : Math.round(Number(resize.startHeight || 280) + dy),
              })
        )
      );
    };
    const onUp = () => {
      if (!tableResizeRef.current) return;
      tableResizeRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = String(e?.target?.tagName || "").toUpperCase();
      const isTypingTarget =
        tag === "INPUT" || tag === "TEXTAREA" || Boolean(e?.target?.isContentEditable);
      if (isTypingTarget) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedWidgetId("");
        setSelectedTextWidgetId("");
        setLogoSelected(false);
        setSelectedPreviewTextKey("");
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedTextWidgetId) {
        e.preventDefault();
        removeTextWidget(selectedTextWidgetId);
        return;
      }
      if (!selectedWidgetId) return;
      e.preventDefault();
      removeTableFromPreview(selectedWidgetId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedWidgetId, selectedTextWidgetId]);

  useEffect(() => {
    if (!previewLayoutRef.current) return;
    setTableWidgets((prev) => {
      let changed = false;
      const next = prev.map((tbl) => {
        const clamped = clampWidgetToPreview(tbl);
        if (
          clamped.x !== tbl.x ||
          clamped.y !== tbl.y ||
          clamped.width !== tbl.width ||
          clamped.height !== tbl.height
        ) {
          changed = true;
        }
        return clamped;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDisplayWidth, previewDisplayHeight, previewDisplayPadding, previewTableMinHeight]);

  useEffect(() => {
    const maxX = Math.max(0, pageWidthPx - pagePadding * 2 - 80);
    const maxY = Math.max(0, previewTableMinHeight - 28);
    setTextWidgets((prev) =>
      (Array.isArray(prev) ? prev : []).map((w) => ({
        ...w,
        x: Math.min(maxX, Math.max(0, Number(w?.x) || 0)),
        y: Math.min(maxY, Math.max(0, Number(w?.y) || 0)),
      }))
    );
  }, [pageWidthPx, pagePadding, previewTableMinHeight]);

  useEffect(() => {
    if (!activeReportId) return;
    saveLayoutFor(activeReportId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeReportId,
    headerText,
    subHeaderText,
    footerText,
    signatureEnabled,
    signatureLabel,
    signatureName,
    signatureAlign,
    signatureLineWidth,
    JSON.stringify(headerFormat),
    logoSrc,
    logoWidth,
    JSON.stringify(textStyles),
    JSON.stringify(columnLabels),
    JSON.stringify(datasets),
    selectedDatasetId,
    selectedTextDatasetId,
    selectedTextDatasetColumn,
    JSON.stringify(textWidgets),
    JSON.stringify(tableWidgets),
  ]);

  useEffect(() => {
    const msg = String(status || "").trim();
    if (!msg) return;
    if (msg.toLowerCase().startsWith("live preview returned")) return;
    toastSuccess(msg);
  }, [status]);

  useEffect(() => {
    const msg = String(error || "").trim();
    if (!msg) return;
    toastError(msg);
  }, [error]);

  useEffect(() => {
    if (editorTab !== "datasets") return;
    if (!datasetsSectionRef.current) return;
    datasetsSectionRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [editorTab]);

  return (
    !designerReady ? (
      <div className="report-designer-root" style={rootStyle}>
        <style>{`
          @media print {
            body[data-report-print="true"] * {
              visibility: hidden !important;
            }
            body[data-report-print="true"] #report-print-scope,
            body[data-report-print="true"] #report-print-scope * {
              visibility: visible !important;
            }
            body[data-report-print="true"] #report-print-scope {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              margin: 0 !important;
            }
            .report-print-mode {
              position: static !important;
              inset: auto !important;
              overflow: visible !important;
              background: #fff !important;
            }
            .report-print-mode,
            .report-print-mode * {
              visibility: hidden !important;
            }
            .report-print-mode #report-print-scope,
            .report-print-mode #report-print-scope * {
              visibility: visible !important;
            }
            .report-print-mode [data-print-panel="workspace"] {
              grid-template-columns: 0 0 1fr !important;
              padding: 0 !important;
              height: auto !important;
            }
            .report-print-mode [data-print-panel="editor"],
            .report-print-mode [data-print-panel="splitter"],
            .report-print-mode [data-print-hide="true"] {
              display: none !important;
            }
            .report-print-mode [data-print-panel="preview-wrap"] {
              border: 0 !important;
              background: #fff !important;
              overflow: visible !important;
            }
            .report-print-mode #report-print-scope {
              position: static !important;
              inset: auto !important;
              margin: 0 auto !important;
              box-shadow: none !important;
              width: auto !important;
              min-height: auto !important;
              transform: none !important;
              z-index: 2147483647 !important;
            }
            .report-print-mode [data-print-panel="layout-canvas"] {
              overflow: visible !important;
              min-height: 0 !important;
              height: auto !important;
              border-color: #d0d5dd !important;
              background: #fff !important;
            }
            .report-print-mode [data-print-panel="text-widget"] {
              position: static !important;
              left: auto !important;
              top: auto !important;
              width: auto !important;
              margin: 0 0 8px 0 !important;
              box-shadow: none !important;
              outline: 0 !important;
            }
            .report-print-mode [data-print-panel="table-widget"] {
              position: static !important;
              left: auto !important;
              top: auto !important;
              width: 100% !important;
              margin: 0 0 12px 0 !important;
              break-inside: avoid-page;
              page-break-inside: avoid;
            }
            .report-print-mode [data-print-panel="table-body-wrap"] {
              overflow: visible !important;
              height: auto !important;
              max-height: none !important;
            }
            .report-print-mode #report-print-scope,
            .report-print-mode #report-print-scope * {
              outline: none !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        `}</style>
        <div
          data-print-panel="workspace"
          style={{ height: "100%", display: "grid", gridTemplateColumns: workspaceColumns, gap: 0, padding: 0, boxSizing: "border-box" }}
        >
          <div data-print-panel="editor" style={{ border: "1px solid var(--border)", borderRadius: 0, background: "var(--bg-elev)", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
            <div style={{ padding: "12px 12px 0", fontSize: 18, fontWeight: 800, marginBottom: 10 }}>{editorTitle}</div>
            <div style={{ display: "flex", alignItems: "flex-start", padding: "0 12px 12px", overflow: "auto", minHeight: 0, flex: "1 1 auto" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, width: "min(520px, 100%)" }}>
                <select
                  value={activeReportId}
                  onChange={(e) => {
                    const selected = reports.find((r) => String(r.id) === e.target.value);
                    if (selected) openReport(selected);
                  }}
                  style={{ flex: 1, height: 38, border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
                >
                  <option value="">{loadingReports ? "Loading Reports..." : "Select Report..."}</option>
                  {reports.map((r) => (
                    <option key={String(r.id)} value={String(r.id)}>
                      {String(r.name || "")}
                    </option>
                  ))}
                </select>
                <button
                  onClick={newReport}
                  style={{ height: 38, border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "8px 12px", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  New
                </button>
              </div>
            </div>
          </div>
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              resizeRef.current = { startX: e.clientX, startW: editorWidth };
            }}
            title="Drag to resize editor"
            style={{
              cursor: "col-resize",
              background: "transparent",
              position: "relative",
              margin: "0 2px",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 0,
                bottom: 0,
                width: 2,
                transform: "translateX(-50%)",
                background: "var(--border)",
                borderRadius: 999,
                opacity: 0.8,
              }}
            />
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 0, background: "var(--bg-soft)", overflow: "auto" }} />
        </div>
      </div>
    ) : (
    <div className="report-designer-root" style={rootStyle}>
      <div style={{ height: "100%", display: "grid", gridTemplateColumns: workspaceColumns, gap: 0, padding: 0, boxSizing: "border-box" }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: embedded ? 12 : 0, background: "var(--bg-elev)", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, minWidth: 0 }}>
          {!hideEditorTitle ? (
            <div
              style={
                datasetOnly
                  ? { padding: "10px 12px 0", fontSize: 16, fontWeight: 800, marginBottom: 10, fontFamily: "inherit" }
                  : { padding: "12px 12px 0", fontSize: 18, fontWeight: 800, marginBottom: 10 }
              }
            >
              {editorTitle}
            </div>
          ) : null}
          {!hideTopTabs ? (
          <div style={{ padding: "0 12px 10px", display: "flex", gap: 8 }}>
            <button
              className={tabBtnClass(editorTab === "design")}
              data-preserve-style="true"
              onClick={() => {
                setEditorTab("design");
                setLayoutWidgetsTab("tables");
              }}
            >
              Design
            </button>
            <button
              className={tabBtnClass(editorTab === "datasets")}
              data-preserve-style="true"
              onClick={() => setEditorTab("datasets")}
            >
              Datasets
            </button>
            <button
              className={tabBtnClass(editorTab === "tables")}
              data-preserve-style="true"
              onClick={() => {
                setEditorTab("tables");
                setLayoutWidgetsTab("tables");
              }}
            >
              Tables
            </button>
            <button
              className={tabBtnClass(editorTab === "text")}
              data-preserve-style="true"
              onClick={() => {
                setEditorTab("text");
                setLayoutWidgetsTab("text");
              }}
            >
              Text
            </button>
          </div>
          ) : null}
          <div style={{ display: "grid", gap: datasetGap, padding: compactDatasetLayout ? "8px 10px 10px" : "0 12px 12px", overflowY: "auto", overflowX: "hidden", minHeight: 0, flex: "1 1 auto", position: "relative", minWidth: 0 }}>
            {editorTab === "datasets" ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 5,
                  background: "var(--bg-elev)",
                  display: "grid",
                  gap: datasetGap,
                  alignContent: "start",
                  padding: compactDatasetLayout ? "8px 10px 10px" : "0 12px 12px",
                  overflowY: "auto",
                  overflowX: "hidden",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ display: "grid", gap: datasetGap, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: datasetGap, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                    <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                      <SearchableSelect
                        value={selectedDatasetId}
                        onChange={(nextId) => {
                          const id = String(nextId || "").trim();
                          if (!id) {
                            createNewDatasetDraft();
                            return;
                          }
                          const nextDataset =
                            (Array.isArray(datasets) ? datasets : []).find(
                              (d) => String(d?.id || "") === id
                            ) || null;
                          setSelectedDatasetId(id);
                          setDatasetEditing(false);
                          if (nextDataset) applyDatasetToDraft(nextDataset);
                        }}
                        options={(Array.isArray(datasets) ? datasets : []).map((ds) => ({
                          value: String(ds?.id || ""),
                          label: String(ds?.name || "Dataset"),
                        }))}
                        placeholder="Search/select dataset..."
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-soft)",
                          color: "var(--text)",
                          borderRadius: 8,
                          fontSize: 12,
                          height: 30,
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        onClick={createNewDatasetDraft}
                        style={datasetToolbarButtonStyle}
                        title="New dataset"
                        aria-label="New dataset"
                      >
                        <Icon>
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </Icon>
                      </button>
                      <button
                        onClick={() => setDatasetEditing(true)}
                        disabled={!canDatasetEdit}
                        style={canDatasetEdit ? datasetToolbarButtonStyle : { ...datasetToolbarButtonStyle, ...datasetToolbarDisabledStyle }}
                        title="Edit dataset"
                        aria-label="Edit dataset"
                      >
                        <Icon>
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </Icon>
                      </button>
                      <button
                        onClick={async () => {
                          const ok = await upsertDatasetFromCurrentSource(datasetDraftName);
                          if (ok) setDatasetEditing(false);
                        }}
                        disabled={!canDatasetSave}
                        style={canDatasetSave ? datasetToolbarPrimaryButtonStyle : { ...datasetToolbarPrimaryButtonStyle, ...datasetToolbarDisabledStyle }}
                        title="Save dataset"
                        aria-label="Save dataset"
                      >
                        <Icon>
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                          <path d="M17 21v-8H7v8" />
                          <path d="M7 3v5h8" />
                        </Icon>
                      </button>
                      <button
                        onClick={() => {
                          if (selectedDataset) {
                            applyDatasetToDraft(selectedDataset);
                            setDatasetDraftName(String(selectedDataset?.name || ""));
                          }
                          setDatasetEditing(false);
                        }}
                        disabled={!canDatasetCancel}
                        style={canDatasetCancel ? datasetToolbarButtonStyle : { ...datasetToolbarButtonStyle, ...datasetToolbarDisabledStyle }}
                        title="Cancel edit"
                        aria-label="Cancel edit"
                      >
                        <Icon>
                          <path d="M18 6L6 18" />
                          <path d="M6 6l12 12" />
                        </Icon>
                      </button>
                      <button
                        onClick={() => {
                          if (!selectedDatasetId) return;
                          removeDatasetById(selectedDatasetId);
                        }}
                        disabled={!canDatasetDelete}
                        style={canDatasetDelete ? datasetToolbarDangerButtonStyle : { ...datasetToolbarDangerButtonStyle, ...datasetToolbarDisabledStyle }}
                        title="Delete dataset"
                        aria-label="Delete dataset"
                      >
                        <Icon>
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                        </Icon>
                      </button>
                    </div>
                  </div>
                  <input
                    value={datasetDraftName}
                    onChange={(e) => setDatasetDraftName(e.target.value)}
                    placeholder="Dataset Name"
                    disabled={datasetReadOnly}
                    style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: datasetControlPadding, minWidth: 0 }}
                  />
                  <select
                    value={sourceMode}
                    onChange={(e) => setSourceMode(e.target.value)}
                    disabled={datasetReadOnly}
                    style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: datasetControlPadding, minWidth: 0 }}
                  >
                    <option value="table">Table</option>
                    <option value="sql">Custom Query</option>
                    <option value="routine">Stored Routine</option>
                  </select>
                  {sourceMode === "table" ? (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: compactDatasetLayout ? 6 : 8, display: "grid", gap: datasetGap, background: "var(--bg-soft)", minWidth: 0 }}>
                      <select
                        value={selectedTable}
                        onChange={(e) => setSelectedTable(e.target.value)}
                        disabled={datasetReadOnly}
                        style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: datasetControlPadding, minWidth: 0 }}
                      >
                        <option value="">Select Table...</option>
                        {dbTables.map((t) => (
                          <option key={`ds-tbl-${t}`} value={String(t)}>
                            {String(t)}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={Number.isFinite(Number(tableLimit)) ? Number(tableLimit) : 100}
                        onChange={(e) => setTableLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 100)))}
                        placeholder="Limit"
                        disabled={datasetReadOnly}
                        style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: datasetControlPadding, minWidth: 0 }}
                      />
                      <details
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          padding: 8,
                          background: "var(--bg-elev)",
                        }}
                      >
                        <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                          Group By
                        </summary>
                        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              onClick={() => setTableGroupByColumns(tableColumns.filter((c) => !!selectedColumns[c]))}
                              disabled={datasetReadOnly}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}
                            >
                              Add All
                            </button>
                            <button
                              onClick={() => setTableGroupByColumns([])}
                              disabled={datasetReadOnly}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}
                            >
                              Clear
                            </button>
                          </div>
                          <div style={{ display: "grid", gap: 4, maxHeight: 130, overflow: "auto" }}>
                            {tableColumns.filter((c) => !!selectedColumns[c]).map((col) => (
                              <label
                                key={`dataset-groupby-${col}`}
                                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                              >
                                <input
                                  type="checkbox"
                                  checked={tableGroupByColumns.includes(String(col))}
                                  disabled={datasetReadOnly}
                                  onChange={(e) =>
                                    setTableGroupByColumns((prev) => {
                                      const set = new Set(normalizeGroupByColumns(prev, tableColumns));
                                      if (e.target.checked) set.add(String(col));
                                      else set.delete(String(col));
                                      return normalizeGroupByColumns(Array.from(set), tableColumns.filter((c) => !!selectedColumns[c]));
                                    })
                                  }
                                />
                                {toDisplayLabel(col)}
                              </label>
                            ))}
                            {!tableColumns.filter((c) => !!selectedColumns[c]).length ? (
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                Select columns first.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </details>
                    </div>
                  ) : null}
                  {sourceMode === "sql" ? (
                    <textarea disabled={datasetReadOnly} value={sql} onChange={(e) => setSql(e.target.value)} rows={8} placeholder="SELECT ... FROM ... " style={{ border: "1px solid var(--border)", background: "#0f172a", color: "#e2e8f0", borderRadius: 8, padding: "10px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, minWidth: 0 }} />
                  ) : null}
                  {sourceMode === "routine" ? (
                    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: compactDatasetLayout ? 6 : 8, display: "grid", gap: datasetGap, background: "var(--bg-soft)", minWidth: 0 }}>
                      <select
                        value={selectedRoutineOid}
                        onChange={(e) => setSelectedRoutineOid(e.target.value)}
                        disabled={datasetReadOnly}
                        style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: datasetControlPadding, minWidth: 0 }}
                      >
                        <option value="">Select Routine...</option>
                        {routines.map((r) => (
                          <option key={`ds-routine-${String(r.oid)}`} value={String(r.oid)}>
                            {String(r.schema)}.{String(r.name)} ({r.kind === "p" ? "Procedure" : "Function"})
                          </option>
                        ))}
                      </select>
                      {selectedRoutine && Array.isArray(selectedRoutine.args) && selectedRoutine.args.length ? (
                        <div style={{ display: "grid", gap: datasetGap }}>
                          {selectedRoutine.args.map((arg, idx) => (
                            <input
                              key={`ds-routine-arg-${idx}`}
                              value={String(routineArgs[idx] ?? "")}
                              disabled={datasetReadOnly}
                              onChange={(e) =>
                                setRoutineArgs((prev) => {
                                  const next = [...prev];
                                  next[idx] = e.target.value;
                                  return next;
                                })
                              }
                              placeholder={`${String(arg?.name || `arg_${idx + 1}`)} (${String(arg?.type || "text")})`}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: datasetControlPadding, minWidth: 0 }}
                            />
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-soft)", overflow: "hidden" }}>
                    <div style={{ padding: compactDatasetLayout ? "6px 8px" : "8px 10px", borderBottom: "1px solid var(--border)", fontSize: 12, fontWeight: 700 }}>
                      Preview
                    </div>
                    {datasetPreviewColumns.length && datasetPreviewRows.length ? (
                      <div style={{ overflow: "auto", maxHeight: compactDatasetLayout ? 220 : 300 }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr>
                              {datasetPreviewColumns.map((col) => (
                                <th
                                  key={`dataset-preview-col-${col}`}
                                  style={{
                                    textAlign: "left",
                                    padding: compactDatasetLayout ? "6px 8px" : "8px 10px",
                                    borderBottom: "1px solid var(--border)",
                                    whiteSpace: "nowrap",
                                    background: "var(--bg-elev)",
                                  }}
                                >
                                  {toDisplayLabel(col)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {datasetPreviewRows.slice(0, 20).map((row, idx) => (
                              <tr key={`dataset-preview-row-${idx}`} style={{ borderTop: "1px solid var(--border)" }}>
                                {datasetPreviewColumns.map((col) => (
                                  <td key={`dataset-preview-cell-${idx}-${col}`} style={{ padding: compactDatasetLayout ? "6px 8px" : "8px 10px", color: "var(--text-muted)" }}>
                                    {renderCell(row?.[col])}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ padding: compactDatasetLayout ? "8px" : "10px", fontSize: 12, color: "var(--text-muted)" }}>
                        No preview yet. Save or refresh a dataset to show rows.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            {editorTab === "design" ? (
            <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
              <select
                value={activeReportId}
                onChange={(e) => {
                  const selected = reports.find((r) => String(r.id) === e.target.value);
                  if (selected) openReport(selected);
                }}
                style={{ flex: "1 1 220px", minWidth: 0, border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
              >
                <option value="">{loadingReports ? "Loading Reports..." : "Select Report..."}</option>
                {reports.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {String(r.name || "")}
                  </option>
                ))}
              </select>
              <button onClick={newReport} style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>
                New
              </button>
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Report Name" style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }} />
            <input value={headerText} onChange={(e) => setHeaderText(e.target.value)} placeholder="Top Header Text" style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }} />
            <div
              ref={datasetsSectionRef}
              style={{
                border: editorTab === "datasets" ? "1px solid #2b6cff" : "1px dashed var(--border)",
                borderRadius: 8,
                padding: 8,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700 }}>Page Setup</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <select
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value)}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
                >
                  {Object.entries(PAPER_SIZES).map(([key, meta]) => (
                    <option key={key} value={key}>
                      {meta.label}
                    </option>
                  ))}
                </select>
                <select
                  value={paperOrientation}
                  onChange={(e) => setPaperOrientation(e.target.value === "landscape" ? "landscape" : "portrait")}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 8, alignItems: "center" }}>
                <input
                  type="range"
                  min={8}
                  max={64}
                  step={1}
                  value={Math.min(64, Math.max(8, Number(pagePadding) || 24))}
                  onChange={(e) => setPagePadding(Math.min(64, Math.max(8, Number(e.target.value) || 24)))}
                />
                <div style={{ fontSize: 12, textAlign: "right", color: "var(--text-muted)" }}>
                  Margin {Math.round(pagePadding)}px
                </div>
              </div>
            </div>
            <div
              style={{
                border:
                  editorTab === "text" && layoutWidgetsTab === "text"
                    ? "none"
                    : "1px dashed var(--border)",
                borderRadius: editorTab === "text" && layoutWidgetsTab === "text" ? 0 : 8,
                padding: editorTab === "text" && layoutWidgetsTab === "text" ? 0 : 8,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700 }}>Selected Preview Text</div>
              <select
                value={selectedTextKey}
                onChange={(e) => setSelectedTextKey(e.target.value)}
                style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
              >
                <option value="header">Header</option>
              </select>
              <input
                value={selectedTextValue}
                onChange={(e) => setSelectedTextValue(e.target.value)}
                placeholder="Selected text value"
                style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <select
                  value={selectedTextDatasetId}
                  onChange={(e) => setSelectedTextDatasetId(e.target.value)}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
                >
                  <option value="">Header from dataset (optional)</option>
                  {datasets.map((ds) => (
                    <option key={`txt-ds-${ds.id}`} value={String(ds.id)}>
                      {String(ds.name || "Dataset")}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedTextDatasetColumn}
                  onChange={(e) => setSelectedTextDatasetColumn(e.target.value)}
                  disabled={!selectedTextDatasetId}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", opacity: selectedTextDatasetId ? 1 : 0.6 }}
                >
                  <option value="">{selectedTextDatasetId ? "Header field..." : "Select dataset first"}</option>
                  {selectedTextDatasetColumns.map((col) => (
                    <option key={`txt-col-${col}`} value={String(col)}>
                      {toDisplayLabel(col)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 78px 78px", gap: 8 }}>
                <select
                  value={String(selectedTextStyle?.fontFamily || TEXT_FONTS[0])}
                  onChange={(e) => updateSelectedTextStyle({ fontFamily: e.target.value })}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
                >
                  {TEXT_FONTS.map((font) => (
                    <option key={font} value={font}>
                      {font.split(",")[0]}
                    </option>
                  ))}
                </select>
                <input
                  type="color"
                  value={String(selectedTextStyle?.color || "#111827")}
                  onChange={(e) => updateSelectedTextStyle({ color: e.target.value })}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "2px 4px", height: 36 }}
                />
                <input
                  type="number"
                  min={8}
                  max={72}
                  value={Number(selectedTextStyle?.fontSize) || 12}
                  onChange={(e) =>
                    updateSelectedTextStyle({
                      fontSize: Math.min(72, Math.max(8, Number(e.target.value) || 12)),
                    })
                  }
                  style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <select
                  value={String(headerFormat.align || "left")}
                  onChange={(e) =>
                    setHeaderFormat((prev) => ({
                      ...prev,
                      align:
                        e.target.value === "center"
                          ? "center"
                          : e.target.value === "right"
                          ? "right"
                          : "left",
                    }))
                  }
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
                >
                  <option value="left">Header Left</option>
                  <option value="center">Header Center</option>
                  <option value="right">Header Right</option>
                </select>
                <select
                  value={String(headerFormat.variant || "plain")}
                  onChange={(e) =>
                    setHeaderFormat((prev) => ({
                      ...prev,
                      variant: e.target.value === "band" ? "band" : "plain",
                    }))
                  }
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
                >
                  <option value="plain">Header Plain</option>
                  <option value="band">Header Band</option>
                </select>
              </div>
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, display: "grid", gap: 8, background: "var(--bg-soft)" }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Logo</div>
              <input
                value={logoSrc}
                onChange={(e) => {
                  const next = e.target.value;
                  setLogoSrc(next);
                  writeDefaultLogo(next);
                  if (activeReportId) saveLayoutFor(activeReportId, { logoSrc: next });
                }}
                placeholder="Logo URL or Data URL"
                style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px" }}
              />
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const next = String(reader.result || "");
                    setLogoSrc(next);
                    writeDefaultLogo(next);
                    if (activeReportId) saveLayoutFor(activeReportId, { logoSrc: next });
                    setStatus("Uploaded logo applied.");
                  };
                  reader.readAsDataURL(file);
                }}
                style={{ fontSize: 12 }}
              />
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, display: "grid", gap: 8, background: "var(--bg-soft)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Signature Area</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={signatureEnabled === true}
                    onChange={(e) => setSignatureEnabled(Boolean(e.target.checked))}
                  />
                  Enable
                </label>
              </div>
              <input
                value={signatureName}
                onChange={(e) => setSignatureName(e.target.value)}
                placeholder="Signer name (optional)"
                disabled={!signatureEnabled}
                style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", opacity: signatureEnabled ? 1 : 0.6 }}
              />
              <input
                value={signatureLabel}
                onChange={(e) => setSignatureLabel(e.target.value)}
                placeholder="Label (e.g., Authorized Signature)"
                disabled={!signatureEnabled}
                style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", opacity: signatureEnabled ? 1 : 0.6 }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 92px", gap: 8 }}>
                <select
                  value={signatureAlign}
                  onChange={(e) =>
                    setSignatureAlign(
                      e.target.value === "left"
                        ? "left"
                        : e.target.value === "center"
                        ? "center"
                        : "right"
                    )
                  }
                  disabled={!signatureEnabled}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", opacity: signatureEnabled ? 1 : 0.6 }}
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
                <input
                  type="number"
                  min={120}
                  max={420}
                  step={10}
                  value={Math.min(420, Math.max(120, Number(signatureLineWidth) || 220))}
                  onChange={(e) => setSignatureLineWidth(Math.min(420, Math.max(120, Number(e.target.value) || 220)))}
                  disabled={!signatureEnabled}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", opacity: signatureEnabled ? 1 : 0.6 }}
                />
              </div>
            </div>
            </>
            ) : null}
            <div style={{ border: "1px dashed var(--border)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              {editorTab === "tables" && layoutWidgetsTab === "tables" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "min(560px, 100%)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Layout Tables</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{tableWidgets.length} table(s)</div>
                  <button
                    onClick={addCurrentTableToPreview}
                    disabled={!canAddTableToLayout}
                    title={canAddTableToLayout ? "Add selected dataset to layout" : "Select a dataset in Datasets tab first"}
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg-soft)",
                      color: "var(--text)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: canAddTableToLayout ? "pointer" : "not-allowed",
                      opacity: canAddTableToLayout ? 1 : 0.5,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Add Table
                  </button>
                </div>
              </div>
              {layoutWidgetsTab === "tables" ? (tableWidgets.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "calc(100vh - 300px)", overflow: "auto", paddingRight: 2 }}>
                  {tableWidgets.map((tbl, idx) => {
                    const availableColumns = getWidgetColumnOptions(tbl);
                    const selectedSet = new Set(
                      Array.isArray(tbl.columns) ? tbl.columns.map((c) => String(c)) : []
                    );
                    const routineForWidget =
                      String(tbl?.source?.mode || "") === "routine"
                        ? routines.find(
                            (r) =>
                              String(r?.oid || "") === String(tbl?.source?.routineOid || "")
                          ) || null
                        : null;
                    const routineArgMeta = Array.isArray(routineForWidget?.args)
                      ? routineForWidget.args
                      : [];
                    const routineArgValues = Array.isArray(tbl?.source?.routineArgs)
                      ? tbl.source.routineArgs
                      : [];
                    const widgetFilters = Array.isArray(tbl?.source?.tableFilters)
                      ? tbl.source.tableFilters
                      : [];
                    const widgetTableColumns = Array.isArray(tbl?.source?.selectedColumns)
                      ? tbl.source.selectedColumns.map((c) => String(c)).filter(Boolean)
                      : [];
                    const widgetGroupByColumns = normalizeGroupByColumns(
                      tbl?.source?.groupByColumns,
                      widgetTableColumns.length ? widgetTableColumns : availableColumns
                    );
                    const widgetGroupByOptions = widgetTableColumns.length
                      ? widgetTableColumns
                      : availableColumns;
                    const routineArgCount = Math.max(
                      routineArgMeta.length,
                      routineArgValues.length
                    );
                    return (
                      <div
                        key={`layout-table-${tbl.id}`}
                        style={{
                          border:
                            selectedWidgetId === tbl.id
                              ? "1px solid #2b6cff"
                              : "1px solid var(--border)",
                          borderRadius: 8,
                          padding: 8,
                          background: "var(--bg-elev)",
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0,1fr) auto auto auto",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <input
                            value={String(tbl.title || "")}
                            onChange={(e) =>
                              updateTableWidget(tbl.id, { title: e.target.value })
                            }
                            placeholder={`Table ${idx + 1}`}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-soft)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "7px 9px",
                              minWidth: 0,
                            }}
                          />
                          <button
                            onClick={() => refreshTableWidget(tbl.id)}
                            style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                          >
                            Refresh
                          </button>
                          <button
                            onClick={() => setSelectedWidgetId(tbl.id)}
                            style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                          >
                            Select
                          </button>
                          <button
                            onClick={() => removeTableFromPreview(tbl.id)}
                            style={{ border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                          >
                            Remove
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, alignItems: "center" }}>
                          <select
                            value={String(tbl.datasetId || "")}
                            onChange={(e) => bindWidgetToDataset(tbl.id, e.target.value)}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-soft)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "7px 9px",
                              minWidth: 0,
                            }}
                          >
                            <option value="">Select Dataset...</option>
                            {datasets.map((ds) => (
                              <option key={`tbl-ds-${tbl.id}-${ds.id}`} value={String(ds.id)}>
                                {String(ds.name || "Dataset")}
                              </option>
                            ))}
                          </select>
                          {tbl.datasetId ? (
                            <button
                              onClick={() => refreshDatasetById(tbl.datasetId)}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                            >
                              Refresh DS
                            </button>
                          ) : (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right", paddingRight: 2 }}>
                              No dataset
                            </div>
                          )}
                        </div>
                        <details
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: 8,
                            background: "var(--bg-soft)",
                          }}
                        >
                          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                            Settings
                          </summary>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(5, minmax(0,1fr))",
                              gap: 6,
                              marginTop: 8,
                            }}
                          >
                            <input
                              type="number"
                              value={Math.max(0, Number(tbl.x) || 0)}
                              onChange={(e) =>
                                updateTableWidget(tbl.id, {
                                  x: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              placeholder="X"
                              title="X Position"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                            <input
                              type="number"
                              value={Math.max(0, Number(tbl.y) || 0)}
                              onChange={(e) =>
                                updateTableWidget(tbl.id, {
                                  y: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              placeholder="Y"
                              title="Y Position"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                            <input
                              type="number"
                              min={240}
                              value={Math.max(240, Number(tbl.width) || 420)}
                              onChange={(e) =>
                                updateTableWidget(tbl.id, {
                                  width: Math.max(240, Number(e.target.value) || 420),
                                })
                              }
                              placeholder="Width"
                              title="Table Width"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                            <input
                              type="number"
                              min={140}
                              value={Math.max(140, Number(tbl.height) || 280)}
                              onChange={(e) =>
                                updateTableWidget(tbl.id, {
                                  height: Math.max(140, Number(e.target.value) || 280),
                                })
                              }
                              placeholder="Height"
                              title="Table Height"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                            <input
                              type="number"
                              min={1}
                              max={200}
                              value={Math.min(200, Math.max(1, Number(tbl.rowLimit) || 20))}
                              onChange={(e) =>
                                updateTableWidget(tbl.id, {
                                  rowLimit: Math.min(200, Math.max(1, Number(e.target.value) || 20)),
                                })
                              }
                              placeholder="Rows"
                              title="Rows To Show"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "minmax(0,1fr) 110px",
                              gap: 6,
                              marginTop: 6,
                            }}
                          >
                            <select
                              value={String(tbl.fontFamily || TEXT_FONTS[0])}
                              onChange={(e) =>
                                updateTableWidget(tbl.id, { fontFamily: e.target.value })
                              }
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            >
                              {TEXT_FONTS.map((font) => (
                                <option key={`tbl-font-${font}`} value={font}>
                                  {font.split(",")[0]}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={9}
                              max={20}
                              value={Math.min(20, Math.max(9, Number(tbl.fontSize) || 12))}
                              onChange={(e) =>
                                updateTableWidget(tbl.id, {
                                  fontSize: Math.min(20, Math.max(9, Number(e.target.value) || 12)),
                                })
                              }
                              placeholder="Font"
                              title="Table Font Size"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                          </div>
                        </details>
                        {String(tbl?.source?.mode || "") === "routine" ? (
                          <details
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: 8,
                              background: "var(--bg-soft)",
                            }}
                          >
                            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                              Routine Parameters
                            </summary>
                            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                              {routineArgCount ? (
                                <div style={{ display: "grid", gap: 6 }}>
                                  {Array.from({ length: routineArgCount }, (_, argIdx) => {
                                    const meta = routineArgMeta[argIdx] || {};
                                    const argName = String(meta?.name || `arg_${argIdx + 1}`);
                                    const argType = String(meta?.type || "text");
                                    return (
                                      <input
                                        key={`widget-routine-arg-${tbl.id}-${argIdx}`}
                                        value={String(routineArgValues[argIdx] ?? "")}
                                        onChange={(e) =>
                                          updateTableRoutineArg(tbl.id, argIdx, e.target.value)
                                        }
                                        placeholder={`${argName} (${argType})`}
                                        style={{
                                          border: "1px solid var(--border)",
                                          background: "var(--bg-elev)",
                                          color: "var(--text)",
                                          borderRadius: 8,
                                          padding: "7px 9px",
                                        }}
                                      />
                                    );
                                  })}
                                </div>
                              ) : (
                                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                  This routine has no parameters.
                                </div>
                              )}
                              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                                <input
                                  value={String(tbl?.source?.routineName || "")}
                                  onChange={(e) =>
                                    updateTableSource(tbl.id, { routineName: e.target.value })
                                  }
                                  placeholder="schema.routine"
                                  title="Routine Name"
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg-elev)",
                                    color: "var(--text)",
                                    borderRadius: 8,
                                    padding: "7px 9px",
                                  }}
                                />
                                <button
                                  onClick={() => refreshTableWidget(tbl.id)}
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg-elev)",
                                    color: "var(--text)",
                                    borderRadius: 8,
                                    padding: "6px 10px",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 700,
                                  }}
                                >
                                  Run
                                </button>
                              </div>
                            </div>
                          </details>
                        ) : null}
                        {String(tbl?.source?.mode || "") === "table" ? (
                          <details
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: 8,
                              background: "var(--bg-soft)",
                            }}
                          >
                            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                              Parameters
                            </summary>
                            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                              {widgetFilters.map((f, paramIdx) => {
                                const op = String(f?.operator || "=").toLowerCase();
                                const valueHidden = op === "is_null" || op === "is_not_null";
                                const hasForeignLookup = hasForeignLookupForTableColumn(
                                  tbl?.source?.table,
                                  f?.column
                                );
                                const fkOptions = getForeignOptionsForTableColumn(
                                  tbl?.source?.table,
                                  f?.column
                                );
                                return (
                                  <div
                                    key={String(f?.id || `widget-tf-${paramIdx}`)}
                                    style={{
                                      display: "grid",
                                      gridTemplateColumns: valueHidden ? "1fr 120px auto" : "1fr 120px 1fr auto",
                                      gap: 6,
                                      alignItems: "center",
                                    }}
                                  >
                                    <select
                                      value={String(f?.column || "")}
                                      onChange={(e) => {
                                        const next = widgetFilters.map((item, i) =>
                                          i === paramIdx ? { ...item, column: e.target.value } : item
                                        );
                                        updateTableSource(tbl.id, { tableFilters: next });
                                      }}
                                      style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                                    >
                                      <option value="">Column...</option>
                                      {widgetTableColumns.map((col) => (
                                        <option key={`widget-tf-col-${tbl.id}-${col}`} value={String(col)}>
                                          {String(col)}
                                        </option>
                                      ))}
                                    </select>
                                    <select
                                      value={String(f?.operator || "=")}
                                      onChange={(e) => {
                                        const next = widgetFilters.map((item, i) =>
                                          i === paramIdx ? { ...item, operator: e.target.value } : item
                                        );
                                        updateTableSource(tbl.id, { tableFilters: next });
                                      }}
                                      style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                                    >
                                      {TABLE_FILTER_OPERATORS.map((opMeta) => (
                                        <option key={`widget-tf-op-${tbl.id}-${opMeta.value}`} value={opMeta.value}>
                                          {opMeta.label}
                                        </option>
                                      ))}
                                    </select>
                                    {!valueHidden ? (
                                      hasForeignLookup ? (
                                        <select
                                          value={String(f?.value ?? "")}
                                          onChange={(e) => {
                                            const next = widgetFilters.map((item, i) =>
                                              i === paramIdx ? { ...item, value: e.target.value } : item
                                            );
                                            updateTableSource(tbl.id, { tableFilters: next });
                                          }}
                                          style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                                        >
                                          <option value="">Select...</option>
                                          {fkOptions.map((opt, idx) => (
                                            <option key={`widget-fk-opt-${tbl.id}-${paramIdx}-${idx}`} value={String(opt?.value ?? "")}>
                                              {String(opt?.label || opt?.value || "")}
                                            </option>
                                          ))}
                                        </select>
                                      ) : (
                                        <input
                                          value={String(f?.value ?? "")}
                                          onChange={(e) => {
                                            const next = widgetFilters.map((item, i) =>
                                              i === paramIdx ? { ...item, value: e.target.value } : item
                                            );
                                            updateTableSource(tbl.id, { tableFilters: next });
                                          }}
                                          placeholder="Value"
                                          style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                                        />
                                      )
                                    ) : null}
                                    <button
                                      onClick={() => {
                                        const next = widgetFilters.filter((_, i) => i !== paramIdx);
                                        updateTableSource(tbl.id, { tableFilters: next });
                                      }}
                                      style={{ border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12 }}
                                    >
                                      x
                                    </button>
                                  </div>
                                );
                              })}
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  onClick={() => {
                                    const next = [
                                      ...widgetFilters,
                                      {
                                        id: `tf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                                        column: String(widgetTableColumns[0] || ""),
                                        operator: "=",
                                        value: "",
                                      },
                                    ];
                                    updateTableSource(tbl.id, { tableFilters: next });
                                  }}
                                  disabled={!widgetTableColumns.length}
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg-elev)",
                                    color: "var(--text)",
                                    borderRadius: 8,
                                    padding: "6px 10px",
                                    cursor: widgetTableColumns.length ? "pointer" : "not-allowed",
                                    opacity: widgetTableColumns.length ? 1 : 0.5,
                                    fontSize: 12,
                                    fontWeight: 700,
                                  }}
                                >
                                  Add Parameter
                                </button>
                                <button
                                  onClick={() => updateTableSource(tbl.id, { tableFilters: [] })}
                                  disabled={!widgetFilters.length}
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg-elev)",
                                    color: "var(--text)",
                                    borderRadius: 8,
                                    padding: "6px 10px",
                                    cursor: widgetFilters.length ? "pointer" : "not-allowed",
                                    opacity: widgetFilters.length ? 1 : 0.5,
                                    fontSize: 12,
                                  }}
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                          </details>
                        ) : null}
                        {String(tbl?.source?.mode || "") === "table" ? (
                          <details
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: 8,
                              background: "var(--bg-soft)",
                            }}
                          >
                            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                              Group By
                            </summary>
                            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  onClick={() =>
                                    updateTableSource(tbl.id, {
                                      groupByColumns: widgetGroupByOptions,
                                    })
                                  }
                                  disabled={!widgetGroupByOptions.length}
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg-elev)",
                                    color: "var(--text)",
                                    borderRadius: 8,
                                    padding: "6px 10px",
                                    cursor: widgetGroupByOptions.length ? "pointer" : "not-allowed",
                                    opacity: widgetGroupByOptions.length ? 1 : 0.5,
                                    fontSize: 12,
                                    fontWeight: 700,
                                  }}
                                >
                                  Add All
                                </button>
                                <button
                                  onClick={() => updateTableSource(tbl.id, { groupByColumns: [] })}
                                  disabled={!widgetGroupByColumns.length}
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg-elev)",
                                    color: "var(--text)",
                                    borderRadius: 8,
                                    padding: "6px 10px",
                                    cursor: widgetGroupByColumns.length ? "pointer" : "not-allowed",
                                    opacity: widgetGroupByColumns.length ? 1 : 0.5,
                                    fontSize: 12,
                                  }}
                                >
                                  Clear
                                </button>
                              </div>
                              <div style={{ display: "grid", gap: 6, maxHeight: 150, overflow: "auto" }}>
                                {widgetGroupByOptions.map((col) => {
                                  const checked = widgetGroupByColumns.includes(String(col));
                                  return (
                                    <label
                                      key={`widget-groupby-${tbl.id}-${col}`}
                                      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          const next = new Set(widgetGroupByColumns);
                                          if (e.target.checked) next.add(String(col));
                                          else next.delete(String(col));
                                          updateTableSource(tbl.id, {
                                            groupByColumns: normalizeGroupByColumns(
                                              Array.from(next),
                                              widgetGroupByOptions
                                            ),
                                          });
                                        }}
                                      />
                                      {toDisplayLabel(col)}
                                    </label>
                                  );
                                })}
                                {!widgetGroupByOptions.length ? (
                                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                    No columns available for grouping.
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </details>
                        ) : null}
                        {availableColumns.length ? (
                          <details
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              padding: 8,
                              background: "var(--bg-soft)",
                            }}
                          >
                            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                              Columns
                            </summary>
                            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                }}
                              >
                                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                  Select visible columns
                                </div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    onClick={() => setWidgetColumns(tbl.id, availableColumns)}
                                    style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}
                                  >
                                    Add All
                                  </button>
                                  <button
                                    onClick={() => setWidgetColumns(tbl.id, [])}
                                    style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "4px 8px", cursor: "pointer", fontSize: 11 }}
                                  >
                                    Remove All
                                  </button>
                                </div>
                              </div>
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr",
                                  gap: 6,
                                  maxHeight: 180,
                                  overflow: "auto",
                                }}
                              >
                                {availableColumns.map((col) => {
                                  const checked = selectedSet.has(String(col));
                                  return (
                                    <div
                                      key={`widget-col-${tbl.id}-${col}`}
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "minmax(0,1fr) minmax(120px, 1fr)",
                                        gap: 6,
                                        alignItems: "center",
                                      }}
                                    >
                                      <label
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 6,
                                          fontSize: 12,
                                          minWidth: 0,
                                        }}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={(e) => {
                                            const next = new Set(selectedSet);
                                            if (e.target.checked) next.add(String(col));
                                            else next.delete(String(col));
                                            setWidgetColumns(tbl.id, Array.from(next));
                                          }}
                                        />
                                        <span
                                          style={{
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                          }}
                                          title={String(col)}
                                        >
                                          {String(col)}
                                        </span>
                                      </label>
                                      <input
                                        value={String(columnLabels[String(col)] ?? "")}
                                        onChange={(e) =>
                                          setColumnLabels((prev) => ({
                                            ...prev,
                                            [String(col)]: e.target.value,
                                          }))
                                        }
                                        style={{
                                          border: "1px solid var(--border)",
                                          background: "var(--bg-elev)",
                                          color: "var(--text)",
                                          borderRadius: 8,
                                          padding: "5px 7px",
                                          fontSize: 12,
                                        }}
                                        title="Column Text"
                                        aria-label={`Column text for ${String(col)}`}
                                        placeholder={`Column Text: ${toDisplayLabel(String(col))}`}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </details>
                        ) : null}
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          Source: {describeWidgetSource(tbl.source)} | Columns:{" "}
                          {Array.isArray(tbl.columns) ? tbl.columns.length : 0} | Rows:{" "}
                          {Math.min(
                            Math.max(1, Number(tbl.rowLimit) || 20),
                            Array.isArray(tbl.rows) ? tbl.rows.length : 0
                          )}{" "}
                          / {Array.isArray(tbl.rows) ? tbl.rows.length : 0}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  No tables in layout yet.
                </div>
              )) : null}
              </div>
              ) : null}
              {editorTab === "text" && layoutWidgetsTab === "text" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "min(560px, 100%)" }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-start", alignItems: "center" }}>
                  <button
                    onClick={lineUpHeaderTextWidgets}
                    style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "0 10px", height: 32, minHeight: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", flex: "0 0 auto", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                  >
                    Line Up Header Fields
                  </button>
                  <button
                    onClick={spaceHeaderTextWidgets}
                    style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "0 10px", height: 32, minHeight: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", flex: "0 0 auto", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
                  >
                    Space Header Fields
                  </button>
                  <button
                    onClick={addTextWidget}
                    style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "0 12px", height: 32, minHeight: 32, display: "inline-flex", alignItems: "center", justifyContent: "center", whiteSpace: "nowrap", flex: "0 0 auto", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                  >
                    Add Text
                  </button>
                </div>
                {textWidgets.length ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      maxHeight: textWidgets.length > 1 ? 320 : "none",
                      overflow: textWidgets.length > 1 ? "auto" : "visible",
                      paddingRight: textWidgets.length > 1 ? 2 : 0,
                    }}
                  >
                    {textWidgets.map((tw, idx) => {
                      const ds = (Array.isArray(datasets) ? datasets : []).find(
                        (d) => String(d?.id || "") === String(tw?.datasetId || "")
                      );
                      const dsCols = Array.isArray(ds?.columns)
                        ? ds.columns.map((c) => String(c)).filter(Boolean)
                        : [];
                      return (
                        <div
                          key={`text-widget-${tw.id}`}
                          style={{
                            border:
                              selectedTextWidgetId === tw.id
                                ? "1px solid #2b6cff"
                                : "1px solid var(--border)",
                            borderRadius: 8,
                            padding: 8,
                            background: "var(--bg-elev)",
                            display: "grid",
                            gap: 6,
                          }}
                        >
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 6 }}>
                            <input
                              value={String(tw.label || "")}
                              onChange={(e) => updateTextWidget(tw.id, { label: e.target.value })}
                              placeholder={`Text ${idx + 1}`}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px", minWidth: 0 }}
                            />
                            <button
                              onClick={() => setSelectedTextWidgetId(tw.id)}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                            >
                              Select
                            </button>
                            <button
                              onClick={() => removeTextWidget(tw.id)}
                              style={{ border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8, padding: "6px 8px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                            >
                              Remove
                            </button>
                          </div>
                          <input
                            value={String(tw.value || "")}
                            onChange={(e) => updateTextWidget(tw.id, { value: e.target.value })}
                            placeholder="Text value"
                            style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                          />
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                            <div style={{ display: "grid", gap: 4 }}>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dataset</div>
                              <select
                                value={String(tw.datasetId || "")}
                                onChange={(e) => updateTextWidget(tw.id, { datasetId: e.target.value, column: "" })}
                                style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                              >
                                <option value="">No Dataset Binding</option>
                                {datasets.map((dsOpt) => (
                                  <option key={`tw-ds-${tw.id}-${dsOpt.id}`} value={String(dsOpt.id)}>
                                    {String(dsOpt.name || "Dataset")}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div style={{ display: "grid", gap: 4 }}>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Text Field Column</div>
                              <select
                                value={String(tw.column || "")}
                                onChange={(e) => updateTextWidget(tw.id, { column: e.target.value })}
                                disabled={!tw.datasetId}
                                style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px", opacity: tw.datasetId ? 1 : 0.6 }}
                              >
                                <option value="">{tw.datasetId ? "Select field..." : "Select dataset first"}</option>
                                {dsCols.map((col) => (
                                  <option key={`tw-col-${tw.id}-${col}`} value={String(col)}>
                                    {toDisplayLabel(col)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          {tw.datasetId && tw.column ? (
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              Text field uses <strong>Top 1 row</strong> from dataset and column{" "}
                              <strong>{toDisplayLabel(String(tw.column || ""))}</strong>.
                            </div>
                          ) : null}
                          <div style={{ display: "grid", gridTemplateColumns: "78px 78px minmax(0,1fr) 78px", gap: 6 }}>
                            <input
                              type="number"
                              min={0}
                              value={Math.max(0, Number(tw.x) || 0)}
                              onChange={(e) => updateTextWidget(tw.id, { x: Math.max(0, Number(e.target.value) || 0) })}
                              placeholder="X"
                              title="X Position"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                            <input
                              type="number"
                              min={0}
                              value={Math.max(0, Number(tw.y) || 0)}
                              onChange={(e) => updateTextWidget(tw.id, { y: Math.max(0, Number(e.target.value) || 0) })}
                              placeholder="Y"
                              title="Y Position"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                            <select
                              value={String(tw.fontFamily || TEXT_FONTS[0])}
                              onChange={(e) => updateTextWidget(tw.id, { fontFamily: e.target.value })}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            >
                              {TEXT_FONTS.map((font) => (
                                <option key={`tw-font-${tw.id}-${font}`} value={font}>
                                  {font.split(",")[0]}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={8}
                              max={72}
                              value={Math.min(72, Math.max(8, Number(tw.fontSize) || 14))}
                              onChange={(e) =>
                                updateTextWidget(tw.id, {
                                  fontSize: Math.min(72, Math.max(8, Number(e.target.value) || 14)),
                                })
                              }
                              placeholder="Size"
                              title="Font Size"
                              style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                            />
                          </div>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
                            <input
                              type="checkbox"
                              checked={Boolean(tw?.isHeaderField)}
                              onChange={(e) => updateTextWidget(tw.id, { isHeaderField: Boolean(e.target.checked) })}
                            />
                            Header Field
                          </label>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    No text widgets yet. Click "Add Text".
                  </div>
                )}
              </div>
              ) : null}
            </div>
          </div>
          <div
            style={{
              borderTop: "1px solid var(--border)",
              background: "var(--bg-elev)",
              padding: 12,
              position: "sticky",
              bottom: 0,
              zIndex: 2,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={runPreview}
                disabled={running}
                title={running ? "Running Preview" : "Run Preview"}
                aria-label={running ? "Running Preview" : "Run Preview"}
                style={{ border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, width: 34, height: 34, padding: 0, cursor: "pointer", fontSize: 15, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
              >
                {running ? (
                  <span style={{ fontSize: 15, lineHeight: 1 }}>…</span>
                ) : (
                  <Icon>
                    <polygon points="8 6 18 12 8 18 8 6" fill="currentColor" stroke="none" />
                  </Icon>
                )}
              </button>
              <button
                onClick={saveReport}
                disabled={saving}
                title={saving ? "Saving Report" : activeReportId ? "Save Changes" : "Create Report"}
                aria-label={saving ? "Saving Report" : activeReportId ? "Save Changes" : "Create Report"}
                style={{ border: "1px solid #12b76a", background: "#12b76a", color: "white", borderRadius: 8, width: 34, height: 34, padding: 0, cursor: "pointer", fontSize: 15, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
              >
                {saving ? (
                  <span style={{ fontSize: 15, lineHeight: 1 }}>…</span>
                ) : (
                  <Icon>
                    <path d="M5 4h12l2 2v14H5z" />
                    <path d="M8 4v6h8V4" />
                    <path d="M8 20v-5h8v5" />
                  </Icon>
                )}
              </button>
              <button
                onClick={deleteReport}
                disabled={!activeReportId || deleting}
                aria-label={deleting ? "Deleting Report" : "Delete Report"}
                style={{
                  border: "1px solid #f04438",
                  background: !activeReportId || deleting ? "rgba(240,68,56,0.55)" : "#f04438",
                  color: "white",
                  borderRadius: 8,
                  width: 34,
                  height: 34,
                  padding: 0,
                  cursor: !activeReportId || deleting ? "not-allowed" : "pointer",
                  opacity: !activeReportId || deleting ? 0.9 : 1,
                  fontSize: 15,
                  fontWeight: 700,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                }}
                title={activeReportId ? "Delete Selected Report" : "Select a saved report first"}
              >
                {deleting ? (
                  <span style={{ fontSize: 15, lineHeight: 1 }}>…</span>
                ) : (
                  <Icon>
                    <path d="M4 7h16" />
                    <path d="M9 7V5h6v2" />
                    <rect x="6.5" y="7" width="11" height="13" rx="1.5" />
                    <path d="M10 11v6M14 11v6" />
                  </Icon>
                )}
              </button>
              {selectedWidgetId ? (
                <button
                  onClick={removeSelectedTableWidget}
                  title="Delete Selected Layout Table"
                  aria-label="Delete selected layout table"
                  style={{
                    border: "1px solid #f04438",
                    background: "#f04438",
                    color: "white",
                    borderRadius: 8,
                    width: 34,
                    height: 34,
                    padding: 0,
                    cursor: "pointer",
                    fontSize: 15,
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  <Icon>
                    <path d="M4 7h16" />
                    <path d="M9 7V5h6v2" />
                    <rect x="6.5" y="7" width="11" height="13" rx="1.5" />
                    <path d="M10 11v6M14 11v6" />
                  </Icon>
                </button>
              ) : null}
              <button
                onClick={printReportArea}
                title="Print / Save As PDF"
                aria-label="Print / Save As PDF"
                style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, width: 34, height: 34, padding: 0, cursor: "pointer", fontSize: 15, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
              >
                <Icon>
                  <rect x="7" y="3.5" width="10" height="5" rx="1" />
                  <rect x="6" y="13" width="12" height="7.5" rx="1" />
                  <rect x="4" y="8.5" width="16" height="7" rx="2" />
                </Icon>
              </button>
              <button
                onClick={exportPreviewToExcel}
                title="Export To Excel"
                aria-label="Export To Excel"
                style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, width: 34, height: 34, padding: 0, cursor: "pointer", fontSize: 15, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}
              >
                <Icon>
                  <path d="M14 3H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V9z" />
                  <path d="M14 3v6h6" />
                  <path d="M9 12l4 6" />
                  <path d="M13 12l-4 6" />
                </Icon>
              </button>
            </div>
          </div>
        </div>

        {!datasetOnly ? (
        <>
        <div
          data-print-panel="splitter"
          onMouseDown={(e) => {
            e.preventDefault();
            resizeRef.current = { startX: e.clientX, startW: editorWidth };
          }}
          title="Drag to resize editor"
          style={{
            cursor: "col-resize",
            background: "transparent",
            position: "relative",
            margin: "0 2px",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 0,
              bottom: 0,
              width: 2,
              transform: "translateX(-50%)",
              background: "var(--border)",
              borderRadius: 999,
              opacity: 0.8,
            }}
          />
        </div>

        <div data-print-panel="preview-wrap" style={{ border: "1px solid var(--border)", borderRadius: 0, background: "var(--bg-soft)", overflow: "auto", position: "relative" }}>
          <div
            data-print-hide="true"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 3,
              display: "grid",
              gap: 10,
              padding: "10px 12px",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-elev)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Layout Toolbar</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={addTextWidget}
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-soft)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Add Text
                </button>
                <button
                  onClick={addCurrentTableToPreview}
                  disabled={!canAddTableToLayout}
                  title={canAddTableToLayout ? "Add selected dataset as table" : "Select a dataset first"}
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-soft)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    cursor: canAddTableToLayout ? "pointer" : "not-allowed",
                    opacity: canAddTableToLayout ? 1 : 0.5,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Add Table
                </button>
              </div>
            </div>
            {reportFilterControls.length ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 10,
                  alignItems: "end",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
                  {reportFilterControls.map((ctrl) => (
                    <div key={`rf-${ctrl.widgetId}-${ctrl.filterIndex}`} style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{ctrl.label}</div>
                      {ctrl.isForeign ? (
                        <select
                          value={ctrl.value}
                          onChange={(e) => updateWidgetFilterValue(ctrl.widgetId, ctrl.filterIndex, e.target.value)}
                          style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                        >
                          <option value="">Select...</option>
                          {(Array.isArray(ctrl.options) ? ctrl.options : []).map((opt, idx) => (
                            <option key={`rf-opt-${ctrl.widgetId}-${ctrl.filterIndex}-${idx}`} value={String(opt?.value ?? "")}>
                              {String(opt?.label || opt?.value || "")}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={ctrl.value}
                          onChange={(e) => updateWidgetFilterValue(ctrl.widgetId, ctrl.filterIndex, e.target.value)}
                          placeholder="Filter value"
                          style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", color: "var(--text)", borderRadius: 8, padding: "7px 9px" }}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <button
                  onClick={runHeaderFilters}
                  disabled={running}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "white",
                    borderRadius: 8,
                    padding: "8px 12px",
                    cursor: running ? "not-allowed" : "pointer",
                    opacity: running ? 0.7 : 1,
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {running ? "Running..." : "Run"}
                </button>
              </div>
            ) : null}
          </div>
          <div
            style={{
              width: previewDisplayWidth,
              minHeight: previewDisplayHeight,
              margin: "20px auto",
              position: "relative",
              overflow: "visible",
            }}
          >
            <div
              id="report-print-scope"
              ref={reportPrintRef}
              style={{
                width: pageWidthPx,
                minHeight: pageHeightPx,
                background: "white",
                color: "#111827",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                boxShadow: "0 18px 42px rgba(2, 6, 23, 0.14)",
                padding: pagePadding,
                boxSizing: "border-box",
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
              }}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                setLogoSelected(false);
                setSelectedPreviewTextKey("");
                setSelectedTextWidgetId("");
                setSelectedWidgetId("");
              }}
            >
            <div style={{ display: "grid", justifyItems: "start", gap: 8, marginBottom: 12 }}>
              {effectiveLogoSrc ? (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    setLogoSelected(true);
                    setSelectedPreviewTextKey("");
                  }}
                  style={{
                    position: "relative",
                    display: "inline-block",
                    outline: logoSelected && !isPreparingPrint ? "2px solid #2b6cff" : "none",
                    boxShadow:
                      logoSelected && !isPreparingPrint
                        ? "0 0 0 2px rgba(43,108,255,0.2)"
                        : "none",
                    borderRadius: 6,
                    padding: logoSelected && !isPreparingPrint ? 4 : 0,
                  }}
                >
                  <img
                    src={effectiveLogoSrc}
                    alt="logo"
                    onWheel={(e) => {
                      if (!logoSelected) return;
                      e.preventDefault();
                      const delta = e.deltaY > 0 ? -8 : 8;
                      const next = Math.min(360, Math.max(80, logoWidth + delta));
                      setLogoWidth(next);
                      if (activeReportId) saveLayoutFor(activeReportId, { logoWidth: next });
                    }}
                    style={{
                      display: "block",
                      height: "auto",
                      width: logoWidth,
                      maxWidth: 360,
                      objectFit: "contain",
                      objectPosition: "left center",
                      aspectRatio: "auto",
                      cursor: logoSelected ? "ew-resize" : "pointer",
                    }}
                  />
                  {logoSelected ? (
                    <div
                      data-print-hide="true"
                      title="Drag to resize logo"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        logoResizeRef.current = { startX: e.clientX, startW: logoWidth };
                      }}
                      style={{
                        position: "absolute",
                        right: -6,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 12,
                        height: 28,
                        borderRadius: 6,
                        background: "#2b6cff",
                        cursor: "ew-resize",
                      }}
                    />
                  ) : null}
                </div>
              ) : null}
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent:
                    String(headerFormat?.align || "left") === "center"
                      ? "center"
                      : String(headerFormat?.align || "left") === "right"
                      ? "flex-end"
                      : "flex-start",
                }}
              >
                <div
                  style={{
                    position: "relative",
                    display: "inline-block",
                    maxWidth: "100%",
                    background:
                      String(headerFormat?.variant || "plain") === "band"
                        ? "#f2f6ff"
                        : "transparent",
                    borderRadius:
                      String(headerFormat?.variant || "plain") === "band" ? 8 : 6,
                    border:
                      selectedPreviewTextKey === "header" && !isPreparingPrint
                        ? "2px solid #2b6cff"
                        : "2px solid transparent",
                    boxShadow:
                      selectedPreviewTextKey === "header" && !isPreparingPrint
                        ? "0 0 0 2px rgba(43,108,255,0.2)"
                        : "none",
                    padding:
                      String(headerFormat?.variant || "plain") === "band"
                        ? "8px 10px"
                        : 4,
                  }}
                >
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTextKey("header");
                      setSelectedPreviewTextKey("header");
                      setLogoSelected(false);
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    onInput={(e) => setHeaderText(e.currentTarget.textContent || "")}
                    style={{
                      fontSize: Number(textStyles?.header?.fontSize) || 28,
                      fontWeight: 800,
                      color: String(textStyles?.header?.color || "#111827"),
                      fontFamily: String(textStyles?.header?.fontFamily || TEXT_FONTS[0]),
                      outline: "none",
                      borderRadius: 4,
                      padding: 0,
                      cursor: "text",
                    }}
                  >
                    {headerText || "Report"}
                  </div>
                  {selectedPreviewTextKey === "header" ? (
                    <div
                      data-print-hide="true"
                      title="Drag up/down to resize font"
                      onMouseDown={(e) => startTextResize(e, "header")}
                      style={{
                        position: "absolute",
                        right: -10,
                        top: "50%",
                        transform: "translateY(-50%)",
                        width: 8,
                        height: 24,
                        borderRadius: 8,
                        background: "#2b6cff",
                        cursor: "ns-resize",
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
            <div
              ref={previewLayoutRef}
              data-print-panel="layout-canvas"
              style={{
                border: "1px solid #d8dee8",
                borderRadius: 10,
                overflow: "visible",
                background: "linear-gradient(180deg, #fbfcfe 0%, #f4f7fb 100%)",
                position: "relative",
                minHeight: previewTableMinHeight,
              }}
            >
              {textWidgets.map((tw) => {
                const isSelected = selectedTextWidgetId === tw.id && !isPreparingPrint;
                const displayValue = resolveTextWidgetValue(tw);
                return (
                  <div
                    key={`preview-text-widget-${tw.id}`}
                    data-print-panel="text-widget"
                    onDoubleClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isPreparingPrint) return;
                      setEditorTab("text");
                      setLayoutWidgetsTab("text");
                      setSelectedTextWidgetId(tw.id);
                      setSelectedWidgetId("");
                      setSelectedPreviewTextKey("");
                      setLogoSelected(false);
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isPreparingPrint) return;
                      setSelectedTextWidgetId(tw.id);
                      setSelectedWidgetId("");
                      setSelectedPreviewTextKey("");
                      setLogoSelected(false);
                      textWidgetDragRef.current = {
                        id: tw.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        startLeft: Number(tw.x) || 0,
                        startTop: Number(tw.y) || 0,
                      };
                    }}
                    style={{
                      position: isPreparingPrint ? "static" : "absolute",
                      left: isPreparingPrint ? "auto" : Math.max(0, Number(tw.x) || 0),
                      top: isPreparingPrint ? "auto" : Math.max(0, Number(tw.y) || 0),
                      marginBottom: isPreparingPrint ? 8 : 0,
                      padding: "2px 4px",
                      borderRadius: 6,
                      border: isSelected ? "2px solid #2b6cff" : "1px solid transparent",
                      boxShadow: isSelected ? "0 0 0 2px rgba(43,108,255,0.2)" : "none",
                      cursor: isPreparingPrint ? "default" : "move",
                      zIndex: 2,
                      userSelect: "none",
                    }}
                  >
                    <div
                      style={{
                        fontSize: Math.min(72, Math.max(8, Number(tw.fontSize) || 14)),
                        fontFamily: String(tw.fontFamily || TEXT_FONTS[0]),
                        color: String(tw.color || "#111827"),
                        whiteSpace: "nowrap",
                      }}
                    >
                      {String(displayValue || tw.value || "Text")}
                    </div>
                    {isSelected ? (
                      <button
                        data-print-hide="true"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeTextWidget(tw.id);
                        }}
                        title="Delete selected text"
                        aria-label="Delete selected text"
                        style={{
                          position: "absolute",
                          top: -10,
                          right: -10,
                          border: "1px solid #f04438",
                          background: "#f04438",
                          color: "white",
                          borderRadius: 999,
                          width: 20,
                          height: 20,
                          padding: 0,
                          cursor: "pointer",
                          fontSize: 12,
                          fontWeight: 800,
                          lineHeight: 1,
                        }}
                      >
                        x
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {tableWidgets.map((tbl) => (
                (() => {
                  const isSelected = selectedWidgetId === tbl.id && !isPreparingPrint;
                  return (
                <div
                  key={tbl.id}
                  data-print-panel="table-widget"
                  data-selected={isSelected ? "true" : "false"}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isPreparingPrint) return;
                    setEditorTab("tables");
                    setLayoutWidgetsTab("tables");
                    setSelectedWidgetId(tbl.id);
                    setSelectedTextWidgetId("");
                    setLogoSelected(false);
                    setSelectedPreviewTextKey("");
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelectedWidgetId(tbl.id);
                    setSelectedTextWidgetId("");
                    setLogoSelected(false);
                    setSelectedPreviewTextKey("");
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    left: Math.max(0, Number(tbl.x) || 0),
                    top: Math.max(0, Number(tbl.y) || 0),
                    width: Math.max(1, Number(tbl.width) || 420),
                    boxSizing: "border-box",
                    border: isSelected ? "2px solid #2b6cff" : "1px solid #d7deea",
                    borderRadius: 10,
                    background: "white",
                    boxShadow: isSelected
                      ? "0 0 0 2px rgba(43,108,255,0.35), 0 14px 30px rgba(15,23,42,0.16)"
                      : "0 10px 24px rgba(15,23,42,0.10)",
                    overflow: "hidden",
                  }}
                >
                  {isSelected ? (
                    <div
                      data-print-hide="true"
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        zIndex: 2,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <div
                        style={{
                          border: "1px solid #2b6cff",
                          background: "#eef4ff",
                          color: "#1d4ed8",
                          borderRadius: 999,
                          padding: "2px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                          lineHeight: 1.4,
                        }}
                      >
                        Selected
                      </div>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeTableFromPreview(tbl.id);
                        }}
                        title="Delete selected table"
                        aria-label="Delete selected table"
                        style={{
                          border: "1px solid #f04438",
                          background: "#f04438",
                          color: "white",
                          borderRadius: 999,
                          width: 24,
                          height: 24,
                          padding: 0,
                          cursor: "pointer",
                          fontSize: 14,
                          fontWeight: 800,
                          lineHeight: 1,
                        }}
                      >
                        x
                      </button>
                    </div>
                  ) : null}
                  <div
                    data-print-panel="table-body-wrap"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedWidgetId(tbl.id);
                      setSelectedTextWidgetId("");
                      tableDragRef.current = {
                        id: tbl.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        startLeft: Number(tbl.x) || 0,
                        startTop: Number(tbl.y) || 0,
                      };
                    }}
                    style={{
                      overflow: "hidden",
                      height: Math.max(120, Number(tbl.height) || 280),
                      width: "100%",
                      cursor: "move",
                    }}
                  >
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: Math.min(20, Math.max(9, Number(tbl.fontSize) || 12)),
                        fontFamily: String(tbl.fontFamily || TEXT_FONTS[0]),
                        tableLayout: "fixed",
                      }}
                    >
                      <thead>
                        <tr style={{ background: "#f4f7fb" }}>
                          {tbl.columns.map((col) => (
                            <th
                              key={`h-${tbl.id}-${col}`}
                              style={{
                                textAlign: "left",
                                borderBottom: "1px solid #d0d5dd",
                                padding: "6px 8px",
                                fontWeight: 700,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {String(columnLabels[String(col)] || toDisplayLabel(col))}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(isPreparingPrint
                          ? (Array.isArray(tbl.rows) ? tbl.rows : []).slice(
                              0,
                              Math.min(200, Math.max(1, Number(tbl.rowLimit) || 20))
                            )
                          : (Array.isArray(tbl.rows) ? tbl.rows : [])
                              .slice(0, Math.min(200, Math.max(1, Number(tbl.rowLimit) || 20)))
                              .slice(0, 2)
                        ).map((row, rowIdx) => (
                          <tr key={`r-${tbl.id}-${rowIdx}`}>
                            {tbl.columns.map((col) => (
                              <td
                                key={`c-${tbl.id}-${rowIdx}-${col}`}
                                style={{
                                  borderBottom: "1px solid #eaecf0",
                                  padding: "6px 8px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {renderCell(row?.[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {tbl.summaryRow ? (
                          <tr style={{ background: "#eef4ff", fontWeight: 700 }}>
                            {tbl.columns.map((col) => (
                              <td
                                key={`s-${tbl.id}-${col}`}
                                style={{
                                  borderTop: "1px solid #d0d5dd",
                                  padding: "7px 8px",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {renderCell(tbl.summaryRow?.[col])}
                              </td>
                            ))}
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  {isSelected ? (
                    <>
                      <div
                        data-print-hide="true"
                        title="Drag right edge to resize width"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedWidgetId(tbl.id);
                          setSelectedTextWidgetId("");
                          tableResizeRef.current = {
                            id: tbl.id,
                            mode: "x",
                            startX: e.clientX,
                            startY: e.clientY,
                            startWidth: Math.max(240, Number(tbl.width) || 420),
                            startHeight: Math.max(140, Number(tbl.height) || 280),
                          };
                        }}
                        style={{
                          position: "absolute",
                          right: -3,
                          top: 10,
                          bottom: 10,
                          width: 8,
                          cursor: "ew-resize",
                          background: "transparent",
                        }}
                      />
                      <div
                        data-print-hide="true"
                        title="Drag bottom edge to resize height"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedWidgetId(tbl.id);
                          setSelectedTextWidgetId("");
                          tableResizeRef.current = {
                            id: tbl.id,
                            mode: "y",
                            startX: e.clientX,
                            startY: e.clientY,
                            startWidth: Math.max(240, Number(tbl.width) || 420),
                            startHeight: Math.max(140, Number(tbl.height) || 280),
                          };
                        }}
                        style={{
                          position: "absolute",
                          left: 10,
                          right: 10,
                          bottom: -3,
                          height: 8,
                          cursor: "ns-resize",
                          background: "transparent",
                        }}
                      />
                      <div
                        data-print-hide="true"
                        title="Drag corner to resize"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedWidgetId(tbl.id);
                          setSelectedTextWidgetId("");
                          tableResizeRef.current = {
                            id: tbl.id,
                            mode: "xy",
                            startX: e.clientX,
                            startY: e.clientY,
                            startWidth: Math.max(240, Number(tbl.width) || 420),
                            startHeight: Math.max(140, Number(tbl.height) || 280),
                          };
                        }}
                        style={{
                          position: "absolute",
                          right: -2,
                          bottom: -2,
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          background: "#2b6cff",
                          cursor: "nwse-resize",
                          opacity: 0.95,
                        }}
                      />
                    </>
                  ) : null}
                </div>
                  );
                })()
              ))}
              {!tableWidgets.length ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    color: "#667085",
                    fontSize: 12,
                    textAlign: "center",
                    padding: 16,
                  }}
                >
                  {Array.isArray(columns) && columns.length
                    ? "Preview data is ready. Click \"Add Table to Layout\" to place a resizable table."
                    : "Run preview, then use \"Add Table to Layout\" in the editor panel."}
                </div>
              ) : null}
            </div>
            <div
              style={{
                marginTop: 12,
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: Math.min(14, Math.max(10, Number(textStyles?.footer?.fontSize) || 12)),
                  color: String(textStyles?.footer?.color || "#667085"),
                  fontFamily: String(textStyles?.footer?.fontFamily || TEXT_FONTS[0]),
                  textAlign: "left",
                }}
              >
                {reportTimestamp}
              </div>
              <div
                style={{
                  fontSize: Math.min(14, Math.max(10, Number(textStyles?.footer?.fontSize) || 12)),
                  color: String(textStyles?.footer?.color || "#667085"),
                  fontFamily: String(textStyles?.footer?.fontFamily || TEXT_FONTS[0]),
                  textAlign: "right",
                }}
              >
                {footerText}
              </div>
            </div>
            {signatureEnabled ? (
              <div
                style={{
                  marginTop: 16,
                  width: "100%",
                  display: "flex",
                  justifyContent:
                    signatureAlign === "left"
                      ? "flex-start"
                      : signatureAlign === "center"
                      ? "center"
                      : "flex-end",
                }}
              >
                <div style={{ width: Math.min(pageWidthPx - pagePadding * 2, Math.max(120, Number(signatureLineWidth) || 220)) }}>
                  <div style={{ borderTop: "1px solid #98a2b3", height: 1 }} />
                  {String(signatureName || "").trim() ? (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: Math.min(16, Math.max(10, Number(textStyles?.footer?.fontSize) || 12)),
                        color: String(textStyles?.footer?.color || "#667085"),
                        fontFamily: String(textStyles?.footer?.fontFamily || TEXT_FONTS[0]),
                        fontWeight: 600,
                        textAlign: "center",
                      }}
                    >
                      {signatureName}
                    </div>
                  ) : null}
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: Math.min(14, Math.max(10, Number(textStyles?.footer?.fontSize) || 12)),
                      color: String(textStyles?.footer?.color || "#667085"),
                      fontFamily: String(textStyles?.footer?.fontFamily || TEXT_FONTS[0]),
                      textAlign: "center",
                    }}
                  >
                    {String(signatureLabel || "").trim() || "Signature"}
                  </div>
                </div>
              </div>
            ) : null}
            </div>
          </div>
          <div
            data-print-hide="true"
            style={{
              position: "fixed",
              right: 20,
              bottom: 20,
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
              borderRadius: 10,
              padding: "8px 10px",
              boxShadow: "0 8px 20px rgba(2, 6, 23, 0.16)",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              alignItems: "center",
              minWidth: 210,
              zIndex: 40,
            }}
          >
            <input
              type="range"
              min={60}
              max={140}
              step={5}
              value={Math.min(140, Math.max(60, Number(previewZoom) || 100))}
              onChange={(e) =>
                setPreviewZoom(Math.min(140, Math.max(60, Number(e.target.value) || 100)))
              }
            />
            <div style={{ fontSize: 12, textAlign: "right", color: "var(--text-muted)", minWidth: 64 }}>
              Zoom {Math.round(previewZoom)}%
            </div>
          </div>
        </div>
        </>
        ) : null}
      </div>
    </div>
    )
  );
}
