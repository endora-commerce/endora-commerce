import { describe, expect, it } from 'vitest';
import { ERROR_CODES, INVOICE_LEDGER_MODULES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { InvoiceLedgerRegistryService } from '../../../../packages/modules/invoice_ledger/src/backend/services/invoice-ledger-registry.service.js';

/**
 * T078 / T080 / SC-008. Production `INVOICE_LEDGER_MODULES` stays Infakt-only.
 * A second production vendor is a later spec. These cases inject
 * `other_ledger_vendor` / `ledger_fixture` through the presence reader and the
 * registry constructor's extra table, never by editing that production list.
 */
const OTHER_VENDOR = { id: 'other_ledger_vendor', activationSettingCode: 'other.activation' };
const LEDGER_FIXTURE = {
  id: 'ledger_fixture',
  activationSettingCode: 'ledger_fixture.activation',
};
const INFAKT = { id: 'infakt', activationSettingCode: 'infakt.activation' };

function unusedEmFactory(): never {
  throw new Error('emFactory not used');
}

describe('invoice_ledger registry', () => {
  it('production INVOICE_LEDGER_MODULES lists only Infakt', () => {
    expect([...INVOICE_LEDGER_MODULES]).toEqual([
      { id: 'infakt', activationSettingCode: 'infakt.activation' },
    ]);
  });

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

  it('default production table refuses ledger_fixture while Infakt is operator-active', async () => {
    const service = new InvoiceLedgerRegistryService(unusedEmFactory, {
      isOperatorActivated: (moduleId) => moduleId === 'infakt',
    });

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

  it('refuses Infakt when the injected ledger_fixture sibling is operator-active', async () => {
    const service = new InvoiceLedgerRegistryService(
      unusedEmFactory,
      { isOperatorActivated: (moduleId) => moduleId === 'ledger_fixture' },
      [...INVOICE_LEDGER_MODULES, LEDGER_FIXTURE],
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
});
