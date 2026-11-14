const TITLES = {
  real: "Measured by NISAR or river gauges",
  sim: "Illustration of a workflow: probe sites",
  future: "Model output: the forecast",
} as const;
const LABELS = { real: "Real", sim: "Simulated", future: "Future" } as const;

export function Tag({ kind, children }: { kind: keyof typeof TITLES; children?: React.ReactNode }) {
  return (
    <span className={`tag tag-${kind}`} title={TITLES[kind]}>
      {children ?? LABELS[kind]}
    </span>
  );
}

export function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) return null;
  return <span className={`tag ${status === "Validated" ? "tag-real" : "tag-sim"}`}>{status}</span>;
}

/** Visible key for the three labels (their meaning used to live only in hover tooltips). */
export function TagKey() {
  return (
    <dl className="tag-key" aria-label="What the labels mean">
      {(Object.keys(TITLES) as (keyof typeof TITLES)[]).map((k) => (
        <div key={k}>
          <dt><Tag kind={k} /></dt>
          <dd>{KEY_TEXT[k]}</dd>
        </div>
      ))}
    </dl>
  );
}
const KEY_TEXT = {
  real: "measured by NISAR, Sentinel-1 or river gauges",
  sim: "illustrates the workflow (probe sites)",
  future: "model output (the forecast)",
} as const;
