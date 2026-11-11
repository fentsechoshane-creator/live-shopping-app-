import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isRude } from "@app/core";
import { api, type Friend, type FriendChat, type Person, type SharedPost } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { Avatar } from "../../components/People";
import { ReportSheet } from "../../components/Safety";
import { Blank, ErrorNote, Loading, R, timeAgo, useAction, useGoBack } from "../../components/ui";
import { CheckoutSheet } from "./Checkout";
import { askForNotifications } from "../../lib/push";
import type { FeedItem } from "../../api";

/** Follow, Follow back or Friends, for one person. */
function FollowButton({ person, iFollow, followsMe, onChange, small }: { person: Person; iFollow: boolean; followsMe: boolean; onChange: (on: boolean) => void; small?: boolean }) {
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    setBusy(true);
    try {
      await api.followPerson(person.id, !iFollow);
      if (!iFollow && followsMe) toast(`You and ${person.name} are friends now`);
      onChange(!iFollow);
    } catch (e: any) { toast(e?.message ?? "Couldn't do that. Try again."); } finally { setBusy(false); }
  };
  const label = iFollow ? (followsMe ? "Friends" : "Following") : followsMe ? "Follow back" : "Follow";
  return <button className={`btn ${iFollow ? "" : "green"} ${small ? "small" : ""}`} disabled={busy} onClick={flip} aria-pressed={iFollow}>{label}</button>;
}

/** The row of friends at the top of Messages, like TikTok: tap a face to chat. */
export function FriendsRow({ friends }: { friends: Friend[] }) {
  const nav = useNavigate();
  const { toast } = useSession();
  const open = async (f: Friend) => {
    try { nav(`/chats/${f.chatId ?? (await api.friendChatWith(f.id))}`); } catch (e: any) { toast(e?.message ?? "Couldn't open the chat."); }
  };
  return (
    <div className="friends-row" role="group" aria-label="Friends">
      <Link to="/friends" className="friend-face" aria-label="Find friends">
        <span className="ring add"><Icon name="addperson" size={22} /></span><span className="n">Find</span>
      </Link>
      {friends.map((f) => (
        <button key={f.id} className="friend-face" onClick={() => open(f)} aria-label={`Chat with ${f.name}`}>
          <span className="ring"><Avatar person={f} size={54} /></span><span className="n">{f.name.split(" ")[0]}</span>
        </button>
      ))}
    </div>
  );
}

/** One friend chat row in the Inbox list. */
export function FriendChatCell({ c }: { c: FriendChat }) {
  const last = c.lastShared ? (c.lastMine ? "You sent a post" : "Sent you a post") + (c.lastBody ? `: ${c.lastBody}` : "") : c.lastBody ? (c.lastMine ? `You: ${c.lastBody}` : c.lastBody) : "Say hi";
  return (
    <Link to={`/chats/${c.id}`} className="cell">
      <Avatar person={c.other} size={40} />
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t" style={{ display: "block" }}>{c.other.name}<span className="friend-tag">Friend</span></span>
        <span className="s" style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: c.unread ? 700 : 400 }}>{last}</span>
      </span>
      <span className="stack" style={{ alignItems: "flex-end", gap: 4 }}>
        <span className="small muted">{timeAgo(c.lastAt)}</span>
        {c.unread > 0 && <span className="count">{c.unread}</span>}
      </span>
    </Link>
  );
}

/** Find friends: people who follow you first, then search by name or username. */
export function FindFriends() {
  const goBack = useGoBack("/inbox?tab=messages");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; list: Awaited<ReturnType<typeof api.findPeople>> } | null>(null);
  const [backs, , reloadBacks] = useLoad(() => api.followBacks(), []);
  const [friends, , reloadFriends] = useLoad(() => api.friends(), []);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setFound(null); return; }
    const t = window.setTimeout(() => api.findPeople(term).then((list) => setFound({ q: term, list })).catch(() => setFound({ q: term, list: [] })), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const changed = () => { reloadBacks(); reloadFriends(); if (q.trim().length >= 2) api.findPeople(q.trim()).then((list) => setFound({ q: q.trim(), list })).catch(() => {}); };

  return (
    <div className="screen">
      <button className="back" onClick={goBack}><Icon name="back" size={20} />Back</button>
      <h1>Find friends</h1>
      <input className="setup-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names or usernames" aria-label="Search people" autoCapitalize="none" autoCorrect="off" />

      {found && (
        <>
          <h2 className="section-title">Results</h2>
          {found.list.length === 0 ? <Blank icon="search" title="No one found" line={`Nobody is called "${found.q}". Check the username and try again.`} /> : (
            <div className="group">
              {found.list.map((p) => (
                <div key={p.id} className="cell">
                  <Link to={`/u/${p.handle}`} className="row grow" style={{ gap: 10, minWidth: 0 }}>
                    <Avatar person={p} size={40} />
                    <span style={{ minWidth: 0 }}><span className="t" style={{ display: "block" }}>{p.name}</span><span className="s">@{p.handle}</span></span>
                  </Link>
                  <FollowButton person={p} iFollow={p.iFollow} followsMe={p.followsMe} onChange={changed} small />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {!found && backs && backs.length > 0 && (
        <>
          <h2 className="section-title">Follow back to be friends</h2>
          <div className="group">
            {backs.map((p) => (
              <div key={p.id} className="cell">
                <Link to={`/u/${p.handle}`} className="row grow" style={{ gap: 10, minWidth: 0 }}>
                  <Avatar person={p} size={40} />
                  <span style={{ minWidth: 0 }}><span className="t" style={{ display: "block" }}>{p.name}</span><span className="s">Follows you</span></span>
                </Link>
                <FollowButton person={p} iFollow={false} followsMe onChange={changed} small />
              </div>
            ))}
          </div>
        </>
      )}

      {!found && friends && friends.length > 0 && (
        <>
          <h2 className="section-title">Your friends</h2>
          <div className="group">
            {friends.map((f) => (
              <Link key={f.id} to={`/u/${f.handle}`} className="cell">
                <Avatar person={f} size={40} />
                <span className="grow"><span className="t" style={{ display: "block" }}>{f.name}</span><span className="s">@{f.handle}</span></span>
                <Icon name="chevron" size={16} />
              </Link>
            ))}
          </div>
        </>
      )}
      {!found && backs?.length === 0 && friends?.length === 0 && (
        <Blank icon="addperson" title="Find your people" line="Follow someone. When they follow you back, you're friends and can send each other posts." />
      )}
    </div>
  );
}

/** A person's page: picture, name, counts, Follow, and Message once you're friends. */
export function PersonPage() {
  const { handle = "" } = useParams();
  const [p, error, reload] = useLoad(() => api.person(handle), [handle]);
  const goBack = useGoBack("/friends");
  const nav = useNavigate();
  const { toast } = useSession();
  if (error) return <div className="screen"><button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button><ErrorNote error={error} /></div>;
  if (p === undefined) return <div className="screen"><Loading /></div>;
  if (!p) return <div className="screen"><button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button><div className="empty">This account isn't available.</div></div>;
  const friends = p.iFollow && p.followsMe;
  const message = async () => { try { nav(`/chats/${await api.friendChatWith(p.id)}`); } catch (e: any) { toast(e?.message ?? "Couldn't open the chat."); } };
  return (
    <div className="screen person">
      <button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button>
      <div className="person-head">
        <Avatar person={p} size={96} />
        <h1>{p.name}</h1>
        <span className="muted">@{p.handle}</span>
        <div className="person-counts">
          <span><b>{p.following}</b>Following</span>
          <span><b>{p.followers}</b>Followers</span>
        </div>
        {p.bio && <p className="person-bio">{p.bio}</p>}
        {!p.me && !p.blocked && (
          <div className="row" style={{ gap: 8, justifyContent: "center" }}>
            <FollowButton person={p} iFollow={p.iFollow} followsMe={p.followsMe} onChange={reload} />
            {friends && <button className="btn" onClick={message}><Icon name="chat" size={16} />Message</button>}
          </div>
        )}
        {!p.me && !friends && !p.blocked && <p className="small muted">{p.iFollow ? "When they follow you back, you'll be friends." : p.followsMe ? "They follow you. Follow back to be friends." : "Follow each other to send posts and messages."}</p>}
        {p.blocked && <p className="small muted">You can't interact with this account.</p>}
        {p.me && <Link to="/me" className="btn">Edit your profile</Link>}
      </div>
      {p.shop && (
        <Link to={`/s/${p.shop.handle}`} className="cell glass-card" style={{ marginTop: 18 }}>
          <span className="icon-btn"><Icon name="store" size={18} /></span>
          <span className="grow"><span className="t" style={{ display: "block" }}>{p.shop.name}</span><span className="s">Their shop on myHaul</span></span>
          <Icon name="chevron" size={16} />
        </Link>
      )}
    </div>
  );
}

/** A post sent in a friend chat: picture, title, price, and Buy. */
function SharedCard({ post, onBuy }: { post: SharedPost | null; onBuy: () => void }) {
  if (!post) return <div className="shared-card gone"><Icon name="bag" size={16} />This post isn't available any more.</div>;
  return (
    <div className="shared-card">
      <Link to={`/i/${post.productId}`} className="pic" aria-label={`Open ${post.title}`}>
        {post.thumb ? <img src={post.thumb} alt="" /> : <span className="ph"><Icon name="play" size={22} /></span>}
        {!post.available && <span className="sold">Sold</span>}
      </Link>
      <div className="meta">
        <b>{post.title}</b>
        <span className="small muted">@{post.shopHandle}</span>
        <div className="row between" style={{ marginTop: 6, gap: 8 }}>
          <span className="price">{R(post.priceCents)}</span>
          {post.available && post.mode === "buy_now" && <button className="btn green small" onClick={onBuy}>Buy now</button>}
          {post.available && post.mode !== "buy_now" && <Link to={`/i/${post.productId}`} className="btn small">View</Link>}
        </div>
      </div>
    </div>
  );
}

/** Chat with a friend: messages and posts you send each other. */
export function FriendThread() {
  const { id = "" } = useParams();
  const [data, error, reload] = useLoad(() => api.friendChat(id), [id]);
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [buying, setBuying] = useState<FeedItem | null>(null);
  const { busy, error: sendError, run, setError } = useAction();
  const { toast, refreshBlocks } = useSession();
  const nav = useNavigate();
  const endRef = useRef<HTMLDivElement>(null);
  const goBack = useGoBack("/inbox?tab=messages");

  useEffect(() => api.watchFriendChat(id, reload), [id, reload]); // new messages arrive straight away
  const unread = data?.messages.filter((m) => !m.mine && !m.readAt).length ?? 0;
  useEffect(() => { if (unread) api.readFriendChat(id).then(() => window.dispatchEvent(new Event("inbox-read"))).catch(() => {}); }, [id, unread]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [data?.messages.length]);

  if (error) return <div className="screen"><button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button><ErrorNote error={error} /></div>;
  if (!data) return <div className="screen"><Loading /></div>;
  const o = data.other;
  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (isRude(body)) return setError("Please keep it friendly. That message has words we don't allow.");
    run(async () => { await api.sendToFriend(o.id, body); askForNotifications(); setText(""); reload(); });
  };
  const buy = async (productId: string) => {
    const item = await api.productItem(productId);
    if (!item || item.product.status !== "live") return toast("This item isn't available any more.");
    setBuying(item);
  };
  if (reporting) return <div className="screen"><ReportSheet kind="user" targetId={o.id} what={`@${o.handle}`} onClose={() => setReporting(false)} /></div>;

  return (
    <div className="chat">
      <div className="chat-top">
        <button className="bare" onClick={goBack} aria-label="Back"><Icon name="back" /></button>
        <Link to={`/u/${o.handle}`} className="row grow" style={{ gap: 10, minWidth: 0 }}>
          <Avatar person={o} size={36} />
          <span style={{ minWidth: 0 }}><b style={{ display: "block" }}>{o.name}</b><span className="small muted">@{o.handle}</span></span>
        </Link>
        <button className="bare" onClick={() => setMenu(true)} aria-label="Chat options"><Icon name="more" size={20} strokeWidth={3} /></button>
      </div>

      <div className="chat-body">
        {data.messages.length === 0 && (
          <div className="chat-hello">
            <Avatar person={o} size={72} />
            <b>You and {o.name} are friends</b>
            <span className="small muted">Send them a message, or tap Share on any post to send it here.</span>
          </div>
        )}
        {data.messages.map((m) => (
          <div key={m.id} className={`bubble ${m.mine ? "mine" : ""} ${m.shared ? "has-post" : ""}`}>
            {m.shared && <SharedCard post={m.post} onBuy={() => m.post && buy(m.post.productId)} />}
            {m.body}
            <span className="when">{timeAgo(m.createdAt)}{m.mine && m.readAt ? " · Seen" : ""}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="chat-foot">
        <ErrorNote error={sendError} />
        {data.friends ? (
          <form className="compose glassy" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Message" aria-label="Message" style={{ paddingLeft: 14 }} />
            <button className="send" disabled={!text.trim() || busy} aria-label="Send"><Icon name="send" size={18} /></button>
          </form>
        ) : (
          <div className="note small" style={{ textAlign: "center" }}>You're not friends any more, so you can't send messages here. Follow each other again to chat.</div>
        )}
      </div>

      {menu && (
        <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && setMenu(false)}>
          <div className="mini-menu" role="menu" style={{ position: "absolute", left: 12, right: 12, bottom: 12 }}>
            <button role="menuitem" onClick={() => { setMenu(false); nav(`/u/${o.handle}`); }}><Icon name="user" size={16} />View profile</button>
            <button role="menuitem" onClick={() => { setMenu(false); setReporting(true); }}><Icon name="flag" size={16} />Report</button>
            <button role="menuitem" style={{ color: "var(--red-text)" }} onClick={() => run(async () => {
              await api.block({ userId: o.id }); refreshBlocks(); toast(`Blocked @${o.handle}`); nav("/inbox?tab=messages");
            })}><Icon name="block" size={16} />Block @{o.handle}</button>
            <button role="menuitem" onClick={() => setMenu(false)}>Cancel</button>
          </div>
        </div>
      )}
      {buying && <CheckoutSheet item={buying} onClose={() => setBuying(null)} />}
    </div>
  );
}
