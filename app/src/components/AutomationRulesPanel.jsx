import { useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { toastError, toastSuccess } from "../utils/toast";
import { requestJson } from "../api/http";
import { listProjects } from "../api/projectApi";
import { listRoutesByProject, listAllRoutes } from "../api/dbApi";
import SearchableSelect from "./SearchableSelect";

const TRIGGER_SOURCE_OPTIONS = ["tag", "db"];
const TRIGGER_MODE_OPTIONS = ["change", "rising", "falling", "counter_change", "counter_increase", "counter_decrease"];
const CONDITION_OPERATOR_OPTIONS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  ">",
  ">=",
  "<",
  "<=",
  "truthy",
  "falsy",
  "changed",
];
const ACTION_TYPE_OPTIONS = [
  "db.insert",
  "db.update",
  "db.select",
  "dataset.select",
  "tag.read",
  "tag.write",
  "webhook",
  "delay",
  "for_each",
];

function makeCondition() {
  return { tag: "", op: "equals", value: "" };
}

function makeAction(type = "db.insert") {
  return {
    type,
    when: [],
    table: "",
    values: {},
    where: {},
    orderBy: "",
    orderDir: "asc",
    limit: 200,
    saveAs: "rows",
    reportId: "",
    datasetId: "",
    tag: "",
    value: "",
    uaType: "",
    url: "",
    method: "POST",
    headers: {},
    body: "",
    ms: 0,
    source: "rows",
    actions: [],
  };
}

function makeRule(projectId = "") {
  return {
    id: "",
    name: "",
    enabled: true,
    project_id: projectId,
    scope_project_id: projectId,
    scope_route_id: "",
    trigger_source: "tag",
    trigger_tag: "",
    trigger_mode: "change",
    trigger_table: "",
    trigger_column: "",
    trigger_where: {},
    trigger_order_by: "",
    trigger_order_dir: "asc",
    conditions: [],
    actions: [],
    cooldown_ms: 0,
    last_fired_at: "",
    created_at: "",
    updated_at: "",
  };
}

function parseJsonText(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function normalizeRuleRow(row, defaultProjectId = "") {
  return {
    id: String(row?.id || ""),
    name: String(row?.name || ""),
    enabled: row?.enabled !== false,
    project_id: String(row?.project_id || defaultProjectId || ""),
    scope_project_id: String(row?.scope_project_id || defaultProjectId || ""),
    scope_route_id: String(row?.scope_route_id || ""),
    trigger_source: String(row?.trigger_source || "tag"),
    trigger_tag: String(row?.trigger_tag || ""),
    trigger_mode: String(row?.trigger_mode || "change"),
    trigger_table: String(row?.trigger_table || ""),
    trigger_column: String(row?.trigger_column || ""),
    trigger_where: parseJsonText(row?.trigger_where_json, {}),
    trigger_order_by: String(row?.trigger_order_by || ""),
    trigger_order_dir: String(row?.trigger_order_dir || "asc"),
    conditions: Array.isArray(parseJsonText(row?.conditions_json, [])) ? parseJsonText(row?.conditions_json, []) : [],
    actions: Array.isArray(parseJsonText(row?.actions_json, [])) ? parseJsonText(row?.actions_json, []) : [],
    cooldown_ms: Number.parseInt(String(row?.cooldown_ms || 0), 10) || 0,
    last_fired_at: String(row?.last_fired_at || ""),
    created_at: String(row?.created_at || ""),
    updated_at: String(row?.updated_at || ""),
  };
}

function cloneCondition(condition) {
  return { ...(condition || {}) };
}

function cloneAction(action) {
  return {
    ...(action || {}),
    when: Array.isArray(action?.when) ? action.when.map(cloneCondition) : [],
    values: action?.values && typeof action.values === "object" && !Array.isArray(action.values) ? { ...action.values } : {},
    where: action?.where && typeof action.where === "object" && !Array.isArray(action.where) ? { ...action.where } : {},
    headers: action?.headers && typeof action.headers === "object" && !Array.isArray(action.headers) ? { ...action.headers } : {},
    actions: Array.isArray(action?.actions) ? action.actions.map(cloneAction) : [],
  };
}

function cloneRuleDraft(rule, defaultProjectId = "") {
  const normalized =
    Array.isArray(rule?.conditions) || Array.isArray(rule?.actions)
      ? {
          id: String(rule?.id || ""),
          name: String(rule?.name || ""),
          enabled: rule?.enabled !== false,
          project_id: String(rule?.project_id || defaultProjectId || ""),
          scope_project_id: String(rule?.scope_project_id || defaultProjectId || ""),
          scope_route_id: String(rule?.scope_route_id || ""),
          trigger_source: String(rule?.trigger_source || "tag"),
          trigger_tag: String(rule?.trigger_tag || ""),
          trigger_mode: String(rule?.trigger_mode || "change"),
          trigger_table: String(rule?.trigger_table || ""),
          trigger_column: String(rule?.trigger_column || ""),
          trigger_where:
            rule?.trigger_where && typeof rule.trigger_where === "object" && !Array.isArray(rule.trigger_where)
              ? { ...rule.trigger_where }
              : {},
          trigger_order_by: String(rule?.trigger_order_by || ""),
          trigger_order_dir: String(rule?.trigger_order_dir || "asc"),
          conditions: Array.isArray(rule?.conditions) ? rule.conditions : [],
          actions: Array.isArray(rule?.actions) ? rule.actions : [],
          cooldown_ms: Number.parseInt(String(rule?.cooldown_ms || 0), 10) || 0,
          last_fired_at: String(rule?.last_fired_at || ""),
          created_at: String(rule?.created_at || ""),
          updated_at: String(rule?.updated_at || ""),
        }
      : normalizeRuleRow(rule, defaultProjectId);
  return {
    ...normalized,
    trigger_where:
      normalized?.trigger_where && typeof normalized.trigger_where === "object" && !Array.isArray(normalized.trigger_where)
        ? { ...normalized.trigger_where }
        : parseJsonText(normalized?.trigger_where, {}),
    conditions: Array.isArray(normalized?.conditions) ? normalized.conditions.map(cloneCondition) : [],
    actions: Array.isArray(normalized?.actions) ? normalized.actions.map(cloneAction) : [],
  };
}

function serializeRuleDraft(rule) {
  return {
    name: String(rule?.name || "").trim(),
    enabled: rule?.enabled !== false,
    project_id: String(rule?.project_id || "").trim() || null,
    scope_project_id: String(rule?.scope_project_id || "").trim() || null,
    scope_route_id: String(rule?.scope_route_id || "").trim() || null,
    trigger_source: String(rule?.trigger_source || "tag").trim() || "tag",
    trigger_tag: String(rule?.trigger_tag || "").trim(),
    trigger_mode: String(rule?.trigger_mode || "change").trim(),
    trigger_table: String(rule?.trigger_table || "").trim(),
    trigger_column: String(rule?.trigger_column || "").trim(),
    trigger_where_json: JSON.stringify(rule?.trigger_where && typeof rule.trigger_where === "object" ? rule.trigger_where : {}),
    trigger_order_by: String(rule?.trigger_order_by || "").trim(),
    trigger_order_dir: String(rule?.trigger_order_dir || "asc").trim() || "asc",
    conditions_json: JSON.stringify(Array.isArray(rule?.conditions) ? rule.conditions : []),
    actions_json: JSON.stringify(Array.isArray(rule?.actions) ? rule.actions : []),
    cooldown_ms: Math.max(0, Number.parseInt(String(rule?.cooldown_ms || 0), 10) || 0),
  };
}

function formatDateTime(value) {
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "";
}

function normalizeDbDataType(value) {
  return String(value || "").trim().toLowerCase();
}

function isBooleanDbType(dataType) {
  return normalizeDbDataType(dataType) === "boolean";
}

function isNumericDbType(dataType) {
  return [
    "smallint",
    "integer",
    "bigint",
    "decimal",
    "numeric",
    "real",
    "double precision",
  ].includes(normalizeDbDataType(dataType));
}

function isDateDbType(dataType) {
  return ["date", "timestamp without time zone", "timestamp with time zone"].includes(normalizeDbDataType(dataType));
}

function KeyValueEditor({
  title,
  value,
  onChange,
  valuePlaceholder = "Value",
  keyOptions = [],
  dataTypeByKey = {},
}) {
  const entries = useMemo(() => Object.entries(value && typeof value === "object" && !Array.isArray(value) ? value : {}), [value]);
  const rows = [...entries, ["", ""]];
  const setEntry = (idx, field, nextValue) => {
    const nextRows = rows.map(([k, v], rowIdx) => {
      if (rowIdx !== idx) return [k, v];
      return field === "key" ? [nextValue, v] : [k, nextValue];
    });
    const nextObject = {};
    nextRows.forEach(([k, v]) => {
      const key = String(k || "").trim();
      if (!key) return;
      nextObject[key] = v;
    });
    onChange(nextObject);
  };
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }} title={`${title}: define key/value pairs for this section.`}>{title}</div>
      {rows.map(([k, v], idx) => (
        <div key={`${title}-${idx}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 6 }}>
          <SearchableSelect
            value={String(k || "")}
            onChange={(nextKey) => setEntry(idx, "key", nextKey)}
            options={keyOptions}
            placeholder="Key"
            allowCustom
            title={`${title} key. Pick a column or type a custom key.`}
            style={searchableInputStyle}
          />
          {isBooleanDbType(dataTypeByKey?.[String(k || "")]) ? (
            <select
              value={String(v ?? "")}
              onChange={(e) => setEntry(idx, "value", e.target.value)}
              title={`${title} value. Boolean field.`}
              style={inputStyle}
            >
              <option value="">Select</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : isNumericDbType(dataTypeByKey?.[String(k || "")]) ? (
            <input
              type="number"
              value={String(v ?? "")}
              onChange={(e) => setEntry(idx, "value", e.target.value)}
              placeholder={valuePlaceholder}
              title={`${title} value. Numeric field.`}
              style={inputStyle}
            />
          ) : isDateDbType(dataTypeByKey?.[String(k || "")]) ? (
            <input
              type="datetime-local"
              value={String(v ?? "")}
              onChange={(e) => setEntry(idx, "value", e.target.value)}
              placeholder={valuePlaceholder}
              title={`${title} value. Date/time field.`}
              style={inputStyle}
            />
          ) : (
            <input
              value={typeof v === "string" ? v : JSON.stringify(v)}
              onChange={(e) => setEntry(idx, "value", e.target.value)}
              placeholder={valuePlaceholder}
              title={`${title} value.`}
              style={inputStyle}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ConditionEditor({ condition, onChange, onRemove, tagOptions = [] }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 150px minmax(0,1fr) auto", gap: 6, alignItems: "center" }}>
        <SearchableSelect
          value={String(condition?.tag || "")}
          onChange={(tag) => onChange((current) => ({ ...(current || {}), tag }))}
          options={tagOptions}
          placeholder="Tag (blank = trigger value)"
          allowCustom
          title="Condition source. Pick a live tag, row field, or typed chain variable."
          style={searchableInputStyle}
        />
        <select value={String(condition?.op || "equals")} onChange={(e) => onChange((current) => ({ ...(current || {}), op: e.target.value }))} title="Condition operator." style={inputStyle}>
          {CONDITION_OPERATOR_OPTIONS.map((op) => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
        <input
          value={String(condition?.value ?? "")}
          onChange={(e) => onChange((current) => ({ ...(current || {}), value: e.target.value }))}
          placeholder="Comparison value"
          title="Condition comparison value."
          style={inputStyle}
        />
        <button type="button" data-preserve-style="true" onClick={onRemove} style={dangerButtonStyle} title="Delete this condition.">Delete</button>
      </div>
    </div>
  );
}

function ActionEditor({ action, onChange, onRemove, reports = [], tagOptions = [], dbSchema = {}, depth = 0 }) {
  const nextType = String(action?.type || "db.insert");
  const update = (patchOrFn) =>
    onChange((current) => {
      const base = current && typeof current === "object" ? current : action;
      if (typeof patchOrFn === "function") return patchOrFn(base || {});
      return { ...(base || {}), ...patchOrFn };
    });
  const nestedActions = Array.isArray(action?.actions) ? action.actions : [];
  const tableOptions = useMemo(
    () =>
      Object.keys(dbSchema && typeof dbSchema === "object" ? dbSchema : {})
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((table) => ({ value: table, label: table })),
    [dbSchema]
  );
  const selectedTableColumns = useMemo(() => {
    const table = String(action?.table || "").trim();
    const cols = table && dbSchema && typeof dbSchema === "object" ? dbSchema[table] : [];
    return Array.isArray(cols) ? cols : [];
  }, [action?.table, dbSchema]);
  const columnOptions = useMemo(
    () =>
      selectedTableColumns
        .map((col) => String(col?.column_name || "").trim())
        .filter(Boolean)
        .map((column) => ({ value: column, label: column })),
    [selectedTableColumns]
  );
  const dataTypeByColumn = useMemo(
    () =>
      Object.fromEntries(
        selectedTableColumns
          .map((col) => [String(col?.column_name || "").trim(), String(col?.data_type || "").trim()])
          .filter(([key]) => Boolean(key))
      ),
    [selectedTableColumns]
  );
  const selectedReport = useMemo(
    () => (Array.isArray(reports) ? reports.find((report) => String(report?.id || "") === String(action?.reportId || "")) || null : null),
    [reports, action?.reportId]
  );
  const datasetOptions = useMemo(() => {
    const layout = selectedReport?.layout_json && typeof selectedReport.layout_json === "object" ? selectedReport.layout_json : {};
    const datasets = Array.isArray(layout?.datasets) ? layout.datasets : [];
    return datasets.map((dataset) => ({ value: String(dataset?.id || ""), label: String(dataset?.name || dataset?.id || "") }));
  }, [selectedReport]);
  return (
    <div style={{ ...cardStyle, marginLeft: depth * 16 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "180px auto", gap: 6, alignItems: "center" }}>
          <select value={nextType} onChange={(e) => onChange(() => makeAction(e.target.value))} title="Action type." style={inputStyle}>
            {ACTION_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <button type="button" data-preserve-style="true" onClick={onRemove} style={dangerButtonStyle} title="Delete this action.">Delete</button>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }} title="Optional conditions for this action. If they do not match, this action is skipped.">Run When</div>
            <button
              type="button"
              data-preserve-style="true"
              onClick={() => update({ when: [...(Array.isArray(action?.when) ? action.when : []), makeCondition()] })}
              style={secondaryButtonStyle}
              title="Add a condition that must pass before this action runs."
            >
              Add Condition
            </button>
          </div>
          {(Array.isArray(action?.when) ? action.when : []).map((condition, idx) => (
            <ConditionEditor
              key={`action-when-${depth}-${idx}`}
              condition={condition}
              tagOptions={tagOptions}
              onChange={(next) => update({
                when: (Array.isArray(action?.when) ? action.when : []).map((row, rowIdx) => (rowIdx === idx ? (typeof next === "function" ? next(row) : next) : row)),
              })}
              onRemove={() => update({ when: (Array.isArray(action?.when) ? action.when : []).filter((_, rowIdx) => rowIdx !== idx) })}
            />
          ))}
        </div>

        {(nextType === "db.insert" || nextType === "db.update" || nextType === "db.select") ? (
          <SearchableSelect
            value={String(action?.table || "")}
            onChange={(table) => update({ table, orderBy: "" })}
            options={tableOptions}
            placeholder="Table"
            allowCustom
            title="Database table for this action."
            style={searchableInputStyle}
          />
        ) : null}

        {nextType === "db.insert" ? (
          <KeyValueEditor
            title="Values"
            value={action?.values || {}}
            onChange={(values) => update({ values })}
            keyOptions={columnOptions}
            dataTypeByKey={dataTypeByColumn}
          />
        ) : null}

        {nextType === "db.update" ? (
          <>
            <KeyValueEditor
              title="Where"
              value={action?.where || {}}
              onChange={(where) => update({ where })}
              keyOptions={columnOptions}
              dataTypeByKey={dataTypeByColumn}
            />
            <KeyValueEditor
              title="Values"
              value={action?.values || {}}
              onChange={(values) => update({ values })}
              keyOptions={columnOptions}
              dataTypeByKey={dataTypeByColumn}
            />
          </>
        ) : null}

        {nextType === "db.select" ? (
          <>
            <KeyValueEditor
              title="Where"
              value={action?.where || {}}
              onChange={(where) => update({ where })}
              keyOptions={columnOptions}
              dataTypeByKey={dataTypeByColumn}
            />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px 120px 140px", gap: 6 }}>
              <SearchableSelect
                value={String(action?.orderBy || "")}
                onChange={(orderBy) => update({ orderBy })}
                options={columnOptions}
                placeholder="Order By"
                allowCustom
                title="Column to order query results by."
                style={searchableInputStyle}
              />
              <select value={String(action?.orderDir || "asc")} onChange={(e) => update({ orderDir: e.target.value })} title="Sort direction." style={inputStyle}>
                <option value="asc">asc</option>
                <option value="desc">desc</option>
              </select>
              <input value={String(action?.limit ?? 200)} onChange={(e) => update({ limit: e.target.value })} placeholder="Limit" title="Maximum rows to read." style={inputStyle} />
              <input value={String(action?.saveAs || "rows")} onChange={(e) => update({ saveAs: e.target.value })} placeholder="Save As" title="Context key used by later actions, for example rows or resultSet." style={inputStyle} />
            </div>
          </>
        ) : null}

        {nextType === "dataset.select" ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 140px", gap: 6 }}>
            <SearchableSelect
              value={String(action?.reportId || "")}
              onChange={(reportId) => update({ reportId, datasetId: "" })}
              options={reports.map((report) => ({ value: String(report?.id || ""), label: String(report?.name || report?.id || "") }))}
              placeholder="Report"
              title="Saved report that contains the dataset."
            />
            <SearchableSelect
              value={String(action?.datasetId || "")}
              onChange={(datasetId) => update({ datasetId })}
              options={datasetOptions}
              placeholder="Dataset"
              title="Dataset to execute from the selected report."
            />
            <input value={String(action?.saveAs || "rows")} onChange={(e) => update({ saveAs: e.target.value })} placeholder="Save As" title="Context key used by later actions." style={inputStyle} />
          </div>
        ) : null}

        {nextType === "tag.read" ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 160px", gap: 6 }}>
            <SearchableSelect
              value={String(action?.tag || "")}
              onChange={(tag) => update({ tag })}
              options={tagOptions}
              placeholder="Tag (blank = trigger tag)"
              allowCustom
              title="Tag to read. Leave blank to use the trigger tag."
              style={searchableInputStyle}
            />
            <input value={String(action?.saveAs || "tagValue")} onChange={(e) => update({ saveAs: e.target.value })} placeholder="Save As" title="Context key for the read value." style={inputStyle} />
          </div>
        ) : null}

        {nextType === "tag.write" ? (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 140px", gap: 6 }}>
            <SearchableSelect
              value={String(action?.tag || "")}
              onChange={(tag) => update({ tag })}
              options={tagOptions}
              placeholder="Tag"
              allowCustom
              title="Tag to write."
              style={searchableInputStyle}
            />
            <input value={String(action?.value ?? "")} onChange={(e) => update({ value: e.target.value })} placeholder="Value or {{template}}" title="Value to write. Templates like {{currentWeight}} are allowed." style={inputStyle} />
            <input value={String(action?.uaType || "")} onChange={(e) => update({ uaType: e.target.value })} placeholder="uaType" title="Optional OPC UA type override." style={inputStyle} />
          </div>
        ) : null}

        {nextType === "webhook" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px", gap: 6 }}>
              <input value={String(action?.url || "")} onChange={(e) => update({ url: e.target.value })} placeholder="Webhook URL" title="Webhook endpoint URL." style={inputStyle} />
              <select value={String(action?.method || "POST")} onChange={(e) => update({ method: e.target.value })} title="HTTP method." style={inputStyle}>
                {["POST", "PUT", "PATCH", "GET"].map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
            </div>
            <KeyValueEditor title="Headers" value={action?.headers || {}} onChange={(headers) => update({ headers })} />
            <textarea
              value={String(action?.body || "")}
              onChange={(e) => update({ body: e.target.value })}
              placeholder="Body text or JSON with {{templates}}"
              title="Webhook body. Templates are allowed."
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
            />
          </>
        ) : null}

        {nextType === "delay" ? (
          <input value={String(action?.ms ?? 0)} onChange={(e) => update({ ms: e.target.value })} placeholder="Delay ms" title="Delay in milliseconds before the next action." style={inputStyle} />
        ) : null}

        {nextType === "for_each" ? (
          <div style={{ display: "grid", gap: 8 }}>
            <input value={String(action?.source || "rows")} onChange={(e) => update({ source: e.target.value })} placeholder="Source context key (example: rows)" title="Context array to iterate over, for example rows." style={inputStyle} />
            <div style={{ display: "grid", gap: 6 }}>
              {nestedActions.map((nestedAction, idx) => (
                <ActionEditor
                  key={`nested-action-${depth}-${idx}`}
                  action={nestedAction}
                  reports={reports}
                  tagOptions={tagOptions}
                  dbSchema={dbSchema}
                  depth={depth + 1}
                  onChange={(next) => {
                    const actions = nestedActions.map((row, rowIdx) => (rowIdx === idx ? (typeof next === "function" ? next(row) : next) : row));
                    update({ actions });
                  }}
                  onRemove={() => update({ actions: nestedActions.filter((_, rowIdx) => rowIdx !== idx) })}
                />
              ))}
              <button
                type="button"
                data-preserve-style="true"
                onClick={() => update({ actions: [...nestedActions, makeAction("tag.write")] })}
                style={secondaryButtonStyle}
                title="Add an action inside this loop."
              >
                Add Nested Action
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  color: "var(--text)",
  borderRadius: 8,
  padding: "6px 10px",
  minHeight: 32,
  boxSizing: "border-box",
  fontSize: 12,
};

const cardStyle = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: 10,
  background: "var(--bg)",
};

const secondaryButtonStyle = {
  border: "1px solid var(--border)",
  background: "var(--bg-elev)",
  color: "var(--text)",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const searchableInputStyle = {
  borderRadius: 8,
  fontSize: 12,
  height: 32,
};

const primaryButtonStyle = {
  ...secondaryButtonStyle,
  border: "1px solid #2b6cff",
  background: "#2b6cff",
  color: "#fff",
};

const dangerButtonStyle = {
  ...secondaryButtonStyle,
  border: "1px solid #f04438",
  background: "#f04438",
  color: "#fff",
};

export default function AutomationRulesPanel({ embedded = false, activeProjectId = "" }) {
  const [rules, setRules] = useState([]);
  const [projects, setProjects] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [reports, setReports] = useState([]);
  const [dbSchema, setDbSchema] = useState({});
  const [opcConfigTags, setOpcConfigTags] = useState([]);
  const [tagOptions, setTagOptions] = useState([]);
  const [runs, setRuns] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [draft, setDraft] = useState(() => makeRule(activeProjectId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggerBuilderType, setTriggerBuilderType] = useState("");
  const [triggerBuilderTag, setTriggerBuilderTag] = useState("");

  const loadAll = async (preferredRuleId = "") => {
    setLoading(true);
    try {
      const [ruleData, runData, projectData, routeData, reportData, opcStatus, schemaData, opcConfig] = await Promise.all([
        requestJson("/api/db/automation_rule?limit=500", { fallbackError: "Failed to load automation rules." }),
        requestJson("/api/db/automation_rule_run?limit=200", { fallbackError: "Failed to load automation runs." }),
        listProjects().catch(() => ({ projects: [] })),
        activeProjectId ? listRoutesByProject(activeProjectId, 2000).catch(() => ({ rows: [] })) : listAllRoutes(2000).catch(() => ({ rows: [] })),
        requestJson("/api/reports", { fallbackError: "Failed to load reports." }).catch(() => ({ reports: [] })),
        requestJson("/api/opc/status", { fallbackError: "Failed to load OPC status." }).catch(() => ({ values: {} })),
        requestJson("/api/db/schema", { fallbackError: "Failed to load database schema." }).catch(() => ({ schema: {} })),
        requestJson("/api/opc/config", { fallbackError: "Failed to load OPC config." }).catch(() => ({ tags: [] })),
      ]);
      const loadedRules = Array.isArray(ruleData?.rows) ? ruleData.rows.map((row) => normalizeRuleRow(row, activeProjectId)) : [];
      setRules(loadedRules);
      setRuns(Array.isArray(runData?.rows) ? runData.rows : []);
      setProjects(Array.isArray(projectData?.projects) ? projectData.projects : []);
      setRoutes(Array.isArray(routeData?.rows) ? routeData.rows : []);
      setReports(Array.isArray(reportData?.reports) ? reportData.reports : []);
      setDbSchema(schemaData?.schema && typeof schemaData.schema === "object" ? schemaData.schema : {});
      setOpcConfigTags(Array.isArray(opcConfig?.tags) ? opcConfig.tags : []);
      const liveTagKeys =
        opcStatus?.values && typeof opcStatus.values === "object" ? Object.keys(opcStatus.values) : [];
      setTagOptions(
        liveTagKeys
          .map((tag) => String(tag || "").trim())
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
          .map((tag) => ({ value: tag, label: tag }))
      );
      if (loadedRules.length) {
        const firstId = String(preferredRuleId || selectedRuleId || loadedRules[0]?.id || "");
        const selected = loadedRules.find((row) => String(row.id) === firstId) || loadedRules[0];
        setSelectedRuleId(String(selected?.id || ""));
        setDraft(selected ? cloneRuleDraft(selected, activeProjectId) : makeRule(activeProjectId));
      } else {
        setSelectedRuleId("");
        setDraft(makeRule(activeProjectId));
      }
    } catch (err) {
      toastError(String(err?.message || "Failed to load automation rules."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [activeProjectId]);

  const routeTagOptions = useMemo(
    () =>
      routes.map((route) => {
        const routeId = String(route?.route_id || "").trim();
        return { value: routeId, label: routeId };
      }),
    [routes]
  );

  const routeScopeOptions = routeTagOptions;
  const dbTableOptions = useMemo(
    () =>
      Object.keys(dbSchema && typeof dbSchema === "object" ? dbSchema : {})
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .map((table) => ({ value: table, label: table })),
    [dbSchema]
  );
  const triggerColumnOptions = useMemo(() => {
    const table = String(draft.trigger_table || "").trim();
    const cols = table && dbSchema && typeof dbSchema === "object" ? dbSchema[table] : [];
    return (Array.isArray(cols) ? cols : [])
      .map((col) => String(col?.column_name || "").trim())
      .filter(Boolean)
      .map((column) => ({ value: column, label: column }));
  }, [draft.trigger_table, dbSchema]);
  const triggerDataTypeByColumn = useMemo(() => {
    const table = String(draft.trigger_table || "").trim();
    const cols = table && dbSchema && typeof dbSchema === "object" ? dbSchema[table] : [];
    return Object.fromEntries(
      (Array.isArray(cols) ? cols : [])
        .map((col) => [String(col?.column_name || "").trim(), String(col?.data_type || "").trim()])
        .filter(([key]) => Boolean(key))
    );
  }, [draft.trigger_table, dbSchema]);
  const reportOptions = useMemo(
    () => (Array.isArray(reports) ? reports.map((report) => ({ value: String(report?.id || ""), label: String(report?.name || report?.id || "") })) : []),
    [reports]
  );
  const triggerTagOptions = tagOptions;
  const conditionTagOptions = useMemo(() => {
    if (String(draft.trigger_source || "tag") !== "db") return tagOptions;
    const rowOptions = [
      { value: "row.route_id", label: "row.route_id" },
      { value: "row.id", label: "row.id" },
      { value: "row.state", label: "row.state" },
      { value: "db_row.route_id", label: "db_row.route_id" },
      { value: "db_row.id", label: "db_row.id" },
      { value: "db_row.state", label: "db_row.state" },
    ];
    const merged = [...rowOptions, ...tagOptions];
    const deduped = [];
    const seen = new Set();
    merged.forEach((option) => {
      const value = String(option?.value || "");
      if (!value || seen.has(value)) return;
      seen.add(value);
      deduped.push(option);
    });
    return deduped;
  }, [draft.trigger_source, tagOptions]);
  const projectOptions = useMemo(
    () => (Array.isArray(projects) ? projects.map((project) => ({ value: String(project?.id || ""), label: String(project?.name || project?.id || "") })) : []),
    [projects]
  );
  const reusableTypeOptions = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(opcConfigTags) ? opcConfigTags : [])
      .map((tag) => String(tag?.plcType || tag?.dataType || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((value) => ({ value, label: value }));
  }, [opcConfigTags]);
  const reusableTagRows = useMemo(() => {
    const wantedType = String(triggerBuilderType || "").trim().toLowerCase();
    if (!wantedType) return [];
    return (Array.isArray(opcConfigTags) ? opcConfigTags : [])
      .filter((tag) => String(tag?.plcType || tag?.dataType || "").trim().toLowerCase() === wantedType)
      .map((tag) => {
        const topic = String(tag?.topic || "").trim();
        const tagPath = String(tag?.tagPath || tag?.name || "").trim();
        const groupName = String(tag?.groupName || "").trim();
        const fullKey = topic && tagPath && !tagPath.toLowerCase().startsWith(`${topic.toLowerCase()}.`) ? `${topic}.${tagPath}` : tagPath;
        let memberPath = tagPath;
        if (groupName && tagPath.toLowerCase().startsWith(`${groupName.toLowerCase()}.`)) {
          memberPath = String(tagPath.slice(groupName.length + 1) || "").trim();
        } else {
          const parts = tagPath.split(".");
          memberPath = parts.length > 1 ? parts.slice(1).join(".") : tagPath;
        }
        const wildcard = memberPath ? `*.${memberPath}` : "*";
        return {
          value: fullKey,
          label: memberPath ? `${memberPath} (${groupName || fullKey})` : fullKey,
          fullKey,
          memberPath,
          wildcard,
        };
      })
      .filter((row) => Boolean(row.fullKey))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
  }, [opcConfigTags, triggerBuilderType]);
  const reusableTagOptions = useMemo(
    () => reusableTagRows.map((row) => ({ value: row.value, label: row.label })),
    [reusableTagRows]
  );
  const selectedReusableTagRow = useMemo(
    () => reusableTagRows.find((row) => String(row.fullKey) === String(triggerBuilderTag || "")) || null,
    [reusableTagRows, triggerBuilderTag]
  );

  const selectedRuleRuns = useMemo(
    () => runs.filter((row) => String(row?.rule_id || "") === String(selectedRuleId || "")).slice(0, 20),
    [runs, selectedRuleId]
  );

  const selectRule = (rule) => {
    setSelectedRuleId(String(rule?.id || ""));
    setDraft(cloneRuleDraft(rule, activeProjectId));
  };

  const createNewRule = () => {
    setSelectedRuleId("");
    setDraft(makeRule(activeProjectId));
    setTriggerBuilderType("");
    setTriggerBuilderTag("");
  };

  const saveRule = async () => {
    setSaving(true);
    try {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("vizi:commit-searchable-selects"));
      }
      if (typeof document !== "undefined" && document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
      let currentDraft = draft;
      flushSync(() => {
        setDraft((prev) => {
          currentDraft = prev;
          return prev;
        });
      });
      const payload = serializeRuleDraft(currentDraft);
      let row = null;
      if (String(currentDraft?.id || "").trim()) {
        const data = await requestJson(`/api/db/automation_rule/${encodeURIComponent(currentDraft.id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          fallbackError: "Failed to update automation rule.",
        });
        row = data?.row || null;
      } else {
        const data = await requestJson("/api/db/automation_rule", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          fallbackError: "Failed to create automation rule.",
        });
        row = data?.row || null;
      }
      await loadAll(String(row?.id || ""));
      toastSuccess("Automation rule saved.");
    } catch (err) {
      toastError(String(err?.message || "Failed to save automation rule."));
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async () => {
    const id = String(draft?.id || "").trim();
    if (!id) {
      createNewRule();
      return;
    }
    try {
      await requestJson(`/api/db/automation_rule/${encodeURIComponent(id)}`, {
        method: "DELETE",
        fallbackError: "Failed to delete automation rule.",
      });
      toastSuccess("Automation rule deleted.");
      await loadAll();
    } catch (err) {
      toastError(String(err?.message || "Failed to delete automation rule."));
    }
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "320px minmax(0,1fr)", gap: 10, padding: embedded ? 10 : 0, boxSizing: "border-box" }}>
      <div className="vizi-scroll" style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-elev)", padding: 10, display: "grid", gap: 8, alignContent: "start" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Automation Rules</div>
          <button type="button" data-preserve-style="true" onClick={createNewRule} style={primaryButtonStyle} title="Create a new automation rule draft.">New</button>
        </div>
        {loading ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Loading...</div> : null}
        {!loading && !rules.length ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No automation rules yet.</div> : null}
        {rules.map((rule) => {
          const active = String(rule?.id || "") === String(selectedRuleId || "");
          return (
            <button
              key={`rule-${rule.id}`}
              type="button"
              data-preserve-style="true"
              onClick={() => selectRule(rule)}
              title={`Open rule ${String(rule?.name || "(unnamed rule)")}`}
              style={{
                textAlign: "left",
                border: active ? "1px solid #2b6cff" : "1px solid var(--border)",
                background: active ? "color-mix(in srgb, #2b6cff 10%, var(--bg))" : "var(--bg)",
                color: "var(--text)",
                borderRadius: 10,
                padding: 10,
                cursor: "pointer",
                display: "grid",
                gap: 4,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 12 }}>{String(rule?.name || "(unnamed rule)")}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {String(rule?.trigger_source || "tag") === "db"
                  ? `${String(rule?.trigger_table || "")}.${String(rule?.trigger_column || "")}` || "No DB trigger"
                  : String(rule?.trigger_tag || "No trigger tag")}
              </div>
              <div style={{ fontSize: 10, color: rule?.enabled ? "#16a34a" : "var(--text-muted)", fontWeight: 700 }}>
                {rule?.enabled ? "Enabled" : "Disabled"} | {String(rule?.trigger_source || "tag")} | {String(rule?.trigger_mode || "change")}
              </div>
            </button>
          );
        })}
      </div>

      <div className="vizi-scroll" style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-elev)", padding: 12, display: "grid", gap: 12, alignContent: "start" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{String(draft?.id || "").trim() ? "Edit Rule" : "New Rule"}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" data-preserve-style="true" onClick={deleteRule} style={dangerButtonStyle} title="Delete the current rule.">Delete</button>
            <button type="button" data-preserve-style="true" onClick={saveRule} style={primaryButtonStyle} disabled={saving} title="Save the current rule.">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 120px", gap: 8 }}>
          <input value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="Rule name" title="Human-readable rule name." style={inputStyle} />
          <label style={{ display: "flex", alignItems: "center", gap: 8, ...cardStyle }} title="Enable or disable this rule.">
            <input type="checkbox" checked={draft.enabled !== false} onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))} />
            <span style={{ fontSize: 12, fontWeight: 700 }}>Enabled</span>
          </label>
        </div>

        <div style={{ ...cardStyle, display: "grid", gap: 6 }} title="Reference for values you can use in conditions, actions, and templates.">
          <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>Available Values</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Trigger: <code>{'{{value}}'}</code>, <code>{'{{previous_value}}'}</code>, <code>{'{{tag}}'}</code>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Counter events: <code>{'{{delta}}'}</code> or <code>{'{{counter_delta}}'}</code> gives the numeric change between snapshots.
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Reusable wildcard trigger: use <code>*.Member.Path</code> as the trigger tag, then use <code>{'{{base}}'}</code> in later action tags like <code>{'{{base}}.HMI_Write.Cmd.CmdLogged'}</code>.
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            UDT/type helper: pick a PLC type and a sample tag below to stamp the wildcard trigger automatically.
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            DB trigger row: <code>{'{{row.column_name}}'}</code>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Loop rows: <code>{'{{item.column_name}}'}</code>, <code>{'{{index}}'}</code>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Previous action value: set <code>Save As</code> on an action, then use <code>{'{{yourSaveAsKey}}'}</code> in the next action or set the condition source to <code>yourSaveAsKey</code>.
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
          <SearchableSelect
            value={String(draft.scope_project_id || "")}
            onChange={(value) => setDraft((prev) => ({ ...prev, scope_project_id: value }))}
            options={projectOptions}
            placeholder="Scope Project"
            title="Optional project scope. Rule only runs for matching project routes."
          />
          <SearchableSelect
            value={String(draft.scope_route_id || "")}
            onChange={(value) => setDraft((prev) => ({ ...prev, scope_route_id: value }))}
            options={routeScopeOptions}
            placeholder="Scope Route"
            title="Optional route scope. Rule only runs for matching route."
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "140px 140px 140px", gap: 8 }}>
          <select value={draft.trigger_source} onChange={(e) => setDraft((prev) => ({ ...prev, trigger_source: e.target.value }))} title="Trigger source type." style={inputStyle}>
            {TRIGGER_SOURCE_OPTIONS.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
          <select value={draft.trigger_mode} onChange={(e) => setDraft((prev) => ({ ...prev, trigger_mode: e.target.value }))} title="How changes should trigger the rule. Use counter modes for PLC event counters." style={inputStyle}>
            {TRIGGER_MODE_OPTIONS.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
          <input value={String(draft.cooldown_ms ?? 0)} onChange={(e) => setDraft((prev) => ({ ...prev, cooldown_ms: e.target.value }))} placeholder="Cooldown ms" title="Minimum time between rule executions in milliseconds." style={inputStyle} />
        </div>
        {String(draft.trigger_source || "tag") === "db" ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
              <SearchableSelect
                value={String(draft.trigger_table || "")}
                onChange={(trigger_table) => setDraft((prev) => ({ ...prev, trigger_table, trigger_column: "", trigger_order_by: "" }))}
                options={dbTableOptions}
                placeholder="Trigger Table"
                allowCustom
                title="Database table to poll for trigger values."
                style={searchableInputStyle}
              />
              <SearchableSelect
                value={String(draft.trigger_column || "")}
                onChange={(trigger_column) => setDraft((prev) => ({ ...prev, trigger_column }))}
                options={triggerColumnOptions}
                placeholder="Trigger Column"
                allowCustom
                title="Column in the trigger table to compare for changes."
                style={searchableInputStyle}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 140px", gap: 8 }}>
              <SearchableSelect
                value={String(draft.trigger_order_by || "")}
                onChange={(trigger_order_by) => setDraft((prev) => ({ ...prev, trigger_order_by }))}
                options={triggerColumnOptions}
                placeholder="Order By (optional)"
                allowCustom
                title="Optional column used to choose which row is evaluated first."
                style={searchableInputStyle}
              />
              <select value={draft.trigger_order_dir} onChange={(e) => setDraft((prev) => ({ ...prev, trigger_order_dir: e.target.value }))} title="Sort direction for trigger row selection." style={inputStyle}>
                <option value="asc">asc</option>
                <option value="desc">desc</option>
              </select>
            </div>
            <KeyValueEditor
              title="Trigger Where"
              value={draft.trigger_where || {}}
              onChange={(trigger_where) => setDraft((prev) => ({ ...prev, trigger_where }))}
              keyOptions={triggerColumnOptions}
              dataTypeByKey={triggerDataTypeByColumn}
            />
          </>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <SearchableSelect
              value={String(draft.trigger_tag || "")}
              onChange={(trigger_tag) => setDraft((prev) => ({ ...prev, trigger_tag }))}
              options={triggerTagOptions}
              placeholder="Trigger Tag"
              allowCustom
              title="Tag that starts this rule."
              style={searchableInputStyle}
            />
            <div style={{ ...cardStyle, display: "grid", gap: 8 }} title="Build a reusable wildcard trigger from OPC type metadata and a sample tag.">
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Use UDT / Type</div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 8, alignItems: "center" }}>
                <SearchableSelect
                  value={String(triggerBuilderType || "")}
                  onChange={(value) => {
                    setTriggerBuilderType(value);
                    setTriggerBuilderTag("");
                  }}
                  options={reusableTypeOptions}
                  placeholder="PLC Type / UDT"
                  allowCustom
                  title="Select the PLC type/UDT family from OPC config."
                  style={searchableInputStyle}
                />
                <SearchableSelect
                  value={String(triggerBuilderTag || "")}
                  onChange={(value) => setTriggerBuilderTag(value)}
                  options={reusableTagOptions}
                  placeholder="Sample Tag / Member"
                  allowCustom={false}
                  title="Select a sample tag member from the chosen type."
                  style={searchableInputStyle}
                />
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={() => {
                    if (!selectedReusableTagRow?.wildcard) return;
                    setDraft((prev) => {
                      const next = { ...prev, trigger_tag: selectedReusableTagRow.wildcard };
                      const isCounterMember = /counter/i.test(String(selectedReusableTagRow?.memberPath || ""));
                      if (!isCounterMember && /^counter_/.test(String(prev?.trigger_mode || ""))) {
                        next.trigger_mode = "change";
                      }
                      return next;
                    });
                  }}
                  style={secondaryButtonStyle}
                  disabled={!selectedReusableTagRow?.wildcard}
                  title="Apply the wildcard trigger generated from the selected type and sample tag."
                >
                  Use
                </button>
              </div>
              {selectedReusableTagRow?.wildcard ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Wildcard trigger: <code>{selectedReusableTagRow.wildcard}</code>
                </div>
              ) : null}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }} title="Rule-level conditions. These are checked before any actions run.">Conditions</div>
            <button type="button" data-preserve-style="true" onClick={() => setDraft((prev) => ({ ...prev, conditions: [...(Array.isArray(prev.conditions) ? prev.conditions : []), makeCondition()] }))} style={secondaryButtonStyle} title="Add a rule-level condition.">
              Add Condition
            </button>
          </div>
          {(Array.isArray(draft.conditions) ? draft.conditions : []).map((condition, idx) => (
            <ConditionEditor
              key={`condition-${idx}`}
              condition={condition}
              tagOptions={conditionTagOptions}
              onChange={(next) => setDraft((prev) => ({ ...prev, conditions: prev.conditions.map((row, rowIdx) => (rowIdx === idx ? (typeof next === "function" ? next(row) : next) : row)) }))}
              onRemove={() => setDraft((prev) => ({ ...prev, conditions: prev.conditions.filter((_, rowIdx) => rowIdx !== idx) }))}
            />
          ))}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }} title="Actions run in order and can pass values to later actions.">Actions</div>
            <button type="button" data-preserve-style="true" onClick={() => setDraft((prev) => ({ ...prev, actions: [...(Array.isArray(prev.actions) ? prev.actions : []), makeAction()] }))} style={secondaryButtonStyle} title="Add an action to the rule.">
              Add Action
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }} title="Actions can pass values forward using Save As.">
            Use <code>Save As</code> on `tag.read`, `db.select`, or `dataset.select`, then reference that key in later actions or conditions.
          </div>
          {(Array.isArray(draft.actions) ? draft.actions : []).map((action, idx) => (
            <ActionEditor
              key={`action-${idx}`}
              action={action}
              reports={reports}
              tagOptions={triggerTagOptions}
              dbSchema={dbSchema}
              onChange={(next) => setDraft((prev) => ({ ...prev, actions: prev.actions.map((row, rowIdx) => (rowIdx === idx ? (typeof next === "function" ? next(row) : next) : row)) }))}
              onRemove={() => setDraft((prev) => ({ ...prev, actions: prev.actions.filter((_, rowIdx) => rowIdx !== idx) }))}
            />
          ))}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 700 }} title="Recent execution history for the selected rule.">Recent Runs</div>
          {!selectedRuleRuns.length ? <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No runs logged for this rule yet.</div> : null}
          {selectedRuleRuns.map((run) => (
            <div key={`run-${run.id}`} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>{String(run?.status || "")}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDateTime(run?.created_at)}</div>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{String(run?.trigger_tag || "")}</div>
              {String(run?.message || "").trim() ? <div style={{ fontSize: 11, marginTop: 4 }}>{String(run.message)}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
