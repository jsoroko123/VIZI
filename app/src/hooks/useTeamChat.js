import { useEffect, useRef, useState } from "react";
import { listChatMessages, postChatMessageWithAi } from "../api/chatApi";
import { toastError } from "../utils/toast";

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
  const teamChatBodyRef = useRef(null);
  const isNearBottom = (el, threshold = 40) => {
    if (!el) return true;
    const distance = Number(el.scrollHeight || 0) - Number(el.scrollTop || 0) - Number(el.clientHeight || 0);
    return distance <= threshold;
  };

  const loadTeamChatMessages = async ({ silent = false } = {}) => {
    if (!silent) setTeamChatLoading(true);
    try {
      const data = await listChatMessages();
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
    const msg = String(teamChatDraft || "").trim();
    if (!msg || teamChatSending) return;
    const forceAi = options?.askAi === true;
    const aiCommand = /^\/ai\b/i.test(msg);
    const askAi = canAskAi && (forceAi || aiCommand);
    const aiPrompt = askAi
      ? String(msg.replace(/^\/ai\b/i, "").trim() || msg).trim()
      : "";
    setTeamChatSending(true);
    try {
      const history = toAiHistory(teamChatMessages);
      const data = await postChatMessageWithAi(msg, {
        askAi,
        aiPrompt,
        history,
        chatMode,
      });
      if (askAi && canApplyAiAction && data?.aiAction && typeof onAiAction === "function") {
        try {
          await onAiAction(data.aiAction);
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
      window.requestAnimationFrame(() => {
        const el = teamChatBodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err) {
      toastError(err?.message || "Failed to send message.");
    } finally {
      setTeamChatSending(false);
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
  }, [userId, isPageVisible, showTeamChat, teamChatLastSeenId]);

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

  return {
    teamChatMessages,
    teamChatDraft,
    setTeamChatDraft,
    teamChatLoading,
    teamChatSending,
    teamChatUnreadCount,
    teamChatBodyRef,
    loadTeamChatMessages,
    sendTeamChatMessage,
  };
}
