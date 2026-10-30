import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useLoad, useSession } from "../session";
import { BackButton, ErrorNote, Loading, Sheet, useAction } from "../components/ui";

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

const CONTACT = "help@[app domain]"; // [CONFIRM] real support email and company details before publishing

/** Privacy policy and terms in plain words, with contact details (store rules ask for both). */
export function Privacy() {
  return (
    <div className="screen legal">
      <BackButton />
      <h1>Privacy and terms</h1>
      <p className="note amber">Draft for review by a lawyer before launch. Company name, registration number and Information Officer details still to be added. [CONFIRM]</p>

      <h2>Who we are</h2>
      <p>[Company name] [CONFIRM], Cape Town, South Africa. Contact us at {CONTACT}. Our Information Officer under POPIA can be reached at the same address.</p>

      <h2>What we collect</h2>
      <ul>
        <li>Your email or cell number, name, bio and profile details.</li>
        <li>For sellers: ID document and selfie (for checks), bank details (held by our escrow partner), and shop details.</li>
        <li>Your posts, photos, videos, comments, likes, reposts, follows and messages.</li>
        <li>Orders, delivery details and payments (card details are handled by the payment provider, not us).</li>
        <li>Basic device and usage data to keep the app working and safe.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To run your account, show you posts, and process orders, deliveries, returns and payouts.</li>
        <li>To keep the app safe: checking sellers, stopping fakes and scams, and handling reports.</li>
        <li>To meet legal duties, such as tax and financial records.</li>
      </ul>

      <h2>Who we share it with</h2>
      <ul>
        <li>Our escrow and payment partner (TradeSafe), couriers you choose, video hosting (Mux) and our database host (Supabase).</li>
        <li>Never sold to advertisers.</li>
      </ul>

      <h2>Your rights</h2>
      <ul>
        <li>See, correct or delete your information. You can delete your account in the app: Menu, Delete my account.</li>
        <li>Complain to us, or to the Information Regulator of South Africa.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>While your account is open. After you delete it, we keep order and payment records for 5 years as the law requires, then delete them.</p>

      <h2>Community rules</h2>
      <ul>
        <li>No fakes or replicas, no hate or harassment, no nudity, no scams.</li>
        <li>Keep payments in the app. Paying outside removes buyer protection.</li>
        <li>Report anything that breaks these rules. Our team checks reports within 24 hours and may remove content or close accounts.</li>
      </ul>

      <h2>Buying and selling</h2>
      <ul>
        <li>Payments are held by our escrow partner until the return window closes, then paid to the seller.</li>
        <li>Buy now items: 7 day change of mind returns from delivery (you pay return postage). Faulty items: up to 6 months.</li>
        <li>Sellers pay a 6% fee per sale. Founding sellers pay 0% for 90 days.</li>
      </ul>
    </div>
  );
}
