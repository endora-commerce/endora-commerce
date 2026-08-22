import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DictionaryReferenceError } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Language } from '../../../src/modules/languages/entities/language.entity.js';
import type { LanguagesCradle } from '../../../src/modules/languages/backend.js';

/**
 * Feature 072 wave 2 (T105) — a deactivated language stops validating at once.
 *
 * `LanguageService`'s dictionary-cache invalidator was a hard-coded `undefined`,
 * so nothing dropped a cache when a language changed. `DictionaryValidator`
 * caches existence and active-state in-process for 60 s, which is what this
 * test exercises: read once to warm the entry, deactivate, then read again.
 *
 * Without the fix the second read is served from the warm entry and still says
 * the language is fine — for up to a minute per process, and for up to an hour
 * from the Redis dictionary cache. `currencies` has announced its changes since
 * wave 1 and drops both immediately; this is the other half of the same
 * behaviour, and the assertion is deliberately about the *validator's answer*
 * rather than about an event having been emitted, because an event nobody acts
 * on would satisfy the second and not the first.
 */

describe('languages — deactivation invalidates the dictionary validator [integration]', () => {
  let h: BackendServerHandle;
  let code: string;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    code = `zz${randomUUID().slice(0, 2)}`;
    const em = h.em();
    em.create(Language, { code, label: 'Probe language', isActive: true });
    await em.flush();
  }, 60_000);

  afterAll(async () => {
    await h.em().nativeDelete(Language, { code });
    await teardownBackendServer(h);
  });

  it('accepts the language, then rejects it as soon as it is deactivated', async () => {
    const validator = h.dictionaries.validator;
    const { languageService } = h.container.cradle as unknown as LanguagesCradle;

    // Warms the validator's in-process entry — the thing that used to go stale.
    await expect(validator.validateLanguageCode(code, 'create-or-change')).resolves.toBeUndefined();

    await languageService.update(code, { isActive: false });

    await expect(validator.validateLanguageCode(code, 'create-or-change')).rejects.toBeInstanceOf(
      DictionaryReferenceError,
    );
  });
});
