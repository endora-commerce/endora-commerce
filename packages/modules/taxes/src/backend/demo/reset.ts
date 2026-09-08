/**
 * Withdraw `taxes`' demo data (feature 113, T220 — contract §2.5).
 *
 * By the fixed codes `seed` assigns, never by a predicate over the table: an
 * operator's own rule is indistinguishable from a demo one by every other
 * column, and a `delete from taxes` would take theirs with it. This is the
 * withdrawal that replaces `taxes`' line in the host's 29-table
 * `truncate … cascade`, which could not tell the two apart at all.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Tax } from '../entities/tax.entity.js';
import { DEMO_TAX_CODES } from './rows.js';

interface TaxesDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to (contract §2.7).
  const em = context.ctx.cradle<TaxesDemoCradle>().emFactory();
  const removed = await em.nativeDelete(Tax, { code: { $in: [...DEMO_TAX_CODES] } });
  return { removed: [{ entity: 'Tax', count: removed }] };
}
