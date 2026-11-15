import { GLOW, type Mode, type Pol } from "./config";
import { Tag } from "./Tag";

const GREY = ["#000000", "#404040", "#808080", "#bfbfbf", "#ffffff"];
const VIRIDIS = ["#fde725", "#5ec962", "#21918c", "#3b528b", "#440154"];

function Swatch({ color }: { color: string }) {
  return <i className="swatch" style={{ background: color }} aria-hidden />;
}
function Steps({ colors }: { colors: string[] }) {
  return (
    <i className="swatch-steps" aria-hidden>
      {colors.map((c) => (
        <b key={c} style={{ background: c }} />
      ))}
    </i>
  );
}

export function Legend({ mode, pol }: { mode: Mode; pol: Pol }) {
  const P = pol.toUpperCase();
  const items: Record<Mode, React.ReactNode> = {
    pulse: (
      <>
        <span><Swatch color={GLOW.kept} />Water kept</span>
        <span><Swatch color={GLOW.lost} />Water lost</span>
        <span><Swatch color={GLOW.gained} />Water appeared</span>
        <span className="text-muted-foreground">(since 18 Jun · press Play · hover for a spot's history)</span>
      </>
    ),
    water: (
      <>
        <span><Swatch color="var(--water)" />Open water</span>
        <span><Swatch color="var(--veg)" />Water under reeds / trees (L-band double bounce)</span>
        <span><Steps colors={GREY} />Radar {P} backscatter</span>
      </>
    ),
    radar: (
      <span><Steps colors={GREY} />NISAR {P} backscatter: dark = smooth water, bright = vegetation / flooded reeds</span>
    ),
    lost: (
      <>
        <span><Swatch color="var(--lost)" />Water lost</span>
        <span><Swatch color="var(--water)" />Water kept</span>
        <span><Swatch color="var(--veg)" />Water gained</span>
        <span className="text-muted-foreground">(before vs driest date per zone)</span>
      </>
    ),
    flood: (
      <>
        <span><Steps colors={VIRIDIS} />Isaccea level needed to keep this pixel wet: 0 cm (yellow) to 100 cm (purple)</span>
        <span className="text-muted-foreground">(Delta only; pixels that switch wet/dry cleanly with the river)</span>
      </>
    ),
    composite: (
      <>
        <span><Swatch color="#ff4040" />Red: brighter before (reeds dried out, water lost under vegetation)</span>
        <span><Swatch color="#40ffff" />Cyan: brighter after (sandbanks, vegetation emerging)</span>
        <span><Swatch color="#888888" />Grey: no change</span>
      </>
    ),
  };
  return (
    <div className="legend" aria-label="Map legend">
      {items[mode]}
      <Tag kind="real">Real · NISAR L2 GCOV</Tag>
    </div>
  );
}
