import { useCallback, useState, type ReactNode } from 'react';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  FulfilmentStrategyPicker,
  type FulfilmentStrategyValue,
  type FulfilmentWarehouseOption,
} from '@endora-commerce/admin-kit/components';

/**
 * Organization-level fulfilment-strategy override (precedence: Product →
 * Organization → Sales Channel → platform default). Self-contained draft +
 * Save; persistence is delegated to `onSave` so the parent owns the PATCH and
 * its optimistic-lock token. Remount (via `key`) to reset the draft after a
 * successful refresh.
 */
export interface FulfilmentStrategyPanelProps {
  initial: FulfilmentStrategyValue;
  warehouses: FulfilmentWarehouseOption[];
  onSave: (value: FulfilmentStrategyValue) => Promise<void>;
}

export function FulfilmentStrategyPanel({
  initial,
  warehouses,
  onSave,
}: FulfilmentStrategyPanelProps): ReactNode {
  const t = useTranslation('core');
  const [value, setValue] = useState<FulfilmentStrategyValue>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onSave({
        strategy: value.strategy,
        warehouseOrder: value.strategy === 'defined_order' ? value.warehouseOrder : [],
      });
    } catch {
      setError(t('fulfilment.saveError'));
    } finally {
      setBusy(false);
    }
  }, [onSave, value, t]);

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('fulfilment.orgTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <FulfilmentStrategyPicker
          value={value}
          onChange={setValue}
          warehouses={warehouses}
          allowInherit
          disabled={busy}
          idPrefix="org-fulfilment"
        />
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button size="sm" disabled={busy} onClick={(): void => void handleSave()}>
          {busy ? t('fulfilment.saving') : t('fulfilment.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
