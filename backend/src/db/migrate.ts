import { runMigrationCommand } from '@endora-commerce/platform/db';

import { initOrm, closeOrm } from './index.js';

/**
 * Programmatic migration runner — invoked via `tsx src/db/migrate.ts <command>`
 * because the MikroORM CLI does not resolve our ESM TypeScript config out of
 * the box. Supports the CLI commands we actually use.
 *
 *   tsx src/db/migrate.ts up         — apply pending migrations
 *   tsx src/db/migrate.ts down       — revert the most recent migration
 *   tsx src/db/migrate.ts pending    — list pending migrations
 *   tsx src/db/migrate.ts fresh      — drop the public schema and re-apply all
 *                                       migrations from scratch (test / dev only)
 *
 * **The four verbs are `@endora-commerce/platform/db`'s since T116; this is the
 * entry point.** The split is
 * `specs/115-lifecycle-container-move/contracts/operator-half.md` §1.1's, one
 * surface over: a path four `package.json` scripts name — and that production
 * runs as `node dist/db/migrate.js up` — is an operator-facing address, so it
 * stays where the operator's documentation says it is, while the work behind it
 * is the platform's and every instance runs the same four verbs.
 */

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  const orm = await initOrm();

  try {
    const code = await runMigrationCommand(orm, cmd, {
      out: (line) => process.stdout.write(line),
      err: (line) => process.stderr.write(line),
    });
    if (code !== 0) process.exit(code);
  } finally {
    await closeOrm();
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
