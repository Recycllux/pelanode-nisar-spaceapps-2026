import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
// MapLibre 6 loads its web worker from a separate ES module file; ship it as a hashed asset.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { type Map as MLMap, type StyleSpecification, type ImageSource, type GeoJSONSource } from "maplibre-gl";
import { COLORS, CORRIDOR, SPARK, OPERA_CREDIT, ZONES, ZONE_KEYS, type Mode, type Pol, type ZoneKey } from "./config";
import { dataUrl, type Data, type Pulse } from "./data";
import { fmtDate } from "./format";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export type FlyReq = { n: number; target: "corridor" | ZoneKey };

const OPACITY: Record<Mode, Record<string, number>> = {
  pulse: { radar: 0, comp: 0, class: 0, lost: 0, flood: 0 },
  water: { radar: 0.9, comp: 0, class: 0.85, lost: 0, flood: 0 },
  radar: { radar: 1, comp: 0, class: 0, lost: 0, flood: 0 },
  lost: { radar: 0.55, comp: 0, class: 0, lost: 0.95, flood: 0 },
  composite: { radar: 0, comp: 1, class: 0, lost: 0, flood: 0 },
  flood: { radar: 0.5, comp: 0, class: 0, lost: 0, flood: 0.95 },
};

const baseStyle = (): StyleSpecification => ({
  version: 8,
  sources: {
    s2: {
      type: "raster",
      tileSize: 256,
      maxzoom: 15,
      tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
      attribution:
        '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
    },
    hs: {
      type: "raster-dem",
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
    },
    dem: {
      type: "raster-dem",
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 14,
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      attribution:
        'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</a>',
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0e1420" } },
    // Night style: dimmed, cool satellite imagery with hillshade on top, so the relief reads under the neon layers.
    { id: "s2", type: "raster", source: "s2", paint: { "raster-saturation": -0.6, "raster-brightness-max": 0.55, "raster-contrast": 0.1, "raster-hue-rotate": 0 } },
    { id: "hillshade", type: "hillshade", source: "hs",
      paint: { "hillshade-exaggeration": 0.75, "hillshade-shadow-color": "#000510", "hillshade-highlight-color": "#9cc4ff", "hillshade-accent-color": "#12305a", "hillshade-illumination-direction": 315 } },
  ],
});

/** 1×1 transparent PNG: every overlay starts as this and gets its real image only when a mode shows it. */
const BLANK =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Props = {
  data: Data;
  mode: Mode;
  pol: Pol;
  afterKey: string;
  beforeKey: string;
  swipeOn: boolean;
  terrain: boolean;
  probes: boolean;
  fly: FlyReq;
  onCenterZone: (z: ZoneKey) => void;
  /** When set, clicking the map picks the nearest 500 m spot (Decide step). */
  onPickSite?: (s: { lon: number; lat: number; zone: string; t: number[]; v: number[] }) => void;
  site?: { lon: number; lat: number } | null;
  beforeLabel: string;
  afterLabel: string;
  children?: React.ReactNode;
};


/* ---------- Water pulse: smooth neon change layers (G3) + hover history from 500 m cells (G2) ---------- */
const GLOW_FADE_MS = 750;

type CellHit = { zone: string; t: number[]; v: number[] };
/** Nearest 500 m cell to a point, via a coarse lon/lat grid index. */
export function makeCellIndex(p: Pulse) {
  const G = 0.005;
  const idx = new Map<string, { lon: number; lat: number; zone: string; c: number[] }[]>();
  for (const [zone, z] of Object.entries(p.zones)) {
    for (const c of z?.cells ?? []) {
      const k = `${Math.round(c[0]! / G)}|${Math.round(c[1]! / G)}`;
      (idx.get(k) ?? idx.set(k, []).get(k)!).push({ lon: c[0]!, lat: c[1]!, zone, c });
    }
  }
  const n = p.dates.length;
  return (lon: number, lat: number): CellHit | null => {
    const i = Math.round(lon / G), j = Math.round(lat / G);
    let best: { d: number; zone: string; c: number[] } | null = null;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const e of idx.get(`${i + di}|${j + dj}`) ?? []) {
          const d = ((e.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2 + (e.lat - lat) ** 2;
          if (!best || d < best.d) best = { d, zone: e.zone, c: e.c };
        }
    if (!best || best.d > 0.0035 ** 2) return null;
    return { zone: best.zone, t: best.c.slice(2, 2 + n), v: best.c.slice(2 + n, 2 + 2 * n) };
  };
}

function sparkSVG(vals: number[], veg: number[], idx: number) {
  const W = 210, H = 64, n = vals.length;
  const x = (k: number) => 6 + (k * (W - 12)) / (n - 1);
  const y = (v: number) => H - 6 - (v / 100) * (H - 12);
  const line = (a: number[]) => a.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const dots = (a: number[], c: string) => a.map((v, k) => `<circle cx="${x(k).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2" fill="${c}"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
<rect x="0" y="0" width="${W}" height="${H}" rx="4" fill="#06080c"/>
<line x1="${x(idx)}" x2="${x(idx)}" y1="4" y2="${H - 4}" stroke="#ffffff55" stroke-dasharray="2 2"/>
<path d="${line(vals)} L${x(n - 1)},${H - 6} L${x(0)},${H - 6}Z" fill="${SPARK.all}22"/>
<path d="${line(vals)}" fill="none" stroke="${SPARK.all}" stroke-width="2.5" stroke-linejoin="round"/>
<path d="${line(veg)}" fill="none" stroke="${SPARK.veg}" stroke-width="2" stroke-dasharray="5 3" stroke-linejoin="round"/>
${dots(veg, SPARK.veg)}
<circle cx="${x(idx)}" cy="${y(vals[idx] ?? 0)}" r="4" fill="#fff" stroke="${SPARK.all}" stroke-width="2"/>
</svg>`;
}


export function MapView(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<HTMLDivElement>(null);
  const bRef = useRef<HTMLDivElement>(null);
  const maps = useRef<{ a: MLMap; b: MLMap } | null>(null);
  const urls = useRef(new Map<string, string>());
  const latest = useRef(p);
  latest.current = p;
  const [ready, setReady] = useState(false);
  const [swipeX, setSwipeX] = useState(0.5);

  // create both maps once
  useEffect(() => {
    const { manifest } = latest.current.data;
    const mk = (el: HTMLDivElement) =>
      new maplibregl.Map({
        container: el,
        style: baseStyle(),
        bounds: CORRIDOR,
        fitBoundsOptions: { padding: 40 },
        maxPitch: 75,
        attributionControl: false,
        fadeDuration: 0,
      });
    const a = mk(aRef.current!);
    const b = mk(bRef.current!);
    b.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    b.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: OPERA_CREDIT }), "bottom-right");
    // Start collapsed (the "i" button opens it): avoids a late layout shift and keeps the map clear on phones.
    b.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
    maps.current = { a, b };

    const addLayers = (map: MLMap) => {
      for (const z of ZONE_KEYS) {
        const m = manifest.zones[z];
        if (!m) continue;
        const rc = (m.radar_coordinates ?? m.coordinates) as never;
        const c = m.coordinates as never;
        // Sources start blank; the layer effect below loads only the images the current mode shows.
        map.addSource(`${z}-radar`, { type: "image", url: BLANK, coordinates: rc });
        map.addSource(`${z}-class`, { type: "image", url: BLANK, coordinates: c });
        map.addSource(`${z}-lost`, { type: "image", url: BLANK, coordinates: c });
        map.addSource(`${z}-comp`, { type: "image", url: BLANK, coordinates: rc });
        const keys = ["radar", "comp", "class", "lost"];
        if (z === "delta") {
          map.addSource(`${z}-flood`, { type: "image", url: BLANK, coordinates: c });
          keys.push("flood");
        }
        for (const k of keys) {
          map.addLayer({
            id: `${z}-${k}`,
            type: "raster",
            source: `${z}-${k}`,
            paint: {
              "raster-opacity": 0,
              "raster-opacity-transition": { duration: 0, delay: 0 },
              "raster-fade-duration": 0,
              "raster-resampling": k === "radar" || k === "comp" ? "linear" : "nearest",
              // keep the neon colours vivid over the dark basemap
              ...(k === "radar" || k === "comp" ? {} : { "raster-saturation": 0.3, "raster-contrast": 0.15 }),
            },
          });
        }
      }
      const glow = latest.current.data.glow;
      if (glow && map === b) {
        for (const z of ZONE_KEYS) {
          const g = glow.zones[z];
          if (!g) continue;
          for (const slot of ["A", "B"]) {
            map.addSource(`${z}-glow${slot}`, { type: "image", url: dataUrl(`${z}/${g.dates[0]}_glow.webp`), coordinates: g.coordinates as never });
            map.addLayer({ id: `${z}-glow${slot}`, type: "raster", source: `${z}-glow${slot}`,
              paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 0, delay: 0 }, "raster-fade-duration": 0, "raster-resampling": "linear",
                "raster-saturation": 0.3, "raster-contrast": 0.15 } });
          }
        }
      }
      // Relief shading on top of every data layer, so the 3D terrain reads through the colours too.
      map.addLayer({ id: "hillshade-top", type: "hillshade", source: "hs",
        paint: { "hillshade-exaggeration": 0.85, "hillshade-shadow-color": "rgba(0, 3, 12, 0.6)",
          "hillshade-highlight-color": "rgba(200, 225, 255, 0.18)", "hillshade-accent-color": "rgba(0, 0, 0, 0)",
          "hillshade-illumination-direction": 315 } });
      map.addSource("site", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "site-ring", type: "circle", source: "site",
        paint: { "circle-radius": 16, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "site-dot", type: "circle", source: "site",
        paint: { "circle-radius": 4, "circle-color": "#ffffff" } });
      map.addSource("probes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "probes-ring", type: "circle", source: "probes",
        paint: { "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#f4f1ea", "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.8 } });
      map.addLayer({ id: "probes", type: "circle", source: "probes",
        paint: { "circle-radius": 5.5, "circle-color": "#f4f1ea", "circle-stroke-color": "#06080c", "circle-stroke-width": 2 } });
    };

    let loaded = 0;
    for (const m of [a, b]) {
      // Wait for the style only, not for "load": "load" also waits for basemap tiles, so a slow or
      // blocked tile server (EOX, AWS terrain) used to keep every NISAR overlay from appearing.
      m.once("style.load", () => {
        addLayers(m);
        if (++loaded === 2) {
          b.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
          setReady(true);
        }
      });
    }

    // keep the two maps in step
    let syncing = false;
    const sync = (from: MLMap, to: MLMap) =>
      from.on("move", () => {
        if (syncing) return;
        syncing = true;
        to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
        syncing = false;
      });
    sync(a, b);
    sync(b, a);

    b.on("moveend", () => {
      const c = b.getCenter();
      let best: ZoneKey = "delta";
      let bd = Infinity;
      for (const z of ZONE_KEYS) {
        const v = ZONES[z].center;
        const dd = (v[0] - c.lng) ** 2 + (v[1] - c.lat) ** 2;
        if (dd < bd) { bd = dd; best = z; }
      }
      latest.current.onCenterZone(best);
    });

    b.on("click", "probes", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const props = f.properties as { label: string; text: string };
      const el = document.createElement("div");
      el.className = "probe-pop";
      const t = document.createElement("strong");
      t.textContent = props.label;
      const s = document.createElement("p");
      s.textContent = props.text;
      const tag = document.createElement("span");
      tag.className = "tag tag-sim";
      tag.textContent = "Simulated";
      el.append(t, s, tag);
      new maplibregl.Popup({ closeButton: true, maxWidth: "260px" }).setLngLat(e.lngLat).setDOMContent(el).addTo(b);
    });
    b.on("mouseenter", "probes", () => (b.getCanvas().style.cursor = "pointer"));
    b.on("mouseleave", "probes", () => (b.getCanvas().style.cursor = ""));

    // Water pulse: hover anywhere to see the nearest 500 m cell's water over time.
    const pulsePop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "250px", className: "pulse-pop" });
    let cellAt: ReturnType<typeof makeCellIndex> | null = null;
    b.on("mousemove", (e) => {
      const L = latest.current;
      if (L.mode !== "pulse" || !L.data.pulse) { pulsePop.remove(); return; }
      cellAt ??= makeCellIndex(L.data.pulse);
      const hit = cellAt(e.lngLat.lng, e.lngLat.lat);
      if (!hit) { pulsePop.remove(); b.getCanvas().style.cursor = ""; return; }
      const dates = L.data.pulse.dates;
      const k = Math.max(0, dates.indexOf(L.afterKey));
      const d = (hit.t[k] ?? 0) - (hit.t[0] ?? 0);
      b.getCanvas().style.cursor = "crosshair";
      pulsePop
        .setLngLat(e.lngLat)
        .setHTML(
          `<strong>This 500 m spot · ${fmtDate(L.afterKey)}</strong>` +
            `<p>Water: <b style="color:${SPARK.all}">${hit.t[k]}%</b> (${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)} pts since ${fmtDate(dates[0]!)}) · under reeds: <b style="color:${SPARK.veg}">${hit.v[k]}%</b></p>` +
            sparkSVG(hit.t, hit.v, k) +
            `<p class="pulse-key"><span><i style="background:${SPARK.all}"></i>all water</span><span><i class="dash" style="border-color:${SPARK.veg}"></i>under reeds</span><span>${fmtDate(dates[0]!)} – ${fmtDate(dates[dates.length - 1]!)}</span></p>`,
        )
        .addTo(b);
    });
    b.on("mouseout", () => pulsePop.remove());
    b.on("click", (e) => {
      const L = latest.current;
      if (!L.onPickSite || !L.data.pulse) return;
      cellAt ??= makeCellIndex(L.data.pulse);
      const hit = cellAt(e.lngLat.lng, e.lngLat.lat);
      if (hit) L.onPickSite({ lon: e.lngLat.lng, lat: e.lngLat.lat, zone: hit.zone, t: hit.t, v: hit.v });
    });


    const ro = new ResizeObserver(() => { a.resize(); b.resize(); });
    ro.observe(wrapRef.current!);
    return () => { ro.disconnect(); a.remove(); b.remove(); maps.current = null; };
  }, []);

  // layers: images + opacities
  useEffect(() => {
    if (!ready || !maps.current) return;
    const { manifest } = p.data;
    const apply = (map: MLMap, tag: string, date: string) => {
      for (const z of ZONE_KEYS) {
        const m = manifest.zones[z];
        if (!m) continue;
        const d = m.dates.includes(date) ? date : m.dates[0];
        const set = (src: string, url: string, coords: [number, number][]) => {
          const k = `${tag}:${src}`;
          if (urls.current.get(k) === url) return;
          urls.current.set(k, url);
          (map.getSource(src) as ImageSource).updateImage({ url, coordinates: coords as never });
        };
        const op = OPACITY[p.mode];
        const rc = m.radar_coordinates ?? m.coordinates;
        if (op["radar"]) set(`${z}-radar`, dataUrl(`${z}/${d}_${p.pol}.webp`), rc);
        if (op["class"]) set(`${z}-class`, dataUrl(`${z}/${d}_class.png`), m.coordinates);
        if (op["lost"]) set(`${z}-lost`, dataUrl(`${z}/lost.png`), m.coordinates);
        if (op["comp"]) set(`${z}-comp`, dataUrl(`${z}/composite.webp`), rc);
        if (op["flood"] && map.getSource(`${z}-flood`)) set(`${z}-flood`, dataUrl(`${z}/flood_threshold.png`), m.coordinates);
        for (const [k, v] of Object.entries(op))
          if (map.getLayer(`${z}-${k}`)) map.setPaintProperty(`${z}-${k}`, "raster-opacity", v);
      }
    };
    apply(maps.current.b, "b", p.afterKey);
    // The "before" map is only visible while swipe compare is on; don't fetch its images until then.
    if (p.swipeOn) apply(maps.current.a, "a", p.beforeKey);
  }, [ready, p.mode, p.pol, p.afterKey, p.beforeKey, p.swipeOn, p.data]);

  useEffect(() => {
    if (!ready || !maps.current) return;
    const src = maps.current.b.getSource("site") as GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: p.site ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [p.site.lon, p.site.lat] } }] : [] } as never);
  }, [ready, p.site]);

  // Water pulse: cross-fade the neon change layer to the selected date.
  const glowState = useRef<{ front: "A" | "B"; key: string | null }>({ front: "A", key: null });
  useEffect(() => {
    if (!ready || !maps.current) return;
    const b = maps.current.b;
    const glow = p.data.glow;
    if (!glow) return;
    const zones = ZONE_KEYS.filter((z) => glow.zones[z] && b.getLayer(`${z}-glowA`));
    const setOp = (slot: "A" | "B", v: number) => {
      for (const z of zones) b.setPaintProperty(`${z}-glow${slot}`, "raster-opacity", v);
    };
    const st = glowState.current;
    if (p.mode !== "pulse") {
      setOp("A", 0); setOp("B", 0);
      return;
    }
    if (st.key === p.afterKey) { setOp(st.front, 1); setOp(st.front === "A" ? "B" : "A", 0); return; }
    const back: "A" | "B" = st.front === "A" ? "B" : "A";
    const front = st.front;
    const wasShowing = st.key !== null;
    for (const z of zones) {
      const g = glow.zones[z]!;
      const d = g.dates.includes(p.afterKey) ? p.afterKey : g.dates[0]!;
      (b.getSource(`${z}-glow${back}`) as ImageSource).updateImage({ url: dataUrl(`${z}/${d}_glow.webp`), coordinates: g.coordinates as never });
    }
    let raf = 0;
    let cancelled = false;
    const t0 = performance.now();
    const waitThenFade = () => {
      if (cancelled) return;
      const loaded = zones.every((z) => b.isSourceLoaded(`${z}-glow${back}`));
      if (!loaded && performance.now() - t0 < 4000) { raf = requestAnimationFrame(waitThenFade); return; }
      const f0 = performance.now();
      const ms = reducedMotion() ? 0 : GLOW_FADE_MS;
      const step = (now: number) => {
        if (cancelled) return;
        const u = ms ? Math.min(1, (now - f0) / ms) : 1;
        const e = u * u * (3 - 2 * u);
        setOp(back, e);
        setOp(front, wasShowing ? 1 - e : 0);
        if (u < 1) raf = requestAnimationFrame(step);
        else { st.front = back; st.key = key; }
      };
      raf = requestAnimationFrame(step);
    };
    const key = p.afterKey;
    raf = requestAnimationFrame(waitThenFade);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [ready, p.mode, p.afterKey, p.data.glow]);


  useEffect(() => {
    if (!ready || !maps.current) return;
    const t = { source: "dem", exaggeration: 6 };
    maps.current.b.setTerrain(p.terrain ? t : null);
    // The hidden "before" map only needs terrain (and its DEM tiles) while swipe compare shows it.
    maps.current.a.setTerrain(p.terrain && p.swipeOn ? t : null);
  }, [ready, p.terrain, p.swipeOn]);

  useEffect(() => {
    if (!ready || !maps.current) return;
    const fc = p.probes && p.data.probes ? p.data.probes : { type: "FeatureCollection" as const, features: [] };
    for (const m of [maps.current.a, maps.current.b]) (m.getSource("probes") as GeoJSONSource).setData(fc as never);
  }, [ready, p.probes, p.data.probes]);

  useEffect(() => {
    if (!ready || !maps.current || p.fly.n === 0) return;
    const b = maps.current.b;
    const rm = reducedMotion();
    if (p.fly.target === "corridor") {
      b.fitBounds(CORRIDOR, { padding: 40, pitch: 55, bearing: -15, duration: rm ? 0 : 2500 });
    } else {
      const v = ZONES[p.fly.target];
      b.flyTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, duration: 2200, animate: !rm });
    }
  }, [ready, p.fly]);

  // swipe
  const moveTo = (clientX: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    setSwipeX(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };
  const dragging = useRef(false);
  const onKey = (e: React.KeyboardEvent) => {
    const w = wrapRef.current!.clientWidth || 1;
    const step = 20 / w;
    if (e.key === "ArrowLeft") { e.preventDefault(); setSwipeX((x) => Math.max(0, x - step)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setSwipeX((x) => Math.min(1, x + step)); }
    if (e.key === "Home") { e.preventDefault(); setSwipeX(0); }
    if (e.key === "End") { e.preventDefault(); setSwipeX(1); }
  };

  return (
    <div ref={wrapRef} className="map-wrap">
      <div ref={aRef} className="map-layer" inert={!p.swipeOn} aria-hidden={!p.swipeOn} />
      <div
        ref={bRef}
        className="map-layer"
        style={{ clipPath: p.swipeOn ? `inset(0 0 0 ${swipeX * 100}%)` : "none" }}
      />
      {p.swipeOn && (
        <>
          <div className="swipe-line" style={{ left: `${swipeX * 100}%` }}>
            <div
              className="swipe-handle"
              role="slider"
              tabIndex={0}
              aria-label="Swipe between before and after dates"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(swipeX * 100)}
              aria-valuetext={`${Math.round(swipeX * 100)}% before, ${100 - Math.round(swipeX * 100)}% after`}
              onKeyDown={onKey}
              onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
              onPointerUp={() => (dragging.current = false)}
            />
          </div>
          <div className="swipe-labels">
            <span>{p.beforeLabel}</span>
            <span>{p.afterLabel}</span>
          </div>
        </>
      )}
      {p.children}
    </div>
  );
}
