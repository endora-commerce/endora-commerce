import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  runUninstallCommand,
  type OperatorRuntime,
} from '@endora-commerce/platform/lifecycle';
import { initOrm, closeOrm } from '../../db/index.js';
// A platform command composes nothing (D-157.2), so the merged ownership a
// composition root builds is not available to it: it answers for the committed
// core registry and for nothing else, and a hard uninstall of a package module
// is refused from the terminal rather than reverting core's rows and leaving the
// package's behind. The map is read from this build's generated migration
// registry, which is a fact about this tree — so it is supplied to the command
// rather than reached for by it.
import { coreMigrationOwnership } from '../../db/configured-migrations.js';
import { resolvedManifestEntries } from '../registered-manifests.js';
import { enterSystemScope } from '../../kernel/scope.js';

/**
 * `pnpm --filter backend run module:uninstall <module-id> [--hard] [--force] [--json]`
 *
 * The **wiring**, and nothing else (`specs/115-lifecycle-container-move/`,
 * D115-1; `contracts/operator-half.md` §2). The argv grammar, the soft/hard
 * distinction, the exit-code table — the `non-deactivatable` refusal at 77
 * included (D-69) — and every sentence an operator reads are
 * `@endora-commerce/platform/lifecycle`'s since Phase 5.
 *
 * This file keeps its path (R2.3, R2.5): `backend/package.json` runs it, the
 * CLI contract test and `uninstall-hard-needs-force.integration.test.ts` spawn
 * it, and `check:entry-scope` counts it among ten declared programs.
 */

async function main(): Promise<number> {
  let entries;
  try {
    // D-157.6(a) — the **instance-resolved** set: core, this deployment's
    // overlay modules and every installed Endora module package. It used to be
    // bare-core `REGISTERED_MANIFESTS`, so `module:uninstall <package id>`
    // answered `unknown module` while `/platform/modules`, fed the resolved
    // set, uninstalled the same module. Resolved directly rather than through a
    // composition: a platform command must not compose (D-157.2).
    //
    // It also carries the **lifecycle participants** (T036a / D-159): the
    // reconcile that keeps `translation_bundles` and `module_actions` aligned
    // with the manifest set is declared by `_i18n` and `admin_actions` in their
    // own `manifest.ts` and collected from this registry.
    entries = await resolvedManifestEntries();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[manifest] ${msg}\n`);
    return 65;
  }

  const orm = await initOrm();
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
  const runtime: OperatorRuntime = {
    orm,
    em: (): EntityManager => orm.em.fork() as EntityManager,
    redis,
    entries,
    migrationOwnership: () => Promise.resolve(coreMigrationOwnership()),
    out: (line) => void process.stdout.write(line),
    err: (line) => void process.stderr.write(line),
  };

  try {
    return await runUninstallCommand(process.argv.slice(2), runtime);
  } finally {
    redis.disconnect();
    await closeOrm();
  }
}

void enterSystemScope('cli: uninstall a module', main, { entryPoint: 'cli' }).then((code) => {
  process.exit(code);
});
