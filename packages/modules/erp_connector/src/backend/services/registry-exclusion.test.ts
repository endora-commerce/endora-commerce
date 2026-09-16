import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ErpConnectorRegistryService } from './erp-connector-registry.service.js';

describe('erp_connector registry — mutual exclusion', () => {
  it('refuses activation when Comarch XL is already operator-active', async () => {
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
});
