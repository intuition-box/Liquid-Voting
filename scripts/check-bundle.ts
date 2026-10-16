/**
 * Refuses to let a build ship with key material in it.
 *
 * ADR 0011's promise is that a production build carries no secrets, and until now nothing
 * checked it. The CI step that claimed to was `grep '0x[0-9a-fA-F]{64}' && grep
 * 'DEMO_OWNER_KEYS'`: the first matches 127 times in a clean bundle (every term id in the
 * manifest is 32 bytes), the second never matches at all, because Vite substitutes the
 * value and the name does not survive. An always-true `&&` an always-false can only ever
 * be false, so the guard could not fire — and a build run after `bun run dev` put all
 * four private keys in `dist/`.
 *
 * So this does not look for things shaped like secrets. It looks for the exact secrets
 * this machine holds, which is the only question with a true answer: are the bytes in
 * `data/accounts.json` and `contracts/.env` present in `dist/`?
 *
 * On CI neither file exists, so the search is empty and this passes trivially — correctly,
 * since there is nothing there to leak. The check earns its keep on the machine that has
 * the keys, which is the machine that builds and then runs `bun run preview` or uploads
 * `dist/` by hand. That is where it leaked.
 *
 * Runs as the last step of `bun run build`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every secret on this machine, each with a name to report it by. */
function knownSecrets(): { where: string; value: string }[] {
  const secrets: { where: string; value: string }[] = [];

  const accountsPath = join(repoRoot, "data", "accounts.json");
  if (existsSync(accountsPath)) {
    const parsed = JSON.parse(readFileSync(accountsPath, "utf-8")) as { keys?: Record<string, string> };
    for (const [role, key] of Object.entries(parsed.keys ?? {})) {
      secrets.push({ where: `data/accounts.json · owner key ${role}`, value: key });
    }
  }

  const envPath = join(repoRoot, "contracts", ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) continue;
      const split = trimmed.indexOf("=");
      if (split === -1) continue;
      const name = trimmed.slice(0, split).trim();
      const value = trimmed.slice(split + 1).trim().replace(/^["']|["']$/g, "");
      // A private key, and nothing else from that file: the RPC URL belongs in the bundle.
      if (/^0x[0-9a-fA-F]{64}$/.test(value)) secrets.push({ where: `contracts/.env · ${name}`, value });
    }
  }

  return secrets;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const dist = join(repoRoot, "dist");
if (!existsSync(dist)) {
  console.error("dist/ does not exist — nothing to check. Run the build first.");
  process.exit(1);
}

const secrets = knownSecrets();
if (secrets.length === 0) {
  console.log("bundle check: no key material on this machine to look for — passing");
  process.exit(0);
}

const leaks: string[] = [];
for (const file of filesUnder(dist)) {
  const text = readFileSync(file, "utf-8").toLowerCase();
  for (const secret of secrets) {
    if (text.includes(secret.value.toLowerCase())) {
      leaks.push(`  ${file.slice(repoRoot.length + 1)} carries ${secret.where}`);
    }
  }
}

if (leaks.length > 0) {
  console.error(`\nThe build carries key material. Refusing it.\n\n${leaks.join("\n")}\n`);
  console.error("A leftover .env.local from a dev run is the usual cause. Delete it and build again.\n");
  process.exit(1);
}

console.log(`bundle check: ${secrets.length} secret(s) looked for, none in dist/`);
