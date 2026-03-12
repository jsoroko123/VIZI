import { requestJson } from "./http";

export function listChatMessages(options = {}) {
  const chatMode = String(options?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
  return requestJson(`/api/chat/messages?chatMode=${encodeURIComponent(chatMode)}`, {
    fallbackError: "Failed to load chat.",
  });
}

export function postChatMessage(content) {
  const text = String(content ?? "");
  return requestJson("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
    fallbackError: "Failed to send message.",
  });
}

export function postChatMessageWithAi(content, options = {}) {
  const text = String(content ?? "");
  const askAi = options?.askAi === true;
  const aiPrompt = String(options?.aiPrompt || "").trim();
  const history = Array.isArray(options?.history) ? options.history : [];
  const chatMode = String(options?.chatMode || "").trim().toLowerCase();
  return requestJson("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: text,
      askAi,
      aiPrompt,
      history,
      chatMode: chatMode === "live" ? "live" : "design",
    }),
    fallbackError: "Failed to send message.",
  });
}

export function listChatContextDocs(options = {}) {
  const chatMode = String(options?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
  return requestJson(`/api/chat/context-docs?chatMode=${encodeURIComponent(chatMode)}`, {
    fallbackError: "Failed to load L5X.",
  });
}

export function uploadChatContextL5x(fileName, content, options = {}) {
  const chatMode = String(options?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
  return requestJson("/api/chat/context-docs/l5x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: String(fileName || "").trim(),
      content: String(content || ""),
      chatMode,
    }),
    fallbackError: "Failed to upload L5X context.",
  });
}

export function clearChatContextDocs(options = {}) {
  const chatMode = String(options?.chatMode || "").trim().toLowerCase() === "live" ? "live" : "design";
  return requestJson(`/api/chat/context-docs?chatMode=${encodeURIComponent(chatMode)}`, {
    method: "DELETE",
    fallbackError: "Failed to clear AI context docs.",
  });
}
