import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Copy, HelpCircle, History, RotateCcw, SearchX } from 'lucide-react';
import type { PriceBook, PriceBookAudienceKind, PriceBookTargetSalesChannel } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, PageHeader, buttonVariants } from '@endora-commerce/admin-kit/ui';
import { DuplicateDialog } from '../components/DuplicateDialog.js';
import { PriceBookGrid } from '../components/PriceBookGrid.js';
import { PriceBookHeaderForm } from '../components/PriceBookHeaderForm.js';
import { errorMessage, errorStatus } from '../lib/api-errors.js';
import { AUDIENCE_KINDS, statusLabel, typeLabel } from '../lib/book-labels.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * One price book, `/price-lists/:id` (feature 161, US1 and US2; the address
 * P1's audit reference resolver links to): its settings and its prices, as two
 * tabs. The tab is in the URL (`?tab=prices`), so a link can open the prices;
 * both panels stay mounted, so unsaved prices survive a look at the settings.
 *
 * A book the caller may not see answers exactly as an unknown one — the server
 * says `404` for both (R10, SC-006) and so does this page. The history link is
 * the audit log filtered to the book (G13).
 */

const TABS = ['settings', 'prices'] as const;
type Tab = (typeof TABS)[number];

type BookState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'notFound' }
  | { readonly kind: 'error'; readonly message: string; readonly detail: string }
  | { readonly kind: 'ready'; readonly book: PriceBook };

export function PriceBookPage(): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const { id = '' } = useParams();
  const { hasPermission } = useAuth();
  const [state, setState] = useState<BookState>({ kind: 'loading' });
  const [channels, setChannels] = useState<PriceBookTargetSalesChannel[]>([]);
  const [kinds, setKinds] = useState<readonly PriceBookAudienceKind[]>(AUDIENCE_KINDS);
  const [duplicating, setDuplicating] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'prices' ? 'prices' : 'settings';
  const tabsId = useId();
  const selectTab = (next: Tab): void => {
    setParams(
      (current) => {
        const out = new URLSearchParams(current);
        if (next === 'settings') out.delete('tab');
        else out.set('tab', next);
        return out;
      },
      { replace: true },
    );
  };
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next: Tab = tab === 'settings' ? 'prices' : 'settings';
    selectTab(next);
    document.getElementById(`${tabsId}-${next}-tab`)?.focus();
  };

  const load = useCallback(async (): Promise<void> => {
    try {
      setState({ kind: 'ready', book: await api.get(id) });
    } catch (err) {
      setState(errorStatus(err) === 404 ? { kind: 'notFound' } : { kind: 'error', message: t('priceBooks.book.error.load'), detail: errorMessage(err, '') });
    }
  }, [api, id, t]);

  useEffect(() => {
    setState({ kind: 'loading' });
    void load();
  }, [load]);

  useEffect(() => {
    void api.targets.salesChannels().then(setChannels).catch(() => undefined);
    void api
      .list({ page: 1, pageSize: 1 })
      .then((answer) => setKinds(answer.meta.creatableAudienceKinds))
      .catch(() => undefined);
  }, [api]);

  if (state.kind === 'loading') {
    return (
      <div aria-busy="true" className="space-y-3">
        <p role="status" className="sr-only">
          {t('priceBooks.book.loading')}
        </p>
        <div className="h-8 w-64 rounded bg-muted motion-safe:animate-pulse" aria-hidden="true" />
        <div className="h-40 rounded bg-muted motion-safe:animate-pulse" aria-hidden="true" />
      </div>
    );
  }
  if (state.kind === 'notFound') {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
        <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">{t('priceBooks.book.notFound.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('priceBooks.book.notFound.body')}</p>
        <Link to="/price-lists" className={buttonVariants({ variant: 'outline' })}>
          {t('priceBooks.common.backToList')}
        </Link>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>
            {state.message}
            {state.detail ? <span className="block text-xs">{state.detail}</span> : null}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={(): void => void load()}>
            <RotateCcw aria-hidden="true" />
            {t('priceBooks.common.retry')}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const { book } = state;
  const editable = hasPermission('price_lists:write') && book.writable;
  return (
    <>
      <PageHeader
        title={book.name}
        back={{ label: t('priceBooks.common.backToList'), to: '/price-lists' }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {book.isSystem ? <Badge variant="secondary">{t('priceBooks.list.base', { currency: book.currencyCode })}</Badge> : null}
            <Badge variant={book.status === 'active' ? 'success' : 'outline'}>{statusLabel(t, book.status)}</Badge>
            <span>{typeLabel(t, book.type)}</span>
            <span aria-hidden="true">·</span>
            <span>{book.currencyCode}</span>
          </span>
        }
        actions={
          <>
            {/* A book the caller may not change offers no duplicate either
                (A3.3, FR-027): absent, not disabled. */}
            {editable && !book.isSystem ? (
              <Button type="button" variant="outline" onClick={(): void => setDuplicating(true)}>
                <Copy aria-hidden="true" />
                {t('duplicate.open')}
              </Button>
            ) : null}
            <Link to={`/price-lists/explain?${new URLSearchParams({ bookId: book.id }).toString()}`} className={buttonVariants({ variant: 'outline' })}>
              <HelpCircle aria-hidden="true" />
              {t('explainer.entry.book')}
            </Link>
            <Link
              to={`/audit-log?objectType=price_list&objectId=${encodeURIComponent(book.id)}`}
              className={buttonVariants({ variant: 'outline' })}
            >
              <History aria-hidden="true" />
              {t('priceBooks.header.history')}
            </Link>
          </>
        }
      />
      <div role="tablist" aria-label={t('priceBooks.book.tabs')} className="mb-4 flex gap-1 border-b">
        {TABS.map((name) => (
          <button
            key={name}
            id={`${tabsId}-${name}-tab`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`${tabsId}-${name}-panel`}
            tabIndex={tab === name ? 0 : -1}
            className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9 ${
              tab === name ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={(): void => selectTab(name)}
            onKeyDown={onTabKey}
          >
            {t(`priceBooks.book.tab.${name}`)}
          </button>
        ))}
      </div>
      <div id={`${tabsId}-settings-panel`} role="tabpanel" aria-labelledby={`${tabsId}-settings-tab`} hidden={tab !== 'settings'}>
        <PriceBookHeaderForm
          book={book}
          channels={channels}
          kinds={kinds}
          editable={editable}
          onChanged={(next): void => setState({ kind: 'ready', book: next })}
          onReload={(): void => void load()}
        />
      </div>
      {duplicating ? <DuplicateDialog book={book} channels={channels} kinds={kinds} onClose={(): void => setDuplicating(false)} /> : null}
      <div id={`${tabsId}-prices-panel`} role="tabpanel" aria-labelledby={`${tabsId}-prices-tab`} hidden={tab !== 'prices'}>
        <PriceBookGrid
          book={book}
          editable={editable}
          initialSearch={params.get('search') ?? ''}
          onBookChanged={(next): void => setState({ kind: 'ready', book: next })}
        />
      </div>
    </>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default PriceBookPage;
