import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { orgConstraintFor } from '@endora-commerce/platform/tenancy';
import { Organization } from './entities/organization.entity.js';
import type { SalesRepAssignmentPort } from './services/sales-rep-assignment-service.js';

/**
 * The acting admin, or `null` for any other actor.
 *
 * `request.actor` is not on `FastifyRequest`: it is a declaration-merging
 * augmentation the `auth` module contributes (`modules/auth/plugin.ts`). Inside
 * `backend/src` it arrived ambiently through the host's own `types` graph, so
 * nothing in this module ever named it; a package compiles against its own
 * manifest and `auth` publishes nothing a package can name, so the property is
 * simply not there (TS2339). Read structurally and narrowed rather than
 * asserted — an absent actor answers `null`.
 */
export function adminActorOf(request: FastifyRequest): { adminUserId: string } | null {
  const { actor } = request as FastifyRequest & {
    actor?: { kind?: string; adminUserId?: string };
  };
  if (actor?.kind !== 'admin' || typeof actor.adminUserId !== 'string') return null;
  return { adminUserId: actor.adminUserId };
}

export interface OrganizationInReachDeps {
  emFactory: () => EntityManager;
  /**
   * The sales-representative visibility rule: this module's one
   * `organizationSalesRepScopePort`, built with the roll-up deps (#108). A
   * second instance built without them would answer roll-up wrongly.
   */
  salesRepScope: Pick<SalesRepAssignmentPort, 'canSeeOrganization'>;
  /** The path parameter that names the Organization. */
  param: string;
}

/**
 * Issue #698 (PR #847), shared since #856 — a preHandler that lets a route
 * answer only for an Organization the acting administrator may see.
 * `Organization` is `@GlobalEntity`, so no tenant filter narrows its reads.
 *
 * The rule is the existing sales-representative visibility rule,
 * `SalesRepAssignmentPort.canSeeOrganization`, not the tenant reach
 * (`isOrgInScope`): an Organization assigned to the representative (or, under
 * `organizations:rollup`, whose nearest assigned ancestor is theirs), **or one
 * nobody is assigned to** — the fallback a pending registration is moderated
 * under (D-87) and that `customers` FR-037 and owner ruling D-3W apply
 * elsewhere. Which of the two rules is the platform's is issue #305; this does
 * not decide it (architect ruling on #847).
 *
 * Every caller first gets a `404 NOT_FOUND` for a malformed, unknown or deleted
 * id; an Organization the representative may not see then answers the same, so
 * the answer is no existence probe. A platform-wide scope sees every
 * Organization. Placed after the permission gate, so a route states its reach
 * where it states its permission.
 */
export function organizationInReach(
  deps: OrganizationInReachDeps,
): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const notFound = (): HttpError => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    const id = (request.params as Record<string, unknown> | undefined)?.[deps.param];
    if (typeof id !== 'string' || !isUuidShape(id)) throw notFound();
    if ((await deps.emFactory().count(Organization, { id, deletedAt: null })) === 0) throw notFound();
    if (orgConstraintFor().kind === 'all') return;
    const actor = adminActorOf(request);
    if (actor === null || !(await deps.salesRepScope.canSeeOrganization(actor.adminUserId, id))) {
      throw notFound();
    }
  };
}
