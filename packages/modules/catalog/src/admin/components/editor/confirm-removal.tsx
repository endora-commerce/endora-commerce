import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Final design review (feature 170): the editor's structural removals (a variant, a related
 * product, a group child, a bundle slot or option) ask in the kit's `ModalDialog`, the same
 * dialog Archive, Delete and the gallery use, instead of `window.confirm`. `ask` resolves `true`
 * on the destructive button and `false` on Cancel, Escape or the scrim; the caller renders
 * `dialog` once.
 */
export function useConfirmRemoval(): {
  ask: (question: string) => Promise<boolean>;
  dialog: ReactNode;
} {
  const t = useTranslation('catalog');
  const [question, setQuestion] = useState<string | null>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean): void => {
    resolver.current?.(answer);
    resolver.current = null;
    setQuestion(null);
  }, []);

  const ask = useCallback((next: string): Promise<boolean> => {
    resolver.current?.(false);
    setQuestion(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog =
    question === null ? null : (
      <ModalDialog
        title={question}
        onClose={(): void => settle(false)}
        aria-describedby="product-editor-confirm-removal-body"
        footer={
          <>
            <Button type="button" variant="outline" className="max-lg:min-h-11" onClick={(): void => settle(false)}>
              {t('productEditor.archive.cancel')}
            </Button>
            <Button type="button" variant="destructive" className="max-lg:min-h-11" onClick={(): void => settle(true)}>
              {t('productEditor.confirmRemoval.confirm')}
            </Button>
          </>
        }
      >
        <p id="product-editor-confirm-removal-body" className="text-sm">
          {t('productEditor.confirmRemoval.body')}
        </p>
      </ModalDialog>
    );

  return { ask, dialog };
}
