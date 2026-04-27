import type { ReactNode } from 'react';

/**
 * Admin-side impersonation banner (T194). Presentational primitive: render
 * a sticky warning bar across the top of the admin app whenever an
 * impersonation session is active, with an explicit "End impersonation"
 * button that POSTs `/api/v1/admin/impersonation/end`.
 *
 * Wiring: AppShell decides when to render this — typically by polling
 * the current admin's session or by stashing local state when a start
 * action succeeds. The component itself is dumb on purpose so themes and
 * tests can render it standalone.
 */
export interface ImpersonationBannerProps {
  customerLabel: string;
  onEnd: () => void | Promise<void>;
}

export function ImpersonationBanner(props: ImpersonationBannerProps): ReactNode {
  return (
    <div
      role="alert"
      style={{
        background: 'var(--color-warning)',
        color: '#fff',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <span>
        <strong>Impersonating</strong> {props.customerLabel}. Every action is audit-logged
        against your admin account.
      </span>
      <button
        className="btn"
        type="button"
        style={{ background: '#fff', color: 'var(--color-text)' }}
        onClick={(): void => void props.onEnd()}
      >
        End impersonation
      </button>
    </div>
  );
}
