import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { canUse, TIER_INFO, tierFor, TRUST_POINTS, WELCOME_CREDIT } from "@app/core";
import { api, type MyShop, type Order } from "../../api";
import { useLoad, useSession } from "../../session";
import { Icon } from "../../components/Icon";
import { ProductArt } from "../../components/Scene";
import { ErrorNote, Field, Loading, R, Sheet, dateText, swatch, useAction } from "../../components/ui";
import { CertUpload } from "../seller/Selling";
import { PostGrid } from "../../components/PostGrid";
import { useTabSwipe } from "../../components/gestures";

type Tab = "posts" | "likes" | "reposts";

/**
 * One profile page, laid out like a TikTok profile. The header stays put; the Seller | Buyer
 * tabs only change the numbers, the short line under them, the small buttons and the grid.
 */
export function Profile() {
  const { user, setMenuOpen, following, toast } = useSession();
  const [params, setParams] = useSearchParams();
  const [profile, , reloadProfile] = useLoad(() => (user ? api.myProfile() : Promise.resolve(null)), [user?.id]);
  const [credit] = useLoad(() => (user ? api.welcomeCreditAvailable() : Promise.resolve(false)), [user?.id]);
  const [shop, shopError, reloadShop] = useLoad(() => (user ? api.myShop() : Promise.resolve(null)), [user?.id]);
  const [sales] = useLoad(() => (shop && shop.status !== "onboarding" ? api.sellerOrders() : Promise.resolve([] as Order[])), [shop?.id, shop?.status]);
  const [sheet, setSheet] = useState<null | "edit" | "following" | "trust">(null);
  const nav = useNavigate();

  const hasShop = !!shop && shop.status !== "onboarding";
  const asked = params.get("tab");
  // "selling" is the old name for the Posts tab; links from onboarding still use it.
  const tab: Tab = asked === "likes" ? "likes" : asked === "reposts" ? "reposts" : "posts";
  const setTab = (t: Tab) => setParams(t === "posts" ? {} : { tab: t }, { replace: true });
  const swipeTabs = useTabSwipe(["posts", "likes", "reposts"] as const, tab, setTab);

  useEffect(() => {
    // ID and certificate checks finish in the background, so refresh while one is pending.
    if (shop && (shop.checks.idStatus === "pending" || shop.checks.certStatus === "pending")) {
      const t = window.setTimeout(reloadShop, 4000);
      return () => window.clearTimeout(t);
    }
  }, [shop, reloadShop]);

  if (!user) return null;
  if (!profile) return <div className="screen"><Loading /></div>;
  const name = profile.displayName || user.email?.split("@")[0] || "You";
  const handle = name.toLowerCase().replace(/[^a-z0-9.]+/g, ".");
  const share = async () => {
    const url = hasShop ? `${location.origin}/s/${shop!.handle}` : `${location.origin}/`;
    try {
      if (navigator.share) await navigator.share({ url });
      else { await navigator.clipboard.writeText(url); toast("Link copied"); }
    } catch { /* cancelled */ }
  };

  const sold = (sales ?? []).filter((o) => !["cancelled", "refunded"].includes(o.status)).length;
  const toShip = (sales ?? []).filter((o) => o.status === "paid").length;
  const founding = hasShop && shop!.foundingUntil && new Date(shop!.foundingUntil) > new Date();
  const standing = profile.trustScore >= 70 ? "Trusted buyer" : profile.trustScore >= 40 ? "Good standing" : "Under review";
  const categoryText = shop ? { clothes: "Clothes and thrift", beauty: "Hair and beauty", food: "Food and bakes", designer: "Designer resale" }[shop.category] : "";

  const ratings = (sales ?? []).map((o) => o.review?.stars).filter((x): x is number => typeof x === "number");
  const rating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const standingTone = profile.trustScore >= 40 ? "green" : "amber";

  return (
    <div className="screen profile">
      <div className="pbar">
        <button className="bare" onClick={() => setSheet("edit")} aria-label="Edit profile"><Icon name="edit" /></button>
        <div className="row" style={{ gap: 4 }}>
          <button className="wallet-chip sm" onClick={() => toast(credit ? `${R(WELCOME_CREDIT)} welcome credit on your first order of R200 or more` : "No credit right now")}
            aria-label={`Wallet, ${credit ? R(WELCOME_CREDIT) : "R0"} credit`}>
            <Icon name="wallet" /><span className="amt">{credit ? R(WELCOME_CREDIT) : "R0"}</span>
          </button>
          <button className="bare" onClick={share} aria-label="Share profile"><Icon name="share" /></button>
          <button className="bare" onClick={() => setMenuOpen(true)} aria-label="Menu and settings"><Icon name="menu" /></button>
        </div>
      </div>

      <div className="phead">
        <div className={`pavatar ${hasShop ? "green" : ""}`}>{name[0]?.toUpperCase()}</div>
        <div className="pstats">
          <button onClick={() => { setTab("posts"); document.getElementById("grid")?.scrollIntoView({ behavior: "smooth" }); }}>
            <b>{hasShop ? shop!.products.filter((p) => p.status === "live").length : 0}</b><span>Posts</span></button>
          <button onClick={() => hasShop && nav("/sell/orders")}><b>{sold}</b><span>Sales</span></button>
          <button onClick={() => setSheet("following")}><b>{following.size}</b><span>Following</span></button>
        </div>
      </div>

      <div className="pname">
        <b>{name}</b>
        {hasShop && shop!.checks.idStatus === "approved" && <span className="tick" aria-label="Verified"><Icon name="check" size={12} strokeWidth={3} /></span>}
        {hasShop && <RatingBubble rating={rating} count={ratings.length} />}
      </div>
      <div className="phandle">
        <span>@{handle}</span>
        <button className={`standing ${standingTone}`} onClick={() => (hasShop ? setSheet("trust") : nav("/help"))}>
          <Icon name="shield" size={12} strokeWidth={2.4} />{standing}
        </button>
      </div>
      {profile.bio
        ? <p className="pbio">{profile.bio}</p>
        : <button className="pbio add" onClick={() => setSheet("edit")}>Add a bio</button>}

      <div className="ptabs" role="tablist" aria-label="Profile">
        <button role="tab" aria-selected={tab === "posts"} onClick={() => setTab("posts")}>Posts</button>
        <button role="tab" aria-selected={tab === "likes"} onClick={() => setTab("likes")}>Likes</button>
        <button role="tab" aria-selected={tab === "reposts"} onClick={() => setTab("reposts")}>Reposts</button>
      </div>

      {tab === "posts" && hasShop && (
        <>
          <div className="ppills">
            <button className="pill-btn green" onClick={() => nav("/post?mode=create")}><Icon name="plus" size={14} strokeWidth={2.5} />List an item</button>
            <button className="pill-btn" onClick={() => nav("/sell/orders")}><Icon name="truck" size={14} />Orders{toShip > 0 && <span className="count">{toShip}</span>}</button>
            <button className="pill-btn" onClick={() => nav("/sell/payouts")}><Icon name="payout" size={14} />Payouts</button>
          </div>
          {founding
            ? <div className="pnote">{shop!.name} · Founding seller, 0% fee until {dateText(shop!.foundingUntil)}</div>
            : <div className="pnote muted">{shop!.name} · {categoryText}</div>}
        </>
      )}

      <div id="grid" {...swipeTabs} className="swipe-area">
        {tab === "posts" && <SellerGrid shop={shop} error={shopError} sold={sold} reload={reloadShop} />}
        {tab !== "posts" && <ReactionGrid kind={tab === "likes" ? "like" : "repost"} />}
      </div>

      {sheet === "edit" && <EditProfile name={name} bio={profile.bio} onClose={() => setSheet(null)} onSaved={reloadProfile} />}
      {sheet === "following" && <FollowingSheet onClose={() => setSheet(null)} />}
      {sheet === "trust" && hasShop && <TrustSheet shop={shop!} onClose={() => setSheet(null)} />}
    </div>
  );
}

/** Seller rating out of 5. Red at the bottom, green at the top, black when there are no ratings yet. */
export function RatingBubble({ rating, count }: { rating: number | null; count: number }) {
  if (rating === null) return <span className="rating none" aria-label="No ratings yet">★ 0.0</span>;
  const hue = Math.round(Math.max(0, Math.min(1, (rating - 1) / 3.5)) * 135);
  return (
    <span className="rating" style={{ background: `hsl(${hue} 72% 38%)` }} aria-label={`Rated ${rating.toFixed(1)} out of 5 from ${count} reviews`}>
      ★ {rating.toFixed(1)}
    </span>
  );
}

function SellerGrid({ shop, error, sold, reload }: { shop: MyShop | null | undefined; error: string | null; sold: number; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  if (error) return <ErrorNote error={error} />;
  if (shop === undefined) return <Loading />;
  if (!shop || shop.status === "onboarding") {
    return (
      <div className="pprompt">
        <span className="pprompt-ic"><Icon name="store" size={22} /></span>
        <b>{shop ? "Finish opening your shop" : "Open your shop to post"}</b>
        <span>Sell from short videos with the money held safely. The first 50 shops pay 0% for 3 months, then 6% only when you sell.</span>
        <button className="btn green" onClick={() => nav("/sell/start")}>{shop ? "Continue" : "Open my shop"}</button>
      </div>
    );
  }
  const steps: [string, boolean, string?][] = [
    ["Open your shop", true],
    ["ID checked", shop.checks.idStatus === "approved", shop.checks.idStatus === "pending" ? "our team is checking it" : undefined],
    ...(shop.category === "food" ? [["Food safety certificate approved", shop.checks.certStatus === "approved"] as [string, boolean]] : []),
    ["List your first item", shop.products.length > 0],
    ["Post a video of your items", shop.products.some((p) => p.posted)],
    ["Get your first sale", sold > 0],
  ];
  const done = steps.filter((x) => x[1]).length;

  return (
    <>
      {shop.status === "banned" && <div className="error">This shop has been closed for breaking the seller rules.</div>}
      {done < steps.length && (
        <div className="pcheck">
          <button className="row between" style={{ width: "100%" }} onClick={() => setOpen(!open)} aria-expanded={open}>
            <span><b>Get your shop going</b> <span className="muted">{done} of {steps.length}</span></span>
            <span style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.2s" }}><Icon name="chevron" size={16} /></span>
          </button>
          <div className="progress" style={{ marginTop: 8 }}>{steps.map((x, i) => <span key={i} className={x[1] ? "on" : ""} />)}</div>
          {open && (
            <div className="checklist" style={{ marginTop: 6 }}>
              {steps.map(([t, ok, sub]) => (
                <div className="item" key={t}>
                  <span className={`dot ${ok ? "done" : ""}`}>{ok && <Icon name="check" size={12} strokeWidth={3} />}</span>
                  <span className={`grow ${ok ? "done-text" : ""}`}>{t}{sub && <span className="small muted"> · {sub}</span>}</span>
                </div>
              ))}
              {shop.category === "food" && shop.checks.certStatus !== "approved" && <CertUpload status={shop.checks.certStatus} onDone={reload} />}
            </div>
          )}
        </div>
      )}
      {shop.products.length === 0 ? (
        <div className="pprompt">
          <span className="pprompt-ic"><Icon name="plus" size={22} strokeWidth={2.5} /></span>
          <b>Post your first item</b>
          <span>A short video of the item sells best. Show it from every side, and any marks.</span>
          <button className="btn green" onClick={() => nav("/post?mode=create")}>Post an item</button>
        </div>
      ) : (
        <div className="grid3">
          {shop.products.map((p) => (
            <Link key={p.id} to={`/s/${shop.handle}`} className="g3" aria-label={`${p.title}, ${R(p.priceCents)}`}>
              <ProductArt productId={p.id} fallback={swatch(p.id)} />
              {p.status !== "live" && <span className="g3chip">{p.status === "draft" && p.proofStatus === "pending" ? "Checking" : p.status === "sold_out" ? "Sold out" : "Draft"}</span>}
              <span className="g3foot">{R(p.priceCents)}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Likes or reposts. Public, so the same grid shows on shop pages. */
function ReactionGrid({ kind }: { kind: "like" | "repost" }) {
  const { liked, reposted } = useSession();
  const [posts, error] = useLoad(() => api.reactedPosts(kind), [kind, liked.size, reposted.size]);
  if (error) return <ErrorNote error={error} />;
  if (!posts) return <Loading />;
  return <PostGrid items={posts} empty={
    <div className="pempty">{kind === "like" ? "Videos you like show here. Tap the heart on any video." : "Videos you repost show here and in your followers' Following feed."}<br />Everyone can see them.</div>
  } />;
}

function FollowingSheet({ onClose }: { onClose: () => void }) {
  const { following, toggleFollow } = useSession();
  const [shops] = useLoad(() => api.following(), [following.size]);
  const nav = useNavigate();
  return (
    <Sheet title="Following" onClose={onClose}>
      {!shops ? <Loading /> : shops.length === 0 ? (
        <div className="stack" style={{ alignItems: "flex-start" }}>
          <span className="muted">Follow sellers to see their drops first.</span>
          <button className="btn dark" onClick={() => nav("/explore")}>Find sellers</button>
        </div>
      ) : (
        <div className="group">
          {shops.map((s) => (
            <div className="cell" key={s.id}>
              <Link to={`/s/${s.handle}`} className="row grow"><span className="avatar">{s.name[0]}</span>
                <span className="grow"><span className="t" style={{ display: "block" }}>{s.name}</span><span className="s" style={{ display: "block" }}>@{s.handle}</span></span></Link>
              <button className="btn" style={{ minHeight: 32, fontSize: 13 }} onClick={() => toggleFollow(s.id)}>Following</button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function TrustSheet({ shop, onClose }: { shop: MyShop; onClose: () => void }) {
  const tier = tierFor(shop.trustScore);
  const state = { verified: shop.checks.idStatus === "approved" && shop.checks.bankStatus === "approved", goodOrders: shop.goodOrders,
    trustScore: shop.trustScore, category: shop.category, foodCertApproved: shop.checks.certStatus === "approved" };
  const auction = canUse("timed_auction", state);
  return (
    <Sheet title="Trust score" onClose={onClose}>
      <div className="score">
        <div className="ring2" style={{ background: `conic-gradient(var(--green) ${shop.trustScore}%, var(--surface-2) 0)` }}><div>{shop.trustScore}</div></div>
        <div className="grow"><b>{TIER_INFO[tier].label}</b><div className="small muted">{TIER_INFO[tier].perks}</div></div>
      </div>
      <p className="small muted" style={{ lineHeight: 1.5 }}>
        Earn: kept order +{TRUST_POINTS.order_kept}, ship in 2 days with a packing video +{TRUST_POINTS.fast_ship_with_video}, five star review +{TRUST_POINTS.five_star_review}.
        Lose: not as described {TRUST_POINTS.not_as_described}, not shipped {TRUST_POINTS.not_shipped}, payment outside the app {TRUST_POINTS.off_app_payment}.
      </p>
      <div className="group">
        <div className="cell"><span className="grow t">Buy now, videos and chat</span><span className="pill green">Open</span></div>
        <div className="cell"><span className="grow t">Auctions and going live</span><span className={`pill ${auction.ok ? "green" : ""}`}>{auction.ok ? "Open" : `${shop.goodOrders} of 5 good orders`}</span></div>
      </div>
    </Sheet>
  );
}

function EditProfile({ name, bio, onClose, onSaved }: { name: string; bio: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(name);
  const [text, setText] = useState(bio);
  const { busy, error, run } = useAction();
  return (
    <Sheet title="Edit profile" onClose={onClose}
      footer={<button className="btn green block big" disabled={busy || !value.trim()} onClick={() => run(async () => { await api.updateProfile(value, text); onSaved(); onClose(); })}>Save</button>}>
      <ErrorNote error={error} />
      <Field label="Name"><input value={value} onChange={(e) => setValue(e.target.value)} maxLength={40} /></Field>
      <Field label="Bio" hint={`${text.length} of 150`}><textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={150} rows={3} placeholder="What you sell or love to buy" /></Field>
    </Sheet>
  );
}
