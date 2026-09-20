import { describe, it, expect } from 'vitest';
import { ALL_ENTITIES } from '../../../src/db/entities-registry.generated.js';
import {
  assertTransitiveParentsResolve,
  resolveTransitiveParent,
  tenantClassifications,
} from '../../../src/tenancy/org-scoped.decorator.js';

/**
 * Feature 080, T049 (D-169) — the committed platform's tenancy chains resolve.
 *
 * The refusal in `org-scoped.decorator.ts` fires at boot, out of
 * `db/configured-entities.ts`, over the entity set the ORM is about to be
 * configured with. That is the honest place for it — it is the first moment
 * every entity class is loaded, and it covers an installed package's entities
 * as well as the committed ones — but it needs a running boot, and the fast
 * unit suite has none. This file asks the same question of the same registry
 * with no database and no ORM: importing the committed entity registry runs
 * every classification decorator, and the reconciliation then has the whole
 * core population to work over.
 *
 * So a merge request that renames `Order`, deletes `Invoice` or misspells a
 * parent name fails here, in the suite that runs on every backend merge
 * request, rather than at the next boot.
 *
 * It asserts nothing *into* the registry, deliberately: the registry is a
 * module-level singleton, and a fixture written here would be indistinguishable
 * from a real misclassification. The fixtures live in
 * `transitive-parent-resolution.test.ts`, which makes no claim about the real
 * platform.
 */
describe('the committed platform’s transitive tenancy chains', () => {
  it('registers a classification for every committed entity', () => {
    // The vacuous-pass guard: everything below is a filter over the registry,
    // and an empty registry would satisfy all of it.
    expect(ALL_ENTITIES.length).toBeGreaterThan(100);
    const classified = new Set(tenantClassifications().map((meta) => meta.target as unknown));
    expect(ALL_ENTITIES.filter((entity) => !classified.has(entity as unknown))).toEqual([]);
  });

  it('resolves every @TransitivelyScoped parent name', () => {
    expect(() => assertTransitiveParentsResolve()).not.toThrow();
  });

  it('walks the chains the platform actually has', () => {
    const transitive = tenantClassifications().filter((meta) => meta.scope === 'transitive');
    // The membership is asserted as a set, so a class arriving is read here
    // rather than inherited silently by a `find`.
    //
    // **It was four and is two again, and the sentence it used to carry is the
    // defect.** That sentence said `invoice_ledger`'s two tables take
    // `KsefSubmission`'s chain "and has to be, because neither table carries an
    // organization column of its own" — true of the schema as written, and the
    // wrong conclusion: `ksef` declares `invoices` in its manifest
    // `dependencies` and `invoice_ledger` cannot, being `nonDeactivatable`
    // (`module-composition.md` §4a). So an instance composing the locked set
    // without `invoices` loaded those two classes and no `Invoice`, and the
    // boot reconciliation refused — A3 of the instance acceptance criterion.
    // Both tables carry the column now. The general claim is
    // `transitive-parent-module-ownership.test.ts`'; this is the population.
    // **A third since `specs/130-comarch-xl-sync/`.**
    // `InvoiceExternalAttachment` holds the metadata for a file attached to an
    // ERP-imported sale document and takes `Invoice`'s chain — the same shape
    // as `KsefSubmission`, one link further out, and owned by the module that
    // owns its parent rather than by a dependant, so it does not repeat the
    // defect the paragraph above records.
    // **A fourth, and the first one that is entirely intra-package (D-258).**
    // `XlImportedOfferLine` takes `XlImportedOffer`'s chain. The other three
    // each cross a module boundary, which is what made the `invoice_ledger`
    // refusal above possible: a chain whose parent another module owns can be
    // composed without that parent. This one cannot — both classes ship in one
    // package's `entities` array, so the boot reconciliation has either both or
    // neither, and it is the reason a chain hop was allowed here where
    // `invoice_ledger` had to carry a column instead.
    expect(transitive.map((meta) => meta.className).sort()).toEqual([
      'Invoice',
      'InvoiceExternalAttachment',
      'KsefSubmission',
      'XlImportedOfferLine',
    ]);

    const invoice = transitive.find((meta) => meta.className === 'Invoice');
    const submission = transitive.find((meta) => meta.className === 'KsefSubmission');
    const attachment = transitive.find(
      (meta) => meta.className === 'InvoiceExternalAttachment',
    );
    const offerLine = transitive.find((meta) => meta.className === 'XlImportedOfferLine');
    expect(invoice).toMatchObject({ parentClassName: 'Order', fk: 'orderId' });
    expect(submission).toMatchObject({ parentClassName: 'Invoice', fk: 'invoiceId' });
    expect(attachment).toMatchObject({ parentClassName: 'Invoice', fk: 'invoiceId' });
    expect(offerLine).toMatchObject({ parentClassName: 'XlImportedOffer', fk: 'offer' });

    // KsefSubmission -> Invoice -> Order, and Order carries the org column.
    const middle = resolveTransitiveParent(submission!);
    expect(middle.className).toBe('Invoice');
    const root = resolveTransitiveParent(middle);
    expect(root).toMatchObject({ className: 'Order', scope: 'org', key: 'organizationId' });

    // XlImportedOfferLine -> XlImportedOffer, one hop, and the offer carries
    // the org column: the shortest chain in the population, and the only one
    // whose terminus is in the child's own package.
    const offerRoot = resolveTransitiveParent(offerLine!);
    expect(offerRoot).toMatchObject({
      className: 'XlImportedOffer',
      scope: 'org',
      key: 'organizationId',
    });

    // `invoice_ledger`'s two tables are `@OrgScoped` and no longer in this
    // population at all, which is the assertion above; that they carry a
    // resolved organization column is `configured-entities`' classification
    // total, and re-asserting it here would be a second answer to it.
  });
});
