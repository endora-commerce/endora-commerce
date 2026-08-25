import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { RegisterOrganizationRequest } from '@endora-commerce/contracts';
import { EventBus } from '../../../src/events/bus.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import type { DictionaryValidator } from '../../../../packages/modules/dictionaries/src/backend/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { RegistrationService } from '../../../src/modules/organizations/services/registration-service.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';
import { Country } from '../../helpers/package-entities.js';

describe('Organizations dictionary boundary', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let service: RegistrationService;

  beforeAll(async () => {
    db = await setupTestDb();
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "dictionary_translations"`);
    await conn.execute(`delete from "language_countries"`);
    await conn.execute(`delete from "countries"`);
    await runDictionarySeedReconcilerFor(() => db.orm.em);
  });

  beforeEach(async () => {
    em = await db.beginTx();
    validator = dictionaryValidatorFor(() => em);
    service = new RegistrationService(
      () => em,
      new EventBus(),
      customerAccountPortsFor(() => em),
      validator,
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses unknown and inactive registered-address countries on registration', async () => {
    await expect(service.registerOrganization(request('ZZ'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });

    await em.nativeUpdate(Country, { code: 'PL' }, { isActive: false });
    validator.invalidate();
    await expect(service.registerOrganization(request('PL'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_INACTIVE',
    });
  });
});

function request(country: string): RegisterOrganizationRequest {
  const id = crypto.randomUUID().slice(0, 8);
  return {
    organization: {
      name: `Org ${id}`,
      taxId: `TAX-${id}`,
      registeredAddress: {
        street: 'Main',
        city: 'Warsaw',
        postalCode: '00-001',
        country,
      },
    },
    firstUser: {
      email: `buyer-${id}@example.com`,
      password: 'super-secret-password',
      firstName: 'Buyer',
      lastName: 'User',
    },
    acceptedTermsVersion: '2026-05-06',
  };
}
