import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { PimConnectorRegistryService } from '../../../../packages/modules/pim_connector/src/backend/services/pim-connector-registry.service.js';

describe('pim_connector registry', () => {
  it('assertCanActivate refuses when Ergonode activation Setting is true', async () => {
    const service = new PimConnectorRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
      {
        isOperatorActivated: (moduleId) => moduleId === 'pim_ergonode',
      },
    );

    await expect(service.assertCanActivate('pim_unopim')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpError);
      const httpError = error as HttpError;
      expect(httpError.statusCode).toBe(409);
      expect(httpError.code).toBe(ERROR_CODES.PIM_CONNECTOR_ALREADY_ACTIVE);
      expect(httpError.details).toEqual({ activeModuleId: 'pim_ergonode' });
      return true;
    });
  });

  it('assertCanActivate passes when no sibling is active', async () => {
    const service = new PimConnectorRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
      {
        isOperatorActivated: () => false,
      },
    );

    await expect(service.assertCanActivate('pim_unopim')).resolves.toBeUndefined();
  });
});
