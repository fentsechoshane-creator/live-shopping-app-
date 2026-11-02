import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { UserError, env, sameSecret } from "./http.ts";

/** Service role client: bypasses row level security. Only use after checking who is calling. */
export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

/** Returns the signed in user's id from the request, or throws. */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<string> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  if (!token) throw new UserError("Please sign in.", 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new UserError("Please sign in again.", 401);
  return data.user.id;
}

export async function isAdmin(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from("profiles").select("role").eq("id", userId).single();
  return data?.role === "admin";
}

/** Throws a readable error if a Supabase call failed. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Scheduled jobs: the caller must send the secret kept in Supabase Vault (CRON_SECRET overrides it for local runs). */
export async function cronAllowed(req: Request, db: SupabaseClient): Promise<boolean> {
  const given = req.headers.get("x-cron-secret") ?? "";
  const fixed = Deno.env.get("CRON_SECRET");
  return fixed ? sameSecret(given, fixed) : given.length > 0 && (await db.rpc("cron_secret_ok", { p_secret: given })).data === true;
}
