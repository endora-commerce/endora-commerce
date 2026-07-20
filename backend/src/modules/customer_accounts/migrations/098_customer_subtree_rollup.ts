import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 056 (T032) — customer-side roll-up capability.
 *
 * Adds `customer_accounts.subtree_rollup_enabled` (boolean, NOT NULL DEFAULT
 * false). When true, the customer's tenant scope widens from single-org to its
 * organization's subtree (server-derived, Principle XI). Default false ⇒ every
 * existing customer stays node-only, preserving flat behavior byte-for-byte.
 */
export class Migration098CustomerSubtreeRollup extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "customer_accounts" add column "subtree_rollup_enabled" boolean not null default false;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "customer_accounts" drop column "subtree_rollup_enabled";');
  }
}
