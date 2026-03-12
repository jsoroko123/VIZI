import { requestJson } from "./http";

export function listDbTables() {
  return requestJson("/api/db/tables", { fallbackError: "Failed to load DB tables." });
}

export function listEquipmentTypes(limit = 200) {
  return requestJson(`/api/db/etype?limit=${Number(limit) || 200}`, { fallbackError: "Failed to load equipment types." });
}

export function listActiveAlarms() {
  return requestJson("/api/alarms?activeOnly=true", { fallbackError: "Failed to load alarms." });
}

export function fetchBatchFirstValues(bindings) {
  return requestJson("/api/db/batch-first-values", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bindings }),
    fallbackError: "Failed to load widget values.",
  });
}

export function readTableRow(table, rowId) {
  return requestJson(`/api/db/${encodeURIComponent(table)}/${encodeURIComponent(rowId)}`, {
    fallbackError: "Failed to load row.",
  });
}

export function updateTableRow(table, rowId, values) {
  return requestJson(`/api/db/${encodeURIComponent(table)}/${encodeURIComponent(rowId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values || {}),
    fallbackError: "Failed to update row.",
  });
}

export function insertTableRow(table, values) {
  return requestJson(`/api/db/${encodeURIComponent(table)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(values || {}),
    fallbackError: "Failed to create row.",
  });
}

export function getTableMeta(table) {
  return requestJson(`/api/db/${encodeURIComponent(table)}/meta`, {
    fallbackError: "Failed to load table metadata.",
  });
}

export function listRoutesByProject(projectId, limit = 2000) {
  return requestJson(`/api/db/route?limit=${Number(limit) || 2000}&project_id=${encodeURIComponent(projectId)}`);
}

export function listAllRoutes(limit = 2000) {
  return requestJson(`/api/db/route?limit=${Number(limit) || 2000}`);
}

export function listTableRecords(tableName, query = "") {
  return requestJson(`/api/db/${tableName}${query}`);
}

export function listTableRecordsUnscoped(tableName, limit = 2000) {
  return requestJson(`/api/db/${tableName}?limit=${Number(limit) || 2000}`);
}

export function listEquipmentByProject(projectId, limit = 2000) {
  return requestJson(`/api/db/equipment?limit=${Number(limit) || 2000}&project_id=${encodeURIComponent(projectId)}`);
}

export function listAllEquipment(limit = 2000) {
  return requestJson(`/api/db/equipment?limit=${Number(limit) || 2000}`);
}
