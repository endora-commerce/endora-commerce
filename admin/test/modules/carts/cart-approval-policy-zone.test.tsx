import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `carts` contributes the organization detail's cart-approval policy (feature
 * 091, P7b; §10.5).
 *
 * ## The defect this replaces, and it is not the usual one
 *
 * The other three contributions to `organization.detail.after` move a panel the
 * host imported. This one revives a panel **nothing imported**:
 * `admin/src/modules/organizations/panels/CartApprovalPolicyPanel.tsx` was the
 * one `module-namespace` key `organizations` carried in
 * `backend/scripts/ledgers/foreign-module-ids.ts`, recorded because it rendered
 * out of this module's i18n namespace on another module's screen — while the
 * `PATCH` behind it had been live since feature 027. A capability with no
 * screen is a product gap, so the repair is the zone rather than a deletion.
 *
 * ## Two things this contribution needed that the others did not
 *
 * A **read**: the panel took its initial value as a prop and a zone's props may
 * not carry it (Z3), so `carts` grew
 * `GET /api/v1/admin/organizations/:id/cart-approval-policy` beside its
 * `PATCH`, on the same code and in the same shape.
 *
 * And its **copy**: §10.5 recorded eight existing `carts.policy.*` keys.
 * Measured, that spelling resolves to `bundle['carts']['carts.policy.title']`
 * and was in no bundle at all, so the panel had never rendered a translated
 * word. The keys are `policy.*` in this module's own bundle now, in both
 * shipped languages, which is the spelling its shipped keys already use.
 *
 * ## Three cases, not four, and the missing one is asserted rather than skipped
 *
 * `carts` declares `activation.nonDeactivatable`, so it has no off state for a
 * test to drive (`plan.md` Ruling 2). The lock is read from the manifest below;
 * the axis this module does have — the permission — takes the other three.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const carts = await import('@endora-commerce/mod-carts/admin');
const { manifest } = await import('@endora-commerce/mod-carts');

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const POLICY_ROUTE = `/api/v1/admin/organizations/${ORG_ID}/cart-approval-policy`;

const REGISTRY = [{ moduleId: 'carts', contributions: carts.contributions }];

const BUNDLE = passthroughBundle('carts', [
  'policy.title',
  'policy.description',
  'policy.on',
  'policy.off',
  'policy.hint',
  'policy.saving',
  'policy.turnedOn',
  'policy.turnedOff',
  'policy.loadError',
  'policy.saveError',
]);

function renderZone(options: { readonly permissions?: readonly string[] }): HTMLElement {
  const { container } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <AdminZone name="organization.detail.after" props={{ organizationId: ORG_ID }} />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...(options.permissions ?? ['customers:manage'])] }),
        presence: modulePresence({ present: ['carts'] }),
        contributions: REGISTRY,
      },
    ),
    BUNDLE,
  );
  return container;
}

describe('carts contributes the organization detail zone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url === POLICY_ROUTE) {
        return { data: { organizationId: ORG_ID, requiresCartApproval: false, updatedAt: 'x' } };
      }
      throw new Error(`unexpected url ${url}`);
    });
    patchSpy.mockResolvedValue({
      data: { organizationId: ORG_ID, requiresCartApproval: true, updatedAt: 'x' },
    });
  });

  it('declares one zone, with no match and the code both halves of its route enforce', () => {
    const zones = carts.contributions.zones ?? [];
    expect(zones.map((zone) => zone.zone)).toEqual(['organization.detail.after']);
    // `match` narrows the mounts of one place (Z13); this place has one host and
    // one mount, so a `match` would narrow nothing. Asserted absent so a later
    // author cannot add one quietly.
    expect(zones[0]!.match).toBeUndefined();
    // `customers:manage`, not `carts:read`: the panel is a toggle, and a control
    // whose only action 403s is worse than an absent control.
    expect(zones[0]!.requiredPermission).toBe('customers:manage');
    expect(typeof zones[0]!.component).toBe('function');
  });

  it('orders itself last among the organization detail\'s four contributors', () => {
    const zone = (carts.contributions.zones ?? [])[0];
    expect(zone?.weight).toBe(400);
  });

  it('reads its own initial state rather than taking it as a prop', async () => {
    const container = renderZone({});
    await waitFor(() => expect(container.textContent).toContain('policy.title'));
    // The prop this contribution does not have: `initialRequiresCartApproval`
    // used to cross from `organizations`' detail payload.
    expect(getSpy).toHaveBeenCalledWith(POLICY_ROUTE);
    expect(container.textContent).toContain('policy.off');
  });

  it('writes through its own PATCH, on the route it read from', async () => {
    const container = renderZone({});
    await waitFor(() => expect(container.textContent).toContain('policy.title'));
    const toggle = container.querySelector<HTMLInputElement>(`#cart-approval-${ORG_ID}`);
    expect(toggle).toBeTruthy();
    toggle!.click();
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy.mock.calls[0]?.[0]).toBe(POLICY_ROUTE);
    expect(patchSpy.mock.calls[0]?.[1]).toEqual({ requiresCartApproval: true });
  });

  it('renders nothing without customers:manage, and fetches no chunk', async () => {
    // The permission axis, on its own. `carts:read` opens this module's cart
    // list and says nothing about an organization's policy, so it is the wrong
    // code here and is denied along with everything else.
    const container = renderZone({ permissions: ['carts:read'] });
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('restores the zone when the permission comes back', async () => {
    const container = renderZone({ permissions: ['customers:manage'] });
    await waitFor(() => expect(container.textContent).toContain('policy.title'));
  });

  it('renders the copy out of its own bundle, in both shipped languages', async () => {
    // R-1 §9.2: the strings belong to the module whose concept they describe.
    // Asserted against the files rather than the render, because a passthrough
    // bundle would show a missing key as a rendered key either way.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const language of ['en', 'pl'] as const) {
      const bundle = JSON.parse(
        readFileSync(
          resolve(process.cwd(), `../packages/modules/carts/i18n/${language}.json`),
          'utf8',
        ),
      ) as Record<string, string>;
      for (const key of Object.keys(BUNDLE['carts'] ?? {})) {
        expect(bundle[key], `${language}:${key}`).toBeTruthy();
      }
    }
  });

  it('leaves the host owning neither the panel nor this module\'s namespace', async () => {
    // The evidence that the conversion converted something: the one
    // `foreign-module-ids` key `organizations` carried retires on this.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const host = readFileSync(
      // Re-keyed by feature 091's Phase 4 batch 14, not tidied: the host
      // screen moved into its own package, and a `readFileSync` of the old
      // path throws rather than reporting a missing mount. This assertion is
      // derived *about* a file another merge request moves, which is the
      // shape that has produced a stale ledger in every batch that did not
      // look for it.
      resolve(
        process.cwd(),
        '../packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx',
      ),
      'utf8',
    );
    expect(host).not.toContain('CartApprovalPolicyPanel');
    expect(host).toContain('name="organization.detail.after"');
  });

  it('has no off state to drive, and says so from its own manifest', () => {
    // Ruling 2: the fourth case is missing because the platform refuses to have
    // it. Read from the manifest rather than skipped, so a module that stops
    // being locked fails here instead of quietly losing a case.
    expect(manifest.activation).toEqual(expect.objectContaining({ nonDeactivatable: true }));
  });
});
