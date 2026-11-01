import { sameSecret } from "./http.ts";
Deno.test("secrets must match exactly", () => {
  if (!sameSecret("abc123", "abc123")) throw new Error("same should match");
  for (const [a, b] of [["abc123", "abc124"], ["abc", "abc123"], ["", ""], [null, "x"], ["x", undefined]] as const)
    if (sameSecret(a as any, b as any)) throw new Error(`${a} vs ${b} should not match`);
});
