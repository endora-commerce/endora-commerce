/**
 * Backfill `quote_requests.sales_channel_id` — feature 005 / T060.
 *
 * Migration 025 added the column nullable so the deploy didn't depend
 * on the boot-time reconciler having run. Once the platform's
 * system-default channel is in place (DefaultChannelReconciler), this
 * script sets every NULL row's `sales_channel_id` to that channel's
 * id and then flips the column to `NOT NULL` (the actual ALTER lives
 * in the next regular schema migration; this script only writes data
 * so it can run safely against a live DB without coordinated
 * downtime).
 *
 * Run via `tsx src/modules/sales_channels/scripts/backfill-quote-channel.ts`.
 *
 * Idempotent: re-running this script after every NULL row has been
 * filled is a no-op (it returns `{ rowsUpdated: 0 }`).
 */

import { initOrm, closeOrm } from '../../../db/index.js';

interface BackfillResult {
  systemDefaultId: string | null;
  rowsScanned: number;
  rowsUpdated: number;
}

export async function backfillQuoteChannel(): Promise<BackfillResult> {
  const orm = await initOrm();
  try {
    const em = orm.em.fork();
    const conn = em.getConnection();

    const defaults = await conn.execute<Array<{ id: string }>>(
      `select "id" from "sales_channels" where "system_default" = true limit 1`,
    );
    const systemDefaultId = defaults[0]?.id ?? null;
    if (!systemDefaultId) {
      throw new Error(
        '[backfill-quote-channel] No system-default sales channel found. ' +
          'Run `pnpm --filter backend run dev` once (or invoke the boot-time ' +
          'DefaultChannelReconciler manually) before running this script.',
      );
    }

    const counts = await conn.execute<Array<{ total: string; missing: string }>>(
      `select count(*)::text as total, ` +
        `       count(*) filter (where "sales_channel_id" is null)::text as missing ` +
        `  from "quote_requests"`,
    );
    const total = Number(counts[0]?.total ?? '0');
    const missing = Number(counts[0]?.missing ?? '0');

    if (missing === 0) {
      return { systemDefaultId, rowsScanned: total, rowsUpdated: 0 };
    }

    await conn.execute(
      `update "quote_requests" set "sales_channel_id" = ? where "sales_channel_id" is null`,
      [systemDefaultId],
    );

    return { systemDefaultId, rowsScanned: total, rowsUpdated: missing };
  } finally {
    await closeOrm();
  }
}

// CLI entrypoint when invoked via `tsx`.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  backfillQuoteChannel()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[backfill-quote-channel] system_default=${result.systemDefaultId} ` +
          `scanned=${result.rowsScanned} updated=${result.rowsUpdated}`,
      );
      process.exit(0);
    })
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[backfill-quote-channel] failed:', err);
      process.exit(1);
    });
}
