import { Migration } from '@mikro-orm/migrations';
import {
  GENERIC_INVOICE_TEMPLATE_CODE,
  GENERIC_INVOICE_TEMPLATE_CONTENT,
  GENERIC_INVOICE_TEMPLATE_LANGUAGES,
} from '../seeds/generic-invoice-template.js';

/**
 * Reseed the system `generic` invoice template with the current Puck tree
 * (full defaultProps for sidebar radios/selects + English sample footer).
 */
function jsonbLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/'/g, "''");
}

export class Migration106InvoiceGenericTemplateReseed extends Migration {
  override async up(): Promise<void> {
    const contentJson = jsonbLiteral(GENERIC_INVOICE_TEMPLATE_CONTENT);
    const languagesJson = jsonbLiteral(GENERIC_INVOICE_TEMPLATE_LANGUAGES);
    this.addSql(
      `update "invoice_templates" ` +
        `set "content" = '${contentJson}'::jsonb, ` +
        `"languages" = '${languagesJson}'::jsonb, ` +
        `"version" = "version" + 1, ` +
        `"updated_at" = now() ` +
        `where "code" = '${GENERIC_INVOICE_TEMPLATE_CODE}' and "is_system" = true;`,
    );
  }

  override async down(): Promise<void> {
    // Prior tree cannot be restored; leave the reseeded content in place.
  }
}
