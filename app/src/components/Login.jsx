import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { toastError } from "../utils/toast";

export default function Login() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) navigate("/");
  }, [user, navigate]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevHeight = document.body.style.height;
    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.height = prevHeight;
    };
  }, []);

  useEffect(() => {
    const msg = String(error || "").trim();
    if (!msg) return;
    toastError(msg);
  }, [error]);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") {
        await register(username, password);
      }
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError(err?.message || "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        placeItems: "center",
        background:
          "radial-gradient(1200px 700px at 10% -10%, rgba(14, 165, 233, 0.18) 0%, transparent 55%), radial-gradient(900px 700px at 110% 0%, rgba(34, 197, 94, 0.14) 0%, transparent 50%), linear-gradient(160deg, #f6f7fb 0%, #eef2f7 50%, #f2f4fb 100%)",
        padding: "32px 24px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.55), rgba(255,255,255,0.18) 40%, transparent 65%)",
          filter: "blur(6px)",
          top: -120,
          right: -120,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: "auto",
          width: 640,
          height: 640,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.35), rgba(255,255,255,0.12) 45%, transparent 70%)",
          filter: "blur(10px)",
          bottom: -160,
          left: -160,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(115deg, rgba(14, 165, 233, 0.08) 0%, rgba(34, 197, 94, 0.06) 40%, rgba(14, 165, 233, 0.08) 100%)",
          opacity: 0.35,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(15, 23, 42, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.08) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          opacity: 0.08,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(90deg, rgba(14, 165, 233, 0.18) 1px, transparent 1px), linear-gradient(rgba(14, 165, 233, 0.18) 1px, transparent 1px)",
          backgroundSize: "160px 160px",
          opacity: 0.12,
          pointerEvents: "none",
          maskImage:
            "radial-gradient(circle at 70% 20%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 45%, transparent 70%)",
        }}
      />
      <div
        style={{
          width: "min(420px, 90vw)",
          maxHeight: "92vh",
          background: "rgba(255,255,255,0.92)",
          borderRadius: 22,
          border: "1px solid rgba(15, 23, 42, 0.08)",
          padding: 28,
          boxShadow:
            "0 30px 60px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255,255,255,0.8)",
          backdropFilter: "blur(10px)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <img
              src="/mesora-logo.svg"
              alt="Mesora"
              style={{ height: 38, width: "auto", display: "block" }}
            />
            <div style={{ fontSize: 12, color: "#475467", marginTop: 4 }}>
              {mode === "login" ? "Sign in to continue." : "Create your first user."}
            </div>
          </div>
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "rgba(255, 125, 80, 0.12)",
              color: "#c2410c",
            }}
          >
            {mode === "login" ? "Login" : "Create"}
          </div>
        </div>
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              style={{
                border: "1px solid rgba(15, 23, 42, 0.12)",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 13,
                background: "rgba(255,255,255,0.9)",
                outline: "none",
                boxShadow: "inset 0 1px 2px rgba(15,23,42,0.06)",
              }}
            />
          </label>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              style={{
                border: "1px solid rgba(15, 23, 42, 0.12)",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 13,
                background: "rgba(255,255,255,0.9)",
                outline: "none",
                boxShadow: "inset 0 1px 2px rgba(15,23,42,0.06)",
              }}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            style={{
              border: "1px solid #111827",
              background: "linear-gradient(180deg, #111827 0%, #0b1220 100%)",
              color: "white",
              borderRadius: 12,
              padding: "12px 14px",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              boxShadow: "0 12px 24px rgba(15, 23, 42, 0.2)",
            }}
          >
            {busy ? "Working..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
        <button
          onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
          style={{
            marginTop: 12,
            border: "none",
            background: "transparent",
            color: "#0b5fff",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {mode === "login" ? "Need a user? Create one." : "Have a user? Sign in."}
        </button>
      </div>
    </div>
  );
}
