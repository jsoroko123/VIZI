function logOpcClientError(path, payload = {}) {
  try {
    if (typeof window === "undefined") return;
    if (!String(path || "").startsWith("/api/opc")) return;
    if (typeof window.viziLog === "function") {
      window.viziLog("error", "OPC API request failed", {
        path: String(path || ""),
        ...payload,
      });
    }
  } catch {
    // ignore client-side logging failures
  }
}

export async function requestJson(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    logOpcClientError(path, { reason: "fetch_failed", message: String(err?.message || "Fetch failed") });
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = String(data?.error || options?.fallbackError || `Request failed (${res.status})`);
    logOpcClientError(path, { reason: "http_error", status: Number(res.status) || null, message });
    throw new Error(message);
  }
  return data;
}

export async function requestText(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    logOpcClientError(path, { reason: "fetch_failed", message: String(err?.message || "Fetch failed") });
    throw err;
  }
  const text = await res.text();
  if (!res.ok) {
    const message = String(options?.fallbackError || `Request failed (${res.status})`);
    logOpcClientError(path, { reason: "http_error", status: Number(res.status) || null, message });
    throw new Error(message);
  }
  return text;
}
