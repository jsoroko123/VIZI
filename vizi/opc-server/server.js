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
const RESTART_PATH = path.resolve(process.cwd(), "restart.requested");
const STATUS_PATH = process.env.OPC_STATUS_PATH || path.resolve(process.cwd(), "status.json");

async function loadConfig() {
  try {
    const res = await fetch(`${AI_SERVER_URL.replace(/\/$/, "")}/api/opc/config`);
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

async function main() {
  const config = await loadConfig();
  const globalPollMs = Math.max(100, Number(config?.pollMs ?? 500));
  const plcs = Array.isArray(config?.plcs) && config.plcs.length
    ? config.plcs
        .map((p, idx) => ({
          name: String(p?.name || `PLC-${idx + 1}`),
          host: String(p?.host || ""),
          slot: Number.isFinite(Number(p?.slot)) ? Number(p.slot) : 0,
          pollMs: Number.isFinite(Number(p?.pollMs)) ? Math.max(100, Number(p.pollMs)) : globalPollMs,
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
      samplingInterval: Number.isFinite(Number(t?.samplingInterval))
        ? Math.max(100, Number(t.samplingInterval))
        : null,
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
          pollMs: Number.isFinite(Number(t?.pollMs)) ? Math.max(100, Number(t.pollMs)) : null,
          samplingInterval: Number.isFinite(Number(t?.samplingInterval))
            ? Math.max(100, Number(t.samplingInterval))
            : null,
        }))
        .filter((t) => t.name)
    : [];

  if (!plcs.length || !tags.length) {
    // eslint-disable-next-line no-console
    console.error("Config missing PLC instances or tags list.");
    process.exit(1);
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

  function getTagKey(tag) {
    const topicName = tag.topic || "";
    return topicName ? `${topicName}.${tag.name}` : tag.name;
  }

  const tagsWithMeta = tags.map((t) => {
    const topicName = t.topic && topicsByName.has(t.topic) ? t.topic : "Default";
    const topic = topicsByName.get(topicName) || { name: topicName, plcName: defaultPlcName };
    const plcName = topic.plcName || defaultPlcName;
    const plc = plcs.find((p) => p.name === plcName) || plcs[0];
    const pollMs = Number.isFinite(Number(t.pollMs))
      ? Math.max(100, Number(t.pollMs))
      : Number.isFinite(Number(plc?.pollMs))
      ? Math.max(100, Number(plc.pollMs))
      : globalPollMs;
    const samplingInterval = Number.isFinite(Number(t.samplingInterval))
      ? Math.max(100, Number(t.samplingInterval))
      : Number.isFinite(Number(topic?.samplingInterval))
      ? Math.max(100, Number(topic.samplingInterval))
      : Number.isFinite(Number(plc?.pollMs))
      ? Math.max(100, Number(plc.pollMs))
      : globalPollMs;
    return {
      ...t,
      topic: topicName,
      plcName,
      pollMs,
      samplingInterval,
      tagKey: getTagKey({ ...t, topic: topicName }),
    };
  });

  tagsWithMeta.forEach((t) => tagValues.set(t.tagKey, null));

  const topicNodes = new Map();
  const resolvedTopics = Array.from(topicsByName.values());
  resolvedTopics.forEach((t) => {
    const node = namespace.addObject({
      componentOf: device,
      browseName: t.name,
    });
    topicNodes.set(t.name, node);
  });

  function createVariable(tag) {
    const uaType = tag.uaType
      ? DataType[String(tag.uaType)]
      : plcTypeToUa(tag.plcType);
    const node = topicNodes.get(tag.topic) || device;
    namespace.addVariable({
      componentOf: node,
      browseName: tag.name,
      dataType: uaType,
      value: {
        get: () =>
          new Variant({
            dataType: uaType,
            value: tagValues.get(tag.tagKey),
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
    while (true) {
      try {
        await plc.connect();
        plcConnected.set(name, true);
        // eslint-disable-next-line no-console
        console.log(`Connected to PLC ${name}`);
        return;
      } catch (err) {
        plcConnected.set(name, false);
        // eslint-disable-next-line no-console
        console.warn(`PLC ${name} connect failed, retrying in 2s...`, err?.message || err);
        await new Promise((r) => setTimeout(r, 2000));
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

  function writeStatus() {
    try {
      const snapshot = {};
      const errors = {};
      tagsWithMeta.forEach((t) => {
        snapshot[t.tagKey] = tagValues.get(t.tagKey);
        if (tagErrors.has(t.tagKey)) errors[t.tagKey] = tagErrors.get(t.tagKey);
      });
      const allConnected = Array.from(plcConnected.values()).every(Boolean);
      const lastPollAt = Math.max(0, ...Array.from(plcLastPollAt.values()), 0);
      fs.writeFileSync(
        STATUS_PATH,
        JSON.stringify(
          {
            at: Date.now(),
            connected: allConnected,
            connections: Object.fromEntries(plcConnected.entries()),
            lastPollAt: lastPollAt || null,
            values: snapshot,
            errors,
          },
          null,
          2
        )
      );
    } catch {
      // ignore status write errors
    }
  }

  tagsByPlc.forEach((plcTags, plcName) => {
    const plc = plcClients.get(plcName);
    const tickMs = Math.max(
      100,
      Math.min(
        ...plcTags.map((t) =>
          Number.isFinite(Number(t.samplingInterval)) ? Number(t.samplingInterval) : globalPollMs
        )
      )
    );
    setInterval(async () => {
      if (!plcConnected.get(plcName)) return;
      const now = Date.now();
      let didRead = false;
      for (const tag of plcTags) {
        const interval = Number.isFinite(Number(tag.samplingInterval))
          ? Number(tag.samplingInterval)
          : Number.isFinite(Number(tag.pollMs))
          ? Number(tag.pollMs)
          : globalPollMs;
        const last = tagLastRead.get(tag.tagKey) || 0;
        if (now - last < interval) continue;
        try {
          const value = await plc.read(tag.tagPath || tag.name);
          tagValues.set(tag.tagKey, value);
          tagErrors.delete(tag.tagKey);
          tagLastRead.set(tag.tagKey, now);
          didRead = true;
        } catch {
          const prev = tagErrors.get(tag.tagKey) || 0;
          tagErrors.set(tag.tagKey, prev + 1);
          tagLastRead.set(tag.tagKey, now);
        }
      }
      if (didRead) plcLastPollAt.set(plcName, now);
      writeStatus();
    }, tickMs);
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
