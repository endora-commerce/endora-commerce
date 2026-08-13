import { defineModuleManifest, defineModuleSettingsManifest } from '@b2b/contracts';
import { DEFAULT_BREAKPOINTS, type PageBuilderBreakpoints } from '@b2b/page-builder-core/types/responsive';

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
  dependencies: ['sales_channels', 'auth', 'settings'],
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
