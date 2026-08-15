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
 * `SettingsService.get` route, platform-wide (neither is per-storefront).
 * Both are seeded by the module-lifecycle ManifestReconciler from
 * `backend/src/modules/carts/manifest.ts`; when either is missing this
 * script uses the manifest's own default rather than a literal of its own.
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
import { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import {
  SettingsService,
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
} from '../../../kernel/settings/settings.service.js';
import { CartAuditService } from '../services/cart-audit-service.js';
import { CartAbandonmentWorker } from '../services/cart-abandonment-worker.js';
import {
  CARTS_SETTING_CODES,
  DEFAULT_ABANDONMENT_INACTIVITY_MINUTES,
  DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT,
} from '../manifest.js';
import { enterSystemScope } from '../../../kernel/scope.js';

interface SweepResult {
  abandonedCount: number;
  notifiedCount: number;
}

/**
 * A CLI run is one pass and then exits, so "once per process" is "once" — the
 * warn is still worth emitting, because an operator running the sweep by hand
 * is precisely the person who needs to be told the threshold did not come from
 * the setting they configured.
 */
async function readPlatformSetting<T>(
  settings: SettingsService,
  code: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    return await settings.get(code, null, schema);
  } catch (error) {
    if (error instanceof SettingNotRegistered) return fallback;
    if (error instanceof SettingOutOfScopeForChannel) {
      console.warn(
        `[cart-abandonment-sweep] setting "${code}" is scoped to specific sales ` +
          `channels, so it has no platform-wide value — using the manifest default.`,
      );
      return fallback;
    }
    throw error;
  }
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
      /**
       * Platform-wide reads, degrading to the manifest's own defaults — the
       * same two conditions `carts/backend.ts` absorbs, for the same reasons
       * (feature 072, D-41/D-43). Both used to pass the literal `'default'`,
       * a channel **code** against a `uuid` column, and both used to fall back
       * to `0`, which the worker reads as "sweep nothing".
       *
       * This script builds a bare `SettingsService` with no channel resolution
       * at all, which is exactly the case the platform-wide read exists for:
       * the sentinel was standing in for a read tier that had no spelling.
       */
      resolveInactivityMinutes: async () =>
        readPlatformSetting(
          settings,
          CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
          z.number().int().nonnegative(),
          DEFAULT_ABANDONMENT_INACTIVITY_MINUTES,
        ),
      resolveNotificationRecipient: async () =>
        readPlatformSetting(
          settings,
          CARTS_SETTING_CODES.ABANDONMENT_NOTIFICATION_RECIPIENT,
          z.string(),
          DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT,
        ),
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
