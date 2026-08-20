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
 * **Do not run it. The owner ruled the historical rows are not worth
 * backfilling** (issue #266).
 *
 * The half of T060 this script was staged for is done: `QuoteRequest` maps the
 * column and every request path writes the resolved request channel onto it.
 * The other half — the `NOT NULL` flip — deliberately did not follow, and this
 * script is why it cannot. Nothing wrote the column between 2026-04-30 and
 * #266, so every request raised in that window carries `null` and no record
 * anywhere says which channel it came from. Filling them would not backfill an
 * attribution; it would invent one, stamping each of those requests with the
 * system default regardless of where it actually came from, and the FR-006
 * channel-delete guard would then start refusing on evidence the platform made
 * up. The owner weighed that against a set that is developer data only — there
 * is no production deployment yet — and ruled: start recording, ignore the
 * history.
 *
 * So the script stays, unrun and unextended, as the record of what a `NOT NULL`
 * migration would have to do first and of why nobody should do it. A future
 * deployment that genuinely needs the column non-nullable deletes the null tail
 * or accepts a per-row answer from a source that knows one — not this one.
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
