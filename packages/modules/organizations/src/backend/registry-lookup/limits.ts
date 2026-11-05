import type { RegistryProvider } from './company-registry-port.js';

/**
 * Feature 173 — every number that bounds the registration lookup (research R-7,
 * R-8, as T001 measured them). Constants rather than settings: nobody has
 * asked to tune them, and a deployment that must can overlay this file
 * (Principle XV).
 */

/** The module-owned Redis key prefix; `v1` moves if the stored shapes ever do. */
export const REGISTRY_LOOKUP_REDIS_PREFIX = 'b2b:org-registry-lookup:v1:';

/** How long a merged answer is served from cache, per status (FR-009). */
export const ANSWER_TTL_SECONDS = {
  found: 6 * 60 * 60,
  not_found: 30 * 60,
  unavailable: 60,
} as const;

/** How long a lookup ticket waits for its registration (FR-006). */
export const TICKET_TTL_SECONDS = 2 * 60 * 60;

export type BudgetWindowKind = 'utc_hour' | 'warsaw_day';

export interface RegistryBudget {
  limit: number;
  window: BudgetWindowKind;
}

/**
 * The platform-wide budget per registry and window (R-7 layer 4).
 *
 * The White List's is **per Europe/Warsaw calendar day**, because its own
 * limit is daily — "100 zapytań dziennie" for `search`, per source IP, with a
 * block until midnight once spent (gov.pl, quoted in R-6) — and the
 * administrator's "Validate now" draws on the same quota from the same egress
 * address. Sixty leaves forty for that flow. GUS and VIES publish no hard
 * per-client daily figure; an hourly ceiling bounds what a rotating attacker
 * can spend.
 */
export const REGISTRY_BUDGETS: Readonly<Record<RegistryProvider, RegistryBudget>> = {
  gus_pl: { limit: 300, window: 'utc_hour' },
  vies: { limit: 300, window: 'utc_hour' },
  mf_pl: { limit: 60, window: 'warsaw_day' },
};

/** Timeouts (R-7 layer 5). The whole lookup answers within {@link LOOKUP_DEADLINE_MS} (FR-007). */
export const GUS_REQUEST_TIMEOUT_MS = 4000;
export const GUS_TOTAL_TIMEOUT_MS = 6000;
export const LOOKUP_DEADLINE_MS = 8000;

/**
 * The per-client route limit (R-7 layer 2), in `@fastify/rate-limit`'s terms —
 * the `cms` contact-form precedent (`CMS_CONTACT_FORM_RATE_LIMIT`). Per process;
 * the budgets above are the shared bound.
 */
export const REGISTRY_LOOKUP_RATE_LIMIT = {
  max: 10,
  timeWindow: '10 minutes',
} as const;
