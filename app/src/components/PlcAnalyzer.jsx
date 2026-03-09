import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toastError, toastInfo, toastSuccess } from "../utils/toast";
import udtLibraryRaw from "../assets/udt.L5X?raw";
import aoiLibraryRaw from "../assets/aoi-library.L5X?raw";

const CODE_GEN_GROUP_TYPES = ["Route", "SubRoute", "Sender", "Receiver", "Bin", "Group", "Equipment"];
const CODE_GEN_GROUP_SUBTYPES = ["Feed", "Way", "Machine"];
const CODE_GEN_FORMATS = ["l5x-template", "list", "io-map"];
const GLOBAL_CODE_GEN_BASE_KEY = "__global_l5x_base__";
const REQUIRED_BATCHCONTROL_TYPES = [
  "BatchControl",
  "BatchControl_Bin",
  "BatchControl_HMI_Read",
  "BatchControl_HMI_Write",
  "BatchControl_Mixer",
  "BatchControl_Plc",
  "BatchControl_Recipe",
  "BatchControl_RecipeIngr",
  "BatchController",
  "BatchController_RecipeCheck",
  "BatchController_SimWeight",
  "BinControl_Mgr",
  "BinController",
  "BinController_Initialize",
  "BinController_BinUpdate",
  "BinController_RecipeCheck",
  "BinController_JobChange",
];

function normalizeCodeGenFormat(value) {
  const raw = String(value || "").trim().toLowerCase();
  return CODE_GEN_FORMATS.includes(raw) ? raw : "l5x-template";
}

function normalizeCodeGenGroupType(value) {
  const raw = String(value || "").trim();
  if (!raw) return "Group";
  if (raw.toLowerCase() === "object") return "Group";
  if (CODE_GEN_GROUP_SUBTYPES.some((item) => item.toLowerCase() === raw.toLowerCase())) return "Group";
  const matched = CODE_GEN_GROUP_TYPES.find((item) => item.toLowerCase() === raw.toLowerCase());
  return matched || "Group";
}

function getCodeGenObjectNameHint(groupTypeRaw) {
  const groupType = normalizeCodeGenGroupType(groupTypeRaw);
  if (groupType === "Route") return "Route Number";
  if (groupType === "Group") return "Group Number";
  if (groupType === "SubRoute") return "SubRoute Number";
  if (groupType === "Sender") return "Sender Number";
  if (groupType === "Receiver") return "Receiver Number";
  if (groupType === "Bin") return "Bin Number";
  if (groupType === "Equipment") return "Equipment Name";
  return "Object Name";
}

function getCodeGenObjectInputTooltip(groupTypeRaw) {
  const groupType = normalizeCodeGenGroupType(groupTypeRaw);
  if (groupType === "Route") return "Enter route number(s): 1 or 1-4 or 1,3,5-7";
  if (groupType === "Group") return "Enter group number(s): 1 or 1-4 or 1,3,5-7";
  if (groupType === "SubRoute") return "Enter subroute number(s): 1 or 1-4 or 1,3,5-7";
  if (groupType === "Sender") return "Enter sender number(s): 1 or 1-4 or 1,3,5-7";
  if (groupType === "Receiver") return "Enter receiver number(s): 1 or 1-4 or 1,3,5-7";
  if (groupType === "Bin") return "Enter bin number(s): 1 or 1-4 or 1,3,5-7. Name is saved as Bin<number>.";
  return "Enter object name.";
}

function normalizeCodeGenSubRouteObjectName(nameRaw, routeNameRaw) {
  const routeName = String(routeNameRaw || "").trim();
  let core = String(nameRaw || "").trim().replace(/\s+/g, "");
  if (!core) return "";
  if (routeName) {
    const escapedRoute = routeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    core = core.replace(new RegExp(`^${escapedRoute}_?`, "i"), "");
  }
  core = core.replace(/^subroute/i, "");
  core = core.replace(/^sr/i, "");
  core = core.replace(/^_+/, "");
  core = core.replace(/\D+/g, "");
  if (!core) return "";
  return routeName ? `${routeName}_${core}` : core;
}

function expandSubRouteNumberInput(rawValue) {
  const raw = String(rawValue || "").replace(/\s+/g, "");
  if (!raw) return [];
  const parts = raw.split(",").map((x) => String(x || "").trim()).filter(Boolean);
  if (!parts.length) return [];
  const out = [];
  const seen = new Set();
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const n = Number.parseInt(part, 10);
      if (!Number.isFinite(n) || n <= 0) return [];
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
      continue;
    }
    const m = part.match(/^(\d+)-(\d+)$/);
    if (!m) return [];
    const a = Number.parseInt(String(m[1] || ""), 10);
    const b = Number.parseInt(String(m[2] || ""), 10);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return [];
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    for (let n = low; n <= high; n += 1) {
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
  }
  return out;
}

function getCodeGenObjectKindLabel(kindRaw, count = 1) {
  const kind = String(kindRaw || "").trim().toLowerCase();
  if (kind === "route") return count === 1 ? "route" : "routes";
  if (kind === "subroute") return count === 1 ? "subroute" : "subroutes";
  if (kind === "sender") return count === 1 ? "sender" : "senders";
  if (kind === "receiver") return count === 1 ? "receiver" : "receivers";
  if (kind === "bin") return count === 1 ? "bin" : "bins";
  return count === 1 ? "group" : "groups";
}

function normalizeCodeGenGroupObjectName(nameRaw, groupTypeRaw, groupSubTypeRaw) {
  const name = String(nameRaw || "").trim();
  const groupType = normalizeCodeGenGroupType(groupTypeRaw);
  if (!name) return "";
  if (groupType === "Route") {
    let core = name.replace(/\s+/g, "");
    core = core.replace(/^route/i, "");
    core = core.replace(/\D+/g, "");
    if (!core) return "";
    return `Route${core}`;
  }
  if (groupType === "Sender") {
    let core = name.replace(/\s+/g, "");
    core = core.replace(/^sender/i, "");
    core = core.replace(/^snd/i, "");
    core = core.replace(/^_+/, "");
    core = core.replace(/\D+/g, "");
    if (!core) return "";
    return `Snd${core}`;
  }
  if (groupType === "Receiver") {
    let core = name.replace(/\s+/g, "");
    core = core.replace(/^receiver/i, "");
    core = core.replace(/^rcv/i, "");
    core = core.replace(/^_+/, "");
    core = core.replace(/\D+/g, "");
    if (!core) return "";
    return `Rcv${core}`;
  }
  if (groupType === "Bin") {
    let core = name.replace(/\s+/g, "");
    core = core.replace(/^bin/i, "");
    core = core.replace(/^_+/, "");
    core = core.replace(/\D+/g, "");
    if (!core) return "";
    return `Bin${core}`;
  }
  if (groupType !== "Group") return name;
  const suffixSource = String(groupSubTypeRaw || "Feed").trim();
  const suffix = String(suffixSource.charAt(0) || "G").toUpperCase();
  let core = name.replace(/\s+/g, "");
  if (/^g/i.test(core)) core = core.slice(1);
  if (core && new RegExp(`${suffix}$`, "i").test(core)) core = core.slice(0, -1);
  core = core.replace(/\D+/g, "");
  if (!core) return "";
  const paddedCore = core.length >= 3 ? core : core.padStart(3, "0");
  return `G${paddedCore}${suffix}`;
}

function extractCodeGenBinNumber(valueRaw) {
  const raw = String(valueRaw || "").trim();
  if (!raw) return "";
  const direct = raw.match(/^bin_?(\d+)$/i);
  if (direct) return String(Number.parseInt(String(direct[1] || ""), 10));
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

function extractCodeGenRouteNumber(valueRaw) {
  const raw = String(valueRaw || "").trim();
  if (!raw) return "";
  const direct = raw.match(/^route_?(\d+)$/i);
  if (direct) return String(Number.parseInt(String(direct[1] || ""), 10));
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return "";
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

function collectAutoTagStubsFromRoutineXml(routineXmlBlocks = []) {
  const instructionNames = new Set(
    [
      "AFI",
      "CPS",
      "CTD",
      "CTU",
      "EQ",
      "GSV",
      "JSR",
      "LIMIT",
      "MOVE",
      "NE",
      "NOP",
      "ONS",
      "OTE",
      "OTL",
      "OTU",
      "RES",
      "TON",
      "XIC",
      "XIO",
    ].map((x) => x.toLowerCase())
  );
  const tagTypeByName = new Map();
  const inferAndSet = (name, logicText) => {
    const tag = String(name || "").trim();
    if (!tag || /^s:/i.test(tag)) return;
    if (/\{|\}/.test(tag)) return;
    if (isProjectSpecificTagName(tag)) return;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const counterUsage = new RegExp(`\\b(?:CTU|CTD)\\s*\\(\\s*${escaped}(?:\\b|\\s|[),.\\[])`, "i");
    const timerUsage = new RegExp(`\\b(?:RES|TON)\\s*\\(\\s*${escaped}(?:\\b|\\s|[),.\\[])`, "i");
    const boolUsage = new RegExp(`\\b(?:ONS|XIC|XIO|OTE|OTL|OTU)\\s*\\(\\s*${escaped}(?:\\b|\\s|[),.\\[])`, "i");
    const gsvDestUsage = new RegExp(`\\bGSV\\s*\\([^\\)]*,[^\\)]*,[^\\)]*,\\s*${escaped}(?:\\b|\\s|[),.\\[])`, "i");
    const current = String(tagTypeByName.get(tag) || "");
    let next = current || "DINT";
    if (counterUsage.test(logicText)) next = "COUNTER";
    else if (timerUsage.test(logicText)) next = "TIMER";
    else if (boolUsage.test(logicText)) next = (current === "TIMER" || current === "COUNTER") ? current : "BOOL";
    else if (gsvDestUsage.test(logicText)) next = current || "DINT";
    if (!current || (current !== "COUNTER" && next === "COUNTER") || (current !== "TIMER" && next === "TIMER")) {
      tagTypeByName.set(tag, next);
    }
    else if (!current) tagTypeByName.set(tag, next);
  };
  (Array.isArray(routineXmlBlocks) ? routineXmlBlocks : []).forEach((block) => {
    const textMatches = Array.from(String(block || "").matchAll(/<Text\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/gi)).map((m) =>
      String(m?.[1] || "")
    );
    const logicText = textMatches.join("\n");
    if (!logicText.trim()) return;
    const identifiers = Array.from(
      logicText.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?::[A-Za-z_][A-Za-z0-9_]*)?(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]]+\])*)\b/g)
    )
      .map((m) => String(m?.[1] || "").trim())
      .filter(Boolean);
    identifiers.forEach((id) => {
      const base = String(id || "").split(".")[0].split("[")[0].trim();
      if (!base) return;
      if (instructionNames.has(base.toLowerCase())) return;
      if (/^[0-9]+$/.test(base)) return;
      if (/\{|\}/.test(base)) return;
      if (isProjectSpecificTagName(base)) return;
      inferAndSet(base, logicText);
    });
  });
  return Array.from(tagTypeByName.entries()).map(([name, dataType]) => ({
    name,
    dataType: String(dataType || "DINT"),
    block: `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="${String(dataType || "DINT")}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`,
  }));
}

function collectGeneralAlarmTagStubsFromRoutineXml(routineXmlBlocks = []) {
  const tagTypeByName = new Map();
  const normalizeAlarmStubName = (valueRaw) => {
    const raw = String(valueRaw || "").trim();
    if (!raw) return "";
    const base = raw.split(".")[0].trim();
    return base;
  };
  const put = (nameRaw, dataTypeRaw) => {
    const name = normalizeAlarmStubName(nameRaw);
    const dataType = String(dataTypeRaw || "").trim() || "DINT";
    if (!name) return;
    if (!tagTypeByName.has(name)) tagTypeByName.set(name, dataType);
  };
  const parseArgs = (raw) =>
    String(raw || "")
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean);
  (Array.isArray(routineXmlBlocks) ? routineXmlBlocks : []).forEach((block) => {
    const textMatches = Array.from(String(block || "").matchAll(/<Text\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/gi)).map((m) =>
      String(m?.[1] || "")
    );
    const logicText = textMatches.join("\n");
    if (!logicText.trim()) return;
    const simpleMatches = Array.from(logicText.matchAll(/\bSimpleAlarm\s*\(([^)]*)\)/gi));
    simpleMatches.forEach((m) => {
      const args = parseArgs(m?.[1] || "");
      if (args[0]) put(args[0], "SimpleAlarm");
      if (args[1]) put(args[1], "BOOL");
      if (args[2]) put(args[2], "BOOL");
      if (args[3]) put(args[3], "BOOL");
      if (args[4]) put(args[4], "DINT");
    });
    const blockMatches = Array.from(logicText.matchAll(/\bAlarmBlock\s*\(([^)]*)\)/gi));
    blockMatches.forEach((m) => {
      const args = parseArgs(m?.[1] || "");
      if (args[0]) put(args[0], "AlarmBlock");
      if (args[1]) put(args[1], "BOOL");
      if (args[2]) put(args[2], "BOOL");
      if (args[3]) put(args[3], "BOOL");
    });
  });
  return Array.from(tagTypeByName.entries()).map(([name, dataType]) => ({
    name,
    dataType,
    block: `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="${dataType}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`,
  }));
}

function collectGeneralAlarmTagStubsFromRawText(rawText = "") {
  const src = String(rawText || "");
  if (!src.trim()) return [];
  const tagTypeByName = new Map();
  const normalizeAlarmStubName = (valueRaw) => {
    const raw = String(valueRaw || "").trim();
    if (!raw) return "";
    const base = raw.split(".")[0].trim();
    return base;
  };
  const put = (nameRaw, dataTypeRaw) => {
    const name = normalizeAlarmStubName(nameRaw);
    const dataType = String(dataTypeRaw || "").trim() || "DINT";
    if (!name) return;
    if (!tagTypeByName.has(name)) tagTypeByName.set(name, dataType);
  };
  const parseArgs = (raw) =>
    String(raw || "")
      .split(",")
      .map((x) => String(x || "").trim())
      .filter(Boolean);
  const simpleMatches = Array.from(src.matchAll(/\bSimpleAlarm\s*\(([^)]*)\)/gi));
  simpleMatches.forEach((m) => {
    const args = parseArgs(m?.[1] || "");
    if (args[0]) put(args[0], "SimpleAlarm");
    if (args[1]) put(args[1], "BOOL");
    if (args[2]) put(args[2], "BOOL");
    if (args[3]) put(args[3], "BOOL");
    if (args[4]) put(args[4], "DINT");
  });
  const blockMatches = Array.from(src.matchAll(/\bAlarmBlock\s*\(([^)]*)\)/gi));
  blockMatches.forEach((m) => {
    const args = parseArgs(m?.[1] || "");
    if (args[0]) put(args[0], "AlarmBlock");
    if (args[1]) put(args[1], "BOOL");
    if (args[2]) put(args[2], "BOOL");
    if (args[3]) put(args[3], "BOOL");
  });
  // Fallbacks for templates that reference alarm tags but where routine extraction misses blocks.
  const knownNames = [
    ["AlarmPowerFail", "SimpleAlarm"],
    ["AlarmUPSFail", "SimpleAlarm"],
    ["EquipStopAlarms", "AlarmBlock"],
    ["Site_PowerOK", "BOOL"],
    ["UPS_PowerOK", "BOOL"],
    ["AlarmHornReset", "BOOL"],
    ["SiteAlarmReset", "BOOL"],
    ["AlarmPowerFail_i_DebounceTime", "DINT"],
    ["AlarmUPSFail_i_DebounceTime", "DINT"],
  ];
  knownNames.forEach(([name, dataType]) => {
    // Always include baseline alarm tags so GeneralAlarms AOI arguments resolve.
    put(name, dataType);
  });
  Array.from(src.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*DebounceTime)\b/g)).forEach((m) => {
    if (m?.[1]) put(m[1], "DINT");
  });
  return Array.from(tagTypeByName.entries()).map(([name, dataType]) => ({
    name,
    dataType,
    block: `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="${dataType}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`,
  }));
}

function normalizeSpecialCodeGenTagBlock(nameRaw, blockRaw, dataTypeRaw = "") {
  const name = String(nameRaw || "").trim();
  const lower = name.toLowerCase();
  if (!name) return String(blockRaw || "");
  if (lower === "alarmpowerfail" || lower === "alarmupsfail") {
    return `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="SimpleAlarm" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`;
  }
  if (lower === "equipstopalarms") {
    return `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="AlarmBlock" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`;
  }
  if (lower === "site_powerok" || lower === "ups_powerok") {
    return `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="BOOL" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`;
  }
  if (lower === "alarmhornreset" || lower === "sitealarmreset") {
    return `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="BOOL" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`;
  }
  if (lower === "alarm_counters") {
    return `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="COUNTER" Dimensions="20" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`;
  }
  if (lower === "alarmhornsons") {
    return `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="BOOL" Dimensions="20" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`;
  }
  const block = String(blockRaw || "");
  if (!block) {
    const dt = String(dataTypeRaw || "DINT");
    return `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="${dt}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`;
  }
  return block;
}

function getRequiredGeneralAlarmTagBlocks() {
  return [
    '<Tag Name="AlarmPowerFail" Class="Standard" TagType="Base" DataType="SimpleAlarm" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    '<Tag Name="AlarmUPSFail" Class="Standard" TagType="Base" DataType="SimpleAlarm" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    '<Tag Name="EquipStopAlarms" Class="Standard" TagType="Base" DataType="AlarmBlock" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    '<Tag Name="Site_PowerOK" Class="Standard" TagType="Base" DataType="BOOL" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    '<Tag Name="UPS_PowerOK" Class="Standard" TagType="Base" DataType="BOOL" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    '<Tag Name="AlarmHornReset" Class="Standard" TagType="Base" DataType="BOOL" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    '<Tag Name="SiteAlarmReset" Class="Standard" TagType="Base" DataType="BOOL" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    '<Tag Name="AlarmPowerFail_i_DebounceTime" Class="Standard" TagType="Base" DataType="DINT" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
    '<Tag Name="AlarmUPSFail_i_DebounceTime" Class="Standard" TagType="Base" DataType="DINT" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>',
  ];
}

function ensureGeneralAlarmTagsInL5x(rawXml = "") {
  const xml = String(rawXml || "");
  if (!xml.trim()) return xml;
  const requiredBlocks = getRequiredGeneralAlarmTagBlocks();
  const missingBlocks = requiredBlocks.filter((block) => {
    const nameMatch = String(block).match(/\bName="([^"]+)"/i);
    const name = String(nameMatch?.[1] || "").trim();
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`<Tag\\b[^>]*\\bName="${escaped}"\\b`, "i").test(xml);
  });
  if (!missingBlocks.length) return xml;
  const injectedLines = missingBlocks.map((b) => `      ${b}`).join("\n");
  if (/<Tags\b[^>]*>[\s\S]*?<\/Tags>/i.test(xml)) {
    return xml.replace(/<Tags\b([^>]*)>([\s\S]*?)<\/Tags>/i, (_full, attrs, inner) => {
      const current = String(inner || "");
      const spacer = current.trim() ? "\n" : "";
      return `<Tags${String(attrs || "")}>${current}${spacer}${injectedLines}\n    </Tags>`;
    });
  }
  if (/<Tags\s*\/>/i.test(xml)) {
    return xml.replace(/<Tags\s*\/>/i, `<Tags>\n${injectedLines}\n    </Tags>`);
  }
  if (/<Programs\b/i.test(xml)) {
    return xml.replace(/<Programs\b/i, `    <Tags>\n${injectedLines}\n    </Tags>\n<Programs`);
  }
  return xml;
}

function normalizeL5xDimensionValue(valueRaw) {
  const raw = String(valueRaw || "").trim();
  if (!raw) return "";
  const stripped = raw.replace(/^\[|\]$/g, "").replace(/\s+/g, "");
  if (!stripped) return "";
  const parts = stripped.split(",").map((x) => String(x || "").trim()).filter(Boolean);
  if (!parts.length || parts.length > 3) return "";
  const normalized = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return "";
    const n = Number.parseInt(part, 10);
    if (!Number.isFinite(n) || n <= 0) return "";
    normalized.push(String(n));
  }
  return normalized.join(",");
}

function sanitizeL5xIdentifier(rawValue = "", maxLen = 40) {
  let value = String(rawValue || "").trim();
  if (!value) return "";
  value = value.replace(/\{\{[^}]+\}\}/g, "1");
  value = value.replace(/\{[^}]+\}/g, "_");
  value = value.replace(/[^\w]/g, "_");
  value = value.replace(/_+/g, "_");
  value = value.replace(/^_+|_+$/g, "");
  if (!value) return "";
  if (/^\d/.test(value)) value = `N${value}`;
  if (value.length > maxLen) value = value.slice(0, maxLen);
  return value;
}

function normalizeL5xDataTypeRef(rawValue = "") {
  const raw = String(rawValue || "").trim();
  if (!raw) return { dataType: "", dimension: "" };
  const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[([^\]]+)\])?$/);
  if (!m) {
    return {
      dataType: sanitizeL5xIdentifier(raw, 40),
      dimension: "",
    };
  }
  const base = sanitizeL5xIdentifier(String(m[1] || ""), 40);
  const dim = normalizeL5xDimensionValue(String(m[2] || ""));
  return { dataType: base, dimension: dim };
}

function isProjectSpecificTagName(nameRaw = "") {
  const name = String(nameRaw || "").trim();
  if (!name) return false;
  return /^(?:ho_|ww_)/i.test(name);
}

function dedupeL5xDataTypeMemberBlocks(rawXml = "") {
  const src = String(rawXml || "");
  if (!src.trim()) return src;
  return src.replace(/<DataType\b([^>]*)>([\s\S]*?)<\/DataType>/gi, (full, attrs, body) => {
    const bodyText = String(body || "");
    const membersSections = [
      ...Array.from(bodyText.matchAll(/<Members\b[^>]*>([\s\S]*?)<\/Members>/gi)).map((m) => ({
        full: String(m?.[0] || ""),
        inner: String(m?.[1] || ""),
      })),
      ...Array.from(bodyText.matchAll(/<Members\b[^>]*\/>/gi)).map((m) => ({
        full: String(m?.[0] || ""),
        inner: "",
      })),
    ];
    if (!membersSections.length) return full;
    const seen = new Set();
    const keptMembers = [];
    membersSections.forEach((section) => {
      const sectionBody = String(section?.inner || "");
      Array.from(sectionBody.matchAll(/<Member\b[\s\S]*?(?:\/>|>[\s\S]*?<\/Member>)/gi)).forEach((m) => {
        const memberBlock = String(m?.[0] || "");
        const head = memberBlock.match(/<Member\b([^>]*)/i);
        const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
        const key = name.toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        keptMembers.push(memberBlock);
      });
    });
    const membersXml = keptMembers.length ? `<Members>\n    ${keptMembers.join("\n    ")}\n  </Members>` : "<Members/>";
    let nextBody = bodyText;
    const firstSection = membersSections[0];
    nextBody = nextBody.replace(firstSection.full, membersXml);
    for (let i = 1; i < membersSections.length; i += 1) {
      nextBody = nextBody.replace(membersSections[i].full, "");
    }
    return `<DataType${String(attrs || "")}>${nextBody}</DataType>`;
  });
}

function dedupeL5xBlocksByName(rawXml = "", tagName = "") {
  const xml = String(rawXml || "");
  const element = String(tagName || "").trim();
  if (!xml.trim() || !element) return xml;
  const re = new RegExp(`<${element}\\b[\\s\\S]*?<\\/${element}>`, "gi");
  const seen = new Set();
  return xml.replace(re, (block) => {
    const head = String(block || "").match(new RegExp(`<${element}\\b([^>]*)>`, "i"));
    const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
    const key = name.toLowerCase();
    if (!key) return block;
    if (seen.has(key)) return "";
    seen.add(key);
    return block;
  });
}

function sanitizeGeneratedL5xForImport(rawXml = "") {
  let out = String(rawXml || "");
  if (!out.trim()) return out;
  // Replace unresolved template tokens only. Avoid rewriting AOI logic payload.
  out = out.replace(/\{\{[^}]+\}\}/g, "1");
  out = out.replace(/\{Route\}/g, "Route1");

  // Keep AOI metadata minimal without touching AOI internals.
  out = out.replace(
    /<AddOnInstructionDefinition\b([^>]*)>/gi,
    (_full, attrs) => {
      let cleaned = String(attrs || "");
      cleaned = cleaned.replace(/\s+\b(?:Revision|RevisionExtended|CreatedDate|EditedDate|SoftwareRevision)\s*=\s*"[^"]*"/gi, "");
      cleaned = cleaned.replace(/\s+\b(?:Revision|RevisionExtended|CreatedDate|EditedDate|SoftwareRevision)\s*=\s*'[^']*'/gi, "");
      return `<AddOnInstructionDefinition${cleaned}>`;
    }
  );
  out = out.replace(/<Parameter\b([^>]*)>([\s\S]*?)<\/Parameter>/gi, (_m, attrs, body) => {
    const cleanedBody = String(body || "").replace(/<Comments\b[^>]*>[\s\S]*?<\/Comments>/gi, "");
    return `<Parameter${String(attrs || "")}>${cleanedBody}</Parameter>`;
  });

  // Normalize controller tags and drop project-specific tags.
  out = out.replace(/<Tag\b[\s\S]*?(?:\/>|>[\s\S]*?<\/Tag>)/gi, (block) => {
    const open =
      String(block || "").match(/<Tag\b([^>]*)\/>/i) ||
      String(block || "").match(/<Tag\b([^>]*)>/i);
    const attrs = String(open?.[1] || "");
    const originalName = extractAttr(attrs, "Name");
    const safeName = sanitizeL5xIdentifier(originalName, 40);
    if (!safeName) return "";
    if (isProjectSpecificTagName(safeName)) return "";
    const originalDataType = extractAttr(attrs, "DataType");
    const normalizedType = normalizeL5xDataTypeRef(originalDataType);
    const safeDataType = normalizedType.dataType || "DINT";
    const className = String(extractAttr(attrs, "Class") || "Standard").trim() || "Standard";
    const tagType = String(extractAttr(attrs, "TagType") || "Base").trim() || "Base";
    const constant = String(extractAttr(attrs, "Constant") || "false").trim() || "false";
    const externalAccess = String(extractAttr(attrs, "ExternalAccess") || "Read/Write").trim() || "Read/Write";
    const opcUaAccess = String(extractAttr(attrs, "OpcUaAccess") || "None").trim() || "None";
    const dimRaw =
      extractAttr(attrs, "Dimensions") ||
      extractAttr(attrs, "Dimension") ||
      extractAttr(attrs, "ArrayDimensions");
    const dim = normalizeL5xDimensionValue(dimRaw);
    return `<Tag Name="${safeName}" Class="${className}" TagType="${tagType}" DataType="${safeDataType}"${
      dim ? ` Dimensions="${dim}"` : ""
    } Constant="${constant}" ExternalAccess="${externalAccess}" OpcUaAccess="${opcUaAccess}"/>`;
  });

  // Normalize UDT members only.
  out = out.replace(/<DataType\b([^>]*)>([\s\S]*?)<\/DataType>/gi, (full, dtAttrs, dtBody) => {
    let attrs = String(dtAttrs || "");
    const dtName = extractAttr(attrs, "Name");
    if (dtName && /\{|\}/.test(dtName)) {
      const safeDtName = sanitizeL5xIdentifier(dtName, 40) || "DataType";
      attrs = attrs.replace(/\bName\s*=\s*"[^"]*"/i, `Name="${safeDtName}"`);
    }
    let body = String(dtBody || "");
    body = body.replace(/<Member\b([^>]*?)(\/?)>/gi, (_m, memberAttrs, selfClose) => {
      let cleaned = String(memberAttrs || "");
      const originalName = extractAttr(cleaned, "Name");
      if (originalName && /\{|\}/.test(originalName)) {
        const safeName = sanitizeL5xIdentifier(originalName, 64) || "Member";
        cleaned = cleaned.replace(/\bName\s*=\s*"[^"]*"/i, `Name="${safeName}"`);
      }
      const originalDataType = extractAttr(cleaned, "DataType");
      if (originalDataType) {
        const normalized = normalizeL5xDataTypeRef(originalDataType);
        const safeDataType = normalized.dataType || originalDataType;
        cleaned = cleaned.replace(/\bDataType\s*=\s*"[^"]*"/i, `DataType="${safeDataType}"`);
        const hasDim = /\b(?:Dimension|Dimensions|ArrayDimensions)\s*=\s*["'][^"']*["']/i.test(cleaned);
        if (!hasDim && normalized.dimension) cleaned += ` Dimension="${normalized.dimension}"`;
      }
      cleaned = cleaned.replace(/\s+\b(?:Dimension|Dimensions|ArrayDimensions)\s*=\s*"([^"]*)"/gi, (_mm, v) => {
        const dim = normalizeL5xDimensionValue(v);
        return dim ? ` Dimension="${dim}"` : "";
      });
      cleaned = cleaned.replace(/\s+\b(?:Dimension|Dimensions|ArrayDimensions)\s*=\s*'([^']*)'/gi, (_mm, v) => {
        const dim = normalizeL5xDimensionValue(v);
        return dim ? ` Dimension="${dim}"` : "";
      });
      const close = String(selfClose || "").trim() ? " /" : "";
      return `<Member${cleaned}${close}>`;
    });
    return `<DataType${attrs}>${body}</DataType>`;
  });

  // Controller tags are emitted in normalized form upstream; avoid rewriting here.
  out = dedupeL5xDataTypeMemberBlocks(out);
  out = dedupeL5xBlocksByName(out, "DataType");
  out = dedupeL5xBlocksByName(out, "AddOnInstructionDefinition");
  return out;
}

function extractAllDataTypeNames(rawText = "") {
  return Array.from(
    new Set(
      Array.from(String(rawText || "").matchAll(/<DataType\b([^>]*)>/gi))
        .map((m) => String(extractAttr(String(m?.[1] || ""), "Name") || "").trim())
        .filter(Boolean)
    )
  );
}

function buildFallbackObjectTagBlocks(options = {}) {
  const knownTypeNames = new Set(
    (Array.isArray(options?.knownTypeNames) ? options.knownTypeNames : [])
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const pickType = (preferred) => {
    const t = String(preferred || "").trim();
    if (!t) return "DINT";
    return knownTypeNames.has(t.toLowerCase()) ? t : "DINT";
  };
  const routeNames = Array.isArray(options?.routeNames) ? options.routeNames : [];
  const subRouteNames = Array.isArray(options?.subRouteNames) ? options.subRouteNames : [];
  const ioNames = Array.isArray(options?.ioNames) ? options.ioNames : [];
  const binNames = Array.isArray(options?.binNames) ? options.binNames : [];
  const blocks = [];
  const pushTag = (nameRaw, preferredType) => {
    const name = String(nameRaw || "").trim();
    if (!name) return;
    const dataType = pickType(preferredType);
    blocks.push(
      `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="${dataType}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
    );
  };
  routeNames.forEach((name) => pushTag(name, "Route"));
  subRouteNames.forEach((name) => pushTag(name, "Route"));
  ioNames.forEach((name) => pushTag(name, "BinControl"));
  binNames.forEach((name) => pushTag(name, "BatchControl_Bin"));
  return blocks;
}

function indentBlock(text, prefix = "    ") {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function extractRouteDataTypeXmlBlocks(rawText, selectedRouteNumbers = []) {
  const src = String(rawText || "");
  if (!src) return [];
  const builtIn = new Set([
    "bool",
    "bit",
    "sint",
    "int",
    "dint",
    "lint",
    "usint",
    "uint",
    "udint",
    "ulint",
    "real",
    "lreal",
    "string",
    "time",
    "date",
    "datetime",
    "tod",
    "timer",
    ]);
  const blocks = [];
  const blockByName = new Map();
  const re = /<DataType\b[\s\S]*?<\/DataType>/gi;
  let match = re.exec(src);
  while (match) {
    const block = String(match[0] || "");
    const headMatch = block.match(/<DataType\b([^>]*)>/i);
    const name = headMatch ? extractAttr(String(headMatch[1] || ""), "Name") : "";
    const refs = Array.from(
      new Set(
        Array.from(block.matchAll(/\bDataType\s*=\s*"([^"]+)"/gi))
          .map((m) => String(m?.[1] || "").trim())
          .filter(Boolean)
      )
    );
    blocks.push({ name: String(name || "").trim(), block, refs });
    if (String(name || "").trim()) blockByName.set(String(name).trim().toLowerCase(), { block, refs });
    match = re.exec(src);
  }
  const selectedNums = new Set(
    (Array.isArray(selectedRouteNumbers) ? selectedRouteNumbers : [])
      .map((n) => String(n || "").trim())
      .filter(Boolean)
  );
  const includeByRouteNumber = (nameRaw) => {
    const name = String(nameRaw || "");
    if (!/route/i.test(name)) return false;
    const m = name.match(/route\s*([0-9]+)/i);
    if (!m) return true; // shared Route types (no explicit number)
    if (!selectedNums.size) return true;
    return selectedNums.has(String(m[1] || "").trim());
  };
  const queue = blocks
    .filter((x) => includeByRouteNumber(x?.name))
    .map((x) => String(x.name || "").trim())
    .filter(Boolean);
  const include = new Set(queue.map((x) => x.toLowerCase()));
  while (queue.length) {
    const current = String(queue.shift() || "").trim().toLowerCase();
    const row = blockByName.get(current);
    if (!row) continue;
    (Array.isArray(row.refs) ? row.refs : []).forEach((ref) => {
      const refName = String(ref || "").trim();
      if (!refName) return;
      const refKey = refName.toLowerCase();
      if (builtIn.has(refKey)) return;
      if (!blockByName.has(refKey)) return;
      if (include.has(refKey)) return;
      include.add(refKey);
      queue.push(refName);
    });
  }
  return blocks
    .filter((x) => include.has(String(x?.name || "").trim().toLowerCase()))
    .map((x) => x.block);
}

function extractNamedRouteDataTypeBlocks(rawText) {
  const src = String(rawText || "");
  if (!src) return [];
  const out = [];
  const re = /<DataType\b[\s\S]*?<\/DataType>/gi;
  let match = re.exec(src);
  while (match) {
    const block = String(match[0] || "");
    const headMatch = block.match(/<DataType\b([^>]*)>/i);
    const name = headMatch ? extractAttr(String(headMatch[1] || ""), "Name") : "";
    if (!String(name || "").trim()) {
      match = re.exec(src);
      continue;
    }
    if (!/route/i.test(String(name || ""))) {
      match = re.exec(src);
      continue;
    }
    out.push({ name: String(name).trim(), block });
    match = re.exec(src);
  }
  return out;
}

function extractNamedDataTypeBlocks(rawText) {
  const src = String(rawText || "");
  if (!src) return [];
  const out = [];
  const re = /<DataType\b[\s\S]*?<\/DataType>/gi;
  let match = re.exec(src);
  while (match) {
    const block = String(match[0] || "");
    const headMatch = block.match(/<DataType\b([^>]*)>/i);
    const name = headMatch ? extractAttr(String(headMatch[1] || ""), "Name") : "";
    if (!String(name || "").trim()) {
      match = re.exec(src);
      continue;
    }
    const refs = Array.from(
      new Set(
        Array.from(block.matchAll(/\bDataType\s*=\s*"([^"]+)"/gi))
          .map((m) => String(m?.[1] || "").trim())
          .filter(Boolean)
      )
    );
    out.push({ name: String(name).trim(), block, refs });
    match = re.exec(src);
  }
  return out;
}

function buildSharedStarterDataTypeBlocks(rawText) {
  const allBlocks = extractNamedDataTypeBlocks(rawText);
  if (!allBlocks.length) return [];
  const dedup = new Map();
  allBlocks.forEach((row) => {
    const name = String(row?.name || "").trim();
    if (!name) return;
    if (/^route\d+/i.test(name) && !/^route1data(?:_|$)/i.test(name)) return;
    dedup.set(name.toLowerCase(), String(row?.block || ""));
  });
  return Array.from(dedup.values());
}

function parseAoiLibraryBlocks(rawText) {
  const src = String(rawText || "");
  if (!src) return [];
  const out = [];
  const re = /<(AddOnInstructionDefinition|EncodedData)\b[\s\S]*?<\/\1>/gi;
  let match = re.exec(src);
  while (match) {
    const block = String(match[0] || "");
    const tag = String(match[1] || "").trim().toLowerCase();
    const head = block.match(/<(AddOnInstructionDefinition|EncodedData)\b([^>]*)>/i);
    const attrs = head ? String(head[2] || "") : "";
    const encodedType = String(extractAttr(attrs, "EncodedType") || "").trim();
    if (tag === "encodeddata" && !/^addoninstructiondefinition$/i.test(encodedType)) {
      match = re.exec(src);
      continue;
    }
    const name = String(extractAttr(attrs, "Name") || "").trim();
    const refs = Array.from(
      new Set(
        Array.from(block.matchAll(/\bDataType\s*=\s*"([^"]+)"/gi))
          .map((m) => String(m?.[1] || "").trim().toLowerCase())
          .filter(Boolean)
      )
    );
    out.push({ block, name, key: name.toLowerCase(), refs, encoded: tag === "encodeddata" });
    match = re.exec(src);
  }
  return out;
}

function buildBinControlTemplateDataTypeBlocks(rawText, objectNames = []) {
  const allBlocks = extractNamedDataTypeBlocks(rawText);
  if (!allBlocks.length) return [];
  const names = Array.from(
    new Set((Array.isArray(objectNames) ? objectNames : []).map((v) => String(v || "").trim()).filter(Boolean))
  );
  if (!names.length) return [];
  const shared = allBlocks.filter((row) => {
    const name = String(row?.name || "");
    return (
      /^bincontrol$/i.test(name) ||
      /^bincontrol_/i.test(name) ||
      /^bincontroller$/i.test(name) ||
      /^bincontroller_/i.test(name)
    );
  });
  const template = allBlocks.filter((row) => /^bincontrol1(?:_|$)/i.test(String(row?.name || "")));
  const out = [...shared.map((row) => String(row?.block || ""))];
  names.forEach((name) => {
    template.forEach((row) => {
      let block = String(row?.block || "");
      block = block.split("BinControl1").join(name);
      block = block.split("bincontrol1").join(name.toLowerCase());
      out.push(block);
    });
  });
  const dedup = new Map();
  out.forEach((block) => {
    const head = String(block || "").match(/<DataType\b([^>]*)>/i);
    const name = head ? extractAttr(String(head[1] || ""), "Name") : "";
    const key = String(name || "").trim().toLowerCase();
    if (!key) return;
    dedup.set(key, String(block || ""));
  });
  return Array.from(dedup.values());
}

function buildBatchControlTemplateDataTypeBlocks(rawText) {
  const allBlocks = extractNamedDataTypeBlocks(rawText);
  if (!allBlocks.length) return [];
  const builtIn = new Set([
    "bool", "bit", "sint", "int", "dint", "lint", "usint", "uint", "udint", "ulint",
    "real", "lreal", "string", "time", "date", "datetime", "tod", "timer",
  ]);
  const byName = new Map(
    allBlocks.map((row) => [String(row?.name || "").trim().toLowerCase(), row])
  );
  const queue = REQUIRED_BATCHCONTROL_TYPES
    .map((name) => String(name || "").trim())
    .filter((name) => byName.has(name.toLowerCase()));
  const include = new Set(queue.map((n) => n.toLowerCase()));
  while (queue.length) {
    const current = String(queue.shift() || "").trim().toLowerCase();
    const row = byName.get(current);
    if (!row) continue;
    (Array.isArray(row.refs) ? row.refs : []).forEach((ref) => {
      const key = String(ref || "").trim().toLowerCase();
      if (!key || builtIn.has(key) || include.has(key)) return;
      if (!byName.has(key)) return;
      include.add(key);
      queue.push(key);
    });
  }
  const out = allBlocks
    .filter((row) => include.has(String(row?.name || "").trim().toLowerCase()))
    .map((row) => String(row?.block || ""));
  const outNames = new Set(
    out.map((block) => {
      const head = String(block || "").match(/<DataType\b([^>]*)>/i);
      return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
    }).filter(Boolean)
  );
  REQUIRED_BATCHCONTROL_TYPES.forEach((typeName) => {
    const key = String(typeName || "").trim().toLowerCase();
    if (!key || outNames.has(key)) return;
    out.push(
      [
        `<DataType Name="${typeName}" Family="NoFamily" Class="User">`,
        "  <Members>",
        '    <Member Name="Reserved" DataType="DINT"/>',
        "  </Members>",
        "</DataType>",
      ].join("\n")
    );
    outNames.add(key);
  });
  return out;
}

function extractNamedTagXmlBlocks(rawText) {
  const src = String(rawText || "");
  if (!src) return [];
  const out = [];
  const blockRe = /<Tag\b[\s\S]*?<\/Tag>/gi;
  let block = blockRe.exec(src);
  while (block) {
    const text = String(block[0] || "");
    const head = text.match(/<Tag\b([^>]*)>/i);
    const name = head ? extractAttr(String(head[1] || ""), "Name") : "";
    if (String(name || "").trim()) out.push({ name: String(name).trim(), block: text });
    block = blockRe.exec(src);
  }
  const selfRe = /<Tag\b([^>]*)\/>/gi;
  let self = selfRe.exec(src);
  while (self) {
    const attrs = String(self[1] || "");
    if (attrs.trim().startsWith("/")) {
      self = selfRe.exec(src);
      continue;
    }
    const name = extractAttr(attrs, "Name");
    if (String(name || "").trim()) out.push({ name: String(name).trim(), block: String(self[0] || "") });
    self = selfRe.exec(src);
  }
  return out;
}

function buildRouteTemplateTagBlocks(rawText, routeNames = []) {
  const tags = extractNamedTagXmlBlocks(rawText);
  if (!tags.length) return [];
  const toSelfClosingTag = (blockText) => {
    const src = String(blockText || "");
    const openSelf = src.match(/<Tag\b([^>]*)\/>/i);
    if (openSelf) {
      const attrs = String(openSelf[1] || "").replace(/\/\s*$/, "").trim();
      return `<Tag${attrs ? ` ${attrs}` : ""}/>`;
    }
    const open = src.match(/<Tag\b([^>]*)>/i);
    const attrs = open ? String(open[1] || "").trim() : "";
    return `<Tag${attrs ? ` ${attrs}` : ""}/>`;
  };
  const routeNameList = Array.from(
    new Set((Array.isArray(routeNames) ? routeNames : []).map((v) => String(v || "").trim()).filter(Boolean))
  );
  const shared = tags.filter((row) => /^route$/i.test(String(row?.name || "")));
  const routeOne = tags.filter((row) => /^route1/i.test(String(row?.name || "")));
  const out = [...shared.map((row) => toSelfClosingTag(row.block))];
  routeNameList.forEach((routeName) => {
    routeOne.forEach((row) => {
      let block = String(row?.block || "");
      block = block.split("Route1").join(routeName);
      block = block.split("route1").join(routeName.toLowerCase());
      out.push(toSelfClosingTag(block));
    });
  });
  const dedup = new Map();
  out.forEach((block) => {
    const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
    const name = head ? extractAttr(String(head[1] || ""), "Name") : "";
    const key = String(name || "").trim().toLowerCase();
    if (!key) return;
    dedup.set(key, String(block || ""));
  });
  return Array.from(dedup.values());
}

function buildBinControlTemplateTagBlocks(rawText, objectNames = []) {
  const tags = extractNamedTagXmlBlocks(rawText);
  if (!tags.length) return [];
  const names = Array.from(
    new Set((Array.isArray(objectNames) ? objectNames : []).map((v) => String(v || "").trim()).filter(Boolean))
  );
  if (!names.length) return [];
  const toSelfClosingTag = (blockText) => {
    const src = String(blockText || "");
    const openSelf = src.match(/<Tag\b([^>]*)\/>/i);
    if (openSelf) {
      const attrs = String(openSelf[1] || "").replace(/\/\s*$/, "").trim();
      return `<Tag${attrs ? ` ${attrs}` : ""}/>`;
    }
    const open = src.match(/<Tag\b([^>]*)>/i);
    const attrs = open ? String(open[1] || "").trim() : "";
    return `<Tag${attrs ? ` ${attrs}` : ""}/>`;
  };
  const shared = tags.filter((row) => /^bincontrol$/i.test(String(row?.name || "")));
  const template = tags.filter((row) => /^bincontrol1/i.test(String(row?.name || "")));
  const out = [...shared.map((row) => toSelfClosingTag(row.block))];
  names.forEach((name) => {
    template.forEach((row) => {
      let block = String(row?.block || "");
      block = block.split("BinControl1").join(name);
      block = block.split("bincontrol1").join(name.toLowerCase());
      out.push(toSelfClosingTag(block));
    });
  });
  const dedup = new Map();
  out.forEach((block) => {
    const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
    const name = head ? extractAttr(String(head[1] || ""), "Name") : "";
    const key = String(name || "").trim().toLowerCase();
    if (!key) return;
    dedup.set(key, String(block || ""));
  });
  return Array.from(dedup.values());
}

function extractTagDataTypeNames(tagBlocks = []) {
  const out = new Set();
  (Array.isArray(tagBlocks) ? tagBlocks : []).forEach((block) => {
    const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
    const dataType = head ? String(extractAttr(String(head[1] || ""), "DataType") || "").trim() : "";
    if (dataType) out.add(dataType);
  });
  return Array.from(out.values());
}

function buildDataTypeClosureByNames(rawText, rootTypeNames = []) {
  const all = extractNamedDataTypeBlocks(rawText);
  if (!all.length) return [];
  const builtIn = new Set([
    "bool", "bit", "sint", "int", "dint", "lint", "usint", "uint", "udint", "ulint",
    "real", "lreal", "string", "time", "date", "datetime", "tod", "timer",
  ]);
  const byName = new Map(
    all.map((row) => [String(row?.name || "").trim().toLowerCase(), row])
  );
  const queue = Array.from(
    new Set((Array.isArray(rootTypeNames) ? rootTypeNames : []).map((v) => String(v || "").trim()).filter(Boolean))
  );
  const include = new Set(queue.map((n) => n.toLowerCase()));
  while (queue.length) {
    const current = String(queue.shift() || "").trim().toLowerCase();
    const row = byName.get(current);
    if (!row) continue;
    (Array.isArray(row.refs) ? row.refs : []).forEach((ref) => {
      const key = String(ref || "").trim().toLowerCase();
      if (!key || builtIn.has(key) || include.has(key)) return;
      if (!byName.has(key)) return;
      include.add(key);
      queue.push(key);
    });
  }
  return all
    .filter((row) => include.has(String(row?.name || "").trim().toLowerCase()))
    .map((row) => String(row?.block || ""));
}

function buildExplicitBinObjectTagBlocks(binNames = []) {
  return Array.from(
    new Set((Array.isArray(binNames) ? binNames : []).map((v) => String(v || "").trim()).filter(Boolean))
  ).map(
    (name) =>
      `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="BatchControl_Bin" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
  );
}

function buildSubRouteObjectTagBlocks(subRouteNames = []) {
  const names = Array.from(
    new Set((Array.isArray(subRouteNames) ? subRouteNames : []).map((v) => String(v || "").trim()).filter(Boolean))
  );
  const out = [];
  names.forEach((base) => {
    out.push(
      `<Tag Name="${base}" Class="Standard" TagType="Base" DataType="Route" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
    );
    out.push(
      `<Tag Name="${base}_Data" Class="Standard" TagType="Base" DataType="Route1Data" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
    );
    out.push(
      `<Tag Name="${base}_Group_Mgr" Class="Standard" TagType="Base" DataType="GroupControl_Mgr" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
    );
    out.push(
      `<Tag Name="${base}_Tool" Class="Standard" TagType="Base" DataType="GroupControl_RouteTool" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
    );
  });
  return out;
}

function filterTagBlocksByObjectNames(tagBlocks = [], options = {}) {
  const blocks = Array.isArray(tagBlocks) ? tagBlocks : [];
  const routeNames = Array.isArray(options?.routeNames) ? options.routeNames : [];
  const subRouteNames = Array.isArray(options?.subRouteNames) ? options.subRouteNames : [];
  const ioNames = Array.isArray(options?.ioNames) ? options.ioNames : [];
  const binNames = Array.isArray(options?.binNames) ? options.binNames : [];
  const matchExactOrUnderscore = (value, root) => {
    const v = String(value || "").toLowerCase();
    const r = String(root || "").toLowerCase();
    return !!r && (v === r || v.startsWith(`${r}_`));
  };
  return blocks.filter((block) => {
    const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
    const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
    if (!name) return false;
    const lower = name.toLowerCase();
    if (isProjectSpecificTagName(name)) return false;
    if (/\{\{[^}]+\}\}/.test(name)) return false;
    const isBinScopedTag = /_bin[a-z0-9]+(?:_|$)/i.test(lower);
    for (const io of ioNames) {
      if (!matchExactOrUnderscore(lower, io)) continue;
      // Keep sender/receiver tags, but only keep bin-scoped tags if that bin exists in object tree.
      if (!isBinScopedTag) return true;
      for (const bin of binNames) {
        if (matchExactOrUnderscore(lower, bin)) return true;
      }
      return false;
    }
    for (const bin of binNames) {
      if (matchExactOrUnderscore(lower, bin)) return true;
    }
    const looksLikeNestedRouteTag = /^route[^_]*_[^_]+(?:_|$)/i.test(lower);
    if (looksLikeNestedRouteTag) {
      for (const subRoute of subRouteNames) {
        if (matchExactOrUnderscore(lower, subRoute)) return true;
      }
      return false;
    }
    for (const route of routeNames) {
      const r = String(route || "").trim();
      if (!r) continue;
      if (lower === r.toLowerCase()) return true;
      if (lower.startsWith(`${r.toLowerCase()}_data`)) return true;
    }
    for (const subRoute of subRouteNames) {
      if (matchExactOrUnderscore(lower, subRoute)) return true;
    }
    return false;
  });
}

function buildRouteTemplateDataTypeBlocks(rawText, routeNames = []) {
  const REQUIRED_ROUTE_GENERIC_TYPES = [
    "Route_Array",
    "Route_Cmd",
    "Route_Group",
    "Route_GroupControl",
    "Route_HMI_Read",
    "Route_HMI_Write",
    "Route_Job_State",
    "Route_Route_State",
    "Route_Status",
  ];
  const inferMembersFromDecoratedData = (typeName) => {
    const src = String(rawText || "");
    if (!src) return [];
    const wanted = String(typeName || "").trim().toLowerCase();
    if (!wanted) return [];
    const members = new Map();
    const structRe = /<Structure\b([^>]*)>([\s\S]*?)<\/Structure>/gi;
    let sm = structRe.exec(src);
    while (sm) {
      const attrs = String(sm[1] || "");
      const body = String(sm[2] || "");
      const dt = extractAttr(attrs, "DataType");
      if (String(dt || "").trim().toLowerCase() !== wanted) {
        sm = structRe.exec(src);
        continue;
      }
      const memberRe = /<DataValueMember\b([^>]*)\/>/gi;
      let mm = memberRe.exec(body);
      while (mm) {
        const ma = String(mm[1] || "");
        const name = extractAttr(ma, "Name");
        const dataType = extractAttr(ma, "DataType") || "DINT";
        const key = String(name || "").trim().toLowerCase();
        if (key && !members.has(key)) {
          members.set(key, { name: String(name || "").trim(), dataType: String(dataType || "").trim() || "DINT" });
        }
        mm = memberRe.exec(body);
      }
      sm = structRe.exec(src);
    }
    return Array.from(members.values());
  };
  const makeGenericRouteTypeBlock = (typeName) => {
    const inferred = inferMembersFromDecoratedData(typeName);
    const memberLines = inferred.length
      ? inferred.map((m) => `    <Member Name="${m.name}" DataType="${m.dataType}"/>`)
      : ['    <Member Name="Reserved" DataType="DINT"/>'];
    return [
      `<DataType Name="${typeName}" Family="NoFamily" Class="User">`,
      "  <Members>",
      ...memberLines,
      "  </Members>",
      "</DataType>",
    ].join("\n");
  };
  const isRouteTemplateTypeName = (name) => {
    const value = String(name || "").trim();
    if (!value) return false;
    if (/^route$/i.test(value)) return true;
    if (/^route_/i.test(value)) return true;
    return /^route1data(?:_|$)/i.test(value);
  };
  const routeTypes = extractNamedRouteDataTypeBlocks(rawText).filter((x) =>
    isRouteTemplateTypeName(String(x?.name || ""))
  );
  if (!routeTypes.length) return [];
  const shared = routeTypes.filter((x) => /^route$/i.test(String(x?.name || "")));
  const genericRouteTypes = routeTypes.filter((x) => /^route_/i.test(String(x?.name || "")));
  const templateRouteOne = routeTypes.filter((x) => /^route1data(?:_|$)/i.test(String(x?.name || "")));
  const routeNameList = Array.from(
    new Set((Array.isArray(routeNames) ? routeNames : []).map((v) => String(v || "").trim()).filter(Boolean))
  );
  const out = [
    ...shared.map((x) => String(x.block || "")),
    ...genericRouteTypes.map((x) => String(x.block || "")),
  ];
  routeNameList.forEach((routeName) => {
    const sourceBlocks = templateRouteOne || [];
    sourceBlocks.forEach((entry) => {
      let block = String(entry?.block || "");
      const routeDataPrefix = `${routeName}Data`;
      block = block.split("Route1Data").join(routeDataPrefix);
      block = block.split("route1data").join(routeDataPrefix.toLowerCase());
      block = block.split("Route1").join(routeName);
      block = block.split("route1").join(routeName.toLowerCase());
      out.push(block);
    });
  });
  const dedup = new Map();
  out.forEach((block) => {
    const head = String(block || "").match(/<DataType\b([^>]*)>/i);
    const name = head ? extractAttr(String(head[1] || ""), "Name") : "";
    const key = String(name || "").trim().toLowerCase();
    if (!key) return;
    dedup.set(key, String(block || ""));
  });
  REQUIRED_ROUTE_GENERIC_TYPES.forEach((typeName) => {
    const key = String(typeName || "").trim().toLowerCase();
    if (!key || dedup.has(key)) return;
    dedup.set(key, makeGenericRouteTypeBlock(typeName));
  });
  return Array.from(dedup.values());
}

function filterRouteMembersToRouteLike(blockText) {
  const builtIn = new Set([
    "bool",
    "bit",
    "sint",
    "int",
    "dint",
    "lint",
    "usint",
    "uint",
    "udint",
    "ulint",
    "real",
    "lreal",
    "string",
    "time",
    "date",
    "datetime",
    "tod",
    "timer",
  ]);
  const keepDataType = (value) => {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return false;
    if (builtIn.has(key)) return true;
    if (key.includes("route")) return true;
    if (key.includes("job")) return true;
    if (key.includes("bincontrol")) return true;
    if (key.includes("batchcontrol")) return true;
    return false;
  };
  let out = String(blockText || "");
  out = out.replace(/<Member\b([^>]*)\/>/gi, (full, attrs) => {
    const dt = extractAttr(String(attrs || ""), "DataType");
    return keepDataType(dt) ? full : "";
  });
  out = out.replace(/<Member\b([^>]*)>[\s\S]*?<\/Member>/gi, (full, attrs) => {
    const dt = extractAttr(String(attrs || ""), "DataType");
    return keepDataType(dt) ? full : "";
  });
  return out;
}

function findMissingCustomTypeRefs(dataTypeBlocks = []) {
  const builtIn = new Set([
    "bool",
    "bit",
    "sint",
    "int",
    "dint",
    "lint",
    "usint",
    "uint",
    "udint",
    "ulint",
    "real",
    "lreal",
    "string",
    "time",
    "date",
    "datetime",
    "tod",
    "timer",
  ]);
  const blocks = Array.isArray(dataTypeBlocks) ? dataTypeBlocks : [];
  const names = new Set();
  blocks.forEach((block) => {
    const head = String(block || "").match(/<DataType\b([^>]*)>/i);
    const name = head ? extractAttr(String(head[1] || ""), "Name") : "";
    if (name) names.add(String(name).trim());
  });
  const missing = new Set();
  blocks.forEach((block) => {
    const refs = Array.from(String(block || "").matchAll(/\bDataType\s*=\s*"([^"]+)"/gi))
      .map((m) => String(m?.[1] || "").trim())
      .filter(Boolean);
    refs.forEach((ref) => {
      const key = String(ref || "").toLowerCase();
      if (builtIn.has(key)) return;
      if (names.has(ref)) return;
      missing.add(ref);
    });
  });
  return Array.from(missing.values());
}

function collectCustomDataTypeRefs(dataTypeBlocks = []) {
  const builtIn = new Set([
    "bool",
    "bit",
    "sint",
    "int",
    "dint",
    "lint",
    "usint",
    "uint",
    "udint",
    "ulint",
    "real",
    "lreal",
    "string",
    "time",
    "date",
    "datetime",
    "tod",
    "timer",
  ]);
  const refs = new Set();
  (Array.isArray(dataTypeBlocks) ? dataTypeBlocks : []).forEach((block) => {
    Array.from(String(block || "").matchAll(/\bDataType\s*=\s*"([^"]+)"/gi))
      .map((m) => String(m?.[1] || "").trim())
      .filter(Boolean)
      .forEach((name) => {
        const key = String(name || "").toLowerCase();
        if (!key || builtIn.has(key)) return;
        refs.add(String(name));
      });
  });
  return Array.from(refs.values());
}

function extractAoiXmlBlocksByName(rawText, names = []) {
  const wanted = new Set((Array.isArray(names) ? names : []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return [];
  return parseAoiLibraryBlocks(rawText)
    .filter((row) => row.key && wanted.has(row.key))
    .map((row) => row.block);
}

function extractAllAoiXmlBlocks(rawText) {
  return parseAoiLibraryBlocks(rawText).map((row) => row.block);
}

function buildImportSafeAoiXmlBlocks(rawText, dataTypeBlocks = []) {
  const builtIn = new Set([
    "bool",
    "bit",
    "sint",
    "int",
    "dint",
    "lint",
    "usint",
    "uint",
    "udint",
    "ulint",
    "real",
    "lreal",
    "string",
    "time",
    "date",
    "datetime",
    "tod",
    "timer",
  ]);
  const udtNames = new Set(
    (Array.isArray(dataTypeBlocks) ? dataTypeBlocks : [])
      .map((block) => {
        const head = String(block || "").match(/<DataType\b([^>]*)>/i);
        return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
      })
      .filter(Boolean)
  );
  const all = parseAoiLibraryBlocks(rawText)
    .filter((row) => row.key && !udtNames.has(row.key)); // avoid AOI/UDT name collisions
  const requiredAoiNames = new Set(["simplealarm", "alarmblock"]);
  const keep = new Map(all.map((row) => [row.key, row]));
  let changed = true;
  while (changed) {
    changed = false;
    const keepNames = new Set(keep.keys());
    for (const [key, row] of Array.from(keep.entries())) {
      const hasUnresolved = row.refs.some((ref) => {
        if (!ref || builtIn.has(ref)) return false;
        if (udtNames.has(ref)) return false;
        if (keepNames.has(ref)) return false; // AOI dependency
        return true;
      });
      if (requiredAoiNames.has(key)) continue;
      if (hasUnresolved) {
        keep.delete(key);
        changed = true;
      }
    }
  }
  return Array.from(keep.values()).map((row) => row.block);
}

function buildAoiClosureByNames(rawText, rootNames = [], dataTypeBlocks = []) {
  const all = parseAoiLibraryBlocks(rawText);
  if (!all.length) return [];
  const udtNames = new Set(
    (Array.isArray(dataTypeBlocks) ? dataTypeBlocks : [])
      .map((block) => {
        const head = String(block || "").match(/<DataType\b([^>]*)>/i);
        return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
      })
      .filter(Boolean)
  );
  const byName = new Map(
    all
      .filter((row) => row.key && !udtNames.has(row.key))
      .map((row) => [row.key, row])
  );
  const queue = Array.from(
    new Set((Array.isArray(rootNames) ? rootNames : []).map((n) => String(n || "").trim()).filter(Boolean))
  );
  const include = new Set(queue.map((n) => n.toLowerCase()));
  while (queue.length) {
    const current = String(queue.shift() || "").trim().toLowerCase();
    const row = byName.get(current);
    if (!row) continue;
    (Array.isArray(row.refs) ? row.refs : []).forEach((ref) => {
      const key = String(ref || "").trim().toLowerCase();
      if (!key || include.has(key) || !byName.has(key)) return;
      include.add(key);
      queue.push(key);
    });
  }
  return all
    .filter((row) => include.has(String(row?.key || "").trim().toLowerCase()))
    .map((row) => String(row?.block || ""));
}

function extractCustomDataTypeRefsFromBlocks(blocks = [], excludedNames = []) {
  const builtIn = new Set([
    "bool",
    "bit",
    "sint",
    "int",
    "dint",
    "lint",
    "usint",
    "uint",
    "udint",
    "ulint",
    "real",
    "lreal",
    "string",
    "time",
    "date",
    "datetime",
    "tod",
    "timer",
  ]);
  const excluded = new Set((Array.isArray(excludedNames) ? excludedNames : []).map((x) => String(x || "").trim().toLowerCase()));
  const refs = new Map();
  (Array.isArray(blocks) ? blocks : []).forEach((block) => {
    Array.from(String(block || "").matchAll(/\bDataType\s*=\s*"([^"]+)"/gi))
      .map((m) => String(m?.[1] || "").trim())
      .filter(Boolean)
      .forEach((name) => {
        const key = name.toLowerCase();
        if (!key || builtIn.has(key) || excluded.has(key)) return;
        if (!refs.has(key)) refs.set(key, name);
      });
  });
  return Array.from(refs.values());
}

function pruneTemplateToSelectedRoutes(rawText, selectedRouteNumbers = []) {
  const src = String(rawText || "");
  if (!src) return src;
  const selected = new Set(
    (Array.isArray(selectedRouteNumbers) ? selectedRouteNumbers : [])
      .map((n) => String(n || "").trim())
      .filter(Boolean)
  );
  if (!selected.size) return src;
  const keepByName = (name) => {
    const value = String(name || "");
    const m = value.match(/route\s*([0-9]+)/i);
    if (!m) return true;
    return selected.has(String(m[1] || "").trim());
  };
  let out = src;
  out = out.replace(/<DataType\b([\s\S]*?)<\/DataType>/gi, (block, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return keepByName(name) ? block : "";
  });
  out = out.replace(/<Tag\b([\s\S]*?)\/>/gi, (block, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return keepByName(name) ? block : "";
  });
  out = out.replace(/<Tag\b([\s\S]*?)>([\s\S]*?)<\/Tag>/gi, (block, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return keepByName(name) ? block : "";
  });
  return out;
}

function pruneBinArtifactsFromTemplate(rawText) {
  let out = String(rawText || "");
  if (!out) return out;
  const keepByName = (name) => !/\bbin\b/i.test(String(name || ""));
  out = out.replace(/<DataType\b([\s\S]*?)<\/DataType>/gi, (block, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return keepByName(name) ? block : "";
  });
  out = out.replace(/<Tag\b([\s\S]*?)\/>/gi, (block, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return keepByName(name) ? block : "";
  });
  out = out.replace(/<Tag\b([\s\S]*?)>([\s\S]*?)<\/Tag>/gi, (block, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return keepByName(name) ? block : "";
  });
  return out;
}

function isImportableFieldName(name) {
  return String(name || "").trim().toLowerCase() !== "class";
}

function extractAttr(attrText, name) {
  if (!attrText) return "";
  const dq = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const dm = attrText.match(dq);
  if (dm) return String(dm[1] || "").trim();
  const sq = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i");
  const sm = attrText.match(sq);
  if (sm) return String(sm[1] || "").trim();
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i");
  const bm = attrText.match(bare);
  return bm ? String(bm[1] || "").trim() : "";
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

function scanNamedElementsL5k(text, keyword, maxNames = 8) {
  const out = { count: 0, names: [] };
  const seen = new Set();
  const escaped = String(keyword || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${escaped}\\s+([^\\r\\n;]+)`, "gmi");
  let match = re.exec(String(text || ""));
  while (match) {
    out.count += 1;
    if (out.names.length < maxNames) {
      const rawName = String(match[1] || "").trim();
      const name = rawName.replace(/^"|"$/g, "").trim();
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        out.names.push(name);
      }
    }
    match = re.exec(String(text || ""));
  }
  return out;
}

function scanControllerTags(xmlText, maxTags = 1200) {
  const out = { count: 0, tags: [] };
  const seen = new Set();
  const pushTag = (name, plcType = "", tagType = "", parent = "", value = "") => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key) || out.tags.length >= maxTags) return;
    seen.add(key);
    out.tags.push({
      name: trimmed,
      tagPath: trimmed,
      plcType: String(plcType || "").trim(),
      tagType: String(tagType || "").trim(),
      parent: String(parent || "").trim(),
      value: String(value || "").trim(),
    });
  };

  // Match full tag blocks first to capture nested DataValueMember tags.
  const blockRe = /<Tag\b([^>]*)>([\s\S]*?)<\/Tag>/gi;
  let match = blockRe.exec(xmlText);
  while (match) {
    out.count += 1;
    const attrs = match[1] || "";
    const body = match[2] || "";
    const baseName = extractAttr(attrs, "Name");
    const baseType = extractAttr(attrs, "DataType");
    const baseTagType = extractAttr(attrs, "TagType");
    pushTag(baseName, baseType, baseTagType);

    if (baseName) {
      const memberRe = /<DataValueMember\b([^>]*)\/?>/gi;
      let member = memberRe.exec(body);
      while (member) {
        const memberAttrs = member[1] || "";
        const memberName = extractAttr(memberAttrs, "Name");
        const memberType = extractAttr(memberAttrs, "DataType");
        const memberValue = extractAttr(memberAttrs, "Value");
        if (memberName) {
          pushTag(`${baseName}.${memberName}`, memberType, "Member", baseName, memberValue);
        }
        member = memberRe.exec(body);
      }
    }
    match = blockRe.exec(xmlText);
  }

  // Also catch self-closing tags.
  const selfRe = /<Tag\b([^>]*)\/>/gi;
  match = selfRe.exec(xmlText);
  while (match) {
    out.count += 1;
    const attrs = match[1] || "";
    pushTag(extractAttr(attrs, "Name"), extractAttr(attrs, "DataType"), extractAttr(attrs, "TagType"));
    match = selfRe.exec(xmlText);
  }
  return out;
}

function scanControllerTagsL5k(text, maxTags = 1200) {
  const out = { count: 0, tags: [] };
  const seen = new Set();
  const pushTag = (name, plcType = "", tagType = "", parent = "", value = "") => {
    const trimmed = String(name || "").trim().replace(/^"|"$/g, "");
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key) || out.tags.length >= maxTags) return;
    seen.add(key);
    out.tags.push({
      name: trimmed,
      tagPath: trimmed,
      plcType: String(plcType || "").trim(),
      tagType: String(tagType || "").trim(),
      parent: String(parent || "").trim(),
      value: String(value || "").trim(),
    });
  };

  const src = String(text || "");
  const blockRe = /^\s*TAG\b([\s\S]*?)^\s*END_TAG\b/gmi;
  let block = blockRe.exec(src);
  while (block) {
    const body = String(block[1] || "");
    const lineRe = /^\s*("?[\w\.\[\]:]+"?)\s*:\s*([\w]+)\b([^;\r\n]*);/gmi;
    let line = lineRe.exec(body);
    while (line) {
      out.count += 1;
      const tagName = String(line[1] || "").trim();
      const plcType = String(line[2] || "").trim();
      const extra = String(line[3] || "");
      const valueMatch = extra.match(/:=\s*([^;\r\n]+)/i);
      pushTag(tagName, plcType, "Tag", "", valueMatch ? valueMatch[1] : "");
      line = lineRe.exec(body);
    }
    block = blockRe.exec(src);
  }
  return out;
}

function cleanRequestedTagName(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  return value
    .replace(/^[`"'[\](){}<>\s]+/, "")
    .replace(/[`"',;:.!?()[\]{}<>\s]+$/, "")
    .trim();
}

function normalizeTagLookupKey(raw) {
  return cleanRequestedTagName(raw)
    .toLowerCase()
    .replace(/\s+/g, "");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findExactBaseTagFromRaw(xmlText, requestedName) {
  const raw = String(xmlText || "");
  const requested = cleanRequestedTagName(requestedName);
  if (!raw || !requested) return "";
  const re = new RegExp(`<Tag\\b[^>]*\\bName="${escapeRegex(requested)}"[^>]*>`, "i");
  if (re.test(raw)) return requested;
  return "";
}

function scanBaseTagNamesFromRaw(xmlText, maxNames = 6000) {
  const names = [];
  const seen = new Set();
  const re = /<Tag\b([^>]*)>/gi;
  let match = re.exec(String(xmlText || ""));
  while (match && names.length < maxNames) {
    const attrs = match[1] || "";
    const closeMarker = attrs.trim().startsWith("/");
    if (!closeMarker) {
      const name = String(extractAttr(attrs, "Name") || "").trim();
      if (name) {
        const key = normalizeTagLookupKey(name);
        if (key && !seen.has(key)) {
          seen.add(key);
          names.push(name);
        }
      }
    }
    match = re.exec(String(xmlText || ""));
  }
  return names;
}

function scanMembersForBaseTagFromRaw(xmlText, baseTag, maxMembers = 1200) {
  const base = cleanRequestedTagName(baseTag);
  if (!base) return [];
  const baseKey = normalizeTagLookupKey(base);
  if (!baseKey) return [];
  const out = [];
  const seen = new Set();
  const blockRe = /<Tag\b([^>]*)>([\s\S]*?)<\/Tag>/gi;
  let block = blockRe.exec(String(xmlText || ""));
  while (block && out.length < maxMembers) {
    const attrs = block[1] || "";
    const body = block[2] || "";
    const tagName = String(extractAttr(attrs, "Name") || "").trim();
    if (normalizeTagLookupKey(tagName) === baseKey) {
      const memberRe = /<DataValueMember\b([^>]*)\/?>/gi;
      let member = memberRe.exec(body);
      while (member && out.length < maxMembers) {
        const memberAttrs = member[1] || "";
        const memberName = String(extractAttr(memberAttrs, "Name") || "").trim();
        const memberType = String(extractAttr(memberAttrs, "DataType") || "").trim();
        if (memberName) {
          const fullTag = `${base}.${memberName}`;
          const key = fullTag.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ member: memberName, fullTag, plcType: memberType });
          }
        }
        member = memberRe.exec(body);
      }
      break;
    }
    block = blockRe.exec(String(xmlText || ""));
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

function analyzeL5x(xmlText, fileName = "") {
  const raw = String(xmlText || "");
  const lowerName = String(fileName || "").trim().toLowerCase();
  const isExtL5k = lowerName.endsWith(".l5k");
  const looksL5x = /<RSLogix5000Content\b/i.test(raw);
  const looksL5k =
    /^\s*CONTROLLER\b/m.test(raw) ||
    /^\s*PROGRAM\b/m.test(raw) ||
    /^\s*ADD_ON_INSTRUCTION_DEFINITION\b/m.test(raw);

  if ((isExtL5k || looksL5k) && !looksL5x) {
    const sections = [
      { label: "Tasks", key: "Task", keyword: "TASK" },
      { label: "Programs", key: "Program", keyword: "PROGRAM" },
      { label: "Routines", key: "Routine", keyword: "ROUTINE" },
      { label: "Controller Tags", key: "Tag", keyword: "TAG" },
      { label: "Modules", key: "Module", keyword: "MODULE" },
      {
        label: "AOIs",
        key: "AddOnInstructionDefinition",
        keyword: "ADD_ON_INSTRUCTION_DEFINITION",
      },
      { label: "Data Types", key: "DataType", keyword: "DATATYPE" },
    ].map((s) => ({
      label: s.label,
      key: s.key,
      ...scanNamedElementsL5k(raw, s.keyword, 8),
    }));
    const controllerNameMatch = raw.match(/^\s*CONTROLLER\s+([^\r\n]+)/mi);
    const revisionMatch = raw.match(/^\s*REVISION\s+([^\r\n]+)/mi);
    const controllerTags = scanControllerTagsL5k(raw);
    return {
      isLikelyL5x: false,
      isLikelyL5k: looksL5k || isExtL5k,
      fileFormat: "l5k",
      hasParserError: false,
      metadata: {
        schemaRevision: "",
        softwareRevision: revisionMatch ? String(revisionMatch[1] || "").trim() : "",
        targetName: "",
        targetType: "",
        containsContext: "",
        owner: "",
        exportDate: "",
        controllerName: controllerNameMatch
          ? String(controllerNameMatch[1] || "").replace(/^"|"$/g, "").trim()
          : "",
        processorType: "",
        majorRev: "",
        minorRev: "",
        projectCreationDate: "",
        lastModifiedDate: "",
      },
      sections,
      controllerTags,
    };
  }

  const rootMatch = raw.match(/<RSLogix5000Content\b([^>]*)>/i);
  const controllerMatch = raw.match(/<Controller\b([^>]*)>/i);
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
  const controllerTags = scanControllerTags(xmlText);

  const parserError = raw.match(/<parsererror[\s>]/i);
  return {
    isLikelyL5x: /<RSLogix5000Content\b/i.test(raw),
    isLikelyL5k: false,
    fileFormat: "l5x",
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
    controllerTags,
  };
}

function extractAoiLogicBlocks(rawText, fileFormat = "") {
  const raw = String(rawText || "");
  const fmt = String(fileFormat || "").trim().toLowerCase();
  if (!raw) return [];

  if (fmt === "l5k") {
    const out = [];
    const aoiBlockRe =
      /^\s*ADD_ON_INSTRUCTION_DEFINITION\s+([^\r\n]+)\s*[\r\n]+([\s\S]*?)^\s*END_ADD_ON_INSTRUCTION_DEFINITION\b/gmi;
    let aoiBlock = aoiBlockRe.exec(raw);
    while (aoiBlock) {
      const aoiName = String(aoiBlock[1] || "").replace(/^"|"$/g, "").trim();
      const aoiBody = String(aoiBlock[2] || "");
      const routineRe = /^\s*ROUTINE\s+([^\r\n]+)\s*[\r\n]+([\s\S]*?)^\s*END_ROUTINE\b/gmi;
      let match = routineRe.exec(aoiBody);
      while (match) {
        const routineName = String(match[1] || "").replace(/^"|"$/g, "").trim() || "Routine";
        const body = String(match[2] || "").trim();
        out.push({
          name: `${aoiName || "AOI"} :: ${routineName}`,
          snippet: body ? `ROUTINE ${routineName}\n${body}\nEND_ROUTINE` : `ROUTINE ${routineName}`,
        });
        match = routineRe.exec(aoiBody);
      }
      aoiBlock = aoiBlockRe.exec(raw);
    }

    if (out.length) return out;

    const routineRe = /^\s*ROUTINE\s+([^\r\n]+)\s*[\r\n]+([\s\S]*?)^\s*END_ROUTINE\b/gmi;
    let match = routineRe.exec(raw);
    while (match) {
      const name = String(match[1] || "").replace(/^"|"$/g, "").trim();
      const body = String(match[2] || "").trim();
      out.push({ name: name || "Routine", snippet: body ? `ROUTINE ${name}\n${body}\nEND_ROUTINE` : `ROUTINE ${name}` });
      match = routineRe.exec(raw);
    }
    return out;
  }

  const out = [];
  const aoiBlockRe = /<AddOnInstructionDefinition\b([^>]*)>([\s\S]*?)<\/AddOnInstructionDefinition>/gi;
  let aoiBlock = aoiBlockRe.exec(raw);
  while (aoiBlock) {
    const aoiAttrs = String(aoiBlock[1] || "");
    const aoiBody = String(aoiBlock[2] || "");
    const aoiName = extractAttr(aoiAttrs, "Name") || "AOI";
    const routineRe = /<Routine\b([^>]*)>([\s\S]*?)<\/Routine>/gi;
    let match = routineRe.exec(aoiBody);
    while (match) {
      const attrs = String(match[1] || "");
      const body = String(match[2] || "").trim();
      const routineName = extractAttr(attrs, "Name") || "Routine";
      const routineType = extractAttr(attrs, "Type");
      const openTag = `<Routine${attrs ? ` ${attrs.trim()}` : ""}>`;
      const snippet = `${openTag}\n${body}\n</Routine>`;
      out.push({
        name: routineType
          ? `${aoiName} :: ${routineName} (${routineType})`
          : `${aoiName} :: ${routineName}`,
        snippet,
      });
      match = routineRe.exec(aoiBody);
    }
    aoiBlock = aoiBlockRe.exec(raw);
  }

  if (out.length) return out;

  const routineRe = /<Routine\b([^>]*)>([\s\S]*?)<\/Routine>/gi;
  let match = routineRe.exec(raw);
  while (match) {
    const attrs = String(match[1] || "");
    const body = String(match[2] || "").trim();
    const routineName = extractAttr(attrs, "Name") || "Routine";
    const routineType = extractAttr(attrs, "Type");
    const openTag = `<Routine${attrs ? ` ${attrs.trim()}` : ""}>`;
    const snippet = `${openTag}\n${body}\n</Routine>`;
    out.push({
      name: routineType ? `${routineName} (${routineType})` : routineName,
      snippet,
    });
    match = routineRe.exec(raw);
  }
  return out;
}

function extractLogicStatements(snippet) {
  const text = String(snippet || "");
  if (!text) return [];
  const decoded = text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  const extracted = [];
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/gi;
  let cMatch = cdataRe.exec(decoded);
  while (cMatch) {
    extracted.push(String(cMatch[1] || ""));
    cMatch = cdataRe.exec(decoded);
  }
  const textTagRe = /<Text\b[^>]*>([\s\S]*?)<\/Text>/gi;
  let tMatch = textTagRe.exec(decoded);
  while (tMatch) {
    extracted.push(String(tMatch[1] || ""));
    tMatch = textTagRe.exec(decoded);
  }
  const source = extracted.length ? extracted.join("\n") : decoded;
  return source
    .split(/[\r\n;]+/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
}

function extractInstructionCalls(statement) {
  const out = [];
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/g;
  let m = re.exec(String(statement || ""));
  while (m) {
    const op = String(m[1] || "").trim().toUpperCase();
    const args = String(m[2] || "")
      .split(",")
      .map((v) => String(v || "").trim())
      .filter(Boolean);
    out.push({ op, args });
    m = re.exec(String(statement || ""));
  }
  return out;
}

function parseBasicCsvLine(line) {
  const text = String(line || "");
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function extractTagsFromBasicCsv(rawText) {
  const text = String(rawText || "").replace(/^\uFEFF/, "");
  const lines = text
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const rows = lines.map((line) => parseBasicCsvLine(line));
  const first = rows[0] || [];
  const headerIndex = first.findIndex((cell) => {
    const key = String(cell || "").trim().toLowerCase();
    return ["tag", "tagname", "name", "tag_path", "tagpath", "path"].includes(key);
  });
  const equipmentIndex = first.findIndex((cell) => {
    const key = String(cell || "").trim().toLowerCase();
    return ["equipment", "equipmenttype", "equipment_type", "type"].includes(key);
  });
  const hasHeader = headerIndex >= 0;
  const tagCol = hasHeader ? headerIndex : 0;
  const equipCol = hasHeader && equipmentIndex >= 0 ? equipmentIndex : -1;
  const startRow = hasHeader ? 1 : 0;

  const seen = new Set();
  const out = [];
  for (let i = startRow; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const candidate = normalizeCodeGenTag(row[tagCol] || "");
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const equipmentType = equipCol >= 0 ? String(row[equipCol] || "").trim() : "";
    out.push({ tag: candidate, equipmentType });
  }
  return out;
}

function normalizeCodeGenTag(raw) {
  return String(raw || "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "");
}

function getInstructionOutputArgIndexes(op, argCount) {
  if (!argCount) return [];
  if (op === "OTE" || op === "OTL" || op === "OTU") return [0];
  if (op === "MOV" || op === "COP" || op === "CPS" || op === "FLL") return argCount >= 2 ? [1] : [];
  if (op === "ADD" || op === "SUB" || op === "MUL" || op === "DIV" || op === "MOD") {
    return argCount >= 3 ? [2] : [];
  }
  return [];
}

function _generateCodeGenProArtifacts(blocks, options = {}) {
  const includeComments = options?.includeComments !== false;
  const statementRows = [];
  const instructionCountMap = new Map();
  const inputTagSet = new Set();
  const outputTagSet = new Set();
  const stLines = [];

  (Array.isArray(blocks) ? blocks : []).forEach((block, blockIdx) => {
    const statements = extractLogicStatements(block?.snippet || "");
    statements.forEach((statement) => {
      const calls = extractInstructionCalls(statement);
      if (!calls.length) return;
      statementRows.push({
        blockName: String(block?.name || `Routine ${blockIdx + 1}`),
        statement,
        calls,
      });
      if (includeComments) {
        stLines.push(`// ${String(block?.name || `Routine ${blockIdx + 1}`)} | ${String(statement || "").trim()}`);
      }

      const conditionParts = [];
      calls.forEach(({ op, args }) => {
        const opKey = String(op || "").trim().toUpperCase();
        instructionCountMap.set(opKey, (instructionCountMap.get(opKey) || 0) + 1);
        const normalizedArgs = (Array.isArray(args) ? args : [])
          .map((arg) => normalizeCodeGenTag(arg))
          .filter(Boolean);
        const outputIdxSet = new Set(getInstructionOutputArgIndexes(opKey, normalizedArgs.length));
        normalizedArgs.forEach((arg, idx) => {
          if (outputIdxSet.has(idx)) outputTagSet.add(arg);
          else inputTagSet.add(arg);
        });

        if (opKey === "XIC" && normalizedArgs[0]) conditionParts.push(`${normalizedArgs[0]}`);
        else if (opKey === "XIO" && normalizedArgs[0]) conditionParts.push(`NOT ${normalizedArgs[0]}`);
        else if (opKey === "EQU" && normalizedArgs.length >= 2) conditionParts.push(`${normalizedArgs[0]} = ${normalizedArgs[1]}`);
        else if (opKey === "NEQ" && normalizedArgs.length >= 2) conditionParts.push(`${normalizedArgs[0]} <> ${normalizedArgs[1]}`);
        else if (opKey === "GRT" && normalizedArgs.length >= 2) conditionParts.push(`${normalizedArgs[0]} > ${normalizedArgs[1]}`);
        else if (opKey === "GEQ" && normalizedArgs.length >= 2) conditionParts.push(`${normalizedArgs[0]} >= ${normalizedArgs[1]}`);
        else if (opKey === "LES" && normalizedArgs.length >= 2) conditionParts.push(`${normalizedArgs[0]} < ${normalizedArgs[1]}`);
        else if (opKey === "LEQ" && normalizedArgs.length >= 2) conditionParts.push(`${normalizedArgs[0]} <= ${normalizedArgs[1]}`);
      });

      const conditionExpr = conditionParts.length ? conditionParts.join(" AND ") : "TRUE";
      calls.forEach(({ op, args }) => {
        const opKey = String(op || "").trim().toUpperCase();
        const normalizedArgs = (Array.isArray(args) ? args : [])
          .map((arg) => normalizeCodeGenTag(arg))
          .filter(Boolean);
        if (opKey === "OTE" && normalizedArgs[0]) stLines.push(`${normalizedArgs[0]} := (${conditionExpr});`);
        else if (opKey === "OTL" && normalizedArgs[0]) stLines.push(`IF (${conditionExpr}) THEN ${normalizedArgs[0]} := TRUE; END_IF;`);
        else if (opKey === "OTU" && normalizedArgs[0]) stLines.push(`IF (${conditionExpr}) THEN ${normalizedArgs[0]} := FALSE; END_IF;`);
        else if (opKey === "MOV" && normalizedArgs.length >= 2) {
          stLines.push(`IF (${conditionExpr}) THEN ${normalizedArgs[1]} := ${normalizedArgs[0]}; END_IF;`);
        } else if (opKey === "ADD" && normalizedArgs.length >= 3) {
          stLines.push(`IF (${conditionExpr}) THEN ${normalizedArgs[2]} := ${normalizedArgs[0]} + ${normalizedArgs[1]}; END_IF;`);
        } else if (opKey === "SUB" && normalizedArgs.length >= 3) {
          stLines.push(`IF (${conditionExpr}) THEN ${normalizedArgs[2]} := ${normalizedArgs[0]} - ${normalizedArgs[1]}; END_IF;`);
        } else if (opKey === "MUL" && normalizedArgs.length >= 3) {
          stLines.push(`IF (${conditionExpr}) THEN ${normalizedArgs[2]} := ${normalizedArgs[0]} * ${normalizedArgs[1]}; END_IF;`);
        } else if (opKey === "DIV" && normalizedArgs.length >= 3) {
          stLines.push(`IF (${conditionExpr}) THEN ${normalizedArgs[2]} := ${normalizedArgs[0]} / ${normalizedArgs[1]}; END_IF;`);
        }
      });
    });
  });

  const instructionCounts = Array.from(instructionCountMap.entries())
    .map(([op, count]) => ({ op, count }))
    .sort((a, b) => b.count - a.count || a.op.localeCompare(b.op));
  const inputTags = Array.from(inputTagSet).sort((a, b) => a.localeCompare(b));
  const outputTags = Array.from(outputTagSet).sort((a, b) => a.localeCompare(b));
  const allTags = Array.from(new Set([...inputTags, ...outputTags])).sort((a, b) => a.localeCompare(b));
  const declarationLines = allTags.map((tag) => `${tag}: BOOL;`);
  const ioMapLines = allTags.map((tag) => `${tag},`);

  return {
    statementRows,
    instructionCounts,
    inputTags,
    outputTags,
    allTags,
    stLines,
    declarationLines,
    ioMapLines,
  };
}

function mapPlcTypeToUaType(value) {
  const t = String(value || "").trim().toUpperCase();
  if (!t) return "";
  if (["BOOL", "BIT"].includes(t)) return "Boolean";
  if (["SINT", "INT", "DINT", "LINT"].includes(t)) return "Int32";
  if (["USINT", "UINT", "UDINT", "ULINT"].includes(t)) return "UInt32";
  if (["REAL", "LREAL"].includes(t)) return "Double";
  if (["STRING", "WSTRING"].includes(t)) return "String";
  return "";
}

function parsePlcDataTypeDescriptor(rawType, rawDimensions = "") {
  const stripFamilyQualifier = (value) =>
    String(value || "")
      .replace(/\s*\(\s*FamilyType\s*:?=\s*[^)]+\)\s*$/i, "")
      .trim();
  const typeText = String(rawType || "").trim();
  const dimsText = String(rawDimensions || "").trim();
  let baseType = typeText;
  let arraySpec = "";
  let isArray = false;

  const looksLikeArraySpec = (spec) => {
    const s = String(spec || "").trim();
    if (!s) return false;
    if (s.includes("..") || s.includes(",") || s.includes("[") || s.includes("]")) return true;
    if (/^\d+$/.test(s)) {
      // In some exports, scalar members may carry Dimension="0".
      // Treat only positive dimensions as array indicators.
      return Number.parseInt(s, 10) > 0;
    }
    return false;
  };

  // ARRAY[0..9] OF MyType
  const arrayOfMatch = typeText.match(/^ARRAY\s*\[(.+?)\]\s*OF\s*(.+)$/i);
  if (arrayOfMatch) {
    isArray = true;
    arraySpec = String(arrayOfMatch[1] || "").trim();
    baseType = stripFamilyQualifier(String(arrayOfMatch[2] || "").trim());
  } else {
    // MyType[10] or MyType[0..9,0..3]
    const inlineDimsMatch = typeText.match(/^(.*?)(\[[^\]]+\](?:\s*\[[^\]]+\])*)$/);
    if (inlineDimsMatch) {
      isArray = true;
      baseType = stripFamilyQualifier(String(inlineDimsMatch[1] || "").trim());
      arraySpec = String(inlineDimsMatch[2] || "")
        .replace(/\]\s*\[/g, ",")
        .replace(/^\[/, "")
        .replace(/\]$/g, "")
        .trim();
    } else if (looksLikeArraySpec(dimsText)) {
      // L5X commonly stores dimensions separately.
      isArray = true;
      arraySpec = dimsText;
    }
  }

  baseType = stripFamilyQualifier(baseType.replace(/^"|"$/g, "").trim());
  const normalizedType = isArray
    ? (arraySpec ? `${baseType}[${arraySpec}]` : `${baseType}[]`)
    : baseType;

  return {
    baseType,
    normalizedType,
    isArray,
    arraySpec,
  };
}

function scanAoiTemplates(xmlText, maxAois = 2000, maxFieldsPerAoi = 1200) {
  const normalizeAoiTemplateName = (value) =>
    String(value || "")
      .replace(/\s*\(\s*Class\s*:?=\s*.*$/i, "")
      .trim();
  const parseL5kObjectName = (raw) => {
    const text = String(raw || "").trim();
    if (!text) return "";
    const quoted = text.match(/^"([^"]+)"/);
    if (quoted) return String(quoted[1] || "").trim();
    const plain = text.match(/^([^\s(]+)/);
    return plain ? String(plain[1] || "").trim() : text;
  };
  const text = String(xmlText || "");
  if (!text) return [];
  const out = [];
  const defRe =
    /<AddOnInstructionDefinition\b([^>]*?)(?:\/>|>([\s\S]*?)<\/AddOnInstructionDefinition>)/gi;
  let match = defRe.exec(text);
  while (match && out.length < maxAois) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const aoiName = normalizeAoiTemplateName(String(extractAttr(attrs, "Name") || "").trim());
    if (!aoiName) {
      match = defRe.exec(text);
      continue;
    }
    const fields = [];
    const seen = new Set();
    const pushField = (name, plcType, usage) => {
      const trimmed = String(name || "").trim();
      if (!trimmed) return;
      if (!isImportableFieldName(trimmed)) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const descriptor = parsePlcDataTypeDescriptor(plcType);
      const dataType = descriptor.normalizedType;
      fields.push({
        name: trimmed,
        tagPath: trimmed,
        plcType: dataType,
        baseType: descriptor.baseType,
        isArray: descriptor.isArray,
        arraySpec: descriptor.arraySpec,
        uaType: mapPlcTypeToUaType(descriptor.baseType || dataType),
        usage: String(usage || "").trim(),
        enabled: true,
      });
    };

    const paramRe = /<Parameter\b([^>]*)\/?>/gi;
    let param = paramRe.exec(body);
    while (param && fields.length < maxFieldsPerAoi) {
      const paramAttrs = param[1] || "";
      pushField(
        extractAttr(paramAttrs, "Name"),
        extractAttr(paramAttrs, "DataType"),
        extractAttr(paramAttrs, "Usage")
      );
      param = paramRe.exec(body);
    }

    // fallback: if parameters are absent, use local tag names to seed the template
    if (!fields.length) {
      const localTagRe = /<LocalTag\b([^>]*)\/?>/gi;
      let localTag = localTagRe.exec(body);
      while (localTag && fields.length < maxFieldsPerAoi) {
        const localAttrs = localTag[1] || "";
        pushField(
          extractAttr(localAttrs, "Name"),
          extractAttr(localAttrs, "DataType"),
          "LocalTag"
        );
        localTag = localTagRe.exec(body);
      }
    }

    out.push({
      name: aoiName,
      description: String(extractAttr(attrs, "Description") || "").trim(),
      revision: [extractAttr(attrs, "Revision"), extractAttr(attrs, "RevisionExtended")]
        .filter(Boolean)
        .join("."),
      fields,
    });
    match = defRe.exec(text);
  }

  if (!out.length && /^\s*ADD_ON_INSTRUCTION_DEFINITION\b/m.test(text)) {
    const l5kDefRe =
      /^\s*ADD_ON_INSTRUCTION_DEFINITION\s+([^\r\n;]+)([\s\S]*?)^\s*END_ADD_ON_INSTRUCTION_DEFINITION\b/gmi;
    let l5kMatch = l5kDefRe.exec(text);
    while (l5kMatch && out.length < maxAois) {
      const aoiName = normalizeAoiTemplateName(parseL5kObjectName(l5kMatch[1]));
      const body = String(l5kMatch[2] || "");
      const fields = [];
      const seen = new Set();
      const pushField = (name, plcType, usage) => {
        const trimmed = String(name || "").trim().replace(/^"|"$/g, "");
        if (!trimmed) return;
        if (!isImportableFieldName(trimmed)) return;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const descriptor = parsePlcDataTypeDescriptor(plcType);
        const dataType = descriptor.normalizedType;
        fields.push({
          name: trimmed,
          tagPath: trimmed,
          plcType: dataType,
          baseType: descriptor.baseType,
          isArray: descriptor.isArray,
          arraySpec: descriptor.arraySpec,
          uaType: mapPlcTypeToUaType(descriptor.baseType || dataType),
          usage: String(usage || "").trim(),
          enabled: true,
        });
      };
      const paramLineRe = /^\s*("?[\w\.\[\]:]+"?)\s*:\s*([\w]+)\s*(?:\(([^)]*)\))?[^;\r\n]*;/gmi;
      let line = paramLineRe.exec(body);
      while (line && fields.length < maxFieldsPerAoi) {
        pushField(line[1], line[2], line[3] || "");
        line = paramLineRe.exec(body);
      }
      out.push({
        name: aoiName || "AOI",
        description: "",
        revision: "",
        fields,
      });
      l5kMatch = l5kDefRe.exec(text);
    }
  }
  if (out.length < maxAois) {
    const seenTemplateNames = new Set(
      out.map((row) => String(row?.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const dataTypeTemplates = scanDataTypeTemplates(
      text,
      Math.max(maxAois * 2, maxAois),
      maxFieldsPerAoi
    );
    for (const template of dataTypeTemplates) {
      if (out.length >= maxAois) break;
      const name = String(template?.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seenTemplateNames.has(key)) continue;
      const fields = (Array.isArray(template?.fields) ? template.fields : [])
        .filter((field) => isImportableFieldName(field?.name))
        .map((field) => {
          const rawType = String(field?.plcType || field?.baseType || "").trim();
          const descriptor = parsePlcDataTypeDescriptor(rawType, String(field?.arraySpec || "").trim());
          const dataType = descriptor.normalizedType || rawType;
          return {
            name: String(field?.name || "").trim(),
            tagPath: String(field?.tagPath || field?.name || "").trim(),
            plcType: dataType,
            baseType: descriptor.baseType || String(field?.baseType || "").trim(),
            isArray: descriptor.isArray === true || field?.isArray === true,
            arraySpec: descriptor.arraySpec || String(field?.arraySpec || "").trim(),
            uaType: mapPlcTypeToUaType(descriptor.baseType || dataType),
            usage: "DataTypeMember",
            enabled: field?.enabled !== false,
          };
        })
        .filter((field) => String(field?.name || "").trim());
      seenTemplateNames.add(key);
      out.push({
        name,
        description: String(template?.description || "").trim(),
        revision: "",
        fields,
      });
    }
  }

  if (out.length < maxAois) {
    const seenTemplateNames = new Set(
      out.map((row) => String(row?.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const builtinInstructions = new Set(
      [
        "AFI",
        "ADD",
        "AND",
        "CPS",
        "CTD",
        "CTU",
        "DIV",
        "EQ",
        "GEQ",
        "GRT",
        "GSV",
        "JSR",
        "LEQ",
        "LES",
        "LIMIT",
        "MUL",
        "MOVE",
        "MOV",
        "NE",
        "NOP",
        "ONS",
        "OTE",
        "OTL",
        "OTU",
        "RES",
        "SBR",
        "SQO",
        "SUB",
        "TON",
        "XIC",
        "XIO",
        "XOR",
      ].map((x) => x.toLowerCase())
    );
    const textBlocks = Array.from(
      String(text || "").matchAll(/<Text\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/gi)
    ).map((m) => String(m?.[1] || ""));
    for (const block of textBlocks) {
      if (out.length >= maxAois) break;
      const callMatches = Array.from(String(block || "").matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g));
      for (const call of callMatches) {
        if (out.length >= maxAois) break;
        const candidate = String(call?.[1] || "").trim();
        if (!candidate) continue;
        if (builtinInstructions.has(candidate.toLowerCase())) continue;
        const key = candidate.toLowerCase();
        if (seenTemplateNames.has(key)) continue;
        seenTemplateNames.add(key);
        out.push({
          name: candidate,
          description: "",
          revision: "",
          fields: [],
        });
      }
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function scanDataTypeTemplates(xmlText, maxTypes = 800, maxFieldsPerType = 2000) {
  const normalizeDataTypeTemplateName = (value) =>
    String(value || "")
      .replace(/\s*\(\s*FamilyType\s*:?=\s*[^)]+\)\s*$/i, "")
      .trim();
  const normalizeTypeName = (value) =>
    String(value || "")
      .replace(/\s*\(\s*FamilyType\s*:?=\s*[^)]+\)\s*$/i, "")
      .trim();
  const primitiveTypes = new Set([
    "BOOL", "SINT", "INT", "DINT", "LINT", "USINT", "UINT", "UDINT", "ULINT",
    "REAL", "LREAL", "TIME", "DATE", "DT", "TOD", "STRING", "WSTRING",
    "BYTE", "WORD", "DWORD", "LWORD", "TIMER", "COUNTER", "CONTROL",
  ]);
  const parseL5kDataTypeMemberLine = (rawLine) => {
    const cleaned = String(rawLine || "")
      .replace(/\/\/.*$/, "")
      .replace(/\(\s*[^)]*\)\s*$/, "")
      .replace(/[;,]\s*$/, "")
      .trim();
    if (!cleaned || /^(STRUCT|END_STRUCT|DATATYPE|END_DATATYPE)\b/i.test(cleaned)) return null;

    const colon = cleaned.match(/^("?[\w.\[\]:]+"?)\s*:\s*([^;\r\n]+)$/i);
    if (colon) {
      return {
        memberName: String(colon[1] || "").replace(/^"|"$/g, "").trim(),
        rawType: String(colon[2] || "").trim(),
      };
    }

    // Packed bit member syntax: BIT MemberName PackedHost : 0
    const packedBit = cleaned.match(
      /^([A-Za-z_][\w:.\[\]]*)\s+("?[\w.\[\]:]+"?)\s+("?[\w.\[\]:]+"?)\s*:\s*([0-9]+)$/i
    );
    if (packedBit) {
      return {
        memberName: String(packedBit[2] || "").replace(/^"|"$/g, "").trim(),
        rawType: String(packedBit[1] || "").trim(),
      };
    }

    const space = cleaned.match(/^([A-Za-z_][\w:.\[\]]*)\s+("?[\w.\[\]:]+"?)$/);
    if (space) {
      const first = String(space[1] || "").trim();
      const second = String(space[2] || "").replace(/^"|"$/g, "").trim();
      const firstUpper = first.toUpperCase();
      if (primitiveTypes.has(firstUpper)) {
        return { memberName: second, rawType: first };
      }
      if (primitiveTypes.has(second.toUpperCase())) {
        return { memberName: first, rawType: second };
      }
      // Unknown pattern: prefer "name type".
      return { memberName: first, rawType: second };
    }
    return null;
  };
  const splitMemberNameAndDims = (rawMemberName) => {
    const text = String(rawMemberName || "").trim().replace(/^"|"$/g, "");
    if (!text) return { name: "", dims: "" };
    const inlineDimsMatch = text.match(/^(.*?)(\[[^\]]+\](?:\s*\[[^\]]+\])*)$/);
    if (!inlineDimsMatch) return { name: text, dims: "" };
    const baseName = String(inlineDimsMatch[1] || "").trim();
    const dims = String(inlineDimsMatch[2] || "")
      .replace(/\]\s*\[/g, ",")
      .replace(/^\[/, "")
      .replace(/\]$/g, "")
      .trim();
    return { name: baseName || text, dims };
  };

  const text = String(xmlText || "");
  if (!text) return [];
  const out = [];
  const templateByName = new Map();
  const mergeTemplate = (template) => {
    const name = String(template?.name || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    const incomingFields = Array.isArray(template?.fields) ? template.fields : [];
    const existing = templateByName.get(key);
    if (!existing) {
      templateByName.set(key, {
        ...template,
        fields: incomingFields.slice(),
      });
      return;
    }
    const existingFields = Array.isArray(existing?.fields) ? existing.fields : [];
    const mergedByName = new Map();
    existingFields.forEach((f) => {
      const n = String(f?.name || "").trim().toLowerCase();
      if (n) mergedByName.set(n, f);
    });
    incomingFields.forEach((f) => {
      const n = String(f?.name || "").trim().toLowerCase();
      if (!n) return;
      if (!mergedByName.has(n)) {
        mergedByName.set(n, f);
      }
    });
    const mergedFields = Array.from(mergedByName.values());
    const winner =
      incomingFields.length > existingFields.length
        ? { ...template, fields: mergedFields }
        : { ...existing, fields: mergedFields };
    templateByName.set(key, winner);
  };

  const dataTypeRe = /<DataType\b([^>]*)>([\s\S]*?)<\/DataType>/gi;
  let match = dataTypeRe.exec(text);
  while (match && out.length < maxTypes) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const typeName = normalizeDataTypeTemplateName(String(extractAttr(attrs, "Name") || "").trim());
    if (!typeName) {
      match = dataTypeRe.exec(text);
      continue;
    }
    const fields = [];
    const seen = new Set();
    const pushMemberField = (memberNameRaw, rawTypeRaw, rawDimsRaw = "", usageRaw = "Member") => {
      const parsedMember = splitMemberNameAndDims(memberNameRaw);
      const memberName = String(parsedMember.name || "").trim();
      const dimsFromName = String(parsedMember.dims || "").trim();
      const effectiveDims = String(rawDimsRaw || dimsFromName || "").trim();
      if (!memberName) return;
      if (!isImportableFieldName(memberName)) return;
      const key = memberName.toLowerCase();
      if (seen.has(key) || fields.length >= maxFieldsPerType) return;
      const rawType = normalizeTypeName(String(rawTypeRaw || "").trim());
      if (!rawType) return;
      seen.add(key);
      const descriptor = parsePlcDataTypeDescriptor(rawType, effectiveDims);
      const plcType = descriptor.normalizedType;
      fields.push({
        name: memberName,
        tagPath: memberName,
        plcType,
        baseType: descriptor.baseType,
        isArray: descriptor.isArray,
        arraySpec: descriptor.arraySpec,
        uaType: mapPlcTypeToUaType(descriptor.baseType || plcType),
        usage: String(usageRaw || "Member"),
        enabled: true,
      });
    };

    // Primary L5X member form.
    const memberRe = /<Member\b([^>]*)\/?>/gi;
    let member = memberRe.exec(body);
    while (member && fields.length < maxFieldsPerType) {
      const memberAttrs = member[1] || "";
      const rawDims =
        String(extractAttr(memberAttrs, "Dimension") || "").trim() ||
        String(extractAttr(memberAttrs, "Dimensions") || "").trim() ||
        String(extractAttr(memberAttrs, "ArrayDimensions") || "").trim();
      pushMemberField(
        extractAttr(memberAttrs, "Name"),
        extractAttr(memberAttrs, "DataType"),
        rawDims,
        extractAttr(memberAttrs, "Usage") || "Member"
      );
      member = memberRe.exec(body);
    }

    // Fallback for custom/variant node names that still carry Name + DataType.
    if (fields.length === 0) {
      const genericNodeRe = /<([A-Za-z_][\w:.-]*)\b([^>]*)>/gi;
      let node = genericNodeRe.exec(body);
      while (node && fields.length < maxFieldsPerType) {
        const nodeName = String(node[1] || "").trim().toLowerCase();
        const nodeAttrs = node[2] || "";
        // Skip closing/context tags and only capture true member-like nodes.
        if (nodeName && !nodeName.startsWith("/") && nodeName !== "datatype") {
          const memberName = extractAttr(nodeAttrs, "Name");
          const memberType = extractAttr(nodeAttrs, "DataType");
          if (memberName && memberType) {
            const rawDims =
              String(extractAttr(nodeAttrs, "Dimension") || "").trim() ||
              String(extractAttr(nodeAttrs, "Dimensions") || "").trim() ||
              String(extractAttr(nodeAttrs, "ArrayDimensions") || "").trim();
            pushMemberField(
              memberName,
              memberType,
              rawDims,
              extractAttr(nodeAttrs, "Usage") || node[1] || "Member"
            );
          }
        }
        node = genericNodeRe.exec(body);
      }
    }
    mergeTemplate({
      name: typeName,
      description: String(extractAttr(attrs, "Description") || "").trim(),
      revision: "",
      fields,
    });
    match = dataTypeRe.exec(text);
  }

  if (!out.length && /^\s*DATATYPE\b/m.test(text)) {
    const blockRe = /^\s*DATATYPE\s+([^\r\n;]+)([\s\S]*?)^\s*END_DATATYPE\b/gmi;
    let block = blockRe.exec(text);
    while (block && out.length < maxTypes) {
      const typeName = normalizeDataTypeTemplateName(String(block[1] || "").replace(/^"|"$/g, "").trim());
      const body = String(block[2] || "");
      const fields = [];
      const seen = new Set();
      const memberLineRe = /^\s*("?[\w\.\[\]:]+"?)\s*:\s*([^;\r\n]+);/gmi;
      let line = memberLineRe.exec(body);
      while (line && fields.length < maxFieldsPerType) {
      const parsedMember = splitMemberNameAndDims(line[1]);
      const memberName = String(parsedMember.name || "").trim();
      const dimsFromName = String(parsedMember.dims || "").trim();
      const rawType = String(line[2] || "").trim();
      const descriptor = parsePlcDataTypeDescriptor(rawType, dimsFromName);
      const plcType = descriptor.normalizedType;
      if (memberName) {
        const key = memberName.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            fields.push({
              name: memberName,
              tagPath: memberName,
              plcType,
              baseType: descriptor.baseType,
              isArray: descriptor.isArray,
              arraySpec: descriptor.arraySpec,
              uaType: mapPlcTypeToUaType(descriptor.baseType || plcType),
              usage: "Member",
              enabled: true,
            });
          }
        }
        line = memberLineRe.exec(body);
      }
      if (!fields.length) {
        const lines = body.split(/\r?\n/);
        for (const rawLine of lines) {
          if (fields.length >= maxFieldsPerType) break;
          const parsed = parseL5kDataTypeMemberLine(rawLine);
          if (!parsed) continue;
          const parsedMember = splitMemberNameAndDims(parsed.memberName);
          const memberName = String(parsedMember.name || "").trim();
          const dimsFromName = String(parsedMember.dims || "").trim();
          const rawType = String(parsed.rawType || "").trim();
          if (!memberName || !rawType) continue;
          const key = memberName.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const descriptor = parsePlcDataTypeDescriptor(rawType, dimsFromName);
          const plcType = descriptor.normalizedType;
          fields.push({
            name: memberName,
            tagPath: memberName,
            plcType,
            baseType: descriptor.baseType,
            isArray: descriptor.isArray,
            arraySpec: descriptor.arraySpec,
            uaType: mapPlcTypeToUaType(descriptor.baseType || plcType),
            usage: "Member",
            enabled: true,
          });
        }
      }
      mergeTemplate({
        name: typeName || "DataType",
        description: "",
        revision: "",
        fields,
      });
      block = blockRe.exec(text);
    }
  }

  const ensureBuiltinTemplate = (name, fields) => {
    const key = String(name || "").trim().toLowerCase();
    if (!key || templateByName.has(key)) return;
    templateByName.set(key, {
      name: String(name || "").trim(),
      description: "Built-in PLC type",
      revision: "",
      fields: (Array.isArray(fields) ? fields : []).map((f) => ({
        name: String(f?.name || "").trim(),
        tagPath: String(f?.name || "").trim(),
        plcType: String(f?.plcType || "").trim(),
        baseType: String(f?.plcType || "").trim(),
        isArray: false,
        arraySpec: "",
        uaType: mapPlcTypeToUaType(String(f?.plcType || "").trim()),
        usage: "Member",
        enabled: true,
      })),
    });
  };

  ensureBuiltinTemplate("TIMER", [
    { name: "PRE", plcType: "DINT" },
    { name: "ACC", plcType: "DINT" },
    { name: "EN", plcType: "BOOL" },
    { name: "TT", plcType: "BOOL" },
    { name: "DN", plcType: "BOOL" },
  ]);

  ensureBuiltinTemplate("COUNTER", [
    { name: "PRE", plcType: "DINT" },
    { name: "ACC", plcType: "DINT" },
    { name: "CU", plcType: "BOOL" },
    { name: "CD", plcType: "BOOL" },
    { name: "DN", plcType: "BOOL" },
    { name: "OV", plcType: "BOOL" },
    { name: "UN", plcType: "BOOL" },
  ]);

  return Array.from(templateByName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function PlcAnalyzer({
  plcItems = [],
  onChange,
  svgCatalog = [],
  onInsertSvg = null,
  initialTab = "overview",
  allowedTabs = null,
}) {
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState(String(initialTab || "overview"));
  const [chatByPlc, setChatByPlc] = useState({});
  const [chatPrompt, setChatPrompt] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [opcPlanByPlc, setOpcPlanByPlc] = useState({});
  const [opcApplyLoading, setOpcApplyLoading] = useState(false);
  const [opcApplyError, setOpcApplyError] = useState("");
  const [opcApplyStatus, setOpcApplyStatus] = useState("");
  const [pendingOpcChoiceByPlc, setPendingOpcChoiceByPlc] = useState({});
  const [debugSessionByPlc, setDebugSessionByPlc] = useState({});
  const [debugSnapshotByPlc, setDebugSnapshotByPlc] = useState({});
  const [debugSessionLoading, setDebugSessionLoading] = useState(false);
  const [debugSessionError, setDebugSessionError] = useState("");
  const [opcConnections, setOpcConnections] = useState([]);
  const [opcConnectionsAt, setOpcConnectionsAt] = useState(0);
  const [opcConnectionsLoading, setOpcConnectionsLoading] = useState(false);
  const [opcConnectionsError, setOpcConnectionsError] = useState("");
  const [memberPickerSelectionByPlc, setMemberPickerSelectionByPlc] = useState({});
  const [memberPickerLoading, setMemberPickerLoading] = useState(false);
  const [expandedSummaryByKey, setExpandedSummaryByKey] = useState({});
  const [aoiTemplateStatus, setAoiTemplateStatus] = useState("");
  const [aoiTemplateError, setAoiTemplateError] = useState("");
  const [aoiTemplateSavingAll, setAoiTemplateSavingAll] = useState(false);
  const [aoiTemplateSavingName, setAoiTemplateSavingName] = useState("");
  const [aoiTemplateSearch, setAoiTemplateSearch] = useState("");
  const [aoiSelectionByPlc, setAoiSelectionByPlc] = useState({});
  const [aoiExpandedByPlc, setAoiExpandedByPlc] = useState({});
  const [aoiExcludedFieldsByPlc, setAoiExcludedFieldsByPlc] = useState({});
  const [dataTypeTemplateStatus, setDataTypeTemplateStatus] = useState("");
  const [dataTypeTemplateError, setDataTypeTemplateError] = useState("");
  const [dataTypeTemplateSavingAll, setDataTypeTemplateSavingAll] = useState(false);
  const [dataTypeTemplateSavingName, setDataTypeTemplateSavingName] = useState("");
  const [dataTypeTemplateSearch, setDataTypeTemplateSearch] = useState("");
  const [dataTypeSelectionByPlc, setDataTypeSelectionByPlc] = useState({});
  const [dataTypeExpandedByPlc, setDataTypeExpandedByPlc] = useState({});
  const [dataTypeNodeExpandedByPlc, setDataTypeNodeExpandedByPlc] = useState({});
  const [dataTypeExcludedFieldsByPlc, setDataTypeExcludedFieldsByPlc] = useState({});
  const [aoiLogicExpandedByName, setAoiLogicExpandedByName] = useState({});
  const [aoiLogicSearch, setAoiLogicSearch] = useState("");
  const [codeGenFormat, setCodeGenFormat] = useState("l5x-template");
  const [codeGenTagSearch, setCodeGenTagSearch] = useState("");
  const [codeGenTagSortByByPlc, setCodeGenTagSortByByPlc] = useState({});
  const [codeGenTagSortDirByPlc, setCodeGenTagSortDirByPlc] = useState({});
  const [codeGenTagsByPlc, setCodeGenTagsByPlc] = useState({});
  const [codeGenNewTagDraft, setCodeGenNewTagDraft] = useState("");
  const [codeGenNewTagEquipmentDraft, setCodeGenNewTagEquipmentDraft] = useState("");
  const [codeGenEquipmentTypesByPlc, setCodeGenEquipmentTypesByPlc] = useState({});
  const [codeGenTagMetaByPlc, setCodeGenTagMetaByPlc] = useState({});
  const [codeGenGroupsByPlc, setCodeGenGroupsByPlc] = useState({});
  const [codeGenTemplateRouteIdDraft, setCodeGenTemplateRouteIdDraft] = useState("");
  const [codeGenRouteTemplateTextByPlc, setCodeGenRouteTemplateTextByPlc] = useState({});
  const [codeGenTemplateRouteNameByPlc, setCodeGenTemplateRouteNameByPlc] = useState({});
  const [codeGenRoutineTemplatesByPlc, setCodeGenRoutineTemplatesByPlc] = useState({});
  const [codeGenGroupNameDraft, setCodeGenGroupNameDraft] = useState("");
  const [codeGenGroupTypeDraft, setCodeGenGroupTypeDraft] = useState("Group");
  const [codeGenGroupSubTypeDraft, setCodeGenGroupSubTypeDraft] = useState("Feed");
  const [codeGenGroupParentDraft, setCodeGenGroupParentDraft] = useState("");
  const [codeGenSelectedGroupId, setCodeGenSelectedGroupId] = useState("");
  const [codeGenDetailNameDraft, setCodeGenDetailNameDraft] = useState("");
  const [codeGenDetailTypeDraft, setCodeGenDetailTypeDraft] = useState("Group");
  const [codeGenDetailSubTypeDraft, setCodeGenDetailSubTypeDraft] = useState("Feed");
  const [codeGenDetailBinNumberDraft, setCodeGenDetailBinNumberDraft] = useState("");
  const [codeGenDetailDescriptionDraft, setCodeGenDetailDescriptionDraft] = useState("");
  const [codeGenExpandedGroupsByPlc, setCodeGenExpandedGroupsByPlc] = useState({});
  const [codeGenExpandedTagsByPlc, setCodeGenExpandedTagsByPlc] = useState({});
  const [codeGenSelectedTagByPlc, setCodeGenSelectedTagByPlc] = useState({});
  const [codeGenTagEditByPlc, setCodeGenTagEditByPlc] = useState({});
  const [codeGenDetailEditByPlc, setCodeGenDetailEditByPlc] = useState({});
  const [codeGenDragGroupId, setCodeGenDragGroupId] = useState("");
  const [codeGenGroupDropTargetId, setCodeGenGroupDropTargetId] = useState("");
  const [codeGenGroupDropParentTargetId, setCodeGenGroupDropParentTargetId] = useState("");
  const [codeGenTagDropTargetGroupId, setCodeGenTagDropTargetGroupId] = useState("");
  const [codeGenIoDraftByPlc, setCodeGenIoDraftByPlc] = useState({});
  const [codeGenIoNameDraftByPlc, setCodeGenIoNameDraftByPlc] = useState({});
  const [codeGenIoTypeByPlc, setCodeGenIoTypeByPlc] = useState({});
  const [codeGenTagEquipmentDraftByPlc, setCodeGenTagEquipmentDraftByPlc] = useState({});
  const [codeGenObjectContextMenu, setCodeGenObjectContextMenu] = useState(null);
  const [codeGenDragTag, setCodeGenDragTag] = useState("");
  const [codeGenPersistReadyByPlc, setCodeGenPersistReadyByPlc] = useState({});
  const [codeGenReady, setCodeGenReady] = useState(false);
  const [codeGenPanelRatiosByPlc, setCodeGenPanelRatiosByPlc] = useState({});
  const [codeGenPanelResize, setCodeGenPanelResize] = useState(null);
  const [globalTemplateTypeNames, setGlobalTemplateTypeNames] = useState([]);
  const [storedOpcTemplates, setStoredOpcTemplates] = useState([]);
  const [globalCodeGenBaseText, setGlobalCodeGenBaseText] = useState("");
  const [plcTopTab, setPlcTopTab] = useState(
    String(initialTab || "").trim() === "code-gen-pro" ? "code-gen-pro" : "plc"
  );
  const chatScrollRef = useRef(null);
  const codeGenSaveTimerRef = useRef(null);
  const codeGenLastSavedSnapshotByPlcRef = useRef({});
  const codeGenPersistErrorAtRef = useRef(0);
  const codeGenProfileLoadedByPlcRef = useRef({});
  const lastPlcInnerTabRef = useRef("overview");
  const codeGenPanelsHostRef = useRef(null);
  const codeGenObjectContextMenuRef = useRef(null);
  const plcTabs = useMemo(
    () => [
      { key: "overview", label: "Overview" },
      { key: "ai", label: "AI" },
      { key: "aoi-templates", label: "AOI Templates" },
      { key: "aoi-logic", label: "AOI Logic" },
      { key: "code-gen-pro", label: "Code Gen Pro" },
      { key: "datatype-templates", label: "Data Type Templates" },
    ],
    []
  );
  const allowedPlcTabSet = useMemo(() => {
    if (!Array.isArray(allowedTabs) || !allowedTabs.length) return null;
    return new Set(allowedTabs.map((k) => String(k || "").trim()).filter(Boolean));
  }, [allowedTabs]);
  const visiblePlcTabs = useMemo(() => {
    const base = !allowedPlcTabSet
      ? plcTabs
      : (() => {
          const out = plcTabs.filter((tab) => allowedPlcTabSet.has(String(tab.key || "")));
          return out.length ? out : plcTabs;
        })();
    const codeGenTab = base.find((tab) => String(tab?.key || "") === "code-gen-pro");
    if (String(plcTopTab || "") === "code-gen-pro" && codeGenTab) return [codeGenTab];
    const nonCodeGen = base.filter((tab) => String(tab?.key || "") !== "code-gen-pro");
    return nonCodeGen.length ? nonCodeGen : base;
  }, [allowedPlcTabSet, plcTabs, plcTopTab]);
  const showTopLevelPlcTabs = false;
  const codeGenOnlyView = String(plcTopTab || "") === "code-gen-pro";

  const selected = useMemo(() => {
    const list = Array.isArray(plcItems) ? plcItems : [];
    if (!list.length) return null;
    const exact = list.find((x) => String(x?.id) === String(selectedId));
    return exact || list[0];
  }, [plcItems, selectedId]);

  const analysis = selected?.analysis || null;
  const chatKey = String(selected?.id || GLOBAL_CODE_GEN_BASE_KEY);
  const persistedChatMessages = Array.isArray(selected?.chatHistory) ? selected.chatHistory : [];
  const chatMessages = Array.isArray(chatByPlc?.[chatKey]) ? chatByPlc[chatKey] : persistedChatMessages;
  const persistedOpcPlan = selected?.opcPlan && typeof selected.opcPlan === "object" ? selected.opcPlan : null;
  const opcPlan =
    opcPlanByPlc?.[chatKey] && typeof opcPlanByPlc[chatKey] === "object"
      ? opcPlanByPlc[chatKey]
      : persistedOpcPlan;
  const debugSessionId = String(debugSessionByPlc?.[chatKey] || selected?.debugSessionId || "").trim();
  const debugSnapshot = debugSnapshotByPlc?.[chatKey] || null;
  const activePendingChoice = pendingOpcChoiceByPlc?.[chatKey] || null;
  const memberPickerSelected = Array.isArray(memberPickerSelectionByPlc?.[chatKey])
    ? memberPickerSelectionByPlc[chatKey]
    : [];
  const aoiTemplates = useMemo(() => {
    if (String(activeTab || "") !== "aoi-templates") return [];
    const fromRaw = scanAoiTemplates(String(selected?.rawText || ""));
    if (fromRaw.length) return fromRaw;
    return (Array.isArray(storedOpcTemplates) ? storedOpcTemplates : [])
      .filter((row) => String(row?.group_name || "").trim().toLowerCase() === "aoi")
      .map((row) => ({
        name: String(row?.name || "").trim(),
        description: "",
        revision: "",
        fields: (Array.isArray(row?.fields) ? row.fields : []).map((field) => ({
          name: String(field?.name || "").trim(),
          tagPath: String(field?.tagPath || field?.name || "").trim(),
          plcType: String(field?.plcType || "").trim(),
          baseType: String(field?.baseType || "").trim(),
          isArray: field?.isArray === true,
          arraySpec: String(field?.arraySpec || "").trim(),
          uaType: String(field?.uaType || "").trim(),
          usage: String(field?.usage || "").trim(),
          enabled: field?.enabled !== false,
        })),
      }))
      .filter((row) => String(row?.name || "").trim())
      .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
  }, [activeTab, selected?.rawText, storedOpcTemplates]);
  const allAoiEquipmentTypeNames = useMemo(() => {
    const scanned = scanAoiTemplates(String(selected?.rawText || ""))
      .map((t) => String(t?.name || "").trim())
      .filter(Boolean);
    const global = Array.isArray(globalTemplateTypeNames) ? globalTemplateTypeNames : [];
    return Array.from(new Set([...scanned, ...global].map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [selected?.rawText, globalTemplateTypeNames]);
  const dataTypeTemplates = useMemo(() => {
    if (String(activeTab || "") !== "datatype-templates") return [];
    const fromRaw = scanDataTypeTemplates(String(selected?.rawText || ""));
    if (fromRaw.length) return fromRaw;
    return (Array.isArray(storedOpcTemplates) ? storedOpcTemplates : [])
      .filter((row) => String(row?.group_name || "").trim().toLowerCase() === "datatype")
      .map((row) => ({
        name: String(row?.name || "").trim(),
        description: "",
        revision: "",
        fields: (Array.isArray(row?.fields) ? row.fields : []).map((field) => ({
          name: String(field?.name || "").trim(),
          tagPath: String(field?.tagPath || field?.name || "").trim(),
          plcType: String(field?.plcType || "").trim(),
          baseType: String(field?.baseType || "").trim(),
          isArray: field?.isArray === true,
          arraySpec: String(field?.arraySpec || "").trim(),
          uaType: String(field?.uaType || "").trim(),
          usage: String(field?.usage || "").trim(),
          enabled: field?.enabled !== false,
        })),
      }))
      .filter((row) => String(row?.name || "").trim())
      .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
  }, [activeTab, selected?.rawText, storedOpcTemplates]);
  const filteredAoiTemplates = useMemo(() => {
    const q = String(aoiTemplateSearch || "").trim().toLowerCase();
    if (!q) return aoiTemplates;
    return aoiTemplates.filter((t) => {
      const name = String(t?.name || "").toLowerCase();
      if (name.includes(q)) return true;
      return (Array.isArray(t?.fields) ? t.fields : []).some((f) =>
        String(f?.name || "").toLowerCase().includes(q) ||
        String(f?.tagPath || "").toLowerCase().includes(q) ||
        String(f?.plcType || "").toLowerCase().includes(q) ||
        String(f?.baseType || "").toLowerCase().includes(q)
      );
    });
  }, [aoiTemplates, aoiTemplateSearch]);
  const filteredDataTypeTemplates = useMemo(() => {
    const q = String(dataTypeTemplateSearch || "").trim().toLowerCase();
    if (!q) return dataTypeTemplates;
    return dataTypeTemplates.filter((t) => {
      const name = String(t?.name || "").toLowerCase();
      if (name.includes(q)) return true;
      return (Array.isArray(t?.fields) ? t.fields : []).some((f) =>
        String(f?.name || "").toLowerCase().includes(q) ||
        String(f?.tagPath || "").toLowerCase().includes(q) ||
        String(f?.plcType || "").toLowerCase().includes(q) ||
        String(f?.baseType || "").toLowerCase().includes(q)
      );
    });
  }, [dataTypeTemplates, dataTypeTemplateSearch]);
  const aoiLogicBlocks = useMemo(() => {
    if (String(activeTab || "") !== "aoi-logic") return [];
    return extractAoiLogicBlocks(String(selected?.rawText || ""), String(analysis?.fileFormat || ""));
  }, [activeTab, selected?.rawText, analysis?.fileFormat]);
  const filteredAoiLogicBlocks = useMemo(() => {
    const q = String(aoiLogicSearch || "").trim().toLowerCase();
    if (!q) return aoiLogicBlocks;
    return aoiLogicBlocks.filter((b) => String(b?.name || "").toLowerCase().includes(q));
  }, [aoiLogicBlocks, aoiLogicSearch]);
  const codeGenUserTags = useMemo(
    () => (Array.isArray(codeGenTagsByPlc?.[chatKey]) ? codeGenTagsByPlc[chatKey] : []),
    [chatKey, codeGenTagsByPlc]
  );
  const codeGenTagMeta = useMemo(
    () => (codeGenTagMetaByPlc?.[chatKey] && typeof codeGenTagMetaByPlc[chatKey] === "object" ? codeGenTagMetaByPlc[chatKey] : {}),
    [chatKey, codeGenTagMetaByPlc]
  );
  const codeGenEquipmentTypeOptions = useMemo(
    () =>
      Array.from(
        new Set((Array.isArray(codeGenEquipmentTypesByPlc?.[chatKey]) ? codeGenEquipmentTypesByPlc[chatKey] : []).map((v) => String(v || "").trim()).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b)),
    [chatKey, codeGenEquipmentTypesByPlc]
  );
  const codeGenRouteTemplateText = useMemo(
    () => String(codeGenRouteTemplateTextByPlc?.[chatKey] || ""),
    [chatKey, codeGenRouteTemplateTextByPlc]
  );
  const codeGenTemplateRouteName = useMemo(
    () => String(codeGenTemplateRouteNameByPlc?.[chatKey] || ""),
    [chatKey, codeGenTemplateRouteNameByPlc]
  );
  const codeGenRoutineTemplates = useMemo(
    () =>
      codeGenRoutineTemplatesByPlc?.[chatKey] && typeof codeGenRoutineTemplatesByPlc[chatKey] === "object"
        ? codeGenRoutineTemplatesByPlc[chatKey]
        : {},
    [chatKey, codeGenRoutineTemplatesByPlc]
  );
  const codeGenOutputText = useMemo(() => {
    if (String(activeTab || "") !== "code-gen-pro" || !codeGenReady) return "";
    const escapeXml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    const sanitizeControllerName = (value) => {
      const cleaned = String(value || "").replace(/[^A-Za-z0-9_]/g, "_");
      const collapsed = cleaned.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
      return collapsed || "MyController";
    };
    const tags = Array.from(new Set(codeGenUserTags.map((t) => String(t || "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
    const groups = Array.isArray(codeGenGroupsByPlc?.[chatKey]) ? codeGenGroupsByPlc[chatKey] : [];
    const groupById = new Map(groups.map((g) => [String(g?.id || ""), g]));
    const groupPathById = new Map();
    const resolveGroupPath = (id, path = new Set()) => {
      const key = String(id || "").trim();
      if (!key) return "";
      if (groupPathById.has(key)) return groupPathById.get(key);
      if (path.has(key)) return "";
      const current = groupById.get(key);
      if (!current) return "";
      const parentId = String(current?.parentId || "").trim();
      const nextPath = new Set(path);
      nextPath.add(key);
      const parentPath = parentId ? resolveGroupPath(parentId, nextPath) : "";
      const name = String(current?.name || "").trim() || "Group";
      const full = parentPath ? `${parentPath}.${name}` : name;
      groupPathById.set(key, full);
      return full;
    };
    const tagGroup = new Map();
    groups.forEach((group) => {
      const gid = String(group?.id || "").trim();
      const gpath = resolveGroupPath(gid);
      (Array.isArray(group?.tags) ? group.tags : []).forEach((tag) => {
        const t = String(tag || "").trim();
        if (!t) return;
        if (!tagGroup.has(t)) tagGroup.set(t, gpath || "");
      });
    });

    if (codeGenFormat === "l5x-template") {
      const controllerName = sanitizeControllerName(selected?.name || "MyController");
      const buildImportSafeStarterL5x = () => {
        const findRouteAncestorName = (group) => {
          let cursor = group;
          let guard = 0;
          while (cursor && guard < 64) {
            const type = String(cursor?.groupType || "").trim().toLowerCase();
            const name = String(cursor?.name || "").trim();
            if (type === "route" && name) return name;
            const pid = String(cursor?.parentId || "").trim();
            cursor = pid ? groupById.get(pid) || null : null;
            guard += 1;
          }
          return "";
        };
        const routeNames = Array.from(
          new Set(
            (Array.isArray(groups) ? groups : [])
              .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "route")
              .map((g) => String(g?.name || "").trim())
              .filter(Boolean)
          )
        );
        const ioNames = Array.from(
          new Set(
            (Array.isArray(groups) ? groups : [])
              .filter((g) => {
                const t = String(g?.groupType || "").trim().toLowerCase();
                return t === "sender" || t === "receiver";
              })
              .map((g) => {
                const own = String(g?.name || "").trim();
                const route = findRouteAncestorName(g);
                if (!own) return "";
                return route ? `${route}_${own}` : own;
              })
              .filter(Boolean)
          )
        );
        const subRouteNames = Array.from(
          new Set(
            (Array.isArray(groups) ? groups : [])
              .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "subroute")
              .map((g) => {
                const own = String(g?.name || "").trim();
                const route = findRouteAncestorName(g);
                if (!own) return "";
                if (!route) return own;
                const routePrefix = `${route}_`.toLowerCase();
                return own.toLowerCase().startsWith(routePrefix) ? own : `${route}_${own}`;
              })
              .filter(Boolean)
          )
        );
        const groupNames = Array.from(
          new Set(
            (Array.isArray(groups) ? groups : [])
              .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "group")
              .map((g) => String(g?.name || "").trim())
              .filter(Boolean)
          )
        );
        const binNames = Array.from(
          new Set(
            (Array.isArray(groups) ? groups : [])
              .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "bin")
              .map((g) => {
                const own = String(g?.name || "").trim();
                if (!own) return "";
                const pid = String(g?.parentId || "").trim();
                const parent = pid ? groupById.get(pid) : null;
                const parentName = String(parent?.name || "").trim();
                const route = findRouteAncestorName(g);
                if (parentName && route) return `${route}_${parentName}_${own}`;
                if (parentName) return `${parentName}_${own}`;
                return own;
              })
              .filter(Boolean)
          )
        );
        const senderNames = Array.from(
          new Set(
            (Array.isArray(groups) ? groups : [])
              .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "sender")
              .map((g) => {
                const own = String(g?.name || "").trim();
                const route = findRouteAncestorName(g);
                if (!own) return "";
                return route ? `${route}_${own}` : own;
              })
              .filter(Boolean)
          )
        );
        const receiverNames = Array.from(
          new Set(
            (Array.isArray(groups) ? groups : [])
              .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "receiver")
              .map((g) => {
                const own = String(g?.name || "").trim();
                const route = findRouteAncestorName(g);
                if (!own) return "";
                return route ? `${route}_${own}` : own;
              })
              .filter(Boolean)
          )
        );
        const routeDataNames = routeNames.map((n) => `${n}_Data`);
        const routeMixerNames = routeNames.map((n) => `${n}_Mixer1`);
        const routeDataEmptyRecipeNames = routeDataNames.map((n) => `${n}_EmptyRecipe`);
        const subRouteDataNames = subRouteNames.map((n) => `${n}_Data`);
        const subRouteMgrNames = subRouteNames.map((n) => `${n}_Group_Mgr`);
        const subRouteToolNames = subRouteNames.map((n) => `${n}_Tool`);
        const subRouteToolEnableNames = subRouteNames.map((n) => `${n}_Tool_Enable`);
        const receiverMgrNames = receiverNames.map((n) => `${n}_Mgr`);

        const canonicalStarterTypeNames = [
          "Route",
          "Route1Data",
          "Group",
          "GroupControl",
          "GroupControl_Mgr",
          "GroupControl_RouteTool",
          "BinControl",
          "BinControl_Mgr",
          "BatchControl",
          "BatchControl_Mixer",
          "BatchControl_RecipeIngr",
          "BatchControl_Bin",
        ];
        const canonicalStarterDataTypes = buildDataTypeClosureByNames(udtLibraryRaw, canonicalStarterTypeNames);
        const starterLocalDataTypes = [
          [
            '<DataType Name="Route_GroupControl" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="State" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route_Group" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="i_Required" DataType="BOOL" Dimension="512" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="o_Selected" DataType="BOOL" Dimension="512" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="o_SelectedIdle" DataType="BOOL" Dimension="512" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="o_Conflict" DataType="BOOL" Dimension="512" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="o_ConflictCommodity" DataType="BOOL" Dimension="512" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="i_NotRelevantRunning" DataType="BOOL" Dimension="512" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="i_NotRelevantStopped" DataType="BOOL" Dimension="512" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="i_NotRelevantFault" DataType="BOOL" Dimension="512" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="ArrayLength" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Fgr" DataType="Route_GroupControl" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Mgr" DataType="Route_GroupControl" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Wgr" DataType="Route_GroupControl" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Ggr" DataType="Route_GroupControl" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="All" DataType="Route_GroupControl" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="ArrayClearBool" DataType="ArrayClearBool" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="ArrayCopyBool" DataType="ArrayCopyBool" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="RouteVerified" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="VerificationFailed" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="StartFailed" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="RunFailed" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="StopFailed" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="PauseFailed" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="PauseTimeOut" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="LogFailed" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="GroupConflict" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CommodityConflict" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route_Cmd" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="CmdHornOff" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdFaultReset" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdStart" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdContinue" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdPause" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdStop" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdImmediateStop" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdSoftStop" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdReset" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdAuto" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdAbortBatch" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdLogged" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdModify" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd13" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd14" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd15" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdHornOn" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd17" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd18" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd19" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd20" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd21" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd22" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd23" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd24" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd25" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd26" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd27" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd28" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd29" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Cmd30" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route_HMI_Write" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="Cmd" DataType="Route_Cmd" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="VerifyFailDelayPreset" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="StartFailDelayPreset" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="StopFailDelayPreset" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="PauseFailDelayPreset" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="PauseTimeoutPreset" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="RunFailDelayPreset" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="LogFailDelayPreset" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route_Job_State" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="St_Passive" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Verifying" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Active" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Ready" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Emptying" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Logging" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Idling" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Transition_ToVerifying" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Transition_ToActive" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Transition_ToReady" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Transition_ToEmptying" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Transition_ToLogging" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Transition_ToIdling" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Transition_ToPassive" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="HMI_State" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route_Route_State" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="St_Passive" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Verifying" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Starting" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Running" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Pausing" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Paused" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Stopping" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Stopped" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Fault" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Logging" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="St_Idling" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="HMI_State" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route_Status" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="FeedHold" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="FeedHoldPlc" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="ImmediateStop" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="SoftStop" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="AutoStart" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="JobMoveRequest" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="JobMoveOk" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="CmdNewJobBatch" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="LogRequest" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route_HMI_Read" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="Job_State" DataType="Route_Job_State" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Route_State" DataType="Route_Route_State" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Status" DataType="Route_Status" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="ID" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="EmptyingTimeRemaining" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="EmptyingTimer" DataType="TIMER" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="VerifyFailTimer" DataType="TIMER" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="LoggingFailTimer" DataType="TIMER" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="HMI_Write" DataType="Route_HMI_Write" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="HMI_Read" DataType="Route_HMI_Read" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Gr" DataType="Route_Group" Radix="NullType" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="ParCommodityCheck" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="RouteArrayPointer" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            '    <Member Name="Commodity" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="Route1Data" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="State" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="GroupControl_Mgr" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="State" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="GroupControl_RouteTool" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="Enable" DataType="BOOL" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="BinControl" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="State" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="BinControl_Mgr" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="State" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="BatchControl" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="State" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="BatchControl_Mixer" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="MixerNumber" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="BatchControl_RecipeIngr" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="BinNo" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
          [
            '<DataType Name="BatchControl_Bin" Family="NoFamily" Class="User">',
            "  <Members>",
            '    <Member Name="BinNo" DataType="DINT" Radix="Decimal" Hidden="false" ExternalAccess="Read/Write"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n"),
        ];
        const mergeUniqueBlocksByName = (blocks = [], tagName = "DataType") => {
          const byName = new Map();
          (Array.isArray(blocks) ? blocks : []).forEach((block) => {
            const head = String(block || "").match(new RegExp(`<${tagName}\\b([^>]*)>`, "i"));
            const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            const key = name.toLowerCase();
            if (!key) return;
            byName.set(key, String(block || ""));
          });
          return Array.from(byName.values());
        };
        const getBlockNames = (blocks = [], tagName = "DataType") =>
          (Array.isArray(blocks) ? blocks : [])
            .map((block) => {
              const head = String(block || "").match(new RegExp(`<${tagName}\\b([^>]*)>`, "i"));
              return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            })
            .filter(Boolean);

        let starterDataTypes = mergeUniqueBlocksByName([...canonicalStarterDataTypes, ...starterLocalDataTypes], "DataType");
        let starterAoiBlocks = [];
        for (let i = 0; i < 3; i += 1) {
          const starterTypeNames = getBlockNames(starterDataTypes, "DataType");
          const starterAoiRootNames = extractCustomDataTypeRefsFromBlocks(starterDataTypes, starterTypeNames);
          starterAoiBlocks = buildAoiClosureByNames(aoiLibraryRaw, starterAoiRootNames, starterDataTypes);
          const starterAoiNames = getBlockNames(starterAoiBlocks, "AddOnInstructionDefinition");
          const aoiRequiredTypeNames = extractCustomDataTypeRefsFromBlocks(starterAoiBlocks, starterAoiNames);
          const aoiRequiredTypeBlocks = buildDataTypeClosureByNames(udtLibraryRaw, aoiRequiredTypeNames);
          const nextDataTypes = mergeUniqueBlocksByName([...starterDataTypes, ...aoiRequiredTypeBlocks], "DataType");
          if (nextDataTypes.length === starterDataTypes.length) break;
          starterDataTypes = nextDataTypes;
        }

        const starterTags = [
          ...routeNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="Route" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...routeDataNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="Route1Data" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...routeDataEmptyRecipeNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="BatchControl_RecipeIngr" Dimensions="18" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...routeMixerNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="BatchControl_Mixer" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...subRouteNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="Route" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...subRouteDataNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="Route1Data" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...subRouteMgrNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="GroupControl_Mgr" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...subRouteToolNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="GroupControl_RouteTool" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...subRouteToolEnableNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="BOOL" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...groupNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="Group" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...senderNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="BatchControl" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...receiverNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="BinControl" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...receiverMgrNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="BinControl_Mgr" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
          ...binNames.map(
            (n) =>
              `<Tag Name="${n}" Class="Standard" TagType="Base" DataType="BatchControl_Bin" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`
          ),
        ];

        return [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          `<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00" TargetName="${escapeXml(controllerName)}" TargetType="Controller" ContainsContext="true" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">`,
          `  <Controller Name="${escapeXml(controllerName)}" ProcessorType="1756-L8x" MajorRev="35" MinorRev="11" TimeSlice="20" ShareUnusedTimeSlice="1">`,
          "    <RedundancyInfo Enabled=\"false\"/>",
          "    <Security Code=\"0\"/>",
          "    <DataTypes>",
          starterDataTypes.map((b) => indentBlock(b, "      ")).join("\n"),
          "    </DataTypes>",
          "    <Modules/>",
          starterAoiBlocks.length ? "    <AddOnInstructionDefinitions>" : "    <AddOnInstructionDefinitions/>",
          starterAoiBlocks.map((b) => indentBlock(b, "      ")).join("\n"),
          starterAoiBlocks.length ? "    </AddOnInstructionDefinitions>" : "",
          starterTags.length ? "    <Tags>" : "    <Tags/>",
          starterTags.map((b) => indentBlock(b, "      ")).join("\n"),
          starterTags.length ? "    </Tags>" : "",
          "    <Programs>",
          '      <Program Name="MainProgram" TestEdits="false" Disabled="false" MainRoutineName="Main">',
          "        <Tags/>",
          "        <Routines>",
          '          <Routine Name="Main" Type="RLL"><RLLContent><Rung Number="0" Type="N"><Text><![CDATA[NOP();]]></Text></Rung></RLLContent></Routine>',
          "        </Routines>",
          "      </Program>",
          '      <Program Name="Routing" TestEdits="false" Disabled="false" MainRoutineName="MainRoutine">',
          "        <Tags/>",
          "        <Routines>",
          '          <Routine Name="MainRoutine" Type="RLL"><RLLContent><Rung Number="0" Type="N"><Text><![CDATA[NOP();]]></Text></Rung></RLLContent></Routine>',
          "        </Routines>",
          "      </Program>",
          "    </Programs>",
          "    <Tasks>",
          '      <Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">',
          "        <ScheduledPrograms>",
          '          <ScheduledProgram Name="MainProgram"/>',
          '          <ScheduledProgram Name="Routing"/>',
          "        </ScheduledPrograms>",
          "      </Task>",
          "    </Tasks>",
          "  </Controller>",
          "</RSLogix5000Content>",
        ]
          .filter((line) => line !== "")
          .join("\n");
      };
      return sanitizeGeneratedL5xForImport(buildImportSafeStarterL5x());
      const sourceRouteName = String(codeGenTemplateRouteName || "").trim();
      const routeObject =
        groups.find(
          (g) =>
            String(g?.groupType || "").trim().toLowerCase() === "route" ||
            /^route\s*\d*$/i.test(String(g?.name || "").trim())
        ) || null;
      const targetRouteName = String(routeObject?.name || sourceRouteName).trim();
      const hasRouteObject = !!routeObject;
      const routeObjectNames = Array.from(
        new Set(
          groups
            .filter(
              (g) =>
                String(g?.groupType || "").trim().toLowerCase() === "route" ||
                /^route\s*\d*$/i.test(String(g?.name || "").trim())
            )
            .map((g) => String(g?.name || "").trim())
            .filter(Boolean)
        )
      );
      const findRouteAncestorName = (group) => {
        let cursor = group;
        let guard = 0;
        while (cursor && guard < 64) {
          const type = String(cursor?.groupType || "").trim().toLowerCase();
          const name = String(cursor?.name || "").trim();
          if (type === "route" || /^route\s*\d*$/i.test(name)) return name;
          const pid = String(cursor?.parentId || "").trim();
          cursor = pid ? groupById.get(pid) || null : null;
          guard += 1;
        }
        return "";
      };
      const binControlObjectNames = Array.from(
        new Set(
          groups
            .filter((g) => {
              const type = String(g?.groupType || "").trim().toLowerCase();
              return type === "sender" || type === "receiver";
            })
            .map((g) => {
              const ownName = String(g?.name || "").trim();
              const routeAncestor = findRouteAncestorName(g);
              if (!ownName) return "";
              return routeAncestor ? `${routeAncestor}_${ownName}` : ownName;
            })
            .filter(Boolean)
        )
      );
      const subRouteObjectNames = Array.from(
        new Set(
          groups
            .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "subroute")
            .map((g) => {
              const ownName = String(g?.name || "").trim();
              const routeAncestor = findRouteAncestorName(g);
              if (!ownName || !routeAncestor) return "";
              const routePrefix = `${routeAncestor}_`.toLowerCase();
              if (ownName.toLowerCase().startsWith(routePrefix)) return ownName;
              return `${routeAncestor}_${ownName}`;
            })
            .filter(Boolean)
        )
      );
      const primaryRouteGroup =
        groups.find((g) => String(g?.groupType || "").trim().toLowerCase() === "route") || null;
      const groupsByIdForAlarm = new Map(groups.map((g) => [String(g?.id || "").trim(), g]));
      const childIdsByParentForAlarm = (() => {
        const out = new Map();
        groups.forEach((g) => {
          const pid = String(g?.parentId || "").trim();
          const id = String(g?.id || "").trim();
          if (!pid || !id) return;
          if (!out.has(pid)) out.set(pid, []);
          out.get(pid).push(id);
        });
        return out;
      })();
      const collectRouteBranchGroups = (routeIdRaw) => {
        const routeId = String(routeIdRaw || "").trim();
        if (!routeId) return [];
        const out = [];
        const seen = new Set();
        const stack = [routeId];
        while (stack.length) {
          const id = String(stack.pop() || "").trim();
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const row = groupsByIdForAlarm.get(id);
          if (row) out.push(row);
          const kids = childIdsByParentForAlarm.get(id) || [];
          for (const kid of kids) stack.push(String(kid || "").trim());
        }
        return out;
      };
      const routeBranchGroups = collectRouteBranchGroups(String(primaryRouteGroup?.id || ""));
      const alarmResetSubRouteObjectNames = Array.from(
        new Set(
          routeBranchGroups
            .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "subroute")
            .map((g) => {
              const ownName = String(g?.name || "").trim();
              const routeAncestor = findRouteAncestorName(g);
              if (!ownName || !routeAncestor) return "";
              const routePrefix = `${routeAncestor}_`.toLowerCase();
              if (ownName.toLowerCase().startsWith(routePrefix)) return ownName;
              return `${routeAncestor}_${ownName}`;
            })
            .filter(Boolean)
        )
      );
      const alarmResetIoObjectNames = Array.from(
        new Set(
          routeBranchGroups
            .filter((g) => {
              const type = String(g?.groupType || "").trim().toLowerCase();
              return type === "sender";
            })
            .map((g) => {
              const ownName = String(g?.name || "").trim();
              const routeAncestor = findRouteAncestorName(g);
              if (!ownName) return "";
              return routeAncestor ? `${routeAncestor}_${ownName}` : ownName;
            })
            .filter(Boolean)
        )
      );
      const alarmResetBinObjectNames = Array.from(
        new Set(
          routeBranchGroups
            .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "bin")
            .map((g) => {
              const ownName = String(g?.name || "").trim();
              if (!ownName) return "";
              let cursor = g;
              let guard = 0;
              while (cursor && guard < 64) {
                const type = String(cursor?.groupType || "").trim().toLowerCase();
                const name = String(cursor?.name || "").trim();
                if (type === "sender" && name) {
                  const routeAncestor = findRouteAncestorName(cursor);
                  const parentName = routeAncestor ? `${routeAncestor}_${name}` : name;
                  return `${parentName}_${ownName}`;
                }
                const pid = String(cursor?.parentId || "").trim();
                cursor = pid ? groupsByIdForAlarm.get(pid) || null : null;
                guard += 1;
              }
              return ownName;
            })
            .filter(Boolean)
        )
      );
      const binObjectNames = Array.from(
        new Set(
          groups
            .filter((g) => String(g?.groupType || "").trim().toLowerCase() === "bin")
            .map((g) => {
              const ownName = String(g?.name || "").trim();
              if (!ownName) return "";
              let cursor = g;
              let guard = 0;
              while (cursor && guard < 64) {
                const type = String(cursor?.groupType || "").trim().toLowerCase();
                const name = String(cursor?.name || "").trim();
                if ((type === "sender" || type === "receiver") && name) {
                  const routeAncestor = findRouteAncestorName(cursor);
                  const parentName = routeAncestor ? `${routeAncestor}_${name}` : name;
                  return `${parentName}_${ownName}`;
                }
                const pid = String(cursor?.parentId || "").trim();
                cursor = pid ? groupById.get(pid) || null : null;
                guard += 1;
              }
              return ownName;
            })
            .filter(Boolean)
        )
      );
      const buildMainRoutineProgramsXml = () => {
        const PROGRAM_NAME = "Routing";
        const MAIN_ROUTINE_NAME = "MainRoutine";
        const LEGACY_PROGRAM_NAME = "MainProgram";
        const LEGACY_MAIN_ROUTINE_NAME = "Main";
        const isRouteType = (group) => String(group?.groupType || "").trim().toLowerCase() === "route";
        const isSubRouteType = (group) => String(group?.groupType || "").trim().toLowerCase() === "subroute";
        const childrenByParent = new Map();
        groups.forEach((g) => {
          const pid = String(g?.parentId || "").trim();
          if (!pid) return;
          if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
          childrenByParent.get(pid).push(g);
        });
        const routeRoots = groups.filter((g) => isRouteType(g));
        const routeExec = [];
        let routeArrayIndex = 0;
        routeRoots.forEach((routeRoot) => {
          const routeName = String(routeRoot?.name || "").trim();
          if (!routeName) return;
          const routeChildren = (childrenByParent.get(String(routeRoot?.id || "").trim()) || []).filter((g) => isSubRouteType(g));
          if (routeChildren.length) {
            routeExec.push({ kind: "route-control", routeName, sourceTemplate: "Route1_0_Control" });
            routeChildren.forEach((sub) => {
              const subName = String(sub?.name || "").trim();
              if (!subName) return;
              // SubRoute tags are generated as <RouteName>_<SubRouteName>; keep routine calls aligned.
              const routePrefix = `${routeName}_`.toLowerCase();
              const fullSubRouteName = subName.toLowerCase().startsWith(routePrefix)
                ? subName
                : `${routeName}_${subName}`;
              routeExec.push({
                kind: "route-run",
                routeName: fullSubRouteName,
                baseRouteName: routeName,
                index: routeArrayIndex,
                controlSourceTemplate: "Route1_1_Control",
                statusSourceTemplate: "Route1_1_Status",
              });
              routeArrayIndex += 1;
            });
            return;
          }
          routeExec.push({
            kind: "route-run",
            routeName,
            baseRouteName: routeName,
            index: routeArrayIndex,
            controlSourceTemplate: "Route1_1_Control",
            statusSourceTemplate: "Route1_1_Status",
          });
          routeArrayIndex += 1;
        });
        const rungBlocks = routeExec.map((row, idx) => {
          if (row.kind === "route-control") {
            return [
              `            <Rung Number="${idx}" Type="N">`,
              `              <Comment><![CDATA[${row.routeName}]]></Comment>`,
              `              <Text><![CDATA[JSR(${row.routeName}_0_Control,0);]]></Text>`,
              "            </Rung>",
            ].join("\n");
          }
          return [
            `            <Rung Number="${idx}" Type="N">`,
            `              <Comment><![CDATA[${row.routeName}]]></Comment>`,
            `              <Text><![CDATA[[MOVE(${row.index},${row.routeName}.RouteArrayPointer) ,CPS(${row.routeName},Route_Array.Route[${row.index}],1) ,JSR(${row.routeName}_Control,0) ,JSR(${row.routeName}_Status,0) ,CPS(${row.routeName},Route_Array.Route[${row.index}],1) ];]]></Text>`,
            "            </Rung>",
          ].join("\n");
        });
        const rllContent = rungBlocks.length
          ? ["            <RLLContent>", rungBlocks.join("\n"), "            </RLLContent>"].join("\n")
          : "            <RLLContent/>";
        const persistedRoutineTemplates =
          codeGenRoutineTemplates && typeof codeGenRoutineTemplates === "object"
            ? codeGenRoutineTemplates
            : {};
        const allTemplateSources = (() => {
          const seen = new Set();
          const out = [];
          const pushIfL5x = (raw) => {
            const text = String(raw || "");
            if (!/<RSLogix5000Content\b/i.test(text)) return;
            const key = text.slice(0, 8192);
            if (seen.has(key)) return;
            seen.add(key);
            out.push(text);
          };
          // DB-backed standard only: runtime export should not depend on transient uploaded raw text.
          pushIfL5x(String(codeGenRouteTemplateText || ""));
          return out;
        })();
        const sourceText = String(allTemplateSources[0] || "");
        const sourceIsMainRoutineExport =
          /TargetType\s*=\s*"Routine"/i.test(sourceText) && /TargetName\s*=\s*"Main"/i.test(sourceText);
        const preferredMainProgramNames = ["KE_MainProgram", "MainProgram"];
        const findProgramBodyByName = (programName) => {
          const wanted = String(programName || "").trim().toLowerCase();
          if (!wanted) return "";
          for (const src of allTemplateSources) {
            const re = /<Program\b([^>]*)>([\s\S]*?)<\/Program>/gi;
            let m = re.exec(src);
            while (m) {
              const attrs = String(m[1] || "");
              const name = String(extractAttr(attrs, "Name") || "").trim().toLowerCase();
              if (name === wanted) return String(m[2] || "");
              m = re.exec(src);
            }
          }
          return "";
        };
        const getRoutineTemplateFromText = (text, routineName) => {
          const wanted = String(routineName || "").trim().toLowerCase();
          if (!wanted) return "";
          const re = /<Routine\b([^>]*)>([\s\S]*?)<\/Routine>/gi;
          let m = re.exec(String(text || ""));
          while (m) {
            const attrs = String(m[1] || "");
            const name = String(extractAttr(attrs, "Name") || "").trim().toLowerCase();
            if (name === wanted) return `<Routine ${attrs.trim()}>\n${String(m[2] || "").trim()}\n</Routine>`;
            m = re.exec(String(text || ""));
          }
          return "";
        };
        const getRoutineTemplatesByNameFromText = (text, routineName) => {
          const wanted = String(routineName || "").trim().toLowerCase();
          if (!wanted) return [];
          const out = [];
          const re = /<Routine\b([^>]*)>([\s\S]*?)<\/Routine>/gi;
          let m = re.exec(String(text || ""));
          while (m) {
            const attrs = String(m[1] || "");
            const name = String(extractAttr(attrs, "Name") || "").trim().toLowerCase();
            if (name === wanted) out.push(`<Routine ${attrs.trim()}>\n${String(m[2] || "").trim()}\n</Routine>`);
            m = re.exec(String(text || ""));
          }
          return out;
        };
        const findRoutineExportSourceByName = (routineName) => {
          const wanted = String(routineName || "").trim().toLowerCase();
          if (!wanted) return "";
          for (const src of allTemplateSources) {
            if (!/TargetType\s*=\s*"Routine"/i.test(src)) continue;
            const targetName = String((src.match(/TargetName\s*=\s*"([^"]+)"/i) || [])[1] || "")
              .trim()
              .toLowerCase();
            if (!targetName) continue;
            if (targetName === wanted) return src;
          }
          return "";
        };
        const getRoutineTemplateByName = (routineName) => {
          // For main-program routines, force source from the real main program first
          // so we don't accidentally copy same-named routines from other programs (ex: bins).
          const mainProgramRoutineNames = new Set(
            ["main", "alarmreset", "generalalarms", "scalecoms", "io_mapping", "ios_mapping", "io_mappingho", "io_mappingww", "hoscalecoms", "wwscalecoms"]
          );
          const wanted = String(routineName || "").trim().toLowerCase();
          // DB routine template is authoritative standard for these routines.
          // This prevents stale full-L5X template text from overriding cleaned routine templates.
          if (mainProgramRoutineNames.has(wanted)) {
            const persistedFirst = String(persistedRoutineTemplates?.[wanted] || "").trim();
            if (persistedFirst) return persistedFirst;
          }
          const directRoutineSource = findRoutineExportSourceByName(routineName);
          if (directRoutineSource) {
            const direct = getRoutineTemplateFromText(directRoutineSource, routineName);
            if (direct) return direct;
          }
          if (mainProgramRoutineNames.has(wanted)) {
            if (sourceIsMainRoutineExport && wanted === "main") {
              const mainOnly = getRoutineTemplateFromText(sourceText, "Main");
              if (mainOnly) return mainOnly;
            }
            for (const programName of preferredMainProgramNames) {
              const body = findProgramBodyByName(programName);
              if (!body) continue;
              const block = getRoutineTemplateFromText(body, routineName);
              if (block) return block;
            }
            if (wanted === "main") {
              // Fallback only: pick the best global Main by expected call signature.
              const candidates = getRoutineTemplatesByNameFromText(sourceText, "Main");
              const scored = candidates
                .map((block) => {
                  const text = String(block || "").toLowerCase();
                  let score = 0;
                  if (text.includes('use="target"')) score += 8;
                  if (text.includes("jsr(io_mapping,0)")) score += 6;
                  if (text.includes("jsr(scalecoms,0)")) score += 6;
                  if (text.includes("jsr(io_mapping")) score += 2;
                  if (text.includes("jsr(alarmreset")) score += 2;
                  if (text.includes("jsr(generalalarms")) score += 2;
                  if (text.includes("jsr(scalecoms")) score += 2;
                  if (text.includes("jsr(io_mappingww")) score -= 3;
                  if (text.includes("jsr(io_mappingho")) score -= 3;
                  if (text.includes("jsr(hoscalecoms")) score -= 3;
                  if (text.includes("jsr(wwscalecoms")) score -= 3;
                  return { block, score };
                })
                .sort((a, b) => b.score - a.score);
              if (scored.length && scored[0].score > 0) return scored[0].block;
            }
          }
          for (const src of allTemplateSources) {
            const found = getRoutineTemplateFromText(src, routineName);
            if (found) return found;
          }
          // DB template fallback when no routine can be found in template text.
          const persisted = String(persistedRoutineTemplates?.[wanted] || "").trim();
          if (persisted) return persisted;
          return "";
        };
        const makeEmptyRoutine = (name) =>
          [`          <Routine Name="${name}" Type="RLL">`, "            <RLLContent/>", "          </Routine>"].join("\n");
        const makeCanonicalAlarmResetRoutine = (name) =>
          [
            `          <Routine Name="${name}" Type="RLL">`,
            "            <RLLContent>",
            "              <Rung Number=\"0\" Type=\"N\">",
            "                <Comment><![CDATA[Alarm Horns",
            " ",
            "]]></Comment>",
            "                <Text><![CDATA[XIC(SiteAlarmHorn)XIC(AlarmHornEnable)NOP();]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"1\" Type=\"N\">",
            "                <Text><![CDATA[[XIC({SubRoute}.Gr.All.o_Fault) CTU(Alarm_Counters[0],?,?) ONS(AlarmHornsONS[0])]OTL(SiteAlarmHorn);]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"2\" Type=\"N\">",
            "                <Comment><![CDATA[HO",
            "Handle continuous alarms - Light on until monitoring alarm goes away (does not require ack)]]></Comment>",
            "                <Text><![CDATA[[XIC({Sender}.HMI_Read.AlmDosingMonitor)]OTE(SiteAlarmHornContinuous);]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"3\" Type=\"N\">",
            "                <Text><![CDATA[XIO(AlarmHornEnable)[XIC(SiteAlarmHorn) ,XIC(HazmonSiteAlarmHorn) ]OTU(SiteAlarmHorn)OTU(HazmonSiteAlarmHorn);]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"4\" Type=\"N\">",
            "                <Comment><![CDATA[Alarm Reset",
            " ]]></Comment>",
            "                <Text><![CDATA[NOP();]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"5\" Type=\"N\">",
            "                <Text><![CDATA[XIO(AlarmHornEnable)XIC(SiteAlarmHorn)OTL(HMI_AlarmHornReset);]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"6\" Type=\"N\">",
            "                <Comment><![CDATA[not sure where HMI_Alarm_HornReset comes from, but it is not set here to silence the horn > temporarily use SiteAlarmReset]]></Comment>",
            "                <Text><![CDATA[[[XIC(HMI_AlarmHornReset) ,XIC(HMI_SiteAlarmReset) ] ,XIC({Route}.HMI_Write.Cmd.CmdHornOff) ]OTL(AlarmHornReset)OTU(SiteAlarmHorn)OTU(HazmonSiteAlarmHorn)OTU(HMI_AlarmHornReset);]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"7\" Type=\"N\">",
            "                <Text><![CDATA[[XIC(HMI_SiteAlarmReset) ,XIC({Route}.HMI_Write.Cmd.CmdFaultReset) ]OTL(AlarmHornReset)OTL(SiteAlarmReset)OTU(HMI_SiteAlarmReset);]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"8\" Type=\"N\">",
            "                <Text><![CDATA[[XIC(SiteAlarmReset) ,XIC(AlarmHornReset) ]TON(SiteAlarmResetHold,?,?)XIC(SiteAlarmResetHold.DN)[XIC(AlarmHornReset) OTU(SiteAlarmHorn) OTU(HazmonSiteAlarmHorn) OTU(AlarmHornReset) ,XIC(SiteAlarmReset) OTU(SiteAlarmReset) ];]]></Text>",
            "              </Rung>",
            "              <Rung Number=\"9\" Type=\"N\">",
            "                <Text><![CDATA[XIC(HazmonSiteAlarmHorn)XIC(AlarmHornEnable)NOP();]]></Text>",
            "              </Rung>",
            "            </RLLContent>",
            "          </Routine>",
          ].join("\n");
        const makeExactMainProgramMainRoutine = () =>
          [
            '          <Routine Name="Main" Type="RLL">',
            "            <RLLContent>",
            '              <Rung Number="0" Type="N">',
            "                <Comment><![CDATA[PLC",
            "           IP Address xxx.xxx.xxx.xxx",
            "           Subnet Mask xxx.xxx.xxx.xxx",
            "           Default Gateway xxx.xxx.xxx.xxx]]></Comment>",
            "                <Text><![CDATA[NOP();]]></Text>",
            "              </Rung>",
            '              <Rung Number="1" Type="N">',
            "                <Text><![CDATA[XIC(S:FS)ONS(FirstScanCtl)RES(FirstScanTimer);]]></Text>",
            "              </Rung>",
            '              <Rung Number="2" Type="N">',
            "                <Text><![CDATA[GSV(Task,MainTask,LastScanTime,LastScanTime)[XIC(S:FS) ,XIC(FirstScanTimer.TT) ]TON(FirstScanTimer,?,?)OTE(FirstPass);]]></Text>",
            "              </Rung>",
            '              <Rung Number="3" Type="N">',
            "                <Text><![CDATA[AFI()OTL(Global_SimulationMode);]]></Text>",
            "              </Rung>",
            '              <Rung Number="4" Type="N">',
            "                <Text><![CDATA[XIC(Global_Pulse500ms)ONS(Global_Ons001)OTE(Global_Tick1sec);]]></Text>",
            "              </Rung>",
            '              <Rung Number="5" Type="N">',
            "                <Text><![CDATA[XIO(Global_SimulationMode)JSR(IO_Mapping,0);]]></Text>",
            "              </Rung>",
            '              <Rung Number="6" Type="N">',
            "                <Text><![CDATA[JSR(AlarmReset,0)JSR(GeneralAlarms,0);]]></Text>",
            "              </Rung>",
            '              <Rung Number="7" Type="N">',
            "                <Text><![CDATA[JSR(ScaleComs,0);]]></Text>",
            "              </Rung>",
            "            </RLLContent>",
            "          </Routine>",
          ].join("\n");
        const routeRootSet = (() => {
          const roots = new Set();
          const addRoot = (value) => {
            const token = String(value || "").trim();
            if (!token) return;
            const match = token.match(/^(Route[0-9]+)/i);
            if (!match) return;
            roots.add(String(match[1] || "").toLowerCase());
          };
          routeObjectNames.forEach((name) => addRoot(name));
          subRouteObjectNames.forEach((name) => addRoot(name));
          binControlObjectNames.forEach((name) => addRoot(name));
          binObjectNames.forEach((name) => addRoot(name));
          groups.forEach((g) => addRoot(String(g?.name || "")));
          return roots;
        })();
        const explicitDynamicRoots = Array.from(
          new Set([
            ...subRouteObjectNames,
            ...binControlObjectNames,
            ...binObjectNames,
          ]
            .map((name) => String(name || "").trim().toLowerCase())
            .filter(Boolean))
        );
        const dynamicObjectRoots = Array.from(new Set([...Array.from(routeRootSet), ...explicitDynamicRoots]));
        const ioNamesByRoute = (() => {
          const out = new Map();
          binControlObjectNames.forEach((fullName) => {
            const text = String(fullName || "").trim();
            if (!text) return;
            const m = text.match(/^(Route[0-9]+)_(.+)$/i);
            if (!m) return;
            const routeName = String(m[1] || "").trim();
            const ioName = String(m[2] || "").trim();
            if (!routeName || !ioName) return;
            if (!out.has(routeName.toLowerCase())) out.set(routeName.toLowerCase(), []);
            out.get(routeName.toLowerCase()).push(ioName);
          });
          return out;
        })();
        const matchesAllowedRoot = (value) => {
          const token = String(value || "").trim().toLowerCase();
          if (!token) return false;
          // Exact route root is allowed (ex: Route1).
          if (routeRootSet.has(token)) return true;
          // Route-prefixed generic tags are allowed only for known generic members.
          const routeRootMatch = token.match(/^(route[0-9]+)_(.+)$/i);
          if (routeRootMatch) {
            const root = String(routeRootMatch[1] || "").toLowerCase();
            const suffix = String(routeRootMatch[2] || "").toLowerCase();
            if (
              routeRootSet.has(root) &&
              (
                suffix === "data" ||
                suffix === "group_mgr" ||
                suffix === "tool" ||
                /^\d+(?:_.+)?$/i.test(suffix) ||
                /^(snd|send|rcv|rec|recv)\d*(?:_.+)?$/i.test(suffix)
              )
            ) {
              return true;
            }
          }
          // SubRoute / Sender / Receiver / Bin trees must explicitly exist in tree.
          return explicitDynamicRoots.some((root) => token === root || token.startsWith(`${root}_`));
        };
        const pruneRoutineByAllowedDynamicObjects = (routineXml) => {
          let out = String(routineXml || "");
          if (!out || !dynamicObjectRoots.length) return out;
          const extractRouteRefs = (text) =>
            Array.from(String(text || "").matchAll(/\bRoute[0-9]+(?:\[[^\]]+\])?(?:_[A-Za-z0-9]+)*\b/gi)).map((m) =>
              String(m[0] || "").trim()
            );
          out = out.replace(/<Text\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/gi, (full, cdata) => {
            const src = String(cdata || "");
            const parts = src.split(";");
            const expanded = [];
            parts.forEach((segment) => {
              const text = String(segment || "");
              const routeLikeRefs = extractRouteRefs(text);
              if (!routeLikeRefs.length) {
                expanded.push(text);
                return;
              }
              const templateRouteRoots = Array.from(
                new Set(
                  routeLikeRefs
                    .map((name) => {
                      const m = String(name || "").replace(/\[[^\]]+\]/g, "").match(/^(Route[0-9]+)/i);
                      return m ? String(m[1] || "") : "";
                    })
                    .filter(Boolean)
                )
              );
              // If the segment is based on a single template route root (ex: Route1_*),
              // clone it for every Route in tree and keep only valid object references.
              if (templateRouteRoots.length === 1 && routeObjectNames.length) {
                const root = templateRouteRoots[0];
                routeObjectNames.forEach((routeName) => {
                  const routeText = text.replace(new RegExp(`\\b${root}\\b`, "gi"), String(routeName || ""));
                  const nextRefs = extractRouteRefs(routeText);
                  if (nextRefs.length && nextRefs.every((name) => matchesAllowedRoot(name))) {
                    expanded.push(routeText);
                  }
                });
                return;
              }
              if (routeLikeRefs.every((name) => matchesAllowedRoot(name))) {
                expanded.push(text);
              }
            });
            const dedup = Array.from(new Set(expanded.map((s) => String(s || ""))));
            return `<Text><![CDATA[${dedup.join(";")}]]></Text>`;
          });
          // Final hard filter: drop any rung that still references route tokens not present in current tree.
          out = out.replace(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/gi, (rungBlock) => {
            const refs = extractRouteRefs(rungBlock);
            if (!refs.length) return rungBlock;
            return refs.every((name) => matchesAllowedRoot(name)) ? rungBlock : "";
          });
          out = out.replace(/\n{3,}/g, "\n\n");
          return out;
        };
        const normalizeAlarmResetContinuousMonitorRung = (routineXml) => {
          let out = String(routineXml || "");
          if (!out) return out;
          const ioRoots = Array.from(
            new Set(
              alarmResetIoObjectNames
                .map((name) => String(name || "").trim())
                .filter(Boolean)
            )
          );
          const fallbackRoots = Array.from(
            new Set(
              (alarmResetBinObjectNames.length ? alarmResetBinObjectNames : alarmResetSubRouteObjectNames)
                .map((name) => String(name || "").trim())
                .filter(Boolean)
            )
          );
          const secondFallbackRoots = Array.from(
            new Set(
              alarmResetSubRouteObjectNames
                .map((name) => String(name || "").trim())
                .filter(Boolean)
            )
          );
          const roots = ioRoots.length ? ioRoots : (fallbackRoots.length ? fallbackRoots : secondFallbackRoots);
          if (!roots.length) return out;
          const monitorTerms = roots.map((name) => `XIC(${name}.HMI_Read.AlmDosingMonitor)`);
          out = out.replace(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/gi, (rungBlock) => {
            if (!/AlmDosingMonitor/i.test(rungBlock) && !/SiteAlarmHornContinuous/i.test(rungBlock)) return rungBlock;
            const textMatch = rungBlock.match(/<Text><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/i);
            const rungText = String(textMatch?.[1] || "");
            if (!/OTE\(\s*SiteAlarmHornContinuous[A-Za-z0-9_]*\s*\)/i.test(rungText)) return rungBlock;
            const coilMatch = rungText.match(/OTE\(([^)]+)\)/i);
            const coil = String(coilMatch?.[1] || "SiteAlarmHornContinuous").trim() || "SiteAlarmHornContinuous";
            const rebuilt = `[${monitorTerms.join(" ,")} ]OTE(${coil});`;
            return rungBlock.replace(/<Text><!\[CDATA\[[\s\S]*?\]\]><\/Text>/i, `<Text><![CDATA[${rebuilt}]]></Text>`);
          });
          return out;
        };
        const normalizeAlarmResetFaultRung = (routineXml) => {
          let out = String(routineXml || "");
          if (!out) return out;
          const faultRoots = Array.from(
            new Set(
              (subRouteObjectNames.length ? subRouteObjectNames : routeObjectNames)
                .map((name) => String(name || "").trim())
                .filter(Boolean)
            )
          );
          if (!faultRoots.length) return out;
          const faultTerms = faultRoots.map(
            (name, idx) =>
              `XIC(${name}.Gr.All.o_Fault) CTU(Alarm_Counters[${idx}],?,?) ONS(AlarmHornsONS[${idx}])`
          );
          out = out.replace(/<Rung\b[^>]*>[\s\S]*?<\/Rung>/gi, (rungBlock) => {
            if (!/OTL\(\s*SiteAlarmHorn(?:Ho)?\s*\)/i.test(rungBlock)) return rungBlock;
            const textMatch = rungBlock.match(/<Text><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/i);
            const rungText = String(textMatch?.[1] || "");
            const rebuilt = `[${faultTerms.join(" ,")} ]OTL(SiteAlarmHorn);`;
            return rungBlock.replace(/<Text><!\[CDATA\[[\s\S]*?\]\]><\/Text>/i, `<Text><![CDATA[${rebuilt}]]></Text>`);
          });
          return out;
        };
        const rebuildAlarmResetRungsByNumber = (routineXml) => {
          let out = String(routineXml || "");
          if (!out) return out;
          const faultRoots = Array.from(
            new Set(
              (alarmResetSubRouteObjectNames.length ? alarmResetSubRouteObjectNames : routeObjectNames)
                .map((name) => String(name || "").trim())
                .filter(Boolean)
            )
          );
          const ioRoots = Array.from(
            new Set(
              binControlObjectNames
                .map((name) => String(name || "").trim())
                .filter(Boolean)
            )
          );
          const monitorRoots = ioRoots.length
            ? ioRoots
            : Array.from(
                new Set(
                  (binObjectNames.length ? binObjectNames : subRouteObjectNames)
                    .map((name) => String(name || "").trim())
                    .filter(Boolean)
                )
              );
          const faultTerms = faultRoots.map(
            (name, idx) =>
              `XIC(${name}.Gr.All.o_Fault) CTU(Alarm_Counters[${idx}],?,?) ONS(AlarmHornsONS[${idx}])`
          );
          const monitorTerms = monitorRoots.map((name) => `XIC(${name}.HMI_Read.AlmDosingMonitor)`);
          out = out.replace(/<Rung\b[^>]*Number="1"[^>]*>[\s\S]*?<\/Rung>/i, (rungBlock) => {
            if (!faultTerms.length) return rungBlock;
            const rebuilt = `[${faultTerms.join(" ,")} ]OTL(SiteAlarmHorn);`;
            if (/<Text><!\[CDATA\[[\s\S]*?\]\]><\/Text>/i.test(rungBlock)) {
              return rungBlock.replace(/<Text><!\[CDATA\[[\s\S]*?\]\]><\/Text>/i, `<Text><![CDATA[${rebuilt}]]></Text>`);
            }
            return rungBlock;
          });
          out = out.replace(/<Rung\b[^>]*Number="2"[^>]*>[\s\S]*?<\/Rung>/i, (rungBlock) => {
            if (!monitorTerms.length) return rungBlock;
            const textMatch = rungBlock.match(/<Text><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/i);
            const rungText = String(textMatch?.[1] || "");
            const coilMatch = rungText.match(/OTE\(([^)]+)\)/i);
            const coil = String(coilMatch?.[1] || "SiteAlarmHornContinuous").trim() || "SiteAlarmHornContinuous";
            const rebuilt = `[${monitorTerms.join(" ,")} ]OTE(${coil});`;
            if (/<Text><!\[CDATA\[[\s\S]*?\]\]><\/Text>/i.test(rungBlock)) {
              return rungBlock.replace(/<Text><!\[CDATA\[[\s\S]*?\]\]><\/Text>/i, `<Text><![CDATA[${rebuilt}]]></Text>`);
            }
            return rungBlock;
          });
          return out;
        };
        const expandAlarmResetPlaceholderTemplateFromTree = (routineXml) => {
          let out = String(routineXml || "");
          if (!out) return out;
          const routeName = String(routeObjectNames[0] || targetRouteName || "").trim();
          const subRoots = Array.from(
            new Set(
              (alarmResetSubRouteObjectNames.length ? alarmResetSubRouteObjectNames : routeObjectNames)
                .map((name) => String(name || "").trim())
                .filter(Boolean)
            )
          );
          const senderRoots = Array.from(
            new Set(
              (alarmResetIoObjectNames.length
                ? alarmResetIoObjectNames
                : (alarmResetBinObjectNames.length ? alarmResetBinObjectNames : alarmResetSubRouteObjectNames))
                .map((name) => String(name || "").trim())
                .filter(Boolean)
            )
          );
          const replaceTokenRaw = (src, token, value) => {
            const val = String(value || "").trim();
            if (!val) return src;
            return String(src || "")
              .replace(new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, "gi"), val)
              .replace(new RegExp(`\\{\\s*${token}\\s*\\}`, "gi"), val);
          };
          if (routeName) {
            out = replaceTokenRaw(out, "Route", routeName);
            out = replaceTokenRaw(out, "ROUTE", routeName);
          }
          out = out.replace(/<Rung\b[^>]*Number="1"[^>]*>[\s\S]*?<\/Rung>/i, (rungBlock) => {
            const textMatch = rungBlock.match(/<Text><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/i);
            const rungText = String(textMatch?.[1] || "");
            if (!/\{\s*SubRoute\s*\}|\{\{\s*SubRoute\s*\}\}/i.test(rungText)) return rungBlock;
            if (!subRoots.length) return rungBlock;
            const terms = subRoots.map(
              (name, idx) =>
                `XIC(${name}.Gr.All.o_Fault) CTU(Alarm_Counters[${idx}],?,?) ONS(AlarmHornsONS[${idx}])`
            );
            const rebuilt = `[${terms.join(" ,")} ]OTL(SiteAlarmHorn);`;
            return rungBlock.replace(/<Text><!\[CDATA\[[\s\S]*?\]\]><\/Text>/i, `<Text><![CDATA[${rebuilt}]]></Text>`);
          });
          out = out.replace(/<Rung\b[^>]*Number="2"[^>]*>[\s\S]*?<\/Rung>/i, (rungBlock) => {
            const textMatch = rungBlock.match(/<Text><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/i);
            const rungText = String(textMatch?.[1] || "");
            if (!/\{\s*Sender\s*\}|\{\{\s*Sender\s*\}\}/i.test(rungText)) {
              return rungBlock;
            }
            if (!senderRoots.length) return rungBlock;
            const coilMatch = rungText.match(/OTE\(([^)]+)\)/i);
            const coil = String(coilMatch?.[1] || "SiteAlarmHornContinuous").trim() || "SiteAlarmHornContinuous";
            const terms = senderRoots.map((name) => `XIC(${name}.HMI_Read.AlmDosingMonitor)`);
            const rebuilt = `[${terms.join(" ,")} ]OTE(${coil});`;
            return rungBlock.replace(/<Text><!\[CDATA\[[\s\S]*?\]\]><\/Text>/i, `<Text><![CDATA[${rebuilt}]]></Text>`);
          });
          return out;
        };
        const applyRoutineTemplatePlaceholders = (routineXml, targetRoutineName) => {
          let out = String(routineXml || "");
          if (!out) return out;
          const targetLower = String(targetRoutineName || "").trim().toLowerCase();
          const routeName = String(routeObjectNames[0] || targetRouteName || "").trim();
          const subRouteName = String(subRouteObjectNames[0] || "").trim();
          const senderReceiverName = String(binControlObjectNames[0] || subRouteName || "").trim();
          const binName = String(binObjectNames[0] || "").trim();
          const replaceToken = (src, token, value) => {
            const val = String(value || "").trim();
            if (!val) return src;
            return String(src || "")
              .replace(new RegExp(`\\{\\{\\s*${token}\\s*\\}\\}`, "gi"), val)
              .replace(new RegExp(`\\{\\s*${token}\\s*\\}`, "gi"), val);
          };
          out = replaceToken(out, "ROUTE", routeName);
          out = replaceToken(out, "SUBROUTE", subRouteName);
          out = replaceToken(out, "SENDER", senderReceiverName);
          out = replaceToken(out, "RECEIVER", senderReceiverName);
          out = replaceToken(out, "BIN", binName);
          if (targetLower === "alarmreset") {
            out = replaceToken(out, "SENDERRECEIVER", senderReceiverName);
          }
          return out;
        };
        const getRoutineTemplateByCandidates = (routineNames = []) => {
          const names = Array.isArray(routineNames) ? routineNames : [];
          for (const candidate of names) {
            const found = getRoutineTemplateByName(candidate);
            if (found) return { sourceName: String(candidate || ""), block: found };
          }
          return { sourceName: "", block: "" };
        };
        const materializeRoutine = (sourceRoutineName, targetRoutineName, sourceTagName, targetTagName) => {
          const targetLower = String(targetRoutineName || "").trim().toLowerCase();
          let out = "";
          if (targetLower === "alarmreset") {
            out = makeCanonicalAlarmResetRoutine(targetRoutineName);
          } else {
            const tmpl = getRoutineTemplateByName(sourceRoutineName);
            if (!tmpl) return makeEmptyRoutine(targetRoutineName);
            out = String(tmpl || "");
            out = out.replace(/<Routine\b([^>]*)>/i, `<Routine Name="${targetRoutineName}" Type="RLL">`);
          }
          if (sourceTagName && targetTagName && sourceTagName !== targetTagName) {
            out = out.split(sourceTagName).join(targetTagName);
            out = out.split(String(sourceTagName).toLowerCase()).join(String(targetTagName).toLowerCase());
          }
          out = applyRoutineTemplatePlaceholders(out, targetRoutineName);
          if (targetLower === "alarmreset") {
            const isPlaceholderTemplate = /\{\s*SubRoute\s*\}|\{\{\s*SubRoute\s*\}\}|\{\s*Sender\s*\}|\{\{\s*Sender\s*\}\}|\{\s*Route\s*\}|\{\{\s*Route\s*\}\}/i.test(out);
            if (isPlaceholderTemplate) {
              out = expandAlarmResetPlaceholderTemplateFromTree(out);
            } else {
              out = pruneRoutineByAllowedDynamicObjects(out);
              out = rebuildAlarmResetRungsByNumber(out);
              out = normalizeAlarmResetFaultRung(out);
              out = normalizeAlarmResetContinuousMonitorRung(out);
            }
          } else if (targetLower === "generalalarms") {
            out = pruneRoutineByAllowedDynamicObjects(out);
          }
          return indentBlock(out, "          ");
        };
        const generatedRoutineBlocks = [];
        const seenRoutineNames = new Set();
        routeExec.forEach((row) => {
          if (row.kind === "route-control") {
            const name = `${row.routeName}_0_Control`;
            if (!seenRoutineNames.has(name.toLowerCase())) {
              seenRoutineNames.add(name.toLowerCase());
              generatedRoutineBlocks.push(
                materializeRoutine(
                  String(row.sourceTemplate || "Route1_0_Control"),
                  name,
                  "Route1",
                  row.routeName
                )
              );
            }
            return;
          }
          const controlName = `${row.routeName}_Control`;
          const statusName = `${row.routeName}_Status`;
          if (!seenRoutineNames.has(controlName.toLowerCase())) {
            seenRoutineNames.add(controlName.toLowerCase());
            generatedRoutineBlocks.push(
              materializeRoutine(
                String(row.controlSourceTemplate || "Route1_1_Control"),
                controlName,
                "Route1_1",
                row.routeName
              )
            );
          }
          if (!seenRoutineNames.has(statusName.toLowerCase())) {
            seenRoutineNames.add(statusName.toLowerCase());
            generatedRoutineBlocks.push(
              materializeRoutine(
                String(row.statusSourceTemplate || "Route1_1_Status"),
                statusName,
                "Route1_1",
                row.routeName
              )
            );
          }
        });
        const legacyRoutineSpecs = [
          { targetName: "Main", sourceCandidates: ["Main"] },
          { targetName: "AlarmReset", sourceCandidates: ["AlarmReset"] },
          { targetName: "GeneralAlarms", sourceCandidates: ["GeneralAlarms"] },
          { targetName: "ScaleComs", sourceCandidates: ["ScaleComs", "HOScaleComs", "WWScaleComs"] },
          { targetName: "IO_Mapping", sourceCandidates: ["IO_Mapping", "IO_MappingHO", "IO_MappingWW"] },
        ];
        const legacyRoutineBlocks = [];
        const legacySeen = new Set();
        legacyRoutineSpecs.forEach((spec) => {
          const targetName = String(spec?.targetName || "").trim();
          if (!targetName) return;
          const key = targetName.toLowerCase();
          if (legacySeen.has(key)) return;
          legacySeen.add(key);
          if (key === "main") {
            legacyRoutineBlocks.push(makeExactMainProgramMainRoutine());
            return;
          }
          if (key === "io_mapping" || key === "scalecoms") {
            legacyRoutineBlocks.push(makeEmptyRoutine(targetName));
            return;
          }
          const match = getRoutineTemplateByCandidates(spec?.sourceCandidates);
          if (match?.sourceName) {
            legacyRoutineBlocks.push(materializeRoutine(match.sourceName, targetName));
            return;
          }
          legacyRoutineBlocks.push(makeEmptyRoutine(targetName));
        });
        const allRoutineBlocksForStubScan = [
          ...generatedRoutineBlocks.map((x) => String(x || "")),
          ...legacyRoutineBlocks.map((x) => String(x || "")),
        ];
        const autoTagStubs = collectAutoTagStubsFromRoutineXml(allRoutineBlocksForStubScan);
        const generalAlarmTagStubs = collectGeneralAlarmTagStubsFromRoutineXml(allRoutineBlocksForStubScan);
        const programsXml = [
          "    <Programs>",
          `      <Program Name="${PROGRAM_NAME}" TestEdits="false" Disabled="false" MainRoutineName="${MAIN_ROUTINE_NAME}">`,
          "        <Tags/>",
          "        <Routines>",
          `          <Routine Name="${MAIN_ROUTINE_NAME}" Type="RLL">`,
          rllContent,
          "          </Routine>",
          ...generatedRoutineBlocks,
          "        </Routines>",
          "      </Program>",
          `      <Program Name="${LEGACY_PROGRAM_NAME}" TestEdits="false" Disabled="false" MainRoutineName="${LEGACY_MAIN_ROUTINE_NAME}">`,
          "        <Tags/>",
          "        <Routines>",
          ...legacyRoutineBlocks,
          "        </Routines>",
          "      </Program>",
          "    </Programs>",
        ].join("\n");
        return { programsXml, autoTagStubs, generalAlarmTagStubs };
      };
        const {
          programsXml,
          autoTagStubs: autoProgramTagStubs,
          generalAlarmTagStubs: autoGeneralAlarmTagStubs,
        } = buildMainRoutineProgramsXml();
      const autoStubAllowRoots = Array.from(
        new Set(
          [
            ...routeObjectNames,
            ...subRouteObjectNames,
            ...binControlObjectNames,
            ...binObjectNames,
          ]
            .map((v) => String(v || "").trim().toLowerCase())
            .filter(Boolean)
        )
      );
      const autoStubAlwaysAllowed = new Set(
        [
          "alarm_counters",
          "alarmhornsons",
          "alarmhornenable",
          "alarmhornreset",
          "alarmpowerfail",
          "alarmupsfail",
          "equipstopalarms",
          "site_powerok",
          "ups_powerok",
          "sitealarmreset",
          "alarmpowerfail_i_debouncetime",
          "alarmupsfail_i_debouncetime",
          "sitealarmhorn",
          "sitealarmhorncontinuous",
          "hazmonsitealarmhorn",
          "hmi_alarmhornreset",
          "hmi_sitealarmreset",
          "sitealarmresethold",
          "firstscanctl",
          "firstscantimer",
          "lastscantime",
          "firstpass",
          "global_simulationmode",
          "global_pulse500ms",
          "global_ons001",
          "global_tick1sec",
          "route_array",
          "route_group",
        ].map((v) => String(v || "").trim().toLowerCase())
      );
      const isAllowedAutoStubName = (nameRaw) => {
        const name = String(nameRaw || "").trim();
        if (!name) return false;
        if (/\{|\}/.test(name)) return false;
        if (isProjectSpecificTagName(name)) return false;
        const lower = name.toLowerCase();
        if (autoStubAlwaysAllowed.has(lower)) return true;
        if (/^route(?:_|$)/i.test(name)) return true;
        return autoStubAllowRoots.some((root) => lower === root || lower.startsWith(`${root}_`));
      };
      const selectedRouteNumbersRaw = routeObjectNames
        .map((name) => {
          const m = String(name || "").match(/route\s*([0-9]+)/i);
          return m ? String(m[1] || "").trim() : "";
        })
        .filter(Boolean);
      const selectedRouteNumbers = selectedRouteNumbersRaw.length ? selectedRouteNumbersRaw : ["1"];
      const savedTemplateText = String(codeGenRouteTemplateText || "");
      const uploadedRawText = String(selected?.rawText || "");
      const templateRawText = /<RSLogix5000Content\b/i.test(uploadedRawText)
        ? uploadedRawText
        : /<RSLogix5000Content\b/i.test(savedTemplateText)
        ? savedTemplateText
        : String(globalCodeGenBaseText || "");
      const mergedGeneralAlarmTagStubs = (() => {
        const byName = new Map();
        const pushRows = (rows) => {
          (Array.isArray(rows) ? rows : []).forEach((row) => {
            const name = String(row?.name || "").trim();
            const key = name.toLowerCase();
            if (!key) return;
            byName.set(key, {
              name,
              dataType: String(row?.dataType || "DINT"),
              block: String(row?.block || ""),
            });
          });
        };
        pushRows(autoGeneralAlarmTagStubs);
        pushRows(collectGeneralAlarmTagStubsFromRawText(templateRawText));
        return Array.from(byName.values());
      })();
      const fullTemplateSource = /<RSLogix5000Content\b/i.test(templateRawText) ? templateRawText : "";
      if (hasRouteObject && /<RSLogix5000Content\b/i.test(fullTemplateSource)) {
        const REQUIRED_ROUTE_GENERIC_TYPES = [
          "Route_Array",
          "Route_Cmd",
          "Route_Group",
          "Route_GroupControl",
          "Route_HMI_Read",
          "Route_HMI_Write",
          "Route_Job_State",
          "Route_Route_State",
          "Route_Status",
        ];
        const makeGenericRouteTypeBlock = (typeName) =>
          [
            `<DataType Name="${typeName}" Family="NoFamily" Class="User">`,
            "  <Members>",
            '    <Member Name="Reserved" DataType="DINT"/>',
            "  </Members>",
            "</DataType>",
          ].join("\n");
        let templated = fullTemplateSource;
        const sourceRouteId = String(codeGenTemplateRouteIdDraft || "").trim();
        templated = pruneTemplateToSelectedRoutes(templated, ["1"]);
        if (sourceRouteName && targetRouteName && sourceRouteName !== targetRouteName) {
          templated = templated.split(sourceRouteName).join(targetRouteName);
        }
        templated = templated.split("Route1").join(targetRouteName || sourceRouteName);
        templated = templated.split("route1").join(String(targetRouteName || sourceRouteName).toLowerCase());
        templated = templated.split("{{ROUTE_NAME}}").join(targetRouteName || sourceRouteName);
        templated = templated.split("{{ROUTE_ID}}").join(sourceRouteId);
        templated = templated.split("{Route}").join(targetRouteName || sourceRouteName);
        templated = templated.split("{{ROUTE}}").join(targetRouteName || sourceRouteName);
        templated = pruneTemplateToSelectedRoutes(templated, selectedRouteNumbers);
        templated = pruneBinArtifactsFromTemplate(templated);
        // Keep only Route template datatypes (Route1-based) + required AOI code.
        let scopedRouteTypes = buildRouteTemplateDataTypeBlocks(templated, routeObjectNames).map((b) =>
          filterRouteMembersToRouteLike(b)
        );
        const sourceGenericByName = new Map(
          extractNamedRouteDataTypeBlocks(String(templateRawText || ""))
            .filter((row) => /^route_/i.test(String(row?.name || "")))
            .map((row) => [String(row?.name || "").trim().toLowerCase(), String(row?.block || "")])
        );
        const scopedNameSet = new Set(
          scopedRouteTypes
            .map((block) => {
              const head = String(block || "").match(/<DataType\b([^>]*)>/i);
              return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
            })
            .filter(Boolean)
        );
        REQUIRED_ROUTE_GENERIC_TYPES.forEach((typeName) => {
          const key = String(typeName || "").trim().toLowerCase();
          if (!key || scopedNameSet.has(key)) return;
          const fromSource = String(sourceGenericByName.get(key) || "").trim();
          scopedRouteTypes.push(fromSource || makeGenericRouteTypeBlock(typeName));
          scopedNameSet.add(key);
        });
        if (binControlObjectNames.length) {
          const binControlBlocks = buildBinControlTemplateDataTypeBlocks(
            String(templateRawText || ""),
            binControlObjectNames
          );
          const nameSet = new Set(
            scopedRouteTypes
              .map((block) => {
                const head = String(block || "").match(/<DataType\b([^>]*)>/i);
                return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
              })
              .filter(Boolean)
          );
          binControlBlocks.forEach((block) => {
            const head = String(block || "").match(/<DataType\b([^>]*)>/i);
            const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            const key = name.toLowerCase();
            if (!key || nameSet.has(key)) return;
            nameSet.add(key);
            scopedRouteTypes.push(block);
          });
        }
        const batchControlBlocks = buildBatchControlTemplateDataTypeBlocks(String(templateRawText || ""));
        if (batchControlBlocks.length) {
          const nameSet = new Set(
            scopedRouteTypes
              .map((block) => {
                const head = String(block || "").match(/<DataType\b([^>]*)>/i);
                return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
              })
              .filter(Boolean)
          );
          batchControlBlocks.forEach((block) => {
            const head = String(block || "").match(/<DataType\b([^>]*)>/i);
            const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            const key = name.toLowerCase();
            if (!key || nameSet.has(key)) return;
            nameSet.add(key);
            scopedRouteTypes.push(block);
          });
        }
        const routeTagBlocks = buildRouteTemplateTagBlocks(String(templateRawText || ""), routeObjectNames);
        const binControlTagBlocks = buildBinControlTemplateTagBlocks(
          String(templateRawText || ""),
          binControlObjectNames
        );
        const subRouteTagBlocks = buildSubRouteObjectTagBlocks(subRouteObjectNames);
        const mergedTagBlocks = [...routeTagBlocks, ...binControlTagBlocks, ...subRouteTagBlocks];
        const tagDedup = new Map();
        mergedTagBlocks.forEach((block) => {
          const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
          const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
          const key = name.toLowerCase();
          if (!key) return;
          tagDedup.set(key, String(block || ""));
        });
        const filteredTagBlocks = filterTagBlocksByObjectNames(Array.from(tagDedup.values()), {
          routeNames: routeObjectNames,
          ioNames: binControlObjectNames,
          binNames: binObjectNames,
        });
        const explicitBinTagBlocks = buildExplicitBinObjectTagBlocks(binObjectNames);
        explicitBinTagBlocks.forEach((block) => {
          const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
          const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
          const key = name.toLowerCase();
          if (!key) return;
          tagDedup.set(key, block);
        });
        const filteredWithExplicitBins = filterTagBlocksByObjectNames(Array.from(tagDedup.values()), {
          routeNames: routeObjectNames,
          subRouteNames: subRouteObjectNames,
          ioNames: binControlObjectNames,
          binNames: binObjectNames,
        });
        const tagBlocksWithAutoStubs = (() => {
          const byName = new Map();
          filteredWithExplicitBins.forEach((block) => {
            const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
            const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            const key = name.toLowerCase();
            if (!key) return;
            byName.set(key, normalizeSpecialCodeGenTagBlock(name, String(block || "")));
          });
          (Array.isArray(autoProgramTagStubs) ? autoProgramTagStubs : []).forEach((row) => {
            const block = String(row?.block || "");
            const name = String(row?.name || "").trim();
            if (!isAllowedAutoStubName(name)) return;
            const key = name.toLowerCase();
            if (!key || byName.has(key)) return;
            byName.set(key, normalizeSpecialCodeGenTagBlock(name, block, row?.dataType));
          });
          (Array.isArray(mergedGeneralAlarmTagStubs) ? mergedGeneralAlarmTagStubs : []).forEach((row) => {
            const block = String(row?.block || "");
            const name = String(row?.name || "").trim();
            const key = name.toLowerCase();
            if (!key) return;
            byName.set(key, normalizeSpecialCodeGenTagBlock(name, block, row?.dataType));
          });
          const knownTypeNames = [
            ...extractAllDataTypeNames(String(templateRawText || "")),
            ...scopedRouteTypes
              .map((block) => {
                const head = String(block || "").match(/<DataType\b([^>]*)>/i);
                return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
              })
              .filter(Boolean),
            ...extractAllAoiXmlBlocks(String(templateRawText || ""))
              .map((block) => {
                const head = String(block || "").match(/<AddOnInstructionDefinition\b([^>]*)>/i);
                return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
              })
              .filter(Boolean),
          ];
          buildFallbackObjectTagBlocks({
            routeNames: routeObjectNames,
            subRouteNames: subRouteObjectNames,
            ioNames: binControlObjectNames,
            binNames: binObjectNames,
            knownTypeNames,
          }).forEach((block) => {
            const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
            const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            const key = name.toLowerCase();
            if (!key || byName.has(key)) return;
            byName.set(key, normalizeSpecialCodeGenTagBlock(name, block));
          });
          return Array.from(byName.values());
        })();
        const requiredTypeNamesFromTags = extractTagDataTypeNames(tagBlocksWithAutoStubs);
        const requiredTypeBlocks = buildDataTypeClosureByNames(String(templateRawText || ""), requiredTypeNamesFromTags);
        if (requiredTypeBlocks.length) {
          const nameSet = new Set(
            scopedRouteTypes
              .map((block) => {
                const head = String(block || "").match(/<DataType\b([^>]*)>/i);
                return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
              })
              .filter(Boolean)
          );
          requiredTypeBlocks.forEach((block) => {
            const head = String(block || "").match(/<DataType\b([^>]*)>/i);
            const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            const key = name.toLowerCase();
            if (!key || nameSet.has(key)) return;
            nameSet.add(key);
            scopedRouteTypes.push(block);
          });
        }
        const allAoiBlocks = extractAllAoiXmlBlocks(String(templateRawText || ""));
        const allAoiNames = allAoiBlocks
          .map((block) => {
            const head = String(block || "").match(/<AddOnInstructionDefinition\b([^>]*)>/i);
            return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
          })
          .filter(Boolean);
        const aoiRequiredTypeNames = extractCustomDataTypeRefsFromBlocks(allAoiBlocks, allAoiNames);
        const aoiRequiredTypeBlocks = buildDataTypeClosureByNames(String(templateRawText || ""), aoiRequiredTypeNames);
        if (aoiRequiredTypeBlocks.length) {
          const nameSet = new Set(
            scopedRouteTypes
              .map((block) => {
                const head = String(block || "").match(/<DataType\b([^>]*)>/i);
                return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
              })
              .filter(Boolean)
          );
          aoiRequiredTypeBlocks.forEach((block) => {
            const head = String(block || "").match(/<DataType\b([^>]*)>/i);
            const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            const key = name.toLowerCase();
            if (!key || nameSet.has(key)) return;
            nameSet.add(key);
            scopedRouteTypes.push(block);
          });
        }
        const dataTypesXml = scopedRouteTypes.map((b) => indentBlock(b, "      ")).join("\n");
        const requiredAoiBlocks = buildImportSafeAoiXmlBlocks(String(templateRawText || ""), scopedRouteTypes);
        const aoiXml = requiredAoiBlocks.map((b) => indentBlock(b, "      ")).join("\n");
        const tagsXml = tagBlocksWithAutoStubs.map((b) => indentBlock(b, "      ")).join("\n");
        templated = templated
          .replace(/<DataTypes\b[^>]*>[\s\S]*?<\/DataTypes>/gi, dataTypesXml ? `    <DataTypes>\n${dataTypesXml}\n    </DataTypes>` : "    <DataTypes/>")
          .replace(/<DataTypes\s*\/>/gi, dataTypesXml ? `    <DataTypes>\n${dataTypesXml}\n    </DataTypes>` : "    <DataTypes/>")
          .replace(/<Modules\b[^>]*>[\s\S]*?<\/Modules>/gi, "    <Modules/>")
          .replace(/<Modules\s*\/>/gi, "    <Modules/>")
          .replace(/<Module\b[^>]*>[\s\S]*?<\/Module>/gi, "")
          .replace(/<Module\b[^>]*\/>/gi, "")
          .replace(
            /<AddOnInstructionDefinitions\b[^>]*>[\s\S]*?<\/AddOnInstructionDefinitions>/gi,
            aoiXml ? `    <AddOnInstructionDefinitions>\n${aoiXml}\n    </AddOnInstructionDefinitions>` : "    <AddOnInstructionDefinitions/>"
          )
          .replace(
            /<AddOnInstructionDefinitions\s*\/>/gi,
            aoiXml ? `    <AddOnInstructionDefinitions>\n${aoiXml}\n    </AddOnInstructionDefinitions>` : "    <AddOnInstructionDefinitions/>"
          )
          .replace(/<Tags\b[^>]*>[\s\S]*?<\/Tags>/gi, tagsXml ? `    <Tags>\n${tagsXml}\n    </Tags>` : "    <Tags/>")
          .replace(/<Tags\s*\/>/gi, tagsXml ? `    <Tags>\n${tagsXml}\n    </Tags>` : "    <Tags/>")
          .replace(/<Data\b[^>]*>[\s\S]*?<\/Data>/gi, "")
          .replace(/<Data\b[^>]*\/>/gi, "")
          .replace(/<Programs\b[^>]*>[\s\S]*?<\/Programs>/gi, programsXml)
          .replace(/<Programs\s*\/>/gi, programsXml)
          .replace(
            /<Tasks\b[^>]*>[\s\S]*?<\/Tasks>/gi,
            [
              "    <Tasks>",
              "      <Task Name=\"MainTask\" Type=\"CONTINUOUS\" Priority=\"10\" Watchdog=\"500\" DisableUpdateOutputs=\"false\" InhibitTask=\"false\">",
              "        <ScheduledPrograms>",
              "          <ScheduledProgram Name=\"MainProgram\"/>",
              "          <ScheduledProgram Name=\"Routing\"/>",
              "        </ScheduledPrograms>",
              "      </Task>",
              "    </Tasks>",
            ].join("\n")
          )
          .replace(
            /<Tasks\s*\/>/gi,
            [
              "    <Tasks>",
              "      <Task Name=\"MainTask\" Type=\"CONTINUOUS\" Priority=\"10\" Watchdog=\"500\" DisableUpdateOutputs=\"false\" InhibitTask=\"false\">",
              "        <ScheduledPrograms>",
              "          <ScheduledProgram Name=\"MainProgram\"/>",
              "          <ScheduledProgram Name=\"Routing\"/>",
              "        </ScheduledPrograms>",
              "      </Task>",
              "    </Tasks>",
            ].join("\n")
          );
        return sanitizeGeneratedL5xForImport(ensureGeneralAlarmTagsInL5x(templated));
      }
      const routeDataTypeBlocks = !hasRouteObject
        ? []
        : buildRouteTemplateDataTypeBlocks(String(templateRawText || ""), routeObjectNames).map((b) =>
            filterRouteMembersToRouteLike(b)
          );
      const senderDataTypeBlocks = binControlObjectNames.length
        ? buildBinControlTemplateDataTypeBlocks(String(templateRawText || ""), binControlObjectNames)
        : [];
      const batchControlDataTypeBlocks = buildBatchControlTemplateDataTypeBlocks(String(templateRawText || ""));
      const routeTagBlocks = hasRouteObject
        ? buildRouteTemplateTagBlocks(String(templateRawText || ""), routeObjectNames)
        : [];
      const binControlTagBlocks = binControlObjectNames.length
        ? buildBinControlTemplateTagBlocks(String(templateRawText || ""), binControlObjectNames)
        : [];
      const finalTagBlocks = (() => {
        const dedup = new Map();
        [...routeTagBlocks, ...binControlTagBlocks].forEach((block) => {
          const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
          const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
          const key = name.toLowerCase();
          if (!key) return;
          dedup.set(key, String(block || ""));
        });
        buildExplicitBinObjectTagBlocks(binObjectNames).forEach((block) => {
          const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
          const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
          const key = name.toLowerCase();
          if (!key) return;
          dedup.set(key, String(block || ""));
        });
        return filterTagBlocksByObjectNames(Array.from(dedup.values()), {
          routeNames: routeObjectNames,
          subRouteNames: subRouteObjectNames,
          ioNames: binControlObjectNames,
          binNames: binObjectNames,
        });
      })();
      const finalTagBlocksWithAutoStubs = (() => {
        const byName = new Map();
        finalTagBlocks.forEach((block) => {
          const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
          const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
          const key = name.toLowerCase();
          if (!key) return;
          byName.set(key, normalizeSpecialCodeGenTagBlock(name, String(block || "")));
        });
        (Array.isArray(autoProgramTagStubs) ? autoProgramTagStubs : []).forEach((row) => {
          const block = String(row?.block || "");
          const name = String(row?.name || "").trim();
          if (!isAllowedAutoStubName(name)) return;
          const key = name.toLowerCase();
          if (!key || byName.has(key)) return;
          byName.set(key, normalizeSpecialCodeGenTagBlock(name, block, row?.dataType));
        });
        (Array.isArray(mergedGeneralAlarmTagStubs) ? mergedGeneralAlarmTagStubs : []).forEach((row) => {
          const block = String(row?.block || "");
          const name = String(row?.name || "").trim();
          const key = name.toLowerCase();
          if (!key) return;
          byName.set(key, normalizeSpecialCodeGenTagBlock(name, block, row?.dataType));
        });
        const knownTypeNames = [
          ...extractAllDataTypeNames(String(templateRawText || "")),
          ...extractAllAoiXmlBlocks(String(templateRawText || ""))
            .map((block) => {
              const head = String(block || "").match(/<AddOnInstructionDefinition\b([^>]*)>/i);
              return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
            })
            .filter(Boolean),
        ];
        buildFallbackObjectTagBlocks({
          routeNames: routeObjectNames,
          subRouteNames: subRouteObjectNames,
          ioNames: binControlObjectNames,
          binNames: binObjectNames,
          knownTypeNames,
        }).forEach((block) => {
          const head = String(block || "").match(/<Tag\b([^>]*)\/?>/i);
          const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
          const key = name.toLowerCase();
          if (!key || byName.has(key)) return;
          byName.set(key, normalizeSpecialCodeGenTagBlock(name, block));
        });
        return Array.from(byName.values());
      })();
      const dataTypeDedup = new Map();
      [...routeDataTypeBlocks, ...senderDataTypeBlocks, ...batchControlDataTypeBlocks].forEach((block) => {
        const head = String(block || "").match(/<DataType\b([^>]*)>/i);
        const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
        const key = name.toLowerCase();
        if (!key) return;
        dataTypeDedup.set(key, block);
      });
      const requiredTypeNamesFromTags = extractTagDataTypeNames(finalTagBlocksWithAutoStubs);
      const requiredTypeBlocks = buildDataTypeClosureByNames(String(templateRawText || ""), requiredTypeNamesFromTags);
      requiredTypeBlocks.forEach((block) => {
        const head = String(block || "").match(/<DataType\b([^>]*)>/i);
        const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
        const key = name.toLowerCase();
        if (!key || dataTypeDedup.has(key)) return;
        dataTypeDedup.set(key, block);
      });
      const allAoiBlocks = extractAllAoiXmlBlocks(String(templateRawText || ""));
      const allAoiNames = allAoiBlocks
        .map((block) => {
          const head = String(block || "").match(/<AddOnInstructionDefinition\b([^>]*)>/i);
          return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
        })
        .filter(Boolean);
      const aoiRequiredTypeNames = extractCustomDataTypeRefsFromBlocks(allAoiBlocks, allAoiNames);
      const aoiRequiredTypeBlocks = buildDataTypeClosureByNames(String(templateRawText || ""), aoiRequiredTypeNames);
      aoiRequiredTypeBlocks.forEach((block) => {
        const head = String(block || "").match(/<DataType\b([^>]*)>/i);
        const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
        const key = name.toLowerCase();
        if (!key || dataTypeDedup.has(key)) return;
        dataTypeDedup.set(key, block);
      });
      const requiredAoiBlocks = buildImportSafeAoiXmlBlocks(
        String(templateRawText || ""),
        Array.from(dataTypeDedup.values())
      );
      const aoiBlocksIndented = requiredAoiBlocks.map((block) => indentBlock(block, "      "));
      const routeDataTypeBlocksIndented = Array.from(dataTypeDedup.values()).map((block) => indentBlock(block, "      "));
      const objectRows = groups
        .map((group) => {
          const name = String(group?.name || "").trim();
          if (!name) return "";
          const id = String(group?.id || "").trim();
          const path = resolveGroupPath(id);
          const type = normalizeCodeGenGroupType(group?.groupType);
          return `    <!-- ${escapeXml(type)}: ${escapeXml(path || name)} -->`;
        })
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join("\n");
      return sanitizeGeneratedL5xForImport(ensureGeneralAlarmTagsInL5x([
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        `<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00" TargetName="${escapeXml(controllerName)}" TargetType="Controller" ContainsContext="true" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">`,
        `  <Controller Name="${escapeXml(controllerName)}" ProcessorType="1756-L8x" MajorRev="35" MinorRev="11" TimeSlice="20" ShareUnusedTimeSlice="1">`,
        objectRows ? "    <!-- Objects built in Code Gen Pro -->" : "",
        objectRows,
        "    <RedundancyInfo Enabled=\"false\"/>",
        "    <Security Code=\"0\"/>",
        routeDataTypeBlocksIndented.length ? "    <DataTypes>" : "    <DataTypes/>",
        routeDataTypeBlocksIndented.join("\n"),
        routeDataTypeBlocksIndented.length ? "    </DataTypes>" : "",
        "    <Modules/>",
        aoiBlocksIndented.length ? "    <AddOnInstructionDefinitions>" : "    <AddOnInstructionDefinitions/>",
        aoiBlocksIndented.join("\n"),
        aoiBlocksIndented.length ? "    </AddOnInstructionDefinitions>" : "",
        finalTagBlocksWithAutoStubs.length ? "    <Tags>" : "    <Tags/>",
        finalTagBlocksWithAutoStubs.map((b) => indentBlock(b, "      ")).join("\n"),
        finalTagBlocksWithAutoStubs.length ? "    </Tags>" : "",
        programsXml,
        "    <Tasks>",
        "      <Task Name=\"MainTask\" Type=\"CONTINUOUS\" Priority=\"10\" Watchdog=\"500\" DisableUpdateOutputs=\"false\" InhibitTask=\"false\">",
        "        <ScheduledPrograms>",
        "          <ScheduledProgram Name=\"MainProgram\"/>",
        "          <ScheduledProgram Name=\"Routing\"/>",
        "        </ScheduledPrograms>",
        "      </Task>",
        "    </Tasks>",
        "  </Controller>",
        "</RSLogix5000Content>",
      ]
        .filter((line) => line !== "")
        .join("\n")));
    }

    if (codeGenFormat === "io-map") {
      const rows = ["Tag,EquipmentType,Group"];
      tags.forEach((tag) => {
        const equipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").trim();
        rows.push(`${tag},${equipmentType},${tagGroup.get(tag) || ""}`);
      });
      return rows.join("\n");
    }
    const rows = ["Tag,EquipmentType"];
    tags.forEach((tag) => {
      const equipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").trim();
      rows.push(`${tag},${equipmentType}`);
    });
    return rows.join("\n");
  }, [
    activeTab,
    codeGenReady,
    chatKey,
    codeGenFormat,
    codeGenGroupsByPlc,
    codeGenRoutineTemplates,
    codeGenRouteTemplateText,
    codeGenTagMeta,
    codeGenTemplateRouteIdDraft,
    codeGenTemplateRouteName,
    codeGenUserTags,
    globalCodeGenBaseText,
    selected?.rawText,
    selected?.name,
  ]);
  const codeGenGroups = useMemo(
    () => (Array.isArray(codeGenGroupsByPlc?.[chatKey]) ? codeGenGroupsByPlc[chatKey] : []),
    [chatKey, codeGenGroupsByPlc]
  );
  const codeGenExpandedTags = useMemo(
    () => new Set(Array.isArray(codeGenExpandedTagsByPlc?.[chatKey]) ? codeGenExpandedTagsByPlc[chatKey] : []),
    [chatKey, codeGenExpandedTagsByPlc]
  );
  const codeGenSelectedTag = useMemo(
    () => String(codeGenSelectedTagByPlc?.[chatKey] || "").trim(),
    [chatKey, codeGenSelectedTagByPlc]
  );
  const codeGenTagSortBy = useMemo(
    () => (String(codeGenTagSortByByPlc?.[chatKey] || "name").trim().toLowerCase() === "equipment" ? "equipment" : "name"),
    [chatKey, codeGenTagSortByByPlc]
  );
  const codeGenTagSortDir = useMemo(
    () => (String(codeGenTagSortDirByPlc?.[chatKey] || "asc").trim().toLowerCase() === "desc" ? "desc" : "asc"),
    [chatKey, codeGenTagSortDirByPlc]
  );
  const codeGenDetailEditMode = useMemo(() => codeGenDetailEditByPlc?.[chatKey] === true, [chatKey, codeGenDetailEditByPlc]);
  const codeGenTagDetailEditMode = useMemo(() => {
    const selectedTag = String(codeGenSelectedTagByPlc?.[chatKey] || "").trim();
    if (!selectedTag) return false;
    const byPlc = codeGenTagEditByPlc?.[chatKey] && typeof codeGenTagEditByPlc[chatKey] === "object" ? codeGenTagEditByPlc[chatKey] : {};
    return byPlc?.[selectedTag] === true;
  }, [chatKey, codeGenSelectedTagByPlc, codeGenTagEditByPlc]);
  const codeGenTreeLoading = useMemo(() => {
    const key = String(chatKey || "").trim();
    if (!key) return false;
    return codeGenPersistReadyByPlc?.[key] !== true;
  }, [chatKey, codeGenPersistReadyByPlc]);
  const codeGenExpandedSet = useMemo(
    () => new Set(Array.isArray(codeGenExpandedGroupsByPlc?.[chatKey]) ? codeGenExpandedGroupsByPlc[chatKey] : []),
    [chatKey, codeGenExpandedGroupsByPlc]
  );
  const codeGenPanelRatios = useMemo(() => {
    const raw = Array.isArray(codeGenPanelRatiosByPlc?.[chatKey]) ? codeGenPanelRatiosByPlc[chatKey] : [];
    const values = raw.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
    if (values.length !== 3) return [0.34, 0.33, 0.33];
    const sum = values[0] + values[1] + values[2];
    if (!(sum > 0)) return [0.34, 0.33, 0.33];
    return values.map((v) => v / sum);
  }, [chatKey, codeGenPanelRatiosByPlc]);
  const beginCodeGenPanelResize = (dividerIndex, event) => {
    const idx = Number(dividerIndex);
    if (!(idx === 0 || idx === 1)) return;
    const host = codeGenPanelsHostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    setCodeGenPanelResize({
      dividerIndex: idx,
      startX: Number(event?.clientX || 0),
      width: rect.width,
      startRatios: [...codeGenPanelRatios],
    });
    event?.preventDefault?.();
  };
  useEffect(() => {
    if (!codeGenPanelResize) return undefined;
    const onMove = (ev) => {
      const delta = (Number(ev?.clientX || 0) - Number(codeGenPanelResize.startX || 0)) / Number(codeGenPanelResize.width || 1);
      const base = Array.isArray(codeGenPanelResize.startRatios) ? codeGenPanelResize.startRatios : [0.34, 0.33, 0.33];
      const minPane = 0.15;
      let next = [...base];
      if (codeGenPanelResize.dividerIndex === 0) {
        const pair = base[0] + base[1];
        const left = Math.min(Math.max(base[0] + delta, minPane), Math.max(minPane, pair - minPane));
        next = [left, pair - left, base[2]];
      } else {
        const pair = base[1] + base[2];
        const mid = Math.min(Math.max(base[1] + delta, minPane), Math.max(minPane, pair - minPane));
        next = [base[0], mid, pair - mid];
      }
      setCodeGenPanelRatiosByPlc((prev) => ({ ...(prev || {}), [chatKey]: next }));
    };
    const onUp = () => setCodeGenPanelResize(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [chatKey, codeGenPanelResize]);
  const codeGenAssignedTagSet = useMemo(() => {
    const set = new Set();
    codeGenGroups.forEach((group) => {
      (Array.isArray(group?.tags) ? group.tags : []).forEach((tag) => set.add(String(tag || "")));
    });
    return set;
  }, [codeGenGroups]);
  const filteredCodeGenTags = useMemo(() => {
    const q = String(codeGenTagSearch || "").trim().toLowerCase();
    const src = Array.isArray(codeGenUserTags) ? codeGenUserTags : [];
    const filtered = !q ? src : src.filter((tag) => {
      const name = String(tag || "").toLowerCase();
      const equipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").toLowerCase();
      return name.includes(q) || equipmentType.includes(q);
    });
    const sorted = [...filtered].sort((a, b) => {
      const nameA = String(a || "").trim();
      const nameB = String(b || "").trim();
      const equipA = String(codeGenTagMeta?.[a]?.equipmentType || "").trim();
      const equipB = String(codeGenTagMeta?.[b]?.equipmentType || "").trim();
      if (codeGenTagSortBy === "equipment") {
        const byEquip = equipA.localeCompare(equipB);
        if (byEquip !== 0) return byEquip;
        return nameA.localeCompare(nameB);
      }
      const byName = nameA.localeCompare(nameB);
      if (byName !== 0) return byName;
      return equipA.localeCompare(equipB);
    });
    return codeGenTagSortDir === "desc" ? sorted.reverse() : sorted;
  }, [codeGenTagMeta, codeGenTagSearch, codeGenTagSortBy, codeGenTagSortDir, codeGenUserTags]);
  const codeGenPersistProfile = useMemo(() => {
    const tags = Array.isArray(codeGenUserTags)
      ? codeGenUserTags
          .map((t) => String(t || "").trim())
          .filter(Boolean)
      : [];
    const tagMeta = tags.reduce((acc, tag) => {
      const equipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").trim();
      const normalizeDefs = (value, fallback = []) =>
        Array.from(
          new Set(
            [
              ...(Array.isArray(value) ? value : []),
              ...fallback.map((addr) => ({ address: addr })),
            ]
              .map((entry) => {
                if (typeof entry === "string") return { name: "", address: String(entry || "").trim() };
                const name = String(entry?.name || "").trim();
                const address = String(entry?.address || entry?.value || "").trim();
                if (!address) return "";
                return `${name}|||${address}`;
              })
              .filter(Boolean)
          )
        )
          .map((key) => {
            const [name = "", address = ""] = String(key || "").split("|||");
            return { name, address };
          })
          .filter((entry) => String(entry?.address || "").trim());
      const inputDefs = normalizeDefs(
        codeGenTagMeta?.[tag]?.inputDefs,
        (Array.isArray(codeGenTagMeta?.[tag]?.inputs) ? codeGenTagMeta[tag].inputs : []).map((v) => String(v || "").trim()).filter(Boolean)
      );
      const outputDefs = normalizeDefs(
        codeGenTagMeta?.[tag]?.outputDefs,
        (Array.isArray(codeGenTagMeta?.[tag]?.outputs) ? codeGenTagMeta[tag].outputs : []).map((v) => String(v || "").trim()).filter(Boolean)
      );
      if (equipmentType || inputDefs.length || outputDefs.length) {
        acc[tag] = {
          ...(equipmentType ? { equipmentType } : {}),
          ...(inputDefs.length ? { inputDefs } : {}),
          ...(outputDefs.length ? { outputDefs } : {}),
        };
      }
      return acc;
    }, {});
    const groups = codeGenGroups.map((group) => {
      const id = String(group?.id || "").trim();
      const name = String(group?.name || "").trim();
      const parentId = String(group?.parentId || "").trim();
      const dbId = String(group?.dbId || "").trim();
      const routeDbId = String(group?.routeDbId || "").trim();
      const groupType = normalizeCodeGenGroupType(group?.groupType);
      const groupSubType = String(group?.groupSubType || "").trim();
      const description = String(group?.description || "").trim();
      const row = {
        id,
        name,
        parentId,
        groupType,
        ...(groupSubType ? { groupSubType } : {}),
        ...(description ? { description } : {}),
        ...(groupType === "Bin" && String(group?.binNumber || "").trim()
          ? { binNumber: String(group.binNumber).trim() }
          : {}),
        tags: (Array.isArray(group?.tags) ? group.tags : [])
          .map((t) => String(t || "").trim())
          .filter((t) => tags.includes(t)),
      };
      if (dbId) row.dbId = dbId;
      if (routeDbId) row.routeDbId = routeDbId;
      return row;
    });
    const expandedGroupIds = Array.from(codeGenExpandedSet.values()).map((id) => String(id || "").trim()).filter(Boolean);
    const equipmentTypes = Array.from(
      new Set((Array.isArray(codeGenEquipmentTypesByPlc?.[chatKey]) ? codeGenEquipmentTypesByPlc[chatKey] : []).map((v) => String(v || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    return {
      format: normalizeCodeGenFormat(codeGenFormat),
      tags,
      tagMeta,
      groups,
      expandedGroupIds,
      equipmentTypes,
      l5xTemplateText: String(codeGenRouteTemplateText || ""),
      templateRouteId: String(codeGenTemplateRouteIdDraft || ""),
      templateRouteName: String(codeGenTemplateRouteName || ""),
    };
  }, [
    chatKey,
    codeGenEquipmentTypesByPlc,
    codeGenExpandedSet,
    codeGenFormat,
    codeGenGroups,
    codeGenRouteTemplateText,
    codeGenTagMeta,
    codeGenTemplateRouteIdDraft,
    codeGenTemplateRouteName,
    codeGenUserTags,
  ]);
  const codeGenPersistSnapshot = useMemo(() => JSON.stringify(codeGenPersistProfile), [codeGenPersistProfile]);
  const dataTypeTemplateByName = useMemo(() => {
    const stripFamilyQualifier = (value) =>
      String(value || "")
        .replace(/\s*\(\s*FamilyType\s*:?=\s*[^)]+\)\s*$/i, "")
        .trim();
    const map = new Map();
    const normalize = (value) =>
      stripFamilyQualifier(String(value || ""))
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/\s+/g, "")
        .toLowerCase();
    const buildNameVariants = (rawName) => {
      const variants = new Set([String(rawName || "").trim()]);
      const value = String(rawName || "").trim();
      if (value.includes("::")) variants.add(value.split("::").pop() || "");
      if (value.includes(".")) variants.add(value.split(".").pop() || "");
      if (value.includes(":")) variants.add(value.split(":").pop() || "");
      // Support prefixed UDT names such as Parent_HMI_Write.
      const underscoreParts = value.split("_").filter(Boolean);
      if (underscoreParts.length >= 2) {
        for (let i = 1; i < underscoreParts.length; i += 1) {
          variants.add(underscoreParts.slice(i).join("_"));
        }
      }
      return Array.from(variants);
    };
    dataTypeTemplates.forEach((t) => {
      const score = Array.isArray(t?.fields) ? t.fields.length : 0;
      const upsert = (key, value) => {
        if (!key) return;
        const existing = map.get(key);
        const existingScore = Array.isArray(existing?.fields) ? existing.fields.length : 0;
        if (!existing || score > existingScore) {
          map.set(key, value);
        }
      };
      const rawName = String(t?.name || "").trim();
      const key = normalize(rawName);
      if (!key) return;
      upsert(key, t);
      const variants = buildNameVariants(rawName);
      variants.forEach((v) => {
        const vk = normalize(v);
        upsert(vk, t);
      });
    });
    return map;
  }, [dataTypeTemplates]);

  const resolveDataTypeTemplateByTypeName = (rawTypeName) => {
    const stripFamilyQualifier = (value) =>
      String(value || "")
        .replace(/\s*\(\s*FamilyType\s*:?=\s*[^)]+\)\s*$/i, "")
        .trim();
    const normalize = (value) =>
      stripFamilyQualifier(String(value || ""))
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/\s+/g, "")
        .toLowerCase();
    const raw = stripFamilyQualifier(String(rawTypeName || "").trim().replace(/^"|"$/g, ""));
    if (!raw) return null;
    const candidates = new Set([raw]);
    if (raw.includes("::")) candidates.add(raw.split("::").pop() || "");
    if (raw.includes(".")) candidates.add(raw.split(".").pop() || "");
    if (raw.includes(":")) candidates.add(raw.split(":").pop() || "");
    const underscoreParts = raw.split("_").filter(Boolean);
    if (underscoreParts.length >= 2) {
      for (let i = 1; i < underscoreParts.length; i += 1) {
        candidates.add(underscoreParts.slice(i).join("_"));
      }
    }
    for (const candidate of candidates) {
      const key = normalize(candidate);
      if (!key) continue;
      const direct = dataTypeTemplateByName.get(key);
      if (direct) return direct;
    }
    // Fallback: some exports prefix nested UDT names (e.g. Parent_ChildType).
    // Allow suffix match so ChildType resolves to Parent_ChildType.
    const normalizedCandidates = Array.from(candidates)
      .map((c) => normalize(c))
      .filter((c) => c && c.length >= 3)
      .sort((a, b) => b.length - a.length);
    for (const candidateKey of normalizedCandidates) {
      for (const [mappedKey, template] of dataTypeTemplateByName.entries()) {
        const mk = String(mappedKey || "");
        if (!mk) continue;
        if (
          mk === candidateKey ||
          mk.endsWith(`_${candidateKey}`) ||
          mk.endsWith(`.${candidateKey}`) ||
          mk.endsWith(`:${candidateKey}`) ||
          mk.endsWith(candidateKey)
        ) {
          return template;
        }
      }
    }
    return null;
  };

  useEffect(() => {
    setExpandedSummaryByKey({});
  }, [selected?.id]);
  useEffect(() => {
    setPlcTopTab(String(initialTab || "").trim() === "code-gen-pro" ? "code-gen-pro" : "plc");
  }, [initialTab]);
  useEffect(() => {
    if (String(activeTab || "") !== "code-gen-pro") {
      lastPlcInnerTabRef.current = String(activeTab || "overview");
    }
  }, [activeTab]);
  useEffect(() => {
    const top = String(plcTopTab || "").trim();
    if (top === "code-gen-pro") {
      if (activeTab !== "code-gen-pro") setActiveTab("code-gen-pro");
      return;
    }
    if (activeTab === "code-gen-pro") {
      const fallback = String(lastPlcInnerTabRef.current || "overview");
      setActiveTab(fallback === "code-gen-pro" ? "overview" : fallback);
    }
  }, [activeTab, plcTopTab]);
  useEffect(() => {
    if (String(activeTab || "") !== "code-gen-pro") {
      setCodeGenReady(false);
      return;
    }
    const timer = setTimeout(() => setCodeGenReady(true), 0);
    return () => clearTimeout(timer);
  }, [activeTab]);
  useEffect(() => {
    const current = String(activeTab || "").trim();
    const available = Array.isArray(visiblePlcTabs) ? visiblePlcTabs : [];
    if (!available.length) return;
    if (available.some((tab) => String(tab?.key || "") === current)) return;
    const preferred = available.some((tab) => String(tab?.key || "") === String(initialTab || "").trim())
      ? String(initialTab || "").trim()
      : String(available[0]?.key || "overview");
    if (preferred && preferred !== current) setActiveTab(preferred);
  }, [activeTab, initialTab, visiblePlcTabs]);
  useEffect(() => {
    const validIds = new Set(codeGenGroups.map((g) => String(g?.id || "").trim()).filter(Boolean));
    if (codeGenGroupParentDraft && !validIds.has(String(codeGenGroupParentDraft || "").trim())) {
      setCodeGenGroupParentDraft("");
    }
    if (codeGenSelectedGroupId && !validIds.has(String(codeGenSelectedGroupId || "").trim())) {
      setCodeGenSelectedGroupId("");
    }
  }, [codeGenGroupParentDraft, codeGenGroups, codeGenSelectedGroupId]);
  useEffect(() => {
    const selected =
      codeGenGroups.find((g) => String(g?.id || "").trim() === String(codeGenSelectedGroupId || "").trim()) || null;
    if (!selected) {
      setCodeGenDetailNameDraft("");
      setCodeGenDetailTypeDraft("Group");
      setCodeGenDetailSubTypeDraft("Feed");
      setCodeGenDetailBinNumberDraft("");
      setCodeGenDetailDescriptionDraft("");
      return;
    }
    const selectedType = normalizeCodeGenGroupType(selected?.groupType);
    setCodeGenDetailNameDraft(String(selected?.name || ""));
    setCodeGenDetailTypeDraft(selectedType);
    setCodeGenDetailSubTypeDraft(String(selected?.groupSubType || "Feed"));
    setCodeGenDetailBinNumberDraft(
      selectedType === "Bin"
        ? String(selected?.binNumber || extractCodeGenBinNumber(selected?.name || ""))
        : ""
    );
    setCodeGenDetailDescriptionDraft(String(selected?.description || ""));
    setCodeGenDetailEditByPlc((prev) => ({ ...(prev || {}), [chatKey]: false }));
  }, [chatKey, codeGenGroups, codeGenSelectedGroupId]);
  useEffect(() => {
    const selectedTag = String(codeGenSelectedTagByPlc?.[chatKey] || "").trim();
    if (!selectedTag) return;
    const equipmentType = String(codeGenTagMetaByPlc?.[chatKey]?.[selectedTag]?.equipmentType || "").trim();
    setCodeGenTagEquipmentDraftByPlc((prev) => {
      const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      if (String(byPlc?.[selectedTag] || "") === equipmentType) return prev;
      return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: equipmentType } };
    });
    setCodeGenTagEditByPlc((prev) => {
      const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      if (byPlc?.[selectedTag] === false) return prev;
      return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: false } };
    });
  }, [chatKey, codeGenSelectedTagByPlc, codeGenTagMetaByPlc]);
  useEffect(() => {
    if (!codeGenObjectContextMenu) return undefined;
    const closeMenu = () => setCodeGenObjectContextMenu(null);
    const onPointerDown = (event) => {
      const host = codeGenObjectContextMenuRef.current;
      if (host && host.contains(event?.target)) return;
      closeMenu();
    };
    const onKeyDown = (event) => {
      if (String(event?.key || "").toLowerCase() === "escape") closeMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [codeGenObjectContextMenu]);
  useEffect(() => {
    const key = String(chatKey || "").trim();
    const raw = String(selected?.rawText || "");
    if (!key || key === "__none__" || !raw.trim()) return;
    const timer = setTimeout(() => {
      const isL5xXml = /<RSLogix5000Content\b/i.test(raw);
      const extractRoutineTemplateMap = (text, routineNames = []) => {
        const source = String(text || "");
        if (!source) return {};
        const wanted = new Set(
          (Array.isArray(routineNames) ? routineNames : [])
            .map((name) => String(name || "").trim().toLowerCase())
            .filter(Boolean)
        );
        if (!wanted.size) return {};
        const out = {};
        const re = /<Routine\b([^>]*)>([\s\S]*?)<\/Routine>/gi;
        let match = re.exec(source);
        while (match) {
          const attrs = String(match[1] || "");
          const body = String(match[2] || "");
          const nameMatch = attrs.match(/\bName="([^"]+)"/i);
          const name = String(nameMatch?.[1] || "").trim();
          const keyName = name.toLowerCase();
          if (name && wanted.has(keyName) && !out[keyName]) {
            out[keyName] = `<Routine ${attrs.trim()}>\n${body.trim()}\n</Routine>`;
          }
          match = re.exec(source);
        }
        return out;
      };
      const routineTemplateNames = [
        "Main",
        "AlarmReset",
        "GeneralAlarms",
        "ScaleComs",
        "IO_Mapping",
        "IO_MappingHO",
        "IO_MappingWW",
        "HOScaleComs",
        "WWScaleComs",
      ];
      const extractedRoutineTemplates = isL5xXml
        ? extractRoutineTemplateMap(raw, routineTemplateNames)
        : {};
      const routeMatches = Array.from(new Set((raw.match(/\bRoute\d+\b/g) || []).map((v) => String(v || "").trim()))).filter(Boolean);
      const inferredRouteName = routeMatches.find((v) => String(v).toLowerCase() === "route1") || routeMatches[0] || "";
      const routeIdMatch =
        raw.match(/\b(i[_\s-]*routeid|route[_\s-]*id)\b[^0-9\-]*(-?\d+)/i) ||
        raw.match(/\bRouteID\b[^0-9\-]*(-?\d+)/i);
      const inferredRouteId = routeIdMatch ? String(routeIdMatch[2] || routeIdMatch[1] || "").trim() : "";
      const tokenized = raw
        .split(inferredRouteName || "__no_route_name__")
        .join(inferredRouteName ? "{{ROUTE_NAME}}" : inferredRouteName)
        .split(inferredRouteId || "__no_route_id__")
        .join(inferredRouteId ? "{{ROUTE_ID}}" : inferredRouteId);
      if (isL5xXml) {
        setCodeGenRouteTemplateTextByPlc((prev) => ({ ...(prev || {}), [key]: tokenized }));
        if (Object.keys(extractedRoutineTemplates).length) {
          setCodeGenRoutineTemplatesByPlc((prev) => ({
            ...(prev || {}),
            [key]: {
              ...((prev && prev[key] && typeof prev[key] === "object" ? prev[key] : {})),
              ...extractedRoutineTemplates,
            },
          }));
        }
      }
      if (inferredRouteName) {
        setCodeGenTemplateRouteNameByPlc((prev) => ({ ...(prev || {}), [key]: inferredRouteName }));
      }
      setCodeGenTemplateRouteIdDraft(inferredRouteId);
      if (isL5xXml && inferredRouteName && tokenized.trim()) {
        const templateKey = inferredRouteName.toLowerCase();
        fetch(`/api/ai/route-template/${encodeURIComponent(templateKey)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeName: inferredRouteName,
            sourceFileName: String(selected?.name || ""),
            templateText: tokenized,
          }),
        }).catch(() => {});
      }
      if (isL5xXml && Object.keys(extractedRoutineTemplates).length) {
        Object.entries(extractedRoutineTemplates).forEach(([routineKey, routineXml]) => {
          const routineName = String(routineKey || "").trim();
          const xml = String(routineXml || "");
          if (!routineName || !xml) return;
          fetch(
            `/api/ai/routine-template/${encodeURIComponent(key)}/${encodeURIComponent(routineName)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                routineName,
                sourceFileName: String(selected?.name || ""),
                routineXml: xml,
              }),
            }
          ).catch(() => {});
        });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [chatKey, selected?.rawText, selected?.name]);
  useEffect(() => {
    const validTagSet = new Set(Array.isArray(codeGenUserTags) ? codeGenUserTags : []);
    updateCodeGenGroups((curr) => {
      let changed = false;
      const next = curr.map((group) => {
        const base = Array.isArray(group?.tags) ? group.tags.map((x) => String(x || "").trim()).filter(Boolean) : [];
        const filtered = base.filter((tag) => validTagSet.has(tag));
        if (filtered.length !== base.length) changed = true;
        return { ...group, tags: filtered };
      });
      return changed ? next : curr;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatKey, codeGenUserTags]);
  useEffect(() => {
    const key = String(chatKey || "").trim();
    if (!key || key === "__none__") return;
    if (String(codeGenRouteTemplateTextByPlc?.[key] || "").trim()) return;
    const routeObjectName = String(
      (Array.isArray(codeGenGroupsByPlc?.[key]) ? codeGenGroupsByPlc[key] : []).find(
        (g) => String(g?.groupType || "").trim().toLowerCase() === "route"
      )?.name || ""
    ).trim();
    if (!routeObjectName) return;
    const templateKey = routeObjectName.toLowerCase();
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai/route-template/${encodeURIComponent(templateKey)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const template = data?.template && typeof data.template === "object" ? data.template : null;
        if (!template) return;
        const templateText = String(template?.templateText || "");
        if (!templateText.trim()) return;
        setCodeGenRouteTemplateTextByPlc((prev) => ({ ...(prev || {}), [key]: templateText }));
        const routeName = String(template?.routeName || routeObjectName).trim();
        if (routeName) {
          setCodeGenTemplateRouteNameByPlc((prev) => ({ ...(prev || {}), [key]: routeName }));
        }
      } catch {
        // best effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatKey, codeGenGroupsByPlc, codeGenRouteTemplateTextByPlc]);
  useEffect(() => {
    const key = String(chatKey || "").trim();
    if (!key || key === "__none__") return;
    const existing =
      codeGenRoutineTemplatesByPlc?.[key] && typeof codeGenRoutineTemplatesByPlc[key] === "object"
        ? codeGenRoutineTemplatesByPlc[key]
        : {};
    if (Object.keys(existing).length) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai/routine-templates/${encodeURIComponent(key)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const templates = Array.isArray(data?.templates) ? data.templates : [];
        if (!templates.length) return;
        const next = templates.reduce((acc, row) => {
          const routineKey = String(row?.routineKey || row?.routineName || "").trim().toLowerCase();
          const routineXml = String(row?.routineXml || "").trim();
          if (!routineKey || !routineXml) return acc;
          acc[routineKey] = routineXml;
          return acc;
        }, {});
        if (!Object.keys(next).length || cancelled) return;
        setCodeGenRoutineTemplatesByPlc((prev) => ({ ...(prev || {}), [key]: next }));
      } catch {
        // best effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatKey, codeGenRoutineTemplatesByPlc]);
  useEffect(() => {
    const validTagSet = new Set(Array.isArray(codeGenUserTags) ? codeGenUserTags : []);
    setCodeGenTagMetaByPlc((prev) => {
      const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const entries = Object.entries(current).filter(([tag]) => validTagSet.has(tag));
      if (entries.length === Object.keys(current).length) return prev;
      return { ...(prev || {}), [chatKey]: Object.fromEntries(entries) };
    });
    setCodeGenExpandedTagsByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const next = current.filter((tag) => validTagSet.has(String(tag || "")));
      if (next.length === current.length) return prev;
      return { ...(prev || {}), [chatKey]: next };
    });
    setCodeGenSelectedTagByPlc((prev) => {
      const current = String(prev?.[chatKey] || "").trim();
      if (!current || validTagSet.has(current)) return prev;
      return { ...(prev || {}), [chatKey]: "" };
    });
    setCodeGenTagEditByPlc((prev) => {
      const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const nextByPlc = Object.fromEntries(
        Object.entries(byPlc).filter(([tag]) => validTagSet.has(String(tag || "").trim()))
      );
      if (Object.keys(nextByPlc).length === Object.keys(byPlc).length) return prev;
      return { ...(prev || {}), [chatKey]: nextByPlc };
    });
    setCodeGenTagEquipmentDraftByPlc((prev) => {
      const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const nextByPlc = Object.fromEntries(
        Object.entries(byPlc).filter(([tag]) => validTagSet.has(String(tag || "").trim()))
      );
      if (Object.keys(nextByPlc).length === Object.keys(byPlc).length) return prev;
      return { ...(prev || {}), [chatKey]: nextByPlc };
    });
  }, [chatKey, codeGenUserTags]);
  useEffect(() => {
    const key = String(chatKey || "").trim();
    if (!key) return;
    const scanned = Array.from(
      new Set(allAoiEquipmentTypeNames.map((v) => String(v || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    if (!scanned.length) return;
    setCodeGenEquipmentTypesByPlc((prev) => {
      const current = Array.isArray(prev?.[key]) ? prev[key] : [];
      const merged = Array.from(new Set([...current, ...scanned])).sort((a, b) => a.localeCompare(b));
      if (merged.length === current.length && merged.every((v, i) => v === current[i])) return prev;
      return { ...(prev || {}), [key]: merged };
    });
  }, [allAoiEquipmentTypeNames, chatKey]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/opc/templates", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const rows = Array.isArray(data?.templates) ? data.templates : [];
        if (!cancelled) setStoredOpcTemplates(rows);
        const names = Array.from(
          new Set(
            rows
              .filter((row) => {
                const group = String(row?.group_name || "").trim().toLowerCase();
                return group === "aoi" || group === "datatype";
              })
              .map((row) => String(row?.name || "").trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));
        if (!cancelled) setGlobalTemplateTypeNames(names);
      } catch {
        // best effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai/code-gen-pro/${encodeURIComponent(GLOBAL_CODE_GEN_BASE_KEY)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const profile = data?.profile && typeof data.profile === "object" ? data.profile : null;
        const text = String(profile?.l5xTemplateText || "");
        if (!cancelled) setGlobalCodeGenBaseText(text);
      } catch {
        // best effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const key = String(chatKey || "").trim();
    if (!key) return;
    if (codeGenProfileLoadedByPlcRef.current?.[key]) {
      setCodeGenPersistReadyByPlc((prev) => ({ ...(prev || {}), [key]: true }));
      return;
    }
    let cancelled = false;
    setCodeGenPersistReadyByPlc((prev) => ({ ...(prev || {}), [key]: false }));
    (async () => {
      try {
        const res = await fetch(`/api/ai/code-gen-pro/${encodeURIComponent(key)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(data?.error || "Failed to load Code Gen profile."));
        const profile = data?.profile && typeof data.profile === "object" ? data.profile : null;
        const hasProfile = !!profile;
        const loadedTags = Array.isArray(profile?.tags)
          ? Array.from(
              new Set(
                profile.tags
                  .map((t) => normalizeCodeGenTag(t))
                  .filter(Boolean)
              )
            ).sort((a, b) => a.localeCompare(b))
          : [];
        const loadedTagMetaRaw =
          profile?.tagMeta && typeof profile.tagMeta === "object" && !Array.isArray(profile.tagMeta)
            ? profile.tagMeta
            : {};
        const loadedTagMeta = loadedTags.reduce((acc, tag) => {
          const equipmentType = String(loadedTagMetaRaw?.[tag]?.equipmentType || "").trim();
          const normalizeDefs = (defs, legacyArray, legacySingle) =>
            Array.from(
              new Set(
                [
                  ...(Array.isArray(defs) ? defs : []),
                  ...(Array.isArray(legacyArray) ? legacyArray : []).map((address) => ({ address })),
                  ...(String(legacySingle || "").trim() ? [{ address: String(legacySingle || "").trim() }] : []),
                ]
                  .map((entry) => {
                    if (typeof entry === "string") return `${""}|||${String(entry || "").trim()}`;
                    const name = String(entry?.name || "").trim();
                    const address = String(entry?.address || entry?.value || "").trim();
                    if (!address) return "";
                    return `${name}|||${address}`;
                  })
                  .filter(Boolean)
              )
            )
              .map((key) => {
                const [name = "", address = ""] = String(key || "").split("|||");
                return { name, address };
              })
              .filter((entry) => String(entry?.address || "").trim());
          const inputDefs = normalizeDefs(
            loadedTagMetaRaw?.[tag]?.inputDefs,
            loadedTagMetaRaw?.[tag]?.inputs,
            loadedTagMetaRaw?.[tag]?.plcInputAddress
          );
          const outputDefs = normalizeDefs(
            loadedTagMetaRaw?.[tag]?.outputDefs,
            loadedTagMetaRaw?.[tag]?.outputs,
            loadedTagMetaRaw?.[tag]?.plcOutputAddress
          );
          if (equipmentType || inputDefs.length || outputDefs.length) {
            acc[tag] = {
              ...(equipmentType ? { equipmentType } : {}),
              ...(inputDefs.length ? { inputDefs } : {}),
              ...(outputDefs.length ? { outputDefs } : {}),
            };
          }
          return acc;
        }, {});
        const loadedGroups = Array.isArray(profile?.groups)
          ? profile.groups
              .map((group, idx) => {
                const id = String(group?.id || `grp_${idx + 1}`).trim();
                const name = String(group?.name || "").trim();
                const parentId = String(group?.parentId || "").trim();
                const dbId = String(group?.dbId || "").trim();
                const routeDbId = String(group?.routeDbId || "").trim();
                const groupType = normalizeCodeGenGroupType(group?.groupType || group?.grouptype);
                const groupSubType = String(group?.groupSubType || group?.groupsubtype || "").trim();
                const description = String(group?.description || group?.groupdescription || "").trim();
                const binNumber =
                  groupType === "Bin"
                    ? String(group?.binNumber || group?.binnumber || extractCodeGenBinNumber(name))
                    : "";
                const tags = (Array.isArray(group?.tags) ? group.tags : [])
                  .map((t) => normalizeCodeGenTag(t))
                  .filter((t) => loadedTags.includes(t));
                if (!id || !name) return null;
                return {
                  id,
                  name,
                  parentId,
                  groupType,
                  ...(groupSubType ? { groupSubType } : {}),
                  ...(description ? { description } : {}),
                  ...(binNumber ? { binNumber } : {}),
                  tags: Array.from(new Set(tags)),
                  ...(dbId ? { dbId, dbSyncState: "ok" } : {}),
                  ...(routeDbId ? { routeDbId } : {}),
                };
              })
              .filter(Boolean)
          : [];
        const loadedExpanded = Array.isArray(profile?.expandedGroupIds)
          ? profile.expandedGroupIds
              .map((id) => String(id || "").trim())
              .filter(Boolean)
              .filter((id) => loadedGroups.some((g) => String(g?.id || "") === id))
          : [];
        const loadedEquipmentTypes = Array.from(
          new Set(
            (
              Array.isArray(profile?.equipmentTypes) && profile?.equipmentTypes.length
                ? profile.equipmentTypes
                : allAoiEquipmentTypeNames
            )
              .map((v) => String(v || "").trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));
        const loadedFormatRaw = normalizeCodeGenFormat(profile?.format);
        const loadedFormat = loadedFormatRaw === "list" ? "l5x-template" : loadedFormatRaw;
        if (cancelled) return;
        setCodeGenTagsByPlc((prev) => ({ ...(prev || {}), [key]: loadedTags }));
        setCodeGenTagMetaByPlc((prev) => ({ ...(prev || {}), [key]: loadedTagMeta }));
        setCodeGenEquipmentTypesByPlc((prev) => ({ ...(prev || {}), [key]: loadedEquipmentTypes }));
        setCodeGenGroupsByPlc((prev) => ({ ...(prev || {}), [key]: loadedGroups }));
        setCodeGenExpandedGroupsByPlc((prev) => ({ ...(prev || {}), [key]: loadedExpanded }));
        setCodeGenFormat(loadedFormat);
        setCodeGenRouteTemplateTextByPlc((prev) => ({
          ...(prev || {}),
          [key]: String(profile?.l5xTemplateText || ""),
        }));
        setCodeGenTemplateRouteNameByPlc((prev) => ({
          ...(prev || {}),
          [key]: String(profile?.templateRouteName || ""),
        }));
        setCodeGenTemplateRouteIdDraft(String(profile?.templateRouteId || ""));
        setCodeGenGroupTypeDraft("Group");
        setCodeGenGroupParentDraft("");
        if (hasProfile) {
          codeGenLastSavedSnapshotByPlcRef.current[key] = JSON.stringify({
            format: loadedFormat,
            tags: loadedTags,
            tagMeta: loadedTagMeta,
            groups: loadedGroups.map((g) => ({
              id: String(g?.id || ""),
              name: String(g?.name || ""),
              parentId: String(g?.parentId || ""),
              groupType: normalizeCodeGenGroupType(g?.groupType),
              ...(String(g?.groupSubType || "").trim() ? { groupSubType: String(g.groupSubType).trim() } : {}),
              ...(String(g?.description || "").trim() ? { description: String(g.description).trim() } : {}),
              ...(normalizeCodeGenGroupType(g?.groupType) === "Bin" && String(g?.binNumber || "").trim()
                ? { binNumber: String(g.binNumber).trim() }
                : {}),
              tags: Array.isArray(g?.tags) ? g.tags : [],
              ...(String(g?.dbId || "").trim() ? { dbId: String(g.dbId) } : {}),
              ...(String(g?.routeDbId || "").trim() ? { routeDbId: String(g.routeDbId) } : {}),
            })),
            expandedGroupIds: loadedExpanded,
            equipmentTypes: loadedEquipmentTypes,
            l5xTemplateText: String(profile?.l5xTemplateText || ""),
            templateRouteId: String(profile?.templateRouteId || ""),
            templateRouteName: String(profile?.templateRouteName || ""),
          });
        } else {
          delete codeGenLastSavedSnapshotByPlcRef.current[key];
        }
        codeGenProfileLoadedByPlcRef.current[key] = true;
      } catch (err) {
        if (!cancelled) toastError(String(err?.message || "Failed to load Code Gen profile."));
      } finally {
        if (!cancelled) {
          setCodeGenPersistReadyByPlc((prev) => ({ ...(prev || {}), [key]: true }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allAoiEquipmentTypeNames, chatKey]);
  useEffect(() => {
    const key = String(chatKey || "").trim();
    if (!key) return;
    if (codeGenPersistReadyByPlc?.[key] !== true) return;
    const snapshot = String(codeGenPersistSnapshot || "");
    if (!snapshot) return;
    if (codeGenLastSavedSnapshotByPlcRef.current?.[key] === snapshot) return;
    if (codeGenSaveTimerRef.current) clearTimeout(codeGenSaveTimerRef.current);
    codeGenSaveTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ai/code-gen-pro/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profile: codeGenPersistProfile }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(data?.error || "Failed to save Code Gen profile."));
        codeGenLastSavedSnapshotByPlcRef.current[key] = snapshot;
      } catch (err) {
        const now = Date.now();
        if (now - Number(codeGenPersistErrorAtRef.current || 0) > 5000) {
          codeGenPersistErrorAtRef.current = now;
          toastError(String(err?.message || "Failed to save Code Gen profile."));
        }
      }
    }, 700);
    return () => {
      if (codeGenSaveTimerRef.current) clearTimeout(codeGenSaveTimerRef.current);
    };
  }, [chatKey, codeGenPersistProfile, codeGenPersistReadyByPlc, codeGenPersistSnapshot]);

  const fullSectionNamesByKey = useMemo(() => {
    if (!analysis || !selected?.rawText) return {};
    const raw = String(selected.rawText || "");
    if (!raw) return {};
    const out = {};
    for (const row of Array.isArray(analysis.sections) ? analysis.sections : []) {
      const key = String(row?.key || "").trim();
      if (!key) continue;
      if (key === "Tag") {
        const tagNames = Array.isArray(analysis?.controllerTags?.tags)
          ? analysis.controllerTags.tags
              .map((t) => String(t?.name || "").trim())
              .filter(Boolean)
          : [];
        if (tagNames.length) {
          out[key] = tagNames;
          continue;
        }
      }
      if (String(analysis?.fileFormat || "").toLowerCase() === "l5k") {
        const l5kKeywordByKey = {
          Task: "TASK",
          Program: "PROGRAM",
          Routine: "ROUTINE",
          Module: "MODULE",
          AddOnInstructionDefinition: "ADD_ON_INSTRUCTION_DEFINITION",
          DataType: "DATATYPE",
        };
        const keyword = l5kKeywordByKey[key];
        out[key] = keyword ? scanNamedElementsL5k(raw, keyword, 50000).names : [];
      } else {
        out[key] = scanNamedElements(raw, key, 50000).names;
      }
    }
    return out;
  }, [analysis, selected?.rawText]);

  const commit = (next) => {
    if (typeof onChange === "function") onChange(next);
  };

  const updateSelectedPlc = (updater) => {
    const selectedIdValue = String(selected?.id || "");
    if (!selectedIdValue) return;
    const next = (Array.isArray(plcItems) ? plcItems : []).map((item) => {
      if (String(item?.id || "") !== selectedIdValue) return item;
      const base = item && typeof item === "object" ? item : {};
      const patched = typeof updater === "function" ? updater(base) : base;
      return patched && typeof patched === "object" ? patched : base;
    });
    commit(next);
  };

  const setChatMessages = (nextOrUpdater) => {
    setChatByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const next = typeof nextOrUpdater === "function" ? nextOrUpdater(current) : nextOrUpdater;
      const normalized = Array.isArray(next) ? next.slice(-40) : [];
      updateSelectedPlc((item) => ({ ...item, chatHistory: normalized }));
      return {
        ...prev,
        [chatKey]: normalized,
      };
    });
  };

  const setOpcPlan = (nextOrUpdater) => {
    setOpcPlanByPlc((prev) => {
      const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : null;
      const next = typeof nextOrUpdater === "function" ? nextOrUpdater(current) : nextOrUpdater;
      updateSelectedPlc((item) => ({ ...item, opcPlan: next && typeof next === "object" ? next : null }));
      return {
        ...prev,
        [chatKey]: next && typeof next === "object" ? next : null,
      };
    });
  };

  const getSelectedControllerTags = () => {
    const direct = Array.isArray(analysis?.controllerTags?.tags) ? analysis.controllerTags.tags : [];
    if (direct.length) return direct;
    const raw = String(selected?.rawText || "");
    if (!raw) return [];
    try {
      const rescanned = analyzeL5x(raw);
      return Array.isArray(rescanned?.controllerTags?.tags) ? rescanned.controllerTags.tags : [];
    } catch {
      return [];
    }
  };

  const detectOpcAction = (text) => {
    const value = String(text || "");
    return /\b(opc|opcua)\b/i.test(value) && /\b(connect|connection|configure|setup|bind|link|map|add)\b/i.test(value);
  };

  const detectSvgRecommendationIntent = (text) => {
    const value = String(text || "");
    if (!value) return false;
    if (/\b(svg|symbol|icon)\b/i.test(value)) return true;
    return /\bwhat\b[\s\S]{0,40}\b(use|pick|choose)\b/i.test(value) && /\btags?\b/i.test(value);
  };

  const detectSvgInsertIntent = (text) => {
    const value = String(text || "");
    if (!value) return false;
    return (
      /\b(add|insert|place|drop|put|use)\b[\s\S]{0,40}\b(svg|symbol|icon)\b/i.test(value) ||
      /\badd\s+svgs?\b/i.test(value)
    );
  };

  const findMentionedOpcConnection = (text, names) => {
    const hay = String(text || "").toLowerCase();
    const list = Array.isArray(names) ? names : [];
    return (
      list.find((name) => {
        const n = String(name || "").trim();
        return n && hay.includes(n.toLowerCase());
      }) || ""
    );
  };

  const findMentionedOption = (text, options) => {
    const hay = String(text || "").toLowerCase();
    const list = Array.isArray(options) ? options : [];
    return (
      list.find((name) => {
        const n = String(name || "").trim();
        return n && hay.includes(n.toLowerCase());
      }) || ""
    );
  };

  const resolveBaseTagName = (rawName, tags) => {
    const requested = cleanRequestedTagName(rawName);
    if (!requested) return "";
    const requestedKey = normalizeTagLookupKey(requested);
    if (!requestedKey) return "";
    const requestedBase = requested.split(".")[0] || requested;
    const requestedBaseKey = normalizeTagLookupKey(requestedBase);
    const list = Array.isArray(tags) ? tags : [];
    const bases = list
      .map((t) => ({
        name: String(t?.name || "").trim(),
        parent: String(t?.parent || "").trim(),
      }))
      .filter((t) => t.name);
    const exact = bases.find((t) => {
      if (t.parent) return false;
      const key = normalizeTagLookupKey(t.name);
      return key === requestedKey || key === requestedBaseKey;
    });
    if (exact) return String(exact.name || "").trim();
    const loose = bases.find((t) => {
      const name = String(t?.name || "").trim();
      if (!name) return false;
      const key = normalizeTagLookupKey(name);
      if (key === requestedKey || key === requestedBaseKey) return true;
      if (!t.parent) {
        if (key.endsWith(`.${requestedKey}`) || key.endsWith(`.${requestedBaseKey}`)) return true;
        if (requestedKey.endsWith(`.${key}`) || requestedBaseKey.endsWith(`.${key}`)) return true;
      }
      return false;
    });
    if (loose) {
      const name = String(loose?.name || "").trim();
      const parent = String(loose?.parent || "").trim();
      const resolved = parent || name;
      if (resolved) return resolved;
    }
    const raw = String(selected?.rawText || "");
    if (!raw) return "";
    const exactRaw = findExactBaseTagFromRaw(raw, requested) || findExactBaseTagFromRaw(raw, requestedBase);
    if (exactRaw) return exactRaw;
    const baseNames = scanBaseTagNamesFromRaw(raw, 50000);
    const rawMatch =
      baseNames.find((nameText) => normalizeTagLookupKey(nameText) === requestedKey) ||
      baseNames.find((nameText) => normalizeTagLookupKey(nameText) === requestedBaseKey) ||
      baseNames.find((nameText) => normalizeTagLookupKey(nameText).endsWith(`.${requestedKey}`)) ||
      baseNames.find((nameText) => normalizeTagLookupKey(nameText).endsWith(`.${requestedBaseKey}`)) ||
      "";
    return String(rawMatch || "").trim();
  };

  const buildMemberOptionsForTag = (baseTag, tags) => {
    const base = String(baseTag || "").trim();
    if (!base) return [];
    const rows = Array.isArray(tags) ? tags : [];
    const baseDataType =
      String(
        rows.find(
          (row) =>
            String(row?.parent || "").trim() === "" &&
            String(row?.name || "").trim().toLowerCase() === base.toLowerCase()
        )?.plcType || ""
      ).trim() || "";
    const options = [];
    for (const row of rows) {
      const parent = String(row?.parent || "").trim();
      const fullTag = String(row?.name || "").trim();
      if (!fullTag) continue;
      if (parent === base || fullTag.toLowerCase().startsWith(`${base.toLowerCase()}.`)) {
        const member = fullTag.slice(base.length + 1).trim();
        if (!member) continue;
        options.push({
          member,
          fullTag,
          plcType: String(row?.plcType || "").trim(),
          dataType: baseDataType || undefined,
        });
      }
    }
    const dedup = new Map();
    for (const opt of options) {
      const k = String(opt.fullTag || "").toLowerCase();
      if (!dedup.has(k)) dedup.set(k, opt);
    }
    const normalized = Array.from(dedup.values()).sort((a, b) => a.member.localeCompare(b.member));
    if (normalized.length) return normalized;
    const raw = String(selected?.rawText || "");
    if (!raw) return normalized;
    return scanMembersForBaseTagFromRaw(raw, base).map((row) => ({
      ...row,
      dataType: baseDataType || undefined,
    }));
  };

  const parseSelectedMembers = (text, options) => {
    const raw = String(text || "").trim().toLowerCase();
    const list = Array.isArray(options) ? options : [];
    if (!raw || !list.length) return [];
    if (/\ball\b/.test(raw)) return list;
    const picked = [];
    const seen = new Set();
    const tokens = raw
      .split(/[\s,;|]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const token of tokens) {
      const idx = Number(token);
      if (Number.isInteger(idx) && idx >= 1 && idx <= list.length) {
        const opt = list[idx - 1];
        if (opt && !seen.has(opt.fullTag.toLowerCase())) {
          seen.add(opt.fullTag.toLowerCase());
          picked.push(opt);
        }
        continue;
      }
      const match = list.find(
        (opt) =>
          String(opt.member || "").toLowerCase() === token ||
          String(opt.fullTag || "").toLowerCase() === token
      );
      if (match && !seen.has(match.fullTag.toLowerCase())) {
        seen.add(match.fullTag.toLowerCase());
        picked.push(match);
      }
    }
    return picked;
  };

  const buildTagRowsFromMembers = (members) =>
    (Array.isArray(members) ? members : []).map((opt) => ({
      name: String(opt?.fullTag || "").trim(),
      tagPath: String(opt?.fullTag || "").trim(),
      plcType: String(opt?.plcType || "").trim() || undefined,
      dataType: String(opt?.dataType || "").trim() || undefined,
      tagType: "Member",
    }));

  const fetchLatestDebugSnapshot = async () => {
    if (!debugSessionId) return null;
    try {
      const res = await fetch(`/api/ai/plc-debug-sessions/${encodeURIComponent(debugSessionId)}`, {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      const snapshot = data?.session?.snapshot || null;
      setDebugSnapshotByPlc((prev) => ({ ...prev, [chatKey]: snapshot }));
      return snapshot;
    } catch {
      return null;
    }
  };

  const formatMemberReadResults = (baseTag, members, snapshot) => {
    const list = Array.isArray(members) ? members : [];
    const rows = Array.isArray(snapshot?.tags) ? snapshot.tags : [];
    const findRowForMember = (member) => {
      const full = String(member?.fullTag || "").trim().toLowerCase();
      if (!full) return null;
      return (
        rows.find((row) => {
          const key = String(row?.key || "").trim().toLowerCase();
          const path = String(row?.tagPath || "").trim().toLowerCase();
          return key === full || path === full || key.endsWith(`.${full}`) || path.endsWith(`.${full}`);
        }) || null
      );
    };
    const lines = list.map((member) => {
      const row = findRowForMember(member);
      const memberName = String(member?.member || member?.fullTag || "").trim();
      if (!row) return `${memberName} = (no live value yet)`;
      const value = row?.value == null ? "null" : String(row.value);
      const quality = String(row?.quality || "Unknown");
      return `${memberName} = ${value} [${quality}]`;
    });
    return `Live values for ${baseTag} (${list.length} member${list.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
  };

  const executeReadMembersFlow = async ({ baseTag, members, promptText, planOverride = null }) => {
    const selectedMembers = Array.isArray(members) ? members : [];
    if (!baseTag || !selectedMembers.length) {
      return { ok: false, error: "No members selected for live read." };
    }
    const selectedTagRows = buildTagRowsFromMembers(selectedMembers);
    const planned = {
      ...(planOverride && typeof planOverride === "object" ? planOverride : opcPlan && typeof opcPlan === "object" ? opcPlan : {}),
      tags: selectedTagRows,
      tagCount: selectedTagRows.length,
    };
    const applyResult = await applyOpcConnection({
      promptOverride: String(promptText || "").trim() || `Read tags from ${baseTag}`,
      planOverride: planned,
    });
    if (!applyResult.ok) return applyResult;

    if (debugSessionId) {
      try {
        await fetch(`/api/ai/plc-debug-sessions/${encodeURIComponent(debugSessionId)}/watch`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            watchTags: selectedMembers.map((m) => String(m?.fullTag || "").trim()).filter(Boolean),
            mode: "append",
          }),
        });
      } catch {
        // best effort
      }
    }

    let snapshot = await fetchLatestDebugSnapshot();
    if (!snapshot) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      snapshot = await fetchLatestDebugSnapshot();
    }
    if (!snapshot) {
      return {
        ok: true,
        message: `${applyResult.message}\nLive snapshot not ready yet. Try the same read command again in a few seconds.`,
      };
    }
    return {
      ok: true,
      message: `${applyResult.message}\n${formatMemberReadResults(baseTag, selectedMembers, snapshot)}`,
    };
  };

  const onFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const rawText = String(text || "");
      const nextAnalysis = analyzeL5x(rawText, file.name);
      const id = `plc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next = [
        ...(Array.isArray(plcItems) ? plcItems : []),
        {
          id,
          name: String(file.name || "PLC"),
          size: Number(file.size) || 0,
          uploadedAt: Date.now(),
          rawText,
          analysis: nextAnalysis,
          chatHistory: [],
          opcPlan: null,
        },
      ];
      commit(next);
      setSelectedId(id);
      void persistAoiTemplatesFromRawText(rawText);
      void persistGlobalCodeGenBaseFromRawText(rawText, file.name);
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

  async function persistAoiTemplatesFromRawText(rawText) {
    const source = String(rawText || "").trim();
    if (!source) return;
    const templates = scanAoiTemplates(source, 800, 2000);
    if (!templates.length) return;
    let success = 0;
    const failures = [];
    for (const template of templates) {
      const name = String(template?.name || "").trim();
      const fields = Array.isArray(template?.fields) ? template.fields : [];
      const includedFields = fields.filter((field) => isImportableFieldName(field?.name));
      if (!name) continue;
      const payload = {
        name,
        fields: includedFields.map((field) => ({
          name: String(field?.name || "").trim(),
          tagPath: String(field?.tagPath || "").trim(),
          plcType: String(field?.plcType || "").trim(),
          baseType: String(field?.baseType || "").trim(),
          isArray: field?.isArray === true,
          arraySpec: String(field?.arraySpec || "").trim(),
          usage: String(field?.usage || "").trim(),
          uaType: String(field?.uaType || "").trim(),
          enabled: field?.enabled !== false,
        })),
        parent_name: null,
        group_name: "AOI",
        state_mappings: [],
      };
      try {
        const res = await fetch("/api/opc/templates", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failures.push(String(data?.error || `Failed to save AOI template ${name}.`));
          continue;
        }
        success += 1;
      } catch (err) {
        failures.push(String(err?.message || `Failed to save AOI template ${name}.`));
      }
    }
    if (success > 0) {
      setAoiTemplateStatus(`Saved ${success}/${templates.length} AOI template(s) to DB from uploaded file.`);
    }
    if (failures.length) {
      setAoiTemplateError(failures.slice(0, 4).join(" | "));
    }
  }

  async function persistGlobalCodeGenBaseFromRawText(rawText, sourceName = "") {
    const text = String(rawText || "");
    if (!/<RSLogix5000Content\b/i.test(text)) return;
    const profile = {
      format: "l5x-template",
      tags: [],
      tagMeta: {},
      groups: [],
      expandedGroupIds: [],
      equipmentTypes: Array.isArray(globalTemplateTypeNames) ? globalTemplateTypeNames : [],
      l5xTemplateText: text,
      templateRouteId: "1",
      templateRouteName: "Route1",
      sourceFileName: String(sourceName || "").trim(),
      updatedAt: Date.now(),
    };
    try {
      const res = await fetch(`/api/ai/code-gen-pro/${encodeURIComponent(GLOBAL_CODE_GEN_BASE_KEY)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      if (!res.ok) return;
      setGlobalCodeGenBaseText(text);
    } catch {
      // best effort
    }
  }

  const exportCodeGenOutput = () => {
    const text = String(codeGenOutputText || "").trim();
    if (!text) {
      toastInfo("Nothing to export from current output.");
      return;
    }
    const format = normalizeCodeGenFormat(codeGenFormat);
    const ext = format === "l5x-template" ? "l5x" : "csv";
    const baseNameRaw = String(selected?.name || "code_gen_output")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const suffix = format === "l5x-template" ? "starter" : format;
    const fileName = `${baseNameRaw || "code_gen_output"}_${suffix}.${ext}`;
    try {
      const blob = new Blob([text], { type: ext === "l5x" ? "application/xml;charset=utf-8" : "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toastSuccess(`Exported ${fileName}`);
    } catch {
      toastError("Export failed.");
    }
  };

  const updateCodeGenGroups = (updater) => {
    setCodeGenGroupsByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const nextRaw = typeof updater === "function" ? updater(current) : current;
      const next = Array.isArray(nextRaw) ? nextRaw : current;
      return { ...(prev || {}), [chatKey]: next };
    });
  };

  const addCodeGenTag = (raw, equipmentTypeRaw = "") => {
    const tag = normalizeCodeGenTag(raw);
    if (!tag) {
      toastInfo("Enter a tag name.");
      return;
    }
    const equipmentType = String(equipmentTypeRaw || "").trim();
    let tagAdded = false;
    setCodeGenTagsByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      if (current.includes(tag)) return prev;
      tagAdded = true;
      return { ...(prev || {}), [chatKey]: [...current, tag].sort((a, b) => a.localeCompare(b)) };
    });
    if (equipmentType) {
      setCodeGenEquipmentTypesByPlc((prev) => {
        const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
        if (current.includes(equipmentType)) return prev;
        return { ...(prev || {}), [chatKey]: [...current, equipmentType].sort((a, b) => a.localeCompare(b)) };
      });
      setCodeGenTagMetaByPlc((prev) => {
        const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
        const existing = current?.[tag] && typeof current[tag] === "object" ? current[tag] : {};
        return {
          ...(prev || {}),
          [chatKey]: {
            ...current,
            [tag]: { ...existing, equipmentType },
          },
        };
      });
    }
    setCodeGenNewTagDraft("");
    setCodeGenNewTagEquipmentDraft("");
    if (tagAdded) toastSuccess(`Added tag ${tag}.`);
    else if (equipmentType) toastSuccess(`Updated equipment type for ${tag}.`);
    else toastInfo(`Tag ${tag} already exists.`);
  };

  const removeCodeGenEquipmentTypeOption = (raw) => {
    const type = String(raw || "").trim();
    if (!type) return;
    setCodeGenEquipmentTypesByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      if (!current.includes(type)) return prev;
      return { ...(prev || {}), [chatKey]: current.filter((x) => String(x || "").trim() !== type) };
    });
    if (String(codeGenNewTagEquipmentDraft || "").trim() === type) setCodeGenNewTagEquipmentDraft("");
    toastSuccess(`Removed equipment type ${type}.`);
  };

  const removeCodeGenTag = (raw) => {
    const tag = normalizeCodeGenTag(raw);
    if (!tag) return;
    setCodeGenTagsByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      return { ...(prev || {}), [chatKey]: current.filter((t) => String(t || "").trim() !== tag) };
    });
    setCodeGenTagMetaByPlc((prev) => {
      const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      if (!Object.prototype.hasOwnProperty.call(current, tag)) return prev;
      const nextMeta = { ...current };
      delete nextMeta[tag];
      return { ...(prev || {}), [chatKey]: nextMeta };
    });
    updateCodeGenGroups((curr) =>
      curr.map((group) => {
        const baseTags = Array.isArray(group?.tags) ? group.tags.map((x) => String(x || "").trim()).filter(Boolean) : [];
        return { ...group, tags: baseTags.filter((x) => x !== tag) };
      })
    );
    toastSuccess(`Removed tag ${tag}.`);
  };

  const importCodeGenTagsFromCsv = async (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = extractTagsFromBasicCsv(text);
      if (!parsed.length) {
        toastInfo("No tags found in CSV.");
        return;
      }
      let added = 0;
      let metaUpdates = 0;
      const importedEquipmentTypes = new Set();
      setCodeGenTagsByPlc((prev) => {
        const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
        const set = new Set(current.map((t) => String(t || "").trim().toLowerCase()));
        const next = [...current];
        parsed.forEach((row) => {
          const tag = normalizeCodeGenTag(row?.tag || "");
          const key = String(tag || "").trim().toLowerCase();
          if (!key || set.has(key)) return;
          set.add(key);
          next.push(tag);
          added += 1;
        });
        return { ...(prev || {}), [chatKey]: next.sort((a, b) => a.localeCompare(b)) };
      });
      setCodeGenTagMetaByPlc((prev) => {
        const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
        const nextMeta = { ...current };
        parsed.forEach((row) => {
          const tag = normalizeCodeGenTag(row?.tag || "");
          const equipmentType = String(row?.equipmentType || "").trim();
          if (!tag || !equipmentType) return;
          importedEquipmentTypes.add(equipmentType);
          const existing = nextMeta?.[tag] && typeof nextMeta[tag] === "object" ? nextMeta[tag] : {};
          if (String(existing?.equipmentType || "").trim() === equipmentType) return;
          nextMeta[tag] = { ...existing, equipmentType };
          metaUpdates += 1;
        });
        return { ...(prev || {}), [chatKey]: nextMeta };
      });
      if (importedEquipmentTypes.size) {
        setCodeGenEquipmentTypesByPlc((prev) => {
          const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
          const merged = Array.from(new Set([...current, ...Array.from(importedEquipmentTypes)])).sort((a, b) =>
            String(a || "").localeCompare(String(b || ""))
          );
          return { ...(prev || {}), [chatKey]: merged };
        });
      }
      if (added > 0 && metaUpdates > 0) {
        toastSuccess(`Imported ${added} tag(s) and ${metaUpdates} equipment type value(s) from CSV.`);
      } else if (added > 0) {
        toastSuccess(`Imported ${added} tag(s) from CSV.`);
      } else if (metaUpdates > 0) {
        toastSuccess(`Updated equipment type for ${metaUpdates} tag(s) from CSV.`);
      } else {
        toastInfo("All CSV tags already exist.");
      }
    } catch {
      toastError("CSV import failed.");
    } finally {
      if (event?.target) event.target.value = "";
    }
  };

  const updateCodeGenTagMetaField = (tagRaw, field, rawValue) => {
    const tag = normalizeCodeGenTag(tagRaw);
    const key = String(field || "").trim();
    if (!tag || !key) return;
    const value = String(rawValue || "").trim();
    setCodeGenTagMetaByPlc((prev) => {
      const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const existing = current?.[tag] && typeof current[tag] === "object" ? current[tag] : {};
      if (value) {
        return {
          ...(prev || {}),
          [chatKey]: {
            ...current,
            [tag]: { ...existing, [key]: value },
          },
        };
      }
      if (!Object.prototype.hasOwnProperty.call(existing, key)) return prev;
      const nextEntry = { ...existing };
      delete nextEntry[key];
      const nextMeta = { ...current };
      if (!Object.keys(nextEntry).length) delete nextMeta[tag];
      else nextMeta[tag] = nextEntry;
      return { ...(prev || {}), [chatKey]: nextMeta };
    });
    setCodeGenExpandedTagsByPlc((prev) => {
      const current = new Set(Array.isArray(prev?.[chatKey]) ? prev[chatKey] : []);
      if (!current.has(tag)) return prev;
      current.delete(tag);
      return { ...(prev || {}), [chatKey]: Array.from(current) };
    });
    setCodeGenIoDraftByPlc((prev) => {
      const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      if (!Object.prototype.hasOwnProperty.call(byPlc, tag)) return prev;
      const nextByPlc = { ...byPlc };
      delete nextByPlc[tag];
      return { ...(prev || {}), [chatKey]: nextByPlc };
    });
    setCodeGenIoNameDraftByPlc((prev) => {
      const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      if (!Object.prototype.hasOwnProperty.call(byPlc, tag)) return prev;
      const nextByPlc = { ...byPlc };
      delete nextByPlc[tag];
      return { ...(prev || {}), [chatKey]: nextByPlc };
    });
    setCodeGenIoTypeByPlc((prev) => {
      const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      if (!Object.prototype.hasOwnProperty.call(byPlc, tag)) return prev;
      const nextByPlc = { ...byPlc };
      delete nextByPlc[tag];
      return { ...(prev || {}), [chatKey]: nextByPlc };
    });
  };

  const upsertCodeGenTagMetaList = (tagRaw, field, updater) => {
    const tag = normalizeCodeGenTag(tagRaw);
    const key = String(field || "").trim();
    if (!tag || !key) return;
    setCodeGenTagMetaByPlc((prev) => {
      const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const existing = current?.[tag] && typeof current[tag] === "object" ? current[tag] : {};
      const base = Array.isArray(existing?.[key]) ? existing[key] : [];
      const nextListRaw = typeof updater === "function" ? updater(base) : base;
      const nextList = Array.from(new Set((Array.isArray(nextListRaw) ? nextListRaw : []).map((v) => String(v || "").trim()).filter(Boolean)));
      const nextEntry = { ...existing };
      if (nextList.length) nextEntry[key] = nextList;
      else delete nextEntry[key];
      if (!Object.keys(nextEntry).length) {
        if (!Object.prototype.hasOwnProperty.call(current, tag)) return prev;
        const nextMeta = { ...current };
        delete nextMeta[tag];
        return { ...(prev || {}), [chatKey]: nextMeta };
      }
      return { ...(prev || {}), [chatKey]: { ...current, [tag]: nextEntry } };
    });
  };

  const upsertCodeGenTagMetaIoDefs = (tagRaw, field, updater) => {
    const tag = normalizeCodeGenTag(tagRaw);
    const key = String(field || "").trim();
    if (!tag || !key) return;
    setCodeGenTagMetaByPlc((prev) => {
      const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const existing = current?.[tag] && typeof current[tag] === "object" ? current[tag] : {};
      const base = Array.isArray(existing?.[key]) ? existing[key] : [];
      const nextRaw = typeof updater === "function" ? updater(base) : base;
      const next = Array.from(
        new Set(
          (Array.isArray(nextRaw) ? nextRaw : [])
            .map((entry) => {
              const name = String(entry?.name || "").trim();
              const address = String(entry?.address || "").trim();
              if (!address) return "";
              return `${name}|||${address}`;
            })
            .filter(Boolean)
        )
      )
        .map((row) => {
          const [name = "", address = ""] = String(row || "").split("|||");
          return { name, address };
        })
        .filter((entry) => String(entry?.address || "").trim());
      const nextEntry = { ...existing };
      if (next.length) nextEntry[key] = next;
      else delete nextEntry[key];
      if (!Object.keys(nextEntry).length) {
        if (!Object.prototype.hasOwnProperty.call(current, tag)) return prev;
        const nextMeta = { ...current };
        delete nextMeta[tag];
        return { ...(prev || {}), [chatKey]: nextMeta };
      }
      return { ...(prev || {}), [chatKey]: { ...current, [tag]: nextEntry } };
    });
  };

  const addCodeGenTagIoValue = (tagRaw, field, valueRaw, nameRaw = "") => {
    const address = String(valueRaw || "").trim();
    const name = String(nameRaw || "").trim();
    if (!address) return;
    upsertCodeGenTagMetaIoDefs(tagRaw, field, (base) => [...base, { name, address }]);
  };

  const removeCodeGenTagIoValue = (tagRaw, field, valueRaw, nameRaw = "") => {
    const address = String(valueRaw || "").trim();
    const name = String(nameRaw || "").trim();
    if (!address) return;
    upsertCodeGenTagMetaIoDefs(tagRaw, field, (base) =>
      base.filter((entry) => {
        const entryAddress = String(entry?.address || "").trim();
        const entryName = String(entry?.name || "").trim();
        return !(entryAddress === address && entryName === name);
      })
    );
  };

  const updateCodeGenTagEquipment = (tagRaw, equipmentTypeRaw) => {
    const equipmentType = String(equipmentTypeRaw || "").trim();
    if (equipmentType) {
      setCodeGenEquipmentTypesByPlc((prev) => {
        const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
        if (current.includes(equipmentType)) return prev;
        return { ...(prev || {}), [chatKey]: [...current, equipmentType].sort((a, b) => a.localeCompare(b)) };
      });
    }
    updateCodeGenTagMetaField(tagRaw, "equipmentType", equipmentType);
  };

  const toggleCodeGenTagExpanded = (tagRaw) => {
    const tag = normalizeCodeGenTag(tagRaw);
    if (!tag) return;
    setCodeGenExpandedTagsByPlc((prev) => {
      const current = new Set(Array.isArray(prev?.[chatKey]) ? prev[chatKey] : []);
      if (current.has(tag)) current.delete(tag);
      else current.add(tag);
      return { ...(prev || {}), [chatKey]: Array.from(current) };
    });
  };

  const toggleCodeGenGroupExpanded = (groupId) => {
    const id = String(groupId || "").trim();
    if (!id) return;
    setCodeGenExpandedGroupsByPlc((prev) => {
      const current = new Set(Array.isArray(prev?.[chatKey]) ? prev[chatKey] : []);
      if (current.has(id)) current.delete(id);
      else current.add(id);
      return { ...(prev || {}), [chatKey]: Array.from(current) };
    });
  };

  const createCodeGenGroup = async () => {
    const rawName = String(codeGenGroupNameDraft || "").trim();
    const groupType = normalizeCodeGenGroupType(codeGenGroupTypeDraft);
    const draftType = String(groupType || "").trim().toLowerCase();
    const isNumericListType =
      draftType === "route" ||
      draftType === "group" ||
      draftType === "subroute" ||
      draftType === "sender" ||
      draftType === "receiver" ||
      draftType === "bin";
    const requiredNameMessage =
      draftType === "subroute"
        ? "Enter subroute number(s) (example: 1,3,5-7)."
        : draftType === "sender"
          ? "Enter sender number(s) (example: 1,3,5-7)."
          : draftType === "receiver"
            ? "Enter receiver number(s) (example: 1,3,5-7)."
            : draftType === "bin"
              ? "Enter bin number(s) (example: 1,3,5-7)."
              : draftType === "route"
                ? "Enter route number(s) (example: 1,3,5-7)."
                : draftType === "group"
                  ? "Enter group number(s) (example: 1,3,5-7)."
                  : "Enter a group name.";
    if (!rawName) {
      toastInfo(requiredNameMessage);
      return;
    }
    const groupSubType = groupType === "Group" ? String(codeGenGroupSubTypeDraft || "Feed").trim() : "";
    if (!isNumericListType && !normalizeCodeGenGroupObjectName(rawName, groupType, groupSubType)) {
      toastInfo(requiredNameMessage);
      return;
    }
    const parentId = String(codeGenGroupParentDraft || "").trim();
    const parentGroup = codeGenGroups.find((g) => String(g?.id || "") === parentId) || null;
    const parentType = normalizeCodeGenGroupType(parentGroup?.groupType).toLowerCase();
    const findRouteAncestorId = (startParentId) => {
      const byId = new Map(codeGenGroups.map((g) => [String(g?.id || "").trim(), g]));
      let cursorId = String(startParentId || "").trim();
      let guard = 0;
      while (cursorId && guard < 200) {
        const cursor = byId.get(cursorId);
        if (!cursor) break;
        if (String(cursor?.groupType || "").trim().toLowerCase() === "route") return cursorId;
        cursorId = String(cursor?.parentId || "").trim();
        guard += 1;
      }
      return "";
    };
    if (draftType === "route" && parentId) {
      toastInfo("Route can only be added at the top level.");
      return;
    }
    if (draftType === "subroute" || draftType === "sender" || draftType === "receiver" || draftType === "group") {
      if (parentType !== "route") {
        toastInfo("SubRoute, Sender, Receiver, and Group can only be added under Route.");
        return;
      }
    } else if (draftType !== "route") {
      if (!parentId || !findRouteAncestorId(parentId)) {
        toastInfo("Only Route objects can exist at the top level.");
        return;
      }
    }
    const namesToCreate = (() => {
      if (isNumericListType) {
        const numbers = expandSubRouteNumberInput(rawName);
        if (!numbers.length) return [];
        if (draftType === "subroute") {
          const routeName = String(parentGroup?.name || "").trim();
          return numbers.map((n) => normalizeCodeGenSubRouteObjectName(String(n), routeName)).filter(Boolean);
        }
        return numbers
          .map((n) => normalizeCodeGenGroupObjectName(String(n), groupType, groupSubType))
          .filter(Boolean);
      }
      return [normalizeCodeGenGroupObjectName(rawName, groupType, groupSubType)];
    })();
    if (!namesToCreate.length) {
      toastInfo(requiredNameMessage);
      return;
    }
    if (draftType === "subroute") {
        const routeName = String(parentGroup?.name || "").trim();
        if (!routeName) {
          toastInfo("SubRoute requires a Route parent.");
          return;
        }
      }
    const existing = new Set(
      codeGenGroups.map((g) => String(g?.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const inBatch = new Set();
    for (const name of namesToCreate) {
      const key = String(name || "").trim().toLowerCase();
      if (!key) continue;
      if (existing.has(key) || inBatch.has(key)) {
        toastInfo(`Object "${name}" already exists. Names must be unique.`);
        return;
      }
      inBatch.add(key);
    }
    const nextGroups = namesToCreate.map((name, idx) => ({
      id: `grp_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      parentId,
      groupType,
      ...(groupSubType ? { groupSubType } : {}),
      description: "",
      ...(draftType === "bin" ? { binNumber: extractCodeGenBinNumber(name) } : {}),
      tags: [],
      dbId: "",
      routeDbId: "",
      dbSyncState: "pending",
    }));
    updateCodeGenGroups((curr) => [...curr, ...nextGroups]);
    setCodeGenExpandedGroupsByPlc((prev) => {
      const current = new Set(Array.isArray(prev?.[chatKey]) ? prev[chatKey] : []);
      nextGroups.forEach((g) => current.add(String(g?.id || "")));
      return { ...(prev || {}), [chatKey]: Array.from(current) };
    });
    setCodeGenGroupNameDraft("");
    const createdKindMany = getCodeGenObjectKindLabel(draftType, nextGroups.length);
    toastInfo(
      nextGroups.length > 1
        ? `Created ${nextGroups.length} ${createdKindMany} locally. Saving to Route DB...`
        : `Created group "${nextGroups[0]?.name || ""}" locally. Saving to Route DB...`
    );
    const parentDbIdRaw = parentGroup?.dbId;
    const parentDbId = Number(parentDbIdRaw);
    const projectId = String(selected?.id || "").trim();
    let failed = 0;
    for (let i = 0; i < nextGroups.length; i += 1) {
      const nextGroup = nextGroups[i];
      const name = String(nextGroup?.name || "").trim();
      try {
        const dbGroupName = name.slice(0, 50);
        const payload = {
          groupname: dbGroupName,
          grouptype: groupType === "Group" ? groupSubType || "Feed" : groupType,
          description: "",
          enabled: true,
          sortorder: codeGenGroups.length + i + 1,
        };
        if (Number.isFinite(parentDbId) && parentDbId > 0) {
          payload.groupid = Math.trunc(parentDbId);
        }
        const res = await fetch("/api/db/route_bin_group", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(data?.error || "Failed to create Route DB group."));
        const row = data?.row && typeof data.row === "object" ? data.row : {};
        const dbId = Number(row?.id);
        let routeDbId = "";
        if (groupType === "Route") {
          const routeNumber = extractCodeGenRouteNumber(name);
          const routeRes = await fetch("/api/db/route", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              route_id: name,
              route_number: routeNumber,
              state: "",
              route_color: "",
              project_id: projectId || null,
            }),
          });
          const routeData = await routeRes.json().catch(() => ({}));
          if (!routeRes.ok) throw new Error(String(routeData?.error || "Failed to create route row."));
          const routeRow = routeData?.row && typeof routeData.row === "object" ? routeData.row : {};
          const routeDbIdNum = Number(routeRow?.id);
          routeDbId = Number.isFinite(routeDbIdNum) && routeDbIdNum > 0 ? String(routeDbIdNum) : "";
        }
        updateCodeGenGroups((curr) =>
          curr.map((g) =>
            String(g?.id || "") === String(nextGroup?.id || "")
              ? {
                  ...g,
                  dbId: Number.isFinite(dbId) && dbId > 0 ? String(dbId) : "",
                  ...(routeDbId ? { routeDbId } : {}),
                  dbSyncState: "ok",
                }
              : g
          )
        );
      } catch (err) {
        failed += 1;
        const message = String(err?.message || "Route DB group create failed.");
        updateCodeGenGroups((curr) =>
          curr.map((g) =>
            String(g?.id || "") === String(nextGroup?.id || "")
              ? { ...g, dbSyncState: "error", dbError: message }
              : g
          )
        );
        toastError(`Created "${name}" locally. Database sync failed: ${message}`);
      }
    }
    if (failed === 0) {
      const savedKindMany = getCodeGenObjectKindLabel(draftType, nextGroups.length);
      toastSuccess(
        nextGroups.length > 1
          ? `Created and saved ${nextGroups.length} ${savedKindMany}.`
          : `Created group "${nextGroups[0]?.name || ""}" and saved to Route DB.`
      );
    }
  };

  const deleteCodeGenGroup = (groupId) => {
    const id = String(groupId || "").trim();
    if (!id) return;
    updateCodeGenGroups((curr) => {
      const byParent = new Map();
      curr.forEach((g) => {
        const key = String(g?.parentId || "");
        if (!byParent.has(key)) byParent.set(key, []);
        byParent.get(key).push(String(g?.id || ""));
      });
      const removeSet = new Set([id]);
      const stack = [id];
      while (stack.length) {
        const current = stack.pop();
        const children = byParent.get(String(current || "")) || [];
        children.forEach((childId) => {
          if (!removeSet.has(childId)) {
            removeSet.add(childId);
            stack.push(childId);
          }
        });
      }
      const next = curr.filter((g) => !removeSet.has(String(g?.id || "")));
      return next;
    });
    setCodeGenExpandedGroupsByPlc((prev) => {
      const current = new Set(Array.isArray(prev?.[chatKey]) ? prev[chatKey] : []);
      current.delete(id);
      return { ...(prev || {}), [chatKey]: Array.from(current) };
    });
    toastSuccess("Group deleted.");
  };

  const duplicateCodeGenGroupTree = (groupIdRaw) => {
    const sourceId = String(groupIdRaw || "").trim();
    if (!sourceId) return;
    let duplicatedRootId = "";
    let duplicatedRootName = "";
    let originalName = "";
    updateCodeGenGroups((curr) => {
      const byId = new Map(curr.map((g) => [String(g?.id || "").trim(), g]));
      const source = byId.get(sourceId) || null;
      if (!source) return curr;
      const childrenByParent = new Map();
      curr.forEach((g) => {
        const key = String(g?.parentId || "").trim();
        if (!childrenByParent.has(key)) childrenByParent.set(key, []);
        childrenByParent.get(key).push(g);
      });
      const sourceParentId = String(source?.parentId || "").trim();
      const sourceName = String(source?.name || "").trim();
      originalName = sourceName || "Object";
      const siblingNames = curr
        .filter((g) => String(g?.parentId || "").trim() === sourceParentId)
        .map((g) => String(g?.name || "").trim())
        .filter(Boolean);
      const siblingNameSet = new Set(siblingNames.map((n) => n.toLowerCase()));
      const withTrailingNumber = sourceName.match(/^(.*?)(\d+)$/);
      let nextRootName = "";
      if (withTrailingNumber) {
        const base = String(withTrailingNumber[1] || "");
        const sourceNum = Number(withTrailingNumber[2] || "0");
        let nextNum = Number.isFinite(sourceNum) ? sourceNum + 1 : 2;
        let candidate = `${base}${nextNum}`;
        while (siblingNameSet.has(candidate.toLowerCase())) {
          nextNum += 1;
          candidate = `${base}${nextNum}`;
        }
        nextRootName = candidate;
      } else {
        let index = 2;
        let candidate = `${sourceName || "Object"}${index}`;
        while (siblingNameSet.has(candidate.toLowerCase())) {
          index += 1;
          candidate = `${sourceName || "Object"}${index}`;
        }
        nextRootName = candidate;
      }
      const created = [];
      const nextExpandedIds = [];
      const makeId = () => `grp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const cloneNode = (node, nextParentId, isRoot) => {
        const oldId = String(node?.id || "").trim();
        const newId = makeId();
        const nextName = isRoot ? nextRootName : String(node?.name || "").trim();
        const cleanTags = Array.from(
          new Set((Array.isArray(node?.tags) ? node.tags : []).map((x) => String(x || "").trim()).filter(Boolean))
        );
        const clone = {
          ...node,
          id: newId,
          name: nextName,
          parentId: nextParentId,
          tags: cleanTags,
          dbId: "",
          routeDbId: "",
          dbSyncState: "pending",
        };
        delete clone.dbError;
        created.push(clone);
        nextExpandedIds.push(newId);
        (childrenByParent.get(oldId) || []).forEach((child) => cloneNode(child, newId, false));
        return newId;
      };
      duplicatedRootId = cloneNode(source, sourceParentId, true);
      duplicatedRootName = nextRootName;
      setCodeGenExpandedGroupsByPlc((prev) => {
        const current = new Set(Array.isArray(prev?.[chatKey]) ? prev[chatKey] : []);
        nextExpandedIds.forEach((id) => current.add(String(id || "").trim()));
        return { ...(prev || {}), [chatKey]: Array.from(current) };
      });
      return [...curr, ...created];
    });
    if (!duplicatedRootId) {
      toastInfo("Could not duplicate object.");
      return;
    }
    setCodeGenSelectedGroupId(duplicatedRootId);
    setCodeGenGroupParentDraft(duplicatedRootId);
    setCodeGenSelectedTagByPlc((prev) => ({ ...(prev || {}), [chatKey]: "" }));
    toastSuccess(`Duplicated "${originalName}" as "${duplicatedRootName}".`);
  };

  const renameCodeGenGroup = (groupId, nextNameRaw) => {
    const id = String(groupId || "").trim();
    const nextName = String(nextNameRaw || "").trim();
    if (!id || !nextName) return;
    updateCodeGenGroups((curr) =>
      curr.map((g) => (String(g?.id || "") === id ? { ...g, name: nextName } : g))
    );
  };

  const setCodeGenGroupType = (groupId, nextTypeRaw) => {
    const id = String(groupId || "").trim();
    if (!id) return;
    const nextType = normalizeCodeGenGroupType(nextTypeRaw);
    updateCodeGenGroups((curr) =>
      curr.map((g) =>
        String(g?.id || "") === id
          ? {
              ...g,
              groupType: nextType,
              ...(nextType === "Group" ? {} : { groupSubType: "" }),
              ...(nextType === "Bin"
                ? { binNumber: String(g?.binNumber || extractCodeGenBinNumber(g?.name || "")).trim() }
                : { binNumber: "" }),
            }
          : g
      )
    );
  };

  const saveCodeGenSelectedGroupDetails = () => {
    const id = String(codeGenSelectedGroupId || "").trim();
    if (!id) return;
    const currentGroup = codeGenGroups.find((g) => String(g?.id || "").trim() === id) || null;
    const nextType = normalizeCodeGenGroupType(codeGenDetailTypeDraft);
    const nextSubType = nextType === "Group" ? String(codeGenDetailSubTypeDraft || "Feed").trim() : "";
    const nextBinNumber = nextType === "Bin" ? String(codeGenDetailBinNumberDraft || "").replace(/\D+/g, "") : "";
    const nextDescription = String(codeGenDetailDescriptionDraft || "").trim();
    const currentParentId = String(currentGroup?.parentId || "").trim();
    const currentParentGroup = codeGenGroups.find((g) => String(g?.id || "").trim() === currentParentId) || null;
    const nextName =
      String(nextType || "").trim().toLowerCase() === "subroute"
        ? normalizeCodeGenSubRouteObjectName(
            String(codeGenDetailNameDraft || "").trim(),
            String(currentParentGroup?.name || "").trim()
          )
        : String(nextType || "").trim().toLowerCase() === "bin"
          ? normalizeCodeGenGroupObjectName(nextBinNumber, nextType, nextSubType)
        : normalizeCodeGenGroupObjectName(String(codeGenDetailNameDraft || "").trim(), nextType, nextSubType);
    if (!nextName) {
      const nextTypeLower = String(nextType || "").trim().toLowerCase();
      toastInfo(
        nextTypeLower === "subroute"
          ? "SubRoute number is required."
          : nextTypeLower === "sender"
            ? "Sender number is required."
            : nextTypeLower === "receiver"
              ? "Receiver number is required."
              : nextTypeLower === "bin"
                ? "Bin number is required."
                : "Group name is required."
      );
      return;
    }
    if (
      codeGenGroups.some(
        (g) =>
          String(g?.id || "").trim() !== id &&
          String(g?.name || "").trim().toLowerCase() === nextName.toLowerCase()
      )
    ) {
      toastInfo(`Object "${nextName}" already exists. Names must be unique.`);
      return;
    }
    renameCodeGenGroup(id, nextName);
    setCodeGenGroupType(id, nextType);
    updateCodeGenGroups((curr) =>
      curr.map((g) =>
        String(g?.id || "") === id
          ? {
              ...g,
              groupSubType: nextSubType,
              description: nextDescription,
              ...(nextType === "Bin" ? { binNumber: nextBinNumber } : { binNumber: "" }),
            }
          : g
      )
    );
    if (nextType === "Bin") {
      setCodeGenDetailBinNumberDraft(nextBinNumber);
    }
    setCodeGenDetailNameDraft(nextName);
    toastSuccess("Group details saved.");
  };
  const cancelCodeGenSelectedGroupDetails = () => {
    const id = String(codeGenSelectedGroupId || "").trim();
    if (!id) return;
    const selected = codeGenGroups.find((g) => String(g?.id || "").trim() === id) || null;
    if (!selected) return;
    setCodeGenDetailNameDraft(String(selected?.name || ""));
    setCodeGenDetailTypeDraft(normalizeCodeGenGroupType(selected?.groupType));
    setCodeGenDetailSubTypeDraft(String(selected?.groupSubType || "Feed"));
    setCodeGenDetailBinNumberDraft(
      normalizeCodeGenGroupType(selected?.groupType) === "Bin"
        ? String(selected?.binNumber || extractCodeGenBinNumber(selected?.name || ""))
        : ""
    );
    setCodeGenDetailDescriptionDraft(String(selected?.description || ""));
    setCodeGenDetailEditByPlc((prev) => ({ ...(prev || {}), [chatKey]: false }));
  };

  const moveTagToGroup = (tagRaw, targetGroupIdRaw) => {
    const tag = String(tagRaw || "").trim();
    const targetGroupId = String(targetGroupIdRaw || "").trim();
    if (!tag || !targetGroupId) return;
    const target = codeGenGroups.find((g) => String(g?.id || "") === targetGroupId) || null;
    if (!target || normalizeCodeGenGroupType(target?.groupType) !== "Group") {
      toastInfo("Tags can only be dropped on Group objects.");
      return;
    }
    updateCodeGenGroups((curr) =>
      curr.map((g) => {
        const groupId = String(g?.id || "");
        const baseTags = Array.isArray(g?.tags) ? g.tags.map((x) => String(x || "").trim()).filter(Boolean) : [];
        const withoutTag = baseTags.filter((x) => x !== tag);
        if (groupId !== targetGroupId) return { ...g, tags: withoutTag };
        return { ...g, tags: Array.from(new Set([...withoutTag, tag])) };
      })
    );
    toastSuccess(`Assigned ${tag} to group.`);
  };

  const reorderCodeGenGroup = (dragGroupIdRaw, targetGroupIdRaw) => {
    const dragGroupId = String(dragGroupIdRaw || "").trim();
    const targetGroupId = String(targetGroupIdRaw || "").trim();
    if (!dragGroupId || !targetGroupId || dragGroupId === targetGroupId) return;
    updateCodeGenGroups((curr) => {
      const dragIndex = curr.findIndex((g) => String(g?.id || "") === dragGroupId);
      const targetIndex = curr.findIndex((g) => String(g?.id || "") === targetGroupId);
      if (dragIndex < 0 || targetIndex < 0) return curr;
      const dragGroup = curr[dragIndex];
      const targetGroup = curr[targetIndex];
      const targetParentId = String(targetGroup?.parentId || "").trim();
      const currentParentId = String(dragGroup?.parentId || "").trim();
      const sameParentMove = currentParentId === targetParentId;
      const byId = new Map(curr.map((g) => [String(g?.id || "").trim(), g]));
      const dragType = normalizeCodeGenGroupType(dragGroup?.groupType).toLowerCase();
      const findRouteAncestorId = (startParentId) => {
        let cursorId = String(startParentId || "").trim();
        let guard = 0;
        while (cursorId && guard < 200) {
          const cursor = byId.get(cursorId);
          if (!cursor) break;
          if (String(cursor?.groupType || "").trim().toLowerCase() === "route") return cursorId;
          cursorId = String(cursor?.parentId || "").trim();
          guard += 1;
        }
        return "";
      };
      const targetParent = targetParentId ? byId.get(targetParentId) || null : null;
      const targetParentType = normalizeCodeGenGroupType(targetParent?.groupType).toLowerCase();
      if (!sameParentMove && (dragType === "subroute" || dragType === "sender" || dragType === "receiver" || dragType === "group")) {
        if (targetParentType !== "route") {
          toastInfo("SubRoute, Sender, Receiver, and Group can only be moved under Route.");
          return curr;
        }
      }
      if (!sameParentMove && String(dragGroup?.groupType || "").trim().toLowerCase() !== "route") {
        const routeAncestorId = findRouteAncestorId(targetParentId);
        if (!routeAncestorId) {
          toastInfo("Only Route objects can exist at the top level.");
          return curr;
        }
      }
      let cursorId = targetParentId;
      let guard = 0;
      while (cursorId && guard < 200) {
        if (cursorId === dragGroupId) return curr;
        const cursor = byId.get(cursorId);
        cursorId = String(cursor?.parentId || "").trim();
        guard += 1;
      }
      const withParent = curr.map((g) =>
        String(g?.id || "") === dragGroupId ? { ...g, parentId: targetParentId } : g
      );
      const currentIndex = withParent.findIndex((g) => String(g?.id || "") === dragGroupId);
      const [moved] = withParent.splice(currentIndex, 1);
      const targetIndexAfterRemove = withParent.findIndex((g) => String(g?.id || "") === targetGroupId);
      if (targetIndexAfterRemove < 0) return curr;
      withParent.splice(targetIndexAfterRemove, 0, moved);
      return withParent;
    });
  };

  const reorderCodeGenGroupToParentEnd = (dragGroupIdRaw, parentIdRaw) => {
    const dragGroupId = String(dragGroupIdRaw || "").trim();
    const parentId = String(parentIdRaw || "").trim();
    if (!dragGroupId) return;
    updateCodeGenGroups((curr) => {
      const dragIndex = curr.findIndex((g) => String(g?.id || "") === dragGroupId);
      if (dragIndex < 0) return curr;
      const dragGroup = curr[dragIndex];
      const currentParentId = String(dragGroup?.parentId || "").trim();
      const sameParentMove = currentParentId === parentId;
      const byId = new Map(curr.map((g) => [String(g?.id || "").trim(), g]));
      const dragType = normalizeCodeGenGroupType(dragGroup?.groupType).toLowerCase();
      const findRouteAncestorId = (startParentId) => {
        let cursorId = String(startParentId || "").trim();
        let guard = 0;
        while (cursorId && guard < 200) {
          const cursor = byId.get(cursorId);
          if (!cursor) break;
          if (String(cursor?.groupType || "").trim().toLowerCase() === "route") return cursorId;
          cursorId = String(cursor?.parentId || "").trim();
          guard += 1;
        }
        return "";
      };
      const parentGroup = parentId ? byId.get(parentId) || null : null;
      const parentType = normalizeCodeGenGroupType(parentGroup?.groupType).toLowerCase();
      if (!sameParentMove && (dragType === "subroute" || dragType === "sender" || dragType === "receiver" || dragType === "group")) {
        if (parentType !== "route") {
          toastInfo("SubRoute, Sender, Receiver, and Group can only be moved under Route.");
          return curr;
        }
      }
      if (!sameParentMove && String(dragGroup?.groupType || "").trim().toLowerCase() !== "route") {
        const routeAncestorId = findRouteAncestorId(parentId);
        if (!routeAncestorId) {
          toastInfo("Only Route objects can exist at the top level.");
          return curr;
        }
      }
      let cursorId = parentId;
      let guard = 0;
      while (cursorId && guard < 200) {
        if (cursorId === dragGroupId) return curr;
        const cursor = byId.get(cursorId);
        cursorId = String(cursor?.parentId || "").trim();
        guard += 1;
      }
      const withParent = curr.map((g) =>
        String(g?.id || "") === dragGroupId ? { ...g, parentId } : g
      );
      const currentIndex = withParent.findIndex((g) => String(g?.id || "") === dragGroupId);
      const [moved] = withParent.splice(currentIndex, 1);
      withParent.push(moved);
      return withParent;
    });
  };

  const removeTagFromGroup = (tagRaw, groupIdRaw) => {
    const tag = String(tagRaw || "").trim();
    const groupId = String(groupIdRaw || "").trim();
    if (!tag || !groupId) return;
    updateCodeGenGroups((curr) =>
      curr.map((g) => {
        if (String(g?.id || "") !== groupId) return g;
        const baseTags = Array.isArray(g?.tags) ? g.tags.map((x) => String(x || "").trim()).filter(Boolean) : [];
        return { ...g, tags: baseTags.filter((x) => x !== tag) };
      })
    );
  };

  const moveTagToUngrouped = (tagRaw) => {
    const tag = String(tagRaw || "").trim();
    if (!tag) return;
    updateCodeGenGroups((curr) =>
      curr.map((g) => {
        const baseTags = Array.isArray(g?.tags) ? g.tags.map((x) => String(x || "").trim()).filter(Boolean) : [];
        return { ...g, tags: baseTags.filter((x) => x !== tag) };
      })
    );
    toastSuccess(`Removed ${tag} from groups.`);
  };

  useEffect(() => {
    const node = chatScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chatKey, chatMessages.length]);

  useEffect(() => {
    if (!(activePendingChoice && activePendingChoice?.type === "members" && Array.isArray(activePendingChoice?.options))) {
      setMemberPickerSelectionByPlc((prev) => ({ ...prev, [chatKey]: [] }));
      return;
    }
    const options = activePendingChoice.options
      .map((opt) => String(opt?.fullTag || "").trim())
      .filter(Boolean);
    setMemberPickerSelectionByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const keep = current.filter((name) => options.includes(name));
      return { ...prev, [chatKey]: keep };
    });
  }, [activePendingChoice, chatKey]);

  useEffect(() => {
    if (activeTab !== "ai") return;
    let alive = true;
    let timerId = null;
    const loadOpcConnections = async () => {
      if (!alive) return;
      setOpcConnectionsLoading(true);
      try {
        const res = await fetch("/api/opc/status", { credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(data?.error || "Failed to load OPC status."));
        const map =
          data?.connections && typeof data.connections === "object"
            ? data.connections
            : data?.status?.connections && typeof data.status.connections === "object"
              ? data.status.connections
              : {};
        const list = Object.entries(map)
          .map(([name, connected]) => ({
            name: String(name || "").trim() || "PLC",
            connected: connected === true,
          }))
          .filter((row) => row.name)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!alive) return;
        setOpcConnections(list);
        setOpcConnectionsAt(Date.now());
        setOpcConnectionsError("");
      } catch (err) {
        if (!alive) return;
        setOpcConnectionsError(String(err?.message || "Failed to load OPC status."));
      } finally {
        if (alive) setOpcConnectionsLoading(false);
      }
    };
    loadOpcConnections();
    timerId = setInterval(loadOpcConnections, 5000);
    return () => {
      alive = false;
      if (timerId) clearInterval(timerId);
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "ai" || !selected) return;
    if (debugSessionId) return;
    let cancelled = false;
    const createDebugSession = async () => {
      setDebugSessionLoading(true);
      setDebugSessionError("");
      try {
        const controllerTags = getSelectedControllerTags()
          .map((t) => String(t?.name || t?.tagPath || "").trim())
          .filter(Boolean)
          .slice(0, 800);
        const routineHints = (Array.isArray(analysis?.sections) ? analysis.sections : [])
          .filter((row) => String(row?.label || "").toLowerCase().includes("routine"))
          .flatMap((row) => (Array.isArray(row?.names) ? row.names : []))
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 50);
        let lastErr = "";
        let session = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const res = await fetch("/api/ai/plc-debug-sessions", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              plcName: String(selected?.name || "PLC"),
              controllerTags,
              routineHints,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok) {
            session = data?.session && typeof data.session === "object" ? data.session : null;
            break;
          }
          lastErr = String(data?.error || `HTTP ${res.status}`);
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
        if (!session) throw new Error(lastErr || "Failed to start live debug session.");
        const id = String(session?.id || "").trim();
        if (!id || cancelled) return;
        setDebugSessionByPlc((prev) => ({ ...prev, [chatKey]: id }));
        setDebugSnapshotByPlc((prev) => ({ ...prev, [chatKey]: session?.snapshot || null }));
        updateSelectedPlc((item) => ({ ...item, debugSessionId: id }));
      } catch (err) {
        if (!cancelled) {
          const raw = String(err?.message || "Failed to start live debug session.");
          const friendly =
            /404|failed to fetch|network|route|not found/i.test(raw)
              ? "Live debug service is unavailable. Restart App server and app dev services, then reopen PLC AI tab."
              : raw;
          setDebugSessionError(friendly);
        }
      } finally {
        if (!cancelled) setDebugSessionLoading(false);
      }
    };
    void createDebugSession();
    return () => {
      cancelled = true;
    };
  }, [activeTab, selected, chatKey, debugSessionId]);

  useEffect(() => {
    if (activeTab !== "ai") return;
    if (!debugSessionId) return;
    let cancelled = false;
    const loadSnapshot = async () => {
      try {
        const res = await fetch(`/api/ai/plc-debug-sessions/${encodeURIComponent(debugSessionId)}`, {
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(data?.error || "Failed to load live debug session."));
        const snapshot = data?.session?.snapshot || null;
        if (cancelled) return;
        setDebugSnapshotByPlc((prev) => ({ ...prev, [chatKey]: snapshot }));
        setDebugSessionError("");
      } catch (err) {
        if (!cancelled) setDebugSessionError(String(err?.message || "Failed to load live debug session."));
      }
    };
    void loadSnapshot();
    const timer = setInterval(loadSnapshot, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeTab, debugSessionId, chatKey]);

  const sendChat = async () => {
    const text = String(chatPrompt || "").trim();
    if (!text || !selected) return;
    setChatError("");
    setOpcApplyError("");
    setOpcApplyStatus("");
    const nextMessages = [...chatMessages, { role: "user", content: text }];
    setChatMessages(nextMessages);
    setChatPrompt("");
    setChatLoading(true);
    try {
      const pendingChoice = pendingOpcChoiceByPlc?.[chatKey];
      const applyPendingMembers = async (selectedMembers, sourceText = text) => {
        const selectedTagRows = buildTagRowsFromMembers(selectedMembers);
        const planned = {
          ...(pendingChoice?.plan && typeof pendingChoice.plan === "object" ? pendingChoice.plan : {}),
          tags: selectedTagRows,
          tagCount: selectedTagRows.length,
        };
        const activeNames = opcConnections
          .filter((row) => row?.connected === true)
          .map((row) => String(row?.name || "").trim())
          .filter(Boolean);
        const mentioned = findMentionedOpcConnection(sourceText, activeNames);
        if (!mentioned && activeNames.length > 1) {
          setPendingOpcChoiceByPlc((prev) => ({
            ...prev,
            [chatKey]: { type: "connection", options: activeNames, plan: planned },
          }));
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Which OPC connection should I use? ${activeNames.join(", ")}` },
          ]);
          return;
        }
        let finalPlan = planned;
        if (mentioned) {
          finalPlan = { ...planned, plcName: mentioned };
        } else if (activeNames.length === 1) {
          finalPlan = {
            ...planned,
            plcName: planned?.plcName || activeNames[0],
          };
        }
        setPendingOpcChoiceByPlc((prev) => ({ ...prev, [chatKey]: null }));
        setMemberPickerSelectionByPlc((prev) => ({ ...prev, [chatKey]: [] }));
        const applyResult = await applyOpcConnection({ promptOverride: sourceText, planOverride: finalPlan });
        if (applyResult.ok) {
          setChatMessages((prev) => [...prev, { role: "assistant", content: applyResult.message }]);
        } else if (applyResult.handled) {
          return;
        } else {
          setChatError(applyResult.error || "Failed to apply OPC setup.");
          setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${applyResult.error}` }]);
        }
      };
      if (
        pendingChoice &&
        pendingChoice?.type === "members" &&
        Array.isArray(pendingChoice?.options) &&
        pendingChoice.options.length
      ) {
        const selectedMembers = parseSelectedMembers(text, pendingChoice.options);
        if (!selectedMembers.length) {
          const preview = pendingChoice.options.slice(0, 20);
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                `I did not match any value members for ${pendingChoice.baseTag}. ` +
                `Reply with member names, numbers, or "all".\n` +
                preview.map((opt, i) => `${i + 1}. ${opt.member}`).join("\n"),
            },
          ]);
          return;
        }
        await applyPendingMembers(selectedMembers, text);
        return;
      }

      if (
        pendingChoice &&
        pendingChoice?.type === "connection" &&
        Array.isArray(pendingChoice?.options) &&
        pendingChoice.options.length
      ) {
        const chosen = findMentionedOpcConnection(text, pendingChoice.options);
        if (!chosen) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Pick one OPC connection name: ${pendingChoice.options.join(", ")}` },
          ]);
          return;
        }
        setPendingOpcChoiceByPlc((prev) => ({ ...prev, [chatKey]: null }));
        const planned = {
          ...(pendingChoice?.plan && typeof pendingChoice.plan === "object" ? pendingChoice.plan : {}),
          plcName: chosen,
        };
        if (pendingChoice?.action === "read") {
          const readResult = await executeReadMembersFlow({
            baseTag: String(pendingChoice?.baseTag || ""),
            members: Array.isArray(pendingChoice?.members) ? pendingChoice.members : [],
            promptText: text,
            planOverride: planned,
          });
          if (readResult.ok) {
            setChatMessages((prev) => [...prev, { role: "assistant", content: readResult.message }]);
          } else if (readResult.handled) {
            return;
          } else {
            setChatError(readResult.error || "Failed to read live PLC tags.");
            setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${readResult.error}` }]);
          }
        } else {
          const applyResult = await applyOpcConnection({ promptOverride: text, planOverride: planned });
          if (applyResult.ok) {
            setChatMessages((prev) => [...prev, { role: "assistant", content: applyResult.message }]);
          } else if (applyResult.handled) {
            return;
          } else {
            setChatError(applyResult.error || "Failed to apply OPC setup.");
            setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${applyResult.error}` }]);
          }
        }
        return;
      }

      if (
        pendingChoice &&
        pendingChoice?.type === "topic" &&
        Array.isArray(pendingChoice?.options) &&
        pendingChoice.options.length
      ) {
        const chosenTopic = findMentionedOption(text, pendingChoice.options);
        if (!chosenTopic) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Pick one topic name: ${pendingChoice.options.join(", ")}` },
          ]);
          return;
        }
        setPendingOpcChoiceByPlc((prev) => ({ ...prev, [chatKey]: null }));
        const planned = {
          ...(pendingChoice?.plan && typeof pendingChoice.plan === "object" ? pendingChoice.plan : {}),
          topic: chosenTopic,
        };
        const applyResult = await applyOpcConnection({ promptOverride: text, planOverride: planned });
        if (applyResult.ok) {
          setChatMessages((prev) => [...prev, { role: "assistant", content: applyResult.message }]);
        } else if (applyResult.handled) {
          return;
        } else {
          setChatError(applyResult.error || "Failed to apply OPC setup.");
          setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${applyResult.error}` }]);
        }
        return;
      }

      if (pendingChoice && pendingChoice?.type === "topicName") {
        const typedTopic = cleanRequestedTagName(text);
        if (!typedTopic) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Enter a topic name to create (example: PLC1)." },
          ]);
          return;
        }
        setPendingOpcChoiceByPlc((prev) => ({ ...prev, [chatKey]: null }));
        const planned = {
          ...(pendingChoice?.plan && typeof pendingChoice.plan === "object" ? pendingChoice.plan : {}),
          topic: typedTopic,
        };
        const applyResult = await applyOpcConnection({ promptOverride: text, planOverride: planned });
        if (applyResult.ok) {
          setChatMessages((prev) => [...prev, { role: "assistant", content: applyResult.message }]);
        } else if (applyResult.handled) {
          return;
        } else {
          setChatError(applyResult.error || "Failed to apply OPC setup.");
          setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${applyResult.error}` }]);
        }
        return;
      }

      const addTagMatch = text.match(/\badd\s+tag\s+(.+?)\s+to\s+opc\b/i);
      if (addTagMatch) {
        const allTags = getSelectedControllerTags();
        const requested = cleanRequestedTagName(addTagMatch[1]);
        const baseTag = resolveBaseTagName(requested, allTags);
        if (!baseTag) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `I could not find controller tag "${requested}" in the loaded PLC file.` },
          ]);
          return;
        }
        const members = buildMemberOptionsForTag(baseTag, allTags);
        if (!members.length) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Tag "${baseTag}" has no DataValueMember entries to add.` },
          ]);
          return;
        }
        const preview = members.slice(0, 25);
        setPendingOpcChoiceByPlc((prev) => ({
          ...prev,
          [chatKey]: {
            type: "members",
            baseTag,
            options: members,
            plan: opcPlan && typeof opcPlan === "object" ? opcPlan : {},
          },
        }));
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              `What value members do you want to add to OPC for ${baseTag}? ` +
              `Reply with names, numbers, or "all".\n` +
              preview.map((opt, i) => `${i + 1}. ${opt.member}`).join("\n"),
          },
        ]);
        return;
      }

      const readTagsMatch = text.match(/\bread\s+tags?\s+from\s+(.+)$/i);
      if (readTagsMatch) {
        const allTags = getSelectedControllerTags();
        const requested = cleanRequestedTagName(readTagsMatch[1]);
        const baseTag = resolveBaseTagName(requested, allTags);
        if (!baseTag) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `I could not find controller tag "${requested}" in the loaded PLC file.` },
          ]);
          return;
        }
        const members = buildMemberOptionsForTag(baseTag, allTags);
        if (!members.length) {
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Tag "${baseTag}" has no DataValueMember entries to read.` },
          ]);
          return;
        }
        const cappedMembers = members.slice(0, 60);
        const activeNames = opcConnections
          .filter((row) => row?.connected === true)
          .map((row) => String(row?.name || "").trim())
          .filter(Boolean);
        const mentioned = findMentionedOpcConnection(text, activeNames);
        const basePlan = opcPlan && typeof opcPlan === "object" ? opcPlan : {};
        if (!mentioned && activeNames.length > 1) {
          setPendingOpcChoiceByPlc((prev) => ({
            ...prev,
            [chatKey]: {
              type: "connection",
              action: "read",
              baseTag,
              members: cappedMembers,
              options: activeNames,
              plan: basePlan,
            },
          }));
          setChatMessages((prev) => [
            ...prev,
            { role: "assistant", content: `Which OPC connection should I use to read ${baseTag}? ${activeNames.join(", ")}` },
          ]);
          return;
        }
        let plan = basePlan;
        if (mentioned) {
          plan = { ...basePlan, plcName: mentioned };
        } else if (activeNames.length === 1) {
          plan = {
            ...basePlan,
            plcName: basePlan?.plcName || activeNames[0],
          };
        }
        const readResult = await executeReadMembersFlow({
          baseTag,
          members: cappedMembers,
          promptText: text,
          planOverride: plan,
        });
        if (readResult.ok) {
          setChatMessages((prev) => [...prev, { role: "assistant", content: readResult.message }]);
        } else if (readResult.handled) {
          return;
        } else {
          setChatError(readResult.error || "Failed to read live PLC tags.");
          setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${readResult.error}` }]);
        }
        return;
      }

      const hasSvgCatalog = Array.isArray(svgCatalog) && svgCatalog.length > 0;
      const wantsSvgRecommendation = hasSvgCatalog && detectSvgRecommendationIntent(text);
      if (wantsSvgRecommendation) {
        const svgRes = await fetch("/api/ai/plc-svg-suggest", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            history: nextMessages
              .slice(-10)
              .map((m) => ({
                role: String(m?.role || "user"),
                content: String(m?.content || ""),
              })),
            plc: {
              name: String(selected?.name || "PLC"),
              controllerTags: getSelectedControllerTags(),
            },
            svgCatalog: svgCatalog.slice(0, 450),
          }),
        });
        const svgData = await svgRes.json().catch(() => ({}));
        if (!svgRes.ok) {
          throw new Error(String(svgData?.error || "Failed to suggest SVG."));
        }
        const answer = String(svgData?.answer || "").trim();
        const pickedKey = String(svgData?.picked?.key || "").trim();
        const pickedName = String(svgData?.picked?.name || "").trim();
        const alternatives = Array.isArray(svgData?.alternatives) ? svgData.alternatives : [];
        const altLine = alternatives.length
          ? `\nAlternatives: ${alternatives
              .map((row) => String(row?.name || row?.key || "").trim())
              .filter(Boolean)
              .join(", ")}`
          : "";
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              answer ||
              `Best SVG match: ${pickedName || pickedKey || "Unknown"} (${pickedKey || "n/a"}).${altLine}`,
          },
        ]);
        if (pickedKey && typeof onInsertSvg === "function" && detectSvgInsertIntent(text)) {
          const insertResult = await onInsertSvg(pickedKey);
          if (insertResult?.ok) {
            setChatMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Added SVG to canvas: ${String(insertResult?.name || pickedName || pickedKey)}.`,
              },
            ]);
          } else {
            setChatMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `SVG matched (${pickedKey}) but insert failed: ${String(insertResult?.error || "unknown error")}.`,
              },
            ]);
          }
        }
        return;
      }

      const history = nextMessages
        .slice(-12)
        .map((m) => ({
          role: String(m?.role || "user"),
          content: String(m?.content || ""),
        }));
      if (debugSessionId) {
        const lower = text.toLowerCase();
        const watchTags = getSelectedControllerTags()
          .map((t) => String(t?.name || t?.tagPath || "").trim())
          .filter(Boolean)
          .filter((name) => lower.includes(name.toLowerCase()))
          .slice(0, 30);
        if (watchTags.length) {
          try {
            await fetch(`/api/ai/plc-debug-sessions/${encodeURIComponent(debugSessionId)}/watch`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ watchTags, mode: "append" }),
            });
          } catch {
            // best effort only
          }
        }
      }
      const res = await fetch("/api/ai/plc-insights", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history,
          debugSessionId: debugSessionId || undefined,
          plc: {
            name: String(selected?.name || "PLC"),
            debugSessionId: debugSessionId || undefined,
            metadata: analysis?.metadata || {},
            sections: Array.isArray(analysis?.sections) ? analysis.sections : [],
            controllerTags: getSelectedControllerTags(),
            activeOpcConnections: opcConnections
              .filter((row) => row?.connected === true)
              .map((row) => String(row?.name || "").trim())
              .filter(Boolean),
            opcConnectionCount: opcConnections.filter((row) => row?.connected === true).length,
            rawSample: String(selected?.rawText || "").slice(0, 18000),
          },
        }),
      });
      const raw = await res.text();
      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        data = {};
      }
      if (!res.ok) {
        const statusText = `${res.status}${res.statusText ? ` ${res.statusText}` : ""}`.trim();
        throw new Error(data?.error || `PLC AI request failed (${statusText}).`);
      }
      const answer = String(data?.answer || "").trim() || "No answer generated.";
      const hasPlan = data?.opcPlan && typeof data.opcPlan === "object";
      if (hasPlan) setOpcPlan(data.opcPlan);

      const shouldAutoApply = hasPlan && detectOpcAction(text);
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      if (!shouldAutoApply) return;

      const activeNames = opcConnections
        .filter((row) => row?.connected === true)
        .map((row) => String(row?.name || "").trim())
        .filter(Boolean);
      const mentioned = findMentionedOpcConnection(text, activeNames);
      const basePlan = hasPlan ? data.opcPlan : {};

      if (!mentioned && activeNames.length > 1) {
        setPendingOpcChoiceByPlc((prev) => ({
          ...prev,
          [chatKey]: { type: "connection", options: activeNames, plan: basePlan },
        }));
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Which OPC connection should I use? ${activeNames.join(", ")}` },
        ]);
        return;
      }

      let finalPlan = basePlan;
      if (mentioned) {
        finalPlan = { ...basePlan, plcName: mentioned };
      } else if (activeNames.length === 1) {
        finalPlan = {
          ...basePlan,
          plcName: basePlan?.plcName || activeNames[0],
        };
      }

      const applyResult = await applyOpcConnection({ promptOverride: text, planOverride: finalPlan });
      if (applyResult.ok) {
        setChatMessages((prev) => [...prev, { role: "assistant", content: applyResult.message }]);
      } else if (applyResult.handled) {
        return;
      } else {
        setChatError(applyResult.error || "Failed to apply OPC setup.");
        setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${applyResult.error}` }]);
      }
    } catch (err) {
      const message = err?.message || "PLC AI request failed.";
      setChatError(message);
      setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${message}` }]);
    } finally {
      setChatLoading(false);
    }
  };

  const applyMemberPickerSelection = async () => {
    const pendingChoice = pendingOpcChoiceByPlc?.[chatKey];
    if (!(pendingChoice && pendingChoice?.type === "members" && Array.isArray(pendingChoice?.options))) return;
    const pickedSet = new Set(
      (Array.isArray(memberPickerSelectionByPlc?.[chatKey]) ? memberPickerSelectionByPlc[chatKey] : [])
        .map((x) => String(x || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const selectedMembers = pendingChoice.options.filter((opt) =>
      pickedSet.has(String(opt?.fullTag || "").trim().toLowerCase())
    );
    if (!selectedMembers.length) {
      setChatError("Select at least one value member to import.");
      return;
    }
    setChatError("");
    setMemberPickerLoading(true);
    try {
      const selectedTagRows = buildTagRowsFromMembers(selectedMembers);
      const planned = {
        ...(pendingChoice?.plan && typeof pendingChoice.plan === "object" ? pendingChoice.plan : {}),
        tags: selectedTagRows,
        tagCount: selectedTagRows.length,
      };
      const activeNames = opcConnections
        .filter((row) => row?.connected === true)
        .map((row) => String(row?.name || "").trim())
        .filter(Boolean);
      if (activeNames.length > 1) {
        setPendingOpcChoiceByPlc((prev) => ({
          ...prev,
          [chatKey]: { type: "connection", options: activeNames, plan: planned },
        }));
        setChatMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Which OPC connection should I use? ${activeNames.join(", ")}` },
        ]);
        return;
      }
      let finalPlan = planned;
      if (activeNames.length === 1) {
        finalPlan = {
          ...planned,
          plcName: planned?.plcName || activeNames[0],
        };
      }
      setPendingOpcChoiceByPlc((prev) => ({ ...prev, [chatKey]: null }));
      setMemberPickerSelectionByPlc((prev) => ({ ...prev, [chatKey]: [] }));
      const applyResult = await applyOpcConnection({
        promptOverride: `Import selected members for ${pendingChoice.baseTag}`,
        planOverride: finalPlan,
      });
      if (applyResult.ok) {
        setChatMessages((prev) => [...prev, { role: "assistant", content: applyResult.message }]);
      } else if (applyResult.handled) {
        return;
      } else {
        setChatError(applyResult.error || "Failed to apply OPC setup.");
        setChatMessages((prev) => [...prev, { role: "assistant", content: `Error: ${applyResult.error}` }]);
      }
    } finally {
      setMemberPickerLoading(false);
    }
  };

  const applyOpcConnection = async ({ promptOverride = "", planOverride = null } = {}) => {
    if (!selected || opcApplyLoading) {
      return { ok: false, error: "No PLC selected." };
    }
    setOpcApplyError("");
    setOpcApplyStatus("");
    setOpcApplyLoading(true);
    try {
      const lastUserPrompt =
        chatMessages
          .slice()
          .reverse()
          .find((m) => String(m?.role || "") === "user")?.content || "";
      const effectivePlan =
        planOverride && typeof planOverride === "object"
          ? planOverride
          : opcPlan && typeof opcPlan === "object"
            ? opcPlan
            : {};
      const res = await fetch("/api/ai/plc-opc-connect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:
            String(promptOverride || "").trim() ||
            lastUserPrompt ||
            "Connect this PLC to OPC and map all controller tags.",
          plc: {
            name: String(selected?.name || "PLC"),
            metadata: analysis?.metadata || {},
            controllerTags: getSelectedControllerTags(),
          },
          opcPlan: effectivePlan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.opcPlan && typeof data.opcPlan === "object") {
          setOpcPlan(data.opcPlan);
        }
        if (data?.needsTopicChoice === true && Array.isArray(data?.topicOptions) && data.topicOptions.length) {
          const options = data.topicOptions.map((x) => String(x || "").trim()).filter(Boolean);
          if (options.length) {
            const pendingPlan =
              data?.opcPlan && typeof data.opcPlan === "object"
                ? data.opcPlan
                : effectivePlan && typeof effectivePlan === "object"
                  ? effectivePlan
                  : {};
            setPendingOpcChoiceByPlc((prev) => ({
              ...prev,
              [chatKey]: { type: "topic", options, plan: pendingPlan },
            }));
            setChatMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  String(data?.error || "").trim() ||
                  `Multiple topics exist. Pick one topic name: ${options.join(", ")}`,
              },
            ]);
            return { ok: false, handled: true };
          }
        }
        if (data?.needsTopicName === true) {
          const pendingPlan =
            data?.opcPlan && typeof data.opcPlan === "object"
              ? data.opcPlan
              : effectivePlan && typeof effectivePlan === "object"
                ? effectivePlan
                : {};
          setPendingOpcChoiceByPlc((prev) => ({
            ...prev,
            [chatKey]: { type: "topicName", plan: pendingPlan },
          }));
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                String(data?.error || "").trim() ||
                "No topic exists yet. What topic name should I create?",
            },
          ]);
          return { ok: false, handled: true };
        }
        throw new Error(String(data?.error || "Failed to apply OPC setup."));
      }
      if (data?.opcPlan && typeof data.opcPlan === "object") {
        setOpcPlan(data.opcPlan);
      }
      const message = String(
        data?.message || "OPC connection setup applied and OPC server restart requested."
      );
      setOpcApplyStatus(message);
      return { ok: true, message };
    } catch (err) {
      const msg = String(err?.message || "Failed to apply OPC setup.");
      setOpcApplyError(msg);
      return { ok: false, error: msg };
    } finally {
      setOpcApplyLoading(false);
    }
  };

  const createOneAoiTemplate = async (template) => {
    const name = String(template?.name || "").trim();
    const fields = Array.isArray(template?.fields) ? template.fields : [];
    const templateKey = name.toLowerCase();
    const excluded = new Set(
      (Array.isArray(aoiExcludedFieldsByPlc?.[chatKey]?.[templateKey])
        ? aoiExcludedFieldsByPlc[chatKey][templateKey]
        : []
      ).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)
    );
    const includedFields = fields.filter((field) => {
      const fieldKey = String(field?.name || "").trim().toLowerCase();
      return fieldKey && !excluded.has(fieldKey) && isImportableFieldName(field?.name);
    });
    if (!name) {
      return { ok: false, error: "Template name is required." };
    }
    const payload = {
      name,
      fields: includedFields.map((field) => ({
        name: String(field?.name || "").trim(),
        tagPath: String(field?.tagPath || "").trim(),
        plcType: String(field?.plcType || "").trim(),
        baseType: String(field?.baseType || "").trim(),
        isArray: field?.isArray === true,
        arraySpec: String(field?.arraySpec || "").trim(),
        usage: String(field?.usage || "").trim(),
        uaType: String(field?.uaType || "").trim(),
        enabled: field?.enabled !== false,
      })),
      parent_name: null,
      group_name: "AOI",
      state_mappings: [],
    };
    const res = await fetch("/api/opc/templates", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: String(data?.error || `Failed to save template ${name}.`) };
    }
    return { ok: true };
  };

  const createOneDataTypeTemplate = async (template, options = {}) => {
    const name = String(template?.name || "").trim();
    const fields = Array.isArray(template?.fields) ? template.fields : [];
    const templateKey = name.toLowerCase();
    const customExcluded = Array.isArray(options?.excludedFields)
      ? options.excludedFields
      : null;
    const excludedSource =
      customExcluded ||
      (Array.isArray(dataTypeExcludedFieldsByPlc?.[chatKey]?.[templateKey])
        ? dataTypeExcludedFieldsByPlc[chatKey][templateKey]
        : []);
    const excluded = new Set(
      excludedSource
        .map((x) => String(x || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const includedFields = fields.filter((field) => {
      const fieldKey = String(field?.name || "").trim().toLowerCase();
      return fieldKey && !excluded.has(fieldKey) && isImportableFieldName(field?.name);
    });
    if (!name || !includedFields.length) {
      return { ok: false, error: `Template ${name || "Unknown"} has no fields.` };
    }
    const payload = {
      name,
      fields: includedFields.map((field) => ({
        name: String(field?.name || "").trim(),
        tagPath: String(field?.tagPath || "").trim(),
        plcType: String(field?.plcType || "").trim(),
        baseType: String(field?.baseType || "").trim(),
        isArray: field?.isArray === true,
        arraySpec: String(field?.arraySpec || "").trim(),
        usage: String(field?.usage || "").trim(),
        uaType: String(field?.uaType || "").trim(),
        enabled: field?.enabled !== false,
      })),
      parent_name: null,
      group_name: "DataType",
      state_mappings: [],
    };
    const res = await fetch("/api/opc/templates", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: String(data?.error || `Failed to save template ${name}.`) };
    }
    return { ok: true };
  };

  const onCreateAoiTemplate = async (template) => {
    const name = String(template?.name || "").trim();
    if (!name) return;
    setAoiTemplateStatus("");
    setAoiTemplateError("");
    setAoiTemplateSavingName(name);
    try {
      const result = await createOneAoiTemplate(template);
      if (!result.ok) {
        setAoiTemplateError(result.error || `Failed to create template ${name}.`);
        return;
      }
      setAoiTemplateStatus(`Created template "${name}".`);
    } catch (err) {
      setAoiTemplateError(String(err?.message || `Failed to create template ${name}.`));
    } finally {
      setAoiTemplateSavingName("");
    }
  };

  const onCreateAllAoiTemplates = async () => {
    if (!aoiTemplates.length || aoiTemplateSavingAll) return;
    setAoiTemplateStatus("");
    setAoiTemplateError("");
    setAoiTemplateSavingAll(true);
    try {
      let successCount = 0;
      const failures = [];
      for (const template of aoiTemplates) {
        const result = await createOneAoiTemplate(template);
        if (result.ok) successCount += 1;
        else failures.push(result.error || `Failed to save ${String(template?.name || "").trim()}`);
      }
      if (failures.length) {
        setAoiTemplateError(failures.slice(0, 4).join(" | "));
      }
      setAoiTemplateStatus(`Created ${successCount}/${aoiTemplates.length} AOI template(s).`);
    } catch (err) {
      setAoiTemplateError(String(err?.message || "Failed to create AOI templates."));
    } finally {
      setAoiTemplateSavingAll(false);
    }
  };

  const selectedAoiNames = Array.isArray(aoiSelectionByPlc?.[chatKey]) ? aoiSelectionByPlc[chatKey] : [];
  const selectedAoiSet = new Set(
    selectedAoiNames.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)
  );
  const expandedAoiNames = Array.isArray(aoiExpandedByPlc?.[chatKey]) ? aoiExpandedByPlc[chatKey] : [];
  const expandedAoiSet = new Set(
    expandedAoiNames.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)
  );

  const toggleAoiSelected = (name) => {
    const key = String(name || "").trim();
    if (!key) return;
    const keyLower = key.toLowerCase();
    setAoiSelectionByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const exists = current.some((v) => String(v || "").trim().toLowerCase() === keyLower);
      const next = exists
        ? current.filter((v) => String(v || "").trim().toLowerCase() !== keyLower)
        : [...current, key];
      return { ...prev, [chatKey]: next };
    });
  };

  const toggleAoiExpanded = (name) => {
    const key = String(name || "").trim();
    if (!key) return;
    const keyLower = key.toLowerCase();
    setAoiExpandedByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const exists = current.some((v) => String(v || "").trim().toLowerCase() === keyLower);
      const next = exists
        ? current.filter((v) => String(v || "").trim().toLowerCase() !== keyLower)
        : [...current, key];
      return { ...prev, [chatKey]: next };
    });
  };

  const selectAllAoiTemplates = () => {
    setAoiSelectionByPlc((prev) => ({
      ...prev,
      [chatKey]: aoiTemplates.map((t) => String(t?.name || "").trim()).filter(Boolean),
    }));
  };

  const clearAllAoiTemplates = () => {
    setAoiSelectionByPlc((prev) => ({ ...prev, [chatKey]: [] }));
  };

  const expandAllAoiTemplates = () => {
    setAoiExpandedByPlc((prev) => ({
      ...prev,
      [chatKey]: aoiTemplates.map((t) => String(t?.name || "").trim()).filter(Boolean),
    }));
  };

  const collapseAllAoiTemplates = () => {
    setAoiExpandedByPlc((prev) => ({ ...prev, [chatKey]: [] }));
  };

  const onImportSelectedAoiTemplates = async () => {
    if (!selectedAoiSet.size || aoiTemplateSavingAll) return;
    setAoiTemplateStatus("");
    setAoiTemplateError("");
    setAoiTemplateSavingAll(true);
    try {
      const selectedTemplates = aoiTemplates.filter((template) =>
        selectedAoiSet.has(String(template?.name || "").trim().toLowerCase())
      );
      let successCount = 0;
      const failures = [];
      for (const template of selectedTemplates) {
        const result = await createOneAoiTemplate(template);
        if (result.ok) successCount += 1;
        else failures.push(result.error || `Failed to save ${String(template?.name || "").trim()}`);
      }
      if (failures.length) {
        setAoiTemplateError(failures.slice(0, 4).join(" | "));
      }
      setAoiTemplateStatus(`Imported ${successCount}/${selectedTemplates.length} selected AOI template(s).`);
    } catch (err) {
      setAoiTemplateError(String(err?.message || "Failed to import selected AOI templates."));
    } finally {
      setAoiTemplateSavingAll(false);
    }
  };

  const isAoiFieldIncluded = (templateName, fieldName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    const fKey = String(fieldName || "").trim().toLowerCase();
    if (!tKey || !fKey) return false;
    const excluded = new Set(
      (Array.isArray(aoiExcludedFieldsByPlc?.[chatKey]?.[tKey])
        ? aoiExcludedFieldsByPlc[chatKey][tKey]
        : []
      ).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)
    );
    return !excluded.has(fKey);
  };

  const toggleAoiFieldIncluded = (templateName, fieldName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    const fKey = String(fieldName || "").trim().toLowerCase();
    if (!tKey || !fKey) return;
    setAoiExcludedFieldsByPlc((prev) => {
      const currentByPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const current = Array.isArray(currentByPlc[tKey]) ? currentByPlc[tKey] : [];
      const has = current.some((x) => String(x || "").trim().toLowerCase() === fKey);
      const next = has
        ? current.filter((x) => String(x || "").trim().toLowerCase() !== fKey)
        : [...current, fKey];
      return {
        ...prev,
        [chatKey]: {
          ...currentByPlc,
          [tKey]: next,
        },
      };
    });
  };

  const includeAllAoiFields = (templateName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    if (!tKey) return;
    setAoiExcludedFieldsByPlc((prev) => {
      const currentByPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      return {
        ...prev,
        [chatKey]: {
          ...currentByPlc,
          [tKey]: [],
        },
      };
    });
  };

  const excludeAllAoiFields = (templateName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    if (!tKey) return;
    const template = aoiTemplates.find((t) => String(t?.name || "").trim().toLowerCase() === tKey);
    const allFields = (Array.isArray(template?.fields) ? template.fields : [])
      .map((f) => String(f?.name || "").trim().toLowerCase())
      .filter(Boolean);
    setAoiExcludedFieldsByPlc((prev) => {
      const currentByPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      return {
        ...prev,
        [chatKey]: {
          ...currentByPlc,
          [tKey]: Array.from(new Set(allFields)),
        },
      };
    });
  };

  const onCreateDataTypeTemplate = async (template) => {
    const name = String(template?.name || "").trim();
    if (!name) return;
    setDataTypeTemplateStatus("");
    setDataTypeTemplateError("");
    setDataTypeTemplateSavingName(name);
    try {
      const importOrder = buildDataTypeImportOrder([template]);
      let successCount = 0;
      const failures = [];
      for (const entry of importOrder) {
        const result = await createOneDataTypeTemplate(entry);
        if (result.ok) successCount += 1;
        else failures.push(result.error || `Failed to create template ${String(entry?.name || "").trim()}.`);
      }
      if (failures.length) {
        setDataTypeTemplateError(failures.slice(0, 4).join(" | "));
        return;
      }
      setDataTypeTemplateStatus(`Created ${successCount}/${importOrder.length} Data Type template(s).`);
    } catch (err) {
      setDataTypeTemplateError(String(err?.message || `Failed to create template ${name}.`));
    } finally {
      setDataTypeTemplateSavingName("");
    }
  };

  const onCreateAllDataTypeTemplates = async () => {
    if (!dataTypeTemplates.length || dataTypeTemplateSavingAll) return;
    setDataTypeTemplateStatus("");
    setDataTypeTemplateError("");
    setDataTypeTemplateSavingAll(true);
    try {
      const importOrder = buildDataTypeImportOrder(dataTypeTemplates);
      let successCount = 0;
      const failures = [];
      for (const template of importOrder) {
        const result = await createOneDataTypeTemplate(template);
        if (result.ok) successCount += 1;
        else failures.push(result.error || `Failed to save ${String(template?.name || "").trim()}`);
      }
      if (failures.length) {
        setDataTypeTemplateError(failures.slice(0, 4).join(" | "));
      }
      setDataTypeTemplateStatus(
        `Created ${successCount}/${importOrder.length} Data Type template(s).`
      );
    } catch (err) {
      setDataTypeTemplateError(String(err?.message || "Failed to create Data Type templates."));
    } finally {
      setDataTypeTemplateSavingAll(false);
    }
  };

  const selectedDataTypeNames = Array.isArray(dataTypeSelectionByPlc?.[chatKey])
    ? dataTypeSelectionByPlc[chatKey]
    : [];
  const selectedDataTypeSet = new Set(
    selectedDataTypeNames.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)
  );
  const expandedDataTypeNames = Array.isArray(dataTypeExpandedByPlc?.[chatKey])
    ? dataTypeExpandedByPlc[chatKey]
    : [];
  const expandedDataTypeSet = new Set(
    expandedDataTypeNames.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)
  );

  const toggleDataTypeSelected = (name) => {
    const key = String(name || "").trim();
    if (!key) return;
    const keyLower = key.toLowerCase();
    setDataTypeSelectionByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const exists = current.some((v) => String(v || "").trim().toLowerCase() === keyLower);
      const next = exists
        ? current.filter((v) => String(v || "").trim().toLowerCase() !== keyLower)
        : [...current, key];
      return { ...prev, [chatKey]: next };
    });
  };

  const toggleDataTypeExpanded = (name) => {
    const key = String(name || "").trim();
    if (!key) return;
    const keyLower = key.toLowerCase();
    setDataTypeExpandedByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const exists = current.some((v) => String(v || "").trim().toLowerCase() === keyLower);
      const next = exists
        ? current.filter((v) => String(v || "").trim().toLowerCase() !== keyLower)
        : [...current, key];
      return { ...prev, [chatKey]: next };
    });
  };

  const selectAllDataTypes = () => {
    setDataTypeSelectionByPlc((prev) => ({
      ...prev,
      [chatKey]: dataTypeTemplates.map((t) => String(t?.name || "").trim()).filter(Boolean),
    }));
  };

  const clearAllDataTypes = () => {
    setDataTypeSelectionByPlc((prev) => ({ ...prev, [chatKey]: [] }));
  };

  const expandAllDataTypes = () => {
    setDataTypeExpandedByPlc((prev) => ({
      ...prev,
      [chatKey]: dataTypeTemplates.map((t) => String(t?.name || "").trim()).filter(Boolean),
    }));
  };

  const collapseAllDataTypes = () => {
    setDataTypeExpandedByPlc((prev) => ({ ...prev, [chatKey]: [] }));
  };

  const toggleDataTypeNodeExpanded = (nodeKey) => {
    const key = String(nodeKey || "").trim();
    if (!key) return;
    setDataTypeNodeExpandedByPlc((prev) => {
      const current = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
      const has = current.includes(key);
      const next = has ? current.filter((k) => k !== key) : [...current, key];
      return { ...prev, [chatKey]: next };
    });
  };

  const buildDataTypeImportOrder = (rootTemplates) => {
    const primitiveDataTypeNames = new Set([
      "bool",
      "bit",
      "sint",
      "int",
      "dint",
      "lint",
      "usint",
      "uint",
      "udint",
      "ulint",
      "real",
      "lreal",
      "string",
      "wstring",
      "byte",
      "word",
      "dword",
      "time",
      "date",
      "datetime",
    ]);
    const ordered = [];
    const visited = new Set();
    const visiting = new Set();
    const rootNameSet = new Set(
      (Array.isArray(rootTemplates) ? rootTemplates : [])
        .map((t) => String(t?.name || "").trim().toLowerCase())
        .filter(Boolean)
    );

    const getIncludedFields = (template) => {
      const templateName = String(template?.name || "").trim().toLowerCase();
      if (!templateName) return [];
      const excluded = rootNameSet.has(templateName)
        ? new Set(
            (Array.isArray(dataTypeExcludedFieldsByPlc?.[chatKey]?.[templateName])
              ? dataTypeExcludedFieldsByPlc[chatKey][templateName]
              : []
            )
              .map((x) => String(x || "").trim().toLowerCase())
              .filter(Boolean)
          )
        : new Set();
      return (Array.isArray(template?.fields) ? template.fields : []).filter((field) => {
        const fieldKey = String(field?.name || "").trim().toLowerCase();
        return fieldKey && !excluded.has(fieldKey) && isImportableFieldName(field?.name);
      });
    };

    const visit = (template) => {
      const templateName = String(template?.name || "").trim();
      const key = templateName.toLowerCase();
      if (!key || visited.has(key) || visiting.has(key)) return;
      visiting.add(key);

      const fields = getIncludedFields(template);
      fields.forEach((field) => {
        const parsed = parsePlcDataTypeDescriptor(
          String(field?.baseType || field?.plcType || ""),
          String(field?.arraySpec || "")
        );
        const rawChildType = String(parsed?.baseType || field?.baseType || field?.plcType || "").trim();
        const fieldNameCandidate = String(field?.name || "").trim();
        const fieldPathCandidate = String(field?.tagPath || "").trim();
        const pathLeafCandidate = fieldPathCandidate
          ? fieldPathCandidate.split(".").filter(Boolean).slice(-1)[0] || ""
          : "";
        const childKey = rawChildType.toLowerCase();
        if (!rawChildType || primitiveDataTypeNames.has(childKey)) return;
        const childTemplate =
          resolveDataTypeTemplateByTypeName(rawChildType) ||
          resolveDataTypeTemplateByTypeName(field?.baseType) ||
          resolveDataTypeTemplateByTypeName(field?.plcType) ||
          resolveDataTypeTemplateByTypeName(fieldNameCandidate) ||
          resolveDataTypeTemplateByTypeName(pathLeafCandidate);
        if (!childTemplate) return;
        visit(childTemplate);
      });

      visiting.delete(key);
      visited.add(key);
      ordered.push(template);
    };

    (Array.isArray(rootTemplates) ? rootTemplates : []).forEach(visit);
    return ordered;
  };

  const onImportSelectedDataTypes = async () => {
    if (!selectedDataTypeSet.size || dataTypeTemplateSavingAll) return;
    setDataTypeTemplateStatus("");
    setDataTypeTemplateError("");
    setDataTypeTemplateSavingAll(true);
    try {
      const selectedTemplates = dataTypeTemplates.filter((template) =>
        selectedDataTypeSet.has(String(template?.name || "").trim().toLowerCase())
      );
      const importOrder = buildDataTypeImportOrder(selectedTemplates);
      let successCount = 0;
      const failures = [];
      for (const template of importOrder) {
        const result = await createOneDataTypeTemplate(template);
        if (result.ok) successCount += 1;
        else failures.push(result.error || `Failed to save ${String(template?.name || "").trim()}`);
      }
      if (failures.length) {
        setDataTypeTemplateError(failures.slice(0, 4).join(" | "));
      }
      setDataTypeTemplateStatus(
        `Imported ${successCount}/${importOrder.length} Data Type template(s) from selected PLC types.`
      );
    } catch (err) {
      setDataTypeTemplateError(String(err?.message || "Failed to import selected Data Type templates."));
    } finally {
      setDataTypeTemplateSavingAll(false);
    }
  };

  const dataTypeExcludedSetByTemplate = useMemo(() => {
    const out = new Map();
    const byTemplate =
      dataTypeExcludedFieldsByPlc?.[chatKey] && typeof dataTypeExcludedFieldsByPlc[chatKey] === "object"
        ? dataTypeExcludedFieldsByPlc[chatKey]
        : {};
    Object.entries(byTemplate).forEach(([templateKey, excludedList]) => {
      const tKey = String(templateKey || "").trim().toLowerCase();
      if (!tKey) return;
      out.set(
        tKey,
        new Set(
          (Array.isArray(excludedList) ? excludedList : [])
            .map((x) => String(x || "").trim().toLowerCase())
            .filter(Boolean)
        )
      );
    });
    return out;
  }, [chatKey, dataTypeExcludedFieldsByPlc]);

  const isDataTypeFieldIncluded = (templateName, fieldName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    const fKey = String(fieldName || "").trim().toLowerCase();
    if (!tKey || !fKey) return false;
    const excluded = dataTypeExcludedSetByTemplate.get(tKey);
    return !excluded?.has(fKey);
  };

  const toggleDataTypeFieldIncluded = (templateName, fieldName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    const fKey = String(fieldName || "").trim().toLowerCase();
    if (!tKey || !fKey) return;
    setDataTypeExcludedFieldsByPlc((prev) => {
      const currentByPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const current = Array.isArray(currentByPlc[tKey]) ? currentByPlc[tKey] : [];
      const has = current.some((x) => String(x || "").trim().toLowerCase() === fKey);
      const next = has
        ? current.filter((x) => String(x || "").trim().toLowerCase() !== fKey)
        : [...current, fKey];
      return {
        ...prev,
        [chatKey]: {
          ...currentByPlc,
          [tKey]: next,
        },
      };
    });
  };

  const includeAllDataTypeFields = (templateName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    if (!tKey) return;
    setDataTypeExcludedFieldsByPlc((prev) => {
      const currentByPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      return {
        ...prev,
        [chatKey]: {
          ...currentByPlc,
          [tKey]: [],
        },
      };
    });
  };

  const excludeAllDataTypeFields = (templateName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    if (!tKey) return;
    const template = dataTypeTemplates.find((t) => String(t?.name || "").trim().toLowerCase() === tKey);
    const allFields = (Array.isArray(template?.fields) ? template.fields : [])
      .map((f) => String(f?.name || "").trim().toLowerCase())
      .filter(Boolean);
    setDataTypeExcludedFieldsByPlc((prev) => {
      const currentByPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      return {
        ...prev,
        [chatKey]: {
          ...currentByPlc,
          [tKey]: Array.from(new Set(allFields)),
        },
      };
    });
  };

  const primitiveTypeSet = useMemo(() => new Set([
    "bool",
    "bit",
    "sint",
    "int",
    "dint",
    "lint",
    "usint",
    "uint",
    "udint",
    "ulint",
    "real",
    "lreal",
    "string",
    "wstring",
    "byte",
    "word",
    "dword",
    "time",
    "date",
    "datetime",
  ]), []);
  const dataTypeNodeExpandedSet = useMemo(
    () =>
      new Set(
        (Array.isArray(dataTypeNodeExpandedByPlc?.[chatKey]) ? dataTypeNodeExpandedByPlc[chatKey] : []).map((k) =>
          String(k || "")
        )
      ),
    [chatKey, dataTypeNodeExpandedByPlc]
  );

  const renderDataTypeFieldTree = (
    rootTemplateName,
    fields,
    visitedTypes = [],
    depth = 0,
    templateResolveCache = new Map(),
    descriptorCache = new Map()
  ) => {
    return (
      <div style={{ display: "grid", gap: 4 }}>
        {(Array.isArray(fields) ? fields : []).map((field) => {
          const fieldName = String(field?.name || "").trim();
          const plcType = String(field?.plcType || "").trim();
          const descBase = String(field?.baseType || field?.plcType || "");
          const descArray = String(field?.arraySpec || "");
          const descriptorKey = `${descBase}|${descArray}`;
          let parsed = descriptorCache.get(descriptorKey);
          if (!parsed) {
            parsed = parsePlcDataTypeDescriptor(descBase, descArray);
            descriptorCache.set(descriptorKey, parsed);
          }
          const lookupType = String(parsed.baseType || field?.baseType || plcType || "").trim();
          const plcTypeKey = lookupType.toLowerCase();
          const resolveTemplateCached = (rawTypeName) => {
            const cacheKey = String(rawTypeName || "").trim();
            if (!cacheKey) return null;
            if (templateResolveCache.has(cacheKey)) return templateResolveCache.get(cacheKey);
            const found = resolveDataTypeTemplateByTypeName(cacheKey) || null;
            templateResolveCache.set(cacheKey, found);
            return found;
          };
          const targetTemplate =
            resolveTemplateCached(lookupType) ||
            resolveTemplateCached(field?.baseType) ||
            resolveTemplateCached(field?.plcType);
          const hasNested = Boolean(targetTemplate) && !primitiveTypeSet.has(plcTypeKey);
          const recursive = hasNested && visitedTypes.includes(plcTypeKey);
          const nodeKey = `dt:${String(rootTemplateName || "").trim()}|${visitedTypes.join(">")}|${fieldName}|${plcType}`;
          const canExpand = !recursive;
          const isExpanded = dataTypeNodeExpandedSet.has(nodeKey);
          const indentPx = Math.max(0, depth * 12);
          return (
            <div key={`${nodeKey}-row`} style={{ marginLeft: indentPx }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "20px 18px minmax(0,1fr) auto",
                  gap: 8,
                  alignItems: "center",
                  minHeight: 24,
                }}
              >
                {canExpand ? (
                  <button
                    type="button"
                    data-preserve-style="true"
                    onClick={() => toggleDataTypeNodeExpanded(nodeKey)}
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg-elev)",
                      color: "var(--text)",
                      borderRadius: 5,
                      width: 20,
                      height: 20,
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: 1,
                      padding: 0,
                    }}
                    title={isExpanded ? "Collapse nested fields" : "Expand nested fields"}
                  >
                    {isExpanded ? "âˆ’" : "+"}
                  </button>
                ) : (
                  <span style={{ width: 20, display: "inline-block" }} />
                )}
                <input
                  type="checkbox"
                  checked={isDataTypeFieldIncluded(rootTemplateName, fieldName)}
                  onChange={() => toggleDataTypeFieldIncluded(rootTemplateName, fieldName)}
                  style={{ width: 13, height: 13 }}
                />
                <span
                  style={{
                    color: "var(--text)",
                    fontSize: 11,
                    fontWeight: 600,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                  title={`${fieldName}${plcType ? ` (${plcType})` : ""}`}
                >
                  <span>{fieldName || "(unnamed)"}</span>
                  {plcType ? (
                    <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>
                      : {plcType}
                    </span>
                  ) : null}
                  {parsed.isArray ? (
                    <span style={{ color: "#2b6cff", fontWeight: 700 }}>[array]</span>
                  ) : null}
                  {recursive ? (
                    <span style={{ color: "#f59e0b", fontWeight: 700 }}>(recursive)</span>
                  ) : null}
                </span>
                <span />
              </div>
              {canExpand && isExpanded ? (
                <div style={{ marginTop: 4 }}>
                  {hasNested
                    ? renderDataTypeFieldTree(
                        rootTemplateName,
                        Array.isArray(targetTemplate?.fields) ? targetTemplate.fields : [],
                        [...visitedTypes, plcTypeKey],
                        depth + 1,
                        templateResolveCache,
                        descriptorCache
                      )
                    : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        padding: "0 10px 10px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {showTopLevelPlcTabs ? (
        <div
          className="vizi-scroll"
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            overflowX: "auto",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 2,
          }}
        >
          {[
            { key: "plc", label: "PLC" },
            { key: "code-gen-pro", label: "Code Gen Pro" },
          ].map((tab) => {
            const active = String(plcTopTab || "") === tab.key;
            return (
              <button
                key={`plc-top-tab-${tab.key}`}
                type="button"
                data-preserve-style="true"
                onClick={() => setPlcTopTab(tab.key)}
                style={{
                  border: "none",
                  borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                  background: "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  borderRadius: 0,
                  minWidth: 0,
                  height: 30,
                  padding: "0 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  whiteSpace: "nowrap",
                  boxShadow: "none",
                  transition: "color 140ms ease, border-color 140ms ease, background-color 140ms ease",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}
      <div style={{ display: "grid", gap: codeGenOnlyView ? 0 : 2 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{codeGenOnlyView ? "Code Gen Pro" : "PLC L5X/L5K Analyzer"}</div>
        {!codeGenOnlyView ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Upload an .l5x or .l5k file to scan controller metadata, tags, programs, routines, modules, and AOIs.
          </div>
        ) : null}
      </div>

      {visiblePlcTabs.length > 1 ? (
        <div
          className="vizi-scroll"
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            overflowX: "auto",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 2,
          }}
        >
          {visiblePlcTabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={`plc-tab-${tab.key}`}
                type="button"
                data-preserve-style="true"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  border: "none",
                  borderBottom: `2px solid ${active ? "var(--accent)" : "transparent"}`,
                  background: "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  borderRadius: 0,
                  minWidth: 0,
                  height: 30,
                  padding: "0 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  whiteSpace: "nowrap",
                  boxShadow: "none",
                  transition: "color 140ms ease, border-color 140ms ease, background-color 140ms ease",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {activeTab === "overview" ? (
        <>
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
              Upload PLC
              <input type="file" accept=".l5x,.l5k,.xml,text/xml,application/xml,text/plain" onChange={onFileChange} style={{ display: "none" }} />
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
            <div style={{ display: "grid", gap: 0 }}>
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
              {!analysis.isLikelyL5x && !analysis.isLikelyL5k ? (
                <div style={{ border: "1px solid #f59e0b", background: "rgba(245,158,11,0.08)", color: "#f59e0b", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
                  This file does not look like an L5X/L5K export, but scan results are shown.
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
                    Owner: analysis.metadata.owner,
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
                  {analysis.sections.map((row) => {
                    const rowKey = String(row?.key || row?.label || "");
                    const expanded = expandedSummaryByKey[rowKey] === true;
                    const fullNames = Array.isArray(fullSectionNamesByKey?.[rowKey])
                      ? fullSectionNamesByKey[rowKey]
                      : Array.isArray(row?.names)
                      ? row.names
                      : [];
                    const previewNames = Array.isArray(row?.names) && row.names.length ? row.names : fullNames.slice(0, 8);
                    return (
                      <div
                        key={row.label}
                        style={{
                          display: "grid",
                          gap: 6,
                          alignItems: "start",
                          padding: "8px 10px",
                          borderTop: "1px solid var(--border)",
                          fontSize: 12,
                        }}
                      >
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
                          <div style={{ fontWeight: 700 }}>{row.label}</div>
                          <div style={{ color: "var(--text-muted)", fontWeight: 700 }}>{row.count}</div>
                          <button
                            type="button"
                            data-preserve-style="true"
                            onClick={() =>
                              setExpandedSummaryByKey((prev) => ({
                                ...prev,
                                [rowKey]: !expanded,
                              }))
                            }
                            style={{
                              border: "1px solid var(--border)",
                              background: expanded ? "#2b6cff" : "var(--bg-soft)",
                              color: expanded ? "#fff" : "var(--text)",
                              borderRadius: 6,
                              width: 24,
                              height: 24,
                              padding: 0,
                              lineHeight: "24px",
                              textAlign: "center",
                              fontSize: 14,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            {expanded ? "-" : "+"}
                          </button>
                        </div>
                        {expanded ? (
                          <div
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 8,
                              background: "var(--bg-soft)",
                              padding: "6px 8px",
                              color: "var(--text-muted)",
                              wordBreak: "break-word",
                            }}
                          >
                            {fullNames.length ? (
                              fullNames.map((name, idx) => (
                                <div key={`${rowKey}-${idx}`} style={{ padding: "2px 0" }}>
                                  {name}
                                </div>
                              ))
                            ) : (
                              <div>-</div>
                            )}
                          </div>
                        ) : (
                          <div style={{ color: "var(--text-muted)", wordBreak: "break-word" }}>
                            {previewNames.length ? previewNames.join(", ") : "-"}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              No file loaded.
            </div>
          )}
        </>
      ) : null}

      {activeTab === "ai" ? (
        <>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Context: <strong style={{ color: "var(--text)" }}>{selected?.name || "No PLC selected"}</strong>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", overflow: "hidden" }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 12 }}>
              Active OPC Connections
            </div>
            <div style={{ padding: 10, display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {opcConnections.filter((row) => row.connected).length ? (
                  opcConnections
                    .filter((row) => row.connected)
                    .map((row) => (
                      <span
                        key={`opc-conn-${row.name}`}
                        style={{
                          border: "1px solid #12b76a",
                          background: "rgba(18,183,106,0.14)",
                          color: "#12b76a",
                          borderRadius: 999,
                          padding: "4px 8px",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {row.name}
                      </span>
                    ))
                ) : (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    No active OPC connections.
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Active:{" "}
                <strong style={{ color: "var(--text)" }}>
                  {opcConnections.filter((row) => row.connected).length}
                </strong>{" "}
                / {opcConnections.length}{" "}
                {opcConnectionsAt ? `| Updated ${new Date(opcConnectionsAt).toLocaleTimeString()}` : ""}
                {opcConnectionsLoading ? " | Refreshing..." : ""}
              </div>
              {opcConnectionsError ? <div style={{ fontSize: 12, color: "#f04438" }}>{opcConnectionsError}</div> : null}
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", overflow: "hidden" }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 12 }}>
              Live PLC Debug Session
            </div>
            <div style={{ padding: 10, display: "grid", gap: 6 }}>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Session:{" "}
                <strong style={{ color: "var(--text)" }}>
                  {debugSessionId ? debugSessionId : debugSessionLoading ? "Starting..." : "Not started"}
                </strong>
              </div>
              {debugSnapshot ? (
                <>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Snapshot {debugSnapshot?.at ? new Date(debugSnapshot.at).toLocaleTimeString() : "-"} | Matched tags{" "}
                    <strong style={{ color: "var(--text)" }}>{Number(debugSnapshot?.matchedTagCount || 0)}</strong> | Error hotspots{" "}
                    <strong style={{ color: "var(--text)" }}>
                      {Array.isArray(debugSnapshot?.hotspots?.errors) ? debugSnapshot.hotspots.errors.length : 0}
                    </strong>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", maxHeight: 96, overflow: "auto" }}>
                    {Array.isArray(debugSnapshot?.tags) && debugSnapshot.tags.length
                      ? debugSnapshot.tags
                          .slice(0, 8)
                          .map((row) => `${String(row?.key || "")} = ${String(row?.value ?? "")}`)
                          .join(" | ")
                      : "No live tag samples yet."}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Live snapshot pending. Open AI tab for a few seconds after OPC starts polling.
                </div>
              )}
              {debugSessionError ? <div style={{ fontSize: 12, color: "#f04438" }}>{debugSessionError}</div> : null}
            </div>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", overflow: "hidden" }}>
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 12 }}>
              AI PLC Insights
            </div>
            <div style={{ padding: 10, display: "grid", gap: 8 }}>
              <div
                ref={chatScrollRef}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--bg-soft)",
                  minHeight: 120,
                  maxHeight: 240,
                  overflow: "auto",
                  padding: 8,
                  display: "grid",
                  gap: 6,
                }}
              >
                {chatMessages.length ? (
                  chatMessages.map((msg, idx) => (
                    <div
                      key={`${chatKey}-${idx}-${msg.role}`}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "6px 8px",
                        background:
                          msg.role === "user" ? "color-mix(in srgb, #2b6cff 14%, var(--bg-elev))" : "var(--bg-elev)",
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-muted)", marginBottom: 2 }}>
                        {msg.role === "user" ? "You" : "AI"}
                      </div>
                      <div>{String(msg.content || "")}</div>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Ask for logic summaries, tag usage, routine lookup, OPC setup, or SVG recommendations from tag lists.
                  </div>
                )}
              </div>
              {chatError ? <div style={{ fontSize: 12, color: "#f04438" }}>{chatError}</div> : null}
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {analysis?.controllerTags?.count
                  ? `${analysis.controllerTags.count} tags detected in selected PLC file`
                  : "Upload/select a PLC with controller tags to map into OPC"}
              </div>
              {opcApplyError ? <div style={{ fontSize: 12, color: "#f04438" }}>{opcApplyError}</div> : null}
              {opcApplyStatus ? <div style={{ fontSize: 12, color: "#12b76a" }}>{opcApplyStatus}</div> : null}
              {activePendingChoice && activePendingChoice?.type === "members" && Array.isArray(activePendingChoice?.options) ? (
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-soft)",
                    padding: 8,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                    Select value members to import for {String(activePendingChoice?.baseTag || "tag")}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={() =>
                        setMemberPickerSelectionByPlc((prev) => ({
                          ...prev,
                          [chatKey]: activePendingChoice.options
                            .map((opt) => String(opt?.fullTag || "").trim())
                            .filter(Boolean),
                        }))
                      }
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        color: "var(--text)",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={() => setMemberPickerSelectionByPlc((prev) => ({ ...prev, [chatKey]: [] }))}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        color: "var(--text)",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={applyMemberPickerSelection}
                      disabled={memberPickerLoading || !memberPickerSelected.length}
                      style={{
                        border: "1px solid #12b76a",
                        background: "#12b76a",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: memberPickerLoading ? "default" : "pointer",
                        opacity: memberPickerLoading || !memberPickerSelected.length ? 0.7 : 1,
                      }}
                    >
                      {memberPickerLoading ? "Importing..." : `Import Selected (${memberPickerSelected.length})`}
                    </button>
                  </div>
                  <div
                    style={{
                      maxHeight: 200,
                      overflow: "auto",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--bg-elev)",
                      padding: 6,
                      display: "grid",
                      gap: 4,
                    }}
                  >
                    {activePendingChoice.options.map((opt, idx) => {
                      const fullTag = String(opt?.fullTag || "").trim();
                      const member = String(opt?.member || "").trim() || fullTag;
                      const checked = memberPickerSelected.includes(fullTag);
                      return (
                        <label
                          key={`${fullTag}-${idx}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "16px 1fr",
                            gap: 8,
                            alignItems: "center",
                            fontSize: 12,
                            color: "var(--text)",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const isOn = e.target.checked;
                              setMemberPickerSelectionByPlc((prev) => {
                                const curr = Array.isArray(prev?.[chatKey]) ? prev[chatKey] : [];
                                const next = isOn
                                  ? Array.from(new Set([...curr, fullTag]))
                                  : curr.filter((x) => String(x || "").trim() !== fullTag);
                                return { ...prev, [chatKey]: next };
                              });
                            }}
                          />
                          <span>{member}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  data-preserve-style="true"
                  autoComplete="off"
                  value={chatPrompt}
                  onChange={(e) => setChatPrompt(e.target.value)}
                  placeholder={selected ? "Ask about this PLC file..." : "Select/upload a PLC in Overview first"}
                  onMouseDown={(e) => e.stopPropagation()}
                  onFocus={(e) => e.stopPropagation()}
                  disabled={!selected}
                  style={{
                    flex: 1,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 12,
                    opacity: selected ? 1 : 0.7,
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    sendChat();
                  }}
                />
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={sendChat}
                  onMouseDown={(e) => e.stopPropagation()}
                  disabled={!selected || chatLoading || !String(chatPrompt || "").trim()}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "#fff",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: chatLoading ? "default" : "pointer",
                    opacity: chatLoading || !selected ? 0.75 : 1,
                  }}
                >
                  {chatLoading ? "Thinking..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {activeTab === "aoi-templates" ? (
        <>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Source: <strong style={{ color: "var(--text)" }}>{selected?.name || "Database Templates"}</strong>
          </div>
          {!aoiTemplates.length ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              No AOI templates found in uploaded file or database.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  position: "sticky",
                  top: 0,
                  zIndex: 4,
                  background: "var(--bg)",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <input
                  value={aoiTemplateSearch}
                  onChange={(e) => setAoiTemplateSearch(e.target.value)}
                  placeholder="Search AOI templates..."
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    minWidth: 220,
                  }}
                />
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={onCreateAllAoiTemplates}
                  disabled={aoiTemplateSavingAll}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "#fff",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: aoiTemplateSavingAll ? "default" : "pointer",
                    opacity: aoiTemplateSavingAll ? 0.75 : 1,
                  }}
                >
                  {aoiTemplateSavingAll ? "Creating..." : `Create All (${aoiTemplates.length})`}
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={onImportSelectedAoiTemplates}
                  disabled={aoiTemplateSavingAll || selectedAoiSet.size === 0}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: aoiTemplateSavingAll || selectedAoiSet.size === 0 ? "default" : "pointer",
                    opacity: aoiTemplateSavingAll || selectedAoiSet.size === 0 ? 0.65 : 1,
                  }}
                >
                  {`Import Selected (${selectedAoiSet.size})`}
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={selectAllAoiTemplates}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
                >
                  Select All
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={clearAllAoiTemplates}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={expandAllAoiTemplates}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
                >
                  Expand All
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={collapseAllAoiTemplates}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
                >
                  Collapse All
                </button>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Saves/updates OPC templates from AOI parameter definitions.
                </div>
              </div>
              {aoiTemplateError ? (
                <div style={{ border: "1px solid #f04438", background: "rgba(240,68,56,0.08)", color: "#f04438", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
                  {aoiTemplateError}
                </div>
              ) : null}
              {aoiTemplateStatus ? (
                <div style={{ border: "1px solid #12b76a", background: "rgba(18,183,106,0.08)", color: "#12b76a", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
                  {aoiTemplateStatus}
                </div>
              ) : null}
                <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", overflow: "hidden" }}>
                <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 12 }}>
                  Parsed AOI Templates ({filteredAoiTemplates.length}/{aoiTemplates.length})
                </div>
                <div style={{ display: "grid", gap: 0 }}>
                  {filteredAoiTemplates.map((template) => (
                    <div
                      key={`aoi-template-${template.name}`}
                      style={{
                        borderTop: "1px solid var(--border)",
                        padding: "8px 10px",
                        display: "grid",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "20px auto 1fr", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          data-preserve-style="true"
                          onClick={() => toggleAoiExpanded(template.name)}
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
                          title={
                            expandedAoiSet.has(String(template.name || "").trim().toLowerCase())
                              ? "Collapse"
                              : "Expand"
                          }
                        >
                          {expandedAoiSet.has(String(template.name || "").trim().toLowerCase()) ? "âˆ’" : "+"}
                        </button>
                        <input
                          type="checkbox"
                          checked={selectedAoiSet.has(String(template.name || "").trim().toLowerCase())}
                          onChange={() => toggleAoiSelected(template.name)}
                          style={{ width: 14, height: 14 }}
                        />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{template.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {template.fields.length} field(s){template.revision ? ` | Rev ${template.revision}` : ""}
                          </div>
                        </div>
                      </div>
                      {expandedAoiSet.has(String(template.name || "").trim().toLowerCase()) ? (
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              data-preserve-style="true"
                              onClick={() => includeAllAoiFields(template.name)}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 700 }}
                            >
                              Include All Fields
                            </button>
                            <button
                              type="button"
                              data-preserve-style="true"
                              onClick={() => excludeAllAoiFields(template.name)}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 700 }}
                            >
                              Exclude All Fields
                            </button>
                          </div>
                          <div style={{ display: "grid", gap: 4 }}>
                            {template.fields.map((field) => {
                              const included = isAoiFieldIncluded(template.name, field.name);
                              const fieldName = String(field?.name || "").trim();
                              const plcType = String(field?.plcType || "").trim();
                              return (
                                <label
                                  key={`${template.name}-${field.name}`}
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "18px minmax(0,1fr)",
                                    gap: 8,
                                    alignItems: "center",
                                    minHeight: 22,
                                    cursor: "pointer",
                                  }}
                                  title={`${fieldName}${plcType ? ` (${plcType})` : ""}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={included}
                                    onChange={() => toggleAoiFieldIncluded(template.name, field.name)}
                                    style={{ width: 13, height: 13 }}
                                  />
                                  <span
                                    style={{
                                      color: included ? "var(--text)" : "var(--text-muted)",
                                      fontSize: 11,
                                      fontWeight: 600,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                      minWidth: 0,
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    <span>{fieldName || "(unnamed)"}</span>
                                    {plcType ? (
                                      <span style={{ color: "var(--text-muted)", fontWeight: 700 }}>
                                        : {plcType}
                                      </span>
                                    ) : null}
                                    {field?.isArray ? (
                                      <span style={{ color: "#2b6cff", fontWeight: 700 }}>[array]</span>
                                    ) : null}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {filteredAoiTemplates.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
                      No AOI templates match your search.
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </>
      ) : null}

      {activeTab === "aoi-logic" ? (
        <>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Source: <strong style={{ color: "var(--text)" }}>{selected?.name || "No PLC selected"}</strong>
          </div>
          {!selected ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              Select or upload an L5X/L5K file in Overview first.
            </div>
          ) : !aoiLogicBlocks.length ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              No routine ladder logic blocks found in this file.
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--bg-elev)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                flex: 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 12 }}>AOI Ladder Logic (L5X Format)</div>
                <input
                  value={aoiLogicSearch}
                  onChange={(e) => setAoiLogicSearch(e.target.value)}
                  placeholder="Search routine..."
                  style={{
                    marginLeft: "auto",
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    minWidth: 220,
                  }}
                />
              </div>
              <div style={{ display: "grid" }}>
                {filteredAoiLogicBlocks.map((block, idx) => {
                  const key = `${String(block?.name || "Routine")}-${idx}`;
                  const expanded = aoiLogicExpandedByName[key] === true;
                  return (
                    <div key={`aoi-logic-${key}`} style={{ borderTop: "1px solid var(--border)", padding: "8px 10px", display: "grid", gap: 8 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "20px 1fr", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          data-preserve-style="true"
                          onClick={() => setAoiLogicExpandedByName((prev) => ({ ...prev, [key]: !expanded }))}
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
                        >
                          {expanded ? "âˆ’" : "+"}
                        </button>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{block.name}</div>
                      </div>
                      {expanded ? (
                        <pre
                          style={{
                            margin: 0,
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: "var(--bg-soft)",
                            color: "var(--text)",
                            padding: 10,
                            fontSize: 11,
                            lineHeight: 1.45,
                            overflow: "auto",
                            whiteSpace: "pre",
                          }}
                        >
                          {String(block?.snippet || "")}
                        </pre>
                      ) : null}
                    </div>
                  );
                })}
                {filteredAoiLogicBlocks.length === 0 ? (
                  <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>No routines match your search.</div>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : null}

      {activeTab === "datatype-templates" ? (
        <>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Source: <strong style={{ color: "var(--text)" }}>{selected?.name || "Database Templates"}</strong>
          </div>
          {!dataTypeTemplates.length ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              No Data Type templates found in uploaded file or database.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                  position: "sticky",
                  top: 0,
                  zIndex: 4,
                  background: "var(--bg)",
                  padding: "6px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <input
                  value={dataTypeTemplateSearch}
                  onChange={(e) => setDataTypeTemplateSearch(e.target.value)}
                  placeholder="Search Data Type templates..."
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    minWidth: 240,
                  }}
                />
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={onCreateAllDataTypeTemplates}
                  disabled={dataTypeTemplateSavingAll}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "#fff",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: dataTypeTemplateSavingAll ? "default" : "pointer",
                    opacity: dataTypeTemplateSavingAll ? 0.75 : 1,
                  }}
                >
                  {dataTypeTemplateSavingAll ? "Creating..." : `Create All (${dataTypeTemplates.length})`}
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={onImportSelectedDataTypes}
                  disabled={dataTypeTemplateSavingAll || selectedDataTypeSet.size === 0}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: dataTypeTemplateSavingAll || selectedDataTypeSet.size === 0 ? "default" : "pointer",
                    opacity: dataTypeTemplateSavingAll || selectedDataTypeSet.size === 0 ? 0.65 : 1,
                  }}
                >
                  {`Import Selected (${selectedDataTypeSet.size})`}
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={selectAllDataTypes}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
                >
                  Select All
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={clearAllDataTypes}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={expandAllDataTypes}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
                >
                  Expand All
                </button>
                <button
                  type="button"
                  data-preserve-style="true"
                  onClick={collapseAllDataTypes}
                  style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 700 }}
                >
                  Collapse All
                </button>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Saves/updates OPC templates from Data Type member definitions.
                </div>
              </div>
              {dataTypeTemplateError ? (
                <div style={{ border: "1px solid #f04438", background: "rgba(240,68,56,0.08)", color: "#f04438", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
                  {dataTypeTemplateError}
                </div>
              ) : null}
              {dataTypeTemplateStatus ? (
                <div style={{ border: "1px solid #12b76a", background: "rgba(18,183,106,0.08)", color: "#12b76a", borderRadius: 8, padding: "8px 10px", fontSize: 12 }}>
                  {dataTypeTemplateStatus}
                </div>
              ) : null}
              <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg-elev)", overflow: "hidden" }}>
                <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 12 }}>
                  Parsed Data Type Templates ({filteredDataTypeTemplates.length}/{dataTypeTemplates.length})
                </div>
                <div style={{ display: "grid", gap: 0 }}>
                  {filteredDataTypeTemplates.map((template) => (
                    <div
                      key={`datatype-template-${template.name}`}
                      style={{
                        borderTop: "1px solid var(--border)",
                        padding: "8px 10px",
                        display: "grid",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "grid", gridTemplateColumns: "20px auto 1fr", gap: 8, alignItems: "center" }}>
                        <button
                          type="button"
                          data-preserve-style="true"
                          onClick={() => toggleDataTypeExpanded(template.name)}
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
                          title={
                            expandedDataTypeSet.has(String(template.name || "").trim().toLowerCase())
                              ? "Collapse"
                              : "Expand"
                          }
                        >
                          {expandedDataTypeSet.has(String(template.name || "").trim().toLowerCase()) ? "âˆ’" : "+"}
                        </button>
                        <input
                          type="checkbox"
                          checked={selectedDataTypeSet.has(String(template.name || "").trim().toLowerCase())}
                          onChange={() => toggleDataTypeSelected(template.name)}
                          style={{ width: 14, height: 14 }}
                        />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{template.name}</div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {template.fields.length} field(s)
                          </div>
                        </div>
                      </div>
                      {expandedDataTypeSet.has(String(template.name || "").trim().toLowerCase()) ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              data-preserve-style="true"
                              onClick={() => includeAllDataTypeFields(template.name)}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 700 }}
                            >
                              Include All Fields
                            </button>
                            <button
                              type="button"
                              data-preserve-style="true"
                              onClick={() => excludeAllDataTypeFields(template.name)}
                              style={{ border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)", borderRadius: 8, padding: "3px 8px", fontSize: 10, fontWeight: 700 }}
                            >
                              Exclude All Fields
                            </button>
                          </div>
                          {renderDataTypeFieldTree(
                            template.name,
                            Array.isArray(template.fields) ? template.fields : [],
                            [String(template.name || "").trim().toLowerCase()],
                            0
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {filteredDataTypeTemplates.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 12, color: "var(--text-muted)" }}>
                      No Data Type templates match your search.
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </>
      ) : null}

      {activeTab === "code-gen-pro" ? (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          {!codeGenReady ? (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--bg-elev)",
                minHeight: 0,
                flex: 1,
                display: "grid",
                placeItems: "center",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              Loading Code Gen Pro...
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "var(--bg-elev)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                flex: 1,
                height: "100%",
              }}
            >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 8,
                  padding: "8px 10px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-soft)",
                }}
                >
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  User Tags <strong style={{ color: "var(--text)" }}>{codeGenUserTags.length}</strong>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Groups <strong style={{ color: "var(--text)" }}>{codeGenGroups.length}</strong>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Grouped Tags <strong style={{ color: "var(--text)" }}>{codeGenAssignedTagSet.size}</strong>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Ungrouped Tags{" "}
                  <strong style={{ color: "var(--text)" }}>
                    {Math.max(codeGenUserTags.length - codeGenAssignedTagSet.size, 0)}
                  </strong>
                </div>
              </div>

              <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 0, flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={codeGenFormat}
                    onChange={(e) => setCodeGenFormat(normalizeCodeGenFormat(e.target.value))}
                    style={{
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text)",
                      borderRadius: 8,
                      padding: "6px 10px",
                      fontSize: 11,
                      minWidth: 220,
                    }}
                  >
                    <option value="l5x-template">L5X Starter Template</option>
                    <option value="list">Tag + Equipment CSV</option>
                    <option value="io-map">Tag + Equipment + Group CSV</option>
                  </select>
                  <div style={{ marginLeft: "auto", display: "inline-flex", gap: 8 }}>
                    <button
                      type="button"
                      data-preserve-style="true"
                      onClick={exportCodeGenOutput}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg-elev)",
                        color: "var(--text)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Export
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  Route template is loaded from the saved profile/global base and used for L5X generation.
                  {codeGenTemplateRouteName ? ` Source route: ${codeGenTemplateRouteName}.` : ""}
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg)",
                    overflow: "hidden",
                    display: "grid",
                    gridTemplateRows: "auto 1fr",
                    minHeight: 0,
                    flex: 1,
                  }}
                >
                  <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700 }}>
                    Tag Organizer
                  </div>
                  <div
                    ref={codeGenPanelsHostRef}
                    style={{
                      display: "grid",
                      gridTemplateColumns: `minmax(220px, ${Math.max(codeGenPanelRatios[0], 0.01)}fr) 6px minmax(220px, ${Math.max(codeGenPanelRatios[1], 0.01)}fr) 6px minmax(220px, ${Math.max(codeGenPanelRatios[2], 0.01)}fr)`,
                      gap: 0,
                      minHeight: 0,
                      height: "100%",
                    }}
                  >
                    <div style={{ borderRight: "1px solid var(--border)", display: "grid", gridTemplateRows: "auto auto 1fr", minWidth: 0, minHeight: 0 }}>
                      <div style={{ padding: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(150px,1fr) auto auto", gap: 6, marginBottom: 6 }}>
                          <input
                            value={codeGenNewTagDraft}
                            onChange={(e) => setCodeGenNewTagDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              addCodeGenTag(codeGenNewTagDraft, codeGenNewTagEquipmentDraft);
                            }}
                            placeholder="Add tag"
                            style={{
                              width: "100%",
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              height: 30,
                              fontSize: 11,
                              boxSizing: "border-box",
                            }}
                          />
                          <select
                            value={codeGenNewTagEquipmentDraft}
                            onChange={(e) => setCodeGenNewTagEquipmentDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              addCodeGenTag(codeGenNewTagDraft, codeGenNewTagEquipmentDraft);
                            }}
                            style={{
                              width: "100%",
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              height: 30,
                              fontSize: 11,
                              boxSizing: "border-box",
                            }}
                          >
                            <option value="">Equipment type</option>
                            {codeGenEquipmentTypeOptions.map((type) => (
                              <option key={`codegen-equip-option-${type}`} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            data-preserve-style="true"
                            onClick={() => removeCodeGenEquipmentTypeOption(codeGenNewTagEquipmentDraft)}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text-muted)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              height: 30,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                            title="Remove selected equipment type"
                          >
                            Remove Type
                          </button>
                          <button
                            type="button"
                            data-preserve-style="true"
                            onClick={() => addCodeGenTag(codeGenNewTagDraft, codeGenNewTagEquipmentDraft)}
                            style={{
                              border: "1px solid #2b6cff",
                              background: "#2b6cff",
                              color: "#fff",
                              borderRadius: 8,
                              padding: "6px 10px",
                              height: 30,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Add
                          </button>
                          <label
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "0 10px",
                              boxSizing: "border-box",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              height: 30,
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                              lineHeight: 1,
                              gridColumn: "1 / -1",
                              justifySelf: "start",
                            }}
                            title="Import tags from CSV"
                          >
                            Import CSV
                            <input
                              type="file"
                              accept=".csv,text/csv"
                              onChange={importCodeGenTagsFromCsv}
                              style={{ display: "none" }}
                            />
                          </label>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 170px 110px", gap: 6 }}>
                          <input
                            value={codeGenTagSearch}
                            onChange={(e) => setCodeGenTagSearch(e.target.value)}
                            placeholder="Search tags..."
                            style={{
                              width: "100%",
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              height: 30,
                              fontSize: 11,
                              boxSizing: "border-box",
                            }}
                          />
                          <select
                            value={codeGenTagSortBy}
                            onChange={(e) => {
                              const value = String(e.target.value || "name").trim().toLowerCase() === "equipment" ? "equipment" : "name";
                              setCodeGenTagSortByByPlc((prev) => ({ ...(prev || {}), [chatKey]: value }));
                            }}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 8px",
                              height: 30,
                              fontSize: 11,
                            }}
                            title="Sort field"
                          >
                            <option value="name">Sort: Name</option>
                            <option value="equipment">Sort: Equipment</option>
                          </select>
                          <select
                            value={codeGenTagSortDir}
                            onChange={(e) => {
                              const value = String(e.target.value || "asc").trim().toLowerCase() === "desc" ? "desc" : "asc";
                              setCodeGenTagSortDirByPlc((prev) => ({ ...(prev || {}), [chatKey]: value }));
                            }}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 8px",
                              height: 30,
                              fontSize: 11,
                            }}
                            title="Sort direction"
                          >
                            <option value="asc">Asc</option>
                            <option value="desc">Desc</option>
                          </select>
                        </div>
                        <div style={{ borderTop: "1px solid var(--border)", marginTop: 6 }} />
                      </div>
                      <div className="vizi-scroll" style={{ overflow: "auto", padding: "0 8px 8px 8px", display: "grid", gap: 6, alignContent: "start" }}>
                        {filteredCodeGenTags.map((tag) => {
                          const grouped = codeGenAssignedTagSet.has(tag);
                          const equipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").trim();
                          const selectedTag = String(codeGenSelectedTag || "") === tag;
                          return (
                            <div
                              key={`codegen-tag-${tag}`}
                              draggable
                              onClick={() =>
                                setCodeGenSelectedTagByPlc((prev) => ({ ...(prev || {}), [chatKey]: tag }))
                              }
                              onDragStart={(e) => {
                                setCodeGenDragTag(tag);
                                e.dataTransfer?.setData("application/x-vizi-tag", tag);
                                e.dataTransfer?.setData("text/plain", tag);
                              }}
                              onDragEnd={() => {
                                setCodeGenDragTag("");
                                setCodeGenTagDropTargetGroupId("");
                              }}
                              style={{
                                border: selectedTag ? "1px solid #2b6cff" : "1px solid var(--border)",
                                borderRadius: 8,
                                padding: 4,
                                fontSize: 11,
                                color: "var(--text)",
                                background: grouped ? "color-mix(in srgb, #2b6cff 10%, var(--bg-elev))" : "var(--bg-elev)",
                                cursor: "grab",
                                display: "grid",
                                gap: 4,
                                userSelect: "none",
                              }}
                              title={tag}
                            >
                              <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) minmax(80px,auto) auto", gap: 5, alignItems: "center" }}>
                                <div
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg)",
                                    color: "var(--text)",
                                    borderRadius: 6,
                                    height: 18,
                                    padding: "0 6px",
                                    lineHeight: "16px",
                                    fontSize: 11,
                                    fontWeight: 700,
                                    minWidth: 0,
                                    display: "flex",
                                    alignItems: "center",
                                  }}
                                  title={tag}
                                >
                                  {tag}
                                </div>
                                <div
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg)",
                                    color: equipmentType ? "var(--text)" : "var(--text-muted)",
                                    borderRadius: 6,
                                    height: 18,
                                    padding: "0 6px",
                                    lineHeight: "16px",
                                    fontSize: 9,
                                    fontWeight: 700,
                                    minWidth: 0,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                  title={equipmentType || "No equipment type"}
                                >
                                  {equipmentType || "Type"}
                                </div>
                                <button
                                  type="button"
                                  data-preserve-style="true"
                                  onClick={() => removeCodeGenTag(tag)}
                                  style={{
                                    border: "1px solid #f04438",
                                    background: "#f04438",
                                    color: "#fff",
                                    borderRadius: 6,
                                    width: 18,
                                    height: 18,
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 11,
                                    lineHeight: 1,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                  title="Delete tag"
                                  aria-label="Delete tag"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        {!filteredCodeGenTags.length ? (
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No tags match search.</div>
                        ) : null}
                      </div>
                    </div>
                    <div
                      onMouseDown={(e) => beginCodeGenPanelResize(0, e)}
                      style={{
                        cursor: "col-resize",
                        borderLeft: "1px solid var(--border)",
                        borderRight: "1px solid var(--border)",
                        background: "color-mix(in srgb, var(--bg-elev) 55%, var(--bg))",
                        userSelect: "none",
                      }}
                      title="Resize panels"
                    />

                    <div style={{ borderRight: "1px solid var(--border)", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0, minWidth: 0 }}>
                      <div style={{ padding: 8, borderBottom: "1px solid var(--border)", display: "grid", gap: 6 }}>
                        <div style={{ display: "grid", gridTemplateColumns: codeGenGroupTypeDraft === "Group" ? "minmax(120px,1fr) minmax(120px,1fr) minmax(120px,1fr) 56px" : "minmax(120px,1fr) minmax(120px,1fr) 56px", gap: 6 }}>
                          <select
                            value={codeGenGroupTypeDraft}
                            onChange={(e) => {
                              const nextType = normalizeCodeGenGroupType(String(e.target.value || "Group"));
                              setCodeGenGroupTypeDraft(nextType);
                              if (nextType === "Route") {
                                setCodeGenGroupParentDraft("");
                                setCodeGenSelectedGroupId("");
                                setCodeGenSelectedTagByPlc((prev) => ({ ...(prev || {}), [chatKey]: "" }));
                              }
                            }}
                            style={{
                              width: "100%",
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 8px",
                              height: 30,
                              fontSize: 11,
                              boxSizing: "border-box",
                            }}
                          >
                            {CODE_GEN_GROUP_TYPES.map((groupType) => (
                              <option key={`group-type-opt-${groupType}`} value={groupType}>
                                {groupType}
                              </option>
                            ))}
                          </select>
                          {codeGenGroupTypeDraft === "Group" ? (
                            <select
                              value={codeGenGroupSubTypeDraft}
                              onChange={(e) => setCodeGenGroupSubTypeDraft(String(e.target.value || "Feed"))}
                              style={{
                                width: "100%",
                                border: "1px solid var(--border)",
                                background: "var(--bg-elev)",
                                color: "var(--text)",
                                borderRadius: 8,
                                padding: "6px 8px",
                                height: 30,
                                fontSize: 11,
                                boxSizing: "border-box",
                              }}
                            >
                              {CODE_GEN_GROUP_SUBTYPES.map((subType) => (
                                <option key={`group-subtype-opt-${subType}`} value={subType}>
                                  {subType}
                                </option>
                              ))}
                            </select>
                          ) : null}
                          <input
                            value={codeGenGroupNameDraft}
                            title={getCodeGenObjectInputTooltip(codeGenGroupTypeDraft)}
                            onChange={(e) => {
                              const raw = String(e.target.value || "");
                              const draftType = normalizeCodeGenGroupType(codeGenGroupTypeDraft);
                              if (
                                draftType === "Group" ||
                                draftType === "Route" ||
                                draftType === "SubRoute" ||
                                draftType === "Sender" ||
                                draftType === "Receiver" ||
                                draftType === "Bin"
                              ) {
                                setCodeGenGroupNameDraft(raw.replace(/[^\d,-]/g, ""));
                                return;
                              }
                              setCodeGenGroupNameDraft(raw);
                            }}
                            inputMode={
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Group" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Route" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "SubRoute" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Sender" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Receiver" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Bin"
                                ? "numeric"
                                : "text"
                            }
                            pattern={
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Group" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Route" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "SubRoute" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Bin" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Sender" ||
                              normalizeCodeGenGroupType(codeGenGroupTypeDraft) === "Receiver"
                                ? "\\d+(?:-\\d+)?(?:,\\d+(?:-\\d+)?)*"
                                : undefined
                            }
                            placeholder={getCodeGenObjectNameHint(codeGenGroupTypeDraft)}
                            style={{
                              width: "100%",
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 8px",
                              height: 30,
                              fontSize: 11,
                              boxSizing: "border-box",
                            }}
                          />
                          <button
                            type="button"
                            data-preserve-style="true"
                            onClick={createCodeGenGroup}
                            style={{
                              width: "100%",
                              border: "1px solid #2b6cff",
                              background: "#2b6cff",
                              color: "#fff",
                              borderRadius: 8,
                              padding: "6px 10px",
                              height: 30,
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Add
                          </button>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 6 }}>
                          <input
                            value={codeGenTagSearch}
                            onChange={(e) => setCodeGenTagSearch(e.target.value)}
                            placeholder="Search objects..."
                            style={{
                              width: "100%",
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              height: 30,
                              fontSize: 11,
                              boxSizing: "border-box",
                            }}
                          />
                        </div>
                      </div>
                      <div
                        style={{
                          minHeight: 0,
                          display: "grid",
                          gridTemplateColumns: "minmax(0, 1fr)",
                          gap: 8,
                          padding: 8,
                        }}
                      >
                        <div className="vizi-scroll" style={{ overflow: "auto", display: "grid", gap: 6, alignContent: "start" }}>
                          {codeGenTreeLoading ? (
                            <div
                              style={{
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: 4,
                                fontSize: 11,
                                color: "var(--text-muted)",
                                background: "color-mix(in srgb, rgba(148,163,184,0.06) 100%, var(--bg-elev))",
                              }}
                            >
                              <div style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) minmax(100px,auto) auto", gap: 5, alignItems: "center" }}>
                                <span
                                  style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: 5,
                                    width: 18,
                                    height: 18,
                                    display: "grid",
                                    placeItems: "center",
                                    fontWeight: 700,
                                    lineHeight: 1,
                                    background: "var(--bg)",
                                    opacity: 0.8,
                                  }}
                                >
                                  ·
                                </span>
                                <span
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg)",
                                    color: "var(--text-muted)",
                                    borderRadius: 6,
                                    height: 18,
                                    padding: "0 6px",
                                    lineHeight: "16px",
                                    overflow: "hidden",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  Loading tree...
                                </span>
                                <span
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg)",
                                    color: "var(--text-muted)",
                                    borderRadius: 6,
                                    height: 18,
                                    padding: "0 6px",
                                    lineHeight: "16px",
                                  }}
                                >
                                  Group
                                </span>
                                <span
                                  style={{
                                    border: "1px solid #f04438",
                                    color: "#f04438",
                                    borderRadius: 6,
                                    width: 18,
                                    height: 18,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    lineHeight: 1,
                                    fontWeight: 700,
                                  }}
                                >
                                  ×
                                </span>
                              </div>
                            </div>
                          ) : (() => {
                          const rootGroups = codeGenGroups
                            .filter((g) => !String(g?.parentId || "").trim());
                          const byGroupId = new Map(
                            codeGenGroups.map((g) => [String(g?.id || "").trim(), g])
                          );
                          const canDropGroupOnParent = (dragGroupIdRaw, parentIdRaw) => {
                            const dragGroupId = String(dragGroupIdRaw || "").trim();
                            const parentId = String(parentIdRaw || "").trim();
                            if (!dragGroupId) return false;
                            const dragGroup = byGroupId.get(dragGroupId) || null;
                            if (!dragGroup) return false;
                            const currentParentId = String(dragGroup?.parentId || "").trim();
                            if (currentParentId === parentId) return true;
                            const dragType = normalizeCodeGenGroupType(dragGroup?.groupType).toLowerCase();
                            if (dragType === "route") return !parentId;
                            const parentGroup = parentId ? byGroupId.get(parentId) || null : null;
                            const parentType = normalizeCodeGenGroupType(parentGroup?.groupType).toLowerCase();
                            if (dragType === "subroute" || dragType === "sender" || dragType === "receiver" || dragType === "group") {
                              return parentType === "route";
                            }
                            // Other non-route types must still remain under some route.
                            if (!parentId) return false;
                            let cursorId = parentId;
                            let guard = 0;
                            while (cursorId && guard < 200) {
                              const cursor = byGroupId.get(cursorId);
                              if (!cursor) break;
                              if (normalizeCodeGenGroupType(cursor?.groupType).toLowerCase() === "route") return true;
                              cursorId = String(cursor?.parentId || "").trim();
                              guard += 1;
                            }
                            return false;
                          };
                          const childrenByParent = new Map();
                          codeGenGroups.forEach((g) => {
                            const parent = String(g?.parentId || "").trim();
                            if (!parent) return;
                            if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
                            childrenByParent.get(parent).push(g);
                          });
                          const treeSearch = String(codeGenTagSearch || "").trim().toLowerCase();
                          const tagMatchesSearch = (tagNameRaw) => {
                            const tagName = String(tagNameRaw || "").trim();
                            if (!treeSearch) return true;
                            const equipmentType = String(codeGenTagMeta?.[tagName]?.equipmentType || "").trim().toLowerCase();
                            return tagName.toLowerCase().includes(treeSearch) || equipmentType.includes(treeSearch);
                          };
                          const groupMatchesSelf = (g) => {
                            if (!treeSearch) return true;
                            const name = String(g?.name || "").trim().toLowerCase();
                            const type = normalizeCodeGenGroupType(g?.groupType).toLowerCase();
                            const subType = String(g?.groupSubType || "").trim().toLowerCase();
                            return name.includes(treeSearch) || type.includes(treeSearch) || subType.includes(treeSearch);
                          };
                          const groupMatchesTree = (groupIdRaw, path = new Set()) => {
                            const groupId = String(groupIdRaw || "").trim();
                            if (!groupId) return false;
                            if (path.has(groupId)) return false;
                            const row = byGroupId.get(groupId);
                            if (!row) return false;
                            if (groupMatchesSelf(row)) return true;
                            const tags = (Array.isArray(row?.tags) ? row.tags : []).map((x) => String(x || "").trim()).filter(Boolean);
                            if (tags.some((tag) => tagMatchesSearch(tag))) return true;
                            const nextPath = new Set(path);
                            nextPath.add(groupId);
                            const children = childrenByParent.get(groupId) || [];
                            return children.some((child) => groupMatchesTree(String(child?.id || ""), nextPath));
                          };
                          const renderGroupNode = (group, depth = 0, path = new Set()) => {
                            const id = String(group?.id || "");
                            if (!id) return null;
                            const isDropAllowed = normalizeCodeGenGroupType(group?.groupType) === "Group";
                            const isSelected = String(codeGenSelectedGroupId || "") === id;
                            const dragGroupId = String(codeGenDragGroupId || "").trim();
                            const targetParentId = String(group?.parentId || "").trim();
                            const canDropBeforeThisRow = !!dragGroupId && canDropGroupOnParent(dragGroupId, targetParentId);
                            const canDropIntoThisRow = !!dragGroupId && canDropGroupOnParent(dragGroupId, id);
                            const isGroupDropHover =
                              canDropBeforeThisRow && String(codeGenGroupDropTargetId || "") === id;
                            const isGroupParentDropHover =
                              canDropIntoThisRow && String(codeGenGroupDropParentTargetId || "") === id;
                            const typeKey = String(group?.groupType || "").trim().toLowerCase();
                            const typeTint = (() => {
                              if (typeKey === "route") return "rgba(37,99,235,0.12)";
                              if (typeKey === "subroute") return "rgba(22,163,74,0.12)";
                              if (typeKey === "sender") return "rgba(217,119,6,0.12)";
                              if (typeKey === "receiver") return "rgba(8,145,178,0.12)";
                              if (typeKey === "bin") return "rgba(79,70,229,0.12)";
                              if (typeKey === "group") {
                                return "rgba(100,116,139,0.12)";
                              }
                              if (typeKey === "equipment") return "rgba(225,29,72,0.12)";
                              return "rgba(107,114,128,0.10)";
                            })();
                            const isCycle = path.has(id);
                            const allChildren = childrenByParent.get(id) || [];
                            const subviewCount = allChildren.length;
                            const groupTagCount = (Array.isArray(group?.tags) ? group.tags : [])
                              .map((x) => String(x || "").trim())
                              .filter(Boolean).length;
                            const isGroupType = normalizeCodeGenGroupType(group?.groupType) === "Group";
                            const rowCountValue = isGroupType ? groupTagCount : subviewCount;
                            const rowCountTitle = isGroupType ? "Tag count" : "SubView count";
                            const children = allChildren.filter((child) => groupMatchesTree(String(child?.id || "")));
                            const tags = (Array.isArray(group?.tags) ? group.tags : [])
                              .map((x) => String(x || "").trim())
                              .filter(Boolean)
                              .filter((tag) => tagMatchesSearch(tag))
                              .sort((a, b) => {
                                const nameA = String(a || "").trim();
                                const nameB = String(b || "").trim();
                                const equipA = String(codeGenTagMeta?.[a]?.equipmentType || "").trim();
                                const equipB = String(codeGenTagMeta?.[b]?.equipmentType || "").trim();
                                if (codeGenTagSortBy === "equipment") {
                                  const byEquip = equipA.localeCompare(equipB);
                                  if (byEquip !== 0) return codeGenTagSortDir === "desc" ? -byEquip : byEquip;
                                  const byName = nameA.localeCompare(nameB);
                                  return codeGenTagSortDir === "desc" ? -byName : byName;
                                }
                                const byName = nameA.localeCompare(nameB);
                                if (byName !== 0) return codeGenTagSortDir === "desc" ? -byName : byName;
                                const byEquip = equipA.localeCompare(equipB);
                                return codeGenTagSortDir === "desc" ? -byEquip : byEquip;
                              });
                            const hasChildren = children.length > 0 || tags.length > 0;
                            const expanded = codeGenExpandedSet.has(id);
                            const nextPath = new Set(path);
                            nextPath.add(id);
                            return (
                              <div key={`group-node-${id}`} style={{ marginLeft: depth * 12, display: "grid", gap: 3 }}>
                                <div
                                  draggable
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const menuWidth = 110;
                                    const menuHeight = 34;
                                    let x = Number(e.clientX || 0) + 2;
                                    let y = Number(e.clientY || 0) + 2;
                                    if (x + menuWidth > window.innerWidth - 8) x = Math.max(8, window.innerWidth - menuWidth - 8);
                                    if (y + menuHeight > window.innerHeight - 8) y = Math.max(8, window.innerHeight - menuHeight - 8);
                                    setCodeGenObjectContextMenu({
                                      groupId: id,
                                      x,
                                      y,
                                    });
                                  }}
                                  onClick={() => {
                                    setCodeGenGroupParentDraft(id);
                                    setCodeGenSelectedGroupId(id);
                                    setCodeGenSelectedTagByPlc((prev) => ({ ...(prev || {}), [chatKey]: "" }));
                                  }}
                                  onDragStart={(e) => {
                                    setCodeGenDragGroupId(id);
                                    e.dataTransfer?.setData("application/x-vizi-group", id);
                                    e.dataTransfer?.setData("text/plain", id);
                                  }}
                                  onDragEnd={() => {
                                    setCodeGenDragGroupId("");
                                    setCodeGenGroupDropTargetId("");
                                    setCodeGenGroupDropParentTargetId("");
                                    setCodeGenTagDropTargetGroupId("");
                                  }}
                                  onDragOver={(e) => {
                                    const dragGroup = String(e.dataTransfer?.getData("application/x-vizi-group") || codeGenDragGroupId || "").trim();
                                    const dragTag = String(e.dataTransfer?.getData("application/x-vizi-tag") || codeGenDragTag || "").trim();
                                    if (!dragGroup && (!isDropAllowed || !dragTag)) return;
                                    if (dragGroup) {
                                      if (canDropGroupOnParent(dragGroup, id)) {
                                        e.preventDefault();
                                        if (String(codeGenGroupDropParentTargetId || "") !== id) setCodeGenGroupDropParentTargetId(id);
                                        if (String(codeGenGroupDropTargetId || "") === id) setCodeGenGroupDropTargetId("");
                                      } else if (canDropGroupOnParent(dragGroup, targetParentId)) {
                                        e.preventDefault();
                                        if (String(codeGenGroupDropParentTargetId || "") === id) setCodeGenGroupDropParentTargetId("");
                                        if (String(codeGenGroupDropTargetId || "") !== id) setCodeGenGroupDropTargetId(id);
                                      } else {
                                        if (String(codeGenGroupDropParentTargetId || "") === id) setCodeGenGroupDropParentTargetId("");
                                        setCodeGenGroupDropTargetId("");
                                      }
                                    }
                                    if (!dragGroup && isDropAllowed && dragTag) {
                                      e.preventDefault();
                                      if (String(codeGenTagDropTargetGroupId || "") !== id) {
                                        setCodeGenTagDropTargetGroupId(id);
                                      }
                                    }
                                  }}
                                  onDragEnter={(e) => {
                                    const dragTag = String(e.dataTransfer?.getData("application/x-vizi-tag") || codeGenDragTag || "").trim();
                                    if (!isDropAllowed || !dragTag) return;
                                    e.preventDefault();
                                    if (String(codeGenTagDropTargetGroupId || "") !== id) setCodeGenTagDropTargetGroupId(id);
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    setCodeGenGroupDropTargetId("");
                                    setCodeGenGroupDropParentTargetId("");
                                    setCodeGenTagDropTargetGroupId("");
                                    const droppedGroup = String(
                                      e.dataTransfer?.getData("application/x-vizi-group") || codeGenDragGroupId || ""
                                    ).trim();
                                    if (droppedGroup) {
                                      if (canDropGroupOnParent(droppedGroup, id)) {
                                        reorderCodeGenGroupToParentEnd(droppedGroup, id);
                                        setCodeGenDragGroupId("");
                                        return;
                                      }
                                      if (!canDropGroupOnParent(droppedGroup, targetParentId)) {
                                        setCodeGenDragGroupId("");
                                        return;
                                      }
                                      reorderCodeGenGroup(droppedGroup, id);
                                      setCodeGenDragGroupId("");
                                      return;
                                    }
                                    const dropped = String(
                                      e.dataTransfer?.getData("application/x-vizi-tag") ||
                                      e.dataTransfer?.getData("text/plain") ||
                                      codeGenDragTag ||
                                      ""
                                    ).trim();
                                    if (!dropped) return;
                                    moveTagToGroup(dropped, id);
                                  }}
                                  style={{
                                    border:
                                      String(codeGenTagDropTargetGroupId || "") === id
                                        ? "1px solid #2b6cff"
                                        : isGroupParentDropHover
                                          ? "2px dashed #2b6cff"
                                        : isSelected
                                          ? "1px solid #2b6cff"
                                        : "1px solid var(--border)",
                                    borderRadius: 8,
                                    background:
                                      String(codeGenTagDropTargetGroupId || "") === id
                                        ? `color-mix(in srgb, #2b6cff 10%, color-mix(in srgb, ${typeTint} 100%, var(--bg-elev)))`
                                        : isGroupParentDropHover
                                          ? `color-mix(in srgb, #2b6cff 10%, color-mix(in srgb, ${typeTint} 100%, var(--bg-elev)))`
                                        : `color-mix(in srgb, ${typeTint} 100%, var(--bg-elev))`,
                                    padding: 4,
                                    marginTop: isGroupDropHover ? 8 : 0,
                                    marginBottom: isGroupDropHover ? 8 : 0,
                                    display: "grid",
                                    gap: 2,
                                    cursor: String(codeGenDragGroupId || "") === id ? "grabbing" : "grab",
                                    position: "relative",
                                    boxShadow: isGroupParentDropHover
                                      ? "0 0 0 2px color-mix(in srgb, #2b6cff 28%, transparent), 0 0 12px color-mix(in srgb, #2b6cff 35%, transparent)"
                                      : "none",
                                    transition: "box-shadow 120ms ease, border-color 120ms ease",
                                  }}
                                >
                                  {isGroupDropHover ? (
                                    <div
                                      style={{
                                        position: "absolute",
                                        left: 6,
                                        right: 6,
                                        top: -7,
                                        borderTop: "2px dashed #2b6cff",
                                        pointerEvents: "none",
                                      }}
                                    />
                                  ) : null}
                                  <div style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) minmax(92px,auto) minmax(68px,auto) auto", gap: 5, alignItems: "center" }}>
                                    <button
                                      type="button"
                                      data-preserve-style="true"
                                      onClick={() => toggleCodeGenGroupExpanded(id)}
                                      style={{
                                        border: "1px solid var(--border)",
                                        background: "var(--bg)",
                                        color: "var(--text)",
                                        borderRadius: 5,
                                        width: 18,
                                        height: 18,
                                        fontSize: 10,
                                        fontWeight: 700,
                                        lineHeight: 1,
                                        padding: 0,
                                        opacity: hasChildren ? 1 : 0.45,
                                        cursor: hasChildren ? "pointer" : "default",
                                      }}
                                    >
                                      {hasChildren ? (expanded ? "-" : "+") : "·"}
                                    </button>
                                    <div
                                      style={{
                                        border: "1px solid var(--border)",
                                        background: "var(--bg)",
                                        color: "var(--text)",
                                        borderRadius: 6,
                                        height: 18,
                                        padding: "0 6px",
                                        lineHeight: "16px",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        minWidth: 0,
                                        display: "flex",
                                        alignItems: "center",
                                      }}
                                      title={String(group?.name || "")}
                                    >
                                      {String(group?.name || "")}
                                    </div>
                                    <div
                                      style={{
                                        border: "1px solid var(--border)",
                                        background: "var(--bg)",
                                        color: "var(--text)",
                                        borderRadius: 6,
                                        height: 18,
                                        padding: "0 6px",
                                        lineHeight: "16px",
                                        fontSize: 9,
                                        fontWeight: 700,
                                        display: "flex",
                                        alignItems: "center",
                                      }}
                                      title="Group type"
                                    >
                                      {normalizeCodeGenGroupType(group?.groupType) === "Group" && String(group?.groupSubType || "").trim()
                                        ? String(group?.groupSubType || "").trim()
                                        : normalizeCodeGenGroupType(group?.groupType)}
                                    </div>
                                    <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "flex-end" }}>
                                      {rowCountValue > 0 ? (
                                        <div
                                          style={{
                                            border: "1px solid var(--border)",
                                            background: "var(--bg)",
                                            color: "var(--text)",
                                            borderRadius: 6,
                                            height: 18,
                                            minWidth: 22,
                                            padding: "0 6px",
                                            lineHeight: "16px",
                                            fontSize: 9,
                                            fontWeight: 700,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            whiteSpace: "nowrap",
                                          }}
                                          title={rowCountTitle}
                                        >
                                          {rowCountValue}
                                        </div>
                                      ) : null}
                                    </div>
                                    <button
                                      type="button"
                                      data-preserve-style="true"
                                      onClick={() => deleteCodeGenGroup(id)}
                                      style={{
                                        border: "1px solid #f04438",
                                        background: "#f04438",
                                        color: "#fff",
                                        borderRadius: 6,
                                        width: 18,
                                        height: 18,
                                        padding: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 10,
                                        lineHeight: 1,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                      }}
                                      title="Delete group"
                                      aria-label="Delete group"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                                {hasChildren && expanded && !isCycle ? (
                                  <div style={{ display: "grid", gap: 6 }}>
                                    {tags.map((tag) => (
                                      (() => {
                                        const tagEquipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").trim();
                                        const isTagSelected = String(codeGenSelectedTag || "") === tag;
                                        return (
                                      <div
                                        key={`group-tag-${id}-${tag}`}
                                        draggable
                                        onClick={() => {
                                          setCodeGenSelectedGroupId(id);
                                          setCodeGenSelectedTagByPlc((prev) => ({ ...(prev || {}), [chatKey]: tag }));
                                        }}
                                        onDragStart={(e) => {
                                          setCodeGenDragTag(tag);
                                          e.dataTransfer?.setData("application/x-vizi-tag", tag);
                                          e.dataTransfer?.setData("text/plain", tag);
                                        }}
                                        onDragEnd={() => setCodeGenDragTag("")}
                                        style={{
                                          marginLeft: (depth + 1) * 12,
                                          border: isTagSelected ? "1px solid #2b6cff" : "1px solid var(--border)",
                                          background: "color-mix(in srgb, rgba(168,85,247,0.14) 100%, var(--bg))",
                                          color: "var(--text)",
                                          borderRadius: 6,
                                          padding: 3,
                                          fontSize: 10,
                                          fontWeight: 700,
                                          display: "grid",
                                          gridTemplateColumns: "18px minmax(0,1fr) minmax(80px,auto) auto",
                                          alignItems: "center",
                                          gap: 5,
                                          cursor: "grab",
                                        }}
                                      >
                                        <div
                                          style={{
                                            border: "1px solid var(--border)",
                                            background: "var(--bg-elev)",
                                            color: "var(--text-muted)",
                                            borderRadius: 5,
                                            width: 18,
                                            height: 18,
                                            display: "grid",
                                            placeItems: "center",
                                            fontSize: 9,
                                            lineHeight: 1,
                                          }}
                                        >
                                          •
                                        </div>
                                        <div
                                          style={{
                                            border: "1px solid var(--border)",
                                            background: "var(--bg-elev)",
                                            color: "var(--text)",
                                            borderRadius: 6,
                                            height: 18,
                                            padding: "0 6px",
                                            lineHeight: "16px",
                                            fontSize: 10,
                                            fontWeight: 700,
                                            minWidth: 0,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                          }}
                                          title={tag}
                                        >
                                          {tag}
                                        </div>
                                        <div
                                          style={{
                                            border: "1px solid var(--border)",
                                            background: "var(--bg-elev)",
                                            color: tagEquipmentType ? "var(--text)" : "var(--text-muted)",
                                            borderRadius: 6,
                                            height: 18,
                                            padding: "0 6px",
                                            lineHeight: "16px",
                                            fontSize: 9,
                                            fontWeight: 700,
                                            display: "flex",
                                            alignItems: "center",
                                          }}
                                          title={tagEquipmentType || "No equipment type"}
                                        >
                                          {tagEquipmentType || "Tag"}
                                        </div>
                                        <button
                                          type="button"
                                          data-preserve-style="true"
                                          onClick={() => removeTagFromGroup(tag, id)}
                                          style={{
                                            border: "1px solid #f04438",
                                            background: "#f04438",
                                            color: "#fff",
                                            borderRadius: 6,
                                            width: 18,
                                            height: 18,
                                            padding: 0,
                                            fontSize: 10,
                                            lineHeight: 1,
                                            fontWeight: 700,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: "pointer",
                                          }}
                                          title="Remove from group"
                                          aria-label="Remove from group"
                                        >
                                          ×
                                        </button>
                                      </div>
                                        );
                                      })()
                                    ))}
                                    {children.map((child) => renderGroupNode(child, depth + 1, nextPath))}
                                    {String(codeGenDragGroupId || "").trim() && canDropGroupOnParent(codeGenDragGroupId, id) ? (
                                      <div
                                        onDragOver={(e) => {
                                          const dragGroup = String(
                                            e.dataTransfer?.getData("application/x-vizi-group") || codeGenDragGroupId || ""
                                          ).trim();
                                          if (!dragGroup || !canDropGroupOnParent(dragGroup, id)) return;
                                          e.preventDefault();
                                          setCodeGenGroupDropTargetId(`end:${id}`);
                                        }}
                                        onDragLeave={() => {
                                          if (String(codeGenGroupDropTargetId || "") === `end:${id}`) setCodeGenGroupDropTargetId("");
                                        }}
                                        onDrop={(e) => {
                                          e.preventDefault();
                                          setCodeGenGroupDropTargetId("");
                                          setCodeGenGroupDropParentTargetId("");
                                          const droppedGroup = String(
                                            e.dataTransfer?.getData("application/x-vizi-group") || codeGenDragGroupId || ""
                                          ).trim();
                                          if (!droppedGroup) return;
                                          reorderCodeGenGroupToParentEnd(droppedGroup, id);
                                          setCodeGenDragGroupId("");
                                        }}
                                        style={{
                                          marginLeft: (depth + 1) * 12,
                                          height: String(codeGenGroupDropTargetId || "") === `end:${id}` ? 16 : 10,
                                          borderRadius: 6,
                                          border:
                                            String(codeGenGroupDropTargetId || "") === `end:${id}`
                                              ? "1px dashed #2b6cff"
                                              : "1px dashed color-mix(in srgb, var(--border) 70%, transparent)",
                                          background:
                                            String(codeGenGroupDropTargetId || "") === `end:${id}`
                                              ? "color-mix(in srgb, #2b6cff 10%, transparent)"
                                              : "transparent",
                                        }}
                                      />
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            );
                          };
                          const visibleRootGroups = rootGroups.filter((group) => groupMatchesTree(String(group?.id || "")));
                          return visibleRootGroups.length ? (
                            <>
                              {visibleRootGroups.map((group) => renderGroupNode(group, 0, new Set()))}
                              {String(codeGenDragGroupId || "").trim() && canDropGroupOnParent(codeGenDragGroupId, "") ? (
                                <div
                                  onDragOver={(e) => {
                                    const dragGroup = String(
                                      e.dataTransfer?.getData("application/x-vizi-group") || codeGenDragGroupId || ""
                                    ).trim();
                                    if (!dragGroup || !canDropGroupOnParent(dragGroup, "")) return;
                                    e.preventDefault();
                                    setCodeGenGroupDropTargetId("end:root");
                                  }}
                                  onDragLeave={() => {
                                    if (String(codeGenGroupDropTargetId || "") === "end:root") setCodeGenGroupDropTargetId("");
                                  }}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    setCodeGenGroupDropTargetId("");
                                    setCodeGenGroupDropParentTargetId("");
                                    const droppedGroup = String(
                                      e.dataTransfer?.getData("application/x-vizi-group") || codeGenDragGroupId || ""
                                    ).trim();
                                    if (!droppedGroup) return;
                                    reorderCodeGenGroupToParentEnd(droppedGroup, "");
                                    setCodeGenDragGroupId("");
                                  }}
                                  style={{
                                    height: String(codeGenGroupDropTargetId || "") === "end:root" ? 16 : 10,
                                    borderRadius: 6,
                                    border:
                                      String(codeGenGroupDropTargetId || "") === "end:root"
                                        ? "1px dashed #2b6cff"
                                        : "1px dashed color-mix(in srgb, var(--border) 70%, transparent)",
                                    background:
                                      String(codeGenGroupDropTargetId || "") === "end:root"
                                        ? "color-mix(in srgb, #2b6cff 10%, transparent)"
                                        : "transparent",
                                  }}
                                />
                              ) : null}
                            </>
                          ) : (
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              No groups yet. Create one above and drag tags into it.
                            </div>
                          );
                          })()}
                        </div>
                        <div
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            background: "var(--bg-elev)",
                            minHeight: 0,
                            overflow: "hidden",
                            display: "none",
                            gridTemplateRows: "auto 1fr",
                          }}
                        >
                          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700 }}>
                            Group Details
                          </div>
                          <div className="vizi-scroll" style={{ overflow: "auto", padding: 8, display: "grid", gap: 8, alignContent: "start" }}>
                            {(() => {
                              const selectedGroup =
                                codeGenGroups.find((g) => String(g?.id || "") === String(codeGenSelectedGroupId || "")) || null;
                              if (!selectedGroup) {
                                return <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Click an object row to view details.</div>;
                              }
                              const selectedId = String(selectedGroup?.id || "");
                              const parent = codeGenGroups.find((g) => String(g?.id || "") === String(selectedGroup?.parentId || "")) || null;
                              const tags = (Array.isArray(selectedGroup?.tags) ? selectedGroup.tags : [])
                                .map((x) => String(x || "").trim())
                                .filter(Boolean)
                                .sort((a, b) => a.localeCompare(b));
                              const childrenCount =
                                codeGenGroups.filter((g) => String(g?.parentId || "") === selectedId).length + tags.length;
                              const byId = new Map(codeGenGroups.map((g) => [String(g?.id || ""), g]));
                              const pathParts = [];
                              let cursor = selectedGroup;
                              let guard = 0;
                              while (cursor && guard < 30) {
                                pathParts.unshift(String(cursor?.name || "Group"));
                                const pid = String(cursor?.parentId || "");
                                cursor = pid ? byId.get(pid) || null : null;
                                guard += 1;
                              }
                              const fullPath = pathParts.join(" / ");
                              const rowStyle = { display: "grid", gridTemplateColumns: "90px minmax(0,1fr)", gap: 8, fontSize: 11, alignItems: "start" };
                              const keyStyle = { color: "var(--text-muted)", fontWeight: 700 };
                              return (
                                <>
                                  <div style={rowStyle}><div style={keyStyle}>Name</div><div style={{ color: "var(--text)", fontWeight: 700 }}>{String(selectedGroup?.name || "")}</div></div>
                                  <div style={rowStyle}><div style={keyStyle}>Type</div><div style={{ color: "var(--text)" }}>{normalizeCodeGenGroupType(selectedGroup?.groupType)}</div></div>
                                  <div style={rowStyle}><div style={keyStyle}>Parent</div><div style={{ color: "var(--text)" }}>{parent ? String(parent?.name || "") : "Main"}</div></div>
                                  <div style={rowStyle}><div style={keyStyle}>Path</div><div style={{ color: "var(--text)" }}>{fullPath || "-"}</div></div>
                                  <div style={rowStyle}><div style={keyStyle}>Children</div><div style={{ color: "var(--text)" }}>{childrenCount}</div></div>
                                  <div style={rowStyle}><div style={keyStyle}>Tags</div><div style={{ color: "var(--text)" }}>{tags.length}</div></div>
                                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, display: "grid", gap: 6 }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>Assigned Tags</div>
                                    {tags.length ? (
                                      tags.map((tag) => (
                                        <div key={`detail-tag-${selectedId}-${tag}`} style={{ fontSize: 10, color: "var(--text)" }}>
                                          {tag}
                                          {String(codeGenTagMeta?.[tag]?.equipmentType || "").trim()
                                            ? ` (${String(codeGenTagMeta?.[tag]?.equipmentType || "").trim()})`
                                            : ""}
                                        </div>
                                      ))
                                    ) : (
                                      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>No tags assigned.</div>
                                    )}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div
                      onMouseDown={(e) => beginCodeGenPanelResize(1, e)}
                      style={{
                        cursor: "col-resize",
                        borderLeft: "1px solid var(--border)",
                        borderRight: "1px solid var(--border)",
                        background: "color-mix(in srgb, var(--bg-elev) 55%, var(--bg))",
                        userSelect: "none",
                      }}
                      title="Resize panels"
                    />
                    <div
                      style={{
                        borderLeft: "1px solid var(--border)",
                        borderRadius: 0,
                        background: "var(--bg-elev)",
                        minHeight: 0,
                        minWidth: 0,
                        overflow: "hidden",
                        display: "grid",
                        gridTemplateRows: "auto 1fr",
                      }}
                    >
                      <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700 }}>
                        {String(codeGenSelectedTag || "").trim() ? "Tag Details" : "Group Details"}
                      </div>
                      <div className="vizi-scroll" style={{ overflow: "auto", padding: 8, display: "grid", gap: 8, alignContent: "start" }}>
                        {(() => {
                          const selectedTag = String(codeGenSelectedTag || "").trim();
                          if (selectedTag) {
                            const tagMeta = codeGenTagMeta?.[selectedTag] && typeof codeGenTagMeta[selectedTag] === "object" ? codeGenTagMeta[selectedTag] : {};
                            const equipmentType = String(tagMeta?.equipmentType || "").trim();
                            const equipmentDraft = String(codeGenTagEquipmentDraftByPlc?.[chatKey]?.[selectedTag] || equipmentType);
                            const ioDraft = String(codeGenIoDraftByPlc?.[chatKey]?.[selectedTag] || "");
                            const ioNameDraft = String(codeGenIoNameDraftByPlc?.[chatKey]?.[selectedTag] || "");
                            const ioType = String(codeGenIoTypeByPlc?.[chatKey]?.[selectedTag] || "Input");
                            const inputItems = Array.from(
                              new Set(
                                [
                                  ...(Array.isArray(tagMeta?.inputDefs) ? tagMeta.inputDefs : []),
                                  ...(Array.isArray(tagMeta?.inputs) ? tagMeta.inputs.map((address) => ({ address })) : []),
                                  ...(String(tagMeta?.plcInputAddress || "").trim()
                                    ? [{ address: String(tagMeta.plcInputAddress || "").trim() }]
                                    : []),
                                ]
                                  .map((entry) => {
                                    const name = String(entry?.name || "").trim();
                                    const address = String(entry?.address || "").trim();
                                    if (!address) return "";
                                    return `${name}|||${address}`;
                                  })
                                  .filter(Boolean)
                              )
                            ).map((row) => {
                              const [name = "", address = ""] = String(row || "").split("|||");
                              return { name, address };
                            });
                            const outputItems = Array.from(
                              new Set(
                                [
                                  ...(Array.isArray(tagMeta?.outputDefs) ? tagMeta.outputDefs : []),
                                  ...(Array.isArray(tagMeta?.outputs) ? tagMeta.outputs.map((address) => ({ address })) : []),
                                  ...(String(tagMeta?.plcOutputAddress || "").trim()
                                    ? [{ address: String(tagMeta.plcOutputAddress || "").trim() }]
                                    : []),
                                ]
                                  .map((entry) => {
                                    const name = String(entry?.name || "").trim();
                                    const address = String(entry?.address || "").trim();
                                    if (!address) return "";
                                    return `${name}|||${address}`;
                                  })
                                  .filter(Boolean)
                              )
                            ).map((row) => {
                              const [name = "", address = ""] = String(row || "").split("|||");
                              return { name, address };
                            });
                            const ioItems = [
                              ...inputItems.map((entry) => ({ type: "Input", name: String(entry?.name || ""), address: String(entry?.address || "") })),
                              ...outputItems.map((entry) => ({ type: "Output", name: String(entry?.name || ""), address: String(entry?.address || "") })),
                            ].sort((a, b) => {
                              const byType = String(a?.type || "").localeCompare(String(b?.type || ""));
                              if (byType !== 0) return byType;
                              const byName = String(a?.name || "").localeCompare(String(b?.name || ""));
                              if (byName !== 0) return byName;
                              return String(a?.address || "").localeCompare(String(b?.address || ""));
                            });
                            const byId = new Map(codeGenGroups.map((g) => [String(g?.id || ""), g]));
                            const pathForGroup = (g) => {
                              const parts = [];
                              let cursor = g;
                              let guard = 0;
                              while (cursor && guard < 30) {
                                parts.unshift(String(cursor?.name || "Group"));
                                const pid = String(cursor?.parentId || "");
                                cursor = pid ? byId.get(pid) || null : null;
                                guard += 1;
                              }
                              return parts.join(" / ");
                            };
                            const assignedGroups = codeGenGroups
                              .filter((g) =>
                                (Array.isArray(g?.tags) ? g.tags : [])
                                  .map((x) => String(x || "").trim())
                                  .filter(Boolean)
                                  .includes(selectedTag)
                              )
                              .map((g) => pathForGroup(g))
                              .filter(Boolean);
                            const rowStyle = { display: "grid", gridTemplateColumns: "90px minmax(0,1fr)", gap: 8, fontSize: 11, alignItems: "start" };
                            const keyStyle = { color: "var(--text-muted)", fontWeight: 700 };
                            return (
                              <>
                                <div style={rowStyle}><div style={keyStyle}>Name</div><div style={{ color: "var(--text)", fontWeight: 700 }}>{selectedTag}</div></div>
                                <div style={rowStyle}><div style={keyStyle}>Type</div><div style={{ color: "var(--text)" }}>Tag</div></div>
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                                  <button
                                    type="button"
                                    data-preserve-style="true"
                                    onClick={() =>
                                      setCodeGenTagEditByPlc((prev) => {
                                        const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                        return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: true } };
                                      })
                                    }
                                    style={{
                                      border: "1px solid var(--border)",
                                      background: "var(--bg)",
                                      color: "var(--text-muted)",
                                      borderRadius: 6,
                                      width: 22,
                                      height: 22,
                                      padding: 0,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: 10,
                                      fontWeight: 700,
                                      cursor: "pointer",
                                    }}
                                    title="Edit"
                                    aria-label="Edit tag details"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path d="M4 20H8L19 9L15 5L4 16V20Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    data-preserve-style="true"
                                    onClick={() => {
                                      setCodeGenTagEquipmentDraftByPlc((prev) => {
                                        const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                        return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: equipmentType } };
                                      });
                                      setCodeGenTagEditByPlc((prev) => {
                                        const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                        return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: false } };
                                      });
                                    }}
                                    disabled={!codeGenTagDetailEditMode}
                                    style={{
                                      border: "1px solid #f04438",
                                      background: "#f04438",
                                      color: "#fff",
                                      borderRadius: 6,
                                      width: 22,
                                      height: 22,
                                      padding: 0,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      cursor: codeGenTagDetailEditMode ? "pointer" : "default",
                                      opacity: codeGenTagDetailEditMode ? 1 : 0.45,
                                    }}
                                    title="Cancel"
                                    aria-label="Cancel tag detail changes"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    data-preserve-style="true"
                                    onClick={() => {
                                      updateCodeGenTagEquipment(selectedTag, equipmentDraft);
                                      setCodeGenTagEditByPlc((prev) => {
                                        const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                        return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: false } };
                                      });
                                    }}
                                    disabled={!codeGenTagDetailEditMode}
                                    style={{
                                      border: "1px solid #2b6cff",
                                      background: "#2b6cff",
                                      color: "#fff",
                                      borderRadius: 6,
                                      width: 22,
                                      height: 22,
                                      padding: 0,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      cursor: codeGenTagDetailEditMode ? "pointer" : "default",
                                      opacity: codeGenTagDetailEditMode ? 1 : 0.45,
                                    }}
                                    title="Save"
                                    aria-label="Save tag detail changes"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                      <path d="M5 13L10 18L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                  </button>
                                </div>
                                <div style={rowStyle}>
                                  <div style={keyStyle}>Equipment</div>
                                  <select
                                    value={equipmentDraft}
                                    onChange={(e) => {
                                      const value = String(e.target.value || "");
                                      setCodeGenTagEquipmentDraftByPlc((prev) => {
                                        const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                        return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: value } };
                                      });
                                    }}
                                    disabled={!codeGenTagDetailEditMode}
                                    style={{
                                      border: "1px solid var(--border)",
                                      background: "var(--bg)",
                                      color: "var(--text)",
                                      borderRadius: 6,
                                      height: 22,
                                      padding: "0 8px",
                                      fontSize: 11,
                                      minWidth: 0,
                                    }}
                                  >
                                    <option value="">Equipment type</option>
                                    {codeGenEquipmentTypeOptions.map((type) => (
                                      <option key={`detail-tag-equip-${selectedTag}-${type}`} value={type}>
                                        {type}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div style={rowStyle}><div style={keyStyle}>Assigned</div><div style={{ color: "var(--text)" }}>{assignedGroups.length ? assignedGroups.join(" | ") : "Ungrouped"}</div></div>
                                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, display: "grid", gap: 6 }}>
                                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>I/O</div>
                                  <div style={{ display: "grid", gridTemplateColumns: "90px minmax(0,1fr) minmax(0,1fr) auto", gap: 6, minWidth: 0 }}>
                                    <select
                                      value={ioType}
                                      onChange={(e) => {
                                        const value = String(e.target.value || "Input");
                                        setCodeGenIoTypeByPlc((prev) => {
                                          const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                          return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: value } };
                                        });
                                      }}
                                      disabled={!codeGenTagDetailEditMode}
                                      style={{
                                        border: "1px solid var(--border)",
                                        background: "var(--bg)",
                                        color: "var(--text)",
                                        borderRadius: 6,
                                        height: 22,
                                        padding: "0 8px",
                                        fontSize: 11,
                                        minWidth: 0,
                                      }}
                                    >
                                      <option value="Input">Input</option>
                                      <option value="Output">Output</option>
                                    </select>
                                    <input
                                      value={ioNameDraft}
                                      onChange={(e) => {
                                        const value = String(e.target.value || "");
                                        setCodeGenIoNameDraftByPlc((prev) => {
                                          const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                          return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: value } };
                                        });
                                      }}
                                      disabled={!codeGenTagDetailEditMode}
                                      placeholder={`${ioType} name`}
                                      style={{
                                        border: "1px solid var(--border)",
                                        background: "var(--bg)",
                                        color: "var(--text)",
                                        borderRadius: 6,
                                        height: 22,
                                        padding: "0 8px",
                                        fontSize: 11,
                                        minWidth: 0,
                                      }}
                                    />
                                    <input
                                      value={ioDraft}
                                      onChange={(e) => {
                                        const value = String(e.target.value || "");
                                        setCodeGenIoDraftByPlc((prev) => {
                                          const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                          return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: value } };
                                        });
                                      }}
                                      disabled={!codeGenTagDetailEditMode}
                                      placeholder={`${ioType} address`}
                                      style={{
                                        border: "1px solid var(--border)",
                                        background: "var(--bg)",
                                        color: "var(--text)",
                                        borderRadius: 6,
                                        height: 22,
                                        padding: "0 8px",
                                        fontSize: 11,
                                        minWidth: 0,
                                      }}
                                    />
                                    <button
                                      type="button"
                                      data-preserve-style="true"
                                      onClick={() => {
                                        addCodeGenTagIoValue(selectedTag, ioType === "Output" ? "outputDefs" : "inputDefs", ioDraft, ioNameDraft);
                                        setCodeGenIoDraftByPlc((prev) => {
                                          const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                          return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: "" } };
                                        });
                                        setCodeGenIoNameDraftByPlc((prev) => {
                                          const byPlc = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
                                          return { ...(prev || {}), [chatKey]: { ...byPlc, [selectedTag]: "" } };
                                        });
                                      }}
                                      disabled={!codeGenTagDetailEditMode}
                                      style={{
                                        border: "1px solid #2b6cff",
                                        background: "#2b6cff",
                                        color: "#fff",
                                        borderRadius: 6,
                                        height: 22,
                                        padding: "0 10px",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: codeGenTagDetailEditMode ? "pointer" : "default",
                                        opacity: codeGenTagDetailEditMode ? 1 : 0.45,
                                      }}
                                    >
                                      Add
                                    </button>
                                  </div>
                                  <div style={{ display: "grid", gap: 6 }}>
                                    {ioItems.length ? ioItems.map((item) => {
                                      const type = String(item?.type || "Input");
                                      const name = String(item?.name || "");
                                      const address = String(item?.address || "");
                                      return (
                                        <div
                                          key={`tag-detail-io-${selectedTag}-${type}-${name}-${address}`}
                                          style={{
                                            display: "grid",
                                            gridTemplateColumns: "60px minmax(0,1fr) minmax(0,1fr) auto",
                                            gap: 6,
                                            alignItems: "center",
                                          }}
                                        >
                                          <div style={{ border: "1px solid var(--border)", borderRadius: 6, height: 20, padding: "0 6px", lineHeight: "18px", fontSize: 10, color: "var(--text-muted)", background: "var(--bg)" }}>{type}</div>
                                          <div style={{ border: "1px solid var(--border)", borderRadius: 6, height: 20, padding: "0 6px", lineHeight: "18px", fontSize: 10, color: "var(--text)", background: "var(--bg)", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={name}>{name || "-"}</div>
                                          <div style={{ border: "1px solid var(--border)", borderRadius: 6, height: 20, padding: "0 6px", lineHeight: "18px", fontSize: 10, color: "var(--text)", background: "var(--bg)", minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={address}>{address}</div>
                                          <button
                                            type="button"
                                            data-preserve-style="true"
                                            onClick={() =>
                                              removeCodeGenTagIoValue(
                                                selectedTag,
                                                type === "Output" ? "outputDefs" : "inputDefs",
                                                address,
                                                name
                                              )
                                            }
                                            disabled={!codeGenTagDetailEditMode}
                                            style={{
                                              border: "1px solid #f04438",
                                              background: "#f04438",
                                              color: "#fff",
                                              borderRadius: 6,
                                              height: 20,
                                              padding: "0 8px",
                                              fontSize: 10,
                                              fontWeight: 700,
                                              cursor: codeGenTagDetailEditMode ? "pointer" : "default",
                                              opacity: codeGenTagDetailEditMode ? 1 : 0.45,
                                            }}
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      );
                                    }) : <div style={{ fontSize: 10, color: "var(--text-muted)" }}>No IO entries</div>}
                                  </div>
                                </div>
                              </>
                            );
                          }
                          const selectedGroup =
                            codeGenGroups.find((g) => String(g?.id || "") === String(codeGenSelectedGroupId || "")) || null;
                          if (!selectedGroup) {
                            return <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Click an object row to view details.</div>;
                          }
                          const selectedId = String(selectedGroup?.id || "");
                          const parent = codeGenGroups.find((g) => String(g?.id || "") === String(selectedGroup?.parentId || "")) || null;
                          const tags = (Array.isArray(selectedGroup?.tags) ? selectedGroup.tags : [])
                            .map((x) => String(x || "").trim())
                            .filter(Boolean)
                            .sort((a, b) => a.localeCompare(b));
                          const childrenCount =
                            codeGenGroups.filter((g) => String(g?.parentId || "") === selectedId).length + tags.length;
                          const byId = new Map(codeGenGroups.map((g) => [String(g?.id || ""), g]));
                          const pathParts = [];
                          let cursor = selectedGroup;
                          let guard = 0;
                          while (cursor && guard < 30) {
                            pathParts.unshift(String(cursor?.name || "Group"));
                            const pid = String(cursor?.parentId || "");
                            cursor = pid ? byId.get(pid) || null : null;
                            guard += 1;
                          }
                          const fullPath = pathParts.join(" / ");
                          const rowStyle = { display: "grid", gridTemplateColumns: "90px minmax(0,1fr)", gap: 8, fontSize: 11, alignItems: "start" };
                          const keyStyle = { color: "var(--text-muted)", fontWeight: 700 };
                          return (
                            <>
                              <div style={rowStyle}>
                                <div style={keyStyle}>Name</div>
                                <input
                                  value={codeGenDetailNameDraft}
                                  title={getCodeGenObjectInputTooltip(codeGenDetailTypeDraft)}
                                  onChange={(e) => {
                                    const raw = String(e.target.value || "");
                                    const detailType = normalizeCodeGenGroupType(codeGenDetailTypeDraft);
                                    if (
                                      detailType === "Group" ||
                                      detailType === "Route" ||
                                      detailType === "Sender" ||
                                      detailType === "Receiver" ||
                                      detailType === "Bin"
                                    ) {
                                      setCodeGenDetailNameDraft(raw.replace(/\D+/g, ""));
                                      return;
                                    }
                                    setCodeGenDetailNameDraft(raw);
                                  }}
                                  inputMode={
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Group" ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Route" ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Sender" ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Receiver" ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Bin"
                                      ? "numeric"
                                      : "text"
                                  }
                                  pattern={
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Group" ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Route" ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Sender" ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Receiver" ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Bin"
                                      ? "\\d*"
                                      : undefined
                                  }
                                  placeholder={getCodeGenObjectNameHint(codeGenDetailTypeDraft)}
                                  disabled={
                                    !codeGenDetailEditMode ||
                                    normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Bin"
                                  }
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg)",
                                    color: "var(--text)",
                                    borderRadius: 6,
                                    height: 22,
                                    padding: "0 8px",
                                    fontSize: 11,
                                    minWidth: 0,
                                  }}
                                />
                              </div>
                              {normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Bin" ? (
                                <div style={rowStyle}>
                                  <div style={keyStyle}>Bin Number</div>
                                  <input
                                    value={codeGenDetailBinNumberDraft}
                                    title={getCodeGenObjectInputTooltip("Bin")}
                                    onChange={(e) => {
                                      const digits = String(e.target.value || "").replace(/\D+/g, "");
                                      setCodeGenDetailBinNumberDraft(digits);
                                      setCodeGenDetailNameDraft(digits ? `Bin${digits}` : "");
                                    }}
                                    inputMode="numeric"
                                    pattern="\\d*"
                                    placeholder="Bin Number"
                                    disabled={!codeGenDetailEditMode}
                                    style={{
                                      border: "1px solid var(--border)",
                                      background: "var(--bg)",
                                      color: "var(--text)",
                                      borderRadius: 6,
                                      height: 22,
                                      padding: "0 8px",
                                      fontSize: 11,
                                      minWidth: 0,
                                    }}
                                  />
                                </div>
                              ) : null}
                              <div style={rowStyle}>
                                <div style={keyStyle}>Type</div>
                                <select
                                  value={codeGenDetailTypeDraft}
                                  onChange={(e) => {
                                    const nextType = normalizeCodeGenGroupType(e.target.value);
                                    setCodeGenDetailTypeDraft(nextType);
                                    if (nextType === "Bin") {
                                      const nextBinNumber = extractCodeGenBinNumber(codeGenDetailNameDraft);
                                      setCodeGenDetailBinNumberDraft(nextBinNumber);
                                      setCodeGenDetailNameDraft(nextBinNumber ? `Bin${nextBinNumber}` : "");
                                    } else {
                                      setCodeGenDetailBinNumberDraft("");
                                    }
                                  }}
                                  disabled={!codeGenDetailEditMode}
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg)",
                                    color: "var(--text)",
                                    borderRadius: 6,
                                    height: 22,
                                    padding: "0 8px",
                                    fontSize: 11,
                                    minWidth: 0,
                                  }}
                                >
                                  {CODE_GEN_GROUP_TYPES.map((groupType) => (
                                    <option key={`detail-group-type-${selectedId}-${groupType}`} value={groupType}>
                                      {groupType}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {normalizeCodeGenGroupType(codeGenDetailTypeDraft) === "Group" ? (
                                <div style={rowStyle}>
                                  <div style={keyStyle}>Group Type</div>
                                  <select
                                    value={codeGenDetailSubTypeDraft}
                                    onChange={(e) => setCodeGenDetailSubTypeDraft(String(e.target.value || "Feed"))}
                                    disabled={!codeGenDetailEditMode}
                                    style={{
                                      border: "1px solid var(--border)",
                                      background: "var(--bg)",
                                      color: "var(--text)",
                                      borderRadius: 6,
                                      height: 22,
                                      padding: "0 8px",
                                      fontSize: 11,
                                      minWidth: 0,
                                    }}
                                  >
                                    {CODE_GEN_GROUP_SUBTYPES.map((subType) => (
                                      <option key={`detail-group-subtype-${selectedId}-${subType}`} value={subType}>
                                        {subType}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}
                              <div style={rowStyle}>
                                <div style={keyStyle}>Description</div>
                                <textarea
                                  value={codeGenDetailDescriptionDraft}
                                  onChange={(e) => setCodeGenDetailDescriptionDraft(String(e.target.value || "").slice(0, 300))}
                                  placeholder="Optional description"
                                  disabled={!codeGenDetailEditMode}
                                  rows={3}
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg)",
                                    color: "var(--text)",
                                    borderRadius: 6,
                                    padding: "6px 8px",
                                    fontSize: 11,
                                    minWidth: 0,
                                    resize: "vertical",
                                    fontFamily: "inherit",
                                  }}
                                />
                              </div>
                              <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                                <button
                                  type="button"
                                  data-preserve-style="true"
                                  onClick={() => setCodeGenDetailEditByPlc((prev) => ({ ...(prev || {}), [chatKey]: true }))}
                                  style={{
                                    border: "1px solid var(--border)",
                                    background: "var(--bg)",
                                    color: "var(--text-muted)",
                                    borderRadius: 6,
                                    width: 22,
                                    height: 22,
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    cursor: "pointer",
                                  }}
                                  title="Edit"
                                  aria-label="Edit group details"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M4 20H8L19 9L15 5L4 16V20Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  data-preserve-style="true"
                                  onClick={cancelCodeGenSelectedGroupDetails}
                                  disabled={!codeGenDetailEditMode}
                                  style={{
                                    border: "1px solid #f04438",
                                    background: "#f04438",
                                    color: "#fff",
                                    borderRadius: 6,
                                    width: 22,
                                    height: 22,
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: codeGenDetailEditMode ? "pointer" : "default",
                                    opacity: codeGenDetailEditMode ? 1 : 0.45,
                                  }}
                                  title="Cancel"
                                  aria-label="Cancel group detail changes"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  data-preserve-style="true"
                                  onClick={() => {
                                    saveCodeGenSelectedGroupDetails();
                                    setCodeGenDetailEditByPlc((prev) => ({ ...(prev || {}), [chatKey]: false }));
                                  }}
                                  disabled={!codeGenDetailEditMode}
                                  style={{
                                    border: "1px solid #2b6cff",
                                    background: "#2b6cff",
                                    color: "#fff",
                                    borderRadius: 6,
                                    width: 22,
                                    height: 22,
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: codeGenDetailEditMode ? "pointer" : "default",
                                    opacity: codeGenDetailEditMode ? 1 : 0.45,
                                  }}
                                  title="Save"
                                  aria-label="Save group detail changes"
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                    <path d="M5 13L10 18L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                              </div>
                              <div style={rowStyle}><div style={keyStyle}>Parent</div><div style={{ color: "var(--text)" }}>{parent ? String(parent?.name || "") : "Main"}</div></div>
                              <div style={rowStyle}><div style={keyStyle}>Path</div><div style={{ color: "var(--text)" }}>{fullPath || "-"}</div></div>
                              <div style={rowStyle}><div style={keyStyle}>Children</div><div style={{ color: "var(--text)" }}>{childrenCount}</div></div>
                              <div style={rowStyle}><div style={keyStyle}>Tags</div><div style={{ color: "var(--text)" }}>{tags.length}</div></div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    {codeGenObjectContextMenu && String(codeGenObjectContextMenu?.groupId || "").trim()
                      ? createPortal(
                          <div
                            ref={codeGenObjectContextMenuRef}
                            style={{
                              position: "fixed",
                              left: Number(codeGenObjectContextMenu?.x || 0),
                              top: Number(codeGenObjectContextMenu?.y || 0),
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              borderRadius: 8,
                              padding: 4,
                              zIndex: 3000,
                              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              data-preserve-style="true"
                              onClick={() => {
                                duplicateCodeGenGroupTree(codeGenObjectContextMenu?.groupId);
                                setCodeGenObjectContextMenu(null);
                              }}
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                color: "var(--text)",
                                borderRadius: 6,
                                height: 24,
                                padding: "0 10px",
                                fontSize: 11,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              Duplicate
                            </button>
                          </div>,
                          document.body
                        )
                      : null}
                  </div>
                </div>

                {codeGenFormat === "l5x-template" ? null : (
                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)" }}>
                    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700 }}>
                      Generated Output
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 10,
                        fontSize: 11,
                        lineHeight: 1.45,
                        color: "var(--text)",
                        maxHeight: 320,
                        overflow: "auto",
                        whiteSpace: "pre",
                      }}
                    >
                      {codeGenOutputText || "// No generated output for this selection."}
                    </pre>
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      ) : null}

    </div>
  );
}









