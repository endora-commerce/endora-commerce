/**
 * Withdraw CRM's demo data
 * (`specs/143-crm-sales-opportunities/research.md` N-DD1).
 *
 * By the names `seed` assigns, never by a predicate over the table: a tag an
 * operator created is indistinguishable from a demo one by every other column.
 *
 * The demo Opportunities that carried these tags are gone by the time this
 * runs — a reset withdraws the composition before any module — and what joined
 * a tag to an Opportunity goes with either side through the join's own foreign
 * keys, which is this module's schema acting on this module's rows.
 */
import type { DemoResetResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CrmTag } from '../entities/crm-tag.entity.js';
import { DEMO_TAG_NAMES } from './rows.js';

interface CrmDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function resetDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoResetResult> {
  // command-coverage-ignore: the withdrawal half of the demo data above. Same
  // entry point, same `mustBeNonProduction()` guard, same absence of an
  // operator to attribute the write to.
  const em = context.ctx.cradle<CrmDemoCradle>().emFactory();
  const removed = await em.nativeDelete(CrmTag, { name: { $in: [...DEMO_TAG_NAMES] } });
  return { removed: [{ entity: 'CrmTag', count: removed }] };
}
