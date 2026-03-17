const EMPTY_VALUES = Object.freeze({});
const MIN_EMIT_INTERVAL_MS = 650;

let snapshot = EMPTY_VALUES;
const listeners = new Set();
const keyedListeners = new Set();
let emitTimer = null;
let lastEmitAt = 0;
let pendingChangedKeys = new Set();

function normalizeKey(raw) {
  const key = String(raw || "").replace(/\r?\n/g, "").trim();
  return key;
}

function normalizeKeyLower(raw) {
  return normalizeKey(raw).toLowerCase();
}

function toLowerKeySet(rawKeys) {
  const out = new Set();
  const list = Array.isArray(rawKeys) ? rawKeys : [];
  for (const raw of list) {
    const key = normalizeKeyLower(raw);
    if (!key) continue;
    out.add(key);
  }
  return out;
}

function queueChangedKeys(rawKeys) {
  const list = Array.isArray(rawKeys) ? rawKeys : [];
  for (const raw of list) {
    const key = normalizeKeyLower(raw);
    if (!key) continue;
    pendingChangedKeys.add(key);
  }
}

function runEmitNow() {
  lastEmitAt = Date.now();
  const changedKeys = pendingChangedKeys;
  pendingChangedKeys = new Set();
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener failures
    }
  });
  if (changedKeys.size) {
    const keyedCalls = new Set();
    keyedListeners.forEach((entry) => {
      const listener = entry?.listener;
      const watchKeys = entry?.keys;
      if (typeof listener !== "function" || !(watchKeys instanceof Set) || !watchKeys.size) return;
      for (const changedKey of changedKeys) {
        if (watchKeys.has(changedKey)) {
          keyedCalls.add(listener);
          break;
        }
      }
    });
    keyedCalls.forEach((listener) => {
      try {
        listener();
      } catch {
        // ignore listener failures
      }
    });
  }
}

function scheduleEmit() {
  const now = Date.now();
  const waitMs = Math.max(0, MIN_EMIT_INTERVAL_MS - (now - lastEmitAt));
  if (waitMs <= 0) {
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    runEmitNow();
    return;
  }
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    runEmitNow();
  }, waitMs);
}

function areEqualMaps(a, b) {
  if (a === b) return true;
  const aObj = a && typeof a === "object" ? a : EMPTY_VALUES;
  const bObj = b && typeof b === "object" ? b : EMPTY_VALUES;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    const key = aKeys[i];
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!Object.is(aObj[key], bObj[key])) return false;
  }
  return true;
}

export function getOpcLiveSnapshot() {
  return snapshot;
}

export function subscribeOpcLiveStore(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeOpcLiveKeys(rawKeys, listener) {
  if (typeof listener !== "function") return () => {};
  const keys = toLowerKeySet(rawKeys);
  if (!keys.size) return subscribeOpcLiveStore(listener);
  const entry = { keys, listener };
  keyedListeners.add(entry);
  return () => keyedListeners.delete(entry);
}

export function getOpcLiveValuesForKeys(rawKeys) {
  const keys = Array.isArray(rawKeys) ? rawKeys : [];
  if (!keys.length) return EMPTY_VALUES;
  const src = snapshot && typeof snapshot === "object" ? snapshot : EMPTY_VALUES;
  const out = {};
  for (const raw of keys) {
    const key = normalizeKey(raw);
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(src, key)) {
      out[key] = src[key];
      continue;
    }
    const lower = key.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(src, lower)) {
      out[lower] = src[lower];
    }
  }
  return out;
}

function collectChangedKeys(prevValues, nextValues) {
  const prev = prevValues && typeof prevValues === "object" ? prevValues : EMPTY_VALUES;
  const next = nextValues && typeof nextValues === "object" ? nextValues : EMPTY_VALUES;
  const changed = new Set();
  Object.keys(prev).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(next, key) || !Object.is(prev[key], next[key])) {
      const lower = normalizeKeyLower(key);
      if (lower) changed.add(lower);
    }
  });
  Object.keys(next).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(prev, key) || !Object.is(prev[key], next[key])) {
      const lower = normalizeKeyLower(key);
      if (lower) changed.add(lower);
    }
  });
  return Array.from(changed);
}

export function setOpcLiveSnapshot(nextValues) {
  const next = nextValues && typeof nextValues === "object" ? nextValues : EMPTY_VALUES;
  if (areEqualMaps(snapshot, next)) return false;
  const changedKeys = collectChangedKeys(snapshot, next);
  snapshot = next;
  queueChangedKeys(changedKeys);
  scheduleEmit();
  return true;
}

export function patchOpcLiveSnapshot(patchValues) {
  const patch = patchValues && typeof patchValues === "object" ? patchValues : EMPTY_VALUES;
  if (!Object.keys(patch).length) return false;
  const current = snapshot && typeof snapshot === "object" ? snapshot : EMPTY_VALUES;
  const next = { ...current };
  let changed = false;
  Object.entries(patch).forEach(([key, value]) => {
    if (value === null) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
        changed = true;
        queueChangedKeys([key]);
      }
      return;
    }
    if (!Object.is(next[key], value)) {
      next[key] = value;
      changed = true;
      queueChangedKeys([key]);
    }
  });
  if (!changed) return false;
  snapshot = next;
  scheduleEmit();
  return true;
}

export function clearOpcLiveSnapshot() {
  if (snapshot === EMPTY_VALUES || !Object.keys(snapshot).length) return false;
  queueChangedKeys(Object.keys(snapshot));
  snapshot = EMPTY_VALUES;
  scheduleEmit();
  return true;
}
