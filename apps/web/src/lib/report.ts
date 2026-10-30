// Crash and error reports. Sends what broke, on which screen and build, to our error log (the team sees it in Team > Errors).
// No personal details: only the error text, the screen path (without query details), the platform and the app version.
import { api } from "../api";
import { platform } from "../native";

declare const __APP_VERSION__: string | undefined;
export const APP_VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const seen = new Set<string>();
let sent = 0;

/** Send one report. Skips repeats and stops after 10 per session so a loop can't flood the log. */
export function reportError(err: unknown, where?: string) {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : safeString(err));
  const message = `${where ? `[${where}] ` : ""}${e.message || "Unknown error"}`.slice(0, 500);
  // Noise we can't act on: cancelled requests, the browser's own resize warning, extensions.
  if (/ResizeObserver loop|AbortError|The user aborted|Load failed$|chrome-extension:/i.test(message + (e.stack ?? ""))) return;
  if (seen.has(message) || sent >= 10) return;
  seen.add(message);
  sent++;
  if (import.meta.env.DEV) console.warn("Error report:", message);
  api.reportError({ message, stack: e.stack?.slice(0, 4000), path: location.pathname.slice(0, 200), platform, version: APP_VERSION }).catch(() => {});
}

function safeString(x: unknown) {
  try { return JSON.stringify(x).slice(0, 300); } catch { return String(x); }
}

/** Catch errors that nothing else caught. Call once at start. */
export function startErrorReporting() {
  window.addEventListener("error", (ev) => reportError(ev.error ?? ev.message, "window"));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason, "promise"));
}
