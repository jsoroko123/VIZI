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
