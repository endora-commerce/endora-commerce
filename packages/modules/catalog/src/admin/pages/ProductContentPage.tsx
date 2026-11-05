import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AdminProductContent, AdminProductContentList, AdminZoneProps } from '@endora-commerce/contracts';
import { ApiError, apiClient, useAuth, useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ContentLanguageTabs, adminLanguageToLocale } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import { PRODUCT_CONTENT_LANGUAGES } from '../components/ProductContentCard.js';

/**
 * The languages a content value is edited in, shared with the Attributes tab's
 * card; a language only the stored content carries is offered after them
 * (FR-021).
 */
const CATALOG_LOCALES = PRODUCT_CONTENT_LANGUAGES;

type EditorZoneProps = AdminZoneProps<'product.content.editor'>;

/** The text of a per-language map in the admin's language, then any. */
function pickText(map: Record<string, string> | undefined, locale: string, fallback: string): string {
  if (!map) return fallback;
  return map[locale]?.trim() || Object.values(map).find((value) => value.trim() !== '') || fallback;
}

/**
 * The product content screen (`/catalog/products/:id/content/:attributeKey`,
 * feature 172, `specs/172-product-content-attributes/` contracts/admin-surfaces.md
 * §3) — the twin of the category content screen, for one Page Builder content
 * attribute of one product.
 *
 * **This screen owns the document and no editor.** It loads the per-language
 * envelope, keeps the draft, and saves every edited language with one `PUT`.
 * The canvas is whatever contributes to `product.content.editor` — the module
 * that owns a Page Builder — so this module names none and compiles against
 * none: it cannot be switched off and the Page Builder's owner can, so a
 * platform where nobody contributes (or an operator without that module's read
 * code) is a state this screen renders with its own sentence (FR-050).
 *
 * A screen of its own rather than an inline canvas on the product form: a
 * canvas needs a page's width, the screen can be linked to directly, and the
 * product form's unsaved-changes handling stays separate from the content's.
 */
export function ProductContentPage(): ReactNode {
  const t = useTranslation('catalog');
  const { language: adminLanguage } = useTranslationContext();
  const locale = adminLanguageToLocale(adminLanguage);
  const { id, attributeKey: keyParam } = useParams();
  const productId = id ?? '';
  const attributeKey = keyParam ?? '';
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('catalog:write');

  const [productName, setProductName] = useState<Record<string, string> | undefined>(undefined);
  const [attributeLabel, setAttributeLabel] = useState<Record<string, string> | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [notAvailable, setNotAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [languages, setLanguages] = useState<string[]>([...CATALOG_LOCALES]);
  const [activeLanguage, setActiveLanguage] = useState<string>(CATALOG_LOCALES[0]);
  // What the editor is seeded with for the active language. It changes when
  // the language does and when a load lands — never on an edit or a save, so
  // a keystroke in the canvas does not hand the canvas a new document.
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
    setNotAvailable(false);
    setError(null);
    void (async (): Promise<void> => {
      try {
        const [content, list, product] = await Promise.all([
          apiClient.get<{ data: AdminProductContent }>(
            `/api/v1/admin/catalog/products/${productId}/content/${attributeKey}`,
          ),
          apiClient.get<{ data: AdminProductContentList }>(`/api/v1/admin/catalog/products/${productId}/content`),
          apiClient.get<{ data: { name: Record<string, string> } }>(`/api/v1/admin/catalog/products/${productId}`),
        ]);
        if (cancelled) return;
        const stored = content.data.content?.languages ?? {};
        const offered = [...new Set<string>([...CATALOG_LOCALES, ...Object.keys(stored)])];
        draft.current = { ...stored };
        const first = offered[0] ?? CATALOG_LOCALES[0];
        setProductName(product.data.name);
        setAttributeLabel(list.data.attributes.find((attribute) => attribute.key === attributeKey)?.label);
        setLanguages(offered);
        setActiveLanguage(first);
        setSeed((previous) => ({ language: first, data: stored[first] ?? null, revision: previous.revision + 1 }));
        setDirty(false);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotAvailable(true);
          return;
        }
        setError(err instanceof ApiError ? err.envelope.error.message : t('productContent.error.load'));
      }
    })();
    return (): void => {
      cancelled = true;
    };
    // `t` is stable per language; reloading on a language switch would drop an
    // unsaved draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, attributeKey]);

  const selectLanguage = useCallback((next: string): void => {
    setActiveLanguage(next);
    setSeed((previous) => ({ language: next, data: draft.current[next] ?? null, revision: previous.revision + 1 }));
  }, []);

  const save = useCallback(async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiClient.put<{ data: AdminProductContent }>(
        `/api/v1/admin/catalog/products/${productId}/content/${attributeKey}`,
        { content: { languages: { ...draft.current } } },
      );
      draft.current = { ...(res.data.content?.languages ?? {}) };
      setDirty(false);
      setInfo(t('productContent.success.save'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('productContent.error.save'));
    } finally {
      setSaving(false);
    }
  }, [productId, attributeKey, t]);

  // One object per seed, so the zone's own memo holds between edits.
  const zoneProps = useMemo(
    (): EditorZoneProps => ({
      productId,
      attributeKey,
      language: seed.language,
      data: seed.data,
      onChange: (data: unknown): void => {
        draft.current = { ...draft.current, [seed.language]: data };
        setDirty(true);
        setInfo(null);
      },
    }),
    [productId, attributeKey, seed],
  );
  // Z15 — counted, not named: the filter has already applied both presence
  // axes and the contributor's own permission.
  const editors = useAdminZone('product.content.editor', zoneProps);

  const attribute = pickText(attributeLabel, locale, attributeKey);
  const product = pickText(productName, locale, '');
  const backLink = (
    <Button asChild variant="outline">
      <Link to={`/catalog/products/${productId}?tab=attributes`}>{t('productContent.action.back')}</Link>
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('productContent.page.title', { attribute, product })}
        description={t('productContent.page.description')}
        actions={backLink}
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

      {notAvailable ? (
        <Alert>
          <AlertDescription>{t('productContent.error.notAvailable')}</AlertDescription>
        </Alert>
      ) : !loaded ? (
        error ? null : <p className="text-sm text-muted-foreground">{t('productContent.loading')}</p>
      ) : editors.length === 0 ? (
        <Alert>
          <AlertDescription>
            <strong className="block">{t('productContent.noEditor.title')}</strong>
            {t('productContent.noEditor.description')}
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="space-y-2">
              <CardTitle className="text-base">
                {t('productContent.editor.title', { language: activeLanguage })}
              </CardTitle>
              <ContentLanguageTabs languages={languages} activeLanguage={activeLanguage} onChange={selectLanguage} />
            </div>
            {canWrite ? (
              <Button type="button" disabled={!dirty || saving} onClick={(): void => void save()}>
                {saving ? t('productContent.action.saving') : t('productContent.action.save')}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{t('productContent.readOnly')}</p>
            )}
          </CardHeader>
          <CardContent>
            {/* Keyed on the seed: a language switch or a load mounts a fresh
                editor on that document, and an edit or a save never does. */}
            <div key={`${seed.language}:${seed.revision}`}>
              <AdminZone name="product.content.editor" props={zoneProps} />
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
export default ProductContentPage;
