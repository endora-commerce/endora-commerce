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
/** The nine child tables of a Sales Opportunity, each scoped through it. */
const CRM_OPPORTUNITY_CHILDREN = [
  'CrmOpportunityAttachment',
  'CrmOpportunityComment',
  'CrmOpportunityEvent',
  'CrmOpportunityLink',
  'CrmOpportunityMessageRead',
  'CrmOpportunityReference',
  'CrmOpportunityStatusHistory',
  'CrmOpportunityTag',
  'CrmStatusPropagation',
] as const;

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
    // **A fourth stood here, `XlImportedOfferLine` -> `XlImportedOffer` (D-258),
    // and left with `comarch_xl` (feature 134, T069).** It was the one chain
    // entirely inside one package. The committed platform holds no other, so
    // this population no longer carries that shape; the mechanism it rode — a
    // parent resolved by name through a transitively scoped class to an org
    // terminus, in any registration order — stays driven over fixtures by
    // `packages/platform/src/tenancy/transitive-parent-resolution.test.ts`, and
    // the paid package keeps its own classification test
    // (`src/backend/entities/tenant-classification.test.ts`).
    // **Seven more since `specs/143-crm-sales-opportunities/`**, and they bring
    // back the shape the fourth carried: a chain entirely inside one package.
    // Every child table of a Sales Opportunity — links, status history,
    // propagation outcomes, comments, attachments, tag joins, references — is
    // scoped through `CrmOpportunity`, which carries the organization column.
    // One hop each, parent and children owned by the same module, so none of
    // them repeats the dependant-owned-parent defect recorded above.
    // **One more since `specs/146-quote-request-pricing-history/`**:
    // `QuoteRequestAccountPolicy` -> `CustomerAccount`, a cross-module hop to a
    // parent owned by `customer_accounts`, which `quote_requests` declares in
    // its manifest `dependencies` — so the closure rule of
    // `transitive-parent-module-ownership.test.ts` holds. The row follows the
    // account rather than copying an organization id that would go stale when
    // the account moves (research R10).
    // **Two more since `specs/159-quote-request-item-groups/`** (research R-7):
    // `QuoteRequestItemGroup` -> `QuoteRequest` and `OrderItemGroup` -> `Order`,
    // each a named group of its document's lines, one hop to a parent owned by
    // the same module — the shape of the CRM children.
    // **One more since `specs/170-forms-module/`** (research § Principle XI
    // review): `FormEntryNote` -> `FormEntry`, an employee's note on a form
    // entry, one hop to a parent owned by the same module — and the first chain
    // here whose terminus is `customer`-scoped rather than `org`-scoped.
    expect(transitive.map((meta) => meta.className).sort()).toEqual(
      [
        ...CRM_OPPORTUNITY_CHILDREN,
        'FormEntryNote',
        'Invoice',
        'InvoiceExternalAttachment',
        'OrderItemGroup',
        'QuoteRequestAccountPolicy',
        'QuoteRequestItemGroup',
      ].sort(),
    );
    for (const [className, parentClassName, fk] of [
      ['QuoteRequestItemGroup', 'QuoteRequest', 'quoteRequestId'],
      ['OrderItemGroup', 'Order', 'orderId'],
    ] as const) {
      const group = transitive.find((meta) => meta.className === className);
      expect(group, className).toMatchObject({ parentClassName, fk });
      expect(resolveTransitiveParent(group!), className).toMatchObject({
        className: parentClassName,
        scope: 'org',
        key: 'organizationId',
      });
    }
    const formEntryNote = transitive.find((meta) => meta.className === 'FormEntryNote');
    expect(formEntryNote).toMatchObject({ parentClassName: 'FormEntry', fk: 'entryId' });
    expect(resolveTransitiveParent(formEntryNote!)).toMatchObject({ className: 'FormEntry', scope: 'customer' });
    const accountPolicy = transitive.find((meta) => meta.className === 'QuoteRequestAccountPolicy');
    expect(accountPolicy).toMatchObject({ parentClassName: 'CustomerAccount', fk: 'customerAccountId' });
    expect(resolveTransitiveParent(accountPolicy!)).toMatchObject({
      className: 'CustomerAccount',
      scope: 'org',
      key: 'organizationId',
    });
    for (const className of CRM_OPPORTUNITY_CHILDREN) {
      const child = transitive.find((meta) => meta.className === className);
      expect(child, className).toMatchObject({
        parentClassName: 'CrmOpportunity',
        fk: 'opportunityId',
      });
      expect(resolveTransitiveParent(child!), className).toMatchObject({
        className: 'CrmOpportunity',
        scope: 'org',
        key: 'organizationId',
      });
    }
    // `KsefSubmission` (`Invoice`'s chain, owned by a dependant) was a member
    // too, until `ksef` left this repository (feature 134, T069). Its two-hop
    // walk below is carried by `InvoiceExternalAttachment`, the one other class
    // on the same chain.

    const invoice = transitive.find((meta) => meta.className === 'Invoice');
    const attachment = transitive.find(
      (meta) => meta.className === 'InvoiceExternalAttachment',
    );
    expect(invoice).toMatchObject({ parentClassName: 'Order', fk: 'orderId' });
    expect(attachment).toMatchObject({ parentClassName: 'Invoice', fk: 'invoiceId' });

    // InvoiceExternalAttachment -> Invoice -> Order, and Order carries the org
    // column.
    const middle = resolveTransitiveParent(attachment!);
    expect(middle.className).toBe('Invoice');
    const root = resolveTransitiveParent(middle);
    expect(root).toMatchObject({ className: 'Order', scope: 'org', key: 'organizationId' });

    // `invoice_ledger`'s two tables are `@OrgScoped` and no longer in this
    // population at all, which is the assertion above; that they carry a
    // resolved organization column is `configured-entities`' classification
    // total, and re-asserting it here would be a second answer to it.
  });
});
