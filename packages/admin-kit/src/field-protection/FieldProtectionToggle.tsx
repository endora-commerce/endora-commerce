/**
 * The per-field "the import may not have this" control (feature 091, P4b).
 *
 * Three rules it follows, unchanged from the control this generalises:
 *
 *  - **Hidden unless the owner says a connection is enabled.** Not disabled,
 *    not shown with an explanation: an installation with no such integration
 *    has no such concept, and a permanently greyed checkbox beside every field
 *    is noise.
 *  - **Optimistic, and it puts the value back if the server refuses.** The
 *    store owns that half; see `use-field-protection.ts`.
 *  - **The write is the whole set**, because the owner's surface is a
 *    declarative replace.
 *
 * **It renders the source label**, which the single-integration control did not
 * have to. Two connected integrations put two controls beside one field, and
 * *"Protect this field: Name"* twice over tells an operator nothing about which
 * import each one holds off.
 */
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

import { Checkbox } from '../ui/checkbox.js';
import { controlIdPrefix, describeFieldPath } from './describe-path.js';
import { useFieldProtection } from './use-field-protection.js';
import type { FieldProtectionSource } from './types.js';

export interface FieldProtectionToggleProps {
  /** The integration that owns this control — its translator, loader and saver. */
  readonly source: FieldProtectionSource;
  /**
   * `name`, `description`, `categories`, `gallery`, `attachments`,
   * `attributeValues.<key>` or `price.<priceListId>.<currencyCode>` — the
   * grammar the owner's server validates.
   */
  readonly fieldPath: string;
  /** Set it to protect one language and leave the others synchronising. */
  readonly languageCode?: string | null;
  readonly className?: string;
}

export function FieldProtectionToggle({
  source,
  fieldPath,
  languageCode: language,
  className,
}: FieldProtectionToggleProps): ReactNode {
  const protection = useFieldProtection(source);
  const languageCode = language ?? null;
  const checked = protection.isProtected(fieldPath, languageCode);
  // A whole-field protection already covers this language, so its per-language
  // control has nothing left to say — it renders checked and inert rather than
  // offering an unprotect that would silently widen to the whole field.
  const coveredByWholeField = languageCode !== null && protection.isProtected(fieldPath, null);

  if (!protection.available) return null;

  const t = source.t;
  const id = `${controlIdPrefix(source.scopeKey)}-${fieldPath}-${languageCode ?? 'all'}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '-',
  );
  const field = describeFieldPath(t, fieldPath, protection.livePricePaths);
  const label =
    languageCode === null
      ? field
      : t('fieldProtection.summary.item.language', { field, language: languageCode });

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs text-muted-foreground ${
        className ?? ''
      }`}
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={protection.saving || coveredByWholeField}
        // The tooltip states what operating the control *does*, which changes
        // with its state; the accessible name below states what it is about,
        // which does not.
        title={checked ? t('fieldProtection.toggle.unprotect') : t('fieldProtection.toggle.protect')}
        onChange={(event): void => {
          void protection.setProtected(fieldPath, languageCode, event.target.checked);
        }}
      />
      <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-1">
        <Lock size={12} aria-hidden="true" />
        {/* "Protect this field: Description (pl-PL) — Ergonode" to a screen
            reader; a lock, the field name and the integration on screen, where
            the surrounding context supplies the verb. */}
        <span className="sr-only">{t('fieldProtection.toggle.protect')}: </span>
        {label}
        <span className="opacity-70">{source.sourceLabel}</span>
      </label>
      {protection.error ? (
        <span role="status" className="text-destructive">
          {t('fieldProtection.saveFailed')}
        </span>
      ) : null}
    </span>
  );
}
