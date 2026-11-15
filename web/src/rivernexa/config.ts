/** All data and brand assets load through these two bases (see .env.development). */
export const DATA_BASE: string = import.meta.env["VITE_DATA_BASE"] ?? "./data/";
export const ASSET_BASE: string = import.meta.env["VITE_ASSET_BASE"] ?? "./";

export type ZoneKey = "delta" | "cernavoda" | "balta_mica_brailei";
export type Mode = "pulse" | "water" | "lost" | "composite" | "radar" | "flood";
export type Pol = "hh" | "hv";

export const ZONES: Record<
  ZoneKey,
  { name: string; short: string; center: [number, number]; zoom: number; pitch: number; bearing: number }
> = {
  delta: { name: "Danube Delta", short: "Delta", center: [29.17, 45.12], zoom: 9.3, pitch: 50, bearing: -12 },
  cernavoda: { name: "Cernavodă", short: "Cernavodă", center: [28.05, 44.335], zoom: 11.6, pitch: 45, bearing: 20 },
  balta_mica_brailei: { name: "Balta Mică a Brăilei", short: "Balta Mică", center: [27.975, 45.075], zoom: 10.2, pitch: 45, bearing: 0 },
};
export const ZONE_KEYS = Object.keys(ZONES) as ZoneKey[];
export const CORRIDOR: [[number, number], [number, number]] = [[27.85, 44.2], [29.75, 45.5]];

export const MODES: { key: Mode; label: string }[] = [
  { key: "pulse", label: "Water pulse" },
  { key: "water", label: "Water" },
  { key: "lost", label: "Lost water" },
  { key: "composite", label: "Colour composite" },
  { key: "radar", label: "Radar only" },
  { key: "flood", label: "Flood threshold" },
];

/** Hex mirrors of the CSS data tokens, for canvas (chart.js) and maplibre paint. */
export const COLORS = {
  water: "#00e5ff",
  waterLine: "#00e5ff",
  veg: "#ffd60a",
  vegLine: "#ffd60a",
  lost: "#ff2ec4",
  lostLine: "#ff2ec4",
  level: "#e8e4dc",
  median: "#9b978e",
  s1: "#cbb98e",
  amber: "#d4a12a",
  neutral: "#5e646e",
  accent: "#6fd3bd",
  grid: "#2a2b2e",
  tick: "#a9a59c",
  sim: "#d9a54a",
};

/** Neon change colours of the Water pulse layer (must match pipeline/g3_glow.py). */
export const GLOW = { kept: "#00e5ff", lost: "#ff2ec4", gained: "#aaff28" };
/** Hover chart lines: all water vs water under reeds. */
export const SPARK = { all: "#00e5ff", veg: "#ffd60a" };

export const OPENING_DATE = "20261016";
export const OPERA_CREDIT =
  "OPERA L2 RTC-S1, NASA JPL OPERA, ASF DAAC. Contains modified Copernicus Sentinel data.";
