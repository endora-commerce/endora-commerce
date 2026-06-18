import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import { promotionsClient, type GenerateBatchRequest } from './client';

/**
 * Feature 045 (US4) — bulk coupon generator form. Emits a batch and reports
 * how many codes were created, with a CSV export link.
 */
export function CouponGeneratorForm({
  promotionId,
  onGenerated,
}: {
  promotionId: string;
  onGenerated: () => void;
}): ReactNode {
  const t = useTranslation('core');
  const [req, setReq] = useState<GenerateBatchRequest>({
    count: 100,
    length: 8,
    format: 'alnum',
    prefix: '',
    suffix: '',
    dashEvery: 0,
    limitScope: 'per_coupon',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastBatchId, setLastBatchId] = useState<string | null>(null);

  const set = <K extends keyof GenerateBatchRequest>(k: K, v: GenerateBatchRequest[K]): void =>
    setReq((r) => ({ ...r, [k]: v }));

  const generate = async (): Promise<void> => {
    setErr(null);
    setBusy(true);
    try {
      const res = await promotionsClient.generateBatch(promotionId, {
        ...req,
        prefix: req.prefix?.trim() || null,
        suffix: req.suffix?.trim() || null,
      });
      setLastBatchId(res.batch.id);
      onGenerated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.envelope.error.message : t('promotions.error.save'));
    } finally {
      setBusy(false);
    }
  };

  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001';

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line p-3">
      <p className="text-sm font-medium">{t('promotions.generator.title')}</p>
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t('promotions.generator.count')}>
          <Input type="number" value={req.count} onChange={(e) => set('count', Number(e.target.value) || 0)} />
        </Field>
        <Field label={t('promotions.generator.length')}>
          <Input type="number" value={req.length} onChange={(e) => set('length', Number(e.target.value) || 0)} />
        </Field>
        <Field label={t('promotions.generator.format')}>
          <Select value={req.format} onChange={(e) => set('format', e.target.value as GenerateBatchRequest['format'])}>
            <option value="alnum">alphanumeric</option>
            <option value="digits">digits</option>
            <option value="letters">letters</option>
          </Select>
        </Field>
        <Field label={t('promotions.generator.prefix')}>
          <Input value={req.prefix ?? ''} onChange={(e) => set('prefix', e.target.value)} />
        </Field>
        <Field label={t('promotions.generator.suffix')}>
          <Input value={req.suffix ?? ''} onChange={(e) => set('suffix', e.target.value)} />
        </Field>
        <Field label={t('promotions.generator.dashEvery')}>
          <Input type="number" value={req.dashEvery ?? 0} onChange={(e) => set('dashEvery', Number(e.target.value) || 0)} />
        </Field>
        <Field label={t('promotions.generator.limitScope')}>
          <Select
            value={req.limitScope}
            onChange={(e) => set('limitScope', e.target.value as GenerateBatchRequest['limitScope'])}
          >
            <option value="per_coupon">per coupon</option>
            <option value="shared_batch">shared across batch</option>
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" disabled={busy} onClick={() => void generate()}>
          {t('promotions.generator.generate')}
        </Button>
        {lastBatchId ? (
          <a
            className="text-sm underline"
            href={`${apiBase}/api/v1/admin/promotions/${promotionId}/coupon-batches/${lastBatchId}/export`}
          >
            {t('promotions.generator.export')}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
