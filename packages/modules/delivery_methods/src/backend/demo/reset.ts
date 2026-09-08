/**
 * Withdraw `delivery_methods`' demo data (feature 113, T220 — contract §2.5).
 *
 * By the fixed codes `seed` assigns. This replaces `delivery_methods`' line in
 * the host's 29-table `truncate … cascade`, which took every row in the table —
 * an operator's own methods included, and, through the cascade, the sales
 * channel and organisation bindings that pointed at them.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DeliveryMethod } from '../entities/delivery-method.entity.js';
import { DEMO_DELIVERY_METHOD_CODES } from './rows.js';

interface DeliveryMethodsDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to (contract §2.7).
  const em = context.ctx.cradle<DeliveryMethodsDemoCradle>().emFactory();
  const removed = await em.nativeDelete(DeliveryMethod, {
    code: { $in: [...DEMO_DELIVERY_METHOD_CODES] },
  });
  return { removed: [{ entity: 'DeliveryMethod', count: removed }] };
}
