import type { ReactNode } from 'react';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { CommentThread } from '../../../components/CommentThread.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Messages* tab (User Story 4): the conversation between the people
 * working an Opportunity. A message cannot be changed or deleted once sent,
 * and sending one notifies the assignee and everybody who has written here.
 */
export function MessagesTab(props: OpportunityTabProps): ReactNode {
  const t = useTranslation('crm');
  return (
    <CommentThread
      opportunityId={props.opportunity.id}
      kind="message"
      copy={{
        title: t('opportunity.tabs.messages'),
        empty: t('comments.messages.empty'),
        hint: t('comments.messages.hint'),
        composerLabel: t('comments.messages.composer.label'),
        composerPlaceholder: t('comments.messages.composer.placeholder'),
        composerSubmit: t('comments.messages.composer.submit'),
        added: t('comments.messages.added'),
      }}
    />
  );
}

export default MessagesTab;
