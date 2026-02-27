export default function TeamChatPanel({
  showTeamChat,
  setShowTeamChat,
  isLiveMode,
  isLiveMobile,
  topOffset,
  leftOffset,
  rightOffset,
  bottomOffset,
  desktopRightPx,
  desktopTopPx,
  liveBottomCarouselHeightPx,
  teamChatBodyRef,
  teamChatLoading,
  teamChatMessages,
  teamChatDraft,
  setTeamChatDraft,
  teamChatSending,
  teamChatUnreadCount,
  onSend,
  currentUserId,
  liveUsers = [],
}) {
  const liveCount = Array.isArray(liveUsers) ? liveUsers.length : 0;

  return (
    <>
      {showTeamChat ? (
        <div
          style={{
            position: "fixed",
            top: isLiveMode && isLiveMobile ? topOffset : desktopTopPx,
            left: isLiveMode && isLiveMobile ? leftOffset : undefined,
            right: isLiveMode && isLiveMobile ? 0 : rightOffset ?? (isLiveMode ? 8 : desktopRightPx),
            bottom: isLiveMode && isLiveMobile ? liveBottomCarouselHeightPx + 8 : bottomOffset,
            width: isLiveMode && isLiveMobile ? "auto" : 360,
            maxWidth: isLiveMode && isLiveMobile ? "none" : "calc(100vw - 24px)",
            height: isLiveMode && isLiveMobile ? "auto" : 420,
            maxHeight: isLiveMode && isLiveMobile ? "none" : "62vh",
            zIndex: isLiveMode && isLiveMobile ? 221 : 215,
            border: "1px solid var(--border)",
            borderRadius: isLiveMode && isLiveMobile ? 0 : 12,
            background: "var(--bg-elev)",
            boxShadow: "0 18px 42px rgba(0,0,0,0.34)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              minHeight: 42,
              padding: "6px 10px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "color-mix(in srgb, var(--bg-soft) 78%, var(--bg-elev) 22%)",
            }}
          >
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>Team Chat</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {liveCount ? `${liveCount} live: ${liveUsers.map((u) => u.username).join(", ")}` : "No live users"}
              </div>
            </div>
            <button
              onClick={() => setShowTeamChat(false)}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
          <div
            ref={teamChatBodyRef}
            className="vizi-scroll"
            style={{
              flex: "1 1 auto",
              overflowY: "auto",
              padding: 10,
              display: "grid",
              alignContent: "start",
              gap: 8,
              background: "var(--bg-soft)",
            }}
          >
            {teamChatLoading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading chat...</div>
            ) : teamChatMessages.length ? (
              teamChatMessages.map((row, idx) => {
                const id = Number(row?.id || 0);
                const mine = Number(row?.user_id || 0) === Number(currentUserId || 0);
                const at = row?.created_at ? new Date(row.created_at) : null;
                return (
                  <div
                    key={`team-chat-msg-${id || idx}`}
                    style={{
                      justifySelf: mine ? "end" : "start",
                      maxWidth: "88%",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "6px 8px",
                      background: mine
                        ? "linear-gradient(180deg, color-mix(in srgb, var(--accent) 22%, var(--bg-elev) 78%) 0%, color-mix(in srgb, var(--accent) 14%, var(--bg-elev) 86%) 100%)"
                        : "var(--bg-elev)",
                    }}
                  >
                    <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 2 }}>
                      {String(row?.author || "User")}
                      {at && !Number.isNaN(at.getTime()) ? ` • ${at.toLocaleString()}` : ""}
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.35, color: "var(--text)", whiteSpace: "pre-wrap" }}>
                      {String(row?.message || "")}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No messages yet.</div>
            )}
          </div>
          <div
            style={{
              borderTop: "1px solid var(--border)",
              background: "var(--bg-elev)",
              padding: 8,
              display: "grid",
              gap: 8,
            }}
          >
            <textarea
              value={teamChatDraft}
              onChange={(e) => setTeamChatDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              placeholder="Type message..."
              rows={2}
              style={{
                resize: "none",
                width: "100%",
                boxSizing: "border-box",
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: "var(--bg)",
                color: "var(--text)",
                padding: "6px 8px",
                fontSize: 12,
                outline: "none",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => void onSend()}
                disabled={teamChatSending || !String(teamChatDraft || "").trim()}
                style={{
                  border: "1px solid var(--accent)",
                  background: "linear-gradient(180deg, var(--accent) 0%, var(--accent-strong) 100%)",
                  color: "var(--accent-text)",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: teamChatSending ? "wait" : "pointer",
                  opacity: teamChatSending || !String(teamChatDraft || "").trim() ? 0.55 : 1,
                }}
              >
                {teamChatSending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!(isLiveMode && isLiveMobile) ? (
        <button
          title="Team Chat"
          onClick={() => setShowTeamChat((v) => !v)}
          style={{
            position: "fixed",
            right: rightOffset ?? (isLiveMode ? 8 : 20),
            bottom: isLiveMode && isLiveMobile ? liveBottomCarouselHeightPx + 10 : 16,
            width: 44,
            height: 44,
            zIndex: 216,
            borderRadius: 12,
            padding: 0,
            lineHeight: 0,
            border: "1px solid color-mix(in srgb, var(--accent) 36%, var(--border) 64%)",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--accent) 34%, var(--bg-elev) 66%) 0%, color-mix(in srgb, var(--accent) 20%, var(--bg-elev) 80%) 58%, color-mix(in srgb, var(--accent-strong) 22%, var(--bg-elev) 78%) 100%)",
            color: "var(--text)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            boxShadow: showTeamChat
              ? "0 12px 28px rgba(37, 99, 235, 0.34), inset 0 1px 0 rgba(255,255,255,0.26)"
              : "0 10px 24px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.18)",
            outline: showTeamChat ? "2px solid color-mix(in srgb, var(--accent) 42%, transparent)" : "none",
            outlineOffset: 1,
            transition: "transform 120ms ease, box-shadow 160ms ease, outline-color 160ms ease",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <path
              d="M4 7.25C4 5.73 5.23 4.5 6.75 4.5h10.5C18.77 4.5 20 5.73 20 7.25v6.5c0 1.52-1.23 2.75-2.75 2.75h-5.4l-3.55 2.95c-.62.51-1.55.07-1.55-.74V16.5h0c-1.52 0-2.75-1.23-2.75-2.75v-6.5Z"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="9" cy="10.6" r="1.1" fill="currentColor" />
            <circle cx="12" cy="10.6" r="1.1" fill="currentColor" />
            <circle cx="15" cy="10.6" r="1.1" fill="currentColor" />
          </svg>
          {teamChatUnreadCount > 0 ? (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 17,
                height: 17,
                borderRadius: 999,
                background: "#ef4444",
                color: "#fff",
                fontSize: 9,
                fontWeight: 800,
                display: "grid",
                placeItems: "center",
                border: "1px solid rgba(255,255,255,0.6)",
                padding: "0 4px",
                boxSizing: "border-box",
              }}
            >
              {teamChatUnreadCount > 99 ? "99+" : String(teamChatUnreadCount)}
            </span>
          ) : null}
        </button>
      ) : null}
    </>
  );
}
