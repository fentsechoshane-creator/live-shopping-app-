import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  activeMarks, clipLength, clipStartsAt, editLength, EDIT_LIMITS, isRude, locate, tidyMark, validateEdit, TEXT_COLOURS, TEXT_STYLES,
  type EditClip, type EditList, type EditMark, type TextStyle,
} from "@app/core";
import type { EditDraft, MyShop, PlayEdit } from "../../api";
import { ClipPlayer, type ClipPlayerApi } from "../../components/ClipPlayer";
import { clock } from "../../components/Video";
import { Icon } from "../../components/Icon";
import { PlacedText } from "../../components/PlacedText";
import { R, Sheet } from "../../components/ui";

/**
 * The video editor, CapCut style (asked by Ofentse 7 Nov 2026), between Retake and Next:
 * - the video on top, with text you drag anywhere, resize and turn with the corner handle, and style;
 * - a timeline you scroll to scrub (the white line is "now"): clips as a film strip, texts, item tags and flaws as bars;
 * - one tool bar that changes with what's selected (nothing, a clip, a text, a tag or a flaw).
 * Nothing is re-rendered: the edit is saved as a list and the app plays it (docs/VIDEO_EDITING.md).
 */

interface Clip extends EditClip { file: File; url: string; duration: number; photo: boolean; thumb: string | null }
type Selected = { kind: "clip"; index: number } | { kind: "mark"; index: number } | null;

const PHOTO_SECONDS = 3;
const PPS = 48; // timeline pixels per second

/** How long a video file runs, and a small picture of its first frame. */
async function probe(file: File): Promise<{ url: string; duration: number; thumb: string | null; photo: boolean }> {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("image/")) return { url, duration: 10, thumb: url, photo: true };
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let settled = false;
    const done = (thumb: string | null) => { if (settled) return; settled = true; resolve({ url, duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 15, thumb, photo: false }); };
    v.muted = true; v.playsInline = true; v.preload = "metadata"; v.src = url;
    v.onloadedmetadata = () => { v.currentTime = Math.min(0.2, (v.duration || 1) / 2); };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 90; c.height = 160;
        const ctx = c.getContext("2d");
        if (ctx) { const k = Math.max(90 / v.videoWidth, 160 / v.videoHeight); ctx.drawImage(v, (90 - v.videoWidth * k) / 2, (160 - v.videoHeight * k) / 2, v.videoWidth * k, v.videoHeight * k); }
        done(c.toDataURL("image/jpeg", 0.7));
      } catch { done(null); }
    };
    v.onerror = () => done(null);
    window.setTimeout(() => done(null), 6000);
  });
}

/** When a mark stops showing (same rule as the player). */
const markEnd = (m: EditMark, marks: EditMark[], total: number) => m.until ?? (m.kind === "tag"
  ? (marks.filter((x) => x.kind === "tag" && x.at > m.at).sort((a, b) => a.at - b.at)[0]?.at ?? total)
  : m.at + (m.kind === "flaw" ? EDIT_LIMITS.flawSeconds : EDIT_LIMITS.textSeconds));

export function EditVideo({ files, inApp, shop, itemTitle, initial, onCancel, onDone }: {
  files: File[]; inApp: boolean[]; shop: MyShop | null; itemTitle: string; initial?: EditList | null;
  onCancel: () => void; onDone: (draft: EditDraft) => void;
}) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [marks, setMarks] = useState<EditMark[]>(initial?.marks ?? []);
  const [cover, setCover] = useState(initial?.cover ?? 0);
  const [sel, setSel] = useState<Selected>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [typing, setTyping] = useState<{ index: number | null; text: string } | null>(null); // the full screen text editor
  const [sheet, setSheet] = useState<null | "tag" | "flaw">(null);
  const [guide, setGuide] = useState(false); // centre line while dragging text
  const player = useRef<ClipPlayerApi | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const dragged = useRef(false); // a drag isn't a tap: dropping text doesn't open the text editor

  const add = async (list: File[], fromCamera: boolean[]) => {
    const room = EDIT_LIMITS.maxClips - clips.length;
    if (list.length > room) setNote(`Up to ${EDIT_LIMITS.maxClips} clips. Added the first ${room}.`);
    const probed = await Promise.all(list.slice(0, room).map(probe));
    setClips((cur) => [...cur, ...probed.map((p, i): Clip => ({
      file: list[i], url: p.url, duration: p.duration, thumb: p.thumb, photo: p.photo, start: 0,
      end: p.photo ? PHOTO_SECONDS : Math.min(p.duration, EDIT_LIMITS.maxTotalSeconds), muted: false, inApp: !!fromCamera[i],
    }))]);
  };
  useEffect(() => {
    add(files, inApp).then(() => { if (initial) setClips((cur) => cur.map((c, i) => (initial.clips[i] ? { ...c, ...initial.clips[i] } : c))); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const list: EditList = { clips: clips.map(({ start, end, muted, inApp }) => ({ start, end, muted, inApp })), marks, cover };
  const total = editLength(list);
  const play: PlayEdit | null = useMemo(() => (clips.length ? {
    clips: clips.map((c) => ({ start: c.start, end: c.end, muted: c.muted, inApp: c.inApp, video: { url: c.url, kind: c.photo ? "image" : "video" } })),
    marks, cover,
  } : null), [clips, marks, cover]);
  const selMark = sel?.kind === "mark" ? marks[sel.index] : null;
  const selClip = sel?.kind === "clip" ? clips[sel.index] : null;
  // Texts showing now, plus the selected one so it can always be moved.
  const shownText = marks.map((m, i) => ({ m, i })).filter(({ m, i }) => m.kind === "text" && (activeMarks({ ...list, marks: [m] }, t).length > 0 || (sel?.kind === "mark" && sel.index === i)));
  const flawNow = activeMarks(list, t).find((m) => m.kind === "flaw");
  const tagNow = activeMarks(list, t).find((m) => m.kind === "tag");

  // ----- Time: the timeline scrolls with playback, and scrolling it scrubs -----
  const seek = (time: number) => { const v = Math.max(0, Math.min(total, time)); setT(v); player.current?.seek(v); };
  useEffect(() => {
    if (!playing || !scrollRef.current) return;
    programmatic.current = true;
    scrollRef.current.scrollLeft = t * PPS;
  }, [t, playing]);
  const onScroll = () => {
    if (programmatic.current) { programmatic.current = false; return; }
    if (playing) player.current?.pause();
    seek((scrollRef.current?.scrollLeft ?? 0) / PPS);
  };
  const jumpTo = (time: number) => { player.current?.pause(); seek(time); if (scrollRef.current) { programmatic.current = true; scrollRef.current.scrollLeft = time * PPS; } };

  // ----- Clips -----
  const update = (i: number, patch: Partial<Clip>) => setClips((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (d: -1 | 1) => {
    if (sel?.kind !== "clip") return;
    const j = sel.index + d;
    if (j < 0 || j >= clips.length) return;
    setClips((cur) => { const n = [...cur]; [n[sel.index], n[j]] = [n[j], n[sel.index]]; return n; });
    setSel({ kind: "clip", index: j });
  };
  const removeClip = () => {
    if (sel?.kind !== "clip") return;
    if (clips.length === 1) return setNote("A video needs at least one clip. Use Back to start again.");
    setClips((cur) => cur.filter((_, j) => j !== sel.index));
    setSel(null);
  };
  // Split the clip under the white line in two.
  const split = () => {
    const at = locate(list, t);
    const x = clips[at.index];
    if (at.sourceTime - x.start < EDIT_LIMITS.minClipSeconds || x.end - at.sourceTime < EDIT_LIMITS.minClipSeconds)
      return setNote("Move the white line a little further into the clip to split it (each part needs at least a second).");
    if (clips.length >= EDIT_LIMITS.maxClips) return setNote(`Up to ${EDIT_LIMITS.maxClips} clips.`);
    setClips((cur) => [...cur.slice(0, at.index), { ...x, end: at.sourceTime }, { ...x, start: at.sourceTime }, ...cur.slice(at.index + 1)]);
    setSel({ kind: "clip", index: at.index + 1 });
  };
  const trim = (i: number, side: "start" | "end", value: number) => {
    const c = clips[i]; const max = c.photo ? 10 : c.duration;
    if (side === "start") update(i, { start: Math.max(0, Math.min(value, c.end - EDIT_LIMITS.minClipSeconds)) });
    else update(i, { end: Math.min(max, Math.max(value, c.start + EDIT_LIMITS.minClipSeconds)) });
  };

  // ----- Marks -----
  const putMark = (m: EditMark) => {
    const next = [...marks, tidyMark(m)];
    setMarks(next);
    setSel({ kind: "mark", index: next.length - 1 });
  };
  const changeMark = (i: number, patch: Partial<EditMark>) => setMarks((cur) => cur.map((x, j) => (j === i ? tidyMark({ ...x, ...patch }) : x)));
  const removeMark = () => { if (sel?.kind !== "mark") return; setMarks((cur) => cur.filter((_, j) => j !== sel.index)); setSel(null); };
  const at = Math.round(t * 10) / 10;

  // ----- Dragging, resizing and turning text on the video -----
  const dragText = (i: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (sel?.kind !== "mark" || sel.index !== i) { setSel({ kind: "mark", index: i }); }
    const rect = stageRef.current!.getBoundingClientRect();
    const m = marks[i];
    const sx = e.clientX, sy = e.clientY, ox = m.x ?? 0.5, oy = m.y ?? 0.4;
    let moved = false;
    dragged.current = false;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height;
      if (Math.abs(dx) + Math.abs(dy) > 0.01) { moved = true; dragged.current = true; }
      let x = ox + dx;
      const snap = Math.abs(x - 0.5) < 0.025;
      if (snap) x = 0.5;
      setGuide(snap && moved);
      changeMark(i, { x, y: oy + dy });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); setGuide(false); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };
  const turnText = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = stageRef.current!.getBoundingClientRect();
    const m = marks[i];
    const cx = rect.left + (m.x ?? 0.5) * rect.width, cy = rect.top + (m.y ?? 0.4) * rect.height;
    const d0 = Math.hypot(e.clientX - cx, e.clientY - cy) || 1, a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const s0 = m.size ?? 1, r0 = m.rot ?? 0;
    const onMove = (ev: PointerEvent) => {
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy), a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let rot = r0 + ((a - a0) * 180) / Math.PI;
      if (Math.abs(rot % 90) < 4) rot = Math.round(rot / 90) * 90; // snap level and upright
      changeMark(i, { size: s0 * (d / d0), rot });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };

  const done = () => {
    const problems = validateEdit(list);
    if (problems.length) return setNote(problems[0]);
    onDone({ files: clips.map((x) => x.file), list: { ...list, marks: list.marks.filter((m) => m.at <= total), cover: Math.min(cover, total) } });
  };
  const tagName = (m: EditMark) => (m.productId === "self" ? itemTitle || "This item" : shop?.products.find((p) => p.id === m.productId)?.title ?? "Item");
  const width = Math.max(1, total) * PPS;
  // Marks that overlap in time go on separate rows (up to 3), so none hides another.
  const lanes = useMemo(() => {
    const ends: number[] = [];
    const of = marks.map((m) => {
      const end = Math.max(m.at + 18 / PPS, markEnd(m, marks, total));
      let lane = ends.findIndex((e) => e <= m.at);
      if (lane < 0) lane = ends.length < 3 ? ends.length : ends.indexOf(Math.min(...ends));
      ends[lane] = end;
      return lane;
    });
    return { of, count: Math.max(1, ends.length) };
  }, [marks, total]);

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label="Edit video">
      <div className="editor-top">
        <button className="btn vglass" onClick={onCancel}><Icon name="back" size={18} />Back</button>
        <span className="editor-len" aria-label="Time">{clock(t)} / {clock(total)}</span>
        <button className="btn green" onClick={done} disabled={!clips.length}>Done</button>
      </div>

      <div className="editor-stage video-card" ref={stageRef} onPointerDown={() => setSel(null)}>
        {play ? <ClipPlayer edit={play} label="Preview" noTap onPlayState={setPlaying}
          onTime={(time) => { if (playing) setT(time); }} apiRef={(a) => { if (!player.current) a.pause(); player.current = a; }} /> : <div className="cam-msg">Loading your clips…</div>}
        <div className="text-layer editing">
          {shownText.map(({ m, i }) => (
            <PlacedText key={i} m={m} selected={sel?.kind === "mark" && sel.index === i} onPointerDown={dragText(i)}
              onClick={() => { if (!dragged.current && sel?.kind === "mark" && sel.index === i) setTyping({ index: i, text: m.text ?? "" }); dragged.current = false; }} />
          ))}
          {selMark?.kind === "text" && (
            <button className="text-handle" aria-label="Resize and turn text" onPointerDown={turnText(sel!.index)}
              style={{ left: `calc(${(selMark.x ?? 0.5) * 100}% + ${8 * (selMark.size ?? 1)}cqw)`, top: `calc(${(selMark.y ?? 0.4) * 100}% + ${3.5 * (selMark.size ?? 1)}cqw)` }}>
              <Icon name="flip" size={14} />
            </button>
          )}
          {guide && <span className="snap-guide" aria-hidden="true" />}
        </div>
        {flawNow && <div className="flaw-flash"><Icon name="flag" size={14} />{flawNow.text || "Flaw shown here"}</div>}
        {tagNow && <div className="editor-tagnow vglass"><Icon name="bag" size={13} />{tagName(tagNow)}</div>}
      </div>

      <div className="editor-transport">
        <button className="play-btn" onClick={() => (playing ? player.current?.pause() : player.current?.play())} aria-label={playing ? "Pause" : "Play"}>
          <Icon name={playing ? "pause" : "play"} size={20} />
        </button>
        {note && <span className="editor-note" role="status" onClick={() => setNote(null)}>{note}</span>}
      </div>

      {/* The timeline: scroll to scrub; the white line is now. */}
      <div className="tl-wrap">
      <div className="timeline" ref={scrollRef} onScroll={onScroll} aria-label="Timeline">
        <div className="tl-inner" style={{ width: `calc(100% + ${width}px)` }}>
          <div className="tl-row clips" role="list" aria-label="Clips">
            {clips.map((c, i) => {
              const on = sel?.kind === "clip" && sel.index === i;
              return (
                <div key={i} role="listitem" className={`tl-clip ${on ? "on" : ""}`} style={{ width: clipLength(c) * PPS, backgroundImage: c.thumb ? `url(${c.thumb})` : undefined }}
                  aria-label={`Clip ${i + 1}, ${Math.round(clipLength(c))} seconds${c.muted ? ", sound off" : ""}${on ? ", selected" : ""}`}
                  onClick={() => { setSel(on ? null : { kind: "clip", index: i }); jumpTo(clipStartsAt(list, i) + 0.05); }}>
                  <span className="d">{Math.round(clipLength(c))}s</span>
                  {c.muted && <span className="m"><Icon name="mute" size={11} /></span>}
                  {on && <TrimHandle side="start" clip={c} onTrim={(v) => trim(i, "start", v)} />}
                  {on && <TrimHandle side="end" clip={c} onTrim={(v) => trim(i, "end", v)} />}
                </div>
              );
            })}
            <button className="tl-add" onClick={() => addRef.current?.click()} aria-label="Add clips from your gallery"><Icon name="plus" size={18} /></button>
          </div>
          <div className="tl-row marks" aria-label="Texts, tags and flaws" style={{ height: 8 + 26 * lanes.count }}>
            {marks.map((m, i) => {
              const end = Math.min(total, markEnd(m, marks, total));
              const lane = lanes.of[i];
              const on = sel?.kind === "mark" && sel.index === i;
              return (
                <button key={i} className={`tl-mark ${m.kind} ${on ? "on" : ""}`} style={{ left: m.at * PPS, width: Math.max(18, (end - m.at) * PPS), top: 2 + lane * 26 }}
                  aria-label={`${m.kind === "text" ? `Text "${m.text}"` : m.kind === "tag" ? `Tag ${tagName(m)}` : `Flaw ${m.text ?? ""}`} at ${clock(m.at)}`}
                  onClick={() => { setSel({ kind: "mark", index: i }); jumpTo(m.at + 0.05); }}>
                  <Icon name={m.kind === "text" ? "text" : m.kind === "tag" ? "bag" : "flag"} size={11} />
                  <span>{m.kind === "text" ? m.text : m.kind === "tag" ? tagName(m) : m.text || "Flaw"}</span>
                </button>
              );
            })}
            {cover <= total && <span className="tl-cover" style={{ left: cover * PPS }} title="Cover" aria-label={`Cover at ${clock(cover)}`}><Icon name="image" size={10} /></span>}
          </div>
        </div>
      </div>
      <span className="tl-now" aria-hidden="true" />
      </div>
      <input ref={addRef} type="file" accept="video/*,image/*" multiple hidden aria-label="Add clips"
        onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) add(fs, fs.map(() => false)); e.target.value = ""; }} />

      {/* One tool bar that changes with what's selected. */}
      <div className="editor-tools" role="toolbar" aria-label={selClip ? "Clip tools" : selMark ? "Text, tag or flaw tools" : "Add"}>
        {!sel && (
          <>
            <Tool icon="text" label="Text" onClick={() => setTyping({ index: null, text: "" })} />
            <Tool icon="bag" label="Tag item" onClick={() => setSheet("tag")} />
            <Tool icon="flag" label="Flaw" onClick={() => setSheet("flaw")} />
            <Tool icon="image" label="Cover" onClick={() => { setCover(at); setNote(`Cover set at ${clock(at)}. People see this picture in your shop and when it's shared.`); }} />
            <Tool icon="cut" label="Split" onClick={split} />
            <Tool icon="plus" label="Add clip" onClick={() => addRef.current?.click()} />
          </>
        )}
        {selClip && sel?.kind === "clip" && (
          <>
            <Tool icon="cut" label="Split" onClick={split} />
            <Tool icon={selClip.muted ? "mute" : "sound"} label={selClip.muted ? "Sound off" : "Sound on"} pressed={selClip.muted} onClick={() => update(sel.index, { muted: !selClip.muted })} />
            <Tool icon="back" label="Earlier" disabled={sel.index === 0} onClick={() => move(-1)} />
            <Tool icon="chevron" label="Later" disabled={sel.index === clips.length - 1} onClick={() => move(1)} />
            <Tool icon="trash" label="Delete" danger onClick={removeClip} />
            <Tool icon="check" label="Done" name="Done with this" onClick={() => setSel(null)} />
          </>
        )}
        {selMark && sel?.kind === "mark" && (
          <>
            {selMark.kind === "text" && <Tool icon="edit" label="Edit" onClick={() => setTyping({ index: sel.index, text: selMark.text ?? "" })} />}
            {selMark.kind === "text" && <Tool icon="clock" label="Longer" onClick={() => changeMark(sel.index, { until: Math.min(total, markEnd(selMark, marks, total) + 1) })} />}
            {selMark.kind === "text" && <Tool icon="clock" label="Shorter" onClick={() => changeMark(sel.index, { until: Math.max(selMark.at + 0.5, markEnd(selMark, marks, total) - 1) })} />}
            {selMark.kind === "flaw" && <Tool icon="edit" label="Note" onClick={() => setSheet("flaw")} />}
            <Tool icon="clock" label="Move here" onClick={() => {
              const len = markEnd(selMark, marks, total) - selMark.at;
              changeMark(sel.index, { at, ...(selMark.until != null ? { until: Math.min(total, at + len) } : {}) });
            }} />
            <Tool icon="trash" label="Delete" danger onClick={removeMark} />
            <Tool icon="check" label="Done" name="Done with this" onClick={() => setSel(null)} />
          </>
        )}
      </div>

      {typing && <TextEditor initial={typing.index != null ? marks[typing.index] : null} text={typing.text}
        onClose={() => setTyping(null)}
        onSave={(text, style, color) => {
          if (typing.index != null) changeMark(typing.index, { text, style, color });
          else putMark({ kind: "text", at, until: Math.min(total, at + EDIT_LIMITS.textSeconds), text, x: 0.5, y: 0.4, size: 1, rot: 0, style, color });
          setTyping(null);
        }} />}
      {sheet === "flaw" && <FlawSheet at={selMark?.kind === "flaw" ? selMark.at : at} initial={selMark?.kind === "flaw" ? selMark.text ?? "" : ""} onClose={() => setSheet(null)}
        onSave={(text) => { if (selMark?.kind === "flaw" && sel?.kind === "mark") changeMark(sel.index, { text: text || undefined }); else putMark({ kind: "flaw", at, text: text || undefined }); setSheet(null); }} />}
      {sheet === "tag" && <TagSheet at={at} shop={shop} itemTitle={itemTitle} onClose={() => setSheet(null)} onPick={(productId) => { putMark({ kind: "tag", at, productId }); setSheet(null); }} />}
    </div>
  );
}

function Tool({ icon, label, name, onClick, disabled, danger, pressed }: { icon: string; label: string; name?: string; onClick: () => void; disabled?: boolean; danger?: boolean; pressed?: boolean }) {
  return <button className={danger ? "danger" : ""} onClick={onClick} disabled={disabled} aria-pressed={pressed} aria-label={name}><Icon name={icon} size={20} /><span>{label}</span></button>;
}

/** A trim handle on the edge of the selected clip: drag it, or use the arrow keys (a tenth of a second each). */
function TrimHandle({ side, clip, onTrim }: { side: "start" | "end"; clip: Clip; onTrim: (v: number) => void }) {
  const value = side === "start" ? clip.start : clip.end;
  const down = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    const x0 = e.clientX, v0 = value;
    const onMove = (ev: PointerEvent) => onTrim(v0 + (ev.clientX - x0) / PPS);
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };
  return (
    <span className={`trim-h ${side}`} role="slider" tabIndex={0} aria-label={side === "start" ? "Clip starts at" : "Clip ends at"}
      aria-valuemin={0} aria-valuemax={clip.photo ? 10 : Math.round(clip.duration * 10) / 10} aria-valuenow={Math.round(value * 10) / 10}
      onPointerDown={down} onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); onTrim(value + (e.key === "ArrowRight" ? 0.1 : -0.1) * (e.shiftKey ? 10 : 1)); } }} />
  );
}

/** Typing text full screen, with style and colour right there, like CapCut. */
function TextEditor({ initial, text: start, onClose, onSave }: {
  initial: EditMark | null; text: string; onClose: () => void; onSave: (text: string, style: TextStyle, color: string) => void;
}) {
  const [text, setText] = useState(start);
  const [style, setStyle] = useState<TextStyle>(initial?.style ?? "plain");
  const [color, setColor] = useState<string>(initial?.color ?? "#ffffff");
  const bad = isRude(text);
  const preview: EditMark = { kind: "text", at: 0, text: text || "Your text", x: 0.5, y: 0.5, size: 1.2, style, color };
  return (
    <div className="text-editor" role="dialog" aria-label="Text">
      <div className="row between">
        <button className="btn vglass" onClick={onClose}>Cancel</button>
        <button className="btn green" disabled={!text.trim() || bad} onClick={() => onSave(text.trim(), style, color)}>Done</button>
      </div>
      <div className="te-preview"><div className="text-layer"><PlacedText m={preview} /></div></div>
      <textarea value={text} maxLength={EDIT_LIMITS.maxText} autoFocus rows={2} placeholder="Size M, small mark on the cuff" onChange={(e) => setText(e.target.value.replace(/\n{2,}/g, "\n"))} aria-label="Text" />
      {bad && <p className="small" style={{ color: "#ff8a80", margin: 0 }}>Please keep it friendly.</p>}
      <div className="te-row" role="group" aria-label="Style">
        {TEXT_STYLES.map((s) => (
          <button key={s} aria-pressed={style === s} onClick={() => setStyle(s)} className={`te-style ${s}`}>
            {s === "plain" ? "Aa" : s === "box" ? <span className="b">Aa</span> : <span className="o">Aa</span>}
            <small>{s === "plain" ? "Plain" : s === "box" ? "Box" : "Outline"}</small>
          </button>
        ))}
      </div>
      <div className="te-row colours" role="group" aria-label="Colour">
        {TEXT_COLOURS.map((c) => <button key={c} aria-pressed={color === c} aria-label={`Colour ${c}`} onClick={() => setColor(c)} style={{ background: c }} />)}
      </div>
    </div>
  );
}

function FlawSheet({ at, initial, onClose, onSave }: { at: number; initial: string; onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <Sheet title={`Flaw at ${clock(at)}`} onClose={onClose}
      footer={<button className="btn green block big" disabled={isRude(text)} onClick={() => onSave(text.trim())}>Mark this flaw</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Buyers can jump straight to every flaw you mark. Flaws shown on video protect you if a buyer says the item wasn't as described.</p>
      <input className="setup-input" value={text} maxLength={EDIT_LIMITS.maxText} placeholder="Small mark on the left cuff (optional)" onChange={(e) => setText(e.target.value)} aria-label="What the flaw is" />
    </Sheet>
  );
}

function TagSheet({ at, shop, itemTitle, onClose, onPick }: { at: number; shop: MyShop | null; itemTitle: string; onClose: () => void; onPick: (productId: string) => void }) {
  const others = (shop?.products ?? []).filter((p) => p.status === "live");
  return (
    <Sheet title={`Tag an item at ${clock(at)}`} onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Show several items in one video. From this moment, buyers see this item on the video and can buy it.</p>
      <div className="group">
        <button className="cell" onClick={() => onPick("self")}>
          <span className="grow"><span className="t" style={{ display: "block" }}>{itemTitle || "This item"}</span><span className="s" style={{ display: "block" }}>The item you're listing now</span></span>
          <Icon name="plus" size={18} />
        </button>
        {others.map((p) => (
          <button key={p.id} className="cell" onClick={() => onPick(p.id)}>
            <span className="grow"><span className="t" style={{ display: "block" }}>{p.title}</span><span className="s" style={{ display: "block" }}>{R(p.priceCents)}</span></span>
            <Icon name="plus" size={18} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
