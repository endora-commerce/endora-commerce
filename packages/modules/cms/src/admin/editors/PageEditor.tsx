import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@measured/puck';
import { firstSlugSegment, slugify as slugifyText, type CmsPageDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, PageHeader, SaveButtonGroup, Select, Textarea } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ContentLanguageTabs, ScopePicker, type ScopePickerValue } from '@endora-commerce/admin-kit/components';
import { CmsContentEditorLayout } from '../components/CmsContentEditorLayout.js';
import { PageBuilderEditor } from '../components/PageBuilderEditor.js';
import { emptyPageBuilderData } from '@endora-commerce/page-builder-admin';
import {
  listCmsTemplatesForApply,
  loadCmsTemplateCanvas,
  saveCanvasAsCmsTemplate,
} from '../components/cms-template-layout.js';
import { resolveScopedContentLanguage } from '../components/scope-utils.js';
import { cmsClient } from '../api/cms-client.js';

interface FormState {
  name: string;
  slug: string;
  active: boolean;
  description: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
}

const blankForm: FormState = {
  name: '',
  slug: '',
  active: true,
  description: '',
  metaTitle: '',
  metaDescription: '',
  metaKeywords: '',
};

/**
 * Build a URL slug from a free-text page name (so Polish `Łatwy poradnik` gives
 * `latwy-poradnik`), within the 180-character limit the CMS slug validation
 * regex enforces.
 *
 * `slugify` from `@endora-commerce/contracts`, **imported, never re-implemented** (issue
 * #245) — aliased because this wrapper keeps the local name the JSX reads. This
 * site's chain was already correct: it and `BlockEditor` were the only two of
 * eight that cut to length *before* stripping the trailing separator, so
 * nothing about its output moves.
 */
function slugify(input: string): string {
  return slugifyText(input, { maxLength: 180 });
}

function dataFor(page: CmsPageDetail | null, language: string | null): Data | null {
  if (!page || !language) return null;
  const data = page.content.languages[language];
  if (data && typeof data === 'object') return data as Data;
  return { root: { props: {} }, content: [] };
}

export function PageEditor(): ReactNode {
  const t = useTranslation('cms');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [page, setPage] = useState<CmsPageDetail | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [scope, setScope] = useState<ScopePickerValue>({ salesChannelIds: [], languages: [] });
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<Data | null>(null);
  const [languageContentOverrides, setLanguageContentOverrides] = useState<Record<string, Data>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // For a new page the slug is auto-derived from the name until the operator
  // edits the slug field themselves, after which it is left untouched.
  const [slugEdited, setSlugEdited] = useState(false);
  /**
   * The deployment's reserved first path segments (feature 105, FR-033).
   *
   * Read once when the editor loads, from the **same** value the backend's
   * save-time refusal enforces — one source, two readers. Two lists would be
   * two answers waiting to disagree, and a warning that disagrees with a
   * refusal is worse than no warning.
   */
  const [reservedSegments, setReservedSegments] = useState<readonly string[]>([]);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    setError(null);
    const loaded = await cmsClient.getPage(id);
    setPage(loaded);
    setForm({
      name: loaded.name,
      slug: loaded.slug,
      active: loaded.active,
      description: loaded.description ?? '',
      metaTitle: loaded.meta?.['en-US']?.title ?? '',
      metaDescription: loaded.meta?.['en-US']?.description ?? '',
      metaKeywords: loaded.meta?.['en-US']?.keywords ?? '',
    });
    setScope({ salesChannelIds: loaded.salesChannelIds, languages: loaded.languages });
    setActiveLanguage(loaded.languages[0] ?? null);
  }, [id, isNew]);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    cmsClient
      .getReservedSlugSegments()
      .then((segments) => {
        if (!cancelled) setReservedSegments(segments);
      })
      .catch(() => {
        // Deliberately silent, and this is the one place in this editor where
        // that is right: the warning is an *advance* notice of a refusal the
        // backend performs anyway (FR-031). A deployment that reserves nothing
        // is the ordinary case, so a failed read must not put an error banner
        // over an editor whose page is fine — and it cannot let a bad save
        // through, because the refusal does not read this value.
        if (!cancelled) setReservedSegments([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The address this slug produces (FR-030, §5.5) — for **every** slug, not
   * only a colliding one, because the common mistake is a slug that is
   * perfectly legal and simply not what the operator meant.
   *
   * The storefront-root path rather than an origin-qualified URL: a page
   * belongs to *n* sales channels and a storefront origin is a per-channel
   * value another module owns, so an absolute address here would be either *n*
   * addresses or one arbitrary pick.
   */
  const publicPath = form.slug.trim().length > 0 ? `/${form.slug.trim()}` : null;

  /** The reserved segment this slug would lose to, or `null` (§5.1, US4.2). */
  const reservedSegment = (() => {
    const segment = firstSlugSegment(form.slug);
    return segment.length > 0 && reservedSegments.includes(segment) ? segment : null;
  })();

  useEffect(() => {
    if (!isNew) return;
    setPage(null);
    setForm(blankForm);
    setScope({ salesChannelIds: [], languages: [] });
    setActiveLanguage(null);
    setDraftData(null);
    setLanguageContentOverrides({});
    setSlugEdited(false);
    setError(null);
  }, [isNew, id]);

  // React Router reuses this component instance across `/cms/pages/:id`
  // navigations, so local state survives an id change. Drop any unsaved draft
  // when the edited page changes, otherwise the previous page's edits would
  // mask the newly-loaded content.
  useEffect(() => {
    setDraftData(null);
    setLanguageContentOverrides({});
  }, [id]);

  useEffect(() => {
    if (!activeLanguage && scope.languages.length > 0) setActiveLanguage(scope.languages[0] ?? null);
    if (activeLanguage && !scope.languages.includes(activeLanguage)) {
      setActiveLanguage(scope.languages[0] ?? null);
    }
  }, [activeLanguage, scope.languages]);

  const currentData = useMemo(() => {
    // Prefer the in-progress draft for the active tab; otherwise a stashed
    // per-language override; otherwise the last saved content.
    if (draftData) return draftData;
    if (activeLanguage && languageContentOverrides[activeLanguage]) {
      return languageContentOverrides[activeLanguage] ?? null;
    }
    return dataFor(page, activeLanguage);
  }, [activeLanguage, draftData, languageContentOverrides, page]);

  const saveMeta = async (contentLanguage: string | null): Promise<CmsPageDetail> => {
    const meta =
      contentLanguage && (form.metaTitle || form.metaDescription || form.metaKeywords)
        ? {
            [contentLanguage]: {
              ...(form.metaTitle ? { title: form.metaTitle } : {}),
              ...(form.metaDescription ? { description: form.metaDescription } : {}),
              ...(form.metaKeywords ? { keywords: form.metaKeywords } : {}),
            },
          }
        : undefined;

    if (isNew) {
      return cmsClient.createPage({
        name: form.name,
        slug: form.slug,
        active: form.active,
        description: form.description || null,
        salesChannelIds: scope.salesChannelIds,
        languages: scope.languages,
        ...(meta ? { meta } : {}),
      });
    }

    if (!page) throw new Error(t('pageEditor.notLoaded'));
    return cmsClient.patchPage(page.id, {
      name: form.name,
      slug: form.slug,
      active: form.active,
      description: form.description || null,
      salesChannelIds: scope.salesChannelIds,
      languages: scope.languages,
      ...(meta ? { meta } : {}),
      version: page.version,
    });
  };

  const save = async (): Promise<boolean> => {
    if (scope.salesChannelIds.length === 0) {
      setError(t('pageEditor.errors.selectChannel'));
      return false;
    }
    if (scope.languages.length === 0) {
      setError(t('pageEditor.errors.selectLanguage'));
      return false;
    }

    const contentLanguage = resolveScopedContentLanguage(scope, activeLanguage);
    if (!contentLanguage) {
      setError(t('pageEditor.errors.selectLanguage'));
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      let saved = await saveMeta(contentLanguage);
      if (currentData) {
        saved = await cmsClient.putPageContent(saved.id, contentLanguage, {
          data: currentData,
          version: saved.version,
        });
      }
      for (const [lang, data] of Object.entries(languageContentOverrides)) {
        if (lang === contentLanguage) continue;
        saved = await cmsClient.putPageContent(saved.id, lang, {
          data,
          version: saved.version,
        });
      }
      setPage(saved);
      setDraftData(null);
      setLanguageContentOverrides({});
      if (isNew) navigate(`/cms/pages/${saved.id}`, { replace: true });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAndExit = async (): Promise<void> => {
    if (await save()) navigate('/cms/pages');
  };

  const lifecycle = async (action: 'publish' | 'archive' | 'unarchive'): Promise<void> => {
    if (!page) return;
    setSaving(true);
    setError(null);
    try {
      const updated =
        action === 'publish'
          ? await cmsClient.publishPage(page.id)
          : action === 'archive'
            ? await cmsClient.archivePage(page.id)
            : await cmsClient.unarchivePage(page.id);
      setPage(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CmsContentEditorLayout
      header={
        <>
          <PageHeader
            title={isNew ? t('pageEditor.title.new') : form.name || t('pageEditor.title.edit')}
            description={t('pageEditor.description')}
            actions={
              <div className="flex gap-2">
                <Button asChild variant="outline">
                  <Link to="/cms/pages">{t('common.back')}</Link>
                </Button>
                {!isNew && page?.status !== 'published' ? (
                  <Button type="button" variant="outline" onClick={() => void lifecycle('publish')}>
                    {t('common.publish')}
                  </Button>
                ) : null}
                {!isNew && page?.status === 'published' ? (
                  <Button type="button" variant="outline" onClick={() => void lifecycle('archive')}>
                    {t('common.archive')}
                  </Button>
                ) : null}
                {!isNew && page?.status === 'archived' ? (
                  <Button type="button" variant="outline" onClick={() => void lifecycle('unarchive')}>
                    {t('common.unarchive')}
                  </Button>
                ) : null}
                <SaveButtonGroup
                  onSave={() => void save()}
                  onSaveAndExit={() => void saveAndExit()}
                  saving={saving}
                  saveLabel={t('common.save')}
                  savingLabel={t('common.saving')}
                  saveAndExitLabel={t('common.saveAndExit')}
                />
              </div>
            }
          />
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      settings={
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('pageEditor.metadata')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>{t('fields.name')}</Label>
                <Input
                  value={form.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setForm((f) => ({
                      ...f,
                      name,
                      ...(isNew && !slugEdited ? { slug: slugify(name) } : {}),
                    }));
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('fields.slug')}</Label>
                <Input
                  value={form.slug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    setForm((f) => ({ ...f, slug: event.target.value.toLowerCase() }));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  <span className="mr-1">{t('pageEditor.publicAddress')}:</span>
                  {publicPath ? (
                    <code className="font-mono">{publicPath}</code>
                  ) : (
                    <span>{t('pageEditor.publicAddressEmpty')}</span>
                  )}
                </p>
                {/*
                  A warning and not an error: nothing has failed yet, the
                  operator is still typing, and this is what US4.2 asks for —
                  the notice that arrives *before* Save, which is what actually
                  prevents the mistake. The refusal that follows on Save is the
                  backstop, and it renders in the destructive banner above.
                */}
                {reservedSegment ? (
                  <Alert variant="warning">
                    <AlertDescription>
                      {t('pageEditor.reservedSegmentWarning', { segment: reservedSegment })}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label>{t('fields.status')}</Label>
                <Select value={page?.status ?? 'draft'} disabled>
                  <option value="draft">{t('status.draft')}</option>
                  <option value="published">{t('status.published')}</option>
                  <option value="archived">{t('status.archived')}</option>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm({ ...form, active: event.target.checked })}
                />
                {t('fields.active')}
              </label>
              <div className="space-y-1">
                <Label>{t('fields.description')}</Label>
                <Textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('fields.metaTitle')}</Label>
                <Input
                  value={form.metaTitle}
                  onChange={(event) => setForm({ ...form, metaTitle: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('fields.metaDescription')}</Label>
                <Textarea
                  value={form.metaDescription}
                  onChange={(event) => setForm({ ...form, metaDescription: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('fields.metaKeywords')}</Label>
                <Input
                  value={form.metaKeywords}
                  onChange={(event) => setForm({ ...form, metaKeywords: event.target.value })}
                />
              </div>
            </CardContent>
          </Card>
          <ScopePicker value={scope} onChange={setScope} />
        </>
      }
      languageTabs={
        <ContentLanguageTabs
          languages={scope.languages}
          activeLanguage={activeLanguage}
          onChange={(language) => {
            // Keep unsaved canvas per language — clearing draft without stashing
            // would drop edits when switching tabs.
            if (activeLanguage && draftData) {
              setLanguageContentOverrides((prev) => ({
                ...prev,
                [activeLanguage]: draftData,
              }));
            }
            setDraftData(null);
            setActiveLanguage(language);
          }}
        />
      }
      builder={
        <PageBuilderEditor
          data={currentData}
          onChange={setDraftData}
          contentKey={`${id ?? 'new'}:${activeLanguage ?? ''}`}
          pageContainer
          languages={scope.languages}
          activeLanguage={activeLanguage}
          onResolveLanguageContent={(language) => {
            if (language === activeLanguage && draftData) {
              return structuredClone(draftData);
            }
            if (languageContentOverrides[language]) {
              return structuredClone(languageContentOverrides[language]!);
            }
            return structuredClone(dataFor(page, language) ?? emptyPageBuilderData());
          }}
          onSaveAsTemplate={async (meta, canvasData) => {
            await saveCanvasAsCmsTemplate({
              ...meta,
              data: canvasData,
              salesChannelIds: scope.salesChannelIds,
              languages: scope.languages,
              activeLanguage,
            });
          }}
          onListTemplatesForApply={listCmsTemplatesForApply}
          onResolveTemplateLayout={(templateId) =>
            loadCmsTemplateCanvas(templateId, activeLanguage)
          }
        />
      }
    />
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default PageEditor;
