import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 038 (US4) — per-organization additional order-confirmation emails.
 * Owned by the organizations module; read by orders via a port.
 */
export class Migration20260611T140358OrganizationsOrgOrderConfirmationEmails extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "organizations" add column "order_confirmation_emails" jsonb not null default '[]'::jsonb;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "organizations" drop column "order_confirmation_emails";`);
  }
}
