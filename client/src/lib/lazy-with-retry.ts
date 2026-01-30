import { lazy, type ComponentType } from "react";

// Ключ для предотвращения бесконечных перезагрузок
const RELOAD_KEY = "chunk-reload-attempt";
const RELOAD_COUNT_KEY = "chunk-reload-count";
const MAX_RELOAD_ATTEMPTS = 2; // Максимум 2 автоматические попытки перезагрузки
// Сбрасываем счетчик попыток, если ошибка произошла "давно".
// Это нужно, чтобы не блокировать авто-рефреш навсегда в рамках одной sessionStorage-сессии.
const RELOAD_RESET_AFTER_MS = 60_000; // 1 минута

/**
 * Проверяет, является ли ошибка ошибкой загрузки чанка (dynamic import)
 * Это происходит когда:
 * - Выкачена новая версия приложения с новыми хешами файлов
 * - Старые файлы удалены или недоступны
 * - Браузер пытается загрузить старый файл по старому URL
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    // Vite / ES modules
    message.includes("Failed to fetch dynamically imported module") ||
    // Webpack
    message.includes("Loading chunk") ||
    message.includes("Loading CSS chunk") ||
    // Safari / другие браузеры
    message.includes("Importing a module script failed") ||
    // Дополнительные паттерны
    message.includes("error loading dynamically imported module") ||
    message.includes("Unable to preload CSS")
  );
}

/**
 * Проверяет, можно ли выполнить автоматическую перезагрузку
 * (защита от бесконечного цикла перезагрузок)
 */
export function canAutoReload(): boolean {
  try {
    const lastReload = sessionStorage.getItem(RELOAD_KEY);
    let reloadCount = parseInt(sessionStorage.getItem(RELOAD_COUNT_KEY) || "0", 10);
    if (!Number.isFinite(reloadCount) || reloadCount < 0) {
      reloadCount = 0;
    }
    
    // Если достигли максимума попыток - не перезагружаем
    if (reloadCount >= MAX_RELOAD_ATTEMPTS) {
      console.warn(
        `[canAutoReload] Max reload attempts (${MAX_RELOAD_ATTEMPTS}) reached, stopping auto-reload`
      );
      return false;
    }
    
    // Если нет записи о последней перезагрузке - можно перезагружать
    if (!lastReload) {
      return true;
    }
    
    // Если с последней попытки прошло достаточно времени — сбрасываем счетчик
    const now = Date.now();
    const last = parseInt(lastReload, 10);
    const timeSinceLastReload = Number.isFinite(last) ? now - last : Number.POSITIVE_INFINITY;

    if (timeSinceLastReload > RELOAD_RESET_AFTER_MS) {
      sessionStorage.setItem(RELOAD_COUNT_KEY, "0");
    }

    // Важно: НЕ блокируем повторный reload по таймеру.
    // В dev режиме (Vite) "Outdated Optimize Dep" может потребовать 1-2 быстрых перезагрузки,
    // а лимит MAX_RELOAD_ATTEMPTS уже защищает от бесконечного цикла.
    return true;
  } catch (error) {
    console.error("[canAutoReload] Error checking reload status:", error);
    return true; // В случае ошибки разрешаем перезагрузку
  }
}

/**
 * Выполняет автоматическую перезагрузку страницы
 * с сохранением времени перезагрузки для защиты от бесконечного цикла
 */
export function performAutoReload(): void {
  try {
    const currentCount = parseInt(sessionStorage.getItem(RELOAD_COUNT_KEY) || "0", 10);
    sessionStorage.setItem(RELOAD_KEY, Date.now().toString());
    sessionStorage.setItem(RELOAD_COUNT_KEY, (currentCount + 1).toString());
    console.info(`[performAutoReload] Performing reload attempt ${currentCount + 1}/${MAX_RELOAD_ATTEMPTS}`);
  } catch (error) {
    console.error("[performAutoReload] Error saving reload state:", error);
  }
  window.location.reload();
}

/**
 * Обертка над React.lazy() с автоматической перезагрузкой при ошибке загрузки чанка.
 * 
 * При ошибке "Failed to fetch dynamically imported module":
 * 1. Проверяет, не было ли перезагрузки за последние 10 секунд
 * 2. Если нет - автоматически перезагружает страницу
 * 3. Если да - пробрасывает ошибку дальше (для обработки ErrorBoundary)
 * 
 * Использование:
 * ```ts
 * const MyPage = lazyWithRetry(() => import("./pages/MyPage"));
 * ```
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (error) {
      if (isChunkLoadError(error)) {
        console.warn(
          "[lazyWithRetry] Chunk load error detected, checking if auto-reload is possible:",
          error
        );
        
        if (canAutoReload()) {
          console.info("[lazyWithRetry] Performing auto-reload to fetch updated chunks...");
          performAutoReload();
          // Возвращаем промис, который никогда не резолвится,
          // потому что страница будет перезагружена
          return new Promise(() => {});
        } else {
          console.warn(
            "[lazyWithRetry] Auto-reload already attempted recently, letting ErrorBoundary handle it"
          );
        }
      }
      // Пробрасываем ошибку дальше для обработки ErrorBoundary
      throw error;
    }
  });
}
