// The Live tab next to Following: who's live now, then planned shows with Remind me.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, type LiveShow } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { Avatar, useShopAvatars } from "../../components/Avatar";
import { Loading } from "../../components/ui";
import { showTime } from "./Watch";

export function LiveTab() {
  const nav = useNavigate();
  const { withUser, toast, following } = useSession();
  const [shows, error, reload] = useLoad(() => api.liveShows(), []);
  useEffect(() => { const t = window.setInterval(reload, 20000); return () => window.clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const faces = useShopAvatars((shows ?? []).map((x) => x.shop.id));
  if (error) return <div className="live-list"><div className="blank on-video"><Icon name="live" size={44} strokeWidth={1.5} /><b>Couldn't load shows</b><span>{error}</span></div></div>;
  if (!shows) return <div className="live-list"><Loading /></div>;
  // Shops you follow first.
  const order = (a: LiveShow, b: LiveShow) => Number(following.has(b.shop.id)) - Number(following.has(a.shop.id));
  const now = shows.filter((s) => s.status === "live").sort(order);
  const later = shows.filter((s) => s.status === "scheduled");
  const remind = (s: LiveShow) => withUser(async () => {
    try { await api.setLiveReminder(s.id, !s.reminded); reload(); toast(s.reminded ? "Reminder off" : `We'll remind you when @${s.shop.handle} goes live`); }
    catch (e) { toast(e instanceof Error ? e.message : "Couldn't set the reminder."); }
  }, "Sign in to get a reminder");

  return (
    <div className="live-list">
      {now.length === 0 && later.length === 0 && (
        <div className="blank on-video" style={{ marginTop: "18vh" }}>
          <Icon name="live" size={44} strokeWidth={1.5} />
          <b>No one is live</b>
          <span>Follow sellers to hear when they go live.</span>
          <button className="btn vglass" onClick={() => nav("/explore")}>Find sellers</button>
        </div>
      )}
      {now.length > 0 && <h2 className="live-h">Live now</h2>}
      <div className="live-grid">
        {now.map((s) => (
          <button key={s.id} className="live-tile" onClick={() => nav(`/live/${s.id}`)} aria-label={`${s.shop.handle} is live: ${s.title}`}>
            <span className="live-tile-bg" data-cat={s.shop.category} aria-hidden="true" />
            <span className="live-pill"><span className="dot-live" />LIVE</span>
            {s.peakViewers > 0 && <span className="live-viewers vglass"><Icon name="eye" size={13} />{s.peakViewers}</span>}
            <span className="live-tile-foot">
              <Avatar url={faces[s.shop.id]} name={s.shop.name} size={28} />
              <span><b>{s.shop.handle}</b><span>{s.title}</span></span>
            </span>
          </button>
        ))}
      </div>
      {later.length > 0 && <h2 className="live-h">Coming up</h2>}
      <div className="live-later">
        {later.map((s) => (
          <div key={s.id} className="live-later-row vglass">
            <button className="live-later-main" onClick={() => nav(`/live/${s.id}`)}>
              <Avatar url={faces[s.shop.id]} name={s.shop.name} size={40} />
              <span><b>{s.title}</b><span>@{s.shop.handle} · {showTime(s.startsAt)}</span></span>
            </button>
            {s.mine ? <button className="btn small vglass" onClick={() => nav(`/live/host/${s.id}`)}>Start</button> : (
              <button className={`btn small ${s.reminded ? "vglass" : "green"}`} aria-pressed={s.reminded} onClick={() => remind(s)}>
                <Icon name="bell" size={16} />{s.reminded ? "On" : "Remind me"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
