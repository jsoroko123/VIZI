import { Fragment, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { dismissToast, showToast, toastError, toastSuccess } from "../utils/toast";

const DIAGNOSTICS_UI_MAX_ROWS = 500;
const RESTART_PENDING_TIMEOUT_MS = 15000;
const ALARM_OPERATORS = ["==", "!=", ">", ">=", "<", "<="];

function normalizeTagName(name) {
  return String(name || "")
    .replace(/\\n/g, "")
    .replace(/\r?\n/g, "")
    .trim();
}

function getTagGroupKey(tag) {
  const name = normalizeTagName(tag?.name || "");
  const groupRaw = normalizeTagName(tag?.groupName || "");
  const fallbackGroup = name && name.includes(".") ? name.split(".")[0] : "";
  return groupRaw || fallbackGroup || "Ungrouped";
}

function normalizeTopicValue(value) {
  return String(value || "").trim();
}

function makeId() {
  return `plc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatLiveNumber(value, decimals = 0) {
  if (value == null || value === "") return "";
  if (!Number.isFinite(Number(value))) return String(value);
  return Number(value).toFixed(decimals);
}

function parseOptionalMs(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return "";
  return Math.round(n);
}

function parseOptionalNonNegative(value) {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return "";
  return n;
}

function normalizeTrendMode(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "time" ? "time" : "value";
}

function normalizeAlarmOperator(value) {
  const v = String(value || "").trim();
  return ALARM_OPERATORS.includes(v) ? v : "==";
}

function normalizeAlarmThreshold(value) {
  if (value == null) return "";
  return String(value).trim();
}

function normalizeStateMappingRow(row, options = {}) {
  const src = row && typeof row === "object" ? row : {};
  const defaultField = String(options.defaultField ?? "State Text");
  const defaultColor = String(options.defaultColor ?? "#000000");
  return {
    ...src,
    field: String(src.field ?? defaultField).trim() || defaultField,
    state: String(src.state ?? "").trim(),
    color: String(src.color ?? defaultColor).trim() || defaultColor,
  };
}

function TrashCanIcon({ size = 12 }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}


function defaultRuntimeConfig() {
  return {
    opcConnectionEnabled: true,
    multiReadEnabled: true,
    multiReadBatchSize: 16,
    maxReadsPerTick: 300,
    mqttEnabled: false,
    mqttBrokerUrl: "mqtt://localhost:1883",
    mqttClientId: "",
    mqttUsername: "",
    mqttPassword: "",
    mqttStatusTopic: "mesora/opc/status",
    mqttWriteTopic: "mesora/opc/write",
    mqttQos: 0,
    mqttRetain: false,
    readTimeoutMs: 3000,
    readRetryCount: 2,
    readRetryDelayMs: 100,
    plcConnectTimeoutMs: 9000,
    plcReceiveTimeoutMs: 18000,
    errorBackoffEnabled: true,
    errorBackoffBaseMs: 1000,
    errorBackoffMaxMs: 15000,
    errorBackoffThreshold: 3,
    pollJitterMs: 0,
    deadbandDefault: "",
    reconnectDelayMs: 2000,
    reconnectMaxAttempts: "",
    heartbeatEnabled: true,
    heartbeatFailureThreshold: 3,
    heartbeatMs: 5000,
  };
}

function normalizeRuntimeConfig(value) {
  const incoming = value && typeof value === "object" ? value : {};
  const defaults = defaultRuntimeConfig();
  const mqttQosRaw = Number.parseInt(String(incoming.mqttQos ?? defaults.mqttQos), 10);
  const mqttQos = Number.isFinite(mqttQosRaw) ? Math.max(0, Math.min(2, mqttQosRaw)) : defaults.mqttQos;
  const multiReadBatchSizeRaw = Number.parseInt(String(incoming.multiReadBatchSize ?? defaults.multiReadBatchSize), 10);
  const multiReadBatchSize = Number.isFinite(multiReadBatchSizeRaw)
    ? Math.max(1, Math.min(25, multiReadBatchSizeRaw))
    : defaults.multiReadBatchSize;
  const maxReadsPerTickRaw = Number.parseInt(String(incoming.maxReadsPerTick ?? defaults.maxReadsPerTick), 10);
  const maxReadsPerTick = Number.isFinite(maxReadsPerTickRaw)
    ? Math.max(10, Math.min(5000, maxReadsPerTickRaw))
    : defaults.maxReadsPerTick;
  const readRetryCountRaw = Number.parseInt(String(incoming.readRetryCount ?? defaults.readRetryCount), 10);
  const readRetryCount = Number.isFinite(readRetryCountRaw)
    ? Math.max(0, Math.min(5, readRetryCountRaw))
    : defaults.readRetryCount;
  const readRetryDelayMs = parseOptionalMs(incoming.readRetryDelayMs) || defaults.readRetryDelayMs;
  return {
    opcConnectionEnabled: incoming.opcConnectionEnabled !== false,
    multiReadEnabled: incoming.multiReadEnabled !== false,
    multiReadBatchSize,
    maxReadsPerTick,
    mqttEnabled: incoming.mqttEnabled === true,
    mqttBrokerUrl: String(incoming.mqttBrokerUrl || defaults.mqttBrokerUrl || ""),
    mqttClientId: String(incoming.mqttClientId || ""),
    mqttUsername: String(incoming.mqttUsername || ""),
    mqttPassword: String(incoming.mqttPassword || ""),
    mqttStatusTopic: String(incoming.mqttStatusTopic || defaults.mqttStatusTopic || ""),
    mqttWriteTopic: String(incoming.mqttWriteTopic || defaults.mqttWriteTopic || ""),
    mqttQos,
    mqttRetain: incoming.mqttRetain === true,
    readTimeoutMs: parseOptionalMs(incoming.readTimeoutMs) || defaults.readTimeoutMs,
    readRetryCount,
    readRetryDelayMs,
    plcConnectTimeoutMs: parseOptionalMs(incoming.plcConnectTimeoutMs) || defaults.plcConnectTimeoutMs,
    plcReceiveTimeoutMs: parseOptionalMs(incoming.plcReceiveTimeoutMs) || defaults.plcReceiveTimeoutMs,
    errorBackoffEnabled: incoming.errorBackoffEnabled !== false,
    errorBackoffBaseMs: parseOptionalMs(incoming.errorBackoffBaseMs) || defaults.errorBackoffBaseMs,
    errorBackoffMaxMs: parseOptionalMs(incoming.errorBackoffMaxMs) || defaults.errorBackoffMaxMs,
    errorBackoffThreshold: parseOptionalMs(incoming.errorBackoffThreshold) || defaults.errorBackoffThreshold,
    pollJitterMs: parseOptionalNonNegative(incoming.pollJitterMs) === "" ? defaults.pollJitterMs : parseOptionalNonNegative(incoming.pollJitterMs),
    deadbandDefault: parseOptionalNonNegative(incoming.deadbandDefault),
    reconnectDelayMs: parseOptionalMs(incoming.reconnectDelayMs) || defaults.reconnectDelayMs,
    reconnectMaxAttempts: parseOptionalMs(incoming.reconnectMaxAttempts),
    heartbeatEnabled: incoming.heartbeatEnabled !== false,
    heartbeatFailureThreshold: parseOptionalMs(incoming.heartbeatFailureThreshold) || defaults.heartbeatFailureThreshold,
    heartbeatMs: parseOptionalMs(incoming.heartbeatMs) || defaults.heartbeatMs,
  };
}

function parseCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes("name") && (first.includes("tagpath") || first.includes("plctype"));
  const headers = hasHeader
    ? lines[0].split(",").map((h) => h.trim().toLowerCase())
    : [];
  const rows = hasHeader ? lines.slice(1) : lines;
  return rows
    .map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      if (hasHeader) {
        const idx = (key) => headers.indexOf(key);
        const get = (key) => {
          const i = idx(key);
          return i >= 0 ? parts[i] : "";
        };
        return {
          name: normalizeTagName(get("name")),
          tagPath: normalizeTagName(get("tagpath")),
          plcType: get("plctype"),
          uaType: get("uatype"),
          enabled: get("enabled") ? get("enabled").toLowerCase() !== "false" : true,
          topic: normalizeTagName(get("topic")),
          samplingInterval: Number.isFinite(Number(get("samplinginterval")))
            ? Number(get("samplinginterval"))
            : "",
        };
      }
      return {
        name: normalizeTagName(parts[0] || ""),
        tagPath: normalizeTagName(parts[1] || ""),
        plcType: parts[2] || "",
        uaType: parts[3] || "",
        enabled: parts[4] ? parts[4].toLowerCase() !== "false" : true,
        topic: normalizeTagName(parts[5] || ""),
        samplingInterval: Number.isFinite(Number(parts[6])) ? Number(parts[6]) : "",
      };
    })
    .filter((t) => t.name);
}

export default function OpcConfig({ embedded = false, mode = "full", onDrawerViewChange = null }) {
  const [config, setConfig] = useState({
    plc: { host: "", slot: 0 },
    plcs: [],
    opcua: { port: 4840, resourcePath: "/UA/ControlLogix", name: "ControlLogix" },
    pollMs: 500,
    runtime: defaultRuntimeConfig(),
    topics: [],
    tags: [],
  });
  const [csvText, setCsvText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [liveValues, setLiveValues] = useState({});
  const [liveErrors, setLiveErrors] = useState({});
  const [liveQualities, setLiveQualities] = useState({});
  const [liveDiagnostics, setLiveDiagnostics] = useState({});
  const [liveRuntime, setLiveRuntime] = useState({});
  const [serverDiagnostics, setServerDiagnostics] = useState({});
  const [opcConnected, setOpcConnected] = useState(null);
  const [opcLastPollAt, setOpcLastPollAt] = useState(null);
  const [restartPending, setRestartPending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [templateFieldRows, setTemplateFieldRows] = useState([
    {
      name: "",
      tagPath: "",
      uaType: "",
      pollMs: "",
      samplingInterval: "",
      topic: "",
      enabled: true,
      mappingSet: "",
      scale: 1,
      decimals: 0,
      alarmEnabled: false,
      alarmOperator: "==",
      alarmValue: "",
    },
  ]);
  const [templateStateMappings, setTemplateStateMappings] = useState([
    { field: "State Text", state: "", color: "#000000" },
  ]);
  const [templateParent, setTemplateParent] = useState("");
  const [editTemplate, setEditTemplate] = useState("");
  const [templateOriginalName, setTemplateOriginalName] = useState("");
  const [templateEditing, setTemplateEditing] = useState(true);
  const [tagMappings, setTagMappings] = useState([]);
  const [manualTagMappings, setManualTagMappings] = useState([{ field: "State Text", state: "", color: "#000000" }]);
  const [mappingSets, setMappingSets] = useState([]);
  const [mappingSetName, setMappingSetName] = useState("");
  const [mappingSetOriginalName, setMappingSetOriginalName] = useState("");
  const [mappingSetRows, setMappingSetRows] = useState([{ field: "State Text", state: "", color: "#000000" }]);
  const [applyTemplate, setApplyTemplate] = useState("");
  const [applyTemplateSearch, setApplyTemplateSearch] = useState("");
  const [applyTemplateExpandedByName, setApplyTemplateExpandedByName] = useState({});
  const [templateFieldTreeExpanded, setTemplateFieldTreeExpanded] = useState({});
  const [, startTemplateFieldTransition] = useTransition();
  const [templateFieldEditingKey, setTemplateFieldEditingKey] = useState("");
  const [applyTopic, setApplyTopic] = useState("");
  const [applyPrefix, setApplyPrefix] = useState("");
  const [applyMappingSet, setApplyMappingSet] = useState("");
  const [templateSourceGroupKey, setTemplateSourceGroupKey] = useState("");
  const [errorLogEntries, setErrorLogEntries] = useState([]);
  const [expandedPrefixes, setExpandedPrefixes] = useState({});
  const [tagSectionTab, setTagSectionTab] = useState("tags");
  const pauseTemplateEditorPolling =
    mode === "tags" && String(tagSectionTab || "").trim().toLowerCase() === "templates";
  const [tagSearch, setTagSearch] = useState("");
  const [showTagsDrawer, setShowTagsDrawer] = useState(false);
  const [showDrawerMenu, setShowDrawerMenu] = useState(false);
  const [manualTag, setManualTag] = useState({
    name: "",
    tagPath: "",
    uaType: "",
    pollMs: "",
    samplingInterval: "",
    topic: "",
    enabled: true,
    muted: false,
    mappingSet: "",
    groupName: "",
    deadband: "",
    trendEnabled: false,
    trendMode: "value",
    trendSampleMs: "",
    alarmEnabled: false,
    alarmOperator: "==",
    alarmValue: "",
  });
  const [tagTableEditing, setTagTableEditing] = useState(false);
  const [editingTagIndex, setEditingTagIndex] = useState(null);
  const [activeTagGroup, setActiveTagGroup] = useState({ topic: "", groupName: "" });
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [manualTopic, setManualTopic] = useState({
    name: "",
    prefix: "",
    plcName: "",
    samplingInterval: "",
    enabled: true,
  });
  const [showPlcForm, setShowPlcForm] = useState(false);
  const [opcConfigSectionTab, setOpcConfigSectionTab] = useState("opcua");
  const [opcUaEditing, setOpcUaEditing] = useState(false);
  const [manualPlc, setManualPlc] = useState({
    name: "",
    host: "",
    slot: "",
    pollMs: "",
  });
  const [bulkEdit, setBulkEdit] = useState({
    topic: "",
    groupName: "",
    pollMs: "",
    samplingInterval: "",
    mappingSet: "",
    deadband: "",
    muted: false,
  });
  const [tagToolsTab, setTagToolsTab] = useState("template");
  const [tagWriteByKey, setTagWriteByKey] = useState({});
  const [tagWriteBusyByKey, setTagWriteBusyByKey] = useState({});
  const [pendingTagGroupDelete, setPendingTagGroupDelete] = useState(null);
  const [pendingTagDelete, setPendingTagDelete] = useState(null);
  const tagEditRowRefs = useRef(new Map());
  const RESTART_TOAST_ID = "opc-restart";
  const restartToastIdRef = useRef("");
  const restartStartedAtRef = useRef(0);
  const restartSawDisconnectRef = useRef(false);
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
    if (!restartPending) return;
    if (opcConnected === false) {
      restartSawDisconnectRef.current = true;
      return;
    }
    if (opcConnected !== true) return;
    const elapsed = Date.now() - Number(restartStartedAtRef.current || 0);
    if (!restartSawDisconnectRef.current && elapsed < 1500) return;
    const toastId = restartToastIdRef.current;
    if (toastId) {
      showToast("OPC server reconnected.", {
        id: toastId,
        type: "success",
        duration: 5000,
      });
      restartToastIdRef.current = "";
    }
    restartSawDisconnectRef.current = false;
    restartStartedAtRef.current = 0;
    setRestartPending(false);
  }, [restartPending, opcConnected, opcLastPollAt]);

  useEffect(() => {
    if (!restartPending) return;
    const timer = setTimeout(() => {
      const toastId = String(restartToastIdRef.current || "").trim();
      if (toastId) {
        showToast("Restart requested. OPC is still disconnected.", {
          id: toastId,
          type: "error",
          duration: 5000,
        });
        restartToastIdRef.current = "";
      }
      restartSawDisconnectRef.current = false;
      restartStartedAtRef.current = 0;
      setRestartPending(false);
    }, RESTART_PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [restartPending]);

  useEffect(
    () => () => {
      const toastId = String(restartToastIdRef.current || "").trim();
      if (toastId) {
        dismissToast(toastId);
      }
      restartToastIdRef.current = "";
      restartSawDisconnectRef.current = false;
      restartStartedAtRef.current = 0;
    },
    []
  );
  const tagColumnKeys = [
    "enabled",
    "muted",
    "trend",
    "name",
    "topic",
    "tagPath",
    "uaType",
    "pollMs",
    "samplingInterval",
    "mappingSet",
    "scale",
    "decimals",
    "quality",
    "liveValue",
    "actions",
  ];
  const tagColumnLabels = {
    enabled: "Enabled",
    muted: "Muted",
    trend: "Trend",
    name: "Name",
    topic: "Topic",
    tagPath: "Tag Path",
    uaType: "UA Type",
    pollMs: "Poll (ms)",
    samplingInterval: "Sampling (ms)",
    mappingSet: "Mapping Set",
    scale: "Scale",
    decimals: "Decimals",
    quality: "Quality",
    liveValue: "Live Value",
    actions: "",
  };
  const [tagVisibleColumns, setTagVisibleColumns] = useState(() => {
    try {
      const saved = localStorage.getItem("vizi_tag_columns");
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore
    }
    return {};
  });
  const autoSaveTimerRef = useRef(null);
  const autoSaveReadyRef = useRef(false);
  const initialLoadSucceededRef = useRef(false);
  const lastSavedRef = useRef("");
  const opcUaSnapshotRef = useRef(null);
  const lastLiveErrorsRef = useRef({});
  const seenOpcIssueIdsRef = useRef(new Set());
  const mappingSetAutoSelectedRef = useRef(false);
  const drawerMenuRef = useRef(null);
  const drawerMenuBtnRef = useRef(null);

  useEffect(() => {
    if (mode === "logs") {
      setTagSectionTab("logs");
    } else if (mode === "diagnostics") {
      setTagSectionTab("diagnostics");
    } else if (mode === "tags") {
      setTagSectionTab("tags");
    }
  }, [mode]);

  useEffect(() => {
    async function load() {
      autoSaveReadyRef.current = false;
      initialLoadSucceededRef.current = false;
      try {
        const res = await fetch("/api/opc/config");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load.");
        const cleanedTags = buildCleanedTags(data?.tags);
        const cleanedPlcs = Array.isArray(data?.plcs) && data.plcs.length
          ? buildCleanedPlcs(data.plcs)
          : data?.plc?.host
          ? [
              {
                id: makeId(),
                name: normalizeTopicValue(data?.plc?.name || "PLC-1"),
                host: normalizeTopicValue(data?.plc?.host || ""),
                slot: Number.isFinite(Number(data?.plc?.slot)) ? Number(data.plc.slot) : 0,
                pollMs: parseOptionalMs(data?.pollMs),
              },
            ]
          : [];
        const cleanedTopics = buildCleanedTopics(data?.topics);
        const loadedConfig = {
          ...data,
          runtime: normalizeRuntimeConfig(data?.runtime),
          tags: cleanedTags,
          topics: cleanedTopics,
          plcs: cleanedPlcs,
        };
        setConfig(loadedConfig);
        lastSavedRef.current = JSON.stringify(loadedConfig);
        initialLoadSucceededRef.current = true;
        setTimeout(() => {
          autoSaveReadyRef.current = true;
        }, 0);
      } catch (err) {
        setError(err?.message || "Failed to load.");
        // Do not enable autosave after a failed bootstrap fetch.
        // This prevents posting default/empty config that can wipe tags.
        autoSaveReadyRef.current = false;
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!autoSaveReadyRef.current) return;
    if (!initialLoadSucceededRef.current) return;
    if (opcUaEditing) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const cleanedTags = buildCleanedTags(config.tags);
      const cleanedTopics = buildCleanedTopics(config.topics);
      const cleanedPlcs = buildCleanedPlcs(config.plcs);
      const nextConfig = {
        ...config,
        runtime: normalizeRuntimeConfig(config.runtime),
        tags: cleanedTags,
        topics: cleanedTopics,
        plcs: cleanedPlcs,
      };
      const payload = JSON.stringify(nextConfig);
      if (payload === lastSavedRef.current) return;
      lastSavedRef.current = payload;
      if (
        JSON.stringify(config.tags) !== JSON.stringify(cleanedTags) ||
        JSON.stringify(config.topics) !== JSON.stringify(cleanedTopics) ||
        JSON.stringify(config.plcs) !== JSON.stringify(cleanedPlcs)
      ) {
        setConfig(nextConfig);
      }
      persistConfig(nextConfig).catch((err) => {
        setError(err?.message || "Auto-save failed.");
      });
    }, 600);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [config, opcUaEditing]);

  useEffect(() => {
    async function loadTemplates() {
      try {
        const res = await fetch("/api/opc/templates");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load templates.");
        setTemplates(data.templates || []);
      } catch (err) {
        setError(err?.message || "Failed to load templates.");
      }
    }
    loadTemplates();
  }, []);

  useEffect(() => {
    async function loadMappingSets() {
      try {
        const res = await fetch("/api/opc/mapping-sets");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load mapping sets.");
        setMappingSets(data.sets || []);
      } catch (err) {
        setError(err?.message || "Failed to load mapping sets.");
      }
    }
    loadMappingSets();
  }, []);

  useEffect(() => {
    async function loadTagMappings() {
      try {
        const res = await fetch("/api/opc/tag-mappings");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load mappings.");
        setTagMappings(data.mappings || []);
      } catch (err) {
        setError(err?.message || "Failed to load mappings.");
      }
    }
    loadTagMappings();
  }, []);

  useEffect(() => {
    if (!editTemplate) return;
    const tmpl = templates.find((t) => t.name === editTemplate);
    if (!tmpl) return;
    setTemplateName(tmpl.name || "");
    setTemplateOriginalName(tmpl.name || "");
    setTemplateParent(tmpl.parent_name || "");
    setTemplateEditing(false);
    const nextFields = Array.isArray(tmpl.fields)
      ? tmpl.fields.map((f) => {
          if (typeof f === "string") {
            return {
              name: f,
              tagPath: f,
              plcType: "",
              baseType: "",
              isArray: false,
              arraySpec: "",
              usage: "",
              uaType: "",
              pollMs: "",
              samplingInterval: "",
              topic: "",
              enabled: true,
              mappingSet: "",
              scale: 1,
              decimals: 0,
              alarmEnabled: false,
              alarmOperator: "==",
              alarmValue: "",
            };
          }
          return {
            name: f?.name || "",
            tagPath: f?.tagPath || "",
            plcType: String(f?.plcType || ""),
            baseType: String(f?.baseType || ""),
            isArray: f?.isArray === true,
            arraySpec: String(f?.arraySpec || ""),
            usage: String(f?.usage || ""),
            uaType: f?.uaType || "",
            pollMs: f?.pollMs ?? "",
            samplingInterval: f?.samplingInterval ?? "",
            topic: f?.topic || "",
            enabled: f?.enabled !== false,
            mappingSet: String(f?.mappingSet || ""),
            scale: Number.isFinite(Number(f?.scale)) ? Number(f.scale) : 1,
            decimals: Number.isFinite(Number(f?.decimals)) ? Number(f.decimals) : 0,
            alarmEnabled: f?.alarmEnabled === true,
            alarmOperator: normalizeAlarmOperator(f?.alarmOperator),
            alarmValue: normalizeAlarmThreshold(f?.alarmValue),
          };
        })
      : [];
    setTemplateFieldRows(
      nextFields.length
        ? nextFields
        : [{
            name: "",
            tagPath: "",
            uaType: "",
            pollMs: "",
            samplingInterval: "",
            topic: "",
            enabled: true,
            mappingSet: "",
            scale: 1,
            decimals: 0,
            alarmEnabled: false,
            alarmOperator: "==",
            alarmValue: "",
          }]
    );
    const nextMappings = Array.isArray(tmpl.state_mappings)
      ? tmpl.state_mappings.map((m) => normalizeStateMappingRow(m))
      : [];
    setTemplateStateMappings(
      nextMappings.length ? nextMappings : [{ field: "State Text", state: "", color: "#000000" }]
    );
  }, [editTemplate, templates]);

  useEffect(() => {
    const name = String(manualTag.name || "").trim();
    if (!name) return;
    setManualTagMappings((prev) =>
      prev.map((row) => ({
        ...row,
        field: row.field || name,
      }))
    );
  }, [manualTag.name]);

  useEffect(() => {
    if (pauseTemplateEditorPolling) return undefined;
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/opc/status");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load status.");
        if (alive) {
          setLiveValues(data.values || {});
          const nextErrors = data.errors || {};
          const prevErrors = lastLiveErrorsRef.current || {};
          setLiveErrors(nextErrors);
          setLiveQualities(data.qualities || {});
          setLiveDiagnostics(data.diagnostics || {});
          setLiveRuntime(data.runtime || {});
          const now = Date.now();
          const nextLogEntries = [];
          Object.entries(nextErrors).forEach(([name, count]) => {
            const key = String(name || "").trim();
            if (!key) return;
            const nextCount = Number.isFinite(Number(count)) ? Number(count) : count;
            const prevCount = prevErrors[key];
            if (prevCount === nextCount) return;
            nextLogEntries.push({
              id: `${now}-${key}-${nextCount}`,
              at: now,
              tag: key,
              count: nextCount,
              kind: "error",
            });
          });
          Object.keys(prevErrors).forEach((name) => {
            if (Object.prototype.hasOwnProperty.call(nextErrors, name)) return;
            const prevCount = prevErrors[name];
            nextLogEntries.push({
              id: `${now}-${name}-cleared`,
              at: now,
              tag: String(name || "").trim(),
              count: prevCount,
              kind: "cleared",
            });
          });
          const runtimeIssues = Array.isArray(data?.runtime?.issueLog) ? data.runtime.issueLog : [];
          runtimeIssues.forEach((issue, idx) => {
            const rawId = String(issue?.id || "").trim();
            if (!rawId || seenOpcIssueIdsRef.current.has(rawId)) return;
            seenOpcIssueIdsRef.current.add(rawId);
            const at = Number(issue?.at || now);
            const severity = String(issue?.severity || "error").trim().toLowerCase();
            const plcName = String(issue?.plcName || "").trim();
            const tagKey = String(issue?.tagKey || "").trim();
            const kindText = String(issue?.kind || "opc_issue").trim();
            const message = String(issue?.message || "").trim();
            nextLogEntries.push({
              id: `${rawId}-${idx}`,
              at: Number.isFinite(at) ? at : now,
              tag: tagKey || plcName || kindText || "OPC",
              count: "",
              kind: severity === "info" ? "info" : severity === "warn" ? "warn" : "error",
              message: message || kindText || "OPC issue",
              source: "runtime",
            });
          });
          if (nextLogEntries.length) {
            setErrorLogEntries((prev) => {
              const merged = [...nextLogEntries, ...prev];
              return merged.slice(0, 500);
            });
          }
          lastLiveErrorsRef.current = nextErrors;
          setOpcConnected(
            typeof data.connected === "boolean" ? data.connected : null
          );
          setOpcLastPollAt(data.lastPollAt || null);
        }
      } catch {
        if (alive) {
          setOpcConnected(false);
          setOpcLastPollAt(null);
        }
      }
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pauseTemplateEditorPolling]);

  useEffect(() => {
    if (pauseTemplateEditorPolling) return undefined;
    let alive = true;
    async function pollServerDiagnostics() {
      try {
        const res = await fetch("/api/diagnostics/app");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load server diagnostics.");
        if (alive) setServerDiagnostics(data && typeof data === "object" ? data : {});
      } catch {
        if (alive) setServerDiagnostics({});
      }
    }
    pollServerDiagnostics();
    const id = setInterval(pollServerDiagnostics, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pauseTemplateEditorPolling]);

  useEffect(() => {
    if (!showDrawerMenu) return;
    function onDocClick(e) {
      const t = e.target;
      if (drawerMenuRef.current?.contains(t)) return;
      if (drawerMenuBtnRef.current?.contains(t)) return;
      setShowDrawerMenu(false);
    }
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [showDrawerMenu]);

  const plcs = useMemo(() => (Array.isArray(config?.plcs) ? config.plcs : []), [config?.plcs]);
  const topics = useMemo(() => (Array.isArray(config?.topics) ? config.topics : []), [config?.topics]);
  const opcConnectionEnabled = config?.runtime?.opcConnectionEnabled !== false;
  const tags = useMemo(() => (Array.isArray(config?.tags) ? config.tags : []), [config?.tags]);
  const tagChildrenByParentPath = useMemo(() => {
    const parentMap = new Map();
    const ensureParent = (parentPath) => {
      const key = String(parentPath || "").trim();
      if (!key) return null;
      if (!parentMap.has(key)) parentMap.set(key, new Map());
      return parentMap.get(key);
    };
    (Array.isArray(tags) ? tags : []).forEach((tag) => {
      const fullPath = normalizeTagName(tag?.tagPath || tag?.name || "");
      if (!fullPath || !fullPath.includes(".")) return;
      const parts = fullPath.split(".").filter(Boolean);
      if (parts.length < 2) return;
      for (let i = 1; i < parts.length; i += 1) {
        const parentPath = parts.slice(0, i).join(".");
        const childPath = parts.slice(0, i + 1).join(".");
        const childName = parts[i];
        const bucket = ensureParent(parentPath);
        if (!bucket) continue;
        const existing = bucket.get(childPath);
        const nextRow = {
          name: childName,
          tagPath: childPath,
          plcType: String(tag?.plcType || existing?.plcType || "").trim(),
          baseType: String(tag?.baseType || existing?.baseType || "").trim(),
          isArray: tag?.isArray === true || existing?.isArray === true,
          arraySpec: String(tag?.arraySpec || existing?.arraySpec || "").trim(),
          usage: String(tag?.usage || existing?.usage || "").trim(),
          uaType: String(tag?.uaType || existing?.uaType || "").trim(),
          pollMs: tag?.pollMs ?? existing?.pollMs ?? "",
          samplingInterval: tag?.samplingInterval ?? existing?.samplingInterval ?? "",
          topic: String(tag?.topic || existing?.topic || "").trim(),
          enabled: tag?.enabled !== false,
          mappingSet: String(tag?.mappingSet || existing?.mappingSet || "").trim(),
          scale: Number.isFinite(Number(tag?.scale)) ? Number(tag.scale) : (existing?.scale ?? 1),
          decimals: Number.isFinite(Number(tag?.decimals)) ? Number(tag.decimals) : (existing?.decimals ?? 0),
          alarmEnabled: tag?.alarmEnabled === true || existing?.alarmEnabled === true,
          alarmOperator: normalizeAlarmOperator(tag?.alarmOperator || existing?.alarmOperator),
          alarmValue: normalizeAlarmThreshold(tag?.alarmValue || existing?.alarmValue),
        };
        bucket.set(childPath, nextRow);
      }
    });
    const out = new Map();
    parentMap.forEach((rowsByPath, parentPath) => {
      const rows = Array.from(rowsByPath.values()).sort((a, b) =>
        String(a?.name || "").localeCompare(String(b?.name || ""))
      );
      out.set(parentPath, rows);
    });
    return out;
  }, [tags]);
  const trendTagOptions = useMemo(() => {
    const out = [];
    const seen = new Set();
    (tags || []).forEach((t) => {
      if (t?.trendEnabled !== true) return;
      const key = getTagPathKey(t) || getTagLegacyKey(t);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const labelName = normalizeTagName(t?.name || t?.tagPath || "");
      const topic = String(t?.topic || "").trim() || "Default";
      out.push({ value: key, label: `${topic} | ${labelName}` });
    });
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [tags]);
  const trendGroupedTags = useMemo(() => {
    const groups = new Map();
    (tags || []).forEach((tag, idx) => {
      if (tag?.trendEnabled !== true) return;
      const name = normalizeTagName(tag?.name || "");
      const tagPath = normalizeTagName(tag?.tagPath || "");
      const groupRaw = normalizeTagName(tag?.groupName || "");
      if (!name && !tagPath && !groupRaw) return;
      const topicKey = normalizeTagName(tag?.topic || "") || "No Topic";
      const groupKey = getTagGroupKey(tag);
      if (!groups.has(topicKey)) groups.set(topicKey, new Map());
      const topicMap = groups.get(topicKey);
      if (!topicMap.has(groupKey)) {
        topicMap.set(groupKey, { groupName: groupKey, items: [] });
      }
      topicMap.get(groupKey).items.push({ tag: { ...tag, name }, idx });
    });
    const out = Array.from(groups.entries()).map(([topic, tagMap]) => ({
      topic,
      groups: Array.from(tagMap.values()).sort((a, b) => a.groupName.localeCompare(b.groupName)),
    }));
    out.sort((a, b) => a.topic.localeCompare(b.topic));
    return out;
  }, [tags]);

  useEffect(() => {
    if (!applyTopic && (topics || []).length) {
      setApplyTopic(topics[0]?.name || "");
    }
    if (!manualTag.topic && (topics || []).length) {
      setManualTag((prev) => ({ ...prev, topic: topics[0]?.name || "" }));
    }
    if (!manualTopic.plcName && (plcs || []).length) {
      setManualTopic((prev) => ({ ...prev, plcName: plcs[0]?.name || "" }));
    }
  }, [topics, plcs, applyTopic, manualTag.topic, manualTopic.plcName]);
  const groupedTags = useMemo(() => {
    const q = String(tagSearch || "").trim().toLowerCase();
    const groups = new Map();
    (tags || []).forEach((tag, idx) => {
      const name = normalizeTagName(tag?.name || "");
      const tagPath = normalizeTagName(tag?.tagPath || "");
      const groupRaw = normalizeTagName(tag?.groupName || "");
      if (q) {
        const topicText = normalizeTagName(tag?.topic || "");
        const templateText = normalizeTagName(tag?.plcType || "");
        const hay = `${name} ${tagPath} ${groupRaw} ${topicText} ${templateText}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      if (!name && !tagPath && !groupRaw) return;
      const topicKey = normalizeTagName(tag?.topic || "") || "No Topic";
      const groupKey = getTagGroupKey(tag);
      if (!groups.has(topicKey)) groups.set(topicKey, new Map());
      const topicMap = groups.get(topicKey);
      if (!topicMap.has(groupKey)) {
        topicMap.set(groupKey, { groupName: groupKey, items: [] });
      }
      topicMap.get(groupKey).items.push({ tag: { ...tag, name }, idx });
    });
    return Array.from(groups.entries()).map(([topic, tagMap]) => ({
      topic,
      groups: Array.from(tagMap.values()),
    }));
  }, [tags, tagSearch]);

  const templateSourceGroups = useMemo(() => {
    const groups = new Map();
    (tags || []).forEach((tag) => {
      const topic = normalizeTagName(tag?.topic || "") || "No Topic";
      const groupName = getTagGroupKey(tag);
      const key = `${topic}::${groupName}`;
      if (!groups.has(key)) {
        groups.set(key, { key, topic, groupName, items: [] });
      }
      groups.get(key).items.push(tag);
    });
    return Array.from(groups.values())
      .map((entry) => ({ ...entry, count: entry.items.length }))
      .sort((a, b) => {
        const g = String(a.groupName || "").localeCompare(String(b.groupName || ""));
        if (g !== 0) return g;
        return String(a.topic || "").localeCompare(String(b.topic || ""));
      });
  }, [tags]);

  useEffect(() => {
    if (!templateSourceGroups.length) {
      if (templateSourceGroupKey) setTemplateSourceGroupKey("");
      return;
    }
    if (!templateSourceGroupKey || !templateSourceGroups.some((g) => g.key === templateSourceGroupKey)) {
      setTemplateSourceGroupKey(templateSourceGroups[0].key);
    }
  }, [templateSourceGroups, templateSourceGroupKey]);

  const groupNameOptions = useMemo(() => {
    const topic = String(manualTag.topic || "").trim();
    const names = new Set();
    (tags || []).forEach((t) => {
      if (topic && String(t.topic || "").trim() !== topic) return;
      const group = String(t.groupName || "").trim();
      if (group) names.add(group);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [tags, manualTag.topic]);

  const templateMap = useMemo(() => {
    const map = new Map();
    templates.forEach((t) => {
      map.set(t.name, t);
    });
    return map;
  }, [templates]);

  const topicMap = useMemo(() => {
    const map = new Map();
    (topics || []).forEach((t) => {
      map.set(t.name, t);
    });
    return map;
  }, [topics]);

  const filteredApplyTemplates = useMemo(() => {
    const q = String(applyTemplateSearch || "").trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const name = String(t?.name || "").toLowerCase();
      const parent = String(t?.parent_name || "").toLowerCase();
      return name.includes(q) || parent.includes(q);
    });
  }, [templates, applyTemplateSearch]);
  const deferredTemplateFieldRows = useDeferredValue(templateFieldRows);

  const editorResolvedRows = useMemo(() => {
    const currentName = String(templateName || editTemplate || "").trim();
    const rowsForExpansion = (Array.isArray(deferredTemplateFieldRows) ? deferredTemplateFieldRows : []).map((row) => ({
      ...(row && typeof row === "object" ? row : {}),
      name: String(row?.name || "").trim(),
      tagPath: String(row?.tagPath || "").trim(),
      plcType: String(row?.plcType || "").trim(),
      baseType: String(row?.baseType || "").trim(),
      isArray: row?.isArray === true,
      arraySpec: String(row?.arraySpec || "").trim(),
      uaType: String(row?.uaType || "").trim(),
      topic: String(row?.topic || "").trim(),
      mappingSet: String(row?.mappingSet || "").trim(),
    }));
    const hasDraftRows =
      Array.isArray(rowsForExpansion) &&
      rowsForExpansion.some((r) => {
        const n = String(r?.name || "").trim();
        const p = String(r?.tagPath || "").trim();
        return n || p;
      });
    if (hasDraftRows) {
      // Fast-path: when DB/template rows are already present, use them directly.
      // Avoid expensive recursive expansion on every editor render.
      return rowsForExpansion;
    }
    if (!currentName) return [];
    return resolveTemplateFields(currentName);
  }, [templateName, editTemplate, deferredTemplateFieldRows, templateMap]);


  const editorResolvedOnlyRows = useMemo(() => {
    const directKeys = new Set(
      (Array.isArray(templateFieldRows) ? templateFieldRows : [])
        .map((row) => String(row?.tagPath || row?.name || "").trim().toLowerCase())
        .filter(Boolean)
    );
    return (Array.isArray(editorResolvedRows) ? editorResolvedRows : []).filter((row) => {
      const key = String(row?.tagPath || row?.name || "").trim().toLowerCase();
      if (!key) return false;
      return !directKeys.has(key);
    });
  }, [editorResolvedRows, templateFieldRows]);

  const deferredEditorResolvedRows = useDeferredValue(editorResolvedRows);

  const templateFieldRowsByPath = useMemo(() => {
    const map = new Map();
    (Array.isArray(templateFieldRows) ? templateFieldRows : []).forEach((row, idx) => {
      const key = String(row?.tagPath || row?.name || "").trim();
      if (key) map.set(key, { row, idx });
    });
    return map;
  }, [templateFieldRows]);

  const editorResolvedRowsByPath = useMemo(() => {
    const map = new Map();
    (Array.isArray(deferredEditorResolvedRows) ? deferredEditorResolvedRows : []).forEach((row) => {
      const key = String(row?.tagPath || row?.name || "").trim();
      if (key && !map.has(key)) map.set(key, row);
    });
    return map;
  }, [deferredEditorResolvedRows]);

  const templateFieldTreePaths = useMemo(() => {
    const paths = [];
    const seen = new Set();
    const addPath = (value) => {
      const path = String(value || "").trim();
      if (!path || seen.has(path)) return;
      seen.add(path);
      paths.push(path);
    };
    (Array.isArray(templateFieldRows) ? templateFieldRows : []).forEach((row) =>
      addPath(row?.tagPath || row?.name)
    );
    (Array.isArray(deferredEditorResolvedRows) ? deferredEditorResolvedRows : []).forEach((row) =>
      addPath(row?.tagPath || row?.name)
    );
    return paths;
  }, [templateFieldRows, deferredEditorResolvedRows]);

  const templateFieldTree = useMemo(() => {
    const root = { fullPath: "", children: new Map(), leaf: false };
    const splitPathSegments = (rawPath) => {
      const path = String(rawPath || "").trim();
      if (!path) return [];
      const dotParts = path.split(".").map((p) => p.trim()).filter(Boolean);
      const segments = [];
      dotParts.forEach((part) => {
        const tokens = String(part).match(/([^\[\]]+)|(\[[^\]]+\])/g) || [];
        tokens.forEach((token) => {
          const clean = String(token || "").trim();
          if (clean) segments.push(clean);
        });
      });
      return segments;
    };
    const appendPath = (parent, segment) => {
      if (!parent) return segment;
      return String(segment || "").startsWith("[") ? `${parent}${segment}` : `${parent}.${segment}`;
    };
    const addPath = (rawPath) => {
      const path = String(rawPath || "").trim();
      if (!path) return;
      const parts = splitPathSegments(path);
      if (!parts.length) return;
      let cursor = root;
      parts.forEach((part, idx) => {
        const fullPath = appendPath(cursor.fullPath, part);
        if (!cursor.children.has(part)) {
          cursor.children.set(part, { name: part, fullPath, children: new Map(), leaf: false });
        }
        cursor = cursor.children.get(part);
        if (idx === parts.length - 1) cursor.leaf = true;
      });
    };

    (Array.isArray(templateFieldTreePaths) ? templateFieldTreePaths : []).forEach((path) => addPath(path));

    const compareTreeNodeNames = (a, b) => {
      const aName = String(a?.name || "");
      const bName = String(b?.name || "");
      const aBracket = aName.match(/^\[(\d+)\]$/);
      const bBracket = bName.match(/^\[(\d+)\]$/);
      if (aBracket && bBracket) {
        return Number.parseInt(aBracket[1], 10) - Number.parseInt(bBracket[1], 10);
      }
      if (aBracket && !bBracket) return 1;
      if (!aBracket && bBracket) return -1;
      return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: "base" });
    };
    const toArray = (node) =>
      Array.from(node.children.values())
        .sort(compareTreeNodeNames)
        .map((child) => ({ ...child, children: toArray(child) }));
    return toArray(root);
  }, [templateFieldTreePaths]);


  useEffect(() => {
    setTemplateFieldEditingKey("");
  }, [editTemplate, templateName]);

  const visibleTagColumnCount = useMemo(() => {
    const count = tagColumnKeys.filter((key) => tagVisibleColumns[key] !== false).length;
    return count || 1;
  }, [tagVisibleColumns, tagColumnKeys]);

  function showTagColumn(key) {
    return tagVisibleColumns[key] !== false;
  }

  function getTagLegacyKey(tag) {
    const topicName = normalizeTagName(tag?.topic || "");
    const name = String(tag?.name || "").trim();
    if (!name) return "";
    const resolvedTopic = topicName || "Default";
    return `${resolvedTopic}.${name}`;
  }

  function getTagPathKey(tag) {
    const topicName = normalizeTagName(tag?.topic || "");
    const path = String(tag?.tagPath || tag?.name || "").trim();
    if (!path) return "";
    const resolvedTopic = topicName || "Default";
    return `${resolvedTopic}.${path}`;
  }

  function getTagLiveKeys(tag) {
    const pathKey = getTagPathKey(tag);
    const legacyKey = getTagLegacyKey(tag);
    const out = [];
    const seen = new Set();
    [pathKey, legacyKey].forEach((key) => {
      const k = String(key || "").trim();
      if (!k) return;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
      const lower = k.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        out.push(lower);
      }
    });
    return out;
  }

  function getLiveValueForTag(source, tag) {
    if (!source || typeof source !== "object") return undefined;
    const keys = getTagLiveKeys(tag);
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        return source[key];
      }
    }
    return undefined;
  }

  const tagMappingMap = useMemo(() => {
    const map = new Map();
    (tagMappings || []).forEach((m) => {
      const key = String(m.tag_key || "").trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({
        field: String(m.field ?? ""),
        state: String(m.state ?? ""),
        color: String(m.color ?? ""),
      });
    });
    return map;
  }, [tagMappings]);

  useEffect(() => {
    if (!mappingSetAutoSelectedRef.current && !mappingSetName && mappingSets.length) {
      mappingSetAutoSelectedRef.current = true;
      const nextName = mappingSets[0]?.name || "";
      setMappingSetName(nextName);
      setMappingSetOriginalName(nextName);
      return;
    }
    if (mappingSetOriginalName && mappingSetName && mappingSetName !== mappingSetOriginalName) {
      return;
    }
    const set = mappingSets.find((s) => s.name === mappingSetName);
    const rows = Array.isArray(set?.mappings) ? set.mappings.map((m) => normalizeStateMappingRow(m)) : [];
    setMappingSetRows(rows.length ? rows : [{ field: "State Text", state: "", color: "#000000" }]);
  }, [mappingSetName, mappingSets]);

  function resolveTemplateStateMappings(name) {
    const visited = new Set();
    const map = new Map();
    function walk(n) {
      if (!n || visited.has(n)) return;
      visited.add(n);
      const tmpl = templateMap.get(n);
      if (!tmpl) return;
      if (tmpl.parent_name) {
        walk(tmpl.parent_name);
      }
      if (Array.isArray(tmpl.state_mappings)) {
        tmpl.state_mappings.forEach((m) => {
          const fieldVal = String(m?.field ?? "").trim();
          const stateVal = String(m?.state ?? "").trim();
          if (!stateVal) return;
          const key = `${fieldVal}::${stateVal}`;
          map.set(key, String(m?.color || "").trim());
        });
      }
    }
    walk(name);
    return Array.from(map.entries()).map(([key, color]) => {
      const [field, state] = key.split("::");
      return { field, state, color };
    });
  }

  function getStateColorForTag(tag) {
    const mappingSetName = String(tag?.mappingSet || "").trim();
    const templateName = String(tag?.plcType || "").trim();
    const rawValue = getLiveValueForTag(liveValues, tag);
    const scale = Number.isFinite(Number(tag?.scale)) ? Number(tag.scale) : 1;
    const value =
      rawValue != null && rawValue !== "" && !Number.isNaN(Number(rawValue))
        ? Number(rawValue) * scale
        : rawValue;
    if (value == null || value === "") return "";
    const valStr = String(value).trim();
    const valNum = Number(value);
    const valLower = valStr.toLowerCase();
    const valBool =
      valLower === "true" || valLower === "1"
        ? true
        : valLower === "false" || valLower === "0"
        ? false
        : null;
    const fieldName = String(tag?.name || "").trim();
    const legacyTagKey = getTagLegacyKey(tag);
    const pathTagKey = getTagPathKey(tag);
    const tagMappingsForKey = [
      ...(tagMappingMap.get(pathTagKey) || []),
      ...(tagMappingMap.get(legacyTagKey) || []),
    ];
    const setMappings = mappingSetName
      ? (mappingSets.find((s) => s.name === mappingSetName)?.mappings || [])
      : [];
    const normalizedSetMappings = (setMappings || []).map((m) => ({
      field: String(m?.field ?? ""),
      state: String(m?.state ?? ""),
      color: String(m?.color ?? ""),
    }));
    const allMappings = tagMappingsForKey.length
      ? tagMappingsForKey
      : normalizedSetMappings.length
      ? normalizedSetMappings
      : resolveTemplateStateMappings(templateName);
    if (!allMappings.length) return "";
    const match = allMappings.find((m) => {
        const stateStr = String(m.state ?? "").trim();
        if (!stateStr) return false;
        const stateLower = stateStr.toLowerCase();
        const numeric = Number(stateStr);
        if (Number.isFinite(valNum) && Number.isFinite(numeric) && numeric === valNum) return true;
        const stateBool =
          stateLower === "true" || stateLower === "1"
            ? true
            : stateLower === "false" || stateLower === "0"
            ? false
            : null;
        if (valBool !== null && stateBool !== null && valBool === stateBool) return true;
        return stateLower === valLower;
    });
    return match?.color || "";
  }

  function resolveTemplateFields(name) {
    const visited = new Set();
    let fields = [];
    function walk(n) {
      const requested = String(n || "").trim();
      if (!requested) return;
      const resolvedName = templateMap.has(requested)
        ? requested
        : findTemplateNameByType(requested) || requested;
      const visitKey = String(resolvedName || "").trim().toLowerCase();
      if (!visitKey || visited.has(visitKey)) return;
      visited.add(visitKey);
      const tmpl = templateMap.get(resolvedName) || templateMap.get(requested);
      if (!tmpl) return;
      if (tmpl.parent_name) {
        walk(tmpl.parent_name);
      }
      if (Array.isArray(tmpl.fields)) {
        tmpl.fields.forEach((f) => {
          if (typeof f === "string") {
            const key = String(f || "").trim();
            if (!key) return;
            fields = fields.filter((x) => (x.tagPath || x.name) !== key);
            fields.push({
              name: key,
              tagPath: key,
              uaType: "",
              pollMs: "",
              samplingInterval: "",
              topic: "",
              enabled: true,
              mappingSet: "",
              scale: 1,
              decimals: 0,
              alarmEnabled: false,
              alarmOperator: "==",
              alarmValue: "",
            });
            return;
          }
          const nameVal = String(f?.name || "").trim();
          const tagPathVal = String(f?.tagPath || "").trim();
          const mappingSetVal = String(f?.mappingSet || "").trim();
          const uaTypeVal = String(f?.uaType || "").trim();
          const topicVal = String(f?.topic || "").trim();
          const pollMsVal = f?.pollMs ?? "";
          const samplingVal = f?.samplingInterval ?? "";
          const enabledVal = f?.enabled !== false;
          const scaleVal = Number.isFinite(Number(f?.scale)) ? Number(f.scale) : 1;
          const decimalsVal = Number.isFinite(Number(f?.decimals)) ? Number(f.decimals) : 0;
          const key = tagPathVal || nameVal;
          if (!key) return;
          fields = fields.filter((x) => (x.tagPath || x.name) !== key);
          fields.push({
            name: nameVal || key,
            tagPath: tagPathVal || nameVal || key,
            plcType: String(f?.plcType || "").trim(),
            baseType: String(f?.baseType || "").trim(),
            isArray: f?.isArray === true,
            arraySpec: String(f?.arraySpec || "").trim(),
            usage: String(f?.usage || "").trim(),
            uaType: uaTypeVal,
            pollMs: pollMsVal,
            samplingInterval: samplingVal,
            topic: topicVal,
            enabled: enabledVal,
            mappingSet: mappingSetVal,
            scale: scaleVal,
            decimals: decimalsVal,
            alarmEnabled: f?.alarmEnabled === true,
            alarmOperator: normalizeAlarmOperator(f?.alarmOperator),
            alarmValue: normalizeAlarmThreshold(f?.alarmValue),
          });
        });
      }
    }
    walk(name);
    return fields;
  }

  function parseFieldArrayDescriptor(field) {
    const rawType = String(field?.plcType || field?.baseType || "").trim();
    const rawArraySpec = String(field?.arraySpec || "").trim();
    let baseType = String(field?.baseType || "").trim();
    let isArray = field?.isArray === true;
    let arraySpec = rawArraySpec;

    if (!baseType && rawType) {
      const arrayOfMatch = rawType.match(/^ARRAY\s*\[(.+?)\]\s*OF\s*(.+)$/i);
      if (arrayOfMatch) {
        isArray = true;
        arraySpec = arraySpec || String(arrayOfMatch[1] || "").trim();
        baseType = String(arrayOfMatch[2] || "").trim();
      } else {
        const inlineDimsMatch = rawType.match(/^(.*?)(\[[^\]]+\](?:\s*\[[^\]]+\])*)$/);
        if (inlineDimsMatch) {
          isArray = true;
          baseType = String(inlineDimsMatch[1] || "").trim();
          if (!arraySpec) {
            arraySpec = String(inlineDimsMatch[2] || "")
              .replace(/\]\s*\[/g, ",")
              .replace(/^\[/, "")
              .replace(/\]$/g, "")
              .trim();
          }
        } else {
          baseType = rawType;
        }
      }
    }

    return {
      baseType: String(baseType || "").replace(/^"|"$/g, "").trim(),
      isArray,
      arraySpec: String(arraySpec || "").trim(),
    };
  }

  function parseArrayDimensions(arraySpec) {
    const text = String(arraySpec || "").trim();
    if (!text) return [];
    const parts = text
      .split(",")
      .map((p) => p.replace(/^\[/, "").replace(/\]$/, "").trim())
      .filter(Boolean);
    const dims = [];
    for (const part of parts) {
      if (part.includes("..")) {
        const [aRaw, bRaw] = part.split("..");
        const a = Number(String(aRaw || "").trim());
        const b = Number(String(bRaw || "").trim());
        if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
        const count = Math.abs(b - a) + 1;
        if (!Number.isFinite(count) || count <= 0) return [];
        dims.push({ start: 0, count });
        continue;
      }
      if (/^\d+$/.test(part)) {
        const count = Number.parseInt(part, 10);
        if (!Number.isFinite(count) || count <= 0) return [];
        dims.push({ start: 0, count });
        continue;
      }
      return [];
    }
    return dims;
  }

  function buildArrayIndexSuffixes(dimensions, maxMembers = 5000) {
    if (!Array.isArray(dimensions) || !dimensions.length) return [""];
    let suffixes = [""];
    for (const dim of dimensions) {
      const start = Number(dim?.start);
      const count = Number(dim?.count);
      if (!Number.isFinite(count) || count <= 0) return [""];
      const next = [];
      for (const prefix of suffixes) {
        for (let i = 0; i < count; i += 1) {
          next.push(`${prefix}[${start + i}]`);
          if (next.length >= maxMembers) {
            return next;
          }
        }
      }
      suffixes = next;
      if (suffixes.length >= maxMembers) {
        break;
      }
    }
    return suffixes.length ? suffixes : [""];
  }

  function findTemplateNameByType(typeName) {
    const stripArraySuffixes = (v) =>
      String(v || "")
        .replace(/(\[[^\]]*\])+/g, "")
        .trim();
    const stripTrailingMeta = (v) =>
      String(v || "")
        .replace(/\s*\([^)]*\)\s*$/g, "")
        .trim();
    const stripFamilyQualifier = (v) =>
      String(v || "")
        .replace(/\s*\(\s*FamilyType\s*:?=\s*[^)]+\)\s*$/i, "")
        .trim();
    const raw = stripArraySuffixes(
      stripTrailingMeta(stripFamilyQualifier(String(typeName || "").trim().replace(/^"|"$/g, "")))
    );
    if (!raw) return "";
    if (templateMap.has(raw)) return raw;

    const normalize = (v) =>
      stripArraySuffixes(stripTrailingMeta(stripFamilyQualifier(String(v || ""))))
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/\s+/g, "")
        .replace(/[^a-zA-Z0-9_.:]/g, "")
        .toLowerCase();
    const normalizeLoose = (v) =>
      stripArraySuffixes(stripTrailingMeta(stripFamilyQualifier(String(v || ""))))
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/[^a-zA-Z0-9]/g, "")
        .toLowerCase();
    const nameVariants = new Set([raw]);
    if (raw.includes("::")) nameVariants.add(raw.split("::").pop() || "");
    if (raw.includes(".")) nameVariants.add(raw.split(".").pop() || "");
    if (raw.includes(":")) nameVariants.add(raw.split(":").pop() || "");
    const underscoreParts = raw.split("_").filter(Boolean);
    if (underscoreParts.length >= 2) {
      for (let i = 1; i < underscoreParts.length; i += 1) {
        nameVariants.add(underscoreParts.slice(i).join("_"));
      }
    }

    const normalizedCandidates = Array.from(nameVariants).map(normalize).filter(Boolean);
    const looseCandidates = Array.from(nameVariants).map(normalizeLoose).filter(Boolean);
    const scoreTemplateName = (name) => {
      const tmpl = templateMap.get(name);
      return Array.isArray(tmpl?.fields) ? tmpl.fields.length : 0;
    };
    let bestName = "";
    let bestScore = -1;

    for (const [name] of templateMap) {
      const n = normalize(name);
      if (!n) continue;
      if (normalizedCandidates.includes(n)) {
        const score = scoreTemplateName(name);
        if (score > bestScore) {
          bestScore = score;
          bestName = name;
        }
      }
    }
    if (bestName) return bestName;

    // Fallback for prefixed template names (e.g. BatchControl_HMI_Write => HMI_Write).
    for (const [name] of templateMap) {
      const n = normalize(name);
      if (!n) continue;
      for (const c of normalizedCandidates) {
        if (!c) continue;
        if (
          n.endsWith(`_${c}`) ||
          n.endsWith(`.${c}`) ||
          n.endsWith(`:${c}`) ||
          n.endsWith(c)
        ) {
          const score = scoreTemplateName(name);
          if (score > bestScore) {
            bestScore = score;
            bestName = name;
          }
        }
      }
    }
    if (bestName) return bestName;

    // Loose fallback: ignore separators entirely (e.g. "HMI_Write" vs "BatchControlHMIWrite").
    for (const [name] of templateMap) {
      const n = normalizeLoose(name);
      if (!n) continue;
      for (const c of looseCandidates) {
        if (!c) continue;
        if (n === c || n.endsWith(c) || c.endsWith(n) || n.includes(c)) {
          const score = scoreTemplateName(name);
          if (score > bestScore) {
            bestScore = score;
            bestName = name;
          }
        }
      }
    }
    return bestName;
  }

  function resolveTemplateNameByTypeWithContext(typeName, contextTemplateName = "") {
    const direct = findTemplateNameByType(typeName);
    if (direct) return direct;

    const clean = (v) =>
      String(v || "")
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/\s+/g, "");
    const typeClean = clean(typeName);
    const contextClean = clean(contextTemplateName);
    if (!typeClean || !contextClean) return "";

    const contextVariants = [];
    let cursor = contextClean;
    while (cursor) {
      contextVariants.push(cursor);
      const idxs = [cursor.lastIndexOf("_"), cursor.lastIndexOf("."), cursor.lastIndexOf(":")];
      const cut = Math.max(...idxs);
      if (cut <= 0) break;
      cursor = cursor.slice(0, cut);
    }

    const tried = new Set();
    for (const prefix of contextVariants) {
      const candidates = [
        `${prefix}_${typeClean}`,
        `${prefix}.${typeClean}`,
        `${prefix}:${typeClean}`,
        `${prefix}${typeClean}`,
      ];
      for (const candidate of candidates) {
        const c = clean(candidate);
        if (!c || tried.has(c)) continue;
        tried.add(c);
        const hit = findTemplateNameByType(c);
        if (hit) return hit;
      }
    }
    return "";
  }

  function expandTemplateFieldsForTagCreation(templateName, rootFieldsOverride = null) {
    const out = [];
    const unresolvedTypes = new Set();
    const maxExpandedTags = 20000;
    const primitiveTypeSet = new Set([
      "BOOL",
      "BIT",
      "SINT",
      "INT",
      "DINT",
      "LINT",
      "USINT",
      "UINT",
      "UDINT",
      "ULINT",
      "REAL",
      "LREAL",
      "STRING",
      "WSTRING",
      "BYTE",
      "WORD",
      "DWORD",
      "TIME",
      "DATE",
      "DATETIME",
    ]);
    const addLeaf = (pathPrefix, field) => {
      const leafNameRaw = String(field?.name || field?.tagPath || "").trim();
      const leafPathRaw = String(field?.tagPath || field?.name || "").trim();
      const leafName = pathPrefix ? `${pathPrefix}.${leafNameRaw}` : leafNameRaw;
      const leafPath = pathPrefix ? `${pathPrefix}.${leafPathRaw}` : leafPathRaw;
      if (!leafName && !leafPath) return;
      out.push({
        ...field,
        name: leafName || leafPath,
        tagPath: leafPath || leafName,
      });
    };

    const walkFields = (
      fields,
      pathPrefix = "",
      templateStack = [],
      depth = 0,
      contextTemplateName = String(templateName || "")
    ) => {
      if (!Array.isArray(fields) || !fields.length) return;
      if (depth > 24 || out.length >= maxExpandedTags) return;
      for (const field of fields) {
        if (out.length >= maxExpandedTags) break;
        if (field?.enabled === false) continue;
        const rawName = String(field?.name || field?.tagPath || "").trim();
        const rawPath = String(field?.tagPath || field?.name || "").trim();
        if (!rawName && !rawPath) continue;
        const baseSegment = rawPath || rawName;
        const descriptor = parseFieldArrayDescriptor(field);
        const descriptorBaseType = String(descriptor.baseType || "").trim().toUpperCase();
        const isPrimitiveBaseType = descriptorBaseType && primitiveTypeSet.has(descriptorBaseType);
        const nestedTemplateName =
          resolveTemplateNameByTypeWithContext(descriptor.baseType, contextTemplateName) ||
          resolveTemplateNameByTypeWithContext(field?.baseType, contextTemplateName) ||
          resolveTemplateNameByTypeWithContext(field?.plcType, contextTemplateName);
        const nestedFields = nestedTemplateName ? resolveTemplateFields(nestedTemplateName) : [];
        const canExpandNested =
          !isPrimitiveBaseType &&
          nestedTemplateName &&
          nestedFields.length > 0 &&
          !templateStack.includes(String(nestedTemplateName || "").toLowerCase());
        if (
          descriptor.baseType &&
          !nestedTemplateName &&
          !String(field?.uaType || "").trim()
        ) {
          unresolvedTypes.add(String(descriptor.baseType || "").trim());
        }
        const arrayDimensions = descriptor.isArray ? parseArrayDimensions(descriptor.arraySpec) : [];
        const arraySuffixes = descriptor.isArray
          ? buildArrayIndexSuffixes(arrayDimensions, 5000)
          : [""];

        for (const suffix of arraySuffixes) {
          if (out.length >= maxExpandedTags) break;
          const segment = `${baseSegment}${suffix}`;
          const nextPrefix = pathPrefix ? `${pathPrefix}.${segment}` : segment;
          if (canExpandNested) {
            walkFields(
              nestedFields,
              nextPrefix,
              [...templateStack, String(nestedTemplateName || "").toLowerCase()],
              depth + 1,
              String(nestedTemplateName || contextTemplateName || "")
            );
          } else {
            addLeaf(pathPrefix, {
              ...field,
              name: `${rawName || rawPath}${suffix}`,
              tagPath: `${baseSegment}${suffix}`,
            });
          }
        }
      }
    };

    const rootFields = Array.isArray(rootFieldsOverride)
      ? rootFieldsOverride
      : resolveTemplateFields(templateName);
    walkFields(rootFields, "", [String(templateName || "").toLowerCase()], 0, String(templateName || ""));
    return {
      fields: out,
      unresolvedTypes: Array.from(unresolvedTypes).sort((a, b) => a.localeCompare(b)),
    };
  }

  function getParentPathForGrouping(rawPath) {
    const text = String(rawPath || "").trim();
    if (!text) return "";
    const dot = text.lastIndexOf(".");
    if (dot <= 0) return "";
    return text.slice(0, dot).trim();
  }

  function getParentGroupName(groupName) {
    const name = String(groupName || "").trim();
    if (!name || name === "Ungrouped") return "";
    const idx = name.lastIndexOf(".");
    if (idx <= 0) return "";
    return name.slice(0, idx);
  }

  function updateTag(idx, key, value) {
    setConfig((prev) => {
      const next = [...(prev.tags || [])];
      next[idx] = { ...next[idx], [key]: value };
      return { ...prev, tags: next };
    });
  }

  async function writeTagLiveValue(tag, rowKey) {
    const pathKey = getTagPathKey(tag);
    const legacyKey = getTagLegacyKey(tag);
    const key = pathKey || legacyKey;
    if (!key) {
      setError("Tag key missing.");
      return;
    }
    const draftValue =
      Object.prototype.hasOwnProperty.call(tagWriteByKey, rowKey)
        ? tagWriteByKey[rowKey]
        : getLiveValueForTag(liveValues, tag);
    setTagWriteBusyByKey((prev) => ({ ...prev, [rowKey]: true }));
    setError("");
    try {
      const res = await fetch("/api/opc/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tagKey: key,
          legacyTagKey: legacyKey && legacyKey !== key ? legacyKey : undefined,
          uaType: tag?.uaType || "",
          value: draftValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Write failed.");
      const nextValue = Object.prototype.hasOwnProperty.call(data || {}, "value")
        ? data.value
        : draftValue;
      setLiveValues((prev) => {
        const next = { ...prev, [key]: nextValue };
        if (legacyKey && legacyKey !== key && Object.prototype.hasOwnProperty.call(next, legacyKey)) {
          delete next[legacyKey];
        }
        return next;
      });
      setStatus(`Wrote ${key}`);
    } catch (err) {
      setError(err?.message || "Write failed.");
    } finally {
      setTagWriteBusyByKey((prev) => ({ ...prev, [rowKey]: false }));
    }
  }

  function addTag() {
    const defaultTopic = (topics || [])[0]?.name || "";
    setConfig((prev) => ({
      ...prev,
      tags: [
        ...(prev.tags || []),
        {
          name: "",
          tagPath: "",
          uaType: "",
          topic: defaultTopic,
          enabled: true,
          trendEnabled: false,
          trendMode: "value",
          trendSampleMs: "",
          alarmEnabled: false,
          alarmOperator: "==",
          alarmValue: "",
        },
      ],
    }));
  }

  function buildCleanedTags(tags) {
    return (Array.isArray(tags) ? tags : [])
      .map((t) => {
        const row = t && typeof t === "object" ? t : {};
        const name = normalizeTagName(row?.name);
        const tagPath = normalizeTagName(row?.tagPath || name);
        const topic = normalizeTagName(row?.topic || "");
        const groupName = normalizeTagName(row?.groupName || "");
        const samplingInterval = parseOptionalMs(row?.samplingInterval);
        const pollMs = parseOptionalMs(row?.pollMs);
        const deadband = parseOptionalNonNegative(row?.deadband);
        const scale = Number.isFinite(Number(row?.scale)) ? Number(row.scale) : 1;
        const decimals = Number.isFinite(Number(row?.decimals)) ? Number(row.decimals) : 0;
        return {
          ...row,
          name,
          tagPath,
          topic,
          groupName,
          pollMs,
          scale,
          decimals,
          samplingInterval,
          deadband,
          muted: row?.muted === true,
          trendEnabled: row?.trendEnabled === true,
          trendMode: normalizeTrendMode(row?.trendMode),
          trendSampleMs: parseOptionalMs(row?.trendSampleMs),
          alarmEnabled: row?.alarmEnabled === true,
          alarmOperator: normalizeAlarmOperator(row?.alarmOperator),
          alarmValue: normalizeAlarmThreshold(row?.alarmValue),
          mappingSet: String(row?.mappingSet || "").trim(),
        };
      })
      .filter((t) => t.name);
  }

  function buildCleanedPlcs(plcs) {
    return (Array.isArray(plcs) ? plcs : [])
      .map((p, idx) => {
        const row = p && typeof p === "object" ? p : {};
        const id = String(p?.id || makeId());
        const name = normalizeTopicValue(p?.name || `PLC-${idx + 1}`);
        const host = normalizeTopicValue(p?.host || "");
        const slot = Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0;
        const pollMs = parseOptionalMs(p?.pollMs);
        return { ...row, id, name, host, slot, pollMs };
      })
      .filter((p) => p.name);
  }

  function buildCleanedTopics(topics) {
    return (Array.isArray(topics) ? topics : [])
      .map((t) => {
        const row = t && typeof t === "object" ? t : {};
        const name = normalizeTopicValue(t?.name || "");
        const prefix = normalizeTopicValue(t?.prefix || "");
        const plcName = normalizeTopicValue(t?.plcName || t?.plc || "");
        const samplingInterval = parseOptionalMs(t?.samplingInterval);
        return { ...row, name, prefix, plcName, samplingInterval, enabled: t?.enabled !== false };
      })
      .filter((t) => t.name);
  }

  function collectValidationWarnings(nextConfig = config) {
    const warnings = [];
    const topicsByNameSet = new Set((nextConfig.topics || []).map((t) => String(t?.name || "").trim()).filter(Boolean));
    const tagKeys = new Set();
    (nextConfig.tags || []).forEach((tag, idx) => {
      const name = String(tag?.name || "").trim();
      const topic = String(tag?.topic || "").trim();
      const tagPath = String(tag?.tagPath || "").trim();
      if (!name) warnings.push(`Tag row ${idx + 1}: Name is required.`);
      if (!tagPath) warnings.push(`Tag ${name || `row ${idx + 1}`}: Tag Path is required.`);
      if (topic && !topicsByNameSet.has(topic)) warnings.push(`Tag ${name || `row ${idx + 1}`}: Topic '${topic}' does not exist.`);
      const key = topic ? `${topic}.${name}` : name;
      if (key) {
        if (tagKeys.has(key)) warnings.push(`Duplicate tag key '${key}'.`);
        tagKeys.add(key);
      }
      if (tag?.pollMs !== "" && parseOptionalMs(tag?.pollMs) === "") warnings.push(`Tag ${name || `row ${idx + 1}`}: Poll (ms) must be > 0.`);
      if (tag?.samplingInterval !== "" && parseOptionalMs(tag?.samplingInterval) === "") warnings.push(`Tag ${name || `row ${idx + 1}`}: Sampling (ms) must be > 0.`);
      if (tag?.deadband !== "" && parseOptionalNonNegative(tag?.deadband) === "") warnings.push(`Tag ${name || `row ${idx + 1}`}: Deadband must be >= 0.`);
      if (tag?.trendEnabled === true && normalizeTrendMode(tag?.trendMode) === "time" && tag?.trendSampleMs !== "" && parseOptionalMs(tag?.trendSampleMs) === "")
        warnings.push(`Tag ${name || `row ${idx + 1}`}: Trend Every (ms) must be > 0.`);
      if (tag?.alarmEnabled === true && normalizeAlarmThreshold(tag?.alarmValue) === "") {
        warnings.push(`Tag ${name || `row ${idx + 1}`}: Alarm value is required when alarm is enabled.`);
      }
    });
    return warnings;
  }

  const validationWarnings = useMemo(() => collectValidationWarnings(config), [config]);

  async function persistConfig(nextConfig, successMessage = "Config saved.") {
    const res = await fetch("/api/opc/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextConfig),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Save failed.");
    setStatus(successMessage);
  }

  async function addManualTag() {
    const name = String(manualTag.name || "").trim();
    const tagPath = String(manualTag.tagPath || name).trim();
    const topic = String(manualTag.topic || "").trim();
    const groupName = String(manualTag.groupName || "").trim();
    const parsedSamplingInterval = parseOptionalMs(manualTag.samplingInterval);
    const samplingInterval = parsedSamplingInterval === "" ? undefined : parsedSamplingInterval;
    if (!name) {
      setError("Tag name is required.");
      return;
    }
    if ((topics || []).length && !topic) {
      setError("Select a topic for the tag.");
      return;
    }
    setError("");
    const nextTags = [
      ...(config.tags || []),
      {
        name,
        tagPath,
        topic,
        groupName,
        uaType: String(manualTag.uaType || "").trim(),
        pollMs: parseOptionalMs(manualTag.pollMs) || undefined,
        samplingInterval: parseOptionalMs(samplingInterval) || undefined,
        deadband: parseOptionalNonNegative(manualTag.deadband) || undefined,
        enabled: manualTag.enabled !== false,
        muted: manualTag.muted === true,
        trendEnabled: manualTag.trendEnabled === true,
        trendMode: normalizeTrendMode(manualTag.trendMode),
        trendSampleMs: parseOptionalMs(manualTag.trendSampleMs) || undefined,
        alarmEnabled: manualTag.alarmEnabled === true,
        alarmOperator: normalizeAlarmOperator(manualTag.alarmOperator),
        alarmValue: normalizeAlarmThreshold(manualTag.alarmValue),
        mappingSet: String(manualTag.mappingSet || "").trim(),
      },
    ];
    const cleanedTags = buildCleanedTags(nextTags);
    const nextConfig = { ...config, tags: cleanedTags };
    setConfig(nextConfig);
    try {
      await persistConfig(nextConfig, "Tag saved.");
      const tagKey = getTagLegacyKey({ name, topic });
      const cleanedMappings = (manualTagMappings || [])
        .map((row) => normalizeStateMappingRow(row))
        .filter((row) => row.state);
      if (tagKey && cleanedMappings.length) {
        const res = await fetch("/api/opc/tag-mappings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_key: tagKey, mappings: cleanedMappings }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to save mappings.");
        const reload = await fetch("/api/opc/tag-mappings");
        const payload = await reload.json();
        if (reload.ok) setTagMappings(payload.mappings || []);
      }
    } catch (err) {
      setError(err?.message || "Save failed.");
    }
    setManualTag({
      name: "",
      tagPath: "",
      uaType: "",
      pollMs: "",
      samplingInterval: "",
      topic: "",
      enabled: true,
      muted: false,
      trendEnabled: false,
      trendMode: "value",
      trendSampleMs: "",
      alarmEnabled: false,
      alarmOperator: "==",
      alarmValue: "",
      mappingSet: "",
      groupName: "",
      deadband: "",
    });
    setManualTagMappings([{ field: "State Text", state: "", color: "#000000" }]);
    setTagTableEditing(false);
    setEditingTagIndex(null);
  }

  function removeTag(idx) {
    setConfig((prev) => {
      const nextTags = [...(prev.tags || [])];
      nextTags.splice(idx, 1);
      const cleanedTags = buildCleanedTags(nextTags);
      const nextConfig = { ...prev, tags: cleanedTags };
      persistConfig(nextConfig, "Tag removed.").catch((err) => {
        setError(err?.message || "Save failed.");
      });
      return nextConfig;
    });
  }

  async function saveConfig() {
    setError("");
    setStatus("");
    try {
      const warnings = collectValidationWarnings(config);
      if (warnings.length) {
        setError(`Fix validation warnings before save (${warnings.length}).`);
        return;
      }
      const cleanedTags = buildCleanedTags(config.tags);
      const cleanedTopics = buildCleanedTopics(config.topics);
      const cleanedPlcs = buildCleanedPlcs(config.plcs);
      const nextConfig = {
        ...config,
        runtime: normalizeRuntimeConfig(config.runtime),
        tags: cleanedTags,
        topics: cleanedTopics,
        plcs: cleanedPlcs,
      };
      setConfig(nextConfig);
      await persistConfig(nextConfig, "Config saved.");
    } catch (err) {
      setError(err?.message || "Save failed.");
    }
  }

  function beginOpcUaEdit() {
    opcUaSnapshotRef.current = JSON.parse(JSON.stringify(config || {}));
    setOpcUaEditing(true);
  }

  function cancelOpcUaEdit() {
    if (opcUaSnapshotRef.current) {
      setConfig(opcUaSnapshotRef.current);
    }
    setOpcUaEditing(false);
    opcUaSnapshotRef.current = null;
  }

  async function saveOpcUaEdit() {
    await saveConfig();
    setOpcUaEditing(false);
    opcUaSnapshotRef.current = null;
  }

  async function requestRestart() {
    if (!opcConnectionEnabled) {
      setError("OPC connection is disabled. Enable OPC PLC connection before restart.");
      return;
    }
    setError("");
    setStatus("");
    try {
      setRestartPending(true);
      restartStartedAtRef.current = Date.now();
      restartSawDisconnectRef.current = opcConnected === false;
      const toastId = RESTART_TOAST_ID;
      showToast("Restarting OPC server. Waiting for connection...", {
        id: toastId,
        type: "info",
        duration: 0,
      });
      restartToastIdRef.current = toastId;
      const res = await fetch("/api/opc/restart", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Restart failed.");
    } catch (err) {
      const toastId = restartToastIdRef.current;
      if (toastId) {
        showToast(err?.message || "Restart failed.", {
          id: toastId,
          type: "error",
          duration: 5000,
        });
        restartToastIdRef.current = "";
      }
      restartSawDisconnectRef.current = false;
      restartStartedAtRef.current = 0;
      setRestartPending(false);
    }
  }

  function applyCsv() {
    const parsed = parseCsv(csvText);
    if (!parsed.length) {
      setError("CSV is empty or invalid.");
      return;
    }
    const defaultTopic = (topics || [])[0]?.name || "";
    const withTopic = parsed.map((t) => ({ ...t, topic: t.topic || defaultTopic }));
    const cleanedTags = buildCleanedTags(withTopic);
    const nextConfig = { ...config, tags: cleanedTags };
    setConfig(nextConfig);
    persistConfig(nextConfig, `Loaded ${parsed.length} tags from CSV.`).catch((err) => {
      setError(err?.message || "Save failed.");
    });
  }

  async function saveTemplate() {
    setError("");
    setStatus("");
    const name = templateName.trim();
    const fields = (templateFieldRows || [])
      .map((row) => ({
        name: String(row?.name || "").trim(),
        tagPath: String(row?.tagPath || row?.name || "").trim(),
        plcType: String(row?.plcType || "").trim(),
        baseType: String(row?.baseType || "").trim(),
        isArray: row?.isArray === true,
        arraySpec: String(row?.arraySpec || "").trim(),
        usage: String(row?.usage || "").trim(),
        uaType: String(row?.uaType || "").trim(),
        pollMs: row?.pollMs === "" || row?.pollMs == null ? "" : Number(row.pollMs),
        samplingInterval:
          row?.samplingInterval === "" || row?.samplingInterval == null
            ? ""
            : Number(row.samplingInterval),
        topic: String(row?.topic || "").trim(),
        enabled: row?.enabled !== false,
        mappingSet: String(row?.mappingSet || "").trim(),
        scale: Number.isFinite(Number(row?.scale)) ? Number(row.scale) : 1,
        decimals: Number.isFinite(Number(row?.decimals)) ? Number(row.decimals) : 0,
        alarmEnabled: row?.alarmEnabled === true,
        alarmOperator: normalizeAlarmOperator(row?.alarmOperator),
        alarmValue: normalizeAlarmThreshold(row?.alarmValue),
      }))
      .filter((row) => row.name || row.tagPath);
    const stateMappings = (templateStateMappings || [])
      .map((row) => normalizeStateMappingRow(row))
      .filter((row) => row.state);
    const parentName = String(templateParent || "").trim();
    if (!name || !fields.length) {
      setError("UDT name and fields required.");
      return;
    }
    if (parentName && parentName === name) {
      setError("UDT cannot extend itself.");
      return;
    }
    try {
      const res = await fetch("/api/opc/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          fields,
          parent_name: parentName || null,
          group_name: name,
          state_mappings: stateMappings,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed.");
      if (templateOriginalName && templateOriginalName !== name) {
        try {
          await fetch(`/api/opc/templates/${encodeURIComponent(templateOriginalName)}`, {
            method: "DELETE",
          });
        } catch {
          // ignore delete failure
        }
      }
      setStatus("UDT saved.");
      const reload = await fetch("/api/opc/templates");
      const payload = await reload.json();
      if (reload.ok) setTemplates(payload.templates || []);
      setEditTemplate(name);
      setTemplateOriginalName(name);
    } catch (err) {
      setError(err?.message || "Save failed.");
    }
  }

  async function deleteTemplate(name) {
    if (!name) return;
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/opc/templates/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Delete failed.");
      setStatus("UDT deleted.");
      setTemplates((prev) => prev.filter((t) => t.name !== name));
    } catch (err) {
      setError(err?.message || "Delete failed.");
    }
  }

  function applyTemplateToTags() {
    if (!applyTemplate) {
      setError("Select a template.");
      return;
    }
    if (!applyTopic) {
      setError("Select a topic.");
      return;
    }
    const prefix = applyPrefix.trim();
    const fields = expandTemplateFieldsForTagCreation(applyTemplate).fields;
    if (!fields.length) {
      setError("UDT has no fields.");
      return;
    }
    const rootGroup = prefix || applyTemplate;
    const primitiveTypeSet = new Set([
      "BOOL",
      "BIT",
      "SINT",
      "INT",
      "DINT",
      "LINT",
      "USINT",
      "UINT",
      "UDINT",
      "ULINT",
      "REAL",
      "LREAL",
      "STRING",
      "WSTRING",
      "BYTE",
      "WORD",
      "DWORD",
      "TIME",
      "DATE",
      "DATETIME",
    ]);
    const enabledFields = fields.filter((f) => f?.enabled !== false);
    const primitiveRoots = new Set(
      enabledFields
        .map((f) => {
          const path = String(f?.tagPath || f?.name || "").trim();
          const plcType = String(f?.plcType || f?.baseType || "")
            .replace(/\[[^\]]*\]/g, "")
            .replace(/\s*\([^)]*\)\s*$/g, "")
            .replace(/^"|"$/g, "")
            .trim()
            .toUpperCase();
          return path && primitiveTypeSet.has(plcType) ? path : "";
        })
        .filter(Boolean)
    );
    const filteredFields = enabledFields.filter((f) => {
      const path = String(f?.tagPath || f?.name || "").trim();
      if (!path) return false;
      for (const root of primitiveRoots) {
        if (!root || root === path) continue;
        if (path.startsWith(`${root}.`) || path.startsWith(`${root}[`)) return false;
      }
      return true;
    });
    const newTags = filteredFields.map((f) => {
      const fieldName = String(f?.name || f?.tagPath || "").trim();
      const fieldPath = String(f?.tagPath || f?.name || "").trim();
      const name = prefix ? `${prefix}.${fieldName}` : fieldName;
      const tagPath = prefix ? `${prefix}.${fieldPath}` : fieldPath;
      const fieldMappingSet = String(f?.mappingSet || "").trim();
      const fieldUaType = String(f?.uaType || "").trim();
      const fieldTopic = String(f?.topic || "").trim();
      const fieldPollMs =
        f?.pollMs === "" || f?.pollMs == null ? "" : Number(f.pollMs);
      const fieldSampling =
        f?.samplingInterval === "" || f?.samplingInterval == null
          ? ""
          : Number(f.samplingInterval);
      const fieldEnabled = f?.enabled !== false;
      const fieldScale = Number.isFinite(Number(f?.scale)) ? Number(f.scale) : 1;
      const fieldDecimals = Number.isFinite(Number(f?.decimals)) ? Number(f.decimals) : 0;
      return {
        name,
        tagPath,
        topic: fieldTopic || applyTopic,
        groupName: rootGroup,
        plcType: applyTemplate,
        uaType: fieldUaType,
        pollMs: fieldPollMs,
        samplingInterval: fieldSampling,
        enabled: fieldEnabled,
        mappingSet: fieldMappingSet || String(applyMappingSet || "").trim(),
        scale: fieldScale,
        decimals: fieldDecimals,
        alarmEnabled: f?.alarmEnabled === true,
        alarmOperator: normalizeAlarmOperator(f?.alarmOperator),
        alarmValue: normalizeAlarmThreshold(f?.alarmValue),
      };
    });
    const nextTags = [...(config.tags || []), ...newTags];
    const cleanedTags = buildCleanedTags(nextTags);
    const nextConfig = { ...config, tags: cleanedTags };
    setConfig(nextConfig);
    persistConfig(nextConfig, `Added ${newTags.length} tags from UDT.`).catch((err) => {
      setError(err?.message || "Save failed.");
    });
  }

  async function onCsvFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    const parsed = parseCsv(text);
    if (parsed.length) {
      const defaultTopic = (topics || [])[0]?.name || "";
      const withTopic = parsed.map((t) => ({ ...t, topic: t.topic || defaultTopic }));
      const cleanedTags = buildCleanedTags(withTopic);
      const nextConfig = { ...config, tags: cleanedTags };
      setConfig(nextConfig);
      persistConfig(nextConfig, `Loaded ${parsed.length} tags from CSV.`).catch((err) => {
        setError(err?.message || "Save failed.");
      });
    } else {
      setError("CSV is empty or invalid.");
    }
  }

  function createTemplateFromTagGroup() {
    const selected = templateSourceGroups.find((g) => g.key === templateSourceGroupKey);
    if (!selected) {
      setError("Select a tag group first.");
      return;
    }
    const groupName = String(selected.groupName || "").trim();
    const stripGroupPrefix = (value) => {
      const text = normalizeTagName(value || "");
      if (!text || !groupName) return text;
      const prefix = `${groupName}.`;
      if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
        return text.slice(prefix.length);
      }
      return text;
    };
    const rows = (selected.items || [])
      .map((tag) => {
        const rawName = normalizeTagName(tag?.name || "");
        const rawTagPath = normalizeTagName(tag?.tagPath || rawName);
        const name = stripGroupPrefix(rawName) || stripGroupPrefix(rawTagPath) || rawName || rawTagPath;
        const tagPath = stripGroupPrefix(rawTagPath) || stripGroupPrefix(rawName) || rawTagPath || rawName;
        if (!name && !tagPath) return null;
        return {
          name,
          tagPath,
          uaType: String(tag?.uaType || "").trim(),
          pollMs: tag?.pollMs === "" || tag?.pollMs == null ? "" : Number(tag.pollMs),
          samplingInterval:
            tag?.samplingInterval === "" || tag?.samplingInterval == null ? "" : Number(tag.samplingInterval),
          topic: "",
          enabled: tag?.enabled !== false,
          mappingSet: String(tag?.mappingSet || "").trim(),
          scale: Number.isFinite(Number(tag?.scale)) ? Number(tag.scale) : 1,
          decimals: Number.isFinite(Number(tag?.decimals)) ? Number(tag.decimals) : 0,
          alarmEnabled: tag?.alarmEnabled === true,
          alarmOperator: normalizeAlarmOperator(tag?.alarmOperator),
          alarmValue: normalizeAlarmThreshold(tag?.alarmValue),
        };
      })
      .filter(Boolean);
    if (!rows.length) {
      setError("Selected tag group has no tags to build a template.");
      return;
    }
    setEditTemplate("");
    setTemplateOriginalName("");
    setTemplateParent("");
    setTemplateFieldRows(rows);
    setTemplateStateMappings([{ field: "State Text", state: "", color: "#000000" }]);
    setTemplateEditing(true);
    setTemplateName(groupName || "NewUDT");
    setStatus(`Loaded ${rows.length} fields from group "${groupName || "Ungrouped"}".`);
  }

  const recentErrorCount = useMemo(() => {
    const cutoff = Date.now() - 15000;
    return errorLogEntries.filter((entry) => entry.at >= cutoff && entry.kind === "error").length;
  }, [errorLogEntries]);

  function renderErrorLogsCard() {
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          background: "var(--bg-elev)",
          borderRadius: 12,
          padding: 12,
          boxShadow: "0 1px 2px rgba(16,24,40,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>OPC Error Logs</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{errorLogEntries.length} entries</div>
            <button
              onClick={() => {
                setErrorLogEntries([]);
                seenOpcIssueIdsRef.current.clear();
              }}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 12,
                color: "var(--text)",
              }}
            >
              Clear
            </button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          Live errors can clear on the next successful poll. This log keeps a short history.
        </div>
        {errorLogEntries.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No logged errors yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 6, maxHeight: 340, overflowY: "auto" }}>
            {errorLogEntries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  border: "1px solid #eaecf0",
                  borderRadius: 8,
                  padding: "6px 8px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 12,
                }}
              >
                <div style={{ minWidth: 0, overflow: "hidden" }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.tag}
                  </div>
                  {String(entry?.message || "").trim() ? (
                    <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
                      {String(entry.message)}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  <span
                    style={{
                      color:
                        entry.kind === "error"
                          ? "#b42318"
                          : entry.kind === "warn"
                          ? "#b54708"
                          : "#027a48",
                      fontWeight: 600,
                    }}
                  >
                    {entry.kind === "error"
                      ? (entry?.count != null && String(entry.count) !== "" ? `err ${entry.count}` : "error")
                      : entry.kind === "warn"
                      ? "warn"
                      : entry.kind === "info"
                      ? "info"
                      : "cleared"}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderServerDiagnosticsCard() {
    const app = serverDiagnostics?.app && typeof serverDiagnostics.app === "object" ? serverDiagnostics.app : {};
    const db = serverDiagnostics?.db && typeof serverDiagnostics.db === "object" ? serverDiagnostics.db : {};
    const opc = serverDiagnostics?.opc && typeof serverDiagnostics.opc === "object" ? serverDiagnostics.opc : {};
    const runtime = opc?.runtime && typeof opc.runtime === "object" ? opc.runtime : {};
    const plcTargets = Array.isArray(runtime?.plcTargets) ? runtime.plcTargets : [];
    const formatNum = (value) => (Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : "--");
    const formatBytes = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return "--";
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
      return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };
    const qualityCounts = opc?.qualityCounts && typeof opc.qualityCounts === "object" ? opc.qualityCounts : {};
    const qualitySummary = Object.keys(qualityCounts).length
      ? Object.entries(qualityCounts).map(([k, v]) => `${k}:${v}`).join(" | ")
      : "--";

    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-elev)", padding: 12, marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }}>Server Performance</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {Number.isFinite(Number(serverDiagnostics?.checkedAt))
              ? new Date(Number(serverDiagnostics.checkedAt)).toLocaleTimeString()
              : "--"}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 8, fontSize: 12 }}>
          <div><strong>PID:</strong> {formatNum(app?.pid)}</div>
          <div><strong>Uptime:</strong> {formatNum(app?.uptimeSec)} s</div>
          <div><strong>Node:</strong> {String(app?.nodeVersion || "--")}</div>
          <div><strong>Load 1m:</strong> {formatNum(app?.loadAvg1m)}</div>
          <div><strong>Host CPU:</strong> {Number.isFinite(Number(app?.hostCpuUsagePct)) ? `${Number(app.hostCpuUsagePct).toFixed(1)}%` : "--"}</div>
          <div><strong>App CPU:</strong> {Number.isFinite(Number(app?.cpuUsagePct)) ? `${Number(app.cpuUsagePct).toFixed(1)}%` : "--"}</div>
          <div><strong>System RAM:</strong> {Number.isFinite(Number(app?.systemMemoryUsedPct)) ? `${Number(app.systemMemoryUsedPct).toFixed(1)}%` : "--"}</div>
          <div><strong>RAM Used:</strong> {formatBytes(app?.usedMemoryBytes)} / {formatBytes(app?.totalMemoryBytes)}</div>
          <div><strong>App Memory Used:</strong> {formatBytes(app?.rssBytes)}</div>
          <div><strong>Heap Used:</strong> {formatBytes(app?.heapUsedBytes)}</div>
          <div><strong>Heap Total:</strong> {formatBytes(app?.heapTotalBytes)}</div>
          <div><strong>App RAM Share:</strong> {Number.isFinite(Number(app?.appMemoryOfSystemPct)) ? `${Number(app.appMemoryOfSystemPct).toFixed(2)}%` : "--"}</div>
          <div><strong>DB Ping:</strong> {Number.isFinite(Number(db?.pingMs)) ? `${Math.round(Number(db.pingMs))} ms` : "--"}</div>
          <div><strong>OPC Connected:</strong> {opc?.connected ? "Yes" : "No"}</div>
          <div><strong>Last Poll Age:</strong> {Number.isFinite(Number(opc?.lastPollAgeMs)) ? `${Math.round(Number(opc.lastPollAgeMs))} ms` : "--"}</div>
          <div><strong>Value Count:</strong> {formatNum(opc?.valueCount)}</div>
          <div><strong>Multi-Read:</strong> {runtime?.multiReadEnabled === false ? "Off" : "On"}</div>
          <div><strong>Batch Size:</strong> {formatNum(runtime?.multiReadBatchSize)}</div>
          <div><strong>Reads/Tick:</strong> {formatNum(runtime?.maxReadsPerTick)}</div>
          <div><strong>MQTT:</strong> {runtime?.mqttEnabled ? (runtime?.mqttConnected ? "Connected" : "Enabled") : "Off"}</div>
          <div><strong>Read Timeout:</strong> {Number.isFinite(Number(runtime?.readTimeoutMs)) ? `${Math.round(Number(runtime.readTimeoutMs))} ms` : "--"}</div>
          <div><strong>Retry:</strong> {formatNum(runtime?.readRetryCount)} @ {Number.isFinite(Number(runtime?.readRetryDelayMs)) ? `${Math.round(Number(runtime.readRetryDelayMs))}ms` : "--"}</div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          <strong>Quality Counts:</strong> {qualitySummary}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
          <strong>Active PLC Targets:</strong>{" "}
          {plcTargets.length
            ? plcTargets
                .map((t) => {
                  const name = String(t?.name || "").trim() || "(unnamed)";
                  const host = String(t?.host || "").trim() || "--";
                  const slot = Number.isFinite(Number(t?.slot)) ? Math.round(Number(t.slot)) : 0;
                  const connected = t?.connected === true ? "connected" : "disconnected";
                  return `${name} ${host}/slot${slot} (${connected})`;
                })
                .join(" | ")
            : "--"}
        </div>
        {String(db?.error || "").trim() ? (
          <div style={{ marginTop: 6, fontSize: 12, color: "#b42318" }}>
            <strong>DB Error:</strong> {String(db.error)}
          </div>
        ) : null}
      </div>
    );
  }

  function renderTagDiagnosticsCard() {
    const entries = Object.entries(liveDiagnostics || {});
    const uniqueEntryMap = new Map();
    for (const [key, d] of entries) {
      const topic = String(d?.topic || "").trim();
      const tagPath = String(d?.tagPath || d?.name || key || "").trim();
      const uniqueKey = `${topic}::${tagPath}`.toLowerCase();
      if (!uniqueKey) continue;
      if (!uniqueEntryMap.has(uniqueKey)) {
        uniqueEntryMap.set(uniqueKey, [key, d]);
      }
    }
    const uniqueEntries = Array.from(uniqueEntryMap.values());
    const entriesForCompute =
      uniqueEntries.length > DIAGNOSTICS_UI_MAX_ROWS
        ? uniqueEntries.slice(0, DIAGNOSTICS_UI_MAX_ROWS)
        : uniqueEntries;
    const rows = entriesForCompute.map(([key, d]) => {
      const hasReadMetrics =
        d && typeof d === "object" &&
        (
          Object.prototype.hasOwnProperty.call(d, "readCount") ||
          Object.prototype.hasOwnProperty.call(d, "readSuccessCount") ||
          Object.prototype.hasOwnProperty.call(d, "readErrorCount") ||
          Object.prototype.hasOwnProperty.call(d, "avgReadDurationMs") ||
          Object.prototype.hasOwnProperty.call(d, "maxReadDurationMs")
        );
      const readCount = hasReadMetrics && Number.isFinite(Number(d?.readCount)) ? Number(d.readCount) : null;
      const readSuccessCount = hasReadMetrics && Number.isFinite(Number(d?.readSuccessCount)) ? Number(d.readSuccessCount) : null;
      const readErrorCount = hasReadMetrics && Number.isFinite(Number(d?.readErrorCount)) ? Number(d.readErrorCount) : null;
      const avgReadDurationMs = Number.isFinite(Number(d?.avgReadDurationMs)) ? Number(d.avgReadDurationMs) : null;
      const maxReadDurationMs = Number.isFinite(Number(d?.maxReadDurationMs)) ? Number(d.maxReadDurationMs) : null;
      const hasWriteMetrics =
        d && typeof d === "object" &&
        (
          Object.prototype.hasOwnProperty.call(d, "writeCount") ||
          Object.prototype.hasOwnProperty.call(d, "avgWriteDurationMs") ||
          Object.prototype.hasOwnProperty.call(d, "maxWriteDurationMs")
        );
      const writeCount = hasWriteMetrics && Number.isFinite(Number(d?.writeCount)) ? Number(d.writeCount) : null;
      const avgWriteDurationMs = Number.isFinite(Number(d?.avgWriteDurationMs)) ? Number(d.avgWriteDurationMs) : null;
      const maxWriteDurationMs = Number.isFinite(Number(d?.maxWriteDurationMs)) ? Number(d.maxWriteDurationMs) : null;
      return {
        key,
        d,
        quality: liveQualities?.[key] || "Unknown",
        hasReadMetrics,
        hasWriteMetrics,
        readCount,
        readSuccessCount,
        readErrorCount,
        avgReadDurationMs,
        maxReadDurationMs,
        writeCount,
        avgWriteDurationMs,
        maxWriteDurationMs,
      };
    });
    const rowsWithReadMetrics = rows.filter((r) => r.hasReadMetrics);
    const rowsWithWriteMetrics = rows.filter((r) => r.hasWriteMetrics);
    const totalReadCount = rowsWithReadMetrics.reduce((sum, r) => sum + (Number.isFinite(Number(r.readCount)) ? Number(r.readCount) : 0), 0);
    const totalReadSuccessCount = rowsWithReadMetrics.reduce((sum, r) => sum + (Number.isFinite(Number(r.readSuccessCount)) ? Number(r.readSuccessCount) : 0), 0);
    const totalReadErrorCount = rowsWithReadMetrics.reduce((sum, r) => sum + (Number.isFinite(Number(r.readErrorCount)) ? Number(r.readErrorCount) : 0), 0);
    const readAvgAcrossTags = rows.reduce((sum, r) => sum + (Number.isFinite(r.avgReadDurationMs) ? r.avgReadDurationMs : 0), 0);
    const readAvgAcrossTagsCount = rows.reduce((sum, r) => sum + (Number.isFinite(r.avgReadDurationMs) ? 1 : 0), 0);
    const writeAvgAcrossTags = rows.reduce((sum, r) => sum + (Number.isFinite(r.avgWriteDurationMs) ? r.avgWriteDurationMs : 0), 0);
    const writeAvgAcrossTagsCount = rows.reduce((sum, r) => sum + (Number.isFinite(r.avgWriteDurationMs) ? 1 : 0), 0);
    const maxReadRow = rows.reduce((best, row) => {
      if (!Number.isFinite(row.maxReadDurationMs)) return best;
      if (!best) return row;
      return row.maxReadDurationMs > best.maxReadDurationMs ? row : best;
    }, null);
    const maxWriteRow = rows.reduce((best, row) => {
      if (!Number.isFinite(row.maxWriteDurationMs)) return best;
      if (!best) return row;
      return row.maxWriteDurationMs > best.maxWriteDurationMs ? row : best;
    }, null);
    const writeMetrics = liveRuntime?.writeMetrics && typeof liveRuntime.writeMetrics === "object" ? liveRuntime.writeMetrics : {};
    const totalWriteCount = Number.isFinite(Number(writeMetrics?.count)) ? Number(writeMetrics.count) : rowsWithWriteMetrics.reduce((sum, r) => sum + (Number.isFinite(Number(r.writeCount)) ? Number(r.writeCount) : 0), 0);
    const badQualityCount = rows.reduce((sum, r) => sum + (r.quality === "Bad" ? 1 : 0), 0);
    const mutedCount = rows.reduce((sum, r) => sum + (r.quality === "Muted" ? 1 : 0), 0);
    const staleRefTs = Number(opcLastPollAt) || Date.now();
    const staleCount = rows.reduce((sum, r) => {
      const lastSuccessAt = Number.isFinite(Number(r?.d?.lastSuccessAt)) ? Number(r.d.lastSuccessAt) : null;
      const effective = Number.isFinite(Number(r?.d?.effectiveIntervalMs)) ? Number(r.d.effectiveIntervalMs) : null;
      if (!lastSuccessAt || !effective) return sum;
      return staleRefTs - lastSuccessAt > effective * 3 ? sum + 1 : sum;
    }, 0);
    const hasAnyReadMetrics = rowsWithReadMetrics.length > 0;
    const totalTags = uniqueEntries.length;
    const readTimestamps = rowsWithReadMetrics
      .map((r) => (Number.isFinite(Number(r?.d?.lastReadAt)) ? Number(r.d.lastReadAt) : null))
      .filter((v) => Number.isFinite(v));
    const readAllCycleMs =
      readTimestamps.length >= 2
        ? Math.max(...readTimestamps) - Math.min(...readTimestamps)
        : null;
    const hasReadTimingData = readTimestamps.length >= 2;
    const formatMs = (v) => (Number.isFinite(Number(v)) ? `${Math.round(Number(v))} ms` : "--");
    const formatAt = (v) => {
      const t = Number(v);
      if (!Number.isFinite(t) || t <= 0) return "--";
      return new Date(t).toLocaleTimeString();
    };
    const sortedRows = rows
      .slice()
      .sort((a, b) => {
        const badA = a.quality === "Bad" ? 1 : 0;
        const badB = b.quality === "Bad" ? 1 : 0;
        if (badB !== badA) return badB - badA;
        if (b.readErrorCount !== a.readErrorCount) return b.readErrorCount - a.readErrorCount;
        return a.key.localeCompare(b.key);
      });
    return (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--bg-elev)",
          padding: 12,
          marginTop: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ fontWeight: 700 }} title="Per-tag health details from the OPC poller.">
            Tag Diagnostics
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{totalTags} tags</div>
        </div>
        {uniqueEntries.length > entriesForCompute.length ? (
          <div style={{ marginBottom: 8, fontSize: 11, color: "var(--text-muted)" }}>
            Showing first {entriesForCompute.length} tags for diagnostics performance.
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(150px, 1fr))", gap: 8, marginBottom: 10 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-soft)", fontSize: 12 }}>
            <div style={{ color: "var(--text-muted)" }}>Read Ops</div>
            <div style={{ fontWeight: 700 }}>{hasAnyReadMetrics ? totalReadCount : "--"}</div>
            <div style={{ color: "var(--text-muted)" }}>
              {hasAnyReadMetrics ? `ok ${totalReadSuccessCount} / err ${totalReadErrorCount}` : "extended read metrics unavailable"}
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-soft)", fontSize: 12 }}>
            <div style={{ color: "var(--text-muted)" }}>Read Avg / Max</div>
            <div style={{ fontWeight: 700 }}>
              {hasAnyReadMetrics
                ? `${formatMs(readAvgAcrossTagsCount ? readAvgAcrossTags / readAvgAcrossTagsCount : null)} / ${formatMs(maxReadRow?.maxReadDurationMs)}`
                : "-- / --"}
            </div>
            <div style={{ color: "var(--text-muted)" }}>
              {hasAnyReadMetrics ? `max tag ${maxReadRow?.key || "--"}` : "restart OPC server to enable"}
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-soft)", fontSize: 12 }}>
            <div style={{ color: "var(--text-muted)" }}>Write Ops</div>
            <div style={{ fontWeight: 700 }}>{totalWriteCount}</div>
            <div style={{ color: "var(--text-muted)" }}>
              avg {formatMs(Number.isFinite(Number(writeMetrics?.avgMs)) ? Number(writeMetrics.avgMs) : writeAvgAcrossTagsCount ? writeAvgAcrossTags / writeAvgAcrossTagsCount : null)} / max {formatMs(maxWriteRow?.maxWriteDurationMs)}
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-soft)", fontSize: 12 }}>
            <div style={{ color: "var(--text-muted)" }}>Health</div>
            <div style={{ fontWeight: 700, color: badQualityCount > 0 ? "#b42318" : "var(--text)" }}>
              bad {badQualityCount} / stale {staleCount}
            </div>
            <div style={{ color: "var(--text-muted)" }}>muted {mutedCount}</div>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", background: "var(--bg-soft)", fontSize: 12 }}>
            <div style={{ color: "var(--text-muted)" }}>Tag Sweep</div>
            <div style={{ fontWeight: 700 }}>{totalTags}</div>
            <div style={{ color: "var(--text-muted)" }}>
              read cycle {hasReadTimingData ? formatMs(readAllCycleMs) : "--"}
            </div>
          </div>
        </div>
        {!hasAnyReadMetrics ? (
          <div style={{ marginBottom: 10, fontSize: 11, color: "#b54708", background: "#fff6ed", border: "1px solid #fed7aa", borderRadius: 8, padding: "6px 8px" }}>
            Extended read metrics are not present in current OPC status payload. Restart the OPC server to publish read avg/max counters.
          </div>
        ) : null}
        {uniqueEntries.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No diagnostics yet.</div>
        ) : (
          <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid #eef2f6", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg-soft)" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Topic.Tag key used by OPC status and mappings.">Tag</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Current quality: Good, Bad, Muted, or Unknown.">Quality</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Consecutive read failures since last successful read.">Err Streak</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Current poll interval including backoff and scheduling.">Effective (ms)</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Average and longest read duration for this tag.">Read Avg / Max</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Average and longest write duration for this tag.">Write Avg / Max</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Last successful read and write timestamp.">Last Read / Write</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Most recent read error message for this tag.">Last Error</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.slice(0, 400).map((row) => (
                  <tr key={`diag-${row.key}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px" }}>{row.key}</td>
                    <td style={{ padding: "6px 8px" }}>{row.quality}</td>
                    <td style={{ padding: "6px 8px" }}>{Number(row?.d?.errorStreak || 0)}</td>
                    <td style={{ padding: "6px 8px" }}>{row?.d?.effectiveIntervalMs ?? ""}</td>
                    <td style={{ padding: "6px 8px" }}>{formatMs(row.avgReadDurationMs)} / {formatMs(row.maxReadDurationMs)}</td>
                    <td style={{ padding: "6px 8px" }}>{formatMs(row.avgWriteDurationMs)} / {formatMs(row.maxWriteDurationMs)}</td>
                    <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>
                      {formatAt(row?.d?.lastSuccessAt)} / {formatAt(row?.d?.lastWriteAt)}
                    </td>
                    <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{row?.d?.lastErrorMessage || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const outerStyle = embedded
    ? { width: "100%", height: "100%", background: "transparent", color: "var(--text)" }
    : { minHeight: "100vh", background: "var(--bg-soft)", color: "var(--text)" };
  const innerStyle = embedded
    ? { width: "100%", height: "100%", padding: 0, boxSizing: "border-box", display: "flex", flexDirection: "column" }
    : { width: "100%", minHeight: "100vh", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column" };
  const contentStyle = embedded
    ? { width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }
    : { width: "100%", maxWidth: 1400, margin: "0 auto" };
  const isTagsOnly = mode === "tags" || mode === "logs" || mode === "diagnostics";
  const drawerTabButtonStyle = (active) => ({
    border: "none",
    borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
    background: "transparent",
    color: active ? "var(--accent)" : "var(--text-muted)",
    borderRadius: 0,
    minWidth: 0,
    height: 30,
    padding: "0 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    boxShadow: "none",
    transition: "color 140ms ease, border-color 140ms ease, background-color 140ms ease",
  });

  function renderTagsPanel() {
    const activeTagTab =
      mode === "logs" ? "logs" : mode === "diagnostics" ? "diagnostics" : tagSectionTab;
    const isConfigMode = mode !== "logs" && mode !== "diagnostics";
    const drawerButtonStyle = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
    };
    const sectionCardStyle = {
      border: "1px solid var(--border)",
      background: "var(--bg-elev)",
      borderRadius: 12,
      padding: 12,
      boxShadow: "0 1px 2px rgba(16,24,40,0.06)",
    };
    const dangerIconButtonStyle = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 28,
      height: 28,
      border: "1px solid #f04438",
      background: "#f04438",
      color: "#ffffff",
      borderRadius: 8,
      padding: 0,
      lineHeight: 1,
      boxShadow: "0 4px 12px rgba(240,68,56,0.28)",
    };
    const showDrawerViewButtons = typeof onDrawerViewChange === "function";
    return (
      <div style={{ flex: "1 1 auto", overflow: "auto", padding: embedded ? 0 : 16 }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
              <div
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background:
                    restartPending
                      ? "#fff6ed"
                      : !opcConnectionEnabled
                      ? "#f2f4f7"
                      : opcConnected === true
                      ? "#ecfdf3"
                      : opcConnected === false
                      ? "#fef3f2"
                      : "#f2f4f7",
                  color:
                    restartPending
                      ? "#b54708"
                      : !opcConnectionEnabled
                      ? "var(--text-muted)"
                      : opcConnected === true
                      ? "#027a48"
                      : opcConnected === false
                      ? "#b42318"
                      : "var(--text-muted)",
                  border:
                    restartPending
                      ? "1px solid #fed7aa"
                      : !opcConnectionEnabled
                      ? "1px solid var(--border)"
                      : opcConnected === true
                      ? "1px solid #abefc6"
                      : opcConnected === false
                      ? "1px solid #fecdca"
                      : "1px solid var(--border)",
                }}
              >
                {restartPending
                  ? "Restarting..."
                  : !opcConnectionEnabled
                  ? "Connection Disabled"
                  : opcConnected === true
                  ? "Connected"
                  : opcConnected === false
                  ? "Disconnected"
                  : "Status Unknown"}
              </div>
              {opcLastPollAt ? (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Last poll {new Date(opcLastPollAt).toLocaleTimeString()}
                </div>
              ) : null}
            </div>
            <button
              onClick={requestRestart}
              disabled={restartPending || !opcConnectionEnabled}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 11,
                fontWeight: 700,
                cursor: restartPending || !opcConnectionEnabled ? "not-allowed" : "pointer",
                opacity: restartPending || !opcConnectionEnabled ? 0.65 : 1,
                flex: "0 0 auto",
              }}
              title="Restart OPC Server"
            >
              Restart OPC Server
            </button>
          </div>
        </div>
        {showDrawerViewButtons ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              data-preserve-style="true"
              onClick={() => onDrawerViewChange("opc")}
              style={drawerTabButtonStyle(isConfigMode)}
            >
              Config
            </button>
            <button
              data-preserve-style="true"
              onClick={() => onDrawerViewChange("logs")}
              style={drawerTabButtonStyle(mode === "logs")}
            >
              Logs
            </button>
            <button
              data-preserve-style="true"
              onClick={() => onDrawerViewChange("diagnostics")}
              style={drawerTabButtonStyle(mode === "diagnostics")}
            >
              Diagnostics
            </button>
          </div>
        ) : null}
        {mode !== "logs" && mode !== "diagnostics" ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            data-preserve-style="true"
            onClick={() => setTagSectionTab("tags")}
            style={drawerTabButtonStyle(tagSectionTab === "tags")}
          >
            Tags
          </button>
          <button
            data-preserve-style="true"
            onClick={() => setTagSectionTab("templates")}
            style={drawerTabButtonStyle(tagSectionTab === "templates")}
          >
            UDTs
          </button>
          <button
            data-preserve-style="true"
            onClick={() => setTagSectionTab("mappings")}
            style={drawerTabButtonStyle(tagSectionTab === "mappings")}
          >
            Mappings
          </button>
          <button
            data-preserve-style="true"
            onClick={() => setTagSectionTab("logs")}
            style={drawerTabButtonStyle(tagSectionTab === "logs")}
          >
            Logs
          </button>
          <button
            data-preserve-style="true"
            onClick={() => setTagSectionTab("diagnostics")}
            style={drawerTabButtonStyle(tagSectionTab === "diagnostics")}
          >
            Diagnostics
          </button>
        </div>
        ) : null}
        {activeTagTab === "tags" ? (
          <>
            
            {false ? (
              <div style={{ ...sectionCardStyle, marginBottom: 10, background: "var(--bg-soft)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Name
                    <input
                      value={manualTag.name}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, name: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Tag Path
                    <input
                      value={manualTag.tagPath}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, tagPath: e.target.value }))}
                      placeholder="Defaults to name"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Group Name
                    <input
                      value={manualTag.groupName}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, groupName: e.target.value }))}
                      placeholder="Optional"
                      list="opc-group-names"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <datalist id="opc-group-names">
                    {groupNameOptions.map((name) => (
                      <option key={`group-${name}`} value={name} />
                    ))}
                  </datalist>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Topic
                    <select
                      value={manualTag.topic}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, topic: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    >
                      <option value="">Select topic</option>
                      {(topics || []).map((t) => (
                        <option key={`tag-topic-${t.name}`} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    UA Type
                    <select
                      value={manualTag.uaType}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, uaType: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    >
                      <option value="">Select UA type</option>
                      <option value="Boolean">Boolean</option>
                      <option value="Int16">Int16</option>
                      <option value="Int32">Int32</option>
                      <option value="Int64">Int64</option>
                      <option value="UInt16">UInt16</option>
                      <option value="UInt32">UInt32</option>
                      <option value="UInt64">UInt64</option>
                      <option value="Float">Float</option>
                      <option value="Double">Double</option>
                      <option value="String">String</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Mapping Set
                    <select
                      value={manualTag.mappingSet || ""}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, mappingSet: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    >
                      <option value="">None</option>
                      {mappingSets.map((s) => (
                        <option key={`map-set-${s.name}`} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Poll (ms)
                    <input
                      type="number"
                      min="100"
                      value={manualTag.pollMs}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, pollMs: e.target.value }))}
                      placeholder="Uses global"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Sampling (ms)
                    <input
                      type="number"
                      min="100"
                      value={manualTag.samplingInterval}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, samplingInterval: e.target.value }))}
                      placeholder="Overrides topic"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                </div>
                <div style={{ fontSize: 12, marginTop: 10, marginBottom: 6 }}>Tag Mappings</div>
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", padding: "4px 12px 4px 0", boxSizing: "border-box" }}>
                  <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "separate", borderSpacing: "0 6px", fontSize: 12 }}>
                    <colgroup>
                      <col style={{ width: "27%" }} />
                      <col style={{ width: "18%" }} />
                      <col style={{ width: "41%" }} />
                      <col style={{ width: "14%" }} />
                    </colgroup>
                    <thead>
                      <tr style={{ background: "var(--bg-soft)" }}>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>State Text</th>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>PLC Value</th>
                        <th style={{ textAlign: "left", padding: "8px 10px" }}>Color</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {manualTagMappings.map((row, idx) => (
                        <tr key={`manual-map-${idx}`}>
                          <td style={{ padding: "8px 16px 8px 10px" }}>
                            <input
                              value={row.field || "State Text"}
                              placeholder="State Text"
                              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                              disabled
                            />
                          </td>
                          <td style={{ padding: "8px 16px 8px 10px" }}>
                            <input
                              value={row.state ?? ""}
                              onChange={(e) =>
                                setManualTagMappings((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], state: e.target.value };
                                  return next;
                                })
                              }
                              placeholder="Value"
                              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            />
                          </td>
                          <td style={{ padding: "8px 16px 8px 10px" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginLeft: 8 }}>
                              <input
                                type="color"
                                value={row.color || "#000000"}
                                onChange={(e) =>
                                  setManualTagMappings((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], color: e.target.value };
                                    return next;
                                  })
                                }
                                style={{ width: 36, height: 28, padding: 0, border: "none", background: "transparent" }}
                              />
                              <input
                                value={row.color ?? ""}
                                onChange={(e) =>
                                  setManualTagMappings((prev) => {
                                    const next = [...prev];
                                    next[idx] = { ...next[idx], color: e.target.value };
                                    return next;
                                  })
                                }
                                placeholder="#12b76a"
                                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "8px 10px 8px 14px" }}>
                            <button
                              onClick={() =>
                                setManualTagMappings((prev) => prev.filter((_, i) => i !== idx))
                              }
                              style={{ ...drawerButtonStyle, width: 28, height: 28, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8 }}
                            >
                              <TrashCanIcon />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {manualTagMappings.length === 0 && (
                        <tr>
                          <td colSpan={3} style={{ padding: "8px", color: "var(--text-muted)" }}>
                            No mappings yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() =>
                      setManualTagMappings((prev) => [...prev, { field: "State Text", state: "", color: "#000000" }])
                    }
                    style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                  >
                    Add Mapping
                  </button>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 10, alignItems: "center" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={manualTag.enabled !== false}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, enabled: e.target.checked }))}
                    />
                    Enabled
                  </label>
                <button
                  onClick={addManualTag}
                  title="Add Tag"
                  aria-label="Add Tag"
                  style={{
                    ...drawerButtonStyle,
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "white",
                    borderRadius: 8,
                    width: 32,
                    height: 32,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                    fontWeight: 800,
                  }}
                >
                  +
                </button>
                <button
                  onClick={() => {
                    setManualTag({
                      name: "",
                      tagPath: "",
                      uaType: "",
                      pollMs: "",
                      samplingInterval: "",
                      topic: "",
                      enabled: true,
                      mappingSet: "",
                      alarmEnabled: false,
                      alarmOperator: "==",
                      alarmValue: "",
                    });
                    setShowManualTagForm(false);
                  }}
                  style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                >
                  Cancel
                </button>
              </div>
            </div>
        ) : null}
            <div style={{ ...sectionCardStyle, marginBottom: 10 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, borderBottom: "1px solid var(--border)", paddingBottom: 8 }}>
                <button
                  data-preserve-style="true"
                  onClick={() => setTagToolsTab("template")}
                  style={drawerTabButtonStyle(tagToolsTab === "template")}
                >
                  UDT
                </button>
                <button
                  data-preserve-style="true"
                  onClick={() => setTagToolsTab("bulk")}
                  style={drawerTabButtonStyle(tagToolsTab === "bulk")}
                >
                  Bulk Edit
                </button>
                <button
                  data-preserve-style="true"
                  onClick={() => setTagToolsTab("columns")}
                  style={drawerTabButtonStyle(tagToolsTab === "columns")}
                >
                  Columns
                </button>
              </div>

              {tagToolsTab === "template" ? (
                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr auto",
                      gap: 8,
                      alignItems: "end",
                    }}
                  >
                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                      Topic
                      <select
                        value={applyTopic}
                        onChange={(e) => setApplyTopic(e.target.value)}
                        style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                      >
                        <option value="">Select topic</option>
                        {(topics || []).map((t) => (
                          <option key={`apply-topic-${t.name}`} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                      Tag Name (e.g., Motor1)
                      <input
                        value={applyPrefix}
                        onChange={(e) => setApplyPrefix(e.target.value)}
                        style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                      />
                    </label>
                    <button onClick={applyTemplateToTags} style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px", height: 32 }}>
                      Add From UDT
                    </button>
                  </div>
                  <label style={{ display: "grid", gap: 6, fontSize: 12, maxWidth: 420 }}>
                    UDT
                    <select
                      value={applyTemplate}
                      onChange={(e) => setApplyTemplate(e.target.value)}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    >
                      <option value="">Select UDT</option>
                      {templates.map((t) => {
                        const tName = String(t?.name || "").trim();
                        if (!tName) return null;
                        const parentText = t?.parent_name ? ` (extends ${t.parent_name})` : "";
                        return (
                          <option key={`apply-udt-option-${tName}`} value={tName}>
                            {`${tName}${parentText}`}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>
              ) : tagToolsTab === "bulk" ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                    alignItems: "end",
                  }}
                >
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Apply bulk changes only to tags in this topic. Leave blank to target all topics.">
                    Topic Filter
                    <select
                      value={bulkEdit.topic}
                      onChange={(e) => setBulkEdit((prev) => ({ ...prev, topic: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}
                    >
                      <option value="">All</option>
                      {(topics || []).map((t) => (
                        <option key={`bulk-topic-${t.name}`} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="SQL-LIKE style group filter. Use % for wildcard and _ for single character.">
                    Group Filter
                    <input
                      value={bulkEdit.groupName}
                      onChange={(e) => setBulkEdit((prev) => ({ ...prev, groupName: e.target.value }))}
                      placeholder="e.g. PLC%"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Per-tag poll interval override in milliseconds for matching tags.">
                    Poll (ms)
                    <input
                      type="number"
                      min="100"
                      value={bulkEdit.pollMs}
                      onChange={(e) => setBulkEdit((prev) => ({ ...prev, pollMs: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Sampling interval override in milliseconds for matching tags.">
                    Sampling (ms)
                    <input
                      type="number"
                      min="100"
                      value={bulkEdit.samplingInterval}
                      onChange={(e) => setBulkEdit((prev) => ({ ...prev, samplingInterval: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Minimum numeric change required before a value update is published.">
                    Deadband
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={bulkEdit.deadband}
                      onChange={(e) => setBulkEdit((prev) => ({ ...prev, deadband: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Set mapping set on matching tags. 'Keep current' leaves existing mapping sets unchanged.">
                    Mapping Set
                    <select
                      value={bulkEdit.mappingSet}
                      onChange={(e) => setBulkEdit((prev) => ({ ...prev, mappingSet: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}
                    >
                      <option value="">Keep current</option>
                      {mappingSets.map((s) => (
                        <option key={`bulk-map-${s.name}`} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    style={{ display: "grid", gap: 6, fontSize: 12 }}
                    title="Mute matching tags to stop active polling while keeping configuration."
                  >
                    Muted
                    <span style={{ display: "inline-flex", alignItems: "center", minHeight: 32, paddingLeft: 8 }}>
                      <input
                        type="checkbox"
                        checked={bulkEdit.muted === true}
                        onChange={(e) => setBulkEdit((prev) => ({ ...prev, muted: e.target.checked }))}
                      />
                    </span>
                  </label>
                  <button
                    onClick={applyBulkEditToTags}
                    title="Apply the selected bulk settings to matching tags."
                    style={{
                      ...drawerButtonStyle,
                      border: "1px solid #2b6cff",
                      background: "#2b6cff",
                      color: "white",
                      borderRadius: 8,
                      padding: "6px 14px",
                      height: 32,
                      minWidth: 160,
                      justifySelf: "start",
                      gridColumn: "1 / -1",
                    }}
                  >
                    Apply Bulk Edit
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {tagColumnKeys.map((key) => (
                    <label
                      key={`tag-col-${key}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 8px",
                        borderRadius: 999,
                        border: "1px solid var(--border)",
                        background: showTagColumn(key)
                          ? "color-mix(in srgb, #2b6cff 14%, var(--bg-elev))"
                          : "var(--bg-elev)",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showTagColumn(key)}
                        onChange={(e) => {
                          const next = { ...tagVisibleColumns, [key]: e.target.checked };
                          setTagVisibleColumns(next);
                          try {
                            localStorage.setItem("vizi_tag_columns", JSON.stringify(next));
                          } catch {
                            // ignore
                          }
                        }}
                      />
                      {tagColumnLabels[key] || key}
                    </label>
                  ))}
                </div>
              )}
            </div>
            {validationWarnings.length ? (
              <div style={{ ...sectionCardStyle, borderColor: "#fecdca", background: "#fef3f2", marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: "#b42318", marginBottom: 6 }} title="These checks prevent common OPC issues before saving configuration.">
                  Validation Warnings ({validationWarnings.length})
                </div>
                <div style={{ maxHeight: 120, overflow: "auto", fontSize: 12, color: "#912018" }}>
                  {validationWarnings.slice(0, 50).map((w, i) => (
                    <div key={`warn-${i}`}>{w}</div>
                  ))}
                </div>
              </div>
            ) : null}
            <div
              style={{
                ...sectionCardStyle,
                marginTop: 10,
                overflowX: "auto",
                overflowY: "visible",
                contain: "layout style paint",
                contentVisibility: "auto",
                containIntrinsicSize: "900px",
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <input
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="Search tags..."
                  style={{
                    width: "100%",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "6px 8px",
                    fontSize: 12,
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 8 }}>
                <button
                  onClick={addTagFromToolbar}
                  title="Add Tag"
                  aria-label="Add Tag"
                  style={{
                    ...drawerButtonStyle,
                    border: "1px solid #2b6cff",
                    background: "var(--bg-elev)",
                    color: "#2b6cff",
                    borderRadius: 8,
                    width: 32,
                    height: 32,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                    fontWeight: 800,
                  }}
                >
                  +
                </button>
              </div>
              {tags.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No tags.</div>
              ) : groupedTags.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No tags match search.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px", fontSize: 12, tableLayout: "auto" }}>
                  <thead>
                    <tr>
                      {showTagColumn("enabled") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Enabled</th>
                      ) : null}
                      {showTagColumn("muted") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }} title="Muted tags are configured but not actively polled.">Muted</th>
                      ) : null}
                      {showTagColumn("trend") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }} title="Store compressed trend history for this tag.">Trend</th>
                      ) : null}
                      {showTagColumn("name") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      ) : null}
                      {showTagColumn("topic") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Topic</th>
                      ) : null}
                      {showTagColumn("tagPath") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Tag Path</th>
                      ) : null}
                      {showTagColumn("uaType") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>UA Type</th>
                      ) : null}
                      {showTagColumn("pollMs") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Poll (ms)</th>
                      ) : null}
                      {showTagColumn("samplingInterval") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Sampling (ms)</th>
                      ) : null}
                      {showTagColumn("mappingSet") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Mapping Set</th>
                      ) : null}
                      {showTagColumn("scale") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Scale</th>
                      ) : null}
                      {showTagColumn("decimals") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Decimals</th>
                      ) : null}
                      {showTagColumn("quality") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }} title="Live quality from OPC status (Good/Bad/Muted/Unknown).">Quality</th>
                      ) : null}
                      {showTagColumn("liveValue") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }}>Live Value</th>
                      ) : null}
                      {showTagColumn("actions") ? (
                        <th style={{ textAlign: "left", padding: "6px 8px" }} />
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {groupedTags.map((group) => {
                      const topicKey = group.topic ?? "";
                      const topicExpanded = expandedPrefixes[`topic:${topicKey}`] ?? true;
                      const topicMeta = topicMap.get(topicKey);
                      return (
                        <Fragment key={`topic-${topicKey}`}>
                          <tr style={{ borderTop: "1px solid #eef2f6", background: "var(--bg-soft)" }}>
                            <td colSpan={visibleTagColumnCount} style={{ padding: "6px 8px" }}>
                              <button
                                onClick={() =>
                                  setExpandedPrefixes((prev) => ({
                                    ...prev,
                                    [`topic:${topicKey}`]: !topicExpanded,
                                  }))
                                }
                                style={{
                                  ...drawerButtonStyle,
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-elev)",
                                  borderRadius: 6,
                                  padding: "4px 8px",
                                  marginRight: 8,
                                }}
                              >
                                {topicExpanded ? "-" : "+"}
                              </button>
                              <span style={{ fontWeight: 600 }}>{topicKey}</span>
                              {topicMeta?.plcName ? (
                                <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                                  PLC {topicMeta.plcName}
                                </span>
                              ) : null}
                              <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                                {group.groups.reduce((sum, t) => sum + t.items.length, 0)} tags
                              </span>
                              <button
                                onClick={() => addTagToGroup(topicKey, "Custom")}
                                title="Add Tag"
                                aria-label="Add Tag"
                                style={{
                                  ...drawerButtonStyle,
                                  border: "1px solid #2b6cff",
                                  background: "var(--bg-elev)",
                                  color: "#2b6cff",
                                  borderRadius: 6,
                                  width: 28,
                                  height: 28,
                                  padding: 0,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  lineHeight: 1,
                                  marginLeft: 10,
                                  fontWeight: 800,
                                }}
                              >
                                +
                              </button>
                            </td>
                          </tr>
                          {topicExpanded
                            ? (() => {
                                const sortedGroups = [...(group.groups || [])].sort((a, b) =>
                                  String(a?.groupName || "").localeCompare(String(b?.groupName || ""))
                                );
                                const knownGroupNames = new Set(
                                  sortedGroups
                                    .map((g) => String(g?.groupName || "").trim())
                                    .filter(Boolean)
                                );
                                const isGroupVisible = (groupNameRaw) => {
                                  let parent = getParentGroupName(groupNameRaw);
                                  while (parent) {
                                    if (knownGroupNames.has(parent)) {
                                      const parentExpanded =
                                        expandedPrefixes[`topic:${topicKey}::group:${parent}`] ?? true;
                                      if (!parentExpanded) return false;
                                    }
                                    parent = getParentGroupName(parent);
                                  }
                                  return true;
                                };
                                return sortedGroups
                                  .filter((g) => isGroupVisible(g?.groupName))
                                  .map((tagGroup) => {
                                const groupName = tagGroup.groupName ?? "Ungrouped";
                                const groupExpanded =
                                  expandedPrefixes[`topic:${topicKey}::group:${groupName}`] ?? true;
                                const groupDepth =
                                  groupName === "Ungrouped"
                                    ? 0
                                    : Math.max(
                                        0,
                                        String(groupName)
                                          .split(".")
                                          .map((x) => x.trim())
                                          .filter(Boolean).length - 1
                                      );
                                const hasChildren = sortedGroups.some((candidate) => {
                                  const candidateName = String(candidate?.groupName || "").trim();
                                  if (!candidateName || candidateName === groupName) return false;
                                  return candidateName.startsWith(`${groupName}.`);
                                });
                                const groupLabel =
                                  groupDepth > 0
                                    ? String(groupName).split(".").filter(Boolean).slice(-1)[0]
                                    : groupName;
                                const groupTemplateNames = Array.from(
                                  new Set(
                                    (tagGroup.items || [])
                                      .map(({ tag }) => String(tag?.plcType || "").trim())
                                      .filter(Boolean),
                                  ),
                                );
                                return (
                                  <Fragment key={`group-${topicKey}-${groupName}`}>
                                    <tr
                                      style={{ borderTop: "1px solid var(--border)", background: "var(--bg-soft)" }}
                                      onMouseDown={() => {
                                        setActiveTagGroup({ topic: topicKey, groupName });
                                      }}
                                    >
                                      <td colSpan={visibleTagColumnCount} style={{ padding: "6px 28px" }}>
                                        <div style={{ display: "flex", alignItems: "center", paddingLeft: groupDepth * 14 }}>
                                        {hasChildren ? (
                                          <button
                                            onClick={() =>
                                              setExpandedPrefixes((prev) => ({
                                                ...prev,
                                                [`topic:${topicKey}::group:${groupName}`]: !groupExpanded,
                                              }))
                                            }
                                            onMouseDown={() => setActiveTagGroup({ topic: topicKey, groupName })}
                                            style={{
                                              ...drawerButtonStyle,
                                              border: "1px solid var(--border)",
                                              background: "var(--bg-elev)",
                                              borderRadius: 6,
                                              padding: "4px 8px",
                                              marginRight: 8,
                                            }}
                                          >
                                            {groupExpanded ? "-" : "+"}
                                          </button>
                                        ) : (
                                          <span style={{ display: "inline-block", width: 30, marginRight: 8 }} />
                                        )}
                                        <span style={{ fontWeight: 600 }}>{groupLabel}</span>
                                        {groupTemplateNames.length ? (
                                          <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>
                                            {groupTemplateNames.join(", ")}
                                          </span>
                                        ) : null}
                                        <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                                          {tagGroup.items.length} tags
                                        </span>
                                        <button
                                          onClick={() => {
                                            setActiveTagGroup({ topic: topicKey, groupName });
                                            addTagToGroup(topicKey, groupName);
                                          }}
                                          title="Add Tag"
                                          aria-label="Add Tag"
                                          style={{
                                            ...drawerButtonStyle,
                                            border: "1px solid #2b6cff",
                                            background: "var(--bg-elev)",
                                            color: "#2b6cff",
                                            borderRadius: 6,
                                            width: 28,
                                            height: 28,
                                            padding: 0,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            lineHeight: 1,
                                            marginLeft: 10,
                                            fontWeight: 800,
                                          }}
                                        >
                                          +
                                        </button>
                                        <button
                                          onClick={() => removeTagGroup(topicKey, groupName)}
                                          title={`Delete group ${groupName}`}
                                          aria-label={`Delete group ${groupName}`}
                                          style={{
                                            ...drawerButtonStyle,
                                            border: "1px solid #f04438",
                                            background: "#f04438",
                                            color: "white",
                                            borderRadius: 6,
                                            width: 28,
                                            height: 28,
                                            padding: 0,
                                            marginLeft: 8,
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            lineHeight: 1,
                                          }}
                                        >
                                          <TrashCanIcon />
                                        </button>
                                        </div>
                                      </td>
                                    </tr>
                                    {groupExpanded
                                      ? (() => {
                                          const buildHierarchyRows = (items) => {
                                            const list = Array.isArray(items) ? items : [];
                                            const byKey = new Map();
                                            const linkChild = (parent, child) => {
                                              if (!parent || !child) return;
                                              if (!Array.isArray(parent.children)) parent.children = [];
                                              if (!parent.children.some((x) => x?.key === child?.key)) {
                                                parent.children.push(child);
                                              }
                                            };
                                            const ensureNode = (path) => {
                                              const normalizedPath = normalizeTagName(path || "");
                                              if (!normalizedPath) return null;
                                              const key = normalizedPath.toLowerCase();
                                              if (byKey.has(key)) return byKey.get(key);
                                              const node = {
                                                tag: null,
                                                idx: null,
                                                path: normalizedPath,
                                                key,
                                                synthetic: true,
                                                children: [],
                                              };
                                              byKey.set(key, node);
                                              const dot = normalizedPath.lastIndexOf(".");
                                              if (dot > 0) {
                                                const parentPath = normalizedPath.slice(0, dot);
                                                const parent = ensureNode(parentPath);
                                                linkChild(parent, node);
                                              }
                                              return node;
                                            };
                                            list.forEach((entry) => {
                                              // Build hierarchy from display tag name first so the parent row is the UDT instance.
                                              const path = normalizeTagName(entry?.tag?.name || entry?.tag?.tagPath || "");
                                              if (!path) return;
                                              const node = ensureNode(path);
                                              if (!node) return;
                                              node.tag = entry?.tag || null;
                                              node.idx = Number.isInteger(entry?.idx) ? entry.idx : null;
                                              node.synthetic = false;
                                            });
                                            const roots = Array.from(byKey.values()).filter((node) => {
                                              const p = String(node?.path || "");
                                              if (!p) return false;
                                              const dot = p.lastIndexOf(".");
                                              if (dot <= 0) return true;
                                              const parentKey = p.slice(0, dot).toLowerCase();
                                              return !byKey.has(parentKey);
                                            });
                                            const sortNodes = (arr) =>
                                              [...arr].sort((a, b) =>
                                                String(a.path || a.tag?.name || "").localeCompare(
                                                  String(b.path || b.tag?.name || "")
                                                )
                                              );
                                            const walk = (arr, depth, out) => {
                                              sortNodes(arr).forEach((node) => {
                                                const hasChildren = node.children.length > 0;
                                                const expandedKey = `topic:${topicKey}::group:${groupName}::tag:${node.path || node.idx}`;
                                                const expanded = expandedPrefixes[expandedKey] ?? true;
                                                out.push({
                                                  ...node,
                                                  depth,
                                                  hasChildren,
                                                  expanded,
                                                  expandedKey,
                                                });
                                                if (hasChildren && expanded) {
                                                  walk(node.children, depth + 1, out);
                                                }
                                              });
                                            };
                                            const out = [];
                                            walk(roots, 0, out);
                                            return out;
                                          };
                                          const hierarchyRows = buildHierarchyRows(tagGroup.items);
                                          return hierarchyRows.map(({ tag: t, idx, path, synthetic, depth, hasChildren, expanded, expandedKey }) => {
                                          const tagObj = t || {};
                                          const isSynthetic = synthetic === true || !t || !Number.isInteger(idx);
                                          const rowEditing = !isSynthetic && tagTableEditing && editingTagIndex === idx;
                                        return (
                                          <Fragment key={`tag-row-${isSynthetic ? path : idx}`}>
                                          <tr style={{ borderTop: "1px solid var(--border)", background: isSynthetic ? "var(--bg-soft)" : "transparent" }}>
                                            {showTagColumn("enabled") ? (
                                              <td style={{ padding: "8px 16px 8px 10px" }}>
                                                {isSynthetic ? null : (
                                                  <input
                                                    type="checkbox"
                                                    checked={tagObj.enabled !== false}
                                                    onChange={(e) => {
                                                      if (!rowEditing) return;
                                                      updateTag(idx, "enabled", e.target.checked);
                                                    }}
                                                    onClick={(e) => {
                                                      if (rowEditing) return;
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                    }}
                                                    aria-disabled={!rowEditing}
                                                    style={{ accentColor: "#22c55e", opacity: 1, cursor: rowEditing ? "pointer" : "not-allowed" }}
                                                  />
                                                )}
                                              </td>
                                            ) : null}
                                            {showTagColumn("muted") ? (
                                              <td style={{ padding: "8px 16px 8px 10px" }}>
                                                {isSynthetic ? null : (
                                                  <input
                                                    type="checkbox"
                                                    checked={tagObj.muted === true}
                                                    onChange={(e) => {
                                                      if (!rowEditing) return;
                                                      updateTag(idx, "muted", e.target.checked);
                                                    }}
                                                    onClick={(e) => {
                                                      if (rowEditing) return;
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                    }}
                                                    aria-disabled={!rowEditing}
                                                    style={{ accentColor: "#22c55e", opacity: 1, cursor: rowEditing ? "pointer" : "not-allowed" }}
                                                  />
                                                )}
                                              </td>
                                            ) : null}
                                            {showTagColumn("trend") ? (
                                              <td style={{ padding: "8px 16px 8px 10px" }}>
                                                {isSynthetic ? null : (
                                                  <input
                                                    type="checkbox"
                                                    checked={tagObj.trendEnabled === true}
                                                    onChange={(e) => {
                                                      if (!rowEditing) return;
                                                      updateTag(idx, "trendEnabled", e.target.checked);
                                                    }}
                                                    onClick={(e) => {
                                                      if (rowEditing) return;
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                    }}
                                                    aria-disabled={!rowEditing}
                                                    style={{ accentColor: "#22c55e", opacity: 1, cursor: rowEditing ? "pointer" : "not-allowed" }}
                                                  />
                                                )}
                                              </td>
                                            ) : null}
                                            {showTagColumn("name") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: Math.max(0, depth) * 14 }}>
                                                  {hasChildren ? (
                                                    <button
                                                      onClick={() =>
                                                        setExpandedPrefixes((prev) => ({
                                                          ...prev,
                                                          [expandedKey]: !expanded,
                                                        }))
                                                      }
                                                      style={{
                                                        ...drawerButtonStyle,
                                                        border: "1px solid var(--border)",
                                                        background: "var(--bg-elev)",
                                                        borderRadius: 6,
                                                        width: 20,
                                                        height: 20,
                                                        padding: 0,
                                                        fontSize: 11,
                                                        lineHeight: 1,
                                                      }}
                                                    >
                                                      {expanded ? "-" : "+"}
                                                    </button>
                                                  ) : (
                                                    <span style={{ display: "inline-block", width: 20 }} />
                                                  )}
                                                  <span>
                                                    {(() => {
                                                      const raw = String(path || tagObj?.tagPath || tagObj?.name || "").trim();
                                                      if (!raw) return "";
                                                      const parts = raw.split(".").filter(Boolean);
                                                      return parts.length ? parts[parts.length - 1] : raw;
                                                    })()}
                                                  </span>
                                                </div>
                                              </td>
                                            ) : null}
                                            {showTagColumn("topic") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text-muted)" }}>
                                                {tagObj.topic || ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("tagPath") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {tagObj.tagPath || ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("uaType") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {tagObj.uaType || ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("pollMs") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {Number.isFinite(Number(tagObj.pollMs)) ? Number(tagObj.pollMs) : ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("samplingInterval") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {Number.isFinite(Number(tagObj.samplingInterval)) ? Number(tagObj.samplingInterval) : ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("mappingSet") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {tagObj.mappingSet || ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("scale") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {Number.isFinite(Number(tagObj.scale)) ? Number(tagObj.scale) : 1}
                                              </td>
                                            ) : null}
                                            {showTagColumn("decimals") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {Number.isFinite(Number(tagObj.decimals)) ? Number(tagObj.decimals) : 0}
                                              </td>
                                            ) : null}
                                            {showTagColumn("quality") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {String(getLiveValueForTag(liveQualities, tagObj) || (tagObj.muted ? "Muted" : "Unknown"))}
                                              </td>
                                            ) : null}
                                            {showTagColumn("liveValue")
                                              ? (() => {
                                                  if (isSynthetic) {
                                                    return <td style={{ padding: "6px 8px" }} />;
                                                  }
                                                  const scale = Number.isFinite(Number(tagObj.scale)) ? Number(tagObj.scale) : 1;
                                                  const decimals = Number.isFinite(Number(tagObj.decimals)) ? Number(tagObj.decimals) : 0;
                                                  const rawValue = getLiveValueForTag(liveValues, tagObj);
                                                  const scaledValue =
                                                    rawValue != null && rawValue !== "" && !Number.isNaN(Number(rawValue))
                                                      ? Number(rawValue) * scale
                                                      : rawValue;
                                                  const errorCount = Number(getLiveValueForTag(liveErrors, tagObj) || 0);
                                                  const pathKey = getTagPathKey(tagObj);
                                                  const legacyKey = getTagLegacyKey(tagObj);
                                                  const writeKey = pathKey || legacyKey || `tag-${idx}`;
                                                  const writeDefaultValue =
                                                    rawValue != null && rawValue !== "" && !Number.isNaN(Number(rawValue))
                                                      ? String(Number(rawValue) * (Number.isFinite(Number(tagObj.scale)) ? Number(tagObj.scale) : 1))
                                                      : (rawValue == null ? "" : String(rawValue));
                                                  const writeDraft = Object.prototype.hasOwnProperty.call(tagWriteByKey, writeKey)
                                                    ? tagWriteByKey[writeKey]
                                                    : writeDefaultValue;
                                                  const writeBusy = tagWriteBusyByKey?.[writeKey] === true;
                                                  return (
                                                    <td
                                                      style={{
                                                        padding: "6px 8px",
                                                        color: "var(--text)",
                                                        fontSize: 12,
                                                        background: "transparent",
                                                        borderRadius: 4,
                                                      }}
                                                    >
                                                      <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                                                        <div style={{ width: 84, minWidth: 84, textAlign: "right", lineHeight: 1.2 }}>
                                                          <div
                                                            style={{
                                                              color: tagObj.enabled === false ? "#b42318" : "var(--text)",
                                                              fontWeight: 600,
                                                            }}
                                                          >
                                                            {tagObj.enabled === false
                                                              ? "Disabled"
                                                              : formatLiveNumber(scaledValue, decimals)}
                                                          </div>
                                                          <div style={{ minHeight: 14, color: "#b42318", fontSize: 11 }}>
                                                            {errorCount > 0 ? `(err ${errorCount})` : ""}
                                                          </div>
                                                        </div>
                                                        <input
                                                          value={writeDraft}
                                                          onChange={(e) =>
                                                            setTagWriteByKey((prev) => ({
                                                              ...prev,
                                                              [writeKey]: e.target.value,
                                                            }))
                                                          }
                                                          onKeyDown={(e) => {
                                                            if (e.key !== "Enter") return;
                                                            e.preventDefault();
                                                            writeTagLiveValue(tagObj, writeKey);
                                                          }}
                                                          placeholder="Write value"
                                                          style={{
                                                            width: 132,
                                                            border: "1px solid var(--border)",
                                                            borderRadius: 6,
                                                            padding: "4px 6px",
                                                            fontSize: 11,
                                                            background: "var(--bg-elev)",
                                                            color: "var(--text)",
                                                          }}
                                                        />
                                                        <button
                                                          onClick={() => writeTagLiveValue(tagObj, writeKey)}
                                                          disabled={writeBusy}
                                                          style={{
                                                            ...drawerButtonStyle,
                                                            border: "1px solid #2b6cff",
                                                            background: writeBusy ? "var(--bg-soft)" : "#2b6cff",
                                                            color: writeBusy ? "var(--text-muted)" : "white",
                                                            borderRadius: 6,
                                                            padding: "4px 8px",
                                                            fontSize: 11,
                                                            cursor: writeBusy ? "not-allowed" : "pointer",
                                                          }}
                                                        >
                                                          {writeBusy ? "..." : "Write"}
                                                        </button>
                                                      </div>
                                                    </td>
                                                  );
                                                })()
                                              : null}
                                            {showTagColumn("actions") ? (
                                              <td style={{ padding: "8px 10px" }}>
                                                {isSynthetic ? null : (
                                                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                                                  <button
                                                    onClick={() => {
                                                      setTagTableEditing(true);
                                                      setEditingTagIndex(idx);
                                                    }}
                                                    style={{
                                                      ...drawerButtonStyle,
                                                      width: 28,
                                                      height: 28,
                                                      border: "1px solid #2b6cff",
                                                      background: rowEditing ? "#2b6cff" : "var(--bg-elev)",
                                                      color: rowEditing ? "white" : "#2b6cff",
                                                      borderRadius: 8,
                                                    }}
                                                  >
                                                    ✎
                                                  </button>
                                                  <button
                                                    onClick={() => requestRemoveTag(idx, t)}
                                                    title="Delete tag"
                                                    aria-label="Delete tag"
                                                    style={{
                                                      ...dangerIconButtonStyle,
                                                      fontWeight: 700,
                                                      fontSize: 11,
                                                    }}
                                                  >
                                                    <TrashCanIcon />
                                                  </button>
                                                </div>
                                                )}
                                              </td>
                                            ) : null}
                                          </tr>
                                          {rowEditing ? (
                                            <tr ref={(el) => tagEditRowRefs.current.set(idx, el)}>
                                              <td colSpan={visibleTagColumnCount} style={{ padding: "8px 12px 12px 12px" }}>
                                                <div
                                                  style={{
                                                    border: "1px solid var(--border)",
                                                    borderRadius: 10,
                                                    padding: 12,
                                                    background: "var(--bg-soft)",
                                                  }}
                                                >
                                                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Name
                                                      <input
                                                        value={(() => {
                                                          const group = String(t.groupName || "").trim();
                                                          const name = String(t.name || "").trim();
                                                          if (group && name.startsWith(`${group}.`)) {
                                                            return name.slice(group.length + 1);
                                                          }
                                                          return name;
                                                        })()}
                                                        onChange={(e) => {
                                                          const group = String(t.groupName || "").trim();
                                                          const nextName = String(e.target.value || "").trim();
                                                          const fullName = group ? `${group}.${nextName}` : nextName;
                                                          updateTag(idx, "name", fullName);
                                                        }}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
                                                      />
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Topic
                                                      <select
                                                        value={t.topic || ""}
                                                        onChange={(e) => updateTag(idx, "topic", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
                                                      >
                                                        <option value="">Select topic</option>
                                                        {(topics || []).map((topic) => (
                                                          <option key={`row-topic-${topic.name}`} value={topic.name}>
                                                            {topic.name}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Tag Path
                                                      <input
                                                        value={t.tagPath || ""}
                                                        onChange={(e) => updateTag(idx, "tagPath", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
                                                      />
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      UA Type
                                                      <select
                                                        value={t.uaType || ""}
                                                        onChange={(e) => updateTag(idx, "uaType", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
                                                      >
                                                        <option value="">Select UA type</option>
                                                        <option value="Boolean">Boolean</option>
                                                        <option value="Int16">Int16</option>
                                                        <option value="Int32">Int32</option>
                                                        <option value="Int64">Int64</option>
                                                        <option value="UInt16">UInt16</option>
                                                        <option value="UInt32">UInt32</option>
                                                        <option value="UInt64">UInt64</option>
                                                        <option value="Float">Float</option>
                                                        <option value="Double">Double</option>
                                                        <option value="String">String</option>
                                                      </select>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Poll (ms)
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        value={t.pollMs ?? ""}
                                                        onChange={(e) => updateTag(idx, "pollMs", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
                                                      />
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Sampling (ms)
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        value={t.samplingInterval ?? ""}
                                                        onChange={(e) => updateTag(idx, "samplingInterval", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
                                                      />
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Mapping Set
                                                      <select
                                                        value={t.mappingSet || ""}
                                                        onChange={(e) => updateTag(idx, "mappingSet", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12 }}
                                                      >
                                                        <option value="">None</option>
                                                        {mappingSets.map((s) => (
                                                          <option key={`tag-map-${s.name}`} value={s.name}>
                                                            {s.name}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Scale
                                                      <input
                                                        type="number"
                                                        step="any"
                                                        value={t.scale ?? 1}
                                                        onChange={(e) => updateTag(idx, "scale", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, maxWidth: 120 }}
                                                      />
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Decimals
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        value={t.decimals ?? 4}
                                                        onChange={(e) => updateTag(idx, "decimals", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, maxWidth: 120 }}
                                                      />
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Minimum numeric change required before this tag publishes a new value.">
                                                      Deadband
                                                      <input
                                                        type="number"
                                                        min="0"
                                                        step="any"
                                                        value={t.deadband ?? ""}
                                                        onChange={(e) => updateTag(idx, "deadband", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, maxWidth: 120 }}
                                                      />
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Enabled
                                                      <div>
                                                        <input
                                                          type="checkbox"
                                                          checked={t.enabled !== false}
                                                          onChange={(e) => updateTag(idx, "enabled", e.target.checked)}
                                                        />
                                                      </div>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Mute this tag to stop polling without removing it.">
                                                      Muted
                                                      <div>
                                                        <input
                                                          type="checkbox"
                                                          checked={t.muted === true}
                                                          onChange={(e) => updateTag(idx, "muted", e.target.checked)}
                                                        />
                                                      </div>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Store compressed trend history for this tag.">
                                                      Trend
                                                      <div>
                                                        <input
                                                          type="checkbox"
                                                          checked={t.trendEnabled === true}
                                                          onChange={(e) => updateTag(idx, "trendEnabled", e.target.checked)}
                                                        />
                                                      </div>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Record trend samples on value changes or fixed time interval.">
                                                      Trend Mode
                                                      <select
                                                        value={normalizeTrendMode(t.trendMode)}
                                                        onChange={(e) => updateTag(idx, "trendMode", normalizeTrendMode(e.target.value))}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, minWidth: 140 }}
                                                        disabled={t.trendEnabled !== true}
                                                      >
                                                        <option value="value">Value Change</option>
                                                        <option value="time">Time Interval</option>
                                                      </select>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Only used when Trend Mode is Time Interval.">
                                                      Trend Every (ms)
                                                      <input
                                                        type="number"
                                                        min="1000"
                                                        step="1000"
                                                        value={t.trendSampleMs ?? ""}
                                                        onChange={(e) => updateTag(idx, "trendSampleMs", e.target.value)}
                                                        placeholder="Default 30000"
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, maxWidth: 140 }}
                                                        disabled={t.trendEnabled !== true || normalizeTrendMode(t.trendMode) !== "time"}
                                                      />
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Enable alarm criteria for this tag.">
                                                      Alarm
                                                      <div>
                                                        <input
                                                          type="checkbox"
                                                          checked={t.alarmEnabled === true}
                                                          onChange={(e) => updateTag(idx, "alarmEnabled", e.target.checked)}
                                                        />
                                                      </div>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Alarm Operator
                                                      <select
                                                        value={normalizeAlarmOperator(t.alarmOperator)}
                                                        onChange={(e) => updateTag(idx, "alarmOperator", e.target.value)}
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, minWidth: 90 }}
                                                        disabled={t.alarmEnabled !== true}
                                                      >
                                                        {ALARM_OPERATORS.map((op) => (
                                                          <option key={`alarm-op-${op}`} value={op}>
                                                            {op}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </label>
                                                    <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                                                      Alarm Value
                                                      <input
                                                        value={t.alarmValue ?? ""}
                                                        onChange={(e) => updateTag(idx, "alarmValue", e.target.value)}
                                                        placeholder="e.g. 1"
                                                        style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 12, maxWidth: 140 }}
                                                        disabled={t.alarmEnabled !== true}
                                                      />
                                                    </label>
                                                  </div>
                                                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                                                    <button
                                                      onClick={saveTagRow}
                                                      style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}
                                                    >
                                                      Save
                                                    </button>
                                                    <button
                                                      onClick={() => requestRemoveTag(idx, t)}
                                                      style={{ ...drawerButtonStyle, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8, padding: "6px 10px" }}
                                                    >
                                                      Delete
                                                    </button>
                                                    <button
                                                      onClick={() => {
                                                        setEditingTagIndex(null);
                                                        reloadConfig();
                                                      }}
                                                      style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                                                    >
                                                      Cancel
                                                    </button>
                                                  </div>
                                                </div>
                                              </td>
                                            </tr>
                                          ) : null}
                                          </Fragment>
                                          );
                                        });
                                        })()
                                      : null}
                                  </Fragment>
                                );
                              });
                              })()
                            : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : activeTagTab === "logs" ? (
          <div style={{ marginTop: 10 }}>
            {renderErrorLogsCard()}
          </div>
        ) : activeTagTab === "diagnostics" ? (
          <div style={{ marginTop: 10 }}>
            {renderTagDiagnosticsCard()}
          </div>
        ) : activeTagTab === "templates" ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <div style={sectionCardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Create / Edit UDT</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 12, alignItems: "end" }}>
                <label style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  Build From Tag Group
                  <select
                    value={templateSourceGroupKey}
                    onChange={(e) => setTemplateSourceGroupKey(e.target.value)}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                  >
                    {templateSourceGroups.length === 0 ? (
                      <option value="">No groups available</option>
                    ) : (
                      templateSourceGroups.map((g) => (
                        <option key={`tmpl-group-${g.key}`} value={g.key}>
                          {g.groupName} ({g.count})
                        </option>
                      ))
                    )}
                  </select>
                </label>
                <button
                  onClick={createTemplateFromTagGroup}
                  style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}
                  disabled={!templateSourceGroupKey || templateSourceGroups.length === 0}
                >
                  Load Group
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
                Loads fields from selected tag group into UDT editor. Save UDT to persist.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, marginBottom: 12, alignItems: "end" }}>
                <label style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  Edit Existing
                  <select
                    value={editTemplate}
                    onChange={(e) => {
                      const next = e.target.value;
                      setEditTemplate(next);
                      if (!next) {
                        setTemplateOriginalName("");
                        setTemplateName("");
                        setTemplateParent("");
                    setTemplateFieldRows([{
                      name: "",
                      tagPath: "",
                      uaType: "",
                      pollMs: "",
                      samplingInterval: "",
                      topic: "",
                      enabled: true,
                      mappingSet: "",
                      scale: 1,
                      decimals: 0,
                      alarmEnabled: false,
                      alarmOperator: "==",
                      alarmValue: "",
                    }]);
                    setTemplateStateMappings([{ field: "State Text", state: "", color: "#000000" }]);
                    setTemplateEditing(true);
                  }
                }}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                  >
                    <option value="">New UDT</option>
                    {templates.map((t) => (
                      <option key={`edit-${t.name}`} value={t.name}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => {
                      setEditTemplate("");
                      setTemplateOriginalName("");
                      setTemplateName("");
                      setTemplateParent("");
                      setTemplateFieldRows([{
                        name: "",
                        tagPath: "",
                        uaType: "",
                        pollMs: "",
                        samplingInterval: "",
                        topic: "",
                        enabled: true,
                        mappingSet: "",
                        scale: 1,
                        decimals: 0,
                        alarmEnabled: false,
                        alarmOperator: "==",
                        alarmValue: "",
                      }]);
                      setTemplateStateMappings([{ field: "State Text", state: "", color: "#000000" }]);
                      setTemplateEditing(true);
                    }}
                    style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                  >
                    New
                  </button>
                  <button
                    onClick={async () => {
                      const target = templateOriginalName || editTemplate || templateName;
                      if (!target) return;
                      await deleteTemplate(target);
                      setEditTemplate("");
                      setTemplateOriginalName("");
                      setTemplateName("");
                      setTemplateParent("");
                      setTemplateFieldRows([{
                        name: "",
                        tagPath: "",
                        uaType: "",
                        pollMs: "",
                        samplingInterval: "",
                        topic: "",
                        enabled: true,
                        mappingSet: "",
                        scale: 1,
                        decimals: 0,
                        alarmEnabled: false,
                        alarmOperator: "==",
                        alarmValue: "",
                      }]);
                      setTemplateStateMappings([{ field: "State Text", state: "", color: "#000000" }]);
                      setTemplateEditing(true);
                    }}
                    style={{ ...drawerButtonStyle, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8, padding: "6px 10px" }}
                    disabled={!editTemplate && !templateOriginalName}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
                <label style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  UDT Name
                  <input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                    disabled={!templateEditing}
                  />
                </label>
                <label style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  Parent UDT
                  <select
                    value={templateParent}
                    onChange={(e) => setTemplateParent(e.target.value)}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                    disabled={!templateEditing}
                  >
                    <option value="">None</option>
                    {templates
                      .filter((t) => t.name !== templateName)
                      .map((t) => (
                        <option key={`parent-${t.name}`} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  background: "var(--bg-elev)",
                  minHeight: 260,
                  maxHeight: "62vh",
                  overflow: "auto",
                  padding: 8,
                  contain: "layout style paint",
                  contentVisibility: "auto",
                  containIntrinsicSize: "900px",
                }}
              >
                {templateFieldTreeContent}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  onClick={() =>
                    setTemplateFieldRows((prev) => [
                      ...prev,
                      {
                        name: "",
                        tagPath: "",
                        uaType: "",
                        pollMs: "",
                        samplingInterval: "",
                        topic: "",
                        enabled: true,
                        mappingSet: "",
                        scale: 1,
                        decimals: 0,
                        alarmEnabled: false,
                        alarmOperator: "==",
                        alarmValue: "",
                      },
                    ])
                  }
                  title="Add Tag"
                  aria-label="Add Tag"
                  style={{
                    ...drawerButtonStyle,
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    borderRadius: 8,
                    width: 32,
                    height: 32,
                    padding: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  +
                </button>
                <button
                  onClick={saveTemplate}
                  style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}
                  disabled={!templateEditing}
                >
                  Save UDT
                </button>
                <button
                  onClick={async () => {
                    const target = templateOriginalName || templateName;
                    if (!target) return;
                    await deleteTemplate(target);
                    setEditTemplate("");
                    setTemplateOriginalName("");
                    setTemplateName("");
                    setTemplateParent("");
                    setTemplateFieldRows([{
                      name: "",
                      tagPath: "",
                      uaType: "",
                      pollMs: "",
                      samplingInterval: "",
                      topic: "",
                      enabled: true,
                      mappingSet: "",
                      scale: 1,
                      decimals: 0,
                      alarmEnabled: false,
                      alarmOperator: "==",
                      alarmValue: "",
                    }]);
                    setTemplateStateMappings([{ field: "State Text", state: "", color: "#000000" }]);
                    setTemplateEditing(true);
                  }}
                  style={{ ...drawerButtonStyle, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8, padding: "6px 10px" }}
                  disabled={!templateOriginalName && !templateName}
                >
                  Delete
                </button>
                <button
                  onClick={() => setTemplateEditing((v) => !v)}
                  style={{
                    ...drawerButtonStyle,
                    border: "1px solid #2b6cff",
                    background: templateEditing ? "#2b6cff" : "white",
                    color: templateEditing ? "white" : "#2b6cff",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                >
                  {templateEditing ? "Editing" : "Edit"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <div style={sectionCardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Mapping Sets</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, marginBottom: 12, alignItems: "end" }}>
                <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                  Select Set
                  <select
                    value={mappingSetOriginalName || ""}
                    onChange={(e) => {
                      const next = e.target.value;
                      setMappingSetOriginalName(next);
                      setMappingSetName(next);
                      if (!next) {
                        setMappingSetRows([{ field: "State Text", state: "", color: "#000000" }]);
                      }
                    }}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                  >
                    <option value="">New set</option>
                    {mappingSets.map((s) => (
                      <option key={`map-set-${s.name}`} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => {
                      setMappingSetName("");
                      setMappingSetOriginalName("");
                      setMappingSetRows([{ field: "State Text", state: "", color: "#000000" }]);
                    }}
                    style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                  >
                    New Set
                  </button>
                  <button
                    onClick={() => {
                      setMappingSetName("HMI_State");
                      setMappingSetOriginalName("");
                      setMappingSetRows([
                        { field: "HMI_State", state: "1", color: "#6b7280" }, // Stopped
                        { field: "HMI_State", state: "2", color: "#f59e0b" }, // Starting
                        { field: "HMI_State", state: "4", color: "#16a34a" }, // Started
                        { field: "HMI_State", state: "6", color: "#f97316" }, // Stopping
                      ]);
                      setStatus("HMI_State mapping preset loaded. Click 'Save Mapping Set' to persist.");
                      setError("");
                    }}
                    style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                    title="Load default HMI_State mappings"
                  >
                    HMI_State Preset
                  </button>
                  <button
                    onClick={async () => {
                      if (!mappingSetName) return;
                      setError("");
                      setStatus("");
                      try {
                        const res = await fetch(`/api/opc/mapping-sets/${encodeURIComponent(mappingSetName)}`, {
                          method: "DELETE",
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data?.error || "Delete failed.");
                        const reload = await fetch("/api/opc/mapping-sets");
                        const payload = await reload.json();
                        if (reload.ok) setMappingSets(payload.sets || []);
                        setMappingSetName("");
                        setMappingSetOriginalName("");
                        setMappingSetRows([{ field: "State Text", state: "", color: "#000000" }]);
                        setStatus("Mapping set deleted.");
                      } catch (err) {
                        setError(err?.message || "Delete failed.");
                      }
                    }}
                    style={{ ...drawerButtonStyle, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8, padding: "6px 10px" }}
                    disabled={!mappingSetName}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 12 }}>
                Set Name
                <input
                  value={mappingSetName}
                  onChange={(e) => setMappingSetName(e.target.value)}
                  placeholder="e.g. Motor States"
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                />
              </label>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", padding: "4px 12px 4px 0", boxSizing: "border-box" }}>
                <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "separate", borderSpacing: "0 6px", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "27%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "41%" }} />
                    <col style={{ width: "14%" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: "var(--bg-soft)" }}>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Field</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>PLC Value</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Color</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {mappingSetRows.map((row, idx) => (
                      <tr key={`map-set-row-${idx}`}>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            value={row.field ?? ""}
                            onChange={(e) =>
                              setMappingSetRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], field: e.target.value };
                                return next;
                              })
                            }
                            placeholder="e.g. State Text"
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                          />
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            value={row.state ?? ""}
                            onChange={(e) =>
                              setMappingSetRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], state: e.target.value };
                                return next;
                              })
                            }
                            placeholder="1"
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                          />
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", marginLeft: 8 }}>
                            <input
                              type="color"
                              value={row.color || "#000000"}
                              onChange={(e) =>
                                setMappingSetRows((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], color: e.target.value };
                                  return next;
                                })
                              }
                              style={{ width: 36, height: 28, padding: 0, border: "none", background: "transparent" }}
                            />
                            <input
                              value={row.color ?? ""}
                              onChange={(e) =>
                                setMappingSetRows((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], color: e.target.value };
                                  return next;
                                })
                              }
                              placeholder="#12b76a"
                              style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            />
                          </div>
                        </td>
                        <td style={{ padding: "8px 10px 8px 14px" }}>
                          <button
                            onClick={() =>
                              setMappingSetRows((prev) => prev.filter((_, i) => i !== idx))
                            }
                            style={{ ...drawerButtonStyle, width: 28, height: 28, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8 }}
                          >
                            <TrashCanIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {mappingSetRows.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ padding: "8px", color: "var(--text-muted)" }}>
                          No mappings yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  onClick={() =>
                    setMappingSetRows((prev) => [
                      ...prev,
                      { field: "State Text", state: "", color: "#000000" },
                    ])
                  }
                  style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                >
                  Add Mapping
                </button>
                <button
                  onClick={async () => {
                    setError("");
                    setStatus("");
                    const name = String(mappingSetName || "").trim();
                    if (!name) {
                      setError("Mapping set name is required.");
                      return;
                    }
                    const cleaned = (mappingSetRows || [])
                      .map((row) => normalizeStateMappingRow(row))
                      .filter((row) => row.state);
                    try {
                      const res = await fetch("/api/opc/mapping-sets", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, mappings: cleaned }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data?.error || "Save failed.");
                      setMappingSets((prev) => {
                        const next = Array.isArray(prev) ? [...prev] : [];
                        const idx = next.findIndex((s) => s.name === name);
                        const entry = { name, mappings: cleaned };
                        if (idx >= 0) next[idx] = entry;
                        else next.push(entry);
                        return next.sort((a, b) => String(a.name).localeCompare(String(b.name)));
                      });
                      setMappingSetRows(
                        cleaned.length ? cleaned : [{ field: "State Text", state: "", color: "#000000" }]
                      );
                      if (mappingSetOriginalName && mappingSetOriginalName !== name) {
                        try {
                          await fetch(`/api/opc/mapping-sets/${encodeURIComponent(mappingSetOriginalName)}`, {
                            method: "DELETE",
                          });
                        } catch {
                          // ignore delete failure
                        }
                      }
                      const reload = await fetch("/api/opc/mapping-sets");
                      const payload = await reload.json();
                      if (reload.ok) setMappingSets(payload.sets || []);
                      setMappingSetName(name);
                      setMappingSetOriginalName(name);
                      setStatus("Mapping set saved.");
                    } catch (err) {
                      setError(err?.message || "Save failed.");
                    }
                  }}
                  style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}
                >
                  Save Mapping Set
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  async function reloadConfig() {
    try {
      const res = await fetch("/api/opc/config");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load.");
      const cleanedTags = (data.tags || [])
        .map((t) => {
          const name = normalizeTagName(t.name);
          const tagPath = normalizeTagName(t.tagPath || name);
          const topic = normalizeTagName(t.topic || "");
          const samplingInterval = parseOptionalMs(t?.samplingInterval);
          return {
            ...t,
            name,
            tagPath,
            topic,
            samplingInterval,
            deadband: parseOptionalNonNegative(t?.deadband),
            muted: t?.muted === true,
            trendEnabled: t?.trendEnabled === true,
            trendMode: normalizeTrendMode(t?.trendMode),
            trendSampleMs: parseOptionalMs(t?.trendSampleMs),
            mappingSet: t?.mappingSet || "",
          };
        })
        .filter((t) => t.name);
      const cleanedTopics = buildCleanedTopics(data.topics || []);
      const cleanedPlcs = buildCleanedPlcs(data.plcs || []);
      const loadedConfig = {
        ...data,
        runtime: normalizeRuntimeConfig(data?.runtime),
        tags: cleanedTags,
        topics: cleanedTopics,
        plcs: cleanedPlcs,
      };
      setConfig(loadedConfig);
      lastSavedRef.current = JSON.stringify(loadedConfig);
    } catch (err) {
      setError(err?.message || "Failed to reload config.");
    }
  }

  async function saveTagsInline() {
    setError("");
    setStatus("");
    try {
      const warnings = collectValidationWarnings(config);
      if (warnings.length) {
        setError(`Fix validation warnings before save (${warnings.length}).`);
        return;
      }
      const cleanedTags = buildCleanedTags(config.tags);
      const cleanedTopics = buildCleanedTopics(config.topics);
      const cleanedPlcs = buildCleanedPlcs(config.plcs);
      const nextConfig = {
        ...config,
        runtime: normalizeRuntimeConfig(config.runtime),
        tags: cleanedTags,
        topics: cleanedTopics,
        plcs: cleanedPlcs,
      };
      setConfig(nextConfig);
      await persistConfig(nextConfig, "Tags saved.");
      setTagTableEditing(false);
      setEditingTagIndex(null);
    } catch (err) {
      setError(err?.message || "Save failed.");
    }
  }

  async function saveTagRow() {
    setError("");
    setStatus("");
    try {
      const cleanedTags = buildCleanedTags(config.tags);
      const cleanedTopics = buildCleanedTopics(config.topics);
      const cleanedPlcs = buildCleanedPlcs(config.plcs);
      const nextConfig = { ...config, tags: cleanedTags, topics: cleanedTopics, plcs: cleanedPlcs };
      setConfig(nextConfig);
      await persistConfig(nextConfig, "Tags saved.");
      setEditingTagIndex(null);
    } catch (err) {
      setError(err?.message || "Save failed.");
    }
  }

  function addTagToGroup(topicKey, groupName) {
    const newIndex = (config.tags || []).length;
    setConfig((prev) => {
      const next = [...(prev.tags || [])];
      next.push({
        name: "",
        tagPath: "",
        uaType: "",
        pollMs: "",
        samplingInterval: "",
        topic: topicKey,
        enabled: true,
        muted: false,
        trendEnabled: false,
        trendMode: "value",
        trendSampleMs: "",
        alarmEnabled: false,
        alarmOperator: "==",
        alarmValue: "",
        mappingSet: "",
        groupName,
        deadband: "",
        scale: 1,
        decimals: 0,
      });
      return { ...prev, tags: next };
    });
    setExpandedPrefixes((prev) => ({
      ...prev,
      [`topic:${topicKey}`]: true,
      [`topic:${topicKey}::group:${groupName}`]: true,
    }));
    setTagTableEditing(true);
    setEditingTagIndex(newIndex);
    setTimeout(() => {
      const el = tagEditRowRefs.current.get(newIndex);
      if (el?.scrollIntoView) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 0);
  }

  const updateTemplateFieldRow = useCallback((idx, key, value, fallbackRow = null, path = "") => {
    const applyUpdate = () => setTemplateFieldRows((prev) => {
      const next = [...(Array.isArray(prev) ? prev : [])];
      if (Number.isInteger(idx) && idx >= 0 && next[idx] && typeof next[idx] === "object") {
        const row = next[idx];
        next[idx] = { ...row, [key]: value };
        return next;
      }
      const resolvedPath = String(path || fallbackRow?.tagPath || fallbackRow?.name || "").trim();
      if (!resolvedPath) return next;
      const existingIdx = next.findIndex((row) => {
        const rowPath = String(row?.tagPath || row?.name || "").trim();
        return rowPath === resolvedPath;
      });
      const seed = {
        name: String(fallbackRow?.name || resolvedPath).trim(),
        tagPath: String(fallbackRow?.tagPath || resolvedPath).trim(),
        plcType: String(fallbackRow?.plcType || "").trim(),
        baseType: String(fallbackRow?.baseType || "").trim(),
        isArray: fallbackRow?.isArray === true,
        arraySpec: String(fallbackRow?.arraySpec || "").trim(),
        usage: String(fallbackRow?.usage || "").trim(),
        uaType: String(fallbackRow?.uaType || "").trim(),
        pollMs: fallbackRow?.pollMs ?? "",
        samplingInterval: fallbackRow?.samplingInterval ?? "",
        topic: String(fallbackRow?.topic || "").trim(),
        enabled: fallbackRow?.enabled !== false,
        mappingSet: String(fallbackRow?.mappingSet || "").trim(),
        scale: Number.isFinite(Number(fallbackRow?.scale)) ? Number(fallbackRow.scale) : 1,
        decimals: Number.isFinite(Number(fallbackRow?.decimals)) ? Number(fallbackRow.decimals) : 0,
        alarmEnabled: fallbackRow?.alarmEnabled === true,
        alarmOperator: normalizeAlarmOperator(fallbackRow?.alarmOperator),
        alarmValue: normalizeAlarmThreshold(fallbackRow?.alarmValue),
      };
      if (existingIdx >= 0) {
        next[existingIdx] = { ...next[existingIdx], ...seed, [key]: value };
      } else {
        next.push({ ...seed, [key]: value });
      }
      return next;
    });
    applyUpdate();
  }, []);

  const removeTemplateFieldRow = useCallback((idx, fallbackRow = null, path = "", removeChildren = false) => {
    setTemplateFieldRows((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      const next = [...rows];
      const resolvedPath = String(path || fallbackRow?.tagPath || fallbackRow?.name || "").trim();
      if (Number.isInteger(idx) && idx >= 0 && next[idx] && typeof next[idx] === "object") {
        const basePath = String(next[idx]?.tagPath || next[idx]?.name || resolvedPath).trim();
        next.splice(idx, 1);
        if (!removeChildren || !basePath) return next;
        return next.filter((row) => {
          const rowPath = String(row?.tagPath || row?.name || "").trim();
          return rowPath !== basePath && !rowPath.startsWith(`${basePath}.`);
        });
      }
      if (!resolvedPath) return next;
      if (!removeChildren) {
        // Remove exactly one matching row to avoid accidental bulk deletes.
        const removeIdx = next.findIndex((row) => {
          const rowPath = String(row?.tagPath || row?.name || "").trim();
          return rowPath === resolvedPath;
        });
        if (removeIdx >= 0) next.splice(removeIdx, 1);
        return next;
      }
      return next.filter((row) => {
        const rowPath = String(row?.tagPath || row?.name || "").trim();
        return rowPath !== resolvedPath && !rowPath.startsWith(`${resolvedPath}.`);
      });
    });
  }, []);

  const templateFieldPrimitiveTypeSet = useMemo(() => new Set([
    "BOOL",
    "BIT",
    "SINT",
    "INT",
    "DINT",
    "LINT",
    "USINT",
    "UINT",
    "UDINT",
    "ULINT",
    "REAL",
    "LREAL",
    "STRING",
    "WSTRING",
    "BYTE",
    "WORD",
    "DWORD",
    "TIME",
    "DATE",
    "DATETIME",
  ]), []);

  const renderTemplateFieldTreeRows = useCallback((nodes, depth = 0) => {
    return (
      <div style={{ display: "grid", gap: 4 }}>
        {(Array.isArray(nodes) ? nodes : []).map((node) => {
          const fieldPath = String(node?.fullPath || "").trim();
          const fieldName = String(node?.name || "").trim();
          const rowEntry = templateFieldRowsByPath.get(fieldPath);
          const resolvedRow = editorResolvedRowsByPath.get(fieldPath);
          const fallbackRow = {
            name: fieldName || fieldPath || "(unnamed)",
            tagPath: fieldPath || fieldName,
            enabled: true,
            scale: 1,
            decimals: 0,
            alarmOperator: "==",
          };
          const row = rowEntry?.row || resolvedRow || fallbackRow;
          const rowIdx = Number.isFinite(rowEntry?.idx) ? rowEntry.idx : -1;
          const isDirectRow = rowIdx >= 0;
          const hasNestedChildren = Array.isArray(node?.children) && node.children.length > 0;
          const nodeKey = `template-tree:${fieldPath || fieldName}`;
          const expanded = templateFieldTreeExpanded[nodeKey] ?? false;
          const activeRowEditing = templateFieldEditingKey === nodeKey;
          const plcType = String(row?.plcType || row?.baseType || "").trim();
          const plcTypeBase = String(plcType || "")
            .replace(/\[[^\]]*\]/g, "")
            .replace(/\s*\([^)]*\)\s*$/g, "")
            .replace(/^"|"$/g, "")
            .trim()
            .toUpperCase();
          const isPrimitiveType = templateFieldPrimitiveTypeSet.has(plcTypeBase);
          const hasNested = hasNestedChildren && !isPrimitiveType;
          const isArray = String(row?.arraySpec || "").trim().length > 0 || /\[[^\]]+\]/.test(fieldName);
          return (
            <div key={`tmpl-tree-${nodeKey}`} style={{ marginLeft: Math.max(0, depth * 12), padding: "2px 0" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px 18px minmax(0,1fr) auto",
                  gap: 8,
                  alignItems: "center",
                  minHeight: 28,
                }}
              >
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={() => setTemplateFieldTreeExpanded((prev) => ({ ...prev, [nodeKey]: !expanded }))}
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 5,
                    width: 20,
                    height: 20,
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1,
                    padding: 0,
                  }}
                  title={expanded ? "Collapse" : "Expand"}
                >
                  {expanded ? "−" : "+"}
                </button>
                <input
                  type="checkbox"
                  checked={row?.enabled !== false}
                  onChange={(e) => updateTemplateFieldRow(rowIdx, "enabled", e.target.checked, row, fieldPath)}
                  style={{ width: 14, height: 14 }}
                  disabled={!templateEditing || hasNested}
                />
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", display: "inline-flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fieldName || "(unnamed)"}
                  </span>
                  {plcType ? <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>: {plcType}</span> : null}
                  {isArray ? <span style={{ color: "#2b6cff", fontWeight: 700 }}>[array]</span> : null}
                  {hasNested ? <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>(group)</span> : null}
                </div>
                <span />
              </div>
              {expanded && hasNested ? (
                <div
                  style={{
                    margin: "4px 0 8px 46px",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg)",
                    padding: 8,
                    display: "grid",
                    gap: 8,
                    gridTemplateColumns: "repeat(4, minmax(120px, 1fr))",
                  }}
                >
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Group Name
                    <input
                      value={String(row?.name || "")}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "name", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, gridColumn: "span 2" }}>
                    Group Tag Path
                    <input
                      value={String(row?.tagPath || "")}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "tagPath", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "end", gap: 8 }}>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={async () => {
                        setTemplateEditing(true);
                        setTemplateFieldTreeExpanded((prev) => ({ ...prev, [nodeKey]: true }));
                        if (activeRowEditing) {
                          await saveTemplate();
                          setTemplateFieldEditingKey("");
                          return;
                        }
                        setTemplateFieldEditingKey(nodeKey);
                      }}
                      style={{
                        border: "1px solid #2b6cff",
                        background: activeRowEditing ? "#2b6cff" : "var(--bg-elev)",
                        color: activeRowEditing ? "#fff" : "#2b6cff",
                        borderRadius: 6,
                        padding: "5px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: 1.2,
                        cursor: "pointer",
                      }}
                    >
                      {activeRowEditing ? "Save" : "Edit"}
                    </button>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={() => {
                        if (!isDirectRow) {
                          setError("This field group is inherited from a parent template. Edit the parent template to delete it.");
                          return;
                        }
                        removeTemplateFieldRow(rowIdx, row, fieldPath, true);
                      }}
                      style={{
                        border: "1px solid #f04438",
                        background: "#f04438",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "5px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: 1.2,
                        cursor: templateEditing ? "pointer" : "default",
                      }}
                      disabled={!templateEditing || !isDirectRow}
                      title={!isDirectRow ? "Inherited from parent template" : "Delete group"}
                    >
                      Delete Group
                    </button>
                  </div>
                </div>
              ) : null}
              {expanded && !hasNested ? (
                <div
                  style={{
                    margin: "4px 0 8px 46px",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg)",
                    padding: 8,
                    display: "grid",
                    gap: 8,
                    gridTemplateColumns: "repeat(6, minmax(120px, 1fr))",
                  }}
                >
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Name
                    <input
                      value={String(row?.name || "")}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "name", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11, gridColumn: "span 2" }}>
                    Tag Path
                    <input
                      value={String(row?.tagPath || "")}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "tagPath", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    UA Type
                    <select
                      value={String(row?.uaType || "")}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "uaType", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    >
                      <option value="">Select UA type</option>
                      <option value="Boolean">Boolean</option>
                      <option value="Int16">Int16</option>
                      <option value="Int32">Int32</option>
                      <option value="Int64">Int64</option>
                      <option value="UInt16">UInt16</option>
                      <option value="UInt32">UInt32</option>
                      <option value="UInt64">UInt64</option>
                      <option value="Float">Float</option>
                      <option value="Double">Double</option>
                      <option value="String">String</option>
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Poll
                    <input
                      value={row?.pollMs ?? ""}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "pollMs", e.target.value, row, fieldPath)}
                      placeholder="ms"
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Sampling
                    <input
                      value={row?.samplingInterval ?? ""}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "samplingInterval", e.target.value, row, fieldPath)}
                      placeholder="ms"
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Topic
                    <input
                      value={String(row?.topic || "")}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "topic", e.target.value, row, fieldPath)}
                      placeholder="Optional"
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Enabled
                    <span style={{ minHeight: 30, display: "inline-flex", alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={row?.enabled !== false}
                        onChange={(e) => updateTemplateFieldRow(rowIdx, "enabled", e.target.checked, row, fieldPath)}
                        style={{ width: 14, height: 14 }}
                        disabled={!templateEditing || !activeRowEditing}
                      />
                    </span>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Scale
                    <input
                      type="number"
                      step="any"
                      value={row?.scale ?? 1}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "scale", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Decimals
                    <input
                      type="number"
                      step="1"
                      value={row?.decimals ?? 0}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "decimals", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Mapping Set
                    <input
                      list={`tmpl-tree-map-list-${nodeKey}`}
                      value={String(row?.mappingSet || "")}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "mappingSet", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={!templateEditing || !activeRowEditing}
                      placeholder={mappingSets.length ? "Select or type mapping set" : "Type mapping set name"}
                    />
                    <datalist id={`tmpl-tree-map-list-${nodeKey}`}>
                      <option value="">None</option>
                      {mappingSets.map((m) => (
                        <option key={`tmpl-tree-map-${nodeKey}-${m.name}`} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </datalist>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Alarm
                    <span style={{ minHeight: 30, display: "inline-flex", alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={row?.alarmEnabled === true}
                        onChange={(e) => updateTemplateFieldRow(rowIdx, "alarmEnabled", e.target.checked, row, fieldPath)}
                        style={{ width: 14, height: 14 }}
                        disabled={!templateEditing || !activeRowEditing}
                      />
                    </span>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Alarm Operator
                    <select
                      value={normalizeAlarmOperator(row?.alarmOperator)}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "alarmOperator", e.target.value, row, fieldPath)}
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={row?.alarmEnabled !== true || !templateEditing || !activeRowEditing}
                    >
                      {ALARM_OPERATORS.map((op) => (
                        <option key={`tmpl-tree-alarm-op-${nodeKey}-${op}`} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    Alarm Value
                    <input
                      value={row?.alarmValue ?? ""}
                      onChange={(e) => updateTemplateFieldRow(rowIdx, "alarmValue", e.target.value, row, fieldPath)}
                      placeholder="e.g. 1"
                      style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 7px", fontSize: 12 }}
                      disabled={row?.alarmEnabled !== true || !templateEditing || !activeRowEditing}
                    />
                  </label>
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "end", gap: 8, gridColumn: "1 / -1" }}>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={async () => {
                        setTemplateEditing(true);
                        setTemplateFieldTreeExpanded((prev) => ({ ...prev, [nodeKey]: true }));
                        if (activeRowEditing) {
                          await saveTemplate();
                          setTemplateFieldEditingKey("");
                          return;
                        }
                        setTemplateFieldEditingKey(nodeKey);
                      }}
                      style={{
                        border: "1px solid #2b6cff",
                        background: activeRowEditing ? "#2b6cff" : "var(--bg-elev)",
                        color: activeRowEditing ? "#fff" : "#2b6cff",
                        borderRadius: 6,
                        padding: "5px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: 1.2,
                        cursor: "pointer",
                      }}
                    >
                      {activeRowEditing ? "Save" : "Edit"}
                    </button>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={() => {
                        if (!isDirectRow) {
                          setError("This field is inherited from a parent template. Edit the parent template to delete it.");
                          return;
                        }
                        removeTemplateFieldRow(rowIdx, row, fieldPath, false);
                      }}
                      style={{
                        border: "1px solid #f04438",
                        background: "#f04438",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "5px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        lineHeight: 1.2,
                        cursor: templateEditing ? "pointer" : "default",
                      }}
                      disabled={!templateEditing || !isDirectRow}
                      title={!isDirectRow ? "Inherited from parent template" : "Delete field"}
                    >
                      Delete Field
                    </button>
                  </div>
                </div>
              ) : null}
              {expanded && hasNested ? (
                <div style={{ marginTop: 2 }}>
                  {renderTemplateFieldTreeRows(node.children, depth + 1)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }, [
    editorResolvedRowsByPath,
    mappingSets,
    templateEditing,
    templateFieldEditingKey,
    templateFieldRowsByPath,
    templateFieldTreeExpanded,
    templateFieldPrimitiveTypeSet,
    updateTemplateFieldRow,
    removeTemplateFieldRow,
  ]);

  const templateFieldTreeContent = useMemo(() => {
    if (!templateFieldRows.length) {
      return <div style={{ padding: "8px", color: "var(--text-muted)", fontSize: 12 }}>No fields yet.</div>;
    }
    return renderTemplateFieldTreeRows(templateFieldTree, 0);
  }, [templateFieldRows.length, templateFieldTree, renderTemplateFieldTreeRows]);

  function addTagFromToolbar() {
    const topicKey =
      activeTagGroup.topic ||
      String(applyTopic || "").trim() ||
      (topics || [])[0]?.name ||
      "No Topic";
    const groupName = "Custom";
    setActiveTagGroup({ topic: topicKey, groupName });
    addTagToGroup(topicKey, groupName);
  }

  function applyBulkEditToTags() {
    const topicFilter = String(bulkEdit.topic || "").trim();
    const groupFilter = String(bulkEdit.groupName || "").trim();
    const groupLikeRegex = groupFilter
      ? new RegExp(
          `^${groupFilter
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/%/g, ".*")
            .replace(/_/g, ".")}$`,
          "i"
        )
      : null;
    const pollMsVal = parseOptionalMs(bulkEdit.pollMs);
    const samplingVal = parseOptionalMs(bulkEdit.samplingInterval);
    const deadbandVal = parseOptionalNonNegative(bulkEdit.deadband);
    const mappingSetVal = String(bulkEdit.mappingSet || "").trim();
    let changed = 0;
    setConfig((prev) => {
      const nextTags = (prev.tags || []).map((tag) => {
        const topic = String(tag?.topic || "").trim();
        const group = String(tag?.groupName || "").trim();
        if (topicFilter && topic !== topicFilter) return tag;
        if (groupLikeRegex && !groupLikeRegex.test(group)) return tag;
        const next = { ...tag };
        if (bulkEdit.pollMs !== "") next.pollMs = pollMsVal;
        if (bulkEdit.samplingInterval !== "") next.samplingInterval = samplingVal;
        if (bulkEdit.deadband !== "") next.deadband = deadbandVal;
        if (mappingSetVal) next.mappingSet = mappingSetVal;
        next.muted = bulkEdit.muted === true;
        changed += 1;
        return next;
      });
      return { ...prev, tags: nextTags };
    });
    setStatus(changed ? `Updated ${changed} tag(s).` : "No matching tags.");
  }
  function addTopic() {
    const name = normalizeTopicValue(manualTopic.name);
    const prefix = normalizeTopicValue(manualTopic.prefix);
    const plcName = normalizeTopicValue(manualTopic.plcName);
    const samplingIntervalRaw = parseOptionalMs(manualTopic.samplingInterval);
    const samplingInterval = samplingIntervalRaw === "" ? undefined : samplingIntervalRaw;
    if (!name) {
      setError("Topic name is required.");
      return;
    }
    if (!plcName) {
      setError("Select a PLC for the topic.");
      return;
    }
    setError("");
    const nextTopics = [
      ...(config.topics || []),
      {
        name,
        prefix,
        plcName,
        samplingInterval,
        enabled: manualTopic.enabled !== false,
      },
    ];
    const cleanedTopics = buildCleanedTopics(nextTopics);
    const nextConfig = { ...config, topics: cleanedTopics };
    setConfig(nextConfig);
    persistConfig(nextConfig, "Topic saved.").catch((err) => {
      setError(err?.message || "Save failed.");
    });
    setManualTopic({ name: "", prefix: "", plcName: "", samplingInterval: "", enabled: true });
    setShowTopicForm(false);
  }

  function removeTopic(idx) {
    setConfig((prev) => {
      const nextTopics = [...(prev.topics || [])];
      nextTopics.splice(idx, 1);
      const cleanedTopics = buildCleanedTopics(nextTopics);
      const nextConfig = { ...prev, topics: cleanedTopics };
      persistConfig(nextConfig, "Topic removed.").catch((err) => {
        setError(err?.message || "Save failed.");
      });
      return nextConfig;
    });
  }

  function removeTagGroup(topicKey, groupName) {
    const topicTarget = normalizeTagName(topicKey || "") || "No Topic";
    const groupTarget = normalizeTagName(groupName || "") || "Ungrouped";
    setPendingTagGroupDelete({ topicTarget, groupTarget });
  }

  function requestRemoveTag(idx, tag) {
    const topic = normalizeTagName(tag?.topic || "") || "No Topic";
    const name = normalizeTagName(tag?.name || "");
    const tagPath = normalizeTagName(tag?.tagPath || "");
    const displayName = name || tagPath || `Tag #${Number(idx) + 1}`;
    setPendingTagDelete({
      idxHint: Number(idx),
      topic,
      name,
      tagPath,
      displayName,
    });
  }

  function confirmRemoveTag() {
    const pending = pendingTagDelete;
    setPendingTagDelete(null);
    if (!pending) return;
    const source = Array.isArray(config?.tags) ? config.tags : [];
    let idx = source.findIndex((tag) => {
      const topic = normalizeTagName(tag?.topic || "") || "No Topic";
      const name = normalizeTagName(tag?.name || "");
      const tagPath = normalizeTagName(tag?.tagPath || "");
      return topic === pending.topic && name === pending.name && tagPath === pending.tagPath;
    });
    if (idx < 0) {
      const hinted = Number.isInteger(pending?.idxHint) ? pending.idxHint : -1;
      if (hinted >= 0 && hinted < source.length) idx = hinted;
    }
    if (idx < 0) return;
    removeTag(idx);
  }

  function confirmRemoveTagGroup() {
    const topicTarget = normalizeTagName(pendingTagGroupDelete?.topicTarget || "") || "No Topic";
    const groupTarget = normalizeTagName(pendingTagGroupDelete?.groupTarget || "") || "Ungrouped";
    setPendingTagGroupDelete(null);
    setConfig((prev) => {
      const sourceTags = Array.isArray(prev.tags) ? prev.tags : [];
      const nextTags = sourceTags.filter((tag) => {
        const topic = normalizeTagName(tag?.topic || "") || "No Topic";
        const group = getTagGroupKey(tag);
        return !(topic === topicTarget && group === groupTarget);
      });
      const removed = sourceTags.length - nextTags.length;
      if (removed <= 0) return prev;
      const cleanedTags = buildCleanedTags(nextTags);
      const nextConfig = { ...prev, tags: cleanedTags };
      setActiveTagGroup((current) =>
        current?.topic === topicTarget && current?.groupName === groupTarget
          ? { topic: "", groupName: "" }
          : current
      );
      persistConfig(nextConfig, `Deleted group "${groupTarget}" (${removed} tag${removed === 1 ? "" : "s"}).`).catch((err) => {
        setError(err?.message || "Save failed.");
      });
      return nextConfig;
    });
  }

  function updatePlc(idx, key, value) {
    setConfig((prev) => {
      const next = [...(prev.plcs || [])];
      next[idx] = { ...next[idx], [key]: value };
      return { ...prev, plcs: next };
    });
  }

  function addPlc() {
    const name = normalizeTopicValue(manualPlc.name);
    const host = normalizeTopicValue(manualPlc.host);
    const slot = manualPlc.slot === "" ? 0 : Number(manualPlc.slot);
    const pollMs = parseOptionalMs(manualPlc.pollMs);
    if (!name) {
      setError("PLC name is required.");
      return;
    }
    if (!host) {
      setError("PLC host is required.");
      return;
    }
    setError("");
    const nextPlcs = [
      ...(config.plcs || []),
      { id: makeId(), name, host, slot: Number.isFinite(slot) ? slot : 0, pollMs: Number.isFinite(pollMs) ? pollMs : "" },
    ];
    const cleanedPlcs = buildCleanedPlcs(nextPlcs);
    const nextConfig = { ...config, plcs: cleanedPlcs };
    setConfig(nextConfig);
    persistConfig(nextConfig, "PLC saved.").catch((err) => {
      setError(err?.message || "Save failed.");
    });
    setManualPlc({ name: "", host: "", slot: "", pollMs: "" });
    setShowPlcForm(false);
  }

  function removePlc(idx) {
    setConfig((prev) => {
      const nextPlcs = [...(prev.plcs || [])];
      nextPlcs.splice(idx, 1);
      const cleanedPlcs = buildCleanedPlcs(nextPlcs);
      const nextConfig = { ...prev, plcs: cleanedPlcs };
      persistConfig(nextConfig, "PLC removed.").catch((err) => {
        setError(err?.message || "Save failed.");
      });
      return nextConfig;
    });
  }

  function renderDeleteModals() {
    return (
      <>
        {pendingTagGroupDelete ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 400,
              background: "rgba(4, 10, 20, 0.56)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div
              style={{
                width: "min(460px, 96vw)",
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                borderRadius: 12,
                boxShadow: "0 18px 44px rgba(0,0,0,0.28)",
                padding: 14,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>Delete Tag Group</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Delete group <strong style={{ color: "var(--text)" }}>{pendingTagGroupDelete.groupTarget}</strong> in topic{" "}
                <strong style={{ color: "var(--text)" }}>{pendingTagGroupDelete.topicTarget}</strong> and all tags inside it?
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setPendingTagGroupDelete(null)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 12px",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRemoveTagGroup}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid #f04438",
                    background: "#f04438",
                    color: "white",
                    borderRadius: 8,
                    padding: "6px 12px",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {pendingTagDelete ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 401,
              background: "rgba(4, 10, 20, 0.56)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div
              style={{
                width: "min(460px, 96vw)",
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                borderRadius: 12,
                boxShadow: "0 18px 44px rgba(0,0,0,0.28)",
                padding: 14,
                display: "grid",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>Delete Tag</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Delete tag <strong style={{ color: "var(--text)" }}>{pendingTagDelete.displayName}</strong> from topic{" "}
                <strong style={{ color: "var(--text)" }}>{pendingTagDelete.topic}</strong>?
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setPendingTagDelete(null)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 12px",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmRemoveTag}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: "1px solid #f04438",
                    background: "#f04438",
                    color: "white",
                    borderRadius: 8,
                    padding: "6px 12px",
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (isTagsOnly) {
    return (
      <div style={outerStyle}>
        <div style={innerStyle}>
          <div style={contentStyle}>
            {renderTagsPanel()}
          </div>
          {renderDeleteModals()}
        </div>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <div style={innerStyle}>
        <div style={contentStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                background:
                  restartPending
                    ? "#fff6ed"
                    : !opcConnectionEnabled
                    ? "#f2f4f7"
                    : opcConnected === true
                    ? "#ecfdf3"
                    : opcConnected === false
                    ? "#fef3f2"
                    : "#f2f4f7",
                color:
                  restartPending
                    ? "#b54708"
                    : !opcConnectionEnabled
                    ? "var(--text-muted)"
                    : opcConnected === true
                    ? "#027a48"
                    : opcConnected === false
                    ? "#b42318"
                    : "var(--text-muted)",
                border:
                  restartPending
                    ? "1px solid #fed7aa"
                    : !opcConnectionEnabled
                    ? "1px solid var(--border)"
                    : opcConnected === true
                    ? "1px solid #abefc6"
                    : opcConnected === false
                    ? "1px solid #fecdca"
                    : "1px solid var(--border)",
              }}
            >
              {restartPending
                ? "Restarting..."
                : !opcConnectionEnabled
                ? "Connection Disabled"
                : opcConnected === true
                ? "Connected"
                : opcConnected === false
                ? "Disconnected"
                : "Status Unknown"}
            </div>
            {Object.keys(liveErrors || {}).length > 0 ? (
              <div
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#fef3f2",
                  color: "#b42318",
                  border: "1px solid #fecdca",
                }}
              >
                {Object.keys(liveErrors || {}).length} Active Errors
              </div>
            ) : null}
            {recentErrorCount > 0 ? (
              <div
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: "#fff8eb",
                  color: "#b54708",
                  border: "1px solid #fedf89",
                }}
              >
                {recentErrorCount} Recent
              </div>
            ) : null}
            {opcLastPollAt ? (
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Last poll {new Date(opcLastPollAt).toLocaleTimeString()}
              </div>
            ) : null}
          </div>
          <button
            onClick={requestRestart}
            disabled={restartPending || !opcConnectionEnabled}
            style={{
              border: "1px solid var(--border)",
              background: "var(--bg-elev)",
              color: "var(--text)",
              borderRadius: 8,
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: 700,
              cursor: restartPending || !opcConnectionEnabled ? "not-allowed" : "pointer",
              opacity: restartPending || !opcConnectionEnabled ? 0.65 : 1,
              flex: "0 0 auto",
            }}
            title="Restart OPC Server"
          >
            Restart OPC Server
          </button>
        </div>
        {typeof onDrawerViewChange === "function" ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              data-preserve-style="true"
              onClick={() => onDrawerViewChange("opc")}
              style={drawerTabButtonStyle(mode !== "logs" && mode !== "diagnostics")}
            >
              Config
            </button>
            <button
              data-preserve-style="true"
              onClick={() => onDrawerViewChange("logs")}
              style={drawerTabButtonStyle(mode === "logs")}
            >
              Logs
            </button>
            <button
              data-preserve-style="true"
              onClick={() => onDrawerViewChange("diagnostics")}
              style={drawerTabButtonStyle(mode === "diagnostics")}
            >
              Diagnostics
            </button>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            data-preserve-style="true"
            onClick={() => setOpcConfigSectionTab("opcua")}
            style={drawerTabButtonStyle(opcConfigSectionTab === "opcua")}
          >
            OPC UA
          </button>
          <button
            data-preserve-style="true"
            onClick={() => setOpcConfigSectionTab("mqtt")}
            style={drawerTabButtonStyle(opcConfigSectionTab === "mqtt")}
          >
            MQTT
          </button>
          <button
            data-preserve-style="true"
            onClick={() => setOpcConfigSectionTab("plcs")}
            style={drawerTabButtonStyle(opcConfigSectionTab === "plcs")}
          >
            PLC Instances
          </button>
          <button
            data-preserve-style="true"
            onClick={() => setOpcConfigSectionTab("topics")}
            style={drawerTabButtonStyle(opcConfigSectionTab === "topics")}
          >
            PLC Topics
          </button>
          {typeof onDrawerViewChange !== "function" ? (
            <button
              data-preserve-style="true"
              onClick={() => setOpcConfigSectionTab("diagnostics")}
              style={drawerTabButtonStyle(opcConfigSectionTab === "diagnostics")}
            >
              Diagnostics
            </button>
          ) : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, flex: "1 1 0", minHeight: 0 }}>
          {opcConfigSectionTab === "opcua" ? (
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", minHeight: 0, height: "100%", overflow: "auto" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>OPC UA</div>
            <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 10 }}>
              Port
              <input
                type="number"
                value={config.opcua?.port ?? 4840}
                disabled={!opcUaEditing}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, opcua: { ...p.opcua, port: Number(e.target.value) } }))
                }
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 10 }}>
              Resource Path
              <input
                value={config.opcua?.resourcePath || ""}
                disabled={!opcUaEditing}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, opcua: { ...p.opcua, resourcePath: e.target.value } }))
                }
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 10 }}>
              Name
              <input
                value={config.opcua?.name || ""}
                disabled={!opcUaEditing}
                onChange={(e) => setConfig((p) => ({ ...p, opcua: { ...p.opcua, name: e.target.value } }))}
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
              />
            </label>
            <div style={{ fontWeight: 700, marginBottom: 8, marginTop: 4 }} title="Live OPC poller behavior and resiliency settings.">
              Runtime
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <button
                type="button"
                disabled={!opcUaEditing}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    runtime: {
                      ...normalizeRuntimeConfig(p.runtime),
                      multiReadEnabled: true,
                      multiReadBatchSize: 12,
                      maxReadsPerTick: 250,
                      readTimeoutMs: 3000,
                      readRetryCount: 2,
                      readRetryDelayMs: 100,
                      heartbeatEnabled: true,
                      heartbeatMs: 5000,
                    },
                  }))
                }
                style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px", fontWeight: 600, fontSize: 12 }}
                title="Balanced throughput and stability."
              >
                Balanced
              </button>
              <button
                type="button"
                disabled={!opcUaEditing}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    runtime: {
                      ...normalizeRuntimeConfig(p.runtime),
                      multiReadEnabled: true,
                      multiReadBatchSize: 20,
                      maxReadsPerTick: 600,
                      readTimeoutMs: 3500,
                      readRetryCount: 1,
                      readRetryDelayMs: 60,
                      heartbeatEnabled: false,
                    },
                  }))
                }
                style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px", fontWeight: 600, fontSize: 12 }}
                title="Higher throughput, lower overhead."
              >
                High Throughput
              </button>
              <button
                type="button"
                disabled={!opcUaEditing}
                onClick={() =>
                  setConfig((p) => ({
                    ...p,
                    runtime: {
                      ...normalizeRuntimeConfig(p.runtime),
                      multiReadEnabled: true,
                      multiReadBatchSize: 8,
                      maxReadsPerTick: 120,
                      readTimeoutMs: 3500,
                      readRetryCount: 2,
                      readRetryDelayMs: 120,
                      heartbeatEnabled: true,
                      heartbeatMs: 6000,
                    },
                  }))
                }
                style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px", fontWeight: 600, fontSize: 12 }}
                title="Lower PLC/network load."
              >
                Low Load
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, gridColumn: "1 / span 2" }} title="Disable PLC connect/reconnect and polling attempts. Save config and restart OPC server to apply.">
                <input
                  type="checkbox"
                  checked={config.runtime?.opcConnectionEnabled !== false}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), opcConnectionEnabled: e.target.checked } }))}
                />
                Enable OPC PLC Connection
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }} title="Batch reads multiple tags in one PLC request for higher throughput.">
                <input
                  type="checkbox"
                  checked={config.runtime?.multiReadEnabled !== false}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), multiReadEnabled: e.target.checked } }))}
                />
                Enable Multi-Read
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Maximum tags per PLC multi-read request. Lower if PLC rejects larger packets.">
                Multi-Read Batch Size
                <input
                  type="number"
                  min="1"
                  max="25"
                  value={config.runtime?.multiReadBatchSize ?? 16}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), multiReadBatchSize: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Maximum due tags processed per PLC tick. Prevents burst overload at high tag counts.">
                Max Reads Per Tick
                <input
                  type="number"
                  min="10"
                  max="5000"
                  value={config.runtime?.maxReadsPerTick ?? 300}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), maxReadsPerTick: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Maximum wait for a PLC read before marking it as timeout/error.">
                Read Timeout (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.readTimeoutMs ?? 3000}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), readTimeoutMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="How many extra retry attempts are made for transient read failures.">
                Read Retry Count
                <input
                  type="number"
                  min="0"
                  max="5"
                  value={config.runtime?.readRetryCount ?? 2}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), readRetryCount: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Delay before each retry attempt after a transient read failure.">
                Read Retry Delay (ms)
                <input
                  type="number"
                  min="0"
                  value={config.runtime?.readRetryDelayMs ?? 100}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), readRetryDelayMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="PLC connection timeout used during initial connect and reconnect attempts.">
                PLC Connect Timeout (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.plcConnectTimeoutMs ?? 9000}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), plcConnectTimeoutMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="PLC receive timeout for socket reads before connection health is considered degraded.">
                PLC Receive Timeout (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.plcReceiveTimeoutMs ?? 18000}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), plcReceiveTimeoutMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Heartbeat check interval used to verify PLC connection health.">
                Heartbeat (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.heartbeatMs ?? 5000}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), heartbeatMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Consecutive heartbeat failures required before disconnect/reconnect is forced.">
                Heartbeat Fail Threshold
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={config.runtime?.heartbeatFailureThreshold ?? 3}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), heartbeatFailureThreshold: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }} title="Disable extra heartbeat reads. Poll loop reads still maintain live values.">
                <input
                  type="checkbox"
                  checked={config.runtime?.heartbeatEnabled !== false}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), heartbeatEnabled: e.target.checked } }))}
                />
                Enable Heartbeat Reads
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Delay between PLC reconnect attempts after disconnect or failed heartbeat.">
                Reconnect Delay (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.reconnectDelayMs ?? 2000}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), reconnectDelayMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Maximum reconnect attempts. Leave blank for infinite retries.">
                Reconnect Max Attempts
                <input
                  type="number"
                  min="1"
                  value={config.runtime?.reconnectMaxAttempts ?? ""}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), reconnectMaxAttempts: e.target.value } }))}
                  placeholder="Blank = infinite"
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Base backoff added after repeated read errors.">
                Backoff Base (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.errorBackoffBaseMs ?? 1000}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), errorBackoffBaseMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Maximum extra delay added by error backoff.">
                Backoff Max (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.errorBackoffMaxMs ?? 15000}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), errorBackoffMaxMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Number of consecutive errors before backoff starts.">
                Backoff Threshold
                <input
                  type="number"
                  min="1"
                  value={config.runtime?.errorBackoffThreshold ?? 3}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), errorBackoffThreshold: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Random spread added to scheduling to reduce burst polling.">
                Poll Jitter (ms)
                <input
                  type="number"
                  min="0"
                  value={config.runtime?.pollJitterMs ?? 0}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), pollJitterMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Default deadband for numeric tags unless a tag-specific deadband is set.">
                Default Deadband
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={config.runtime?.deadbandDefault ?? ""}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), deadbandDefault: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, gridColumn: "1 / span 2" }} title="Enable dynamic slowdown after repeated tag read failures.">
                <input
                  type="checkbox"
                  checked={config.runtime?.errorBackoffEnabled !== false}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), errorBackoffEnabled: e.target.checked } }))}
                />
                Enable Error Backoff
              </label>
            </div>
            <div style={{ marginTop: "auto", display: "flex", gap: 8, paddingTop: 10, position: "sticky", bottom: 0, background: "var(--bg-elev)" }}>
              {opcUaEditing ? (
                <button onClick={cancelOpcUaEdit} style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 10, padding: "8px 12px" }}>
                  Cancel
                </button>
              ) : null}
              <button
                onClick={() => {
                  if (!opcUaEditing) {
                    beginOpcUaEdit();
                    return;
                  }
                  void saveOpcUaEdit();
                }}
                style={{ border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 10, padding: "8px 12px" }}
              >
                {opcUaEditing ? "Save" : "Edit"}
              </button>
            </div>
          </div>
          ) : null}

          {opcConfigSectionTab === "mqtt" ? (
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", minHeight: 0, height: "100%", overflow: "auto" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>MQTT</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, gridColumn: "1 / span 2" }} title="Enable MQTT publish/subscribe bridge. Save config and restart OPC server to apply.">
                <input
                  type="checkbox"
                  checked={config.runtime?.mqttEnabled === true}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttEnabled: e.target.checked } }))}
                />
                Enable MQTT Bridge
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="MQTT broker URL, e.g. mqtt://localhost:1883">
                MQTT Broker URL
                <input
                  value={config.runtime?.mqttBrokerUrl ?? "mqtt://localhost:1883"}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttBrokerUrl: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Optional MQTT client id. Leave blank to auto-generate.">
                MQTT Client ID
                <input
                  value={config.runtime?.mqttClientId ?? ""}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttClientId: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Optional MQTT username.">
                MQTT Username
                <input
                  value={config.runtime?.mqttUsername ?? ""}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttUsername: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Optional MQTT password.">
                MQTT Password
                <input
                  type="password"
                  value={config.runtime?.mqttPassword ?? ""}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttPassword: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Topic for publishing full OPC status payloads.">
                MQTT Status Topic
                <input
                  value={config.runtime?.mqttStatusTopic ?? "mesora/opc/status"}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttStatusTopic: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Topic subscribed for write commands. Payload format: {'tagKey':'Topic.Tag','value':123}.">
                MQTT Write Topic
                <input
                  value={config.runtime?.mqttWriteTopic ?? "mesora/opc/write"}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttWriteTopic: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="MQTT QoS level for status publish and write subscribe.">
                MQTT QoS
                <input
                  type="number"
                  min="0"
                  max="2"
                  value={config.runtime?.mqttQos ?? 0}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttQos: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }} title="Set retained flag when publishing status payloads.">
                <input
                  type="checkbox"
                  checked={config.runtime?.mqttRetain === true}
                  disabled={!opcUaEditing}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), mqttRetain: e.target.checked } }))}
                />
                MQTT Retain Status
              </label>
            </div>
            <div style={{ marginTop: "auto", display: "flex", gap: 8, paddingTop: 10, position: "sticky", bottom: 0, background: "var(--bg-elev)" }}>
              {opcUaEditing ? (
                <button onClick={cancelOpcUaEdit} style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 10, padding: "8px 12px" }}>
                  Cancel
                </button>
              ) : null}
              <button
                onClick={() => {
                  if (!opcUaEditing) {
                    beginOpcUaEdit();
                    return;
                  }
                  void saveOpcUaEdit();
                }}
                style={{ border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 10, padding: "8px 12px" }}
              >
                {opcUaEditing ? "Save" : "Edit"}
              </button>
            </div>
          </div>
          ) : null}

          {opcConfigSectionTab === "plcs" ? (
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>PLC Instances</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setShowPlcForm((v) => !v)}
                style={{
                  border: "1px solid var(--border)",
                  background: showPlcForm ? "#2b6cff" : "white",
                  color: showPlcForm ? "white" : "#111",
                  borderRadius: 8,
                  padding: "6px 10px",
                }}
              >
                {showPlcForm ? "Hide PLC" : "New PLC"}
              </button>
            </div>
            {showPlcForm ? (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--bg-soft)", marginBottom: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Name
                    <input
                      value={manualPlc.name}
                      onChange={(e) => setManualPlc((prev) => ({ ...prev, name: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Host
                    <input
                      value={manualPlc.host}
                      onChange={(e) => setManualPlc((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="e.g., 10.0.0.10"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Slot
                    <input
                      type="number"
                      value={manualPlc.slot}
                      onChange={(e) => setManualPlc((prev) => ({ ...prev, slot: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Poll (ms)
                    <input
                      type="number"
                      value={manualPlc.pollMs}
                      onChange={(e) => setManualPlc((prev) => ({ ...prev, pollMs: e.target.value }))}
                      placeholder="Optional"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={addPlc} style={{ border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}>
                    Save PLC
                  </button>
                  <button
                    onClick={() => {
                      setManualPlc({ name: "", host: "", slot: "", pollMs: "" });
                      setShowPlcForm(false);
                    }}
                    style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
              {(!plcs || plcs.length === 0) ? (
                <div style={{ padding: 8, color: "var(--text-muted)", fontSize: 12 }}>No PLCs configured.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "28%" }} />
                    <col style={{ width: "34%" }} />
                    <col style={{ width: "12%" }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: 48 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: "var(--bg-soft)" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Host</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Slot</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Poll (ms)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {plcs.map((plc, idx) => (
                      <tr key={plc.id || `plc-${idx}`} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            value={plc.name || ""}
                            onChange={(e) => updatePlc(idx, "name", e.target.value)}
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            value={plc.host || ""}
                            onChange={(e) => updatePlc(idx, "host", e.target.value)}
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="number"
                            value={plc.slot ?? 0}
                            onChange={(e) => updatePlc(idx, "slot", e.target.value)}
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="number"
                            value={plc.pollMs ?? ""}
                            onChange={(e) => updatePlc(idx, "pollMs", e.target.value)}
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 6px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <button
                            onClick={() => removePlc(idx)}
                            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textAlign: "center", width: 28, height: 28, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8 }}
                          >
                            <TrashCanIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          ) : null}

          {opcConfigSectionTab === "topics" ? (
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>PLC Topics</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setShowTopicForm((v) => !v)}
                style={{
                  border: "1px solid var(--border)",
                  background: showTopicForm ? "#2b6cff" : "white",
                  color: showTopicForm ? "white" : "#111",
                  borderRadius: 8,
                  padding: "6px 10px",
                }}
              >
                {showTopicForm ? "Hide Topic" : "New Topic"}
              </button>
            </div>
            {showTopicForm ? (
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--bg-soft)", marginBottom: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Topic Name
                    <input
                      value={manualTopic.name}
                      onChange={(e) => setManualTopic((prev) => ({ ...prev, name: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Prefix
                    <input
                      value={manualTopic.prefix}
                      onChange={(e) => setManualTopic((prev) => ({ ...prev, prefix: e.target.value }))}
                      placeholder="Optional"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    PLC
                    <select
                      value={manualTopic.plcName}
                      onChange={(e) => setManualTopic((prev) => ({ ...prev, plcName: e.target.value }))}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    >
                      <option value="">Select PLC</option>
                      {(plcs || []).map((p) => (
                        <option key={`topic-plc-${p.name}`} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Sampling (ms)
                    <input
                      type="number"
                      min="100"
                      value={manualTopic.samplingInterval}
                      onChange={(e) => setManualTopic((prev) => ({ ...prev, samplingInterval: e.target.value }))}
                      placeholder="Overrides PLC"
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={addTopic} style={{ border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}>
                    Save Topic
                  </button>
                  <button
                    onClick={() => {
                      setManualTopic({ name: "", prefix: "", plcName: "", enabled: true });
                      setShowTopicForm(false);
                    }}
                    style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
              {topics.length === 0 ? (
                <div style={{ padding: 8, color: "var(--text-muted)", fontSize: 12 }}>No topics.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "24%" }} />
                    <col style={{ width: "24%" }} />
                    <col style={{ width: "24%" }} />
                    <col style={{ width: "20%" }} />
                    <col style={{ width: 48 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: "var(--bg-soft)" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Prefix</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>PLC</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Sampling (ms)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {topics.map((topic, idx) => (
                      <tr key={`topic-${topic.name}-${idx}`} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px" }}>{topic.name || ""}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{topic.prefix || ""}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{topic.plcName || ""}</td>
                        <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>
                          {Number.isFinite(Number(topic.samplingInterval)) ? Number(topic.samplingInterval) : ""}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <button
                            onClick={() => removeTopic(idx)}
                            title="Delete topic"
                            aria-label="Delete topic"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 28,
                              height: 28,
                              border: "1px solid #f04438",
                              background: "#f04438",
                              color: "#ffffff",
                              borderRadius: 8,
                              padding: 0,
                              lineHeight: 1,
                              boxShadow: "0 4px 12px rgba(240,68,56,0.28)",
                            }}
                          >
                            <TrashCanIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          ) : null}

          {opcConfigSectionTab === "diagnostics" ? (
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
            {renderServerDiagnosticsCard()}
            {renderTagDiagnosticsCard()}
          </div>
          ) : null}

          {showTagsDrawer ? (
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 230,
              }}
            >
              <div
                onClick={() => setShowTagsDrawer(false)}
                style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }}
              />
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  height: "100%",
                  width: "min(760px, 95vw)",
                  background: "var(--bg-soft)",
                  boxShadow: "-16px 0 40px rgba(0,0,0,0.18)",
                  display: "flex",
                  flexDirection: "column",
                  borderLeft: "1px solid var(--border)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.02em" }}>Tags</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
                    <label
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        cursor: "pointer",
                        fontSize: 12,
                      }}
                    >
                      Upload CSV
                      <input type="file" accept=".csv" onChange={onCsvFile} style={{ display: "none" }} />
                    </label>
                    <button
                      ref={drawerMenuBtnRef}
                      onClick={() => setShowDrawerMenu((v) => !v)}
                      style={{
                        textAlign: "center",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Menu
                    </button>
                    {showDrawerMenu ? (
                      <div
                        ref={drawerMenuRef}
                        style={{
                          position: "absolute",
                          right: 0,
                          top: 36,
                          zIndex: 5,
                          minWidth: 160,
                          background: "var(--bg-elev)",
                          border: "1px solid rgba(0,0,0,0.12)",
                          borderRadius: 10,
                          boxShadow: "0 12px 24px rgba(0,0,0,0.14)",
                          padding: "6px 0",
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => window.location.assign("/ai")}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 12px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--text)",
                          }}
                        >
                          AI
                        </button>
                        <button
                          onClick={() => window.location.assign("/data")}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "8px 12px",
                            border: "none",
                            background: "transparent",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 600,
                            color: "var(--text)",
                          }}
                        >
                          Data
                        </button>
                      </div>
                    ) : null}
                    <button
                      onClick={() => setShowTagsDrawer(false)}
                      style={{
                        textAlign: "center",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>
                {renderTagsPanel()}
              </div>
            </div>
          ) : null}
          {renderDeleteModals()}
        </div>
      </div>
    </div>
  </div>
  );
}
