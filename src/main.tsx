import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { inject } from "@vercel/analytics";
import { ClientSync } from "./lib/sync";
import { supabase } from "./lib/supabase";

const rootEl = document.getElementById("root")!;
if (import.meta.env.PROD) inject();
const token =
  typeof localStorage !== "undefined"
    ? localStorage.getItem("BLOB_RW_TOKEN") || undefined
    : undefined;
const clientSync = new ClientSync({
  baseUrl: "/api",
  token,
  throttleMs: 1000,
  batchSize: 50,
});
clientSync.start();

(async () => {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from("instruments").select().limit(1);
    if (error) {
      console.warn("[Supabase]", { error });
    } else {
      console.info("[Supabase]", { ok: true, sample: data });
    }
  } catch (e) {
    console.error("[Supabase]", { e });
  }
})();
createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
