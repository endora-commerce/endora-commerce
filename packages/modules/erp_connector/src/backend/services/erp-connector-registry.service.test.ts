import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ErpConnectorRegistryService } from './erp-connector-registry.service.js';

describe('erp_connector registry', () => {
  it('assertCanActivate refuses when another ERP connector is operator-active', async () => {
    const service = new ErpConnectorRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
      {
        isOperatorActivated: (moduleId) => moduleId === 'erp_incumbent_fixture',
      },
    );

    await expect(service.assertCanActivate('comarch_xl')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.statusCode).toBe(409);
      expect(httpError.code).toBe(ERROR_CODES.ERP_CONNECTOR_ALREADY_ACTIVE);
      expect(httpError.details).toEqual({ activeModuleId: 'erp_incumbent_fixture' });
      return true;
    });
  });

  it('assertCanActivate refuses when Comarch XL is active and another connector activates', async () => {
    const service = new ErpConnectorRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
      {
        isOperatorActivated: (moduleId) => moduleId === 'comarch_xl',
      },
    );

    await expect(service.assertCanActivate('erp_incumbent_fixture')).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.code).toBe(ERROR_CODES.ERP_CONNECTOR_ALREADY_ACTIVE);
        expect(httpError.details).toEqual({ activeModuleId: 'comarch_xl' });
        return true;
      },
    );
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
    await expect(service.assertCanActivate('erp_incumbent_fixture')).resolves.toBeUndefined();
  });
});
