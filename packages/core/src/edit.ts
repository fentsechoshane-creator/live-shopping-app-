// The video editor's edit list (docs/VIDEO_EDITING.md). A post can be several clips (from the camera or the gallery),
// each trimmed, with text, item tags ("haul" mode) and flaw marks on top, and a chosen cover moment. Nothing is
// re-rendered: the app plays the clips in order and draws the marks. The same limits are checked in the database
// (set_post_edit, migration 0032).

export const EDIT_LIMITS = {
  maxClips: 10,
  minClipSeconds: 1,
  maxTotalSeconds: 180,
  maxMarks: 30,
  maxText: 80,
  textSeconds: 3, // how long a text shows by default
  flawSeconds: 2.5,
} as const;

export type MarkKind = "text" | "tag" | "flaw";
export type MarkPos = "top" | "middle" | "bottom";

export interface EditClip {
  /** Seconds into the source video. A photo clip uses 0 to its show time. */
  start: number;
  end: number;
  muted: boolean;
  /** Recorded in the app (gets the "Filmed in myHaul" badge), not picked from the gallery. */
  inApp: boolean;
}

export interface EditMark {
  kind: MarkKind;
  /** Seconds on the whole edit's timeline (all clips joined). */
  at: number;
  /** When it stops showing. Tags show until the next tag or the end. */
  until?: number;
  text?: string;
  productId?: string;
  pos?: MarkPos;
}

export interface EditList {
  clips: EditClip[];
  marks: EditMark[];
  /** Seconds on the whole timeline for the cover picture. */
  cover: number;
}

export const clipLength = (c: EditClip) => Math.max(0, c.end - c.start);
export const editLength = (e: Pick<EditList, "clips">) => e.clips.reduce((n, c) => n + clipLength(c), 0);

/** Where a moment on the whole timeline falls: which clip, and how far into its source. */
export function locate(e: Pick<EditList, "clips">, t: number): { index: number; sourceTime: number } {
  let left = Math.max(0, t);
  for (let i = 0; i < e.clips.length; i++) {
    const len = clipLength(e.clips[i]);
    if (left < len || i === e.clips.length - 1) return { index: i, sourceTime: e.clips[i].start + Math.min(left, len) };
    left -= len;
  }
  return { index: 0, sourceTime: 0 };
}

/** When a clip starts on the whole timeline. */
export const clipStartsAt = (e: Pick<EditList, "clips">, index: number) =>
  e.clips.slice(0, index).reduce((n, c) => n + clipLength(c), 0);

/** The marks showing at a moment. Tags last until the next tag; text and flaws for a few seconds unless set. */
export function activeMarks(e: EditList, t: number): EditMark[] {
  const total = editLength(e);
  const tags = e.marks.filter((m) => m.kind === "tag").sort((a, b) => a.at - b.at);
  return e.marks.filter((m) => {
    const until = m.until ?? (m.kind === "tag"
      ? (tags.find((x) => x.at > m.at)?.at ?? total)
      : m.at + (m.kind === "flaw" ? EDIT_LIMITS.flawSeconds : EDIT_LIMITS.textSeconds));
    return t >= m.at && t < until;
  });
}

/** Problems with an edit, in plain words. Empty means it's fine. */
export function validateEdit(e: EditList): string[] {
  const out: string[] = [];
  if (!e.clips.length) out.push("Add at least one clip.");
  if (e.clips.length > EDIT_LIMITS.maxClips) out.push(`Up to ${EDIT_LIMITS.maxClips} clips.`);
  for (const [i, c] of e.clips.entries()) {
    if (!(c.start >= 0) || !(c.end > c.start)) out.push(`Clip ${i + 1}: check where it starts and ends.`);
    else if (clipLength(c) < EDIT_LIMITS.minClipSeconds) out.push(`Clip ${i + 1} is too short (at least ${EDIT_LIMITS.minClipSeconds} second).`);
  }
  const total = editLength(e);
  if (total > EDIT_LIMITS.maxTotalSeconds) out.push(`Videos can be up to ${EDIT_LIMITS.maxTotalSeconds / 60} minutes. Trim ${Math.ceil(total - EDIT_LIMITS.maxTotalSeconds)} seconds.`);
  if (e.marks.length > EDIT_LIMITS.maxMarks) out.push(`Up to ${EDIT_LIMITS.maxMarks} texts, tags and flaws.`);
  for (const m of e.marks) {
    if (!(m.at >= 0) || m.at > total) out.push("A text, tag or flaw is outside the video.");
    if (m.kind === "text" && !(m.text ?? "").trim()) out.push("A text is empty.");
    if ((m.text ?? "").length > EDIT_LIMITS.maxText) out.push(`Keep texts under ${EDIT_LIMITS.maxText} characters.`);
    if (m.kind === "tag" && !m.productId) out.push("A tag has no item.");
  }
  if (!(e.cover >= 0) || e.cover > total) out.push("Pick a cover from the video.");
  return [...new Set(out)];
}
