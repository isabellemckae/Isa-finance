import { SectionTabs } from "@/components/layout/section-tabs";

const TABS = [
  { href: "/budget", label: "Plan" },
  { href: "/budget/bills", label: "Bills" },
  { href: "/budget/income", label: "Income" },
  { href: "/budget/paycheck", label: "Paycheck" },
  { href: "/budget/goals", label: "Goals" },
];

export default function BudgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <SectionTabs items={TABS} label="Budget sections" />
      {children}
    </div>
  );
}
