import { Migration } from '@mikro-orm/migrations';
import { defaultHeaderTree } from '@b2b/email-components/defaults/default-header';
import {
  defaultFooterTree,
  envelopeFromTree,
} from '@b2b/email-components/defaults/default-footer';

/**
 * Reseed shared system header/footer block trees (TE + newsletter) from the
 * current `@b2b/email-components` defaults, and clear admin transactional email
 * content overrides so boot reconcile + Reset land on the new simple layouts.
 *
 * Newsletter campaign bodies are left untouched — only the system default
 * header/footer blocks are refreshed (same trees as TE).
 *
 * Numbered **107** (not 099) so it sorts after 100–106. The mis-numbered
 * `Migration099EmailDefaultsReseed` broke `migrator.down()` loops that parse
 * the latest migration ordinal (catalog attributes-migration-parity tests).
 */
const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'] as const;

const TE_HEADER = 'default_email_header';
const TE_FOOTER = 'default_email_footer';
const NL_HEADER = 'newsletter_default_header';
const NL_FOOTER = 'newsletter_default_footer';

function jsonbLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/'/g, "''");
}

export class Migration107EmailDefaultsReseed extends Migration {
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

    this.addSql(
      `update "newsletter_email_blocks" set "content" = '${headerJson}'::jsonb, "version" = "version" + 1, "updated_at" = now() where "code" = '${NL_HEADER}' and "is_system" = true;`,
    );
    this.addSql(
      `update "newsletter_email_blocks" set "content" = '${footerJson}'::jsonb, "version" = "version" + 1, "updated_at" = now() where "code" = '${NL_FOOTER}' and "is_system" = true;`,
    );

    // Drop admin overrides so editors see the refreshed module defaults.
    this.addSql('delete from "transactional_email_contents";');
  }

  override async down(): Promise<void> {
    // Content overrides cannot be restored; block trees stay at the reseeded
    // shape (same as up). No destructive schema change to roll back.
  }
}
