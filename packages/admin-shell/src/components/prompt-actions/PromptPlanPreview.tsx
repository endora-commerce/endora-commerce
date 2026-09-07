import type { ReactNode } from 'react';
import type { PromptActionPlan } from '@endora-commerce/contracts';
import { Button } from '../ui/button.js';
import { useTranslation } from '../../i18n/useTranslation.js';

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
    <div data-testid="prompt-plan-preview" style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 8 }}>
        {t('panel.planHeading')}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {plan.operations.map((op, i) => (
          <div
            key={`${op.toolId}-${i}`}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '10px 12px',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>{op.preview.headline}</div>
            {op.preview.current !== undefined ? (
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
                {t('panel.currentValue')}{' '}
                <code style={{ fontSize: 11 }}>{JSON.stringify(op.preview.current)}</code>
              </div>
            ) : null}
            {op.preview.affectedCount > 1 ? (
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {t('panel.affectedCount', { count: op.preview.affectedCount })}
              </div>
            ) : null}
            {op.preview.sample && op.preview.sample.length > 0 ? (
              <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 6 }}>
                <div>{t('panel.sampleHeading')}</div>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {op.preview.sample.map((s) => (
                    <li key={s.id}>{s.label}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 10 }}>
        {t('panel.expiresHint')}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
