import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-3xl">Page not found</h1>
      <Link href="/" className="text-sm font-medium text-accent-ink">
        Back to dashboard
      </Link>
    </main>
  );
}
