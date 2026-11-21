import type { ReactNode } from 'react';
import type { OpportunityDetail } from '@endora-commerce/contracts';
import { InlineEdit } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { AssigneeName } from './AssigneeName.js';
import { AssigneeLookup } from './LookupPickers.js';

export interface AssigneeSectionProps {
  opportunity: OpportunityDetail;
  canWrite: boolean;
  /** The Opportunity as the assignment endpoint answered it. */
  onChange: (next: OpportunityDetail) => void;
}

/**
 * Who holds the Opportunity, and — for a holder of `crm:write` — the change
 * of it (`contracts/admin-api.md` §5).
 *
 * **One fact of the sidebar, edited as its neighbours are** — the kit's
 * `InlineEdit` (issue #1525, UX audit 2026-11-17 WORK-03): the name and a
 * pencil, then the lookup with *Save* and *Cancel*. *Save* posts the
 * assignment through its own endpoint, a cleared choice unassigns. A refusal
 * (`CRM_ASSIGNEE_INVALID` — somebody deactivated meanwhile) is shown in the
 * server's sentence under the lookup and the choice is kept for another try.
 * Assigning notifies the new assignee; nothing here does.
 */
export function AssigneeSection(props: AssigneeSectionProps): ReactNode {
  const { opportunity, canWrite, onChange } = props;
  const t = useTranslation('crm');
  const assignee = opportunity.assignee;
  const label = t('assignment.label');

  return (
    <InlineEdit<string | null>
      label={label}
      canEdit={canWrite}
      display={<AssigneeName assignee={assignee} />}
      initial={(): string | null => assignee?.id ?? null}
      unchanged={(draft): boolean => draft === (assignee?.id ?? null)}
      save={async (draft): Promise<void> => {
        try {
          onChange(await crmApi.assign(opportunity.id, draft));
        } catch (failure) {
          throw new Error(errorMessage(failure, t('assignment.error')));
        }
      }}
      editor={({ id, draft, setDraft, busy, errorId }): ReactNode => (
        <AssigneeLookup
          id={id}
          ariaLabel={label}
          value={draft}
          disabled={busy}
          onChange={setDraft}
          placeholder={t('assignment.picker.placeholder')}
          emptyMessage={t('assignment.picker.empty')}
          ariaDescribedBy={errorId}
          invalid={errorId !== undefined}
          {...(assignee && draft === assignee.id ? { selectedLabel: assignee.name } : {})}
        />
      )}
    />
  );
}
