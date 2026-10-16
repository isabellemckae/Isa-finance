import { requireUser } from "@/lib/auth/dal";
import { PlannedFeature } from "@/components/layout/planned-feature";

export const metadata = { title: "Personal CFO" };

export default async function CfoPage() {
  await requireUser();
  return (
    <PlannedFeature
      title="Personal CFO"
      phase={3}
      summary="An OpenAI-powered assistant that answers with numbers from ISA Finance's deterministic services, never invented ones. Read-only tools only."
      items={[
        "Where did my money go this month?",
        "How much can I safely spend this weekend?",
        "Which expenses have increased?",
        "What bills are coming up?",
        "How would different debt payments affect my cash flow?",
        "Every answer states its period, data freshness and assumptions",
      ]}
    />
  );
}
