import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TransactionalEmailSummary } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { transactionalEmailsClient } from '../api/transactional-emails-client';

export function EmailsList(): React.ReactElement {
  const { hasPermission } = useAuth();
  const [items, setItems] = useState<TransactionalEmailSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    transactionalEmailsClient
      .list()
      .then((res) => {
        if (live) setItems(res.items);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => i.name.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle));
  }, [items, q]);

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view transactional emails.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Transactional Emails" description="Edit the content and look of transactional emails." />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Input placeholder="Search by name or code…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Code</th>
                <th className="p-3 font-medium">Module</th>
                <th className="p-3 font-medium">Customized</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.code} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="p-3">
                    <Link className="font-medium text-primary hover:underline" to={`/transactional-emails/${encodeURIComponent(e.code)}`}>
                      {e.name}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs">{e.code}</td>
                  <td className="p-3">{e.ownerModule}</td>
                  <td className="p-3">
                    {e.hasGlobalOverride || e.hasChannelOverride ? 'Yes' : '—'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td className="p-3 text-muted-foreground" colSpan={4}>
                    No transactional emails found.
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
