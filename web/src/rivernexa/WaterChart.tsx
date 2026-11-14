import { useEffect, useRef } from "react";
import type { Plugin } from "chart.js";
import { Chart } from "./charts";
import { COLORS, ZONES, type ZoneKey } from "./config";
import { s1OpenWater, type Data } from "./data";
import { fmtIso, iso2key, key2iso } from "./format";

export function WaterChart({ data, zone, dateKey }: { data: Data; zone: ZoneKey; dateKey: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const cursor = useRef(dateKey);
  cursor.current = dateKey;

  const zm = data.manifest.zones[zone];
  const st = zm ? data.river.stations[zm.gauge] : undefined;

  useEffect(() => {
    if (!cv.current || !zm || !st) return;
    const gauge = zm.gauge;
    const labels = st.dates.filter((d) => d >= "2026-06-01");
    const off = st.dates.indexOf(labels[0] ?? "");
    const pick = <T,>(arr: T[]) => arr.slice(off, off + labels.length);
    const A = data.area[zone] ?? {};
    const s1 = s1OpenWater(data.s1, zone);
    const enr = st.enr_cm != null ? Number(st.enr_cm) : null;
    const stage = pick(st.stage);

    const bands: Plugin<"line"> = {
      id: "lowWater",
      beforeDatasetsDraw(c) {
        const { ctx, chartArea: a } = c;
        const x = c.scales["x"]!;
        const w = a.width / labels.length;
        ctx.save();
        ctx.fillStyle = "rgba(220,38,38,0.13)";
        stage.forEach((s, i) => {
          if (s != null && s >= 3) ctx.fillRect(x.getPixelForValue(i) - w / 2, a.top, w + 0.5, a.bottom - a.top);
        });
        ctx.restore();
      },
    };
    const cur: Plugin<"line"> = {
      id: "cursor",
      afterDatasetsDraw(c) {
        const i = labels.indexOf(key2iso(cursor.current));
        if (i < 0) return;
        const { ctx, chartArea: a } = c;
        const x = c.scales["x"]!;
        const px = x.getPixelForValue(i);
        ctx.save();
        ctx.strokeStyle = COLORS.accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, a.top);
        ctx.lineTo(px, a.bottom);
        ctx.stroke();
        ctx.restore();
      },
    };
    const gName = gauge.charAt(0).toUpperCase() + gauge.slice(1);
    const axis = { color: COLORS.tick };
    chart.current?.destroy();
    chart.current = new Chart(cv.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Water, total (km²)", data: labels.map((l) => A[iso2key(l)]?.total_water_km2 ?? null), yAxisID: "y",
            borderColor: COLORS.waterLine, backgroundColor: COLORS.waterLine, spanGaps: true, pointRadius: 3, borderWidth: 1.75 },
          { label: "Water under vegetation (km²)", data: labels.map((l) => A[iso2key(l)]?.under_vegetation_km2 ?? null), yAxisID: "y",
            borderColor: COLORS.vegLine, backgroundColor: COLORS.vegLine, spanGaps: true, pointRadius: 3, borderWidth: 1.75 },
          ...(s1 ? [{ label: "Open water, Sentinel-1 (km²)", data: labels.map((l) => s1[l] ?? null), yAxisID: "y",
            borderColor: COLORS.s1, backgroundColor: COLORS.s1, spanGaps: true, pointRadius: 1.5, borderWidth: 1.2, borderDash: [2, 2] }] : []),
          { label: `${gName} level (cm)`, data: pick(st.level_cm), yAxisID: "y1", borderColor: COLORS.level, backgroundColor: COLORS.level, pointRadius: 0, borderWidth: 1.25 },
          { label: "2015–2025 median (cm)", data: pick(st.p50), yAxisID: "y1", borderColor: COLORS.median, backgroundColor: COLORS.median, borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
          ...(enr != null ? [{ label: `Low-water mark ${enr} cm`, data: labels.map(() => enr), yAxisID: "y1",
            borderColor: COLORS.lostLine, backgroundColor: COLORS.lostLine, borderDash: [6, 3], pointRadius: 0, borderWidth: 1 }] : []),
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom", labels: { color: "#d6d2c8", boxWidth: 14, boxHeight: 1, padding: 8, font: { size: 10.5 } } },
          tooltip: { filter: (i) => i.raw != null, callbacks: { title: (it) => fmtIso(String(it[0]?.label ?? "")) } },
        },
        scales: {
          x: { ticks: { ...axis, maxTicksLimit: 6, maxRotation: 0, autoSkipPadding: 12,
            callback(v) { return fmtIso(this.getLabelForValue(Number(v))); } }, grid: { color: COLORS.grid } },
          y: { position: "left", beginAtZero: true, title: { display: true, text: "km² of water", ...axis }, ticks: axis, grid: { color: COLORS.grid } },
          y1: { position: "right", title: { display: true, text: "river level (cm)", ...axis }, ticks: axis, grid: { display: false } },
        },
      },
      plugins: [bands, cur],
    });
    return () => { chart.current?.destroy(); chart.current = null; };
  }, [data, zone, zm, st]);

  useEffect(() => { chart.current?.update("none"); }, [dateKey]);

  if (!zm || !st) return null;
  return (
    <div className="chart-box" role="img" aria-label={`Water area and ${zm.gauge} river level, ${ZONES[zone].name}, from 1 June 2026`}>
      <canvas ref={cv} />
    </div>
  );
}
