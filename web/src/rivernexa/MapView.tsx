import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { type Map as MLMap, type StyleSpecification, type ImageSource, type GeoJSONSource } from "maplibre-gl";
import { COLORS, CORRIDOR, OPERA_CREDIT, ZONES, ZONE_KEYS, type Mode, type Pol, type ZoneKey } from "./config";
import { dataUrl, type Data } from "./data";

export type FlyReq = { n: number; target: "corridor" | ZoneKey };

const OPACITY: Record<Mode, Record<string, number>> = {
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
    maps.current = { a, b };

    const addLayers = (map: MLMap) => {
      for (const z of ZONE_KEYS) {
        const m = manifest.zones[z];
        if (!m) continue;
        const d0 = m.dates[0];
        const rc = (m.radar_coordinates ?? m.coordinates) as never;
        const c = m.coordinates as never;
        map.addSource(`${z}-radar`, { type: "image", url: dataUrl(`${z}/${d0}_hh.webp`), coordinates: rc });
        map.addSource(`${z}-class`, { type: "image", url: dataUrl(`${z}/${d0}_class.png`), coordinates: c });
        map.addSource(`${z}-lost`, { type: "image", url: dataUrl(`${z}/lost.png`), coordinates: c });
        map.addSource(`${z}-comp`, { type: "image", url: dataUrl(`${z}/composite.webp`), coordinates: rc });
        const keys = ["radar", "comp", "class", "lost"];
        if (z === "delta") {
          map.addSource(`${z}-flood`, { type: "image", url: dataUrl(`${z}/flood_threshold.png`), coordinates: c });
          keys.push("flood");
        }
        for (const k of keys) {
          map.addLayer({
            id: `${z}-${k}`,
            type: "raster",
            source: `${z}-${k}`,
            paint: {
              "raster-opacity": 0,
              "raster-fade-duration": 0,
              "raster-resampling": k === "radar" || k === "comp" ? "linear" : "nearest",
            },
          });
        }
      }
      map.addSource("probes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "probes-ring", type: "circle", source: "probes",
        paint: { "circle-radius": 12, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": COLORS.sim, "circle-stroke-width": 1 } });
      map.addLayer({ id: "probes", type: "circle", source: "probes",
        paint: { "circle-radius": 5.5, "circle-color": COLORS.sim, "circle-stroke-color": "#f4f1ea", "circle-stroke-width": 1.5 } });
    };

    let loaded = 0;
    for (const m of [a, b]) {
      m.on("load", () => {
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
        set(`${z}-radar`, dataUrl(`${z}/${d}_${p.pol}.webp`), m.radar_coordinates ?? m.coordinates);
        set(`${z}-class`, dataUrl(`${z}/${d}_class.png`), m.coordinates);
        for (const [k, v] of Object.entries(OPACITY[p.mode]))
          if (map.getLayer(`${z}-${k}`)) map.setPaintProperty(`${z}-${k}`, "raster-opacity", v);
      }
    };
    apply(maps.current.b, "b", p.afterKey);
    apply(maps.current.a, "a", p.beforeKey);
  }, [ready, p.mode, p.pol, p.afterKey, p.beforeKey, p.data]);

  useEffect(() => {
    if (!ready || !maps.current) return;
    for (const m of [maps.current.a, maps.current.b])
      m.setTerrain(p.terrain ? { source: "dem", exaggeration: 6 } : null);
  }, [ready, p.terrain]);

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
      <div ref={aRef} className="map-layer" aria-hidden={!p.swipeOn} />
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
