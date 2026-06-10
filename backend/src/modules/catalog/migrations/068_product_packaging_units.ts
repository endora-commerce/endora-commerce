import { Migration } from '@mikro-orm/migrations';

/**
 * Product packaging units (feature 043) — named ordering units (e.g.
 * "Paleta" = 480 pieces) attached to a product. Unique name per product,
 * positive base quantity, ordered by `position`, with one optional default.
 */
export class Migration068ProductPackagingUnits extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table "product_packaging_units" (
      "id" uuid not null,
      "product_id" uuid not null,
      "name" varchar(160) not null,
      "base_quantity" integer not null,
      "position" integer not null default 0,
      "is_default" boolean not null default false,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "product_packaging_units_pkey" primary key ("id")
    );`);
    this.addSql(
      'alter table "product_packaging_units" add constraint "product_packaging_units_base_quantity_check" check ("base_quantity" >= 1);',
    );
    this.addSql(
      'create index "product_packaging_units_product_id_index" on "product_packaging_units" ("product_id");',
    );
    this.addSql(
      'alter table "product_packaging_units" add constraint "product_packaging_units_product_id_name_unique" unique ("product_id", "name");',
    );
    this.addSql(
      'alter table "product_packaging_units" add constraint "product_packaging_units_product_id_foreign" foreign key ("product_id") references "products" ("id") on update cascade on delete cascade;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "product_packaging_units";');
  }
}
