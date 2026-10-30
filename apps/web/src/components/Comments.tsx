import { useState } from "react";
import { Link } from "react-router-dom";
import { isRude } from "@app/core";
import { api, type Comment } from "../api";
import { useLoad, useSession } from "../session";
import { Icon } from "./Icon";
import { ErrorNote, Loading, Sheet, timeAgo, useAction } from "./ui";
import { ReportSheet } from "./Safety";

/** Comments on a post, in a sheet. Anyone can read; signed in people can comment, report or delete their own. */
export function CommentsSheet({ postId, postOwnerShopHandle, onClose, onCount }: {
  postId: string; postOwnerShopHandle: string; onClose: () => void; onCount?: (n: number) => void;
}) {
  const [list, error, reload] = useLoad(async () => { const c = await api.comments(postId); onCount?.(c.length); return c; }, [postId]);
  const [text, setText] = useState("");
  const [menu, setMenu] = useState<Comment | null>(null);
  const [report, setReport] = useState<Comment | null>(null);
  const { user, toast, withUser } = useSession();
  const { busy, error: sendError, run, setError } = useAction();
  const myShop = useLoad(() => (user ? api.myShop() : Promise.resolve(null)), [user?.id])[0];
  const ownPost = !!myShop && myShop.handle === postOwnerShopHandle;

  if (report) return <ReportSheet kind="comment" targetId={report.id} what="this comment" onClose={() => setReport(null)} />;

  const send = () => {
    if (!user) return withUser(undefined, "Sign in to comment");
    if (isRude(text)) return setError("Please keep it friendly. That message has words we don't allow.");
    run(async () => { await api.addComment(postId, text); setText(""); reload(); });
  };

  return (
    <Sheet title={list ? `${list.length} ${list.length === 1 ? "comment" : "comments"}` : "Comments"} onClose={onClose}
      footer={
        <form className="compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={user ? "Add a comment" : "Sign in to comment"}
            aria-label="Add a comment" onFocus={(e) => { if (!user) { e.currentTarget.blur(); withUser(undefined, "Sign in to comment"); } }} />
          <button className="send" disabled={!text.trim() || busy} aria-label="Post comment"><Icon name="send" size={18} /></button>
        </form>
      }>
      <ErrorNote error={error ?? sendError} />
      {!list && !error && <Loading />}
      {list?.length === 0 && <div className="empty">No comments yet. Ask the seller a question.</div>}
      <div className="comments">
        {list?.map((c) => (
          <div key={c.id} className="comment">
            <span className="avatar">{c.name[0]?.toUpperCase()}</span>
            <div className="grow">
              <div className="c-head">
                {c.shopHandle ? <Link to={`/s/${c.shopHandle}`} onClick={onClose}><b>{c.name}</b></Link> : <b>{c.name}</b>}
                {c.isSeller && <span className="seller-tag">Seller</span>}
                <span className="muted">{timeAgo(c.createdAt)}</span>
              </div>
              <div className="c-body">{c.body}</div>
            </div>
            {user && <button className="bare c-more" onClick={() => setMenu(c)} aria-label="Comment options"><Icon name="more" size={18} strokeWidth={3} /></button>}
          </div>
        ))}
      </div>
      {menu && (
        <div className="mini-menu" role="menu">
          {(menu.mine || ownPost) && (
            <button role="menuitem" onClick={() => run(async () => { await api.deleteComment(menu.id); setMenu(null); toast("Comment deleted"); reload(); })}>
              <Icon name="trash" size={16} />Delete</button>
          )}
          {!menu.mine && <button role="menuitem" onClick={() => { setReport(menu); setMenu(null); }}><Icon name="flag" size={16} />Report</button>}
          <button role="menuitem" onClick={() => setMenu(null)}>Cancel</button>
        </div>
      )}
    </Sheet>
  );
}
