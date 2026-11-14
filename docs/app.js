/* RiverNexa web app. Plain JS, no build step. Data in ./data (see pipeline/g1_products.py). */
(async function () {
  "use strict";

  const ZONES = {
    delta: { name: "Danube Delta", short: "Delta", center: [29.17, 45.12], zoom: 9.3, pitch: 50, bearing: -12 },
    cernavoda: { name: "Cernavodă", short: "Cernavodă", center: [28.05, 44.335], zoom: 11.6, pitch: 45, bearing: 20 },
    balta_mica_brailei: { name: "Balta Mică a Brăilei", short: "Balta Mică", center: [27.975, 45.075], zoom: 10.2, pitch: 45, bearing: 0 },
  };
  const CORRIDOR = [[27.85, 44.2], [29.75, 45.5]];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (d) => `${+d.slice(6, 8)} ${MONTHS[+d.slice(4, 6) - 1]}`;
  const iso2key = (s) => s.replaceAll("-", "");
  const km = (x) => Math.round(x).toLocaleString("en-GB");

  async function getJSON(url, optional) {
    try { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return await r.json(); }
    catch (e) { if (optional) return null; throw e; }
  }
  async function getCSV(url) {
    const t = await (await fetch(url)).text();
    const [head, ...rows] = t.trim().split(/\r?\n/);
    const keys = head.split(",");
    return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], isNaN(+v) || v === "" ? v : +v])));
  }

  const [manifest, areas, river, probes, evidence, analysis, forecast, s1, s1fc] = await Promise.all([
    getJSON("data/manifest.json"), getCSV("data/areas.csv"), getJSON("data/river.json"),
    getJSON("data/probes.json", true), getJSON("data/evidence.json", true),
    getJSON("data/analysis.json", true), getJSON("data/forecast.json", true),
    getJSON("data/s1.json", true), getJSON("data/s1_forecast.json", true),
  ]);
  const DATES = manifest.zones.delta.dates;
  const area = {}; // area[zone][yyyymmdd] = row
  for (const r of areas) (area[r.zone] ??= {})[iso2key(r.date)] = r;

  const state = { zone: "delta", idx: DATES.indexOf("20261016"), mode: "water", pol: "hh", swipe: false, terrain: true, step: 0 };

  /* ---------------- maps ---------------- */
  const baseStyle = {
    version: 8,
    sources: {
      s2: {
        type: "raster", tileSize: 256, maxzoom: 15,
        tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg"],
        attribution: '<a href="https://s2maps.eu">Sentinel-2 cloudless</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016)',
      },
      dem: {
        type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 14,
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</a>',
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0b1220" } },
      { id: "s2", type: "raster", source: "s2", paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.8 } },
    ],
  };
  const mk = (id) => new maplibregl.Map({
    container: id, style: JSON.parse(JSON.stringify(baseStyle)), bounds: CORRIDOR,
    fitBoundsOptions: { padding: 40 }, maxPitch: 75, attributionControl: { compact: true }, fadeDuration: 0,
  });
  const mapA = mk("map-before"); // left / before
  const mapB = mk("map-after");  // right / after (on top)
  mapB.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  await Promise.all([mapA, mapB].map((m) => new Promise((res) => m.on("load", res))));

  const radarUrl = (z, d, pol) => `data/${z}/${d}_${pol}.webp`;
  const classUrl = (z, d) => `data/${z}/${d}_class.png`;
  function addZoneLayers(map) {
    for (const z of Object.keys(ZONES)) {
      const m = manifest.zones[z];
      const d0 = m.dates[0];
      map.addSource(`${z}-radar`, { type: "image", url: radarUrl(z, d0, "hh"), coordinates: m.radar_coordinates || m.coordinates });
      map.addSource(`${z}-class`, { type: "image", url: classUrl(z, d0), coordinates: m.coordinates });
      map.addSource(`${z}-lost`, { type: "image", url: `data/${z}/lost.png`, coordinates: m.coordinates });
      map.addSource(`${z}-comp`, { type: "image", url: `data/${z}/composite.webp`, coordinates: m.radar_coordinates || m.coordinates });
      if (z === "delta") map.addSource(`${z}-flood`, { type: "image", url: `data/${z}/flood_threshold.png`, coordinates: m.coordinates });
      for (const k of ["radar", "comp", "class", "lost", ...(z === "delta" ? ["flood"] : [])]) {
        map.addLayer({ id: `${z}-${k}`, type: "raster", source: `${z}-${k}`,
          paint: { "raster-opacity": 0, "raster-fade-duration": 0, "raster-resampling": k === "radar" || k === "comp" ? "linear" : "nearest" } });
      }
    }
    map.addSource("probes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "probes-halo", type: "circle", source: "probes", paint: { "circle-radius": 14, "circle-color": "#f59e0b", "circle-opacity": 0.25 } });
    map.addLayer({ id: "probes", type: "circle", source: "probes", paint: { "circle-radius": 6, "circle-color": "#f59e0b", "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
  }
  addZoneLayers(mapA); addZoneLayers(mapB);
  mapB.on("click", "probes", (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`<b>${p.label}</b><br>${p.text}<br><i>Simulated</i>`).addTo(mapB);
  });

  function setTerrain(on) {
    for (const m of [mapA, mapB]) m.setTerrain(on ? { source: "dem", exaggeration: 6 } : null);
  }
  setTerrain(true);

  // keep the two maps in step
  let syncing = false;
  function sync(from, to) {
    from.on("move", () => {
      if (syncing) return; syncing = true;
      to.jumpTo({ center: from.getCenter(), zoom: from.getZoom(), bearing: from.getBearing(), pitch: from.getPitch() });
      syncing = false;
    });
  }
  sync(mapA, mapB); sync(mapB, mapA);

  /* ---------------- layer state ---------------- */
  const OPACITY = {
    water: { radar: 0.9, comp: 0, class: 0.85, lost: 0, flood: 0 },
    radar: { radar: 1, comp: 0, class: 0, lost: 0, flood: 0 },
    lost: { radar: 0.55, comp: 0, class: 0, lost: 0.95, flood: 0 },
    composite: { radar: 0, comp: 1, class: 0, lost: 0, flood: 0 },
    flood: { radar: 0.5, comp: 0, class: 0, lost: 0, flood: 0.95 },
  };
  function applyLayers(map, date) {
    for (const z of Object.keys(ZONES)) {
      const d = manifest.zones[z].dates.includes(date) ? date : manifest.zones[z].dates[0];
      map.getSource(`${z}-radar`).updateImage({ url: radarUrl(z, d, state.pol), coordinates: manifest.zones[z].radar_coordinates || manifest.zones[z].coordinates });
      map.getSource(`${z}-class`).updateImage({ url: classUrl(z, d), coordinates: manifest.zones[z].coordinates });
      for (const [k, v] of Object.entries(OPACITY[state.mode])) if (map.getLayer(`${z}-${k}`)) map.setPaintProperty(`${z}-${k}`, "raster-opacity", v);
    }
  }
  const beforeDate = () => manifest.zones[state.zone].before;
  const afterDate = () => DATES[state.idx];

  function render() {
    applyLayers(mapB, afterDate());
    applyLayers(mapA, beforeDate());
    // swipe only makes sense for date-dependent layers
    const canSwipe = state.mode === "water" || state.mode === "radar";
    const swipeOn = state.swipe && canSwipe;
    document.getElementById("swipe").hidden = !swipeOn;
    document.getElementById("swipe-labels").hidden = !swipeOn;
    document.getElementById("swipe-toggle").disabled = !canSwipe;
    mapB.getContainer().style.clipPath = swipeOn ? `inset(0 0 0 ${swipeX}px)` : "inset(0 0 0 0)";
    document.getElementById("lbl-before").textContent = `◀ ${fmtDate(beforeDate())} (before)`;
    document.getElementById("lbl-after").textContent = `${fmtDate(afterDate())} ▶`;
    // timeline
    const d = afterDate();
    document.getElementById("slider").value = state.idx;
    document.getElementById("date-label").textContent = `NISAR ${fmtDate(d)} 2026 · track 065 descending`;
    const st = manifest.zones.delta.status[d];
    const sb = document.getElementById("status-badge");
    sb.textContent = st; sb.className = `badge small ${st === "Validated" ? "val" : "prov"}`;
    document.getElementById("gap-note").textContent = d === "20260817" ? "No NISAR data 24 Jul – 17 Aug on this track" : "";
    updateCounter(); updateLegend(); updateChartCursor();
    document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
    document.querySelectorAll("#pol button").forEach((b) => b.classList.toggle("on", b.dataset.pol === state.pol));
  }

  function updateCounter() {
    const z = state.zone;
    let b = beforeDate(), a = afterDate();
    if (state.mode === "lost" || state.mode === "composite" || state.mode === "flood") a = manifest.zones[z].after;
    const A = area[z][a], B = area[z][b];
    const el = document.getElementById("counter-num");
    if (!A || !B) { el.textContent = "–"; return; }
    const dv = A.total_water_km2 - B.total_water_km2;
    el.textContent = `${dv < 0 ? "−" : "+"}${km(Math.abs(dv))} km²`;
    el.classList.toggle("up", dv >= 0);
    const pct = B.total_water_km2 ? Math.round((100 * dv) / B.total_water_km2) : 0;
    document.getElementById("counter-sub").innerHTML =
      `water in ${ZONES[z].name}, ${fmtDate(b)} → ${fmtDate(a)} (${pct > 0 ? "+" : ""}${pct}%)<br>` +
      `under vegetation ${km(B.under_vegetation_km2)} → ${km(A.under_vegetation_km2)} km² <span class="tag real">Real</span>`;
  }

  function updateLegend() {
    const L = {
      water: `<span><i style="background:var(--water)"></i>Open water</span><span><i style="background:var(--veg)"></i>Water under reeds / trees (L-band double bounce)</span><span><i style="background:linear-gradient(90deg,#000,#fff)"></i>Radar ${state.pol.toUpperCase()} backscatter</span>`,
      radar: `<span><i style="background:linear-gradient(90deg,#000,#fff)"></i>NISAR ${state.pol.toUpperCase()} backscatter: dark = smooth water, bright = vegetation / flooded reeds</span>`,
      lost: `<span><i style="background:var(--lost)"></i>Water lost</span><span><i style="background:var(--water)"></i>Water kept</span><span><i style="background:var(--veg)"></i>Water gained</span><span>(before vs driest date per zone)</span>`,
      flood: `<span><i style="background:linear-gradient(90deg,#fde725,#440154)"></i>Isaccea level needed to keep this pixel wet: 0 cm (yellow) to 100 cm (purple)</span><span>(Delta only; pixels that switch wet/dry cleanly with the river)</span>`,
      composite: `<span><i style="background:#ff4040"></i>Red: brighter before (reeds dried out, water lost under vegetation)</span><span><i style="background:#40ffff"></i>Cyan: brighter after (sandbanks, vegetation emerging)</span><span><i style="background:#888"></i>Grey: no change</span>`,
    };
    document.getElementById("legend").innerHTML = L[state.mode] + ` <span class="tag real">Real · NISAR L2 GCOV</span>`;
  }

  /* ---------------- swipe ---------------- */
  let swipeX = 0;
  const wrap = document.getElementById("mapwrap");
  function setSwipe(x) {
    const w = wrap.clientWidth; swipeX = Math.max(0, Math.min(w, x));
    document.getElementById("swipe").style.left = `${swipeX}px`;
    if (state.swipe) mapB.getContainer().style.clipPath = `inset(0 0 0 ${swipeX}px)`;
  }
  setSwipe(wrap.clientWidth / 2);
  window.addEventListener("resize", () => setSwipe(wrap.clientWidth / 2));
  const handle = document.getElementById("swipe-handle");
  let dragging = false;
  handle.addEventListener("pointerdown", (e) => { dragging = true; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener("pointermove", (e) => { if (dragging) setSwipe(e.clientX - wrap.getBoundingClientRect().left); });
  handle.addEventListener("pointerup", () => { dragging = false; });
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") setSwipe(swipeX - 20);
    if (e.key === "ArrowRight") setSwipe(swipeX + 20);
  });

  /* ---------------- controls ---------------- */
  const ticks = document.getElementById("ticks");
  ticks.innerHTML = DATES.map((d) => `<span>${fmtDate(d)}</span>`).join("");
  document.getElementById("slider").addEventListener("input", (e) => { state.idx = +e.target.value; render(); });
  document.getElementById("mode").addEventListener("click", (e) => { if (e.target.dataset.mode) { state.mode = e.target.dataset.mode; render(); } });
  document.getElementById("pol").addEventListener("click", (e) => { if (e.target.dataset.pol) { state.pol = e.target.dataset.pol; render(); } });
  document.getElementById("swipe-toggle").addEventListener("change", (e) => { state.swipe = e.target.checked; render(); });
  document.getElementById("terrain-toggle").addEventListener("change", (e) => { state.terrain = e.target.checked; setTerrain(state.terrain); });
  mapB.on("moveend", () => {
    // the counter follows the zone nearest the map centre
    const c = mapB.getCenter();
    let best = state.zone, bd = Infinity;
    for (const [z, v] of Object.entries(ZONES)) {
      const dd = (v.center[0] - c.lng) ** 2 + (v.center[1] - c.lat) ** 2;
      if (dd < bd) { bd = dd; best = z; }
    }
    if (best !== state.zone) { state.zone = best; render(); }
  });

  /* ---------------- chart ---------------- */
  const zoneSel = document.getElementById("chart-zone");
  zoneSel.innerHTML = Object.entries(ZONES).map(([z, v]) => `<option value="${z}">${v.name}</option>`).join("");
  let chart;
  const stageBands = {
    id: "stageBands",
    beforeDatasetsDraw(c) {
      const st = river.stations[c.$gauge];
      if (!st) return;
      const { ctx, chartArea: a, scales: { x } } = c;
      ctx.save(); ctx.fillStyle = "rgba(220,38,38,0.10)";
      c.data.labels.forEach((lab, i) => {
        const j = st.dates.indexOf(lab);
        if (j >= 0 && st.stage[j] >= 3) {
          const x0 = x.getPixelForValue(i) - 0.5 * (a.width / c.data.labels.length);
          ctx.fillRect(x0, a.top, a.width / c.data.labels.length + 0.5, a.bottom - a.top);
        }
      });
      ctx.restore();
    },
  };
  const cursorPlugin = {
    id: "cursor",
    afterDatasetsDraw(c) {
      const lab = `${afterDate().slice(0, 4)}-${afterDate().slice(4, 6)}-${afterDate().slice(6)}`;
      const i = c.data.labels.indexOf(lab); if (i < 0) return;
      const { ctx, chartArea: a, scales: { x } } = c; const px = x.getPixelForValue(i);
      ctx.save(); ctx.strokeStyle = "#38bdf8"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); ctx.restore();
    },
  };
  function buildChart(z) {
    const gauge = manifest.zones[z].gauge;
    const st = river.stations[gauge];
    const labels = st.dates.filter((d) => d >= "2026-06-01");
    const off = st.dates.indexOf(labels[0]);
    const pick = (arr) => arr.slice(off, off + labels.length);
    const wTot = labels.map((l) => area[z][iso2key(l)]?.total_water_km2 ?? null);
    const wVeg = labels.map((l) => area[z][iso2key(l)]?.under_vegetation_km2 ?? null);
    const cfg = {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Water, total (km²)", data: wTot, yAxisID: "y", borderColor: "#60a5fa", backgroundColor: "#60a5fa", spanGaps: true, pointRadius: 4, borderWidth: 2 },
          { label: "Water under vegetation (km²)", data: wVeg, yAxisID: "y", borderColor: "#22c55e", backgroundColor: "#22c55e", spanGaps: true, pointRadius: 4, borderWidth: 2 },
          ...(s1?.series?.[z] ? [{ label: "Open water, Sentinel-1 (km²)", yAxisID: "y", borderColor: "#a78bfa", backgroundColor: "#a78bfa", spanGaps: true, pointRadius: 2, borderWidth: 1.2, borderDash: [2, 2],
            data: (() => { const S = s1.series[z]; const m = {}; S.dates.forEach((d, i) => { if (!S.flag_wind[i]) m[d] = S.open_water_km2[i]; }); return labels.map((l) => m[l] ?? null); })() }] : []),
          { label: `${gauge[0].toUpperCase() + gauge.slice(1)} level (cm)`, data: pick(st.level_cm), yAxisID: "y1", borderColor: "#e5e7eb", pointRadius: 0, borderWidth: 1.5 },
          { label: "2015–2025 median (cm)", data: pick(st.p50), yAxisID: "y1", borderColor: "#9ca3af", borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
          ...(st.enr_cm != null ? [{ label: `Low-water mark ${st.enr_cm} cm`, data: labels.map(() => st.enr_cm), yAxisID: "y1", borderColor: "#f87171", borderDash: [6, 3], pointRadius: 0, borderWidth: 1 }] : []),
        ],
      },
      options: {
        animation: false, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        plugins: { legend: { labels: { color: "#cbd5e1", boxWidth: 10, font: { size: 10.5 } } },
          tooltip: { filter: (i) => i.raw != null } },
        scales: {
          x: { ticks: { color: "#94a3b8", maxTicksLimit: 6, maxRotation: 0, autoSkipPadding: 12, callback(v) { const l = this.getLabelForValue(v); return `${+l.slice(8)} ${MONTHS[+l.slice(5, 7) - 1]}`; } }, grid: { color: "#1e293b" } },
          y: { position: "left", title: { display: true, text: "km² of water", color: "#94a3b8" }, ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" }, beginAtZero: true },
          y1: { position: "right", title: { display: true, text: "river level (cm)", color: "#94a3b8" }, ticks: { color: "#94a3b8" }, grid: { display: false } },
        },
      },
      plugins: [stageBands, cursorPlugin],
    };
    if (chart) chart.destroy();
    const cv = document.getElementById("chart");
    chart = new Chart(cv, cfg); chart.$gauge = gauge;
    document.getElementById("chart-note").innerHTML =
      `Red bands: days the gauge was below its official low-water mark. Water areas from NISAR (L-band) and Sentinel-1 (C-band, open water only, windy dates left out) (<span class="tag real">Real</span>), levels from DanubeAlert (<span class="tag real">Real</span>). Correlation, not proof of cause.`;
  }
  function updateChartCursor() { if (chart) chart.update("none"); }
  zoneSel.addEventListener("change", () => buildChart(zoneSel.value));
  buildChart("delta");

  /* ---------------- story ---------------- */
  const isa = river.stations.isaccea;
  const isaSummer = isa.dates.map((d, i) => [d, isa.level_cm[i], isa.stage[i]]).filter(([d]) => d >= "2026-06-01");
  const belowENR = isaSummer.filter(([, l]) => l < isa.enr_cm).length;
  const recordDays = isaSummer.filter(([, , s]) => s === 4).length;
  const minRow = isaSummer.reduce((m, r) => (r[1] < m[1] ? r : m));
  const D = area.delta, d0 = manifest.zones.delta.before, d1 = manifest.zones.delta.after;
  const lostVeg = D[d0].under_vegetation_km2 - D[d1].under_vegetation_km2;
  const pctVeg = Math.round((100 * lostVeg) / D[d0].under_vegetation_km2);

  const STEPS = [
    { key: "overview", title: "Overview",
      go() { state.mode = "lost"; state.swipe = false; flyCorridor(); },
      html: () => `<h2>The Danube is running out of water</h2>
        <p>NISAR's L-band radar sees through cloud and through reeds. Between ${fmtDate(d0)} and ${fmtDate(d1)} 2026 it watched the Lower Danube dry out.</p>
        <div class="kpis">
          <div class="kpi"><b>−${km(lostVeg)} km²</b><span>water under the Delta's reeds (−${pctVeg}%)</span></div>
          <div class="kpi"><b>${belowENR} days</b><span>Isaccea below its low-water mark (${isa.enr_cm} cm) since June</span></div>
          <div class="kpi"><b>${minRow[1]} cm</b><span>lowest Isaccea level, ${fmtDate(iso2key(minRow[0]))}</span></div>
          <div class="kpi"><b>${recordDays} days</b><span>below the 2015–2025 minimum for that day</span></div>
        </div>
        <p>Red on the map is water that was there in June and is gone now. Use the steps above to fly through three places.</p>
        <p class="note">Designed for the Danube Delta Biosphere Reserve Administration (ARBDD) as an early-warning indicator.</p>` },
    { key: "delta", title: "Delta",
      go() { focus("delta"); state.mode = "water"; state.idx = DATES.indexOf(d1); state.swipe = true; },
      html: () => `<h2>Danube Delta: the water hidden under reeds</h2>
        <p>Optical satellites see the open lakes and channels, and those barely changed: ${km(D[d0].open_water_km2)} → ${km(D[d1].open_water_km2)} km².</p>
        <p>L-band radar sees more. When reeds stand in water, the signal bounces off the water and back up the stems (a "double bounce"), so flooded reeds shine in <b>HH</b> but not in <b>HV</b>. That water went from <b>${km(D[d0].under_vegetation_km2)}</b> to <b>${km(D[d1].under_vegetation_km2)} km²</b>.</p>
        <p>Drag the white bar to compare ${fmtDate(d0)} with any date, and toggle HH / HV to see the effect.</p>` },
    { key: "cernavoda", title: "Cernavodă",
      go() { focus("cernavoda"); state.mode = "composite"; state.idx = DATES.indexOf("20260817"); state.swipe = false; },
      html: () => {
        const c = area.cernavoda, g = river.stations.cernavoda;
        const lv = (d) => g.level_cm[g.dates.indexOf(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`)];
        return `<h2>Cernavodă: sandbanks in the channel</h2>
        <p>The gauge fell from ${lv("20260724")} cm on 24 Jul to ${lv("20260817")} cm on 17 Aug (low-water mark ${g.enr_cm} cm). In the colour composite, cyan specks in the river are sandbanks that turned bright as the water dropped.</p>
        <p>At 20 m pixels the change is small (${km(c["20260724"].total_water_km2)} → ${km(c["20260817"].total_water_km2)} km² in the zone), but it sits right in the shipping channel.</p>
        <p class="note">Data gap: this track has no NISAR acquisition between 24 Jul and 17 Aug.</p>`; } },
    { key: "balta", title: "Balta Mică",
      go() { focus("balta_mica_brailei"); state.mode = "water"; state.idx = DATES.indexOf(d1); state.swipe = true; },
      html: () => { const b = area.balta_mica_brailei;
        return `<h2>Balta Mică a Brăilei: a control case</h2>
        <p>Most of this zone is dyked farmland, so river level reaches little of it. Mapped water stays roughly flat: ${km(b[d0].total_water_km2)} → ${km(b[d1].total_water_km2)} km².</p>
        <p>That contrast matters: the radar is not simply "drying everything". The losses concentrate where the river still floods the land, in the Delta.</p>`; } },
    { key: "river", title: "River levels",
      go() { focus("delta"); state.mode = "flood"; },
      html: () => {
        const best = analysis ? analysis.lag.reduce((m, r) => (r.rho_under_veg > m.rho_under_veg ? r : m)) : null;
        const ft = analysis?.flood_threshold;
        return `<h2>Water area follows the river</h2>
        <p>The chart below puts the NISAR water area next to the DanubeAlert gauge. Pick a zone to compare.</p>
        <p>Water under the Delta's reeds collapses once Isaccea drops below its low-water mark in early July, and stays low.</p>
        ${best ? `<p><b>Lag:</b> the reed water matches the Isaccea level from about <b>${best.lag_days} days earlier</b> best (Spearman ρ = ${best.rho_under_veg.toFixed(2)}, 11 dates). A falling gauge gives roughly a week of warning. <span class="tag real">Real</span></p>` : ""}
        ${s1 ? (() => { const Y = Object.entries(s1.years).map(([y, r]) => [+y, r.median_km2, r.min_level_cm]); const max = Math.max(...Y.map((r) => r[1]));
          const rank = [...Y].sort((a, b) => a[1] - b[1]).findIndex((r) => r[0] === 2026) + 1;
          return `<p><b>Ten years of Sentinel-1:</b> typical open water in the Delta, June–November. 2026 ranks ${rank === 1 ? "lowest" : "#" + rank} of ${Y.length} years. Open water shrinks only a little; the big loss is under the reeds, which only L-band sees. <span class="tag real">Real</span></p>
          <div style="display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;font-size:12px;align-items:center">${Y.map(([y, v, l]) => `<span>${y}</span><span style="display:block;height:9px;border-radius:3px;background:${y === 2026 ? "#f87171" : y === 2022 ? "#fbbf24" : "#60a5fa"};width:${Math.round(100 * (v - 700) / (max - 700))}%"></span><span>${km(v)} km² · min ${l} cm</span>`).join("")}</div>
          <p class="note">Median of non-windy Sentinel-1 dates per season; "min" is the lowest Isaccea level on those dates. 2022 (amber) was the previous big drought.</p>`; })() : ""}
        ${ft ? `<p><b>Flooding threshold map</b> (map mode "Flood threshold"): for ${km(ft.km2)} km² of the Delta we can read the Isaccea level each spot needs to stay wet. Half of that area needs at least ${Math.round(ft.median_cm)} cm to be wet, a level Isaccea has not reached since early July. <span class="tag real">Real</span></p>` : ""}`; } },
    { key: "why", title: "Why it changed",
      go() { state.mode = "lost"; flyCorridor(); },
      html: () => `<h2>Why it changed</h2>
        <ul>
          <li><b>Low inflow.</b> All seven Romanian gauges from Cernavodă to Tulcea fell below their official low-water marks in early July and stayed there <span class="tag real">Real</span>.</li>
          <li><b>Record lows.</b> Isaccea spent ${recordDays} days below the lowest level recorded for that day in 2015–2025 <span class="tag real">Real</span>.</li>
          ${(evidence?.items || []).map((e) => `<li><b>${e.title}.</b> ${e.text} ${e.url ? `<a href="${e.url}" target="_blank" rel="noopener">source</a>` : ""} <span class="tag real">Real</span></li>`).join("")}
        </ul>
        <p class="note">Every external figure is linked to its source. River data © DanubeAlert (CC BY 4.0).</p>` },
    { key: "loop", title: "Close the loop",
      go() { focus("delta"); state.mode = "lost"; showProbes(true); },
      html: () => `<h2>Close the loop: where to send field probes</h2>
        <p>The places where water disappeared fastest become proposed probe sites. A probe there would confirm whether the reeds are dry and how deep the water is. <span class="tag sim">Simulated</span></p>
        ${probes ? `<ul class="probe-list">${probes.features.map((f) => `<li><span class="dot"></span><span><b>${f.properties.label}</b> ${f.properties.text}</span></li>`).join("")}</ul>` : "<p class=\"note\">Probe sites are being computed.</p>"}
        <p class="note">The probe network does not exist yet. It shows how ARBDD could act on the radar signal. <span class="tag future">Future</span></p>
        ${forecast ? `<h3 style="margin-top:12px">Next 12 days <span class="tag future">Future</span></h3>
        <p>A TabPFN-3.5 model trained on the 2026 NISAR series expects about <b>${km(forecast.forecast.p50_km2)} km²</b> of water under the Delta's vegetation on ${fmtDate(iso2key(forecast.forecast.date))} (rough range ${km(forecast.forecast.p10_km2)}–${km(forecast.forecast.p90_km2)}), against ${km(forecast.forecast.last_observed_km2)} km² observed on ${fmtDate(iso2key(forecast.forecast.from_date))}.</p>
        <p class="note">Tested on the last five dates without peeking: area error ${forecast.metrics["tabpfn_3.5"].area_mae_km2} km², vs ${forecast.metrics.persistence.area_mae_km2} km² for "no change" and ${forecast.metrics.gradient_boosting.area_mae_km2} km² for gradient boosting. ${forecast.metrics["tabpfn_3.5"].area_mae_km2 < forecast.metrics.persistence.area_mae_km2 ? "Only a small gain" : "No gain over \"no change\" yet"} in a flat drought period: treat it as a hint, not a forecast.</p>` : ""}
        ${s1fc?.tests?.["2026"] ? `<p class="note"><b>Trained on ten years of Sentinel-1</b> (2016–2024), the same TabPFN-3.5 setup predicts Delta open water 6–12 days ahead with an area error of ${s1fc.tests["2026"].metrics["tabpfn_3.5"].area_mae_km2} km² in 2026 and ${s1fc.tests["2025"].metrics["tabpfn_3.5"].area_mae_km2} km² in 2025, against ${s1fc.tests["2026"].metrics.persistence.area_mae_km2} and ${s1fc.tests["2025"].metrics.persistence.area_mae_km2} km² for "no change". More history makes the model useful. <span class="tag future">Future</span></p>` : ""}` },
    { key: "about", title: "About",
      go() {},
      html: () => `<h2>Method and limits</h2>
        <ul>
          <li><b>Sentinel-1:</b> NASA OPERA RTC-S1 (C-band, 30 m, track 036), 2016–2026, open water only; used to fill NISAR's gap, check its maps and give ten years of context.</li>
          <li><b>Data:</b> NISAR L2 GCOV (ASF DAAC), track 065 descending, frames 065 + 066, 11 dates 18 Jun – 28 Oct 2026, HH + HV at 20 m. Dates before 28 Oct are Provisional.</li>
          <li><b>Open water:</b> per-date reference to permanent water (JRC Global Surface Water), inside the area that has ever been water, then refined with SAM 2.1.</li>
          <li><b>Water under vegetation:</b> HH double bounce (bright HH, high HH/HV ratio) in reeds and floodplain forest (ESA WorldCover), below 5 m above drainage (HAND).</li>
          <li><b>Limits:</b> reeds also change through the summer, which dims HH. Wind can brighten open water. Correlation with river level, not proof of cause.</li>
        </ul>
        <p>Code, references and AI-use disclosure: see the project README.</p>` },
  ];
  function flyCorridor() { mapB.fitBounds(CORRIDOR, { padding: 40, pitch: 55, bearing: -15, duration: 2500 }); state.zone = "delta"; }
  function focus(z) { const v = ZONES[z]; state.zone = z; mapB.flyTo({ center: v.center, zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, duration: 2200 }); zoneSel.value = z; buildChart(z); }
  function showProbes(on) {
    const fc = on && probes ? probes : { type: "FeatureCollection", features: [] };
    for (const m of [mapA, mapB]) m.getSource("probes").setData(fc);
  }
  const stepsEl = document.getElementById("steps");
  stepsEl.innerHTML = STEPS.map((s, i) => `<button data-i="${i}">${i + 1}. ${s.title}</button>`).join("");
  function goStep(i) {
    state.step = i; const s = STEPS[i];
    showProbes(false); s.go();
    document.getElementById("swipe-toggle").checked = state.swipe;
    document.getElementById("story").innerHTML = s.html();
    stepsEl.querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
    render();
  }
  stepsEl.addEventListener("click", (e) => { if (e.target.dataset.i) goStep(+e.target.dataset.i); });
  const startStep = Math.max(0, STEPS.findIndex((s) => s.key === new URLSearchParams(location.search).get("step")));
  goStep(startStep);
  window.rivernexa = { state, goStep, mapA, mapB };
})();
