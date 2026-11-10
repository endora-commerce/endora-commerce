/**
 * `organizations`' demo data (feature 113, T222 — contract §2).
 *
 * The buying organisation the demo shop trades with, in the module that owns the
 * table. It writes `organizations` and nothing else (§2.1), reads no other
 * module's table and resolves no port (§2.2), so declaring it added no entry to
 * this module's manifest `dependencies` (§2.3).
 *
 * **The buyer who belongs to it and the credit limit granted to it are not
 * here.** Each is another module's row against this one's, so each is a
 * composition step (§5.1) in `@endora-commerce/demo-composition`, which runs
 * after every module's `seed` and finds this organisation waiting.
 *
 * Idempotent by an existence probe on the natural key (§2.4): a second run
 * creates nothing and reports the same count.
 */
import type { DemoSeedResult, ModuleDemoContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Organization } from '../entities/organization.entity.js';
import { TaxIdLookupService } from '../services/tax-id-lookup-service.js';
import { DEMO_ORGANIZATION } from './rows.js';

/** The one thing a demo body needs off its module's own cradle. */
interface OrganizationsDemoCradle {
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
  const em = context.ctx.cradle<OrganizationsDemoCradle>().emFactory();

  // `specs/177-tax-id-scope/` O5 — in `per-tree-root` a branch may share the
  // demo tax ID, so the lookup answers a list, the tree's root first. Deleted
  // rows count: the old unique `findOne` found them too, and in `global` the
  // constraint still holds their tax ID.
  const [existing] = await new TaxIdLookupService(() => em).findByTaxId(DEMO_ORGANIZATION.taxId, {
    includeDeleted: true,
    em,
  });
  // Present already: left exactly as it is. An operator may have renamed it or
  // moved it through moderation, and overwriting that here would be this body
  // deciding its own literal outranks their change.
  if (!existing) {
    em.create(Organization, {
      name: DEMO_ORGANIZATION.name,
      taxId: DEMO_ORGANIZATION.taxId,
      status: DEMO_ORGANIZATION.status,
      vatStatus: DEMO_ORGANIZATION.vatStatus,
      registeredAddress: { ...DEMO_ORGANIZATION.registeredAddress },
    });
    await em.flush();
  }

  // What the demo *holds* after the run, not what this call inserted: seeding
  // twice must report the same counts (`DemoEntityCount`).
  return { created: [{ entity: 'Organization', count: 1 }] };
}
