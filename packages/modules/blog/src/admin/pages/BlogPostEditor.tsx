import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import { slugify as slugifyText, type BlogPostDetail } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  EditorSection,
  InlineStatus,
  Input,
  Label,
  PageHeader,
  SaveButtonGroup,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AssetFieldPicker, ContentLanguageTabs, ScopePicker, UnsavedChangesHint, type ScopePickerValue } from '@endora-commerce/admin-kit/components';
import { isDraftEqual } from '@endora-commerce/admin-kit/lib';
import { PageBuilderEditor } from '@endora-commerce/mod-cms/admin-ui';
import {
  PageBuilderEditorLayout,
  usePageBuilderEditorSettingsPanel,
} from '@endora-commerce/page-builder-admin';
import { blogClient } from '../api/blog-client.js';
import { blogEditorProblem, type BlogEditorProblem } from '../components/editor-validation.js';
import { PostStatusBadge } from '../components/PostStatusBadge.js';
import { RelatedPostsPicker } from '../components/RelatedPostsPicker.js';
import { RelatedProductsPicker } from '../components/RelatedProductsPicker.js';
import { TagPicker } from '../components/TagPicker.js';
import { UrlKeysPanel } from '../components/UrlKeysPanel.js';
import { AuthorPicker } from '../components/AuthorPicker.js';

interface FormState {
  name: string;
  slug: string;
  active: boolean;
  description: string;
  /** Library asset id, `''` while unset (feature 163). */
  mainImageAssetId: string;
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string;
}

/** The fields a post holds per language. */
type LanguageFields = Pick<FormState, 'name' | 'metaTitle' | 'metaDescription' | 'metaKeywords'>;

/** A language's fields as last saved (the name falls back to English for display). */
function savedFields(post: BlogPostDetail, language: string): LanguageFields {
  return {
    name: pickValue(post.name, language) || pickValue(post.name, 'en-US'),
    metaTitle: pickValue(post.metaTitle, language),
    metaDescription: pickValue(post.metaDescription, language),
    metaKeywords: pickValue(post.metaKeywords, language),
  };
}

/** The whole form as `post` was last saved, in `language` (issue #1461: what `dirty` compares against). */
function savedForm(post: BlogPostDetail, language: string): FormState {
  return {
    slug: post.slug,
    active: post.active,
    description: post.description ?? '',
    mainImageAssetId: post.mainImageAssetId ?? '',
    ...savedFields(post, language),
  };
}

/**
 * What the post links to: its author, its tags and its related posts and products. Issue #1512
 * (UX audit CONTENT-09; owner decision DEC-08) — these used to write the moment they were picked,
 * beside fields that waited for Save; they are now part of the draft and go with the one Save.
 * Order matters for the three lists (it is the storefront's order), so they compare as sequences.
 */
interface Links {
  authorId: string | null;
  tagIds: string[];
  relatedPostIds: string[];
  relatedProductIds: string[];
}

function savedLinks(post: BlogPostDetail): Links {
  return {
    authorId: post.author?.id ?? null,
    tagIds: post.tags.map((tag) => tag.id),
    relatedPostIds: [...post.relatedPostIds],
    relatedProductIds: [...post.relatedProductIds],
  };
}

const blankLinks: Links = { authorId: null, tagIds: [], relatedPostIds: [], relatedProductIds: [] };

/** Same channels and languages, in any order. */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

function languageFieldsOf(form: FormState): LanguageFields {
  return { name: form.name, metaTitle: form.metaTitle, metaDescription: form.metaDescription, metaKeywords: form.metaKeywords };
}

const blankForm: FormState = {
  name: '',
  slug: '',
  active: true,
  description: '',
  mainImageAssetId: '',
  metaTitle: '',
  metaDescription: '',
  metaKeywords: '',
};

/**
 * Build a URL slug from a free-text title (so Polish "Łatwy poradnik" becomes
 * "latwy-poradnik"), within the 160-character limit the slug validation regex
 * enforces.
 *
 * `slugify` from `@endora-commerce/contracts`, **imported, never re-implemented** (issue
 * #245) — aliased because this wrapper keeps the local name the JSX reads.
 *
 * It was the **ninth** private copy of that generator and issue #245's sweep
 * missed it, which is how it came to be this rule's first finding: the chain it
 * carried folded correctly via `normalize`, so `check:diacritic-folds` had
 * nothing to report and there was no other signal to notice a hand-rolled slug
 * builder until issue #244 added one. Nothing about the output moves — this
 * site and `PageEditor` were among the few that already cut to length before
 * stripping the trailing separator.
 */
function slugify(input: string): string {
  return slugifyText(input, { maxLength: 160 });
}

function dataFor(post: BlogPostDetail | null, language: string | null): Data | null {
  if (!post || !language) return null;
  const tree = post.content.languages[language];
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

export function BlogPostEditor(): ReactNode {
  const t = useTranslation('blog');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const settingsPanel = usePageBuilderEditorSettingsPanel(isNew);
  const [post, setPost] = useState<BlogPostDetail | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [links, setLinks] = useState<Links>(blankLinks);
  // For a new post, slug + meta title are auto-derived from the title until the
  // editor types in either field, at which point that field stops auto-syncing.
  const [slugEdited, setSlugEdited] = useState(false);
  const [metaTitleEdited, setMetaTitleEdited] = useState(false);
  const [scope, setScope] = useState<ScopePickerValue>({
    salesChannelIds: [],
    languages: ['en-US'],
  });
  const [activeLanguage, setActiveLanguage] = useState<string | null>('en-US');
  const [draftData, setDraftData] = useState<Data | null>(null);
  // Whether the canvas holds something the server does not: the content request
  // is sent only then, so saving a slug does not rewrite an untouched canvas.
  const [contentDirty, setContentDirty] = useState(false);
  /**
   * The unsaved edits of the languages not on screen — their fields when changed and
   * their canvas when touched — kept across a language switch and saved together
   * with the language on screen. Without it a switch threw the edits away.
   */
  const [stash, setStash] = useState<Record<string, { fields?: LanguageFields; canvas?: Data }>>({});
  const [error, setError] = useState<string | null>(null);
  // Which field a refused save was about, so the field itself says so.
  const [problem, setProblem] = useState<BlogEditorProblem | null>(null);
  // The result of a save or a status change, said beside the buttons (InlineStatus, not a banner).
  const status = useInlineStatus();
  const [saving, setSaving] = useState(false);

  const reloadFormFromPost = useCallback(
    (loaded: BlogPostDetail, language: string | null) => {
      const lang = language ?? loaded.languages[0] ?? 'en-US';
      setForm(savedForm(loaded, lang));
      setLinks(savedLinks(loaded));
      setStash({});
    },
    [],
  );

  const load = useCallback(async () => {
    if (isNew || !id) return;
    setError(null);
    const loaded = await blogClient.getPost(id);
    setPost(loaded);
    setScope({
      salesChannelIds: loaded.salesChannelIds,
      languages: loaded.languages,
    });
    const lang = loaded.languages[0] ?? 'en-US';
    setActiveLanguage(lang);
    reloadFormFromPost(loaded, lang);
    setDraftData(dataFor(loaded, lang));
    setContentDirty(false);
  }, [id, isNew, reloadFormFromPost]);

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [load]);

  // The router reuses this instance across `/:id` → `/new`.
  useEffect(() => {
    if (!isNew) return;
    setPost(null);
    setForm(blankForm);
    setLinks(blankLinks);
    setScope({ salesChannelIds: [], languages: ['en-US'] });
    setActiveLanguage('en-US');
    setDraftData(null);
    setContentDirty(false);
    setSlugEdited(false);
    setMetaTitleEdited(false);
  }, [isNew]);

  /**
   * Another language's fields and canvas: its unsaved edits when it has any, else
   * what was last saved. The language being left keeps its own unsaved edits in the
   * stash, and the fields every language shares (slug, image, …) are not touched.
   *
   * Done where the language is chosen rather than in an effect over `post`: the
   * address panel saves on its own and the post is re-read after it, and an
   * effect keyed on `post` would put the stored canvas back under an operator
   * who is half-way through editing.
   */
  const switchLanguage = useCallback(
    (language: string) => {
      const leaving = activeLanguage;
      setActiveLanguage(language);
      if (!post) return;
      const next = { ...stash };
      if (leaving && leaving !== language) {
        const fields = languageFieldsOf(form);
        const changed = JSON.stringify(fields) !== JSON.stringify(savedFields(post, leaving));
        const kept = { ...next[leaving] };
        if (changed) kept.fields = fields;
        else delete kept.fields;
        if (contentDirty && draftData) kept.canvas = draftData;
        if (kept.fields || kept.canvas) next[leaving] = kept;
        else delete next[leaving];
      }
      const arriving = next[language];
      setStash(next);
      setForm((f) => ({ ...f, ...(arriving?.fields ?? savedFields(post, language)) }));
      setDraftData(arriving?.canvas ?? dataFor(post, language));
      setContentDirty(Boolean(arriving?.canvas));
    },
    [activeLanguage, contentDirty, draftData, form, post, stash],
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

  const create = async (): Promise<boolean> => {
    status.clear();
    const found = blogEditorProblem({ ...form, ...scope });
    setProblem(found);
    if (found) return refuse(t(found));
    setSaving(true);
    setError(null);
    try {
      const created = await blogClient.createPost({
        name: { [activeLanguage ?? 'en-US']: form.name },
        slug: form.slug,
        active: form.active,
        description: form.description || null,
        mainImageAssetId: form.mainImageAssetId || null,
        salesChannelIds: scope.salesChannelIds,
        languages: scope.languages,
        categoryIds: [], // service auto-fills the seeded Default
        tagIds: [],
        ...(form.metaTitle
          ? { metaTitle: { [activeLanguage ?? 'en-US']: form.metaTitle } }
          : {}),
        ...(form.metaDescription
          ? { metaDescription: { [activeLanguage ?? 'en-US']: form.metaDescription } }
          : {}),
        ...(form.metaKeywords
          ? { metaKeywords: { [activeLanguage ?? 'en-US']: form.metaKeywords } }
          : {}),
      });
      navigate(`/blog/posts/${created.id}`);
      return true;
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /**
   * One save for the fields, what the post links to, and the canvas.
   *
   * The fields go first, with the author and the tags when either changed; then
   * the related posts and the related products, each only when changed; then the
   * canvas when it was touched — every request carrying the version the previous
   * one answered with. What went is the other buttons: "Save metadata" lived at
   * the foot of the form, and a save action inside a panel that collapses is a
   * save action that can disappear; the author, tag and related-item pickers
   * wrote the moment they were picked (issue #1512, DEC-08). Only the address
   * panel still saves on its own, and its heading says so (`ImmediateBadge`).
   */
  const save = async (): Promise<boolean> => {
    if (!post) return false;
    status.clear();
    const found = blogEditorProblem({ ...form, ...scope });
    setProblem(found);
    if (found) return refuse(t(found));
    setSaving(true);
    setError(null);
    const lang = activeLanguage ?? 'en-US';
    const saved = savedLinks(post);
    // Every language with unsaved fields, the one on screen included.
    const fieldsByLanguage: Record<string, LanguageFields> = {
      ...Object.fromEntries(
        Object.entries(stash).flatMap(([language, kept]) => (kept.fields ? [[language, kept.fields]] : [])),
      ),
      [lang]: languageFieldsOf(form),
    };
    const perLanguage = (key: keyof LanguageFields): Record<string, string> =>
      Object.fromEntries(Object.entries(fieldsByLanguage).map(([language, fields]) => [language, fields[key]]));
    // Every touched canvas, the one on screen included.
    const canvases: Record<string, Data> = {
      ...Object.fromEntries(
        Object.entries(stash).flatMap(([language, kept]) => (kept.canvas ? [[language, kept.canvas]] : [])),
      ),
      ...(contentDirty && draftData ? { [lang]: draftData } : {}),
    };
    try {
      let updated = await blogClient.patchPost(post.id, {
        name: { ...post.name, ...perLanguage('name') },
        slug: form.slug,
        active: form.active,
        description: form.description || null,
        mainImageAssetId: form.mainImageAssetId || null,
        salesChannelIds: scope.salesChannelIds,
        languages: scope.languages,
        metaTitle: { ...(post.metaTitle ?? {}), ...perLanguage('metaTitle') },
        metaDescription: { ...(post.metaDescription ?? {}), ...perLanguage('metaDescription') },
        metaKeywords: { ...(post.metaKeywords ?? {}), ...perLanguage('metaKeywords') },
        // The author and the tags ride on the fields request, only when changed (DEC-08).
        ...(links.authorId !== saved.authorId ? { authorAdminUserId: links.authorId } : {}),
        ...(!isDraftEqual(links.tagIds, saved.tagIds) ? { tagIds: links.tagIds } : {}),
        version: post.version,
      });
      // The fields are stored from here on, whatever the later requests do.
      setPost(updated);
      // The related items have requests of their own; each carries the version the previous answered with.
      if (!isDraftEqual(links.relatedPostIds, saved.relatedPostIds)) {
        updated = await blogClient.setPostRelatedPosts(post.id, links.relatedPostIds, updated.version);
        setPost(updated);
      }
      if (!isDraftEqual(links.relatedProductIds, saved.relatedProductIds)) {
        updated = await blogClient.setPostRelatedProducts(post.id, links.relatedProductIds, updated.version);
        setPost(updated);
      }
      if (Object.keys(canvases).length > 0) {
        updated = await blogClient.putPostContent(post.id, {
          content: {
            schema_version: updated.content.schema_version ?? 1,
            languages: { ...updated.content.languages, ...canvases },
          },
          version: updated.version,
        });
        setPost(updated);
        setContentDirty(false);
      }
      setStash({});
      setLinks(savedLinks(updated));
      status.show(t('messages.saved'));
      return true;
    } catch (err) {
      return refuse(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const saveAndExit = async (): Promise<void> => {
    if (await save()) navigate('/blog/posts');
  };

  const onLifecycle = useCallback(
    async (kind: 'publish' | 'unpublish' | 'archive') => {
      if (!post) return;
      setSaving(true);
      setError(null);
      status.clear();
      try {
        const updated =
          kind === 'publish'
            ? await blogClient.publishPost(post.id, post.version)
            : kind === 'unpublish'
              ? await blogClient.unpublishPost(post.id, post.version)
              : await blogClient.archivePost(post.id, post.version);
        setPost(updated);
        status.show(t('messages.statusUpdated', { status: t(`status.${updated.status}`) }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [post, status, t],
  );

  const ready = !isNew && post !== null && activeLanguage !== null && draftData !== null;

  /**
   * Issue #1461 (CONTENT-02) — the draft against the last saved version: the
   * language on screen (fields and canvas), every stashed language, and the scope.
   * A new post is dirty once anything was typed into it.
   */
  const dirty = ((): boolean => {
    if (!post) {
      return isNew && (!isDraftEqual(form, blankForm) || scope.salesChannelIds.length > 0);
    }
    const lang = activeLanguage ?? post.languages[0] ?? 'en-US';
    if (!isDraftEqual(form, savedForm(post, lang))) return true;
    if (!isDraftEqual(links, savedLinks(post))) return true;
    if (!sameMembers(scope.salesChannelIds, post.salesChannelIds) || !sameMembers(scope.languages, post.languages)) return true;
    if (contentDirty && draftData && !isDraftEqual(draftData, dataFor(post, lang))) return true;
    return Object.entries(stash).some(
      ([language, kept]) =>
        (kept.fields !== undefined && !isDraftEqual(kept.fields, savedFields(post, language))) ||
        (kept.canvas !== undefined && !isDraftEqual(kept.canvas, dataFor(post, language))),
    );
  })();

  // A "Saved." stays only while nothing has changed since: the next edit clears it (issue #1512).
  const { clear: clearStatus } = status;
  useEffect(() => {
    if (dirty) clearStatus();
  }, [dirty, clearStatus]);

  const discard = (): void => {
    if (!post) {
      setForm(blankForm);
      setScope({ salesChannelIds: [], languages: ['en-US'] });
      return;
    }
    const lang = activeLanguage ?? post.languages[0] ?? 'en-US';
    setForm(savedForm(post, lang));
    setLinks(savedLinks(post));
    setScope({ salesChannelIds: post.salesChannelIds, languages: post.languages });
    setStash({});
    setDraftData(dataFor(post, lang));
    setContentDirty(false);
  };

  return (
    <PageBuilderEditorLayout
      settingsPanel={settingsPanel}
      dirty={dirty}
      onSave={isNew ? create : save}
      onDiscard={discard}
      header={
        <>
          <PageHeader
            back={{ label: t('postList.title'), to: '/blog/posts' }}
            title={isNew ? t('postEditor.title.new') : form.name || t('postEditor.title.edit')}
            description={isNew ? t('postEditor.description.new') : undefined}
            actions={
              <div data-save-actions className="flex flex-wrap items-center gap-2">
                <UnsavedChangesHint dirty={dirty} />
                {/* Mounted before it has text, so a result is announced and not only shown (WCAG 4.1.3). */}
                <InlineStatus {...status.props} />
                {/* Publishing is the last step of writing, not a setting: it
                    stays in the header, where it is reachable with the panel
                    put away. Only the transition the status allows is offered. */}
                {post && post.status !== 'published' ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void onLifecycle('publish')}
                  >
                    {t('common.publish')}
                  </Button>
                ) : null}
                {post && post.status === 'published' ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void onLifecycle('unpublish')}
                  >
                    {t('common.unpublish')}
                  </Button>
                ) : null}
                {isNew ? (
                  <Button type="button" disabled={saving} onClick={() => void create()}>
                    {saving ? t('common.saving') : t('common.create')}
                  </Button>
                ) : (
                  <SaveButtonGroup
                    onSave={() => void save()}
                    onSaveAndExit={() => void saveAndExit()}
                    saving={saving}
                    disabled={!post}
                    saveLabel={t('common.save')}
                    savingLabel={t('common.saving')}
                    saveAndExitLabel={t('common.saveAndExit')}
                  />
                )}
              </div>
            }
          />
          {error ? (
            <Alert id="post-error" variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      canvasBar={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* The switcher drives every per-language surface: the canvas below
              and the name and meta fields in the panel. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {isNew ? t('fields.editingLanguage') : t('postEditor.content')}
            </span>
            <ContentLanguageTabs
              languages={scope.languages}
              activeLanguage={activeLanguage}
              onChange={switchLanguage}
            />
          </div>
          {post ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <PostStatusBadge status={post.status} active={post.active} />
              <span>
                {post.publishedAt
                  ? t('postEditor.publishedAt', { date: new Date(post.publishedAt).toLocaleString() })
                  : t('postEditor.notPublished')}
              </span>
            </div>
          ) : null}
        </div>
      }
      builderLabel={
        activeLanguage ? t('postEditor.contentTitle', { language: activeLanguage }) : undefined
      }
      builder={
        isNew ? null : ready ? (
          <PageBuilderEditor
            data={draftData}
            contentKey={`${post.id}:${activeLanguage}`}
            onChange={(next) => {
              setDraftData(next);
              setContentDirty(true);
            }}
            // Feature 151 — the Translate action: the post's languages, the
            // saved content of another tab as a source, the audit subject, and
            // the version whose change retires *Restore previous content*.
            languages={scope.languages}
            activeLanguage={activeLanguage}
            onResolveLanguageContent={(language) =>
              structuredClone(
                language === activeLanguage && draftData
                  ? draftData
                  : (stash[language]?.canvas ?? dataFor(post, language) ?? emptyCanvas()),
              )
            }
            resource={{ type: 'blog_post', id: post.id }}
            savedVersion={post.version}
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
          <EditorSection as="h3" title={t('sections.metadata')}>
            <div className="space-y-1">
              <Label htmlFor="post-name">{t('fields.namePerLanguage')}</Label>
              <Input
                id="post-name"
                aria-invalid={problem === 'validation.nameRequired' ? true : undefined}
                aria-describedby={problem === 'validation.nameRequired' ? 'post-error' : undefined}
                value={form.name}
                onChange={(event) => {
                  const name = event.target.value;
                  setForm((f) => ({
                    ...f,
                    name,
                    // New post: keep slug + meta title in sync with the title
                    // until the editor overrides either one.
                    ...(isNew && !slugEdited ? { slug: slugify(name) } : {}),
                    ...(isNew && !metaTitleEdited ? { metaTitle: name } : {}),
                  }));
                }}
                placeholder={t('postEditor.namePlaceholder')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="post-slug">{t('fields.slug')}</Label>
              <Input
                id="post-slug"
                aria-invalid={problem === 'validation.slugInvalid' ? true : undefined}
                aria-describedby={problem === 'validation.slugInvalid' ? 'post-error' : undefined}
                value={form.slug}
                onChange={(event) => {
                  setSlugEdited(true);
                  setForm((f) => ({ ...f, slug: event.target.value.toLowerCase() }));
                }}
                className="font-mono"
                placeholder="best-cordless-trimmers-2026"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                id="post-active"
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((f) => ({ ...f, active: event.target.checked }))}
              />
              {t('fields.activeWhenPublished')}
            </label>
            <div className="space-y-1">
              <Label htmlFor="post-image">{t('fields.mainImage')}</Label>
              <AssetFieldPicker
                id="post-image"
                value={form.mainImageAssetId}
                onChange={(assetId) => setForm((f) => ({ ...f, mainImageAssetId: assetId }))}
                acceptMimePrefix="image/"
                allowUpload
              />
              <p className="text-xs text-muted-foreground">{t('postEditor.mainImageHint')}</p>
            </div>
          </EditorSection>

          {post ? (
            <EditorSection as="h3" title={t('author.title')}>
              <AuthorPicker
                value={links.authorId}
                saved={post.author ?? null}
                disabled={saving}
                onChange={(authorId) => setLinks((l) => ({ ...l, authorId }))}
              />
            </EditorSection>
          ) : null}

          {post && activeLanguage ? (
            <UrlKeysPanel
              kind="post"
              entityId={post.id}
              language={activeLanguage}
              // The keys' save bumps the post's version; the form's edits stay.
              onSaved={() =>
                void blogClient.getPost(post.id).then((fresh) => setPost((p) => (p ? { ...p, version: fresh.version } : fresh)))
              }
            />
          ) : null}

          <ScopePicker value={scope} onChange={setScope} titleAs="h3" />

          <EditorSection as="h3" title={t('sections.seo')} data-settings-group="seo">
            <div className="space-y-1">
              <Label htmlFor="post-meta-title">{t('fields.metaTitlePerLanguage')}</Label>
              <Input
                id="post-meta-title"
                value={form.metaTitle}
                onChange={(event) => {
                  setMetaTitleEdited(true);
                  setForm((f) => ({ ...f, metaTitle: event.target.value }));
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="post-meta-description">{t('fields.metaDescriptionPerLanguage')}</Label>
              <Input
                id="post-meta-description"
                value={form.metaDescription}
                onChange={(event) =>
                  setForm((f) => ({ ...f, metaDescription: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="post-meta-keywords">{t('fields.metaKeywordsPerLanguage')}</Label>
              <Input
                id="post-meta-keywords"
                value={form.metaKeywords}
                onChange={(event) =>
                  setForm((f) => ({ ...f, metaKeywords: event.target.value }))
                }
              />
            </div>
          </EditorSection>

          {post ? (
            <EditorSection as="h3" title={t('sections.tags')}>
              <TagPicker
                value={links.tagIds}
                onChange={(tagIds) => setLinks((l) => ({ ...l, tagIds }))}
              />
            </EditorSection>
          ) : null}

          {post ? (
            <EditorSection as="h3" title={t('sections.relatedPosts')}>
              <RelatedPostsPicker
                value={links.relatedPostIds}
                selfId={post.id}
                onChange={(relatedPostIds) => setLinks((l) => ({ ...l, relatedPostIds }))}
              />
            </EditorSection>
          ) : null}

          {post ? (
            <EditorSection as="h3" title={t('sections.relatedProducts')}>
              <RelatedProductsPicker
                value={links.relatedProductIds}
                onChange={(relatedProductIds) => setLinks((l) => ({ ...l, relatedProductIds }))}
              />
            </EditorSection>
          ) : null}

          {/* Last, and away from Save: archiving is rare and takes the post
              off the storefront. */}
          {post ? (
            <EditorSection as="h3" title={t('sections.lifecycle')}>
              <p className="text-sm text-muted-foreground">{t('postEditor.archiveHint')}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving || post.status === 'archived'}
                onClick={() => void onLifecycle('archive')}
              >
                {t('common.archive')}
              </Button>
            </EditorSection>
          ) : null}
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
export default BlogPostEditor;
