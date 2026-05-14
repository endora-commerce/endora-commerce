import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Archive as ArchiveIcon,
  ChevronLeft,
  Copy,
  Eye,
  FileText as FileTextIcon,
  Globe,
  Image as ImageIcon,
  CircleDollarSign,
  Layers,
  Link as LinkIcon,
  Paperclip,
  Save,
  Store as StoreIcon,
  Warehouse as WarehouseIcon,
} from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { AssetPicker } from '@/modules/assets_library/components/AssetPicker';
import type { AssetSummary, AssetDetail } from '@/modules/assets_library/api/assets-library-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EntityChannelMembership } from '../sales_channels/components/EntityChannelMembership';
import { ProductInventoryTab } from './ProductInventoryTab';
import { LinkedPriceListsPanel } from '../price_lists/LinkedPriceListsPanel';
import { ProductPicker } from './components/ProductPicker';

const LOCALES = ['en-US', 'pl-PL'] as const;
type Locale = (typeof LOCALES)[number];

const PRODUCT_TYPES = [
  'simple',
  'configurable',
  'grouped',
  'bundle',
  'virtual',
] as const;
const VISIBILITIES = ['public', 'logged_in_only', 'organization_restricted'] as const;
const STATUSES = ['draft', 'active', 'archived'] as const;

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
  status: 'draft' | 'active' | 'archived';
  name: Record<string, string>;
  description: Record<string, string>;
  visibility: 'public' | 'logged_in_only' | 'organization_restricted';
  attributeValues: Record<string, unknown>;
  attributeSetId: string;
}

interface AdminAttributeSet {
  id: string;
  code: string;
  name: Record<string, string>;
  isSystem: boolean;
}

interface AdminCategory {
  id: string;
  name: Record<string, string>;
  slug: string;
}

export function ProductEditor(): ReactNode {
  const t = useTranslation('catalog');
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = params.id === 'new';
  const id = isNew ? null : params.id ?? null;

  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [sku, setSku] = useState('');
  const [type, setType] = useState<'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual'>('simple');
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>('draft');
  const [visibility, setVisibility] = useState<AdminProduct['visibility']>('public');
  const [name, setName] = useState<Record<Locale, string>>({ 'en-US': '', 'pl-PL': '' });
  const [description, setDescription] = useState<Record<Locale, string>>({
    'en-US': '',
    'pl-PL': '',
  });
  const [defaultPrice, setDefaultPrice] = useState<string>('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string>('details');
  // Feature 002 (T034) — Attribute Set selector
  const [attributeSets, setAttributeSets] = useState<AdminAttributeSet[]>([]);
  const [attributeSetId, setAttributeSetId] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [cats, sets] = await Promise.all([
        apiClient.get<{ data: AdminCategory[] }>('/api/v1/admin/catalog/categories'),
        apiClient.get<{ data: AdminAttributeSet[] }>(
          '/api/v1/admin/catalog/attribute-sets',
        ),
      ]);
      setCategories(cats.data);
      setAttributeSets(sets.data);
      // Pick the system Default as the initial selection for new Products.
      const defaultSet = sets.data.find((s) => s.code === 'default');
      if (isNew && defaultSet) setAttributeSetId(defaultSet.id);
      if (id) {
        const res = await apiClient.get<{ data: AdminProduct }>(
          `/api/v1/admin/catalog/products/${id}`,
        );
        const p = res.data;
        setSku(p.sku);
        setType(p.type);
        setStatus(p.status);
        setVisibility(p.visibility);
        setName({
          'en-US': p.name['en-US'] ?? '',
          'pl-PL': p.name['pl-PL'] ?? '',
        });
        setDescription({
          'en-US': p.description['en-US'] ?? '',
          'pl-PL': p.description['pl-PL'] ?? '',
        });
        const price = (p.attributeValues['defaultPrice'] as number | undefined) ?? null;
        setDefaultPrice(price != null ? String(price) : '');
        setAttributeSetId(p.attributeSetId);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSave = useCallback(
    async (e: FormEvent): Promise<void> => {
      e.preventDefault();
      setError(null);
      setInfo(null);
      const trimmedName: Record<string, string> = {};
      const trimmedDescription: Record<string, string> = {};
      for (const l of LOCALES) {
        if (name[l]) trimmedName[l] = name[l];
        if (description[l]) trimmedDescription[l] = description[l];
      }
      if (Object.keys(trimmedName).length === 0) {
        setError('At least one locale name is required.');
        return;
      }
      const attributeValues: Record<string, unknown> = {};
      if (defaultPrice.trim()) {
        const v = Number(defaultPrice);
        if (!Number.isFinite(v) || v < 0) {
          setError('Default price must be a number ≥ 0.');
          return;
        }
        attributeValues['defaultPrice'] = v;
      }
      try {
        if (isNew) {
          const res = await apiClient.post<{ data: AdminProduct }>(
            '/api/v1/admin/catalog/products',
            {
              sku,
              type,
              name: trimmedName,
              description: trimmedDescription,
              categoryIds,
              attributeValues,
              visibility,
              ...(attributeSetId ? { attributeSetId } : {}),
            },
          );
          navigate(`/catalog/products/${res.data.id}`);
        } else if (id) {
          await apiClient.patch<{ data: AdminProduct }>(
            `/api/v1/admin/catalog/products/${id}`,
            {
              name: trimmedName,
              description: trimmedDescription,
              categoryIds,
              attributeValues,
              visibility,
              ...(attributeSetId ? { attributeSetId } : {}),
            },
          );
          setInfo('Saved.');
          await refresh();
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [isNew, id, sku, type, name, description, categoryIds, defaultPrice, visibility, navigate, refresh],
  );

  const handleArchive = useCallback(async (): Promise<void> => {
    if (!id) return;
    if (!confirm('Archive this product? It will disappear from the storefront.')) return;
    try {
      await apiClient.delete<void>(`/api/v1/admin/catalog/products/${id}`);
      navigate('/catalog/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Archive failed.');
    }
  }, [id, navigate]);

  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({
        id: c.id,
        label: `${c.name['en-US'] ?? c.slug} (${c.slug})`,
      })),
    [categories],
  );

  if (loading)
    return (
      <div className="b2b-page b2b-page--wide">
        <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('productEditor.loading')}</div>
      </div>
    );

  const tabs: Array<{ id: string; label: string; icon: ReactNode; show: boolean }> = [
    { id: 'details', label: 'Details', icon: <FileTextIcon size={14} />, show: true },
    { id: 'pricing', label: 'Pricing', icon: <CircleDollarSign size={14} />, show: !isNew },
    {
      id: 'variants',
      label: 'Variants',
      icon: <Layers size={14} />,
      show: !isNew && type === 'configurable',
    },
    {
      id: 'composite',
      label: type === 'grouped' ? 'Grouped items' : 'Bundle slots',
      icon: <Layers size={14} />,
      show: !isNew && (type === 'grouped' || type === 'bundle'),
    },
    { id: 'media', label: 'Media', icon: <ImageIcon size={14} />, show: !isNew },
    { id: 'inventory', label: 'Inventory', icon: <WarehouseIcon size={14} />, show: !isNew },
    { id: 'attachments', label: 'Attachments', icon: <Paperclip size={14} />, show: !isNew },
    { id: 'links', label: 'Related', icon: <LinkIcon size={14} />, show: !isNew },
    { id: 'channels', label: 'Channels', icon: <StoreIcon size={14} />, show: !isNew },
    { id: 'seo', label: 'SEO', icon: <Globe size={14} />, show: !isNew },
  ];
  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <button
            type="button"
            className="b2b-page-head__back"
            onClick={(): void => { navigate('/catalog/products'); }}
          >
            <ChevronLeft size={14} /> Products
          </button>
          <div className="b2b-page-head__title">
            <span>{isNew ? 'New product' : pickName(name) || sku}</span>
            {!isNew ? <StatusPill status={status} /> : null}
          </div>
          {!isNew ? (
            <div className="b2b-page-head__sub">
              <span className="b2b-mono">{sku}</span> · <span style={{ textTransform: 'capitalize' }}>{type}</span>
            </div>
          ) : null}
        </div>
        <div className="b2b-page-head__actions">
          {!isNew ? (
            <>
              <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
                <Eye size={13} /> Preview
              </button>
              <button type="button" className="b2b-btn b2b-btn--default b2b-btn--sm">
                <Copy size={13} /> Duplicate
              </button>
              <button
                type="button"
                className="b2b-btn b2b-btn--danger b2b-btn--sm"
                onClick={(): void => void handleArchive()}
              >
                <ArchiveIcon size={13} /> Archive
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            onClick={(e): void => {
              void handleSave(e as unknown as FormEvent);
            }}
          >
            <Save size={14} /> Save
          </button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <div className="b2b-card">
        <div style={{ padding: '4px 4px 0' }}>
          <div className="b2b-tabs" role="tablist">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={cn('b2b-tab', activeTab === t.id && 'is-active')}
                onClick={(): void => setActiveTab(t.id)}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="b2b-card__body">
          {activeTab === 'details' ? (
            <form id="product-details-form" onSubmit={handleSave}>
              <div className="b2b-col" style={{ gap: 18 }}>
                <div>
                  <div className="b2b-label">{t('productEditor.section.identity')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                    <div>
                      <Label htmlFor="sku">{t('productEditor.field.sku')}</Label>
                      <Input
                        id="sku"
                        value={sku}
                        onChange={(e): void => setSku(e.target.value)}
                        disabled={!isNew}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="ptype">{t('productEditor.field.type')}</Label>
                      <Select
                        id="ptype"
                        value={type}
                        onChange={(e): void =>
                          setType(
                            e.target.value as
                              | 'simple'
                              | 'configurable'
                              | 'grouped'
                              | 'bundle'
                              | 'virtual',
                          )
                        }
                        disabled={!isNew}
                      >
                        {PRODUCT_TYPES.map((pt) => (
                          <option key={pt} value={pt}>
                            {pt}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="pvis">{t('productEditor.field.visibility')}</Label>
                      <Select
                        id="pvis"
                        value={visibility}
                        onChange={(e): void =>
                          setVisibility(e.target.value as AdminProduct['visibility'])
                        }
                      >
                        {VISIBILITIES.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="pattrset">{t('productEditor.field.attributeSet')}</Label>
                      <Select
                        id="pattrset"
                        value={attributeSetId}
                        onChange={(e): void => setAttributeSetId(e.target.value)}
                      >
                        {attributeSets.length === 0 ? (
                          <option value="">{t('productEditor.attributeSet.loading')}</option>
                        ) : (
                          attributeSets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code}
                              {s.isSystem ? t('productEditor.attributeSet.systemSuffix') : ''}
                            </option>
                          ))
                        )}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="pstatus">{t('productEditor.field.status')}</Label>
                      <Select id="pstatus" value={status} disabled>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </Select>
                      <p className="b2b-help">{t('productEditor.field.status.help')}</p>
                    </div>
                    <div>
                      <Label htmlFor="dp">{t('productEditor.field.defaultPrice')}</Label>
                      <Input
                        id="dp"
                        type="number"
                        step="0.01"
                        min="0"
                        value={defaultPrice}
                        onChange={(e): void => setDefaultPrice(e.target.value)}
                      />
                      <p className="b2b-help">{t('productEditor.field.defaultPrice.help')}</p>
                    </div>
                  </div>
                </div>

                <hr className="b2b-hr" />

                <div>
                  <div className="b2b-label">{t('productEditor.section.localizedContent')}</div>
                  <p className="b2b-help" style={{ marginTop: 0, marginBottom: 12 }}>
                    {t('productEditor.section.localizedContent.help')}
                  </p>
                  <div className="b2b-col" style={{ gap: 18 }}>
                    {LOCALES.map((l) => (
                      <div key={l} className="b2b-col" style={{ gap: 8 }}>
                        <div>
                          <Label htmlFor={`name-${l}`}>{t('productEditor.field.localizedName', { locale: l })}</Label>
                          <Input
                            id={`name-${l}`}
                            value={name[l]}
                            onChange={(e): void =>
                              setName((prev) => ({ ...prev, [l]: e.target.value }))
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor={`desc-${l}`}>{t('productEditor.field.localizedDescription', { locale: l })}</Label>
                          <textarea
                            id={`desc-${l}`}
                            rows={3}
                            className="b2b-field"
                            value={description[l]}
                            onChange={(e): void =>
                              setDescription((prev) => ({ ...prev, [l]: e.target.value }))
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <hr className="b2b-hr" />

                <div>
                  <div className="b2b-label">{t('productEditor.section.categories')}</div>
                  <Select
                    multiple
                    value={categoryIds}
                    onChange={(e): void => {
                      const next: string[] = [];
                      for (const opt of e.target.selectedOptions) next.push(opt.value);
                      setCategoryIds(next);
                    }}
                    className="min-h-32"
                  >
                    {categoryOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <p className="b2b-help">{t('productEditor.section.categories.help')}</p>
                </div>
              </div>
            </form>
          ) : null}

          {activeTab === 'pricing' && id ? <LinkedPriceListsPanel productId={id} /> : null}

          {activeTab === 'variants' && id ? <VariantsSection productId={id} /> : null}

          {activeTab === 'composite' && id ? (
            type === 'grouped' ? (
              <GroupedItemsSection productId={id} />
            ) : (
              <BundleSlotsSection productId={id} />
            )
          ) : null}

          {activeTab === 'media' && id ? <GallerySection productId={id} /> : null}

          {activeTab === 'inventory' && id ? <ProductInventoryTab productId={id} /> : null}

          {activeTab === 'attachments' && id ? <AttachmentsSection productId={id} /> : null}

          {activeTab === 'links' && id ? <ProductLinksSection productId={id} /> : null}

          {activeTab === 'channels' && id ? (
            <EntityChannelMembership entityType="product" entityId={id} />
          ) : null}

          {activeTab === 'seo' ? <SeoStub name={name} /> : null}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: AdminProduct['status'] }): ReactNode {
  const map = {
    active: { cls: 'b2b-badge--success', label: 'Active' },
    draft: { cls: 'b2b-badge--warn', label: 'Draft' },
    archived: { cls: '', label: 'Archived' },
  } as const;
  const v = map[status];
  return <span className={cn('b2b-badge', 'b2b-badge--dot', v.cls)}>{v.label}</span>;
}

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? Object.values(name)[0] ?? '';
}

function SeoStub({ name }: { name: Record<string, string> }): ReactNode {
  const t = useTranslation('catalog');
  return (
    <div className="b2b-col" style={{ gap: 12 }}>
      <div className="b2b-label">{t('productEditor.seo.title')}</div>
      <div className="b2b-help" style={{ marginTop: 0 }}>
        {t('productEditor.seo.description')}
      </div>
      <div>
        <Label htmlFor="seo-title">{t('productEditor.seo.pageTitlePreview')}</Label>
        <Input id="seo-title" defaultValue={pickName(name)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variants section (T054) — admin CRUD for ProductVariants under a
// configurable Product. Lives outside the Product editor's <form> so its
// own buttons don't submit the parent.
// ---------------------------------------------------------------------------

interface AdminVariant {
  id: string;
  parentProductId: string;
  sku: string;
  variantAttributeValues: Record<string, unknown>;
  priceOverride: number | null;
  stockLevel: number | null;
  createdAt: string;
  updatedAt: string;
}

function VariantsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [variants, setVariants] = useState<AdminVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // The PDP returns variants nested in productDetail; admin needs a
      // standalone read to keep the forms quick. Foundation didn't ship
      // a GET /admin/.../variants, but the public productDetail under
      // /api/v1/catalog/products/<idOrSlug> includes them — use that.
      const res = await apiClient.get<{ data: { variants: AdminVariant[] } }>(
        `/api/v1/catalog/products/${productId}`,
      );
      setVariants(res.data.variants ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      sku: string;
      attrs: string;
      priceOverride: string;
      stockLevel: string;
    }): Promise<void> => {
      // attrs is a comma-separated list of `key=value` pairs.
      const variantAttributeValues: Record<string, string> = {};
      for (const pair of input.attrs.split(',')) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const [k, v] = trimmed.split('=');
        if (k && v !== undefined) variantAttributeValues[k.trim()] = v.trim();
      }
      try {
        const payload: Record<string, unknown> = {
          sku: input.sku,
          variantAttributeValues,
        };
        if (input.priceOverride.trim()) {
          payload['priceOverride'] = Number(input.priceOverride);
        }
        if (input.stockLevel.trim()) {
          payload['stockLevel'] = Number(input.stockLevel);
        }
        await apiClient.post<{ data: AdminVariant }>(
          `/api/v1/admin/catalog/products/${productId}/variants`,
          payload,
        );
        setInfo(t('productEditor.variants.success.create', { sku: input.sku }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.create'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (variantId: string, sku: string): Promise<void> => {
      if (!confirm(t('productEditor.variants.deleteConfirm', { sku }))) return;
      try {
        await apiClient.delete<void>(
          `/api/v1/admin/catalog/products/${productId}/variants/${variantId}`,
        );
        setInfo(t('productEditor.variants.success.delete', { sku }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.variants.error.delete'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.variants.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.variants.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.variants.column.sku')}</TableHead>
                <TableHead>{t('productEditor.variants.column.attributes')}</TableHead>
                <TableHead>{t('productEditor.variants.column.priceOverride')}</TableHead>
                <TableHead>{t('productEditor.variants.column.stock')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.variants.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono">{v.sku}</TableCell>
                  <TableCell>
                    {Object.entries(v.variantAttributeValues)
                      .map(([k, val]) => `${k}=${String(val)}`)
                      .join(', ') || '—'}
                  </TableCell>
                  <TableCell>{v.priceOverride ?? '—'}</TableCell>
                  <TableCell>{v.stockLevel ?? '—'}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleDelete(v.id, v.sku)}
                    >
                      {t('productEditor.variants.action.delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateVariantInline onCreate={handleCreate} />
      </CardContent>
    </Card>
  );
}

function CreateVariantInline({
  onCreate,
}: {
  onCreate: (input: {
    sku: string;
    attrs: string;
    priceOverride: string;
    stockLevel: string;
  }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [sku, setSku] = useState('');
  const [attrs, setAttrs] = useState('');
  const [priceOverride, setPriceOverride] = useState('');
  const [stockLevel, setStockLevel] = useState('');

  return (
    <div
      className="grid gap-3 md:grid-cols-5 border-t pt-4"
      role="group"
      aria-label={t('productEditor.variants.createTitle')}
    >
      <div className="space-y-1">
        <Label htmlFor="vsku">{t('productEditor.variants.field.sku')}</Label>
        <Input id="vsku" value={sku} onChange={(e): void => setSku(e.target.value)} required />
      </div>
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="vattrs">{t('productEditor.variants.field.attributes')}</Label>
        <Input
          id="vattrs"
          value={attrs}
          onChange={(e): void => setAttrs(e.target.value)}
          placeholder={t('productEditor.variants.field.attributesPlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="vprice">{t('productEditor.variants.field.priceOverride')}</Label>
        <Input
          id="vprice"
          type="number"
          step="0.01"
          min="0"
          value={priceOverride}
          onChange={(e): void => setPriceOverride(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="vstock">{t('productEditor.variants.field.stock')}</Label>
        <Input
          id="vstock"
          type="number"
          min="0"
          value={stockLevel}
          onChange={(e): void => setStockLevel(e.target.value)}
        />
      </div>
      <div className="md:col-span-5">
        <Button
          type="button"
          onClick={() => {
            void onCreate({ sku, attrs, priceOverride, stockLevel }).then(() => {
              setSku('');
              setAttrs('');
              setPriceOverride('');
              setStockLevel('');
            });
          }}
        >
          {t('productEditor.variants.action.add')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gallery section (T085) — admin CRUD for the Product's gallery items.
// Foundation lacks an admin Asset upload endpoint, so for now the form
// accepts an existing assetId; future work adds drag-and-drop on top of
// an Assets module admin upload route.
// ---------------------------------------------------------------------------

const GALLERY_LABELS = ['base_image', 'small_image', 'thumbnail'] as const;
type GalleryLabel = (typeof GALLERY_LABELS)[number];

interface AdminGalleryItem {
  id: string;
  productId: string;
  assetId: string;
  position: number;
  labels: GalleryLabel[];
  asset?: { url: string; kind: string };
}

function GallerySection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [items, setItems] = useState<AdminGalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // Public PDP carries the resolved gallery (with asset urls) so
      // admins see the same shape customers do; the admin GET returns
      // bare ids without urls.
      const res = await apiClient.get<{
        data: {
          gallery?: Array<{
            id: string;
            position: number;
            labels: GalleryLabel[];
            asset: { id: string; kind: string; url: string };
          }>;
        };
      }>(`/api/v1/catalog/products/${productId}`);
      const gallery = res.data.gallery ?? [];
      setItems(
        gallery.map((g) => ({
          id: g.id,
          productId,
          assetId: g.asset.id,
          position: g.position,
          labels: g.labels,
          asset: { url: g.asset.url, kind: g.asset.kind },
        })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { assetId: string; labels: GalleryLabel[]; replace: boolean }): Promise<void> => {
      try {
        const url = `/api/v1/admin/catalog/products/${productId}/gallery${
          input.replace ? '?replace=true' : ''
        }`;
        await apiClient.post(url, {
          assetId: input.assetId,
          labels: input.labels,
        });
        setInfo(t('productEditor.gallery.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.add'));
      }
    },
    [productId, refresh, t],
  );

  const handleUpdateLabels = useCallback(
    async (itemId: string, labels: GalleryLabel[], replace: boolean): Promise<void> => {
      try {
        const url = `/api/v1/admin/catalog/products/${productId}/gallery/${itemId}${
          replace ? '?replace=true' : ''
        }`;
        await apiClient.patch(url, { labels });
        setInfo(t('productEditor.gallery.success.update'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.update'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (itemId: string): Promise<void> => {
      if (!confirm(t('productEditor.gallery.removeConfirm'))) return;
      try {
        await apiClient.delete(`/api/v1/admin/catalog/products/${productId}/gallery/${itemId}`);
        setInfo(t('productEditor.gallery.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.gallery.error.delete'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.gallery.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.gallery.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.gallery.column.preview')}</TableHead>
                <TableHead>{t('productEditor.gallery.column.labels')}</TableHead>
                <TableHead>{t('productEditor.gallery.column.position')}</TableHead>
                <TableHead>{t('productEditor.gallery.column.assetId')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.gallery.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <GalleryRow
                  key={item.id}
                  item={item}
                  onUpdate={handleUpdateLabels}
                  onDelete={handleDelete}
                />
              ))}
            </TableBody>
          </Table>
        )}

        <CreateGalleryItemInline onCreate={handleCreate} />
      </CardContent>
    </Card>
  );
}

function GalleryRow({
  item,
  onUpdate,
  onDelete,
}: {
  item: AdminGalleryItem;
  onUpdate: (id: string, labels: GalleryLabel[], replace: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [labels, setLabels] = useState<GalleryLabel[]>(item.labels);
  const [replace, setReplace] = useState(false);

  const toggleLabel = (label: GalleryLabel): void => {
    setLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  };

  return (
    <TableRow>
      <TableCell>
        {item.asset?.url ? (
          <img
            src={item.asset.url}
            alt=""
            className="h-12 w-12 rounded border object-cover"
          />
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          {GALLERY_LABELS.map((label) => (
            <label key={label} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={labels.includes(label)}
                onChange={() => toggleLabel(label)}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={replace}
            onChange={() => setReplace((v) => !v)}
          />
          {t('productEditor.gallery.replaceConflicts')}
        </label>
      </TableCell>
      <TableCell>{item.position}</TableCell>
      <TableCell className="font-mono text-xs">{item.assetId.slice(0, 8)}…</TableCell>
      <TableCell className="space-x-2 whitespace-nowrap">
        <Button
          type="button"
          size="sm"
          onClick={() => void onUpdate(item.id, labels, replace)}
        >
          {t('productEditor.gallery.action.save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => void onDelete(item.id)}
        >
          {t('productEditor.gallery.action.remove')}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CreateGalleryItemInline({
  onCreate,
}: {
  onCreate: (input: { assetId: string; labels: GalleryLabel[]; replace: boolean }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [assetId, setAssetId] = useState('');
  const [labels, setLabels] = useState<GalleryLabel[]>([]);
  const [replace, setReplace] = useState(false);

  const toggleLabel = (label: GalleryLabel): void => {
    setLabels((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  };

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedFilename, setPickedFilename] = useState<string | null>(null);
  const onPick = (a: AssetSummary | AssetDetail): void => {
    setAssetId(a.id);
    setPickedFilename(a.filename);
    setPickerOpen(false);
  };

  return (
    <div className="space-y-3 border-t pt-4" role="group" aria-label={t('productEditor.gallery.addTitle')}>
      {pickerOpen ? (
        <AssetPicker
          acceptMimePrefix="image/"
          allowUpload
          onSelect={onPick}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="gasset">{t('productEditor.gallery.field.asset')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="gasset"
            value={pickedFilename ?? assetId}
            readOnly
            placeholder={t('productEditor.gallery.field.noAsset')}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            {t('productEditor.gallery.action.pickOrUpload')}
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label>{t('productEditor.gallery.column.labels')}</Label>
        <div className="flex flex-wrap gap-2 text-xs">
          {GALLERY_LABELS.map((label) => (
            <label key={label} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={labels.includes(label)}
                onChange={() => toggleLabel(label)}
              />
              {label}
            </label>
          ))}
        </div>
        <label className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={replace}
            onChange={() => setReplace((v) => !v)}
          />
          {t('productEditor.gallery.replaceConflicts')}
        </label>
      </div>
      <div>
        <Button
          type="button"
          onClick={() => {
            if (!assetId) return;
            void onCreate({ assetId, labels, replace }).then(() => {
              setAssetId('');
              setPickedFilename(null);
              setLabels([]);
              setReplace(false);
            });
          }}
        >
          {t('productEditor.gallery.action.add')}
        </Button>
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attachments section (T086) — admin CRUD for Product Attachments. The
// Library picker (feature 013 / US1) replaces the manual UUID input; assets
// are picked from the Library or uploaded inline.
// ---------------------------------------------------------------------------

interface AdminAttachmentType {
  id: string;
  code: string;
  name: Record<string, string>;
  position: number;
}

interface AdminAttachment {
  id: string;
  productId: string;
  assetId: string;
  attachmentTypeId: string;
  name: string;
  description: string | null;
  position: number;
  asset?: { url: string; filename: string; mimeType: string };
  type?: { code: string; name: Record<string, string> };
}

function AttachmentsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [attachments, setAttachments] = useState<AdminAttachment[]>([]);
  const [types, setTypes] = useState<AdminAttachmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [detail, typesRes] = await Promise.all([
        apiClient.get<{
          data: {
            attachments?: Array<{
              id: string;
              position: number;
              name: string;
              description: string | null;
              type: { id: string; code: string; name: Record<string, string> };
              asset: {
                id: string;
                kind: string;
                url: string;
                filename: string;
                sizeBytes: number;
                mimeType: string;
              };
            }>;
          };
        }>(`/api/v1/catalog/products/${productId}`),
        apiClient.get<{ data: AdminAttachmentType[] }>(
          '/api/v1/admin/catalog/attachment-types',
        ),
      ]);
      const detailAttachments = detail.data.attachments ?? [];
      setAttachments(
        detailAttachments.map((a) => ({
          id: a.id,
          productId,
          assetId: a.asset.id,
          attachmentTypeId: a.type.id,
          name: a.name,
          description: a.description,
          position: a.position,
          asset: {
            url: a.asset.url,
            filename: a.asset.filename,
            mimeType: a.asset.mimeType,
          },
          type: { code: a.type.code, name: a.type.name },
        })),
      );
      setTypes(typesRes.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      assetId: string;
      attachmentTypeId: string;
      name: string;
      description: string;
    }): Promise<void> => {
      try {
        await apiClient.post(`/api/v1/admin/catalog/products/${productId}/attachments`, {
          assetId: input.assetId,
          attachmentTypeId: input.attachmentTypeId,
          name: input.name,
          ...(input.description ? { description: input.description } : {}),
        });
        setInfo(t('productEditor.attachments.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.add'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (attachmentId: string, name: string): Promise<void> => {
      if (!confirm(t('productEditor.attachments.deleteConfirm', { name }))) return;
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/attachments/${attachmentId}`,
        );
        setInfo(t('productEditor.attachments.success.delete', { name }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.attachments.error.delete'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.attachments.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.attachments.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.attachments.column.type')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.name')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.description')}</TableHead>
                <TableHead>{t('productEditor.attachments.column.file')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.attachments.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attachments.map((att) => (
                <TableRow key={att.id}>
                  <TableCell>{att.type?.name['en-US'] ?? att.type?.code ?? '—'}</TableCell>
                  <TableCell className="font-medium">{att.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {att.description ?? '—'}
                  </TableCell>
                  <TableCell>
                    {att.asset?.url ? (
                      <a
                        href={att.asset.url}
                        target="_blank"
                        rel="noopener"
                        className="text-xs underline"
                      >
                        {att.asset.filename}
                      </a>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(att.id, att.name)}
                    >
                      {t('productEditor.attachments.action.delete')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateAttachmentInline types={types} onCreate={handleCreate} />
      </CardContent>
    </Card>
  );
}

function CreateAttachmentInline({
  types,
  onCreate,
}: {
  types: AdminAttachmentType[];
  onCreate: (input: {
    assetId: string;
    attachmentTypeId: string;
    name: string;
    description: string;
  }) => Promise<void>;
}): ReactNode {
  const [assetId, setAssetId] = useState('');
  const [attachmentTypeId, setAttachmentTypeId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedFilename, setPickedFilename] = useState<string | null>(null);
  const t = useTranslation('catalog');

  return (
    <div className="space-y-3 border-t pt-4" role="group" aria-label={t('productEditor.attachments.addTitle')}>
      {pickerOpen ? (
        <AssetPicker
          allowUpload
          onSelect={(a): void => {
            setAssetId(a.id);
            setPickedFilename(a.filename);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
      <div className="grid gap-3 md:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor="aasset">{t('productEditor.attachments.field.asset')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="aasset"
            value={pickedFilename ?? assetId}
            readOnly
            placeholder={t('productEditor.attachments.field.noAsset')}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            {t('productEditor.attachments.action.pickOrUpload')}
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="atype">{t('productEditor.attachments.field.type')}</Label>
        <Select
          id="atype"
          value={attachmentTypeId}
          onChange={(e): void => setAttachmentTypeId(e.target.value)}
        >
          <option value="">—</option>
          {types.map((typ) => (
            <option key={typ.id} value={typ.id}>
              {typ.name['en-US'] ?? typ.code}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="aname">{t('productEditor.attachments.field.name')}</Label>
        <Input
          id="aname"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder={t('productEditor.attachments.field.namePlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="adesc">{t('productEditor.attachments.field.description')}</Label>
        <Input
          id="adesc"
          value={description}
          onChange={(e): void => setDescription(e.target.value)}
          placeholder={t('productEditor.attachments.field.descriptionPlaceholder')}
        />
      </div>
      <div className="md:col-span-4">
        <Button
          type="button"
          onClick={() => {
            if (!assetId || !attachmentTypeId || !name) return;
            void onCreate({ assetId, attachmentTypeId, name, description }).then(() => {
              setAssetId('');
              setPickedFilename(null);
              setAttachmentTypeId('');
              setName('');
              setDescription('');
            });
          }}
        >
          {t('productEditor.attachments.action.add')}
        </Button>
      </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Links section (T109, US4) — Related / Up-sell / Cross-sell.
// Three sub-lists, one product picker (paste id) + kind selector +
// "Add" button per kind. Backend bulkCreate is all-or-nothing and
// surfaces SELF_LINK_NOT_ALLOWED / LINK_ALREADY_EXISTS / TARGET_NOT_FOUND.
// ---------------------------------------------------------------------------

const LINK_KINDS = ['related', 'up_sell', 'cross_sell'] as const;
type LinkKind = (typeof LINK_KINDS)[number];

interface AdminProductLink {
  id: string;
  sourceProductId: string;
  targetProductId: string;
  kind: LinkKind;
  position: number;
}

interface AdminProductSummary {
  id: string;
  sku: string;
  slug: string;
  status: 'draft' | 'active' | 'archived';
  name: Record<string, string>;
}

function pickProductName(
  name: Record<string, string> | undefined | null,
  fallback: string,
): string {
  if (!name) return fallback;
  return name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

const TARGETS_BATCH_PAGE_SIZE = 200;

function ProductLinksSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [links, setLinks] = useState<AdminProductLink[]>([]);
  const [targetsById, setTargetsById] = useState<Map<string, AdminProductSummary>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminProductLink[] }>(
        `/api/v1/admin/catalog/products/${productId}/links`,
      );
      setLinks(res.data);

      // Fetch target product details across all three kinds in one shot.
      // Paginates with TARGETS_BATCH_PAGE_SIZE so a product with hundreds
      // of links streams across multiple requests without ballooning the
      // body. In practice a single page is enough.
      const uniqueTargetIds = Array.from(new Set(res.data.map((l) => l.targetProductId)));
      const nextById = new Map<string, AdminProductSummary>();
      if (uniqueTargetIds.length > 0) {
        let page = 0;
        // Bounded loop guards against an unexpected backend response that
        // never sets `hasMore: false`.
        for (;;) {
          const batch = await apiClient.post<{
            data: AdminProductSummary[];
            pagination: { hasMore: boolean };
          }>('/api/v1/admin/catalog/products/batch-by-id', {
            ids: uniqueTargetIds,
            page,
            pageSize: TARGETS_BATCH_PAGE_SIZE,
          });
          for (const p of batch.data) nextById.set(p.id, p);
          if (!batch.pagination.hasMore) break;
          page += 1;
          if (page > 50) break;
        }
      }
      setTargetsById(nextById);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.links.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { targetProductId: string; kind: LinkKind }): Promise<void> => {
      try {
        await apiClient.post(`/api/v1/admin/catalog/products/${productId}/links`, {
          links: [{ targetProductId: input.targetProductId, kind: input.kind }],
        });
        setInfo(t('productEditor.links.success.add', { kind: input.kind }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.links.error.add'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (linkId: string): Promise<void> => {
      if (!confirm(t('productEditor.links.removeConfirm'))) return;
      try {
        await apiClient.delete(`/api/v1/admin/catalog/products/${productId}/links/${linkId}`);
        setInfo(t('productEditor.links.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.links.error.delete'));
      }
    },
    [productId, refresh, t],
  );

  const byKind = useMemo(() => {
    const result: Record<LinkKind, AdminProductLink[]> = {
      related: [],
      up_sell: [],
      cross_sell: [],
    };
    for (const link of links) result[link.kind].push(link);
    for (const kind of LINK_KINDS) {
      result[kind].sort((a, b) => a.position - b.position);
    }
    return result;
  }, [links]);

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.links.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : (
          <div className="space-y-6">
            {LINK_KINDS.map((kind) => (
              <div key={kind} className="space-y-2">
                <h3 className="text-sm font-medium uppercase tracking-wide">
                  {t(`productEditor.links.kind.${kind}`)} ({byKind[kind].length})
                </h3>
                {byKind[kind].length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('productEditor.links.empty')}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('productEditor.links.column.target')}</TableHead>
                        <TableHead>{t('productEditor.links.column.sku')}</TableHead>
                        <TableHead>{t('productEditor.links.column.position')}</TableHead>
                        <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.links.column.actions')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byKind[kind].map((link) => {
                        const target = targetsById.get(link.targetProductId);
                        const isMissing = !target;
                        const isArchived = target?.status === 'archived';
                        return (
                          <TableRow key={link.id}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span
                                  className={
                                    isMissing || isArchived ? 'text-muted-foreground' : ''
                                  }
                                >
                                  {target
                                    ? pickProductName(target.name, target.slug)
                                    : `${link.targetProductId.slice(0, 8)}…`}
                                </span>
                                {isMissing ? (
                                  <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                    {t('productEditor.links.badge.missing')}
                                  </span>
                                ) : null}
                                {isArchived ? (
                                  <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                                    {t('productEditor.links.badge.archived')}
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {target?.sku ?? '—'}
                            </TableCell>
                            <TableCell>{link.position}</TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => void handleDelete(link.id)}
                              >
                                {t('productEditor.links.action.remove')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            ))}
          </div>
        )}

        <CreateProductLinkInline onCreate={handleCreate} sourceProductId={productId} />
      </CardContent>
    </Card>
  );
}

function CreateProductLinkInline({
  onCreate,
  sourceProductId,
}: {
  onCreate: (input: { targetProductId: string; kind: LinkKind }) => Promise<void>;
  sourceProductId: string;
}): ReactNode {
  const t = useTranslation('catalog');
  const [targetProductId, setTargetProductId] = useState<string | null>(null);
  const [kind, setKind] = useState<LinkKind>('related');

  return (
    <div
      className="grid gap-3 md:grid-cols-3 border-t pt-4"
      role="group"
      aria-label={t('productEditor.links.addTitle')}
    >
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="ltarget">{t('productEditor.links.column.target')}</Label>
        <ProductPicker
          id="ltarget"
          mode="select"
          value={targetProductId}
          onChange={setTargetProductId}
          excludeIds={[sourceProductId]}
          placeholder={t('productEditor.links.field.targetPlaceholder')}
          ariaLabel={t('productEditor.links.column.target')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="lkind">{t('productEditor.links.field.kind')}</Label>
        <Select id="lkind" value={kind} onChange={(e): void => setKind(e.target.value as LinkKind)}>
          {LINK_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`productEditor.links.kind.${k}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="md:col-span-3">
        <Button
          type="button"
          disabled={targetProductId === null}
          onClick={() => {
            if (targetProductId === null) return;
            void onCreate({ targetProductId, kind }).then(() => {
              setTargetProductId(null);
            });
          }}
        >
          {t('productEditor.links.action.add')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped items section (T136, US5) — admin CRUD for a grouped product's
// children. Service-side enforces parent.type='grouped' (PRODUCT_TYPE_MISMATCH)
// + child.type∉{grouped,bundle} (NESTED_COMPOSITE_NOT_ALLOWED), so the form
// surfaces those errors directly when an admin pastes a bad child id.
// ---------------------------------------------------------------------------

interface AdminGroupedItem {
  id: string;
  parentProductId: string;
  childProductId: string;
  quantity: number;
  position: number;
}

function GroupedItemsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [items, setItems] = useState<AdminGroupedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminGroupedItem[] }>(
        `/api/v1/admin/catalog/products/${productId}/grouped-items`,
      );
      setItems(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.grouped.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { childProductId: string; quantity: string }): Promise<void> => {
      const qty = Number(input.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(t('productEditor.grouped.error.invalidQuantity'));
        return;
      }
      try {
        await apiClient.post(
          `/api/v1/admin/catalog/products/${productId}/grouped-items`,
          { childProductId: input.childProductId, quantity: qty },
        );
        setInfo(t('productEditor.grouped.success.add'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.grouped.error.add'));
      }
    },
    [productId, refresh, t],
  );

  const handleDelete = useCallback(
    async (itemId: string): Promise<void> => {
      if (!confirm(t('productEditor.grouped.removeConfirm'))) return;
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/grouped-items/${itemId}`,
        );
        setInfo(t('productEditor.grouped.success.remove'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.grouped.error.delete'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.grouped.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.grouped.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.grouped.column.child')}</TableHead>
                <TableHead>{t('productEditor.grouped.column.quantity')}</TableHead>
                <TableHead>{t('productEditor.grouped.column.position')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.grouped.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.childProductId}</TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>{item.position}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleDelete(item.id)}
                    >
                      {t('productEditor.grouped.action.remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <CreateGroupedItemInline onCreate={handleCreate} />
      </CardContent>
    </Card>
  );
}

function CreateGroupedItemInline({
  onCreate,
}: {
  onCreate: (input: { childProductId: string; quantity: string }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [childProductId, setChildProductId] = useState('');
  const [quantity, setQuantity] = useState('1');

  return (
    <div
      className="grid gap-3 md:grid-cols-3 border-t pt-4"
      role="group"
      aria-label={t('productEditor.grouped.addTitle')}
    >
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="gchild">{t('productEditor.grouped.column.child')}</Label>
        <Input
          id="gchild"
          value={childProductId}
          onChange={(e): void => setChildProductId(e.target.value)}
          placeholder={t('productEditor.grouped.field.childPlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="gquantity">{t('productEditor.grouped.column.quantity')}</Label>
        <Input
          id="gquantity"
          type="number"
          min="1"
          value={quantity}
          onChange={(e): void => setQuantity(e.target.value)}
        />
      </div>
      <div className="md:col-span-3">
        <Button
          type="button"
          onClick={() => {
            if (!childProductId) return;
            void onCreate({ childProductId, quantity }).then(() => {
              setChildProductId('');
              setQuantity('1');
            });
          }}
        >
          {t('productEditor.grouped.action.add')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bundle slots section (T137, US5) — admin CRUD for bundle slots and
// their options. Service enforces parent.type='bundle', INVALID_QUANTITY_RANGE
// on min>max, OPTION_ALREADY_EXISTS on duplicate option in a slot,
// NESTED_COMPOSITE_NOT_ALLOWED on grouped/bundle option product.
// ---------------------------------------------------------------------------

interface AdminBundleSlot {
  id: string;
  parentProductId: string;
  name: Record<string, string>;
  minQuantity: number;
  maxQuantity: number;
  position: number;
  options: Array<{
    id: string;
    slotId: string;
    optionProductId: string;
    defaultQuantity: number;
    position: number;
  }>;
}

function BundleSlotsSection({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [slots, setSlots] = useState<AdminBundleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminBundleSlot[] }>(
        `/api/v1/admin/catalog/products/${productId}/bundle-slots`,
      );
      setSlots(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.load'));
    } finally {
      setLoading(false);
    }
  }, [productId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreateSlot = useCallback(
    async (input: { name: string; minQuantity: string; maxQuantity: string }): Promise<void> => {
      const min = Number(input.minQuantity);
      const max = Number(input.maxQuantity);
      if (!Number.isFinite(max) || max <= 0) {
        setError(t('productEditor.bundle.error.invalidMax'));
        return;
      }
      try {
        await apiClient.post(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots`,
          {
            name: { 'en-US': input.name },
            ...(Number.isFinite(min) ? { minQuantity: min } : {}),
            maxQuantity: max,
          },
        );
        setInfo(t('productEditor.bundle.success.addSlot', { name: input.name }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.addSlot'));
      }
    },
    [productId, refresh, t],
  );

  const handleDeleteSlot = useCallback(
    async (slotId: string): Promise<void> => {
      if (!confirm(t('productEditor.bundle.removeSlotConfirm'))) return;
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}`,
        );
        setInfo(t('productEditor.bundle.success.removeSlot'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.deleteSlot'));
      }
    },
    [productId, refresh, t],
  );

  const handleAddOption = useCallback(
    async (slotId: string, optionProductId: string): Promise<void> => {
      if (!optionProductId) return;
      try {
        await apiClient.post(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}/options`,
          { optionProductId },
        );
        setInfo(t('productEditor.bundle.success.addOption'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.addOption'));
      }
    },
    [productId, refresh, t],
  );

  const handleRemoveOption = useCallback(
    async (slotId: string, optionId: string): Promise<void> => {
      if (!confirm(t('productEditor.bundle.removeOptionConfirm'))) return;
      try {
        await apiClient.delete(
          `/api/v1/admin/catalog/products/${productId}/bundle-slots/${slotId}/options/${optionId}`,
        );
        setInfo(t('productEditor.bundle.success.removeOption'));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.bundle.error.deleteOption'));
      }
    },
    [productId, refresh, t],
  );

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t('productEditor.bundle.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.loading')}</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('productEditor.bundle.empty')}</p>
        ) : (
          <div className="space-y-4">
            {slots.map((slot) => (
              <BundleSlotCard
                key={slot.id}
                slot={slot}
                onAddOption={handleAddOption}
                onRemoveOption={handleRemoveOption}
                onDeleteSlot={handleDeleteSlot}
              />
            ))}
          </div>
        )}

        <CreateBundleSlotInline onCreate={handleCreateSlot} />
      </CardContent>
    </Card>
  );
}

function BundleSlotCard({
  slot,
  onAddOption,
  onRemoveOption,
  onDeleteSlot,
}: {
  slot: AdminBundleSlot;
  onAddOption: (slotId: string, optionProductId: string) => Promise<void>;
  onRemoveOption: (slotId: string, optionId: string) => Promise<void>;
  onDeleteSlot: (slotId: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [optionId, setOptionId] = useState('');

  return (
    <div className="rounded border p-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          {slot.name['en-US'] ?? Object.values(slot.name)[0] ?? '—'}{' '}
          <span className="text-xs text-muted-foreground">
            {t('productEditor.bundle.slotMeta', {
              min: slot.minQuantity,
              max: slot.maxQuantity,
              position: slot.position,
            })}
          </span>
        </h3>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => void onDeleteSlot(slot.id)}
        >
          {t('productEditor.bundle.action.deleteSlot')}
        </Button>
      </div>
      <div className="mt-2">
        {slot.options.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('productEditor.bundle.optionsEmpty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('productEditor.bundle.column.optionProductId')}</TableHead>
                <TableHead>{t('productEditor.bundle.column.defaultQuantity')}</TableHead>
                <TableHead>{t('productEditor.bundle.column.position')}</TableHead>
                <TableHead className="w-[1%] whitespace-nowrap">{t('productEditor.bundle.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slot.options.map((opt) => (
                <TableRow key={opt.id}>
                  <TableCell className="font-mono text-xs">{opt.optionProductId}</TableCell>
                  <TableCell>{opt.defaultQuantity}</TableCell>
                  <TableCell>{opt.position}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => void onRemoveOption(slot.id, opt.id)}
                    >
                      {t('productEditor.bundle.action.removeOption')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor={`opt-${slot.id}`}>{t('productEditor.bundle.column.optionProductId')}</Label>
          <Input
            id={`opt-${slot.id}`}
            value={optionId}
            onChange={(e): void => setOptionId(e.target.value)}
            placeholder={t('productEditor.bundle.field.optionPlaceholder')}
          />
        </div>
        <Button
          type="button"
          onClick={() => {
            void onAddOption(slot.id, optionId).then(() => {
              setOptionId('');
            });
          }}
        >
          {t('productEditor.bundle.action.addOption')}
        </Button>
      </div>
    </div>
  );
}

function CreateBundleSlotInline({
  onCreate,
}: {
  onCreate: (input: { name: string; minQuantity: string; maxQuantity: string }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const [name, setName] = useState('');
  const [minQuantity, setMinQuantity] = useState('0');
  const [maxQuantity, setMaxQuantity] = useState('1');

  return (
    <div
      className="grid gap-3 md:grid-cols-4 border-t pt-4"
      role="group"
      aria-label={t('productEditor.bundle.addTitle')}
    >
      <div className="space-y-1 md:col-span-2">
        <Label htmlFor="bsname">{t('productEditor.bundle.field.slotName')}</Label>
        <Input
          id="bsname"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder={t('productEditor.bundle.field.slotNamePlaceholder')}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bsmin">{t('productEditor.bundle.field.min')}</Label>
        <Input
          id="bsmin"
          type="number"
          min="0"
          value={minQuantity}
          onChange={(e): void => setMinQuantity(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bsmax">{t('productEditor.bundle.field.max')}</Label>
        <Input
          id="bsmax"
          type="number"
          min="1"
          value={maxQuantity}
          onChange={(e): void => setMaxQuantity(e.target.value)}
        />
      </div>
      <div className="md:col-span-4">
        <Button
          type="button"
          onClick={() => {
            if (!name) return;
            void onCreate({ name, minQuantity, maxQuantity }).then(() => {
              setName('');
              setMinQuantity('0');
              setMaxQuantity('1');
            });
          }}
        >
          {t('productEditor.bundle.action.add')}
        </Button>
      </div>
    </div>
  );
}
