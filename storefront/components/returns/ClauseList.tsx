import type { ReactNode } from 'react';
import type { MessageKey } from '../../lib/i18n/messages';
import type { ReturnFormClause } from '@endora-commerce/contracts';

/**
 * The clauses of the returns form (`specs/180-off-platform-complaints/` FR-B30, FR-B31, D-1;
 * design review R-2.4). Each text sits in a bounded region a keyboard can scroll; a
 * `must_accept` clause has a checkbox, never pre-ticked, and an `inform_only` one has none.
 * A clause may link to its full terms, opened in a new tab (owner ruling). Every clause shown
 * is posted as `shownClause = id:revision`, so the server stores what was shown.
 */
export function ClauseList({
  clauses,
  t,
  errorIds = [],
  idPrefix = 'clause',
}: {
  clauses: readonly ReturnFormClause[];
  t: (key: MessageKey) => string;
  /** Clauses the last attempt refused, marked at their checkbox. */
  errorIds?: readonly string[];
  idPrefix?: string;
}): ReactNode {
  return (
    <>
      {clauses.map((clause) => {
        const regionId = `${idPrefix}-${clause.id}-text`;
        const value = `${clause.id}:${clause.revision}`;
        const invalid = errorIds.includes(clause.id);
        return (
          <div key={clause.id} className="space-y-2">
            <input type="hidden" name="shownClause" value={value} />
            {clause.mode === 'inform_only' ? <p className="font-semibold">{t('returns.clauses.pleaseRead')}: {clause.label}</p> : null}
            <div
              id={regionId}
              role="region"
              aria-label={clause.label}
              tabIndex={0}
              className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md border border-line bg-surface-alt p-3 text-[13px]"
            >
              {clause.text}
            </div>
            {clause.linkUrl ? (
              <p className="text-[13px]">
                <a href={clause.linkUrl} target="_blank" rel="noopener noreferrer">
                  {t('returns.clauses.fullTerms')}
                </a>
              </p>
            ) : null}
            {clause.mode === 'must_accept' ? (
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  name="accept"
                  value={value}
                  aria-describedby={regionId}
                  {...(invalid ? { 'aria-invalid': true } : {})}
                />
                {clause.label}
              </label>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
