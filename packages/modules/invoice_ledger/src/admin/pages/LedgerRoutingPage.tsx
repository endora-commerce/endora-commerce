import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type {
  InvoiceLedgerKsefRouting,
  InvoiceLedgerNumberingMode,
  InvoiceLedgerRoutingDto,
} from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { invoiceLedgerAdminClient } from '../api/ledger-client.js';

export function LedgerRoutingPage(): ReactNode {
  const t = useTranslation('invoice_ledger');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('invoice_ledger:write');
  const [routing, setRouting] = useState<InvoiceLedgerRoutingDto | null>(null);
  const [numberingMode, setNumberingMode] = useState<InvoiceLedgerNumberingMode>('endora');
  const [ksefRouting, setKsefRouting] = useState<InvoiceLedgerKsefRouting>('native');
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const apply = useCallback((next: InvoiceLedgerRoutingDto): void => {
    setRouting(next);
    setNumberingMode(next.numberingMode);
    setKsefRouting(next.ksefRouting);
    setConfirm(false);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      apply(await invoiceLedgerAdminClient.getRouting());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.load'));
    } finally {
      setLoading(false);
    }
  }, [apply, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (): Promise<void> => {
    setError(null);
    setInfo(null);
    setSaving(true);
    try {
      apply(
        await invoiceLedgerAdminClient.saveRouting({
          numberingMode,
          ksefRouting,
          ...(numberingMode !== routing?.numberingMode ? { confirm } : {}),
        }),
      );
      setInfo(t('routing.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.save'));
    } finally {
      setSaving(false);
    }
  };

  if (loading && !routing) {
    return <PageHeader title={t('routing.page.title')} description={t('routing.page.subtitle')} />;
  }

  return (
    <>
      <PageHeader title={t('routing.page.title')} description={t('routing.page.subtitle')} />
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t('routing.form.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ledger-numbering-mode">{t('routing.numberingMode')}</Label>
            <Select
              id="ledger-numbering-mode"
              value={numberingMode}
              disabled={!canWrite}
              onChange={(e) => setNumberingMode(e.target.value as InvoiceLedgerNumberingMode)}
            >
              <option value="endora">{t('routing.numberingMode.endora')}</option>
              <option value="vendor">{t('routing.numberingMode.vendor')}</option>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ledger-ksef-routing">{t('routing.ksefRouting')}</Label>
            <Select
              id="ledger-ksef-routing"
              value={ksefRouting}
              disabled={!canWrite}
              onChange={(e) => setKsefRouting(e.target.value as InvoiceLedgerKsefRouting)}
            >
              <option value="native">{t('routing.ksefRouting.native')}</option>
              <option value="vendor">{t('routing.ksefRouting.vendor')}</option>
            </Select>
          </div>
          {numberingMode !== routing?.numberingMode ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="ledger-numbering-confirm"
                checked={confirm}
                disabled={!canWrite}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              <Label htmlFor="ledger-numbering-confirm">{t('routing.confirm')}</Label>
            </div>
          ) : null}
          {canWrite ? (
            <Button type="button" onClick={() => void save()} disabled={saving}>
              {t('routing.save')}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

export default LedgerRoutingPage;
