const EMPTY_VALUES = Object.freeze({});

function normalizeKey(raw) {
  return String(raw || "").replace(/\r?\n/g, "").trim();
}

function hasValue(value) {
  return value != null && value !== "";
}

function buildCandidates(rawTagPath) {
  const tagPath = normalizeKey(rawTagPath);
  if (!tagPath) return [];
  const parts = tagPath
    .split(".")
    .map((x) => x.trim())
    .filter(Boolean);
  const out = [tagPath];
  for (let i = 1; i < parts.length; i += 1) {
    out.push(parts.slice(i).join("."));
  }
  out.push(`Default.${tagPath}`);
  const seen = new Set();
  const unique = [];
  out.forEach((entry) => {
    const key = normalizeKey(entry);
    if (!key) return;
    const lower = key.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    unique.push(key);
  });
  return unique;
}

function createLiveIndex(rawValues) {
  const source = rawValues && typeof rawValues === "object" ? rawValues : EMPTY_VALUES;
  const exact = new Map();
  const lowerToKey = new Map();
  const keyList = [];
  for (const [rawKey, value] of Object.entries(source)) {
    const key = normalizeKey(rawKey);
    if (!key) continue;
    exact.set(key, value);
    keyList.push(key);
    const lower = key.toLowerCase();
    if (!lowerToKey.has(lower)) lowerToKey.set(lower, key);
  }
  const read = (rawKey) => {
    const key = normalizeKey(rawKey);
    if (!key) return undefined;
    if (exact.has(key)) return exact.get(key);
    const lower = key.toLowerCase();
    const matchKey = lowerToKey.get(lower);
    if (matchKey && exact.has(matchKey)) return exact.get(matchKey);
    return undefined;
  };
  return { keyList, read };
}

function resolveValueByTagPath(index, rawTagPath) {
  const candidates = buildCandidates(rawTagPath);
  if (!candidates.length) return "";

  for (const key of candidates) {
    const v = index.read(key);
    if (hasValue(v)) return v;
  }

  for (const key of candidates) {
    const lowerKey = key.toLowerCase();
    const suffix = `.${lowerKey}`;
    for (const mapKey of index.keyList) {
      const v = index.read(mapKey);
      if (!hasValue(v)) continue;
      const textKey = String(mapKey || "").toLowerCase();
      if (textKey === lowerKey || textKey.endsWith(suffix)) return v;
    }
  }

  for (const groupKey of candidates) {
    const prefix = `${String(groupKey).toLowerCase()}.`;
    const preferred = [
      `${prefix}state`,
      `${prefix}stcode`,
      `${prefix}status`,
      `${prefix}hmi_state`,
      `${prefix}hmistate`,
      `${prefix}routeid`,
      `${prefix}routenumber`,
      `${prefix}value`,
    ];
    for (const key of preferred) {
      const v = index.read(key);
      if (hasValue(v)) return v;
    }
    for (const mapKey of index.keyList) {
      const mapKeyLower = String(mapKey || "").toLowerCase();
      if (!mapKeyLower.startsWith(prefix)) continue;
      const v = index.read(mapKey);
      if (hasValue(v)) return v;
    }
  }
  return "";
}

function resolveGroupRouteState(index, rawTagPath) {
  const candidates = buildCandidates(rawTagPath);
  if (!candidates.length) return { routeId: "", state: "" };

  const findBySuffixes = (suffixes) => {
    for (const groupKey of candidates) {
      const prefix = `${String(groupKey).toLowerCase()}.`;
      for (const suffix of suffixes) {
        const v = index.read(`${prefix}${suffix}`);
        if (hasValue(v)) return String(v);
      }
    }
    return "";
  };

  return {
    routeId: findBySuffixes(["routeid", "routenumber", "routeno", "route"]),
    state: findBySuffixes(["state", "stcode", "status", "stat", "hmi_state", "hmistate"]),
  };
}

self.onmessage = (event) => {
  const payload = event?.data || {};
  if (String(payload?.type || "") !== "resolve") return;
  const id = Number(payload?.id || 0);
  const liveValues = payload?.liveValues && typeof payload.liveValues === "object" ? payload.liveValues : {};
  const rawTagPaths = Array.isArray(payload?.tagPaths) ? payload.tagPaths : [];
  const tagPaths = [];
  const seen = new Set();
  rawTagPaths.forEach((raw) => {
    const key = normalizeKey(raw);
    if (!key) return;
    const lower = key.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    tagPaths.push(key);
  });

  const index = createLiveIndex(liveValues);
  const byTagPath = {};
  const groupByTagPath = {};
  for (const tagPath of tagPaths) {
    const lower = tagPath.toLowerCase();
    byTagPath[lower] = resolveValueByTagPath(index, tagPath);
    groupByTagPath[lower] = resolveGroupRouteState(index, tagPath);
  }

  self.postMessage({
    type: "resolved",
    id,
    byTagPath,
    groupByTagPath,
  });
};
