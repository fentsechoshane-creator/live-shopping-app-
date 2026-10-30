// Phone app extras (Capacitor). In a browser these all do nothing or fall back to web features.
import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
/** The public web address used in shared links (inside the phone app, the page address isn't a real website). [CONFIRM domain] */
export const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || (isNative ? "https://myhaul.co.za" : location.origin);

/** Share a link, or copy it when the phone can't share. Returns "copied" when it was copied. */
export async function shareOrCopy(path: string, title?: string): Promise<"shared" | "copied" | "failed"> {
  const url = `${PUBLIC_URL}${path}`;
  if (await shareLink(url, title)) return "shared";
  try { await navigator.clipboard.writeText(url); return "copied"; } catch { return "failed"; }
}
export const platform = Capacitor.getPlatform(); // "ios", "android" or "web"

/** Runs once when the app starts: splash, status bar, Android back button. */
export async function startNative(goBack: () => void) {
  if (!isNative) return;
  const [{ SplashScreen }, { StatusBar, Style }, { App }] = await Promise.all([
    import("@capacitor/splash-screen"), import("@capacitor/status-bar"), import("@capacitor/app"),
  ]);
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  SplashScreen.hide().catch(() => {});
  // Android back button: close an open sheet or menu first, then go back, then leave the app.
  App.addListener("backButton", ({ canGoBack }) => {
    if (document.querySelector(".sheet-backdrop, .drawer-backdrop, .viewer")) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    } else if (canGoBack || window.history.length > 1) goBack();
    else App.exitApp();
  });
}

/** Light status bar text over the video feed, dark text on light screens. */
export async function statusBarFor(onVideo: boolean) {
  if (!isNative) return;
  const { StatusBar, Style } = await import("@capacitor/status-bar");
  StatusBar.setStyle({ style: onVideo ? Style.Dark : Style.Light }).catch(() => {});
}

/** Share a link with the phone's share sheet. Returns false if sharing isn't possible (then copy instead). */
export async function shareLink(url: string, title?: string): Promise<boolean> {
  try {
    if (isNative) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, url });
      return true;
    }
    if (navigator.share) { await navigator.share({ title, url }); return true; }
  } catch { return true; /* cancelled */ }
  return false;
}

/** A small tap feel on key actions (like, repost, buy) in the phone app. */
export async function tap() {
  if (!isNative) return;
  const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

/** Ask for notification permission and hand the device token to `save`. Phone app only. */
export async function registerPush(save: (token: string, platform: string) => Promise<void>) {
  if (!isNative) return;
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.checkPermissions();
  const granted = perm.receive === "granted" || (await PushNotifications.requestPermissions()).receive === "granted";
  if (!granted) return;
  await PushNotifications.removeAllListeners();
  PushNotifications.addListener("registration", (t) => { save(t.value, platform).catch(() => {}); });
  // Tapping a notification opens the screen it points to.
  PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
    const link = a.notification.data?.link;
    if (typeof link === "string" && link.startsWith("/")) window.location.assign(link);
  });
  await PushNotifications.register();
}
