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
    // Принудительная пересборка зависимостей при запуске dev-сервера.
    // Это решает проблему "Outdated Optimize Dep" (504) когда кэш устаревает.
    force: true,
    // Эти зависимости могут подтягиваться только в lazy-роутах (например, AdminModelsPage),
    // что приводит к поздней оптимизации deps и 504 (Outdated Optimize Dep).
    // Принудительно оптимизируем их на старте, чтобы не ломать динамический импорт.
    // Важно: shadcn/ui тянет много Radix primitives. Если часть из них встречается
    // только в lazy-страницах (например, `SkillsPage`), Vite может начать
    // `optimizeDeps` "на лету" и временно отвечать 504, что ломает `React.lazy()`.
    // Прогреваем основные Radix пакеты заранее.
    include: [
      "react",
      "react-dom",
      "wouter",
      "@tanstack/react-query",
      "lucide-react",
      "date-fns",
      "clsx",
      "tailwind-merge",
      "react-hook-form",
      "zod",
      "framer-motion",
      "react-day-picker",
      "recharts",
      "@tanstack/react-virtual",
      "react-markdown",
      "remark-gfm",
      "rehype-slug",
      "rehype-autolink-headings",
      "dompurify",
      "jsdom",
      "@radix-ui/react-accordion",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-aspect-ratio",
      "@radix-ui/react-avatar",
      "@radix-ui/react-checkbox",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-context-menu",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-hover-card",
      "@radix-ui/react-label",
      "@radix-ui/react-menubar",
      "@radix-ui/react-navigation-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-progress",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slider",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-toggle",
      "@radix-ui/react-toggle-group",
      "@radix-ui/react-tooltip",
      "cmdk",
      "vaul",
      "embla-carousel-react",
    ],
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
