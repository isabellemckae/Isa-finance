"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  confirmTotpEnrollment,
  signIn,
  verifyTotp,
  type FormState,
} from "@/lib/auth/actions";

const initial: FormState = { error: null };

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-2xl bg-attention-soft px-4 py-3 text-sm text-attention">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FormError message={state.error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function CodeField() {
  return (
    <div>
      <Label htmlFor="code">6-digit code</Label>
      <Input
        id="code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        className="text-center font-mono text-xl tracking-[0.5em]"
      />
    </div>
  );
}

export function VerifyTotpForm() {
  const [state, action, pending] = useActionState(verifyTotp, initial);
  return (
    <form action={action} className="space-y-4">
      <CodeField />
      <FormError message={state.error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>
    </form>
  );
}

export function ConfirmEnrollmentForm({ factorId }: { factorId: string }) {
  const [state, action, pending] = useActionState(confirmTotpEnrollment, initial);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="factorId" value={factorId} />
      <CodeField />
      <FormError message={state.error} />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Confirming…" : "Turn on two-factor"}
      </Button>
    </form>
  );
}
