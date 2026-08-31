// Module-Contributed Admin Actions — feature 020 contract surface.
//
// Modules declare zero-or-more actions inline in their manifest's
// `actions` field. Each action becomes a row in the platform's
// command-palette Actions group at install time. This file defines:
//
//   1. The closed allowlist of icon names a module may reference (kept
//      small on purpose — adding a new icon is a one-line PR reviewed
//      alongside the action that needs it).
//   2. The Zod schema for a single declared action.
//   3. The `actions` array shape attached to ModuleManifestSchema, with
//      a `superRefine` rejecting duplicate ids within a single module.
//   4. The HTTP query and response envelope for
//      `GET /api/v1/admin/admin-actions`.
//
// Permission codes are NOT format-constrained — the codebase uses a mix
// of colon (`catalog:write`) and dot (`cms.write`) notation; this
// feature passes whatever the module declares verbatim to the existing
// hasPermission() check (research §R8).

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Closed allowlist of icon names. Each entry corresponds 1:1 to a
// lucide-react component name. The admin shell maps strings to
// components in admin/src/lib/admin-actions/icon-map.ts.
// ---------------------------------------------------------------------------

export const KnownIconNameSchema = z.enum([
  // generic
  'Plus',
  'Sparkles',
  'Settings',
  'Search',
  'Boxes',
  'Layers',
  'Menu',
  // create / write
  'PlusCircle',
  'PlusSquare',
  'FilePlus',
  'FolderPlus',
  // import / upload
  'Upload',
  'FileUp',
  'CloudUpload',
  // export / download
  'Download',
  'FileDown',
  // documents
  'FileText',
  'BookOpen',
  // syndication
  'Rss',
  // commerce
  'Package',
  'Tag',
  'ShoppingCart',
  'Receipt',
  // Feature 076 (D-83 item 8) — `payment_methods`' landing action. The same
  // icon the sidebar already renders for `/payment-methods`.
  'CreditCard',
  // people
  'Users',
  'UserPlus',
  // workflows
  'Inbox',
  'ListChecks',
  'ClipboardList',
  // media
  'Image',
  'Video',
  // navigation
  'LayoutDashboard',
  'PanelLeft',
  // security
  'KeyRound',
  // Feature 091 (Phase 4, batch four) — `admin_roles`' sidebar entry and
  // palette action, which became module declarations and therefore have to name
  // their icon rather than import it. The allowlist is what a nav entry's
  // `icon` is validated against too, so the glyph `AppShell.tsx` rendered by
  // hand joins it here instead of the entry silently changing to a name that
  // happened to be on the list.
  'ShieldCheck',
  // Feature 080 (D-163.1) — the six icons the dashboard's recent-activity
  // renderings used before they became manifest declarations. They were
  // lucide imports inside `admin/src/modules/home/activity-render.ts`, which
  // is the hand-maintained table that ruling retires; a declared icon has to
  // come from this allowlist like every other, so they join it here.
  'Edit',
  'Archive',
  'Box',
  'Truck',
  'CircleDollarSign',
  'Activity',
  // Feature 091 (Phase 4, batch two) — `analytics`' sidebar entry, which became
  // a module declaration and therefore has to name its icon rather than import
  // it. The allowlist is what a nav entry's `icon` is validated against too, so
  // the glyph `AppShell.tsx` rendered by hand joins it here instead of the
  // entry silently changing to a name that happened to be on the list.
  'LineChart',
  // Feature 091 (Phase 4, batch six) — `pwa`' sidebar entry, which became a
  // module declaration and therefore has to name its icon rather than import
  // it. Same rule as the two entries above and the same reason for adding a
  // name rather than reusing one: the entry keeps the glyph `AppShell.tsx`
  // drew for it, so nothing an operator sees moves with the declaration.
  'Smartphone',
  // Feature 091 (Phase 4, the plan's batch 6) — `webhooks`' and `comparisons`'
  // sidebar entries and palette actions, for the same reason: the two glyphs
  // `AppShell.tsx` imported from `lucide-react` by hand have to be nameable now
  // that the declarations are the modules' own. `api_keys` needed nothing —
  // `KeyRound` is already above, because `credentials`' row renders it too.
  //
  // The batch numbers collide and the members do not: !1214 shipped `pwa` as
  // "batch six" while `plan.md`'s batch 6 is this set. Both entries stand.
  'Webhook',
  'Scale',
  // Feature 092 (`specs/092-pimcore-pim-sync/`) — `pim_pimcore`'s sidebar entry.
  // The glyph `pim_ergonode`'s hand-written NAV row already renders for the
  // connector directly above it; a module declaration has to name its icon
  // rather than import it, so the name joins the allowlist here instead of the
  // entry degrading to one that happens to be on it already.
  'PlugZap',
  // Feature 091 (Phase 4, the plan's batch 7) — `promotions`' two sidebar
  // entries and its two palette rows, which become module declarations here and
  // therefore have to name their icon rather than import it. Both rows drew the
  // same glyph by hand in `AppShell.tsx`, so one name keeps both exactly as they
  // were; the alternative is the entry degrading to a name that happens to be on
  // the list already. `payment_methods`, `customer_accounts` and `product_feeds`
  // need nothing — `CreditCard`, `Users` and `Rss` are all above, each added by
  // an earlier palette action of that same module.
  'PercentDiamond',
]);
export type KnownIconName = z.infer<typeof KnownIconNameSchema>;

// ---------------------------------------------------------------------------
// Field-level patterns
// ---------------------------------------------------------------------------

const actionIdRe = /^[a-z][a-z0-9-]*$/;
const translationKeyRe = /^[a-z][a-zA-Z0-9_]*(\.[a-z][a-zA-Z0-9_]*)*$/;
const adminRouteRe = /^\/[A-Za-z0-9/_-]*$/;

// ---------------------------------------------------------------------------
// Manifest-side action declaration
// ---------------------------------------------------------------------------

export const ModuleActionSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(actionIdRe, 'Action id must be lowercase slug (letters, digits, dashes; leading letter)'),
  labelKey: z.string().min(1).max(255).regex(translationKeyRe, 'Translation key must be dot-separated camelCase namespaces'),
  descriptionKey: z
    .string()
    .min(1)
    .max(255)
    .regex(translationKeyRe, 'Translation key must be dot-separated camelCase namespaces')
    .optional(),
  icon: KnownIconNameSchema,
  targetRoute: z
    .string()
    .min(2)
    .max(255)
    .regex(adminRouteRe, 'Admin route must be a leading-slash ASCII path'),
  /**
   * Permission code passed verbatim to the admin's hasPermission(). The
   * codebase mixes colon and dot notation; both are accepted by design.
   */
  requiredPermission: z.string().min(1).max(64).optional(),
  keywords: z.array(z.string().trim().min(1).max(64)).max(10).default([]),
  weight: z.number().int().min(0).max(9999).default(100),
});
export type ModuleAction = z.infer<typeof ModuleActionSchema>;

/**
 * Top-level `actions` array on a module's manifest. Enforces
 * within-module id uniqueness — duplicates fail the install with a
 * clear, indexed error rather than silently dropping one (FR-005).
 */
export const ModuleActionsManifestSchema = z
  .array(ModuleActionSchema)
  .max(50, 'A single module cannot declare more than 50 actions')
  .superRefine((actions, ctx) => {
    const seen = new Map<string, number>();
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (!action) continue;
      const id = action.id;
      const prev = seen.get(id);
      if (prev !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'id'],
          message: `Duplicate action id "${id}" — first seen at index ${prev}`,
        });
      } else {
        seen.set(id, i);
      }
    }
  });
export type ModuleActionsManifest = z.infer<typeof ModuleActionsManifestSchema>;

// ---------------------------------------------------------------------------
// HTTP — GET /api/v1/admin/admin-actions
// ---------------------------------------------------------------------------

// Imported via re-export from admin-i18n.ts to avoid a circular import.
// The HTTP handler validates the language enum the same way the i18n
// endpoint does (feature 019).

import { SupportedAdminLanguageSchema } from './admin-i18n.js';

export const GetAdminActionsQuerySchema = z.object({
  language: SupportedAdminLanguageSchema,
});
export type GetAdminActionsQuery = z.infer<typeof GetAdminActionsQuerySchema>;

/**
 * Per-row view returned by the endpoint. Labels and descriptions are
 * already resolved into the requested language by the server; the
 * admin renders them verbatim. `keywords` is the raw list as declared
 * in the manifest — the admin applies its own diacritic-insensitive
 * normalize at filter time.
 */
export const AdminActionViewSchema = z.object({
  moduleId: z.string(),
  actionId: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  icon: KnownIconNameSchema,
  targetRoute: z.string(),
  keywords: z.array(z.string()),
  weight: z.number().int(),
});
export type AdminActionView = z.infer<typeof AdminActionViewSchema>;

export const GetAdminActionsResponseSchema = z.object({
  data: z.array(AdminActionViewSchema),
  meta: z.object({
    language: SupportedAdminLanguageSchema,
    total: z.number().int().nonnegative(),
    /** MAX(version) across the visible rows; 0 when `data` is empty. */
    registryVersion: z.number().int().nonnegative(),
  }),
});
export type GetAdminActionsResponse = z.infer<typeof GetAdminActionsResponseSchema>;
