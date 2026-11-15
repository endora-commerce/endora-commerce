import { type ReactNode } from 'react';
import {
  setQuoteRequestAccountNegotiationSchema,
  type AdminZoneProps,
  type QuoteRequestAccountNegotiation,
  type QuoteRequestNegotiationOverride,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  NegotiationCard,
  useNegotiationParticipant,
  useNegotiationResource,
  type NegotiationWrite,
} from '../negotiation-panel.js';

/**
 * A customer account's price-negotiation override (feature 146, US4;
 * FR-020 (b)).
 *
 * Three states — as organization (no override, the default), allowed, not
 * allowed — and the resulting effective value with where it comes from: this
 * account's override, its organization's value, or the platform default
 * ("allowed") when neither is set. The place is `customer.detail.after`, after
 * `quick_order`'s ordering defaults (weight 200).
 *
 * **Read on `customers:read`, written on `customers:manage`** (FR-027, D-3J):
 * a read-only holder sees the three options disabled, with a hint.
 *
 * The effective value is the server's answer, never recomputed here: the
 * organization behind it is the account's *current* one (D-3L), which this
 * screen does not know. So while a change is staged, the effective value — which
 * describes the stored option, not the selected one — is not shown; the Save's
 * answer brings it back.
 *
 * **Written by the customer detail's one Save** (feature 180, #407; FR-060): a
 * radio stages the override as the part `price-negotiation` of the host's
 * session, as the organization panel does, and the host's Save writes it. It
 * used to write on change.
 */
export type CustomerPriceNegotiationProps = AdminZoneProps<'customer.detail.after'>;

const OVERRIDES: readonly QuoteRequestNegotiationOverride[] = ['inherit', 'allowed', 'not_allowed'];

const routeFor = (customerId: string): string =>
  `/api/v1/admin/customers/${encodeURIComponent(customerId)}/quote-price-negotiation`;

const WRITE: NegotiationWrite<QuoteRequestAccountNegotiation> = {
  bodyOf: (value) => ({ override: value.override }),
  validBody: (body) => setQuoteRequestAccountNegotiationSchema.safeParse(body).success,
};

/**
 * Whether the value's effective fields are the server's answer for its own
 * override. A staged override keeps the stored answer's effective fields, which
 * then describe another option: an explicit override is always the account's,
 * and "as organization" never is.
 */
function answersItsOverride(value: QuoteRequestAccountNegotiation): boolean {
  if (value.override === 'inherit') return value.effectiveSource !== 'account';
  return (
    value.effectiveSource === 'account' &&
    value.effectivePriceProposalsAllowed === (value.override === 'allowed')
  );
}

export function CustomerPriceNegotiation({
  customerId,
  saveSession,
}: CustomerPriceNegotiationProps): ReactNode {
  const t = useTranslation('quote_requests');
  const { hasPermission } = useAuth();
  const canManage = hasPermission('customers:manage');
  const route = routeFor(customerId);
  const resource = useNegotiationResource<QuoteRequestAccountNegotiation>(route);
  const part = useNegotiationParticipant(route, resource, saveSession, canManage, WRITE);
  const state = part.value;
  const { loadError } = resource;
  const { loading, saving } = part.card;
  const showEffective = state !== null && !loadError && answersItsOverride(state);

  const handleChange = (next: QuoteRequestNegotiationOverride): void => {
    if (!canManage || state === null || next === state.override) return;
    part.setValue({ ...state, override: next });
  };

  const groupName = `quote-price-negotiation-customer-${customerId}`;
  const descriptionId = `${groupName}-description`;
  const hintId = `${groupName}-hint`;
  const effectiveId = `${groupName}-effective`;

  return (
    <NegotiationCard
      resource={part.card}
      canManage={canManage}
      hintId={hintId}
      after={
        showEffective ? (
          <p id={effectiveId} className="text-sm">
            {t('negotiation.effective', {
              value: state.effectivePriceProposalsAllowed
                ? t('negotiation.value.allowed')
                : t('negotiation.value.notAllowed'),
              source: t(`negotiation.source.${state.effectiveSource}`),
            })}
          </p>
        ) : null
      }
    >
      <fieldset
        className="space-y-2"
        disabled={!canManage || loading || saving}
        aria-describedby={[
          descriptionId,
          showEffective ? effectiveId : null,
          canManage ? null : hintId,
        ]
          .filter((id): id is string => id !== null)
          .join(' ')}
      >
        <legend className="text-sm font-medium">{t('negotiation.customer.label')}</legend>
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {t('negotiation.customer.description')}
        </p>
        <div className="flex flex-wrap gap-4">
          {OVERRIDES.map((value) => {
            const id = `${groupName}-${value}`;
            return (
              <div key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  id={id}
                  name={groupName}
                  value={value}
                  checked={state?.override === value}
                  disabled={!canManage || loading || saving}
                  className="h-4 w-4 accent-primary"
                  onChange={(): void => handleChange(value)}
                />
                <label htmlFor={id} className="text-sm">
                  {t(`negotiation.override.${value}`)}
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>
    </NegotiationCard>
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default CustomerPriceNegotiation;
