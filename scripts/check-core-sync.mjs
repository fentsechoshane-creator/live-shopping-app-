// Fails if the server copy of the rules is out of date.
import { readdirSync, readFileSync } from "node:fs";
const from = new URL("../packages/core/src/", import.meta.url);
const to = new URL("../supabase/functions/_shared/core/", import.meta.url);
const header = "// GENERATED from packages/core/src by npm run sync-core. Do not edit here.\n";
let bad = [];
for (const f of readdirSync(from)) {
  let copy = "";
  try { copy = readFileSync(new URL(f, to), "utf8"); } catch { bad.push(f); continue; }
  if (copy !== header + readFileSync(new URL(f, from), "utf8")) bad.push(f);
}
if (bad.length) { console.error("Server rules are out of date. Run: npm run sync-core. Files:", bad.join(", ")); process.exit(1); }
console.log("server rules match packages/core");
