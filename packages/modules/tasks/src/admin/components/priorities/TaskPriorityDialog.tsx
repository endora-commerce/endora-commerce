import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  taskPriorityCodeSchema,
  type CreateTaskPriorityBody,
  type TaskPriorityConfig,
  type UpdateTaskPriorityBody,
} from '@endora-commerce/contracts';
import { ApiError, useDerivedKey } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, ColorPicker, Input, Label } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { errorMessage, workflowStatusName } from '../../lib/labels.js';
import { useFocusFirstInvalid } from '../../lib/use-focus-first-invalid.js';

/** The two Admin UI languages; a priority is named in both (FR-024). */
const NAME_LANGUAGES = ['en', 'pl'] as const;

const DEFAULT_COLOR = '#64748b';

/** The filter token for "no priority" — never a priority's code. */
const NO_PRIORITY = 'none';

/** The longest code `taskPriorityCodeSchema` accepts. */
const CODE_MAX_LENGTH = 64;

/** Whether the server refused a create because the code is taken (`priority_code_taken`). */
function isCodeTaken(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.envelope.error.details as { rule?: unknown } | undefined)?.rule === 'priority_code_taken'
  );
}

export type TaskPriorityDialogSubmit =
  | { mode: 'create'; body: CreateTaskPriorityBody }
  | { mode: 'edit'; code: string; body: UpdateTaskPriorityBody };

export interface TaskPriorityDialogProps {
  /** The priority being edited, or `null` to add one. */
  priority: TaskPriorityConfig | null;
  /** Where a new priority lands by default: after the least urgent one. */
  nextWeight: number;
  /** The codes of the existing priorities: a new one may not reuse one. */
  takenCodes: readonly string[];
  language: string;
  /** Resolves when the write was accepted; a rejection is shown in the dialog. */
  onSubmit: (submit: TaskPriorityDialogSubmit) => Promise<void>;
  onClose: () => void;
}

/**
 * Add or edit one Task priority (`specs/165-task-management/` User Story 9,
 * FR-024, research R-9; the status dialog, the model): its code (on create
 * only — Tasks hold it, so it is immutable; derived from the English name
 * until edited, normalised on blur, a taken one refused rather than suffixed —
 * issue #1560, the architect ruling on #512), its name in both languages, its
 * position — the lower, the more urgent — and its colour. An edit sends only
 * what changed.
 */
export function TaskPriorityDialog(props: TaskPriorityDialogProps): ReactNode {
  const { priority, onSubmit, onClose } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const fieldId = useId();

  const [code, setCode] = useState(priority?.code ?? '');
  const [names, setNames] = useState<Record<string, string>>({
    en: priority?.name.en ?? '',
    pl: priority?.name.pl ?? '',
  });
  const [weight, setWeight] = useState(String(priority?.weight ?? props.nextWeight));
  const [color, setColor] = useState(priority?.color ?? DEFAULT_COLOR);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalid = useFocusFirstInvalid<HTMLFormElement>();
  const codeField = useDerivedKey({
    source: names.en ?? '',
    value: code,
    onChange: (next): void => {
      setCode(next);
      setCodeError(null);
    },
    separator: '_',
    maxLength: CODE_MAX_LENGTH,
    enabled: priority === null,
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    // Enter in the code field submits without a blur: normalise here too.
    const trimmedCode = codeField.commit().trim();
    const name = { en: (names.en ?? '').trim(), pl: (names.pl ?? '').trim() };
    let nextCodeError: string | null = null;
    if (priority === null) {
      if (!taskPriorityCodeSchema.safeParse(trimmedCode).success) nextCodeError = t('workflow.error.code');
      else if (trimmedCode === NO_PRIORITY) nextCodeError = t('priorities.error.codeNone');
      else if (props.takenCodes.includes(trimmedCode)) nextCodeError = t('priorities.error.codeTaken');
    }
    const nextNameError = name.en.length === 0 || name.pl.length === 0 ? t('workflow.error.name') : null;
    setCodeError(nextCodeError);
    setNameError(nextNameError);
    if (nextCodeError || nextNameError) {
      invalid.refuse();
      return;
    }

    const parsedWeight = Number.parseInt(weight, 10);
    const safeWeight = Number.isFinite(parsedWeight) && parsedWeight >= 0 ? parsedWeight : 0;

    let payload: TaskPriorityDialogSubmit;
    if (priority === null) {
      payload = { mode: 'create', body: { code: trimmedCode, name, color, weight: safeWeight } };
    } else {
      const body: UpdateTaskPriorityBody = {};
      if (name.en !== (priority.name.en ?? '') || name.pl !== (priority.name.pl ?? '')) body.name = name;
      if (safeWeight !== priority.weight) body.weight = safeWeight;
      if (color.toLowerCase() !== priority.color.toLowerCase()) body.color = color;
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      payload = { mode: 'edit', code: priority.code, body };
    }

    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit(payload);
      onClose();
    } catch (error) {
      setBusy(false);
      if (priority === null && isCodeTaken(error)) {
        setCodeError(t('priorities.error.codeTaken'));
        invalid.refuse();
        return;
      }
      setSubmitError(errorMessage(error, t('priorities.error.save')));
    }
  };

  const title =
    priority === null
      ? t('priorities.dialog.createTitle')
      : t('priorities.dialog.editTitle', { name: workflowStatusName(priority, props.language) });

  return (
    <ModalDialog title={title} onClose={onClose} busy={busy}>
      <form ref={invalid.containerRef} className="space-y-4" noValidate onSubmit={(event): void => void submit(event)}>
        {submitError ? (
          <Alert variant="destructive">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        {priority === null ? (
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
              onChange={codeField.onChange}
              onBlur={codeField.onBlur}
            />
            <p id={`${fieldId}-code-hint`} className={codeError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {codeError ?? t('priorities.field.codeHint')}
            </p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          {NAME_LANGUAGES.map((language) => (
            <div key={language} className="space-y-1">
              <Label htmlFor={`${fieldId}-name-${language}`}>{t(`workflow.field.name.${language}`)}</Label>
              <Input
                id={`${fieldId}-name-${language}`}
                value={names[language] ?? ''}
                aria-invalid={nameError !== null && (names[language] ?? '').trim().length === 0}
                aria-describedby={nameError ? `${fieldId}-name-error` : undefined}
                onChange={(event): void => setNames((previous) => ({ ...previous, [language]: event.target.value }))}
              />
            </div>
          ))}
          {nameError ? (
            <p id={`${fieldId}-name-error`} className="text-xs text-destructive sm:col-span-2">
              {nameError}
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
              {t('priorities.field.weightHint')}
            </p>
          </div>
          <div className="space-y-1">
            <span className="block text-sm font-medium leading-none">{t('workflow.field.color')}</span>
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
