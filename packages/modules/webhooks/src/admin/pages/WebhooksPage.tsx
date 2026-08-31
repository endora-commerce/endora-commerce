import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { Webhook, WebhookDelivery } from '@endora-commerce/contracts';
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
  Checkbox,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { OrganizationPicker } from '@endora-commerce/admin-kit/components';

const KNOWN_EVENT_TYPES = [
  'product.created.v1',
  'product.updated.v1',
  'product.archived.v1',
  'rfq.created.v1',
  'rfq.quoted.v1',
  'rfq.accepted.v1',
  'rfq.expired.v1',
  'order.created.v1',
  'order.status_changed.v1',
  'order.cancelled.v1',
  'payment.settled.v1',
  'credit_limit.adjusted.v1',
  'credit_limit.reservation_released.v1',
];

interface WebhooksListResponse {
  data: Webhook[];
}

interface DeliveriesListResponse {
  data: WebhookDelivery[];
}

export default function WebhooksPage(): ReactNode {
  const t = useTranslation('core');
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loadingHooks, setLoadingHooks] = useState(true);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [filter, setFilter] = useState<'all' | 'failed' | 'dead_lettered'>('all');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Feature 062 — best-effort id → name lookup for the org-scope column.
  const [orgNames, setOrgNames] = useState<Map<string, string>>(new Map());

  const copySecret = useCallback(async (secret: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the input is selectable as a fallback */
    }
  }, []);

  const refreshWebhooks = useCallback(async (): Promise<void> => {
    setLoadingHooks(true);
    setError(null);
    try {
      const res = await apiClient.get<WebhooksListResponse>('/api/v1/admin/webhooks');
      setWebhooks(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.load'));
    } finally {
      setLoadingHooks(false);
    }
  }, [t]);

  const refreshDeliveries = useCallback(async (): Promise<void> => {
    setLoadingDeliveries(true);
    try {
      const qs = filter === 'all' ? '?limit=50' : `?status=${filter}&limit=50`;
      const res = await apiClient.get<DeliveriesListResponse>(
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

  const handleCreate = useCallback(
    async (input: {
      name: string;
      url: string;
      eventTypes: string[];
      organizationId: string | null;
    }): Promise<void> => {
      try {
        const res = await apiClient.post<{ data: Webhook & { secret: string } }>(
          '/api/v1/admin/webhooks',
          {
            name: input.name,
            url: input.url,
            eventTypes: input.eventTypes,
            ...(input.organizationId ? { organizationId: input.organizationId } : {}),
          },
        );
        setInfo(t('webhooks.create.success'));
        if (res.data.secret) {
          setRevealedSecret({ name: input.name, secret: res.data.secret });
          setCopied(false);
        }
        await refreshWebhooks();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.create'));
      }
    },
    [refreshWebhooks, t],
  );

  const handleToggleStatus = useCallback(
    async (w: Webhook): Promise<void> => {
      const next = w.status === 'active' ? 'paused' : 'active';
      try {
        await apiClient.patch<{ data: Webhook }>(`/api/v1/admin/webhooks/${w.id}`, { status: next });
        await refreshWebhooks();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.update'));
      }
    },
    [refreshWebhooks, t],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('webhooks.action.deleteConfirm'))) {
        return;
      }
      try {
        await apiClient.delete<void>(`/api/v1/admin/webhooks/${id}`);
        await refreshWebhooks();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.delete'));
      }
    },
    [refreshWebhooks, t],
  );

  const handleReplay = useCallback(
    async (deliveryId: string): Promise<void> => {
      try {
        await apiClient.post<{ data: WebhookDelivery }>(
          `/api/v1/admin/webhooks/deliveries/${deliveryId}/replay`,
        );
        setInfo(t('webhooks.delivery.replayQueued'));
        await refreshDeliveries();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('webhooks.error.replay'));
      }
    },
    [refreshDeliveries, t],
  );

  const webhookNameById = new Map(webhooks.map((w) => [w.id, w.name]));

  return (
    <>
      <PageHeader
        title={t('webhooks.page.title')}
        description={t('webhooks.page.description')}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {revealedSecret ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('webhooks.revealed.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{revealedSecret.name}</p>
            <div className="mt-2 flex items-center gap-2">
              <Input
                readOnly
                value={revealedSecret.secret}
                className="flex-1 bg-muted font-mono text-sm text-foreground"
                onFocus={(e): void => e.currentTarget.select()}
                aria-label={t('webhooks.revealed.title')}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={(): void => void copySecret(revealedSecret.secret)}
              >
                {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                {copied ? t('webhooks.revealed.copied') : t('webhooks.revealed.copy')}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={(): void => {
                setRevealedSecret(null);
                setCopied(false);
              }}
            >
              {t('webhooks.revealed.confirm')}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('webhooks.create.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateWebhookForm onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('webhooks.list.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingHooks ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('webhooks.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('webhooks.column.name')}</TableHead>
                  <TableHead>{t('webhooks.column.url')}</TableHead>
                  <TableHead>{t('webhooks.column.events')}</TableHead>
                  <TableHead>{t('webhooks.column.organization')}</TableHead>
                  <TableHead>{t('webhooks.column.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell className="font-mono text-xs">{w.url}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {w.eventTypes.map((e) => (
                          <Badge key={e} variant="outline" className="font-mono text-xs">
                            {e}
                          </Badge>
                        ))}
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
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(): void => {
                            void handleToggleStatus(w);
                          }}
                        >
                          {w.status === 'active' ? <Pause /> : <Play />}
                          {w.status === 'active' ? t('webhooks.action.pause') : t('webhooks.action.resume')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={(): void => {
                            void handleDelete(w.id);
                          }}
                        >
                          <Trash2 />
                          {t('webhooks.action.delete')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('webhooks.deliveries.title')}</CardTitle>
          <div className="flex items-center gap-2">
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

function CreateWebhookForm(props: {
  onSubmit: (input: {
    name: string;
    url: string;
    eventTypes: string[];
    organizationId: string | null;
  }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<Set<string>>(new Set());
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggle = (event: string): void => {
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  };

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || !url.trim() || events.size === 0) return;
    setSubmitting(true);
    try {
      await props.onSubmit({
        name: name.trim(),
        url: url.trim(),
        eventTypes: Array.from(events),
        organizationId,
      });
      setName('');
      setUrl('');
      setEvents(new Set());
      setOrganizationId(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="webhook-name">{t('webhooks.create.nameLabel')}</Label>
          <Input
            id="webhook-name"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            placeholder={t('webhooks.create.namePlaceholder')}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="webhook-url">{t('webhooks.create.urlLabel')}</Label>
          <Input
            id="webhook-url"
            type="url"
            value={url}
            onChange={(e): void => setUrl(e.target.value)}
            placeholder={t('webhooks.create.urlPlaceholder')}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="webhook-organization">{t('webhooks.create.organizationLabel')}</Label>
        <OrganizationPicker
          id="webhook-organization"
          value={organizationId}
          onChange={setOrganizationId}
          ariaLabel={t('webhooks.create.organizationLabel')}
        />
        <p className="text-xs text-muted-foreground">{t('webhooks.create.organizationHelp')}</p>
      </div>
      <div className="space-y-2">
        <Label>{t('webhooks.create.eventsLabel')}</Label>
        <div className="flex flex-wrap gap-3">
          {KNOWN_EVENT_TYPES.map((event) => (
            <label
              key={event}
              className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs"
            >
              <Checkbox checked={events.has(event)} onChange={(): void => toggle(event)} />
              <code className="font-mono">{event}</code>
            </label>
          ))}
        </div>
      </div>
      <Button
        type="submit"
        disabled={submitting || !name.trim() || !url.trim() || events.size === 0}
      >
        {submitting ? t('webhooks.create.submitting') : t('webhooks.create.submit')}
      </Button>
    </form>
  );
}
