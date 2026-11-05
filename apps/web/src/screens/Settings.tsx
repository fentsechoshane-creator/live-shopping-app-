import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useLoad, useSession } from "../session";
import { BackButton, ErrorNote, Loading, Sheet, useAction } from "../components/ui";
import { DeliveryDetailsForm } from "../components/DeliveryDetails";

/** People you blocked, with Unblock. */
export function BlockedAccounts() {
  const [list, error, reload] = useLoad(() => api.blocked(), []);
  const { refreshBlocks, toast } = useSession();
  const { run } = useAction();
  return (
    <div className="screen">
      <BackButton />
      <h1>Blocked accounts</h1>
      <p className="muted" style={{ marginTop: -6 }}>They can't message you or comment on your posts, and you won't see their posts.</p>
      <ErrorNote error={error} />
      {!list && !error && <Loading />}
      {list?.length === 0 && <div className="empty-card"><span className="muted">You haven't blocked anyone.</span></div>}
      {list && list.length > 0 && (
        <div className="group">
          {list.map((b) => (
            <div key={b.userId} className="cell">
              <span className="avatar">{b.name[0]?.toUpperCase()}</span>
              <span className="grow"><span className="t" style={{ display: "block" }}>{b.name}</span>{b.shopHandle && <span className="s" style={{ display: "block" }}>@{b.shopHandle}</span>}</span>
              <button className="btn" style={{ minHeight: 34, fontSize: 13 }} onClick={() => run(async () => { await api.unblock(b.userId); refreshBlocks(); toast("Unblocked"); reload(); })}>Unblock</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Delete my account: confirm by typing DELETE. Open orders must finish first. */
export function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const { busy, error, run } = useAction();
  const nav = useNavigate();
  return (
    <Sheet title="Delete my account" onClose={onClose}
      footer={<button className="btn danger block big" disabled={text !== "DELETE" || busy}
        onClick={() => run(async () => { await api.deleteAccount(); nav("/", { replace: true }); })}>{busy ? "Deleting…" : "Delete my account"}</button>}>
      <ErrorNote error={error} />
      <div className="stack" style={{ gap: 10 }}>
        <p style={{ margin: 0, lineHeight: 1.5 }}>This removes your name, bio, posts, comments, likes, follows and chats, and you won't be able to sign in again. Your shop closes.</p>
        <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>We keep order and payment records for 5 years because the law requires it. Any open orders must be finished first.</p>
        <label className="wz-label" htmlFor="del-confirm" style={{ marginTop: 6 }}>Type DELETE to confirm</label>
        <input id="del-confirm" className="wz-input" value={text} onChange={(e) => setText(e.target.value)} autoCapitalize="characters" autoComplete="off" />
      </div>
    </Sheet>
  );
}

export const CONTACT = "help@myhaul.co.za"; // [CONFIRM] create this mailbox before launch

/**
 * Terms of Use and Privacy Policy. One source: the public pages (terms.html, privacy.html), which the website, the app
 * stores and the app all show. Our own static files, so showing their HTML here is safe.
 */
function LegalPage({ file, title }: { file: string; title: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(file).then((r) => (r.ok ? r.text() : Promise.reject())).then((t) => {
      const doc = new DOMParser().parseFromString(t, "text/html");
      const main = doc.querySelector("main");
      main?.querySelector("header")?.remove();
      main?.querySelector("footer")?.remove();
      main?.querySelectorAll("script, style, iframe").forEach((n) => n.remove());
      if (live) main ? setHtml(main.innerHTML) : setFailed(true);
    }).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [file]);
  return (
    <div className="screen legal">
      <BackButton />
      <h1>{title}</h1>
      {!html && !failed && <Loading />}
      {failed && <p>Couldn't load this page. Read it at <a href={`https://myhaul.co.za${file}`}>myhaul.co.za{file}</a> or email {CONTACT}.</p>}
      {html && <div dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

export function Privacy() {
  return <LegalPage file="/privacy.html" title="Privacy Policy" />;
}

export function Terms() {
  return <LegalPage file="/terms.html" title="Terms of Use" />;
}

/** Your saved delivery details: checkout uses them so Buy now is one tap. */
export function DeliverySettings() {
  const { toast, user } = useSession();
  const nav = useNavigate();
  const { run } = useAction();
  return (
    <div className="screen">
      <BackButton />
      <h1>Delivery details</h1>
      <p className="muted" style={{ marginTop: -6 }}>Checkout fills these in for you. Only you can see them; the seller only sees what the courier label needs.</p>
      <DeliveryDetailsForm initialName={user?.displayName ?? ""} onDone={() => { toast("Saved"); nav(-1); }} />
      <button className="link block-link" style={{ color: "var(--red, #dc2626)" }}
        onClick={() => run(async () => { await api.saveDelivery(null); toast("Removed"); nav(-1); })}>Remove my saved details</button>
    </div>
  );
}
