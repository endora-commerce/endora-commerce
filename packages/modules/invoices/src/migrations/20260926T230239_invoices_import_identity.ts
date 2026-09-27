import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 134, T135 — an imported invoice is identified by its source system
 * and its id there (`specs/134-paid-module-extraction/research.md` D21 §3).
 *
 * Until now an `erp_import` row was unique on
 * `external_document_ref->>'xlSaleDocumentId'` alone, a key named after the one
 * connector that wrote it. A second source system's ids come from an unrelated
 * id space, so the same string from another system would have reached — and
 * overwritten — the first system's document. This migration:
 *
 * 1. drops the id-only unique index;
 * 2. renames the persisted JSONB keys `xlSaleDocumentId` → `externalId` and
 *    `xlDocumentNumber` → `externalNumber` (an absent number stays absent);
 * 3. renames `invoice_external_attachments.xl_attachment_id` →
 *    `external_attachment_id`, and its unique constraint with it;
 * 4. adds `invoices_erp_import_identity_chk`, so a missing key cannot fall
 *    through the unique index as a NULL;
 * 5. creates `invoices_external_document_uq` on the pair.
 *
 * Every row written before this migration carries `system = 'comarch_xl'`,
 * so a set unique on the id alone is unique on the pair and step 5 cannot fail
 * on existing data.
 *
 * `down()` reverses each step, and it is valid **only while a single source
 * system has written**. Once two systems share an id, recreating the id-only
 * index fails, and it should: that index would merge two documents.
 */
export class Migration20260926T230239InvoicesImportIdentity extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index if exists "invoices_external_xl_sale_document_uq";`);

    this.addSql(`
      update "invoices"
      set "external_document_ref" =
        ("external_document_ref" - 'xlSaleDocumentId' - 'xlDocumentNumber')
        || jsonb_strip_nulls(jsonb_build_object(
          'externalId', "external_document_ref"->'xlSaleDocumentId',
          'externalNumber', "external_document_ref"->'xlDocumentNumber'
        ))
      where "external_document_ref"->'xlSaleDocumentId' is not null;
    `);

    this.addSql(
      `alter table "invoice_external_attachments" rename column "xl_attachment_id" to "external_attachment_id";`,
    );
    this.addSql(
      `alter table "invoice_external_attachments" rename constraint "invoice_external_attachments_invoice_xl_uq" to "invoice_external_attachments_invoice_external_uq";`,
    );

    this.addSql(`
      alter table "invoices"
      add constraint "invoices_erp_import_identity_chk"
      check (
        origin <> 'erp_import'
        or (
          coalesce("external_document_ref"->>'system', '') <> ''
          and coalesce("external_document_ref"->>'externalId', '') <> ''
        )
      );
    `);

    this.addSql(`
      create unique index "invoices_external_document_uq"
      on "invoices" ((external_document_ref->>'system'), (external_document_ref->>'externalId'))
      where origin = 'erp_import';
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "invoices_external_document_uq";`);
    this.addSql(
      `alter table "invoices" drop constraint if exists "invoices_erp_import_identity_chk";`,
    );

    this.addSql(
      `alter table "invoice_external_attachments" rename constraint "invoice_external_attachments_invoice_external_uq" to "invoice_external_attachments_invoice_xl_uq";`,
    );
    this.addSql(
      `alter table "invoice_external_attachments" rename column "external_attachment_id" to "xl_attachment_id";`,
    );

    this.addSql(`
      update "invoices"
      set "external_document_ref" =
        ("external_document_ref" - 'externalId' - 'externalNumber')
        || jsonb_strip_nulls(jsonb_build_object(
          'xlSaleDocumentId', "external_document_ref"->'externalId',
          'xlDocumentNumber', "external_document_ref"->'externalNumber'
        ))
      where "external_document_ref"->'externalId' is not null;
    `);

    this.addSql(`
      create unique index "invoices_external_xl_sale_document_uq"
      on "invoices" ((external_document_ref->>'xlSaleDocumentId'))
      where origin = 'erp_import';
    `);
  }
}
