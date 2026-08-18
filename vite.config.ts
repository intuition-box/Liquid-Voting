import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = dirname(fileURLToPath(import.meta.url));

/**
 * The demo drives testnet-only throwaway accounts (data/accounts.json, gitignored), so
 * the submitter key is injected from contracts/.env — but ONLY in dev (`bun run dev`).
 * A production build gets an empty string and the write panels fall back to read-only
 * (ADR 0011). Never point this at a key that holds anything.
 */
export default defineConfig(({ command }) => {
  const env = loadEnv("", join(repoRoot, "contracts"), "");
  const isDev = command === "serve";
  return {
    root: repoRoot,
    plugins: [react()],
    define: {
      __DEMO_SUBMITTER_KEY__: JSON.stringify(isDev ? env["PRIVATE_KEY"] ?? "" : ""),
      __DEMO_RPC__: JSON.stringify(env["INTUITION_TESTNET_RPC"] ?? ""),
    },
    server: { port: 5173, fs: { allow: [repoRoot] } },
    build: { outDir: "dist" },
  };
});
