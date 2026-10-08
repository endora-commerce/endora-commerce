import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@puckeditor/core';
import { slugify as slugifyText, type BlogPostDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, PageHeader, SaveButtonGroup } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ContentLanguageTabs, ScopePicker, type ScopePickerValue } from '@endora-commerce/admin-kit/components';
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

export function BlogPostEditor(): ReactNode {
  const t = useTranslation('blog');
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const settingsPanel = usePageBuilderEditorSettingsPanel(isNew);
  const [post, setPost] = useState<BlogPostDetail | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
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
  const [error, setError] = useState<string | null>(null);
  // Which field a refused save was about, so the field itself says so.
  const [problem, setProblem] = useState<BlogEditorProblem | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reloadFormFromPost = useCallback(
    (loaded: BlogPostDetail, language: string | null) => {
      const lang = language ?? loaded.languages[0] ?? 'en-US';
      setForm({
        name: pickValue(loaded.name, lang) || pickValue(loaded.name, 'en-US'),
        slug: loaded.slug,
        active: loaded.active,
        description: loaded.description ?? '',
        metaTitle: pickValue(loaded.metaTitle, lang),
        metaDescription: pickValue(loaded.metaDescription, lang),
        metaKeywords: pickValue(loaded.metaKeywords, lang),
      });
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
    setScope({ salesChannelIds: [], languages: ['en-US'] });
    setActiveLanguage('en-US');
    setDraftData(null);
    setContentDirty(false);
    setSlugEdited(false);
    setMetaTitleEdited(false);
  }, [isNew]);

  /**
   * Another language's fields and canvas, read from the post as it was last
   * saved.
   *
   * Done where the language is chosen rather than in an effect over `post`: the
   * tag and related-content pickers save on their own and answer with a new
   * `post`, and an effect keyed on it would put the stored canvas back under an
   * operator who is half-way through editing — now that the pickers sit beside
   * the canvas instead of a screen below it, that is one click away.
   */
  const switchLanguage = useCallback(
    (language: string) => {
      setActiveLanguage(language);
      if (!post) return;
      reloadFormFromPost(post, language);
      setDraftData(dataFor(post, language));
      setContentDirty(false);
    },
    [post, reloadFormFromPost],
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
    try {
      const created = await blogClient.createPost({
        name: { [activeLanguage ?? 'en-US']: form.name },
        slug: form.slug,
        active: form.active,
        description: form.description || null,
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
    } catch (err) {
      refuse(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  /**
   * One save for the fields and the canvas.
   *
   * They are still the two requests they always were — the fields, then the
   * canvas when it was touched, carrying the version the first one answered
   * with. What went is the second button: "Save metadata" lived at the foot of
   * the form, and a save action inside a panel that collapses is a save action
   * that can disappear.
   */
  const save = async (): Promise<boolean> => {
    if (!post) return false;
    setInfo(null);
    const found = blogEditorProblem({ ...form, ...scope });
    setProblem(found);
    if (found) return refuse(t(found));
    setSaving(true);
    setError(null);
    const lang = activeLanguage ?? 'en-US';
    try {
      let updated = await blogClient.patchPost(post.id, {
        name: { ...post.name, [lang]: form.name },
        slug: form.slug,
        active: form.active,
        description: form.description || null,
        salesChannelIds: scope.salesChannelIds,
        languages: scope.languages,
        metaTitle: { ...(post.metaTitle ?? {}), [lang]: form.metaTitle },
        metaDescription: { ...(post.metaDescription ?? {}), [lang]: form.metaDescription },
        metaKeywords: { ...(post.metaKeywords ?? {}), [lang]: form.metaKeywords },
        version: post.version,
      });
      // The fields are stored from here on, whatever the canvas request does.
      setPost(updated);
      if (contentDirty && activeLanguage && draftData) {
        updated = await blogClient.putPostContent(post.id, {
          content: {
            schema_version: updated.content.schema_version ?? 1,
            languages: { ...updated.content.languages, [activeLanguage]: draftData },
          },
          version: updated.version,
        });
        setPost(updated);
        setContentDirty(false);
      }
      setInfo(t('messages.saved'));
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

  const onSaveTags = useCallback(
    async (tagIds: string[]) => {
      if (!post) return;
      setSaving(true);
      setError(null);
      setInfo(null);
      try {
        const updated = await blogClient.setPostTags(post.id, tagIds, post.version);
        setPost(updated);
        setInfo(t('messages.tagsUpdated', { count: tagIds.length }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [post, t],
  );

  const onSaveRelatedPosts = useCallback(
    async (relatedPostIds: string[]) => {
      if (!post) return;
      setSaving(true);
      setError(null);
      setInfo(null);
      try {
        const updated = await blogClient.setPostRelatedPosts(
          post.id,
          relatedPostIds,
          post.version,
        );
        setPost(updated);
        setInfo(t('messages.relatedPostsUpdated', { count: relatedPostIds.length }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [post, t],
  );

  const onSaveRelatedProducts = useCallback(
    async (productIds: string[]) => {
      if (!post) return;
      setSaving(true);
      setError(null);
      setInfo(null);
      try {
        const updated = await blogClient.setPostRelatedProducts(
          post.id,
          productIds,
          post.version,
        );
        setPost(updated);
        setInfo(t('messages.relatedProductsUpdated', { count: productIds.length }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [post, t],
  );

  const onLifecycle = useCallback(
    async (kind: 'publish' | 'unpublish' | 'archive') => {
      if (!post) return;
      setSaving(true);
      setError(null);
      setInfo(null);
      try {
        const updated =
          kind === 'publish'
            ? await blogClient.publishPost(post.id, post.version)
            : kind === 'unpublish'
              ? await blogClient.unpublishPost(post.id, post.version)
              : await blogClient.archivePost(post.id, post.version);
        setPost(updated);
        setInfo(t('messages.statusUpdated', { status: t(`status.${updated.status}`) }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [post, t],
  );

  const ready = !isNew && post !== null && activeLanguage !== null && draftData !== null;

  return (
    <PageBuilderEditorLayout
      settingsPanel={settingsPanel}
      header={
        <>
          <PageHeader
            title={isNew ? t('postEditor.title.new') : form.name || t('postEditor.title.edit')}
            description={
              isNew
                ? t('postEditor.description.new')
                : t('postEditor.description.edit')
            }
            actions={
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link to="/blog/posts">{t('postEditor.backToList')}</Link>
                </Button>
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
            </CardContent>
          </Card>

          <ScopePicker value={scope} onChange={setScope} />

          <Card data-settings-group="seo">
            <CardHeader>
              <CardTitle className="text-base">{t('sections.seo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
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
            </CardContent>
          </Card>

          {post ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('sections.tags')}</CardTitle>
              </CardHeader>
              <CardContent>
                <TagPicker
                  value={post.tags.map((tag) => tag.id)}
                  onChange={(next) => void onSaveTags(next)}
                />
              </CardContent>
            </Card>
          ) : null}

          {post ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('sections.relatedPosts')}</CardTitle>
              </CardHeader>
              <CardContent>
                <RelatedPostsPicker
                  value={post.relatedPostIds}
                  selfId={post.id}
                  onChange={(next) => void onSaveRelatedPosts(next)}
                />
              </CardContent>
            </Card>
          ) : null}

          {post ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('sections.relatedProducts')}</CardTitle>
              </CardHeader>
              <CardContent>
                <RelatedProductsPicker
                  value={post.relatedProductIds}
                  onChange={(next) => void onSaveRelatedProducts(next)}
                />
              </CardContent>
            </Card>
          ) : null}

          {/* Last, and away from Save: archiving is rare and takes the post
              off the storefront. */}
          {post ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('sections.lifecycle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
              </CardContent>
            </Card>
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
