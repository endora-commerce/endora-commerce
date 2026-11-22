import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AuditLogFacetsResponse } from '@endora-commerce/contracts';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import {
  Button,
  Combobox,
  EmptyState,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import {
  AdminUserPicker,
  CustomerPicker,
  ListPage,
  ListToolbar,
  useCursorPagination,
  useDebouncedValue,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { AuditTextValue } from '../components/AuditStateView.js';
import { AuditEntryDiff } from '../components/AuditEntryDiff.js';
import { actionFilterOptions, hiddenAuditFilterCount, objectTypeFilterOptions } from '../lib/audit-log-view.js';

/**
 * Audit Log viewer (T195 / FR-084). Append-only — no edit / delete UI.
 * Filters mirror the backend query: actor, action, objectType, objectId,
 * impersonated customer.
 *
 * Issue #1555 (UX audit SHELL-20): a kit `ListPage`. The filters are a toolbar
 * row above the one results card, and apply as they change — there is no
 * *Apply*. The action and object-type filters offer what the log holds
 * (`GET /audit-log/facets`), each action under the label the table gives it,
 * instead of asking for a code (recognition over recall). The list pages by
 * cursor under the kit pager, and a row's detail is the entry's change field by
 * field — the record-history change list — with the stored JSON one disclosure
 * away.
 *
 * An anonymised subject's history is erased in place (issue #844): its values
 * are the stored marker `[erased]`, which the detail row draws as a translated
 * token — in the change list, the JSON, and as the IP or user agent — rather
 * than raw.
 *
 * The action, object type and object id filters live in the URL query
 * (`?action=…&objectType=…&objectId=…`, feature 161 G13), so another screen
 * links to an object's history — a price book's *History* is
 * `/audit-log?objectType=price_list&objectId=<id>` — and a reload or a shared
 * link shows the same view. A change is written back with `replace`, so typing
 * a filter does not stack history entries.
 */

/** The filters kept in the URL, by their query-parameter name. */
const URL_FILTERS = ['action', 'objectType', 'objectId'] as const;
type UrlFilter = (typeof URL_FILTERS)[number];

/** The route's largest page (`AUDIT_LOG_MAX_LIMIT`). */
const AUDIT_LOG_MAX_LIMIT = 200;

interface AuditLogRow {
  id: string;
  actorAdminUserId: string | null;
  /** Enriched by the backend — actor's full name, when resolvable. */
  actorName: string | null;
  /** Enriched by the backend — actor's email, when resolvable. */
  actorEmail: string | null;
  impersonatedCustomerAccountId: string | null;
  /**
   * A customer who acted for themselves on the storefront (issue #741). Absent
   * from a server that predates it.
   */
  actorCustomerAccountId?: string | null;
  /** Enriched by the backend — the customer's audit label, when resolvable. */
  actorCustomerLabel?: string | null;
  actedAt: string;
  action: string;
  actionModuleId?: string;
  objectType: string;
  objectId: string;
  stateBefore: Record<string, unknown> | null;
  stateAfter: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

interface AuditLogPage {
  data: AuditLogRow[];
  pagination?: { cursor: string | null; hasMore: boolean };
}

export default function AuditLogViewer(): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('core');
  const ta = useTranslation('audit_logs');
  const { t: translate } = useTranslationContext();
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [facets, setFacets] = useState<AuditLogFacetsResponse | null>(null);
  const [facetsFailed, setFacetsFailed] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const action = searchParams.get('action') ?? '';
  const objectType = searchParams.get('objectType') ?? '';
  const objectId = searchParams.get('objectId') ?? '';
  const pager = useCursorPagination({ scope: 'audit-log', maxPageSize: AUDIT_LOG_MAX_LIMIT });
  const { resetPage, syncPage } = pager;
  const setUrlFilters = useCallback(
    (values: Partial<Record<UrlFilter, string>>): void => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const key of URL_FILTERS) {
            if (!(key in values)) continue;
            const value = values[key] ?? '';
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
      resetPage();
    },
    [setSearchParams, resetPage],
  );
  const [actor, setActor] = useState('');
  const [impersonated, setImpersonated] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The object id is typed (or pasted), so the request waits for a pause.
  const queriedObjectId = useDebouncedValue(objectId);
  // Where focus returns after the empty state's "Clear filters" (WCAG 2.2 SC 2.4.3): the first filter.
  const firstFilterRef = useRef<HTMLInputElement>(null);
  const filtered = Boolean(actor || action || objectType || queriedObjectId || impersonated);
  const clearFilters = (): void => {
    setActor('');
    setUrlFilters({ action: '', objectType: '', objectId: '' });
    setImpersonated('');
  };
  const generation = useRef(0);

  const { cursor, limit } = pager.query;
  const refresh = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (actor) params.set('filter[actor]', actor);
      if (action) params.set('filter[action]', action);
      if (objectType) params.set('filter[objectType]', objectType);
      if (queriedObjectId) params.set('filter[objectId]', queriedObjectId);
      if (impersonated) params.set('filter[customer]', impersonated);
      params.set('limit', String(limit));
      if (cursor) params.set('cursor', cursor);
      const res = await apiClient.get<AuditLogPage>(`/api/v1/admin/audit-log?${params.toString()}`);
      if (current !== generation.current) return;
      setRows(res.data);
      syncPage(res.pagination ?? { cursor: null, hasMore: false }, res.data.length);
    } catch (err) {
      if (current !== generation.current) return;
      setError(err instanceof ApiError ? err.envelope.error.message : t('auditLog.error.load'));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [actor, action, objectType, queriedObjectId, impersonated, cursor, limit, syncPage, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // What the filters offer. A failure leaves the list working: the pickers say
  // the values could not be read, and a filter in the URL still applies.
  useEffect(() => {
    let live = true;
    apiClient
      .get<{ data: AuditLogFacetsResponse }>('/api/v1/admin/audit-log/facets')
      .then((res) => {
        if (live) setFacets(res.data);
      })
      .catch(() => {
        if (live) setFacetsFailed(true);
      });
    return (): void => {
      live = false;
    };
  }, []);

  const actionOptions = useMemo(
    () =>
      actionFilterOptions(facets?.actions ?? [], action, (code, moduleId) =>
        translateAuditAction(translate, { action: code, actionModuleId: moduleId }),
      ),
    [facets, action, translate],
  );
  const objectTypeOptions = useMemo(
    () => objectTypeFilterOptions(facets?.objectTypes ?? [], objectType),
    [facets, objectType],
  );
  const facetsLoading = facets === null && !facetsFailed;
  const facetsEmpty = facetsFailed ? ta('auditLog.filter.optionsFailed') : undefined;

  const load: ListPageLoad = loading
    ? { kind: 'loading' }
    : error !== null
      ? { kind: 'error', message: error }
      : { kind: 'ready' };

  return (
    <ListPage
      title={t('auditLog.page.title')}
      load={load}
      onRetry={(): void => void refresh()}
      pagination={pager.footer(rows.length)}
      toolbar={
        <ListToolbar
          className="min-w-0 flex-1"
          label={ta('auditLog.toolbar.label')}
          filters={
            <>
              <div className="w-64">
                <Combobox
                  ref={firstFilterRef}
                  ariaLabel={t('auditLog.filter.action')}
                  placeholder={ta('auditLog.filter.anyAction')}
                  options={actionOptions}
                  value={action || null}
                  onChange={(v): void => setUrlFilters({ action: v ?? '' })}
                  loading={facetsLoading}
                  {...(facetsEmpty ? { emptyMessage: facetsEmpty } : {})}
                />
              </div>
              <div className="w-52">
                <Combobox
                  ariaLabel={t('auditLog.filter.objectType')}
                  placeholder={ta('auditLog.filter.anyObjectType')}
                  options={objectTypeOptions}
                  value={objectType || null}
                  onChange={(v): void => setUrlFilters({ objectType: v ?? '' })}
                  loading={facetsLoading}
                  {...(facetsEmpty ? { emptyMessage: facetsEmpty } : {})}
                />
              </div>
              <div className="w-56">
                <AdminUserPicker
                  ariaLabel={t('auditLog.filter.actor')}
                  value={actor || null}
                  onChange={(v): void => {
                    setActor(v ?? '');
                    resetPage();
                  }}
                />
              </div>
            </>
          }
          moreFilters={
            <>
              <div className="space-y-1.5">
                <Label htmlFor="f-oid">{t('auditLog.filter.objectId')}</Label>
                <Input
                  id="f-oid"
                  value={objectId}
                  // A pasted id often carries a space or a line break (Postel).
                  onChange={(e): void => setUrlFilters({ objectId: e.target.value.trim() })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-customer">{t('auditLog.filter.impersonatedCustomer')}</Label>
                <CustomerPicker
                  id="f-customer"
                  value={impersonated || null}
                  onChange={(v): void => {
                    setImpersonated(v ?? '');
                    resetPage();
                  }}
                />
              </div>
            </>
          }
          moreFiltersActiveCount={hiddenAuditFilterCount({ objectId, customer: impersonated })}
          // An object's *History* link arrives with its id: show it, not a folded count.
          defaultMoreFiltersOpen={Boolean(objectId)}
          filtersActive={Boolean(actor || action || objectType || objectId || impersonated)}
          onClearFilters={clearFilters}
        />
      }
    >
      {rows.length === 0 ? (
        // "Nothing recorded yet" and "these filters match nothing" are two
        // situations with two next steps (#1448, DS-15). The log is
        // append-only, so the no-data state offers no action.
        filtered ? (
          <EmptyState
            variant="no-results"
            title={t('auditLog.empty')}
            onClearFilters={clearFilters}
            focusAfterClear={firstFilterRef}
          />
        ) : (
          <EmptyState
            icon={<ScrollText size={20} />}
            title={t('auditLog.emptyState.title')}
            description={t('auditLog.emptyState.body')}
          />
        )
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('auditLog.column.when')}</TableHead>
              <TableHead>{t('auditLog.column.actor')}</TableHead>
              <TableHead>{t('auditLog.column.action')}</TableHead>
              <TableHead>{t('auditLog.column.object')}</TableHead>
              <TableHead>
                <span className="sr-only">{ta('auditLog.column.detail')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const open = expandedId === r.id;
              const detailId = `audit-entry-${r.id}`;
              return (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell>{formatDateTime(r.actedAt, language)}</TableCell>
                    <TableCell>
                      <ActorCell row={r} />
                    </TableCell>
                    <TableCell>{translateAuditAction(translate, r)}</TableCell>
                    <TableCell>
                      {r.objectType}
                      <br />
                      <ObjectIdCell objectType={r.objectType} objectId={r.objectId} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-expanded={open}
                        aria-controls={open ? detailId : undefined}
                        onClick={(): void => setExpandedId(open ? null : r.id)}
                      >
                        {open ? t('auditLog.action.hide') : t('auditLog.action.detail')}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow>
                      <TableCell colSpan={5} id={detailId}>
                        <AuditEntryDiff before={r.stateBefore} after={r.stateAfter} />
                        <div className="mt-3 text-xs text-muted-foreground">
                          {t('auditLog.detail.ip')} <AuditTextValue value={r.ipAddress} /> ·{' '}
                          {t('auditLog.detail.userAgent')} <AuditTextValue value={r.userAgent} maxLength={60} /> ·{' '}
                          {t('auditLog.detail.request')} {r.requestId ?? '—'}
                          {r.impersonatedCustomerAccountId ? (
                            <>
                              {' '}
                              · {t('auditLog.detail.impersonatedCustomer')}{' '}
                              {r.impersonatedCustomerAccountId.slice(0, 8)}
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </ListPage>
  );
}

/**
 * Maps an audit-log `objectType` to its admin detail route, when one exists.
 * Only id-addressable detail pages are listed — object types without a
 * standalone page (or whose route keys on a code/slug rather than the audit
 * `objectId`) are intentionally omitted so we never produce a broken link.
 */
const OBJECT_ROUTE: Record<string, (id: string) => string> = {
  product: (id) => `/catalog/products/${id}`,
  order: (id) => `/orders/${id}`,
  organization: (id) => `/organizations/${id}`,
  customer_account: (id) => `/customers/${id}`,
  price_list: (id) => `/price-lists/${id}`,
  warehouse: (id) => `/warehouses/${id}`,
  cart: (id) => `/carts/${id}`,
  bulk_operation: (id) => `/catalog/bulk-operations/${id}`,
  admin_user: (id) => `/admin-users#admin-user-${id}`,
};

/**
 * Renders the object id, linked to the object's admin detail page when its
 * type has one; otherwise a plain truncated id.
 */
function ObjectIdCell({
  objectType,
  objectId,
}: {
  objectType: string;
  objectId: string;
}): ReactNode {
  const build = OBJECT_ROUTE[objectType];
  const short = objectId.slice(0, 8);
  if (!build) {
    return <span className="text-xs text-muted-foreground">{short}</span>;
  }
  return (
    <Link
      to={build(objectId)}
      className="text-xs text-muted-foreground underline underline-offset-2"
      title={objectId}
    >
      {short}
    </Link>
  );
}

/**
 * Renders the actor column: an admin user's name + email (linked to the
 * users admin page) when resolvable, the bare id as a fallback, a customer who
 * acted for themselves as "Customer: <label>" (issue #741), or the "system"
 * label when there is no actor.
 */
function ActorCell({ row }: { row: AuditLogRow }): ReactNode {
  const t = useTranslation('core');
  if (!row.actorAdminUserId) {
    if (row.actorCustomerAccountId) {
      const name = row.actorCustomerLabel?.trim() || row.actorCustomerAccountId.slice(0, 8);
      return <span title={row.actorCustomerAccountId}>{t('auditLog.actor.customer', { name })}</span>;
    }
    return <span className="text-muted-foreground">{t('auditLog.actor.system')}</span>;
  }
  const name = row.actorName?.trim();
  if (!name) {
    // Unknown / deleted admin user — keep the id so the row is still traceable.
    return <span className="font-mono text-xs">{row.actorAdminUserId.slice(0, 8)}</span>;
  }
  return (
    <Link
      to={`/admin-users#admin-user-${row.actorAdminUserId}`}
      className="underline underline-offset-2"
    >
      {name}
      {row.actorEmail ? (
        <span className="text-muted-foreground"> ({row.actorEmail})</span>
      ) : null}
    </Link>
  );
}

function translateAuditAction(
  translate: (
    scope: string,
    key: string,
    params?: Record<string, string | number>,
  ) => string,
  row: Pick<AuditLogRow, 'action' | 'actionModuleId'>,
): string {
  const moduleId = row.actionModuleId ?? 'core';
  const key = `auditLog.${row.action}`;
  const label = translate(moduleId, key);
  return label === `${moduleId}.${key}` ? row.action : label;
}
