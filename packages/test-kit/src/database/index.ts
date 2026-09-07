/**
 * `./database` — the per-invocation database lease (feature 109, R1.1).
 *
 * The cheapest of the kit's subpaths and the one that proves the package
 * shape: the mechanism (issue #189) never had a module coupling, only an
 * application one, and that coupling is now two callbacks the caller supplies.
 *
 * What is published here is the seam plus the naming and selection rules, both
 * halves for the same reason: the two things whose correctness protects the dev
 * database and other people's databases are pure, and a consumer that wants to
 * assert them — as `backend/test/unit/harness/run-isolation.test.ts` does —
 * must be able to name them without a service.
 */

export {
  assertTestDatabaseUrl,
  leaseRunDatabase,
  type RunDatabaseLease,
  type RunDatabaseLeaseInput,
  type TemplateIdentity,
} from './lease.js';

export {
  BASE_DATABASE_URL_ENV,
  ISOLATION_ENV,
  KEEP_DATABASE_ENV,
  STALE_RUN_DATABASE_MS,
  STALE_TEMPLATE_MS,
  SWEEP_LIMIT,
  TEMPLATE_DATABASE_ENV,
  TEMPLATE_DIGEST_LENGTH,
  TEST_DATABASE_NAME_PATTERN,
  advisoryLockKey,
  databaseNameOf,
  formatTemplateProvenance,
  isolationMode,
  keepRunDatabase,
  parseRunDatabaseName,
  parseTemplateDatabaseName,
  parseTemplateProvenance,
  randomRunToken,
  redisUrlNamesDatabase,
  redisUrlWithDatabase,
  runDatabaseName,
  runIdentity,
  sharedDatabaseReason,
  staleTemplates,
  strandedRunDatabases,
  templateDatabaseName,
  templateDigest,
  templateDrift,
  templateFamilyName,
  withDatabase,
  type IsolationMode,
  type StaleTemplateSelection,
  type StrandedSelection,
  type TemplateDrift,
  type TemplateInputs,
  type TemplateProvenance,
  type TemplateSource,
} from './run-isolation.js';

export {
  appliedMigrations,
  cloneTemplateForCaller,
  dropRunDatabase,
  leaseRedisDatabase,
  provisionRunDatabase,
  sweepStaleTemplates,
  sweepStrandedRunDatabases,
  type Log,
  type ProvisionInput,
  type RedisLease,
  type RunDatabase,
} from './provision.js';
