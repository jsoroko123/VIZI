import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import AiTableBuilder from "./components/AiTableBuilder.jsx";
import DataBrowser from "./components/DataBrowser.jsx";
import OpcConfig from "./components/OpcConfig.jsx";
import Login from "./components/Login.jsx";
import { AuthProvider, useAuth } from "./components/AuthContext.jsx";

const THEME_KEY = "vizi_theme";

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // ignore
  }
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(theme) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  document.body.setAttribute("data-theme", next);
}

applyTheme(getInitialTheme());

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <div style={{ padding: 24 }}>Loading...</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <App />
              </RequireAuth>
            }
          />
          <Route
            path="/ai"
            element={
              <RequireAuth>
                <AiTableBuilder />
              </RequireAuth>
            }
          />
          <Route
            path="/data"
            element={
              <RequireAuth>
                <DataBrowser />
              </RequireAuth>
            }
          />
          <Route
            path="/data/:table"
            element={
              <RequireAuth>
                <DataBrowser />
              </RequireAuth>
            }
          />
          <Route
            path="/data/:table/:id"
            element={
              <RequireAuth>
                <DataBrowser />
              </RequireAuth>
            }
          />
          <Route
            path="/opc"
            element={
              <RequireAuth>
                <OpcConfig />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
)
