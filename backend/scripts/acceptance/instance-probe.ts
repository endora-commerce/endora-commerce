/**
 * The platform half of the package-schema acceptance criterion — the process
 * that boots this repository's backend against a package installed somewhere
 * else, and answers A1 … A7.
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
 * bundle loader, `composeApp()` and the lifecycle orchestrator. None of them is
 * package-aware today, which is why the criterion is red; none of them has to
 * be *changed* for it to go green, which is what makes it a criterion rather
 * than a mirror of one implementation.
 *
 * Contract: `specs/080-f4-real-scope/contracts/package-schema-acceptance.md`.
 */

/* eslint-disable no-console -- this file's stdout is its interface. */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssertionResult } from './assertions.js';

const PACKAGE_NAME = process.env['ACCEPTANCE_PACKAGE_NAME'] ?? '@endora-commerce/mod-acceptance-probe';
const MODULE_ID = 'acceptance_probe';
const TABLE = 'acceptance_probe_rows';
const MIGRATION_CLASS = 'Migration20260821T120000AcceptanceProbeInit';
const ROUTE = '/api/v1/admin/acceptance-probe/ping';
const ACTIVATION_SETTING = 'acceptance_probe.activation';
const PERMISSION = 'acceptance_probe:manage';

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
      const entity = backendEntry['AcceptanceProbeRow'] as (new () => object) | undefined;
      if (!entity) throw new Error(`the package's ./backend export has no AcceptanceProbeRow`);
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

    results.push(await identityAndAssets());
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
 */
async function identityAndAssets(): Promise<AssertionResult> {
  const { resolvedManifestEntries } = await import(
    '../../src/modules/_lifecycle/registered-manifests.js'
  );
  const { PermissionCatalogueService } = await import(
    '../../src/modules/admin_roles/services/permission-catalogue.service.js'
  );
  const { loadModuleBundles } = await import('../../src/modules/_i18n/services/bundle-loader.js');

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
    try {
      const loaded = loadModuleBundles(
        MODULE_ID,
        dirname(entry.filePath),
        entry.manifest.i18n?.bundlesDir ?? 'i18n',
      );
      for (const language of ['en', 'pl'] as const) {
        const bundle = loaded.byLanguage.get(language);
        if (!bundle) {
          problems.push(`no ${language} bundle`);
          continue;
        }
        for (const key of [action.labelKey, action.descriptionKey].filter(
          (k): k is string => typeof k === 'string',
        )) {
          if (!(key in bundle)) problems.push(`${language} bundle has no key ${key}`);
        }
      }
    } catch (error) {
      problems.push(`bundle load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    id: 'A5',
    title,
    refuses,
    status: problems.length === 0 ? 'pass' : 'fail',
    detail:
      problems.length === 0
        ? `filePath ${entry.filePath}, permission grantable, action keys resolve in en and pl`
        : problems.join('; '),
  };
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
          'flip. The row is reconciled from a module manifest at install; no installed package ' +
          'is reconciled',
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
      // `exactOptionalPropertyTypes`: an absent hook is an absent key, not a
      // key holding `undefined` — the same spread the registry's own callers use.
      registry: buildStaticRegistry(
        entries.map((entry) => ({
          manifest: entry.manifest,
          filePath: entry.filePath,
          ...(entry.installHook ? { installHook: entry.installHook } : {}),
          ...(entry.uninstallHook ? { uninstallHook: entry.uninstallHook } : {}),
        })),
      ),
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

async function main(): Promise<void> {
  const phase = process.argv[2];
  try {
    let results: AssertionResult[];
    switch (phase) {
      case 'schema':
        results = await phaseSchema();
        break;
      case 'gate-off':
        results = await phaseGate(false);
        break;
      case 'gate-on':
        results = await phaseGate(true);
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
