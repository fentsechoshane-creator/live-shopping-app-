/**
 * Simple text checks for comments and messages. The database has the same rude word list (rude_text()).
 * [CONFIRM] grow both lists; add automatic moderation later.
 */
const RUDE = /\b(fuck|fucking|cunt|bitch|nigger|kaffir|kaffer|poes|naai|moer|faggot|whore|slut)\b/i;

export function isRude(text: string): boolean {
  return RUDE.test(text);
}

/**
 * Signs someone is trying to take payment outside the app (which removes buyer protection and breaks seller rules).
 * Used to show a warning in chat, not to block the message.
 */
export function looksOffApp(text: string): boolean {
  const t = text.toLowerCase();
  if (/(\+27|\b0)[6-8]\d[\s-]?\d{3}[\s-]?\d{4}\b/.test(t)) return true; // SA cell number
  return /\b(eft|e-?wallet|cash ?send|pay ?shap|bank details|account number|whats ?app me|pay me direct|outside the app|send money)\b/.test(t);
}

export const REPORT_REASONS = {
  counterfeit: "Fake or counterfeit",
  not_as_shown: "Not as shown",
  scam: "Scam or asks to pay outside the app",
  offensive: "Offensive or hateful",
  spam: "Spam",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
