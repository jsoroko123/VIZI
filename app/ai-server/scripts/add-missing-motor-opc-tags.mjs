import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Pool } = pg;

function parseArgs(argv = []) {
  const out = { filePath: "", apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "").trim();
    if (!token) continue;
    if (token === "--apply") {
      out.apply = true;
      continue;
    }
    if (!out.filePath) out.filePath = token;
  }
  return out;
}

function parseMotorTargets(rawL5x = "") {
  const src = String(rawL5x || "");
  const out = new Set();
  const re = /\bMotor\s*\(\s*([A-Za-z_][A-Za-z0-9_:.\[\]]*)\s*,/gi;
  let m = re.exec(src);
  while (m) {
    const tag = String(m[1] || "").trim();
    if (tag) out.add(tag);
    m = re.exec(src);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function buildGroupTemplateRows(tags = []) {
  const motorTags = (Array.isArray(tags) ? tags : []).filter(
    (t) => String(t?.plcType || "").trim().toLowerCase() === "motor"
  );
  const byGroup = new Map();
  for (const row of motorTags) {
    const group = String(row?.groupName || "").trim();
    const name = String(row?.name || "").trim();
    if (!group || !name || !name.startsWith(`${group}.`)) continue;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(row);
  }
  // Pick the group with the most rows as the template.
  let bestGroup = "";
  let bestRows = [];
  for (const [group, rows] of byGroup.entries()) {
    if (rows.length > bestRows.length) {
      bestGroup = group;
      bestRows = rows;
    }
  }
  if (!bestRows.length) return { templateGroup: "", templateRows: [], existingGroups: [] };
  return {
    templateGroup: bestGroup,
    templateRows: bestRows,
    existingGroups: Array.from(byGroup.keys()).sort((a, b) => a.localeCompare(b)),
  };
}

function createRowsForGroup(groupName, templateGroup, templateRows) {
  const out = [];
  const target = String(groupName || "").trim();
  if (!target) return out;
  for (const row of templateRows) {
    const name = String(row?.name || "").trim();
    if (!name.startsWith(`${templateGroup}.`)) continue;
    const suffix = name.slice(templateGroup.length + 1);
    if (!suffix) continue;
    const nextName = `${target}.${suffix}`;
    out.push({
      ...row,
      name: nextName,
      tagPath: nextName,
      groupName: target,
      plcType: "Motor",
      uaType: String(row?.uaType || "").trim() || "Int32",
      topic: String(row?.topic || "").trim() || "PLC1",
      enabled: row?.enabled !== false,
      muted: row?.muted === true,
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.filePath) {
    throw new Error("Usage: node scripts/add-missing-motor-opc-tags.mjs <l5x_path> [--apply]");
  }
  const filePath = path.resolve(process.cwd(), args.filePath);
  if (!fs.existsSync(filePath)) throw new Error(`L5X file not found: ${filePath}`);
  const raw = fs.readFileSync(filePath, "utf8");
  const motorTargets = parseMotorTargets(raw);
  if (!motorTargets.length) throw new Error("No Motor(...) AOI targets found in L5X.");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "postgres",
  });

  try {
    const cfgRes = await pool.query("SELECT config FROM opc_config WHERE id = 1");
    if (!cfgRes.rows.length) throw new Error("opc_config row id=1 not found.");
    const config = cfgRes.rows[0]?.config && typeof cfgRes.rows[0].config === "object" ? cfgRes.rows[0].config : {};
    const tags = Array.isArray(config.tags) ? config.tags : [];
    const { templateGroup, templateRows, existingGroups } = buildGroupTemplateRows(tags);
    if (!templateRows.length) {
      throw new Error("No existing Motor OPC tags found to use as template.");
    }

    const existingGroupSet = new Set(existingGroups.map((g) => g.toLowerCase()));
    const missingGroups = motorTargets.filter((g) => !existingGroupSet.has(g.toLowerCase()));
    const candidateRows = missingGroups.flatMap((group) =>
      createRowsForGroup(group, templateGroup, templateRows)
    );

    const existingTagKey = new Set(
      tags
        .map((t) => `${String(t?.topic || "").trim().toLowerCase()}::${String(t?.name || "").trim().toLowerCase()}`)
        .filter((k) => !k.endsWith("::"))
    );
    const rowsToAdd = [];
    for (const row of candidateRows) {
      const key = `${String(row?.topic || "").trim().toLowerCase()}::${String(row?.name || "").trim().toLowerCase()}`;
      if (!key || existingTagKey.has(key)) continue;
      existingTagKey.add(key);
      rowsToAdd.push(row);
    }

    const summary = {
      file: filePath,
      motorTargets: motorTargets.length,
      existingMotorGroups: existingGroups.length,
      missingMotorGroups: missingGroups.length,
      templateGroup,
      templateRowsPerGroup: templateRows.length,
      rowsToAdd: rowsToAdd.length,
      sampleGroupsToAdd: missingGroups.slice(0, 20),
      runMode: args.apply ? "apply" : "dry-run",
    };

    if (!args.apply) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    const nextConfig = { ...config, tags: [...tags, ...rowsToAdd] };
    await pool.query(
      `
      INSERT INTO opc_config (id, config)
      VALUES (1, $1::jsonb)
      ON CONFLICT (id) DO UPDATE
      SET config = EXCLUDED.config, updated_at = now()
      `,
      [JSON.stringify(nextConfig)]
    );
    console.log(JSON.stringify({ ...summary, newTotalTags: nextConfig.tags.length }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

