import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { formatRand, type Cents, type SellerTier, TIER_INFO } from "@app/core";
import { Icon } from "./Icon";

export const R = (c: Cents) => formatRand(c);

/** Bottom sheet in frosted glass. Escape and tapping outside close it. */
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet glass" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A labelled form control. The label is linked to the input so screen readers and tests can find it. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<any>, { id, "aria-describedby": hint ? hintId : undefined })
    : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {control}
      {hint && <span className="hint" id={hintId}>{hint}</span>}
    </div>
  );
}

export function Choice({ on, onClick, title, sub, right }: { on: boolean; onClick: () => void; title: string; sub?: string; right?: ReactNode }) {
  return (
    <button type="button" className="choice" aria-pressed={on} onClick={onClick}>
      <span><b>{title}</b>{sub && <small>{sub}</small>}</span>
      {right && <b>{right}</b>}
    </button>
  );
}

/** Segmented control, like the For you / Following / Live switch. */
export function Segmented<T extends string>({ value, onChange, options, label, onVideo }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label: string; onVideo?: boolean;
}) {
  return (
    <div className={`seg ${onVideo ? "on-video" : ""}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Goes back to the previous screen. If the screen was opened directly (a link, a refresh), goes to `fallback`. */
export function useGoBack(fallback = "/") {
  const nav = useNavigate();
  const loc = useLocation();
  return () => (loc.key !== "default" ? nav(-1) : nav(fallback, { replace: true }));
}

/** Back to the previous screen. `to` is only used when there is no previous screen. */
export function BackButton({ to, label = "Back" }: { to?: string; label?: string }) {
  const back = useGoBack(to ?? "/");
  return <button className="back" onClick={back}><Icon name="back" size={20} />{label}</button>;
}

/** Grouped list row, like iOS settings. */
export function Cell({ icon, title, sub, right, onClick, to }: { icon?: string; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; to?: string }) {
  const nav = useNavigate();
  const go = onClick ?? (to ? () => nav(to) : undefined);
  const inner = (
    <>
      {icon && <span className="icon-btn" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon name={icon} size={18} /></span>}
      <span className="grow"><span className="t" style={{ display: "block" }}>{title}</span>{sub && <span className="s" style={{ display: "block" }}>{sub}</span>}</span>
      {right ?? (go && <span className="chev"><Icon name="chevron" size={18} /></span>)}
    </>
  );
  return go ? <button type="button" className="cell" onClick={go}>{inner}</button> : <div className="cell">{inner}</div>;
}

export function ErrorNote({ error }: { error: string | null | undefined }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}

/** Runs an async action with a busy flag and error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

export function TierPill({ tier }: { tier: SellerTier }) {
  const cls = tier === "top" ? "dark" : tier === "trusted" ? "green" : tier === "restricted" ? "red" : "";
  return <span className={`pill ${cls}`}>{TIER_INFO[tier].label}</span>;
}

export function Progress({ step, of }: { step: number; of: number }) {
  return (
    <div className="progress" aria-label={`Step ${step} of ${of}`}>
      {Array.from({ length: of }, (_, i) => <span key={i} className={i < step ? "on" : ""} />)}
    </div>
  );
}

export function Loading() {
  return <div className="empty" aria-busy="true">Loading…</div>;
}

export const dateText = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" }) : "";
export const dateTimeText = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
export const timeAgo = (iso: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
};

/** Placeholder colours for demo videos and items without a picture, so tiles are never blank. */
const SWATCHES = ["#5b4636", "#2f3a4a", "#6b4a4a", "#34495e", "#4a4a3a", "#3f4a3f", "#4a3f55"];
export const swatch = (key: string) => SWATCHES[[...key].reduce((a, c) => a + c.charCodeAt(0), 0) % SWATCHES.length];
