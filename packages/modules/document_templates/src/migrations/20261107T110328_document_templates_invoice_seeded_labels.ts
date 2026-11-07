import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #437 — an invoice template printed English labels on a Polish invoice.
 *
 * The invoice document type's built-in layout (`invoices`,
 * `backend/seeds/generic-invoice-template.ts`) carried English literals in its
 * label props — `labelPaid: 'Paid'`, the footer's *"Thank you for your
 * business."* — and a template prop wins over the translation the renderer
 * would otherwise draw in the document's language. An invoice template created
 * from that layout (*Start from the built-in layout*, or a copy of such a
 * template) stored the literals in this table, so every Polish invoice printed
 * with it said *Paid* where it should print the Polish label. The layout leaves every
 * label empty now; this migration does the same to the stored copies.
 *
 * **What it changes, exactly** (architect ruling 5, 2026-11-07): in every
 * language tree of every `invoices.invoice` row, a prop of a node of one of
 * the listed block types is set to `''` **only where its value is exactly the
 * literal the layout seeded for that prop**. A value that differs by a
 * character — a translation, a different capitalisation, a trailing space, a
 * footer with a bank line added — is an operator's and stays as it is. `version`
 * advances on a row the walk changed, so an editor holding the old version
 * cannot save over the change unnoticed; a row it did not change keeps its
 * version and its `updated_at`.
 *
 * On an English layout `''` prints the same English text it held, so nothing
 * an English reader sees moves. The one reading it gets wrong is an operator
 * who *deliberately* wanted the English label on a Polish invoice and left the
 * seeded value in place: after the upgrade they type it in again.
 *
 * **Why this module owns it.** The rows are this module's (`document_templates`
 * creates and writes the table); `invoices` owns the literals. A migration may
 * not write another module's table (`module-migrations.md` item 4a, R2), so the
 * correction sits with the table's owner and names the literals itself, frozen
 * here: the seed no longer holds them, and a migration must not change meaning
 * when a module it does not depend on changes later. No manifest edge follows —
 * a block type is a string inside a JSONB document, not a table reference.
 *
 * The walk covers `content` and every `zones` entry of each language tree;
 * nothing else in the document is read. A second run changes nothing.
 *
 * `down()` restores nothing: an empty label after the upgrade cannot be told
 * apart from one an operator emptied, and the empty label prints the same text
 * in English and the correct text in Polish.
 */

const FN = 'scrub_invoice_seeded_labels_document_templates';

/** `[block type, prop, the literal the built-in layout seeded]`. */
const SEEDED: ReadonlyArray<readonly [string, string, string]> = [
  ['invoices.InvoiceHeader', 'labelIssuedAt', 'Issue date'],
  ['invoices.InvoiceHeader', 'labelSaleDate', 'Sale date'],
  ['invoices.InvoiceHeader', 'labelPaymentDue', 'Payment due'],
  ['invoices.InvoiceHeader', 'labelPaymentMethod', 'Payment method'],
  ['invoices.InvoiceParties', 'sellerLabel', 'Seller'],
  ['invoices.InvoiceParties', 'buyerLabel', 'Buyer'],
  ['invoices.InvoiceVatSummary', 'totalLabel', 'Total'],
  ['invoices.InvoiceTotals', 'labelPaid', 'Paid'],
  ['invoices.InvoiceTotals', 'labelAmountDue', 'Amount due'],
  ['invoices.InvoiceTotals', 'labelGross', 'Total'],
  ['invoices.InvoiceTotals', 'labelInWords', 'In words'],
  [
    'invoices.InvoiceFooter',
    'text',
    'Thank you for your business.\n{{var seller.legalName}} · Tax ID {{var seller.taxId}}',
  ],
];

const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

function createFunctionSql(): string {
  const map = `jsonb_build_array(${SEEDED.map(
    ([type, prop, value]) => `jsonb_build_array(${literal(type)}, ${literal(prop)}, ${literal(value)})`,
  ).join(', ')})`;
  return `
    create function pg_temp.${FN}(nodes jsonb) returns jsonb language plpgsql immutable as $$
    declare
      seeded jsonb := ${map};
      entry jsonb;
      node jsonb;
      out jsonb := '[]'::jsonb;
    begin
      if jsonb_typeof(nodes) <> 'array' then
        return nodes;
      end if;
      for node in select value from jsonb_array_elements(nodes) loop
        if jsonb_typeof(node) = 'object' and jsonb_typeof(node -> 'props') = 'object' then
          for entry in select value from jsonb_array_elements(seeded) loop
            if node ->> 'type' = entry ->> 0
               and jsonb_typeof(node -> 'props' -> (entry ->> 1)) = 'string'
               and node -> 'props' ->> (entry ->> 1) = entry ->> 2 then
              node := jsonb_set(node, array['props', entry ->> 1], '""'::jsonb);
            end if;
          end loop;
        end if;
        out := out || jsonb_build_array(node);
      end loop;
      return out;
    end
    $$;
  `;
}

/** One language tree: its `content`, and each array under `zones`. */
function treeSql(tree: string): string {
  return `
    case when jsonb_typeof(${tree}) <> 'object' then ${tree} else
      ${tree}
      || case when (${tree} -> 'content') is not null
           then jsonb_build_object('content', pg_temp.${FN}(${tree} -> 'content')) else '{}'::jsonb end
      || case when jsonb_typeof(${tree} -> 'zones') = 'object' then jsonb_build_object('zones', (
           select coalesce(jsonb_object_agg(zone.key, pg_temp.${FN}(zone.value)), '{}'::jsonb)
             from jsonb_each(${tree} -> 'zones') as zone
         )) else '{}'::jsonb end
    end
  `;
}

function applySql(): string {
  return `
    with scrubbed as (
      select t."id",
             jsonb_set(t."content", '{languages}', (
               select coalesce(jsonb_object_agg(lang.key, ${treeSql('lang.value')}), '{}'::jsonb)
                 from jsonb_each(t."content" -> 'languages') as lang
             )) as content
        from "document_templates" t
       where t."document_type" = 'invoices.invoice'
         and jsonb_typeof(t."content" -> 'languages') = 'object'
    )
    update "document_templates" d
       set "content" = s.content,
           "version" = d."version" + 1,
           "updated_at" = now()
      from scrubbed s
     where d."id" = s."id"
       and d."content" is distinct from s.content;
  `;
}

export class Migration20261107T110328DocumentTemplatesInvoiceSeededLabels extends Migration {
  override async up(): Promise<void> {
    this.addSql(createFunctionSql());
    this.addSql(applySql());
    this.addSql(`drop function pg_temp.${FN}(jsonb);`);
  }

  override async down(): Promise<void> {
    // Nothing to restore — see the header.
  }
}
