import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type ScopedValuesResponse } from '@endora-commerce/contracts';
// The shared case table is not published (`*.cases.ts` is excluded from the contracts dist):
// imported through the source path, never copied (`contracts/write-encoding.md` §4).
import { SCOPED_WRITE_CASES, type ScopedWriteCase } from '../../../../packages/contracts/src/scoped-write-encoding.cases.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type Scope, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172, US2 (T031; FR-110…FR-113, SC-014) — every JSON row of `SCOPED_WRITE_CASES` through
 * `PUT …/products/:id/scoped-values`. Each case starts from an own value at its scope, so "no
 * change", "empty" and "inherit" are each observable: the cell keeps its value, holds an empty
 * override, or inherits from the scope above. A refusal is `422 SCOPED_VALUE_INVALID` naming the
 * field and the reason, with nothing written.
 */
describe('172 US2 — the write encoding through the save API (T031)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let multi: string;

  const SEED: Record<ScopedWriteCase['field'], unknown> = {
    name: 'Seed name',
    description: 'Seed description',
    status: 'inactive',
    minOrderQuantity: 7,
    returnable: true,
    'attribute:multi': ['a'],
  };

  const changes = (field: ScopedWriteCase['field'], value: unknown) =>
    field === 'attribute:multi' ? { attributes: { [multi]: value } } : { [field]: value };

  const view = (data: ScopedValuesResponse['data'], field: ScopedWriteCase['field']) =>
    field === 'attribute:multi' ? data.attributes.find((a) => a.key === multi)!.view : data.fields[field];

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    multi = await fx.attribute({ key: 'multi', valueType: 'multiselect', scopable: true, options: ['a', 'b'] });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  const jsonCases = SCOPED_WRITE_CASES.filter((c) => c.csv === undefined);

  it('covers every JSON row of the shared table', () => {
    expect(jsonCases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(jsonCases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const id = await fx.product({ channels: [channel] });
    const scope: Scope = c.level === 'G' ? {} : c.level === 'C' ? { channelId: channel } : { channelId: channel, languageCode: 'pl-PL' };
    await fx.save(id, scope, changes(c.field, SEED[c.field]));
    const before = view(await fx.read(id, scope), c.field);

    const res = await fx.put(id, scope, 'json' in c ? changes(c.field, c.json) : {});
    const after = view(await fx.read(id, scope), c.field);

    if (typeof c.expect === 'string' && c.expect !== 'no_change') {
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as { error: { code: string; details: { fields: Array<{ field: string; reason: string }> } } };
      expect(body.error.code).toBe(ERROR_CODES.SCOPED_VALUE_INVALID);
      expect(body.error.details.fields).toEqual([expect.objectContaining({ field: c.field === 'attribute:multi' ? `attribute:${multi}` : c.field, reason: c.expect })]);
      expect(after).toEqual(before);
      return;
    }
    expect(res.statusCode, res.body).toBe(200);
    if (c.expect === 'no_change') {
      expect(after).toEqual(before);
      return;
    }
    switch (c.expect.op) {
      case 'set':
        expect(after).toMatchObject({ value: c.expect.value, source: 'set' });
        break;
      case 'empty':
        // At Global an empty value is no value at all; elsewhere it is an empty override.
        expect(after).toMatchObject(c.level === 'G' ? { value: null, source: 'absent' } : { value: null, source: 'set_empty' });
        break;
      case 'inherit':
        // No own value any more: inherited from above, or `absent` where nothing above holds one.
        expect(after.source).toMatch(/^(inherited_channel|inherited_global|absent)$/);
        expect(after.ownValue).toBeUndefined();
        break;
    }
  });
});
