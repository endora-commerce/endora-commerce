import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ErpConnectorRegistryService } from './erp-connector-registry.service.js';

describe('erp_connector registry', () => {
  it('assertCanActivate refuses when another erpConnector activation Setting is true', async () => {
    const service = new ErpConnectorRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
      {
        isOperatorActivated: (moduleId) => moduleId === 'erp_other',
      },
      [{ id: 'comarch_xl' }, { id: 'erp_other' }],
    );

    await expect(service.assertCanActivate('comarch_xl')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.statusCode).toBe(409);
      expect(httpError.code).toBe(ERROR_CODES.ERP_CONNECTOR_ALREADY_ACTIVE);
      expect(httpError.details).toEqual({ activeModuleId: 'erp_other' });
      return true;
    });
  });

  it('assertCanActivate passes when no sibling is active', async () => {
    const service = new ErpConnectorRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
      {
        isOperatorActivated: () => false,
      },
    );

    await expect(service.assertCanActivate('comarch_xl')).resolves.toBeUndefined();
  });
});
