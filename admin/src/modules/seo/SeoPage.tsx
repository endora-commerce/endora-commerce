import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  ResolvedMeta,
  SeoEntityType,
  SitemapChannelStatus,
  UpsertSeoMetaOverrideRequest,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { ProductPicker } from '@endora-commerce/admin-kit/components';
import { CategorySelect } from '@/components/category-picker/CategorySelect';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

interface SitemapListEnvelope {
  data: SitemapChannelStatus[];
}
interface RegenerateEnvelope {
  data: {
    salesChannelCode: string;
    generatedAt: string;
    urlCount: number;
    byteSize: number;
  };
}
interface MetaEnvelope {
  data: {
    resolved: ResolvedMeta;
    override: {
      title: string | null;
      description: string | null;
      ogTitle: string | null;
      ogDescription: string | null;
      ogImageUrl: string | null;
    } | null;
  };
}

const ENTITY_TYPES: SeoEntityType[] = ['product', 'category'];

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

export function SeoPage(): ReactNode {
  const t = useTranslation('core');
  return (
    <>
      <PageHeader
        title={t('seo.page.title')}
        description={t('seo.page.description')}
      />
      <div className="space-y-4">
        <SitemapCard />
        <MetaEditorCard />
      </div>
    </>
  );
}

function SitemapCard(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<SitemapChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const res = await apiClient.get<SitemapListEnvelope>('/api/v1/admin/seo/sitemap');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('seo.sitemap.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const regenerate = useCallback(
    async (code: string): Promise<void> => {
      setBusyChannel(code);
      setMessage(null);
      setError(null);
      try {
        const res = await apiClient.post<RegenerateEnvelope>(
          `/api/v1/admin/seo/sitemap/${encodeURIComponent(code)}/regenerate`,
        );
        setMessage(
          t('seo.sitemap.regenerated', {
            code,
            count: res.data.urlCount,
            size: formatBytes(res.data.byteSize),
          }),
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('seo.sitemap.error.regenerate'));
      } finally {
        setBusyChannel(null);
      }
    },
    [refresh, t],
  );

  const fetchXml = useCallback(async (code: string): Promise<Blob> => {
    const url = `${API_BASE_URL}/api/v1/admin/seo/sitemap/${encodeURIComponent(code)}/xml`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.blob();
  }, []);

  const preview = useCallback(
    async (code: string): Promise<void> => {
      setBusyChannel(code);
      setError(null);
      try {
        const blob = await fetchXml(code);
        const objectUrl = URL.createObjectURL(blob);
        const newWindow = window.open(objectUrl, '_blank', 'noopener,noreferrer');
        // Revoke after the new window has had a chance to load.
        setTimeout((): void => URL.revokeObjectURL(objectUrl), 60_000);
        if (!newWindow) {
          setError(t('seo.sitemap.error.popupBlocked'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('seo.sitemap.error.preview'));
      } finally {
        setBusyChannel(null);
      }
    },
    [fetchXml, t],
  );

  const download = useCallback(
    async (code: string): Promise<void> => {
      setBusyChannel(code);
      setError(null);
      try {
        const blob = await fetchXml(code);
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `sitemap-${code}.xml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('seo.sitemap.error.download'));
      } finally {
        setBusyChannel(null);
      }
    },
    [fetchXml, t],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('seo.sitemap.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert variant="success">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('seo.sitemap.loading')}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('seo.sitemap.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('seo.sitemap.column.channel')}</TableHead>
                <TableHead>{t('seo.sitemap.column.storefrontUrl')}</TableHead>
                <TableHead>{t('seo.sitemap.column.lastGenerated')}</TableHead>
                <TableHead className="text-right">{t('seo.sitemap.column.urls')}</TableHead>
                <TableHead className="text-right">{t('seo.sitemap.column.size')}</TableHead>
                <TableHead className="text-right">{t('seo.sitemap.column.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const busy = busyChannel === row.salesChannelCode;
                return (
                  <TableRow key={row.salesChannelCode}>
                    <TableCell>
                      <div className="font-medium">{row.salesChannelName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {row.salesChannelCode}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{row.storefrontUrl}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('seo.sitemap.sourcePrefix')} {row.storefrontUrlSource}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.generatedAt ? formatDateTime(row.generatedAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.urlCount?.toLocaleString() ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.byteSize ? formatBytes(row.byteSize) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={(): void => {
                            void regenerate(row.salesChannelCode);
                          }}
                        >
                          {busy ? '…' : t('seo.sitemap.regenerate')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || row.generatedAt === null}
                          onClick={(): void => {
                            void preview(row.salesChannelCode);
                          }}
                        >
                          {t('seo.sitemap.preview')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || row.generatedAt === null}
                          onClick={(): void => {
                            void download(row.salesChannelCode);
                          }}
                        >
                          {t('seo.sitemap.download')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <p className="text-xs text-muted-foreground">
          {t('seo.sitemap.help.prefix')} <code>sales_channels.storefront_url</code>{' '}
          {t('seo.sitemap.help.middle')} <code>STOREFRONT_BASE_URL</code> {t('seo.sitemap.help.suffix')}
        </p>
      </CardContent>
    </Card>
  );
}

function MetaEditorCard(): ReactNode {
  const t = useTranslation('core');
  const [entityType, setEntityType] = useState<SeoEntityType>('product');
  const [entityId, setEntityId] = useState('');
  const [locale, setLocale] = useState('en-US');
  const [meta, setMeta] = useState<MetaEnvelope['data'] | null>(null);
  const [draft, setDraft] = useState<UpsertSeoMetaOverrideRequest>({ locale: 'en-US' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!entityId.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiClient.get<MetaEnvelope>(
        `/api/v1/admin/seo/meta/${entityType}/${entityId}?locale=${encodeURIComponent(locale)}`,
      );
      setMeta(res.data);
      setDraft({
        locale,
        title: res.data.override?.title ?? null,
        description: res.data.override?.description ?? null,
        ogTitle: res.data.override?.ogTitle ?? null,
        ogDescription: res.data.override?.ogDescription ?? null,
        ogImageUrl: res.data.override?.ogImageUrl ?? null,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('seo.meta.error.load'));
      setMeta(null);
    } finally {
      setBusy(false);
    }
  }, [entityType, entityId, locale, t]);

  const save = useCallback(async (): Promise<void> => {
    if (!entityId.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.put(`/api/v1/admin/seo/meta/${entityType}/${entityId}`, draft);
      setMessage(t('seo.meta.info.saved'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('seo.meta.error.save'));
    } finally {
      setBusy(false);
    }
  }, [entityType, entityId, draft, load, t]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('seo.meta.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {message ? (
          <Alert variant="success">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <Select
            className="w-auto"
            value={entityType}
            onChange={(e): void => {
              setEntityType(e.target.value as SeoEntityType);
              setEntityId('');
            }}
          >
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </Select>
          <div className="w-80">
            {entityType === 'product' ? (
              <ProductPicker
                mode="select"
                value={entityId || null}
                onChange={(v): void => setEntityId(v ?? '')}
                includeArchived
              />
            ) : (
              <CategorySelect
                value={entityId || null}
                onChange={(v): void => setEntityId(v ?? '')}
              />
            )}
          </div>
          <Input
            className="w-24"
            value={locale}
            onChange={(e): void => setLocale(e.target.value)}
            placeholder={t('seo.meta.field.locale')}
          />
          <Button
            variant="outline"
            onClick={(): void => {
              void load();
            }}
            disabled={busy || !entityId.trim()}
          >
            {t('seo.meta.load')}
          </Button>
        </div>

        {meta ? (
          <>
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-sm">
                  {t('seo.meta.resolvedTitle', { source: meta.resolved.source })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableHead className="w-40">{t('seo.meta.field.title')}</TableHead>
                      <TableCell>{meta.resolved.title}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead className="w-40">{t('seo.meta.field.description')}</TableHead>
                      <TableCell>{meta.resolved.description}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead className="w-40">{t('seo.meta.field.ogTitle')}</TableHead>
                      <TableCell>{meta.resolved.openGraph.title}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead className="w-40">{t('seo.meta.field.ogDescription')}</TableHead>
                      <TableCell>{meta.resolved.openGraph.description}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead className="w-40">{t('seo.meta.field.ogImage')}</TableHead>
                      <TableCell className="font-mono text-xs">
                        {meta.resolved.openGraph.image ?? '—'}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <h3 className="text-sm font-semibold">{t('seo.meta.overrideHeading')}</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('seo.meta.field.title')}</Label>
                <Input
                  value={draft.title ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, title: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t('seo.meta.field.description')}</Label>
                <Input
                  value={draft.description ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, description: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t('seo.meta.field.ogTitle')}</Label>
                <Input
                  value={draft.ogTitle ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, ogTitle: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t('seo.meta.field.ogDescription')}</Label>
                <Input
                  value={draft.ogDescription ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, ogDescription: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>{t('seo.meta.field.ogImageUrl')}</Label>
                <Input
                  type="url"
                  value={draft.ogImageUrl ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, ogImageUrl: e.target.value || null }))
                  }
                />
              </div>
            </div>

            <Button
              disabled={busy}
              onClick={(): void => {
                void save();
              }}
            >
              {busy ? t('seo.meta.saving') : t('seo.meta.saveOverride')}
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
