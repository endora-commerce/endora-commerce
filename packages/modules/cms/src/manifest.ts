import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { DEFAULT_BREAKPOINTS, type PageBuilderBreakpoints } from '@endora-commerce/page-builder-core/types/responsive';

export const CMS_PAGE_BUILDER_SETTING_CODES = {
  BREAKPOINT_TABLET_MIN: 'cms.page_builder.breakpoint.tablet_min',
  BREAKPOINT_DESKTOP_MIN: 'cms.page_builder.breakpoint.desktop_min',
  COLOR_PALETTE: 'cms.page_builder.color_palette',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'cms',
  groups: [
    { code: 'cms', name: 'CMS' },
    { code: 'cms_page_builder', name: 'Page Builder' },
  ],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'cms.enabled',
      name: 'CMS enabled',
      description:
        'Switches the CMS admin screens, its API and the storefront pages, blocks and hooks it serves on or off. Nothing is dropped: pages, blocks, templates and hook attachments stay in the database and reappear exactly as they were when you switch it back on.',
      groupCode: 'cms',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.BREAKPOINT_TABLET_MIN,
      name: 'Tablet breakpoint (min-width px)',
      description:
        'Minimum viewport width in pixels for the tablet tier in the CMS Page Builder preview and responsive styles.',
      groupCode: 'cms_page_builder',
      valueType: 'number',
      defaultValue: DEFAULT_BREAKPOINTS.tabletMin,
    },
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.BREAKPOINT_DESKTOP_MIN,
      name: 'Desktop breakpoint (min-width px)',
      description:
        'Minimum viewport width in pixels for the desktop tier in the CMS Page Builder preview and responsive styles.',
      groupCode: 'cms_page_builder',
      valueType: 'number',
      defaultValue: DEFAULT_BREAKPOINTS.desktopMin,
    },
    {
      code: CMS_PAGE_BUILDER_SETTING_CODES.COLOR_PALETTE,
      name: 'Page Builder color palette',
      description:
        'Global named colors available in the CMS Page Builder color fields. Each entry has a display name and hex value.',
      groupCode: 'cms_page_builder',
      valueType: 'json',
      defaultValue: [],
    },
  ],
});

export const cmsSettingsManifest = settings;

export const manifest = defineModuleManifest({
  id: 'cms',
  name: 'CMS',
  description: 'Pages, blocks, templates, and hooks for content management.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port both route files are gated by, and
  // `settings` owns the store the page-builder resolvers read and write.
  // `assets_library` owns the reference registry this module contributes its
  // embedded-asset scan to (T143a) — the edge existed as a composition root's
  // cross-registration, which is to say it existed nowhere an operator, the
  // lifecycle or the migration order could see it.
  // `languages` owns `languageReferenceRegistry`, the registry this module
  // contributes its "which languages do pages carry" descriptor to (feature 077,
  // D-87). `languages` used to ask the question itself, with a jsonb
  // containment test against `cms_pages` — this module's table.
  dependencies: ['assets_library', 'languages', 'sales_channels', 'auth', 'settings'],
  /**
   * Error codes this module owns — feature 090, Phase 3
   * (`specs/090-module-owned-error-codes/`).
   *
   * The list is the incumbent prefix chain's **answer**, copied from the frozen
   * capture (`backend/test/fixtures/error-code-routing/chain-answers.ts`, taken
   * at `49f3c6817`) rather than judged: the migration is answer-preserving over
   * all 289 codes and re-routing is out of scope (runbook §6.5). Ten codes, and
   * this module happens to be the clean case for trap T1 — the chain's
   * `startsWith('CMS_')` rule shadows nothing and is shadowed by nothing, so its
   * source and its answer agree here, which is not true of the four codes T1
   * names.
   *
   * **Two names a reader would attribute elsewhere, and both are ours.**
   * `CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE` names two other modules' nouns and
   * belongs to neither: it is raised twice in `cms-page-service.ts`, once when a
   * page's content is written in a language the page does not carry and once
   * when a page's declared languages are not in the union its assigned sales
   * channels resolve. `megamenu` owns the identically shaped
   * `MEGAMENU_LANGUAGE_NOT_IN_CHANNEL_SCOPE` on the same reading.
   * `CMS_REFERENCED` is the cross-entity reference guard for pages, blocks and
   * templates — not a narrowing of `assets_library`'s `ASSET_REFERENCED`, which
   * is that module's and stays there.
   *
   * **And the inverse: seven raises this module makes and must not declare.**
   * `VERSION_CONFLICT` four times (the `If-Match` guard in each of the four
   * entity services) and `VALIDATION_FAILED` three times (the storefront
   * route's missing-parameter refusals). Both route to `core`, because
   * ownership follows the domain noun and never the thrower (D-95.2).
   *
   * **No `tokens`, and that is derived rather than assumed.** The envelope's
   * `refusalToken` (`packages/platform/src/http/error-envelope.ts`) reads one
   * member of `details` — `code` — as the tail of `errors.<CODE>.<token>`. All
   * 32 raises of these ten codes were enumerated over `packages` and
   * `backend/src` in both spellings (`ERROR_CODES.<CODE>` and the bare string
   * literal, runbook step 2), and not one passes a fourth argument at all;
   * neither do the seven `core`-owned raises above. The runbook §5 tree-wide
   * scan agrees, printing the same ten codes over 41 sites it has printed since
   * `catalog`, none of them a `CMS_` one. The bundle agrees from the other
   * direction: ten `errors.<CODE>` keys in `en` and `pl`, no
   * `errors.<CODE>.<token>` key in either.
   *
   * **One code nothing raises: `CMS_SCHEMA_UPGRADE_FAILED`** — declared anyway,
   * because ownership follows the capture (trap T10) and deleting it would move
   * an answer this merge request may not move. It is reported, not repaired;
   * the finding is in the merge request and belongs to
   * `specs/deferred-defects.md` § *Roughly 29 error codes have translated
   * sentences no client can ever receive*.
   */
  errorCodes: [
    { code: 'CMS_BLOCK_NOT_FOUND' },
    { code: 'CMS_CODE_CONFLICT' },
    { code: 'CMS_HOOK_NOT_FOUND' },
    { code: 'CMS_HOOK_SYSTEM_PROTECTED' },
    { code: 'CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE' },
    { code: 'CMS_PAGE_NOT_FOUND' },
    { code: 'CMS_REFERENCED' },
    { code: 'CMS_SCHEMA_UPGRADE_FAILED' },
    { code: 'CMS_SLUG_CONFLICT' },
    { code: 'CMS_TEMPLATE_NOT_FOUND' },
  ],
  i18n: { bundlesDir: 'i18n' },
  settings,
  permissions: [
    { code: 'cms.read', label: 'View CMS content' },
    { code: 'cms.write', label: 'Edit CMS content' },
  ],
  actions: [
    {
      id: 'new-page',
      labelKey: 'actions.newPage.label',
      descriptionKey: 'actions.newPage.description',
      icon: 'FileText',
      targetRoute: '/cms/pages/new',
      requiredPermission: 'cms.write',
      keywords: ['page', 'new', 'create', 'strona', 'nowa', 'utwórz'],
      weight: 130,
    },
  ],
  // Feature 073 — the operator's activation control. A platform without a CMS
  // is a smaller platform, not a broken one: pages, blocks and hooks are
  // content, and switching the module off hides the screens and the storefront
  // surface without dropping a row.
  activation: { settingCode: 'cms.enabled', default: true },
});

export function resolvePageBuilderBreakpointsFromEnv(): PageBuilderBreakpoints {
  const tabletRaw = process.env['CMS_PB_BREAKPOINT_TABLET_MIN'];
  const desktopRaw = process.env['CMS_PB_BREAKPOINT_DESKTOP_MIN'];
  const tabletMin = tabletRaw ? Number.parseInt(tabletRaw, 10) : DEFAULT_BREAKPOINTS.tabletMin;
  const desktopMin = desktopRaw ? Number.parseInt(desktopRaw, 10) : DEFAULT_BREAKPOINTS.desktopMin;
  return {
    tabletMin: Number.isFinite(tabletMin) ? tabletMin : DEFAULT_BREAKPOINTS.tabletMin,
    desktopMin: Number.isFinite(desktopMin) ? desktopMin : DEFAULT_BREAKPOINTS.desktopMin,
  };
}
