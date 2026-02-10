import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import AiTableBuilder from "./components/AiTableBuilder.jsx";
import DataBrowser from "./components/DataBrowser.jsx";
import OpcConfig from "./components/OpcConfig.jsx";

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/ai" element={<AiTableBuilder />} />
        <Route path="/data" element={<DataBrowser />} />
        <Route path="/data/:table" element={<DataBrowser />} />
        <Route path="/data/:table/:id" element={<DataBrowser />} />
        <Route path="/opc" element={<OpcConfig />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
