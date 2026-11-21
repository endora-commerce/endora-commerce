import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import type { PromptActionRequestDto, ResultOperation } from '@endora-commerce/contracts';
import { Button, Input } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { markPromptRequestSeen } from '../../lib/prompt-actions/api.js';
import { usePromptRequest } from '../../lib/prompt-actions/usePromptRequest.js';
import { PromptPlanPreview } from './PromptPlanPreview.js';
import { SpeechToTextButton } from '../SpeechToTextButton.js';

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
      <div data-testid="prompt-result-summary" className="mt-2 text-xs">
        <span>{t('panel.resultSucceeded', { count: succeeded })}</span>
        {failed > 0 ? (
          <>
            <span> · </span>
            <span>{t('panel.resultFailed', { count: failed })}</span>
            <ul className="ml-4 mt-1.5 list-disc text-muted-foreground">
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
        <Sparkles size={18} className="text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          data-testid="prompt-input"
          aria-label={t('panel.inputLabel')}
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
        <div className="flex gap-2 px-4 py-2.5">
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

      {/* Mounted empty before the work starts, so the busy line is announced
          when it arrives (WCAG 2.2 SC 4.1.3, #1465). */}
      <div role="status" aria-live="polite">
        {busy ? (
          <div data-testid="prompt-busy" className="flex items-center gap-2 px-4 py-3.5 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            {phase === 'interpreting' ? t('panel.interpreting') : t('panel.executing')}
          </div>
        ) : null}
      </div>

      {phase === 'awaiting_confirmation' && request?.plan ? (
        <PromptPlanPreview
          plan={request.plan}
          busy={false}
          onConfirm={(): void => void confirm()}
          onCancel={handleCancelPlan}
        />
      ) : null}

      {phase === 'needs_clarification' && request?.clarification ? (
        <div data-testid="prompt-clarification" className="px-4 py-3">
          <div className="mb-1.5 text-xs text-muted-foreground">
            {t('panel.clarificationHeading')}
          </div>
          <div className="mb-2 text-sm font-semibold">
            {request.clarification.question}
          </div>
          {request.clarification.kind === 'entity_choice' &&
          (request.clarification.candidates?.length ?? 0) > 0 ? (
            <div className="flex flex-col gap-1">
              {request.clarification.candidates!.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="b2b-palette__item w-full text-left"
                  onClick={(): void => void clarify({ selectedCandidateId: c.id })}
                >
                  <div>
                    <div>{c.label}</div>
                    {c.hint ? (
                      <div className="text-xs text-muted-foreground">{c.hint}</div>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                data-testid="prompt-clarification-text"
                aria-label={request.clarification.question}
                className="h-8 flex-1"
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
          <div className="mt-2.5">
            <Button type="button" size="sm" variant="ghost" onClick={handleCancelPlan}>
              {t('panel.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <div data-testid="prompt-message" className="px-4 py-3 text-sm">
          <div>{t(message)}</div>
          {request?.error && (request.status === 'unsupported' || request.status === 'failed') ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {request.error}
            </div>
          ) : null}
          {resultSummary()}
          <div className="mt-2.5 flex gap-2">
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
            >
              {t('panel.close')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
