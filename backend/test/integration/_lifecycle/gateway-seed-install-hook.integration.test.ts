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
  PAYMENT_GATEWAY_FIXTURE_PAYMENT_METHOD,
  installHook as gatewayFixtureInstallHook,
  manifest as gatewayFixtureManifest,
  uninstallHook as gatewayFixtureUninstallHook,
} from '../../../src/apps/example/modules/payment_gateway_fixture/manifest.js';

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
 * SC-009 / FR-064 — a payment gateway's `payment_methods` seed, moved out of its
 * migration and into its `installHook`, is driven through the real
 * `ModuleLifecycleOrchestrator.install` over the generated manifest index rather
 * than by a hand-called hook: a hook that works when called directly and not when
 * the orchestrator calls it would pass a weaker test.
 *
 * `specs/134-paid-module-extraction/contracts/foreign-write-repair.md` is
 * normative; §3.2 is the claim this file measures, and the delivery twin
 * (`carrier-seed-install-hook.integration.test.ts`) is the same file one wave
 * earlier.
 *
 * ## Two subjects, with different lifetimes, and that is deliberate
 *
 *   * **`stripe`** stands for the five gateways while they are still in this
 *     repository. Its case carries the **fresh-versus-upgraded equivalence**,
 *     which is a gateway's own claim and travels with the package at T046 — wave
 *     1 recorded exactly that disposition for `inpost` and `dhl_parcel`, and this
 *     file inherits it. It is the one gateway whose seed has five codes and a
 *     vendor-owned rule table, so it exercises every shape the other four have.
 *   * **`payment_gateway_fixture`** is FR-021's standing consumer and does not
 *     travel. With all five gateways gone, `PaymentMethodSeedApi` would have
 *     **zero consumers in this repository** — a published surface whose breaking
 *     change would type-check green here and red in a consumer's build days later
 *     (`extraction-procedure.md` refusal 6, on the consumer side). W7's last step
 *     is what makes it a consumer, and these are the cases that survive T046.
 *
 * Every row is written inside a transaction that is rolled back, and the
 * registration rows the install needs are written the same way.
 */

interface MethodRow {
  code: string;
  name: Record<string, string>;
  kind: string;
  adapter: string;
  status: string;
  additional_price: string;
  status_on_pending: string;
  status_on_success: string;
  status_on_failure: string;
}

interface MembershipRow {
  method_code: string;
  channel_code: string;
}

/** The five codes `stripe`'s emptied seed migration used to insert. */
const STRIPE_CODES = [
  'stripe_apple_pay',
  'stripe_bank_transfer',
  'stripe_blik',
  'stripe_card',
  'stripe_google_pay',
] as const;

const FIXTURE_ENTRY: DiscoveredLike = {
  id: gatewayFixtureManifest.id,
  manifest: gatewayFixtureManifest,
  manifestPath: '<overlay:example/payment_gateway_fixture>',
  installHook: gatewayFixtureInstallHook,
  uninstallHook: gatewayFixtureUninstallHook,
};

describe('Gateway payment-method seeds — the install-hook seam (integration)', () => {
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
   * eighty-odd modules for a handful of rows. The entry under test carries its
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
      .execute(`delete from "payment_methods" where "code" in (${codes.map(() => '?').join(', ')})`, [
        ...codes,
      ]);
  }

  async function snapshot(
    codes: readonly string[],
  ): Promise<{ methods: MethodRow[]; memberships: MembershipRow[] }> {
    const em: EntityManager = db.em();
    const placeholders = codes.map(() => '?').join(', ');
    const methods = await em.execute<MethodRow[]>(
      `select "code", "name", "kind", "adapter", "status", "additional_price",
              "status_on_pending", "status_on_success", "status_on_failure"
         from "payment_methods" where "code" in (${placeholders}) order by "code"`,
      [...codes],
    );
    const memberships = await em.execute<MembershipRow[]>(
      `select pm."code" as method_code, sc."code" as channel_code
         from "sales_channel_payment_methods" b
         join "payment_methods" pm on pm."id" = b."payment_method_id"
         join "sales_channels" sc on sc."id" = b."sales_channel_id"
        where pm."code" in (${placeholders})
        order by pm."code", sc."code"`,
      [...codes],
    );
    return { methods, memberships };
  }

  /**
   * The row values §2.4 required to be named rather than defaulted, measured on
   * the database a fresh install produces.
   *
   * `status: 'inactive'` is the one where the seeder's default and the correct
   * value disagree, and `status_on_failure: 'on_hold'` is §4's whole premise: the
   * emptied `*_failure_status_on_hold` migrations exist only to correct rows the
   * old seed wrote as `'cancelled'`, so a fresh install that cannot produce one
   * is what retires them with no replacement.
   */
  it('stripe: seeds five inactive methods, at on_hold, each bound to the default channel once', async () => {
    await clearMethods(STRIPE_CODES);
    await install('stripe');

    const seeded = await snapshot(STRIPE_CODES);
    expect(seeded.methods.map((r) => r.code)).toEqual([...STRIPE_CODES]);
    for (const row of seeded.methods) {
      expect(row.adapter, row.code).toBe('stripe');
      expect(row.kind, row.code).toBe('gateway');
      expect(row.status, row.code).toBe('inactive');
      expect(row.status_on_pending, row.code).toBe('new');
      expect(row.status_on_success, row.code).toBe('paid');
      expect(row.status_on_failure, row.code).toBe('on_hold');
    }
    expect(seeded.memberships).toHaveLength(STRIPE_CODES.length);

    // The vendor-owned rule row the emptied seed migration used to create, at its
    // shipped default. It is this module's own table, so it is not the foreign
    // write FR-064 is about — it is carried over so that a fresh install and an
    // upgraded one hold the same rows (§3.2).
    const rules = await db
      .em()
      .execute<Array<{ code: string }>>(
        `select pm."code" from "stripe_payment_method_rules" r
           join "payment_methods" pm on pm."id" = r."payment_method_id"
          where pm."code" in (${STRIPE_CODES.map(() => '?').join(', ')}) order by pm."code"`,
        [...STRIPE_CODES],
      );
    expect(rules.map((r) => r.code)).toEqual([...STRIPE_CODES]);
  }, 120_000);

  it('stripe: a method the operator unbound stays unbound, and an admin edit survives', async () => {
    // Both halves of the created-guard, on a real gateway. `ensureMethodForAdapter`
    // must not reconcile a row it did not create, and `bindToDefaultChannel` must
    // not run for one — an unguarded call is issue #96 verbatim (§2.3).
    await clearMethods(STRIPE_CODES);
    await install('stripe');

    await db
      .em()
      .execute(
        `delete from "sales_channel_payment_methods" where "payment_method_id" in (
           select "id" from "payment_methods" where "code" = ?)`,
        ['stripe_card'],
      );
    await db
      .em()
      .execute('update "payment_methods" set "status" = ?, "additional_price" = ? where "code" = ?', [
        'active',
        '4.99',
        'stripe_card',
      ]);

    await install('stripe');

    const after = await snapshot(['stripe_card']);
    expect(after.memberships).toEqual([]);
    expect(after.methods[0]?.status).toBe('active');
    expect(after.methods[0]?.additional_price).toBe('4.99');
  }, 120_000);

  /**
   * W7's last step, and the case that survives T046: with all five gateways out
   * of this repository, `PaymentMethodSeedApi` would otherwise have **zero**
   * consumers here. The example deployment's fixture is that standing consumer,
   * so it is installed through the same orchestrator, with its overlay entry
   * handed in rather than discovered.
   */
  it('payment_gateway_fixture: the standing consumer seeds one inactive method and binds it once', async () => {
    const code = PAYMENT_GATEWAY_FIXTURE_PAYMENT_METHOD.code;

    await clearMethods([code]);
    await install('payment_gateway_fixture', [FIXTURE_ENTRY]);

    const seeded = await snapshot([code]);
    expect(seeded.methods).toHaveLength(1);
    expect(seeded.methods[0]?.status).toBe('inactive');
    expect(seeded.methods[0]?.status_on_failure).toBe('on_hold');
    expect(seeded.methods[0]?.adapter).toBe(code);
    expect(seeded.memberships.map((r) => r.channel_code)).toHaveLength(1);

    // An operator unbinds it; a re-install does not put it back (issue #96).
    await db
      .em()
      .execute(
        `delete from "sales_channel_payment_methods" where "payment_method_id" in (
           select "id" from "payment_methods" where "code" = ?)`,
        [code],
      );
    await install('payment_gateway_fixture', [FIXTURE_ENTRY]);
    expect((await snapshot([code])).memberships).toEqual([]);

    // The hard-uninstall half, called directly: the orchestrator's uninstall also
    // reverts migrations and removes settings, and neither is this seam's subject.
    const log = { info: () => {}, warn: () => {}, error: () => {} };
    await gatewayFixtureUninstallHook?.({
      em: db.em(),
      redis: undefined,
      log,
      module: { id: 'payment_gateway_fixture', version: gatewayFixtureManifest.version },
      hard: true,
    });
    expect((await snapshot([code])).methods).toEqual([]);
  }, 120_000);

  it('payment_gateway_fixture: a soft uninstall removes nothing (Principle XVII)', async () => {
    // §2.6 — the row survives both deactivation and soft uninstall. Deactivation
    // fires no hook at all, which is the other axis; a soft uninstall fires this
    // one, and `if (!ctx.hard) return;` is the whole of what keeps the row.
    const code = PAYMENT_GATEWAY_FIXTURE_PAYMENT_METHOD.code;
    await clearMethods([code]);
    await install('payment_gateway_fixture', [FIXTURE_ENTRY]);

    const log = { info: () => {}, warn: () => {}, error: () => {} };
    await gatewayFixtureUninstallHook?.({
      em: db.em(),
      redis: undefined,
      log,
      module: { id: 'payment_gateway_fixture', version: gatewayFixtureManifest.version },
      hard: false,
    });

    expect((await snapshot([code])).methods).toHaveLength(1);
  }, 120_000);
});
