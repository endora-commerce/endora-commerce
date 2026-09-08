/**
 * `payment_methods`' demo data (feature 113, T220 — contract §2).
 *
 * The two methods the demo shop checks out with, in the module that owns the
 * table. It writes `payment_methods` and nothing else (§2.1), reads no other
 * module's table and resolves no port (§2.2), so declaring it added no entry to
 * this module's manifest `dependencies` (§2.3) — which matters here more than
 * elsewhere: the `credit_limit` method's usefulness depends on a grant in
 * `credit_limits`, and it would have been easy to reach for that module from
 * this body. The grant is a composition step instead.
 *
 * Idempotent by an existence probe on the natural key (§2.4).
 */
import type { DemoSeedResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PaymentMethod } from '../entities/payment-method.entity.js';
import { DEMO_PAYMENT_METHOD_ROWS } from './rows.js';

interface PaymentMethodsDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function seedDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoSeedResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed`,
  // whose entry point calls `mustBeNonProduction()` as its first statement and
  // outside every `try` (contract §2.7, §3.3). The guard is the enforcement:
  // this write has no operator, no tenant and no audit reader.
  const em = context.ctx.cradle<PaymentMethodsDemoCradle>().emFactory();

  for (const row of DEMO_PAYMENT_METHOD_ROWS) {
    const existing = await em.findOne(PaymentMethod, { code: row.code });
    // Present already: left as it is — see `taxes`' body for why `seed` does
    // not overwrite what an operator may have edited.
    if (existing) continue;
    em.create(PaymentMethod, {
      code: row.code,
      name: { ...row.name },
      kind: row.kind,
      adapter: row.adapter,
      statusOnPending: row.statusOnPending,
      statusOnSuccess: row.statusOnSuccess,
      statusOnFailure: row.statusOnFailure,
    });
  }
  await em.flush();

  return {
    created: [{ entity: 'PaymentMethod', count: DEMO_PAYMENT_METHOD_ROWS.length }],
  };
}
