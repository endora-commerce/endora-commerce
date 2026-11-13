import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Label, Textarea } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** The longest reason the reject endpoint accepts (`adminRejectRequestSchema`). */
export const REJECTION_REASON_MAX = 2000;

export type RejectionReasonError = 'reasonMissing' | 'reasonTooLong';

/** Why a typed reason cannot be sent, or `null` when it can. Judged on the trimmed text. */
export function rejectionReasonError(reason: string): RejectionReasonError | null {
  const trimmed = reason.trim();
  if (trimmed === '') return 'reasonMissing';
  if (trimmed.length > REJECTION_REASON_MAX) return 'reasonTooLong';
  return null;
}

/**
 * Asks for the reason a return or complaint is rejected (issue #311), in place
 * of the browser's `window.prompt()`: a required, multi-line reason judged
 * inline — empty, whitespace-only and over-long are refused before anything is
 * sent — and a destructive *Reject* that stays busy while the request runs. An
 * error from the server is shown in the dialog with the reason kept, so the
 * operator can correct it. A press on the scrim does not close it, so a stray
 * click does not throw a typed reason away; Escape and *Cancel* do.
 */
export function RejectReturnDialog(props: {
  /** Sends the trimmed reason; a rejection keeps the dialog open with its message. */
  onReject: (reason: string) => Promise<void>;
  onClose: () => void;
  /** Where focus goes when the dialog closes — the *Reject* button that opened it. */
  returnFocusRef: RefObject<HTMLElement | null>;
}): ReactNode {
  const { onReject, onClose, returnFocusRef } = props;
  const t = useTranslation('returns');
  const tc = useTranslation('core');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<RejectionReasonError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const explanationId = useId();
  const hintId = useId();
  const fieldErrorId = useId();
  const errorId = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const submit = async (): Promise<void> => {
    if (busy) return;
    const problem = rejectionReasonError(reason);
    setFieldError(problem);
    if (problem) {
      reasonRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onReject(reason.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tc('returns.detail.actionFailed'));
      setBusy(false);
    }
  };

  const reasonDescription = fieldError ? `${hintId} ${fieldErrorId}` : hintId;

  return (
    <ModalDialog
      title={t('reject.dialogTitle')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      initialFocusRef={reasonRef}
      finalFocusRef={returnFocusRef}
      aria-describedby={error ? `${explanationId} ${errorId}` : explanationId}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t('reject.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void submit()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : null}
            {t('reject.confirm')}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p id={explanationId} className="text-sm text-muted-foreground">
          {t('reject.explanation')}
        </p>
        {error && (
          <Alert variant="destructive" id={errorId}>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1">
          <Label htmlFor="return-rejection-reason">{t('reject.reason')}</Label>
          <Textarea
            id="return-rejection-reason"
            ref={reasonRef}
            required
            rows={4}
            maxLength={REJECTION_REASON_MAX}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={reasonDescription}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (fieldError && rejectionReasonError(e.target.value) === null) setFieldError(null);
            }}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            {t('reject.reasonHint', { max: REJECTION_REASON_MAX })}
          </p>
          {fieldError && (
            <p id={fieldErrorId} className="text-xs text-destructive">
              {t(`reject.error.${fieldError}`, { max: REJECTION_REASON_MAX })}
            </p>
          )}
        </div>
      </form>
    </ModalDialog>
  );
}
