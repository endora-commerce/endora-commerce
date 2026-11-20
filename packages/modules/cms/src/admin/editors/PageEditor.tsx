import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import {
  CMS_PAGE_PATH_MAX_LEVELS,
  cmsLocalizedPage,
  cmsPagePublicPaths,
  firstSlugSegment,
  slugify as slugifyText,
  type CmsBreadcrumbsScheme,
  type CmsPagePathNode,
  type CmsPageDetail,
  type CmsPageSummary,
  type CmsPageTranslations,
} from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input, Label, PageHeader, SaveButtonGroup, Select, Textarea } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  AssetFieldPicker,
  CmsPagePicker,
  ContentLanguageTabs,
  ScopePicker,
  UnsavedChangesHint,
  type ScopePickerValue,
} from '@endora-commerce/admin-kit/components';
import { isDraftEqual } from '@endora-commerce/admin-kit/lib';
import { PageBuilderEditor } from '../components/PageBuilderEditor.js';
import {
  emptyPageBuilderData,
  hasUnsavedCanvas,
  PageBuilderEditorLayout,
  usePageBuilderEditorSettingsPanel,
} from '@endora-commerce/page-builder-admin';
import {
  listCmsTemplatesForApply,
  loadCmsTemplateCanvas,
  saveCanvasAsCmsTemplate,
} from '../components/cms-template-layout.js';
import { isSameScope, resolveScopedContentLanguage } from '../components/scope-utils.js';
import { cmsClient } from '../api/cms-client.js';

/** One language's own name, slug and description (R24) — an empty field inherits the page's. */
interface LanguageFields {
  name: string;
  slug: string;
  description: string;
}

/** One language's meta fields. */
interface MetaFields {
  title: string;
  description: string;
  keywords: string;
}

const blankLanguageFields: LanguageFields = { name: '', slug: '', description: '' };
const blankMetaFields: MetaFields = { title: '', description: '', keywords: '' };

interface FormState {
  name: string;
  slug: string;
  active: boolean;
  description: string;
  /** R24: by language code. */
  translations: Record<string, LanguageFields>;
  /**
   * By language code. One set until R24, read from `en-US` whatever the page's
   * languages and saved for the active language alone — which replaced every
   * other language's meta on the server.
   */
  meta: Record<string, MetaFields>;
  parentPageId: string | null;
  /** R19D — serve the page under its parent's path. */
  parentPathInUrl: boolean;
  breadcrumbsVisible: boolean;
  breadcrumbsScheme: CmsBreadcrumbsScheme;
  /** R21H (T355): the trail over the first section. */
  breadcrumbsOverlay: boolean;
  /** Feature 163 (FR-033) — `null` means the deployment default applies. */
  shareImageAssetId: string | null;
}

const blankForm: FormState = {
  name: '',
  slug: '',
  active: true,
  description: '',
  translations: {},
  meta: {},
  parentPageId: null,
  parentPathInUrl: false,
  breadcrumbsVisible: true,
  breadcrumbsScheme: 'light',
  breadcrumbsOverlay: false,
  shareImageAssetId: null,
};

/**
 * A page above this one whose slug is part of its address (R19D), with what
 * its slug is in each language (R24).
 */
interface PathAncestor extends CmsPagePathNode {
  name: string;
  languages: string[];
  translations: CmsPageTranslations;
}

/** The fields of `translations` the request carries: the languages the page has, the fields set. */
function translationsToSave(
  translations: Record<string, LanguageFields>,
  languages: readonly string[],
): CmsPageTranslations {
  const out: CmsPageTranslations = {};
  for (const language of languages) {
    const fields = translations[language];
    if (!fields) continue;
    const entry: CmsPageTranslations[string] = {};
    if (fields.name.trim()) entry.name = fields.name.trim();
    if (fields.slug.trim()) entry.slug = fields.slug.trim();
    if (fields.description.trim()) entry.description = fields.description;
    if (Object.keys(entry).length > 0) out[language] = entry;
  }
  return out;
}

/** The meta the request carries: every language the page has, each with the fields set. */
function metaToSave(
  meta: Record<string, MetaFields>,
  languages: readonly string[],
): Record<string, { title?: string; description?: string; keywords?: string }> {
  const out: Record<string, { title?: string; description?: string; keywords?: string }> = {};
  for (const language of languages) {
    const fields = meta[language];
    if (!fields || !(fields.title || fields.description || fields.keywords)) continue;
    out[language] = {
      ...(fields.title ? { title: fields.title } : {}),
      ...(fields.description ? { description: fields.description } : {}),
      ...(fields.keywords ? { keywords: fields.keywords } : {}),
    };
  }
  return out;
}

/** The id the page being edited takes in the path rule before it has one. */
const UNSAVED_PAGE_ID = 'unsaved-page';

/** Spelled out rather than built, so every label key is a literal a key check can find. */
const BREADCRUMB_SCHEME_LABEL_KEYS: ReadonlyArray<[CmsBreadcrumbsScheme, string]> = [
  ['light', 'pageEditor.breadcrumbs.scheme.light'],
  ['muted', 'pageEditor.breadcrumbs.scheme.muted'],
  ['dark', 'pageEditor.breadcrumbs.scheme.dark'],
];

/**
 * The page and every page below it, from the rows the editor has seen — what
 * a parent picker must not offer (feature 163, FR-032). Best effort by
 * design: the list is bounded, and the `cms_page.update` Command refuses a
 * cycle whatever the client offered.
 */
function pageAndDescendantIds(
  pageId: string,
  rows: ReadonlyArray<Pick<CmsPageSummary, 'id' | 'parentPageId'>>,
): string[] {
  const children = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentPageId) continue;
    const list = children.get(row.parentPageId) ?? [];
    list.push(row.id);
    children.set(row.parentPageId, list);
  }
  const out = new Set<string>([pageId]);
  const queue = [pageId];
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const child of children.get(next) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return [...out];
}

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

/** The form as the page was last saved (issue #1461: also what `dirty` compares against). */
function formFor(loaded: CmsPageDetail | null): FormState {
  if (!loaded) return blankForm;
  return {
    name: loaded.name,
    slug: loaded.slug,
    active: loaded.active,
    description: loaded.description ?? '',
    translations: Object.fromEntries(
      Object.entries(loaded.translations ?? {}).map(([language, own]) => [
        language,
        { name: own.name ?? '', slug: own.slug ?? '', description: own.description ?? '' },
      ]),
    ),
    meta: Object.fromEntries(
      Object.entries(loaded.meta ?? {}).map(([language, own]) => [
        language,
        { title: own.title ?? '', description: own.description ?? '', keywords: own.keywords ?? '' },
      ]),
    ),
    parentPageId: loaded.parentPageId ?? null,
    parentPathInUrl: loaded.parentPathInUrl ?? false,
    breadcrumbsVisible: loaded.breadcrumbsVisible ?? true,
    breadcrumbsScheme: loaded.breadcrumbsScheme ?? 'light',
    breadcrumbsOverlay: loaded.breadcrumbsOverlay ?? false,
    shareImageAssetId: loaded.shareImageAssetId ?? null,
  };
}

/**
 * Issue #1461 (CONTENT-02) — the form as a save would send it: a language's
 * fields cleared again are the same as never touched.
 */
function comparableForm(form: FormState, languages: readonly string[]): unknown {
  return {
    ...form,
    translations: translationsToSave(form.translations, languages),
    meta: metaToSave(form.meta, languages),
  };
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
  const settingsPanel = usePageBuilderEditorSettingsPanel(isNew);
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
   * R24: the languages whose slug the operator has set, here or before — the
   * others follow the language's name as it is typed, as the page's own slug
   * does for a new page.
   */
  const [languageSlugsEdited, setLanguageSlugsEdited] = useState<ReadonlySet<string>>(new Set());
  /**
   * The deployment's reserved first path segments (feature 105, FR-033).
   *
   * Read once when the editor loads, from the **same** value the backend's
   * save-time refusal enforces — one source, two readers. Two lists would be
   * two answers waiting to disagree, and a warning that disagrees with a
   * refusal is worse than no warning.
   */
  const [reservedSegments, setReservedSegments] = useState<readonly string[]>([]);
  /** The stored parent's name, so the picker shows it before any search. */
  const [parentLabel, setParentLabel] = useState('');
  /** The rows the parent picker must not offer: this page and its descendants. */
  const [excludedParentIds, setExcludedParentIds] = useState<readonly string[]>([]);
  /**
   * R19D: the ancestors whose slugs the address is built from — the parent,
   * and further up while each one includes its own parent's path. Read only
   * while the option is on; a failed read leaves the flat address shown, and
   * the backend serves the path whatever the preview said.
   */
  const [pathAncestors, setPathAncestors] = useState<readonly PathAncestor[]>([]);

  useEffect(() => {
    if (!form.parentPathInUrl || !form.parentPageId) {
      setPathAncestors([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const chain: PathAncestor[] = [];
      let nextId: string | null = form.parentPageId;
      while (nextId && chain.length < CMS_PAGE_PATH_MAX_LEVELS && !chain.some((node) => node.id === nextId)) {
        const ancestor = await cmsClient.getPage(nextId);
        const node: PathAncestor = {
          id: ancestor.id,
          name: ancestor.name,
          slug: ancestor.slug,
          parentPageId: ancestor.parentPageId ?? null,
          parentPathInUrl: ancestor.parentPathInUrl ?? false,
          languages: ancestor.languages,
          translations: ancestor.translations ?? {},
        };
        chain.push(node);
        nextId = node.parentPathInUrl ? node.parentPageId : null;
      }
      if (!cancelled) setPathAncestors(chain);
    })().catch(() => {
      if (!cancelled) setPathAncestors([]);
    });
    return () => {
      cancelled = true;
    };
  }, [form.parentPageId, form.parentPathInUrl]);

  const load = useCallback(async () => {
    if (isNew || !id) return;
    setError(null);
    const loaded = await cmsClient.getPage(id);
    setPage(loaded);
    setForm(formFor(loaded));
    setLanguageSlugsEdited(
      new Set(Object.entries(loaded.translations ?? {}).filter(([, own]) => Boolean(own.slug)).map(([language]) => language)),
    );
    setScope({ salesChannelIds: loaded.salesChannelIds, languages: loaded.languages });
    setActiveLanguage(loaded.languages[0] ?? null);
    setExcludedParentIds([loaded.id]);
    // Both reads only refine the picker; a failure leaves it usable, and the
    // server still refuses a cyclic parent on Save.
    if (loaded.parentPageId) {
      void cmsClient
        .getPage(loaded.parentPageId)
        .then((parent) => setParentLabel(parent.name))
        .catch(() => setParentLabel(''));
    } else {
      setParentLabel('');
    }
    void cmsClient
      .listPages()
      .then((list) => setExcludedParentIds(pageAndDescendantIds(loaded.id, list.data)))
      .catch(() => undefined);
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
  const addressIn = useCallback(
    (language: string | null): string | null => {
      const own = language ? form.translations[language]?.slug.trim() : '';
      const slug = own || form.slug.trim();
      if (slug.length === 0) return null;
      // R19D: the address under the parent's path, by the rule the backend
      // serves it with (`cmsPagePublicPaths`). Read off each page's own slug —
      // a channel may serve a page under another, which the editor cannot show
      // for *n* channels at once, as above. R24: in a language, each ancestor
      // contributes its slug in that language.
      const self: CmsPagePathNode = {
        id: page?.id ?? UNSAVED_PAGE_ID,
        slug,
        parentPageId: form.parentPageId,
        parentPathInUrl: form.parentPathInUrl,
      };
      const ancestors = pathAncestors.map((ancestor) => ({
        ...ancestor,
        slug: language ? cmsLocalizedPage(ancestor, language).slug : ancestor.slug,
      }));
      return `/${cmsPagePublicPaths([...ancestors, self]).get(self.id) ?? slug}`;
    },
    [form.slug, form.translations, form.parentPageId, form.parentPathInUrl, page?.id, pathAncestors],
  );
  const publicPath = useMemo(() => addressIn(null), [addressIn]);

  /** The reserved segment this slug would lose to, or `null` (§5.1, US4.2). */
  const reservedSegmentOf = (slug: string): string | null => {
    const segment = firstSlugSegment(slug);
    return segment.length > 0 && reservedSegments.includes(segment) ? segment : null;
  };
  const reservedSegment = reservedSegmentOf(form.slug);

  useEffect(() => {
    if (!isNew) return;
    setPage(null);
    setForm(blankForm);
    setScope({ salesChannelIds: [], languages: [] });
    setActiveLanguage(null);
    setDraftData(null);
    setLanguageContentOverrides({});
    setSlugEdited(false);
    setLanguageSlugsEdited(new Set());
    setParentLabel('');
    setExcludedParentIds([]);
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

  const saveMeta = async (): Promise<CmsPageDetail> => {
    // R24: every language's fields, not the active one's alone — the server
    // replaces both maps whole.
    const meta = metaToSave(form.meta, scope.languages);
    const translations = translationsToSave(form.translations, scope.languages);

    if (isNew) {
      return cmsClient.createPage({
        name: form.name,
        slug: form.slug,
        active: form.active,
        description: form.description || null,
        salesChannelIds: scope.salesChannelIds,
        languages: scope.languages,
        meta,
        translations,
        parentPageId: form.parentPageId,
        parentPathInUrl: form.parentPathInUrl,
        breadcrumbsVisible: form.breadcrumbsVisible,
        breadcrumbsScheme: form.breadcrumbsScheme,
        breadcrumbsOverlay: form.breadcrumbsOverlay,
        shareImageAssetId: form.shareImageAssetId,
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
      meta,
      translations,
      parentPageId: form.parentPageId,
      parentPathInUrl: form.parentPathInUrl,
      breadcrumbsVisible: form.breadcrumbsVisible,
      breadcrumbsScheme: form.breadcrumbsScheme,
      breadcrumbsOverlay: form.breadcrumbsOverlay,
      shareImageAssetId: form.shareImageAssetId,
      version: page.version,
    });
  };

  // Issue #1461 (CONTENT-02) — the draft against the last saved version.
  const savedScope: ScopePickerValue = page
    ? { salesChannelIds: page.salesChannelIds, languages: page.languages }
    : { salesChannelIds: [], languages: [] };
  const dirty =
    !isDraftEqual(comparableForm(form, scope.languages), comparableForm(formFor(page), scope.languages)) ||
    !isSameScope(scope, savedScope) ||
    hasUnsavedCanvas({
      draft: draftData,
      activeLanguage,
      overrides: languageContentOverrides,
      saved: (language) => (page ? dataFor(page, language) : null),
    });

  const discard = (): void => {
    setForm(formFor(page));
    setScope(savedScope);
    setDraftData(null);
    setLanguageContentOverrides({});
  };

  const save = async (): Promise<boolean> => {
    if (scope.salesChannelIds.length === 0) {
      setError(t('pageEditor.errors.selectChannel'));
      settingsPanel.reveal();
      return false;
    }
    if (scope.languages.length === 0) {
      setError(t('pageEditor.errors.selectLanguage'));
      settingsPanel.reveal();
      return false;
    }

    const contentLanguage = resolveScopedContentLanguage(scope, activeLanguage);
    if (!contentLanguage) {
      setError(t('pageEditor.errors.selectLanguage'));
      settingsPanel.reveal();
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      let saved = await saveMeta();
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
      // Name, slug, code and scope all live in the settings panel, and they
      // are what a refused save is nearly always about.
      settingsPanel.reveal();
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** The canvas tabs and the language card edit one language: either switches both. */
  const switchLanguage = (language: string): void => {
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
  };

  const setLanguageFields = (language: string, patch: Partial<LanguageFields>): void => {
    setForm((f) => ({
      ...f,
      translations: { ...f.translations, [language]: { ...(f.translations[language] ?? blankLanguageFields), ...patch } },
    }));
  };

  const setMetaFields = (language: string, patch: Partial<MetaFields>): void => {
    setForm((f) => ({
      ...f,
      meta: { ...f.meta, [language]: { ...(f.meta[language] ?? blankMetaFields), ...patch } },
    }));
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
    <PageBuilderEditorLayout
      settingsPanel={settingsPanel}
      dirty={dirty}
      onSave={save}
      onDiscard={discard}
      header={
        <>
          <PageHeader
            back={{ label: t('common.back'), to: '/cms/pages' }}
            title={isNew ? t('pageEditor.title.new') : form.name || t('pageEditor.title.edit')}
            description={t('pageEditor.description')}
            actions={
              <div className="flex items-center gap-2">
                <UnsavedChangesHint dirty={dirty} />
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
              <CardTitle>{t('pageEditor.metadata')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label={t('fields.name')}>
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
              </FormField>
              <div className="space-y-1">
                <FormField label={t('fields.slug')} describedBy="cms-page-slug-address">
                  <Input
                    value={form.slug}
                    onChange={(event) => {
                      setSlugEdited(true);
                      setForm((f) => ({ ...f, slug: event.target.value.toLowerCase() }));
                    }}
                  />
                </FormField>
                <p id="cms-page-slug-address" className="text-xs text-muted-foreground">
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
              <FormField label={t('fields.status')}>
                <Select value={page?.status ?? 'draft'} disabled>
                  <option value="draft">{t('status.draft')}</option>
                  <option value="published">{t('status.published')}</option>
                  <option value="archived">{t('status.archived')}</option>
                </Select>
              </FormField>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => setForm({ ...form, active: event.target.checked })}
                />
                {t('fields.active')}
              </label>
              <FormField label={t('fields.description')}>
                <Textarea
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
              </FormField>
              <p className="text-xs text-muted-foreground">{t('pageEditor.pageFieldsHelp')}</p>
            </CardContent>
          </Card>
          {/*
            R24: one language's own name, slug and description, and its meta.
            The language is the canvas's — the tabs here and above the canvas
            switch both — so the fields and the content shown are one language.
          */}
          {activeLanguage ? (
            <LanguageVersionCard
              language={activeLanguage}
              languages={scope.languages}
              onLanguageChange={switchLanguage}
              fields={form.translations[activeLanguage] ?? blankLanguageFields}
              meta={form.meta[activeLanguage] ?? blankMetaFields}
              inherited={{ name: form.name, slug: form.slug, description: form.description }}
              address={addressIn(activeLanguage)}
              reservedSegment={reservedSegmentOf(form.translations[activeLanguage]?.slug ?? '')}
              onFieldsChange={(patch) => {
                const language = activeLanguage;
                if (patch.slug !== undefined) {
                  setLanguageSlugsEdited((edited) => new Set(edited).add(language));
                  setLanguageFields(language, { slug: patch.slug.toLowerCase() });
                  return;
                }
                if (patch.name !== undefined && !languageSlugsEdited.has(language)) {
                  setLanguageFields(language, { name: patch.name, slug: patch.name.trim() ? slugify(patch.name) : '' });
                  return;
                }
                setLanguageFields(language, patch);
              }}
              onMetaChange={(patch) => setMetaFields(activeLanguage, patch)}
            />
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{t('pageEditor.breadcrumbs.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="cms-page-parent">{t('pageEditor.breadcrumbs.parent')}</Label>
                <CmsPagePicker
                  id="cms-page-parent"
                  value={form.parentPageId}
                  onChange={(parentPageId) => {
                    setForm((f) => ({ ...f, parentPageId }));
                    if (!parentPageId) setParentLabel('');
                  }}
                  excludeIds={excludedParentIds}
                  selectedLabel={parentLabel}
                  placeholder={t('pageEditor.breadcrumbs.parentPlaceholder')}
                  ariaLabel={t('pageEditor.breadcrumbs.parent')}
                />
                <p className="text-xs text-muted-foreground">{t('pageEditor.breadcrumbs.parentHelp')}</p>
              </div>
              {/* R19D: off by default, so a stored page keeps its flat address. */}
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.parentPathInUrl}
                    onChange={(event) => setForm({ ...form, parentPathInUrl: event.target.checked })}
                  />
                  {t('pageEditor.parentPathInUrl')}
                </label>
                <p className="text-xs text-muted-foreground">{t('pageEditor.parentPathInUrlHelp')}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.breadcrumbsVisible}
                  onChange={(event) => setForm({ ...form, breadcrumbsVisible: event.target.checked })}
                />
                {t('pageEditor.breadcrumbs.visible')}
              </label>
              <div className="space-y-1">
                <Label htmlFor="cms-page-breadcrumbs-scheme">{t('pageEditor.breadcrumbs.scheme')}</Label>
                <Select
                  id="cms-page-breadcrumbs-scheme"
                  value={form.breadcrumbsScheme}
                  onChange={(event) =>
                    setForm({ ...form, breadcrumbsScheme: event.target.value as CmsBreadcrumbsScheme })
                  }
                >
                  {BREADCRUMB_SCHEME_LABEL_KEYS.map(([scheme, labelKey]) => (
                    <option key={scheme} value={scheme}>
                      {t(labelKey)}
                    </option>
                  ))}
                </Select>
              </div>
              {/* R21H (T355): the trail over the first section instead of a band above it; off by default. */}
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.breadcrumbsOverlay}
                    onChange={(event) => setForm({ ...form, breadcrumbsOverlay: event.target.checked })}
                  />
                  {t('pageEditor.breadcrumbs.overlay')}
                </label>
                <p className="text-xs text-muted-foreground">{t('pageEditor.breadcrumbs.overlayHelp')}</p>
              </div>
            </CardContent>
          </Card>
          {/* Feature 163 (FR-033): the page's own sharing image; empty falls back to the default. */}
          <Card>
            <CardHeader>
              <CardTitle>{t('pageEditor.share.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <Label htmlFor="cms-page-share-image">{t('pageEditor.share.image')}</Label>
              <AssetFieldPicker
                id="cms-page-share-image"
                value={form.shareImageAssetId ?? ''}
                onChange={(assetId) => setForm((f) => ({ ...f, shareImageAssetId: assetId || null }))}
                acceptMimePrefix="image/"
                allowUpload
                placeholder={t('pageEditor.share.placeholder')}
                ariaLabel={t('pageEditor.share.image')}
                chooseLabel={t('pageEditor.share.choose')}
                changeLabel={t('pageEditor.share.change')}
                clearLabel={t('pageEditor.share.clear')}
              />
              <p className="text-xs text-muted-foreground">{t('pageEditor.share.help')}</p>
            </CardContent>
          </Card>
          <ScopePicker value={scope} onChange={setScope} chrome="card" />
        </>
      }
      canvasBar={
        <ContentLanguageTabs
          languages={scope.languages}
          activeLanguage={activeLanguage}
          onChange={switchLanguage}
        />
      }
      builder={
        <PageBuilderEditor
          data={currentData}
          onChange={setDraftData}
          contentKey={`${id ?? 'new'}:${activeLanguage ?? ''}`}
          // Feature 151 — the translation's audit subject, and the version whose
          // change (a save) retires its *Restore previous content*.
          resource={{ type: 'cms_page', id: page?.id ?? null }}
          savedVersion={page?.version ?? null}
          // Feature 163 — the preview wears the brand of the page's first channel.
          salesChannelId={scope.salesChannelIds[0] ?? null}
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

interface LanguageVersionCardProps {
  language: string;
  languages: string[];
  onLanguageChange: (language: string) => void;
  fields: LanguageFields;
  meta: MetaFields;
  /** The page's own values, which an empty field inherits — shown as its placeholder. */
  inherited: LanguageFields;
  /** The address in this language, or `null` while there is no slug. */
  address: string | null;
  reservedSegment: string | null;
  onFieldsChange: (patch: Partial<LanguageFields>) => void;
  onMetaChange: (patch: Partial<MetaFields>) => void;
}

/**
 * The per-language card (R24): name, slug and description in one language,
 * each inheriting the page's own value while empty, and the language's meta.
 */
function LanguageVersionCard({
  language,
  languages,
  onLanguageChange,
  fields,
  meta,
  inherited,
  address,
  reservedSegment,
  onFieldsChange,
  onMetaChange,
}: LanguageVersionCardProps): ReactNode {
  const t = useTranslation('cms');
  const id = (field: string) => `cms-page-${field}-${language}`;
  const label = (key: string) => t(key, { language });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pageEditor.languageVersion.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {languages.length > 1 ? (
          <ContentLanguageTabs languages={languages} activeLanguage={language} onChange={onLanguageChange} />
        ) : null}
        <p className="text-xs text-muted-foreground">{t('pageEditor.languageVersion.help')}</p>
        <div className="space-y-1">
          <Label htmlFor={id('name')}>{label('pageEditor.languageVersion.name')}</Label>
          <Input
            id={id('name')}
            value={fields.name}
            placeholder={inherited.name}
            onChange={(event) => onFieldsChange({ name: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('slug')}>{label('pageEditor.languageVersion.slug')}</Label>
          <Input
            id={id('slug')}
            value={fields.slug}
            placeholder={inherited.slug}
            onChange={(event) => onFieldsChange({ slug: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            <span className="mr-1">{t('pageEditor.publicAddress')}:</span>
            {address ? <code className="font-mono">{address}</code> : <span>{t('pageEditor.publicAddressEmpty')}</span>}
          </p>
          {reservedSegment ? (
            <Alert variant="warning">
              <AlertDescription>{t('pageEditor.reservedSegmentWarning', { segment: reservedSegment })}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('description')}>{label('pageEditor.languageVersion.description')}</Label>
          <Textarea
            id={id('description')}
            value={fields.description}
            placeholder={inherited.description}
            onChange={(event) => onFieldsChange({ description: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('meta-title')}>{label('pageEditor.languageVersion.metaTitle')}</Label>
          <Input id={id('meta-title')} value={meta.title} onChange={(event) => onMetaChange({ title: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('meta-description')}>{label('pageEditor.languageVersion.metaDescription')}</Label>
          <Textarea
            id={id('meta-description')}
            value={meta.description}
            onChange={(event) => onMetaChange({ description: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('meta-keywords')}>{label('pageEditor.languageVersion.metaKeywords')}</Label>
          <Input
            id={id('meta-keywords')}
            value={meta.keywords}
            onChange={(event) => onMetaChange({ keywords: event.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default PageEditor;
