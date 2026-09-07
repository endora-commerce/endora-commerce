import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Puck, Render, type Config, type ComponentConfig, type Data, type PuckAction } from '@measured/puck';
import '@measured/puck/puck.css';
// Self-contained, prefix-isolated (`cmsc:`) stylesheet for the shared CMS components
// (feature 041, FR-012b). This is the admin's ONLY change; it carries its own token
// values + no preflight, so it cannot restyle admin chrome.
import '@endora-commerce/cms-components/styles.css';
import {
  defaultPageBuilderConfig,
  makeMissingComponentConfig,
  withCmsPageRoot,
  withMissingBlockPlaceholders,
  type CmsRenderEmbeds,
} from '@endora-commerce/cms-components';
import {
  buildPaletteCategories,
  contextAdmits,
  countBlockNames,
  filterConfigByContext,
  type PageBuilderContext,
} from '@endora-commerce/page-builder-core';
import { createPageBuilderEditorPlugin } from '@endora-commerce/page-builder-core/editor';
import { AdminCmsAssetProvider } from './AdminCmsAssetProvider.js';
import type { CmsPageBuilderDescriptor } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { cn } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { cmsClient } from '../api/cms-client.js';
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
  PageBuilderHeaderActions,
  PageBuilderHeaderShell,
  PageBuilderTemplateActions,
  emptyPageBuilderData,
  isEmptyPageBuilderData,
  PageBuilderOverlayBridge,
} from '@endora-commerce/page-builder-admin';
import { AdminCatalogPreviewProvider } from './AdminCatalogPreviewProvider.js';
import { createButtonLinkSlugField } from './ButtonLinkFields.js';
import { createAdminBackgroundField } from './BackgroundFields.js';
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
import { PageBuilderActionBar } from './PageBuilderActionBar.js';
import { PageBuilderDrawer } from './PageBuilderDrawer.js';
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

function mergeConfig(
  descriptor: CmsPageBuilderDescriptor | null,
  extensionTitle: string,
  blockOptions: BlockOption[],
  context: PageBuilderContext,
  sectionTitle: (ownerModule: string, titleKey: string, fallback: string) => string,
): Config {
  const base = defaultPageBuilderConfig;

  const components: Record<string, ComponentConfig> = {
    ...(base.components ?? {}),
  } as Record<string, ComponentConfig>;

  // Replace InsertBlock's free-text "Block code" field with a dropdown of the
  // available CMS blocks, so authors pick from a list instead of having to know
  // and type a code by hand.
  const insertBlock = components['cms.InsertBlock'];
  if (insertBlock) {
    components['cms.InsertBlock'] = {
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

  const button = components['cms.Button'];
  if (button) {
    components['cms.Button'] = {
      ...button,
      fields: {
        ...button.fields,
        linkSlug: createButtonLinkSlugField(),
      },
    } as ComponentConfig;
  }

  const hero = components['cms.Hero'];
  if (hero) {
    components['cms.Hero'] = {
      ...hero,
      fields: {
        ...hero.fields,
        buttonLinkSlug: createButtonLinkSlugField({
          label: 'Button link target',
          linkTypeProp: 'buttonLinkType',
        }),
      },
    } as ComponentConfig;
  }

  const productCard = components['catalog.ProductCard'];
  if (productCard) {
    components['catalog.ProductCard'] = {
      ...productCard,
      fields: { ...productCard.fields, productSlug: createProductSlugField() },
    } as ComponentConfig;
  }

  for (const name of ['catalog.ProductGrid', 'catalog.ProductSlider'] as const) {
    const cfg = components[name];
    if (cfg) {
      components[name] = {
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
    const cfg = components[name];
    if (cfg) {
      components[name] = {
        ...cfg,
        fields: {
          ...cfg.fields,
          categorySlugs: createCategorySlugsField(),
          parentSlug: createCategorySlugField(),
        },
      } as ComponentConfig;
    }
  }

  const image = components['cms.Image'];
  if (image) {
    components['cms.Image'] = {
      ...image,
      fields: {
        ...image.fields,
        imageSource: createImageSourceField(),
        src: createImageUrlField('Image URL'),
        assetId: createImageAssetField('Image'),
      },
    } as ComponentConfig;
  }

  const imageSlider = components['cms.ImageSlider'];
  if (imageSlider) {
    const itemsField = imageSlider.fields?.items;
    components['cms.ImageSlider'] = {
      ...imageSlider,
      fields: {
        ...imageSlider.fields,
        items:
          itemsField && itemsField.type === 'array'
            ? {
                ...itemsField,
                arrayFields: {
                  image: createSlideImageField(),
                  title: { type: 'text', label: 'Title' },
                  titlePlacement: itemsField.arrayFields?.titlePlacement ?? {
                    type: 'select',
                    label: 'Title placement',
                    options: [
                      { label: 'Hidden', value: 'none' },
                      { label: 'Top left', value: 'top-left' },
                      { label: 'Top center', value: 'top-center' },
                      { label: 'Top right', value: 'top-right' },
                      { label: 'Center', value: 'center' },
                      { label: 'Bottom left', value: 'bottom-left' },
                      { label: 'Bottom center', value: 'bottom-center' },
                      { label: 'Bottom right', value: 'bottom-right' },
                    ],
                  },
                  ...(itemsField.arrayFields?.titleBackground
                    ? { titleBackground: itemsField.arrayFields.titleBackground }
                    : {}),
                  ...(itemsField.arrayFields?.titleColor
                    ? { titleColor: itemsField.arrayFields.titleColor }
                    : {}),
                  ...(itemsField.arrayFields?.titleBorderColor
                    ? { titleBorderColor: itemsField.arrayFields.titleBorderColor }
                    : {}),
                  ...(itemsField.arrayFields?.titleBorderWidth
                    ? { titleBorderWidth: itemsField.arrayFields.titleBorderWidth }
                    : {}),
                  ...(itemsField.arrayFields?.titleBorderRadius
                    ? { titleBorderRadius: itemsField.arrayFields.titleBorderRadius }
                    : {}),
                  ...(itemsField.arrayFields?.titlePaddingPx
                    ? { titlePaddingPx: itemsField.arrayFields.titlePaddingPx }
                    : {}),
                },
              }
            : itemsField,
      },
    } as ComponentConfig;
  }

  for (const name of ['cms.Row', 'cms.Column', 'cms.Hero', 'cms.Testimonial', 'cms.NewsletterSignup'] as const) {
    const cfg = components[name];
    if (cfg) {
      components[name] = {
        ...cfg,
        fields: {
          ...cfg.fields,
          background: createAdminBackgroundField(),
        },
      } as ComponentConfig;
    }
  }

  const testimonial = components['cms.Testimonial'];
  if (testimonial) {
    components['cms.Testimonial'] = {
      ...testimonial,
      fields: {
        ...testimonial.fields,
        avatarSource: createImageSourceField(),
        avatarUrl: createImageUrlField('Avatar URL'),
        avatarAssetId: createImageAssetField('Avatar'),
      },
    } as ComponentConfig;
  }

  const logoStrip = components['cms.LogoStrip'];
  if (logoStrip) {
    const itemsField = logoStrip.fields?.items;
    components['cms.LogoStrip'] = {
      ...logoStrip,
      fields: {
        ...logoStrip.fields,
        items:
          itemsField && itemsField.type === 'array'
            ? {
                ...itemsField,
                arrayFields: {
                  image: createSlideImageField(),
                  alt: itemsField.arrayFields?.alt ?? { type: 'text', label: 'Alt text' },
                  href: itemsField.arrayFields?.href ?? {
                    type: 'text',
                    label: 'Link URL (optional)',
                  },
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
  const declared = (descriptor?.components ?? []).filter((entry) =>
    contextAdmits(entry.contexts ?? ['cms'], context),
  );
  for (const entry of declared) {
    if (components[entry.name]) continue;
    // `visible: true` because this is an editing surface: the operator has to be
    // told which module a block is waiting on. The parameter had no caller until
    // feature 096's T602 and the placeholder read the `?cms_admin=1` preview
    // parameter instead, which nothing in this repository sets — so every
    // placeholder the editor merged rendered an empty span.
    components[entry.name] = makeMissingComponentConfig(entry.name, entry.ownerModule, {
      visible: true,
    });
  }

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
}): ReactNode {
  const t = useTranslation('cms');
  // A section's `titleKey` is **module-relative** and belongs to the module
  // whose declaration won the merge, so it is resolved in that module's scope
  // and not in `cms`' (`contracts/block-definition.md` §2). The key itself is
  // the fallback the resolver already renders for a key it cannot find; the
  // section key is a last resort so a drawer is never headed with nothing.
  const { t: translateInScope } = useTranslationContext();
  const sectionTitle = useCallback(
    (ownerModule: string, titleKey: string, fallback: string): string => {
      const resolved = translateInScope(ownerModule, titleKey);
      return resolved === `${ownerModule}.${titleKey}` ? fallback : resolved;
    },
    [translateInScope],
  );
  // The shared page-builder chrome (`PageBuilderHeaderShell`,
  // `PageBuilderTemplateActions`, `PageBuilderHeaderActions`) owns no module
  // knowledge and reads `core`; this screen's own strings stay `cms`' (feature
  // 091 P5a, R-1).
  const tChrome = useTranslation('core');
  const [descriptor, setDescriptor] = useState<CmsPageBuilderDescriptor | null>(null);
  /**
   * A block's palette label, from the declaring module's own bundle.
   *
   * Same rule as the section title and for the same reason: `labelKey` is
   * module-relative, and after Phase 3 five of the CMS palette's entries are
   * `catalog`'s. Falls through to `applyPageBuilderTranslations`' legacy
   * `pageBuilder.components.<name>` key when the descriptor has not been
   * fetched yet, which is the first render.
   */
  const blockLabel = useCallback(
    (name: string): string | undefined => {
      const entry = descriptor?.components.find((component) => component.name === name);
      if (!entry?.labelKey) return undefined;
      const resolved = translateInScope(entry.ownerModule, entry.labelKey);
      return resolved === `${entry.ownerModule}.${entry.labelKey}` ? undefined : resolved;
    },
    [descriptor, translateInScope],
  );

  const [blockOptions, setBlockOptions] = useState<BlockOption[]>([]);
  const [embeds, setEmbeds] = useState<CmsRenderEmbeds>({ blocks: {}, templates: {} });
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [rowLayoutPickerForId, setRowLayoutPickerForId] = useState<string | null>(null);
  /** Bumped on clear / copy-from so Puck remounts (data prop is mount-only). */
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const dispatchRef = useRef<((action: PuckAction) => void) | null>(null);

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
      .getPageBuilderConfig()
      .then((result) => {
        if (live) setDescriptor(result);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

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
  const plugins = useMemo(() => [createPageBuilderEditorPlugin()], []);
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
    () => [...countBlockNames(editorData).keys()].sort().join('\n'),
    [editorData],
  );

  const config = useMemo(() => {
    const merged = mergeConfig(
      descriptor,
      t('pageBuilder.extensions'),
      blockOptions,
      context,
      sectionTitle,
    );
    const filtered = filterConfigByContext(merged, context);
    // FR-019/FR-020 — a stored block nothing here can render degrades to the
    // placeholder rather than vanishing from the canvas. **After** the context
    // filter and after the categories, deliberately: the block stays visible and
    // editable where it already is, and is not something an operator may insert.
    const degraded = withMissingBlockPlaceholders(
      filtered,
      storedBlockNamesKey === '' ? [] : storedBlockNamesKey.split('\n'),
    );
    const rooted = pageContainer ? withCmsPageRoot(degraded) : degraded;
    return applyPageBuilderTranslations(rooted, t, blockLabel);
  }, [
    descriptor,
    t,
    sectionTitle,
    blockLabel,
    blockOptions,
    pageContainer,
    context,
    storedBlockNamesKey,
  ]);
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
        return (
          <PageBuilderHeaderActions
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
      {!descriptor && !error ? (
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
            <PageBuilderColorPaletteProvider initialEntries={descriptor?.colorPalette ?? []}>
              <Puck
                key={`${contentKey ?? 'pb'}:${canvasEpoch}`}
                config={config}
                data={editorData}
                onChange={handleEditorChange}
                onAction={handlePuckAction}
                viewports={viewports}
                iframe={{ enabled: true, waitForStyles: true }}
                plugins={plugins}
                overrides={puckOverrides}
              />
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
