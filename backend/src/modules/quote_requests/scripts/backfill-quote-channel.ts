/**
 * Backfill `quote_requests.sales_channel_id` — feature 005 / T060.
 *
 * Migration `20260430T170044_core_sales_channels_promote` added the column
 * nullable so the deploy didn't depend on the boot-time reconciler having run.
 * Once the platform's system-default channel is in place
 * (DefaultChannelReconciler), this script sets every NULL row's
 * `sales_channel_id` to that channel's id and then flips the column to
 * `NOT NULL` (the actual ALTER lives in the next regular schema migration; this
 * script only writes data so it can run safely against a live DB without
 * coordinated downtime).
 *
 * Run via `tsx src/modules/quote_requests/scripts/backfill-quote-channel.ts`.
 *
 * Idempotent: re-running this script after every NULL row has been
 * filled is a no-op (it returns `{ rowsUpdated: 0 }`).
 *
 * ---
 *
 * **It lives here, and it used to live in `sales_channels` (feature 075, D-87).**
 * It reads one table and writes one table, and that table belongs to this
 * module; from the other side it was a raw `update "quote_requests"` in another
 * module's directory, invisible to the import-level boundary check because SQL
 * names no specifier. Nothing about it is a channel administration task — the
 * only thing it wants from `sales_channels` is the system-default channel, and
 * that is the kernel's row, read here through the kernel's own entity.
 *
 * **Read the second half of T060 before running it.** The follow-up this script
 * was staged for never landed: `QuoteRequest` has no property for the
 * column, so nothing on the request path has ever written it, and no migration
 * flipped it `not null`. Every request created since 2026-04-30 carries `null`.
 * That makes this script's `missing` count the whole table rather than a legacy
 * tail, and running it would not backfill an attribution — it would invent one,
 * stamping every request ever raised with the system default regardless of
 * where it actually came from, and then the FR-006 channel-delete guard would
 * start refusing on evidence the platform made up. Record the channel on the
 * request first.
 */

import { initOrm, closeOrm } from '../../../db/index.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import { enterSystemScope } from '../../../kernel/scope.js';

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

    // The kernel's own entity, not `select "id" from "sales_channels"`
    // (feature 075, D-87). `sales_channels` is the kernel's table since feature
    // 072 moved the resolution machinery there, and a module relating into the
    // kernel by ORM is the sanctioned access.
    const systemDefault = await em.findOne(SalesChannel, { systemDefault: true });
    const systemDefaultId = systemDefault?.id ?? null;
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
  enterSystemScope('cli: backfill quote sales channels', backfillQuoteChannel, { entryPoint: 'cli' })
    .then((result) => {
       
      console.warn(
        `[backfill-quote-channel] system_default=${result.systemDefaultId} ` +
          `scanned=${result.rowsScanned} updated=${result.rowsUpdated}`,
      );
      process.exit(0);
    })
    .catch((err: unknown) => {
       
      console.error('[backfill-quote-channel] failed:', err);
      process.exit(1);
    });
}
