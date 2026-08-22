import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('storefront CMS block-by-code contract (T052)', () => {
  let h: BackendServerHandle;
  let defaultChannel: SalesChannel;
  let otherChannel: SalesChannel;

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    defaultChannel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    otherChannel = h.em().create(SalesChannel, {
      code: `cms-block-other-${Date.now()}`,
      name: { 'en-US': 'CMS block other' },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      isPublic: true,
      status: 'active',
    });
    await h.em().persistAndFlush(otherChannel);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedBlock(options: {
    code: string;
    channelId: string;
    active?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date();
    const data = {
      root: { props: {} },
      content: [{ type: 'Heading', props: { level: 'h2', text: `Block ${options.code}` } }],
    };
    await h.em().getConnection().execute(
      `insert into cms_blocks
        (id, name, code, active, description, content, languages, version, created_at, updated_at)
       values (?, ?, ?, ?, null, ?::jsonb, ?::jsonb, 1, ?, ?)`,
      [
        id,
        `Block ${options.code}`,
        options.code,
        options.active ?? true,
        JSON.stringify({ schema_version: 1, languages: { 'en-US': data } }),
        JSON.stringify(['en-US']),
        now,
        now,
      ],
    );
    await h.em().getConnection().execute(
      `insert into cms_block_sales_channels (block_id, sales_channel_id, code)
       values (?, ?, ?)`,
      [id, options.channelId, options.code],
    );
    return id;
  }

  async function getByCode(code: string, channelCode = defaultChannel.code) {
    return h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/blocks/by-code?code=${encodeURIComponent(code)}&language=en-US`,
      headers: {
        'x-sales-channel': channelCode,
        'accept-language': 'en-US',
      },
    });
  }

  it('returns an active Block matched by sales channel and code', async () => {
    const code = `block-public-${Date.now()}`;
    const id = await seedBlock({ code, channelId: defaultChannel.id });

    const res = await getByCode(code);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: {
        id,
        code,
        language: 'en-US',
        content: { data: expect.anything() },
      },
    });
  });

  it('returns CMS_BLOCK_NOT_FOUND for channel-mismatched Blocks', async () => {
    const code = `block-channel-${Date.now()}`;
    await seedBlock({ code, channelId: otherChannel.id });

    const res = await getByCode(code, defaultChannel.code);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_BLOCK_NOT_FOUND } });
  });

  it('returns CMS_BLOCK_NOT_FOUND for inactive Blocks', async () => {
    const code = `block-inactive-${Date.now()}`;
    await seedBlock({ code, channelId: defaultChannel.id, active: false });

    const res = await getByCode(code);

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.CMS_BLOCK_NOT_FOUND } });
  });
});
