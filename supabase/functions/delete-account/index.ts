// Deletes the signed in person's account, as Apple and Google require.
// Open orders must finish first (money is in escrow). Then their name, posts, comments, likes, follows and
// chats are removed, and the sign in is deleted. Orders and payouts stay for the records the law requires.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser, must } from "../_shared/supabase.ts";

Deno.serve(handler(async (req, body) => {
  if (body.confirm !== "DELETE") throw new UserError("Type DELETE to confirm.");
  const db = adminClient();
  const uid = await requireUser(req, db);
  const open = must(await db.rpc("open_orders_for", { p_user: uid }), "check orders") as number;
  if (open > 0) throw new UserError(`You have ${open} open ${open === 1 ? "order" : "orders"}. Finish ${open === 1 ? "it" : "them"} first, then delete your account.`, 409);
  must(await db.rpc("forget_user", { p_user: uid }), "remove data");
  const { error } = await db.auth.admin.deleteUser(uid, true); // soft delete: the sign in is removed and can't be used again
  if (error) throw new Error(`delete user: ${error.message}`);
  return json({ ok: true });
}));
