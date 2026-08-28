/**
 * The permission list the dev seed's `sales_representative` role carries.
 *
 * ## Why it is a constant and not eight lines inside the seed
 *
 * The role is the one shipped role whose authority this repository can get
 * wrong: `platform_admin` and the bootstrap admin hold `['*']`, which
 * short-circuits in `PermissionService.hasPermission` before any code is
 * compared, and the two content roles hold their own module's codes. So a
 * change to what a catalogue code grants is felt by exactly this list, and a
 * test that asserts what the seeded sales representative may reach has to read
 * the list the seed actually writes rather than a copy of it — a copy agrees
 * with the seed on the day it is written and never again.
 *
 * It lives here rather than in `dev-catalog-seed.ts` for the reason
 * `seed-scope.ts` gives about its own constant: the seed runs at import, so a
 * test importing anything from that file would run the seed.
 */
export const SALES_REPRESENTATIVE_PERMISSIONS: readonly string[] = [
  'rfqs:handle',
  'organizations:read.assigned',
  'catalog:read',
  // D-173 — the RFQ create screen prefills the agreed unit price from
  // `GET /admin/products/:id/resolved-price`, which is `price_lists`' own
  // endpoint and is gated on `price_lists:read` rather than on
  // `rfqs:handle`. Without this code the prefill answers 403.
  'price_lists:read',
];
