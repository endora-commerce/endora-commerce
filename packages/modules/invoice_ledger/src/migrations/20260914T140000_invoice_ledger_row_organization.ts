import { Migration } from '@mikro-orm/migrations';

/**
 * `invoice_ledger` deliveries and document maps carry their own tenant key.
 *
 * Both tables were `@TransitivelyScoped('Invoice', 'invoiceId')` — a chain hop
 * into a class `invoices` owns. `invoice_ledger` is `nonDeactivatable` and
 * cannot declare `invoices` in its manifest `dependencies`
 * (`module-composition.md` §4a: the entry would make `invoices.enabled` a dead
 * switch), so an instance that installs the locked set without `invoices`
 * composes these entities and no `Invoice`, and the tenancy reconciliation
 * refuses the boot before a migration runs. That is A3 of the instance
 * acceptance criterion, red on pipeline 13835.
 *
 * The organization is frozen on the row at enqueue, beside the credential, the
 * environment, the numbering mode and the KSeF routing that already are, and
 * the foreign key is to `organizations` — this module's own declared
 * dependency, and the one `invoice_ledger_client_maps` already uses. There is
 * still **no** foreign key to `invoices`
 * (`specs/119-infakt-integration/data-model.md` §3, unchanged).
 *
 * ## The backfill reaches two tables this module does not own, and says so
 *
 * `invoice_ledger` shipped on 2026-09-08 and no deployment has run it, so the
 * expected row count is zero everywhere. It is written as a real backfill all
 * the same, because "there are no rows" is a claim about today.
 *
 * It joins `invoices` **and** `orders`, and the second hop is the same fact
 * this migration exists for read from the other end: `invoices` carries no
 * organization column either — `Invoice` is itself
 * `@TransitivelyScoped('Order', 'orderId')`, so the tenant lives on `orders`.
 * A first draft read `i."organization_id"` and PostgreSQL answered `42703`,
 * which is the chain saying out loud that it grounds two tables away.
 *
 * Both are `migration-cross-module-sql.md` §4.1's R1 shape — a migration naming
 * a table it does not own — and both are **reads inside an existence guard**,
 * which is what makes them safe in the composition this column exists for:
 * `to_regclass` answers `null` when the owning module was never installed, and
 * the statement is `execute`d so its names resolve at run time rather than when
 * the block is parsed. A row whose invoice or order has since gone is deleted
 * rather than given an invented organization — Principle XI has no
 * "no organization" path, and a work item for an invoice that is not there has
 * nothing to deliver.
 *
 * **There is no ledger entry for them, and that is a fact about the instrument
 * rather than a claim that they are not R1.** `check:module-boundary` attributes
 * a migration's tables by reading SQL text, and this SQL is a single-quoted
 * string inside a dollar-quoted `do` block, so the walk sees neither `invoices`
 * nor `orders` here: measured on this branch, `cross-module DML` reads 43 with
 * and without this file. The ledger is two-way, so an entry describing a finding
 * the check does not report would fail the build as stale — an edge it cannot
 * see cannot be recorded in it. The blind spot is real and is reported to the
 * check's owner; this block is where a reader of *this* file learns what the
 * ledger would otherwise have told them.
 *
 * The two tables are written out rather than looped for the same reason read the
 * other way: a loop would put the table name in a template hole, and the `alter`
 * and `create index` statements this file *does* own would become unattributable
 * too.
 */
export class Migration20260914T140000InvoiceLedgerRowOrganization extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "invoice_ledger_deliveries" add column "organization_id" uuid null;`);
    this.addSql(`
      do $$
      begin
        if to_regclass('public.invoices') is not null
           and to_regclass('public.orders') is not null then
          execute 'update "invoice_ledger_deliveries" as t
                      set "organization_id" = o."organization_id"
                     from "invoices" as i
                     join "orders" as o on o."id" = i."order_id"
                    where i."id" = t."invoice_id"';
        end if;
      end
      $$;
    `);
    this.addSql(`delete from "invoice_ledger_deliveries" where "organization_id" is null;`);
    this.addSql(
      `alter table "invoice_ledger_deliveries" alter column "organization_id" set not null;`,
    );
    this.addSql(
      `create index "invoice_ledger_deliveries_organization_id_idx" on "invoice_ledger_deliveries" ("organization_id");`,
    );
    this.addSql(`
      alter table "invoice_ledger_deliveries"
        add constraint "invoice_ledger_deliveries_organization_id_foreign"
        foreign key ("organization_id") references "organizations" ("id")
        on update cascade;
    `);

    this.addSql(
      `alter table "invoice_ledger_document_maps" add column "organization_id" uuid null;`,
    );
    this.addSql(`
      do $$
      begin
        if to_regclass('public.invoices') is not null
           and to_regclass('public.orders') is not null then
          execute 'update "invoice_ledger_document_maps" as t
                      set "organization_id" = o."organization_id"
                     from "invoices" as i
                     join "orders" as o on o."id" = i."order_id"
                    where i."id" = t."invoice_id"';
        end if;
      end
      $$;
    `);
    this.addSql(`delete from "invoice_ledger_document_maps" where "organization_id" is null;`);
    this.addSql(
      `alter table "invoice_ledger_document_maps" alter column "organization_id" set not null;`,
    );
    this.addSql(
      `create index "invoice_ledger_document_maps_organization_id_idx" on "invoice_ledger_document_maps" ("organization_id");`,
    );
    this.addSql(`
      alter table "invoice_ledger_document_maps"
        add constraint "invoice_ledger_document_maps_organization_id_foreign"
        foreign key ("organization_id") references "organizations" ("id")
        on update cascade;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "invoice_ledger_deliveries"
        drop constraint "invoice_ledger_deliveries_organization_id_foreign";
    `);
    this.addSql(`drop index "invoice_ledger_deliveries_organization_id_idx";`);
    this.addSql(`alter table "invoice_ledger_deliveries" drop column "organization_id";`);
    this.addSql(`
      alter table "invoice_ledger_document_maps"
        drop constraint "invoice_ledger_document_maps_organization_id_foreign";
    `);
    this.addSql(`drop index "invoice_ledger_document_maps_organization_id_idx";`);
    this.addSql(`alter table "invoice_ledger_document_maps" drop column "organization_id";`);
  }
}
