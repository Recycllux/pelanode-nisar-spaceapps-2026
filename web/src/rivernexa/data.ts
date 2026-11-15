import { DATA_BASE, type ZoneKey } from "./config";
import { iso2key } from "./format";

/* ---------- file shapes (only the fields the UI reads) ---------- */
export type ZoneManifest = {
  dates: string[];
  before: string;
  after: string;
  gauge: string;
  coordinates: [number, number][];
  radar_coordinates?: [number, number][];
  status: Record<string, string>;
};
export type Manifest = { zones: Record<ZoneKey, ZoneManifest> };
export type AreaRow = {
  zone: string;
  date: string;
  status: string;
  open_water_km2: number;
  under_vegetation_km2: number;
  total_water_km2: number;
};
export type Station = {
  enr_cm?: number;
  dates: string[];
  level_cm: (number | null)[];
  stage: (number | null)[];
  p50: (number | null)[];
};
export type River = { stations: Record<string, Station> };
export type Analysis = {
  flood_threshold?: { km2: number; median_cm: number };
  lag?: { lag_days: number; rho_total: number; rho_under_veg: number }[];
};
export type Metric = { area_mae_km2: number };
export type Forecast = {
  metrics: Record<string, Metric>;
  forecast: {
    date: string;
    from_date: string;
    last_observed_km2: number;
    p10_km2: number;
    p50_km2: number;
    p90_km2: number;
  };
};
export type S1 = {
  track?: string;
  source?: string;
  series?: Record<string, { dates: string[]; open_water_km2: (number | null)[]; flag_wind: boolean[] }>;
  years?: Record<string, { median_km2: number; min_level_cm: number | null }>;
  validation?: { zone: string; days_apart: number; iou: number }[];
};
export type S1Forecast = { years_train?: string; tests?: Record<string, { metrics: Record<string, Metric> }> };
export type ProbeFC = {
  type: "FeatureCollection";
  features: { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: { label: string; text: string } }[];
};
export type EvidenceItem = {
  title: string;
  text: string;
  date?: string;
  source?: string;
  url?: string;
  also_source?: string;
  also_url?: string;
};
export type Evidence = { checked_by?: string; items?: EvidenceItem[] };

/** 500 m cells: [lon, lat, total water % per date..., water-under-vegetation % per date...]. */
export type Pulse = {
  dates: string[];
  cell_m: number;
  zones: Partial<Record<ZoneKey, { east: [number, number]; north: [number, number]; cells: number[][] }>>;
};

/** Smoothed neon change layers (G3): one WebP per zone and date, on these corners. */
export type Glow = { zones: Partial<Record<ZoneKey, { dates: string[]; coordinates: [number, number][] }>> };

/** Decision framework (docs/data/decisions.json): thresholds per parameter and actions per actor. */
export type Decisions = {
  source: string;
  disclaimer: string;
  parameters: { key: string; name: string; question: string; measure: string;
    thresholds: { alert: string; kind: string; text: string }[]; sources: [string, string][] }[];
  actors: { key: string; name: string }[];
  actions: Record<string, Record<string, [string, string]>>;
};

export type AreaIndex = Partial<Record<string, Record<string, AreaRow>>>;

export type Data = {
  manifest: Manifest;
  area: AreaIndex;
  river: River;
  probes: ProbeFC | null;
  evidence: Evidence | null;
  analysis: Analysis | null;
  forecast: Forecast | null;
  s1: S1 | null;
  s1fc: S1Forecast | null;
  pulse: Pulse | null;
  glow: Glow | null;
  decisions: Decisions | null;
};

export const dataUrl = (path: string) => `${DATA_BASE}${path}`;

async function getJSON<T>(path: string, optional = false): Promise<T | null> {
  try {
    const r = await fetch(dataUrl(path));
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    if (optional) return null;
    throw e;
  }
}

export function parseCSV(text: string): Record<string, string | number>[] {
  const [head = "", ...rows] = text.trim().split(/\r?\n/);
  const keys = head.split(",");
  return rows.map((r) =>
    Object.fromEntries(r.split(",").map((v, i) => [keys[i], v === "" || isNaN(+v) ? v : +v])),
  );
}

export function indexAreas(rows: Record<string, string | number>[]): AreaIndex {
  const out: AreaIndex = {};
  for (const r of rows) {
    const row = r as unknown as AreaRow;
    (out[row.zone] ??= {})[iso2key(String(row.date))] = row;
  }
  return out;
}

export async function loadAll(): Promise<Data> {
  const csv = fetch(dataUrl("areas.csv")).then((r) => {
    if (!r.ok) throw new Error(`areas.csv: ${r.status}`);
    return r.text();
  });
  const [manifest, areaText, river, probes, evidence, analysis, forecast, s1, s1fc, pulse, glow, decisions] = await Promise.all([
    getJSON<Manifest>("manifest.json"),
    csv,
    getJSON<River>("river.json"),
    getJSON<ProbeFC>("probes.json", true),
    getJSON<Evidence>("evidence.json", true),
    getJSON<Analysis>("analysis.json", true),
    getJSON<Forecast>("forecast.json", true),
    getJSON<S1>("s1.json", true),
    getJSON<S1Forecast>("s1_forecast.json", true),
    getJSON<Pulse>("pulse.json", true),
    getJSON<Glow>("glow.json", true),
    getJSON<Decisions>("decisions.json", true),
  ]);
  return {
    manifest: manifest!,
    area: indexAreas(parseCSV(areaText)),
    river: river!,
    probes,
    evidence,
    analysis,
    forecast,
    s1,
    s1fc,
    pulse,
    glow,
    decisions,
  };
}

/* ---------- derived figures (all computed from the files) ---------- */

export function vegHeadline(area: AreaIndex, zone: ZoneManifest) {
  const B = area["delta"]?.[zone.before];
  const A = area["delta"]?.[zone.after];
  if (!A || !B) return null;
  const lost = B.under_vegetation_km2 - A.under_vegetation_km2;
  return {
    before: zone.before,
    after: zone.after,
    vegBefore: B.under_vegetation_km2,
    vegAfter: A.under_vegetation_km2,
    openBefore: B.open_water_km2,
    openAfter: A.open_water_km2,
    lost,
    pct: Math.round((100 * lost) / B.under_vegetation_km2),
  };
}

export function gaugeSummary(st: Station | undefined, from = "2026-06-01") {
  if (!st) return null;
  const rows = st.dates
    .map((d, i) => ({ d, l: st.level_cm[i], s: st.stage[i] }))
    .filter((r) => r.d >= from && r.l != null) as { d: string; l: number; s: number | null }[];
  if (!rows.length) return null;
  const enr = st.enr_cm != null ? Number(st.enr_cm) : null;
  const min = rows.reduce((m, r) => (r.l < m.l ? r : m));
  return {
    enr,
    belowEnr: enr != null ? rows.filter((r) => r.l < enr).length : null,
    minCm: min.l,
    minDate: min.d,
    recordDays: rows.filter((r) => r.s === 4).length,
  };
}

export function bestLag(a: Analysis | null) {
  if (!a?.lag?.length) return null;
  return a.lag.reduce((m, r) => (r.rho_under_veg > m.rho_under_veg ? r : m));
}

export function yearRanking(s1: S1 | null, focus = 2026) {
  if (!s1?.years) return null;
  const rows = Object.entries(s1.years)
    .map(([y, r]) => ({ year: +y, median: r.median_km2, minLevel: r.min_level_cm }))
    .sort((a, b) => a.year - b.year);
  const sorted = [...rows].sort((a, b) => a.median - b.median);
  const idx = sorted.findIndex((r) => r.year === focus);
  return { rows, rank: idx >= 0 ? idx + 1 : null, n: rows.length };
}

export function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function overlapCheck(s1: S1 | null, zone = "delta") {
  const rows = s1?.validation?.filter((r) => r.zone === zone) ?? [];
  if (!rows.length) return null;
  const days = rows.map((r) => r.days_apart);
  return {
    iou: median(rows.map((r) => r.iou)),
    n: rows.length,
    minDays: Math.min(...days),
    maxDays: Math.max(...days),
  };
}

/** km² counter: total water change for a zone between two date keys. */
export function zoneChange(area: AreaIndex, zone: string, before: string, after: string) {
  const B = area[zone]?.[before];
  const A = area[zone]?.[after];
  if (!A || !B) return null;
  const dv = A.total_water_km2 - B.total_water_km2;
  return {
    dv,
    pct: B.total_water_km2 ? Math.round((100 * dv) / B.total_water_km2) : 0,
    vegBefore: B.under_vegetation_km2,
    vegAfter: A.under_vegetation_km2,
  };
}

/** Sentinel-1 open water by ISO date, windy dates dropped. */
export function s1OpenWater(s1: S1 | null, zone: string): Record<string, number> | null {
  const S = s1?.series?.[zone];
  if (!S) return null;
  const m: Record<string, number> = {};
  S.dates.forEach((d, i) => {
    const v = S.open_water_km2[i];
    if (!S.flag_wind[i] && v != null) m[d] = v;
  });
  return m;
}
