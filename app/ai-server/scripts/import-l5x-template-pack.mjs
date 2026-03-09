import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pkg from "pg";

const { Pool } = pkg;

const GLOBAL_CODE_GEN_BASE_KEY = "__global_l5x_base__";
const BUILTIN_TYPES = new Set(
  [
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
    "counter",
  ].map((x) => x.toLowerCase())
);

function isProjectSpecificName(nameRaw = "") {
  const name = String(nameRaw || "").trim().toLowerCase();
  return name.startsWith("ho_") || name.startsWith("ww_");
}

function extractAttr(attrText, name) {
  const src = String(attrText || "");
  if (!src) return "";
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? String(m[1] || "").trim() : "";
}

function normalizeDataTypeDescriptor(rawType, rawDims = "") {
  const type = String(rawType || "").trim();
  const dims = String(rawDims || "").trim();
  let base = type;
  let dimension = dims;
  const inline = type.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\[([^\]]+)\])?$/);
  if (inline) {
    base = String(inline[1] || "").trim();
    if (!dimension && inline[2]) dimension = String(inline[2] || "").trim();
  }
  const cleanDim = String(dimension || "")
    .replace(/^\[|\]$/g, "")
    .replace(/\s+/g, "")
    .trim();
  return {
    plcType: type || base || "DINT",
    baseType: base || "DINT",
    isArray: !!cleanDim,
    arraySpec: cleanDim,
  };
}

function mapPlcTypeToUaType(typeRaw = "") {
  const t = String(typeRaw || "").trim().toLowerCase();
  if (!t) return "String";
  if (t === "bool" || t === "bit") return "Boolean";
  if (t === "sint") return "SByte";
  if (t === "usint") return "Byte";
  if (t === "int") return "Int16";
  if (t === "uint") return "UInt16";
  if (t === "dint") return "Int32";
  if (t === "udint") return "UInt32";
  if (t === "lint") return "Int64";
  if (t === "ulint") return "UInt64";
  if (t === "real") return "Float";
  if (t === "lreal") return "Double";
  return "String";
}

function parseDataTypeTemplates(rawText = "") {
  const src = String(rawText || "");
  const out = [];
  const dataTypeRe = /<DataType\b([^>]*)>([\s\S]*?)<\/DataType>/gi;
  let m = dataTypeRe.exec(src);
  while (m) {
    const attrs = String(m[1] || "");
    const body = String(m[2] || "");
    const name = String(extractAttr(attrs, "Name") || "").trim();
    if (!name || isProjectSpecificName(name)) {
      m = dataTypeRe.exec(src);
      continue;
    }
    const fields = [];
    const seen = new Set();
    const memberRe = /<Member\b([^>]*?)\/?>/gi;
    let mm = memberRe.exec(body);
    while (mm) {
      const ma = String(mm[1] || "");
      const memberName = String(extractAttr(ma, "Name") || "").trim();
      const dataType = String(extractAttr(ma, "DataType") || "").trim();
      const dims =
        String(extractAttr(ma, "Dimension") || "").trim() ||
        String(extractAttr(ma, "Dimensions") || "").trim() ||
        String(extractAttr(ma, "ArrayDimensions") || "").trim();
      const key = memberName.toLowerCase();
      if (memberName && dataType && !seen.has(key)) {
        seen.add(key);
        const parsed = normalizeDataTypeDescriptor(dataType, dims);
        fields.push({
          name: memberName,
          tagPath: memberName,
          plcType: parsed.plcType,
          baseType: parsed.baseType,
          isArray: parsed.isArray,
          arraySpec: parsed.arraySpec,
          uaType: mapPlcTypeToUaType(parsed.baseType),
          usage: "Member",
          enabled: true,
        });
      }
      mm = memberRe.exec(body);
    }
    out.push({
      name,
      description: String(extractAttr(attrs, "Description") || "").trim(),
      fields,
    });
    m = dataTypeRe.exec(src);
  }
  return out;
}

function parseAoiTemplates(rawText = "") {
  const src = String(rawText || "");
  const out = [];
  const aoiRe = /<AddOnInstructionDefinition\b([^>]*)>([\s\S]*?)<\/AddOnInstructionDefinition>/gi;
  let m = aoiRe.exec(src);
  while (m) {
    const attrs = String(m[1] || "");
    const body = String(m[2] || "");
    const name = String(extractAttr(attrs, "Name") || "").trim();
    if (!name || isProjectSpecificName(name)) {
      m = aoiRe.exec(src);
      continue;
    }
    const fields = [];
    const seen = new Set();
    const paramRe = /<Parameter\b([^>]*?)\/?>/gi;
    let pm = paramRe.exec(body);
    while (pm) {
      const pa = String(pm[1] || "");
      const pname = String(extractAttr(pa, "Name") || "").trim();
      const ptype = String(extractAttr(pa, "DataType") || "").trim();
      const pdims =
        String(extractAttr(pa, "Dimension") || "").trim() ||
        String(extractAttr(pa, "Dimensions") || "").trim() ||
        String(extractAttr(pa, "ArrayDimensions") || "").trim();
      const key = pname.toLowerCase();
      if (pname && ptype && !seen.has(key)) {
        seen.add(key);
        const parsed = normalizeDataTypeDescriptor(ptype, pdims);
        fields.push({
          name: pname,
          tagPath: pname,
          plcType: parsed.plcType,
          baseType: parsed.baseType,
          isArray: parsed.isArray,
          arraySpec: parsed.arraySpec,
          uaType: mapPlcTypeToUaType(parsed.baseType),
          usage: String(extractAttr(pa, "Usage") || "Parameter"),
          enabled: true,
        });
      }
      pm = paramRe.exec(body);
    }
    out.push({
      name,
      description: String(extractAttr(attrs, "Description") || "").trim(),
      fields,
    });
    m = aoiRe.exec(src);
  }
  return out;
}

function parseRoutines(rawText = "") {
  const src = String(rawText || "");
  const out = [];
  const re = /<Routine\b([^>]*)>[\s\S]*?<\/Routine>/gi;
  let m = re.exec(src);
  while (m) {
    const block = String(m[0] || "");
    const attrs = String(m[1] || "");
    const name = String(extractAttr(attrs, "Name") || "").trim();
    if (name && !isProjectSpecificName(name)) {
      out.push({ routineName: name, routineKey: name.toLowerCase(), routineXml: block });
    }
    m = re.exec(src);
  }
  return out;
}

function stripProjectSpecificBlocks(rawText = "") {
  let out = String(rawText || "");
  if (!out.trim()) return out;

  out = out.replace(/<Tag\b([^>]*)\/>/gi, (full, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return isProjectSpecificName(name) ? "" : full;
  });
  out = out.replace(/<Tag\b([^>]*)>([\s\S]*?)<\/Tag>/gi, (full, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return isProjectSpecificName(name) ? "" : full;
  });

  out = out.replace(/<DataType\b([^>]*)>([\s\S]*?)<\/DataType>/gi, (full, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return isProjectSpecificName(name) ? "" : full;
  });

  out = out.replace(/<Routine\b([^>]*)>([\s\S]*?)<\/Routine>/gi, (full, attrs) => {
    const name = extractAttr(String(attrs || ""), "Name");
    return isProjectSpecificName(name) ? "" : full;
  });

  return out;
}

function inferRouteNameAndId(rawText = "") {
  const src = String(rawText || "");
  const routeTag = src.match(/<Tag\b[^>]*\bName="(Route\d+)"/i);
  if (routeTag && routeTag[1]) {
    const routeName = String(routeTag[1]).trim();
    const idMatch = routeName.match(/(\d+)/);
    return { routeName, routeId: idMatch ? String(idMatch[1]) : "1" };
  }
  return { routeName: "Route1", routeId: "1" };
}

async function ensureTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_tag_templates (
      name TEXT PRIMARY KEY,
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      parent_name TEXT,
      state_mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
      group_name TEXT NOT NULL DEFAULT ''
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plc_code_gen_profile (
      plc_key TEXT PRIMARY KEY,
      profile JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS route_l5x_template (
      template_key TEXT PRIMARY KEY,
      route_name TEXT NOT NULL,
      source_filename TEXT NOT NULL DEFAULT '',
      template_text TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plc_l5x_routine_template (
      plc_key TEXT NOT NULL,
      routine_key TEXT NOT NULL,
      routine_name TEXT NOT NULL,
      source_filename TEXT NOT NULL DEFAULT '',
      routine_xml TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (plc_key, routine_key)
    );
  `);
}

async function upsertOpcTemplates(pool, templates = [], groupName = "") {
  const group = String(groupName || "").trim();
  let count = 0;
  for (const t of templates) {
    const name = String(t?.name || "").trim();
    if (!name) continue;
    const fields = Array.isArray(t?.fields) ? t.fields : [];
    await pool.query(
      `
      INSERT INTO opc_tag_templates (name, fields, parent_name, state_mappings, group_name)
      VALUES ($1, $2::jsonb, $3, $4::jsonb, $5)
      ON CONFLICT (name) DO UPDATE
      SET fields = EXCLUDED.fields,
          parent_name = EXCLUDED.parent_name,
          state_mappings = EXCLUDED.state_mappings,
          group_name = EXCLUDED.group_name
      `,
      [name, JSON.stringify(fields), null, JSON.stringify([]), group]
    );
    count += 1;
  }
  return count;
}

async function main() {
  const fileArg = String(process.argv[2] || "").trim();
  const templateKey = String(process.argv[3] || GLOBAL_CODE_GEN_BASE_KEY).trim().toLowerCase();
  if (!fileArg) {
    throw new Error("Usage: node scripts/import-l5x-template-pack.mjs <l5x_path> [templateKey]");
  }
  const absPath = path.resolve(fileArg);
  if (!fs.existsSync(absPath)) throw new Error(`File not found: ${absPath}`);
  const rawTextOriginal = fs.readFileSync(absPath, "utf8");
  const rawText = stripProjectSpecificBlocks(rawTextOriginal);
  if (!/<RSLogix5000Content\b/i.test(rawText)) throw new Error("Input file is not L5X content.");

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required (app/ai-server/.env).");

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  try {
    await ensureTables(pool);

    const { routeName, routeId } = inferRouteNameAndId(rawText);
    const routines = parseRoutines(rawText);
    const aoiTemplates = parseAoiTemplates(rawText);
    const dataTypeTemplates = parseDataTypeTemplates(rawText);
    const equipmentTypes = Array.from(
      new Set(
        [...aoiTemplates, ...dataTypeTemplates]
          .map((t) => String(t?.name || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    const profile = {
      format: "l5x-template",
      tags: [],
      tagMeta: {},
      groups: [],
      expandedGroupIds: [],
      equipmentTypes,
      l5xTemplateText: rawText,
      templateRouteId: routeId,
      templateRouteName: routeName,
      sourceFileName: path.basename(absPath),
      updatedAt: Date.now(),
    };

    await pool.query(
      `
      INSERT INTO plc_code_gen_profile (plc_key, profile, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (plc_key) DO UPDATE
      SET profile = EXCLUDED.profile,
          updated_at = now()
      `,
      [templateKey, JSON.stringify(profile)]
    );

    await pool.query(
      `
      INSERT INTO route_l5x_template (template_key, route_name, source_filename, template_text, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (template_key) DO UPDATE
      SET route_name = EXCLUDED.route_name,
          source_filename = EXCLUDED.source_filename,
          template_text = EXCLUDED.template_text,
          updated_at = now()
      `,
      [templateKey, routeName, path.basename(absPath), rawText]
    );

    let routineCount = 0;
    for (const r of routines) {
      await pool.query(
        `
        INSERT INTO plc_l5x_routine_template (plc_key, routine_key, routine_name, source_filename, routine_xml, updated_at)
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (plc_key, routine_key) DO UPDATE
        SET routine_name = EXCLUDED.routine_name,
            source_filename = EXCLUDED.source_filename,
            routine_xml = EXCLUDED.routine_xml,
            updated_at = now()
        `,
        [templateKey, r.routineKey, r.routineName, path.basename(absPath), r.routineXml]
      );
      routineCount += 1;
    }

    const aoiCount = await upsertOpcTemplates(pool, aoiTemplates, "AOI");
    const udtCount = await upsertOpcTemplates(pool, dataTypeTemplates, "DataType");

    console.log(
      JSON.stringify(
        {
          ok: true,
          templateKey,
          file: absPath,
          routeName,
          routeId,
          saved: {
            routines: routineCount,
            aois: aoiCount,
            udts: udtCount,
            equipmentTypes: equipmentTypes.length,
          },
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
