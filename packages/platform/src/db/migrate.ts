import type { MikroORM } from '@mikro-orm/postgresql';

/**
 * The four migration verbs, as a function of an open ORM.
 *
 * The **entry point** stays in the application — `backend/src/db/migrate.ts`,
 * which `db:fresh`, `migration:up`, `migration:down` and `migration:pending`
 * spawn and which production runs as `node dist/db/migrate.js up`. That split is
 * `specs/115-lifecycle-container-move/contracts/operator-half.md` §1.1's, one
 * surface over: a path a `package.json` script names is an operator-facing
 * address, so it stays where the operator's documentation says it is, while the
 * verbs behind it are the platform's and every instance runs the same four.
 *
 * It writes to injected streams and returns an exit code rather than calling
 * `process.exit`, so the entry point owns the process and this owns the work.
 */
export interface MigrationCommandIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export async function runMigrationCommand(
  orm: MikroORM,
  command: string,
  io: MigrationCommandIo,
): Promise<number> {
  const migrator = orm.getMigrator();

  switch (command) {
    case 'up': {
      const applied = await migrator.up();
      io.out(`applied ${applied.length} migration(s)\n`);
      for (const m of applied) io.out(`  + ${m.name}\n`);
      return 0;
    }
    case 'down': {
      const reverted = await migrator.down();
      io.out(`reverted ${reverted.length} migration(s)\n`);
      for (const m of reverted) io.out(`  - ${m.name}\n`);
      return 0;
    }
    case 'pending': {
      const pending = await migrator.getPendingMigrations();
      if (pending.length === 0) {
        io.out('no pending migrations\n');
      } else {
        for (const m of pending) io.out(`  ~ ${m.name}\n`);
      }
      return 0;
    }
    case 'fresh': {
      // Drop the entire schema by name rather than relying on
      // `dropSchema()`, which only removes tables present in the current
      // entity metadata. Tables that exist in the DB but are no longer (or
      // not yet) reflected in metadata — e.g. pivot tables — would survive
      // that path and make Migration001 fail with "relation already exists".
      // A raw `DROP SCHEMA ... CASCADE` guarantees a clean slate.
      const conn = orm.em.getConnection();
      await conn.execute('drop schema public cascade; create schema public;');
      const applied = await migrator.up();
      io.out(`dropped and re-applied ${applied.length} migration(s)\n`);
      return 0;
    }
    default: {
      io.err(`unknown command: ${command}\n`);
      return 1;
    }
  }
}
