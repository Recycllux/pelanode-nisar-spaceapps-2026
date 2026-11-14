import { useEffect, useRef } from "react";
import type { Plugin } from "chart.js";
import { Chart } from "./charts";
import { COLORS } from "./config";
import type { yearRanking } from "./data";
import { num } from "./format";

type R = NonNullable<ReturnType<typeof yearRanking>>;

export function YearRanking({ ranking }: { ranking: R }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const rows = ranking.rows;
  const lo = Math.min(...rows.map((r) => r.median));
  const hi = Math.max(...rows.map((r) => r.median));
  const axisMin = Math.max(0, Math.floor((lo - (hi - lo) * 0.6) / 50) * 50);

  useEffect(() => {
    if (!cv.current) return;
    const valueLabels: Plugin<"bar"> = {
      id: "valueLabels",
      afterDatasetsDraw(c) {
        const { ctx } = c;
        const meta = c.getDatasetMeta(0);
        ctx.save();
        ctx.font = '10.5px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillStyle = "#d6d2c8";
        ctx.textBaseline = "middle";
        meta.data.forEach((bar, i) => {
          const r = rows[i];
          if (!r) return;
          const t = `${num(r.median)} km²${r.minLevel != null ? ` · min ${num(r.minLevel)} cm` : ""}`;
          ctx.fillText(t, bar.x + 6, bar.y);
        });
        ctx.restore();
      },
    };
    const colour = (y: number) => (y === 2026 ? COLORS.lost : y === 2022 ? COLORS.amber : COLORS.neutral);
    const ch = new Chart(cv.current, {
      type: "bar",
      data: {
        labels: rows.map((r) => String(r.year)),
        datasets: [{ data: rows.map((r) => r.median), backgroundColor: rows.map((r) => colour(r.year)), barPercentage: 0.72, categoryPercentage: 1 }],
      },
      options: {
        indexAxis: "y",
        maintainAspectRatio: false,
        layout: { padding: { right: 128 } },
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            min: axisMin,
            title: { display: true, text: `Median open water, km² (axis starts at ${num(axisMin)})`, color: COLORS.tick },
            ticks: { color: COLORS.tick, maxTicksLimit: 4 },
            grid: { color: COLORS.grid },
          },
          y: { ticks: { color: COLORS.tick, font: { family: '"IBM Plex Mono", monospace' } }, grid: { display: false } },
        },
      },
      plugins: [valueLabels],
    });
    return () => ch.destroy();
  }, [rows, axisMin]);

  return (
    <div className="ranking-box" role="img"
      aria-label={`Median Sentinel-1 open water in the Delta per season, ${rows[0]?.year}–${rows.at(-1)?.year}`}>
      <canvas ref={cv} />
    </div>
  );
}
