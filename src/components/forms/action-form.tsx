"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/actions/run";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const idle: ActionState = { ok: false, message: null, error: null, at: 0 };

/**
 * A form bound to a server action, with an accessible status message.
 * Fields are passed as children (they can be server-rendered).
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
  inlineStatus = false,
  id,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  inlineStatus?: boolean;
  id?: string;
}) {
  const [state, formAction] = useActionState(action, idle);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {children}
      <FormStatusMessage state={state} className={inlineStatus ? "mt-0" : "mt-3"} />
    </form>
  );
}

export function FormStatusMessage({ state, className }: { state: ActionState; className?: string }) {
  if (!state.error && !state.message) return null;
  return state.error ? (
    <p role="alert" className={cn("flex items-start gap-2 rounded-2xl bg-attention-soft px-4 py-3 text-sm text-attention", className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {state.error}
    </p>
  ) : (
    <p role="status" className={cn("flex items-start gap-2 rounded-2xl bg-positive-soft px-4 py-3 text-sm text-positive", className)}>
      <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
      {state.message}
    </p>
  );
}

export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? (pendingLabel ?? "Saving…") : children}
    </Button>
  );
}
