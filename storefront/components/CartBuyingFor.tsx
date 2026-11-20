import type { ReactNode } from 'react';
import type { CartBuyingForResetReason, CheckoutPayer } from '@endora-commerce/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { format } from '../lib/i18n/format';

/**
 * `specs/182-related-payers/` FR-110 — *Paid by* on the cart (RP-22; the spec's *Buying for*):
 * the buyer's own Organization or a payer on its own commercial terms the member may order with
 * now. Choosing one reprices the cart for that payer (FR-111); the server decides the terms, the
 * form names a payer only.
 *
 * Only payers on their own terms are listed: a payer on the buyer's terms changes no price and is
 * chosen at checkout, which offers exactly those (FR-060) — FR-110 makes offering it here optional.
 *
 * A plain form posting to a server action, so it works without JavaScript; offered only when
 * there is a payer to choose (SC-007: nothing changes for everyone else).
 */
export function CartBuyingFor({
  payers,
  current,
  organizationName,
  action,
  locale,
}: {
  payers: readonly CheckoutPayer[];
  current: string | null;
  organizationName: string | null;
  action: (formData: FormData) => Promise<void>;
  locale: string;
}): ReactNode {
  const onPayerTerms = payers.filter((p) => p.commercialTerms === 'payer');
  if (onPayerTerms.length === 0) return null;
  const t = tForLocale(locale);
  return (
    <form action={action} className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-line bg-surface px-[14px] py-[10px]">
      <label className="flex flex-col gap-1 text-[13px] text-fg-soft">
        {t('cart.buyingFor.label')}
        <select
          name="payerOrganizationId"
          defaultValue={current ?? ''}
          className="industria-select h-[40px] min-w-[240px] pr-[32px] text-[14px] text-fg"
        >
          <option value="">{organizationName || t('checkout.payer.ourOrganization')}</option>
          {onPayerTerms.map((p) => (
            <option key={p.payerOrganizationId} value={p.payerOrganizationId}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn--outline btn--sm">
        {t('cart.buyingFor.apply')}
      </button>
      <p className="m-0 basis-full text-[12px] text-muted">{t('cart.buyingFor.hint')}</p>
    </form>
  );
}

/**
 * FR-113 — what a switch changed (lines repriced, lines with no price now), or FR-116 — why the
 * cart returned to the buyer's own prices on this read.
 */
export function CartBuyingForNotice({
  repriced,
  unpriced,
  reset,
  locale,
}: {
  repriced: number | null;
  unpriced: number | null;
  reset: CartBuyingForResetReason | null;
  locale: string;
}): ReactNode {
  const t = tForLocale(locale);
  if (reset) {
    return (
      <div className="mb-3 rounded-md border border-[#fde68a] bg-[#fffbeb] px-[14px] py-[10px] text-[13px] text-fg" role="status">
        {t(`cart.buyingFor.reset.${reset}`)}
      </div>
    );
  }
  if (repriced === null && unpriced === null) return null;
  return (
    <div className="mb-3 rounded-md border border-[#bbf7d0] bg-[#ecfdf3] px-[14px] py-[10px] text-[13px] text-ok" role="status">
      {format(t('cart.buyingFor.repriced'), { count: String(repriced ?? 0) })}
      {unpriced ? <> {format(t('cart.buyingFor.unpriced'), { count: String(unpriced) })}</> : null}
    </div>
  );
}
