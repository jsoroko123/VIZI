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

export default function OpcConfig({ embedded = false, mode = "full" }) {
  const [config, setConfig] = useState({
    plc: { host: "", slot: 0 },
    plcs: [],
    opcua: { port: 4840, resourcePath: "/UA/ControlLogix", name: "ControlLogix" },
    pollMs: 500,
    topics: [],
    tags: [],
  });
  const [csvText, setCsvText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [liveValues, setLiveValues] = useState({});
  const [liveErrors, setLiveErrors] = useState({});
  const [opcConnected, setOpcConnected] = useState(null);
  const [opcLastPollAt, setOpcLastPollAt] = useState(null);
  const [restartPending, setRestartPending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [templateFieldRows, setTemplateFieldRows] = useState([{ name: "", tagPath: "" }]);
  const [templateParent, setTemplateParent] = useState("");
  const [applyTemplate, setApplyTemplate] = useState("");
  const [applyTopic, setApplyTopic] = useState("");
  const [applyPrefix, setApplyPrefix] = useState("");
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
  });
  const [showManualTagForm, setShowManualTagForm] = useState(false);
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [manualTopic, setManualTopic] = useState({
    name: "",
    prefix: "",
    plcName: "",
    samplingInterval: "",
    enabled: true,
  });
  const [showPlcForm, setShowPlcForm] = useState(false);
  const [manualPlc, setManualPlc] = useState({
    name: "",
    host: "",
    slot: "",
    pollMs: "",
  });
  const autoSaveTimerRef = useRef(null);
  const autoSaveReadyRef = useRef(false);
  const lastSavedRef = useRef("");
  const drawerMenuRef = useRef(null);
  const drawerMenuBtnRef = useRef(null);

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
            const samplingInterval = Number.isFinite(Number(t?.samplingInterval))
              ? Number(t.samplingInterval)
              : "";
            return { ...t, name, tagPath, topic, samplingInterval };
          })
          .filter((t) => t.name);
        const cleanedPlcs = Array.isArray(data.plcs) && data.plcs.length
          ? data.plcs
              .map((p, idx) => ({
                id: String(p?.id || makeId()),
                name: normalizeTopicValue(p?.name || `PLC-${idx + 1}`),
                host: normalizeTopicValue(p?.host || ""),
                slot: Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0,
                pollMs: Number.isFinite(Number(p?.pollMs)) ? Number(p.pollMs) : "",
              }))
              .filter((p) => p.name)
          : data?.plc?.host
          ? [
              {
                id: makeId(),
                name: normalizeTopicValue(data?.plc?.name || "PLC-1"),
                host: normalizeTopicValue(data?.plc?.host || ""),
                slot: Number.isFinite(Number(data?.plc?.slot)) ? Number(data.plc.slot) : 0,
                pollMs: Number.isFinite(Number(data?.pollMs)) ? Number(data.pollMs) : "",
              },
            ]
          : [];
        const cleanedTopics = (data.topics || [])
          .map((t) => ({
            name: normalizeTopicValue(t?.name || ""),
            prefix: normalizeTopicValue(t?.prefix || ""),
            plcName: normalizeTopicValue(t?.plcName || t?.plc || ""),
            samplingInterval: Number.isFinite(Number(t?.samplingInterval))
              ? Number(t.samplingInterval)
              : "",
            enabled: t?.enabled !== false,
          }))
          .filter((t) => t.name);
        const loadedConfig = { ...data, tags: cleanedTags, topics: cleanedTopics, plcs: cleanedPlcs };
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
      const nextConfig = { ...config, tags: cleanedTags, topics: cleanedTopics, plcs: cleanedPlcs };
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
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/opc/status");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load status.");
        if (alive) {
          setLiveValues(data.values || {});
          setLiveErrors(data.errors || {});
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
      if (!name) return;
      const groupKey = normalizeTagName(tag?.topic || "") || "No Topic";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push({ tag: { ...tag, name }, idx });
    });
    return Array.from(groups.entries());
  }, [tags]);

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

  function getTagKey(tag) {
    const topicName = normalizeTagName(tag?.topic || "");
    return topicName ? `${topicName}.${tag?.name || ""}` : tag?.name || "";
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
            fields.push({ name: key, tagPath: key });
            return;
          }
          const nameVal = String(f?.name || "").trim();
          const tagPathVal = String(f?.tagPath || "").trim();
          const key = tagPathVal || nameVal;
          if (!key) return;
          fields = fields.filter((x) => (x.tagPath || x.name) !== key);
          fields.push({ name: nameVal || key, tagPath: tagPathVal || nameVal || key });
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
        const samplingInterval = Number.isFinite(Number(t?.samplingInterval))
          ? Number(t.samplingInterval)
          : "";
        return { ...t, name, tagPath, topic, samplingInterval };
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
        const pollMs = Number.isFinite(Number(p?.pollMs)) ? Number(p.pollMs) : "";
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
        const samplingInterval = Number.isFinite(Number(t?.samplingInterval))
          ? Number(t.samplingInterval)
          : "";
        return { ...t, name, prefix, plcName, samplingInterval, enabled: t?.enabled !== false };
      })
      .filter((t) => t.name);
  }

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

  function addManualTag() {
    const name = String(manualTag.name || "").trim();
    const tagPath = String(manualTag.tagPath || name).trim();
    const topic = String(manualTag.topic || "").trim();
    const samplingInterval =
      manualTag.samplingInterval === "" || manualTag.samplingInterval === null
        ? undefined
        : Number(manualTag.samplingInterval);
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
        uaType: String(manualTag.uaType || "").trim(),
        pollMs: manualTag.pollMs !== "" ? Number(manualTag.pollMs) : undefined,
        samplingInterval: Number.isFinite(Number(samplingInterval)) ? Number(samplingInterval) : undefined,
        enabled: manualTag.enabled !== false,
      },
    ];
    const cleanedTags = buildCleanedTags(nextTags);
    const nextConfig = { ...config, tags: cleanedTags };
    setConfig(nextConfig);
    persistConfig(nextConfig, "Tag saved.").catch((err) => {
      setError(err?.message || "Save failed.");
    });
    setManualTag({ name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true });
    setShowManualTagForm(false);
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
      const cleanedTags = buildCleanedTags(config.tags);
      const cleanedTopics = buildCleanedTopics(config.topics);
      const cleanedPlcs = buildCleanedPlcs(config.plcs);
      const nextConfig = { ...config, tags: cleanedTags, topics: cleanedTopics, plcs: cleanedPlcs };
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
      }))
      .filter((row) => row.name || row.tagPath);
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
        body: JSON.stringify({ name, fields, parent_name: parentName || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed.");
      setStatus("Template saved.");
      const reload = await fetch("/api/opc/templates");
      const payload = await reload.json();
      if (reload.ok) setTemplates(payload.templates || []);
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
      return {
        name,
        tagPath,
        topic: applyTopic,
        plcType: "",
        uaType: "",
        enabled: true,
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

  const outerStyle = embedded
    ? { width: "100%", height: "100%", background: "transparent", color: "#111" }
    : { minHeight: "100vh", background: "#f7f8fb", color: "#111" };
  const innerStyle = embedded
    ? { width: "100%", height: "100%", padding: 16, boxSizing: "border-box", display: "flex", flexDirection: "column" }
    : { width: "100%", minHeight: "100vh", padding: "24px 24px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column" };
  const contentStyle = embedded
    ? { width: "100%" }
    : { width: "100%", maxWidth: 1400, margin: "0 auto" };
  const isTagsOnly = mode === "tags";

  function renderTagsPanel() {
    const sectionCardStyle = {
      border: "1px solid #e4e7ec",
      background: "white",
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
    return (
      <div style={{ flex: "1 1 auto", overflow: "auto", padding: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, color: "#344054" }}>Tags</div>
          <div style={{ fontSize: 12, color: "#667085" }}>Manage tag lists and templates for the OPC server.</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setTagSectionTab("tags")}
            style={{
              ...drawerButtonStyle,
              border: "1px solid #d0d7e2",
              background: tagSectionTab === "tags" ? "#2b6cff" : "#f9fafb",
              color: tagSectionTab === "tags" ? "white" : "#111",
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
              border: "1px solid #d0d7e2",
              background: tagSectionTab === "templates" ? "#2b6cff" : "#f9fafb",
              color: tagSectionTab === "templates" ? "white" : "#111",
              borderRadius: 999,
              padding: "6px 12px",
              fontWeight: 600,
            }}
          >
            Templates
          </button>
        </div>
        {tagSectionTab === "tags" ? (
          <>
            <div style={{ ...sectionCardStyle, display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
              <button
                onClick={() => setShowManualTagForm((v) => !v)}
                style={{
                  ...drawerButtonStyle,
                  border: "1px solid #d0d7e2",
                  background: showManualTagForm ? "#2b6cff" : "white",
                  color: showManualTagForm ? "white" : "#111",
                  borderRadius: 8,
                  padding: "6px 10px",
                }}
              >
                {showManualTagForm ? "Hide New Tag" : "New Tag"}
              </button>
              <label
                style={{
                  border: "1px solid #d0d7e2",
                  background: "white",
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Upload CSV
                <input type="file" accept=".csv" onChange={onCsvFile} style={{ display: "none" }} />
              </label>
            </div>
            {showManualTagForm ? (
              <div style={{ ...sectionCardStyle, marginBottom: 10, background: "#fbfcff" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Name
                    <input
                      value={manualTag.name}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, name: e.target.value }))}
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Tag Path
                    <input
                      value={manualTag.tagPath}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, tagPath: e.target.value }))}
                      placeholder="Defaults to name"
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Topic
                    <select
                      value={manualTag.topic}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, topic: e.target.value }))}
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
                      min="100"
                      value={manualTag.pollMs}
                      onChange={(e) => setManualTag((prev) => ({ ...prev, pollMs: e.target.value }))}
                      placeholder="Uses global"
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
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
                    setManualTag({ name: "", tagPath: "", uaType: "", pollMs: "", samplingInterval: "", topic: "", enabled: true });
                    setShowManualTagForm(false);
                  }}
                  style={{ ...drawerButtonStyle, border: "1px solid #d0d7e2", background: "white", borderRadius: 8, padding: "6px 10px" }}
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
                  style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
                  style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
                Prefix (e.g., Motor1)
                <input
                  value={applyPrefix}
                  onChange={(e) => setApplyPrefix(e.target.value)}
                  style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                />
              </label>
              <button onClick={applyTemplateToTags} style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px", height: 32 }}>
                Add From Template
              </button>
            </div>
            <div style={{ ...sectionCardStyle, marginTop: 10, maxHeight: 360, overflow: "auto" }}>
              {tags.length === 0 ? (
                <div style={{ color: "#98a2b3", fontSize: 12 }}>No tags.</div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "auto" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Enabled</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Topic</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Tag Path</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>UA Type</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Poll (ms)</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Sampling (ms)</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Live Value</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {groupedTags.map(([groupKey, items]) => {
                      const key = groupKey ?? "";
                      const isExpanded = expandedPrefixes[key] ?? true;
                      const label = groupKey || "";
                      const topicMeta = topicMap.get(label);
                      return (
                        <Fragment key={"group-" + label}>
                          <tr style={{ borderTop: "1px solid #eef2f6", background: "#f8fafc" }}>
                            <td colSpan={9} style={{ padding: "6px 8px" }}>
                              <button
                                onClick={() =>
                                  setExpandedPrefixes((prev) => ({ ...prev, [key]: !isExpanded }))
                                }
                                style={{
                                  ...drawerButtonStyle,
                                  border: "1px solid #d0d7e2",
                                  background: "white",
                                  borderRadius: 6,
                                  padding: "4px 8px",
                                  marginRight: 8,
                                }}
                              >
                                {isExpanded ? "-" : "+"}
                              </button>
                              <span style={{ fontWeight: 600 }}>{label}</span>
                              {topicMeta?.plcName ? (
                                <span style={{ color: "#667085", marginLeft: 8 }}>
                                  PLC {topicMeta.plcName}
                                </span>
                              ) : null}
                              <span style={{ color: "#667085", marginLeft: 8 }}>
                                {items.length} tags
                              </span>
                            </td>
                          </tr>
                          {isExpanded
                            ? items.map(({ tag: t, idx }) => (
                                <tr key={t.name + "-" + idx} style={{ borderTop: "1px solid #eef2f6" }}>
                                  <td style={{ padding: "6px 8px", color: t.enabled === false ? "#b42318" : "#12b76a" }}>
                                    {t.enabled === false ? "Disabled" : "Enabled"}
                                  </td>
                                  <td style={{ padding: "6px 8px", color: "#111" }}>{t.name || ""}</td>
                                  <td style={{ padding: "6px 8px", color: "#475467" }}>{t.topic || ""}</td>
                                  <td style={{ padding: "6px 8px", color: "#111" }}>{t.tagPath || ""}</td>
                                  <td style={{ padding: "6px 8px", color: "#111" }}>{t.uaType || ""}</td>
                                  <td style={{ padding: "6px 8px", color: "#111" }}>
                                    {Number.isFinite(Number(t.pollMs)) ? Number(t.pollMs) : ""}
                                  </td>
                                  <td style={{ padding: "6px 8px", color: "#111" }}>
                                    {Number.isFinite(Number(t.samplingInterval)) ? Number(t.samplingInterval) : ""}
                                  </td>
                                  <td style={{ padding: "6px 8px", color: "#111", fontSize: 12 }}>
                                    {t.enabled === false
                                      ? "Disabled"
                                      : String(liveValues?.[getTagKey(t)] ?? "")}
                                    {liveErrors?.[getTagKey(t)] ? (
                                      <span style={{ color: "#b42318", marginLeft: 8 }}>
                                        (err {liveErrors[getTagKey(t)]})
                                      </span>
                                    ) : null}
                                  </td>
                                  <td style={{ padding: "6px 8px" }}>
                                    <button
                                      onClick={() => removeTag(idx)}
                                      style={{ ...drawerButtonStyle, width: 28, height: 28, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8 }}
                                    >
                                      X
                                    </button>
                                  </td>
                                </tr>
                              ))
                            : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <div style={sectionCardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Create / Edit Template</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 10 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                  Template Name
                  <input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                  Parent Template
                  <select
                    value={templateParent}
                    onChange={(e) => setTemplateParent(e.target.value)}
                    style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
              <div style={{ fontSize: 12, marginBottom: 6 }}>Fields</div>
              <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "45%" }} />
                    <col style={{ width: "45%" }} />
                    <col style={{ width: 48 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Tag Path</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {templateFieldRows.map((row, idx) => (
                      <tr key={`field-${idx}`} style={{ borderTop: "1px solid #eef2f6" }}>
                        <td style={{ padding: "6px 8px" }}>
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
                            style={{ width: "100%", border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
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
                            style={{ width: "100%", border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <button
                            onClick={() =>
                              setTemplateFieldRows((prev) => prev.filter((_, i) => i !== idx))
                            }
                            style={{ ...drawerButtonStyle, width: 28, height: 28, border: "1px solid #f04438", background: "#f04438", color: "white", borderRadius: 8 }}
                          >
                            X
                          </button>
                        </td>
                      </tr>
                    ))}
                    {templateFieldRows.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding: "8px", color: "#98a2b3" }}>
                          No fields yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => setTemplateFieldRows((prev) => [...prev, { name: "", tagPath: "" }])}
                  style={{ ...drawerButtonStyle, border: "1px solid #d0d7e2", background: "white", borderRadius: 8, padding: "6px 10px" }}
                >
                  Add Field
                </button>
                <button
                  onClick={saveTemplate}
                  style={{ ...drawerButtonStyle, border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 8, padding: "6px 10px" }}
                >
                  Save Template
                </button>
              </div>
            </div>
            <div style={sectionCardStyle}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>Existing Templates</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end", marginBottom: 10 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                  Select Template
                  <select
                    value={applyTemplate}
                    onChange={(e) => setApplyTemplate(e.target.value)}
                    style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                  >
                    <option value="">Select template</option>
                    {templates.map((t) => (
                      <option key={`opt-${t.name}`} value={t.name}>
                        {t.parent_name ? `${t.name} (extends ${t.parent_name})` : t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => deleteTemplate(applyTemplate)}
                  disabled={!applyTemplate}
                  style={{
                    ...drawerButtonStyle,
                    border: "1px solid #f04438",
                    background: applyTemplate ? "#f04438" : "#f2f4f7",
                    color: applyTemplate ? "white" : "#98a2b3",
                    borderRadius: 6,
                    padding: "6px 10px",
                    height: 32,
                  }}
                >
                  Delete
                </button>
              </div>
              {templates.length === 0 && <div style={{ color: "#98a2b3", fontSize: 12, marginBottom: 10 }}>No templates.</div>}
              <div style={{ fontSize: 12, color: "#667085", marginBottom: 6 }}>Fields Preview</div>
              <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden", maxHeight: 200, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <colgroup>
                    <col style={{ width: "45%" }} />
                    <col style={{ width: "55%" }} />
                  </colgroup>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Tag Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(applyTemplate ? resolveTemplateFields(applyTemplate) : []).map((f, idx) => (
                      <tr key={`tmpl-field-${idx}`} style={{ borderTop: "1px solid #eef2f6" }}>
                        <td style={{ padding: "6px 8px" }}>{f.name || f.tagPath}</td>
                        <td style={{ padding: "6px 8px", color: "#475467" }}>{f.tagPath || f.name}</td>
                      </tr>
                    ))}
                    {!applyTemplate ? (
                      <tr>
                        <td colSpan={2} style={{ padding: "8px", color: "#98a2b3" }}>
                          Select a template to preview fields.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function addTopic() {
    const name = normalizeTopicValue(manualTopic.name);
    const prefix = normalizeTopicValue(manualTopic.prefix);
    const plcName = normalizeTopicValue(manualTopic.plcName);
    const samplingInterval =
      manualTopic.samplingInterval === "" || manualTopic.samplingInterval === null
        ? undefined
        : Number(manualTopic.samplingInterval);
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
        samplingInterval: Number.isFinite(Number(samplingInterval)) ? Number(samplingInterval) : undefined,
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
    const pollMs = manualPlc.pollMs === "" ? "" : Number(manualPlc.pollMs);
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
            <div style={{ fontWeight: 800, fontSize: 18 }}>OPC Configuration</div>
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
                    : "#667085",
                border:
                  restartPending
                    ? "1px solid #fed7aa"
                    : opcConnected === true
                    ? "1px solid #abefc6"
                    : opcConnected === false
                    ? "1px solid #fecdca"
                    : "1px solid #e4e7ec",
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
                {Object.keys(liveErrors || {}).length} Errors
              </div>
            ) : null}
            {opcLastPollAt ? (
              <div style={{ fontSize: 11, color: "#667085" }}>
                Last poll {new Date(opcLastPollAt).toLocaleTimeString()}
              </div>
            ) : null}
          </div>
          {null}
        </div>

        {error && <div style={{ color: "#b42318", marginBottom: 10 }}>{error}</div>}
        {status && <div style={{ color: "#12b76a", marginBottom: 10 }}>{status}</div>}
        {Object.keys(liveErrors || {}).length > 0 && (
          <div
            style={{
              border: "1px solid #fecdca",
              background: "#fef3f2",
              color: "#7a271a",
              borderRadius: 10,
              padding: "8px 10px",
              marginBottom: 10,
              fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Tag Errors</div>
            <div style={{ display: "grid", gap: 4, maxHeight: 120, overflow: "auto" }}>
              {Object.entries(liveErrors).map(([name, count]) => (
                <div key={`err-${name}`} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{name}</span>
                  <span>err {count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16, flex: "1 1 0", minHeight: 0 }}>
          <div style={{ background: "white", border: "1px solid #e4e7ec", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>OPC UA</div>
            <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 10 }}>
              Port
              <input
                type="number"
                value={config.opcua?.port ?? 4840}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, opcua: { ...p.opcua, port: Number(e.target.value) } }))
                }
                style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 10 }}>
              Resource Path
              <input
                value={config.opcua?.resourcePath || ""}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, opcua: { ...p.opcua, resourcePath: e.target.value } }))
                }
                style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6, fontSize: 12, marginBottom: 10 }}>
              Name
              <input
                value={config.opcua?.name || ""}
                onChange={(e) => setConfig((p) => ({ ...p, opcua: { ...p.opcua, name: e.target.value } }))}
                style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
              />
            </label>
            <div style={{ marginTop: "auto", display: "flex", gap: 8, paddingTop: 10 }}>
              <button onClick={saveConfig} style={{ border: "1px solid #2b6cff", background: "#2b6cff", color: "white", borderRadius: 10, padding: "8px 12px" }}>
                Save Config
              </button>
              <button onClick={requestRestart} style={{ border: "1px solid #d0d7e2", background: "white", borderRadius: 10, padding: "8px 12px" }}>
                Restart OPC Server
              </button>
            </div>
          </div>

          <div style={{ background: "white", border: "1px solid #e4e7ec", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>PLC Instances</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setShowPlcForm((v) => !v)}
                style={{
                  border: "1px solid #d0d7e2",
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
              <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: 10, background: "#fbfcff", marginBottom: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Name
                    <input
                      value={manualPlc.name}
                      onChange={(e) => setManualPlc((prev) => ({ ...prev, name: e.target.value }))}
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Host
                    <input
                      value={manualPlc.host}
                      onChange={(e) => setManualPlc((prev) => ({ ...prev, host: e.target.value }))}
                      placeholder="e.g., 10.0.0.10"
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Slot
                    <input
                      type="number"
                      value={manualPlc.slot}
                      onChange={(e) => setManualPlc((prev) => ({ ...prev, slot: e.target.value }))}
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Poll (ms)
                    <input
                      type="number"
                      value={manualPlc.pollMs}
                      onChange={(e) => setManualPlc((prev) => ({ ...prev, pollMs: e.target.value }))}
                      placeholder="Optional"
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
                    style={{ border: "1px solid #d0d7e2", background: "white", borderRadius: 8, padding: "6px 10px" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
              {(!plcs || plcs.length === 0) ? (
                <div style={{ padding: 8, color: "#98a2b3", fontSize: 12 }}>No PLCs configured.</div>
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
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Host</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Slot</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Poll (ms)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {plcs.map((plc, idx) => (
                      <tr key={plc.id || `plc-${idx}`} style={{ borderTop: "1px solid #eef2f6" }}>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            value={plc.name || ""}
                            onChange={(e) => updatePlc(idx, "name", e.target.value)}
                            style={{ width: "100%", border: "1px solid #d0d7e2", borderRadius: 6, padding: "4px 6px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            value={plc.host || ""}
                            onChange={(e) => updatePlc(idx, "host", e.target.value)}
                            style={{ width: "100%", border: "1px solid #d0d7e2", borderRadius: 6, padding: "4px 6px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="number"
                            value={plc.slot ?? 0}
                            onChange={(e) => updatePlc(idx, "slot", e.target.value)}
                            style={{ width: "100%", border: "1px solid #d0d7e2", borderRadius: 6, padding: "4px 6px" }}
                          />
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <input
                            type="number"
                            value={plc.pollMs ?? ""}
                            onChange={(e) => updatePlc(idx, "pollMs", e.target.value)}
                            style={{ width: "100%", border: "1px solid #d0d7e2", borderRadius: 6, padding: "4px 6px" }}
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

          <div style={{ background: "white", border: "1px solid #e4e7ec", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>PLC Topics</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button
                onClick={() => setShowTopicForm((v) => !v)}
                style={{
                  border: "1px solid #d0d7e2",
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
              <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, padding: 10, background: "#fbfcff", marginBottom: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "end" }}>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Topic Name
                    <input
                      value={manualTopic.name}
                      onChange={(e) => setManualTopic((prev) => ({ ...prev, name: e.target.value }))}
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    Prefix
                    <input
                      value={manualTopic.prefix}
                      onChange={(e) => setManualTopic((prev) => ({ ...prev, prefix: e.target.value }))}
                      placeholder="Optional"
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
                    />
                  </label>
                  <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
                    PLC
                    <select
                      value={manualTopic.plcName}
                      onChange={(e) => setManualTopic((prev) => ({ ...prev, plcName: e.target.value }))}
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
                      style={{ border: "1px solid #d0d7e2", borderRadius: 8, padding: "6px 8px" }}
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
                    style={{ border: "1px solid #d0d7e2", background: "white", borderRadius: 8, padding: "6px 10px" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div style={{ border: "1px solid #e4e7ec", borderRadius: 10, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
              {(!config.topics || config.topics.length === 0) ? (
                <div style={{ padding: 8, color: "#98a2b3", fontSize: 12 }}>No topics.</div>
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
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Name</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Prefix</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>PLC</th>
                      <th style={{ textAlign: "left", padding: "6px 8px" }}>Sampling (ms)</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(config.topics || []).map((topic, idx) => (
                      <tr key={`topic-${topic.name}-${idx}`} style={{ borderTop: "1px solid #eef2f6" }}>
                        <td style={{ padding: "6px 8px" }}>{topic.name || ""}</td>
                        <td style={{ padding: "6px 8px", color: "#475467" }}>{topic.prefix || ""}</td>
                        <td style={{ padding: "6px 8px", color: "#475467" }}>{topic.plcName || ""}</td>
                        <td style={{ padding: "6px 8px", color: "#475467" }}>
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
                  background: "#f7f8fb",
                  boxShadow: "-16px 0 40px rgba(0,0,0,0.18)",
                  display: "flex",
                  flexDirection: "column",
                  borderLeft: "1px solid rgba(0,0,0,0.08)",
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: "1px solid #e4e7ec",
                    background: "white",
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.02em" }}>Tags</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
                    <button
                      ref={drawerMenuBtnRef}
                      onClick={() => setShowDrawerMenu((v) => !v)}
                      style={{
                        textAlign: "center",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "1px solid #d0d7e2",
                        background: "white",
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
                          background: "white",
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
                            color: "#111",
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
                            color: "#111",
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
                        border: "1px solid #d0d7e2",
                        background: "white",
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
