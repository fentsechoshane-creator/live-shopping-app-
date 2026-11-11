// Sign in with a username or email and a password. The database checks the password (password_login_check, 0042),
// then we make a one time sign in token for that person and the app swaps it for a normal session.
// The app never learns anyone's email from a username, and wrong tries are limited per account.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

Deno.serve(handler(async (_req, body) => {
  const login = typeof body.login === "string" ? body.login.trim().slice(0, 254) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 200) : "";
  if (login.length < 3 || !password) throw new UserError("Type your username or email, and your password.");
  const db = adminClient();
  const { data, error } = await db.rpc("password_login_check", { p_login: login, p_password: password });
  if (error) {
    if (/Too many tries/.test(error.message)) throw new UserError("Too many tries. Wait 15 minutes, or tap Forgot password.", 429);
    throw new Error(`password check: ${error.message}`);
  }
  const who = (data as { user_id: string; email: string }[] | null)?.[0];
  if (!who?.email) throw new UserError("Wrong username or password. No password yet? Tap Forgot password to make one.", 401);
  const link = await db.auth.admin.generateLink({ type: "magiclink", email: who.email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) throw new Error(`sign in link: ${link.error?.message ?? "no token"}`);
  return json({ tokenHash });
}));
