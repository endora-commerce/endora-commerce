import '@endora-commerce/cms-components/styles.css';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Puck, type Config, type ComponentConfig, type Data, type PuckAction } from '@measured/puck';
import '@measured/puck/puck.css';
import { Eye, Monitor, Smartphone, X } from 'lucide-react';
import {
  applyEmailRowLayoutPreset,
  buildSampleVariableContext,
  DEFAULT_ORDER_ITEMS_SAMPLE,
  defaultEmailBuilderConfig,
  EmailBrandingPreviewProvider,
  EmailEmbedsProvider,
  filterEmailPaletteByVariables,
  findEmailRowById,
  replaceEmailRowInData,
  renderDirectives,
  renderEmailHtml,
  sampleOrderDiscountsText,
  sampleOrderSummaryText,
  useEmailBrandingPreview,
  type EmailEmbeds,
  type EmailRenderEmbeds,
  type EmailRowLayoutPresetId,
  type EmailRowProps,
  type PuckDataTree,
} from '@endora-commerce/email-components';
import { filterConfigByContext, type PageBuilderContext } from '@endora-commerce/page-builder-core';
import {
  hasInvalidColumnPlacement,
  shouldRevertPuckAction,
  toPuckItemArray,
} from '@endora-commerce/page-builder-core/editor';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import {
  createImageAssetField,
  createImageSourceField,
  createImageUrlField,
} from '@/modules/cms/components/AssetPickers';
import {
  createCategorySlugsField,
  createProductSlugField,
  createProductSlugsField,
} from '@/modules/cms/components/CatalogPickers';
import { PageBuilderColorPaletteProvider } from '@/modules/cms/components/ColorPaletteProvider';
import {
  PageBuilderHeaderActions,
  PageBuilderHeaderShell,
  PageBuilderTemplateActions,
} from '@/modules/cms/components/PageBuilderHeaderActions';
import { PageBuilderOverlayBridge } from '@/modules/cms/components/PageBuilderOverlayBridge';
import { cmsClient } from '@/modules/cms/api/cms-client';
import { transactionalEmailsClient } from '@/modules/transactional_emails/api/transactional-emails-client';
import { fetchAssetDetail } from '@endora-commerce/admin-kit/components';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@/i18n/useTranslation';
import { emailRichTextContentField, emailHtmlFromRichContent } from './EmailRichTextField';
import { emailTextareaWithVariablesField } from './EmailVariableFields';
import { createEmailBuilderEditorPlugin } from './email-builder-plugin';
import { useEmailVariables, type EmailVariableItem } from './EmailVariablesProvider';
import { EmailBuilderActionBar } from './EmailBuilderActionBar';
import { EmailRowLayoutPicker } from './EmailRowLayoutPicker';

export type EmailPreviewWidth = 600 | 320;

const emptyData: Data = { root: { props: {} }, content: [] };
const CANVAS_WIDTH: EmailPreviewWidth = 600;
const emailBuilderPlugin = createEmailBuilderEditorPlugin();

function collectEmailRowIds(data: Data): Set<string> {
  const ids = new Set<string>();
  const visit = (items: ReturnType<typeof toPuckItemArray>): void => {
    for (const item of items) {
      if (item.type === 'EmailRow' && typeof item.props.id === 'string') {
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

export interface EmailEmbedCodeOption {
  label: string;
  value: string;
}

export interface EmailEditorPaneProps {
  data: Data;
  onChange: (data: Data) => void;
  editorKey: string;
  builderContext?: PageBuilderContext;
  blockOptions?: EmailEmbedCodeOption[];
  embeds?: EmailEmbeds;
  /** Block/template trees for expanding EmailInsert* in HTML preview. */
  embedTrees?: EmailRenderEmbeds;
  /** Active content language — localizes built-in order sample strings / headers. */
  previewLanguage?: string | null;
  salesChannelId?: string | null;
  /** Optional extra sample context (merged into preview variables). */
  previewExtras?: Record<string, unknown>;
  /** Save current canvas as an email template (TE templates store). */
  onSaveAsTemplate?: (meta: { name: string; code: string }, data: Data) => void | Promise<void>;
  /** List templates for the Apply template picker. */
  onListTemplatesForApply?: () => Promise<Array<{ id: string; label: string }>>;
  /** Load a template layout to replace the canvas. */
  onResolveTemplateLayout?: (templateId: string) => Data | Promise<Data>;
}

const PREVIEW_PLACEHOLDER_LOGO = 'https://placehold.co/160x48?text=Logo';
const PREVIEW_UNSUBSCRIBE_URL = 'https://shop.example/newsletter/unsubscribe?token=preview';

function pickLanguageTree(content: Record<string, unknown>): PuckDataTree | null {
  const raw = content['pl-PL'] ?? content['en-US'] ?? Object.values(content)[0] ?? null;
  if (!raw || typeof raw !== 'object') return null;
  return raw as PuckDataTree;
}

/**
 * Canvas preview for an embedded block/template. Resolves branding (and other
 * sample) directives so `{{var branding.logoUrl}}` becomes a real `<img src>`.
 */
function EmbedPreviewHtml({ content }: { content: Record<string, unknown> }): React.ReactElement {
  const { logoUrl } = useEmailBrandingPreview();
  const tree = pickLanguageTree(content);
  const raw = renderEmailHtml(tree, { document: false });
  const html = renderDirectives(
    raw,
    {
      branding: {
        logoUrl: logoUrl || PREVIEW_PLACEHOLDER_LOGO,
        accentColor: '#1f2937',
      },
      unsubscribeUrl: PREVIEW_UNSUBSCRIBE_URL,
    },
    { escape: true },
  );
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function previewNode(content: Record<string, unknown>): ReactNode {
  return <EmbedPreviewHtml content={content} />;
}

const STOREFRONT_BASE_URL = (
  (import.meta.env.VITE_STOREFRONT_BASE_URL as string | undefined) ?? 'http://localhost:3000'
).replace(/\/+$/, '');

function toAbsoluteStorefrontUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (pathOrUrl.startsWith('/')) return `${STOREFRONT_BASE_URL}${pathOrUrl}`;
  return pathOrUrl;
}

function pickName(name: Record<string, string> | string, fallback: string): string {
  if (typeof name === 'string') return name || fallback;
  return name['pl-PL'] ?? name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

async function resolveProductForCard(slug: string): Promise<{
  productId: string;
  productSlug: string;
  title: string;
  sku: string;
  imageSrc: string;
  href: string;
}> {
  if (!slug) {
    return { productId: '', productSlug: '', title: 'Select a product', sku: '', imageSrc: '', href: '' };
  }
  const params = new URLSearchParams();
  params.set('q', slug);
  params.set('pageSize', '10');
  const res = await apiClient.get<{
    data: Array<{ id: string; slug: string; name: Record<string, string> | string; sku: string }>;
  }>(`/api/v1/admin/catalog/products?${params.toString()}`);
  const product = res.data.find((p) => p.slug === slug) ?? res.data[0];
  if (!product) {
    return {
      productId: '',
      productSlug: slug,
      title: slug,
      sku: '',
      imageSrc: '',
      href: toAbsoluteStorefrontUrl(`/p/${slug}`),
    };
  }
  let imageSrc = '';
  try {
    const gallery = await apiClient.get<{
      data: Array<{ assetId: string; labels: string[]; position: number }>;
    }>(`/api/v1/admin/catalog/products/${product.id}/gallery`);
    const ordered = [...gallery.data].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const preferred =
      ordered.find((g) => g.labels?.includes('thumbnail')) ??
      ordered.find((g) => g.labels?.includes('small_image')) ??
      ordered.find((g) => g.labels?.includes('base_image')) ??
      ordered[0];
    if (preferred?.assetId) {
      const asset = await fetchAssetDetail(preferred.assetId);
      imageSrc = toAbsoluteAssetUrl(asset.url);
    }
  } catch {
    /* no gallery */
  }
  return {
    productId: product.id,
    productSlug: product.slug,
    title: pickName(product.name, product.slug),
    sku: product.sku,
    imageSrc,
    href: toAbsoluteStorefrontUrl(`/p/${product.slug}`),
  };
}

async function resolveCategoryForGrid(slug: string): Promise<{
  categoryId: string;
  categorySlug: string;
  title: string;
  href: string;
  imageSrc: string;
}> {
  if (!slug) {
    return { categoryId: '', categorySlug: '', title: '', href: '', imageSrc: '' };
  }
  const res = await apiClient.get<{
    data: Array<{
      id: string;
      slug: string;
      name: Record<string, string> | string;
      mainImageAssetId?: string | null;
    }>;
  }>('/api/v1/admin/catalog/categories');
  const category = res.data.find((c) => c.slug === slug);
  if (!category) {
    return {
      categoryId: '',
      categorySlug: slug,
      title: slug,
      href: toAbsoluteStorefrontUrl(`/c/${slug}`),
      imageSrc: '',
    };
  }
  let imageSrc = '';
  if (category.mainImageAssetId) {
    try {
      const asset = await fetchAssetDetail(category.mainImageAssetId);
      imageSrc = toAbsoluteAssetUrl(asset.url);
    } catch {
      /* ignore */
    }
  }
  return {
    categoryId: category.id,
    categorySlug: category.slug,
    title: pickName(category.name, category.slug),
    href: toAbsoluteStorefrontUrl(`/c/${category.slug}`),
    imageSrc,
  };
}

function withEditorFields(base: Config): Config {
  const components: Record<string, ComponentConfig> = { ...(base.components ?? {}) };

  const patchTextarea = (name: string, fieldKey: string): void => {
    const c = components[name];
    if (!c?.fields?.[fieldKey]) return;
    components[name] = {
      ...c,
      fields: {
        ...c.fields,
        [fieldKey]: {
          ...emailTextareaWithVariablesField,
          label: (c.fields[fieldKey] as { label?: string }).label,
        },
      },
    } as ComponentConfig;
  };

  patchTextarea('EmailText', 'text');
  patchTextarea('EmailHeading', 'text');
  patchTextarea('EmailCallout', 'text');
  patchTextarea('EmailFooterLegal', 'text');

  const rich = components['EmailRichText'];
  if (rich) {
    components['EmailRichText'] = {
      ...rich,
      fields: {
        ...rich.fields,
        content: emailRichTextContentField,
        align: rich.fields?.['align'],
      },
      resolveData: async ({ props }, { changed }: { changed: Record<string, boolean> }) => {
        if (changed['content'] || (!props['html'] && props['content'])) {
          return {
            props: {
              ...props,
              html: emailHtmlFromRichContent(props['content']) || props['html'] || '',
            },
          };
        }
        return { props };
      },
    } as ComponentConfig;
  }

  const image = components['EmailImage'];
  if (image) {
    components['EmailImage'] = {
      ...image,
      fields: {
        ...image.fields,
        imageSource: createImageSourceField(),
        src: createImageUrlField('Image URL'),
        assetId: createImageAssetField('Image'),
      },
      resolveData: async ({ props }) => {
        const source = props.imageSource === 'library' ? 'library' : 'url';
        let src = typeof props.src === 'string' ? props.src : '';
        const assetId = typeof props.assetId === 'string' ? props.assetId : '';
        if (source === 'library' && assetId) {
          try {
            const detail = await fetchAssetDetail(assetId);
            src = toAbsoluteAssetUrl(detail.url);
          } catch {
            /* keep */
          }
        }
        if (source === 'url') {
          return { props: { ...props, imageSource: 'url', assetId: '', src } };
        }
        return { props: { ...props, imageSource: 'library', assetId, src } };
      },
    } as ComponentConfig;
  }

  const productCard = components['EmailProductCard'];
  if (productCard) {
    components['EmailProductCard'] = {
      ...productCard,
      fields: {
        ...productCard.fields,
        productSlug: createProductSlugField(),
      },
      resolveData: async ({ props }) => {
        const slug = typeof props.productSlug === 'string' ? props.productSlug : '';
        if (!slug) {
          return {
            props: {
              ...props,
              productId: '',
              title: 'Select a product',
              sku: '',
              imageSrc: '',
              href: typeof props.href === 'string' ? props.href : '',
            },
          };
        }
        try {
          const resolved = await resolveProductForCard(slug);
          const priceOverride = typeof props.price === 'string' ? props.price : '';
          const hrefOverride = typeof props.href === 'string' ? props.href : '';
          return {
            props: {
              ...props,
              productSlug: slug,
              productId: resolved.productId,
              title: resolved.title,
              sku: resolved.sku,
              imageSrc: resolved.imageSrc,
              // Keep author price override when set; otherwise leave blank for B2B.
              price: priceOverride,
              href: hrefOverride
                ? toAbsoluteStorefrontUrl(hrefOverride)
                : resolved.href,
            },
          };
        } catch {
          return { props };
        }
      },
    } as ComponentConfig;
  }

  const productGrid = components['EmailProductGrid'];
  if (productGrid) {
    components['EmailProductGrid'] = {
      ...productGrid,
      fields: {
        ...productGrid.fields,
        productSlugs: createProductSlugsField(),
      },
      resolveData: async ({ props }) => {
        const slugs = Array.isArray(props.productSlugs)
          ? (props.productSlugs as string[]).filter((s) => typeof s === 'string' && s)
          : [];
        if (slugs.length === 0) {
          return { props: { ...props, productSlugs: [], items: [] } };
        }
        try {
          const items = await Promise.all(slugs.map((slug) => resolveProductForCard(slug)));
          return {
            props: {
              ...props,
              productSlugs: slugs,
              items: items.map((item) => ({
                productId: item.productId,
                productSlug: item.productSlug,
                title: item.title,
                sku: item.sku,
                price: '',
                href: item.href,
                imageSrc: item.imageSrc,
              })),
            },
          };
        } catch {
          return { props };
        }
      },
    } as ComponentConfig;
  }

  const categoryGrid = components['EmailCategoryGrid'];
  if (categoryGrid) {
    components['EmailCategoryGrid'] = {
      ...categoryGrid,
      fields: {
        ...categoryGrid.fields,
        categorySlugs: createCategorySlugsField(),
      },
      resolveData: async ({ props }) => {
        const slugs = Array.isArray(props.categorySlugs)
          ? (props.categorySlugs as string[]).filter((s) => typeof s === 'string' && s)
          : [];
        if (slugs.length === 0) {
          return { props: { ...props, categorySlugs: [], items: [] } };
        }
        try {
          const items = await Promise.all(slugs.map((slug) => resolveCategoryForGrid(slug)));
          return {
            props: {
              ...props,
              categorySlugs: slugs,
              items,
            },
          };
        } catch {
          return { props };
        }
      },
    } as ComponentConfig;
  }

  return { ...base, components };
}

function mergeEmbedSelects(base: Config, blockOptions: EmailEmbedCodeOption[]): Config {
  const components: Record<string, ComponentConfig> = { ...(base.components ?? {}) };
  const insertBlock = components['EmailInsertBlock'];
  if (insertBlock) {
    components['EmailInsertBlock'] = {
      ...insertBlock,
      fields: {
        ...insertBlock.fields,
        code: { type: 'select', label: 'Block', options: [{ label: '—', value: '' }, ...blockOptions] },
      },
    } as ComponentConfig;
  }
  return { ...base, components };
}

function EmailHtmlPreviewModal({
  open,
  html,
  onClose,
}: {
  open: boolean;
  html: string;
  onClose: () => void;
}): React.ReactElement | null {
  const [width, setWidth] = useState<EmailPreviewWidth>(600);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Preview email"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-background shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Preview email</span>
            <Button
              type="button"
              variant={width === 600 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setWidth(600)}
              aria-pressed={width === 600}
            >
              <Monitor className="mr-1 h-4 w-4" />
              Desktop mail (600px)
            </Button>
            <Button
              type="button"
              variant={width === 320 ? 'default' : 'outline'}
              size="sm"
              onClick={() => setWidth(320)}
              aria-pressed={width === 320}
            >
              <Smartphone className="mr-1 h-4 w-4" />
              Narrow (320px)
            </Button>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close preview">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
          <iframe
            title="Email HTML preview"
            srcDoc={html}
            className="mx-auto block h-[min(70vh,640px)] border-0 bg-white shadow-sm"
            style={{ width, maxWidth: '100%', overflow: 'hidden' }}
            scrolling="auto"
          />
        </div>
      </div>
    </div>
  );
}

function buildPreviewHtml(
  data: Data,
  variables: EmailVariableItem[],
  logoUrl: string,
  extras: Record<string, unknown>,
  embedTrees?: EmailRenderEmbeds,
  previewLanguage?: string | null,
): string {
  const language = previewLanguage || 'en-US';
  const raw = renderEmailHtml((data ?? emptyData) as never, {
    document: true,
    language,
    ...(embedTrees ? { embeds: embedTrees } : {}),
  });
  const fromDescriptors = buildSampleVariableContext(
    variables.map((v) => ({ key: v.key, sampleValue: v.sampleValue ?? v.snippet })),
    {
      branding: { logoUrl: logoUrl || PREVIEW_PLACEHOLDER_LOGO, accentColor: '#1f2937' },
      ...extras,
    },
  );
  // Ensure order.items exists for Order summary even when not in the variable catalogue.
  const order = (fromDescriptors['order'] as Record<string, unknown> | undefined) ?? {};
  if (!Array.isArray(order['items'])) {
    order['items'] = DEFAULT_ORDER_ITEMS_SAMPLE;
    fromDescriptors['order'] = order;
  }
  // Always localize built-in order money lines for the active editor language —
  // catalogue sampleValue is English-only.
  order['summaryText'] = sampleOrderSummaryText(language);
  if (typeof order['discountsText'] !== 'string' || order['discountsText'] === '  none') {
    order['discountsText'] = sampleOrderDiscountsText(language);
  }
  fromDescriptors['order'] = order;
  if (typeof fromDescriptors['unsubscribeUrl'] !== 'string' || !fromDescriptors['unsubscribeUrl']) {
    fromDescriptors['unsubscribeUrl'] = PREVIEW_UNSUBSCRIBE_URL;
  }
  return renderDirectives(raw, fromDescriptors, { escape: true });
}

export function EmailEditorPane({
  data,
  onChange,
  editorKey,
  builderContext = 'email',
  blockOptions = [],
  embeds: embedsProp,
  embedTrees: embedTreesProp,
  previewLanguage = null,
  salesChannelId = null,
  previewExtras = {},
  onSaveAsTemplate,
  onListTemplatesForApply,
  onResolveTemplateLayout,
}: EmailEditorPaneProps): React.ReactElement {
  const { variables } = useEmailVariables();
  const tCms = useTranslation('cms');
  const [embeds, setEmbeds] = useState<EmailEmbeds>(embedsProp ?? { blocks: {}, templates: {} });
  const [embedTrees, setEmbedTrees] = useState<EmailRenderEmbeds>(
    embedTreesProp ?? { blocks: {}, templates: {} },
  );
  const [fullscreen, setFullscreen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [canvasEpoch, setCanvasEpoch] = useState(0);
  const [rowLayoutPickerForId, setRowLayoutPickerForId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [paletteEntries, setPaletteEntries] = useState<
    NonNullable<Awaited<ReturnType<typeof cmsClient.getPageBuilderConfig>>['colorPalette']>
  >([]);
  const knownRowIdsRef = useRef<Set<string>>(collectEmailRowIds(data ?? emptyData));
  const lastValidDataRef = useRef(data ?? emptyData);

  const applyCanvasData = (next: Data): void => {
    knownRowIdsRef.current = collectEmailRowIds(next);
    lastValidDataRef.current = next;
    onChange(next);
    setCanvasEpoch((n) => n + 1);
  };

  const handleEditorChange = useCallback(
    (next: Data) => {
      if (hasInvalidColumnPlacement(next)) {
        // Remount to last good tree — EmailColumn must stay inside EmailRow.
        setCanvasEpoch((n) => n + 1);
        return;
      }

      const nextRowIds = collectEmailRowIds(next);
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

  const handlePuckAction = useCallback((action: PuckAction, appState: { data: Data }): PuckAction | false => {
    if (shouldRevertPuckAction(action, appState.data, lastValidDataRef.current)) {
      return false;
    }
    return action;
  }, []);

  const applyRowLayout = useCallback(
    (rowId: string, presetId: EmailRowLayoutPresetId): void => {
      const row = findEmailRowById(lastValidDataRef.current, rowId);
      if (!row) {
        setRowLayoutPickerForId(null);
        return;
      }
      const nextProps = applyEmailRowLayoutPreset(row.props as unknown as EmailRowProps, presetId);
      const next = replaceEmailRowInData(lastValidDataRef.current, rowId, {
        type: 'EmailRow',
        props: { ...nextProps, id: rowId },
      });
      lastValidDataRef.current = next;
      knownRowIdsRef.current = collectEmailRowIds(next);
      onChange(next);
      setCanvasEpoch((n) => n + 1);
      setRowLayoutPickerForId(null);
    },
    [onChange],
  );

  const hasTemplateActions = Boolean(
    onSaveAsTemplate || (onListTemplatesForApply && onResolveTemplateLayout),
  );

  useEffect(() => {
    if (embedsProp) setEmbeds(embedsProp);
  }, [embedsProp]);

  useEffect(() => {
    if (embedTreesProp) setEmbedTrees(embedTreesProp);
  }, [embedTreesProp]);

  useEffect(() => {
    let live = true;
    void transactionalEmailsClient
      .branding(salesChannelId)
      .then((b) => {
        if (live) setLogoUrl(toAbsoluteAssetUrl(b.logoUrl || ''));
      })
      .catch(() => {
        if (live) setLogoUrl('');
      });
    return () => {
      live = false;
    };
  }, [salesChannelId]);

  useEffect(() => {
    let live = true;
    void cmsClient
      .getPageBuilderConfig()
      .then((cfg) => {
        if (live) setPaletteEntries(cfg.colorPalette ?? []);
      })
      .catch(() => {
        if (live) setPaletteEntries([]);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const config = useMemo(() => {
    const withFields = withEditorFields(defaultEmailBuilderConfig);
    const withEmbeds = mergeEmbedSelects(withFields, blockOptions);
    const byContext = filterConfigByContext(withEmbeds, builderContext);
    return filterEmailPaletteByVariables(
      byContext,
      variables.map((v) => v.key),
    );
  }, [blockOptions, builderContext, variables]);

  const previewHtml = useMemo(
    () =>
      buildPreviewHtml(
        data ?? emptyData,
        variables,
        logoUrl,
        previewExtras,
        embedTrees,
        previewLanguage,
      ),
    [data, variables, logoUrl, previewExtras, embedTrees, previewLanguage],
  );

  return (
    <PageBuilderColorPaletteProvider initialEntries={paletteEntries}>
      <div
        className={cn('space-y-3', fullscreen && 'fixed inset-0 z-50 flex flex-col overflow-auto bg-background p-4')}
      >
        <div
          className={cn(
            'overflow-hidden rounded-md border',
            fullscreen ? 'min-h-0 flex-1' : 'min-h-[560px]',
          )}
          style={{ ['--email-preview-width' as string]: `${CANVAS_WIDTH}px` }}
        >
          <EmailBrandingPreviewProvider value={{ logoUrl }}>
            <EmailEmbedsProvider value={embeds}>
              <div className="email-builder-pane" data-preview-width={CANVAS_WIDTH}>
                <Puck
                  key={`${editorKey}:${canvasEpoch}`}
                  config={config}
                  data={data ?? emptyData}
                  onChange={handleEditorChange}
                  onAction={handlePuckAction}
                  plugins={[emailBuilderPlugin]}
                  overrides={{
                    drawerItem: ({
                      name,
                      children,
                    }: {
                      name: string;
                      children: ReactNode;
                    }) => (name === 'EmailColumn' ? <></> : <>{children}</>),
                    actionBar: (props: {
                      label?: string;
                      children: ReactNode;
                      parentAction: ReactNode;
                    }) => <EmailBuilderActionBar {...props} />,
                    componentOverlay: (props: {
                      children: ReactNode;
                      hover: boolean;
                      isSelected: boolean;
                      componentId: string;
                      componentType: string;
                    }) => <PageBuilderOverlayBridge {...props} />,
                    ...(hasTemplateActions
                      ? {
                          header: ({ children }: { children?: ReactNode }) => (
                            <PageBuilderHeaderShell
                              leading={
                                <PageBuilderTemplateActions
                                  currentData={data ?? emptyData}
                                  {...(onSaveAsTemplate ? { onSaveAsTemplate } : {})}
                                  {...(onListTemplatesForApply
                                    ? { onListTemplatesForApply }
                                    : {})}
                                  {...(onResolveTemplateLayout
                                    ? {
                                        onApplyTemplate: async (templateId: string) => {
                                          const next = await onResolveTemplateLayout(templateId);
                                          applyCanvasData(structuredClone(next));
                                        },
                                      }
                                    : {})}
                                  t={tCms}
                                />
                              }
                            >
                              {children}
                            </PageBuilderHeaderShell>
                          ),
                        }
                      : {}),
                    headerActions: () => (
                      <div className="cms-pb-header-actions">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setPreviewOpen(true)}
                          title="Preview email"
                          aria-label="Preview email"
                        >
                          <Eye className="h-4 w-4" />
                          <span className="cms-pb-header-actions__label">Preview email</span>
                        </Button>
                        <PageBuilderHeaderActions
                          fullscreen={fullscreen}
                          onToggleFullscreen={(): void => setFullscreen((f) => !f)}
                          currentData={data ?? emptyData}
                          onClearCanvas={(): void => applyCanvasData(emptyData)}
                          t={tCms}
                        />
                      </div>
                    ),
                  }}
                />
              </div>
            </EmailEmbedsProvider>
          </EmailBrandingPreviewProvider>
        </div>

        <EmailRowLayoutPicker
          open={rowLayoutPickerForId !== null}
          onOpenChange={(open): void => {
            if (!open) {
              if (rowLayoutPickerForId) {
                const row = findEmailRowById(lastValidDataRef.current, rowLayoutPickerForId);
                const cols = Array.isArray(row?.props.content) ? row.props.content : [];
                const hasColumns =
                  cols.length > 0 ||
                  Object.keys(lastValidDataRef.current.zones ?? {}).some((zone) =>
                    zone.startsWith(`${rowLayoutPickerForId}:`),
                  );
                // Zones may hold columns before props.content does — check zone length.
                const zoneCols =
                  lastValidDataRef.current.zones?.[`${rowLayoutPickerForId}:content`] ?? [];
                if (!hasColumns && (!Array.isArray(zoneCols) || zoneCols.length === 0)) {
                  applyRowLayout(rowLayoutPickerForId, '2');
                  return;
                }
              }
              setRowLayoutPickerForId(null);
            }
          }}
          onSelect={(presetId): void => {
            if (rowLayoutPickerForId) applyRowLayout(rowLayoutPickerForId, presetId);
            setRowLayoutPickerForId(null);
          }}
        />

        <EmailHtmlPreviewModal open={previewOpen} html={previewHtml} onClose={() => setPreviewOpen(false)} />
      </div>
    </PageBuilderColorPaletteProvider>
  );
}

export { previewNode };
