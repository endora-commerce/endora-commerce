import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save } from 'lucide-react';
import { ApiError, apiClient, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  FormField,
  Input,
  PageHeader,
  Select,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { CategoryTreePicker, StickyFormActions } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 174 — creating a product. Scopes start with the first saved product: the create form
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

/** The create form's own required fields, said beside each (`FormField` `error`). */
interface FieldErrors {
  sku?: string;
  name?: string;
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const skuRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
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
    // Said beside the field it concerns and focused there (WCAG 3.3.1), not in a banner above.
    const missing: FieldErrors = {
      ...(sku.trim() === '' ? { sku: t('productEditor.error.skuRequired') } : {}),
      ...(name.trim() === '' ? { name: t('productEditor.error.nameRequired') } : {}),
    };
    setFieldErrors(missing);
    if (missing.sku !== undefined || missing.name !== undefined) {
      (missing.sku !== undefined ? skuRef : nameRef).current?.focus();
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
        <PageHeader
          back={{ label: t('productEditor.back'), to: '/catalog/products' }}
          title={t('productEditor.newTitle')}
          actions={
            <StickyFormActions>
              {/* Full width in the mobile bottom bar, where the thumb already is (Fitts's Law). */}
              <Button type="submit" className="max-lg:min-h-11 max-lg:w-full" disabled={saving} aria-busy={saving || undefined}>
                <Save aria-hidden="true" /> {t('productEditor.save.action')}
              </Button>
            </StickyFormActions>
          }
        />
        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('productEditor.create.help')}</p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(14rem,1fr))] gap-4">
              <FormField label={t('productEditor.field.sku')} hint={t('productEditor.field.sku.createHint')} error={fieldErrors.sku} required>
                <Input ref={skuRef} id="sku" value={sku} onChange={(e): void => setSku(e.target.value)} />
              </FormField>
              <FormField label={t('productEditor.field.type')}>
                <Select id="ptype" value={type} onChange={(e): void => setType(e.target.value as (typeof PRODUCT_TYPES)[number])}>
                  {PRODUCT_TYPES.map((pt) => (
                    <option key={pt} value={pt}>
                      {t(`productEditor.type.${pt}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('productEditor.field.visibility')}>
                <Select id="pvis" value={visibility} onChange={(e): void => setVisibility(e.target.value as (typeof VISIBILITIES)[number])}>
                  {VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {t(`productEditor.visibility.${v}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('productEditor.field.attributeSet')}>
                <Select id="pattrset" value={attributeSetId} onChange={(e): void => setAttributeSetId(e.target.value)}>
                  {sets.length === 0 ? <option value="">{t('productEditor.attributeSet.loading')}</option> : null}
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code}
                      {s.isSystem ? t('productEditor.attributeSet.systemSuffix') : ''}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label={t('productEditor.field.status')}>
                <Select id="pstatus" value={status} onChange={(e): void => setStatus(e.target.value as (typeof STATUSES)[number])}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`productEditor.statusValue.${s}`)}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField label={t('productEditor.field.name')} error={fieldErrors.name} required>
              <Input ref={nameRef} id="pname" value={name} onChange={(e): void => setName(e.target.value)} />
            </FormField>
            <FormField label={t('productEditor.field.description')}>
              <Textarea id="pdesc" rows={3} value={description} onChange={(e): void => setDescription(e.target.value)} />
            </FormField>
            {/* A tree of checkboxes, no single labellable control: a named group (FormField `group`). */}
            <FormField label={t('productEditor.section.categories')} group>
              <CategoryTreePicker categories={categories} selectedIds={categoryIds} onChange={setCategoryIds} loading={loading} />
            </FormField>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
