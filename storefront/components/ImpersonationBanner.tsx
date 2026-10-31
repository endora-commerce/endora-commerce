import type { ReactNode } from 'react';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Storefront impersonation banner (T194). Rendered on every authenticated
 * page when the customer session is actually a Supplier admin acting on
 * behalf of the customer. The buyer sees this and knows their actions
 * during this session are visible + auditable.
 *
 * The component is presentational; the route group's layout decides when
 * to render it based on the `impersonation` field returned by `/me`.
 */

export interface ImpersonationBannerProps {
  impersonatorAdminUserId: string;
  /** The page's locale (issue #85). */
  locale: string;
  /** URL to POST to in order to end the impersonation. Defaults to the canonical endpoint. */
  endActionPath?: string;
}

export function ImpersonationBanner(props: ImpersonationBannerProps): ReactNode {
  const endPath = props.endActionPath ?? '/api/v1/admin/impersonation/end';
  const t = tForLocale(props.locale);
  const [bodyBefore, bodyAfter] = t('chrome.impersonation.body').split('{admin}');
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-warn px-[16px] py-[8px] text-white"
    >
      <span>
        <strong>{t('chrome.impersonation.heading')}</strong> {bodyBefore}
        <code>{props.impersonatorAdminUserId.slice(0, 8)}</code>
        {bodyAfter}
      </span>
      <form action={endPath} method="post">
        <button
          type="submit"
          className="cursor-pointer rounded border-0 bg-white px-[12px] py-[4px] text-fg"
        >
          {t('chrome.impersonation.end')}
        </button>
      </form>
    </div>
  );
}
