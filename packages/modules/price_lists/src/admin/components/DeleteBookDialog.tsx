import { useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { errorMessage } from '../lib/api-errors.js';
import { usePriceBooksApi } from '../lib/use-price-books-api.js';

/**
 * The delete confirmation (feature 161, FR-005): it names the book and how many
 * price rows go with it, because a book is undone only by retyping it. The
 * list and the header open the same dialog; neither offers it on a base book.
 */
export function DeleteBookDialog(props: {
  readonly book: { readonly id: string; readonly name: string; readonly rowCount: number };
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}): ReactNode {
  const t = useTranslation('price_lists');
  const api = usePriceBooksApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.remove(props.book.id);
      props.onDeleted();
    } catch (err) {
      setError(errorMessage(err, t('priceBooks.delete.error')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('priceBooks.delete.title')}
      onClose={props.onClose}
      busy={busy}
      footer={
        <>
          <Button type="button" variant="outline" onClick={props.onClose} disabled={busy}>
            {t('priceBooks.common.cancel')}
          </Button>
          <Button type="button" variant="destructive" onClick={(): void => void confirm()} disabled={busy} aria-busy={busy}>
            <Trash2 aria-hidden="true" />
            {t('priceBooks.delete.confirm')}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t('priceBooks.delete.body', { name: props.book.name, count: props.book.rowCount })}</p>
      {error ? (
        <Alert variant="destructive" role="alert" className="mt-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </ModalDialog>
  );
}
