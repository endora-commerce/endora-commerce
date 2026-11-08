import { useId, useRef, useState, type ReactNode } from 'react';
import { ApiError, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { AlternativeResolution, ReturnCaseDetail } from '@endora-commerce/contracts';
import { returnsClient } from '../api/returns-client.js';
import { ResolutionRadioGroup } from '../components/ResolutionRadioGroup.js';

/** The id of the panel, which the settlement form's hint moves focus to. */
export const CONSUMER_WITHDRAWAL_PANEL_ID = 'consumer-withdrawal';

const RESOLUTIONS: readonly AlternativeResolution[] = ['credit', 'replacement', 'repair'];
const NOTE_MAX = 2000;

/** `YYYY-MM-DDTHH:mm` in the browser's zone, the value a `datetime-local` input holds. */
export function localDateTimeValue(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** The browser's IANA zone, the one a `datetime-local` value is read in. */
function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export type ConsentField = 'resolution' | 'givenAt' | 'note';
export type ConsentFieldError = 'resolution' | 'givenAtMissing' | 'givenAtFuture' | 'givenAtBeforeFiled' | 'note';
export type ConsentFormErrors = Partial<Record<ConsentField, ConsentFieldError>>;

/**
 * What stops the consent dialog from saving, field by field. Checked on submit,
 * rather than through a Save button that stays disabled without saying why.
 * The date rules mirror the server's (`consentDateRefusal`), so the operator
 * meets them beside the field instead of in a `422` after the round trip.
 */
export function consentFormErrors(input: {
  resolution: AlternativeResolution | null;
  givenAt: string;
  note: string;
  submittedAt: string;
  now: Date;
}): ConsentFormErrors {
  const errors: ConsentFormErrors = {};
  if (input.resolution === null) errors.resolution = 'resolution';
  const givenAt = input.givenAt ? new Date(input.givenAt) : null;
  if (!givenAt || Number.isNaN(givenAt.getTime())) errors.givenAt = 'givenAtMissing';
  else if (givenAt.getTime() > input.now.getTime()) errors.givenAt = 'givenAtFuture';
  else if (givenAt.getTime() < new Date(input.submittedAt).getTime()) errors.givenAt = 'givenAtBeforeFiled';
  if (input.note.trim().length === 0) errors.note = 'note';
  return errors;
}

function withoutError(errors: ConsentFormErrors, field: ConsentField): ConsentFormErrors {
  const next = { ...errors };
  delete next[field];
  return next;
}

function joinIds(...ids: Array<string | false>): string | undefined {
  const list = ids.filter((id): id is string => typeof id === 'string');
  return list.length > 0 ? list.join(' ') : undefined;
}

/**
 * The consumer-withdrawal panel of a case (issue #905, design D1, §6): says
 * that the case settles as a refund, shows the consumer's consent to another
 * resolution when one is on record, and records, changes or revokes it.
 * Rendered only for a case classified as a consumer withdrawal. A settled
 * case's consent is frozen, so the actions go.
 */
export function ConsumerWithdrawalPanel(props: {
  rc: ReturnCaseDetail;
  onChanged: (message: string) => Promise<void>;
}): ReactNode {
  const { rc, onChanged } = props;
  const t = useTranslation('returns');
  const tc = useTranslation('core');
  const [dialog, setDialog] = useState<'record' | 'revoke' | null>(null);
  const consent = rc.alternativeResolutionConsent;
  const settled = rc.resolutionType !== null;
  const resolutionLabel = (resolution: string): string => tc(`returns.detail.resolution.${resolution}`);

  return (
    <Card id={CONSUMER_WITHDRAWAL_PANEL_ID} tabIndex={-1} className="scroll-mt-4 focus:outline-none">
      <CardHeader>
        <CardTitle>{t('consent.panelTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('consent.explanation')}</p>
        {consent ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">{t('consent.resolution')}</dt>
            <dd>{resolutionLabel(consent.resolution)}</dd>
            <dt className="text-muted-foreground">{t('consent.givenAt')}</dt>
            <dd>{formatDateTime(consent.at)}</dd>
            {consent.note ? (
              <>
                <dt className="text-muted-foreground">{t('consent.evidence')}</dt>
                <dd className="whitespace-pre-line break-words">{consent.note}</dd>
              </>
            ) : null}
          </dl>
        ) : (
          <p>{t('consent.none')}</p>
        )}
        {settled ? (
          <p className="text-muted-foreground">{t('consent.frozen')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setDialog('record')}>
              {consent ? t('consent.change') : t('consent.record')}
            </Button>
            {consent && (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => setDialog('revoke')}
              >
                {t('consent.revoke')}
              </Button>
            )}
          </div>
        )}
        {dialog === 'record' && (
          <RecordConsentDialog
            caseId={rc.id}
            submittedAt={rc.submittedAt}
            replacing={consent !== null}
            initialResolution={consent?.resolution ?? null}
            resolutionLabel={resolutionLabel}
            onClose={() => setDialog(null)}
            onSaved={async () => {
              setDialog(null);
              await onChanged(t('consent.recordedInfo'));
            }}
          />
        )}
        {dialog === 'revoke' && (
          <RevokeConsentDialog
            caseId={rc.id}
            onClose={() => setDialog(null)}
            onRevoked={async () => {
              setDialog(null);
              await onChanged(t('consent.revokedInfo'));
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Revoking deletes the consent and its evidence note, and the audit entry does
 * not keep the note, so it asks first; the safe answer has the focus.
 */
function RevokeConsentDialog(props: {
  caseId: string;
  onClose: () => void;
  onRevoked: () => Promise<void>;
}): ReactNode {
  const { caseId, onClose, onRevoked } = props;
  const t = useTranslation('returns');
  const tc = useTranslation('core');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explanationId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  const revoke = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await returnsClient.revokeAlternativeConsent(caseId);
      await onRevoked();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tc('returns.detail.actionFailed'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('consent.revokeTitle')}
      onClose={onClose}
      busy={busy}
      initialFocusRef={cancelRef}
      aria-describedby={explanationId}
      footer={
        <>
          <Button ref={cancelRef} variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t('consent.cancel')}
          </Button>
          <Button variant="destructive" size="sm" onClick={() => void revoke()} disabled={busy} aria-busy={busy}>
            {t('consent.revoke')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p id={explanationId}>{t('consent.revokeExplanation')}</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </ModalDialog>
  );
}

function RecordConsentDialog(props: {
  caseId: string;
  submittedAt: string;
  replacing: boolean;
  initialResolution: AlternativeResolution | null;
  resolutionLabel: (resolution: string) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { caseId, submittedAt, replacing, initialResolution, resolutionLabel, onClose, onSaved } = props;
  const t = useTranslation('returns');
  const tc = useTranslation('core');
  // A new consent has no resolution preselected: what the consumer agreed to
  // is a fact the operator states, not a default the form offers.
  const [resolution, setResolution] = useState<AlternativeResolution | null>(initialResolution);
  const [givenAt, setGivenAt] = useState(() => localDateTimeValue(new Date()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ConsentFormErrors>({});
  const introId = useId();
  const errorId = useId();
  const resolutionErrorId = useId();
  const givenAtHintId = useId();
  const givenAtErrorId = useId();
  const noteHintId = useId();
  const noteErrorId = useId();
  const resolutionRef = useRef<HTMLInputElement>(null);
  const givenAtRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const save = async (): Promise<void> => {
    const errors = consentFormErrors({ resolution, givenAt, note, submittedAt, now: new Date() });
    setFieldErrors(errors);
    if (errors.resolution || resolution === null) {
      resolutionRef.current?.focus();
      return;
    }
    if (errors.givenAt) {
      givenAtRef.current?.focus();
      return;
    }
    if (errors.note) {
      noteRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await returnsClient.recordAlternativeConsent(caseId, {
        resolution,
        consentGivenAt: new Date(givenAt).toISOString(),
        note: note.trim(),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tc('returns.detail.actionFailed'));
      setBusy(false);
    }
  };

  const dialogDescription = joinIds(introId, !!error && errorId);
  const resolutionDescription = fieldErrors.resolution ? resolutionErrorId : undefined;
  const givenAtDescription = joinIds(givenAtHintId, !!fieldErrors.givenAt && givenAtErrorId);
  const noteDescription = joinIds(noteHintId, !!fieldErrors.note && noteErrorId);

  return (
    <ModalDialog
      title={replacing ? t('consent.changeDialogTitle') : t('consent.dialogTitle')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      initialFocusRef={resolutionRef}
      {...(dialogDescription ? { 'aria-describedby': dialogDescription } : {})}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t('consent.cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy} aria-busy={busy}>
            {t('consent.save')}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p id={introId} className="text-sm text-muted-foreground">
          {replacing ? t('consent.replaceIntro') : t('consent.allRequired')}
        </p>
        {error && (
          <Alert variant="destructive" id={errorId}>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1">
          <ResolutionRadioGroup
            name="consent-resolution"
            legend={t('consent.resolution')}
            options={RESOLUTIONS}
            value={resolution}
            onChange={(next) => {
              setResolution(next);
              setFieldErrors((prev) => withoutError(prev, 'resolution'));
            }}
            label={resolutionLabel}
            required
            invalid={!!fieldErrors.resolution}
            focusRef={resolutionRef}
            {...(resolutionDescription ? { describedBy: resolutionDescription } : {})}
          />
          {fieldErrors.resolution && (
            <p id={resolutionErrorId} className="text-xs text-destructive">
              {t('consent.error.resolution')}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="consent-given-at">{t('consent.givenAt')}</Label>
          <Input
            id="consent-given-at"
            ref={givenAtRef}
            type="datetime-local"
            required
            aria-invalid={fieldErrors.givenAt ? true : undefined}
            aria-describedby={givenAtDescription}
            value={givenAt}
            min={localDateTimeValue(new Date(submittedAt))}
            max={localDateTimeValue(new Date())}
            onChange={(e) => {
              setGivenAt(e.target.value);
              setFieldErrors((prev) => withoutError(prev, 'givenAt'));
            }}
          />
          <p id={givenAtHintId} className="text-xs text-muted-foreground">
            {t('consent.givenAtHint', { zone: browserTimeZone() })}
          </p>
          {fieldErrors.givenAt && (
            <p id={givenAtErrorId} className="text-xs text-destructive">
              {t(`consent.error.${fieldErrors.givenAt}`)}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="consent-note">{t('consent.note')}</Label>
          <Textarea
            id="consent-note"
            ref={noteRef}
            required
            maxLength={NOTE_MAX}
            aria-invalid={fieldErrors.note ? true : undefined}
            aria-describedby={noteDescription}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (e.target.value.trim()) setFieldErrors((prev) => withoutError(prev, 'note'));
            }}
          />
          <p id={noteHintId} className="text-xs text-muted-foreground">
            {t('consent.noteHint')}
          </p>
          {fieldErrors.note && (
            <p id={noteErrorId} className="text-xs text-destructive">
              {t('consent.error.note')}
            </p>
          )}
        </div>
      </form>
    </ModalDialog>
  );
}
