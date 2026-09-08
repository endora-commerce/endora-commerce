/**
 * `taxes`' demo data (feature 113, T220 — contract §2).
 *
 * The block that used to sit at the bottom of `dev-catalog-seed.ts`' 887-line
 * `main()`, in the module that owns the table. It writes `taxes` and nothing
 * else (§2.1), reads no other module's table and resolves no port (§2.2), so
 * declaring it added no entry to this module's manifest `dependencies` (§2.3).
 *
 * Idempotent by an existence probe on the natural key (§2.4): a second run
 * creates nothing and reports the same count, which is what makes SC-007
 * assertable from the report rather than from a database diff.
 */
import type { DemoSeedResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Tax } from '../entities/tax.entity.js';
import { DEMO_TAX_ROWS } from './rows.js';

/** The one thing a demo body needs off its module's own cradle. */
interface TaxesDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function seedDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoSeedResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed`,
  // whose entry point calls `mustBeNonProduction()` as its first statement and
  // outside every `try` (contract §2.7, §3.3). The guard is the enforcement:
  // this write has no operator, no tenant and no audit reader, and the command
  // refuses to run against a production database at all.
  const em = context.ctx.cradle<TaxesDemoCradle>().emFactory();

  for (const row of DEMO_TAX_ROWS) {
    const existing = await em.findOne(Tax, { code: row.code });
    // Present already: left exactly as it is. An operator may have edited the
    // demo rule, and overwriting it here would be this body deciding that its
    // own literal outranks their change — which is `reset`'s question, not
    // `seed`'s.
    if (existing) continue;
    em.create(Tax, {
      code: row.code,
      name: row.name,
      rate: row.rate,
      country: row.country,
      isDefault: row.isDefault,
    });
  }
  await em.flush();

  // The count is what the demo *holds* after the run, not what this call
  // inserted: seeding twice must report the same counts (`DemoEntityCount`).
  return { created: [{ entity: 'Tax', count: DEMO_TAX_ROWS.length }] };
}
