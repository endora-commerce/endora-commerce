import { describe, expect, it } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import { Product } from '../entities/product.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import { ProductOverridesService } from './product-overrides.service.js';

/**
 * Feature 163, Phase 9 (T071a) — FR-015: an orphaned value override can always be
 * deleted. A delete skips the four scope checks an upsert is held to
 * (`channel_not_assigned_to_product`, `language_not_in_channel`,
 * `attribute_not_channel_scoped`, `attribute_unknown`), the way the scopes PATCH lets
 * `null` through (`assertScopeValid`). Upserts keep every check, and the delete still
 * runs inside the audited Command.
 */

const P = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-0000000000c1';
const LEFT = '00000000-0000-4000-8000-0000000000c9';

type Row = { productId: string; attributeKey: string; channelId: string; languageCode: string | null };

type Channel = { id: string; languages: string[]; defaultLanguage: string };

const CHANNELS: Channel[] = [
  { id: MEMBER, languages: ['pl-PL'], defaultLanguage: 'pl-PL' },
  { id: LEFT, languages: ['pl-PL'], defaultLanguage: 'pl-PL' },
];

function rig(rows: Row[], channels: Channel[] = CHANNELS) {
  const removed: Row[] = [];
  const commands: string[] = [];
  const em = {
    findOne: async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === Product) return { id: P };
      if (entity === ProductValueOverride) {
        return (
          rows.find(
            (r) =>
              r.attributeKey === where['attributeKey'] &&
              r.channelId === where['channelId'] &&
              r.languageCode === where['languageCode'],
          ) ?? null
        );
      }
      return null;
    },
    find: async (entity: unknown) => {
      if (entity === ProductValueOverride) return rows.filter((r) => !removed.includes(r));
      // SalesChannel: by default the member offers pl-PL only; the left channel still exists.
      return channels;
    },
    remove: (row: Row) => removed.push(row),
    persist: () => undefined,
    create: (_entity: unknown, data: Row) => data,
  };
  const commandBus = {
    run: async (command: { action: string; run: (ctx: { em: typeof em }) => Promise<{ result: unknown }> }) => {
      commands.push(command.action);
      return (await command.run({ em })).result;
    },
  };
  const service = new ProductOverridesService(
    () => em as never,
    { listChannelsForEntity: async () => [{ id: MEMBER, languages: ['pl-PL'] }] } as never,
    commandBus as never,
    {
      listAll: async () => [
        { key: 'narrowed', scopable: false, valueType: 'string' },
        { key: 'color', scopable: true, valueType: 'string' },
      ],
    } as never,
  );
  return { service, removed, commands };
}

const orphans: Array<[string, Row]> = [
  ['channel_not_assigned_to_product', { productId: P, attributeKey: 'name', channelId: LEFT, languageCode: 'pl-PL' }],
  ['language_not_in_channel', { productId: P, attributeKey: 'name', channelId: MEMBER, languageCode: 'fr-FR' }],
  ['attribute_not_channel_scoped', { productId: P, attributeKey: 'narrowed', channelId: MEMBER, languageCode: null }],
  ['attribute_unknown', { productId: P, attributeKey: 'deleted_attr', channelId: MEMBER, languageCode: null }],
];

describe('ProductOverridesService.applyBulk — deleting orphans (spec 163, T071a, FR-015)', () => {
  for (const [check, row] of orphans) {
    it(`a delete skips ${check} and removes the row through the audited Command`, async () => {
      const { service, removed, commands } = rig([row]);
      const result = await service.applyBulk(P, {
        upserts: [],
        deletes: [{ attributeKey: row.attributeKey, channelId: row.channelId, languageCode: row.languageCode }],
      });
      expect(result.applied).toEqual({ upserted: 0, deleted: 1 });
      expect(removed).toEqual([row]);
      expect(commands).toEqual(['product.overrides_apply']);
    });

    it(`an upsert to the same slot is still refused with ${check}`, async () => {
      const { service, commands } = rig([]);
      const attempt = service.applyBulk(P, {
        upserts: [
          { attributeKey: row.attributeKey, channelId: row.channelId, languageCode: row.languageCode, value: { v: 'x' } },
        ],
        deletes: [],
      });
      await expect(attempt).rejects.toBeInstanceOf(HttpError);
      await expect(attempt).rejects.toMatchObject({ statusCode: 422, message: check });
      expect(commands).toEqual([]);
    });
  }

  it('a delete of an absent row is a no-op, not an error', async () => {
    const { service, removed } = rig([]);
    const result = await service.applyBulk(P, {
      upserts: [],
      deletes: [{ attributeKey: 'name', channelId: LEFT, languageCode: 'pl-PL' }],
    });
    expect(result.applied.deleted).toBe(0);
    expect(removed).toEqual([]);
  });
});

describe('ProductOverridesService.applyBulk — the channel default language is offered (spec 163)', () => {
  // `toScopeChannel` is the one home of "a channel offers its own default language,
  // whether or not its list names it"; the read side resolves a default-language
  // override on such a channel, so the write side must accept one.
  const defaultOnly: Channel[] = [{ id: MEMBER, languages: [], defaultLanguage: 'pl-PL' }];

  it('accepts an upsert in the default language of a channel whose language list is empty', async () => {
    const { service, commands } = rig([], defaultOnly);
    const result = await service.applyBulk(P, {
      upserts: [{ attributeKey: 'color', channelId: MEMBER, languageCode: 'pl-PL', value: { v: 'x' } }],
      deletes: [],
    });
    expect(result.applied).toEqual({ upserted: 1, deleted: 0 });
    expect(commands).toEqual(['product.overrides_apply']);
  });

  it('still refuses a language the channel neither lists nor defaults to', async () => {
    const { service } = rig([], defaultOnly);
    const attempt = service.applyBulk(P, {
      upserts: [{ attributeKey: 'color', channelId: MEMBER, languageCode: 'fr-FR', value: { v: 'x' } }],
      deletes: [],
    });
    await expect(attempt).rejects.toMatchObject({ statusCode: 422, message: 'language_not_in_channel' });
  });
});
