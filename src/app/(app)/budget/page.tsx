import { requireUser } from "@/lib/auth/dal";
import { PlannedFeature } from "@/components/layout/planned-feature";

export const metadata = { title: "Budget" };

export default async function BudgetPage() {
  await requireUser();
  return (
    <PlannedFeature
      title="Budget"
      phase={2}
      summary="Planned-vs-actual, safe-to-spend, savings and debt calculations are built and tested. This page adds planning and editing."
      items={[
        "Monthly income plan with irregular and multiple sources",
        "Fixed and variable expenses by category",
        "Savings goals and debt payment planning",
        "Upcoming recurring bills",
        "Paycheck allocation planning",
        "Month-over-month comparisons",
      ]}
    />
  );
}
