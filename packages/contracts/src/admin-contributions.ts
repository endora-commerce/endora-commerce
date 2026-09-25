/**
 * What a module package's `./admin` layer declares (feature 091, Principle II).
 *
 * These are **declarations, not components**, and the distinction is the whole
 * design. Three consumers need a contribution to be enumerable without being
 * executed: the registry generator, which writes an artefact naming every
 * contribution and must not import a React tree to do it; the bundler, which
 * has to see a `() => import('…')` factory as a split point and cannot follow a
 * computed specifier; and the gating predicate, which decides visibility from
 * `{ module, requiredPermission }` before anything renders. So a contribution
 * is a plain object whose only function-valued field is a dynamic-import
 * factory — the shape a `manifest.ts`'s `actions` array already has one layer
 * up, and the reason the ⌘K palette is the one admin extension mechanism that
 * needs no host edit today.
 *
 * They live here rather than in a types-only package because they cross a
 * package boundary and Principle II puts a shape that does in
 * `packages/contracts/`, beside `ModuleManifest` and `ModuleActionSchema`.
 *
 * **The component factory is a TypeScript type and not a Zod schema, and the
 * split is deliberate.** Everything a generator, a check or a server can
 * validate is a schema below; the factory is `unknown` to Zod because a
 * function value carries nothing to validate beyond its arity, and pretending
 * otherwise would put a `z.function()` in a package `admin` and `storefront`
 * both compile while telling a reader it was checked. The data half is
 * `AdminRouteDeclarationSchema`; the whole declaration, factory included, is
 * the `AdminRouteDeclaration` interface.
 */
import { z } from 'zod';

import { KnownIconNameSchema } from './admin-actions.js';
import type { InvoiceKind } from './invoices.js';
import type { ShipmentStatus } from './shipping-methods.js';

// ---------------------------------------------------------------------------
// Field-level patterns
// ---------------------------------------------------------------------------

/**
 * An admin route path, as `react-router` reads it.
 *
 * The manifest action's `targetRoute` pattern plus `:` — a palette entry points
 * at a landing screen and may not carry a parameter, while a route table is
 * mostly parametric (`/orders/:id`). No query string, in both.
 */
const adminRoutePathRe = /^\/[A-Za-z0-9/_:-]*$/;

/**
 * A module-relative translation key: `nav.crm.label`, never
 * `crm.nav.crm.label`.
 *
 * The same rule a palette action's `labelKey` follows, and the same silent
 * failure if it is broken: the module's bundle is a flat
 * `{"a.b.c": "text"}` map, a nested object fails
 * `TranslationBundleEntriesSchema`, the boot reconciler logs and skips it, and
 * the entry renders its raw key.
 */
const translationKeyRe = /^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)*$/;

// ---------------------------------------------------------------------------
// Permission requirement
// ---------------------------------------------------------------------------

/**
 * A permission code, or a set of codes any one of which suffices.
 *
 * The array form exists because the routes have it: `requireAdminAny([…])` is
 * satisfied by either member, and naming only the first in the UI hides the
 * screen from a role that holds the second. It is the shape
 * `admin/src/lib/surface-visibility.ts` already defines, published here so a
 * module package declares it without reaching into the admin for the type.
 */
export const PermissionRequirementSchema = z.union([
  z.string().min(1).max(128),
  z.array(z.string().min(1).max(128)).min(1),
]);

export type PermissionRequirement = z.infer<typeof PermissionRequirementSchema>;

// ---------------------------------------------------------------------------
// Nav sections
// ---------------------------------------------------------------------------

/**
 * The sidebar sections a module may join — closed, and derived from the ones
 * `admin/src/components/AppShell.tsx` already declares.
 *
 * A module may not invent a section, for D-23's reason: an invented section is
 * a heading nobody else can join, so two modules that belong together end up in
 * two headings of one each and the operator reads it as two features.
 */
export const AdminNavSectionNameSchema = z.enum([
  'main',
  'sales',
  'catalog',
  'inventory',
  'pricing',
  'customers',
  'channels',
  'content',
  'messaging',
  'newsletter',
  'analyticsAds',
  'system',
]);

export type AdminNavSectionName = z.infer<typeof AdminNavSectionNameSchema>;

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

/**
 * The places in a screen one module owns where another module's contribution
 * may appear — closed, hierarchical, dot-separated, and the platform's.
 *
 * **A member exists when a host renders it, and not before.** The four members
 * this enum opened with were derived from the places module additions had
 * reached into by editing another module's file, which was the right derivation
 * and produced a set nothing rendered and nothing contributed to — four names
 * that had been silent since the enum landed. `check:admin-zones` reports every
 * one of those as `unrendered-zone`, and it carries **no ledger**, deliberately:
 * the remedy is always available in the same merge request, and it is either to
 * render the place or to remove the name. So the set grows with the batch that
 * mounts it, one member per place a host screen actually renders.
 *
 * `payment_method.row.actions` is the member that shows why. Measured, nothing
 * under the payment-methods admin surface names a gateway id at all — the five
 * gateways were given their own routes and settings screens — so there was
 * nothing waiting to contribute and inventing a host for it would have been
 * inventing a host.
 *
 * **Closed and unparameterised, and that is load-bearing.** A parameter in the
 * name (`product.editor.field:<fieldPath>`, or a `z.templateLiteral`) was
 * rejected: the refusal below compares declared names to rendered ones, and a
 * name computed from a field path compares to nothing. The parameter is a prop
 * — see {@link AdminZonePropsMap} — and one member may be mounted many times on
 * one screen, each mount carrying its own.
 *
 * Both directions refuse: a contribution to a zone nobody declares is a build
 * refusal, and a zone the platform declares that no host screen renders is one
 * too. A contribution that silently renders nowhere is worse than one that
 * fails.
 */
export const AdminZoneNameSchema = z.enum([
  /**
   * Above the product editor's Details tab, before the platform's own fields.
   *
   * Mounted **once** per editor. Props: {@link ProductEditorZoneProps}.
   */
  'product.editor.details.before',
  /**
   * Above the product editor's Pricing tab.
   *
   * Mounted **once** per editor. Props: {@link ProductEditorZoneProps}.
   */
  'product.editor.pricing.before',
  /**
   * Beside one editable field of the product editor.
   *
   * Mounted **once per field** — `name`, `description`, `categories`,
   * `gallery`, `attachments`, and once per attribute row — each mount carrying
   * that field's own {@link ProductEditorFieldZoneProps}. One member, twelve
   * mount points, and a contributor that renders on all of them declares one
   * contribution: the fan-out is the mount's, not the name's.
   */
  'product.editor.field.after',
  /**
   * The integrations card on the delivery-methods list — one entry per shipping
   * integration a module supplies, each linking to that module's own
   * configuration screen.
   *
   * Mounted **once** per list screen and carrying no props, so its entry in
   * {@link AdminZonePropsMap} is the empty object. That is not a placeholder
   * for a parameter nobody has thought of yet: the host has no identifier to
   * pass — the contributions *are* the integrations, and a contributor renders
   * a card describing itself.
   *
   * It is the first member whose host is not `catalog`'s product editor, and
   * the first whose contributors are the modules that used to be **named** by
   * the host: `delivery_methods` hard-coded a `dhl_parcel` block and an
   * `inpost` block, each with the other module's title, description, route and
   * permission code, which
   * `backend/scripts/ledgers/foreign-module-ids.ts` recorded as two
   * `visibility-gate` couplings with this conversion as their retiring
   * condition. Props: {@link DeliveryMethodIntegrationsZoneProps}.
   */
  'delivery_method.list.integrations',
  /**
   * The integrations card on the payment-methods list — one entry per online
   * payment adapter a module supplies, each linking to that module's own
   * configuration screen.
   *
   * Mounted once per list screen and carrying no props. The free host owns the
   * place and its heading; separately shipped gateway modules own the cards.
   * Props: {@link PaymentMethodIntegrationsZoneProps}.
   */
  'payment_method.list.integrations',
  /**
   * Below the invoice detail's totals column, at the end of the right-hand
   * stack.
   *
   * Mounted **once** per invoice detail screen. Props:
   * {@link InvoiceDetailZoneProps}.
   *
   * The first member whose host is `invoices` and whose contributor is `ksef`.
   * `invoices`' invoice detail imported `ksef`'s `InvoiceKsefPanel` by path —
   * the single key in
   * `backend/scripts/ledgers/cross-module-imports/invoices.ts`, whose recorded
   * retiring condition is this member existing. Z1 question 1 is answered from
   * the panel's own signature: `(invoiceId, kind, ksefReferenceNumber)` — three
   * values in, nothing out, no `onChange` — so it is question 2's case, an
   * addition the owner makes because the owner is installed.
   *
   * **Per-host and not a shared `invoice.detail.after` twin of some general
   * member** (§10 Z13): a member shared by two hosts lets one host's mount
   * cover the other host's absence, which is the failure `unrendered-zone`
   * exists to refuse.
   */
  'invoice.detail.after',
  /**
   * The end of the category editor's form, after its save/cancel row.
   *
   * Mounted **once** per open category, and named from the host's own word for
   * the place (Z14): `catalog`'s `CategoriesTree.tsx` is the editor, and the
   * place is *after* everything the editor itself offers. Props:
   * {@link CategoryEditorZoneProps}.
   *
   * The first member whose contributor is `price_lists`. `catalog` imported
   * `DisplayModeOverrideRow` by path and handed it its own label and its own
   * hint — one of the three admin keys in
   * `backend/scripts/ledgers/cross-module-imports/catalog.ts`. A host cannot
   * hand copy to a contributor it does not know, so the two `catalog` strings
   * go with the import and the control renders `price_lists`' own.
   */
  'category.editor.after',
  /**
   * The end of the product editor's Pricing tab.
   *
   * Mounted **once** per editor, and the twin of
   * `product.editor.pricing.before`: two places in one editor, one before the
   * platform's own pricing fields and one after them. Props:
   * {@link ProductEditorZoneProps}, reused rather than aliased — a props type
   * is the *shape* the mount carries, and both places carry a product id.
   */
  'product.editor.pricing.after',
  /**
   * The **body** of the product editor's Channels tab.
   *
   * Mounted **once** per editor. Props: {@link ProductEditorZoneProps}.
   *
   * The host keeps the tab strip and the label — `channels` is `catalog`'s own
   * tab id — and stops knowing which module fills it: the button is shown by
   * `useAdminZone(name, props).length > 0` (Z15), which has already applied
   * both presence axes and the contributor's permission. A strip zone that
   * contributed the button too was rejected: one contributor, one host, and the
   * label is the host's own vocabulary.
   */
  'product.editor.channels',
  /**
   * Below the sales-channel editor's identity form.
   *
   * Mounted **once** per channel, and only for a channel that already exists —
   * the create form has no id to pass. Props:
   * {@link SalesChannelEditorZoneProps}.
   *
   * The first member whose host is `sales_channels` and whose contributor is
   * `inventory`. The panel behind it is warehouse↔channel routing, which is a
   * fact about fulfilment rather than about the channel's identity, and its
   * four routes take `inventory:read` / `inventory:write`.
   */
  'sales_channel.editor.after',
  /**
   * The stack of panels an organization's detail screen ends with.
   *
   * Mounted **once** per organization, and the "once" is a rule rather than a
   * layout choice (§10.1): two mounts of this member on one screen, with no
   * prop to tell them apart, render **every** contribution twice and nothing in
   * the renderer can distinguish them. Props:
   * {@link OrganizationDetailZoneProps}.
   *
   * The first member with four contributors, and the first whose conversion
   * makes scattered panels contiguous: `sales_channels`' channel membership,
   * `price_lists`' display-mode override and `quick_order`'s ordering defaults
   * sat at three different depths of
   * `admin/src/modules/organizations/OrganizationDetail.tsx`, each imported by
   * path — the three keys of
   * `backend/scripts/ledgers/cross-module-imports/organizations.ts`, whose
   * shard this member deletes. `carts` joins them with the cart-approval
   * policy, whose panel this host owned and nothing rendered (§10.5).
   *
   * **Per-host and not a shared `entity.detail.after`** (§10 Z13): the
   * `unrendered-zone` refusal is computed per member, so one host's mount would
   * cover another host's absence. `customer.detail.after` is the twin, and the
   * cost of keeping them apart is one four-line wrapper in `quick_order`.
   */
  'organization.detail.after',
  /**
   * The stack of panels a customer's detail screen ends with.
   *
   * Mounted **once** per customer, on `organization.detail.after`'s terms and
   * for its reasons. Props: {@link CustomerDetailZoneProps}.
   *
   * One contributor: `quick_order`'s ordering defaults, which
   * `admin/src/modules/customers/CustomerDetail.tsx` imported by path — the
   * single key of `backend/scripts/ledgers/cross-module-imports/customers.ts`,
   * whose shard this member deletes.
   */
  'customer.detail.after',
  /**
   * The **body** of the order detail's Payment tab.
   *
   * Mounted **once** per order, and named from the host's own word for the
   * place (Z14): `orders`' `OrderDetail.tsx` calls the tab `payment` and its
   * label `orderDetail.tabs.payment`. Props: {@link OrderDetailZoneProps}.
   *
   * The host keeps the tab strip and the label and stops knowing which module
   * fills it: the button is shown by `useAdminZone(name, props).length > 0`
   * (Z15), which has already applied both presence axes and the contributor's
   * permission. `orders` used to render `payments`' tab itself, gated on
   * `isVisible({ module: 'payments', requiredPermission: 'payments:read' })` —
   * the `visibility-gate` key of `backend/scripts/ledgers/foreign-module-ids.ts`
   * whose recorded retiring condition is this member.
   */
  'order.detail.payment',
  /**
   * The per-row action cell of the order detail's Delivery tab.
   *
   * Mounted **once per shipment attempt**, each mount carrying that attempt's
   * own {@link OrderShipmentRowZoneProps} — the first member in this enum whose
   * contributions narrow themselves with `match` rather than by returning
   * `null`, which is the population Z13 reserves for it: one host, one place,
   * many mounts.
   *
   * `providerCode` and `status` are props **because** they are matched on. A
   * key the mount's props do not carry never agrees (fail-closed), so a
   * contribution matching a prop this interface omits renders nowhere and
   * nothing reports it — which is why the two are declared here and not left
   * for the contributor to read out of a payload.
   *
   * `orders` used to write `inpost`'s knowledge into its own JSX —
   * `providerDetails?.['provider'] === 'inpost' && status === 'success'`, under
   * an `isVisible({ module: 'inpost', … })` gate and an `inpost` translation
   * namespace, which is two of the three `foreign-module-ids` keys this member
   * retires.
   */
  'order.shipment.row.actions',
  /**
   * The footer action bar of the order detail's Delivery tab.
   *
   * Mounted **once** per tab, below the attempts table and beside the host's
   * own "generate again" button. Props:
   * {@link OrderShipmentsActionsZoneProps}.
   *
   * Its contributor is the carrier the ledgers could not see: `dhl_parcel` was
   * named by **delivery-method code** (`'dhl_parcel_courier'`,
   * `'dhl_parcel_pickup'`) rather than by module id, so
   * `check:admin-zones`' `foreign-module-id` predicate — which reads module ids
   * out of strings — never had it in its population and never will. The three
   * buttons behind those codes carried **no permission gate at all** while the
   * routes behind them enforce `dhl_parcel:read` and `dhl_parcel:write`; a
   * contribution declares one code, so the conversion closes that
   * over-exposure by construction.
   */
  'order.shipments.tab.actions',
  /**
   * The switch between the two ways of entering an order, above the entry form.
   *
   * **A tab strip rather than a stack**, and the only member so far whose
   * renderer is `<RouteTabsZone>`: the contributions are the tabs, the host
   * supplies the strip, and *"fewer than two tabs is not a choice"* is the
   * strip counting what `useAdminZone` already filtered rather than a rule any
   * module states. Props: {@link OrderEntryTabsZoneProps}, which carries
   * nothing — the mount has no identifier to pass, exactly as
   * `delivery_method.list.integrations` has none.
   *
   * **Two hosts and one place, which is the one exception Z13 leaves open and
   * is stated here rather than discovered.** Z13 refuses a member shared by
   * hosts that each have *a place of their own*, because one host's mount then
   * covers another's absence. This is not that: the place is a single
   * navigational switch, and it appears on **both** of the pages it switches
   * between — `orders`' order-create screen and `quick_order`'s on-behalf
   * screen — because a switch visible from only one side is not a switch. The
   * cost is real and is the one Z13 names: deleting the mount from one of the
   * two screens leaves the member rendered, so `unrendered-zone` would not
   * report it. What does report it is
   * `admin/test/modules/orders/order-entry-tabs-zone.test.tsx`, which asserts
   * both mounts by name.
   *
   * The contributors are the two modules the strip used to be filtered *by*:
   * `admin/src/components/OrderEntryTabs.tsx` held a two-element array naming
   * `orders` and `quick_order`, each with the other module's route and the
   * other module's label out of the `core` bundle — the last two keys of
   * `backend/scripts/ledgers/admin-surface.ts`, which this member empties. Each
   * module now contributes its own tab, with its own label in its own bundle.
   */
  'order.entry.tabs',
  /**
   * The switch between invoice-ledger deliveries, routing, and vendor adapter
   * connection screens.
   *
   * **A tab strip**, same renderer as `order.entry.tabs`: `<RouteTabsZone>`.
   * `invoice_ledger` contributes Deliveries and Routing, and asks a vendor
   * adapter's connection tab to weigh more than its own two so that it sorts
   * after the screens it is a vendor of. The sidebar keeps one **Invoice
   * ledger** row. Props: {@link LedgerSectionTabsZoneProps}.
   *
   * **No vendor is named here.** One was until 2026-09-22, and the vendors are
   * what feature 134's wave 4 takes out of this repository — a free package's
   * source naming a paid module id is the reach that sweep exists to remove
   * (and a string literal is the spelling no instrument sees).
   *
   * The name is `ledger.section.tabs` and not `invoice_ledger.section.tabs`
   * so an adapter file that mounts the strip does not spell a sibling module
   * id (`check:admin-zones` `foreign-module-id`).
   *
   * **Many hosts and one place**, the same Z13 exception `order.entry.tabs`
   * records: the switch must appear on every page it switches between or it
   * is not a switch. `unrendered-zone` is per zone rather than per host, so
   * that is asserted **per contributing package**, in each one's own
   * `src/admin/index.test.ts` over a relative read of its own screens — which
   * is where it keeps working once the vendors are installed from tarballs
   * rather than resolved in this workspace (feature 134 W2.2, D-262 clause 3).
   * The strip's own mechanism is driven in
   * `admin/test/modules/invoice_ledger/ledger-section-tabs-zone.test.tsx`.
   */
  'ledger.section.tabs',
])

export type AdminZoneName = z.infer<typeof AdminZoneNameSchema>;

// ---------------------------------------------------------------------------
// Zone props
// ---------------------------------------------------------------------------

/** A zone mounted once per product editor. */
export interface ProductEditorZoneProps {
  readonly productId: string;
}

/**
 * A zone mounted once on the delivery-methods list, carrying nothing.
 *
 * Empty **by measurement, not by omission**: the host renders one card per
 * shipping integration and has no identifier to name one by — a contributor is
 * the integration. Declared as a named interface rather than as `object`
 * inline so the map's entry reads like every other one and so a prop this zone
 * later needs has one place to arrive.
 */
export interface DeliveryMethodIntegrationsZoneProps {}

/** The payment-method integrations mount carries no host-owned data. */
export interface PaymentMethodIntegrationsZoneProps {}

/**
 * A zone mounted once at the end of the invoice detail's totals column.
 *
 * Three props and not just the id, read off the one contribution's declared
 * signature rather than from the rule of thumb that a detail member carries
 * its entity's id: `kind` decides whether a KSeF panel applies at all (a
 * proforma is never filed) and `ksefReferenceNumber` is the invoice's own
 * stored reference, which the contributor shows until its first submission
 * carries one. Both are already loaded by the host — the mount costs no
 * request — and neither is `ksef`'s to fetch.
 */
export interface InvoiceDetailZoneProps {
  readonly invoiceId: string;
  /** `proforma` | `invoice` | `correction` — {@link InvoiceKind}. */
  readonly kind: InvoiceKind;
  readonly ksefReferenceNumber: string | null;
}

/**
 * A zone mounted once at the end of the category editor's form.
 *
 * The entity's own id and nothing else, which is what the one contribution
 * reads: `DisplayModeOverrideRow` takes a scope and a target id, and the scope
 * is the contributor's constant — `catalog`'s editor is always editing a
 * category.
 */
export interface CategoryEditorZoneProps {
  readonly categoryId: string;
}

/**
 * A zone mounted once below the sales-channel editor's identity form.
 *
 * The channel's **id**, not its code: every route the one contribution calls is
 * `/api/v1/admin/sales-channels/:channelId/warehouses`, and `channelId` there
 * is the id. The host has both loaded, so the mount costs no request.
 */
export interface SalesChannelEditorZoneProps {
  readonly channelId: string;
}

/**
 * A zone mounted once at the end of an organization's detail screen.
 *
 * The organization's own id and nothing else, which is the union of what the
 * four contributions read: three of them take an entity id and their own
 * constant scope, and the fourth — `carts`' approval policy — reads its own
 * initial state from a route of its own rather than taking the boolean the
 * host used to pass (§10.5). A prop only one contributor wants is a prop the
 * other three would have to be given a reason for (Z3).
 */
export interface OrganizationDetailZoneProps {
  readonly organizationId: string;
}

/**
 * A zone mounted once at the end of a customer's detail screen.
 *
 * The customer's own id, on the same terms as its organization twin. Not
 * aliased to {@link OrganizationDetailZoneProps} and not merged with it: the
 * prop is named for the entity the mount carries, and the two members are two
 * places (Z13).
 */
export interface CustomerDetailZoneProps {
  readonly customerId: string;
}

/**
 * A zone mounted once as the body of the order detail's Payment tab.
 *
 * The order's own id and nothing else, which is what the one contribution
 * reads: the panel fetches the order's payments and its invoices from two
 * routes that take an order id, and it owns both requests.
 */
export interface OrderDetailZoneProps {
  readonly orderId: string;
}

/**
 * A zone mounted once per shipment attempt on the order detail's Delivery tab.
 *
 * Five props, and the last two are here **because a contribution matches on
 * them**. `match` compares by string value against the mount's props and a key
 * the props do not carry never agrees, so a `providerCode` or a `status` left
 * out of this interface would hide its contribution rather than widen it — the
 * one way this conversion can regress in silence, and a `tsc` error at the
 * mount rather than at the declaration.
 *
 * `providerCode` is nullable because an attempt the carrier never answered has
 * no provider envelope, and a `null` there is the fail-closed direction: no
 * carrier's contribution agrees with it.
 */
export interface OrderShipmentRowZoneProps {
  readonly orderId: string;
  readonly shipmentId: string;
  /** The order's delivery-method code, e.g. `dhl_parcel_courier`. */
  readonly deliveryMethodCode: string;
  /**
   * Which carrier opened *this attempt*, from the adapter's own envelope —
   * `inpost`, `dhl_parcel`, or `null` when nothing was recorded.
   *
   * A provider code and not a module id: they coincide for both carriers today
   * and the string is data the adapter deposited, which is why
   * `check:admin-zones` reads it as neither.
   */
  readonly providerCode: string | null;
  /** {@link ShipmentStatus} — the attempt's own state, matched on. */
  readonly status: ShipmentStatus;
}

/**
 * A zone mounted once in the footer action bar of the order detail's Delivery
 * tab.
 *
 * The **latest** attempt and not the list: every action a carrier offers here
 * acts on the most recent attempt, which is the only one an operator can still
 * do anything about, and the host already computes it. Both latest fields are
 * nullable for an order with no attempt yet — a contributor that needs one
 * renders nothing, which it decides for itself rather than through `match`,
 * because `match` compares strings and has no negation.
 */
export interface OrderShipmentsActionsZoneProps {
  readonly orderId: string;
  /** The order's delivery-method code, which is what `dhl_parcel` matches on. */
  readonly deliveryMethodCode: string;
  readonly latestShipmentId: string | null;
  /** {@link ShipmentStatus} of the latest attempt, or `null` when there is none. */
  readonly latestStatus: ShipmentStatus | null;
}

/**
 * A zone mounted on the order-entry tab strip, carrying nothing.
 *
 * Empty **by measurement, not by omission**, on
 * {@link DeliveryMethodIntegrationsZoneProps}' terms: the contributions *are*
 * the tabs, and the host has no identifier to name one by — it is a switch
 * between two entry modes, not a view of an entity. Declared as a named
 * interface rather than inline so the map's entry reads like every other one.
 */
export interface OrderEntryTabsZoneProps {}

/**
 * A zone mounted on the invoice-ledger section strip, carrying nothing.
 *
 * Empty on {@link OrderEntryTabsZoneProps}' terms: the contributions are the
 * tabs, and the host has no entity id to pass.
 */
export interface LedgerSectionTabsZoneProps {}

/** A zone mounted beside one field of the product editor. */
export interface ProductEditorFieldZoneProps {
  readonly productId: string;
  /**
   * `name`, `description`, `categories`, `gallery`, `attachments`, or
   * `attributeValues.<key>`.
   */
  readonly fieldPath: string;
  /**
   * The locales this field is edited in, or `null` for a field that is not
   * language-scoped.
   *
   * The host passes the set; a contributor that wants one control per locale
   * fans out over it. That is what collapses the two `LOCALES.map(...)` loops
   * the product editor used to write around a foreign module's component into
   * one mount, and it is why the parameter is a prop rather than a parameter in
   * the zone name — see the rejection recorded on
   * {@link AdminZoneNameSchema}'s contract.
   */
  readonly languageCodes: readonly string[] | null;
}

/**
 * The props each zone carries, and the contract both ends are checked against.
 *
 * Declared as a `Record<AdminZoneName, object>`, so a member added to
 * {@link AdminZoneNameSchema} without a props type is a compile error in this
 * package — the half of the two-way refusal that needs no check.
 *
 * **`tsc` at both ends, and nothing at runtime.** The host writes
 * `<AdminZone name="product.editor.field.after" props={{ ... }} />`, generic on
 * the literal name; the contributor writes `zoneComponent('...', () => import(...))`,
 * whose type constrains its module's default export to
 * `ComponentType<AdminZoneProps<...>>`. The registry in the middle stays
 * `unknown` deliberately: both ends are checked against this one map, so the
 * map is the contract and the registry is a courier. A Zod schema parsed by the
 * renderer was rejected — the props flow host to contributor, so a wrong prop
 * is the first-party host's defect and `tsc` has already refused it, while the
 * failure a parse cannot catch (a contributor assuming a prop the zone does not
 * carry) is on the other side of the parse.
 */
export interface AdminZonePropsMap extends Record<AdminZoneName, object> {
  'product.editor.details.before': ProductEditorZoneProps;
  'product.editor.pricing.before': ProductEditorZoneProps;
  'product.editor.field.after': ProductEditorFieldZoneProps;
  'delivery_method.list.integrations': DeliveryMethodIntegrationsZoneProps;
  'payment_method.list.integrations': PaymentMethodIntegrationsZoneProps;
  'invoice.detail.after': InvoiceDetailZoneProps;
  'category.editor.after': CategoryEditorZoneProps;
  // Reused, not aliased: a props type is the shape the mount carries, and two
  // places in one editor that both carry a product id carry the same shape.
  'product.editor.pricing.after': ProductEditorZoneProps;
  'product.editor.channels': ProductEditorZoneProps;
  'sales_channel.editor.after': SalesChannelEditorZoneProps;
  'organization.detail.after': OrganizationDetailZoneProps;
  'customer.detail.after': CustomerDetailZoneProps;
  'order.detail.payment': OrderDetailZoneProps;
  'order.shipment.row.actions': OrderShipmentRowZoneProps;
  'order.shipments.tab.actions': OrderShipmentsActionsZoneProps;
  'order.entry.tabs': OrderEntryTabsZoneProps;
  'ledger.section.tabs': LedgerSectionTabsZoneProps;
}

/** The props of one zone, by name. */
export type AdminZoneProps<Z extends AdminZoneName> = AdminZonePropsMap[Z];

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

/**
 * The data half of a route declaration — everything a generator or a check can
 * read without evaluating the module's UI code.
 *
 * **Owner attribution is not a field.** The module id is the registry entry's
 * key, so a declaration cannot claim to belong to a module other than the one
 * that shipped it — the same reason a packaged migration is attributed to
 * `endora.id` and never to a path segment (D-142). An attribution a module can
 * write is an attribution a module can get wrong.
 */
export const AdminRouteDeclarationSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(255)
    .regex(adminRoutePathRe, 'Admin route must be a leading-slash ASCII path with no query string'),
  requiredPermission: PermissionRequirementSchema.optional(),
  /** Marks the module's landing route, so a nav entry can default to it. */
  index: z.boolean().optional(),
});

/**
 * The data half of a sidebar entry.
 *
 * Deliberately the same five fields `NAV` already carries in
 * `admin/src/components/AppShell.tsx`, so the sidebar renders
 * `[...hostNav, ...registryNav]` through the one existing predicate with no
 * second gate. Issue #230's finding — three surfaces answering the visibility
 * question three ways — does not get a fourth chance.
 */
export const AdminNavDeclarationSchema = z.object({
  to: z
    .string()
    .min(1)
    .max(255)
    .regex(adminRoutePathRe, 'Admin route must be a leading-slash ASCII path with no query string'),
  labelKey: z
    .string()
    .min(1)
    .max(255)
    .regex(translationKeyRe, 'Translation key must be dot-separated camelCase namespaces'),
  icon: KnownIconNameSchema,
  section: AdminNavSectionNameSchema,
  /** Order within the section. Ties are broken by module id, so it is stable. */
  weight: z.number().int(),
  requiredPermission: PermissionRequirementSchema.optional(),
});

/**
 * The data half of a contribution into another module's screen.
 *
 * A contribution declares **one** zone, so a component appearing in two zones
 * is two contributions — and only the one that needs narrowing carries a
 * {@link AdminZoneContributionSchema.shape.match}.
 */
export const AdminZoneContributionSchema = z.object({
  zone: AdminZoneNameSchema,
  weight: z.number().int(),
  requiredPermission: PermissionRequirementSchema.optional(),
  /**
   * Narrow this contribution to the mounts whose props agree with every key.
   *
   * The renderer includes the contribution when, for each key, the zone's props
   * carry that key with that value — or with a member of that array. Data only,
   * enumerable, and readable by a check.
   *
   * **It exists for FR-013 and not for tidiness.** One zone is mounted on many
   * screens; without `match` a contributor narrows by returning `null` for the
   * mounts it does not serve, which means its chunk is fetched and evaluated on
   * every one of them. `match` is decided **before** `React.lazy` is touched,
   * so the chunk is never requested. The alternative — a near-identical enum
   * member per case — is the openness the closed enum exists to refuse, wearing
   * a different hat.
   *
   * A key the zone's props do not carry never agrees, so a `match` naming a
   * prop that does not exist hides the contribution rather than widening it.
   */
  match: z
    .record(z.string(), z.union([z.string(), z.array(z.string()).readonly()]))
    .optional(),
});

/**
 * A lazily-loaded React component.
 *
 * Typed structurally rather than against `react`, because
 * `@endora-commerce/contracts` is compiled by the backend and must acquire no
 * React dependency: a module's admin layer resolves the application's own copy
 * of React through `@endora-commerce/admin-kit`'s peer dependencies, and the
 * declaration only has to say "a default export a bundler can split on".
 */
export type AdminComponentFactory = () => Promise<{ readonly default: unknown }>;

/** A route a module adds to the admin's route table. */
export interface AdminRouteDeclaration extends z.infer<typeof AdminRouteDeclarationSchema> {
  /**
   * A dynamic-import factory, and the **only** function-valued field.
   *
   * A statically imported component defeats FR-013 — an operator downloads the
   * page code of modules they cannot reach — and makes the registry evaluate
   * module UI code in order to be enumerated.
   */
  readonly component: AdminComponentFactory;
}

/** A sidebar entry a module adds. */
export type AdminNavDeclaration = z.infer<typeof AdminNavDeclarationSchema>;

/** A contribution a module makes into a zone another module's screen renders. */
export interface AdminZoneContribution extends z.infer<typeof AdminZoneContributionSchema> {
  readonly component: AdminComponentFactory;
}

/**
 * What a module package's `src/admin/index.ts` exports — and the only thing it
 * exports.
 *
 * All three arrays are optional, so a module shipping only a nav entry pointing
 * at a host route is legal and so is one shipping only a zone contribution.
 * The entry may not export a component, a hook or a service:
 * `check:module-boundary`'s D-171 rule designates a subpath as contract surface
 * when it emits **no runtime binding**, and `./admin` deliberately does not
 * qualify — it exports an object — so a consumer reaching into another module's
 * `./admin` is a counted boundary reach, which is the correct answer.
 */
export interface AdminContributions {
  readonly routes?: readonly AdminRouteDeclaration[];
  readonly nav?: readonly AdminNavDeclaration[];
  readonly zones?: readonly AdminZoneContribution[];
}
