import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CampaignSummary } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { newsletterClient } from '../api/newsletter-client';

export function CampaignsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<CampaignSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    newsletterClient
      .listCampaigns()
      .then((res) => setItems(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view the newsletter.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Newsletter — Campaigns"
        description="One-off mailings to a target audience."
        actions={
          hasPermission('newsletter:write') ? (
            <Link to="/newsletter/campaigns/new">
              <Button>New campaign</Button>
            </Link>
          ) : null
        }
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Subject</th>
                <th className="p-3 font-medium">Target</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3">
                    <Link className="font-medium text-primary hover:underline" to={`/newsletter/campaigns/${c.id}`}>
                      {c.name}
                    </Link>
                  </td>
                  <td className="p-3">{c.subject}</td>
                  <td className="p-3 text-xs">{c.targetType}</td>
                  <td className="p-3">{c.status}</td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={4}>
                    No campaigns yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
