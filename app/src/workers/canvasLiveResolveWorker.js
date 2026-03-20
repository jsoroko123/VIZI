const EMPTY_VALUES = Object.freeze({});
const LIVE_STATE_MEMBER_ALIASES = ["HMI_State", "HMIState", "i_HMIState", "o_HMIState", "State"];
const LIVE_ROUTE_ID_MEMBER_ALIASES = ["RouteID", "RouteNumber", "RouteNo", "Route"];

let sceneState = {
  tagPaths: [],
  shapes: [],
  overlays: [],
  tags: [],
  routeColorEntries: [],
  templateEntries: [],
  tagMappingEntries: [],
  mappingSetEntries: [],
};

function normalizeKey(raw) {
  return String(raw || "").replace(/\r?\n/g, "").trim();
}

function hasValue(value) {
  return value != null && value !== "";
}

function normalizeRouteTagKey(value) {
  return normalizeKey(value).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isRouteIdTagKey(value) {
  const key = normalizeRouteTagKey(value);
  return key === "routeid" || key === "routenumber" || key === "routeno" || key === "route";
}

function isStateTagKey(value) {
  const key = normalizeRouteTagKey(value);
  return key === "state" || key === "stcode" || key === "status" || key === "stat" || key === "hmistate";
}

function normalizeActiveColor(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (
    lower === "#808080" ||
    lower === "rgb(128,128,128)" ||
    lower === "gray" ||
    lower === "grey" ||
    lower === "#fff" ||
    lower === "#ffffff" ||
    lower === "white" ||
    lower === "rgb(255,255,255)" ||
    lower === "rgba(255,255,255,1)"
  ) {
    return "";
  }
  return raw;
}

function matchStateMappingColor(mappings, rawValue) {
  const valueText = String(rawValue ?? "").trim();
  if (!valueText) return "";
  const valueNum = Number(rawValue);
  const valueLower = valueText.toLowerCase();
  const valueBool =
    valueLower === "true" || valueLower === "1"
      ? true
      : valueLower === "false" || valueLower === "0"
      ? false
      : null;
  for (const mapping of Array.isArray(mappings) ? mappings : []) {
    const color = normalizeKey(mapping?.color);
    if (!color) continue;
    const candidates = [mapping?.state, mapping?.field];
    for (const candidateRaw of candidates) {
      const candidateText = normalizeKey(candidateRaw);
      if (!candidateText) continue;
      const candidateLower = candidateText.toLowerCase();
      const candidateNum = Number(candidateText);
      if (Number.isFinite(valueNum) && Number.isFinite(candidateNum) && candidateNum === valueNum) {
        return color;
      }
      const candidateBool =
        candidateLower === "true" || candidateLower === "1"
          ? true
          : candidateLower === "false" || candidateLower === "0"
          ? false
          : null;
      if (valueBool !== null && candidateBool !== null && candidateBool === valueBool) {
        return color;
      }
      if (candidateLower === valueLower) return color;
    }
  }
  return "";
}

function buildCandidates(rawTagPath) {
  const tagPath = normalizeKey(rawTagPath);
  if (!tagPath) return [];
  const parts = tagPath.split(".").map((x) => x.trim()).filter(Boolean);
  const out = [tagPath];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(i).join("."));
  if (!tagPath.toLowerCase().startsWith("default.")) out.push(`Default.${tagPath}`);
  return Array.from(new Set(out.map((entry) => normalizeKey(entry)).filter(Boolean).map((entry) => entry.toLowerCase())))
    .map((lower) => out.find((entry) => normalizeKey(entry).toLowerCase() === lower) || lower);
}

function buildTagPathMemberCandidates(rawTagPath, aliases = []) {
  const parents = buildCandidates(rawTagPath);
  const out = [];
  const seen = new Set();
  parents.forEach((parent) => {
    aliases.forEach((alias) => {
      const member = normalizeKey(alias);
      if (!member) return;
      [`${parent}.${member}`, `${parent}/${member}`].forEach((entry) => {
        const key = normalizeKey(entry);
        const lower = key.toLowerCase();
        if (!key || seen.has(lower)) return;
        seen.add(lower);
        out.push(key);
      });
    });
  });
  return out;
}

function createLiveIndex(rawValues) {
  const source = rawValues && typeof rawValues === "object" ? rawValues : EMPTY_VALUES;
  const exact = new Map();
  const lowerToKey = new Map();
  const keyList = [];
  Object.entries(source).forEach(([rawKey, value]) => {
    const key = normalizeKey(rawKey);
    if (!key) return;
    exact.set(key, value);
    keyList.push(key);
    const lower = key.toLowerCase();
    if (!lowerToKey.has(lower)) lowerToKey.set(lower, key);
  });
  return {
    keyList,
    read(rawKey) {
      const key = normalizeKey(rawKey);
      if (!key) return undefined;
      if (exact.has(key)) return exact.get(key);
      const matchKey = lowerToKey.get(key.toLowerCase());
      return matchKey && exact.has(matchKey) ? exact.get(matchKey) : undefined;
    },
  };
}

function getFirstLiveValueForCandidates(index, candidates) {
  for (const rawKey of Array.isArray(candidates) ? candidates : []) {
    const key = normalizeKey(rawKey);
    if (!key) continue;
    const exact = index.read(key);
    if (hasValue(exact)) return exact;
    const lowerKey = key.toLowerCase();
    const dotSuffix = `.${lowerKey}`;
    const slashSuffix = `/${lowerKey}`;
    for (const mapKey of index.keyList) {
      const mapValue = index.read(mapKey);
      if (!hasValue(mapValue)) continue;
      const textKey = String(mapKey || "").trim().toLowerCase();
      if (textKey === lowerKey || textKey.endsWith(dotSuffix) || textKey.endsWith(slashSuffix)) {
        return mapValue;
      }
    }
  }
  return null;
}

function getLiveMemberValueForTagPath(index, rawTagPath, aliases = []) {
  return getFirstLiveValueForCandidates(index, buildTagPathMemberCandidates(rawTagPath, aliases));
}

function resolveValueByTagPath(index, rawTagPath) {
  const candidates = buildCandidates(rawTagPath);
  for (const key of candidates) {
    const value = index.read(key);
    if (hasValue(value)) return value;
  }
  for (const key of candidates) {
    const lowerKey = key.toLowerCase();
    const suffix = `.${lowerKey}`;
    for (const mapKey of index.keyList) {
      const value = index.read(mapKey);
      if (!hasValue(value)) continue;
      const textKey = String(mapKey || "").toLowerCase();
      if (textKey === lowerKey || textKey.endsWith(suffix)) return value;
    }
  }
  return "";
}

function resolveGroupRouteState(index, rawTagPath) {
  const directRouteId = getLiveMemberValueForTagPath(index, rawTagPath, LIVE_ROUTE_ID_MEMBER_ALIASES);
  const directState = getLiveMemberValueForTagPath(index, rawTagPath, LIVE_STATE_MEMBER_ALIASES);
  if (hasValue(directRouteId) || hasValue(directState)) {
    return {
      routeId: hasValue(directRouteId) ? String(directRouteId) : "",
      state: hasValue(directState) ? String(directState) : "",
    };
  }
  const candidates = buildCandidates(rawTagPath);
  const findBySuffixes = (suffixes) => {
    for (const groupKey of candidates) {
      const prefixes = [`${groupKey.toLowerCase()}.`, `${groupKey.toLowerCase()}/`];
      for (const prefix of prefixes) {
        for (const suffix of suffixes) {
          const value = index.read(`${prefix}${suffix}`);
          if (hasValue(value)) return String(value);
        }
      }
    }
    return "";
  };
  return {
    routeId: findBySuffixes(["routeid", "routenumber", "routeno", "route"]),
    state: findBySuffixes(["state", "stcode", "status", "stat", "hmi_state", "hmistate"]),
  };
}

function normalizeBBox(raw) {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { x, y, width: Math.max(0.0001, width), height: Math.max(0.0001, height) };
}

function createLookupMap(entries) {
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const pair = Array.isArray(entry) ? entry : [entry?.key, entry?.value];
    const key = normalizeKey(pair[0]);
    if (!key) return;
    map.set(key, pair[1]);
    map.set(key.toLowerCase(), pair[1]);
  });
  return map;
}

function createTagMappingMap(entries) {
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const pair = Array.isArray(entry) ? entry : [entry?.key, entry?.value];
    const key = normalizeKey(pair[0]);
    const rows = Array.isArray(pair[1]) ? pair[1] : [];
    if (!key) return;
    map.set(key, rows);
    map.set(key.toLowerCase(), rows);
  });
  return map;
}

function inferGroupName(tag) {
  const explicit = normalizeKey(tag?.groupName);
  if (explicit) return explicit;
  const rawPath = normalizeKey(tag?.tagPath || tag?.name);
  if (!rawPath.includes(".")) return "";
  return normalizeKey(rawPath.slice(0, rawPath.indexOf(".")));
}

function readLiveTagValue(index, tag, topicName, groupName) {
  const candidates = [
    topicName && groupName && tag?.tagPath ? `${topicName}.${groupName}.${tag.tagPath}` : "",
    topicName && groupName && tag?.name ? `${topicName}.${groupName}.${tag.name}` : "",
    topicName && tag?.tagPath ? `${topicName}.${tag.tagPath}` : "",
    topicName && tag?.name ? `${topicName}.${tag.name}` : "",
    groupName && tag?.tagPath ? `${groupName}.${tag.tagPath}` : "",
    groupName && tag?.name ? `${groupName}.${tag.name}` : "",
    tag?.tagPath || "",
    tag?.name || "",
  ].map((entry) => normalizeKey(entry)).filter(Boolean);
  for (const key of candidates) {
    const value = index.read(key);
    if (hasValue(value)) return value;
  }
  return null;
}

function resolveTemplateStateMappings(templateMap, name) {
  const visited = new Set();
  const map = new Map();
  const walk = (rawName) => {
    const key = normalizeKey(rawName);
    if (!key || visited.has(key)) return;
    visited.add(key);
    const template = templateMap.get(key) || templateMap.get(key.toLowerCase());
    if (!template || typeof template !== "object") return;
    if (template.parent_name) walk(template.parent_name);
    (Array.isArray(template.state_mappings) ? template.state_mappings : []).forEach((mapping) => {
      const fieldVal = normalizeKey(mapping?.field);
      const stateVal = normalizeKey(mapping?.state);
      if (!stateVal) return;
      map.set(`${fieldVal}::${stateVal}`, normalizeKey(mapping?.color));
    });
  };
  walk(name);
  return Array.from(map.entries()).map(([key, color]) => {
    const [field, state] = key.split("::");
    return { field, state, color };
  });
}

function normalizeScene(sceneRaw) {
  const raw = sceneRaw && typeof sceneRaw === "object" ? sceneRaw : {};
  return {
    tagPaths: Array.from(new Set((Array.isArray(raw.tagPaths) ? raw.tagPaths : []).map((entry) => normalizeKey(entry).toLowerCase())))
      .map((lower) => (Array.isArray(raw.tagPaths) ? raw.tagPaths : []).find((entry) => normalizeKey(entry).toLowerCase() === lower) || lower)
      .map((entry) => normalizeKey(entry))
      .filter(Boolean),
    shapes: (Array.isArray(raw.shapes) ? raw.shapes : []).map((shape) => {
      const id = normalizeKey(shape?.id);
      const points = Array.isArray(shape?.points)
        ? shape.points.map((point) => {
            const x = Number(point?.x);
            const y = Number(point?.y);
            return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
          }).filter(Boolean)
        : [];
      if (!id || normalizeKey(shape?.type).toLowerCase() !== "polyline" || points.length < 2) return null;
      return { id, type: "polyline", tagPath: normalizeKey(shape?.tagPath), stroke: normalizeKey(shape?.stroke), points };
    }).filter(Boolean),
    overlays: (Array.isArray(raw.overlays) ? raw.overlays : []).map((overlay) => {
      const id = normalizeKey(overlay?.id);
      const bbox = normalizeBBox(overlay?.bbox);
      if (!id || !bbox) return null;
      return {
        id,
        tagPath: normalizeKey(overlay?.tagPath),
        name: normalizeKey(overlay?.name),
        eType: normalizeKey(overlay?.eType),
        diverterMode: normalizeKey(overlay?.diverterMode),
        tx: Number.isFinite(Number(overlay?.tx)) ? Number(overlay.tx) : 0,
        ty: Number.isFinite(Number(overlay?.ty)) ? Number(overlay.ty) : 0,
        scale: Number.isFinite(Number(overlay?.scale)) ? Number(overlay.scale) : 1,
        scaleX: Number.isFinite(Number(overlay?.scaleX)) ? Number(overlay.scaleX) : null,
        scaleY: Number.isFinite(Number(overlay?.scaleY)) ? Number(overlay.scaleY) : null,
        bbox,
      };
    }).filter(Boolean),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    routeColorEntries: Array.isArray(raw.routeColorEntries) ? raw.routeColorEntries : [],
    templateEntries: Array.isArray(raw.templateEntries) ? raw.templateEntries : [],
    tagMappingEntries: Array.isArray(raw.tagMappingEntries) ? raw.tagMappingEntries : [],
    mappingSetEntries: Array.isArray(raw.mappingSetEntries) ? raw.mappingSetEntries : [],
  };
}

function buildDerivedVisualState(index, scene) {
  const routeColorsMap = createLookupMap(scene.routeColorEntries);
  const templateMap = createLookupMap(scene.templateEntries);
  const tagMappingMap = createTagMappingMap(scene.tagMappingEntries);
  const mappingSetMap = createLookupMap(scene.mappingSetEntries);
  const tagColorMap = new Map();
  const routeStrokeMap = new Map();
  const groupLiveMap = new Map();
  const stateMappingsByPath = new Map();
  const groups = new Map();

  (Array.isArray(scene.tags) ? scene.tags : []).forEach((tag) => {
    const tagPath = normalizeKey(tag?.tagPath);
    const tagName = normalizeKey(tag?.name);
    const topicName = normalizeKey(tag?.topic);
    const groupName = inferGroupName(tag);
    const rawValue = readLiveTagValue(index, tag, topicName, groupName);
    const scale = Number.isFinite(Number(tag?.scale)) ? Number(tag.scale) : 1;
    const value =
      rawValue != null && rawValue !== "" && !Number.isNaN(Number(rawValue))
        ? Number(rawValue) * scale
        : rawValue;

    if (groupName) {
      const topic = topicName || "Default";
      const groupPath = `${topic}.${groupName}`;
      const normalizedValue = normalizeKey(value);
      const entry = groups.get(groupPath) || { routeId: "", state: "" };
      if (normalizedValue) {
        if (!entry.routeId && (isRouteIdTagKey(tagName) || isRouteIdTagKey(tagPath))) {
          entry.routeId = normalizedValue;
          const routeColor =
            routeColorsMap.get(normalizedValue) ||
            routeColorsMap.get(normalizedValue.toLowerCase()) ||
            "";
          if (routeColor) {
            routeStrokeMap.set(groupPath, routeColor);
            routeStrokeMap.set(groupPath.toLowerCase(), routeColor);
            routeStrokeMap.set(groupName, routeColor);
            routeStrokeMap.set(groupName.toLowerCase(), routeColor);
          }
        }
        if (!entry.state && (isStateTagKey(tagName) || isStateTagKey(tagPath))) {
          entry.state = normalizedValue;
        }
      }
      if (entry.routeId || entry.state) groups.set(groupPath, entry);
    }

    if (value == null || value === "") return;
    const keyCandidates = [
      tagPath,
      topicName && tagName ? `${topicName}.${tagName}` : "",
      topicName && tagPath ? `${topicName}.${tagPath}` : "",
      groupName,
      topicName && groupName ? `${topicName}.${groupName}` : "",
    ].map((entry) => normalizeKey(entry)).filter(Boolean);
    if (!keyCandidates.length) return;

    const mappingKeys = [
      topicName && groupName && tagName ? `${topicName}.${groupName}.${tagName}` : "",
      topicName && groupName && tagPath ? `${topicName}.${groupName}.${tagPath}` : "",
      groupName && tagName ? `${groupName}.${tagName}` : "",
      groupName && tagPath ? `${groupName}.${tagPath}` : "",
      topicName && tagName ? `${topicName}.${tagName}` : "",
      topicName && tagPath ? `${topicName}.${tagPath}` : "",
      tagName,
      tagPath,
    ].map((entry) => normalizeKey(entry)).filter(Boolean);
    const tagMappings = [];
    const seenMappingRows = new Set();
    mappingKeys.forEach((key) => {
      const rows = tagMappingMap.get(key) || tagMappingMap.get(key.toLowerCase()) || [];
      rows.forEach((row) => {
        const signature = `${String(row?.field || "")}::${String(row?.state || "")}::${String(row?.color || "")}`;
        if (seenMappingRows.has(signature)) return;
        seenMappingRows.add(signature);
        tagMappings.push(row);
      });
    });
    const mappingSetName = normalizeKey(tag?.mappingSet);
    const mappingSet = mappingSetName
      ? (mappingSetMap.get(mappingSetName) || mappingSetMap.get(mappingSetName.toLowerCase()) || null)
      : null;
    const setMappings = Array.isArray(mappingSet?.mappings) ? mappingSet.mappings : [];
    const normalizedSetMappings = setMappings.map((mapping) => ({
      field: String(mapping?.field ?? ""),
      state: String(mapping?.state ?? ""),
      color: String(mapping?.color ?? ""),
    }));
    const templateName = normalizeKey(tag?.plcType);
    const mappings = tagMappings.length
      ? tagMappings
      : normalizedSetMappings.length
      ? normalizedSetMappings
      : resolveTemplateStateMappings(templateMap, templateName);
    if ((isStateTagKey(tagName) || isStateTagKey(tagPath)) && mappings.length) {
      keyCandidates.forEach((key) => {
        stateMappingsByPath.set(key, mappings);
        stateMappingsByPath.set(key.toLowerCase(), mappings);
      });
    }
    const matchColor = matchStateMappingColor(mappings, value);
    const resolvedColor = normalizeKey(matchColor);
    if (!resolvedColor) return;
    keyCandidates.forEach((key) => {
      tagColorMap.set(key, resolvedColor);
      tagColorMap.set(key.toLowerCase(), resolvedColor);
    });
  });

  groups.forEach((entry, groupPath) => {
    if (!entry?.routeId && !entry?.state) return;
    const group = normalizeKey(groupPath.split(".").slice(1).join("."));
    groupLiveMap.set(groupPath, entry);
    groupLiveMap.set(groupPath.toLowerCase(), entry);
    if (group) {
      groupLiveMap.set(group, entry);
      groupLiveMap.set(group.toLowerCase(), entry);
    }
  });

  return { tagColorMap, routeStrokeMap, groupLiveMap, routeColorsMap, stateMappingsByPath };
}

function resolveLiveVisualState(index, scene) {
  const { tagColorMap, routeStrokeMap, groupLiveMap, routeColorsMap, stateMappingsByPath } = buildDerivedVisualState(index, scene);
  const shapes = Array.isArray(scene.shapes) ? scene.shapes : [];
  const overlays = Array.isArray(scene.overlays) ? scene.overlays : [];

  const groupStateFor = (rawTagPath) => {
    const tagPath = normalizeKey(rawTagPath);
    if (!tagPath) return { routeId: "", state: "" };
    const direct = groupLiveMap.get(tagPath) || groupLiveMap.get(tagPath.toLowerCase()) || null;
    return direct
      ? { routeId: String(direct?.routeId || ""), state: String(direct?.state || "") }
      : resolveGroupRouteState(index, tagPath);
  };

  const tagColorFor = (rawTagPath) => {
    const tagPath = normalizeKey(rawTagPath);
    if (!tagPath) return "";
    const direct = tagColorMap.get(tagPath) || tagColorMap.get(tagPath.toLowerCase()) || "";
    if (direct) return normalizeActiveColor(direct) || direct;
    const parts = tagPath.split(".").map((x) => x.trim()).filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      const suffix = parts.slice(i).join(".");
      const match = tagColorMap.get(suffix) || tagColorMap.get(suffix.toLowerCase()) || "";
      if (match) return normalizeActiveColor(match) || match;
    }
    const mappedStateCandidates = buildCandidates(tagPath);
    const directStateValue = getLiveMemberValueForTagPath(index, tagPath, LIVE_STATE_MEMBER_ALIASES);
    for (const candidate of mappedStateCandidates) {
      const mappings =
        stateMappingsByPath.get(candidate) ||
        stateMappingsByPath.get(candidate.toLowerCase()) ||
        null;
      const mappedColor = matchStateMappingColor(mappings, directStateValue);
      if (mappedColor) return normalizeActiveColor(mappedColor) || mappedColor;
    }
    const groupStateValue = groupStateFor(tagPath)?.state;
    for (const candidate of mappedStateCandidates) {
      const mappings =
        stateMappingsByPath.get(candidate) ||
        stateMappingsByPath.get(candidate.toLowerCase()) ||
        null;
      const mappedColor = matchStateMappingColor(mappings, groupStateValue);
      if (mappedColor) return normalizeActiveColor(mappedColor) || mappedColor;
    }
    return "";
  };

  const overlayScaleX = (overlay) => {
    const sx = Number(overlay?.scaleX);
    if (Number.isFinite(sx) && sx > 0) return sx;
    const scale = Number(overlay?.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  };

  const overlayScaleY = (overlay) => {
    const sy = Number(overlay?.scaleY);
    if (Number.isFinite(sy) && sy > 0) return sy;
    const scale = Number(overlay?.scale);
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  };

  const overlayWorldRect = (overlay) => {
    const bbox = overlay?.bbox;
    if (!bbox) return null;
    const sx = overlayScaleX(overlay);
    const sy = overlayScaleY(overlay);
    return {
      x: Number(overlay?.tx || 0) + sx * Number(bbox.x || 0),
      y: Number(overlay?.ty || 0) + sy * Number(bbox.y || 0),
      w: sx * Number(bbox.width || 0),
      h: sy * Number(bbox.height || 0),
    };
  };

  const distancePointToRect = (pt, rect) => {
    if (!pt || !rect) return Number.POSITIVE_INFINITY;
    const rx = Number(rect.x) || 0;
    const ry = Number(rect.y) || 0;
    const rw = Number(rect.w) || 0;
    const rh = Number(rect.h) || 0;
    const px = Number(pt.x) || 0;
    const py = Number(pt.y) || 0;
    const dx = px < rx ? rx - px : px > rx + rw ? px - (rx + rw) : 0;
    const dy = py < ry ? ry - py : py > ry + rh ? py - (ry + rh) : 0;
    return Math.hypot(dx, dy);
  };

  const pointsNear = (a, b, threshold = 12) => {
    if (!a || !b) return false;
    const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
    const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
    return dx * dx + dy * dy <= threshold * threshold;
  };

  const parseDiverterStateValue = (raw) => {
    if (raw == null || raw === "") return "";
    const text = String(raw).trim();
    const lower = text.toLowerCase();
    if (lower.includes("straight")) return "straight";
    if (lower.includes("divert")) return "divert";
    const num = Number(text);
    if (!Number.isFinite(num)) return "";
    if (num === 1 || num === 8) return "straight";
    if (num === 2 || num === 16) return "divert";
    return "";
  };

  const routeColorForOverlay = (overlay) => {
    const lookup = (raw) => {
      const key = normalizeKey(raw);
      if (!key) return "";
      const base = normalizeKey((key.split("/").pop() || "").replace(/\.svg$/i, ""));
      return (
        routeColorsMap.get(key) ||
        routeColorsMap.get(key.toLowerCase()) ||
        (base ? routeColorsMap.get(base) : "") ||
        (base ? routeColorsMap.get(base.toLowerCase()) : "") ||
        ""
      );
    };
    return lookup(overlay?.tagPath) || lookup(overlay?.name) || lookup(overlay?.id) || "";
  };

  const routeStrokeForOverlay = (overlay) => {
    const key = normalizeKey(overlay?.tagPath);
    if (key) {
      const direct = routeStrokeMap.get(key) || routeStrokeMap.get(key.toLowerCase()) || "";
      if (direct) return direct;
    }
    const routeId = normalizeKey(groupStateFor(overlay?.tagPath)?.routeId);
    if (!routeId) return "";
    const routeColor = routeColorsMap.get(routeId) || routeColorsMap.get(routeId.toLowerCase()) || "";
    return routeColor || (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(routeId) ? routeId : "");
  };

  const overlayStateFor = (overlay) => {
    const directState = parseDiverterStateValue(
      getLiveMemberValueForTagPath(index, overlay?.tagPath, LIVE_STATE_MEMBER_ALIASES)
    );
    if (directState) return directState;
    return parseDiverterStateValue(groupStateFor(overlay?.tagPath)?.state) || parseDiverterStateValue(overlay?.diverterMode);
  };

  const branchAtLocalPoint = (localX, localY, bbox) => {
    const bx = Number(bbox?.x) || 0;
    const by = Number(bbox?.y) || 0;
    const bw = Math.max(0.0001, Number(bbox?.width) || 1);
    const bh = Math.max(0.0001, Number(bbox?.height) || 1);
    const nx = (Number(localX) - bx) / bw;
    const ny = (Number(localY) - by) / bh;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return "";
    if (nx < -0.25 || nx > 1.25 || ny < -0.25 || ny > 1.25) return "";
    if (nx <= 0.46 && ny <= 0.44) return "entry";
    if (nx <= 0.62 && ny >= 0.08 && ny <= 0.54) return "entry";
    if (nx >= 0.48 && ny >= -0.04 && ny <= 0.38) return "straight";
    if (nx >= 0.18 && ny >= 0.30) return "divert";
    return "";
  };

  const branchByConnector = (overlay, pt, threshold = 24) => {
    const bbox = overlay?.bbox;
    if (!overlay || !pt || !bbox) return "";
    const sx = overlayScaleX(overlay);
    const sy = overlayScaleY(overlay);
    const bx = Number(bbox?.x) || 0;
    const by = Number(bbox?.y) || 0;
    const bw = Math.max(0.0001, Number(bbox?.width) || 1);
    const bh = Math.max(0.0001, Number(bbox?.height) || 1);
    const tx = Number(overlay?.tx || 0);
    const ty = Number(overlay?.ty || 0);
    const px = Number(pt?.x || 0);
    const py = Number(pt?.y || 0);
    const connectors = [
      { branch: "entry", x: tx + sx * (bx + bw * 0.12), y: ty + sy * (by + bh * 0.25) },
      { branch: "straight", x: tx + sx * (bx + bw * 0.92), y: ty + sy * (by + bh * 0.18) },
      { branch: "divert", x: tx + sx * (bx + bw * 0.82), y: ty + sy * (by + bh * 0.78) },
    ];
    let best = "";
    let bestDist = Number.POSITIVE_INFINITY;
    connectors.forEach((connector) => {
      const dist = Math.hypot(px - connector.x, py - connector.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = connector.branch;
      }
    });
    return bestDist <= threshold ? best : "";
  };

  const outputBranchAtPoint = (overlay, pt, threshold = 40) => {
    const bbox = overlay?.bbox;
    if (!overlay || !pt || !bbox) return "";
    const sx = overlayScaleX(overlay);
    const sy = overlayScaleY(overlay);
    const bx = Number(bbox?.x) || 0;
    const by = Number(bbox?.y) || 0;
    const bw = Math.max(0.0001, Number(bbox?.width) || 1);
    const bh = Math.max(0.0001, Number(bbox?.height) || 1);
    const tx = Number(overlay?.tx || 0);
    const ty = Number(overlay?.ty || 0);
    const px = Number(pt?.x || 0);
    const py = Number(pt?.y || 0);
    const outputs = [
      { branch: "straight", x: tx + sx * (bx + bw * 0.92), y: ty + sy * (by + bh * 0.18) },
      { branch: "divert", x: tx + sx * (bx + bw * 0.82), y: ty + sy * (by + bh * 0.78) },
    ];
    let best = "";
    let bestDist = Number.POSITIVE_INFINITY;
    outputs.forEach((output) => {
      const dist = Math.hypot(px - output.x, py - output.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = output.branch;
      }
    });
    return bestDist <= threshold ? best : "";
  };

  const overlayFlowColorFor = (overlay, entryColor = "") => {
    const overlayType = String(overlay?.eType || overlay?.name || "").trim().toLowerCase();
    const incomingEntryColor = normalizeActiveColor(entryColor);
    if (overlayType.includes("diverter")) return incomingEntryColor;
    return normalizeActiveColor(routeColorForOverlay(overlay) || tagColorFor(overlay?.tagPath) || routeStrokeForOverlay(overlay));
  };

  const diverterCache = new Map();
  const diverterVisiting = new Set();
  let connectedSourceColorAtPoint = () => "";

  const connectedColorFromPolyline = (shape, entryEndpointIndex, options = {}, visited = new Set(), depth = 0) => {
    if (!shape || shape?.type !== "polyline" || !Array.isArray(shape.points) || shape.points.length < 2) return "";
    if (depth > 16) return "";
    const shapeId = String(shape?.id || "");
    if (shapeId && visited.has(shapeId)) return "";
    const nextVisited = new Set(visited);
    if (shapeId) nextVisited.add(shapeId);
    const oppositeIndex = entryEndpointIndex === 0 ? shape.points.length - 1 : 0;
    const oppositePoint = shape.points[oppositeIndex];
    const directSourceColor = connectedSourceColorAtPoint(oppositePoint, options);
    if (directSourceColor === null) return "";
    if (directSourceColor) return directSourceColor;
    for (const other of shapes) {
      if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
      if (String(other?.id || "") === shapeId) continue;
      if (pointsNear(oppositePoint, other.points[0])) {
        const found = connectedColorFromPolyline(other, 0, options, nextVisited, depth + 1);
        if (found) return found;
      }
      if (pointsNear(oppositePoint, other.points[other.points.length - 1])) {
        const found = connectedColorFromPolyline(other, other.points.length - 1, options, nextVisited, depth + 1);
        if (found) return found;
      }
    }
    return "";
  };

  const diverterEntryColorFor = (overlay, options = {}) => {
    const cacheKey = String(overlay?.id || "");
    if (cacheKey) {
      if (diverterCache.has(cacheKey)) return diverterCache.get(cacheKey);
      if (diverterVisiting.has(cacheKey)) return "";
      diverterVisiting.add(cacheKey);
    }
    const rect = overlayWorldRect(overlay);
    if (!rect || !overlay?.bbox) {
      if (cacheKey) {
        diverterVisiting.delete(cacheKey);
        diverterCache.set(cacheKey, "");
      }
      return "";
    }
    const excludedOverlayIds = new Set(
      [options?.excludeOverlayId, ...(Array.isArray(options?.excludedOverlayIds) ? options.excludedOverlayIds : [])]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    let bestColor = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const shape of shapes) {
      if (shape?.type !== "polyline" || !Array.isArray(shape.points) || shape.points.length < 2) continue;
      const endpoints = [shape.points[0], shape.points[shape.points.length - 1]].filter(Boolean);
      for (let idx = 0; idx < endpoints.length; idx += 1) {
        const pt = endpoints[idx];
        const dist = distancePointToRect(pt, rect);
        if (dist > 28 || dist >= bestDistance) continue;
        const localX = (Number(pt?.x) - Number(overlay?.tx || 0)) / Math.max(0.0001, overlayScaleX(overlay));
        const localY = (Number(pt?.y) - Number(overlay?.ty || 0)) / Math.max(0.0001, overlayScaleY(overlay));
        const branch = branchByConnector(overlay, pt, 40) || branchAtLocalPoint(localX, localY, overlay.bbox);
        if (branch !== "entry") continue;
        const entryEndpointIndex = idx === 0 ? 0 : shape.points.length - 1;
        const connectedIncomingColor = normalizeActiveColor(
          connectedColorFromPolyline(shape, entryEndpointIndex, {
            ...options,
            excludedOverlayIds: [...excludedOverlayIds, String(overlay?.id || "")],
          })
        );
        if (connectedIncomingColor) {
          bestDistance = dist;
          bestColor = connectedIncomingColor;
          continue;
        }
        const fallbackColor = normalizeActiveColor(tagColorFor(shape?.tagPath) || shape?.stroke);
        if (!fallbackColor) continue;
        bestDistance = dist;
        bestColor = fallbackColor;
      }
    }
    if (cacheKey) {
      diverterVisiting.delete(cacheKey);
      diverterCache.set(cacheKey, bestColor);
    }
    return bestColor;
  };

  const diverterOutputMatchAtPoint = (pt, options = {}) => {
    if (!pt || !overlays.length) return { matched: false, active: false, color: "" };
    let best = { matched: false, active: false, color: "", dist: Number.POSITIVE_INFINITY };
    for (const overlay of overlays) {
      const overlayType = String(overlay?.eType || overlay?.name || "").trim().toLowerCase();
      if (!overlayType.includes("diverter")) continue;
      const rect = overlayWorldRect(overlay);
      if (!rect) continue;
      const dist = distancePointToRect(pt, rect);
      if (dist > 42 || dist >= best.dist) continue;
      const localX = (Number(pt.x) - Number(overlay?.tx || 0)) / Math.max(0.0001, overlayScaleX(overlay));
      const localY = (Number(pt.y) - Number(overlay?.ty || 0)) / Math.max(0.0001, overlayScaleY(overlay));
      const localBranch = branchAtLocalPoint(localX, localY, overlay.bbox);
      const branch = outputBranchAtPoint(overlay, pt, 42) || (localBranch === "straight" || localBranch === "divert" ? localBranch : "");
      if (!branch) continue;
      const incomingEntryColor = normalizeActiveColor(
        diverterEntryColorFor(overlay, { ...options, excludeOverlayId: String(overlay?.id || "") })
      );
      const activeBranch = overlayStateFor(overlay);
      const active = !!incomingEntryColor && !!activeBranch && branch === activeBranch;
      const color = overlayFlowColorFor(overlay, incomingEntryColor);
      best = { matched: true, active, color: color || incomingEntryColor || "#22c55e", dist };
    }
    return { matched: best.matched, active: best.active, color: best.color };
  };

  const overlayColorNearPoint = (pt, threshold = 28, options = {}) => {
    if (!pt || !overlays.length) return "";
    const excludedOverlayIds = new Set(
      [options?.excludeOverlayId, ...(Array.isArray(options?.excludedOverlayIds) ? options.excludedOverlayIds : [])]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    let bestColor = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const overlay of overlays) {
      const overlayId = String(overlay?.id || "").trim();
      if (overlayId && excludedOverlayIds.has(overlayId)) continue;
      const rect = overlayWorldRect(overlay);
      if (!rect) continue;
      const dist = distancePointToRect(pt, rect);
      if (dist > threshold || dist >= bestDistance) continue;
      const overlayType = String(overlay?.eType || overlay?.name || "").trim().toLowerCase();
      const entryColor = overlayType.includes("diverter")
        ? diverterEntryColorFor(overlay, { excludedOverlayIds: [...excludedOverlayIds, overlayId] })
        : "";
      const incomingEntryColor = normalizeActiveColor(entryColor);
      const color = overlayFlowColorFor(overlay, entryColor);
      if (overlayType.includes("diverter") && !incomingEntryColor) continue;
      if (!color) continue;
      bestDistance = dist;
      bestColor = color;
    }
    return bestColor;
  };

  connectedSourceColorAtPoint = (pt, options = {}) => {
    if (!pt) return undefined;
    const diverterMatch = diverterOutputMatchAtPoint(pt, options);
    if (diverterMatch.matched) return diverterMatch.active ? normalizeActiveColor(diverterMatch.color) || "#22c55e" : null;
    return normalizeActiveColor(overlayColorNearPoint(pt, 28, options));
  };

  const projectPointToSegment = (pt, a, b) => {
    const ax = Number(a?.x) || 0;
    const ay = Number(a?.y) || 0;
    const bx = Number(b?.x) || 0;
    const by = Number(b?.y) || 0;
    const px = Number(pt?.x) || 0;
    const py = Number(pt?.y) || 0;
    const abx = bx - ax;
    const aby = by - ay;
    const abLen2 = abx * abx + aby * aby;
    const tRaw = abLen2 <= 1e-9 ? 0 : ((px - ax) * abx + (py - ay) * aby) / abLen2;
    const t = Math.max(0, Math.min(1, tRaw));
    const point = { x: ax + abx * t, y: ay + aby * t };
    const dx = px - point.x;
    const dy = py - point.y;
    return { point, t, dist2: dx * dx + dy * dy };
  };

  const distancePointToPolyline = (pt, polylinePoints) => {
    if (!pt || !Array.isArray(polylinePoints) || polylinePoints.length < 2) {
      return Number.POSITIVE_INFINITY;
    }
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < polylinePoints.length - 1; i += 1) {
      const proj = projectPointToSegment(pt, polylinePoints[i], polylinePoints[i + 1]);
      if (proj.dist2 < best) best = proj.dist2;
    }
    return Math.sqrt(best);
  };

  const polylineFlowMetaFor = (shape) => {
    if (!shape || shape?.type !== "polyline" || !Array.isArray(shape.points) || shape.points.length < 2) {
      return null;
    }
    const pts = shape.points;
    const minX = Math.min(...pts.map((p) => Number(p?.x) || 0));
    const maxX = Math.max(...pts.map((p) => Number(p?.x) || 0));
    const minY = Math.min(...pts.map((p) => Number(p?.y) || 0));
    const maxY = Math.max(...pts.map((p) => Number(p?.y) || 0));
    const xSpan = Math.max(0, maxX - minX);
    const ySpan = Math.max(0, maxY - minY);
    const startPt = pts[0];
    const endPt = pts[pts.length - 1];
    const downstreamIsEnd =
      (Number(endPt?.x) || 0) > (Number(startPt?.x) || 0) ||
      ((Number(endPt?.x) || 0) === (Number(startPt?.x) || 0) &&
        (Number(endPt?.y) || 0) >= (Number(startPt?.y) || 0));
    return {
      pts,
      downstreamIsEnd,
      orderedPoints: downstreamIsEnd ? pts : [...pts].reverse(),
      isTrunkLike: xSpan >= 24 && xSpan >= ySpan * 1.5,
    };
  };

  const buildOrderedPrefixLengths = (orderedPoints) => {
    if (!Array.isArray(orderedPoints) || orderedPoints.length < 2) return [0];
    const prefix = [0];
    for (let i = 0; i < orderedPoints.length - 1; i += 1) {
      const a = orderedPoints[i];
      const b = orderedPoints[i + 1];
      prefix.push(
        prefix[prefix.length - 1] +
          Math.hypot((Number(b?.x) || 0) - (Number(a?.x) || 0), (Number(b?.y) || 0) - (Number(a?.y) || 0))
      );
    }
    return prefix;
  };

  const buildOrderedCarryFromTouch = (orderedPoints, touch) => {
    if (!Array.isArray(orderedPoints) || orderedPoints.length < 2 || !touch) return [];
    const seg = Math.max(0, Math.min(orderedPoints.length - 2, Number(touch?.segmentIndex) || 0));
    const out = [
      {
        x: Number(touch?.touchPoint?.x) || 0,
        y: Number(touch?.touchPoint?.y) || 0,
      },
      ...orderedPoints.slice(seg + 1).map((point) => ({
        x: Number(point?.x) || 0,
        y: Number(point?.y) || 0,
      })),
    ];
    const compact = [];
    for (const pt of out) {
      if (!compact.length || !pointsNear(compact[compact.length - 1], pt, 0.001)) compact.push(pt);
    }
    return compact.length >= 2 ? compact : [];
  };

  const trimOrderedPointsFromProgress = (orderedPoints, startProgress) => {
    if (!Array.isArray(orderedPoints) || orderedPoints.length < 2) return [];
    const prefix = buildOrderedPrefixLengths(orderedPoints);
    const total = Number(prefix[prefix.length - 1] || 0);
    const target = Math.max(0, Number(startProgress) || 0);
    if (target <= 0) return orderedPoints.map((point) => ({ x: Number(point?.x) || 0, y: Number(point?.y) || 0 }));
    if (target >= total) return [];
    const out = [];
    for (let i = 0; i < orderedPoints.length - 1; i += 1) {
      const a = orderedPoints[i];
      const b = orderedPoints[i + 1];
      const segStart = Number(prefix[i] || 0);
      const segEnd = Number(prefix[i + 1] || 0);
      if (segEnd < target) continue;
      if (!out.length) {
        if (target <= segStart) {
          out.push({ x: Number(a?.x) || 0, y: Number(a?.y) || 0 });
        } else {
          const segLen = Math.max(0, segEnd - segStart);
          const t = segLen <= 1e-9 ? 0 : (target - segStart) / segLen;
          out.push({
            x: (Number(a?.x) || 0) + ((Number(b?.x) || 0) - (Number(a?.x) || 0)) * t,
            y: (Number(a?.y) || 0) + ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * t,
          });
        }
      }
      out.push({ x: Number(b?.x) || 0, y: Number(b?.y) || 0 });
    }
    const compact = [];
    for (const pt of out) {
      if (!compact.length || !pointsNear(compact[compact.length - 1], pt, 0.001)) compact.push(pt);
    }
    return compact.length >= 2 ? compact : [];
  };

  const branchStartColorFor = (shape, options = {}) => {
    if (!shape || shape?.type !== "polyline" || !Array.isArray(shape.points) || !shape.points.length) {
      return "";
    }
    const dynamic = normalizeActiveColor(tagColorFor(shape?.tagPath));
    if (dynamic) return dynamic;
    const explicitStroke = normalizeActiveColor(shape?.stroke);
    if (explicitStroke) return explicitStroke;

    const startPt = shape.points[0];
    const endPt = shape.points[shape.points.length - 1];
    const startOverlayColor = normalizeActiveColor(startPt ? connectedSourceColorAtPoint(startPt, options) : "");
    if (startOverlayColor) return startOverlayColor;
    const endOverlayColor = normalizeActiveColor(endPt ? connectedSourceColorAtPoint(endPt, options) : "");
    if (endOverlayColor) return endOverlayColor;

    const startConnectedColor = normalizeActiveColor(
      connectedColorFromPolyline(shape, Math.max(1, shape.points.length - 1), options)
    );
    if (startConnectedColor) return startConnectedColor;
    const endConnectedColor = normalizeActiveColor(
      connectedColorFromPolyline(shape, 0, options)
    );
    if (endConnectedColor) return endConnectedColor;

    const pts = Array.isArray(shape.points) ? shape.points : [];
    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const color = normalizeActiveColor(
        overlayColorNearPoint(p, 14, options)
      );
      if (color) return color;
      if (i < pts.length - 1) {
        const n = pts[i + 1];
        const mid = {
          x: ((Number(p?.x) || 0) + (Number(n?.x) || 0)) / 2,
          y: ((Number(p?.y) || 0) + (Number(n?.y) || 0)) / 2,
        };
        const midColor = normalizeActiveColor(overlayColorNearPoint(mid, 14, options));
        if (midColor) return midColor;
      }
    }
    return "";
  };

  const directSplitCarryCandidatesFor = (shape, options = {}) => {
    const meta = polylineFlowMetaFor(shape);
    if (!meta?.isTrunkLike) return [];
    const pts = meta.orderedPoints;
    const prefix = [0];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot((Number(b?.x) || 0) - (Number(a?.x) || 0), (Number(b?.y) || 0) - (Number(a?.y) || 0));
      prefix.push(prefix[prefix.length - 1] + len);
    }

    const collect = (maxDistPx) => {
      const candidates = [];
      const maxDist2 = maxDistPx * maxDistPx;
      for (const other of shapes) {
        if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
        const otherId = String(other?.id || "");
        if (!otherId || otherId === String(shape?.id || "")) continue;
        const otherMeta = polylineFlowMetaFor(other);
        if (otherMeta?.isTrunkLike) continue;
        const startPt = other.points[0];
        const endPt = other.points[other.points.length - 1];
        if (!startPt || !endPt) continue;
        const color = branchStartColorFor(other, options);
        if (!color) continue;
        const testPoints = [endPt, startPt];
        let bestTouch = null;
        for (const tp of testPoints) {
          for (let i = 0; i < pts.length - 1; i += 1) {
            const proj = projectPointToSegment(tp, pts[i], pts[i + 1]);
            if (proj.dist2 > maxDist2) continue;
            const segLen = Math.hypot(
              (Number(pts[i + 1]?.x) || 0) - (Number(pts[i]?.x) || 0),
              (Number(pts[i + 1]?.y) || 0) - (Number(pts[i]?.y) || 0)
            );
            const downstreamProgress = prefix[i] + segLen * (Number(proj.t) || 0);
            const next = {
              sourcePolylineId: otherId,
              segmentIndex: i,
              t: proj.t,
              touchPoint: { x: Number(proj.point?.x) || 0, y: Number(proj.point?.y) || 0 },
              color,
              score: proj.dist2,
              downstreamProgress,
            };
            if (!bestTouch || Number(next.score || 0) < Number(bestTouch.score || 0)) bestTouch = next;
          }
        }
        if (bestTouch) candidates.push(bestTouch);
      }
      return candidates;
    };

    let candidates = collect(16);
    if (!candidates.length) candidates = collect(140);
    candidates.sort(
      (a, b) =>
        Number(a.downstreamProgress || 0) - Number(b.downstreamProgress || 0) ||
        Number(a.score || 0) - Number(b.score || 0)
    );
    return candidates;
  };

  const strictTrunkConnectionThreshold = 18;

  const directedTrunkConnectionDistance = (upstreamShape, downstreamShape) => {
    const upstreamMeta = polylineFlowMetaFor(upstreamShape);
    const downstreamMeta = polylineFlowMetaFor(downstreamShape);
    if (!upstreamMeta?.isTrunkLike || !downstreamMeta?.isTrunkLike) return Number.POSITIVE_INFINITY;
    const upstreamEnd = upstreamMeta.orderedPoints[upstreamMeta.orderedPoints.length - 1];
    const downstreamStart = downstreamMeta.orderedPoints[0];
    if (!upstreamEnd || !downstreamStart) return Number.POSITIVE_INFINITY;
    let best = Math.hypot(
      (Number(upstreamEnd?.x) || 0) - (Number(downstreamStart?.x) || 0),
      (Number(upstreamEnd?.y) || 0) - (Number(downstreamStart?.y) || 0)
    );
    const upstreamTail = upstreamMeta.orderedPoints.slice(Math.max(0, upstreamMeta.orderedPoints.length - 2));
    const downstreamHead = downstreamMeta.orderedPoints.slice(0, Math.min(2, downstreamMeta.orderedPoints.length));
    if (upstreamTail.length >= 2) {
      best = Math.min(best, distancePointToPolyline(downstreamStart, upstreamTail));
    }
    if (downstreamHead.length >= 2) {
      best = Math.min(best, distancePointToPolyline(upstreamEnd, downstreamHead));
    }
    return best <= strictTrunkConnectionThreshold ? best : Number.POSITIVE_INFINITY;
  };

  const upstreamConnectedTrunkCache = new Map();
  const getUpstreamConnectedTrunksFor = (shape) => {
    const shapeId = String(shape?.id || "").trim();
    if (!shapeId) return [];
    if (upstreamConnectedTrunkCache.has(shapeId)) return upstreamConnectedTrunkCache.get(shapeId);
    const matches = [];
    for (const candidate of shapes) {
      if (candidate?.type !== "polyline") continue;
      const candidateId = String(candidate?.id || "").trim();
      if (!candidateId || candidateId === shapeId) continue;
      const distance = directedTrunkConnectionDistance(candidate, shape);
      if (!Number.isFinite(distance)) continue;
      matches.push({ shape: candidate, distance });
    }
    matches.sort((a, b) => Number(a.distance || 0) - Number(b.distance || 0));
    upstreamConnectedTrunkCache.set(shapeId, matches);
    return matches;
  };

  const splitCarryActivationCache = new Map();
  const resolvePolylineSplitCarryActivation = (shape, options = {}, visited = new Set()) => {
    const shapeId = String(shape?.id || "").trim();
    if (!shapeId) return null;
    if (visited.has(shapeId)) return null;
    if (splitCarryActivationCache.has(shapeId)) return splitCarryActivationCache.get(shapeId);
    const meta = polylineFlowMetaFor(shape);
    if (!meta?.isTrunkLike) {
      splitCarryActivationCache.set(shapeId, null);
      return null;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(shapeId);
    let best = null;

    const localCandidates = directSplitCarryCandidatesFor(shape, options);
    if (localCandidates.length) {
      const first = [...localCandidates].sort(
        (a, b) =>
          Number(a?.downstreamProgress || 0) - Number(b?.downstreamProgress || 0) ||
          Number(a?.score || 0) - Number(b?.score || 0)
      )[0];
      const color = normalizeActiveColor(first?.color);
      if (color) {
        best = {
          color,
          startProgress: Math.max(0, Number(first?.downstreamProgress || 0)),
          source: "local",
          distance: Number(first?.score || 0),
        };
      }
    }

    const upstreamMatches = getUpstreamConnectedTrunksFor(shape);
    for (const match of upstreamMatches) {
      const upstreamActive = resolvePolylineSplitCarryActivation(match.shape, options, nextVisited);
      const upstreamColor = normalizeActiveColor(upstreamActive?.color);
      if (!upstreamColor) continue;
      const candidate = {
        color: upstreamColor,
        startProgress: 0,
        source: "upstream",
        distance: Number(match.distance || 0),
      };
      if (
        !best ||
        Number(candidate.startProgress || 0) < Number(best.startProgress || 0) ||
        (Number(candidate.startProgress || 0) === Number(best.startProgress || 0) &&
          Number(candidate.distance || 0) < Number(best.distance || 0))
      ) {
        best = candidate;
      }
    }

    splitCarryActivationCache.set(shapeId, best);
    return best;
  };

  const resolveInheritedTrunkCarryColor = (shape, options = {}, visited = new Set(), depth = 0) => {
    if (depth > 24) return "";
    const shapeId = String(shape?.id || "");
    if (!shapeId || visited.has(shapeId)) return "";
    const meta = polylineFlowMetaFor(shape);
    if (!meta?.isTrunkLike) return "";
    const nextVisited = new Set(visited);
    nextVisited.add(shapeId);

    const ownDirect = directSplitCarryCandidatesFor(shape, options);
    if (ownDirect.length) {
      const color = normalizeActiveColor(ownDirect[0]?.color);
      if (color) return color;
    }

    let best = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    const shapeEndpoints = [meta.pts[0], meta.pts[meta.pts.length - 1]].filter(Boolean);
    for (const other of shapes) {
      if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
      const otherId = String(other?.id || "");
      if (!otherId || otherId === shapeId || nextVisited.has(otherId)) continue;
      const otherMeta = polylineFlowMetaFor(other);
      if (!otherMeta?.isTrunkLike) continue;
      const otherEndpoints = [otherMeta.pts[0], otherMeta.pts[otherMeta.pts.length - 1]].filter(Boolean);
      let connectDist = Number.POSITIVE_INFINITY;
      for (const a of shapeEndpoints) {
        for (const b of otherEndpoints) {
          const d = Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
          if (d < connectDist) connectDist = d;
        }
      }
      for (const b of otherEndpoints) {
        const d = distancePointToPolyline(b, meta.pts);
        if (d < connectDist) connectDist = d;
      }
      for (const a of shapeEndpoints) {
        const d = distancePointToPolyline(a, otherMeta.pts);
        if (d < connectDist) connectDist = d;
      }
      if (connectDist > 260) continue;
      const color = resolveInheritedTrunkCarryColor(other, options, nextVisited, depth + 1);
      if (!color) continue;
      if (connectDist < bestDistance) {
        bestDistance = connectDist;
        best = color;
      }
    }
    return normalizeActiveColor(best);
  };

  const resolveConnectedTrunkCarryColor = (shape, options = {}) => {
    const seedMeta = polylineFlowMetaFor(shape);
    if (!seedMeta?.isTrunkLike) return "";
    const seedId = String(shape?.id || "");
    if (!seedId) return "";
    const trunkById = new Map();
    for (const candidate of shapes) {
      if (candidate?.type !== "polyline") continue;
      const id = String(candidate?.id || "");
      if (!id) continue;
      const meta = polylineFlowMetaFor(candidate);
      if (!meta?.isTrunkLike) continue;
      trunkById.set(id, { shape: candidate, meta });
    }
    if (!trunkById.has(seedId)) return "";

    const connected = new Set([seedId]);
    const queue = [seedId];
    while (queue.length) {
      const curId = queue.shift();
      const cur = trunkById.get(curId);
      if (!cur) continue;
      const curEndpoints = [cur.meta.pts[0], cur.meta.pts[cur.meta.pts.length - 1]].filter(Boolean);
      for (const [otherId, other] of trunkById.entries()) {
        if (connected.has(otherId) || otherId === curId) continue;
        const otherEndpoints = [other.meta.pts[0], other.meta.pts[other.meta.pts.length - 1]].filter(Boolean);
        let connectDist = Number.POSITIVE_INFINITY;
        for (const a of curEndpoints) {
          for (const b of otherEndpoints) {
            const d = Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
            if (d < connectDist) connectDist = d;
          }
        }
        for (const a of curEndpoints) {
          const d = distancePointToPolyline(a, other.meta.pts);
          if (d < connectDist) connectDist = d;
        }
        for (const b of otherEndpoints) {
          const d = distancePointToPolyline(b, cur.meta.pts);
          if (d < connectDist) connectDist = d;
        }
        if (connectDist > 260) continue;
        connected.add(otherId);
        queue.push(otherId);
      }
    }

    let bestColor = "";
    let bestProgress = Number.POSITIVE_INFINITY;
    const pickProgress = (candidate, meta) => {
      if (!candidate) return Number.POSITIVE_INFINITY;
      const progress = Number(candidate.downstreamProgress);
      if (Number.isFinite(progress)) return progress;
      const x = Number(candidate?.touchPoint?.x) || 0;
      return meta?.downstreamIsEnd ? x : -x;
    };

    for (const id of connected) {
      const rec = trunkById.get(id);
      if (!rec) continue;
      const local = directSplitCarryCandidatesFor(rec.shape, options);
      if (!local.length) continue;
      const color = normalizeActiveColor(local[0]?.color);
      if (!color) continue;
      const progress = pickProgress(local[0], rec.meta);
      if (progress < bestProgress) {
        bestProgress = progress;
        bestColor = color;
      }
    }
    return normalizeActiveColor(bestColor);
  };

  const resolveCollinearTrunkBandCarryColor = (shape, options = {}) => {
    const targetMeta = polylineFlowMetaFor(shape);
    if (!targetMeta?.isTrunkLike) return "";
    const targetPts = targetMeta.pts;
    const targetMinY = Math.min(...targetPts.map((p) => Number(p?.y) || 0));
    const targetMaxY = Math.max(...targetPts.map((p) => Number(p?.y) || 0));
    const targetMidY = (targetMinY + targetMaxY) / 2;

    let bestColor = "";
    let bestDx = Number.POSITIVE_INFINITY;
    for (const other of shapes) {
      if (other?.type !== "polyline" || !Array.isArray(other.points) || other.points.length < 2) continue;
      const otherMeta = polylineFlowMetaFor(other);
      if (!otherMeta?.isTrunkLike) continue;
      const local = directSplitCarryCandidatesFor(other, options);
      if (!local.length) continue;
      const color = normalizeActiveColor(local[0]?.color);
      if (!color) continue;

      const otherPts = otherMeta.pts;
      const otherMinY = Math.min(...otherPts.map((p) => Number(p?.y) || 0));
      const otherMaxY = Math.max(...otherPts.map((p) => Number(p?.y) || 0));
      const otherMidY = (otherMinY + otherMaxY) / 2;
      const dy = Math.abs(otherMidY - targetMidY);
      if (dy > 24) continue;

      const targetMinX = Math.min(...targetPts.map((p) => Number(p?.x) || 0));
      const otherMinX = Math.min(...otherPts.map((p) => Number(p?.x) || 0));
      const dx = Math.abs(otherMinX - targetMinX);
      if (dx < bestDx) {
        bestDx = dx;
        bestColor = color;
      }
    }
    return normalizeActiveColor(bestColor);
  };

  const polylineSplitCarrySegmentsFor = (shape, options = {}) => {
    const meta = polylineFlowMetaFor(shape);
    if (!meta?.isTrunkLike) return [];
    const localCandidates = directSplitCarryCandidatesFor(shape, options);
    if (localCandidates.length) {
      const first = [...localCandidates].sort(
        (a, b) =>
          Number(a?.downstreamProgress || 0) - Number(b?.downstreamProgress || 0) ||
          Number(a?.score || 0) - Number(b?.score || 0)
      )[0];
      const localColor = normalizeActiveColor(first?.color);
      const localPoints = buildOrderedCarryFromTouch(meta.orderedPoints, first);
      if (localColor && localPoints.length) {
        return [{ color: localColor, points: localPoints }];
      }
    }
    const activation = resolvePolylineSplitCarryActivation(shape, options);
    const chainColor = normalizeActiveColor(activation?.color);
    if (!chainColor) return [];
    const points = trimOrderedPointsFromProgress(meta.orderedPoints, activation?.startProgress || 0);
    return points.length ? [{ color: chainColor, points }] : [];
  };

  const byTagPath = {};
  const groupByTagPath = {};
  const tagColorByPath = {};
  const routeStrokeByPath = {};
  (Array.isArray(scene.tagPaths) ? scene.tagPaths : []).forEach((tagPath) => {
    const key = normalizeKey(tagPath);
    const lower = key.toLowerCase();
    byTagPath[lower] = resolveValueByTagPath(index, key);
    groupByTagPath[lower] = groupStateFor(key);
    tagColorByPath[lower] = tagColorFor(key);
    routeStrokeByPath[lower] = routeStrokeForOverlay({ tagPath: key });
  });

  const diverterEntryColorById = {};
  overlays.forEach((overlay) => {
    const overlayType = String(overlay?.eType || overlay?.name || "").trim().toLowerCase();
    if (!overlayType.includes("diverter")) return;
    diverterEntryColorById[String(overlay.id || "")] = normalizeActiveColor(
      diverterEntryColorFor(overlay, { excludedOverlayIds: [String(overlay.id || "")] })
    );
  });

  const polylineColorById = {};
  const polylineSplitCarryById = {};
  shapes.forEach((shape) => {
    const shapeId = String(shape.id || "");
    const startPoint = shape.points[0];
    const startOutputMatch = diverterOutputMatchAtPoint(startPoint, {});
    if (startOutputMatch.matched) {
      polylineColorById[shapeId] = startOutputMatch.active
        ? normalizeActiveColor(startOutputMatch.color) || "#22c55e"
        : "";
      return;
    }
    const directStartColor = connectedSourceColorAtPoint(startPoint, {});
    polylineColorById[shapeId] =
      directStartColor === null
        ? ""
        : normalizeActiveColor(
            directStartColor ||
              connectedColorFromPolyline(shape, Math.max(1, shape.points.length - 1), {})
          );
    if (polylineColorById[shapeId]) return;
    const splitCarry = polylineSplitCarrySegmentsFor(shape, {});
    if (!Array.isArray(splitCarry) || !splitCarry.length) return;
    polylineSplitCarryById[shapeId] = splitCarry
      .map((segment) => ({
        color: normalizeActiveColor(segment?.color),
        points: Array.isArray(segment?.points)
          ? segment.points
              .map((point) => ({
                x: Number(point?.x) || 0,
                y: Number(point?.y) || 0,
              }))
              .filter((point, idx, arr) => idx === 0 || !pointsNear(point, arr[idx - 1], 0.001))
          : [],
      }))
      .filter((segment) => segment.color && Array.isArray(segment.points) && segment.points.length >= 2);
  });

  return {
    byTagPath,
    groupByTagPath,
    tagColorByPath,
    routeStrokeByPath,
    diverterEntryColorById,
    polylineColorById,
    polylineSplitCarryById,
  };
}

self.onmessage = (event) => {
  const payload = event?.data || {};
  const type = String(payload?.type || "");
  if (type === "setScene") {
    sceneState = normalizeScene(payload?.scene);
    return;
  }
  if (type !== "resolve") return;
  const id = Number(payload?.id || 0);
  const liveValues = payload?.liveValues && typeof payload.liveValues === "object" ? payload.liveValues : {};
  const index = createLiveIndex(liveValues);
  const resolved = resolveLiveVisualState(index, sceneState);
  self.postMessage({ type: "resolved", id, ...resolved });
};
