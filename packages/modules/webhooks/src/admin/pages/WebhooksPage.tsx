import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Plus, RefreshCw, Webhook as WebhookIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import type {
  Webhook,
  WebhookDelivery,
  WebhookDeliveryListResponse,
  WebhookListResponse,
} from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  InlineStatus,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { WEBHOOKS_NEW_PATH } from '../paths.js';
import { useDeliverableEventTypes } from '../use-deliverable-event-types.js';

/**
 * The webhooks list — the kit's `ListPage` (issue #1501, UX audit SHELL-14).
 * The subscribe form used to be drawn open above the subscriptions; it is its
 * own route now (`WebhookCreatePage`, `/webhooks/new`), reached from the
 * header's *New webhook*, and it ends on the one-time signing secret. *Pause*
 * / *Resume* and *Delete* are the row's overflow menu, *Delete* last and
 * confirmed (Fitts: destructive actions get distance). The delivery log stays
 * under the list, unchanged.
 */
export default function WebhooksPage(): ReactNode {
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [filter, setFilter] = useState<'all' | 'failed' | 'dead_lettered'>('all');
  const [error, setError] = useState<string | null>(null);
  // A replay is said in the deliveries card's toolbar, in a region mounted
  // before it has text — not a success banner (issue #1499, DEC-12 a).
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  // Feature 062 — best-effort id → name lookup for the org-scope column.
  const [orgNames, setOrgNames] = useState<Map<string, string>>(new Map());
  const tWebhooks = useTranslation('webhooks');
  const { deliverable, known: eventTypesKnown } = useDeliverableEventTypes();

  const refreshWebhooks = useCallback(async (): Promise<void> => {
    // A reload after a write keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const res = await apiClient.get<WebhookListResponse>('/api/v1/admin/webhooks');
      setWebhooks(res.data);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.load') });
    }
  }, [t]);

  const refreshDeliveries = useCallback(async (): Promise<void> => {
    setLoadingDeliveries(true);
    try {
      const qs = filter === 'all' ? '?limit=50' : `?status=${filter}&limit=50`;
      const res = await apiClient.get<WebhookDeliveryListResponse>(
        `/api/v1/admin/webhooks/deliveries${qs}`,
      );
      setDeliveries(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.loadDeliveries'));
    } finally {
      setLoadingDeliveries(false);
    }
  }, [filter, t]);

  useEffect(() => {
    void refreshWebhooks();
  }, [refreshWebhooks]);

  useEffect(() => {
    void refreshDeliveries();
  }, [refreshDeliveries]);

  // Resolve organization names for org-bound subscriptions (feature 062).
  useEffect(() => {
    const missing = Array.from(
      new Set(
        webhooks
          .map((w) => w.organizationId)
          .filter((id): id is string => typeof id === 'string' && !orgNames.has(id)),
      ),
    );
    if (missing.length === 0) return;
    void (async () => {
      const entries = await Promise.all(
        missing.map(async (id) => {
          try {
            const res = await apiClient.get<{ data: { name: string } }>(
              `/api/v1/admin/organizations/${id}`,
            );
            return [id, res.data.name] as const;
          } catch {
            return [id, id] as const;
          }
        }),
      );
      setOrgNames((prev) => {
        const next = new Map(prev);
        for (const [id, name] of entries) next.set(id, name);
        return next;
      });
    })();
  }, [webhooks, orgNames]);

  const handleToggleStatus = useCallback(
    async (w: Webhook): Promise<void> => {
      setError(null);
      clearStatus();
      const next = w.status === 'active' ? 'paused' : 'active';
      try {
        await apiClient.patch<{ data: Webhook }>(`/api/v1/admin/webhooks/${w.id}`, { status: next });
        await refreshWebhooks();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.update'));
      }
    },
    [refreshWebhooks, t, clearStatus],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      clearStatus();
      // The request runs inside the dialog, so a refusal is read where the operator is looking.
      const ok = await confirm({
        message: t('webhooks.action.deleteConfirm'),
        confirmLabel: t('webhooks.action.delete'),
        destructive: true,
        action: () => apiClient.delete<void>(`/api/v1/admin/webhooks/${id}`),
        describeError: (err) => (err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.delete')),
      });
      if (ok) await refreshWebhooks();
    },
    [refreshWebhooks, t, confirm, clearStatus],
  );

  const handleReplay = useCallback(
    async (deliveryId: string): Promise<void> => {
      setError(null);
      clearStatus();
      try {
        await apiClient.post<{ data: WebhookDelivery }>(
          `/api/v1/admin/webhooks/deliveries/${deliveryId}/replay`,
        );
        showStatus(t('webhooks.delivery.replayQueued'));
        await refreshDeliveries();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.replay'));
      }
    },
    [refreshDeliveries, t, clearStatus, showStatus],
  );

  const webhookNameById = new Map(webhooks.map((w) => [w.id, w.name]));

  const newWebhookLink = (variant: 'default' | 'outline'): ReactNode => (
    <Button asChild variant={variant}>
      <Link to={WEBHOOKS_NEW_PATH}>
        <Plus aria-hidden="true" />
        {t('webhooks.create.action')}
      </Link>
    </Button>
  );

  return (
    <>
      <ListPage
        title={t('webhooks.page.title')}
        actions={newWebhookLink('default')}
        load={load}
        onRetry={(): void => void refreshWebhooks()}
        notice={
          error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null
        }
      >
        {webhooks.length === 0 ? (
          <EmptyState icon={<WebhookIcon size={20} />} title={t('webhooks.empty')} action={newWebhookLink('outline')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('webhooks.column.name')}</TableHead>
                <TableHead>{t('webhooks.column.url')}</TableHead>
                <TableHead>{t('webhooks.column.events')}</TableHead>
                <TableHead>{t('webhooks.column.organization')}</TableHead>
                <TableHead>{t('webhooks.column.status')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell className="font-mono text-xs">{w.url}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {w.eventTypes.map((e) =>
                        // A subscription written before event types were
                        // validated may carry one nothing delivers. It is
                        // shown as stored, and marked, rather than hidden.
                        eventTypesKnown && !deliverable.includes(e) ? (
                          <Badge
                            key={e}
                            variant="warning"
                            className="font-mono text-xs"
                            title={tWebhooks('subscription.eventType.notDelivered')}
                            data-undelivered-event-type={e}
                          >
                            {e}
                            <span className="sr-only">
                              {' — '}
                              {tWebhooks('subscription.eventType.notDelivered')}
                            </span>
                          </Badge>
                        ) : (
                          <Badge key={e} variant="outline" className="font-mono text-xs">
                            {e}
                          </Badge>
                        ),
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {w.organizationId ? (
                      <Badge variant="outline">
                        {orgNames.get(w.organizationId) ?? w.organizationId}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('webhooks.organization.platformWide')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={w.status === 'active' ? 'success' : 'warning'}>
                      {t(`webhooks.status.${w.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActionMenu label={t('webhooks.rowActions', { name: w.name })}>
                      <RowActionMenuItem onSelect={(): void => void handleToggleStatus(w)}>
                        {w.status === 'active' ? t('webhooks.action.pause') : t('webhooks.action.resume')}
                      </RowActionMenuItem>
                      <RowActionMenuSeparator />
                      <RowActionMenuItem destructive onSelect={(): void => void handleDelete(w.id)}>
                        {t('webhooks.action.delete')}
                      </RowActionMenuItem>
                    </RowActionMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ListPage>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('webhooks.deliveries.title')}</CardTitle>
          <div className="flex items-center gap-2">
            <InlineStatus {...statusProps} className="mr-1" />
            <Select
              className="w-auto"
              value={filter}
              onChange={(e): void =>
                setFilter(e.target.value as 'all' | 'failed' | 'dead_lettered')
              }
            >
              <option value="all">{t('webhooks.deliveries.filter.all')}</option>
              <option value="failed">{t('webhooks.deliveries.filter.failed')}</option>
              <option value="dead_lettered">{t('webhooks.deliveries.filter.deadLettered')}</option>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={(): void => {
                void refreshDeliveries();
              }}
            >
              <RefreshCw />
              {t('webhooks.action.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingDeliveries ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : deliveries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('webhooks.deliveries.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('webhooks.deliveries.column.webhook')}</TableHead>
                  <TableHead>{t('webhooks.deliveries.column.event')}</TableHead>
                  <TableHead>{t('webhooks.deliveries.column.status')}</TableHead>
                  <TableHead>{t('webhooks.deliveries.column.attempts')}</TableHead>
                  <TableHead>{t('webhooks.deliveries.column.lastResponse')}</TableHead>
                  <TableHead>{t('webhooks.deliveries.column.lastError')}</TableHead>
                  <TableHead>{t('webhooks.deliveries.column.created')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>{webhookNameById.get(d.webhookId) ?? d.webhookId}</TableCell>
                    <TableCell>
                      <div>{d.eventType}</div>
                      <div className="font-mono text-xs text-muted-foreground">{d.eventId}</div>
                    </TableCell>
                    <TableCell>
                      <DeliveryStatusBadge status={d.status} />
                    </TableCell>
                    <TableCell>{d.attemptCount}</TableCell>
                    <TableCell>{d.lastResponseStatus ?? '—'}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                      {d.lastError ?? '—'}
                    </TableCell>
                    <TableCell>{formatDateTime(d.createdAt)}</TableCell>
                    <TableCell>
                      {d.status === 'failed' || d.status === 'dead_lettered' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(): void => {
                            void handleReplay(d.id);
                          }}
                        >
                          {t('webhooks.action.replay')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </>
  );
}

function DeliveryStatusBadge({ status }: { status: WebhookDelivery['status'] }): ReactNode {
  const variant =
    status === 'succeeded'
      ? 'success'
      : status === 'failed' || status === 'dead_lettered'
        ? 'destructive'
        : 'warning';
  return <Badge variant={variant}>{status}</Badge>;
}
