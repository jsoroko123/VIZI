export async function requestJson(path, options = {}) {
  const res = await fetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(String(data?.error || options?.fallbackError || `Request failed (${res.status})`));
  }
  return data;
}

export async function requestText(path, options = {}) {
  const res = await fetch(path, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(String(options?.fallbackError || `Request failed (${res.status})`));
  }
  return text;
}
