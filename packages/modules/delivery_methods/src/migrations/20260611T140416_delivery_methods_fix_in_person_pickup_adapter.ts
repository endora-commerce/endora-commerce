import { Migration } from '@mikro-orm/migrations';

/**
 * Fix the built-in in-person pickup delivery method's adapter binding.
 *
 * Migration 052 introduced the adapter framework and backfilled every existing
 * `delivery_methods` row with `adapter = code`. For the platform's bundled
 * in-person pickup method (code `in_person_pickup`) this produced the adapter
 * key `in_person_pickup`, which is NOT a registered ShippingAdapter — the
 * bundled pickup adapter registers under `personal_pickup`
 * (`built-in-adapters.ts`). As a result the eligibility filter
 * (`shipping-method-eligibility.ts`) silently dropped the method from every
 * storefront checkout, since an unregistered-adapter row never resolves
 * (FR-003).
 *
 * The dev seed already pairs `in_person_pickup` with the `personal_pickup`
 * adapter for fresh installs; this migration repoints any pre-existing,
 * backfilled rows to the same registered adapter so the pickup method becomes
 * selectable at checkout.
 */
export class Migration20260611T140416DeliveryMethodsFixInPersonPickupAdapter extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `update "delivery_methods" set "adapter" = 'personal_pickup' where "code" = 'in_person_pickup' and "adapter" = 'in_person_pickup';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `update "delivery_methods" set "adapter" = 'in_person_pickup' where "code" = 'in_person_pickup' and "adapter" = 'personal_pickup';`,
    );
  }
}
