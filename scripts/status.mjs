// "Where are we?" in one command: npm run status
// Prints the current state, what is next, the latest log entries and the latest commits,
// so any person or AI tool can pick up the project without being primed.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const log = readFileSync(new URL("../docs/LOG.md", import.meta.url), "utf8");
const section = (name) => {
  const m = log.match(new RegExp(`## ${name}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return m ? m[1].trim() : "(missing)";
};
const entries = section("Log").split(/\n(?=### )/).slice(0, 3).join("\n\n");
const git = (cmd) => { try { return execSync(`git ${cmd}`, { encoding: "utf8" }).trim(); } catch { return "(git not available)"; } };

console.log(`
=== HOW FAR WE ARE ===
${section("How far we are")}

=== WHAT IS BUILT ===
${section("Current state")}

=== NEXT UP ===
${section("Next up")}

=== LATEST WORK (newest first) ===
${entries}

=== CURRENT VERSION ===
${git("log -1 --format=%h' '%ad' '%s --date=short")}
Branch: ${git("rev-parse --abbrev-ref HEAD")}

Latest commits:
  ${git("log -8 --format='%h %ad %s' --date=short").split("\n").join("\n  ")}

=== RUN THE CURRENT VERSION ===
  npm install
  npm run dev          demo mode at http://localhost:5173 (sign in code 123456)
  npm run build:phone  one file you can open or host: apps/web/dist-artifact/index.html
  npm run dev:live     against the live Supabase project

Full context: docs/LOG.md. Rules: AGENTS.md, docs/DESIGN.md.
`);
