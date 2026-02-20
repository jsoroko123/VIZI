import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { toastError } from "../utils/toast";
import appLogo from "../assets/Images/logo.png";

export default function Login() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [microsoftEnabled, setMicrosoftEnabled] = useState(false);

  useEffect(() => {
    if (user) navigate("/");
  }, [user, navigate]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevHeight = document.body.style.height;
    const prevHtmlTheme = document.documentElement.getAttribute("data-theme");
    const prevBodyTheme = document.body.getAttribute("data-theme");
    const prevBodyBg = document.body.style.background;
    const prevBodyColor = document.body.style.color;
    const prevColorScheme = document.documentElement.style.colorScheme;

    document.documentElement.setAttribute("data-theme", "light");
    document.body.setAttribute("data-theme", "light");
    document.documentElement.style.colorScheme = "light";
    document.body.style.background = "#ebf1fb";
    document.body.style.color = "#111827";
    document.body.style.overflow = "hidden";
    document.body.style.height = "100vh";
    return () => {
      if (prevHtmlTheme == null) document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", prevHtmlTheme);
      if (prevBodyTheme == null) document.body.removeAttribute("data-theme");
      else document.body.setAttribute("data-theme", prevBodyTheme);
      document.documentElement.style.colorScheme = prevColorScheme;
      document.body.style.background = prevBodyBg;
      document.body.style.color = prevBodyColor;
      document.body.style.overflow = prevOverflow;
      document.body.style.height = prevHeight;
    };
  }, []);

  useEffect(() => {
    const msg = String(error || "").trim();
    if (!msg) return;
    toastError(msg);
  }, [error]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const msg = String(url.searchParams.get("error") || "").trim();
    if (msg) {
      setError(msg);
      url.searchParams.delete("error");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadProviders() {
      try {
        const res = await fetch("/api/auth/providers");
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !alive) return;
        setMicrosoftEnabled(Boolean(data?.providers?.microsoft?.enabled));
      } catch {
        if (alive) setMicrosoftEnabled(false);
      }
    }
    loadProviders();
    return () => {
      alive = false;
    };
  }, []);

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
          "radial-gradient(1300px 720px at -10% -18%, rgba(37, 99, 235, 0.26) 0%, transparent 58%), radial-gradient(980px 760px at 112% -8%, rgba(6, 182, 212, 0.14) 0%, transparent 52%), linear-gradient(155deg, #e8eef8 0%, #dfe8f4 50%, #e7edf7 100%)",
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
            "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.62), rgba(185,213,255,0.24) 42%, transparent 68%)",
          filter: "blur(10px)",
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
            "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.42), rgba(160,196,255,0.15) 46%, transparent 72%)",
          filter: "blur(14px)",
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
            "linear-gradient(112deg, rgba(43, 108, 255, 0.08) 0%, rgba(16, 185, 129, 0.06) 44%, rgba(43, 108, 255, 0.08) 100%)",
          opacity: 0.42,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(30, 58, 138, 0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(30, 58, 138, 0.09) 1px, transparent 1px)",
          backgroundSize: "34px 34px",
          opacity: 0.11,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(90deg, rgba(43, 108, 255, 0.2) 1px, transparent 1px), linear-gradient(rgba(43, 108, 255, 0.2) 1px, transparent 1px)",
          backgroundSize: "170px 170px",
          opacity: 0.14,
          pointerEvents: "none",
          maskImage:
            "radial-gradient(circle at 70% 20%, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.2) 45%, transparent 70%)",
        }}
      />
      <div
        style={{
          width: "min(420px, 90vw)",
          maxHeight: "92vh",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, rgba(246,249,255,0.96) 100%)",
          borderRadius: 20,
          border: "1px solid rgba(30, 64, 175, 0.16)",
          padding: 24,
          boxShadow:
            "0 30px 70px rgba(15, 23, 42, 0.22), 0 8px 26px rgba(30, 64, 175, 0.14), inset 0 1px 0 rgba(255,255,255,0.9)",
          backdropFilter: "blur(12px)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <img
              src={appLogo}
              alt="Mesora"
              style={{
                height: 42,
                width: "auto",
                maxWidth: "min(58vw, 260px)",
                display: "block",
                objectFit: "contain",
              }}
            />
            <div style={{ fontSize: 12, color: "#475467", marginTop: 4 }}>
              {mode === "login" ? "Sign in to continue." : "Create your first user."}
            </div>
          </div>
          <div
            style={{
              padding: "5px 9px",
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "rgba(30, 64, 175, 0.1)",
              color: "#1e40af",
              border: "1px solid rgba(30, 64, 175, 0.18)",
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
                border: "1px solid rgba(15, 23, 42, 0.18)",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 13,
                background: "rgba(255,255,255,0.98)",
                color: "#0f172a",
                outline: "none",
                boxShadow: "inset 0 1px 2px rgba(15,23,42,0.06), 0 1px 0 rgba(255,255,255,0.8)",
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
                border: "1px solid rgba(15, 23, 42, 0.18)",
                borderRadius: 12,
                padding: "12px 14px",
                fontSize: 13,
                background: "rgba(255,255,255,0.98)",
                color: "#0f172a",
                outline: "none",
                boxShadow: "inset 0 1px 2px rgba(15,23,42,0.06), 0 1px 0 rgba(255,255,255,0.8)",
              }}
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            style={{
              border: "1px solid #0f172a",
              background: "linear-gradient(180deg, #0f1a33 0%, #081229 100%)",
              color: "white",
              borderRadius: 12,
              padding: "12px 14px",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              boxShadow: "0 12px 24px rgba(15, 23, 42, 0.28)",
            }}
          >
            {busy ? "Working..." : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
        {mode === "login" && microsoftEnabled ? (
          <button
            type="button"
            onClick={() => {
              window.location.href = "/api/auth/microsoft/start";
            }}
            style={{
              marginTop: 10,
              width: "100%",
              border: "1px solid rgba(15, 23, 42, 0.2)",
              background: "linear-gradient(180deg, #ffffff 0%, #f1f5fb 100%)",
              color: "#0f172a",
              borderRadius: 12,
              padding: "11px 14px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Sign in with Microsoft
          </button>
        ) : null}
        <button
          onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
          style={{
            marginTop: 12,
            border: "none",
            background: "transparent",
            color: "#1d4ed8",
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {mode === "login" ? "Need a user? Create one." : "Have a user? Sign in."}
        </button>
      </div>
    </div>
  );
}
