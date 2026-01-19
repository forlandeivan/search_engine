console.log("[main.tsx] Script started loading");

import { createRoot } from "react-dom/client";
console.log("[main.tsx] react-dom/client loaded, createRoot:", typeof createRoot);

import React from "react";
console.log("[main.tsx] React loaded, version:", React.version, "forwardRef:", typeof React.forwardRef);

import App from "./App";
console.log("[main.tsx] App component loaded");

import "./index.css";
console.log("[main.tsx] CSS loaded");

try {
  const rootElement = document.getElementById("root");
  console.log("[main.tsx] Root element:", rootElement);
  
  if (!rootElement) {
    throw new Error("Root element not found");
  }
  
  const root = createRoot(rootElement);
  console.log("[main.tsx] Root created, rendering App...");
  
  root.render(<App />);
  console.log("[main.tsx] App rendered successfully");
} catch (error) {
  console.error("[main.tsx] FATAL ERROR:", error);
  
  // Show error on page
  const rootElement = document.getElementById("root");
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: monospace; background: #fee; color: #900;">
        <h2>Application Error</h2>
        <pre>${error instanceof Error ? error.stack || error.message : String(error)}</pre>
      </div>
    `;
  }
}
