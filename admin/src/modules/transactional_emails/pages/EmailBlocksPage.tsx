import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { EmailBlockSummary } from '@b2b/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useAuth } from '@/lib/auth';
import { transactionalEmailsClient } from '../api/transactional-emails-client';

export function EmailBlocksPage(): React.ReactElement {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('transactional_emails:write');
  const [items, setItems] = useState<EmailBlockSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const reload = (): void => {
    transactionalEmailsClient
      .listBlocks()
      .then((res) => setItems(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };
  useEffect(reload, []);

  const create = async (): Promise<void> => {
    setError(null);
    try {
      await transactionalEmailsClient.createBlock({ code, name, languages: ['en-US', 'pl-PL'] });
      setCode('');
      setName('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this block?')) return;
    try {
      await transactionalEmailsClient.deleteBlock(id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!hasPermission('transactional_emails:read')) {
    return (
      <Alert>
        <AlertDescription>You do not have permission to view email blocks.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Email Blocks" description="Reusable email-safe blocks (e.g. header, footer)." />
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {canWrite ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <Input placeholder="code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[200px]" />
            <Input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-[240px]" />
            <Button onClick={() => void create()} disabled={!code || !name}>
              Create block
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Code</th>
                <th className="p-3 font-medium">Scope</th>
                <th className="p-3 font-medium">System</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link className="font-medium text-primary hover:underline" to={`/transactional-emails/blocks/${b.id}`}>
                      {b.name}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs">{b.code}</td>
                  <td className="p-3">{b.scope}</td>
                  <td className="p-3">{b.isSystem ? 'Yes' : '—'}</td>
                  <td className="p-3 text-right">
                    {canWrite && !b.isSystem ? (
                      <Button variant="outline" size="sm" onClick={() => void remove(b.id)}>
                        Delete
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
