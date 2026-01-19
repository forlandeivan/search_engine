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
          // Only split vendor chunks - let Vite handle page splitting automatically
          // to avoid circular dependency issues with manual page chunks
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
          // Let Vite handle page chunks automatically
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
