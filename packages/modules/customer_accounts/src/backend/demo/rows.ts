/**
 * The customer group this module's demo data creates (feature 160, FR-044).
 *
 * *VIP* is the customer group of the owner's E3 scenario
 * (`specs/pricing/worked-examples.md` §10.4): the demo organisation belongs to
 * it, and a demo price book is offered to it. One place holding the data,
 * imported by both bodies: `seed.ts` creates this row and `reset.ts` withdraws
 * exactly it, by its code.
 *
 * The code is the demo's own rather than `VIP`: `customer_groups.code` is
 * unique, and an operator's own `VIP` group must neither block the seed nor be
 * taken by a reset. The name is what the shop shows, and it is a product name
 * that reads the same in both shipped languages.
 *
 * **The organisation's membership is not here.** It is `organizations`' row
 * naming this one, so it is a composition step (§5.1) in
 * `@endora-commerce/demo-composition`.
 */
export const DEMO_CUSTOMER_GROUP = {
  code: 'demo-vip',
  name: 'VIP',
  description: 'Demo customer group of the E3 pricing scenario.',
} as const;
