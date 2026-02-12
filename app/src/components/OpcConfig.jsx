import { Fragment, useEffect, useMemo, useRef, useState } from "react";

function normalizeTagName(name) {
  return String(name || "")
    .replace(/\\n/g, "")
    .replace(/\r?\n/g, "")
    .trim();
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

function defaultRuntimeConfig() {
  return {
    readTimeoutMs: 2000,
    errorBackoffEnabled: true,
    errorBackoffBaseMs: 1000,
    errorBackoffMaxMs: 15000,
    errorBackoffThreshold: 3,
    pollJitterMs: 0,
    deadbandDefault: "",
    reconnectDelayMs: 2000,
    reconnectMaxAttempts: "",
    heartbeatMs: 5000,
  };
}

function normalizeRuntimeConfig(value) {
  const incoming = value && typeof value === "object" ? value : {};
  const defaults = defaultRuntimeConfig();
  return {
    readTimeoutMs: parseOptionalMs(incoming.readTimeoutMs) || defaults.readTimeoutMs,
    errorBackoffEnabled: incoming.errorBackoffEnabled !== false,
    errorBackoffBaseMs: parseOptionalMs(incoming.errorBackoffBaseMs) || defaults.errorBackoffBaseMs,
    errorBackoffMaxMs: parseOptionalMs(incoming.errorBackoffMaxMs) || defaults.errorBackoffMaxMs,
    errorBackoffThreshold: parseOptionalMs(incoming.errorBackoffThreshold) || defaults.errorBackoffThreshold,
    pollJitterMs: parseOptionalNonNegative(incoming.pollJitterMs) === "" ? defaults.pollJitterMs : parseOptionalNonNegative(incoming.pollJitterMs),
    deadbandDefault: parseOptionalNonNegative(incoming.deadbandDefault),
    reconnectDelayMs: parseOptionalMs(incoming.reconnectDelayMs) || defaults.reconnectDelayMs,
    reconnectMaxAttempts: parseOptionalMs(incoming.reconnectMaxAttempts),
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
  const [opcConnected, setOpcConnected] = useState(null);
  const [opcLastPollAt, setOpcLastPollAt] = useState(null);
  const [restartPending, setRestartPending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [templateFieldRows, setTemplateFieldRows] = useState([
    { name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true, mappingSet: "", scale: 1, decimals: 0 },
  ]);
  const [templateStateMappings, setTemplateStateMappings] = useState([
    { field: "", state: "", color: "" },
  ]);
  const [templateParent, setTemplateParent] = useState("");
  const [editTemplate, setEditTemplate] = useState("");
  const [templateOriginalName, setTemplateOriginalName] = useState("");
  const [templateEditing, setTemplateEditing] = useState(true);
  const [tagMappings, setTagMappings] = useState([]);
  const [manualTagMappings, setManualTagMappings] = useState([{ field: "", state: "", color: "" }]);
  const [mappingSets, setMappingSets] = useState([]);
  const [mappingSetName, setMappingSetName] = useState("");
  const [mappingSetOriginalName, setMappingSetOriginalName] = useState("");
  const [mappingSetRows, setMappingSetRows] = useState([{ field: "", state: "", color: "" }]);
  const [applyTemplate, setApplyTemplate] = useState("");
  const [applyTopic, setApplyTopic] = useState("");
  const [applyPrefix, setApplyPrefix] = useState("");
  const [applyMappingSet, setApplyMappingSet] = useState("");
  const [errorLogEntries, setErrorLogEntries] = useState([]);
  const [expandedPrefixes, setExpandedPrefixes] = useState({});
  const [tagSectionTab, setTagSectionTab] = useState("tags");
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
  const tagEditRowRefs = useRef(new Map());
  const tagColumnKeys = [
    "enabled",
    "muted",
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
  const lastSavedRef = useRef("");
  const lastLiveErrorsRef = useRef({});
  const mappingSetAutoSelectedRef = useRef(false);
  const drawerMenuRef = useRef(null);
  const drawerMenuBtnRef = useRef(null);

  useEffect(() => {
    if (mode === "logs") {
      setTagSectionTab("logs");
    } else if (mode === "tags") {
      setTagSectionTab("tags");
    }
  }, [mode]);

  useEffect(() => {
    async function load() {
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
              mappingSet: t?.mappingSet || "",
            };
          })
          .filter((t) => t.name);
        const cleanedPlcs = Array.isArray(data.plcs) && data.plcs.length
          ? data.plcs
              .map((p, idx) => ({
                id: String(p?.id || makeId()),
                name: normalizeTopicValue(p?.name || `PLC-${idx + 1}`),
                host: normalizeTopicValue(p?.host || ""),
                slot: Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0,
                pollMs: parseOptionalMs(p?.pollMs),
              }))
              .filter((p) => p.name)
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
        const cleanedTopics = (data.topics || [])
          .map((t) => ({
            name: normalizeTopicValue(t?.name || ""),
            prefix: normalizeTopicValue(t?.prefix || ""),
            plcName: normalizeTopicValue(t?.plcName || t?.plc || ""),
            samplingInterval: parseOptionalMs(t?.samplingInterval),
            enabled: t?.enabled !== false,
          }))
          .filter((t) => t.name);
        const loadedConfig = {
          ...data,
          runtime: normalizeRuntimeConfig(data?.runtime),
          tags: cleanedTags,
          topics: cleanedTopics,
          plcs: cleanedPlcs,
        };
        setConfig(loadedConfig);
        lastSavedRef.current = JSON.stringify(loadedConfig);
        setTimeout(() => {
          autoSaveReadyRef.current = true;
        }, 0);
      } catch (err) {
        setError(err?.message || "Failed to load.");
        setTimeout(() => {
          autoSaveReadyRef.current = true;
        }, 0);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!autoSaveReadyRef.current) return;
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
  }, [config]);

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
              uaType: "",
              pollMs: "",
              samplingInterval: "",
              topic: "",
              enabled: true,
              mappingSet: "",
              scale: 1,
              decimals: 0,
            };
          }
          return {
            name: f?.name || "",
            tagPath: f?.tagPath || "",
            uaType: f?.uaType || "",
            pollMs: f?.pollMs ?? "",
            samplingInterval: f?.samplingInterval ?? "",
            topic: f?.topic || "",
            enabled: f?.enabled !== false,
            mappingSet: String(f?.mappingSet || ""),
            scale: Number.isFinite(Number(f?.scale)) ? Number(f.scale) : 1,
            decimals: Number.isFinite(Number(f?.decimals)) ? Number(f.decimals) : 0,
          };
        })
      : [];
    setTemplateFieldRows(
      nextFields.length
        ? nextFields
        : [{ name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true, mappingSet: "", scale: 1, decimals: 0 }]
    );
    const nextMappings = Array.isArray(tmpl.state_mappings)
      ? tmpl.state_mappings.map((m) => ({
          field: String(m?.field ?? ""),
          state: String(m?.state ?? ""),
          color: String(m?.color ?? ""),
        }))
      : [];
    setTemplateStateMappings(
      nextMappings.length ? nextMappings : [{ field: "", state: "", color: "" }]
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
        // ignore
      }
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

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

  const plcs = useMemo(() => config.plcs || [], [config.plcs]);
  const topics = useMemo(() => config.topics || [], [config.topics]);
  const tags = useMemo(() => config.tags || [], [config.tags]);

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
    const groups = new Map();
    (tags || []).forEach((tag, idx) => {
      const name = normalizeTagName(tag?.name || "");
      const tagPath = normalizeTagName(tag?.tagPath || "");
      const groupRaw = normalizeTagName(tag?.groupName || "");
      if (!name && !tagPath && !groupRaw) return;
      const topicKey = normalizeTagName(tag?.topic || "") || "No Topic";
      const fallbackGroup = name && name.includes(".") ? name.split(".")[0] : "";
      const groupKey = groupRaw || fallbackGroup || "Ungrouped";
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
  }, [tags]);

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
    const rows = Array.isArray(set?.mappings)
      ? set.mappings.map((m) => ({
          field: String(m?.field ?? "State Text"),
          state: String(m?.state ?? ""),
          color: String(m?.color ?? ""),
        }))
      : [];
    setMappingSetRows(rows.length ? rows : [{ field: "", state: "", color: "" }]);
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
      if (!n || visited.has(n)) return;
      visited.add(n);
      const tmpl = templateMap.get(n);
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
            uaType: uaTypeVal,
            pollMs: pollMsVal,
            samplingInterval: samplingVal,
            topic: topicVal,
            enabled: enabledVal,
            mappingSet: mappingSetVal,
            scale: scaleVal,
            decimals: decimalsVal,
          });
        });
      }
    }
    walk(name);
    return fields;
  }

  function updateTag(idx, key, value) {
    setConfig((prev) => {
      const next = [...(prev.tags || [])];
      next[idx] = { ...next[idx], [key]: value };
      return { ...prev, tags: next };
    });
  }

  function addTag() {
    const defaultTopic = (topics || [])[0]?.name || "";
    setConfig((prev) => ({
      ...prev,
      tags: [...(prev.tags || []), { name: "", tagPath: "", uaType: "", topic: defaultTopic, enabled: true }],
    }));
  }

  function buildCleanedTags(tags) {
    return (tags || [])
      .map((t) => {
        const name = normalizeTagName(t.name);
        const tagPath = normalizeTagName(t.tagPath || name);
        const topic = normalizeTagName(t.topic || "");
        const groupName = normalizeTagName(t.groupName || "");
        const samplingInterval = parseOptionalMs(t?.samplingInterval);
        const pollMs = parseOptionalMs(t?.pollMs);
        const deadband = parseOptionalNonNegative(t?.deadband);
        const scale = Number.isFinite(Number(t?.scale)) ? Number(t.scale) : 1;
        const decimals = Number.isFinite(Number(t?.decimals)) ? Number(t.decimals) : 0;
        return {
          ...t,
          name,
          tagPath,
          topic,
          groupName,
          pollMs,
          scale,
          decimals,
          samplingInterval,
          deadband,
          muted: t?.muted === true,
          mappingSet: t?.mappingSet || "",
        };
      })
      .filter((t) => t.name);
  }

  function buildCleanedPlcs(plcs) {
    return (plcs || [])
      .map((p, idx) => {
        const id = String(p?.id || makeId());
        const name = normalizeTopicValue(p?.name || `PLC-${idx + 1}`);
        const host = normalizeTopicValue(p?.host || "");
        const slot = Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0;
        const pollMs = parseOptionalMs(p?.pollMs);
        return { ...p, id, name, host, slot, pollMs };
      })
      .filter((p) => p.name);
  }

  function buildCleanedTopics(topics) {
    return (topics || [])
      .map((t) => {
        const name = normalizeTopicValue(t?.name || "");
        const prefix = normalizeTopicValue(t?.prefix || "");
        const plcName = normalizeTopicValue(t?.plcName || t?.plc || "");
        const samplingInterval = parseOptionalMs(t?.samplingInterval);
        return { ...t, name, prefix, plcName, samplingInterval, enabled: t?.enabled !== false };
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
        .map((row) => ({
          field: String(row?.field ?? "State Text").trim() || "State Text",
          state: String(row?.state ?? "").trim(),
          color: String(row?.color ?? "").trim(),
        }))
        .filter((row) => row.state && row.color);
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
    setManualTag({ name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true, muted: false, mappingSet: "", groupName: "", deadband: "" });
    setManualTagMappings([{ field: "", state: "", color: "" }]);
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

  async function requestRestart() {
    setError("");
    setStatus("");
    try {
      setRestartPending(true);
      const res = await fetch("/api/opc/restart", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Restart failed.");
      setStatus(data?.message || "Restart requested.");
      setTimeout(() => {
        setStatus((prev) => (prev && prev.toLowerCase().includes("restart") ? "" : prev));
      }, 4000);
      setTimeout(() => setRestartPending(false), 8000);
    } catch (err) {
      setError(err?.message || "Restart failed.");
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
      }))
      .filter((row) => row.name || row.tagPath);
    const stateMappings = (templateStateMappings || [])
      .map((row) => ({
        field: String(row?.field ?? "").trim(),
        state: String(row?.state ?? "").trim(),
        color: String(row?.color ?? "").trim(),
      }))
      .filter((row) => row.state && row.color);
    const parentName = String(templateParent || "").trim();
    if (!name || !fields.length) {
      setError("Template name and fields required.");
      return;
    }
    if (parentName && parentName === name) {
      setError("Template cannot extend itself.");
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
      setStatus("Template saved.");
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
      setStatus("Template deleted.");
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
    const fields = resolveTemplateFields(applyTemplate);
    if (!fields.length) {
      setError("Template has no fields.");
      return;
    }
    const newTags = fields.map((f) => {
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
        groupName: prefix,
        plcType: applyTemplate,
        uaType: fieldUaType,
        pollMs: fieldPollMs,
        samplingInterval: fieldSampling,
        enabled: fieldEnabled,
        mappingSet: fieldMappingSet || String(applyMappingSet || "").trim(),
        scale: fieldScale,
        decimals: fieldDecimals,
      };
    });
    const nextTags = [...(config.tags || []), ...newTags];
    const cleanedTags = buildCleanedTags(nextTags);
    const nextConfig = { ...config, tags: cleanedTags };
    setConfig(nextConfig);
    persistConfig(nextConfig, `Added ${newTags.length} tags from template.`).catch((err) => {
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
              onClick={() => setErrorLogEntries([])}
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
                <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {entry.tag}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                  <span style={{ color: entry.kind === "error" ? "#b42318" : "#027a48", fontWeight: 600 }}>
                    {entry.kind === "error" ? `err ${entry.count}` : "cleared"}
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

  function renderTagDiagnosticsCard() {
    const entries = Object.entries(liveDiagnostics || {});
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
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{entries.length} tags</div>
        </div>
        {entries.length === 0 ? (
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
                  <th style={{ textAlign: "left", padding: "6px 8px" }} title="Most recent read error message for this tag.">Last Error</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 400).map(([key, d]) => (
                  <tr key={`diag-${key}`} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "6px 8px" }}>{key}</td>
                    <td style={{ padding: "6px 8px" }}>{liveQualities?.[key] || "Unknown"}</td>
                    <td style={{ padding: "6px 8px" }}>{Number(d?.errorStreak || 0)}</td>
                    <td style={{ padding: "6px 8px" }}>{d?.effectiveIntervalMs ?? ""}</td>
                    <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{d?.lastErrorMessage || ""}</td>
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
    ? { width: "100%" }
    : { width: "100%", maxWidth: 1400, margin: "0 auto" };
  const isTagsOnly = mode === "tags" || mode === "logs";

  function renderTagsPanel() {
    const activeTagTab = mode === "logs" ? "logs" : tagSectionTab;
    const sectionCardStyle = {
      border: "1px solid var(--border)",
      background: "var(--bg-elev)",
      borderRadius: 12,
      padding: 12,
      boxShadow: "0 1px 2px rgba(16,24,40,0.06)",
    };
    const drawerButtonStyle = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
    };
    const showDrawerViewButtons = typeof onDrawerViewChange === "function";
    return (
      <div style={{ flex: "1 1 auto", overflow: "auto", padding: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 0, flexWrap: "wrap" }}>
            <div
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                background:
                  restartPending
                    ? "#fff6ed"
                    : opcConnected === true
                    ? "#ecfdf3"
                    : opcConnected === false
                    ? "#fef3f2"
                    : "#f2f4f7",
                color:
                  restartPending
                    ? "#b54708"
                    : opcConnected === true
                    ? "#027a48"
                    : opcConnected === false
                    ? "#b42318"
                    : "var(--text-muted)",
                border:
                  restartPending
                    ? "1px solid #fed7aa"
                    : opcConnected === true
                    ? "1px solid #abefc6"
                    : opcConnected === false
                    ? "1px solid #fecdca"
                    : "1px solid var(--border)",
              }}
            >
              {restartPending
                ? "Restarting..."
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
        </div>
        {showDrawerViewButtons ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => onDrawerViewChange("opc")}
              style={{
                ...drawerButtonStyle,
                border: "1px solid var(--border)",
                background: mode === "logs" ? "var(--bg-soft)" : "#2b6cff",
                color: mode === "logs" ? "var(--text)" : "white",
                borderRadius: 999,
                padding: "6px 12px",
                fontWeight: 600,
              }}
            >
              Config
            </button>
            <button
              onClick={() => onDrawerViewChange("logs")}
              style={{
                ...drawerButtonStyle,
                border: "1px solid var(--border)",
                background: mode === "logs" ? "#2b6cff" : "var(--bg-soft)",
                color: mode === "logs" ? "white" : "var(--text)",
                borderRadius: 999,
                padding: "6px 12px",
                fontWeight: 600,
              }}
            >
              Logs
            </button>
            <button
              onClick={() => {
                setOpcConfigSectionTab("diagnostics");
                if (mode === "logs") onDrawerViewChange("opc");
              }}
              style={{
                ...drawerButtonStyle,
                border: "1px solid var(--border)",
                background: mode !== "logs" && opcConfigSectionTab === "diagnostics" ? "#2b6cff" : "var(--bg-soft)",
                color: mode !== "logs" && opcConfigSectionTab === "diagnostics" ? "white" : "var(--text)",
                borderRadius: 999,
                padding: "6px 12px",
                fontWeight: 600,
              }}
            >
              Diagnostics
            </button>
          </div>
        ) : null}
        {mode !== "logs" ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setTagSectionTab("tags")}
            style={{
              ...drawerButtonStyle,
              border: "1px solid var(--border)",
              background: tagSectionTab === "tags" ? "#2b6cff" : "var(--bg-soft)",
              color: tagSectionTab === "tags" ? "white" : "var(--text)",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
            }}
          >
            Tags
          </button>
          <button
            onClick={() => setTagSectionTab("templates")}
            style={{
              ...drawerButtonStyle,
              border: "1px solid var(--border)",
              background: tagSectionTab === "templates" ? "#2b6cff" : "var(--bg-soft)",
              color: tagSectionTab === "templates" ? "white" : "var(--text)",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
            }}
          >
            Templates
          </button>
          <button
            onClick={() => setTagSectionTab("mappings")}
            style={{
              ...drawerButtonStyle,
              border: "1px solid var(--border)",
              background: tagSectionTab === "mappings" ? "#2b6cff" : "var(--bg-soft)",
              color: tagSectionTab === "mappings" ? "white" : "var(--text)",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
            }}
          >
            Mappings
          </button>
          <button
            onClick={() => setTagSectionTab("logs")}
            style={{
              ...drawerButtonStyle,
              border: "1px solid var(--border)",
              background: tagSectionTab === "logs" ? "#2b6cff" : "var(--bg-soft)",
              color: tagSectionTab === "logs" ? "white" : "var(--text)",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
            }}
          >
            Logs
          </button>
          <button
            onClick={() => setTagSectionTab("diagnostics")}
            style={{
              ...drawerButtonStyle,
              border: "1px solid var(--border)",
              background: tagSectionTab === "diagnostics" ? "#2b6cff" : "var(--bg-soft)",
              color: tagSectionTab === "diagnostics" ? "white" : "var(--text)",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
            }}
          >
            Diagnostics
          </button>
        </div>
        ) : null}
        {activeTagTab === "tags" ? (
          <>
            <div style={{ ...sectionCardStyle, marginBottom: 10, background: "var(--bg-soft)" }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Columns</div>
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
            </div>
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
                              X
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
                      setManualTagMappings((prev) => [...prev, { field: "State Text", state: "", color: "" }])
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
                <button onClick={addManualTag} style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}>
                  Add Tag
                </button>
                <button
                  onClick={() => {
                    setManualTag({ name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true, mappingSet: "" });
                    setShowManualTagForm(false);
                  }}
                  style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                >
                  Cancel
                </button>
              </div>
            </div>
        ) : null}
            <div style={{ ...sectionCardStyle, display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, marginBottom: 10, alignItems: "end" }}>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                Template
                <select
                  value={applyTemplate}
                  onChange={(e) => setApplyTemplate(e.target.value)}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                >
                  <option value="">Select template</option>
                  {templates.map((t) => (
                    <option key={`opt-${t.name}`} value={t.name}>
                      {t.parent_name ? `${t.name} (extends ${t.parent_name})` : t.name}
                    </option>
                  ))}
                </select>
              </label>
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
                Add From Template
              </button>
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
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 10,
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
            <div style={{ ...sectionCardStyle, marginTop: 10, maxHeight: 520, overflow: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 8 }}>
                <button
                  onClick={addTagFromToolbar}
                  style={{
                    ...drawerButtonStyle,
                    border: "1px solid #2b6cff",
                    background: "var(--bg-elev)",
                    color: "#2b6cff",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                >
                  Add Tag
                </button>
              </div>
              {tags.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No tags.</div>
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
                                style={{
                                  ...drawerButtonStyle,
                                  border: "1px solid #2b6cff",
                                  background: "var(--bg-elev)",
                                  color: "#2b6cff",
                                  borderRadius: 6,
                                  padding: "4px 8px",
                                  marginLeft: 10,
                                }}
                              >
                                Add Tag
                              </button>
                            </td>
                          </tr>
                          {topicExpanded
                            ? group.groups.map((tagGroup) => {
                                const groupName = tagGroup.groupName ?? "Ungrouped";
                                const groupExpanded =
                                  expandedPrefixes[`topic:${topicKey}::group:${groupName}`] ?? true;
                                return (
                                  <Fragment key={`group-${topicKey}-${groupName}`}>
                                    <tr
                                      style={{ borderTop: "1px solid var(--border)", background: "var(--bg-soft)" }}
                                      onMouseDown={() => {
                                        setActiveTagGroup({ topic: topicKey, groupName });
                                      }}
                                    >
                                      <td colSpan={visibleTagColumnCount} style={{ padding: "6px 28px" }}>
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
                                        <span style={{ fontWeight: 600 }}>{groupName}</span>
                                        <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
                                          {tagGroup.items.length} tags
                                        </span>
                                        <button
                                          onClick={() => {
                                            setActiveTagGroup({ topic: topicKey, groupName });
                                            addTagToGroup(topicKey, groupName);
                                          }}
                                          style={{
                                            ...drawerButtonStyle,
                                            border: "1px solid #2b6cff",
                                            background: "var(--bg-elev)",
                                            color: "#2b6cff",
                                            borderRadius: 6,
                                            padding: "4px 8px",
                                            marginLeft: 10,
                                          }}
                                        >
                                          Add Tag
                                        </button>
                                      </td>
                                    </tr>
                                    {groupExpanded
                                      ? tagGroup.items.map(({ tag: t, idx }) => {
                                          const rowEditing = tagTableEditing && editingTagIndex === idx;
                                        return (
                                          <Fragment key={`tag-row-${idx}`}>
                                          <tr style={{ borderTop: "1px solid var(--border)" }}>
                                            {showTagColumn("enabled") ? (
                                              <td style={{ padding: "8px 16px 8px 10px" }}>
                                                <input
                                                  type="checkbox"
                                                  checked={t.enabled !== false}
                                                  onChange={(e) => updateTag(idx, "enabled", e.target.checked)}
                                                  disabled={!rowEditing}
                                                />
                                              </td>
                                            ) : null}
                                            {showTagColumn("muted") ? (
                                              <td style={{ padding: "8px 16px 8px 10px" }}>
                                                <input
                                                  type="checkbox"
                                                  checked={t.muted === true}
                                                  onChange={(e) => updateTag(idx, "muted", e.target.checked)}
                                                  disabled={!rowEditing}
                                                />
                                              </td>
                                            ) : null}
                                            {showTagColumn("name") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {(() => {
                                                  const group = String(t.groupName || "").trim();
                                                  const name = String(t.name || "").trim();
                                                  if (group && name.startsWith(`${group}.`)) {
                                                    return name.slice(group.length + 1);
                                                  }
                                                  return name;
                                                })()}
                                              </td>
                                            ) : null}
                                            {showTagColumn("topic") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text-muted)" }}>
                                                {t.topic || ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("tagPath") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {t.tagPath || ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("uaType") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {t.uaType || ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("pollMs") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {Number.isFinite(Number(t.pollMs)) ? Number(t.pollMs) : ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("samplingInterval") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {Number.isFinite(Number(t.samplingInterval)) ? Number(t.samplingInterval) : ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("mappingSet") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {t.mappingSet || ""}
                                              </td>
                                            ) : null}
                                            {showTagColumn("scale") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {Number.isFinite(Number(t.scale)) ? Number(t.scale) : 1}
                                              </td>
                                            ) : null}
                                            {showTagColumn("decimals") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {Number.isFinite(Number(t.decimals)) ? Number(t.decimals) : 0}
                                              </td>
                                            ) : null}
                                            {showTagColumn("quality") ? (
                                              <td style={{ padding: "8px 16px 8px 10px", color: "var(--text)" }}>
                                                {String(getLiveValueForTag(liveQualities, t) || (t.muted ? "Muted" : "Unknown"))}
                                              </td>
                                            ) : null}
                                            {showTagColumn("liveValue")
                                              ? (() => {
                                                  const scale = Number.isFinite(Number(t.scale)) ? Number(t.scale) : 1;
                                                  const decimals = Number.isFinite(Number(t.decimals)) ? Number(t.decimals) : 0;
                                                  const rawValue = getLiveValueForTag(liveValues, t);
                                                  const scaledValue =
                                                    rawValue != null && rawValue !== "" && !Number.isNaN(Number(rawValue))
                                                      ? Number(rawValue) * scale
                                                      : rawValue;
                                                  const errorCount = Number(getLiveValueForTag(liveErrors, t) || 0);
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
                                                      <span
                                                        style={{
                                                          color:
                                                            t.enabled === false
                                                              ? "#b42318"
                                                              : "var(--text)",
                                                        }}
                                                      >
                                                        {t.enabled === false
                                                          ? "Disabled"
                                                          : formatLiveNumber(scaledValue, decimals)}
                                                      </span>
                                                  {errorCount > 0 ? (
                                                    <span style={{ color: "#b42318", marginLeft: 8 }}>
                                                      (err {errorCount})
                                                    </span>
                                                  ) : null}
                                                    </td>
                                                  );
                                                })()
                                              : null}
                                            {showTagColumn("actions") ? (
                                              <td style={{ padding: "8px 10px" }}>
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
                                                  <span />
                                                </div>
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
                                                  </div>
                                                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
                                                    <button
                                                      onClick={saveTagRow}
                                                      style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}
                                                    >
                                                      Save
                                                    </button>
                                                    <button
                                                      onClick={() => removeTag(idx)}
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
                                        })
                                      : null}
                                  </Fragment>
                                );
                              })
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
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Create / Edit Template</div>
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
                    setTemplateFieldRows([{ name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true, mappingSet: "", scale: 1, decimals: 0 }]);
                    setTemplateStateMappings([{ field: "", state: "", color: "" }]);
                    setTemplateEditing(true);
                  }
                }}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                  >
                    <option value="">New template</option>
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
                      setTemplateFieldRows([{ name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true, mappingSet: "", scale: 1, decimals: 0 }]);
                      setTemplateStateMappings([{ field: "", state: "", color: "" }]);
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
                      setTemplateFieldRows([{ name: "", tagPath: "", mappingSet: "", scale: 1, decimals: 0 }]);
                      setTemplateStateMappings([{ field: "", state: "", color: "" }]);
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
                  Template Name
                  <input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                    disabled={!templateEditing}
                  />
                </label>
                <label style={{ display: "grid", gap: 8, fontSize: 12 }}>
                  Parent Template
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
              <div style={{ fontSize: 12, marginBottom: 8 }}>Fields</div>
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflowX: "auto", overflowY: "auto", maxHeight: 320, padding: "4px 12px 4px 0", boxSizing: "border-box" }}>
                <table style={{ width: 1200, tableLayout: "fixed", borderCollapse: "separate", borderSpacing: "0 6px", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "13%" }} />
                    <col style={{ width: "15%" }} />
                    <col style={{ width: "15%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "9%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "8%" }} />
                    <col style={{ width: "10%" }} />
                    <col style={{ width: "4%" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: "var(--bg-soft)" }}>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Tag Path</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>UA Type</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Poll</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Sampling</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Topic</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Enabled</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Scale</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Decimals</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Mapping Set</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {templateFieldRows.map((row, idx) => (
                      <tr key={`field-${idx}`}>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            value={row.name || ""}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], name: e.target.value };
                                return next;
                              })
                            }
                            placeholder="Display name"
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
                          />
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            value={row.tagPath || ""}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], tagPath: e.target.value };
                                return next;
                              })
                            }
                            placeholder="Controller tag path"
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
                          />
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <select
                            value={row.uaType || ""}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], uaType: e.target.value };
                                return next;
                              })
                            }
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
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
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            value={row.pollMs ?? ""}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], pollMs: e.target.value };
                                return next;
                              })
                            }
                            placeholder="ms"
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
                          />
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            value={row.samplingInterval ?? ""}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], samplingInterval: e.target.value };
                                return next;
                              })
                            }
                            placeholder="ms"
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
                          />
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            value={row.topic || ""}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], topic: e.target.value };
                                return next;
                              })
                            }
                            placeholder="Optional"
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
                          />
                        </td>
                        <td style={{ padding: "8px 10px 8px 10px" }}>
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={row.enabled !== false}
                              onChange={(e) =>
                                setTemplateFieldRows((prev) => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], enabled: e.target.checked };
                                  return next;
                                })
                              }
                              disabled={!templateEditing}
                            />
                          </label>
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            type="number"
                            step="any"
                            value={row.scale ?? 1}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], scale: e.target.value };
                                return next;
                              })
                            }
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
                          />
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={row.decimals ?? 4}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], decimals: e.target.value };
                                return next;
                              })
                            }
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
                          />
                        </td>
                        <td style={{ padding: "8px 16px 8px 10px" }}>
                          <select
                            value={row.mappingSet || ""}
                            onChange={(e) =>
                              setTemplateFieldRows((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], mappingSet: e.target.value };
                                return next;
                              })
                            }
                            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
                            disabled={!templateEditing}
                          >
                            <option value="">None</option>
                            {mappingSets.map((s) => (
                              <option key={`tmpl-map-${s.name}`} value={s.name}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "8px 10px 8px 14px" }}>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <button
                              onClick={() =>
                                setTemplateFieldRows((prev) => prev.filter((_, i) => i !== idx))
                              }
                              style={{ ...drawerButtonStyle, width: 28, height: 28, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8 }}
                              disabled={!templateEditing}
                            >
                              X
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {templateFieldRows.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ padding: "8px", color: "var(--text-muted)" }}>
                          No fields yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button
                  onClick={() =>
                    setTemplateFieldRows((prev) => [
                      ...prev,
                      { name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true, mappingSet: "", scale: 1, decimals: 0 },
                    ])
                  }
                  style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                >
                  Add Tag
                </button>
                <button
                  onClick={saveTemplate}
                  style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}
                  disabled={!templateEditing}
                >
                  Save Template
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
                    setTemplateFieldRows([{ name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true, mappingSet: "", scale: 1, decimals: 0 }]);
                    setTemplateStateMappings([{ field: "", state: "", color: "" }]);
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
                        setMappingSetRows([{ field: "", state: "", color: "" }]);
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
                      setMappingSetRows([{ field: "", state: "", color: "" }]);
                    }}
                    style={{ ...drawerButtonStyle, border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 8, padding: "6px 10px" }}
                  >
                    New Set
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
                        setMappingSetRows([{ field: "", state: "", color: "" }]);
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
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>State Text</th>
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
                            X
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
                      { field: "State Text", state: "", color: "" },
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
                      .map((row) => ({
                        field: String(row?.field ?? "State Text").trim() || "State Text",
                        state: String(row?.state ?? "").trim(),
                        color: String(row?.color ?? "").trim(),
                      }))
                      .filter((row) => row.state && row.color);
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
                        cleaned.length ? cleaned : [{ field: "", state: "", color: "" }]
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

  if (isTagsOnly) {
    return (
      <div style={outerStyle}>
        <div style={innerStyle}>
          <div style={contentStyle}>
            {renderTagsPanel()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={outerStyle}>
      <div style={innerStyle}>
        <div style={contentStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
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
                    : opcConnected === true
                    ? "#ecfdf3"
                    : opcConnected === false
                    ? "#fef3f2"
                    : "#f2f4f7",
                color:
                  restartPending
                    ? "#b54708"
                    : opcConnected === true
                    ? "#027a48"
                    : opcConnected === false
                    ? "#b42318"
                    : "var(--text-muted)",
                border:
                  restartPending
                    ? "1px solid #fed7aa"
                    : opcConnected === true
                    ? "1px solid #abefc6"
                    : opcConnected === false
                    ? "1px solid #fecdca"
                    : "1px solid var(--border)",
              }}
            >
              {restartPending
                ? "Restarting..."
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
          {null}
        </div>
        {typeof onDrawerViewChange === "function" ? (
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => onDrawerViewChange("opc")}
              style={{
                border: "1px solid var(--border)",
                background: "#2b6cff",
                color: "white",
                borderRadius: 999,
                padding: "6px 12px",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
              }}
            >
              Config
            </button>
            <button
              onClick={() => onDrawerViewChange("logs")}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-soft)",
                color: "var(--text)",
                borderRadius: 999,
                padding: "6px 12px",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
              }}
            >
              Logs
            </button>
          </div>
        ) : null}

        {error && <div style={{ color: "#b42318", marginBottom: 10 }}>{error}</div>}
        {status && <div style={{ color: "#12b76a", marginBottom: 10 }}>{status}</div>}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setOpcConfigSectionTab("opcua")}
            style={{
              border: "1px solid var(--border)",
              background: opcConfigSectionTab === "opcua" ? "#2b6cff" : "#f9fafb",
              color: opcConfigSectionTab === "opcua" ? "white" : "#111",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontSize: 12,
            }}
          >
            OPC UA
          </button>
          <button
            onClick={() => setOpcConfigSectionTab("plcs")}
            style={{
              border: "1px solid var(--border)",
              background: opcConfigSectionTab === "plcs" ? "#2b6cff" : "#f9fafb",
              color: opcConfigSectionTab === "plcs" ? "white" : "#111",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontSize: 12,
            }}
          >
            PLC Instances
          </button>
          <button
            onClick={() => setOpcConfigSectionTab("topics")}
            style={{
              border: "1px solid var(--border)",
              background: opcConfigSectionTab === "topics" ? "#2b6cff" : "#f9fafb",
              color: opcConfigSectionTab === "topics" ? "white" : "#111",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              fontSize: 12,
            }}
          >
            PLC Topics
          </button>
          {typeof onDrawerViewChange !== "function" ? (
            <button
              onClick={() => setOpcConfigSectionTab("diagnostics")}
              style={{
                border: "1px solid var(--border)",
                background: opcConfigSectionTab === "diagnostics" ? "#2b6cff" : "#f9fafb",
                color: opcConfigSectionTab === "diagnostics" ? "white" : "#111",
                borderRadius: 999,
                padding: "6px 12px",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                fontSize: 12,
              }}
            >
              Diagnostics
            </button>
          ) : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, flex: "1 1 0", minHeight: 0 }}>
          {opcConfigSectionTab === "opcua" ? (
          <div style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>OPC UA</div>
            <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 10 }}>
              Port
              <input
                type="number"
                value={config.opcua?.port ?? 4840}
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
                onChange={(e) => setConfig((p) => ({ ...p, opcua: { ...p.opcua, name: e.target.value } }))}
                style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
              />
            </label>
            <div style={{ fontWeight: 700, marginBottom: 8, marginTop: 4 }} title="Live OPC poller behavior and resiliency settings.">
              Runtime
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Maximum wait for a PLC read before marking it as timeout/error.">
                Read Timeout (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.readTimeoutMs ?? 2000}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), readTimeoutMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Heartbeat check interval used to verify PLC connection health.">
                Heartbeat (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.heartbeatMs ?? 5000}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), heartbeatMs: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 12 }} title="Delay between PLC reconnect attempts after disconnect or failed heartbeat.">
                Reconnect Delay (ms)
                <input
                  type="number"
                  min="100"
                  value={config.runtime?.reconnectDelayMs ?? 2000}
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
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), deadbandDefault: e.target.value } }))}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, gridColumn: "1 / span 2" }} title="Enable dynamic slowdown after repeated tag read failures.">
                <input
                  type="checkbox"
                  checked={config.runtime?.errorBackoffEnabled !== false}
                  onChange={(e) => setConfig((p) => ({ ...p, runtime: { ...normalizeRuntimeConfig(p.runtime), errorBackoffEnabled: e.target.checked } }))}
                />
                Enable Error Backoff
              </label>
            </div>
            <div style={{ marginTop: "auto", display: "flex", gap: 8, paddingTop: 10 }}>
              <button onClick={saveConfig} style={{ border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 10, padding: "8px 12px" }}>
                Save Config
              </button>
              <button onClick={requestRestart} style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", borderRadius: 10, padding: "8px 12px" }}>
                Restart OPC Server
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
                            X
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
              {(!config.topics || config.topics.length === 0) ? (
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
                    {(config.topics || []).map((topic, idx) => (
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
                            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", textAlign: "center", width: 28, height: 28, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8 }}
                          >
                            X
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
        </div>
      </div>
    </div>
  </div>
  );
}




