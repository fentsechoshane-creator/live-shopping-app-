import { useId, type ReactNode } from "react";

/**
 * Demo stand in media. Each product gets a lit product shot drawn in SVG, with slow camera
 * movement on the feed so it reads like a seller video. Real sellers upload real video (Mux).
 */
export type SceneKind = "tee" | "denim" | "shirt" | "cake" | "runner";

const BY_PRODUCT: Record<string, SceneKind> = { "p-tee": "tee", "p-denim": "denim", "p-auction": "denim", "p-shirt": "shirt", "p-cake": "cake", "p-runner": "runner" };
export const sceneFor = (productId: string): SceneKind | null => BY_PRODUCT[productId] ?? null;

const ROOM: Record<SceneKind, { wall: [string, string]; floor: string; light: string }> = {
  tee: { wall: ["#efe4d6", "#c9b49a"], floor: "#b59c7e", light: "#fff6e8" },
  denim: { wall: ["#d9dde2", "#9aa4b0"], floor: "#7d8894", light: "#ffffff" },
  shirt: { wall: ["#6b7590", "#46506a"], floor: "#535d72", light: "#dbe4ff" },
  cake: { wall: ["#f6dfe0", "#d9a9ad"], floor: "#e9d3c4", light: "#fff3ea" },
  runner: { wall: ["#e3e8e2", "#aab6ad"], floor: "#c7d0c8", light: "#ffffff" },
};

/** `thumb` crops to the product, so small tiles are not mostly floor. */
export function Scene({ kind, animated = false, label, thumb = false }: { kind: SceneKind; animated?: boolean; label?: string; thumb?: boolean }) {
  const id = useId().replace(/:/g, "");
  const r = ROOM[kind];
  return (
    <svg className={`scene ${animated ? "live" : ""}`} viewBox={thumb ? "20 80 320 420" : "0 0 360 640"} preserveAspectRatio="xMidYMid slice"
      role="img" aria-label={label ?? `${kind} product shot`}>
      <defs>
        <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={r.wall[0]} /><stop offset="1" stopColor={r.wall[1]} /></linearGradient>
        <radialGradient id={`${id}l`} cx="0.3" cy="0.22" r="0.6"><stop offset="0" stopColor={r.light} stopOpacity="0.85" /><stop offset="1" stopColor={r.light} stopOpacity="0" /></radialGradient>
        <radialGradient id={`${id}s`} cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#000" stopOpacity="0.35" /><stop offset="1" stopColor="#000" stopOpacity="0" /></radialGradient>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.28" /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.22" /></linearGradient>
      </defs>
      <g className="cam">
        <rect width="360" height="640" fill={`url(#${id}w)`} />
        {/* window light falling on the wall */}
        <path d="M-20 0 L150 0 L250 520 L40 520 Z" fill={r.light} opacity={kind === "shirt" ? 0.06 : 0.22} />
        <rect width="360" height="640" fill={`url(#${id}l)`} />
        <rect y="470" width="360" height="170" fill={r.floor} />
        <rect y="470" width="360" height="3" fill="#000" opacity="0.08" />
        <g className="bokeh" fill={r.light}>
          <circle cx="300" cy="90" r="26" opacity="0.18" /><circle cx="40" cy="380" r="18" opacity="0.14" /><circle cx="330" cy="300" r="12" opacity="0.2" />
        </g>
        <ellipse cx="180" cy={kind === "cake" || kind === "runner" ? 470 : 486} rx="120" ry="16" fill={`url(#${id}s)`} />
        {PRODUCT[kind](id)}
      </g>
    </svg>
  );
}

const sheen = (id: string) => `url(#${id}f)`;

const PRODUCT: Record<SceneKind, (id: string) => ReactNode> = {
  tee: (id) => (
    <g className="sway">
      <Hanger />
      <path d="M150 165 Q180 184 210 165 L262 180 L302 232 L268 258 L250 240 L252 424 Q180 434 108 424 L110 240 L92 258 L58 232 L98 180 Z" fill="#d6bf9f" />
      <path d="M150 165 Q180 184 210 165 L262 180 L302 232 L268 258 L250 240 L252 424 Q180 434 108 424 L110 240 L92 258 L58 232 L98 180 Z" fill={sheen(id)} />
      <path d="M150 165 Q180 192 210 165" fill="none" stroke="#b49c7b" strokeWidth="6" strokeLinecap="round" />
      <path d="M150 300 Q165 340 150 400 M215 270 Q205 330 222 410 M110 240 L250 240" fill="none" stroke="#a88f6e" strokeWidth="2" opacity="0.45" />
      <path d="M108 410 Q180 420 252 410" fill="none" stroke="#a88f6e" strokeWidth="2" opacity="0.5" />
    </g>
  ),
  denim: (id) => (
    <g className="sway">
      <Hanger />
      <path d="M150 160 Q180 174 210 160 L258 172 Q286 186 292 222 L302 402 L272 406 L262 252 L258 424 L102 424 L98 252 L88 406 L58 402 L68 222 Q74 186 102 172 Z" fill="#46688f" />
      <path d="M150 160 Q180 174 210 160 L258 172 Q286 186 292 222 L302 402 L272 406 L262 252 L258 424 L102 424 L98 252 L88 406 L58 402 L68 222 Q74 186 102 172 Z" fill={sheen(id)} />
      <path d="M150 160 L180 210 L210 160 L222 196 L190 226 L180 210 L170 226 L138 196 Z" fill="#3b5a7e" />
      <line x1="180" y1="212" x2="180" y2="424" stroke="#2f4a69" strokeWidth="2" />
      <g fill="#c4a15a">{[240, 280, 320, 360, 400].map((y) => <circle key={y} cx="186" cy={y} r="3.5" />)}</g>
      <g fill="none" stroke="#d39a4a" strokeWidth="1.6" strokeDasharray="4 3">
        <rect x="118" y="244" width="44" height="40" rx="4" /><rect x="198" y="244" width="44" height="40" rx="4" />
        <path d="M102 384 L258 384" /><path d="M118 258 L162 258 M198 258 L242 258" />
      </g>
      <rect x="62" y="386" width="28" height="14" rx="3" fill="#3b5a7e" /><rect x="270" y="388" width="28" height="14" rx="3" fill="#3b5a7e" />
      <ellipse cx="78" cy="394" rx="6" ry="3" fill="#8fa7c2" opacity="0.8" />
    </g>
  ),
  shirt: (id) => (
    <g className="sway">
      <Hanger light />
      <defs>
        <linearGradient id={`${id}silk`} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="#24406b" /><stop offset="0.35" stopColor="#5d7fb3" /><stop offset="0.5" stopColor="#2a4875" /><stop offset="0.75" stopColor="#6a8cbf" /><stop offset="1" stopColor="#1c3357" />
        </linearGradient>
      </defs>
      <path d="M150 160 Q180 172 210 160 L256 174 Q282 190 288 226 L298 404 L270 408 L260 254 L256 430 Q180 440 104 430 L100 254 L90 408 L62 404 L72 226 Q78 190 104 174 Z" fill={`url(#${id}silk)`} />
      <path d="M150 160 L178 208 L162 214 L140 184 Z M210 160 L182 208 L198 214 L220 184 Z" fill="#1c3357" />
      <line x1="180" y1="208" x2="180" y2="432" stroke="#1a2f50" strokeWidth="2" />
      <g fill="#e8eefb">{[236, 276, 316, 356, 396].map((y) => <circle key={y} cx="180" cy={y} r="3" />)}</g>
      <path d="M130 230 Q150 320 128 420 M232 230 Q214 320 236 420" fill="none" stroke="#9fb6dc" strokeWidth="3" opacity="0.35" />
    </g>
  ),
  cake: () => (
    <g>
      <path d="M150 470 L160 446 L200 446 L210 470 Z" fill="#e8e1da" />
      <ellipse cx="180" cy="444" rx="112" ry="16" fill="#f4efe9" /><ellipse cx="180" cy="440" rx="112" ry="16" fill="#fffaf5" />
      <path d="M96 300 L96 418 Q180 446 264 418 L264 300 Z" fill="#f7e6d6" />
      <path d="M96 360 Q180 384 264 360 L264 368 Q180 392 96 368 Z" fill="#e7a7ae" />
      <ellipse cx="180" cy="300" rx="84" ry="20" fill="#5a3426" />
      <path d="M96 300 Q100 330 108 316 Q116 340 124 318 Q134 350 144 322 Q156 336 166 320 Q176 352 188 322 Q198 340 210 320 Q222 346 232 318 Q242 334 252 316 Q258 330 264 300" fill="#5a3426" />
      <g fill="#c8303f">{[[150, 294], [176, 288], [204, 294], [190, 302], [162, 304]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="8" />)}</g>
      <g fill="#fff" opacity="0.6">{[[148, 290], [174, 284], [202, 290]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2" />)}</g>
      <g>{[150, 180, 210].map((x, i) => (
        <g key={x}>
          <rect x={x - 3} y={240 + (i === 1 ? -8 : 0)} width="6" height="44" rx="2" fill={["#f4c95d", "#8fd3c8", "#f4a3c0"][i]} />
          <path className="flame" d={`M${x} ${226 + (i === 1 ? -8 : 0)} q7 9 0 15 q-7 -6 0 -15 Z`} fill="#ffb12e" style={{ transformOrigin: `${x}px ${240 + (i === 1 ? -8 : 0)}px` }} />
        </g>
      ))}</g>
    </g>
  ),
  runner: () => (
    <g className="float">
      <rect x="70" y="430" width="220" height="40" rx="6" fill="#f2f4f1" /><rect x="70" y="430" width="220" height="6" fill="#fff" />
      <g transform="translate(0 6)">
        <path d="M66 404 Q58 366 88 356 L292 356 Q314 360 310 398 Q304 424 274 424 L92 424 Q68 422 66 404 Z" fill="#f4f4f2" />
        <path d="M70 396 L308 396" stroke="#d6d8d4" strokeWidth="3" />
        <path d="M80 410 L300 410" stroke="#e1e3df" strokeWidth="2" />
        <path d="M90 356 Q98 300 150 288 L190 260 Q216 250 234 270 L252 300 Q292 318 294 356 Z" fill="#fbfbfa" />
        <path d="M90 356 Q100 320 140 316 L180 340 L260 340 Q285 344 294 356 Z" fill="#dfe3e0" />
        <path d="M196 262 Q214 256 230 272 L246 300 L214 304 Z" fill="#e9ecea" />
        <g stroke="#c9ceca" strokeWidth="3" strokeLinecap="round">
          <line x1="168" y1="286" x2="188" y2="300" /><line x1="180" y1="276" x2="200" y2="290" /><line x1="192" y1="268" x2="212" y2="282" />
        </g>
        <ellipse cx="270" cy="372" rx="14" ry="6" fill="#cfd5d1" />
      </g>
    </g>
  ),
};

function Hanger({ light }: { light?: boolean }) {
  const c = light ? "#c9ced8" : "#6b5a48";
  return (
    <g fill="none" stroke={c} strokeWidth="4" strokeLinecap="round">
      <path d="M180 150 L180 136 Q180 124 190 122 Q200 118 198 106 Q194 96 184 98" />
      <path d="M108 176 L180 148 L252 176" />
    </g>
  );
}

/** Small product picture for tiles, rows and chips. Falls back to a colour swatch. */
export function ProductArt({ productId, fallback }: { productId: string; fallback: string }) {
  const kind = sceneFor(productId);
  return kind ? <Scene kind={kind} thumb /> : <span style={{ position: "absolute", inset: 0, background: `linear-gradient(160deg, ${fallback}, #111)` }} />;
}
