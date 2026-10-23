import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, BookOpen, Plus, RotateCcw, Settings, X } from 'lucide-react';
import type {
  PriceBookAudienceKind,
  PriceBookListResponse,
  PriceBookStatus,
  PriceBookSummary,
  PriceBookTargetCurrency,
  PriceBookTargetCustomerGroup,
  PriceBookTargetSalesChannel,
  PriceBookType,
} from '@endora-commerce/contracts';
import {
  PaginationFooter,
  ResponsiveTable,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  type ResponsiveColumn,
} from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAuth, usePageSizePreference, type PageSizeOption } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Combobox,
  Input,
  Label,
  PageHeader,
  Select,
  buttonVariants,
  type ComboboxOption,
} from '@endora-commerce/admin-kit/ui';
import { DeleteBookDialog } from '../components/DeleteBookDialog.js';
import { errorMessage } from '../lib/api-errors.js';
import { AUDIENCE_KINDS, BOOK_STATUSES, BOOK_TYPES, audienceLabel, statusLabel, typeLabel } from '../lib/book-labels.js';
import { useLocalizedName } from '../lib/localized-name.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * The price-book list (feature 161, US1 — FR-001, FR-005, FR-032, FR-034).
 *
 * **Filters live in the URL** (OQ-2 = B; saved views are issue #408): a
 * filtered list is a link an operator can share or bookmark. Every filter is
 * written with `replace`, so the history holds the addresses an operator
 * opened rather than one per keystroke.
 *
 * **Base books** are shown once per currency, marked as base prices, and offer
 * no delete — the server answers `403` to one anyway (FR-005). A book the
 * caller may not change (`writable`, G11) offers no action either: absent, not
 * disabled (FR-028).
 *
 * The member filter names organizations through the scope-filtered targets
 * (G12), so a representative only ever sees their own.
 */

/** `GET …/price-books` pages at most 200; the kit's 500 option falls back to 100. */
const MAX_PAGE_SIZE = 200;

const FILTER_KEYS = ['search', 'type', 'status', 'currency', 'channelId', 'audienceKind', 'memberId'] as const;

const isOneOf = <T extends string>(values: readonly T[], value: string | null): value is T =>
  value !== null && (values as readonly string[]).includes(value);

type ListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string; readonly detail: string }
  | { readonly kind: 'ready'; readonly answer: PriceBookListResponse };

export function PriceBooksPage(): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const localizedName = useLocalizedName();
  const [params, setParams] = useSearchParams();
  const { pageSize: preferred, setPageSize } = usePageSizePreference('price-books');
  const pageSize = (preferred > MAX_PAGE_SIZE ? 100 : preferred) as PageSizeOption;
  const mayWrite = hasPermission('price_lists:write');

  const type = params.get('type');
  const status = params.get('status');
  const currency = params.get('currency');
  const channelId = params.get('channelId');
  const audienceKind = params.get('audienceKind');
  const memberId = params.get('memberId');
  const search = params.get('search') ?? '';
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const filtered = FILTER_KEYS.some((key) => params.get(key));

  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState<PriceBookSummary | null>(null);
  const [searchText, setSearchText] = useState(search);
  const [currencies, setCurrencies] = useState<PriceBookTargetCurrency[]>([]);
  const [channels, setChannels] = useState<PriceBookTargetSalesChannel[]>([]);
  const [groups, setGroups] = useState<PriceBookTargetCustomerGroup[]>([]);

  /** Write filters to the URL (`null` removes one) and go back to the first page. */
  const setFilter = useCallback(
    (changes: Record<string, string | null>): void => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          if (!('page' in changes)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // The search box writes to the URL once typing settles.
  useEffect(() => {
    if (searchText.trim() === search) return undefined;
    const timer = setTimeout(() => setFilter({ search: searchText.trim() || null }), 300);
    return (): void => clearTimeout(timer);
  }, [searchText, search, setFilter]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    api
      .list({
        ...(isOneOf(BOOK_TYPES, type) ? { type: [type as PriceBookType] } : {}),
        ...(isOneOf(BOOK_STATUSES, status) ? { status: [status as PriceBookStatus] } : {}),
        ...(currency ? { currency } : {}),
        ...(channelId ? { channelId } : {}),
        ...(isOneOf(AUDIENCE_KINDS, audienceKind) ? { audienceKind: audienceKind as PriceBookAudienceKind } : {}),
        ...(memberId ? { memberId } : {}),
        ...(search ? { search } : {}),
        page,
        pageSize,
      })
      .then((answer) => {
        if (!cancelled) setState({ kind: 'ready', answer });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: t('priceBooks.list.error.load'), detail: errorMessage(err, '') });
      });
    return (): void => {
      cancelled = true;
    };
  }, [api, type, status, currency, channelId, audienceKind, memberId, search, page, pageSize, attempt, t]);

  // The filters' choices: a failed read leaves that filter with "Any" alone.
  useEffect(() => {
    void api.targets.currencies().then(setCurrencies).catch(() => undefined);
    void api.targets.salesChannels().then(setChannels).catch(() => undefined);
  }, [api]);
  useEffect(() => {
    if (audienceKind === 'customer_groups') void api.targets.customerGroups().then(setGroups).catch(() => undefined);
  }, [api, audienceKind]);

  const creatable = state.kind === 'ready' ? state.answer.meta.creatableAudienceKinds.length > 0 : true;
  const mayCreate = mayWrite && creatable;
  const mayChange = useCallback(
    (book: PriceBookSummary): boolean => mayWrite && book.writable && !book.isSystem,
    [mayWrite],
  );

  const columns = useMemo<ResponsiveColumn<PriceBookSummary>[]>(
    () => [
      {
        id: 'name',
        header: t('priceBooks.list.column.name'),
        primary: true,
        render: (book) => (
          <div className="space-y-1">
            <Link to={`/price-lists/${book.id}`} className="font-medium underline-offset-2 hover:underline">
              {book.name}
            </Link>
            <div className="flex flex-wrap gap-1">
              {book.isSystem ? <Badge variant="secondary">{t('priceBooks.list.base', { currency: book.currencyCode })}</Badge> : null}
              {book.appliesToNoOne ? (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  {t('priceBooks.list.flag.noOne')}
                </Badge>
              ) : null}
              {book.appliesNowhere ? (
                <Badge variant="warning" className="gap-1">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  {t('priceBooks.list.flag.nowhere')}
                </Badge>
              ) : null}
            </div>
          </div>
        ),
      },
      { id: 'type', header: t('priceBooks.list.column.type'), render: (book) => typeLabel(t, book.type) },
      {
        id: 'status',
        header: t('priceBooks.list.column.status'),
        render: (book) => (
          <Badge variant={book.status === 'active' ? 'success' : book.status === 'expired' ? 'secondary' : 'outline'}>
            {statusLabel(t, book.status)}
          </Badge>
        ),
      },
      { id: 'currency', header: t('priceBooks.list.column.currency'), render: (book) => book.currencyCode },
      { id: 'channels', header: t('priceBooks.list.column.channels'), hideOnMobile: true, render: (book) => book.channelCount },
      {
        id: 'audience',
        header: t('priceBooks.list.column.audience'),
        render: (book) =>
          book.audienceKind === 'everyone'
            ? audienceLabel(t, 'everyone')
            : t('priceBooks.list.audienceSummary', { kind: audienceLabel(t, book.audienceKind), count: book.memberCount }),
      },
      { id: 'priority', header: t('priceBooks.list.column.priority'), hideOnMobile: true, render: (book) => book.priority },
      { id: 'rows', header: t('priceBooks.list.column.rows'), hideOnMobile: true, render: (book) => book.rowCount },
    ],
    [t],
  );

  const clearFilters = (): void => {
    setSearchText('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const total = state.kind === 'ready' ? state.answer.meta.totalCount : 0;

  return (
    <>
      <PageHeader
        title={t('priceBooks.list.title')}
        description={t('priceBooks.list.description')}
        actions={
          <>
            {/* Principle XVI (Checkpoint 10 ruling): *Pricing settings* has no
                sidebar entry; it is reached from here and from the palette. */}
            <Link to="/price-lists/display-modes" className={buttonVariants({ variant: 'outline' })}>
              <Settings aria-hidden="true" />
              {t('priceBooks.list.pricingSettings')}
            </Link>
            {mayCreate ? (
              <Link to="/price-lists/new" className={buttonVariants()}>
                <Plus aria-hidden="true" />
                {t('priceBooks.list.new')}
              </Link>
            ) : null}
          </>
        }
      />

      <ListFilters
        search={searchText}
        onSearch={setSearchText}
        type={type}
        status={status}
        currency={currency}
        channelId={channelId}
        audienceKind={audienceKind}
        memberId={memberId}
        currencies={currencies}
        channels={channels.map((c) => ({ id: c.id, name: localizedName(c.name, c.code) }))}
        groups={groups}
        onFilter={setFilter}
        onClear={filtered ? clearFilters : null}
      />

      <p role="status" className="sr-only">
        {state.kind === 'loading'
          ? t('priceBooks.list.loading')
          : state.kind === 'ready'
            ? t('priceBooks.list.loaded', { count: state.answer.data.length })
            : ''}
      </p>

      {state.kind === 'loading' ? (
        <div data-testid="price-books-loading" aria-busy="true" className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded bg-muted motion-safe:animate-pulse" aria-hidden="true" />
          ))}
        </div>
      ) : state.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {state.message}
              {state.detail ? <span className="block text-xs">{state.detail}</span> : null}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={(): void => setAttempt((n) => n + 1)}>
              <RotateCcw aria-hidden="true" />
              {t('priceBooks.common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-md border">
          <ResponsiveTable
            columns={columns}
            data={state.answer.data}
            keyExtractor={(book) => book.id}
            renderActions={(book) =>
              mayChange(book) ? (
                <RowActionMenu label={t('priceBooks.list.actionsFor', { name: book.name })}>
                  <RowActionMenuItem onSelect={(): void => void navigate(`/price-lists/${book.id}`)}>
                    {t('priceBooks.list.open')}
                  </RowActionMenuItem>
                  <RowActionMenuSeparator />
                  <RowActionMenuItem destructive onSelect={(): void => setDeleting(book)}>
                    {t('priceBooks.delete.action')}
                  </RowActionMenuItem>
                </RowActionMenu>
              ) : null
            }
            emptyState={
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BookOpen className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                {filtered ? (
                  <>
                    <p className="font-medium">{t('priceBooks.list.emptyFiltered.title')}</p>
                    <p className="text-sm text-muted-foreground">{t('priceBooks.list.emptyFiltered.body')}</p>
                    <Button type="button" variant="outline" onClick={clearFilters}>
                      {t('priceBooks.list.filters.clear')}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="font-medium">{t('priceBooks.list.empty.title')}</p>
                    <p className="text-sm text-muted-foreground">{t('priceBooks.list.empty.body')}</p>
                  </>
                )}
              </div>
            }
          />
          {total > 0 ? (
            <PaginationFooter
              page={page - 1}
              pageSize={pageSize}
              total={total}
              onPageSizeChange={(next): void => {
                setPageSize(next);
                setFilter({ page: null });
              }}
              onPrev={(): void => setFilter({ page: page > 2 ? String(page - 1) : null })}
              onNext={(): void => setFilter({ page: String(page + 1) })}
            />
          ) : null}
        </div>
      )}

      {deleting ? (
        <DeleteBookDialog
          book={deleting}
          onClose={(): void => setDeleting(null)}
          onDeleted={(): void => {
            setDeleting(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : null}
    </>
  );
}

/** The filter bar: every control writes one URL parameter. */
function ListFilters(props: {
  readonly search: string;
  readonly onSearch: (text: string) => void;
  readonly type: string | null;
  readonly status: string | null;
  readonly currency: string | null;
  readonly channelId: string | null;
  readonly audienceKind: string | null;
  readonly memberId: string | null;
  readonly currencies: readonly PriceBookTargetCurrency[];
  readonly channels: readonly { id: string; name: string }[];
  readonly groups: readonly PriceBookTargetCustomerGroup[];
  readonly onFilter: (changes: Record<string, string | null>) => void;
  readonly onClear: (() => void) | null;
}): ReactNode {
  const t = useTranslation('price_lists');
  const base = useId();
  const select = (
    key: string,
    label: string,
    value: string | null,
    options: readonly { value: string; label: string }[],
    extra: Record<string, string | null> = {},
  ): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={`${base}-${key}`}>{label}</Label>
      <Select
        id={`${base}-${key}`}
        value={value ?? ''}
        onChange={(event): void => props.onFilter({ [key]: event.target.value || null, ...extra })}
      >
        <option value="">{t('priceBooks.list.filters.any')}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <form
      role="search"
      aria-label={t('priceBooks.list.filters.label')}
      className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(event): void => event.preventDefault()}
    >
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${base}-search`}>{t('priceBooks.list.filters.search')}</Label>
        <Input
          id={`${base}-search`}
          type="search"
          value={props.search}
          onChange={(event): void => props.onSearch(event.target.value)}
        />
      </div>
      {select('type', t('priceBooks.list.filters.type'), props.type, BOOK_TYPES.map((v) => ({ value: v, label: typeLabel(t, v) })))}
      {select(
        'status',
        t('priceBooks.list.filters.status'),
        props.status,
        BOOK_STATUSES.map((v) => ({ value: v, label: statusLabel(t, v) })),
      )}
      {select('currency', t('priceBooks.list.filters.currency'), props.currency, props.currencies.map((c) => ({ value: c.code, label: c.code })))}
      {select('channelId', t('priceBooks.list.filters.channel'), props.channelId, props.channels.map((c) => ({ value: c.id, label: c.name })))}
      {select(
        'audienceKind',
        t('priceBooks.list.filters.audience'),
        props.audienceKind,
        AUDIENCE_KINDS.map((v) => ({ value: v, label: audienceLabel(t, v) })),
        { memberId: null },
      )}
      {props.audienceKind === 'customer_groups'
        ? select(
            'memberId',
            t('priceBooks.list.filters.member'),
            props.memberId,
            props.groups.map((g) => ({ value: g.id, label: g.name })),
          )
        : null}
      {props.audienceKind === 'organizations' ? (
        <OrganizationMemberFilter memberId={props.memberId} onChange={(id): void => props.onFilter({ memberId: id })} />
      ) : null}
      {props.onClear ? (
        <div className="flex items-end">
          <Button type="button" variant="ghost" onClick={props.onClear}>
            <X aria-hidden="true" />
            {t('priceBooks.list.filters.clear')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** The organization a list is filtered by: named through G12, searched through the scope-filtered targets. */
function OrganizationMemberFilter(props: {
  readonly memberId: string | null;
  readonly onChange: (id: string | null) => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [name, setName] = useState<string | null>(null);
  const id = useId();

  useEffect(() => {
    if (!props.memberId) {
      setName(null);
      return undefined;
    }
    let cancelled = false;
    void api.targets
      .organizations({ ids: [props.memberId] })
      .then((orgs) => {
        if (!cancelled) setName(orgs[0]?.name ?? t('priceBooks.members.unknown'));
      })
      .catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [api, props.memberId, t]);

  useEffect(() => {
    if (props.memberId) return undefined;
    let cancelled = false;
    const timer = setTimeout(
      () => {
        void api.targets
          .organizations(query.trim() ? { search: query.trim(), limit: 20 } : { limit: 20 })
          .then((orgs) => {
            if (!cancelled) setOptions(orgs.map((o) => ({ value: o.id, label: o.name, description: o.taxId })));
          })
          .catch(() => undefined);
      },
      query === '' ? 0 : 250,
    );
    return (): void => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, props.memberId, query]);

  const label = t('priceBooks.list.filters.member');
  return (
    <div className="space-y-1">
      {props.memberId ? (
        <>
          <p className="text-sm font-medium leading-none">{label}</p>
          <div className="flex min-h-9 items-center">
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pl-3 pr-1 text-sm">
              <span>{name ?? '…'}</span>
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t('priceBooks.list.filters.memberRemove')}
                onClick={(): void => props.onChange(null)}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          </div>
        </>
      ) : (
        <>
          <Label htmlFor={id}>{label}</Label>
          <Combobox<string>
            id={id}
            options={options}
            value={null}
            onChange={(value): void => props.onChange(value)}
            onSearchChange={setQuery}
            manualFilter
            clearable={false}
            placeholder={t('priceBooks.members.addOrganization')}
            emptyMessage={t('priceBooks.members.noMatch')}
            ariaLabel={label}
          />
        </>
      )}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default PriceBooksPage;
