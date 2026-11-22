import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel, Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { SettingsAdminService } from './settings-admin.service.js';

/**
 * Issue #1588 — `resetValuesForSubset`, the per-channel reset published on
 * `SettingsAdminPort`. It removes the named channels' own rows and nothing
 * else, and an empty subset is refused: the `resetValues` it delegates to reads
 * an empty subset as "clear the all-channels value", which a caller asking a
 * channel to inherit again must never reach.
 */
describe('SettingsAdminService.resetValuesForSubset', () => {
  const ACTOR = { actorAdminUserId: 'admin-1' };
  const stamp = new Date('2026-11-01T00:00:00.000Z');

  function world() {
    const setting = {
      id: 'setting-1',
      code: 'transactional_emails.accent_color',
      ownerModule: 'transactional_emails',
      valueType: 'string',
      globalValue: '#111111',
      defaultValue: '#1f2937',
      updatedAt: stamp,
    } as unknown as Setting;
    const channel = (id: string, code: string) => ({ id, code }) as unknown as SalesChannel;
    const pl = channel('channel-pl', 'b2b-pl');
    const de = channel('channel-de', 'b2b-de');
    const row = (salesChannel: SalesChannel, value: string) =>
      ({ setting, salesChannel, value, updatedAt: stamp }) as unknown as SettingValue;
    const rows = [row(pl, '#222222'), row(de, '#333333')];
    const removed: SettingValue[] = [];

    const em = {
      findOne: vi.fn(async (entity: unknown) => (entity === Setting ? setting : null)),
      find: vi.fn(async (entity: unknown, where: Record<string, unknown>) => {
        if (entity === SalesChannel) {
          const codes = (where.code as { $in: string[] }).$in;
          return [pl, de].filter((c) => codes.includes(c.code));
        }
        if (entity === SettingValue) {
          const live = rows.filter((r) => !removed.includes(r));
          const scope = where.salesChannel as { $in: string[] } | undefined;
          return scope ? live.filter((r) => scope.$in.includes(r.salesChannel.id)) : live;
        }
        return [];
      }),
      remove: vi.fn((value: SettingValue) => {
        removed.push(value);
      }),
      flush: vi.fn(async () => undefined),
    };
    const cache = { invalidateAfterWrite: vi.fn(async () => undefined), invalidateAllAfterWrite: vi.fn() };
    const eventBus = { emit: vi.fn() } as unknown as EventBus;
    const service = new SettingsAdminService(
      () => em as unknown as EntityManager,
      eventBus,
      cache as never,
    );
    return { service, setting, em, rows, removed };
  }

  it('refuses an empty subset with 400 SETTING_EMPTY_SUBSET and touches no row', async () => {
    const { service, setting, em } = world();

    const error = await service.resetValuesForSubset(setting.code, [], ACTOR).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(400);
    expect((error as HttpError).code).toBe(ERROR_CODES.SETTING_EMPTY_SUBSET);
    expect(em.remove).not.toHaveBeenCalled();
    expect(em.flush).not.toHaveBeenCalled();
    expect(setting.globalValue).toBe('#111111');
  });

  it("removes the named channels' rows, leaves the others and the all-channels value", async () => {
    const { service, setting, rows, removed } = world();

    const result = await service.resetValuesForSubset(setting.code, ['b2b-pl'], ACTOR);

    expect(result.resetChannelIds).toEqual(['channel-pl']);
    expect(removed).toEqual([rows[0]]);
    expect(setting.globalValue).toBe('#111111');
    expect(Object.keys(result).sort()).toEqual(['newVersion', 'resetChannelIds']);
  });
});
