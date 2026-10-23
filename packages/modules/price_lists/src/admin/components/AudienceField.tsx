import { forwardRef, useId, type ReactNode } from 'react';
import type { PriceBookAudienceKind } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { audienceHelp, audienceLabel } from '../lib/book-labels.js';
import { MemberPicker } from './MemberPicker.js';

/**
 * Who a book's prices are for (feature 161, FR-002, FR-003, FR-027): one kind
 * — everyone, customer groups or organizations, never a mix — and its members.
 *
 * Only the kinds the caller may create are offered (`creatableAudienceKinds`,
 * G11: organizations alone for a sales representative). Once a book has been
 * active its kind is fixed (160 FR-004), so the kind is then shown, not asked.
 * The fieldset takes focus so a refused activation can bring the operator here.
 */
export const AudienceField = forwardRef<
  HTMLFieldSetElement,
  {
    readonly kinds: readonly PriceBookAudienceKind[];
    readonly kind: PriceBookAudienceKind;
    readonly onKindChange: (kind: PriceBookAudienceKind) => void;
    readonly kindFixed: boolean;
    readonly memberIds: readonly string[];
    readonly onMembersChange: (memberIds: string[]) => void;
    readonly readOnly?: boolean;
    readonly error?: string | undefined;
  }
>(function AudienceField(props, ref): ReactNode {
  const t = useTranslation('price_lists');
  const name = useId();
  const errorId = useId();
  const editableKind = !props.kindFixed && !props.readOnly;
  return (
    <fieldset
      ref={ref}
      tabIndex={-1}
      className="space-y-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-describedby={props.error ? errorId : undefined}
    >
      <legend className="text-sm font-medium">{t('priceBooks.field.audience')}</legend>
      {editableKind ? (
        <div className="space-y-1">
          {props.kinds.map((kind) => (
            <label key={kind} className="flex min-h-11 items-start gap-2 text-sm sm:min-h-8">
              <input
                type="radio"
                name={name}
                className="mt-1 h-4 w-4 accent-primary"
                checked={props.kind === kind}
                onChange={(): void => props.onKindChange(kind)}
              />
              <span>
                <span className="font-medium">{audienceLabel(t, kind)}</span>
                <span className="block text-xs text-muted-foreground">{audienceHelp(t, kind)}</span>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm">
          <span className="font-medium">{audienceLabel(t, props.kind)}</span>
          {props.kindFixed ? (
            <span className="block text-xs text-muted-foreground">{t('priceBooks.audience.kindFixed')}</span>
          ) : null}
        </p>
      )}
      {props.kind === 'everyone' ? null : (
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('priceBooks.field.members')}</p>
          <MemberPicker
            kind={props.kind}
            value={props.memberIds}
            onChange={props.onMembersChange}
            disabled={props.readOnly ?? false}
          />
        </div>
      )}
      {props.error ? (
        <p id={errorId} className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
    </fieldset>
  );
});
