import { useEffect, useMemo, useRef, useState } from "react";

export default function AiTableBuilder() {
  const storageKey = "vizi_ai_table_builder_v1";
  const hydratedRef = useRef(false);
  const loadState = () => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return { messages: [] };
      const parsed = JSON.parse(raw);
      return {
        messages: parsed?.messages || [],
      };
    } catch {
      return { messages: [] };
    }
  };
  const initial = loadState();
  const [messages, setMessages] = useState(initial.messages);
  const [prompt, setPrompt] = useState("");
  const [activeTab, setActiveTab] = useState("chat");
  const [lastSql, setLastSql] = useState("");
  const [lastSummary, setLastSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [applyStatus, setApplyStatus] = useState("");
  const chatScrollRef = useRef(null);

  useEffect(() => {
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (activeTab !== "chat") return;
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeTab, messages.length]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      const payload = JSON.stringify({ messages });
      window.localStorage.setItem(storageKey, payload);
    } catch {
      // ignore
    }
  }, [messages]);

  const history = useMemo(
    () =>
      messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    [messages]
  );

  async function generate() {
    const text = prompt.trim();
    if (!text) return;

    setLoading(true);
    setError("");
    setApplyStatus("");

    const nextMessages = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setPrompt("");

    try {
      const historyWithNext = [
        ...history,
        { role: "user", content: text },
      ];
      const res = await fetch("/api/ai/table-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history: historyWithNext,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed.");

      const sqlText = String(data.sql || "").trim();
      if (!sqlText) throw new Error("No SQL returned.");
      const summaryText = String(data.summary || "").trim();
      setLastSql(sqlText);
      setLastSummary(summaryText);
      const applyRes = await fetch("/api/ai/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: sqlText }),
      });
      const applyData = await applyRes.json();
      if (!applyRes.ok) throw new Error(applyData?.error || "Apply failed.");
      setApplyStatus("Database updated successfully.");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: summaryText
            ? `${summaryText}\n\nApplied to database.`
            : "Applied to database.",
        },
      ]);
    } catch (err) {
      const message = err?.message || "Failed to generate/apply.";
      setError(message);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        color: "#111",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: "16px 16px 28px",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Vizi AI Table Builder</div>
            <div style={{ fontSize: 12, color: "#667085" }}>
              Describe the tables you want. SQL is generated and applied immediately.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={() => {
                setMessages([]);
                setPrompt("");
              }}
              style={{
                border: "1px solid #d0d7e2",
                background: "white",
                borderRadius: 10,
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Clear Session
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, flex: "1 1 auto", minHeight: 0 }}>
          <div
            style={{
              background: "white",
              border: "1px solid #e4e7ec",
              borderRadius: 12,
              padding: 14,
              boxShadow: "0 8px 20px rgba(0,0,0,0.06)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              height: "100%",
              marginTop: -10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>AI Table Builder</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setActiveTab("chat")}
                  style={{
                    border: "1px solid #d0d7e2",
                    background: activeTab === "chat" ? "#2b6cff" : "white",
                    color: activeTab === "chat" ? "white" : "#111",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Chat
                </button>
                <button
                  onClick={() => setActiveTab("preview")}
                  style={{
                    border: "1px solid #d0d7e2",
                    background: activeTab === "preview" ? "#2b6cff" : "white",
                    color: activeTab === "preview" ? "white" : "#111",
                    borderRadius: 999,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Preview
                </button>
              </div>
            </div>
            <div
              ref={chatScrollRef}
              style={{
                flex: 1,
                overflow: "auto",
                background: "#f8fafc",
                border: "1px solid #eef2f6",
                borderRadius: 10,
                padding: 10,
                fontSize: 13,
                marginBottom: 12,
                minHeight: 0,
              }}
            >
              {activeTab === "preview" ? (
                lastSql ? (
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#1d2939" }}>Last Request</div>
                    {lastSummary && (
                      <div
                        style={{
                          background: "#ffffff",
                          border: "1px solid #e4e7ec",
                          borderRadius: 8,
                          padding: 10,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {lastSummary}
                      </div>
                    )}
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#1d2939" }}>SQL Applied</div>
                    <pre
                      style={{
                        margin: 0,
                        background: "#0f172a",
                        color: "#e2e8f0",
                        padding: 12,
                        borderRadius: 8,
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {lastSql}
                    </pre>
                  </div>
                ) : (
                  <div style={{ color: "#98a2b3" }}>
                    No preview yet. Send a request to see the SQL.
                  </div>
                )
              ) : messages.length === 0 ? (
                <div style={{ color: "#98a2b3" }}>
                  Ask for tables like: "Create a users table with email, name, and created_at."
                </div>
              ) : (
                messages.map((m, i) => (
                  <div
                    key={`${m.role}-${i}`}
                    style={{
                      marginBottom: 10,
                      padding: "8px 10px",
                      borderRadius: 8,
                      background: m.role === "user" ? "#eef4ff" : "#ffffff",
                      border: "1px solid #e4e7ec",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                      {m.role === "user" ? "You" : "AI"}
                    </div>
                    {m.content}
                  </div>
                ))
              )}
            </div>

            <div
              style={{
                marginTop: "auto",
                background: "white",
                paddingTop: 10,
                marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe your tables..."
                  style={{
                    flex: 1,
                    border: "1px solid #d0d7e2",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 13,
                    outline: "none",
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      generate();
                    }
                  }}
                />
                <button
                  onClick={generate}
                  disabled={loading}
                  style={{
                    border: "1px solid #2b6cff",
                    background: "#2b6cff",
                    color: "white",
                    borderRadius: 10,
                    padding: "10px 14px",
                    cursor: "pointer",
                  }}
                >
                  {loading ? "Generating..." : "Send"}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ marginTop: 10, color: "#b42318", fontSize: 12 }}>{error}</div>
            )}
          </div>

          {applyStatus && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#12b76a" }}>{applyStatus}</div>
          )}
        </div>
      </div>
    </div>
  );
}
