import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { PluralizingNamingStrategy } from './pluralizing-naming-strategy.js';
import { ALL_ENTITIES } from './entities-registry.js';
import { Migration001FoundationInit } from './migrations/001_foundation_init.js';
import { Migration002QuoteRequestsInit } from '../modules/quote_requests/migrations/002_quote_requests_init.js';
import { Migration003OrganizationsInit } from '../modules/organizations/migrations/003_organizations_init.js';
import { Migration004CommerceInit } from './migrations/004_commerce_init.js';
import { Migration005InvitationsInit } from '../modules/organizations/migrations/005_invitations_init.js';
import { Migration006AdminUsersInit } from '../modules/admin_users/migrations/006_admin_users_init.js';
import { Migration007PasswordResetTokens } from '../modules/customer_accounts/migrations/007_password_reset_tokens.js';
import { Migration008CreditLimitsInit } from '../modules/credit_limits/migrations/008_credit_limits_init.js';
import { Migration009Us7Init } from '../modules/webhooks/migrations/009_us7_init.js';
import { Migration010AnalyticsInit } from '../modules/analytics/migrations/010_analytics_init.js';

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
  // Explicit class list, not a glob — glob discovery requires runtime dynamic
  // `import()` of .ts files, which Node's ESM loader cannot transform and which
  // breaks under Vitest. See src/db/entities-registry.ts for the rationale.
  entities: [...ALL_ENTITIES],
  debug: process.env['NODE_ENV'] === 'development' && process.env['DB_DEBUG'] === 'true',
  allowGlobalContext: false,
  forceUndefined: true,
  extensions: [Migrator],
  migrations: {
    // Explicit migration list — same reasoning as entities above.
    migrationsList: [
      { name: 'Migration001FoundationInit', class: Migration001FoundationInit },
      { name: 'Migration002QuoteRequestsInit', class: Migration002QuoteRequestsInit },
      { name: 'Migration003OrganizationsInit', class: Migration003OrganizationsInit },
      { name: 'Migration004CommerceInit', class: Migration004CommerceInit },
      { name: 'Migration005InvitationsInit', class: Migration005InvitationsInit },
      { name: 'Migration006AdminUsersInit', class: Migration006AdminUsersInit },
      { name: 'Migration007PasswordResetTokens', class: Migration007PasswordResetTokens },
      { name: 'Migration008CreditLimitsInit', class: Migration008CreditLimitsInit },
      { name: 'Migration009Us7Init', class: Migration009Us7Init },
      { name: 'Migration010AnalyticsInit', class: Migration010AnalyticsInit },
    ],
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: false,
  },
});
