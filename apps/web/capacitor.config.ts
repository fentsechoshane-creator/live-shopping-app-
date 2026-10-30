// Wraps the web app as real iPhone and Android apps (Capacitor).
// Build: npm run build:native (from apps/web), then open ios/ in Xcode or android/ in Android Studio.
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // The app's permanent ID in both stores. It can't change after the first upload.
  // [CONFIRM] ideally reversed from a domain you own, for example za.co.myhaul.app.
  appId: "za.co.myhaul.app",
  appName: "myHaul",
  webDir: "dist",
  ios: { contentInset: "never", backgroundColor: "#0b0b0d" },
  android: { backgroundColor: "#0b0b0d" },
  plugins: {
    SplashScreen: { launchShowDuration: 900, backgroundColor: "#0b0b0d", showSpinner: false, launchAutoHide: true },
    StatusBar: { overlaysWebView: true, style: "DARK" },
    Keyboard: { resize: "native" },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
