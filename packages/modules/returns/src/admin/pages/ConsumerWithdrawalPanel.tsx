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
  Select,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import type { AlternativeResolution, ReturnCaseDetail } from '@endora-commerce/contracts';
import { returnsClient } from '../api/returns-client.js';

/** The anchor the settlement form's hint links to. */
export const CONSUMER_WITHDRAWAL_PANEL_ID = 'consumer-withdrawal';

const RESOLUTIONS: readonly AlternativeResolution[] = ['credit', 'replacement', 'repair'];
const NOTE_MAX = 2000;

/** `YYYY-MM-DDTHH:mm` in the browser's zone, the value a `datetime-local` input holds. */
function localDateTimeValue(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * The consumer-withdrawal panel of a case (issue #905, design D1, §6): says
 * that the case settles as a refund, shows the consumer's consent to another
 * resolution when one is on record, and records or revokes it. Rendered only
 * for a case classified as a consumer withdrawal. A settled case's consent is
 * frozen, so the actions go.
 */
export function ConsumerWithdrawalPanel(props: {
  rc: ReturnCaseDetail;
  onChanged: (message: string) => Promise<void>;
}): ReactNode {
  const { rc, onChanged } = props;
  const t = useTranslation('returns');
  const tc = useTranslation('core');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const consent = rc.alternativeResolutionConsent;
  const settled = rc.resolutionType !== null;
  const resolutionLabel = (resolution: string): string => tc(`returns.detail.resolution.${resolution}`);

  const revoke = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await returnsClient.revokeAlternativeConsent(rc.id);
      await onChanged(t('consent.revokedInfo'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tc('returns.detail.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id={CONSUMER_WITHDRAWAL_PANEL_ID}>
      <CardHeader>
        <CardTitle>{t('consent.panelTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{t('consent.explanation')}</p>
        {consent ? (
          <div className="space-y-1">
            <p>{t('consent.recorded', { resolution: resolutionLabel(consent.resolution), date: formatDateTime(consent.at) })}</p>
            {consent.note ? (
              <p>
                <span className="font-medium">{t('consent.evidence')}: </span>
                <span>{consent.note}</span>
              </p>
            ) : null}
          </div>
        ) : (
          <p>{t('consent.none')}</p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {settled ? (
          <p className="text-muted-foreground">{t('consent.frozen')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={busy}>
              {t('consent.record')}
            </Button>
            {consent && (
              <Button size="sm" variant="ghost" onClick={() => void revoke()} disabled={busy}>
                {t('consent.revoke')}
              </Button>
            )}
          </div>
        )}
        {open && (
          <RecordConsentDialog
            caseId={rc.id}
            initialResolution={consent?.resolution ?? 'credit'}
            resolutionLabel={resolutionLabel}
            onClose={() => setOpen(false)}
            onSaved={async () => {
              setOpen(false);
              await onChanged(t('consent.recordedInfo'));
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RecordConsentDialog(props: {
  caseId: string;
  initialResolution: AlternativeResolution;
  resolutionLabel: (resolution: string) => string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}): ReactNode {
  const { caseId, initialResolution, resolutionLabel, onClose, onSaved } = props;
  const t = useTranslation('returns');
  const tc = useTranslation('core');
  const [resolution, setResolution] = useState<AlternativeResolution>(initialResolution);
  const [givenAt, setGivenAt] = useState(() => localDateTimeValue(new Date()));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteHintId = useId();
  const errorId = useId();
  const resolutionRef = useRef<HTMLSelectElement>(null);
  const givenAtDate = givenAt ? new Date(givenAt) : null;
  const canSave = note.trim().length > 0 && givenAtDate !== null && !Number.isNaN(givenAtDate.getTime()) && !busy;

  const save = async (): Promise<void> => {
    if (!canSave || !givenAtDate) return;
    setError(null);
    setBusy(true);
    try {
      await returnsClient.recordAlternativeConsent(caseId, {
        resolution,
        consentGivenAt: givenAtDate.toISOString(),
        note: note.trim(),
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tc('returns.detail.actionFailed'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('consent.dialogTitle')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      initialFocusRef={resolutionRef}
      {...(error ? { 'aria-describedby': errorId } : {})}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t('consent.cancel')}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!canSave}>
            {t('consent.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && (
          <Alert variant="destructive" id={errorId}>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-1">
          <Label htmlFor="consent-resolution">{t('consent.resolution')}</Label>
          <Select
            id="consent-resolution"
            ref={resolutionRef}
            value={resolution}
            onChange={(e) => setResolution(e.target.value as AlternativeResolution)}
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {resolutionLabel(r)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="consent-given-at">{t('consent.givenAt')}</Label>
          <Input
            id="consent-given-at"
            type="datetime-local"
            required
            value={givenAt}
            max={localDateTimeValue(new Date())}
            onChange={(e) => setGivenAt(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="consent-note">{t('consent.note')}</Label>
          <Textarea
            id="consent-note"
            required
            maxLength={NOTE_MAX}
            aria-describedby={noteHintId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p id={noteHintId} className="text-xs text-muted-foreground">
            {t('consent.noteHint')}
          </p>
        </div>
      </div>
    </ModalDialog>
  );
}
