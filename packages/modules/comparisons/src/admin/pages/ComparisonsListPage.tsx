import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { scopeNoticeOf, type ComparisonAdminListItem, type ScopeNoticeCode } from '@endora-commerce/contracts';
import { ApiError, useAuth, useModulePresence, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { Badge, Button, EmptyState, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import {
  ListPage,
  ListToolbar,
  ResponsiveTable,
  SalesChannelPicker,
  ScopeNotice,
  useCursorPagination,
  type ListPageLoad,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { listComparisons } from '../api/comparisons-client.js';

/** `GET /api/v1/admin/comparisons` serves at most 100 rows a page. */
const MAX_PAGE_SIZE = 100;

/**
 * `<ComparisonsListPage>` — feature 007 / US5 / T067.
 *
 * Read-only listing of every Comparison the storefront has generated.
 * Filters: sales channel id, owner type (customer / anonymous), time
 * range. Cursor pagination. The owner opens the detail page.
 *
 * The kit's `ListPage` since issue #1749: the filters are the toolbar row —
 * the date range behind *More filters* (Hick) — and the cursor pager is the
 * kit's footer in place of a *Load more* button. The endpoint answers no total,
 * so the list shows no count.
 */
export default function ComparisonsListPage(): ReactNode {
  const t = useTranslation('comparisons');
  const { language } = useTranslationContext();
  const { hasPermission } = useAuth();
  const { isPresent } = useModulePresence();
  const showPdfTemplate = isPresent('document_templates') && hasPermission('document_templates:read');
  const pager = useCursorPagination({ scope: 'comparisons', maxPageSize: MAX_PAGE_SIZE });
  const { resetPage, syncPage } = pager;
  const { cursor, limit } = pager.query;
  const [rows, setRows] = useState<ComparisonAdminListItem[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  // Why the list is empty, when it is (feature 087). The server is the only
  // party that can tell "none of these is yours" from "there are none", so the
  // screen carries the answer rather than guessing at it.
  const [scopeNotice, setScopeNotice] = useState<ScopeNoticeCode | null>(null);
  const [salesChannelId, setSalesChannelId] = useState('');
  const [ownerType, setOwnerType] = useState<'' | 'customer' | 'anonymous'>('');
  const [createdAfter, setCreatedAfter] = useState('');
  const [createdBefore, setCreatedBefore] = useState('');
  const filtered = Boolean(salesChannelId || ownerType || createdAfter || createdBefore);
  // Where focus returns after the empty state's "Clear filters" (WCAG 2.2 SC 2.4.3).
  const firstFilterRef = useRef<HTMLSelectElement>(null);
  const clearFilters = useCallback((): void => {
    setSalesChannelId('');
    setOwnerType('');
    setCreatedAfter('');
    setCreatedBefore('');
    resetPage();
  }, [resetPage]);
  /** A filter setter that also goes back to the first page. */
  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T): void => {
      set(value);
      resetPage();
    };

  useEffect(() => {
    // A response that lands after a newer request was sent is dropped.
    let alive = true;
    setLoad({ kind: 'loading' });
    const filters: Record<string, string | number> = { limit };
    if (salesChannelId) filters['salesChannelId'] = salesChannelId;
    if (ownerType) filters['ownerType'] = ownerType;
    if (createdAfter) filters['createdAfter'] = new Date(createdAfter).toISOString();
    if (createdBefore) filters['createdBefore'] = new Date(createdBefore).toISOString();
    if (cursor) filters['cursor'] = cursor;
    listComparisons(filters)
      .then((res) => {
        if (!alive) return;
        setRows(res.data);
        syncPage({ cursor: res.meta.nextCursor, hasMore: res.meta.nextCursor !== null }, res.data.length);
        setScopeNotice(scopeNoticeOf(res));
        setLoad({ kind: 'ready' });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setLoad({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : t('error.load') });
      });
    return () => {
      alive = false;
    };
  }, [salesChannelId, ownerType, createdAfter, createdBefore, cursor, limit, reloadKey, syncPage, t]);

  const columns: ResponsiveColumn<ComparisonAdminListItem>[] = [
    {
      id: 'owner',
      header: t('list.column.owner'),
      primary: true,
      // The owner is the way into the comparison; a separate arrow in every row only repeated it.
      render: (c) => (
        <Link to={`/comparisons/${c.id}`} className="font-medium text-primary hover:underline">
          {c.owner.kind === 'customer' ? (c.owner.email ?? t('owner.noEmailOnFile')) : t('owner.anonymous')}
        </Link>
      ),
      meta: (c) => formatDateTime(c.createdAt, language),
    },
    {
      id: 'channel',
      header: t('list.column.salesChannel'),
      render: (c) => <code className="font-mono text-xs">{c.salesChannel.code}</code>,
    },
    {
      id: 'mode',
      header: t('list.column.mode'),
      render: (c) => <Badge variant="default">{t(`displayMode.${c.displayMode}`)}</Badge>,
    },
    { id: 'products', header: t('list.column.products'), render: (c) => c.productCount },
    {
      id: 'created',
      header: t('list.column.created'),
      hideOnMobile: true,
      render: (c) => <span className="text-muted-foreground">{formatDateTime(c.createdAt, language)}</span>,
    },
  ];

  return (
    <ListPage
      title={t('list.page.title')}
      actions={
        // FR-063 — the comparison PDF's template, for an administrator who may
        // see document templates and only while that module is present.
        showPdfTemplate ? (
          <Button variant="outline" size="sm" asChild>
            <Link to="/document-templates?type=comparisons.comparison">{t('list.pdfTemplate')}</Link>
          </Button>
        ) : undefined
      }
      toolbar={
        <ListToolbar
          className="min-w-0 flex-1"
          label={t('list.toolbar.label')}
          filters={
            <>
              <SalesChannelPicker
                id="sales-channel-id"
                ariaLabel={t('list.filter.salesChannelId')}
                className="w-56"
                value={salesChannelId || null}
                onChange={(v): void => filter(setSalesChannelId)(v ?? '')}
              />
              <Select
                ref={firstFilterRef}
                id="owner-type"
                aria-label={t('list.filter.owner')}
                className="w-auto"
                value={ownerType}
                onChange={(e): void => filter(setOwnerType)(e.target.value as '' | 'customer' | 'anonymous')}
              >
                <option value="">{t('owner.any')}</option>
                <option value="customer">{t('owner.customer')}</option>
                <option value="anonymous">{t('owner.anonymous')}</option>
              </Select>
            </>
          }
          moreFilters={
            <>
              <div className="space-y-1">
                <Label htmlFor="created-after">{t('list.filter.createdAfter')}</Label>
                <Input
                  id="created-after"
                  type="datetime-local"
                  value={createdAfter}
                  onChange={(e): void => filter(setCreatedAfter)(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="created-before">{t('list.filter.createdBefore')}</Label>
                <Input
                  id="created-before"
                  type="datetime-local"
                  value={createdBefore}
                  onChange={(e): void => filter(setCreatedBefore)(e.target.value)}
                />
              </div>
            </>
          }
          moreFiltersActiveCount={[createdAfter, createdBefore].filter(Boolean).length}
          filtersActive={filtered}
          onClearFilters={clearFilters}
        />
      }
      load={load}
      onRetry={() => setReloadKey((key) => key + 1)}
      pagination={pager.footer(rows.length)}
    >
      <ResponsiveTable
        columns={columns}
        data={rows}
        keyExtractor={(c) => c.id}
        emptyState={
          // The server's scope notice says why first (feature 087);
          // otherwise "none generated yet" and "none match these filters"
          // are two situations (#1448, DS-15). Comparisons are made on the
          // storefront, so the no-data state offers no action.
          scopeNotice ? (
            <ScopeNotice notice={scopeNotice} />
          ) : filtered ? (
            <EmptyState variant="no-results" title={t('list.empty')} onClearFilters={clearFilters} focusAfterClear={firstFilterRef} />
          ) : (
            <EmptyState icon={<Scale size={20} />} title={t('list.emptyState.title')} description={t('list.emptyState.body')} />
          )
        }
      />
    </ListPage>
  );
}
