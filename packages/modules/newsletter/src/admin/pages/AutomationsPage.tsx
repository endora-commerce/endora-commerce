import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { AutomationSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, PageHeader } from '@endora-commerce/admin-kit/ui';
import { newsletterClient } from '../api/newsletter-client.js';

export function AutomationsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('newsletter:write');
  const [items, setItems] = useState<AutomationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    newsletterClient
      .listAutomations()
      .then((r) => setItems(r.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => load(), [load]);

  async function toggle(id: string, activate: boolean): Promise<void> {
    try {
      const detail = await newsletterClient.getAutomation(id);
      if (activate) await newsletterClient.activateAutomation(id, detail.version);
      else await newsletterClient.pauseAutomation(id, detail.version);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

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
        title="Newsletter — Automations"
        description="Linear send/wait sequences."
        actions={
          canWrite ? (
            <Link to="/newsletter/automations/new">
              <Button>New automation</Button>
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
                <th className="p-3 font-medium">Trigger</th>
                <th className="p-3 font-medium">Steps</th>
                <th className="p-3 font-medium">Status</th>
                {canWrite ? <th className="p-3 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3">
                    <Link className="font-medium text-primary hover:underline" to={`/newsletter/automations/${a.id}`}>
                      {a.name}
                    </Link>
                  </td>
                  <td className="p-3 text-xs">{a.triggerType}</td>
                  <td className="p-3">{a.stepCount}</td>
                  <td className="p-3">{a.status}</td>
                  {canWrite ? (
                    <td className="p-3">
                      {a.status === 'active' ? (
                        <Button variant="ghost" size="sm" onClick={() => void toggle(a.id, false)}>
                          Pause
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => void toggle(a.id, true)}>
                          Activate
                        </Button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={canWrite ? 5 : 4}>
                    No automations yet.
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

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default AutomationsPage;
