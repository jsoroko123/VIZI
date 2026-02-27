import { requestJson } from "./http";

export function listProjects() {
  return requestJson("/api/projects");
}

export function createProject(payload) {
  return requestJson("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export async function upsertProjectWithStatus(payload, options = {}) {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: options?.keepalive === true,
    body: JSON.stringify(payload || {}),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  return { ok: res.ok, status: res.status, data };
}

export function getProjectById(id) {
  return requestJson(`/api/projects/${id}`);
}

export function saveProjectById(id, payload) {
  return requestJson(`/api/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export function deleteProjectById(id) {
  return requestJson(`/api/projects/${id}`, { method: "DELETE" });
}

export function listProjectCursors(id) {
  return requestJson(`/api/projects/${id}/cursors`);
}

export function upsertProjectCursor(id, point) {
  return requestJson(`/api/projects/${id}/cursor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(point || {}),
  });
}

export function pingUserPresence() {
  return requestJson("/api/presence/ping", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}
