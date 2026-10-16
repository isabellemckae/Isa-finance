import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Form controls sized for touch (44px+) with 16px text so iOS Safari doesn't zoom. */

const control =
  "w-full rounded-2xl border border-border bg-surface px-4 text-base text-foreground placeholder:text-subtle-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50";

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, "h-12", className)} {...props} />;
}

/** Decimal amount entry. Parsed strictly on the server (no rounding). */
export function MoneyInput({ className, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <div className="relative">
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-muted-foreground">
        $
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn(control, "tabular h-12 pl-8", className)}
        {...props}
      />
    </div>
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select className={cn(control, "h-12 appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24 py-3", className)} {...props} />;
}

export function Checkbox({
  label,
  description,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; description?: string }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl py-2", className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 rounded-md accent-[var(--accent-ink)]" {...props} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}
