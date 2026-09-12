import { Migration } from '@mikro-orm/migrations';
import { defaultHeaderTree } from '@endora-commerce/email-components/defaults/default-header';
import {
  defaultFooterTree,
  envelopeFromTree,
} from '@endora-commerce/email-components/defaults/default-footer';

/**
 * Reseed this module's own system header/footer block trees from the current
 * `@endora-commerce/email-components` defaults, and clear admin transactional email
 * content overrides so boot reconcile + Reset land on the new simple layouts.
 *
 * Timestamped after FROZEN_THROUGH (feature 065) so it sorts after 100–106. The mis-numbered
 * `Migration099EmailDefaultsReseed` broke `migrator.down()` loops that parse
 * the latest migration ordinal (catalog attributes-migration-parity tests).
 *
 * It reseeded `newsletter`'s two system blocks as well, with two `UPDATE`s
 * against `newsletter_email_blocks`, until
 * `specs/120-migration-closure-bridge-ownership/` FR-019 removed them in place.
 * Nothing replaced them here and nothing should: `newsletter` owns that table,
 * and this module declares `activation: { nonDeactivatable: true }`, so naming
 * `newsletter` in its `dependencies` to make the write legal would turn
 * `newsletter`'s activation control into a dead switch. An instance that omits
 * `newsletter` altogether — which the default module set does, it being the
 * `nonDeactivatable` closure — could not migrate at all while they stood. The
 * refresh of an existing database, if anyone wants one, is `newsletter`'s to
 * ship in a `newsletter`-owned migration that needs no cross-module edge.
 */
const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'] as const;

const TE_HEADER = 'default_email_header';
const TE_FOOTER = 'default_email_footer';

function jsonbLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/'/g, "''");
}

export class Migration20260801T111001TransactionalEmailsEmailDefaultsReseed extends Migration {
  override async up(): Promise<void> {
    // Retire the mis-numbered 099 row if a previous deploy already applied it.
    this.addSql(
      `delete from "mikro_orm_migrations" where "name" = 'Migration099EmailDefaultsReseed';`,
    );

    const header = envelopeFromTree(defaultHeaderTree(), DEFAULT_LANGUAGES);
    const footer = envelopeFromTree(defaultFooterTree(), DEFAULT_LANGUAGES);
    const headerJson = jsonbLiteral(header);
    const footerJson = jsonbLiteral(footer);

    this.addSql(
      `update "email_blocks" set "content" = '${headerJson}'::jsonb, "version" = "version" + 1, "updated_at" = now() where "code" = '${TE_HEADER}' and "is_system" = true;`,
    );
    this.addSql(
      `update "email_blocks" set "content" = '${footerJson}'::jsonb, "version" = "version" + 1, "updated_at" = now() where "code" = '${TE_FOOTER}' and "is_system" = true;`,
    );

    // Drop admin overrides so editors see the refreshed module defaults.
    this.addSql('delete from "transactional_email_contents";');
  }

  override async down(): Promise<void> {
    // Content overrides cannot be restored; block trees stay at the reseeded
    // shape (same as up). No destructive schema change to roll back.
  }
}
