import { requestJson } from "./http";

export function listChatMessages() {
  return requestJson("/api/chat/messages", { fallbackError: "Failed to load chat." });
}

export function postChatMessage(content) {
  return requestJson("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
    fallbackError: "Failed to send message.",
  });
}
