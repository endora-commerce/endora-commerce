import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import type { BlogCategoryDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, PageHeader, SaveButtonGroup } from '@endora-commerce/admin-kit/ui';
import { AssetFieldPicker, ContentLanguageTabs, ScopePicker, type ScopePickerValue } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { PageBuilderEditor } from '@endora-commerce/mod-cms/admin-ui';
import {
  PageBuilderEditorLayout,
  usePageBuilderEditorSettingsPanel,
} from '@endora-commerce/page-builder-admin';
import { blogClient } from '../api/blog-client.js';
import { UrlKeysPanel } from '../components/UrlKeysPanel.js';
import { blogEditorProblem, type BlogEditorProblem } from '../components/editor-validation.js';

interface FormState {
  name: string;
  slug: string;
  enabled: boolean;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
  mainImageAssetId: string;
}

/** The fields a category holds per language. */
type LanguageFields = Pick<FormState, 'name' | 'metaTitle' | 'metaDescription' | 'metaKeywords'>;

/** A language's fields as last saved (the name falls back to English for display). */
function savedFields(category: BlogCategoryDetail, language: string): LanguageFields {
  return {
    name: pickValue(category.name, language) || pickValue(category.name, 'en-US'),
    metaTitle: pickValue(category.metaTitle, language),
    metaDescription: pickValue(category.metaDescription, language),
    metaKeywords: pickValue(category.metaKeywords, language),
  };
}

function languageFieldsOf(form: FormState): LanguageFields {
  return { name: form.name, metaTitle: form.metaTitle, metaDescription: form.metaDescription, metaKeywords: form.metaKeywords };
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


/** The empty canvas — what a language with no saved content translates from. */
function emptyCanvas(): Data {
  return { root: { props: {} }, content: [] };
}

export function BlogCategoryEditor(): ReactNode {
  const t = useTranslation('blog');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const [searchParams] = useSearchParams();
  const initialParentId = searchParams.get('parentId');
  const navigate = useNavigate();
  const settingsPanel = usePageBuilderEditorSettingsPanel(isNew);

  const [category, setCategory] = useState<BlogCategoryDetail | null>(null);
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [form, setForm] = useState<FormState>(blankForm);
  const [scope, setScope] = useState<ScopePickerValue>({
    salesChannelIds: [],
    languages: ['en-US'],
  });
  const [activeLanguage, setActiveLanguage] = useState<string | null>('en-US');
  const [draftDescription, setDraftDescription] = useState<Data | null>(null);
  // Whether the canvas holds something the server does not: the description
  // request is sent only then, so saving a slug does not rewrite an untouched
  // description.
  const [descriptionDirty, setDescriptionDirty] = useState(false);
  /**
   * The unsaved edits of the languages not on screen — their fields when changed and
   * their description when touched — kept across a language switch and saved
   * together with the language on screen.
   */
  const [stash, setStash] = useState<Record<string, { fields?: LanguageFields; description?: Data }>>({});
  const [error, setError] = useState<string | null>(null);
  // Which field a refused save was about, so the field itself says so.
  const [problem, setProblem] = useState<BlogEditorProblem | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadFormFromCategory = useCallback(
    (loaded: BlogCategoryDetail, language: string | null) => {
      const lang = language ?? loaded.languages[0] ?? 'en-US';
      setForm({
        slug: loaded.slug,
        enabled: loaded.enabled,
        mainImageAssetId: loaded.mainImageAssetId ?? '',
        ...savedFields(loaded, lang),
      });
      setParentId(loaded.parentId);
      setStash({});
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
    setDescriptionDirty(false);
  }, [id, isNew, reloadFormFromCategory]);

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [load]);

  // The router reuses this instance across `/:id` → `/new`.
  useEffect(() => {
    if (!isNew) return;
    setCategory(null);
    setForm(blankForm);
    setScope({ salesChannelIds: [], languages: ['en-US'] });
    setActiveLanguage('en-US');
    setDraftDescription(null);
    setDescriptionDirty(false);
  }, [isNew]);

  /**
   * Another language's fields and description: its unsaved edits when it has any,
   * else what was last saved. The language being left keeps its own unsaved edits in
   * the stash; the fields every language shares are not touched. Done where the
   * language is chosen rather than in an effect over `category`, so a save that
   * answers with a new `category` never puts the stored description back under the
   * one being edited.
   */
  const switchLanguage = useCallback(
    (language: string) => {
      const leaving = activeLanguage;
      setActiveLanguage(language);
      if (!category) return;
      const next = { ...stash };
      if (leaving && leaving !== language) {
        const fields = languageFieldsOf(form);
        const changed = JSON.stringify(fields) !== JSON.stringify(savedFields(category, leaving));
        const kept = { ...next[leaving] };
        if (changed) kept.fields = fields;
        else delete kept.fields;
        if (descriptionDirty && draftDescription) kept.description = draftDescription;
        if (kept.fields || kept.description) next[leaving] = kept;
        else delete next[leaving];
      }
      const arriving = next[language];
      setStash(next);
      setForm((f) => ({ ...f, ...(arriving?.fields ?? savedFields(category, language)) }));
      setDraftDescription(arriving?.description ?? descriptionFor(category, language));
      setDescriptionDirty(Boolean(arriving?.description));
    },
    [activeLanguage, category, descriptionDirty, draftDescription, form, stash],
  );

  const refuse = useCallback(
    (message: string): false => {
      setError(message);
      // Name, slug and scope all live in the settings panel, and they are what
      // a refused save is nearly always about.
      settingsPanel.reveal();
      return false;
    },
    [settingsPanel],
  );

  const create = async (): Promise<void> => {
    setInfo(null);
    const found = blogEditorProblem({ ...form, ...scope });
    setProblem(found);
    if (found) {
      refuse(t(found));
      return;
    }
    setSaving(true);
    setError(null);
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
      refuse(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /**
   * One save for the fields and the description — still the two requests they
   * always were, the fields first and then the description when it was touched,
   * carrying the version the first one answered with.
   */
  const save = async (): Promise<boolean> => {
    if (!category) return false;
    setInfo(null);
    const found = blogEditorProblem({ ...form, ...scope });
    setProblem(found);
    if (found) return refuse(t(found));
    setSaving(true);
    setError(null);
    const lang = activeLanguage ?? 'en-US';
    // Every language with unsaved fields, the one on screen included.
    const fieldsByLanguage: Record<string, LanguageFields> = {
      ...Object.fromEntries(
        Object.entries(stash).flatMap(([language, kept]) => (kept.fields ? [[language, kept.fields]] : [])),
      ),
      [lang]: languageFieldsOf(form),
    };
    const perLanguage = (key: keyof LanguageFields): Record<string, string> =>
      Object.fromEntries(Object.entries(fieldsByLanguage).map(([language, fields]) => [language, fields[key]]));
    // Every touched description, the one on screen included.
    const descriptions: Record<string, Data> = {
      ...Object.fromEntries(
        Object.entries(stash).flatMap(([language, kept]) => (kept.description ? [[language, kept.description]] : [])),
      ),
      ...(descriptionDirty && draftDescription ? { [lang]: draftDescription } : {}),
    };
    try {
      let updated = await blogClient.patchCategory(category.id, {
        name: { ...category.name, ...perLanguage('name') },
        slug: form.slug,
        enabled: form.enabled,
        salesChannelIds: scope.salesChannelIds,
        languages: scope.languages,
        mainImageAssetId: form.mainImageAssetId || null,
        metaTitle: { ...(category.metaTitle ?? {}), ...perLanguage('metaTitle') },
        metaDescription: { ...(category.metaDescription ?? {}), ...perLanguage('metaDescription') },
        metaKeywords: { ...(category.metaKeywords ?? {}), ...perLanguage('metaKeywords') },
        version: category.version,
      });
      // The fields are stored from here on, whatever the description request does.
      setCategory(updated);
      if (Object.keys(descriptions).length > 0) {
        updated = await blogClient.putCategoryDescription(category.id, {
          description: {
            schema_version: updated.description?.schema_version ?? 1,
            languages: { ...(updated.description?.languages ?? {}), ...descriptions },
          },
          version: updated.version,
        });
        setCategory(updated);
        setDescriptionDirty(false);
      }
      setStash({});
      setInfo(t('messages.saved'));
      return true;
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveAndExit = async (): Promise<void> => {
    if (await save()) navigate('/blog/categories');
  };

  const ready =
    !isNew && category !== null && activeLanguage !== null && draftDescription !== null;

  return (
    <PageBuilderEditorLayout
      settingsPanel={settingsPanel}
      header={
        <>
          <PageHeader
            title={
              isNew ? t('categoryEditor.title.new') : form.name || t('categoryEditor.title.edit')
            }
            description={
              isNew
                ? t('categoryEditor.description.new')
                : category?.isSystem
                  ? t('categoryEditor.description.system')
                  : t('categoryEditor.description.default')
            }
            actions={
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link to="/blog/categories">{t('categoryEditor.backToTree')}</Link>
                </Button>
                {isNew ? (
                  <Button type="button" disabled={saving} onClick={() => void create()}>
                    {saving ? t('common.saving') : t('common.create')}
                  </Button>
                ) : (
                  <SaveButtonGroup
                    onSave={() => void save()}
                    onSaveAndExit={() => void saveAndExit()}
                    saving={saving}
                    disabled={!category}
                    saveLabel={t('common.save')}
                    savingLabel={t('common.saving')}
                    saveAndExitLabel={t('common.saveAndExit')}
                  />
                )}
              </div>
            }
          />
          {error ? (
            <Alert id="cat-error" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {/* A live region that is there before it has anything to say, so the
              result of a save is announced and not only shown (WCAG 4.1.3). */}
          <div role="status">
            {info ? (
              <Alert role="none">
                <AlertDescription>{info}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </>
      }
      canvasBar={
        <div className="flex flex-wrap items-center gap-2">
          {/* A Page Builder on a category screen is not self-explanatory: say
              that the canvas is the category's description. */}
          <span className="text-sm font-medium">
            {isNew ? t('fields.editingLanguage') : t('categoryEditor.descriptionLabel')}
          </span>
          <ContentLanguageTabs
            languages={scope.languages}
            activeLanguage={activeLanguage}
            onChange={switchLanguage}
          />
        </div>
      }
      builderLabel={
        activeLanguage
          ? t('categoryEditor.descriptionTitle', { language: activeLanguage })
          : undefined
      }
      builder={
        isNew ? null : ready ? (
          <PageBuilderEditor
            data={draftDescription}
            contentKey={`${category.id}:${activeLanguage}`}
            onChange={(next) => {
              setDraftDescription(next);
              setDescriptionDirty(true);
            }}
            // Feature 151 — the Translate action (see `BlogPostEditor`).
            languages={scope.languages}
            activeLanguage={activeLanguage}
            onResolveLanguageContent={(language) =>
              structuredClone(
                language === activeLanguage && draftDescription
                  ? draftDescription
                  : (stash[language]?.description ?? descriptionFor(category, language) ?? emptyCanvas()),
              )
            }
            resource={{ type: 'blog_category', id: category.id }}
            savedVersion={category.version}
          />
        ) : error ? (
          <></>
        ) : (
          <p className="text-sm text-muted-foreground" aria-busy="true">
            {t('common.loading')}
          </p>
        )
      }
      settings={
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('sections.metadata')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cat-name">{t('fields.namePerLanguage')}</Label>
                <Input
                  id="cat-name"
                  aria-invalid={problem === 'validation.nameRequired' ? true : undefined}
                  aria-describedby={problem === 'validation.nameRequired' ? 'cat-error' : undefined}
                  value={form.name}
                  onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                  placeholder={t('categoryEditor.namePlaceholder')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-slug">{t('fields.slug')}</Label>
                <Input
                  id="cat-slug"
                  aria-invalid={problem === 'validation.slugInvalid' ? true : undefined}
                  aria-describedby={problem === 'validation.slugInvalid' ? 'cat-error' : undefined}
                  value={form.slug}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, slug: event.target.value.toLowerCase() }))
                  }
                  className="font-mono"
                  placeholder={t('categoryEditor.slugPlaceholder')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-image">{t('fields.mainImageAssetId')}</Label>
                <AssetFieldPicker
                  id="cat-image"
                  value={form.mainImageAssetId}
                  onChange={(assetId) => setForm((f) => ({ ...f, mainImageAssetId: assetId }))}
                  acceptMimePrefix="image/"
                  allowUpload
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  id="cat-enabled"
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) => setForm((f) => ({ ...f, enabled: event.target.checked }))}
                />
                {t('fields.enabledStorefrontVisible')}
              </label>
            </CardContent>
          </Card>

          {category && activeLanguage ? (
            <UrlKeysPanel
              kind="category"
              entityId={category.id}
              language={activeLanguage}
              // The keys' save bumps the category's version; the form's edits stay.
              onSaved={() =>
                void blogClient
                  .getCategory(category.id)
                  .then((fresh) => setCategory((c) => (c ? { ...c, version: fresh.version } : fresh)))
              }
            />
          ) : null}

          <ScopePicker value={scope} onChange={setScope} />

          <Card data-settings-group="seo">
            <CardHeader>
              <CardTitle className="text-base">{t('sections.seo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cat-meta-title">{t('fields.metaTitlePerLanguage')}</Label>
                <Input
                  id="cat-meta-title"
                  value={form.metaTitle}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, metaTitle: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-meta-description">{t('fields.metaDescriptionPerLanguage')}</Label>
                <Input
                  id="cat-meta-description"
                  value={form.metaDescription}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, metaDescription: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-meta-keywords">{t('fields.metaKeywordsPerLanguage')}</Label>
                <Input
                  id="cat-meta-keywords"
                  value={form.metaKeywords}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, metaKeywords: event.target.value }))
                  }
                />
              </div>
            </CardContent>
          </Card>
        </>
      }
    />
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default BlogCategoryEditor;
