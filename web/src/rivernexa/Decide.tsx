import { useMemo, useState } from "react";
import { GLOW, SPARK, ZONES, type ZoneKey } from "./config";
import type { Data, Station } from "./data";
import { fmtDate, key2iso } from "./format";
import { makeCellIndex } from "./MapView";
import { Tag } from "./Tag";

/** A 500 m spot chosen on the map or from the proposed probe sites. */
export type Site = { lon: number; lat: number; zone: string; t: number[]; v: number[]; label?: string };
export type DecideCtx = { site: Site | null; pickSite: (s: Site) => void; dateKey: string; fromKey?: string; toKey?: string };

const safeUrl = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);

function levelOn(st: Station | undefined, iso: string) {
  if (!st) return null;
  let best: number | null = null;
  st.dates.forEach((d, i) => {
    if (d <= iso && st.level_cm[i] != null) best = st.level_cm[i]!;
  });
  return best;
}

/** The proposed pilot rules from the decision framework, applied to what the radar and gauges measured. */
export function assess(d: Data, site: Site, k: number) {
  const t = site.t, v = site.v;
  const dropAll = (t[0] ?? 0) - (t[k] ?? 0);
  const drop1 = k > 0 ? (t[k - 1] ?? 0) - (t[k] ?? 0) : 0;
  let run = 0; // repeated falls: steps with a decline of 5+ pts up to this date
  for (let i = 1; i <= k; i++) if ((t[i - 1] ?? 0) - (t[i] ?? 0) >= 5) run++;
  const zm = d.manifest.zones[site.zone as ZoneKey];
  const gauge = zm?.gauge;
  const st = gauge ? d.river.stations[gauge] : undefined;
  const iso = key2iso(zm?.dates[k] ?? d.manifest.zones.delta.dates[k]!);
  const lvl = levelOn(st, iso);
  const enr = st?.enr_cm != null ? Number(st.enr_cm) : null;
  const rules = [
    {
      id: "decline",
      name: "Rapid decline or drying pattern",
      kind: "Proposed pilot rule",
      hit: (dropAll >= 30 && run >= 2) || drop1 >= 20,
      why: `water share ${dropAll >= 0 ? "down" : "up"} ${Math.abs(dropAll)} pts since ${fmtDate(zm?.dates[0] ?? "")}; fell 5+ pts on ${run} of ${k} intervals`,
    },
    {
      id: "reeds",
      name: "Water under reeds mostly gone",
      kind: "Proposed pilot rule",
      hit: (v[0] ?? 0) >= 20 && (v[k] ?? 0) <= 0.25 * (v[0] ?? 0),
      why: `under reeds ${v[0] ?? 0}% → ${v[k] ?? 0}% of the spot`,
    },
    {
      id: "river",
      name: "River below its low-water mark",
      kind: "Official threshold (DanubeAlert)",
      hit: lvl != null && enr != null && lvl < enr,
      why: lvl != null && enr != null ? `${gauge} ${lvl} cm vs mark ${enr} cm on ${fmtDate(zm?.dates[k] ?? "")}` : "no gauge reading",
    },
  ];
  const n = rules.filter((r) => r.hit).length;
  const level = n >= 2 ? { label: "Field check requested", cls: "lvl-3" } : n === 1 ? { label: "Watch", cls: "lvl-2" } : { label: "No alert", cls: "lvl-1" };
  const month = +((zm?.dates[k] ?? "").slice(4, 6) || 0);
  const lost = dropAll >= 15 || rules[1]!.hit;
  const recommend = new Set<string>();
  if (n > 0) recommend.add("depth");
  if (lost && month >= 6 && month <= 9) { recommend.add("oxygen"); recommend.add("temperature"); }
  if (site.zone === "delta" && site.lon > 29.45) recommend.add("salinity");
  return { rules, level, recommend, gauge, lvl, enr };
}

function Spark({ t, v, k }: { t: number[]; v: number[]; k: number }) {
  const W = 300, H = 70, n = t.length;
  const x = (i: number) => 6 + (i * (W - 12)) / (n - 1);
  const y = (val: number) => H - 6 - (val / 100) * (H - 12);
  const line = (a: number[]) => a.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(val).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="decide-spark" role="img" aria-label="Water share at this spot on the 11 NISAR dates">
      <rect x="0" y="0" width={W} height={H} rx="4" fill="#06080c" />
      <line x1={x(k)} x2={x(k)} y1="4" y2={H - 4} stroke="#ffffff55" strokeDasharray="2 2" />
      <path d={`${line(t)} L${x(n - 1)},${H - 6} L${x(0)},${H - 6}Z`} fill={`${SPARK.all}22`} />
      <path d={line(t)} fill="none" stroke={SPARK.all} strokeWidth="2.5" />
      <path d={line(v)} fill="none" stroke={SPARK.veg} strokeWidth="2" strokeDasharray="5 3" />
      <circle cx={x(k)} cy={y(t[k] ?? 0)} r="4" fill="#fff" stroke={SPARK.all} strokeWidth="2" />
    </svg>
  );
}

export function Decide({ d, ctx }: { d: Data; ctx?: DecideCtx }) {
  const dec = d.decisions;
  const [param, setParam] = useState<string | null>(null);
  const [actor, setActor] = useState("wetland");
  const cellAt = useMemo(() => (d.pulse ? makeCellIndex(d.pulse) : null), [d.pulse]);
  if (!dec || !ctx || !d.pulse) return <p>The decision data could not be loaded.</p>;
  const { site, pickSite, dateKey } = ctx;
  const dates = d.pulse.dates;
  const k = Math.max(0, dates.indexOf(dateKey));
  const a = site ? assess(d, site, k) : null;
  const shownParam = param ?? (a && [...a.recommend][0]) ?? "depth";
  const P = dec.parameters.find((p) => p.key === shownParam) ?? dec.parameters[0]!;
  const act = dec.actions[P.key]?.[actor];

  const pickProbe = (label: string, lon: number, lat: number) => {
    const hit = cellAt?.(lon, lat);
    if (hit) pickSite({ lon, lat, zone: hit.zone, t: hit.t, v: hit.v, label });
  };

  return (
    <>
      <h2>Decide: from a map change to a field check</h2>
      <p className="note decide-disclaimer">{dec.disclaimer}</p>

      <h3 className="decide-h">1 · Pick a site</h3>
      <div className="decide-sites">
        {d.probes?.features.map((f) => (
          <button key={f.properties.label} type="button" aria-pressed={site?.label === f.properties.label}
            onClick={() => pickProbe(f.properties.label, f.geometry.coordinates[0], f.geometry.coordinates[1])}>
            {f.properties.label}
          </button>
        ))}
      </div>
      <p className="note">Proposed probe sites <Tag kind="sim" />, or click anywhere on the map. Move the date slider to see the situation on another NISAR date.</p>

      {!site ? (
        <p className="decide-empty">No site selected yet.</p>
      ) : (
        <>
          <h3 className="decide-h">2 · What was measured here <Tag kind="real" /></h3>
          <p>
            {site.label ? <b>{site.label} · </b> : null}500 m spot in {ZONES[site.zone as ZoneKey]?.name ?? site.zone} ({site.lat.toFixed(3)}° N,{" "}
            {site.lon.toFixed(3)}° E), NISAR {fmtDate(dateKey)}: water <b style={{ color: SPARK.all }}>{site.t[k]}%</b> of the spot
            (was {site.t[0]}% on {fmtDate(dates[0]!)}), under reeds <b style={{ color: SPARK.veg }}>{site.v[k]}%</b> (was {site.v[0]}%).
          </p>
          <Spark t={site.t} v={site.v} k={k} />
          <p className="pulse-key"><span><i style={{ background: SPARK.all }} />all water</span><span><i className="dash" style={{ borderColor: SPARK.veg }} />under reeds</span></p>
          {a?.lvl != null && (
            <p className="note">River gauge {a.gauge}: <b>{a.lvl} cm</b> on this date{a.enr != null && <>, low-water mark {a.enr} cm</>} (DanubeAlert). Reed water follows the Isaccea level from about 6 days earlier.</p>
          )}

          <h3 className="decide-h">3 · Alert level <span className="note-inline">indicative</span></h3>
          <p><span className={`alert-badge ${a!.level.cls}`}>{a!.level.label}</span></p>
          <ul className="decide-rules">
            {a!.rules.map((r) => (
              <li key={r.id} className={r.hit ? "hit" : ""}>
                <span aria-hidden>{r.hit ? "●" : "○"}</span>
                <span><b>{r.name}</b> <span className="note-inline">{r.kind}</span><br />{r.why}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="decide-h">{site ? "4" : "2"} · What to measure <Tag kind="sim" /></h3>
      <div className="seg decide-params" role="group" aria-label="Parameter">
        {dec.parameters.map((p) => (
          <button key={p.key} type="button" aria-pressed={P.key === p.key} onClick={() => setParam(p.key)}>
            {p.name}{a?.recommend.has(p.key) ? " ★" : ""}
          </button>
        ))}
      </div>
      {a && a.recommend.size > 0 && <p className="note">★ suggested for this site and date.</p>}
      <p><b>{P.question}</b> {P.measure}</p>
      <ul className="decide-thr">
        {P.thresholds.map((t) => (
          <li key={t.alert}><b>{t.alert}</b> <span className="note-inline">{t.kind}</span><br />{t.text}</li>
        ))}
      </ul>
      <p className="note">
        Sources:{" "}
        {P.sources.map(([name, url], i) => (
          <span key={name}>{i ? ", " : ""}{safeUrl(url) ? <a href={safeUrl(url)} target="_blank" rel="noopener noreferrer">{name}</a> : name}</span>
        ))}
      </p>

      <h3 className="decide-h">{site ? "5" : "3"} · Who can act</h3>
      <label className="decide-actor">
        <span className="sr-only">Role</span>
        <select value={actor} onChange={(e) => setActor(e.target.value)}>
          {dec.actors.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
        </select>
      </label>
      {act && (
        <div className="decide-actions">
          <div><span className="ctl-label">Hours to days</span><p>{act[0]}</p></div>
          <div><span className="ctl-label">Seasons to years</span><p>{act[1]}</p></div>
        </div>
      )}
      <p className="note">Proposed decision pathways from the team's decision framework, not instructions to intervene. Colours: <span style={{ color: GLOW.lost }}>magenta</span> on the map marks water lost since 18 Jun.</p>
    </>
  );
}
