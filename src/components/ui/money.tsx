import { formatMoney, type FormatMoneyOptions } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

/** Renders an amount with tabular figures and an explicit accessible description. */
export function Money({
  minor,
  currency,
  options,
  className,
  colorize = false,
}: {
  minor: number;
  currency: string;
  options?: FormatMoneyOptions;
  className?: string;
  /** Tint inflows green. Outflows stay in the default ink. */
  colorize?: boolean;
}) {
  const text = formatMoney(minor, currency, options);
  return (
    <span className={cn("tabular", colorize && minor > 0 && "text-positive", className)}>{text}</span>
  );
}
