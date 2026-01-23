console.log("[main.tsx] Script started loading");

// ===============================================
// Глобальные обработчики ошибок загрузки чанков
// (должны быть установлены до любых импортов)
// ===============================================

const CHUNK_RELOAD_KEY = "chunk-reload-attempt";
const CHUNK_RELOAD_COUNT_KEY = "chunk-reload-count";
const CHUNK_RELOAD_TIMEOUT = 5000; // 5 секунд между попытками
const MAX_RELOAD_ATTEMPTS = 2; // Максимум 2 автоматические попытки перезагрузки

/**
 * Проверяет, является ли ошибка ошибкой загрузки чанка
 */
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Loading chunk") ||
    message.includes("Loading CSS chunk") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Unable to preload CSS")
  );
}

/**
 * Проверяет, можно ли выполнить автоматическую перезагрузку
 */
function canAutoReload(): boolean {
  try {
    const lastReload = sessionStorage.getItem(CHUNK_RELOAD_KEY);
    const reloadCount = parseInt(sessionStorage.getItem(CHUNK_RELOAD_COUNT_KEY) || "0", 10);
    
    // Если достигли максимума попыток - не перезагружаем
    if (reloadCount >= MAX_RELOAD_ATTEMPTS) {
      console.warn(
        `[canAutoReload] Max reload attempts (${MAX_RELOAD_ATTEMPTS}) reached, stopping auto-reload`
      );
      return false;
    }
    
    if (!lastReload) return true;
    
    const timeSinceLastReload = Date.now() - parseInt(lastReload, 10);
    if (timeSinceLastReload > CHUNK_RELOAD_TIMEOUT) {
      // Если прошло достаточно времени - сбрасываем счетчик
      sessionStorage.setItem(CHUNK_RELOAD_COUNT_KEY, "0");
      return true;
    }
    
    return false;
  } catch {
    return true;
  }
}

/**
 * Выполняет автоматическую перезагрузку страницы
 */
function performAutoReload(): void {
  try {
    const currentCount = parseInt(sessionStorage.getItem(CHUNK_RELOAD_COUNT_KEY) || "0", 10);
    sessionStorage.setItem(CHUNK_RELOAD_KEY, Date.now().toString());
    sessionStorage.setItem(CHUNK_RELOAD_COUNT_KEY, (currentCount + 1).toString());
    console.info(`[performAutoReload] Performing reload attempt ${currentCount + 1}/${MAX_RELOAD_ATTEMPTS}`);
  } catch {
    // sessionStorage может быть недоступен
  }
  window.location.reload();
}

// Обработчик ошибок скриптов (например, при загрузке через <script> или preload)
window.onerror = function (message, source, lineno, colno, error) {
  console.error("[main.tsx] Global error:", { message, source, lineno, colno, error });
  
  const messageStr = typeof message === "string" ? message : String(message);
  
  if (isChunkLoadError(error) || isChunkLoadError(messageStr)) {
    console.warn("[main.tsx] Chunk load error detected via window.onerror");
    if (canAutoReload()) {
      console.info("[main.tsx] Performing auto-reload...");
      performAutoReload();
      return true; // Предотвращаем дальнейшую обработку
    }
  }
  
  return false;
};

// Обработчик необработанных promise rejection (включая ошибки dynamic import)
window.onunhandledrejection = function (event) {
  const error = event.reason;
  console.error("[main.tsx] Unhandled rejection:", error);
  
  if (isChunkLoadError(error)) {
    console.warn("[main.tsx] Chunk load error detected via unhandledrejection");
    if (canAutoReload()) {
      console.info("[main.tsx] Performing auto-reload...");
      event.preventDefault(); // Предотвращаем вывод в консоль
      performAutoReload();
    }
  }
};

console.log("[main.tsx] Global error handlers installed");

// ===============================================
// Основные импорты приложения
// ===============================================

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
