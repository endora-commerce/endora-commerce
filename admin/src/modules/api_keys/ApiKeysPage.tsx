import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { ApiKey, CreateApiKeyResponse } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const KNOWN_SCOPES = [
  'catalog:read',
  'catalog:write',
  'orders:read',
  'orders:write',
  'integrations:manage',
];

interface ApiKeyListResponse {
  data: ApiKey[];
}

interface CreateApiKeyEnvelope {
  data: CreateApiKeyResponse;
}

export function ApiKeysPage(): ReactNode {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealedToken, setRevealedToken] = useState<{ name: string; token: string } | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ApiKeyListResponse>('/api/v1/admin/api-keys');
      setKeys(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load API keys.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: { name: string; scopes: string[] }): Promise<void> => {
      try {
        const res = await apiClient.post<CreateApiKeyEnvelope>('/api/v1/admin/api-keys', input);
        setRevealedToken({ name: input.name, token: res.data.bearerToken });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to create key.');
      }
    },
    [refresh],
  );

  const handleRevoke = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Revoke this key? Calls using it will start failing immediately.')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/api-keys/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to revoke key.');
      }
    },
    [refresh],
  );

  return (
    <>
      <PageHeader
        title="API keys"
        description="Bearer tokens for machine-to-machine integrations. The full token is shown once, on creation."
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {revealedToken ? (
        <Alert variant="warning" className="mb-4">
          <AlertTitle>Save this bearer token now — it will not be shown again.</AlertTitle>
          <AlertDescription>
            <p className="text-xs text-muted-foreground">{revealedToken.name}</p>
            <code className="mt-2 block break-all rounded bg-muted px-2 py-1 font-mono text-xs">
              {revealedToken.token}
            </code>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={(): void => setRevealedToken(null)}
            >
              I have stored it
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Create new key</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateKeyForm onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scopes</TableHead>
                  <TableHead>Last 4</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>
                      <Badge variant={k.status === 'active' ? 'success' : 'destructive'}>
                        {k.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="font-mono text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">…{k.lastFour}</TableCell>
                    <TableCell>{formatDateTime(k.lastUsedAt)}</TableCell>
                    <TableCell>{formatDateTime(k.createdAt)}</TableCell>
                    <TableCell>
                      {k.status === 'active' ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={(): void => {
                            void handleRevoke(k.id);
                          }}
                        >
                          <Trash2 />
                          Revoke
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function CreateKeyForm(props: {
  onSubmit: (input: { name: string; scopes: string[] }) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (scope: string): void => {
    setScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  };

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || scopes.size === 0) return;
    setSubmitting(true);
    try {
      await props.onSubmit({ name: name.trim(), scopes: Array.from(scopes) });
      setName('');
      setScopes(new Set());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e): void => {
        void onSubmit(e);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="api-key-name">Name</Label>
        <Input
          id="api-key-name"
          value={name}
          onChange={(e): void => setName(e.target.value)}
          placeholder="e.g. PIM sync"
          required
        />
      </div>
      <div className="space-y-2">
        <Label>Scopes</Label>
        <div className="flex flex-wrap gap-3">
          {KNOWN_SCOPES.map((scope) => (
            <label
              key={scope}
              className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-xs"
            >
              <Checkbox checked={scopes.has(scope)} onChange={(): void => toggle(scope)} />
              <code className="font-mono">{scope}</code>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Pick the smallest set that lets the integration work.
        </p>
      </div>
      <Button type="submit" disabled={submitting || !name.trim() || scopes.size === 0}>
        {submitting ? 'Creating…' : 'Create key'}
      </Button>
    </form>
  );
}
