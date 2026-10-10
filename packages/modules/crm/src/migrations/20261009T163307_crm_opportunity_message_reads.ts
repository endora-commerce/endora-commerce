import { Migration } from '@mikro-orm/migrations';

/**
 * Which messages of an Opportunity an administrator has not read yet — what the
 * *Messages* tab carries on its label.
 *
 * `crm_opportunity_message_reads` holds one row per administrator and
 * Opportunity: how far that person has read. A child of `crm_opportunities`
 * like the eight others — no tenant column of its own, gone with its
 * Opportunity (`on delete cascade`). `admin_user_id` is a value with no foreign
 * key, as every admin-user reference of this module is, so no other module's
 * table is referenced. The primary key is the whole lookup; there is no other
 * index.
 *
 * `crm_message_read_baselines` holds one row and one instant: when this
 * migration ran. An administrator with no marker for an Opportunity has unread
 * only the messages written after it. Without it, every message already in the
 * database would turn up unread for everybody on the day this ships. Markers
 * cannot be written in advance instead: who may open an Opportunity follows
 * from roles and Organization assignments that belong to other modules and
 * change afterwards, so the pairs cannot be enumerated here — and a row per
 * pair would be most of a cross product nobody reads. On a new installation
 * the instant is before the first message and changes nothing.
 */
export class Migration20261009T163307CrmOpportunityMessageReads extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "crm_opportunity_message_reads" (
        "opportunity_id" uuid not null,
        "admin_user_id" uuid not null,
        "last_read_at" timestamptz not null,
        constraint "crm_opportunity_message_reads_pkey" primary key ("opportunity_id", "admin_user_id"),
        constraint "crm_opportunity_message_reads_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create table "crm_message_read_baselines" (
        "id" smallint not null default 1,
        "unread_since" timestamptz not null,
        constraint "crm_message_read_baselines_pkey" primary key ("id"),
        constraint "crm_message_read_baselines_single_row_check" check ("id" = 1)
      );
    `);
    this.addSql(`insert into "crm_message_read_baselines" ("id", "unread_since") values (1, now());`);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "crm_message_read_baselines" cascade;');
    this.addSql('drop table if exists "crm_opportunity_message_reads" cascade;');
  }
}
