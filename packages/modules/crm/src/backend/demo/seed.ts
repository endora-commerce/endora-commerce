/**
 * CRM's demo data (`specs/143-crm-sales-opportunities/research.md` N-DD1).
 *
 * A few tags, in the module that owns the table. It writes `crm_tags` and
 * nothing else, reads no other module's table and resolves no port, so
 * declaring it added no entry to this module's manifest `dependencies`.
 *
 * **The Opportunities that carry these tags are not here.** Each belongs to an
 * Organization and most to an assignee — other modules' rows — so the pipeline
 * is a step of `@endora-commerce/demo-composition`, which runs after every
 * module's `seed`.
 *
 * Idempotent by an existence probe on the natural key: a second run creates
 * nothing and reports the same count. The probe compares names the way the
 * table's unique index does, in lower case — a tag an operator already spelled
 * `KEY ACCOUNT` is that tag, and inserting beside it would be refused.
 */
import type { DemoSeedResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CrmTag } from '../entities/crm-tag.entity.js';
import { DEMO_TAGS } from './rows.js';

/** The one thing a demo body needs off its module's own cradle. */
interface CrmDemoCradle {
  readonly emFactory: () => EntityManager;
}

export async function seedDemo(
  context: ModuleDemoContext<ModuleContext>,
): Promise<DemoSeedResult> {
  // command-coverage-ignore: demo data, reached only by `endora demo seed`,
  // whose entry point calls `mustBeNonProduction()` as its first statement and
  // outside every `try`. The guard is the enforcement: this write has no
  // operator, no tenant and no audit reader, and the command refuses to run
  // against a production database at all.
  const em = context.ctx.cradle<CrmDemoCradle>().emFactory();

  const held = new Set((await em.find(CrmTag, {})).map((tag) => tag.name.toLowerCase()));
  for (const row of DEMO_TAGS) {
    // Present already: left exactly as it is. An operator may have recoloured
    // it, and overwriting that here would be this body deciding its own literal
    // outranks their change.
    if (held.has(row.name.toLowerCase())) continue;
    em.create(CrmTag, { name: row.name, color: row.color });
  }
  await em.flush();

  // What the demo *holds* after the run, not what this call inserted: seeding
  // twice must report the same counts (`DemoEntityCount`).
  return { created: [{ entity: 'CrmTag', count: DEMO_TAGS.length }] };
}
