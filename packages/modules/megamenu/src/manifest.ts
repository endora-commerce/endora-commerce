import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Megamenu module — feature 015.
 *
 * Owns the megamenu (multi-column dropdown navigation) configuration.
 * Manifest backfilled alongside feature 020.
 */
export const manifest = defineModuleManifest({
  id: 'megamenu',
  name: 'Megamenu',
  description: 'Multi-column dropdown navigation builder.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by — feature
  // 072 made it required rather than defaulting to a permissive no-op.
  // `dictionaries` owns the validator the menu service checks languages with.
  // `assets_library` owns the reference registry this module contributes its
  // asset-and-icon scan to (T143a); `cms` owns the one it contributes the
  // page/block scan to. Both edges existed as composition-root
  // cross-registrations, which is to say nowhere an operator could see them.
  // `languages` owns `languageReferenceRegistry`, the registry this module
  // contributes its "which languages do bindings carry" descriptor to (feature
  // 077, D-87). `languages` used to ask the question itself, with a
  // `count(*) from "megamenu_bindings"` naming this module's table.
  dependencies: [
    'assets_library',
    'cms',
    'languages',
    'sales_channels',
    'auth',
    'dictionaries',
  ],
  settings: {
    moduleCode: 'megamenu',
    groups: [{ code: 'megamenu', name: 'Megamenu' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'megamenu.enabled',
        name: 'Megamenu enabled',
        description:
          'Switches the megamenu admin screens, their API and the storefront navigation they drive on or off. Nothing is dropped: menus, items and channel bindings stay in the database and reappear exactly as configured when you switch it back on.',
        groupCode: 'megamenu',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  /**
   * The ten error codes this module owns — feature 090, Phase 3.
   *
   * **This list is the incumbent prefix chain's answer, copied from
   * `backend/test/fixtures/error-code-routing/chain-answers.ts`, not a
   * judgement.** The migration is answer-preserving over all 289 codes with no
   * exception list (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md`
   * §6.2), so nothing here was added or dropped because it looked misplaced;
   * re-routing is §6.5's and out of scope.
   *
   * **Two codes a reader would attribute elsewhere, in both directions.**
   * `MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE` reads as `sales_channels`' — it
   * is raised while checking a language against a Sales Channel's configured
   * language set — and is ours: the chain routes it on the `MEGAMENU_` prefix
   * and `megamenu-service.ts` is what raises it. Going the other way, the three
   * codes this module raises and does **not** own are `NOT_FOUND`,
   * `VALIDATION_FAILED` and `VERSION_CONFLICT`, all the platform's; the first
   * of those is raised for a *Sales Channel* that does not exist, so a reader
   * tracing that refusal would look in `sales_channels` and find it in `core`.
   *
   * **Two of the ten are raised by nothing, and neither is a missing rule.**
   * Both spellings were searched over `packages` and `backend/src` —
   * `ERROR_CODES.<CODE>` and the bare quoted literal — because a module need
   * not spell its codes the first way (runbook step 2, T12).
   * `MEGAMENU_DEPTH_EXCEEDED` is built, enforced and covered by
   * `test/contract/megamenu/admin-items-depth.contract.test.ts`, and it reaches
   * the client — as a `meta.warnings` entry on a **200**, because FR-011 makes
   * depth a non-blocking soft warning. It is never thrown, so the envelope can
   * never render the `errors.MEGAMENU_DEPTH_EXCEEDED` sentence written for it
   * in both languages. `MEGAMENU_REFERENCED` is built too: this module
   * contributes reference descriptors to `assets_library`'s and `cms`' delete
   * scans (`asset-references.ts`, `cms-references.ts`), the delete *is* refused
   * and the holder list *does* name the menu — but the refusal is answered
   * under the deleting module's code, `ASSET_REFERENCED` or `CMS_REFERENCED`,
   * so this one never travels either.
   * `specs/015-megamenu/contracts/megamenu-reference-scan.contract.md`
   * still specifies `409 MEGAMENU_REFERENCED`; the contract and the
   * implementation disagree, and that is a product finding rather than this
   * merge request's to repair.
   *
   * **No `tokens`, derived rather than assumed.** The envelope's `refusalToken`
   * (`packages/platform/src/http/error-envelope.ts`) reads exactly one member
   * of `details` — `code`, and only when `details` is an object. Every raise of
   * one of these codes was enumerated over `packages` and `backend/src` rather
   * than over this package alone (runbook §5): all sixteen pass three
   * arguments to `HttpError` and no fourth at all, so none can carry a token.
   * The bundle agrees from the other direction — ten `errors.<CODE>` keys and
   * not one `errors.<CODE>.<token>`.
   */
  errorCodes: [
    { code: 'MEGAMENU_ASSET_KIND_MISMATCH' },
    { code: 'MEGAMENU_BINDING_ALREADY_EXISTS' },
    { code: 'MEGAMENU_BINDING_NOT_FOUND' },
    { code: 'MEGAMENU_DEPTH_EXCEEDED' },
    { code: 'MEGAMENU_EMPTY_TREE' },
    { code: 'MEGAMENU_HAS_ACTIVE_BINDINGS' },
    { code: 'MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE' },
    { code: 'MEGAMENU_NOT_FOUND' },
    { code: 'MEGAMENU_REFERENCED' },
    { code: 'MEGAMENU_TARGET_OUT_OF_SCOPE' },
  ],
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'megamenu.read', label: 'View megamenu configuration' },
    { code: 'megamenu.write', label: 'Edit megamenu configuration' },
  ],
  actions: [
    {
      id: 'edit-megamenu',
      labelKey: 'actions.editMegamenu.label',
      descriptionKey: 'actions.editMegamenu.description',
      icon: 'Menu',
      targetRoute: '/megamenu',
      requiredPermission: 'megamenu.write',
      keywords: ['menu', 'edit', 'navigation', 'edytuj', 'nawigacja'],
      weight: 240,
    },
  ],
  // Feature 073 — the operator's activation control. Platform-wide. A platform
  // without a megamenu is a smaller platform, not a broken one: the menus,
  // their items and their channel bindings stay in the database and reappear
  // exactly as configured when it is switched back on.
  activation: { settingCode: 'megamenu.enabled', default: true },
});
