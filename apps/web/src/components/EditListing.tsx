import { useState } from "react";
import { MIN_PRICE, MAX_PRICE, sellerFee } from "@app/core";
import { api, type ProductPublic } from "../api";
import { useSession } from "../session";
import { ErrorNote, Field, R, Sheet, useAction } from "./ui";

/** A seller changes or takes down one of their own listings (name, details, price, stock, sizes). The video and the
 * type of sale stay as posted: to change those, post it again. Auctions can't be changed once they're posted. */
export function EditListing({ product: p, onClose, onDone }: { product: ProductPublic; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(p.title);
  const [description, setDescription] = useState(p.description ?? "");
  const [price, setPrice] = useState(String(p.priceCents / 100));
  const [stock, setStock] = useState(p.stock);
  const [sizes, setSizes] = useState(p.sizes.join(", "));
  const [removing, setRemoving] = useState(false);
  const { busy, error, run } = useAction();
  const { toast } = useSession();
  const cents = Math.round(Number(price.replace(",", ".")) * 100);
  const problem = title.trim().length < 4 ? "Give it a name of at least 4 letters."
    : !(cents >= MIN_PRICE) ? `The lowest price is ${R(MIN_PRICE)}.` : cents > MAX_PRICE ? `The highest price is ${R(MAX_PRICE)}.` : null;
  const sizeList = sizes.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12);

  if (p.mode === "auction") return (
    <Sheet title="Your auction" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Auctions can't be changed once they're posted, so every bidder sees the same thing. It ends by itself.</p>
    </Sheet>
  );
  if (removing) return (
    <Sheet title="Take this listing down?" onClose={() => setRemoving(false)}
      footer={<button className="btn danger block" disabled={busy} onClick={() => run(async () => { await api.takeDownListing(p.id); toast("Listing taken down"); onDone(); })}>Take it down</button>}>
      <p className="muted" style={{ marginTop: 0 }}>{p.title} comes off your shop and the feed. Orders already paid for still need to be sent. You can't undo this, but you can post it again.</p>
      <ErrorNote error={error} />
    </Sheet>
  );
  return (
    <Sheet title="Edit listing" onClose={onClose}
      footer={<button className="btn green block" disabled={busy || !!problem}
        onClick={() => run(async () => { await api.updateListing(p.id, { title, description, priceCents: cents, stock, sizes: sizeList }); toast("Listing updated"); onDone(); })}>
        {problem ?? "Save changes"}</button>}>
      <Field label="Name"><input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Price in rand" hint={cents >= MIN_PRICE ? `You get ${R(cents - sellerFee(cents))} after the 6% fee, or all of it while you're a founding seller.` : undefined}>
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ""))} />
      </Field>
      {p.mode === "buy_now" && (
        <Field label="In stock" hint={stock < 1 ? "Shows as sold out until you add stock." : undefined}>
          <div className="stepper" role="group" aria-label="In stock">
            <button type="button" onClick={() => setStock(Math.max(0, stock - 1))} aria-label="One less">−</button>
            <b aria-live="polite">{stock}</b>
            <button type="button" onClick={() => setStock(Math.min(999, stock + 1))} aria-label="One more">+</button>
          </div>
        </Field>
      )}
      {p.mode === "buy_now" && <Field label="Sizes" hint="Separate with commas, like S, M, L. Leave empty for one size."><input value={sizes} onChange={(e) => setSizes(e.target.value)} /></Field>}
      <Field label="Details"><textarea rows={3} maxLength={600} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <ErrorNote error={error} />
      <button className="link danger-link" style={{ marginTop: 6 }} onClick={() => setRemoving(true)}>Take this listing down</button>
    </Sheet>
  );
}
