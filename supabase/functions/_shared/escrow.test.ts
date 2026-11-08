// Runs our TradeSafe code against a pretend TradeSafe, so request shapes and the bank lookup are checked.
import { escrow } from "./escrow.ts";

function assert(c: unknown, msg = "expected true") { if (!c) throw new Error(msg); }

type Call = { url: string; body: any };
function fakeTradeSafe(handler: (query: string, vars: any) => any) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("oauth/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    const body = JSON.parse(String(init?.body));
    calls.push({ url, body });
    return new Response(JSON.stringify({ data: handler(body.query, body.variables) }), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const ENUMS: Record<string, { name: string; description: string }[]> = {
  UniversalBranchCode: [{ name: "BANK_632005", description: "Absa Bank" }, { name: "BANK_051001", description: "Standard Bank South Africa" },
    { name: "BANK_250655", description: "First National Bank" }],
  BankAccountType: [{ name: "CHEQUE", description: "Cheque/Current Account" }, { name: "SAVINGS", description: "Savings Account" }],
  IdType: [{ name: "NATIONAL", description: "National ID" }],
  PayoutInterval: [{ name: "IMMEDIATE", description: "Immediate" }, { name: "WEEKLY", description: "Weekly" }, { name: "MONTHLY", description: "Monthly" }],
};
function setEnv() {
  Deno.env.set("TRADESAFE_MODE", "live"); Deno.env.set("TRADESAFE_CLIENT_ID", "id"); Deno.env.set("TRADESAFE_CLIENT_SECRET", "secret");
  Deno.env.set("TRADESAFE_AGENT_TOKEN", "agent"); Deno.env.set("APP_URL", "https://myhaul-app.netlify.app");
}

Deno.test("seller token: bank and account type use TradeSafe's own codes, weekly payouts unless picked", async () => {
  setEnv();
  const ts = fakeTradeSafe((q, v) => q.includes("__type") ? { __type: { enumValues: ENUMS[v.n] ?? [] } } : { tokenCreate: { id: "T1" } });
  try {
    const id = await escrow().createParty({ givenName: "Lebo", familyName: "M", email: "l@x.co", mobile: "", idNumber: "9001015009087",
      bank: { bankName: "Standard Bank", accountNumber: "123456789", accountType: "CHEQUE" } });
    assert(id === "T1");
    const input = ts.calls.find((c) => c.body.query.includes("tokenCreate"))!.body.variables.input;
    assert(input.bankAccount.bank === "BANK_051001", "Standard Bank mapped by name");
    assert(input.bankAccount.accountType === "CHEQUE");
    assert(input.settings.payout.interval === "WEEKLY", "weekly by default (8 Nov 2026)");
    assert(input.user.idType === "NATIONAL" && !("mobile" in input.user), "empty mobile left out");
    assert(ts.calls[0].url === "https://api.tradesafe.co.za/graphql", "default live GraphQL address");
  } finally { ts.restore(); }
});

Deno.test("a seller's payout schedule is changed with tokenUpdate, like TradeSafe's own plugin", async () => {
  setEnv();
  const ts = fakeTradeSafe((q, v) => q.includes("__type") ? { __type: { enumValues: ENUMS[v.n] ?? [] } } : { tokenUpdate: { id: "T1" } });
  try {
    await escrow().setPayoutSchedule("T1", "MONTHLY");
    const call = ts.calls.find((c) => c.body.query.includes("tokenUpdate"))!;
    assert(call.body.variables.id === "T1" && call.body.variables.input.settings.payout.interval === "MONTHLY");
  } finally { ts.restore(); }
});

Deno.test("an unknown bank is refused instead of guessed", async () => {
  setEnv();
  const ts = fakeTradeSafe((q, v) => q.includes("__type") ? { __type: { enumValues: ENUMS[v.n] ?? [] } } : { tokenCreate: { id: "T1" } });
  try {
    let refused = false;
    try { await escrow().createParty({ givenName: "A", familyName: "B", email: "a@b.co", mobile: "0821234567", bank: { bankName: "TymeBank", accountNumber: "1234567", accountType: "SAVINGS" } }); }
    catch { refused = true; }
    assert(refused, "TymeBank isn't in this fake list, so it must be refused");
    assert(!ts.calls.some((c) => c.body.query.includes("tokenCreate")), "nothing created");
  } finally { ts.restore(); }
});

Deno.test("transaction, payment link and refund send the documented shapes", async () => {
  setEnv();
  const ts = fakeTradeSafe((q) => q.includes("transactionCreate") ? { transactionCreate: { id: "TX", allocations: [{ id: "AL" }] } }
    : q.includes("checkoutLink") ? { checkoutLink: "https://pay.tradesafe.co.za/x" } : { transactionCancel: { id: "TX", state: "CANCELED" } });
  try {
    const es = escrow();
    const t = await es.createTransaction({ reference: "00000000-0000-0000-0000-000000000001", title: "Tee", description: "Tee from Lebo",
      buyerToken: "B", sellerToken: "S", amountCents: 45200, agentFeeCents: 3900, daysToDeliver: 10, daysToInspect: 7 });
    assert(t.transactionId === "TX" && t.allocationId === "AL");
    const input = ts.calls[0].body.variables.input;
    assert(input.allocations.create[0].value === 452 && input.currency === "ZAR" && input.feeAllocation === "AGENT");
    assert(input.parties.create[2].fee === 39 && input.parties.create[2].role === "AGENT");
    assert((await es.checkoutUrl("TX", "o")).startsWith("https://"));
    await es.refund("TX");
    assert(ts.calls.at(-1)!.body.variables.comment === "Refunded by myHaul");
  } finally { ts.restore(); }
});

Deno.test("without TRADESAFE_AGENT_TOKEN our own token comes from apiProfile", async () => {
  setEnv(); Deno.env.delete("TRADESAFE_AGENT_TOKEN");
  const ts = fakeTradeSafe((q) => q.includes("apiProfile") ? { apiProfile: { token: "APP_TOKEN" } } : { transactionCreate: { id: "TX", allocations: [{ id: "AL" }] } });
  try {
    await escrow().createTransaction({ reference: "00000000-0000-0000-0000-000000000001", title: "Tee", description: "Tee",
      buyerToken: "B", sellerToken: "S", amountCents: 10000, agentFeeCents: 1000, daysToDeliver: 10, daysToInspect: 7 });
    const input = ts.calls.find((c) => c.body.query.includes("transactionCreate"))!.body.variables.input;
    assert(input.parties.create[2].token === "APP_TOKEN");
  } finally { ts.restore(); }
});

Deno.test("a payment link that isn't https is refused", async () => {
  setEnv();
  const ts = fakeTradeSafe(() => ({ checkoutLink: "javascript:alert(1)" }));
  try {
    let refused = false;
    try { await escrow().checkoutUrl("TX", "o"); } catch { refused = true; }
    assert(refused);
  } finally { ts.restore(); }
});
