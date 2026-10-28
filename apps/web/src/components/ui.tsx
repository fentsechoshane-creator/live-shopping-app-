import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { formatRand, type Cents, type SellerTier, TIER_INFO } from "@app/core";

export const R = (c: Cents) => formatRand(c);

export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="grabber" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" style={{ background: "var(--soft)", color: "var(--ink)" }} onClick={onClose} aria-label="Close">✕</button>
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
