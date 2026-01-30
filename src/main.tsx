import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { inject } from "@vercel/analytics";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";

const rootEl = document.getElementById("root")!;
if (import.meta.env.PROD) inject();

// Global handler for chunk loading errors (Asset 404s due to version skew)
window.addEventListener("error", (event) => {
  const msg = event.message?.toLowerCase() || "";
  const isChunkError =
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("importing a module script failed");
  
  if (isChunkError) {
    console.warn("Chunk load error detected. Reloading page to fetch latest version...");
    // Prevent infinite reload loops
    const lastReload = sessionStorage.getItem("chunk_reload_ts");
    const now = Date.now();
    if (!lastReload || now - parseInt(lastReload) > 10000) {
      sessionStorage.setItem("chunk_reload_ts", String(now));
      window.location.reload();
    }
  }
});

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
