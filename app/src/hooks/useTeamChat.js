import { useEffect, useRef, useState } from "react";
import { listChatMessages, postChatMessage } from "../api/chatApi";
import { toastError } from "../utils/toast";

export function useTeamChat({ userId, isPageVisible, showTeamChat }) {
  const [teamChatMessages, setTeamChatMessages] = useState([]);
  const [teamChatDraft, setTeamChatDraft] = useState("");
  const [teamChatLoading, setTeamChatLoading] = useState(false);
  const [teamChatSending, setTeamChatSending] = useState(false);
  const [teamChatUnreadCount, setTeamChatUnreadCount] = useState(0);
  const [teamChatLastSeenId, setTeamChatLastSeenId] = useState(0);
  const teamChatBodyRef = useRef(null);

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

  const sendTeamChatMessage = async () => {
    const msg = String(teamChatDraft || "").trim();
    if (!msg || teamChatSending) return;
    setTeamChatSending(true);
    try {
      await postChatMessage(msg);
      setTeamChatDraft("");
      const next = await loadTeamChatMessages({ silent: true });
      const latestId = next.reduce((maxId, row) => Math.max(maxId, Number(row?.id) || 0), 0);
      if (latestId > 0) setTeamChatLastSeenId((prev) => Math.max(prev, latestId));
      setTeamChatUnreadCount(0);
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
    if (el) el.scrollTop = el.scrollHeight;
  }, [showTeamChat, teamChatMessages]);

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
