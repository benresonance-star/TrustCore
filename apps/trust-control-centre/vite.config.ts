import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4311,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4310",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  preview: { port: 4312 },
  test: { environment: "jsdom", setupFiles: "./src/test-setup.ts" },
});
