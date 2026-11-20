import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BadgePercent, Plus } from 'lucide-react';
import { ApiError, apiClient, formatDateTime, formatMoney, useAuth } from '@endora-commerce/admin-kit/lib';
import { Badge, Button, EmptyState } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  useConfirmDialog,
  useListPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { PromotionListResponse } from '@endora-commerce/contracts';

type AdminPromotion = PromotionListResponse['data'][number];

/** `GET /api/v1/admin/promotions` serves at most 200 rows a page (issue #1664). */
const MAX_PAGE_SIZE = 200;

/** The figure a promotion takes off, where it has one — the kind column says what it is. */
function effectValue(p: AdminPromotion): string {
  const a = p.action;
  if (a) {
    if (a.type === 'percentage_off_cart') return `${a.percent}%`;
    if (a.type === 'amount_off_cart') return formatMoney(a.amount, a.currency);
    return '—';
  }
  if (p.kind === 'percentage_off' && p.value !== null) return `${p.value}%`;
  if (p.kind === 'amount_off' && p.value !== null) return p.currency ? formatMoney(p.value, p.currency) : String(p.value);
  return '—';
}

/**
 * The promotions list (feature 045; issue #1664, UX audit SALES-24): the kit
 * `ListPage`, server-paged, with the name as the way into the editor and the
 * row's other actions in its menu.
 */
export const PromotionsPage = (): ReactNode => {
  const t = useTranslation('core');
  const tp = useTranslation('promotions');
  const { confirm, confirmDialog } = useConfirmDialog();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('promotions:write');
  const canDelete = hasPermission('promotions:delete');
  const pager = useListPagination({ scope: 'promotions', maxPageSize: MAX_PAGE_SIZE });
  const { syncTotal } = pager;
  const [rows, setRows] = useState<AdminPromotion[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  /** Why the list could not be read; `undefined` inside is the kit's generic copy. */
  const [loadError, setLoadError] = useState<{ message: string | undefined } | null>(null);

  const { page, pageSize } = pager.query;
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.get<PromotionListResponse>(
        `/api/v1/admin/promotions?page=${page}&pageSize=${pageSize}`,
      );
      setRows(res.data);
      setTotal(res.meta.total);
      syncTotal(res.meta.total);
    } catch (err) {
      setLoadError({ message: err instanceof ApiError ? err.envelope.error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, syncTotal]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDelete = useCallback(
    async (p: AdminPromotion): Promise<void> => {
      const ok = await confirm({
        message: t('promotions.deleteConfirm'),
        confirmLabel: t('common.action.delete'),
        destructive: true,
        action: () => apiClient.delete<void>(`/api/v1/admin/promotions/${p.id}`),
        describeError: (err) => (err instanceof ApiError ? err.envelope.error.message : t('promotions.error.delete')),
      });
      if (ok) await refresh();
    },
    [refresh, t, confirm],
  );

  const kindLabel = (p: AdminPromotion): string =>
    p.action ? tp(`action.${p.action.type}`) : p.kind ? tp(`list.kind.${p.kind}`) : '—';

  const criterionLabel = (c: AdminPromotion['criteria'][number]): string => {
    switch (c.type) {
      case 'attribute':
        return tp('list.criterion.attribute', {
          attribute: c.attributeKey,
          op: tp(`list.criterion.op.${c.op}`),
          values: c.values.map((v) => String(v)).join(', '),
        });
      case 'category':
        return tp('list.criterion.category', { count: c.categoryIds.length });
      case 'product':
        return tp('list.criterion.product', { count: c.productIds.length });
      case 'customerGroup':
        return tp('list.criterion.customerGroup', { count: c.customerGroupIds.length });
      case 'organization':
        return tp('list.criterion.organization', { count: c.organizationIds.length });
    }
  };
  const criteriaLabel = (p: AdminPromotion): string =>
    p.criteria.length > 0 ? p.criteria.map(criterionLabel).join('; ') : '—';

  const columns: ResponsiveColumn<AdminPromotion>[] = [
    {
      id: 'name',
      header: t('promotions.column.name'),
      primary: true,
      render: (p) =>
        canWrite ? (
          <Link to={`/promotions/${p.id}`} className="font-medium underline underline-offset-2">
            {p.name}
          </Link>
        ) : (
          <span className="font-medium">{p.name}</span>
        ),
      meta: (p) => kindLabel(p),
    },
    {
      id: 'code',
      header: t('promotions.column.code'),
      render: (p) => (p.code ? <code className="font-mono text-xs">{p.code}</code> : '—'),
    },
    { id: 'kind', header: t('promotions.column.kind'), hideOnMobile: true, render: (p) => kindLabel(p) },
    {
      id: 'value',
      header: t('promotions.column.value'),
      render: (p) => <span className="tabular-nums">{effectValue(p)}</span>,
    },
    {
      id: 'minCart',
      header: t('promotions.column.minCart'),
      hideOnMobile: true,
      render: (p) => <span className="tabular-nums">{p.minCartSubtotal != null ? p.minCartSubtotal.toFixed(2) : '—'}</span>,
    },
    {
      id: 'valid',
      header: t('promotions.column.valid'),
      hideOnMobile: true,
      render: (p) => (
        <span className="text-xs text-muted-foreground">
          {tp('list.validRange', {
            from: p.validFrom ? formatDateTime(p.validFrom) : '—',
            until: p.validUntil ? formatDateTime(p.validUntil) : '—',
          })}
        </span>
      ),
    },
    {
      id: 'criteria',
      header: t('promotions.column.criteria'),
      hideOnMobile: true,
      render: (p) => <span className="text-xs">{criteriaLabel(p)}</span>,
    },
    {
      id: 'active',
      header: t('promotions.column.active'),
      render: (p) => (
        <Badge variant={p.isActive ? 'success' : 'secondary'}>
          {p.isActive ? t('promotions.active.yes') : t('promotions.active.no')}
        </Badge>
      ),
    },
  ];

  const load: ListPageLoad = loading
    ? { kind: 'loading' }
    : loadError !== null
      ? loadError.message === undefined
        ? { kind: 'error' }
        : { kind: 'error', message: loadError.message }
      : { kind: 'ready' };

  return (
    <>
      <ListPage
        title={t('promotions.page.title')}
        description={t('promotions.page.description')}
        actions={
          canWrite ? (
            <Button asChild>
              <Link to="/promotions/new">
                <Plus aria-hidden="true" />
                {tp('list.new')}
              </Link>
            </Button>
          ) : null
        }
        load={load}
        onRetry={(): void => void refresh()}
        count={tp('list.count', { count: total })}
        pagination={pager.footer(total)}
      >
        <ResponsiveTable
          data={rows}
          keyExtractor={(p) => p.id}
          columns={columns}
          emptyState={
            <EmptyState
              icon={<BadgePercent size={20} />}
              title={tp('list.emptyTitle')}
              description={tp('list.empty')}
            />
          }
          renderActions={(p) => (
            <RowActionMenu label={tp('list.rowMenu.label', { name: p.name })}>
              <RowActionMenuItem asChild>
                <Link to={`/promotions/${p.id}/stats`}>{t('promotionStats.title')}</Link>
              </RowActionMenuItem>
              {canDelete ? (
                <>
                  <RowActionMenuSeparator />
                  <RowActionMenuItem destructive onSelect={(): void => void handleDelete(p)}>
                    {t('promotions.action.delete')}
                  </RowActionMenuItem>
                </>
              ) : null}
            </RowActionMenu>
          )}
        />
      </ListPage>
      {confirmDialog}
    </>
  );
};

/**
 * The default export the route declaration's dynamic-import factory takes
 * (`contracts/admin-contribution.md` R6). The named export is kept because the
 * screen is also the subject of this module's own admin tests.
 */
export default PromotionsPage;
