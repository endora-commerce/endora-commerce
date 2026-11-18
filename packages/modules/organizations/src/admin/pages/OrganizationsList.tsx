import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, SearchX } from 'lucide-react';
import type { AdminOrganization, AdminOrganizationListResponse } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  OrganizationStatusBadge,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  useListPagination,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

const STATUSES = ['pending_verification', 'active', 'blocked', 'rejected'] as const;
type StatusFilter = '' | (typeof STATUSES)[number];

/** `GET /api/v1/admin/organizations` serves at most 200 rows a page. */
const MAX_PAGE_SIZE = 200;

/**
 * The request for one page of the list (issue #1473): the filters that are
 * set, and the page. Exported so the request a filter state makes is
 * assertable without a rendered screen.
 */
export function organizationsListPath(filters: {
  status: StatusFilter;
  q: string;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('filter[status]', filters.status);
  const q = filters.q.trim();
  if (q) params.set('q', q);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  return `/api/v1/admin/organizations?${params.toString()}`;
}

/**
 * The Organizations list — the kit's `ListPage` pattern (issue #1439, DS-05):
 * "New organization" in the header, a toolbar row of filters, one results
 * table, the pager (issue #1473: the API answered its first 50 rows and the
 * screen offered no way past them except the search).
 */
export function OrganizationsList(): ReactNode {
  const t = useTranslation('core');
  const own = useTranslation('organizations');
  // Feature 154 — creating an Organization is `customers:manage`, as the
  // `/organizations/new` route is; a read-only operator is not shown a button
  // that would open a screen they cannot use.
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('customers:manage');
  // `specs/177-tax-id-scope/` (`contracts/admin-surfaces.md` §4.5) — the
  // installation-wide screens, each under its own code. The routes and the
  // backend also refuse a scoped administrator; the menu shows what the code allows.
  const canManageTaxIdScope = hasPermission('organizations:manage-tax-id-scope');
  const canConvert = hasPermission('organizations:convert-to-company');
  const hasMenu = canManageTaxIdScope || canConvert;
  const pager = useListPagination({ scope: 'organizations', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  const [rows, setRows] = useState<AdminOrganization[]>([]);
  const [total, setTotal] = useState(0);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [status, setStatus] = useState<StatusFilter>('');
  const [q, setQ] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const path = organizationsListPath({ status, q, ...pager.query });

  useEffect(() => {
    // A response that lands after a newer request was sent is dropped, so a
    // slow page cannot overwrite the one the operator is looking at now.
    let alive = true;
    setLoad({ kind: 'loading' });
    apiClient
      .get<AdminOrganizationListResponse>(path)
      .then((res) => {
        if (!alive) return;
        setRows(res.data);
        setTotal(res.meta.total);
        syncTotal(res.meta.total);
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

  const filtered = status !== '' || q.trim() !== '';
  const clearFilters = useCallback((): void => {
    setStatus('');
    setQ('');
    resetPage();
  }, [resetPage]);

  const create = canCreate ? (
    <Button asChild>
      <Link to="/organizations/new">
        <Plus size={16} aria-hidden="true" />
        {own('list.newOrganization')}
      </Link>
    </Button>
  ) : null;

  return (
    <ListPage
      title={t('organizations.page.title')}
      description={t('organizations.page.description')}
      actions={
        canCreate || hasMenu ? (
          <>
            {create}
            {hasMenu ? (
              <RowActionMenu label={own('list.menu.label')}>
                {canManageTaxIdScope ? (
                  <RowActionMenuItem asChild>
                    <Link to="/organizations/tax-id-scope">{own('list.menu.taxIdScope')}</Link>
                  </RowActionMenuItem>
                ) : null}
                {canConvert ? (
                  <RowActionMenuItem asChild>
                    <Link to="/organizations/convert-to-company">{own('list.menu.convertPersonal')}</Link>
                  </RowActionMenuItem>
                ) : null}
              </RowActionMenu>
            ) : null}
          </>
        ) : null
      }
      load={load}
      onRetry={() => setReloadKey((key) => key + 1)}
      count={own('list.count', { count: total })}
      toolbar={
        <>
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="oq">{t('organizations.field.search')}</Label>
            <Input
              id="oq"
              type="search"
              value={q}
              onChange={(e): void => {
                setQ(e.target.value);
                resetPage();
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ostatus">{t('organizations.field.status')}</Label>
            <Select
              id="ostatus"
              value={status}
              onChange={(e): void => {
                setStatus(e.target.value as StatusFilter);
                resetPage();
              }}
            >
              <option value="">{t('organizations.filter.all')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {own(`status.${s}`)}
                </option>
              ))}
            </Select>
          </div>
        </>
      }
      pagination={pager.footer(total)}
    >
      <ResponsiveTable
        data={rows}
        keyExtractor={(o) => o.id}
        emptyState={
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            {filtered ? (
              <SearchX size={32} aria-hidden="true" className="text-muted-foreground" />
            ) : (
              <Building2 size={32} aria-hidden="true" className="text-muted-foreground" />
            )}
            <p className="text-sm text-muted-foreground">
              {filtered ? own('list.emptyFiltered') : own('list.empty')}
            </p>
            {filtered ? (
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                {own('list.clearFilters')}
              </Button>
            ) : (
              create
            )}
          </div>
        }
        columns={[
          {
            id: 'name',
            header: t('organizations.column.name'),
            primary: true,
            // The name is the way into the record, as on every other list; a
            // separate "Open" button in each row only repeated it.
            render: (o) => (
              <Link to={`/organizations/${o.id}`} className="font-medium text-primary hover:underline">
                {o.name}
              </Link>
            ),
            // A personal Organization has no tax ID (`specs/177-tax-id-scope/`).
            meta: (o) =>
              o.isPersonal ? (
                <span className="text-xs text-muted-foreground">{t('organizations.personalAccount')}</span>
              ) : o.taxId ? (
                <span className="font-mono text-xs text-muted-foreground">{o.taxId}</span>
              ) : null,
          },
          {
            id: 'status',
            header: t('organizations.column.status'),
            render: (o) => <OrganizationStatusBadge status={o.status} />,
          },
          {
            id: 'vat',
            header: t('organizations.column.vat'),
            hideOnMobile: true,
            render: (o) => own(`vatStatus.${o.vatStatus}`),
          },
          {
            id: 'registered',
            header: t('organizations.column.registered'),
            hideOnMobile: true,
            render: (o) => formatDateTime(o.createdAt),
          },
        ]}
      />
    </ListPage>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default OrganizationsList;
