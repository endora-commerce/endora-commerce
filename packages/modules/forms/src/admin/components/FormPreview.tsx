import { useEffect, useState, type ReactNode } from 'react';
import { FormBlock } from '@endora-commerce/cms-components/components/forms/FormBlock';
import '@endora-commerce/cms-components/styles.css';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@endora-commerce/admin-kit/ui';
import { formsApi, type FormPreview as FormPreviewRead } from '../api.js';

/**
 * The builder's live preview (`specs/170-forms-module/` FR-017, research R-19): the **storefront's
 * own renderer** — `cms-components`' `FormBlock` — fed with the server's public read of the saved
 * working copy (`GET …/forms/:id/preview?source=working`), so the preview lays a form out exactly as
 * a page will and cannot drift from it. It reads again after every save (`version`); unsaved edits
 * are announced as such rather than guessed at. It renders in the builder's content language, whose
 * code its header shows (User Story 7).
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
    <Card role="region" aria-labelledby="forms-preview-title">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b border-border p-4">
        <div className="space-y-1">
          <CardTitle>
            <h2 id="forms-preview-title">{t('preview.title')}</h2>
          </CardTitle>
          {stale ? <CardDescription className="text-xs">{t('preview.stale')}</CardDescription> : null}
        </div>
        <Badge variant="outline">{language}</Badge>
      </CardHeader>
      <CardContent className="p-4" aria-busy={state.kind === 'loading' || undefined}>
        {state.kind === 'loading' ? <p className="text-sm text-muted-foreground">{t('preview.loading')}</p> : null}
        {state.kind === 'error' ? <p className="text-sm text-destructive">{t('preview.loadError')}</p> : null}
        {state.kind === 'ready' ? (
          state.read.availability === 'unavailable' ? (
            <p className="text-sm text-muted-foreground">{t('preview.unavailable')}</p>
          ) : (
            <div className="mx-auto max-w-3xl">
              <FormBlock id="forms-preview" definition={state.read} />
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
