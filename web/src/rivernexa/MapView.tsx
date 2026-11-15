import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
// MapLibre 6 loads its web worker from a separate ES module file; ship it as a hashed asset.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import type * as GeoJSON from "geojson";
import { type Map as MLMap, type StyleSpecification, type ImageSource, type GeoJSONSource } from "maplibre-gl";
import { COLORS, CORRIDOR, OPERA_CREDIT, ZONES, ZONE_KEYS, type Mode, type Pol, type ZoneKey } from "./config";
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
    { id: "s2", type: "raster", source: "s2", paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.8 } },
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
  beforeLabel: string;
  afterLabel: string;
  children?: React.ReactNode;
};


/* ---------- Water pulse: 500 m cells drawn as 3D columns ---------- */
const PULSE_MAX_M = 1800; // column height for a cell that is 100 % water
const PULSE_MIN_M = 40; // keep dried-out cells visible as a flat tile
const PULSE_SHRINK = 0.86; // gap between columns

function pulseGeoJSON(p: Pulse) {
  const n = p.dates.length;
  const features: GeoJSON.Feature[] = [];
  for (const [zone, z] of Object.entries(p.zones)) {
    if (!z) continue;
    const [ex, ey] = z.east.map((v) => v * PULSE_SHRINK) as [number, number];
    const [nx, ny] = z.north.map((v) => v * PULSE_SHRINK) as [number, number];
    z.cells.forEach((c, i) => {
      const [lon, lat] = c as [number, number];
      const props: Record<string, number | string> = { zone };
      for (let k = 0; k < n; k++) {
        props[`t${k}`] = c[2 + k] ?? 0;
        props[`v${k}`] = c[2 + n + k] ?? 0;
      }
      features.push({
        type: "Feature",
        id: features.length,
        properties: { ...props, i },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [lon - ex - nx, lat - ey - ny],
            [lon + ex - nx, lat + ey - ny],
            [lon + ex + nx, lat + ey + ny],
            [lon - ex + nx, lat - ey + ny],
            [lon - ex - nx, lat - ey - ny],
          ]],
        },
      });
    });
  }
  return { type: "FeatureCollection" as const, features };
}

/** Paint for one date k: column height = water share, colour = change since the first date. */
const pulseHeightAt = (k: number, scale: number) => ["+", PULSE_MIN_M * scale, ["*", (scale * PULSE_MAX_M) / 100, ["get", `t${k}`]]];
// Taller columns when zoomed out, so the corridor overview still reads in 3D.
const pulseHeight = (k: number) => ["interpolate", ["linear"], ["zoom"], 7.5, pulseHeightAt(k, 3.5), 9.5, pulseHeightAt(k, 1.4), 11.5, pulseHeightAt(k, 0.8)];
const pulseColor = (k: number) => [
  "interpolate", ["linear"], ["-", ["get", `t${k}`], ["get", "t0"]],
  ...PULSE_COLORS.flat(),
];

export const PULSE_COLORS: [number, string][] = [
  [-60, "#991b1b"],
  [-35, "#dc2626"],
  [-15, "#f97316"],
  [-5, "#fbbf24"],
  [0, "#38bdf8"],
  [15, "#2563eb"],
  [40, "#1e3a8a"],
];

function sparkSVG(vals: number[], veg: number[], idx: number) {
  const W = 200, H = 54, n = vals.length;
  const x = (k: number) => 4 + (k * (W - 8)) / (n - 1);
  const y = (v: number) => H - 4 - (v / 100) * (H - 8);
  const line = (a: number[]) => a.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
<rect x="0" y="0" width="${W}" height="${H}" rx="4" fill="#0b1220"/>
<path d="${line(vals)} L${x(n - 1)},${H - 4} L${x(0)},${H - 4}Z" fill="#38bdf833"/>
<path d="${line(vals)}" fill="none" stroke="#38bdf8" stroke-width="2"/>
<path d="${line(veg)}" fill="none" stroke="#34d399" stroke-width="1.5" stroke-dasharray="3 2"/>
<circle cx="${x(idx)}" cy="${y(vals[idx] ?? 0)}" r="3.5" fill="#fff"/>
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
            },
          });
        }
      }
      const pulse = latest.current.data.pulse;
      if (pulse && map === b) {
        map.addSource("pulse", { type: "geojson", data: pulseGeoJSON(pulse) as never });
        map.addLayer({
          id: "pulse",
          type: "fill-extrusion",
          source: "pulse",
          layout: { visibility: "none" },
          paint: {
            "fill-extrusion-height": pulseHeight(0) as never,
            "fill-extrusion-color": pulseColor(0) as never,
            "fill-extrusion-opacity": 0.92,
            "fill-extrusion-vertical-gradient": true,
          },
        });
      }
      map.addSource("probes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "probes-ring", type: "circle", source: "probes",
        paint: { "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": COLORS.sim, "circle-stroke-width": 1 } });
      map.addLayer({ id: "probes", type: "circle", source: "probes",
        paint: { "circle-radius": 5.5, "circle-color": COLORS.sim, "circle-stroke-color": "#f4f1ea", "circle-stroke-width": 1.5 } });
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

    // Water pulse: hover a column to see that 500 m cell's water over time.
    const pulsePop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "240px", className: "pulse-pop" });
    b.on("mousemove", "pulse", (e) => {
      const f = e.features?.[0];
      const pulse = latest.current.data.pulse;
      if (!f || !pulse) return;
      const pr = f.properties as Record<string, number>;
      const n = pulse.dates.length;
      const t = Array.from({ length: n }, (_, k) => pr[`t${k}`] ?? 0);
      const v = Array.from({ length: n }, (_, k) => pr[`v${k}`] ?? 0);
      const k = Math.max(0, pulse.dates.indexOf(latest.current.afterKey));
      const d = (t[k] ?? 0) - (t[0] ?? 0);
      b.getCanvas().style.cursor = "crosshair";
      pulsePop
        .setLngLat(e.lngLat)
        .setHTML(
          `<strong>500 m cell · ${fmtDate(latest.current.afterKey)}</strong>` +
            `<p>Water <b>${t[k]}%</b> of the cell (${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(d)} pts since ${fmtDate(pulse.dates[0]!)}), under reeds ${v[k]}%</p>` +
            sparkSVG(t, v, k) +
            `<p class="pulse-key"><i style="background:#38bdf8"></i>all water <i style="background:#34d399"></i>under reeds</p>`,
        )
        .addTo(b);
    });
    b.on("mouseleave", "pulse", () => { b.getCanvas().style.cursor = ""; pulsePop.remove(); });


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

  // Water pulse: show the columns for the selected date.
  useEffect(() => {
    if (!ready || !maps.current) return;
    const b = maps.current.b;
    if (!b.getLayer("pulse")) return;
    b.setLayoutProperty("pulse", "visibility", p.mode === "pulse" ? "visible" : "none");
    if (p.mode !== "pulse") return;
    const k = Math.max(0, (p.data.pulse?.dates ?? []).indexOf(p.afterKey));
    b.setPaintProperty("pulse", "fill-extrusion-height", pulseHeight(k) as never);
    b.setPaintProperty("pulse", "fill-extrusion-color", pulseColor(k) as never);
  }, [ready, p.mode, p.afterKey, p.data.pulse]);

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
