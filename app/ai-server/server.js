import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import process from "process";
import OpenAI from "openai";
import pkg from "pg";
import crypto from "node:crypto";

const { Pool } = pkg;

const PORT = Number(process.env.PORT || 5055);
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const REPO_ROOT = process.env.VIZI_ROOT || path.resolve(process.cwd(), "..");
const OPC_STATUS_PATH = path.resolve(REPO_ROOT, "opc-server", "status.json");
const OPC_CONFIG_PATH = path.resolve(REPO_ROOT, "opc-server", "config.json");

const app = express();
app.use(cors({ origin: true, credentials: true }));
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

const SESSION_COOKIE = "vizi_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(header) {
  const list = {};
  if (!header) return list;
  header.split(";").forEach((cookie) => {
    const parts = cookie.split("=");
    const key = parts.shift()?.trim();
    const value = decodeURIComponent(parts.join("="));
    if (key) list[key] = value;
  });
  return list;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function scryptHash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString("hex"));
    });
  });
}

async function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scryptHash(password, salt);
  return { salt, hash };
}

async function verifyPassword(password, salt, hash) {
  const next = await scryptHash(password, salt);
  return crypto.timingSafeEqual(Buffer.from(next, "hex"), Buffer.from(hash, "hex"));
}

async function getUserFromRequest(req) {
  if (!pool) return null;
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = hashToken(token);
  const { rows } = await pool.query(
    `
    SELECT u.id, u.username
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now()
    `,
    [tokenHash]
  );
  return rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    if (req.path.startsWith("/api/auth")) return next();
    if (req.method === "OPTIONS") return next();
    if (req.path.startsWith("/api/opc/config")) {
      const opcKey = process.env.OPC_SERVER_KEY;
      const headerKey = String(req.headers["x-opc-key"] || "");
      if (opcKey) {
        if (headerKey === opcKey) return next();
      } else {
        const ip = req.ip || req.socket?.remoteAddress || "";
        if (ip === "127.0.0.1" || ip === "::1" || ip.endsWith("127.0.0.1")) {
          return next();
        }
      }
    }
    const user = await getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err?.message || "Auth failed." });
  }
}

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
  const pk = res.rows[0]?.column || null;
  if (!pk) return null;
  const check = await pool.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    LIMIT 1
    `,
    [table, pk]
  );
  return check.rows.length ? pk : null;
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

app.get("/api/auth/me", async (req, res) => {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { rows } = await pool.query(
      "SELECT id, username, display_name, avatar_url FROM users WHERE id = $1",
      [user.id]
    );
    res.json({ user: rows[0] || user });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load user." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required." });
      return;
    }
    const { rows } = await pool.query(
      "SELECT id, username, password_hash, password_salt FROM users WHERE username = $1",
      [username]
    );
    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }
    const ok = await verifyPassword(password, user.password_salt, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query(
      "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
      [user.id, tokenHash, expiresAt]
    );
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
        SESSION_TTL_MS / 1000
      )}`
    );
    res.json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name || null,
        avatar_url: user.avatar_url || null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Login failed." });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[SESSION_COOKIE];
    if (token) {
      await pool.query("DELETE FROM user_sessions WHERE token_hash = $1", [hashToken(token)]);
    }
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Logout failed." });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required." });
      return;
    }
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      res.status(400).json({ error: "Username must be 3-32 chars (a-z, 0-9, _, ., -)." });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    const { rows: countRows } = await pool.query("SELECT COUNT(*)::int AS count FROM users");
    const allowRegistration =
      String(process.env.ALLOW_REGISTRATION || "true").toLowerCase() === "true";
    if (countRows[0]?.count > 0 && !allowRegistration) {
      res.status(403).json({ error: "Registration disabled." });
      return;
    }
    const { salt, hash } = await createPasswordHash(password);
    const insert = await pool.query(
      `
      INSERT INTO users (username, password_hash, password_salt, display_name)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (username) DO NOTHING
      RETURNING id, username, display_name, avatar_url
      `,
      [username, hash, salt, username]
    );
    const user = insert.rows[0];
    if (!user) {
      res.status(409).json({ error: "Username already exists." });
      return;
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Registration failed." });
  }
});

app.put("/api/auth/profile", async (req, res) => {
  try {
    const authUser = await getUserFromRequest(req);
    if (!authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const username = String(req.body?.username || "").trim();
    const displayName = String(req.body?.display_name || "").trim();
    const avatarUrl = String(req.body?.avatar_url || "").trim();
    if (username && !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      res.status(400).json({ error: "Username must be 3-32 chars (a-z, 0-9, _, ., -)." });
      return;
    }
    if (username) {
      const existing = await pool.query(
        "SELECT id FROM users WHERE username = $1 AND id <> $2",
        [username, authUser.id]
      );
      if (existing.rows.length) {
        res.status(409).json({ error: "Username already exists." });
        return;
      }
    }
    const update = await pool.query(
      `
      UPDATE users
      SET username = COALESCE($1, username),
          display_name = COALESCE($2, display_name),
          avatar_url = COALESCE($3, avatar_url)
      WHERE id = $4
      RETURNING id, username, display_name, avatar_url
      `,
      [username || null, displayName || null, avatarUrl || null, authUser.id]
    );
    res.json({ user: update.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Profile update failed." });
  }
});

app.put("/api/auth/password", async (req, res) => {
  try {
    const authUser = await getUserFromRequest(req);
    if (!authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const currentPassword = String(req.body?.current_password || "");
    const newPassword = String(req.body?.new_password || "");
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "Current and new password required." });
      return;
    }
    if (newPassword.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    const { rows } = await pool.query(
      "SELECT password_hash, password_salt FROM users WHERE id = $1",
      [authUser.id]
    );
    const user = rows[0];
    if (!user?.password_hash || !user?.password_salt) {
      res.status(400).json({ error: "Password not set for this user." });
      return;
    }
    const ok = await verifyPassword(currentPassword, user.password_salt, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: "Invalid current password." });
      return;
    }
    const { salt, hash } = await createPasswordHash(newPassword);
    await pool.query(
      "UPDATE users SET password_hash = $1, password_salt = $2 WHERE id = $3",
      [hash, salt, authUser.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Password update failed." });
  }
});

app.use(requireAuth);

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
    if (fs.existsSync(OPC_CONFIG_PATH)) {
      const raw = fs.readFileSync(OPC_CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw || "{}");
      await pool.query(
        "INSERT INTO opc_config (id, config) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()",
        [JSON.stringify(parsed)]
      );
      res.json(parsed);
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

app.get("/api/projects", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC"
    );
    res.json({ projects: rows });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load projects." });
  }
});

app.get("/api/projects/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Project id required." });
      return;
    }
    const { rows } = await pool.query(
      "SELECT id, name, data, updated_at FROM projects WHERE id = $1",
      [id]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load project." });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const incomingId = String(req.body?.id || "").trim();
    const name = String(req.body?.name || "").trim();
    const data = req.body?.data;
    if (!name) {
      res.status(400).json({ error: "Project name required." });
      return;
    }
    if (data == null) {
      res.status(400).json({ error: "Project data required." });
      return;
    }
    const id = incomingId || crypto.randomUUID();
    if (incomingId) {
      const { rows: nameRows } = await pool.query(
        "SELECT id FROM projects WHERE name = $1 AND id <> $2",
        [name, incomingId]
      );
      if (nameRows.length) {
        res.status(409).json({ error: "Project name already exists." });
        return;
      }
      await pool.query(
        `
        INSERT INTO projects (id, name, data)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (id)
        DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()
        `,
        [id, name, JSON.stringify(data)]
      );
      const { rows } = await pool.query(
        "SELECT id, name, updated_at FROM projects WHERE id = $1",
        [id]
      );
      res.json({ project: rows[0] });
      return;
    }
    await pool.query(
      `
      INSERT INTO projects (id, name, data)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (name)
      DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      `,
      [id, name, JSON.stringify(data)]
    );
    const { rows } = await pool.query(
      "SELECT id, name, updated_at FROM projects WHERE name = $1",
      [name]
    );
    res.json({ project: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save project." });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Project id required." });
      return;
    }
    await pool.query("DELETE FROM projects WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete project." });
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
      "SELECT name, fields, parent_name, state_mappings, group_name FROM opc_tag_templates ORDER BY name"
    );
    res.json({ templates: rows });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load templates." });
  }
});

app.get("/api/opc/tag-mappings", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT tag_key, field, state, color FROM opc_tag_state_mappings ORDER BY tag_key, field, state"
    );
    res.json({ mappings: rows });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load tag mappings." });
  }
});

app.post("/api/opc/tag-mappings", async (req, res) => {
  try {
    const tagKey = String(req.body?.tag_key || "").trim();
    const mappings = req.body?.mappings;
    if (!tagKey) {
      res.status(400).json({ error: "tag_key required." });
      return;
    }
    if (!Array.isArray(mappings)) {
      res.status(400).json({ error: "mappings must be an array." });
      return;
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("DELETE FROM opc_tag_state_mappings WHERE tag_key = $1", [tagKey]);
      for (const m of mappings) {
        const field = String(m?.field ?? "").trim();
        const state = String(m?.state ?? "").trim();
        const color = String(m?.color ?? "").trim();
        if (!state || !color) continue;
        await db.query(
          `
          INSERT INTO opc_tag_state_mappings (tag_key, field, state, color)
          VALUES ($1, $2, $3, $4)
          `,
          [tagKey, field, state, color]
        );
      }
      await db.query("COMMIT");
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save tag mappings." });
  }
});

app.get("/api/opc/mapping-sets", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT name, mappings FROM opc_mapping_sets ORDER BY name"
    );
    res.json({ sets: rows });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load mapping sets." });
  }
});

app.post("/api/opc/mapping-sets", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const mappings = req.body?.mappings;
    if (!name) {
      res.status(400).json({ error: "Mapping set name required." });
      return;
    }
    if (!Array.isArray(mappings)) {
      res.status(400).json({ error: "mappings must be an array." });
      return;
    }
    await pool.query(
      `
      INSERT INTO opc_mapping_sets (name, mappings)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (name)
      DO UPDATE SET mappings = EXCLUDED.mappings
      `,
      [name, JSON.stringify(mappings)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save mapping set." });
  }
});

app.delete("/api/opc/mapping-sets/:name", async (req, res) => {
  try {
    const name = String(req.params.name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Mapping set name required." });
      return;
    }
    await pool.query("DELETE FROM opc_mapping_sets WHERE name = $1", [name]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete mapping set." });
  }
});

app.post("/api/opc/templates", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const fields = req.body?.fields;
    const stateMappings = req.body?.state_mappings;
    const parentName = String(req.body?.parent_name || "").trim();
    const groupName = String(req.body?.group_name || "").trim();
    if (!name) {
      res.status(400).json({ error: "Template name required." });
      return;
    }
    if (!Array.isArray(fields)) {
      res.status(400).json({ error: "fields must be an array." });
      return;
    }
    if (stateMappings != null && !Array.isArray(stateMappings)) {
      res.status(400).json({ error: "state_mappings must be an array." });
      return;
    }
    if (parentName && parentName === name) {
      res.status(400).json({ error: "Template cannot extend itself." });
      return;
    }
    await pool.query(
      `
      INSERT INTO opc_tag_templates (name, fields, parent_name, state_mappings, group_name)
      VALUES ($1, $2::jsonb, $3, $4::jsonb, $5)
      ON CONFLICT (name)
      DO UPDATE SET fields = EXCLUDED.fields,
      parent_name = EXCLUDED.parent_name,
      state_mappings = EXCLUDED.state_mappings,
      group_name = EXCLUDED.group_name
      `,
      [
        name,
        JSON.stringify(fields),
        parentName || null,
        JSON.stringify(stateMappings || []),
        groupName || null,
      ]
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
      const projectId =
        table === "routes" && req.query.project_id ? String(req.query.project_id) : "";
      const where = projectId ? "WHERE project_id = $3" : "";
      const sql = `SELECT * FROM ${safeIdent(table)} ${where} ${order} LIMIT $1 OFFSET $2`;
      const params = projectId ? [limit, offset, projectId] : [limit, offset];
      const { rows } = await pool.query(sql, params);
    const cfg = await pool.query(
      "SELECT list_fields, detail_fields FROM ui_table_config WHERE table_name = $1",
      [table]
    );
    const listFields = cfg.rows[0]?.list_fields || [];
    const detailFields = cfg.rows[0]?.detail_fields || [];
    res.json({ rows, primaryKey: pk, listFields, detailFields });
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
    const detailFields = req.body?.detail_fields;
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    if (!Array.isArray(listFields)) {
      res.status(400).json({ error: "list_fields must be an array." });
      return;
    }
    if (detailFields != null && !Array.isArray(detailFields)) {
      res.status(400).json({ error: "detail_fields must be an array." });
      return;
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ui_table_config (
        table_name TEXT PRIMARY KEY,
        list_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        detail_fields JSONB NOT NULL DEFAULT '[]'::jsonb
      );
    `);
    await pool.query(
      `
      INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
      VALUES ($1, $2::jsonb, COALESCE($3::jsonb, '[]'::jsonb))
      ON CONFLICT (table_name)
      DO UPDATE SET
        list_fields = EXCLUDED.list_fields,
        detail_fields = CASE
          WHEN $3::jsonb IS NULL THEN ui_table_config.detail_fields
          ELSE EXCLUDED.detail_fields
        END
      `,
      [table, JSON.stringify(listFields), detailFields == null ? null : JSON.stringify(detailFields)]
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
      list_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      detail_fields JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  await pool.query(`
    ALTER TABLE ui_table_config
    ADD COLUMN IF NOT EXISTS detail_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_salt TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS display_name TEXT;
  `);
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;
  `);
  try {
    const { rows } = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
      `
    );
    const cols = new Set(rows.map((r) => r.column_name));
    if (cols.has("name")) {
      await pool.query(`UPDATE users SET username = name WHERE username IS NULL`);
    }
    await pool.query(`UPDATE users SET display_name = username WHERE display_name IS NULL`);
    if (cols.has("password")) {
      await pool.query(`UPDATE users SET password_hash = password WHERE password_hash IS NULL`);
    }
    await pool.query(`UPDATE users SET created_at = now() WHERE created_at IS NULL`);
  } catch {
    // ignore
  }
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx ON users(username);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_tag_templates (
      name TEXT PRIMARY KEY,
      fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      parent_name TEXT,
      state_mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
      group_name TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_tag_state_mappings (
      tag_key TEXT NOT NULL,
      field TEXT,
      state TEXT NOT NULL,
      color TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tag_key, field, state)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_mapping_sets (
      name TEXT PRIMARY KEY,
      mappings JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS projects_name_idx ON projects(name);
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'routes'
      ) THEN
        ALTER TABLE routes
        ADD COLUMN IF NOT EXISTS project_id TEXT;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'routes_project_id_fkey'
        ) THEN
          ALTER TABLE routes
          ADD CONSTRAINT routes_project_id_fkey
          FOREIGN KEY (project_id) REFERENCES projects(id)
          ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'routes' AND indexname = 'routes_project_id_idx'
        ) THEN
          CREATE INDEX routes_project_id_idx ON routes(project_id);
        END IF;
      END IF;
    END$$;
  `);
  await pool.query(`
    ALTER TABLE opc_tag_templates
    ADD COLUMN IF NOT EXISTS parent_name TEXT;
  `);
  await pool.query(`
    ALTER TABLE opc_tag_templates
    ADD COLUMN IF NOT EXISTS state_mappings JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE opc_tag_templates
    ADD COLUMN IF NOT EXISTS group_name TEXT;
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
