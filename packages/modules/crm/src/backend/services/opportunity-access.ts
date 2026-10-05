import type { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * The one answer for an Opportunity the caller cannot have: missing, malformed
 * id, or belonging to an Organization outside their scope. The three are
 * indistinguishable on purpose (Constitution XI) — same status, same code, same
 * sentence.
 */
export function opportunityNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.CRM_OPPORTUNITY_NOT_FOUND, 'Opportunity not found.');
}

/**
 * Load an Opportunity through a tenant-scoped EntityManager, or answer 404.
 *
 * **Every route about an Opportunity or anything hanging on it starts here.**
 * The children (`links`, `propagations`, …) are transitively scoped: they carry
 * no tenant column, so nothing filters a read of one by its own id. The rule is
 * to load the parent through the scoped EntityManager first and the child by
 * `(opportunityId, id)` after — which this function is the first half of.
 */
export async function loadOpportunity(
  em: EntityManager,
  id: string,
  options: { lockMode?: LockMode } = {},
): Promise<CrmOpportunity> {
  if (!isUuid(id)) throw opportunityNotFound();
  const opportunity = await em.findOne(
    CrmOpportunity,
    { id },
    options.lockMode !== undefined ? { lockMode: options.lockMode } : {},
  );
  if (!opportunity) throw opportunityNotFound();
  return opportunity;
}

/** The effective value: the manual figure or the computed one, by mode. */
export function effectiveOpportunityValue(opportunity: {
  valueMode: 'manual' | 'computed';
  manualValue?: string | null;
  computedValue: string;
}): string | null {
  return opportunity.valueMode === 'manual' ? (opportunity.manualValue ?? null) : opportunity.computedValue;
}
