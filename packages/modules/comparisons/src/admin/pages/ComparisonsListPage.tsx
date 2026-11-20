import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Scale } from 'lucide-react';
import { scopeNoticeOf, type ComparisonAdminListItem, type ScopeNoticeCode } from '@endora-commerce/contracts';
import { ApiError, useAuth, useModulePresence } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { SalesChannelPicker, ScopeNotice } from '@endora-commerce/admin-kit/components';
import { listComparisons } from '../api/comparisons-client.js';

/**
 * `<ComparisonsListPage>` — feature 007 / US5 / T067.
 *
 * Read-only listing of every Comparison the storefront has generated.
 * Filters: sales channel id, owner type (customer / anonymous), time
 * range. Cursor pagination. Click a row to open the detail page.
 */
export default function ComparisonsListPage(): ReactNode {
  const t = useTranslation('comparisons');
  const { hasPermission } = useAuth();
  const { isPresent } = useModulePresence();
  const showPdfTemplate = isPresent('document_templates') && hasPermission('document_templates:read');
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
  const filtered = Boolean(salesChannelId || ownerType || createdAfter || createdBefore);
  // Where focus returns after the empty state's "Clear filters" (WCAG 2.2 SC 2.4.3).
  const firstFilterRef = useRef<HTMLSelectElement>(null);
  const clearFilters = (): void => {
    setSalesChannelId('');
    setOwnerType('');
    setCreatedAfter('');
    setCreatedBefore('');
  };

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
        actions={
          // FR-063 — the comparison PDF's template, for an administrator who may
          // see document templates and only while that module is present.
          showPdfTemplate ? (
            <Button variant="outline" size="sm" asChild>
              <Link to="/document-templates?type=comparisons.comparison">{t('list.pdfTemplate')}</Link>
            </Button>
          ) : undefined
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent>
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
                ref={firstFilterRef}
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
        <CardContent>
          {loading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            // The server's scope notice says why first (feature 087);
            // otherwise "none generated yet" and "none match these filters"
            // are two situations (#1448, DS-15). Comparisons are made on the
            // storefront, so the no-data state offers no action.
            scopeNotice ? (
              <ScopeNotice notice={scopeNotice} />
            ) : filtered ? (
              <EmptyState
                variant="no-results"
                title={t('list.empty')}
                onClearFilters={clearFilters}
                focusAfterClear={firstFilterRef}
              />
            ) : (
              <EmptyState
                icon={<Scale size={20} />}
                title={t('list.emptyState.title')}
                description={t('list.emptyState.body')}
              />
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
