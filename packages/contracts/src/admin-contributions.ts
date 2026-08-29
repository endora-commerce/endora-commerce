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
 * **Derived, not designed.** The opening members are exactly the places the
 * measured module additions reached into by editing another module's file:
 * `068-inpost-shipping` edited `admin/src/modules/orders/OrderShipmentsTab.tsx`
 * and `admin/src/modules/delivery_methods/DeliveryMethodsPage.tsx`, and
 * `dhl_parcel` edited three files under `admin/src/modules/orders/`. The set
 * grows every release, in D-23's "generous by construction" direction; it never
 * grows by a module inventing a name.
 *
 * Both directions refuse: a contribution to a zone nobody declares is a build
 * refusal, and a zone the platform declares that no host screen renders is one
 * too. A contribution that silently renders nowhere is worse than one that
 * fails.
 */
export const AdminZoneNameSchema = z.enum([
  /** The order detail's tab strip. */
  'order.detail.tabs',
  /** Row actions on the delivery-methods list. */
  'delivery_method.row.actions',
  /** Row actions on the payment-methods list. */
  'payment_method.row.actions',
  /** The product editor's right-hand sidebar, below the platform's own panels. */
  'product.editor.sidebar.after',
]);

export type AdminZoneName = z.infer<typeof AdminZoneNameSchema>;

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

/** The data half of a contribution into another module's screen. */
export const AdminZoneContributionSchema = z.object({
  zone: AdminZoneNameSchema,
  weight: z.number().int(),
  requiredPermission: PermissionRequirementSchema.optional(),
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
