// Username rules, the same as the database (handle_problem in migration 0015), so people see problems while typing.
export const RESERVED = new Set(["admin", "administrator", "myhaul", "my.haul", "myhaul.official", "official", "support", "help", "team",
  "staff", "moderator", "security", "settings", "explore", "activity", "messages", "orders", "checkout", "signin", "signup", "login",
  "logout", "privacy", "terms", "about", "api", "www", "root", "system", "null", "undefined", "anonymous", "deleted", "everyone",
  "live", "shop", "shops", "sell", "post", "tradesafe", "pudo", "payfast", "ozow"]);

/** What people type, made into a valid looking username: lowercase, spaces to dots, nothing else odd. */
export function cleanHandle(raw: string) {
  return raw.toLowerCase().replace(/^@/, "").replace(/\s+/g, ".").replace(/[^a-z0-9._]/g, "").slice(0, 30);
}

/** The problem with a username, or null if it follows the rules (taken is checked by the server). */
export function handleProblem(h: string): string | null {
  if (h.length < 3) return "Use at least 3 characters.";
  if (h.length > 30) return "Use 30 characters or fewer.";
  if (!/^[a-z0-9._]+$/.test(h)) return "Use only lowercase letters, numbers, dots and underscores.";
  if (/^\.|\.$/.test(h)) return "A username can't start or end with a dot.";
  if (/\.\./.test(h)) return "A username can't have two dots in a row.";
  if (/^[0-9._]+$/.test(h)) return "Add at least one letter.";
  if (RESERVED.has(h)) return "That username is reserved.";
  return null;
}

/** Username ideas from a name or email, like Instagram's suggestions. */
export function handleIdeas(name: string, email?: string) {
  const words = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const local = cleanHandle((email ?? "").split("@")[0].replace(/[^a-z0-9._]/gi, ""));
  const first = words[0] ?? local ?? "user";
  const last = words[words.length - 1] ?? "";
  const n = () => String(Math.floor(10 + Math.random() * 89));
  const base = [
    words.join("."), words.join("_"), words.join(""), local,
    last && words.length > 1 ? `${first}.${last[0]}` : "", `${first}.za`, `${first}_${n()}`, `${first}.${n()}`, `its.${first}`, `${words.join("")}${n()}`,
  ];
  return [...new Set(base.map(cleanHandle).map((h) => h.replace(/^\.+|\.+$/g, "").replace(/\.{2,}/g, ".")).filter((h) => h && !handleProblem(h)))].slice(0, 10);
}
