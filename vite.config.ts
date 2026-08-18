import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Every secret the demo needs is injected here and ONLY when running `vite` in dev
 * (`command === "serve"`). A production build receives empty values, `canWrite()` turns
 * false, and the write panels fall back to read-only (ADR 0011).
 *
 * This must stay the single door for secrets: importing `data/accounts.json` from
 * application code would inline the owner keys into the built bundle, which would then
 * publish three funded accounts the moment `dist/` is deployed.
 */
function devOnlySecrets(isDev: boolean): { submitterKey: string; ownerKeys: Record<string, string> } {
  if (!isDev) return { submitterKey: "", ownerKeys: {} };
  const env = loadEnv("", join(repoRoot, "contracts"), "");
  const accountsPath = join(repoRoot, "data", "accounts.json");
  const accounts = existsSync(accountsPath)
    ? (JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys?: Record<string, string> })
    : {};
  return { submitterKey: env["PRIVATE_KEY"] ?? "", ownerKeys: accounts.keys ?? {} };
}

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  const secrets = devOnlySecrets(isDev);
  const env = loadEnv("", join(repoRoot, "contracts"), "");
  return {
    root: repoRoot,
    plugins: [react()],
    define: {
      __DEMO_SUBMITTER_KEY__: JSON.stringify(secrets.submitterKey),
      __DEMO_OWNER_KEYS__: JSON.stringify(secrets.ownerKeys),
      __DEMO_RPC__: JSON.stringify(env["INTUITION_TESTNET_RPC"] ?? ""),
    },
    server: { port: 5173, fs: { allow: [repoRoot] } },
    build: { outDir: "dist" },
  };
});
