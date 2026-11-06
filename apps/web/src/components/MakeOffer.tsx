import { useState } from "react";
import { MIN_PRICE } from "@app/core";
import { api } from "../api";
import { ErrorNote, R, Sheet, useAction } from "./ui";
import { Icon } from "./Icon";

/** Round down to the nearest R5, so suggestions look like prices people actually say. */
const nice = (cents: number) => Math.floor(cents / 500) * 500;

/**
 * Make an offer, like Vinted and Depop: three suggested prices or your own. The seller accepts, counters or
 * declines in the chat. Rules (checked again on the server): at least R50, under the listed price, and at least half.
 */
export function MakeOfferSheet({ item, conversationId, onClose, onSent }: {
  item: { productId: string; shopId: string; title: string; priceCents: number };
  conversationId?: string;
  onClose: () => void;
  onSent: (conversationId: string) => void;
}) {
  const listed = item.priceCents;
  const floor = Math.max(MIN_PRICE, Math.ceil(listed / 2));
  const picks = [0.9, 0.85, 0.8].map((f) => nice(listed * f)).filter((c, i, a) => c >= floor && c < listed && a.indexOf(c) === i);
  const [cents, setCents] = useState<number>(picks[0] ?? 0);
  const [custom, setCustom] = useState("");
  const { busy, error, run } = useAction();
  const value = custom ? Math.round((Number(custom) || 0) * 100) : cents;
  const problem = !value ? null : value < floor ? `The lowest offer is ${R(floor)}.` : value >= listed ? `Offer less than ${R(listed)}.` : null;
  const send = () => run(async () => {
    const conv = conversationId ?? (await api.openConversation(item.shopId));
    await api.buyerOffer(conv, item.productId, value);
    onSent(conv);
  });
  const canOffer = listed > floor;
  return (
    <Sheet title="Make an offer" onClose={onClose}
      footer={<button className="btn green block big" disabled={busy || !value || !!problem || !canOffer} onClick={send}>
        {busy ? "Sending…" : value && !problem ? `Offer ${R(value)}` : "Make an offer"}</button>}>
      <ErrorNote error={error} />
      <div className="mo-item"><b>{item.title}</b><span className="muted">Listed at {R(listed)}</span></div>
      {!canOffer ? (
        <p className="small muted">This item is already at the lowest price we can take offers on. You can still buy it or message the seller.</p>
      ) : (
        <>
          <div className="mo-picks" role="group" aria-label="Suggested offers">
            {picks.map((c) => (
              <button key={c} type="button" className={!custom && cents === c ? "on" : ""} aria-pressed={!custom && cents === c} onClick={() => { setCustom(""); setCents(c); }}>
                <b>{R(c)}</b><span>{Math.round((1 - c / listed) * 100)}% off</span>
              </button>
            ))}
          </div>
          <label className="wz-label" htmlFor="mo-custom">Or your own offer</label>
          <div className="wz-price"><span>R</span><input id="mo-custom" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal" placeholder={String(Math.round(floor / 100))} aria-label="Your offer (rand)" /></div>
          {problem && <p className="small" style={{ color: "var(--red-text)", margin: "6px 0 0" }}>{problem}</p>}
          <p className="small muted mo-how"><Icon name="shield" size={13} /> The seller has 24 hours to accept, counter or decline. If they accept, you pay in the app as usual and your money is held safely.</p>
        </>
      )}
    </Sheet>
  );
}
