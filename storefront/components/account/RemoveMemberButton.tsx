'use client';

import { useState, type ReactNode } from 'react';
import { tForLocale } from '../../lib/i18n/messages';
import { richText } from '../../lib/account/labels';
import { accessConfirmDialog } from './AccessConfirmDialog';

/**
 * "Remove" control for a row of `/organization/members` (issue #1178). Removing
 * a member ends another person's access to the Organization at once and cannot
 * be undone from the storefront, so the row's button opens a confirmation
 * (`accessConfirmDialog`) rather than posting the removal. It names the member
 * by name **and** e-mail address — two colleagues can share a name. A refusal
 * the API answers (the last administrator) arrives as the action's own
 * `?error=` redirect.
 */
export function RemoveMemberButton({
  memberId,
  memberName,
  memberEmail,
  locale,
  triggerClassName,
  removeAction,
}: {
  memberId: string;
  memberName: string;
  memberEmail: string;
  /** The page language, from the server page that renders this (issue #85). */
  locale: string;
  /** The row's destructive button class, so the trigger looks as it did. */
  triggerClassName?: string;
  removeAction: (formData: FormData) => void | Promise<void>;
}): ReactNode {
  const t = tForLocale(locale);
  const [failed, setFailed] = useState(false);

  return accessConfirmDialog({
    locale,
    triggerClassName,
    field: { name: 'memberId', value: memberId },
    action: removeAction,
    copy: {
      trigger: t('account.common.remove'),
      title: t('account.members.remove.title'),
      body: richText(t('account.members.remove.body'), {
        name: <strong>{memberName}</strong>,
        email: memberEmail,
      }),
      confirm: t('account.members.remove.confirm'),
      pending: t('account.members.remove.pending'),
      failed: t('account.members.removeFailed'),
    },
    failed,
    setFailed,
  });
}
