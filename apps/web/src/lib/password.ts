// Password rules, the same on every screen: 8 or more characters, with at least one letter and one number.
export function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Use at least 8 characters.";
  if (p.length > 72) return "Keep it under 72 characters.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Use at least one letter and one number.";
  return null;
}
export const passwordChecks = (p: string) => [
  { ok: p.length >= 8, label: "8 or more characters" },
  { ok: /[A-Za-z]/.test(p) && /\d/.test(p), label: "A letter and a number" },
];
