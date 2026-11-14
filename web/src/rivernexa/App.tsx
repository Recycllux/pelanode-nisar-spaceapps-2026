import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Box, ChevronRight, Columns2 } from "lucide-react";
import { ASSET_BASE, MODES, OPENING_DATE, ZONES, ZONE_KEYS, type Mode, type Pol, type ZoneKey } from "./config";
import { loadAll, zoneChange, type Data } from "./data";
import { fmtDate, num, signed, MINUS } from "./format";
import { Legend } from "./Legend";
import { MapView, type FlyReq } from "./MapView";
import { STEPS } from "./steps";
import { StatusBadge, Tag, TagKey } from "./Tag";
import { WaterChart } from "./WaterChart";

export default function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Wait (briefly) for the web fonts too: the control bar wraps differently in the fallback font,
    // and swapping fonts after the first paint moved it by ~60 px (layout shift).
    Promise.all([loadAll(), fontsReady(1200)]).then(([d]) => setData(d)).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#map-controls">Skip to map controls</a>
      <Header />
      {error ? (
        <p className="status-msg">The data files could not be loaded ({error}).</p>
      ) : !data ? (
        <p className="status-msg">Loading NISAR data…</p>
      ) : (
        <Atlas data={data} />
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="masthead">
      <div className="brand">
        <img src={`${ASSET_BASE}logo.webp`} alt="RiverNexa" className="brand-logo" width={72} height={32} />
        <span className="ai-label" title="This logo was made with an AI image tool">AI-generated</span>
        <h1 className="sr-only">RiverNexa</h1>
        <p className="brand-sub">NISAR L-band radar shows where the Lower Danube lost its water in 2026</p>
      </div>
      <div className="brand-tags" aria-label="Status labels">
        <Tag kind="real" />
        <Tag kind="sim" />
        <Tag kind="future" />
      </div>
    </header>
  );
}

function Atlas({ data }: { data: Data }) {
  const DATES = data.manifest.zones.delta.dates;
  // Resolve the opening step (?step=…) before the first render, so the first paint already shows
  // that step's layer and legend instead of switching after mount (that switch caused layout shift).
  const [init] = useState(() => {
    const key = new URLSearchParams(window.location.search).get("step");
    const i = Math.max(0, STEPS.findIndex((s) => s.key === key));
    const a = STEPS[i]!.apply;
    const k = a.dateKey === "after" ? data.manifest.zones.delta.after : a.dateKey;
    const j = k ? DATES.indexOf(k) : -1;
    return { i, a, idx: j >= 0 ? j : Math.max(0, DATES.indexOf(OPENING_DATE)) };
  });
  const [step, setStep] = useState(init.i);
  const [mode, setMode] = useState<Mode>(init.a.mode ?? "water");
  const [pol, setPol] = useState<Pol>("hh");
  const [idx, setIdx] = useState(init.idx);
  const [zone, setZone] = useState<ZoneKey>(init.a.zone ?? "delta");
  const [chartZone, setChartZone] = useState<ZoneKey>(init.a.chartZone ?? "delta");
  const [swipe, setSwipe] = useState(!!init.a.swipe);
  const [terrain, setTerrain] = useState(true);
  const [probes, setProbes] = useState(!!init.a.probes);
  const [fly, setFly] = useState<FlyReq>(init.a.fly ? { n: 1, target: init.a.fly } : { n: 0, target: "corridor" });

  const goStep = useCallback(
    (i: number) => {
      const a = STEPS[i]!.apply;
      setStep(i);
      setProbes(!!a.probes);
      if (a.mode) setMode(a.mode);
      if (a.zone) setZone(a.zone);
      if (a.chartZone) setChartZone(a.chartZone);
      if (a.swipe !== undefined) setSwipe(a.swipe);
      if (a.dateKey) {
        const k = a.dateKey === "after" ? data.manifest.zones.delta.after : a.dateKey;
        const j = DATES.indexOf(k);
        if (j >= 0) setIdx(j);
      }
      if (a.fly) setFly((f) => ({ n: f.n + 1, target: a.fly! }));
    },
    [data, DATES],
  );

  const afterKey = DATES[idx] ?? DATES[0]!;
  const zm = data.manifest.zones[zone];
  const beforeKey = zm.before;
  const canSwipe = mode === "water" || mode === "radar";
  const swipeOn = swipe && canSwipe;
  const counterAfter = mode === "lost" || mode === "composite" || mode === "flood" ? zm.after : afterKey;
  const change = zoneChange(data.area, zone, beforeKey, counterAfter);
  const Body = STEPS[step]!.Body;
  // One debounced announcement instead of a live region that speaks on every slider step.
  const said = useDebounced(
    change ? `${signed(change.dv)} square kilometres of water in ${ZONES[zone].name}, ${fmtDate(beforeKey)} to ${fmtDate(counterAfter)}` : "",
    700,
  );

  return (
    <main className="atlas">
      <aside className="story-col" aria-label="Story">
        <nav aria-label="Story steps">
          <p className="ctl-label">Story · 8 steps</p>
          <ol className="step-index">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <button aria-current={i === step ? "step" : undefined} onClick={() => goStep(i)}>
                  <span className="num">{String(i + 1).padStart(2, "0")}</span>
                  <span className="step-title">{s.title}</span>
                  <ChevronRight size={15} aria-hidden className="step-arrow" />
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <TagKey />

        <article key={step} className="story fade-in">
          <Body d={data} />
          {step < STEPS.length - 1 && (
            <button type="button" className="next-step" onClick={() => goStep(step + 1)}>
              Next: {STEPS[step + 1]!.title} <ArrowRight size={16} aria-hidden />
            </button>
          )}
        </article>

        <section className="chart-section" aria-labelledby="chart-title">
          <div className="chart-head">
            <h3 id="chart-title">Water area vs river level</h3>
            <label className="sr-only" htmlFor="chart-zone">Zone for chart</label>
            <select id="chart-zone" value={chartZone} onChange={(e) => setChartZone(e.target.value as ZoneKey)}>
              {ZONE_KEYS.map((z) => <option key={z} value={z}>{ZONES[z].name}</option>)}
            </select>
          </div>
          <WaterChart data={data} zone={chartZone} dateKey={afterKey} />
          <p className="note">
            Red bands: days the gauge was below its official low-water mark. Water areas from NISAR (L-band) and Sentinel-1
            (C-band, open water only, windy dates left out) <Tag kind="real" />, levels from DanubeAlert <Tag kind="real" />.
            Correlation, not proof of cause.
          </p>
        </section>
      </aside>

      <section className="map-col" aria-label="Map and controls">
        <MapView
          data={data}
          mode={mode}
          pol={pol}
          afterKey={afterKey}
          beforeKey={beforeKey}
          swipeOn={swipeOn}
          terrain={terrain}
          probes={probes}
          fly={fly}
          onCenterZone={setZone}
          beforeLabel={`◀ ${fmtDate(beforeKey)} (before)`}
          afterLabel={`${fmtDate(afterKey)} ▶`}
        >
          {change && (
            <div className="counter">
              <div className={`counter-num num ${change.dv < 0 ? "text-lost-ink" : "text-veg-ink"}`}>
                {signed(change.dv)} <span className="counter-unit">km²</span>
              </div>
              <p className="counter-sub">
                water in {ZONES[zone].name}, {fmtDate(beforeKey)} → {fmtDate(counterAfter)}{" "}
                <span className="num">({change.pct > 0 ? "+" : change.pct < 0 ? MINUS : ""}{Math.abs(change.pct)}%)</span>
              </p>
              <p className="counter-sub">
                under vegetation <span className="num">{num(change.vegBefore)} → {num(change.vegAfter)} km²</span>{" "}
                <Tag kind="real" />
              </p>
            </div>
          )}
          <p className="sr-only" aria-live="polite">{said}</p>
        </MapView>

        <div className="controlbar" id="map-controls" tabIndex={-1}>
          <div className="controlbar-row controls">
            <div className="ctl-group">
              <span className="ctl-label" id="lbl-layer">Map layer</span>
              <div className="seg seg-layer" role="group" aria-labelledby="lbl-layer">
                {MODES.map((m) => (
                  <button key={m.key} type="button" aria-pressed={mode === m.key} onClick={() => setMode(m.key)}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ctl-group">
              <span className="ctl-label" id="lbl-pol">Radar band</span>
              <div className="seg" role="group" aria-labelledby="lbl-pol">
                {(["hh", "hv"] as Pol[]).map((p) => (
                  <button key={p} type="button" aria-pressed={pol === p} onClick={() => setPol(p)}>
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="ctl-group">
              <span className="ctl-label">View</span>
              <div className="ctl-row">
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={swipeOn}
                  disabled={!canSwipe}
                  onClick={() => setSwipe((s) => !s)}
                  title={canSwipe ? "Compare the before date with the selected date" : "Swipe works in Water and Radar only modes"}
                >
                  <Columns2 size={15} aria-hidden /> Swipe compare <span className="switch-track" aria-hidden><span /></span>
                </button>
                <button type="button" className="switch" role="switch" aria-checked={terrain} onClick={() => setTerrain((t) => !t)}>
                  <Box size={15} aria-hidden /> 3D terrain <span className="switch-track" aria-hidden><span /></span>
                </button>
              </div>
            </div>
          </div>

          <div className="controlbar-row timeline">
            <label htmlFor="date-slider" className="sr-only">NISAR date</label>
            <input
              id="date-slider"
              type="range"
              min={0}
              max={DATES.length - 1}
              step={1}
              value={idx}
              onChange={(e) => setIdx(+e.target.value)}
              aria-valuetext={`${fmtDate(afterKey)} ${afterKey.slice(0, 4)}`}
            />
            <div className="ticks" aria-hidden>
              {DATES.map((d) => <span key={d}>{fmtDate(d)}</span>)}
            </div>
            <div className="date-line">
              <span className="num">NISAR {fmtDate(afterKey)} {afterKey.slice(0, 4)} · track 065 descending</span>
              <StatusBadge status={zm.status[afterKey]} />
              {afterKey === "20260817" && <span className="gap-note">No NISAR data 24 Jul – 17 Aug on this track</span>}
            </div>
          </div>

          <Legend mode={mode} pol={pol} />
        </div>
      </section>

    </main>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Resolve once the above-the-fold fonts have loaded, or after `ms` at most (never blocks for long). */
function fontsReady(ms: number): Promise<void> {
  if (!("fonts" in document)) return Promise.resolve();
  const faces = ['400 15px "IBM Plex Sans"', '500 13px "IBM Plex Sans"', '600 13px "IBM Plex Sans"', '500 10px "IBM Plex Mono"', '600 28px "Source Serif 4"'];
  const all = Promise.all(faces.map((f) => document.fonts.load(f))).then(() => undefined, () => undefined);
  return Promise.race([all, new Promise<void>((r) => setTimeout(r, ms))]);
}
