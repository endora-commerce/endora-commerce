import { type ReactNode } from 'react';
import {
  setQuoteRequestOrgNegotiationSchema,
  type AdminZoneProps,
  type QuoteRequestOrgNegotiation,
} from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { Checkbox } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  NegotiationCard,
  useNegotiationParticipant,
  useNegotiationResource,
  type NegotiationWrite,
} from '../negotiation-panel.js';

/**
 * The organization's price-negotiation value (feature 146, US4; FR-020 (a)).
 *
 * "Members may propose prices": allowed (the default when no row exists) or not
 * allowed, for every customer account of the organization that has no override
 * of its own. The place is `organization.detail.after`, after `carts`' approval
 * policy (weight 500).
 *
 * **Read on `customers:read`, written on `customers:manage`** (FR-027, D-3J).
 * The contribution is gated on the read code, so a read-only holder sees the
 * value with the control disabled and a hint, rather than a toggle whose only
 * action answers 403.
 *
 * It reads its own state (Z3: the zone's props carry the id and nothing else),
 * out of this module's own bundle (`negotiation.*`), as `carts`' panel does.
 *
 * **Written by the organization detail's one Save** (feature 180, WP-7; FR-060): the
 * checkbox stages the value as the part `price-negotiation` of the host's session, and
 * the host's Save writes it. It used to write on change.
 */
export type OrganizationPriceNegotiationProps = AdminZoneProps<'organization.detail.after'>;

const routeFor = (organizationId: string): string =>
  `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/quote-price-negotiation`;

const WRITE: NegotiationWrite<QuoteRequestOrgNegotiation> = {
  bodyOf: (value) => ({ priceProposalsAllowed: value.priceProposalsAllowed }),
  validBody: (body) => setQuoteRequestOrgNegotiationSchema.safeParse(body).success,
};

export function OrganizationPriceNegotiation({
  organizationId,
  saveSession,
}: OrganizationPriceNegotiationProps): ReactNode {
  const t = useTranslation('quote_requests');
  const { hasPermission } = useAuth();
  const canManage = hasPermission('customers:manage');
  const route = routeFor(organizationId);
  const resource = useNegotiationResource<QuoteRequestOrgNegotiation>(route);
  const part = useNegotiationParticipant(route, resource, saveSession, canManage, WRITE);
  const state = part.value;
  const { loading, saving } = part.card;

  const handleChange = (next: boolean): void => {
    if (!canManage || state === null) return;
    part.setValue({ ...state, priceProposalsAllowed: next });
  };

  const controlId = `quote-price-negotiation-org-${organizationId}`;
  const descriptionId = `${controlId}-description`;
  const hintId = `${controlId}-hint`;

  return (
    <NegotiationCard
      resource={part.card}
      canManage={canManage}
      hintId={hintId}
      before={
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {t('negotiation.organization.description')}
        </p>
      }
    >
      <div className="flex items-center gap-3">
        <Checkbox
          id={controlId}
          checked={state?.priceProposalsAllowed ?? false}
          disabled={!canManage || loading || saving}
          aria-describedby={canManage ? descriptionId : `${descriptionId} ${hintId}`}
          onChange={(e): void => handleChange(e.target.checked)}
        />
        <label htmlFor={controlId} className="text-sm font-medium">
          {t('negotiation.organization.label')}
        </label>
      </div>
    </NegotiationCard>
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default OrganizationPriceNegotiation;
