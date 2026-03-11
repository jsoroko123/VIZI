import { requestJson } from "./http";

export function listChatMessages() {
  return requestJson("/api/chat/messages", { fallbackError: "Failed to load chat." });
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
