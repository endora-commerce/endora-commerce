import { useCallback, useRef, type ReactNode } from 'react';
import type { OpportunityComment } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../../../api.js';
import { CommentThread } from '../../../components/CommentThread.js';
import type { OpportunityTabProps } from '../tabs.js';

/**
 * The *Messages* tab (User Story 4): the conversation between the people
 * working an Opportunity. A message cannot be changed or deleted once sent,
 * and sending one notifies the assignee and everybody who has written here.
 *
 * **Opening the tab reads the messages.** The tab's label counts the ones the
 * signed-in administrator has not read; once the conversation is on screen the
 * server is told how far it was read — up to the last message shown, so one
 * that arrives a moment later stays unread — and the number on the label is
 * what the server answers. It is told again only when a message of somebody
 * else's appears: one's own are never unread, so sending one says nothing new.
 * A reader without `crm:write` reads like anybody else.
 */
export function MessagesTab(props: OpportunityTabProps): ReactNode {
  const t = useTranslation('crm');
  const { me } = useAuth();
  const myId = me?.adminUser.id ?? null;
  const opportunityId = props.opportunity.id;
  // The answer of a request arrives later: it meets the Opportunity then on screen.
  const latest = useRef(props);
  latest.current = props;
  /** The newest message of somebody else's the server was told about. */
  const toldAbout = useRef<string | null>(null);

  const onEntries = useCallback(
    (entries: readonly OpportunityComment[]): void => {
      const last = entries[entries.length - 1];
      const newestOfOthers = [...entries].reverse().find((entry) => entry.author.id !== myId);
      if (!last || !newestOfOthers || toldAbout.current === newestOfOthers.id) return;
      toldAbout.current = newestOfOthers.id;
      crmApi
        .markMessagesRead(opportunityId, last.id)
        .then(({ unreadMessageCount }) => {
          const { opportunity, onChange } = latest.current;
          if (opportunity.id !== opportunityId || opportunity.unreadMessageCount === unreadMessageCount) return;
          onChange({ ...opportunity, unreadMessageCount });
        })
        .catch(() => {
          // The messages were shown; only the label is behind. It is said again
          // with the next message, or the next visit.
          toldAbout.current = null;
        });
    },
    [opportunityId, myId],
  );

  return (
    <CommentThread
      opportunityId={opportunityId}
      organizationId={props.opportunity.organization.id}
      kind="message"
      onEntries={onEntries}
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
