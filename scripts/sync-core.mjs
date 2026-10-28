// Copies packages/core/src into supabase/functions/_shared/core so server functions use the same rules.
// Run after changing anything in packages/core: npm run sync-core
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const from = new URL("../packages/core/src/", import.meta.url);
const to = new URL("../supabase/functions/_shared/core/", import.meta.url);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
for (const f of readdirSync(to)) {
  const p = new URL(f, to);
  writeFileSync(p, "// GENERATED from packages/core/src by npm run sync-core. Do not edit here.\n" + readFileSync(p, "utf8"));
}
console.log("core synced");
