/**
 * The platform half of the package-schema acceptance criterion — the process
 * that boots this repository's backend against a package installed somewhere
 * else, and answers A1 … A7 and A10.
 *
 * It is spawned by `package-schema.ts`, once per phase, and prints exactly one
 * machine-readable line (`ACCEPTANCE_JSON {...}`) on stdout. One process per
 * phase because two of them differ only in the state of a Setting the platform
 * reads **at boot**: composing twice in one process would make the second
 * answer depend on cache invalidation rather than on the flip, which is the
 * kind of test that passes for the wrong reason.
 *
 * Everything it asks, it asks through the platform's own seams — the ORM
 * configuration, `resolvedManifestEntries()`, the permission catalogue, the
 * bundle loader, `composeApp()` and the lifecycle orchestrator. Not one of them
 * was written for this file, which is what makes it a criterion rather than a
 * mirror of one implementation: the phases below are the sequence an operator
 * runs — migrate, boot, `module:install`, flip the control, `uninstall --hard`
 * — and the assertions read what that sequence left behind.
 *
 * Contract: `specs/080-f4-real-scope/contracts/package-schema-acceptance.md`.
 */

/* eslint-disable no-console -- this file's stdout is its interface. */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssertionResult } from './assertions.js';

const PACKAGE_NAME = process.env['ACCEPTANCE_PACKAGE_NAME'] ?? '@endora-commerce/mod-acceptance-probe';
const MODULE_ID = 'acceptance_probe';
const TABLE = 'acceptance_probe_rows';
const MIGRATION_CLASS = 'Migration20260821T120000AcceptanceProbeInit';
const ROUTE = '/api/v1/admin/acceptance-probe/ping';
const ACTIVATION_SETTING = 'acceptance_probe.activation';
const PERMISSION = 'acceptance_probe:manage';

/**
 * A10's literals: the container name the **package** registers, the greeting it
 * answers before and after a decoration would wrap it, and the id of the
 * deployment's overlay module that reaches for it.
 *
 * They are spelled here and in two files that know nothing about each other —
 * the package's `./backend` export and
 * `backend/src/apps/acceptance/modules/acceptance_overlay/backend.ts` — which is
 * the shape a decoration has in production: the overlay names a registration,
 * never a file, and the two sides share a string and nothing else. The assertion
 * is worth something precisely because neither side can import the other.
 *
 * The overlay module's id joins them under D-176 Q3, because what the assertion
 * now reads is a **refusal**, and a refusal that does not name who reached for
 * what is a refusal an operator cannot act on. `DECORATED_GREETING` stays: it is
 * what the phase would see if the declined capability were granted, which is one
 * of the two ways composition succeeding is wrong.
 */
const PACKAGE_REGISTRATION = 'acceptanceProbeGreeter';
const OVERLAY_MODULE_ID = 'acceptance_overlay';
const UNDECORATED_GREETING = 'acceptance probe';
const DECORATED_GREETING = `overlay:${UNDECORATED_GREETING}`;

/** Thrown for "the harness could not run", never for "the platform answered wrong". */
class Inconclusive extends Error {}

function instanceRoot(): string {
  const root = process.env['ACCEPTANCE_INSTANCE_ROOT'];
  if (!root) throw new Inconclusive('ACCEPTANCE_INSTANCE_ROOT is not set');
  return root;
}

/**
 * Resolve the installed package the way anything in the instance would.
 *
 * `createRequire` rooted at the instance directory — not at this file — because
 * the whole question is whether the platform can reach a module it did not
 * ship. A resolution rooted here would find nothing and say nothing.
 */
function resolveInstalled(subpath: string): string {
  const require = createRequire(join(instanceRoot(), 'noop.js'));
  return require.resolve(subpath === '.' ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath}`);
}

async function importInstalled(subpath: string): Promise<Record<string, unknown>> {
  return (await import(pathToFileURL(resolveInstalled(subpath)).href)) as Record<string, unknown>;
}

/** A connection failure is the harness's problem; anything else is the platform's. */
function classifyError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|Connection terminated|password authentication failed|does not exist/i.test(
      message,
    ) &&
    /postgres|redis|5432|6379|database/i.test(message)
  ) {
    throw new Inconclusive(`a service the probe needs was not reachable: ${message}`);
  }
  throw error instanceof Error ? error : new Error(message);
}

// ---------------------------------------------------------------------------
// Phase `schema` — A1, A2, A3, A4 and the identity/assets half of A5
// ---------------------------------------------------------------------------

async function phaseSchema(): Promise<AssertionResult[]> {
  const { initOrm, closeOrm } = await import('../../src/db/index.js');
  const results: AssertionResult[] = [];

  let orm: Awaited<ReturnType<typeof initOrm>>;
  try {
    orm = await initOrm();
  } catch (error) {
    classifyError(error);
  }

  try {
    const migrator = orm.getMigrator();
    try {
      await migrator.up();
    } catch (error) {
      classifyError(error);
    }

    const em = orm.em.fork();
    const applied = (await em.execute(
      'select name from mikro_orm_migrations where name = ?',
      [MIGRATION_CLASS],
    )) as Array<{ name: string }>;
    const appliedCount = (
      (await em.execute('select count(*)::int as n from mikro_orm_migrations')) as Array<{
        n: number;
      }>
    )[0]?.n;
    results.push({
      id: 'A1',
      title: `mikro_orm_migrations carries ${MIGRATION_CLASS}`,
      refuses: 'a package whose migration the host never even saw',
      status: applied.length === 1 ? 'pass' : 'fail',
      detail:
        applied.length === 1
          ? `applied, alongside ${(appliedCount ?? 0) - 1} core migrations`
          : `absent. ${appliedCount ?? 0} migrations ran and none of them was the package's: ` +
            'the migration registry is a committed walk of `backend/src` ' +
            '(`generate-composer.ts`), so a package contributes nothing to it',
    });

    const tables = (await em.execute(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = ?",
      [TABLE],
    )) as Array<{ table_name: string }>;
    results.push({
      id: 'A2',
      title: `information_schema knows the table ${TABLE}`,
      refuses: 'a migration that was recorded without being run',
      status: tables.length === 1 ? 'pass' : 'fail',
      detail: tables.length === 1 ? 'the table exists' : 'the table does not exist',
    });

    const columns = (await em.execute(
      'select column_name, data_type, is_nullable from information_schema.columns where table_name = ?',
      [TABLE],
    )) as Array<{ column_name: string; data_type: string; is_nullable: string }>;
    const indexes = (await em.execute('select indexname from pg_indexes where tablename = ?', [
      TABLE,
    ])) as Array<{ indexname: string }>;
    const tenantColumn = columns.find((c) => c.column_name === 'organization_id');
    const tenantIndex = indexes.find(
      (i) => i.indexname === 'acceptance_probe_rows_organization_id_index',
    );
    results.push({
      id: 'A3',
      title: "the table's tenant column and index are as the migration declared them",
      refuses: 'a row in `mikro_orm_migrations` standing in for a migration body that never ran',
      status: tenantColumn && tenantIndex ? 'pass' : 'fail',
      detail:
        tenantColumn && tenantIndex
          ? `organization_id ${tenantColumn.data_type} (nullable=${tenantColumn.is_nullable}), ` +
            `index ${tenantIndex.indexname}`
          : `columns=${columns.length} indexes=${indexes.length}: the migration body did not run`,
    });

    // A4 — the compiled entity has to reach MikroORM's metadata. The class is
    // imported from the *installed* package; the metadata is the platform's.
    let a4: AssertionResult;
    try {
      const backendEntry = await importInstalled('backend');
      // Read through the package's declared `entities` array, which since D-168
      // is the only way one of its classes leaves the package: it publishes no
      // entity class by name, so a consumer naming `AcceptanceProbeRow` — this
      // probe included — is the edge that ruling removes. Reading the array is
      // also the more faithful assertion, being the export the host's own
      // `configured-entities.ts` merges.
      const declared = backendEntry['entities'];
      if (!Array.isArray(declared) || declared.length === 0) {
        throw new Error(`the package's ./backend export declares no non-empty 'entities' array`);
      }
      const entity = declared[0] as new () => object;
      const metadata = orm.getMetadata();
      if (!metadata.has(entity.name)) {
        a4 = {
          id: 'A4',
          title: 'the ORM can query the package entity',
          refuses: "a `dist` whose `__decorate([...])` never reached the host's entity registry",
          status: 'fail',
          detail:
            `${entity.name} is not in the ORM metadata. The entity registry is emitted from a ` +
            'source-text walk for `@Entity(` under `backend/src` (`generate-composer.ts:603`), ' +
            'and compilation removes that probe',
        };
      } else {
        await orm.em.fork().find(entity as never, {});
        a4 = {
          id: 'A4',
          title: 'the ORM can query the package entity',
          refuses: "a `dist` whose `__decorate([...])` never reached the host's entity registry",
          status: 'pass',
          detail: `em.find(${entity.name}, {}) returned without error`,
        };
      }
    } catch (error) {
      a4 = {
        id: 'A4',
        title: 'the ORM can query the package entity',
        refuses: "a `dist` whose `__decorate([...])` never reached the host's entity registry",
        status: 'fail',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(a4);

    results.push(await identityAndAssets(() => orm.em.fork()));
    return results;
  } finally {
    await closeOrm().catch(() => undefined);
  }
}

/**
 * A5's first three quarters: the module is in the resolved manifest set, its
 * `filePath` is inside the instance, its permission is grantable, and its
 * palette action resolves in both shipped languages. The fourth quarter —
 * "and enforced" — is answered by the `gate-on` phase, because only a composed
 * application can say whether a route refuses an anonymous caller.
 *
 * **The translations go through the platform's own reconciler** (feature 080,
 * T032). This used to call `loadModuleBundles` on `dirname(entry.filePath)`,
 * which proves the files were published to a path the assertion computed
 * itself, and proves nothing about the code that actually populates
 * `translation_bundles` — at boot, on `i18n:reload` and on `module:install`. So
 * it now runs `reconcileBundles` over the **whole resolved set**, unfiltered,
 * and then reads the keys back out of `getMergedBundleForLanguage`, which is
 * the read the Admin SPA and the command palette serve from. A package whose
 * bundles the reconciler cannot reach now fails A5 even if its `i18n/` is
 * sitting right there in `node_modules`, which is the gap this assertion was
 * recorded as still having.
 */
async function identityAndAssets(em: () => EntityManager): Promise<AssertionResult> {
  const { resolvedManifestEntries } = await import(
    '../../src/modules/_lifecycle/registered-manifests.js'
  );
  const { PermissionCatalogueService } = await import('@endora-commerce/mod-admin-roles/backend');
  const { I18nService } = await import('../../src/modules/_i18n/services/i18n-service.js');
  const { reconcileBundles } = await import(
    '../../src/modules/_i18n/services/bundle-reconciler.js'
  );

  const title = 'the module, its permission and its palette action all travel with the package';
  const refuses =
    'a package whose schema arrives while its identity, permission and translations do not';

  const entries = await resolvedManifestEntries();
  const entry = entries.find((e) => e.manifest.id === MODULE_ID);
  if (!entry) {
    return {
      id: 'A5',
      title,
      refuses,
      status: 'fail',
      detail:
        `no module "${MODULE_ID}" in resolvedManifestEntries() (${entries.length} modules). ` +
        'The resolved set is the generated core index plus this deployment\'s overlay modules; ' +
        'nothing resolves an installed package (D-111 P1/P2)',
    };
  }

  const problems: string[] = [];
  if (!entry.filePath.startsWith(instanceRoot())) {
    problems.push(`filePath ${entry.filePath} is not inside the instance directory`);
  }
  const catalogue = new PermissionCatalogueService({ registryEntries: entries });
  if (!catalogue.listAssignableCodes().includes(PERMISSION)) {
    problems.push(`${PERMISSION} is not in the grantable catalogue`);
  }
  const action = entry.manifest.actions?.[0];
  if (!action) {
    problems.push('the manifest declares no palette action');
  } else {
    const i18nService = new I18nService({ em });
    const warnings: string[] = [];
    // Unfiltered: the reconciler is handed the whole resolved set, the way
    // `_i18n`'s boot pass is. Passing only this module's entry would answer a
    // question the platform never asks.
    const reconciled = await reconcileBundles(entries, i18nService, {
      info: () => undefined,
      warn: (message: string) => warnings.push(message),
    });
    const own = reconciled.failures.filter((failure) => failure.moduleId === MODULE_ID);
    for (const failure of own) {
      problems.push(`the reconciler refused the package's bundles (${failure.reason})`);
    }
    if (own.length === 0) {
      for (const language of ['en', 'pl'] as const) {
        // The read the Admin SPA serves the palette from, not the loader.
        const merged = await i18nService.getMergedBundleForLanguage(language);
        const bundle = merged.bundles[MODULE_ID];
        if (!bundle) {
          problems.push(
            `no ${language} bundle in translation_bundles after the reconcile ` +
              `(${reconciled.installed} module(s) installed, ${reconciled.failed} failed)`,
          );
          continue;
        }
        for (const key of [action.labelKey, action.descriptionKey].filter(
          (k): k is string => typeof k === 'string',
        )) {
          if (!(key in bundle)) problems.push(`${language} bundle has no key ${key}`);
        }
      }
    }
  }

  return {
    id: 'A5',
    title,
    refuses,
    status: problems.length === 0 ? 'pass' : 'fail',
    detail:
      problems.length === 0
        ? `filePath ${entry.filePath}, permission grantable, action keys resolve in en and pl ` +
          'through the platform reconciler and translation_bundles'
        : problems.join('; '),
  };
}

// ---------------------------------------------------------------------------
// Phase `boot` — the platform start every later phase stands on
// ---------------------------------------------------------------------------

/**
 * Compose the application once and throw it away.
 *
 * It answers no assertion, and it is not scaffolding either: it is the step an
 * operator's sequence actually has between `pnpm add` and `module:install`. The
 * first boot is what converges `module_registrations` for everything this
 * **build** ships (`loadModulePresence`), so `auth` — which the package declares
 * as a dependency — is installed by the time the install below asks. Without it
 * `install` answers `missing-deps` about a module that has been in the tree all
 * along.
 *
 * It is deliberately **not** what converges the package: D-157.6(b) narrowed
 * that reconciler's insert population to core plus the deployment's overlay,
 * because a boot that marked a package installed before its migrations ran
 * turned `module:install` into a no-op that applied nothing and exited 0. So a
 * boot here must leave the package absent from the platform axis, and the phase
 * says so rather than assuming it — a boot that converged it would make the
 * install below a no-op and every assertion after it a claim about the wrong
 * mechanism.
 */
async function phaseBoot(): Promise<AssertionResult[]> {
  const { composeApp } = await import('../../src/composition.js');
  const { ModuleRegistration } = await import(
    '../../src/kernel/lifecycle/module-registration.entity.js'
  );

  let composition: Awaited<ReturnType<typeof composeApp>>;
  try {
    composition = await composeApp();
  } catch (error) {
    classifyError(error);
  }
  try {
    const converged = await composition.orm.em
      .fork()
      .findOne(ModuleRegistration, { moduleId: MODULE_ID });
    if (converged) {
      throw new Error(
        `the first boot converged "${MODULE_ID}" to state=${converged.state} before anything ` +
          'installed it. D-157.6(b) narrows that reconciler to core plus overlay precisely so ' +
          'that `module:install` still has the work to do',
      );
    }
  } finally {
    await composition.dispose();
  }
  return [];
}

// ---------------------------------------------------------------------------
// Phase `install` — the one author of a package's registration row
// ---------------------------------------------------------------------------

/**
 * `module:install acceptance_probe`, in the shape the CLI script builds it.
 *
 * Since D-157.6(b) this is the **only** author of a package's
 * `module_registrations` row, and step 2 of `install` is the only author of its
 * settings rows — so it is the precondition of both remaining assertions: A6
 * needs the activation Setting to have a row the operator can flip, A7 needs a
 * registration to uninstall. The probe reached neither through any phase, which
 * is why both were red with the platform half of each already working.
 *
 * Composed by nothing, exactly like the real command: a platform command must
 * not compose (D-157.4), because composition's own reconciler would decide the
 * state this command exists to establish.
 */
async function phaseInstall(): Promise<AssertionResult[]> {
  const { initOrm, closeOrm } = await import('../../src/db/index.js');
  const { AuditLogService } = await import('../../src/kernel/audit/audit-log-service.js');
  const { ModuleLifecycleOrchestrator } = await import(
    '../../src/modules/_lifecycle/services/orchestrator.js'
  );
  const { buildStaticRegistry } = await import(
    '../../src/modules/_lifecycle/services/static-registry.js'
  );
  const { resolvedManifestEntries } = await import(
    '../../src/modules/_lifecycle/registered-manifests.js'
  );
  const { enterSystemScope } = await import('../../src/kernel/scope.js');
  const { default: Redis } = await import('ioredis');

  let orm: Awaited<ReturnType<typeof initOrm>>;
  try {
    orm = await initOrm();
  } catch (error) {
    classifyError(error);
  }
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    const em = (): ReturnType<typeof orm.em.fork> => orm.em.fork();
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm,
      redis,
      em,
      auditLog: new AuditLogService(em),
      // Handed over unmapped, the way `composition.ts` hands its own registry
      // over: an identity map here is where the `lifecycleParticipant` a module
      // declares gets silently dropped, and the install would then reconcile no
      // bundle and no palette action while reporting success.
      registry: buildStaticRegistry(await resolvedManifestEntries()),
    });
    const result = await enterSystemScope(
      'acceptance: install the package',
      () => orchestrator.install(MODULE_ID),
      { entryPoint: 'cli' },
    );
    if (result.state !== 'installed') {
      throw new Error(
        `install answered state=${result.state}; the package was expected to be installed by ` +
          'this command and by nothing before it',
      );
    }
    return [];
  } finally {
    redis.disconnect();
    await closeOrm().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Phase `gate-off` / `gate-on` — A6, plus A5's "enforced" quarter
// ---------------------------------------------------------------------------

/**
 * Compose the whole application with the module's activation Setting in a known
 * state and inject one request at its route.
 *
 * The Setting is written **before** composition, so what is measured is the
 * platform's answer to "this module is off", not the propagation of a flip.
 */
async function phaseGate(active: boolean): Promise<AssertionResult[]> {
  const { initOrm, closeOrm } = await import('../../src/db/index.js');
  const { Setting } = await import('../../src/kernel/settings/setting.entity.js');
  const { enterSystemScope } = await import('../../src/kernel/scope.js');

  let settingWritten = false;
  let orm: Awaited<ReturnType<typeof initOrm>>;
  try {
    orm = await initOrm();
  } catch (error) {
    classifyError(error);
  }
  try {
    await enterSystemScope(
      'acceptance: set activation',
      async () => {
        const em = orm.em.fork();
        const setting = await em.findOne(Setting, { code: ACTIVATION_SETTING });
        if (setting) {
          setting.globalValue = active;
          await em.flush();
          settingWritten = true;
        }
      },
      { entryPoint: 'cli' },
    );
  } finally {
    await closeOrm().catch(() => undefined);
  }

  if (!settingWritten) {
    return [
      {
        id: 'A6',
        title: 'switching the module off makes its route answer 503 MODULE_DISABLED',
        refuses: 'a package that is not an ordinary lifecycle participant (Principle XVII)',
        status: 'fail',
        detail:
          `no settings row "${ACTIVATION_SETTING}" exists, so the operator has no control to ` +
          'flip. Step 2 of `install` reconciles the manifest that declares it, and `install` is ' +
          "a package's only author since D-157.6(b) — so either the install phase did not run " +
          'or it reconciled nothing',
      },
    ];
  }

  const { composeApp } = await import('../../src/composition.js');
  const { buildServer } = await import('../../src/http/server.js');
  const composition = await composeApp();
  try {
    const app = await buildServer({
      sessionCookieSecret: 'acceptance-secret',
      openApi: {
        title: 'Acceptance probe',
        version: '0.0.0',
        serverUrl: 'http://localhost:3001',
      },
      modules: composition.modules,
      errorEnvelope: composition.errorEnvelope,
      apiInterceptors: composition.apiInterceptors,
      disableRateLimit: true,
    });
    try {
      const response = await app.inject({ method: 'GET', url: ROUTE });
      const body = response.body;
      const results: AssertionResult[] = [];
      if (!active) {
        const disabled = response.statusCode === 503 && body.includes('MODULE_DISABLED');
        results.push({
          id: 'A6',
          title: 'switching the module off makes its route answer 503 MODULE_DISABLED',
          refuses: 'a package that is not an ordinary lifecycle participant (Principle XVII)',
          status: disabled ? 'pass' : 'fail',
          detail: `${ROUTE} answered ${response.statusCode} with ${body.slice(0, 200)}`,
        });
      } else {
        const restored = response.statusCode !== 503 && response.statusCode !== 404;
        results.push({
          id: 'A6',
          title: 'switching it back on restores the route',
          refuses: 'an "off" that is destructive rather than reversible',
          status: restored ? 'pass' : 'fail',
          detail: `${ROUTE} answered ${response.statusCode} with ${body.slice(0, 200)}`,
        });
        results.push({
          id: 'A5',
          title: "the package's permission is enforced on its own route",
          refuses: 'a permission that is grantable but gates nothing',
          status: response.statusCode === 401 || response.statusCode === 403 ? 'pass' : 'fail',
          detail:
            `an anonymous GET ${ROUTE} answered ${response.statusCode}; ` +
            'the route must exist and refuse a caller holding no permission',
        });
      }
      return results;
    } finally {
      await app.close();
    }
  } finally {
    await composition.dispose();
  }
}

// ---------------------------------------------------------------------------
// Phase `uninstall` — A7
// ---------------------------------------------------------------------------

/**
 * A hard uninstall must revert the package's migration and drop its table, and
 * revert **nothing else**: ownership is what has to survive publication, so the
 * count of remaining migrations is part of the assertion rather than an aside.
 */
async function phaseUninstall(): Promise<AssertionResult[]> {
  const { initOrm, closeOrm } = await import('../../src/db/index.js');
  const { AuditLogService } = await import('../../src/kernel/audit/audit-log-service.js');
  const { ModuleLifecycleOrchestrator } = await import(
    '../../src/modules/_lifecycle/services/orchestrator.js'
  );
  const { buildStaticRegistry } = await import(
    '../../src/modules/_lifecycle/services/static-registry.js'
  );
  const { resolvedManifestEntries } = await import(
    '../../src/modules/_lifecycle/registered-manifests.js'
  );
  const { enterSystemScope } = await import('../../src/kernel/scope.js');
  const { configuredMigrations } = await import('../../src/db/configured-migrations.js');
  const { default: Redis } = await import('ioredis');

  const title = 'a hard uninstall reverts exactly the package\'s migration';
  const refuses = 'a package whose schema the host cannot give back';

  let orm: Awaited<ReturnType<typeof initOrm>>;
  try {
    orm = await initOrm();
  } catch (error) {
    classifyError(error);
  }
  const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    const entries = await resolvedManifestEntries();
    if (!entries.some((e) => e.manifest.id === MODULE_ID)) {
      return [
        {
          id: 'A7',
          title,
          refuses,
          status: 'fail',
          detail:
            `the lifecycle registry has no module "${MODULE_ID}", so there is nothing to ` +
            'uninstall and no owner for the migration to be reverted by',
        },
      ];
    }
    const em = (): ReturnType<typeof orm.em.fork> => orm.em.fork();
    const orchestrator = new ModuleLifecycleOrchestrator({
      orm,
      redis,
      em,
      auditLog: new AuditLogService(em),
      // Handed over unmapped, the way `composition.ts` hands its own registry
      // over: an identity map here is where a field added to
      // `RegisteredManifestEntry` later gets silently dropped, and one already
      // was — this spread predated `lifecycleParticipant`, so the hard uninstall
      // below removed the package's schema and left its translation bundles and
      // palette actions behind, which is the one case D-159 §7 records as having
      // no other cure.
      registry: buildStaticRegistry(entries),
      // The merged ownership, exactly as a composition root supplies it. Left
      // out, the orchestrator answers from the committed core registry and
      // refuses to hard-uninstall a package it cannot enumerate — which is the
      // correct refusal, and would make A7 measure the refusal rather than the
      // revert.
      migrationOwnership: (await configuredMigrations()).ownership,
    });
    const before = (
      (await orm.em.fork().execute('select count(*)::int as n from mikro_orm_migrations')) as Array<{
        n: number;
      }>
    )[0]?.n;
    await enterSystemScope(
      'acceptance: hard uninstall',
      () => orchestrator.uninstall(MODULE_ID, { hard: true }),
      { entryPoint: 'cli' },
    );
    const fork = orm.em.fork();
    const after = (
      (await fork.execute('select count(*)::int as n from mikro_orm_migrations')) as Array<{
        n: number;
      }>
    )[0]?.n;
    const stillApplied = (await fork.execute(
      'select name from mikro_orm_migrations where name = ?',
      [MIGRATION_CLASS],
    )) as Array<{ name: string }>;
    const stillThere = (await fork.execute(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = ?",
      [TABLE],
    )) as Array<{ table_name: string }>;
    const reverted = (before ?? 0) - (after ?? 0);
    const ok = stillApplied.length === 0 && stillThere.length === 0 && reverted === 1;
    return [
      {
        id: 'A7',
        title,
        refuses,
        status: ok ? 'pass' : 'fail',
        detail: `reverted ${reverted} migration(s); migration row ${
          stillApplied.length === 0 ? 'gone' : 'still present'
        }; table ${stillThere.length === 0 ? 'dropped' : 'still present'}`,
      },
    ];
  } finally {
    redis.disconnect();
    await closeOrm().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Phase `overlay-decoration` — A10
// ---------------------------------------------------------------------------

/**
 * Compose the platform as the `acceptance` **deployment** and ask what it says
 * when one of its overlay modules wraps a name the installed package registered.
 *
 * **What this assertion claims moved with D-176 Q3, and the phase with it.** It
 * used to ask whether the wrap *applies*, and answered `fail`: the composition
 * root registers `[...MODULES, ...overlay, ...packages]`, so the deployment's
 * module reached `ctx.di.decorate` before the package had registered anything
 * and `hasRegistration` refused. That was an accident of array order, not a
 * decision — and D-176's drain removes it, because a decoration is now applied
 * after the last module has registered.
 *
 * The owner then ruled the capability itself: **a per-deployment overlay may not
 * decorate a registration an installed package owns**, because nothing in a
 * package's `exports` map publishes the container names it registers internally,
 * so there is no declared surface for the wrap to be written against. So this
 * phase asserts the **refusal, with its reason** — `fail` said "this is broken"
 * where the tree's position is "this is not offered yet", and the drain would
 * otherwise have granted the capability silently.
 *
 * The mechanism around it is unchanged and is what makes the refusal meaningful
 * rather than vacuous: an overlay module is exempt from the ownership rule
 * (`overlay: true`, set by `loadOverlayModuleEntries` from the root the module
 * was discovered under — never a claim a module makes about itself, issue #203),
 * and it still wraps anything **core** registers. `test/overlay/`'s T-A / T-A′ /
 * T-A″ hold those three halves apart without a tarball.
 *
 * It runs with `DEPLOYMENT` set for this phase alone. Every other phase composes
 * bare core, so the nine assertions around it measure exactly what they measured
 * before this one existed — and the deployment is a real one in this
 * repository's tree, not a fixture the harness writes, because the whole point
 * is that the platform's own overlay resolution finds it.
 *
 * **Four outcomes, and every one of them is the platform's answer.** The
 * composition refuses with the ruled refusal (`pass`); it refuses with something
 * else (`fail` — a refusal for another reason is not this one); the registration
 * is missing altogether (`fail` — the package's own `ctx.di.register` did not
 * reach the container, so there was nothing to refuse); or composition
 * **succeeds**, which splits in two and both are `fail`: the name resolves
 * decorated, meaning the capability the owner declined was granted, or it
 * resolves undecorated, meaning the wrap did not apply and **no exception
 * announced it**.
 *
 * That last one is the verdict no error message can ever produce, and it is the
 * reason the four are kept apart (!967 measured all four). It is the shape a
 * silent regression takes: a drain that skipped an entry, an `overlay` marking
 * that stopped being derived, a guard that returned instead of throwing. Keep
 * it whatever else changes here.
 */
async function phaseOverlayDecoration(): Promise<AssertionResult[]> {
  const title = "a deployment's overlay is refused a registration the installed package owns";
  const refuses =
    'a deployment wrapping a container name the package publishes through no export';

  // The deployment has to be **there** before anything it does can be measured.
  // Without this, a renamed or deleted `backend/src/apps/<deployment>/` produces
  // no overlay module, no decoration, and an undecorated resolve — reported in
  // the same words as the finding this assertion exists to report. That is the
  // one way A10 could go red for a reason that is not about the platform, so it
  // is the harness's own failure and leaves as `Inconclusive`.
  const { activeOverlayModulesRoot } = await import('../../src/overlay/overlay-roots.js');
  const overlayRoot = activeOverlayModulesRoot();
  if (overlayRoot === null) {
    throw new Inconclusive(
      `DEPLOYMENT=${process.env['DEPLOYMENT'] ?? '(unset)'} resolves to no overlay modules root, ` +
        'so this phase would measure an absent deployment rather than an absent decoration',
    );
  }

  const { composeApp } = await import('../../src/composition.js');

  let composition: Awaited<ReturnType<typeof composeApp>>;
  try {
    composition = await composeApp();
  } catch (error) {
    // A connection failure is the harness's problem and leaves through
    // `classifyError`; anything else is the platform refusing to compose this
    // deployment, which is exactly what A10 asks about.
    try {
      classifyError(error);
    } catch (classified) {
      if (classified instanceof Inconclusive) throw classified;
      const message = classified instanceof Error ? classified.message : String(classified);
      // The ruled refusal, recognised by the **kernel's own** error name and by
      // the three facts its message has to carry: the registration, the package
      // that owns it and the overlay module that reached for it. Recognised by
      // name rather than by `instanceof` because this process resolves the
      // platform through the instance's own module graph — an identity check
      // would be measuring which copy of the class got loaded, which is not
      // what A10 asks.
      const isTheRuledRefusal =
        classified instanceof Error &&
        classified.name === 'PackageDecorationNotOfferedError' &&
        message.includes(PACKAGE_REGISTRATION) &&
        message.includes(MODULE_ID) &&
        message.includes(OVERLAY_MODULE_ID);
      return [
        {
          id: 'A10',
          title,
          refuses,
          status: isTheRuledRefusal ? 'pass' : 'fail',
          detail: isTheRuledRefusal
            ? `the platform refused the wrap and said why: ${message}`
            : `composing DEPLOYMENT=${process.env['DEPLOYMENT'] ?? '(unset)'} refused for ` +
              `another reason than the ruled one — a refusal naming ` +
              `"${PACKAGE_REGISTRATION}", "${MODULE_ID}" and "${OVERLAY_MODULE_ID}" was ` +
              `expected, and this was: ${message}`,
        },
      ];
    }
    throw error;
  }

  // Composition **succeeded**, which under D-176 Q3 is already the wrong answer.
  // It still splits in two, and the split is the point — the second half is the
  // one verdict no error message can produce.
  try {
    if (!composition.container.hasRegistration(PACKAGE_REGISTRATION)) {
      return [
        {
          id: 'A10',
          title,
          refuses,
          status: 'fail',
          detail:
            `nothing is registered under "${PACKAGE_REGISTRATION}". The package's ` +
            '`registerModule` either did not run or does not register it, so there was ' +
            'nothing for the platform to refuse and this phase measured an absent package ' +
            'rather than an applied rule',
        },
      ];
    }
    const resolved = (composition.container.cradle as unknown as Record<string, unknown>)[
      PACKAGE_REGISTRATION
    ] as { greeting?: () => string } | undefined;
    const greeting = typeof resolved?.greeting === 'function' ? resolved.greeting() : undefined;
    const decorated = greeting === DECORATED_GREETING;
    return [
      {
        id: 'A10',
        title,
        refuses,
        status: 'fail',
        detail: decorated
          ? `${PACKAGE_REGISTRATION} resolves to "${greeting}" — the deployment's wrap applied ` +
            'over a registration an installed package owns, which is the capability D-176 Q3 ' +
            'declines. The refusal is the assertion; granting it silently is what the ' +
            'decoration drain must not do'
          : `${PACKAGE_REGISTRATION} resolves to ${JSON.stringify(greeting)}, the package's own ` +
            `"${UNDECORATED_GREETING}" — so the wrap did not apply and **nothing announced ` +
            'it**. That is neither the ruled refusal nor the declined capability: composition ' +
            'succeeded, the registration is present, and a deployment that wrote a decoration ' +
            'has no way to learn it was dropped',
      },
    ];
  } finally {
    await composition.dispose();
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const phase = process.argv[2];
  try {
    let results: AssertionResult[];
    switch (phase) {
      case 'schema':
        results = await phaseSchema();
        break;
      case 'boot':
        results = await phaseBoot();
        break;
      case 'install':
        results = await phaseInstall();
        break;
      case 'gate-off':
        results = await phaseGate(false);
        break;
      case 'gate-on':
        results = await phaseGate(true);
        break;
      case 'overlay-decoration':
        results = await phaseOverlayDecoration();
        break;
      case 'uninstall':
        results = await phaseUninstall();
        break;
      default:
        throw new Inconclusive(`unknown phase: ${String(phase)}`);
    }
    console.log(`ACCEPTANCE_JSON ${JSON.stringify({ results })}`);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    if (error instanceof Inconclusive) {
      console.log(`ACCEPTANCE_JSON ${JSON.stringify({ inconclusive: message })}`);
    } else {
      console.log(`ACCEPTANCE_JSON ${JSON.stringify({ phaseError: message })}`);
    }
  }
  // The exit code is the runner's to compute; a phase that answered is a phase
  // that succeeded, whatever it answered.
  process.exit(0);
}

// Run as CLI only — importing this module must not boot a platform.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
