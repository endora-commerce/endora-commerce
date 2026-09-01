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
]);

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
  'invoice.detail.after': InvoiceDetailZoneProps;
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
