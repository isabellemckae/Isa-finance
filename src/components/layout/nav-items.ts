import { ArrowLeftRight, Landmark, LayoutDashboard, PiggyBank, Sparkles } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Home", Icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", Icon: Landmark },
  { href: "/transactions", label: "Activity", Icon: ArrowLeftRight },
  { href: "/budget", label: "Budget", Icon: PiggyBank },
  { href: "/cfo", label: "CFO", Icon: Sparkles },
] as const;
