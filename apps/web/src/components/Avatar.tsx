/** A round profile photo, or the first letter of the name when there's no photo. */
export function Avatar({ url, name, size, className = "avatar" }: { url?: string | null; name: string; size?: number; className?: string }) {
  const style = size ? { width: size, height: size, fontSize: Math.round(size * 0.42) } : undefined;
  return (
    <span className={`${className} ${url ? "has-photo" : ""}`} style={style} aria-hidden="true">
      {url ? <img src={url} alt="" loading="lazy" /> : (name.replace(/^@/, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}
