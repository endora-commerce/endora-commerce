import { useId, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

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
 *
 * The kit's `ModalDialog` since issue #1474 (SALES-09): named by its title,
 * focus held inside and returned to *Change status*, Escape to close, and
 * Escape and the scrim inert while the request runs. The form is mounted per
 * opening, so a status picked and abandoned is not still chosen next time.
 */
export function OrdersBulkStatusDialog(props: Props): ReactNode {
  return props.open ? <BulkStatusForm {...props} /> : null;
}

function BulkStatusForm({ orderIds, statuses, onClose, onDone }: Props): ReactNode {
  const t = useTranslation('core');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

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
    <ModalDialog
      title={t('orders.bulk.dialogTitle', { count: orderIds.length })}
      onClose={onClose}
      busy={busy}
      widthClassName="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.action.cancel')}
          </Button>
          <Button onClick={(): void => void apply()} disabled={!target || busy} aria-busy={busy}>
            {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {t('orders.bulk.apply')}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="bulk-target">{t('orders.bulk.targetStatus')}</Label>
        <Select
          id="bulk-target"
          value={target}
          disabled={busy}
          aria-describedby={errorId}
          onChange={(e): void => setTarget(e.target.value)}
        >
          <option value="">—</option>
          {statuses.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name['en'] ?? s.code}
            </option>
          ))}
        </Select>
        {/* Mounted before it has text, so a failure that arrives is announced. */}
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </div>
    </ModalDialog>
  );
}
