import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pkg from "pg";

const { Pool } = pkg;

function extractAttr(attrText, name) {
  const src = String(attrText || "");
  if (!src) return "";
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
  return m ? String(m[1] || "").trim() : "";
}

function parseArgs(argv = []) {
  const out = {
    filePath: "",
    udt: "",
    mode: "aoi",
    apply: false,
    dryRun: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (!token) continue;
    if (token === "--apply") {
      out.apply = true;
      out.dryRun = false;
      continue;
    }
    if (token === "--dry-run") {
      out.dryRun = true;
      out.apply = false;
      continue;
    }
    if (token.startsWith("--udt=")) {
      out.udt = token.slice("--udt=".length).trim();
      continue;
    }
    if (token === "--udt") {
      out.udt = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token.startsWith("--mode=")) {
      const v = token.slice("--mode=".length).trim().toLowerCase();
      out.mode = v === "udt" ? "udt" : "aoi";
      continue;
    }
    if (token === "--mode") {
      const v = String(argv[i + 1] || "").trim().toLowerCase();
      out.mode = v === "udt" ? "udt" : "aoi";
      i += 1;
      continue;
    }
    if (!out.filePath) {
      out.filePath = token;
    }
  }
  return out;
}

function findMotorUdts(rawL5x = "") {
  const src = String(rawL5x || "");
  const out = new Set();
  const dtRe = /<DataType\b([^>]*)>/gi;
  let m = dtRe.exec(src);
  while (m) {
    const attrs = String(m[1] || "");
    const name = extractAttr(attrs, "Name");
    if (/motor/i.test(name)) out.add(name);
    m = dtRe.exec(src);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function parseMotorAoiTargets(rawL5x = "") {
  const src = String(rawL5x || "");
  const out = new Set();
  const re = /\bMotor\s*\(\s*([A-Za-z_][A-Za-z0-9_:.\[\]]*)\s*,/gi;
  let m = re.exec(src);
  while (m) {
    const target = String(m[1] || "").trim();
    if (target) out.add(target);
    m = re.exec(src);
  }
  return Array.from(out)
    .map((name) => ({ name, dataType: "Motor" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseTagsByDataType(rawL5x = "", targetDataType = "") {
  const src = String(rawL5x || "");
  const want = String(targetDataType || "").trim().toLowerCase();
  const tags = [];
  const seen = new Set();
  const tagRe = /<Tag\b([^>]*?)(?:\/>|>[\s\S]*?<\/Tag>)/gi;
  let m = tagRe.exec(src);
  while (m) {
    const attrs = String(m[1] || "");
    const name = extractAttr(attrs, "Name");
    const dataType = extractAttr(attrs, "DataType");
    const tagType = extractAttr(attrs, "TagType");
    if (!name || !dataType) {
      m = tagRe.exec(src);
      continue;
    }
    if (want && String(dataType).toLowerCase() !== want) {
      m = tagRe.exec(src);
      continue;
    }
    // Skip alias tags. We only want real UDT instances.
    if (String(tagType || "").trim().toLowerCase() === "alias") {
      m = tagRe.exec(src);
      continue;
    }
    const key = String(name).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push({ name, dataType });
    }
    m = tagRe.exec(src);
  }
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadExistingEquipmentNameSet(pool) {
  const { rows } = await pool.query("SELECT name FROM equipment");
  const out = new Set();
  for (const row of rows || []) {
    const key = String(row?.name || "").trim().toLowerCase();
    if (key) out.add(key);
  }
  return out;
}

async function insertMissingMotors(pool, motors = [], motorUdt = "") {
  const inserted = [];
  if (!motors.length) return inserted;
  await pool.query("BEGIN");
  try {
    for (const motor of motors) {
      const name = String(motor?.name || "").trim();
      if (!name) continue;
      const type = String(motorUdt || motor?.dataType || "").trim();
      const result = await pool.query(
        `
        INSERT INTO equipment (name, type, visible, "new", tag_path, tag_sync_managed)
        VALUES ($1, $2, true, false, $3, false)
        RETURNING id, name
        `,
        [name, type, name]
      );
      if (result?.rows?.[0]) inserted.push(result.rows[0]);
    }
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
  return inserted;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.filePath) {
    throw new Error(
      "Usage: node scripts/import-l5x-motors.mjs <l5x_path> [--udt <MotorUDT>] [--dry-run|--apply]"
    );
  }
  const resolvedPath = path.resolve(process.cwd(), args.filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`L5X file not found: ${resolvedPath}`);
  }
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const motorUdts = findMotorUdts(raw);
  const chosenUdt =
    String(args.udt || "").trim() ||
    motorUdts.find((x) => /starter/i.test(x)) ||
    motorUdts[0] ||
    "";
  const tags =
    args.mode === "udt"
      ? parseTagsByDataType(raw, chosenUdt)
      : parseMotorAoiTargets(raw);
  if (!tags.length) {
    throw new Error(
      args.mode === "udt"
        ? "No motor tags matched the selected Motor UDT in this L5X."
        : "No Motor(...) AOI targets were found in this L5X."
    );
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "postgres",
  });

  try {
    const existing = await loadExistingEquipmentNameSet(pool);
    const missing = tags.filter((t) => !existing.has(String(t.name || "").trim().toLowerCase()));

    const summary = {
      file: resolvedPath,
      parseMode: args.mode,
      udt: chosenUdt,
      motorUdtsDetected: motorUdts,
      totalMotorTagsInL5x: tags.length,
      existingByName: tags.length - missing.length,
      missingByName: missing.length,
      runMode: args.apply ? "apply" : "dry-run",
      sampleMissing: missing.slice(0, 20).map((x) => x.name),
    };

    if (!args.apply) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const importType = args.mode === "aoi" ? "Motor" : chosenUdt || "Motor";
    const inserted = await insertMissingMotors(pool, missing, importType);
    console.log(
      JSON.stringify(
        {
          ...summary,
          insertedCount: inserted.length,
          insertedSample: inserted.slice(0, 20).map((x) => x.name),
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
  console.error(err?.message || err);
  process.exit(1);
});
