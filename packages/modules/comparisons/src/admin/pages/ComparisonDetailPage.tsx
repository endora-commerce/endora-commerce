import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { unitPriceDisplayText, type ComparisonAdminDetail } from '@endora-commerce/contracts';
import { ApiError, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { getComparisonDetail } from '../api/comparisons-client.js';

/**
 * `<ComparisonDetailPage>` — feature 007 / US5 / T068.
 *
 * Read-only detail of a single Comparison. Renders the products and the
 * comparable-attribute projection in the comparison's RECORDED sales-channel
 * context (the creator's, not the admin's). No mutation controls.
 *
 * **The figures are the channel's, not the customer's.** Since the comparison
 * became viewer-priced, the customer sees their own organisation's prices and
 * an administrator — who has no buying organisation — sees the channel's. The
 * screen says so rather than letting the reader assume the two agree, which is
 * the same reason the storefront's shared view says whose prices it is showing.
 * Every product is listed, including ones restricted to organizations other
 * than the reader's: this is the audit view, and its question is what the
 * customer put in the comparison.
 */
export default function ComparisonDetailPage(): ReactNode {
  const t = useTranslation('comparisons');
  const { language } = useTranslationContext();
  const { id } = useParams<{ id: string }>();
  const back = { label: t('list.page.title'), to: '/comparisons' };
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
          setError(err instanceof ApiError ? err.envelope.error.message : t('error.load'));
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
        <PageHeader title={t('detail.page.title')} back={back} />
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <PageHeader title={t('detail.page.title')} back={back} />
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </>
    );
  }

  return (
    <>
      <PageHeader title={t('detail.page.title')} back={back} />

      <Alert className="mb-4">
        <AlertDescription>{t('detail.pricesNote')}</AlertDescription>
      </Alert>

      <Card className="mb-4">
        <CardContent className="space-y-2">
          <div>
            <strong>{t('detail.owner')}:</strong>{' '}
            {detail.owner.kind === 'customer'
              ? detail.owner.email ?? t('owner.noEmail')
              : t('owner.anonymousWithToken', { token: detail.owner.anonymousToken ?? '—' })}
          </div>
          <div>
            <strong>{t('detail.salesChannel')}:</strong>{' '}
            <code className="font-mono text-xs">{detail.salesChannel.code}</code>
          </div>
          <div>
            <strong>{t('detail.displayMode')}:</strong>{' '}
            <Badge variant="default">{t(`displayMode.${detail.displayMode}`)}</Badge>
          </div>
          <div>
            <strong>{t('detail.shareToken')}:</strong>{' '}
            <code className="font-mono text-xs">{detail.shareToken}</code>
          </div>
          <div className="text-muted-foreground">
            {t('detail.created')} {formatDateTime(detail.createdAt, language)} · {t('detail.updated')}{' '}
            {formatDateTime(detail.updatedAt, language)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.attribute')}</TableHead>
                {detail.products.map((p) => (
                  <TableHead key={p.id}>
                    <div>{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.price ? `${unitPriceDisplayText(p.price.amount)} ${p.price.currency}` : '—'}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.comparableAttributes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={detail.products.length + 1} className="text-muted-foreground">
                    {t('detail.noComparableAttributes')}
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
    </>
  );
}

function localised(value: Record<string, string>): string {
  return value['en-US'] ?? value['en'] ?? Object.values(value)[0] ?? '';
}
