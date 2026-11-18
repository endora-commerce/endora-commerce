import type { ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { formatCount } from '../../lib/orderMinimum';
import type { ReturnFormLine } from '../../lib/returns/returnForm';

/**
 * The return form's line table (feature 046; feature 155 FR-021).
 *
 * A Server Component: the form posts to a server action and works without JavaScript. A line
 * that is not selectable in the form's kind (a non-returnable line in a return) stays in the
 * list — the buyer sees why it is missing from the return, rather than wondering where it went
 * — with its controls disabled and the reason as text linked to its checkbox, so the state is
 * never carried by colour or a greyed-out row alone (WCAG 1.4.1). The whole product cell is the
 * checkbox's label, so the hit area is the row's name, not the 13 px box (Fitts's Law).
 */
export interface ReturnFormReason {
  id: string;
  label: Record<string, string>;
}

/** The reason's label in the request's language, else English, else whatever it carries. */
export function reasonLabel(reason: ReturnFormReason, locale: string): string {
  const language = locale.slice(0, 2).toLowerCase();
  return reason.label[language] ?? reason.label['en'] ?? Object.values(reason.label)[0] ?? reason.id;
}

export function ReturnFormLines({
  lines,
  reasons,
  locale,
}: {
  lines: readonly ReturnFormLine[];
  reasons: readonly ReturnFormReason[];
  locale: string;
}): ReactNode {
  const t = tForLocale(locale);
  return (
    <table className="b2b-account__table">
      <thead>
        <tr>
          <th>
            <span className="sr-only">{t('returns.new.col.include')}</span>
          </th>
          <th>{t('returns.new.col.product')}</th>
          <th>{t('returns.new.col.qty')}</th>
          <th>{t('returns.new.col.reason')}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const checkboxId = `include_${l.orderItemId}`;
          const reasonId = `not-returnable-${l.orderItemId}`;
          const boundId = `qty-bound-${l.orderItemId}`;
          const disabled = !l.selectable;
          return (
            <tr key={l.orderItemId}>
              <td>
                <input
                  type="checkbox"
                  id={checkboxId}
                  name={`include_${l.orderItemId}`}
                  disabled={disabled}
                  {...(l.notReturnableText ? { 'aria-describedby': reasonId } : {})}
                />
              </td>
              <td>
                <label htmlFor={checkboxId} className={disabled ? 'text-muted' : 'cursor-pointer'}>
                  {l.name}
                </label>
                {l.notReturnableText ? (
                  <span id={reasonId} className="mt-[2px] block text-[12px] text-muted">
                    {l.notReturnableText}
                  </span>
                ) : null}
              </td>
              <td>
                <input
                  type="number"
                  name={`qty_${l.orderItemId}`}
                  min={1}
                  max={l.remainingQty}
                  defaultValue={1}
                  disabled={disabled}
                  aria-label={`${t('returns.new.col.qty')}: ${l.name}`}
                  aria-describedby={boundId}
                  style={{ width: '4rem' }}
                />
                {/* 180 R-13: the route handler holds the quantity to what is left, as the
                    server action did (U4); the API stays the boundary. */}
                {disabled ? null : <input type="hidden" name={`remaining_${l.orderItemId}`} value={l.remainingQty} />}
                <span id={boundId} className="muted">
                  {' '}
                  {t('returns.line.remaining').replace('{count}', formatCount(l.remainingQty, locale))}
                </span>
              </td>
              <td>
                <select
                  name={`reason_${l.orderItemId}`}
                  defaultValue=""
                  disabled={disabled}
                  aria-label={`${t('returns.new.col.reason')}: ${l.name}`}
                >
                  <option value="">{t('returns.new.selectReason')}</option>
                  {reasons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {reasonLabel(r, locale)}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
