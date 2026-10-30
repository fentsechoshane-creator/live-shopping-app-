import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isRude, looksOffApp } from "@app/core";
import { api } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { ErrorNote, Loading, timeAgo, useAction } from "../../components/ui";
import { ReportSheet } from "../../components/Safety";

/** Opens (or starts) the chat with a shop. Signed out people go to sign in first. */
export function useMessageShop() {
  const { user, toast } = useSession();
  const nav = useNavigate();
  return async (shopId: string) => {
    if (!user) return nav("/signin");
    try { nav(`/messages/${await api.openConversation(shopId)}`); } catch (e: any) { toast(e?.message ?? "Couldn't open the chat."); }
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
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const { busy, error: sendError, run, setError } = useAction();
  const { toast, refreshBlocks } = useSession();
  const nav = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const t = window.setInterval(reload, 3000); return () => window.clearInterval(t); }, [reload]); // new messages
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length]);

  if (error) return <div className="screen"><button className="bare" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button><ErrorNote error={error} /></div>;
  if (!data) return <div className="screen"><Loading /></div>;
  const c = data.conversation;
  const risky = data.messages.some((m) => !m.mine && looksOffApp(m.body));
  const send = () => {
    if (isRude(text)) return setError("Please keep it friendly. That message has words we don't allow.");
    run(async () => { await api.sendMessage(id, text); setText(""); reload(); });
  };

  if (reporting) {
    const last = [...data.messages].reverse().find((m) => !m.mine);
    return <div className="screen"><ReportSheet kind={last ? "message" : "shop"} targetId={last?.id ?? c.shopId} what={last ? "this chat" : `@${c.shopHandle}`} onClose={() => setReporting(false)} /></div>;
  }

  return (
    <div className="chat">
      <div className="chat-top">
        <button className="bare" onClick={() => nav(-1)} aria-label="Back"><Icon name="back" /></button>
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
        <form className="compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Message" aria-label="Message" />
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
