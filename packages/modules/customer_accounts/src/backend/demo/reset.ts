/**
 * Withdraw `customer_accounts`' demo data (feature 160, FR-044): the *VIP*
 * group, by the code `seed` assigned, never by a predicate over the table.
 *
 * The demo organisation's membership of it is withdrawn first, by the
 * composition (§5.5); a demo price book offered to it cascades with it.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerGroup } from '../entities/customer-group.entity.js';
import { DEMO_CUSTOMER_GROUP } from './rows.js';

interface CustomerAccountsDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(context: ModuleDemoContext<ModuleContext>): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above; same
  // entry point, same `mustBeNonProduction()` guard (feature 113 contract §2.7).
  const em = context.ctx.cradle<CustomerAccountsDemoCradle>().emFactory();
  const removed = await em.nativeDelete(CustomerGroup, { code: DEMO_CUSTOMER_GROUP.code });
  return { removed: [{ entity: 'CustomerGroup', count: removed }] };
}
