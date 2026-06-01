import { useState, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';

interface StatusDef {
  code: string;
  name: Record<string, string>;
}

export interface BulkStatusSummary {
  changed: number;
  skipped: number;
}

interface Props {
  open: boolean;
  orderIds: string[];
  statuses: StatusDef[];
  onClose: () => void;
  onDone: (summary: BulkStatusSummary) => void;
}

/**
 * Feature 038 (US2) — bulk order status change. Applies the chosen target to
 * every selected order; the server moves only the eligible ones and reports
 * the rest as skipped (with reasons).
 */
export function OrdersBulkStatusDialog({ open, orderIds, statuses, onClose, onDone }: Props): ReactNode {
  const t = useTranslation('core');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const apply = async (): Promise<void> => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{
        data: { changed: string[]; skipped: Array<{ orderId: string; reason: string }> };
      }>('/api/v1/admin/orders/bulk/status', { orderIds, toStatusCode: target });
      onDone({ changed: res.data.changed.length, skipped: res.data.skipped.length });
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('orders.bulk.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">{t('orders.bulk.dialogTitle', { count: orderIds.length })}</h2>
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
        <div className="space-y-2">
          <Label htmlFor="bulk-target">{t('orders.bulk.targetStatus')}</Label>
          <Select id="bulk-target" value={target} onChange={(e): void => setTarget(e.target.value)}>
            <option value="">—</option>
            {statuses.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name['en'] ?? s.code}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.action.cancel')}
          </Button>
          <Button onClick={(): void => void apply()} disabled={!target || busy}>
            {t('orders.bulk.apply')}
          </Button>
        </div>
      </div>
    </div>
  );
}
