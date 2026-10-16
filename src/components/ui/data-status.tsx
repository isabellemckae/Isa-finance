import { AlertTriangle, CircleDashed, Clock, HelpCircle, Sparkles } from "lucide-react";
import { Badge } from "./badge";

/**
 * The one way the UI labels data quality. Every figure that is not plain, fresh,
 * posted data carries one of these, with an icon and text (never color alone).
 */
export type DataStatusKind = "pending" | "estimated" | "stale" | "unavailable" | "demo";

const config: Record<DataStatusKind, { label: string; variant: "neutral" | "attention" | "info" | "blush"; Icon: typeof Clock }> = {
  pending: { label: "Pending", variant: "neutral", Icon: Clock },
  estimated: { label: "Estimated", variant: "info", Icon: CircleDashed },
  stale: { label: "Out of date", variant: "attention", Icon: AlertTriangle },
  unavailable: { label: "Unavailable", variant: "attention", Icon: HelpCircle },
  demo: { label: "Fictional", variant: "blush", Icon: Sparkles },
};

export function DataStatus({ kind, label }: { kind: DataStatusKind; label?: string }) {
  const { label: defaultLabel, variant, Icon } = config[kind];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {label ?? defaultLabel}
    </Badge>
  );
}
