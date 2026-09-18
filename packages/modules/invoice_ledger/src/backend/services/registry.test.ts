import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { InvoiceLedgerRegistryService } from './invoice-ledger-registry.service.js';

/**
 * T078 / T080 / SC-008, rewritten by feature 132 (T026/T028).
 *
 * **What changed and why the file had to move with it.** The vendor family was
 * `INVOICE_LEDGER_MODULES`, a hand-written array in `@endora-commerce/contracts`, and
 * several cases here constructed the service on its *default* — the "production
 * table" — and asserted the array's own contents. Both are gone: the family is now
 * derived from the members' own manifest declarations, so
 *
 *  - **the population cannot be asserted from inside this package.** A module may not
 *    name the host's manifest index, and the derivation needs one. That claim moved to
 *    `backend/test/contract/kernel/capability-registry.test.ts`, which derives it on
 *    **both** sides from that index rather than writing the expected list down (D-100)
 *    — which is exactly what the deleted case here did, and what went stale when a
 *    third connector shipped.
 *  - **every case supplies the family explicitly**, through the constructor seam that
 *    was already open for this purpose. It is passed as a **function** where the shape
 *    matters, because that is what production now supplies: the derived family is
 *    re-installed on every module-state refresh and a list read once would out-live it.
 *
 * What did not change: the port's shape, the code, the 409, and the
 * `{ activeModuleId }` detail an admin client already reads.
 */
const OTHER_VENDOR = { id: 'other_ledger_vendor' };
const LEDGER_FIXTURE = { id: 'ledger_fixture' };
const INFAKT = { id: 'infakt' };
const WFIRMA = { id: 'wfirma' };

/** The two vendors this tree ships, as a family the fixture states rather than imports. */
const SHIPPED_VENDORS = [INFAKT, WFIRMA];

function unusedEmFactory(): never {
  throw new Error('emFactory not used');
}

describe('invoice_ledger registry', () => {
  it('assertCanActivate refuses when a sibling activation is true', async () => {
    const service = new InvoiceLedgerRegistryService(
      unusedEmFactory,
      {
        isOperatorActivated: (moduleId) => moduleId === 'infakt',
      },
      [INFAKT, OTHER_VENDOR],
    );

    await expect(service.assertCanActivate('other_ledger_vendor')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
        expect(httpError.details).toEqual({ activeModuleId: 'infakt' });
        return true;
      },
    );
  });

  it('assertCanActivate passes when no sibling is active', async () => {
    const service = new InvoiceLedgerRegistryService(
      unusedEmFactory,
      { isOperatorActivated: () => false },
      [INFAKT, OTHER_VENDOR],
    );

    await expect(service.assertCanActivate('infakt')).resolves.toBeUndefined();
  });

  it('does not bypass the instance-wide mutex for another sales channel', async () => {
    const service = new InvoiceLedgerRegistryService(
      unusedEmFactory,
      { isOperatorActivated: (moduleId) => moduleId === 'infakt' },
      [INFAKT, OTHER_VENDOR],
    );

    // The mutex takes only a module id. A second vendor "for channel B" has
    // no argument to sneak through; exclusion is instance-wide (FR-003).
    await expect(service.assertCanActivate('other_ledger_vendor')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
        expect(httpError.details).toEqual({ activeModuleId: 'infakt' });
        expect(httpError.details).not.toHaveProperty('salesChannelId');
        return true;
      },
    );
  });

  it('refuses ledger_fixture while Infakt is present', async () => {
    const service = new InvoiceLedgerRegistryService(
      unusedEmFactory,
      { isOperatorActivated: (moduleId) => moduleId === 'infakt' },
      [...SHIPPED_VENDORS, LEDGER_FIXTURE],
    );

    await expect(service.assertCanActivate('ledger_fixture')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
        expect(httpError.details).toEqual({ activeModuleId: 'infakt' });
        return true;
      },
    );
  });

  it('refuses Infakt when the injected ledger_fixture sibling is present', async () => {
    const service = new InvoiceLedgerRegistryService(
      unusedEmFactory,
      { isOperatorActivated: (moduleId) => moduleId === 'ledger_fixture' },
      [...SHIPPED_VENDORS, LEDGER_FIXTURE],
    );

    await expect(service.assertCanActivate('infakt')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.statusCode).toBe(409);
      expect(httpError.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
      expect(httpError.details).toEqual({ activeModuleId: 'ledger_fixture' });
      return true;
    });
  });

  it('refuses wFirma when Infakt is present', async () => {
    const service = new InvoiceLedgerRegistryService(
      unusedEmFactory,
      { isOperatorActivated: (moduleId) => moduleId === 'infakt' },
      SHIPPED_VENDORS,
    );

    await expect(service.assertCanActivate('wfirma')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.statusCode).toBe(409);
      expect(httpError.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
      expect(httpError.details).toEqual({ activeModuleId: 'infakt' });
      expect(httpError.details).not.toHaveProperty('salesChannelId');
      return true;
    });
  });

  it('refuses Infakt when wFirma is present', async () => {
    const service = new InvoiceLedgerRegistryService(
      unusedEmFactory,
      { isOperatorActivated: (moduleId) => moduleId === 'wfirma' },
      SHIPPED_VENDORS,
    );

    await expect(service.assertCanActivate('infakt')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.statusCode).toBe(409);
      expect(httpError.code).toBe(ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE);
      expect(httpError.details).toEqual({ activeModuleId: 'wfirma' });
      expect(httpError.details).not.toHaveProperty('salesChannelId');
      return true;
    });
  });

  describe('the family arrives as a function in production (feature 132)', () => {
    it('is re-read on every call, so a refresh that adds a member is answered', async () => {
      // The property the array could not have, and the reason the parameter widened:
      // `registryCache` re-installs the derived family on every
      // `b2b:module:state-changed` refresh, and this singleton outlives every one of
      // them. A list captured at construction would answer for the deployment as it
      // was when the container was built.
      let family: { id: string }[] = [INFAKT];
      const service = new InvoiceLedgerRegistryService(
        unusedEmFactory,
        { isOperatorActivated: (moduleId) => moduleId === 'ledger_fixture' },
        () => family,
      );

      // The fixture is not in the family yet, so its presence is nobody's claim.
      await expect(service.assertCanActivate('infakt')).resolves.toBeUndefined();

      family = [INFAKT, LEDGER_FIXTURE];

      await expect(service.assertCanActivate('infakt')).rejects.toSatisfy((error: unknown) => {
        expect((error as HttpError).details).toEqual({ activeModuleId: 'ledger_fixture' });
        return true;
      });
    });

    it('getActiveModuleId reads the same family', async () => {
      const service = new InvoiceLedgerRegistryService(
        unusedEmFactory,
        { isOperatorActivated: (moduleId) => moduleId === 'wfirma' },
        () => SHIPPED_VENDORS,
      );
      await expect(service.getActiveModuleId()).resolves.toBe('wfirma');
    });
  });
});
