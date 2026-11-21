import type { ReactNode } from 'react';
import type { DocumentVariable } from '@endora-commerce/contracts';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';

/**
 * The type's merge fields with a description each (FR-017), as `{{key}}` chips
 * an operator copies into a text. Hidden when the type declares none of its
 * own (invoices) — `date`, `page` and `pages` alone are not worth a panel.
 *
 * It sits on the row above the canvas (issue #1532), beside the language, so it
 * has no border of its own: a box there would be a second region competing with
 * the canvas's (Common Region).
 */
export interface MergeFieldsPanelProps {
  readonly variables: readonly DocumentVariable[];
}

export function MergeFieldsPanel({ variables }: MergeFieldsPanelProps): ReactNode {
  const t = useTranslation('document_templates');
  const { t: translateIn } = useTranslationContext();
  if (!variables.some((variable) => variable.ownerModule !== 'document_templates')) return null;
  return (
    <section aria-labelledby="merge-fields-title" className="min-w-0 flex-1" data-testid="merge-fields">
      <h2 id="merge-fields-title" className="mb-1 text-sm font-medium">
        {t('editor.mergeFields.title')}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {variables.map((variable) => {
          const placeholder = `{{${variable.key}}}`;
          return (
            <li key={variable.key} className="flex items-center gap-1 text-sm">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(placeholder)}
                aria-label={t('editor.mergeFields.copy', { field: placeholder })}
              >
                <code>{placeholder}</code>
              </Button>
              <span className="text-muted-foreground">
                {translateIn(variable.ownerModule, variable.labelKey)}
                {variable.scope === 'headerFooter' ? ` (${t('editor.mergeFields.headerFooterOnly')})` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
