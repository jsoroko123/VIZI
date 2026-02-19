import { useEffect, useMemo, useRef, useState } from "react";

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

export default function PlcAnalyzer({ plcItems = [], onChange, svgCatalog = [], onInsertSvg = null }) {
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
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
  const chatScrollRef = useRef(null);

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
  const aoiTemplates = useMemo(
    () => scanAoiTemplates(String(selected?.rawText || "")),
    [selected?.rawText]
  );
  const dataTypeTemplates = useMemo(
    () => scanDataTypeTemplates(String(selected?.rawText || "")),
    [selected?.rawText]
  );
  const filteredAoiTemplates = useMemo(() => {
    const q = String(aoiTemplateSearch || "").trim().toLowerCase();
    if (!q) return aoiTemplates;
    return aoiTemplates.filter((t) => {
      const name = String(t?.name || "").toLowerCase();
      if (name.includes(q)) return true;
      return (Array.isArray(t?.fields) ? t.fields : []).some((f) =>
        String(f?.name || "").toLowerCase().includes(q)
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
        String(f?.name || "").toLowerCase().includes(q)
      );
    });
  }, [dataTypeTemplates, dataTypeTemplateSearch]);
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
              ? "Live debug service is unavailable. Restart AI server and app dev services, then reopen PLC AI tab."
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

  const isDataTypeFieldIncluded = (templateName, fieldName) => {
    const tKey = String(templateName || "").trim().toLowerCase();
    const fKey = String(fieldName || "").trim().toLowerCase();
    if (!tKey || !fKey) return false;
    const excluded = new Set(
      (Array.isArray(dataTypeExcludedFieldsByPlc?.[chatKey]?.[tKey])
        ? dataTypeExcludedFieldsByPlc[chatKey][tKey]
        : []
      ).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean)
    );
    return !excluded.has(fKey);
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

  const primitiveTypeSet = new Set([
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

  const renderDataTypeFieldTree = (rootTemplateName, fields, visitedTypes = [], depth = 0) => {
    const nodeExpandedSet = new Set(
      (Array.isArray(dataTypeNodeExpandedByPlc?.[chatKey]) ? dataTypeNodeExpandedByPlc[chatKey] : [])
        .map((k) => String(k || ""))
    );
    return (
      <div style={{ display: "grid", gap: 4 }}>
        {(Array.isArray(fields) ? fields : []).map((field) => {
          const fieldName = String(field?.name || "").trim();
          const plcType = String(field?.plcType || "").trim();
          const parsed = parsePlcDataTypeDescriptor(
            String(field?.baseType || field?.plcType || ""),
            String(field?.arraySpec || "")
          );
          const lookupType = String(parsed.baseType || field?.baseType || plcType || "").trim();
          const plcTypeKey = lookupType.toLowerCase();
          const targetTemplate =
            resolveDataTypeTemplateByTypeName(lookupType) ||
            resolveDataTypeTemplateByTypeName(field?.baseType) ||
            resolveDataTypeTemplateByTypeName(field?.plcType);
          const hasNested = Boolean(targetTemplate) && !primitiveTypeSet.has(plcTypeKey);
          const recursive = hasNested && visitedTypes.includes(plcTypeKey);
          const nodeKey = `dt:${String(rootTemplateName || "").trim()}|${visitedTypes.join(">")}|${fieldName}|${plcType}`;
          const canExpand = !recursive;
          const isExpanded = nodeExpandedSet.has(nodeKey);
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
                        depth + 1
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
        padding: 10,
        boxSizing: "border-box",
        display: "grid",
        gap: 6,
        gridAutoRows: "max-content",
        alignContent: "start",
        alignItems: "start",
      }}
    >
      <div style={{ display: "grid", gap: 2 }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>PLC L5X/L5K Analyzer</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Upload an <code>.l5x</code> or <code>.l5k</code> file to scan controller metadata, tags, programs, routines, modules, and AOIs.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          data-preserve-style="true"
          onClick={() => setActiveTab("overview")}
          style={{
            border: `1px solid ${activeTab === "overview" ? "#2b6cff" : "var(--border)"}`,
            background: activeTab === "overview" ? "#2b6cff" : "var(--bg-elev)",
            color: activeTab === "overview" ? "#ffffff" : "var(--text)",
            borderRadius: 999,
            padding: "5px 11px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Overview
        </button>
        <button
          type="button"
          data-preserve-style="true"
          onClick={() => setActiveTab("ai")}
          style={{
            border: `1px solid ${activeTab === "ai" ? "#2b6cff" : "var(--border)"}`,
            background: activeTab === "ai" ? "#2b6cff" : "var(--bg-elev)",
            color: activeTab === "ai" ? "#ffffff" : "var(--text)",
            borderRadius: 999,
            padding: "5px 11px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          AI
        </button>
        <button
          type="button"
          data-preserve-style="true"
          onClick={() => setActiveTab("aoi-templates")}
          style={{
            border: `1px solid ${activeTab === "aoi-templates" ? "#2b6cff" : "var(--border)"}`,
            background: activeTab === "aoi-templates" ? "#2b6cff" : "var(--bg-elev)",
            color: activeTab === "aoi-templates" ? "#ffffff" : "var(--text)",
            borderRadius: 999,
            padding: "5px 11px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          AOI Templates
        </button>
        <button
          type="button"
          data-preserve-style="true"
          onClick={() => setActiveTab("datatype-templates")}
          style={{
            border: `1px solid ${activeTab === "datatype-templates" ? "#2b6cff" : "var(--border)"}`,
            background: activeTab === "datatype-templates" ? "#2b6cff" : "var(--bg-elev)",
            color: activeTab === "datatype-templates" ? "#ffffff" : "var(--text)",
            borderRadius: 999,
            padding: "5px 11px",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Data Type Templates
        </button>
      </div>

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
                              maxHeight: 200,
                              overflow: "auto",
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                <div style={{ display: "grid", gap: 0, maxHeight: 460, overflow: "auto" }}>
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
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
                <div style={{ display: "grid", gap: 0, maxHeight: 460, overflow: "auto" }}>
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
    </div>
  );
}
