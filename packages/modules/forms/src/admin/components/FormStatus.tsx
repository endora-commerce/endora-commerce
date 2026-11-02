import { useId, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { FormStatus, FormWarning } from '@endora-commerce/contracts';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Badge, Button } from '@endora-commerce/admin-kit/ui';
import { errorMessage } from '../lib/errors.js';

/**
 * The small pieces the list and the builder share (`specs/170-forms-module/` contracts/admin-surfaces
 * §4): a form's status as a badge with its word (never colour alone), its warnings as sentences with
 * an icon (FR-018), and the delete dialog that says what goes with the form (FR-013).
 */

const STATUS_VARIANT: Record<FormStatus, 'secondary' | 'success' | 'outline'> = {
  draft: 'secondary',
  published: 'success',
  closed: 'outline',
};

export function FormStatusBadge({ status }: { readonly status: FormStatus }): ReactNode {
  const t = useTranslation('forms');
  return <Badge variant={STATUS_VARIANT[status]}>{t(`status.${status}`)}</Badge>;
}

/** One sentence per warning. */
export function useWarningText(): (warning: FormWarning) => string {
  const t = useTranslation('forms');
  return (warning) =>
    warning.code === 'untranslated'
      ? t('warnings.untranslated', { language: warning.language, count: warning.missing })
      : t(`warnings.${warning.code}`);
}

export function FormWarningList({ warnings, compact = false }: { readonly warnings: readonly FormWarning[]; readonly compact?: boolean }): ReactNode {
  const text = useWarningText();
  if (warnings.length === 0) return null;
  return (
    <ul className={compact ? 'space-y-0.5' : 'space-y-1'}>
      {warnings.map((warning) => (
        <li key={`${warning.code}-${'language' in warning ? warning.language : ''}`} className="flex items-start gap-1.5 text-xs">
          <AlertTriangle size={compact ? 12 : 14} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600" />
          <span>{text(warning)}</span>
        </li>
      ))}
    </ul>
  );
}

export interface DeleteFormDialogProps {
  readonly name: string;
  readonly entryCount: number;
  readonly onConfirm: () => Promise<void>;
  readonly onClose: () => void;
}

/** Deleting a form: what goes with it is said before it goes (FR-013). */
export function DeleteFormDialog({ name, entryCount, onConfirm, onClose }: DeleteFormDialogProps): ReactNode {
  const t = useTranslation('forms');
  const bodyId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure) {
      setError(errorMessage(failure, t('builder.error')));
      setBusy(false);
    }
  };
  return (
    <ModalDialog
      title={t('delete.title', { name })}
      onClose={onClose}
      busy={busy}
      aria-describedby={bodyId}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('delete.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {t('delete.confirm')}
          </Button>
        </>
      }
    >
      <div id={bodyId} className="space-y-2 text-sm">
        <p>{t('delete.body')}</p>
        {entryCount > 0 ? <p className="font-medium">{t('delete.entries', { count: entryCount })}</p> : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </ModalDialog>
  );
}
