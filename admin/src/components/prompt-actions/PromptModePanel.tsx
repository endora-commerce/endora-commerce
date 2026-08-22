import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { PromptActionRequestDto, ResultOperation } from '@endora-commerce/contracts';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n/useTranslation';
import { markPromptRequestSeen } from '@/lib/prompt-actions/api';
import { usePromptRequest } from '@/lib/prompt-actions/usePromptRequest';
import { PromptPlanPreview } from './PromptPlanPreview';
import { SpeechToTextButton } from '../SpeechToTextButton';

/**
 * The palette's prompt mode (feature 043, research §R9): input →
 * interpreting → plan preview / clarification / terminal message →
 * executing → result. Composed from existing primitives (Button, palette
 * styles); the only net-new visual primitive is PromptPlanPreview.
 *
 * Esc handling lives in the parent CommandPalette: in prompt mode it calls
 * `onExit` (back to classic search) instead of closing.
 */

interface Props {
  onExit: () => void;
  /** FR-018: a finished request opened from the completion notice. */
  initialRequest?: PromptActionRequestDto;
  /**
   * Pre-fills the prompt input — used when the operator opened prompt mode via
   * the `/ai <command>` palette shortcut so the typed command carries over.
   */
  initialPrompt?: string;
}

export function PromptModePanel({ onExit, initialRequest, initialPrompt }: Props): ReactNode {
  const t = useTranslation('prompt_actions');
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [freeText, setFreeText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { phase, request, errorCode, submit, clarify, confirm, cancel, reset, load } =
    usePromptRequest();

  useEffect(() => {
    if (!initialRequest) return;
    load(initialRequest);
    // Opening the outcome acknowledges the notice.
    void markPromptRequestSeen(initialRequest.id).catch(() => undefined);
  }, [initialRequest, load]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [phase]);

  const busy = phase === 'interpreting' || phase === 'executing';

  const handleCancelPlan = (): void => {
    // FR-004/US1-AC3: cancel returns to the input with the prompt preserved.
    void cancel();
  };

  const handleClose = (): void => {
    reset();
    onExit();
  };

  const terminalMessageKey = (): string | null => {
    if (phase === 'request_error') {
      if (errorCode === 'PROMPT_REQUEST_IN_FLIGHT') return 'panel.inFlight';
      if (errorCode === 'PROMPT_PLAN_EXPIRED') return 'panel.planExpired';
      if (errorCode === 'PROMPT_PERMISSION_REVOKED') return 'panel.refused';
      return 'panel.providerError';
    }
    if (phase !== 'finished' || !request) return null;
    switch (request.status) {
      case 'completed':
        return 'panel.success';
      case 'completed_with_errors':
        return 'panel.successWithErrors';
      case 'unsupported':
        return 'panel.unsupported';
      case 'refused':
        return 'panel.refused';
      case 'failed':
        return 'panel.failed';
      case 'cancelled':
        return null;
      case 'expired':
        return 'panel.planExpired';
      default:
        return null;
    }
  };

  const resultSummary = (): ReactNode => {
    const ops: ResultOperation[] = request?.result?.operations ?? [];
    if (ops.length === 0) return null;
    let succeeded = 0;
    let failed = 0;
    const failures: Array<{ key: string; message: string }> = [];
    for (const op of ops) {
      const sub = op.summary;
      if (sub) {
        succeeded += sub.succeeded;
        failed += sub.failed;
        for (const f of sub.failures ?? []) {
          failures.push({ key: `${op.toolId}-${f.id}`, message: `${f.label ?? f.id}: ${f.reason}` });
        }
      } else if (op.status === 'succeeded') {
        succeeded += 1;
      } else if (op.status === 'failed') {
        failed += 1;
        if (op.message) failures.push({ key: op.toolId, message: op.message });
      }
    }
    return (
      <div data-testid="prompt-result-summary" style={{ fontSize: 12, marginTop: 8 }}>
        <span>{t('panel.resultSucceeded', { count: succeeded })}</span>
        {failed > 0 ? (
          <>
            <span> · </span>
            <span>{t('panel.resultFailed', { count: failed })}</span>
            <ul style={{ margin: '6px 0 0 16px', color: 'var(--fg-muted)' }}>
              {failures.map((f) => (
                <li key={f.key}>{f.message}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    );
  };

  const message = terminalMessageKey();

  return (
    <div data-testid="prompt-mode-panel">
      <div className="b2b-palette__input">
        <Sparkles size={18} style={{ color: 'var(--fg-muted)' }} />
        <input
          ref={inputRef}
          data-testid="prompt-input"
          placeholder={t('panel.inputPlaceholder')}
          value={prompt}
          disabled={busy || phase === 'awaiting_confirmation'}
          onChange={(e): void => setPrompt(e.target.value)}
          onKeyDown={(e): void => {
            if (e.key === 'Enter' && prompt.trim() && phase === 'idle') {
              e.preventDefault();
              void submit(prompt.trim());
            }
          }}
        />
        {!busy && phase !== 'awaiting_confirmation' ? (
          <SpeechToTextButton
            startTitle={t('panel.voiceInput')}
            stopTitle={t('panel.voiceInputStop')}
            onTranscript={(text): void => {
              setPrompt((p) => (p ? `${p} ${text}` : text));
              inputRef.current?.focus();
            }}
          />
        ) : null}
        <span className="b2b-kbd-sm">esc</span>
      </div>

      {phase === 'idle' ? (
        <div style={{ display: 'flex', gap: 8, padding: '10px 16px' }}>
          <Button
            type="button"
            size="sm"
            disabled={!prompt.trim()}
            onClick={(): void => void submit(prompt.trim())}
          >
            {t('panel.submit')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={handleClose}>
            {t('panel.back')}
          </Button>
        </div>
      ) : null}

      {busy ? (
        <div
          data-testid="prompt-busy"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '14px 16px',
            fontSize: 13,
            color: 'var(--fg-muted)',
          }}
        >
          <Loader2 size={16} className="animate-spin" />
          {phase === 'interpreting' ? t('panel.interpreting') : t('panel.executing')}
        </div>
      ) : null}

      {phase === 'awaiting_confirmation' && request?.plan ? (
        <PromptPlanPreview
          plan={request.plan}
          busy={false}
          onConfirm={(): void => void confirm()}
          onCancel={handleCancelPlan}
        />
      ) : null}

      {phase === 'needs_clarification' && request?.clarification ? (
        <div data-testid="prompt-clarification" style={{ padding: '12px 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 6 }}>
            {t('panel.clarificationHeading')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {request.clarification.question}
          </div>
          {request.clarification.kind === 'entity_choice' &&
          (request.clarification.candidates?.length ?? 0) > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {request.clarification.candidates!.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="b2b-palette__item"
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={(): void => void clarify({ selectedCandidateId: c.id })}
                >
                  <div>
                    <div>{c.label}</div>
                    {c.hint ? (
                      <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{c.hint}</div>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                data-testid="prompt-clarification-text"
                className="b2b-input"
                style={{ flex: 1, fontSize: 13 }}
                placeholder={t('panel.clarificationFreeTextPlaceholder')}
                value={freeText}
                onChange={(e): void => setFreeText(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                disabled={!freeText.trim()}
                onClick={(): void => void clarify({ text: freeText.trim() })}
              >
                {t('panel.clarificationSubmit')}
              </Button>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <Button type="button" size="sm" variant="ghost" onClick={handleCancelPlan}>
              {t('panel.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <div data-testid="prompt-message" style={{ padding: '12px 16px', fontSize: 13 }}>
          <div>{t(message)}</div>
          {request?.error && (request.status === 'unsupported' || request.status === 'failed') ? (
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
              {request.error}
            </div>
          ) : null}
          {resultSummary()}
          <div style={{ marginTop: 10 }}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={(): void => {
                reset();
                setPrompt('');
              }}
            >
              {t('panel.back')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleClose}
              style={{ marginLeft: 8 }}
            >
              {t('panel.close')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
