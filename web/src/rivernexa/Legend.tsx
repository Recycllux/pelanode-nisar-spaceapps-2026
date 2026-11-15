import { GLOW, type Mode, type Pol } from "./config";
import { Tag } from "./Tag";

const GREY = ["#040814", "#162a4a", "#284270", "#7e93b8", "#cde4ff"];  // radar night-blue ramp
const VIRIDIS = ["#ffd60a", "#ff8a6a", "#ff2ec4", "#b737e2", "#6e28ff"];  // flood ramp: yellow → magenta → violet

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
        <span><Swatch color="var(--gained)" />Water gained</span>
        <span className="text-muted-foreground">(before vs driest date per zone)</span>
      </>
    ),
    flood: (
      <>
        <span><Steps colors={VIRIDIS} />Isaccea level needed to keep this pixel wet: 0 cm (yellow) to 100 cm (violet)</span>
        <span className="text-muted-foreground">(Delta only; pixels that switch wet/dry cleanly with the river)</span>
      </>
    ),
    composite: (
      <>
        <span><Swatch color="#ff40ff" />Magenta: brighter before (reeds dried out, water lost under vegetation)</span>
        <span><Swatch color="#40ff40" />Green: brighter after (sandbanks, vegetation emerging)</span>
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
