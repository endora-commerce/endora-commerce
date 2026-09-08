/**
 * The ORM configuration's **binding** — the two merges, the memo and the
 * fourteen callers (`specs/110-instance-repository/` T116;
 * `contracts/instance-repository.md` R7.4).
 *
 * The configuration itself is `@endora-commerce/platform/db`'s since T116: the
 * PostgreSQL driver, the naming strategy Principle VI is enforced by, the
 * explicit entity list, the migrator options and the dependency-cycle warning.
 * None of it varies between two instances.
 *
 * What is here is the wiring that does. The two merges above it read this
 * build's committed registries, which the platform may not name (D-52/D-53), and
 * the memoisation is a fact about one process rather than about the
 * configuration.
 *
 * ## It is a factory, and awaiting it is the caller's job (feature 080, T033)
 *
 * The package half of both registries is discovered at runtime (D-119, confirmed
 * as D-155), which makes the merged configuration a promise — and the export an
 * **async factory** rather than a promise-valued default, so that importing this
 * module (for a type, say) starts no `node_modules` scan and no unhandled
 * rejection.
 *
 * Memoised, so the fourteen callers do not mean fourteen scans. That also pins
 * `DATABASE_URL` to whatever it names at the **first** call, which is the
 * pre-existing behaviour one step later: `test/helpers/test-db.ts` overrides
 * `clientUrl` on the object it gets, and the harness reads the migration order
 * through `configured-migrations.ts` precisely so that reading it costs no
 * connection.
 */
import { mikroOrmConfigFrom } from '@endora-commerce/platform/db';
import type { Options } from '@mikro-orm/postgresql';

import { configuredEntities } from './configured-entities.js';
import { configuredMigrations } from './configured-migrations.js';

let memoised: Promise<Options> | undefined;

export default async function mikroOrmConfig(): Promise<Options> {
  memoised ??= (async (): Promise<Options> => {
    const [entities, migrations] = await Promise.all([
      configuredEntities(),
      configuredMigrations(),
    ]);
    return mikroOrmConfigFrom({ entities, migrations });
  })();
  return memoised;
}
