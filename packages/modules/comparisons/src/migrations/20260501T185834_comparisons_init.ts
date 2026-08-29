import { Migration } from '@mikro-orm/migrations';

/**
 * Comparisons module — feature 007 / T010 / data-model.md §1.1 + §1.2.
 *
 * Single migration owning both tables of the comparisons module:
 *
 *   - `comparisons` — the Comparison resource. Owner is exclusively a
 *     customer account OR an anonymous browser session (CHECK enforces
 *     mutual exclusivity). `share_token` is a 22-char base64url string
 *     unique across all live comparisons; the share-token endpoint
 *     resolves it in O(1).
 *   - `comparison_products` — ordered bridge between a Comparison and
 *     the Products it holds. Composite PK on (comparison_id, product_id);
 *     `position` defines column order on the comparison page and PDF.
 *     Cascades on both parents: removing a Product removes it from every
 *     Comparison that referenced it; removing a Comparison removes its
 *     bridge rows.
 *
 * Indexing rationale comes from the data model:
 *   - UNIQUE(share_token) supports findByShareToken in O(1) (R-4 share
 *     tokens are unguessable; this is the lookup path).
 *   - Partial indexes on (customer_account_id) WHERE NOT NULL and on
 *     (anonymous_token) WHERE NOT NULL support "find my comparison" for
 *     each owner kind without bloating the index for the unused column.
 *   - (created_at desc) and (sales_channel_id, created_at desc) support
 *     the admin overview's default sort and channel filter (US5).
 */
export class Migration20260501T185834ComparisonsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "comparisons" (
        "id" uuid not null,
        "share_token" varchar(32) not null,
        "customer_account_id" uuid null,
        "anonymous_token" varchar(32) null,
        "sales_channel_id" uuid not null,
        "display_mode" varchar(16) not null default 'all',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "comparisons_pkey" primary key ("id"),
        constraint "comparisons_share_token_uq" unique ("share_token"),
        constraint "comparisons_owner_xor_chk"
          check ((customer_account_id is null) <> (anonymous_token is null)),
        constraint "comparisons_customer_account_fk"
          foreign key ("customer_account_id") references "customer_accounts" ("id")
          on delete cascade,
        constraint "comparisons_sales_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id")
          on delete restrict
      );
    `);

    // Partial owner indexes — only one of the two columns is set per row;
    // partial indexes keep them tight without a useless second key.
    this.addSql(`
      create index "idx_comparisons_owner_customer"
        on "comparisons" ("customer_account_id")
        where "customer_account_id" is not null;
    `);
    this.addSql(`
      create index "idx_comparisons_owner_anon"
        on "comparisons" ("anonymous_token")
        where "anonymous_token" is not null;
    `);

    // Admin overview sort + channel filter (US5).
    this.addSql(`
      create index "idx_comparisons_admin_listing"
        on "comparisons" ("created_at" desc);
    `);
    this.addSql(`
      create index "idx_comparisons_channel_recent"
        on "comparisons" ("sales_channel_id", "created_at" desc);
    `);

    // Bridge — ordered set of products in a comparison.
    this.addSql(`
      create table "comparison_products" (
        "comparison_id" uuid not null,
        "product_id" uuid not null,
        "position" smallint not null,
        "added_at" timestamptz not null default now(),
        constraint "comparison_products_pkey"
          primary key ("comparison_id", "product_id"),
        constraint "comparison_products_comparison_fk"
          foreign key ("comparison_id") references "comparisons" ("id")
          on delete cascade,
        constraint "comparison_products_product_fk"
          foreign key ("product_id") references "products" ("id")
          on delete cascade
      );
    `);

    // Reverse lookup — supports "is this product in any comparison?" and
    // makes the products → CASCADE deletion path efficient.
    this.addSql(`
      create index "idx_comparison_products_product"
        on "comparison_products" ("product_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "comparison_products" cascade;');
    this.addSql('drop table if exists "comparisons" cascade;');
  }
}
