import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Puck, Render, type Config, type ComponentConfig, type Data, type PuckAction } from '@measured/puck';
import '@measured/puck/puck.css';
// Self-contained, prefix-isolated (`cmsc:`) stylesheet for the shared CMS components
// (feature 041, FR-012b). This is the admin's ONLY change; it carries its own token
// values + no preflight, so it cannot restyle admin chrome.
import '@b2b/cms-components/styles.css';
import {
  defaultPageBuilderConfig,
  makeMissingComponentConfig,
  withCmsPageRoot,
  type CmsRenderEmbeds,
} from '@b2b/cms-components';
import { filterConfigByContext } from '@b2b/page-builder-core';
import { createPageBuilderEditorPlugin } from '@b2b/page-builder-core/editor';
import { AdminCmsAssetProvider } from './AdminCmsAssetProvider';
import type { CmsPageBuilderDescriptor } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { cmsClient } from '../api/cms-client';
import { PageBuilderColorPaletteProvider } from './ColorPaletteProvider';
import { AdminCatalogPreviewProvider } from './AdminCatalogPreviewProvider';
import { createButtonLinkSlugField } from './ButtonLinkFields';
import {
  createCategorySlugField,
  createCategorySlugsField,
  createProductSlugField,
  createProductSlugsField,
} from './CatalogPickers';
import {
  createImageAssetField,
  createImageSourceField,
  createImageUrlField,
  createSlideImageField,
} from './AssetPickers';
import { createAdminBackgroundField } from './BackgroundFields';
import { buildViewports } from './build-viewports';
import {
  applyRowLayoutPreset,
  findRowById,
  replaceRowInData,
  wrapRowInContentSliderSlide,
  type RowLayoutPresetId,
} from '@b2b/cms-components/editor/row-layout-presets';
import { isContentSliderSlidesZone, toPuckItemArray } from '@b2b/page-builder-core/editor';
import { createPuckActionHandler, PuckDispatchBridgeSlot } from './PuckActionGuard';
import { RowLayoutPicker } from './RowLayoutPicker';
import { PageBuilderActionBar } from './PageBuilderActionBar';
import { PageBuilderHeaderActions } from './PageBuilderHeaderActions';
import { PageBuilderDrawer } from './PageBuilderDrawer';
import { applyPageBuilderTranslations } from './page-builder-i18n';
import { emptyPageBuilderData, isEmptyPageBuilderData } from './page-builder-data';
import { PageBuilderOverlayBridge } from './PageBuilderOverlayBridge';
import { hasInvalidColumnPlacement } from '@b2b/page-builder-core/editor';

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
      if (item.type === 'Row' && typeof item.props.id === 'string') {
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
 * `@b2b/cms-components` with the descriptor returned by the backend's
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
): Config {
  const base = defaultPageBuilderConfig;

  const components: Record<string, ComponentConfig> = {
    ...(base.components ?? {}),
  } as Record<string, ComponentConfig>;

  // Replace InsertBlock's free-text "Block code" field with a dropdown of the
  // available CMS blocks, so authors pick from a list instead of having to know
  // and type a code by hand.
  const insertBlock = components['InsertBlock'];
  if (insertBlock) {
    components['InsertBlock'] = {
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

  const button = components['Button'];
  if (button) {
    components['Button'] = {
      ...button,
      fields: {
        ...button.fields,
        linkSlug: createButtonLinkSlugField(),
      },
    } as ComponentConfig;
  }

  const hero = components['Hero'];
  if (hero) {
    components['Hero'] = {
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

  const productCard = components['ProductCard'];
  if (productCard) {
    components['ProductCard'] = {
      ...productCard,
      fields: { ...productCard.fields, productSlug: createProductSlugField() },
    } as ComponentConfig;
  }

  for (const name of ['ProductGrid', 'ProductSlider'] as const) {
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

  for (const name of ['CategoryList', 'CategoryGrid'] as const) {
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

  const image = components['Image'];
  if (image) {
    components['Image'] = {
      ...image,
      fields: {
        ...image.fields,
        imageSource: createImageSourceField(),
        src: createImageUrlField('Image URL'),
        assetId: createImageAssetField('Image'),
      },
    } as ComponentConfig;
  }

  const imageSlider = components['ImageSlider'];
  if (imageSlider) {
    const itemsField = imageSlider.fields?.items;
    components['ImageSlider'] = {
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

  for (const name of ['Row', 'Column', 'Hero', 'Testimonial', 'NewsletterSignup'] as const) {
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

  const testimonial = components['Testimonial'];
  if (testimonial) {
    components['Testimonial'] = {
      ...testimonial,
      fields: {
        ...testimonial.fields,
        avatarSource: createImageSourceField(),
        avatarUrl: createImageUrlField('Avatar URL'),
        avatarAssetId: createImageAssetField('Avatar'),
      },
    } as ComponentConfig;
  }

  const logoStrip = components['LogoStrip'];
  if (logoStrip) {
    const itemsField = logoStrip.fields?.items;
    components['LogoStrip'] = {
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

  if (descriptor) {
    for (const entry of descriptor.components) {
      if (components[entry.name]) continue;
      components[entry.name] = makeMissingComponentConfig(entry.name, entry.ownerModule);
    }
  }

  const baseCategories = base.categories ?? {};
  const localNames = new Set(Object.keys(base.components ?? {}));
  const extensionNames = (descriptor?.components ?? [])
    .filter((entry) => !localNames.has(entry.name))
    .map((entry) => entry.name);

  const categories = extensionNames.length > 0
    ? {
        ...baseCategories,
        extensions: {
          title: extensionTitle,
          components: extensionNames,
        },
      }
    : baseCategories;

  return { ...base, components, categories } as Config;
}

export function PageBuilderEditor({
  data,
  onChange,
  contentKey,
  pageContainer = false,
  languages = [],
  activeLanguage = null,
  onResolveLanguageContent,
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
  /** Content languages available for "copy from language". */
  languages?: string[];
  activeLanguage?: string | null;
  /** Load another language's saved/draft content (used by Copy from language). */
  onResolveLanguageContent?: (language: string) => Data | null | Promise<Data | null>;
}): ReactNode {
  const t = useTranslation('cms');
  const [descriptor, setDescriptor] = useState<CmsPageBuilderDescriptor | null>(null);
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

  const config = useMemo(() => {
    const merged = mergeConfig(descriptor, t('pageBuilder.extensions'), blockOptions);
    const filtered = filterConfigByContext(merged, 'cms');
    const rooted = pageContainer ? withCmsPageRoot(filtered) : filtered;
    return applyPageBuilderTranslations(rooted, t);
  }, [descriptor, t, blockOptions, pageContainer]);
  const viewports = useMemo(() => buildViewports(descriptor), [descriptor]);
  const plugins = useMemo(() => [createPageBuilderEditorPlugin()], []);
  /** Holds canvas data across remount until parent `data` catches up (clear / copy-from). */
  const pendingSeedRef = useRef<Data | null>(null);
  const editorData = pendingSeedRef.current ?? data ?? emptyData;
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
    t,
    languages,
    activeLanguage,
    editorData: data ?? emptyPageBuilderData(),
    onCopyFromLanguage: null as null | ((sourceLanguage: string) => Promise<void>),
    onClearCanvas: null as null | (() => void),
    drawerSearchPlaceholder: t('pageBuilder.drawer.searchPlaceholder'),
    drawerSearchEmpty: t('pageBuilder.drawer.searchEmpty'),
  });
  headerActionsStateRef.current = {
    fullscreen,
    setFullscreen,
    t,
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
        return replaceRowInData(previous, rowId, { type: 'Row', props: { ...nextProps, id: rowId } });
      },
    });
  }, []);

  const handlePuckAction = useMemo(
    () =>
      createPuckActionHandler(dispatchRef, (action, appState) => {
        if (action.type !== 'insert' || action.componentType !== 'Row') return;

        const rowId = resolveInsertedRowId(action, appState.data);
        if (!rowId) return;

        if (!isContentSliderSlidesZone(action.destinationZone, appState.data)) return;

        const inserted =
          insertedItem(action, appState.data) ??
          findRowById(appState.data, rowId) ?? {
            type: 'Row',
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
      }): ReactElement => (name === 'Column' || name === 'Slide' ? <></> : <>{children}</>),
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
            t={state.t}
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
