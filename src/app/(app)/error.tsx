"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Generic error boundary. Never shows error details (they may contain data). */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto max-w-md space-y-4 text-center">
      <h1 className="font-display text-2xl">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        We couldn&apos;t load this page. No changes were made to your data.
      </p>
      <Button onClick={reset}>Try again</Button>
    </Card>
  );
}
