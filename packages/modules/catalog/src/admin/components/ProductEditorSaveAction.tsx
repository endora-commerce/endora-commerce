import { useContext, type ReactNode } from 'react';
import { Save } from 'lucide-react';
import { StickyFormActions } from '@endora-commerce/admin-kit/components';
import { Button, InlineStatus, type InlineStatusProps } from '@endora-commerce/admin-kit/ui';
import { AppLanguageContext, useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Issue #717 — the product editor's one primary action, rendered once, in the scope bar's
 * action slot. `StickyFormActions` makes the same node the fixed bottom bar below 1024 px and
 * an inline control at ≥ 1024 px, where the scope bar itself is sticky, so Save stays in view
 * on a long product at every width and is never rendered twice (`contracts/editor-ui.md` §11).
 *
 * This is the single slot a later change extends (for instance to save the zone panels on the
 * page too): it takes what it shows and what it runs as props and owns no save logic itself.
 */

export interface ProductEditorSaveActionProps {
  /** Number of staged changes the Save would send. */
  stagedCount: number;
  saving: boolean;
  /** False while the editor's data has not loaded. */
  ready: boolean;
  /** The current scope in words, read out after the label ("Save 2 changes at B2B PL"). */
  scopeWords: string;
  /**
   * The last save's result ("Saved 2 changes at Global"), said beside Save in a region that is
   * mounted before it has text (issue #1499, CAT-09) — `useInlineStatus().props`.
   */
  status?: Pick<InlineStatusProps, 'children' | 'tone' | 'revision'>;
  onSave(): void;
}

export function ProductEditorSaveAction(props: ProductEditorSaveActionProps): ReactNode {
  const { stagedCount, saving, ready, scopeWords, status, onSave } = props;
  const t = useTranslation('catalog');
  const adminLanguage = useContext(AppLanguageContext)?.language ?? 'en';
  const inert = stagedCount === 0 || saving || !ready;
  return (
    <StickyFormActions>
      {/* Own layout box: `.b2b-sticky-form-actions` is unlayered CSS, so utilities on it would
          not win. Below 1024 px Save spans the bar (thumb target, Fitts); the note sits under it. */}
      <div className="flex w-full flex-col gap-1 lg:w-auto lg:flex-row lg:items-center lg:gap-2">
        {status === undefined ? null : (
          <InlineStatus
            tone={status.tone ?? 'success'}
            {...(status.revision === undefined ? {} : { revision: status.revision })}
            className="max-lg:justify-center"
            data-testid="product-save-info"
          >
            {status.children}
          </InlineStatus>
        )}
        <Button
          type="button"
          className="max-lg:min-h-11 max-lg:w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          // aria-disabled, not disabled: focus stays on Save after it has saved (WCAG 2.4.3).
          aria-disabled={inert}
          aria-describedby="product-save-note"
          data-testid="product-save"
          onClick={(): void => {
            if (inert) return;
            onSave();
          }}
        >
          <Save aria-hidden="true" />
          {saving
            ? t('productEditor.save.saving')
            : stagedCount > 0
              ? t(`productEditor.save.actionCount.${new Intl.PluralRules(adminLanguage).select(stagedCount)}`, {
                  count: String(stagedCount),
                })
              : t('productEditor.save.action')}{' '}
          <span className="sr-only">{t('productEditor.save.atScope', { scope: scopeWords })}</span>
        </Button>
        <span id="product-save-note" className="text-xs text-muted-foreground max-lg:text-center">
          {stagedCount === 0 ? t('productEditor.save.noChanges') : ''}
        </span>
      </div>
    </StickyFormActions>
  );
}
