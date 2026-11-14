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
