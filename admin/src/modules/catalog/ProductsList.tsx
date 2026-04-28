import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Plus } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

interface AdminProduct {
  id: string;
  sku: string;
  slug: string;
  type: string;
  status: 'draft' | 'active' | 'archived';
  name: Record<string, string>;
  visibility: string;
  attributeValues: Record<string, unknown>;
  updatedAt: string;
}

const STATUS_VARIANT: Record<AdminProduct['status'], 'default' | 'secondary' | 'success' | 'warning'> = {
  draft: 'warning',
  active: 'success',
  archived: 'secondary',
};

export function ProductsList(): ReactNode {
  const [rows, setRows] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filter, setFilter] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const path =
        '/api/v1/admin/catalog/products' + (includeArchived ? '?includeArchived=1' : '');
      const res = await apiClient.get<{ data: AdminProduct[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter(
      (r) =>
        r.sku.toLowerCase().includes(f) ||
        r.slug.toLowerCase().includes(f) ||
        pickName(r.name).toLowerCase().includes(f),
    );
  }, [rows, filter]);

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalog rows. Pricing, stock, and assets are managed in dedicated modules."
        actions={
          <Button asChild>
            <Link to="/catalog/products/new">
              <Plus />
              New product
            </Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="prod-filter">Filter by SKU / slug / name</Label>
            <Input
              id="prod-filter"
              value={filter}
              onChange={(e): void => setFilter(e.target.value)}
              placeholder="EXAMPLE-SIMPLE-001"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={includeArchived}
              onChange={(e): void => setIncludeArchived(e.target.checked)}
            />
            Show archived rows
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products match the current filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to={`/catalog/products/${r.id}`}
                        className="font-mono text-xs underline underline-offset-2"
                      >
                        {r.sku}
                      </Link>
                    </TableCell>
                    <TableCell className="font-medium">{pickName(r.name)}</TableCell>
                    <TableCell>{r.type}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>{r.visibility}</TableCell>
                    <TableCell>{formatDateTime(r.updatedAt)}</TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/catalog/products/${r.id}`}>
                          Open
                          <ArrowRight />
                        </Link>
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

function pickName(name: Record<string, string>): string {
  return name['en-US'] ?? Object.values(name)[0] ?? '';
}
