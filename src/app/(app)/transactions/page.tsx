import { requireUser } from "@/lib/auth/dal";
import { PlannedFeature } from "@/components/layout/planned-feature";

export const metadata = { title: "Activity" };

export default async function TransactionsPage() {
  await requireUser();
  return (
    <PlannedFeature
      title="Activity"
      phase={2}
      summary="The deduplication, transfer detection and classification services are built and tested. This page adds the full transaction experience."
      items={[
        "Unified, chronological history with pending/posted status",
        "Search plus date, category, account and income/expense filters",
        "Editable categories and notes, stored separately from bank data",
        "Exclude from budget",
        "CSV import with duplicate preview",
        "Transfer and card-payment review",
      ]}
    />
  );
}
