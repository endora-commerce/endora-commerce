import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { PluralizingNamingStrategy } from './pluralizing-naming-strategy.js';

/**
 * MikroORM configuration for the B2B platform backend.
 *
 * - PostgreSQL driver (constitutional stack).
 * - Plural snake_case table names + snake_case columns (Principle VI) via the
 *   custom naming strategy in ./pluralizing-naming-strategy.ts (R-04).
 * - Each module owns its own migrations under
 *   src/modules/<module>/migrations/. This config globs them so modules plug in
 *   without editing a shared registry.
 * - Entities glob works the same way — a new module under src/modules/ is
 *   discovered without touching this file.
 */

const databaseUrl =
  process.env['DATABASE_URL'] ?? 'postgresql://b2b:b2b@localhost:5432/b2b';

export default defineConfig({
  clientUrl: databaseUrl,
  namingStrategy: PluralizingNamingStrategy,
  entities: ['./dist/modules/**/entities/*.js'],
  entitiesTs: ['./src/modules/**/entities/*.ts'],
  debug: process.env['NODE_ENV'] === 'development' && process.env['DB_DEBUG'] === 'true',
  allowGlobalContext: false,
  forceUndefined: true,
  extensions: [Migrator],
  migrations: {
    path: './dist/modules/**/migrations',
    pathTs: './src/modules/**/migrations',
    glob: '!(*.d).{js,ts}',
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: false,
  },
});
