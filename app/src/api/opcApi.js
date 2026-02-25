import { requestJson } from "./http";

export function getOpcConfig() {
  return requestJson("/api/opc/config", { fallbackError: "Failed to load OPC config." });
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

export function getOpcStatus() {
  return requestJson("/api/opc/status", { fallbackError: "Failed to load status." });
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
