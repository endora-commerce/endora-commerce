// Compiled from src/migrations/20261201T090000_acme_erp_backfill_credit_tier.ts.
import { Migration } from '@mikro-orm/migrations';

export class Migration20261201T090000AcmeErpBackfillCreditTier extends Migration {
  async up() {
    this.addSql(`update "organizations" set "x_acme_erp_credit_tier" = 1 where "vat_status" = 'valid'`);
  }
}
