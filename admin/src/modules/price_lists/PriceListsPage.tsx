import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
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

interface AdminPriceList {
  id: string;
  code: string;
  name: string;
  currency: string;
  isDefault: boolean;
  priority: number;
  createdAt: string;
}

export function PriceListsPage(): ReactNode {
  const [rows, setRows] = useState<AdminPriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminPriceList[] }>('/api/v1/admin/price-lists');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpsert = useCallback(
    async (input: { code: string; name: string; currency: string; isDefault: boolean; priority: number }): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminPriceList }>(
          `/api/v1/admin/price-lists/${encodeURIComponent(input.code)}`,
          input,
        );
        setInfo(`Saved ${input.code}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this price list? Existing assignments will be cleared.')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/price-lists/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh],
  );

  return (
    <>
      <PageHeader
        title="Price lists"
        description="Default + per-customer-group / per-organization price overrides. Items + assignments live in the API; the panel for those is a follow-up."
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
          <CardTitle>New / update price list</CardTitle>
        </CardHeader>
        <CardContent>
          <UpsertForm onSubmit={handleUpsert} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No price lists yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{r.code}</code>
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.currency}</TableCell>
                    <TableCell>{r.isDefault ? <Badge variant="default">default</Badge> : null}</TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        type="button"
                        onClick={(): void => void handleDelete(r.id)}
                      >
                        <Trash2 />
                        Delete
                      </Button>
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

function UpsertForm({
  onSubmit,
}: {
  onSubmit: (input: {
    code: string;
    name: string;
    currency: string;
    isDefault: boolean;
    priority: number;
  }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('PLN');
  const [isDefault, setIsDefault] = useState(false);
  const [priority, setPriority] = useState('0');
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          code,
          name,
          currency,
          isDefault,
          priority: Number(priority),
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="plcode">Code</Label>
          <Input
            id="plcode"
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="plname">Display name</Label>
          <Input
            id="plname"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="plcur">Currency</Label>
          <Input
            id="plcur"
            value={currency}
            onChange={(e): void => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="plprio">Priority</Label>
          <Input
            id="plprio"
            type="number"
            value={priority}
            onChange={(e): void => setPriority(e.target.value)}
          />
        </div>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <Checkbox
          checked={isDefault}
          onChange={(e): void => setIsDefault(e.target.checked)}
        />
        Default fallback price list
      </label>
      <Button type="submit">Save</Button>
    </form>
  );
}
