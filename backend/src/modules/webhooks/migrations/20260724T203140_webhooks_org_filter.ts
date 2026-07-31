import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 062 — org-scoped webhook delivery (data-model.md §3).
 *
 * Adds `webhooks.organization_id uuid NULL`:
 *  - NULL  = platform-wide subscription (legacy semantics preserved, FR-015);
 *  - value = the subscription only receives events whose payload
 *    `organizationId` matches (evaluated in the event-bridge lookup —
 *    research §R9; Principle XI).
 *
 * Existing rows stay NULL and behave exactly as before once delivery turns on.
 */
export class Migration20260724T203140WebhooksOrgFilter extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "webhooks" add column "organization_id" uuid null;`);
    this.addSql(`
      alter table "webhooks"
        add constraint "webhooks_organization_id_foreign"
          foreign key ("organization_id") references "organizations" ("id")
          on update cascade on delete cascade;
    `);
    this.addSql(`create index "webhooks_organization_id_index" on "webhooks" ("organization_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "webhooks_organization_id_index";`);
    this.addSql(`alter table "webhooks" drop constraint if exists "webhooks_organization_id_foreign";`);
    this.addSql(`alter table "webhooks" drop column if exists "organization_id";`);
  }
}
