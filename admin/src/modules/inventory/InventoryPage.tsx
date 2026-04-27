import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

interface AdminStockRow {
  id: string;
  productId: string;
  variantId: string | null;
  onHand: number;
  reserved: number;
  available: number;
  productSku: string | null;
  productName: Record<string, string> | null;
  updatedAt: string;
}

export function InventoryPage(): ReactNode {
  const [rows, setRows] = useState<AdminStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (productFilter) params.set('productId', productFilter);
      const path =
        '/api/v1/admin/inventory' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AdminStockRow[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [productFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleSet = useCallback(
    async (input: {
      productId: string;
      variantId: string | null;
      onHand: number;
    }): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminStockRow }>('/api/v1/admin/inventory', input);
        setInfo(`Set on-hand to ${input.onHand}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description={
          <span>
            On-hand counters per product / variant.{' '}
            <code className="font-mono text-xs">available = onHand − reserved</code>.
          </span>
        }
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
        <CardContent className="pt-6">
          <div className="space-y-2 md:max-w-md">
            <Label htmlFor="ifilter">Filter by product id</Label>
            <Input
              id="ifilter"
              value={productFilter}
              onChange={(e): void => setProductFilter(e.target.value.trim())}
              placeholder="UUID"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Set on-hand</CardTitle>
        </CardHeader>
        <CardContent>
          <SetStockForm onSubmit={handleSet} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stock-level rows match the current filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>On hand</TableHead>
                  <TableHead>Reserved</TableHead>
                  <TableHead>Available</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <code className="font-mono text-xs">
                        {r.productSku ?? r.productId.slice(0, 8)}
                      </code>
                      {r.productName ? (
                        <div className="text-xs text-muted-foreground">
                          {r.productName['en-US'] ?? Object.values(r.productName)[0]}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.variantId ? r.variantId.slice(0, 8) : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">{r.onHand}</TableCell>
                    <TableCell className="tabular-nums">{r.reserved}</TableCell>
                    <TableCell className="tabular-nums font-medium">{r.available}</TableCell>
                    <TableCell>{formatDateTime(r.updatedAt)}</TableCell>
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

function SetStockForm({
  onSubmit,
}: {
  onSubmit: (input: { productId: string; variantId: string | null; onHand: number }) => Promise<void>;
}): ReactNode {
  const [productId, setProductId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [onHand, setOnHand] = useState('0');
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          productId,
          variantId: variantId || null,
          onHand: Number(onHand),
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="ipid">Product ID</Label>
          <Input
            id="ipid"
            value={productId}
            onChange={(e): void => setProductId(e.target.value.trim())}
            required
            placeholder="UUID"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ivid">Variant ID (optional)</Label>
          <Input
            id="ivid"
            value={variantId}
            onChange={(e): void => setVariantId(e.target.value.trim())}
            placeholder="UUID"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ionhand">On hand</Label>
          <Input
            id="ionhand"
            type="number"
            min="0"
            value={onHand}
            onChange={(e): void => setOnHand(e.target.value)}
          />
        </div>
      </div>
      <Button type="submit">Save</Button>
    </form>
  );
}
