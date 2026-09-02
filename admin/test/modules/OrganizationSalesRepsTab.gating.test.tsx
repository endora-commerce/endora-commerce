import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithI18n, passthroughBundle } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * D-166 — the sales-rep panel is gated, and it was gated by nothing.
 *
 * The panel was mounted unconditionally from `OrganizationDetail.tsx`. Two
 * consequences, both live on `master` before this merge request:
 *
 *  * **No permission gate.** Its three endpoints are `requireAdmin`-gated, so an
 *    operator whose role does not hold the code saw the card, its "Assign"
 *    control and a red banner carrying the 403 — a screen advertised and then
 *    refused, which Principle XVI forbids for the palette and which is no better
 *    on a detail page.
 *  * **No presence gate.** Until D-166 the endpoints were registered by
 *    `quote_requests`, so switching quote requests off made the panel render a
 *    503 `MODULE_DISABLED` banner on the organisation screen — Constitution XVII
 *    item 5 in as many words ("a module that is off contributes no … tab").
 *
 * The split repairs the second structurally: the three endpoints belong to
 * `organizations` now, which cannot be switched off. The first is repaired here,
 * with the same predicate every other index in the admin uses
 * (`useSurfaceVisibility`), so the panel cannot drift into a fourth answer to
 * "may this operator see this".
 *
 * The gate lives **in the panel**, not at its call site. There is one call site
 * today; a gate written there is a gate the author of the second one has to
 * remember, and the whole reason issue #230 exists is that three call sites
 * remembered three different things.
 */

/** The codes the operator holds, and the modules the projection reports, per case. */
let permissions: readonly string[] = [];
let presentModules: readonly string[] = ['organizations'];



const get = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { OrganizationSalesRepsTab } = await import(
  '../../src/modules/organizations/OrganizationSalesRepsTab'
);

const bundle = passthroughBundle('core', [
  'organizations.salesReps.title',
  'organizations.salesReps.empty',
  'organizations.salesReps.assign',
  'organizations.salesReps.assignLabel',
  'organizations.salesReps.column.name',
  'organizations.salesReps.column.email',
  'organizations.salesReps.column.assignedAt',
  'organizations.salesReps.searchPlaceholder',
  'organizations.salesReps.searching',
  'organizations.salesReps.noMatch',
  'organizations.salesReps.loading',
]);

describe('OrganizationSalesRepsTab visibility (D-166)', () => {
  beforeEach(() => {
    permissions = [];
    presentModules = ['organizations'];
    get.mockReset();
    get.mockResolvedValue({ data: [] });
  });

  it('renders nothing, and calls nothing, without organizations:assign-sales-rep', async () => {
    const { container } = renderWithI18n(
      withSession(<OrganizationSalesRepsTab organizationId="org-1" />, {
        session: adminSession({ permissions: [...permissions] }),
        presence: modulePresence({ present: [...presentModules] }),
      }),
      bundle,
    );
    expect(container).toBeEmptyDOMElement();
    // The absence has to be a *non-render*, not a hidden card: a mounted panel
    // that fetches is a 403 in the network log on every organisation opened.
    await waitFor(() => {
      expect(get).not.toHaveBeenCalled();
    });
  });

  it('renders the panel with the code', async () => {
    permissions = ['organizations:assign-sales-rep'];
    renderWithI18n(
      withSession(<OrganizationSalesRepsTab organizationId="org-1" />, {
        session: adminSession({ permissions: [...permissions] }),
        presence: modulePresence({ present: [...presentModules] }),
      }),
      bundle,
    );
    await screen.findByText('organizations.salesReps.title');
    expect(get).toHaveBeenCalled();
  });

  it('renders nothing when the owning module is absent', async () => {
    permissions = ['organizations:assign-sales-rep'];
    presentModules = [];
    const { container } = renderWithI18n(
      withSession(<OrganizationSalesRepsTab organizationId="org-1" />, {
        session: adminSession({ permissions: [...permissions] }),
        presence: modulePresence({ present: [...presentModules] }),
      }),
      bundle,
    );
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => {
      expect(get).not.toHaveBeenCalled();
    });
  });
});
