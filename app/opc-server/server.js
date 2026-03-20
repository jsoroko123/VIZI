import fs from "fs";
import http from "http";
import path from "path";
import process from "process";
import { connect as mqttConnect } from "mqtt";
import {
  OPCUAServer,
  Variant,
  DataType,
  StatusCodes,
  MessageSecurityMode,
  SecurityPolicy,
} from "node-opcua";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const PLC = require("node-logix").default;

const AI_SERVER_URL = process.env.AI_SERVER_URL || "http://localhost:5055";
const OPC_SERVER_KEY = process.env.OPC_SERVER_KEY || "";
const OPC_WRITE_BRIDGE_PORT = Math.max(1, Number.parseInt(String(process.env.OPC_WRITE_BRIDGE_PORT || "4851"), 10) || 4851);
const RESTART_PATH = path.resolve(process.cwd(), "restart.requested");
const OPCUA_ALLOW_ANONYMOUS = String(process.env.OPCUA_ALLOW_ANONYMOUS || "").trim().toLowerCase() === "true";
const OPCUA_USERNAME = String(process.env.OPCUA_USERNAME || "").trim();
const OPCUA_PASSWORD = String(process.env.OPCUA_PASSWORD || "");
const OPCUA_SECURITY_MODES_RAW = String(process.env.OPCUA_SECURITY_MODES || "SignAndEncrypt,Sign").trim();
const OPCUA_SECURITY_POLICIES_RAW = String(
  process.env.OPCUA_SECURITY_POLICIES || "Basic256Sha256,Basic256,Basic128Rsa15"
).trim();

function parseEnumList(raw, enumObj, fallback = []) {
  const src = String(raw || "").trim();
  const items = src
    ? src
        .split(",")
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    : [];
  const out = [];
  items.forEach((name) => {
    const value = enumObj?.[name];
    if (value != null) out.push(value);
  });
  if (out.length) return out;
  return Array.isArray(fallback) ? fallback : [];
}

async function loadConfig() {
  const localConfigPath = path.resolve(process.cwd(), "config.json");
  const localConfigExamplePath = path.resolve(process.cwd(), "config.example.json");
  const fallbackPath = fs.existsSync(localConfigPath)
    ? localConfigPath
    : fs.existsSync(localConfigExamplePath)
    ? localConfigExamplePath
    : null;
  let parsedFallbackConfig = null;
  if (fallbackPath) {
    try {
      parsedFallbackConfig = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `Failed to parse local OPC config at ${fallbackPath}: ${err?.message || "unknown error"}`
      );
    }
  }
  const maxAttempts = Math.max(
    1,
    Number.parseInt(String(process.env.OPC_CONFIG_FETCH_MAX_ATTEMPTS || "30"), 10) || 30
  );
  const retryBaseMs = Math.max(
    250,
    Number.parseInt(String(process.env.OPC_CONFIG_FETCH_RETRY_MS || "2000"), 10) || 2000
  );
  const headers = OPC_SERVER_KEY ? { "x-opc-key": OPC_SERVER_KEY } : undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(`${AI_SERVER_URL.replace(/\/$/, "")}/api/opc/config`, { headers });
      if (res.ok) {
        return await res.json();
      }
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || `Failed to load config (status ${res.status}).`);
    } catch (err) {
      const message = `Failed to load OPC config from database (${AI_SERVER_URL}): ${err?.message || err}`;
      if (parsedFallbackConfig) {
        // eslint-disable-next-line no-console
        console.warn(
          `Using local OPC config from ${fallbackPath} because AI config endpoint is unavailable: ${err?.message || err}`
        );
        return parsedFallbackConfig;
      }
      if (attempt >= maxAttempts) {
        // eslint-disable-next-line no-console
        console.error(`${message}. Giving up after ${attempt} attempts.`);
        process.exit(1);
      }
      const delayMs = Math.min(15000, retryBaseMs * Math.min(8, attempt));
      // eslint-disable-next-line no-console
      console.warn(`${message}. Retry ${attempt}/${maxAttempts} in ${Math.round(delayMs / 1000)}s.`);
      await sleep(delayMs);
    }
  }
  process.exit(1);
}

function plcTypeToUa(plcType) {
  switch (String(plcType || "").toUpperCase()) {
    case "BOOL":
      return DataType.Boolean;
    case "SINT":
      return DataType.SByte;
    case "INT":
      return DataType.Int16;
    case "DINT":
      return DataType.Int32;
    case "LINT":
      return DataType.Int64;
    case "USINT":
      return DataType.Byte;
    case "UINT":
      return DataType.UInt16;
    case "UDINT":
      return DataType.UInt32;
    case "REAL":
      return DataType.Float;
    case "LREAL":
      return DataType.Double;
    case "STRING":
      return DataType.String;
    default:
      return DataType.String;
  }
}

function parsePositiveMs(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(100, Math.round(n));
}

function clampMinMs(value, minMs, fallback = null) {
  const parsed = parsePositiveMs(value, fallback);
  if (!Number.isFinite(Number(parsed)) || !Number.isFinite(Number(minMs))) return parsed;
  return Math.max(Math.round(Number(minMs)), Math.round(Number(parsed)));
}

function parsePositiveNumber(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function parseNonNegativeNumber(value, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function normalizeTopicString(value, fallback = "") {
  const raw = String(value || fallback || "").trim();
  return raw.replace(/^\/+|\/+$/g, "");
}

function isNumericLiveValue(value) {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return false;
    const n = Number(s);
    return Number.isFinite(n);
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

async function main() {
  const config = await loadConfig();
  const runtime = config?.runtime || {};
  let opcConnectionEnabled = runtime?.opcConnectionEnabled !== false;
  // Multi-read bundles N tags into a single CIP request â€” dramatically faster for large tag counts.
  // Default OFF â€” some PLCs drop CIP sessions under multi-read load. Enable via runtime.multiReadEnabled=true.
  const multiReadConfigured = runtime?.multiReadEnabled === true;
  let multiReadEnabled = multiReadConfigured;
  const multiReadBatchSizeRaw = Number.parseInt(String(runtime?.multiReadBatchSize ?? "20"), 10);
  let multiReadBatchSize = Number.isFinite(multiReadBatchSizeRaw)
    ? Math.max(1, Math.min(50, multiReadBatchSizeRaw))
    : 20;
  const multiReadFallbackStreakRaw = Number.parseInt(
    String(runtime?.multiReadFallbackStreak ?? "3"),
    10
  );
  let multiReadFallbackStreak = Number.isFinite(multiReadFallbackStreakRaw)
    ? Math.max(1, Math.min(20, multiReadFallbackStreakRaw))
    : 3;
  const multiReadFallbackCooldownMs = parsePositiveMs(runtime?.multiReadFallbackCooldownMs, 120000);
  const multiReadFailureWindowMs = parsePositiveMs(runtime?.multiReadFailureWindowMs, 60000);
  let multiReadFailureStreak = 0;
  let multiReadLastFailureAt = 0;
  let multiReadDisabledUntilMs = 0;
  const maxReadsPerTickRaw = Number.parseInt(String(runtime?.maxReadsPerTick ?? "250"), 10);
  let maxReadsPerTick = Number.isFinite(maxReadsPerTickRaw)
    ? Math.max(10, Math.min(5000, maxReadsPerTickRaw))
    : 250;
  // Number of individual reads to run in parallel within a single tick.
  // These are concurrent single-tag reads (not multi-read), so they're safe for PLCs that drop under batch load.
  // Default 6 â€” gives ~6x speedup on initial scan vs sequential. Raise to 8-12 if PLC handles it.
  const readConcurrencyRaw = Number.parseInt(String(runtime?.readConcurrency ?? "8"), 10);
  let readConcurrency = Number.isFinite(readConcurrencyRaw)
    ? Math.max(1, Math.min(32, readConcurrencyRaw))
    : 8;
  // Number of parallel TCP/CIP connections per PLC. Each connection owns an independent tag subset
  // and runs its own poll loop â€” the Ignition/FactoryTalk model for large tag counts (500+ tags).
  // Default 1 (no pooling). Set to 2â€“4 to multiply throughput without stressing one CIP session.
  const plcConnectionPoolSizeRaw = Number.parseInt(String(runtime?.plcConnectionPool ?? "1"), 10);
  const plcConnectionPoolSize = Number.isFinite(plcConnectionPoolSizeRaw)
    ? Math.max(1, Math.min(8, plcConnectionPoolSizeRaw))
    : 1;
  // ControlLogix on LAN typically responds in <50ms; 2500ms gives headroom without 4s waits on drops.
  const readTimeoutMs = clampMinMs(runtime?.readTimeoutMs, 1500, 2500);
  // Default 0 retries â€” retries can stall write-priority commands behind a long PLC read.
  const readRetryCountRaw = Number.parseInt(String(runtime?.readRetryCount ?? "0"), 10);
  let readRetryCount = Number.isFinite(readRetryCountRaw)
    ? Math.max(0, Math.min(5, readRetryCountRaw))
    : 1;
  const multiReadRetryCountRaw = Number.parseInt(String(runtime?.multiReadRetryCount ?? "0"), 10);
  let multiReadRetryCount = Number.isFinite(multiReadRetryCountRaw)
    ? Math.max(0, Math.min(5, multiReadRetryCountRaw))
    : 0;
  const multiReadConcurrencyRaw = Number.parseInt(
    String(runtime?.multiReadConcurrency ?? String(Math.min(readConcurrency, 4))),
    10
  );
  let multiReadConcurrency = Number.isFinite(multiReadConcurrencyRaw)
    ? Math.max(1, Math.min(16, multiReadConcurrencyRaw))
    : Math.min(readConcurrency, 4);
  const initialScanBurstLimitRaw = Number.parseInt(String(runtime?.initialScanBurstLimit ?? "220"), 10);
  let initialScanBurstLimit = Number.isFinite(initialScanBurstLimitRaw)
    ? Math.max(20, Math.min(5000, initialScanBurstLimitRaw))
    : 220;
  const transportBadStreakThresholdRaw = Number.parseInt(
    String(runtime?.transportBadStreakThreshold ?? "2"),
    10
  );
  const transportBadStreakThreshold = Number.isFinite(transportBadStreakThresholdRaw)
    ? Math.max(1, Math.min(10, transportBadStreakThresholdRaw))
    : 2;
  const adaptiveThroughputTuning = runtime?.adaptiveThroughputTuning !== false;
  // Short delay before retry â€” network is either up or down; long delays don't help.
  const readRetryDelayMsRaw = Number.parseInt(String(runtime?.readRetryDelayMs ?? "50"), 10);
  const readRetryDelayMs = Number.isFinite(readRetryDelayMsRaw)
    ? Math.max(0, Math.min(5000, readRetryDelayMsRaw))
    : 50;
  const plcConnectTimeoutMs = clampMinMs(runtime?.plcConnectTimeoutMs, 5000, Math.max(5000, readTimeoutMs * 2));
  const plcReceiveTimeoutMs = clampMinMs(runtime?.plcReceiveTimeoutMs, 15000, Math.max(30000, readTimeoutMs * 6));
  // Use a bounded timeout for connect handshakes so reconnect loops fail fast when PLC is offline.
  const plcConnectReceiveTimeoutMs = clampMinMs(
    runtime?.plcConnectReceiveTimeoutMs,
    5000,
    Math.max(10000, Math.min(plcReceiveTimeoutMs, 45000))
  );
  const errorBackoffEnabled = runtime?.errorBackoffEnabled !== false;
  const errorBackoffBaseMs = parsePositiveMs(runtime?.errorBackoffBaseMs, 500);
  // Cap at 5s so a bad tag retries every 5s max rather than freezing for 15s.
  const errorBackoffMaxMs = parsePositiveMs(runtime?.errorBackoffMaxMs, 5000);
  // Start backoff after 5 consecutive errors â€” give tags more attempts before slowing them down.
  const errorBackoffThreshold = Math.max(1, Math.round(parsePositiveNumber(runtime?.errorBackoffThreshold, 5)));
  const pollJitterMs = Math.max(0, Math.round(parseNonNegativeNumber(runtime?.pollJitterMs, 0) || 0));
  const deadbandDefault = parseNonNegativeNumber(runtime?.deadbandDefault, null);
  const reconnectDelayMs = clampMinMs(runtime?.reconnectDelayMs, 1500, 1500);
  const reconnectMaxAttempts = parsePositiveNumber(runtime?.reconnectMaxAttempts, null);
  const timeoutAutoRestartEnabled = runtime?.timeoutAutoRestartEnabled === true;
  const timeoutAutoRestartStreakRaw = Number.parseInt(
    String(runtime?.timeoutAutoRestartStreak ?? "8"),
    10
  );
  const timeoutAutoRestartStreak = Number.isFinite(timeoutAutoRestartStreakRaw)
    ? Math.max(2, Math.min(100, timeoutAutoRestartStreakRaw))
    : 8;
  const timeoutAutoRestartWindowMs = parsePositiveMs(runtime?.timeoutAutoRestartWindowMs, 180000);
  // Heartbeat: detect stale sessions when the poll loop hasn't run recently.
  // The poll loop skips heartbeat when reads are flowing, so this only fires on true idle/drop.
  const heartbeatEnabled = runtime?.heartbeatEnabled !== false;
  const heartbeatMs = clampMinMs(runtime?.heartbeatMs, 5000, 5000);
  const heartbeatReconnectOnFailure = runtime?.heartbeatReconnectOnFailure !== false;
  const heartbeatFailureThresholdRaw = Number.parseInt(String(runtime?.heartbeatFailureThreshold ?? "3"), 10);
  const heartbeatFailureThreshold = Number.isFinite(heartbeatFailureThresholdRaw)
    ? Math.max(1, Math.min(10, heartbeatFailureThresholdRaw))
    : 3;
  const readReconnectErrorThresholdRaw = Number.parseInt(
    String(runtime?.readReconnectErrorThreshold ?? "5"),
    10
  );
  // Min 3 so a single bad poll tick doesn't immediately trigger a reconnect.
  const readReconnectErrorThreshold = Number.isFinite(readReconnectErrorThresholdRaw)
    ? Math.max(3, Math.min(50, readReconnectErrorThresholdRaw))
    : 5;
  const connectionGuardImmediateOnDisconnect = runtime?.connectionGuardImmediateOnDisconnect !== false;
  const reconnectWarmupMs = parsePositiveMs(runtime?.reconnectWarmupMs, 20000);
  const reconnectWarmupReadsPerTickRaw = Number.parseInt(
    String(runtime?.reconnectWarmupReadsPerTick ?? "80"),
    10
  );
  const reconnectWarmupReadsPerTick = Number.isFinite(reconnectWarmupReadsPerTickRaw)
    ? Math.max(10, Math.min(5000, reconnectWarmupReadsPerTickRaw))
    : 80;
  const reconnectWarmupReadConcurrencyRaw = Number.parseInt(
    String(runtime?.reconnectWarmupReadConcurrency ?? "1"),
    10
  );
  const reconnectWarmupReadConcurrency = Number.isFinite(reconnectWarmupReadConcurrencyRaw)
    ? Math.max(1, Math.min(32, reconnectWarmupReadConcurrencyRaw))
    : 1;
  const reconnectWarmupMultiReadBatchSizeRaw = Number.parseInt(
    String(runtime?.reconnectWarmupMultiReadBatchSize ?? "6"),
    10
  );
  const reconnectWarmupMultiReadBatchSize = Number.isFinite(reconnectWarmupMultiReadBatchSizeRaw)
    ? Math.max(1, Math.min(50, reconnectWarmupMultiReadBatchSizeRaw))
    : 6;
  const reconnectWarmupDisableMultiRead = runtime?.reconnectWarmupDisableMultiRead !== false;
  const connectionGuardEnabled = runtime?.connectionGuardEnabled !== false;
  const connectionGuardFailureStreakRaw = Number.parseInt(
    String(runtime?.connectionGuardFailureStreak ?? "3"),
    10
  );
  const connectionGuardFailureStreak = Number.isFinite(connectionGuardFailureStreakRaw)
    ? Math.max(2, Math.min(50, connectionGuardFailureStreakRaw))
    : 3;
  const connectionGuardWindowMs = parsePositiveMs(runtime?.connectionGuardWindowMs, 120000);
  const connectionGuardCooldownMs = parsePositiveMs(runtime?.connectionGuardCooldownMs, 180000);
  const connectionGuardRecoverAfterMs = parsePositiveMs(runtime?.connectionGuardRecoverAfterMs, 90000);
  const connectionGuardMaxReadsPerTickRaw = Number.parseInt(
    String(runtime?.connectionGuardMaxReadsPerTick ?? "120"),
    10
  );
  const connectionGuardMaxReadsPerTick = Number.isFinite(connectionGuardMaxReadsPerTickRaw)
    ? Math.max(10, Math.min(5000, connectionGuardMaxReadsPerTickRaw))
    : 120;
  const connectionGuardReadConcurrencyRaw = Number.parseInt(
    String(runtime?.connectionGuardReadConcurrency ?? "2"),
    10
  );
  const connectionGuardReadConcurrency = Number.isFinite(connectionGuardReadConcurrencyRaw)
    ? Math.max(1, Math.min(32, connectionGuardReadConcurrencyRaw))
    : 2;
  const connectionGuardMultiReadBatchSizeRaw = Number.parseInt(
    String(runtime?.connectionGuardMultiReadBatchSize ?? "6"),
    10
  );
  const connectionGuardMultiReadBatchSize = Number.isFinite(connectionGuardMultiReadBatchSizeRaw)
    ? Math.max(1, Math.min(50, connectionGuardMultiReadBatchSizeRaw))
    : 6;
  const connectionGuardInitialScanBurstLimitRaw = Number.parseInt(
    String(runtime?.connectionGuardInitialScanBurstLimit ?? "60"),
    10
  );
  const connectionGuardInitialScanBurstLimit = Number.isFinite(connectionGuardInitialScanBurstLimitRaw)
    ? Math.max(20, Math.min(5000, connectionGuardInitialScanBurstLimitRaw))
    : 60;
  const connectionGuardReceiveTimeoutMs = clampMinMs(
    runtime?.connectionGuardReceiveTimeoutMs,
    15000,
    Math.max(plcReceiveTimeoutMs, 20000)
  );
  const mqttEnabled = runtime?.mqttEnabled === true;
  const mqttBrokerUrl = String(runtime?.mqttBrokerUrl || "mqtt://localhost:1883").trim();
  const mqttClientId = String(runtime?.mqttClientId || "").trim();
  const mqttUsername = String(runtime?.mqttUsername || "").trim();
  const mqttPassword = String(runtime?.mqttPassword || "");
  const mqttStatusTopic = normalizeTopicString(runtime?.mqttStatusTopic, "mesora/opc/status");
  const mqttWriteTopic = normalizeTopicString(runtime?.mqttWriteTopic, "mesora/opc/write");
  const mqttQosRaw = Number.parseInt(String(runtime?.mqttQos ?? "0"), 10);
  const mqttQos = Number.isFinite(mqttQosRaw) ? Math.max(0, Math.min(2, mqttQosRaw)) : 0;
  const mqttRetain = runtime?.mqttRetain === true;
  const priorityRefreshMsRaw = Number.parseInt(String(runtime?.priorityRefreshMs ?? "500"), 10);
  const priorityRefreshMs = Number.isFinite(priorityRefreshMsRaw)
    ? Math.max(100, Math.min(30000, priorityRefreshMsRaw))
    : 500;
  const priorityKeyCapRaw = Number.parseInt(String(runtime?.priorityKeyCap ?? "1200"), 10);
  const priorityKeyCap = Number.isFinite(priorityKeyCapRaw)
    ? Math.max(100, Math.min(5000, priorityKeyCapRaw))
    : 1200;
  // VPN mode: disables multi-read (large fragmented CIP packets are the #1 cause of
  // timeout-recv-data disconnects over VPN) and reduces concurrency/burst to keep the
  // connection stable over high-latency / unreliable tunnels.
  const vpnMode = runtime?.vpnMode === true;
  if (vpnMode) {
    multiReadEnabled = false;
    multiReadBatchSize = Math.min(multiReadBatchSize, 4);
    readConcurrency = Math.min(readConcurrency, 2);
    maxReadsPerTick = Math.min(maxReadsPerTick, 60);
    initialScanBurstLimit = Math.min(initialScanBurstLimit, 40);
    console.warn("[opc-server] VPN mode active: multi-read disabled, concurrency reduced for connection stability.");
  }

  const globalPollMs = clampMinMs(config?.pollMs, 100, 500);
  const priorityTagPollMsRaw = Number.parseInt(String(runtime?.priorityTagPollMs ?? ""), 10);
  const priorityTagPollMs = Number.isFinite(priorityTagPollMsRaw)
    ? Math.max(100, Math.min(1000, priorityTagPollMsRaw))
    : Math.max(100, Math.min(globalPollMs, 250));
  const uiScopedReadsEnabled = runtime?.uiScopedReadsEnabled === true;
  const uiScopedReadsStaleMs = clampMinMs(runtime?.uiScopedReadsStaleMs, 5000, 30000);
  const uiScopedReadsHoldMs = Math.max(
    0,
    Math.min(120000, Math.round(parseNonNegativeNumber(runtime?.uiScopedReadsHoldMs, 15000) || 15000))
  );
  const writePriorityEnabled = runtime?.writePriorityEnabled !== false;
  const writeQuietMs = Math.max(
    0,
    Math.min(5000, Math.round(parseNonNegativeNumber(runtime?.writeQuietMs, 250) || 250))
  );
  const plcs = Array.isArray(config?.plcs) && config.plcs.length
    ? config.plcs
        .map((p, idx) => ({
          name: String(p?.name || `PLC-${idx + 1}`),
          host: String(p?.host || ""),
          slot: Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0,
          pollMs: clampMinMs(p?.pollMs, 500, globalPollMs),
        }))
        .filter((p) => p.name && p.host)
    : config?.plc?.host
    ? [
        {
          name: String(config?.plc?.name || "PLC-1"),
          host: String(config?.plc?.host || ""),
          slot: Number.isFinite(Number(config?.plc?.slot)) ? Number(config.plc.slot) : 0,
          pollMs: globalPollMs,
        },
      ]
    : [];

  const topicsRaw = Array.isArray(config?.topics) ? config.topics : [];
  const topics = topicsRaw
    .filter((t) => t?.enabled !== false)
    .map((t, idx) => ({
      name: String(t?.name || `Topic-${idx + 1}`),
      prefix: String(t?.prefix || ""),
      plcName: String(t?.plcName || t?.plc || ""),
      samplingInterval: parsePositiveMs(t?.samplingInterval, null),
    }))
    .filter((t) => t.name);

  const tags = Array.isArray(config?.tags)
    ? config.tags
        .filter((t) => t?.enabled !== false)
        .map((t) => ({
          ...t,
          name: String(t?.name || ""),
          tagPath: String(t?.tagPath || t?.name || ""),
          topic: String(t?.topic || ""),
          pollMs: parsePositiveMs(t?.pollMs, null),
          samplingInterval: clampMinMs(t?.samplingInterval, 500, null),
          deadband: parseNonNegativeNumber(t?.deadband, deadbandDefault),
          muted: t?.muted === true,
        }))
        .filter((t) => t.name)
    : [];

  if (opcConnectionEnabled && !plcs.length) {
    // eslint-disable-next-line no-console
    console.error("Config missing PLC instances.");
    process.exit(1);
  }
  if (!tags.length) {
    // eslint-disable-next-line no-console
    console.warn("Config has no enabled tags yet. Waiting for tags to be added.");
  }

  const defaultPlcName = plcs[0]?.name || "PLC-1";
  const topicsByName = new Map();
  const ensuredTopics = [];
  if (!topics.length) {
    ensuredTopics.push({ name: "Default", prefix: "", plcName: defaultPlcName });
  }
  topics.forEach((t) => {
    const plcName = t.plcName || defaultPlcName;
    const topic = { ...t, plcName };
    ensuredTopics.push(topic);
  });
  ensuredTopics.forEach((t) => {
    topicsByName.set(t.name, t);
  });
  tags.forEach((t) => {
    if (t.topic && topicsByName.has(t.topic)) return;
    const fallbackName = t.topic || "Default";
    if (!topicsByName.has(fallbackName)) {
      const topic = { name: fallbackName, prefix: "", plcName: defaultPlcName };
      topicsByName.set(fallbackName, topic);
      ensuredTopics.push(topic);
    }
  });

  const securityModes = parseEnumList(
    OPCUA_SECURITY_MODES_RAW,
    MessageSecurityMode,
    [MessageSecurityMode.SignAndEncrypt, MessageSecurityMode.Sign]
  );
  const securityPolicies = parseEnumList(
    OPCUA_SECURITY_POLICIES_RAW,
    SecurityPolicy,
    [SecurityPolicy.Basic256Sha256, SecurityPolicy.Basic256, SecurityPolicy.Basic128Rsa15]
  );
  const hasUserCredentials = !!(OPCUA_USERNAME && OPCUA_PASSWORD);
  const allowAnonymous = hasUserCredentials ? OPCUA_ALLOW_ANONYMOUS : true;
  if (!hasUserCredentials && !OPCUA_ALLOW_ANONYMOUS) {
    // eslint-disable-next-line no-console
    console.warn("OPCUA_USERNAME/OPCUA_PASSWORD not set; allowing anonymous OPC UA sessions.");
  }

  const server = new OPCUAServer({
    port: Number(config?.opcua?.port ?? 4840),
    resourcePath: String(config?.opcua?.resourcePath ?? "/UA/ControlLogix"),
    allowAnonymous,
    securityModes,
    securityPolicies,
    userManager: {
      isValidUser: (username, password) => {
        if (!hasUserCredentials) return false;
        return String(username || "") === OPCUA_USERNAME && String(password || "") === OPCUA_PASSWORD;
      },
    },
    buildInfo: {
      productName: "Mesora-CLX-OPCUA-Bridge",
      buildNumber: "1",
      buildDate: new Date(),
    },
  });

  await server.initialize();
  const addressSpace = server.engine.addressSpace;
  const namespace = addressSpace.getOwnNamespace();
  const device = namespace.addObject({
    organizedBy: addressSpace.rootFolder.objects,
    browseName: String(config?.opcua?.name ?? "ControlLogix"),
  });

  const plcClients = new Map();
  const plcConnected = new Map();
  const plcLastPollAt = new Map();
  const plcPollInFlight = new Map();
  const plcReconnectInFlight = new Map();
  const plcReadCursor = new Map();
  const plcDeferredReads = new Map();
  const plcHeartbeatFailureStreak = new Map();
  const plcConnectFailureStreak = new Map();
  const plcReadTransportFailureStreak = new Map();
  const plcTimeoutFailureWindow = new Map();
  const plcReconnectWarmupUntil = new Map();
  const plcWriteInFlight = new Map();
  const plcWriteQuietUntil = new Map();
  const isTimeoutLikeError = (err) => {
    const msg = String(err?.message || err || "").toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("timeout-recv-data") ||
      msg.includes("recv-data") ||
      msg.includes("pool is draining") ||
      msg.includes("cannot accept work") ||
      msg.includes("connection lost") ||
      msg.includes("disconnected")
    );
  };
  const tagValues = new Map();
  const tagErrors = new Map();
  const tagLastRead = new Map();
  const tagLastSuccessAt = new Map();
  const tagLastErrorAt = new Map();
  const tagLastErrorMessage = new Map();
  const tagErrorStreak = new Map();
  const tagQuality = new Map();
  const tagEffectiveInterval = new Map();
  const tagNextDueAt = new Map();
  const tagReadCount = new Map();
  const tagReadSuccessCount = new Map();
  const tagReadErrorCount = new Map();
  const tagReadDurationTotalMs = new Map();
  const tagReadDurationMaxMs = new Map();
  const plcInitialScanNeeded = new Map(); // true when PLC just connected and full scan hasn't run yet
  const plcConnectionPools = new Map(); // plcName â†’ Array<{slotKey, plc}>
  const slotKeyToPlcName = new Map(); // slotKey â†’ plcName (for pool slots)
  const tagLastReadDurationMs = new Map();
  const issueLog = [];
  const issueLastKeyAt = new Map();
  let issueSeq = 0;
  const ISSUE_LOG_MAX = 500;
  const ISSUE_DEDUPE_MS = 3000;
  const mqttState = {
    enabled: mqttEnabled,
    connected: false,
    lastError: "",
    client: null,
  };
  let statusPublishInFlight = false;
  let pendingStatusPayload = null;
  let writeStatusDebounceTimer = null;
  const WRITE_STATUS_DEBOUNCE_MS = 80; // coalesce rapid cascading calls (connect/disconnect events)
  const runtimeWriteMetrics = {
    count: 0,
    totalMs: 0,
    avgMs: 0,
    maxMs: 0,
    lastMs: 0,
    lastAt: null,
    lastTagKey: "",
    lastPlcName: "",
    lastSlotKey: "",
    lastWaitForReadIdleMs: 0,
    lastPlcWriteMs: 0,
    lastPollSettled: true,
    lastCommandLike: false,
    lastOk: true,
  };
  let priorityKeySetLower = new Set();
  let priorityKeysUpdatedAt = 0;
  let priorityKeysSource = "";
  let priorityKeysLastError = "";
  let priorityRefreshInFlight = false;
  let priorityRefreshLastAt = 0;
  let priorityKeysLastNonEmptyAt = 0;
  const connectionGuardFailureWindowByPlc = new Map();
  let connectionGuardModeActive = false;
  let connectionGuardActivatedAt = 0;
  let connectionGuardUntilMs = 0;
  let connectionGuardLastFailureAt = 0;
  let normalThroughputProfile = null;

  function toIssueMessage(err, fallback = "Unknown OPC issue.") {
    const text = String(err?.message || err || "").trim();
    return text || fallback;
  }

  function normalizePriorityKey(value) {
    const raw = String(value || "").replace(/\r?\n/g, "").trim();
    if (!raw) return "";
    const withoutDefault = raw.replace(/^default\./i, "");
    return withoutDefault.toLowerCase();
  }

  function isCommandLikeWriteTag(...keys) {
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

  function pushIssue(event = {}) {
    const now = Date.now();
    const severityRaw = String(event?.severity || "error").trim().toLowerCase();
    const severity =
      severityRaw === "info" || severityRaw === "warn" || severityRaw === "error"
        ? severityRaw
        : "error";
    const kind = String(event?.kind || "opc_issue").trim() || "opc_issue";
    const message = String(event?.message || "").trim() || "OPC issue";
    const plcName = String(event?.plcName || "").trim();
    const tagKey = String(event?.tagKey || "").trim();
    const dedupeKey = `${severity}|${kind}|${plcName}|${tagKey}|${message}`;
    const lastAt = Number(issueLastKeyAt.get(dedupeKey) || 0);
    if (now - lastAt < ISSUE_DEDUPE_MS) return;
    issueLastKeyAt.set(dedupeKey, now);
    issueLog.unshift({
      id: `${now}-${++issueSeq}`,
      at: now,
      severity,
      kind,
      plcName,
      tagKey,
      message,
    });
    if (issueLog.length > ISSUE_LOG_MAX) issueLog.length = ISSUE_LOG_MAX;
  }

  function snapshotThroughputProfile() {
    return {
      maxReadsPerTick,
      readConcurrency,
      multiReadBatchSize,
      multiReadConcurrency,
      initialScanBurstLimit,
      readRetryCount,
      multiReadRetryCount,
      multiReadEnabled,
      multiReadDisabledUntilMs,
    };
  }

  function applyReceiveTimeoutToAllPlcs(timeoutMs) {
    if (!Number.isFinite(Number(timeoutMs)) || Number(timeoutMs) <= 0) return;
    plcClients.forEach((client) => {
      try {
        client.timeoutReceive = Math.round(Number(timeoutMs));
      } catch {
        // ignore per-client timeout assignment failures
      }
    });
  }

  function activateConnectionGuard(plcName = "", reason = "", source = "") {
    if (!connectionGuardEnabled) return;
    const now = Date.now();
    if (!normalThroughputProfile) {
      normalThroughputProfile = snapshotThroughputProfile();
    }
    connectionGuardModeActive = true;
    if (!connectionGuardActivatedAt) connectionGuardActivatedAt = now;
    connectionGuardLastFailureAt = now;
    connectionGuardUntilMs = Math.max(connectionGuardUntilMs || 0, now + connectionGuardCooldownMs);

    maxReadsPerTick = Math.min(maxReadsPerTick, connectionGuardMaxReadsPerTick);
    readConcurrency = Math.min(readConcurrency, connectionGuardReadConcurrency);
    multiReadBatchSize = Math.min(multiReadBatchSize, connectionGuardMultiReadBatchSize);
    multiReadConcurrency = Math.min(multiReadConcurrency, 1);
    initialScanBurstLimit = Math.min(initialScanBurstLimit, connectionGuardInitialScanBurstLimit);
    readRetryCount = Math.min(readRetryCount, 1);
    multiReadRetryCount = Math.min(multiReadRetryCount, 0);
    multiReadEnabled = false;
    multiReadDisabledUntilMs = Math.max(
      Number(multiReadDisabledUntilMs || 0),
      Number(connectionGuardUntilMs || 0)
    );
    applyReceiveTimeoutToAllPlcs(connectionGuardReceiveTimeoutMs);

    const reasonMsg = toIssueMessage(reason, "timeout/disconnect");
    const sourceMsg = String(source || "").trim();
    pushIssue({
      severity: "warn",
      kind: "opc_connection_guard_enabled",
      plcName,
      message:
        `Connection guard enabled due to unstable PLC session (${sourceMsg || "unknown source"}): ${reasonMsg}. ` +
        `Temporarily reducing read load to keep session connected.`,
    });
  }

  function maybeRecoverConnectionGuard() {
    if (!connectionGuardModeActive) return;
    const now = Date.now();
    if (now < Number(connectionGuardUntilMs || 0)) return;
    if (now - Number(connectionGuardLastFailureAt || 0) < connectionGuardRecoverAfterMs) return;
    if (plcs.length > 0 && !plcs.every((p) => plcConnected.get(String(p?.name || "").trim()) === true)) return;
    if (!normalThroughputProfile) return;

    maxReadsPerTick = normalThroughputProfile.maxReadsPerTick;
    readConcurrency = normalThroughputProfile.readConcurrency;
    multiReadBatchSize = normalThroughputProfile.multiReadBatchSize;
    multiReadConcurrency = normalThroughputProfile.multiReadConcurrency;
    initialScanBurstLimit = normalThroughputProfile.initialScanBurstLimit;
    readRetryCount = normalThroughputProfile.readRetryCount;
    multiReadRetryCount = normalThroughputProfile.multiReadRetryCount;
    multiReadEnabled = multiReadConfigured && normalThroughputProfile.multiReadEnabled === true;
    multiReadDisabledUntilMs = 0;
    multiReadFailureStreak = 0;
    multiReadLastFailureAt = 0;
    connectionGuardModeActive = false;
    connectionGuardActivatedAt = 0;
    connectionGuardUntilMs = 0;
    connectionGuardFailureWindowByPlc.clear();
    applyReceiveTimeoutToAllPlcs(plcReceiveTimeoutMs);
    pushIssue({
      severity: "info",
      kind: "opc_connection_guard_recovered",
      message: "Connection guard disabled after sustained stable PLC connectivity.",
    });
  }

  function recordConnectionFailure(plcName = "", reason = "", source = "") {
    if (!connectionGuardEnabled) return;
    if (!isTimeoutLikeError(reason)) return;
    const now = Date.now();
    connectionGuardLastFailureAt = now;
    const key = String(plcName || "").trim() || "default";
    const prev = connectionGuardFailureWindowByPlc.get(key) || { startAt: now, count: 0 };
    const withinWindow = now - Number(prev.startAt || 0) <= connectionGuardWindowMs;
    const next = withinWindow
      ? { startAt: Number(prev.startAt || now), count: Number(prev.count || 0) + 1 }
      : { startAt: now, count: 1 };
    connectionGuardFailureWindowByPlc.set(key, next);
    if (next.count >= connectionGuardFailureStreak) {
      activateConnectionGuard(plcName, reason, source);
    }
  }

  function noteMultiReadSuccess() {
    multiReadFailureStreak = 0;
    multiReadLastFailureAt = 0;
  }

  function noteMultiReadFailure(err, plcName = "") {
    if (!multiReadConfigured) return;
    const msg = String(err?.message || err || "").toLowerCase();
    if (!msg) return;
    const timeoutLike =
      msg.includes("multi-read") ||
      msg.includes("multi read") ||
      msg.includes("timeout") ||
      msg.includes("timeout-recv-data") ||
      msg.includes("recv-data");
    if (!timeoutLike) return;

    const now = Date.now();
    const withinWindow =
      Number(multiReadLastFailureAt || 0) > 0 &&
      now - Number(multiReadLastFailureAt || 0) <= multiReadFailureWindowMs;
    multiReadFailureStreak = withinWindow ? Number(multiReadFailureStreak || 0) + 1 : 1;
    multiReadLastFailureAt = now;

    if (!multiReadEnabled) return;
    if (multiReadFailureStreak < multiReadFallbackStreak) return;

    multiReadEnabled = false;
    multiReadDisabledUntilMs = now + multiReadFallbackCooldownMs;
    pushIssue({
      severity: "warn",
      kind: "opc_multi_read_temporarily_disabled",
      plcName,
      message:
        `Multi-read temporarily disabled after ${multiReadFailureStreak} timeout-like failures. ` +
        `Retrying in ${Math.round(multiReadFallbackCooldownMs / 1000)}s.`,
    });
    // eslint-disable-next-line no-console
    console.warn(
      `[opc-server] Multi-read temporarily disabled after ${multiReadFailureStreak} failures. ` +
        `Retry in ${Math.round(multiReadFallbackCooldownMs / 1000)}s.`
    );
  }

  function maybeReenableMultiRead(plcName = "") {
    if (!multiReadConfigured) return;
    if (connectionGuardModeActive) return;
    if (multiReadEnabled) return;
    const now = Date.now();
    if (now < Number(multiReadDisabledUntilMs || 0)) return;
    multiReadEnabled = true;
    multiReadFailureStreak = 0;
    multiReadLastFailureAt = 0;
    multiReadDisabledUntilMs = 0;
    pushIssue({
      severity: "info",
      kind: "opc_multi_read_reenabled",
      plcName,
      message: "Multi-read re-enabled after cooldown window.",
    });
  }

  function getPlcSlotKeys(plcName = "") {
    const key = String(plcName || "").trim();
    if (!key) return [];
    const pool = plcConnectionPools.get(key);
    if (Array.isArray(pool) && pool.length) {
      return pool
        .map((entry) => String(entry?.slotKey || "").trim())
        .filter(Boolean);
    }
    return [key];
  }

  function beginPlcWriteWindow(plcName = "") {
    if (!writePriorityEnabled) return;
    const key = String(plcName || "").trim();
    if (!key) return;
    plcWriteInFlight.set(key, Math.max(0, Number(plcWriteInFlight.get(key) || 0)) + 1);
  }

  function endPlcWriteWindow(plcName = "") {
    if (!writePriorityEnabled) return;
    const key = String(plcName || "").trim();
    if (!key) return;
    const current = Math.max(0, Number(plcWriteInFlight.get(key) || 0));
    if (current <= 1) plcWriteInFlight.delete(key);
    else plcWriteInFlight.set(key, current - 1);
    if (writeQuietMs > 0) {
      plcWriteQuietUntil.set(key, Math.max(Number(plcWriteQuietUntil.get(key) || 0), Date.now() + writeQuietMs));
    } else if (!plcWriteInFlight.has(key)) {
      plcWriteQuietUntil.delete(key);
    }
  }

  function getPlcWriteQuietRemainingMs(plcName = "", now = Date.now()) {
    const key = String(plcName || "").trim();
    if (!key) return 0;
    const quietUntil = Math.max(0, Number(plcWriteQuietUntil.get(key) || 0));
    if (!quietUntil) return 0;
    const remaining = quietUntil - Number(now || Date.now());
    if (remaining <= 0) {
      plcWriteQuietUntil.delete(key);
      return 0;
    }
    return remaining;
  }

  function isPlcReadPausedForWrite(plcName = "", now = Date.now()) {
    if (!writePriorityEnabled) return false;
    const key = String(plcName || "").trim();
    if (!key) return false;
    if (Math.max(0, Number(plcWriteInFlight.get(key) || 0)) > 0) return true;
    return getPlcWriteQuietRemainingMs(key, now) > 0;
  }

  async function waitForPlcPollIdle(plcName = "", timeoutMs = 1000) {
    const slotKeys = getPlcSlotKeys(plcName);
    if (!slotKeys.length) return true;
    const deadline = Date.now() + Math.max(50, Math.round(Number(timeoutMs) || 0));
    while (Date.now() <= deadline) {
      if (!slotKeys.some((slotKey) => plcPollInFlight.get(slotKey) === true)) return true;
      await sleep(10);
    }
    return !slotKeys.some((slotKey) => plcPollInFlight.get(slotKey) === true);
  }

  async function waitForSlotPollIdle(slotKey = "", timeoutMs = 1000) {
    const key = String(slotKey || "").trim();
    if (!key) return true;
    const deadline = Date.now() + Math.max(50, Math.round(Number(timeoutMs) || 0));
    while (Date.now() <= deadline) {
      if (plcPollInFlight.get(key) !== true) return true;
      await sleep(10);
    }
    return plcPollInFlight.get(key) !== true;
  }

  function selectPlcWriteClient(plcName = "") {
    const key = String(plcName || "").trim();
    if (!key) return null;
    const pool = plcConnectionPools.get(key);
    const candidates =
      Array.isArray(pool) && pool.length
        ? pool
        : [{ slotKey: key, plc: plcClients.get(key) }];
    const normalized = candidates
      .map((entry) => {
        const slotKey = String(entry?.slotKey || "").trim();
        const plc = entry?.plc || plcClients.get(slotKey);
        if (!slotKey || !plc) return null;
        return {
          slotKey,
          plc,
          connected: plcConnected.get(slotKey) === true,
          pollInFlight: plcPollInFlight.get(slotKey) === true,
          deferredReads: Math.max(0, Number(plcDeferredReads.get(slotKey) || 0)),
          lastPollAt: Math.max(0, Number(plcLastPollAt.get(slotKey) || 0)),
        };
      })
      .filter(Boolean);
    if (!normalized.length) return null;
    const connected = normalized.filter((entry) => entry.connected);
    const ranked = (connected.length ? connected : normalized).sort((a, b) => {
      if (a.pollInFlight !== b.pollInFlight) return a.pollInFlight ? 1 : -1;
      if (a.deferredReads !== b.deferredReads) return a.deferredReads - b.deferredReads;
      if (a.lastPollAt !== b.lastPollAt) return a.lastPollAt - b.lastPollAt;
      return a.slotKey.localeCompare(b.slotKey);
    });
    return ranked[0] || null;
  }

  function recordRuntimeWriteMetrics({
    plcName = "",
    tagKey = "",
    slotKey = "",
    commandLike = false,
    ok = true,
    timings = null,
  } = {}) {
    const totalMs = Math.max(0, Number(timings?.totalMs || 0));
    runtimeWriteMetrics.count += 1;
    runtimeWriteMetrics.totalMs += totalMs;
    runtimeWriteMetrics.avgMs = Math.round(runtimeWriteMetrics.totalMs / Math.max(1, runtimeWriteMetrics.count));
    runtimeWriteMetrics.maxMs = Math.max(runtimeWriteMetrics.maxMs, totalMs);
    runtimeWriteMetrics.lastMs = totalMs;
    runtimeWriteMetrics.lastAt = Date.now();
    runtimeWriteMetrics.lastTagKey = String(tagKey || "").trim();
    runtimeWriteMetrics.lastPlcName = String(plcName || "").trim();
    runtimeWriteMetrics.lastSlotKey = String(slotKey || "").trim();
    runtimeWriteMetrics.lastWaitForReadIdleMs = Math.max(0, Number(timings?.waitForReadIdleMs || 0));
    runtimeWriteMetrics.lastPlcWriteMs = Math.max(0, Number(timings?.plcWriteMs || 0));
    runtimeWriteMetrics.lastPollSettled = timings?.pollSettled !== false;
    runtimeWriteMetrics.lastCommandLike = commandLike === true;
    runtimeWriteMetrics.lastOk = ok !== false;
  }

  async function refreshPriorityHintsFromAi(force = false) {
    const now = Date.now();
    if (priorityRefreshInFlight) return;
    if (!force && now - Number(priorityRefreshLastAt || 0) < priorityRefreshMs) return;
    priorityRefreshInFlight = true;
    priorityRefreshLastAt = now;
    try {
      const headers = OPC_SERVER_KEY ? { "x-opc-key": OPC_SERVER_KEY } : undefined;
      const response = await fetch(`${AI_SERVER_URL.replace(/\/$/, "")}/api/opc/priorities`, { headers });
      if (!response.ok) {
        throw new Error(`Priority fetch failed (${response.status}).`);
      }
      const data = await response.json().catch(() => ({}));
      const list = Array.isArray(data?.keys) ? data.keys : [];
      const next = new Set();
      for (let i = 0; i < list.length && next.size < priorityKeyCap; i += 1) {
        const normalized = normalizePriorityKey(list[i]);
        if (!normalized) continue;
        next.add(normalized);
      }
      priorityKeySetLower = next;
      priorityKeysUpdatedAt = Number(data?.updatedAt || Date.now()) || Date.now();
      priorityKeysLastNonEmptyAt = next.size ? priorityKeysUpdatedAt : 0;
      priorityKeysSource = String(data?.source || "").trim();
      priorityKeysLastError = "";
    } catch (err) {
      priorityKeysLastError = toIssueMessage(err, "Failed to refresh OPC priority keys.");
    } finally {
      priorityRefreshInFlight = false;
    }
  }

  function hasActivePriorityScope(now = Date.now()) {
    if (!(priorityKeySetLower instanceof Set) || !priorityKeySetLower.size) return false;
    const updatedAt = Math.max(
      Number(priorityKeysUpdatedAt || 0),
      Number(priorityKeysLastNonEmptyAt || 0)
    );
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
    return now - updatedAt <= uiScopedReadsStaleMs + uiScopedReadsHoldMs;
  }

  function getLegacyTagKey(tag) {
    const topicName = tag.topic || "";
    const name = tag.name || "";
    return topicName ? `${topicName}.${name}` : name;
  }

  function getPathTagKey(tag) {
    const topicName = tag.topic || "";
    const base = tag.tagPath || tag.name || "";
    return topicName ? `${topicName}.${base}` : base;
  }

  function buildPriorityLookupKeys(tag = {}) {
    const topic = String(tag?.topic || "").trim();
    const group = String(tag?.groupName || "").trim();
    const name = String(tag?.name || "").trim();
    const tagPath = String(tag?.tagPath || tag?.name || "").trim();
    const out = new Set();
    const add = (raw) => {
      const normalized = normalizePriorityKey(raw);
      if (!normalized) return;
      out.add(normalized);
    };
    add(tag?.tagKey);
    add(tag?.legacyTagKey);
    add(tagPath);
    add(name);
    if (topic && tagPath) add(`${topic}.${tagPath}`);
    if (topic && name) add(`${topic}.${name}`);
    if (group && tagPath) add(`${group}.${tagPath}`);
    if (group && name) add(`${group}.${name}`);
    if (topic && group && tagPath) add(`${topic}.${group}.${tagPath}`);
    if (topic && group && name) add(`${topic}.${group}.${name}`);
    return out;
  }

  const tagsWithMeta = tags.map((t) => {
    const topicName = t.topic && topicsByName.has(t.topic) ? t.topic : "Default";
    const topic = topicsByName.get(topicName) || { name: topicName, plcName: defaultPlcName };
    const plcName = topic.plcName || defaultPlcName;
    const plc = plcs.find((p) => p.name === plcName) || plcs[0];
    const pollMs = parsePositiveMs(t.pollMs, parsePositiveMs(plc?.pollMs, globalPollMs));
    const samplingInterval = parsePositiveMs(
      t.samplingInterval,
      parsePositiveMs(topic?.samplingInterval, parsePositiveMs(plc?.pollMs, globalPollMs))
    );
    return {
      ...t,
      topic: topicName,
      plcName,
      pollMs,
      samplingInterval,
      tagKey: getPathTagKey({ ...t, topic: topicName }),
      legacyTagKey: getLegacyTagKey({ ...t, topic: topicName }),
      priorityLookupKeys: buildPriorityLookupKeys({
        ...t,
        topic: topicName,
        tagKey: getPathTagKey({ ...t, topic: topicName }),
        legacyTagKey: getLegacyTagKey({ ...t, topic: topicName }),
      }),
    };
  });

  const activeTagCount = tagsWithMeta.reduce(
    (sum, t) => sum + (t?.muted === true ? 0 : 1),
    0
  );
  if (adaptiveThroughputTuning && activeTagCount >= 600) {
    const isVeryHighLoad = activeTagCount >= 900;
    const before = {
      maxReadsPerTick,
      readConcurrency,
      multiReadBatchSize,
      multiReadConcurrency,
      initialScanBurstLimit,
      readRetryCount,
      multiReadRetryCount,
      multiReadFallbackStreak,
    };
    maxReadsPerTick = Math.min(maxReadsPerTick, isVeryHighLoad ? 260 : 320);
    readConcurrency = Math.min(readConcurrency, isVeryHighLoad ? 4 : 6);
    multiReadBatchSize = Math.min(multiReadBatchSize, isVeryHighLoad ? 8 : 12);
    multiReadConcurrency = Math.min(multiReadConcurrency, isVeryHighLoad ? 3 : 4);
    initialScanBurstLimit = Math.min(initialScanBurstLimit, isVeryHighLoad ? 120 : 180);
    readRetryCount = Math.min(readRetryCount, 1);
    multiReadRetryCount = Math.min(multiReadRetryCount, 0);
    multiReadFallbackStreak = Math.min(multiReadFallbackStreak, 1);

    const changes = [];
    if (before.maxReadsPerTick !== maxReadsPerTick) {
      changes.push(`maxReadsPerTick ${before.maxReadsPerTick}->${maxReadsPerTick}`);
    }
    if (before.readConcurrency !== readConcurrency) {
      changes.push(`readConcurrency ${before.readConcurrency}->${readConcurrency}`);
    }
    if (before.multiReadBatchSize !== multiReadBatchSize) {
      changes.push(`multiReadBatchSize ${before.multiReadBatchSize}->${multiReadBatchSize}`);
    }
    if (before.multiReadConcurrency !== multiReadConcurrency) {
      changes.push(`multiReadConcurrency ${before.multiReadConcurrency}->${multiReadConcurrency}`);
    }
    if (before.initialScanBurstLimit !== initialScanBurstLimit) {
      changes.push(`initialScanBurstLimit ${before.initialScanBurstLimit}->${initialScanBurstLimit}`);
    }
    if (before.readRetryCount !== readRetryCount) {
      changes.push(`readRetryCount ${before.readRetryCount}->${readRetryCount}`);
    }
    if (before.multiReadRetryCount !== multiReadRetryCount) {
      changes.push(`multiReadRetryCount ${before.multiReadRetryCount}->${multiReadRetryCount}`);
    }
    if (before.multiReadFallbackStreak !== multiReadFallbackStreak) {
      changes.push(`multiReadFallbackStreak ${before.multiReadFallbackStreak}->${multiReadFallbackStreak}`);
    }
    if (changes.length) {
      const message = `Applied adaptive high-tag tuning for ${activeTagCount} active tags: ${changes.join(", ")}.`;
      // eslint-disable-next-line no-console
      console.warn(`[opc-server] ${message}`);
      pushIssue({
        severity: "warn",
        kind: "opc_adaptive_tuning",
        message,
      });
    }
  }

  normalThroughputProfile = snapshotThroughputProfile();

  tagsWithMeta.forEach((t) => tagValues.set(t.tagKey, null));
  tagsWithMeta.forEach((t) => {
    tagQuality.set(t.tagKey, t.muted ? "Muted" : "Unknown");
    tagEffectiveInterval.set(t.tagKey, parsePositiveMs(t.samplingInterval, parsePositiveMs(t.pollMs, globalPollMs)));
    tagNextDueAt.set(t.tagKey, Date.now() + Math.floor(Math.random() * Math.max(1, pollJitterMs + 1)));
    tagReadCount.set(t.tagKey, 0);
    tagReadSuccessCount.set(t.tagKey, 0);
    tagReadErrorCount.set(t.tagKey, 0);
    tagReadDurationTotalMs.set(t.tagKey, 0);
    tagReadDurationMaxMs.set(t.tagKey, 0);
    tagLastReadDurationMs.set(t.tagKey, null);
  });

  const topicNodes = new Map();
  const resolvedTopics = Array.from(topicsByName.values());
  resolvedTopics.forEach((t) => {
    const node = namespace.addObject({
      componentOf: device,
      browseName: t.name,
    });
    topicNodes.set(t.name, node);
  });

  const numericTypes = new Set([
    DataType.SByte,
    DataType.Byte,
    DataType.Int16,
    DataType.UInt16,
    DataType.Int32,
    DataType.UInt32,
    DataType.Int64,
    DataType.UInt64,
    DataType.Float,
    DataType.Double,
  ]);

  function normalizeVariantValue(uaType, raw) {
    if (uaType === DataType.Boolean) return Boolean(raw);
    if (uaType === DataType.String) return raw == null ? "" : String(raw);
    if (uaType === DataType.DateTime) {
      const date = raw instanceof Date ? raw : new Date(raw);
      return Number.isNaN(date.getTime()) ? new Date(0) : date;
    }
    if (numericTypes.has(uaType)) {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    return raw ?? null;
  }

  function createVariable(tag) {
    const uaType = tag.uaType
      ? DataType[String(tag.uaType)]
      : plcTypeToUa(tag.plcType);
    const node = topicNodes.get(tag.topic) || device;
    namespace.addVariable({
      componentOf: node,
      browseName: tag.name,
      minimumSamplingInterval: tag.samplingInterval || tag.pollMs || 1000,
      dataType: uaType,
      value: {
        get: () =>
          new Variant({
            dataType: uaType,
            value: normalizeVariantValue(uaType, tagValues.get(tag.tagKey)),
          }),
        set: async (variant) => {
          try {
            const plc = plcClients.get(tag.plcName);
            if (!plc || !plcConnected.get(tag.plcName)) return StatusCodes.BadNotConnected;
            await plc.write(tag.tagPath || tag.name, variant.value);
            tagValues.set(tag.tagKey, variant.value);
            return StatusCodes.Good;
          } catch {
            return StatusCodes.Bad;
          }
        },
      },
    });
  }

  tagsWithMeta.forEach(createVariable);

  const tagsByAnyKey = new Map();
  tagsWithMeta.forEach((t) => {
    const keys = [t.tagKey, t.legacyTagKey, t.tagPath, t.name].map((k) => String(k || "").trim()).filter(Boolean);
    keys.forEach((k) => {
      if (!tagsByAnyKey.has(k)) tagsByAnyKey.set(k, t);
    });
  });

  const numericPlcTypes = new Set([
    "SINT",
    "INT",
    "DINT",
    "LINT",
    "USINT",
    "UINT",
    "UDINT",
    "REAL",
    "LREAL",
  ]);

  function normalizeWriteValueForTag(tag, rawValue) {
    const uaType = String(tag?.uaType || "").toLowerCase();
    const plcType = String(tag?.plcType || "").toUpperCase();
    if (uaType === "boolean" || plcType === "BOOL") {
      if (typeof rawValue === "boolean") return rawValue;
      if (typeof rawValue === "number") return Number.isFinite(rawValue) ? rawValue !== 0 : false;
      const txt = String(rawValue ?? "").trim().toLowerCase();
      if (["1", "true", "on", "yes"].includes(txt)) return true;
      if (["0", "false", "off", "no", ""].includes(txt)) return false;
      return false;
    }
    if (
      uaType === "int16" ||
      uaType === "int32" ||
      uaType === "int64" ||
      uaType === "uint16" ||
      uaType === "uint32" ||
      uaType === "uint64" ||
      uaType === "float" ||
      uaType === "double" ||
      numericPlcTypes.has(plcType)
    ) {
      const n = Number(rawValue);
      return Number.isFinite(n) ? n : 0;
    }
    if (uaType === "string" || plcType === "STRING") return String(rawValue ?? "");
    return rawValue;
  }

  async function writeTagToPlc({ tagKey, legacyTagKey, value }) {
    const key = String(tagKey || legacyTagKey || "").trim();
    const tag = tagsByAnyKey.get(key);
    if (!tag) {
      pushIssue({
        severity: "warn",
        kind: "plc_write_unknown_tag",
        tagKey: key,
        message: `Write rejected. Unknown tag: ${key}`,
      });
      return { ok: false, status: 404, error: `Unknown tag: ${key}` };
    }
    if (!opcConnectionEnabled) {
      pushIssue({
        severity: "warn",
        kind: "plc_write_disabled",
        plcName: tag.plcName,
        tagKey: tag.tagKey,
        message: "Write rejected because OPC connection is disabled.",
      });
      return { ok: false, status: 409, error: "OPC connection is disabled." };
    }
    const plcName = String(tag.plcName || "").trim();
    const writeClient = selectPlcWriteClient(plcName);
    const writeSlotKey = String(writeClient?.slotKey || plcName).trim();
    const plc = writeClient?.plc || null;
    if (!plc) {
      pushIssue({
        severity: "warn",
        kind: "plc_write_not_connected",
        plcName,
        tagKey: tag.tagKey,
        message: `Write rejected. PLC ${plcName} is not connected.`,
      });
      return { ok: false, status: 503, error: `PLC ${plcName} is not connected.` };
    }
    if (!plcConnected.get(writeSlotKey)) {
      pushIssue({
        severity: "warn",
        kind: "plc_write_reconnect_attempt",
        plcName,
        tagKey: tag.tagKey,
        message: `PLC ${plcName} slot ${writeSlotKey} not connected during write. Reconnect requested.`,
      });
      void connectPlcWithRetry(writeSlotKey, plc);
      pushIssue({
        severity: "warn",
        kind: "plc_write_not_connected",
        plcName,
        tagKey: tag.tagKey,
        message: `Write rejected. PLC ${plcName} slot ${writeSlotKey} is disconnected (reconnecting in background).`,
      });
      return {
        ok: false,
        status: 503,
        error: `PLC ${plcName} is disconnected. Reconnecting in background.`,
      };
    }
    const normalized = normalizeWriteValueForTag(tag, value);
    const commandLikeWrite = isCommandLikeWriteTag(tag.tagKey, tag.legacyTagKey, tag.tagPath, tag.name);
    const writeTimeoutMs = readTimeoutMs * 2; // writes need one round-trip + PLC scan time
    const writeStartedAt = Date.now();
    const timings = {
      slotKey: writeSlotKey,
      waitForReadIdleMs: 0,
      plcWriteMs: 0,
      totalMs: 0,
      pollSettled: true,
      commandLikeWrite,
    };
    const writeTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Write timeout after ${writeTimeoutMs}ms`)), writeTimeoutMs)
    );
    let writeSucceeded = false;
    beginPlcWriteWindow(plcName);
    try {
      const pollIdleWaitMs = commandLikeWrite
        ? Math.max(75, Math.min(250, Math.round(readTimeoutMs * 0.1)))
        : Math.min(
            2500,
            Math.max(500, readTimeoutMs + Math.max(0, Number(readRetryDelayMs) || 0))
          );
      const waitStartedAt = Date.now();
      const pollSettled = await waitForSlotPollIdle(writeSlotKey, pollIdleWaitMs);
      timings.waitForReadIdleMs = Math.max(0, Date.now() - waitStartedAt);
      timings.pollSettled = pollSettled;
      if (!pollSettled) {
        pushIssue({
          severity: "warn",
          kind: "plc_write_waited_for_reads",
          plcName,
          tagKey: tag.tagKey,
          message: `Write waited ${timings.waitForReadIdleMs}ms for in-flight reads on PLC ${plcName} slot ${writeSlotKey} but a poll was still busy after timeout.`,
        });
      }
      const plcWriteStartedAt = Date.now();
      await Promise.race([plc.write(tag.tagPath || tag.name, normalized), writeTimeoutPromise]);
      timings.plcWriteMs = Math.max(0, Date.now() - plcWriteStartedAt);
      writeSucceeded = true;
    } finally {
      timings.totalMs = Math.max(0, Date.now() - writeStartedAt);
      endPlcWriteWindow(plcName);
      recordRuntimeWriteMetrics({
        plcName,
        tagKey: tag.tagKey,
        slotKey: writeSlotKey,
        commandLike: commandLikeWrite,
        ok: writeSucceeded,
        timings,
      });
    }
    tagValues.set(tag.tagKey, normalized);
    if (tag.legacyTagKey && tag.legacyTagKey !== tag.tagKey) tagValues.set(tag.legacyTagKey, normalized);
    if (timings.totalMs >= 1500 || timings.waitForReadIdleMs >= 500 || timings.plcWriteMs >= 1500) {
      pushIssue({
        severity: "warn",
        kind: "plc_write_slow",
        plcName,
        tagKey: tag.tagKey,
        message: `Slow PLC write on ${plcName} slot ${writeSlotKey}: total ${timings.totalMs}ms, wait ${timings.waitForReadIdleMs}ms, plc.write ${timings.plcWriteMs}ms.`,
      });
    }
    return { ok: true, tagKey: tag.tagKey, value: normalized, timings };
  }

  function parseMqttWriteMessage(topic, payloadBuffer) {
    const topicText = String(topic || "").trim();
    const payloadText = String(payloadBuffer || "").trim();
    if (!payloadText) return null;

    let parsed = null;
    try {
      parsed = JSON.parse(payloadText);
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === "object") {
      const tagKey = String(parsed.tagKey || parsed.tag || "").trim();
      const legacyTagKey = String(parsed.legacyTagKey || "").trim();
      if (tagKey || legacyTagKey) {
        return {
          tagKey,
          legacyTagKey,
          value: parsed.value,
        };
      }
    }

    const prefix = mqttWriteTopic ? `${mqttWriteTopic}/` : "";
    let tagKeyFromTopic = "";
    if (prefix && topicText.startsWith(prefix)) {
      try {
        tagKeyFromTopic = decodeURIComponent(topicText.slice(prefix.length));
      } catch {
        tagKeyFromTopic = topicText.slice(prefix.length);
      }
    }
    if (!tagKeyFromTopic) return null;

    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "value")) {
      return { tagKey: tagKeyFromTopic, value: parsed.value };
    }

    return { tagKey: tagKeyFromTopic, value: payloadText };
  }

  function startMqttBridge() {
    if (!mqttState.enabled) return;
    if (!mqttBrokerUrl) {
      mqttState.lastError = "MQTT broker URL is missing.";
      return;
    }
    const options = {
      reconnectPeriod: reconnectDelayMs,
      connectTimeout: readTimeoutMs,
      keepalive: Math.max(5, Math.round(heartbeatMs / 1000)),
      clean: true,
    };
    if (mqttClientId) options.clientId = mqttClientId;
    if (mqttUsername) options.username = mqttUsername;
    if (mqttPassword) options.password = mqttPassword;

    const client = mqttConnect(mqttBrokerUrl, options);
    mqttState.client = client;

    client.on("connect", () => {
      mqttState.connected = true;
      mqttState.lastError = "";
      pushIssue({
        severity: "info",
        kind: "mqtt_connected",
        message: `MQTT connected to ${mqttBrokerUrl}.`,
      });
      if (mqttWriteTopic) {
        client.subscribe(mqttWriteTopic, { qos: mqttQos }, (err) => {
          if (err) {
            mqttState.lastError = err?.message || "MQTT subscribe failed.";
            pushIssue({
              severity: "error",
              kind: "mqtt_subscribe_failed",
              message: toIssueMessage(err, "MQTT subscribe failed."),
            });
          }
          writeStatus();
        });
        client.subscribe(`${mqttWriteTopic}/#`, { qos: mqttQos }, () => {
          writeStatus();
        });
      }
      writeStatus();
    });

    client.on("reconnect", () => {
      mqttState.connected = false;
      pushIssue({
        severity: "warn",
        kind: "mqtt_reconnecting",
        message: "MQTT reconnecting.",
      });
      writeStatus();
    });

    client.on("close", () => {
      mqttState.connected = false;
      pushIssue({
        severity: "warn",
        kind: "mqtt_disconnected",
        message: "MQTT disconnected.",
      });
      writeStatus();
    });

    client.on("error", (err) => {
      mqttState.lastError = err?.message || "MQTT error";
      pushIssue({
        severity: "error",
        kind: "mqtt_error",
        message: toIssueMessage(err, "MQTT error."),
      });
      writeStatus();
    });

    client.on("message", async (topic, payload) => {
      try {
        const writePayload = parseMqttWriteMessage(topic, payload);
        if (!writePayload) return;
        await writeTagToPlc(writePayload);
      } catch (err) {
        mqttState.lastError = err?.message || "MQTT write handling failed.";
        pushIssue({
          severity: "error",
          kind: "mqtt_write_failed",
          message: toIssueMessage(err, "MQTT write handling failed."),
        });
      } finally {
        writeStatus();
      }
    });
  }

  const writeBridgeServer = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/internal/status") {
      if (OPC_SERVER_KEY) {
        const headerKey = String(req.headers["x-opc-key"] || "");
        if (headerKey !== OPC_SERVER_KEY) {
          writeJson(res, 401, { error: "Unauthorized." });
          return;
        }
      }
      writeJson(res, 200, pendingStatusPayload || {
        at: Date.now(),
        connected: Array.from(plcConnected.values()).every(Boolean),
        connections: Object.fromEntries(plcConnected.entries()),
        runtime: {
          plcTargets: (Array.isArray(plcs) ? plcs : []).map((p) => ({
            name: String(p?.name || "").trim(),
            host: String(p?.host || "").trim(),
            slot: Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0,
            connected: plcConnected.get(String(p?.name || "").trim()) === true,
          })),
          writeMetrics: { ...runtimeWriteMetrics },
        },
      });
      return;
    }
    if (req.method !== "POST" || req.url !== "/internal/write") {
      writeJson(res, 404, { error: "Not found." });
      return;
    }
    if (OPC_SERVER_KEY) {
      const headerKey = String(req.headers["x-opc-key"] || "");
      if (headerKey !== OPC_SERVER_KEY) {
        writeJson(res, 401, { error: "Unauthorized." });
        return;
      }
    }
    try {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk || "");
        if (body.length > 256000) req.destroy();
      });
      await new Promise((resolve, reject) => {
        req.on("end", resolve);
        req.on("error", reject);
      });
      const payload = body ? JSON.parse(body) : {};
      const tagKey = String(payload?.tagKey || "").trim();
      const legacyTagKey = String(payload?.legacyTagKey || "").trim();
      if (!tagKey && !legacyTagKey) {
        writeJson(res, 400, { error: "tagKey required." });
        return;
      }
      const result = await writeTagToPlc({
        tagKey,
        legacyTagKey,
        value: payload?.value,
      });
      if (!result.ok) {
        writeJson(res, result.status || 500, { error: result.error || "Write failed." });
        return;
      }
      writeJson(res, 200, result);
    } catch (err) {
      pushIssue({
        severity: "error",
        kind: "plc_write_bridge_error",
        message: toIssueMessage(err, "Write bridge error."),
      });
      writeJson(res, 500, { error: err?.message || "Write failed." });
    }
  });

  async function connectPlcWithRetry(name, plc) {
    const existing = plcReconnectInFlight.get(name);
    if (existing) return existing;
    const run = async () => {
    if (!opcConnectionEnabled) {
      plcConnected.set(name, false);
      return;
    }
    const recordTimeoutFailureAndMaybeRestart = (plcName, reason) => {
      if (!timeoutAutoRestartEnabled) return;
      const now = Date.now();
      const prev = plcTimeoutFailureWindow.get(plcName) || { startAt: now, count: 0 };
      const withinWindow = now - Number(prev.startAt || 0) <= timeoutAutoRestartWindowMs;
      const next = withinWindow
        ? { startAt: Number(prev.startAt || now), count: Number(prev.count || 0) + 1 }
        : { startAt: now, count: 1 };
      plcTimeoutFailureWindow.set(plcName, next);
      if (next.count < timeoutAutoRestartStreak) return;
      // eslint-disable-next-line no-console
      console.error(
        `[opc-server] PLC ${plcName} hit ${next.count} timeout-like failures in ${Math.round(
          (now - next.startAt) / 1000
        )}s. Restarting process to self-recover...`,
        reason
      );
      pushIssue({
        severity: "error",
        kind: "plc_timeout_auto_restart",
        plcName,
        message: `Auto-restart triggered after repeated timeout errors: ${toIssueMessage(reason)}`,
      });
      setTimeout(() => process.exit(73), 50);
    };
    const isForwardOpenError = (err) => {
      const msg = String(err?.message || err || "").toLowerCase();
      return msg.includes("forward open failed") || msg.includes("forward open");
    };
    let attempts = 0;
    while (true) {
      if (!opcConnectionEnabled) {
        plcConnected.set(name, false);
        return;
      }
      attempts += 1;
      try {
        // Keep connect handshakes bounded; restore steady-state receive timeout after connect.
        plc.timeoutReceive = plcConnectReceiveTimeoutMs;
        await plc.connect();
        plcConnected.set(name, true);
        plcInitialScanNeeded.set(name, true);
        plcHeartbeatFailureStreak.set(name, 0);
        plcConnectFailureStreak.set(name, 0);
        plcReadTransportFailureStreak.set(name, 0);
        plc.timeoutReceive = plcReceiveTimeoutMs;
        const warmupUntil = Date.now() + reconnectWarmupMs;
        plcReconnectWarmupUntil.set(name, warmupUntil);
        // eslint-disable-next-line no-console
        console.log(`Connected to PLC ${name}`);
        // eslint-disable-next-line no-console
        console.log(
          `[opc-server] PLC ${name} reconnect warmup active for ${Math.round(
            Math.max(0, warmupUntil - Date.now()) / 1000
          )}s.`
        );
        pushIssue({
          severity: "info",
          kind: "plc_connected",
          plcName: name,
          message: `Connected to PLC ${name}.`,
        });
        return;
      } catch (err) {
        plcConnected.set(name, false);
        const nextStreak = Number(plcConnectFailureStreak.get(name) || 0) + 1;
        plcConnectFailureStreak.set(name, nextStreak);
        try {
          await plc.close();
        } catch {
          // ignore close failures during reconnect
        }
        const forwardOpenFailure = isForwardOpenError(err);
        const timeoutLike = isTimeoutLikeError(err);
        if (timeoutLike) {
          recordTimeoutFailureAndMaybeRestart(name, err);
          recordConnectionFailure(name, err, "connect_retry");
          if (connectionGuardImmediateOnDisconnect) {
            activateConnectionGuard(name, err, "connect_retry_immediate");
          }
        }
        if (reconnectMaxAttempts && attempts >= reconnectMaxAttempts) {
          // eslint-disable-next-line no-console
          console.warn(`PLC ${name} connect failed after ${attempts} attempts.`, err?.message || err);
          pushIssue({
            severity: "error",
            kind: "plc_connect_failed",
            plcName: name,
            message: `Connect failed after ${attempts} attempts: ${toIssueMessage(err)}`,
          });
          return;
        }
        const retryDelayBase = forwardOpenFailure
          ? Math.max(10000, reconnectDelayMs * 2)
          : timeoutLike
          ? Math.max(5000, reconnectDelayMs * 2)
          : reconnectDelayMs;
        const retryDelayCap = forwardOpenFailure ? 60000 : timeoutLike ? 120000 : 30000;
        const retryDelay = Math.min(retryDelayCap, retryDelayBase * 2 ** Math.min(5, Math.max(0, nextStreak - 1)));
        const retryJitterMs = Math.min(5000, Math.round(retryDelay * 0.2 * Math.random()));
        const retryDelayWithJitter = retryDelay + retryJitterMs;
        if (forwardOpenFailure) {
          // eslint-disable-next-line no-console
          console.warn(
            `PLC ${name} rejected CIP Forward Open. Another client/session may be online (e.g. Studio 5000/RSLinx), or path/slot is wrong.`
          );
          pushIssue({
            severity: "error",
            kind: "plc_forward_open_failed",
            plcName: name,
            message:
              `PLC ${name} rejected Forward Open. Another client/session may already own it, or slot/path is wrong.`,
          });
        }
        // eslint-disable-next-line no-console
        console.warn(
          `PLC ${name} connect failed, retrying in ${retryDelayWithJitter}ms (streak ${nextStreak}, recvTimeout ${plc.timeoutReceive}ms)...`,
          err?.message || err
        );
        pushIssue({
          severity: "warn",
          kind: "plc_connect_retry",
          plcName: name,
          message: `Connect retry in ${retryDelayWithJitter}ms (streak ${nextStreak}): ${toIssueMessage(err)}`,
        });
        await sleep(retryDelayWithJitter);
      }
    }
    };
    const promise = run().finally(() => {
      plcReconnectInFlight.delete(name);
    });
    plcReconnectInFlight.set(name, promise);
    return promise;
  }

  plcs.forEach((p) => {
    const pool = [];
    for (let poolIdx = 0; poolIdx < plcConnectionPoolSize; poolIdx++) {
      // Primary slot keeps the plain PLC name so all existing status/heartbeat code is unaffected.
      const slotKey = poolIdx === 0 ? p.name : `${p.name}#${poolIdx}`;
      const plc = new PLC(p.host, {
        processorSlot: p.slot,
        connectTimeout: plcConnectTimeoutMs,
      });
      // node-logix receive timeout defaults to 15000ms; increase for slower/loaded PLC links.
      if (Number.isFinite(plcReceiveTimeoutMs) && plcReceiveTimeoutMs > 0) {
        plc.timeoutReceive = plcReceiveTimeoutMs;
      }
      plc.on("disconnect", (reason) => {
        plcConnected.set(slotKey, false);
        plcInitialScanNeeded.set(slotKey, true); // ensure full scan runs on next connect
        const text = String(reason?.message || reason || "unknown");
        const reconnecting = Boolean(plcReconnectInFlight.get(slotKey));
        if (reconnecting && text.toLowerCase().includes("close connection")) {
          // Expected during reconnect transitions; avoid noisy warning spam.
          // eslint-disable-next-line no-console
          console.log(`PLC ${p.name} (slot ${poolIdx}) connection reset during reconnect.`);
        } else {
          // eslint-disable-next-line no-console
          console.warn(`PLC ${p.name} (slot ${poolIdx}) disconnected.`, text);
          pushIssue({
            severity: "warn",
            kind: "plc_disconnected",
            plcName: p.name,
            message: `PLC ${p.name}${poolIdx > 0 ? ` slot ${poolIdx}` : ""} disconnected: ${text}`,
          });
        }
        if (isTimeoutLikeError(reason)) {
          const now = Date.now();
          const prev = plcTimeoutFailureWindow.get(p.name) || { startAt: now, count: 0 };
          const withinWindow = now - Number(prev.startAt || 0) <= timeoutAutoRestartWindowMs;
          const next = withinWindow
            ? { startAt: Number(prev.startAt || now), count: Number(prev.count || 0) + 1 }
            : { startAt: now, count: 1 };
          plcTimeoutFailureWindow.set(p.name, next);
          if (timeoutAutoRestartEnabled && next.count >= timeoutAutoRestartStreak) {
            // eslint-disable-next-line no-console
            console.error(
              `[opc-server] PLC ${p.name} disconnect timeout streak reached ${next.count}. Restarting process...`,
              text
            );
            setTimeout(() => process.exit(73), 50);
          }
          recordConnectionFailure(p.name, reason, "disconnect_event");
          if (connectionGuardImmediateOnDisconnect) {
            activateConnectionGuard(p.name, reason, "disconnect_event_immediate");
          }
        }
        if (opcConnectionEnabled) {
          void connectPlcWithRetry(slotKey, plc);
        }
      });
      plcClients.set(slotKey, plc);
      plcConnected.set(slotKey, false);
      plcPollInFlight.set(slotKey, false);
      plcReadCursor.set(slotKey, 0);
      plcDeferredReads.set(slotKey, 0);
      plcHeartbeatFailureStreak.set(slotKey, 0);
      plcConnectFailureStreak.set(slotKey, 0);
      plcReadTransportFailureStreak.set(slotKey, 0);
      plcReconnectWarmupUntil.set(slotKey, 0);
      plcWriteInFlight.set(p.name, 0);
      plcWriteQuietUntil.set(p.name, 0);
      slotKeyToPlcName.set(slotKey, p.name);
      pool.push({ slotKey, plc });
    }
    plcConnectionPools.set(p.name, pool);
  });

  if (opcConnectionEnabled) {
    Array.from(plcClients.entries()).forEach(([name, plc]) => {
      void connectPlcWithRetry(name, plc);
    });
  } else {
    // eslint-disable-next-line no-console
    console.log("OPC PLC connection is disabled (runtime.opcConnectionEnabled=false).");
  }

  async function closeAllPlcConnections() {
    await Promise.all(
      Array.from(plcClients.values()).map(async (plc) => {
        try {
          await plc.close();
        } catch {
          // ignore close failures
        }
      })
    );
    plcConnected.forEach((_, key) => {
      plcConnected.set(key, false);
    });
  }

  setInterval(async () => {
    try {
      const latest = await loadConfig();
      const nextEnabled = latest?.runtime?.opcConnectionEnabled !== false;
      if (nextEnabled === opcConnectionEnabled) return;
      opcConnectionEnabled = nextEnabled;
      if (!opcConnectionEnabled) {
        // eslint-disable-next-line no-console
        console.log("OPC PLC connection disabled at runtime. Closing PLC connections.");
        pushIssue({
          severity: "warn",
          kind: "opc_runtime_disabled",
          message: "OPC PLC connection disabled at runtime.",
        });
        await closeAllPlcConnections();
      } else {
        // eslint-disable-next-line no-console
        console.log("OPC PLC connection enabled at runtime. Reconnecting PLC clients.");
        pushIssue({
          severity: "info",
          kind: "opc_runtime_enabled",
          message: "OPC PLC connection enabled at runtime. Reconnecting PLC clients.",
        });
      }
      writeStatus();
    } catch {
      // ignore runtime toggle read failures
    }
  }, 15000);

  void refreshPriorityHintsFromAi(true);
  setInterval(() => {
    void refreshPriorityHintsFromAi();
  }, priorityRefreshMs);
  setInterval(() => {
    maybeRecoverConnectionGuard();
  }, 5000);

  let lastRestartSeen = 0;
  setInterval(() => {
    try {
      if (!fs.existsSync(RESTART_PATH)) return;
      const stat = fs.statSync(RESTART_PATH);
      const ts = stat.mtimeMs || 0;
      if (ts && ts <= lastRestartSeen) return;
      lastRestartSeen = ts;
      try {
        const raw = fs.readFileSync(RESTART_PATH, "utf-8");
        const data = JSON.parse(raw);
        if (data?.at) {
          // eslint-disable-next-line no-console
          console.log(`Restart requested at ${new Date(data.at).toISOString()}`);
        }
      } catch {
        // ignore
      }
      try {
        fs.unlinkSync(RESTART_PATH);
      } catch {
        // ignore
      }
      // eslint-disable-next-line no-console
      console.log("Restart requested. Shutting down OPC server...");
      pushIssue({
        severity: "warn",
        kind: "opc_restart_requested",
        message: "Restart requested. Shutting down OPC server.",
      });
      process.exit(0);
    } catch {
      // ignore
    }
  }, 1000);

  const tagsByPlc = new Map();
  tagsWithMeta.forEach((t) => {
    if (!tagsByPlc.has(t.plcName)) tagsByPlc.set(t.plcName, []);
    tagsByPlc.get(t.plcName).push(t);
  });

  // Distribute tags across pool slots (round-robin by index so consecutive tags stay together
  // in each slot for better cache locality). slotTagsMap drives the poll loops below.
  const slotTagsMap = new Map(); // slotKey â†’ tags[]
  tagsByPlc.forEach((plcTags, plcName) => {
    const pool = plcConnectionPools.get(plcName) || [];
    if (pool.length <= 1) {
      const slotKey = pool[0]?.slotKey ?? plcName;
      slotTagsMap.set(slotKey, plcTags);
    } else {
      pool.forEach(({ slotKey }, poolIdx) => {
        const slotTags = plcTags.filter((_, i) => i % pool.length === poolIdx);
        if (slotTags.length) slotTagsMap.set(slotKey, slotTags);
      });
    }
  });

  async function flushStatusPublishQueue() {
    if (statusPublishInFlight) return;
    statusPublishInFlight = true;
    try {
      while (pendingStatusPayload) {
        const payload = pendingStatusPayload;
        pendingStatusPayload = null;
        const headers = { "content-type": "application/json" };
        if (OPC_SERVER_KEY) headers["x-opc-key"] = OPC_SERVER_KEY;
        const response = await fetch(`${AI_SERVER_URL.replace(/\/$/, "")}/api/opc/status`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          const bodyText = await response.text().catch(() => "");
          pendingStatusPayload = pendingStatusPayload || payload;
          throw new Error(
            `AI status publish failed (${response.status}${bodyText ? `: ${bodyText.slice(0, 300)}` : ""})`
          );
        }
      }
    } catch (err) {
      pushIssue({
        severity: "error",
        kind: "status_publish_failed",
        message: toIssueMessage(err, "Failed to publish OPC status to AI server."),
      });
    } finally {
      statusPublishInFlight = false;
    }
  }

  function writeStatus() {
    if (writeStatusDebounceTimer) return;
    writeStatusDebounceTimer = setTimeout(() => {
      writeStatusDebounceTimer = null;
      _writeStatusNow();
    }, WRITE_STATUS_DEBOUNCE_MS);
  }

  function _writeStatusNow() {
    try {
      const snapshot = {};
      const errors = {};
      const qualities = {};
      const diagnostics = {};
      tagsWithMeta.forEach((t) => {
        const value = tagValues.get(t.tagKey);
        const errorCount = tagErrors.get(t.tagKey);
        const quality = tagQuality.get(t.tagKey) || "Unknown";
        const diagnostic = {
          topic: t.topic,
          name: t.name,
          tagPath: t.tagPath || t.name,
          plcName: t.plcName,
          muted: t.muted === true,
          deadband: t.deadband ?? null,
          errorStreak: tagErrorStreak.get(t.tagKey) || 0,
          effectiveIntervalMs: tagEffectiveInterval.get(t.tagKey) || null,
          lastReadAt: tagLastRead.get(t.tagKey) || null,
          lastSuccessAt: tagLastSuccessAt.get(t.tagKey) || null,
          lastErrorAt: tagLastErrorAt.get(t.tagKey) || null,
          lastErrorMessage: tagLastErrorMessage.get(t.tagKey) || "",
          nextDueAt: tagNextDueAt.get(t.tagKey) || null,
          readCount: tagReadCount.get(t.tagKey) || 0,
          readSuccessCount: tagReadSuccessCount.get(t.tagKey) || 0,
          readErrorCount: tagReadErrorCount.get(t.tagKey) || 0,
          lastReadDurationMs: tagLastReadDurationMs.get(t.tagKey) ?? null,
          avgReadDurationMs:
            (tagReadCount.get(t.tagKey) || 0) > 0
              ? Math.round((tagReadDurationTotalMs.get(t.tagKey) || 0) / (tagReadCount.get(t.tagKey) || 1))
              : null,
          maxReadDurationMs: tagReadDurationMaxMs.get(t.tagKey) || null,
        };
        snapshot[t.tagKey] = value;
        qualities[t.tagKey] = quality;
        diagnostics[t.tagKey] = diagnostic;
        if (tagErrors.has(t.tagKey)) errors[t.tagKey] = errorCount;
        if (t.legacyTagKey && t.legacyTagKey !== t.tagKey) {
          snapshot[t.legacyTagKey] = value;
          qualities[t.legacyTagKey] = quality;
          diagnostics[t.legacyTagKey] = diagnostic;
          if (tagErrors.has(t.tagKey)) errors[t.legacyTagKey] = errorCount;
        }
      });
      const allConnected = plcs.every((p) => plcConnected.get(p.name) === true);
      const lastPollAt = Math.max(0, ...Array.from(plcLastPollAt.values()), 0);
      pendingStatusPayload = {
        at: Date.now(),
        connected: allConnected,
        connections: Object.fromEntries(plcConnected.entries()),
        lastPollAt: lastPollAt || null,
        values: snapshot,
        errors,
        qualities,
        diagnostics,
        runtime: {
          opcConnectionEnabled,
          adaptiveThroughputTuning,
          vpnMode,
          activeTagCount,
          multiReadEnabled,
          multiReadConfigured,
          multiReadBatchSize,
          multiReadConcurrency,
          multiReadRetryCount,
          multiReadFailureStreak,
          multiReadDisabledUntilMs: multiReadEnabled ? null : (multiReadDisabledUntilMs || null),
          maxReadsPerTick,
          initialScanBurstLimit,
          transportBadStreakThreshold,
          mqttEnabled: mqttState.enabled,
          mqttConnected: mqttState.connected,
          mqttBrokerUrl,
          mqttStatusTopic,
          mqttWriteTopic,
          mqttQos,
          mqttRetain,
          mqttLastError: mqttState.lastError || "",
          plcConnectionPool: plcConnectionPoolSize,
          readConcurrency,
          readTimeoutMs,
          readRetryCount,
          readRetryDelayMs,
          connectionGuardImmediateOnDisconnect,
          reconnectWarmupMs,
          reconnectWarmupReadsPerTick,
          reconnectWarmupReadConcurrency,
          reconnectWarmupMultiReadBatchSize,
          reconnectWarmupDisableMultiRead,
          priorityRefreshMs,
          priorityTagPollMs,
          priorityKeyCap,
          priorityHintKeyCount: priorityKeySetLower.size,
          priorityHintsUpdatedAt: priorityKeysUpdatedAt || null,
          priorityHintsLastNonEmptyAt: priorityKeysLastNonEmptyAt || null,
          priorityHintsSource: priorityKeysSource || "",
          priorityHintsError: priorityKeysLastError || "",
          uiScopedReadsEnabled,
          uiScopedReadsStaleMs,
          uiScopedReadsHoldMs,
          uiScopedReadsActive: uiScopedReadsEnabled ? hasActivePriorityScope() : false,
          writePriorityEnabled,
          writeQuietMs,
          writeMetrics: { ...runtimeWriteMetrics },
          writePausedPlcCount: (Array.isArray(plcs) ? plcs : []).reduce(
            (count, plcTarget) =>
              count +
              (isPlcReadPausedForWrite(String(plcTarget?.name || "").trim(), Date.now()) ? 1 : 0),
            0
          ),
          errorBackoffEnabled,
          errorBackoffBaseMs,
          errorBackoffMaxMs,
          errorBackoffThreshold,
          pollJitterMs,
          deadbandDefault,
          reconnectDelayMs,
          reconnectMaxAttempts,
          connectionGuardEnabled,
          connectionGuardModeActive,
          connectionGuardActivatedAt: connectionGuardActivatedAt || null,
          connectionGuardUntilMs: connectionGuardModeActive ? (connectionGuardUntilMs || null) : null,
          connectionGuardLastFailureAt: connectionGuardLastFailureAt || null,
          connectionGuardFailureStreak,
          connectionGuardWindowMs,
          connectionGuardCooldownMs,
          connectionGuardRecoverAfterMs,
          connectionGuardMaxReadsPerTick,
          connectionGuardReadConcurrency,
          connectionGuardMultiReadBatchSize,
          connectionGuardInitialScanBurstLimit,
          connectionGuardReceiveTimeoutMs,
          connectionGuardFailureWindowByPlc: Object.fromEntries(connectionGuardFailureWindowByPlc.entries()),
          heartbeatEnabled,
          heartbeatReconnectOnFailure,
          heartbeatFailureThreshold,
          plcConnectTimeoutMs,
          plcConnectReceiveTimeoutMs,
          plcReceiveTimeoutMs,
          heartbeatMs,
          lastPollAtByPlc: Object.fromEntries(plcLastPollAt.entries()),
          deferredReadsByPlc: Object.fromEntries(plcDeferredReads.entries()),
          transportFailureStreakByPlc: Object.fromEntries(plcReadTransportFailureStreak.entries()),
          heartbeatFailureStreakByPlc: Object.fromEntries(plcHeartbeatFailureStreak.entries()),
          connectFailureStreakByPlc: Object.fromEntries(plcConnectFailureStreak.entries()),
          timeoutFailureWindowByPlc: Object.fromEntries(plcTimeoutFailureWindow.entries()),
          issueCount: issueLog.length,
          issueLog: issueLog.slice(0, 200),
          plcTargets: (Array.isArray(plcs) ? plcs : []).map((p) => {
            const name = String(p?.name || "").trim();
            return {
              name,
              host: String(p?.host || "").trim(),
              slot: Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0,
              connected: name ? plcConnected.get(name) === true : false,
              connectFailureStreak: name ? Number(plcConnectFailureStreak.get(name) || 0) : 0,
              heartbeatFailureStreak: name ? Number(plcHeartbeatFailureStreak.get(name) || 0) : 0,
            };
          }),
        },
      };
      if (mqttState.enabled && mqttState.connected && mqttState.client && mqttStatusTopic) {
        try {
          mqttState.client.publish(
            mqttStatusTopic,
            JSON.stringify(pendingStatusPayload),
            { qos: mqttQos, retain: mqttRetain }
          );
        } catch (err) {
          pushIssue({
            severity: "error",
            kind: "mqtt_status_publish_failed",
            message: toIssueMessage(err, "Failed to publish OPC status via MQTT."),
          });
        }
      }
      void flushStatusPublishQueue();
    } catch {
      // ignore status write errors
    }
  }

  slotTagsMap.forEach((slotTags, slotKey) => {
    const plcName = slotKeyToPlcName.get(slotKey) || slotKey; // used for display/logging only
    const plc = plcClients.get(slotKey);
    const isPriorityTag = (tag) => {
      if (!(priorityKeySetLower instanceof Set) || !priorityKeySetLower.size) return false;
      const lookup = tag?.priorityLookupKeys instanceof Set ? tag.priorityLookupKeys : null;
      if (!lookup || !lookup.size) return false;
      for (const key of lookup) {
        if (priorityKeySetLower.has(key)) return true;
      }
      return false;
    };
    const shouldRetryReadError = (err) => {
      const msg = String(err?.message || err || "").toLowerCase();
      if (!msg) return false;
      return (
        msg.includes("timeout") ||
        msg.includes("timeout-recv-data") ||
        msg.includes("recv-data") ||
        msg.includes("disconnected") ||
        msg.includes("connection lost") ||
        msg.includes("socket hang up") ||
        msg.includes("econnreset") ||
        msg.includes("econnaborted") ||
        msg.includes("econnrefused") ||
        msg.includes("broken pipe") ||
        msg.includes("write eof") ||
        msg.includes("ehostunreach") ||
        msg.includes("pool is draining") ||
        msg.includes("cannot accept work")
      );
    };
    const noteTransportReadFailure = (err) => {
      if (!shouldRetryReadError(err)) return;
      recordConnectionFailure(plcName, err, "read_transport");
      const next = Number(plcReadTransportFailureStreak.get(slotKey) || 0) + 1;
      plcReadTransportFailureStreak.set(slotKey, next);
      if (next < readReconnectErrorThreshold) return;
      if (plcReconnectInFlight.get(slotKey)) return;
      plcConnected.set(slotKey, false);
      // eslint-disable-next-line no-console
      console.warn(
        `PLC ${plcName} transport read failures reached ${next}/${readReconnectErrorThreshold}; reconnecting...`
      );
      pushIssue({
        severity: "error",
        kind: "plc_transport_failures",
        plcName,
        message: `Transport read failures reached ${next}/${readReconnectErrorThreshold}; reconnecting PLC.`,
      });
      void connectPlcWithRetry(slotKey, plc);
    };
    async function readWithTimeout(tagPath) {
      const attempts = 1 + Math.max(0, Number(readRetryCount) || 0);
      let lastErr = null;
      for (let i = 0; i < attempts; i += 1) {
        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Read timeout after ${readTimeoutMs}ms`)), readTimeoutMs);
          });
          return await Promise.race([plc.read(tagPath), timeoutPromise]);
        } catch (err) {
          lastErr = err;
          if (i >= attempts - 1 || !shouldRetryReadError(err)) break;
          if (readRetryDelayMs > 0) await sleep(readRetryDelayMs);
        }
      }
      throw lastErr || new Error("Read failed.");
    }

    async function multiReadWithTimeout(tagPaths) {
      const attempts = 1 + Math.max(0, Number(multiReadRetryCount) || 0);
      let lastErr = null;
      for (let i = 0; i < attempts; i += 1) {
        try {
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Multi-read timeout after ${readTimeoutMs}ms`)), readTimeoutMs);
          });
          return await Promise.race([plc.multiRead(tagPaths), timeoutPromise]);
        } catch (err) {
          lastErr = err;
          if (i >= attempts - 1 || !shouldRetryReadError(err)) break;
          if (readRetryDelayMs > 0) await sleep(readRetryDelayMs);
        }
      }
      throw lastErr || new Error("Multi-read failed.");
    }

    function nextJitter() {
      return pollJitterMs > 0 ? Math.floor(Math.random() * (pollJitterMs + 1)) : 0;
    }

    function baseIntervalFor(tag) {
      const configuredInterval = parsePositiveMs(
        tag.samplingInterval,
        parsePositiveMs(tag.pollMs, globalPollMs)
      );
      if (!(priorityKeySetLower instanceof Set) || !priorityKeySetLower.size) return configuredInterval;
      const lookup = tag?.priorityLookupKeys instanceof Set ? tag.priorityLookupKeys : null;
      if (!lookup || !lookup.size) return configuredInterval;
      for (const key of lookup) {
        if (priorityKeySetLower.has(key)) {
          return Math.min(configuredInterval, priorityTagPollMs);
        }
      }
      return configuredInterval;
    }

    function markTagSuccess(tag, value, now, durationMs, baseInterval) {
      const readCount = (tagReadCount.get(tag.tagKey) || 0) + 1;
      const successCount = (tagReadSuccessCount.get(tag.tagKey) || 0) + 1;
      const totalMs = (tagReadDurationTotalMs.get(tag.tagKey) || 0) + durationMs;
      const maxMs = Math.max(tagReadDurationMaxMs.get(tag.tagKey) || 0, durationMs);
      tagReadCount.set(tag.tagKey, readCount);
      tagReadSuccessCount.set(tag.tagKey, successCount);
      tagReadDurationTotalMs.set(tag.tagKey, totalMs);
      tagReadDurationMaxMs.set(tag.tagKey, maxMs);
      tagLastReadDurationMs.set(tag.tagKey, durationMs);
      const prev = tagValues.get(tag.tagKey);
      const deadband = parseNonNegativeNumber(tag.deadband, deadbandDefault);
      let shouldUpdateValue = true;
      if (deadband != null && isNumericLiveValue(prev) && isNumericLiveValue(value)) {
        const prevNum = Number(prev);
        const nextNum = Number(value);
        shouldUpdateValue = Math.abs(nextNum - prevNum) >= deadband;
      }
      if (shouldUpdateValue) tagValues.set(tag.tagKey, value);
      tagErrors.delete(tag.tagKey);
      tagErrorStreak.set(tag.tagKey, 0);
      tagQuality.set(tag.tagKey, "Good");
      tagLastErrorMessage.set(tag.tagKey, "");
      tagLastRead.set(tag.tagKey, now);
      tagLastSuccessAt.set(tag.tagKey, now);
      tagEffectiveInterval.set(tag.tagKey, baseInterval);
      tagNextDueAt.set(tag.tagKey, now + baseInterval + nextJitter());
    }

    function markTagError(tag, now, durationMs, baseInterval, err) {
      const readCount = (tagReadCount.get(tag.tagKey) || 0) + 1;
      const errorReadCount = (tagReadErrorCount.get(tag.tagKey) || 0) + 1;
      const totalMs = (tagReadDurationTotalMs.get(tag.tagKey) || 0) + durationMs;
      const maxMs = Math.max(tagReadDurationMaxMs.get(tag.tagKey) || 0, durationMs);
      tagReadCount.set(tag.tagKey, readCount);
      tagReadErrorCount.set(tag.tagKey, errorReadCount);
      tagReadDurationTotalMs.set(tag.tagKey, totalMs);
      tagReadDurationMaxMs.set(tag.tagKey, maxMs);
      tagLastReadDurationMs.set(tag.tagKey, durationMs);
      const prev = tagErrors.get(tag.tagKey) || 0;
      const prevMessage = String(tagLastErrorMessage.get(tag.tagKey) || "");
      tagErrors.set(tag.tagKey, prev + 1);
      const streak = (tagErrorStreak.get(tag.tagKey) || 0) + 1;
      tagErrorStreak.set(tag.tagKey, streak);
      const transportLike = shouldRetryReadError(err);
      if (transportLike) {
        tagQuality.set(
          tag.tagKey,
          streak >= transportBadStreakThreshold ? "Bad" : "Unknown"
        );
      } else {
        tagQuality.set(tag.tagKey, "Bad");
      }
      tagLastErrorAt.set(tag.tagKey, now);
      const errMessage = toIssueMessage(err, "Read failed.");
      tagLastErrorMessage.set(tag.tagKey, errMessage);
      if (streak === 1 || errMessage !== prevMessage || streak % 10 === 0) {
        pushIssue({
          severity: "error",
          kind: "tag_read_error",
          plcName,
          tagKey: tag.tagKey,
          message: `${tag.tagKey} read failed (streak ${streak}): ${errMessage}`,
        });
      }
      let backoffMs = 0;
      if (errorBackoffEnabled && streak >= errorBackoffThreshold) {
        const exp = Math.max(0, streak - errorBackoffThreshold);
        backoffMs = Math.min(errorBackoffMaxMs, errorBackoffBaseMs * 2 ** exp);
      }
      tagEffectiveInterval.set(tag.tagKey, baseInterval + backoffMs);
      tagNextDueAt.set(tag.tagKey, now + baseInterval + backoffMs + nextJitter());
      tagLastRead.set(tag.tagKey, now);
    }

    const tickMs = Math.max(
      100,
      Math.min(
        priorityTagPollMs,
        ...slotTags.map((t) => parsePositiveMs(t.samplingInterval, globalPollMs))
      )
    );
    setInterval(async () => {
      if (!opcConnectionEnabled) {
        writeStatus();
        return;
      }
      if (!plcConnected.get(slotKey)) return;
      const now = Date.now();
      if (isPlcReadPausedForWrite(plcName, now)) {
        writeStatus();
        return;
      }
      if (plcPollInFlight.get(slotKey)) return;
      plcPollInFlight.set(slotKey, true);
      const priorityScopeActive = hasActivePriorityScope(now);
      maybeReenableMultiRead(plcName);
      let didRead = false;
      try {
        let dueForRead = [];
        for (const tag of slotTags) {
          if (uiScopedReadsEnabled) {
            if (!priorityScopeActive) continue;
            if (!isPriorityTag(tag)) continue;
          }
          const baseInterval = baseIntervalFor(tag);
          const dueAt = tagNextDueAt.get(tag.tagKey) || 0;
          if (now < dueAt) continue;

          if (tag.muted === true) {
            tagQuality.set(tag.tagKey, "Muted");
            tagEffectiveInterval.set(tag.tagKey, baseInterval);
            tagLastRead.set(tag.tagKey, now);
            tagNextDueAt.set(tag.tagKey, now + baseInterval + nextJitter());
            continue;
          }
          dueForRead.push({ tag, baseInterval });
        }
        if (priorityKeySetLower.size > 0 && dueForRead.length > 1) {
          const priorityItems = [];
          const normalItems = [];
          for (const item of dueForRead) {
            if (isPriorityTag(item.tag)) priorityItems.push(item);
            else normalItems.push(item);
          }
          if (priorityItems.length && normalItems.length) {
            dueForRead = priorityItems.concat(normalItems);
          }
        }

        // Keep initial scans bounded so high tag counts do not burst and timeout.
        const isInitialScan = Boolean(plcInitialScanNeeded.get(slotKey));
        if (isInitialScan) plcInitialScanNeeded.set(slotKey, false);
        let perTickLimit = isInitialScan
          ? Math.max(1, Math.min(initialScanBurstLimit, maxReadsPerTick))
          : maxReadsPerTick;
        const warmupUntil = Number(plcReconnectWarmupUntil.get(slotKey) || 0);
        const inReconnectWarmup = warmupUntil > now;
        if (inReconnectWarmup) {
          perTickLimit = Math.min(perTickLimit, reconnectWarmupReadsPerTick);
        }
        const effectiveReadConcurrency = inReconnectWarmup
          ? Math.max(1, Math.min(readConcurrency, reconnectWarmupReadConcurrency))
          : readConcurrency;
        const effectiveMultiReadBatchSize = inReconnectWarmup
          ? Math.max(1, Math.min(multiReadBatchSize, reconnectWarmupMultiReadBatchSize))
          : multiReadBatchSize;
        const useMultiReadThisTick =
          multiReadEnabled && (!inReconnectWarmup || !reconnectWarmupDisableMultiRead);

        let scheduled = dueForRead;
        if (dueForRead.length > perTickLimit) {
          const cursor = Number(plcReadCursor.get(slotKey) || 0) % dueForRead.length;
          const rotated = dueForRead.slice(cursor).concat(dueForRead.slice(0, cursor));
          scheduled = rotated.slice(0, perTickLimit);
          plcReadCursor.set(slotKey, (cursor + perTickLimit) % dueForRead.length);
          plcDeferredReads.set(slotKey, dueForRead.length - scheduled.length);
        } else {
          plcReadCursor.set(slotKey, 0);
          plcDeferredReads.set(slotKey, 0);
        }

        // Transport failures are counted once per tick (not once per failing batch/tag)
        // so that concurrent workers don't multiply the streak and trigger spurious reconnects.
        let tickTransportError = null;
        let tickMultiReadError = null;

        if (useMultiReadThisTick && scheduled.length > 1) {
          // Split into batches then run up to multiReadConcurrency batches concurrently.
          const batches = [];
          for (let idx = 0; idx < scheduled.length; idx += effectiveMultiReadBatchSize) {
            batches.push(scheduled.slice(idx, idx + effectiveMultiReadBatchSize));
          }
          let batchIdx = 0;
          let anyRead = false;
          const runBatchWorker = async () => {
            while (batchIdx < batches.length) {
              const batch = batches[batchIdx++];
              const tagPaths = batch.map(({ tag }) => tag.tagPath || tag.name);
              const readStartedAt = Date.now();
              try {
                const responses = await multiReadWithTimeout(tagPaths);
                const durationMs = Math.max(0, Date.now() - readStartedAt);
                const eachDurationMs = Math.max(1, Math.round(durationMs / Math.max(1, batch.length)));
                const responseByName = new Map();
                (Array.isArray(responses) ? responses : []).forEach((resp) => {
                  const key = String(resp?.tag_name || "").trim();
                  if (key) responseByName.set(key, resp);
                });
                for (const item of batch) {
                  const path = String(item.tag.tagPath || item.tag.name).trim();
                  const resp = responseByName.get(path);
                  if (resp && Number(resp.status || 0) === 0 && resp.value != null) {
                    markTagSuccess(item.tag, resp.value, now, eachDurationMs, item.baseInterval);
                    anyRead = true;
                  } else {
                    const err = new Error(resp?.message || "Multi-read returned no data.");
                    markTagError(item.tag, now, eachDurationMs, item.baseInterval, err);
                  }
                }
              } catch (batchErr) {
                if (shouldRetryReadError(batchErr)) {
                  // Transport/session error: individual reads will all fail too (session is down).
                  // Record once per tick â€” don't increment streak for every failing batch.
                  tickTransportError = tickTransportError || batchErr;
                  tickMultiReadError = tickMultiReadError || batchErr;
                  for (const item of batch) {
                    markTagError(item.tag, now, 0, item.baseInterval, batchErr);
                  }
                } else {
                  // Non-transport error (e.g. service not supported): fall back to individual reads
                  // run concurrently so the fallback doesn't serialize 20 tags one by one.
                  let fbIdx = 0;
                  const runFallback = async () => {
                    while (fbIdx < batch.length) {
                      const item = batch[fbIdx++];
                      const singleStartedAt = Date.now();
                      try {
                        const value = await readWithTimeout(item.tag.tagPath || item.tag.name);
                        if (value == null) throw new Error("Read returned no data (null/undefined).");
                        const singleDuration = Math.max(0, Date.now() - singleStartedAt);
                        markTagSuccess(item.tag, value, now, singleDuration, item.baseInterval);
                        anyRead = true;
                      } catch (err) {
                        const singleDuration = Math.max(0, Date.now() - singleStartedAt);
                        if (shouldRetryReadError(err)) tickTransportError = tickTransportError || err;
                        markTagError(item.tag, now, singleDuration, item.baseInterval, err || batchErr);
                      }
                    }
                  };
                  await Promise.all(
                    Array.from({ length: Math.min(effectiveReadConcurrency, batch.length) }, runFallback)
                  );
                }
              }
            }
          };
          const batchWorkers = Array.from(
            { length: Math.min(multiReadConcurrency, batches.length) },
            runBatchWorker
          );
          await Promise.all(batchWorkers);
          // Only blame multi-read if the error was NOT a full transport disconnect.
          // Transport errors (PLC dropped, timeout-recv-data) are connection-level, not
          // caused by multi-read, so don't disable multi-read on reconnect.
          if (tickMultiReadError && !tickTransportError) noteMultiReadFailure(tickMultiReadError, plcName);
          else if (anyRead) noteMultiReadSuccess();
          if (anyRead) didRead = true;
        } else {
          // Run individual reads concurrently up to readConcurrency at a time.
          // This is much faster than sequential without the CIP-session instability of multiRead.
          let schedIdx = 0;
          let anyRead = false;
          const runWorker = async () => {
            while (schedIdx < scheduled.length) {
              const item = scheduled[schedIdx++];
              const readStartedAt = Date.now();
              try {
                const value = await readWithTimeout(item.tag.tagPath || item.tag.name);
                if (value == null) throw new Error("Read returned no data (null/undefined).");
                const durationMs = Math.max(0, Date.now() - readStartedAt);
                markTagSuccess(item.tag, value, now, durationMs, item.baseInterval);
                anyRead = true;
              } catch (err) {
                const durationMs = Math.max(0, Date.now() - readStartedAt);
                markTagError(item.tag, now, durationMs, item.baseInterval, err);
                if (shouldRetryReadError(err)) tickTransportError = tickTransportError || err;
              }
            }
          };
          const workers = Array.from({ length: Math.min(effectiveReadConcurrency, scheduled.length) }, runWorker);
          await Promise.all(workers);
          if (anyRead) didRead = true;
        }

        // Count at most ONE transport failure per poll tick regardless of concurrent batch count.
        if (tickTransportError) noteTransportReadFailure(tickTransportError);
      } finally {
        plcPollInFlight.set(slotKey, false);
      }
      if (didRead) {
        plcLastPollAt.set(slotKey, now);
        plcHeartbeatFailureStreak.set(slotKey, 0);
        plcReadTransportFailureStreak.set(slotKey, 0);
      }
      writeStatus();
    }, tickMs);
  });

  plcClients.forEach((plc, slotKey) => {
    const plcName = slotKeyToPlcName.get(slotKey) || slotKey;
    setInterval(async () => {
      if (!heartbeatEnabled) return;
      if (!opcConnectionEnabled) {
        plcConnected.set(slotKey, false);
        writeStatus();
        return;
      }
      try {
        if (plcReconnectInFlight.get(slotKey)) return;
        if (!plcConnected.get(slotKey)) {
          void connectPlcWithRetry(slotKey, plc);
          return;
        }
        const now = Date.now();
        if (isPlcReadPausedForWrite(plcName, now)) return;
        const lastReadAt = Number(plcLastPollAt.get(slotKey) || 0);
        // Skip heartbeat read if normal polling has already read this slot recently.
        if (lastReadAt > 0 && now - lastReadAt < Math.max(heartbeatMs, readTimeoutMs * 2)) {
          return;
        }
        if (plcPollInFlight.get(slotKey)) return;
        const firstActiveTag = (slotTagsMap.get(slotKey) || tagsByPlc.get(plcName) || []).find((t) => t?.muted !== true);
        // If all PLC tags are muted, skip heartbeat read to reduce traffic.
        if (!firstActiveTag) return;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Heartbeat timeout after ${readTimeoutMs}ms`)), readTimeoutMs);
        });
        await Promise.race([plc.read(firstActiveTag.tagPath || firstActiveTag.name), timeoutPromise]);
        plcHeartbeatFailureStreak.set(slotKey, 0);
      } catch (err) {
        recordConnectionFailure(plcName, err, "heartbeat");
        const nextStreak = Number(plcHeartbeatFailureStreak.get(slotKey) || 0) + 1;
        plcHeartbeatFailureStreak.set(slotKey, nextStreak);
        if (nextStreak < heartbeatFailureThreshold) {
          // eslint-disable-next-line no-console
          console.warn(
            `PLC ${plcName} heartbeat transient failure ${nextStreak}/${heartbeatFailureThreshold}.`,
            err?.message || err
          );
          pushIssue({
            severity: "warn",
            kind: "plc_heartbeat_transient_failure",
            plcName,
            message: `Heartbeat transient failure ${nextStreak}/${heartbeatFailureThreshold}: ${toIssueMessage(err)}`,
          });
          return;
        }
        if (heartbeatReconnectOnFailure) {
          plcConnected.set(slotKey, false);
          void connectPlcWithRetry(slotKey, plc);
          // eslint-disable-next-line no-console
          console.warn(`PLC ${plcName} heartbeat failed (threshold reached, reconnecting).`, err?.message || err);
          pushIssue({
            severity: "error",
            kind: "plc_heartbeat_failed_reconnecting",
            plcName,
            message: `Heartbeat failed (${nextStreak}/${heartbeatFailureThreshold}); reconnecting: ${toIssueMessage(err)}`,
          });
        } else {
          // eslint-disable-next-line no-console
          console.warn(`PLC ${plcName} heartbeat failed (threshold reached, keeping session).`, err?.message || err);
          pushIssue({
            severity: "error",
            kind: "plc_heartbeat_failed_non_disruptive",
            plcName,
            message: `Heartbeat failed (${nextStreak}/${heartbeatFailureThreshold}); keeping existing session: ${toIssueMessage(err)}`,
          });
          plcHeartbeatFailureStreak.set(slotKey, 0);
        }
      } finally {
        writeStatus();
      }
    }, heartbeatMs);
  });

  writeStatus();
  startMqttBridge();

  await server.start();

  writeBridgeServer.listen(OPC_WRITE_BRIDGE_PORT, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`OPC write bridge listening on http://127.0.0.1:${OPC_WRITE_BRIDGE_PORT}`);
  });
  const endpoint = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
  // eslint-disable-next-line no-console
  console.log(`OPC UA Server listening at ${endpoint}`);
  // eslint-disable-next-line no-console
  console.log(
    `OPC UA security: allowAnonymous=${allowAnonymous} modes=${securityModes
      .map((m) => MessageSecurityMode[m] || String(m))
      .join(",")} policies=${securityPolicies
      .map((p) => SecurityPolicy[p] || String(p))
      .join(",")}`
  );
  if (hasUserCredentials) {
    // eslint-disable-next-line no-console
    console.log(`OPC UA username authentication enabled for user "${OPCUA_USERNAME}".`);
  }

  process.on("SIGINT", async () => {
    try {
      if (mqttState.client) {
        mqttState.client.end(true);
      }
    } catch {
      // ignore
    }
    try {
      await server.shutdown(1000);
    } catch {
      // ignore
    }
    process.exit(0);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (String(err?.code || "") === "EADDRINUSE") {
    // Distinct exit code so watchdog can avoid restart loops on hard port conflicts.
    process.exit(72);
    return;
  }
  process.exit(1);
});
