import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  attachEscapeHatchAuditWriter,
  runEnableCommand,
  type OperatorResources,
  type OperatorRuntime,
} from '@endora-commerce/platform/lifecycle';
import { initOrm, closeOrm } from '../../db/index.js';
import { resolvedManifestEntries } from '../registered-manifests.js';
import { enterSystemScope } from '../../kernel/scope.js';

/**
 * `pnpm --filter backend run module:enable <module-id> [--json]`
 *
 * The **wiring**, and nothing else (`specs/115-lifecycle-container-move/`,
 * D115-1; `contracts/operator-half.md` §2). The argv grammar, the exit-code
 * table and the operator's output are
 * `@endora-commerce/platform/lifecycle`'s since Phase 5; this file keeps its
 * path (R2.3, R2.5) so `backend/package.json`, the CLI contract test and
 * `check:entry-scope`'s declared-program source all keep naming it.
 */

/**
 * Cross-organisation access is audited in the database (owner decision of
 * 2026-10-03). This command never composes, so it attaches the writer itself,
 * before the system scope below is entered, and writes through the database
 * `resources()` opens — only if it opens one: a run that answered out of argv
 * alone read no organisation's data, and its record ends on stderr.
 */
let auditEm: (() => EntityManager) | undefined;
const escapeHatchAudit = attachEscapeHatchAuditWriter({ em: () => auditEm?.() });

async function main(): Promise<number> {
  let entries;
  try {
    // D-157.6(a) — the **instance-resolved** set: core, this deployment's
    // overlay modules and every installed Endora module package. It used to be
    // bare-core `REGISTERED_MANIFESTS`, so a package module's id answered
    // `unknown module` from the terminal while `/platform/modules`, fed the
    // resolved set, enabled the same module. Resolved directly rather than
    // through a composition: a platform command must not compose (D-157.2).
    entries = await resolvedManifestEntries();
  } catch (err) {
    process.stderr.write(`[manifest] ${err instanceof Error ? err.message : String(err)}\n`);
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
      auditEm = opened.em;
      return opened;
    },
    entries,
    out: (line) => void process.stdout.write(line),
    err: (line) => void process.stderr.write(line),
  };

  try {
    return await runEnableCommand(process.argv.slice(2), runtime);
  } finally {
    // The audit records first, while the database they are written to is open.
    await escapeHatchAudit.detach();
    // Close only what was opened: an invocation that answered out of argv or
    // the registry alone has nothing to close.
    if (opened) {
      opened.redis.disconnect();
      await closeOrm();
    }
  }
}

void enterSystemScope('cli: enable a module', main, { entryPoint: 'cli' }).then((code) =>
  process.exit(code),
);
