import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  assertProductChannelMembers,
  loadAttachmentPackagingScopedFields,
} from './attachment-packaging-scopes.js';

/**
 * Feature 163 (FR-078, FR-079, FR-080, FR-081; data-model §8), moved to the 168 override tables —
 * the pieces of the attachment and packaging-unit scope reads that need no database.
 */
describe('assertProductChannelMembers', () => {
  const membership = {
    listChannelsForEntity: vi.fn(async () => [{ id: 'b2b' }, { id: 'b2c' }]),
  };

  it('passes when every channel is one the product is a member of', async () => {
    await expect(assertProductChannelMembers(membership as never, 'p1', ['b2b'])).resolves.toBeUndefined();
  });

  it('refuses the first outside channel with 422 SCOPE_INVALID not_a_member (FR-014)', async () => {
    await expect(assertProductChannelMembers(membership as never, 'p1', ['b2b', 'outside'])).rejects.toMatchObject({
      statusCode: 422,
      code: 'SCOPE_INVALID',
      details: { channelId: 'outside', reason: 'not_a_member' },
    });
  });

  it('asks nothing for an empty set (clearing is always allowed, FR-015)', async () => {
    membership.listChannelsForEntity.mockClear();
    await expect(assertProductChannelMembers(membership as never, 'p1', [])).resolves.toBeUndefined();
    expect(membership.listChannelsForEntity).not.toHaveBeenCalled();
  });

  it('fails loudly when the membership port is not wired', async () => {
    await expect(assertProductChannelMembers(undefined, 'p1', ['b2b'])).rejects.toThrow(/not wired/);
  });
});

describe('loadAttachmentPackagingScopedFields', () => {
  it('reads the overview fields of one product in one statement from the 168 override tables', async () => {
    const statements: string[] = [];
    const em = {
      execute: async (sql: string) => {
        statements.push(sql);
        return [
          { field: 'attachments:hidden', channel_id: 'b2c', language_code: null },
          { field: 'attachments:name', channel_id: 'b2c', language_code: 'pl-PL' },
          { field: 'packagingUnits:name', channel_id: 'b2c', language_code: 'de-DE' },
        ];
      },
    } as unknown as EntityManager;
    const fields = await loadAttachmentPackagingScopedFields(em, 'p1');
    expect(statements).toHaveLength(1);
    for (const table of ['product_attachment_scope_overrides', 'product_packaging_unit_scope_overrides']) {
      expect(statements[0]).toContain(table);
    }
    expect(statements[0]).not.toContain('_translations');
    expect(fields).toEqual([
      { field: 'attachments:hidden', channelId: 'b2c', languageCode: null },
      { field: 'attachments:name', channelId: 'b2c', languageCode: 'pl-PL' },
      { field: 'packagingUnits:name', channelId: 'b2c', languageCode: 'de-DE' },
    ]);
  });
});
