import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SalesChannelSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ModalDialog, listScopeSalesChannels } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { blogClient, type BlogUrlPrefixRow } from '../api/blog-client.js';

/**
 * Feature 171 (US1/US5, T030/T072) — the addresses the blog is served at, per sales
 * channel: the current prefix (the channel default and any per-language one) and
 * every former prefix, which redirects to the current one while the SEO module is
 * on. The prefixes themselves are settings (`blog.url_prefix`,
 * `blog.url_prefix_by_language`); here a former one can be forgotten, after which
 * it stops redirecting and a CMS page may take it.
 */
export default function BlogAddressesPage(): ReactNode {
  const t = useTranslation('blog');
  const [rows, setRows] = useState<BlogUrlPrefixRow[] | null>(null);
  const [channels, setChannels] = useState<SalesChannelSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toForget, setToForget] = useState<BlogUrlPrefixRow | null>(null);

  const load = useCallback(async () => {
    const [list, prefixes] = await Promise.all([listScopeSalesChannels(), blogClient.listUrlPrefixes()]);
    setChannels(list.items);
    setRows(prefixes);
  }, []);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  const forget = async (): Promise<void> => {
    if (!toForget) return;
    setBusy(true);
    setError(null);
    try {
      await blogClient.forgetUrlPrefix(toForget.id);
      setToForget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const channelName = (id: string): string => {
    const channel = channels.find((c) => c.id === id);
    if (!channel) return id;
    return Object.values(channel.name)[0] ?? channel.code;
  };
  const byChannel = new Map<string, BlogUrlPrefixRow[]>();
  for (const row of rows ?? []) byChannel.set(row.salesChannelId, [...(byChannel.get(row.salesChannelId) ?? []), row]);

  return (
    <div className="space-y-6">
      <PageHeader title={t('addresses.title')} description={t('addresses.description')} />
      <p className="text-sm text-muted-foreground">
        {t('addresses.settingsHint')}{' '}
        <Link className="underline" to="/settings">
          {t('addresses.settingsLink')}
        </Link>
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {rows === null ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('common.loading')}
        </p>
      ) : byChannel.size === 0 ? (
        <p className="text-sm text-muted-foreground">{t('addresses.empty')}</p>
      ) : (
        [...byChannel.entries()].map(([channelId, channelRows]) => (
          <Card key={channelId}>
            <CardHeader>
              <CardTitle className="text-base">{channelName(channelId)}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {channelRows.map((row) => (
                  <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="font-mono">/{row.prefix}</span>
                      <Badge variant={row.state === 'current' ? 'default' : 'secondary'}>
                        {row.state === 'current' ? t('addresses.current') : t('addresses.former')}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {row.languageCode ?? t('addresses.allLanguages')}
                      </span>
                    </span>
                    {row.state === 'former' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={t('addresses.forget', { prefix: row.prefix })}
                        onClick={() => setToForget(row)}
                      >
                        {t('common.delete')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}

      {toForget !== null ? (
        <ModalDialog
          title={t('addresses.forgetTitle')}
          busy={busy}
          onClose={() => setToForget(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setToForget(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="button" variant="destructive" disabled={busy} aria-busy={busy} onClick={() => void forget()}>
                {t('addresses.forgetConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('addresses.forgetBody', { prefix: toForget.prefix })}</p>
        </ModalDialog>
      ) : null}
    </div>
  );
}
