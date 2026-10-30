import { useState } from "react";
import { REPORT_REASONS, type ReportReason } from "@app/core";
import { api, type ReportTarget } from "../api";
import { useSession } from "../session";
import { Icon } from "./Icon";
import { Choice, ErrorNote, Sheet, useAction } from "./ui";

/** Report something to our team. Store rules require this on every post, comment, shop and chat. */
export function ReportSheet({ kind, targetId, what, onClose }: { kind: ReportTarget; targetId: string; what: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const { busy, error, run } = useAction();
  const { toast } = useSession();
  return (
    <Sheet title={`Report ${what}`} onClose={onClose}
      footer={<button className="btn green block big" disabled={!reason || busy}
        onClick={() => run(async () => { await api.report(kind, targetId, reason!, details); toast("Thanks. Our team checks reports within 24 hours."); onClose(); })}>Send report</button>}>
      <ErrorNote error={error} />
      <p className="small muted" style={{ marginTop: 0 }}>Reports are private. The person won't know it was you.</p>
      {(Object.keys(REPORT_REASONS) as ReportReason[]).map((r) => (
        <Choice key={r} on={reason === r} onClick={() => setReason(r)} title={REPORT_REASONS[r]} />
      ))}
      <textarea className="wz-input" rows={3} placeholder="Anything else we should know? (optional)" value={details} onChange={(e) => setDetails(e.target.value)}
        maxLength={500} aria-label="More details" style={{ marginTop: 8 }} />
    </Sheet>
  );
}

/** The "…" menu on a post or shop: report, block, and (on posts) message the seller. */
export function MoreSheet({ kind, targetId, shopId, shopHandle, onClose, onMessage }: {
  kind: "post" | "shop"; targetId: string; shopId: string; shopHandle: string; onClose: () => void; onMessage?: () => void;
}) {
  const [reporting, setReporting] = useState(false);
  const { user, toast, refreshBlocks } = useSession();
  const { busy, error, run } = useAction();
  if (reporting) return <ReportSheet kind={kind} targetId={targetId} what={kind === "post" ? "this post" : `@${shopHandle}`} onClose={onClose} />;
  return (
    <Sheet title={kind === "post" ? "This post" : `@${shopHandle}`} onClose={onClose}>
      <ErrorNote error={error} />
      {!user && <p className="small muted" style={{ marginTop: 0 }}>Sign in to report or block.</p>}
      <div className="group">
        {onMessage && (
          <button className="cell" onClick={onMessage}><span className="icon-btn" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon name="chat" size={18} /></span>
            <span className="grow t">Message @{shopHandle}</span></button>
        )}
        <button className="cell" disabled={!user} onClick={() => setReporting(true)}>
          <span className="icon-btn" style={{ width: 34, height: 34, borderRadius: 10 }}><Icon name="flag" size={18} /></span>
          <span className="grow t">Report {kind === "post" ? "post" : "shop"}</span>
        </button>
        <button className="cell" disabled={!user || busy} onClick={() => run(async () => {
          await api.block({ shopId });
          refreshBlocks();
          toast(`Blocked @${shopHandle}. You won't see their posts or messages.`);
          onClose();
        })}>
          <span className="icon-btn" style={{ width: 34, height: 34, borderRadius: 10, color: "var(--red-text)" }}><Icon name="block" size={18} /></span>
          <span className="grow t" style={{ color: "var(--red-text)" }}>Block @{shopHandle}</span>
        </button>
      </div>
    </Sheet>
  );
}
