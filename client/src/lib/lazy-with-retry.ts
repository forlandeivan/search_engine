import { lazy, type ComponentType } from "react";

// Ключ для предотвращения бесконечных перезагрузок
const RELOAD_KEY = "chunk-reload-attempt";
const RELOAD_COUNT_KEY = "chunk-reload-count";
const RELOAD_TIMEOUT = 5000; // 5 секунд между попытками
const MAX_RELOAD_ATTEMPTS = 2; // Максимум 2 автоматические попытки перезагрузки

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
  const lastReload = sessionStorage.getItem(RELOAD_KEY);
  if (!lastReload) {
    return true;
  }
  const now = Date.now();
  return now - parseInt(lastReload, 10) > RELOAD_TIMEOUT;
}

/**
 * Выполняет автоматическую перезагрузку страницы
 * с сохранением времени перезагрузки для защиты от бесконечного цикла
 */
export function performAutoReload(): void {
  sessionStorage.setItem(RELOAD_KEY, Date.now().toString());
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
export function lazyWithRetry<T extends ComponentType<unknown>>(
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
