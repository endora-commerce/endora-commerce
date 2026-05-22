import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

type Reason =
  | 'direct_organization_match'
  | 'customer_group_match'
  | 'sales_channel_inheritance'
  | 'segment_rule_match';

interface ApplicableItem {
  priceListId: string;
  name: string;
  priority: number;
  reasons: Reason[];
}

export interface ApplicablePriceListsPanelProps {
  organizationId: string;
}

/**
 * Read-only panel on the OrganizationDetail page listing every Price
 * List that currently applies to the Organization, each tagged with the
 * reasons it applies (direct match / customer-group / channel inheritance
 * / segment-rule). Surface for feature 026 US5 FR-017.
 */
export function ApplicablePriceListsPanel(props: ApplicablePriceListsPanelProps): ReactNode {
  const t = useTranslation('core');
  const [items, setItems] = useState<ApplicableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ items: ApplicableItem[] }>(
        `/api/v1/admin/organizations/${props.organizationId}/applicable-price-lists`,
      );
      setItems(res.items);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('organizations.applicablePriceLists.error.load'),
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [props.organizationId, t]);

  useEffect((): void => {
    void refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('organizations.applicablePriceLists.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {loading && !error ? (
          <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
        ) : null}
        {!loading && !error && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('organizations.applicablePriceLists.empty')}
          </p>
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('organizations.applicablePriceLists.column.name')}</TableHead>
                <TableHead>{t('organizations.applicablePriceLists.column.priority')}</TableHead>
                <TableHead>{t('organizations.applicablePriceLists.column.reasons')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.priceListId}>
                  <TableCell className="font-medium">{it.name}</TableCell>
                  <TableCell>{it.priority}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {it.reasons.map((r) => (
                        <ReasonChip key={r} reason={r} />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReasonChip({ reason }: { reason: Reason }): ReactNode {
  const t = useTranslation('core');
  const palette: Record<Reason, string> = {
    direct_organization_match: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    customer_group_match: 'bg-sky-100 text-sky-900 border-sky-300',
    sales_channel_inheritance: 'bg-violet-100 text-violet-900 border-violet-300',
    segment_rule_match: 'bg-slate-100 text-slate-900 border-slate-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${palette[reason]}`}
    >
      {t(`organizations.applicablePriceLists.reason.${reason}`)}
    </span>
  );
}
