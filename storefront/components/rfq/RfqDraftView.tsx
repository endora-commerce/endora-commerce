'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { lineAmountHalfUp, roundAmountHalfUp } from '@endora-commerce/contracts';
import { formatMoney as formatMoneyShared } from '../../lib/i18n/money';
import {
  clampDraftQuantity,
  clearRfqDraft,
  draftQuantityFloor,
  draftQuantityOnBlur,
  draftQuantityOnType,
  readRfqDraft,
  removeRfqDraftItem,
  setRfqDraftProposedPrice,
  setRfqDraftQuantity,
  RFQ_DRAFT_CHANGED_EVENT,
  RFQ_DRAFT_STORAGE_KEY,
  type RfqDraftItem,
} from '../../lib/rfqDraft';
import { readDraftMinimums, submitQuoteRequest } from '../../app/(commerce)/quote-request/actions';
import type { CreateRfqLine } from '../../lib/api/rfq';
import { belowMinimumText } from '../../lib/cartMinimum';
import { formatCount, minimumStatement } from '../../lib/orderMinimum';
import { tForLocale } from '../../lib/i18n/messages';

/**
 * Quote-request draft view — the cart-modelled "review & submit" page at
 * `/quote-request`. Lines come from the client-side draft (`lib/rfqDraft`);
 * the buyer can adjust quantities, remove lines, add a note, then press
 * "Submit quote request" to create the actual server-side Quote Request via
 * `POST /api/v1/quote-requests` (one-shot, full `items[]` payload).
 *
 * On success the draft is cleared and the buyer is routed to the quote-request
 * success page (`/quote-requests/success?id=…`). Anonymous buyers (401) are
 * bounced to /login first, keeping their draft intact so they can finish after
 * signing in.
 *
 * Feature 146 (FR-021): `priceProposalsAllowed` is the signed-in buyer's own
 * effective negotiation value, read by the server page. When it is `false` the
 * proposed-price input is hidden, each line shows its catalogue price
 * read-only, a note says sales will price the request, and the stored
 * proposals are not sent — they stay in the browser draft, untouched (spec
 * Assumption). The API refuses a proposal sent anyway (FR-022).
 *
 * Feature 155 (FR-032): the draft mirrors the cart for the pieces minimum. The draft stores no
 * minimum (a line may predate one, US4 #14), so after hydration the view reads each product's
 * **current** minimum through the `readDraftMinimums` server action; until it answers — or for
 * a product it cannot read — a line has no floor beyond 1, and the API refusal at submission
 * stays the binding rule. Submission is not blocked by a line below its minimum: the API's
 * translated refusal names it, and the line already says so.
 */
export function RfqDraftView(props: {
  locale: string;
  priceProposalsAllowed: boolean;
}): ReactNode {
  const pl = props.locale.startsWith('pl');
  const t = strings(pl);
  const proposalsAllowed = props.priceProposalsAllowed;
  const router = useRouter();

  const [items, setItems] = useState<RfqDraftItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimums, setMinimums] = useState<Record<string, number | null>>({});

  useEffect(() => {
    const refresh = (): void => setItems(readRfqDraft());
    refresh();
    setHydrated(true);
    const onStorage = (e: StorageEvent): void => {
      if (e.key === RFQ_DRAFT_STORAGE_KEY || e.key === null) refresh();
    };
    window.addEventListener(RFQ_DRAFT_CHANGED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(RFQ_DRAFT_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Feature 155 — re-read the minimums whenever the set of products changes (an add in another
  // tab included), not on every quantity edit. A stale answer is dropped on cleanup.
  const slugKey = useMemo(
    () => [...new Set(items.map((i) => i.slug).filter((s) => s !== ''))].sort().join('\n'),
    [items],
  );
  useEffect(() => {
    if (slugKey === '') return;
    let cancelled = false;
    readDraftMinimums(slugKey.split('\n'))
      .then((answer) => {
        if (!cancelled) setMinimums(answer);
      })
      .catch(() => {
        // Minimums unknown: the lines keep a floor of 1 and the API judges at submission.
      });
    return () => {
      cancelled = true;
    };
  }, [slugKey]);

  const currency = items.find((i) => i.unitPrice)?.unitPrice?.currency ?? null;
  // A line counts as priced when the buyer proposed a price or the catalogue
  // carries one; the subtotal then uses the proposed price where given. A
  // locked buyer's proposals are not sent, so they are not counted either.
  const allPriced =
    items.length > 0 && items.every((i) => effectiveUnitPrice(i, proposalsAllowed) !== null);
  const subtotal = allPriced
    ? items.reduce(
        (sum, i) => sum + (effectiveUnitPrice(i, proposalsAllowed) ?? 0) * i.quantity,
        0,
      )
    : null;

  const submit = async (): Promise<void> => {
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // Submit through a server action so the httpOnly `b2b_session` cookie is
      // read server-side and forwarded to the backend with the buyer's
      // identity. A browser fetch to the backend origin cannot carry that
      // cookie, which previously 401'd logged-in buyers and dropped the draft.
      const result = await submitQuoteRequest({
        ...(note.trim() ? { headerNote: note.trim() } : {}),
        items: buildSubmitItems(items, proposalsAllowed),
      });
      if (!result.ok && result.reason === 'auth') {
        window.location.href = '/login?next=/quote-request';
        return;
      }
      if (!result.ok) {
        throw new Error(result.message || t.errorGeneric);
      }
      clearRfqDraft();
      router.push(`/quote-requests/success?id=${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric);
      setSubmitting(false);
    }
  };

  if (!hydrated) {
    return <div className="mx-auto max-w-[1360px] px-[24px] py-[48px]" aria-busy="true" />;
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[1360px] px-[24px] pt-[8px] pb-[64px]">
        <Breadcrumbs t={t} />
        <div className="rounded-md border border-line bg-surface px-[24px] py-[48px] text-center">
          <h1 className="m-0 mb-2 text-[22px] font-semibold text-fg">{t.heading}</h1>
          <p className="m-0 mb-[18px] text-[14px] text-muted">{t.empty}</p>
          <div className="flex justify-center gap-3">
            <Link href="/catalog" className="btn btn--dark">
              {t.browseCatalog}
            </Link>
            <Link href="/quote-requests" className="btn btn--outline">
              {t.myRequests}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1360px] px-[24px] pt-[8px] pb-[64px]">
      <Breadcrumbs t={t} />
      <header className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[24px] font-semibold tracking-[-0.02em] text-fg">{t.heading}</h1>
          <p className="mt-1 text-[13px] text-muted">{t.subheading(items.length)}</p>
        </div>
        <Link href="/quote-requests" className="btn btn--outline btn--sm">
          {t.myRequests}
        </Link>
      </header>

      {error ? (
        <div
          className="mb-3 rounded-md border border-[#fecaca] bg-[#fef2f2] px-[14px] py-[10px] text-[13px] text-[#b91c1c]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {proposalsAllowed ? null : <LockedPricingNote t={t} />}

      <div className="grid grid-cols-[1fr_380px] items-start gap-8 max-[960px]:grid-cols-1">
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-[22px] py-[18px]">
            <h2 className="m-0 text-[18px] font-semibold text-fg">{t.cardHeading}</h2>
            <span className="font-mono text-[12px] text-muted">{t.itemCount(items.length)}</span>
          </div>

          {items.map((line) => (
            <DraftLine
              key={line.productId}
              line={line}
              t={t}
              locale={props.locale}
              minimum={minimums[line.slug] ?? null}
              proposalsAllowed={proposalsAllowed}
              onQty={(q): void =>
                setItems(setRfqDraftQuantity(line.productId, q, minimums[line.slug] ?? null))
              }
              onProposedPrice={(p): void =>
                setItems(setRfqDraftProposedPrice(line.productId, p))
              }
              onRemove={(): void => setItems(removeRfqDraftItem(line.productId))}
            />
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-[22px] py-[18px]">
            <Link href="/catalog" className="btn btn--ghost">
              ← {t.continueShopping}
            </Link>
            <button
              type="button"
              onClick={(): void => {
                clearRfqDraft();
                setItems([]);
              }}
              className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-muted underline underline-offset-2"
            >
              {t.clearAll}
            </button>
          </div>
        </div>

        <aside className="sticky top-[96px] rounded-md border border-line bg-surface p-[20px]">
          <h3 className="m-0 mb-[14px] text-[14px] font-semibold text-fg">{t.summaryHeading}</h3>

          <div className="flex items-center justify-between border-b border-line pb-[10px] text-[13px]">
            <span className="text-muted">{t.linesLabel}</span>
            <span className="font-mono font-semibold text-fg">{items.length}</span>
          </div>
          <div className="flex items-center justify-between py-[10px] text-[13px]">
            <span className="text-muted">{t.estTotalLabel}</span>
            <span className="font-mono font-semibold text-fg">
              {subtotal !== null && currency ? formatMoney(subtotal, currency) : t.onRequest}
            </span>
          </div>

          <label htmlFor="rfq-note" className="mt-2 block text-[12px] font-medium text-fg-soft">
            {t.noteLabel}
          </label>
          <textarea
            id="rfq-note"
            value={note}
            onChange={(e): void => setNote(e.target.value)}
            rows={3}
            placeholder={t.notePlaceholder}
            className="mt-1 w-full resize-y rounded-sm border border-line px-[10px] py-[8px] text-[13px]"
          />

          <button
            type="button"
            onClick={(): void => void submit()}
            disabled={submitting}
            className="btn btn--dark btn--lg btn--block mt-4"
            style={submitting ? { opacity: 0.6, cursor: 'wait' } : undefined}
          >
            {submitting ? t.submitting : t.submit}
          </button>

          <p className="mt-[12px] border-t border-line pt-[12px] text-[12px] text-muted">
            {t.note}
          </p>
        </aside>
      </div>
    </div>
  );
}

/**
 * The submit payload (FR-021): a line carries `desiredUnitPrice` only when the
 * buyer may propose prices and proposed one. The draft lines are not modified.
 */
export function buildSubmitItems(
  items: readonly RfqDraftItem[],
  proposalsAllowed: boolean,
): CreateRfqLine[] {
  return items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    ...(proposalsAllowed && i.proposedUnitPrice != null
      ? { desiredUnitPrice: i.proposedUnitPrice }
      : {}),
  }));
}

/**
 * The unit price a line is valued at on this page: the buyer's proposal where
 * they may propose and did, otherwise the catalogue snapshot.
 */
function effectiveUnitPrice(line: RfqDraftItem, proposalsAllowed: boolean): number | null {
  if (proposalsAllowed && line.proposedUnitPrice != null) return line.proposedUnitPrice;
  return line.unitPrice?.amount ?? null;
}

/**
 * The page-level note shown to a buyer who may not propose prices (FR-021).
 * Said once above the lines rather than on every line (Law of Proximity: it
 * describes the whole request, not one product).
 */
export function LockedPricingNote({ t }: { t: Strings }): ReactNode {
  return (
    <p
      role="note"
      className="mb-3 rounded-md border border-line bg-surface-alt px-[14px] py-[10px] text-[13px] text-fg-soft"
    >
      {t.lockedPricingNote}
    </p>
  );
}

export function DraftLine({
  line,
  t,
  locale = 'en-US',
  minimum = null,
  proposalsAllowed,
  onQty,
  onProposedPrice,
  onRemove,
}: {
  line: RfqDraftItem;
  t: Strings;
  /** Request locale for the minimum's wording (feature 155). */
  locale?: string;
  /**
   * Feature 155 (FR-032) — the product's current pieces minimum, read by the view; `null` while
   * unknown or when there is none. The input floors at it and a line below it says so.
   */
  minimum?: number | null;
  proposalsAllowed: boolean;
  onQty: (q: number) => void;
  onProposedPrice: (price: number | null) => void;
  onRemove: () => void;
}): ReactNode {
  // The line total reflects the buyer's proposed price when given, otherwise
  // the catalogue snapshot — so it tracks whatever they actually want quoted.
  // A locked buyer's stored proposal is neither shown nor counted (FR-021).
  const effectiveUnit = effectiveUnitPrice(line, proposalsAllowed);
  const currency = line.unitPrice?.currency ?? 'PLN';
  const lineTotal = effectiveUnit !== null ? Number(lineAmountHalfUp(effectiveUnit, line.quantity)) : null;
  // Feature 155 — the floor is the minimum itself, also for a line already below it: the input
  // then reads as invalid (`aria-invalid`), "−" is off and "+" or the fix lifts it to the floor.
  const floor = draftQuantityFloor(minimum);
  const below = floor > 1 && line.quantity < floor;
  const belowText = below ? belowMinimumText({ belowMinimum: { kind: 'pieces', minimum: floor } }, locale) : null;
  const statement = !below ? minimumStatement({ minOrderQuantity: minimum }, null, locale) : null;
  const belowId = `rfq-line-${line.productId}-minimum`;
  const [qtyText, setQtyText] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-[56px_1fr_130px_140px_120px_28px] items-center gap-[14px] border-b border-line px-[22px] py-[14px] last:border-b-0 max-[720px]:grid-cols-[56px_1fr_auto]">
      <div
        className="grid h-[56px] w-[56px] place-items-center rounded-sm bg-surface-alt text-line-strong [&_svg]:h-[60%] [&_svg]:w-[60%]"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 6V4h8v2" />
        </svg>
      </div>

      <div className="flex min-w-0 flex-col gap-[2px]">
        {line.slug ? (
          <a
            href={`/p/${encodeURIComponent(line.slug)}`}
            className="line-clamp-2 text-[14px] font-semibold leading-[1.3] text-fg no-underline hover:underline"
          >
            {line.name}
          </a>
        ) : (
          <span className="line-clamp-2 text-[14px] font-semibold leading-[1.3] text-fg">
            {line.name}
          </span>
        )}
        <span className="text-[11px] text-muted">
          {line.unitPrice ? formatMoney(line.unitPrice.amount, line.unitPrice.currency) : t.onRequest}
          {' / '}
          {t.unit}
        </span>
        {statement ? <span className="text-[11px] text-muted">{statement}</span> : null}
        {belowText ? (
          <div className="mt-[2px] flex flex-wrap items-center gap-x-2 gap-y-1">
            <span id={belowId} className="inline-flex items-center gap-1 text-[12px] font-semibold text-warn">
              <svg
                viewBox="0 0 24 24"
                width={13}
                height={13}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
              {belowText}
            </span>
            <button
              type="button"
              onClick={(): void => onQty(floor)}
              aria-describedby={belowId}
              className="cursor-pointer rounded-sm border border-line bg-surface px-[8px] py-[2px] text-[12px] font-medium text-fg hover:border-line-strong hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[720px]:min-h-[44px]"
            >
              {tForLocale(locale)('cart.line.setToMinimum').replace('{count}', formatCount(floor, locale))}
            </button>
          </div>
        ) : null}
      </div>

      <div className="qty__stepper" role="group" aria-label={t.qtyLabel}>
        <button
          type="button"
          aria-label="−"
          title="−"
          disabled={line.quantity <= floor}
          onClick={(): void => onQty(clampDraftQuantity(line.quantity - 1, minimum))}
        >
          −
        </button>
        <input
          type="number"
          min={floor}
          value={qtyText ?? line.quantity}
          aria-label={t.qtyLabel}
          {...(belowText ? { 'aria-invalid': true, 'aria-describedby': belowId } : {})}
          onChange={(e): void => {
            // What was typed is kept as typed — "15" over a floor of 10 is not rewritten on the
            // "1" — and saved as soon as it is a whole quantity at or above the floor; anything
            // else is normalised on blur (Postel's Law).
            setQtyText(e.target.value);
            const typed = draftQuantityOnType(e.target.value, minimum);
            if (typed !== null) onQty(typed);
          }}
          onBlur={(e): void => {
            const settled = draftQuantityOnBlur(e.target.value, minimum, qtyText !== null);
            if (settled !== null) onQty(settled);
            setQtyText(null);
          }}
        />
        <button
          type="button"
          aria-label="+"
          title="+"
          onClick={(): void => onQty(clampDraftQuantity(line.quantity + 1, minimum))}
        >
          +
        </button>
      </div>

      {proposalsAllowed ? (
        <label className="flex flex-col gap-[3px]">
          <span className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted">
            {t.proposedPriceLabel}
          </span>
          <span className="flex items-center gap-[6px] rounded-sm border border-line px-[8px] py-[6px] focus-within:border-line-strong">
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={line.proposedUnitPrice ?? ''}
              placeholder={line.unitPrice ? roundAmountHalfUp(line.unitPrice.amount) : '—'}
              aria-label={t.proposedPriceLabel}
              className="w-full min-w-0 border-0 bg-transparent p-0 text-right font-mono text-[14px] text-fg outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              onChange={(e): void => {
                const raw = e.target.value.trim();
                if (raw === '') {
                  onProposedPrice(null);
                  return;
                }
                const n = Number(raw);
                onProposedPrice(Number.isFinite(n) && n >= 0 ? n : null);
              }}
            />
            <span className="font-mono text-[11px] text-muted">{currency}</span>
          </span>
        </label>
      ) : (
        <div className="flex flex-col gap-[3px]">
          <span className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted">
            {t.catalogPriceLabel}
          </span>
          <span className="py-[6px] text-right font-mono text-[14px] text-fg">
            {line.unitPrice
              ? formatMoney(line.unitPrice.amount, line.unitPrice.currency)
              : t.onRequest}
          </span>
        </div>
      )}

      <span className="text-right font-mono text-[14px] font-semibold text-fg max-[720px]:hidden" aria-label={t.lineTotalLabel}>
        {lineTotal !== null ? formatMoney(lineTotal, currency) : '—'}
      </span>

      <button
        type="button"
        onClick={onRemove}
        className="grid h-[28px] w-[28px] cursor-pointer place-items-center rounded-sm border border-transparent bg-transparent text-muted transition hover:bg-surface-alt hover:text-[#b91c1c]"
        aria-label={t.removeLabel}
        title={t.removeLabel}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}

function Breadcrumbs({ t }: { t: Strings }): ReactNode {
  return (
    <nav
      aria-label="Breadcrumb"
      className="my-[8px] mb-[16px] flex gap-[6px] text-[13px] text-[color:var(--ink-500)]"
    >
      <Link href="/" className="text-inherit">
        {t.home}
      </Link>
      <span aria-hidden="true">/</span>
      <span className="text-[color:var(--ink-900)]">{t.heading}</span>
    </nav>
  );
}

function formatMoney(amount: number, currency: string): string {
  return formatMoneyShared(amount, currency);
}

export interface Strings {
  home: string;
  heading: string;
  subheading: (n: number) => string;
  empty: string;
  browseCatalog: string;
  myRequests: string;
  cardHeading: string;
  itemCount: (n: number) => string;
  continueShopping: string;
  clearAll: string;
  summaryHeading: string;
  linesLabel: string;
  estTotalLabel: string;
  onRequest: string;
  unit: string;
  qtyLabel: string;
  proposedPriceLabel: string;
  catalogPriceLabel: string;
  lockedPricingNote: string;
  lineTotalLabel: string;
  removeLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  submit: string;
  submitting: string;
  note: string;
  errorGeneric: string;
}

export function strings(pl: boolean): Strings {
  if (pl) {
    return {
      home: 'Strona główna',
      heading: 'Zapytanie ofertowe',
      subheading: (n) => (n === 1 ? '1 produkt w zapytaniu.' : `${n} produkty(ów) w zapytaniu.`),
      empty: 'Twoje zapytanie ofertowe jest puste.',
      browseCatalog: 'Przejdź do katalogu',
      myRequests: 'Moje zapytania',
      cardHeading: 'Pozycje zapytania',
      itemCount: (n) => (n === 1 ? '1 pozycja' : `${n} pozycji`),
      continueShopping: 'Kontynuuj zakupy',
      clearAll: 'Wyczyść wszystko',
      summaryHeading: 'Podsumowanie',
      linesLabel: 'Liczba pozycji',
      estTotalLabel: 'Szacowana wartość',
      onRequest: 'Cena na zapytanie',
      unit: 'szt.',
      qtyLabel: 'Ilość',
      proposedPriceLabel: 'Proponowana cena',
      catalogPriceLabel: 'Cena katalogowa',
      lockedPricingNote:
        'Ceny w tym zapytaniu ustali dział sprzedaży. Przy pozycjach widzisz cenę katalogową — możesz zmienić ilości i dodać uwagi.',
      lineTotalLabel: 'Wartość pozycji',
      removeLabel: 'Usuń',
      noteLabel: 'Uwagi do zapytania (opcjonalnie)',
      notePlaceholder: 'Np. preferowany termin dostawy, wymagania techniczne…',
      submit: 'Złóż zapytanie ofertowe',
      submitting: 'Wysyłanie…',
      note: 'Po złożeniu zapytania dział sprzedaży przygotuje ofertę z cenami i warunkami.',
      errorGeneric: 'Nie udało się złożyć zapytania ofertowego.',
    };
  }
  return {
    home: 'Home',
    heading: 'Quote request',
    subheading: (n) => (n === 1 ? '1 product in your request.' : `${n} products in your request.`),
    empty: 'Your quote request is empty.',
    browseCatalog: 'Browse the catalog',
    myRequests: 'My requests',
    cardHeading: 'Request items',
    itemCount: (n) => (n === 1 ? '1 item' : `${n} items`),
    continueShopping: 'Continue shopping',
    clearAll: 'Clear all',
    summaryHeading: 'Summary',
    linesLabel: 'Line items',
    estTotalLabel: 'Estimated total',
    onRequest: 'Price on request',
    unit: 'pc.',
    qtyLabel: 'Quantity',
    proposedPriceLabel: 'Proposed price',
    catalogPriceLabel: 'Catalogue price',
    lockedPricingNote:
      'Our sales team will set the prices for this request. Each line shows its catalogue price — you can still change quantities and add notes.',
    lineTotalLabel: 'Line total',
    removeLabel: 'Remove',
    noteLabel: 'Notes for sales (optional)',
    notePlaceholder: 'E.g. preferred delivery date, technical requirements…',
    submit: 'Submit quote request',
    submitting: 'Submitting…',
    note: 'After you submit, our sales team will prepare a quote with prices and terms.',
    errorGeneric: 'Could not submit the quote request.',
  };
}
