import { describe, expect, it } from "vitest";
import { quotedDeliveryFee, refundFee, paymentKind, PAYOUT_SCHEDULES, CHARGE_QUOTES, PARCEL_SIZES, editLength, locate, clipStartsAt, activeMarks, validateEdit, tidyMark, EDIT_LIMITS,
  deliveryFee, deliveryPerk, PARCEL_SIZE_IDS,
  rand, formatRand, protectionFee, orderTotals, sellerFee, releasableAt, payoutDate, nextFriday, addWorkingDays,
  reserveFor, scoreFrom, tierFor, canUse, canForceOn, packingVideoProblems, validateListing, canTransition, returnReasonsFor, shipBy,
  liveStock, goLiveBlockers, MIN_LIVE_STOCK, isRude, looksOffApp, bidStep, maxBidReplies, nextMinBid, reserveProblem, timeLeft, maskHandle,
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
    expect(t.total).toBe(rand(349 + 95 + 12)); // item + small locker + protection
  });
  it("founding sellers pay no fee while the free period runs", () => {
    const until = new Date("2027-04-01");
    expect(sellerFee(rand(350), { foundingUntil: until, at: new Date("2027-03-01") })).toBe(0);
    expect(sellerFee(rand(350), { foundingUntil: until, at: new Date("2027-05-01") })).toBe(rand(21));
  });
  it("gives the full R50 welcome credit and tops the seller up from our budget", () => {
    // R349 tee: our cut is R20.94 + R12 = R32.94, the credit is R50, so we top up R17.06.
    const tee = orderTotals({ itemPrice: rand(349), delivery: "collect_cpt", welcomeCreditAvailable: true });
    expect(tee.creditUsed).toBe(rand(50));
    expect(tee.total).toBe(rand(311));
    expect(tee.escrowAgentFee).toBe(0);
    expect(tee.creditTopUp).toBe(1706);
    const big = orderTotals({ itemPrice: rand(900), delivery: "courier", welcomeCreditAvailable: true });
    expect(big.creditUsed).toBe(rand(50));
    expect(big.creditTopUp).toBe(0);
    const small = orderTotals({ itemPrice: rand(150), delivery: "courier", welcomeCreditAvailable: true });
    expect(small.creditUsed).toBe(0);
  });
  it("escrow plus our top up always pays the seller exactly", () => {
    for (let p = 20; p <= 3000; p += 7) {
      for (const credit of [true, false]) {
        const t = orderTotals({ itemPrice: rand(p), delivery: "pudo_locker", welcomeCreditAvailable: credit });
        expect(t.total - t.escrowAgentFee + t.creditTopUp).toBe(t.sellerPayout);
        expect(t.escrowAgentFee).toBeGreaterThanOrEqual(0);
        expect(t.creditTopUp).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("delivery by parcel size", () => {
  it("prices courier and lockers by size, every size fits a PUDO locker", () => {
    expect(deliveryFee("courier", "small")).toBe(rand(110));
    expect(deliveryFee("courier", "medium")).toBe(rand(190));
    expect(deliveryFee("courier", "large")).toBe(rand(250));
    expect(deliveryFee("pudo_locker", "small")).toBe(rand(95));
    expect(deliveryFee("pudo_locker", "medium")).toBe(rand(130));
    expect(deliveryFee("pudo_locker", "large")).toBe(rand(185));
    // PUDO lockers are 60 x 41 cm, 8, 19 and 41 cm high.
    expect(PARCEL_SIZES.small.box).toEqual({ length: 60, width: 41, height: 8 });
    expect(PARCEL_SIZES.large.box.height).toBe(41);
  });
  it("keeps courier money for Bob Go and pays the seller item minus fee", () => {
    const t = orderTotals({ itemPrice: rand(400), delivery: "courier", parcelSize: "medium" });
    expect(t.deliveryKept).toBe(rand(190));
    expect(t.sellerPayout).toBe(rand(400) - t.sellerFee);
    expect(t.total - t.escrowAgentFee).toBe(t.sellerPayout);
  });
  it("still pays bakers who deliver themselves", () => {
    const t = orderTotals({ itemPrice: rand(300), delivery: "baker_delivers" });
    expect(t.deliveryKept).toBe(0);
    expect(t.sellerPayout).toBe(rand(340) - t.sellerFee);
  });
  it("escrow plus our top up pays the seller exactly, every size and option", () => {
    for (const parcelSize of PARCEL_SIZE_IDS) for (const delivery of ["courier", "pudo_locker", "collect_cpt"] as const) {
      if (deliveryFee(delivery, parcelSize) === null) continue;
      for (let p = 50; p <= 2000; p += 37) for (const credit of [true, false]) {
        const t = orderTotals({ itemPrice: rand(p), delivery, parcelSize, welcomeCreditAvailable: credit });
        expect(t.total - t.escrowAgentFee + t.creditTopUp).toBe(t.sellerPayout);
      }
    }
  });
});

describe("delivery perks", () => {
  it("5 Instant EFT stamps give half price delivery, at most R45", () => {
    expect(deliveryPerk("courier", rand(90), rand(300), true)).toEqual({ cents: rand(45), perk: "stamp" });
    expect(deliveryPerk("courier", rand(180), rand(300), true)).toEqual({ cents: rand(45), perk: "stamp" });
    expect(deliveryPerk("pudo_locker", rand(60), rand(300), true)).toEqual({ cents: rand(30), perk: "stamp" });
    expect(deliveryPerk("collect_cpt", 0, rand(300), true).perk).toBeNull();
  });
  it("big orders: half price from R1,000, a free locker from R1,500, and the best perk wins", () => {
    expect(deliveryPerk("courier", rand(90), rand(1000), false)).toEqual({ cents: rand(45), perk: "big_order" });
    expect(deliveryPerk("pudo_locker", rand(60), rand(1500), true)).toEqual({ cents: rand(60), perk: "big_order" });
    expect(deliveryPerk("courier", rand(90), rand(1500), false)).toEqual({ cents: rand(45), perk: "big_order" });
    expect(deliveryPerk("courier", rand(90), rand(999), false).perk).toBeNull();
    expect(deliveryPerk("baker_delivers", rand(40), rand(2000), true).perk).toBeNull();
  });
  it("the buyer pays less, the seller gets the same, and escrow still balances", () => {
    const plain = orderTotals({ itemPrice: rand(350), delivery: "courier", parcelSize: "small" });
    const perk = orderTotals({ itemPrice: rand(350), delivery: "courier", parcelSize: "small", stampsReady: true });
    expect(plain.total - perk.total).toBe(rand(45));
    expect(perk.sellerPayout).toBe(plain.sellerPayout);
    expect(perk.total - perk.escrowAgentFee + perk.creditTopUp).toBe(perk.sellerPayout);
    expect(orderTotals({ itemPrice: rand(350), delivery: "courier", stampsReady: true, perksOn: false }).deliveryDiscount).toBe(0);
  });
  it("escrow balances with every mix of reward and perk", () => {
    for (let p = 100; p <= 3000; p += 53) for (const credit of [true, false]) for (const stamps of [true, false]) for (const d of ["courier", "pudo_locker"] as const) {
      const t = orderTotals({ itemPrice: rand(p), delivery: d, welcomeCreditAvailable: credit, stampsReady: stamps });
      expect(t.total - t.escrowAgentFee + t.creditTopUp).toBe(t.sellerPayout);
      expect(t.deliveryDiscount).toBeLessThanOrEqual(t.deliveryFee);
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

describe("packing proof", () => {
  it("checks the video length and size before upload", () => {
    expect(packingVideoProblems(30, 20e6)).toEqual([]);
    expect(packingVideoProblems(8, 5e6)[0]).toMatch(/too short/);
    expect(packingVideoProblems(150, 20e6)[0]).toMatch(/too long/);
    expect(packingVideoProblems(60, 200e6)[0]).toMatch(/too big/);
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
    // Team switches: "on" skips the milestone only, "off" always wins.
    expect(canUse("timed_auction", { ...base, overrides: { auctions: "on" } }).ok).toBe(true);
    expect(canUse("timed_auction", { ...base, verified: false, overrides: { auctions: "on" } }).ok).toBe(false);
    expect(canUse("timed_auction", { ...base, goodOrders: 9, overrides: { auctions: "off" } }).ok).toBe(false);
    expect(canUse("buy_now", { ...base, overrides: { sell: "off" } }).reason).toMatch(/turned off for your account/);
    expect(canForceOn("auctions")).toBe(true);
    expect(canForceOn("sell")).toBe(false);
    expect(canUse("live_auction", { ...base, goodOrders: 5, trustScore: 72 }).ok).toBe(true);
  });
  it("food needs an approved certificate", () => {
    expect(canUse("order_now", { ...base, category: "food" }).ok).toBe(false);
    expect(canUse("order_now", { ...base, category: "food", foodCertApproved: true }).ok).toBe(true);
  });
  it("made to order is for food, home and beauty (13 Nov)", () => {
    expect(canUse("order_now", { ...base, category: "home" }).ok).toBe(true);
    expect(canUse("order_now", { ...base, category: "beauty" }).ok).toBe(true);
    expect(canUse("order_now", { ...base, category: "clothes" }).ok).toBe(false);
    expect(canUse("order_now", { ...base, category: "fragrance" }).ok).toBe(false);
  });
  it("unverified sellers cannot sell", () => {
    expect(canUse("buy_now", { ...base, verified: false }).ok).toBe(false);
  });
});

describe("listing rules", () => {
  const ok = { title: "Oversized tee, sand", price: rand(349), label: "new" as const, mode: "buy_now" as const };
  it("accepts a normal listing", () => expect(validateListing(ok)).toEqual([]));
  it("appliances must be new with a receipt, and no second hand phones (13 Nov)", () => {
    expect(validateListing({ ...ok, label: "new", appliance: true }).join(" ")).toMatch(/receipt or warranty/);
    expect(validateListing({ ...ok, label: "new", appliance: true, hasProof: true })).toEqual([]);
    expect(validateListing({ ...ok, label: "pre_loved", condition: "good", appliance: true, hasProof: true }).join(" ")).toMatch(/must be new/);
    expect(validateListing({ ...ok, title: "iPhone 13, 128 GB", label: "pre_loved", condition: "good" }).join(" ")).toMatch(/phones, laptops/);
    expect(validateListing({ ...ok, title: "Leather laptop bag", label: "pre_loved", condition: "good" })).toEqual([]);
  });
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

describe("going live", () => {
  const ok = { verified: true, goodOrders: 5, trustScore: 72, category: "clothes" as const };
  it("counts stock of live Buy now listings only", () => {
    expect(liveStock([
      { status: "live", mode: "buy_now", stock: 3 },
      { status: "live", mode: "buy_now", stock: 2 },
      { status: "draft", mode: "buy_now", stock: 10 },
      { status: "live", mode: "order_now", stock: 99 },
    ])).toBe(5);
  });
  it("needs at least 5 in stock: 5 items or 5 of one item", () => {
    expect(MIN_LIVE_STOCK).toBe(5);
    expect(goLiveBlockers(ok, 4)[0]).toMatch(/can't go live without stock/);
    expect(goLiveBlockers(ok, 5)).toEqual([]);
  });
  it("still needs 5 good orders", () => {
    expect(goLiveBlockers({ ...ok, goodOrders: 2 }, 8)).toHaveLength(1);
    expect(goLiveBlockers({ ...ok, goodOrders: 2 }, 1)).toHaveLength(2);
  });
});

describe("safety", () => {
  it("catches rude words but not normal words", () => {
    expect(isRude("you bitch")).toBe(true);
    expect(isRude("Is this still available?")).toBe(false);
    expect(isRude("Scunthorpe")).toBe(false);
  });
  it("spots requests to pay outside the app", () => {
    expect(looksOffApp("WhatsApp me on 082 123 4567")).toBe(true);
    expect(looksOffApp("I can do EFT if you want")).toBe(true);
    expect(looksOffApp("Does it come in M?")).toBe(false);
    expect(looksOffApp("Send to my Capitec, acc 1234 567 890")).toBe(true);
    expect(looksOffApp("Just pay cash on collection")).toBe(true);
    expect(looksOffApp("Send proof of payment when done")).toBe(true);
    expect(looksOffApp("It's R350 and ships tomorrow")).toBe(false);
    expect(looksOffApp("Size 32 waist, 10 out of 10 condition")).toBe(false);
  });
});

describe("auctions", () => {
  it("raises in steps by price band", () => {
    expect(bidStep(10_000)).toBe(1_000);
    expect(bidStep(49_999)).toBe(1_000);
    expect(bidStep(50_000)).toBe(2_000);
    expect(bidStep(250_000)).toBe(5_000);
  });
  it("first bid can be the starting price, then a step above", () => {
    expect(nextMinBid(20_000, null)).toBe(20_000);
    expect(nextMinBid(20_000, 25_000)).toBe(26_000);
  });
  it("checks the reserve", () => {
    expect(reserveProblem(20_000, null)).toBeNull();
    expect(reserveProblem(20_000, 10_000)).toMatch(/lower/);
    expect(reserveProblem(20_000, 300_000)).toMatch(/10 times/);
  });
  it("shows time left and masks bidders", () => {
    expect(timeLeft(0)).toBe("Ended");
    expect(timeLeft(90 * 1000)).toBe("1m 30s");
    expect(timeLeft((26 * 3600 + 60) * 1000)).toBe("1d 2h");
    expect(maskHandle("thandi.m")).toBe("t***m");
  });
});

describe("video edits", () => {
  const e = { clips: [{ start: 2, end: 6, muted: false, inApp: true }, { start: 0, end: 3, muted: true, inApp: false }], marks: [
    { kind: "tag" as const, at: 0, productId: "a" }, { kind: "tag" as const, at: 4, productId: "b" },
    { kind: "text" as const, at: 1, text: "Size M" }, { kind: "flaw" as const, at: 5, text: "Small mark" },
  ], cover: 1 };
  it("joins clips on one timeline", () => {
    expect(editLength(e)).toBe(7);
    expect(locate(e, 1)).toEqual({ index: 0, sourceTime: 3 });
    expect(locate(e, 5)).toEqual({ index: 1, sourceTime: 1 });
    expect(clipStartsAt(e, 1)).toBe(4);
  });
  it("shows the right tag, text and flaw at each moment", () => {
    expect(activeMarks(e, 2).map((m) => m.productId ?? m.kind)).toEqual(["a", "text"]);
    expect(activeMarks(e, 5).map((m) => m.productId ?? m.kind)).toEqual(["b", "flaw"]);
    expect(activeMarks(e, 6.9).some((m) => m.productId === "b")).toBe(true);
  });
  it("checks limits", () => {
    expect(validateEdit(e)).toEqual([]);
    expect(validateEdit({ ...e, clips: [{ start: 1, end: 1.5, muted: false, inApp: true }] })[0]).toMatch(/too short/);
    expect(validateEdit({ ...e, clips: [{ start: 0, end: 200, muted: false, inApp: true }], cover: 0 })[0]).toMatch(/3 minutes/);
    expect(validateEdit({ ...e, marks: [{ kind: "text", at: 1, text: "" }] })[0]).toMatch(/empty/);
  });
});

describe("placeable text", () => {
  it("keeps text on screen, sizes in range and angles between -180 and 180", () => {
    const m = tidyMark({ kind: "text", at: 0, text: "Hi", x: 1.4, y: -0.2, size: 9, rot: 270 });
    expect(m.x).toBe(0.95); expect(m.y).toBe(0.05); expect(m.size).toBe(EDIT_LIMITS.maxTextSize); expect(m.rot).toBe(-90);
  });
  it("refuses odd styles, colours and sizes", () => {
    const base = { clips: [{ start: 0, end: 5, muted: false, inApp: true }], cover: 0 };
    expect(validateEdit({ ...base, marks: [{ kind: "text", at: 1, text: "Hi", x: 0.5, y: 0.3, size: 1.5, rot: 10, style: "box", color: "#22c55e" }] })).toEqual([]);
    expect(validateEdit({ ...base, marks: [{ kind: "text", at: 1, text: "Hi", style: "neon" as any }] })).toContain("Pick a text style.");
    expect(validateEdit({ ...base, marks: [{ kind: "text", at: 1, text: "Hi", color: "#123456" }] })).toContain("Pick a text colour.");
    expect(validateEdit({ ...base, marks: [{ kind: "text", at: 1, text: "Hi", size: 7 }] })).toContain("Text size is out of range.");
    expect(validateEdit({ ...base, marks: [{ kind: "text", at: 2, until: 1, text: "Hi" }] })).toContain("A text ends before it starts.");
  });
});

describe("quoted delivery prices", () => {
  it("rounds Bob Go's quote up to the next R5", () => {
    expect(quotedDeliveryFee(9601)).toBe(10000);
    expect(quotedDeliveryFee(9500)).toBe(9500);
    expect(quotedDeliveryFee(6001)).toBe(6500);
  });
  it("charges the flat price while quotes are switched off", () => {
    expect(CHARGE_QUOTES).toBe(false);
    const t = orderTotals({ itemPrice: rand(300), delivery: "courier", parcelSize: "small", quotedDeliveryCents: 9601 });
    expect(t.deliveryFee).toBe(rand(110));
    expect(t.deliveryKept).toBe(rand(110));
  });
});

describe("what sellers owe and refund fees (8 Nov 2026)", () => {
  it("takes what the seller owes from the payout, inside escrow, never more than the payout", () => {
    const base = orderTotals({ itemPrice: rand(350), delivery: "courier", parcelSize: "small" });
    const t = orderTotals({ itemPrice: rand(350), delivery: "courier", parcelSize: "small", sellerOwedCents: 863 });
    expect(t.chargesTaken).toBe(863);
    expect(t.sellerPayout).toBe(base.sellerPayout - 863);
    expect(t.total).toBe(base.total); // the buyer pays the same
    expect(t.total - t.escrowAgentFee).toBe(t.sellerPayout);
    const big = orderTotals({ itemPrice: rand(100), delivery: "collect_cpt", sellerOwedCents: rand(500) });
    expect(big.sellerPayout).toBe(0);
    expect(big.chargesTaken).toBe(rand(100) - big.sellerFee);
    expect(big.total - big.escrowAgentFee).toBe(0);
  });
  it("still balances with a reward and a perk", () => {
    const t = orderTotals({ itemPrice: rand(1600), delivery: "pudo_locker", welcomeCreditAvailable: true, sellerOwedCents: 2000 });
    expect(t.total - t.escrowAgentFee + t.creditTopUp).toBe(t.sellerPayout);
  });
  it("works out TradeSafe's refund fee by how the buyer paid, with VAT", () => {
    expect(paymentKind("OZOW")).toBe("ozow");
    expect(paymentKind("INSTANT_EFT")).toBe("ozow");
    expect(paymentKind("EFT")).toBe("eft");
    expect(paymentKind("CARD")).toBe("card");
    expect(paymentKind(null)).toBe("card");
    expect(refundFee("EFT", rand(472))).toBe(863); // R7.50 + VAT
    expect(refundFee("OZOW", rand(472))).toBe(815); // 1.5% of R472 + VAT = R8.142
    expect(refundFee("CARD", rand(472))).toBe(1357); // 2.5% + VAT
  });
  it("offers three payout schedules", () => {
    expect(Object.keys(PAYOUT_SCHEDULES)).toEqual(["IMMEDIATE", "WEEKLY", "MONTHLY"]);
  });
});

describe("max bids", () => {
  const at = (s: number) => `2026-11-11T12:00:0${s}Z`;
  it("does nothing when nobody has a max above the next step", () => {
    expect(maxBidReplies({ bidderId: "a", amountCents: 72_000 }, [{ bidderId: "b", maxCents: 73_000, setAt: at(1) }])).toEqual([]);
  });
  it("bids just enough for a challenger with a higher max", () => {
    expect(maxBidReplies({ bidderId: "a", amountCents: 72_000 }, [{ bidderId: "b", maxCents: 90_000, setAt: at(1) }]))
      .toEqual([{ bidderId: "b", amountCents: 74_000 }]);
  });
  it("keeps the leader on top when their max is higher, one step over the other max", () => {
    expect(maxBidReplies({ bidderId: "b", amountCents: 74_000 }, [
      { bidderId: "a", maxCents: 80_000, setAt: at(2) }, { bidderId: "b", maxCents: 100_000, setAt: at(1) },
    ])).toEqual([{ bidderId: "a", amountCents: 80_000 }, { bidderId: "b", amountCents: 82_000 }]);
  });
  it("never bids over someone's max", () => {
    const r = maxBidReplies({ bidderId: "b", amountCents: 74_000 }, [
      { bidderId: "a", maxCents: 80_000, setAt: at(2) }, { bidderId: "b", maxCents: 81_000, setAt: at(1) },
    ]);
    expect(r).toEqual([{ bidderId: "a", amountCents: 80_000 }, { bidderId: "b", amountCents: 81_000 }]);
  });
  it("hands the lead to a higher max, showing the old leader's max first", () => {
    expect(maxBidReplies({ bidderId: "a", amountCents: 74_000 }, [
      { bidderId: "a", maxCents: 80_000, setAt: at(1) }, { bidderId: "b", maxCents: 120_000, setAt: at(2) },
    ])).toEqual([{ bidderId: "a", amountCents: 80_000 }, { bidderId: "b", amountCents: 82_000 }]);
  });
  it("on an equal max, whoever set it first wins", () => {
    expect(maxBidReplies({ bidderId: "a", amountCents: 74_000 }, [
      { bidderId: "a", maxCents: 90_000, setAt: at(2) }, { bidderId: "b", maxCents: 90_000, setAt: at(1) },
    ])).toEqual([{ bidderId: "b", amountCents: 90_000 }]);
    expect(maxBidReplies({ bidderId: "a", amountCents: 74_000 }, [
      { bidderId: "a", maxCents: 90_000, setAt: at(1) }, { bidderId: "b", maxCents: 90_000, setAt: at(2) },
    ])).toEqual([{ bidderId: "a", amountCents: 90_000 }]);
  });
  it("the R800, R900, R1,200 example: R1,200 leads at R950", () => {
    const r = maxBidReplies({ bidderId: "z", amountCents: 70_000 }, [
      { bidderId: "a", maxCents: 80_000, setAt: at(1) }, { bidderId: "b", maxCents: 90_000, setAt: at(2) }, { bidderId: "c", maxCents: 120_000, setAt: at(3) },
    ]);
    expect(r[r.length - 1]).toEqual({ bidderId: "c", amountCents: 92_000 });
  });
  it("settles three maxes and stops", () => {
    const r = maxBidReplies({ bidderId: "z", amountCents: 50_000 }, [
      { bidderId: "a", maxCents: 60_000, setAt: at(1) }, { bidderId: "b", maxCents: 70_000, setAt: at(2) }, { bidderId: "c", maxCents: 65_000, setAt: at(3) },
    ]);
    expect(r[r.length - 1]).toEqual({ bidderId: "b", amountCents: 67_000 });
    expect(r.every((x, i) => i === 0 || x.amountCents > r[i - 1].amountCents)).toBe(true);
  });
});
