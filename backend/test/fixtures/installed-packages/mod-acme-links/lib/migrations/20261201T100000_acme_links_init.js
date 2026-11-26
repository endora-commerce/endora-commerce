// The side tables, in the shape the guide recommends: the primary key is the
// host's id, and the foreign key on it cascades.
import { Migration } from '@mikro-orm/migrations';

export class Migration20261201T100000AcmeLinksInit extends Migration {
  async up() {
    this.addSql(
      `create table "acme_links_organization_refs" (` +
        `"organization_id" uuid not null, "external_ref" text not null, ` +
        `constraint "acme_links_organization_refs_pkey" primary key ("organization_id"), ` +
        `constraint "acme_links_organization_refs_organization_fk" foreign key ("organization_id") ` +
        `references "organizations" ("id") on delete cascade);`,
    );
    this.addSql(
      `create table "acme_links_order_notes" (` +
        `"order_id" uuid not null, "note" text not null, ` +
        `constraint "acme_links_order_notes_pkey" primary key ("order_id"), ` +
        `constraint "acme_links_order_notes_order_fk" foreign key ("order_id") ` +
        `references "orders" ("id") on delete cascade);`,
    );
  }

  async down() {
    this.addSql(`drop table if exists "acme_links_order_notes";`);
    this.addSql(`drop table if exists "acme_links_organization_refs";`);
  }
}
