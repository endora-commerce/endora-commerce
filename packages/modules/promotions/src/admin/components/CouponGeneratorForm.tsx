import { useId, useState, type ReactNode } from 'react';
import { ApiError, apiBaseUrl } from '@endora-commerce/admin-kit/lib';
import { Button, EditorSection, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { promotionsClient, type GenerateBatchRequest } from '../api/promotions-client.js';

/**
 * Feature 045 (US4) — bulk coupon generator form. Emits a batch and reports
 * how many codes were created, with a CSV export link.
 *
 * Issue #1546 (SALES-23) — a section of the coupons card, not a bordered box inside it
 * (Common Region), and every label linked to its control.
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

  // `apiBaseUrl` is the kit's, published by feature 091 for exactly this: a
  // module package cannot read `import.meta.env` without acquiring
  // `vite/client` types and a second copy of the fallback. It is the identical
  // expression and the identical `http://localhost:3001` default this line
  // carried, read in one place instead of two.
  const apiBase = apiBaseUrl;

  return (
    <EditorSection as="h3" title={t('promotions.generator.title')} contentClassName="flex flex-col gap-3">
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t('promotions.generator.count')}>
          {(id) => (
            <Input id={id} type="number" value={req.count} onChange={(e) => set('count', Number(e.target.value) || 0)} />
          )}
        </Field>
        <Field label={t('promotions.generator.length')}>
          {(id) => (
            <Input id={id} type="number" value={req.length} onChange={(e) => set('length', Number(e.target.value) || 0)} />
          )}
        </Field>
        <Field label={t('promotions.generator.format')}>
          {(id) => (
            <Select id={id} value={req.format} onChange={(e) => set('format', e.target.value as GenerateBatchRequest['format'])}>
              <option value="alnum">{t('promotions.generator.formatAlnum')}</option>
              <option value="digits">{t('promotions.generator.formatDigits')}</option>
              <option value="letters">{t('promotions.generator.formatLetters')}</option>
            </Select>
          )}
        </Field>
        <Field label={t('promotions.generator.prefix')}>
          {(id) => (
            <Input id={id} value={req.prefix ?? ''} onChange={(e) => set('prefix', e.target.value)} />
          )}
        </Field>
        <Field label={t('promotions.generator.suffix')}>
          {(id) => (
            <Input id={id} value={req.suffix ?? ''} onChange={(e) => set('suffix', e.target.value)} />
          )}
        </Field>
        <Field label={t('promotions.generator.dashEvery')}>
          {(id) => (
            <Input id={id} type="number" value={req.dashEvery ?? 0} onChange={(e) => set('dashEvery', Number(e.target.value) || 0)} />
          )}
        </Field>
        <Field label={t('promotions.generator.limitScope')}>
          {(id) => (
            <Select
              id={id}
              value={req.limitScope}
              onChange={(e) => set('limitScope', e.target.value as GenerateBatchRequest['limitScope'])}
            >
              <option value="per_coupon">{t('promotions.generator.scopePerCoupon')}</option>
              <option value="shared_batch">{t('promotions.generator.scopeSharedBatch')}</option>
            </Select>
          )}
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" disabled={busy} onClick={() => void generate()}>
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
    </EditorSection>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
    </div>
  );
}
