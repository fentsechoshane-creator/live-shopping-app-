// Ask for notifications once, at a moment where it obviously helps (after an order or a first message).
import { api } from "../api";
import { registerPush } from "../native";

const ASKED = "lsa-push-asked";
export function askForNotifications() {
  try { if (localStorage.getItem(ASKED) === "1") return; localStorage.setItem(ASKED, "1"); } catch { /* ignore */ }
  registerPush((token, platform) => api.savePushToken(token, platform), true).catch(() => {});
}
