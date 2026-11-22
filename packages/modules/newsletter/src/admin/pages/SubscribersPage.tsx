import { useCallback, useEffect, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import type { ScopeNoticeCode, SubscriberSummary } from '@endora-commerce/contracts';
import {
  ListPage,
  ListToolbar,
  ListToolbarSearch,
  ResponsiveTable,
  ScopeNotice,
  useConfirmDialog,
  useDebouncedValue,
  useListPagination,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, EmptyState, Input } from '@endora-commerce/admin-kit/ui';
import { newsletterClient } from '../api/newsletter-client.js';
import { describeDeleteError } from '../describe-delete-error.js';
import { subscriberStatusLabels } from '../lib/labels.js';

/** `GET …/newsletter/subscribers` serves at most 200 rows a page (`subscriberListQuerySchema`). */
const MAX_PAGE_SIZE = 200;

/**
 * The newsletter subscribers. The kit's `ListPage` since issue #1749: the
 * search and the tag filter are the toolbar row and run as the operator types
 * (one request per pause), the subscriber count is the list's count, and the
 * pager pages the whole list — the screen used to show the first 50 and stop.
 */
export function SubscribersPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const t = useTranslation('newsletter');
  const tc = useTranslation('core');
  const { language } = useTranslationContext();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canWrite = hasPermission('newsletter:write');
  const pager = useListPagination({ scope: 'newsletter-subscribers', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  const { page, pageSize } = pager.query;
  const [items, setItems] = useState<SubscriberSummary[]>([]);
  const [total, setTotal] = useState(0);
  // Feature 087 — an empty list is not the same statement as "there are no
  // subscribers", and only the server knows which one it just made.
  const [scopeNotice, setScopeNotice] = useState<ScopeNoticeCode | null>(null);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const query = useDebouncedValue(q.trim());
  const tagQuery = useDebouncedValue(tag.trim());
  const searchRef = useRef<HTMLInputElement>(null);
  // "Nothing matches" is decided from what the rows were asked for, not from what is still being typed.
  const filtered = query !== '' || tagQuery !== '';

  useEffect(() => {
    let alive = true;
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    newsletterClient
      .listSubscribers({ page, pageSize, ...(query ? { q: query } : {}), ...(tagQuery ? { tag: tagQuery } : {}) })
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setTotal(res.total);
        syncTotal(res.total);
        setScopeNotice(res.scopeNotice);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (alive) setLoad({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      alive = false;
    };
  }, [page, pageSize, query, tagQuery, reloadKey, syncTotal]);

  const reload = useCallback((): void => setReloadKey((key) => key + 1), []);

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>{t('common.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  const exportHref = newsletterClient.subscribersExportUrl({ ...(query ? { q: query } : {}), ...(tagQuery ? { tag: tagQuery } : {}) });

  const clearFilters = (): void => {
    setQ('');
    setTag('');
    resetPage();
  };

  /** Issue #1464 — a delete asks first, and runs inside the dialog. */
  async function confirmDelete(subscriber: SubscriberSummary): Promise<void> {
    setActionError(null);
    await confirm({
      title: t('delete.subscriber.title'),
      message: t('delete.subscriber.message', { email: subscriber.email }),
      confirmLabel: t('delete.subscriber.action'),
      destructive: true,
      action: async () => {
        await newsletterClient.deleteSubscriber(subscriber.id);
        reload();
      },
      describeError: describeDeleteError(t),
    });
  }

  async function action(fn: () => Promise<unknown>): Promise<void> {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <ListPage
        title={t('subscribers.title')}
        toolbar={
          <ListToolbar
            className="min-w-0 flex-1"
            label={t('subscribers.toolbar')}
            search={
              <ListToolbarSearch
                ref={searchRef}
                label={t('subscribers.search')}
                placeholder={t('subscribers.search')}
                value={q}
                onValueChange={(next): void => {
                  setQ(next);
                  resetPage();
                }}
              />
            }
            filters={
              <Input
                aria-label={t('subscribers.tagFilter')}
                placeholder={t('subscribers.tagFilter')}
                className="w-40"
                value={tag}
                onChange={(e): void => {
                  setTag(e.target.value);
                  resetPage();
                }}
              />
            }
            actions={
              <Button asChild variant="outline">
                <a href={exportHref}>{t('subscribers.export')}</a>
              </Button>
            }
            filtersActive={q.trim() !== '' || tag.trim() !== ''}
            onClearFilters={clearFilters}
          />
        }
        count={t(`subscribers.count.${new Intl.PluralRules(language).select(total)}`, {
          count: new Intl.NumberFormat(language).format(total),
        })}
        notice={
          actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null
        }
        load={load}
        onRetry={reload}
        pagination={pager.footer(total)}
      >
        <ResponsiveTable
          data={items}
          keyExtractor={(s) => s.id}
          emptyState={
            // The server's scope notice says why first (feature 087);
            // otherwise "nobody yet" and "nobody matches" are two
            // situations with two next steps (#1448, DS-15).
            scopeNotice ? (
              <ScopeNotice notice={scopeNotice} />
            ) : filtered ? (
              <EmptyState variant="no-results" title={t('subscribers.empty')} onClearFilters={clearFilters} focusAfterClear={searchRef} />
            ) : (
              <EmptyState icon={<Users size={20} />} title={t('subscribers.emptyState.title')} description={t('subscribers.emptyState.body')} />
            )
          }
          columns={[
            { id: 'email', header: t('subscribers.column.email'), primary: true, render: (s) => <span className="font-medium">{s.email}</span> },
            { id: 'status', header: t('common.column.status'), render: (s) => subscriberStatusLabels.label(t, s.status) },
            { id: 'tags', header: t('subscribers.column.tags'), render: (s) => <span className="text-xs">{s.tags.join(', ') || '—'}</span> },
            { id: 'source', header: t('subscribers.column.source'), hideOnMobile: true, render: (s) => <span className="text-xs">{s.source ?? '—'}</span> },
          ]}
          {...(canWrite
            ? {
                renderActions: (s: SubscriberSummary) => (
                  <div className="flex justify-end gap-1">
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
                  </div>
                ),
              }
            : {})}
        />
      </ListPage>
      {confirmDialog}
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default SubscribersPage;
