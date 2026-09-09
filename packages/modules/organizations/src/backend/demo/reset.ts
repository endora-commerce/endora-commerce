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
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
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
  const removed = await em.nativeDelete(Organization, { taxId: DEMO_ORGANIZATION.taxId });
  return { removed: [{ entity: 'Organization', count: removed }] };
}
