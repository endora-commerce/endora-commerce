import { Migration } from '@mikro-orm/migrations';
import { randomUUID } from 'crypto';
import {
  DEFAULT_HEADER_BLOCK_CODE,
  defaultHeaderTree,
} from '@b2b/email-components/defaults/default-header';
import {
  DEFAULT_FOOTER_BLOCK_CODE,
  defaultFooterTree,
  envelopeFromTree,
} from '@b2b/email-components/defaults/default-footer';

/**
 * Feature 047 — Transactional Emails.
 *
 * Creates the module schema: email definitions (`transactional_emails`),
 * per-scope/per-language admin customizations (`transactional_email_contents`,
 * with two partial unique indexes since Postgres treats NULL sales_channel_id as
 * distinct), reusable email-safe blocks/templates and their sales-channel
 * bridges, and seeds the system default header/footer blocks (FR-020).
 */
const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'];

function jsonbLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/'/g, "''");
}

export class Migration082TransactionalEmailsInit extends Migration {
  override async up(): Promise<void> {
    // --- Definitions + module defaults -------------------------------------
    this.addSql(`
      create table "transactional_emails" (
        "id" uuid not null,
        "code" varchar(160) not null,
        "name" varchar(200) not null,
        "owner_module" varchar(64) not null,
        "description" text null,
        "group_code" varchar(64) null,
        "variables" jsonb not null default '[]',
        "languages" jsonb not null default '[]',
        "default_subject" jsonb not null default '{}',
        "default_content" jsonb not null default '{}',
        "active" boolean not null default true,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "transactional_emails_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "transactional_emails" add constraint "transactional_emails_code_unique" unique ("code");`,
    );

    // --- Admin customizations (per scope + language) -----------------------
    this.addSql(`
      create table "transactional_email_contents" (
        "id" uuid not null,
        "email_id" uuid not null,
        "sales_channel_id" uuid null,
        "language" varchar(12) not null,
        "subject" text not null,
        "content" jsonb not null default '{}',
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "transactional_email_contents_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "transactional_email_contents" add constraint "tec_email_fk" ` +
        `foreign key ("email_id") references "transactional_emails" ("id") on delete cascade;`,
    );
    this.addSql(
      `create unique index "tec_global_unique" on "transactional_email_contents" ("email_id", "language") where "sales_channel_id" is null;`,
    );
    this.addSql(
      `create unique index "tec_channel_unique" on "transactional_email_contents" ("email_id", "sales_channel_id", "language") where "sales_channel_id" is not null;`,
    );

    // --- Reusable blocks + bridge ------------------------------------------
    this.addSql(`
      create table "email_blocks" (
        "id" uuid not null,
        "code" varchar(180) not null,
        "name" varchar(200) not null,
        "description" text null,
        "active" boolean not null default true,
        "content" jsonb not null default '{}',
        "languages" jsonb not null default '[]',
        "is_system" boolean not null default false,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "email_blocks_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "email_blocks_code_idx" on "email_blocks" ("code");`);
    this.addSql(`
      create table "email_block_sales_channels" (
        "block_id" uuid not null,
        "sales_channel_id" uuid not null,
        "code" varchar(180) not null,
        constraint "email_block_sales_channels_pkey" primary key ("block_id", "sales_channel_id")
      );
    `);
    this.addSql(
      `alter table "email_block_sales_channels" add constraint "ebsc_block_fk" ` +
        `foreign key ("block_id") references "email_blocks" ("id") on delete cascade;`,
    );
    this.addSql(
      `create unique index "ebsc_channel_code_unique" on "email_block_sales_channels" ("sales_channel_id", "code");`,
    );

    // --- Reusable templates + bridge ---------------------------------------
    this.addSql(`
      create table "email_templates" (
        "id" uuid not null,
        "code" varchar(180) not null,
        "name" varchar(200) not null,
        "description" text null,
        "content" jsonb not null default '{}',
        "languages" jsonb not null default '[]',
        "is_system" boolean not null default false,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "email_templates_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "email_templates_code_idx" on "email_templates" ("code");`);
    this.addSql(`
      create table "email_template_sales_channels" (
        "template_id" uuid not null,
        "sales_channel_id" uuid not null,
        "code" varchar(180) not null,
        constraint "email_template_sales_channels_pkey" primary key ("template_id", "sales_channel_id")
      );
    `);
    this.addSql(
      `alter table "email_template_sales_channels" add constraint "etsc_template_fk" ` +
        `foreign key ("template_id") references "email_templates" ("id") on delete cascade;`,
    );
    this.addSql(
      `create unique index "etsc_channel_code_unique" on "email_template_sales_channels" ("sales_channel_id", "code");`,
    );

    // --- Seed system default header + footer blocks (FR-020) ---------------
    const header = envelopeFromTree(defaultHeaderTree(), DEFAULT_LANGUAGES);
    const footer = envelopeFromTree(defaultFooterTree(), DEFAULT_LANGUAGES);
    this.addSql(
      `insert into "email_blocks" ("id", "code", "name", "active", "content", "languages", "is_system", "version", "created_at", "updated_at") ` +
        `values ('${randomUUID()}', '${DEFAULT_HEADER_BLOCK_CODE}', 'Default header', true, '${jsonbLiteral(header)}'::jsonb, '${jsonbLiteral(DEFAULT_LANGUAGES)}'::jsonb, true, 1, now(), now());`,
    );
    this.addSql(
      `insert into "email_blocks" ("id", "code", "name", "active", "content", "languages", "is_system", "version", "created_at", "updated_at") ` +
        `values ('${randomUUID()}', '${DEFAULT_FOOTER_BLOCK_CODE}', 'Default footer', true, '${jsonbLiteral(footer)}'::jsonb, '${jsonbLiteral(DEFAULT_LANGUAGES)}'::jsonb, true, 1, now(), now());`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "email_template_sales_channels" cascade;');
    this.addSql('drop table if exists "email_templates" cascade;');
    this.addSql('drop table if exists "email_block_sales_channels" cascade;');
    this.addSql('drop table if exists "email_blocks" cascade;');
    this.addSql('drop table if exists "transactional_email_contents" cascade;');
    this.addSql('drop table if exists "transactional_emails" cascade;');
  }
}
