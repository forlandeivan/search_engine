import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
  ],
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
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor chunks - separate large dependencies
          if (id.includes('node_modules')) {
            // CRITICAL: All React-dependent libraries MUST be in the same chunk
            // to ensure React is loaded and initialized before any library tries to use it.
            // This prevents "Cannot read properties of undefined (reading 'createContext')" 
            // and similar errors when chunks load in parallel.
            if (
              id.includes('react/') || 
              id.includes('react-dom/') || 
              id.includes('@radix-ui/') ||
              id.includes('@tanstack/react-query') ||
              id.includes('wouter') ||
              id.includes('recharts') ||
              id.includes('@tiptap/')
            ) {
              return 'vendor-react';
            }
            // PDF/File processing (no React dependency)
            if (id.includes('pdfjs-dist') || id.includes('mammoth') || id.includes('turndown')) {
              return 'vendor-files';
            }
            // Other vendor libraries
            return 'vendor';
          }
          // Admin pages chunk
          if (id.includes('/pages/') && (
            id.includes('Admin') ||
            id.includes('LlmProviders') ||
            id.includes('EmbeddingServices') ||
            id.includes('VectorStorage') ||
            id.includes('FileStorage') ||
            id.includes('TtsStt') ||
            id.includes('SpeechProvider') ||
            id.includes('AsrExecutions') ||
            id.includes('LlmExecutions') ||
            id.includes('GuardBlock') ||
            id.includes('SmtpSettings') ||
            id.includes('AuthSettings') ||
            id.includes('ApiDocs')
          )) {
            return 'pages-admin';
          }
          // Main pages chunk (chat, knowledge base, skills)
          if (id.includes('/pages/') && (
            id.includes('ChatPage') ||
            id.includes('KnowledgeBase') ||
            id.includes('SkillsPage') ||
            id.includes('SkillSettings') ||
            id.includes('ActionSettings')
          )) {
            return 'pages-main';
          }
          // Workspace and settings pages
          if (id.includes('/pages/') && (
            id.includes('Workspace') ||
            id.includes('VectorCollection') ||
            id.includes('VectorCollections')
          )) {
            return 'pages-workspace';
          }
        },
      },
    },
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
  },
});
