import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
// Which update this is: Netlify gives the commit as COMMIT_REF; locally we ask git. Shown at the bottom of the menu.
const commit = (process.env.COMMIT_REF ?? (() => { try { return execSync("git rev-parse HEAD").toString(); } catch { return ""; } })()).trim().slice(0, 7);
const built = new Date().toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // The app version goes into error reports so we know which build broke.
  define: { __APP_VERSION__: JSON.stringify(commit ? `${version}+${commit}` : version), __BUILT_AT__: JSON.stringify(built) },
});
