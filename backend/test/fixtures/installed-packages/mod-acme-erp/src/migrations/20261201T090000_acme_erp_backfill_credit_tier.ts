import { Migration } from '@mikro-orm/migrations';

/**
 * A back-fill of the module's own column. It runs after the generated step,
 * which sits at the head of `acme_erp`'s block, so the column exists here on a
 * fresh database too.
 */
export class Migration20261201T090000AcmeErpBackfillCreditTier extends Migration {
  override async up(): Promise<void> {
    this.addSql(`update "organizations" set "x_acme_erp_credit_tier" = 1 where "vat_status" = 'valid'`);
  }
}
