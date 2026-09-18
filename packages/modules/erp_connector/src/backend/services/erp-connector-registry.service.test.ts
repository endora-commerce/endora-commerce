import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ErpConnectorRegistryService } from './erp-connector-registry.service.js';

/**
 * Feature 132 (T027/T028) — these cases used to construct the service on its
 * **default** member list, which was `ERP_CONNECTOR_MODULES`. The family is derived
 * from the members' own manifest declarations now, and a package-local unit test has
 * no manifest index to derive it from (a module may not name the host's), so the
 * family is supplied explicitly through the constructor seam.
 *
 * That default was a subtler residue than a named import: nothing in these files
 * mentioned the deleted symbol, they merely depended on its value — which is why the
 * deletion sweep runs the tests rather than trusting the grep.
 *
 * The **production** population is asserted where it can be derived on both sides:
 * `backend/test/integration/erp_connector/overlay-joins.test.ts`.
 */
const ERP_FAMILY = [{ id: 'comarch_xl' }, { id: 'erp_incumbent_fixture' }];

describe('erp_connector registry', () => {
  it('assertCanActivate refuses when another ERP connector is operator-active', async () => {
    const service = new ErpConnectorRegistryService(
      () => {
        throw new Error('emFactory not used');
      },
      {
        isOperatorActivated: (moduleId) => moduleId === 'erp_incumbent_fixture',
      },
      ERP_FAMILY,
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
      ERP_FAMILY,
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
      ERP_FAMILY,
    );

    await expect(service.assertCanActivate('comarch_xl')).resolves.toBeUndefined();
    await expect(service.assertCanActivate('erp_incumbent_fixture')).resolves.toBeUndefined();
  });
});
