import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Puck, Render, type Config, type ComponentConfig, type Data, type PuckAction } from '@measured/puck';
import { Maximize2, Minimize2 } from 'lucide-react';
import '@measured/puck/puck.css';
// Self-contained, prefix-isolated (`cmsc:`) stylesheet for the shared CMS components
// (feature 041, FR-012b). This is the admin's ONLY change; it carries its own token
// values + no preflight, so it cannot restyle admin chrome.
import '@b2b/cms-components/styles.css';
import {
  defaultPageBuilderConfig,
  makeMissingComponentConfig,
  CmsRenderProvider,
  withCmsPageRoot,
  type CmsRenderEmbeds,
} from '@b2b/cms-components';
import { DEFAULT_BREAKPOINTS, filterConfigByContext } from '@b2b/page-builder-core';
import { createPageBuilderEditorPlugin } from '@b2b/page-builder-core/editor';
import type { CmsPageBuilderDescriptor } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  applyRowLayoutPreset,
  findRowById,
  replaceRowInData,
  type RowLayoutPresetId,
} from '@b2b/cms-components/editor/row-layout-presets';
import { toPuckItemArray } from '@b2b/page-builder-core/editor';
import { createPuckActionHandler, PuckDispatchBridgeSlot } from './PuckActionGuard';
import { RowLayoutPicker } from './RowLayoutPicker';
import { PageBuilderActionBar } from './PageBuilderActionBar';
import { PageBuilderOverlayBridge } from './PageBuilderOverlayBridge';
import { hasInvalidColumnPlacement } from '@b2b/page-builder-core/editor';

const emptyData: Data = { root: { props: {} }, content: [] };

function insertedItem(action: Extract<PuckAction, { type: 'insert' }>, data: Data) {
  const items = action.destinationZone.startsWith('root:')
    ? toPuckItemArray(data.content)
    : toPuckItemArray(data.zones?.[action.destinationZone]);
  return items[action.destinationIndex] ?? null;
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

function buildViewports(descriptor: CmsPageBuilderDescriptor | null) {
  const tabletMin = descriptor?.breakpoints?.tabletMin ?? DEFAULT_BREAKPOINTS.tabletMin;
  const desktopMin = descriptor?.breakpoints?.desktopMin ?? DEFAULT_BREAKPOINTS.desktopMin;
  return [
    { width: 360, label: 'Mobile', icon: 'Smartphone' as const },
    { width: tabletMin, label: 'Tablet', icon: 'Tablet' as const },
    { width: desktopMin, label: 'Desktop', icon: 'Monitor' as const },
  ];
}

export function PageBuilderEditor({
  data,
  onChange,
  contentKey,
  pageContainer = false,
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
}): ReactNode {
  const t = useTranslation('cms');
  const [descriptor, setDescriptor] = useState<CmsPageBuilderDescriptor | null>(null);
  const [blockOptions, setBlockOptions] = useState<BlockOption[]>([]);
  const [embeds, setEmbeds] = useState<CmsRenderEmbeds>({ blocks: {}, templates: {} });
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [rowLayoutPickerForId, setRowLayoutPickerForId] = useState<string | null>(null);
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
    return pageContainer ? withCmsPageRoot(filtered) : filtered;
  }, [descriptor, t, blockOptions, pageContainer]);
  const viewports = useMemo(() => buildViewports(descriptor), [descriptor]);
  const plugins = useMemo(() => [createPageBuilderEditorPlugin()], []);
  const editorData = data ?? emptyData;
  const lastValidDataRef = useRef(editorData);

  useEffect(() => {
    lastValidDataRef.current = editorData;
  }, [contentKey, editorData]);

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
      lastValidDataRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const headerActionsStateRef = useRef({ fullscreen, setFullscreen, t });
  headerActionsStateRef.current = { fullscreen, setFullscreen, t };

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
        const inserted = insertedItem(action, appState.data);
        const rowId = inserted?.props.id;
        if (typeof rowId === 'string') {
          setRowLayoutPickerForId(rowId);
        }
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
      headerActions: (): ReactElement => {
        const { fullscreen: isFullscreen, setFullscreen: setFs, t: translate } = headerActionsStateRef.current;
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(): void => setFs((f) => !f)}
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="mr-1 h-4 w-4" />
                {translate('pageBuilder.fullscreen.exit')}
              </>
            ) : (
              <>
                <Maximize2 className="mr-1 h-4 w-4" />
                {translate('pageBuilder.fullscreen.enter')}
              </>
            )}
          </Button>
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
          'cms-page-builder__canvas overflow-x-hidden overflow-y-auto border',
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
        <CmsRenderProvider embeds={embeds}>
          <AdminCatalogPreviewProvider>
            <PageBuilderColorPaletteProvider initialEntries={descriptor?.colorPalette ?? []}>
              <Puck
                key={contentKey}
                config={config}
                data={editorData}
                onChange={handleEditorChange}
                onAction={handlePuckAction}
                viewports={viewports}
                plugins={plugins}
                overrides={puckOverrides}
              />
            </PageBuilderColorPaletteProvider>
          </AdminCatalogPreviewProvider>
        </CmsRenderProvider>
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
