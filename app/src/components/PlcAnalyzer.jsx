import { useEffect, useMemo, useRef, useState } from "react";
import { toastError, toastInfo, toastSuccess } from "../utils/toast";

const CODE_GEN_GROUP_TYPES = ["Route", "SubRoute", "Sender", "Receiver", "Bin", "Group", "Equipment"];
const CODE_GEN_FORMATS = ["l5x-template", "list", "io-map"];
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
  const matched = CODE_GEN_GROUP_TYPES.find((item) => item.toLowerCase() === raw.toLowerCase());
  return matched || "Group";
}

function collectAutoTagStubsFromRoutineXml(routineXmlBlocks = []) {
  const instructionNames = new Set(
    [
      "AFI",
      "CPS",
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
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const timerUsage = new RegExp(`\\b(?:RES|TON)\\s*\\(\\s*${escaped}(?:\\b|\\s|[),.\\[])`, "i");
    const boolUsage = new RegExp(`\\b(?:ONS|XIC|XIO|OTE|OTL|OTU)\\s*\\(\\s*${escaped}(?:\\b|\\s|[),.\\[])`, "i");
    const gsvDestUsage = new RegExp(`\\bGSV\\s*\\([^\\)]*,[^\\)]*,[^\\)]*,\\s*${escaped}(?:\\b|\\s|[),.\\[])`, "i");
    const current = String(tagTypeByName.get(tag) || "");
    let next = current || "DINT";
    if (timerUsage.test(logicText)) next = "TIMER";
    else if (boolUsage.test(logicText)) next = current === "TIMER" ? "TIMER" : "BOOL";
    else if (gsvDestUsage.test(logicText)) next = current || "DINT";
    if (!current || (current !== "TIMER" && next === "TIMER")) tagTypeByName.set(tag, next);
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
      inferAndSet(base, logicText);
    });
  });
  return Array.from(tagTypeByName.entries()).map(([name, dataType]) => ({
    name,
    dataType: String(dataType || "DINT"),
    block: `<Tag Name="${name}" Class="Standard" TagType="Base" DataType="${String(dataType || "DINT")}" Constant="false" ExternalAccess="Read/Write" OpcUaAccess="None"/>`,
  }));
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
  const src = String(rawText || "");
  if (!src) return [];
  const wanted = new Set((Array.isArray(names) ? names : []).map((n) => String(n || "").trim().toLowerCase()).filter(Boolean));
  if (!wanted.size) return [];
  const out = [];
  const re = /<AddOnInstructionDefinition\b[\s\S]*?<\/AddOnInstructionDefinition>/gi;
  let match = re.exec(src);
  while (match) {
    const block = String(match[0] || "");
    const head = block.match(/<AddOnInstructionDefinition\b([^>]*)>/i);
    const name = head ? extractAttr(String(head[1] || ""), "Name") : "";
    const key = String(name || "").trim().toLowerCase();
    if (key && wanted.has(key)) out.push(block);
    match = re.exec(src);
  }
  return out;
}

function extractAllAoiXmlBlocks(rawText) {
  const src = String(rawText || "");
  if (!src) return [];
  const out = [];
  const re = /<AddOnInstructionDefinition\b[\s\S]*?<\/AddOnInstructionDefinition>/gi;
  let match = re.exec(src);
  while (match) {
    out.push(String(match[0] || ""));
    match = re.exec(src);
  }
  return out;
}

function buildImportSafeAoiXmlBlocks(rawText, dataTypeBlocks = []) {
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
  const udtNames = new Set(
    (Array.isArray(dataTypeBlocks) ? dataTypeBlocks : [])
      .map((block) => {
        const head = String(block || "").match(/<DataType\b([^>]*)>/i);
        return head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim().toLowerCase() : "";
      })
      .filter(Boolean)
  );
  const all = extractAllAoiXmlBlocks(src)
    .map((block) => {
      const head = String(block || "").match(/<AddOnInstructionDefinition\b([^>]*)>/i);
      const name = head ? String(extractAttr(String(head[1] || ""), "Name") || "").trim() : "";
      const key = name.toLowerCase();
      const refs = Array.from(String(block || "").matchAll(/\bDataType\s*=\s*"([^"]+)"/gi))
        .map((m) => String(m?.[1] || "").trim().toLowerCase())
        .filter(Boolean);
      return { block: String(block || ""), name, key, refs };
    })
    .filter((row) => row.key && !udtNames.has(row.key)); // avoid AOI/UDT name collisions
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
      if (hasUnresolved) {
        keep.delete(key);
        changed = true;
      }
    }
  }
  return Array.from(keep.values()).map((row) => row.block);
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

function scanAoiTemplates(xmlText, maxAois = 500, maxFieldsPerAoi = 1200) {
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
  const defRe = /<AddOnInstructionDefinition\b([^>]*)>([\s\S]*?)<\/AddOnInstructionDefinition>/gi;
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
  const [codeGenTagsByPlc, setCodeGenTagsByPlc] = useState({});
  const [codeGenNewTagDraft, setCodeGenNewTagDraft] = useState("");
  const [codeGenNewTagEquipmentDraft, setCodeGenNewTagEquipmentDraft] = useState("");
  const [codeGenTagMetaByPlc, setCodeGenTagMetaByPlc] = useState({});
  const [codeGenGroupsByPlc, setCodeGenGroupsByPlc] = useState({});
  const [codeGenTemplateRouteIdDraft, setCodeGenTemplateRouteIdDraft] = useState("");
  const [codeGenRouteTemplateTextByPlc, setCodeGenRouteTemplateTextByPlc] = useState({});
  const [codeGenTemplateRouteNameByPlc, setCodeGenTemplateRouteNameByPlc] = useState({});
  const [codeGenGroupNameDraft, setCodeGenGroupNameDraft] = useState("");
  const [codeGenGroupTypeDraft, setCodeGenGroupTypeDraft] = useState("Group");
  const [codeGenGroupParentDraft, setCodeGenGroupParentDraft] = useState("");
  const [codeGenSelectedGroupId, setCodeGenSelectedGroupId] = useState("");
  const [codeGenExpandedGroupsByPlc, setCodeGenExpandedGroupsByPlc] = useState({});
  const [codeGenDragTag, setCodeGenDragTag] = useState("");
  const [codeGenPersistReadyByPlc, setCodeGenPersistReadyByPlc] = useState({});
  const [codeGenReady, setCodeGenReady] = useState(false);
  const [plcTopTab, setPlcTopTab] = useState(
    String(initialTab || "").trim() === "code-gen-pro" ? "code-gen-pro" : "plc"
  );
  const chatScrollRef = useRef(null);
  const codeGenSaveTimerRef = useRef(null);
  const codeGenLastSavedSnapshotByPlcRef = useRef({});
  const codeGenPersistErrorAtRef = useRef(0);
  const lastPlcInnerTabRef = useRef("overview");
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
  const chatKey = String(selected?.id || "__none__");
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
    return scanAoiTemplates(String(selected?.rawText || ""));
  }, [activeTab, selected?.rawText]);
  const dataTypeTemplates = useMemo(() => {
    if (String(activeTab || "") !== "datatype-templates") return [];
    return scanDataTypeTemplates(String(selected?.rawText || ""));
  }, [activeTab, selected?.rawText]);
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
  const codeGenRouteTemplateText = useMemo(
    () => String(codeGenRouteTemplateTextByPlc?.[chatKey] || ""),
    [chatKey, codeGenRouteTemplateTextByPlc]
  );
  const codeGenTemplateRouteName = useMemo(
    () => String(codeGenTemplateRouteNameByPlc?.[chatKey] || ""),
    [chatKey, codeGenTemplateRouteNameByPlc]
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
        const sourceText = /<RSLogix5000Content\b/i.test(String(selected?.rawText || ""))
          ? String(selected?.rawText || "")
          : String(codeGenRouteTemplateText || "");
        const sourceIsMainRoutineExport =
          /TargetType\s*=\s*"Routine"/i.test(sourceText) && /TargetName\s*=\s*"Main"/i.test(sourceText);
        const preferredMainProgramNames = ["KE_MainProgram", "MainProgram"];
        const findProgramBodyByName = (programName) => {
          const wanted = String(programName || "").trim().toLowerCase();
          if (!wanted) return "";
          const re = /<Program\b([^>]*)>([\s\S]*?)<\/Program>/gi;
          let m = re.exec(sourceText);
          while (m) {
            const attrs = String(m[1] || "");
            const name = String(extractAttr(attrs, "Name") || "").trim().toLowerCase();
            if (name === wanted) return String(m[2] || "");
            m = re.exec(sourceText);
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
        const getRoutineTemplateByName = (routineName) => {
          // For main-program routines, force source from the real main program first
          // so we don't accidentally copy same-named routines from other programs (ex: bins).
          const mainProgramRoutineNames = new Set(
            ["main", "alarmreset", "generalalarms", "scalecoms", "io_mapping", "ios_mapping", "io_mappingho", "io_mappingww", "hoscalecoms", "wwscalecoms"]
          );
          const wanted = String(routineName || "").trim().toLowerCase();
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
          return getRoutineTemplateFromText(sourceText, routineName);
        };
        const makeEmptyRoutine = (name) =>
          [`          <Routine Name="${name}" Type="RLL">`, "            <RLLContent/>", "          </Routine>"].join("\n");
        const allowedRouteNames = new Set(
          routeExec
            .map((row) => String(row?.routeName || "").trim())
            .filter(Boolean)
            .map((name) => name.toLowerCase())
        );
        const pruneRoutineByAllowedRoutes = (routineXml) => {
          let out = String(routineXml || "");
          if (!out || !allowedRouteNames.size) return out;
          out = out.replace(/<Text\b[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Text>/gi, (full, cdata) => {
            const src = String(cdata || "");
            const parts = src.split(";");
            const kept = parts.filter((segment) => {
              const text = String(segment || "");
              const routeRefs = Array.from(text.matchAll(/\bRoute\d+(?:_\d+)?\b/gi)).map((m) => String(m[0] || ""));
              if (!routeRefs.length) return true;
              return routeRefs.every((name) => allowedRouteNames.has(String(name || "").toLowerCase()));
            });
            return `<Text><![CDATA[${kept.join(";")}]]></Text>`;
          });
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
          const tmpl = getRoutineTemplateByName(sourceRoutineName);
          if (!tmpl) return makeEmptyRoutine(targetRoutineName);
          let out = String(tmpl || "");
          out = out.replace(/<Routine\b([^>]*)>/i, `<Routine Name="${targetRoutineName}" Type="RLL">`);
          if (sourceTagName && targetTagName && sourceTagName !== targetTagName) {
            out = out.split(sourceTagName).join(targetTagName);
            out = out.split(String(sourceTagName).toLowerCase()).join(String(targetTagName).toLowerCase());
          }
          if (String(targetRoutineName || "").trim().toLowerCase() === "alarmreset") {
            out = pruneRoutineByAllowedRoutes(out);
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
        return { programsXml, autoTagStubs };
      };
      const { programsXml, autoTagStubs: autoProgramTagStubs } = buildMainRoutineProgramsXml();
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
        : savedTemplateText;
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
            byName.set(key, String(block || ""));
          });
          (Array.isArray(autoProgramTagStubs) ? autoProgramTagStubs : []).forEach((row) => {
            const block = String(row?.block || "");
            const name = String(row?.name || "").trim();
            const key = name.toLowerCase();
            if (!key || byName.has(key)) return;
            byName.set(key, block);
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
          .replace(/<DataTypes\b[^>]*>[\s\S]*?<\/DataTypes>/i, dataTypesXml ? `    <DataTypes>\n${dataTypesXml}\n    </DataTypes>` : "    <DataTypes/>")
          .replace(/<DataTypes\s*\/>/i, dataTypesXml ? `    <DataTypes>\n${dataTypesXml}\n    </DataTypes>` : "    <DataTypes/>")
          .replace(/<Modules\b[^>]*>[\s\S]*?<\/Modules>/gi, "    <Modules/>")
          .replace(/<Modules\s*\/>/gi, "    <Modules/>")
          .replace(/<Module\b[^>]*>[\s\S]*?<\/Module>/gi, "")
          .replace(/<Module\b[^>]*\/>/gi, "")
          .replace(
            /<AddOnInstructionDefinitions\b[^>]*>[\s\S]*?<\/AddOnInstructionDefinitions>/i,
            aoiXml ? `    <AddOnInstructionDefinitions>\n${aoiXml}\n    </AddOnInstructionDefinitions>` : "    <AddOnInstructionDefinitions/>"
          )
          .replace(
            /<AddOnInstructionDefinitions\s*\/>/i,
            aoiXml ? `    <AddOnInstructionDefinitions>\n${aoiXml}\n    </AddOnInstructionDefinitions>` : "    <AddOnInstructionDefinitions/>"
          )
          .replace(/<Tags\b[^>]*>[\s\S]*?<\/Tags>/gi, tagsXml ? `    <Tags>\n${tagsXml}\n    </Tags>` : "    <Tags/>")
          .replace(/<Tags\s*\/>/gi, tagsXml ? `    <Tags>\n${tagsXml}\n    </Tags>` : "    <Tags/>")
          .replace(/<Data\b[^>]*>[\s\S]*?<\/Data>/gi, "")
          .replace(/<Data\b[^>]*\/>/gi, "")
          .replace(
            /<Programs\b[^>]*>[\s\S]*?<\/Programs>/i,
            programsXml
          )
          .replace(
            /<Programs\s*\/>/i,
            programsXml
          )
          .replace(
            /<Tasks\b[^>]*>[\s\S]*?<\/Tasks>/i,
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
            /<Tasks\s*\/>/i,
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
        return templated;
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
          byName.set(key, String(block || ""));
        });
        (Array.isArray(autoProgramTagStubs) ? autoProgramTagStubs : []).forEach((row) => {
          const block = String(row?.block || "");
          const name = String(row?.name || "").trim();
          const key = name.toLowerCase();
          if (!key || byName.has(key)) return;
          byName.set(key, block);
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
      return [
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
        .join("\n");
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
    codeGenRouteTemplateText,
    codeGenTagMeta,
    codeGenTemplateRouteIdDraft,
    codeGenTemplateRouteName,
    codeGenUserTags,
    selected?.rawText,
    selected?.name,
  ]);
  const codeGenGroups = useMemo(
    () => (Array.isArray(codeGenGroupsByPlc?.[chatKey]) ? codeGenGroupsByPlc[chatKey] : []),
    [chatKey, codeGenGroupsByPlc]
  );
  const codeGenExpandedSet = useMemo(
    () => new Set(Array.isArray(codeGenExpandedGroupsByPlc?.[chatKey]) ? codeGenExpandedGroupsByPlc[chatKey] : []),
    [chatKey, codeGenExpandedGroupsByPlc]
  );
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
    if (!q) return src;
    return src.filter((tag) => {
      const name = String(tag || "").toLowerCase();
      const equipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").toLowerCase();
      return name.includes(q) || equipmentType.includes(q);
    });
  }, [codeGenTagMeta, codeGenTagSearch, codeGenUserTags]);
  const codeGenPersistProfile = useMemo(() => {
    const tags = Array.isArray(codeGenUserTags)
      ? codeGenUserTags
          .map((t) => String(t || "").trim())
          .filter(Boolean)
      : [];
    const tagMeta = tags.reduce((acc, tag) => {
      const equipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").trim();
      if (equipmentType) acc[tag] = { equipmentType };
      return acc;
    }, {});
    const groups = codeGenGroups.map((group) => {
      const id = String(group?.id || "").trim();
      const name = String(group?.name || "").trim();
      const parentId = String(group?.parentId || "").trim();
      const dbId = String(group?.dbId || "").trim();
      const groupType = normalizeCodeGenGroupType(group?.groupType);
      const row = {
        id,
        name,
        parentId,
        groupType,
        tags: (Array.isArray(group?.tags) ? group.tags : [])
          .map((t) => String(t || "").trim())
          .filter((t) => tags.includes(t)),
      };
      if (dbId) row.dbId = dbId;
      return row;
    });
    const expandedGroupIds = Array.from(codeGenExpandedSet.values()).map((id) => String(id || "").trim()).filter(Boolean);
    return {
      format: normalizeCodeGenFormat(codeGenFormat),
      tags,
      tagMeta,
      groups,
      expandedGroupIds,
      l5xTemplateText: String(codeGenRouteTemplateText || ""),
      templateRouteId: String(codeGenTemplateRouteIdDraft || ""),
      templateRouteName: String(codeGenTemplateRouteName || ""),
    };
  }, [
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
    if (String(activeTab || "") !== "code-gen-pro" || !codeGenReady) return;
    const key = String(chatKey || "").trim();
    const raw = String(selected?.rawText || "");
    if (!key || key === "__none__" || !raw.trim()) return;
    const timer = setTimeout(() => {
      const isL5xXml = /<RSLogix5000Content\b/i.test(raw);
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
    }, 0);
    return () => clearTimeout(timer);
  }, [activeTab, codeGenReady, chatKey, selected?.rawText, selected?.name]);
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
    const validTagSet = new Set(Array.isArray(codeGenUserTags) ? codeGenUserTags : []);
    setCodeGenTagMetaByPlc((prev) => {
      const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const entries = Object.entries(current).filter(([tag]) => validTagSet.has(tag));
      if (entries.length === Object.keys(current).length) return prev;
      return { ...(prev || {}), [chatKey]: Object.fromEntries(entries) };
    });
  }, [chatKey, codeGenUserTags]);
  useEffect(() => {
    const key = String(chatKey || "").trim();
    if (!selected?.id || !key || key === "__none__") return;
    let cancelled = false;
    setCodeGenPersistReadyByPlc((prev) => ({ ...(prev || {}), [key]: false }));
    (async () => {
      try {
        const res = await fetch(`/api/ai/code-gen-pro/${encodeURIComponent(key)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(data?.error || "Failed to load Code Gen profile."));
        const profile = data?.profile && typeof data.profile === "object" ? data.profile : null;
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
          if (equipmentType) acc[tag] = { equipmentType };
          return acc;
        }, {});
        const loadedGroups = Array.isArray(profile?.groups)
          ? profile.groups
              .map((group, idx) => {
                const id = String(group?.id || `grp_${idx + 1}`).trim();
                const name = String(group?.name || "").trim();
                const parentId = String(group?.parentId || "").trim();
                const dbId = String(group?.dbId || "").trim();
                const groupType = normalizeCodeGenGroupType(group?.groupType || group?.grouptype);
                const tags = (Array.isArray(group?.tags) ? group.tags : [])
                  .map((t) => normalizeCodeGenTag(t))
                  .filter((t) => loadedTags.includes(t));
                if (!id || !name) return null;
                return {
                  id,
                  name,
                  parentId,
                  groupType,
                  tags: Array.from(new Set(tags)),
                  ...(dbId ? { dbId, dbSyncState: "ok" } : {}),
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
        const loadedFormatRaw = normalizeCodeGenFormat(profile?.format);
        const loadedFormat = loadedFormatRaw === "list" ? "l5x-template" : loadedFormatRaw;
        if (cancelled) return;
        setCodeGenTagsByPlc((prev) => ({ ...(prev || {}), [key]: loadedTags }));
        setCodeGenTagMetaByPlc((prev) => ({ ...(prev || {}), [key]: loadedTagMeta }));
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
        codeGenLastSavedSnapshotByPlcRef.current[key] = JSON.stringify({
          format: loadedFormat,
          tags: loadedTags,
          tagMeta: loadedTagMeta,
          groups: loadedGroups.map((g) => ({
            id: String(g?.id || ""),
            name: String(g?.name || ""),
            parentId: String(g?.parentId || ""),
            groupType: normalizeCodeGenGroupType(g?.groupType),
            tags: Array.isArray(g?.tags) ? g.tags : [],
            ...(String(g?.dbId || "").trim() ? { dbId: String(g.dbId) } : {}),
          })),
          expandedGroupIds: loadedExpanded,
          l5xTemplateText: String(profile?.l5xTemplateText || ""),
          templateRouteId: String(profile?.templateRouteId || ""),
          templateRouteName: String(profile?.templateRouteName || ""),
        });
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
  }, [chatKey, selected?.id]);
  useEffect(() => {
    const key = String(chatKey || "").trim();
    if (!selected?.id || !key || key === "__none__") return;
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
  }, [chatKey, codeGenPersistProfile, codeGenPersistReadyByPlc, codeGenPersistSnapshot, selected?.id]);

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
          const existing = nextMeta?.[tag] && typeof nextMeta[tag] === "object" ? nextMeta[tag] : {};
          if (String(existing?.equipmentType || "").trim() === equipmentType) return;
          nextMeta[tag] = { ...existing, equipmentType };
          metaUpdates += 1;
        });
        return { ...(prev || {}), [chatKey]: nextMeta };
      });
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

  const updateCodeGenTagEquipment = (tagRaw, equipmentTypeRaw) => {
    const tag = normalizeCodeGenTag(tagRaw);
    if (!tag) return;
    const equipmentType = String(equipmentTypeRaw || "").trim();
    setCodeGenTagMetaByPlc((prev) => {
      const current = prev?.[chatKey] && typeof prev[chatKey] === "object" ? prev[chatKey] : {};
      const existing = current?.[tag] && typeof current[tag] === "object" ? current[tag] : {};
      if (equipmentType) {
        return {
          ...(prev || {}),
          [chatKey]: {
            ...current,
            [tag]: { ...existing, equipmentType },
          },
        };
      }
      if (!Object.prototype.hasOwnProperty.call(current, tag)) return prev;
      const nextMeta = { ...current };
      delete nextMeta[tag];
      return { ...(prev || {}), [chatKey]: nextMeta };
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
    const name = String(codeGenGroupNameDraft || "").trim();
    if (!name) {
      toastInfo("Enter a group name.");
      return;
    }
    const groupType = normalizeCodeGenGroupType(codeGenGroupTypeDraft);
    const parentId = String(codeGenGroupParentDraft || "").trim();
    const parentGroup = codeGenGroups.find((g) => String(g?.id || "") === parentId) || null;
    const nextGroup = {
      id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      parentId,
      groupType,
      tags: [],
      dbId: "",
      dbSyncState: "pending",
    };
    updateCodeGenGroups((curr) => [...curr, nextGroup]);
    setCodeGenExpandedGroupsByPlc((prev) => {
      const current = new Set(Array.isArray(prev?.[chatKey]) ? prev[chatKey] : []);
      current.add(nextGroup.id);
      return { ...(prev || {}), [chatKey]: Array.from(current) };
    });
    setCodeGenGroupNameDraft("");
    toastInfo(`Created group "${name}" locally. Saving to Route DB group...`);
    try {
      const dbGroupName = name.slice(0, 50);
      const payload = {
        groupname: dbGroupName,
        grouptype: groupType,
        enabled: true,
        sortorder: codeGenGroups.length + 1,
      };
      const parentDbIdRaw = parentGroup?.dbId;
      const parentDbId = Number(parentDbIdRaw);
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
      updateCodeGenGroups((curr) =>
        curr.map((g) =>
          String(g?.id || "") === nextGroup.id
            ? {
                ...g,
                dbId: Number.isFinite(dbId) && dbId > 0 ? String(dbId) : "",
                dbSyncState: "ok",
              }
            : g
        )
      );
      toastSuccess(`Created group "${name}" and saved to Route DB.`);
    } catch (err) {
      const message = String(err?.message || "Route DB group create failed.");
      updateCodeGenGroups((curr) =>
        curr.map((g) =>
          String(g?.id || "") === nextGroup.id
            ? { ...g, dbSyncState: "error", dbError: message }
            : g
        )
      );
      toastError(`Created group "${name}" locally. Database sync failed: ${message}`);
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
      curr.map((g) => (String(g?.id || "") === id ? { ...g, groupType: nextType } : g))
    );
  };

  const moveTagToGroup = (tagRaw, targetGroupIdRaw) => {
    const tag = String(tagRaw || "").trim();
    const targetGroupId = String(targetGroupIdRaw || "").trim();
    if (!tag || !targetGroupId) return;
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
                    {isExpanded ? "−" : "+"}
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
            Source: <strong style={{ color: "var(--text)" }}>{selected?.name || "No PLC selected"}</strong>
          </div>
          {!selected ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              Select or upload an L5X/L5K file in Overview first.
            </div>
          ) : !aoiTemplates.length ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              No AOI definitions found in this file.
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
                          {expandedAoiSet.has(String(template.name || "").trim().toLowerCase()) ? "−" : "+"}
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
                          {expanded ? "−" : "+"}
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
            Source: <strong style={{ color: "var(--text)" }}>{selected?.name || "No PLC selected"}</strong>
          </div>
          {!selected ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              Select or upload an L5X/L5K file in Overview first.
            </div>
          ) : !dataTypeTemplates.length ? (
            <div style={{ border: "1px dashed var(--border)", borderRadius: 10, padding: 16, fontSize: 12, color: "var(--text-muted)" }}>
              No Data Type definitions found in this file.
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
                          {expandedDataTypeSet.has(String(template.name || "").trim().toLowerCase()) ? "−" : "+"}
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
          {!selected ? (
            <div
              style={{
                border: "1px dashed var(--border)",
                borderRadius: 10,
                padding: 16,
                fontSize: 12,
                color: "var(--text-muted)",
                minHeight: 0,
                flex: 1,
              }}
            >
              Select or upload an L5X/L5K file in Overview first.
            </div>
          ) : !codeGenReady ? (
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
                  Route template is auto-captured from the uploaded file and stored in the database profile.
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
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 0,
                      minHeight: 0,
                      height: "100%",
                    }}
                  >
                    <div style={{ borderRight: "1px solid var(--border)", display: "grid", gridTemplateRows: "auto auto 1fr" }}>
                      <div style={{ padding: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(120px,1fr) auto", gap: 6, marginBottom: 6 }}>
                          <input
                            value={codeGenNewTagDraft}
                            onChange={(e) => setCodeGenNewTagDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              addCodeGenTag(codeGenNewTagDraft, codeGenNewTagEquipmentDraft);
                            }}
                            placeholder="Add tag (e.g. Motor_RunCmd)"
                            style={{
                              width: "100%",
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 11,
                              boxSizing: "border-box",
                            }}
                          />
                          <input
                            value={codeGenNewTagEquipmentDraft}
                            onChange={(e) => setCodeGenNewTagEquipmentDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              addCodeGenTag(codeGenNewTagDraft, codeGenNewTagEquipmentDraft);
                            }}
                            placeholder="Equipment type"
                            style={{
                              width: "100%",
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 11,
                              boxSizing: "border-box",
                            }}
                          />
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
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Add
                          </button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                          <label
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              minHeight: 30,
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                              lineHeight: 1,
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
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            Columns: `tag`/`name` and optional `equipment`/`type`
                          </span>
                        </div>
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
                            fontSize: 11,
                            boxSizing: "border-box",
                          }}
                        />
                      </div>
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const dropped = String(
                            e.dataTransfer?.getData("text/plain") || codeGenDragTag || ""
                          ).trim();
                          if (!dropped) return;
                          moveTagToUngrouped(dropped);
                        }}
                        style={{
                          margin: "0 8px 8px 8px",
                          border: "1px dashed var(--border)",
                          borderRadius: 8,
                          padding: "6px 8px",
                          fontSize: 10,
                          color: "var(--text-muted)",
                          background: "var(--bg-soft)",
                        }}
                        title="Drop here to ungroup a tag"
                      >
                        Ungrouped Drop Zone
                      </div>
                      <div className="vizi-scroll" style={{ overflow: "auto", padding: "0 8px 8px 8px", display: "grid", gap: 6, alignContent: "start" }}>
                        {filteredCodeGenTags.map((tag) => {
                          const grouped = codeGenAssignedTagSet.has(tag);
                          const equipmentType = String(codeGenTagMeta?.[tag]?.equipmentType || "").trim();
                          return (
                            <div
                              key={`codegen-tag-${tag}`}
                              draggable
                              onDragStart={(e) => {
                                setCodeGenDragTag(tag);
                                e.dataTransfer?.setData("text/plain", tag);
                              }}
                              onDragEnd={() => setCodeGenDragTag("")}
                              style={{
                                border: "1px solid var(--border)",
                                borderRadius: 8,
                                padding: "6px 8px",
                                fontSize: 11,
                                color: "var(--text)",
                                background: grouped ? "color-mix(in srgb, #2b6cff 10%, var(--bg-elev))" : "var(--bg-elev)",
                                cursor: "grab",
                                display: "grid",
                                gap: 2,
                              }}
                              title={tag}
                            >
                              <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tag}</div>
                              <input
                                value={equipmentType}
                                onChange={(e) => updateCodeGenTagEquipment(tag, e.target.value)}
                                placeholder="Equipment type"
                                style={{
                                  width: "100%",
                                  border: "1px solid var(--border)",
                                  background: "var(--bg)",
                                  color: "var(--text)",
                                  borderRadius: 6,
                                  padding: "3px 6px",
                                  fontSize: 10,
                                  boxSizing: "border-box",
                                }}
                              />
                              <div style={{ fontSize: 10, color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <span>{grouped ? "Grouped" : "Ungrouped"}</span>
                                <button
                                  type="button"
                                  data-preserve-style="true"
                                  onClick={() => removeCodeGenTag(tag)}
                                  style={{
                                    border: "none",
                                    background: "transparent",
                                    color: "#f04438",
                                    padding: 0,
                                    fontSize: 10,
                                    lineHeight: 1,
                                    cursor: "pointer",
                                    fontWeight: 700,
                                  }}
                                  title="Delete tag"
                                >
                                  Delete
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

                    <div style={{ borderRight: "1px solid var(--border)", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
                      <div style={{ padding: 8, borderBottom: "1px solid var(--border)", display: "grid", gap: 6 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) minmax(120px,1fr) auto", gap: 6 }}>
                          <input
                            value={codeGenGroupNameDraft}
                            onChange={(e) => setCodeGenGroupNameDraft(e.target.value)}
                            placeholder="New group name"
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 8px",
                              fontSize: 11,
                            }}
                          />
                          <select
                            value={codeGenGroupTypeDraft}
                            onChange={(e) => setCodeGenGroupTypeDraft(String(e.target.value || "Group"))}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-elev)",
                              color: "var(--text)",
                              borderRadius: 8,
                              padding: "6px 8px",
                              fontSize: 11,
                            }}
                          >
                            {CODE_GEN_GROUP_TYPES.map((groupType) => (
                              <option key={`group-type-opt-${groupType}`} value={groupType}>
                                {groupType}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            data-preserve-style="true"
                            onClick={createCodeGenGroup}
                            style={{
                              border: "1px solid #2b6cff",
                              background: "#2b6cff",
                              color: "#fff",
                              borderRadius: 8,
                              padding: "6px 10px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            Add
                          </button>
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          Parent Group:{" "}
                          <span style={{ color: "var(--text)", fontWeight: 700 }}>
                            {(() => {
                              const parent = codeGenGroups.find((g) => String(g?.id || "") === String(codeGenGroupParentDraft || ""));
                              return parent ? String(parent?.name || "Group") : "Main";
                            })()}
                          </span>{" "}
                          - click any group row below to nest under it.
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Drag tags from the left pane and drop onto a group node.</div>
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
                          {(() => {
                          const groupTreeSort = (a, b) => {
                            const typeRank = (row) => {
                              const t = String(row?.groupType || "").trim().toLowerCase();
                              if (t === "subroute") return 0;
                              if (t === "sender") return 1;
                              if (t === "receiver") return 2;
                              return 3;
                            };
                            const byType = typeRank(a) - typeRank(b);
                            if (byType !== 0) return byType;
                            return String(a?.name || "").localeCompare(String(b?.name || ""));
                          };
                          const rootGroups = codeGenGroups
                            .filter((g) => !String(g?.parentId || "").trim())
                            .sort(groupTreeSort);
                          const childrenByParent = new Map();
                          codeGenGroups.forEach((g) => {
                            const parent = String(g?.parentId || "").trim();
                            if (!parent) return;
                            if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
                            childrenByParent.get(parent).push(g);
                          });
                          const renderGroupNode = (group, depth = 0, path = new Set()) => {
                            const id = String(group?.id || "");
                            if (!id) return null;
                            const typeKey = String(group?.groupType || "").trim().toLowerCase();
                            const typeTint = (() => {
                              if (typeKey === "route") return "rgba(43,108,255,0.10)";
                              if (typeKey === "subroute") return "rgba(18,183,106,0.10)";
                              if (typeKey === "sender") return "rgba(245,158,11,0.10)";
                              if (typeKey === "receiver") return "rgba(6,182,212,0.10)";
                              if (typeKey === "bin") return "rgba(99,102,241,0.10)";
                              if (typeKey === "equipment") return "rgba(148,163,184,0.10)";
                              return "rgba(148,163,184,0.06)";
                            })();
                            const isCycle = path.has(id);
                            const children = (childrenByParent.get(id) || []).slice().sort(groupTreeSort);
                            const hasChildren = children.length > 0;
                            const expanded = codeGenExpandedSet.has(id);
                            const tags = (Array.isArray(group?.tags) ? group.tags : [])
                              .map((x) => String(x || "").trim())
                              .filter(Boolean)
                              .sort((a, b) => a.localeCompare(b));
                            const nextPath = new Set(path);
                            nextPath.add(id);
                            return (
                              <div key={`group-node-${id}`} style={{ marginLeft: depth * 12, display: "grid", gap: 3 }}>
                                <div
                                  onClick={() => {
                                    setCodeGenGroupParentDraft(id);
                                    setCodeGenSelectedGroupId(id);
                                  }}
                                  onDragOver={(e) => e.preventDefault()}
                                  onDrop={(e) => {
                                    e.preventDefault();
                                    const dropped = String(
                                      e.dataTransfer?.getData("text/plain") || codeGenDragTag || ""
                                    ).trim();
                                    if (!dropped) return;
                                    moveTagToGroup(dropped, id);
                                  }}
                                  style={{
                                    border: "1px solid var(--border)",
                                    borderRadius: 8,
                                    background:
                                      String(codeGenGroupParentDraft || "") === id
                                        ? `color-mix(in srgb, ${typeTint} 160%, var(--bg-elev))`
                                        : `color-mix(in srgb, ${typeTint} 100%, var(--bg-elev))`,
                                    padding: 4,
                                    display: "grid",
                                    gap: 4,
                                    cursor: "pointer",
                                  }}
                                >
                                  <div style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr) minmax(100px,auto) auto", gap: 5, alignItems: "center" }}>
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
                                      {hasChildren ? (expanded ? "−" : "+") : "·"}
                                    </button>
                                    <input
                                      value={String(group?.name || "")}
                                      onChange={(e) => renameCodeGenGroup(id, e.target.value)}
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
                                      }}
                                    />
                                    <select
                                      value={normalizeCodeGenGroupType(group?.groupType)}
                                      onChange={(e) => setCodeGenGroupType(id, e.target.value)}
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
                                      }}
                                      title="Group type"
                                    >
                                      {CODE_GEN_GROUP_TYPES.map((groupType) => (
                                        <option key={`group-node-type-${id}-${groupType}`} value={groupType}>
                                          {groupType}
                                        </option>
                                      ))}
                                    </select>
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
                                        display: "grid",
                                        placeItems: "center",
                                        fontSize: 10,
                                        fontWeight: 700,
                                        cursor: "pointer",
                                      }}
                                      title="Delete group"
                                      aria-label="Delete group"
                                    >
                                      ×
                                    </button>
                                  </div>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                    {tags.map((tag) => (
                                      <div
                                        key={`group-tag-${id}-${tag}`}
                                        draggable
                                        onDragStart={(e) => {
                                          setCodeGenDragTag(tag);
                                          e.dataTransfer?.setData("text/plain", tag);
                                        }}
                                        onDragEnd={() => setCodeGenDragTag("")}
                                        style={{
                                          border: "1px solid #2b6cff",
                                          background: "color-mix(in srgb, #2b6cff 12%, var(--bg-elev))",
                                          color: "var(--text)",
                                          borderRadius: 999,
                                          padding: "3px 7px",
                                          fontSize: 9,
                                          fontWeight: 700,
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                          cursor: "grab",
                                        }}
                                      >
                                        <span>
                                          {tag}
                                          {String(codeGenTagMeta?.[tag]?.equipmentType || "").trim()
                                            ? ` (${String(codeGenTagMeta?.[tag]?.equipmentType || "").trim()})`
                                            : ""}
                                        </span>
                                        <button
                                          type="button"
                                          data-preserve-style="true"
                                          onClick={() => removeTagFromGroup(tag, id)}
                                          style={{
                                            border: "none",
                                            background: "transparent",
                                            color: "var(--text-muted)",
                                            padding: 0,
                                            fontSize: 10,
                                            lineHeight: 1,
                                            cursor: "pointer",
                                          }}
                                          title="Remove from group"
                                        >
                                          x
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                {hasChildren && expanded && !isCycle ? (
                                  <div style={{ display: "grid", gap: 6 }}>
                                    {children.map((child) => renderGroupNode(child, depth + 1, nextPath))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          };
                          return rootGroups.length ? (
                            rootGroups.map((group) => renderGroupNode(group, 0, new Set()))
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
                              const childrenCount = codeGenGroups.filter(
                                (g) => String(g?.parentId || "") === selectedId
                              ).length;
                              const tags = (Array.isArray(selectedGroup?.tags) ? selectedGroup.tags : [])
                                .map((x) => String(x || "").trim())
                                .filter(Boolean)
                                .sort((a, b) => a.localeCompare(b));
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
                      style={{
                        borderLeft: "1px solid var(--border)",
                        borderRadius: 0,
                        background: "var(--bg-elev)",
                        minHeight: 0,
                        overflow: "hidden",
                        display: "grid",
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
                          const childrenCount = codeGenGroups.filter((g) => String(g?.parentId || "") === selectedId).length;
                          const tags = (Array.isArray(selectedGroup?.tags) ? selectedGroup.tags : [])
                            .map((x) => String(x || "").trim())
                            .filter(Boolean)
                            .sort((a, b) => a.localeCompare(b));
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
                            </>
                          );
                        })()}
                      </div>
                    </div>
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
