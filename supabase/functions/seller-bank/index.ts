// Seller adds their bank account. We create their escrow token with TradeSafe, which holds the bank details.
// We only keep the bank name and last 4 digits, to show the seller which account is linked.
import { handler, json, UserError } from "../_shared/http.ts";
import { adminClient, requireUser, must } from "../_shared/supabase.ts";
import { escrow } from "../_shared/escrow.ts";

// [CONFIRM] TradeSafe's bank enum values in the schema playground.
const BANKS: Record<string, string> = {
  "Absa": "ABSA", "Capitec": "CAPITEC", "FNB": "FNB", "Nedbank": "NEDBANK", "Standard Bank": "SBSA",
  "TymeBank": "TYMEBANK", "African Bank": "AFRICAN", "Discovery Bank": "DISCOVERY", "Investec": "INVESTEC",
};

Deno.serve(handler(async (req, body) => {
  const db = adminClient();
  const uid = await requireUser(req, db);
  const { bankName, accountNumber, accountType, givenName, familyName, idNumber } = body ?? {};
  if (!BANKS[bankName]) throw new UserError("Pick your bank.");
  const digits = String(accountNumber ?? "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 13) throw new UserError("Check the account number.");
  if (!givenName || !familyName) throw new UserError("Add the name on the account.");
  if (idNumber && !/^\d{13}$/.test(String(idNumber))) throw new UserError("A South African ID number has 13 digits.");

  const shop = must(await db.from("shops").select("id, status, seller_checks(phone, escrow_token)").eq("owner_id", uid).single(), "load shop") as any;
  if (shop.status === "banned") throw new UserError("This shop is closed.", 403);
  const { data: allowed } = await db.rpc("take_usage", { p_user: uid, p_kind: "seller_bank", p_max: 3, p_window: "1 day" });
  if (allowed !== true) throw new UserError("You've changed bank details too often today. Email help@myhaul.co.za.", 429);
  const changing = !!shop.seller_checks?.escrow_token;
  const { data: u } = await db.auth.admin.getUserById(uid);
  const token = await escrow().createParty({
    givenName, familyName, email: u.user?.email ?? "", mobile: shop.seller_checks?.phone ?? u.user?.phone ?? "",
    idNumber: idNumber || undefined,
    bank: { bank: BANKS[bankName], accountNumber: digits, accountType: accountType === "CHEQUE" ? "CHEQUE" : "SAVINGS" },
  });
  must(await db.from("seller_checks").update({
    escrow_token: token, bank_name: bankName, bank_last4: digits.slice(-4), bank_status: "approved",
  }).eq("shop_id", shop.id), "save bank");
  // A change of account waits for our team (bank_change_guard in 0018), and the owner is told in case it wasn't them.
  if (changing) {
    await db.from("notifications").insert({ user_id: uid, kind: "account", title: "Your payout bank account changed",
      body: `Now ${bankName} ending ${digits.slice(-4)}. Our team checks it before your next payout. If this wasn't you, email help@myhaul.co.za now.`, link: "/sell/payouts" });
  }
  return json({ ok: true, bankName, last4: digits.slice(-4) });
}));
