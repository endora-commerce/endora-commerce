import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Package, Search } from 'lucide-react';
import { ADMIN_PRODUCT_SELECTION_MAX, productTypeSchema } from '@endora-commerce/contracts';
import { usePageSizePreference } from '../../lib/index.js';
import type { PageSizeOption } from '../../lib/page-size-options.js';
import { cn } from '../../lib/utils.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { Badge, type BadgeProps } from '../../ui/badge.js';
import { Checkbox } from '../../ui/checkbox.js';
import { PaginationFooter } from '../PaginationFooter.js';
import { ResponsiveTable, type ResponsiveColumn } from '../ResponsiveTable.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import {
  fetchProductBrowserPage,
  type ProductBrowserCounts,
  type ProductBrowserStatusFilter,
} from './product-browser-api.js';
import { productDisplayName } from './product-line.js';
import {
  NO_PRODUCT_IDS,
  isProductArchived,
  productSelectability,
  productSelectabilityReasonKey,
  type ProductBrowserRules,
} from './selectability.js';
import type { ProductBrowserItem, ProductBrowserStatus, ProductBrowserType } from './types.js';

/**
 * The shared product browser (feature 145, contract `product-browser-component.md`).
 *
 * A wide side drawer over the host screen that lists the catalogue in a paginated
 * table with the Products list's filters — status tabs with counts, a type chip,
 * a debounced search — and keeps a multi-page selection until the operator adds or
 * cancels. Composed from the design system's own parts (research R-3): the
 * `b2b-scrim` / `b2b-drawer` overlay, `useFocusTrap`, `ResponsiveTable` in
 * `table-scroll` mode, `PaginationFooter`, and the `b2b-tabs` / `b2b-filterbar`
 * classes the Products list renders its own bar with.
 *
 * **The host owns `open`.** The dialog never closes itself: a host appending lines
 * locally sets `open` to `false` inside `onConfirm`; a host whose confirm is a
 * server write returns a promise and closes once it resolves. While that promise is
 * pending the dialog disables Add, Cancel, Esc and the scrim; when it rejects, the
 * dialog stays open with the selection kept and offers **Retry**, which re-sends
 * the same items (FR-010).
 *
 * **The page size is read, never written.** It is seeded from the Products list's
 * `catalog-products` preference, and a change inside the picker lives in this
 * session only, so using the picker does not move the Products list (contract B4).
 */
export interface ProductBrowserDialogProps {
  open: boolean;
  rules: ProductBrowserRules;
  alreadyAddedIds: readonly string[];
  /** Title of the drawer, resolved by the host. Defaults to `productBrowser.title.default`. */
  title?: string | undefined;
  /**
   * Called with the selection in selection order. Return a promise to make the confirm
   * a server write (pending → resolve, or reject → Retry); return nothing for a local
   * append.
   */
  onConfirm: (items: ProductBrowserItem[]) => void | Promise<void>;
  onCancel: () => void;
  /** Message for a failed confirm, instead of the generic `productBrowser.state.confirmError`. */
  confirmErrorMessage?: ((error: unknown) => string) | undefined;
}

export function ProductBrowserDialog(props: ProductBrowserDialogProps): ReactNode {
  // Mounting the session only while open gives every opening a fresh selection,
  // filter and page (Cancel discards the selection, FR-007), and unmounting it is
  // what hands focus back to the trigger through `useFocusTrap`'s cleanup.
  if (!props.open) return null;
  return <ProductBrowserSession {...props} />;
}

const SEARCH_DEBOUNCE_MS = 250;
const TYPES: readonly ProductBrowserType[] = productTypeSchema.options;
// The Products list's tabs: three over products that
// are not archived, then Archived on its own axis.
const STATUS_TABS: readonly ProductBrowserStatusFilter[] = ['all', 'active', 'inactive', 'archived'];

const TAB_LABEL_KEY: Record<ProductBrowserStatusFilter, string> = {
  all: 'productBrowser.tab.all',
  active: 'productBrowser.tab.active',
  inactive: 'productBrowser.tab.inactive',
  archived: 'productBrowser.tab.archived',
};
const STATUS_LABEL_KEY: Record<ProductBrowserStatus, string> = {
  active: 'productBrowser.status.active',
  inactive: 'productBrowser.status.inactive',
};
const STATUS_BADGE_VARIANT: Record<ProductBrowserStatus, BadgeProps['variant']> = {
  active: 'success',
  inactive: 'outline',
};
const TYPE_LABEL_KEY: Record<ProductBrowserType, string> = {
  simple: 'productBrowser.type.simple',
  configurable: 'productBrowser.type.configurable',
  grouped: 'productBrowser.type.grouped',
  bundle: 'productBrowser.type.bundle',
  virtual: 'productBrowser.type.virtual',
};

type ConfirmState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'failed'; error: unknown; items: ProductBrowserItem[] };

function ProductBrowserSession(props: ProductBrowserDialogProps): ReactNode {
  const { rules, onConfirm, onCancel, confirmErrorMessage } = props;
  const t = useTranslation('core');
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const countId = `${baseId}-count`;

  // Read-only: `setPageSize` is deliberately never taken (contract B4).
  const { pageSize: preferredPageSize } = usePageSizePreference('catalog-products');

  const [status, setStatus] = useState<ProductBrowserStatusFilter>(rules.initialStatus);
  const [type, setType] = useState<ProductBrowserType | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<PageSizeOption>(preferredPageSize);
  const [view, setView] = useState<'all' | 'selectedOnly'>('all');
  const [selection, setSelection] = useState<ReadonlyMap<string, ProductBrowserItem>>(
    () => new Map(),
  );
  const [rows, setRows] = useState<ProductBrowserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<ProductBrowserCounts>({
    all: 0,
    active: 0,
    inactive: 0,
    archived: 0,
  });
  // A host that refuses archived products is not offered a tab of rows it cannot
  // tick (Hick's law); every other host can browse them.
  const tabs = useMemo(
    () => (rules.blockArchived ? STATUS_TABS.filter((tab) => tab !== 'archived') : STATUS_TABS),
    [rules.blockArchived],
  );
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const [confirm, setConfirm] = useState<ConfirmState>({ kind: 'idle' });

  const containerRef = useRef<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  // Set in setup as well as cleared in cleanup: StrictMode's dev double-mount runs
  // the cleanup once before the setup runs again, and a ref only cleared would stay
  // `false` for the life of the session and drop every confirm result.
  const aliveRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    return (): void => {
      aliveRef.current = false;
    };
  }, []);

  // Trap first, so the element it restores focus to on close is the trigger; then
  // move focus to the search field, the operator's most likely first action.
  useFocusTrap(containerRef, true);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Debounced search; a settled query starts again from the first page.
  useEffect(() => {
    if (query === debouncedQuery) return;
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query);
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return (): void => window.clearTimeout(timer);
  }, [query, debouncedQuery]);

  // One request per filter/page state; a response that is not the latest is dropped —
  // the effect's own cleanup marks it superseded (or unmounted).
  useEffect(() => {
    let cancelled = false;
    setLoad('loading');
    fetchProductBrowserPage({ page, pageSize, status, type, q: debouncedQuery }).then(
      (result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
        setCounts(result.counts);
        setLoad('ready');
      },
      () => {
        if (cancelled) return;
        setLoad('error');
      },
    );
    return (): void => {
      cancelled = true;
    };
  }, [page, pageSize, status, type, debouncedQuery, reloadToken]);

  const alreadyAdded = useMemo(() => new Set(props.alreadyAddedIds), [props.alreadyAddedIds]);
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection]);
  const max = ADMIN_PRODUCT_SELECTION_MAX;
  const pending = confirm.kind === 'pending';

  const selectabilityOf = useCallback(
    (row: ProductBrowserItem) =>
      productSelectability(row, rules, { alreadyAddedIds: alreadyAdded, selectedIds, max }),
    [rules, alreadyAdded, selectedIds, max],
  );

  const toggleRow = useCallback((row: ProductBrowserItem): void => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) next.delete(row.id);
      else if (next.size < max) next.set(row.id, row);
      return next;
    });
  }, [max]);

  // An emptied "selected only" view has nothing to review; go back to the list
  // rather than show the no-match sentence, which would be untrue there.
  useEffect(() => {
    if (view === 'selectedOnly' && selection.size === 0) setView('all');
  }, [view, selection]);

  const shownRows = useMemo(
    () => (view === 'selectedOnly' ? [...selection.values()] : rows),
    [view, selection, rows],
  );

  // The header checkbox works over the rows of this page that the host's rules allow,
  // never the whole filter result (FR-008: no "select all N matching").
  const pageCandidates = useMemo(
    () =>
      shownRows.filter(
        (row) =>
          productSelectability(row, rules, {
            alreadyAddedIds: alreadyAdded,
            selectedIds: NO_PRODUCT_IDS,
            max: Number.POSITIVE_INFINITY,
          }).selectable,
      ),
    [shownRows, rules, alreadyAdded],
  );
  const pageSelectedCount = pageCandidates.filter((row) => selection.has(row.id)).length;
  const pageAllSelected = pageCandidates.length > 0 && pageSelectedCount === pageCandidates.length;
  const pageSomeSelected = pageSelectedCount > 0 && !pageAllSelected;

  const togglePage = (): void => {
    setSelection((prev) => {
      const next = new Map(prev);
      if (pageAllSelected) {
        for (const row of pageCandidates) next.delete(row.id);
        return next;
      }
      for (const row of pageCandidates) {
        if (next.size >= max) break;
        if (!next.has(row.id)) next.set(row.id, row);
      }
      return next;
    });
  };

  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = pageSomeSelected;
  }, [pageSomeSelected]);

  const runConfirm = (items: ProductBrowserItem[]): void => {
    let result: void | Promise<void>;
    try {
      result = onConfirm(items);
    } catch (error) {
      setConfirm({ kind: 'failed', error, items });
      return;
    }
    if (result && typeof (result as Promise<void>).then === 'function') {
      setConfirm({ kind: 'pending' });
      (result as Promise<void>).then(
        () => {
          if (aliveRef.current) setConfirm({ kind: 'idle' });
        },
        (error: unknown) => {
          if (aliveRef.current) setConfirm({ kind: 'failed', error, items });
        },
      );
    }
  };

  const cancel = (): void => {
    if (pending) return;
    onCancel();
  };

  const changeStatus = (next: ProductBrowserStatusFilter): void => {
    setStatus(next);
    setPage(0);
    setView('all');
  };

  const cycleType = (): void => {
    const idx = type === null ? -1 : TYPES.indexOf(type);
    const next = idx + 1 >= TYPES.length ? null : (TYPES[idx + 1] ?? null);
    setType(next);
    setPage(0);
    setView('all');
  };

  const columns: ResponsiveColumn<ProductBrowserItem>[] = [
    {
      id: 'select',
      className: 'w-[1%]',
      header: (
        <Checkbox
          ref={headerCheckboxRef}
          aria-label={t('productBrowser.selectPage')}
          checked={pageAllSelected}
          disabled={pageCandidates.length === 0 || pending}
          onChange={togglePage}
        />
      ),
      render: (row): ReactNode => {
        const verdict = selectabilityOf(row);
        const reasonId = `${baseId}-reason-${row.id}`;
        return (
          <Checkbox
            aria-label={t('productBrowser.selectRow', { name: productDisplayName(row) })}
            aria-describedby={verdict.selectable ? undefined : reasonId}
            checked={selection.has(row.id)}
            disabled={!verdict.selectable || pending}
            onChange={(): void => toggleRow(row)}
          />
        );
      },
    },
    {
      id: 'product',
      primary: true,
      header: t('productBrowser.column.product'),
      render: (row): ReactNode => {
        const verdict = selectabilityOf(row);
        const name = productDisplayName(row);
        return (
          <div className="min-w-0 max-w-[22rem]">
            <div className="truncate font-medium" title={name}>
              {name}
            </div>
            {verdict.selectable ? null : (
              <div id={`${baseId}-reason-${row.id}`} className="text-xs text-muted-foreground">
                {t(productSelectabilityReasonKey(verdict.reason, rules))}
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'sku',
      header: t('productBrowser.column.sku'),
      render: (row): ReactNode => <span className="font-mono text-xs">{row.sku}</span>,
    },
    {
      id: 'status',
      header: t('productBrowser.column.status'),
      // Archived is shown beside the status, never instead of it: the two are
      // independent. While archived the status drops to a neutral outline so the
      // Archived pill — the catalogue's own `b2b-badge--warn` look — is the one
      // coloured mark, as on the Products list and the editor.
      render: (row): ReactNode => {
        const archived = isProductArchived(row);
        return (
          <span className="inline-flex flex-wrap gap-1">
            <Badge variant={archived ? 'outline' : STATUS_BADGE_VARIANT[row.status]}>
              {t(STATUS_LABEL_KEY[row.status])}
            </Badge>
            {archived ? (
              <span className="b2b-badge b2b-badge--warn">{t('productBrowser.status.archived')}</span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'type',
      header: t('productBrowser.column.type'),
      render: (row): ReactNode => t(TYPE_LABEL_KEY[row.type]),
    },
  ];

  const loading = view === 'all' && load === 'loading';
  const atCap = selection.size >= max;
  const confirmError =
    confirm.kind === 'failed'
      ? (confirmErrorMessage?.(confirm.error) ?? t('productBrowser.state.confirmError'))
      : null;

  return (
    <>
      <div className="b2b-scrim" onClick={cancel} />
      <aside
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="b2b-drawer b2b-drawer--wide"
        onKeyDown={(event): void => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            cancel();
          }
        }}
      >
        <div className="b2b-drawer__head">
          <h2 id={titleId} className="b2b-drawer__title">
            {props.title ?? t('productBrowser.title.default')}
          </h2>
        </div>

        <div className="b2b-drawer__body" style={{ padding: 0 }}>
          <div style={{ padding: '4px 12px 0', overflow: 'hidden' }}>
            <div className="b2b-tabs-scroll">
              <div className="b2b-tabs" role="tablist">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={view === 'all' && status === tab}
                    className={cn('b2b-tab', view === 'all' && status === tab && 'is-active')}
                    onClick={(): void => changeStatus(tab)}
                  >
                    <span>{t(TAB_LABEL_KEY[tab])}</span>
                    <span className="b2b-badge b2b-badge--outline">{counts[tab]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="b2b-filterbar">
            <div className="b2b-filterbar__search">
              <div className="b2b-input-wrap">
                <Search size={16} className="lead" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  className="b2b-field b2b-field--addon"
                  placeholder={t('productBrowser.search.placeholder')}
                  aria-label={t('productBrowser.search.placeholder')}
                  value={query}
                  onChange={(event): void => {
                    setQuery(event.target.value);
                    setView('all');
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              className={cn('b2b-filterchip', type !== null && 'is-on')}
              onClick={cycleType}
            >
              <Package size={12} aria-hidden="true" />
              {type === null
                ? t('productBrowser.filter.type.all')
                : t('productBrowser.filter.type', { value: t(TYPE_LABEL_KEY[type]) })}
            </button>
          </div>

          {atCap ? (
            <p role="status" className="px-3 py-2 text-sm" style={{ background: 'var(--surface-muted)' }}>
              {t('productBrowser.limit.notice', { max })}
            </p>
          ) : null}

          <div aria-busy={loading || undefined}>
            {loading ? (
              <p className="b2b-muted px-3 py-6 text-center text-sm">
                {t('productBrowser.state.loading')}
              </p>
            ) : view === 'all' && load === 'error' ? (
              <div role="alert" className="px-3 py-6 text-center text-sm">
                <p>{t('productBrowser.state.loadError')}</p>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--default b2b-btn--sm mt-2"
                  onClick={(): void => setReloadToken((n) => n + 1)}
                >
                  {t('productBrowser.action.retry')}
                </button>
              </div>
            ) : (
              <ResponsiveTable<ProductBrowserItem>
                mode="table-scroll"
                columns={columns}
                data={shownRows}
                keyExtractor={(row): string => row.id}
                emptyState={
                  <p className="b2b-muted px-3 py-6 text-center text-sm">
                    {t('productBrowser.state.empty')}
                  </p>
                }
              />
            )}
          </div>

          {view === 'all' && load !== 'error' ? (
            <PaginationFooter
              page={page}
              pageSize={pageSize}
              total={total}
              onPageSizeChange={(next): void => {
                setPageSize(next);
                setPage(0);
              }}
              onPrev={(): void => setPage((p) => Math.max(0, p - 1))}
              onNext={(): void => setPage((p) => p + 1)}
            />
          ) : null}
        </div>

        {confirmError !== null && confirm.kind === 'failed' ? (
          <div role="alert" className="flex items-center gap-2 px-4 py-2 text-sm text-destructive">
            <span className="flex-1">{confirmError}</span>
            <button
              type="button"
              className="b2b-btn b2b-btn--default b2b-btn--sm"
              onClick={(): void => runConfirm(confirm.items)}
            >
              {t('productBrowser.action.retry')}
            </button>
          </div>
        ) : null}

        <div className="b2b-drawer__foot" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <span id={countId} aria-live="polite" className="text-sm">
            {t('productBrowser.selection.count', { count: selection.size })}
          </span>
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--sm"
            disabled={selection.size === 0 || pending}
            onClick={(): void => {
              setSelection(new Map());
              setView('all');
            }}
          >
            {t('productBrowser.selection.clear')}
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--sm"
            disabled={view === 'all' && selection.size === 0}
            onClick={(): void => setView((v) => (v === 'all' ? 'selectedOnly' : 'all'))}
          >
            {view === 'all'
              ? t('productBrowser.selection.showSelected')
              : t('productBrowser.selection.showAll')}
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="b2b-btn b2b-btn--default"
            disabled={pending}
            onClick={cancel}
          >
            {t('productBrowser.action.cancel')}
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            aria-busy={pending || undefined}
            aria-describedby={countId}
            disabled={selection.size === 0 || pending}
            onClick={(): void => runConfirm([...selection.values()])}
          >
            {t('productBrowser.action.confirm', { count: selection.size })}
          </button>
        </div>
      </aside>
    </>
  );
}
