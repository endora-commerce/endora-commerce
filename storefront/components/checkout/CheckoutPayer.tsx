'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CheckoutPayer } from '@endora-commerce/contracts';
import type { PaymentMethodSummary } from '../../lib/api/methods';
import { tForLocale } from '../../lib/i18n/messages';
import { formatMoney } from '../../lib/i18n/money';
import { format } from '../../lib/i18n/format';
import { PaymentMethods } from './PaymentMethods';

/**
 * `specs/182-related-payers/` (FR-060, FR-061, FR-066) — the checkout's *Paid by* choice.
 *
 * The page loads the buyer's usable payers on the buyer's terms (`GET /api/v1/checkout/payers`)
 * and, per payer, the payment methods that payer allows. This scope holds which one is
 * chosen, so the address section and the payment methods follow it without a round trip.
 * Without payers it renders nothing of its own and checkout is unchanged (SC-007).
 */
interface CheckoutPayerState {
  readonly payers: readonly CheckoutPayer[];
  readonly selected: CheckoutPayer | null;
  readonly select: (payerOrganizationId: string | null) => void;
  /** The payer is fixed by the cart (FR-060, FR-110). */
  readonly fixed: boolean;
}

const CheckoutPayerContext = createContext<CheckoutPayerState | null>(null);

export function CheckoutPayerScope({
  payers,
  initialPayerId = null,
  fixed = false,
  children,
}: {
  payers: readonly CheckoutPayer[];
  initialPayerId?: string | null;
  /**
   * `specs/182-related-payers/` FR-060, FR-110 — the cart is bought for `initialPayerId` on its
   * commercial terms, so the payer is shown and submitted, never chosen here.
   */
  fixed?: boolean;
  children: ReactNode;
}): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(initialPayerId);
  const selected = payers.find((p) => p.payerOrganizationId === selectedId) ?? null;
  return (
    <CheckoutPayerContext.Provider value={{ payers, selected, select: fixed ? () => undefined : setSelectedId, fixed }}>
      {children}
    </CheckoutPayerContext.Provider>
  );
}

/** The chosen payer, or `null` — also outside a scope, where there is never one. */
export function useCheckoutPayer(): CheckoutPayer | null {
  return useContext(CheckoutPayerContext)?.selected ?? null;
}

const SELECT_CLASS = 'industria-select h-[40px] w-full pr-[32px] text-[14px] text-fg';
const FIELD_CLASS =
  'h-[40px] w-full rounded-sm border border-line bg-surface px-[12px] text-[14px] text-fg outline-none';

/** *Paid by*: the buyer itself, or one of its payers. Absent without payers. */
export function PayerSelector({
  locale,
  organizationName,
}: {
  locale: string;
  organizationName?: string | null;
}): ReactNode {
  const state = useContext(CheckoutPayerContext);
  const t = tForLocale(locale);
  if (!state || state.payers.length === 0) return null;
  if (state.fixed && state.selected) {
    return (
      <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600 }}>{t('checkout.payer.title')}</legend>
        <p style={{ margin: 0 }}>{format(t('checkout.payer.fixed'), { name: state.selected.name })}</p>
        <input type="hidden" name="payerOrganizationId" value={state.selected.payerOrganizationId} />
      </fieldset>
    );
  }
  return (
    <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
      <legend style={{ fontWeight: 600 }}>{t('checkout.payer.title')}</legend>
      <p className="b2b-auth__hint" style={{ margin: 0 }}>
        {t('checkout.payer.hint')}
      </p>
      <select
        name="payerOrganizationId"
        aria-label={t('checkout.payer.title')}
        value={state.selected?.payerOrganizationId ?? ''}
        onChange={(e) => state.select(e.target.value || null)}
        className={SELECT_CLASS}
      >
        <option value="">{organizationName || t('checkout.payer.ourOrganization')}</option>
        {state.payers.map((p) => (
          <option key={p.payerOrganizationId} value={p.payerOrganizationId}>
            {p.name}
          </option>
        ))}
      </select>
    </fieldset>
  );
}

/**
 * With a payer chosen (FR-061, FR-063): the payer's company name and tax ID, read-only
 * and not submitted (the placement takes them from the payer; an override with a payer
 * is refused), and a billing address chosen among the payer's allowed ones only.
 */
export function PayerBillingSection({ payer, locale }: { payer: CheckoutPayer; locale: string }): ReactNode {
  const t = tForLocale(locale);
  return (
    <fieldset className="b2b-auth__form" style={{ border: 0, padding: 0 }}>
      <legend style={{ fontWeight: 600 }}>{t('checkout.payer.billingTitle')}</legend>
      <p className="b2b-auth__hint" style={{ margin: 0 }}>
        {t('checkout.payer.billingHint')}
      </p>
      <input
        aria-label={t('checkout.address.companyName')}
        value={payer.name}
        readOnly
        className={FIELD_CLASS}
      />
      <input aria-label={t('checkout.address.taxId')} value={payer.taxId} readOnly className={FIELD_CLASS} />
      <select
        name="payerBillingAddressId"
        aria-label={t('checkout.payer.billingAddress')}
        defaultValue={payer.billingAddresses[0]?.id}
        className={SELECT_CLASS}
      >
        {payer.billingAddresses.map((a) => (
          <option key={a.id} value={a.id}>
            {`${a.recipientName} — ${a.street}, ${a.postalCode} ${a.city}, ${a.country}`}
          </option>
        ))}
      </select>
    </fieldset>
  );
}

/** The payment methods of whoever pays: the buyer's catalogue, or the chosen payer's (FR-066). */
export function PayerAwarePaymentMethods({
  methods,
  methodsByPayer,
  currency,
  preferredId,
  locale,
}: {
  methods: PaymentMethodSummary[];
  methodsByPayer: Readonly<Record<string, PaymentMethodSummary[]>>;
  currency?: string | undefined;
  preferredId?: string | null;
  locale?: string | undefined;
}): ReactNode {
  const payer = useCheckoutPayer();
  const list = payer ? (methodsByPayer[payer.payerOrganizationId] ?? []) : methods;
  return (
    <PaymentMethods
      key={payer?.payerOrganizationId ?? 'own'}
      methods={list}
      currency={currency}
      preferredId={payer ? null : (preferredId ?? null)}
      locale={locale}
    />
  );
}

/** What the totals preview is asked with: the payer and the form's current choices. */
export interface PayerTotalsInput {
  readonly payerOrganizationId: string;
  readonly billingAddressId: string;
  readonly deliveryMethodId: string;
  readonly paymentMethodId: string;
}

/** The order preview's totals (`POST /api/v1/orders/preview-total`). */
export interface PayerTotalsResult {
  readonly subtotal: number;
  readonly taxTotal: number;
  readonly deliveryTotal: number;
  readonly paymentSurcharge: number;
  readonly discountTotal: number;
  readonly total: number;
  readonly currency: string;
}

/** A server action over the existing order preview; `null` when the preview refused. */
export type PayerTotalsAction = (input: PayerTotalsInput) => Promise<PayerTotalsResult | null>;

/**
 * RP-16 (b), FR-064 — with a payer chosen, the totals the order will carry: the order
 * preview asked **with the payer** (its VAT status and billing country), again whenever the
 * payer, its billing address or a method changes. Without a payer nothing is asked and the
 * page's own summary stands (SC-007). A refused preview shows no figures rather than stale ones.
 */
export function PayerTotals({ action, locale }: { action: PayerTotalsAction; locale: string }): ReactNode {
  const payer = useCheckoutPayer();
  const anchor = useRef<HTMLDivElement>(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ readonly totals: PayerTotalsResult | null } | null>(null);
  const t = tForLocale(locale);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return undefined;
    const onChange = (): void => setRevision((n) => n + 1);
    form.addEventListener('change', onChange);
    return () => form.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (!payer) {
      setResult(null);
      return undefined;
    }
    const form = anchor.current?.closest('form');
    const data = form ? new FormData(form) : null;
    const read = (name: string): string => {
      const value = data?.get(name);
      return typeof value === 'string' ? value : '';
    };
    let cancelled = false;
    setResult(null);
    action({
      payerOrganizationId: payer.payerOrganizationId,
      billingAddressId: read('payerBillingAddressId') || (payer.billingAddresses[0]?.id ?? ''),
      deliveryMethodId: read('deliveryMethodId'),
      paymentMethodId: read('paymentMethodId'),
    })
      .then((totals) => {
        if (!cancelled) setResult({ totals });
      })
      .catch(() => {
        if (!cancelled) setResult({ totals: null });
      });
    return () => {
      cancelled = true;
    };
  }, [payer, revision, action]);

  return (
    <div ref={anchor}>
      {payer && result ? (
        <section data-testid="payer-totals" role="status" aria-live="polite">
          <h3>{t('checkout.payer.totalsTitle')}</h3>
          {result.totals ? (
            <table className="b2b-account__table">
              <tbody>
                <tr>
                  <th scope="row">{t('checkout.payer.net')}</th>
                  <td className="text-right">
                    {formatMoney(result.totals.subtotal - result.totals.discountTotal, result.totals.currency, locale)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('checkout.payer.delivery')}</th>
                  <td className="text-right">
                    {formatMoney(result.totals.deliveryTotal + result.totals.paymentSurcharge, result.totals.currency, locale)}
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('checkout.payer.vat')}</th>
                  <td className="text-right">{formatMoney(result.totals.taxTotal, result.totals.currency, locale)}</td>
                </tr>
                <tr>
                  <th scope="row">
                    <strong>{t('checkout.payer.gross')}</strong>
                  </th>
                  <td className="text-right">
                    <strong>{formatMoney(result.totals.total, result.totals.currency, locale)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="b2b-auth__hint">{t('checkout.payer.totalsUnavailable')}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
