import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { RotateCw, Trash2 } from 'lucide-react';
import { formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  deleteProductUrlRedirect,
  describeKeyInLanguage,
  getProductUrlKeys,
  urlKeyErrorMessage,
  type ProductUrlKeys,
} from '../lib/product-url-keys-api.js';
import { SectionHeading } from './editor/ImmediateBadge.js';

/**
 * Feature 170 (`contracts/editor-ui.md` §3, §11) — the product's old URLs, below the URL key on
 * Details → Content. The key itself is a `ScopedField` saved with the page Save; this list is
 * only read and pruned. Deleting a redirect is its own audited Command, applied at once.
 *
 * The list is shown only while the URL-keys answer carries it (`seo` present, 163 Q-C): an
 * answer without `redirects` hides the section; a failed read shows an error with Retry.
 * Deleting applies at once, so the heading carries "Applies immediately" (FR-070).
 */
export function ProductUrlRedirects({ productId, canWrite }: { productId: string; canWrite: boolean }): ReactNode {
  const t = useTranslation('catalog');
  const headingId = useId();
  const [redirects, setRedirects] = useState<ProductUrlKeys['redirects'] | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'absent' | 'failed'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [toDelete, setToDelete] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const keys = await getProductUrlKeys(productId);
      setRedirects(keys.redirects ?? null);
      setPhase(keys.redirects ? 'ready' : 'absent');
    } catch {
      setPhase('failed');
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (redirectId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setStatus('');
    try {
      await deleteProductUrlRedirect(productId, redirectId);
      setStatus(t('productEditor.urlKeys.redirectDeleted'));
      await load();
      // The row and its button are gone: focus the list's heading.
      document.getElementById(headingId)?.focus();
    } catch (err) {
      setError(urlKeyErrorMessage(err, t) ?? t('productEditor.urlKeys.error.deleteRedirect'));
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  };

  if (phase === 'absent') return null;
  return (
    <div className="space-y-2 md:col-span-2" data-testid="product-url-redirects">
      <div id={headingId} tabIndex={-1} className="outline-none">
        <SectionHeading title={t('productEditor.urlKeys.redirectsHeading')} immediate={canWrite} />
      </div>
      {phase === 'loading' ? (
        <div aria-busy="true" className="space-y-1">
          <span className="sr-only">{t('productEditor.urlKeys.redirectsLoading')}</span>
          <div className="h-5 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ) : null}
      {phase === 'failed' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="redirects-load-error">
          <span role="alert" className="text-destructive">
            {t('productEditor.urlKeys.error.loadRedirects')}
          </span>
          <Button type="button" variant="outline" size="sm" className="max-lg:min-h-11" onClick={(): void => void load()}>
            <RotateCw size={14} aria-hidden="true" /> {t('productEditor.error.retry')}
          </Button>
        </div>
      ) : null}
      <p role="status" className="sr-only">
        {status}
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {phase !== 'ready' || !redirects ? null : redirects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('productEditor.urlKeys.redirectsEmpty')}</p>
      ) : (
        <ul aria-labelledby={headingId} className="space-y-1">
          {redirects.map((r) => {
            const label = describeKeyInLanguage(r.key, r.languageCode, t);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono">{label}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                {canWrite ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="max-lg:min-h-11"
                    aria-disabled={busy || undefined}
                    aria-label={t('productEditor.urlKeys.deleteRedirectFor', { key: r.key })}
                    onClick={(): void => {
                      if (!busy) setToDelete({ id: r.id, label });
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    {t('productEditor.urlKeys.deleteRedirect')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {toDelete ? (
        <ModalDialog
          title={t('productEditor.urlKeys.deleteRedirectTitle')}
          busy={busy}
          onClose={(): void => setToDelete(null)}
          footer={
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={(): void => setToDelete(null)}>
                {t('productEditor.urlKeys.cancel')}
              </Button>
              <Button type="button" variant="destructive" disabled={busy} aria-busy={busy} onClick={(): void => void remove(toDelete.id)}>
                {t('productEditor.urlKeys.deleteRedirectConfirm')}
              </Button>
            </>
          }
        >
          <p className="text-sm">{t('productEditor.urlKeys.deleteRedirectBody', { key: toDelete.label })}</p>
        </ModalDialog>
      ) : null}
    </div>
  );
}
