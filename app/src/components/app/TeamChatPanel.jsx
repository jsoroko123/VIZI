import { useEffect, useMemo, useRef, useState } from "react";

export default function TeamChatPanel({
  showTeamChat,
  setShowTeamChat,
  isLiveMode,
  canAskAi = false,
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
  onUploadL5x,
  onClearL5x,
  chatContextDocs = [],
  chatContextUploading = false,
  currentUserId,
  liveUsers = [],
}) {
  const [activeTab, setActiveTab] = useState("team");
  const [aiSendingLabel, setAiSendingLabel] = useState("Thinking...");
  const aiLabelTimerRef = useRef(0);
  const l5xInputRef = useRef(null);
  const normalizedTab = canAskAi ? activeTab : "team";
  const liveCount = Array.isArray(liveUsers) ? liveUsers.length : 0;
  const aiBusyLabels = useMemo(
    () => [
      "Juggling valves...",
      "Developing brilliance...",
      "Perfecting the plan...",
      "Wrangling tiny robots...",
      "Polishing pixels...",
      "Negotiating with semicolons...",
      "Untangling logic noodles...",
      "Calibrating wizardry...",
      "Assembling cleverness...",
      "Tuning flour-powered AI...",
      "Chasing runaway commas...",
      "Stacking control blocks...",
      "Warming up the PLC gremlins...",
      "Aligning conveyor thoughts...",
      "Herding rogue bits...",
      "Refactoring the universe...",
      "Debugging with dramatic flair...",
      "Sharpening ladder logic...",
      "Synchronizing sprockets...",
      "Compiling confidence...",
      "Spinning up smart guesses...",
      "Adjusting imaginary setpoints...",
      "Rewiring brilliance circuits...",
      "Dusting off the AOIs...",
      "Inspecting interlock mysteries...",
      "Summoning deterministic chaos...",
      "Tightening virtual bolts...",
      "Counting very serious beans...",
      "Cross-checking every rung...",
      "Whispering to state machines...",
      "Polishing the command queue...",
      "Auditing mischievous tags...",
      "Balancing pneumatic vibes...",
      "Hunting the missing permissive...",
      "Untying nested condition knots...",
      "Charging the thought buffer...",
      "Negotiating with edge cases...",
      "Greasing the data pipeline...",
      "Brewing fresh diagnostics...",
      "Organizing tiny electrons...",
      "Rehearsing flawless startup...",
      "Decoding conveyor poetry...",
      "Sorting airborne flour facts...",
      "Calming down oscillating booleans...",
      "Aligning logic with reality...",
      "Sweeping for stale values...",
      "Preheating answer engines...",
      "Translating machine feelings...",
      "Inspecting stubborn rungs...",
      "Curating premium insights...",
    ],
    []
  );

  const isAiAuthor = (row) => String(row?.author || "").trim().toLowerCase() === "mesora ai";
  const isAiPrompt = (row) => /^\/ai\b/i.test(String(row?.message || "").trim());

  const teamOnlyMessages = useMemo(
    () => (Array.isArray(teamChatMessages) ? teamChatMessages.filter((row) => !isAiAuthor(row) && !isAiPrompt(row)) : []),
    [teamChatMessages]
  );
  const aiOnlyMessages = useMemo(
    () => (Array.isArray(teamChatMessages) ? teamChatMessages.filter((row) => isAiAuthor(row) || isAiPrompt(row)) : []),
    [teamChatMessages]
  );
  const visibleMessages = normalizedTab === "ai" ? aiOnlyMessages : teamOnlyMessages;

  const resolvedRight = isLiveMode && isLiveMobile
    ? 0
    : (rightOffset ?? (isLiveMode ? 8 : (desktopRightPx ?? 20)));
  const resolvedBottom = isLiveMode && isLiveMobile
    ? liveBottomCarouselHeightPx + 8
    : (Number(bottomOffset) > 0 ? Number(bottomOffset) : 16);

  useEffect(() => {
    if (!(normalizedTab === "ai" && teamChatSending)) {
      setAiSendingLabel("Thinking...");
      if (aiLabelTimerRef.current) {
        window.clearInterval(aiLabelTimerRef.current);
        aiLabelTimerRef.current = 0;
      }
      return;
    }
    const pick = (prev = "") => {
      const list = Array.isArray(aiBusyLabels) ? aiBusyLabels : [];
      if (!list.length) return "Thinking...";
      if (list.length === 1) return list[0];
      let next = prev || list[Math.floor(Math.random() * list.length)];
      let guard = 0;
      while (next === prev && guard < 8) {
        next = list[Math.floor(Math.random() * list.length)];
        guard += 1;
      }
      return next;
    };
    setAiSendingLabel((prev) => pick(prev));
    aiLabelTimerRef.current = window.setInterval(() => {
      setAiSendingLabel((prev) => pick(prev));
    }, 5000);
    return () => {
      if (aiLabelTimerRef.current) {
        window.clearInterval(aiLabelTimerRef.current);
        aiLabelTimerRef.current = 0;
      }
    };
  }, [normalizedTab, teamChatSending, aiBusyLabels]);

  return (
    <>
      {showTeamChat ? (
        <div
          style={{
            position: "fixed",
            top: isLiveMode && isLiveMobile ? topOffset : undefined,
            left: isLiveMode && isLiveMobile ? leftOffset : undefined,
            right: resolvedRight,
            bottom: resolvedBottom,
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
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                {normalizedTab === "ai" ? "AI Chat" : "Team Chat"}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                {normalizedTab === "ai"
                  ? (isLiveMode ? "Milling AI Assistant" : "Design AI Assistant")
                  : (liveCount ? `${liveCount} live: ${liveUsers.map((u) => u.username).join(", ")}` : "No live users")}
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
            style={{
              display: "flex",
              gap: 6,
              padding: "7px 10px",
              borderBottom: "1px solid var(--border)",
              background: "color-mix(in srgb, var(--bg-soft) 62%, var(--bg-elev) 38%)",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("team")}
              style={{
                border: "1px solid var(--border)",
                background: normalizedTab === "team" ? "var(--selected-bg)" : "var(--bg-elev)",
                color: normalizedTab === "team" ? "var(--selected-text)" : "var(--text)",
                borderRadius: 8,
                padding: "5px 10px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: normalizedTab === "team" ? "var(--selected-shadow)" : "none",
              }}
            >
              Team Chat
            </button>
            {canAskAi ? (
              <button
                type="button"
                onClick={() => setActiveTab("ai")}
                style={{
                  border: "1px solid var(--border)",
                  background: normalizedTab === "ai" ? "var(--selected-bg)" : "var(--bg-elev)",
                  color: normalizedTab === "ai" ? "var(--selected-text)" : "var(--text)",
                  borderRadius: 8,
                  padding: "5px 10px",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: normalizedTab === "ai" ? "var(--selected-shadow)" : "none",
                }}
              >
                AI Chat
              </button>
            ) : null}
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
            ) : visibleMessages.length ? (
              visibleMessages.map((row, idx) => {
                const id = Number(row?.id || 0);
                const mine = Number(row?.user_id || 0) === Number(currentUserId || 0);
                const at = row?.created_at ? new Date(row.created_at) : null;
                const messageText = String(row?.message || "");
                const cleanText = normalizedTab === "ai" && isAiPrompt(row)
                  ? messageText.replace(/^\/ai\s*/i, "")
                  : messageText;
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
                      {at && !Number.isNaN(at.getTime()) ? ` | ${at.toLocaleString()}` : ""}
                    </div>
                    <div style={{ fontSize: 12, lineHeight: 1.35, color: "var(--text)", whiteSpace: "pre-wrap" }}>
                      {cleanText}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                {normalizedTab === "ai" ? "No AI messages yet." : "No team messages yet."}
              </div>
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
            {normalizedTab === "ai" ? (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    L5X Context: {Array.isArray(chatContextDocs) ? chatContextDocs.length : 0} loaded
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      ref={l5xInputRef}
                      type="file"
                      accept=".l5x,.l5k,.xml,.txt,text/plain,text/xml,application/xml"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e?.target?.files?.[0] || null;
                        if (file && typeof onUploadL5x === "function") void onUploadL5x(file);
                        if (e?.target) e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => l5xInputRef.current?.click()}
                      disabled={chatContextUploading}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text)",
                        borderRadius: 8,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: chatContextUploading ? "wait" : "pointer",
                        opacity: chatContextUploading ? 0.6 : 1,
                      }}
                    >
                      {chatContextUploading ? "Uploading..." : "Load L5X"}
                    </button>
                    <button
                      type="button"
                      onClick={() => typeof onClearL5x === "function" && onClearL5x()}
                      disabled={chatContextUploading || !(Array.isArray(chatContextDocs) && chatContextDocs.length)}
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text-muted)",
                        borderRadius: 8,
                        padding: "4px 8px",
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: chatContextUploading ? "wait" : "pointer",
                        opacity: chatContextUploading || !(Array.isArray(chatContextDocs) && chatContextDocs.length) ? 0.5 : 1,
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {Array.isArray(chatContextDocs) && chatContextDocs[0] ? (
                  <div style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Latest: {String(chatContextDocs[0]?.source_name || "upload.l5x")} {String(chatContextDocs[0]?.content_summary || "").trim() ? `| ${String(chatContextDocs[0]?.content_summary || "").trim()}` : ""}
                  </div>
                ) : null}
              </div>
            ) : null}
            <textarea
              value={teamChatDraft}
              onChange={(e) => setTeamChatDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (normalizedTab === "ai" && canAskAi) {
                    void onSend({ askAi: true, forceAiPrefix: true });
                  } else {
                    void onSend();
                  }
                }
              }}
              placeholder={
                normalizedTab === "ai"
                  ? (isLiveMode ? "Ask milling ops..." : "Ask design/build questions...")
                  : "Type message..."
              }
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
              {normalizedTab === "ai" && canAskAi ? (
                <button
                  onClick={() => void onSend({ askAi: true, forceAiPrefix: true })}
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
                  title="Ask Mesora AI using Ollama"
                >
                  {teamChatSending ? aiSendingLabel : "Ask AI"}
                </button>
              ) : null}

              {normalizedTab === "team" ? (
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
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!(isLiveMode && isLiveMobile) && !showTeamChat ? (
        <button
          title="Team Chat"
          onClick={() => setShowTeamChat((v) => !v)}
          style={{
            position: "fixed",
            right: resolvedRight,
            bottom: resolvedBottom,
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
