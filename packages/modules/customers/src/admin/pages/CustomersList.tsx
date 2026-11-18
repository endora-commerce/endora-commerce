import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SearchX, Users } from 'lucide-react';
import type { AdminCustomerListItem, AdminCustomerListResponse } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  OrganizationPicker,
  ResponsiveTable,
  useConfirmDialog,
  useListPagination,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

const STATUSES = ['active', 'blocked', 'deleted'] as const;
type StatusFilter = '' | (typeof STATUSES)[number];

/** `GET /api/v1/admin/customers` serves at most 100 rows a page. */
const MAX_PAGE_SIZE = 100;

/**
 * The request for one page of the list (issue #1473): the filters that are
 * set, and the page. Exported so the request a filter state makes is
 * assertable without a rendered screen.
 */
export function customersListPath(filters: {
  status: StatusFilter;
  q: string;
  organizationId: string | null;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  const q = filters.q.trim();
  if (q) params.set('q', q);
  if (filters.organizationId) params.set('organizationId', filters.organizationId);
  params.set('page', String(filters.page));
  params.set('pageSize', String(filters.pageSize));
  return `/api/v1/admin/customers?${params.toString()}`;
}

/**
 * The Customers list — the kit's `ListPage` pattern (issue #1439, DS-05): a
 * toolbar row of filters, one results table, the pager (issue #1473: the API
 * always paged, and the screen showed its first 20 rows and nothing else).
 */
export function CustomersList(): ReactNode {
  const t = useTranslation('customers');
  const { hasPermission } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const pager = useListPagination({ scope: 'customers', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncTotal } = pager;
  const [rows, setRows] = useState<AdminCustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [status, setStatus] = useState<StatusFilter>('');
  const [q, setQ] = useState('');
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const path = customersListPath({ status, q, organizationId, ...pager.query });

  useEffect(() => {
    // A response that lands after a newer request was sent is dropped, so a
    // slow page cannot overwrite the one the operator is looking at now.
    let alive = true;
    setLoad({ kind: 'loading' });
    apiClient
      .get<AdminCustomerListResponse>(path)
      .then((res) => {
        if (!alive) return;
        setRows(res.data);
        setTotal(res.meta.total);
        syncTotal(res.meta.total);
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('list.error') });
      });
    return () => {
      alive = false;
    };
  }, [path, reloadKey, syncTotal, t]);

  const filtered = status !== '' || q.trim() !== '' || organizationId !== null;
  const clearFilters = useCallback((): void => {
    setStatus('');
    setQ('');
    setOrganizationId(null);
    setResetMsg(null);
    resetPage();
  }, [resetPage]);

  // Feature 042 US6 — reset 2FA for every account in the selected organization.
  // It signs every account there out of its second factor at once, so it is
  // asked first, and the request runs inside the dialog.
  const resetOrgMfa = async (): Promise<void> => {
    if (!organizationId) return;
    setResetMsg(null);
    let outcome: { requested: number; affected: number } | null = null;
    const ok = await confirm({
      title: t('list.action.resetOrgMfa'),
      message: t('list.action.resetOrgMfaConfirm'),
      confirmLabel: t('list.action.resetOrgMfaConfirmButton'),
      destructive: true,
      action: async () => {
        const res = await apiClient.post<{ data: { requested: number; affected: number; skipped: number } }>(
          '/api/v1/admin/mfa/reset-bulk',
          { organizationId },
        );
        outcome = res.data;
      },
      describeError: (err) => (err instanceof ApiError ? err.envelope.error.message : t('list.error')),
    });
    const done = outcome as { requested: number; affected: number } | null;
    if (ok && done) {
      setResetMsg(t('list.action.resetOrgMfaResult', { affected: done.affected, requested: done.requested }));
    }
  };

  return (
    <>
      <ListPage
        title={t('list.title')}
        description={t('list.description')}
        load={load}
        onRetry={() => setReloadKey((key) => key + 1)}
        count={t('list.count', { count: total })}
        toolbar={
          <>
            <div className="min-w-56 flex-1 space-y-1">
              <Label htmlFor="cq">{t('list.field.search')}</Label>
              <Input
                id="cq"
                type="search"
                value={q}
                onChange={(e): void => {
                  setQ(e.target.value);
                  resetPage();
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cstatus">{t('list.field.status')}</Label>
              <Select
                id="cstatus"
                value={status}
                onChange={(e): void => {
                  setStatus(e.target.value as StatusFilter);
                  resetPage();
                }}
              >
                <option value="">{t('list.filter.all')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
            {/* The searchable picker, not a <select> of the first 50
                organizations, past which an organization was unfilterable. */}
            <div className="w-64 space-y-1">
              <Label htmlFor="corg">{t('list.field.organization')}</Label>
              <OrganizationPicker
                id="corg"
                value={organizationId}
                ariaLabel={t('list.field.organization')}
                placeholder={t('list.filter.allOrgs')}
                onChange={(next): void => {
                  setOrganizationId(next);
                  setResetMsg(null);
                  resetPage();
                }}
              />
            </div>
            {organizationId && hasPermission('mfa:reset') ? (
              <Button type="button" variant="outline" onClick={(): void => void resetOrgMfa()}>
                {t('list.action.resetOrgMfa')}
              </Button>
            ) : null}
          </>
        }
        notice={
          resetMsg ? (
            <Alert variant="success">
              <AlertDescription>{resetMsg}</AlertDescription>
            </Alert>
          ) : null
        }
        pagination={pager.footer(total)}
      >
        <ResponsiveTable
          data={rows}
          keyExtractor={(c) => c.id}
          emptyState={
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              {filtered ? (
                <SearchX size={32} aria-hidden="true" className="text-muted-foreground" />
              ) : (
                <Users size={32} aria-hidden="true" className="text-muted-foreground" />
              )}
              <p className="text-sm text-muted-foreground">{filtered ? t('list.emptyFiltered') : t('list.empty')}</p>
              {filtered ? (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  {t('list.clearFilters')}
                </Button>
              ) : null}
            </div>
          }
          columns={[
            {
              id: 'name',
              header: t('list.column.customer'),
              primary: true,
              // The name is the way into the record, as on every other list; a
              // separate "Open" button in each row only repeated it.
              render: (c) => (
                <Link to={`/customers/${c.id}`} className="font-medium text-primary hover:underline">
                  {`${c.firstName} ${c.lastName}`.trim() || c.email}
                </Link>
              ),
              meta: (c) => <span className="font-mono text-xs text-muted-foreground">{c.email}</span>,
            },
            {
              id: 'status',
              header: t('list.column.status'),
              render: (c) =>
                c.deleted ? (
                  <Badge variant="outline">{t('status.deleted')}</Badge>
                ) : c.blocked ? (
                  <Badge variant="destructive">{t('status.blocked')}</Badge>
                ) : (
                  <Badge>{t('status.active')}</Badge>
                ),
            },
            {
              id: 'organization',
              header: t('list.column.organization'),
              hideOnMobile: true,
              render: (c) => c.organizationName ?? t('list.none'),
            },
            {
              id: 'group',
              header: t('list.column.group'),
              hideOnMobile: true,
              render: (c) => c.customerGroupName ?? t('list.none'),
            },
            {
              id: 'created',
              header: t('list.column.created'),
              hideOnMobile: true,
              render: (c) => formatDateTime(c.createdAt),
            },
          ]}
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
export default CustomersList;
