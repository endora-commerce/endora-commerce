import { useEffect, useState, useCallback } from 'react';
import type { ScopeNoticeCode, SubscriberSummary } from '@endora-commerce/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScopeNotice } from '@/components/scope-notice/ScopeNotice';
import { useAuth } from '@/lib/auth';
import { newsletterClient } from '../api/newsletter-client';

export function SubscribersPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('newsletter:write');
  const [items, setItems] = useState<SubscriberSummary[]>([]);
  const [total, setTotal] = useState(0);
  // Feature 087 — an empty list is not the same statement as "there are no
  // subscribers", and only the server knows which one it just made.
  const [scopeNotice, setScopeNotice] = useState<ScopeNoticeCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');

  const load = useCallback(() => {
    newsletterClient
      .listSubscribers({ page: 1, pageSize: 50, ...(q ? { q } : {}), ...(tag ? { tag } : {}) })
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
        setScopeNotice(res.scopeNotice);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [q, tag]);

  useEffect(() => {
    load();
  }, [load]);

  if (!hasPermission('newsletter:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view the newsletter.</AlertDescription>
      </Alert>
    );
  }

  const exportHref = newsletterClient.subscribersExportUrl({ ...(q ? { q } : {}), ...(tag ? { tag } : {}) });

  async function action(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Newsletter — Subscribers" description={`${total} subscriber(s)`} />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search email…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Input placeholder="Tag code…" value={tag} onChange={(e) => setTag(e.target.value)} className="max-w-xs" />
        <a href={exportHref} className="ml-auto">
          <Button variant="outline">Export CSV</Button>
        </a>
      </div>
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Email</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Tags</th>
                <th className="p-3 font-medium">Source</th>
                {canWrite ? <th className="p-3 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3 font-medium">{s.email}</td>
                  <td className="p-3">{s.status}</td>
                  <td className="p-3 text-xs">{s.tags.join(', ') || '—'}</td>
                  <td className="p-3 text-xs">{s.source ?? '—'}</td>
                  {canWrite ? (
                    <td className="p-3">
                      {s.status === 'active' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void action(async () => {
                              const detail = await newsletterClient.getSubscriber(s.id);
                              await newsletterClient.unsubscribe(s.id, detail.version);
                            })
                          }
                        >
                          Unsubscribe
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="sm" onClick={() => void action(() => newsletterClient.deleteSubscriber(s.id))}>
                        Delete
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={canWrite ? 5 : 4}>
                    {/* The fragment keeps this screen's remaining untranslated
                        literal where `i18n:hardcoded` can still see it: as the
                        alternative of a ternary it is a string expression, which
                        the check reads as translated, and the file's debt would
                        drop by one without a key being added. */}
                    {scopeNotice ? <ScopeNotice notice={scopeNotice} /> : <>No subscribers found.</>}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
