import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// Dev: Vite on 5173 proxies /api to the Fastify server on 4000.
// Prod: `vite build` emits to dist/, which Fastify serves statically.
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    port: 5173,
    fs: { allow: [".."] },
    proxy: {
      "/api": { target: "http://127.0.0.1:4000", changeOrigin: true, ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
