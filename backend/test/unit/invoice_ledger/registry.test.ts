import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { InvoiceLedgerRegistryService } from '../../../../packages/modules/invoice_ledger/src/backend/services/invoice-ledger-registry.service.js';

const OTHER_VENDOR = { id: 'other_ledger_vendor', activationSettingCode: 'other.activation' };
const INFAKT = { id: 'infakt', activationSettingCode: 'infakt.activation' };

describe('invoice_ledger registry', () => {
  it('assertCanActivate refuses when a sibling activation is true', async () => {
    const service = new InvoiceLedgerRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
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
      () => {
        throw new Error('emFactory not used');
      },
      { isOperatorActivated: () => false },
      [INFAKT, OTHER_VENDOR],
    );

    await expect(service.assertCanActivate('infakt')).resolves.toBeUndefined();
  });

  it('does not bypass the instance-wide mutex for another sales channel', async () => {
    const service = new InvoiceLedgerRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
      { isOperatorActivated: (moduleId) => moduleId === 'infakt' },
      [INFAKT, OTHER_VENDOR],
    );

    await expect(service.assertCanActivate('other_ledger_vendor')).rejects.toMatchObject({
      statusCode: 409,
      code: ERROR_CODES.INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE,
    });
  });
});
