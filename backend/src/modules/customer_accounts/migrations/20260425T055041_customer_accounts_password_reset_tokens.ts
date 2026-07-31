import { Migration } from '@mikro-orm/migrations';

export class Migration20260425T055041CustomerAccountsPasswordResetTokens extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "password_reset_tokens" (
        "id" uuid not null,
        "customer_account_id" uuid not null,
        "token_hash" varchar(128) not null,
        "expires_at" timestamptz not null,
        "consumed_at" timestamptz null,
        "created_at" timestamptz not null,
        constraint "password_reset_tokens_pkey" primary key ("id"),
        constraint "password_reset_tokens_token_hash_unique" unique ("token_hash"),
        constraint "password_reset_tokens_customer_fk" foreign key ("customer_account_id")
          references "customer_accounts" ("id") on delete cascade
      );
    `);
    this.addSql('create index "password_reset_tokens_customer_account_id_index" on "password_reset_tokens" ("customer_account_id");');
    this.addSql('create index "password_reset_tokens_expires_at_index" on "password_reset_tokens" ("expires_at");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "password_reset_tokens" cascade;');
  }
}
