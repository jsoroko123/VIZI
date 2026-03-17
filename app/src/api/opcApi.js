import { requestJson } from "./http";

export function getOpcConfig(options = {}) {
  const keys = Array.isArray(options?.keys)
    ? Array.from(
        new Set(
          options.keys
            .map((k) => String(k || "").trim())
            .filter(Boolean)
        )
      )
    : [];
  if (!keys.length) {
    return requestJson("/api/opc/config", { fallbackError: "Failed to load OPC config." });
  }
  const query = new URLSearchParams();
  query.set("keys", keys.join(","));
  return requestJson(`/api/opc/config?${query.toString()}`, {
    fallbackError: "Failed to load scoped OPC config.",
  });
}

export function getOpcTemplates() {
  return requestJson("/api/opc/templates", { fallbackError: "Failed to load templates." });
}

export function getOpcTagMappings() {
  return requestJson("/api/opc/tag-mappings", { fallbackError: "Failed to load mappings." });
}

export function getOpcMappingSets() {
  return requestJson("/api/opc/mapping-sets", { fallbackError: "Failed to load mapping sets." });
}

export function getOpcStatus(options = {}) {
  const keys = Array.isArray(options?.keys)
    ? Array.from(
        new Set(
          options.keys
            .map((k) => String(k || "").trim())
            .filter(Boolean)
        )
      )
    : [];
  if (!keys.length) {
    return requestJson("/api/opc/status", { fallbackError: "Failed to load status." });
  }
  return requestJson("/api/opc/status/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
    fallbackError: "Failed to load scoped status.",
  });
}

export function subscribeOpcStatusStream(options = {}) {
  const keys = Array.isArray(options?.keys)
    ? Array.from(
        new Set(
          options.keys
            .map((k) => String(k || "").trim())
            .filter(Boolean)
        )
      )
    : [];
  const query = new URLSearchParams();
  if (keys.length && keys.length <= 400) query.set("keys", keys.join(","));
  const url = query.toString()
    ? `/api/opc/status/stream?${query.toString()}`
    : "/api/opc/status/stream";
  const source = new EventSource(url, { withCredentials: true });
  source.onopen = () => {
    if (typeof options?.onOpen === "function") options.onOpen();
  };
  source.onerror = (err) => {
    if (typeof options?.onError === "function") options.onError(err);
  };
  source.onmessage = (event) => {
    if (typeof options?.onMessage !== "function") return;
    try {
      const payload = JSON.parse(String(event?.data || "{}"));
      options.onMessage(payload);
    } catch {
      // ignore malformed stream payloads
    }
  };
  return () => {
    try {
      source.close();
    } catch {
      // ignore
    }
  };
}

export function writeOpcValue(payloadOrTagPath, maybeValue) {
  const payload =
    payloadOrTagPath && typeof payloadOrTagPath === "object"
      ? payloadOrTagPath
      : { tagPath: payloadOrTagPath, value: maybeValue };
  return requestJson("/api/opc/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    fallbackError: "Write failed.",
  });
}
