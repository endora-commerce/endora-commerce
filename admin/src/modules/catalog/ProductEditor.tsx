import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const LOCALES = ['en-US', 'pl-PL'] as const;
type Locale = (typeof LOCALES)[number];

const PRODUCT_TYPES = ['simple', 'configurable'] as const;
const VISIBILITIES = ['public', 'logged_in_only', 'organization_restricted'] as const;
const STATUSES = ['draft', 'active', 'archived'] as const;

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: 'simple' | 'configurable';
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
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = params.id === 'new';
  const id = isNew ? null : params.id ?? null;

  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [sku, setSku] = useState('');
  const [type, setType] = useState<'simple' | 'configurable'>('simple');
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>('draft');
  const [visibility, setVisibility] = useState<AdminProduct['visibility']>('public');
  const [name, setName] = useState<Record<Locale, string>>({ 'en-US': '', 'pl-PL': '' });
  const [description, setDescription] = useState<Record<Locale, string>>({
    'en-US': '',
    'pl-PL': '',
  });
  const [defaultPrice, setDefaultPrice] = useState<string>('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <form onSubmit={handleSave}>
      <PageHeader
        title={isNew ? 'New product' : `Edit ${sku}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/catalog/products">
                <ArrowLeft />
                Back
              </Link>
            </Button>
            <Button type="submit">
              <Save />
              Save
            </Button>
            {!isNew ? (
              <Button
                variant="destructive"
                type="button"
                onClick={(): void => void handleArchive()}
              >
                <Trash2 />
                Archive
              </Button>
            ) : null}
          </>
        }
      />

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

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sku">SKU (immutable after creation)</Label>
            <Input
              id="sku"
              value={sku}
              onChange={(e): void => setSku(e.target.value)}
              disabled={!isNew}
              required
            />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="ptype">Type</Label>
              <Select
                id="ptype"
                value={type}
                onChange={(e): void => setType(e.target.value as 'simple' | 'configurable')}
                disabled={!isNew}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pstatus">Status</Label>
              <Select
                id="pstatus"
                value={status}
                onChange={(e): void => setStatus(e.target.value as AdminProduct['status'])}
                disabled
                title="Status transitions are managed elsewhere; archive is the only action here."
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pattrset">Attribute Set</Label>
              <Select
                id="pattrset"
                value={attributeSetId}
                onChange={(e): void => setAttributeSetId(e.target.value)}
                title="Defines which attributes can be set on this Product. Default ships with every install."
              >
                {attributeSets.length === 0 ? (
                  <option value="">— loading —</option>
                ) : (
                  attributeSets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}
                      {s.isSystem ? ' (system)' : ''}
                    </option>
                  ))
                )}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pvis">Visibility</Label>
              <Select
                id="pvis"
                value={visibility}
                onChange={(e): void => setVisibility(e.target.value as AdminProduct['visibility'])}
              >
                {VISIBILITIES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Names + descriptions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {LOCALES.map((l) => (
            <div key={l} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`name-${l}`}>Name [{l}]</Label>
                <Input
                  id={`name-${l}`}
                  value={name[l]}
                  onChange={(e): void => setName((prev) => ({ ...prev, [l]: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`desc-${l}`}>Description [{l}]</Label>
                <Textarea
                  id={`desc-${l}`}
                  rows={3}
                  value={description[l]}
                  onChange={(e): void =>
                    setDescription((prev) => ({ ...prev, [l]: e.target.value }))
                  }
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Categories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
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
          <p className="text-xs text-muted-foreground">Hold Ctrl / ⌘ to multi-select.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing (default)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="dp">Default unit price</Label>
            <Input
              id="dp"
              type="number"
              step="0.01"
              min="0"
              value={defaultPrice}
              onChange={(e): void => setDefaultPrice(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Stored as <code className="font-mono">attributeValues.defaultPrice</code>; price-list
              overrides take precedence at checkout.
            </p>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
