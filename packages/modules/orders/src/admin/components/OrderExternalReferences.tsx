import type { ReactNode } from 'react';
import type { AdminOrderExternalReference, OrderExternalReferenceState } from '@endora-commerce/contracts';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Badge, Section, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * What each external system reported about the order (issue #1030): the
 * system's key, its number for the order, where the hand-over stands and the
 * other system's own words. Written by integrations through
 * `orderExternalReferencePort`; read-only here.
 *
 * The message is rendered as text — it is another system's string, so it is
 * never interpreted as markup — and wraps, keeping its line breaks.
 */

const STATE_VARIANT: Record<OrderExternalReferenceState, 'secondary' | 'success' | 'destructive'> = {
  pending: 'secondary',
  synced: 'success',
  error: 'destructive',
};

export function OrderExternalReferences({
  references,
}: {
  references: readonly AdminOrderExternalReference[] | undefined;
}): ReactNode {
  const t = useTranslation('orders');
  const rows = references ?? [];

  return (
    <div data-testid="order-external-references">
      <Section title={t('externalReferences.title')}>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('externalReferences.empty')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('externalReferences.columns.system')}</TableHead>
                <TableHead>{t('externalReferences.columns.reference')}</TableHead>
                <TableHead>{t('externalReferences.columns.state')}</TableHead>
                <TableHead>{t('externalReferences.columns.message')}</TableHead>
                <TableHead>{t('externalReferences.columns.updatedAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.system} data-testid={`order-external-reference-${row.system}`}>
                  <TableCell>
                    <code className="font-mono text-xs">{row.system}</code>
                  </TableCell>
                  <TableCell>
                    {row.reference ? (
                      <span className="font-mono text-sm">{row.reference}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('externalReferences.noReference')}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATE_VARIANT[row.state]}>{t(`externalReferences.state.${row.state}`)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-md whitespace-pre-wrap break-words text-sm">
                    {row.message ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(row.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  );
}
