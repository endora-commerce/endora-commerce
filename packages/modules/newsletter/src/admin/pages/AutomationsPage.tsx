import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Workflow } from 'lucide-react';
import type { AutomationSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import { ListPage, ResponsiveTable, type ListPageLoad } from '@endora-commerce/admin-kit/components';
import { newsletterClient } from '../api/newsletter-client.js';
import { automationStatusLabels, automationTriggerLabels } from '../lib/labels.js';

/**
 * The newsletter automations. The kit's `ListPage` since issue #1749. *Pause*
 * / *Activate* stays the row's one outline action; a failed toggle is said in
 * the results region, and the rows stay on screen while the list reloads.
 */
export function AutomationsPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const canWrite = hasPermission('newsletter:write');
  const [items, setItems] = useState<AutomationSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    newsletterClient
      .listAutomations()
      .then((r) => {
        setItems(r.items);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => setLoad({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);
  useEffect(() => refresh(), [refresh]);

  async function toggle(id: string, activate: boolean): Promise<void> {
    setActionError(null);
    try {
      const detail = await newsletterClient.getAutomation(id);
      if (activate) await newsletterClient.activateAutomation(id, detail.version);
      else await newsletterClient.pauseAutomation(id, detail.version);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const newAutomation = (
    <Button asChild>
      <Link to="/newsletter/automations/new">
        <Plus aria-hidden="true" />
        {t('automations.new')}
      </Link>
    </Button>
  );
  const nothingYet = load.kind === 'ready' && items.length === 0;

  return (
    <ListPage
      title={t('automations.title')}
      actions={canWrite && !nothingYet ? newAutomation : null}
      count={t('automations.count', { count: items.length })}
      notice={
        actionError ? (
          <Alert variant="destructive">
            <AlertDescription>{actionError}</AlertDescription>
          </Alert>
        ) : null
      }
      load={load}
      onRetry={refresh}
    >
      <ResponsiveTable
        data={items}
        keyExtractor={(a) => a.id}
        emptyState={
          <EmptyState icon={<Workflow size={20} />} title={t('automations.empty')} action={canWrite ? newAutomation : null} />
        }
        columns={[
          {
            id: 'name',
            header: t('common.column.name'),
            primary: true,
            render: (a) => (
              <Link className="font-medium text-primary hover:underline" to={`/newsletter/automations/${a.id}`}>
                {a.name}
              </Link>
            ),
          },
          { id: 'trigger', header: t('automations.column.trigger'), render: (a) => automationTriggerLabels.label(t, a.triggerType) },
          { id: 'steps', header: t('automations.column.steps'), render: (a) => a.stepCount },
          { id: 'status', header: t('common.column.status'), render: (a) => automationStatusLabels.label(t, a.status) },
        ]}
        {...(canWrite
          ? {
              renderActions: (a: AutomationSummary) =>
                a.status === 'active' ? (
                  <Button variant="ghost" size="sm" onClick={() => void toggle(a.id, false)}>
                    {t('automations.action.pause')}
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void toggle(a.id, true)}>
                    {t('automations.action.activate')}
                  </Button>
                ),
            }
          : {})}
      />
    </ListPage>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default AutomationsPage;
