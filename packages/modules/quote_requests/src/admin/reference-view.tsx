import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useRfqNumberFormat } from './number-format.js';
import { referenceDifference, type ReferenceAmount } from './reference-difference.js';

/**
 * Feature 146 — the reference-price plumbing of the admin quote request detail
 * (FR-002 – FR-007): which reference a line shows, the probe that asks for the
 * customer's current price, and the two cells Overview and Modify render.
 * `reference-difference.ts` holds the arithmetic; this file holds the view.
 */

/** The fields of an admin quote request line this view reads. */
export interface ReferenceLine {
  id: string;
  desiredUnitPrice: number | null;
  /**
   * The reference unit price stored when the line was created ("price at
   * request"); `null` = none stored, so the screen asks for the customer's
   * current price instead (FR-006).
   */
  referencePrice?: { amount: number; currency: string; capturedAt: string } | null;
  /** The customer's proposal, surviving admin revisions (FR-002). */
  customerProposedUnitPrice?: number | null;
}

/** Whose price the probe asks for, and on which channel (`null` = system default). */
export interface ProbeBuyer {
  customerAccountId: string;
  salesChannelId?: string | null;
}

/**
 * A line's reference price as the screen shows it (feature 146, FR-002,
 * FR-006): the one stored at request; else the customer's current price, asked
 * for on read; else none. `pending` while the current price is being asked for.
 */
export type ReferenceView =
  | { kind: 'atRequest'; price: ReferenceAmount }
  | { kind: 'current'; price: ReferenceAmount }
  | { kind: 'none' }
  | { kind: 'pending' };

/** Current prices by line id: `null` = the probe answered no price, or failed. */
export type CurrentPrices = Record<string, ReferenceAmount | null>;

export function referenceViewOf(item: ReferenceLine, currentPrices: CurrentPrices): ReferenceView {
  if (item.referencePrice) {
    return {
      kind: 'atRequest',
      price: { amount: item.referencePrice.amount, currency: item.referencePrice.currency },
    };
  }
  if (!(item.id in currentPrices)) return { kind: 'pending' };
  const price = currentPrices[item.id] ?? null;
  return price ? { kind: 'current', price } : { kind: 'none' };
}

export function referencePriceOf(view: ReferenceView): ReferenceAmount | null {
  return view.kind === 'atRequest' || view.kind === 'current' ? view.price : null;
}

/** The customer's proposal for a line; older replies carry only `desiredUnitPrice`. */
export function proposalOf(item: ReferenceLine): number | null {
  return item.customerProposedUnitPrice !== undefined
    ? item.customerProposedUnitPrice
    : item.desiredUnitPrice;
}

/**
 * The price the request's customer would pay for a line today, on the channel
 * the request was raised on (FR-006, FR-007) — through the admin probe, which
 * answers only about organizations the caller may see. **Any** failure — a 403
 * for a caller without `price_lists:read` (FR-031, advisory), a 404 or 400 for
 * an out-of-scope or mismatched buyer, a 5xx, a dropped connection — answers
 * `null`, so the screen shows "no price" and never breaks (L2).
 */
export async function probeCustomerPrice(
  rfq: ProbeBuyer,
  line: { productId: string; variantId?: string | null; quantity: number },
  signal?: AbortSignal,
): Promise<ReferenceAmount | null> {
  try {
    // Feature 160 — the price explanation (`POST /api/v1/admin/price-books/resolve`),
    // which replaced `GET /api/v1/admin/products/:id/resolved-price` with the same scope.
    const res = await apiClient.post<{
      data: Array<{ key: string; price: { amount: string; currency: string } | null }>;
    }>(
      '/api/v1/admin/price-books/resolve',
      {
        ...(rfq.salesChannelId ? { salesChannelId: rfq.salesChannelId } : {}),
        buyer: { customerAccountId: rfq.customerAccountId },
        lines: [
          {
            key: 'line',
            productId: line.productId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            quantity: line.quantity > 0 ? line.quantity : 1,
          },
        ],
      },
      signal ? { signal } : undefined,
    );
    const resolved = res.data[0]?.price ?? null;
    if (!resolved) return null;
    const amount = Number(resolved.amount);
    return Number.isFinite(amount) ? { amount, currency: resolved.currency } : null;
  } catch {
    return null;
  }
}

/** The reference cell: the amount, then what kind of price it is. */
export function ReferenceCell({
  view,
  perBaseUnit,
}: {
  view: ReferenceView;
  /**
   * The line is sold in a packaging unit: its reference is the price of one
   * base unit, never of the package (T6), so the cell says so. Overview and
   * Modify pass the same answer for the same line (review fix N4).
   */
  perBaseUnit: boolean;
}): ReactNode {
  const t = useTranslation('core');
  const format = useRfqNumberFormat();
  if (view.kind === 'pending') return <span className="text-muted-foreground">—</span>;
  if (view.kind === 'none') {
    return <span className="text-xs text-muted-foreground">{t('rfq.detail.reference.none')}</span>;
  }
  return (
    <div className="space-y-0.5">
      <div className="tabular-nums">
        {format.money(view.price.amount, view.price.currency)}
      </div>
      <div className="flex flex-wrap gap-x-1 text-xs text-muted-foreground">
        <span>
          {view.kind === 'atRequest'
            ? t('rfq.detail.reference.atRequest')
            : t('rfq.detail.reference.current')}
        </span>
        {perBaseUnit ? <span>· {t('rfq.detail.reference.perBaseUnit')}</span> : null}
      </div>
    </div>
  );
}

/**
 * The difference cell: amount over percentage, signed, or "—" when it cannot
 * be computed (FR-005). The sign is spelled out, never carried by colour alone.
 */
export function DifferenceCell({
  price,
  currency,
  reference,
}: {
  price: number | null;
  currency: string;
  reference: ReferenceAmount | null;
}): ReactNode {
  const format = useRfqNumberFormat();
  const difference = referenceDifference(price, currency, reference);
  if (difference === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5 tabular-nums">
      <div>
        {format.signedAmount(difference.amount)} {currency}
      </div>
      <div className="text-xs text-muted-foreground">
        {difference.percent !== null ? format.signedPercent(difference.percent) : '—'}
      </div>
    </div>
  );
}

/** How many current-price probes one screen keeps in flight at once (review fix S4). */
export const PROBE_CONCURRENCY = 4;

interface Limiter {
  /**
   * Run `task` when a slot is free; `null` when `signal` aborted before it
   * started, or when the task failed. A slot is held until the task settles.
   */
  run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<{ value: T } | null>;
}

function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = (): void => {
    while (active < max && queue.length > 0) queue.shift()!();
  };
  return {
    run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<{ value: T } | null> {
      return new Promise((resolve) => {
        queue.push((): void => {
          // A task whose screen moved on before its turn is dropped unasked.
          if (signal.aborted) {
            resolve(null);
            return;
          }
          active += 1;
          task()
            .then(
              (value) => resolve({ value }),
              () => resolve(null),
            )
            .finally(() => {
              active -= 1;
              next();
            });
        });
        next();
      });
    },
  };
}

/** A line the probe asks about: one with no stored reference. */
interface ProbeLine {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
}

interface ProbeRequest {
  buyer: { customerAccountId: string; salesChannelId: string | null };
  lines: ProbeLine[];
}

/** The request lines `useCurrentPrices` reads. */
export type ProbedLine = ReferenceLine & {
  productId: string;
  variantId?: string | null;
  quantity: number;
};

/**
 * Everything the probe depends on, as one string: equal content gives an equal
 * key, so a refresh that changed none of it re-runs nothing.
 */
function probeKeyOf(rfq: (ProbeBuyer & { items: readonly ProbedLine[] }) | null): string | null {
  if (rfq === null) return null;
  const request: ProbeRequest = {
    buyer: { customerAccountId: rfq.customerAccountId, salesChannelId: rfq.salesChannelId ?? null },
    lines: rfq.items
      .filter((item) => !item.referencePrice)
      .map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
      })),
  };
  return JSON.stringify(request);
}

/** What one line's answer was asked for; a different signature is a different question. */
function signatureOf(buyer: ProbeRequest['buyer'], line: ProbeLine): string {
  return JSON.stringify([buyer.customerAccountId, buyer.salesChannelId, line.productId, line.variantId, line.quantity]);
}

/**
 * The customer's current price for every line of `rfq` with no stored
 * reference (FR-006), read by Overview and Modify alike.
 *
 * Bounded and incremental (review fix S4): at most {@link PROBE_CONCURRENCY}
 * probes in flight; keyed on the probed lines' content rather than on the
 * request object, so a refresh that changed none of them asks nothing again;
 * a line whose product, variant or quantity changed — or every line, when the
 * buyer or channel did — is asked again, and the previous answers stay shown
 * meanwhile instead of flashing back to "—". Leaving the screen aborts what is
 * in flight; StrictMode's mount–unmount–mount is the same abort, followed by a
 * second run that asks again, because a line is recorded as answered only when
 * its answer arrives.
 */
export function useCurrentPrices(
  rfq: (ProbeBuyer & { items: readonly ProbedLine[] }) | null,
): CurrentPrices {
  const key = useMemo(() => probeKeyOf(rfq), [rfq]);
  const [prices, setPrices] = useState<CurrentPrices>({});
  const answered = useRef(new Map<string, string>());
  const limiter = useRef<Limiter | null>(null);
  limiter.current ??= createLimiter(PROBE_CONCURRENCY);

  useEffect(() => {
    if (key === null) return undefined;
    const { buyer, lines } = JSON.parse(key) as ProbeRequest;
    const controller = new AbortController();
    const present = new Set(lines.map((line) => line.id));
    for (const id of [...answered.current.keys()]) {
      if (!present.has(id)) answered.current.delete(id);
    }
    setPrices((previous) => {
      const stale = Object.keys(previous).filter((id) => !present.has(id));
      if (stale.length === 0) return previous;
      const next = { ...previous };
      for (const id of stale) delete next[id];
      return next;
    });
    for (const line of lines) {
      const signature = signatureOf(buyer, line);
      if (answered.current.get(line.id) === signature) continue;
      void limiter
        .current!.run(() => probeCustomerPrice(buyer, line, controller.signal), controller.signal)
        .then((answer) => {
          if (controller.signal.aborted || answer === null) return;
          answered.current.set(line.id, signature);
          setPrices((previous) => ({ ...previous, [line.id]: answer.value }));
        });
    }
    return (): void => {
      controller.abort();
    };
  }, [key]);

  return prices;
}
