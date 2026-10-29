// Saves an unfinished listing on this phone so a seller can stop halfway and come back.
// Text goes in localStorage; the photos and video go in IndexedDB. Everything is wrapped so a blocked
// or private browser simply has no drafts.

export interface DraftFields {
  title: string; label: string; condition: string | null; price: string; stock: number; sizes: string[];
  leadDays: number; allergens: string; description: string; caption: string; step: number; savedAt: string;
}

const key = (userId: string) => `lsa-draft:${userId}`;

export function loadDraft(userId: string): DraftFields | null {
  try { const raw = localStorage.getItem(key(userId)); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveDraft(userId: string, d: DraftFields) {
  try { localStorage.setItem(key(userId), JSON.stringify(d)); } catch { /* storage blocked */ }
}

function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open("lsa-drafts", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("media");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
export async function saveDraftMedia(userId: string, files: File[]) {
  try {
    const d = await db();
    await new Promise((ok, no) => { const t = d.transaction("media", "readwrite"); t.objectStore("media").put(files, userId); t.oncomplete = ok; t.onerror = no; });
  } catch { /* no IndexedDB */ }
}
export async function loadDraftMedia(userId: string): Promise<File[]> {
  try {
    const d = await db();
    return await new Promise((ok) => { const r = d.transaction("media").objectStore("media").get(userId); r.onsuccess = () => ok((r.result as File[]) ?? []); r.onerror = () => ok([]); });
  } catch { return []; }
}
export async function clearDraft(userId: string) {
  try { localStorage.removeItem(key(userId)); } catch { /* ignore */ }
  try { const d = await db(); d.transaction("media", "readwrite").objectStore("media").delete(userId); } catch { /* ignore */ }
}

/** A small JPEG of a photo, or of a frame from a video, for the AI suggestions. */
export async function snapshot(file: File, max = 768): Promise<Blob | null> {
  try {
    const url = URL.createObjectURL(file);
    let src: CanvasImageSource; let w: number; let h: number;
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.src = url;
      await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = no; });
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
      await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 1500); });
      src = v; w = v.videoWidth; h = v.videoHeight;
    } else {
      const img = new Image();
      img.src = url;
      await img.decode();
      src = img; w = img.naturalWidth; h = img.naturalHeight;
    }
    if (!w || !h) return null;
    const scale = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return await new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", 0.85));
  } catch { return null; }
}
