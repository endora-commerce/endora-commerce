'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  clearRfqDraft,
  readRfqDraft,
  removeRfqDraftItem,
  setRfqDraftProposedPrice,
  setRfqDraftQuantity,
  RFQ_DRAFT_CHANGED_EVENT,
  RFQ_DRAFT_STORAGE_KEY,
  type RfqDraftItem,
} from '../../lib/rfqDraft';

/**
 * Quote-request draft view — the cart-modelled "review & submit" page at
 * `/quote-request`. Lines come from the client-side draft (`lib/rfqDraft`);
 * the buyer can adjust quantities, remove lines, add a note, then press
 * "Submit quote request" to create the actual server-side Quote Request via
 * `POST /api/v1/quote-requests` (one-shot, full `items[]` payload).
 *
 * On success the draft is cleared and the buyer is routed to the created
 * request's detail page. Anonymous buyers (401) are bounced to /login first,
 * keeping their draft intact so they can finish after signing in.
 */
export function RfqDraftView(props: { apiBase: string; locale: string }): ReactNode {
  const pl = props.locale.startsWith('pl');
  const t = strings(pl);
  const router = useRouter();

  const [items, setItems] = useState<RfqDraftItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const currency = items.find((i) => i.unitPrice)?.unitPrice?.currency ?? null;
  // A line counts as priced when the buyer proposed a price or the catalogue
  // carries one; the subtotal then uses the proposed price where given.
  const allPriced =
    items.length > 0 && items.every((i) => i.proposedUnitPrice != null || i.unitPrice);
  const subtotal = allPriced
    ? items.reduce(
        (sum, i) => sum + (i.proposedUnitPrice ?? i.unitPrice?.amount ?? 0) * i.quantity,
        0,
      )
    : null;

  const submit = async (): Promise<void> => {
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${props.apiBase}/api/v1/quote-requests`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          ...(note.trim() ? { headerNote: note.trim() } : {}),
          items: items.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            ...(i.proposedUnitPrice != null ? { desiredUnitPrice: i.proposedUnitPrice } : {}),
          })),
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login?next=/quote-request';
        return;
      }
      if (!res.ok) {
        let message = t.errorGeneric;
        try {
          const body = (await res.json()) as { error?: { message?: string }; message?: string };
          message = body.error?.message ?? body.message ?? message;
        } catch {
          /* keep the generic message */
        }
        throw new Error(message);
      }
      const body = (await res.json()) as { data?: { id?: string } };
      const id = body.data?.id;
      clearRfqDraft();
      router.push(id ? `/quote-requests/${id}` : '/quote-requests');
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
              onQty={(q): void => setItems(setRfqDraftQuantity(line.productId, q))}
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

function DraftLine({
  line,
  t,
  onQty,
  onProposedPrice,
  onRemove,
}: {
  line: RfqDraftItem;
  t: Strings;
  onQty: (q: number) => void;
  onProposedPrice: (price: number | null) => void;
  onRemove: () => void;
}): ReactNode {
  // The line total reflects the buyer's proposed price when given, otherwise
  // the catalogue snapshot — so it tracks whatever they actually want quoted.
  const effectiveUnit = line.proposedUnitPrice ?? line.unitPrice?.amount ?? null;
  const currency = line.unitPrice?.currency ?? 'PLN';
  const lineTotal = effectiveUnit !== null ? effectiveUnit * line.quantity : null;
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
      </div>

      <div className="qty__stepper" role="group" aria-label={t.qtyLabel}>
        <button type="button" aria-label="−" title="−" onClick={(): void => onQty(Math.max(1, line.quantity - 1))}>
          −
        </button>
        <input
          type="number"
          min={1}
          value={line.quantity}
          aria-label={t.qtyLabel}
          onChange={(e): void => {
            const n = Number(e.target.value);
            onQty(Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);
          }}
        />
        <button type="button" aria-label="+" title="+" onClick={(): void => onQty(line.quantity + 1)}>
          +
        </button>
      </div>

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
            placeholder={line.unitPrice ? line.unitPrice.amount.toFixed(2) : '—'}
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
  return `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

interface Strings {
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
  lineTotalLabel: string;
  removeLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  submit: string;
  submitting: string;
  note: string;
  errorGeneric: string;
}

function strings(pl: boolean): Strings {
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
