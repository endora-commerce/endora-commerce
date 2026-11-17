import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { TASK_TAG_DEFAULT_COLOR, TASK_TAG_NAME_MAX, type TaskTag, type UpdateTaskTagBody } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, ColorPicker, Input, Label } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { errorMessage } from '../../lib/labels.js';
import { useFocusFirstInvalid } from '../../lib/use-focus-first-invalid.js';

export type TaskTagDialogSubmit =
  | { mode: 'create'; body: { name: string; color: string } }
  | { mode: 'edit'; id: string; body: UpdateTaskTagBody };

export interface TaskTagDialogProps {
  /** The tag being edited, or `null` to add one. */
  tag: TaskTag | null;
  /** Resolves when the write was accepted; a rejection is shown in the dialog. */
  onSubmit: (submit: TaskTagDialogSubmit) => Promise<void>;
  onClose: () => void;
}

/**
 * Add or edit one Task tag (`specs/165-task-management/` User Story 9, R-10):
 * its name — unique whatever its letter case, which the server decides — and
 * its colour. An edit sends only what changed.
 */
export function TaskTagDialog(props: TaskTagDialogProps): ReactNode {
  const { tag, onSubmit, onClose } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const fieldId = useId();
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? TASK_TAG_DEFAULT_COLOR);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalid = useFocusFirstInvalid<HTMLFormElement>();

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError(t('tags.error.name'));
      invalid.refuse();
      return;
    }
    setNameError(null);

    let payload: TaskTagDialogSubmit;
    if (tag === null) {
      payload = { mode: 'create', body: { name: trimmed, color } };
    } else {
      const body: UpdateTaskTagBody = {};
      if (trimmed !== tag.name) body.name = trimmed;
      if (color.toLowerCase() !== tag.color.toLowerCase()) body.color = color;
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
      payload = { mode: 'edit', id: tag.id, body };
    }

    setBusy(true);
    setSubmitError(null);
    try {
      await onSubmit(payload);
      onClose();
    } catch (error) {
      setSubmitError(errorMessage(error, t('tags.error.save')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={tag === null ? t('tags.dialog.createTitle') : t('tags.dialog.editTitle', { name: tag.name })}
      onClose={onClose}
      busy={busy}
    >
      <form ref={invalid.containerRef} className="space-y-4" noValidate onSubmit={(event): void => void submit(event)}>
        {submitError ? (
          <Alert variant="destructive">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor={`${fieldId}-name`}>{t('tags.field.name')}</Label>
          <Input
            id={`${fieldId}-name`}
            value={name}
            maxLength={TASK_TAG_NAME_MAX}
            autoComplete="off"
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? `${fieldId}-name-error` : undefined}
            onChange={(event): void => setName(event.target.value)}
          />
          {nameError ? (
            <p id={`${fieldId}-name-error`} className="text-xs text-destructive">
              {nameError}
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
