import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import process from "process";
import os from "os";
import OpenAI from "openai";
import pkg from "pg";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import { ensureAppSchema } from "./schema/app-schema.js";

const { Pool } = pkg;

const PORT = Number(process.env.PORT || 5055);
const DEBUG_ROUTES = process.env.DEBUG_ROUTES === "1";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "64mb";
const OPC_STATUS_STALE_MS = Math.max(
  3000,
  Number.parseInt(String(process.env.OPC_STATUS_STALE_MS || "5000"), 10) || 5000
);
const OPC_WRITE_BRIDGE_URL = String(process.env.OPC_WRITE_BRIDGE_URL || "http://127.0.0.1:4851").replace(/\/+$/, "");
const OPC_SERVER_KEY = process.env.OPC_SERVER_KEY || "";
const OPC_BRIDGE_STATUS_TIMEOUT_MS = Math.max(
  250,
  Number.parseInt(String(process.env.OPC_BRIDGE_STATUS_TIMEOUT_MS || "1200"), 10) || 1200
);
const OPC_PERSIST_LIVE_STATUS = String(process.env.OPC_PERSIST_LIVE_STATUS || "0").trim() === "1";
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
const FRONTEND_DIST_DIR = pickFirstExisting(
  ROOT_CANDIDATES.map((root) => path.resolve(root, "dist"))
);
const FRONTEND_INDEX_PATH = FRONTEND_DIST_DIR
  ? path.resolve(FRONTEND_DIST_DIR, "index.html")
  : "";
const DESIGNER_SCHEMA_PATH = path.resolve(AI_SERVER_DIR, "designer-schema.json");
const AI_CONFIG_PATH = path.resolve(AI_SERVER_DIR, "ai-config.json");
const SVG_LIBRARY_DIR = path.resolve(REPO_ROOT, "src", "assets", "SVG_Files");
const SVG_LIBRARY_DIR_STREAMLINED = path.resolve(
  REPO_ROOT,
  "src",
  "assets",
  "SVG_Files_Streamlined"
);
const FLOUR_MILL_KNOWLEDGE_PATH = path.resolve(AI_SERVER_DIR, "knowledge", "flour-mill.md");

let flourMillKnowledgeCache = "";
let flourMillKnowledgeMtimeMs = 0;
function getFlourMillKnowledge() {
  try {
    if (!fs.existsSync(FLOUR_MILL_KNOWLEDGE_PATH)) return "";
    const stat = fs.statSync(FLOUR_MILL_KNOWLEDGE_PATH);
    const mtimeMs = Number(stat?.mtimeMs || 0);
    if (!flourMillKnowledgeCache || mtimeMs !== flourMillKnowledgeMtimeMs) {
      flourMillKnowledgeCache = String(fs.readFileSync(FLOUR_MILL_KNOWLEDGE_PATH, "utf8") || "").trim();
      flourMillKnowledgeMtimeMs = mtimeMs;
    }
    return flourMillKnowledgeCache;
  } catch {
    return "";
  }
}

function normalizeChatAiAction(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const source = input;
  const sourcePayload =
    source?.payload && typeof source.payload === "object" && !Array.isArray(source.payload)
      ? source.payload
      : source;
  const rawType = String(source?.type || sourcePayload?.type || "").trim().toLowerCase();
  const inferredType = rawType || (Array.isArray(sourcePayload?.items) ? "add_svg_layout" : "");
  if (inferredType !== "add_svg_layout") return null;
  const rawItems = Array.isArray(sourcePayload?.items) ? sourcePayload.items : [];
  const items = rawItems
    .slice(0, 120)
    .map((row) => {
      const entry = row && typeof row === "object" && !Array.isArray(row) ? row : {};
      const svgKey = String(
        entry.svgKey || entry.svgName || entry.svg || entry.template || entry.key || ""
      ).trim();
      const label = String(entry.label || entry.name || "").trim();
      const tagPath = String(entry.tagPath || entry.tag || "").trim();
      const x = Number(entry.x);
      const y = Number(entry.y);
      const width = Number(entry.width || entry.w || 0);
      return {
        svgKey,
        label,
        tagPath,
        x: Number.isFinite(x) ? x : null,
        y: Number.isFinite(y) ? y : null,
        width: Number.isFinite(width) && width > 0 ? width : null,
      };
    })
    .filter((item) => item.svgKey);
  if (!items.length) return null;
  const rawLayout =
    sourcePayload?.layout && typeof sourcePayload.layout === "object" && !Array.isArray(sourcePayload.layout)
      ? sourcePayload.layout
      : {};
  const layout = {
    mode: String(rawLayout.mode || "grid").trim().toLowerCase() || "grid",
    columns: Number(rawLayout.columns),
    cellW: Number(rawLayout.cellW || rawLayout.targetW || 0),
    cellH: Number(rawLayout.cellH || 0),
    gapX: Number(rawLayout.gapX || 0),
    gapY: Number(rawLayout.gapY || 0),
    startX: Number(rawLayout.startX),
    startY: Number(rawLayout.startY),
  };
  return {
    type: "add_svg_layout",
    payload: { items, layout },
  };
}

function extractChatAiAction(rawText = "") {
  const text = String(rawText || "");
  let action = null;
  let cleaned = text;

  const parseCandidate = (jsonLike) => {
    try {
      const parsed = JSON.parse(String(jsonLike || "").trim());
      return normalizeChatAiAction(parsed);
    } catch {
      return null;
    }
  };

  const markerMatch = cleaned.match(/(^|\n)\s*MESORA_ACTION\s*[:=]\s*(\{.*\})\s*$/m);
  if (markerMatch?.[2]) {
    const parsed = parseCandidate(markerMatch[2]);
    if (parsed) {
      action = parsed;
      cleaned = cleaned.replace(markerMatch[0], "\n");
    }
  }

  if (!action) {
    const fencedMatch = cleaned.match(/```mesora_action\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      const parsed = parseCandidate(fencedMatch[1]);
      if (parsed) {
        action = parsed;
        cleaned = cleaned.replace(fencedMatch[0], "\n");
      }
    }
  }

  if (!action) {
    const marker = cleaned.match(/MESORA_ACTION\s*[:=]/i);
    if (marker && Number.isFinite(marker.index)) {
      const start = cleaned.indexOf("{", marker.index);
      if (start >= 0) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        let end = -1;
        for (let i = start; i < cleaned.length; i += 1) {
          const ch = cleaned[i];
          if (inString) {
            if (escaped) {
              escaped = false;
            } else if (ch === "\\") {
              escaped = true;
            } else if (ch === "\"") {
              inString = false;
            }
            continue;
          }
          if (ch === "\"") {
            inString = true;
            continue;
          }
          if (ch === "{") depth += 1;
          if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
              end = i + 1;
              break;
            }
          }
        }
        if (end > start) {
          const candidate = cleaned.slice(start, end);
          const parsed = parseCandidate(candidate);
          if (parsed) {
            action = parsed;
            cleaned = `${cleaned.slice(0, marker.index)}${cleaned.slice(end)}`;
          }
        }
      }
    }
  }

  return {
    message: String(cleaned || "").trim(),
    action,
  };
}

function inferDesignSvgActionFromPrompt(prompt = "") {
  const raw = String(prompt || "").trim();
  if (!raw) return null;
  const text = raw.toLowerCase();
  const wantsPlacement =
    /\b(add|place|layout|arrange|insert|draw|drop)\b/.test(text) &&
    /\b(svg|bin|bins|diverter|diverters|blower|blowers|airlock|airlocks|motor|motors)\b/.test(text);
  if (!wantsPlacement) return null;

  const numMatch = text.match(/\b(\d{1,3})\b/);
  const wordToNum = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const wordNum =
    Object.entries(wordToNum).find(([word]) => new RegExp(`\\b${word}\\b`).test(text))?.[1] || null;
  const count = Math.max(1, Math.min(120, Number(numMatch?.[1] || wordNum || 1)));

  const keyword =
    /\bbin(s)?\b/.test(text) ? "bin" :
    /\bdiverter(s)?\b/.test(text) ? "diverter" :
    /\bblower(s)?\b/.test(text) ? "blower" :
    /\bairlock(s)?\b/.test(text) ? "airlock" :
    /\bmotor(s)?\b/.test(text) ? "motor" :
    "bin";
  const labelBase = keyword.charAt(0).toUpperCase() + keyword.slice(1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  return normalizeChatAiAction({
    type: "add_svg_layout",
    payload: {
      items: Array.from({ length: count }, (_, i) => ({
        svgKey: keyword,
        label: `${labelBase} ${i + 1}`,
      })),
      layout: { mode: "grid", columns },
    },
  });
}

const app = express();
const SERVER_LOG_LIMIT = Math.max(
  200,
  Math.min(10000, Number.parseInt(String(process.env.SERVER_LOG_LIMIT || "3000"), 10) || 3000)
);
const SERVER_LOG_DEDUPE_WINDOW_MS = Math.max(
  0,
  Math.min(
    60000,
    Number.parseInt(String(process.env.SERVER_LOG_DEDUPE_WINDOW_MS || "2000"), 10) || 2000
  )
);
const serverLogs = [];
let serverLogSeq = 1;
const CLIENT_LOG_MESSAGE_MAX = Math.max(
  120,
  Math.min(8000, Number.parseInt(String(process.env.CLIENT_LOG_MESSAGE_MAX || "1200"), 10) || 1200)
);
const CLIENT_LOG_SOURCE_MAX = 80;
const CLIENT_LOG_META_MAX = 24000;
const LOG_CATEGORY_VALUES = new Set([
  "general",
  "api",
  "opc",
  "database",
  "auth",
  "security",
  "client",
  "process",
  "system",
]);
const LOG_DATA_TYPE_VALUES = new Set([
  "text",
  "json_object",
  "json_array",
  "error",
  "number",
  "boolean",
  "null",
  "unknown",
]);

function normalizeLogCategory(value, fallback = "general") {
  const key = String(value || "").trim().toLowerCase();
  if (LOG_CATEGORY_VALUES.has(key)) return key;
  const fb = String(fallback || "").trim().toLowerCase();
  return LOG_CATEGORY_VALUES.has(fb) ? fb : "general";
}

function inferLogCategory(message = "", source = "", meta = {}) {
  const src = String(source || "").trim().toLowerCase();
  const msg = String(message || "").trim().toLowerCase();
  if (src.includes("opc") || msg.includes("opc")) return "opc";
  if (src.includes("db") || src.includes("postgres") || msg.includes("database") || msg.includes("sql")) return "database";
  if (src.includes("auth") || src.includes("security") || msg.includes("login") || msg.includes("token")) return "auth";
  if (src.startsWith("client:")) return "client";
  if (src.includes("process") || src.includes("node") || msg.includes("uncaught") || msg.includes("unhandled")) return "process";
  if (src.includes("api") || String(meta?.route || "").startsWith("/api/")) return "api";
  if (src.includes("system")) return "system";
  return "general";
}

function inferLogDataType(message = "", meta = {}) {
  if (meta instanceof Error || meta?.error) return "error";
  if (Array.isArray(meta)) return "json_array";
  if (meta && typeof meta === "object") return "json_object";
  if (meta == null) {
    const parsed = tryParseJsonText(message);
    if (parsed && Array.isArray(parsed)) return "json_array";
    if (parsed && typeof parsed === "object") return "json_object";
    return "text";
  }
  if (typeof meta === "number") return "number";
  if (typeof meta === "boolean") return "boolean";
  if (typeof meta === "string") {
    const parsed = tryParseJsonText(meta);
    if (parsed && Array.isArray(parsed)) return "json_array";
    if (parsed && typeof parsed === "object") return "json_object";
    return "text";
  }
  return "unknown";
}

function tryParseJsonText(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;
  if (!(text.startsWith("{") || text.startsWith("["))) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function ensureServerLogSchema(db) {
  if (!db) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS server_logs (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      level TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'server',
      category TEXT NOT NULL DEFAULT 'general',
      data_type TEXT NOT NULL DEFAULT 'unknown',
      message TEXT NOT NULL DEFAULT '',
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      count INTEGER NOT NULL DEFAULT 1
    );
  `);
  await db.query(`ALTER TABLE server_logs ADD COLUMN IF NOT EXISTS at TIMESTAMPTZ NOT NULL DEFAULT now();`);
  await db.query(`ALTER TABLE server_logs ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'info';`);
  await db.query(`ALTER TABLE server_logs ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'server';`);
  await db.query(`ALTER TABLE server_logs ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';`);
  await db.query(`ALTER TABLE server_logs ADD COLUMN IF NOT EXISTS data_type TEXT NOT NULL DEFAULT 'unknown';`);
  await db.query(`ALTER TABLE server_logs ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';`);
  await db.query(`ALTER TABLE server_logs ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await db.query(`ALTER TABLE server_logs ADD COLUMN IF NOT EXISTS count INTEGER NOT NULL DEFAULT 1;`);
  await db.query(`CREATE INDEX IF NOT EXISTS server_logs_at_idx ON server_logs(at DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS server_logs_level_idx ON server_logs(level);`);
  await db.query(`CREATE INDEX IF NOT EXISTS server_logs_source_idx ON server_logs(source);`);
  await db.query(`CREATE INDEX IF NOT EXISTS server_logs_category_idx ON server_logs(category);`);
  await db.query(`CREATE INDEX IF NOT EXISTS server_logs_data_type_idx ON server_logs(data_type);`);
}

function persistServerLog(entry) {
  if (!logPool || !entry) return;
  const ts = Number(entry?.at || Date.now());
  const atIso = Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
  const level = String(entry?.level || "info").trim().toLowerCase();
  const source = String(entry?.source || "server").trim() || "server";
  const category = normalizeLogCategory(entry?.category, inferLogCategory(entry?.message, source, entry?.meta));
  const dataType = (() => {
    const key = String(entry?.dataType || entry?.data_type || "").trim().toLowerCase();
    if (LOG_DATA_TYPE_VALUES.has(key)) return key;
    return inferLogDataType(entry?.message, entry?.meta);
  })();
  const message = String(entry?.message || "");
  const meta = serializeLogMeta(entry?.meta);
  const count = Math.max(1, Number.parseInt(String(entry?.count || 1), 10) || 1);
  void logPool
    .query(
      `
      INSERT INTO server_logs (at, level, source, category, data_type, message, meta, count)
      VALUES ($1::timestamptz, $2, $3, $4, $5, $6, $7::jsonb, $8)
      `,
      [atIso, level, source, category, dataType, message, JSON.stringify(meta || {}), count]
    )
    .catch((err) => {
      try {
        process.stderr.write(`[logger] failed to persist log entry: ${String(err?.message || err)}\n`);
      } catch {
        // ignore
      }
    });
}

function serializeLogMeta(meta) {
  if (meta == null) return {};
  if (meta instanceof Error) {
    return {
      name: String(meta.name || "Error"),
      message: String(meta.message || ""),
      stack: String(meta.stack || ""),
    };
  }
  if (typeof meta === "object") {
    try {
      return JSON.parse(JSON.stringify(meta));
    } catch {
      return { note: "meta_unserializable" };
    }
  }
  return { value: String(meta) };
}

function appendServerLog(level, message, meta = {}, source = "server") {
  const serializedMeta = serializeLogMeta(meta);
  const normalizedLevel = String(level || "info").toLowerCase();
  const normalizedSource = String(source || "server");
  const normalizedMessage = String(message || "");
  const normalizedCategory = normalizeLogCategory(
    meta?.category,
    inferLogCategory(normalizedMessage, normalizedSource, serializedMeta)
  );
  const normalizedDataType = (() => {
    const explicit = String(meta?.dataType || meta?.data_type || "").trim().toLowerCase();
    if (LOG_DATA_TYPE_VALUES.has(explicit)) return explicit;
    return inferLogDataType(normalizedMessage, serializedMeta);
  })();
  const now = Date.now();
  const signature = (() => {
    try {
      return JSON.stringify(serializedMeta);
    } catch {
      return "{}";
    }
  })();
  if (SERVER_LOG_DEDUPE_WINDOW_MS > 0 && serverLogs.length) {
    for (let i = serverLogs.length - 1; i >= 0; i -= 1) {
      const candidate = serverLogs[i];
      if (!candidate || typeof candidate !== "object") continue;
      if (String(candidate.level || "") !== normalizedLevel) continue;
      if (String(candidate.source || "") !== normalizedSource) continue;
      if (String(candidate.message || "") !== normalizedMessage) continue;
      const candidateSig = (() => {
        try {
          return JSON.stringify(candidate.meta || {});
        } catch {
          return "{}";
        }
      })();
      if (candidateSig !== signature) continue;
      const previousAt = Number(candidate.at || 0);
      if (!Number.isFinite(previousAt)) continue;
      if (now - previousAt > SERVER_LOG_DEDUPE_WINDOW_MS) break;
      const merged = {
        ...candidate,
        at: now,
        count: Math.max(1, Number(candidate.count || 1)) + 1,
      };
      serverLogs.splice(i, 1);
      serverLogs.push(merged);
      return merged;
    }
  }
  const entry = {
    id: serverLogSeq++,
    at: now,
    level: normalizedLevel,
    source: normalizedSource,
    category: normalizedCategory,
    dataType: normalizedDataType,
    message: normalizedMessage,
    meta: serializedMeta,
    count: 1,
  };
  serverLogs.push(entry);
  if (serverLogs.length > SERVER_LOG_LIMIT) {
    serverLogs.splice(0, serverLogs.length - SERVER_LOG_LIMIT);
  }
  persistServerLog(entry);
  return entry;
}

function logOpcError(context, err, extra = {}) {
  const detail = err instanceof Error ? err : new Error(String(err?.message || err || "Unknown OPC error"));
  appendServerLog(
    "error",
    `OPC: ${String(context || "error")}`,
    {
      ...extra,
      error: serializeLogMeta(detail),
    },
    "opc"
  );
}

const opcConnectionState = {
  seen: false,
  connected: null,
  activeConnections: "",
};

function getOpcConnectionSummary(status) {
  const safe = status && typeof status === "object" ? status : {};
  const explicitConnected = safe.connected === true;
  const connections =
    safe.connections && typeof safe.connections === "object" ? safe.connections : {};
  const activeConnections = Object.entries(connections)
    .filter(([, value]) => value === true)
    .map(([name]) => String(name || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const runtimeTargets = Array.isArray(safe?.runtime?.plcTargets) ? safe.runtime.plcTargets : [];
  const runtimeConnectedTargets = runtimeTargets
    .filter((row) => row && typeof row === "object" && row.connected === true)
    .map((row) => String(row?.name || row?.host || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const connected =
    explicitConnected || activeConnections.length > 0 || runtimeConnectedTargets.length > 0;
  return {
    connected,
    activeConnections,
    runtimeConnectedTargets,
  };
}

function maybeLogOpcConnectionState(status) {
  const summary = getOpcConnectionSummary(status);
  const activeKey = JSON.stringify({
    activeConnections: summary.activeConnections,
    runtimeConnectedTargets: summary.runtimeConnectedTargets,
  });
  const shouldLogDisconnected =
    !summary.connected &&
    (!opcConnectionState.seen ||
      opcConnectionState.connected !== false ||
      opcConnectionState.activeConnections !== activeKey);
  const shouldLogConnected =
    summary.connected &&
    (!opcConnectionState.seen || opcConnectionState.connected !== true);

  if (shouldLogDisconnected) {
    appendServerLog(
      "warn",
      "OPC: no active connection",
      {
        activeConnections: summary.activeConnections,
        runtimeConnectedTargets: summary.runtimeConnectedTargets,
      },
      "opc"
    );
  } else if (shouldLogConnected) {
    appendServerLog(
      "info",
      "OPC: connection restored",
      {
        activeConnections: summary.activeConnections,
        runtimeConnectedTargets: summary.runtimeConnectedTargets,
      },
      "opc"
    );
  }

  opcConnectionState.seen = true;
  opcConnectionState.connected = summary.connected;
  opcConnectionState.activeConnections = activeKey;
}

function truncateString(value, maxLen) {
  const text = String(value == null ? "" : value);
  if (!Number.isFinite(maxLen) || maxLen <= 0) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1))}\u2026`;
}

function sanitizeClientLogBody(body = {}) {
  const levelRaw = String(body?.level || "error").trim().toLowerCase();
  const level = ["debug", "info", "warn", "error"].includes(levelRaw) ? levelRaw : "error";
  const message = truncateString(body?.message || "Client log", CLIENT_LOG_MESSAGE_MAX);
  const source = truncateString(body?.source || "client", CLIENT_LOG_SOURCE_MAX);
  let meta = {};
  if (body?.meta !== undefined) {
    meta = serializeLogMeta(body.meta);
  } else if (body?.error !== undefined) {
    meta = serializeLogMeta(body.error);
  }
  let metaText = "";
  try {
    metaText = JSON.stringify(meta);
  } catch {
    metaText = "{\"note\":\"meta_unserializable\"}";
  }
  if (metaText.length > CLIENT_LOG_META_MAX) {
    meta = { note: "meta_truncated", preview: metaText.slice(0, CLIENT_LOG_META_MAX) };
  }
  const explicitCategory = normalizeLogCategory(body?.category);
  const category = explicitCategory || inferLogCategory(message, source, meta);
  const explicitDataType = String(body?.data_type ?? body?.dataType ?? "").trim().toLowerCase();
  const dataType = LOG_DATA_TYPE_VALUES.has(explicitDataType)
    ? explicitDataType
    : inferLogDataType(message, meta);
  return { level, message, source, meta, category, dataType };
}

const origConsoleError = console.error.bind(console);
const origConsoleWarn = console.warn.bind(console);
console.error = (...args) => {
  const [head, ...rest] = args;
  appendServerLog("error", String(head ?? "console.error"), rest.length ? { args: rest } : {});
  origConsoleError(...args);
};
console.warn = (...args) => {
  const [head, ...rest] = args;
  appendServerLog("warn", String(head ?? "console.warn"), rest.length ? { args: rest } : {});
  origConsoleWarn(...args);
};
process.on("uncaughtException", (err) => {
  appendServerLog("error", String(err?.message || "uncaughtException"), err, "process");
});
process.on("unhandledRejection", (reason) => {
  appendServerLog("error", "unhandledRejection", reason, "process");
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use((err, _req, res, next) => {
  if (err?.type === "entity.too.large") {
    appendServerLog("warn", "Request payload too large", {
      limit: JSON_BODY_LIMIT,
      type: String(err?.type || ""),
    });
    res
      .status(413)
      .json({ error: `Request payload too large. Increase JSON_BODY_LIMIT (current ${JSON_BODY_LIMIT}).` });
    return;
  }
  next(err);
});

if (FRONTEND_DIST_DIR && fs.existsSync(FRONTEND_INDEX_PATH)) {
  app.use(
    express.static(FRONTEND_DIST_DIR, {
      index: false,
      maxAge: "1h",
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    if (req.method !== "GET") return next();
    if (path.extname(req.path)) return next();
    res.sendFile(FRONTEND_INDEX_PATH, (err) => {
      if (err) next(err);
    });
  });
}

function normalizeDbClient(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "sqlserver" || raw === "mssql") return "sqlserver";
  return "postgres";
}

function deriveTrendDatabaseUrl(primaryUrl) {
  const raw = String(primaryUrl || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const dbName = String(url.pathname || "").replace(/^\//, "").trim();
    if (!dbName) return raw;
    const nextName = dbName.toLowerCase().endsWith("_trend") || dbName.toLowerCase().endsWith("_trends")
      ? dbName
      : `${dbName}_trends`;
    url.pathname = `/${nextName}`;
    return url.toString();
  } catch {
    return raw;
  }
}

function deriveLogDatabaseUrl(primaryUrl) {
  const raw = String(primaryUrl || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const dbName = String(url.pathname || "").replace(/^\//, "").trim();
    if (!dbName) return raw;
    const nextName = dbName.toLowerCase().endsWith("_log") || dbName.toLowerCase().endsWith("_logs")
      ? dbName
      : `${dbName}_logs`;
    url.pathname = `/${nextName}`;
    return url.toString();
  } catch {
    return raw;
  }
}

let DB_CLIENT = normalizeDbClient(process.env.DB_CLIENT || "postgres");
let DATABASE_URL = process.env.DATABASE_URL || "";
let DB_POOL_MAX = Math.max(1, Number.parseInt(String(process.env.DB_POOL_MAX || "10"), 10) || 10);
const TREND_DATABASE_URL_FROM_ENV = String(process.env.TREND_DATABASE_URL || "").trim();
let TREND_DATABASE_URL = TREND_DATABASE_URL_FROM_ENV || deriveTrendDatabaseUrl(DATABASE_URL);
const TREND_DATABASE_URL_IS_DERIVED = !TREND_DATABASE_URL_FROM_ENV;
let TREND_DB_POOL_MAX = Math.max(
  1,
  Number.parseInt(String(process.env.TREND_DB_POOL_MAX || process.env.DB_POOL_MAX || "10"), 10) || 10
);
const LOG_DATABASE_URL_FROM_ENV = String(process.env.LOG_DATABASE_URL || "").trim();
let LOG_DATABASE_URL = LOG_DATABASE_URL_FROM_ENV || deriveLogDatabaseUrl(DATABASE_URL);
const LOG_DATABASE_URL_IS_DERIVED = !LOG_DATABASE_URL_FROM_ENV;
let LOG_DB_POOL_MAX = Math.max(
  1,
  Number.parseInt(String(process.env.LOG_DB_POOL_MAX || process.env.DB_POOL_MAX || "10"), 10) || 10
);
const DB_POOL_MAX_LISTENERS = Math.max(
  20,
  Number.parseInt(String(process.env.DB_POOL_MAX_LISTENERS || "100"), 10) || 100
);
const APP_PACKAGE_JSON_PATH = path.resolve(REPO_ROOT, "package.json");
const APP_VERSION = (() => {
  const envVersion = String(process.env.APP_VERSION || "").trim();
  if (envVersion) return envVersion;
  try {
    const text = String(fs.readFileSync(APP_PACKAGE_JSON_PATH, "utf8") || "").trim();
    const parsed = text ? JSON.parse(text) : {};
    const pkgVersion = String(parsed?.version || "").trim();
    return pkgVersion || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
const EXPECTED_DB_VERSION = String(process.env.DB_SCHEMA_VERSION || APP_VERSION).trim() || APP_VERSION;
const AUTO_ALIGN_DB_VERSION = String(process.env.AUTO_ALIGN_DB_VERSION || "true").trim().toLowerCase() !== "false";
let lastAppCpuSample = null;
let lastHostCpuSample = null;

function readHostCpuTotals() {
  const cpus = Array.isArray(os.cpus()) ? os.cpus() : [];
  let idle = 0;
  let total = 0;
  cpus.forEach((cpu) => {
    const times = cpu?.times && typeof cpu.times === "object" ? cpu.times : {};
    const user = Number(times.user || 0);
    const nice = Number(times.nice || 0);
    const sys = Number(times.sys || 0);
    const irq = Number(times.irq || 0);
    const id = Number(times.idle || 0);
    idle += id;
    total += user + nice + sys + irq + id;
  });
  return { idle, total, cores: cpus.length };
}

function computeHostCpuUsagePct(nowMs) {
  const current = readHostCpuTotals();
  let pct = null;
  if (lastHostCpuSample && Number.isFinite(lastHostCpuSample.total) && Number.isFinite(lastHostCpuSample.idle)) {
    const deltaTotal = current.total - Number(lastHostCpuSample.total);
    const deltaIdle = current.idle - Number(lastHostCpuSample.idle);
    if (deltaTotal > 0 && deltaIdle >= 0) {
      pct = ((deltaTotal - deltaIdle) / deltaTotal) * 100;
    }
  }
  lastHostCpuSample = { at: nowMs, idle: current.idle, total: current.total, cores: current.cores };
  return {
    pct: Number.isFinite(pct) ? Number(pct.toFixed(1)) : null,
    cores: Number.isFinite(current.cores) ? current.cores : null,
  };
}

function computeAppCpuUsagePct(nowMs, cpuUsageMicro) {
  const user = Number(cpuUsageMicro?.user || 0);
  const system = Number(cpuUsageMicro?.system || 0);
  const totalMicro = user + system;
  const cores = Math.max(1, Number(os.cpus()?.length || 1));
  let pct = null;
  if (
    lastAppCpuSample &&
    Number.isFinite(lastAppCpuSample.totalMicro) &&
    Number.isFinite(lastAppCpuSample.at) &&
    nowMs > Number(lastAppCpuSample.at)
  ) {
    const deltaMicro = totalMicro - Number(lastAppCpuSample.totalMicro);
    const elapsedMs = nowMs - Number(lastAppCpuSample.at);
    if (deltaMicro >= 0 && elapsedMs > 0) {
      pct = (deltaMicro / (elapsedMs * 1000 * cores)) * 100;
    }
  }
  lastAppCpuSample = { at: nowMs, totalMicro };
  return Number.isFinite(pct) ? Number(pct.toFixed(1)) : null;
}

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
  if (DB_CLIENT === "sqlserver") {
    const host = String(process.env.DB_SQLSERVER_HOST || "").trim();
    const port = Number.parseInt(String(process.env.DB_SQLSERVER_PORT || "1433"), 10);
    const database = String(process.env.DB_SQLSERVER_DATABASE || "").trim();
    const user = String(process.env.DB_SQLSERVER_USER || "").trim();
    const encrypt = ["1", "true", "yes", "on"].includes(
      String(process.env.DB_SQLSERVER_ENCRYPT || "true").trim().toLowerCase()
    );
    const trustServerCertificate = ["1", "true", "yes", "on"].includes(
      String(process.env.DB_SQLSERVER_TRUST_SERVER_CERTIFICATE || "true")
        .trim()
        .toLowerCase()
    );
    const applicationName = String(process.env.DB_SQLSERVER_APP_NAME || "").trim();
    const passwordSet = String(process.env.DB_SQLSERVER_PASSWORD || "").trim().length > 0;
    const configured = !!(host && database && user && Number.isFinite(port));
    return {
      configured,
      protocol: "sqlserver",
      host,
      port: Number.isFinite(port) ? port : 1433,
      database,
      user,
      ssl: encrypt,
      sslMode: encrypt ? "encrypt" : "",
      applicationName,
      trustServerCertificate,
      passwordSet,
    };
  }
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

async function ensureDatabaseExists(connectionString = DATABASE_URL) {
  if (DB_CLIENT !== "postgres") return;
  if (!connectionString) return;
  const url = new URL(connectionString);
  const dbName = url.pathname.replace("/", "");
  if (!dbName) return;

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = "/postgres";

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  if (typeof adminPool.setMaxListeners === "function") {
    adminPool.setMaxListeners(DB_POOL_MAX_LISTENERS);
  }
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
let trendPool = null;
let logPool = null;
let opcTagScaleCache = { loadedAt: 0, map: new Map() };
let opcTagMetaCache = { loadedAt: 0, map: new Map() };
let serviceControlLocked = false;

const SESSION_COOKIE = "vizi_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MS_OAUTH_STATE_COOKIE = "vizi_ms_oauth_state";
const MS_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
let MS_OAUTH_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.MS_OAUTH_ENABLED || "1").trim().toLowerCase()
);
let MS_OAUTH_TENANT = String(process.env.MS_OAUTH_TENANT || "common").trim() || "common";
let MS_OAUTH_CLIENT_ID = String(process.env.MS_OAUTH_CLIENT_ID || "").trim();
let MS_OAUTH_CLIENT_SECRET = String(process.env.MS_OAUTH_CLIENT_SECRET || "");
let MS_OAUTH_REDIRECT_URI = String(process.env.MS_OAUTH_REDIRECT_URI || "").trim();
let MS_OAUTH_SCOPES = String(process.env.MS_OAUTH_SCOPES || "openid profile email User.Read")
  .trim()
  .replace(/\s+/g, " ");
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
const PROJECT_VERSION_KEEP_PER_PROJECT = Math.max(
  10,
  Number.parseInt(process.env.PROJECT_VERSION_KEEP_PER_PROJECT || "25", 10) || 25
);
const PROJECT_VERSION_MIN_INTERVAL_MS = Math.max(
  1000,
  Number.parseInt(process.env.PROJECT_VERSION_MIN_INTERVAL_MS || "30000", 10) || 30000
);
const PROJECT_VERSION_MAINTENANCE_MS = Math.max(
  30000,
  Number.parseInt(process.env.PROJECT_VERSION_MAINTENANCE_MS || "300000", 10) || 300000
);
const PROJECT_VERSION_COMPACT_BATCH = Math.max(
  1,
  Number.parseInt(process.env.PROJECT_VERSION_COMPACT_BATCH || "12", 10) || 12
);
const PROJECT_VERSION_CODEC = "json-gzip-v1";
const PROJECT_VERSION_KEEP_MIN_PER_PROJECT = Math.max(
  1,
  Math.min(
    PROJECT_VERSION_KEEP_PER_PROJECT,
    Number.parseInt(process.env.PROJECT_VERSION_KEEP_MIN_PER_PROJECT || "8", 10) || 8
  )
);
const PROJECT_VERSION_KEEP_BYTES_PER_PROJECT = Math.max(
  8 * 1024 * 1024,
  Number.parseInt(
    process.env.PROJECT_VERSION_KEEP_BYTES_PER_PROJECT || `${128 * 1024 * 1024}`,
    10
  ) || 128 * 1024 * 1024
);
const TREND_CODEC = "json-gzip-v1";
const TREND_CHUNK_TABLE_BASE = "opc_tag_trend_chunks";
const TREND_CHUNK_TABLE_MONTH_RE = /^opc_tag_trend_chunks_\d{6}$/;
const TREND_TABLE_CACHE_MS = 30_000;
const DB_BACKUP_DIR = path.resolve(AI_SERVER_DIR, "backups", "database");
const DB_BACKUP_REDUNDANT_DIR = path.resolve(AI_SERVER_DIR, "backups", "database_redundant");
const DB_BACKUP_DEFAULTS = Object.freeze({
  enabled: false,
  intervalMinutes: 1440,
  keepBackups: 30,
  includeTrendDb: true,
  redundancyEnabled: false,
  redundancyCopies: 1,
  lastRunAt: 0,
});
const trendBuffers = new Map();
let trendLastCleanupAt = 0;
let trendTagConfigCache = { loadedAt: 0, map: null };
let trendChunkTableCache = { loadedAt: 0, tables: [] };
let dbBackupState = { ...DB_BACKUP_DEFAULTS };
let dbBackupTimer = null;
let dbBackupInFlight = false;
let projectVersionMaintenanceInFlight = false;
let dbMaintenanceInFlight = false;
const DB_MAINTENANCE_MS = Math.max(
  30_000,
  Number.parseInt(process.env.DB_MAINTENANCE_MS || `${5 * 60 * 1000}`, 10) || 5 * 60 * 1000
);
const SUPPORT_CHAT_RETENTION_MS = Math.max(
  24 * 60 * 60 * 1000,
  Number.parseInt(process.env.SUPPORT_CHAT_RETENTION_MS || `${90 * 24 * 60 * 60 * 1000}`, 10) ||
    90 * 24 * 60 * 60 * 1000
);
const SUPPORT_CHAT_MAX_ROWS = Math.max(
  1000,
  Number.parseInt(process.env.SUPPORT_CHAT_MAX_ROWS || "50000", 10) || 50000
);
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
const AUTOMATION_RULE_CACHE_MS = Math.max(
  1000,
  Number.parseInt(String(process.env.AUTOMATION_RULE_CACHE_MS || "2000"), 10) || 2000
);
const AUTOMATION_DB_POLL_MS = Math.max(
  1000,
  Number.parseInt(String(process.env.AUTOMATION_DB_POLL_MS || "5000"), 10) || 5000
);
let automationRuleCacheAt = 0;
let automationRuleCacheRows = [];
let automationDbPollInFlight = false;

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
  const cached = getOpcStatusFromCache();
  if (cached && Object.keys(cached).length) return cached;
  const row = await loadPersistedOpcStatusRow();
  if (!row?.status || typeof row.status !== "object") {
    return { at: Date.now(), connected: false, connections: {}, values: {}, errors: {}, qualities: {}, diagnostics: {} };
  }
  return row.status;
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

function hydratePlcDebugSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  const session = {
    id: String(raw.id || "").trim(),
    plcName: String(raw.plcName || "").trim() || "PLC",
    watchTags: normalizeDebugTagList(raw.watchTags || [], PLC_DEBUG_MAX_WATCH_TAGS),
    routineHints: normalizeDebugTagList(raw.routineHints || [], 32),
    controllerTags: normalizeDebugTagList(raw.controllerTags || [], 300),
    pollMs: Math.max(1000, Number.parseInt(String(raw.pollMs || PLC_DEBUG_SESSION_POLL_MS), 10) || PLC_DEBUG_SESSION_POLL_MS),
    createdAt: Number(raw.createdAt || 0) || Date.now(),
    updatedAt: Number(raw.updatedAt || 0) || 0,
    lastTouchedAt: Number(raw.lastTouchedAt || 0) || Date.now(),
    lastRefreshAt: Number(raw.lastRefreshAt || 0) || 0,
    lastError: String(raw.lastError || ""),
    snapshot: raw.snapshot && typeof raw.snapshot === "object" ? raw.snapshot : null,
  };
  if (!session.id) return null;
  return session;
}

async function loadPlcDebugSessionFromStore(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  try {
    const { rows } = await pool.query(
      "SELECT session_data FROM plc_debug_session WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!rows.length) return null;
    return hydratePlcDebugSession(rows[0]?.session_data || null);
  } catch {
    return null;
  }
}

async function upsertPlcDebugSessionInStore(session) {
  const payload = serializePlcDebugSession(session);
  if (!payload?.id) return;
  const sessionData = {
    ...payload,
    controllerTags: Array.isArray(session?.controllerTags) ? session.controllerTags : [],
    lastRefreshAt: Number(session?.lastRefreshAt || 0) || 0,
  };
  await pool.query(
    `
      INSERT INTO plc_debug_session (id, session_data, updated_at, last_touched_at)
      VALUES ($1, $2::jsonb, now(), to_timestamp($3::double precision / 1000.0))
      ON CONFLICT (id) DO UPDATE
      SET
        session_data = EXCLUDED.session_data,
        updated_at = now(),
        last_touched_at = EXCLUDED.last_touched_at
    `,
    [payload.id, JSON.stringify(sessionData), Number(sessionData.lastTouchedAt || Date.now())]
  );
}

async function deletePlcDebugSessionFromStore(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return;
  await pool.query("DELETE FROM plc_debug_session WHERE id = $1", [id]);
}

async function deleteExpiredPlcDebugSessionsFromStore(maxAgeMs = PLC_DEBUG_SESSION_TTL_MS) {
  const ttlMs = Math.max(60_000, Number(maxAgeMs || PLC_DEBUG_SESSION_TTL_MS) || PLC_DEBUG_SESSION_TTL_MS);
  await pool.query(
    "DELETE FROM plc_debug_session WHERE last_touched_at < now() - (($1::bigint || ' milliseconds')::interval)",
    [ttlMs]
  );
}

async function getPlcDebugSession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const session = plcDebugSessions.get(id);
  if (session) {
    session.lastTouchedAt = Date.now();
    return session;
  }
  const fromStore = await loadPlcDebugSessionFromStore(id);
  if (!fromStore) return null;
  fromStore.lastTouchedAt = Date.now();
  plcDebugSessions.set(id, fromStore);
  return fromStore;
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
        await deletePlcDebugSessionFromStore(id).catch(() => {});
        continue;
      }
      const pollMs = Math.max(1000, Number(session.pollMs || PLC_DEBUG_SESSION_POLL_MS));
      if (now - Number(session.lastRefreshAt || 0) < pollMs) continue;
      session.lastRefreshAt = now;
      await refreshPlcDebugSession(session);
      await upsertPlcDebugSessionInStore(session).catch(() => {});
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

function extractXmlAttr(attrText, name) {
  if (!attrText) return "";
  const dq = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
  const dm = String(attrText).match(dq);
  if (dm) return String(dm[1] || "").trim();
  const sq = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i");
  const sm = String(attrText).match(sq);
  if (sm) return String(sm[1] || "").trim();
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i");
  const bm = String(attrText).match(bare);
  return bm ? String(bm[1] || "").trim() : "";
}

function filterRouteMembersToRouteLikeXml(dataTypeBlockText) {
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
  let out = String(dataTypeBlockText || "");
  out = out.replace(/<Member\b([^>]*)\/>/gi, (full, attrs) => {
    const dt = extractXmlAttr(String(attrs || ""), "DataType");
    return keepDataType(dt) ? full : "";
  });
  out = out.replace(/<Member\b([^>]*)>[\s\S]*?<\/Member>/gi, (full, attrs) => {
    const dt = extractXmlAttr(String(attrs || ""), "DataType");
    return keepDataType(dt) ? full : "";
  });
  return out;
}

function extractRouteOnlyDataTypeBlocks(rawL5xText) {
  const src = String(rawL5xText || "");
  if (!src) return [];
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
  ];
  const inferMembersFromDecoratedData = (typeName) => {
    const wanted = String(typeName || "").trim().toLowerCase();
    if (!wanted) return [];
    const members = new Map();
    const structRe = /<Structure\b([^>]*)>([\s\S]*?)<\/Structure>/gi;
    let sm = structRe.exec(src);
    while (sm) {
      const attrs = String(sm[1] || "");
      const body = String(sm[2] || "");
      const dt = extractXmlAttr(attrs, "DataType");
      if (String(dt || "").trim().toLowerCase() !== wanted) {
        sm = structRe.exec(src);
        continue;
      }
      const memberRe = /<DataValueMember\b([^>]*)\/>/gi;
      let mm = memberRe.exec(body);
      while (mm) {
        const ma = String(mm[1] || "");
        const name = extractXmlAttr(ma, "Name");
        const dataType = extractXmlAttr(ma, "DataType") || "DINT";
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
    if (/^route1data(?:_|$)/i.test(value)) return true;
    if (/^route_/i.test(value)) return true;
    if (/^batchcontrol$/i.test(value)) return true;
    return /^batchcontrol_/i.test(value);
  };
  const routeBlocks = [];
  const re = /<DataType\b[\s\S]*?<\/DataType>/gi;
  let match = re.exec(src);
  while (match) {
    const block = String(match[0] || "");
    const headMatch = block.match(/<DataType\b([^>]*)>/i);
    const name = headMatch ? extractXmlAttr(String(headMatch[1] || ""), "Name") : "";
    const lower = String(name || "").trim();
    if (!isRouteTemplateTypeName(lower)) {
      match = re.exec(src);
      continue;
    }
    routeBlocks.push(filterRouteMembersToRouteLikeXml(block));
    match = re.exec(src);
  }
  const dedup = new Map();
  routeBlocks.forEach((block) => {
    const headMatch = String(block || "").match(/<DataType\b([^>]*)>/i);
    const name = headMatch ? extractXmlAttr(String(headMatch[1] || ""), "Name") : "";
    const key = String(name || "").trim().toLowerCase();
    if (!key) return;
    dedup.set(key, String(block || ""));
  });
  REQUIRED_ROUTE_GENERIC_TYPES.forEach((typeName) => {
    const key = String(typeName || "").trim().toLowerCase();
    if (!key || dedup.has(key)) return;
    dedup.set(key, makeGenericRouteTypeBlock(typeName));
  });
  REQUIRED_BATCHCONTROL_TYPES.forEach((typeName) => {
    const key = String(typeName || "").trim().toLowerCase();
    if (!key || dedup.has(key)) return;
    dedup.set(key, makeGenericRouteTypeBlock(typeName));
  });
  return Array.from(dedup.values());
}

function buildRouteStarterTemplateFromL5x(rawL5xText) {
  const src = String(rawL5xText || "");
  if (!/<RSLogix5000Content\b/i.test(src)) return src;
  const rsAttrs = String((src.match(/<RSLogix5000Content\b([^>]*)>/i) || [])[1] || "").trim();
  const controllerAttrs = String((src.match(/<Controller\b([^>]*)>/i) || [])[1] || "").trim();
  const routeDataTypeBlocks = extractRouteOnlyDataTypeBlocks(src);
  const dataTypeBody = routeDataTypeBlocks
    .map((block) =>
      String(block || "")
        .split(/\r?\n/)
        .map((line) => `      ${line}`)
        .join("\n")
    )
    .join("\n");
  const rsOpen = rsAttrs
    ? `<RSLogix5000Content ${rsAttrs}>`
    : '<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="35.00" TargetName="CodeGenStarter" TargetType="Controller" ContainsContext="true">';
  const ctrlOpen = controllerAttrs
    ? `  <Controller ${controllerAttrs}>`
    : '  <Controller Name="CodeGenStarter" ProcessorType="1756-L8x" MajorRev="35" MinorRev="11">';
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    rsOpen,
    ctrlOpen,
    '    <RedundancyInfo Enabled="false"/>',
    '    <Security Code="0"/>',
    dataTypeBody ? "    <DataTypes>" : "    <DataTypes/>",
    dataTypeBody,
    dataTypeBody ? "    </DataTypes>" : "",
    "    <Modules/>",
    "    <AddOnInstructionDefinitions/>",
    "    <Tags/>",
    "    <Programs>",
    '      <Program Name="MainProgram" TestEdits="false" Disabled="false" MainRoutineName="MainRoutine">',
    "        <Tags/>",
    "        <Routines>",
    '          <Routine Name="MainRoutine" Type="RLL">',
    "            <RLLContent/>",
    "          </Routine>",
    "        </Routines>",
    "      </Program>",
    "    </Programs>",
    "    <Tasks>",
    '      <Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">',
    "        <ScheduledPrograms>",
    '          <ScheduledProgram Name="MainProgram"/>',
    "        </ScheduledPrograms>",
    "      </Task>",
    "    </Tasks>",
    "  </Controller>",
    "</RSLogix5000Content>",
  ]
    .filter((line) => line !== "")
    .join("\n");
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

async function loadOpcTagMetaMap() {
  const now = Date.now();
  if (opcTagMetaCache.map instanceof Map && now - Number(opcTagMetaCache.loadedAt || 0) <= 5000) {
    return opcTagMetaCache.map;
  }
  const cfg = await loadOpcConfigFromStore();
  const tags = Array.isArray(cfg?.tags) ? cfg.tags : [];
  const map = new Map();
  tags.forEach((t) => {
    const topic = String(t?.topic || "").trim();
    const resolvedTopic = topic || "Default";
    const name = String(t?.name || "").trim();
    const tagPath = String(t?.tagPath || name).trim();
    const scaleRaw = Number(t?.scale);
    const scale = Number.isFinite(scaleRaw) && scaleRaw !== 0 ? scaleRaw : null;
    const trendEnabled = t?.trendEnabled === true;
    const meta = {
      scale,
      trendEnabled,
      trendMode: trendEnabled ? normalizeTrendMode(t?.trendMode) : "value",
      trendSampleMs: trendEnabled
        ? Math.max(1000, Number.parseInt(String(t?.trendSampleMs || ""), 10) || 0) || null
        : null,
    };
    const candidates = [
      resolvedTopic && tagPath ? `${resolvedTopic}.${tagPath}` : "",
      resolvedTopic && name ? `${resolvedTopic}.${name}` : "",
      topic ? "" : tagPath,
      topic ? "" : name,
      tagPath,
      name,
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    candidates.forEach((candidate) => {
      map.set(candidate, meta);
    });
  });
  opcTagMetaCache = { loadedAt: now, map };
  return map;
}

async function getOpcTagMetaByKeys(...keys) {
  const map = await loadOpcTagMetaMap();
  for (const key of keys) {
    const normalized = String(key || "").trim().toLowerCase();
    if (!normalized) continue;
    if (map.has(normalized)) return map.get(normalized) || null;
  }
  return null;
}

async function getOpcTagScaleByKeys(...keys) {
  const now = Date.now();
  if (!(opcTagScaleCache.map instanceof Map) || now - Number(opcTagScaleCache.loadedAt || 0) > 5000) {
    const metaMap = await loadOpcTagMetaMap();
    const map = new Map();
    if (metaMap instanceof Map) {
      metaMap.forEach((meta, key) => {
        const scale = Number(meta?.scale);
        if (!Number.isFinite(scale) || scale === 0) return;
        map.set(String(key || "").trim().toLowerCase(), scale);
      });
    }
    opcTagScaleCache = { loadedAt: now, map };
  }
  for (const key of keys) {
    const k = String(key || "").trim().toLowerCase();
    if (!k) continue;
    if (opcTagScaleCache.map.has(k)) return Number(opcTagScaleCache.map.get(k));
  }
  return null;
}

async function saveOpcConfigToStore(config) {
  const next = config && typeof config === "object" ? config : { ...DEFAULT_OPC_CONFIG };
  await pool.query(
    "INSERT INTO opc_config (id, config) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()",
    [JSON.stringify(next)]
  );
  trendTagConfigCache = { loadedAt: 0, map: null };
  opcTagScaleCache = { loadedAt: 0, map: new Map() };
  opcTagMetaCache = { loadedAt: 0, map: new Map() };
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
    const metaMap = await loadOpcTagMetaMap();
    const map = new Map();
    if (metaMap instanceof Map) {
      metaMap.forEach((meta, key) => {
        if (meta?.trendEnabled !== true) return;
        map.set(String(key || "").trim(), {
          trendMode: meta?.trendMode || "value",
          trendSampleMs: meta?.trendSampleMs || null,
        });
      });
    }
    trendTagConfigCache = { loadedAt: now, map };
    return map;
  } catch {
    trendTagConfigCache = { loadedAt: now, map: null };
    return null;
  }
}

function getTrendMonthKey(ts) {
  const at = normalizeTrendTimestamp(ts);
  const d = new Date(at);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

function getTrendChunkTableNameForTimestamp(ts) {
  return `${TREND_CHUNK_TABLE_BASE}_${getTrendMonthKey(ts)}`;
}

function isTrendChunkTableName(tableName) {
  const name = String(tableName || "").trim().toLowerCase();
  return name === TREND_CHUNK_TABLE_BASE || TREND_CHUNK_TABLE_MONTH_RE.test(name);
}

function quoteTrendChunkTable(tableName) {
  const name = String(tableName || "").trim().toLowerCase();
  if (!isTrendChunkTableName(name)) {
    throw new Error("Invalid trend table name.");
  }
  return quoteIdent(name);
}

async function ensureTrendChunkTable(trendDb, tableName) {
  if (!trendDb) return null;
  const name = String(tableName || "").trim().toLowerCase();
  if (!isTrendChunkTableName(name)) {
    throw new Error("Invalid trend table name.");
  }
  const quotedTable = quoteTrendChunkTable(name);
  await trendDb.query(`
    CREATE TABLE IF NOT EXISTS ${quotedTable} (
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
  const tagToIdx = `${name}_tag_to_idx`;
  const toIdx = `${name}_to_idx`;
  await trendDb.query(`
    CREATE INDEX IF NOT EXISTS ${quoteIdent(tagToIdx)}
    ON ${quotedTable}(tag_key, to_ts DESC);
  `);
  await trendDb.query(`
    CREATE INDEX IF NOT EXISTS ${quoteIdent(toIdx)}
    ON ${quotedTable}(to_ts DESC);
  `);
  trendChunkTableCache = { loadedAt: 0, tables: [] };
  return name;
}

async function listTrendChunkTables(trendDb, options = {}) {
  if (!trendDb) return [];
  const refresh = options?.refresh === true;
  const includeLegacy = options?.includeLegacy !== false;
  const now = Date.now();
  if (
    !refresh &&
    Array.isArray(trendChunkTableCache.tables) &&
    trendChunkTableCache.tables.length &&
    now - Number(trendChunkTableCache.loadedAt || 0) < TREND_TABLE_CACHE_MS
  ) {
    return trendChunkTableCache.tables;
  }
  const { rows } = await trendDb.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND (
        tablename = $1
        OR tablename LIKE $2
      )
  `, [TREND_CHUNK_TABLE_BASE, `${TREND_CHUNK_TABLE_BASE}_%`]);
  const names = rows
    .map((r) => String(r?.tablename || "").trim().toLowerCase())
    .filter((name) => isTrendChunkTableName(name));
  const out = [];
  if (includeLegacy && names.includes(TREND_CHUNK_TABLE_BASE)) {
    out.push(TREND_CHUNK_TABLE_BASE);
  }
  names
    .filter((name) => TREND_CHUNK_TABLE_MONTH_RE.test(name))
    .sort((a, b) => a.localeCompare(b))
    .forEach((name) => out.push(name));
  trendChunkTableCache = { loadedAt: now, tables: out };
  return out;
}

function buildTrendUnionSql(tableNames, selectColumns, whereSql = "") {
  const names = Array.isArray(tableNames) ? tableNames : [];
  const parts = names
    .map((name) => String(name || "").trim().toLowerCase())
    .filter((name) => isTrendChunkTableName(name))
    .map((name) => `SELECT ${selectColumns} FROM ${quoteTrendChunkTable(name)} ${whereSql}`.trim());
  return parts.join(" UNION ALL ");
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
  const trendDb = trendPool || pool;
  if (!trendDb) return;
  const targetTable = getTrendChunkTableNameForTimestamp(buffer.lastTs || buffer.baseTs);
  await ensureTrendChunkTable(trendDb, targetTable);
  await trendDb.query(
    `
    INSERT INTO ${quoteTrendChunkTable(targetTable)} (
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

function getPublicBaseUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  if (!host) return "";
  return `${proto}://${host}`;
}

function getMicrosoftRedirectUri(req) {
  if (MS_OAUTH_REDIRECT_URI) return MS_OAUTH_REDIRECT_URI;
  const base = getPublicBaseUrl(req);
  return base ? `${base}/api/auth/microsoft/callback` : "";
}

function isMicrosoftAuthConfigured() {
  return !!(MS_OAUTH_ENABLED && MS_OAUTH_CLIENT_ID && MS_OAUTH_CLIENT_SECRET);
}

async function loadBridgeStatusSnapshot() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPC_BRIDGE_STATUS_TIMEOUT_MS);
  try {
    const headers = {};
    if (OPC_SERVER_KEY) headers["x-opc-key"] = OPC_SERVER_KEY;
    const res = await fetch(`${OPC_WRITE_BRIDGE_URL}/internal/status`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Bridge status request failed (${res.status})`);
    }
    const data = await res.json().catch(() => ({}));
    return data && typeof data === "object" ? data : {};
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeAutomationTagKey(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeAutomationRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchAutomationTagPattern(patternValue, eventTagValue) {
  const pattern = String(patternValue || "").trim();
  const eventTag = String(eventTagValue || "").trim();
  if (!pattern || !eventTag) return { matched: false, base: "", captures: [] };
  if (!pattern.includes("*")) {
    return normalizeAutomationTagKey(pattern) === normalizeAutomationTagKey(eventTag)
      ? { matched: true, base: "", captures: [] }
      : { matched: false, base: "", captures: [] };
  }
  const regexText = `^${escapeAutomationRegex(pattern).replace(/\\\*/g, "(.+?)")}$`;
  const match = eventTag.match(new RegExp(regexText, "i"));
  if (!match) return { matched: false, base: "", captures: [] };
  const captures = match.slice(1).map((part) => String(part || ""));
  return {
    matched: true,
    base: String(captures[0] || ""),
    captures,
  };
}

function parseAutomationJson(rawValue, fallback) {
  if (rawValue == null || rawValue === "") return fallback;
  if (typeof rawValue === "object") return rawValue;
  try {
    return JSON.parse(String(rawValue));
  } catch {
    return fallback;
  }
}

function automationValuesEqual(left, right) {
  if (left === right) return true;
  const leftNum = toFiniteNumber(left);
  const rightNum = toFiniteNumber(right);
  if (leftNum != null && rightNum != null) return leftNum === rightNum;
  return JSON.stringify(left) === JSON.stringify(right);
}

function automationNumericDelta(left, right) {
  const leftNum = toFiniteNumber(left);
  const rightNum = toFiniteNumber(right);
  if (leftNum == null || rightNum == null) return null;
  return rightNum - leftNum;
}

function isAutomationTruthy(value) {
  if (value === true) return true;
  if (value === false || value == null) return false;
  if (typeof value === "number") return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (!text) return false;
  return text === "true" || text === "1" || text === "yes" || text === "on";
}

function evaluateAutomationOperator(left, operator, right) {
  const op = String(operator || "==").trim();
  if (op === "equals") return evaluateAutomationOperator(left, "==", right);
  if (op === "not_equals") return evaluateAutomationOperator(left, "!=", right);
  if (op === "contains" || op === "not_contains" || op === "starts_with" || op === "ends_with") {
    const leftText = String(left ?? "").trim().toLowerCase();
    const rightText = String(right ?? "").trim().toLowerCase();
    if (op === "contains") return leftText.includes(rightText);
    if (op === "not_contains") return !leftText.includes(rightText);
    if (op === "starts_with") return leftText.startsWith(rightText);
    return leftText.endsWith(rightText);
  }
  if (op === "changed") return !automationValuesEqual(left, right);
  if (op === "truthy") return isAutomationTruthy(left);
  if (op === "falsy") return !isAutomationTruthy(left);
  const leftNum = toFiniteNumber(left);
  const rightNum = toFiniteNumber(right);
  if (leftNum != null && rightNum != null) {
    if (op === "==") return leftNum === rightNum;
    if (op === "!=") return leftNum !== rightNum;
    if (op === ">") return leftNum > rightNum;
    if (op === ">=") return leftNum >= rightNum;
    if (op === "<") return leftNum < rightNum;
    if (op === "<=") return leftNum <= rightNum;
  }
  const leftText = String(left ?? "").trim().toLowerCase();
  const rightText = String(right ?? "").trim().toLowerCase();
  if (op === "==") return leftText === rightText;
  if (op === "!=") return leftText !== rightText;
  return false;
}

function extractAutomationRouteId(tagKey) {
  const raw = String(tagKey || "").trim();
  if (!raw) return "";
  const first = raw.split(".")[0] || "";
  const match = String(first).match(/^(route\d+)/i);
  return match ? String(match[1] || "") : "";
}

async function ruleScopeMatches(rule, event) {
  const routeScope = String(rule?.scopeRouteId || "").trim();
  const projectScope = String(rule?.scopeProjectId || "").trim();
  if (!routeScope && !projectScope) return true;
  const eventRouteId =
    extractAutomationRouteId(event?.tagKey) ||
    String(event?.row?.route_id || event?.row?.routeId || "").trim();
  if (routeScope && String(routeScope).toLowerCase() !== String(eventRouteId).toLowerCase()) return false;
  if (!projectScope) return true;
  if (!eventRouteId) return false;
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM route
    WHERE lower(route_id) = lower($1) AND project_id = $2
    LIMIT 1
    `,
    [eventRouteId, projectScope]
  );
  return rows.length > 0;
}

function applyAutomationTemplate(value, context) {
  if (Array.isArray(value)) return value.map((entry) => applyAutomationTemplate(entry, context));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, applyAutomationTemplate(entry, context)])
    );
  }
  if (typeof value !== "string") return value;
  return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => {
    const resolved = String(key || "").split(".").reduce((acc, part) => {
      if (acc == null || typeof acc !== "object") return undefined;
      return acc[part];
    }, context);
    if (resolved == null) return "";
    if (typeof resolved === "object") return JSON.stringify(resolved);
    return String(resolved);
  });
}

function buildAutomationValueContext(event) {
  const captures = Array.isArray(event?.captures) ? event.captures : [];
  const delta = automationNumericDelta(event?.previousValue, event?.nextValue);
  return {
    trigger_type: String(event?.triggerType || "tag"),
    tag: String(event?.tagKey || ""),
    trigger_tag: String(event?.tagKey || ""),
    base: String(event?.base || ""),
    base_tag: String(event?.base || ""),
    wildcard_1: String(captures[0] || ""),
    wildcard_2: String(captures[1] || ""),
    wildcard_3: String(captures[2] || ""),
    value: event?.nextValue ?? "",
    current_value: event?.nextValue ?? "",
    previous_value: event?.previousValue ?? "",
    prev_value: event?.previousValue ?? "",
    delta: delta ?? "",
    counter_delta: delta ?? "",
    quality: String(event?.quality || ""),
    db_value: event?.nextValue ?? "",
    db_previous_value: event?.previousValue ?? "",
    row: event?.row && typeof event.row === "object" ? event.row : {},
    db_row: event?.row && typeof event.row === "object" ? event.row : {},
    now_ms: String(event?.at || Date.now()),
    now_iso: new Date(Number(event?.at || Date.now())).toISOString(),
  };
}

async function loadCurrentOpcStatus() {
  const cached = getOpcStatusFromCache();
  if (cached && Object.keys(cached).length) return cached;
  const row = await loadPersistedOpcStatusRow();
  return row?.status && typeof row.status === "object" ? row.status : {};
}

function getAutomationContextValue(context, pathValue) {
  const path = String(pathValue || "").trim();
  if (!path) return undefined;
  return path.split(".").reduce((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return acc[part];
  }, context);
}

async function loadEnabledAutomationRules(force = false) {
  const now = Date.now();
  if (!force && now - automationRuleCacheAt < AUTOMATION_RULE_CACHE_MS) return automationRuleCacheRows;
  const { rows } = await pool.query(
    `
    SELECT *
    FROM automation_rule
    WHERE enabled = true
    ORDER BY id
    `
  );
  automationRuleCacheRows = Array.isArray(rows) ? rows : [];
  automationRuleCacheAt = now;
  return automationRuleCacheRows;
}

async function logAutomationRuleRun({
  ruleId,
  ruleName,
  triggerTag,
  previousValue,
  currentValue,
  status = "ok",
  message = "",
  actionResults = [],
}) {
  try {
    await pool.query(
      `
      INSERT INTO automation_rule_run
      (rule_id, rule_name, trigger_tag, previous_value, current_value, status, message, action_results)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        ruleId == null ? null : Number(ruleId),
        String(ruleName || ""),
        String(triggerTag || ""),
        previousValue == null ? null : JSON.stringify(previousValue),
        currentValue == null ? null : JSON.stringify(currentValue),
        String(status || "ok"),
        String(message || ""),
        JSON.stringify(Array.isArray(actionResults) ? actionResults : []),
      ]
    );
  } catch {
    // logging is best effort
  }
}

function setSessionCookie(res, token, ttlMs = SESSION_TTL_MS) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
      ttlMs / 1000
    )}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function appendSetCookie(res, cookieValue) {
  const current = res.getHeader("Set-Cookie");
  if (!current) {
    res.setHeader("Set-Cookie", [cookieValue]);
    return;
  }
  const list = Array.isArray(current) ? current.slice() : [String(current)];
  list.push(cookieValue);
  res.setHeader("Set-Cookie", list);
}

async function issueUserSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    "INSERT INTO user_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt]
  );
  setSessionCookie(res, token, SESSION_TTL_MS);
}

async function assignDefaultRoleForNewUser(userId) {
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
          [userId, adminRoleRows[0].id]
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
          [userId, userRoleRows[0].id]
        );
      }
    }
  } catch {
    // keep auth successful even if role assignment fails
  }
}

function normalizeMicrosoftUsernameBase(profile = {}) {
  const email = String(profile?.email || "").trim();
  const preferred = String(profile?.preferred_username || "").trim();
  const displayName = String(profile?.name || "").trim();
  const source = email || preferred || displayName || "ms_user";
  const local = source.includes("@") ? source.split("@")[0] : source;
  const normalized = local
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = normalized || "ms_user";
  return base.slice(0, 24);
}

async function findAvailableUsername(base) {
  const root = String(base || "ms_user").trim() || "ms_user";
  for (let i = 0; i < 1000; i += 1) {
    const candidate = i === 0 ? root : `${root}_${i}`;
    const value = candidate.slice(0, 32);
    const { rows } = await pool.query(
      "SELECT 1 FROM users WHERE lower(username) = lower($1) LIMIT 1",
      [value]
    );
    if (!rows.length) return value;
  }
  return `ms_${crypto.randomBytes(6).toString("hex")}`.slice(0, 32);
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
    if (!req.path.startsWith("/api")) return next();
    if (req.path.startsWith("/api/auth")) return next();
    if (req.method === "OPTIONS") return next();
    if (
      (req.path === "/api/ai/plc-insights" &&
        (req.method === "POST" || req.method === "GET")) ||
      (req.path === "/api/ai/plc-svg-suggest" && req.method === "POST") ||
      (req.path === "/api/ai/plc-opc-connect" && req.method === "POST") ||
      req.path.startsWith("/api/ai/code-gen-pro/") ||
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
    if (req.path === "/api/opc/priorities" && req.method === "GET") {
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
  const nameCol = cols.find((c) => c.toLowerCase() === "name");
  if (nameCol) return nameCol;
  return referencedColumn;
}

async function getForeignKeysForTable(table) {
  const fkSql = `
    SELECT
      tc.constraint_name AS constraint_name,
      kcu.column_name AS local_column,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column,
      rc.delete_rule AS delete_rule,
      rc.update_rule AS update_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    LEFT JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
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
    const constraintName = String(fk?.constraint_name || "").trim();
    const localColumn = String(fk?.local_column || "").trim();
    const refTable = String(fk?.referenced_table || "").trim();
    const refColumn = String(fk?.referenced_column || "").trim();
    const onDelete = String(fk?.delete_rule || "NO ACTION").trim().toUpperCase();
    const onUpdate = String(fk?.update_rule || "NO ACTION").trim().toUpperCase();
    if (
      !/^[a-zA-Z0-9_]+$/.test(constraintName) ||
      !/^[a-zA-Z0-9_]+$/.test(localColumn) ||
      !/^[a-zA-Z0-9_]+$/.test(refTable) ||
      !/^[a-zA-Z0-9_]+$/.test(refColumn)
    ) {
      continue;
    }
    const { labelColumn, options } = await loadReferenceOptions(localColumn, refTable, refColumn);
    const fkEntry = {
      column: localColumn,
      constraintName,
      referencedTable: refTable,
      referencedColumn: refColumn,
      onDelete,
      onUpdate,
      labelColumn,
      options,
    };
    if (!out[localColumn]) out[localColumn] = fkEntry;
    const uniqueKey =
      normalizeDbIdentifier(`${localColumn}__${constraintName}`.slice(0, 60), "foreign key meta key");
    out[uniqueKey] = fkEntry;
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
    project: ["id", "name", "data", "created_at", "updated_at", "updated_by"],
    route: ["id", "route_id", "route_number", "state", "route_color", "project_id", "created_at", "updated_at"],
    plc_code_gen_profile: ["plc_key", "profile", "updated_at"],
    route_bin_list: [
      "id",
      "name",
      "description",
      "bin_id",
      "bin_number",
      "hide_job_form",
      "assigned_bin_group",
      "created_at",
      "updated_at",
    ],
    product: ["id", "name", "description", "created_at", "updated_at"],
    bin: ["id", "name", "description", "product_id", "locked_in", "locked_out", "created_at", "updated_at"],
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

  const { rows: routeTable } = await pool.query(
    `
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'route'
    LIMIT 1
    `
  );
  if (routeTable.length) {
    const { rows: routeCols } = await pool.query(
      `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'route' AND column_name = 'project_id'
      LIMIT 1
      `
    );
    if (!routeCols.length) {
      throw new Error(`Schema verification failed: table "route" missing column "project_id"`);
    }
  }

  if (logPool) {
    const expectedLogCols = ["id", "at", "level", "source", "category", "data_type", "message", "meta", "count"];
    const { rows: logColsRows } = await logPool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'server_logs'
      `
    );
    const existingLogCols = new Set(logColsRows.map((r) => r.column_name));
    for (const col of expectedLogCols) {
      if (!existingLogCols.has(col)) {
        throw new Error(`Schema verification failed: table "server_logs" missing column "${col}"`);
      }
    }
  }
}

function normalizeLegacyTableName(value) {
  const table = String(value || "").trim();
  if (table === "projects") return "project";
  if (table === "routes") return "route";
  if (table === "tbl_routebingroup") return "route_bin_group";
  if (table === "tbl_routebinlist") return "route_bin_list";
  return table;
}

function invalidateAutomationRuleCache() {
  automationRuleCacheAt = 0;
  automationRuleCacheRows = [];
}

const OLLAMA_IDLE_UNLOAD_MS = Math.max(
  30000,
  Number.parseInt(process.env.OLLAMA_IDLE_UNLOAD_MS || "180000", 10) || 180000
);
const CHAT_AI_HISTORY_MAX = Math.max(
  2,
  Math.min(24, Number.parseInt(process.env.CHAT_AI_HISTORY_MAX || "8", 10) || 8)
);
const CHAT_AI_MESSAGE_CHAR_MAX = Math.max(
  120,
  Math.min(4000, Number.parseInt(process.env.CHAT_AI_MESSAGE_CHAR_MAX || "900", 10) || 900)
);
const OLLAMA_CHAT_MAX_PREDICT = Math.max(
  64,
  Math.min(2048, Number.parseInt(process.env.OLLAMA_CHAT_MAX_PREDICT || "320", 10) || 320)
);
const OLLAMA_CHAT_TEMPERATURE = Number.isFinite(Number(process.env.OLLAMA_CHAT_TEMPERATURE))
  ? Number(process.env.OLLAMA_CHAT_TEMPERATURE)
  : 0.2;
const OLLAMA_CHAT_KEEP_ALIVE = String(process.env.OLLAMA_CHAT_KEEP_ALIVE || "20m").trim() || "20m";
const FLOUR_KNOWLEDGE_MAX_CHARS = Math.max(
  500,
  Math.min(24000, Number.parseInt(process.env.FLOUR_KNOWLEDGE_MAX_CHARS || "6000", 10) || 6000)
);
const CHAT_L5X_DOC_MAX_CHARS = Math.max(
  2000,
  Math.min(4000000, Number.parseInt(process.env.CHAT_L5X_DOC_MAX_CHARS || "2000000", 10) || 2000000)
);
const CHAT_L5X_CONTEXT_MAX_CHARS = Math.max(
  500,
  Math.min(60000, Number.parseInt(process.env.CHAT_L5X_CONTEXT_MAX_CHARS || "14000", 10) || 14000)
);
const CHAT_L5X_CONTEXT_DOC_LIMIT = Math.max(
  1,
  Math.min(8, Number.parseInt(process.env.CHAT_L5X_CONTEXT_DOC_LIMIT || "3", 10) || 3)
);

function resolveOllamaNativeBaseUrl({ baseUrl = "", ollamaNativeUrl = "" } = {}) {
  const direct = String(ollamaNativeUrl || "").trim();
  if (direct) return direct.replace(/\/$/, "");
  const compat = String(baseUrl || "").trim();
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

function requireAreaEdit(areaKey) {
  return async (req, res, next) => {
    try {
      const userId = Number.parseInt(String(req.user?.id || ""), 10);
      if (!Number.isFinite(userId) || userId <= 0) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const allowed = await canUserEditArea(userId, areaKey);
      if (!allowed) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err?.message || "Authorization failed." });
    }
  };
}

function requireAreaView(areaKey) {
  return async (req, res, next) => {
    try {
      const userId = Number.parseInt(String(req.user?.id || ""), 10);
      if (!Number.isFinite(userId) || userId <= 0) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const allowed = await canUserViewArea(userId, areaKey);
      if (!allowed) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err?.message || "Authorization failed." });
    }
  };
}

let ollamaUnloadTimer = null;
let ollamaLastUsedAt = 0;
let ollamaLastModel = String(OPENAI_MODEL || "").trim() || "gpt-5";
let ollamaUnloadInFlight = false;

function buildDefaultAgentFromEnv() {
  const envModel = String(process.env.OPENAI_MODEL || OPENAI_MODEL || "gpt-5").trim() || "gpt-5";
  const envBaseUrl = String(process.env.OPENAI_BASE_URL || "").trim();
  const envApiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const envOllamaNative = String(process.env.OLLAMA_NATIVE_URL || "").trim();
  if (envOllamaNative) {
    return {
      id: "ollama-local",
      name: "Ollama (Local)",
      provider: "ollama",
      model: envModel || "llama3.2",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "",
      ollamaNativeUrl: envOllamaNative,
      enabled: true,
    };
  }
  return {
    id: "default-openai",
    name: "OpenAI",
    provider: "openai",
    model: envModel,
    baseUrl: envBaseUrl,
    apiKey: envApiKey,
    ollamaNativeUrl: "",
    enabled: true,
  };
}

function sanitizeAiAgent(input = {}, index = 0) {
  const providerRaw = String(input?.provider || "openai").trim().toLowerCase();
  const provider = [
    "openai",
    "openai_compatible",
    "anthropic",
    "google",
    "azure_openai",
    "ollama",
  ].includes(providerRaw)
    ? providerRaw
    : "openai_compatible";
  const id =
    String(input?.id || "").trim() ||
    `agent-${Date.now().toString(36)}-${Math.max(0, Number(index) || 0).toString(36)}`;
  return {
    id,
    name: String(input?.name || "").trim() || `AI Agent ${Math.max(1, Number(index) + 1 || 1)}`,
    provider,
    model: String(input?.model || "").trim() || (provider === "ollama" ? "llama3.2" : "gpt-5"),
    baseUrl: String(input?.baseUrl || "").trim(),
    apiKey: String(input?.apiKey || "").trim(),
    ollamaNativeUrl: String(input?.ollamaNativeUrl || "").trim(),
    enabled: input?.enabled !== false,
  };
}

function normalizeAiConfig(input = {}) {
  const agents = Array.isArray(input?.agents) ? input.agents : [];
  const normalizedAgents = agents.map((agent, idx) => sanitizeAiAgent(agent, idx));
  const uniqueAgents = [];
  const seen = new Set();
  for (const agent of normalizedAgents) {
    const key = String(agent.id || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueAgents.push(agent);
  }
  if (!uniqueAgents.length) uniqueAgents.push(buildDefaultAgentFromEnv());
  const activeAgentIdRaw = String(input?.activeAgentId || "").trim();
  const activeAgentId = uniqueAgents.some((agent) => agent.id === activeAgentIdRaw)
    ? activeAgentIdRaw
    : uniqueAgents[0].id;
  return {
    version: 1,
    activeAgentId,
    agents: uniqueAgents,
  };
}

function readAiConfig() {
  try {
    if (!fs.existsSync(AI_CONFIG_PATH)) {
      const initial = normalizeAiConfig({ agents: [buildDefaultAgentFromEnv()] });
      fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }
    const raw = String(fs.readFileSync(AI_CONFIG_PATH, "utf8") || "").trim();
    const parsed = raw ? JSON.parse(raw) : {};
    const normalized = normalizeAiConfig(parsed);
    if (JSON.stringify(normalized) !== JSON.stringify(parsed || {})) {
      fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(normalized, null, 2), "utf8");
    }
    return normalized;
  } catch {
    return normalizeAiConfig({ agents: [buildDefaultAgentFromEnv()] });
  }
}

function writeAiConfig(input = {}) {
  const normalized = normalizeAiConfig(input);
  fs.writeFileSync(AI_CONFIG_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function getActiveAiRuntime() {
  const config = readAiConfig();
  const active =
    config.agents.find((agent) => agent.id === config.activeAgentId) ||
    config.agents[0] ||
    sanitizeAiAgent(buildDefaultAgentFromEnv(), 0);
  const model = String(active?.model || OPENAI_MODEL || "gpt-5").trim() || "gpt-5";
  const baseUrl = String(active?.baseUrl || "").trim();
  const apiKey = String(active?.apiKey || "").trim();
  const ollamaNativeBaseUrl = resolveOllamaNativeBaseUrl({
    baseUrl,
    ollamaNativeUrl: active?.ollamaNativeUrl,
  });
  const client = new OpenAI({
    apiKey: apiKey || "ollama",
    baseURL: baseUrl || undefined,
  });
  const hasProvider = active.enabled === true && !!(apiKey || baseUrl || ollamaNativeBaseUrl);
  return {
    config,
    activeAgent: active,
    model,
    baseUrl,
    apiKey,
    ollamaNativeBaseUrl,
    hasProvider,
    client,
  };
}

function markOllamaModelUsed(runtime, model = "") {
  if (!runtime?.ollamaNativeBaseUrl) return;
  const nextModel = String(model || "").trim();
  if (nextModel) ollamaLastModel = nextModel;
  ollamaLastUsedAt = Date.now();
  if (ollamaUnloadTimer) clearTimeout(ollamaUnloadTimer);
  ollamaUnloadTimer = setTimeout(() => {
    void unloadOllamaModelIfIdle(runtime);
  }, OLLAMA_IDLE_UNLOAD_MS);
}

async function unloadOllamaModelIfIdle(runtime, force = false) {
  if (!runtime?.ollamaNativeBaseUrl) return false;
  if (ollamaUnloadInFlight) return false;
  const idleForMs = Date.now() - Number(ollamaLastUsedAt || 0);
  if (!force && idleForMs < OLLAMA_IDLE_UNLOAD_MS - 250) return false;
  ollamaUnloadInFlight = true;
  try {
    const model = String(ollamaLastModel || runtime?.model || OPENAI_MODEL || "llama3.2").trim() || "llama3.2";
    await fetch(`${runtime.ollamaNativeBaseUrl}/api/generate`, {
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

process.on("SIGINT", () => {
  const runtime = getActiveAiRuntime();
  void unloadOllamaModelIfIdle(runtime, true).finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  const runtime = getActiveAiRuntime();
  void unloadOllamaModelIfIdle(runtime, true).finally(() => process.exit(0));
});

app.get("/api/ai/config", async (_req, res) => {
  try {
    const config = readAiConfig();
    res.json({
      config,
      providers: [
        {
          key: "openai",
          label: "OpenAI",
          docsUrl: "https://platform.openai.com/docs",
          signupUrl: "https://platform.openai.com/signup",
        },
        {
          key: "anthropic",
          label: "Anthropic",
          docsUrl: "https://docs.anthropic.com/",
          signupUrl: "https://console.anthropic.com/",
        },
        {
          key: "google",
          label: "Google Gemini",
          docsUrl: "https://ai.google.dev/gemini-api/docs",
          signupUrl: "https://aistudio.google.com/",
        },
        {
          key: "azure_openai",
          label: "Azure OpenAI",
          docsUrl: "https://learn.microsoft.com/azure/ai-services/openai/",
          signupUrl: "https://portal.azure.com/",
        },
        {
          key: "ollama",
          label: "Ollama",
          docsUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md",
          signupUrl: "https://ollama.com/download",
        },
      ],
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load AI config." });
  }
});

app.put("/api/ai/config", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const config = writeAiConfig(body?.config || body || {});
    const runtime = getActiveAiRuntime();
    if (runtime?.activeAgent?.provider === "ollama") {
      const envPath = path.resolve(AI_SERVER_DIR, ".env");
      const modelName = String(runtime.model || "").trim();
      const nativeUrl = String(runtime.activeAgent?.ollamaNativeUrl || "").trim();
      upsertEnvVar(envPath, "OPENAI_MODEL", modelName || "llama3.2");
      if (nativeUrl) upsertEnvVar(envPath, "OLLAMA_NATIVE_URL", nativeUrl);
    }
    res.json({ ok: true, config });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save AI config." });
  }
});

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

app.get("/api/auth/providers", async (_req, res) => {
  res.json({
    providers: {
      microsoft: {
        enabled: isMicrosoftAuthConfigured(),
      },
    },
  });
});

app.get("/api/server/settings/auth", requireAreaView("server"), async (_req, res) => {
  res.json({
    microsoft: {
      enabled: Boolean(MS_OAUTH_ENABLED),
      configured: isMicrosoftAuthConfigured(),
      tenant: String(MS_OAUTH_TENANT || "common"),
      clientId: String(MS_OAUTH_CLIENT_ID || ""),
      hasClientSecret: Boolean(String(MS_OAUTH_CLIENT_SECRET || "").trim()),
      redirectUri: String(MS_OAUTH_REDIRECT_URI || ""),
      scopes: String(MS_OAUTH_SCOPES || "openid profile email User.Read"),
    },
  });
});

app.post("/api/server/settings/auth", requireAreaEdit("server"), async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const microsoft = body?.microsoft && typeof body.microsoft === "object" ? body.microsoft : {};
    const enabledRaw = microsoft?.enabled ?? MS_OAUTH_ENABLED;
    const nextEnabled = !["0", "false", "no", "off"].includes(
      String(enabledRaw).trim().toLowerCase()
    );
    const nextTenant = String(microsoft?.tenant ?? MS_OAUTH_TENANT ?? "common").trim() || "common";
    const nextClientId = String(microsoft?.clientId ?? MS_OAUTH_CLIENT_ID ?? "").trim();
    const nextRedirectUri = String(microsoft?.redirectUri ?? MS_OAUTH_REDIRECT_URI ?? "").trim();
    const nextScopes =
      String(microsoft?.scopes ?? MS_OAUTH_SCOPES ?? "openid profile email User.Read")
        .trim()
        .replace(/\s+/g, " ") || "openid profile email User.Read";
    const postedSecret = String(microsoft?.clientSecret ?? "").trim();
    const nextClientSecret = postedSecret ? postedSecret : String(MS_OAUTH_CLIENT_SECRET || "");

    const envPath = path.resolve(__dirname, ".env");
    upsertEnvVar(envPath, "MS_OAUTH_ENABLED", nextEnabled ? "1" : "0");
    upsertEnvVar(envPath, "MS_OAUTH_TENANT", nextTenant);
    upsertEnvVar(envPath, "MS_OAUTH_CLIENT_ID", nextClientId);
    if (postedSecret) upsertEnvVar(envPath, "MS_OAUTH_CLIENT_SECRET", nextClientSecret);
    upsertEnvVar(envPath, "MS_OAUTH_REDIRECT_URI", nextRedirectUri);
    upsertEnvVar(envPath, "MS_OAUTH_SCOPES", nextScopes);

    MS_OAUTH_ENABLED = nextEnabled;
    MS_OAUTH_TENANT = nextTenant;
    MS_OAUTH_CLIENT_ID = nextClientId;
    if (postedSecret) MS_OAUTH_CLIENT_SECRET = nextClientSecret;
    MS_OAUTH_REDIRECT_URI = nextRedirectUri;
    MS_OAUTH_SCOPES = nextScopes;
    process.env.MS_OAUTH_ENABLED = nextEnabled ? "1" : "0";
    process.env.MS_OAUTH_TENANT = nextTenant;
    process.env.MS_OAUTH_CLIENT_ID = nextClientId;
    if (postedSecret) process.env.MS_OAUTH_CLIENT_SECRET = nextClientSecret;
    process.env.MS_OAUTH_REDIRECT_URI = nextRedirectUri;
    process.env.MS_OAUTH_SCOPES = nextScopes;

    res.json({
      ok: true,
      microsoft: {
        enabled: Boolean(MS_OAUTH_ENABLED),
        configured: isMicrosoftAuthConfigured(),
        tenant: String(MS_OAUTH_TENANT || "common"),
        clientId: String(MS_OAUTH_CLIENT_ID || ""),
        hasClientSecret: Boolean(String(MS_OAUTH_CLIENT_SECRET || "").trim()),
        redirectUri: String(MS_OAUTH_REDIRECT_URI || ""),
        scopes: String(MS_OAUTH_SCOPES || "openid profile email User.Read"),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save auth settings." });
  }
});

app.get("/api/auth/microsoft/start", async (req, res) => {
  try {
    if (!isMicrosoftAuthConfigured()) {
      res.redirect("/login?error=" + encodeURIComponent("Microsoft login is not configured."));
      return;
    }
    const redirectUri = getMicrosoftRedirectUri(req);
    if (!redirectUri) {
      res.redirect("/login?error=" + encodeURIComponent("Unable to resolve OAuth redirect URL."));
      return;
    }
    const state = crypto.randomBytes(24).toString("hex");
    appendSetCookie(
      res,
      `${MS_OAUTH_STATE_COOKIE}=${state}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(
        MS_OAUTH_STATE_TTL_MS / 1000
      )}`
    );
    const authUrl = new URL(
      `https://login.microsoftonline.com/${encodeURIComponent(MS_OAUTH_TENANT)}/oauth2/v2.0/authorize`
    );
    authUrl.searchParams.set("client_id", MS_OAUTH_CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_mode", "query");
    authUrl.searchParams.set("scope", MS_OAUTH_SCOPES);
    authUrl.searchParams.set("state", state);
    res.redirect(authUrl.toString());
  } catch (err) {
    res.redirect("/login?error=" + encodeURIComponent(err?.message || "Microsoft login failed to start."));
  }
});

app.get("/api/auth/microsoft/callback", async (req, res) => {
  try {
    if (!isMicrosoftAuthConfigured()) {
      res.redirect("/login?error=" + encodeURIComponent("Microsoft login is not configured."));
      return;
    }
    const oauthError = String(req.query?.error || "").trim();
    if (oauthError) {
      const desc = String(req.query?.error_description || oauthError).trim();
      res.redirect("/login?error=" + encodeURIComponent(desc));
      return;
    }
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    const cookies = parseCookies(req.headers.cookie || "");
    const expectedState = String(cookies[MS_OAUTH_STATE_COOKIE] || "").trim();
    appendSetCookie(res, `${MS_OAUTH_STATE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    if (!code || !state || !expectedState || state !== expectedState) {
      res.redirect("/login?error=" + encodeURIComponent("OAuth state validation failed."));
      return;
    }
    const redirectUri = getMicrosoftRedirectUri(req);
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
      MS_OAUTH_TENANT
    )}/oauth2/v2.0/token`;
    const tokenBody = new URLSearchParams();
    tokenBody.set("client_id", MS_OAUTH_CLIENT_ID);
    tokenBody.set("client_secret", MS_OAUTH_CLIENT_SECRET);
    tokenBody.set("grant_type", "authorization_code");
    tokenBody.set("code", code);
    tokenBody.set("redirect_uri", redirectUri);
    tokenBody.set("scope", MS_OAUTH_SCOPES);
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
    const tokenJson = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      throw new Error(String(tokenJson?.error_description || tokenJson?.error || "Token exchange failed."));
    }
    let profile = {};
    const accessToken = String(tokenJson?.access_token || "").trim();
    if (accessToken) {
      const userInfoRes = await fetch("https://graph.microsoft.com/oidc/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userInfoRes.ok) {
        profile = (await userInfoRes.json().catch(() => ({}))) || {};
      }
    }
    if ((!profile || !Object.keys(profile).length) && tokenJson?.id_token) {
      const parts = String(tokenJson.id_token).split(".");
      if (parts.length >= 2) {
        const payload = Buffer.from(parts[1], "base64url").toString("utf8");
        profile = JSON.parse(payload || "{}");
      }
    }
    const externalSubject = String(profile?.sub || profile?.oid || "").trim();
    if (!externalSubject) throw new Error("Microsoft profile missing subject identifier.");
    const email = String(
      profile?.email || profile?.preferred_username || profile?.upn || profile?.unique_name || ""
    ).trim();
    const displayName = String(profile?.name || email || "Microsoft User").trim();
    const avatarUrl = "";

    let userRow = null;
    {
      const byExternal = await pool.query(
        `
        SELECT id, username, display_name, avatar_url
        FROM users
        WHERE external_provider = 'microsoft' AND external_subject = $1
        LIMIT 1
        `,
        [externalSubject]
      );
      userRow = byExternal.rows[0] || null;
    }
    if (!userRow && email) {
      const byEmail = await pool.query(
        `
        SELECT id, username, display_name, avatar_url
        FROM users
        WHERE lower(email) = lower($1)
        LIMIT 1
        `,
        [email]
      );
      userRow = byEmail.rows[0] || null;
      if (userRow) {
        await pool.query(
          `
          UPDATE users
          SET
            external_provider = 'microsoft',
            external_subject = $2,
            display_name = COALESCE(NULLIF($3, ''), display_name),
            avatar_url = COALESCE(NULLIF($4, ''), avatar_url),
            email = COALESCE(NULLIF($1, ''), email)
          WHERE id = $5
          `,
          [email, externalSubject, displayName, avatarUrl, userRow.id]
        );
      }
    }
    if (!userRow) {
      const usernameBase = normalizeMicrosoftUsernameBase({
        email,
        preferred_username: profile?.preferred_username,
        name: displayName,
      });
      const username = await findAvailableUsername(usernameBase);
      const randomSecret = crypto.randomBytes(24).toString("hex");
      const { salt, hash } = await createPasswordHash(randomSecret);
      const insert = await pool.query(
        `
        INSERT INTO users (
          username, password_hash, password_salt, display_name, avatar_url, email, external_provider, external_subject, disabled
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'microsoft', $7, false)
        RETURNING id, username, display_name, avatar_url
        `,
        [username, hash, salt, displayName || username, avatarUrl || null, email || null, externalSubject]
      );
      userRow = insert.rows[0] || null;
      if (userRow?.id) await assignDefaultRoleForNewUser(userRow.id);
    }
    if (!userRow?.id) throw new Error("Failed to create or locate Microsoft user.");
    await issueUserSession(res, userRow.id);
    res.redirect("/");
  } catch (err) {
    res.redirect("/login?error=" + encodeURIComponent(err?.message || "Microsoft login failed."));
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
    await issueUserSession(res, user.id);
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
    clearSessionCookie(res);
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
    await assignDefaultRoleForNewUser(user.id);
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
  s = s.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");
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
      /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\")?([a-zA-Z0-9_]+)\1\.)?(\")?([a-zA-Z0-9_]+)\3\s*\(/i
    );
    if (!match) continue;
    const schemaQuoted = String(match[1] || "");
    const schemaRaw = String(match[2] || "public").trim();
    const tableQuoted = String(match[3] || "");
    const tableRaw = String(match[4] || "").trim();
    const schema = schemaQuoted ? schemaRaw : schemaRaw.toLowerCase();
    const table = tableQuoted ? tableRaw : tableRaw.toLowerCase();
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

function jsonString(value) {
  try {
    return JSON.stringify(value == null ? {} : value);
  } catch {
    return "{}";
  }
}

function hashJsonText(text) {
  return crypto.createHash("sha256").update(String(text || "{}")).digest("hex");
}

function summarizeProjectChange(previousData, nextData, previousJson = "", nextJson = "") {
  const prev = previousData && typeof previousData === "object" ? previousData : {};
  const next = nextData && typeof nextData === "object" ? nextData : {};
  const prevKeys = new Set(Object.keys(prev));
  const nextKeys = new Set(Object.keys(next));
  let added = 0;
  let removed = 0;
  let changed = 0;
  const sample = [];

  for (const key of nextKeys) {
    if (!prevKeys.has(key)) {
      added += 1;
      if (sample.length < 24) sample.push({ key, change: "added" });
      continue;
    }
    const before = jsonString(prev[key]);
    const after = jsonString(next[key]);
    if (before !== after) {
      changed += 1;
      if (sample.length < 24) sample.push({ key, change: "changed" });
    }
  }

  for (const key of prevKeys) {
    if (!nextKeys.has(key)) {
      removed += 1;
      if (sample.length < 24) sample.push({ key, change: "removed" });
    }
  }

  return {
    added,
    removed,
    changed,
    topLevelBefore: prevKeys.size,
    topLevelAfter: nextKeys.size,
    previousBytes: Buffer.byteLength(previousJson || "", "utf8"),
    nextBytes: Buffer.byteLength(nextJson || "", "utf8"),
    sample,
  };
}

async function pruneProjectVersions(projectId) {
  const pid = String(projectId || "").trim();
  if (!pid || !pool) return 0;
  const { rowCount } = await pool.query(
    `
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (ORDER BY saved_at DESC, id DESC) AS rn,
        SUM(
          COALESCE(octet_length(previous_data_gz), 0)::bigint +
          COALESCE(octet_length(next_data_gz), 0)::bigint
        ) OVER (ORDER BY saved_at DESC, id DESC) AS cum_bytes
      FROM project_versions
      WHERE project_id = $1
    ),
    keep AS (
      SELECT id
      FROM ranked
      WHERE rn <= $2
        AND (cum_bytes <= $3 OR rn <= $4)
    )
    DELETE FROM project_versions pv
    WHERE pv.project_id = $1
      AND NOT EXISTS (SELECT 1 FROM keep k WHERE k.id = pv.id)
    `,
    [
      pid,
      PROJECT_VERSION_KEEP_PER_PROJECT,
      PROJECT_VERSION_KEEP_BYTES_PER_PROJECT,
      PROJECT_VERSION_KEEP_MIN_PER_PROJECT,
    ]
  );
  return Number(rowCount || 0);
}

async function saveProjectVersion({
  projectId,
  userId = null,
  baseUpdatedAtIso = null,
  previousData = {},
  nextData = {},
}) {
  const pid = String(projectId || "").trim();
  if (!pid || !pool) return { mode: "skip", reason: "invalid_project" };

  const previousJson = jsonString(previousData);
  const nextJson = jsonString(nextData);
  if (previousJson === nextJson) {
    return { mode: "skip", reason: "no_change" };
  }

  const previousGzip = gzipSync(Buffer.from(previousJson, "utf8"));
  const nextGzip = gzipSync(Buffer.from(nextJson, "utf8"));
  const nextHash = hashJsonText(nextJson);
  const summary = summarizeProjectChange(previousData, nextData, previousJson, nextJson);
  const nowMs = Date.now();

  const { rows: latestRows } = await pool.query(
    `
    SELECT id, saved_at, next_hash
    FROM project_versions
    WHERE project_id = $1
    ORDER BY saved_at DESC, id DESC
    LIMIT 1
    `,
    [pid]
  );
  const latest = latestRows[0] || null;
  const latestSavedMs = latest?.saved_at ? Date.parse(String(latest.saved_at)) : NaN;

  if (latest && String(latest.next_hash || "") === nextHash) {
    return { mode: "skip", reason: "duplicate_hash" };
  }

  if (
    latest &&
    Number.isFinite(latestSavedMs) &&
    nowMs - latestSavedMs < PROJECT_VERSION_MIN_INTERVAL_MS
  ) {
    await pool.query(
      `
      UPDATE project_versions
      SET saved_at = now(),
          saved_by = $2,
          base_updated_at = $3,
          previous_data = '{}'::jsonb,
          next_data = '{}'::jsonb,
          previous_data_gz = $4,
          next_data_gz = $5,
          payload_codec = $6,
          next_hash = $7,
          change_summary = $8::jsonb
      WHERE id = $1
      `,
      [
        latest.id,
        userId,
        baseUpdatedAtIso || null,
        previousGzip,
        nextGzip,
        PROJECT_VERSION_CODEC,
        nextHash,
        JSON.stringify(summary),
      ]
    );
    await pruneProjectVersions(pid);
    return { mode: "updated_latest", reason: "debounced" };
  }

  await pool.query(
    `
    INSERT INTO project_versions (
      project_id, saved_by, base_updated_at,
      previous_data, next_data,
      previous_data_gz, next_data_gz,
      payload_codec, next_hash, change_summary
    )
    VALUES ($1, $2, $3, '{}'::jsonb, '{}'::jsonb, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      pid,
      userId,
      baseUpdatedAtIso || null,
      previousGzip,
      nextGzip,
      PROJECT_VERSION_CODEC,
      nextHash,
      JSON.stringify(summary),
    ]
  );
  await pruneProjectVersions(pid);
  return { mode: "inserted", reason: "ok" };
}

async function runProjectVersionMaintenance() {
  if (!pool || projectVersionMaintenanceInFlight) return;
  projectVersionMaintenanceInFlight = true;
  try {
    const { rows: staleRows } = await pool.query(
      `
      SELECT id, previous_data, next_data
      FROM project_versions
      WHERE (payload_codec IS NULL OR payload_codec <> $1)
        AND (previous_data_gz IS NULL OR next_data_gz IS NULL)
      ORDER BY saved_at ASC, id ASC
      LIMIT $2
      `,
      [PROJECT_VERSION_CODEC, PROJECT_VERSION_COMPACT_BATCH]
    );

    for (const row of staleRows) {
      const previousJson = jsonString(row?.previous_data || {});
      const nextJson = jsonString(row?.next_data || {});
      const previousGzip = gzipSync(Buffer.from(previousJson, "utf8"));
      const nextGzip = gzipSync(Buffer.from(nextJson, "utf8"));
      const nextHash = hashJsonText(nextJson);
      const summary = summarizeProjectChange(row?.previous_data || {}, row?.next_data || {}, previousJson, nextJson);
      await pool.query(
        `
        UPDATE project_versions
        SET previous_data_gz = $2,
            next_data_gz = $3,
            payload_codec = $4,
            next_hash = COALESCE(next_hash, $5),
            change_summary = CASE
              WHEN change_summary IS NULL THEN $6::jsonb
              ELSE change_summary
            END,
            previous_data = '{}'::jsonb,
            next_data = '{}'::jsonb
        WHERE id = $1
        `,
        [row.id, previousGzip, nextGzip, PROJECT_VERSION_CODEC, nextHash, JSON.stringify(summary)]
      );
    }

    const { rows: projectRows } = await pool.query(
      `
      SELECT project_id
      FROM project_versions
      GROUP BY project_id
      HAVING
        COUNT(*) > $1
        OR SUM(
          COALESCE(octet_length(previous_data_gz), 0)::bigint +
          COALESCE(octet_length(next_data_gz), 0)::bigint
        ) > $2
      ORDER BY MAX(saved_at) DESC
      LIMIT 500
      `
      ,
      [PROJECT_VERSION_KEEP_PER_PROJECT, PROJECT_VERSION_KEEP_BYTES_PER_PROJECT]
    );
    for (const row of projectRows) {
      const pid = String(row?.project_id || "").trim();
      if (!pid) continue;
      await pruneProjectVersions(pid);
    }
  } catch {
    // ignore maintenance errors
  } finally {
    projectVersionMaintenanceInFlight = false;
  }
}

function parseDatabaseUrlObject(connectionString) {
  const raw = String(connectionString || "").trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function upsertEnvVar(filePath, key, value) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return;
  const nextValue = String(value ?? "");
  let text = "";
  if (fs.existsSync(filePath)) {
    text = String(fs.readFileSync(filePath, "utf8") || "");
  }
  const lines = text.split(/\r?\n/);
  const re = new RegExp(`^\\s*${normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  let found = false;
  const nextLines = lines.map((line) => {
    if (!found && re.test(line)) {
      found = true;
      return `${normalizedKey}=${nextValue}`;
    }
    return line;
  });
  if (!found) nextLines.push(`${normalizedKey}=${nextValue}`);
  const nextText = `${nextLines.join("\n").replace(/\n+$/, "")}\n`;
  fs.writeFileSync(filePath, nextText, "utf8");
}

function normalizeDbBackupConfig(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const enabled = src.enabled === true;
  const intervalMinutes = Math.max(
    15,
    Math.min(7 * 24 * 60, Number.parseInt(String(src.intervalMinutes || ""), 10) || DB_BACKUP_DEFAULTS.intervalMinutes)
  );
  const keepBackups = Math.max(
    3,
    Math.min(500, Number.parseInt(String(src.keepBackups || ""), 10) || DB_BACKUP_DEFAULTS.keepBackups)
  );
  const includeTrendDb = src.includeTrendDb !== false;
  const redundancyEnabled = src.redundancyEnabled === true;
  const redundancyCopies = Math.max(
    1,
    Math.min(3, Number.parseInt(String(src.redundancyCopies || ""), 10) || DB_BACKUP_DEFAULTS.redundancyCopies)
  );
  const lastRunAt = Math.max(0, Number.parseInt(String(src.lastRunAt || "0"), 10) || 0);
  return { enabled, intervalMinutes, keepBackups, includeTrendDb, redundancyEnabled, redundancyCopies, lastRunAt };
}

function ensureDirectoryExists(dirPath) {
  const target = String(dirPath || "").trim();
  if (!target) return;
  fs.mkdirSync(target, { recursive: true });
}

function safeBackupToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function makeBackupId(ts = Date.now()) {
  const d = new Date(Number(ts) || Date.now());
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function resolvePgToolBinary(toolName = "pg_dump") {
  const base = String(toolName || "").trim();
  if (!base) return "";
  const exe = process.platform === "win32" ? `${base}.exe` : base;
  const candidates = [
    path.resolve("C:/Program Files/PostgreSQL/18/bin", exe),
    path.resolve("C:/Program Files/PostgreSQL/17/bin", exe),
    path.resolve("C:/Program Files/PostgreSQL/16/bin", exe),
    path.resolve("C:/Program Files/PostgreSQL/15/bin", exe),
    path.resolve("C:/Program Files/PostgreSQL/14/bin", exe),
    path.resolve("C:/Program Files/PostgreSQL/13/bin", exe),
    exe,
    base,
  ];
  return pickFirstExisting(candidates) || exe;
}

function runCommand(binary, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binary, args, {
      env: options?.env && typeof options.env === "object" ? options.env : process.env,
      cwd: options?.cwd || process.cwd(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ code: 0, stdout, stderr });
        return;
      }
      const msg = String(stderr || stdout || `Process failed with exit code ${code}.`).trim();
      reject(new Error(msg));
    });
  });
}

function getDbConnectionParts(connectionString) {
  const url = parseDatabaseUrlObject(connectionString);
  if (!url) return null;
  return {
    connectionString: String(connectionString || "").trim(),
    host: String(url.hostname || "").trim() || "localhost",
    port: Number.parseInt(String(url.port || "5432"), 10) || 5432,
    user: decodeURIComponent(String(url.username || "").trim()),
    password: decodeURIComponent(String(url.password || "").trim()),
    database: String(url.pathname || "").replace(/^\//, "").trim(),
  };
}

function listBackupManifestFiles() {
  if (!fs.existsSync(DB_BACKUP_DIR)) return [];
  return fs
    .readdirSync(DB_BACKUP_DIR)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .map((name) => path.resolve(DB_BACKUP_DIR, name));
}

function listBackups() {
  const manifestFiles = listBackupManifestFiles();
  const rows = [];
  for (const filePath of manifestFiles) {
    try {
      const raw = String(fs.readFileSync(filePath, "utf8") || "").trim();
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") continue;
      const id = String(parsed.id || "").trim();
      if (!id) continue;
      const createdAt = Number(parsed.createdAt || 0);
      const files = Array.isArray(parsed.files)
        ? parsed.files.map((f) => ({
            kind: String(f?.kind || "").trim(),
            fileName: String(f?.fileName || "").trim(),
            sizeBytes: Number(f?.sizeBytes || 0) || 0,
            dbName: String(f?.dbName || "").trim(),
          }))
        : [];
      const redundancy = parsed?.redundancy && typeof parsed.redundancy === "object"
        ? {
            enabled: parsed.redundancy.enabled === true,
            copies: Math.max(1, Number.parseInt(String(parsed.redundancy.copies || "1"), 10) || 1),
            mirroredAt: Number(parsed.redundancy.mirroredAt || 0) || 0,
          }
        : null;
      rows.push({
        id,
        createdAt: Number.isFinite(createdAt) ? createdAt : 0,
        reason: String(parsed.reason || "").trim() || "manual",
        files,
        redundancy,
      });
    } catch {
      // ignore invalid manifest
    }
  }
  rows.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return rows;
}

function findBackupById(backupId) {
  const id = safeBackupToken(backupId);
  if (!id) return null;
  return listBackups().find((b) => String(b?.id || "") === id) || null;
}

function getRedundantBackupDirForCopy(copyIndex = 1) {
  const idx = Math.max(1, Number.parseInt(String(copyIndex || "1"), 10) || 1);
  if (idx <= 1) return DB_BACKUP_REDUNDANT_DIR;
  return path.resolve(DB_BACKUP_REDUNDANT_DIR, `copy_${idx}`);
}

function copyBackupToRedundantStorage(manifest) {
  if (!manifest || typeof manifest !== "object") return { copies: 0 };
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const copies = Math.max(1, Number.parseInt(String(dbBackupState?.redundancyCopies || "1"), 10) || 1);
  for (let i = 1; i <= copies; i += 1) {
    const targetDir = getRedundantBackupDirForCopy(i);
    ensureDirectoryExists(targetDir);
    files.forEach((f) => {
      const fileName = String(f?.fileName || "").trim();
      if (!fileName) return;
      const src = path.resolve(DB_BACKUP_DIR, fileName);
      const dst = path.resolve(targetDir, fileName);
      if (!src.startsWith(`${DB_BACKUP_DIR}${path.sep}`) || !dst.startsWith(`${targetDir}${path.sep}`)) return;
      if (!fs.existsSync(src)) return;
      fs.copyFileSync(src, dst);
    });
    const manifestName = `${safeBackupToken(manifest.id)}.json`;
    const srcManifest = path.resolve(DB_BACKUP_DIR, manifestName);
    const dstManifest = path.resolve(targetDir, manifestName);
    if (srcManifest.startsWith(`${DB_BACKUP_DIR}${path.sep}`) && dstManifest.startsWith(`${targetDir}${path.sep}`) && fs.existsSync(srcManifest)) {
      fs.copyFileSync(srcManifest, dstManifest);
    }
  }
  return { copies };
}

function resolveBackupFilePathWithRedundancy(fileName = "") {
  const clean = String(fileName || "").trim();
  if (!clean) return "";
  const primary = path.resolve(DB_BACKUP_DIR, clean);
  if (primary.startsWith(`${DB_BACKUP_DIR}${path.sep}`) && fs.existsSync(primary)) return primary;
  const copies = Math.max(1, Number.parseInt(String(dbBackupState?.redundancyCopies || "1"), 10) || 1);
  for (let i = 1; i <= copies; i += 1) {
    const dir = getRedundantBackupDirForCopy(i);
    const candidate = path.resolve(dir, clean);
    if (!candidate.startsWith(`${dir}${path.sep}`)) continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return "";
}

function readBackupManifestById(backupId) {
  const id = safeBackupToken(backupId);
  if (!id) return null;
  const manifestPath = path.resolve(DB_BACKUP_DIR, `${id}.json`);
  if (!manifestPath.startsWith(`${DB_BACKUP_DIR}${path.sep}`) || !fs.existsSync(manifestPath)) return null;
  try {
    const raw = String(fs.readFileSync(manifestPath, "utf8") || "").trim();
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildBackupExportBundle(backupId) {
  const backup = findBackupById(backupId);
  if (!backup) throw new Error("Backup not found.");
  const manifest = readBackupManifestById(backup.id);
  if (!manifest || typeof manifest !== "object") throw new Error("Backup manifest is missing.");
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (!files.length) throw new Error("Backup has no files.");
  const bundleFiles = files.map((f) => {
    const fileName = safeBackupToken(String(f?.fileName || "").trim());
    if (!fileName) throw new Error("Backup file entry is invalid.");
    const abs = resolveBackupFilePathWithRedundancy(fileName);
    if (!abs || !fs.existsSync(abs)) {
      throw new Error(`Backup file missing: ${fileName}`);
    }
    const buf = fs.readFileSync(abs);
    return {
      kind: String(f?.kind || "").trim() || "main",
      dbName: String(f?.dbName || "").trim(),
      fileName,
      sizeBytes: Number(buf.length || 0),
      contentBase64: buf.toString("base64"),
    };
  });
  return {
    format: "mesora-db-backup-bundle.v1",
    exportedAt: Date.now(),
    backup: {
      id: String(manifest.id || backup.id || "").trim(),
      createdAt: Number(manifest.createdAt || backup.createdAt || Date.now()) || Date.now(),
      reason: String(manifest.reason || backup.reason || "manual").trim() || "manual",
      files: bundleFiles,
    },
  };
}

function importBackupBundle(bundleRaw) {
  const root = bundleRaw && typeof bundleRaw === "object" ? bundleRaw : {};
  const backup = root?.backup && typeof root.backup === "object" ? root.backup : root;
  const files = Array.isArray(backup?.files) ? backup.files : [];
  if (!files.length) throw new Error("Backup bundle has no files.");
  const hasMain = files.some((f) => String(f?.kind || "").trim().toLowerCase() === "main");
  if (!hasMain) throw new Error("Backup bundle is missing a main database dump.");

  ensureDirectoryExists(DB_BACKUP_DIR);
  const baseId = safeBackupToken(backup?.id) || makeBackupId(Date.now());
  let id = baseId;
  let suffix = 1;
  while (fs.existsSync(path.resolve(DB_BACKUP_DIR, `${id}.json`))) {
    id = `${baseId}_${suffix}`;
    suffix += 1;
  }

  const outFiles = [];
  for (const row of files) {
    const kindRaw = String(row?.kind || "").trim().toLowerCase();
    const kind = kindRaw === "trend" ? "trend" : "main";
    const dbName = safeBackupToken(String(row?.dbName || "").trim()) || (kind === "trend" ? "trend" : "main");
    const requestedName = String(row?.fileName || "").trim();
    const ext = requestedName.toLowerCase().endsWith(".dump") ? ".dump" : ".dump";
    const safeStem = safeBackupToken(requestedName.replace(/\.dump$/i, "")) || `${id}__${dbName}`;
    let outName = `${safeStem}${ext}`;
    let outPath = path.resolve(DB_BACKUP_DIR, outName);
    let fileSuffix = 1;
    while (fs.existsSync(outPath)) {
      outName = `${safeStem}_${fileSuffix}${ext}`;
      outPath = path.resolve(DB_BACKUP_DIR, outName);
      fileSuffix += 1;
    }
    if (!outPath.startsWith(`${DB_BACKUP_DIR}${path.sep}`)) {
      throw new Error("Invalid backup file path.");
    }
    const base64 = String(row?.contentBase64 || "").trim();
    if (!base64) throw new Error(`Backup file content missing for ${outName}.`);
    let buf;
    try {
      buf = Buffer.from(base64, "base64");
    } catch {
      throw new Error(`Backup file content is invalid for ${outName}.`);
    }
    if (!buf || !buf.length) throw new Error(`Backup file is empty for ${outName}.`);
    fs.writeFileSync(outPath, buf);
    outFiles.push({
      kind,
      dbName,
      fileName: outName,
      sizeBytes: Number(buf.length || 0),
    });
  }

  const createdAt = Number(backup?.createdAt || 0);
  const manifest = {
    id,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    reason: `import:${String(backup?.reason || "manual").trim() || "manual"}`,
    files: outFiles,
  };
  const manifestPath = path.resolve(DB_BACKUP_DIR, `${id}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  if (dbBackupState.redundancyEnabled === true) {
    const mirror = copyBackupToRedundantStorage(manifest);
    manifest.redundancy = {
      enabled: true,
      copies: Number(mirror?.copies || 1) || 1,
      mirroredAt: Date.now(),
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  pruneBackupHistory(dbBackupState.keepBackups);
  return manifest;
}

function deleteBackupFiles(backup) {
  const files = Array.isArray(backup?.files) ? backup.files : [];
  files.forEach((f) => {
    const fileName = String(f?.fileName || "").trim();
    if (!fileName) return;
    const abs = path.resolve(DB_BACKUP_DIR, fileName);
    if (!abs.startsWith(`${DB_BACKUP_DIR}${path.sep}`)) return;
    if (fs.existsSync(abs)) {
      try {
        fs.unlinkSync(abs);
      } catch {
        // ignore
      }
    }
    const copies = Math.max(1, Number.parseInt(String(dbBackupState?.redundancyCopies || "1"), 10) || 1);
    for (let i = 1; i <= copies; i += 1) {
      const dir = getRedundantBackupDirForCopy(i);
      const mirror = path.resolve(dir, fileName);
      if (!mirror.startsWith(`${dir}${path.sep}`)) continue;
      if (fs.existsSync(mirror)) {
        try {
          fs.unlinkSync(mirror);
        } catch {
          // ignore
        }
      }
    }
  });
  const manifest = path.resolve(DB_BACKUP_DIR, `${safeBackupToken(backup?.id)}.json`);
  if (manifest.startsWith(`${DB_BACKUP_DIR}${path.sep}`) && fs.existsSync(manifest)) {
    try {
      fs.unlinkSync(manifest);
    } catch {
      // ignore
    }
  }
  const copies = Math.max(1, Number.parseInt(String(dbBackupState?.redundancyCopies || "1"), 10) || 1);
  for (let i = 1; i <= copies; i += 1) {
    const dir = getRedundantBackupDirForCopy(i);
    const mirrorManifest = path.resolve(dir, `${safeBackupToken(backup?.id)}.json`);
    if (!mirrorManifest.startsWith(`${dir}${path.sep}`)) continue;
    if (fs.existsSync(mirrorManifest)) {
      try {
        fs.unlinkSync(mirrorManifest);
      } catch {
        // ignore
      }
    }
  }
}

function pruneBackupHistory(keepBackups = DB_BACKUP_DEFAULTS.keepBackups) {
  const maxKeep = Math.max(3, Math.min(500, Number.parseInt(String(keepBackups || ""), 10) || DB_BACKUP_DEFAULTS.keepBackups));
  const items = listBackups();
  if (items.length <= maxKeep) return;
  items.slice(maxKeep).forEach((backup) => deleteBackupFiles(backup));
}

async function runPgDumpToFile(connectionString, outFile) {
  const parts = getDbConnectionParts(connectionString);
  if (!parts || !parts.database) {
    throw new Error("Invalid database connection for backup.");
  }
  const pgDump = resolvePgToolBinary("pg_dump");
  const env = {
    ...process.env,
    PGPASSWORD: parts.password || process.env.PGPASSWORD || "",
  };
  const args = [
    "-h",
    parts.host,
    "-p",
    String(parts.port),
    "-U",
    parts.user,
    "-d",
    parts.database,
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    outFile,
  ];
  await runCommand(pgDump, args, { env, cwd: AI_SERVER_DIR });
}

async function runPgRestoreFromFile(connectionString, dumpFile) {
  const parts = getDbConnectionParts(connectionString);
  if (!parts || !parts.database) {
    throw new Error("Invalid database connection for restore.");
  }
  const pgRestore = resolvePgToolBinary("pg_restore");
  const env = {
    ...process.env,
    PGPASSWORD: parts.password || process.env.PGPASSWORD || "",
  };
  const args = [
    "-h",
    parts.host,
    "-p",
    String(parts.port),
    "-U",
    parts.user,
    "-d",
    parts.database,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    dumpFile,
  ];
  await runCommand(pgRestore, args, { env, cwd: AI_SERVER_DIR });
}

async function loadDbBackupConfigFromStore() {
  const cfg = await loadOpcConfigFromStore();
  const runtime = cfg?.runtime && typeof cfg.runtime === "object" ? cfg.runtime : {};
  const backup = runtime?.databaseBackup && typeof runtime.databaseBackup === "object" ? runtime.databaseBackup : {};
  return normalizeDbBackupConfig(backup);
}

async function saveDbBackupConfigToStore(nextConfigRaw = {}) {
  const nextConfig = normalizeDbBackupConfig(nextConfigRaw);
  const cfg = await loadOpcConfigFromStore();
  const runtime = cfg?.runtime && typeof cfg.runtime === "object" ? cfg.runtime : {};
  const next = {
    ...(cfg && typeof cfg === "object" ? cfg : {}),
    runtime: {
      ...runtime,
      databaseBackup: nextConfig,
    },
  };
  await saveOpcConfigToStore(next);
  dbBackupState = nextConfig;
  return nextConfig;
}

async function runDatabaseBackup(options = {}) {
  if (DB_CLIENT !== "postgres") {
    throw new Error("Database backup is currently supported for postgres runtime only.");
  }
  const now = Date.now();
  const id = makeBackupId(now);
  const reason = String(options?.reason || "manual").trim() || "manual";
  ensureDirectoryExists(DB_BACKUP_DIR);
  const main = getDbConnectionParts(DATABASE_URL);
  if (!main || !main.database) {
    throw new Error("Main database is not configured.");
  }
  const includeTrend = options?.includeTrendDb !== false && dbBackupState.includeTrendDb !== false;
  const files = [];
  const mainFileName = `${id}__${safeBackupToken(main.database || "main")}.dump`;
  const mainFileAbs = path.resolve(DB_BACKUP_DIR, mainFileName);
  await runPgDumpToFile(DATABASE_URL, mainFileAbs);
  files.push({
    kind: "main",
    dbName: String(main.database || ""),
    fileName: mainFileName,
    sizeBytes: fs.existsSync(mainFileAbs) ? Number(fs.statSync(mainFileAbs).size || 0) : 0,
  });

  const trendSameAsMain =
    String(TREND_DATABASE_URL || "").trim() &&
    String(TREND_DATABASE_URL || "").trim() === String(DATABASE_URL || "").trim();
  if (includeTrend && TREND_DATABASE_URL && !trendSameAsMain) {
    const trend = getDbConnectionParts(TREND_DATABASE_URL);
    if (trend && trend.database) {
      const trendFileName = `${id}__${safeBackupToken(trend.database || "trend")}.dump`;
      const trendFileAbs = path.resolve(DB_BACKUP_DIR, trendFileName);
      await runPgDumpToFile(TREND_DATABASE_URL, trendFileAbs);
      files.push({
        kind: "trend",
        dbName: String(trend.database || ""),
        fileName: trendFileName,
        sizeBytes: fs.existsSync(trendFileAbs) ? Number(fs.statSync(trendFileAbs).size || 0) : 0,
      });
    }
  }

  const manifest = { id, createdAt: now, reason, files };
  const manifestPath = path.resolve(DB_BACKUP_DIR, `${id}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const redundancyEnabled = dbBackupState.redundancyEnabled === true;
  if (redundancyEnabled) {
    const mirror = copyBackupToRedundantStorage(manifest);
    manifest.redundancy = {
      enabled: true,
      copies: Number(mirror?.copies || 1) || 1,
      mirroredAt: Date.now(),
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  const nextCfg = normalizeDbBackupConfig({ ...dbBackupState, lastRunAt: now });
  await saveDbBackupConfigToStore(nextCfg);
  pruneBackupHistory(nextCfg.keepBackups);
  return manifest;
}

async function runDatabaseRestore(backupId = "") {
  if (DB_CLIENT !== "postgres") {
    throw new Error("Database restore is currently supported for postgres runtime only.");
  }
  const backup = findBackupById(backupId);
  if (!backup) throw new Error("Backup not found.");
  const mainFile = backup.files.find((f) => String(f?.kind || "") === "main");
  if (!mainFile?.fileName) throw new Error("Main database dump not found in backup.");
  const mainAbs = resolveBackupFilePathWithRedundancy(mainFile.fileName);
  if (!mainAbs || !fs.existsSync(mainAbs)) {
    throw new Error("Main backup dump file is missing.");
  }
  await runPgRestoreFromFile(DATABASE_URL, mainAbs);

  const trendFile = backup.files.find((f) => String(f?.kind || "") === "trend");
  const trendSameAsMain =
    String(TREND_DATABASE_URL || "").trim() &&
    String(TREND_DATABASE_URL || "").trim() === String(DATABASE_URL || "").trim();
  if (trendFile?.fileName && TREND_DATABASE_URL && !trendSameAsMain) {
    const trendAbs = resolveBackupFilePathWithRedundancy(trendFile.fileName);
    if (trendAbs && fs.existsSync(trendAbs)) {
      await runPgRestoreFromFile(TREND_DATABASE_URL, trendAbs);
    }
  }
  return { ok: true, backupId: backup.id, restoredAt: Date.now() };
}

function scheduleDatabaseBackups() {
  if (dbBackupTimer) {
    clearInterval(dbBackupTimer);
    dbBackupTimer = null;
  }
  dbBackupTimer = setInterval(() => {
    const state = normalizeDbBackupConfig(dbBackupState);
    if (!state.enabled || dbBackupInFlight) return;
    const now = Date.now();
    const lastRunAt = Number(state.lastRunAt || 0);
    const dueMs = Math.max(15 * 60 * 1000, Number(state.intervalMinutes || DB_BACKUP_DEFAULTS.intervalMinutes) * 60 * 1000);
    if (lastRunAt > 0 && now - lastRunAt < dueMs) return;
    dbBackupInFlight = true;
    runDatabaseBackup({ reason: "auto", includeTrendDb: state.includeTrendDb })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`Auto backup failed: ${String(err?.message || err)}`);
      })
      .finally(() => {
        dbBackupInFlight = false;
      });
  }, 60 * 1000);
}

async function rebuildDatabasePool(connectionString, poolMax = DB_POOL_MAX) {
  if (DB_CLIENT !== "postgres") {
    throw new Error("Runtime pool rebuild currently supports postgres only.");
  }
  const safeConn = String(connectionString || "").trim();
  if (!safeConn) throw new Error("DATABASE_URL is required.");
  const nextPool = new Pool({
    connectionString: safeConn,
    max: Math.max(1, Number.parseInt(String(poolMax || DB_POOL_MAX), 10) || DB_POOL_MAX),
  });
  if (typeof nextPool.setMaxListeners === "function") {
    nextPool.setMaxListeners(DB_POOL_MAX_LISTENERS);
  }
  try {
    await nextPool.query("SELECT 1");
  } catch (err) {
    await nextPool.end().catch(() => {});
    throw err;
  }

  const oldPool = pool;
  const trendUsedOldPool = trendPool === oldPool;
  pool = nextPool;
  DATABASE_URL = safeConn;
  DB_POOL_MAX = Math.max(1, Number.parseInt(String(poolMax || DB_POOL_MAX), 10) || DB_POOL_MAX);
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.DB_POOL_MAX = String(DB_POOL_MAX);
  if (oldPool) {
    oldPool.end().catch(() => {});
  }
  if (trendUsedOldPool) {
    trendPool = pool;
  }
}

async function rebuildAuxDatabasePools(
  trendConnectionString = TREND_DATABASE_URL,
  trendPoolMax = TREND_DB_POOL_MAX,
  logConnectionString = LOG_DATABASE_URL,
  logPoolMax = LOG_DB_POOL_MAX
) {
  if (DB_CLIENT !== "postgres") {
    throw new Error("Runtime pool rebuild currently supports postgres only.");
  }
  const mainConn = String(DATABASE_URL || "").trim();
  const nextTrendConn = String(trendConnectionString || "").trim() || mainConn;
  const nextLogConn = String(logConnectionString || "").trim() || mainConn;
  const nextTrendPoolMax = Math.max(
    1,
    Number.parseInt(String(trendPoolMax || TREND_DB_POOL_MAX || DB_POOL_MAX), 10) || TREND_DB_POOL_MAX || DB_POOL_MAX
  );
  const nextLogPoolMax = Math.max(
    1,
    Number.parseInt(String(logPoolMax || LOG_DB_POOL_MAX || DB_POOL_MAX), 10) || LOG_DB_POOL_MAX || DB_POOL_MAX
  );

  const sameTrendAsMain = nextTrendConn === mainConn;
  const sameLogAsMain = nextLogConn === mainConn;
  const sameLogAsTrend = !sameLogAsMain && nextLogConn === nextTrendConn;

  let nextTrendPool = sameTrendAsMain ? pool : null;
  let nextLogPool = sameLogAsMain ? pool : null;
  let createdTrendPool = null;
  let createdLogPool = null;

  try {
    if (!sameTrendAsMain) {
      createdTrendPool = new Pool({
        connectionString: nextTrendConn,
        max: nextTrendPoolMax,
      });
      if (typeof createdTrendPool.setMaxListeners === "function") {
        createdTrendPool.setMaxListeners(DB_POOL_MAX_LISTENERS);
      }
      await createdTrendPool.query("SELECT 1");
      nextTrendPool = createdTrendPool;
    }

    if (sameLogAsTrend) {
      nextLogPool = nextTrendPool;
    } else if (!sameLogAsMain) {
      createdLogPool = new Pool({
        connectionString: nextLogConn,
        max: nextLogPoolMax,
      });
      if (typeof createdLogPool.setMaxListeners === "function") {
        createdLogPool.setMaxListeners(DB_POOL_MAX_LISTENERS);
      }
      await createdLogPool.query("SELECT 1");
      nextLogPool = createdLogPool;
    }
  } catch (err) {
    if (createdLogPool) createdLogPool.end().catch(() => {});
    if (createdTrendPool) createdTrendPool.end().catch(() => {});
    throw err;
  }

  const oldTrendPool = trendPool;
  const oldLogPool = logPool;
  trendPool = nextTrendPool || pool;
  logPool = nextLogPool || pool;

  TREND_DATABASE_URL = nextTrendConn || mainConn;
  TREND_DB_POOL_MAX = nextTrendPoolMax;
  LOG_DATABASE_URL = nextLogConn || mainConn;
  LOG_DB_POOL_MAX = nextLogPoolMax;
  process.env.TREND_DATABASE_URL = TREND_DATABASE_URL;
  process.env.TREND_DB_POOL_MAX = String(TREND_DB_POOL_MAX);
  process.env.LOG_DATABASE_URL = LOG_DATABASE_URL;
  process.env.LOG_DB_POOL_MAX = String(LOG_DB_POOL_MAX);

  const poolsToKeep = new Set([pool, trendPool, logPool].filter(Boolean));
  if (oldTrendPool && !poolsToKeep.has(oldTrendPool)) oldTrendPool.end().catch(() => {});
  if (oldLogPool && !poolsToKeep.has(oldLogPool)) oldLogPool.end().catch(() => {});
}

async function ensureSystemVersionState() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_version_state (
      id SMALLINT PRIMARY KEY,
      app_version TEXT NOT NULL,
      db_version TEXT NOT NULL,
      expected_db_version TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(
    `
    INSERT INTO system_version_state (id, app_version, db_version, expected_db_version, updated_at)
    VALUES (1, $1, $2, $2, now())
    ON CONFLICT (id) DO NOTHING;
  `,
    [APP_VERSION, EXPECTED_DB_VERSION]
  );
  await pool.query(
    `
    UPDATE system_version_state
    SET app_version = $1,
        expected_db_version = $2,
        db_version = CASE WHEN $3 THEN $2 ELSE db_version END,
        updated_at = now()
    WHERE id = 1;
  `,
    [APP_VERSION, EXPECTED_DB_VERSION, AUTO_ALIGN_DB_VERSION]
  );
}

async function getSystemVersionState() {
  if (!pool) {
    return {
      appVersion: APP_VERSION,
      dbVersion: "",
      expectedDbVersion: EXPECTED_DB_VERSION,
      aligned: false,
      autoAlign: AUTO_ALIGN_DB_VERSION,
      updatedAt: "",
    };
  }
  await ensureSystemVersionState();
  const result = await pool.query(
    "SELECT app_version, db_version, expected_db_version, updated_at::text AS updated_at FROM system_version_state WHERE id = 1 LIMIT 1"
  );
  const row = result.rows?.[0] || {};
  const appVersion = String(row?.app_version || APP_VERSION);
  const dbVersion = String(row?.db_version || "");
  const expectedDbVersion = String(row?.expected_db_version || EXPECTED_DB_VERSION);
  const aligned = !!dbVersion && dbVersion === expectedDbVersion && appVersion === APP_VERSION;
  return {
    appVersion,
    dbVersion,
    expectedDbVersion,
    aligned,
    autoAlign: AUTO_ALIGN_DB_VERSION,
    updatedAt: String(row?.updated_at || ""),
  };
}

async function runDatabaseMaintenance() {
  if (!pool || dbMaintenanceInFlight) return;
  dbMaintenanceInFlight = true;
  try {
    await pool.query("DELETE FROM user_sessions WHERE expires_at < now()");

    const chatCutoff = new Date(Date.now() - SUPPORT_CHAT_RETENTION_MS).toISOString();
    await pool.query("DELETE FROM support_chat_messages WHERE created_at < $1::timestamptz", [chatCutoff]);
    await pool.query(
      `
      WITH keep AS (
        SELECT id
        FROM support_chat_messages
        ORDER BY created_at DESC, id DESC
        LIMIT $1
      )
      DELETE FROM support_chat_messages m
      WHERE NOT EXISTS (SELECT 1 FROM keep k WHERE k.id = m.id)
      `,
      [SUPPORT_CHAT_MAX_ROWS]
    );

    const trendCutoff = Date.now() - OPC_TREND_RETENTION_MS;
    const trendDb = trendPool || pool;
    if (trendDb) {
      await ensureTrendChunkTable(trendDb, getTrendChunkTableNameForTimestamp(Date.now()));
      const trendTables = await listTrendChunkTables(trendDb, { refresh: true, includeLegacy: true });
      for (const tableName of trendTables) {
        await trendDb.query(`DELETE FROM ${quoteTrendChunkTable(tableName)} WHERE to_ts < $1`, [trendCutoff]);
      }
    }
  } catch {
    // ignore maintenance errors
  } finally {
    dbMaintenanceInFlight = false;
  }
}

const PROJECT_CURSOR_TTL_MS = 10_000;
const projectCursorPresence = new Map();
const USER_PRESENCE_TTL_MS = 15_000;
const userPresence = new Map();
const REPORT_QUERY_TIMEOUT_MS = Math.max(
  1000,
  Math.min(120000, Number.parseInt(String(process.env.REPORT_QUERY_TIMEOUT_MS || "12000"), 10) || 12000)
);
const REPORT_MAX_RESULT_ROWS = Math.max(
  1,
  Math.min(20000, Number.parseInt(String(process.env.REPORT_MAX_RESULT_ROWS || "2000"), 10) || 2000)
);
const REPORT_MAX_CONCURRENT_QUERIES = Math.max(
  1,
  Math.min(50, Number.parseInt(String(process.env.REPORT_MAX_CONCURRENT_QUERIES || "3"), 10) || 3)
);
const REPORT_RATE_WINDOW_MS = Math.max(
  1000,
  Math.min(300000, Number.parseInt(String(process.env.REPORT_RATE_WINDOW_MS || "10000"), 10) || 10000)
);
const REPORT_RATE_MAX_REQUESTS = Math.max(
  1,
  Math.min(200, Number.parseInt(String(process.env.REPORT_RATE_MAX_REQUESTS || "6"), 10) || 6)
);
let reportActiveQueries = 0;
const reportRateByUser = new Map();

function clampReportQueryTimeoutMs(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return REPORT_QUERY_TIMEOUT_MS;
  return Math.max(1000, Math.min(120000, parsed));
}

function clampReportMaxRows(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return REPORT_MAX_RESULT_ROWS;
  return Math.max(1, Math.min(20000, parsed));
}

function clampReportMaxConcurrentQueries(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return REPORT_MAX_CONCURRENT_QUERIES;
  return Math.max(1, Math.min(50, parsed));
}

function clampReportRateWindowMs(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return REPORT_RATE_WINDOW_MS;
  return Math.max(1000, Math.min(300000, parsed));
}

function clampReportRateMaxRequests(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return REPORT_RATE_MAX_REQUESTS;
  return Math.max(1, Math.min(200, parsed));
}

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

function cleanupUserPresence() {
  const now = Date.now();
  for (const [userId, entry] of userPresence.entries()) {
    if (!entry || now - Number(entry.at || 0) > USER_PRESENCE_TTL_MS) {
      userPresence.delete(userId);
    }
  }
}

function isStatementTimeoutError(err) {
  return String(err?.code || "") === "57014" || /statement timeout/i.test(String(err?.message || ""));
}

function makeReportThrottleError(message, statusCode = 429) {
  const err = new Error(String(message || "Too many report queries."));
  err.statusCode = statusCode;
  err.viziThrottle = true;
  return err;
}

function enforceReportRateLimit(userId, options = {}) {
  const windowMs = clampReportRateWindowMs(options?.rateWindowMs);
  const maxRequests = clampReportRateMaxRequests(options?.rateMaxRequests);
  const key = String(userId || "").trim() || "anonymous";
  const now = Date.now();
  const prev = Array.isArray(reportRateByUser.get(key)) ? reportRateByUser.get(key) : [];
  const active = prev.filter((ts) => Number.isFinite(Number(ts)) && now - Number(ts) < windowMs);
  if (active.length >= maxRequests) {
    throw makeReportThrottleError(
      `Too many report queries. Try again in a few seconds (limit ${maxRequests} per ${Math.round(
        windowMs / 1000
      )}s).`
    );
  }
  active.push(now);
  reportRateByUser.set(key, active);
}

function acquireReportQuerySlot(options = {}) {
  const maxConcurrent = clampReportMaxConcurrentQueries(options?.maxConcurrentQueries);
  if (reportActiveQueries >= maxConcurrent) {
    throw makeReportThrottleError(
      `Report query queue is full. Wait for active queries to finish (max concurrent ${maxConcurrent}).`
    );
  }
  reportActiveQueries += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reportActiveQueries = Math.max(0, reportActiveQueries - 1);
  };
}

async function runReadOnlyQueryWithGuards(sql, values = [], options = {}) {
  const timeoutMs = Math.max(
    1000,
    Math.min(120000, Number.parseInt(String(options?.timeoutMs || REPORT_QUERY_TIMEOUT_MS), 10) || REPORT_QUERY_TIMEOUT_MS)
  );
  const maxRows = Math.max(
    1,
    Math.min(20000, Number.parseInt(String(options?.maxRows || REPORT_MAX_RESULT_ROWS), 10) || REPORT_MAX_RESULT_ROWS)
  );
  const guardedSql = `SELECT * FROM (${String(sql || "")}) AS __vizi_guard LIMIT ${maxRows}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = ${timeoutMs}`);
    await client.query(`SET LOCAL lock_timeout = ${Math.min(timeoutMs, 5000)}`);
    const result = await client.query(guardedSql, Array.isArray(values) ? values : []);
    await client.query("COMMIT");
    return {
      result,
      timeoutMs,
      maxRows,
      truncated: Array.isArray(result?.rows) && result.rows.length >= maxRows,
    };
  } catch (err) {
    if (isStatementTimeoutError(err)) {
      err.viziTimeoutMs = timeoutMs;
    }
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failures
    }
    throw err;
  } finally {
    client.release();
  }
}

async function loadReportSqlGuardSettings() {
  let timeoutMs = REPORT_QUERY_TIMEOUT_MS;
  let maxRows = REPORT_MAX_RESULT_ROWS;
  let maxConcurrentQueries = REPORT_MAX_CONCURRENT_QUERIES;
  let rateWindowMs = REPORT_RATE_WINDOW_MS;
  let rateMaxRequests = REPORT_RATE_MAX_REQUESTS;
  try {
    const { rows } = await pool.query("SELECT config FROM opc_config WHERE id = 1 LIMIT 1");
    const runtime = rows?.[0]?.config?.runtime;
    if (runtime && typeof runtime === "object") {
      timeoutMs = clampReportQueryTimeoutMs(runtime.reportQueryTimeoutMs);
      maxRows = clampReportMaxRows(runtime.reportMaxResultRows);
      maxConcurrentQueries = clampReportMaxConcurrentQueries(runtime.reportMaxConcurrentQueries);
      rateWindowMs = clampReportRateWindowMs(runtime.reportRateWindowMs);
      rateMaxRequests = clampReportRateMaxRequests(runtime.reportRateMaxRequests);
    }
  } catch {
    // fall back to env defaults
  }
  return { timeoutMs, maxRows, maxConcurrentQueries, rateWindowMs, rateMaxRequests };
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

app.get("/api/weather/current", async (req, res) => {
  try {
    const locationRaw = String(req.query?.location || "").trim();
    const unitRaw = String(req.query?.unit || "F").trim().toUpperCase();
    const location = locationRaw || "Chicago, IL";
    const unitLabel = unitRaw === "C" ? "C" : "F";
    const tempUnit = unitLabel === "C" ? "celsius" : "fahrenheit";

    const directCoords = (() => {
      const m = String(location || "").match(
        /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/
      );
      if (!m) return null;
      const latN = Number(m[1]);
      const lonN = Number(m[2]);
      if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return null;
      return { latitude: latN, longitude: lonN, name: `${latN.toFixed(4)}, ${lonN.toFixed(4)}` };
    })();

    const tryGeocode = async (name) => {
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
        name
      )}&count=5&language=en&format=json`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) return null;
      const geoData = await geoRes.json().catch(() => null);
      const results = Array.isArray(geoData?.results) ? geoData.results : [];
      if (!results.length) return null;
      const preferred = results.find((r) => String(r?.country_code || "").trim().toUpperCase() === "US") || results[0];
      return preferred || null;
    };

    let row = directCoords;
    if (!row) {
      row = await tryGeocode(location);
    }
    if (!row) {
      const hasCountryHint = /\b(usa|u\.s\.a|united states|us)\b/i.test(location);
      if (!hasCountryHint) {
        row = await tryGeocode(`${location}, United States`);
      }
    }

    const lat = Number(row?.latitude);
    const lon = Number(row?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(404).json({ error: "Weather location not found." });
    }

    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(
        lat
      )}&longitude=${encodeURIComponent(lon)}` +
      `&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&temperature_unit=${tempUnit}&wind_speed_unit=mph`;
    const weatherRes = await fetch(weatherUrl);
    if (!weatherRes.ok) {
      return res.status(502).json({ error: "Weather data request failed." });
    }
    const weatherData = await weatherRes.json().catch(() => null);
    const cur = weatherData?.current || {};
    const payload = {
      location:
        [
          String(row?.name || "").trim(),
          String(row?.admin1 || "").trim(),
          String(row?.country_code || row?.country || "").trim(),
        ]
          .filter(Boolean)
          .join(", ") || location,
      temp: Number.isFinite(Number(cur?.temperature_2m)) ? Number(cur.temperature_2m) : null,
      humidity: Number.isFinite(Number(cur?.relative_humidity_2m))
        ? Number(cur.relative_humidity_2m)
        : null,
      windMph: Number.isFinite(Number(cur?.wind_speed_10m)) ? Number(cur.wind_speed_10m) : null,
      weatherCode: Number.isFinite(Number(cur?.weather_code)) ? Number(cur.weather_code) : null,
      unit: unitLabel,
      fetchedAt: Date.now(),
    };
    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Weather fetch failed." });
  }
});

app.get("/api/opc/config", async (req, res) => {
  try {
    const requestedKeys = parseOpcStatusRequestedKeys(req.query?.keys || "");
    const { rows } = await pool.query(
      "SELECT config, updated_at FROM opc_config WHERE id = 1"
    );
    if (rows.length) {
      const row = rows[0] || {};
      // DB is the source of truth after row creation. Do not rehydrate from file here,
      // otherwise user deletions can be unintentionally restored from stale config.json.
      const configObj = row.config && typeof row.config === "object" ? row.config : {};
      if (!requestedKeys.length) {
        res.json(configObj);
        return;
      }
      const srcTags = Array.isArray(configObj?.tags) ? configObj.tags : [];
      const requestedLowers = requestedKeys
        .map((k) => normalizeOpcStatusKey(k).toLowerCase())
        .filter(Boolean);
      const keySet = new Set(requestedLowers);
      const matchesRequestedKey = (candidateLower) => {
        if (!candidateLower) return false;
        if (keySet.has(candidateLower)) return true;
        for (const requested of requestedLowers) {
          if (!requested) continue;
          const prefixDot = `${requested}.`;
          const prefixSlash = `${requested}/`;
          if (
            candidateLower.startsWith(prefixDot) ||
            candidateLower.startsWith(prefixSlash) ||
            candidateLower.endsWith(`.${requested}`) ||
            candidateLower.endsWith(`/${requested}`) ||
            candidateLower.includes(`.${requested}.`) ||
            candidateLower.includes(`.${requested}/`) ||
            candidateLower.includes(`/${requested}.`) ||
            candidateLower.includes(`/${requested}/`)
          ) {
            return true;
          }
        }
        return false;
      };
      const filteredTags = srcTags.filter((tag) => {
        const topic = normalizeOpcStatusKey(tag?.topic || "");
        const group = normalizeOpcStatusKey(tag?.groupName || "");
        const tagPath = normalizeOpcStatusKey(tag?.tagPath || "");
        const name = normalizeOpcStatusKey(tag?.name || "");
        const candidates = [
          topic && group && tagPath ? `${topic}.${group}.${tagPath}` : "",
          topic && group && name ? `${topic}.${group}.${name}` : "",
          topic && tagPath ? `${topic}.${tagPath}` : "",
          topic && name ? `${topic}.${name}` : "",
          group && tagPath ? `${group}.${tagPath}` : "",
          group && name ? `${group}.${name}` : "",
          tagPath,
          name,
        ]
          .map((x) => normalizeOpcStatusKey(x).toLowerCase())
          .filter(Boolean);
        return candidates.some(matchesRequestedKey);
      });
      res.json({
        ...configObj,
        tags: filteredTags,
        scoped: true,
        requestedKeyCount: requestedKeys.length,
      });
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
    logOpcError("load config", err);
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
    const tags = Array.isArray(next?.tags) ? next.tags : [];
    const equipmentByTagPath = new Map();
    for (const tag of tags) {
      const topic = String(tag?.topic || "").trim();
      const group = String(tag?.groupName || "").trim();
      if (!topic || !group) continue;
      const tagPath = `${topic}.${group}`;
      const key = String(tagPath).toLowerCase();
      if (equipmentByTagPath.has(key)) continue;
      const fallbackName = String(group || topic).trim();
      const type = String(tag?.plcType || tag?.uaType || "").trim();
      equipmentByTagPath.set(key, {
        tagPath,
        name: fallbackName,
        type,
      });
    }
    await pool.query("BEGIN");
    try {
      for (const row of equipmentByTagPath.values()) {
        const updated = await pool.query(
          `
          UPDATE equipment
          SET
            name = CASE
              WHEN COALESCE(NULLIF(TRIM(name), ''), '') = '' THEN $1
              ELSE name
            END,
            type = CASE
              WHEN COALESCE(NULLIF(TRIM(type), ''), '') = '' THEN $2
              ELSE type
            END,
            tag_sync_managed = true
          WHERE tag_path = $3
          `,
          [row.name, row.type, row.tagPath]
        );
        if (!updated.rowCount) {
          await pool.query(
            `
            INSERT INTO equipment (name, type, visible, "new", tag_path, tag_sync_managed)
            VALUES ($1, $2, true, false, $3, true)
            `,
            [row.name, row.type, row.tagPath]
          );
        }
      }
      const activeTagPaths = Array.from(equipmentByTagPath.values()).map((row) => row.tagPath);
      await pool.query(
        `
        DELETE FROM equipment
        WHERE tag_sync_managed = true
          AND COALESCE(NULLIF(TRIM(tag_path), ''), '') <> ''
          AND NOT (tag_path = ANY($1::text[]))
        `,
        [activeTagPaths]
      );
      await pool.query("COMMIT");
    } catch (syncErr) {
      await pool.query("ROLLBACK");
      throw syncErr;
    }
    res.json({ ok: true });
  } catch (err) {
    logOpcError("save config", err);
    res.status(500).json({ error: err?.message || "Failed to save OPC config." });
  }
});

app.get("/api/projects", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT p.id, p.name, p.updated_at, p.updated_by, u.username AS updated_by_username
      FROM project p
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
      FROM project p
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

app.post("/api/presence/ping", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const username = String(req.user?.username || "").trim() || "User";
    const displayName = String(req.user?.display_name || "").trim();
    const avatarUrl = String(req.user?.avatar_url || "").trim();
    userPresence.set(String(userId), {
      user_id: userId,
      username,
      display_name: displayName,
      avatar_url: avatarUrl,
      at: Date.now(),
    });
    cleanupUserPresence();
    const users = Array.from(userPresence.values())
      .map((entry) => ({
        user_id: entry.user_id,
        username: entry.username,
        display_name: entry.display_name || "",
        avatar_url: entry.avatar_url || "",
        at: entry.at,
      }))
      .sort((a, b) => {
        const aName = String(a.display_name || a.username || "").toLowerCase();
        const bName = String(b.display_name || b.username || "").toLowerCase();
        return aName.localeCompare(bName);
      });
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to update user presence." });
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
        "SELECT id FROM project WHERE name = $1 AND id <> $2",
        [name, incomingId]
      );
      if (nameRows.length) {
        res.status(409).json({ error: "Project name already exists." });
        return;
      }
      const { rows: existingRows } = await pool.query(
        `
        SELECT p.id, p.name, p.data, p.updated_at, p.updated_by, u.username AS updated_by_username
        FROM project p
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
        INSERT INTO project (id, name, data, updated_by)
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
        FROM project p
        LEFT JOIN users u ON u.id = p.updated_by
        WHERE p.id = $1
        `,
        [id]
      );
      const saved = rows[0] || null;
      if (saved) {
        await saveProjectVersion({
          projectId: saved.id,
          userId,
          baseUpdatedAtIso: hasBaseUpdatedAt ? new Date(baseUpdatedAtMs).toISOString() : null,
          previousData: existing?.data || {},
          nextData: saved?.data || {},
        });
      }
      res.json({ project: rows[0] });
      return;
    }
    const { rows: existingByName } = await pool.query(
      `
      SELECT p.id, p.name, p.data, p.updated_at, p.updated_by, u.username AS updated_by_username
      FROM project p
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
      INSERT INTO project (id, name, data, updated_by)
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
      FROM project p
      LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.name = $1
      `,
      [name]
    );
    const saved = rows[0] || null;
    if (saved) {
      await saveProjectVersion({
        projectId: saved.id,
        userId,
        baseUpdatedAtIso: hasBaseUpdatedAt ? new Date(baseUpdatedAtMs).toISOString() : null,
        previousData: existing?.data || {},
        nextData: saved?.data || {},
      });
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
    await pool.query("DELETE FROM project WHERE id = $1", [id]);
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
    logOpcError("restart request", err);
    res.status(500).json({ error: err?.message || "Failed to request restart." });
  }
});

const opcStatusCache = {
  status: null,
  updatedAtMs: 0,
};
const OPC_STATUS_DB_WRITE_MIN_INTERVAL_MS = Math.max(
  200,
  Number.parseInt(String(process.env.OPC_STATUS_DB_WRITE_MIN_INTERVAL_MS || "1000"), 10) || 1000
);
let opcStatusDbLastWriteAtMs = 0;
let opcStatusDbPersistInFlight = false;
let opcStatusDbPersistTimer = null;
let opcStatusDbPendingStatus = null;
const OPC_STATUS_STREAM_HEARTBEAT_MS = 15000;
let opcStatusStreamClientSeq = 0;
const opcStatusStreamClients = new Map();
const OPC_PRIORITY_KEY_CAP = Math.max(
  100,
  Number.parseInt(String(process.env.OPC_PRIORITY_KEY_CAP || "1200"), 10) || 1200
);
const opcPriorityHints = {
  keys: [],
  updatedAt: 0,
  screenId: "",
  mode: "",
  source: "",
};

function diffOpcStatusMap(prevMap, nextMap) {
  const prev = prevMap && typeof prevMap === "object" ? prevMap : {};
  const next = nextMap && typeof nextMap === "object" ? nextMap : {};
  const out = {};
  let changed = false;
  Object.keys(next).forEach((key) => {
    const prevHas = Object.prototype.hasOwnProperty.call(prev, key);
    if (!prevHas || !Object.is(prev[key], next[key])) {
      out[key] = next[key];
      changed = true;
    }
  });
  Object.keys(prev).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      out[key] = null;
      changed = true;
    }
  });
  return changed ? out : null;
}

function sendOpcStatusSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function notifyOpcStatusStreamClients(nextStatus, prevStatus = null) {
  if (!opcStatusStreamClients.size) return;
  const nextSafe = nextStatus && typeof nextStatus === "object" ? nextStatus : {};
  const prevSafe = prevStatus && typeof prevStatus === "object" ? prevStatus : {};
  opcStatusStreamClients.forEach((client, id) => {
    try {
      const scopedNext = client.keys.length ? filterOpcStatusByKeys(nextSafe, client.keys) : nextSafe;
      const basePrev = client.lastStatus && typeof client.lastStatus === "object"
        ? client.lastStatus
        : (client.keys.length ? filterOpcStatusByKeys(prevSafe, client.keys) : prevSafe);
      const valuesDelta = diffOpcStatusMap(basePrev?.values, scopedNext?.values);
      const errorsDelta = diffOpcStatusMap(basePrev?.errors, scopedNext?.errors);
      const qualitiesDelta = diffOpcStatusMap(basePrev?.qualities, scopedNext?.qualities);
      const diagnosticsDelta = diffOpcStatusMap(basePrev?.diagnostics, scopedNext?.diagnostics);
      if (!valuesDelta && !errorsDelta && !qualitiesDelta && !diagnosticsDelta) return;
      sendOpcStatusSse(client.res, {
        type: "delta",
        at: scopedNext?.at || Date.now(),
        connected: scopedNext?.connected === true,
        stale: scopedNext?.stale === true,
        staleAgeMs: Number(scopedNext?.staleAgeMs || 0) || 0,
        bridgeFallback: scopedNext?.bridgeFallback === true,
        values: valuesDelta || {},
        errors: errorsDelta || {},
        qualities: qualitiesDelta || {},
        diagnostics: diagnosticsDelta || {},
      });
      client.lastStatus = scopedNext;
    } catch {
      try {
        client.res.end();
      } catch {
        // ignore
      }
      opcStatusStreamClients.delete(id);
    }
  });
}

function writeOpcStatusCache(status, updatedAtRaw = null) {
  const safeStatus = status && typeof status === "object" && !Array.isArray(status) ? status : null;
  if (!safeStatus) return;
  const prev = opcStatusCache.status && typeof opcStatusCache.status === "object" ? opcStatusCache.status : null;
  const updatedAtMs = parseTimestampMs(updatedAtRaw);
  opcStatusCache.status = safeStatus;
  opcStatusCache.updatedAtMs =
    Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : Date.now();
  notifyOpcStatusStreamClients(safeStatus, prev);
}

function getOpcStatusFromCache() {
  return opcStatusCache.status && typeof opcStatusCache.status === "object"
    ? opcStatusCache.status
    : {};
}

async function loadPersistedOpcStatusRow() {
  if (!OPC_PERSIST_LIVE_STATUS) return null;
  const { rows } = await pool.query(
    "SELECT status, updated_at::text AS updated_at FROM opc_status WHERE id = 1 LIMIT 1"
  );
  if (!rows.length || !rows[0]?.status || typeof rows[0].status !== "object") return null;
  return rows[0];
}

async function persistOpcStatusToDbNow(status) {
  if (!OPC_PERSIST_LIVE_STATUS) return;
  const safe =
    status && typeof status === "object" && !Array.isArray(status)
      ? status
      : { values: {}, errors: {}, qualities: {}, diagnostics: {}, connected: false, at: Date.now() };
  await pool.query(
    `
      INSERT INTO opc_status (id, status, updated_at)
      VALUES (1, $1::jsonb, now())
      ON CONFLICT (id)
      DO UPDATE SET status = EXCLUDED.status, updated_at = now()
      `,
    [JSON.stringify(safe)]
  );
  opcStatusDbLastWriteAtMs = Date.now();
}

function scheduleOpcStatusDbPersist(status) {
  if (!OPC_PERSIST_LIVE_STATUS) return;
  opcStatusDbPendingStatus = status;
  const run = async () => {
    if (opcStatusDbPersistInFlight) return;
    const now = Date.now();
    const waitMs = Math.max(0, OPC_STATUS_DB_WRITE_MIN_INTERVAL_MS - (now - opcStatusDbLastWriteAtMs));
    if (waitMs > 0) {
      if (!opcStatusDbPersistTimer) {
        opcStatusDbPersistTimer = setTimeout(() => {
          opcStatusDbPersistTimer = null;
          void run();
        }, waitMs);
      }
      return;
    }
    const next = opcStatusDbPendingStatus;
    if (!next) return;
    opcStatusDbPendingStatus = null;
    opcStatusDbPersistInFlight = true;
    try {
      await persistOpcStatusToDbNow(next);
    } catch (err) {
      logOpcError("persist status", err);
    } finally {
      opcStatusDbPersistInFlight = false;
      if (opcStatusDbPendingStatus) {
        if (!opcStatusDbPersistTimer) {
          opcStatusDbPersistTimer = setTimeout(() => {
            opcStatusDbPersistTimer = null;
            void run();
          }, OPC_STATUS_DB_WRITE_MIN_INTERVAL_MS);
        }
      }
    }
  };
  void run();
}

function normalizeOpcStatusKey(value) {
  return String(value || "").replace(/\r?\n/g, "").trim();
}

function parseOpcStatusRequestedKeys(input) {
  const src = Array.isArray(input)
    ? input
    : typeof input === "string"
    ? String(input)
        .split(",")
        .map((x) => String(x || "").trim())
    : [];
  const out = [];
  const seen = new Set();
  for (const raw of src) {
    const key = normalizeOpcStatusKey(raw);
    if (!key) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(key);
    if (out.length >= 5000) break;
  }
  return out;
}

function filterOpcStatusByKeys(status, requestedKeys = []) {
  const keys = parseOpcStatusRequestedKeys(requestedKeys);
  if (!keys.length) return status;
  const source = status && typeof status === "object" ? status : {};
  const resolveMatches = (obj) => {
    const src = obj && typeof obj === "object" ? obj : {};
    const lowerToActual = new Map();
    const tailToActual = new Map();
    const allActualLowers = [];
    Object.keys(src).forEach((actualKey) => {
      const lower = normalizeOpcStatusKey(actualKey).toLowerCase();
      if (!lower) return;
      if (!lowerToActual.has(lower)) lowerToActual.set(lower, actualKey);
      const tail = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : lower;
      const list = tailToActual.get(tail) || [];
      list.push(actualKey);
      tailToActual.set(tail, list);
      allActualLowers.push(lower);
    });
    const out = {};
    const included = new Set();
    keys.forEach((rawKey) => {
      const requested = normalizeOpcStatusKey(rawKey).toLowerCase();
      if (!requested) return;
      const direct = lowerToActual.get(requested);
      if (direct && !included.has(direct)) {
        out[direct] = src[direct];
        included.add(direct);
        return;
      }
      const tail = requested.includes(".") ? requested.slice(requested.lastIndexOf(".") + 1) : requested;
      const candidates = tailToActual.get(tail) || [];
      let suffixMatched = false;
      for (const candidate of candidates) {
        const candidateLower = normalizeOpcStatusKey(candidate).toLowerCase();
        if (candidateLower === requested || candidateLower.endsWith(`.${requested}`)) {
          if (!included.has(candidate)) {
            out[candidate] = src[candidate];
            included.add(candidate);
          }
          suffixMatched = true;
          return;
        }
      }
      // Prefix match: requested is a group path — include all keys that start with "requested."
      if (!suffixMatched) {
        const prefix = `${requested}.`;
        for (const lower of allActualLowers) {
          if (lower === requested || lower.startsWith(prefix) || lower.endsWith(`.${requested}`) || lower.includes(`.${requested}.`)) {
            const actual = lowerToActual.get(lower);
            if (actual && !included.has(actual)) {
              out[actual] = src[actual];
              included.add(actual);
            }
          }
        }
      }
    });
    return out;
  };
  return {
    ...source,
    values: resolveMatches(source.values),
    errors: resolveMatches(source.errors),
    qualities: resolveMatches(source.qualities),
    diagnostics: resolveMatches(source.diagnostics),
    scoped: true,
    requestedKeyCount: keys.length,
  };
}

async function loadEffectiveOpcStatus() {
  let baseStatus = getOpcStatusFromCache();
  if (!Object.keys(baseStatus).length) baseStatus = null;
  let dbUpdatedAtMs = Number(opcStatusCache.updatedAtMs || 0);

  if (!baseStatus) {
    const row = await loadPersistedOpcStatusRow();
    if (!row?.status) {
      return { values: {}, errors: {}, qualities: {}, diagnostics: {}, at: null, connected: false };
    }
    baseStatus = row.status && typeof row.status === "object" ? row.status : {};
    dbUpdatedAtMs = parseTimestampMs(row?.updated_at);
    writeOpcStatusCache(baseStatus, row?.updated_at);
  }

  const statusAtMs = Number(baseStatus?.at || 0);
  const freshnessAt = Math.max(
    Number.isFinite(statusAtMs) ? statusAtMs : 0,
    Number.isFinite(dbUpdatedAtMs) ? dbUpdatedAtMs : 0
  );
  const staleAgeMs = freshnessAt > 0 ? Math.max(0, Date.now() - freshnessAt) : Number.POSITIVE_INFINITY;
  const isStale = staleAgeMs > OPC_STATUS_STALE_MS;
  let effectiveStatus = baseStatus;
  if (isStale) {
    try {
      const bridgeStatus = await loadBridgeStatusSnapshot();
      const bridgeConnections =
        bridgeStatus?.connections && typeof bridgeStatus.connections === "object"
          ? bridgeStatus.connections
          : {};
      const bridgeConnectedFlag =
        typeof bridgeStatus?.connected === "boolean"
          ? bridgeStatus.connected
          : Object.values(bridgeConnections).some((value) => value === true);
      if (bridgeConnectedFlag) {
        effectiveStatus = {
          ...baseStatus,
          connected: true,
          stale: false,
          staleAgeMs,
          bridgeFallback: true,
          bridgeLastPollAt: bridgeStatus?.lastPollAt || null,
          connections:
            Object.keys(bridgeConnections).length > 0
              ? bridgeConnections
              : baseStatus?.connections,
          runtime:
            bridgeStatus?.runtime && typeof bridgeStatus.runtime === "object"
              ? {
                  ...(baseStatus?.runtime && typeof baseStatus.runtime === "object"
                    ? baseStatus.runtime
                    : {}),
                  ...bridgeStatus.runtime,
                }
              : baseStatus?.runtime,
        };
      } else {
        effectiveStatus = {
          ...baseStatus,
          connected: false,
          stale: true,
          staleAgeMs,
        };
      }
    } catch {
      effectiveStatus = {
        ...baseStatus,
        connected: false,
        stale: true,
        staleAgeMs,
      };
    }
  }
  return effectiveStatus;
}

app.get("/api/opc/priorities", async (_req, res) => {
  try {
    const keys = Array.isArray(opcPriorityHints.keys) ? opcPriorityHints.keys : [];
    res.json({
      keys,
      keyCount: keys.length,
      updatedAt: Number(opcPriorityHints.updatedAt || 0) || null,
      screenId: String(opcPriorityHints.screenId || "").trim(),
      mode: String(opcPriorityHints.mode || "").trim(),
      source: String(opcPriorityHints.source || "").trim(),
    });
  } catch (err) {
    logOpcError("get priorities", err);
    res.status(500).json({ error: err?.message || "Failed to load OPC priorities." });
  }
});

app.post("/api/opc/priorities", async (req, res) => {
  try {
    const requestedKeys = parseOpcStatusRequestedKeys(req.body?.keys).slice(0, OPC_PRIORITY_KEY_CAP);
    const authUser = req.user || (await getUserFromRequest(req));
    const sourceUser = authUser
      ? String(authUser.display_name || authUser.username || `User ${authUser.id || ""}`).trim()
      : "";
    opcPriorityHints.keys = requestedKeys;
    opcPriorityHints.updatedAt = Date.now();
    opcPriorityHints.screenId = String(req.body?.screenId || "").trim();
    opcPriorityHints.mode = String(req.body?.mode || "").trim();
    opcPriorityHints.source = sourceUser || "ui";
    res.json({
      ok: true,
      keyCount: requestedKeys.length,
      updatedAt: opcPriorityHints.updatedAt,
      cap: OPC_PRIORITY_KEY_CAP,
    });
  } catch (err) {
    logOpcError("set priorities", err);
    res.status(500).json({ error: err?.message || "Failed to save OPC priorities." });
  }
});

app.get("/api/opc/status", async (req, res) => {
  try {
    const effectiveStatus = await loadEffectiveOpcStatus();
    const requestedKeys = parseOpcStatusRequestedKeys(req.query?.keys || "");
    const payload = requestedKeys.length ? filterOpcStatusByKeys(effectiveStatus, requestedKeys) : effectiveStatus;
    maybeLogOpcConnectionState(payload);
    res.json(payload);
  } catch (err) {
    logOpcError("load status", err);
    res.status(500).json({ error: err?.message || "Failed to load OPC status." });
  }
});

app.post("/api/opc/status/query", async (req, res) => {
  try {
    const requestedKeys = parseOpcStatusRequestedKeys(req.body?.keys);
    if (!requestedKeys.length) {
      const effectiveStatus = await loadEffectiveOpcStatus();
      maybeLogOpcConnectionState(effectiveStatus);
      res.json(effectiveStatus);
      return;
    }
    const effectiveStatus = await loadEffectiveOpcStatus();
    const payload = filterOpcStatusByKeys(effectiveStatus, requestedKeys);
    maybeLogOpcConnectionState(payload);
    res.json(payload);
  } catch (err) {
    logOpcError("load status scoped", err);
    res.status(500).json({ error: err?.message || "Failed to load scoped OPC status." });
  }
});

app.get("/api/opc/status/stream", async (req, res) => {
  let clientId = 0;
  let heartbeatId = null;
  try {
    const requestedKeys = parseOpcStatusRequestedKeys(req.query?.keys || "");
    const effectiveStatus = await loadEffectiveOpcStatus();
    const scopedStatus = requestedKeys.length
      ? filterOpcStatusByKeys(effectiveStatus, requestedKeys)
      : effectiveStatus;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write("retry: 2000\n\n");

    clientId = ++opcStatusStreamClientSeq;
    opcStatusStreamClients.set(clientId, {
      id: clientId,
      res,
      keys: requestedKeys,
      lastStatus: scopedStatus,
    });
    sendOpcStatusSse(res, {
      type: "snapshot",
      ...scopedStatus,
      scoped: requestedKeys.length > 0,
      requestedKeyCount: requestedKeys.length,
    });
    heartbeatId = setInterval(() => {
      try {
        res.write(": keepalive\n\n");
      } catch {
        // ignore heartbeat write failures
      }
    }, OPC_STATUS_STREAM_HEARTBEAT_MS);
  } catch (err) {
    logOpcError("stream status", err);
    res.status(500).json({ error: err?.message || "Failed to open OPC status stream." });
    return;
  }

  const close = () => {
    if (heartbeatId) clearInterval(heartbeatId);
    if (clientId) opcStatusStreamClients.delete(clientId);
  };
  req.on("close", close);
  req.on("end", close);
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

app.get("/api/chat/messages", async (req, res) => {
  try {
    const chatMode = String(req.query?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
    const { rows } = await pool.query(
      `
      SELECT
        m.id,
        m.message,
        m.created_at,
        m.user_id,
        m.mode,
        COALESCE(NULLIF(u.display_name, ''), u.username, CONCAT('User ', m.user_id::text)) AS author
      FROM support_chat_messages m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE m.mode = $1
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 200
      `,
      [chatMode]
    );
    res.json({ messages: rows.reverse() });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load chat messages." });
  }
});

app.get("/api/chat/context-docs", async (req, res) => {
  try {
    const authUser = req.user || (await getUserFromRequest(req));
    if (!authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const chatMode = String(req.query?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
    const docs = await listChatContextDocs(chatMode);
    res.json({ docs });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load L5X." });
  }
});

app.post("/api/chat/context-docs/l5x", async (req, res) => {
  try {
    const authUser = req.user || (await getUserFromRequest(req));
    if (!authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const chatMode = String(req.body?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
    const sourceName = String(req.body?.fileName || req.body?.sourceName || "upload.l5x").trim() || "upload.l5x";
    const rawContent = String(req.body?.content || "");
    const content = rawContent.trim();
    if (!content) {
      res.status(400).json({ error: "L5X content is required." });
      return;
    }
    const exceeds = content.length > CHAT_L5X_DOC_MAX_CHARS;
    const storedContent = exceeds ? content.slice(0, CHAT_L5X_DOC_MAX_CHARS) : content;
    const summaryBase = summarizeL5xText(storedContent);
    const summary = exceeds
      ? `${summaryBase} | Truncated to ${CHAT_L5X_DOC_MAX_CHARS} chars`
      : summaryBase;
    const { rows } = await pool.query(
      `
      INSERT INTO support_chat_documents (mode, source_name, content_text, content_summary, created_by, is_active, updated_at)
      VALUES ($1, $2, $3, $4, $5, true, now())
      RETURNING id, mode, source_name, content_summary, created_by, created_at, updated_at
      `,
      [chatMode, sourceName.slice(0, 220), storedContent, summary.slice(0, 500), Number(authUser.id || 0) || null]
    );
    res.status(201).json({
      doc: rows[0] || null,
      truncated: exceeds,
      storedChars: storedContent.length,
      maxChars: CHAT_L5X_DOC_MAX_CHARS,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to upload L5X context." });
  }
});

app.delete("/api/chat/context-docs", async (req, res) => {
  try {
    const authUser = req.user || (await getUserFromRequest(req));
    if (!authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const chatMode = String(req.query?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
    await pool.query(
      `DELETE FROM support_chat_documents WHERE mode = $1`,
      [chatMode]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to clear chat context docs." });
  }
});

let mesoraAiUserIdCache = 0;
const motorDiagDocParseCache = new Map();
const motorDiagAoiCatalogCache = new Map();
async function ensureMesoraAiUserId() {
  if (Number.isFinite(Number(mesoraAiUserIdCache)) && Number(mesoraAiUserIdCache) > 0) {
    return Number(mesoraAiUserIdCache);
  }
  const username = "mesora_ai";
  const displayName = "Mesora AI";
  const existing = await pool.query(
    "SELECT id FROM users WHERE username = $1 LIMIT 1",
    [username]
  );
  if (existing.rows?.length) {
    const id = Number(existing.rows[0]?.id || 0);
    if (id > 0) {
      mesoraAiUserIdCache = id;
      return id;
    }
  }
  const secret = crypto.randomBytes(24).toString("hex");
  const { hash, salt } = await createPasswordHash(secret);
  const created = await pool.query(
    `
    INSERT INTO users (username, password_hash, password_salt, display_name, disabled)
    VALUES ($1, $2, $3, $4, true)
    ON CONFLICT (username) DO UPDATE SET
      display_name = EXCLUDED.display_name
    RETURNING id
    `,
    [username, hash, salt, displayName]
  );
  const id = Number(created.rows?.[0]?.id || 0);
  if (!id) throw new Error("Failed to ensure Mesora AI user.");
  mesoraAiUserIdCache = id;
  return id;
}

function summarizeL5xText(raw = "") {
  const text = String(raw || "");
  const tagMatches = text.match(/<Tag\b/gi) || [];
  const routineMatches = text.match(/<Routine\b/gi) || [];
  const programMatches = text.match(/<Program\b/gi) || [];
  const aoiMatches = text.match(/<AddOnInstructionDefinition\b/gi) || [];
  const dataTypeMatches = text.match(/<DataType\b/gi) || [];
  const ctrl = text.match(/<Controller\b[^>]*Name="([^"]+)"/i);
  const chunks = [];
  if (ctrl?.[1]) chunks.push(`Controller: ${String(ctrl[1]).trim()}`);
  chunks.push(
    `Tags: ${tagMatches.length}`,
    `Programs: ${programMatches.length}`,
    `Routines: ${routineMatches.length}`,
    `AOIs: ${aoiMatches.length}`,
    `DataTypes: ${dataTypeMatches.length}`
  );
  return chunks.join(" | ");
}

async function listChatContextDocs(mode = "design") {
  const resolvedMode = String(mode || "").trim().toLowerCase() === "live" ? "live" : "design";
  const { rows } = await pool.query(
    `
    SELECT id, mode, source_name, content_summary, created_by, created_at, updated_at
    FROM support_chat_documents
    WHERE mode = $1 AND is_active = true
    ORDER BY updated_at DESC, id DESC
    LIMIT 50
    `,
    [resolvedMode]
  );
  return rows;
}

async function getChatContextForPrompt(mode = "design") {
  const resolvedMode = String(mode || "").trim().toLowerCase() === "live" ? "live" : "design";
  const { rows } = await pool.query(
    `
    SELECT source_name, content_summary, content_text, updated_at
    FROM support_chat_documents
    WHERE mode = $1 AND is_active = true
    ORDER BY updated_at DESC, id DESC
    LIMIT $2
    `,
    [resolvedMode, CHAT_L5X_CONTEXT_DOC_LIMIT]
  );
  if (!rows.length) return "";
  let budget = CHAT_L5X_CONTEXT_MAX_CHARS;
  const sections = [];
  for (const row of rows) {
    if (budget <= 80) break;
    const name = String(row?.source_name || "L5X").trim() || "L5X";
    const summary = String(row?.content_summary || "").trim();
    const content = String(row?.content_text || "").trim();
    if (!content) continue;
    const header = `Source: ${name}${summary ? ` | ${summary}` : ""}`;
    const allowance = Math.max(120, budget - header.length - 24);
    const clipped = content.slice(0, allowance);
    sections.push(`${header}\n${clipped}`);
    budget -= header.length + clipped.length + 20;
  }
  return sections.join("\n\n---\n\n");
}

function normalizeLadderTagToken(raw = "") {
  let text = String(raw || "").trim();
  if (!text) return "";
  text = text.replace(/^['"]|['"]$/g, "").trim();
  if (!text) return "";
  text = text.replace(/\s+/g, "");
  return text;
}

function isLikelyTagToken(raw = "") {
  const text = normalizeLadderTagToken(raw);
  if (!text) return false;
  if (/^[+-]?\d+(\.\d+)?$/.test(text)) return false;
  if (/^(true|false)$/i.test(text)) return false;
  if (!/[a-z_]/i.test(text)) return false;
  if (/[+\-*/<>=]/.test(text) && !/[.:_]/.test(text)) return false;
  return true;
}

function decodeL5xText(raw = "") {
  return String(raw || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tokenizeInstructionArgs(raw = "") {
  const src = String(raw || "").trim();
  if (!src) return [];
  const out = [];
  let cur = "";
  let quote = "";
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseRungConditions(rungText = "") {
  const text = decodeL5xText(rungText);
  const conditions = [];
  const coils = [];
  const customCalls = [];
  const knownInstructions = new Set([
    "OTE", "OTL", "OTU",
    "XIC", "XIO", "EQU", "NEQ", "LES", "LEQ", "GRT", "GEQ",
    "ONS", "OSR", "OSF", "BST", "NXB", "BND",
    "MOV", "MVM", "COP", "CPS", "CLR",
    "ADD", "SUB", "MUL", "DIV", "MOD",
    "AND", "OR", "XOR", "NOT",
    "TON", "TOF", "RTO", "RES",
    "JMP", "LBL", "JSR", "RET",
  ]);
  const re = /([A-Z]{2,6})\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const instruction = String(match[1] || "").trim().toUpperCase();
    const args = tokenizeInstructionArgs(match[2] || "");
    const firstArg = normalizeLadderTagToken(args[0] || "");
    if (["OTE", "OTL", "OTU"].includes(instruction)) {
      if (isLikelyTagToken(firstArg)) coils.push(firstArg);
      continue;
    }
    if (["XIC", "XIO", "EQU", "NEQ", "LES", "LEQ", "GRT", "GEQ"].includes(instruction)) {
      if (isLikelyTagToken(firstArg)) {
        conditions.push({
          instruction,
          tag: firstArg,
          arg1: firstArg,
          arg2: normalizeLadderTagToken(args[1] || ""),
          raw: `${instruction}(${args.join(",")})`,
        });
      }
    }
    if (!knownInstructions.has(instruction)) {
      customCalls.push({
        instruction,
        args: args.map((arg) => normalizeLadderTagToken(arg)),
        raw: `${instruction}(${args.join(",")})`,
      });
    }
  }
  return { text, coils, conditions, customCalls };
}

function getMotorDiagCacheKey(doc = {}) {
  const source = String(doc?.source_name || "").trim().toLowerCase();
  const updatedAt = String(doc?.updated_at || "").trim();
  const len = Number(String(doc?.content_text || "").length || 0);
  return `${source}|${updatedAt}|${len}`;
}

function parseMotorDiagDocRungs(doc = {}) {
  const key = getMotorDiagCacheKey(doc);
  const cached = motorDiagDocParseCache.get(key);
  if (cached && Array.isArray(cached.rungs)) return cached.rungs;
  const text = String(doc?.content_text || "");
  const rungBlocks = text.match(/<Text\b[^>]*>[\s\S]*?<\/Text>/gi) || [];
  const parsedRungs = [];
  for (const block of rungBlocks.slice(0, 1800)) {
    const inner = String(block).replace(/^<Text\b[^>]*>/i, "").replace(/<\/Text>$/i, "");
    const parsed = parseRungConditions(inner);
    if (!parsed.coils.length || !parsed.conditions.length) continue;
    parsedRungs.push({
      coils: parsed.coils.slice(0, 5),
      conditions: parsed.conditions.slice(0, 30),
      customCalls: (Array.isArray(parsed.customCalls) ? parsed.customCalls : []).slice(0, 16),
    });
    if (parsedRungs.length >= 320) break;
  }
  motorDiagDocParseCache.set(key, { at: Date.now(), rungs: parsedRungs });
  if (motorDiagDocParseCache.size > 64) {
    const entries = Array.from(motorDiagDocParseCache.entries()).sort((a, b) => Number(a?.[1]?.at || 0) - Number(b?.[1]?.at || 0));
    const trim = Math.max(1, entries.length - 48);
    for (let i = 0; i < trim; i += 1) {
      motorDiagDocParseCache.delete(entries[i][0]);
    }
  }
  return parsedRungs;
}

function trimAoiTagExpression(raw = "") {
  const tag = normalizeLadderTagToken(raw);
  if (!tag) return "";
  return tag.replace(/^\w+::/g, "");
}

function resolveAoiConditionTag(templateTag = "", argByParam = new Map()) {
  const token = trimAoiTagExpression(templateTag);
  if (!token) return "";
  const parts = token.split(".");
  const root = String(parts[0] || "").trim();
  if (!root) return token;
  const mapped = argByParam.get(root.toLowerCase());
  if (!mapped) return token;
  const rest = parts.slice(1).join(".");
  return rest ? `${mapped}.${rest}` : mapped;
}

function parseAoiCatalogFromText(text = "") {
  const src = String(text || "");
  const catalog = new Map();
  const blockRe = /<AddOnInstructionDefinition\b([^>]*)>([\s\S]*?)<\/AddOnInstructionDefinition>/gi;
  let blockMatch;
  while ((blockMatch = blockRe.exec(src)) !== null) {
    const attrs = String(blockMatch[1] || "");
    const body = String(blockMatch[2] || "");
    const aoiName = extractXmlAttr(attrs, "Name");
    if (!aoiName) continue;
    const paramNames = [];
    const paramRe = /<Parameter\b([^>]*)\/?>/gi;
    let pm;
    while ((pm = paramRe.exec(body)) !== null) {
      const pAttrs = String(pm[1] || "");
      const pName = normalizeLadderTagToken(extractXmlAttr(pAttrs, "Name"));
      const usage = String(extractXmlAttr(pAttrs, "Usage") || extractXmlAttr(pAttrs, "Direction")).toLowerCase();
      if (!pName) continue;
      if (usage && !["input", "inout", "inputoutput"].includes(usage)) continue;
      paramNames.push(pName);
      if (paramNames.length >= 64) break;
    }
    const rungBlocks = body.match(/<Text\b[^>]*>[\s\S]*?<\/Text>/gi) || [];
    const templates = [];
    for (const rb of rungBlocks.slice(0, 420)) {
      const inner = String(rb).replace(/^<Text\b[^>]*>/i, "").replace(/<\/Text>$/i, "");
      const parsed = parseRungConditions(inner);
      for (const cond of parsed.conditions || []) {
        const tagExpr = trimAoiTagExpression(cond.tag);
        if (!tagExpr) continue;
        const root = String(tagExpr.split(".")[0] || "").trim().toLowerCase();
        if (root && !paramNames.some((p) => p.toLowerCase() === root)) continue;
        templates.push({
          instruction: cond.instruction,
          tagExpr,
          arg2Expr: trimAoiTagExpression(cond.arg2),
          raw: cond.raw,
        });
        if (templates.length >= 220) break;
      }
      if (templates.length >= 220) break;
    }
    catalog.set(aoiName.toLowerCase(), { name: aoiName, params: paramNames, templates });
    if (catalog.size >= 120) break;
  }
  return catalog;
}

function parseAoiCatalogFromDoc(doc = {}) {
  const key = getMotorDiagCacheKey(doc);
  const cached = motorDiagAoiCatalogCache.get(key);
  if (cached?.catalog && cached.catalog instanceof Map) return cached.catalog;
  const text = String(doc?.content_text || "");
  const catalog = parseAoiCatalogFromText(text);
  motorDiagAoiCatalogCache.set(key, { at: Date.now(), catalog });
  if (motorDiagAoiCatalogCache.size > 48) {
    const entries = Array.from(motorDiagAoiCatalogCache.entries()).sort((a, b) => Number(a?.[1]?.at || 0) - Number(b?.[1]?.at || 0));
    const trim = Math.max(1, entries.length - 36);
    for (let i = 0; i < trim; i += 1) motorDiagAoiCatalogCache.delete(entries[i][0]);
  }
  return catalog;
}

function expandAoiConditionsForRung(rung = {}, aoiCatalog = new Map()) {
  const calls = Array.isArray(rung?.customCalls) ? rung.customCalls : [];
  const expanded = [];
  for (const call of calls) {
    const name = String(call?.instruction || "").trim().toLowerCase();
    if (!name) continue;
    const def = aoiCatalog.get(name);
    if (!def) continue;
    const args = Array.isArray(call?.args) ? call.args : [];
    const argByParam = new Map();
    (Array.isArray(def.params) ? def.params : []).forEach((p, idx) => {
      const arg = normalizeLadderTagToken(args[idx] || "");
      if (!p || !arg || !isLikelyTagToken(arg)) return;
      argByParam.set(String(p).toLowerCase(), arg);
    });
    for (const t of Array.isArray(def.templates) ? def.templates : []) {
      const tag = resolveAoiConditionTag(t.tagExpr, argByParam);
      if (!tag || !isLikelyTagToken(tag)) continue;
      const arg2 = resolveAoiConditionTag(t.arg2Expr, argByParam);
      expanded.push({
        instruction: String(t.instruction || "").toUpperCase(),
        tag,
        arg1: tag,
        arg2,
        raw: `${def.name}:${String(t.raw || "")}`,
        sourceAoi: def.name,
      });
      if (expanded.length >= 260) break;
    }
    if (expanded.length >= 260) break;
  }
  return expanded;
}

function tokenLoose(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function tokensMatch(tagA = "", tagB = "") {
  const a = String(tagA || "").trim().toLowerCase();
  const b = String(tagB || "").trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.endsWith(`.${b}`) || b.endsWith(`.${a}`)) return true;
  const la = tokenLoose(a);
  const lb = tokenLoose(b);
  if (!la || !lb) return false;
  return la === lb || la.endsWith(lb) || lb.endsWith(la);
}

function inferMotorTokenFromPrompt(prompt = "") {
  const text = String(prompt || "").trim();
  if (!text) return "";
  const patterns = [
    /\bmotor(?:\s+tag|\s+name)?\s*[:=]?\s*([A-Za-z0-9_:.\/-]+)/i,
    /\bwhy\b[\s\S]{0,80}\b([A-Za-z][A-Za-z0-9_:.\/-]{1,})\b[\s\S]{0,30}\b(?:running|start|on)\b/i,
    /\b([A-Za-z][A-Za-z0-9_:.\/-]{1,})\b[\s\S]{0,20}\bmotor\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    const token = normalizeLadderTagToken(m?.[1] || "");
    if (isLikelyTagToken(token)) return token;
  }
  return "";
}

function isMotorDiagnosticRequest(prompt = "") {
  const text = String(prompt || "").toLowerCase();
  if (!text) return false;
  const asksMotor = /\bmotor\b/.test(text);
  const asksWhyNot = /\b(why|isn'?t|not running|won'?t start|not starting|not on|not turning on)\b/.test(text);
  return asksMotor && asksWhyNot;
}

async function loadLatestChatL5xDocs(mode = "design") {
  const resolvedMode = String(mode || "").trim().toLowerCase() === "live" ? "live" : "design";
  const { rows } = await pool.query(
    `
    SELECT source_name, content_text, content_summary, updated_at
    FROM support_chat_documents
    WHERE mode = $1 AND is_active = true
    ORDER BY updated_at DESC, id DESC
    LIMIT 5
    `,
    [resolvedMode]
  );
  return rows;
}

async function loadOpcStatusSnapshot() {
  const cached = getOpcStatusFromCache();
  const status =
    cached && Object.keys(cached).length
      ? cached
      : ((await loadPersistedOpcStatusRow())?.status || {});
  const values = status?.values && typeof status.values === "object" ? status.values : {};
  const qualities = status?.qualities && typeof status.qualities === "object" ? status.qualities : {};
  return { values, qualities };
}

function buildOpcLookup(values = {}, qualities = {}) {
  const entries = Object.entries(values || {});
  const exact = new Map();
  const lower = new Map();
  entries.forEach(([k, v]) => {
    const key = String(k || "").trim();
    if (!key) return;
    exact.set(key, v);
    lower.set(key.toLowerCase(), { key, value: v });
  });
  const resolve = (rawTag) => {
    const tag = String(rawTag || "").trim();
    if (!tag) return null;
    if (exact.has(tag)) {
      const value = exact.get(tag);
      return { key: tag, value, quality: qualities?.[tag] ?? null };
    }
    const direct = lower.get(tag.toLowerCase());
    if (direct) return { key: direct.key, value: direct.value, quality: qualities?.[direct.key] ?? null };
    const suffix = entries.find(([k]) => tokensMatch(String(k || ""), tag));
    if (!suffix) return null;
    const key = String(suffix[0] || "");
    return { key, value: suffix[1], quality: qualities?.[key] ?? null };
  };
  return { resolve };
}

function toBoolLike(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value !== 0 : null;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (["true", "on", "1", "yes", "running"].includes(text)) return true;
  if (["false", "off", "0", "no", "stopped"].includes(text)) return false;
  const n = Number(text);
  if (Number.isFinite(n)) return n !== 0;
  return null;
}

function evaluateConditionStatus(condition, resolved) {
  const instruction = String(condition?.instruction || "").toUpperCase();
  const value = resolved?.value;
  const boolLike = toBoolLike(value);
  const rhsRaw = String(condition?.arg2 || "").trim();
  const rhsNum = Number(rhsRaw);
  const lhsNum = Number(value);
  if (instruction === "XIC") {
    if (boolLike == null) return { met: null, reason: "unknown" };
    return { met: boolLike === true, reason: boolLike === true ? "true" : "false" };
  }
  if (instruction === "XIO") {
    if (boolLike == null) return { met: null, reason: "unknown" };
    return { met: boolLike === false, reason: boolLike === false ? "false (required)" : "true (blocks)" };
  }
  if (["EQU", "NEQ", "LES", "LEQ", "GRT", "GEQ"].includes(instruction) && Number.isFinite(lhsNum)) {
    let met = null;
    if (Number.isFinite(rhsNum)) {
      if (instruction === "EQU") met = lhsNum === rhsNum;
      if (instruction === "NEQ") met = lhsNum !== rhsNum;
      if (instruction === "LES") met = lhsNum < rhsNum;
      if (instruction === "LEQ") met = lhsNum <= rhsNum;
      if (instruction === "GRT") met = lhsNum > rhsNum;
      if (instruction === "GEQ") met = lhsNum >= rhsNum;
    }
    return { met, reason: Number.isFinite(rhsNum) ? `${lhsNum} vs ${rhsNum}` : "rhs unresolved" };
  }
  return { met: null, reason: "unsupported instruction" };
}

function classifyConditionKind(condition) {
  const tag = String(condition?.tag || "").toLowerCase();
  const instruction = String(condition?.instruction || "").toUpperCase();
  const interlockWords = ["interlock", "fault", "trip", "estop", "e_stop", "overload", "alarm", "safe", "safety"];
  const permissiveWords = ["perm", "permissive", "ready", "enable", "enabled", "allow", "ok", "run_cmd", "runreq", "start"];
  if (interlockWords.some((w) => tag.includes(w))) return "interlock";
  if (permissiveWords.some((w) => tag.includes(w))) return "permissive";
  if (instruction === "XIO") return "interlock";
  if (instruction === "XIC") return "permissive";
  return "condition";
}

function buildMotorDiagnosticSummary({
  prompt = "",
  motorToken = "",
  rungMatches = [],
  evaluations = [],
} = {}) {
  const blockers = evaluations.filter((row) => row.met === false);
  const unknowns = evaluations.filter((row) => row.met == null);
  const satisfied = evaluations.filter((row) => row.met === true);
  const targetCoil =
    rungMatches[0]?.coils?.find((coil) => (motorToken ? tokensMatch(coil, motorToken) : true)) ||
    rungMatches[0]?.coils?.[0] ||
    motorToken ||
    "motor";
  const withKinds = evaluations.map((row) => ({ ...row, kind: classifyConditionKind(row) }));
  const blockerLines = withKinds
    .filter((row) => row.met === false)
    .slice(0, 16)
    .map(
      (b) =>
        `- [${b.kind}] ${b.instruction}(${b.tag}) -> value=${String(b.value)} quality=${String(
          b.quality || "Unknown"
        )} [BLOCKED]`
    );
  const unknownLines = withKinds
    .filter((row) => row.met == null)
    .slice(0, 10)
    .map(
      (u) =>
        `- [${u.kind}] ${u.instruction}(${u.tag}) -> value=${
          u.value == null ? "not found" : String(u.value)
        } quality=${String(u.quality || "Unknown")} [UNKNOWN]`
    );
  const summaryText = [
    `Motor diagnostic for ${targetCoil}: Rungs matched=${rungMatches.length}. Checks=${evaluations.length}. Blocked=${blockers.length}, Satisfied=${satisfied.length}, Unknown=${unknowns.length}.`,
    blockerLines.length ? `Likely blockers:\n${blockerLines.join("\n")}` : "No hard blockers detected in evaluated interlocks/permissives.",
    unknownLines.length ? `Needs verification:\n${unknownLines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const contextText = [
    `Motor diagnostic precheck for prompt "${String(prompt || "").slice(0, 220)}"`,
    summaryText,
  ].join("\n\n");
  return { summaryText, contextText, blockers, unknowns, satisfied };
}

async function maybeDiagnoseMotorFromPrompt({ prompt = "", chatMode = "design" } = {}) {
  const requested = isMotorDiagnosticRequest(prompt);
  if (!requested) return { requested: false, summary: "", context: "" };
  const motorToken = inferMotorTokenFromPrompt(prompt);
  const docs = await loadLatestChatL5xDocs(chatMode);
  if (!docs.length) {
    return {
      requested: true,
      summary: "Motor diagnostic: no uploaded L5X context found. Load an L5X file in AI Chat first.",
      context: "",
    };
  }

  const rungMatches = [];
  for (const doc of docs) {
    const parsedRungs = parseMotorDiagDocRungs(doc);
    const aoiCatalog = parseAoiCatalogFromDoc(doc);
    for (const parsed of parsedRungs) {
      const coilHit = motorToken
        ? parsed.coils.some((coil) => tokensMatch(coil, motorToken))
        : parsed.coils.some((coil) => /\bmotor\b|\brun\b/i.test(String(coil)));
      if (!coilHit) continue;
      const expandedAoiConditions = expandAoiConditionsForRung(parsed, aoiCatalog);
      rungMatches.push({
        source: String(doc?.source_name || "l5x"),
        coils: parsed.coils.slice(0, 5),
        conditions: [...(parsed.conditions || []).slice(0, 30), ...expandedAoiConditions.slice(0, 40)],
      });
      if (rungMatches.length >= 10) break;
    }
    if (rungMatches.length >= 10) break;
  }

  if (!rungMatches.length) {
    const targetText = motorToken ? ` for "${motorToken}"` : "";
    return {
      requested: true,
      summary: `Motor diagnostic: no motor run rung found${targetText} in uploaded L5X context.`,
      context: "",
    };
  }

  const uniqueConditions = [];
  const seen = new Set();
  rungMatches.forEach((rung) => {
    rung.conditions.forEach((cond) => {
      const key = `${cond.instruction}|${String(cond.tag || "").toLowerCase()}|${String(cond.arg2 || "").toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      uniqueConditions.push(cond);
    });
  });

  const { values, qualities } = await loadOpcStatusSnapshot();
  const lookup = buildOpcLookup(values, qualities);
  const evaluations = uniqueConditions.slice(0, 80).map((cond) => {
    const resolved = lookup.resolve(cond.tag);
    const evalResult = evaluateConditionStatus(cond, resolved);
    return {
      ...cond,
      resolvedTag: resolved?.key || "",
      value: resolved?.value,
      quality: resolved?.quality,
      met: evalResult.met,
      evalReason: evalResult.reason,
    };
  });
  const { summaryText, contextText } = buildMotorDiagnosticSummary({
    prompt,
    motorToken,
    rungMatches,
    evaluations,
  });
  return { requested: true, summary: summaryText, context: contextText };
}

async function maybeDiagnoseMotorFromPlcInsightsContext({
  prompt = "",
  rawSample = "",
  controllerTags = [],
  debugSnapshot = null,
} = {}) {
  const requested = isMotorDiagnosticRequest(prompt);
  if (!requested) return { requested: false, summary: "", context: "" };
  const motorToken = inferMotorTokenFromPrompt(prompt);
  const text = String(rawSample || "");
  if (!text.trim()) {
    return {
      requested: true,
      summary: "Motor diagnostic: no L5X text excerpt available in PLC context.",
      context: "",
    };
  }
  const rungBlocks = text.match(/<Text\b[^>]*>[\s\S]*?<\/Text>/gi) || [];
  const aoiCatalog = parseAoiCatalogFromText(text);
  const parsedRungs = [];
  for (const block of rungBlocks.slice(0, 1400)) {
    const inner = String(block).replace(/^<Text\b[^>]*>/i, "").replace(/<\/Text>$/i, "");
    const parsed = parseRungConditions(inner);
    if (!parsed.coils.length || !parsed.conditions.length) continue;
    parsedRungs.push(parsed);
    if (parsedRungs.length >= 280) break;
  }
  const rungMatches = parsedRungs
    .filter((parsed) =>
      motorToken
        ? parsed.coils.some((coil) => tokensMatch(coil, motorToken))
        : parsed.coils.some((coil) => /\bmotor\b|\brun\b/i.test(String(coil)))
    )
    .slice(0, 10)
    .map((parsed) => ({
      source: "plc-insights-context",
      coils: parsed.coils.slice(0, 5),
      conditions: [
        ...(parsed.conditions || []).slice(0, 30),
        ...expandAoiConditionsForRung(parsed, aoiCatalog).slice(0, 40),
      ],
    }));

  if (!rungMatches.length) {
    const t = motorToken ? ` for "${motorToken}"` : "";
    return {
      requested: true,
      summary: `Motor diagnostic: no matching run rung found${t} in provided PLC context excerpt.`,
      context: "",
    };
  }

  const uniqueConditions = [];
  const seen = new Set();
  rungMatches.forEach((rung) => {
    rung.conditions.forEach((cond) => {
      const key = `${cond.instruction}|${String(cond.tag || "").toLowerCase()}|${String(cond.arg2 || "").toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      uniqueConditions.push(cond);
    });
  });

  const { values, qualities } = await loadOpcStatusSnapshot();
  const debugTags = Array.isArray(debugSnapshot?.tags) ? debugSnapshot.tags : [];
  debugTags.forEach((tag) => {
    const key = String(tag?.key || "").trim();
    if (!key || Object.prototype.hasOwnProperty.call(values, key)) return;
    values[key] = tag?.value;
    qualities[key] = String(tag?.quality || "").trim() || "Unknown";
  });
  const lookup = buildOpcLookup(values, qualities);
  const tagNameSet = new Set(
    (Array.isArray(controllerTags) ? controllerTags : [])
      .map((t) => String(t?.name || t?.tagPath || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const evaluations = uniqueConditions.slice(0, 90).map((cond) => {
    const resolved = lookup.resolve(cond.tag);
    const evalResult = evaluateConditionStatus(cond, resolved);
    const inControllerTagList = tagNameSet.has(String(cond.tag || "").trim().toLowerCase());
    return {
      ...cond,
      resolvedTag: resolved?.key || "",
      value: resolved?.value,
      quality: resolved?.quality,
      met: evalResult.met,
      evalReason: evalResult.reason,
      inControllerTagList,
    };
  });
  const { summaryText, contextText } = buildMotorDiagnosticSummary({
    prompt,
    motorToken,
    rungMatches,
    evaluations,
  });
  return { requested: true, summary: summaryText, context: contextText };
}

async function getChatOllamaReply({ prompt = "", history = [], chatMode = "design", motorDiagnostic = "" } = {}) {
  const cleanedPrompt = String(prompt || "").trim();
  if (!cleanedPrompt) throw new Error("AI prompt is required.");
  const runtime = getActiveAiRuntime();
  if (!runtime?.ollamaNativeBaseUrl) {
    throw new Error("Ollama is not configured. Set active AI agent to Ollama in AI Config.");
  }
  const flourMillKnowledge = getFlourMillKnowledge();
  const flourKnowledgeTrimmed = String(flourMillKnowledge || "").slice(0, FLOUR_KNOWLEDGE_MAX_CHARS);
  const l5xContext = await getChatContextForPrompt(chatMode);
  const safeHistory = (Array.isArray(history) ? history : [])
    .slice(-CHAT_AI_HISTORY_MAX)
    .map((item) => {
      const role = String(item?.role || "").trim().toLowerCase();
      if (role !== "user" && role !== "assistant") return null;
      const content = String(item?.content || "").slice(0, CHAT_AI_MESSAGE_CHAR_MAX).trim();
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);
  const mode = String(chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
  const systemLive = [
    "You are Mesora AI in LIVE mode for flour mill operations.",
    "Prioritize concise, actionable answers for operators and controls technicians.",
    "Use flour milling best practices and safety-first guidance.",
    "If information is missing, list exactly what tags, alarms, or states are needed.",
    "Do not emit canvas placement actions in live mode.",
  ].join(" ");
  const systemDesign = [
    "You are Mesora AI in DESIGN mode for HMI/canvas editing and project setup.",
    "Prioritize concise, actionable build guidance for screens, SVGs, layout, tags, and bindings.",
    "If the user asks to add/place/layout SVG equipment on the canvas, include ONE action line at the end:",
    "MESORA_ACTION={\"type\":\"add_svg_layout\",\"payload\":{\"items\":[{\"svgKey\":\"<svg name>\",\"label\":\"<optional>\",\"tagPath\":\"<optional>\",\"x\":<optional>,\"y\":<optional>,\"width\":<optional>}],\"layout\":{\"mode\":\"grid\",\"columns\":<optional>,\"startX\":<optional>,\"startY\":<optional>,\"cellW\":<optional>,\"cellH\":<optional>,\"gapX\":<optional>,\"gapY\":<optional>}}}",
    "Only emit MESORA_ACTION for canvas SVG placement requests.",
  ].join(" ");
  const system = mode === "live" ? systemLive : systemDesign;
  const promptInput = [
    { role: "system", content: system },
    ...(flourKnowledgeTrimmed
      ? [{ role: "system", content: `Flour Mill Domain Knowledge:\n${flourKnowledgeTrimmed}` }]
      : []),
    ...(l5xContext
      ? [{ role: "system", content: `Uploaded L5X Context (mode=${mode}):\n${l5xContext}` }]
      : []),
    ...(String(motorDiagnostic || "").trim()
      ? [{ role: "system", content: `Motor Diagnostic Precheck:\n${String(motorDiagnostic || "").trim()}` }]
      : []),
    ...safeHistory,
    { role: "user", content: cleanedPrompt },
  ];

  markOllamaModelUsed(runtime, runtime.model);
  const resp = await fetch(`${runtime.ollamaNativeBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: runtime.model,
      prompt: promptInput
        .map((m) => `${String(m.role || "user").toUpperCase()}: ${String(m.content || "")}`)
        .join("\n\n"),
      stream: false,
      keep_alive: OLLAMA_CHAT_KEEP_ALIVE,
      options: {
        num_predict: OLLAMA_CHAT_MAX_PREDICT,
        temperature: OLLAMA_CHAT_TEMPERATURE,
      },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Ollama error: ${resp.status}${errText ? ` ${errText}` : ""}`);
  }
  const data = await resp.json().catch(() => ({}));
  const answer = String(data?.response || "").trim();
  if (!answer) throw new Error("Ollama returned an empty response.");
  const parsed = extractChatAiAction(answer);
  const message = String(parsed?.message || "").trim();
  const fallbackAction = mode === "design" && !parsed?.action
    ? inferDesignSvgActionFromPrompt(cleanedPrompt)
    : null;
  return {
    message: (message || answer).slice(0, 4000),
    action: parsed?.action || fallbackAction || null,
  };
}

app.post("/api/chat/messages", async (req, res) => {
  try {
    const authUser = req.user || (await getUserFromRequest(req));
    if (!authUser) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const message = String(req.body?.message || req.body?.content || "").trim();
    const chatMode = String(req.body?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
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
      INSERT INTO support_chat_messages (user_id, mode, message)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, mode, message, created_at
      `,
      [authUser.id, chatMode, message]
    );
    const row = rows[0] || null;
    if (!row) {
      res.status(500).json({ error: "Failed to create message." });
      return;
    }
    const postedMessage = {
      ...row,
      author: String(authUser.display_name || authUser.username || `User ${authUser.id}`),
    };

    const askAi = req.body?.askAi === true;
    if (!askAi) {
      res.status(201).json({ message: postedMessage });
      return;
    }

    const aiPromptRaw = String(req.body?.aiPrompt || "").trim();
    const normalizedPrompt = aiPromptRaw || message.replace(/^\/ai\b\s*/i, "").trim() || message;
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    let aiMessage = null;
    let aiError = "";
    let aiAction = null;
    let motorDiag = null;
    try {
      const chatModeRaw = String(req.body?.chatMode || "").trim().toLowerCase();
      const chatMode = chatModeRaw === "live" ? "live" : "design";
      motorDiag = await maybeDiagnoseMotorFromPrompt({ prompt: normalizedPrompt, chatMode });
      const aiReply = await getChatOllamaReply({
        prompt: normalizedPrompt,
        history,
        chatMode,
        motorDiagnostic: String(motorDiag?.context || "").trim(),
      });
      let answer = String(aiReply?.message || "").trim();
      if (motorDiag?.requested && String(motorDiag?.summary || "").trim()) {
        answer = `${String(motorDiag.summary).trim()}\n\n${answer}`.trim();
      }
      const aiUserId = await ensureMesoraAiUserId();
      const aiInsert = await pool.query(
        `
        INSERT INTO support_chat_messages (user_id, mode, message)
        VALUES ($1, $2, $3)
        RETURNING id, user_id, mode, message, created_at
        `,
        [aiUserId, chatMode, answer]
      );
      const aiRow = aiInsert.rows?.[0] || null;
      if (aiRow) {
        aiMessage = {
          ...aiRow,
          author: "Mesora AI",
        };
      }
      aiAction = normalizeChatAiAction(aiReply?.action || null);
      res.status(201).json({ message: postedMessage, aiMessage, aiError, aiAction });
      return;
    } catch (err) {
      aiError = String(err?.message || "Failed to generate AI reply.");
    }

    if (motorDiag?.requested && String(motorDiag?.summary || "").trim()) {
      try {
        const chatModeRaw = String(req.body?.chatMode || "").trim().toLowerCase();
        const chatMode = chatModeRaw === "live" ? "live" : "design";
        const aiUserId = await ensureMesoraAiUserId();
        const fallbackAnswer = String(motorDiag.summary || "").trim();
        const aiInsert = await pool.query(
          `
          INSERT INTO support_chat_messages (user_id, mode, message)
          VALUES ($1, $2, $3)
          RETURNING id, user_id, mode, message, created_at
          `,
          [aiUserId, chatMode, fallbackAnswer]
        );
        const aiRow = aiInsert.rows?.[0] || null;
        if (aiRow) {
          aiMessage = {
            ...aiRow,
            author: "Mesora AI",
          };
        }
        aiError = "";
      } catch {
        // keep original aiError
      }
    }

    res.status(201).json({ message: postedMessage, aiMessage, aiError, aiAction });
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
    const trendDb = trendPool || pool;
    if (!trendDb) {
      res.status(503).json({ error: "Trend database is not available." });
      return;
    }
    const trendTables = await listTrendChunkTables(trendDb, { includeLegacy: true });
    if (!trendTables.length) {
      res.json({ tags: [] });
      return;
    }
    const unionSql = buildTrendUnionSql(trendTables, "tag_key, to_ts, sample_count");
    if (!unionSql) {
      res.json({ tags: [] });
      return;
    }
    const { rows } = await trendDb.query(
      `
      SELECT
        tag_key,
        MAX(to_ts) AS last_at,
        SUM(sample_count)::bigint AS sample_count
      FROM (${unionSql}) AS trend_rows
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
    logOpcError("load trend tags", err);
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
    const trendDb = trendPool || pool;
    if (!trendDb) {
      res.status(503).json({ error: "Trend database is not available." });
      return;
    }
    const trendTables = await listTrendChunkTables(trendDb, { includeLegacy: true });
    const unionSql = buildTrendUnionSql(
      trendTables,
      "codec, payload, from_ts, to_ts, tag_key",
      "WHERE tag_key = $1 AND to_ts >= $2 AND from_ts <= $3"
    );
    const { rows } = unionSql
      ? await trendDb.query(
          `
          SELECT codec, payload, from_ts, to_ts
          FROM (${unionSql}) AS trend_rows
          ORDER BY from_ts ASC
          LIMIT 5000
          `,
          [tagKey, rangeFrom, rangeTo]
        )
      : { rows: [] };
    const points = [];
    for (const row of rows) {
      const decoded = decodeTrendChunkPayload(String(row?.codec || ""), row?.payload);
      decoded.forEach((pt) => {
        if (pt.t < rangeFrom || pt.t > rangeTo) return;
        points.push(pt);
      });
    }
    const liveStatus = await loadCurrentOpcStatus();
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
    logOpcError("load trends", err, { tagKey: String(req.query.tagKey || req.query.tag || "") });
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

function isCommandLikeOpcWriteTag(...keys) {
  return keys.some((key) => {
    const normalized = String(key || "").trim().toLowerCase();
    if (!normalized) return false;
    return (
      /(^|[./])hmi_control($|[./])/.test(normalized) ||
      /(^|[./])hmi_command($|[./])/.test(normalized) ||
      /(^|[./])cmd($|[./])/.test(normalized)
    );
  });
}

async function performOpcWrite({
  tagKey,
  legacyTagKey = "",
  value,
  uaType = "",
  applyInverseScale = true,
}) {
  const writeStartedAt = Date.now();
  const primaryTagKey = String(tagKey || "").trim();
  const legacyKey = String(legacyTagKey || "").trim();
  const normalizedUaType = String(uaType || "").trim().toLowerCase();
  if (!primaryTagKey) throw new Error("tagKey required.");

  let nextValue = value;
  if (typeof nextValue === "string") {
    const raw = nextValue.trim();
    if (normalizedUaType === "boolean") {
      const lower = raw.toLowerCase();
      if (lower === "true" || lower === "1" || lower === "on") nextValue = true;
      else if (lower === "false" || lower === "0" || lower === "off") nextValue = false;
      else nextValue = raw;
    } else if (
      normalizedUaType === "int16" ||
      normalizedUaType === "int32" ||
      normalizedUaType === "int64" ||
      normalizedUaType === "uint16" ||
      normalizedUaType === "uint32" ||
      normalizedUaType === "uint64" ||
      normalizedUaType === "float" ||
      normalizedUaType === "double"
    ) {
      const n = Number(raw);
      nextValue = Number.isFinite(n) ? n : raw;
    } else {
      nextValue = raw;
    }
  }

  const commandLikeWrite = isCommandLikeOpcWriteTag(primaryTagKey, legacyKey);
  const numericInputValue = toFiniteNumber(nextValue);
  const tagMeta =
    numericInputValue != null || applyInverseScale
      ? await getOpcTagMetaByKeys(primaryTagKey, legacyKey)
      : null;

  if (applyInverseScale && numericInputValue != null && !commandLikeWrite) {
    const scale = Number(tagMeta?.scale);
    if (Number.isFinite(Number(scale)) && Number(scale) !== 0 && Number(scale) !== 1) {
      const n = Number(nextValue);
      if (Number.isFinite(n)) {
        const unscaled = n / Number(scale);
        const isIntType =
          normalizedUaType === "int16" ||
          normalizedUaType === "int32" ||
          normalizedUaType === "int64" ||
          normalizedUaType === "uint16" ||
          normalizedUaType === "uint32" ||
          normalizedUaType === "uint64";
        nextValue = isIntType ? Math.round(unscaled) : unscaled;
      }
    }
  }

  {
    const headers = { "content-type": "application/json" };
    if (OPC_SERVER_KEY) headers["x-opc-key"] = OPC_SERVER_KEY;
    let bridgeRes;
    try {
      bridgeRes = await fetch(`${OPC_WRITE_BRIDGE_URL}/internal/write`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tagKey: primaryTagKey,
          legacyTagKey: legacyKey,
          value: nextValue,
          uaType: normalizedUaType,
        }),
      });
    } catch (err) {
      logOpcError("write bridge unavailable", err, {
        bridgeUrl: OPC_WRITE_BRIDGE_URL,
        tagKey: primaryTagKey,
        legacyTagKey: legacyKey,
      });
      throw new Error(`OPC write bridge unavailable at ${OPC_WRITE_BRIDGE_URL}: ${err?.message || "request failed"}`);
    }
    if (!bridgeRes.ok) {
      const bridgeData = await bridgeRes.json().catch(() => ({}));
      logOpcError("write bridge rejected request", new Error(String(bridgeData?.error || "PLC write failed.")), {
        bridgeStatus: Number(bridgeRes.status) || null,
        tagKey: primaryTagKey,
        legacyTagKey: legacyKey,
      });
      throw new Error(String(bridgeData?.error || "PLC write failed."));
    }
    const bridgeData = await bridgeRes.json().catch(() => ({}));
    if (Object.prototype.hasOwnProperty.call(bridgeData || {}, "value")) {
      nextValue = bridgeData.value;
    }
  }

  let baseStatus = getOpcStatusFromCache();
  if ((!baseStatus || !Object.keys(baseStatus).length) && OPC_PERSIST_LIVE_STATUS) {
    const current = await pool.query("SELECT status FROM opc_status WHERE id = 1 LIMIT 1");
    baseStatus = current.rows[0]?.status && typeof current.rows[0].status === "object"
      ? current.rows[0].status
      : {};
  }
  const at = Date.now();
  const nextStatus = {
    ...baseStatus,
    at,
    values: { ...(baseStatus?.values || {}), [primaryTagKey]: nextValue },
    qualities: { ...(baseStatus?.qualities || {}), [primaryTagKey]: "Good" },
    diagnostics: { ...(baseStatus?.diagnostics || {}) },
    runtime: {
      ...(baseStatus?.runtime && typeof baseStatus.runtime === "object" ? baseStatus.runtime : {}),
    },
  };
  if (legacyKey && legacyKey !== primaryTagKey) {
    nextStatus.values[legacyKey] = nextValue;
    nextStatus.qualities[legacyKey] = "Good";
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
  if (nextStatus?.diagnostics?.[primaryTagKey] && typeof nextStatus.diagnostics[primaryTagKey] === "object") {
    applyWriteDiag(primaryTagKey);
  } else {
    nextStatus.diagnostics[primaryTagKey] = {};
    applyWriteDiag(primaryTagKey);
  }
  if (
    legacyKey &&
    legacyKey !== primaryTagKey &&
    nextStatus?.diagnostics?.[legacyKey] &&
    typeof nextStatus.diagnostics[legacyKey] === "object"
  ) {
    applyWriteDiag(legacyKey);
  } else if (legacyKey && legacyKey !== primaryTagKey) {
    nextStatus.diagnostics[legacyKey] = {};
    applyWriteDiag(legacyKey);
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

  if (nextStatus?.diagnostics?.[primaryTagKey] && typeof nextStatus.diagnostics[primaryTagKey] === "object") {
    nextStatus.diagnostics[primaryTagKey] = {
      ...nextStatus.diagnostics[primaryTagKey],
      lastReadAt: at,
    };
  }
  if (legacyKey && legacyKey !== primaryTagKey && nextStatus?.diagnostics?.[legacyKey]) {
    nextStatus.diagnostics[legacyKey] = {
      ...nextStatus.diagnostics[legacyKey],
      lastReadAt: at,
    };
  }

  writeOpcStatusCache(nextStatus, Date.now());
  scheduleOpcStatusDbPersist(nextStatus);

  const n = toFiniteNumber(nextValue);
  if (n != null && tagMeta?.trendEnabled === true) {
    const mode = tagMeta?.trendMode || "value";
    appendTrendSample(primaryTagKey, at, n, {
      mode,
      forceMs: tagMeta?.trendSampleMs || OPC_TREND_FORCE_SAMPLE_MS,
    });
    await flushTrendBuffersIfNeeded(at);
  }

  return { ok: true, at, tagKey: primaryTagKey, value: nextValue };
}

function normalizeAutomationRuleRow(row) {
  const triggerTag = String(row?.trigger_tag || "").trim();
  const triggerSourceRaw = String(row?.trigger_source || "tag").trim().toLowerCase();
  const triggerSource = triggerSourceRaw === "db" ? "db" : triggerSourceRaw === "udt" ? "udt" : "tag";
  const triggerModeRaw = String(row?.trigger_mode || "change").trim().toLowerCase();
  const triggerMode = ["change", "rising", "falling", "counter_change", "counter_increase", "counter_decrease"].includes(triggerModeRaw)
    ? triggerModeRaw
    : "change";
  const conditionsLogic = String(row?.conditions_logic || "and").trim().toLowerCase() === "or" ? "or" : "and";
  const conditions = parseAutomationJson(row?.conditions_json, []);
  const actionsRaw = parseAutomationJson(row?.actions_json, []);
  const actions = Array.isArray(actionsRaw) ? actionsRaw : actionsRaw && typeof actionsRaw === "object" ? [actionsRaw] : [];
  return {
    id: Number(row?.id || 0) || 0,
    name: String(row?.name || ""),
    enabled: row?.enabled === true,
    projectId: String(row?.project_id || ""),
    scopeProjectId: String(row?.scope_project_id || ""),
    scopeRouteId: String(row?.scope_route_id || ""),
    triggerSource,
    triggerTag,
    triggerTagKey: normalizeAutomationTagKey(triggerTag),
    triggerMode,
    triggerTable: String(row?.trigger_table || "").trim(),
    triggerColumn: String(row?.trigger_column || "").trim(),
    triggerWhereJson: parseAutomationJson(row?.trigger_where_json, {}),
    triggerOrderBy: String(row?.trigger_order_by || "").trim(),
    triggerOrderDir: String(row?.trigger_order_dir || "asc").trim().toLowerCase() === "desc" ? "desc" : "asc",
    conditions_logic: conditionsLogic,
    conditions: Array.isArray(conditions) ? conditions : [],
    actions,
    cooldownMs: Math.max(0, Number.parseInt(String(row?.cooldown_ms || 0), 10) || 0),
    lastFiredAt: row?.last_fired_at ? new Date(row.last_fired_at).getTime() : 0,
    lastSeenValue: row?.last_seen_value == null ? null : parseAutomationJson(row.last_seen_value, row.last_seen_value),
  };
}

function ruleMatchesAutomationEvent(rule, event) {
  if (!rule?.enabled || !["tag", "udt"].includes(String(rule?.triggerSource || "")) || !rule?.triggerTagKey) return false;
  const matched = matchAutomationTagPattern(rule?.triggerTag || "", event?.tagKey || "");
  if (!matched?.matched) return false;
  event.base = String(matched?.base || "");
  event.captures = Array.isArray(matched?.captures) ? matched.captures : [];
  const delta = automationNumericDelta(event?.previousValue, event?.nextValue);
  if (rule.triggerMode === "rising") return !isAutomationTruthy(event?.previousValue) && isAutomationTruthy(event?.nextValue);
  if (rule.triggerMode === "falling") return isAutomationTruthy(event?.previousValue) && !isAutomationTruthy(event?.nextValue);
  if (rule.triggerMode === "counter_change") return delta != null && delta !== 0;
  if (rule.triggerMode === "counter_increase") return delta != null && delta > 0;
  if (rule.triggerMode === "counter_decrease") return delta != null && delta < 0;
  return !automationValuesEqual(event?.previousValue, event?.nextValue);
}

function evaluateAutomationConditionNode(condition, mergedStatus, event, eventValueContext) {
  if (!condition || typeof condition !== "object") return true;
  const kind = String(condition?.kind || "").trim().toLowerCase();
  if (kind === "group") {
    const nested = Array.isArray(condition?.conditions) ? condition.conditions : [];
    const logic = String(condition?.logic || "and").trim().toLowerCase() === "or" ? "or" : "and";
    return evaluateAutomationConditionList(nested, mergedStatus, event, eventValueContext, logic);
  }
  const values = mergedStatus?.values && typeof mergedStatus.values === "object" ? mergedStatus.values : {};
  const tag = String(applyAutomationTemplate(String(condition?.tag || condition?.tagKey || ""), eventValueContext) || "").trim();
  const operator = String(condition?.op || condition?.operator || "==").trim();
  const expectedRaw = Object.prototype.hasOwnProperty.call(condition || {}, "value") ? condition.value : "";
  const expected = applyAutomationTemplate(expectedRaw, eventValueContext);
  if (!tag) {
    return evaluateAutomationOperator(event?.nextValue, operator, expected);
  }
  const actualFromContext = getAutomationContextValue(eventValueContext, tag);
  const actual = actualFromContext !== undefined ? actualFromContext : values[tag];
  return evaluateAutomationOperator(actual, operator, expected);
}

function evaluateAutomationConditionList(conditions, mergedStatus, event, extraContext = {}, logicOverride = "and") {
  const values = mergedStatus?.values && typeof mergedStatus.values === "object" ? mergedStatus.values : {};
  const eventValueContext = {
    ...buildAutomationValueContext(event),
    ...extraContext,
  };
  const rows = Array.isArray(conditions) ? conditions : [];
  if (!rows.length) return true;
  const logic = String(logicOverride || "and").trim().toLowerCase() === "or" ? "or" : "and";
  if (logic === "or") {
    for (const condition of rows) {
      if (evaluateAutomationConditionNode(condition, mergedStatus, event, eventValueContext)) return true;
    }
    return false;
  }
  for (const condition of rows) {
    if (!evaluateAutomationConditionNode(condition, mergedStatus, event, eventValueContext)) return false;
  }
  return true;
}

function evaluateAutomationConditions(rule, mergedStatus, event) {
  return evaluateAutomationConditionList(rule?.conditions, mergedStatus, event, {}, rule?.conditions_logic || "and");
}

async function executeAutomationAction(action, event, mergedStatus, actionContext = {}) {
  const type = String(action?.type || "").trim().toLowerCase();
  const context = {
    ...buildAutomationValueContext(event),
    ...actionContext,
    project_id: String(action?.project_id || event?.projectId || ""),
  };
  if (type === "db.insert") {
    const table = String(action?.table || "").trim();
    if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("Invalid db.insert table.");
    const rawValues = parseAutomationJson(action?.values, action?.values && typeof action.values === "object" ? action.values : {});
    const values = applyAutomationTemplate(rawValues, context);
    const payload = values && typeof values === "object" && !Array.isArray(values) ? values : {};
    const keys = Object.keys(payload);
    let row = null;
    if (!keys.length) {
      const result = await pool.query(`INSERT INTO ${safeIdent(table)} DEFAULT VALUES RETURNING *`);
      row = result.rows[0] || null;
    } else {
      const cols = keys.map((k) => safeIdent(k)).join(", ");
      const vals = keys.map((_, i) => `$${i + 1}`).join(", ");
      const result = await pool.query(
        `INSERT INTO ${safeIdent(table)} (${cols}) VALUES (${vals}) RETURNING *`,
        keys.map((k) => payload[k])
      );
      row = result.rows[0] || null;
    }
    return { type, table, row, contextPatch: {} };
  }
  if (type === "db.update") {
    const table = String(action?.table || "").trim();
    if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("Invalid db.update table.");
    const whereRaw = parseAutomationJson(action?.where, action?.where && typeof action.where === "object" ? action.where : {});
    const valuesRaw = parseAutomationJson(action?.values, action?.values && typeof action.values === "object" ? action.values : {});
    const whereMap = whereRaw && typeof whereRaw === "object" && !Array.isArray(whereRaw) ? whereRaw : {};
    const valuesMap = valuesRaw && typeof valuesRaw === "object" && !Array.isArray(valuesRaw) ? valuesRaw : {};
    const valueEntries = Object.entries(valuesMap).filter(([key]) => /^[a-zA-Z0-9_]+$/.test(String(key || "").trim()));
    if (!valueEntries.length) throw new Error("db.update requires values.");
    const params = [];
    const sets = valueEntries.map(([key, rawVal]) => {
      params.push(applyAutomationTemplate(rawVal, context));
      return `${safeIdent(key)} = $${params.length}`;
    });
    const whereClauses = [];
    Object.entries(whereMap).forEach(([key, rawVal]) => {
      if (!/^[a-zA-Z0-9_]+$/.test(String(key || "").trim())) return;
      const value = applyAutomationTemplate(rawVal, context);
      if (value == null || value === "") whereClauses.push(`${safeIdent(key)} IS NULL`);
      else {
        params.push(value);
        whereClauses.push(`${safeIdent(key)} = $${params.length}`);
      }
    });
    if (!whereClauses.length) throw new Error("db.update requires where.");
    const sql = `UPDATE ${safeIdent(table)} SET ${sets.join(", ")} WHERE ${whereClauses.join(" AND ")} RETURNING *`;
    const { rows } = await pool.query(sql, params);
    return { type, table, count: rows.length, rows, contextPatch: {} };
  }
  if (type === "tag.write") {
    const writeTag = String(applyAutomationTemplate(String(action?.tag || action?.tagKey || ""), context) || "").trim();
    if (!writeTag) throw new Error("tag.write requires tag.");
    const writeValue = applyAutomationTemplate(action?.value, context);
    const result = await performOpcWrite({
      tagKey: writeTag,
      legacyTagKey: String(applyAutomationTemplate(String(action?.legacyTagKey || ""), context) || "").trim(),
      value: writeValue,
      uaType: String(action?.uaType || ""),
      applyInverseScale: action?.applyInverseScale !== false,
    });
    return { type, tag: writeTag, value: result?.value, contextPatch: {} };
  }
  if (type === "tag.read") {
    const readTag = String(
      applyAutomationTemplate(String(action?.tag || action?.tagKey || event?.tag || ""), context) || ""
    ).trim();
    if (!readTag) throw new Error("tag.read requires tag.");
    const values =
      mergedStatus?.values && typeof mergedStatus.values === "object" ? mergedStatus.values : {};
    const diagnostics =
      mergedStatus?.diagnostics && typeof mergedStatus.diagnostics === "object" ? mergedStatus.diagnostics : {};
    const hasValue = Object.prototype.hasOwnProperty.call(values, readTag);
    if (!hasValue) throw new Error(`Tag ${readTag} not found in OPC status cache.`);
    const value = values[readTag];
    const meta = diagnostics?.[readTag] && typeof diagnostics[readTag] === "object" ? diagnostics[readTag] : {};
    const saveAs = String(action?.saveAs || "tagValue").trim() || "tagValue";
    return {
      type,
      tag: readTag,
      value,
      meta,
      contextPatch: {
        [saveAs]: value,
        [`${saveAs}Meta`]: meta,
        [`${saveAs}Tag`]: readTag,
      },
    };
  }
  if (type === "tag.read_many") {
    const values =
      mergedStatus?.values && typeof mergedStatus.values === "object" ? mergedStatus.values : {};
    const diagnostics =
      mergedStatus?.diagnostics && typeof mergedStatus.diagnostics === "object" ? mergedStatus.diagnostics : {};
    const rawTags = parseAutomationJson(action?.tags, action?.tags && typeof action.tags === "object" ? action.tags : {});
    const tagMap = rawTags && typeof rawTags === "object" && !Array.isArray(rawTags) ? rawTags : {};
    const saveAs = String(action?.saveAs || "reads").trim() || "reads";
    const out = {};
    const metaOut = {};
    const tagOut = {};
    const rowsOut = [];
    for (const [aliasRaw, tagRaw] of Object.entries(tagMap)) {
      const alias = String(aliasRaw || "").trim();
      const readTag = String(applyAutomationTemplate(String(tagRaw || ""), context) || "").trim();
      if (!alias || !readTag) continue;
      const hasValue = Object.prototype.hasOwnProperty.call(values, readTag);
      if (!hasValue) throw new Error(`Tag ${readTag} not found in OPC status cache.`);
      const tagValue = values[readTag];
      const tagMeta = diagnostics?.[readTag] && typeof diagnostics[readTag] === "object" ? diagnostics[readTag] : {};
      out[alias] = tagValue;
      metaOut[alias] = tagMeta;
      tagOut[alias] = readTag;
      rowsOut.push({
        alias,
        tag: readTag,
        value: tagValue,
        meta: tagMeta,
      });
    }
    return {
      type,
      tags: tagOut,
      values: out,
      rows: rowsOut,
      contextPatch: {
        [saveAs]: out,
        [`${saveAs}Meta`]: metaOut,
        [`${saveAs}Tags`]: tagOut,
        [`${saveAs}Rows`]: rowsOut,
      },
    };
  }
  if (type === "webhook") {
    const url = String(applyAutomationTemplate(String(action?.url || ""), context) || "").trim();
    if (!url) throw new Error("webhook requires url.");
    const method = String(action?.method || "POST").trim().toUpperCase();
    const headersRaw = parseAutomationJson(action?.headers, action?.headers && typeof action.headers === "object" ? action.headers : {});
    const headers = headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)
      ? applyAutomationTemplate(headersRaw, context)
      : {};
    const bodyRaw = Object.prototype.hasOwnProperty.call(action || {}, "body") ? action.body : null;
    const bodyValue = bodyRaw == null ? null : applyAutomationTemplate(bodyRaw, context);
    const fetchOptions = {
      method,
      headers: headers && typeof headers === "object" ? headers : {},
    };
    if (bodyValue != null && method !== "GET") {
      fetchOptions.body =
        typeof bodyValue === "string" ? bodyValue : JSON.stringify(bodyValue);
      if (!fetchOptions.headers["content-type"] && !fetchOptions.headers["Content-Type"]) {
        fetchOptions.headers["content-type"] = "application/json";
      }
    }
    const response = await fetch(url, fetchOptions);
    const text = await response.text().catch(() => "");
    if (!response.ok) throw new Error(`Webhook failed (${response.status}): ${text || response.statusText || "request failed"}`);
    return { type, url, status: response.status, body: text.slice(0, 1000), contextPatch: {} };
  }
  if (type === "delay") {
    const msValue = applyAutomationTemplate(action?.ms, context);
    const ms = Math.max(0, Math.min(60_000, Number.parseInt(String(msValue || 0), 10) || 0));
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    return { type, ms, contextPatch: {} };
  }
  if (type === "db.select") {
    const table = String(action?.table || "").trim();
    if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("Invalid db.select table.");
    const columnsRaw = Array.isArray(action?.columns) ? action.columns : [];
    const columns = columnsRaw
      .map((col) => String(col || "").trim())
      .filter((col) => /^[a-zA-Z0-9_]+$/.test(col));
    const whereRaw = parseAutomationJson(action?.where, action?.where && typeof action.where === "object" ? action.where : {});
    const whereMap = whereRaw && typeof whereRaw === "object" && !Array.isArray(whereRaw) ? whereRaw : {};
    const whereClauses = [];
    const params = [];
    Object.entries(whereMap).forEach(([key, rawVal]) => {
      if (!/^[a-zA-Z0-9_]+$/.test(String(key || "").trim())) return;
      const value = applyAutomationTemplate(rawVal, context);
      if (value == null || value === "") {
        whereClauses.push(`${safeIdent(key)} IS NULL`);
      } else {
        params.push(value);
        whereClauses.push(`${safeIdent(key)} = $${params.length}`);
      }
    });
    const orderBy = String(action?.orderBy || "").trim();
    const orderDir = String(action?.orderDir || "asc").trim().toLowerCase() === "desc" ? "DESC" : "ASC";
    const orderSql = /^[a-zA-Z0-9_]+$/.test(orderBy) ? ` ORDER BY ${safeIdent(orderBy)} ${orderDir}` : "";
    const limitRaw = Number.parseInt(String(action?.limit || 0), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 200;
    params.push(limit);
    const selectCols = columns.length ? columns.map((col) => safeIdent(col)).join(", ") : "*";
    const sql = `SELECT ${selectCols} FROM ${safeIdent(table)}${
      whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : ""
    }${orderSql} LIMIT $${params.length}`;
    const { rows } = await pool.query(sql, params);
    const saveAs = String(action?.saveAs || "rows").trim() || "rows";
    return { type, table, count: rows.length, rows, contextPatch: { [saveAs]: rows } };
  }
  if (type === "dataset.select") {
    const reportId = String(applyAutomationTemplate(String(action?.reportId || action?.report_id || ""), context) || "").trim();
    const datasetId = String(applyAutomationTemplate(String(action?.datasetId || action?.dataset_id || ""), context) || "").trim();
    if (!reportId || !datasetId) throw new Error("dataset.select requires reportId and datasetId.");
    const { rows: reportRows } = await pool.query(
      `SELECT id, layout_json FROM ai_reports WHERE id = $1 LIMIT 1`,
      [reportId]
    );
    if (!reportRows.length) throw new Error(`Report ${reportId} not found.`);
    const layout = reportRows[0]?.layout_json && typeof reportRows[0].layout_json === "object"
      ? reportRows[0].layout_json
      : {};
    const datasets = Array.isArray(layout?.datasets) ? layout.datasets : [];
    const dataset = datasets.find((row) => String(row?.id || "").trim() === datasetId) || null;
    if (!dataset?.source || typeof dataset.source !== "object") {
      throw new Error(`Dataset ${datasetId} not found in report ${reportId}.`);
    }
    const result = await executeReportPreviewInternal(dataset.source, { userKey: "automation" });
    const saveAs = String(action?.saveAs || "rows").trim() || "rows";
    return {
      type,
      reportId,
      datasetId,
      count: Array.isArray(result?.rows) ? result.rows.length : 0,
      rows: Array.isArray(result?.rows) ? result.rows : [],
      columns: Array.isArray(result?.columns) ? result.columns : [],
      contextPatch: {
        [saveAs]: Array.isArray(result?.rows) ? result.rows : [],
        [`${saveAs}Columns`]: Array.isArray(result?.columns) ? result.columns : [],
      },
    };
  }
  if (type === "for_each") {
    const sourcePath = String(action?.source || action?.from || "").trim();
    if (!sourcePath) throw new Error("for_each requires source.");
    const rows = getAutomationContextValue(context, sourcePath);
    const list = Array.isArray(rows) ? rows : [];
    const nestedActions = Array.isArray(action?.actions) ? action.actions : [];
    const nestedResults = [];
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      const iterationContext = { ...actionContext, item, index };
      const executed = await executeAutomationActionList(nestedActions, event, mergedStatus, iterationContext);
      nestedResults.push(...(Array.isArray(executed?.actionResults) ? executed.actionResults : []));
    }
    return { type, source: sourcePath, iterations: list.length, nestedResults, contextPatch: {} };
  }
  if (type === "group") {
    const nestedActions = Array.isArray(action?.actions) ? action.actions : [];
    const executed = await executeAutomationActionList(nestedActions, event, mergedStatus, actionContext);
    return {
      type,
      nestedResults: Array.isArray(executed?.actionResults) ? executed.actionResults : [],
      contextPatch: executed?.actionContext && typeof executed.actionContext === "object" ? executed.actionContext : {},
    };
  }
  throw new Error(`Unsupported automation action: ${type || "unknown"}`);
}

async function executeAutomationActionList(actions, event, mergedStatus, initialContext = {}) {
  let actionContext = { ...initialContext };
  const actionResults = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    const when = Array.isArray(action?.when) ? action.when : [];
    if (when.length && !evaluateAutomationConditionList(when, mergedStatus, event, actionContext, action?.when_logic || "and")) {
      actionResults.push({
        type: String(action?.type || "").trim().toLowerCase(),
        skipped: true,
        reason: "conditions_not_met",
        contextPatch: {},
      });
      continue;
    }
    const result = await executeAutomationAction(action, event, mergedStatus, actionContext);
    actionResults.push(result);
    if (result?.contextPatch && typeof result.contextPatch === "object") {
      actionContext = { ...actionContext, ...result.contextPatch };
    }
  }
  return { actionResults, actionContext };
}

async function runAutomationRulesForStatusChange(existingStatus, mergedStatus) {
  const prevValues =
    existingStatus?.values && typeof existingStatus.values === "object" ? existingStatus.values : {};
  const nextValues =
    mergedStatus?.values && typeof mergedStatus.values === "object" ? mergedStatus.values : {};
  const nextQualities =
    mergedStatus?.qualities && typeof mergedStatus.qualities === "object" ? mergedStatus.qualities : {};
  const changedKeys = new Set([
    ...Object.keys(prevValues || {}),
    ...Object.keys(nextValues || {}),
  ]);
  if (!changedKeys.size) return;
  const rawRules = await loadEnabledAutomationRules();
  const rules = rawRules.map(normalizeAutomationRuleRow).filter((rule) => rule.enabled && rule.actions.length);
  if (!rules.length) return;

  for (const key of changedKeys) {
    const previousValue = prevValues[key];
    const nextValue = nextValues[key];
    if (automationValuesEqual(previousValue, nextValue)) continue;
    const event = {
      tagKey: String(key || ""),
      previousValue,
      nextValue,
      quality: nextQualities[key],
      at: Number(mergedStatus?.at || Date.now()),
    };
    const matchingRules = rules.filter((rule) => ruleMatchesAutomationEvent(rule, event));
    for (const rule of matchingRules) {
      if (!(await ruleScopeMatches(rule, event))) continue;
      if (rule.cooldownMs > 0 && rule.lastFiredAt > 0 && Date.now() - rule.lastFiredAt < rule.cooldownMs) {
        continue;
      }
      if (!evaluateAutomationConditions(rule, mergedStatus, event)) continue;
      const actionResults = [];
      try {
        await pool.query(
          `UPDATE automation_rule SET last_fired_at = now(), updated_at = now() WHERE id = $1`,
          [rule.id]
        );
        const executed = await executeAutomationActionList(rule.actions, event, mergedStatus, {});
        actionResults.push(...(Array.isArray(executed?.actionResults) ? executed.actionResults : []));
        await logAutomationRuleRun({
          ruleId: rule.id,
          ruleName: rule.name,
          triggerTag: event.tagKey,
          previousValue,
          currentValue: nextValue,
          status: "ok",
          actionResults,
        });
      } catch (err) {
        await pool.query(
          `UPDATE automation_rule SET updated_at = now() WHERE id = $1`,
          [rule.id]
        ).catch(() => {});
        await logAutomationRuleRun({
          ruleId: rule.id,
          ruleName: rule.name,
          triggerTag: event.tagKey,
          previousValue,
          currentValue: nextValue,
          status: "error",
          message: String(err?.message || "Automation rule execution failed."),
          actionResults,
        });
      }
    }
  }
}

async function readAutomationDbTriggerValue(rule) {
  const table = String(rule?.triggerTable || "").trim();
  const column = String(rule?.triggerColumn || "").trim();
  if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("DB trigger requires a valid trigger_table.");
  if (!/^[a-zA-Z0-9_]+$/.test(column)) throw new Error("DB trigger requires a valid trigger_column.");
  const whereMap =
    rule?.triggerWhereJson && typeof rule.triggerWhereJson === "object" && !Array.isArray(rule.triggerWhereJson)
      ? rule.triggerWhereJson
      : {};
  const whereClauses = [];
  const params = [];
  Object.entries(whereMap).forEach(([key, rawVal]) => {
    if (!/^[a-zA-Z0-9_]+$/.test(String(key || "").trim())) return;
    if (rawVal == null || rawVal === "") {
      whereClauses.push(`${safeIdent(key)} IS NULL`);
    } else {
      params.push(rawVal);
      whereClauses.push(`${safeIdent(key)} = $${params.length}`);
    }
  });
  const orderBy = String(rule?.triggerOrderBy || "").trim();
  const orderDir = String(rule?.triggerOrderDir || "asc").trim().toLowerCase() === "desc" ? "DESC" : "ASC";
  const orderSql = /^[a-zA-Z0-9_]+$/.test(orderBy) ? ` ORDER BY ${safeIdent(orderBy)} ${orderDir}` : "";
  const sql = `SELECT * FROM ${safeIdent(table)}${
    whereClauses.length ? ` WHERE ${whereClauses.join(" AND ")}` : ""
  }${orderSql} LIMIT 1`;
  const { rows } = await pool.query(sql, params);
  const row = rows[0] && typeof rows[0] === "object" ? rows[0] : null;
  return {
    row,
    value: row ? row[column] : null,
    triggerKey: `db:${table}.${column}`,
  };
}

async function runAutomationRulesForDbTriggers() {
  if (automationDbPollInFlight) return;
  automationDbPollInFlight = true;
  try {
    const rawRules = await loadEnabledAutomationRules();
    const rules = rawRules
      .map(normalizeAutomationRuleRow)
      .filter((rule) => rule.enabled && rule.triggerSource === "db" && rule.actions.length);
    if (!rules.length) return;
    const mergedStatus = await loadCurrentOpcStatus();
    for (const rule of rules) {
      let readResult = null;
      try {
        readResult = await readAutomationDbTriggerValue(rule);
      } catch (err) {
        await logAutomationRuleRun({
          ruleId: rule.id,
          ruleName: rule.name,
          triggerTag: `db:${rule.triggerTable || ""}.${rule.triggerColumn || ""}`,
          previousValue: rule.lastSeenValue,
          currentValue: null,
          status: "error",
          message: String(err?.message || "Failed to evaluate DB automation trigger."),
          actionResults: [],
        });
        continue;
      }
      const previousValue = rule.lastSeenValue;
      const nextValue = readResult?.value ?? null;
      const event = {
        triggerType: "db",
        tagKey: readResult?.triggerKey || `db:${rule.triggerTable || ""}.${rule.triggerColumn || ""}`,
        previousValue,
        nextValue,
        quality: "db",
        row: readResult?.row || null,
        at: Date.now(),
      };
      const firstObservation = previousValue == null && !rule.lastFiredAt;
      try {
        await pool.query(
          `UPDATE automation_rule SET last_seen_value = $2, updated_at = now() WHERE id = $1`,
          [rule.id, nextValue == null ? null : JSON.stringify(nextValue)]
        );
      } catch {
        // best effort
      }
      if (firstObservation) continue;
      if (rule.cooldownMs > 0 && rule.lastFiredAt > 0 && Date.now() - rule.lastFiredAt < rule.cooldownMs) {
        continue;
      }
      const matchesMode =
        rule.triggerMode === "rising"
          ? !isAutomationTruthy(previousValue) && isAutomationTruthy(nextValue)
          : rule.triggerMode === "falling"
            ? isAutomationTruthy(previousValue) && !isAutomationTruthy(nextValue)
            : rule.triggerMode === "counter_change"
              ? (() => {
                  const delta = automationNumericDelta(previousValue, nextValue);
                  return delta != null && delta !== 0;
                })()
              : rule.triggerMode === "counter_increase"
                ? (() => {
                    const delta = automationNumericDelta(previousValue, nextValue);
                    return delta != null && delta > 0;
                  })()
                : rule.triggerMode === "counter_decrease"
                  ? (() => {
                      const delta = automationNumericDelta(previousValue, nextValue);
                      return delta != null && delta < 0;
                    })()
            : !automationValuesEqual(previousValue, nextValue);
      if (!matchesMode) continue;
      if (!(await ruleScopeMatches(rule, event))) continue;
      if (!evaluateAutomationConditions(rule, mergedStatus, event)) continue;
      const actionResults = [];
      try {
        await pool.query(
          `UPDATE automation_rule SET last_fired_at = now(), updated_at = now() WHERE id = $1`,
          [rule.id]
        );
        const executed = await executeAutomationActionList(rule.actions, event, mergedStatus, {});
        actionResults.push(...(Array.isArray(executed?.actionResults) ? executed.actionResults : []));
        await logAutomationRuleRun({
          ruleId: rule.id,
          ruleName: rule.name,
          triggerTag: event.tagKey,
          previousValue,
          currentValue: nextValue,
          status: "ok",
          actionResults,
        });
      } catch (err) {
        await logAutomationRuleRun({
          ruleId: rule.id,
          ruleName: rule.name,
          triggerTag: event.tagKey,
          previousValue,
          currentValue: nextValue,
          status: "error",
          message: String(err?.message || "Automation rule execution failed."),
          actionResults,
        });
      }
    }
  } finally {
    automationDbPollInFlight = false;
  }
}

async function executeReportPreviewInternal(body = {}, options = {}) {
  const mode = String(body?.mode || "sql").trim().toLowerCase();
  const userKey = String(options?.userKey || options?.userId || "anonymous").trim() || "anonymous";
  let sqlTemplate = String(body?.sql || "").trim();
  if (mode === "table") {
    const table = String(body?.table || "").trim();
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      throw new Error("Valid table is required.");
    }
    const selectedColumns = Array.isArray(body?.selectedColumns)
      ? body.selectedColumns
          .map((c) => String(c || "").trim())
          .filter((c) => /^[a-zA-Z0-9_]+$/.test(c))
      : [];
    const groupByColumns = Array.isArray(body?.groupByColumns)
      ? Array.from(
          new Set(
            body.groupByColumns
              .map((c) => String(c || "").trim())
              .filter((c) => /^[a-zA-Z0-9_]+$/.test(c))
          )
        )
      : [];
    const limit = Math.min(1000, Math.max(1, Number(body?.limit) || 100));
    const selectCols = selectedColumns.length
      ? selectedColumns.map((c) => safeIdent(c)).join(", ")
      : "*";
    const allowedOps = new Set(["=", "!=", ">", ">=", "<", "<=", "like", "ilike"]);
    const rawTableFilters = Array.isArray(body?.tableFilters) ? body.tableFilters : [];
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
    const guard = await loadReportSqlGuardSettings();
    enforceReportRateLimit(userKey, guard);
    const releaseSlot = acquireReportQuerySlot(guard);
    let resultPayload = null;
    try {
      resultPayload = await runReadOnlyQueryWithGuards(sql, values, guard);
    } finally {
      releaseSlot();
    }
    const { result, maxRows, timeoutMs, truncated } = resultPayload;
    const columns = (result.fields || []).map((f) => f.name);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const summedColumns = extractSummedOutputColumns(sql, columns);
    const summaryRow = summedColumns.length ? buildSummaryRow(rows, columns, summedColumns) : null;
    return {
      sql,
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      maxRows,
      timeoutMs,
      expectedFilters: [],
      expectedPositionalParams: 0,
      summaryRow,
    };
  }
  if (mode === "routine") {
    const routineOid = String(body?.routineOid || "").trim();
    if (!routineOid || !/^\d+$/.test(routineOid)) {
      throw new Error("Routine selection required.");
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
    if (!meta.rows.length) throw new Error("Routine not found.");
    const routine = meta.rows[0];
    if (String(routine.routine_kind || "") === "p") {
      throw new Error("Procedures are not supported for preview. Use a set-returning function.");
    }
    const args = Array.isArray(body?.routineArgs) ? body.routineArgs : [];
    const placeholders = args.map((_v, i) => `$${i + 1}`).join(", ");
    const fnIdent = safeQualifiedIdent(routine.schema_name, routine.routine_name);
    if (Boolean(routine.returns_set)) {
      sqlTemplate = `SELECT * FROM ${fnIdent}(${placeholders}) LIMIT 100`;
    } else {
      sqlTemplate = `SELECT ${fnIdent}(${placeholders}) AS result LIMIT 1`;
    }
  }
  if (!sqlTemplate) {
    throw new Error("Report SQL required.");
  }
  const expectedFilters = extractReportFilterNames(sqlTemplate);
  const expectedPositionalParams = extractPositionalParamCount(sqlTemplate);
  const filterValues =
    body?.filters && typeof body.filters === "object" && !Array.isArray(body.filters)
      ? body.filters
      : {};
  const positionalValues =
    mode === "routine"
      ? Array.isArray(body?.routineArgs)
        ? body.routineArgs
        : []
      : Array.isArray(body?.positional)
        ? body.positional
        : [];
  const { sql, values } = buildParameterizedReadOnlyQuery(sqlTemplate, filterValues, positionalValues);
  const guard = await loadReportSqlGuardSettings();
  enforceReportRateLimit(userKey, guard);
  const releaseSlot = acquireReportQuerySlot(guard);
  let resultPayload = null;
  try {
    resultPayload = await runReadOnlyQueryWithGuards(sql, values, guard);
  } finally {
    releaseSlot();
  }
  const { result, maxRows, timeoutMs, truncated } = resultPayload;
  const columns = (result.fields || []).map((f) => f.name);
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const summedColumns = extractSummedOutputColumns(sql, columns);
  const summaryRow = summedColumns.length ? buildSummaryRow(rows, columns, summedColumns) : null;
  return {
    sql,
    columns,
    rows,
    rowCount: rows.length,
    truncated,
    maxRows,
    timeoutMs,
    expectedFilters,
    expectedPositionalParams,
    summaryRow,
  };
}

app.post("/api/opc/status", async (req, res) => {
  try {
    const status = req.body;
    if (!status || typeof status !== "object" || Array.isArray(status)) {
      res.status(400).json({ error: "status object required." });
      return;
    }
    let existingStatus =
      opcStatusCache.status && typeof opcStatusCache.status === "object"
        ? opcStatusCache.status
        : {};
    if (OPC_PERSIST_LIVE_STATUS && (!existingStatus || !Object.keys(existingStatus).length)) {
      const current = await pool.query("SELECT status FROM opc_status WHERE id = 1 LIMIT 1");
      existingStatus =
        current.rows[0]?.status && typeof current.rows[0].status === "object"
          ? current.rows[0].status
          : {};
    }
    const mergedStatus = {
      ...status,
      diagnostics: mergeWriteDiagnostics(status?.diagnostics, existingStatus?.diagnostics),
      runtime: mergeRuntimeWriteMetrics(status?.runtime, existingStatus?.runtime),
    };
    maybeLogOpcConnectionState(mergedStatus);
    writeOpcStatusCache(mergedStatus, Date.now());
    scheduleOpcStatusDbPersist(mergedStatus);
    try {
      await runAutomationRulesForStatusChange(existingStatus, mergedStatus);
    } catch (err) {
      appendServerLog("error", "automation rule execution failed", { error: err?.message || String(err) }, "automation");
    }
    const at = normalizeTrendTimestamp(mergedStatus?.at);
    const values =
      mergedStatus?.values && typeof mergedStatus.values === "object" ? mergedStatus.values : {};
    const diagnostics =
      mergedStatus?.diagnostics && typeof mergedStatus.diagnostics === "object"
        ? mergedStatus.diagnostics
        : {};
    const trendConfigMap = await loadTrendTagConfigMap();
    if (!(trendConfigMap instanceof Map) || trendConfigMap.size > 0) {
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
    }
    await flushTrendBuffersIfNeeded(at);
    if (at - trendLastCleanupAt >= 5 * 60 * 1000) {
      trendLastCleanupAt = at;
      const cutoff = at - OPC_TREND_RETENTION_MS;
      const trendDb = trendPool || pool;
      if (trendDb) {
        await ensureTrendChunkTable(trendDb, getTrendChunkTableNameForTimestamp(at));
        const trendTables = await listTrendChunkTables(trendDb, { refresh: true, includeLegacy: true });
        for (const tableName of trendTables) {
          await trendDb.query(`DELETE FROM ${quoteTrendChunkTable(tableName)} WHERE to_ts < $1`, [cutoff]);
        }
      }
    }
    try {
      await refreshActiveOpcAlarms(mergedStatus);
    } catch {
      // alarm refresh is best-effort and should not fail opc status ingestion
    }
    res.json({ ok: true });
  } catch (err) {
    logOpcError("save status", err);
    res.status(500).json({ error: err?.message || "Failed to save OPC status." });
  }
});

app.post("/api/opc/write", async (req, res) => {
  try {
    const result = await performOpcWrite({
      tagKey: req.body?.tagKey,
      legacyTagKey: req.body?.legacyTagKey,
      value: req.body?.value,
      uaType: req.body?.uaType,
      applyInverseScale: req.body?.applyInverseScale !== false,
    });
    res.json(result);
  } catch (err) {
    logOpcError("write value", err, {
      tagKey: String(req.body?.tagKey || ""),
      legacyTagKey: String(req.body?.legacyTagKey || ""),
    });
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
    logOpcError("load templates", err);
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
    logOpcError("load tag mappings", err);
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
    logOpcError("save tag mappings", err, { tagKey: String(req.body?.tag_key || "") });
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
    logOpcError("load mapping sets", err);
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
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const updated = await db.query(
        `
        UPDATE opc_mapping_sets
        SET mappings = $2::jsonb, updated_at = now()
        WHERE name = $1
        `,
        [name, JSON.stringify(mappings)]
      );
      if (!updated.rowCount) {
        await db.query(
          `
          INSERT INTO opc_mapping_sets (name, mappings)
          VALUES ($1, $2::jsonb)
          `,
          [name, JSON.stringify(mappings)]
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
    logOpcError("save mapping set", err, { name: String(req.body?.name || "") });
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
    logOpcError("delete mapping set", err, { name: String(req.params.name || "") });
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
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const updated = await db.query(
        `
        UPDATE opc_tag_templates
        SET
          fields = $2::jsonb,
          parent_name = $3,
          state_mappings = $4::jsonb,
          group_name = $5
        WHERE name = $1
        `,
        [
          name,
          JSON.stringify(fields),
          parentName || null,
          JSON.stringify(stateMappings || []),
          groupName || null,
        ]
      );
      if (!updated.rowCount) {
        await db.query(
          `
          INSERT INTO opc_tag_templates (name, fields, parent_name, state_mappings, group_name)
          VALUES ($1, $2::jsonb, $3, $4::jsonb, $5)
          `,
          [
            name,
            JSON.stringify(fields),
            parentName || null,
            JSON.stringify(stateMappings || []),
            groupName || null,
          ]
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
    logOpcError("save template", err, { name: String(req.body?.name || "") });
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
    logOpcError("delete template", err, { name: String(req.params.name || "") });
    res.status(500).json({ error: err?.message || "Failed to delete template." });
  }
});

app.get("/api/system/version", async (_req, res) => {
  try {
    const state = await getSystemVersionState();
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load system version." });
  }
});

app.put("/api/system/version/align", async (_req, res) => {
  try {
    await ensureSystemVersionState();
    await pool.query(
      `
      UPDATE system_version_state
      SET app_version = $1,
          db_version = $2,
          expected_db_version = $2,
          updated_at = now()
      WHERE id = 1
    `,
      [APP_VERSION, EXPECTED_DB_VERSION]
    );
    const state = await getSystemVersionState();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to align system version." });
  }
});

app.get("/api/db/backup/config", async (_req, res) => {
  try {
    const cfg = await loadDbBackupConfigFromStore();
    dbBackupState = cfg;
    res.json({ config: cfg });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load backup config." });
  }
});

app.put("/api/db/backup/config", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incoming = body?.config && typeof body.config === "object" ? body.config : body;
    const next = await saveDbBackupConfigToStore({
      ...dbBackupState,
      ...incoming,
    });
    scheduleDatabaseBackups();
    res.json({ ok: true, config: next });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save backup config." });
  }
});

app.get("/api/db/backups", async (_req, res) => {
  try {
    const cfg = await loadDbBackupConfigFromStore();
    dbBackupState = cfg;
    const backups = listBackups();
    res.json({
      config: cfg,
      backups,
      running: dbBackupInFlight,
      backupDir: DB_BACKUP_DIR,
      backupRedundantDir: DB_BACKUP_REDUNDANT_DIR,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load backups." });
  }
});

app.post("/api/db/backups/run", async (req, res) => {
  if (dbBackupInFlight) {
    res.status(409).json({ error: "A backup operation is already running." });
    return;
  }
  dbBackupInFlight = true;
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const includeTrendDb = body?.includeTrendDb !== false;
    const backup = await runDatabaseBackup({ reason: "manual", includeTrendDb });
    res.json({ ok: true, backup });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to create backup." });
  } finally {
    dbBackupInFlight = false;
  }
});

app.post("/api/db/backups/restore", async (req, res) => {
  if (dbBackupInFlight) {
    res.status(409).json({ error: "Another backup/restore operation is already running." });
    return;
  }
  dbBackupInFlight = true;
  try {
    const backupId = safeBackupToken(req.body?.backupId || req.body?.id || "");
    if (!backupId) {
      res.status(400).json({ error: "backupId required." });
      return;
    }
    const result = await runDatabaseRestore(backupId);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to restore backup." });
  } finally {
    dbBackupInFlight = false;
  }
});

app.get("/api/db/backups/file/:backupId/:kind", async (req, res) => {
  try {
    const backupId = safeBackupToken(req.params?.backupId || "");
    const kind = String(req.params?.kind || "main").trim().toLowerCase();
    if (!backupId) {
      res.status(400).json({ error: "backupId required." });
      return;
    }
    if (kind !== "main" && kind !== "trend") {
      res.status(400).json({ error: "kind must be main or trend." });
      return;
    }
    const backup = findBackupById(backupId);
    if (!backup) {
      res.status(404).json({ error: "Backup not found." });
      return;
    }
    const file = (Array.isArray(backup.files) ? backup.files : []).find(
      (f) => String(f?.kind || "").trim().toLowerCase() === kind
    );
    if (!file?.fileName) {
      res.status(404).json({ error: `Backup ${kind} dump not found.` });
      return;
    }
    const fileName = String(file.fileName || "").trim();
    const abs = resolveBackupFilePathWithRedundancy(fileName);
    if (!abs || !fs.existsSync(abs)) {
      res.status(404).json({ error: "Backup dump file is missing." });
      return;
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.status(200).sendFile(abs);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to download backup file." });
  }
});

app.get("/api/db/backups/export/:backupId", async (req, res) => {
  try {
    const backupId = safeBackupToken(req.params?.backupId || "");
    if (!backupId) {
      res.status(400).json({ error: "backupId required." });
      return;
    }
    const bundle = buildBackupExportBundle(backupId);
    const fileName = `${safeBackupToken(backupId)}.mesora-backup.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.status(200).send(`${JSON.stringify(bundle, null, 2)}\n`);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to export backup." });
  }
});

app.post("/api/db/backups/import", async (req, res) => {
  if (dbBackupInFlight) {
    res.status(409).json({ error: "Another backup/restore operation is already running." });
    return;
  }
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const bundle = body?.bundle && typeof body.bundle === "object" ? body.bundle : body;
    const backup = importBackupBundle(bundle);
    res.json({ ok: true, backup });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to import backup bundle." });
  }
});

app.get("/api/db/config", async (_req, res) => {
  try {
    const connection = parseDatabaseConnectionInfo(DATABASE_URL);
    const connectionUrl = DB_CLIENT === "postgres" ? parseDatabaseUrlObject(DATABASE_URL) : null;
    const trendConnection = parseDatabaseConnectionInfo(TREND_DATABASE_URL || DATABASE_URL);
    const trendConnectionUrl =
      DB_CLIENT === "postgres" ? parseDatabaseUrlObject(TREND_DATABASE_URL || DATABASE_URL) : null;
    const logConnection = parseDatabaseConnectionInfo(LOG_DATABASE_URL || DATABASE_URL);
    const logConnectionUrl =
      DB_CLIENT === "postgres" ? parseDatabaseUrlObject(LOG_DATABASE_URL || DATABASE_URL) : null;
    const editable =
      DB_CLIENT === "sqlserver"
        ? {
            protocol: "sqlserver",
            host: String(process.env.DB_SQLSERVER_HOST || "").trim(),
            port: Number.parseInt(String(process.env.DB_SQLSERVER_PORT || "1433"), 10) || 1433,
            database: String(process.env.DB_SQLSERVER_DATABASE || "").trim(),
            user: String(process.env.DB_SQLSERVER_USER || "").trim(),
            passwordSet: String(process.env.DB_SQLSERVER_PASSWORD || "").trim().length > 0,
            sslMode: ["1", "true", "yes", "on"].includes(
              String(process.env.DB_SQLSERVER_ENCRYPT || "true").trim().toLowerCase()
            )
              ? "encrypt"
              : "",
            applicationName: String(process.env.DB_SQLSERVER_APP_NAME || "").trim(),
            trustServerCertificate: ["1", "true", "yes", "on"].includes(
              String(process.env.DB_SQLSERVER_TRUST_SERVER_CERTIFICATE || "true")
                .trim()
                .toLowerCase()
            ),
          }
        : {
            protocol: String(connectionUrl?.protocol || "postgres:").replace(/:$/, "") || "postgres",
            host: String(connectionUrl?.hostname || "").trim(),
            port: Number.isFinite(Number(connectionUrl?.port)) ? Number(connectionUrl.port) : 5432,
            database: String(connectionUrl?.pathname || "").replace(/^\//, "").trim(),
            user: decodeURIComponent(String(connectionUrl?.username || "").trim()),
            passwordSet: String(connectionUrl?.password || "").trim().length > 0,
            sslMode: String(connectionUrl?.searchParams?.get("sslmode") || "").trim(),
            applicationName: String(connectionUrl?.searchParams?.get("application_name") || "").trim(),
            trendDatabaseUrl: String(TREND_DATABASE_URL || "").trim(),
            trendPoolMax: TREND_DB_POOL_MAX,
            trendProtocol:
              String(trendConnectionUrl?.protocol || "postgres:").replace(/:$/, "") || "postgres",
            trendHost: String(trendConnectionUrl?.hostname || "").trim(),
            trendPort: Number.isFinite(Number(trendConnectionUrl?.port))
              ? Number(trendConnectionUrl.port)
              : 5432,
            trendDatabase: String(trendConnectionUrl?.pathname || "").replace(/^\//, "").trim(),
            trendUser: decodeURIComponent(String(trendConnectionUrl?.username || "").trim()),
            logDatabaseUrl: String(LOG_DATABASE_URL || "").trim(),
            logPoolMax: LOG_DB_POOL_MAX,
            logProtocol:
              String(logConnectionUrl?.protocol || "postgres:").replace(/:$/, "") || "postgres",
            logHost: String(logConnectionUrl?.hostname || "").trim(),
            logPort: Number.isFinite(Number(logConnectionUrl?.port))
              ? Number(logConnectionUrl.port)
              : 5432,
            logDatabase: String(logConnectionUrl?.pathname || "").replace(/^\//, "").trim(),
            logUser: decodeURIComponent(String(logConnectionUrl?.username || "").trim()),
          };
    const poolInfo = {
      configuredMax: DB_POOL_MAX,
      max: Number.isFinite(Number(pool?.options?.max)) ? Number(pool.options.max) : null,
      total: Number.isFinite(Number(pool?.totalCount)) ? Number(pool.totalCount) : 0,
      idle: Number.isFinite(Number(pool?.idleCount)) ? Number(pool.idleCount) : 0,
      waiting: Number.isFinite(Number(pool?.waitingCount)) ? Number(pool.waitingCount) : 0,
    };
    const trendPoolInfo = {
      configuredMax: TREND_DB_POOL_MAX,
      max: Number.isFinite(Number(trendPool?.options?.max)) ? Number(trendPool.options.max) : null,
      total: Number.isFinite(Number(trendPool?.totalCount)) ? Number(trendPool.totalCount) : 0,
      idle: Number.isFinite(Number(trendPool?.idleCount)) ? Number(trendPool.idleCount) : 0,
      waiting: Number.isFinite(Number(trendPool?.waitingCount)) ? Number(trendPool.waitingCount) : 0,
      sameAsMain: !!trendPool && trendPool === pool,
    };
    const logPoolInfo = {
      configuredMax: LOG_DB_POOL_MAX,
      max: Number.isFinite(Number(logPool?.options?.max)) ? Number(logPool.options.max) : null,
      total: Number.isFinite(Number(logPool?.totalCount)) ? Number(logPool.totalCount) : 0,
      idle: Number.isFinite(Number(logPool?.idleCount)) ? Number(logPool.idleCount) : 0,
      waiting: Number.isFinite(Number(logPool?.waitingCount)) ? Number(logPool.waitingCount) : 0,
      sameAsMain: !!logPool && logPool === pool,
      sameAsTrend: !!logPool && !!trendPool && logPool === trendPool && trendPool !== pool,
    };
    let sqlGuards = {
      reportQueryTimeoutMs: REPORT_QUERY_TIMEOUT_MS,
      reportMaxResultRows: REPORT_MAX_RESULT_ROWS,
      reportMaxConcurrentQueries: REPORT_MAX_CONCURRENT_QUERIES,
      reportRateWindowMs: REPORT_RATE_WINDOW_MS,
      reportRateMaxRequests: REPORT_RATE_MAX_REQUESTS,
    };
    try {
      const cfgRes = await pool.query("SELECT config FROM opc_config WHERE id = 1 LIMIT 1");
      const runtime = cfgRes.rows?.[0]?.config?.runtime;
      if (runtime && typeof runtime === "object") {
        sqlGuards = {
          reportQueryTimeoutMs: clampReportQueryTimeoutMs(runtime.reportQueryTimeoutMs),
          reportMaxResultRows: clampReportMaxRows(runtime.reportMaxResultRows),
          reportMaxConcurrentQueries: clampReportMaxConcurrentQueries(
            runtime.reportMaxConcurrentQueries
          ),
          reportRateWindowMs: clampReportRateWindowMs(runtime.reportRateWindowMs),
          reportRateMaxRequests: clampReportRateMaxRequests(runtime.reportRateMaxRequests),
        };
      }
    } catch {
      // keep defaults if opc_config is unavailable
    }

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

    const versionState = await getSystemVersionState();
    res.json({
      dbClient: DB_CLIENT,
      supportedClients: ["postgres", "sqlserver"],
      connection,
      trendConnection,
      logConnection,
      editable,
      versions: versionState,
      pool: poolInfo,
      trendPool: trendPoolInfo,
      logPool: logPoolInfo,
      sqlGuards,
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

app.put("/api/db/config", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const requestedClient = normalizeDbClient(body?.client || body?.dbClient || DB_CLIENT);
    const currentUrl = parseDatabaseUrlObject(DATABASE_URL);

    const incoming = body?.connection && typeof body.connection === "object" ? body.connection : {};
    const protocol = String(
      incoming.protocol || currentUrl?.protocol?.replace(/:$/, "") || requestedClient || "postgres"
    )
      .trim()
      .replace(/:$/, "");
    const host = String(incoming.host || currentUrl?.hostname || "").trim();
    const database = String(incoming.database || currentUrl?.pathname?.replace(/^\//, "") || "").trim();
    const user = String(incoming.user || decodeURIComponent(currentUrl?.username || "") || "").trim();
    const sslMode = String(
      incoming.sslMode != null ? incoming.sslMode : currentUrl?.searchParams?.get("sslmode") || ""
    ).trim();
    const applicationName = String(
      incoming.applicationName != null
        ? incoming.applicationName
        : currentUrl?.searchParams?.get("application_name") || ""
    ).trim();
    const nextPortRaw = incoming.port != null ? incoming.port : currentUrl?.port || 5432;
    const port = Number.parseInt(String(nextPortRaw), 10);
    const nextPoolMax = Number.parseInt(String(body.poolMax != null ? body.poolMax : DB_POOL_MAX), 10);
    const nextTrendPoolMax = Number.parseInt(
      String(body.trendPoolMax != null ? body.trendPoolMax : TREND_DB_POOL_MAX),
      10
    );
    const nextLogPoolMax = Number.parseInt(
      String(body.logPoolMax != null ? body.logPoolMax : LOG_DB_POOL_MAX),
      10
    );
    const password = incoming.password != null ? String(incoming.password) : "";
    const incomingSqlGuards =
      body?.sqlGuards && typeof body.sqlGuards === "object" ? body.sqlGuards : {};
    const nextReportQueryTimeoutMs = clampReportQueryTimeoutMs(
      incomingSqlGuards?.reportQueryTimeoutMs
    );
    const nextReportMaxResultRows = clampReportMaxRows(
      incomingSqlGuards?.reportMaxResultRows
    );
    const nextReportMaxConcurrentQueries = clampReportMaxConcurrentQueries(
      incomingSqlGuards?.reportMaxConcurrentQueries
    );
    const nextReportRateWindowMs = clampReportRateWindowMs(
      incomingSqlGuards?.reportRateWindowMs
    );
    const nextReportRateMaxRequests = clampReportRateMaxRequests(
      incomingSqlGuards?.reportRateMaxRequests
    );

    if (!host || !database || !user || !Number.isFinite(port) || port <= 0 || port > 65535) {
      res.status(400).json({ error: "Host, port, database, and user are required." });
      return;
    }
    if (
      protocol !== "postgres" &&
      protocol !== "postgresql" &&
      protocol !== "sqlserver" &&
      protocol !== "mssql"
    ) {
      res.status(400).json({ error: "Protocol must be postgres/postgresql or sqlserver/mssql." });
      return;
    }
    if (!Number.isFinite(nextPoolMax) || nextPoolMax < 1 || nextPoolMax > 200) {
      res.status(400).json({ error: "poolMax must be between 1 and 200." });
      return;
    }
    if (!Number.isFinite(nextTrendPoolMax) || nextTrendPoolMax < 1 || nextTrendPoolMax > 200) {
      res.status(400).json({ error: "trendPoolMax must be between 1 and 200." });
      return;
    }
    if (!Number.isFinite(nextLogPoolMax) || nextLogPoolMax < 1 || nextLogPoolMax > 200) {
      res.status(400).json({ error: "logPoolMax must be between 1 and 200." });
      return;
    }

    const envPath = path.resolve(AI_SERVER_DIR, ".env");
    if (protocol === "sqlserver" || protocol === "mssql") {
      const trustServerCertificate =
        incoming.trustServerCertificate === true ||
        String(incoming.trustServerCertificate || "").trim().toLowerCase() === "true";
      // Save SQL Server settings as an inactive option; keep active runtime on postgres.
      upsertEnvVar(envPath, "DB_SQLSERVER_HOST", host);
      upsertEnvVar(envPath, "DB_SQLSERVER_PORT", String(port || 1433));
      upsertEnvVar(envPath, "DB_SQLSERVER_DATABASE", database);
      upsertEnvVar(envPath, "DB_SQLSERVER_USER", user);
      if (password.length > 0) upsertEnvVar(envPath, "DB_SQLSERVER_PASSWORD", password);
      upsertEnvVar(
        envPath,
        "DB_SQLSERVER_ENCRYPT",
        String(sslMode ? sslMode.toLowerCase() !== "disable" : true)
      );
      upsertEnvVar(
        envPath,
        "DB_SQLSERVER_TRUST_SERVER_CERTIFICATE",
        String(trustServerCertificate)
      );
      upsertEnvVar(envPath, "DB_SQLSERVER_APP_NAME", applicationName);
      upsertEnvVar(envPath, "DB_POOL_MAX", String(nextPoolMax));
      process.env.DB_SQLSERVER_HOST = host;
      process.env.DB_SQLSERVER_PORT = String(port || 1433);
      process.env.DB_SQLSERVER_DATABASE = database;
      process.env.DB_SQLSERVER_USER = user;
      if (password.length > 0) process.env.DB_SQLSERVER_PASSWORD = password;
      process.env.DB_SQLSERVER_ENCRYPT = String(sslMode ? sslMode.toLowerCase() !== "disable" : true);
      process.env.DB_SQLSERVER_TRUST_SERVER_CERTIFICATE = String(trustServerCertificate);
      process.env.DB_SQLSERVER_APP_NAME = applicationName;
      res.json({
        ok: true,
        pendingActivation: true,
        message:
          "SQL Server option saved as inactive. Active runtime remains postgres; no switch was made.",
        sqlGuards: {
          reportQueryTimeoutMs: nextReportQueryTimeoutMs,
          reportMaxResultRows: nextReportMaxResultRows,
          reportMaxConcurrentQueries: nextReportMaxConcurrentQueries,
          reportRateWindowMs: nextReportRateWindowMs,
          reportRateMaxRequests: nextReportRateMaxRequests,
        },
      });
      return;
    }

    if (!currentUrl) {
      res.status(500).json({ error: "Current DATABASE_URL is invalid or not configured." });
      return;
    }
    const nextUrl = new URL(currentUrl.toString());
    nextUrl.protocol = `${protocol}:`;
    nextUrl.hostname = host;
    nextUrl.port = String(port);
    nextUrl.pathname = `/${database}`;
    nextUrl.username = user;
    if (password.length > 0) {
      nextUrl.password = password;
    }
    if (sslMode) nextUrl.searchParams.set("sslmode", sslMode);
    else nextUrl.searchParams.delete("sslmode");
    if (applicationName) nextUrl.searchParams.set("application_name", applicationName);
    else nextUrl.searchParams.delete("application_name");

    const trendDatabaseUrlRaw =
      body?.trendDatabaseUrl != null
        ? String(body.trendDatabaseUrl || "").trim()
        : String(TREND_DATABASE_URL || "").trim();
    const logDatabaseUrlRaw =
      body?.logDatabaseUrl != null
        ? String(body.logDatabaseUrl || "").trim()
        : String(LOG_DATABASE_URL || "").trim();
    const nextTrendUrl = trendDatabaseUrlRaw || deriveTrendDatabaseUrl(nextUrl.toString());
    const nextLogUrl = logDatabaseUrlRaw || deriveLogDatabaseUrl(nextUrl.toString());
    if (!parseDatabaseUrlObject(nextTrendUrl)) {
      res.status(400).json({ error: "trendDatabaseUrl must be a valid postgres URL." });
      return;
    }
    if (!parseDatabaseUrlObject(nextLogUrl)) {
      res.status(400).json({ error: "logDatabaseUrl must be a valid postgres URL." });
      return;
    }

    await ensureDatabaseExists(nextUrl.toString());
    await ensureDatabaseExists(nextTrendUrl);
    await ensureDatabaseExists(nextLogUrl);
    await rebuildDatabasePool(nextUrl.toString(), nextPoolMax);
    await rebuildAuxDatabasePools(nextTrendUrl, nextTrendPoolMax, nextLogUrl, nextLogPoolMax);
    await ensureServerLogSchema(logPool || pool);

    upsertEnvVar(envPath, "DB_CLIENT", "postgres");
    upsertEnvVar(envPath, "DATABASE_URL", nextUrl.toString());
    upsertEnvVar(envPath, "DB_POOL_MAX", String(nextPoolMax));
    upsertEnvVar(envPath, "TREND_DATABASE_URL", nextTrendUrl);
    upsertEnvVar(envPath, "TREND_DB_POOL_MAX", String(nextTrendPoolMax));
    upsertEnvVar(envPath, "LOG_DATABASE_URL", nextLogUrl);
    upsertEnvVar(envPath, "LOG_DB_POOL_MAX", String(nextLogPoolMax));
    DB_CLIENT = "postgres";
    process.env.DB_CLIENT = "postgres";

    try {
      const currentCfg = await pool.query("SELECT config FROM opc_config WHERE id = 1 LIMIT 1");
      const prevConfig =
        currentCfg.rows?.[0]?.config && typeof currentCfg.rows[0].config === "object"
          ? currentCfg.rows[0].config
          : {};
      const prevRuntime =
        prevConfig.runtime && typeof prevConfig.runtime === "object" ? prevConfig.runtime : {};
      const nextConfig = {
        ...prevConfig,
        runtime: {
          ...prevRuntime,
          reportQueryTimeoutMs: nextReportQueryTimeoutMs,
          reportMaxResultRows: nextReportMaxResultRows,
          reportMaxConcurrentQueries: nextReportMaxConcurrentQueries,
          reportRateWindowMs: nextReportRateWindowMs,
          reportRateMaxRequests: nextReportRateMaxRequests,
        },
      };
      await pool.query(
        "INSERT INTO opc_config (id, config) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()",
        [JSON.stringify(nextConfig)]
      );
    } catch {
      // keep DB connection save successful even if runtime guard save fails
    }

    res.json({
      ok: true,
      sqlGuards: {
        reportQueryTimeoutMs: nextReportQueryTimeoutMs,
        reportMaxResultRows: nextReportMaxResultRows,
        reportMaxConcurrentQueries: nextReportMaxConcurrentQueries,
        reportRateWindowMs: nextReportRateWindowMs,
        reportRateMaxRequests: nextReportRateMaxRequests,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save database config." });
  }
});

app.get("/api/db/diagnostics/postgres", async (_req, res) => {
  try {
    if (!pool) {
      res.status(500).json({ error: "Database pool is not initialized." });
      return;
    }

    const collectDiagForPool = async (targetPool, options = {}) => {
      if (!targetPool || typeof targetPool.query !== "function") {
        return {
          checkedAt: Date.now(),
          settings: {},
          connections: {},
          database: {},
          size: {},
          topTables: [],
          bgwriter: {},
          wal: {},
          locks: {},
          uptime: {},
          pool: {},
          connection: parseDatabaseConnectionInfo(options?.connectionString || ""),
        };
      }
      const safeQuery = async (sql, params = []) => {
        try {
          return await targetPool.query(sql, params);
        } catch (_err) {
          return { rows: [] };
        }
      };
      const [settingsRes, activityRes, dbStatRes, sizeRes, topTablesRes, bgwriterRes, walRes, locksRes, uptimeRes] = await Promise.all([
        safeQuery(
          `
          SELECT name, setting, unit
          FROM pg_settings
          WHERE name = ANY($1::text[])
        `,
          [[
            "shared_buffers",
            "work_mem",
            "maintenance_work_mem",
            "effective_cache_size",
            "temp_buffers",
            "max_connections",
            "max_worker_processes",
            "max_parallel_workers",
            "max_parallel_workers_per_gather",
            "max_parallel_maintenance_workers",
          ]]
        ),
        safeQuery(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE state = 'active')::int AS active,
            COUNT(*) FILTER (WHERE state = 'idle')::int AS idle,
            COUNT(*) FILTER (WHERE wait_event IS NOT NULL)::int AS waiting
          FROM pg_stat_activity
          WHERE datname = current_database()
        `),
        safeQuery(`
          SELECT
            blks_hit::bigint,
            blks_read::bigint,
            temp_files::bigint,
            temp_bytes::bigint,
            xact_commit::bigint,
            xact_rollback::bigint,
            deadlocks::bigint
          FROM pg_stat_database
          WHERE datname = current_database()
        `),
        safeQuery(`
          SELECT
            pg_database_size(current_database())::bigint AS db_bytes,
            COALESCE((
              SELECT SUM(pg_total_relation_size(c.oid))::bigint
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'r'
            ), 0)::bigint AS tables_bytes,
            COALESCE((
              SELECT SUM(pg_total_relation_size(c.oid))::bigint
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind = 'i'
            ), 0)::bigint AS indexes_bytes
        `),
        safeQuery(`
          SELECT
            c.relname AS table_name,
            COALESCE(s.n_live_tup, 0)::bigint AS est_rows,
            pg_total_relation_size(c.oid)::bigint AS total_bytes,
            pg_relation_size(c.oid)::bigint AS table_bytes,
            pg_indexes_size(c.oid)::bigint AS index_bytes
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
          WHERE n.nspname = 'public' AND c.relkind = 'r'
          ORDER BY pg_total_relation_size(c.oid) DESC
          LIMIT 25
        `),
        safeQuery(`
          SELECT
            checkpoints_timed::bigint,
            checkpoints_req::bigint,
            checkpoint_write_time::double precision,
            checkpoint_sync_time::double precision,
            buffers_checkpoint::bigint,
            buffers_clean::bigint,
            buffers_backend::bigint,
            maxwritten_clean::bigint
          FROM pg_stat_bgwriter
        `),
        safeQuery(`
          SELECT
            wal_records::bigint,
            wal_fpi::bigint,
            wal_bytes::numeric::text AS wal_bytes
          FROM pg_stat_wal
        `),
        safeQuery(`
          SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE NOT granted)::int AS waiting
          FROM pg_locks
        `),
        safeQuery(`
          SELECT
            EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::bigint AS uptime_seconds,
            pg_postmaster_start_time()::text AS started_at
        `),
      ]);
      const settingsRows = Array.isArray(settingsRes.rows) ? settingsRes.rows : [];
      const settings = settingsRows.reduce((acc, row) => {
        const key = String(row?.name || "").trim();
        if (!key) return acc;
        acc[key] = {
          setting: String(row?.setting || ""),
          unit: String(row?.unit || ""),
        };
        return acc;
      }, {});
      return {
        checkedAt: Date.now(),
        settings,
        connections: activityRes.rows?.[0] || {},
        database: dbStatRes.rows?.[0] || {},
        size: sizeRes.rows?.[0] || {},
        topTables: Array.isArray(topTablesRes.rows) ? topTablesRes.rows : [],
        bgwriter: bgwriterRes.rows?.[0] || {},
        wal: walRes.rows?.[0] || {},
        locks: locksRes.rows?.[0] || {},
        uptime: uptimeRes.rows?.[0] || {},
        pool: {
          max: Number.isFinite(Number(targetPool?.options?.max)) ? Number(targetPool.options.max) : null,
          total: Number.isFinite(Number(targetPool?.totalCount)) ? Number(targetPool.totalCount) : 0,
          idle: Number.isFinite(Number(targetPool?.idleCount)) ? Number(targetPool.idleCount) : 0,
          waiting: Number.isFinite(Number(targetPool?.waitingCount)) ? Number(targetPool.waitingCount) : 0,
        },
        connection: parseDatabaseConnectionInfo(options?.connectionString || ""),
      };
    };

    const mainDiag = await collectDiagForPool(pool, { connectionString: DATABASE_URL });
    const trendIsSameAsMain = !!trendPool && trendPool === pool;
    const trendDiag = trendPool
      ? trendIsSameAsMain
        ? {
            ...mainDiag,
            sameAsMain: true,
            connection: parseDatabaseConnectionInfo(TREND_DATABASE_URL || DATABASE_URL),
          }
        : {
            ...(await collectDiagForPool(trendPool, { connectionString: TREND_DATABASE_URL })),
            sameAsMain: false,
          }
      : null;
    const logIsSameAsMain = !!logPool && logPool === pool;
    const logIsSameAsTrend = !!logPool && !!trendPool && logPool === trendPool && trendPool !== pool;
    const logDiag = logPool
      ? logIsSameAsMain
        ? {
            ...mainDiag,
            sameAsMain: true,
            sameAsTrend: false,
            connection: parseDatabaseConnectionInfo(LOG_DATABASE_URL || DATABASE_URL),
          }
        : logIsSameAsTrend
        ? {
            ...(trendDiag || (await collectDiagForPool(logPool, { connectionString: LOG_DATABASE_URL }))),
            sameAsMain: false,
            sameAsTrend: true,
            connection: parseDatabaseConnectionInfo(LOG_DATABASE_URL || TREND_DATABASE_URL || DATABASE_URL),
          }
        : {
            ...(await collectDiagForPool(logPool, { connectionString: LOG_DATABASE_URL })),
            sameAsMain: false,
            sameAsTrend: false,
          }
      : null;

    res.json({
      ...mainDiag,
      trend: trendDiag,
      log: logDiag,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load PostgreSQL diagnostics." });
  }
});

app.get("/api/logs", requireAreaView("server"), async (req, res) => {
  try {
    const limitRaw = Number.parseInt(String(req.query?.limit || "250"), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, limitRaw)) : 250;
    const levelFilter = String(req.query?.level || "").trim().toLowerCase();
    const sourceFilter = String(req.query?.source || "").trim().toLowerCase();
    const categoryFilter = String(req.query?.category || "").trim().toLowerCase();
    const dataTypeFilter = String(req.query?.data_type || req.query?.dataType || "").trim().toLowerCase();
    const search = String(req.query?.q || "").trim().toLowerCase();
    const fromTsRaw = Number.parseInt(String(req.query?.from || ""), 10);
    const toTsRaw = Number.parseInt(String(req.query?.to || ""), 10);
    const fromIso = Number.isFinite(fromTsRaw) && fromTsRaw > 0 ? new Date(fromTsRaw).toISOString() : "";
    const toIso = Number.isFinite(toTsRaw) && toTsRaw > 0 ? new Date(toTsRaw).toISOString() : "";

    if (logPool) {
      const where = [];
      const values = [];
      const push = (sql, value) => {
        values.push(value);
        where.push(sql.replace("?", `$${values.length}`));
      };
      if (levelFilter) push(`lower(level) = ?`, levelFilter);
      if (sourceFilter) push(`lower(source) like ?`, `%${sourceFilter}%`);
      if (categoryFilter) push(`lower(category) = ?`, categoryFilter);
      if (dataTypeFilter) push(`lower(data_type) = ?`, dataTypeFilter);
      if (fromIso) push(`at >= ?::timestamptz`, fromIso);
      if (toIso) push(`at <= ?::timestamptz`, toIso);
      if (search) {
        values.push(`%${search}%`);
        values.push(`%${search}%`);
        where.push(`(lower(message) like $${values.length - 1} OR lower(coalesce(meta::text, '')) like $${values.length})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const totalSql = `SELECT COUNT(*)::int AS total FROM server_logs ${whereSql}`;
      const totalRes = await logPool.query(totalSql, values);
      const total = Number(totalRes.rows?.[0]?.total || 0);
      const listValues = [...values, limit];
      const listSql = `
        SELECT
          id,
          (extract(epoch from at) * 1000)::bigint AS at,
          level,
          source,
          category,
          data_type,
          message,
          meta,
          count
        FROM server_logs
        ${whereSql}
        ORDER BY at DESC, id DESC
        LIMIT $${listValues.length}
      `;
      const listRes = await logPool.query(listSql, listValues);
      const rows = (Array.isArray(listRes.rows) ? listRes.rows : []).map((row) => {
        const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
        return {
          id: row.id,
          at: Number(row.at) || Date.now(),
          level: String(row.level || "info"),
          source: String(row.source || "server"),
          category: String(row.category || "general"),
          data_type: String(row.data_type || "unknown"),
          message: String(row.message || ""),
          meta,
          meta_pretty: (() => {
            try {
              return JSON.stringify(meta, null, 2);
            } catch {
              return "";
            }
          })(),
          count: Math.max(1, Number.parseInt(String(row.count || 1), 10) || 1),
        };
      });
      return res.json({
        rows,
        total,
        limit,
        storage: "database",
      });
    }

    const rows = [...serverLogs]
      .reverse()
      .filter((entry) => {
        if (levelFilter && String(entry?.level || "").toLowerCase() !== levelFilter) return false;
        if (sourceFilter && !String(entry?.source || "").toLowerCase().includes(sourceFilter)) return false;
        if (categoryFilter && String(entry?.category || "").toLowerCase() !== categoryFilter) return false;
        if (dataTypeFilter && String(entry?.dataType || "").toLowerCase() !== dataTypeFilter) return false;
        if (!search) return true;
        const message = String(entry?.message || "").toLowerCase();
        const metaText = (() => {
          try {
            return JSON.stringify(entry?.meta || {}).toLowerCase();
          } catch {
            return "";
          }
        })();
        return message.includes(search) || metaText.includes(search);
      });

    return res.json({
      rows: rows.slice(0, limit),
      total: rows.length,
      limit,
      storage: "memory",
      serverLogLimit: SERVER_LOG_LIMIT,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load logs." });
  }
});

app.post("/api/logs/client", async (req, res) => {
  try {
    const userId = Number.parseInt(String(req.user?.id || ""), 10);
    const userName = String(req.user?.username || "").trim();
    const payload = sanitizeClientLogBody(req.body || {});
    const source = userName
      ? `client:${truncateString(userName, 32)}:${payload.source}`
      : `client:${payload.source}`;
    const meta = {
      ...payload.meta,
      userId: Number.isFinite(userId) ? userId : null,
      userName: userName || null,
      userAgent: truncateString(req.headers["user-agent"] || "", 240),
      route: truncateString(req.body?.route || "", 240),
      dataType: payload.dataType,
      category: payload.category,
    };
    appendServerLog(payload.level, payload.message, meta, source);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to record client log." });
  }
});

app.delete("/api/logs", requireAreaEdit("server"), async (_req, res) => {
  try {
    serverLogs.splice(0, serverLogs.length);
    if (logPool) {
      await logPool.query(`TRUNCATE TABLE server_logs RESTART IDENTITY`);
    }
    appendServerLog("warn", "Logs cleared by user request.", {}, "server");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to clear logs." });
  }
});

app.get("/api/diagnostics/app", async (_req, res) => {
  try {
    const checkedAt = Date.now();
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const hostCpu = computeHostCpuUsagePct(checkedAt);
    const appCpuPct = computeAppCpuUsagePct(checkedAt, cpu);
    const load = os.loadavg();
    const totalMemBytes = Number(os.totalmem() || 0);
    const freeMemBytes = Number(os.freemem() || 0);
    const usedMemBytes =
      totalMemBytes > 0 && Number.isFinite(totalMemBytes - freeMemBytes)
        ? Math.max(0, totalMemBytes - freeMemBytes)
        : null;
    const systemMemoryUsedPct =
      Number.isFinite(usedMemBytes) && totalMemBytes > 0
        ? Number(((usedMemBytes / totalMemBytes) * 100).toFixed(1))
        : null;
    const appRssBytes = Number(mem?.rss || 0);
    const appMemoryOfSystemPct =
      totalMemBytes > 0 && Number.isFinite(appRssBytes)
        ? Number(((appRssBytes / totalMemBytes) * 100).toFixed(2))
        : null;
    let dbPingMs = null;
    let dbError = "";
    if (pool) {
      const dbStart = Date.now();
      try {
        await pool.query("SELECT 1");
        dbPingMs = Date.now() - dbStart;
      } catch (err) {
        dbError = String(err?.message || "DB ping failed.");
      }
    } else {
      dbError = "Database pool is not initialized.";
    }

    let opcStatus = {};
    try {
      opcStatus = await loadCurrentOpcStatus();
    } catch {
      opcStatus = {};
    }

    const values = opcStatus?.values && typeof opcStatus.values === "object" ? opcStatus.values : {};
    const qualities = opcStatus?.qualities && typeof opcStatus.qualities === "object" ? opcStatus.qualities : {};
    const diagnostics = opcStatus?.diagnostics && typeof opcStatus.diagnostics === "object" ? opcStatus.diagnostics : {};
    const lastPollAt = Number(opcStatus?.lastPollAt || 0);
    const qualityCounts = Object.values(qualities).reduce((acc, q) => {
      const key = String(q || "Unknown");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const runtime = opcStatus?.runtime && typeof opcStatus.runtime === "object" ? opcStatus.runtime : {};

    res.json({
      checkedAt,
      app: {
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuCores: hostCpu.cores,
        cpuUsagePct: appCpuPct,
        hostCpuUsagePct: hostCpu.pct,
        loadAvg1m: Number.isFinite(load[0]) ? Number(load[0]) : null,
        loadAvg5m: Number.isFinite(load[1]) ? Number(load[1]) : null,
        loadAvg15m: Number.isFinite(load[2]) ? Number(load[2]) : null,
        totalMemoryBytes: totalMemBytes > 0 ? totalMemBytes : null,
        freeMemoryBytes: freeMemBytes >= 0 ? freeMemBytes : null,
        usedMemoryBytes: Number.isFinite(usedMemBytes) ? usedMemBytes : null,
        systemMemoryUsedPct,
        rssBytes: appRssBytes,
        appMemoryOfSystemPct,
        heapTotalBytes: Number(mem?.heapTotal || 0),
        heapUsedBytes: Number(mem?.heapUsed || 0),
        externalBytes: Number(mem?.external || 0),
        arrayBuffersBytes: Number(mem?.arrayBuffers || 0),
        cpuUserMs: Number.isFinite(cpu?.user) ? Math.round(cpu.user / 1000) : null,
        cpuSystemMs: Number.isFinite(cpu?.system) ? Math.round(cpu.system / 1000) : null,
      },
      db: {
        pingMs: dbPingMs,
        error: dbError,
      },
      opc: {
        connected: opcStatus?.connected === true,
        connections: opcStatus?.connections && typeof opcStatus.connections === "object" ? opcStatus.connections : {},
        lastPollAt: lastPollAt || null,
        lastPollAgeMs: lastPollAt > 0 ? Math.max(0, checkedAt - lastPollAt) : null,
        valueCount: Object.keys(values).length,
        diagnosticCount: Object.keys(diagnostics).length,
        qualityCounts,
        runtime: {
          opcConnectionEnabled: runtime?.opcConnectionEnabled !== false,
          multiReadEnabled: runtime?.multiReadEnabled !== false,
          multiReadBatchSize: Number.isFinite(Number(runtime?.multiReadBatchSize))
            ? Number(runtime.multiReadBatchSize)
            : null,
          mqttEnabled: runtime?.mqttEnabled === true,
          mqttConnected: runtime?.mqttConnected === true,
          readTimeoutMs: Number.isFinite(Number(runtime?.readTimeoutMs)) ? Number(runtime.readTimeoutMs) : null,
          plcTargets: Array.isArray(runtime?.plcTargets)
            ? runtime.plcTargets.map((t) => ({
                name: String(t?.name || "").trim(),
                host: String(t?.host || "").trim(),
                slot: Number.isFinite(Number(t?.slot)) ? Number(t.slot) : 0,
                connected: t?.connected === true,
                connectFailureStreak: Number.isFinite(Number(t?.connectFailureStreak))
                  ? Number(t.connectFailureStreak)
                  : 0,
                heartbeatFailureStreak: Number.isFinite(Number(t?.heartbeatFailureStreak))
                  ? Number(t.heartbeatFailureStreak)
                  : 0,
              }))
            : [],
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load app diagnostics." });
  }
});

function resolveServiceLauncherPaths() {
  const rootCandidates = [
    REPO_ROOT,
    DEFAULT_APP_ROOT,
    path.resolve(DEFAULT_APP_ROOT, ".."),
  ].filter(Boolean);
  for (const root of rootCandidates) {
    const startCmd = path.resolve(root, "Start-Mesora.cmd");
    const stopCmd = path.resolve(root, "Stop-Mesora.cmd");
    const runPs1 = path.resolve(root, "Run-Mesora.ps1");
    if (fs.existsSync(startCmd) && fs.existsSync(stopCmd)) {
      return { root, startCmd, stopCmd, runPs1 };
    }
  }
  return {
    root: REPO_ROOT,
    startCmd: path.resolve(REPO_ROOT, "Start-Mesora.cmd"),
    stopCmd: path.resolve(REPO_ROOT, "Stop-Mesora.cmd"),
    runPs1: path.resolve(REPO_ROOT, "Run-Mesora.ps1"),
  };
}

function toPsSingleQuoted(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function buildFallbackStartCommand(root) {
  const rootEsc = toPsSingleQuoted(root);
  const aiPort = Number.parseInt(String(process.env.PORT || "5055"), 10);
  const opcUaPort = Number.parseInt(String(process.env.MESORA_OPCUA_PORT || "4840"), 10);
  const aiPortSafe = Number.isFinite(aiPort) && aiPort > 0 ? aiPort : 5055;
  const opcUaPortSafe = Number.isFinite(opcUaPort) && opcUaPort > 0 ? opcUaPort : 4840;
  return [
    `$root = ${rootEsc}`,
    "Set-Location -Path $root",
    `$env:MESORA_AI_PORT = '${aiPortSafe}'`,
    `$env:MESORA_OPCUA_PORT = '${opcUaPortSafe}'`,
    "$npm = Get-Command -Name 'npm.cmd' -ErrorAction SilentlyContinue",
    "if ($npm -and $npm.Source) { & $npm.Source run start:prod; exit $LASTEXITCODE }",
    "& npm run start:prod",
  ].join("; ");
}

function buildFallbackStopCommand(root) {
  const escapedRootRegex = String(root || "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''");
  return [
    `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe' -or $_.Name -eq 'powershell.exe') -and $_.CommandLine -match '${escapedRootRegex}' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }`,
  ].join("; ");
}

function runDetachedWindowsPowerShell(commandText, cwd) {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", commandText],
    {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    }
  );
  child.unref();
}

app.post("/api/server/services/start", requireAreaEdit("server"), async (_req, res) => {
  try {
    if (process.platform !== "win32") {
      res.status(400).json({ error: "Service control currently supports Windows installs only." });
      return;
    }
    if (serviceControlLocked) {
      res.status(409).json({ error: "Another service action is already running." });
      return;
    }
    serviceControlLocked = true;
    const launchers = resolveServiceLauncherPaths();
    const startCmdExists = fs.existsSync(launchers.startCmd);
    const cmdText = startCmdExists
      ? `& ${toPsSingleQuoted(launchers.startCmd)}`
      : buildFallbackStartCommand(launchers.root);
    runDetachedWindowsPowerShell(cmdText, launchers.root);
    setTimeout(() => {
      serviceControlLocked = false;
    }, 3000);

    res.json({
      ok: true,
      action: "start",
      message: "Start requested for all Mesora services.",
      root: launchers.root,
      mode: startCmdExists ? "launcher" : "fallback",
    });
  } catch (err) {
    serviceControlLocked = false;
    res.status(500).json({ error: err?.message || "Failed to start services." });
  }
});

app.post("/api/server/services/stop", requireAreaEdit("server"), async (_req, res) => {
  try {
    if (process.platform !== "win32") {
      res.status(400).json({ error: "Service control currently supports Windows installs only." });
      return;
    }
    if (serviceControlLocked) {
      res.status(409).json({ error: "Another service action is already running." });
      return;
    }
    serviceControlLocked = true;
    const launchers = resolveServiceLauncherPaths();
    const stopCmdExists = fs.existsSync(launchers.stopCmd);
    const cmdText = stopCmdExists
      ? `Start-Sleep -Milliseconds 750; & ${toPsSingleQuoted(launchers.stopCmd)}`
      : `Start-Sleep -Milliseconds 750; ${buildFallbackStopCommand(launchers.root)}`;
    runDetachedWindowsPowerShell(cmdText, launchers.root);
    setTimeout(() => {
      serviceControlLocked = false;
    }, 3000);

    res.json({
      ok: true,
      action: "stop",
      message: "Stop requested for all Mesora services.",
      root: launchers.root,
      mode: stopCmdExists ? "launcher" : "fallback",
    });
  } catch (err) {
    serviceControlLocked = false;
    res.status(500).json({ error: err?.message || "Failed to stop services." });
  }
});

app.post("/api/server/services/restart", requireAreaEdit("server"), async (_req, res) => {
  try {
    if (process.platform !== "win32") {
      res.status(400).json({ error: "Service control currently supports Windows installs only." });
      return;
    }
    if (serviceControlLocked) {
      res.status(409).json({ error: "Another service action is already running." });
      return;
    }
    serviceControlLocked = true;
    const launchers = resolveServiceLauncherPaths();
    const stopCmdExists = fs.existsSync(launchers.stopCmd);
    const startCmdExists = fs.existsSync(launchers.startCmd);
    const stopCmd = stopCmdExists
      ? `& ${toPsSingleQuoted(launchers.stopCmd)}`
      : buildFallbackStopCommand(launchers.root);
    const startCmd = startCmdExists
      ? `& ${toPsSingleQuoted(launchers.startCmd)}`
      : buildFallbackStartCommand(launchers.root);
    const cmdText = `Start-Sleep -Milliseconds 750; ${stopCmd}; Start-Sleep -Seconds 1; ${startCmd}`;
    runDetachedWindowsPowerShell(cmdText, launchers.root);
    setTimeout(() => {
      serviceControlLocked = false;
    }, 4500);

    res.json({
      ok: true,
      action: "restart",
      message: "Restart requested for all Mesora services.",
      root: launchers.root,
      mode: stopCmdExists && startCmdExists ? "launcher" : "fallback",
    });
  } catch (err) {
    serviceControlLocked = false;
    res.status(500).json({ error: err?.message || "Failed to restart services." });
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
      SELECT DISTINCT table_name
      FROM information_schema.tables
      WHERE table_schema = ANY(current_schemas(false))
        AND table_type = 'BASE TABLE'
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

app.put("/api/db/designer/foreign-key", async (req, res) => {
  try {
    const oldFromTable = normalizeDbIdentifier(req.body?.oldFromTable, "old source table");
    const oldConstraintName = normalizeDbIdentifier(req.body?.oldConstraintName, "old constraint name");
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
    await pool.query(
      `ALTER TABLE ${safeIdent(oldFromTable)} DROP CONSTRAINT IF EXISTS ${safeIdent(oldConstraintName)}`
    );
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
    res.status(500).json({ error: err?.message || "Failed to update foreign key." });
  }
});

app.delete("/api/db/designer/foreign-key", async (req, res) => {
  try {
    const fromTable = normalizeDbIdentifier(req.body?.fromTable, "source table");
    const constraintName = normalizeDbIdentifier(req.body?.constraintName, "constraint name");
    await pool.query(
      `ALTER TABLE ${safeIdent(fromTable)} DROP CONSTRAINT IF EXISTS ${safeIdent(constraintName)}`
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to delete foreign key." });
  }
});

app.get("/api/db/:table/meta", async (req, res) => {
  try {
    const table = normalizeLegacyTableName(req.params.table);
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
      const table = normalizeLegacyTableName(req.params.table);
      if (!/^[a-zA-Z0-9_]+$/.test(table)) {
        res.status(400).json({ error: "Invalid table name." });
        return;
      }
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const pk = await getPrimaryKey(table);
      const order =
        table === "automation_rule"
          ? "ORDER BY updated_at DESC, id DESC"
          : pk
            ? `ORDER BY ${safeIdent(pk)}`
            : "";
      const projectId =
        table === "route" && req.query.project_id ? String(req.query.project_id) : "";
      const where = projectId ? "WHERE project_id = $3" : "";
      const sql = `SELECT * FROM ${safeIdent(table)} ${where} ${order} LIMIT $1 OFFSET $2`;
      const params = projectId ? [limit, offset, projectId] : [limit, offset];
      const { rows } = await pool.query(sql, params);
      if (DEBUG_ROUTES && table === "route") {
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
    const table = normalizeLegacyTableName(req.params.table);
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
    const table = normalizeLegacyTableName(req.params.table);
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
    const table = normalizeLegacyTableName(req.params.table);
    const body = { ...(req.body || {}) };
    if (!/^[a-zA-Z0-9_]+$/.test(table)) {
      res.status(400).json({ error: "Invalid table name." });
      return;
    }
    // Coerce nullable product foreign keys for formula tables to avoid hard FK failures on stale IDs.
    if (
      (table === "formula_header" && Object.prototype.hasOwnProperty.call(body, "finished_product_id")) ||
      (table === "formula_bom" && Object.prototype.hasOwnProperty.call(body, "ingredient_index"))
    ) {
      const field = table === "formula_header" ? "finished_product_id" : "ingredient_index";
      const raw = body[field];
      if (raw == null || String(raw).trim() === "") {
        body[field] = null;
      } else {
        const text = String(raw).trim();
        if (!/^\d+$/.test(text)) {
          body[field] = null;
        } else {
          const productId = Number(text);
          const { rows: productRows } = await pool.query(
            `SELECT 1 FROM product WHERE id = $1 LIMIT 1`,
            [productId]
          );
          body[field] = productRows.length ? productId : null;
        }
      }
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
    if (table === "automation_rule") invalidateAutomationRuleCache();
    res.json({ row: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Insert failed." });
  }
});

app.put("/api/db/:table/:id", async (req, res) => {
  try {
    const table = normalizeLegacyTableName(req.params.table);
    const id = req.params.id;
    const body = { ...(req.body || {}) };
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
    // Coerce nullable product foreign keys for formula tables to avoid hard FK failures on stale IDs.
    if (
      (table === "formula_header" && Object.prototype.hasOwnProperty.call(body, "finished_product_id")) ||
      (table === "formula_bom" && Object.prototype.hasOwnProperty.call(body, "ingredient_index"))
    ) {
      const field = table === "formula_header" ? "finished_product_id" : "ingredient_index";
      const raw = body[field];
      if (raw == null || String(raw).trim() === "") {
        body[field] = null;
      } else {
        const text = String(raw).trim();
        if (!/^\d+$/.test(text)) {
          body[field] = null;
        } else {
          const productId = Number(text);
          const { rows: productRows } = await pool.query(
            `SELECT 1 FROM product WHERE id = $1 LIMIT 1`,
            [productId]
          );
          body[field] = productRows.length ? productId : null;
        }
      }
    }
    // Normalize/validate bin.product_id so FK failures become clear user errors.
    if (table === "bin" && Object.prototype.hasOwnProperty.call(body, "product_id")) {
      const raw = body.product_id;
      if (raw == null || String(raw).trim() === "") {
        body.product_id = null;
      } else {
        const text = String(raw).trim();
        if (!/^\d+$/.test(text)) {
          res.status(400).json({ error: "Invalid product_id. Expected numeric id or null." });
          return;
        }
        const productId = Number(text);
        const candidateTables = ["product"];
        let productExists = false;
        for (const candidateRaw of candidateTables) {
          const candidate = String(candidateRaw || "").trim();
          if (!candidate || !/^[a-zA-Z0-9_]+$/.test(candidate)) continue;
          const tableExists = await pool.query(
            `
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
            LIMIT 1
            `,
            [candidate]
          );
          if (!tableExists.rows.length) continue;
          const candidatePk = (await getPrimaryKey(candidate)) || "id";
          if (!/^[a-zA-Z0-9_]+$/.test(candidatePk)) continue;
          const pkColumnExists = await pool.query(
            `
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
            LIMIT 1
            `,
            [candidate, candidatePk]
          );
          if (!pkColumnExists.rows.length) continue;
          const { rows: productRows } = await pool.query(
            `SELECT 1 FROM ${safeIdent(candidate)} WHERE ${safeIdent(candidatePk)} = $1 LIMIT 1`,
            [productId]
          );
          if (productRows.length) {
            productExists = true;
            break;
          }
        }
        if (!productExists) {
          res.status(400).json({ error: `Product id ${productId} does not exist.` });
          return;
        }
        body.product_id = productId;
      }
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
    if (table === "automation_rule") invalidateAutomationRuleCache();
    res.json({ row: rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Update failed." });
  }
});

app.delete("/api/db/:table/:id", async (req, res) => {
  try {
    const table = normalizeLegacyTableName(req.params.table);
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
    if (table === "automation_rule") invalidateAutomationRuleCache();
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
    const guard = await loadReportSqlGuardSettings();
    enforceReportRateLimit(userId, guard);
    const releaseSlot = acquireReportQuerySlot(guard);
    let resultPayload = null;
    try {
      resultPayload = await runReadOnlyQueryWithGuards(sql, values, guard);
    } finally {
      releaseSlot();
    }
    const { result, maxRows, timeoutMs, truncated } = resultPayload;
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
      truncated,
      maxRows,
      timeoutMs,
      summaryRow,
    });
  } catch (err) {
    if (Number(err?.statusCode) === 429) {
      res.status(429).json({ error: String(err?.message || "Too many report queries.") });
      return;
    }
    if (isStatementTimeoutError(err)) {
      const timeoutMs = Number(err?.viziTimeoutMs) || REPORT_QUERY_TIMEOUT_MS;
      res.status(408).json({
        error: `Query timed out after ${timeoutMs}ms. Narrow filters or simplify the query.`,
      });
      return;
    }
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
    const data = await executeReportPreviewInternal(req.body || {}, { userId });
    res.json(data);
  } catch (err) {
    if (Number(err?.statusCode) === 429) {
      res.status(429).json({ error: String(err?.message || "Too many report queries.") });
      return;
    }
    if (isStatementTimeoutError(err)) {
      const timeoutMs = Number(err?.viziTimeoutMs) || REPORT_QUERY_TIMEOUT_MS;
      res.status(408).json({
        error: `Query timed out after ${timeoutMs}ms. Narrow filters or simplify the query.`,
      });
      return;
    }
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
      const runtime = getActiveAiRuntime();
      if (runtime.ollamaNativeBaseUrl) {
        markOllamaModelUsed(runtime, runtime.model);
        const resp = await fetch(`${runtime.ollamaNativeBaseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: runtime.model,
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
      const response = await runtime.client.responses.create({
        model: runtime.model,
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
    let mode = ["ddl", "query", "report", "answer"].includes(modeRaw) ? modeRaw : "answer";
    let sqlText = String(json.sql || "").trim();
    const summaryText = String(json.summary || "").trim();
    const reportName = String(json.report_name || "").trim();
    const promptText = String(prompt || "").trim();
    const ddlIntentFromPrompt = /\b(create|alter|drop|truncate)\b/i.test(promptText) && /\btable\b/i.test(promptText);
    const ddlSqlDetected = /^(create|alter|drop|truncate)\s+/i.test(sqlText);
    if (mode !== "ddl" && (ddlIntentFromPrompt || ddlSqlDetected)) {
      mode = "ddl";
    }

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
      let result = null;
      try {
        result = await pool.query(safeQuery, safeValues);
      } catch (queryErr) {
        const code = String(queryErr?.code || "").trim();
        const msg = String(queryErr?.message || "").trim();
        if (code === "42P01" || /relation .* does not exist/i.test(msg)) {
          const looksLikeCreateIntent =
            ddlIntentFromPrompt ||
            /\bcreate\s+table\b/i.test(promptText) ||
            /\bcreate\s+table\b/i.test(String(sqlText || ""));
          const hint = looksLikeCreateIntent
            ? "The table does not exist yet. Use mode=ddl SQL and click Apply to create it first."
            : "The generated query references a relation that does not exist.";
          res.status(400).json({
            error: `${hint} PostgreSQL: ${msg || "relation does not exist"}`,
            mode: "answer",
            sql: safeQuery,
            summary: "No rows returned because relation is missing.",
          });
          return;
        }
        throw queryErr;
      }
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
    const runtime = getActiveAiRuntime();
    if (!runtime.ollamaNativeBaseUrl) {
      res.json({ ok: false, released: false, message: "Ollama native endpoint is not configured." });
      return;
    }
    const released = await unloadOllamaModelIfIdle(runtime, true);
    res.json({
      ok: true,
      released,
      model: String(ollamaLastModel || runtime.model || OPENAI_MODEL || ""),
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

    let session = requestedId ? await getPlcDebugSession(requestedId) : null;
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
    await upsertPlcDebugSessionInStore(session).catch(() => {});
    res.json({ ok: true, session: serializePlcDebugSession(session) });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to create PLC debug session." });
  }
});

app.get("/api/ai/plc-debug-sessions/:id", async (req, res) => {
  try {
    const session = await getPlcDebugSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Debug session not found." });
      return;
    }
    const now = Date.now();
    if (now - Number(session.lastRefreshAt || 0) >= Number(session.pollMs || PLC_DEBUG_SESSION_POLL_MS)) {
      session.lastRefreshAt = now;
      await refreshPlcDebugSession(session);
    }
    await upsertPlcDebugSessionInStore(session).catch(() => {});
    res.json({ ok: true, session: serializePlcDebugSession(session) });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load PLC debug session." });
  }
});

app.post("/api/ai/plc-debug-sessions/:id/watch", async (req, res) => {
  try {
    const session = await getPlcDebugSession(req.params.id);
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
    await upsertPlcDebugSessionInStore(session).catch(() => {});
    res.json({ ok: true, session: serializePlcDebugSession(session) });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to update debug watch list." });
  }
});

app.delete("/api/ai/plc-debug-sessions/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(404).json({ error: "Debug session not found." });
      return;
    }
    plcDebugSessions.delete(id);
    await deletePlcDebugSessionFromStore(id).catch(() => {});
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
    const motorDiag = await maybeDiagnoseMotorFromPlcInsightsContext({
      prompt,
      rawSample,
      controllerTags,
      debugSnapshot,
    });

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
      motorDiag?.requested && String(motorDiag?.context || "").trim()
        ? `Motor diagnostic precheck:\n${String(motorDiag.context).trim()}`
        : "Motor diagnostic precheck: not requested.",
      formatPlcDebugContext(debugSnapshot),
    ].join("\n\n");
    const flourMillKnowledge = getFlourMillKnowledge();

    const system = [
      "You are a PLC analysis assistant focused on Rockwell/Studio5000 L5X exports.",
      "You are also a flour-mill process assistant and should answer with flour-milling domain best practices when relevant.",
      "Use only the provided PLC context and conversation.",
      "Do not invent tags, routines, or modules that are not in context.",
      "If data is missing, say exactly what is missing.",
      "Give concise, actionable answers for controls engineers.",
      "Treat active OPC connections as real-time environment context when suggesting mapping/connection steps.",
      "When asked about OPC setup, provide practical configuration steps using available controller tags.",
    ].join(" ");

    const input = [
      { role: "system", content: system },
      ...(flourMillKnowledge
        ? [
            {
              role: "system",
              content: `Flour Mill Domain Knowledge:\n${flourMillKnowledge}`,
            },
          ]
        : []),
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
        "Configure an active AI agent in AI Config to enable full PLC AI responses.",
      ].join("\n\n");
    }

    async function getModelText(promptInput) {
      const runtime = getActiveAiRuntime();
      if (runtime.ollamaNativeBaseUrl) {
        markOllamaModelUsed(runtime, runtime.model);
        const resp = await fetch(`${runtime.ollamaNativeBaseUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: runtime.model,
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
      const response = await runtime.client.responses.create({
        model: runtime.model,
        input: promptInput,
        max_output_tokens: 700,
      });
      return response.output_text || "";
    }

    const runtime = getActiveAiRuntime();
    const hasAiProvider = runtime.hasProvider;
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
      const fallback = buildLocalFallbackAnswer();
      const answer = motorDiag?.requested && String(motorDiag?.summary || "").trim()
        ? `${String(motorDiag.summary).trim()}\n\n${fallback}`
        : fallback;
      res.json({ answer, opcPlan, debugSessionId });
      return;
    }

    let answer = "";
    try {
      answer = String(await getModelText(input)).trim();
    } catch {
      answer = buildLocalFallbackAnswer();
    }
    if (motorDiag?.requested && String(motorDiag?.summary || "").trim()) {
      answer = `${String(motorDiag.summary).trim()}\n\n${answer}`.trim();
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

app.get("/api/ai/code-gen-pro/:plcKey", async (req, res) => {
  try {
    const plcKey = String(req.params?.plcKey || "").trim();
    if (!plcKey) {
      res.status(400).json({ error: "Missing plcKey." });
      return;
    }
    const { rows } = await pool.query(
      `
      SELECT plc_key, profile, updated_at
      FROM plc_code_gen_profile
      WHERE plc_key = $1
      LIMIT 1
      `,
      [plcKey]
    );
    if (!rows.length) {
      res.json({ profile: null });
      return;
    }
    const row = rows[0] || {};
    res.json({
      profile: row?.profile && typeof row.profile === "object" ? row.profile : null,
      updatedAt: row?.updated_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load Code Gen profile." });
  }
});

app.put("/api/ai/code-gen-pro/:plcKey", async (req, res) => {
  try {
    const plcKey = String(req.params?.plcKey || "").trim();
    if (!plcKey) {
      res.status(400).json({ error: "Missing plcKey." });
      return;
    }
    const profileRaw = req.body?.profile;
    if (!profileRaw || typeof profileRaw !== "object" || Array.isArray(profileRaw)) {
      res.status(400).json({ error: "Invalid profile payload." });
      return;
    }
    const profile = profileRaw;
    const { rows } = await pool.query(
      `
      INSERT INTO plc_code_gen_profile (plc_key, profile, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (plc_key) DO UPDATE
      SET profile = EXCLUDED.profile,
          updated_at = now()
      RETURNING plc_key, updated_at
      `,
      [plcKey, JSON.stringify(profile)]
    );
    const row = rows[0] || {};
    res.json({ ok: true, plcKey: row?.plc_key || plcKey, updatedAt: row?.updated_at || null });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save Code Gen profile." });
  }
});

app.get("/api/ai/route-template/:templateKey", async (req, res) => {
  try {
    const templateKey = String(req.params?.templateKey || "").trim().toLowerCase();
    if (!templateKey) {
      res.status(400).json({ error: "Missing templateKey." });
      return;
    }
    const { rows } = await pool.query(
      `
      SELECT template_key, route_name, source_filename, template_text, updated_at
      FROM route_l5x_template
      WHERE template_key = $1
      LIMIT 1
      `,
      [templateKey]
    );
    if (!rows.length) {
      res.json({ template: null });
      return;
    }
    const row = rows[0] || {};
    res.json({
      template: {
        templateKey: row?.template_key || templateKey,
        routeName: row?.route_name || "",
        sourceFileName: row?.source_filename || "",
        templateText: row?.template_text || "",
      },
      updatedAt: row?.updated_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load route template." });
  }
});

app.put("/api/ai/route-template/:templateKey", async (req, res) => {
  try {
    const templateKey = String(req.params?.templateKey || "").trim().toLowerCase();
    if (!templateKey) {
      res.status(400).json({ error: "Missing templateKey." });
      return;
    }
    const routeName = String(req.body?.routeName || "").trim();
    const sourceFileName = String(req.body?.sourceFileName || "").trim();
    const templateText = String(req.body?.templateText || "");
    if (!routeName) {
      res.status(400).json({ error: "Missing routeName." });
      return;
    }
    if (!templateText.trim()) {
      res.status(400).json({ error: "Missing templateText." });
      return;
    }
    // Persist the full uploaded/template L5X text so UDTs/AOIs remain available
    // without requiring the source upload again.
    const normalizedTemplateText = templateText;
    const { rows } = await pool.query(
      `
      INSERT INTO route_l5x_template (template_key, route_name, source_filename, template_text, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (template_key) DO UPDATE
      SET route_name = EXCLUDED.route_name,
          source_filename = EXCLUDED.source_filename,
          template_text = EXCLUDED.template_text,
          updated_at = now()
      RETURNING template_key, updated_at
      `,
      [templateKey, routeName, sourceFileName, normalizedTemplateText]
    );
    const row = rows[0] || {};
    res.json({ ok: true, templateKey: row?.template_key || templateKey, updatedAt: row?.updated_at || null });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save route template." });
  }
});

app.get("/api/ai/routine-templates/:plcKey", async (req, res) => {
  try {
    const plcKey = String(req.params?.plcKey || "").trim();
    if (!plcKey) {
      res.status(400).json({ error: "Missing plcKey." });
      return;
    }
    const { rows } = await pool.query(
      `
      SELECT plc_key, routine_key, routine_name, source_filename, routine_xml, updated_at
      FROM plc_l5x_routine_template
      WHERE plc_key = $1
      ORDER BY routine_key ASC
      `,
      [plcKey]
    );
    const templates = rows.map((row) => ({
      plcKey: row?.plc_key || plcKey,
      routineKey: row?.routine_key || "",
      routineName: row?.routine_name || "",
      sourceFileName: row?.source_filename || "",
      routineXml: row?.routine_xml || "",
      updatedAt: row?.updated_at || null,
    }));
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load routine templates." });
  }
});

app.get("/api/ai/routine-template/:plcKey/:routineName", async (req, res) => {
  try {
    const plcKey = String(req.params?.plcKey || "").trim();
    const routineName = String(req.params?.routineName || "").trim();
    const routineKey = routineName.toLowerCase();
    if (!plcKey) {
      res.status(400).json({ error: "Missing plcKey." });
      return;
    }
    if (!routineName) {
      res.status(400).json({ error: "Missing routineName." });
      return;
    }
    const { rows } = await pool.query(
      `
      SELECT plc_key, routine_key, routine_name, source_filename, routine_xml, updated_at
      FROM plc_l5x_routine_template
      WHERE plc_key = $1 AND routine_key = $2
      LIMIT 1
      `,
      [plcKey, routineKey]
    );
    if (!rows.length) {
      res.json({ template: null });
      return;
    }
    const row = rows[0] || {};
    res.json({
      template: {
        plcKey: row?.plc_key || plcKey,
        routineKey: row?.routine_key || routineKey,
        routineName: row?.routine_name || routineName,
        sourceFileName: row?.source_filename || "",
        routineXml: row?.routine_xml || "",
      },
      updatedAt: row?.updated_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to load routine template." });
  }
});

app.put("/api/ai/routine-template/:plcKey/:routineName", async (req, res) => {
  try {
    const plcKey = String(req.params?.plcKey || "").trim();
    const routeRoutineName = String(req.params?.routineName || "").trim();
    const bodyRoutineName = String(req.body?.routineName || "").trim();
    const routineName = bodyRoutineName || routeRoutineName;
    const routineKey = routineName.toLowerCase();
    const sourceFileName = String(req.body?.sourceFileName || "").trim();
    const routineXml = String(req.body?.routineXml || "");
    if (!plcKey) {
      res.status(400).json({ error: "Missing plcKey." });
      return;
    }
    if (!routineName) {
      res.status(400).json({ error: "Missing routineName." });
      return;
    }
    if (!routineXml.trim()) {
      res.status(400).json({ error: "Missing routineXml." });
      return;
    }
    const { rows } = await pool.query(
      `
      INSERT INTO plc_l5x_routine_template (plc_key, routine_key, routine_name, source_filename, routine_xml, updated_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (plc_key, routine_key) DO UPDATE
      SET routine_name = EXCLUDED.routine_name,
          source_filename = EXCLUDED.source_filename,
          routine_xml = EXCLUDED.routine_xml,
          updated_at = now()
      RETURNING plc_key, routine_key, routine_name, updated_at
      `,
      [plcKey, routineKey, routineName, sourceFileName, routineXml]
    );
    const row = rows[0] || {};
    res.json({
      ok: true,
      plcKey: row?.plc_key || plcKey,
      routineKey: row?.routine_key || routineKey,
      routineName: row?.routine_name || routineName,
      updatedAt: row?.updated_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to save routine template." });
  }
});

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
    const runtime = getActiveAiRuntime();
    const hasAiProvider = runtime.hasProvider;

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
        if (runtime.ollamaNativeBaseUrl) {
          markOllamaModelUsed(runtime, runtime.model);
          const resp = await fetch(`${runtime.ollamaNativeBaseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: runtime.model,
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
          const response = await runtime.client.responses.create({
            model: runtime.model,
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
  if (DB_CLIENT !== "postgres") {
    throw new Error(
      "DB_CLIENT=sqlserver is scaffolded in phase 1 config only. Runtime SQL execution remains postgres until phase 2 adapter/query parity is implemented."
    );
  }
  await ensureDatabaseExists();
  if (TREND_DATABASE_URL_IS_DERIVED) {
    TREND_DATABASE_URL = deriveTrendDatabaseUrl(DATABASE_URL);
  }
  if (LOG_DATABASE_URL_IS_DERIVED) {
    LOG_DATABASE_URL = deriveLogDatabaseUrl(DATABASE_URL);
  }
  if (!TREND_DATABASE_URL) TREND_DATABASE_URL = DATABASE_URL;
  if (!LOG_DATABASE_URL) LOG_DATABASE_URL = DATABASE_URL;
  process.env.TREND_DATABASE_URL = TREND_DATABASE_URL;
  process.env.TREND_DB_POOL_MAX = String(TREND_DB_POOL_MAX);
  process.env.LOG_DATABASE_URL = LOG_DATABASE_URL;
  process.env.LOG_DB_POOL_MAX = String(LOG_DB_POOL_MAX);
  await ensureDatabaseExists(TREND_DATABASE_URL);
  await ensureDatabaseExists(LOG_DATABASE_URL);
  pool = new Pool({ connectionString: DATABASE_URL, max: DB_POOL_MAX });
  if (typeof pool.setMaxListeners === "function") {
    pool.setMaxListeners(DB_POOL_MAX_LISTENERS);
  }
  if (String(TREND_DATABASE_URL || "").trim() === String(DATABASE_URL || "").trim()) {
    trendPool = pool;
  } else {
    trendPool = new Pool({
      connectionString: TREND_DATABASE_URL,
      max: TREND_DB_POOL_MAX,
    });
    if (typeof trendPool.setMaxListeners === "function") {
      trendPool.setMaxListeners(DB_POOL_MAX_LISTENERS);
    }
    await trendPool.query("SELECT 1");
  }
  if (String(LOG_DATABASE_URL || "").trim() === String(DATABASE_URL || "").trim()) {
    logPool = pool;
  } else if (String(LOG_DATABASE_URL || "").trim() === String(TREND_DATABASE_URL || "").trim()) {
    logPool = trendPool;
  } else {
    logPool = new Pool({
      connectionString: LOG_DATABASE_URL,
      max: LOG_DB_POOL_MAX,
    });
    if (typeof logPool.setMaxListeners === "function") {
      logPool.setMaxListeners(DB_POOL_MAX_LISTENERS);
    }
    await logPool.query("SELECT 1");
  }
  await ensureSystemVersionState();
  await ensureDesignerTablesFromSchema(pool);
  await ensureAppSchema({ pool, createPasswordHash, defaultRolePermissionRows, applyPrimaryKeyState });
  if (logPool) {
    await ensureServerLogSchema(logPool);
  }
  const trendDb = trendPool || pool;
  if (trendDb) {
    await ensureTrendChunkTable(trendDb, getTrendChunkTableNameForTimestamp(Date.now()));
    await listTrendChunkTables(trendDb, { refresh: true, includeLegacy: true });
  }
  dbBackupState = await loadDbBackupConfigFromStore();
  ensureDirectoryExists(DB_BACKUP_DIR);
  scheduleDatabaseBackups();
  await verifySchemaCoverage();
  setTimeout(() => {
    void runProjectVersionMaintenance();
  }, 5000);
  setTimeout(() => {
    void runDatabaseMaintenance();
  }, 7000);
  setInterval(() => {
    void runProjectVersionMaintenance();
  }, PROJECT_VERSION_MAINTENANCE_MS);
  setInterval(() => {
    void runDatabaseMaintenance();
  }, DB_MAINTENANCE_MS);
  setInterval(() => {
    void runAutomationRulesForDbTriggers();
  }, AUTOMATION_DB_POLL_MS);
  setInterval(() => {
    void deleteExpiredPlcDebugSessionsFromStore(PLC_DEBUG_SESSION_TTL_MS);
  }, Math.max(60_000, Math.floor(PLC_DEBUG_SESSION_POLL_MS * 10)));
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`App server listening on http://localhost:${PORT}`);
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

