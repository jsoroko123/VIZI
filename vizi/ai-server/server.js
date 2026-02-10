import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import process from "process";
import OpenAI from "openai";
import pkg from "pg";

const { Pool } = pkg;

const PORT = Number(process.env.PORT || 5055);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const REPO_ROOT = process.env.VIZI_ROOT || path.resolve(process.cwd(), "..");
const OPC_STATUS_PATH = path.resolve(REPO_ROOT, "opc-server", "status.json");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const DATABASE_URL = process.env.DATABASE_URL || "";

function quoteIdent(name) {
  const safe = /^[a-zA-Z0-9_]+$/.test(name);
  if (!safe) {
    throw new Error("Database name must be alphanumeric/underscore.");
  }
  return `"${name.replace(/"/g, "\"\"")}"`;
}

async function ensureDatabaseExists() {
  if (!DATABASE_URL) return;
  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.replace("/", "");
  if (!dbName) return;

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = "/postgres";

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    const { rows } = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${quoteIdent(dbName)}`);
    }
  } finally {
    await adminPool.end();
  }
}

let pool = null;

function safeIdent(name) {
  const ok = /^[a-zA-Z0-9_]+$/.test(String(name || ""));
  if (!ok) throw new Error("Invalid identifier.");
  return `"${name}"`;
}

async function getPrimaryKey(table) {
  const sql = `
    SELECT a.attname AS column
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = $1::regclass AND i.indisprimary
    ORDER BY a.attnum
    LIMIT 1;
  `;
  const res = await pool.query(sql, [`public.${table}`]);
  return res.rows[0]?.column || null;
}

async function buildSchemaContext() {
  const tablesSql = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;
  const { rows: tables } = await pool.query(tablesSql);
  if (!tables.length) return "";

  const lines = [];
  for (const row of tables) {
    const table = row.table_name;
    const colsSql = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position;
    `;
    const { rows: cols } = await pool.query(colsSql, [table]);
    const pk = await getPrimaryKey(table);
    const colText = cols
      .map((c) => `${c.column_name} ${c.data_type}${c.is_nullable === "NO" ? " not null" : ""}`)
      .join(", ");
    lines.push(`${table}${pk ? ` (pk: ${pk})` : ""}: ${colText || "(no columns)"}`);
  }

  return lines.join("\n");
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "ollama",
  baseURL: process.env.OPENAI_BASE_URL || undefined,
});

const OLLAMA_NATIVE_URL = process.env.OLLAMA_NATIVE_URL || "";

function extractJson(text) {
  if (!text) return null;
  let trimmed = String(text).trim();
  trimmed = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      // fall through
    }
  }
  return null;
}

function repairJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  s = s.replace(/,\s*([}\]])/g, "$1");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function validateSql(sql) {
  const text = String(sql || "").trim();
  if (!text) throw new Error("Empty SQL.");
  const statements = text
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!statements.length) throw new Error("No SQL statements found.");
  return statements;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/opc/config", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT config FROM opc_config WHERE id = 1"
    );
    if (rows.length) {
      res.json(rows[0].config);
      return;
    }
    res.status(404).json({ error: "OPC config not found." });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load OPC config." });
  }
});

app.post("/api/opc/config", async (req, res) => {
  try {
    const next = req.body || {};
    await pool.query(
      "INSERT INTO opc_config (id, config) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()",
      [JSON.stringify(next)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save OPC config." });
  }
});

app.post("/api/opc/restart", (_req, res) => {
  try {
    const flagPath = path.resolve(REPO_ROOT, "opc-server", "restart.requested");
    const at = Date.now();
    fs.writeFileSync(flagPath, JSON.stringify({ at }, null, 2));
    res.json({ ok: true, message: "Restart Requested...", at });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to request restart." });
  }
});

app.get("/api/opc/status", (_req, res) => {
  try {
    if (!fs.existsSync(OPC_STATUS_PATH)) {
      res.json({ values: {}, errors: {}, at: null });
      return;
    }
    const raw = fs.readFileSync(OPC_STATUS_PATH, "utf-8");
    res.json(JSON.parse(raw));
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load OPC status." });
  }
});

app.get("/api/opc/templates", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT name, fields, parent_name FROM opc_tag_templates ORDER BY name"
    );
    res.json({ templates: rows });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load templates." });
  }
});

app.post("/api/opc/templates", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const fields = req.body?.fields;
    const parentName = String(req.body?.parent_name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Template name required." });
      return;
    }
    if (!Array.isArray(fields)) {
      res.status(400).json({ error: "fields must be an array." });
      return;
    }
    if (parentName && parentName === name) {
      res.status(400).json({ error: "Template cannot extend itself." });
      return;
    }
    await pool.query(
      `
      INSERT INTO opc_tag_templates (name, fields, parent_name)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (name)
      DO UPDATE SET fields = EXCLUDED.fields, parent_name = EXCLUDED.parent_name
      `,
      [name, JSON.stringify(fields), parentName || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save template." });
  }
});

app.delete("/api/opc/templates/:name", async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Template name required." });
      return;
    }
    await pool.query("DELETE FROM opc_tag_templates WHERE name = $1", [name]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete template." });
  }
});

app.get("/api/db/tables", async (_req, res) => {
  try {
    const q = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    const { rows } = await pool.query(q);
    res.json({ tables: rows.map((r) => r.table_name) });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to list tables." });
  }
});

app.get("/api/db/:table/meta", async (req, res) => {
  try {
    const table = String(req.params.table || "");
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    const q = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position;
    `;
    const { rows } = await pool.query(q, [table]);
    const pk = await getPrimaryKey(table);
    res.json({ columns: rows, primaryKey: pk });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load metadata." });
  }
});

app.get("/api/db/:table", async (req, res) => {
  try {
    const table = String(req.params.table || "");
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const pk = await getPrimaryKey(table);
    const order = pk ? `ORDER BY ${safeIdent(pk)}` : "";
    const sql = `SELECT * FROM ${safeIdent(table)} ${order} LIMIT $1 OFFSET $2`;
    const { rows } = await pool.query(sql, [limit, offset]);
    const cfg = await pool.query(
      "SELECT list_fields FROM ui_table_config WHERE table_name = $1",
      [table]
    );
    const listFields = cfg.rows[0]?.list_fields || [];
    res.json({ rows, primaryKey: pk, listFields });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to fetch rows." });
  }
});

app.get("/api/db/:table/:id", async (req, res) => {
  try {
    const table = String(req.params.table || "");
    const id = req.params.id;
    const pkOverride = req.query.pk ? String(req.query.pk) : null;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    const pk = pkOverride || (await getPrimaryKey(table));
    if (!pk || !/^[a-zA-Z0-9_]+$/.test(pk)) {
      res.status(400).json({ error: "No primary key found for table." });
      return;
    }
    const sql = `SELECT * FROM ${safeIdent(table)} WHERE ${safeIdent(pk)} = $1 LIMIT 1`;
    const { rows } = await pool.query(sql, [id]);
    res.json({ row: rows[0] || null, primaryKey: pk });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to fetch row." });
  }
});

app.put("/api/db/:table/config", async (req, res) => {
  try {
    const table = String(req.params.table || "");
    const listFields = req.body?.list_fields;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    if (!Array.isArray(listFields)) {
      res.status(400).json({ error: "list_fields must be an array." });
      return;
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ui_table_config (
        table_name TEXT PRIMARY KEY,
        list_fields JSONB NOT NULL DEFAULT '[]'::jsonb
      );
    `);
    await pool.query(
      `
      INSERT INTO ui_table_config (table_name, list_fields)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (table_name)
      DO UPDATE SET list_fields = EXCLUDED.list_fields
      `,
      [table, JSON.stringify(listFields)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save config." });
  }
});

app.post("/api/db/:table", async (req, res) => {
  try {
    const table = String(req.params.table || "");
    const body = req.body || {};
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    const keys = Object.keys(body);
    if (!keys.length) {
      res.status(400).json({ error: "No fields provided." });
      return;
    }
    const cols = keys.map((k) => safeIdent(k)).join(", ");
    const vals = keys.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${safeIdent(table)} (${cols}) VALUES (${vals}) RETURNING *`;
    const { rows } = await pool.query(sql, keys.map((k) => body[k]));
    res.json({ row: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Insert failed." });
  }
});

app.put("/api/db/:table/:id", async (req, res) => {
  try {
    const table = String(req.params.table || "");
    const id = req.params.id;
    const body = req.body || {};
    const pkOverride = req.query.pk ? String(req.query.pk) : null;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    const pk = pkOverride || (await getPrimaryKey(table));
    if (!pk || !/^[a-zA-Z0-9_]+$/.test(pk)) {
      res.status(400).json({ error: "No primary key found for table." });
      return;
    }
    const keys = Object.keys(body).filter((k) => k !== pk);
    if (!keys.length) {
      res.status(400).json({ error: "No fields to update." });
      return;
    }
    const sets = keys.map((k, i) => `${safeIdent(k)} = $${i + 1}`).join(", ");
    const sql = `UPDATE ${safeIdent(table)} SET ${sets} WHERE ${safeIdent(pk)} = $${
      keys.length + 1
    } RETURNING *`;
    const { rows } = await pool.query(sql, [...keys.map((k) => body[k]), id]);
    res.json({ row: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Update failed." });
  }
});

app.delete("/api/db/:table/:id", async (req, res) => {
  try {
    const table = String(req.params.table || "");
    const id = req.params.id;
    const pkOverride = req.query.pk ? String(req.query.pk) : null;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    const pk = pkOverride || (await getPrimaryKey(table));
    if (!pk || !/^[a-zA-Z0-9_]+$/.test(pk)) {
      res.status(400).json({ error: "No primary key found for table." });
      return;
    }
    const sql = `DELETE FROM ${safeIdent(table)} WHERE ${safeIdent(pk)} = $1`;
    await pool.query(sql, [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Delete failed." });
  }
});

app.post("/api/ai/table-preview", async (req, res) => {
  try {
    const { prompt, history } = req.body || {};
    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "Missing prompt." });
      return;
    }

    let schemaContext = "";
    try {
      schemaContext = await buildSchemaContext();
    } catch (err) {
      console.warn("Schema context load failed:", err?.message || err);
    }

    const system = [
      "You are a PostgreSQL expert.",
      "Output ONLY JSON with keys: sql, summary.",
      "Do not include code fences or extra text.",
      "Use lower_snake_case for table and column names unless user specifies otherwise.",
    ].join(" ");

    const input = [
      { role: "system", content: system },
      ...(schemaContext
        ? [{ role: "system", content: `Current database schema:\n${schemaContext}` }]
        : []),
      ...(Array.isArray(history) ? history : []),
      { role: "user", content: prompt },
    ];

    async function getModelText(promptInput) {
      if (OLLAMA_NATIVE_URL) {
        const resp = await fetch(`${OLLAMA_NATIVE_URL.replace(/\/$/, "")}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            prompt: promptInput.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n"),
            stream: false,
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Ollama error: ${resp.status} ${errText}`);
        }
        const data = await resp.json();
        return data.response || "";
      }
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        input: promptInput,
      });
      return response.output_text || "";
    }

    let text = await getModelText(input);
    let json = extractJson(text) || repairJson(text);
    if (!json?.sql) {
      const strictSystem = [
        "Return ONLY valid JSON. No prose.",
        "Keys: sql, summary.",
        "Do not include markdown or code fences.",
      ].join(" ");
      const retryInput = [
        { role: "system", content: strictSystem },
        { role: "user", content: prompt },
      ];
      text = await getModelText(retryInput);
      json = extractJson(text) || repairJson(text);
    }
    if (!json?.sql) {
      res.json({
        sql: text.trim(),
        summary: "Model response did not return JSON; showing raw output.",
      });
      return;
    }

    res.json({
      sql: String(json.sql || "").trim(),
      summary: String(json.summary || "").trim(),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error." });
  }
});

app.post("/api/ai/apply", async (req, res) => {
  try {
    const { sql } = req.body || {};
    const statements = validateSql(sql);

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      for (const stmt of statements) {
        await db.query(stmt);
      }
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }

    res.json({ ok: true, applied: statements.length });
  } catch (err) {
    res.status(400).json({ error: err?.message || "Apply failed." });
  }
});

async function start() {
  await ensureDatabaseExists();
  pool = new Pool({ connectionString: DATABASE_URL });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ui_table_config (
      table_name TEXT PRIMARY KEY,
      list_fields JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_tag_templates (
      name TEXT PRIMARY KEY,
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      parent_name TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_config (
      id INT PRIMARY KEY,
      config JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE opc_tag_templates
    ADD COLUMN IF NOT EXISTS parent_name TEXT;
  `);
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`AI server listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.message || err);
  process.exit(1);
});
