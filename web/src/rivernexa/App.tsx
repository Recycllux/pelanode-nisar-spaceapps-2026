import { useCallback, useEffect, useState } from "react";
import { Box, Columns2 } from "lucide-react";
import { ASSET_BASE, MODES, OPENING_DATE, ZONES, ZONE_KEYS, type Mode, type Pol, type ZoneKey } from "./config";
import { loadAll, zoneChange, type Data } from "./data";
import { fmtDate, num, signed, MINUS } from "./format";
import { Legend } from "./Legend";
import { MapView, type FlyReq } from "./MapView";
import { STEPS } from "./steps";
import { StatusBadge, Tag } from "./Tag";
import { WaterChart } from "./WaterChart";

export default function App() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadAll().then(setData).catch((e) => setError(String(e?.message ?? e)));
  }, []);

  return (
    <div className="app">
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
        <img src={`${ASSET_BASE}logo.png`} alt="RiverNexa logo" className="brand-logo" />
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
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<Mode>("water");
  const [pol, setPol] = useState<Pol>("hh");
  const [idx, setIdx] = useState(Math.max(0, DATES.indexOf(OPENING_DATE)));
  const [zone, setZone] = useState<ZoneKey>("delta");
  const [chartZone, setChartZone] = useState<ZoneKey>("delta");
  const [swipe, setSwipe] = useState(false);
  const [terrain, setTerrain] = useState(true);
  const [probes, setProbes] = useState(false);
  const [fly, setFly] = useState<FlyReq>({ n: 0, target: "corridor" });

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

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("step");
    goStep(Math.max(0, STEPS.findIndex((s) => s.key === key)));
  }, [goStep]);

  const afterKey = DATES[idx] ?? DATES[0]!;
  const zm = data.manifest.zones[zone];
  const beforeKey = zm.before;
  const canSwipe = mode === "water" || mode === "radar";
  const swipeOn = swipe && canSwipe;
  const counterAfter = mode === "lost" || mode === "composite" || mode === "flood" ? zm.after : afterKey;
  const change = zoneChange(data.area, zone, beforeKey, counterAfter);
  const Body = STEPS[step]!.Body;

  return (
    <main className="atlas">
      <section className="map-col" aria-label="Map">
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
            <div className="counter" aria-live="polite">
              <div className={`counter-num num ${change.dv < 0 ? "text-lost" : "text-veg"}`}>
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
        </MapView>

        <div className="controlbar">
          <div className="controlbar-row scroll-x">
            <div className="seg" role="radiogroup" aria-label="Map layer">
              {MODES.map((m) => (
                <button key={m.key} role="radio" aria-checked={mode === m.key} onClick={() => setMode(m.key)}>
                  {m.label}
                </button>
              ))}
            </div>
            <div className="seg" role="radiogroup" aria-label="Radar polarisation">
              {(["hh", "hv"] as Pol[]).map((p) => (
                <button key={p} role="radio" aria-checked={pol === p} onClick={() => setPol(p)}>
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              className="toggle"
              aria-pressed={swipeOn}
              disabled={!canSwipe}
              onClick={() => setSwipe((s) => !s)}
              title={canSwipe ? "Swipe before / after" : "Swipe works in Water and Radar modes"}
            >
              <Columns2 size={14} aria-hidden /> Swipe before / after
            </button>
            <button className="toggle" aria-pressed={terrain} onClick={() => setTerrain((t) => !t)}>
              <Box size={14} aria-hidden /> 3D
            </button>
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

      <aside className="story-col" aria-label="Story">
        <nav aria-label="Story steps">
          <ol className="step-index">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <button aria-current={i === step ? "step" : undefined} onClick={() => goStep(i)}>
                  <span className="num">{String(i + 1).padStart(2, "0")}</span> {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article key={step} className="story fade-in">
          <Body d={data} />
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
    </main>
  );
}
