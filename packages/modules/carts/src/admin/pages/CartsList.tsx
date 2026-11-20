import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import type { AdminCartSummary, AdminCartsListResponse } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime, formatMoney } from '@endora-commerce/admin-kit/lib';
import { Badge, EmptyState, Select } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ListToolbar,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  useListPagination,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { cartApprovalStatusLabels, cartStatusLabels } from '../lib/labels.js';

type StatusFilter = '' | (typeof cartStatusLabels.values)[number];
type ApprovalFilter = '' | (typeof cartApprovalStatusLabels.values)[number];

/** `GET /api/v1/admin/carts` serves at most 200 rows a page. */
const MAX_PAGE_SIZE = 200;

/**
 * The request for one page of the list (issue #1473): the filters that are
 * set, and the page. Exported so the request a filter state makes is
 * assertable without a rendered screen.
 */
export function cartsListPath(filters: {
  status: StatusFilter;
  approvalStatus: ApprovalFilter;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.approvalStatus) params.set('approvalStatus', filters.approvalStatus);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  return `/api/v1/admin/carts?${params.toString()}`;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  active: 'default',
  abandoned: 'warning',
  completed: 'success',
  rejected: 'destructive',
};

const APPROVAL_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  not_required: 'secondary',
  pending: 'warning',
  approved: 'success',
  rejected_by_org_admin: 'destructive',
};

/**
 * CartsList (feature 027 US6) — every cart on the platform, most recent
 * activity first, filtered by status and approval status. The kit's `ListPage`
 * pattern (issue #1439, DS-05) with the pager (issue #1473: the API always
 * paged, and the screen showed its first 50 carts and nothing else).
 */
export default function CartsList(): ReactNode {
  const t = useTranslation('carts');
  const pager = useListPagination({ scope: 'carts', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  const [rows, setRows] = useState<AdminCartSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>('');
  const [reloadKey, setReloadKey] = useState(0);
  const path = cartsListPath({ status: statusFilter, approvalStatus: approvalFilter, ...pager.query });

  useEffect(() => {
    // A response that lands after a newer request was sent is dropped, so a
    // slow page cannot overwrite the one the operator is looking at now.
    let alive = true;
    setLoad({ kind: 'loading' });
    apiClient
      .get<AdminCartsListResponse>(path)
      .then((res) => {
        if (!alive) return;
        setRows(res.data);
        setTotal(res.meta.totalCount);
        syncTotal(res.meta.totalCount);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoad({ kind: 'error', ...(err instanceof ApiError ? { message: err.envelope.error.message } : {}) });
      });
    return () => {
      alive = false;
    };
  }, [path, reloadKey, syncTotal]);

  const filtered = statusFilter !== '' || approvalFilter !== '';
  const ownerName = (c: AdminCartSummary): string => c.ownerDisplayName ?? t('carts.owner.anonymous');
  const clearFilters = useCallback((): void => {
    setStatusFilter('');
    setApprovalFilter('');
    resetPage();
  }, [resetPage]);

  return (
    <ListPage
      title={t('carts.page.title')}
      description={t('carts.page.description')}
      load={load}
      onRetry={() => setReloadKey((key) => key + 1)}
      count={t('carts.count', { count: total })}
      toolbar={
        // The kit toolbar (issue #1500, SALES-24): a `search` landmark. The
        // carts endpoint takes no search, so the two filters are the row.
        <ListToolbar
          className="min-w-0 flex-1"
          label={t('carts.toolbar.label')}
          filters={
            <>
              <Select
                aria-label={t('carts.column.status')}
                className="w-auto"
                value={statusFilter}
                onChange={(e): void => {
                  setStatusFilter(e.target.value as StatusFilter);
                  resetPage();
                }}
              >
                <option value="">{t('carts.filter.allStatuses')}</option>
                {cartStatusLabels.options(t).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('carts.column.approval')}
                className="w-auto"
                value={approvalFilter}
                onChange={(e): void => {
                  setApprovalFilter(e.target.value as ApprovalFilter);
                  resetPage();
                }}
              >
                <option value="">{t('carts.filter.allApprovals')}</option>
                {cartApprovalStatusLabels.options(t).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </>
          }
          filtersActive={filtered}
          onClearFilters={clearFilters}
        />
      }
      pagination={pager.footer(total)}
    >
      <ResponsiveTable
        data={rows}
        keyExtractor={(c) => c.id}
        emptyState={
          filtered ? (
            <EmptyState variant="no-results" title={t('carts.emptyFiltered')} onClearFilters={clearFilters} />
          ) : (
            <EmptyState icon={<ShoppingCart size={20} />} title={t('carts.emptyTitle')} description={t('carts.empty')} />
          )
        }
        renderActions={(c) =>
          // Only where the row has somewhere to go besides itself: the owner
          // already opens the cart.
          c.organizationId ? (
            <RowActionMenu label={t('carts.rowMenu.label', { name: ownerName(c) })}>
              <RowActionMenuItem asChild>
                <Link to={`/organizations/${c.organizationId}`}>{t('carts.rowMenu.organization')}</Link>
              </RowActionMenuItem>
            </RowActionMenu>
          ) : null
        }
        columns={[
          {
            // Issue #1477 — a cart has no business ID, and the UUID prefix this
            // column used to lead with told the operator nothing. The owner is
            // what they recognise, and the way into the cart; a separate "Open"
            // button in each row only repeated it.
            id: 'owner',
            header: t('carts.column.owner'),
            primary: true,
            render: (c) => (
              <Link to={`/carts/${c.id}`} className="font-medium text-primary hover:underline">
                {ownerName(c)}
              </Link>
            ),
            meta: (c) => formatDateTime(c.lastActivityAt),
          },
          {
            id: 'org',
            header: t('carts.column.org'),
            hideOnMobile: true,
            render: (c) => <span className="text-xs text-muted-foreground">{c.organizationDisplayName ?? '—'}</span>,
          },
          {
            id: 'status',
            header: t('carts.column.status'),
            render: (c) => (
              <Badge variant={STATUS_VARIANT[c.status] ?? 'secondary'}>{cartStatusLabels.label(t, c.status)}</Badge>
            ),
          },
          {
            id: 'approval',
            header: t('carts.column.approval'),
            render: (c) => (
              <Badge variant={APPROVAL_VARIANT[c.approvalStatus] ?? 'secondary'}>
                {cartApprovalStatusLabels.label(t, c.approvalStatus)}
              </Badge>
            ),
          },
          {
            id: 'total',
            header: t('carts.column.total'),
            render: (c) => <span className="tabular-nums">{formatMoney(c.total.amount, c.total.currency)}</span>,
            meta: (c) => t('carts.itemCount', { count: c.itemCount }),
          },
        ]}
      />
    </ListPage>
  );
}
