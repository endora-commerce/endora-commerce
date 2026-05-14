import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Data } from '@measured/puck';
import type { BlogPostDetail } from '@b2b/contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import { ContentLanguageTabs } from '../../cms/components/ContentLanguageTabs';
import { PageBuilderEditor } from '../../cms/components/PageBuilderEditor';
import { ScopePicker, type CmsScopeValue } from '../../cms/components/ScopePicker';
import { blogClient } from '../api/blog-client';
import { PostStatusBadge } from '../components/PostStatusBadge';
import { RelatedPostsPicker } from '../components/RelatedPostsPicker';
import { RelatedProductsPicker } from '../components/RelatedProductsPicker';
import { TagPicker } from '../components/TagPicker';

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
  const [post, setPost] = useState<BlogPostDetail | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [scope, setScope] = useState<CmsScopeValue>({
    salesChannelIds: [],
    languages: ['en-US'],
  });
  const [activeLanguage, setActiveLanguage] = useState<string | null>('en-US');
  const [draftData, setDraftData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, [id, isNew, reloadFormFromPost]);

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [load]);

  // When the active language changes (after load), refresh the form's
  // per-language fields.
  useEffect(() => {
    if (post && activeLanguage) {
      reloadFormFromPost(post, activeLanguage);
      setDraftData(dataFor(post, activeLanguage));
    }
  }, [post, activeLanguage, reloadFormFromPost]);

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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [activeLanguage, canSave, form, navigate, scope]);

  const onSaveMetadata = useCallback(async () => {
    if (!post || !canSave) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    const lang = activeLanguage ?? 'en-US';
    try {
      const updated = await blogClient.patchPost(post.id, {
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
      setPost(updated);
      setInfo(t('messages.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [activeLanguage, canSave, form, post, scope]);

  const onSaveContent = useCallback(async () => {
    if (!post || !activeLanguage || !draftData) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const nextLanguages = {
        ...post.content.languages,
        [activeLanguage]: draftData,
      };
      const updated = await blogClient.putPostContent(post.id, {
        content: {
          schema_version: post.content.schema_version ?? 1,
          languages: nextLanguages,
        },
        version: post.version,
      });
      setPost(updated);
      setInfo(t('messages.contentSaved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [activeLanguage, draftData, post]);

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
    [post],
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
    [post],
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
    [post],
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
    [post],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={isNew ? t('postEditor.title.new') : t('postEditor.title.edit')}
        description={
          isNew
            ? t('postEditor.description.new')
            : t('postEditor.description.edit')
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/blog/posts">{t('postEditor.backToList')}</Link>
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

      {!isNew && post ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              <span className="mr-2">{t('sections.lifecycle')}</span>
              <PostStatusBadge status={post.status} active={post.active} />
            </CardTitle>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={saving || post.status === 'published'}
                onClick={() => void onLifecycle('publish')}
              >
                {t('common.publish')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving || post.status !== 'published'}
                onClick={() => void onLifecycle('unpublish')}
              >
                {t('common.unpublish')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saving || post.status === 'archived'}
                onClick={() => void onLifecycle('archive')}
              >
                {t('common.archive')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {post.publishedAt ? (
              <>{t('postEditor.publishedAt', { date: new Date(post.publishedAt).toLocaleString() })}</>
            ) : (
              <>{t('postEditor.notPublished')}</>
            )}
          </CardContent>
        </Card>
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
              <Label htmlFor="post-name">{t('fields.namePerLanguage')}</Label>
              <Input
                id="post-name"
                value={form.name}
                onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
                placeholder={t('postEditor.namePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="post-slug">{t('fields.slug')}</Label>
              <Input
                id="post-slug"
                value={form.slug}
                onChange={(event) =>
                  setForm((f) => ({ ...f, slug: event.target.value.toLowerCase() }))
                }
                className="font-mono"
                placeholder="best-cordless-trimmers-2026"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="post-meta-title">{t('fields.metaTitlePerLanguage')}</Label>
              <Input
                id="post-meta-title"
                value={form.metaTitle}
                onChange={(event) =>
                  setForm((f) => ({ ...f, metaTitle: event.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="post-meta-description">{t('fields.metaDescriptionPerLanguage')}</Label>
              <Input
                id="post-meta-description"
                value={form.metaDescription}
                onChange={(event) =>
                  setForm((f) => ({ ...f, metaDescription: event.target.value }))
                }
              />
            </div>
          </div>

          <div>
            <Label htmlFor="post-meta-keywords">{t('fields.metaKeywordsPerLanguage')}</Label>
            <Input
              id="post-meta-keywords"
              value={form.metaKeywords}
              onChange={(event) =>
                setForm((f) => ({ ...f, metaKeywords: event.target.value }))
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="post-active"
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm((f) => ({ ...f, active: event.target.checked }))}
            />
            <Label htmlFor="post-active">{t('fields.activeWhenPublished')}</Label>
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

      {!isNew && post ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('sections.tags')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TagPicker
              value={post.tags.map((t) => t.id)}
              onChange={(next) => void onSaveTags(next)}
            />
          </CardContent>
        </Card>
      ) : null}

      {!isNew && post ? (
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

      {!isNew && post ? (
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

      {!isNew && post && activeLanguage && draftData !== null ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">
              {t('postEditor.contentTitle', { language: activeLanguage })}
            </CardTitle>
            <Button type="button" size="sm" disabled={saving} onClick={() => void onSaveContent()}>
              {saving ? t('common.saving') : t('common.saveContent')}
            </Button>
          </CardHeader>
          <CardContent>
            <PageBuilderEditor data={draftData} onChange={setDraftData} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
