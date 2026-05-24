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
 * Reads the threshold + recipient settings via the existing
 * `SettingsService.get` route (default channel scope). Both settings
 * are seeded by the module-lifecycle ManifestReconciler from
 * `backend/src/modules/carts/manifest.ts`; this script will refuse to
 * run if either is missing (returns `{ abandonedCount: 0 }`).
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
 */

import { z } from 'zod';
import { initOrm, closeOrm } from '../../../db/index.js';
import { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { SettingsService } from '../../settings/services/settings.service.js';
import { CartAuditService } from '../services/cart-audit-service.js';
import { CartAbandonmentWorker } from '../services/cart-abandonment-worker.js';
import { CARTS_SETTING_CODES } from '../manifest.js';

interface SweepResult {
  abandonedCount: number;
  notifiedCount: number;
}

export async function runAbandonmentSweep(): Promise<SweepResult> {
  const orm = await initOrm();
  try {
    const emFactory = (): import('@mikro-orm/postgresql').EntityManager =>
      orm.em.fork() as import('@mikro-orm/postgresql').EntityManager;
    const auditLog = new AuditLogService(emFactory);
    const cartAudit = new CartAuditService(emFactory, auditLog);

    // No Redis cache in this CLI variant — the sweep runs once and
    // exits; the settings lookups go directly to PostgreSQL.
    const settings = new SettingsService(emFactory);

    const worker = new CartAbandonmentWorker({
      emFactory,
      cartAuditService: cartAudit,
      resolveInactivityMinutes: async () => {
        try {
          return await settings.get(
            CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
            'default',
            z.number().int().nonnegative(),
          );
        } catch {
          return 0;
        }
      },
      resolveNotificationRecipient: async () => {
        try {
          return await settings.get(
            CARTS_SETTING_CODES.ABANDONMENT_NOTIFICATION_RECIPIENT,
            'default',
            z.string(),
          );
        } catch {
          return '';
        }
      },
      // No dispatchNotification — see the file-header comment.
    });

    return worker.sweep();
  } finally {
    await closeOrm();
  }
}

// CLI entrypoint when invoked via `tsx`.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runAbandonmentSweep()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[cart-abandonment-sweep] abandoned=${result.abandonedCount} ` +
          `notified=${result.notifiedCount}`,
      );
      process.exit(0);
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[cart-abandonment-sweep] failed:', err);
      process.exit(1);
    });
}
