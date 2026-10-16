import { requireUser } from "@/lib/auth/dal";
import { PlannedFeature } from "@/components/layout/planned-feature";

export const metadata = { title: "Accounts" };

export default async function AccountsPage() {
  await requireUser();
  return (
    <PlannedFeature
      title="Accounts"
      phase={2}
      summary="Account cards on the dashboard already show balances, masks, connection health and sync times. This page adds management."
      items={[
        "Checking, savings, credit card and manual accounts",
        "Nicknames and hidden accounts",
        "Current vs available balances and credit limits",
        "Connection health and sync history",
        "Reconnect (Plaid update mode) and disconnect flows",
        "Plaid sandbox linking (Phase 4)",
      ]}
    />
  );
}
