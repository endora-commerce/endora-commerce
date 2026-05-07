import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  ResolvedMeta,
  SeoEntityType,
  SitemapChannelStatus,
  UpsertSeoMetaOverrideRequest,
} from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
  return (
    <>
      <PageHeader
        title="SEO"
        description="Per-channel sitemap generation and meta-tag overrides."
      />
      <div className="space-y-4">
        <SitemapCard />
        <MetaEditorCard />
      </div>
    </>
  );
}

function SitemapCard(): ReactNode {
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
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load sitemap status.');
    } finally {
      setLoading(false);
    }
  }, []);

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
          `Regenerated sitemap for "${code}" — ${res.data.urlCount} URLs (${formatBytes(res.data.byteSize)}).`,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Regenerate failed.');
      } finally {
        setBusyChannel(null);
      }
    },
    [refresh],
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
          setError('Popup was blocked — allow popups for this site to preview the sitemap.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Preview failed.');
      } finally {
        setBusyChannel(null);
      }
    },
    [fetchXml],
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
        setError(err instanceof Error ? err.message : 'Download failed.');
      } finally {
        setBusyChannel(null);
      }
    },
    [fetchXml],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sitemap</CardTitle>
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
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sales channels.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sales channel</TableHead>
                <TableHead>Storefront URL</TableHead>
                <TableHead>Last generated</TableHead>
                <TableHead className="text-right">URLs</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Actions</TableHead>
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
                        source: {row.storefrontUrlSource}
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
                          {busy ? '…' : 'Regenerate'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || row.generatedAt === null}
                          onClick={(): void => {
                            void preview(row.salesChannelCode);
                          }}
                        >
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || row.generatedAt === null}
                          onClick={(): void => {
                            void download(row.salesChannelCode);
                          }}
                        >
                          Download
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
          Storefront URL is read from the per-channel <code>sales_channels.storefront_url</code>{' '}
          setting. Configure it in Settings → Sales Channels for each channel; empty falls back to
          the <code>STOREFRONT_BASE_URL</code> environment variable.
        </p>
      </CardContent>
    </Card>
  );
}

function MetaEditorCard(): ReactNode {
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
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load meta.');
      setMeta(null);
    } finally {
      setBusy(false);
    }
  }, [entityType, entityId, locale]);

  const save = useCallback(async (): Promise<void> => {
    if (!entityId.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiClient.put(`/api/v1/admin/seo/meta/${entityType}/${entityId}`, draft);
      setMessage('Override saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  }, [entityType, entityId, draft, load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meta-tag overrides</CardTitle>
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
            onChange={(e): void => setEntityType(e.target.value as SeoEntityType)}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          <Input
            className="w-80"
            value={entityId}
            onChange={(e): void => setEntityId(e.target.value)}
            placeholder="Entity UUID"
          />
          <Input
            className="w-24"
            value={locale}
            onChange={(e): void => setLocale(e.target.value)}
            placeholder="locale"
          />
          <Button
            variant="outline"
            onClick={(): void => {
              void load();
            }}
            disabled={busy || !entityId.trim()}
          >
            Load
          </Button>
        </div>

        {meta ? (
          <>
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-sm">
                  Resolved (source: {meta.resolved.source})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableHead className="w-40">Title</TableHead>
                      <TableCell>{meta.resolved.title}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead className="w-40">Description</TableHead>
                      <TableCell>{meta.resolved.description}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead className="w-40">OG title</TableHead>
                      <TableCell>{meta.resolved.openGraph.title}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead className="w-40">OG description</TableHead>
                      <TableCell>{meta.resolved.openGraph.description}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableHead className="w-40">OG image</TableHead>
                      <TableCell className="font-mono text-xs">
                        {meta.resolved.openGraph.image ?? '—'}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <h3 className="text-sm font-semibold">Override (leave blank to fall back to rule)</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={draft.title ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, title: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={draft.description ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, description: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>OG title</Label>
                <Input
                  value={draft.ogTitle ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, ogTitle: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>OG description</Label>
                <Input
                  value={draft.ogDescription ?? ''}
                  onChange={(e): void =>
                    setDraft((d) => ({ ...d, ogDescription: e.target.value || null }))
                  }
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>OG image URL</Label>
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
              {busy ? 'Saving…' : 'Save override'}
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
