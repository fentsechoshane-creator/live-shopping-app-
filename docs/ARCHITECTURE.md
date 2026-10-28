# How it works

## The big rules

1. **We never hold customer money.** Every payment goes into TradeSafe escrow. Sellers are paid by TradeSafe when we release the money.
2. **Sellers are paid only after the buyer's return window closes**, with no claim open. Buy now: 7 days after delivery (ECT Act s44). Auction: 2 days. Made to order food: 1 day. The trust tier changes how fast payment follows after that point, never before.
3. **Prices are worked out on the server.** The app shows totals using the same code, but the `checkout` function recalculates them, and the database refuses an order whose numbers do not add up.
4. **The database enforces the rules**, so no app bug can skip them: order status changes, counterfeit words, unbranded dupes naming brands, designer proof, food certificates, auction unlocks and seller checks.

## Money on one order (R350 item, free collection)

| | |
| --- | --- |
| Buyer pays | R362 (R350 + R12 buyer protection) |
| Into escrow | R362 |
| Our fee (agent fee in TradeSafe) | R33 (6% seller fee R21 + protection R12) |
| Seller is paid | R329 (R350 - R21), once the window closes |
| TradeSafe's own fee | Paid from our R33 |

Welcome credit: R50 off a buyer's first order of R200 or more. It is our discount, paid from the welcome credit budget (R15,000 for 300 buyers). Escrow can only pay out what the buyer deposited, so when the credit is bigger than our cut on that order, our agent fee is R0 and we EFT the seller the difference ourselves (`credit_topup_cents`). The Admin page lists top ups to pay with each payout. Example: R349 tee, buyer pays R311, escrow pays the seller R311, we top up R17.06, seller gets R328.06 as normal.

## Order statuses

`pending_payment > paid > shipped > delivered > completed`, with returns: `delivered > return_requested > return_in_transit > refunded`. The allowed moves are in `packages/core/src/orders.ts` and enforced by the `orders_guard` trigger.

| Event | Who | Where |
| --- | --- | --- |
| Pay | Buyer, on TradeSafe's page | `checkout`, then `escrow-webhook` marks paid |
| Ship (tracking, packing video) | Seller | `order-action` (tells TradeSafe delivery started) |
| Received | Buyer (until courier tracking is connected) | `confirm_received()` |
| Return requested | Buyer, inside the window | `request_return()` |
| Accept, item back, refund | Seller | `order-action` (refund from held money) |
| Disagree | Seller (not for change of mind) | `order-action`, our team decides in Admin |
| Not shipped in 72 h | Scheduled job | `run-due` refunds, seller loses 5 points |
| Window closed | Scheduled job | `run-due` completes the order, schedules and releases the payout |

## Trust score

Starts at 50, between 0 and 100. Points are in `trust_rules` (database) and `TRUST_POINTS` (core); keep them the same. Events are added by database triggers and server functions, never by the app. Tiers: Top 90+, Trusted 70+, Standard 40+, Restricted under 40 (hidden from the feed, payouts held).

## Data the app keeps, and what it does not

- Bank account numbers: **not stored**. They go to TradeSafe; we keep the bank name and last 4 digits.
- ID numbers: passed to TradeSafe if the seller gives one, not stored.
- ID photo, selfie, food certificate, designer proof, packing videos: private storage bucket, readable only by the owner and our team.
- Delivery details: on the order, needed for delivery. [CONFIRM] retention period with the lawyer (POPIA).

## Open questions before going live ([CONFIRM])

1. **TradeSafe API shapes**: field names in `escrow.ts` (token, transaction, checkout link, delivery and cancel mutations, bank enum values) must be checked in their schema playground.
2. **Release timing**: we create each transaction with inspection days equal to our return window, and release by calling complete and accept delivery as the agent. Confirm the agent may accept, and that TradeSafe will not auto release earlier.
3. **Refund after delivery started**: we use `transactionCancel`. Confirm it works once delivery has started, or use their dispute flow.
4. **Fees**: TradeSafe's per order fee and card costs, and whether payouts faster than monthly cost R5 per party per order.
5. **New seller reserve** (10% kept for 30 days): not applied. It needs a second escrow allocation per order. Decide if we want it.
6. **Welcome credit top ups** are paid by EFT from our account. Later, this could be automated through our bank's API.
7. **Delivery**: PUDO lockers are a sample list, and couriers are booked by the seller. Courier tracking webhooks, to mark orders delivered automatically, are not built.
8. **Public holidays** are not skipped in payout dates yet.
