import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { inject } from "@vercel/analytics";
import { ClientSync } from "./lib/sync";

const rootEl = document.getElementById("root")!;
inject();
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
createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
