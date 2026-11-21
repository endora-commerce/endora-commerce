import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Eraser, Languages, RefreshCw, Search } from 'lucide-react';
import type { CacheNamespaceDto } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  EditorSection,
  InlineStatus,
  PageHeader,
  Skeleton,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { reloadBundles, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { settingsClient } from '../api/settings-client.js';
import { SettingsSectionTabs } from '../components/SettingsSectionTabs.js';

/**
 * Cache maintenance page — lets an operator flush selected Redis cache
 * namespaces so freshly-published content / changed settings appear without
 * waiting for TTL expiry, rebuild the search index, and reload the admin's
 * translation bundles. Backed by `/api/v1/admin/cache/*` (settings:write).
 *
 * **One card, three rows** since issue #1550 (UX audit SHELL-10): each row is
 * an action label, a one-line effect and its button (`EditorSection`), so the
 * three maintenance actions read as one place rather than three objects
 * (Common Region) and the screen offers three choices, not three cards of
 * prose (Hick). None of the buttons is filled — they are equals, and none is
 * the page's primary (Von Restorff). The result of an action is said beside the
 * button that produced it, in an always-mounted `InlineStatus` (WCAG 4.1.3),
 * not in a banner at the top of the page.
 */
export function CachePage(): ReactNode {
  const t = useTranslation('settings');
  const [namespaces, setNamespaces] = useState<CacheNamespaceDto[]>([]);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const clearStatus = useInlineStatus();
  const reindexStatus = useInlineStatus();
  const i18nStatus = useInlineStatus();

  // Prefer a localised label/description for a known namespace, fall back to
  // the backend-provided English default for any namespace the bundle hasn't
  // caught up with yet.
  const nsLabel = useCallback(
    (ns: CacheNamespaceDto): string => {
      const key = `cache.namespace.${ns.key}.label`;
      const localised = t(key);
      return localised === key ? ns.label : localised;
    },
    [t],
  );
  const nsDescription = useCallback(
    (ns: CacheNamespaceDto): string => {
      const key = `cache.namespace.${ns.key}.description`;
      const localised = t(key);
      return localised === key ? ns.description : localised;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await settingsClient.listCacheNamespaces();
      setNamespaces(res.data);
      setCacheEnabled(res.cacheEnabled);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('cache.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const allSelected = useMemo(
    () => namespaces.length > 0 && selected.size === namespaces.length,
    [namespaces, selected],
  );

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = (): void => {
    setSelected((prev) =>
      prev.size === namespaces.length ? new Set() : new Set(namespaces.map((n) => n.key)),
    );
  };

  const reindexSearch = async (): Promise<void> => {
    setBusy(true);
    reindexStatus.clear();
    try {
      const res = await settingsClient.reindexSearch();
      reindexStatus.show(
        t('search.reindex.done', {
          channels: res.channelsReindexed,
          documents: res.documentCount,
        }),
      );
    } catch (err) {
      reindexStatus.show(err instanceof ApiError ? err.message : t('search.reindex.error'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const reloadTranslations = async (): Promise<void> => {
    setBusy(true);
    i18nStatus.clear();
    try {
      const res = await reloadBundles();
      i18nStatus.show(t('cache.i18n.done', { installed: res.installed }));
      // Refresh so the TranslationProvider refetches the new admin bundles.
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      i18nStatus.show(err instanceof ApiError ? err.message : t('cache.i18n.error'), 'error');
      setBusy(false);
    }
  };

  const clear = async (which: 'all' | string[]): Promise<void> => {
    setBusy(true);
    clearStatus.clear();
    try {
      const res = await settingsClient.clearCache({ namespaces: which });
      clearStatus.show(t('cache.cleared', { count: res.data.totalDeletedKeys }));
      setSelected(new Set());
    } catch (err) {
      // The selection stays, so a retry is one click.
      clearStatus.show(err instanceof ApiError ? err.message : t('cache.error.clear'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-(--card-gap)">
      <PageHeader title={t('cache.page.title')} />
      <SettingsSectionTabs />

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            {loadError}
            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
              <RefreshCw aria-hidden="true" />
              {t('cache.refresh')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {!cacheEnabled ? (
        <Alert>
          <AlertDescription>{t('cache.disabled')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent>
          <EditorSection
            title={t('cache.clear.title')}
            description={t('cache.clear.description')}
            action={
              <Button variant="outline" onClick={() => void clear('all')} disabled={busy}>
                <Eraser aria-hidden="true" />
                {t('cache.clearAll')}
              </Button>
            }
          >
            {loading ? (
              <div className="space-y-2" aria-busy="true">
                <span className="sr-only">{t('cache.loading')}</span>
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-64" />
                <Skeleton className="h-5 w-56" />
              </div>
            ) : (
              <fieldset className="space-y-1">
                <legend className="sr-only">{t('cache.namespaces.label')}</legend>
                <label className="flex items-center gap-3 border-b border-border pb-2">
                  <Checkbox checked={allSelected} onChange={toggleAll} />
                  <span className="text-sm font-medium">{t('cache.selectAll')}</span>
                </label>
                <ul className="divide-y divide-border">
                  {namespaces.map((ns) => (
                    <li key={ns.key}>
                      <label className="flex items-start gap-3 py-2 hover:bg-muted/50">
                        <Checkbox
                          className="mt-1"
                          checked={selected.has(ns.key)}
                          onChange={() => toggle(ns.key)}
                          aria-label={nsLabel(ns)}
                        />
                        <span className="flex flex-col">
                          <span className="text-sm">{nsLabel(ns)}</span>
                          <span className="text-xs text-muted-foreground">{nsDescription(ns)}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() => void clear([...selected])}
                disabled={busy || selected.size === 0}
              >
                <Eraser aria-hidden="true" />
                {t('cache.clearSelected')}
              </Button>
              <Button variant="ghost" onClick={() => void load()} disabled={busy || loading}>
                <RefreshCw aria-hidden="true" />
                {t('cache.refresh')}
              </Button>
              <InlineStatus {...clearStatus.props} />
            </div>
          </EditorSection>

          <EditorSection
            title={t('search.reindex.title')}
            description={t('search.reindex.description')}
            action={
              <Button variant="outline" onClick={() => void reindexSearch()} disabled={busy}>
                <Search aria-hidden="true" />
                {t('search.reindex.button')}
              </Button>
            }
          >
            <InlineStatus {...reindexStatus.props} />
          </EditorSection>

          <EditorSection
            title={t('cache.i18n.title')}
            description={t('cache.i18n.description')}
            action={
              <Button variant="outline" onClick={() => void reloadTranslations()} disabled={busy}>
                <Languages aria-hidden="true" />
                {t('cache.i18n.button')}
              </Button>
            }
          >
            <InlineStatus {...i18nStatus.props} />
          </EditorSection>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default CachePage;
