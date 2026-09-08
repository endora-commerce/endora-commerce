/**
 * Withdraw `payment_methods`' demo data (feature 113, T220 — contract §2.5).
 *
 * By the fixed codes `seed` assigns. This replaces `payment_methods`' line in
 * the host's 29-table `truncate … cascade`, and that line was the sharpest of
 * the three: five gateway modules seed their own methods and their adapter
 * rules from migrations, so a truncate of this table took fifteen rows nobody
 * had asked to lose, plus every rule that referenced them through the cascade.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PaymentMethod } from '../entities/payment-method.entity.js';
import { DEMO_PAYMENT_METHOD_CODES } from './rows.js';

interface PaymentMethodsDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to (contract §2.7).
  const em = context.ctx.cradle<PaymentMethodsDemoCradle>().emFactory();
  const removed = await em.nativeDelete(PaymentMethod, {
    code: { $in: [...DEMO_PAYMENT_METHOD_CODES] },
  });
  return { removed: [{ entity: 'PaymentMethod', count: removed }] };
}
