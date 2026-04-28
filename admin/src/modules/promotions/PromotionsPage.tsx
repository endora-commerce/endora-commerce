import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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

interface AdminPromotion {
  id: string;
  code: string | null;
  name: string;
  kind: 'percentage_off' | 'amount_off' | 'free_delivery';
  value: number;
  currency: string | null;
  minCartSubtotal: number | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
}

const KINDS = ['percentage_off', 'amount_off', 'free_delivery'] as const;

export function PromotionsPage(): ReactNode {
  const [rows, setRows] = useState<AdminPromotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminPromotion[] }>('/api/v1/admin/promotions');
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

  const handleCreate = useCallback(
    async (input: {
      code: string;
      name: string;
      kind: AdminPromotion['kind'];
      value: number;
      currency: string;
      isActive: boolean;
    }): Promise<void> => {
      try {
        await apiClient.post<{ data: AdminPromotion }>('/api/v1/admin/promotions', {
          ...(input.code ? { code: input.code } : {}),
          name: input.name,
          kind: input.kind,
          value: input.value,
          ...(input.kind === 'amount_off' ? { currency: input.currency } : {}),
          isActive: input.isActive,
        });
        setInfo(`Promotion ${input.code || input.name} created.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm('Delete this promotion?')) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/promotions/${id}`);
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
        title="Promotions"
        description="Cart-level discounts. Percentage values are 0..100; amount-off requires a currency."
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
          <CardTitle>Create promotion</CardTitle>
        </CardHeader>
        <CardContent>
          <CreatePromotionForm onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No promotions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Min cart</TableHead>
                  <TableHead>Valid</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{p.code ?? '—'}</code>
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.kind}</TableCell>
                    <TableCell className="tabular-nums">
                      {p.kind === 'percentage_off'
                        ? `${p.value}%`
                        : p.kind === 'amount_off'
                          ? `${p.value} ${p.currency}`
                          : 'free delivery'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {p.minCartSubtotal != null ? p.minCartSubtotal.toFixed(2) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.validFrom ? formatDateTime(p.validFrom) : '—'}
                      {' → '}
                      {p.validUntil ? formatDateTime(p.validUntil) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? 'success' : 'secondary'}>
                        {p.isActive ? 'yes' : 'no'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        type="button"
                        onClick={(): void => void handleDelete(p.id)}
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

function CreatePromotionForm({
  onSubmit,
}: {
  onSubmit: (input: {
    code: string;
    name: string;
    kind: 'percentage_off' | 'amount_off' | 'free_delivery';
    value: number;
    currency: string;
    isActive: boolean;
  }) => Promise<void>;
}): ReactNode {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'percentage_off' | 'amount_off' | 'free_delivery'>('percentage_off');
  const [value, setValue] = useState('10');
  const [currency, setCurrency] = useState('PLN');
  const [isActive, setIsActive] = useState(true);

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          code,
          name,
          kind,
          value: Number(value),
          currency,
          isActive,
        }).then(() => {
          setCode('');
          setName('');
          setValue('10');
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="prcode">Code (optional)</Label>
          <Input id="prcode" value={code} onChange={(e): void => setCode(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="prname">Display name</Label>
          <Input
            id="prname"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="prkind">Kind</Label>
          <Select
            id="prkind"
            value={kind}
            onChange={(e): void => setKind(e.target.value as typeof kind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="prvalue">
            Value {kind === 'percentage_off' ? '(%)' : kind === 'amount_off' ? '' : '(ignored)'}
          </Label>
          <Input
            id="prvalue"
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e): void => setValue(e.target.value)}
          />
        </div>
        {kind === 'amount_off' ? (
          <div className="space-y-2">
            <Label htmlFor="prcur">Currency</Label>
            <Input
              id="prcur"
              value={currency}
              onChange={(e): void => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              required
            />
          </div>
        ) : null}
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <Checkbox
          checked={isActive}
          onChange={(e): void => setIsActive(e.target.checked)}
        />
        Active
      </label>
      <div>
        <Button type="submit">Create</Button>
      </div>
    </form>
  );
}
