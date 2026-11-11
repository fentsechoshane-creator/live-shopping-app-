import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Conversation, FriendChat } from "../api";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Blank, timeAgo } from "./ui";

/** One row in the messages list, friend or shop, shaped the same. */
interface Row { key: string; to: string; name: string; photo: string | null; preview: string; at: string; unread: number; tag: string | null; shop: boolean }

/**
 * Messages like a social app (asked by Ofentse 7 Nov 2026): friends and shops in one list, newest first, each with a
 * round picture, "You:" when the last message was yours, and a dot when there's something unread.
 */
export function DmList({ friends, shops }: { friends: FriendChat[]; shops: Conversation[] }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const rows = useMemo<Row[]>(() => {
    const f: Row[] = friends.map((c) => ({
      key: `f${c.id}`, to: `/chats/${c.id}`, name: c.other.name, photo: c.other.avatarUrl, at: c.lastAt, unread: c.unread, tag: null, shop: false,
      preview: c.lastShared ? (c.lastMine ? "You sent a post" : "Sent you a post") + (c.lastBody ? `: ${c.lastBody}` : "")
        : c.lastBody ? (c.lastMine ? `You: ${c.lastBody}` : c.lastBody) : "Say hi",
    }));
    const s: Row[] = shops.map((c) => ({
      key: `s${c.id}`, to: `/messages/${c.id}`, name: c.otherName, photo: c.otherAvatarUrl ?? null, at: c.lastAt, unread: c.unread,
      tag: c.iAmSeller ? "Your shop" : "Shop", shop: !c.iAmSeller,
      preview: c.lastBody ? (c.lastMine ? `You: ${c.lastBody}` : c.lastBody) : c.iAmSeller ? "A buyer started a chat" : "Ask the shop anything",
    }));
    const all = [...f, ...s].sort((a, b) => b.at.localeCompare(a.at));
    const term = q.trim().toLowerCase();
    return term ? all.filter((r) => r.name.toLowerCase().includes(term) || r.preview.toLowerCase().includes(term)) : all;
  }, [friends, shops, q]);

  return (
    <>
      {friends.length + shops.length > 5 && (
        <label className="dm-search">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages" aria-label="Search messages" />
        </label>
      )}
      {rows.length === 0 && (q
        ? <Blank icon="search" title="No chats found" line={`Nothing matches "${q}".`} />
        : <Blank icon="chat" title="No messages yet" line="Message a shop from any item, or follow friends to send them posts." action="Find friends" onAction={() => navigate("/friends")} />)}
      <nav className="dm-list" aria-label="Messages">
        {rows.map((r) => (
          <Link key={r.key} to={r.to} className={`dm-row ${r.unread ? "unread" : ""}`}
            aria-label={`${r.name}${r.tag ? `, ${r.tag.toLowerCase()}` : ""}. ${r.preview}${r.unread ? `. ${r.unread} unread` : ""}`}>
            <span className="dm-pic">
              <Avatar url={r.photo} name={r.name} size={54} />
              {r.shop && <span className="dm-badge" aria-hidden="true"><Icon name="store" size={11} /></span>}
            </span>
            <span className="dm-text">
              <span className="dm-name">{r.name}{r.tag && <span className="dm-tag">{r.tag}</span>}</span>
              <span className="dm-preview"><span className="p">{r.preview}</span><span className="t">{timeAgo(r.at)}</span></span>
            </span>
            {r.unread > 0 && <span className="dm-dot" aria-hidden="true" />}
          </Link>
        ))}
      </nav>
    </>
  );
}
