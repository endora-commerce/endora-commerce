import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { ComparisonAdminListItem } from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { listComparisons } from '../api';

/**
 * `<ComparisonsListPage>` — feature 007 / US5 / T067.
 *
 * Read-only listing of every Comparison the storefront has generated.
 * Filters: sales channel id, owner type (customer / anonymous), time
 * range. Cursor pagination. Click a row to open the detail page.
 */
export function ComparisonsListPage(): ReactNode {
  const [rows, setRows] = useState<ComparisonAdminListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [salesChannelId, setSalesChannelId] = useState('');
  const [ownerType, setOwnerType] = useState<'' | 'customer' | 'anonymous'>('');
  const [createdAfter, setCreatedAfter] = useState('');
  const [createdBefore, setCreatedBefore] = useState('');

  const refresh = useCallback(
    async (cursor?: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const filters: Record<string, string> = {};
        if (salesChannelId) filters['salesChannelId'] = salesChannelId;
        if (ownerType) filters['ownerType'] = ownerType;
        if (createdAfter) filters['createdAfter'] = new Date(createdAfter).toISOString();
        if (createdBefore) filters['createdBefore'] = new Date(createdBefore).toISOString();
        if (cursor) filters['cursor'] = cursor;
        const res = await listComparisons(filters);
        if (cursor) {
          setRows((prev) => [...prev, ...res.data]);
        } else {
          setRows(res.data);
        }
        setNextCursor(res.meta.nextCursor);
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
      } finally {
        setLoading(false);
      }
    },
    [salesChannelId, ownerType, createdAfter, createdBefore],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        title="Comparisons"
        description="Read-only audit of every comparison generated on the storefront."
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="sales-channel-id">Sales channel id</Label>
              <Input
                id="sales-channel-id"
                value={salesChannelId}
                onChange={(e): void => setSalesChannelId(e.target.value)}
                placeholder="uuid (optional)"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-type">Owner</Label>
              <Select
                id="owner-type"
                value={ownerType}
                onChange={(e): void =>
                  setOwnerType(e.target.value as '' | 'customer' | 'anonymous')
                }
              >
                <option value="">Any</option>
                <option value="customer">Customer</option>
                <option value="anonymous">Anonymous</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="created-after">Created after</Label>
              <Input
                id="created-after"
                type="datetime-local"
                value={createdAfter}
                onChange={(e): void => setCreatedAfter(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="created-before">Created before</Label>
              <Input
                id="created-before"
                type="datetime-local"
                value={createdBefore}
                onChange={(e): void => setCreatedBefore(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comparisons match the filters.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead>Sales channel</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Products</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        {c.owner.kind === 'customer' ? (
                          <span>{c.owner.email ?? '(no email on file)'}</span>
                        ) : (
                          <Badge variant="secondary">Anonymous</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">{c.salesChannel.code}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">{c.displayMode}</Badge>
                      </TableCell>
                      <TableCell>{c.productCount}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(c.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link to={`/comparisons/${c.id}`}>
                            <ArrowRight className="size-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {nextCursor ? (
                <div className="mt-4 text-center">
                  <Button
                    variant="outline"
                    disabled={loading}
                    onClick={(): void => {
                      void refresh(nextCursor);
                    }}
                  >
                    {loading ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
