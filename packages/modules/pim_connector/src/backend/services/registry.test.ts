import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  PimConnectorRegistryService,
  type PimConnectorFamilyReader,
} from './pim-connector-registry.service.js';

/**
 * Feature 132 (T018) — the registry answers from the **derived family**, resolved
 * against **effective** module state (`capability-exclusivity.md` R2.1, R2.2).
 *
 * ## Why this file was rewritten rather than extended
 *
 * What it asserted before was correct and proved nothing that mattered. It
 * constructed the service with `isOperatorActivated: (id) => id === 'pim_ergonode'`
 * — a stub of one axis — so it could not see either of the two defects the
 * service actually had. It could not see that the member list came from
 * `PIM_CONNECTOR_MODULES`, which named two of the four shipped connectors; and it
 * could not see that the axis it stubbed was the *wrong* axis, because
 * `presence(id)?.operatorActivated` answers `true` for a module whose platform
 * availability is off — a connector the deployment never installed holding a
 * claim that refuses another (Principle XVII, spec FR-012).
 *
 * So the seam moved: the service now takes a reader that answers **which members
 * are effectively present**, and the conjunction is computed by
 * `effectiveState.membersOfCapability` rather than re-derived here. A fixture can
 * therefore state the whole question — "these members are present" — instead of
 * stubbing one half of it.
 */

function familyReader(activeMembers: readonly string[]): PimConnectorFamilyReader {
  return { activeMembers: () => activeMembers };
}

function serviceWith(activeMembers: readonly string[]): PimConnectorRegistryService {
  return new PimConnectorRegistryService(
    () => {
      throw new Error('emFactory not used');
    },
    familyReader(activeMembers),
  );
}

describe('pim_connector registry — assertCanActivate over the derived family', () => {
  it('refuses when another member of the family is effectively present', async () => {
    const service = serviceWith(['pim_ergonode']);

    await expect(service.assertCanActivate('pim_unopim')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.statusCode).toBe(409);
      expect(httpError.code).toBe(ERROR_CODES.PIM_CONNECTOR_ALREADY_ACTIVE);
      expect(httpError.details).toEqual({ activeModuleId: 'pim_ergonode' });
      return true;
    });
  });

  it('refuses for a member the old array never listed — the family is derived now', async () => {
    // `PIM_CONNECTOR_MODULES` held `pim_ergonode` and `pim_unopim`, so an active
    // `pim_pimcore` refused nothing and was refused by nothing. This is the pair
    // the array could not see.
    const service = serviceWith(['pim_pimcore']);

    await expect(service.assertCanActivate('pim_akeneo')).rejects.toSatisfy((error: unknown) => {
      expect((error as HttpError).details).toEqual({ activeModuleId: 'pim_pimcore' });
      return true;
    });
  });

  it('passes when no other member is effectively present', async () => {
    await expect(serviceWith([]).assertCanActivate('pim_unopim')).resolves.toBeUndefined();
  });

  it('does not refuse a member against itself — re-activating the holder is not a conflict', async () => {
    // The route is idempotent: `POST {active:true}` on the module that already
    // holds the claim must not be refused by the claim it holds.
    await expect(
      serviceWith(['pim_unopim']).assertCanActivate('pim_unopim'),
    ).resolves.toBeUndefined();
  });

  it('names the first other member when several are somehow present', async () => {
    // The state the exclusion exists to prevent, met rather than assumed: the
    // refusal still names *a* holder rather than throwing something shapeless.
    const service = serviceWith(['pim_akeneo', 'pim_pimcore']);
    await expect(service.assertCanActivate('pim_unopim')).rejects.toSatisfy((error: unknown) => {
      expect((error as HttpError).details).toEqual({ activeModuleId: 'pim_akeneo' });
      return true;
    });
  });

  it('names no module id of its own — the family is the reader\'s answer', () => {
    // R1.5's measurable form, at the level a unit test can hold: the service is
    // constructible and answers correctly for a family it has never heard of, so
    // it cannot be carrying a connector id anywhere.
    const service = serviceWith(['some_third_party_pim']);
    expect(service).toBeInstanceOf(PimConnectorRegistryService);
    return expect(service.assertCanActivate('another_third_party_pim')).rejects.toSatisfy(
      (error: unknown) => {
        expect((error as HttpError).details).toEqual({ activeModuleId: 'some_third_party_pim' });
        return true;
      },
    );
  });
});
