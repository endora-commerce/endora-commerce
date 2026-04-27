import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { ExternalIntegration, IntegrationTestResult } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { Textarea } from '@/components/ui/textarea';

const KIND_OPTIONS = ['payment_gateway', 'shipping_carrier', 'analytics', 'crm', 'erp'] as const;

interface IntegrationsListResponse {
  data: ExternalIntegration[];
}
interface CreateIntegrationResponse {
  data: ExternalIntegration & { testResult?: IntegrationTestResult };
}
interface TestResponse {
  data: IntegrationTestResult;
}

export function IntegrationsPage(): ReactNode {
  const [items, setItems] = useState<ExternalIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<IntegrationsListResponse>('/api/v1/admin/integrations');
      setItems(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load integrations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      name: string;
      vendor: string;
      kind: string;
      config: Record<string, unknown>;
    }): Promise<void> => {
      try {
        const res = await apiClient.post<CreateIntegrationResponse>(
          '/api/v1/admin/integrations',
          input,
        );
        const test = res.data.testResult;
        if (test) {
          setInfo(
            test.ok
              ? `Connection test succeeded — status is now "${test.status}".`
              : `Connection test failed: ${test.message ?? 'unknown error'}.`,
          );
        } else {
          setInfo('Integration created.');
        }
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to create integration.');
      }
    },
    [refresh],
  );

  const handleTest = useCallback(
    async (id: string): Promise<void> => {
      try {
        const res = await apiClient.post<TestResponse>(`/api/v1/admin/integrations/${id}/test`);
        setInfo(
          res.data.ok
            ? `Test passed — status "${res.data.status}".`
            : `Test failed: ${res.data.message ?? 'unknown error'}`,
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Test call failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this integration? Stored credentials will be removed.')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/integrations/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to delete integration.');
      }
    },
    [refresh],
  );

  return (
    <>
      <PageHeader
        title="External integrations"
        description="Per-vendor credentials. Encrypted at rest; only redacted fields are returned by GET."
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Configure new integration</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateIntegrationForm onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configured</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No integrations configured yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last tested</TableHead>
                  <TableHead>Last error</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{i.kind}</Badge>
                    </TableCell>
                    <TableCell>{i.vendor}</TableCell>
                    <TableCell>
                      <IntegrationStatusBadge status={i.status} />
                    </TableCell>
                    <TableCell>{formatDateTime(i.lastTestedAt)}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                      {i.lastError ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(): void => {
                            void handleTest(i.id);
                          }}
                        >
                          Test
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={(): void => {
                            void handleDelete(i.id);
                          }}
                        >
                          <Trash2 />
                          Delete
                        </Button>
                      </div>
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

function IntegrationStatusBadge({ status }: { status: ExternalIntegration['status'] }): ReactNode {
  const variant =
    status === 'active' ? 'success' : status === 'error' ? 'destructive' : 'warning';
  return <Badge variant={variant}>{status}</Badge>;
}

function CreateIntegrationForm(props: {
  onSubmit: (input: {
    name: string;
    vendor: string;
    kind: string;
    config: Record<string, unknown>;
  }) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('');
  const [kind, setKind] = useState<string>(KIND_OPTIONS[0]);
  const [configText, setConfigText] = useState('{}');
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim() || !vendor.trim()) return;
    let config: Record<string, unknown>;
    try {
      const parsed = JSON.parse(configText) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config must be a JSON object.');
      }
      config = parsed as Record<string, unknown>;
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid JSON.');
      return;
    }
    setParseError(null);
    setSubmitting(true);
    try {
      await props.onSubmit({ name: name.trim(), vendor: vendor.trim(), kind, config });
      setName('');
      setVendor('');
      setConfigText('{}');
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
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="int-name">Name</Label>
          <Input id="int-name" value={name} onChange={(e): void => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="int-vendor">Vendor</Label>
          <Input
            id="int-vendor"
            value={vendor}
            onChange={(e): void => setVendor(e.target.value)}
            placeholder="e.g. stripe, inpost"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="int-kind">Kind</Label>
          <Select id="int-kind" value={kind} onChange={(e): void => setKind(e.target.value)}>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="int-config">Config (JSON)</Label>
        <Textarea
          id="int-config"
          value={configText}
          onChange={(e): void => setConfigText(e.target.value)}
          rows={6}
          spellCheck={false}
          className="font-mono text-xs"
        />
        {parseError ? <p className="text-xs text-destructive">{parseError}</p> : null}
        <p className="text-xs text-muted-foreground">
          Stored encrypted at rest. Only the per-vendor adapter ever decrypts it.
        </p>
      </div>
      <Button type="submit" disabled={submitting || !name.trim() || !vendor.trim()}>
        {submitting ? 'Creating…' : 'Create + test connection'}
      </Button>
    </form>
  );
}
