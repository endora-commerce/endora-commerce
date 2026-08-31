import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from '@endora-commerce/admin-kit/ui';

/**
 * The module's confirmation dialog — ux-design §6.5 and §2.12.
 *
 * Lifted out of `FeedLinkCard.tsx` unchanged except for `confirmVariant`, so
 * token rotation and taxonomy promotion share **one** dialog rather than
 * growing a second (Principle IX). Copying it would have been the cheaper edit
 * and the worse outcome.
 *
 * `confirmVariant` defaults to `destructive`, which is what the rotation and
 * revoke flows need. Promotion passes `default`: it is consequential and
 * **reversible**, and dressing a reversible act in the colour reserved for
 * deletion devalues that colour where it matters (Law of Similarity — the same
 * appearance must mean the same behaviour).
 *
 * A native `window.confirm` is not enough for any of these: the consequence is
 * two sentences long, it has to be readable, and a browser dialog cannot be
 * styled, translated or focus-managed. Initial focus is on the **safe** button.
 */
export function ConsequenceDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  busy: boolean;
  confirmVariant?: 'default' | 'destructive';
  onCancel: () => void;
  onConfirm: () => void;
}): ReactNode {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => cancelRef.current?.focus(), []);

  return (
    <>
      <div className="b2b-scrim" onClick={props.onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-background p-4 shadow-lg"
        onKeyDown={(event): void => {
          if (event.key === 'Escape') props.onCancel();
        }}
      >
        <h2 id={titleId} className="text-base font-medium">
          {props.title}
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-muted-foreground">
          {props.body}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="outline" onClick={props.onCancel}>
            {props.cancelLabel}
          </Button>
          <Button
            type="button"
            variant={props.confirmVariant ?? 'destructive'}
            disabled={props.busy}
            aria-busy={props.busy}
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
