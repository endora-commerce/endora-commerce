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
 * ## The backfill, and why it is a join and not a default
 *
 * `invoice_ledger` shipped on 2026-09-08 and no deployment has run it, so the
 * expected row count is zero everywhere. It is written as a real backfill all
 * the same, because "there are no rows" is a claim about today: the update
 * reads the organization off `invoices` **when that table exists**, which is
 * exactly the composition where a row could have been written, and the
 * `to_regclass` guard is what keeps the statement valid in the composition
 * where it does not. A row whose invoice has since gone is deleted rather than
 * given an invented organization — Principle XI has no "no organization" path,
 * and a work item for an invoice that is not there has nothing to deliver.
 */
export class Migration20260914T140000InvoiceLedgerRowOrganization extends Migration {
  override async up(): Promise<void> {
    for (const table of ['invoice_ledger_deliveries', 'invoice_ledger_document_maps']) {
      this.addSql(`alter table "${table}" add column "organization_id" uuid null;`);
      this.addSql(`
        do $$
        begin
          if to_regclass('public.invoices') is not null then
            execute 'update "${table}" as t
                       set "organization_id" = i."organization_id"
                       from "invoices" as i
                      where i."id" = t."invoice_id"';
          end if;
        end
        $$;
      `);
      this.addSql(`delete from "${table}" where "organization_id" is null;`);
      this.addSql(`alter table "${table}" alter column "organization_id" set not null;`);
      this.addSql(
        `create index "${table}_organization_id_idx" on "${table}" ("organization_id");`,
      );
      this.addSql(`
        alter table "${table}"
          add constraint "${table}_organization_id_foreign"
          foreign key ("organization_id") references "organizations" ("id")
          on update cascade;
      `);
    }
  }

  override async down(): Promise<void> {
    for (const table of ['invoice_ledger_deliveries', 'invoice_ledger_document_maps']) {
      this.addSql(
        `alter table "${table}" drop constraint "${table}_organization_id_foreign";`,
      );
      this.addSql(`drop index "${table}_organization_id_idx";`);
      this.addSql(`alter table "${table}" drop column "organization_id";`);
    }
  }
}
