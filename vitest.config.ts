import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@/": `${fileURLToPath(new URL("./client/src/", import.meta.url))}`,
      "@": `${fileURLToPath(new URL("./client/src/", import.meta.url))}`,
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    threads: false,
  },
});
