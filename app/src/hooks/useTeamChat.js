import { useEffect, useRef, useState } from "react";
import {
  clearChatContextDocs,
  listChatContextDocs,
  listChatMessages,
  postChatMessageWithAi,
  uploadChatContextL5x,
} from "../api/chatApi";
import { toastError } from "../utils/toast";

function normalizeAiAction(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const src = input?.payload && typeof input.payload === "object" ? input.payload : input;
  const inferredType =
    String(input?.type || src?.type || "").trim().toLowerCase() ||
    (Array.isArray(src?.items) ? "add_svg_layout" : "");
  const type = inferredType;
  if (type !== "add_svg_layout") return null;
  const items = (Array.isArray(src?.items) ? src.items : [])
    .map((row) => {
      const entry = row && typeof row === "object" ? row : {};
      const svgKey = String(entry.svgKey || entry.svgName || entry.svg || entry.key || "").trim();
      if (!svgKey) return null;
      return {
        svgKey,
        label: String(entry.label || entry.name || "").trim(),
        tagPath: String(entry.tagPath || entry.tag || "").trim(),
        x: Number(entry.x),
        y: Number(entry.y),
        width: Number(entry.width || entry.w || 0),
      };
    })
    .filter(Boolean);
  if (!items.length) return null;
  const layout =
    src?.layout && typeof src.layout === "object" && !Array.isArray(src.layout) ? src.layout : {};
  return { type: "add_svg_layout", payload: { items, layout } };
}

function extractMesoraActionFromText(rawText = "") {
  const text = String(rawText || "");
  const findBalancedObject = (source, fromIndex = 0) => {
    const start = source.indexOf("{", fromIndex);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") {
        inString = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) return { start, end: i + 1 };
      }
    }
    return null;
  };

  const tryParse = (jsonText) => {
    try {
      return normalizeAiAction(JSON.parse(String(jsonText || "").trim()));
    } catch {
      return null;
    }
  };

  const marker = text.match(/MESORA_ACTION\s*[:=]/i);
  if (marker && Number.isFinite(marker.index)) {
    const span = findBalancedObject(text, marker.index);
    if (span) {
      const action = tryParse(text.slice(span.start, span.end));
      if (action) return action;
    }
  }

  const fenced = text.match(/```(?:json|mesora_action)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const action = tryParse(fenced[1]);
    if (action) return action;
  }

  const firstObj = findBalancedObject(text, 0);
  if (firstObj) {
    const action = tryParse(text.slice(firstObj.start, firstObj.end));
    if (action) return action;
  }
  return null;
}

function inferDesignActionFromAiText(aiText = "") {
  const text = String(aiText || "");
  if (!text) return null;
  const svgMention = text.match(/(\d{1,3})\s+([a-z0-9_.\-\/]+\.svg)\b/i);
  if (!svgMention) return null;
  const count = Math.max(1, Math.min(120, Number(svgMention[1] || 1)));
  const svgKey = String(svgMention[2] || "").trim();
  if (!svgKey) return null;
  const labelBase = String(svgKey.replace(/\.svg$/i, "") || "SVG").replace(/[_\-]+/g, " ").trim();
  return {
    type: "add_svg_layout",
    payload: {
      items: Array.from({ length: count }, (_, i) => ({
        svgKey,
        label: `${labelBase} ${i + 1}`,
      })),
      layout: { mode: "grid", columns: Math.max(1, Math.ceil(Math.sqrt(count))) },
    },
  };
}

function inferDesignActionFromPrompt(prompt = "") {
  const raw = String(prompt || "").trim();
  if (!raw) return null;
  const text = raw.toLowerCase();
  const wantsPlacement =
    /\b(add|place|layout|arrange|insert|draw|drop)\b/.test(text) &&
    /\b(bin|bins|diverter|diverters|blower|blowers|airlock|airlocks|motor|motors|svg|svgs)\b/.test(text);
  if (!wantsPlacement) return null;
  const digit = text.match(/\b(\d{1,3})\b/);
  const words = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const wordNum = Object.entries(words).find(([k]) => new RegExp(`\\b${k}\\b`).test(text))?.[1] || null;
  const count = Math.max(1, Math.min(120, Number(digit?.[1] || wordNum || 1)));
  const svgKey =
    /\bbin(s)?\b/.test(text) ? "bin" :
    /\bdiverter(s)?\b/.test(text) ? "diverter" :
    /\bblower(s)?\b/.test(text) ? "blower" :
    /\bairlock(s)?\b/.test(text) ? "airlock" :
    /\bmotor(s)?\b/.test(text) ? "motor" :
    "bin";
  const parseNumberSeries = (input) => {
    const src = String(input || "");
    const found = src.match(/\d+\s*-\s*\d+|\d+/g) || [];
    const out = [];
    const seen = new Set();
    for (const token of found) {
      const span = String(token || "").trim();
      if (!span) continue;
      const range = span.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const a = Number(range[1]);
        const b = Number(range[2]);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const lo = Math.max(1, Math.min(a, b));
        const hi = Math.min(9999, Math.max(a, b));
        for (let n = lo; n <= hi; n += 1) {
          if (seen.has(n)) continue;
          seen.add(n);
          out.push(n);
          if (out.length >= 120) return out;
        }
        continue;
      }
      const n = Number(span);
      if (!Number.isFinite(n)) continue;
      const v = Math.max(1, Math.min(9999, Math.floor(n)));
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length >= 120) return out;
    }
    return out;
  };
  const explicitBinNumbers = svgKey === "bin" ? parseNumberSeries(raw) : [];
  const labelBase = svgKey.charAt(0).toUpperCase() + svgKey.slice(1);
  const explicitItems = explicitBinNumbers.length
    ? explicitBinNumbers.map((n) => ({ svgKey, label: `Bin${n}` }))
    : null;
  return {
    type: "add_svg_layout",
    payload: {
      items: explicitItems || Array.from({ length: count }, (_, i) => ({ svgKey, label: `${labelBase} ${i + 1}` })),
      layout: { mode: "grid", columns: Math.max(1, Math.ceil(Math.sqrt(count))) },
    },
  };
}

export function useTeamChat({
  userId,
  isPageVisible,
  showTeamChat,
  onAiAction,
  canAskAi = true,
  canApplyAiAction = true,
  chatMode = "design",
}) {
  const [teamChatMessages, setTeamChatMessages] = useState([]);
  const [teamChatDraft, setTeamChatDraft] = useState("");
  const [teamChatLoading, setTeamChatLoading] = useState(false);
  const [teamChatSending, setTeamChatSending] = useState(false);
  const [teamChatUnreadCount, setTeamChatUnreadCount] = useState(0);
  const [teamChatLastSeenId, setTeamChatLastSeenId] = useState(0);
  const [chatContextDocs, setChatContextDocs] = useState([]);
  const [chatContextUploading, setChatContextUploading] = useState(false);
  const teamChatBodyRef = useRef(null);
  const isNearBottom = (el, threshold = 40) => {
    if (!el) return true;
    const distance = Number(el.scrollHeight || 0) - Number(el.scrollTop || 0) - Number(el.clientHeight || 0);
    return distance <= threshold;
  };
  const scrollChatToBottom = () => {
    const apply = () => {
      const el = teamChatBodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    window.requestAnimationFrame(() => {
      apply();
      window.requestAnimationFrame(apply);
    });
  };

  const loadTeamChatMessages = async ({ silent = false } = {}) => {
    if (!silent) setTeamChatLoading(true);
    try {
      const data = await listChatMessages({ chatMode });
      const next = Array.isArray(data?.messages) ? data.messages : [];
      setTeamChatMessages(next);
      return next;
    } catch (err) {
      if (!silent) toastError(err?.message || "Failed to load chat.");
      return [];
    } finally {
      if (!silent) setTeamChatLoading(false);
    }
  };

  const toAiHistory = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .slice(-16)
      .map((row) => {
        const author = String(row?.author || "").trim().toLowerCase();
        const role = author === "mesora ai" ? "assistant" : "user";
        const content = String(row?.message || "").trim();
        if (!content) return null;
        return { role, content };
      })
      .filter(Boolean);

  const sendTeamChatMessage = async (options = {}) => {
    let rawMessage = String(teamChatDraft || "");
    if (options?.forceAiPrefix && !/^\/ai\b/i.test(String(rawMessage || "").trim())) {
      rawMessage = `/ai ${String(rawMessage || "").trim()}`;
    }
    const msg = String(rawMessage || "").trim();
    if (!msg || teamChatSending) return;
    const forceAi = options?.askAi === true;
    const aiCommand = /^\/ai\b/i.test(msg);
    const askAi = canAskAi && (forceAi || aiCommand);
    const aiPrompt = askAi
      ? String(msg.replace(/^\/ai\b/i, "").trim() || msg).trim()
      : "";
    scrollChatToBottom();
    setTeamChatSending(true);
    try {
      const history = toAiHistory(teamChatMessages);
      const data = await postChatMessageWithAi(msg, {
        askAi,
        aiPrompt,
        history,
        chatMode,
      });
      let nextAiAction = normalizeAiAction(data?.aiAction || null);
      if (!nextAiAction && askAi && String(chatMode || "").toLowerCase() === "design") {
        const aiText = String(data?.aiMessage?.message || data?.aiMessage?.content || "").trim();
        nextAiAction =
          extractMesoraActionFromText(aiText) ||
          inferDesignActionFromAiText(aiText) ||
          inferDesignActionFromPrompt(aiPrompt || msg);
      }
      if (askAi && canApplyAiAction && nextAiAction && typeof onAiAction === "function") {
        try {
          await onAiAction(nextAiAction);
        } catch (err) {
          toastError(err?.message || "Failed to apply AI canvas action.");
        }
      }
      if (askAi && String(data?.aiError || "").trim()) {
        toastError(String(data.aiError));
      }
      setTeamChatDraft("");
      const next = await loadTeamChatMessages({ silent: true });
      const latestId = next.reduce((maxId, row) => Math.max(maxId, Number(row?.id) || 0), 0);
      if (latestId > 0) setTeamChatLastSeenId((prev) => Math.max(prev, latestId));
      setTeamChatUnreadCount(0);
      scrollChatToBottom();
    } catch (err) {
      toastError(err?.message || "Failed to send message.");
    } finally {
      setTeamChatSending(false);
    }
  };

  const loadChatContextDocs = async ({ silent = false } = {}) => {
    try {
      const data = await listChatContextDocs({ chatMode });
      const docs = Array.isArray(data?.docs) ? data.docs : [];
      setChatContextDocs(docs);
      return docs;
    } catch (err) {
      if (!silent) toastError(err?.message || "Failed to load L5X context docs.");
      return [];
    }
  };

  const uploadL5xContextFile = async (file) => {
    const f = file instanceof File ? file : null;
    if (!f) return;
    const name = String(f.name || "").trim() || "upload.l5x";
    if (!/\.(l5x|l5k|xml|txt)$/i.test(name)) {
      toastError("Upload an .l5x, .l5k, .xml, or .txt file.");
      return;
    }
    setChatContextUploading(true);
    try {
      const content = await f.text();
      if (!String(content || "").trim()) throw new Error("Selected file is empty.");
      await uploadChatContextL5x(name, content, { chatMode });
      await loadChatContextDocs({ silent: true });
    } catch (err) {
      toastError(err?.message || "Failed to upload L5X context.");
    } finally {
      setChatContextUploading(false);
    }
  };

  const clearL5xContextDocs = async () => {
    try {
      await clearChatContextDocs({ chatMode });
      setChatContextDocs([]);
    } catch (err) {
      toastError(err?.message || "Failed to clear L5X context.");
    }
  };

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    let timer = 0;
    const pollMs = isPageVisible ? 2500 : 7000;
    const run = async () => {
      const next = await loadTeamChatMessages({ silent: true });
      if (cancelled) return;
      const latestId = next.reduce((maxId, row) => Math.max(maxId, Number(row?.id) || 0), 0);
      if (showTeamChat) {
        if (latestId > 0) setTeamChatLastSeenId((prev) => Math.max(prev, latestId));
        setTeamChatUnreadCount(0);
      } else if (latestId > teamChatLastSeenId) {
        const currentUserId = Number(userId || 0);
        const unread = next.filter((row) => {
          const rowId = Number(row?.id || 0);
          if (!(rowId > teamChatLastSeenId)) return false;
          const authorId = Number(row?.user_id || 0);
          if (currentUserId > 0 && authorId === currentUserId) return false;
          return true;
        }).length;
        setTeamChatUnreadCount(unread);
      }
      timer = window.setTimeout(run, pollMs);
    };
    run();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [userId, isPageVisible, showTeamChat, teamChatLastSeenId, chatMode]);

  useEffect(() => {
    if (!showTeamChat) return;
    const latestId = teamChatMessages.reduce((maxId, row) => Math.max(maxId, Number(row?.id) || 0), 0);
    if (latestId > 0) setTeamChatLastSeenId((prev) => Math.max(prev, latestId));
    setTeamChatUnreadCount(0);
    const el = teamChatBodyRef.current;
    if (!el) return;
    if (isNearBottom(el)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [showTeamChat, teamChatMessages]);

  useEffect(() => {
    if (!showTeamChat) return;
    const el = teamChatBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [showTeamChat]);

  useEffect(() => {
    if (!showTeamChat) return;
    void loadChatContextDocs({ silent: true });
  }, [showTeamChat, chatMode]);

  return {
    teamChatMessages,
    teamChatDraft,
    setTeamChatDraft,
    teamChatLoading,
    teamChatSending,
    teamChatUnreadCount,
    teamChatBodyRef,
    chatContextDocs,
    chatContextUploading,
    loadTeamChatMessages,
    sendTeamChatMessage,
    loadChatContextDocs,
    uploadL5xContextFile,
    clearL5xContextDocs,
  };
}
