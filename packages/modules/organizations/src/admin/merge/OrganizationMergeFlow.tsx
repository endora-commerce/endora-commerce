import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type {
  OrganizationMergeFieldCode,
  OrganizationMergePreview,
  OrganizationMergeView,
  RecordMergeChoice,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { OrganizationPicker } from '@endora-commerce/admin-kit/components';
import { Alert, AlertDescription, AlertTitle, Button, Checkbox, EditorSection, Label, Skeleton } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { organizationMergesApi } from './merge-api.js';
import { canStart, fieldValueText, incompleteModules, moduleName, noticeMessage, participantLabel, refusalMessage, totalMoving, type Translate } from './merge-view.js';

export interface OrganizationMergeFlowProps {
  /** The organization that stays. */
  readonly survivorId: string;
  readonly survivorName: string;
  readonly onCancel: () => void;
  /** The merge started; the caller opens its progress view. */
  readonly onStarted: (merge: OrganizationMergeView) => void;
}

type Step = 1 | 2 | 3;

type PreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly preview: OrganizationMergePreview };

/**
 * *Merge a duplicate into this organization* (`specs/192-organization-merge/`
 * FR-080; `contracts/organization-merge.md` §5) — the operator's flow, in three
 * steps shown as such from the start (Zeigarnik): choose the duplicate, review
 * what the preview says and choose the values to keep, then confirm.
 *
 * - The picker lists company organizations only (a personal one is never
 *   merged) and only those the operator reaches.
 * - The review shows every refusal in words, and while some module cannot move
 *   its records yet (`RECORD_MERGE_PARTICIPATION_INCOMPLETE`) a notice naming
 *   them — the flow goes no further, since the start would be refused.
 * - Each differing value is a choice between the two organizations, with the
 *   preview's default chosen (Choice Overload); what nobody chooses keeps the
 *   default.
 * - The start is the one primary action, enabled only once the operator ticks
 *   that a merge cannot be undone (FR-012); it shows that it is working
 *   (Doherty) and says why it failed in the server's words.
 */
export function OrganizationMergeFlow(props: OrganizationMergeFlowProps): ReactNode {
  const own = useTranslation('organizations');
  const { t } = useTranslationContext();
  const translate: Translate = t;
  const pickerId = useId();
  const [step, setStep] = useState<Step>(1);
  const [loserId, setLoserId] = useState<string | null>(null);
  const [loserName, setLoserName] = useState<string>('');
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' });
  const [fieldChoices, setFieldChoices] = useState<Record<string, RecordMergeChoice>>({});
  const [customFieldChoices, setCustomFieldChoices] = useState<Record<string, RecordMergeChoice>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const loadPreview = useCallback(async (id: string): Promise<void> => {
    setPreview({ kind: 'loading' });
    try {
      const answer = await organizationMergesApi.preview(props.survivorId, id);
      setFieldChoices(Object.fromEntries(answer.fields.map((f) => [f.code, f.default])));
      setCustomFieldChoices(Object.fromEntries(answer.customFields.map((f) => [f.key, f.default])));
      setPreview({ kind: 'ready', preview: answer });
    } catch (err) {
      setPreview({ kind: 'error', message: err instanceof ApiError ? err.envelope.error.message : own('merge.flow.previewError') });
    }
  }, [props.survivorId, own]);

  const review = (): void => {
    if (loserId === null) return;
    setStep(2);
    setAcknowledged(false);
    setStartError(null);
    void loadPreview(loserId);
    // The duplicate's name, for the sentences that follow; the preview carries values, not names.
    void apiClient
      .get<{ data?: { name?: string } }>(`/api/v1/admin/organizations/${loserId}`)
      .then((res) => setLoserName(typeof res.data?.name === 'string' ? res.data.name : ''))
      .catch(() => setLoserName(''));
  };

  const ready = preview.kind === 'ready' ? preview.preview : null;
  const startable = canStart(ready);

  const start = async (): Promise<void> => {
    if (loserId === null || !startable || !acknowledged) return;
    setStarting(true);
    setStartError(null);
    try {
      const merge = await organizationMergesApi.start(props.survivorId, {
        loserId,
        fieldChoices: fieldChoices as Partial<Record<OrganizationMergeFieldCode, RecordMergeChoice>>,
        customFieldChoices,
        acknowledgeIrreversible: true,
      });
      props.onStarted(merge);
    } catch (err) {
      setStartError(err instanceof ApiError ? err.envelope.error.message : own('merge.flow.startError'));
    } finally {
      setStarting(false);
    }
  };

  const stepClass = (n: Step): string => (step === n ? 'font-medium text-foreground' : 'text-muted-foreground');
  const duplicate = loserName.length > 0 ? loserName : own('merge.flow.theDuplicate');

  return (
    <div className="grid gap-4">
      <ol className="flex flex-wrap items-center gap-3 text-sm" aria-label={own('merge.flow.steps')}>
        {([1, 2, 3] as const).map((n, i) => (
          <li key={n} className={`flex items-center gap-3 ${stepClass(n)}`} aria-current={step === n ? 'step' : undefined}>
            {i > 0 ? <ArrowRight aria-hidden="true" className="size-3 text-muted-foreground" /> : null}
            {own(n === 1 ? 'merge.flow.step.choose' : n === 2 ? 'merge.flow.step.review' : 'merge.flow.step.confirm')}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="grid gap-4 md:max-w-md">
          <p className="text-sm text-muted-foreground">{own('merge.flow.intro', { survivor: props.survivorName })}</p>
          <div className="grid gap-1.5">
            <Label htmlFor={pickerId}>{own('merge.flow.picker')}</Label>
            <OrganizationPicker
              id={pickerId}
              ariaLabel={own('merge.flow.picker')}
              kind="company"
              value={loserId}
              onChange={(id): void => {
                setLoserId(id);
                setLoserName('');
              }}
              placeholder={own('merge.flow.pickerPlaceholder')}
              clearable
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={props.onCancel}>
              {t('core', 'common.action.cancel')}
            </Button>
            <Button type="button" disabled={loserId === null} onClick={review}>
              {own('merge.flow.next')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="grid gap-4" aria-busy={preview.kind === 'loading' ? true : undefined}>
          {preview.kind === 'loading' || preview.kind === 'idle' ? (
            <div className="grid gap-2" aria-label={own('merge.flow.loading')}>
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}
          {preview.kind === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                {preview.message}
                <Button type="button" variant="outline" size="sm" onClick={(): void => void (loserId && loadPreview(loserId))}>
                  {t('core', 'common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {ready !== null ? (
            <PreviewReview
              preview={ready}
              survivorName={props.survivorName}
              loserName={duplicate}
              fieldChoices={fieldChoices}
              customFieldChoices={customFieldChoices}
              onFieldChoice={(code, choice): void => setFieldChoices((c) => ({ ...c, [code]: choice }))}
              onCustomFieldChoice={(key, choice): void => setCustomFieldChoices((c) => ({ ...c, [key]: choice }))}
              translate={translate}
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={(): void => setStep(1)}>
              {t('core', 'common.action.back')}
            </Button>
            <Button type="button" disabled={!startable} onClick={(): void => setStep(3)}>
              {own('merge.flow.next')}
            </Button>
            {ready !== null && !startable ? (
              <span className="text-sm text-muted-foreground">{own('merge.flow.cannotContinue')}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 3 && ready !== null ? (
        <div className="grid gap-4">
          <Alert variant="warning">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>{own('merge.confirm.title', { loser: duplicate, survivor: props.survivorName })}</AlertTitle>
            <AlertDescription>
              <p>{own('merge.confirm.what', { count: totalMoving(ready), survivor: props.survivorName, loser: duplicate })}</p>
              <p>{own('merge.confirm.irreversible')}</p>
            </AlertDescription>
          </Alert>
          {Object.entries(fieldChoices).some(([, c]) => c === 'loser') ? (
            <p className="text-sm">
              {own('merge.confirm.fromDuplicate', {
                fields: Object.entries(fieldChoices)
                  .filter(([, c]) => c === 'loser')
                  .map(([code]) => own(`merge.field.${code}`))
                  .join(', '),
              })}
            </p>
          ) : null}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <Checkbox checked={acknowledged} onChange={(e): void => setAcknowledged(e.target.checked)} />
            {own('merge.flow.acknowledge')}
          </label>
          {startError !== null ? (
            <Alert variant="destructive">
              <AlertDescription>{startError}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={starting} onClick={(): void => setStep(2)}>
              {t('core', 'common.action.back')}
            </Button>
            <Button
              type="button"
              disabled={!acknowledged || starting}
              aria-busy={starting ? true : undefined}
              onClick={(): void => void start()}
            >
              {own('merge.flow.start')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface PreviewReviewProps {
  readonly preview: OrganizationMergePreview;
  readonly survivorName: string;
  readonly loserName: string;
  readonly fieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly customFieldChoices: Readonly<Record<string, RecordMergeChoice>>;
  readonly onFieldChoice: (code: string, choice: RecordMergeChoice) => void;
  readonly onCustomFieldChoice: (key: string, choice: RecordMergeChoice) => void;
  readonly translate: Translate;
}

/** The preview: refusals and the incomplete notice first, then what moves, then the value choices. */
function PreviewReview(props: PreviewReviewProps): ReactNode {
  const own = useTranslation('organizations');
  const { preview, translate } = props;
  const incomplete = incompleteModules(preview);
  const otherRefusals = preview.refusals.filter((r) => r.code !== 'RECORD_MERGE_PARTICIPATION_INCOMPLETE');
  const participants = useMemo(
    () =>
      preview.participants.map((p) => ({
        ...p,
        total: Object.values(p.counts).reduce((a, b) => a + b, 0),
        name: participantLabel(translate, p.moduleId, p.key),
      })),
    [preview.participants, translate],
  );

  return (
    <div className="grid gap-4">
      {otherRefusals.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>{own('merge.flow.refused.title')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {otherRefusals.map((refusal, i) => (
                <li key={`${refusal.code}-${i}`}>{refusalMessage(translate, refusal)}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {incomplete.length > 0 ? (
        <Alert variant="warning">
          <AlertTitle>{own('merge.flow.incomplete.title')}</AlertTitle>
          <AlertDescription>
            <p>
              {own('merge.flow.incomplete.body', { modules: incomplete.map((id) => moduleName(translate, id)).join(', ') })}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <EditorSection title={own('merge.preview.moves.title', { survivor: props.survivorName })}>
        {participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{own('merge.preview.moves.none')}</p>
        ) : (
          <ul className="divide-y text-sm">
            {participants.map((p) => (
              <li key={`${p.moduleId}:${p.key}`} className="grid gap-1 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span>{p.name}</span>
                  <span className="tabular-nums">{p.total}</span>
                </div>
                {p.conflicts.map((c, i) => (
                  <p key={`c${i}`} className="text-xs text-muted-foreground">
                    {own('merge.preview.conflict', {
                      conflict: noticeMessage(translate, 'conflict', p.moduleId, c),
                      resolution: c.resolution,
                    })}
                  </p>
                ))}
                {p.warnings.map((w, i) => (
                  <p key={`w${i}`} className="flex items-center gap-1 text-xs text-[var(--warn-soft-fg)]">
                    <AlertTriangle aria-hidden="true" className="size-3" />
                    <span className="sr-only">{own('merge.preview.warning')}: </span>
                    <span>{noticeMessage(translate, 'warning', p.moduleId, w)}</span>
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </EditorSection>

      {preview.fields.length > 0 || preview.customFields.length > 0 ? (
        <EditorSection title={own('merge.preview.values.title')}>
          <p className="text-sm text-muted-foreground">{own('merge.preview.values.hint')}</p>
          <div className="grid gap-4">
            {preview.fields.map((field) => (
              <ValueChoice
                key={field.code}
                name={`merge-field-${field.code}`}
                label={own(`merge.field.${field.code}`)}
                survivor={fieldValueText(field.code, field.survivor, own)}
                loser={fieldValueText(field.code, field.loser, own)}
                survivorName={props.survivorName}
                loserName={props.loserName}
                value={props.fieldChoices[field.code] ?? field.default}
                onChange={(choice): void => props.onFieldChoice(field.code, choice)}
              />
            ))}
            {preview.customFields.map((field) => (
              <ValueChoice
                key={field.key}
                name={`merge-custom-${field.key}`}
                label={field.key}
                survivor={fieldValueText(field.key, field.survivor, own)}
                loser={fieldValueText(field.key, field.loser, own)}
                survivorName={props.survivorName}
                loserName={props.loserName}
                value={props.customFieldChoices[field.key] ?? field.default}
                onChange={(choice): void => props.onCustomFieldChoice(field.key, choice)}
              />
            ))}
          </div>
        </EditorSection>
      ) : (
        <p className="text-sm text-muted-foreground">{own('merge.preview.values.none')}</p>
      )}
    </div>
  );
}

/** One differing value: keep the survivor's or take the duplicate's. The whole row is the target (Fitts). */
function ValueChoice(props: {
  name: string;
  label: string;
  survivor: string | null;
  loser: string | null;
  survivorName: string;
  loserName: string;
  value: RecordMergeChoice;
  onChange: (choice: RecordMergeChoice) => void;
}): ReactNode {
  const own = useTranslation('organizations');
  const labelId = useId();
  const option = (choice: RecordMergeChoice, from: string, text: string | null): ReactNode => (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary">
      <input
        type="radio"
        className="mt-1 accent-primary"
        name={props.name}
        checked={props.value === choice}
        onChange={(): void => props.onChange(choice)}
      />
      <span className="grid gap-0.5">
        <span className="text-xs text-muted-foreground">{from}</span>
        <span>{text ?? own('merge.value.empty')}</span>
      </span>
    </label>
  );
  return (
    <div className="grid gap-1.5">
      <p id={labelId} className="text-sm font-medium">
        {props.label}
      </p>
      <div role="radiogroup" aria-labelledby={labelId} className="grid gap-2 sm:grid-cols-2">
        {option('survivor', own('merge.value.from', { name: props.survivorName }), props.survivor)}
        {option('loser', own('merge.value.from', { name: props.loserName }), props.loser)}
      </div>
    </div>
  );
}
