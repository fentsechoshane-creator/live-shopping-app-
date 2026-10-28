// Escrow provider. TradeSafe in live mode, a fake in mock mode so the whole order flow can be tested without keys.
// [CONFIRM] every GraphQL shape below against the TradeSafe schema playground before going live:
// https://docs.tradesafe.co.za and https://developer.tradesafe.co.za/api-spec/
import { env } from "./http.ts";

export interface PartyInput {
  givenName: string;
  familyName: string;
  email: string;
  mobile: string;
  idNumber?: string;
  bank?: { bank: string; accountNumber: string; accountType: "SAVINGS" | "CHEQUE" };
}

export interface TransactionInput {
  reference: string;
  title: string;
  description: string;
  buyerToken: string;
  sellerToken: string;
  /** Everything the buyer pays, in cents. */
  amountCents: number;
  /** Our cut (seller fee + protection fee - credit), in cents. Taken from the seller's side of the allocation. */
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
}

class TradeSafe implements Escrow {
  mode = "live" as const;
  private token: { value: string; expires: number } | null = null;

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
    });
    if (!res.ok) throw new Error(`TradeSafe auth failed: ${res.status}`);
    const j = await res.json();
    this.token = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(env("TRADESAFE_API_URL"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await this.accessToken()}` },
      body: JSON.stringify({ query, variables }),
    });
    const j = await res.json();
    if (!res.ok || j.errors) throw new Error(`TradeSafe error: ${JSON.stringify(j.errors ?? res.status)}`);
    return j.data as T;
  }

  async createParty(p: PartyInput) {
    const d = await this.gql<{ tokenCreate: { id: string } }>(
      `mutation tokenCreate($input: TokenInput) { tokenCreate(input: $input) { id } }`,
      {
        input: {
          user: {
            givenName: p.givenName, familyName: p.familyName, email: p.email, mobile: p.mobile,
            ...(p.idNumber ? { idNumber: p.idNumber, idType: "NATIONAL", idCountry: "ZAF" } : {}),
          },
          ...(p.bank ? { bankAccount: p.bank } : {}),
        },
      },
    );
    return d.tokenCreate.id;
  }

  async createTransaction(t: TransactionInput) {
    const d = await this.gql<{ transactionCreate: { id: string; allocations: { id: string }[] } }>(
      `mutation transactionCreate($input: CreateTransactionInput) {
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
              { token: env("TRADESAFE_AGENT_TOKEN"), role: "AGENT", fee: t.agentFeeCents / 100, feeType: "FLAT", feeAllocation: "SELLER" },
            ],
          },
        },
      },
    );
    return { transactionId: d.transactionCreate.id, allocationId: d.transactionCreate.allocations[0].id };
  }

  async checkoutUrl(transactionId: string) {
    const d = await this.gql<{ checkoutLink: string }>(`mutation checkoutLink($id: ID!) { checkoutLink(transactionId: $id) }`, { id: transactionId });
    return d.checkoutLink;
  }

  async startDelivery(allocationId: string) {
    await this.gql(`mutation s($id: ID!) { allocationStartDelivery(id: $id) { id state } }`, { id: allocationId });
  }

  async release(allocationId: string) {
    // [CONFIRM] with TradeSafe that the agent may accept on the buyer's behalf once our return window has closed.
    await this.gql(`mutation c($id: ID!) { allocationCompleteDelivery(id: $id) { id state } }`, { id: allocationId });
    await this.gql(`mutation a($id: ID!) { allocationAcceptDelivery(id: $id) { id state } }`, { id: allocationId });
  }

  async refund(transactionId: string) {
    // transactionCancel refunds the buyer's deposit. [CONFIRM] it works after delivery has started, or use a dispute.
    await this.gql(`mutation x($id: ID!) { transactionCancel(id: $id) { id state } }`, { id: transactionId });
  }
}

export function escrow(): Escrow {
  return (Deno.env.get("TRADESAFE_MODE") ?? "mock") === "live" ? new TradeSafe() : new MockEscrow();
}

/** Days we give TradeSafe for delivery and inspection, so its own auto release never beats our return window. */
export const ESCROW_DAYS = {
  buy_now: { deliver: 10, inspect: 7 },
  auction: { deliver: 10, inspect: 2 },
  order_now: { deliver: 30, inspect: 1 },
} as const;
