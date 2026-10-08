import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AdminCategoryContent, AdminZoneProps } from '@endora-commerce/contracts';
import { ApiError, apiClient, useAuth, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ContentLanguageTabs, adminLanguageToLocale, pickCategoryDisplayName } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';

/**
 * The languages this module's own editors name a category in — the two
 * `CategoriesTree.tsx` and `ProductEditor.tsx` offer. A category's content is
 * keyed like its name, so these are always offered; a language only the stored
 * name or the stored content carries is offered after them.
 */
const CATALOG_LOCALES = ['en-US', 'pl-PL'] as const;

interface CategoryRow {
  id: string;
  name: Record<string, string>;
  slug: string;
}

type EditorZoneProps = AdminZoneProps<'category.content.editor'>;

/**
 * The category content screen (`/catalog/categories/:id/content`).
 *
 * An operator authors here what the storefront renders above the product grid
 * of one category's page: a Page Builder document per language.
 *
 * **This screen owns the document and no editor.** It loads the per-language
 * envelope, keeps the draft, and saves the whole envelope with one `PUT`. The
 * canvas is whatever contributes to the `category.content.editor` zone — the
 * module that owns a Page Builder — so this module names none and compiles
 * against none. That is not a stylistic choice: this module cannot be switched
 * off and the Page Builder's owner can, so a platform where nobody contributes
 * is a state this screen has to render, and it does so with its own sentence
 * instead of an empty card.
 *
 * It is a screen of its own rather than a section of the category row's inline
 * form because a Page Builder canvas needs the width of a page — the same
 * reason a blog category's description is edited on that category's page.
 */
export function CategoryContentPage(): ReactNode {
  const t = useTranslation('catalog');
  const { language: adminLanguage } = useTranslationContext();
  const { id } = useParams();
  const categoryId = id ?? '';
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');

  const [category, setCategory] = useState<CategoryRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [languages, setLanguages] = useState<string[]>([...CATALOG_LOCALES]);
  const [activeLanguage, setActiveLanguage] = useState<string>(CATALOG_LOCALES[0]);
  // What the editor is seeded with for the active language. It changes when
  // the language does and when a load lands — never on an edit or a save, so a
  // keystroke in the canvas does not hand the canvas a new document.
  const [seed, setSeed] = useState<{ language: string; data: unknown; revision: number }>({
    language: CATALOG_LOCALES[0],
    data: null,
    revision: 0,
  });
  // The draft envelope. A ref, for the same reason: an edit is reported on
  // every change in the canvas and must not re-render the canvas' host.
  const draft = useRef<Record<string, unknown>>({});

  useUnsavedChangesPrompt(dirty);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    void (async (): Promise<void> => {
      try {
        const [content, list] = await Promise.all([
          apiClient.get<{ data: AdminCategoryContent }>(
            `/api/v1/admin/catalog/categories/${categoryId}/content`,
          ),
          apiClient.get<{ data: CategoryRow[] }>('/api/v1/admin/catalog/categories'),
        ]);
        if (cancelled) return;
        const row = list.data.find((c) => c.id === categoryId) ?? null;
        const stored = content.data.content?.languages ?? {};
        const offered = [
          ...new Set<string>([
            ...CATALOG_LOCALES,
            ...Object.keys(row?.name ?? {}),
            ...Object.keys(stored),
          ]),
        ];
        draft.current = { ...stored };
        const first = offered[0] ?? CATALOG_LOCALES[0];
        setCategory(row);
        setLanguages(offered);
        setActiveLanguage(first);
        setSeed((previous) => ({
          language: first,
          data: stored[first] ?? null,
          revision: previous.revision + 1,
        }));
        setDirty(false);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.envelope.error.message : t('categoryContent.error.load'));
      }
    })();
    return (): void => {
      cancelled = true;
    };
    // `t` is stable per language; reloading on a language switch would drop an
    // unsaved draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const selectLanguage = useCallback((next: string): void => {
    setActiveLanguage(next);
    setSeed((previous) => ({
      language: next,
      data: draft.current[next] ?? null,
      revision: previous.revision + 1,
    }));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiClient.put<{ data: AdminCategoryContent }>(
        `/api/v1/admin/catalog/categories/${categoryId}/content`,
        { content: { languages: { ...draft.current } } },
      );
      draft.current = { ...(res.data.content?.languages ?? {}) };
      setDirty(false);
      setInfo(t('categoryContent.success.save'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('categoryContent.error.save'));
    } finally {
      setSaving(false);
    }
  }, [categoryId, t]);

  // One object per seed, so the zone's own memo holds between edits.
  const zoneProps = useMemo(
    (): EditorZoneProps => ({
      categoryId,
      language: seed.language,
      data: seed.data,
      onChange: (data: unknown): void => {
        draft.current = { ...draft.current, [seed.language]: data };
        setDirty(true);
        setInfo(null);
      },
    }),
    [categoryId, seed],
  );
  // Z15 — counted, not named: the filter has already applied both presence
  // axes and the contributor's own permission.
  const editors = useAdminZone('category.content.editor', zoneProps);

  const name = category
    ? pickCategoryDisplayName(category.name, category.slug, adminLanguageToLocale(adminLanguage))
    : '';

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('categoryContent.page.title', { name })}
        description={t('categoryContent.page.description')}
        actions={
          <Button asChild variant="outline">
            <Link to="/catalog/categories">{t('categoryContent.action.back')}</Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {!loaded ? (
        error ? null : (
          <p className="text-sm text-muted-foreground">{t('categoryContent.loading')}</p>
        )
      ) : editors.length === 0 ? (
        <Alert>
          <AlertDescription>
            <strong className="block">{t('categoryContent.noEditor.title')}</strong>
            {t('categoryContent.noEditor.description')}
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="space-y-2">
              <CardTitle className="text-base">
                {t('categoryContent.editor.title', { language: activeLanguage })}
              </CardTitle>
              <ContentLanguageTabs
                languages={languages}
                activeLanguage={activeLanguage}
                onChange={selectLanguage}
              />
            </div>
            {canWrite ? (
              <Button type="button" disabled={!dirty || saving} onClick={(): void => void save()}>
                {saving ? t('categoryContent.action.saving') : t('categoryContent.action.save')}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{t('categoryContent.readOnly')}</p>
            )}
          </CardHeader>
          <CardContent>
            {/* Keyed on the seed: a language switch or a load mounts a fresh
                editor on that document, and an edit or a save never does. */}
            <div key={`${seed.language}:${seed.revision}`}>
              <AdminZone name="category.content.editor" props={zoneProps} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * The default export a route declaration's dynamic-import factory resolves
 * (feature 091, R6). The named export stays: it is the spelling this module's
 * own tests use.
 */
export default CategoryContentPage;
