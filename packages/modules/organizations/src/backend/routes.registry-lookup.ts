import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  REGISTRY_LOOKUP_COUNTRIES,
  registryLookupCountryForPicker,
  registryLookupRequestSchema,
  type RegistrationOptionsResponse,
  type RegistryLookupResponse,
} from '@endora-commerce/contracts';
import { REGISTRY_LOOKUP_RATE_LIMIT } from './registry-lookup/limits.js';
import type { RegistryLookupService } from './registry-lookup/registry-lookup-service.js';

/**
 * Feature 173 — the two anonymous registration-lookup endpoints
 * (`specs/173-registration-registry-lookup/contracts/public-api.md` §1–§2).
 *
 * Both are registered whatever the switch says and read it per request (research
 * R-16): `registry_lookup_enabled` is a feature setting of an always-present
 * module, so a change applies to the next request with no restart.
 *
 * - `registration-options` always answers — it is what tells a storefront the
 *   lookup is off.
 * - `registry-lookup` answers, while the switch is off, **exactly** what the
 *   platform answers for a route that does not exist: the handler hands the
 *   request to the not-found handler before reading anything else, the body is
 *   parsed only afterwards (a route-level schema would answer a malformed body
 *   with 400 and so reveal the route), and the per-client limiter stands aside
 *   (`allowList`), so not even a 429 tells an off endpoint from an absent one.
 *
 * Both are `salesChannelAccess: 'open'`: a business may apply on a store closed
 * to anonymous visitors (`specs/154-sales-channel-access/`). Neither reads a
 * channel — the lookup is platform-wide (owner decision OD-2).
 */

export interface RegistryLookupRouteDeps {
  /** `organizations.registration.registry_lookup_enabled`, fail-closed (off on any error). */
  isEnabled: () => Promise<boolean>;
  lookupService: () => Pick<RegistryLookupService, 'lookup'>;
}

export const REGISTRATION_OPTIONS_PATH = '/api/v1/organizations/registration-options';
export const REGISTRY_LOOKUP_PATH = '/api/v1/organizations/registry-lookup';

/**
 * The lookup's per-client ceiling (research R-7 layer 2), on top of the host's
 * global one. Keyed by `request.ip`, which is the buyer's only where the
 * deployment trusts the storefront as a proxy (`TRUSTED_PROXY_HOPS` /
 * `TRUSTED_PROXY_ADDRESSES`) — the storefront forwards `x-forwarded-for`.
 */
export const REGISTRY_LOOKUP_ROUTE_RATE_LIMIT = {
  ...REGISTRY_LOOKUP_RATE_LIMIT,
  keyGenerator: (request: FastifyRequest): string => `org-registry-lookup:${request.ip}`,
};

export async function registerRegistryLookupRoutes(
  app: FastifyInstance,
  deps: RegistryLookupRouteDeps,
): Promise<void> {
  // Declared as values rather than inline literals: `rateLimit` is an
  // augmentation of `@fastify/rate-limit`, which the host registers and this
  // package does not depend on.
  const optionsConfig = { salesChannelAccess: 'open' as const };
  const lookupConfig = {
    salesChannelAccess: 'open' as const,
    rateLimit: {
      ...REGISTRY_LOOKUP_ROUTE_RATE_LIMIT,
      // Off means absent: no count, no 429 (see above).
      allowList: async (): Promise<boolean> => !(await deps.isEnabled()),
    },
  };

  app.get(REGISTRATION_OPTIONS_PATH, { config: optionsConfig }, async (): Promise<RegistrationOptionsResponse> => {
    const enabled = await deps.isEnabled();
    return {
      data: {
        registryLookup: {
          enabled,
          countries: enabled ? REGISTRY_LOOKUP_COUNTRIES.map(registryLookupCountryForPicker) : [],
        },
      },
    };
  });

  app.post(REGISTRY_LOOKUP_PATH, { config: lookupConfig }, async (request, reply) => {
    if (!(await deps.isEnabled())) {
      reply.callNotFound();
      return reply;
    }
    const body = registryLookupRequestSchema.parse(request.body);
    const data = await deps.lookupService().lookup(body);
    reply.header('cache-control', 'no-store');
    const response: RegistryLookupResponse = { data };
    return response;
  });
}
