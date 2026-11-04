import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Save } from 'lucide-react';
import { ApiError, apiClient, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { CategoryTreePicker, StickyFormActions } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 172 — creating a product. Scopes start with the first saved product: the create form
 * writes the Global values only (a string name and description, `contracts/readers.md` §2), and
 * the editor opens on the new product at Global.
 */

const PRODUCT_TYPES = ['simple', 'configurable', 'grouped', 'bundle', 'virtual'] as const;
const VISIBILITIES = ['public', 'logged_in_only', 'organization_restricted'] as const;
const STATUSES = ['active', 'inactive'] as const;

interface AttributeSet {
  id: string;
  code: string;
  isSystem: boolean;
}

interface Category {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
  sortOrder: number;
}

export function ProductCreateForm(): ReactNode {
  const t = useTranslation('catalog');
  const navigate = useNavigate();
  const [sku, setSku] = useState('');
  const [type, setType] = useState<(typeof PRODUCT_TYPES)[number]>('simple');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('inactive');
  const [visibility, setVisibility] = useState<(typeof VISIBILITIES)[number]>('public');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [attributeSetId, setAttributeSetId] = useState('');
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [sets, setSets] = useState<AttributeSet[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = sku !== '' || name !== '' || description !== '' || categoryIds.length > 0;
  useUnsavedChangesPrompt(dirty && !saving);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiClient.get<{ data: Category[] }>('/api/v1/admin/catalog/categories').catch(() => ({ data: [] as Category[] })),
      apiClient.get<{ data: AttributeSet[] }>('/api/v1/admin/catalog/attribute-sets').catch(() => ({ data: [] as AttributeSet[] })),
    ]).then(([cats, attributeSets]) => {
      if (cancelled) return;
      setCategories(cats.data ?? []);
      setSets(attributeSets.data ?? []);
      const fallback = (attributeSets.data ?? []).find((s) => s.code === 'default');
      if (fallback) setAttributeSetId(fallback.id);
      setLoading(false);
    });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (sku.trim() === '') {
      setError(t('productEditor.error.skuRequired'));
      return;
    }
    if (name.trim() === '') {
      setError(t('productEditor.error.nameRequired'));
      return;
    }
    setSaving(true);
    try {
      const res = await apiClient.post<{ data: { id: string } }>('/api/v1/admin/catalog/products', {
        sku,
        type,
        status,
        name: name.trim(),
        description: description === '' ? null : description,
        categoryIds,
        attributeValues: {},
        visibility,
        ...(attributeSetId ? { attributeSetId } : {}),
      });
      navigate(`/catalog/products/${res.data.id}?scope=global`);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.error.save'));
      setSaving(false);
    }
  };

  return (
    <div className="b2b-page b2b-page--wide">
      <form noValidate onSubmit={(e): void => void submit(e)}>
        <div className="b2b-page-head">
          <div className="b2b-grow">
            <button type="button" className="b2b-page-head__back" onClick={(): void => void navigate('/catalog/products')}>
              <ChevronLeft size={14} /> {t('productEditor.back')}
            </button>
            <div className="b2b-page-head__title">
              <span>{t('productEditor.newTitle')}</span>
            </div>
          </div>
          <StickyFormActions className="b2b-page-head__actions">
            <button type="submit" className="b2b-btn b2b-btn--primary" disabled={saving}>
              <Save size={14} aria-hidden="true" /> {t('productEditor.save.action')}
            </button>
          </StickyFormActions>
        </div>
        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="b2b-card">
          <div className="b2b-card__body b2b-col" style={{ gap: 18 }}>
            <p className="b2b-help">{t('productEditor.create.help')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: 12 }}>
              <div>
                <Label htmlFor="sku">{t('productEditor.field.sku')}</Label>
                <Input id="sku" value={sku} onChange={(e): void => setSku(e.target.value)} aria-required="true" />
              </div>
              <div>
                <Label htmlFor="ptype">{t('productEditor.field.type')}</Label>
                <Select id="ptype" value={type} onChange={(e): void => setType(e.target.value as (typeof PRODUCT_TYPES)[number])}>
                  {PRODUCT_TYPES.map((pt) => (
                    <option key={pt} value={pt}>
                      {t(`productEditor.type.${pt}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pvis">{t('productEditor.field.visibility')}</Label>
                <Select id="pvis" value={visibility} onChange={(e): void => setVisibility(e.target.value as (typeof VISIBILITIES)[number])}>
                  {VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {t(`productEditor.visibility.${v}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pattrset">{t('productEditor.field.attributeSet')}</Label>
                <Select id="pattrset" value={attributeSetId} onChange={(e): void => setAttributeSetId(e.target.value)}>
                  {sets.length === 0 ? <option value="">{t('productEditor.attributeSet.loading')}</option> : null}
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}
                      {s.isSystem ? t('productEditor.attributeSet.systemSuffix') : ''}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="pstatus">{t('productEditor.field.status')}</Label>
                <Select id="pstatus" value={status} onChange={(e): void => setStatus(e.target.value as (typeof STATUSES)[number])}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`productEditor.statusValue.${s}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="pname">{t('productEditor.field.name')}</Label>
              <Input id="pname" value={name} onChange={(e): void => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pdesc">{t('productEditor.field.description')}</Label>
              <textarea id="pdesc" rows={3} className="b2b-field" value={description} onChange={(e): void => setDescription(e.target.value)} />
            </div>
            <div>
              <div className="b2b-label">{t('productEditor.section.categories')}</div>
              <CategoryTreePicker categories={categories} selectedIds={categoryIds} onChange={setCategoryIds} loading={loading} />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
