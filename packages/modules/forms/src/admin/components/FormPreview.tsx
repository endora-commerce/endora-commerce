import { useEffect, useState, type ReactNode } from 'react';
import { FormBlock } from '@endora-commerce/cms-components/components/forms/FormBlock';
import '@endora-commerce/cms-components/styles.css';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { formsApi, type FormPreview as FormPreviewRead } from '../api.js';

/**
 * The builder's live preview (`specs/170-forms-module/` FR-017, research R-19): the **storefront's
 * own renderer** — `cms-components`' `FormBlock` — fed with the server's public read of the saved
 * working copy (`GET …/forms/:id/preview?source=working`), so the preview lays a form out exactly as
 * a page will and cannot drift from it. It reads again after every save (`version`); unsaved edits
 * are announced as such rather than guessed at.
 */
export interface FormPreviewProps {
  readonly formId: string;
  readonly language: string;
  /** Changes whenever the saved working copy does (the form's revision). */
  readonly version: number;
  /** Whether the draft on screen differs from what was saved. */
  readonly stale: boolean;
}

type State = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; read: FormPreviewRead };

export function FormPreview({ formId, language, version, stale }: FormPreviewProps): ReactNode {
  const t = useTranslation('forms');
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let alive = true;
    formsApi
      .preview(formId, 'working', language)
      .then((read) => {
        if (alive) setState({ kind: 'ready', read });
      })
      .catch(() => {
        if (alive) setState({ kind: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [formId, language, version]);

  return (
    <section aria-label={t('preview.title')} className="space-y-2 rounded-lg border border-border bg-background p-4">
      <h2 className="text-sm font-semibold">{t('preview.title')}</h2>
      {stale ? (
        <p className="text-xs text-muted-foreground">
          {t('preview.stale')}
        </p>
      ) : null}
      {state.kind === 'loading' ? <p className="text-sm text-muted-foreground">{t('preview.loading')}</p> : null}
      {state.kind === 'error' ? <p className="text-sm text-destructive">{t('preview.loadError')}</p> : null}
      {state.kind === 'ready' ? (
        state.read.availability === 'unavailable' ? (
          <p className="text-sm text-muted-foreground">{t('preview.unavailable')}</p>
        ) : (
          <div>
            <FormBlock id="forms-preview" definition={state.read} />
          </div>
        )
      ) : null}
    </section>
  );
}
