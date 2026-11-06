// Escrow provider. TradeSafe in live mode, a fake in mock mode so the whole order flow can be tested without keys.
// Checked on 6 Nov 2026 against TradeSafe's API spec (developer.tradesafe.co.za/api-spec) and their own open source
// WooCommerce plugin (github.com/TradeSafe/tradesafe-payment-gateway): the auth, GraphQL address, tokenCreate,
// transactionCreate, checkoutLink, allocation and transactionCancel shapes match. Enum codes (banks, account types,
// ID type, payout interval) aren't published, so we look them up from TradeSafe's own schema, like their plugin does.
// Still to confirm with TradeSafe: whether the AGENT (us) may accept delivery on the buyer's behalf (see release()).
import { env, UserError } from "./http.ts";

export interface PartyInput {
  givenName: string;
  familyName: string;
  email: string;
  mobile: string;
  idNumber?: string;
  /** Sellers only. bankName is what the seller picked (like "Standard Bank"); mapped to TradeSafe's code. */
  bank?: { bankName: string; accountNumber: string; accountType: "SAVINGS" | "CHEQUE" };
}

export interface TransactionInput {
  reference: string;
  title: string;
  description: string;
  buyerToken: string;
  sellerToken: string;
  /** Everything the buyer pays, in cents. */
  amountCents: number;
  /** Our cut inside escrow (seller fee + protection fee - credit, never below 0), in cents. Taken from the seller's side. */
  agentFeeCents: number;
  daysToDeliver: number;
  daysToInspect: number;
}

export interface Escrow {
  mode: "mock" | "live";
  createParty(p: PartyInput): Promise<string>;
  createTransaction(t: TransactionInput): Promise<{ transactionId: string; allocationId: string }>;
  checkoutUrl(transactionId: string, orderId: string): Promise<string>;
  /** Seller has shipped. */
  startDelivery(allocationId: string): Promise<void>;
  /** Return window closed with no claim: pay the seller. */
  release(allocationId: string): Promise<void>;
  /** Refund the buyer in full from held funds. */
  refund(transactionId: string): Promise<void>;
  /** The provider's own record of a transaction, so a callback can't be faked. */
  transactionState(transactionId: string): Promise<{ state: string; reference: string | null } | null>;
  /** How the buyer paid (like "OZOW"), for Instant EFT delivery stamps. Null if unknown; never throws. */
  paymentMethod(transactionId: string): Promise<string | null>;
}

class MockEscrow implements Escrow {
  mode = "mock" as const;
  async createParty(p: PartyInput) {
    return `mock_party_${crypto.randomUUID().slice(0, 8)}_${p.familyName.toLowerCase().replace(/\W/g, "")}`;
  }
  async createTransaction(_t: TransactionInput) {
    return { transactionId: `mock_tx_${crypto.randomUUID()}`, allocationId: `mock_alloc_${crypto.randomUUID()}` };
  }
  async checkoutUrl(_tx: string, orderId: string) {
    return `${env("APP_URL", "http://localhost:5173")}/mock-pay/${orderId}`;
  }
  async startDelivery() {}
  async release() {}
  async refund() {}
  async transactionState() { return null; }
  async paymentMethod() { return "OZOW (test)"; }
}

// Words that identify each bank in TradeSafe's bank list (UniversalBranchCode descriptions).
const BANK_WORDS: Record<string, string[]> = {
  "Absa": ["absa"], "African Bank": ["african bank"], "Capitec": ["capitec"], "Discovery Bank": ["discovery"],
  "FNB": ["first national", "fnb"], "Investec": ["investec"], "Nedbank": ["nedbank"], "Standard Bank": ["standard bank"],
  "TymeBank": ["tyme"],
};

class TradeSafe implements Escrow {
  mode = "live" as const;
  private token: { value: string; expires: number } | null = null;
  private enums = new Map<string, { name: string; description: string | null }[]>();
  private agent: string | null = null;

  /** Our own TradeSafe token (the AGENT that receives our fees). TRADESAFE_AGENT_TOKEN if set, otherwise the
   * application's own token from apiProfile, which is what TradeSafe's plugin uses. */
  private async agentToken(): Promise<string> {
    if (this.agent) return this.agent;
    const set = Deno.env.get("TRADESAFE_AGENT_TOKEN");
    if (set) return (this.agent = set);
    const d = await this.gql<{ apiProfile: { token: string | null } | null }>("query { apiProfile { token } }", {});
    if (!d.apiProfile?.token) throw new Error("TradeSafe returned no application token");
    return (this.agent = d.apiProfile.token);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await fetch(env("TRADESAFE_AUTH_URL", "https://auth.tradesafe.co.za/oauth/token"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: env("TRADESAFE_CLIENT_ID"),
        client_secret: env("TRADESAFE_CLIENT_SECRET"),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`TradeSafe auth failed: ${res.status}`);
    const j = await res.json().catch(() => ({}));
    if (typeof j.access_token !== "string") throw new Error("TradeSafe auth returned no token");
    this.token = { value: j.access_token, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
    return this.token.value;
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    // Sandbox: https://api-developer.tradesafe.dev/graphql. Live (default): https://api.tradesafe.co.za/graphql
    const res = await fetch(env("TRADESAFE_API_URL", "https://api.tradesafe.co.za/graphql"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await this.accessToken()}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || j.errors) {
      // Log what went wrong (never the token); the person sees a plain message from the caller.
      console.error("tradesafe", res.status, JSON.stringify(j?.errors ?? null).slice(0, 800));
      throw new Error(`TradeSafe error ${res.status}`);
    }
    return j.data as T;
  }

  /** A TradeSafe enum's codes and labels, looked up once (their plugin does the same). */
  private async enumValues(type: string) {
    if (!this.enums.has(type)) {
      const d = await this.gql<{ __type: { enumValues: { name: string; description: string | null }[] } | null }>(
        "query e($n: String!) { __type(name: $n) { enumValues { name description } } }", { n: type });
      this.enums.set(type, d.__type?.enumValues ?? []);
    }
    return this.enums.get(type)!;
  }
  /** The code whose name or label matches one of these words. */
  private async pick(type: string, words: string[]): Promise<string | null> {
    const values = await this.enumValues(type);
    const hit = values.find((v) => words.some((w) => v.name.toLowerCase() === w.toLowerCase()))
      ?? values.find((v) => words.some((w) => `${v.description ?? ""} ${v.name.replace(/_/g, " ")}`.toLowerCase().includes(w.toLowerCase())));
    return hit?.name ?? null;
  }

  async createParty(p: PartyInput) {
    let bankAccount: Record<string, string> | undefined;
    if (p.bank) {
      const bank = await this.pick("UniversalBranchCode", BANK_WORDS[p.bank.bankName] ?? [p.bank.bankName]);
      const accountType = await this.pick("BankAccountType", p.bank.accountType === "CHEQUE" ? ["CHEQUE", "cheque", "current"] : ["SAVINGS", "savings"]);
      if (!bank || !accountType) throw new UserError("We can't pay into that bank yet. Email help@myhaul.co.za and we'll sort it out.");
      bankAccount = { bank, accountType, accountNumber: p.bank.accountNumber };
    }
    const idType = p.idNumber ? await this.pick("IdType", ["NATIONAL", "national", "identity"]) : null;
    const d = await this.gql<{ tokenCreate: { id: string } }>(
      `mutation tokenCreate($input: TokenInput!) { tokenCreate(input: $input) { id } }`,
      {
        input: {
          user: {
            givenName: p.givenName, familyName: p.familyName, email: p.email,
            ...(p.mobile ? { mobile: p.mobile } : {}),
            ...(p.idNumber && idType ? { idNumber: p.idNumber, idType, idCountry: "ZAF" } : {}),
          },
          // Sellers: paid into their bank as soon as we release, not weekly.
          ...(bankAccount ? { bankAccount, settings: { payout: { interval: (await this.pick("PayoutInterval", ["IMMEDIATE"])) ?? "IMMEDIATE" } } } : {}),
        },
      },
    );
    return d.tokenCreate.id;
  }

  async createTransaction(t: TransactionInput) {
    const d = await this.gql<{ transactionCreate: { id: string; allocations: { id: string }[] } }>(
      `mutation transactionCreate($input: CreateTransactionInput!) {
        transactionCreate(input: $input) { id allocations { id } }
      }`,
      {
        input: {
          title: t.title,
          description: t.description,
          industry: "GENERAL_GOODS_SERVICES",
          currency: "ZAR",
          // We pay TradeSafe's fee out of our cut, so buyers and sellers see clean prices.
          feeAllocation: "AGENT",
          workflow: "STANDARD",
          privacy: "NONE",
          reference: t.reference,
          allocations: {
            create: [{
              title: t.title, description: t.description, value: t.amountCents / 100,
              daysToDeliver: t.daysToDeliver, daysToInspect: t.daysToInspect,
            }],
          },
          parties: {
            create: [
              { token: t.buyerToken, role: "BUYER" },
              { token: t.sellerToken, role: "SELLER" },
              { token: await this.agentToken(), role: "AGENT", fee: t.agentFeeCents / 100, feeType: "FLAT", feeAllocation: "SELLER" },
            ],
          },
        },
      },
    );
    return { transactionId: d.transactionCreate.id, allocationId: d.transactionCreate.allocations[0].id };
  }

  async checkoutUrl(transactionId: string) {
    const d = await this.gql<{ checkoutLink: string }>(`mutation checkoutLink($id: ID!) { checkoutLink(transactionId: $id) }`, { id: transactionId });
    if (!/^https:\/\//.test(d.checkoutLink ?? "")) throw new Error("TradeSafe returned no payment link");
    return d.checkoutLink;
  }

  async startDelivery(allocationId: string) {
    await this.gql(`mutation s($id: ID!) { allocationStartDelivery(id: $id) { id state } }`, { id: allocationId });
  }

  async release(allocationId: string) {
    // Tell TradeSafe it's delivered (if not already), then accept so the seller is paid.
    // [CONFIRM] with TradeSafe that the AGENT may accept on the buyer's behalf once our return window has closed.
    // Their plugin only calls complete and lets the buyer (or the inspection timer) accept. If accept is refused,
    // run-due keeps the payout scheduled and alerts the team; TradeSafe's own inspection timer then releases it.
    try {
      await this.gql(`mutation c($id: ID!) { allocationCompleteDelivery(id: $id) { id state } }`, { id: allocationId });
    } catch (e) { console.error("complete delivery (may already be done)", e); }
    await this.gql(`mutation a($id: ID!) { allocationAcceptDelivery(id: $id) { id state } }`, { id: allocationId });
  }

  async transactionState(transactionId: string) {
    const d = await this.gql<{ transaction: { state: string; reference: string | null } | null }>(
      `query t($id: ID!) { transaction(id: $id) { state reference } }`, { id: transactionId });
    return d.transaction ?? null;
  }

  async paymentMethod(transactionId: string) {
    // Their plugin reads transaction { deposits { method } }. [CONFIRM] the exact Ozow code; we match "ozow" in it.
    try {
      const d = await this.gql<{ transaction: { deposits: { method: string | null; processed: boolean | null }[] | null } | null }>(
        `query m($id: ID!) { transaction(id: $id) { deposits { method processed } } }`, { id: transactionId });
      const deps = d.transaction?.deposits ?? [];
      const m = (deps.find((x) => x.processed) ?? deps[0])?.method;
      return typeof m === "string" ? m.slice(0, 40) : null;
    } catch (e) {
      console.error("payment method", e);
      return null;
    }
  }

  async refund(transactionId: string) {
    // transactionCancel refunds the buyer's deposit (TradeSafe docs). [CONFIRM] it works after delivery started.
    await this.gql(`mutation x($id: ID!, $comment: String) { transactionCancel(id: $id, comment: $comment) { id state } }`,
      { id: transactionId, comment: "Refunded by myHaul" });
  }
}

/**
 * Live money needs TRADESAFE_MODE=live. Test mode (no real money, a "pay" button that just marks orders paid)
 * only runs when TRADESAFE_MODE=mock is set on purpose. If the setting is missing, payments are refused,
 * so a forgotten setting can never let people "pay" for real goods with nothing.
 */
export function escrow(): Escrow {
  const mode = Deno.env.get("TRADESAFE_MODE");
  if (mode === "live") return new TradeSafe();
  if (mode === "mock") {
    // Test payments can never run on the real site (myhaul.co.za), even if the setting is left on by mistake.
    // The Netlify test site can use them while we test before launch.
    if (/myhaul\.co\.za/i.test(Deno.env.get("APP_URL") ?? "")) throw new UserError("Payments aren't switched on yet. Please try again later.", 503);
    return new MockEscrow();
  }
  throw new UserError("Payments aren't switched on yet. Please try again later.", 503);
}

/** Only cleared money counts as paid. "Funds deposited" just means the buyer started paying (an EFT can take
 * up to 36 hours to clear), so sellers must not ship yet. The later states (delivery started, delivered, released)
 * can only follow cleared money, so a missed callback still counts as paid. State codes from TradeSafe's plugin. */
export const PAID_STATES = ["FUNDS_RECEIVED", "INITIATED", "DELIVERED", "FUNDS_RELEASED"];

/** Days we give TradeSafe for delivery and inspection, so its own auto release never beats our return window. */
export const ESCROW_DAYS = {
  buy_now: { deliver: 10, inspect: 7 },
  auction: { deliver: 10, inspect: 2 },
  order_now: { deliver: 30, inspect: 1 },
} as const;
