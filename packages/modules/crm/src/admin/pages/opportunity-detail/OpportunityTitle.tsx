import type { ReactNode } from 'react';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import { InlineEditTitle, type InlineEditTitleProps } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useOpportunityUpdate } from '../../lib/use-opportunity-update.js';

/** The title's limit — `opportunityCreateShape.title` in `@endora-commerce/contracts`. */
const TITLE_MAX_LENGTH = 200;

export interface OpportunityTitleProps
  extends Omit<InlineEditTitleProps, 'value' | 'label' | 'canEdit' | 'maxLength' | 'validate' | 'save'> {
  opportunity: OpportunityDetail;
  /** `crm:write` — without it the title is read and nothing more. */
  canWrite: boolean;
  onChange: (next: OpportunityDetail) => void;
}

/**
 * The page's header with the Opportunity's title **edited where it is read**
 * (`specs/158-crm-opportunity-inline-editing/`, FR-001) — the kit's
 * `InlineEditTitle` (issue #1453), saved through the Opportunity's `PATCH`.
 * Somebody else's save first is the conflict sentence of
 * `useOpportunityUpdate`.
 */
export function OpportunityTitle(props: OpportunityTitleProps): ReactNode {
  const { opportunity, canWrite, onChange, ...header } = props;
  const t = useTranslation('crm');
  const update = useOpportunityUpdate(opportunity, onChange);
  return (
    <InlineEditTitle
      {...header}
      value={opportunity.title}
      label={t('opportunity.field.title')}
      canEdit={canWrite}
      maxLength={TITLE_MAX_LENGTH}
      validate={(draft): string | null => (draft === '' ? t('opportunity.create.error.title') : null)}
      save={(title): Promise<void> => update({ title })}
    />
  );
}
