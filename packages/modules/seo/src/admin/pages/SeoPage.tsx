import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { SeoEntityType, SitemapChannelStatus } from '@endora-commerce/contracts';
import { ApiError, apiBaseUrl, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, PageHeader, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { CategorySelect, ProductPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { SeoMetaScopeEditor } from './SeoMetaScopeEditor.js';

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

const ENTITY_TYPES: SeoEntityType[] = ['product', 'category'];

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
    // The kit's published origin (`admin-kit-publishes-api-base-url`), not a second
    // read of `import.meta.env`: the sitemap XML is downloaded rather than fetched
    // through `apiClient`, so this screen needs the origin the client was built from.
    const url = `${apiBaseUrl.replace(/\/+$/, '')}/api/v1/admin/seo/sitemap/${encodeURIComponent(code)}/xml`;
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

function isEntityType(value: string | null): value is SeoEntityType {
  return value !== null && (ENTITY_TYPES as readonly string[]).includes(value);
}

/** A product and a category are addressed by a UUID; nothing else names one. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isEntityId(value: string | null): value is string {
  return value !== null && UUID_SHAPE.test(value);
}

function MetaEditorCard(): ReactNode {
  const t = useTranslation('core');
  const tSeo = useTranslation('seo');
  const [entityType, setEntityType] = useState<SeoEntityType>('product');
  const [entityId, setEntityId] = useState('');
  // Feature 163 (owner decision UX-4 = A) — `?entityType=product&entityId=<id>` opens the
  // screen on that entity; the product editor's SEO link points here. Read on mount and
  // on every navigation that changes them; an unknown type is ignored. The address is
  // anybody's to write, so an id that is not a UUID is ignored too and sends nothing —
  // it would otherwise become a path segment of the editor's admin requests (S-M1).
  const [searchParams] = useSearchParams();
  const linkedType = searchParams.get('entityType');
  const linkedId = searchParams.get('entityId');
  useEffect(() => {
    if (!isEntityType(linkedType) || !isEntityId(linkedId)) return;
    setEntityType(linkedType);
    setEntityId(linkedId);
  }, [linkedType, linkedId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('seo.meta.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
        </div>

        {entityId.trim() && entityType === 'product' ? (
          // Feature 174 (FR-094): a product's SEO is edited in the product editor, at its scope.
          <div className="space-y-2" data-testid="seo-product-link">
            <p className="m-0 text-sm text-muted-foreground">{tSeo('productLink.hint')}</p>
            <Link to={`/catalog/products/${encodeURIComponent(entityId)}?tab=seo`} className="b2b-btn b2b-btn--default b2b-btn--sm">
              {tSeo('productLink.editInEditor')}
            </Link>
          </div>
        ) : entityId.trim() && entityType !== 'product' ? (
          <SeoMetaScopeEditor key={`${entityType}:${entityId}`} entityType={entityType} entityId={entityId} />
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
export default SeoPage;
