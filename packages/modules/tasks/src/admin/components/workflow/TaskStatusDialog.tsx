import { useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  TASK_STATUS_CATEGORIES,
  taskStatusCodeSchema,
  type CreateTaskStatusBody,
  type TaskStatusCategory,
  type TaskStatusConfig,
  type UpdateTaskStatusBody,
} from '@endora-commerce/contracts';
import { ApiError, useDerivedKey } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Checkbox, ColorPicker, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { errorMessage, workflowStatusName } from '../../lib/labels.js';
import { useFocusFirstInvalid } from '../../lib/use-focus-first-invalid.js';

/** The two Admin UI languages; a status is named in both (FR-012). */
const NAME_LANGUAGES = ['en', 'pl'] as const;

const DEFAULT_COLOR = '#64748b';

/** The longest code `taskStatusCodeSchema` accepts. */
const CODE_MAX_LENGTH = 64;

/** Whether the server refused a create because the code is taken (`status_code_taken`). */
function isCodeTaken(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.envelope.error.details as { rule?: unknown } | undefined)?.rule === 'status_code_taken'
  );
}

export type TaskStatusDialogSubmit =
  | { mode: 'create'; body: CreateTaskStatusBody }
  | { mode: 'edit'; code: string; body: UpdateTaskStatusBody };

export interface TaskStatusDialogProps {
  /** The status being edited, or `null` to add one. */
  status: TaskStatusConfig | null;
  /** Where a new status lands: after the last one. The order is changed on the list (issue #1560). */
  nextWeight: number;
  /** The codes already in the workflow: a new status may not reuse one. */
  takenCodes: readonly string[];
  language: string;
  /** Resolves when the write was accepted; a rejection is shown in the dialog. */
  onSubmit: (submit: TaskStatusDialogSubmit) => Promise<void>;
  onClose: () => void;
}

/**
 * Add or edit one Task status (`specs/165-task-management/` FR-012; CRM's
 * `StatusDialog`, the model): its code (on create only — it is immutable;
 * derived from the English name until edited, normalised on blur, a taken one
 * refused rather than suffixed — issue #1560, the architect ruling on #512), its
 * name in both languages, its category, whether new Tasks start in it, and
 * its colour. A new status goes last; the order is changed on the list, one
 * batch reorder per move (issue #1560).
 *
 * An edit sends **only what changed**: the server refuses a category change
 * while Tasks are in the status, and a body restating an unchanged category
 * would make every rename of such a status look like that refusal.
 */
export function TaskStatusDialog(props: TaskStatusDialogProps): ReactNode {
  const { status, onSubmit, onClose } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const fieldId = useId();

  const [code, setCode] = useState(status?.code ?? '');
  const [names, setNames] = useState<Record<string, string>>({
    en: status?.name.en ?? '',
    pl: status?.name.pl ?? '',
  });
  const [category, setCategory] = useState<TaskStatusCategory>(status?.category ?? 'open');
  const [isInitial, setIsInitial] = useState(status?.isInitial ?? false);
  const [color, setColor] = useState(status?.color ?? DEFAULT_COLOR);
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
    enabled: status === null,
  });

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    // Enter in the code field submits without a blur: normalise here too.
    const trimmedCode = codeField.commit().trim();
    const name = { en: (names.en ?? '').trim(), pl: (names.pl ?? '').trim() };
    let nextCodeError: string | null = null;
    if (status === null) {
      if (!taskStatusCodeSchema.safeParse(trimmedCode).success) nextCodeError = t('workflow.error.code');
      else if (props.takenCodes.includes(trimmedCode)) nextCodeError = t('workflow.error.codeTaken');
    }
    const nextNameError = name.en.length === 0 || name.pl.length === 0 ? t('workflow.error.name') : null;
    setCodeError(nextCodeError);
    setNameError(nextNameError);
    if (nextCodeError || nextNameError) {
      invalid.refuse();
      return;
    }

    let payload: TaskStatusDialogSubmit;
    if (status === null) {
      payload = {
        mode: 'create',
        body: {
          code: trimmedCode,
          name,
          category,
          color,
          weight: props.nextWeight,
          ...(isInitial ? { isInitial: true } : {}),
        },
      };
    } else {
      const body: UpdateTaskStatusBody = {};
      if (name.en !== (status.name.en ?? '') || name.pl !== (status.name.pl ?? '')) body.name = name;
      if (category !== status.category) body.category = category;
      if (isInitial && !status.isInitial) body.isInitial = true;
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
      setBusy(false);
      if (status === null && isCodeTaken(error)) {
        setCodeError(t('workflow.error.codeTaken'));
        invalid.refuse();
        return;
      }
      setSubmitError(errorMessage(error, t('workflow.error.save')));
    }
  };

  const title =
    status === null
      ? t('workflow.dialog.createTitle')
      : t('workflow.dialog.editTitle', { name: workflowStatusName(status, props.language) });

  return (
    <ModalDialog title={title} onClose={onClose} busy={busy}>
      <form ref={invalid.containerRef} className="space-y-4" noValidate onSubmit={(event): void => void submit(event)}>
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
              onChange={codeField.onChange}
              onBlur={codeField.onBlur}
            />
            <p id={`${fieldId}-code-hint`} className={codeError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
              {codeError ?? t('workflow.field.codeHint')}
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

        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-category`}>{t('workflow.field.category')}</Label>
          <Select
            id={`${fieldId}-category`}
            value={category}
            aria-describedby={`${fieldId}-category-hint`}
            onChange={(event): void => setCategory(event.target.value as TaskStatusCategory)}
          >
            {TASK_STATUS_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {t(`workflow.category.${option}`)}
              </option>
            ))}
          </Select>
          <p id={`${fieldId}-category-hint`} className="text-xs text-muted-foreground">
            {t('workflow.field.categoryHint')}
          </p>
        </div>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isInitial}
              // The start status is not unmarked: the workflow needs one, so it
              // moves only by marking another status.
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

        <div className="space-y-1">
          <span className="block text-sm font-medium leading-none">{t('workflow.field.color')}</span>
          <ColorPicker
            value={color}
            onChange={setColor}
            label={t('workflow.field.color')}
            customLabel={t('workflow.field.colorCustom')}
          />
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
