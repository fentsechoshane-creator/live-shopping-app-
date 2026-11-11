import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Friend } from "../api";
import { useLoad, useSession } from "../session";
import { PUBLIC_URL, shareLink, tap } from "../native";
import { Icon } from "./Icon";
import { Avatar } from "./People";
import { R, Sheet } from "./ui";

/**
 * Share, like TikTok: your friends first (tap one or more, add a note, Send), then other apps.
 * Friends are people you follow who follow you back. The post lands in your chat with each of them as a card.
 */
export function ShareSheet({ postId, productId, title, priceCents, onClose }: { postId: string; productId: string; title: string; priceCents: number; onClose: () => void }) {
  const { user, toast } = useSession();
  const [friends] = useLoad(() => (user ? api.friends() : Promise.resolve([] as Friend[])), [user?.id]);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `${PUBLIC_URL}/i/${productId}`;
  const text = `${title}, ${R(priceCents)} on myHaul`;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (friends ?? []).filter((f) => !q || f.name.toLowerCase().includes(q) || f.handle.includes(q));
  }, [friends, query]);

  const toggle = (id: string) => { tap(); setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 20 ? cur : [...cur, id])); };
  const send = async () => {
    setBusy(true);
    try {
      const n = await api.sharePost(postId, picked, note);
      toast(n === 1 ? `Sent to ${friends?.find((f) => f.id === picked[0])?.name ?? "your friend"}` : `Sent to ${n} friends`);
      onClose();
    } catch (e: any) { toast(e?.message ?? "Couldn't send. Try again."); } finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast("Couldn't copy the link"); }
  };
  const whatsapp = () => window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank", "noopener");
  const more = async () => { if (!(await shareLink(url, text))) copy(); };

  return (
    <Sheet title="Send to" onClose={onClose}
      footer={picked.length > 0 ? (
        <div className="share-send">
          <input className="setup-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Add a message" aria-label="Add a message" />
          <button className="btn green big" onClick={send} disabled={busy}>{busy ? "Sending…" : picked.length > 1 ? `Send to ${picked.length}` : "Send"}</button>
        </div>
      ) : undefined}>
      {user && (friends?.length ?? 0) > 6 && (
        <input className="setup-input share-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search friends" aria-label="Search friends" />
      )}
      {user && friends && friends.length === 0 && (
        <div className="share-empty">
          <span className="grow"><b>Send posts to friends</b><small>Follow people. When they follow you back, they show here.</small></span>
          <Link to="/friends" className="btn" onClick={onClose}>Find friends</Link>
        </div>
      )}
      {user && shown.length > 0 && (
        <div className="share-friends" role="group" aria-label="Friends">
          {shown.map((f) => {
            const on = picked.includes(f.id);
            return (
              <button key={f.id} className={`share-friend ${on ? "on" : ""}`} onClick={() => toggle(f.id)} aria-pressed={on} aria-label={f.name}>
                <span className="ring"><Avatar person={f} size={56} />{on && <span className="tick"><Icon name="check" size={14} strokeWidth={3} /></span>}</span>
                <span className="n">{f.name}</span>
              </button>
            );
          })}
          <Link to="/friends" className="share-friend" onClick={onClose} aria-label="Find friends">
            <span className="ring add"><Icon name="addperson" size={24} /></span>
            <span className="n">Find</span>
          </Link>
        </div>
      )}
      <div className="share-apps" role="group" aria-label="Share to">
        <button onClick={whatsapp}><span className="app wa"><Icon name="whatsapp" size={26} /></span>WhatsApp</button>
        <button onClick={copy}><span className="app"><Icon name="link" size={24} /></span>Copy link</button>
        <button onClick={more}><span className="app"><Icon name="share" size={24} /></span>More</button>
      </div>
    </Sheet>
  );
}
