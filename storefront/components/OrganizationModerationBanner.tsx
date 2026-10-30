import type { ReactNode } from 'react';
import type { OrganizationLifecycleStatus } from '../lib/api/account';
import { tForLocale, type MessageKey } from '../lib/i18n/messages';

/**
 * Storefront banner shown on cart + checkout pages when the customer's
 * Organization cannot transact (feature 026, US1 / US3).
 *
 * Receives the localized `message` directly from `GET /api/v1/me`. The
 * server is the source of truth for the user-facing wording so wording
 * changes don't require redeploying the storefront. The title above it is
 * the storefront's own chrome and comes from the catalogue (issue #85).
 *
 * Renders `null` when the org is active or absent. Cart/checkout pages
 * can `<OrganizationModerationBanner ... />` unconditionally.
 */
export interface OrganizationModerationBannerProps {
  status: OrganizationLifecycleStatus | string | undefined;
  message: string | null | undefined;
  /** The page language, for the title. */
  locale: string;
}

export function OrganizationModerationBanner(
  props: OrganizationModerationBannerProps,
): ReactNode {
  if (!props.status || props.status === 'active') return null;
  if (!props.message) return null;

  const palette = paletteFor(props.status);

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 rounded-md border px-[16px] py-[12px]"
      // Colours are status-driven (dynamic palette) — kept inline per the dynamic-styles rule.
      style={{
        background: palette.background,
        borderColor: palette.border,
        color: palette.text,
      }}
    >
      <strong className="mb-1 block">{tForLocale(props.locale)(palette.title)}</strong>
      <span>{props.message}</span>
    </div>
  );
}

function paletteFor(status: string): {
  background: string;
  border: string;
  text: string;
  title: MessageKey;
} {
  switch (status) {
    case 'pending_verification':
      return {
        background: '#fef3c7',
        border: '#fcd34d',
        text: '#7c4a03',
        title: 'organization.moderation.pendingVerification',
      };
    case 'blocked':
      return {
        background: '#fee2e2',
        border: '#fca5a5',
        text: '#7f1d1d',
        title: 'organization.moderation.blocked',
      };
    case 'rejected':
      return {
        background: '#e5e7eb',
        border: '#9ca3af',
        text: '#374151',
        title: 'organization.moderation.rejected',
      };
    default:
      return {
        background: '#fef3c7',
        border: '#fcd34d',
        text: '#7c4a03',
        title: 'organization.moderation.unavailable',
      };
  }
}
