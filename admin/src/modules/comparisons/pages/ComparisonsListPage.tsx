import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { scopeNoticeOf, type ComparisonAdminListItem, type ScopeNoticeCode } from '@endora-commerce/contracts';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SalesChannelPicker } from '@/components/sales-channel-picker/SalesChannelPicker';
import { ScopeNotice } from '@/components/scope-notice/ScopeNotice';
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
import { useTranslation } from '@/i18n/useTranslation';
import { listComparisons } from '../api';

/**
 * `<ComparisonsListPage>` — feature 007 / US5 / T067.
 *
 * Read-only listing of every Comparison the storefront has generated.
 * Filters: sales channel id, owner type (customer / anonymous), time
 * range. Cursor pagination. Click a row to open the detail page.
 */
export function ComparisonsListPage(): ReactNode {
  const t = useTranslation('comparisons');
  const [rows, setRows] = useState<ComparisonAdminListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Why the list is empty, when it is (feature 087). The server is the only
  // party that can tell "none of these is yours" from "there are none", so the
  // screen carries the answer rather than guessing at it.
  const [scopeNotice, setScopeNotice] = useState<ScopeNoticeCode | null>(null);
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
        setScopeNotice(scopeNoticeOf(res));
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('error.load'));
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
        title={t('list.page.title')}
        description={t('list.page.description')}
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
              <Label htmlFor="sales-channel-id">{t('list.filter.salesChannelId')}</Label>
              <SalesChannelPicker
                id="sales-channel-id"
                value={salesChannelId || null}
                onChange={(v): void => setSalesChannelId(v ?? '')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-type">{t('list.filter.owner')}</Label>
              <Select
                id="owner-type"
                value={ownerType}
                onChange={(e): void =>
                  setOwnerType(e.target.value as '' | 'customer' | 'anonymous')
                }
              >
                <option value="">{t('owner.any')}</option>
                <option value="customer">{t('owner.customer')}</option>
                <option value="anonymous">{t('owner.anonymous')}</option>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="created-after">{t('list.filter.createdAfter')}</Label>
              <Input
                id="created-after"
                type="datetime-local"
                value={createdAfter}
                onChange={(e): void => setCreatedAfter(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="created-before">{t('list.filter.createdBefore')}</Label>
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
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            scopeNotice ? (
              <ScopeNotice notice={scopeNotice} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('list.empty')}</p>
            )
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('list.column.owner')}</TableHead>
                    <TableHead>{t('list.column.salesChannel')}</TableHead>
                    <TableHead>{t('list.column.mode')}</TableHead>
                    <TableHead>{t('list.column.products')}</TableHead>
                    <TableHead>{t('list.column.created')}</TableHead>
                    <TableHead className="text-right">{t('list.column.open')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        {c.owner.kind === 'customer' ? (
                          <span>{c.owner.email ?? t('owner.noEmailOnFile')}</span>
                        ) : (
                          <Badge variant="secondary">{t('owner.anonymous')}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <code className="font-mono text-xs">{c.salesChannel.code}</code>
                      </TableCell>
                      <TableCell>
                        <Badge variant="default">{t(`displayMode.${c.displayMode}`)}</Badge>
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
                    {loading ? t('common.loading') : t('list.loadMore')}
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
