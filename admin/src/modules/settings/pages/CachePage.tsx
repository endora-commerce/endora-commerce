import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Eraser, Languages, RefreshCw, Search } from 'lucide-react';
import type { CacheNamespaceDto } from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import { reloadBundles } from '@/i18n/language-storage';
import { settingsClient } from '../api/settings-client';

/**
 * Cache maintenance page — lets an operator flush selected Redis cache
 * namespaces so freshly-published content / changed settings appear without
 * waiting for TTL expiry. Backed by `/api/v1/admin/cache/*` (settings:write).
 */
export function CachePage(): ReactNode {
  const t = useTranslation('settings');
  const [namespaces, setNamespaces] = useState<CacheNamespaceDto[]>([]);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

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
    setError(null);
    try {
      const res = await settingsClient.listCacheNamespaces();
      setNamespaces(res.data);
      setCacheEnabled(res.cacheEnabled);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('cache.error.load'));
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
    setError(null);
    setResult(null);
    try {
      const res = await settingsClient.reindexSearch();
      setResult(
        t('search.reindex.done', {
          channels: res.channelsReindexed,
          documents: res.documentCount,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('search.reindex.error'));
    } finally {
      setBusy(false);
    }
  };

  const reloadTranslations = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await reloadBundles();
      setResult(t('cache.i18n.done', { installed: res.installed }));
      // Refresh so the TranslationProvider refetches the new admin bundles.
      window.setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('cache.i18n.error'));
      setBusy(false);
    }
  };

  const clear = async (which: 'all' | string[]): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await settingsClient.clearCache({ namespaces: which });
      setResult(t('cache.cleared', { count: res.data.totalDeletedKeys }));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('cache.error.clear'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('cache.page.title')} description={t('cache.page.description')} />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {result ? (
        <Alert>
          <AlertDescription>{result}</AlertDescription>
        </Alert>
      ) : null}
      {!cacheEnabled ? (
        <Alert>
          <AlertDescription>{t('cache.disabled')}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="space-y-1 p-4">
          {loading ? (
            <p className="py-6 text-sm text-muted-foreground">{t('cache.loading')}</p>
          ) : (
            <>
              <label className="flex items-center gap-3 border-b border-border pb-3">
                <Checkbox
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={t('cache.selectAll')}
                />
                <span className="text-sm font-medium">{t('cache.selectAll')}</span>
              </label>
              {namespaces.map((ns) => (
                <label
                  key={ns.key}
                  className="flex items-start gap-3 rounded-md px-1 py-2 hover:bg-muted/50"
                >
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(ns.key)}
                    onChange={() => toggle(ns.key)}
                    aria-label={nsLabel(ns)}
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{nsLabel(ns)}</span>
                    <span className="text-xs text-muted-foreground">{nsDescription(ns)}</span>
                  </span>
                </label>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => clear([...selected])}
          disabled={busy || selected.size === 0}
        >
          <Eraser className="mr-2 h-4 w-4" />
          {t('cache.clearSelected')}
        </Button>
        <Button variant="outline" onClick={() => clear('all')} disabled={busy}>
          <Eraser className="mr-2 h-4 w-4" />
          {t('cache.clearAll')}
        </Button>
        <Button variant="ghost" onClick={() => void load()} disabled={busy || loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('cache.refresh')}
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-medium">{t('search.reindex.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('search.reindex.description')}</p>
          </div>
          <Button variant="outline" onClick={() => void reindexSearch()} disabled={busy}>
            <Search className="mr-2 h-4 w-4" />
            {t('search.reindex.button')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h2 className="text-sm font-medium">{t('cache.i18n.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('cache.i18n.description')}</p>
          </div>
          <Button variant="outline" onClick={() => void reloadTranslations()} disabled={busy}>
            <Languages className="mr-2 h-4 w-4" />
            {t('cache.i18n.button')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
