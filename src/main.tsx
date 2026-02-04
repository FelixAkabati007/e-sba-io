import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";

const rootEl = document.getElementById("root")!;
if (import.meta.env.PROD) {
  import("@vercel/analytics").then(({ inject }) => {
    try {
      inject();
    } catch {
      // no-op
    }
  });
}

if (import.meta.env.PROD) {
  window.addEventListener("error", (event) => {
    const name = (event as unknown as { error?: { name?: string } }).error?.name || "";
    const msg = event.message?.toLowerCase() || "";
    const isChunkError =
      name === "ChunkLoadError" ||
      msg.includes("chunk load error") ||
      msg.includes("loading chunk") ||
      msg.includes("loading css chunk") ||
      msg.includes("importing a module script failed");
    if (isChunkError) {
      const lastReload = sessionStorage.getItem("chunk_reload_ts");
      const now = Date.now();
      if (!lastReload || now - parseInt(lastReload) > 10000) {
        sessionStorage.setItem("chunk_reload_ts", String(now));
        window.location.reload();
      }
    }
  });
}

createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ProtectedRoute>
          <App />
        </ProtectedRoute>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
