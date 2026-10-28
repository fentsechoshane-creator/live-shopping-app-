import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useSession } from "./session";
import { Loading } from "./components/ui";
import { Feed } from "./screens/buyer/Feed";
import { MockPay, OrderDetail, Orders } from "./screens/buyer/Orders";
import { Activity, Me, ShopPage, SignIn } from "./screens/buyer/Account";
import { Onboarding } from "./screens/seller/Onboarding";
import { NewListing, Payouts, SellerOrderDetail, SellerOrders, SellHome } from "./screens/seller/Selling";
import { Admin } from "./screens/admin/Admin";

function RequireUser({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
  const loc = useLocation();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}

function Tabs() {
  const { user } = useSession();
  const loc = useLocation();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!user) return setUnread(0);
    api.notifications().then((n) => setUnread(n.filter((x) => !x.readAt).length)).catch(() => {});
  }, [user, loc.pathname]);
  return (
    <nav className="tabs" aria-label="Main">
      <NavLink to="/" end><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>Home</NavLink>
      <NavLink to="/orders"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7z" /><path d="M9 7a3 3 0 0 1 6 0" /></svg>Orders</NavLink>
      <NavLink to="/sell" aria-label="Sell"><span className="plus" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg></span></NavLink>
      <NavLink to="/activity"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>Activity{unread > 0 && <span className="badge">{unread}</span>}</NavLink>
      <NavLink to="/me"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>Me</NavLink>
    </nav>
  );
}

const guard = (el: ReactNode) => <RequireUser>{el}</RequireUser>;

export function App() {
  return (
    <div className="phone">
      {api.mode === "demo" && <div className="demo-bar">Demo mode: test data in this browser only</div>}
      <div className="content">
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/s/:handle" element={<ShopPage />} />
          <Route path="/orders" element={guard(<Orders />)} />
          <Route path="/orders/:id" element={guard(<OrderDetail />)} />
          <Route path="/mock-pay/:id" element={guard(<MockPay />)} />
          <Route path="/activity" element={guard(<Activity />)} />
          <Route path="/me" element={guard(<Me />)} />
          <Route path="/sell" element={guard(<SellHome />)} />
          <Route path="/sell/start" element={guard(<Onboarding />)} />
          <Route path="/sell/new" element={guard(<NewListing />)} />
          <Route path="/sell/orders" element={guard(<SellerOrders />)} />
          <Route path="/sell/orders/:id" element={guard(<SellerOrderDetail />)} />
          <Route path="/sell/payouts" element={guard(<Payouts />)} />
          <Route path="/admin" element={guard(<Admin />)} />
          <Route path="*" element={<div className="screen"><div className="empty">Page not found.</div></div>} />
        </Routes>
        <Tabs />
      </div>
    </div>
  );
}
