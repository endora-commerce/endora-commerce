import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  Puck,
  Render,
  resolveAllData,
  type Config,
  type ComponentConfig,
  type Data,
  type PuckAction,
} from '@puckeditor/core';
import '@puckeditor/core/puck.css';
// Self-contained, prefix-isolated (`cmsc:`) stylesheet for the shared CMS components
// (feature 041, FR-012b). This is the admin's ONLY change; it carries its own token
// values + no preflight, so it cannot restyle admin chrome.
import '@endora-commerce/cms-components/styles.css';
import {
  defaultPageBuilderConfig,
  withCmsPageRoot,
  withMissingBlockPlaceholders,
  type CmsRenderEmbeds,
} from '@endora-commerce/cms-components';
import {
  buildPaletteCategories,
  contextAdmits,
  countComponentNames,
  filterConfigByContext,
  isSectionBackgroundField,
  type BrandColorRole,
  type PageBuilderContext,
} from '@endora-commerce/page-builder-core';
import {
  createPageBuilderEditorPlugin,
  PUCK_LEGACY_DND,
  withPuckLegacySideBar,
} from '@endora-commerce/page-builder-core/editor';
import { AdminCmsAssetProvider } from './AdminCmsAssetProvider.js';
import { PreviewBrandTokens, PreviewBrandTokensProvider } from './PreviewBrandTokens.js';
import type {
  CmsPageBuilderDescriptor,
  CmsPageBuilderTranslateResponse,
  CmsPageBuilderTranslationCapability,
} from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { cn, useAuth } from '@endora-commerce/admin-kit/lib';
import { PuckPageBuilderTranslateAction } from './PageBuilderTranslateAction.js';
import { TranslationNotice, useTranslationNotice } from './TranslationNotice.js';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { useBlockContributions } from '@endora-commerce/admin-kit/zones';
import { cmsClient } from '../api/cms-client.js';
import {
  composeDeclaredBlocks,
  loadBlockEditors,
  namesToLoad,
  type DeclaredBlock,
  type LoadedBlockEditors,
} from './block-contributions.js';
import {
  PageBuilderColorPaletteProvider,
  createCategorySlugField,
  createCategorySlugsField,
  createProductSlugField,
  createProductSlugsField,
  createImageAssetField,
  createImageSourceField,
  createImageUrlField,
  createSlideImageField,
  createVideoAssetField,
  createButtonSpecField,
  createLinkField,
  PageBuilderHeaderActions,
  PageBuilderHeaderShell,
  PageBuilderTemplateActions,
  emptyPageBuilderData,
  isEmptyPageBuilderData,
  PageBuilderOverlayBridge,
} from '@endora-commerce/page-builder-admin';
import { AdminCatalogPreviewProvider } from './AdminCatalogPreviewProvider.js';
import { createAdminBackgroundField, withAdminSectionAssetInput } from './BackgroundFields.js';
import { withAdminHeroFields } from './HeroFields.js';
import { SECTION_BLOCKS_WITH_ADMIN_FIELDS, withAdminSectionBlockFields } from './SectionBlockFields.js';
import { CAROUSEL_BLOCKS_WITH_ADMIN_FIELDS, withAdminCarouselFields } from './CarouselFields.js';
import { LISTING_BLOCKS_WITH_ADMIN_FIELDS, withAdminListingFields } from './ListingFields.js';
import { PAGE_NAVIGATION_BLOCKS_WITH_ADMIN_FIELDS, withAdminPageNavigationFields } from './PageNavigationFields.js';
import { NEWSLETTER_SIGNUP_FIELDS_BLOCK, withAdminNewsletterSignupFields } from './NewsletterSignupFields.js';
import { buildViewports } from './build-viewports.js';
import {
  applyRowLayoutPreset,
  findRowById,
  replaceRowInData,
  wrapRowInContentSliderSlide,
  type RowLayoutPresetId,
} from '@endora-commerce/cms-components/editor/row-layout-presets';
import { isContentSliderSlidesZone, toPuckItemArray } from '@endora-commerce/page-builder-core/editor';
import { createPuckActionHandler, PuckDispatchBridgeSlot } from './PuckActionGuard.js';
import { RowLayoutPicker } from './RowLayoutPicker.js';
import { INLINE_RICH_TEXT_FIELD_TRANSFORMS } from '@endora-commerce/cms-components/editor/inline-rich-text-canvas';
import { PageBuilderActionBar } from './PageBuilderActionBar.js';
import { PageBuilderDrawer } from './PageBuilderDrawer.js';
import { SectionPresetsPanel } from './SectionPresetsPanel.js';
import { applyPageBuilderTranslations } from './page-builder-i18n.js';
import { hasInvalidColumnPlacement } from '@endora-commerce/page-builder-core/editor';

const emptyData: Data = { root: { props: {} }, content: [] };

function insertedItem(action: Extract<PuckAction, { type: 'insert' }>, data: Data) {
  const items = action.destinationZone.startsWith('root:')
    ? toPuckItemArray(data.content)
    : toPuckItemArray(data.zones?.[action.destinationZone]);
  return items[action.destinationIndex] ?? null;
}

function resolveInsertedRowId(
  action: Extract<PuckAction, { type: 'insert' }>,
  data: Data,
): string | null {
  if (typeof action.id === 'string' && action.id.length > 0) return action.id;
  const inserted = insertedItem(action, data);
  return typeof inserted?.props.id === 'string' ? inserted.props.id : null;
}

function collectRowIds(data: Data): Set<string> {
  const ids = new Set<string>();
  const visit = (items: ReturnType<typeof toPuckItemArray>): void => {
    for (const item of items) {
      if (item.type === 'cms.Row' && typeof item.props.id === 'string') {
        ids.add(item.props.id);
      }
      for (const value of Object.values(item.props)) {
        const nested = toPuckItemArray(value);
        if (nested.length > 0) visit(nested);
      }
    }
  };
  visit(toPuckItemArray(data.content));
  for (const zoneItems of Object.values(data.zones ?? {})) {
    visit(toPuckItemArray(zoneItems));
  }
  return ids;
}

/**
 * Guards a best-effort on-canvas embed preview: if rendering a referenced
 * block/template tree throws (e.g. an unknown extension component or a
 * malformed tree), the placeholder simply disappears instead of taking the
 * whole editor down with it.
 */
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Renders a block/template's stored content (per-language Puck trees) into an
 * on-canvas preview so the InsertBlock/InsertTemplate embeds show their actual
 * content instead of just printing the referenced code. Prefers Polish, then
 * English, then any available language.
 */
function previewNode(content: { languages?: Record<string, unknown> }): ReactNode {
  const langs = content.languages ?? {};
  const tree = langs['pl-PL'] ?? langs['en-US'] ?? Object.values(langs)[0] ?? null;
  if (!tree) return null;
  return (
    <PreviewBoundary>
      <Render config={defaultPageBuilderConfig} data={tree as Data} />
    </PreviewBoundary>
  );
}

/**
 * Merges the locally-bundled `defaultPageBuilderConfig` from
 * `@endora-commerce/cms-components` with the descriptor returned by the backend's
 * page-builder/config endpoint. Components that exist in the descriptor
 * but whose React renderer is missing from this admin bundle fall back to
 * `MissingComponentPlaceholder` so the editor stays usable while the
 * contributing module's renderer is being built.
 */
interface BlockOption {
  label: string;
  value: string;
}

/** The descriptor's entries this editor's palette admits (feature 096, T306). */
function declaredFor(
  descriptor: CmsPageBuilderDescriptor | null,
  context: PageBuilderContext,
): DeclaredBlock[] {
  return (descriptor?.components ?? []).filter((entry) =>
    contextAdmits(entry.contexts ?? ['cms'], context),
  );
}

/** A contribution that was ignored or failed is the operator's console's to know. */
function reportBlockContribution(message: string): void {
  console.warn(message);
}

const NO_CONTRIBUTED_EDITORS: Pick<LoadedBlockEditors, 'editors' | 'owners'> = {
  editors: {},
  owners: {},
};

/** Stable: a field recreated on every merge loses its input focus. */
// R20E (T296): the look stays `cms.Button`'s own block-level options (as stored since R19B).
const CMS_BUTTON_SPEC_FIELD = createButtonSpecField({ label: 'Button', responsive: true, look: false });
/** R17 (T212): the shared link of the image, icon, logo, announcement bar and map marker. */
const OPTIONAL_LINK_FIELD = createLinkField({ label: 'Link (optional)' });
const LOGO_IMAGE_FIELD = createSlideImageField();

/** `cfg` with each named top-level field replaced, where the block has it. */
function withFields(cfg: ComponentConfig | undefined, replacements: Record<string, unknown>): ComponentConfig | undefined {
  if (!cfg) return cfg;
  const fields = { ...(cfg.fields ?? {}) } as Record<string, unknown>;
  for (const [key, field] of Object.entries(replacements)) if (key in fields) fields[key] = field;
  return { ...cfg, fields } as ComponentConfig;
}

/**
 * Feature 163, T040 — the brand colour roles the colour palette offers first,
 * with the effective colours of the brand tokens the descriptor carries.
 */
function brandPaletteColors(tokens: CmsPageBuilderDescriptor['brandTokens']): Partial<Record<BrandColorRole, string>> {
  const colors = tokens?.colors;
  if (!colors) return {};
  return {
    primary: colors.primary,
    'primary-hover': colors.primaryHover,
    secondary: colors.secondary,
    'secondary-hover': colors.secondaryHover,
    'on-primary': colors.onPrimary,
    'on-secondary': colors.onSecondary,
  };
}

function mergeConfig(
  descriptor: CmsPageBuilderDescriptor | null,
  extensionTitle: string,
  blockOptions: BlockOption[],
  context: PageBuilderContext,
  sectionTitle: (ownerModule: string, titleKey: string, fallback: string) => string,
  contributed: Pick<LoadedBlockEditors, 'editors' | 'owners'>,
  previewSentence: string,
): Config {
  const base = defaultPageBuilderConfig;

  const bundled: Record<string, ComponentConfig> = {
    ...(base.components ?? {}),
  } as Record<string, ComponentConfig>;

  // Replace InsertBlock's free-text "Block code" field with a dropdown of the
  // available CMS blocks, so authors pick from a list instead of having to know
  // and type a code by hand.
  const insertBlock = bundled['cms.InsertBlock'];
  if (insertBlock) {
    bundled['cms.InsertBlock'] = {
      ...insertBlock,
      fields: {
        ...insertBlock.fields,
        code: {
          type: 'select',
          label: 'Block',
          options: [{ label: '—', value: '' }, ...blockOptions],
        },
      },
    } as ComponentConfig;
  }

  // Feature 163, T039 — `cms.Button` carries one `ButtonSpec`; its link field
  // has the page, product, category and file pickers, and its style and fill
  // stay per breakpoint as today's variant was.
  const button = bundled['cms.Button'];
  if (button) {
    bundled['cms.Button'] = {
      ...button,
      fields: {
        ...button.fields,
        button: CMS_BUTTON_SPEC_FIELD,
      },
    } as ComponentConfig;
  }

  // Feature 163, T043 — `cms.Hero` picks its media, its buttons' links and its
  // social-proof image from the library; its media replaces today's background.
  const hero = bundled['cms.Hero'];
  if (hero) {
    bundled['cms.Hero'] = withAdminHeroFields(hero);
  }

  // Feature 163, T047 and T049 — the section blocks of US3 pick their images,
  // videos, uploaded icons and button links from the library.
  for (const name of SECTION_BLOCKS_WITH_ADMIN_FIELDS) {
    const cfg = bundled[name];
    if (cfg) bundled[name] = withAdminSectionBlockFields(name, cfg);
  }

  // Feature 163, T054 — the Carousel and its item blocks: images, files, media,
  // links and buttons from the library pickers.
  for (const name of CAROUSEL_BLOCKS_WITH_ADMIN_FIELDS) {
    const cfg = bundled[name];
    if (cfg) bundled[name] = withAdminCarouselFields(name, cfg);
  }

  // Feature 163, T069–T072 — the dynamic listings' header, footer and row
  // buttons get their link pickers.
  for (const name of LISTING_BLOCKS_WITH_ADMIN_FIELDS) {
    const cfg = bundled[name];
    if (cfg) bundled[name] = withAdminListingFields(name, cfg);
  }

  // Feature 169, T058 — a page navigation's links pick their anchors from the page's sections.
  for (const name of PAGE_NAVIGATION_BLOCKS_WITH_ADMIN_FIELDS) {
    const cfg = bundled[name];
    if (cfg) bundled[name] = withAdminPageNavigationFields(name, cfg);
  }

  // Feature 169 (US7) — `newsletter.Signup`'s topic tag and attribute custom field from the newsletter's lists.
  for (const name of [NEWSLETTER_SIGNUP_FIELDS_BLOCK]) {
    const cfg = bundled[name];
    if (cfg) bundled[name] = withAdminNewsletterSignupFields(cfg);
  }

  const productCard = bundled['catalog.ProductCard'];
  if (productCard) {
    bundled['catalog.ProductCard'] = {
      ...productCard,
      fields: { ...productCard.fields, productSlug: createProductSlugField() },
    } as ComponentConfig;
  }

  for (const name of ['catalog.ProductGrid', 'catalog.ProductSlider'] as const) {
    const cfg = bundled[name];
    if (cfg) {
      bundled[name] = {
        ...cfg,
        fields: {
          ...cfg.fields,
          productSlugs: createProductSlugsField(),
          categorySlug: createCategorySlugField(),
        },
      } as ComponentConfig;
    }
  }

  for (const name of ['catalog.CategoryList', 'catalog.CategoryGrid'] as const) {
    const cfg = bundled[name];
    if (cfg) {
      bundled[name] = {
        ...cfg,
        fields: {
          ...cfg.fields,
          categorySlugs: createCategorySlugsField(),
          parentSlug: createCategorySlugField(),
        },
      } as ComponentConfig;
    }
  }

  const image = bundled['cms.Image'];
  if (image) {
    bundled['cms.Image'] = {
      ...image,
      fields: {
        ...image.fields,
        imageSource: createImageSourceField(),
        src: createImageUrlField('Image URL'),
        assetId: createImageAssetField('Image'),
        // Feature 163, T127: the mobile image, from the same source.
        mobileSrc: createImageUrlField('Mobile image URL'),
        mobileAssetId: createImageAssetField('Mobile image'),
        // R17 (T212): any kind of link, with the page, product, category and file pickers.
        link: OPTIONAL_LINK_FIELD,
      },
    } as ComponentConfig;
  }

  // R17 (T212): the icon's and the announcement bar's link, with the pickers.
  for (const name of ['cms.Icons', 'cms.AnnouncementBar'] as const) {
    const cfg = withFields(bundled[name], { link: OPTIONAL_LINK_FIELD });
    if (cfg) bundled[name] = cfg;
  }

  // R17 (T212): a map marker's link, with the pickers.
  const map = bundled['cms.Map'];
  const markersField = map?.fields?.['markers'];
  if (map && markersField && markersField.type === 'array') {
    bundled['cms.Map'] = withFields(map, {
      markers: { ...markersField, arrayFields: { ...markersField.arrayFields, link: OPTIONAL_LINK_FIELD } },
    })!;
  }

  // Feature 163, T126: a self-hosted video's files and poster come from the asset library.
  const video = bundled['cms.Video'];
  if (video) {
    bundled['cms.Video'] = {
      ...video,
      fields: {
        ...video.fields,
        videoAssetId: createVideoAssetField('Video file'),
        mobileVideoAssetId: createVideoAssetField('Mobile video file'),
        posterAssetId: createImageAssetField('Poster image'),
        // T162: the mobile video's own poster from the library (its URL stays a text box).
        mobilePosterAssetId: createImageAssetField('Mobile poster image'),
      },
    } as ComponentConfig;
  }

  // `cms.Testimonial` left this list with T049: its card background is swapped
  // by `withAdminSectionBlockFields` above, with its image and avatar.
  for (const name of ['cms.Row', 'cms.Column', 'cms.NewsletterSignup'] as const) {
    const cfg = bundled[name];
    if (cfg) {
      bundled[name] = {
        ...cfg,
        fields: {
          ...cfg.fields,
          background: createAdminBackgroundField(),
        },
      } as ComponentConfig;
    }
  }

  // Feature 163, T033, T110, T117 — the section background (since the owner's
  // ruling of 2026-10-23 only `cms.Section` carries one, as its own
  // `background` prop) picks its assets from the library. Keyed on the field,
  // not on a block or prop name.
  for (const [name, cfg] of Object.entries(bundled)) {
    const fields = cfg.fields ?? {};
    if (!Object.values(fields).some(isSectionBackgroundField)) continue;
    bundled[name] = {
      ...cfg,
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, field]) => [
          key,
          isSectionBackgroundField(field) ? withAdminSectionAssetInput(field) : field,
        ]),
      ),
    } as ComponentConfig;
  }

  const logoStrip = bundled['cms.LogoStrip'];
  if (logoStrip) {
    const itemsField = logoStrip.fields?.items;
    bundled['cms.LogoStrip'] = {
      ...logoStrip,
      fields: {
        ...logoStrip.fields,
        items:
          itemsField && itemsField.type === 'array'
            ? {
                ...itemsField,
                arrayFields: {
                  image: LOGO_IMAGE_FIELD,
                  alt: itemsField.arrayFields?.alt ?? { type: 'text', label: 'Alt text' },
                  // R17 (T212): any kind of link, with the pickers (a stored URL is carried into it).
                  link: OPTIONAL_LINK_FIELD,
                },
              }
            : itemsField,
      },
    } as ComponentConfig;
  }

  // Feature 096, T306 — **the descriptor is filtered by context here.**
  // Until Phase 3 it carried only the 35 CMS names, so every entry belonged in
  // this palette by construction; it now carries all 74 a platform composes,
  // and an unfiltered sweep would put 39 e-mail and invoice blocks into this
  // editor as missing-renderer placeholders.
  const declared = declaredFor(descriptor, context);
  // Feature 141 — every declared block the bundle does not render gets an
  // editor here: the renderer its module contributes, or one built from its
  // declared fields with a neutral preview (plan D8). It used to get
  // `MissingComponentPlaceholder`, whose only fields are the block's name and
  // owner — a block an operator could insert and never edit.
  const components = composeDeclaredBlocks({
    components: bundled,
    declared,
    editors: contributed.editors,
    owners: contributed.owners,
    previewSentence,
    report: reportBlockContribution,
  });

  // The sections come from the modules that declared them, resolved and merged
  // by the registry (`contracts/block-definition.md` §1.1 and §4.1.1). The
  // hand-written `categories` map this replaced lived in `cms-components` and
  // listed five of `catalog`'s blocks.
  const categories = buildPaletteCategories(declared, descriptor?.categories ?? [], context, {
    title: (section) => sectionTitle(section.ownerModule ?? 'cms', section.titleKey, section.key),
    renderable: new Set(Object.keys(components)),
  });

  // Anything the descriptor declares for this context but no declared section
  // holds still has to be reachable, or it is a block an operator can never
  // insert. That is the *Extensions* drawer's job and it stays.
  const sectioned = new Set(Object.values(categories).flatMap((c) => c.components ?? []));
  const unsectioned = declared.map((entry) => entry.name).filter((name) => !sectioned.has(name));

  return {
    ...base,
    components,
    categories:
      unsectioned.length > 0
        ? { ...categories, extensions: { title: extensionTitle, components: unsectioned } }
        : categories,
  } as Config;
}

type ScopedTranslate = (scope: string, key: string, params?: Record<string, string | number>) => string;

export interface PageBuilderEditorConfigInput {
  descriptor: CmsPageBuilderDescriptor | null;
  context: PageBuilderContext;
  /** `cms`' own translator. */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** The scoped translator: section titles, block and field labels are the declaring module's. */
  translateInScope: ScopedTranslate;
  blockOptions?: BlockOption[];
  contributed?: Pick<LoadedBlockEditors, 'editors' | 'owners'>;
  /** The block names the loaded document carries, for the missing-block placeholders. */
  storedBlockNames?: readonly string[];
  /** Wrap the canvas in the CMS page max-width container (pages only). */
  pageContainer?: boolean;
}

/** `null` when `scope` has no such key: a missing key resolves to its `<scope>.<key>` placeholder. */
function scopedOrUndefined(translateInScope: ScopedTranslate, scope: string, key: string): string | undefined {
  const resolved = translateInScope(scope, key);
  return resolved === `${scope}.${key}` ? undefined : resolved;
}

/**
 * The Puck config `PageBuilderEditor` hands its `<Puck>`: the bundled blocks
 * with the admin's pickers, the descriptor's declared blocks and sections, the
 * context filter, the missing-block placeholders, the page root and the
 * translated labels. Exported so a test can read the editor's real config.
 */
export function buildPageBuilderEditorConfig(input: PageBuilderEditorConfigInput): Config {
  const { descriptor, context, t, translateInScope } = input;
  // A section's `titleKey` is **module-relative** and belongs to the module
  // whose declaration won the merge, so it is resolved in that module's scope
  // and not in `cms`' (`contracts/block-definition.md` §2). The section key is
  // a last resort so a drawer is never headed with nothing.
  const sectionTitle = (ownerModule: string, titleKey: string, fallback: string): string =>
    scopedOrUndefined(translateInScope, ownerModule, titleKey) ?? fallback;
  // A block's palette label, from the declaring module's own bundle. Same rule
  // and same reason: after Phase 3 five of the CMS palette's entries are
  // `catalog`'s. Falls through to `applyPageBuilderTranslations`' legacy
  // `pageBuilder.components.<name>` key while the descriptor is not fetched.
  const blockLabel = (name: string): string | undefined => {
    const entry = descriptor?.components.find((component) => component.name === name);
    if (!entry?.labelKey) return undefined;
    return scopedOrUndefined(translateInScope, entry.ownerModule, entry.labelKey);
  };

  // Feature 163 (research R-24, FR-039) — a block's field and option labels
  // sit under its label-key stem (`blocks.mediaText.label` →
  // `blocks.mediaText.fields.…`) in the declaring module's bundle; a missing
  // key keeps the config's English.
  const stems = new Map(
    (descriptor?.components ?? []).flatMap((entry) =>
      entry.labelKey?.endsWith('.label')
        ? [[entry.name, { owner: entry.ownerModule, stem: entry.labelKey.slice(0, -'.label'.length) }] as const]
        : [],
    ),
  );
  const fieldLabel = (name: string, key: string): string | undefined => {
    const entry = stems.get(name);
    return entry ? scopedOrUndefined(translateInScope, entry.owner, `${entry.stem}.${key}`) : undefined;
  };

  const merged = mergeConfig(
    descriptor,
    t('pageBuilder.extensions'),
    input.blockOptions ?? [],
    context,
    sectionTitle,
    input.contributed ?? NO_CONTRIBUTED_EDITORS,
    t('pageBuilder.blockPreview.unavailable'),
  );
  const filtered = filterConfigByContext(merged, context);
  // FR-019/FR-020 — a stored block nothing here can render degrades to the
  // placeholder rather than vanishing from the canvas. **After** the context
  // filter and after the categories, deliberately: the block stays visible and
  // editable where it already is, and is not something an operator may insert.
  const degraded = withMissingBlockPlaceholders(filtered, [...(input.storedBlockNames ?? [])]);
  const rooted = input.pageContainer ? withCmsPageRoot(degraded) : degraded;
  // R17 (T200): the fields the page builder owns are translated once, in the `core` bundle.
  const sharedFieldLabel = (key: string): string | undefined =>
    scopedOrUndefined(translateInScope, 'core', `pageBuilder.sharedFields.${key}`);
  return applyPageBuilderTranslations(rooted, t, blockLabel, fieldLabel, sharedFieldLabel);
}

export function PageBuilderEditor({
  data,
  onChange,
  contentKey,
  pageContainer = false,
  context = 'cms',
  languages = [],
  activeLanguage = null,
  onResolveLanguageContent,
  onSaveAsTemplate,
  onListTemplatesForApply,
  onResolveTemplateLayout,
  resource,
  savedVersion,
  salesChannelId = null,
}: {
  data: Data | null;
  onChange: (data: Data) => void;
  /**
   * Identity of the content currently loaded into the editor — typically
   * `${resourceId}:${language}`. Puck seeds its internal editor state from
   * `data` only on mount (the `data` prop is treated as *initial* data, not a
   * controlled value), so when the surrounding editor finishes its async
   * fetch and swaps `data` from the empty placeholder to the saved tree, Puck
   * would otherwise keep showing the empty canvas. Threading this through as
   * the Puck `key` forces a remount whenever a different resource/language is
   * loaded, re-seeding from the freshly-loaded `data`. It deliberately does
   * NOT change on every keystroke (which flows through `onChange`/draft
   * state), so editing stays smooth and never loses focus.
   */
  contentKey?: string;
  /** Wrap the canvas in the CMS page max-width container (pages only). */
  pageContainer?: boolean;
  /** Page Builder palette context (default CMS content). */
  context?: PageBuilderContext;
  /** Content languages available for "copy from language". */
  languages?: string[];
  activeLanguage?: string | null;
  /** Load another language's saved/draft content (used by Copy from language). */
  onResolveLanguageContent?: (language: string) => Data | null | Promise<Data | null>;
  /** Persist the current canvas as a new CMS content template. */
  onSaveAsTemplate?: (meta: { name: string; code: string }, data: Data) => void | Promise<void>;
  /** List CMS content templates for Apply template. */
  onListTemplatesForApply?: () => Promise<Array<{ id: string; label: string }>>;
  /** Resolve a CMS content template layout to replace the canvas. */
  onResolveTemplateLayout?: (templateId: string) => Data | Promise<Data>;
  /**
   * Feature 151 — what this canvas belongs to, for the translation's audit
   * entry only (`{ type: 'cms_page', id }`, `id: null` for an unsaved record).
   */
  resource?: { type: string; id: string | null };
  /**
   * Feature 151 — the saved content's version. When it changes the content was
   * saved, and the translation notice (with its *Restore previous content*) is
   * no longer about the stored state, so it goes (FR-019).
   */
  savedVersion?: string | number | null;
  /**
   * Feature 163 — the sales channel whose brand tokens the preview is styled
   * with: a page's first assigned channel. Without one, the global set.
   */
  salesChannelId?: string | null;
}): ReactNode {
  const t = useTranslation('cms');
  // Section titles, block labels and field labels are module-relative and are
  // resolved in the declaring module's scope (`buildPageBuilderEditorConfig`).
  const { t: translateInScope } = useTranslationContext();
  // The shared page-builder chrome (`PageBuilderHeaderShell`,
  // `PageBuilderTemplateActions`, `PageBuilderHeaderActions`) owns no module
  // knowledge and reads `core`; this screen's own strings stay `cms`' (feature
  // 091 P5a, R-1).
  const tChrome = useTranslation('core');
  const [descriptor, setDescriptor] = useState<CmsPageBuilderDescriptor | null>(null);
  /**
   * The editor renderers the present modules contribute for the blocks the
   * descriptor declares (feature 141, contract R4.2). `null` until the
   * factories have settled: the Puck config is built **after** them, so a
   * contributed block never flashes as its declared-fields fallback first.
   * Only the `cms` context has contributions of its own; any other resolves
   * to none at once.
   */
  const blockContributions = useBlockContributions('cms');
  const [contributedEditors, setContributedEditors] = useState<Pick<
    LoadedBlockEditors,
    'editors' | 'owners'
  > | null>(null);
  useEffect(() => {
    if (descriptor === null) return undefined;
    if (context !== 'cms') {
      setContributedEditors(NO_CONTRIBUTED_EDITORS);
      return undefined;
    }
    const wanted = namesToLoad(
      declaredFor(descriptor, context),
      defaultPageBuilderConfig.components ?? {},
    );
    if (!blockContributions.some((contribution) => wanted.has(contribution.name))) {
      setContributedEditors(NO_CONTRIBUTED_EDITORS);
      return undefined;
    }
    let live = true;
    void loadBlockEditors(blockContributions, wanted, reportBlockContribution).then((loaded) => {
      if (live) setContributedEditors(loaded);
    });
    return () => {
      live = false;
    };
  }, [descriptor, context, blockContributions]);

  const [blockOptions, setBlockOptions] = useState<BlockOption[]>([]);
  const [embeds, setEmbeds] = useState<CmsRenderEmbeds>({ blocks: {}, templates: {} });
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [rowLayoutPickerForId, setRowLayoutPickerForId] = useState<string | null>(null);
  /** Bumped on clear / copy-from so Puck remounts (data prop is mount-only). */
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const dispatchRef = useRef<((action: PuckAction) => void) | null>(null);

  /**
   * Feature 151 — the Translate action's state. The capability is read once per
   * editor, and only for an operator holding `cms.translate` on a canvas whose
   * language is known; a failed read hides the action rather than breaking the
   * editor (`contracts/admin-surfaces.md` §2).
   */
  const { hasPermission } = useAuth();
  const canTranslate = hasPermission('cms.translate') && Boolean(activeLanguage);
  const [translation, setTranslation] = useState<CmsPageBuilderTranslationCapability | null>(null);
  const [translationNotice, setTranslationNotice] = useTranslationNotice(contentKey, savedVersion);
  useEffect(() => {
    if (!canTranslate) {
      setTranslation(null);
      return undefined;
    }
    let live = true;
    cmsClient
      .getTranslationCapability()
      .then((capability) => {
        if (live) setTranslation(capability);
      })
      .catch(() => {
        if (live) setTranslation(null);
      });
    return () => {
      live = false;
    };
  }, [canTranslate]);

  // Allow exiting fullscreen with Escape.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  useEffect(() => {
    let live = true;
    cmsClient
      .getPageBuilderConfig(salesChannelId)
      .then((result) => {
        if (live) setDescriptor(result);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, [salesChannelId]);

  // Available CMS blocks power the InsertBlock dropdown; their resolved content
  // (and templates') power the on-canvas embed previews. Best-effort: any
  // failure degrades to an empty dropdown / code-only placeholder rather than
  // breaking the editor.
  useEffect(() => {
    let live = true;
    void (async (): Promise<void> => {
      const [blockRes, templateRes] = await Promise.all([
        cmsClient.listBlocks().catch(() => ({ data: [] })),
        cmsClient.listTemplates().catch(() => ({ data: [] })),
      ]);
      if (!live) return;
      setBlockOptions(
        blockRes.data.map((b) => ({
          label: b.name ? `${b.name} (${b.code})` : b.code,
          value: b.code,
        })),
      );

      const blockPreviews: Record<string, ReactNode> = {};
      await Promise.all(
        blockRes.data.map(async (b) => {
          try {
            const detail = await cmsClient.getBlock(b.id);
            blockPreviews[b.code] = previewNode(detail.content);
          } catch {
            /* leave the code-only fallback */
          }
        }),
      );
      const templatePreviews: Record<string, ReactNode> = {};
      await Promise.all(
        templateRes.data.map(async (tpl) => {
          try {
            const detail = await cmsClient.getTemplate(tpl.id);
            templatePreviews[tpl.code] = previewNode(detail.content);
          } catch {
            /* leave the code-only fallback */
          }
        }),
      );
      if (live) setEmbeds({ blocks: blockPreviews, templates: templatePreviews });
    })();
    return () => {
      live = false;
    };
  }, []);

  const viewports = useMemo(() => buildViewports(descriptor), [descriptor]);
  const plugins = useMemo(() => withPuckLegacySideBar([createPageBuilderEditorPlugin()]), []);
  /** Holds canvas data across remount until parent `data` catches up (clear / copy-from). */
  const pendingSeedRef = useRef<Data | null>(null);
  const editorData = pendingSeedRef.current ?? data ?? emptyData;

  /**
   * The block names the loaded document carries, as a stable key.
   *
   * `editorData` changes identity on every keystroke and the set of names it
   * holds almost never does, so keying the config on the document would rebuild
   * the whole Puck config while an author types. The key is what the
   * degradation merge below actually depends on (feature 096, T602).
   */
  const storedBlockNamesKey = useMemo(
    () => [...countComponentNames(editorData).keys()].sort().join('\n'),
    [editorData],
  );

  const brandColors = useMemo(() => brandPaletteColors(descriptor?.brandTokens), [descriptor?.brandTokens]);

  const config = useMemo(
    () =>
      buildPageBuilderEditorConfig({
        descriptor,
        context,
        t,
        translateInScope,
        blockOptions,
        contributed: contributedEditors ?? NO_CONTRIBUTED_EDITORS,
        storedBlockNames: storedBlockNamesKey === '' ? [] : storedBlockNamesKey.split('\n'),
        pageContainer,
      }),
    [
      descriptor,
      t,
      translateInScope,
      blockOptions,
      pageContainer,
      context,
      storedBlockNamesKey,
      contributedEditors,
    ],
  );
  const lastValidDataRef = useRef(editorData);
  const knownRowIdsRef = useRef<Set<string>>(collectRowIds(editorData));

  useEffect(() => {
    pendingSeedRef.current = null;
    lastValidDataRef.current = data ?? emptyData;
    knownRowIdsRef.current = collectRowIds(data ?? emptyData);
    setRowLayoutPickerForId(null);
    setCanvasEpoch(0);
    // Only reseed when switching page/language — not on every draft edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- data intentionally omitted
  }, [contentKey]);

  useEffect(() => {
    lastValidDataRef.current = editorData;
  }, [editorData]);

  const handleEditorChange = useCallback(
    (next: Data) => {
      if (hasInvalidColumnPlacement(next)) {
        dispatchRef.current?.({
          type: 'setData',
          data: lastValidDataRef.current,
          recordHistory: false,
        });
        return;
      }

      pendingSeedRef.current = null;
      const nextRowIds = collectRowIds(next);
      let newRowId: string | null = null;
      for (const id of nextRowIds) {
        if (!knownRowIdsRef.current.has(id)) {
          newRowId = id;
          break;
        }
      }
      knownRowIdsRef.current = nextRowIds;
      lastValidDataRef.current = next;
      onChange(next);

      if (newRowId) {
        const rowId = newRowId;
        window.setTimeout(() => setRowLayoutPickerForId(rowId), 0);
      }
    },
    [onChange],
  );

  const applyCanvasData = useCallback(
    (next: Data): void => {
      pendingSeedRef.current = next;
      lastValidDataRef.current = next;
      knownRowIdsRef.current = collectRowIds(next);
      onChange(next);
      // Puck treats `data` as initial only — remount so the canvas reseeds.
      setCanvasEpoch((epoch) => epoch + 1);
    },
    [onChange],
  );

  const configRef = useRef(config);
  configRef.current = config;

  /**
   * Apply a translation as an unsaved change. `resolveAllData` re-runs each
   * block's `resolveData`, which regenerates derived props such as rich text's
   * `html` from the translated TipTap, so the stored document stays consistent
   * (research R6, R10). The previous canvas is kept for *Restore previous
   * content* until the next save, translation or tab change.
   */
  const applyTranslation = useCallback(
    async (response: CmsPageBuilderTranslateResponse, language: string): Promise<void> => {
      const previous = structuredClone(lastValidDataRef.current);
      const resolved = await resolveAllData(response.data as Data, configRef.current);
      applyCanvasData(resolved);
      setTranslationNotice({ kind: 'translated', report: response.report, language, previous });
    },
    [applyCanvasData, setTranslationNotice],
  );

  const headerActionsStateRef = useRef({
    fullscreen,
    setFullscreen,
    tChrome,
    languages,
    activeLanguage,
    editorData: data ?? emptyPageBuilderData(),
    onCopyFromLanguage: null as null | ((sourceLanguage: string) => Promise<void>),
    onClearCanvas: null as null | (() => void),
    onSaveAsTemplate: null as null | ((meta: { name: string; code: string }, data: Data) => Promise<void>),
    onListTemplatesForApply: null as null | (() => Promise<Array<{ id: string; label: string }>>),
    onApplyTemplate: null as null | ((templateId: string) => Promise<void>),
    drawerSearchPlaceholder: t('pageBuilder.drawer.searchPlaceholder'),
    drawerSearchEmpty: t('pageBuilder.drawer.searchEmpty'),
    translate: null as null | {
      capability: CmsPageBuilderTranslationCapability;
      activeLanguage: string;
    },
  });
  headerActionsStateRef.current = {
    fullscreen,
    setFullscreen,
    tChrome,
    languages,
    activeLanguage,
    editorData: editorData,
    onCopyFromLanguage: onResolveLanguageContent
      ? async (sourceLanguage: string): Promise<void> => {
          const resolved = await onResolveLanguageContent(sourceLanguage);
          if (isEmptyPageBuilderData(resolved)) {
            throw new Error(t('pageBuilder.copyLanguage.emptySource'));
          }
          applyCanvasData(structuredClone(resolved as Data));
        }
      : null,
    onClearCanvas: (): void => {
      applyCanvasData(emptyPageBuilderData());
    },
    onSaveAsTemplate: onSaveAsTemplate
      ? async (meta, canvasData): Promise<void> => {
          await onSaveAsTemplate(meta, canvasData);
        }
      : null,
    onListTemplatesForApply: onListTemplatesForApply ?? null,
    onApplyTemplate: onResolveTemplateLayout
      ? async (templateId: string): Promise<void> => {
          const next = await onResolveTemplateLayout(templateId);
          applyCanvasData(structuredClone(next));
        }
      : null,
    drawerSearchPlaceholder: t('pageBuilder.drawer.searchPlaceholder'),
    drawerSearchEmpty: t('pageBuilder.drawer.searchEmpty'),
    translate:
      canTranslate && translation && activeLanguage
        ? { capability: translation, activeLanguage }
        : null,
  };

  const declarationOf = useCallback(
    (blockType: string) =>
      descriptor?.components.find((component) => component.name === blockType)?.translatable,
    [descriptor],
  );
  const translateExtrasRef = useRef({
    declarationOf,
    resource,
    onResolveLanguageContent,
    applyTranslation,
    nothing: (): void => {},
  });
  translateExtrasRef.current = {
    declarationOf,
    resource,
    onResolveLanguageContent,
    applyTranslation,
    nothing: (): void => setTranslationNotice({ kind: 'nothing' }),
  };

  const applyRowPreset = useCallback((rowId: string, presetId: RowLayoutPresetId) => {
    dispatchRef.current?.({
      type: 'setData',
      data: (previous) => {
        const row = findRowById(previous, rowId);
        if (!row) return previous;
        const nextProps = applyRowLayoutPreset(row.props as never, presetId);
        return replaceRowInData(previous, rowId, { type: 'cms.Row', props: { ...nextProps, id: rowId } });
      },
    });
  }, []);

  const handlePuckAction = useMemo(
    () =>
      createPuckActionHandler(dispatchRef, (action, appState) => {
        if (action.type !== 'insert' || action.componentType !== 'cms.Row') return;

        const rowId = resolveInsertedRowId(action, appState.data);
        if (!rowId) return;

        if (!isContentSliderSlidesZone(action.destinationZone, appState.data)) return;

        const inserted =
          insertedItem(action, appState.data) ??
          findRowById(appState.data, rowId) ?? {
            type: 'cms.Row',
            props: { id: rowId, content: [] },
          };
        dispatchRef.current?.({
          type: 'setData',
          data: (previous) =>
            wrapRowInContentSliderSlide(
              previous,
              action.destinationZone,
              action.destinationIndex,
              inserted,
            ),
          recordHistory: false,
        });
      }),
    [],
  );

  const puckOverrides = useMemo(
    () => ({
      // Feature 163 (research R-4): the canvas iframe gets the page's brand tokens.
      iframe: ({ children, document }: { children: ReactNode; document?: Document }): ReactElement => (
        <PreviewBrandTokens document={document}>{children}</PreviewBrandTokens>
      ),
      puck: ({ children }: { children: ReactNode }): ReactElement => (
        <PuckDispatchBridgeSlot dispatchRef={dispatchRef}>{children}</PuckDispatchBridgeSlot>
      ),
      actionBar: (props: {
        label?: string;
        children: ReactNode;
        parentAction: ReactNode;
      }): ReactElement => <PageBuilderActionBar {...props} />,
      componentOverlay: (props: {
        children: ReactNode;
        hover: boolean;
        isSelected: boolean;
        componentId: string;
        componentType: string;
      }): ReactElement => <PageBuilderOverlayBridge {...props} />,
      drawerItem: ({
        name,
        children,
      }: {
        name: string;
        children: ReactNode;
      }): ReactElement => (name === 'cms.Column' || name === 'cms.Slide' ? <></> : <>{children}</>),
      drawer: ({ children }: { children: ReactNode }): ReactElement => {
        const state = headerActionsStateRef.current;
        return (
          <PageBuilderDrawer
            searchPlaceholder={state.drawerSearchPlaceholder}
            emptyLabel={state.drawerSearchEmpty}
          >
            {/* Feature 163 (FR-042, R-22) — ready-made sections, beside the row layout picker's presets. */}
            <SectionPresetsPanel />
            {children}
          </PageBuilderDrawer>
        );
      },
      header: ({ children }: { children: ReactNode; actions: ReactNode }): ReactElement => {
        const state = headerActionsStateRef.current;
        const hasTemplates = Boolean(state.onSaveAsTemplate || state.onApplyTemplate);
        return (
          <PageBuilderHeaderShell
            leading={
              hasTemplates ? (
                <PageBuilderTemplateActions
                  currentData={state.editorData}
                  {...(state.onSaveAsTemplate ? { onSaveAsTemplate: state.onSaveAsTemplate } : {})}
                  {...(state.onListTemplatesForApply
                    ? { onListTemplatesForApply: state.onListTemplatesForApply }
                    : {})}
                  {...(state.onApplyTemplate
                    ? {
                        onApplyTemplate: async (templateId: string): Promise<void> => {
                          await state.onApplyTemplate?.(templateId);
                        },
                      }
                    : {})}
                  t={state.tChrome}
                />
              ) : null
            }
          >
            {children}
          </PageBuilderHeaderShell>
        );
      },
      headerActions: (): ReactElement => {
        const state = headerActionsStateRef.current;
        const extras = translateExtrasRef.current;
        return (
          <PageBuilderHeaderActions
            {...(state.translate
              ? {
                  extraActions: (
                    <PuckPageBuilderTranslateAction
                      capability={state.translate.capability}
                      activeLanguage={state.translate.activeLanguage}
                      languages={state.languages}
                      currentData={state.editorData}
                      resource={extras.resource}
                      onResolveLanguageContent={extras.onResolveLanguageContent}
                      declarationOf={extras.declarationOf}
                      onTranslated={extras.applyTranslation}
                      onNothingToTranslate={extras.nothing}
                    />
                  ),
                }
              : {})}
            fullscreen={state.fullscreen}
            onToggleFullscreen={(): void => state.setFullscreen((f) => !f)}
            languages={state.languages}
            activeLanguage={state.activeLanguage}
            currentData={state.editorData}
            {...(state.onCopyFromLanguage ? { onCopyFromLanguage: state.onCopyFromLanguage } : {})}
            {...(state.onClearCanvas ? { onClearCanvas: state.onClearCanvas } : {})}
            t={state.tChrome}
          />
        );
      },
    }),
    [],
  );

  return (
    <div
      className={cn(
        'cms-page-builder space-y-3',
        fullscreen && 'fixed inset-0 z-50 flex flex-col overflow-auto bg-background p-4',
      )}
    >
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {translationNotice ? (
        <TranslationNotice
          notice={translationNotice}
          onRestore={(previous): void => {
            setTranslationNotice(null);
            applyCanvasData(structuredClone(previous));
          }}
          onDismiss={(): void => setTranslationNotice(null)}
        />
      ) : null}
      {(!descriptor || contributedEditors === null) && !error ? (
        <p className="text-sm text-muted-foreground">{t('pageBuilder.loadingConfig')}</p>
      ) : null}
      <div
        className={cn(
          'cms-page-builder__canvas overflow-x-auto overflow-y-auto border',
          fullscreen ? 'min-h-0 flex-1 rounded-md' : 'min-h-[640px] rounded-md',
        )}
      >
        {/* The surrounding editor's own Save actions persist content, so Puck's
            built-in "Publish" header button is redundant — replace the
            header-actions slot with the Fullscreen toggle so it sits in the
            toolbar alongside Puck's left/right panel-visibility buttons. The
            CmsRenderProvider feeds resolved block/template previews to the
            InsertBlock / InsertTemplate embeds so they render their content on
            the canvas. */}
        <AdminCmsAssetProvider embeds={embeds} data={editorData}>
          <AdminCatalogPreviewProvider>
            <PageBuilderColorPaletteProvider
              initialEntries={descriptor?.colorPalette ?? []}
              brandColors={brandColors}
            >
              <PreviewBrandTokensProvider tokens={descriptor?.brandTokens ?? null}>
              <Puck
                key={`${contentKey ?? 'pb'}:${canvasEpoch}`}
                config={config}
                data={editorData}
                onChange={handleEditorChange}
                onAction={handlePuckAction}
                viewports={viewports}
                iframe={{ enabled: true, waitForStyles: true }}
                plugins={plugins}
                dnd={PUCK_LEGACY_DND}
                overrides={puckOverrides}
                fieldTransforms={INLINE_RICH_TEXT_FIELD_TRANSFORMS}
              />
              </PreviewBrandTokensProvider>
            </PageBuilderColorPaletteProvider>
          </AdminCatalogPreviewProvider>
        </AdminCmsAssetProvider>
      </div>
      <RowLayoutPicker
        open={rowLayoutPickerForId !== null}
        onOpenChange={(open): void => {
          if (!open) setRowLayoutPickerForId(null);
        }}
        onSelect={(presetId): void => {
          if (rowLayoutPickerForId) applyRowPreset(rowLayoutPickerForId, presetId);
          setRowLayoutPickerForId(null);
        }}
      />
    </div>
  );
}

export type { Data as PageBuilderData };
