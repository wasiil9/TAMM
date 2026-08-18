import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, "index.html"),
        insights: resolve(rootDir, "insights.html"),
        notFound: resolve(rootDir, "404.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:10000",
    },
  },
});
