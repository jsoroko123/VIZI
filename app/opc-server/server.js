import fs from "fs";
import path from "path";
import process from "process";
import {
  OPCUAServer,
  Variant,
  DataType,
  StatusCodes,
} from "node-opcua";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const PLC = require("node-logix").default;

const AI_SERVER_URL = process.env.AI_SERVER_URL || "http://localhost:5055";
const OPC_SERVER_KEY = process.env.OPC_SERVER_KEY || "";
const RESTART_PATH = path.resolve(process.cwd(), "restart.requested");

async function loadConfig() {
  try {
    const headers = OPC_SERVER_KEY ? { "x-opc-key": OPC_SERVER_KEY } : undefined;
    const res = await fetch(`${AI_SERVER_URL.replace(/\/$/, "")}/api/opc/config`, { headers });
    if (res.ok) {
      return await res.json();
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Failed to load config (status ${res.status}).`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err?.message || "Failed to load config from database.");
    process.exit(1);
  }
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

async function main() {
  const config = await loadConfig();
  const runtime = config?.runtime || {};
  const readTimeoutMs = parsePositiveMs(runtime?.readTimeoutMs, 2000);
  const errorBackoffEnabled = runtime?.errorBackoffEnabled !== false;
  const errorBackoffBaseMs = parsePositiveMs(runtime?.errorBackoffBaseMs, 1000);
  const errorBackoffMaxMs = parsePositiveMs(runtime?.errorBackoffMaxMs, 15000);
  const errorBackoffThreshold = Math.max(1, Math.round(parsePositiveNumber(runtime?.errorBackoffThreshold, 3)));
  const pollJitterMs = Math.max(0, Math.round(parseNonNegativeNumber(runtime?.pollJitterMs, 0) || 0));
  const deadbandDefault = parseNonNegativeNumber(runtime?.deadbandDefault, null);
  const reconnectDelayMs = parsePositiveMs(runtime?.reconnectDelayMs, 2000);
  const reconnectMaxAttempts = parsePositiveNumber(runtime?.reconnectMaxAttempts, null);
  const heartbeatMs = parsePositiveMs(runtime?.heartbeatMs, 5000);
  const globalPollMs = parsePositiveMs(config?.pollMs, 500);
  const plcs = Array.isArray(config?.plcs) && config.plcs.length
    ? config.plcs
        .map((p, idx) => ({
          name: String(p?.name || `PLC-${idx + 1}`),
          host: String(p?.host || ""),
          slot: Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0,
          pollMs: parsePositiveMs(p?.pollMs, globalPollMs),
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
          samplingInterval: parsePositiveMs(t?.samplingInterval, null),
          deadband: parseNonNegativeNumber(t?.deadband, deadbandDefault),
          muted: t?.muted === true,
        }))
        .filter((t) => t.name)
    : [];

  if (!plcs.length) {
    // eslint-disable-next-line no-console
    console.error("Config missing PLC instances.");
    process.exit(1);
  }
  if (!tags.length) {
    // eslint-disable-next-line no-console
    console.warn("Config has no enabled tags yet. Waiting for tags to be added.");
  }

  const defaultPlcName = plcs[0].name;
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

  const server = new OPCUAServer({
    port: Number(config?.opcua?.port ?? 4840),
    resourcePath: String(config?.opcua?.resourcePath ?? "/UA/ControlLogix"),
    buildInfo: {
      productName: "Vizi-CLX-OPCUA-Bridge",
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
  const tagLastReadDurationMs = new Map();
  let statusPublishInFlight = false;
  let pendingStatusPayload = null;

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
    };
  });

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

  async function connectPlcWithRetry(name, plc) {
    let attempts = 0;
    while (true) {
      attempts += 1;
      try {
        await plc.connect();
        plcConnected.set(name, true);
        // eslint-disable-next-line no-console
        console.log(`Connected to PLC ${name}`);
        return;
      } catch (err) {
        plcConnected.set(name, false);
        if (reconnectMaxAttempts && attempts >= reconnectMaxAttempts) {
          // eslint-disable-next-line no-console
          console.warn(`PLC ${name} connect failed after ${attempts} attempts.`, err?.message || err);
          return;
        }
        // eslint-disable-next-line no-console
        console.warn(`PLC ${name} connect failed, retrying in ${reconnectDelayMs}ms...`, err?.message || err);
        await sleep(reconnectDelayMs);
      }
    }
  }

  plcs.forEach((p) => {
    plcClients.set(p.name, new PLC(p.host, { processorSlot: p.slot }));
    plcConnected.set(p.name, false);
  });

  await Promise.all(
    Array.from(plcClients.entries()).map(([name, plc]) => connectPlcWithRetry(name, plc))
  );

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

  async function flushStatusPublishQueue() {
    if (statusPublishInFlight) return;
    statusPublishInFlight = true;
    try {
      while (pendingStatusPayload) {
        const payload = pendingStatusPayload;
        pendingStatusPayload = null;
        const headers = { "content-type": "application/json" };
        if (OPC_SERVER_KEY) headers["x-opc-key"] = OPC_SERVER_KEY;
        await fetch(`${AI_SERVER_URL.replace(/\/$/, "")}/api/opc/status`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      }
    } catch {
      // ignore status publish errors
    } finally {
      statusPublishInFlight = false;
    }
  }

  function writeStatus() {
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
      const allConnected = Array.from(plcConnected.values()).every(Boolean);
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
          readTimeoutMs,
          errorBackoffEnabled,
          errorBackoffBaseMs,
          errorBackoffMaxMs,
          errorBackoffThreshold,
          pollJitterMs,
          deadbandDefault,
          reconnectDelayMs,
          reconnectMaxAttempts,
          heartbeatMs,
        },
      };
      void flushStatusPublishQueue();
    } catch {
      // ignore status write errors
    }
  }

  tagsByPlc.forEach((plcTags, plcName) => {
    const plc = plcClients.get(plcName);
    async function readWithTimeout(tagPath) {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Read timeout after ${readTimeoutMs}ms`)), readTimeoutMs);
      });
      return Promise.race([plc.read(tagPath), timeoutPromise]);
    }

    function nextJitter() {
      return pollJitterMs > 0 ? Math.floor(Math.random() * (pollJitterMs + 1)) : 0;
    }

    const tickMs = Math.max(
      100,
      Math.min(
        ...plcTags.map((t) => parsePositiveMs(t.samplingInterval, globalPollMs))
      )
    );
    setInterval(async () => {
      if (!plcConnected.get(plcName)) return;
      const now = Date.now();
      let didRead = false;
      for (const tag of plcTags) {
        const baseInterval = parsePositiveMs(
          tag.samplingInterval,
          parsePositiveMs(tag.pollMs, globalPollMs)
        );
        const dueAt = tagNextDueAt.get(tag.tagKey) || 0;
        if (now < dueAt) continue;

        if (tag.muted === true) {
          tagQuality.set(tag.tagKey, "Muted");
          tagEffectiveInterval.set(tag.tagKey, baseInterval);
          tagLastRead.set(tag.tagKey, now);
          tagNextDueAt.set(tag.tagKey, now + baseInterval + nextJitter());
          continue;
        }

        const readStartedAt = Date.now();
        try {
          const value = await readWithTimeout(tag.tagPath || tag.name);
          if (value == null) {
            throw new Error("Read returned no data (null/undefined).");
          }
          const durationMs = Math.max(0, Date.now() - readStartedAt);
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
          if (deadband != null) {
            if (isNumericLiveValue(prev) && isNumericLiveValue(value)) {
              const prevNum = Number(prev);
              const nextNum = Number(value);
              shouldUpdateValue = Math.abs(nextNum - prevNum) >= deadband;
            }
          }
          if (shouldUpdateValue) tagValues.set(tag.tagKey, value);
          tagErrors.delete(tag.tagKey);
          tagErrorStreak.set(tag.tagKey, 0);
          tagQuality.set(tag.tagKey, "Good");
          tagLastRead.set(tag.tagKey, now);
          tagLastSuccessAt.set(tag.tagKey, now);
          tagEffectiveInterval.set(tag.tagKey, baseInterval);
          tagNextDueAt.set(tag.tagKey, now + baseInterval + nextJitter());
          didRead = true;
        } catch (err) {
          const durationMs = Math.max(0, Date.now() - readStartedAt);
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
          tagErrors.set(tag.tagKey, prev + 1);
          const streak = (tagErrorStreak.get(tag.tagKey) || 0) + 1;
          tagErrorStreak.set(tag.tagKey, streak);
          tagQuality.set(tag.tagKey, "Bad");
          tagLastErrorAt.set(tag.tagKey, now);
          tagLastErrorMessage.set(tag.tagKey, err?.message || "Read failed.");
          let backoffMs = 0;
          if (errorBackoffEnabled && streak >= errorBackoffThreshold) {
            const exp = Math.max(0, streak - errorBackoffThreshold);
            backoffMs = Math.min(errorBackoffMaxMs, errorBackoffBaseMs * 2 ** exp);
          }
          tagEffectiveInterval.set(tag.tagKey, baseInterval + backoffMs);
          tagNextDueAt.set(tag.tagKey, now + baseInterval + backoffMs + nextJitter());
          tagLastRead.set(tag.tagKey, now);
        }
      }
      if (didRead) plcLastPollAt.set(plcName, now);
      writeStatus();
    }, tickMs);
  });

  plcClients.forEach((plc, plcName) => {
    setInterval(async () => {
      try {
        if (!plcConnected.get(plcName)) {
          await connectPlcWithRetry(plcName, plc);
          writeStatus();
          return;
        }
        const firstTag = (tagsByPlc.get(plcName) || [])[0];
        if (!firstTag) return;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Heartbeat timeout after ${readTimeoutMs}ms`)), readTimeoutMs);
        });
        await Promise.race([plc.read(firstTag.tagPath || firstTag.name), timeoutPromise]);
      } catch (err) {
        plcConnected.set(plcName, false);
        // eslint-disable-next-line no-console
        console.warn(`PLC ${plcName} heartbeat failed.`, err?.message || err);
      } finally {
        writeStatus();
      }
    }, heartbeatMs);
  });

  await server.start();
  const endpoint = server.endpoints[0].endpointDescriptions()[0].endpointUrl;
  // eslint-disable-next-line no-console
  console.log(`OPC UA Server listening at ${endpoint}`);

  process.on("SIGINT", async () => {
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
  process.exit(1);
});
