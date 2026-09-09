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
import {
  entities as inventoryEntities,
  WarehouseChannelReconciler,
} from '@endora-commerce/mod-inventory/backend';
import { entities as paymentMethodsEntities } from '@endora-commerce/mod-payment-methods/backend';
import { entities as taxesEntities } from '@endora-commerce/mod-taxes/backend';
import { entities as adminRolesEntities } from '@endora-commerce/mod-admin-roles/backend';
import { entities as adminUsersEntities } from '@endora-commerce/mod-admin-users/backend';
import { entities as creditLimitsEntities } from '@endora-commerce/mod-credit-limits/backend';
import { entities as organizationsEntities } from '@endora-commerce/mod-organizations/backend';
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
import type { Warehouse as WarehouseRow } from '../../../packages/modules/inventory/dist/backend/entities/warehouse.entity.js';
import type { WarehouseChannelAssignment as WarehouseChannelAssignmentRow } from '../../../packages/modules/inventory/dist/backend/entities/warehouse-channel-assignment.entity.js';
import type { AdminRole as AdminRoleRow } from '../../../packages/modules/admin_roles/dist/backend/entities/admin-role.entity.js';
import type { AdminUser as AdminUserRow } from '../../../packages/modules/admin_users/dist/backend/entities/admin-user.entity.js';
import type { CreditLimit as CreditLimitRow } from '../../../packages/modules/credit_limits/dist/backend/entities/credit-limit.entity.js';
import type { Organization as OrganizationRow } from '../../../packages/modules/organizations/dist/backend/entities/organization.entity.js';
import { SalesChannel } from '../kernel/sales-channels/sales-channel.entity.js';
import { hashPassword } from '../kernel/crypto/password-hasher.js';

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
const Warehouse = entityNamed<WarehouseRow>(
  inventoryEntities,
  'Warehouse',
  '@endora-commerce/mod-inventory/backend',
);
const WarehouseChannelAssignment = entityNamed<WarehouseChannelAssignmentRow>(
  inventoryEntities,
  'WarehouseChannelAssignment',
  '@endora-commerce/mod-inventory/backend',
);
const AdminRole = entityNamed<AdminRoleRow>(
  adminRolesEntities,
  'AdminRole',
  '@endora-commerce/mod-admin-roles/backend',
);
const AdminUser = entityNamed<AdminUserRow>(
  adminUsersEntities,
  'AdminUser',
  '@endora-commerce/mod-admin-users/backend',
);
const CreditLimit = entityNamed<CreditLimitRow>(
  creditLimitsEntities,
  'CreditLimit',
  '@endora-commerce/mod-credit-limits/backend',
);
const Organization = entityNamed<OrganizationRow>(
  organizationsEntities,
  'Organization',
  '@endora-commerce/mod-organizations/backend',
);

/**
 * The demo administrator's sign-in details, on the **reference** path.
 *
 * `dev-catalog-seed.ts` prints them, and it imports them from here rather than
 * from `demo-host-residue.ts` because this is where the block that creates the
 * account now lives on that path. On the composed path `admin_users` reports
 * the same pair as a `DemoCredential` and the runner formats it (§3.7); these
 * two constants are the frozen copy and go with the file at T226.
 */
export const DEMO_ADMIN_EMAIL = 'admin@demo.local';
export const DEMO_ADMIN_PASSWORD = 'ChangeMe!123';

/** The demo organisation's own two literals, frozen with the block below. */
const DEMO_ORG_NAME = 'Acme B2B (demo)';
const DEMO_ORG_TAX_ID = 'PL5210000099';

/**
 * The sales representative's permission list, as the host block wrote it.
 *
 * A **literal copy** and not an import of
 * `@endora-commerce/mod-admin-roles/backend`'s exported constant, deliberately:
 * the two sides of the parity comparison have to be different code, and a
 * reference side that imported the module's own list could not see a change to
 * it. That is this whole file's reason, applied to the one value in it that has
 * a published twin.
 */
const SALES_REPRESENTATIVE_PERMISSIONS: readonly string[] = [
  'rfqs:handle',
  'organizations:read.assigned',
  'catalog:read',
  'price_lists:read',
];

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
  // ── T223, batch 2 ────────────────────────────────────────────────────────
  // `inventory`. Verbatim from `demo-host-residue.ts` **but for two string
  // values**, and the deviation is the batch's one deliberate content change:
  // `Magazyn Kraków` and `Demo secondary warehouse — Kraków, PL` are Polish
  // prose in a scalar column, so on the move they became
  // `check:default-language-prose` findings — measured, two of them — and
  // neither of that check's two answers was available. A per-language map has
  // nowhere to go (`Warehouse.name` is a `varchar(160)`), and a ledger entry is
  // what T223's own obligation forbids. So the value is English on both sides,
  // and the parity comparison holds over the changed value rather than hiding
  // the change.

  // --- Feature 010 — multi-warehouse demo data (T085) ----------------
  // Add a second warehouse and spread stock between it and the seeded
  // `default` warehouse so the inventory landing, per-product roster, and
  // channel-binding panels all have real data to render. The existing channels
  // keep `default` as their default warehouse (the boot-time
  // WarehouseChannelReconciler handled that) and gain a second non-default
  // assignment for the demo warehouse.
  const krakowWarehouseId = '00000000-0000-4000-8000-00000000d0c0';
  let krakow = await em.findOne(Warehouse, { id: krakowWarehouseId });
  if (!krakow) {
    krakow = em.create(Warehouse, {
      id: krakowWarehouseId,
      name: 'Krakow warehouse',
      code: 'pl-krk',
      active: true,
      description: 'Demo secondary warehouse — Krakow, PL',
    });
    em.persist(krakow);
    await em.flush();
  }

  // Seed runs BEFORE the backend boots, so the WarehouseChannelReconciler
  // (which fires at boot, after DefaultChannelReconciler) hasn't yet
  // paired channels with the Default warehouse. Run it inline so the
  // dev DB lands fully wired and admins don't need a server bounce.
  await new WarehouseChannelReconciler(em.fork()).run();

  const channelsForBinding = await em.find(SalesChannel, {});
  for (const ch of channelsForBinding) {
    const existing = await em.findOne(WarehouseChannelAssignment, {
      warehouseId: krakowWarehouseId,
      salesChannelId: ch.id,
    });
    if (!existing) {
      const row = em.create(WarehouseChannelAssignment, {
        warehouseId: krakowWarehouseId,
        salesChannelId: ch.id,
        isDefault: false,
        sortOrder: 1,
      });
      em.persist(row);
    }
  }
  await em.flush();

  // ── T222, batch 3 ────────────────────────────────────────────────────────
  // `admin_roles`, `admin_users` and `organizations`, plus the two links that
  // are the composition's on the composed path: the role each administrator
  // holds, and the credit limit granted to the demo organisation. Verbatim from
  // `demo-host-residue.ts`.
  //
  // **The links are written inline here and are steps 6 and 7 there**, and that
  // asymmetry is the freeze working rather than a divergence: this file is one
  // program with every row in hand, so it assigns a role id in the same
  // statement that creates the account, exactly as the host block did. The
  // composed path cannot — `admin_users` may not write `admin_roles`' id and
  // `admin_roles` may not create an account — so it creates the two sides
  // separately and joins them afterwards. The comparison is over the database
  // both produce, which is what makes the two shapes checkable against each
  // other at all.

  // --- Demo Organization + buyer --------------------------------------
  const adminPasswordHash = await hashPassword(DEMO_ADMIN_PASSWORD);

  const platformRole = em.create(AdminRole, {
    code: 'platform_admin',
    name: 'Platform Admin',
    permissions: ['*'],
  });
  await em.persistAndFlush(platformRole);

  const demoAdmin = em.create(AdminUser, {
    email: DEMO_ADMIN_EMAIL,
    passwordHash: adminPasswordHash,
    firstName: 'Demo',
    lastName: 'Admin',
    adminRoleId: platformRole.id,
    status: 'active',
  });
  await em.persistAndFlush(demoAdmin);

  // Feature 008 — sales_representative role + two demo accounts so the
  // quickstart can exercise assignment-scoped visibility.
  const salesRepRole = em.create(AdminRole, {
    code: 'sales_representative',
    name: 'Sales representative',
    permissions: [...SALES_REPRESENTATIVE_PERMISSIONS],
  });
  await em.persistAndFlush(salesRepRole);

  const salesRepAdmin = em.create(AdminUser, {
    email: 'sales-rep@demo.local',
    passwordHash: adminPasswordHash,
    firstName: 'Anna',
    lastName: 'Wiśniewska',
    adminRoleId: salesRepRole.id,
    status: 'active',
  });
  const salesRepOther = em.create(AdminUser, {
    email: 'sales-rep-other@demo.local',
    passwordHash: adminPasswordHash,
    firstName: 'Tomasz',
    lastName: 'Nowak',
    adminRoleId: salesRepRole.id,
    status: 'active',
  });
  await em.persistAndFlush([salesRepAdmin, salesRepOther]);

  const demoOrg = em.create(Organization, {
    name: DEMO_ORG_NAME,
    taxId: DEMO_ORG_TAX_ID,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: {
      street: 'ul. Demo 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
  });
  await em.persistAndFlush(demoOrg);

  // --- The granted credit limit (T166) --------------------------------
  //
  // On the composed path it is step 7 of `demo-composition.ts` — `credit_limits`
  // owns the row and `organizations` owns the party it is granted to, so it is
  // two modules' rows in one statement and no module's demo data (§5.1).
  //
  // It is what makes `payment_methods`' `credit_limit` method visible at all:
  // checkout hides that method from a buyer whose organization holds no grant,
  // and again when the cart exceeds what is available. Without this row the
  // demo would offer an option no seeded buyer can ever see, which is the same
  // "capability reads as missing" the method was seeded to fix.
  const demoCreditLimit = em.create(CreditLimit, {
    organizationId: demoOrg.id,
    grantedAmount: '50000.00',
    currency: 'PLN',
  });
  await em.persistAndFlush(demoCreditLimit);
}
