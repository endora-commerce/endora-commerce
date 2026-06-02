import type { ReactNode } from 'react';

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
  /** URL to POST to in order to end the impersonation. Defaults to the canonical endpoint. */
  endActionPath?: string;
}

export function ImpersonationBanner(props: ImpersonationBannerProps): ReactNode {
  const endPath = props.endActionPath ?? '/api/v1/admin/impersonation/end';
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-warn px-[16px] py-[8px] text-white"
    >
      <span>
        <strong>Support session active.</strong> An administrator (
        <code>{props.impersonatorAdminUserId.slice(0, 8)}</code>) is signed in as you. Anything
        you do here is logged.
      </span>
      <form action={endPath} method="post">
        <button
          type="submit"
          className="cursor-pointer rounded border-0 bg-white px-[12px] py-[4px] text-fg"
        >
          End support session
        </button>
      </form>
    </div>
  );
}
