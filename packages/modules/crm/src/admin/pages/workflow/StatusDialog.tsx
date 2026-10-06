import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  opportunityStatusCodeSchema,
  type CreateOpportunityStatusRequest,
  type OpportunityStatusKind,
  type OpportunityWorkflowStatus,
  type UpdateOpportunityStatusRequest,
} from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  ColorPicker,
  Input,
  Label,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ModalDialog } from '../../components/ModalDialog.js';
import { errorMessage, workflowStatusLabel } from '../../lib/labels.js';

/**
 * The languages a status is named in. They are the Admin UI's own two: the
 * backend resolves a status's name from the acting administrator's stored
 * language, which is one of these.
 */
const NAME_LANGUAGES = ['en', 'pl'] as const;

const KINDS: readonly OpportunityStatusKind[] = ['open', 'won', 'lost'];

const DEFAULT_COLOR = '#64748b';

export type StatusDialogSubmit =
  | { mode: 'create'; body: CreateOpportunityStatusRequest }
  | { mode: 'edit'; code: string; body: UpdateOpportunityStatusRequest };

export interface StatusDialogProps {
  /** The status being edited, or `null` to add one. */
  status: OpportunityWorkflowStatus | null;
  /** Where a new status lands by default: after the last one. */
  nextWeight: number;
  language: string;
  /** Resolves when the write was accepted; a rejection is shown in the dialog. */
  onSubmit: (submit: StatusDialogSubmit) => Promise<void>;
  onClose: () => void;
}

/** Drop the languages left blank: the schema refuses an empty name. */
function cleanNames(names: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(names)
      .map(([language, value]) => [language, value.trim()] as const)
      .filter(([, value]) => value.length > 0),
  );
}

function sameNames(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? '') !== (b[key] ?? '')) return false;
  return true;
}

/**
 * Add or edit one status: its code (on create only — it is immutable), its
 * names, whether it is open or closes an Opportunity as won or lost, whether
 * new Opportunities start in it, its position and its colour.
 *
 * An edit sends **only what changed**. The server refuses a change of `kind`
 * while Opportunities are in the status, and a body that restated an unchanged
 * `kind` would make every rename of such a status look like that refusal.
 */
export function StatusDialog(props: StatusDialogProps): ReactNode {
  const { status, onSubmit, onClose } = props;
  const t = useTranslation('crm');
  const tCore = useTranslation('core');
  const fieldId = useId();

  const [code, setCode] = useState(status?.code ?? '');
  const [defaultName, setDefaultName] = useState(status?.defaultName ?? '');
  const [names, setNames] = useState<Record<string, string>>({ ...(status?.name ?? {}) });
  const [kind, setKind] = useState<OpportunityStatusKind>(status?.kind ?? 'open');
  const [isInitial, setIsInitial] = useState(status?.isInitial ?? false);
  const [weight, setWeight] = useState(String(status?.weight ?? props.nextWeight));
  const [color, setColor] = useState(status?.color ?? DEFAULT_COLOR);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmedCode = code.trim();
    const trimmedName = defaultName.trim();
    const nextCodeError =
      status === null && !opportunityStatusCodeSchema.safeParse(trimmedCode).success
        ? t('workflow.error.code')
        : null;
    const nextNameError = trimmedName.length === 0 ? t('workflow.error.name') : null;
    setCodeError(nextCodeError);
    setNameError(nextNameError);
    if (nextCodeError || nextNameError) return;

    const parsedWeight = Number.parseInt(weight, 10);
    const safeWeight = Number.isFinite(parsedWeight) && parsedWeight >= 0 ? parsedWeight : 0;
    const cleanedNames = cleanNames(names);

    let payload: StatusDialogSubmit;
    if (status === null) {
      payload = {
        mode: 'create',
        body: {
          code: trimmedCode,
          defaultName: trimmedName,
          name: cleanedNames,
          kind,
          weight: safeWeight,
          color,
          ...(isInitial ? { isInitial: true } : {}),
        },
      };
    } else {
      const body: UpdateOpportunityStatusRequest = {};
      if (trimmedName !== status.defaultName) body.defaultName = trimmedName;
      if (!sameNames(cleanedNames, status.name)) body.name = cleanedNames;
      if (kind !== status.kind) body.kind = kind;
      if (isInitial && !status.isInitial) body.isInitial = true;
      if (safeWeight !== status.weight) body.weight = safeWeight;
      if (color.toLowerCase() !== status.color.toLowerCase()) body.color = color;
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      payload = { mode: 'edit', code: status.code, body };
    }

    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit(payload);
      onClose();
    } catch (error) {
      setSubmitError(errorMessage(error, t('workflow.error.save')));
      setBusy(false);
    }
  };

  const title =
    status === null
      ? t('workflow.dialog.createTitle')
      : t('workflow.dialog.editTitle', { name: workflowStatusLabel(status, props.language) });

  return (
    <ModalDialog title={title} onClose={onClose} busy={busy}>
      <form className="space-y-4" noValidate onSubmit={(event): void => void submit(event)}>
        {submitError ? (
          <Alert variant="destructive">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        {status === null ? (
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-code`}>{t('workflow.field.code')}</Label>
            <Input
              id={`${fieldId}-code`}
              value={code}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              aria-invalid={codeError !== null}
              aria-describedby={`${fieldId}-code-hint`}
              onChange={(event): void => setCode(event.target.value)}
            />
            <p
              id={`${fieldId}-code-hint`}
              className={codeError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
            >
              {codeError ?? t('workflow.field.codeHint')}
            </p>
          </div>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-name`}>{t('workflow.field.defaultName')}</Label>
          <Input
            id={`${fieldId}-name`}
            value={defaultName}
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? `${fieldId}-name-error` : undefined}
            onChange={(event): void => setDefaultName(event.target.value)}
          />
          {nameError ? (
            <p id={`${fieldId}-name-error`} className="text-xs text-destructive">
              {nameError}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {NAME_LANGUAGES.map((language) => (
            <div key={language} className="space-y-1">
              <Label htmlFor={`${fieldId}-name-${language}`}>
                {t(`workflow.field.name.${language}`)}
              </Label>
              <Input
                id={`${fieldId}-name-${language}`}
                value={names[language] ?? ''}
                placeholder={defaultName}
                onChange={(event): void =>
                  setNames((previous) => ({ ...previous, [language]: event.target.value }))
                }
              />
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-kind`}>{t('workflow.field.kind')}</Label>
          <Select
            id={`${fieldId}-kind`}
            value={kind}
            aria-describedby={`${fieldId}-kind-hint`}
            onChange={(event): void => setKind(event.target.value as OpportunityStatusKind)}
          >
            {KINDS.map((option) => (
              <option key={option} value={option}>
                {t(`workflow.kind.${option}`)}
              </option>
            ))}
          </Select>
          <p id={`${fieldId}-kind-hint`} className="text-xs text-muted-foreground">
            {t('workflow.field.kindHint')}
          </p>
        </div>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isInitial}
              // The start status cannot be unmarked: the workflow needs one, so
              // it moves only by marking another status.
              disabled={status?.isInitial === true}
              aria-describedby={status?.isInitial ? `${fieldId}-initial-hint` : undefined}
              onChange={(event): void => setIsInitial(event.target.checked)}
            />
            {t('workflow.field.initial')}
          </label>
          {status?.isInitial ? (
            <p id={`${fieldId}-initial-hint`} className="text-xs text-muted-foreground">
              {t('workflow.field.initialLockedHint')}
            </p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-weight`}>{t('workflow.field.weight')}</Label>
            <Input
              id={`${fieldId}-weight`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={weight}
              aria-describedby={`${fieldId}-weight-hint`}
              onChange={(event): void => setWeight(event.target.value)}
            />
            <p id={`${fieldId}-weight-hint`} className="text-xs text-muted-foreground">
              {t('workflow.field.weightHint')}
            </p>
          </div>
          <div className="space-y-1">
            <span className="block text-sm font-medium leading-none">
              {t('workflow.field.color')}
            </span>
            <ColorPicker
              value={color}
              onChange={setColor}
              label={t('workflow.field.color')}
              customLabel={t('workflow.field.colorCustom')}
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button className="min-h-11 sm:min-h-9" type="button" variant="outline" disabled={busy} onClick={onClose}>
            {tCore('common.action.cancel')}
          </Button>
          <Button className="min-h-11 sm:min-h-9" type="submit" disabled={busy} aria-busy={busy}>
            {busy ? tCore('common.state.saving') : tCore('common.action.save')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
