import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  InvoiceNumberGenerator,
  createSettingsPatternResolver,
} from '../../../../packages/modules/invoices/src/backend/services/invoice-number-generator.js';

/**
 * Three real `sales_channels` rows: feature 078 renders `{channel}` from the
 * row, and the generator refuses a channel id with nothing behind it, so a
 * fabricated id is no longer a usable fixture.
 */
const CHANNEL_CODES = ['num-a', 'num-b', 'num-c'] as const;

describe('invoices — numbering engine (US2)', () => {
  let h: BackendServerHandle;
  let gen: InvoiceNumberGenerator;
  let CH_A: string;
  let CH_B: string;
  let CH_C: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    gen = new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService));
    const em = h.em();
    const ids: string[] = [];
    for (const code of CHANNEL_CODES) {
      const existing = await em.findOne(SalesChannel, { code });
      const channel =
        existing ??
        em.create(SalesChannel, {
          code,
          name: { en: `Numbering ${code}` },
          defaultLanguage: 'en',
          languages: ['en'],
          defaultCurrency: 'PLN',
          currencies: ['PLN'],
        });
      await em.persistAndFlush(channel);
      ids.push(channel.id);
    }
    [CH_A, CH_B, CH_C] = ids as [string, string, string];

    // Reset global patterns to defaults (other test files set their own globally
    // in the shared DB; pin them here so this file is deterministic). The
    // patterns are the pre-078 ones on purpose: this file exercises the counter,
    // and a bare pattern makes the drawn sequence readable in the assertion.
    const audit = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.invoice.pattern',
      [...CHANNEL_CODES],
      'FV {seq}/{channel}/{YYYY}',
      null,
      audit,
    );
    await h.settings.adminService.setValueForSubset(
      'invoices.numbering.correction.pattern',
      [...CHANNEL_CODES],
      'KOR {seq}/{channel}/{YYYY}',
      null,
      audit,
    );
    // The test DB persists across runs — clear counters for this file's channels
    // so sequences start from 1 deterministically.
    await h.em().getKnex()('invoice_number_counters').whereIn('sales_channel_id', ids).del();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function draw(kind: 'invoice' | 'correction', channel: string, date: Date): Promise<string> {
    return h.em().transactional((tx) => gen.next(tx, kind, channel, date));
  }

  it('increments within a (channel, kind, year) and resets at the year boundary', async () => {
    const y2026 = new Date('2026-03-01T00:00:00.000Z');
    const a1 = await draw('invoice', CH_A, y2026);
    const a2 = await draw('invoice', CH_A, y2026);
    expect(a1).toBe('FV 1/NUM-A/2026');
    expect(a2).toBe('FV 2/NUM-A/2026');
    const y2027 = new Date('2027-01-02T00:00:00.000Z');
    const a3 = await draw('invoice', CH_A, y2027);
    expect(a3).toBe('FV 1/NUM-A/2027'); // reset for the new year
  });

  /**
   * Feature 078, D-95. This assertion used to read `expect(b1).toBe('FV 1/2026')`
   * with the comment "independent of CH_A", twelve lines after CH_A had drawn
   * that exact string — the reported defect, written down and green, because
   * this file exercises the generator and persists no `Invoice` row, so the
   * unique index was never asked. The sequences are still per channel; what has
   * changed is that the rendered number now carries the channel, so two
   * per-channel sequence 1s are two different numbers.
   */
  it('keeps separate sequences per sales channel, rendered into distinct numbers', async () => {
    const date = new Date('2026-06-01T00:00:00.000Z');
    const b1 = await draw('invoice', CH_B, date);
    expect(b1).toBe('FV 1/NUM-B/2026');
    expect(b1).not.toBe(await draw('invoice', CH_A, date));
  });

  it('keeps separate sequences per document kind', async () => {
    const date = new Date('2026-06-01T00:00:00.000Z');
    const c1 = await draw('correction', CH_B, date);
    expect(c1).toBe('KOR 1/NUM-B/2026'); // correction sequence independent of invoice
  });

  it('produces gap-free, unique numbers across repeated draws (row-locked counter)', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    const results: string[] = [];
    for (let i = 0; i < 10; i++) results.push(await draw('invoice', CH_C, date));
    const seqs = results.map((n) => Number(n.match(/FV (\d+)\//)?.[1]));
    expect(new Set(results).size).toBe(10);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // gap-free
  });

  /**
   * The fallback that must never come back: an absent `sales_channels` row is a
   * failure, not an empty discriminator. An empty one would render every channel
   * identically again, which is the defect D-95 removes.
   */
  it('refuses to number for a sales channel id with no row behind it', async () => {
    await expect(
      draw('invoice', randomUUID(), new Date('2026-06-01T00:00:00.000Z')),
    ).rejects.toThrow(/has no row/);
  });
});
