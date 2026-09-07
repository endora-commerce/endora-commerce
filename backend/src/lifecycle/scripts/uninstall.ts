import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  runUninstallCommand,
  type OperatorResources,
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

  // Opened on first use and memoised (R2.6): the `--hard` safety refusal
  // answers above this, so the invocation that most needs to be cheap and
  // certain is the one that opens nothing.
  let opened: OperatorResources | undefined;
  const runtime: OperatorRuntime = {
    resources: async (): Promise<OperatorResources> => {
      if (opened) return opened;
      const orm = await initOrm();
      const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
        lazyConnect: false,
      });
      opened = { orm, em: (): EntityManager => orm.em.fork() as EntityManager, redis };
      return opened;
    },
    entries,
    migrationOwnership: () => Promise.resolve(coreMigrationOwnership()),
    // `confirm` is deliberately not supplied (D115-7, R2.7). Absent means this
    // run cannot ask, so `--hard` requires `--force` — on every invocation of
    // this script, terminal or not, which is what owner ruling **D-217** settled
    // on 2026-09-07. Supplying it here without building a prompt behind it would
    // take `--hard` straight through to reverting migrations and deleting the
    // registry row; `test/integration/_lifecycle/uninstall-hard-needs-force`
    // runs this file with every interactivity signal true and is what says so.
    out: (line) => void process.stdout.write(line),
    err: (line) => void process.stderr.write(line),
  };

  try {
    return await runUninstallCommand(process.argv.slice(2), runtime);
  } finally {
    // Close only what was opened: an invocation that answered out of argv, the
    // registry or the `--hard` refusal alone has nothing to close.
    if (opened) {
      opened.redis.disconnect();
      await closeOrm();
    }
  }
}

void enterSystemScope('cli: uninstall a module', main, { entryPoint: 'cli' }).then((code) => {
  process.exit(code);
});
