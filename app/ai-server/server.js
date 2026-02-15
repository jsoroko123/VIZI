import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import process from "process";
import OpenAI from "openai";
import pkg from "pg";
import crypto from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

const { Pool } = pkg;

const PORT = Number(process.env.PORT || 5055);
const DEBUG_ROUTES = process.env.DEBUG_ROUTES === "1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const REPO_ROOT = process.env.VIZI_ROOT || path.resolve(process.cwd(), "..");
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
const OPC_TREND_CHUNK_POINTS = Math.max(
  60,
  Number.parseInt(process.env.OPC_TREND_CHUNK_POINTS || "240", 10) || 240
);
const OPC_TREND_FORCE_SAMPLE_MS = Math.max(
  1000,
  Number.parseInt(process.env.OPC_TREND_FORCE_SAMPLE_MS || "30000", 10) || 30000
);
const OPC_TREND_FLUSH_IDLE_MS = Math.max(
  20000,
  Number.parseInt(process.env.OPC_TREND_FLUSH_IDLE_MS || "120000", 10) || 120000
);
const OPC_TREND_RETENTION_MS = Math.max(
  3600000,
  Number.parseInt(process.env.OPC_TREND_RETENTION_MS || `${7 * 24 * 60 * 60 * 1000}`, 10) ||
    7 * 24 * 60 * 60 * 1000
);
const TREND_CODEC = "json-gzip-v1";
const trendBuffers = new Map();
let trendLastCleanupAt = 0;
let trendTagConfigCache = { loadedAt: 0, map: null };

function toFiniteNumber(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function normalizeTrendTimestamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return Date.now();
  const t = Math.round(n);
  return t > 0 ? t : Date.now();
}

function normalizeTrendMode(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "time" ? "time" : "value";
}

async function loadTrendTagConfigMap() {
  const now = Date.now();
  if (trendTagConfigCache.map && now - Number(trendTagConfigCache.loadedAt || 0) < 5000) {
    return trendTagConfigCache.map;
  }
  try {
    let parsed = null;
    try {
      const { rows } = await pool.query("SELECT config FROM opc_config WHERE id = 1 LIMIT 1");
      if (rows.length && rows[0]?.config && typeof rows[0].config === "object") {
        parsed = rows[0].config;
      }
    } catch {
      // fall back to file below
    }
    if (!parsed && fs.existsSync(OPC_CONFIG_PATH)) {
      const text = fs.readFileSync(OPC_CONFIG_PATH, "utf8");
      parsed = JSON.parse(text);
    }
    if (!parsed || typeof parsed !== "object") {
      trendTagConfigCache = { loadedAt: now, map: null };
      return null;
    }
    const tags = Array.isArray(parsed?.tags) ? parsed.tags : [];
    const map = new Map();
    tags.forEach((t) => {
      if (t?.trendEnabled !== true) return;
      const topic = String(t?.topic || "").trim();
      const resolvedTopic = topic || "Default";
      const name = String(t?.name || "").trim();
      const tagPath = String(t?.tagPath || name).trim();
      const trendMode = normalizeTrendMode(t?.trendMode);
      const trendSampleMs = Math.max(1000, Number.parseInt(String(t?.trendSampleMs || ""), 10) || 0);
      const cfg = { trendMode, trendSampleMs: trendSampleMs || null };
      if (tagPath) {
        map.set(`${resolvedTopic}.${tagPath}`, cfg);
        if (!topic) map.set(tagPath, cfg);
      }
      if (name) {
        map.set(`${resolvedTopic}.${name}`, cfg);
        if (!topic) map.set(name, cfg);
      }
    });
    trendTagConfigCache = { loadedAt: now, map };
    return map;
  } catch {
    trendTagConfigCache = { loadedAt: now, map: null };
    return null;
  }
}

function appendTrendSample(tagKey, at, numericValue, options = {}) {
  const key = String(tagKey || "").trim();
  if (!key) return;
  const ts = normalizeTrendTimestamp(at);
  const value = Number(numericValue);
  const mode = normalizeTrendMode(options?.mode);
  const forceMs = Math.max(
    1000,
    Number.parseInt(String(options?.forceMs || ""), 10) || OPC_TREND_FORCE_SAMPLE_MS
  );
  const existing = trendBuffers.get(key);
  if (!existing) {
    trendBuffers.set(key, {
      baseTs: ts,
      baseValue: value,
      lastTs: ts,
      lastValue: value,
      points: [],
      sampleCount: 1,
    });
    return;
  }
  const sameValue = value === existing.lastValue;
  const deltaTs = ts - existing.lastTs;
  if (mode === "time") {
    if (deltaTs >= 0 && deltaTs < forceMs) return;
  } else {
    // Value mode: only append when the numeric value actually changes.
    // Do not add periodic same-value samples.
    if (sameValue) return;
  }
  const dt = Math.max(0, ts - existing.baseTs);
  const dv = value - existing.baseValue;
  existing.points.push([dt, dv]);
  existing.lastTs = ts;
  existing.lastValue = value;
  existing.sampleCount += 1;
}

async function flushTrendBuffer(tagKey) {
  const key = String(tagKey || "").trim();
  if (!key) return;
  const buffer = trendBuffers.get(key);
  if (!buffer || !buffer.sampleCount) return;
  const payloadJson = JSON.stringify({
    v: 1,
    bt: buffer.baseTs,
    bv: buffer.baseValue,
    p: buffer.points,
  });
  const payload = gzipSync(Buffer.from(payloadJson, "utf8"), { level: 9 });
  await pool.query(
    `
    INSERT INTO opc_tag_trend_chunks (
      tag_key, from_ts, to_ts, sample_count, codec, payload
    ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [key, buffer.baseTs, buffer.lastTs, buffer.sampleCount, TREND_CODEC, payload]
  );
  trendBuffers.delete(key);
}

async function flushTrendBuffersIfNeeded(at) {
  const now = normalizeTrendTimestamp(at);
  const pendingFlush = [];
  for (const [tagKey, buffer] of trendBuffers.entries()) {
    if (!buffer) continue;
    if (buffer.sampleCount >= OPC_TREND_CHUNK_POINTS) pendingFlush.push(tagKey);
    else if (now - buffer.lastTs >= OPC_TREND_FLUSH_IDLE_MS) pendingFlush.push(tagKey);
  }
  for (const tagKey of pendingFlush) {
    await flushTrendBuffer(tagKey);
  }
}

function decodeTrendChunkPayload(codec, payload) {
  if (!payload) return [];
  const raw =
    codec === TREND_CODEC
      ? gunzipSync(payload).toString("utf8")
      : Buffer.isBuffer(payload)
      ? payload.toString("utf8")
      : String(payload);
  const parsed = JSON.parse(raw);
  const baseTs = normalizeTrendTimestamp(parsed?.bt);
  const baseValue = toFiniteNumber(parsed?.bv);
  if (baseValue == null) return [];
  const points = [{ t: baseTs, v: baseValue }];
  const deltas = Array.isArray(parsed?.p) ? parsed.p : [];
  deltas.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return;
    const dt = Number(entry[0]);
    const dv = Number(entry[1]);
    if (!Number.isFinite(dt) || !Number.isFinite(dv)) return;
    points.push({ t: baseTs + Math.max(0, Math.round(dt)), v: baseValue + dv });
  });
  return points;
}

function downsampleTrendPoints(points, maxPoints) {
  const list = Array.isArray(points) ? points : [];
  const limit = Math.max(10, Number(maxPoints) || 1200);
  if (list.length <= limit) return list;
  const stride = (list.length - 1) / (limit - 1);
  const out = [];
  for (let i = 0; i < limit; i += 1) {
    const idx = Math.round(i * stride);
    out.push(list[Math.min(list.length - 1, idx)]);
  }
  return out;
}

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
    if (req.path === "/api/opc/status" && req.method === "POST") {
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

function safeQualifiedIdent(schemaName, objectName) {
  const schema = String(schemaName || "").trim();
  const object = String(objectName || "").trim();
  return `${safeIdent(schema)}.${safeIdent(object)}`;
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

function pickReferenceLabelColumn(columnNames, referencedColumn) {
  const cols = Array.isArray(columnNames) ? columnNames.map((c) => String(c)) : [];
  const lower = new Set(cols.map((c) => c.toLowerCase()));
  const preferred = [
    "name",
    "title",
    "label",
    "display_name",
    "description",
    "code",
  ];
  const found = preferred.find((p) => lower.has(p));
  if (found) {
    return cols.find((c) => c.toLowerCase() === found) || referencedColumn;
  }
  return referencedColumn;
}

async function getForeignKeysForTable(table) {
  const fkSql = `
    SELECT
      kcu.column_name AS local_column,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = $1
    ORDER BY kcu.ordinal_position
  `;
  const { rows: fkRows } = await pool.query(fkSql, [table]);
  const out = {};

  async function loadReferenceOptions(localColumn, refTable, refColumn) {
    let labelColumn = refColumn;
    let options = [];
    try {
      const colsRes = await pool.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        `,
        [refTable]
      );
      const refColumns = colsRes.rows.map((r) => String(r.column_name || "")).filter(Boolean);
      labelColumn = pickReferenceLabelColumn(refColumns, refColumn);
      const valueIdent = safeIdent(refColumn);
      const labelIdent = safeIdent(labelColumn);
      const tableIdent = safeQualifiedIdent("public", refTable);
      const lookupSql = `
        SELECT ${valueIdent} AS value, ${labelIdent} AS label
        FROM ${tableIdent}
        ORDER BY ${labelIdent} NULLS LAST, ${valueIdent}
        LIMIT 1000
      `;
      const lookup = await pool.query(lookupSql);
      options = (Array.isArray(lookup.rows) ? lookup.rows : []).map((r) => {
        const value = r?.value ?? null;
        const labelRaw = r?.label ?? null;
        const valueText = value == null ? "" : String(value);
        const labelText = labelRaw == null ? "" : String(labelRaw);
        return {
          value,
          label: labelText || valueText,
        };
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[fk-meta] lookup failed", {
        table,
        localColumn,
        referencedTable: refTable,
        referencedColumn: refColumn,
        labelColumn,
        error: String(err?.message || err),
      });
      try {
        const fallbackSql = `
          SELECT ${safeIdent(refColumn)} AS value
          FROM ${safeQualifiedIdent("public", refTable)}
          ORDER BY ${safeIdent(refColumn)}
          LIMIT 1000
        `;
        const fallback = await pool.query(fallbackSql);
        options = (Array.isArray(fallback.rows) ? fallback.rows : []).map((r) => {
          const value = r?.value ?? null;
          const valueText = value == null ? "" : String(value);
          return {
            value,
            label: valueText,
          };
        });
      } catch (fallbackErr) {
        // eslint-disable-next-line no-console
        console.warn("[fk-meta] fallback lookup failed", {
          table,
          localColumn,
          referencedTable: refTable,
          referencedColumn: refColumn,
          error: String(fallbackErr?.message || fallbackErr),
        });
        options = [];
      }
    }
    return { labelColumn, options };
  }

  for (const fk of fkRows) {
    const localColumn = String(fk?.local_column || "").trim();
    const refTable = String(fk?.referenced_table || "").trim();
    const refColumn = String(fk?.referenced_column || "").trim();
    if (
      !/^[a-zA-Z0-9_]+$/.test(localColumn) ||
      !/^[a-zA-Z0-9_]+$/.test(refTable) ||
      !/^[a-zA-Z0-9_]+$/.test(refColumn)
    ) {
      continue;
    }
    const { labelColumn, options } = await loadReferenceOptions(localColumn, refTable, refColumn);
    out[localColumn] = {
      column: localColumn,
      referencedTable: refTable,
      referencedColumn: refColumn,
      labelColumn,
      options,
    };
  }

  // Fallback for naming-convention relations when FK constraints are missing:
  // `<something>_id` -> table `<something>` (or plural variants), key `id`.
  const localColumnsRes = await pool.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    `,
    [table]
  );
  const localColumns = localColumnsRes.rows
    .map((r) => String(r?.column_name || "").trim())
    .filter(Boolean);
  const localFkCandidates = localColumns.filter((name) => name.endsWith("_id") && !out[name]);

  for (const localColumn of localFkCandidates) {
    const stem = localColumn.slice(0, -3);
    if (!/^[a-zA-Z0-9_]+$/.test(stem)) continue;
    const candidates = [stem, `${stem}s`, `${stem}es`];
    if (stem.endsWith("y") && stem.length > 1) {
      candidates.push(`${stem.slice(0, -1)}ies`);
    }
    let refTable = "";
    for (const candidate of candidates) {
      if (!/^[a-zA-Z0-9_]+$/.test(candidate)) continue;
      const exists = await pool.query(
        `
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
        LIMIT 1
        `,
        [candidate]
      );
      if (exists.rows.length) {
        refTable = candidate;
        break;
      }
    }
    if (!refTable) continue;
    const idCheck = await pool.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'
      LIMIT 1
      `,
      [refTable]
    );
    if (!idCheck.rows.length) continue;
    const refColumn = "id";
    const { labelColumn, options } = await loadReferenceOptions(localColumn, refTable, refColumn);
    out[localColumn] = {
      column: localColumn,
      referencedTable: refTable,
      referencedColumn: refColumn,
      labelColumn,
      options,
    };
  }

  return out;
}

function isMissingPublicRoutinesError(err) {
  const msg = String(err?.message || "").toLowerCase();
  return msg.includes('relation "public.routines" does not exist') || msg.includes("relation public.routines does not exist");
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

async function verifySchemaCoverage() {
  const expected = {
    ui_table_config: ["table_name", "list_fields", "detail_fields"],
    users: ["id", "username", "password_hash", "password_salt", "created_at", "display_name", "avatar_url"],
    user_sessions: ["id", "user_id", "token_hash", "created_at", "expires_at"],
    opc_tag_templates: ["name", "fields", "parent_name", "state_mappings", "group_name"],
    opc_tag_state_mappings: ["tag_key", "field", "state", "color", "updated_at"],
    opc_mapping_sets: ["name", "mappings", "updated_at"],
    opc_config: ["id", "config", "updated_at"],
    opc_status: ["id", "status", "updated_at"],
    projects: ["id", "name", "data", "created_at", "updated_at", "updated_by"],
    equipment: [
      "id",
      "name",
      "description",
      "type",
      "floor",
      "groupNumber",
      "visible",
      "new",
      "notes",
      "tag_path",
    ],
    ai_reports: ["id", "user_id", "name", "description", "sql", "created_at", "updated_at"],
  };

  for (const [table, cols] of Object.entries(expected)) {
    const { rows } = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      `,
      [table]
    );
    const existing = new Set(rows.map((r) => r.column_name));
    if (!existing.size) {
      throw new Error(`Schema verification failed: missing table "${table}"`);
    }
    const missing = cols.filter((c) => !existing.has(c));
    if (missing.length) {
      throw new Error(
        `Schema verification failed: table "${table}" missing column(s): ${missing.join(", ")}`
      );
    }
  }

  const { rows: routesTable } = await pool.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'routes'
    LIMIT 1
    `
  );
  if (routesTable.length) {
    const { rows: routeCols } = await pool.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'routes' AND column_name = 'project_id'
      LIMIT 1
      `
    );
    if (!routeCols.length) {
      throw new Error(`Schema verification failed: table "routes" missing column "project_id"`);
    }
  }
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

function extractCreatedTableNames(statements) {
  const names = new Set();
  for (const stmt of Array.isArray(statements) ? statements : []) {
    const text = String(stmt || "").trim();
    // Supports: CREATE TABLE [IF NOT EXISTS] [schema.]table (...)
    const match = text.match(
      /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?([a-zA-Z0-9_]+)"?\.)?"?([a-zA-Z0-9_]+)"?\s*\(/i
    );
    if (!match) continue;
    const schema = String(match[1] || "public").trim();
    const table = String(match[2] || "").trim();
    if (!/^[a-zA-Z0-9_]+$/.test(schema) || !/^[a-zA-Z0-9_]+$/.test(table)) continue;
    if (schema.toLowerCase() !== "public") continue;
    names.add(table);
  }
  return Array.from(names);
}

async function ensureStandardTableColumns(db, tableName) {
  const table = String(tableName || "").trim();
  if (!/^[a-zA-Z0-9_]+$/.test(table)) return;
  const tableIdent = safeIdent(table);
  await db.query(`ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY`);
  await db.query(`ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`);
}

function mergeByIdArray(base, incoming) {
  const out = new Map();
  (Array.isArray(base) ? base : []).forEach((item, idx) => {
    const key = item && typeof item === "object" && item.id ? `id:${item.id}` : `base:${idx}`;
    out.set(key, item);
  });
  (Array.isArray(incoming) ? incoming : []).forEach((item, idx) => {
    const key = item && typeof item === "object" && item.id ? `id:${item.id}` : `inc:${idx}`;
    out.set(key, item);
  });
  return Array.from(out.values());
}

function mergeProjectData(current, incoming) {
  const base = current && typeof current === "object" ? current : {};
  const next = incoming && typeof incoming === "object" ? incoming : {};
  return {
    ...base,
    ...next,
    shapes: mergeByIdArray(base.shapes, next.shapes),
    svgOverlays: mergeByIdArray(base.svgOverlays, next.svgOverlays),
  };
}

const PROJECT_CURSOR_TTL_MS = 10_000;
const projectCursorPresence = new Map();

function cleanupProjectCursors(projectId) {
  const now = Date.now();
  const key = String(projectId || "");
  const byUser = projectCursorPresence.get(key);
  if (!byUser) return;
  for (const [userId, entry] of byUser.entries()) {
    if (!entry || now - Number(entry.at || 0) > PROJECT_CURSOR_TTL_MS) {
      byUser.delete(userId);
    }
  }
  if (!byUser.size) {
    projectCursorPresence.delete(key);
  }
}

function sanitizeReadOnlyQuery(sql) {
  let text = String(sql || "").trim();
  if (!text) throw new Error("Empty query.");
  if (text.endsWith(";")) text = text.slice(0, -1).trim();
  if (!text) throw new Error("Empty query.");
  if (text.includes(";")) throw new Error("Only one SQL statement is allowed.");
  if (!/^(select|with)\b/i.test(text)) {
    throw new Error("Only read-only SELECT queries are allowed.");
  }
  if (
    /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|copy|call|execute|do)\b/i.test(
      text
    )
  ) {
    throw new Error("Only read-only SELECT queries are allowed.");
  }
  if (!/\blimit\s+\d+\b/i.test(text)) {
    text = `${text} LIMIT 100`;
  }
  return text;
}

function extractReportFilterNames(sql) {
  const text = String(sql || "");
  const names = [];
  const seen = new Set();
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  let match;
  while ((match = re.exec(text)) != null) {
    const name = String(match[1] || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function extractPositionalParamCount(sql) {
  const text = String(sql || "");
  const refs = Array.from(text.matchAll(/\$([1-9]\d*)\b/g)).map((m) => Number(m[1]));
  return refs.length ? Math.max(...refs) : 0;
}

function buildParameterizedReadOnlyQuery(sql, filters, positionalValues) {
  const text = String(sql || "");
  const provided = filters && typeof filters === "object" ? filters : {};
  const positional = Array.isArray(positionalValues) ? positionalValues : [];
  const nameToIndex = new Map();
  const values = [];
  const replaced = text.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (_all, raw) => {
    const name = String(raw || "").trim();
    const hasValue = Object.prototype.hasOwnProperty.call(provided, name);
    let idx = nameToIndex.get(name);
    if (!idx) {
      values.push(hasValue ? provided[name] : null);
      idx = values.length;
      nameToIndex.set(name, idx);
    }
    return `$${idx}`;
  });
  const positionalRefs = Array.from(replaced.matchAll(/\$([1-9]\d*)\b/g)).map((m) => Number(m[1]));
  const positionalMax = positionalRefs.length ? Math.max(...positionalRefs) : 0;
  if (positionalMax > 0 && values.length < positionalMax) {
    for (let i = values.length; i < positionalMax; i += 1) {
      values.push(i < positional.length ? positional[i] : null);
    }
  }
  const safeSql = sanitizeReadOnlyQuery(replaced);
  return { sql: safeSql, values };
}

function autoParameterizeReportSql(sql) {
  const text = String(sql || "");
  if (!text) return text;
  if (/\{\{\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/.test(text)) return text;

  const used = new Map();
  const nextName = (lhs) => {
    const baseRaw = String(lhs || "")
      .replace(/"/g, "")
      .split(".")
      .pop() || "filter";
    const base = baseRaw.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z_]+/, "") || "filter";
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  };

  return text.replace(
    /(\b(?:"?[a-zA-Z_][a-zA-Z0-9_]*"?\.)?"?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*(=|!=|<>|>=|<=|>|<|like|ilike)\s*('(?:''|[^'])*'|-?\d+(?:\.\d+)?)/gi,
    (_all, lhs, op) => `${lhs} ${op} {{${nextName(lhs)}}}`
  );
}

function extractSimpleFromTable(sql) {
  const text = String(sql || "");
  const m = text.match(/\bfrom\s+("?[\w]+"?)(?:\s+\w+)?/i);
  if (!m) return null;
  const raw = String(m[1] || "").replace(/"/g, "");
  if (!/^[a-zA-Z0-9_]+$/.test(raw)) return null;
  return raw;
}

function isFiniteNumberValue(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return false;
    const n = Number(s);
    return Number.isFinite(n);
  }
  return false;
}

function buildSummaryRow(rows, columns, includeColumns = null) {
  const dataRows = Array.isArray(rows) ? rows : [];
  const cols = Array.isArray(columns) ? columns : [];
  if (!dataRows.length || !cols.length) return null;

  const include = Array.isArray(includeColumns) && includeColumns.length
    ? new Set(includeColumns.map((c) => String(c)))
    : null;
  const numericCols = cols.filter(
    (col) =>
      (!include || include.has(String(col))) &&
      dataRows.some((row) => isFiniteNumberValue(row?.[col]))
  );
  if (!numericCols.length) return null;

  const summary = {};
  cols.forEach((col) => {
    if (!numericCols.includes(col)) {
      summary[col] = null;
      return;
    }
    let total = 0;
    dataRows.forEach((row) => {
      const v = row?.[col];
      if (isFiniteNumberValue(v)) total += Number(v);
    });
    summary[col] = total;
  });

  const labelCol = cols.find((col) => !numericCols.includes(col));
  if (labelCol) summary[labelCol] = "Total";
  return summary;
}

function extractSummedOutputColumns(sql, columns) {
  const text = String(sql || "");
  const cols = Array.isArray(columns) ? columns : [];
  if (!text || !cols.length) return [];

  const byLower = new Map(cols.map((c) => [String(c).toLowerCase(), String(c)]));
  const out = [];
  const seen = new Set();
  const re = /\bsum\s*\(([^)]+)\)\s*(?:as\s+("?[\w]+"?))?/gi;
  let m;
  while ((m = re.exec(text)) != null) {
    const inner = String(m[1] || "").trim();
    const aliasRaw = String(m[2] || "").replace(/"/g, "").trim();
    const innerField = inner.replace(/"/g, "").split(".").pop()?.trim() || "";
    const candidates = [aliasRaw, innerField, "sum"];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const actual = byLower.get(candidate.toLowerCase());
      if (!actual || seen.has(actual)) continue;
      seen.add(actual);
      out.push(actual);
      break;
    }
  }
  return out;
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
      `
      SELECT p.id, p.name, p.updated_at, p.updated_by, u.username AS updated_by_username
      FROM projects p
      LEFT JOIN users u ON u.id = p.updated_by
      ORDER BY p.updated_at DESC
      `
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
      `
      SELECT p.id, p.name, p.data, p.updated_at, p.updated_by, u.username AS updated_by_username
      FROM projects p
      LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.id = $1
      `,
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

app.post("/api/projects/:id/cursor", async (req, res) => {
  try {
    const projectId = String(req.params.id || "").trim();
    if (!projectId) {
      res.status(400).json({ error: "Project id required." });
      return;
    }
    const userId = req.user?.id;
    const username = String(req.user?.username || "").trim() || "User";
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const x = Number(req.body?.x);
    const y = Number(req.body?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      res.status(400).json({ error: "x and y must be finite numbers." });
      return;
    }

    cleanupProjectCursors(projectId);
    let byUser = projectCursorPresence.get(projectId);
    if (!byUser) {
      byUser = new Map();
      projectCursorPresence.set(projectId, byUser);
    }
    byUser.set(String(userId), {
      user_id: userId,
      username,
      x,
      y,
      at: Date.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to update cursor." });
  }
});

app.get("/api/projects/:id/cursors", async (req, res) => {
  try {
    const projectId = String(req.params.id || "").trim();
    if (!projectId) {
      res.status(400).json({ error: "Project id required." });
      return;
    }
    const currentUserId = String(req.user?.id || "");
    cleanupProjectCursors(projectId);
    const byUser = projectCursorPresence.get(projectId);
    if (!byUser) {
      res.json({ cursors: [] });
      return;
    }
    const cursors = Array.from(byUser.values())
      .filter((entry) => String(entry.user_id || "") !== currentUserId)
      .map((entry) => ({
        user_id: entry.user_id,
        username: entry.username,
        x: entry.x,
        y: entry.y,
        at: entry.at,
      }));
    res.json({ cursors });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load cursors." });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const incomingId = String(req.body?.id || "").trim();
    const name = String(req.body?.name || "").trim();
    const data = req.body?.data;
    const teamMerge = req.body?.teamMerge !== false;
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
      const { rows: existingRows } = await pool.query(
        "SELECT data FROM projects WHERE id = $1 LIMIT 1",
        [id]
      );
      const mergedData =
        existingRows.length && teamMerge
          ? mergeProjectData(existingRows[0]?.data || {}, data || {})
          : data;
      await pool.query(
        `
        INSERT INTO projects (id, name, data, updated_by)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (id)
        DO UPDATE SET
          name = EXCLUDED.name,
          data = EXCLUDED.data,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        `,
        [id, name, JSON.stringify(mergedData), userId]
      );
      const { rows } = await pool.query(
        `
        SELECT p.id, p.name, p.data, p.updated_at, p.updated_by, u.username AS updated_by_username
        FROM projects p
        LEFT JOIN users u ON u.id = p.updated_by
        WHERE p.id = $1
        `,
        [id]
      );
      res.json({ project: rows[0] });
      return;
    }
    const { rows: existingByName } = await pool.query(
      "SELECT data FROM projects WHERE name = $1 LIMIT 1",
      [name]
    );
    const mergedByName =
      existingByName.length && teamMerge
        ? mergeProjectData(existingByName[0]?.data || {}, data || {})
        : data;
    await pool.query(
      `
      INSERT INTO projects (id, name, data, updated_by)
      VALUES ($1, $2, $3::jsonb, $4)
      ON CONFLICT (name)
      DO UPDATE SET
        data = EXCLUDED.data,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      `,
      [id, name, JSON.stringify(mergedByName), userId]
    );
    const { rows } = await pool.query(
      `
      SELECT p.id, p.name, p.data, p.updated_at, p.updated_by, u.username AS updated_by_username
      FROM projects p
      LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.name = $1
      `,
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

app.get("/api/opc/status", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT status FROM opc_status WHERE id = 1 LIMIT 1"
    );
    if (!rows.length || !rows[0]?.status) {
      res.json({ values: {}, errors: {}, qualities: {}, diagnostics: {}, at: null });
      return;
    }
    res.json(rows[0].status);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load OPC status." });
  }
});

app.get("/api/opc/trends/tags", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        tag_key,
        MAX(to_ts) AS last_at,
        SUM(sample_count)::bigint AS sample_count
      FROM opc_tag_trend_chunks
      GROUP BY tag_key
      ORDER BY tag_key
      `
    );
    res.json({
      tags: rows.map((r) => ({
        tagKey: String(r?.tag_key || ""),
        lastAt: Number(r?.last_at) || null,
        sampleCount: Number(r?.sample_count) || 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load trend tags." });
  }
});

app.get("/api/opc/trends", async (req, res) => {
  try {
    const tagKey = String(req.query.tagKey || req.query.tag || "").trim();
    if (!tagKey) {
      res.status(400).json({ error: "tagKey required." });
      return;
    }
    const now = Date.now();
    const to = normalizeTrendTimestamp(req.query.to ?? now);
    const from = normalizeTrendTimestamp(req.query.from ?? to - 60 * 60 * 1000);
    const rangeFrom = Math.min(from, to);
    const rangeTo = Math.max(from, to);
    const maxPoints = Math.max(50, Math.min(10000, Number(req.query.maxPoints) || 1200));
    if (trendBuffers.has(tagKey)) {
      await flushTrendBuffer(tagKey);
    }
    const { rows } = await pool.query(
      `
      SELECT codec, payload, from_ts, to_ts
      FROM opc_tag_trend_chunks
      WHERE tag_key = $1 AND to_ts >= $2 AND from_ts <= $3
      ORDER BY from_ts ASC
      LIMIT 5000
      `,
      [tagKey, rangeFrom, rangeTo]
    );
    const points = [];
    for (const row of rows) {
      const decoded = decodeTrendChunkPayload(String(row?.codec || ""), row?.payload);
      decoded.forEach((pt) => {
        if (pt.t < rangeFrom || pt.t > rangeTo) return;
        points.push(pt);
      });
    }
    const live = await pool.query("SELECT status FROM opc_status WHERE id = 1 LIMIT 1");
    const liveStatus = live.rows[0]?.status || {};
    const liveAt = normalizeTrendTimestamp(liveStatus?.at || now);
    const liveValue = toFiniteNumber(liveStatus?.values?.[tagKey]);
    if (liveValue != null && liveAt >= rangeFrom && liveAt <= rangeTo) {
      points.push({ t: liveAt, v: liveValue });
    }
    points.sort((a, b) => a.t - b.t);
    const deduped = [];
    let lastT = null;
    for (const pt of points) {
      if (lastT === pt.t && deduped.length) deduped[deduped.length - 1] = pt;
      else {
        deduped.push(pt);
        lastT = pt.t;
      }
    }
    // Preserve the full requested time window by downsampling across the whole
    // range, rather than slicing to the newest maxPoints only.
    const finalPoints = downsampleTrendPoints(deduped, maxPoints);
    res.json({
      tagKey,
      from: rangeFrom,
      to: rangeTo,
      points: finalPoints,
      totalPoints: deduped.length,
      rawTotalPoints: deduped.length,
      returnedPoints: finalPoints.length,
      codec: TREND_CODEC,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load trend data." });
  }
});

function mergeWriteDiagnostics(incomingDiagnostics, existingDiagnostics) {
  const incoming =
    incomingDiagnostics && typeof incomingDiagnostics === "object" ? incomingDiagnostics : {};
  const existing =
    existingDiagnostics && typeof existingDiagnostics === "object" ? existingDiagnostics : {};
  const merged = {};
  Object.entries(incoming).forEach(([key, diag]) => {
    const nextDiag = diag && typeof diag === "object" ? diag : {};
    const prevDiag = existing?.[key] && typeof existing[key] === "object" ? existing[key] : null;
    if (!prevDiag) {
      merged[key] = nextDiag;
      return;
    }
    merged[key] = {
      ...nextDiag,
      writeCount:
        Number.isFinite(Number(nextDiag?.writeCount))
          ? Number(nextDiag.writeCount)
          : Number(prevDiag?.writeCount || 0),
      writeDurationTotalMs:
        Number.isFinite(Number(nextDiag?.writeDurationTotalMs))
          ? Number(nextDiag.writeDurationTotalMs)
          : Number(prevDiag?.writeDurationTotalMs || 0),
      lastWriteDurationMs:
        Number.isFinite(Number(nextDiag?.lastWriteDurationMs))
          ? Number(nextDiag.lastWriteDurationMs)
          : Number(prevDiag?.lastWriteDurationMs || 0),
      avgWriteDurationMs:
        Number.isFinite(Number(nextDiag?.avgWriteDurationMs))
          ? Number(nextDiag.avgWriteDurationMs)
          : Number(prevDiag?.avgWriteDurationMs || 0),
      maxWriteDurationMs:
        Number.isFinite(Number(nextDiag?.maxWriteDurationMs))
          ? Number(nextDiag.maxWriteDurationMs)
          : Number(prevDiag?.maxWriteDurationMs || 0),
      lastWriteAt: nextDiag?.lastWriteAt || prevDiag?.lastWriteAt || null,
    };
  });
  return merged;
}

function mergeRuntimeWriteMetrics(incomingRuntime, existingRuntime) {
  const incoming =
    incomingRuntime && typeof incomingRuntime === "object" ? incomingRuntime : {};
  const existing =
    existingRuntime && typeof existingRuntime === "object" ? existingRuntime : {};
  const incomingWrite = incoming?.writeMetrics;
  const existingWrite = existing?.writeMetrics;
  if (
    incomingWrite &&
    typeof incomingWrite === "object" &&
    Number.isFinite(Number(incomingWrite?.count || 0))
  ) {
    return { ...incoming };
  }
  if (existingWrite && typeof existingWrite === "object") {
    return { ...incoming, writeMetrics: existingWrite };
  }
  return { ...incoming };
}

app.post("/api/opc/status", async (req, res) => {
  try {
    const status = req.body;
    if (!status || typeof status !== "object" || Array.isArray(status)) {
      res.status(400).json({ error: "status object required." });
      return;
    }
    const current = await pool.query("SELECT status FROM opc_status WHERE id = 1 LIMIT 1");
    const existingStatus =
      current.rows[0]?.status && typeof current.rows[0].status === "object"
        ? current.rows[0].status
        : {};
    const mergedStatus = {
      ...status,
      diagnostics: mergeWriteDiagnostics(status?.diagnostics, existingStatus?.diagnostics),
      runtime: mergeRuntimeWriteMetrics(status?.runtime, existingStatus?.runtime),
    };
    await pool.query(
      `
      INSERT INTO opc_status (id, status, updated_at)
      VALUES (1, $1::jsonb, now())
      ON CONFLICT (id)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      `,
      [JSON.stringify(mergedStatus)]
    );
    const at = normalizeTrendTimestamp(mergedStatus?.at);
    const values =
      mergedStatus?.values && typeof mergedStatus.values === "object" ? mergedStatus.values : {};
    const diagnostics =
      mergedStatus?.diagnostics && typeof mergedStatus.diagnostics === "object"
        ? mergedStatus.diagnostics
        : {};
    const trendConfigMap = await loadTrendTagConfigMap();
    Object.entries(values).forEach(([tagKey, rawValue]) => {
      const key = String(tagKey || "").trim();
      const cfg = trendConfigMap instanceof Map ? trendConfigMap.get(key) : null;
      if (trendConfigMap instanceof Map && !cfg) return;
      const n = toFiniteNumber(rawValue);
      if (n == null) return;
      const mode = cfg?.trendMode || "value";
      const diag = diagnostics?.[key] && typeof diagnostics[key] === "object" ? diagnostics[key] : null;
      const effectiveIntervalMs = Math.max(
        1000,
        Number.parseInt(String(diag?.effectiveIntervalMs || ""), 10) || 0
      );
      appendTrendSample(tagKey, at, n, {
        mode,
        forceMs:
          cfg?.trendSampleMs ||
          (mode === "time" ? effectiveIntervalMs || 1000 : OPC_TREND_FORCE_SAMPLE_MS),
      });
    });
    await flushTrendBuffersIfNeeded(at);
    if (at - trendLastCleanupAt >= 5 * 60 * 1000) {
      trendLastCleanupAt = at;
      const cutoff = at - OPC_TREND_RETENTION_MS;
      await pool.query("DELETE FROM opc_tag_trend_chunks WHERE to_ts < $1", [cutoff]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save OPC status." });
  }
});

app.post("/api/opc/write", async (req, res) => {
  try {
    const writeStartedAt = Date.now();
    const tagKey = String(req.body?.tagKey || "").trim();
    const legacyTagKey = String(req.body?.legacyTagKey || "").trim();
    const uaType = String(req.body?.uaType || "").trim().toLowerCase();
    if (!tagKey) {
      res.status(400).json({ error: "tagKey required." });
      return;
    }
    let nextValue = req.body?.value;
    if (typeof nextValue === "string") {
      const raw = nextValue.trim();
      if (uaType === "boolean") {
        const lower = raw.toLowerCase();
        if (lower === "true" || lower === "1" || lower === "on") nextValue = true;
        else if (lower === "false" || lower === "0" || lower === "off") nextValue = false;
        else nextValue = raw;
      } else if (
        uaType === "int16" ||
        uaType === "int32" ||
        uaType === "int64" ||
        uaType === "uint16" ||
        uaType === "uint32" ||
        uaType === "uint64" ||
        uaType === "float" ||
        uaType === "double"
      ) {
        const n = Number(raw);
        nextValue = Number.isFinite(n) ? n : raw;
      } else {
        nextValue = raw;
      }
    }

    const current = await pool.query("SELECT status FROM opc_status WHERE id = 1 LIMIT 1");
    const baseStatus = current.rows[0]?.status && typeof current.rows[0].status === "object"
      ? current.rows[0].status
      : {};
    const at = Date.now();
    const nextStatus = {
      ...baseStatus,
      at,
      values: { ...(baseStatus?.values || {}), [tagKey]: nextValue },
      qualities: { ...(baseStatus?.qualities || {}), [tagKey]: "Good" },
      diagnostics: { ...(baseStatus?.diagnostics || {}) },
      runtime: {
        ...(baseStatus?.runtime && typeof baseStatus.runtime === "object" ? baseStatus.runtime : {}),
      },
    };
    if (legacyTagKey && legacyTagKey !== tagKey) {
      nextStatus.values[legacyTagKey] = nextValue;
      nextStatus.qualities[legacyTagKey] = "Good";
    }
    const writeDurationMs = Math.max(0, Date.now() - writeStartedAt);
    const applyWriteDiag = (key) => {
      const prev =
        nextStatus?.diagnostics?.[key] && typeof nextStatus.diagnostics[key] === "object"
          ? nextStatus.diagnostics[key]
          : {};
      const writeCount = Math.max(0, Number.parseInt(String(prev?.writeCount || 0), 10) || 0) + 1;
      const writeDurationTotalMs =
        Math.max(0, Number.parseInt(String(prev?.writeDurationTotalMs || 0), 10) || 0) +
        writeDurationMs;
      const maxWriteDurationMs = Math.max(
        Math.max(0, Number.parseInt(String(prev?.maxWriteDurationMs || 0), 10) || 0),
        writeDurationMs
      );
      nextStatus.diagnostics[key] = {
        ...prev,
        lastReadAt: at,
        lastSuccessAt: at,
        lastErrorAt: null,
        lastErrorMessage: "",
        errorStreak: 0,
        writeCount,
        writeDurationTotalMs,
        lastWriteAt: at,
        lastWriteDurationMs: writeDurationMs,
        avgWriteDurationMs: Math.round(writeDurationTotalMs / Math.max(1, writeCount)),
        maxWriteDurationMs,
      };
    };
    if (nextStatus?.diagnostics?.[tagKey] && typeof nextStatus.diagnostics[tagKey] === "object") {
      applyWriteDiag(tagKey);
    } else {
      nextStatus.diagnostics[tagKey] = {};
      applyWriteDiag(tagKey);
    }
    if (
      legacyTagKey &&
      legacyTagKey !== tagKey &&
      nextStatus?.diagnostics?.[legacyTagKey] &&
      typeof nextStatus.diagnostics[legacyTagKey] === "object"
    ) {
      applyWriteDiag(legacyTagKey);
    } else if (legacyTagKey && legacyTagKey !== tagKey) {
      nextStatus.diagnostics[legacyTagKey] = {};
      applyWriteDiag(legacyTagKey);
    }

    const prevWriteMetrics =
      nextStatus?.runtime?.writeMetrics && typeof nextStatus.runtime.writeMetrics === "object"
        ? nextStatus.runtime.writeMetrics
        : {};
    const runtimeWriteCount =
      Math.max(0, Number.parseInt(String(prevWriteMetrics?.count || 0), 10) || 0) + 1;
    const runtimeWriteTotalMs =
      Math.max(0, Number.parseInt(String(prevWriteMetrics?.totalMs || 0), 10) || 0) +
      writeDurationMs;
    nextStatus.runtime.writeMetrics = {
      count: runtimeWriteCount,
      totalMs: runtimeWriteTotalMs,
      avgMs: Math.round(runtimeWriteTotalMs / Math.max(1, runtimeWriteCount)),
      maxMs: Math.max(
        Math.max(0, Number.parseInt(String(prevWriteMetrics?.maxMs || 0), 10) || 0),
        writeDurationMs
      ),
      lastMs: writeDurationMs,
      lastAt: at,
    };

    if (nextStatus?.diagnostics?.[tagKey] && typeof nextStatus.diagnostics[tagKey] === "object") {
      nextStatus.diagnostics[tagKey] = {
        ...nextStatus.diagnostics[tagKey],
        lastReadAt: at,
      };
    }
    if (legacyTagKey && legacyTagKey !== tagKey && nextStatus?.diagnostics?.[legacyTagKey]) {
      nextStatus.diagnostics[legacyTagKey] = {
        ...nextStatus.diagnostics[legacyTagKey],
        lastReadAt: at,
      };
    }

    await pool.query(
      `
      INSERT INTO opc_status (id, status, updated_at)
      VALUES (1, $1::jsonb, now())
      ON CONFLICT (id)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      `,
      [JSON.stringify(nextStatus)]
    );

    const n = toFiniteNumber(nextValue);
    if (n != null) {
      const trendConfigMap = await loadTrendTagConfigMap();
      const cfg = trendConfigMap instanceof Map ? trendConfigMap.get(tagKey) : null;
      const mode = cfg?.trendMode || "value";
      appendTrendSample(tagKey, at, n, {
        mode,
        forceMs: cfg?.trendSampleMs || OPC_TREND_FORCE_SAMPLE_MS,
      });
      await flushTrendBuffersIfNeeded(at);
    }

    res.json({ ok: true, at, tagKey, value: nextValue });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to write OPC value." });
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

app.get("/api/db/routines", async (_req, res) => {
  try {
    const q = `
      SELECT
        p.oid::text AS oid,
        n.nspname AS schema_name,
        p.proname AS routine_name,
        p.prokind AS routine_kind,
        p.proretset AS returns_set,
        format_type(p.prorettype, NULL) AS return_type,
        COALESCE(p.proargnames, ARRAY[]::text[]) AS arg_names,
        COALESCE(
          ARRAY(
            SELECT format_type((p.proargtypes::oid[])[i], NULL)
            FROM generate_subscripts(p.proargtypes::oid[], 1) g(i)
            ORDER BY i
          ),
          ARRAY[]::text[]
        ) AS arg_types
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND p.prokind IN ('f', 'p')
      ORDER BY n.nspname, p.proname, p.oid;
    `;
    const { rows } = await pool.query(q);
    const routines = rows.map((r) => {
      const names = Array.isArray(r.arg_names) ? r.arg_names : [];
      const types = Array.isArray(r.arg_types) ? r.arg_types : [];
      const count = Math.max(names.length, types.length);
      const args = Array.from({ length: count }, (_, idx) => ({
        name: String(names[idx] || "").trim() || `arg_${idx + 1}`,
        type: String(types[idx] || "").trim() || "text",
      }));
      return {
        oid: String(r.oid || ""),
        schema: String(r.schema_name || ""),
        name: String(r.routine_name || ""),
        kind: String(r.routine_kind || ""),
        returnsSet: Boolean(r.returns_set),
        returnType: String(r.return_type || ""),
        args,
      };
    });
    res.json({ routines });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to list routines." });
  }
});

app.get("/api/db/schema", async (_req, res) => {
  try {
    const tablesSql = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    const { rows: tables } = await pool.query(tablesSql);
    const schema = {};
    for (const row of tables) {
      const table = row.table_name;
      const { rows: cols } = await pool.query(
        `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
        `,
        [table]
      );
      schema[table] = cols;
    }
    res.json({ schema });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load schema." });
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
    const foreignKeys = await getForeignKeysForTable(table);
    res.json({ columns: rows, primaryKey: pk, foreignKeys });
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
      if (DEBUG_ROUTES && table === "routes") {
        // eslint-disable-next-line no-console
        console.log("[routes api] query", {
          limit,
          offset,
          project_id: projectId || null,
          count: rows.length,
        });
        // eslint-disable-next-line no-console
        console.log("[routes api] sample", rows.slice(0, 5));
      }
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

app.get("/api/reports", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { rows } = await pool.query(
      `
      SELECT id, name, description, sql, created_at, updated_at
      FROM ai_reports
      WHERE user_id = $1
      ORDER BY updated_at DESC
      `,
      [userId]
    );
    res.json({ reports: rows });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load reports." });
  }
});

app.post("/api/reports", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const incomingId = String(req.body?.id || "").trim();
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const sql = sanitizeReadOnlyQuery(String(req.body?.sql || ""));
    if (!name) {
      res.status(400).json({ error: "Report name required." });
      return;
    }
    const id = incomingId || crypto.randomUUID();
    if (incomingId) {
      const { rowCount } = await pool.query(
        `
        UPDATE ai_reports
        SET name = $1, description = $2, sql = $3, updated_at = now()
        WHERE id = $4 AND user_id = $5
        `,
        [name, description || null, sql, id, userId]
      );
      if (!rowCount) {
        res.status(404).json({ error: "Report not found." });
        return;
      }
    } else {
      await pool.query(
        `
        INSERT INTO ai_reports (id, user_id, name, description, sql)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [id, userId, name, description || null, sql]
      );
    }
    const { rows } = await pool.query(
      `
      SELECT id, name, description, sql, created_at, updated_at
      FROM ai_reports
      WHERE id = $1 AND user_id = $2
      LIMIT 1
      `,
      [id, userId]
    );
    res.json({ report: rows[0] || null });
  } catch (err) {
    if (String(err?.message || "").includes("ai_reports_user_name_idx")) {
      res.status(409).json({ error: "Report name already exists." });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed to save report." });
  }
});

app.post("/api/reports/:id/run", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Report id required." });
      return;
    }
    const { rows } = await pool.query(
      "SELECT id, name, description, sql FROM ai_reports WHERE id = $1 AND user_id = $2 LIMIT 1",
      [id, userId]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    const report = rows[0];
    const expectedFilters = extractReportFilterNames(report.sql);
    const expectedPositionalParams = extractPositionalParamCount(report.sql);
    const filterValues =
      req.body?.filters && typeof req.body.filters === "object" && !Array.isArray(req.body.filters)
        ? req.body.filters
        : {};
    const positionalValues =
      Array.isArray(req.body?.positional) ? req.body.positional : [];
    const { sql, values } = buildParameterizedReadOnlyQuery(report.sql, filterValues, positionalValues);
    const result = await pool.query(sql, values);
    const columns = (result.fields || []).map((f) => f.name);
    const dataRows = Array.isArray(result.rows) ? result.rows : [];
    const summedColumns = extractSummedOutputColumns(sql, columns);
    const summaryRow = summedColumns.length
      ? buildSummaryRow(dataRows, columns, summedColumns)
      : null;
    res.json({
      report: {
        id: report.id,
        name: report.name,
        description: report.description || "",
        sql,
        expectedFilters,
        expectedPositionalParams,
      },
      columns,
      rows: dataRows,
      rowCount: dataRows.length,
      summaryRow,
    });
  } catch (err) {
    if (isMissingPublicRoutinesError(err)) {
      res.status(400).json({
        error:
          'Table "public.routines" does not exist. Use /api/db/routines (metadata), Report source mode "Stored Routine", or query pg_catalog.pg_proc instead.',
      });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed to run report." });
  }
});

app.post("/api/reports/preview", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const mode = String(req.body?.mode || "sql").trim().toLowerCase();
    let sqlTemplate = String(req.body?.sql || "").trim();
    if (mode === "table") {
      const table = String(req.body?.table || "").trim();
      if (!/^[a-zA-Z0-9_]+$/.test(table)) {
        res.status(400).json({ error: "Valid table is required." });
        return;
      }
      const selectedColumns = Array.isArray(req.body?.selectedColumns)
        ? req.body.selectedColumns
            .map((c) => String(c || "").trim())
            .filter((c) => /^[a-zA-Z0-9_]+$/.test(c))
        : [];
      const groupByColumns = Array.isArray(req.body?.groupByColumns)
        ? Array.from(
            new Set(
              req.body.groupByColumns
                .map((c) => String(c || "").trim())
                .filter((c) => /^[a-zA-Z0-9_]+$/.test(c))
            )
          )
        : [];
      const limit = Math.min(1000, Math.max(1, Number(req.body?.limit) || 100));
      const selectCols = selectedColumns.length
        ? selectedColumns.map((c) => safeIdent(c)).join(", ")
        : "*";
      const allowedOps = new Set(["=", "!=", ">", ">=", "<", "<=", "like", "ilike"]);
      const rawTableFilters = Array.isArray(req.body?.tableFilters) ? req.body.tableFilters : [];
      const where = [];
      const values = [];
      for (const f of rawTableFilters) {
        const column = String(f?.column || "").trim();
        if (!/^[a-zA-Z0-9_]+$/.test(column)) continue;
        const op = String(f?.operator || "=").trim().toLowerCase();
        if (op === "is_null") {
          where.push(`${safeIdent(column)} IS NULL`);
          continue;
        }
        if (op === "is_not_null") {
          where.push(`${safeIdent(column)} IS NOT NULL`);
          continue;
        }
        if (!allowedOps.has(op)) continue;
        const raw = f?.value;
        if (raw == null || String(raw).trim() === "") continue;
        values.push(raw);
        where.push(`${safeIdent(column)} ${op.toUpperCase()} $${values.length}`);
      }
      let sql = `SELECT ${selectCols} FROM ${safeIdent(table)}`;
      if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
      if (groupByColumns.length) {
        sql += ` GROUP BY ${groupByColumns.map((c) => safeIdent(c)).join(", ")}`;
      }
      values.push(limit);
      sql += ` LIMIT $${values.length}`;
      const result = await pool.query(sql, values);
      const columns = (result.fields || []).map((f) => f.name);
      const rows = Array.isArray(result.rows) ? result.rows : [];
      const summedColumns = extractSummedOutputColumns(sql, columns);
      const summaryRow = summedColumns.length ? buildSummaryRow(rows, columns, summedColumns) : null;
      res.json({
        sql,
        columns,
        rows,
        rowCount: rows.length,
        expectedFilters: [],
        expectedPositionalParams: 0,
        summaryRow,
      });
      return;
    } else if (mode === "routine") {
      const routineOid = String(req.body?.routineOid || "").trim();
      if (!routineOid || !/^\d+$/.test(routineOid)) {
        res.status(400).json({ error: "Routine selection required." });
        return;
      }
      const meta = await pool.query(
        `
        SELECT
          p.oid::text AS oid,
          n.nspname AS schema_name,
          p.proname AS routine_name,
          p.prokind AS routine_kind,
          p.proretset AS returns_set
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.oid = $1::oid
        LIMIT 1
        `,
        [routineOid]
      );
      if (!meta.rows.length) {
        res.status(404).json({ error: "Routine not found." });
        return;
      }
      const routine = meta.rows[0];
      if (String(routine.routine_kind || "") === "p") {
        res.status(400).json({
          error: "Procedures are not supported for preview. Use a set-returning function.",
        });
        return;
      }
      const args = Array.isArray(req.body?.routineArgs) ? req.body.routineArgs : [];
      const placeholders = args.map((_v, i) => `$${i + 1}`).join(", ");
      const fnIdent = safeQualifiedIdent(routine.schema_name, routine.routine_name);
      if (Boolean(routine.returns_set)) {
        sqlTemplate = `SELECT * FROM ${fnIdent}(${placeholders}) LIMIT 100`;
      } else {
        sqlTemplate = `SELECT ${fnIdent}(${placeholders}) AS result LIMIT 1`;
      }
    }
    if (!sqlTemplate) {
      res.status(400).json({ error: "Report SQL required." });
      return;
    }
    const expectedFilters = extractReportFilterNames(sqlTemplate);
    const expectedPositionalParams = extractPositionalParamCount(sqlTemplate);
    const filterValues =
      req.body?.filters && typeof req.body.filters === "object" && !Array.isArray(req.body.filters)
        ? req.body.filters
        : {};
    const positionalValues =
      mode === "routine"
        ? Array.isArray(req.body?.routineArgs)
          ? req.body.routineArgs
          : []
        : Array.isArray(req.body?.positional)
          ? req.body.positional
          : [];
    const { sql, values } = buildParameterizedReadOnlyQuery(sqlTemplate, filterValues, positionalValues);
    const result = await pool.query(sql, values);
    const columns = (result.fields || []).map((f) => f.name);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const summedColumns = extractSummedOutputColumns(sql, columns);
    const summaryRow = summedColumns.length ? buildSummaryRow(rows, columns, summedColumns) : null;
    res.json({
      sql,
      columns,
      rows,
      rowCount: rows.length,
      expectedFilters,
      expectedPositionalParams,
      summaryRow,
    });
  } catch (err) {
    if (isMissingPublicRoutinesError(err)) {
      res.status(400).json({
        error:
          'Table "public.routines" does not exist. Use Report source mode "Stored Routine" for functions/procedures, not table mode.',
      });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed to preview report." });
  }
});

app.delete("/api/reports/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ error: "Report id required." });
      return;
    }
    await pool.query("DELETE FROM ai_reports WHERE id = $1 AND user_id = $2", [id, userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete report." });
  }
});

app.post("/api/ai/table-preview", async (req, res) => {
  try {
    const { prompt, history, reportContext } = req.body || {};
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
      "You are a PostgreSQL expert assistant.",
      "Output ONLY valid JSON with keys: mode, sql, summary, report_name.",
      "mode must be one of: ddl, query, report, answer.",
      "Use mode=ddl for CREATE/ALTER-style schema requests.",
      "Use mode=query when user asks to show/list/find/read records from tables.",
      "Use mode=report when user asks to build a reusable report.",
      "Use mode=answer for non-SQL conversational replies (sql can be empty).",
      "For mode=query and mode=report, generate exactly one safe read-only SELECT (or WITH ... SELECT) statement.",
      "For mode=query, include a LIMIT clause unless user explicitly asks for a different reasonable limit.",
      "For reusable report filters, use placeholders like {{route_id}} and {{state}} instead of hardcoded values.",
      "For mode=report, do not hardcode literal filter values in WHERE/HAVING; convert them to placeholders.",
      "When using SUM(...), always alias each sum output to a clear column name.",
      "When editing an existing report, prefer mode=report and return updated SQL that applies requested filters/grouping/sorting/columns changes.",
      "Do not include code fences or extra text.",
      "Use lower_snake_case for table and column names unless user specifies otherwise.",
    ].join(" ");

    const existingReportSql = String(reportContext?.sql || "").trim();
    const existingReportName = String(reportContext?.name || "").trim();
    const existingReportDescription = String(reportContext?.description || "").trim();
    const hasExistingReportContext = /^(select|with)\b/i.test(existingReportSql);

    const input = [
      { role: "system", content: system },
      ...(schemaContext
        ? [{ role: "system", content: `Current database schema:\n${schemaContext}` }]
        : []),
      ...(hasExistingReportContext
        ? [
            {
              role: "system",
              content: [
                "Existing report context:",
                `name: ${existingReportName || "(unnamed)"}`,
                `description: ${existingReportDescription || "(none)"}`,
                `sql: ${existingReportSql}`,
                "Apply user instructions to this SQL and return the revised query.",
              ].join("\n"),
            },
          ]
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
    if (!json) {
      const strictSystem = [
        "Return ONLY valid JSON. No prose.",
        "Keys: mode, sql, summary, report_name.",
        "mode must be ddl, query, report, or answer.",
        "Do not include markdown or code fences.",
      ].join(" ");
      const retryInput = [
        { role: "system", content: strictSystem },
        { role: "user", content: prompt },
      ];
      text = await getModelText(retryInput);
      json = extractJson(text) || repairJson(text);
    }
    if (!json) {
      res.json({
        mode: "answer",
        sql: "",
        summary: "Model response did not return JSON; showing raw output.",
        answer: text.trim(),
      });
      return;
    }
    const modeRaw = String(json.mode || "").trim().toLowerCase();
    const mode = ["ddl", "query", "report", "answer"].includes(modeRaw) ? modeRaw : "answer";
    let sqlText = String(json.sql || "").trim();
    const summaryText = String(json.summary || "").trim();
    const reportName = String(json.report_name || "").trim();

    if (mode === "report") {
      sqlText = autoParameterizeReportSql(sqlText);
    }

    if (mode === "query" || mode === "report") {
      if (!sqlText) {
        res.status(400).json({ error: "Query mode returned no SQL." });
        return;
      }
      const expectedFilters = extractReportFilterNames(sqlText);
      const previewFilterValues = Object.fromEntries(expectedFilters.map((name) => [name, null]));
      const { sql: safeQuery, values: safeValues } = buildParameterizedReadOnlyQuery(
        sqlText,
        previewFilterValues
      );
      let result = await pool.query(safeQuery, safeValues);
      let columns = (result.fields || []).map((f) => f.name);
      let rows = Array.isArray(result.rows) ? result.rows : [];
      let usedFallback = false;

      // If AI over-filters and returns 0 rows, try a safe unfiltered table preview.
      if (rows.length === 0 && /\bwhere\b/i.test(safeQuery)) {
        const table = extractSimpleFromTable(safeQuery);
        if (table) {
          const fallbackSql = `SELECT * FROM ${safeIdent(table)} LIMIT 100`;
          const fallback = await pool.query(fallbackSql);
          const fallbackRows = Array.isArray(fallback.rows) ? fallback.rows : [];
          if (fallbackRows.length > 0) {
            result = fallback;
            columns = (fallback.fields || []).map((f) => f.name);
            rows = fallbackRows;
            usedFallback = true;
          }
        }
      }
      res.json({
        mode,
        sql: mode === "report" ? sqlText : safeQuery,
        summary:
          summaryText ||
          (usedFallback
            ? `No rows matched the filter. Showing ${rows.length} row(s) from the table.`
            : `Returned ${rows.length} row(s).`),
        columns,
        rows,
        rowCount: rows.length,
        usedFallback,
        reportName: reportName || existingReportName || "",
        expectedFilters,
        summaryRow: (() => {
          const summedColumns = extractSummedOutputColumns(safeQuery, columns);
          if (!summedColumns.length) return null;
          return buildSummaryRow(rows, columns, summedColumns);
        })(),
      });
      return;
    }

    if (mode === "ddl") {
      if (!sqlText) {
        res.status(400).json({ error: "DDL mode returned no SQL." });
        return;
      }
      res.json({
        mode,
        sql: sqlText,
        summary: summaryText,
      });
      return;
    }

    res.json({
      mode: "answer",
      sql: "",
      summary: summaryText || text.trim(),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error." });
  }
});

app.post("/api/ai/apply", async (req, res) => {
  try {
    const { sql } = req.body || {};
    const statements = validateSql(sql);
    const createdTables = extractCreatedTableNames(statements);

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      for (const stmt of statements) {
        await db.query(stmt);
      }
      for (const table of createdTables) {
        await ensureStandardTableColumns(db, table);
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
    CREATE TABLE IF NOT EXISTS opc_status (
      id INT PRIMARY KEY,
      status JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE opc_status
    ADD COLUMN IF NOT EXISTS status JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);
  await pool.query(`
    ALTER TABLE opc_status
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS opc_tag_trend_chunks (
      id BIGSERIAL PRIMARY KEY,
      tag_key TEXT NOT NULL,
      from_ts BIGINT NOT NULL,
      to_ts BIGINT NOT NULL,
      sample_count INT NOT NULL DEFAULT 0,
      codec TEXT NOT NULL DEFAULT 'json-gzip-v1',
      payload BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS opc_tag_trend_chunks_tag_to_idx
    ON opc_tag_trend_chunks(tag_key, to_ts DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS opc_tag_trend_chunks_to_idx
    ON opc_tag_trend_chunks(to_ts DESC);
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
    ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS updated_by INT;
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'projects_updated_by_fkey'
      ) THEN
        ALTER TABLE projects
        ADD CONSTRAINT projects_updated_by_fkey
        FOREIGN KEY (updated_by) REFERENCES users(id)
        ON DELETE SET NULL;
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS projects_name_idx ON projects(name);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS equipment (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      floor TEXT NOT NULL DEFAULT '',
      "groupNumber" INTEGER,
      visible BOOLEAN NOT NULL DEFAULT true,
      "new" BOOLEAN NOT NULL DEFAULT false,
      notes TEXT NOT NULL DEFAULT '',
      tag_path TEXT
    );
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS floor TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS "groupNumber" INTEGER;
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS visible BOOLEAN NOT NULL DEFAULT true;
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS "new" BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE equipment
    ADD COLUMN IF NOT EXISTS tag_path TEXT;
  `);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'equipment',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["name", "type", "floor", "groupNumber", "visible", "new", "tag_path"]),
      JSON.stringify(["name", "description", "type", "floor", "groupNumber", "visible", "new", "notes", "tag_path"]),
    ]
  );
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_reports (
      id TEXT PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      sql TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_reports_user_name_idx ON ai_reports(user_id, name);
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
  await verifySchemaCoverage();
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
