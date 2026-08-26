import { Migration } from '@mikro-orm/migrations';

/**
 * D-59 — `email_deliveries`, the first table this module owns.
 *
 * One row per delivery decision, deliberately the `webhook_deliveries` shape
 * (see the entity): no `pending` status, no row before something was attempted,
 * no foreign key — a delivery record has to survive the deletion of whatever it
 * was about, which is exactly when somebody asks about it.
 */
export class Migration20260817T070014EmailDeliveryRecord extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "email_deliveries" (
        "id" uuid not null,
        "message_id" varchar(191) not null,
        "recipient" varchar(320) not null,
        "kind" varchar(64) not null,
        "status" varchar(16) not null,
        "reason" varchar(64) null,
        "detail" varchar(4000) null,
        "subject" varchar(998) null,
        "sales_channel_id" uuid null,
        "document_type" varchar(32) null,
        "document_id" varchar(64) null,
        "context" jsonb null,
        "attempted_at" timestamptz not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "email_deliveries_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "email_deliveries_message_id_index" on "email_deliveries" ("message_id");');
    this.addSql('create index "email_deliveries_recipient_index" on "email_deliveries" ("recipient");');
    this.addSql('create index "email_deliveries_kind_index" on "email_deliveries" ("kind");');
    this.addSql('create index "email_deliveries_status_index" on "email_deliveries" ("status");');
    this.addSql(
      'create index "email_deliveries_document_type_index" on "email_deliveries" ("document_type");',
    );
    this.addSql('create index "email_deliveries_document_id_index" on "email_deliveries" ("document_id");');
    this.addSql('create index "email_deliveries_attempted_at_index" on "email_deliveries" ("attempted_at");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "email_deliveries" cascade;');
  }
}
