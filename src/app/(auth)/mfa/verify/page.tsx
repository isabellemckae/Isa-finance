import { ShieldCheck } from "lucide-react";
import { requireMfaStep } from "@/lib/auth/dal";
import { signOut } from "@/lib/auth/actions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VerifyTotpForm } from "@/components/auth/forms";

export const metadata = { title: "Verify it's you" };

export default async function VerifyPage() {
  await requireMfaStep("mfa-verify");
  return (
    <Card className="space-y-6">
      <div>
        <ShieldCheck className="mb-3 size-6 text-accent-ink" aria-hidden />
        <h1 className="font-display text-2xl">Verify it&apos;s you</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the code from your authenticator app.</p>
      </div>
      <VerifyTotpForm />
      <form action={signOut}>
        <Button type="submit" variant="link" className="w-full">
          Sign out
        </Button>
      </form>
    </Card>
  );
}
