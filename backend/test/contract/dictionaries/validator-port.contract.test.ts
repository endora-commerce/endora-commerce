import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DictionaryReferenceError } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

describe('Dictionary validator handle contract', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('exposes the typed validator signatures from dictionariesModule().handle', async () => {
    const validator = h.dictionaries.validator;
    expect(validator).toBeDefined();
    await expect(validator!.validateCountryCode('PL', 'create-or-change')).resolves.toBeUndefined();
    await expect(validator!.validateCurrencyCode('PLN', 'create-or-change')).resolves.toBeUndefined();
    await expect(validator!.validateLanguageCode('en-US', 'create-or-change')).resolves.toBeUndefined();
  });

  it('throws DictionaryReferenceError with documented codes', async () => {
    const validator = h.dictionaries.validator!;
    await expect(validator.validateCountryCode('ZZ', 'create-or-change')).rejects.toMatchObject({
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
      entryType: 'country',
      entryCode: 'ZZ',
    });
    await expect(validator.validateCountryCode('RU', 'create-or-change')).rejects.toBeInstanceOf(
      DictionaryReferenceError,
    );
  });
});
