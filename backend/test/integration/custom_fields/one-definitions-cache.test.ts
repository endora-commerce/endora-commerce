import { CustomFieldDefinition } from '../../helpers/package-entities.js';
import { randomUUID } from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import type { CustomFieldDefinitionService } from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-definition.service.js';
import type { CustomFieldValueService } from '../../../../packages/modules/custom_fields/src/backend/services/custom-field-value.service.js';

/**
 * Feature 072 wave 1 (T087) — one definitions cache per composition.
 *
 * `custom_fields` is the platform's answer to "add a field" (Principle XIV):
 * six modules validate their writes through its value service, and the admin
 * screens mutate its definitions. Both sides read the same in-process
 * `CustomFieldDefinitionsCache`, and that sharing is the whole correctness
 * argument — a definition write invalidates the cache, so the next host write
 * validates against the new shape.
 *
 * Split the cache in two and nothing throws. The admin write invalidates cache
 * A; the value service keeps answering from cache B's warm entry until its 5 s
 * TTL expires. For those five seconds a required field is not required, a
 * removed field is still accepted, and a changed option set still validates the
 * old values — silently, on a write path, with no error anywhere to notice.
 *
 * So the assertion below is deliberately about **staleness, not identity**.
 * Comparing object references would prove the wiring and nothing about the
 * behaviour it buys; warming the value service *first* and then writing a
 * definition through the definition service is the sequence that a second cache
 * actually fails.
 */

interface CustomFieldsCradle {
  readonly customFieldDefinitionService: CustomFieldDefinitionService;
  readonly customFieldValueService: CustomFieldValueService;
}

describe('custom_fields — one definitions cache [integration]', () => {
  let h: BackendServerHandle;
  let definitions: CustomFieldDefinitionService;
  let values: CustomFieldValueService;
  let key: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const cradle = h.container.cradle as unknown as CustomFieldsCradle;
    definitions = cradle.customFieldDefinitionService;
    values = cradle.customFieldValueService;
    key = `probe_${randomUUID().slice(0, 8).replace(/-/g, '')}`;
  }, 60_000);

  afterAll(async () => {
    await h.em().nativeDelete(CustomFieldDefinition, { key });
    await teardownBackendServer(h);
  });

  it('serves the admin definition service and the host value service from one cache', async () => {
    // 1. Warm the value service's view of `organization`. Whatever cache it
    //    reads now holds an entry that does not know about `key`.
    const before = await values.validateAndMerge('organization', {}, { [key]: 'ignored' });
    expect(before).not.toHaveProperty(key);

    // 2. Write a definition through the service the admin screens use. This
    //    invalidates the cache it holds — the same one, or a different one.
    await definitions.create({
      entityType: 'organization',
      key,
      label: { en: 'Cache probe' },
      labelDefault: 'Cache probe',
      valueType: 'text',
      required: false,
      sortOrder: 900,
      config: {},
      options: [],
    });

    // 3. Read again, well inside the 5 s TTL that would rescue a second cache.
    //    One cache: the value is validated and kept. Two: silently dropped.
    const after = await values.validateAndMerge('organization', {}, { [key]: 'kept' });
    expect(after[key]).toBe('kept');
  });
});
