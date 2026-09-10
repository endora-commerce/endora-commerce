import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  ensureSalesChannel,
  systemDefaultSalesChannel,
} from '../../helpers/sales-channel-fixtures.js';

/**
 * Feature 078, D-95.2 — `400 INVOICE_NUMBER_PATTERN_COLLIDES` on the settings
 * write, contributed by `invoices` and applied by `settings`.
 *
 * It refuses a **possible** collision, which is the whole asymmetry with
 * issuance: at a configuration write nothing is at stake and a conservative
 * refusal costs the operator one edit.
 */

const CODE = 'invoices.numbering.invoice.pattern';
const ACTOR = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };

async function refusal(work: Promise<unknown>): Promise<HttpError> {
  try {
    await work;
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    return err as HttpError;
  }
  throw new Error('expected the write to be refused');
}

describe('invoices — the numbering-pattern write refusal', () => {
  let h: BackendServerHandle;
  let firstName: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    firstName = channelLabel(await systemDefaultSalesChannel(h.em()));
    await ensureSalesChannel(h.em(), 'coll-b');
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function channelLabel(channel: { name: Record<string, string>; code: string }): string {
    return channel.name['en'] ?? Object.values(channel.name)[0] ?? channel.code;
  }

  it('refuses a pattern channel B can render the same as channel A', async () => {
    // The system-default channel is pinned to `FV {seq}/{YYYY}` by the boot
    // hook, so writing that same pattern to another channel collides.
    const err = await refusal(
      h.settings.adminService.setValueForSubset(CODE, ['coll-b'], 'FV {seq}/{YYYY}', null, ACTOR),
    );
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('INVOICE_NUMBER_PATTERN_COLLIDES');
    const details = err.details as Record<string, unknown>;
    expect(details['code']).toBe('other_channel');
    expect(details['kind']).toBe('invoice');
    expect(details['channel']).toBe(firstName);
    expect(details['otherPattern']).toBe('FV {seq}/{YYYY}');
    expect(String(details['example'])).toMatch(/^FV \d+\/\d{4}$/);
  });

  it('accepts one pattern written for all channels when it carries {channel}', async () => {
    const result = await h.settings.adminService.setValueForAllChannels(
      'invoices.numbering.proforma.pattern',
      'PRO {seq}/{channel}/{YYYY}',
      null,
      ACTOR,
    );
    expect(result.newVersion).toBeTruthy();
  });

  it('refuses a pattern with no sequence token', async () => {
    const err = await refusal(
      h.settings.adminService.setValueForSubset(CODE, ['coll-b'], 'FV/{YYYY}', null, ACTOR),
    );
    expect(err.code).toBe('INVOICE_NUMBER_PATTERN_COLLIDES');
    expect((err.details as Record<string, unknown>)['code']).toBe('no_sequence_token');
  });

  it('refuses a no-op re-save of a colliding value — the predicate is over the post-write state', async () => {
    const em = h.em();
    const second = await ensureSalesChannel(em, 'coll-b');
    // Put the colliding value in place behind the refusal's back, then re-save
    // the very same string through the write path.
    const knex = em.getKnex();
    const settingId = (
      await knex('settings').where({ code: CODE }).select('id').first()
    ) as { id: string };
    await knex('setting_values')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        setting_id: settingId.id,
        sales_channel_id: second.id,
        value: JSON.stringify('FV {seq}/{YYYY}'),
        created_at: new Date(),
        updated_at: new Date(),
      })
      .onConflict(['setting_id', 'sales_channel_id'])
      .merge();

    const err = await refusal(
      h.settings.adminService.setValueForSubset(CODE, ['coll-b'], 'FV {seq}/{YYYY}', null, ACTOR),
    );
    expect(err.code).toBe('INVOICE_NUMBER_PATTERN_COLLIDES');
  });
});
