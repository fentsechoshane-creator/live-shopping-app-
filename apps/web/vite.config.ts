import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // The app version goes into error reports so we know which build broke.
  define: { __APP_VERSION__: JSON.stringify(version) },
});
