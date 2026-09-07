import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  runInstallCommand,
  type OperatorResources,
  type OperatorRuntime,
} from '@endora-commerce/platform/lifecycle';
import { initOrm, closeOrm } from '../../db/index.js';
import { resolvedManifestEntries } from '../registered-manifests.js';
import { enterSystemScope } from '../../kernel/scope.js';

/**
 * `pnpm --filter backend run module:install <module-id> [--dry-run] [--json]`
 *
 * The **wiring**, and nothing else (`specs/115-lifecycle-container-move/`,
 * D115-1; `contracts/operator-half.md` §2). The argv grammar, the exit-code
 * table, the orchestrator wiring and every sentence an operator reads are
 * `@endora-commerce/platform/lifecycle`'s since Phase 5: they are platform logic
 * that used to ship to nobody, because this file lives in `backend/src`, which
 * under D-207 a client instance never receives.
 *
 * What is left is what only this tree can answer: which ORM configuration this
 * build has, which Redis this instance talks to, and which module set it ships.
 * A client instance writes the same twenty lines against its own configuration,
 * which it owns regardless.
 *
 * **The path does not move** (R2.3, R2.5). `backend/package.json` still runs
 * this file, the five `test/contract/_lifecycle/cli-*.contract.test.ts` still
 * spawn it, and `check:entry-scope`'s `package-scripts` source still counts ten
 * declared programs. A design that re-pointed the script at a package path would
 * take that source to 5/5 — a 50 % fall against a −10 % band — for no gain in
 * what a client receives.
 *
 * **The manifest set is resolved here, first** (R2.2): the resolution reads
 * `node_modules` and may raise the module-id collision refusal, and exit 65 is
 * where an operator reads it. That sentence read *"before the ORM is opened"*
 * until D115-6, and the edit is not cosmetic — under R2.6 there are invocations
 * in which the ORM is never opened at all, so an ordering stated against it
 * would name an event that does not happen.
 *
 * **This file owns *when* the handles are opened as well as *how*** (R2.6): the
 * resources are a memoised thunk, reached only from the body's
 * `orchestratorFor`, so a usage error, an unknown module id and `--dry-run`
 * answer with no database and no Redis — which is `cli-commands.md` §C-1's own
 * step order, and which makes exit 64 for misuse unconditional rather than
 * conditional on a machine whose database is up.
 */

async function main(): Promise<number> {
  let entries;
  try {
    // D-157.6(a) — the **instance-resolved** set: core, this deployment's
    // overlay modules and every installed Endora module package. It used to be
    // bare-core `REGISTERED_MANIFESTS`, so `module:install <package id>`
    // answered `unknown module` while `/platform/modules`, fed the resolved
    // set, installed the same module. Resolved directly rather than through a
    // composition: a platform command must not compose (D-157.2), because
    // composition's own reconciler would mark the module installed first and
    // turn this command into a no-op.
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

  // Opened on first use and memoised (R2.6). The body calls this from
  // `orchestratorFor` and from nowhere else, at the point where the eager
  // handle used to be read, so a resource failure lands exactly where an
  // awaited `initOrm()` here used to land.
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
    out: (line) => void process.stdout.write(line),
    err: (line) => void process.stderr.write(line),
  };

  try {
    return await runInstallCommand(process.argv.slice(2), runtime);
  } finally {
    // Close only what was opened: an invocation that answered out of argv or
    // the registry alone has nothing to close.
    if (opened) {
      opened.redis.disconnect();
      await closeOrm();
    }
  }
}

void enterSystemScope('cli: install a module', main, { entryPoint: 'cli' }).then((code) => {
  process.exit(code);
});
