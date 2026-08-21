/**
 * What a migrated test template holds beyond its schema.
 *
 * This lives in a file of its own, and not in `global-setup.ts` where it was
 * written, because the migration template is keyed by a digest over everything
 * that writes into it (issue #289). Migrations are most of that; this is the
 * rest. A file listed in `TEMPLATE_SEED_SOURCES` is part of the template's
 * identity, so changing what it seeds gives the next run a different template
 * instead of handing it a database seeded by whichever branch got there first.
 *
 * Keep it small and keep it here: a seeding step added to `global-setup.ts`
 * instead would be invisible to the digest, which is the shape of the defect,
 * not a variation on it.
 */

import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';

/**
 * The invariants a migrated platform has before it serves anything, established
 * here so a test file does not have to depend on another one having run first
 * (issue #159).
 *
 * There is exactly one so far: **a default Sales Channel always exists** (D-47…
 * D-51). Production gets it from the boot reconciler; `setupBackendServer` runs
 * the same reconciler after it truncates `sales_channels`. A file that boots no
 * server — `setupTestDb`, a `.bench.ts` — got it from whichever harness file the
 * runner happened to schedule before it, which is not a guarantee at all: six
 * files wrote `(await findOne(SalesChannel, { systemDefault: true }))?.id ?? ''`
 * and passed on a warm database, and
 * `test/integration/carts/cart-abandonment-worker.integration.test.ts` failed on
 * a fresh one with `invalid input syntax for type uuid: ""`.
 *
 * Migrations deliberately do not seed it — the channel is install-time state,
 * not schema — so the seam is here, immediately after `migrator.up()`, which is
 * the point at which this database becomes a platform every test may assume.
 *
 * `en-US` / `PLN` rather than the production `en` / `EUR` fallbacks, matching the
 * language and currency rows `setupBackendServer` seeds, so a fresh database and
 * a warm one describe the same channel.
 */
export async function establishPlatformInvariants(orm: MikroORM): Promise<void> {
  const { DefaultChannelReconciler } = await import(
    '../src/kernel/sales-channels/default-channel-reconciler.js'
  );
  // `SalesChannel` is a `@GlobalEntity`, so a plain fork is the right EM here:
  // there is no tenant filter to stamp and no request scope to inherit.
  const result = await new DefaultChannelReconciler(
    () => orm.em.fork() as EntityManager,
    undefined,
    { bootstrapDefaults: { code: 'default', language: 'en-US', currency: 'PLN' } },
  ).run();
  if (result.action === 'inserted') {
    process.stdout.write('[test-setup] seeded the system-default sales channel\n');
  }
  if (result.systemDefault === undefined) {
    throw new Error(
      `[test-setup] the system-default sales channel could not be established ` +
        `(reconciler said "${result.action}"${result.warning ? `: ${result.warning}` : ''}). ` +
        `Every test may assume exactly one exists — refusing to start a run without it.`,
    );
  }
}
