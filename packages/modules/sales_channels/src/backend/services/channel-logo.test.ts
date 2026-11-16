import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type DictionaryValidator, type SalesChannelAttributionRegistryPort } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannelsService } from './sales-channels.service.js';

/**
 * Issue #544 (owner ruling 2026-10-30, option a) — a sales channel's logo is
 * an asset id published with the channel's identity, so a logo the
 * administrator may not see in the asset library is refused exactly as a
 * missing one; the logo already set is accepted as it stands.
 */

const VISIBLE = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const HIDDEN = '1b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const MISSING = '2b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const STORED = '3b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';

function harness() {
  const channel = {
    id: '11111111-1111-4111-8111-111111111111',
    code: 'b2b',
    version: 2,
    logoAssetId: STORED,
    languages: ['en-US'],
    defaultLanguage: 'en-US',
    currencies: ['PLN'],
    defaultCurrency: 'PLN',
    systemDefault: false,
  };
  const em = { findOne: async () => channel } as unknown as EntityManager;
  const ran: string[] = [];
  const commandBus = {
    run: async (command: { action: string }) => {
      ran.push(command.action);
      return channel;
    },
  } as unknown as CommandBus;
  const dictionary = {
    validateLanguageCode: async () => undefined,
    validateCurrencyCode: async () => undefined,
  } as unknown as DictionaryValidator;
  const asked: string[][] = [];
  const assets = {
    visibleToCaller: async (ids: readonly string[]) => {
      asked.push([...ids]);
      return new Set(ids.filter((id) => id === VISIBLE || id === STORED));
    },
  };
  const service = new SalesChannelsService(
    () => em,
    { emit: () => undefined } as unknown as EventBus,
    dictionary,
    {} as SalesChannelAttributionRegistryPort,
    { tableFor: () => undefined } as never,
    commandBus,
    undefined,
    undefined,
    undefined,
    assets,
  );
  return { service, ran, asked };
}

const createBody = (logoAssetId: string | null) => ({
  code: 'new',
  name: { 'en-US': 'New' },
  logoAssetId,
  languages: ['en-US'],
  defaultLanguage: 'en-US',
  currencies: ['PLN'],
  defaultCurrency: 'PLN',
});

describe('sales channel logo (issue #544)', () => {
  it.each([HIDDEN, MISSING])('refuses %s as a logo on create and on update, running no Command', async (id) => {
    for (const write of [
      (h: ReturnType<typeof harness>) => h.service.create(createBody(id) as never),
      (h: ReturnType<typeof harness>) => h.service.update('b2b', { logoAssetId: id }, 2),
    ]) {
      const h = harness();
      const err = await write(h).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).statusCode).toBe(404);
      expect((err as HttpError).code).toBe(ERROR_CODES.ASSET_NOT_FOUND);
      expect(h.ran).toEqual([]);
    }
  });

  it('accepts a visible logo, no logo, and the logo already set without asking', async () => {
    const h = harness();
    await h.service.create(createBody(VISIBLE) as never);
    await h.service.create(createBody(null) as never);
    await h.service.update('b2b', { logoAssetId: STORED }, 2);
    expect(h.ran).toHaveLength(3);
    expect(h.asked).toEqual([[VISIBLE]]);
  });
});
