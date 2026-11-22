import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, Store } from 'lucide-react';
import {
  ListPage,
  ListToolbar,
  ResponsiveTable,
  useConfirmDialog,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { Link } from 'react-router-dom';
import type { SalesChannelSummary } from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Checkbox, EmptyState, Label } from '@endora-commerce/admin-kit/ui';
import { salesChannelsClient } from '../api/sales-channels-client.js';
import { DefaultChannelBadge } from '../components/DefaultChannelBadge.js';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * SalesChannelsListPage — feature 005 / T041.
 *
 * Top-level list view. The system-default channel always lives in
 * the list; the activeOnly filter toggles whether deactivated
 * channels are hidden. The "+ New channel" CTA sends the operator
 * to the create form (`/sales-channels/new`).
 *
 * The system-default column is where the flag moves (feature 072 / D-51). The
 * list is the right surface for it because the decision is comparative — which
 * of these channels should be the fallback — and because the current default
 * has to be visible while another one is promoted. The current default's cell
 * is deliberately inert: the flag is moved by promoting a different channel,
 * never by clearing it here, which is what keeps "exactly one default" true at
 * every moment.
 *
 * Since issue #1749 it is the kit's `ListPage`: the filter is a toolbar row,
 * not a card of its own; the loading, error and count states are the kit's. The
 * endpoint answers every channel, unpaged — a deployment runs a handful — so the
 * screen shows no pager.
 */
export function SalesChannelsListPage(): ReactNode {
  const t = useTranslation('sales_channels');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('sales_channels:write');
  const [rows, setRows] = useState<SalesChannelSummary[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [promoting, setPromoting] = useState<string | null>(null);
  const activeOnlyRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // A reload after a promotion keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      const res = await salesChannelsClient.list({ activeOnly });
      setRows(res.items);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('list.error.load') });
    }
  }, [activeOnly, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const makeDefault = useCallback(
    async (channel: SalesChannelSummary): Promise<void> => {
      const previous = rows.find((c) => c.systemDefault)?.code ?? '—';
      const ok = await confirm({
        message: t('list.action.makeDefault.confirm', { code: channel.code, previous }),
        confirmLabel: t('list.action.makeDefault'),
      });
      if (!ok) return;
      setPromoting(channel.code);
      setActionError(null);
      try {
        await salesChannelsClient.setDefault(channel.code);
        await refresh();
      } catch (err) {
        setActionError(err instanceof ApiError ? err.envelope.error.message : t('list.error.makeDefault'));
      } finally {
        setPromoting(null);
      }
    },
    [refresh, rows, t, confirm],
  );

  // Issue #1448 (DS-15): with *Active only* on, an empty list means the filter
  // hides every channel; without it, there is no channel yet. While there is
  // none, the empty state's New channel is the view's one primary (Von Restorff).
  const noData = load.kind === 'ready' && rows.length === 0 && !activeOnly;
  const newChannel = (
    <Button asChild>
      <Link to="/sales-channels/new">
        <Plus aria-hidden="true" /> {t('list.action.newChannel')}
      </Link>
    </Button>
  );

  const columns: ResponsiveColumn<SalesChannelSummary>[] = [
    {
      id: 'code',
      header: t('list.column.code'),
      primary: true,
      render: (c) => (
        <span className="font-mono text-xs">
          <Link to={`/sales-channels/${encodeURIComponent(c.code)}`} className="text-primary hover:underline">
            {c.code}
          </Link>
          <DefaultChannelBadge systemDefault={c.systemDefault} />
        </span>
      ),
      meta: (c) => channelName(c),
    },
    { id: 'name', header: t('list.column.name'), hideOnMobile: true, render: (c) => channelName(c) },
    {
      id: 'langCurrency',
      header: t('list.column.defaultLangCurrency'),
      render: (c) => (
        <span className="text-xs text-muted-foreground">
          {c.defaultLanguage} / {c.defaultCurrency}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('list.column.status'),
      render: (c) => (
        <>
          {c.active ? (
            <Badge variant="default" className="text-[10px]">
              {t('status.active')}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              {t('status.inactive')}
            </Badge>
          )}
          {/* Feature 154 — a store closed to anonymous visitors is
              visible from the roster without opening it. */}
          {c.anonymousAccess ? null : (
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {t('list.badge.signInRequired')}
            </Badge>
          )}
        </>
      ),
    },
    {
      id: 'version',
      header: t('list.column.version'),
      hideOnMobile: true,
      className: 'w-32 text-right',
      render: (c) => <span className="text-xs text-muted-foreground">v{c.version}</span>,
    },
    {
      id: 'systemDefault',
      header: t('list.column.systemDefault'),
      className: 'w-48 text-right',
      render: (c) =>
        c.systemDefault ? (
          // The current default: stated, not offered. Clearing the
          // flag without giving it to another channel is the one
          // state the platform must never be in.
          <span className="text-xs text-muted-foreground">{t('list.action.makeDefault.current')}</span>
        ) : canWrite ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!c.active || promoting !== null}
            title={c.active ? undefined : t('list.action.makeDefault.inactiveHelp')}
            onClick={() => void makeDefault(c)}
          >
            {t('list.action.makeDefault')}
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <ListPage
        title={t('list.page.title')}
        actions={
          // Gated on the code the create route now enforces (feature 091, batch
          // 14). It was ungated while `/sales-channels/new` was `App.tsx`'s and
          // therefore ungated too; the route is this module's own now and takes
          // `sales_channels:write`, so an ungated button would be a dead end for
          // a read-only operator rather than a refusal they could act on.
          canWrite && !noData ? newChannel : null
        }
        toolbar={
          <ListToolbar
            className="min-w-0 flex-1"
            label={t('list.toolbar.label')}
            filters={
              <div className="flex min-h-9 items-center gap-2">
                <Checkbox
                  ref={activeOnlyRef}
                  id="sc-active-only"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                />
                <Label htmlFor="sc-active-only" className="cursor-pointer">
                  {t('list.filter.activeOnly')}
                </Label>
              </div>
            }
          />
        }
        count={t('list.count', { count: rows.length })}
        notice={
          actionError ? (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null
        }
        load={load}
        onRetry={() => void refresh()}
      >
        <ResponsiveTable
          columns={columns}
          data={rows}
          keyExtractor={(c) => c.id}
          emptyState={
            activeOnly ? (
              <EmptyState
                variant="no-results"
                title={t('list.empty')}
                onClearFilters={(): void => setActiveOnly(false)}
                focusAfterClear={activeOnlyRef}
              />
            ) : (
              <EmptyState
                icon={<Store size={20} />}
                title={t('list.noData.title')}
                description={canWrite ? t('list.noData.body') : t('list.noData.bodyReadOnly')}
                action={canWrite ? newChannel : null}
              />
            )
          }
        />
      </ListPage>
      {confirmDialog}
    </>
  );
}

function channelName(c: SalesChannelSummary): string {
  return c.name['en-US'] ?? c.name['en'] ?? Object.values(c.name)[0] ?? '—';
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default SalesChannelsListPage;
