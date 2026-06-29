import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  InvoiceNumberGenerator,
  createSettingsPatternResolver,
} from '../../../src/modules/invoices/services/invoice-number-generator.js';

const CH_A = 'dddddddd-0000-4000-8000-00000000000a';
const CH_B = 'dddddddd-0000-4000-8000-00000000000b';

describe('invoices — numbering engine (US2)', () => {
  let h: BackendServerHandle;
  let gen: InvoiceNumberGenerator;

  beforeAll(async () => {
    h = await setupBackendServer();
    gen = new InvoiceNumberGenerator(createSettingsPatternResolver(h.settings.settingsService));
    // Reset global patterns to defaults (other test files set their own globally
    // in the shared DB; pin them here so this file is deterministic).
    const audit = { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
    await h.settings.adminService.setValueForAllChannels('invoices.numbering.invoice.pattern', 'FV {seq}/{YYYY}', null, audit);
    await h.settings.adminService.setValueForAllChannels('invoices.numbering.correction.pattern', 'KOR {seq}/{YYYY}', null, audit);
    // The test DB persists across runs — clear counters for this file's channels
    // so sequences start from 1 deterministically.
    await h
      .em()
      .getKnex()('invoice_number_counters')
      .whereIn('sales_channel_id', [
        CH_A,
        CH_B,
        'dddddddd-0000-4000-8000-00000000000c',
      ])
      .del();
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
    expect(a1).toBe('FV 1/2026');
    expect(a2).toBe('FV 2/2026');
    const y2027 = new Date('2027-01-02T00:00:00.000Z');
    const a3 = await draw('invoice', CH_A, y2027);
    expect(a3).toBe('FV 1/2027'); // reset for the new year
  });

  it('keeps separate sequences per sales channel', async () => {
    const date = new Date('2026-06-01T00:00:00.000Z');
    const b1 = await draw('invoice', CH_B, date);
    expect(b1).toBe('FV 1/2026'); // independent of CH_A
  });

  it('keeps separate sequences per document kind', async () => {
    const date = new Date('2026-06-01T00:00:00.000Z');
    const c1 = await draw('correction', CH_B, date);
    expect(c1).toBe('KOR 1/2026'); // correction sequence independent of invoice
  });

  it('produces gap-free, unique numbers across repeated draws (row-locked counter)', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    const ch = 'dddddddd-0000-4000-8000-00000000000c';
    const results: string[] = [];
    for (let i = 0; i < 10; i++) results.push(await draw('invoice', ch, date));
    const seqs = results.map((n) => Number(n.match(/FV (\d+)\//)?.[1]));
    expect(new Set(results).size).toBe(10);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // gap-free
  });
});
