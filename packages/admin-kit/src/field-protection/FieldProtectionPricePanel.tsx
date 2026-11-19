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

import {
  EditorSection,
  type EditorSectionChrome,
  type EditorSectionHeading,
} from '../ui/editor-section.js';
import { FieldProtectionToggle } from './FieldProtectionToggle.js';
import { useFieldProtection } from './use-field-protection.js';
import type { FieldProtectionSource } from './types.js';

export interface FieldProtectionPricePanelProps {
  readonly source: FieldProtectionSource;
  readonly className?: string;
  /**
   * `section` (the default, unless the mount says otherwise): a section of the
   * card it is mounted in — the product editor's Pricing tab. `card` where it
   * stands alone on a page (issue #1503, UX audit SHELL-22; the DS-03 rule: a
   * frame inside a card is a defect unless it is a field).
   */
  readonly chrome?: EditorSectionChrome;
  /** The heading level: `h2` by default, `h3` under a titled card or section. */
  readonly titleAs?: EditorSectionHeading;
}

export function FieldProtectionPricePanel({
  source,
  className,
  chrome,
  titleAs,
}: FieldProtectionPricePanelProps): ReactNode {
  const protection = useFieldProtection(source);
  if (!protection.available) return null;
  if (protection.livePricePaths.length === 0) return null;

  const t = source.t;

  return (
    <EditorSection
      title={
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Lock size={14} aria-hidden="true" />
          {t('fieldProtection.price.title')}
          {/* Two connected integrations render two of these sections; without the
              label they are two identical headings. */}
          <span className="font-normal text-muted-foreground">{source.sourceLabel}</span>
        </span>
      }
      description={t('fieldProtection.price.description')}
      {...(chrome ? { chrome } : {})}
      {...(titleAs ? { as: titleAs } : {})}
      {...(className ? { className } : {})}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {protection.livePricePaths.map((entry) => (
          <FieldProtectionToggle key={entry.fieldPath} source={source} fieldPath={entry.fieldPath} />
        ))}
      </div>
    </EditorSection>
  );
}
