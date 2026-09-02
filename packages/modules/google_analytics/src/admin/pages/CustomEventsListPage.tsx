import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GaCustomEventResponse } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { googleAnalyticsClient } from '../api/google-analytics-client.js';

/**
 * CustomEventsListPage (feature 049, US3). Lists the module's custom events and
 * links to the create/edit form. Per-channel Measurement ID / Enhanced
 * Ecommerce / server-side settings are managed on the generic Settings screen.
 */
export default function CustomEventsListPage(): ReactNode {
  const t = useTranslation('google_analytics');
  const [rows, setRows] = useState<GaCustomEventResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setRows(await googleAnalyticsClient.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        title={t('customEvents.title')}
        description={t('customEvents.subtitle')}
        actions={
          <Button asChild>
            <Link to="/google-analytics/new">{t('customEvents.new')}</Link>
          </Button>
        }
      />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('customEvents.eventName')}</TableHead>
              <TableHead>{t('customEvents.triggerAction')}</TableHead>
              <TableHead>{t('customEvents.salesChannel')}</TableHead>
              <TableHead>{t('customEvents.enabled')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link to={`/google-analytics/${row.id}`} className="font-medium hover:underline">
                    {row.eventName}
                  </Link>
                </TableCell>
                <TableCell>{t(`customEvents.actions.${row.triggerAction}`)}</TableCell>
                <TableCell>{row.salesChannelCode ?? t('customEvents.allChannels')}</TableCell>
                <TableCell>
                  <Badge variant={row.enabled ? 'default' : 'secondary'}>
                    {row.enabled ? '✓' : '—'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  {t('customEvents.empty')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
