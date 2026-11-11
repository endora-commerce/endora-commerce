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
 * The language is the production fallback, not an override — an override here
 * once hid a fallback the languages dictionary did not hold. `PLN` rather than the
 * production `EUR` fallback, matching the default currency row
 * `setupBackendServer` seeds, so a fresh database and a warm one describe the
 * same channel.
 */
export async function establishPlatformInvariants(orm: MikroORM): Promise<void> {
  const { DefaultChannelReconciler } = await import(
    '@endora-commerce/platform/composition'
  );
  // `SalesChannel` is a `@GlobalEntity`, so a plain fork is the right EM here:
  // there is no tenant filter to stamp and no request scope to inherit.
  const result = await new DefaultChannelReconciler(
    () => orm.em.fork() as EntityManager,
    undefined,
    { bootstrapDefaults: { code: 'default', currency: 'PLN' } },
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

/**
 * The tax-ID scope the template starts in (`specs/177-tax-id-scope/`, research
 * R-16): `ORGANIZATIONS_TAX_ID_SCOPE=per-tree-root` builds a template in that
 * scope, so every clone of it — and every organizations suite run against one
 * — starts there; unset or `global`, the migrations' own `global` stands.
 *
 * The swap is the scope Command's own statements (`TaxIdScopeService`), run
 * without the Command: there is no operator and nothing to audit in a template.
 * The variable is part of the template's identity (`template-identity.ts`), so
 * a run in one scope never clones a template built in the other.
 */
export const TAX_ID_SCOPE_ENV = 'ORGANIZATIONS_TAX_ID_SCOPE';

export function templateTaxIdScope(env: NodeJS.ProcessEnv = process.env): 'global' | 'per-tree-root' {
  const value = env[TAX_ID_SCOPE_ENV]?.trim();
  if (value === undefined || value === '' || value === 'global') return 'global';
  if (value === 'per-tree-root') return value;
  throw new Error(
    `[test-setup] ${TAX_ID_SCOPE_ENV}="${value}" is not a tax-ID scope: use "global" (the default) or "per-tree-root".`,
  );
}

export async function establishTaxIdScope(orm: MikroORM): Promise<void> {
  const scope = templateTaxIdScope();
  if (scope === 'global') return;
  const { TaxIdScopeService } = await import(
    '../../packages/modules/organizations/src/backend/services/tax-id-scope-service.js'
  );
  // `organization_tax_id_policy` and `organizations` are `@GlobalEntity`
  // tables: a plain fork, no tenant filter to stamp.
  await (orm.em.fork() as EntityManager).transactional(async (em) => {
    const scopes = new TaxIdScopeService(() => em);
    await scopes.applyEnforcement(em, scope);
    await scopes.writePolicy(em, scope, null);
  });
  process.stdout.write(`[test-setup] the template's tax-ID scope is ${scope}\n`);
}

/**
 * The inverse of {@link establishPlatformInvariants}, for a clone of the
 * template that has to be exactly what `migration:up` from empty leaves.
 *
 * The demo files under `test/integration/demo/` drive a real first boot — a
 * boot that creates the system-default channel under the instance's own
 * `DEFAULT_SALES_CHANNEL_CODE`, and whose reconcilers' writes are part of what
 * those files measure — so a channel the template already holds would change
 * their answer. They used to get that state by spawning the migrator into an empty
 * database, 12.5 s per file on the test Postgres (2026-10-20); a clone with
 * this withdrawn is the same state in 0.2 s (`test/helpers/migrated-database.ts`).
 *
 * It lives here, beside what it undoes, so a second invariant added above is a
 * second one withdrawn in the same edit; and it refuses anything it does not
 * recognise rather than deleting it. That the result really is a migrated
 * database is not left to this comment —
 * `test/integration/demo/migrated-clone-parity.test.ts` compares it with one,
 * table by table.
 */
export async function withdrawPlatformInvariants(client: {
  query: (sql: string) => Promise<{ rowCount: number | null; rows: unknown[] }>;
}): Promise<void> {
  const channels = await client.query(
    `select code, system_default from sales_channels order by code`,
  );
  const rows = channels.rows as { code: string; system_default: boolean }[];
  if (rows.length !== 1 || rows[0]!.code !== 'default' || rows[0]!.system_default !== true) {
    throw new Error(
      `[test-setup] a clone of the migration template was expected to hold exactly the ` +
        `system-default channel establishPlatformInvariants seeds ("default"), and holds ` +
        `${JSON.stringify(rows)}. Withdrawing anything else would not leave a migrated database.`,
    );
  }
  await client.query(`delete from sales_channels where code = 'default' and system_default`);
  await withdrawTaxIdScope(client);
}

/**
 * The inverse of {@link establishTaxIdScope}. The migrations leave the
 * installation in `global` (`organizations_tax_id_unique`, policy row
 * `global`); a template built under `ORGANIZATIONS_TAX_ID_SCOPE=per-tree-root`
 * holds the swapped constraint and row, so a clone that must be a migrated
 * database swaps them back — the statements `applyEnforcement` and
 * `writePolicy` run for `global`. A clone holds no organizations, so the unique
 * constraint cannot be refused; a policy that is neither of the two scopes is
 * refused rather than overwritten.
 */
async function withdrawTaxIdScope(client: {
  query: (sql: string) => Promise<{ rowCount: number | null; rows: unknown[] }>;
}): Promise<void> {
  const policy = await client.query(`select scope from organization_tax_id_policy`);
  const scopes = (policy.rows as { scope: string }[]).map((row) => row.scope);
  if (scopes.length === 1 && scopes[0] === 'global') return;
  if (scopes.length !== 1 || scopes[0] !== 'per-tree-root') {
    throw new Error(
      `[test-setup] a clone of the migration template was expected to hold one tax-ID policy row ` +
        `in "global" or "per-tree-root", and holds ${JSON.stringify(scopes)}. Withdrawing anything ` +
        `else would not leave a migrated database.`,
    );
  }
  await client.query(`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint
         where conrelid = 'organizations'::regclass and conname = 'organizations_tax_id_unique'
      ) then
        alter table "organizations" add constraint "organizations_tax_id_unique" unique ("tax_id");
      end if;
      alter table "organizations" drop constraint if exists "organizations_tax_id_one_tree";
    end
    $$;
  `);
  await client.query(
    `update "organization_tax_id_policy" set "scope" = 'global', "updated_at" = now(), "updated_by_admin_user_id" = null where "id"`,
  );
}
