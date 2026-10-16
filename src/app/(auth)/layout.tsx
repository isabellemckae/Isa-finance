import { Brand } from "@/components/layout/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <Brand />
          <p className="mt-2 font-display text-sm italic text-muted-foreground">Your private personal CFO</p>
        </div>
        {children}
      </div>
    </div>
  );
}
