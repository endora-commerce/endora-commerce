import { useEffect, useState, useCallback } from 'react';
import type { ScopeNoticeCode, SubscriberSummary } from '@endora-commerce/contracts';
import { ScopeNotice, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, Card, CardContent, FormField, Input, PageHeader } from '@endora-commerce/admin-kit/ui';
import { newsletterClient } from '../api/newsletter-client.js';
import { describeDeleteError } from '../describe-delete-error.js';
import { subscriberStatusLabels } from '../lib/labels.js';

export function SubscribersPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const tc = useTranslation('core');
  const { language } = useTranslationContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canWrite = hasPermission('newsletter:write');
  const [items, setItems] = useState<SubscriberSummary[]>([]);
  const [total, setTotal] = useState(0);
  // Feature 087 — an empty list is not the same statement as "there are no
  // subscribers", and only the server knows which one it just made.
  const [scopeNotice, setScopeNotice] = useState<ScopeNoticeCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');

  const load = useCallback(() => {
    newsletterClient
      .listSubscribers({ page: 1, pageSize: 50, ...(q ? { q } : {}), ...(tag ? { tag } : {}) })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setScopeNotice(res.scopeNotice);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [q, tag]);

  useEffect(() => {
    load();
  }, [load]);

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const exportHref = newsletterClient.subscribersExportUrl({ ...(q ? { q } : {}), ...(tag ? { tag } : {}) });

  /** Issue #1464 — a delete asks first, and runs inside the dialog. */
  async function confirmDelete(subscriber: SubscriberSummary): Promise<void> {
    setError(null);
    await confirm({
      title: t('delete.subscriber.title'),
      message: t('delete.subscriber.message', { email: subscriber.email }),
      confirmLabel: t('delete.subscriber.action'),
      destructive: true,
      action: async () => {
        await newsletterClient.deleteSubscriber(subscriber.id);
        load();
      },
      describeError: describeDeleteError(t),
    });
  }

  async function action(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('subscribers.title')}
        description={t(`subscribers.count.${new Intl.PluralRules(language).select(total)}`, {
          count: new Intl.NumberFormat(language).format(total),
        })}
      />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t('subscribers.search')} className="w-full max-w-xs">
          <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </FormField>
        <FormField label={t('subscribers.tagFilter')} className="w-full max-w-xs">
          <Input value={tag} onChange={(e) => setTag(e.target.value)} />
        </FormField>
        <Button asChild variant="outline" className="ml-auto">
          <a href={exportHref}>{t('subscribers.export')}</a>
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">{t('subscribers.column.email')}</th>
                <th className="p-3 font-medium">{t('common.column.status')}</th>
                <th className="p-3 font-medium">{t('subscribers.column.tags')}</th>
                <th className="p-3 font-medium">{t('subscribers.column.source')}</th>
                {canWrite ? <th className="p-3 font-medium">{t('common.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3 font-medium">{s.email}</td>
                  <td className="p-3">{subscriberStatusLabels.label(t, s.status)}</td>
                  <td className="p-3 text-xs">{s.tags.join(', ') || '—'}</td>
                  <td className="p-3 text-xs">{s.source ?? '—'}</td>
                  {canWrite ? (
                    <td className="p-3">
                      {s.status === 'active' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void action(async () => {
                              const detail = await newsletterClient.getSubscriber(s.id);
                              await newsletterClient.unsubscribe(s.id, detail.version);
                            })
                          }
                        >
                          {t('subscribers.action.unsubscribe')}
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="sm" onClick={() => void confirmDelete(s)}>
                        {tc('common.action.delete')}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={canWrite ? 5 : 4}>
                    {scopeNotice ? <ScopeNotice notice={scopeNotice} /> : t('subscribers.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {confirmDialog}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default SubscribersPage;
