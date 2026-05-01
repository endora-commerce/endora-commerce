import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ComparisonAdminDetail } from '@b2b/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getComparisonDetail } from '../api';

/**
 * `<ComparisonDetailPage>` — feature 007 / US5 / T068.
 *
 * Read-only detail of a single Comparison. Renders the same products
 * + comparable-attribute projection the storefront customer sees, in
 * the comparison's RECORDED sales-channel context (so prices match
 * what the customer reported). No mutation controls.
 */
export function ComparisonDetailPage(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ComparisonAdminDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await getComparisonDetail(id);
        if (!cancelled) setDetail(res.data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <>
        <PageHeader title="Comparison" />
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="mt-4">
          <Button asChild variant="outline">
            <Link to="/comparisons">Back to list</Link>
          </Button>
        </div>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <PageHeader title="Comparison" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Comparison detail"
        description="Read-only view — what the customer is currently seeing."
      />

      <Card className="mb-4">
        <CardContent className="pt-6 space-y-2">
          <div>
            <strong>Owner:</strong>{' '}
            {detail.owner.kind === 'customer'
              ? detail.owner.email ?? '(no email)'
              : `Anonymous (${detail.owner.anonymousToken ?? '—'})`}
          </div>
          <div>
            <strong>Sales channel:</strong>{' '}
            <code className="font-mono text-xs">{detail.salesChannel.code}</code>
          </div>
          <div>
            <strong>Display mode:</strong> <Badge variant="default">{detail.displayMode}</Badge>
          </div>
          <div>
            <strong>Share token:</strong>{' '}
            <code className="font-mono text-xs">{detail.shareToken}</code>
          </div>
          <div className="text-muted-foreground">
            Created {new Date(detail.createdAt).toLocaleString()} · updated{' '}
            {new Date(detail.updatedAt).toLocaleString()}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Attribute</TableHead>
                {detail.products.map((p) => (
                  <TableHead key={p.id}>
                    <div>{localised(p.name)}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.price ? `${p.price.amount} ${p.price.currency}` : '—'}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.comparableAttributes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={detail.products.length + 1} className="text-muted-foreground">
                    No comparable attributes defined for this catalog.
                  </TableCell>
                </TableRow>
              ) : (
                detail.comparableAttributes.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <strong>{localised(row.label)}</strong>{' '}
                      <Badge
                        variant={row.rowClass === 'common' ? 'success' : 'warning'}
                        className="ml-2"
                      >
                        {row.rowClass}
                      </Badge>
                    </TableCell>
                    {row.values.map((v, idx) => (
                      <TableCell key={`${row.key}-${idx}`}>{v ?? '—'}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="mt-4">
        <Button asChild variant="outline">
          <Link to="/comparisons">Back to list</Link>
        </Button>
      </div>
    </>
  );
}

function localised(value: Record<string, string>): string {
  return value['en-US'] ?? value['en'] ?? Object.values(value)[0] ?? '';
}
