import type { ReactNode } from 'react';

/**
 * BackorderHint — feature 010 / US6.
 *
 * Shown on the PDP under the price / stock badge when the product
 * has `backorderEnabled = true` and cumulative on-hand &lt;= 0.
 * Spec FR-023 — admins can offer pre-orders without forcing the
 * customer through the Notify-when-available flow.
 */
export function BackorderHint(props: { label: string }): ReactNode {
  return (
    <p
      role="status"
      style={{
        marginTop: 8,
        fontSize: 13,
        padding: '8px 10px',
        background: 'rgba(255, 184, 28, 0.12)',
        border: '1px solid rgba(255, 184, 28, 0.55)',
        borderRadius: 4,
        color: 'var(--fg, #111)',
      }}
    >
      {props.label}
    </p>
  );
}
