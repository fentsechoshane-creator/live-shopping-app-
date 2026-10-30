import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { isRude, looksOffApp } from "@app/core";
import { api, type ProductCard } from "../../api";
import { ProductArt } from "../../components/Scene";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Loading, R, swatch, timeAgo, useAction, useGoBack } from "../../components/ui";
import { ReportSheet } from "../../components/Safety";

/** Opens (or starts) the chat with a shop. Signed out people go to sign in first. */
export function useMessageShop() {
  const { user, toast } = useSession();
  const nav = useNavigate();
  /** `productId` attaches that item to the chat, so the seller knows what you're asking about. */
  return async (shopId: string, productId?: string) => {
    if (!user) return nav("/signin");
    try {
      const id = await api.openConversation(shopId);
      nav(`/messages/${id}${productId ? `?about=${productId}` : ""}`);
    } catch (e: any) { toast(e?.message ?? "Couldn't open the chat."); }
  };
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

/** One chat between a buyer and a shop. Warns when someone asks to pay outside the app. */
export function Thread() {
  const { id = "" } = useParams();
  const [data, error, reload] = useLoad(() => api.thread(id), [id]);
  const [text, setText] = useState("");
  const [params, setParams] = useSearchParams();
  const about = params.get("about"); // the item from "Message seller", attached to the next message
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const { busy, error: sendError, run, setError } = useAction();
  const { toast, refreshBlocks } = useSession();
  const nav = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);
  const goBack = useGoBack("/activity?tab=messages");

  useEffect(() => { const t = window.setInterval(reload, 3000); return () => window.clearInterval(t); }, [reload]); // new messages
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length]);

  if (error) return <div className="screen"><button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button><ErrorNote error={error} /></div>;
  if (!data) return <div className="screen"><Loading /></div>;
  const c = data.conversation;
  const risky = data.messages.some((m) => !m.mine && looksOffApp(m.body));
  const send = () => {
    if (isRude(text)) return setError("Please keep it friendly. That message has words we don't allow.");
    run(async () => {
      await api.sendMessage(id, text, about);
      setText("");
      if (about) setParams({}, { replace: true });
      reload();
    });
  };

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
          <span style={{ minWidth: 0 }}><b style={{ display: "block" }}>{c.otherName}</b><span className="small muted">{c.iAmSeller ? "Buyer" : `@${c.shopHandle}`}</span></span>
        </Link>
        <button className="bare" onClick={() => setMenu(true)} aria-label="Chat options"><Icon name="more" size={20} strokeWidth={3} /></button>
      </div>

      <div className="chat-body">
        <div className="chat-tip"><Icon name="shield" size={14} />Keep payments in the app. Your money is only protected when you pay here.</div>
        {data.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.mine ? "mine" : ""}`}>
            {m.productId && <ChatProduct productId={m.productId} />}
            {m.body}
            <span className="when">{timeAgo(m.createdAt)}{m.mine && m.readAt ? " · Seen" : ""}</span>
          </div>
        ))}
        {risky && <div className="note amber" style={{ margin: "6px 0" }}>Careful: this looks like a request to pay or chat outside the app. If you pay outside, you lose buyer protection. You can report it.</div>}
        <div ref={endRef} />
      </div>

      <div className="chat-foot">
        <ErrorNote error={sendError} />
        {looksOffApp(text) && <div className="small" style={{ color: "var(--amber-text)", margin: "0 4px 6px" }}>Sharing numbers or bank details moves you outside buyer protection.</div>}
        {about && (
          <>
            <div className="attach">
              <span className="small muted">Asking about</span>
              <ChatProduct productId={about} compact />
              <button className="bare" onClick={() => setParams({}, { replace: true })} aria-label="Remove item"><Icon name="close" size={16} /></button>
            </div>
            {!text && (
              <div className="quick" role="group" aria-label="Quick questions">
                {(c.iAmSeller ? [] : ["Is this still available?", "What sizes do you have?", "Can I see more photos?", "When can you ship?"]).map((q) => (
                  <button key={q} type="button" onClick={() => setText(q)}>{q}</button>
                ))}
              </div>
            )}
          </>
        )}
        <form className="compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={about ? "Ask about this item" : "Message"} aria-label="Message" />
          <button className="send" disabled={!text.trim() || busy} aria-label="Send"><Icon name="send" size={18} /></button>
        </form>
      </div>

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
    </div>
  );
}

const cards = new Map<string, Promise<ProductCard | null>>();
/** The item a message is about: picture, title, price and a link to it. */
function ChatProduct({ productId, compact }: { productId: string; compact?: boolean }) {
  if (!cards.has(productId)) cards.set(productId, api.productCard(productId));
  const [p] = useLoad(() => cards.get(productId)!, [productId]);
  if (!p) return <span className={`chat-product ${compact ? "compact" : ""}`}><span className="cp-thumb" /><span className="small muted">Loading item…</span></span>;
  const sold = p.status !== "live" || (p.mode === "buy_now" && p.stock < 1);
  const thumb = p.video?.url
    ? (p.video.kind === "image" ? <img src={p.video.url} alt="" /> : <video src={`${p.video.url}#t=0.1`} muted playsInline preload="metadata" />)
    : <ProductArt productId={p.id} fallback={p.video?.demo?.bg ?? swatch(p.id)} />;
  return (
    <Link to={`/s/${p.shopHandle}?item=${p.id}`} className={`chat-product ${compact ? "compact" : ""}`} aria-label={`Item: ${p.title}, ${R(p.priceCents)}`}>
      <span className="cp-thumb art">{thumb}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="cp-title">{p.title}</span>
        <span className="cp-price">{R(p.priceCents)}{sold && <span className="cp-sold"> · Sold out</span>}</span>
      </span>
      {!compact && <span className="cp-view">View</span>}
    </Link>
  );
}
