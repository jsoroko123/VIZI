import { useEffect, useMemo, useState } from "react";
import { toastError, toastSuccess } from "../utils/toast";

function makeNewAgent(index = 0) {
  const id = `agent-${Date.now().toString(36)}-${Math.max(0, Number(index) || 0).toString(36)}`;
  return {
    id,
    name: `AI Agent ${Math.max(1, Number(index) + 1 || 1)}`,
    provider: "openai",
    model: "gpt-5",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    ollamaNativeUrl: "",
    enabled: true,
  };
}

export default function AiConfigPanel({ embedded = false }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providers, setProviders] = useState([]);
  const [config, setConfig] = useState({
    activeAgentId: "",
    agents: [makeNewAgent(0)],
  });

  const activeAgent = useMemo(
    () => (Array.isArray(config.agents) ? config.agents.find((a) => a.id === config.activeAgentId) || null : null),
    [config]
  );

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/ai/config");
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(String(data?.error || "Failed to load AI config."));
        if (!alive) return;
        setProviders(Array.isArray(data?.providers) ? data.providers : []);
        const incoming = data?.config && typeof data.config === "object" ? data.config : {};
        const agents = Array.isArray(incoming.agents) && incoming.agents.length ? incoming.agents : [makeNewAgent(0)];
        const activeAgentId = String(incoming.activeAgentId || "").trim() || String(agents[0]?.id || "");
        setConfig({ activeAgentId, agents });
      } catch (err) {
        if (alive) toastError(err?.message || "Failed to load AI config.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  function updateAgent(id, patch) {
    setConfig((prev) => ({
      ...prev,
      agents: (Array.isArray(prev.agents) ? prev.agents : []).map((agent) =>
        String(agent?.id || "") === String(id || "") ? { ...agent, ...patch } : agent
      ),
    }));
  }

  function addAgent() {
    setConfig((prev) => {
      const agents = Array.isArray(prev.agents) ? prev.agents : [];
      const next = [...agents, makeNewAgent(agents.length)];
      return {
        ...prev,
        agents: next,
        activeAgentId: String(prev.activeAgentId || "").trim() || String(next[0]?.id || ""),
      };
    });
  }

  function removeAgent(id) {
    setConfig((prev) => {
      const filtered = (Array.isArray(prev.agents) ? prev.agents : []).filter(
        (agent) => String(agent?.id || "") !== String(id || "")
      );
      const nextAgents = filtered.length ? filtered : [makeNewAgent(0)];
      const nextActive = nextAgents.some((agent) => agent.id === prev.activeAgentId)
        ? prev.activeAgentId
        : nextAgents[0].id;
      return {
        ...prev,
        agents: nextAgents,
        activeAgentId: nextActive,
      };
    });
  }

  async function saveConfig() {
    setSaving(true);
    try {
      const payload = {
        config: {
          version: 1,
          activeAgentId: String(config.activeAgentId || "").trim(),
          agents: Array.isArray(config.agents) ? config.agents : [],
        },
      };
      const res = await fetch("/api/ai/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || "Failed to save AI config."));
      toastSuccess("AI config saved.");
    } catch (err) {
      toastError(err?.message || "Failed to save AI config.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        background: "var(--bg)",
        color: "var(--text)",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "none",
          margin: 0,
          padding: embedded ? "12px" : "18px 16px 28px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>AI Config</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Configure multiple AI agents and choose the active provider for AI features.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                window.location.assign("/ai");
              }}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg-elev)",
                color: "var(--text)",
                borderRadius: 10,
                padding: "8px 12px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Back To AI
            </button>
            <button
              onClick={saveConfig}
              disabled={saving || loading}
              style={{
                border: "1px solid #2b6cff",
                background: "#2b6cff",
                color: "white",
                borderRadius: 10,
                padding: "8px 12px",
                cursor: saving || loading ? "default" : "pointer",
                opacity: saving || loading ? 0.7 : 1,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {saving ? "Saving..." : "Save Config"}
            </button>
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Agents</div>
            <button
              onClick={addAgent}
              disabled={loading}
              style={{
                border: "1px solid var(--border)",
                background: "var(--bg)",
                color: "var(--text)",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: loading ? "default" : "pointer",
                fontSize: 12,
              }}
            >
              Add Agent
            </button>
          </div>

          {(Array.isArray(config.agents) ? config.agents : []).map((agent, idx) => (
            (() => {
              const isActive = String(config.activeAgentId || "") === String(agent?.id || "");
              return (
            <div
              key={String(agent?.id || idx)}
              style={{
                border: isActive ? "2px solid #2b6cff" : "1px solid var(--border)",
                borderRadius: 10,
                padding: 10,
                marginBottom: 10,
                background: isActive ? "rgba(43,108,255,0.08)" : "var(--bg)",
                boxShadow: isActive ? "0 0 0 1px rgba(43,108,255,0.25) inset" : "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <input
                    type="radio"
                    name="active-ai-agent"
                    checked={isActive}
                    onChange={() =>
                      setConfig((prev) => ({
                        ...prev,
                        activeAgentId: String(agent?.id || ""),
                      }))
                    }
                  />
                  Active Runtime
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={agent?.enabled !== false}
                    onChange={(e) => updateAgent(agent?.id, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>
                <div style={{ marginLeft: "auto" }}>
                  <button
                    onClick={() => removeAgent(agent?.id)}
                    style={{
                      border: "1px solid #ff5f57",
                      background: "#ff5f57",
                      color: "white",
                      borderRadius: 8,
                      padding: "5px 9px",
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 8,
                }}
              >
                <input
                  value={String(agent?.name || "")}
                  onChange={(e) => updateAgent(agent?.id, { name: e.target.value })}
                  placeholder="Agent name"
                  style={{
                    width: "100%",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    padding: "8px 9px",
                    boxSizing: "border-box",
                  }}
                />
                <select
                  value={String(agent?.provider || "openai")}
                  onChange={(e) => updateAgent(agent?.id, { provider: e.target.value })}
                  style={{
                    width: "100%",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    padding: "8px 9px",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="openai">OpenAI</option>
                  <option value="openai_compatible">OpenAI-Compatible</option>
                  <option value="azure_openai">Azure OpenAI</option>
                  <option value="anthropic">Anthropic (Compatible Gateway)</option>
                  <option value="google">Google Gemini (Compatible Gateway)</option>
                  <option value="ollama">Ollama</option>
                </select>
                <input
                  value={String(agent?.model || "")}
                  onChange={(e) => updateAgent(agent?.id, { model: e.target.value })}
                  placeholder="Model (e.g., gpt-5, llama3.2)"
                  style={{
                    width: "100%",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    padding: "8px 9px",
                    boxSizing: "border-box",
                  }}
                />
                <input
                  value={String(agent?.baseUrl || "")}
                  onChange={(e) => updateAgent(agent?.id, { baseUrl: e.target.value })}
                  placeholder="Base URL (e.g., https://api.openai.com/v1)"
                  style={{
                    width: "100%",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    padding: "8px 9px",
                    boxSizing: "border-box",
                  }}
                />
                <input
                  value={String(agent?.apiKey || "")}
                  onChange={(e) => updateAgent(agent?.id, { apiKey: e.target.value })}
                  placeholder="API key"
                  style={{
                    width: "100%",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    padding: "8px 9px",
                    boxSizing: "border-box",
                  }}
                />
                <input
                  value={String(agent?.ollamaNativeUrl || "")}
                  onChange={(e) => updateAgent(agent?.id, { ollamaNativeUrl: e.target.value })}
                  placeholder="Ollama native URL (optional, e.g., http://localhost:11434)"
                  style={{
                    width: "100%",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--bg-elev)",
                    color: "var(--text)",
                    padding: "8px 9px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
              );
            })()
          ))}
          {!loading && !activeAgent ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Pick one active AI agent.</div>
          ) : null}
        </div>

        <div
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Provider Links</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
            {(Array.isArray(providers) ? providers : []).map((provider) => (
              <div
                key={String(provider?.key || "")}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: 10,
                  background: "var(--bg)",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  {String(provider?.label || provider?.key || "")}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <a
                    href={String(provider?.docsUrl || "#")}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, color: "#2b6cff", textDecoration: "none" }}
                  >
                    Docs
                  </a>
                  <a
                    href={String(provider?.signupUrl || "#")}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, color: "#2b6cff", textDecoration: "none" }}
                  >
                    Signup / Console
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
