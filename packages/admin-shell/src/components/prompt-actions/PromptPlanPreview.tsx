import type { ReactNode } from 'react';
import type { PromptActionPlan } from '@endora-commerce/contracts';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Confirmable plan card (feature 043, US1/US2 — FR-004).
 *
 * Net-new primitive, justified in plan.md (Principle IX): no existing Admin
 * UI component renders a pre-execution diff/confirmation card inside the
 * command palette without breaking its keyboard model. Everything shown here
 * is SERVER-COMPUTED (headline, current values, affected counts, samples) —
 * model prose never reaches this card (research §R8).
 */

interface Props {
  plan: PromptActionPlan;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PromptPlanPreview({ plan, busy, onConfirm, onCancel }: Props): ReactNode {
  const t = useTranslation('prompt_actions');
  return (
    <div data-testid="prompt-plan-preview" className="px-4 py-3">
      <div className="mb-2 text-xs text-muted-foreground">
        {t('panel.planHeading')}
      </div>
      <div className="flex flex-col gap-2.5">
        {plan.operations.map((op, i) => (
          <div key={`${op.toolId}-${i}`} className="rounded-lg border px-3 py-2.5">
            <div className="text-sm font-semibold">{op.preview.headline}</div>
            {op.preview.current !== undefined ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {t('panel.currentValue')}{' '}
                <code className="font-mono text-xs">{JSON.stringify(op.preview.current)}</code>
              </div>
            ) : null}
            {op.preview.affectedCount > 1 ? (
              <div className="mt-1 text-xs">
                {t('panel.affectedCount', { count: op.preview.affectedCount })}
              </div>
            ) : null}
            {op.preview.sample && op.preview.sample.length > 0 ? (
              <div className="mt-1.5 text-xs text-muted-foreground">
                <div>{t('panel.sampleHeading')}</div>
                <ul className="ml-4 mt-1 list-disc">
                  {op.preview.sample.map((s) => (
                    <li key={s.id}>{s.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-2.5 text-xs text-muted-foreground">
        {t('panel.expiresHint')}
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" onClick={onConfirm} disabled={busy}>
          {t('panel.confirm')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t('panel.cancel')}
        </Button>
      </div>
    </div>
  );
}
