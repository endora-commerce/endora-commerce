/**
 * The demo blocks that have **already** reached their own modules, kept here
 * verbatim as the parity comparison's reference side (feature 113, Phase 2).
 *
 * ## Why this file exists, and why it is not a duplicate to be tidied away
 *
 * `test/integration/demo/demo-parity.test.ts` is the only thing in the
 * repository that judges whether the demo seed still produces the same shop: no
 * check's population contains `backend/src/seeds/`, and no static instrument
 * can see whether a moved block writes the rows the block it replaced wrote. It
 * works by seeding two databases and diffing them — `dev-catalog-seed.ts` on
 * one side, `endora demo seed` on the other.
 *
 * That comparison is only worth something while the two sides are **different
 * code**. The moment a module's block leaves `demo-host-residue.ts`, the
 * reference side stops writing those rows, and the comparison stops being able
 * to see the move at all: the table drops out of the reference population, and
 * a batch that dropped a column, changed an adapter name or lost a row would
 * be as green as one that moved the block faithfully.
 *
 * So a moved block is not deleted from the host. It is moved **here**,
 * unchanged, and this file is called by `dev-catalog-seed.ts` and by nothing
 * else. The composed path runs the module's own copy; the reference path runs
 * this one; the parity test compares the two databases row for row. A batch
 * that changes a value in the module and not here goes red, which is the whole
 * point of writing the comparison before the first block moved.
 *
 * ## What it is not
 *
 * It is not a home and it is not a second implementation to keep in step. It is
 * a **frozen copy**: nothing here may be improved, refactored or corrected — a
 * correction belongs in the module that now owns the rows, and this file's
 * disagreement with it is the finding. It is deleted whole at T226, with
 * `demo-host-residue.ts` and `dev-catalog-seed.ts`, when there is no longer a
 * legacy path to be the reference.
 *
 * Nothing here opens a database, opens a scope or checks the guard; all three
 * are the entry point's (contract §3.3, §3.4), exactly as in the residue.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { entities as deliveryMethodsEntities } from '@endora-commerce/mod-delivery-methods/backend';
import { entities as paymentMethodsEntities } from '@endora-commerce/mod-payment-methods/backend';
import { entities as taxesEntities } from '@endora-commerce/mod-taxes/backend';
import { entityNamed } from '../packages/package-entity-lookup.js';
// The row shapes for the three classes below — an `import type` of the
// declaration inside each package's **built** artefact, for the reason
// `demo-host-residue.ts` gives in full: a module package publishes its entities
// as one array and no class by name (D-168), and this file's build sets
// `rootDir: ./src`, so a `.ts` outside it is TS6059 even for a type-only
// import. Nothing is constructed from the type; `import type` erases.
import type { DeliveryMethod as DeliveryMethodRow } from '../../../packages/modules/delivery_methods/dist/backend/entities/delivery-method.entity.js';
import type { PaymentMethod as PaymentMethodRow } from '../../../packages/modules/payment_methods/dist/backend/entities/payment-method.entity.js';
import type { Tax as TaxRow } from '../../../packages/modules/taxes/dist/backend/entities/tax.entity.js';

const DeliveryMethod = entityNamed<DeliveryMethodRow>(
  deliveryMethodsEntities,
  'DeliveryMethod',
  '@endora-commerce/mod-delivery-methods/backend',
);
const PaymentMethod = entityNamed<PaymentMethodRow>(
  paymentMethodsEntities,
  'PaymentMethod',
  '@endora-commerce/mod-payment-methods/backend',
);
const Tax = entityNamed<TaxRow>(taxesEntities, 'Tax', '@endora-commerce/mod-taxes/backend');

/**
 * Create the rows the modules below now create for themselves.
 *
 * Called after `seedHostModuleResidue` and before the composition, which is
 * where `endora demo seed` runs the modules' own bodies (contract §5.5) — so
 * the two paths write in the same order as well as the same rows.
 */
export async function seedRelocatedDemoReference(em: EntityManager): Promise<void> {
  // ── T220, batch 1 ────────────────────────────────────────────────────────
  // `delivery_methods`, `payment_methods` and `taxes`. Verbatim from
  // `demo-host-residue.ts`, less the granted credit limit that sat between the
  // payment methods and the warehouses: that row is `credit_limits`' against
  // the demo organisation, so it is two modules' and stays in the residue until
  // it becomes a composition step.

  // --- Delivery + payment methods (T166) ------------------------------
  const pickup = em.create(DeliveryMethod, {
    code: 'in_person_pickup',
    name: { 'en-US': 'In-person pickup', 'pl-PL': 'Odbior osobisty' },
    cost: '0',
    currency: 'PLN',
    // Feature 035 — shipping adapter backing this delivery method.
    adapter: 'personal_pickup',
  });
  await em.persistAndFlush(pickup);

  const bankTransfer = em.create(PaymentMethod, {
    code: 'bank_transfer',
    name: { 'en-US': 'Bank transfer', 'pl-PL': 'Przelew bankowy' },
    kind: 'bank_transfer',
    adapter: 'bank_transfer',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    // Feature 085 (FR-003) — the shipped default; a declined payment holds the
    // order rather than ending it.
    statusOnFailure: 'on_hold',
  });
  await em.persistAndFlush(bankTransfer);

  // The platform's headline B2B payment path, seeded so a fresh dev environment
  // shows it (feature 080, D5). `credit_limit` has been a first-class
  // `paymentMethodKindSchema` member and a registered adapter all along, and
  // checkout already offers it — but only when an operator has created the row,
  // which no seed did, so the capability read as missing.
  //
  // `statusOnSuccess: 'paid'` is what a settled deferred payment means; the
  // reservation itself is opened inside the placement transaction and the order
  // waits in `new` until the proforma is settled.
  const creditLimitMethod = em.create(PaymentMethod, {
    code: 'credit_limit',
    name: { 'en-US': 'Credit limit', 'pl-PL': 'Limit kupiecki' },
    kind: 'credit_limit',
    adapter: 'credit_limit',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'on_hold',
  });
  await em.persistAndFlush(creditLimitMethod);

  // --- Polish VAT Tax (T166) ------------------------------------------
  em.create(Tax, {
    code: 'pl_vat_23',
    name: 'PL VAT 23%',
    rate: '0.23',
    country: 'PL',
    isDefault: true,
  });
  await em.flush();
}
