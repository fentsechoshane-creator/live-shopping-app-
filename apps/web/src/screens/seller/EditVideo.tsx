import { useEffect, useMemo, useRef, useState } from "react";
import { activeMarks, clipLength, clipStartsAt, editLength, EDIT_LIMITS, isRude, locate, validateEdit, type EditClip, type EditList, type EditMark, type MarkPos } from "@app/core";
import type { EditDraft, MyShop, PlayEdit } from "../../api";
import { ClipPlayer, type ClipPlayerApi } from "../../components/ClipPlayer";
import { clock } from "../../components/Video";
import { Icon } from "../../components/Icon";
import { R, Segmented, Sheet } from "../../components/ui";

/** A clip in the editor: its file, a preview link, how long the source is, and the edit settings. */
interface Clip extends EditClip { file: File; url: string; duration: number; photo: boolean; thumb: string | null }

const PHOTO_SECONDS = 3;

/** How long a video file runs, and a small picture of its first frame. */
async function probe(file: File): Promise<{ url: string; duration: number; thumb: string | null; photo: boolean }> {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) return { url, duration: 10, thumb: url, photo: true };
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "metadata"; v.src = url;
    const done = (thumb: string | null) => resolve({ url, duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 15, thumb, photo: false });
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.2, (v.duration || 1) / 2); };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 90; c.height = 160;
        const ctx = c.getContext("2d");
        if (ctx) { const s = Math.max(90 / v.videoWidth, 160 / v.videoHeight); ctx.drawImage(v, (90 - v.videoWidth * s) / 2, (160 - v.videoHeight * s) / 2, v.videoWidth * s, v.videoHeight * s); }
        done(c.toDataURL("image/jpeg", 0.7));
      } catch { done(null); }
    };
    v.onerror = () => done(null);
    window.setTimeout(() => done(null), 6000);
  });
}

type Tool = null | "text" | "tag" | "flaw";

/**
 * The video editor, between Retake and Next (docs/VIDEO_EDITING.md): join clips from the camera and the gallery,
 * trim and reorder them, sound on or off, text, tag items (haul mode), mark flaws, and pick the cover.
 * Nothing is re-rendered: the edit is saved as a list and the app plays it.
 */
export function EditVideo({ files, inApp, shop, itemTitle, initial, onCancel, onDone }: {
  files: File[];
  /** Which of the starting files were recorded in the app. */
  inApp: boolean[];
  shop: MyShop | null;
  /** The listing being made, so "This item" can be tagged before it exists. */
  itemTitle: string;
  initial?: EditList | null;
  onCancel: () => void;
  onDone: (draft: EditDraft) => void;
}) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [marks, setMarks] = useState<EditMark[]>(initial?.marks ?? []);
  const [cover, setCover] = useState(initial?.cover ?? 0);
  const [sel, setSel] = useState(0);
  const [t, setT] = useState(0);
  const [tool, setTool] = useState<Tool>(null);
  const [note, setNote] = useState<string | null>(null);
  const player = useRef<ClipPlayerApi | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

  const add = async (list: File[], fromCamera: boolean[]) => {
    const room = EDIT_LIMITS.maxClips - clips.length;
    if (list.length > room) setNote(`Up to ${EDIT_LIMITS.maxClips} clips. Added the first ${room}.`);
    const probed = await Promise.all(list.slice(0, room).map(probe));
    setClips((cur) => [...cur, ...probed.map((p, i): Clip => ({
      file: list[i], url: p.url, duration: p.duration, thumb: p.thumb, photo: p.photo, start: 0,
      end: p.photo ? PHOTO_SECONDS : Math.min(p.duration, EDIT_LIMITS.maxTotalSeconds), muted: false, inApp: !!fromCamera[i],
    }))]);
  };
  // Start with the clips we were given, keeping any trims from an earlier edit.
  useEffect(() => {
    add(files, inApp).then(() => {
      if (initial) setClips((cur) => cur.map((c, i) => (initial.clips[i] ? { ...c, ...initial.clips[i] } : c)));
    });
    return () => clips.forEach((c) => URL.revokeObjectURL(c.url));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const list: EditList = { clips: clips.map(({ start, end, muted, inApp }) => ({ start, end, muted, inApp })), marks, cover };
  const total = editLength(list);
  const problems = clips.length ? validateEdit(list) : [];
  const play: PlayEdit | null = useMemo(() => (clips.length ? {
    clips: clips.map((c) => ({ start: c.start, end: c.end, muted: c.muted, inApp: c.inApp, video: { url: c.url, kind: c.photo ? "image" : "video" } })),
    marks, cover,
  } : null), [clips, marks, cover]);
  const on = activeMarks(list, t);
  const c = clips[sel];

  const update = (i: number, patch: Partial<Clip>) => setClips((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (d: -1 | 1) => {
    const j = sel + d;
    if (j < 0 || j >= clips.length) return;
    setClips((cur) => { const n = [...cur]; [n[sel], n[j]] = [n[j], n[sel]]; return n; });
    setSel(j);
  };
  const remove = () => {
    if (clips.length === 1) return setNote("A video needs at least one clip. Use Back to start again.");
    setClips((cur) => cur.filter((_, j) => j !== sel));
    setSel((s) => Math.max(0, s - 1));
  };
  // Split the clip under the playhead in two, so the middle can be cut or reordered.
  const split = () => {
    const at = locate(list, t);
    const x = clips[at.index];
    if (at.sourceTime - x.start < EDIT_LIMITS.minClipSeconds || x.end - at.sourceTime < EDIT_LIMITS.minClipSeconds)
      return setNote("Move a little further into the clip to split it (each part needs at least a second).");
    if (clips.length >= EDIT_LIMITS.maxClips) return setNote(`Up to ${EDIT_LIMITS.maxClips} clips.`);
    setClips((cur) => [...cur.slice(0, at.index), { ...x, end: at.sourceTime }, { ...x, start: at.sourceTime }, ...cur.slice(at.index + 1)]);
    setSel(at.index + 1);
  };
  const seekClip = (i: number, sourceTime?: number) => player.current?.seek(clipStartsAt(list, i) + ((sourceTime ?? clips[i].start) - clips[i].start));
  const addMark = (m: EditMark) => { setMarks((cur) => [...cur, m].sort((a, b) => a.at - b.at)); setTool(null); };
  const at = Math.round(t * 10) / 10;

  const done = () => {
    if (problems.length) return setNote(problems[0]);
    onDone({ files: clips.map((x) => x.file), list: { ...list, marks: list.marks.filter((m) => m.at <= total), cover: Math.min(cover, total) } });
  };

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label="Edit video">
      <div className="editor-top">
        <button className="btn vglass" onClick={onCancel}><Icon name="back" size={18} />Back</button>
        <span className="editor-len">{clock(total)}</span>
        <button className="btn green" onClick={done} disabled={!clips.length}>Done</button>
      </div>

      <div className="editor-stage video-card">
        {play ? <ClipPlayer edit={play} label="Preview" onTime={(time) => setT(time)} apiRef={(a) => { player.current = a; }} /> : <div className="cam-msg">Loading your clips…</div>}
        {on.filter((m) => m.kind === "text").map((m, i) => <div key={i} className={`overlay-text ${m.pos ?? "middle"}`}><span>{m.text}</span></div>)}
        {on.some((m) => m.kind === "flaw") && <div className="flaw-flash"><Icon name="flag" size={14} />{on.find((m) => m.kind === "flaw")?.text || "Flaw shown here"}</div>}
        {on.some((m) => m.kind === "tag") && <div className="editor-tagnow vglass"><Icon name="bag" size={13} />{tagName(on.find((m) => m.kind === "tag")!, shop, itemTitle)}</div>}
      </div>

      {note && <div className="editor-note" role="status" onClick={() => setNote(null)}>{note}</div>}

      {/* Clips: tap to select, then trim, move, split or mute. */}
      <div className="editor-strip" role="list" aria-label="Clips">
        {clips.map((x, i) => (
          <button key={i} role="listitem" className={`editor-clip ${i === sel ? "on" : ""}`} onClick={() => { setSel(i); seekClip(i); }}
            aria-label={`Clip ${i + 1}, ${Math.round(clipLength(x))} seconds${x.muted ? ", sound off" : ""}${i === sel ? ", selected" : ""}`}
            style={{ flexGrow: Math.max(1, clipLength(x)) }}>
            {x.thumb ? <img src={x.thumb} alt="" /> : <span className="ph" />}
            <span className="d">{Math.round(clipLength(x))}s</span>
            {x.muted && <span className="m"><Icon name="mute" size={11} /></span>}
          </button>
        ))}
        <button className="editor-add" onClick={() => addRef.current?.click()} aria-label="Add clips from your gallery"><Icon name="plus" size={20} /></button>
        <input ref={addRef} type="file" accept="video/*,image/*" multiple hidden aria-label="Add clips"
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) add(fs, fs.map(() => false)); e.target.value = ""; }} />
      </div>

      {c && (
        <div className="editor-trim">
          <div className="row between small"><b>Clip {sel + 1}</b><span className="muted">{clock(c.start)} to {clock(c.end)} · {Math.round(clipLength(c))}s</span></div>
          <div className="trim-range">
            <input type="range" min={0} max={c.photo ? 10 : c.duration} step={0.1} value={c.start} aria-label="Clip starts at"
              onChange={(e) => { const v = Math.min(Number(e.target.value), c.end - EDIT_LIMITS.minClipSeconds); update(sel, { start: Math.max(0, v) }); seekClip(sel, Math.max(0, v)); }} />
            <input type="range" min={0} max={c.photo ? 10 : c.duration} step={0.1} value={c.end} aria-label="Clip ends at"
              onChange={(e) => { const v = Math.max(Number(e.target.value), c.start + EDIT_LIMITS.minClipSeconds); update(sel, { end: v }); seekClip(sel, Math.max(c.start, v - 0.6)); }} />
            <span className="trim-keep" style={{ left: `${(c.start / (c.photo ? 10 : c.duration)) * 100}%`, right: `${100 - (c.end / (c.photo ? 10 : c.duration)) * 100}%` }} />
          </div>
          <div className="editor-clipbar">
            <button onClick={() => move(-1)} disabled={sel === 0} aria-label="Move clip earlier"><Icon name="back" size={16} /></button>
            <button onClick={() => move(1)} disabled={sel === clips.length - 1} aria-label="Move clip later"><Icon name="chevron" size={16} /></button>
            <button onClick={split}><Icon name="cut" size={16} />Split</button>
            <button onClick={() => update(sel, { muted: !c.muted })} aria-pressed={c.muted}><Icon name={c.muted ? "mute" : "sound"} size={16} />{c.muted ? "Sound off" : "Sound on"}</button>
            <button onClick={remove} className="danger"><Icon name="trash" size={16} />Delete</button>
          </div>
        </div>
      )}

      <div className="editor-tools" role="group" aria-label="Add to the video">
        <button onClick={() => setTool("text")}><Icon name="text" size={20} />Text</button>
        <button onClick={() => setTool("tag")}><Icon name="bag" size={20} />Tag item</button>
        <button onClick={() => setTool("flaw")}><Icon name="flag" size={20} />Flaw</button>
        <button onClick={() => { setCover(at); setNote(`Cover set at ${clock(at)}. This is the picture people see in your shop and when it's shared.`); }}><Icon name="image" size={20} />Cover</button>
      </div>

      {marks.length > 0 && (
        <div className="editor-marks" aria-label="Texts, tags and flaws">
          {marks.map((m, i) => (
            <span key={i} className={`mark-chip ${m.kind}`}>
              <button className="bare" onClick={() => player.current?.seek(m.at)}>{clock(m.at)} · {m.kind === "text" ? `"${m.text}"` : m.kind === "tag" ? tagName(m, shop, itemTitle) : m.text || "Flaw"}</button>
              <button className="bare x" onClick={() => setMarks((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="close" size={12} /></button>
            </span>
          ))}
        </div>
      )}

      {tool === "text" && <TextSheet at={at} onClose={() => setTool(null)} onAdd={addMark} />}
      {tool === "flaw" && <FlawSheet at={at} onClose={() => setTool(null)} onAdd={addMark} />}
      {tool === "tag" && <TagSheet at={at} shop={shop} itemTitle={itemTitle} onClose={() => setTool(null)} onAdd={addMark} />}
    </div>
  );
}

const tagName = (m: EditMark, shop: MyShop | null, itemTitle: string) =>
  m.productId === "self" ? itemTitle || "This item" : shop?.products.find((p) => p.id === m.productId)?.title ?? "Item";

function TextSheet({ at, onClose, onAdd }: { at: number; onClose: () => void; onAdd: (m: EditMark) => void }) {
  const [text, setText] = useState("");
  const [pos, setPos] = useState<MarkPos>("middle");
  const [secs, setSecs] = useState(3);
  const bad = isRude(text);
  return (
    <Sheet title={`Text at ${clock(at)}`} onClose={onClose}
      footer={<button className="btn green block big" disabled={!text.trim() || bad} onClick={() => onAdd({ kind: "text", at, until: at + secs, text: text.trim(), pos })}>Add text</button>}>
      <input className="setup-input" value={text} maxLength={EDIT_LIMITS.maxText} autoFocus placeholder="Size M, small mark on the cuff" onChange={(e) => setText(e.target.value)} aria-label="Text" />
      {bad && <p className="small" style={{ color: "var(--red-text)" }}>Please keep it friendly.</p>}
      <div style={{ height: 12 }} />
      <Segmented<MarkPos> label="Where" value={pos} onChange={setPos} options={[{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }]} />
      <div style={{ height: 10 }} />
      <Segmented<string> label="Shows for" value={String(secs)} onChange={(v) => setSecs(Number(v))} options={[{ value: "2", label: "2s" }, { value: "3", label: "3s" }, { value: "5", label: "5s" }, { value: "10", label: "10s" }]} />
    </Sheet>
  );
}

function FlawSheet({ at, onClose, onAdd }: { at: number; onClose: () => void; onAdd: (m: EditMark) => void }) {
  const [text, setText] = useState("");
  return (
    <Sheet title={`Flaw at ${clock(at)}`} onClose={onClose}
      footer={<button className="btn green block big" disabled={isRude(text)} onClick={() => onAdd({ kind: "flaw", at, text: text.trim() || undefined })}>Mark this flaw</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Buyers can jump straight to every flaw you mark. Flaws shown on video protect you if a buyer says the item wasn't as described.</p>
      <input className="setup-input" value={text} maxLength={EDIT_LIMITS.maxText} placeholder="Small mark on the left cuff (optional)" onChange={(e) => setText(e.target.value)} aria-label="What the flaw is" />
    </Sheet>
  );
}

function TagSheet({ at, shop, itemTitle, onClose, onAdd }: { at: number; shop: MyShop | null; itemTitle: string; onClose: () => void; onAdd: (m: EditMark) => void }) {
  const others = (shop?.products ?? []).filter((p) => p.status === "live");
  return (
    <Sheet title={`Tag an item at ${clock(at)}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Show several items in one video. From this moment, buyers see this item on the video and can buy it.</p>
      <div className="group">
        <button className="cell" onClick={() => onAdd({ kind: "tag", at, productId: "self" })}>
          <span className="grow"><span className="t" style={{ display: "block" }}>{itemTitle || "This item"}</span><span className="s" style={{ display: "block" }}>The item you're listing now</span></span>
          <Icon name="plus" size={18} />
        </button>
        {others.map((p) => (
          <button key={p.id} className="cell" onClick={() => onAdd({ kind: "tag", at, productId: p.id })}>
            <span className="grow"><span className="t" style={{ display: "block" }}>{p.title}</span><span className="s" style={{ display: "block" }}>{R(p.priceCents)}</span></span>
            <Icon name="plus" size={18} />
          </button>
        ))}
      </div>
      {others.length === 0 && <p className="small muted">Your other live items show here too, so one video can sell several.</p>}
    </Sheet>
  );
}
