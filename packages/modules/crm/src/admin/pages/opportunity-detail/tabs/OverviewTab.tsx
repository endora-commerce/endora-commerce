import { useEffect, useId, useState, type ReactNode } from 'react';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { OpportunityCustomFields } from '../../../components/OpportunityCustomFields.js';
import { OpportunityEditForm } from '../../../components/OpportunityEditForm.js';
import { ReferenceText } from '../../../components/ReferenceText.js';
import type { OpportunityTabProps } from '../tabs.js';

/** The edit form's first field — where the keyboard goes when the form opens. */
const EDIT_TITLE_FIELD_ID = 'crm-edit-title';

/**
 * The *Overview* tab of an Opportunity: what the deal is about — its
 * description, with the Products, Orders and people it references — and the
 * fields the operator defined for Opportunities.
 *
 * Everything that is a single fact (value, dates, people, tags) is the page's
 * sidebar; the status is the page's stage bar; the linked documents are the
 * Links tab. What is left here is the prose, which wants the wide column.
 *
 * **The edit form opens here**, in place of the description, when the page's
 * header asks for it: the form edits the title and the description together
 * with the sidebar's facts, and it needs the room.
 */
export function OverviewTab(props: OpportunityTabProps): ReactNode {
  const { opportunity, onChange, editing, onEditingChange } = props;
  const t = useTranslation('crm');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('crm:write');
  const descriptionHeadingId = useId();
  /** Spoken once an edit is saved; the screen itself is the visible confirmation. */
  const [editNotice, setEditNotice] = useState('');

  // The form was opened by a button in the header, a long way from here: the
  // keyboard follows it.
  useEffect(() => {
    if (!editing) return;
    setEditNotice('');
    document.getElementById(EDIT_TITLE_FIELD_ID)?.focus();
  }, [editing]);

  const onEdited = (next: OpportunityDetail): void => {
    onEditingChange(false);
    if (next !== opportunity) {
      onChange(next);
      setEditNotice(t('opportunity.edit.saved'));
    }
  };

  return (
    <div className="divide-y divide-border [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
      {editing && canWrite ? (
        <section>
          <OpportunityEditForm
            opportunity={opportunity}
            onSaved={onEdited}
            onReloaded={onChange}
            onCancel={(): void => onEditingChange(false)}
          />
        </section>
      ) : (
        <section aria-labelledby={descriptionHeadingId} className="space-y-3">
          <h2 id={descriptionHeadingId} className="text-sm font-semibold tracking-tight">
            {t('opportunity.field.description')}
          </h2>
          <p role="status" className="sr-only">
            {editNotice}
          </p>
          {opportunity.description ? (
            <div className="max-w-prose whitespace-pre-wrap break-words text-sm">
              <ReferenceText text={opportunity.description} references={opportunity.references} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {canWrite
                ? t('opportunity.description.empty')
                : t('opportunity.description.emptyReadOnly')}
            </p>
          )}
        </section>
      )}

      <OpportunityCustomFields opportunity={opportunity} canWrite={canWrite} onChange={onChange} />
    </div>
  );
}

export default OverviewTab;
