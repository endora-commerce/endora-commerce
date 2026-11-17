import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Badge, type BadgeProps } from '../../ui/badge.js';
import { Button } from '../../ui/button.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { ModalDialog } from '../modal-dialog/ModalDialog.js';

/**
 * A status the operator may change, shown as a value and changed through a
 * dialog rather than a `<select>` that writes on `change` (issue #1435, DS-18).
 *
 * A select that commits on `change` moves an order to *Shipped* on a stray
 * arrow key, with the e-mails, stock and invoices that follow (WCAG 3.2.2 On
 * Input). Here the current value is a badge beside a "Change…" button. The
 * button opens a {@link ModalDialog} in two steps: **choose** — the allowed
 * targets as radio options, the current value never among them — and
 * **confirm** — the change named from → to, with the caller's consequence
 * sentence. Only the confirm step's button calls `onConfirm`.
 *
 * While `onConfirm` runs, the dialog is busy (Escape and the scrim inert, the
 * confirm button disabled with a spinner). A rejection keeps the dialog open on
 * the confirm step with the error announced, so the operator can retry or go
 * back. On success the dialog closes, focus returns to the "Change…" button and
 * the new value is announced in a polite live region.
 *
 * With nothing to change to, or with a `disabledReason` (e.g. a missing
 * permission), the button is disabled and the reason is shown and linked as its
 * description, rather than the control disappearing.
 */
export interface StatusChangeOption {
  value: string;
  label: string;
  /** A line under the option, e.g. what this status means. */
  description?: ReactNode;
}

export interface StatusChangeControlProps {
  /** The field's name, e.g. "Order status". Names the button and the radio group. */
  label: string;
  /** The dialog's title on the choose step, e.g. "Change order status". */
  dialogTitle: ReactNode;
  /** The current value; filtered out of `options` if present there. */
  current: string;
  currentLabel: string;
  /** The current value's badge colour, e.g. from `statusBadgeStyle`. */
  badgeStyle?: CSSProperties;
  badgeVariant?: BadgeProps['variant'];
  /** The values the current one may move to, in display order. */
  options: readonly StatusChangeOption[];
  /** Writes the change. Rejecting keeps the dialog open with the error. */
  onConfirm: (to: string) => Promise<void>;
  /** What the change sets in motion, shown on the confirm step. */
  consequence?: (to: string) => ReactNode;
  /** The error sentence for a rejection. Defaults to `common.statusChange.error`. */
  errorMessage?: (error: unknown) => ReactNode;
  /** When set the button is disabled and this explains why. */
  disabledReason?: ReactNode;
  className?: string;
}

type Step = 'choose' | 'confirm';

export function StatusChangeControl(props: StatusChangeControlProps): ReactNode {
  const {
    label,
    dialogTitle,
    current,
    currentLabel,
    badgeStyle,
    badgeVariant = 'secondary',
    options,
    onConfirm,
    consequence,
    errorMessage,
    disabledReason,
    className,
  } = props;
  const t = useTranslation('core');
  const labelId = useId();
  const buttonId = useId();
  const reasonId = useId();
  const groupName = useId();
  const summaryId = useId();
  const errorId = useId();
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const radioRefs = useRef(new Map<string, HTMLInputElement>());

  const targets = options.filter((option) => option.value !== current);
  const reason = disabledReason ?? (targets.length === 0 ? t('common.statusChange.noTransitions') : null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('choose');
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const [announcement, setAnnouncement] = useState('');

  const chosen = targets.find((option) => option.value === target) ?? null;

  const openDialog = (): void => {
    // Tesler: with one way to go, the system picks it; the confirm step still stands.
    setTarget(targets.length === 1 ? targets[0]!.value : null);
    setStep('choose');
    setError(null);
    setAnnouncement('');
    setOpen(true);
  };

  const close = (): void => {
    if (busy) return;
    setOpen(false);
  };

  // Each step change moves focus to what the step is about: the summary the
  // operator is confirming, or the option they came back to reconsider. Set by
  // the handler that changes the step, consumed once the step has rendered.
  const pendingFocus = useRef<'summary' | 'option' | null>(null);
  useEffect(() => {
    const next = pendingFocus.current;
    pendingFocus.current = null;
    if (next === 'summary') summaryRef.current?.focus();
    else if (next === 'option' && target) radioRefs.current.get(target)?.focus();
    // `target` is read, not watched: only a step change moves focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const onContinue = (event: FormEvent): void => {
    event.preventDefault();
    if (!chosen) return;
    setError(null);
    pendingFocus.current = 'summary';
    setStep('confirm');
  };

  const back = (): void => {
    pendingFocus.current = 'option';
    setStep('choose');
  };

  const apply = async (): Promise<void> => {
    if (!chosen || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(chosen.value);
      setBusy(false);
      setOpen(false);
      setAnnouncement(t('common.statusChange.changed', { field: label, status: chosen.label }));
    } catch (err) {
      setBusy(false);
      setError(errorMessage ? errorMessage(err) : t('common.statusChange.error'));
    }
  };

  const hasError = error !== null && error !== undefined && error !== false && error !== '';

  return (
    <div className={className}>
      <p id={labelId} className="text-sm font-medium leading-none">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant={badgeVariant} style={badgeStyle}>
          {currentLabel}
        </Badge>
        <Button
          id={buttonId}
          type="button"
          variant="outline"
          size="sm"
          aria-labelledby={`${buttonId} ${labelId}`}
          aria-describedby={reason ? reasonId : undefined}
          aria-haspopup="dialog"
          disabled={reason !== null}
          onClick={openDialog}
        >
          {t('common.statusChange.change')}
        </Button>
      </div>
      {reason ? (
        <p id={reasonId} className="mt-1 text-xs text-muted-foreground">
          {reason}
        </p>
      ) : null}
      {/* Mounted before it has text, so the change is announced (WCAG 4.1.3). */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {open
        ? createPortal(
            <ModalDialog
              title={step === 'choose' ? dialogTitle : t('common.statusChange.confirmTitle')}
              onClose={close}
              busy={busy}
              // A press beside the confirm step must not throw the choice away.
              dismissOnScrim={step === 'choose'}
              {...(step === 'confirm'
                ? { 'aria-describedby': hasError ? `${summaryId} ${errorId}` : summaryId }
                : {})}
              footer={
                step === 'choose' ? (
                  <>
                    <Button type="button" variant="outline" onClick={close}>
                      {t('common.action.cancel')}
                    </Button>
                    <Button type="submit" form={groupName} disabled={!chosen}>
                      {t('common.statusChange.continue')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={back} disabled={busy}>
                      {t('common.action.back')}
                    </Button>
                    <Button type="button" onClick={(): void => void apply()} disabled={busy} aria-busy={busy}>
                      {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : null}
                      {t('common.statusChange.confirm', { status: chosen?.label ?? '' })}
                    </Button>
                  </>
                )
              }
            >
              {step === 'choose' ? (
                <form id={groupName} onSubmit={onContinue} className="space-y-4 text-sm">
                  <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    {t('common.statusChange.current')}
                    <Badge variant={badgeVariant} style={badgeStyle}>
                      {currentLabel}
                    </Badge>
                  </p>
                  <fieldset>
                    <legend className="mb-2 font-medium">{t('common.statusChange.target')}</legend>
                    <div className="space-y-1">
                      {targets.map((option) => (
                        <label
                          key={option.value}
                          className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-transparent px-3 py-2 hover:bg-accent has-[:checked]:border-input has-[:checked]:bg-accent"
                        >
                          <input
                            ref={(node): void => {
                              if (node) radioRefs.current.set(option.value, node);
                              else radioRefs.current.delete(option.value);
                            }}
                            type="radio"
                            name={groupName}
                            value={option.value}
                            checked={target === option.value}
                            onChange={(): void => setTarget(option.value)}
                            className="mt-0.5 size-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          />
                          <span>
                            <span className="block font-medium">{option.label}</span>
                            {option.description ? (
                              <span className="block text-xs text-muted-foreground">{option.description}</span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </form>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
                    <Badge variant={badgeVariant} style={badgeStyle}>
                      {currentLabel}
                    </Badge>
                    <ArrowRight className="size-4 text-muted-foreground" />
                    <Badge variant="outline">{chosen?.label}</Badge>
                  </div>
                  <p id={summaryId} ref={summaryRef} tabIndex={-1} className="focus:outline-none">
                    {t('common.statusChange.summary', { field: label, from: currentLabel, to: chosen?.label ?? '' })}
                    {chosen && consequence ? <> {consequence(chosen.value)}</> : null}
                  </p>
                  {/* Mounted before it has text, so an error that arrives is announced. */}
                  <p id={errorId} role="alert" className="text-destructive">
                    {hasError ? error : null}
                  </p>
                </div>
              )}
            </ModalDialog>,
            document.body,
          )
        : null}
    </div>
  );
}
