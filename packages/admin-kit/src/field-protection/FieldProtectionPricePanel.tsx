/**
 * "Pin this price locally" — one control per price the integration could write
 * on this record (feature 091, P4b).
 *
 * ## Why it is a panel and not a toggle beside a number
 *
 * There is no price *input* on the product editor to sit next to: prices are
 * bracket rows on a price list, and the editor's Pricing tab is an index of the
 * lists a product belongs to. So the control goes where the operator already
 * goes to ask "what is this priced at", and names the list and currency it is
 * about — which a toggle floating beside a number could not do.
 *
 * ## Why it renders nothing without a live path
 *
 * `livePricePaths` is the owner's answer to "which prices would an import write
 * here", and it is empty for every record no binding covers. A control for a
 * price the import will never write would promise a protection against nothing.
 */
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

import { FieldProtectionToggle } from './FieldProtectionToggle.js';
import { useFieldProtection } from './use-field-protection.js';
import type { FieldProtectionSource } from './types.js';

export interface FieldProtectionPricePanelProps {
  readonly source: FieldProtectionSource;
  readonly className?: string;
}

export function FieldProtectionPricePanel({
  source,
  className,
}: FieldProtectionPricePanelProps): ReactNode {
  const protection = useFieldProtection(source);
  if (!protection.available) return null;
  if (protection.livePricePaths.length === 0) return null;

  const t = source.t;

  return (
    <div
      className={`rounded-md border border-border bg-muted/30 px-3 py-2 text-xs ${className ?? ''}`}
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Lock size={13} aria-hidden="true" />
        {t('fieldProtection.price.title')}
        <span className="opacity-70">{source.sourceLabel}</span>
      </span>
      <p className="mt-1 text-muted-foreground">{t('fieldProtection.price.description')}</p>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {protection.livePricePaths.map((entry) => (
          <FieldProtectionToggle key={entry.fieldPath} source={source} fieldPath={entry.fieldPath} />
        ))}
      </div>
    </div>
  );
}
