// Invite a friend: share your link. A new account that opens it is linked to you and you follow each other.
// Once the friend's first order is done, both get R50 (the inviter only if they've bought before). Rules in migration 0041.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { BackButton, Loading } from "../../components/ui";
import { PUBLIC_URL, shareOrCopy } from "../../native";

const KEY = "myhaul-invite";
/** The link someone shares: the web address with their username. */
export const inviteLink = (handle: string) => `/?invite=${encodeURIComponent(handle)}`;

export function InviteScreen() {
  const { profile, toast } = useSession();
  const [count] = useLoad(() => api.myInvites(), []);
  const nav = useNavigate();
  const handle = profile?.handle ?? null;
  if (!profile) return <div className="screen"><Loading /></div>;
  const full = handle ? `${PUBLIC_URL}${inviteLink(handle)}` : "";
  const share = async () => {
    if (!handle) return;
    const r = await shareOrCopy(inviteLink(handle), "Come shop on myHaul with me. Thrift, designer, beauty and bakes from South African sellers.");
    if (r === "copied") toast("Link copied");
  };
  return (
    <div className="screen">
      <BackButton />
      <div className="invite-hero">
        <span className="ic"><Icon name="gift" size={30} /></span>
        <h1>Invite a friend</h1>
        <p>Send your link. When a friend joins with it, you follow each other straight away. Once their first order is done, you both get R50.</p>
      </div>
      {handle ? (
        <>
          <div className="invite-link"><span>{full.replace(/^https?:\/\//, "")}</span><button className="btn green" onClick={share}><Icon name="share" size={16} />Share</button></div>
          <p className="small muted" style={{ textAlign: "center" }}>
            {count == null ? " " : count === 0 ? "Nobody has joined from your link yet." : `${count} ${count === 1 ? "friend has" : "friends have"} joined from your link.`}
          </p>
          <div className="note" style={{ marginTop: 18 }}>
            <b>How the R50 works</b>
            <ul className="invite-rules">
              <li>Your friend joins with your link and buys something of R100 or more, sent by courier or locker.</li>
              <li>Once their return window closes, you each get R50. It comes off an order of R200 or more.</li>
              <li>You get yours if you've bought something on myHaul before. Up to 10 friends.</li>
            </ul>
          </div>
        </>
      ) : (
        <button className="btn green block" style={{ marginTop: 18 }} onClick={() => nav("/me")}>Pick a username first</button>
      )}
    </div>
  );
}

/** Remembers an invite link someone opened, and links them to the inviter once they've made their account. */
export function InviteCatcher() {
  const { user, profile, toast } = useSession();
  useEffect(() => {
    const h = new URLSearchParams(location.search).get("invite");
    if (h && /^[a-z0-9._]{3,30}$/i.test(h)) { try { localStorage.setItem(KEY, h.toLowerCase()); } catch { /* private mode */ } }
  }, []);
  useEffect(() => {
    if (!user || !profile?.handle) return; // wait until the account is set up
    let h: string | null = null;
    try { h = localStorage.getItem(KEY); } catch { /* private mode */ }
    if (!h) return;
    try { localStorage.removeItem(KEY); } catch { /* private mode */ }
    if (h === profile.handle) return;
    api.acceptInvite(h).then((ok) => { if (ok) toast(`You and @${h} follow each other now`); }).catch(() => {});
  }, [user?.id, profile?.handle]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
