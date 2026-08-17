/**
 * Cart abandonment sweep — feature 027 US5 ops script.
 *
 * Runs one pass of `CartAbandonmentWorker.sweep()` against the live
 * database. Intended to be invoked from a cron job or BullMQ scheduler
 * once the platform ships a generic repeatable-job runner.
 *
 * Currently safe to run manually:
 *   pnpm --filter backend run cart:abandonment-sweep
 *
 * Idempotent: subsequent invocations within the same threshold window
 * are a no-op (the eligibility filter excludes carts that already
 * carry `abandonment_notified_at`).
 *
 * No e-mail dispatch is wired in this CLI variant (operations teams
 * will typically just want to flip status without spam during ops
 * incidents). The HTTP-bootstrap path in `composition.ts` injects the
 * real `dispatchCartAbandonmentNotification` and is what production
 * cron should reach for.
 *
 * ## Why this entry point asks the gate itself (issue #54)
 *
 * It used to run whatever the platform's opinion of `carts` was, because there
 * is nothing here for the gate to hang on: `ctx.routes` / `ctx.worker` /
 * `ctx.subscribe` gate at a registration seam and `providePort` gates at a
 * resolution, and a CLI has none of the three. That is the case
 * `requireModuleEnabled` exists for (Constitution XVII item 3): no port, no
 * request, so presence is **decided before the work**, first, and outside any
 * `try`. The registry cache is loaded from PostgreSQL immediately above it,
 * since nothing else in this process ever would; the activation declarations
 * come from this module's own manifest, which is the only one whose answer this
 * script needs.
 *
 * `carts` declares itself non-deactivatable today, so the refusal below is
 * currently reachable only through the platform axis — a deployment where
 * `module_registrations` has no `installed` row for it. That is the point of
 * asking rather than assuming: the answer is derived from the manifests and the
 * registry on every run, so the day `carts` becomes switchable this script
 * already honours it.
 *
 * ## What it still does not do
 *
 * It builds its services by hand, so a deployment **decoration** over
 * `cartAuditService` or `cartAbandonmentWorker` does not reach it. Composing the
 * container would fix that and cost more than it buys here: `composeApp()`
 * registers every module, runs every boot hook and starts every queue consumer
 * in the platform, and a one-shot script that then calls `process.exit` would
 * take BullMQ jobs it picked up down with it. The same hand-built shape is what
 * the `module:*` scripts use. What has been removed is the part that was pure
 * duplication: the two settings reads now come from
 * `services/cart-abandonment-settings.ts`, the same file `backend.ts` composes
 * the worker from, so the CLI and the server can no longer disagree about the
 * threshold — which is exactly what they did before D-41/D-43.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { initOrm, closeOrm } from '../../../db/index.js';
import { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { SettingsService } from '../../../kernel/settings/settings.service.js';
import { activationDeclarationsFrom } from '../../../kernel/lifecycle/activation-resolver.js';
import { registryCache } from '../../../kernel/lifecycle/registry-cache.js';
import { requireModuleEnabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import { CartAuditService } from '../services/cart-audit-service.js';
import { CartAbandonmentWorker } from '../services/cart-abandonment-worker.js';
import { abandonmentSettingsReaders } from '../services/cart-abandonment-settings.js';
import { manifest } from '../manifest.js';
import { enterSystemScope } from '../../../kernel/scope.js';

interface SweepResult {
  abandonedCount: number;
  notifiedCount: number;
}

/**
 * The sweep, given an EntityManager factory — everything this script does
 * except owning the ORM.
 *
 * Split out so the presence decision is reachable from a test (issue #54). The
 * exported entry point below opens the ORM through the `initOrm` singleton and
 * closes it, and that singleton is the one the backend test harness also
 * boots — a test calling it would close the server's ORM out from under the
 * rest of the single-fork run.
 */
export async function sweepAbandonedCarts(
  emFactory: () => EntityManager,
): Promise<SweepResult> {
  // Presence, before any work. `loadModulePresence` is `_lifecycle`'s and this
  // module may not import it (Principle I); its two ingredients that matter to
  // a single-module question are kernel-owned and used directly.
  await registryCache.load({
    em: emFactory,
    activationDeclarations: activationDeclarationsFrom([manifest]),
  });
  requireModuleEnabled(manifest.id);

  const auditLog = new AuditLogService(emFactory);
  const cartAudit = new CartAuditService(emFactory, auditLog);

  // No Redis cache in this CLI variant — the sweep runs once and
  // exits; the settings lookups go directly to PostgreSQL.
  const settings = new SettingsService(emFactory);

  const worker = new CartAbandonmentWorker({
    emFactory,
    cartAuditService: cartAudit,
    ...abandonmentSettingsReaders(() => settings),
    // No dispatchNotification — see the file-header comment.
  });

  return worker.sweep();
}

export async function runAbandonmentSweep(): Promise<SweepResult> {
  const orm = await initOrm();
  try {
    // `return await`, not `return`: inside `try { … } finally { … }` a bare
    // `return promise` completes the try block immediately and runs the
    // `finally` while the promise is still in flight, so `closeOrm()` tore the
    // connection pool down under the sweep's first query and every run of this
    // script died with "Knex: Timeout acquiring a connection. The pool is
    // probably full." The await is what makes the `finally` mean "after".
    return await sweepAbandonedCarts(() => orm.em.fork() as EntityManager);
  } finally {
    await closeOrm();
  }
}

// CLI entrypoint when invoked via `tsx`.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  enterSystemScope('cli: cart abandonment sweep', runAbandonmentSweep, { entryPoint: 'cli' })
    .then((result) => {

      console.warn(
        `[cart-abandonment-sweep] abandoned=${result.abandonedCount} ` +
          `notified=${result.notifiedCount}`,
      );
      process.exit(0);
    })
    .catch((err: unknown) => {

      console.error('[cart-abandonment-sweep] failed:', err);
      process.exit(1);
    });
}
