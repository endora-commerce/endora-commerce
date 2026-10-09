/**
 * Withdraw `organizations`' demo data (feature 113, T222 — contract §2.5).
 *
 * By the fixed tax id `seed` assigns, never by a predicate over the table. This
 * is the withdrawal that replaces `organizations`' line in the host's
 * `truncate … cascade`, and the replacement is a repair rather than a
 * relocation: an organisation is the tenant every buyer, address, cart, quote
 * request and order hangs off (Principle XI), so that one word took a
 * developer's entire test tenancy with it through the cascade, silently, on
 * every `seed:dev`.
 *
 * The buyer who belongs to this organisation and the credit limit granted to it
 * are withdrawn first, by the composition: `reset` runs the composition's
 * withdrawal before any module's (§5.5), which is also what leaves no row
 * referencing the organisation deleted below.
 *
 * ## What this module itself holds against the organisation (issue #143)
 *
 * Two tables of this module's own name an organisation and are written by
 * using the demo rather than by seeding it: an invitation the buyer sent a
 * colleague, and a sales representative an administrator assigned. The first
 * has a foreign key that refuses the organisation's deletion; the second has
 * none and would be left naming an organisation that is gone. Both are this
 * module's rows, so they are withdrawn here, by the same organisation and
 * before it. The link tables that cascade from it are this module's schema
 * acting on this module's rows.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { OrganizationInvitation } from '../entities/organization-invitation.entity.js';
import { OrganizationSalesRepAssignment } from '../entities/organization-sales-rep-assignment.entity.js';
import { Organization } from '../entities/organization.entity.js';
import { DEMO_ORGANIZATION } from './rows.js';

interface OrganizationsDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to (contract §2.7).
  const em = context.ctx.cradle<OrganizationsDemoCradle>().emFactory();
  const organizations = await em.find(
    Organization,
    { taxId: DEMO_ORGANIZATION.taxId },
    { fields: ['id'] },
  );
  const organizationIds = organizations.map((organization) => organization.id);
  let invitations = 0;
  let assignments = 0;
  if (organizationIds.length > 0) {
    const ofTheDemoOrganization = { organizationId: { $in: organizationIds } };
    invitations = await em.nativeDelete(OrganizationInvitation, ofTheDemoOrganization);
    assignments = await em.nativeDelete(OrganizationSalesRepAssignment, ofTheDemoOrganization);
  }
  const removed = await em.nativeDelete(Organization, { taxId: DEMO_ORGANIZATION.taxId });
  return {
    removed: [
      { entity: 'Organization', count: removed },
      { entity: 'OrganizationInvitation', count: invitations },
      { entity: 'OrganizationSalesRepAssignment', count: assignments },
    ],
  };
}
