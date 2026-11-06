// Pushes the database updates and server functions to the live Supabase project, safely, from a laptop.
// Run from the repo folder:  npm run push:live
// It asks before changing anything, and shows exactly which updates it will apply first.
// Needs: Node 18+ and a Supabase login (it opens your browser the first time). Works on Mac and Windows.
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const REF = "gingqryoycwtzbfvfbln";
// Updates 1 to 26 were applied through the Supabase connector, which recorded them under different version numbers.
// These lines tell Supabase they are the same updates, so a push doesn't try to run them again.
const LIVE_OLD = ["20261028193639", "20261028193739", "20261028193815", "20261028193818", "20261028193900", "20261028194108",
  "20261028235920", "20261029000655", "20261030141011", "20261030141021", "20261030142640", "20261030142709",
  "20261030142715", "20261030142734", "20261030155926", "20261030194520",
  "20261105053831", "20261105053907", "20261105053940", "20261105053941", "20261105054027", "20261105054039",
  "20261105054115", "20261105054318", "20261105054546", "20261105055411",
  "20261106131702", "20261106131722", "20261106131741", "20261106132749"];
const LOCAL_SAME = ["20261028000001", "20261028000002", "20261028000003", "20261028000004", "20261028000005", "20261028000006",
  "20261029000007", "20261029000008", "20261029000009", "20261029000010", "20261030000011", "20261030000012",
  "20261030000013", "20261030000014", "20261030000015", "20261030000016",
  "20261101000017", "20261101000018", "20261102000019", "20261104000020", "20261105000021", "20261105000022",
  "20261105000023", "20261105000024", "20261105000025", "20261105000026",
  "20261105000027", "20261106000028", "20261106000029", "20261106000030"];

const win = process.platform === "win32";
const sb = (args, opts = {}) => {
  console.log(`\n> supabase ${args.join(" ")}`);
  const r = spawnSync(win ? "npx.cmd" : "npx", ["--yes", "supabase@latest", ...args], { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8", shell: win });
  if (r.status !== 0 && !opts.allowFail) { console.error(r.stderr ?? ""); console.error("\nStopped: that step failed. Nothing after it was run."); process.exit(1); }
  return r;
};
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => /^y(es)?$/i.test((await rl.question(`\n${q} (yes/no) `)).trim());

console.log("myHaul: push updates to the live Supabase project " + REF);
sb(["login"], { allowFail: true }); // opens the browser if you're not signed in yet
sb(["link", "--project-ref", REF]); // asks for the database password (Supabase > Project settings > Database)

// Line up the version history once (safe to run again: it only labels versions, it doesn't change data).
const list = sb(["migration", "list", "--linked"], { capture: true, allowFail: true });
const out = (list.stdout ?? "") + (list.stderr ?? "");
if (LIVE_OLD.some((v) => out.includes(v))) {
  console.log("\nLining up the update history (updates 1 to 26 are already live under other version numbers).");
  sb(["migration", "repair", "--status", "reverted", ...LIVE_OLD, "--linked"]);
  sb(["migration", "repair", "--status", "applied", ...LOCAL_SAME, "--linked"]);
}

console.log("\nThese are the database updates that will be applied:");
sb(["db", "push", "--dry-run", "--linked"]);
if (!(await ask("Apply them to the live database now?"))) { console.log("Nothing changed."); process.exit(0); }
sb(["db", "push", "--linked"]);

if (await ask("Deploy all server functions now?")) sb(["functions", "deploy", "--project-ref", REF, "--use-api"]);

console.log(`
Done. Last steps in the Supabase dashboard (SQL Editor): see docs/SETUP.md steps 9 and 10 to schedule team alerts and
phone notifications, and set the secrets you have (Edge Functions > Secrets), for example TRADESAFE_MODE=mock and
APP_URL=https://myhaul-app.netlify.app while testing. Never paste secret keys into chat.`);
rl.close();
