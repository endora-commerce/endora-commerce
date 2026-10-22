/**
 * `customer_accounts`' demo data (feature 160, FR-044): the *VIP* customer
 * group, in the module that owns `customer_groups`. It writes that table and
 * nothing else, reads no other module's table and resolves no port.
 *
 * Idempotent by an existence probe on the natural key: a second run creates
 * nothing and reports the same count.
 */
import type { DemoSeedResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerGroup } from '../entities/customer-group.entity.js';
import { DEMO_CUSTOMER_GROUP } from './rows.js';

/** The one thing a demo body needs off its module's own cradle. */
interface CustomerAccountsDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function seedDemo(context: ModuleDemoContext<ModuleContext>): Promise<DemoSeedResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed`,
  // whose entry point calls `mustBeNonProduction()` as its first statement
  // (feature 113 contract §2.7). This write has no operator and no audit reader.
  const em = context.ctx.cradle<CustomerAccountsDemoCradle>().emFactory();
  const existing = await em.findOne(CustomerGroup, { code: DEMO_CUSTOMER_GROUP.code });
  // Present already: left as it is — an operator may have renamed it.
  if (!existing) {
    em.create(CustomerGroup, {
      code: DEMO_CUSTOMER_GROUP.code,
      name: DEMO_CUSTOMER_GROUP.name,
      description: DEMO_CUSTOMER_GROUP.description,
    });
    await em.flush();
  }
  return { created: [{ entity: 'CustomerGroup', count: 1 }] };
}
