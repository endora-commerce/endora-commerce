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
 */

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  const orm = await initOrm();
  const migrator = orm.getMigrator();

  try {
    switch (cmd) {
      case 'up': {
        const applied = await migrator.up();
        process.stdout.write(`applied ${applied.length} migration(s)\n`);
        for (const m of applied) process.stdout.write(`  + ${m.name}\n`);
        break;
      }
      case 'down': {
        const reverted = await migrator.down();
        process.stdout.write(`reverted ${reverted.length} migration(s)\n`);
        for (const m of reverted) process.stdout.write(`  - ${m.name}\n`);
        break;
      }
      case 'pending': {
        const pending = await migrator.getPendingMigrations();
        if (pending.length === 0) {
          process.stdout.write('no pending migrations\n');
        } else {
          for (const m of pending) process.stdout.write(`  ~ ${m.name}\n`);
        }
        break;
      }
      case 'fresh': {
        const schemaGen = orm.getSchemaGenerator();
        await schemaGen.dropSchema({ dropMigrationsTable: true });
        const applied = await migrator.up();
        process.stdout.write(`dropped and re-applied ${applied.length} migration(s)\n`);
        break;
      }
      default: {
        process.stderr.write(`unknown command: ${cmd}\n`);
        process.exit(1);
      }
    }
  } finally {
    await closeOrm();
  }
}

void main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
