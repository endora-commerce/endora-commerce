import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SalesChannelSummary } from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { salesChannelsClient } from '../api/sales-channels-client';
import { DefaultChannelBadge } from '../components/DefaultChannelBadge';

/**
 * SalesChannelsListPage — feature 005 / T041.
 *
 * Top-level list view. The system-default channel always lives in
 * the list; the activeOnly filter toggles whether deactivated
 * channels are hidden. The "+ New channel" CTA sends the operator
 * to the create form (`/sales-channels/new`).
 */
export function SalesChannelsListPage(): ReactNode {
  const [rows, setRows] = useState<SalesChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await salesChannelsClient.list({ activeOnly });
      setRows(res.items);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : 'Failed to load sales channels.',
      );
    } finally {
      setLoading(false);
    }
  }, [activeOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        title="Sales channels"
        description="Each channel represents a place of sale (web storefront, marketplace, brick-and-mortar location). Products, customers, prices, and content are scoped to the channels they belong to. The “system default” channel is the implicit fallback for any entity created without explicit channel selection."
        actions={
          <Button asChild>
            <Link to="/sales-channels/new">+ New channel</Link>
          </Button>
        }
      />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <Checkbox
              id="sc-active-only"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
            />
            <Label htmlFor="sc-active-only" className="cursor-pointer">
              Show active channels only
            </Label>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading sales channels…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No channels match the filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Default lang / currency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32 text-right">Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        to={`/sales-channels/${encodeURIComponent(c.code)}`}
                        className="text-primary hover:underline"
                      >
                        {c.code}
                      </Link>
                      <DefaultChannelBadge systemDefault={c.systemDefault} />
                    </TableCell>
                    <TableCell>
                      {c.name['en-US'] ?? c.name['en'] ?? Object.values(c.name)[0] ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.defaultLanguage} / {c.defaultCurrency}
                    </TableCell>
                    <TableCell>
                      {c.active ? (
                        <Badge variant="default" className="text-[10px]">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      v{c.version}
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
