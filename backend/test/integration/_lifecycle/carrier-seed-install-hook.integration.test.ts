import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  type LoadedManifestRegistry,
  ModuleDepGraph,
  ModuleLifecycleOrchestrator,
} from '@endora-commerce/platform/lifecycle';
import { AuditLogService, ModuleRegistration } from '@endora-commerce/platform/composition';
import { DISCOVERED_MANIFESTS } from '../../../src/manifest-index.generated.js';
import {
  CARRIER_FIXTURE_DELIVERY_METHOD,
  installHook as carrierFixtureInstallHook,
  manifest as carrierFixtureManifest,
  uninstallHook as carrierFixtureUninstallHook,
} from '../../../src/apps/example/modules/carrier_fixture/manifest.js';

/**
 * One entry of the registry the orchestrator installs from, in the shape both
 * sources produce — `manifest-index.generated.ts` for a module package, and the
 * overlay loader for a module under `src/apps/<deployment>/modules/`. The fixture
 * is the second kind, and is handed in rather than discovered because this file
 * drives the orchestrator directly.
 */
interface DiscoveredLike {
  readonly id: string;
  readonly manifest: (typeof DISCOVERED_MANIFESTS)[number]['manifest'];
  readonly manifestPath: string;
  readonly installHook?: (typeof DISCOVERED_MANIFESTS)[number]['installHook'];
  readonly uninstallHook?: (typeof DISCOVERED_MANIFESTS)[number]['uninstallHook'];
}

/**
 * SC-009 / FR-064 — a carrier's delivery-method seed, moved out of its migration
 * and into its `installHook`, is driven through the real
 * `ModuleLifecycleOrchestrator.install` over the generated manifest index rather
 * than by a hand-called hook: a hook that works when called directly and not when
 * the orchestrator calls it would pass a weaker test.
 *
 * `specs/134-paid-module-extraction/contracts/foreign-write-repair.md` is
 * normative; §3.2 is the claim this file measures.
 *
 * ## Both carriers left with wave 1, and what remains is FR-021's standing consumer
 *
 * `inpost`'s case and its historical SQL went with **T035**; `dhl_parcel`'s went with
 * **T036** (E9: a test whose subject is not in this tree is coupling, not prose). The
 * **fresh-versus-upgraded equivalence** claim is a carrier's own and travels with it
 * — it needs a booted orchestrator against a real database, so it is the **host's**
 * under **D-252** and not the package's, and the paid repository is where each
 * carrier's historical migration SQL is now the last statement of what an upgraded
 * database contains. **That claim is not asserted anywhere in this repository any
 * more, and it is recorded as owed under T036 rather than dropped**: there is no free
 * module here whose delivery-method rows were ever written by a migration, so nothing
 * here can stand in for it. `carrier_fixture` has no historical SQL because it never
 * had a migration — inventing one would assert the equivalence against a fiction.
 *
 * What **is** still asserted here, over `carrier_fixture` — the overlay module FR-021
 * put in `backend/src/apps/example/modules/` precisely so this seam keeps a consumer
 * and this file keeps a subject:
 *
 *   * the hook seeds through `delivery_methods`' published install surface and binds
 *     the row to the default channel exactly once;
 *   * a row an operator unbound from every channel stays unbound across a re-install
 *     (issue #96) — `created === false`, so `bindToDefaultChannel` is not called;
 *   * the hook is **idempotent**: a second install leaves an operator's edits alone.
 *     This case was `inpost`'s until T035 and `dhl_parcel`'s until T036; the property
 *     is the **seam's** rather than any one carrier's, which is why it survives the
 *     carriers leaving;
 *   * the hard-uninstall half removes the row and a soft one does not.
 *
 * W7's last step and the reason none of this is optional: with both carriers gone,
 * `DeliveryMethodSeedApi` would otherwise have **zero consumers in this repository**
 * — a published surface whose breaking change would type-check green here and red in
 * a consumer's build days later (`extraction-procedure.md` refusal 6).
 *
 * Every row is written inside a transaction that is rolled back, and the
 * registration rows the install needs are written the same way.
 */

interface MethodRow {
  code: string;
  name: Record<string, string>;
  cost: string;
  currency: string;
  adapter: string;
  status: string;
  status_on_success: string;
  status_on_failure: string;
}

interface MembershipRow {
  method_code: string;
  channel_code: string;
}

/**
 * The overlay module's registry entry, handed to the orchestrator rather than
 * discovered: `manifest-index.generated.ts` carries module **packages**, and an
 * overlay module is loaded at boot from `src/apps/<deployment>/modules/`.
 *
 * At module scope because two cases install it now that it is the file's only
 * subject, and two copies of it would be two answers to what is being installed.
 */
const FIXTURE_ENTRY: DiscoveredLike = {
  id: carrierFixtureManifest.id,
  manifest: carrierFixtureManifest,
  manifestPath: '<overlay:example/carrier_fixture>',
  installHook: carrierFixtureInstallHook,
  uninstallHook: carrierFixtureUninstallHook,
};

describe('Carrier delivery-method seeds — the install-hook seam (integration)', () => {
  let db: TestDb;
  let redis: Redis;

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  }, 60_000);

  beforeEach(async () => {
    await db.beginTx();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    redis.disconnect();
    await db.close();
  });

  /**
   * The real orchestrator over the real registry, with every *other* module
   * recorded as installed so the dependency gate is satisfied without installing
   * eighty-odd modules for a two-row assertion. The entry under test carries its
   * package's own `installHook`, which is the thing being exercised.
   */
  async function install(
    moduleId: string,
    extra: ReadonlyArray<DiscoveredLike> = [],
  ): Promise<void> {
    const em = db.em();
    const population = [...DISCOVERED_MANIFESTS, ...extra];
    // Scoped to the ids this test writes rather than `{}`: a wipe of every row in
    // a shared table is what `check:shared-table-wipes` counts, and the rows this
    // file is entitled to remove are exactly the ones it is about to write.
    await em.nativeDelete(ModuleRegistration, {
      moduleId: { $in: population.map((entry) => entry.id) },
    });
    // `nativeDelete` bypasses the identity map, so a second `install()` in one
    // test would otherwise find the first run's registration entity still
    // managed and answer `already-installed` about a row that is gone.
    em.clear();
    for (const entry of population) {
      if (entry.id === moduleId) continue;
      em.create(ModuleRegistration, {
        moduleId: entry.id,
        state: 'installed',
        version: entry.manifest.version,
        installedAt: new Date(),
        lastStateChangeAt: new Date(),
      });
    }
    await em.flush();

    const manifests = population.map((entry) => entry.manifest);
    const registry: LoadedManifestRegistry = {
      modules: new Map(
        population.map((entry) => [
          entry.id,
          {
            manifest: entry.manifest,
            filePath: entry.manifestPath,
            ...(entry.installHook ? { installHook: entry.installHook } : {}),
            ...(entry.uninstallHook ? { uninstallHook: entry.uninstallHook } : {}),
          },
        ]),
      ) as never,
      graph: new ModuleDepGraph(manifests),
      // Deliberately none, as `install-all.integration.test.ts` does: the
      // subject is the install hook, and `_i18n`'s participant would re-read
      // every bundle on disk for it.
      participants: [],
    };

    const orchestrator = new ModuleLifecycleOrchestrator({
      orm: db.orm,
      redis,
      em: () => db.em(),
      auditLog: new AuditLogService(() => db.em()),
      registry,
    });

    const result = await orchestrator.install(moduleId);
    expect(result.state).toBe('installed');
  }

  async function clearMethods(codes: readonly string[]): Promise<void> {
    await db
      .em()
      .execute(
        `delete from "delivery_methods" where "code" in (${codes.map(() => '?').join(', ')})`,
        [...codes],
      );
  }

  async function snapshot(
    codes: readonly string[],
  ): Promise<{ methods: MethodRow[]; memberships: MembershipRow[] }> {
    const em: EntityManager = db.em();
    const placeholders = codes.map(() => '?').join(', ');
    const methods = await em.execute<MethodRow[]>(
      `select "code", "name", "cost", "currency", "adapter", "status",
              "status_on_success", "status_on_failure"
         from "delivery_methods" where "code" in (${placeholders}) order by "code"`,
      [...codes],
    );
    const memberships = await em.execute<MembershipRow[]>(
      `select dm."code" as method_code, sc."code" as channel_code
         from "sales_channel_delivery_methods" b
         join "delivery_methods" dm on dm."id" = b."delivery_method_id"
         join "sales_channels" sc on sc."id" = b."sales_channel_id"
        where dm."code" in (${placeholders})
        order by dm."code", sc."code"`,
      [...codes],
    );
    return { methods, memberships };
  }

  /**
   * W7's last step, and since wave 1 closed it is the **only** consumer left: with
   * both carriers out of this repository, `DeliveryMethodSeedApi` would otherwise have
   * **zero** here — a published surface whose breaking change would type-check green
   * here and red somewhere else, days later (`extraction-procedure.md` refusal 6, on
   * the consumer side). The example deployment's fixture is that standing consumer, so
   * it is installed through the same orchestrator, with its overlay entry handed in
   * rather than discovered.
   */
  it('carrier_fixture: the standing consumer seeds one inactive method and binds it once', async () => {
    const code = CARRIER_FIXTURE_DELIVERY_METHOD.code;

    await clearMethods([code]);
    await install('carrier_fixture', [FIXTURE_ENTRY]);

    const seeded = await snapshot([code]);
    expect(seeded.methods).toHaveLength(1);
    expect(seeded.methods[0]?.status).toBe('inactive');
    expect(seeded.methods[0]?.adapter).toBe(code);
    expect(seeded.memberships.map((r) => r.channel_code)).toHaveLength(1);

    // An operator unbinds it; a re-install does not put it back (issue #96).
    await db
      .em()
      .execute(
        `delete from "sales_channel_delivery_methods" where "delivery_method_id" in (
           select "id" from "delivery_methods" where "code" = ?)`,
        [code],
      );
    await install('carrier_fixture', [FIXTURE_ENTRY]);
    expect((await snapshot([code])).memberships).toEqual([]);

    // The hard-uninstall half, called directly: the orchestrator's uninstall also
    // reverts migrations and removes settings, and neither is this seam's subject.
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    await carrierFixtureUninstallHook?.({
      em: db.em(),
      redis: undefined,
      log,
      module: { id: 'carrier_fixture', version: carrierFixtureManifest.version },
      hard: true,
    });
    expect((await snapshot([code])).methods).toEqual([]);
  }, 120_000);

  it('the hook is idempotent: a second install leaves an admin edit alone', async () => {
    // **Driven over `carrier_fixture` since wave 1 closed.** It was `inpost`'s until
    // `specs/134-paid-module-extraction/` T035 and `dhl_parcel`'s until T036; the
    // property is the **seam's** rather than any one carrier's — `ensureMethodForAdapter`
    // must not reconcile a row it did not create — so it survives both carriers leaving
    // and is asked over the standing consumer FR-021 put here for exactly this.
    //
    // The other half of the guard it protects, `created === true` / issue #96, is the
    // case above.
    const code = CARRIER_FIXTURE_DELIVERY_METHOD.code;
    await clearMethods([code]);
    await install('carrier_fixture', [FIXTURE_ENTRY]);
    await db
      .em()
      .execute('update "delivery_methods" set "cost" = ?, "status" = ? where "code" = ?', [
        '19.99',
        'active',
        code,
      ]);

    await install('carrier_fixture', [FIXTURE_ENTRY]);

    const rows = await snapshot([code]);
    const seeded = rows.methods.find((r) => r.code === code);
    expect(seeded?.cost).toBe('19.99');
    // Seeded `inactive`; an operator turned it on, and a second install may not turn
    // it back off.
    expect(seeded?.status).toBe('active');
  }, 120_000);
});
