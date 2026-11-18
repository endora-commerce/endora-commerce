import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type { AutomationSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, PageHeader } from '@endora-commerce/admin-kit/ui';
import { newsletterClient } from '../api/newsletter-client.js';
import { automationStatusLabels, automationTriggerLabels } from '../lib/labels.js';

export function AutomationsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
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
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('automations.title')}
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/newsletter/automations/new">{t('automations.new')}</Link>
            </Button>
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
                <th className="p-3 font-medium">{t('common.column.name')}</th>
                <th className="p-3 font-medium">{t('automations.column.trigger')}</th>
                <th className="p-3 font-medium">{t('automations.column.steps')}</th>
                <th className="p-3 font-medium">{t('common.column.status')}</th>
                {canWrite ? <th className="p-3 font-medium">{t('common.actions')}</th> : null}
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
                  <td className="p-3">{automationTriggerLabels.label(t, a.triggerType)}</td>
                  <td className="p-3">{a.stepCount}</td>
                  <td className="p-3">{automationStatusLabels.label(t, a.status)}</td>
                  {canWrite ? (
                    <td className="p-3">
                      {a.status === 'active' ? (
                        <Button variant="ghost" size="sm" onClick={() => void toggle(a.id, false)}>
                          {t('automations.action.pause')}
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => void toggle(a.id, true)}>
                          {t('automations.action.activate')}
                        </Button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={canWrite ? 5 : 4}>
                    {t('automations.empty')}
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
