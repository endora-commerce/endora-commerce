import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button, FormField, Input } from '@endora-commerce/admin-kit/ui';

export interface CreateCodeNameDialogProps {
  /** The dialog's title, which is also its submit label ("Create template"). */
  title: string;
  /** Sends the create; throws on a refusal, which the dialog shows and stays open for. */
  onSubmit: (value: { code: string; name: string }) => Promise<void>;
  onClose: () => void;
}

/**
 * Create a template or a block from its code and name — the two fields the
 * list screens used to draw open above their rows (issue #1749). Both are
 * required; a refused create keeps the dialog open with the server's message
 * and what was typed.
 */
export function CreateCodeNameDialog({ title, onSubmit, onClose }: CreateCodeNameDialogProps): ReactNode {
  const t = useTranslation('transactional_emails');
  const tc = useTranslation('core');
  const formId = useId();
  const codeRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || code.trim() === '' || name.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ code: code.trim(), name: name.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={title}
      onClose={onClose}
      busy={busy}
      initialFocusRef={codeRef}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tc('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy || code.trim() === '' || name.trim() === ''} aria-busy={busy}>
            {title}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate className="space-y-4" onSubmit={(event): void => void submit(event)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FormField label={t('create.field.code')} required>
          <Input ref={codeRef} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
        </FormField>
        <FormField label={t('create.field.name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
      </form>
    </ModalDialog>
  );
}
