import { describe, expect, it } from "vitest";
import {
  rand, formatRand, protectionFee, orderTotals, sellerFee, releasableAt, payoutDate, nextFriday, addWorkingDays,
  reserveFor, scoreFrom, tierFor, canUse, validateListing, canTransition, returnReasonsFor, shipBy,
} from "../src/index.ts";

describe("money", () => {
  it("formats rand", () => {
    expect(formatRand(34900)).toBe("R349");
    expect(formatRand(123456)).toBe("R1,234.56");
    expect(formatRand(-5000)).toBe("-R50");
  });
});

describe("fees", () => {
  it("buyer protection follows the tiers", () => {
    expect(protectionFee(rand(149))).toBe(rand(5));
    expect(protectionFee(rand(150))).toBe(rand(12));
    expect(protectionFee(rand(500))).toBe(rand(12));
    expect(protectionFee(rand(1200))).toBe(rand(42));
  });
  it("matches the report example: R350 order", () => {
    const t = orderTotals({ itemPrice: rand(350), delivery: "collect_cpt" });
    expect(t.total).toBe(rand(362));
    expect(t.sellerFee).toBe(rand(21));
    expect(t.sellerPayout).toBe(rand(329));
    expect(t.platformRevenue).toBe(rand(33));
  });
  it("matches the prototype checkout: R349 tee to a PUDO locker", () => {
    const t = orderTotals({ itemPrice: rand(349), delivery: "pudo_locker" });
    expect(t.total).toBe(rand(421));
  });
  it("founding sellers pay no fee while the free period runs", () => {
    const until = new Date("2027-04-01");
    expect(sellerFee(rand(350), { foundingUntil: until, at: new Date("2027-03-01") })).toBe(0);
    expect(sellerFee(rand(350), { foundingUntil: until, at: new Date("2027-05-01") })).toBe(rand(21));
  });
  it("caps the welcome credit at our cut so escrow always balances", () => {
    const t = orderTotals({ itemPrice: rand(350), delivery: "courier", welcomeCreditAvailable: true });
    expect(t.creditUsed).toBe(rand(33));
    expect(t.total - t.sellerPayout).toBeGreaterThanOrEqual(0);
    const big = orderTotals({ itemPrice: rand(900), delivery: "courier", welcomeCreditAvailable: true });
    expect(big.creditUsed).toBe(rand(50));
    const small = orderTotals({ itemPrice: rand(150), delivery: "courier", welcomeCreditAvailable: true });
    expect(small.creditUsed).toBe(0);
  });
  it("buyer total always covers the seller payout", () => {
    for (let p = 20; p <= 3000; p += 7) {
      for (const credit of [true, false]) {
        const t = orderTotals({ itemPrice: rand(p), delivery: "pudo_locker", welcomeCreditAvailable: credit });
        expect(t.total).toBeGreaterThanOrEqual(t.sellerPayout);
      }
    }
  });
});

describe("payouts", () => {
  const delivered = new Date("2027-03-01T10:00:00Z"); // a Monday
  it("holds Buy now for 7 days, auctions 2 days, food 1 day", () => {
    expect(releasableAt("buy_now", delivered).toISOString()).toBe("2027-03-08T10:00:00.000Z");
    expect(releasableAt("auction", delivered).toISOString()).toBe("2027-03-03T10:00:00.000Z");
    expect(releasableAt("order_now", delivered).toISOString()).toBe("2027-03-02T10:00:00.000Z");
  });
  it("trust tier sets speed only after the window", () => {
    const r = releasableAt("buy_now", delivered); // Monday 8 March
    expect(payoutDate("top", r)!.toISOString().slice(0, 10)).toBe("2027-03-09");
    expect(payoutDate("trusted", r)!.toISOString().slice(0, 10)).toBe("2027-03-10");
    expect(payoutDate("standard", r)!.toISOString().slice(0, 10)).toBe("2027-03-12");
    expect(payoutDate("restricted", r)).toBeNull();
    for (const tier of ["top", "trusted", "standard"] as const) expect(payoutDate(tier, r)!.getTime()).toBeGreaterThan(r.getTime());
  });
  it("skips weekends", () => {
    expect(addWorkingDays(new Date("2027-03-05T12:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2027-03-08");
    expect(nextFriday(new Date("2027-03-13T12:00:00Z")).toISOString().slice(0, 10)).toBe("2027-03-19");
  });
  it("keeps a 10% reserve on a new seller's first 10 payouts", () => {
    expect(reserveFor(0, 10000)).toBe(1000);
    expect(reserveFor(9, 10000)).toBe(1000);
    expect(reserveFor(10, 10000)).toBe(0);
  });
  it("refund deadline for unshipped orders is 72 hours", () => {
    expect(shipBy(new Date("2027-03-01T10:00:00Z")).toISOString()).toBe("2027-03-04T10:00:00.000Z");
  });
});

describe("trust score", () => {
  it("starts at 50 and stays between 0 and 100", () => {
    expect(scoreFrom([])).toBe(50);
    expect(scoreFrom(["verified"])).toBe(60);
    expect(scoreFrom(Array(40).fill("order_kept"))).toBe(100);
    expect(scoreFrom(Array(5).fill("fake_reviews_or_shill_bidding"))).toBe(0);
  });
  it("maps scores to tiers", () => {
    expect(tierFor(95)).toBe("top");
    expect(tierFor(70)).toBe("trusted");
    expect(tierFor(40)).toBe("standard");
    expect(tierFor(39)).toBe("restricted");
  });
});

describe("unlocks", () => {
  const base = { verified: true, goodOrders: 0, trustScore: 60, category: "clothes" as const };
  it("day one sellers get Buy now but not auctions", () => {
    expect(canUse("buy_now", base).ok).toBe(true);
    expect(canUse("timed_auction", base).ok).toBe(false);
  });
  it("auctions unlock after 5 good orders, live auctions at 70", () => {
    expect(canUse("timed_auction", { ...base, goodOrders: 5 }).ok).toBe(true);
    expect(canUse("live_auction", { ...base, goodOrders: 5 }).ok).toBe(false);
    expect(canUse("live_auction", { ...base, goodOrders: 5, trustScore: 72 }).ok).toBe(true);
  });
  it("food needs an approved certificate", () => {
    expect(canUse("order_now", { ...base, category: "food" }).ok).toBe(false);
    expect(canUse("order_now", { ...base, category: "food", foodCertApproved: true }).ok).toBe(true);
  });
  it("unverified sellers cannot sell", () => {
    expect(canUse("buy_now", { ...base, verified: false }).ok).toBe(false);
  });
});

describe("listing rules", () => {
  const ok = { title: "Oversized tee, sand", price: rand(349), label: "new" as const, mode: "buy_now" as const };
  it("accepts a normal listing", () => expect(validateListing(ok)).toEqual([]));
  it("blocks replicas even when labelled", () => {
    expect(validateListing({ ...ok, title: "Jordan 4 reps, 1:1" }).join(" ")).toMatch(/Counterfeit/);
  });
  it("blocks brand names on dupes", () => {
    expect(validateListing({ ...ok, label: "unbranded_dupe", title: "Nike style runner" }).length).toBe(1);
    expect(validateListing({ ...ok, label: "unbranded_dupe", title: "Chunky white runner" })).toEqual([]);
  });
  it("needs a condition for pre loved and proof for designer", () => {
    expect(validateListing({ ...ok, label: "pre_loved" }).length).toBe(1);
    expect(validateListing({ ...ok, label: "authentic_designer" }).length).toBe(1);
  });
});

describe("orders", () => {
  it("follows the allowed transitions", () => {
    expect(canTransition("paid", "shipped")).toBe(true);
    expect(canTransition("completed", "refunded")).toBe(false);
    expect(canTransition("pending_payment", "shipped")).toBe(false);
  });
  it("only Buy now allows change of mind", () => {
    expect(returnReasonsFor("buy_now")).toContain("changed_mind");
    expect(returnReasonsFor("order_now")).not.toContain("changed_mind");
  });
});
