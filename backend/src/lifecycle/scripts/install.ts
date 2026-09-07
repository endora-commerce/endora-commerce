import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  runInstallCommand,
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
 * **The manifest set is resolved here, before the ORM is opened** (R2.2): the
 * resolution reads `node_modules` and may raise the module-id collision
 * refusal, and exit 65 is where an operator reads it.
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
    out: (line) => void process.stdout.write(line),
    err: (line) => void process.stderr.write(line),
  };

  try {
    return await runInstallCommand(process.argv.slice(2), runtime);
  } finally {
    redis.disconnect();
    await closeOrm();
  }
}

void enterSystemScope('cli: install a module', main, { entryPoint: 'cli' }).then((code) => {
  process.exit(code);
});
