const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MINUS = "−";

/** "20261016" -> "16 Oct" */
export const fmtDate = (d: string) => `${+d.slice(6, 8)} ${MONTHS[+d.slice(4, 6) - 1]}`;
/** "2026-10-16" -> "20261016" */
export const iso2key = (s: string) => s.replaceAll("-", "");
export const key2iso = (k: string) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6)}`;
export const fmtIso = (s: string) => fmtDate(iso2key(s));

const nf = (digits = 0) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** Rounded en-GB number with a true minus sign. */
export const num = (x: number, digits = 0) => {
  const s = nf(digits).format(Math.abs(x));
  return x < 0 && s !== nf(digits).format(0) ? `${MINUS}${s}` : s;
};
/** Always signed: +12 / −733 */
export const signed = (x: number, digits = 0) => {
  const s = nf(digits).format(Math.abs(x));
  return `${x < 0 ? MINUS : "+"}${s}`;
};
