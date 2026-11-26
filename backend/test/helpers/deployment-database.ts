import { MikroORM, type Options } from '@mikro-orm/postgresql';
import { mikroOrmConfigFrom } from '@endora-commerce/platform/db';
import {
  BASE_DATABASE_URL_ENV,
  dropRunDatabase,
  provisionRunDatabase,
} from '@endora-commerce/test-kit/database';

import { configuredEntities } from '../../src/db/configured-entities.js';
import { configuredMigrations } from '../../src/db/configured-migrations.js';
import { templateIdentity } from '../template-identity.js';
import { establishPlatformInvariants, establishTaxIdScope } from '../template-seed.js';

/**
 * A database migrated as the deployment `deployment` migrates — its overlay
 * modules' tables included — for the few backend tests that need them
 * (`specs/190-overlay-full-modules/` FR-039, FR-040, T077).
 *
 * The run's own database is bare core: `test/global-setup.ts` migrates the
 * template under whatever `DEPLOYMENT` the run started with, which in every
 * suite leg is none (OR-13 — no `DEPLOYMENT=example` leg is added). A test that
 * needs an overlay module's table selects the deployment **in-process**, and
 * this gives it the deployment's own template: identified by
 * `templateIdentity({ env })`, whose digest includes the overlay migrations as
 * their own origin, so it is a different template from bare core's and every
 * such test shares the one for its deployment — built once, then cloned.
 *
 * It provisions through the kit's `provisionRunDatabase`, the seam the run's own
 * lease takes: the same advisory lock, the same provenance check, the same
 * rebuild when the template's migrations are not this set. The clone it hands
 * back carries the run-database name shape, so the crashed-run sweep collects it
 * if `drop` never runs.
 *
 * **Group the callers.** Each deployment is one more template on the server, and
 * a test that does not need an overlay table must not ask for one — it runs on
 * the run's bare-core database like every other.
 */
export interface DeploymentDatabase {
  readonly name: string;
  readonly url: string;
  /** `process.env` with the deployment selected — what the ORM configuration was read under. */
  readonly env: NodeJS.ProcessEnv;
  /** The deployment's ORM configuration, pointed at this database. */
  readonly config: () => Promise<Options>;
  readonly drop: () => Promise<void>;
}

/** The deployment's configuration — entities and order read under `env` — over `url`. */
async function configFor(env: NodeJS.ProcessEnv, url: string): Promise<Options> {
  const [entities, migrations] = await Promise.all([configuredEntities(env), configuredMigrations(env)]);
  return { ...mikroOrmConfigFrom({ entities, migrations }), clientUrl: url };
}

/** `migration:up` plus the template seed, exactly as `test/global-setup.ts` builds bare core's. */
async function migrateTemplate(env: NodeJS.ProcessEnv, url: string): Promise<void> {
  const orm = await MikroORM.init(await configFor(env, url));
  try {
    await orm.migrator.up();
    await establishPlatformInvariants(orm);
    await establishTaxIdScope(orm);
  } finally {
    await orm.close(true);
  }
}

export async function deploymentDatabase(deployment: string): Promise<DeploymentDatabase> {
  const baseUrl = process.env[BASE_DATABASE_URL_ENV];
  if (baseUrl === undefined || baseUrl === '') {
    throw new Error(
      `deploymentDatabase('${deployment}'): ${BASE_DATABASE_URL_ENV} is not set, so this ` +
        'invocation has no base to build the deployment\'s template on — it runs under ' +
        '`BACKEND_TEST_ISOLATION=shared` or outside the suite\'s global setup. A test that ' +
        'needs an overlay module\'s table needs the isolated harness.',
    );
  }
  const env: NodeJS.ProcessEnv = { ...process.env, DEPLOYMENT: deployment };
  const run = await provisionRunDatabase({
    baseUrl,
    identity: await templateIdentity({ env }),
    migrateTemplate: (url) => migrateTemplate(env, url),
  });
  return {
    name: run.name,
    url: run.url,
    env,
    config: () => configFor(env, run.url),
    drop: () => dropRunDatabase(baseUrl, run.name, () => {}),
  };
}
