import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type { BlogCategoryDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AssetFieldPicker } from '@/components/asset-picker/AssetFieldPicker';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentLanguageTabs } from '../../cms/components/ContentLanguageTabs';
import { PageBuilderEditor } from '../../cms/components/PageBuilderEditor';
import { ScopePicker, type CmsScopeValue } from '../../cms/components/ScopePicker';
import { blogClient } from '../api/blog-client';

interface FormState {
  name: string;
  slug: string;
  enabled: boolean;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  mainImageAssetId: string;
}

const blankForm: FormState = {
  name: '',
  slug: '',
  enabled: true,
  metaTitle: '',
  metaDescription: '',
  metaKeywords: '',
  mainImageAssetId: '',
};

function descriptionFor(
  category: BlogCategoryDetail | null,
  language: string | null,
): Data | null {
  if (!category || !language) return null;
  const tree = category.description?.languages?.[language];
  if (tree && typeof tree === 'object') return tree as Data;
  return { root: { props: {} }, content: [] };
}

function pickValue(map: Record<string, string> | null | undefined, lang: string): string {
  if (!map) return '';
  return map[lang] ?? '';
}

export function BlogCategoryEditor(): ReactNode {
  const t = useTranslation('blog');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [searchParams] = useSearchParams();
  const initialParentId = searchParams.get('parentId');
  const navigate = useNavigate();

  const [category, setCategory] = useState<BlogCategoryDetail | null>(null);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [form, setForm] = useState<FormState>(blankForm);
  const [scope, setScope] = useState<CmsScopeValue>({
    salesChannelIds: [],
    languages: ['en-US'],
  });
  const [activeLanguage, setActiveLanguage] = useState<string | null>('en-US');
  const [draftDescription, setDraftDescription] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadFormFromCategory = useCallback(
    (loaded: BlogCategoryDetail, language: string | null) => {
      const lang = language ?? loaded.languages[0] ?? 'en-US';
      setForm({
        name: pickValue(loaded.name, lang) || pickValue(loaded.name, 'en-US'),
        slug: loaded.slug,
        enabled: loaded.enabled,
        metaTitle: pickValue(loaded.metaTitle, lang),
        metaDescription: pickValue(loaded.metaDescription, lang),
        metaKeywords: pickValue(loaded.metaKeywords, lang),
        mainImageAssetId: loaded.mainImageAssetId ?? '',
      });
      setParentId(loaded.parentId);
    },
    [],
  );

  const load = useCallback(async () => {
    if (isNew || !id) return;
    setError(null);
    const loaded = await blogClient.getCategory(id);
    setCategory(loaded);
    setScope({
      salesChannelIds: loaded.salesChannelIds,
      languages: loaded.languages,
    });
    const lang = loaded.languages[0] ?? 'en-US';
    setActiveLanguage(lang);
    reloadFormFromCategory(loaded, lang);
    setDraftDescription(descriptionFor(loaded, lang));
  }, [id, isNew, reloadFormFromCategory]);

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [load]);

  useEffect(() => {
    if (category && activeLanguage) {
      reloadFormFromCategory(category, activeLanguage);
      setDraftDescription(descriptionFor(category, activeLanguage));
    }
  }, [category, activeLanguage, reloadFormFromCategory]);

  const canSave = useMemo(() => {
    return (
      form.name.trim().length > 0 &&
      /^(?!tag$)[a-z0-9](?:[a-z0-9-]{0,158}[a-z0-9])?$/.test(form.slug) &&
      scope.salesChannelIds.length > 0 &&
      scope.languages.length > 0
    );
  }, [form, scope]);

  const onCreate = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    const lang = activeLanguage ?? 'en-US';
    try {
      const created = await blogClient.createCategory({
        parentId: parentId ?? null,
        name: { [lang]: form.name },
        slug: form.slug,
        enabled: form.enabled,
        salesChannelIds: scope.salesChannelIds,
        languages: scope.languages,
        mainImageAssetId: form.mainImageAssetId || null,
        ...(form.metaTitle ? { metaTitle: { [lang]: form.metaTitle } } : {}),
        ...(form.metaDescription ? { metaDescription: { [lang]: form.metaDescription } } : {}),
        ...(form.metaKeywords ? { metaKeywords: { [lang]: form.metaKeywords } } : {}),
      });
      navigate(`/blog/categories/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [activeLanguage, canSave, form, navigate, parentId, scope]);

  const onSaveMetadata = useCallback(async () => {
    if (!category || !canSave) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    const lang = activeLanguage ?? 'en-US';
    try {
      const updated = await blogClient.patchCategory(category.id, {
        name: { ...category.name, [lang]: form.name },
        slug: form.slug,
        enabled: form.enabled,
        salesChannelIds: scope.salesChannelIds,
        languages: scope.languages,
        mainImageAssetId: form.mainImageAssetId || null,
        metaTitle: { ...(category.metaTitle ?? {}), [lang]: form.metaTitle },
        metaDescription: {
          ...(category.metaDescription ?? {}),
          [lang]: form.metaDescription,
        },
        metaKeywords: {
          ...(category.metaKeywords ?? {}),
          [lang]: form.metaKeywords,
        },
        version: category.version,
      });
      setCategory(updated);
      setInfo(t('messages.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [activeLanguage, canSave, category, form, scope]);

  const onSaveDescription = useCallback(async () => {
    if (!category || !activeLanguage || !draftDescription) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const nextLanguages = {
        ...(category.description?.languages ?? {}),
        [activeLanguage]: draftDescription,
      };
      const updated = await blogClient.putCategoryDescription(category.id, {
        description: {
          schema_version: category.description?.schema_version ?? 1,
          languages: nextLanguages,
        },
        version: category.version,
      });
      setCategory(updated);
      setInfo(t('messages.descriptionSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [activeLanguage, category, draftDescription]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={isNew ? t('categoryEditor.title.new') : t('categoryEditor.title.edit')}
        description={
          category?.isSystem
            ? t('categoryEditor.description.system')
            : t('categoryEditor.description.default')
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/blog/categories">{t('categoryEditor.backToTree')}</Link>
          </Button>
        }
      />

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

      <ScopePicker value={scope} onChange={setScope} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('sections.metadata')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ContentLanguageTabs
            languages={scope.languages}
            activeLanguage={activeLanguage}
            onChange={setActiveLanguage}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cat-name">{t('fields.namePerLanguage')}</Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                placeholder={t('categoryEditor.namePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="cat-slug">{t('fields.slug')}</Label>
              <Input
                id="cat-slug"
                value={form.slug}
                onChange={(event) =>
                  setForm((f) => ({ ...f, slug: event.target.value.toLowerCase() }))
                }
                className="font-mono"
                placeholder={t('categoryEditor.slugPlaceholder')}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cat-meta-title">{t('fields.metaTitlePerLanguage')}</Label>
              <Input
                id="cat-meta-title"
                value={form.metaTitle}
                onChange={(event) =>
                  setForm((f) => ({ ...f, metaTitle: event.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="cat-meta-description">{t('fields.metaDescriptionPerLanguage')}</Label>
              <Input
                id="cat-meta-description"
                value={form.metaDescription}
                onChange={(event) =>
                  setForm((f) => ({ ...f, metaDescription: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cat-meta-keywords">{t('fields.metaKeywordsPerLanguage')}</Label>
              <Input
                id="cat-meta-keywords"
                value={form.metaKeywords}
                onChange={(event) =>
                  setForm((f) => ({ ...f, metaKeywords: event.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="cat-image">{t('fields.mainImageAssetId')}</Label>
              <AssetFieldPicker
                id="cat-image"
                value={form.mainImageAssetId}
                onChange={(id) => setForm((f) => ({ ...f, mainImageAssetId: id }))}
                acceptMimePrefix="image/"
                allowUpload
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="cat-enabled"
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((f) => ({ ...f, enabled: event.target.checked }))}
            />
            <Label htmlFor="cat-enabled">{t('fields.enabledStorefrontVisible')}</Label>
          </div>

          <div className="flex justify-end gap-2">
            {isNew ? (
              <Button type="button" disabled={!canSave || saving} onClick={() => void onCreate()}>
                {saving ? t('common.saving') : t('common.create')}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={!canSave || saving}
                onClick={() => void onSaveMetadata()}
              >
                {saving ? t('common.saving') : t('common.saveMetadata')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!isNew && category && activeLanguage && draftDescription !== null ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              {t('categoryEditor.descriptionTitle', { language: activeLanguage })}
            </CardTitle>
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void onSaveDescription()}
            >
              {saving ? t('common.saving') : t('common.saveDescription')}
            </Button>
          </CardHeader>
          <CardContent>
            <PageBuilderEditor data={draftDescription} onChange={setDraftDescription} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
