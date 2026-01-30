import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
  ],
  // Явно фиксируем cacheDir в корне репозитория.
  // В нашем проекте `root` = client, но node_modules живут в корне,
  // и на Windows это помогает избежать "Outdated Optimize Dep" из-за
  // рассинхронизации кеша оптимизированных зависимостей.
  cacheDir: path.resolve(__dirname, "node_modules", ".vite"),
  optimizeDeps: {
    // Эти зависимости могут подтягиваться только в lazy-роутах (например, AdminModelsPage),
    // что приводит к поздней оптимизации deps и 504 (Outdated Optimize Dep).
    // Принудительно оптимизируем их на старте, чтобы не ломать динамический импорт.
    include: ["@radix-ui/react-checkbox"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    // Let Vite handle all code splitting automatically
    // Manual chunks were causing race conditions where React wasn't loaded
    // before libraries that depend on it (useState, createContext, forwardRef errors)
  },
  server: {
    fs: {
      strict: false,
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, "client"),
        path.resolve(__dirname, "client", "src"),
      ],
    },
    hmr: {
      overlay: true, // Показывать ошибки в оверлее браузера
    },
    watch: {
      // Игнорировать node_modules для лучшей производительности
      ignored: ['**/node_modules/**', '**/dist/**'],
    },
  },
  // Улучшенная обработка ошибок
  clearScreen: false, // Не очищать консоль при перезагрузке
});
