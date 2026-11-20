import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { EditorSection, useEditorSectionChrome } from '@endora-commerce/admin-kit/ui';
import { DisplayModeOverrideRow } from '../components/DisplayModeOverrideRow.js';

/**
 * The organization detail screen's price-display-mode override (feature 091,
 * P7b).
 *
 * `organizations`' `OrganizationDetail.tsx` used to import
 * `DisplayModeOverrideRow` by path and wrap it in a card of its own, handing it
 * `organizations.detail.pricingLabel` and `organizations.detail.pricingHint`.
 * The place is `organization.detail.after` now, and the scope is *this
 * module's* constant, because the host mounting an organization detail is the
 * only thing that could have said `'organization'`.
 *
 * **The frame is the mount's, not the contribution's** (issue #1437, DS-03).
 * The panel is an `EditorSection` titled `organizationPanel.title`, so it
 * follows the mount: the organization detail mounts this zone at page level
 * with `chrome="card"`, which makes it one titled card between the host's own;
 * a host that mounts the zone inside a card gets a section of that card instead
 * of a card in a card. It used to be a header-less `Card` in both places. The
 * heading names the panel and the row still labels its control, because a host
 * cannot title a contributor it does not know.
 *
 * **No `match`, and it is a decision rather than an omission.** `match` narrows
 * the mounts of one place (Z13); this place has one host and one mount, so
 * there is nothing to narrow.
 * `admin/test/modules/price_lists/price-lists-zones.test.tsx` asserts it absent
 * so a later author cannot add one quietly.
 */
export type OrganizationDisplayModeProps = AdminZoneProps<'organization.detail.after'>;

export function OrganizationDisplayMode({
  organizationId,
  saveSession,
}: OrganizationDisplayModeProps): ReactNode {
  const t = useTranslation('price_lists');
  // A card keeps the gap its sibling panels in this zone keep; a section is spaced by its host.
  const carded = useEditorSectionChrome() === 'card';
  return (
    <EditorSection title={t('organizationPanel.title')} className={carded ? 'mb-4' : undefined}>
      {/* Feature 180, WP-7 — the organization detail's Save writes the mode (FR-060). */}
      <DisplayModeOverrideRow scope="organization" targetId={organizationId} saveSession={saveSession} />
      {/* Feature 161 (FR-024): what this organization pays, and why. */}
      <ExplainLink organizationId={organizationId} />
    </EditorSection>
  );
}

function ExplainLink({ organizationId }: { readonly organizationId: string }): ReactNode {
  const t = useTranslation('price_lists');
  return (
    <Link
      to={`/price-lists/explain?${new URLSearchParams({ organizationId }).toString()}`}
      className="inline-block text-sm underline underline-offset-2"
    >
      {t('explainer.entry.organization')}
    </Link>
  );
}

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013).
 */
export default OrganizationDisplayMode;
