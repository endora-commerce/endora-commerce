'use client';

import { useState, type ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { richText } from '../../lib/account/labels';
import { accessConfirmDialog } from './AccessConfirmDialog';

/**
 * "Revoke" control for a pending invitation on `/organization/members`
 * (issue #1214). Revoking makes the invitation's link stop working at once, so
 * the row's button opens the same confirmation as removing a member
 * (`accessConfirmDialog`) rather than posting from the row. An invitation has
 * no name yet, so it is named by the address it was sent to. Unlike a removal
 * it can be made good — a new invitation can be sent — and the warning says so
 * rather than claiming it cannot be undone.
 */
export function RevokeInvitationButton({
  invitationId,
  email,
  locale,
  triggerClassName,
  revokeAction,
}: {
  invitationId: string;
  email: string;
  /** The page language, from the server page that renders this (issue #85). */
  locale: string;
  /** The row's destructive button class, so the trigger looks as it did. */
  triggerClassName?: string;
  revokeAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const t = tForLocale(locale);
  const [failed, setFailed] = useState(false);

  return accessConfirmDialog({
    locale,
    triggerClassName,
    field: { name: 'invitationId', value: invitationId },
    action: revokeAction,
    copy: {
      trigger: t('account.members.pending.revoke'),
      title: t('account.members.revoke.title'),
      body: richText(t('account.members.revoke.body'), { email: <strong>{email}</strong> }),
      confirm: t('account.members.revoke.confirm'),
      pending: t('account.members.revoke.pending'),
      failed: t('account.members.revokeFailed'),
    },
    failed,
    setFailed,
  });
}
