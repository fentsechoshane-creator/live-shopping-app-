import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { isRude, looksOffApp, ORDER_STATUS_TEXT } from "@app/core";
import { api, type FeedItem, type MyShop, type Offer, type Order } from "../../api";
import { ProductArt } from "../../components/Scene";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Loading, R, Sheet, swatch, timeAgo, useAction, useGoBack } from "../../components/ui";
import { CheckoutSheet } from "./Checkout";
import { ReportSheet } from "../../components/Safety";
import { askForNotifications } from "../../lib/push";

/** Opens (or starts) the chat with a shop. Signed out people go to sign in first. */
export function useMessageShop() {
  const { toast, withUser } = useSession();
  const nav = useNavigate();
  /** `productId` attaches that item to the chat, so the seller knows what you're asking about. */
  return (shopId: string, productId?: string) => withUser(async () => {
    try {
      const id = await api.openConversation(shopId);
      nav(`/messages/${id}${productId ? `?about=${productId}` : ""}`);
    } catch (e: any) { toast(e?.message ?? "Couldn't open the chat."); }
  }, "Sign in to message the seller");
}

/** List of chats, used in Activity > Messages. */
export function ConversationList() {
  const [list, error] = useLoad(() => api.conversations(), []);
  if (error) return <ErrorNote error={error} />;
  if (!list) return <Loading />;
  if (list.length === 0) return <div className="empty-card"><span className="muted">No messages yet. Tap Message on a shop or item to ask a question.</span></div>;
  return (
    <div className="group">
      {list.map((c) => (
        <Link key={c.id} to={`/messages/${c.id}`} className="cell">
          <span className="avatar">{c.otherName[0]?.toUpperCase()}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t" style={{ display: "block" }}>{c.otherName}{c.iAmSeller && <span className="seller-tag" style={{ marginLeft: 6 }}>Your shop</span>}</span>
            <span className="s" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: c.unread ? 700 : 400 }}>{c.lastBody ?? "Say hi"}</span>
          </span>
          <span className="stack" style={{ alignItems: "flex-end", gap: 4 }}>
            <span className="small muted">{timeAgo(c.lastAt)}</span>
            {c.unread > 0 && <span className="count">{c.unread}</span>}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** "Usually replies within 30 minutes". */
export function replyText(min: number | null | undefined) {
  if (min == null) return null;
  if (min < 15) return "Usually replies within minutes";
  if (min < 60) return `Usually replies within ${Math.max(15, Math.round(min / 15) * 15)} minutes`;
  if (min < 24 * 60) return `Usually replies within ${Math.round(min / 60)} ${Math.round(min / 60) === 1 ? "hour" : "hours"}`;
  return "Usually replies within a day";
}

const DEFAULT_REPLIES = ["Yes, it's available.", "Ships within 2 days, PUDO or courier.", "Free collection in Cape Town is available.", "I'll send more photos now."];
const loadReplies = (shopId: string): string[] => { try { return JSON.parse(localStorage.getItem(`lsa-replies:${shopId}`) ?? "null") ?? DEFAULT_REPLIES; } catch { return DEFAULT_REPLIES; } };
const saveReplies = (shopId: string, r: string[]) => { try { localStorage.setItem(`lsa-replies:${shopId}`, JSON.stringify(r)); } catch { /* ignore */ } };

type Line = { kind: "msg"; at: string; m: import("../../api").Message } | { kind: "order"; at: string; o: Order };

/** One chat between a buyer and a shop: item cards with Buy now, special prices, holds, photos and order updates. */
export function Thread() {
  const { id = "" } = useParams();
  const [data, error, reload] = useLoad(() => api.thread(id), [id]);
  const [text, setText] = useState("");
  const [params, setParams] = useSearchParams();
  const about = params.get("about"); // the item from "Message seller", attached to the next message
  const [menu, setMenu] = useState(false);
  const [plus, setPlus] = useState(false);
  const [sheet, setSheet] = useState<null | "offer" | "hold" | "replies">(null);
  const [buying, setBuying] = useState<{ item: FeedItem; offer?: Offer } | null>(null);
  const [reporting, setReporting] = useState(false);
  const { busy, error: sendError, run, setError } = useAction();
  const { toast, refreshBlocks } = useSession();
  const nav = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const goBack = useGoBack("/activity?tab=messages");
  const c = data?.conversation;
  const [orders] = useLoad(async () => {
    if (!c) return [] as Order[];
    const all = c.iAmSeller ? await api.sellerOrders() : await api.myOrders();
    return all.filter((o) => o.shop.id === c.shopId && o.buyerId === c.buyerId && o.status !== "pending_payment");
  }, [c?.id, data?.messages.length]);
  const [replyMin] = useLoad(() => (c && !c.iAmSeller ? api.shopReplyMinutes(c.shopId) : Promise.resolve(null)), [c?.shopId]);
  const [shop] = useLoad(() => (c?.iAmSeller ? api.myShop() : Promise.resolve(null)), [c?.iAmSeller]);
  const [replies, setReplies] = useState<string[]>([]);
  useEffect(() => { if (c?.iAmSeller) setReplies(loadReplies(c.shopId)); }, [c?.iAmSeller, c?.shopId]);

  useEffect(() => { const t = window.setInterval(reload, 3000); return () => window.clearInterval(t); }, [reload]); // new messages
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length, data?.typing]);

  if (error) return <div className="screen"><button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button><ErrorNote error={error} /></div>;
  if (!data || !c) return <div className="screen"><Loading /></div>;
  const risky = data.messages.some((m) => !m.mine && looksOffApp(m.body));
  const lastProduct = [...data.messages].reverse().find((m) => m.productId)?.productId ?? null;
  const send = (body = text, image: File | null = null) => {
    if (body && isRude(body)) return setError("Please keep it friendly. That message has words we don't allow.");
    run(async () => {
      await api.sendMessage(id, body, about, image);
      askForNotifications(); // so you hear back when they reply
      setText("");
      if (about) setParams({}, { replace: true });
      reload();
    });
  };
  const buy = async (productId: string, offer?: Offer) => {
    const item = await api.productItem(productId);
    if (!item) return toast("This item is gone.");
    setBuying({ item, offer });
  };
  const lines: Line[] = [
    ...data.messages.map((m) => ({ kind: "msg" as const, at: m.createdAt, m })),
    ...(orders ?? []).map((o) => ({ kind: "order" as const, at: o.paidAt ?? o.createdAt, o })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (reporting) {
    const last = [...data.messages].reverse().find((m) => !m.mine);
    return <div className="screen"><ReportSheet kind={last ? "message" : "shop"} targetId={last?.id ?? c.shopId} what={last ? "this chat" : `@${c.shopHandle}`} onClose={() => setReporting(false)} /></div>;
  }

  return (
    <div className="chat">
      <div className="chat-top">
        <button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button>
        <Link to={`/s/${c.shopHandle}`} className="row grow" style={{ gap: 10, minWidth: 0 }}>
          <span className="avatar">{c.otherName[0]?.toUpperCase()}</span>
          <span style={{ minWidth: 0 }}>
            <b style={{ display: "block" }}>{c.otherName}</b>
            <span className="small muted">{data.typing ? "typing…" : c.iAmSeller ? "Buyer" : replyText(replyMin) ?? `@${c.shopHandle}`}</span>
          </span>
        </Link>
        <button className="bare" onClick={() => setMenu(true)} aria-label="Chat options"><Icon name="more" size={20} strokeWidth={3} /></button>
      </div>

      <div className="chat-body">
        <div className="chat-tip"><Icon name="shield" size={14} />Keep payments in the app. Your money is only protected when you pay here.</div>
        {lines.map((l) => l.kind === "order" ? (
          <Link key={`o-${l.o.id}`} to={c.iAmSeller ? `/sell/orders/${l.o.id}` : `/orders/${l.o.id}`} className="order-event">
            <Icon name="bag" size={16} />
            <span className="grow"><b>{l.o.product.title}</b> · {R(l.o.totals.total)}<span className="small muted" style={{ display: "block" }}>{ORDER_STATUS_TEXT[l.o.status][c.iAmSeller ? "seller" : "buyer"]}</span></span>
            <Icon name="chevron" size={16} />
          </Link>
        ) : (
          <div key={l.m.id} className={`bubble ${l.m.mine ? "mine" : ""} ${l.m.offer ? "has-offer" : ""}`}>
            {l.m.productId && <ChatProduct productId={l.m.productId} canBuy={!c.iAmSeller} onBuy={() => buy(l.m.productId!)} />}
            {l.m.offer && <OfferCard offer={l.m.offer} buyer={!c.iAmSeller} onBuy={() => buy(l.m.offer!.productIds[0], l.m.offer!)} />}
            {l.m.imageUrl && <img className="chat-photo" src={l.m.imageUrl} alt="Photo" />}
            {l.m.body}
            <span className="when">{timeAgo(l.m.createdAt)}{l.m.mine && l.m.readAt ? " · Seen" : ""}</span>
          </div>
        ))}
        {data.typing && <div className="bubble typing" aria-label="Typing"><span /><span /><span /></div>}
        {risky && <div className="note amber" style={{ margin: "6px 0" }}>Careful: this looks like a request to pay or chat outside the app. If you pay outside, you lose buyer protection. You can report it.</div>}
        <div ref={endRef} />
      </div>

      <div className="chat-foot">
        <ErrorNote error={sendError} />
        {looksOffApp(text) && <div className="small" style={{ color: "var(--amber-text)", margin: "0 4px 6px" }}>Sharing numbers or bank details moves you outside buyer protection.</div>}
        {about && (
          <div className="attach">
            <span className="small muted">Asking about</span>
            <ChatProduct productId={about} compact />
            <button className="bare" onClick={() => setParams({}, { replace: true })} aria-label="Remove item"><Icon name="close" size={16} /></button>
          </div>
        )}
        {!text && (
          <div className="quick" role="group" aria-label={c.iAmSeller ? "Saved replies" : "Quick questions"}>
            {(c.iAmSeller ? replies : about ? ["Is this still available?", "What sizes do you have?", "Can I see more photos?", "When can you ship?"] : []).map((q) => (
              <button key={q} type="button" onClick={() => (c.iAmSeller ? send(q) : setText(q))}>{q}</button>
            ))}
            {c.iAmSeller && <button type="button" className="edit" onClick={() => setSheet("replies")}>Edit</button>}
          </div>
        )}
        <form className="compose glassy" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(); }}>
          <button type="button" className="plus" onClick={() => setPlus(true)} aria-label="Add"><Icon name="plus" size={20} strokeWidth={2.4} /></button>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={about ? "Ask about this item" : "Message"} aria-label="Message" />
          <button className="send" disabled={!text.trim() || busy} aria-label="Send"><Icon name="send" size={18} /></button>
        </form>
        <input ref={photoRef} type="file" accept="image/*" hidden aria-label="Send a photo" onChange={(e) => { const f = e.target.files?.[0]; if (f) send("", f); e.target.value = ""; }} />
      </div>

      {plus && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setPlus(false)}>
          <div className="mini-menu" role="menu" style={{ position: "absolute", left: 12, right: 12, bottom: 12 }}>
            <button role="menuitem" onClick={() => { setPlus(false); photoRef.current?.click(); }}><Icon name="grid" size={16} />Send a photo</button>
            {c.iAmSeller && <button role="menuitem" onClick={() => { setPlus(false); setSheet("offer"); }}><Icon name="payout" size={16} />Send a special price</button>}
            {c.iAmSeller && <button role="menuitem" onClick={() => { setPlus(false); setSheet("hold"); }}><Icon name="lock" size={16} />Hold an item for them</button>}
            {c.iAmSeller && <button role="menuitem" onClick={() => { setPlus(false); setSheet("replies"); }}><Icon name="chat" size={16} />Saved replies</button>}
            <button role="menuitem" onClick={() => setPlus(false)}>Cancel</button>
          </div>
        </div>
      )}
      {menu && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="mini-menu" role="menu" style={{ position: "absolute", left: 12, right: 12, bottom: 12 }}>
            <button role="menuitem" onClick={() => { setMenu(false); setReporting(true); }}><Icon name="flag" size={16} />Report</button>
            {!c.iAmSeller && (
              <button role="menuitem" style={{ color: "var(--red-text)" }} onClick={() => run(async () => {
                await api.block({ shopId: c.shopId }); refreshBlocks(); toast(`Blocked @${c.shopHandle}`); nav("/activity?tab=messages");
              })}><Icon name="block" size={16} />Block @{c.shopHandle}</button>
            )}
            <button role="menuitem" onClick={() => setMenu(false)}>Cancel</button>
          </div>
        </div>
      )}
      {sheet === "offer" && shop && <OfferSheet shop={shop} conversationId={id} preselect={lastProduct} onClose={() => setSheet(null)} onSent={() => { setSheet(null); reload(); toast("Special price sent"); }} />}
      {sheet === "hold" && shop && <HoldSheet shop={shop} buyerId={c.buyerId} preselect={lastProduct} onClose={() => setSheet(null)}
        onDone={(msg) => { setSheet(null); toast(msg); send(msg.startsWith("Holding") ? `I'm holding this for you: ${msg.replace("Holding ", "")}` : "I've released the hold."); }} />}
      {sheet === "replies" && c.iAmSeller && <RepliesSheet replies={replies} onClose={() => setSheet(null)} onSave={(r) => { setReplies(r); saveReplies(c.shopId, r); setSheet(null); }} />}
      {buying && <CheckoutSheet item={buying.item} offer={buying.offer} onClose={() => setBuying(null)} />}
    </div>
  );
}

const cards = new Map<string, Promise<FeedItem | null>>();
/** The item a message is about: picture, title, price, Buy now (for the buyer) and a link to it. */
function ChatProduct({ productId, compact, canBuy, onBuy }: { productId: string; compact?: boolean; canBuy?: boolean; onBuy?: () => void }) {
  if (!cards.has(productId)) cards.set(productId, api.productItem(productId));
  const [it] = useLoad(() => cards.get(productId)!, [productId]);
  if (!it) return <span className={`chat-product ${compact ? "compact" : ""}`}><span className="cp-thumb" /><span className="small muted">Loading item…</span></span>;
  const p = it.product;
  const sold = p.status !== "live" || (p.mode === "buy_now" && p.stock < 1);
  const held = !!p.heldUntil && new Date(p.heldUntil) > new Date();
  const thumb = it.video?.url
    ? (it.video.kind === "image" ? <img src={it.video.url} alt="" /> : <video src={`${it.video.url}#t=0.1`} muted playsInline preload="metadata" />)
    : <ProductArt productId={p.id} fallback={it.video?.demo?.bg ?? swatch(p.id)} />;
  return (
    <span className={`chat-product ${compact ? "compact" : ""}`}>
      <Link to={`/s/${it.shop.handle}?item=${p.id}`} className="row grow" style={{ gap: 10, minWidth: 0 }} aria-label={`Item: ${p.title}, ${R(p.priceCents)}`}>
        <span className="cp-thumb art">{thumb}</span>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="cp-title">{p.title}</span>
          <span className="cp-price">{R(p.priceCents)}{sold ? <span className="cp-sold"> · Sold out</span> : held ? <span className="cp-held"> · On hold</span> : null}</span>
        </span>
      </Link>
      {!compact && canBuy && !sold && <button className="cp-buy" onClick={onBuy}>Buy now</button>}
    </span>
  );
}

/** A special price from the seller, for one item or a bundle. */
function OfferCard({ offer, buyer, onBuy }: { offer: Offer; buyer: boolean; onBuy: () => void }) {
  const ended = offer.status !== "open" || new Date(offer.expiresAt) < new Date();
  const hours = Math.max(0, Math.round((new Date(offer.expiresAt).getTime() - Date.now()) / 3600e3));
  const bundle = offer.productIds.length > 1;
  return (
    <span className="offer-card">
      <span className="offer-tag">{bundle ? `Bundle of ${offer.productIds.length}` : "Special price"}</span>
      <span className="offer-price">
        {offer.listedCents > offer.priceCents && <s>{R(offer.listedCents)}</s>}
        <b>{R(offer.priceCents)}</b>
      </span>
      <span className="small" style={{ opacity: 0.75 }}>{offer.status === "used" ? "Bought" : ended ? "This offer has ended" : `Ends in ${hours < 1 ? "under an hour" : `${hours} ${hours === 1 ? "hour" : "hours"}`}`}</span>
      {buyer && !ended && <button className="btn green block" onClick={onBuy}>Buy for {R(offer.priceCents)}</button>}
    </span>
  );
}

function OfferSheet({ shop, conversationId, preselect, onClose, onSent }: { shop: MyShop; conversationId: string; preselect: string | null; onClose: () => void; onSent: () => void }) {
  const live = shop.products.filter((p) => p.status === "live");
  const [picked, setPicked] = useState<string[]>(preselect && live.some((p) => p.id === preselect) ? [preselect] : live[0] ? [live[0].id] : []);
  const listed = live.filter((p) => picked.includes(p.id)).reduce((n, p) => n + p.priceCents, 0);
  const [price, setPrice] = useState("");
  const [hours, setHours] = useState(24);
  const { busy, error, run } = useAction();
  const cents = Math.round((Number(price) || 0) * 100);
  return (
    <Sheet title="Send a special price" onClose={onClose}
      footer={<button className="btn green block big" disabled={busy || !picked.length || cents < 1000 || cents > listed}
        onClick={() => run(async () => { await api.makeOffer(conversationId, picked, cents, hours); onSent(); })}>Send {cents ? R(cents) : "offer"}</button>}>
      <ErrorNote error={error} />
      <p className="small muted" style={{ marginTop: 0 }}>Pick one item, or several for a bundle with one delivery fee. The buyer pays in the app, so the money is still protected.</p>
      <div className="group">
        {live.map((p) => (
          <button key={p.id} className="cell" onClick={() => setPicked((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))} aria-pressed={picked.includes(p.id)}>
            <span className={`tick-box ${picked.includes(p.id) ? "on" : ""}`}>{picked.includes(p.id) && <Icon name="check" size={13} strokeWidth={3} />}</span>
            <span className="grow t">{p.title}</span><span className="small muted">{R(p.priceCents)}</span>
          </button>
        ))}
      </div>
      <label className="wz-label" htmlFor="offer-price">Your price {picked.length > 1 ? `for all ${picked.length}` : ""} <span className="muted">(listed {R(listed)})</span></label>
      <div className="wz-price"><span>R</span><input id="offer-price" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder={String(Math.round(listed * 0.9 / 100))} aria-label="Offer price (rand)" /></div>
      {cents > listed && <div className="small" style={{ color: "var(--red-text)", marginTop: 6 }}>It can't be more than the listed price.</div>}
      <div className="wz-label">Offer lasts</div>
      <div className="seg" role="group" aria-label="Offer lasts">
        {[6, 24, 48].map((h) => <button key={h} aria-pressed={hours === h} onClick={() => setHours(h)}>{h} hours</button>)}
      </div>
    </Sheet>
  );
}

function HoldSheet({ shop, buyerId, preselect, onClose, onDone }: { shop: MyShop; buyerId: string; preselect: string | null; onClose: () => void; onDone: (msg: string) => void }) {
  const live = shop.products.filter((p) => p.status === "live");
  const [pick, setPick] = useState(preselect && live.some((p) => p.id === preselect) ? preselect : live[0]?.id ?? "");
  const [hours, setHours] = useState(6);
  const { busy, error, run } = useAction();
  const item = live.find((p) => p.id === pick);
  return (
    <Sheet title="Hold an item" onClose={onClose}
      footer={<div className="stack" style={{ gap: 8 }}>
        <button className="btn green block big" disabled={busy || !item} onClick={() => run(async () => { await api.holdProduct(pick, buyerId, hours); onDone(`Holding ${item!.title} for ${hours} hours`); })}>Hold for {hours} hours</button>
        <button className="btn block" disabled={busy || !item} onClick={() => run(async () => { await api.holdProduct(pick, buyerId, 0); onDone("Released the hold"); })}>Release a hold</button>
      </div>}>
      <ErrorNote error={error} />
      <p className="small muted" style={{ marginTop: 0 }}>Only this buyer can buy it while it's held. Others see "On hold".</p>
      <div className="group">
        {live.map((p) => (
          <button key={p.id} className="cell" onClick={() => setPick(p.id)} aria-pressed={pick === p.id}>
            <span className={`tick-box round ${pick === p.id ? "on" : ""}`}>{pick === p.id && <Icon name="check" size={13} strokeWidth={3} />}</span>
            <span className="grow t">{p.title}</span><span className="small muted">{R(p.priceCents)}</span>
          </button>
        ))}
      </div>
      <div className="wz-label">How long</div>
      <div className="seg" role="group" aria-label="How long">
        {[2, 6, 24].map((h) => <button key={h} aria-pressed={hours === h} onClick={() => setHours(h)}>{h} hours</button>)}
      </div>
    </Sheet>
  );
}

function RepliesSheet({ replies, onClose, onSave }: { replies: string[]; onClose: () => void; onSave: (r: string[]) => void }) {
  const [list, setList] = useState(replies);
  const [draft, setDraft] = useState("");
  return (
    <Sheet title="Saved replies" onClose={onClose} footer={<button className="btn green block big" onClick={() => onSave(list)}>Save</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>One tap sends them in any chat. Saved on this phone.</p>
      <div className="group">
        {list.map((r, i) => (
          <div key={i} className="cell"><span className="grow t" style={{ fontWeight: 500 }}>{r}</span>
            <button className="bare" onClick={() => setList(list.filter((_, j) => j !== i))} aria-label={`Remove: ${r}`}><Icon name="trash" size={16} /></button></div>
        ))}
      </div>
      <form className="compose" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { setList([...list, draft.trim()]); setDraft(""); } }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={200} placeholder="Add a reply" aria-label="Add a reply" />
        <button className="send" disabled={!draft.trim()} aria-label="Add reply"><Icon name="plus" size={18} /></button>
      </form>
    </Sheet>
  );
}
