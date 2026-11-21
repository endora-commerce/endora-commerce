import { useId, type ReactNode } from 'react';
import { InlineEdit, ReferenceText } from '@endora-commerce/admin-kit/components';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { OpportunityCustomFields } from '../../../components/OpportunityCustomFields.js';
import { ReferenceField } from '../../../components/ReferenceField.js';
import { useOrderStatusLabel } from '../../../lib/references.js';
import { useOpportunityUpdate } from '../../../lib/use-opportunity-update.js';
import type { OpportunityTabProps } from '../tabs.js';

/** The description's limit — `opportunityCreateShape.description` in `@endora-commerce/contracts`. */
const DESCRIPTION_MAX_LENGTH = 20_000;

/**
 * The *Overview* tab of an Opportunity: what the deal is about — its
 * description, with the Products, Orders and people it references — and the
 * fields the operator defined for Opportunities.
 *
 * Everything that is a single fact (value, dates, people, tags) is the page's
 * sidebar; the status is the page's stage bar; the linked documents are the
 * Links tab. What is left here is the prose, which wants the wide column.
 *
 * **Each is edited where it is shown** (`specs/158-crm-opportunity-inline-editing/`,
 * FR-002): the description in the formatted field, in place of the text, with
 * its own *Save* (or Ctrl/Cmd + Enter) and *Cancel*; the custom fields in
 * their own panel, as before.
 */
export function OverviewTab(props: OpportunityTabProps): ReactNode {
  const { opportunity, onChange } = props;
  const t = useTranslation('crm');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const descriptionHeadingId = useId();
  const update = useOpportunityUpdate(opportunity, onChange);
  const stored = opportunity.description ?? '';
  const orderStatusLabel = useOrderStatusLabel(props.orderStatuses);

  return (
    <div className="divide-y divide-border [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
      <section aria-labelledby={descriptionHeadingId} className="space-y-3">
        <h2 id={descriptionHeadingId} className="text-sm font-semibold tracking-tight">
          {t('opportunity.field.description')}
        </h2>
        <InlineEdit<string>
          label={t('opportunity.field.description')}
          labelVisible={false}
          canEdit={canWrite}
          display={
            stored ? (
              <div className="max-w-prose">
                <ReferenceText
                  text={stored}
                  references={opportunity.references}
                  orderStatusLabel={orderStatusLabel}
                />
              </div>
            ) : (
              <p className="text-muted-foreground">
                {canWrite ? t('opportunity.description.empty') : t('opportunity.description.emptyReadOnly')}
              </p>
            )
          }
          initial={(): string => stored}
          unchanged={(draft): boolean => draft.trim() === stored.trim()}
          save={(draft): Promise<void> =>
            update({ description: draft.trim() === '' ? null : draft.trim() })
          }
          editor={({ id, draft, setDraft, busy, errorId, submit }): ReactNode => (
            <ReferenceField
              id={id}
              rows={6}
              value={draft}
              maxLength={DESCRIPTION_MAX_LENGTH}
              organizationId={opportunity.organization.id}
              opportunityId={opportunity.id}
              references={opportunity.references}
              disabled={busy}
              {...(errorId ? { 'aria-invalid': true, 'aria-describedby': errorId } : {})}
              onValueChange={setDraft}
              onSubmitShortcut={submit}
            />
          )}
        />
      </section>

      <OpportunityCustomFields opportunity={opportunity} canWrite={canWrite} onChange={onChange} />
    </div>
  );
}

export default OverviewTab;
