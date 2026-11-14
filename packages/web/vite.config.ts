import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, loadEnv } from "vite";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  // The hub's port comes from the same .env as the hub
  const env = loadEnv(mode, root, "");
  const hubPort = env.HUB_PORT || "7300";

  return {
    plugins: [svelte()],
    resolve: {
      alias: {
        "@mosaik/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
      },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        // changeOrigin sends Host: 127.0.0.1:<port>, which the hub accepts
        "/api": { target: `http://127.0.0.1:${hubPort}`, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
