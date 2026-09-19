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
 * and into its `installHook`, reaches the same rows on a fresh database and on
 * one that already ran the migration.
 *
 * `specs/134-paid-module-extraction/contracts/foreign-write-repair.md` is
 * normative; §3.2 is the claim this file measures. The two seeds are the
 * repository's **first** install hooks, so the orchestrator branch that invokes
 * one has never been exercised by a module here: the install below is the real
 * `ModuleLifecycleOrchestrator.install`, driven over the generated manifest
 * index, rather than a hand-called hook — a hook that works when called directly
 * and not when the orchestrator calls it would pass a weaker test.
 *
 * **The historical SQL lives here now.** Both migrations' bodies are no-ops
 * (their class names are identities persisted in every customer database and may
 * not be renamed or deleted, §3.1), so the `insert` statements below are the last
 * statement in the repository of what an upgraded database actually contains.
 * That is what makes the equivalence assertion mean anything: without them the
 * "upgraded" case would be a second copy of the fresh one.
 *
 * Every row is written inside a transaction that is rolled back, and the
 * registration rows the install needs are written the same way.
 */

/** Verbatim from `Migration20260829T120000InpostSeedDeliveryMethods` before W7 emptied it. */
const INPOST_HISTORICAL_SEED = `
  insert into "delivery_methods" (
    "id", "code", "name", "cost", "currency", "adapter", "status",
    "status_on_success", "status_on_failure", "created_at", "updated_at"
  )
  values
    (
      gen_random_uuid(),
      'inpost_locker',
      '{"default":"InPost Parcel Locker","en":"InPost Parcel Locker","pl":"InPost Paczkomat","en-US":"InPost Parcel Locker","pl-PL":"InPost Paczkomat"}'::jsonb,
      0,
      'PLN',
      'inpost_locker',
      'active',
      'shipment_sent',
      'processing',
      now(),
      now()
    ),
    (
      gen_random_uuid(),
      'inpost_courier',
      '{"default":"InPost Courier","en":"InPost Courier","pl":"InPost Kurier","en-US":"InPost Courier","pl-PL":"InPost Kurier"}'::jsonb,
      0,
      'PLN',
      'inpost_courier',
      'active',
      'shipment_sent',
      'processing',
      now(),
      now()
    )
  on conflict ("code") do nothing;
`;

/** Verbatim from `Migration20260824T083100DhlParcelSeedDeliveryMethods` before W7 emptied it. */
const DHL_PARCEL_HISTORICAL_SEED = `
  with inserted as (
    insert into "delivery_methods" (
      "id", "code", "name", "cost", "currency", "adapter", "status",
      "status_on_success", "status_on_failure", "created_at", "updated_at"
    )
    values
      (
        gen_random_uuid(),
        'dhl_parcel_courier',
        '{"default":"DHL courier","pl-PL":"Kurier DHL","en-US":"DHL courier"}'::jsonb,
        0,
        'PLN',
        'dhl_parcel_courier',
        'inactive',
        'shipment_sent',
        'processing',
        now(),
        now()
      ),
      (
        gen_random_uuid(),
        'dhl_parcel_pickup',
        '{"default":"DHL pickup point","pl-PL":"Punkt DHL POP/BOX","en-US":"DHL pickup point"}'::jsonb,
        0,
        'PLN',
        'dhl_parcel_pickup',
        'inactive',
        'shipment_sent',
        'processing',
        now(),
        now()
      )
    on conflict ("code") do nothing
    returning "id"
  )
  insert into "sales_channel_delivery_methods" ("sales_channel_id", "delivery_method_id")
  select "sales_channels"."id", inserted."id"
  from inserted
  cross join "sales_channels"
  where "sales_channels"."system_default" = true
  on conflict ("sales_channel_id", "delivery_method_id") do nothing;
`;

const INPOST_CODES = ['inpost_courier', 'inpost_locker'] as const;
const DHL_PARCEL_CODES = ['dhl_parcel_courier', 'dhl_parcel_pickup'] as const;

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

describe('Carrier delivery-method seeds — install hook, fresh vs upgraded (integration)', () => {
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

  it('inpost: the hook seeds two active methods, binds no channel, and a fresh install matches an upgraded one', async () => {
    // Fresh: nothing has ever written these rows.
    await clearMethods(INPOST_CODES);
    await install('inpost');
    const fresh = await snapshot(INPOST_CODES);

    expect(fresh.methods.map((r) => r.code)).toEqual([...INPOST_CODES]);
    expect(fresh.methods.map((r) => r.status)).toEqual(['active', 'active']);
    // The migration deliberately wrote no membership row and that must survive
    // the move (`foreign-write-repair.md` §2.3).
    expect(fresh.memberships).toEqual([]);

    // Upgraded: the migration ran before it was emptied, and the hook runs after.
    await db.rollbackTx();
    await db.beginTx();
    await clearMethods(INPOST_CODES);
    await db.em().execute(INPOST_HISTORICAL_SEED);
    await install('inpost');
    const upgraded = await snapshot(INPOST_CODES);

    expect(JSON.stringify(upgraded)).toBe(JSON.stringify(fresh));
  }, 120_000);

  it('dhl_parcel: the hook seeds two INACTIVE methods in the default channel, and a fresh install matches an upgraded one', async () => {
    await clearMethods(DHL_PARCEL_CODES);
    await install('dhl_parcel');
    const fresh = await snapshot(DHL_PARCEL_CODES);

    expect(fresh.methods.map((r) => r.code)).toEqual([...DHL_PARCEL_CODES]);
    // The one field where the seeder's default and the correct value disagree
    // (§2.4): taking `'active'` would offer DHL to buyers on every new install.
    expect(fresh.methods.map((r) => r.status)).toEqual(['inactive', 'inactive']);
    expect(fresh.memberships.map((r) => r.method_code)).toEqual([...DHL_PARCEL_CODES]);

    await db.rollbackTx();
    await db.beginTx();
    await clearMethods(DHL_PARCEL_CODES);
    await db.em().execute(DHL_PARCEL_HISTORICAL_SEED);
    await install('dhl_parcel');
    const upgraded = await snapshot(DHL_PARCEL_CODES);

    expect(JSON.stringify(upgraded)).toBe(JSON.stringify(fresh));
  }, 120_000);

  it('dhl_parcel: a method an operator unbound from every channel stays unbound (issue #96)', async () => {
    await clearMethods(DHL_PARCEL_CODES);
    await db.em().execute(DHL_PARCEL_HISTORICAL_SEED);
    await db
      .em()
      .execute(
        `delete from "sales_channel_delivery_methods" where "delivery_method_id" in (
           select "id" from "delivery_methods" where "code" in (?, ?))`,
        [...DHL_PARCEL_CODES],
      );

    await install('dhl_parcel');

    // `created === false`, so `bindToDefaultChannel` is not called. An unguarded
    // call is issue #96 verbatim: the method comes back bound to Default and
    // nothing says so.
    const after = await snapshot(DHL_PARCEL_CODES);
    expect(after.methods).toHaveLength(2);
    expect(after.memberships).toEqual([]);
  }, 120_000);

  /**
   * W7's last step, and the reason it is not optional: once both carriers leave,
   * `DeliveryMethodSeedApi` has **zero consumers in this repository** — a
   * published surface whose breaking change would type-check green here and red
   * somewhere else, days later (`extraction-procedure.md` refusal 6, on the
   * consumer side). The example deployment's fixture is the standing consumer, so
   * it is installed here through the same orchestrator, with its overlay entry
   * handed in rather than discovered.
   */
  it('carrier_fixture: the standing consumer seeds one inactive method and binds it once', async () => {
    const fixtureEntry: DiscoveredLike = {
      id: carrierFixtureManifest.id,
      manifest: carrierFixtureManifest,
      manifestPath: '<overlay:example/carrier_fixture>',
      installHook: carrierFixtureInstallHook,
      uninstallHook: carrierFixtureUninstallHook,
    };
    const code = CARRIER_FIXTURE_DELIVERY_METHOD.code;

    await clearMethods([code]);
    await install('carrier_fixture', [fixtureEntry]);

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
    await install('carrier_fixture', [fixtureEntry]);
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

  it('the hooks are idempotent: a second install leaves an admin edit alone', async () => {
    await clearMethods(INPOST_CODES);
    await install('inpost');
    await db
      .em()
      .execute('update "delivery_methods" set "cost" = ?, "status" = ? where "code" = ?', [
        '19.99',
        'inactive',
        'inpost_locker',
      ]);

    await install('inpost');

    const rows = await snapshot(INPOST_CODES);
    const locker = rows.methods.find((r) => r.code === 'inpost_locker');
    expect(locker?.cost).toBe('19.99');
    expect(locker?.status).toBe('inactive');
  }, 120_000);
});
