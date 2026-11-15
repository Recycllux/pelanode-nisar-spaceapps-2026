import { OPERA_CREDIT, type Mode, type ZoneKey } from "./config";
import { bestLag, gaugeSummary, overlapCheck, vegHeadline, yearRanking, type Data, type EvidenceItem } from "./data";
import { fmtDate, fmtIso, key2iso, num, signed, MINUS } from "./format";
import { Tag } from "./Tag";
import { YearRanking } from "./YearRanking";
import { Decide, type DecideCtx } from "./Decide";

export type StepApply = {
  mode?: Mode;
  zone?: ZoneKey;
  dateKey?: "after" | string;
  swipe?: boolean;
  fly?: "corridor" | ZoneKey;
  chartZone?: ZoneKey;
  probes?: boolean;
};
export type Step = { key: string; title: string; apply: StepApply; Body: (p: { d: Data; ctx?: DecideCtx }) => React.ReactNode };

const Note = ({ children }: { children: React.ReactNode }) => <p className="note">{children}</p>;

/** Source link(s) for one evidence item, labelled with the publisher name. */
/** Only https links from the data files become clickable (blocks javascript: and similar URLs). */
const safeUrl = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);

function Sources({ e }: { e: EvidenceItem }) {
  const url = safeUrl(e.url);
  const also = safeUrl(e.also_url);
  return (
    <>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer">{e.source ?? "source"}</a>
      )}
      {also && (
        <>
          ,{" "}
          <a href={also} target="_blank" rel="noopener noreferrer">{e.also_source ?? "source"}</a>
        </>
      )}
    </>
  );
}

function Overview({ d }: { d: Data }) {
  const dz = d.manifest.zones.delta;
  const h = vegHeadline(d.area, dz);
  const g = gaugeSummary(d.river.stations["isaccea"]);
  return (
    <>
      <h2>The Danube is running out of water</h2>
      <p>
        NISAR's L-band radar sees through cloud and through reeds. Between {fmtDate(dz.before)} and {fmtDate(dz.after)}{" "}
        {dz.after.slice(0, 4)} it watched the Lower Danube dry out.
      </p>
      {h && (
        <figure className="hero-figure">
          <div className="hero-num num">
            {num(h.vegBefore)} <span aria-label="to">→</span> {num(h.vegAfter)}
            <span className="hero-unit"> km²</span>
          </div>
          <figcaption>
            Water under the Delta's reeds, {fmtDate(h.before)} → {fmtDate(h.after)}:{" "}
            <span className="num text-lost-ink">{signed(-h.lost)} km² ({MINUS}{h.pct}%)</span> <Tag kind="real" />
          </figcaption>
        </figure>
      )}
      {g && (
        <dl className="facts">
          {g.belowEnr != null && (
            <div><dt className="num">{g.belowEnr} days</dt><dd>Isaccea below its low-water mark ({g.enr} cm) since June</dd></div>
          )}
          <div><dt className="num">{num(g.minCm)} cm</dt><dd>lowest Isaccea level, {fmtIso(g.minDate)}</dd></div>
          <div><dt className="num">{g.recordDays} days</dt><dd>below the 2015–2025 minimum for that day</dd></div>
        </dl>
      )}
      <p>On the map, cyan is water still there since 18 June, magenta is water that has gone and lime is new water. Press <b>Play</b> under the map to watch the summer of 2026 unfold, or use the steps above to fly through three places.</p>
      <Note>Designed for the Danube Delta Biosphere Reserve Administration (ARBDD) as an early-warning indicator.</Note>
    </>
  );
}

function Delta({ d, ctx }: { d: Data; ctx?: DecideCtx }) {
  // Follow the dates shown on the map card, so the text and the counter always agree.
  const dz = d.manifest.zones.delta;
  const pick = (k?: string) => (k && d.area["delta"]?.[k] ? k : undefined);
  const h = vegHeadline(d.area, { ...dz, before: pick(ctx?.fromKey) ?? dz.before, after: pick(ctx?.toKey) ?? dz.after });
  if (!h) return <h2>Danube Delta: the water hidden under reeds</h2>;
  return (
    <>
      <h2>Danube Delta: the water hidden under reeds</h2>
      <p>
        Optical satellites see the open lakes and channels, and those barely changed:{" "}
        <span className="num">{num(h.openBefore)} → {num(h.openAfter)} km²</span>.
      </p>
      <p>
        L-band radar sees more. When reeds stand in water, the signal bounces off the water and back up the stems (a
        "double bounce"), so flooded reeds shine in <b>HH</b> but not in <b>HV</b>. That water went from{" "}
        <b className="num">{num(h.vegBefore)}</b> on {fmtDate(h.before)} to <b className="num">{num(h.vegAfter)} km²</b> on {fmtDate(h.after)}.
      </p>
      <p>Drag the white bar to compare {fmtDate(h.before)} with any date, and toggle HH / HV to see the effect.</p>
    </>
  );
}

function Cernavoda({ d }: { d: Data }) {
  const c = d.area["cernavoda"];
  const g = d.river.stations["cernavoda"];
  const lv = (k: string) => g?.level_cm[g.dates.indexOf(key2iso(k))];
  const a = "20260724", b = "20260817";
  const reactor = (d.evidence?.items ?? []).filter((e) => /Cernavod|reactor/.test(e.title));
  return (
    <>
      <h2>Cernavodă: sandbanks in the channel</h2>
      {g && lv(a) != null && lv(b) != null && (
        <p>
          The gauge fell from <span className="num">{lv(a)} cm</span> on {fmtDate(a)} to{" "}
          <span className="num">{lv(b)} cm</span> on {fmtDate(b)}
          {g.enr_cm != null && <> (low-water mark <span className="num">{g.enr_cm} cm</span>)</>}. In the colour composite,
          green specks in the river are sandbanks that turned bright as the water dropped.
        </p>
      )}
      {c && c[a] && c[b] && (
        <p>
          At 20 m pixels the change is small (<span className="num">{num(c[a]!.total_water_km2)} → {num(c[b]!.total_water_km2)} km²</span>{" "}
          in the zone), but it sits right in the shipping channel.
        </p>
      )}
      {reactor.map((e) => (
        <p key={e.title}>
          {e.date && <b>{fmtIso(e.date)}: </b>}
          {e.text} <Sources e={e} />
        </p>
      ))}
      <Note>Data gap: this track has no NISAR acquisition between 24 Jul and 17 Aug; Sentinel-1 in the chart fills it.</Note>
    </>
  );
}

function Balta({ d }: { d: Data }) {
  const z = d.manifest.zones.balta_mica_brailei;
  const b = d.area["balta_mica_brailei"];
  return (
    <>
      <h2>Balta Mică a Brăilei: a control case</h2>
      {b && b[z.before] && b[z.after] && (
        <p>
          Most of this zone is dyked farmland, so river level reaches little of it. Mapped water stays roughly flat:{" "}
          <span className="num">{num(b[z.before]!.total_water_km2)} → {num(b[z.after]!.total_water_km2)} km²</span>.
        </p>
      )}
      <p>
        That contrast matters: the radar is not simply "drying everything". The losses concentrate where the river still
        floods the land, in the Delta.
      </p>
    </>
  );
}

function RiverLevels({ d }: { d: Data }) {
  const best = bestLag(d.analysis);
  const ft = d.analysis?.flood_threshold;
  const rank = yearRanking(d.s1);
  const ov = overlapCheck(d.s1, "delta");
  const nDates = d.manifest.zones.delta.dates.length;
  return (
    <>
      <h2>Water area follows the river</h2>
      <p>The chart below puts the NISAR water area next to the DanubeAlert gauge. Pick a zone to compare.</p>
      <p>Water under the Delta's reeds collapses once Isaccea drops below its low-water mark in early July, and stays low.</p>
      {best && (
        <p>
          <b>Lag:</b> the reed water matches the Isaccea level from about <b className="num">{best.lag_days} days earlier</b>{" "}
          best (Spearman ρ = <span className="num">{best.rho_under_veg.toFixed(2)}</span>, {nDates} dates). A falling gauge
          gives roughly a week of warning. <Tag kind="real" />
        </p>
      )}
      {rank && (
        <section className="sub">
          <h3>Ten years of Sentinel-1</h3>
          <p>
            Typical open water in the Delta, June–November.{" "}
            {rank.rank != null && <>2026 ranks <b>{rank.rank === 1 ? "lowest" : `#${rank.rank}`}</b> of {rank.n} years. </>}
            Open water shrinks only a little; the big loss is under the reeds, which only L-band sees. <Tag kind="real" />
          </p>
          <YearRanking ranking={rank} />
          <Note>
            Median of non-windy Sentinel-1 dates per season; "min" is the lowest Isaccea level on those dates. 2022
            (amber) was the previous big drought.
          </Note>
        </section>
      )}
      {ov && (
        <p>
          <b>NISAR vs Sentinel-1:</b> on {ov.n} near-simultaneous Delta dates ({ov.minDays}–{ov.maxDays} days apart) the
          two open-water maps overlap with a median IoU of <span className="num">{ov.iou.toFixed(2)}</span>. <Tag kind="real" />
        </p>
      )}
      {ft && (
        <p>
          <b>Flooding threshold map</b> (map mode "Flood threshold"): for <span className="num">{num(ft.km2)} km²</span> of
          the Delta we can read the Isaccea level each spot needs to stay wet. Half of that area needs at least{" "}
          <span className="num">{num(Math.round(ft.median_cm))} cm</span> to be wet, a level Isaccea has not reached since
          early July. <Tag kind="real" />
        </p>
      )}
    </>
  );
}

function Why({ d }: { d: Data }) {
  const g = gaugeSummary(d.river.stations["isaccea"]);
  const nG = Object.keys(d.river.stations).length;
  const items = d.evidence?.items ?? [];
  const checker = d.evidence?.checked_by?.split(" (")[0];
  return (
    <>
      <h2>Why it changed</h2>
      <ul className="rules">
        <li>
          <b>Low inflow.</b> All {nG} Romanian gauges from Cernavodă to Tulcea fell below their official low-water marks in
          early July and stayed there. <Tag kind="real" />
        </li>
        {g && (
          <li>
            <b>Record lows.</b> Isaccea spent <span className="num">{g.recordDays} days</span> below the lowest level
            recorded for that day in 2015–2025. <Tag kind="real" />
          </li>
        )}
        {items.map((e) => (
          <li key={e.title}>
            <b>
              {e.date && <span className="num">{fmtIso(e.date)}: </span>}
              {e.title}.
            </b>{" "}
            {e.text} <Sources e={e} />
          </li>
        ))}
      </ul>
      <Note>
        Every external fact is linked to its source{checker ? `, opened and checked by ${checker}` : ""}. River data ©
        DanubeAlert (CC BY 4.0).
      </Note>
    </>
  );
}

function Loop({ d }: { d: Data }) {
  const f = d.forecast;
  const m = f?.metrics;
  const tab = m?.["tabpfn_3.5"]?.area_mae_km2;
  const per = m?.["persistence"]?.area_mae_km2;
  const gb = m?.["gradient_boosting"]?.area_mae_km2;
  const t26 = d.s1fc?.tests?.["2026"]?.metrics;
  const t25 = d.s1fc?.tests?.["2025"]?.metrics;
  return (
    <>
      <h2>Close the loop: where to send field probes</h2>
      <p>
        The places where water disappeared fastest become proposed probe sites. A probe there would confirm whether the
        reeds are dry and how deep the water is. <Tag kind="sim" />
      </p>
      {d.probes && (
        <ol className="probe-list">
          {d.probes.features.map((p) => (
            <li key={p.properties.label}>
              <span className="probe-dot" aria-hidden />
              <span><b>{p.properties.label}</b> {p.properties.text}</span>
            </li>
          ))}
        </ol>
      )}
      <Note>
        The probe network does not exist yet. It shows how ARBDD could act on the radar signal. <Tag kind="future" />
      </Note>
      {f && (
        <section className="sub">
          <h3>TabPFN-3.5 12-day outlook <Tag kind="future" /></h3>
          <p>
            A TabPFN-3.5 model trained on the 2026 NISAR series expects about{" "}
            <b className="num">{num(f.forecast.p50_km2)} km²</b> of water under the Delta's vegetation on{" "}
            {fmtIso(f.forecast.date)} (rough range <span className="num">{num(f.forecast.p10_km2)}–{num(f.forecast.p90_km2)}</span>),
            against <span className="num">{num(f.forecast.last_observed_km2)} km²</span> observed on{" "}
            {fmtIso(f.forecast.from_date)}.
          </p>
          {tab != null && per != null && (
            <Note>
              Tested on the last five dates without peeking: area error <span className="num">{tab} km²</span>, vs{" "}
              <span className="num">{per} km²</span> for "no change"
              {gb != null && <> and <span className="num">{gb} km²</span> for gradient boosting</>}.{" "}
              {tab < per ? "Only a small gain" : 'No gain over "no change" yet'} in a flat drought period: treat it as a
              hint, not a forecast.
            </Note>
          )}
        </section>
      )}
      {t26?.["tabpfn_3.5"] && t25?.["tabpfn_3.5"] && t26["persistence"] && t25["persistence"] && (
        <section className="sub">
          <h3>Trained on ten years of Sentinel-1 <Tag kind="future" /></h3>
          <p>
            Trained on {d.s1fc?.years_train?.replace("-", "–") ?? "earlier years"}, the same TabPFN-3.5 setup predicts
            Delta open water 6–12 days ahead with an area error of{" "}
            <span className="num">{t26["tabpfn_3.5"]!.area_mae_km2} km²</span> in 2026 and{" "}
            <span className="num">{t25["tabpfn_3.5"]!.area_mae_km2} km²</span> in 2025, against{" "}
            <span className="num">{t26["persistence"]!.area_mae_km2}</span> and{" "}
            <span className="num">{t25["persistence"]!.area_mae_km2} km²</span> for "no change". More history makes the model
            useful.
          </p>
        </section>
      )}
    </>
  );
}

function About({ d }: { d: Data }) {
  const dates = d.manifest.zones.delta.dates;
  const validated = dates.find((k) => d.manifest.zones.delta.status[k] === "Validated");
  const years = d.s1?.years ? Object.keys(d.s1.years).map(Number) : [];
  return (
    <>
      <h2>Method and limits</h2>
      <ul className="rules">
        <li>
          <b>Data:</b> NISAR L2 GCOV (ASF DAAC), track 065 descending, frames 065 + 066, {dates.length} dates{" "}
          {fmtDate(dates[0]!)} – {fmtDate(dates.at(-1)!)} {dates.at(-1)!.slice(0, 4)}, HH + HV at 20 m.
          {validated && <> Dates before {fmtDate(validated)} are Provisional.</>}
        </li>
        {d.s1 && (
          <li>
            <b>Sentinel-1:</b> NASA OPERA RTC-S1 (C-band, 30 m{d.s1.track ? `, track ${d.s1.track}` : ""})
            {years.length > 0 && <>, {Math.min(...years)}–{Math.max(...years)}</>}, open water only; used to fill NISAR's
            gap, check its maps and give ten years of context.
          </li>
        )}
        <li>
          <b>Open water:</b> per-date reference to permanent water (JRC Global Surface Water), inside the area that has
          ever been water, then refined with SAM 2.1.
        </li>
        <li>
          <b>Water under vegetation:</b> HH double bounce (bright HH, high HH/HV ratio) in reeds and floodplain forest (ESA
          WorldCover), below 5 m above drainage (HAND).
        </li>
        <li>
          <b>Limits:</b> reeds also change through the summer, which dims HH. Wind can brighten open water. Correlation,
          not proof of cause.
        </li>
      </ul>
      <Note>{OPERA_CREDIT}</Note>
      <Note>
        Basemap: Sentinel-2 cloudless by EOX IT Services GmbH. Terrain: Mapzen Terrain Tiles. River data © DanubeAlert (CC
        BY 4.0).
      </Note>
      <p>
        Code, references and AI-use disclosure: see the{" "}
        <a href="https://github.com/recycllux/pelanode-nisar-spaceapps-2026#readme" target="_blank" rel="noopener noreferrer">
          project README
        </a>
        .
      </p>
      <p className="note">
        Built for NASA Space Apps 2026, challenge "Dancing with the SARs". The RiverNexa logo was made with an AI image
        tool.
      </p>
    </>
  );
}

export const STEPS: Step[] = [
  { key: "overview", title: "Overview", apply: { mode: "pulse", swipe: false, fly: "corridor", zone: "delta" }, Body: Overview },
  { key: "delta", title: "Delta", apply: { fly: "delta", zone: "delta", chartZone: "delta", mode: "water", dateKey: "after", swipe: true }, Body: Delta },
  { key: "cernavoda", title: "Cernavodă", apply: { fly: "cernavoda", zone: "cernavoda", chartZone: "cernavoda", mode: "composite", dateKey: "20260817", swipe: false }, Body: Cernavoda },
  { key: "balta", title: "Balta Mică", apply: { fly: "balta_mica_brailei", zone: "balta_mica_brailei", chartZone: "balta_mica_brailei", mode: "water", dateKey: "after", swipe: true }, Body: Balta },
  { key: "river", title: "River levels", apply: { fly: "delta", zone: "delta", chartZone: "delta", mode: "flood" }, Body: RiverLevels },
  { key: "why", title: "Why it changed", apply: { mode: "lost", fly: "corridor", zone: "delta" }, Body: Why },
  { key: "loop", title: "Close the loop", apply: { fly: "delta", zone: "delta", chartZone: "delta", mode: "lost", probes: true }, Body: Loop },
  { key: "decide", title: "Decide", apply: { fly: "delta", zone: "delta", chartZone: "delta", mode: "pulse", dateKey: "after", swipe: false, probes: true }, Body: Decide },
  { key: "about", title: "About", apply: {}, Body: About },
];
