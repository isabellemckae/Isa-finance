import { loadPageData } from "@/lib/data/load";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { OAuthResume } from "@/components/accounts/oauth-resume";

export const metadata = { title: "Finishing bank link" };

/**
 * Return point for OAuth institutions (PLAID_REDIRECT_URI). Plaid Link resumes here
 * with the link token saved before the redirect; no secrets are in the URL.
 */
export default async function PlaidOAuthPage() {
  await loadPageData();
  return (
    <div className="space-y-6">
      <PageHeader title="Finishing bank link" description="Returning from your bank's sign-in page." />
      <Card>
        <OAuthResume />
      </Card>
    </div>
  );
}
