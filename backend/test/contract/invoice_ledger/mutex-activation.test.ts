import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, ERROR_CODES } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';
import { deploymentFamilyOf } from '../../helpers/capability-families.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T079 / SC-008 — `invoice_ledger`'s vendor mutex, as the free module's own
 * **generic** contract (feature 134, T139, `research.md` D23 §2).
 *
 * `invoice-ledger-vendor` is an exclusive capability, and its refusal is split
 * between two owners: `invoice_ledger` mints it (`assertCanActivate`), while the
 * `refuse-when-sibling-ledger-vendor-active` interceptor that asks for it on
 * `POST /api/v1/admin/modules/:id/activation` is **each member's own code**. So
 * what this file proves is a property of a *pair*: for every ordered pair
 * `(a, b)` of the declared family, with `b` operator-active, `a`'s activation is
 * refused naming `b` — on the route, which reaches `a`'s interceptor, and on the
 * live port. One member gives zero pairs (D13 §6).
 *
 * ## The family is derived, and no vendor is named here
 *
 * The population is the `example` deployment's resolved manifest set, filtered
 * by the capability key — never a written-down list (D-100). `deployment:
 * 'example'` is load-bearing twice: it composes the overlay fixtures, and an
 * overlay module's capability declaration is invisible to a resolution taken
 * under any other deployment. Every packaged ledger vendor is a paid module
 * leaving this repository (wave 4), so the guard below asks that the members the
 * deployment declares **itself** form a pair on their own — the shape
 * `integration/pim_connector/*` took for the PIM family (T113). Without that, a
 * departure would turn this file vacuous on `master`, where no merge-request
 * pipeline runs the contract tree (D-198).
 *
 * The `infakt`-specific cases — its own activation and its channel API key save —
 * live in `../infakt/mutex-activation.test.ts`, a host file that leaves with the
 * package.
 *
 * ## The injected sibling is a different property
 *
 * The harness's `invoiceLedgerVendorModules` option adds a sibling the registry
 * knows only by **injection** — no manifest, no route, no interceptor. It proves
 * that the registry refuses on behalf of a sibling it was handed, which the
 * declared pairs cannot, and it is kept for that reason alone.
 */

const DEPLOYMENT = 'example';
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const INJECTED_SIBLING = {
  id: 'ledger_fixture',
  activationSettingCode: 'ledger_fixture.activation',
} as const;

const FAMILY = await deploymentFamilyOf(CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR, DEPLOYMENT);

const ORDERED_PAIRS: ReadonlyArray<readonly [string, string]> = FAMILY.members.flatMap((a) =>
  FAMILY.members.filter((b) => b !== a).map((b) => [a, b] as const),
);

const activationUrl = (moduleId: string): string =>
  `/api/v1/admin/modules/${moduleId}/activation`;

const extraActive = new Set<string>();

function expectAlreadyActive(error: unknown, activeModuleId: string): true {
  expect(error).toBeInstanceOf(HttpError);
  const httpError = error as HttpError;
  expect(httpError.statusCode).toBe(409);
  expect(httpError.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
  expect(httpError.details).toEqual({ activeModuleId });
  expect(httpError.details).not.toHaveProperty('salesChannelId');
  return true;
}

describe('invoice_ledger — vendor mutex over every ordered pair [contract]', () => {
  let h: BackendServerHandle;

  async function setActive(moduleId: string, active: boolean): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: activationUrl(moduleId),
      ...ADMIN,
      payload: { active },
    });
    expect(
      res.statusCode,
      `${active ? 'activating' : 'deactivating'} '${moduleId}': ${res.body}`,
    ).toBe(200);
  }

  /** Deactivation is never refused by the exclusion seam (R2.4), so this always clears. */
  async function familyOff(): Promise<void> {
    for (const member of FAMILY.members) await setActive(member, false);
  }

  async function expectRouteRefusal(moduleId: string, activeModuleId: string): Promise<void> {
    const refused = await h.app.inject({
      method: 'POST',
      url: activationUrl(moduleId),
      ...ADMIN,
      payload: { active: true },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    const body = refused.json() as {
      error: { code: string; details?: { activeModuleId?: string; salesChannelId?: string } };
    };
    expect(body.error.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
    expect(body.error.details?.activeModuleId).toBe(activeModuleId);
    expect(body.error.details).not.toHaveProperty('salesChannelId');
  }

  beforeAll(async () => {
    extraActive.clear();
    h = await setupBackendServer({
      deployment: DEPLOYMENT,
      invoiceLedgerVendorModules: [...FAMILY.members.map((id) => ({ id })), INJECTED_SIBLING],
      invoiceLedgerPresence: {
        isOperatorActivated(moduleId) {
          if (extraActive.has(moduleId)) return true;
          return effectiveState.presence(moduleId)?.operatorActivated ?? false;
        },
      },
    });
    // The harness seeds every module operator-active and the suite shares one
    // database, so a member left on by an earlier file is a real state.
    await familyOff();
  }, 60_000);

  afterAll(async () => {
    extraActive.clear();
    // Leave the family clear for whatever file runs next against this database.
    await familyOff();
    await teardownBackendServer(h);
  });

  it('the deployment declares a pair of ledger vendors of its own (D23 §2)', () => {
    // Exclusion is a property of a pair, and one member gives zero pairs. The
    // overlay members are the ones that stay when every packaged vendor has left
    // this repository, so they must form a pair on their own.
    expect(
      FAMILY.members.length,
      'research.md D23 §2 — the declared invoice-ledger-vendor family needs two members',
    ).toBeGreaterThanOrEqual(2);
    expect(
      FAMILY.overlay.length,
      'research.md D23 §2 — the example deployment must declare two ledger vendors itself',
    ).toBeGreaterThanOrEqual(2);
    expect(ORDERED_PAIRS).toHaveLength(FAMILY.members.length * (FAMILY.members.length - 1));
  });

  it.each(FAMILY.members)('activates %s when no sibling is operator-active', async (member) => {
    await familyOff();
    const res = await h.app.inject({
      method: 'POST',
      url: activationUrl(member),
      ...ADMIN,
      payload: { active: true },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ module: { id: member, activated: true, present: true } });
    await setActive(member, false);
  });

  it.each(ORDERED_PAIRS)(
    'refuses activating %s while %s is operator-active — route and live port',
    async (subject, incumbent) => {
      await familyOff();
      await setActive(incumbent, true);
      try {
        await expectRouteRefusal(subject, incumbent);
        await expect(h.invoiceLedgerRegistry.assertCanActivate(subject)).rejects.toSatisfy(
          (error: unknown) => expectAlreadyActive(error, incumbent),
        );
        expect(effectiveState.presence(subject)?.operatorActivated).toBe(false);
      } finally {
        await setActive(incumbent, false);
      }
    },
  );

  it.each(FAMILY.members)(
    'refuses activating %s while the injected sibling is operator-active',
    async (member) => {
      await familyOff();
      extraActive.add(INJECTED_SIBLING.id);
      try {
        await expectRouteRefusal(member, INJECTED_SIBLING.id);
      } finally {
        extraActive.delete(INJECTED_SIBLING.id);
      }
    },
  );

  it.each(FAMILY.members)(
    'assertCanActivate(injected sibling) on the live port names %s while it is active (FR-003)',
    async (member) => {
      await familyOff();
      await setActive(member, true);
      try {
        await expect(
          h.invoiceLedgerRegistry.assertCanActivate(INJECTED_SIBLING.id),
        ).rejects.toSatisfy((error: unknown) => expectAlreadyActive(error, member));
      } finally {
        await setActive(member, false);
      }
    },
  );
});
