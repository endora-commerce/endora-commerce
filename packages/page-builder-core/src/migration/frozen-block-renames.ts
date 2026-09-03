// The frozen block-rename map — feature 096, T402.
//
// **Frozen. Closed. Read by the five rename migrations and by the operator's
// pre-flight report, and by nothing else** (`contracts/block-name-migration.md`
// §3.3, §6; `contracts/block-name-check.md` §9).
//
// It is a *historical constant*, not an alias table. The owner rejected a
// permanent alias map on 2026-09-02: names are namespaced once, in the data,
// and the application then knows one vocabulary. The difference between the two
// designs is only real while this file cannot be read from a runtime path, which
// is what `backend/test/unit/cms/frozen-map-not-on-a-runtime-path.test.ts`
// asserts — without it the first resolver that reaches for the map turns this
// design into the thing that was rejected, silently.
//
// **Editing an entry retroactively changes what five applied migrations meant.**
// A database migrated under an old entry keeps the name that entry produced; a
// database migrated after the edit gets the new one, and nothing reconciles the
// two. The digest in `frozen-block-renames.test.ts` is what makes that edit a
// failing test rather than a silent divergence.
//
// **Structural properties, each load-bearing rather than tidy**
// (`data-model.md` §6):
//
// - Every **key** is bare — no `.` anywhere in the domain.
// - Every **value** is namespaced — every name in the codomain carries one.
// - Domain and codomain are therefore **disjoint**, which is what makes the
//   rename idempotent *by construction*: a second run finds no key and rewrites
//   nothing. FR-013 needs no dot test in the SQL and none is written there.
// - It is a **bijection** — 74 distinct keys onto 74 distinct values — which is
//   what makes `down()` exact over the frozen set.
//
// A block born after this feature is namespaced from birth and has **no entry
// here**. The map does not grow (FR-016).

/**
 * The 74 pre-096 bare block names, each mapped to the namespaced name the
 * declaring module now owns. Grouped by owner, in each manifest's own
 * declaration order.
 */
export const FROZEN_BLOCK_RENAMES: Readonly<Record<string, string>> = Object.freeze({
  // catalog — 8
  ProductCard: 'catalog.ProductCard',
  ProductGrid: 'catalog.ProductGrid',
  ProductSlider: 'catalog.ProductSlider',
  CategoryList: 'catalog.CategoryList',
  CategoryGrid: 'catalog.CategoryGrid',
  EmailProductCard: 'catalog.EmailProductCard',
  EmailProductGrid: 'catalog.EmailProductGrid',
  EmailCategoryGrid: 'catalog.EmailCategoryGrid',
  // cms — 30
  Row: 'cms.Row',
  Spacer: 'cms.Spacer',
  Heading: 'cms.Heading',
  Text: 'cms.Text',
  RichContent: 'cms.RichContent',
  Button: 'cms.Button',
  Image: 'cms.Image',
  Icons: 'cms.Icons',
  Social: 'cms.Social',
  FeatureList: 'cms.FeatureList',
  Hero: 'cms.Hero',
  LogoStrip: 'cms.LogoStrip',
  Testimonial: 'cms.Testimonial',
  Stats: 'cms.Stats',
  AnnouncementBar: 'cms.AnnouncementBar',
  SimpleTable: 'cms.SimpleTable',
  Video: 'cms.Video',
  Map: 'cms.Map',
  ContentSlider: 'cms.ContentSlider',
  ImageSlider: 'cms.ImageSlider',
  Tabs: 'cms.Tabs',
  Accordion: 'cms.Accordion',
  Column: 'cms.Column',
  Slide: 'cms.Slide',
  NewsletterSignup: 'cms.NewsletterSignup',
  ContactFormEmbed: 'cms.ContactFormEmbed',
  RawHtml: 'cms.RawHtml',
  RawJs: 'cms.RawJs',
  InsertBlock: 'cms.InsertBlock',
  InsertTemplate: 'cms.InsertTemplate',
  // invoices — 10
  InvoiceHeader: 'invoices.InvoiceHeader',
  InvoiceParties: 'invoices.InvoiceParties',
  InvoiceLineItems: 'invoices.InvoiceLineItems',
  InvoiceVatSummary: 'invoices.InvoiceVatSummary',
  InvoiceTotals: 'invoices.InvoiceTotals',
  InvoiceNotes: 'invoices.InvoiceNotes',
  InvoiceSpacer: 'invoices.InvoiceSpacer',
  InvoiceDivider: 'invoices.InvoiceDivider',
  InvoiceLogo: 'invoices.InvoiceLogo',
  InvoiceFooter: 'invoices.InvoiceFooter',
  // ksef — 1
  // The one entry whose local segment moved. The block was stored as
  // `InvoiceKsef` and is declared as `ksef.InvoiceSection` — the owner ruling
  // of 2026-09-02 gave it to `ksef`, and `ksef.InvoiceKsef` would have stuttered
  // the owner into the local name (`data-model.md` §7.3).
  InvoiceKsef: 'ksef.InvoiceSection',
  // orders — 8
  EmailOrderId: 'orders.EmailOrderId',
  EmailOrderSummary: 'orders.EmailOrderSummary',
  EmailOrderTotals: 'orders.EmailOrderTotals',
  EmailAppliedDiscounts: 'orders.EmailAppliedDiscounts',
  EmailDeliveryMethod: 'orders.EmailDeliveryMethod',
  EmailPaymentMethod: 'orders.EmailPaymentMethod',
  EmailShippingAddress: 'orders.EmailShippingAddress',
  EmailBillingAddress: 'orders.EmailBillingAddress',
  // transactional_emails — 17
  EmailHeading: 'transactional_emails.EmailHeading',
  EmailText: 'transactional_emails.EmailText',
  EmailRichText: 'transactional_emails.EmailRichText',
  EmailButton: 'transactional_emails.EmailButton',
  EmailImage: 'transactional_emails.EmailImage',
  EmailLogo: 'transactional_emails.EmailLogo',
  EmailSocial: 'transactional_emails.EmailSocial',
  EmailCallout: 'transactional_emails.EmailCallout',
  EmailFooterLegal: 'transactional_emails.EmailFooterLegal',
  EmailSection: 'transactional_emails.EmailSection',
  EmailRow: 'transactional_emails.EmailRow',
  EmailTable: 'transactional_emails.EmailTable',
  EmailDivider: 'transactional_emails.EmailDivider',
  EmailSpacer: 'transactional_emails.EmailSpacer',
  EmailInsertBlock: 'transactional_emails.EmailInsertBlock',
  EmailInsertTemplate: 'transactional_emails.EmailInsertTemplate',
  EmailColumn: 'transactional_emails.EmailColumn',
});

/**
 * The inverse of {@link FROZEN_BLOCK_RENAMES}, used by every `down()`.
 *
 * Derived rather than written, so the two cannot come to disagree; the
 * bijection assertion in the companion test is what makes the derivation safe.
 */
export const FROZEN_BLOCK_RENAMES_INVERSE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(FROZEN_BLOCK_RENAMES).map(([bare, namespaced]) => [namespaced, bare])),
);
