// GENERATED from packages/core/src by npm run sync-core. Do not edit here.
// All money is stored and calculated in cents (integers) to avoid rounding errors.
export type Cents = number;

export const rand = (r: number): Cents => Math.round(r * 100);

/** Formats cents as rand, e.g. 34900 -> "R349", 34950 -> "R349.50". */
export function formatRand(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const part = abs % 100;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return part === 0 ? `${sign}R${wholeText}` : `${sign}R${wholeText}.${part.toString().padStart(2, "0")}`;
}

/** Rounds to the nearest whole rand, in cents. */
export const roundToRand = (cents: Cents): Cents => Math.round(cents / 100) * 100;
