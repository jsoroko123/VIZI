import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import process from "process";
import OpenAI from "openai";
import pkg from "pg";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const { Pool } = pkg;

const PORT = Number(process.env.PORT || 5055);
const DEBUG_ROUTES = process.env.DEBUG_ROUTES === "1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "64mb";
const AI_SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_ROOT = path.resolve(AI_SERVER_DIR, "..");

function pickFirstExisting(candidates = []) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

const ROOT_HINT = process.env.MESORA_ROOT
  ? path.resolve(process.env.MESORA_ROOT)
  : process.env.VIZI_ROOT
    ? path.resolve(process.env.VIZI_ROOT)
    : "";
const ROOT_CANDIDATES = [ROOT_HINT, DEFAULT_APP_ROOT, path.resolve(DEFAULT_APP_ROOT, "..")].filter(Boolean);
const REPO_ROOT = pickFirstExisting(
  ROOT_CANDIDATES.map((root) => path.resolve(root, "src", "assets", "SVG_Files"))
)
  ? ROOT_CANDIDATES.find((root) =>
      fs.existsSync(path.resolve(root, "src", "assets", "SVG_Files"))
    ) || DEFAULT_APP_ROOT
  : DEFAULT_APP_ROOT;

const OPC_CONFIG_PATH = pickFirstExisting(
  ROOT_CANDIDATES.map((root) => path.resolve(root, "opc-server", "config.json"))
) || path.resolve(REPO_ROOT, "opc-server", "config.json");
const DESIGNER_SCHEMA_PATH = path.resolve(AI_SERVER_DIR, "designer-schema.json");
const SVG_LIBRARY_DIR = path.resolve(REPO_ROOT, "src", "assets", "SVG_Files");
const SVG_LIBRARY_DIR_STREAMLINED = path.resolve(
  REPO_ROOT,
  "src",
  "assets",
  "SVG_Files_Streamlined"
);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large") {
    res
      .status(413)
      .json({ error: `Request payload too large. Increase JSON_BODY_LIMIT (current ${JSON_BODY_LIMIT}).` });
    return;
  }
  next(err);
});

const DATABASE_URL = process.env.DATABASE_URL || "";

function quoteIdent(name) {
  const safe = /^[a-zA-Z0-9_]+$/.test(name);
  if (!safe) {
    throw new Error("Database name must be alphanumeric/underscore.");
  }
  return `"${name.replace(/"/g, "\"\"")}"`;
}

function normalizeSvgCatalogKey(relativePath) {
  const rel = String(relativePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return `./assets/SVG_Files/${rel}`;
}

function resolveSvgKeyToAbsolutePath(key) {
  const raw = String(key || "").trim();
  if (!raw.startsWith("./assets/SVG_Files/")) {
    throw new Error("Invalid SVG key.");
  }
  const relative = raw.slice("./assets/SVG_Files/".length).replace(/\\/g, "/");
  if (!relative || relative.includes("..")) {
    throw new Error("Invalid SVG key path.");
  }
  if (!relative.toLowerCase().endsWith(".svg")) {
    throw new Error("SVG key must end with .svg.");
  }
  const absolutePrimary = path.resolve(SVG_LIBRARY_DIR, relative);
  const primaryRoot = `${SVG_LIBRARY_DIR}${path.sep}`;
  if (!(absolutePrimary === SVG_LIBRARY_DIR || absolutePrimary.startsWith(primaryRoot))) {
    throw new Error("SVG key resolved outside library root.");
  }
  if (fs.existsSync(absolutePrimary)) return absolutePrimary;

  const absoluteStreamlined = path.resolve(SVG_LIBRARY_DIR_STREAMLINED, relative);
  const streamlinedRoot = `${SVG_LIBRARY_DIR_STREAMLINED}${path.sep}`;
  if (
    absoluteStreamlined === SVG_LIBRARY_DIR_STREAMLINED ||
    absoluteStreamlined.startsWith(streamlinedRoot)
  ) {
    if (fs.existsSync(absoluteStreamlined)) return absoluteStreamlined;
  }

  throw new Error("SVG file not found.");
}

function parseDatabaseConnectionInfo(connectionString) {
  const raw = String(connectionString || "").trim();
  if (!raw) {
    return {
      configured: false,
      protocol: "",
      host: "",
      port: null,
      database: "",
      user: "",
      ssl: false,
      sslMode: "",
      applicationName: "",
    };
  }
  try {
    const url = new URL(raw);
    const sslMode = String(url.searchParams.get("sslmode") || "").trim();
    const sslParam = String(url.searchParams.get("ssl") || "").trim().toLowerCase();
    const ssl =
      sslMode === "require" ||
      sslMode === "verify-ca" ||
      sslMode === "verify-full" ||
      sslParam === "1" ||
      sslParam === "true";
    return {
      configured: true,
      protocol: String(url.protocol || "").replace(/:$/, ""),
      host: String(url.hostname || "").trim(),
      port: Number.isFinite(Number(url.port)) ? Number(url.port) : 5432,
      database: String(url.pathname || "").replace(/^\//, "").trim(),
      user: decodeURIComponent(String(url.username || "").trim()),
      ssl,
      sslMode,
      applicationName: String(url.searchParams.get("application_name") || "").trim(),
    };
  } catch {
    return {
      configured: true,
      protocol: "",
      host: "",
      port: null,
      database: "",
      user: "",
      ssl: false,
      sslMode: "",
      applicationName: "",
    };
  }
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
const SECURITY_AREA_KEYS = [
  "project",
  "plc",
  "opc",
  "server",
  "tags",
  "database",
  "reports",
  "ai",
  "security",
  "help",
];
const SECURITY_AREA_SET = new Set(SECURITY_AREA_KEYS);
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
const DEFAULT_OPC_CONFIG = {
  plcs: [],
  opcua: { port: 4840, resourcePath: "/UA/ControlLogix", name: "ControlLogix" },
  pollMs: 500,
  topics: [],
  tags: [],
};
const PLC_DEBUG_SESSION_TTL_MS = Math.max(
  5 * 60 * 1000,
  Number.parseInt(process.env.PLC_DEBUG_SESSION_TTL_MS || `${30 * 60 * 1000}`, 10) || 30 * 60 * 1000
);
const PLC_DEBUG_SESSION_POLL_MS = Math.max(
  1000,
  Number.parseInt(process.env.PLC_DEBUG_SESSION_POLL_MS || "3000", 10) || 3000
);
const PLC_DEBUG_MAX_WATCH_TAGS = 120;
const PLC_DEBUG_MAX_SNAPSHOT_TAGS = 80;
const plcDebugSessions = new Map();
let plcDebugRefreshBusy = false;

function normalizeDebugToken(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDebugTagList(list, limit = PLC_DEBUG_MAX_WATCH_TAGS) {
  const rows = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const token = normalizeDebugToken(row);
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

function formatDebugValue(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  const text = String(value);
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

function buildPlcDebugSnapshot(status, session) {
  const safeStatus = status && typeof status === "object" ? status : {};
  const values = safeStatus.values && typeof safeStatus.values === "object" ? safeStatus.values : {};
  const errors = safeStatus.errors && typeof safeStatus.errors === "object" ? safeStatus.errors : {};
  const qualities = safeStatus.qualities && typeof safeStatus.qualities === "object" ? safeStatus.qualities : {};
  const diagnostics =
    safeStatus.diagnostics && typeof safeStatus.diagnostics === "object" ? safeStatus.diagnostics : {};
  const connections =
    safeStatus.connections && typeof safeStatus.connections === "object" ? safeStatus.connections : {};
  const watchTokens = normalizeDebugTagList(session?.watchTags || [], PLC_DEBUG_MAX_WATCH_TAGS);
  const routineTokens = normalizeDebugTagList(session?.routineHints || [], 24);
  const controllerTagTokens = normalizeDebugTagList(session?.controllerTags || [], 240);

  const matchesToken = (text, token) => String(text || "").toLowerCase().includes(token);
  const isWatched = (row) => {
    if (!watchTokens.length) return false;
    return watchTokens.some((token) =>
      [row.key, row.name, row.tagPath].some((value) => matchesToken(value, token))
    );
  };

  const matchesRoutine = (row) => {
    if (!routineTokens.length) return false;
    return routineTokens.some((token) =>
      [row.key, row.name, row.tagPath].some((value) => matchesToken(value, token))
    );
  };

  const matchesController = (row) => {
    if (!controllerTagTokens.length) return false;
    return controllerTagTokens.some((token) =>
      [row.key, row.name, row.tagPath].some((value) => matchesToken(value, token))
    );
  };

  const rows = Object.keys(diagnostics).map((key) => {
    const diag = diagnostics[key] && typeof diagnostics[key] === "object" ? diagnostics[key] : {};
    const readErrorCount = Number(diag?.readErrorCount || 0) || 0;
    const errorStreak = Number(diag?.errorStreak || 0) || 0;
    return {
      key: String(key || ""),
      name: String(diag?.name || ""),
      tagPath: String(diag?.tagPath || ""),
      topic: String(diag?.topic || ""),
      plcName: String(diag?.plcName || ""),
      value: formatDebugValue(values[key]),
      quality: String(qualities[key] || ""),
      errorCount: Number(errors[key] || 0) || 0,
      readErrorCount,
      errorStreak,
      readCount: Number(diag?.readCount || 0) || 0,
      avgReadDurationMs: Number(diag?.avgReadDurationMs || 0) || 0,
      maxReadDurationMs: Number(diag?.maxReadDurationMs || 0) || 0,
      lastReadAt: Number(diag?.lastReadAt || 0) || null,
      lastErrorAt: Number(diag?.lastErrorAt || 0) || null,
      lastErrorMessage: String(diag?.lastErrorMessage || ""),
    };
  });

  const filtered = rows.filter((row) => {
    if (!session?.plcName) return true;
    const plcName = String(session.plcName || "").toLowerCase();
    if (!plcName) return true;
    return String(row.plcName || "").toLowerCase() === plcName;
  });

  const scored = filtered
    .map((row) => {
      const watched = isWatched(row);
      const routine = matchesRoutine(row);
      const controller = matchesController(row);
      const hasErrors = row.errorCount > 0 || row.readErrorCount > 0 || row.errorStreak > 0 || !!row.lastErrorAt;
      const score =
        (watched ? 2000 : 0) +
        (routine ? 1000 : 0) +
        (controller ? 300 : 0) +
        (hasErrors ? 500 : 0) +
        Math.min(400, row.maxReadDurationMs || 0) +
        Math.min(200, row.errorStreak * 20);
      return { ...row, score, watched };
    })
    .sort((a, b) => b.score - a.score || (b.lastReadAt || 0) - (a.lastReadAt || 0));

  const topRows = scored.slice(0, PLC_DEBUG_MAX_SNAPSHOT_TAGS).map((row) => ({
    key: row.key,
    name: row.name,
    tagPath: row.tagPath,
    topic: row.topic,
    plcName: row.plcName,
    value: row.value,
    quality: row.quality,
    errorCount: row.errorCount,
    readErrorCount: row.readErrorCount,
    errorStreak: row.errorStreak,
    readCount: row.readCount,
    avgReadDurationMs: row.avgReadDurationMs,
    maxReadDurationMs: row.maxReadDurationMs,
    lastReadAt: row.lastReadAt,
    lastErrorAt: row.lastErrorAt,
    lastErrorMessage: row.lastErrorMessage,
    watched: row.watched === true,
  }));

  const activeConnections = Object.entries(connections)
    .filter(([, connected]) => connected === true)
    .map(([name]) => String(name || "").trim())
    .filter(Boolean);

  const errorTags = topRows
    .filter((row) => row.errorCount > 0 || row.readErrorCount > 0 || row.errorStreak > 0 || !!row.lastErrorAt)
    .slice(0, 12);
  const slowTags = [...topRows]
    .sort((a, b) => (b.maxReadDurationMs || 0) - (a.maxReadDurationMs || 0))
    .slice(0, 12);

  return {
    at: Number(safeStatus.at || Date.now()),
    connected: safeStatus.connected === true,
    plcName: String(session?.plcName || ""),
    activeConnections,
    activeConnectionCount: activeConnections.length,
    watchTagCount: watchTokens.length,
    matchedTagCount: topRows.length,
    tags: topRows,
    hotspots: {
      errors: errorTags,
      slowReads: slowTags,
    },
  };
}

async function loadOpcStatusFromStore() {
  const { rows } = await pool.query("SELECT status FROM opc_status WHERE id = 1 LIMIT 1");
  if (!rows.length || !rows[0]?.status || typeof rows[0].status !== "object") {
    return { at: Date.now(), connected: false, connections: {}, values: {}, errors: {}, qualities: {}, diagnostics: {} };
  }
  return rows[0].status;
}

async function refreshPlcDebugSession(session) {
  if (!session || typeof session !== "object") return null;
  const now = Date.now();
  try {
    const status = await loadOpcStatusFromStore();
    const snapshot = buildPlcDebugSnapshot(status, session);
    session.snapshot = snapshot;
    session.updatedAt = now;
    session.lastError = "";
    return snapshot;
  } catch (err) {
    session.updatedAt = now;
    session.lastError = String(err?.message || "Failed to refresh PLC debug session.");
    return session.snapshot || null;
  }
}

function serializePlcDebugSession(session) {
  if (!session || typeof session !== "object") return null;
  return {
    id: String(session.id || ""),
    plcName: String(session.plcName || ""),
    watchTags: Array.isArray(session.watchTags) ? session.watchTags : [],
    routineHints: Array.isArray(session.routineHints) ? session.routineHints : [],
    pollMs: Number(session.pollMs || PLC_DEBUG_SESSION_POLL_MS),
    createdAt: Number(session.createdAt || 0) || Date.now(),
    updatedAt: Number(session.updatedAt || 0) || Date.now(),
    lastTouchedAt: Number(session.lastTouchedAt || 0) || Date.now(),
    lastError: String(session.lastError || ""),
    snapshot: session.snapshot || null,
  };
}

function getPlcDebugSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const session = plcDebugSessions.get(id);
  if (!session) return null;
  session.lastTouchedAt = Date.now();
  return session;
}

async function runPlcDebugSessionRefreshTick() {
  if (plcDebugRefreshBusy) return;
  plcDebugRefreshBusy = true;
  try {
    const now = Date.now();
    for (const [id, session] of plcDebugSessions.entries()) {
      if (!session || typeof session !== "object") {
        plcDebugSessions.delete(id);
        continue;
      }
      const lastTouchedAt = Number(session.lastTouchedAt || 0);
      if (now - lastTouchedAt > PLC_DEBUG_SESSION_TTL_MS) {
        plcDebugSessions.delete(id);
        continue;
      }
      const pollMs = Math.max(1000, Number(session.pollMs || PLC_DEBUG_SESSION_POLL_MS));
      if (now - Number(session.lastRefreshAt || 0) < pollMs) continue;
      session.lastRefreshAt = now;
      await refreshPlcDebugSession(session);
    }
  } finally {
    plcDebugRefreshBusy = false;
  }
}

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

function normalizeAlarmOperator(value) {
  const op = String(value || "").trim();
  return ["==", "!=", ">", ">=", "<", "<="].includes(op) ? op : "==";
}

function isTruthyAlarmFlag(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text === "true" || text === "1" || text === "yes" || text === "on";
}

function normalizeAlarmComparable(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { raw, lower: "", num: null, bool: null };
  const lower = raw.toLowerCase();
  const n = Number(raw);
  const bool =
    lower === "true" || lower === "1"
      ? true
      : lower === "false" || lower === "0"
      ? false
      : null;
  return { raw, lower, num: Number.isFinite(n) ? n : null, bool };
}

function evaluateAlarmCondition(liveValue, operator, threshold) {
  const left = normalizeAlarmComparable(liveValue);
  const right = normalizeAlarmComparable(threshold);
  const op = normalizeAlarmOperator(operator);
  if (!left.raw || !right.raw) return false;
  if (op === ">" || op === ">=" || op === "<" || op === "<=") {
    if (left.num == null || right.num == null) return false;
    if (op === ">") return left.num > right.num;
    if (op === ">=") return left.num >= right.num;
    if (op === "<") return left.num < right.num;
    return left.num <= right.num;
  }
  if (left.num != null && right.num != null) return op === "==" ? left.num === right.num : left.num !== right.num;
  if (left.bool != null && right.bool != null) return op === "==" ? left.bool === right.bool : left.bool !== right.bool;
  return op === "==" ? left.lower === right.lower : left.lower !== right.lower;
}

function buildOpcAlarmCandidates(tag) {
  const topic = String(tag?.topic || "").trim();
  const group = String(tag?.groupName || "").trim();
  const tagPath = String(tag?.tagPath || "").trim();
  const name = String(tag?.name || tagPath || "").trim();
  return [
    topic && group && tagPath ? `${topic}.${group}.${tagPath}` : "",
    topic && group && name ? `${topic}.${group}.${name}` : "",
    topic && tagPath ? `${topic}.${tagPath}` : "",
    topic && name ? `${topic}.${name}` : "",
    group && tagPath ? `${group}.${tagPath}` : "",
    group && name ? `${group}.${name}` : "",
    tagPath,
    name,
  ]
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function findAlarmLiveValue(statusValues, tag) {
  const values = statusValues && typeof statusValues === "object" ? statusValues : {};
  const candidates = buildOpcAlarmCandidates(tag);
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
    const lower = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(values, lower)) return values[lower];
  }
  return "";
}

function buildOpcAlarmKey(tag, idx) {
  const topic = String(tag?.topic || "").trim();
  const group = String(tag?.groupName || "").trim();
  const tagPath = String(tag?.tagPath || "").trim();
  const name = String(tag?.name || tagPath || "").trim() || `tag-${idx + 1}`;
  const op = normalizeAlarmOperator(tag?.alarmOperator);
  const threshold = String(tag?.alarmValue || "").trim();
  return `${topic}|${group}|${name}|${tagPath}|${op}|${threshold}`.toLowerCase();
}

async function refreshActiveOpcAlarms(statusObj = {}) {
  let cfg = null;
  try {
    const { rows } = await pool.query("SELECT config FROM opc_config WHERE id = 1 LIMIT 1");
    if (rows.length && rows[0]?.config && typeof rows[0].config === "object") cfg = rows[0].config;
  } catch {
    cfg = null;
  }
  if (!cfg && fs.existsSync(OPC_CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(OPC_CONFIG_PATH, "utf8");
      cfg = JSON.parse(raw || "{}");
    } catch {
      cfg = null;
    }
  }
  const tags = Array.isArray(cfg?.tags) ? cfg.tags : [];
  const values = statusObj?.values && typeof statusObj.values === "object" ? statusObj.values : {};
  const at = normalizeTrendTimestamp(statusObj?.at);
  const active = [];
  tags.forEach((tag, idx) => {
    if (!isTruthyAlarmFlag(tag?.alarmEnabled)) return;
    const threshold = String(tag?.alarmValue || "").trim();
    if (!threshold) return;
    const operator = normalizeAlarmOperator(tag?.alarmOperator);
    const liveValue = findAlarmLiveValue(values, tag);
    if (!evaluateAlarmCondition(liveValue, operator, threshold)) return;
    const topic = String(tag?.topic || "").trim();
    const groupName = String(tag?.groupName || "").trim();
    const tagPath = String(tag?.tagPath || "").trim();
    const label = String(tag?.name || tagPath || `Tag ${idx + 1}`).trim();
    active.push({
      alarmKey: buildOpcAlarmKey(tag, idx),
      topic,
      groupName,
      tagPath,
      label,
      operator,
      threshold,
      lastValue: liveValue == null || liveValue === "" ? "-" : String(liveValue),
      detectedAt: at,
    });
  });

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const activeKeys = active.map((row) => row.alarmKey);
    const currentActive = await db.query(
      "SELECT alarm_key FROM opc_alarm_state WHERE is_active = true"
    );
    const currentSet = new Set(
      currentActive.rows.map((r) => String(r?.alarm_key || "").trim()).filter(Boolean)
    );
    for (const row of active) {
      await db.query(
        `
        INSERT INTO opc_alarm_state (
          alarm_key, topic, group_name, tag_path, label, operator, threshold, last_value,
          is_active, first_triggered_at, last_seen_at, updated_at, occurrence_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,to_timestamp($9 / 1000.0),to_timestamp($9 / 1000.0),now(),1)
        ON CONFLICT (alarm_key)
        DO UPDATE SET
          topic = EXCLUDED.topic,
          group_name = EXCLUDED.group_name,
          tag_path = EXCLUDED.tag_path,
          label = EXCLUDED.label,
          operator = EXCLUDED.operator,
          threshold = EXCLUDED.threshold,
          last_value = EXCLUDED.last_value,
          is_active = true,
          last_seen_at = EXCLUDED.last_seen_at,
          updated_at = now(),
          cleared_at = NULL,
          is_acknowledged = CASE
            WHEN opc_alarm_state.is_active = true THEN opc_alarm_state.is_acknowledged
            ELSE false
          END,
          acknowledged_at = CASE
            WHEN opc_alarm_state.is_active = true THEN opc_alarm_state.acknowledged_at
            ELSE NULL
          END,
          acknowledged_by = CASE
            WHEN opc_alarm_state.is_active = true THEN opc_alarm_state.acknowledged_by
            ELSE ''
          END,
          shelved_until = CASE
            WHEN opc_alarm_state.is_active = true THEN opc_alarm_state.shelved_until
            ELSE NULL
          END,
          shelved_reason = CASE
            WHEN opc_alarm_state.is_active = true THEN opc_alarm_state.shelved_reason
            ELSE ''
          END,
          occurrence_count = CASE
            WHEN opc_alarm_state.is_active = true THEN opc_alarm_state.occurrence_count
            ELSE opc_alarm_state.occurrence_count + 1
          END,
          first_triggered_at = CASE
            WHEN opc_alarm_state.is_active = true THEN opc_alarm_state.first_triggered_at
            ELSE EXCLUDED.first_triggered_at
          END
        `,
        [
          row.alarmKey,
          row.topic,
          row.groupName,
          row.tagPath,
          row.label,
          row.operator,
          row.threshold,
          row.lastValue,
          row.detectedAt,
        ]
      );
    }
    for (const key of currentSet) {
      if (activeKeys.includes(key)) continue;
      await db.query(
        `
        UPDATE opc_alarm_state
        SET
          is_active = false,
          cleared_at = now(),
          updated_at = now(),
          is_acknowledged = false,
          acknowledged_at = NULL,
          acknowledged_by = '',
          shelved_until = NULL,
          shelved_reason = ''
        WHERE alarm_key = $1
        `,
        [key]
      );
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

function normalizeOpcName(value, fallback = "") {
  const text = String(value || "")
    .trim()
    .replace(/[^\w.\-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function mapUaTypeFromPlcType(value) {
  const plcType = String(value || "").trim().toUpperCase();
  if (!plcType) return "Float";
  if (plcType === "BOOL") return "Boolean";
  if (plcType === "REAL") return "Float";
  if (plcType === "LREAL") return "Double";
  if (["SINT", "INT", "DINT", "USINT", "UINT", "UDINT", "LINT", "ULINT"].includes(plcType))
    return "Int32";
  return "String";
}

function isPrimitivePlcType(value) {
  const plcType = String(value || "").trim().toUpperCase();
  if (!plcType) return false;
  return [
    "BOOL",
    "REAL",
    "LREAL",
    "SINT",
    "INT",
    "DINT",
    "USINT",
    "UINT",
    "UDINT",
    "LINT",
    "ULINT",
    "STRING",
  ].includes(plcType);
}

let opcTemplateNameCache = { loadedAt: 0, names: [] };

async function loadOpcTemplateNamesFromStore() {
  const now = Date.now();
  if (Array.isArray(opcTemplateNameCache.names) && now - Number(opcTemplateNameCache.loadedAt || 0) < 10000) {
    return opcTemplateNameCache.names;
  }
  try {
    const { rows } = await pool.query("SELECT name FROM opc_tag_templates ORDER BY name");
    const names = rows
      .map((row) => String(row?.name || "").trim())
      .filter(Boolean);
    opcTemplateNameCache = { loadedAt: now, names };
    return names;
  } catch {
    opcTemplateNameCache = { loadedAt: now, names: [] };
    return [];
  }
}

function resolveTemplateNameForDataType(dataType, templateNames) {
  const raw = String(dataType || "").trim();
  if (!raw) return "";
  const rawLower = raw.toLowerCase();
  const rawUpper = raw.toUpperCase();
  const stripArray = raw.replace(/\[[^\]]*\]\s*$/, "").trim();
  const stripPath = stripArray.split(/[.:/\\]/).filter(Boolean);
  const pathTail = stripPath.length ? stripPath[stripPath.length - 1] : stripArray;
  const primaryNorm = normalizeOpcName(pathTail || stripArray || raw, "").toLowerCase();
  const candidates = new Set();
  if (rawLower) candidates.add(rawLower);
  if (primaryNorm) candidates.add(primaryNorm);
  if (stripArray) candidates.add(String(stripArray).toLowerCase());
  if (pathTail) candidates.add(String(pathTail).toLowerCase());

  // Common PLC/UA type aliases -> template names often used in OPC config.
  if (["BOOL", "BOOLEAN", "BIT"].includes(rawUpper)) {
    ["bool", "boolean", "bit"].forEach((v) => candidates.add(v));
  } else if (["REAL", "FLOAT", "SINGLE"].includes(rawUpper)) {
    ["real", "float", "single", "float32"].forEach((v) => candidates.add(v));
  } else if (["LREAL", "DOUBLE", "FLOAT64"].includes(rawUpper)) {
    ["lreal", "double", "float64"].forEach((v) => candidates.add(v));
  } else if (
    ["SINT", "INT", "DINT", "USINT", "UINT", "UDINT", "LINT", "ULINT", "INT16", "INT32", "INT64"].includes(rawUpper)
  ) {
    ["int", "int16", "int32", "int64", "integer", "number"].forEach((v) => candidates.add(v));
  } else if (["STRING", "WSTRING"].includes(rawUpper)) {
    ["string", "text"].forEach((v) => candidates.add(v));
  }

  const list = Array.isArray(templateNames) ? templateNames : [];

  // Pass 1: exact normalized/alias match.
  for (const name of list) {
    const text = String(name || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    const norm = normalizeOpcName(text, "").toLowerCase();
    if (candidates.has(lower) || (norm && candidates.has(norm))) {
      return text;
    }
  }

  // Pass 2: contains match (useful for names like "Motor Template").
  for (const name of list) {
    const text = String(name || "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    const norm = normalizeOpcName(text, "").toLowerCase();
    for (const candidate of candidates) {
      if (!candidate || candidate.length < 3) continue;
      if (lower.includes(candidate) || candidate.includes(lower) || (norm && (norm.includes(candidate) || candidate.includes(norm)))) {
        return text;
      }
    }
  }

  // Pass 3: direct raw fallback.
  for (const name of list) {
    const text = String(name || "").trim();
    if (!text) continue;
    if (text.toLowerCase() === rawLower) {
      return text;
    }
  }
  return "";
}

function parsePromptHost(promptText) {
  const text = String(promptText || "");
  const ipv4 = text.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
  if (ipv4 && ipv4[1]) return ipv4[1];
  const hostLike = text.match(/\b([a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}|[a-zA-Z0-9][a-zA-Z0-9.-]*local)\b/);
  return hostLike && hostLike[1] ? hostLike[1] : "";
}

function parsePromptSlot(promptText) {
  const text = String(promptText || "");
  const match = text.match(/\bslot\s*(?:=|:)?\s*(\d{1,2})\b/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function parsePromptTopic(promptText) {
  const text = String(promptText || "");
  const match = text.match(/\btopic\s*(?:=|:)?\s*([a-zA-Z0-9_.-]+)\b/i);
  if (!match || !match[1]) return "";
  return normalizeOpcName(match[1], "");
}

function normalizeControllerTags(rawTags, limit = 300) {
  const out = [];
  const seen = new Set();
  const rows = Array.isArray(rawTags) ? rawTags : [];
  for (const row of rows) {
    const name = normalizeOpcName(row?.name || row?.tagPath || "");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const plcType = String(row?.plcType || row?.dataType || "").trim().toUpperCase();
    const dataType = String(row?.dataType || "").trim();
    const uaType = String(row?.uaType || "").trim() || mapUaTypeFromPlcType(plcType);
    out.push({
      name,
      tagPath: normalizeOpcName(row?.tagPath || name, name),
      plcType: plcType || undefined,
      dataType: dataType || undefined,
      uaType,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeSvgCatalog(rawCatalog, limit = 450) {
  const rows = Array.isArray(rawCatalog) ? rawCatalog : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const key = String(row?.key || "").trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const fallbackName = key.split("/").pop() || key;
    const name = String(row?.name || fallbackName).trim() || fallbackName;
    const tags = Array.isArray(row?.tags)
      ? row.tags.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 16)
      : [];
    out.push({ key, name, tags });
    if (out.length >= limit) break;
  }
  return out;
}

function tokenizeSvgText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_/.-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x && x.length > 1);
}

function scoreSvgCandidate(promptTokens, candidate, selectedTagNames = []) {
  const tokenSet = new Set(promptTokens);
  for (const tagName of selectedTagNames) {
    for (const token of tokenizeSvgText(tagName)) tokenSet.add(token);
  }
  const candidateTokens = new Set([
    ...tokenizeSvgText(candidate?.key || ""),
    ...tokenizeSvgText(candidate?.name || ""),
    ...(Array.isArray(candidate?.tags)
      ? candidate.tags.flatMap((x) => tokenizeSvgText(x))
      : []),
  ]);
  let score = 0;
  for (const token of tokenSet) {
    if (!token || token.length < 2) continue;
    if (candidateTokens.has(token)) {
      score += token.length >= 5 ? 3 : 2;
    } else {
      for (const ctoken of candidateTokens) {
        if (ctoken.startsWith(token) || token.startsWith(ctoken)) {
          score += 1;
          break;
        }
      }
    }
  }
  if (/bin|hopper|tank|silo/.test(String(candidate?.name || "").toLowerCase())) score += 0.2;
  return score;
}

function suggestSvgHeuristic({ prompt = "", catalog = [], selectedTagNames = [] }) {
  const list = Array.isArray(catalog) ? catalog : [];
  if (!list.length) return { picked: null, alternatives: [] };
  const promptTokens = tokenizeSvgText(prompt);
  const ranked = list
    .map((row) => ({
      ...row,
      score: scoreSvgCandidate(promptTokens, row, selectedTagNames),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  const picked = ranked[0] || null;
  const alternatives = ranked.slice(1, 4);
  return { picked, alternatives };
}

function buildOpcConnectionPlan({ prompt = "", plc = {}, overrides = {} }) {
  const metadata = plc?.metadata && typeof plc.metadata === "object" ? plc.metadata : {};
  const plcDisplayName = String(plc?.name || metadata?.controllerName || "PLC").trim() || "PLC";
  const plcName = normalizeOpcName(
    overrides?.plcName || metadata?.controllerName || plcDisplayName,
    "PLC1"
  );
  const topicName = normalizeOpcName(
    overrides?.topic || overrides?.topicName || parsePromptTopic(prompt),
    ""
  );
  const prefix = normalizeOpcName(overrides?.prefix || "");
  const host =
    String(overrides?.host || "").trim() ||
    parsePromptHost(prompt) ||
    String(plc?.host || "").trim();
  const slotGuess = parsePromptSlot(prompt);
  const slotRaw = Number.isFinite(Number(overrides?.slot))
    ? Number(overrides.slot)
    : Number.isFinite(slotGuess)
      ? slotGuess
      : 0;
  const slot = Math.max(0, Math.floor(slotRaw));
  const pollMsRaw = Number(overrides?.pollMs || overrides?.samplingInterval || 500);
  const pollMs = Number.isFinite(pollMsRaw) ? Math.max(100, Math.floor(pollMsRaw)) : 500;
  const sourceTags = normalizeControllerTags(
    overrides?.tags || plc?.controllerTags || [],
    500
  );
  const tags = sourceTags.map((t) => {
    const baseName = normalizeOpcName(t?.name || t?.tagPath || "", "");
    const resolvedName = prefix && baseName ? `${prefix}.${baseName}` : baseName;
    return {
      name: resolvedName,
      tagPath: String(t?.tagPath || baseName || "").trim(),
      plcType: t?.plcType || undefined,
      dataType: String(t?.dataType || "").trim() || undefined,
      uaType: String(t?.uaType || "").trim() || mapUaTypeFromPlcType(t?.plcType),
      topic: topicName,
      enabled: true,
      pollMs,
    };
  });
  return {
    plcName,
    host,
    slot,
    topic: topicName,
    topicExplicit: !!topicName,
    prefix,
    pollMs,
    tagCount: tags.length,
    tags,
  };
}

function resolveTopicForPlan(existingConfig, plan) {
  const cfg = existingConfig && typeof existingConfig === "object" ? existingConfig : {};
  const plcName = normalizeOpcName(plan?.plcName || "", "PLC1");
  const explicitTopic = normalizeOpcName(plan?.topic || plan?.topicName || "", "");
  if (explicitTopic) {
    return {
      ok: true,
      topic: explicitTopic,
      plcName,
      needsChoice: false,
      needsCreate: false,
      options: [],
    };
  }

  const topics = Array.isArray(cfg?.topics) ? cfg.topics : [];
  const plcTopics = topics
    .filter((row) => String(row?.plcName || "").trim().toLowerCase() === plcName.toLowerCase())
    .map((row) => normalizeOpcName(row?.name || "", ""))
    .filter(Boolean);
  const uniqueTopics = Array.from(new Set(plcTopics));

  if (uniqueTopics.length === 1) {
    return {
      ok: true,
      topic: uniqueTopics[0],
      plcName,
      needsChoice: false,
      needsCreate: false,
      options: uniqueTopics,
    };
  }

  if (uniqueTopics.length > 1) {
    return {
      ok: false,
      topic: "",
      plcName,
      needsChoice: true,
      needsCreate: false,
      options: uniqueTopics,
      message: `Multiple OPC topics exist for ${plcName}. Choose one: ${uniqueTopics.join(", ")}`,
    };
  }

  return {
    ok: false,
    topic: "",
    plcName,
    needsChoice: false,
    needsCreate: true,
    options: [],
    message: `No OPC topic exists for ${plcName}. Reply with the topic name to create.`,
  };
}

async function loadOpcConfigFromStore() {
  try {
    const { rows } = await pool.query("SELECT config FROM opc_config WHERE id = 1 LIMIT 1");
    if (rows.length && rows[0]?.config && typeof rows[0].config === "object") {
      return rows[0].config;
    }
  } catch {
    // fall back to file below
  }
  if (fs.existsSync(OPC_CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(OPC_CONFIG_PATH, "utf8");
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore invalid file
    }
  }
  return { ...DEFAULT_OPC_CONFIG };
}

async function saveOpcConfigToStore(config) {
  const next = config && typeof config === "object" ? config : { ...DEFAULT_OPC_CONFIG };
  await pool.query(
    "INSERT INTO opc_config (id, config) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()",
    [JSON.stringify(next)]
  );
  trendTagConfigCache = { loadedAt: 0, map: null };
}

function mergeOpcConfigWithPlan(existingConfig, plan, options = {}) {
  const base =
    existingConfig && typeof existingConfig === "object"
      ? existingConfig
      : { ...DEFAULT_OPC_CONFIG };
  const next = {
    ...base,
    plcs: Array.isArray(base.plcs) ? [...base.plcs] : [],
    topics: Array.isArray(base.topics) ? [...base.topics] : [],
    tags: Array.isArray(base.tags) ? [...base.tags] : [],
  };

  const plcName = normalizeOpcName(plan?.plcName || "", "PLC1");
  const topic = normalizeOpcName(plan?.topic || plcName, plcName);
  const host = String(plan?.host || "").trim();
  const slot = Number.isFinite(Number(plan?.slot)) ? Math.max(0, Number(plan.slot)) : 0;
  const pollMs = Number.isFinite(Number(plan?.pollMs)) ? Math.max(100, Number(plan.pollMs)) : 500;
  const prefix = normalizeOpcName(plan?.prefix || "");

  const plcIdx = next.plcs.findIndex((p) => String(p?.name || "").toLowerCase() === plcName.toLowerCase());
  const plcEntry = {
    ...(plcIdx >= 0 ? next.plcs[plcIdx] : {}),
    name: plcName,
    host: host || String(next.plcs[plcIdx]?.host || "").trim(),
    slot,
    pollMs,
  };
  if (plcIdx >= 0) next.plcs[plcIdx] = plcEntry;
  else next.plcs.push(plcEntry);

  const topicIdx = next.topics.findIndex((t) => String(t?.name || "").toLowerCase() === topic.toLowerCase());
  const topicEntry = {
    ...(topicIdx >= 0 ? next.topics[topicIdx] : {}),
    name: topic,
    prefix: prefix || String(next.topics[topicIdx]?.prefix || "").trim(),
    plcName,
    samplingInterval: pollMs,
    enabled: true,
  };
  if (topicIdx >= 0) next.topics[topicIdx] = topicEntry;
  else next.topics.push(topicEntry);

  const byKey = new Map();
  next.tags.forEach((tag, idx) => {
    const key = `${String(tag?.topic || "").trim().toLowerCase()}::${String(tag?.name || "").trim().toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, idx);
  });

  let addedTags = 0;
  let updatedTags = 0;
  let templateMatchedTags = 0;
  const templateNames = Array.isArray(options?.templateNames) ? options.templateNames : [];
  const incomingTags = normalizeControllerTags(plan?.tags || [], 5000);
  incomingTags.forEach((tag) => {
    const baseName = normalizeOpcName(tag?.name || tag?.tagPath || "");
    if (!baseName) return;
    const name = prefix && !baseName.startsWith(`${prefix}.`) ? `${prefix}.${baseName}` : baseName;
    const key = `${topic.toLowerCase()}::${name.toLowerCase()}`;
    const existingIdx = byKey.has(key) ? byKey.get(key) : -1;
    const existingTag = existingIdx >= 0 ? next.tags[existingIdx] : null;
    const incomingPlcType = String(tag?.plcType || "").trim();
    const explicitTemplate = String(tag?.templateName || tag?.template || "").trim();
    const dataTypeTemplate = resolveTemplateNameForDataType(tag?.dataType || "", templateNames);
    const plcTypeTemplate = resolveTemplateNameForDataType(tag?.plcType || "", templateNames);
    const uaTypeTemplate = resolveTemplateNameForDataType(
      String(tag?.uaType || "").trim() || mapUaTypeFromPlcType(tag?.plcType),
      templateNames
    );
    const matchedTemplate = explicitTemplate || dataTypeTemplate || plcTypeTemplate || uaTypeTemplate;
    if (matchedTemplate) templateMatchedTags += 1;
    const existingPlcType = String(existingTag?.plcType || "").trim();
    const useExistingTemplate = existingPlcType && !isPrimitivePlcType(existingPlcType);
    const resolvedPlcType = matchedTemplate || (useExistingTemplate ? existingPlcType : incomingPlcType || existingPlcType);
    const nextTag = {
      ...(typeof tag === "object" ? tag : {}),
      name,
      tagPath: String(tag?.tagPath || baseName).trim(),
      topic,
      enabled: tag?.enabled !== false,
      pollMs: Number.isFinite(Number(tag?.pollMs)) ? Math.max(100, Number(tag.pollMs)) : pollMs,
      plcType: resolvedPlcType || undefined,
      uaType: String(tag?.uaType || "").trim() || mapUaTypeFromPlcType(tag?.plcType),
    };
    if (existingIdx >= 0) {
      next.tags[existingIdx] = { ...next.tags[existingIdx], ...nextTag };
      updatedTags += 1;
      return;
    }
    byKey.set(key, next.tags.length);
    next.tags.push(nextTag);
    addedTags += 1;
  });

  return {
    config: next,
    summary: { addedTags, updatedTags, templateMatchedTags, topic, plcName, host: plcEntry.host || "" },
  };
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

function normalizePermissionRows(input) {
  const rows = Array.isArray(input) ? input : [];
  const byArea = new Map();
  for (const row of rows) {
    const areaKey = String(row?.area_key || row?.areaKey || "").trim().toLowerCase();
    if (!SECURITY_AREA_SET.has(areaKey)) continue;
    const canView = Boolean(row?.can_view ?? row?.canView ?? false);
    const canEdit = Boolean(row?.can_edit ?? row?.canEdit ?? false);
    byArea.set(areaKey, {
      area_key: areaKey,
      can_view: canView || canEdit,
      can_edit: canEdit,
    });
  }
  for (const areaKey of SECURITY_AREA_KEYS) {
    if (!byArea.has(areaKey)) {
      byArea.set(areaKey, {
        area_key: areaKey,
        can_view: false,
        can_edit: false,
      });
    }
  }
  return SECURITY_AREA_KEYS.map((areaKey) => byArea.get(areaKey));
}

function defaultRolePermissionRows(roleName) {
  const name = String(roleName || "").trim().toLowerCase();
  const allEdit = SECURITY_AREA_KEYS.map((areaKey) => ({
    area_key: areaKey,
    can_view: true,
    can_edit: true,
  }));
  if (name === "administrator") return allEdit;
  if (name === "engineer") {
    return allEdit;
  }
  if (name === "user") {
    return normalizePermissionRows([
      { area_key: "project", can_view: true, can_edit: false },
      { area_key: "plc", can_view: true, can_edit: false },
      { area_key: "opc", can_view: true, can_edit: false },
      { area_key: "server", can_view: true, can_edit: false },
      { area_key: "tags", can_view: true, can_edit: false },
      { area_key: "database", can_view: true, can_edit: false },
      { area_key: "reports", can_view: true, can_edit: false },
      { area_key: "ai", can_view: false, can_edit: false },
      { area_key: "security", can_view: false, can_edit: false },
      { area_key: "help", can_view: true, can_edit: false },
    ]);
  }
  if (name === "operator") {
    return normalizePermissionRows([
      { area_key: "project", can_view: true, can_edit: false },
      { area_key: "plc", can_view: true, can_edit: false },
      { area_key: "opc", can_view: true, can_edit: false },
      { area_key: "server", can_view: true, can_edit: false },
      { area_key: "tags", can_view: true, can_edit: false },
      { area_key: "database", can_view: true, can_edit: false },
      { area_key: "reports", can_view: true, can_edit: false },
      { area_key: "ai", can_view: false, can_edit: false },
      { area_key: "security", can_view: false, can_edit: false },
      { area_key: "help", can_view: true, can_edit: false },
    ]);
  }
  return normalizePermissionRows([]);
}

async function getUserAccess(userId) {
  const id = Number.parseInt(String(userId || ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return { roles: [], permissions: {} };
  }
  const { rows } = await pool.query(
    `
    SELECT
      r.id AS role_id,
      r.name AS role_name,
      COALESCE(r.description, '') AS role_description,
      rp.area_key,
      rp.can_view,
      rp.can_edit
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    LEFT JOIN role_area_permissions rp ON rp.role_id = r.id
    WHERE ur.user_id = $1
    ORDER BY r.name ASC, rp.area_key ASC
    `,
    [id]
  );
  const rolesById = new Map();
  const permissions = {};
  for (const key of SECURITY_AREA_KEYS) {
    permissions[key] = { can_view: false, can_edit: false };
  }
  for (const row of rows) {
    const roleId = Number(row.role_id);
    if (!rolesById.has(roleId)) {
      rolesById.set(roleId, {
        id: roleId,
        name: row.role_name,
        description: row.role_description || "",
      });
    }
    const areaKey = String(row.area_key || "").trim().toLowerCase();
    if (!SECURITY_AREA_SET.has(areaKey)) continue;
    const canView = Boolean(row.can_view);
    const canEdit = Boolean(row.can_edit);
    permissions[areaKey] = {
      can_view: permissions[areaKey].can_view || canView || canEdit,
      can_edit: permissions[areaKey].can_edit || canEdit,
    };
  }
  return {
    roles: Array.from(rolesById.values()),
    permissions,
  };
}

async function canUserEditArea(userId, areaKey) {
  const key = String(areaKey || "").trim().toLowerCase();
  if (!SECURITY_AREA_SET.has(key)) return false;
  const id = Number.parseInt(String(userId || ""), 10);
  if (!Number.isFinite(id) || id <= 0) return false;
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM user_roles ur
    JOIN role_area_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = $1
      AND rp.area_key = $2
      AND rp.can_edit = true
    LIMIT 1
    `,
    [id, key]
  );
  return rows.length > 0;
}

async function canUserViewArea(userId, areaKey) {
  const key = String(areaKey || "").trim().toLowerCase();
  if (!SECURITY_AREA_SET.has(key)) return false;
  const id = Number.parseInt(String(userId || ""), 10);
  if (!Number.isFinite(id) || id <= 0) return false;
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM user_roles ur
    JOIN role_area_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = $1
      AND rp.area_key = $2
      AND (rp.can_view = true OR rp.can_edit = true)
    LIMIT 1
    `,
    [id, key]
  );
  return rows.length > 0;
}

async function canManageSecurity(userId) {
  return canUserEditArea(userId, "security");
}

async function requireSecurityManage(req, res, next) {
  try {
    const authUser = req.user || (await getUserFromRequest(req));
    if (!authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const allowed = await canManageSecurity(authUser.id);
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err?.message || "Authorization failed." });
  }
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
    WHERE s.token_hash = $1 AND s.expires_at > now() AND COALESCE(u.disabled, false) = false
    `,
    [tokenHash]
  );
  return rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    if (req.path.startsWith("/api/auth")) return next();
    if (req.method === "OPTIONS") return next();
    if (
      (req.path === "/api/ai/plc-insights" &&
        (req.method === "POST" || req.method === "GET")) ||
      (req.path === "/api/ai/plc-svg-suggest" && req.method === "POST") ||
      (req.path === "/api/ai/plc-opc-connect" && req.method === "POST") ||
      req.path.startsWith("/api/ai/plc-debug-sessions")
    ) {
      return next();
    }
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

function normalizeDbIdentifier(value, label = "identifier") {
  const raw = String(value || "").trim();
  if (!/^[a-zA-Z0-9_]+$/.test(raw)) {
    throw new Error(`Invalid ${label}. Use letters, numbers, and underscore only.`);
  }
  return raw;
}

function normalizeSqlType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "timestamp with time zone") return "timestamptz";
  if (raw === "timestamp without time zone") return "timestamp";
  if (raw === "character varying") return "character varying";
  const allow = new Set([
    "text",
    "integer",
    "bigint",
    "smallint",
    "boolean",
    "date",
    "timestamp",
    "timestamptz",
    "real",
    "double precision",
    "uuid",
    "jsonb",
    "serial",
    "bigserial",
    "character varying",
    "numeric",
  ]);
  if (allow.has(raw)) return raw;
  if (/^varchar\(\d+\)$/.test(raw)) return raw;
  if (/^character varying\(\d+\)$/.test(raw)) return raw;
  if (/^numeric\(\d+\)$/.test(raw)) return raw.replace(/\s+/g, "");
  if (/^numeric\(\d+\s*,\s*\d+\)$/.test(raw)) return raw.replace(/\s+/g, "");
  throw new Error("Unsupported SQL type.");
}

function toSqlDefaultLiteral(value) {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "null") return "NULL";
  if (lower === "true" || lower === "false") return lower.toUpperCase();
  if (/^-?\d+(\.\d+)?$/.test(text)) return text;
  if (lower === "now()" || lower === "current_timestamp") return "CURRENT_TIMESTAMP";
  return `'${text.replace(/'/g, "''")}'`;
}

function emptyDesignerSchemaDoc() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tables: {},
  };
}

function loadDesignerSchemaDoc() {
  try {
    if (!fs.existsSync(DESIGNER_SCHEMA_PATH)) return emptyDesignerSchemaDoc();
    const raw = fs.readFileSync(DESIGNER_SCHEMA_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object") return emptyDesignerSchemaDoc();
    const tables = parsed.tables && typeof parsed.tables === "object" ? parsed.tables : {};
    return {
      version: Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : 1,
      updatedAt: String(parsed.updatedAt || new Date().toISOString()),
      tables,
    };
  } catch {
    return emptyDesignerSchemaDoc();
  }
}

function saveDesignerSchemaDoc(doc) {
  const next = doc && typeof doc === "object" ? doc : emptyDesignerSchemaDoc();
  next.updatedAt = new Date().toISOString();
  next.tables = next.tables && typeof next.tables === "object" ? next.tables : {};
  fs.writeFileSync(DESIGNER_SCHEMA_PATH, JSON.stringify(next, null, 2));
}

async function readTableSchemaFromDb(tableName, db) {
  const table = normalizeDbIdentifier(tableName, "table name");
  const client = db || pool;
  const [{ rows: metaRows }, pk] = await Promise.all([
    client.query(
      `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
      `,
      [table]
    ),
    getPrimaryKey(table),
  ]);
  return {
    name: table,
    primaryKey: pk || null,
    columns: (metaRows || []).map((c) => ({
      name: String(c.column_name || ""),
      type: String(c.data_type || "text"),
      nullable: String(c.is_nullable || "").toUpperCase() !== "NO",
      defaultSql: c.column_default == null ? "" : String(c.column_default),
      primaryKey: pk ? String(c.column_name || "") === pk : false,
    })),
    updatedAt: new Date().toISOString(),
  };
}

async function syncDesignerSchemaTable(tableName, db) {
  const snapshot = await readTableSchemaFromDb(tableName, db);
  const doc = loadDesignerSchemaDoc();
  doc.tables[snapshot.name] = snapshot;
  saveDesignerSchemaDoc(doc);
}

function removeDesignerSchemaTable(tableName) {
  const table = normalizeDbIdentifier(tableName, "table name");
  const doc = loadDesignerSchemaDoc();
  delete doc.tables[table];
  saveDesignerSchemaDoc(doc);
}

function renameDesignerSchemaTable(currentName, newName) {
  const current = normalizeDbIdentifier(currentName, "table name");
  const next = normalizeDbIdentifier(newName, "new table name");
  const doc = loadDesignerSchemaDoc();
  const existing = doc.tables[current];
  if (existing) {
    existing.name = next;
    existing.updatedAt = new Date().toISOString();
    doc.tables[next] = existing;
    delete doc.tables[current];
    saveDesignerSchemaDoc(doc);
  }
}

async function ensureDesignerTablesFromSchema(db) {
  const client = db || pool;
  const doc = loadDesignerSchemaDoc();
  const tables = doc.tables && typeof doc.tables === "object" ? doc.tables : {};
  for (const [tableName, spec] of Object.entries(tables)) {
    try {
      const table = normalizeDbIdentifier(tableName, "table name");
      const rawColumns = Array.isArray(spec?.columns) ? spec.columns : [];
      if (!rawColumns.length) continue;
      const columns = rawColumns
        .map((c) => {
          try {
            const name = normalizeDbIdentifier(c?.name, "column name");
            const type = normalizeSqlType(c?.type || "text");
            const nullable = c?.nullable !== false;
            const primaryKey = c?.primaryKey === true;
            const defaultSql = String(c?.defaultSql || "").trim();
            return { name, type, nullable, primaryKey, defaultSql };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      if (!columns.length) continue;

      const pkCols = columns.filter((c) => c.primaryKey).map((c) => c.name);
      const primaryKeyColumn = pkCols[0] || "";
      const defs = columns.map((c) => {
        if (primaryKeyColumn && c.name === primaryKeyColumn) {
          return `${safeIdent(c.name)} BIGINT GENERATED BY DEFAULT AS IDENTITY NOT NULL PRIMARY KEY`;
        }
        const nullableSql = c.primaryKey ? "NOT NULL" : c.nullable ? "" : "NOT NULL";
        const defaultSql = c.defaultSql ? ` DEFAULT ${c.defaultSql}` : "";
        return `${safeIdent(c.name)} ${c.type}${nullableSql ? ` ${nullableSql}` : ""}${defaultSql}`;
      });

      await client.query(`CREATE TABLE IF NOT EXISTS ${safeIdent(table)} (${defs.join(", ")})`);
      for (const c of columns) {
        if (primaryKeyColumn && c.name === primaryKeyColumn) {
          await client.query(
            `ALTER TABLE ${safeIdent(table)} ADD COLUMN IF NOT EXISTS ${safeIdent(c.name)} BIGINT GENERATED BY DEFAULT AS IDENTITY`
          );
          continue;
        }
        const defaultSql = c.defaultSql ? ` DEFAULT ${c.defaultSql}` : "";
        const nullableSql = c.nullable ? "" : " NOT NULL";
        await client.query(
          `ALTER TABLE ${safeIdent(table)} ADD COLUMN IF NOT EXISTS ${safeIdent(c.name)} ${c.type}${defaultSql}${nullableSql}`
        );
      }
      await ensureStandardTableColumns(client, table);
      if (primaryKeyColumn) {
        await applyPrimaryKeyState(client, table, primaryKeyColumn, true);
      }
    } catch {
      // Ignore malformed schema entries so startup doesn't fail.
    }
  }
}

async function getPrimaryKey(table) {
  const tableName = String(table || "").trim();
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) return null;
  const regclassRes = await pool.query("SELECT to_regclass($1) AS oid", [`public.${tableName}`]);
  const oid = regclassRes.rows?.[0]?.oid;
  if (!oid) return null;
  const sql = `
    SELECT a.attname AS column
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = $1::regclass AND i.indisprimary
    ORDER BY a.attnum
    LIMIT 1;
  `;
  const res = await pool.query(sql, [oid]);
  const pk = res.rows[0]?.column || null;
  if (!pk) return null;
  const check = await pool.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    LIMIT 1
    `,
    [tableName, pk]
  );
  return check.rows.length ? pk : null;
}

async function getPrimaryKeyConstraintInfo(db, table) {
  const tableName = normalizeDbIdentifier(table, "table name");
  const client = db || pool;
  const { rows } = await client.query(
    `
    SELECT
      con.conname AS constraint_name,
      att.attname AS column_name,
      ord.ordinality AS ord
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality) ON TRUE
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ord.attnum
    WHERE con.contype = 'p'
      AND nsp.nspname = 'public'
      AND rel.relname = $1
    ORDER BY ord.ordinality
    `,
    [tableName]
  );
  if (!rows.length) return { constraintName: "", columns: [] };
  return {
    constraintName: String(rows[0]?.constraint_name || ""),
    columns: rows.map((r) => String(r?.column_name || "")).filter(Boolean),
  };
}

async function ensureIdentityPrimaryKeyColumn(db, table, column) {
  const tableName = normalizeDbIdentifier(table, "table name");
  const columnName = normalizeDbIdentifier(column, "column name");
  const client = db || pool;
  const { rows } = await client.query(
    `
    SELECT data_type, is_identity
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName]
  );
  const meta = rows?.[0] || null;
  if (!meta) throw new Error(`Column "${columnName}" not found on table "${tableName}".`);

  const dataType = String(meta?.data_type || "").toLowerCase();
  const isIdentity = String(meta?.is_identity || "").toUpperCase() === "YES";

  if (dataType !== "bigint") {
    await client.query(
      `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} DROP DEFAULT`
    );
    await client.query(
      `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} TYPE BIGINT USING ${safeIdent(columnName)}::BIGINT`
    );
  }
  if (!isIdentity) {
    await client.query(
      `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} DROP DEFAULT`
    );
    await client.query(
      `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} ADD GENERATED BY DEFAULT AS IDENTITY`
    );
  }
}

async function applyPrimaryKeyState(db, table, column, shouldBePrimary) {
  const tableName = normalizeDbIdentifier(table, "table name");
  const columnName = normalizeDbIdentifier(column, "column name");
  const client = db || pool;
  const info = await getPrimaryKeyConstraintInfo(client, tableName);
  const hasColumnAsPk = info.columns.some((c) => c.toLowerCase() === columnName.toLowerCase());
  const hasSingleTargetPk = info.columns.length === 1 && hasColumnAsPk;

  if (shouldBePrimary === true) {
    await ensureIdentityPrimaryKeyColumn(client, tableName, columnName);
    if (!hasSingleTargetPk && info.constraintName) {
      await client.query(
        `ALTER TABLE ${safeIdent(tableName)} DROP CONSTRAINT ${safeIdent(info.constraintName)}`
      );
    }
    await client.query(
      `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} SET NOT NULL`
    );
    if (!hasSingleTargetPk) {
      const constraintName = normalizeDbIdentifier(`${tableName}_pkey`.slice(0, 60), "constraint name");
      await client.query(
        `ALTER TABLE ${safeIdent(tableName)} ADD CONSTRAINT ${safeIdent(constraintName)} PRIMARY KEY (${safeIdent(columnName)})`
      );
    }
    return;
  }

  if (shouldBePrimary === false && hasColumnAsPk && info.constraintName) {
    await client.query(
      `ALTER TABLE ${safeIdent(tableName)} DROP CONSTRAINT ${safeIdent(info.constraintName)}`
    );
  }
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
    users: ["id", "username", "password_hash", "password_salt", "created_at", "display_name", "avatar_url", "disabled"],
    user_sessions: ["id", "user_id", "token_hash", "created_at", "expires_at"],
    roles: ["id", "name", "description", "is_system", "created_at"],
    user_roles: ["user_id", "role_id"],
    role_area_permissions: ["role_id", "area_key", "can_view", "can_edit"],
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
const OLLAMA_IDLE_UNLOAD_MS = Math.max(
  30000,
  Number.parseInt(process.env.OLLAMA_IDLE_UNLOAD_MS || "180000", 10) || 180000
);

function resolveOllamaNativeBaseUrl() {
  const direct = String(OLLAMA_NATIVE_URL || "").trim();
  if (direct) return direct.replace(/\/$/, "");
  const compat = String(process.env.OPENAI_BASE_URL || "").trim();
  if (!compat) return "";
  try {
    const u = new URL(compat);
    if (!/^https?:$/i.test(String(u.protocol || ""))) return "";
    const host = String(u.hostname || "").trim().toLowerCase();
    if (!host) return "";
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") return "";
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

const OLLAMA_NATIVE_BASE_URL = resolveOllamaNativeBaseUrl();
let ollamaUnloadTimer = null;
let ollamaLastUsedAt = 0;
let ollamaLastModel = String(OPENAI_MODEL || "").trim() || "llama3";
let ollamaUnloadInFlight = false;

function markOllamaModelUsed(model = OPENAI_MODEL) {
  if (!OLLAMA_NATIVE_BASE_URL) return;
  const nextModel = String(model || "").trim();
  if (nextModel) ollamaLastModel = nextModel;
  ollamaLastUsedAt = Date.now();
  if (ollamaUnloadTimer) clearTimeout(ollamaUnloadTimer);
  ollamaUnloadTimer = setTimeout(() => {
    void unloadOllamaModelIfIdle();
  }, OLLAMA_IDLE_UNLOAD_MS);
}

async function unloadOllamaModelIfIdle(force = false) {
  if (!OLLAMA_NATIVE_BASE_URL) return false;
  if (ollamaUnloadInFlight) return false;
  const idleForMs = Date.now() - Number(ollamaLastUsedAt || 0);
  if (!force && idleForMs < OLLAMA_IDLE_UNLOAD_MS - 250) return false;
  ollamaUnloadInFlight = true;
  try {
    const model = String(ollamaLastModel || OPENAI_MODEL || "llama3").trim() || "llama3";
    await fetch(`${OLLAMA_NATIVE_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "",
        stream: false,
        keep_alive: 0,
      }),
    });
    return true;
  } catch {
    return false;
  } finally {
    ollamaUnloadInFlight = false;
  }
}

if (OLLAMA_NATIVE_BASE_URL) {
  process.on("SIGINT", () => {
    void unloadOllamaModelIfIdle(true).finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void unloadOllamaModelIfIdle(true).finally(() => process.exit(0));
  });
}

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
    const profile = rows[0] || user;
    const access = await getUserAccess(profile.id);
    res.json({
      user: {
        ...profile,
        roles: access.roles,
        permissions: access.permissions,
      },
    });
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
      `
      SELECT id, username, display_name, avatar_url, password_hash, password_salt, COALESCE(disabled, false) AS disabled
      FROM users
      WHERE username = $1
      `,
      [username]
    );
    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: "Invalid credentials." });
      return;
    }
    if (user.disabled) {
      res.status(403).json({ error: "User is disabled." });
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
    const access = await getUserAccess(user.id);
    res.json({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name || null,
        avatar_url: user.avatar_url || null,
        roles: access.roles,
        permissions: access.permissions,
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
    try {
      const { rows: existingRoles } = await pool.query("SELECT COUNT(*)::int AS count FROM user_roles");
      if (Number(existingRoles?.[0]?.count || 0) === 0) {
        const { rows: adminRoleRows } = await pool.query(
          "SELECT id FROM roles WHERE lower(name) = 'administrator' LIMIT 1"
        );
        if (adminRoleRows.length) {
          await pool.query(
            `
            INSERT INTO user_roles (user_id, role_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id, role_id) DO NOTHING
            `,
            [user.id, adminRoleRows[0].id]
          );
        }
      } else {
        const { rows: userRoleRows } = await pool.query(
          "SELECT id FROM roles WHERE lower(name) = 'user' LIMIT 1"
        );
        if (userRoleRows.length) {
          await pool.query(
            `
            INSERT INTO user_roles (user_id, role_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id, role_id) DO NOTHING
            `,
            [user.id, userRoleRows[0].id]
          );
        }
      }
    } catch {
      // keep registration successful even if role assignment fails
    }
    const access = await getUserAccess(user.id);
    res.json({ user: { ...user, roles: access.roles, permissions: access.permissions } });
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

async function listRolesWithPermissions() {
  const { rows } = await pool.query(
    `
    SELECT
      r.id,
      r.name,
      COALESCE(r.description, '') AS description,
      COALESCE(r.is_system, false) AS is_system,
      rp.area_key,
      rp.can_view,
      rp.can_edit
    FROM roles r
    LEFT JOIN role_area_permissions rp ON rp.role_id = r.id
    ORDER BY r.name ASC, rp.area_key ASC
    `
  );
  const byRole = new Map();
  for (const row of rows) {
    const roleId = Number(row.id);
    if (!byRole.has(roleId)) {
      byRole.set(roleId, {
        id: roleId,
        name: row.name,
        description: row.description || "",
        is_system: Boolean(row.is_system),
        permissions: {},
      });
    }
    const role = byRole.get(roleId);
    for (const key of SECURITY_AREA_KEYS) {
      if (!role.permissions[key]) {
        role.permissions[key] = { can_view: false, can_edit: false };
      }
    }
    const areaKey = String(row.area_key || "").trim().toLowerCase();
    if (SECURITY_AREA_SET.has(areaKey)) {
      role.permissions[areaKey] = {
        can_view: Boolean(row.can_view) || Boolean(row.can_edit),
        can_edit: Boolean(row.can_edit),
      };
    }
  }
  return Array.from(byRole.values());
}

app.get("/api/security/areas", async (_req, res) => {
  res.json({
    areas: SECURITY_AREA_KEYS.map((key) => ({ key, label: key.charAt(0).toUpperCase() + key.slice(1) })),
  });
});

app.get("/api/security/roles", requireSecurityManage, async (_req, res) => {
  try {
    const roles = await listRolesWithPermissions();
    res.json({ roles });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load roles." });
  }
});

app.post("/api/security/roles", requireSecurityManage, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const permissions = normalizePermissionRows(req.body?.permissions);
    if (!name) {
      res.status(400).json({ error: "Role name is required." });
      return;
    }
    const created = await pool.query(
      `
      INSERT INTO roles (name, description, is_system)
      VALUES ($1, $2, false)
      RETURNING id, name, description, is_system
      `,
      [name, description]
    );
    const role = created.rows[0];
    for (const row of permissions) {
      await pool.query(
        `
        INSERT INTO role_area_permissions (role_id, area_key, can_view, can_edit)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (role_id, area_key)
        DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit
        `,
        [role.id, row.area_key, row.can_view, row.can_edit]
      );
    }
    const roles = await listRolesWithPermissions();
    const next = roles.find((r) => r.id === role.id) || null;
    res.json({ role: next });
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("duplicate")) {
      res.status(409).json({ error: "Role name already exists." });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed to create role." });
  }
});

app.put("/api/security/roles/:id", requireSecurityManage, async (req, res) => {
  try {
    const roleId = Number.parseInt(String(req.params?.id || ""), 10);
    if (!Number.isFinite(roleId) || roleId <= 0) {
      res.status(400).json({ error: "Invalid role id." });
      return;
    }
    const { rows: roleRows } = await pool.query("SELECT id, is_system FROM roles WHERE id = $1", [roleId]);
    const role = roleRows[0];
    if (!role) {
      res.status(404).json({ error: "Role not found." });
      return;
    }
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    if (name) {
      await pool.query(
        "UPDATE roles SET name = $1, description = $2 WHERE id = $3",
        [name, description, roleId]
      );
    } else {
      await pool.query("UPDATE roles SET description = $1 WHERE id = $2", [description, roleId]);
    }
    if (Array.isArray(req.body?.permissions)) {
      const permissions = normalizePermissionRows(req.body.permissions);
      for (const row of permissions) {
        await pool.query(
          `
          INSERT INTO role_area_permissions (role_id, area_key, can_view, can_edit)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (role_id, area_key)
          DO UPDATE SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit
          `,
          [roleId, row.area_key, row.can_view, row.can_edit]
        );
      }
    }
    const roles = await listRolesWithPermissions();
    const next = roles.find((r) => r.id === roleId) || null;
    res.json({ role: next });
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("duplicate")) {
      res.status(409).json({ error: "Role name already exists." });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed to update role." });
  }
});

app.delete("/api/security/roles/:id", requireSecurityManage, async (req, res) => {
  try {
    const roleId = Number.parseInt(String(req.params?.id || ""), 10);
    if (!Number.isFinite(roleId) || roleId <= 0) {
      res.status(400).json({ error: "Invalid role id." });
      return;
    }
    const { rows: roleRows } = await pool.query("SELECT id, is_system FROM roles WHERE id = $1", [roleId]);
    if (!roleRows.length) {
      res.status(404).json({ error: "Role not found." });
      return;
    }
    if (roleRows[0].is_system) {
      res.status(400).json({ error: "System roles cannot be deleted." });
      return;
    }
    await pool.query("DELETE FROM roles WHERE id = $1", [roleId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete role." });
  }
});

app.get("/api/security/users", requireSecurityManage, async (_req, res) => {
  try {
    const { rows: users } = await pool.query(
      `
      SELECT id, username, COALESCE(display_name, '') AS display_name, COALESCE(avatar_url, '') AS avatar_url, COALESCE(disabled, false) AS disabled, created_at
      FROM users
      ORDER BY username ASC
      `
    );
    const { rows: roleRows } = await pool.query(
      `
      SELECT ur.user_id, r.id AS role_id, r.name AS role_name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      ORDER BY r.name ASC
      `
    );
    const rolesByUser = new Map();
    for (const row of roleRows) {
      const key = Number(row.user_id);
      if (!rolesByUser.has(key)) rolesByUser.set(key, []);
      rolesByUser.get(key).push({ id: Number(row.role_id), name: row.role_name });
    }
    res.json({
      users: users.map((user) => ({
        ...user,
        roles: rolesByUser.get(Number(user.id)) || [],
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load users." });
  }
});

app.post("/api/security/users", requireSecurityManage, async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const displayName = String(req.body?.display_name || "").trim();
    const password = String(req.body?.password || "");
    const roleIdsRaw = Array.isArray(req.body?.role_ids) ? req.body.role_ids : [];
    const roleIds = Array.from(
      new Set(
        roleIdsRaw
          .map((item) => Number.parseInt(String(item), 10))
          .filter((item) => Number.isFinite(item) && item > 0)
      )
    );
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
    const { salt, hash } = await createPasswordHash(password);
    const inserted = await pool.query(
      `
      INSERT INTO users (username, password_hash, password_salt, display_name, disabled)
      VALUES ($1, $2, $3, $4, false)
      RETURNING id, username, display_name, avatar_url, disabled, created_at
      `,
      [username, hash, salt, displayName || username]
    );
    const user = inserted.rows[0];
    for (const roleId of roleIds) {
      await pool.query(
        `
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        `,
        [user.id, roleId]
      );
    }
    const roles = await pool.query(
      `
      SELECT r.id, r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.name ASC
      `,
      [user.id]
    );
    res.json({ user: { ...user, roles: roles.rows } });
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("duplicate")) {
      res.status(409).json({ error: "Username already exists." });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed to create user." });
  }
});

app.put("/api/security/users/:id", requireSecurityManage, async (req, res) => {
  try {
    const userId = Number.parseInt(String(req.params?.id || ""), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user id." });
      return;
    }
    const { rows: existingRows } = await pool.query("SELECT id, username FROM users WHERE id = $1", [userId]);
    if (!existingRows.length) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    const username = String(req.body?.username || "").trim();
    const displayName = String(req.body?.display_name || "").trim();
    const disabled = req.body?.disabled == null ? null : Boolean(req.body.disabled);
    const password = String(req.body?.password || "");
    const roleIdsRaw = Array.isArray(req.body?.role_ids) ? req.body.role_ids : null;

    if (username && !/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      res.status(400).json({ error: "Username must be 3-32 chars (a-z, 0-9, _, ., -)." });
      return;
    }

    if (username) {
      const dup = await pool.query("SELECT id FROM users WHERE username = $1 AND id <> $2", [username, userId]);
      if (dup.rows.length) {
        res.status(409).json({ error: "Username already exists." });
        return;
      }
    }

    await pool.query(
      `
      UPDATE users
      SET username = COALESCE($1, username),
          display_name = COALESCE($2, display_name),
          disabled = COALESCE($3, disabled)
      WHERE id = $4
      `,
      [username || null, displayName || null, disabled, userId]
    );

    if (password) {
      if (password.length < 8) {
        res.status(400).json({ error: "Password must be at least 8 characters." });
        return;
      }
      const { salt, hash } = await createPasswordHash(password);
      await pool.query("UPDATE users SET password_hash = $1, password_salt = $2 WHERE id = $3", [hash, salt, userId]);
    }

    if (Array.isArray(roleIdsRaw)) {
      const roleIds = Array.from(
        new Set(
          roleIdsRaw
            .map((item) => Number.parseInt(String(item), 10))
            .filter((item) => Number.isFinite(item) && item > 0)
        )
      );
      await pool.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
      for (const roleId of roleIds) {
        await pool.query(
          `
          INSERT INTO user_roles (user_id, role_id)
          VALUES ($1, $2)
          ON CONFLICT (user_id, role_id) DO NOTHING
          `,
          [userId, roleId]
        );
      }
    }

    const { rows: updatedRows } = await pool.query(
      `
      SELECT id, username, COALESCE(display_name, '') AS display_name, COALESCE(avatar_url, '') AS avatar_url, COALESCE(disabled, false) AS disabled, created_at
      FROM users
      WHERE id = $1
      `,
      [userId]
    );
    const { rows: rolesRows } = await pool.query(
      `
      SELECT r.id, r.name
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.name ASC
      `,
      [userId]
    );
    res.json({ user: { ...updatedRows[0], roles: rolesRows } });
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("duplicate")) {
      res.status(409).json({ error: "Username already exists." });
      return;
    }
    res.status(500).json({ error: err?.message || "Failed to update user." });
  }
});

app.delete("/api/security/users/:id", requireSecurityManage, async (req, res) => {
  try {
    const userId = Number.parseInt(String(req.params?.id || ""), 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      res.status(400).json({ error: "Invalid user id." });
      return;
    }
    if (Number(req.user?.id) === userId) {
      res.status(400).json({ error: "You cannot delete your own account." });
      return;
    }
    const deleted = await pool.query("DELETE FROM users WHERE id = $1 RETURNING id", [userId]);
    if (!deleted.rows.length) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete user." });
  }
});

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
  const client = db || pool;
  const tableIdent = safeIdent(table);
  await client.query(
    `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS id BIGINT GENERATED BY DEFAULT AS IDENTITY`
  );
  await client.query(`ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`);
  await client.query(
    `ALTER TABLE ${tableIdent} ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`
  );

  const pk = await getPrimaryKey(table);
  if (!pk) {
    await client.query(`UPDATE ${tableIdent} SET id = DEFAULT WHERE id IS NULL`);
    const { rows } = await client.query(
      `
      SELECT
        COUNT(*)::int AS total_rows,
        COUNT(id)::int AS non_null_rows,
        COUNT(DISTINCT id)::int AS distinct_ids
      FROM ${tableIdent}
      `
    );
    const totalRows = Number(rows?.[0]?.total_rows || 0);
    const nonNullRows = Number(rows?.[0]?.non_null_rows || 0);
    const distinctIds = Number(rows?.[0]?.distinct_ids || 0);
    if (totalRows === nonNullRows && nonNullRows === distinctIds) {
      const constraintName = normalizeDbIdentifier(`${table}_pkey`.slice(0, 60), "constraint name");
      await client.query(
        `ALTER TABLE ${tableIdent} ADD CONSTRAINT ${safeIdent(constraintName)} PRIMARY KEY (id)`
      );
    }
  }
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

function parseTimestampMs(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
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
      "SELECT config, updated_at FROM opc_config WHERE id = 1"
    );
    if (rows.length) {
      const row = rows[0] || {};
      const dbUpdatedAtMs = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
      if (fs.existsSync(OPC_CONFIG_PATH)) {
        try {
          const fileStat = fs.statSync(OPC_CONFIG_PATH);
          const fileUpdatedAtMs = fileStat?.mtimeMs || 0;
          if (fileUpdatedAtMs > dbUpdatedAtMs) {
            const raw = fs.readFileSync(OPC_CONFIG_PATH, "utf-8");
            const parsed = JSON.parse(raw || "{}");
            await pool.query(
              "INSERT INTO opc_config (id, config) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()",
              [JSON.stringify(parsed)]
            );
            res.json(parsed);
            return;
          }
        } catch {
          // If file read/sync fails, fall back to DB config.
        }
      }
      res.json(row.config);
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
    const baseUpdatedAtMs = parseTimestampMs(req.body?.baseUpdatedAt);
    const hasBaseUpdatedAt = Number.isFinite(baseUpdatedAtMs);
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
        `
        SELECT p.id, p.name, p.data, p.updated_at, p.updated_by, u.username AS updated_by_username
        FROM projects p
        LEFT JOIN users u ON u.id = p.updated_by
        WHERE p.id = $1
        LIMIT 1
        `,
        [id]
      );
      const existing = existingRows[0] || null;
      const existingUpdatedAtMs = parseTimestampMs(existing?.updated_at);
      if (
        existing &&
        hasBaseUpdatedAt &&
        Number.isFinite(existingUpdatedAtMs) &&
        existingUpdatedAtMs !== baseUpdatedAtMs
      ) {
        res.status(409).json({
          code: "PROJECT_CONFLICT",
          error: "Project was updated by another session. Reload before saving.",
          project: existing,
        });
        return;
      }
      const mergedData =
        existing && teamMerge
          ? mergeProjectData(existing?.data || {}, data || {})
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
      const saved = rows[0] || null;
      if (saved) {
        await pool.query(
          `
          INSERT INTO project_versions (
            project_id, saved_by, base_updated_at, previous_data, next_data
          )
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
          `,
          [
            saved.id,
            userId,
            hasBaseUpdatedAt ? new Date(baseUpdatedAtMs).toISOString() : null,
            JSON.stringify(existing?.data || {}),
            JSON.stringify(saved?.data || {}),
          ]
        );
      }
      res.json({ project: rows[0] });
      return;
    }
    const { rows: existingByName } = await pool.query(
      `
      SELECT p.id, p.name, p.data, p.updated_at, p.updated_by, u.username AS updated_by_username
      FROM projects p
      LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.name = $1
      LIMIT 1
      `,
      [name]
    );
    const existing = existingByName[0] || null;
    const existingUpdatedAtMs = parseTimestampMs(existing?.updated_at);
    if (
      existing &&
      hasBaseUpdatedAt &&
      Number.isFinite(existingUpdatedAtMs) &&
      existingUpdatedAtMs !== baseUpdatedAtMs
    ) {
      res.status(409).json({
        code: "PROJECT_CONFLICT",
        error: "Project was updated by another session. Reload before saving.",
        project: existing,
      });
      return;
    }
    const mergedByName =
      existing && teamMerge
        ? mergeProjectData(existing?.data || {}, data || {})
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
    const saved = rows[0] || null;
    if (saved) {
      await pool.query(
        `
        INSERT INTO project_versions (
          project_id, saved_by, base_updated_at, previous_data, next_data
        )
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
        `,
        [
          saved.id,
          userId,
          hasBaseUpdatedAt ? new Date(baseUpdatedAtMs).toISOString() : null,
          JSON.stringify(existing?.data || {}),
          JSON.stringify(saved?.data || {}),
        ]
      );
    }
    res.json({ project: saved });
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

app.get("/api/alarms", async (req, res) => {
  try {
    const activeOnly = String(req.query.activeOnly || "").toLowerCase() === "true";
    if (activeOnly) {
      const { rows } = await pool.query(
        `
        SELECT
          alarm_key,
          topic,
          group_name,
          tag_path,
          label,
          operator,
          threshold,
          last_value,
          is_active,
          is_acknowledged,
          acknowledged_at,
          acknowledged_by,
          shelved_until,
          shelved_reason,
          first_triggered_at,
          last_seen_at,
          cleared_at,
          occurrence_count,
          updated_at
        FROM opc_alarm_state
        WHERE is_active = true AND (shelved_until IS NULL OR shelved_until <= now())
        ORDER BY first_triggered_at DESC NULLS LAST, updated_at DESC
        `
      );
      res.json({ active: rows, recent: [] });
      return;
    }
    const [active, recent] = await Promise.all([
      pool.query(
        `
        SELECT
          alarm_key,
          topic,
          group_name,
          tag_path,
          label,
          operator,
          threshold,
          last_value,
          is_active,
          is_acknowledged,
          acknowledged_at,
          acknowledged_by,
          shelved_until,
          shelved_reason,
          first_triggered_at,
          last_seen_at,
          cleared_at,
          occurrence_count,
          updated_at
        FROM opc_alarm_state
        WHERE is_active = true AND (shelved_until IS NULL OR shelved_until <= now())
        ORDER BY first_triggered_at DESC NULLS LAST, updated_at DESC
        `
      ),
      pool.query(
        `
        SELECT
          alarm_key,
          topic,
          group_name,
          tag_path,
          label,
          operator,
          threshold,
          last_value,
          is_active,
          is_acknowledged,
          acknowledged_at,
          acknowledged_by,
          shelved_until,
          shelved_reason,
          first_triggered_at,
          last_seen_at,
          cleared_at,
          occurrence_count,
          updated_at
        FROM opc_alarm_state
        ORDER BY updated_at DESC
        LIMIT 250
        `
      ),
    ]);
    res.json({ active: active.rows, recent: recent.rows });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load alarms." });
  }
});

app.get("/api/chat/messages", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.message,
        m.created_at,
        m.user_id,
        COALESCE(NULLIF(u.display_name, ''), u.username, CONCAT('User ', m.user_id::text)) AS author
      FROM support_chat_messages m
      LEFT JOIN users u ON u.id = m.user_id
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 200
      `
    );
    res.json({ messages: rows.reverse() });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load chat messages." });
  }
});

app.post("/api/chat/messages", async (req, res) => {
  try {
    const authUser = req.user || (await getUserFromRequest(req));
    if (!authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "Message is required." });
      return;
    }
    if (message.length > 2000) {
      res.status(400).json({ error: "Message is too long (max 2000 chars)." });
      return;
    }
    const { rows } = await pool.query(
      `
      INSERT INTO support_chat_messages (user_id, message)
      VALUES ($1, $2)
      RETURNING id, user_id, message, created_at
      `,
      [authUser.id, message]
    );
    const row = rows[0] || null;
    if (!row) {
      res.status(500).json({ error: "Failed to create message." });
      return;
    }
    res.status(201).json({
      message: {
        ...row,
        author: String(authUser.display_name || authUser.username || `User ${authUser.id}`),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to send chat message." });
  }
});

app.post("/api/alarms/:alarmKey/ack", async (req, res) => {
  try {
    const alarmKey = String(req.params.alarmKey || "").trim();
    const acknowledgedBy = String(req.body?.acknowledgedBy || "").trim();
    if (!alarmKey) {
      res.status(400).json({ error: "Alarm key is required." });
      return;
    }
    const { rows } = await pool.query(
      `
      UPDATE opc_alarm_state
      SET
        is_acknowledged = true,
        acknowledged_at = now(),
        acknowledged_by = $2,
        updated_at = now()
      WHERE alarm_key = $1
      RETURNING *
      `,
      [alarmKey, acknowledgedBy]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Alarm not found." });
      return;
    }
    res.json({ ok: true, alarm: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to acknowledge alarm." });
  }
});

app.post("/api/alarms/:alarmKey/shelve", async (req, res) => {
  try {
    const alarmKey = String(req.params.alarmKey || "").trim();
    const minutesRaw = Number(req.body?.minutes);
    const minutes = Number.isFinite(minutesRaw) ? Math.max(1, Math.min(7 * 24 * 60, Math.floor(minutesRaw))) : 60;
    const reason = String(req.body?.reason || "").trim();
    if (!alarmKey) {
      res.status(400).json({ error: "Alarm key is required." });
      return;
    }
    const { rows } = await pool.query(
      `
      UPDATE opc_alarm_state
      SET
        shelved_until = now() + make_interval(mins => $2),
        shelved_reason = $3,
        updated_at = now()
      WHERE alarm_key = $1
      RETURNING *
      `,
      [alarmKey, minutes, reason]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Alarm not found." });
      return;
    }
    res.json({ ok: true, alarm: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to shelve alarm." });
  }
});

app.post("/api/alarms/:alarmKey/unshelve", async (req, res) => {
  try {
    const alarmKey = String(req.params.alarmKey || "").trim();
    if (!alarmKey) {
      res.status(400).json({ error: "Alarm key is required." });
      return;
    }
    const { rows } = await pool.query(
      `
      UPDATE opc_alarm_state
      SET
        shelved_until = NULL,
        shelved_reason = '',
        updated_at = now()
      WHERE alarm_key = $1
      RETURNING *
      `,
      [alarmKey]
    );
    if (!rows.length) {
      res.status(404).json({ error: "Alarm not found." });
      return;
    }
    res.json({ ok: true, alarm: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to unshelve alarm." });
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
    try {
      await refreshActiveOpcAlarms(mergedStatus);
    } catch {
      // alarm refresh is best-effort and should not fail opc status ingestion
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

app.get("/api/db/config", async (_req, res) => {
  try {
    const connection = parseDatabaseConnectionInfo(DATABASE_URL);
    const poolInfo = {
      max: Number.isFinite(Number(pool?.options?.max)) ? Number(pool.options.max) : null,
      total: Number.isFinite(Number(pool?.totalCount)) ? Number(pool.totalCount) : 0,
      idle: Number.isFinite(Number(pool?.idleCount)) ? Number(pool.idleCount) : 0,
      waiting: Number.isFinite(Number(pool?.waitingCount)) ? Number(pool.waitingCount) : 0,
    };

    const checkedAt = Date.now();
    let connected = false;
    let latencyMs = null;
    let serverTime = "";
    let serverVersion = "";
    let tableCount = null;
    let routineCount = null;
    let error = "";

    if (pool) {
      const startedAt = Date.now();
      try {
        const health = await pool.query("SELECT now()::text AS now_text, version() AS version_text");
        connected = true;
        latencyMs = Date.now() - startedAt;
        serverTime = String(health.rows?.[0]?.now_text || "");
        serverVersion = String(health.rows?.[0]?.version_text || "");

        const counts = await pool.query(`
          SELECT
            (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS table_count,
            (SELECT COUNT(*)::int
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
                AND p.prokind IN ('f','p')
            ) AS routine_count
        `);
        tableCount = Number.isFinite(Number(counts.rows?.[0]?.table_count))
          ? Number(counts.rows[0].table_count)
          : null;
        routineCount = Number.isFinite(Number(counts.rows?.[0]?.routine_count))
          ? Number(counts.rows[0].routine_count)
          : null;
      } catch (err) {
        error = String(err?.message || "Database health check failed.");
      }
    } else {
      error = "Database pool is not initialized.";
    }

    res.json({
      connection,
      pool: poolInfo,
      health: {
        connected,
        checkedAt,
        latencyMs,
        serverTime,
        serverVersion,
        error,
      },
      catalog: {
        schema: "public",
        tableCount,
        routineCount,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load database config." });
  }
});

app.get("/api/svg/catalog", async (_req, res) => {
  try {
    const files = [];
    const seen = new Set();
    const roots = [SVG_LIBRARY_DIR, SVG_LIBRARY_DIR_STREAMLINED];
    for (const rootDir of roots) {
      if (!fs.existsSync(rootDir)) continue;
      const stack = [{ abs: rootDir, rel: "" }];
      while (stack.length) {
        const current = stack.pop();
        const entries = await fs.promises.readdir(current.abs, { withFileTypes: true });
        for (const entry of entries) {
          const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
          const abs = path.resolve(current.abs, entry.name);
          if (entry.isDirectory()) {
            stack.push({ abs, rel });
            continue;
          }
          if (!entry.isFile()) continue;
          if (!entry.name.toLowerCase().endsWith(".svg")) continue;
          const key = normalizeSvgCatalogKey(rel);
          if (seen.has(key)) continue;
          seen.add(key);
          files.push({
            key,
            name: entry.name,
            url: `/api/svg/raw?key=${encodeURIComponent(key)}`,
          });
        }
      }
    }
    files.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load SVG catalog." });
  }
});

app.get("/api/svg/debug", async (_req, res) => {
  try {
    const roots = [SVG_LIBRARY_DIR, SVG_LIBRARY_DIR_STREAMLINED];
    const summary = [];
    for (const rootDir of roots) {
      const exists = fs.existsSync(rootDir);
      let fileCount = 0;
      if (exists) {
        const stack = [rootDir];
        while (stack.length) {
          const current = stack.pop();
          const entries = await fs.promises.readdir(current, { withFileTypes: true });
          for (const entry of entries) {
            const abs = path.resolve(current, entry.name);
            if (entry.isDirectory()) {
              stack.push(abs);
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".svg")) {
              fileCount += 1;
            }
          }
        }
      }
      summary.push({
        root: rootDir,
        exists,
        fileCount,
      });
    }
    res.json({
      repoRoot: REPO_ROOT,
      hintRoot: ROOT_HINT || null,
      roots: summary,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to build SVG debug summary." });
  }
});

app.get("/api/svg/raw", async (req, res) => {
  try {
    const key = String(req.query.key || "").trim();
    const absolute = resolveSvgKeyToAbsolutePath(key);
    const raw = await fs.promises.readFile(absolute, "utf8");
    res.type("image/svg+xml").send(raw);
  } catch (err) {
    res.status(400).json({ error: err?.message || "Failed to load SVG file." });
  }
});

app.post("/api/db/batch-first-values", async (req, res) => {
  try {
    const bindings = Array.isArray(req.body?.bindings) ? req.body.bindings : [];
    const limit = Math.min(300, bindings.length);
    const tableRowCache = new Map();
    const values = {};

    for (let i = 0; i < limit; i += 1) {
      const b = bindings[i] || {};
      const overlayId = String(b.overlayId || "").trim();
      const table = String(b.table || "").trim();
      const field = String(b.field || "").trim();
      if (!overlayId || !/^[a-zA-Z0-9_]+$/.test(table) || !/^[a-zA-Z0-9_]+$/.test(field)) {
        continue;
      }
      if (!tableRowCache.has(table)) {
        const pk = await getPrimaryKey(table);
        const order = pk ? `ORDER BY ${safeIdent(pk)}` : "";
        const sql = `SELECT * FROM ${safeIdent(table)} ${order} LIMIT 1`;
        const result = await pool.query(sql);
        tableRowCache.set(table, result.rows?.[0] || null);
      }
      const row = tableRowCache.get(table);
      if (!row || typeof row !== "object") continue;
      if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
      const value = row[field];
      if (value == null) continue;
      values[overlayId] = value;
    }

    res.json({ values });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load batch DB values." });
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

app.get("/api/db/designer/schema", async (_req, res) => {
  try {
    const { rows: tableRows } = await pool.query(
      `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
      `
    );
    const tables = [];
    for (const row of tableRows) {
      const name = String(row.table_name || "");
      if (!name) continue;
      let metaRes = { rows: [] };
      let pk = null;
      let foreignKeys = {};
      try {
        [metaRes, pk, foreignKeys] = await Promise.all([
          pool.query(
            `
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
            ORDER BY ordinal_position
            `,
            [name]
          ),
          getPrimaryKey(name),
          getForeignKeysForTable(name),
        ]);
      } catch {
        // Keep returning the table list even if metadata lookup fails for one table.
      }
      tables.push({
        name,
        primaryKey: pk || null,
        columns: metaRes.rows || [],
        foreignKeys,
      });
    }
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load SQL designer schema." });
  }
});

app.post("/api/db/designer/table", async (req, res) => {
  try {
    const tableName = normalizeDbIdentifier(req.body?.tableName, "table name");
    const rawColumns = Array.isArray(req.body?.columns) ? req.body.columns : [];
    const cols = rawColumns.map((c, idx) => {
      const name = normalizeDbIdentifier(c?.name, `column name #${idx + 1}`);
      const type = normalizeSqlType(c?.type);
      const nullable = c?.nullable !== false;
      const defaultSql = toSqlDefaultLiteral(c?.defaultValue);
      return { name, type, nullable, defaultSql };
    });
    const uniqueNames = new Set(cols.map((c) => c.name.toLowerCase()));
    if (uniqueNames.size !== cols.length) {
      res.status(400).json({ error: "Duplicate column names are not allowed." });
      return;
    }
    const reserved = new Set(["id", "name", "description"]);
    const extraCols = cols.filter((c) => !reserved.has(String(c.name || "").toLowerCase()));
    const colDefs = [
      `${safeIdent("id")} BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY`,
      `${safeIdent("name")} TEXT NOT NULL DEFAULT ''`,
      `${safeIdent("description")} TEXT NOT NULL DEFAULT ''`,
      ...extraCols.map((c) => {
      const nullableSql = c.nullable ? "" : "NOT NULL";
      const defaultSql = c.defaultSql ? ` DEFAULT ${c.defaultSql}` : "";
      return `${safeIdent(c.name)} ${c.type}${nullableSql ? ` ${nullableSql}` : ""}${defaultSql}`;
    }),
    ];
    const sql = `CREATE TABLE IF NOT EXISTS ${safeIdent(tableName)} (${colDefs.join(", ")})`;
    await pool.query(sql);
    await ensureStandardTableColumns(pool, tableName);
    await syncDesignerSchemaTable(tableName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to create table." });
  }
});

app.put("/api/db/designer/table/:table/rename", async (req, res) => {
  try {
    const currentName = normalizeDbIdentifier(req.params.table, "table name");
    const newName = normalizeDbIdentifier(req.body?.newName, "new table name");
    await pool.query(`ALTER TABLE ${safeIdent(currentName)} RENAME TO ${safeIdent(newName)}`);
    renameDesignerSchemaTable(currentName, newName);
    await syncDesignerSchemaTable(newName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to rename table." });
  }
});

app.delete("/api/db/designer/table/:table", async (req, res) => {
  try {
    const tableName = normalizeDbIdentifier(req.params.table, "table name");
    await pool.query(`DROP TABLE IF EXISTS ${safeIdent(tableName)}`);
    removeDesignerSchemaTable(tableName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete table." });
  }
});

app.post("/api/db/designer/table/:table/column", async (req, res) => {
  const db = await pool.connect();
  try {
    const tableName = normalizeDbIdentifier(req.params.table, "table name");
    const columnName = normalizeDbIdentifier(req.body?.name, "column name");
    const type = normalizeSqlType(req.body?.type);
    const nullable = req.body?.nullable !== false;
    const defaultSql = toSqlDefaultLiteral(req.body?.defaultValue);
    const primaryKey = req.body?.primaryKey === true;
    const notNullSql = nullable ? "" : " NOT NULL";
    const defaultClause = defaultSql ? ` DEFAULT ${defaultSql}` : "";
    await db.query("BEGIN");
    await db.query(
      `ALTER TABLE ${safeIdent(tableName)} ADD COLUMN IF NOT EXISTS ${safeIdent(columnName)} ${type}${defaultClause}${notNullSql}`
    );
    if (primaryKey) {
      await applyPrimaryKeyState(db, tableName, columnName, true);
    }
    await db.query("COMMIT");
    await syncDesignerSchemaTable(tableName);
    res.json({ ok: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err?.message || "Failed to add column." });
  } finally {
    db.release();
  }
});

app.put("/api/db/designer/table/:table/column/:column", async (req, res) => {
  const db = await pool.connect();
  try {
    const tableName = normalizeDbIdentifier(req.params.table, "table name");
    const columnName = normalizeDbIdentifier(req.params.column, "column name");
    const newNameRaw = String(req.body?.newName || "").trim();
    const newName = newNameRaw ? normalizeDbIdentifier(newNameRaw, "new column name") : "";
    const typeRaw = String(req.body?.type || "").trim();
    const nullableSet = Object.prototype.hasOwnProperty.call(req.body || {}, "nullable");
    const defaultSet = Object.prototype.hasOwnProperty.call(req.body || {}, "defaultValue");
    const primaryKeySet = Object.prototype.hasOwnProperty.call(req.body || {}, "primaryKey");
    let effectiveColumnName = columnName;
    await db.query("BEGIN");
    if (typeRaw) {
      const nextType = normalizeSqlType(typeRaw);
      await db.query(
        `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} TYPE ${nextType}`
      );
    }
    if (defaultSet) {
      const defaultSql = toSqlDefaultLiteral(req.body?.defaultValue);
      if (defaultSql) {
        await db.query(
          `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} SET DEFAULT ${defaultSql}`
        );
      } else {
        await db.query(
          `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} DROP DEFAULT`
        );
      }
    }
    if (nullableSet) {
      if (req.body?.nullable === false) {
        await db.query(
          `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} SET NOT NULL`
        );
      } else {
        await db.query(
          `ALTER TABLE ${safeIdent(tableName)} ALTER COLUMN ${safeIdent(columnName)} DROP NOT NULL`
        );
      }
    }
    if (newName && newName.toLowerCase() !== columnName.toLowerCase()) {
      await db.query(
        `ALTER TABLE ${safeIdent(tableName)} RENAME COLUMN ${safeIdent(columnName)} TO ${safeIdent(newName)}`
      );
      effectiveColumnName = newName;
    }
    if (primaryKeySet) {
      await applyPrimaryKeyState(db, tableName, effectiveColumnName, req.body?.primaryKey === true);
    }
    await db.query("COMMIT");
    await syncDesignerSchemaTable(tableName);
    res.json({ ok: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: err?.message || "Failed to update column." });
  } finally {
    db.release();
  }
});

app.delete("/api/db/designer/table/:table/column/:column", async (req, res) => {
  try {
    const tableName = normalizeDbIdentifier(req.params.table, "table name");
    const columnName = normalizeDbIdentifier(req.params.column, "column name");
    await pool.query(
      `ALTER TABLE ${safeIdent(tableName)} DROP COLUMN IF EXISTS ${safeIdent(columnName)}`
    );
    await syncDesignerSchemaTable(tableName);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete column." });
  }
});

app.post("/api/db/designer/foreign-key", async (req, res) => {
  try {
    const fromTable = normalizeDbIdentifier(req.body?.fromTable, "source table");
    const fromColumn = normalizeDbIdentifier(req.body?.fromColumn, "source column");
    const toTable = normalizeDbIdentifier(req.body?.toTable, "target table");
    const toColumn = normalizeDbIdentifier(req.body?.toColumn, "target column");
    const actionAllow = new Set(["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"]);
    const onDelete = String(req.body?.onDelete || "NO ACTION").trim().toUpperCase();
    const onUpdate = String(req.body?.onUpdate || "NO ACTION").trim().toUpperCase();
    if (!actionAllow.has(onDelete) || !actionAllow.has(onUpdate)) {
      res.status(400).json({ error: "Invalid FK action." });
      return;
    }
    const rawConstraint = String(req.body?.constraintName || "").trim();
    const constraintName = rawConstraint
      ? normalizeDbIdentifier(rawConstraint, "constraint name")
      : normalizeDbIdentifier(`fk_${fromTable}_${fromColumn}_${toTable}_${toColumn}`.slice(0, 60), "constraint name");
    const sql = `
      ALTER TABLE ${safeIdent(fromTable)}
      ADD CONSTRAINT ${safeIdent(constraintName)}
      FOREIGN KEY (${safeIdent(fromColumn)})
      REFERENCES ${safeIdent(toTable)} (${safeIdent(toColumn)})
      ON DELETE ${onDelete}
      ON UPDATE ${onUpdate}
    `;
    await pool.query(sql);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to create foreign key." });
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
      SELECT column_name, data_type, is_nullable, column_default
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
    const pk = await getPrimaryKey(table);
    const keys = Object.keys(body).filter((k) => !pk || k !== pk);

    let sql = "";
    let params = [];
    if (!keys.length) {
      // Let database defaults/identity constraints drive insert behavior.
      sql = `INSERT INTO ${safeIdent(table)} DEFAULT VALUES RETURNING *`;
    } else {
      const cols = keys.map((k) => safeIdent(k)).join(", ");
      const vals = keys.map((_, i) => `$${i + 1}`).join(", ");
      sql = `INSERT INTO ${safeIdent(table)} (${cols}) VALUES (${vals}) RETURNING *`;
      params = keys.map((k) => body[k]);
    }
    const { rows } = await pool.query(sql, params);
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
      SELECT id, name, description, sql, layout_json, created_at, updated_at
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
    const layoutRaw = req.body?.layout;
    const layoutJson =
      layoutRaw && typeof layoutRaw === "object" && !Array.isArray(layoutRaw) ? layoutRaw : {};
    if (!name) {
      res.status(400).json({ error: "Report name required." });
      return;
    }
    const id = incomingId || crypto.randomUUID();
    if (incomingId) {
      const { rowCount } = await pool.query(
        `
        UPDATE ai_reports
        SET name = $1, description = $2, sql = $3, layout_json = $4::jsonb, updated_at = now()
        WHERE id = $5 AND user_id = $6
        `,
        [name, description || null, sql, JSON.stringify(layoutJson), id, userId]
      );
      if (!rowCount) {
        res.status(404).json({ error: "Report not found." });
        return;
      }
    } else {
      await pool.query(
        `
        INSERT INTO ai_reports (id, user_id, name, description, sql, layout_json)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [id, userId, name, description || null, sql, JSON.stringify(layoutJson)]
      );
    }
    const { rows } = await pool.query(
      `
      SELECT id, name, description, sql, layout_json, created_at, updated_at
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
      if (OLLAMA_NATIVE_BASE_URL) {
        markOllamaModelUsed(OPENAI_MODEL);
        const resp = await fetch(`${OLLAMA_NATIVE_BASE_URL}/api/generate`, {
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
      if (OLLAMA_NATIVE_BASE_URL) markOllamaModelUsed(OPENAI_MODEL);
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

app.post("/api/ai/ollama/release", async (_req, res) => {
  try {
    if (!OLLAMA_NATIVE_BASE_URL) {
      res.json({ ok: false, released: false, message: "Ollama native endpoint is not configured." });
      return;
    }
    const released = await unloadOllamaModelIfIdle(true);
    res.json({
      ok: true,
      released,
      model: String(ollamaLastModel || OPENAI_MODEL || ""),
      idleUnloadMs: OLLAMA_IDLE_UNLOAD_MS,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to release Ollama model memory." });
  }
});

function formatPlcDebugContext(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return "Live debug session: none.";
  const tags = Array.isArray(snapshot.tags) ? snapshot.tags : [];
  const topError = Array.isArray(snapshot?.hotspots?.errors) ? snapshot.hotspots.errors.slice(0, 8) : [];
  const topSlow = Array.isArray(snapshot?.hotspots?.slowReads) ? snapshot.hotspots.slowReads.slice(0, 8) : [];
  return [
    `Live debug snapshot @ ${snapshot.at ? new Date(snapshot.at).toISOString() : "unknown"}`,
    `Connected=${snapshot.connected === true} Active OPC connections=${Array.isArray(snapshot.activeConnections) ? snapshot.activeConnections.join(", ") || "none" : "none"}`,
    `Matched tags=${Number(snapshot.matchedTagCount || tags.length || 0)} Watched tags=${Number(snapshot.watchTagCount || 0)}`,
    topError.length
      ? `Error hotspots:\n${topError
          .map((t) => `${t.key} quality=${t.quality || "Unknown"} err=${t.errorCount || 0}/${t.readErrorCount || 0} streak=${t.errorStreak || 0} msg=${t.lastErrorMessage || "-"}`)
          .join("\n")}`
      : "Error hotspots: none.",
    topSlow.length
      ? `Slow-read hotspots:\n${topSlow
          .map((t) => `${t.key} avgMs=${t.avgReadDurationMs || 0} maxMs=${t.maxReadDurationMs || 0}`)
          .join("\n")}`
      : "Slow-read hotspots: none.",
    tags.length
      ? `Live tag sample:\n${tags
          .slice(0, 40)
          .map((t) => `${t.key} = ${String(t.value)} [${t.quality || "Unknown"}]`)
          .join("\n")}`
      : "Live tag sample: none.",
  ].join("\n\n");
}

app.post("/api/ai/plc-debug-sessions", async (req, res) => {
  try {
    const source = req.body && typeof req.body === "object" ? req.body : {};
    const requestedId = String(source?.sessionId || "").trim();
    const plcName = String(source?.plcName || source?.name || "PLC").trim() || "PLC";
    const controllerTagsRaw = normalizeControllerTags(source?.controllerTags || [], 800).map((t) => t.name);
    const watchTagsRaw = Array.isArray(source?.watchTags) ? source.watchTags : [];
    const routineHintsRaw = Array.isArray(source?.routineHints) ? source.routineHints : [];
    const now = Date.now();

    let session = requestedId ? plcDebugSessions.get(requestedId) : null;
    if (!session) {
      const id = `plcdbg-${now.toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
      session = {
        id,
        plcName,
        watchTags: [],
        routineHints: [],
        controllerTags: [],
        pollMs: PLC_DEBUG_SESSION_POLL_MS,
        createdAt: now,
        updatedAt: 0,
        lastTouchedAt: now,
        lastRefreshAt: 0,
        lastError: "",
        snapshot: null,
      };
      plcDebugSessions.set(id, session);
    }

    session.plcName = plcName;
    session.watchTags = normalizeDebugTagList([...session.watchTags, ...watchTagsRaw], PLC_DEBUG_MAX_WATCH_TAGS);
    session.routineHints = normalizeDebugTagList([...session.routineHints, ...routineHintsRaw], 32);
    session.controllerTags = normalizeDebugTagList([...controllerTagsRaw], 300);
    session.pollMs = Math.max(
      1000,
      Number.parseInt(String(source?.pollMs || session.pollMs || PLC_DEBUG_SESSION_POLL_MS), 10) || PLC_DEBUG_SESSION_POLL_MS
    );
    session.lastTouchedAt = now;
    session.lastRefreshAt = now;
    await refreshPlcDebugSession(session);
    res.json({ ok: true, session: serializePlcDebugSession(session) });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to create PLC debug session." });
  }
});

app.get("/api/ai/plc-debug-sessions/:id", async (req, res) => {
  try {
    const session = getPlcDebugSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Debug session not found." });
      return;
    }
    const now = Date.now();
    if (now - Number(session.lastRefreshAt || 0) >= Number(session.pollMs || PLC_DEBUG_SESSION_POLL_MS)) {
      session.lastRefreshAt = now;
      await refreshPlcDebugSession(session);
    }
    res.json({ ok: true, session: serializePlcDebugSession(session) });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load PLC debug session." });
  }
});

app.post("/api/ai/plc-debug-sessions/:id/watch", async (req, res) => {
  try {
    const session = getPlcDebugSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Debug session not found." });
      return;
    }
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const watchTagsRaw = Array.isArray(body?.watchTags) ? body.watchTags : [];
    const routineHintsRaw = Array.isArray(body?.routineHints) ? body.routineHints : [];
    const mode = String(body?.mode || "append").toLowerCase();
    if (mode === "replace") {
      session.watchTags = normalizeDebugTagList(watchTagsRaw, PLC_DEBUG_MAX_WATCH_TAGS);
      session.routineHints = normalizeDebugTagList(routineHintsRaw, 32);
    } else {
      session.watchTags = normalizeDebugTagList([...session.watchTags, ...watchTagsRaw], PLC_DEBUG_MAX_WATCH_TAGS);
      session.routineHints = normalizeDebugTagList([...session.routineHints, ...routineHintsRaw], 32);
    }
    session.lastTouchedAt = Date.now();
    session.lastRefreshAt = Date.now();
    await refreshPlcDebugSession(session);
    res.json({ ok: true, session: serializePlcDebugSession(session) });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to update debug watch list." });
  }
});

app.delete("/api/ai/plc-debug-sessions/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id || !plcDebugSessions.has(id)) {
      res.status(404).json({ error: "Debug session not found." });
      return;
    }
    plcDebugSessions.delete(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete debug session." });
  }
});

async function handlePlcInsights(req, res) {
  try {
    const source = req.method === "GET" ? req.query : req.body;
    const prompt = String(source?.prompt || "").trim();
    if (!prompt) {
      res.status(400).json({ error: "Missing prompt." });
      return;
    }
    const plc = source?.plc && typeof source.plc === "object" ? source.plc : {};
    const name = String(plc?.name || "PLC").trim() || "PLC";
    const metadata = plc?.metadata && typeof plc.metadata === "object" ? plc.metadata : {};
    const sections = Array.isArray(plc?.sections) ? plc.sections : [];
    const controllerTags = normalizeControllerTags(plc?.controllerTags || [], 600);
    const activeOpcConnections = Array.isArray(plc?.activeOpcConnections)
      ? plc.activeOpcConnections.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 60)
      : [];
    const opcConnectionCount = Number.isFinite(Number(plc?.opcConnectionCount))
      ? Math.max(0, Number(plc.opcConnectionCount))
      : activeOpcConnections.length;
    const rawSample = String(plc?.rawSample || "").slice(0, 18000);
    const history = Array.isArray(source?.history) ? source.history : [];
    const debugSessionId = String(source?.debugSessionId || plc?.debugSessionId || "").trim();
    let debugSnapshot = null;
    if (debugSessionId) {
      const debugSession = getPlcDebugSession(debugSessionId);
      if (debugSession) {
        const now = Date.now();
        if (now - Number(debugSession.lastRefreshAt || 0) >= Number(debugSession.pollMs || PLC_DEBUG_SESSION_POLL_MS)) {
          debugSession.lastRefreshAt = now;
          await refreshPlcDebugSession(debugSession);
        }
        debugSnapshot = debugSession.snapshot || null;
      }
    }

    const safeHistory = history
      .slice(-12)
      .map((item) => {
        const role = String(item?.role || "").toLowerCase();
        if (role !== "user" && role !== "assistant") return null;
        const content = String(item?.content || "").slice(0, 4000).trim();
        if (!content) return null;
        return { role, content };
      })
      .filter(Boolean);

    const metadataRows = Object.entries(metadata)
      .filter(([, value]) => String(value || "").trim())
      .map(([k, v]) => `${k}: ${String(v)}`);
    const sectionRows = sections.map((row) => {
      const label = String(row?.label || "").trim();
      const count = Number.isFinite(Number(row?.count)) ? Number(row.count) : 0;
      const names = Array.isArray(row?.names) ? row.names.slice(0, 12).map((x) => String(x || "").trim()).filter(Boolean) : [];
      return `${label || "Section"} count=${count}${names.length ? ` sample=${names.join(", ")}` : ""}`;
    });

    const plcContext = [
      `PLC file: ${name}`,
      metadataRows.length ? `Metadata:\n${metadataRows.join("\n")}` : "Metadata: none",
      sectionRows.length ? `Scan summary:\n${sectionRows.join("\n")}` : "Scan summary: none",
      activeOpcConnections.length
        ? `Active OPC connections (${opcConnectionCount}): ${activeOpcConnections.join(", ")}`
        : `Active OPC connections: none reported (${opcConnectionCount})`,
      controllerTags.length
        ? `Controller tags sample (${controllerTags.length}):\n${controllerTags
            .slice(0, 200)
            .map((t) => `${t.name}${t.plcType ? ` (${t.plcType})` : ""}`)
            .join("\n")}`
        : "Controller tags sample: none",
      rawSample
        ? `L5X XML excerpt (truncated):\n${rawSample}`
        : "L5X XML excerpt: not provided",
      formatPlcDebugContext(debugSnapshot),
    ].join("\n\n");

    const system = [
      "You are a PLC analysis assistant focused on Rockwell/Studio5000 L5X exports.",
      "Use only the provided PLC context and conversation.",
      "Do not invent tags, routines, or modules that are not in context.",
      "If data is missing, say exactly what is missing.",
      "Give concise, actionable answers for controls engineers.",
      "Treat active OPC connections as real-time environment context when suggesting mapping/connection steps.",
      "When asked about OPC setup, provide practical configuration steps using available controller tags.",
    ].join(" ");

    const input = [
      { role: "system", content: system },
      { role: "system", content: plcContext },
      ...safeHistory,
      { role: "user", content: prompt },
    ];

    function buildLocalFallbackAnswer() {
      const metaEntries = [
        ["Controller", metadata?.controllerName],
        ["Processor", metadata?.processorType],
        [
          "Revision",
          [metadata?.majorRev, metadata?.minorRev].filter((x) => String(x || "").trim()).join("."),
        ],
        ["Target", metadata?.targetName],
        ["Software", metadata?.softwareRevision],
      ].filter(([, value]) => String(value || "").trim());
      const sectionSummary = sections
        .map((row) => {
          const label = String(row?.label || "").trim() || "Section";
          const count = Number.isFinite(Number(row?.count)) ? Number(row.count) : 0;
          return `${label}: ${count}`;
        })
        .join(", ");
      return [
        `AI provider is unavailable for ${name}, so this is a local PLC summary.`,
        metaEntries.length
          ? `Metadata: ${metaEntries.map(([k, v]) => `${k}=${String(v)}`).join(" | ")}`
          : "Metadata: none found in uploaded file.",
        sectionSummary ? `Scan counts: ${sectionSummary}` : "Scan counts: none.",
        `Your prompt: ${prompt}`,
        "Configure OPENAI_API_KEY or OLLAMA_NATIVE_URL to enable full PLC AI responses.",
      ].join("\n\n");
    }

    async function getModelText(promptInput) {
      if (OLLAMA_NATIVE_BASE_URL) {
        markOllamaModelUsed(OPENAI_MODEL);
        const resp = await fetch(`${OLLAMA_NATIVE_BASE_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            prompt: promptInput.map((m) => `${String(m.role || "user").toUpperCase()}: ${String(m.content || "")}`).join("\n\n"),
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
      if (OLLAMA_NATIVE_BASE_URL) markOllamaModelUsed(OPENAI_MODEL);
      const response = await client.responses.create({
        model: OPENAI_MODEL,
        input: promptInput,
        max_output_tokens: 700,
      });
      return response.output_text || "";
    }

    const hasAiProvider =
      !!String(process.env.OLLAMA_NATIVE_URL || "").trim() ||
      !!String(process.env.OPENAI_BASE_URL || "").trim() ||
      !!String(process.env.OPENAI_API_KEY || "").trim();
    if (!hasAiProvider) {
      const wantsOpcConnection =
        source?.requestOpcPlan === true ||
        (/\b(opc|opcua)\b/i.test(prompt) &&
          /\b(connect|connection|configure|setup|bind|link|map)\b/i.test(prompt));
      const opcPlan = wantsOpcConnection
        ? buildOpcConnectionPlan({
            prompt,
            plc: { ...plc, controllerTags },
            overrides: source?.opcPlan || {},
          })
        : null;
      res.json({ answer: buildLocalFallbackAnswer(), opcPlan, debugSessionId });
      return;
    }

    let answer = "";
    try {
      answer = String(await getModelText(input)).trim();
    } catch {
      answer = buildLocalFallbackAnswer();
    }
    const wantsOpcConnection =
      source?.requestOpcPlan === true ||
      (/\b(opc|opcua)\b/i.test(prompt) &&
        /\b(connect|connection|configure|setup|bind|link|map)\b/i.test(prompt));
    const opcPlan = wantsOpcConnection
      ? buildOpcConnectionPlan({
          prompt,
          plc: { ...plc, controllerTags },
          overrides: source?.opcPlan || {},
        })
      : null;
    res.json({ answer: answer || "No answer generated.", opcPlan, debugSessionId });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to generate PLC insights." });
  }
}

app.post("/api/ai/plc-insights", handlePlcInsights);
app.get("/api/ai/plc-insights", handlePlcInsights);

app.post("/api/ai/plc-svg-suggest", async (req, res) => {
  try {
    const source = req.body && typeof req.body === "object" ? req.body : {};
    const prompt = String(source?.prompt || "").trim();
    if (!prompt) {
      res.status(400).json({ error: "Missing prompt." });
      return;
    }
    const catalog = normalizeSvgCatalog(source?.svgCatalog || [], 450);
    if (!catalog.length) {
      res.status(400).json({ error: "SVG catalog is empty." });
      return;
    }
    const history = Array.isArray(source?.history) ? source.history : [];
    const safeHistory = history
      .slice(-8)
      .map((item) => {
        const role = String(item?.role || "").toLowerCase();
        if (role !== "user" && role !== "assistant") return null;
        const content = String(item?.content || "").slice(0, 2000).trim();
        if (!content) return null;
        return { role, content };
      })
      .filter(Boolean);
    const plc = source?.plc && typeof source.plc === "object" ? source.plc : {};
    const controllerTags = normalizeControllerTags(plc?.controllerTags || [], 240);
    const selectedTagNames = controllerTags
      .slice(0, 120)
      .map((t) => String(t?.name || "").trim())
      .filter(Boolean);
    const hasAiProvider =
      !!String(process.env.OLLAMA_NATIVE_URL || "").trim() ||
      !!String(process.env.OPENAI_BASE_URL || "").trim() ||
      !!String(process.env.OPENAI_API_KEY || "").trim();

    let pickedKey = "";
    let answer = "";
    let aiAlternatives = [];

    if (hasAiProvider) {
      const system = [
        "You select the best SVG asset for PLC/HMI diagrams.",
        "Use only the provided catalog entries.",
        "Return ONLY valid JSON with keys: answer, picked_key, alternatives.",
        "alternatives must be an array of up to 3 objects with keys: key, reason.",
        "If no strong match exists, pick the closest practical symbol by equipment type.",
      ].join(" ");
      const catalogLines = catalog
        .map((row, idx) => {
          const tagText = row.tags.length ? ` | tags: ${row.tags.join(", ")}` : "";
          return `${idx + 1}. ${row.key} | ${row.name}${tagText}`;
        })
        .join("\n");
      const tagsText = selectedTagNames.length ? selectedTagNames.slice(0, 80).join(", ") : "(none)";
      const input = [
        { role: "system", content: system },
        { role: "system", content: `Available SVG catalog:\n${catalogLines}` },
        { role: "system", content: `Detected PLC tags/context: ${tagsText}` },
        ...safeHistory,
        { role: "user", content: prompt },
      ];
      let rawText = "";
      try {
        if (OLLAMA_NATIVE_BASE_URL) {
          markOllamaModelUsed(OPENAI_MODEL);
          const resp = await fetch(`${OLLAMA_NATIVE_BASE_URL}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              prompt: input
                .map((m) => `${String(m.role || "user").toUpperCase()}: ${String(m.content || "")}`)
                .join("\n\n"),
              stream: false,
            }),
          });
          if (!resp.ok) throw new Error(`Ollama error: ${resp.status}`);
          const data = await resp.json().catch(() => ({}));
          rawText = String(data?.response || "").trim();
        } else {
          if (OLLAMA_NATIVE_BASE_URL) markOllamaModelUsed(OPENAI_MODEL);
          const response = await client.responses.create({
            model: OPENAI_MODEL,
            input,
            max_output_tokens: 420,
          });
          rawText = String(response?.output_text || "").trim();
        }
      } catch {
        rawText = "";
      }

      const parsed = extractJson(rawText) || repairJson(rawText) || {};
      pickedKey = String(parsed?.picked_key || "").trim();
      answer = String(parsed?.answer || "").trim();
      aiAlternatives = Array.isArray(parsed?.alternatives) ? parsed.alternatives : [];
    }

    const byKey = new Map(catalog.map((row) => [String(row.key || "").toLowerCase(), row]));
    let picked = byKey.get(pickedKey.toLowerCase()) || null;
    let alternatives = [];
    if (picked) {
      alternatives = aiAlternatives
        .map((row) => {
          const key = String(row?.key || "").trim();
          const found = byKey.get(key.toLowerCase());
          if (!found) return null;
          return {
            key: found.key,
            name: found.name,
            reason: String(row?.reason || "").trim() || "",
          };
        })
        .filter(Boolean)
        .slice(0, 3);
    }
    if (!picked) {
      const guessed = suggestSvgHeuristic({ prompt, catalog, selectedTagNames });
      picked = guessed.picked;
      alternatives = guessed.alternatives.map((row) => ({
        key: row.key,
        name: row.name,
        reason: "Close name/tag match.",
      }));
    }
    if (!picked) {
      res.status(404).json({ error: "No matching SVG could be suggested." });
      return;
    }
    if (!answer) {
      answer = [
        `Best SVG: ${picked.name} (${picked.key}).`,
        alternatives.length
          ? `Alternatives: ${alternatives.map((row) => row.name).join(", ")}.`
          : "No strong alternatives found.",
      ].join(" ");
    }
    res.json({
      answer,
      picked: {
        key: picked.key,
        name: picked.name,
      },
      alternatives,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to suggest SVG." });
  }
});

app.post("/api/ai/plc-opc-connect", async (req, res) => {
  try {
    const source = req.body && typeof req.body === "object" ? req.body : {};
    const prompt = String(source?.prompt || "").trim();
    const plc = source?.plc && typeof source.plc === "object" ? source.plc : {};
    const incomingPlan = source?.opcPlan && typeof source.opcPlan === "object" ? source.opcPlan : {};
    const controllerTags = normalizeControllerTags(plc?.controllerTags || incomingPlan?.tags || [], 1200);
    const plan = buildOpcConnectionPlan({
      prompt,
      plc: { ...plc, controllerTags },
      overrides: incomingPlan,
    });

    const existing = await loadOpcConfigFromStore();
    const topicResolution = resolveTopicForPlan(existing, plan);
    if (!topicResolution.ok) {
      res.status(409).json({
        error: topicResolution.message || "Topic selection is required.",
        needsTopicChoice: topicResolution.needsChoice === true,
        needsTopicName: topicResolution.needsCreate === true,
        topicOptions: topicResolution.options,
        opcPlan: {
          ...plan,
          plcName: topicResolution.plcName,
        },
      });
      return;
    }
    plan.topic = topicResolution.topic;
    const existingPlc = Array.isArray(existing?.plcs)
      ? existing.plcs.find(
          (p) => String(p?.name || "").trim().toLowerCase() === String(plan?.plcName || "").trim().toLowerCase()
        )
      : null;
    if (!plan.host && existingPlc?.host) {
      plan.host = String(existingPlc.host || "").trim();
    }
    if (!plan.host) {
      res.status(400).json({
        error:
          "PLC host/IP is required to create OPC connection. Include it in your prompt (example: 10.0.0.39) or set it in the plan before apply.",
        opcPlan: plan,
      });
      return;
    }
    if (!Array.isArray(plan.tags) || plan.tags.length === 0) {
      res.status(400).json({
        error: "No PLC tags were found to map into OPC. Upload an L5X with controller tags first.",
        opcPlan: plan,
      });
      return;
    }

    const templateNames = await loadOpcTemplateNamesFromStore();
    const { config: nextConfig, summary } = mergeOpcConfigWithPlan(existing, plan, { templateNames });
    await saveOpcConfigToStore(nextConfig);

    const restartFlagPath = path.resolve(REPO_ROOT, "opc-server", "restart.requested");
    const restartAt = Date.now();
    fs.writeFileSync(restartFlagPath, JSON.stringify({ at: restartAt }, null, 2));

    res.json({
      ok: true,
      message:
        `OPC updated for ${summary.plcName} on topic ${summary.topic}. ` +
        `Added ${summary.addedTags} tag(s), updated ${summary.updatedTags} tag(s).` +
        (summary.templateMatchedTags > 0
          ? ` Matched ${summary.templateMatchedTags} tag(s) to OPC templates by PLC data type.`
          : ""),
      opcPlan: plan,
      summary: {
        ...summary,
        totalTags: Array.isArray(nextConfig?.tags) ? nextConfig.tags.length : 0,
        totalPlcs: Array.isArray(nextConfig?.plcs) ? nextConfig.plcs.length : 0,
        totalTopics: Array.isArray(nextConfig?.topics) ? nextConfig.topics.length : 0,
      },
      restartRequestedAt: restartAt,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to connect PLC to OPC." });
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

    for (const table of createdTables) {
      await syncDesignerSchemaTable(table);
    }

    res.json({ ok: true, applied: statements.length });
  } catch (err) {
    res.status(400).json({ error: err?.message || "Apply failed." });
  }
});

async function start() {
  await ensureDatabaseExists();
  pool = new Pool({ connectionString: DATABASE_URL });
  await ensureDesignerTablesFromSchema(pool);
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
      disabled BOOLEAN NOT NULL DEFAULT false,
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
    CREATE TABLE IF NOT EXISTS support_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS support_chat_messages_created_idx
    ON support_chat_messages(created_at DESC, id DESC);
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
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_system BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS role_area_permissions (
      role_id INT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      area_key TEXT NOT NULL,
      can_view BOOLEAN NOT NULL DEFAULT false,
      can_edit BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (role_id, area_key)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles(role_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS role_area_permissions_area_idx ON role_area_permissions(area_key);
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
  const defaultRoles = [
    {
      name: "Administrator",
      description: "Full access to all app areas and security administration.",
      is_system: true,
    },
    {
      name: "Engineer",
      description: "Build and configure projects with design and integration access.",
      is_system: true,
    },
    {
      name: "User",
      description: "Operate and monitor with read-only access to runtime pages.",
      is_system: true,
    },
    {
      name: "Operator",
      description: "Read-only access to runtime and process screens.",
      is_system: true,
    },
  ];
  for (const role of defaultRoles) {
    await pool.query(
      `
      INSERT INTO roles (name, description, is_system)
      VALUES ($1, $2, $3)
      ON CONFLICT (name) DO UPDATE
      SET description = EXCLUDED.description, is_system = EXCLUDED.is_system
      `,
      [role.name, role.description, role.is_system]
    );
  }
  const { rows: roleRows } = await pool.query("SELECT id, name FROM roles");
  const roleMap = new Map(roleRows.map((row) => [String(row.name || "").trim().toLowerCase(), Number(row.id)]));
  for (const [roleName, roleId] of roleMap.entries()) {
    const permissionRows = defaultRolePermissionRows(roleName);
    for (const permission of permissionRows) {
      await pool.query(
        `
        INSERT INTO role_area_permissions (role_id, area_key, can_view, can_edit)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (role_id, area_key) DO UPDATE
        SET can_view = EXCLUDED.can_view, can_edit = EXCLUDED.can_edit
        `,
        [roleId, permission.area_key, permission.can_view, permission.can_edit]
      );
    }
  }
  async function ensureSeededUserWithRole({ username, password, displayName, roleId }) {
    if (!Number.isFinite(roleId)) return null;
    const seededUsername = String(username || "").trim().toLowerCase();
    if (!seededUsername) return null;
    const seededPassword = String(password || "").trim();
    if (!seededPassword) return null;
    const seededDisplayName = String(displayName || seededUsername).trim() || seededUsername;
    const { salt: seededSalt, hash: seededHash } = await createPasswordHash(seededPassword);
    const { rows } = await pool.query(
      "SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1",
      [seededUsername]
    );
    let userId = null;
    if (rows.length) {
      userId = Number(rows[0].id);
      await pool.query(
        `
        UPDATE users
        SET username = $1,
            display_name = COALESCE(NULLIF(display_name, ''), $2),
            password_hash = $3,
            password_salt = $4,
            disabled = false
        WHERE id = $5
        `,
        [seededUsername, seededDisplayName, seededHash, seededSalt, userId]
      );
    } else {
      const created = await pool.query(
        `
        INSERT INTO users (username, password_hash, password_salt, display_name, disabled)
        VALUES ($1, $2, $3, $4, false)
        RETURNING id
        `,
        [seededUsername, seededHash, seededSalt, seededDisplayName]
      );
      userId = Number(created.rows[0]?.id || 0);
    }
    if (Number.isFinite(userId) && userId > 0) {
      await pool.query(
        `
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        `,
        [userId, roleId]
      );
      return userId;
    }
    return null;
  }

  const adminRoleId = roleMap.get("administrator");
  await ensureSeededUserWithRole({
    username: "admin",
    password: "admin",
    displayName: "Admin",
    roleId: adminRoleId,
  });

  const engineerRoleId = roleMap.get("engineer");
  await ensureSeededUserWithRole({
    username: "engineer",
    password: "engineer",
    displayName: "Engineer",
    roleId: engineerRoleId,
  });
  const { rows: userRoleCountRows } = await pool.query("SELECT COUNT(*)::int AS count FROM user_roles");
  if (Number(userRoleCountRows?.[0]?.count || 0) === 0) {
    const { rows: firstUserRows } = await pool.query(
      "SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1"
    );
    if (firstUserRows.length && Number.isFinite(adminRoleId)) {
      await pool.query(
        `
        INSERT INTO user_roles (user_id, role_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, role_id) DO NOTHING
        `,
        [firstUserRows[0].id, adminRoleId]
      );
    }
  }
  const userRoleId = roleMap.get("user");
  if (Number.isFinite(userRoleId)) {
    await pool.query(
      `
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, $1
      FROM users u
      WHERE NOT EXISTS (
        SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id
      )
      ON CONFLICT (user_id, role_id) DO NOTHING
      `,
      [userRoleId]
    );
  }
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
    CREATE TABLE IF NOT EXISTS opc_alarm_state (
      alarm_key TEXT PRIMARY KEY,
      topic TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT '',
      tag_path TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      operator TEXT NOT NULL DEFAULT '==',
      threshold TEXT NOT NULL DEFAULT '',
      last_value TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT false,
      first_triggered_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      cleared_at TIMESTAMPTZ,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS is_acknowledged BOOLEAN NOT NULL DEFAULT false;
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS acknowledged_by TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS shelved_until TIMESTAMPTZ;
  `);
  await pool.query(`
    ALTER TABLE opc_alarm_state
    ADD COLUMN IF NOT EXISTS shelved_reason TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS opc_alarm_state_active_idx
    ON opc_alarm_state(is_active, updated_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS opc_alarm_state_updated_idx
    ON opc_alarm_state(updated_at DESC);
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
    CREATE TABLE IF NOT EXISTS project_versions (
      id BIGSERIAL PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      saved_by INT REFERENCES users(id) ON DELETE SET NULL,
      base_updated_at TIMESTAMPTZ,
      previous_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      next_data JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS project_versions_project_saved_idx
    ON project_versions(project_id, saved_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS routes (
      id BIGSERIAL PRIMARY KEY,
      route_id TEXT,
      route_number TEXT,
      state TEXT,
      route_color TEXT,
      project_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS route_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS route_number TEXT;
  `);
  await pool.query(`
    ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS state TEXT;
  `);
  await pool.query(`
    ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS route_color TEXT;
  `);
  await pool.query(`
    ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS project_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_details (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      detail_value TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS job_id BIGINT;
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS detail_value TEXT NOT NULL DEFAULT '';
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    ALTER TABLE job_details
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'job_details'
      ) THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'job_details_job_id_fkey'
        ) THEN
          ALTER TABLE job_details
          ADD CONSTRAINT job_details_job_id_fkey
          FOREIGN KEY (job_id) REFERENCES jobs(id)
          ON DELETE CASCADE;
        END IF;
      END IF;
    END$$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS job_details_job_id_idx
    ON job_details(job_id);
  `);
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'jobs',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["name", "status", "updated_at"]),
      JSON.stringify(["name", "description", "status", "created_at", "updated_at"]),
    ]
  );
  await pool.query(
    `
    INSERT INTO ui_table_config (table_name, list_fields, detail_fields)
    VALUES (
      'job_details',
      $1::jsonb,
      $2::jsonb
    )
    ON CONFLICT (table_name) DO NOTHING
    `,
    [
      JSON.stringify(["job_id", "name", "detail_value", "updated_at"]),
      JSON.stringify(["job_id", "name", "description", "detail_value", "created_at", "updated_at"]),
    ]
  );
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
      layout_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE ai_reports
    ADD COLUMN IF NOT EXISTS layout_json JSONB NOT NULL DEFAULT '{}'::jsonb;
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
    setInterval(() => {
      void runPlcDebugSessionRefreshTick();
    }, Math.max(1000, Math.floor(PLC_DEBUG_SESSION_POLL_MS / 2)));
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err?.message || err);
  process.exit(1);
});
