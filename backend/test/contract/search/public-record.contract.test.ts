import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SearchPhraseRecord } from '../../../src/modules/search/entities/search-phrase-record.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * T031 — Contract test for `POST /api/v1/search/record` (US3, feature 006).
 *
 *   - happy path → 202, exactly one row, verbatim casing, channel id from
 *     the resolver (header), correct resultCount.
 *   - empty phrase → 400 PHRASE_REQUIRED, no row.
 *   - phrase > 512 chars → 400 PHRASE_TOO_LONG, no row.
 *   - resultCount missing → 202, row stored with `result_count = 0`.
 *   - resultCount negative → 400 RESULT_COUNT_INVALID.
 *   - X-Sales-Channel header pins the row's sales_channel_id (cannot be
 *     spoofed via body).
 */
describe('POST /api/v1/search/record (T031)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    // The sales-channels cache (Redis-backed) outlives a single
    // test-server. After our setup truncates + reseeds the channels
    // table, the cache may still hold a previous run's UUIDs — which
    // makes `request.salesChannel.id` point at a row that no longer
    // exists. Flush before any test runs.
    await h.salesChannels.cache.invalidateAll();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Append-only table; clear between tests so per-case assertions are
    // deterministic. SEEDED_TABLES already truncates on backend boot.
    const em = h.em();
    const all = await em.find(SearchPhraseRecord, {});
    for (const r of all) em.remove(r);
    await em.flush();
  });

  it('writes one row on a valid commit and returns 202', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/search/record',
      payload: { phrase: 'Krzesło', resultCount: 12 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual({ ok: true });

    // Recorder is fire-and-forget; settle before reading.
    await waitForRow(h);

    const em = h.em();
    const rows = await em.find(SearchPhraseRecord, {}, { populate: ['salesChannel'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phrase).toBe('Krzesło'); // verbatim casing preserved
    expect(rows[0]!.phraseNormalized).toBe('krzesło');
    expect(rows[0]!.resultCount).toBe(12);
    expect(rows[0]!.salesChannel.id).toBeTruthy();
    expect(rows[0]!.recordedAt).toBeInstanceOf(Date);
  });

  it('defaults result_count to 0 when omitted (FR-014 dead-end recording)', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/search/record',
      payload: { phrase: 'qwertyuiop' },
    });
    expect(r.statusCode).toBe(202);

    await waitForRow(h);
    const em = h.em();
    const rows = await em.find(SearchPhraseRecord, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]!.resultCount).toBe(0);
  });

  it('honours the X-Sales-Channel header — body cannot spoof channel', async () => {
    const em = h.em();
    const channels = await em.find(SalesChannel, {});
    // Pick a non-default channel if available, otherwise default.
    const target = channels.find((c) => !c.systemDefault) ?? channels[0]!;

    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/search/record',
      headers: { 'x-sales-channel': target.code },
      // Body intentionally lacks any channel field — schema doesn't accept it.
      payload: { phrase: 'red chair', resultCount: 4 },
    });
    expect(r.statusCode).toBe(202);

    await waitForRow(h);
    const rows = await em.find(SearchPhraseRecord, {}, { populate: ['salesChannel'] });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.salesChannel.id).toBe(target.id);
  });

  it('rejects empty phrase with 400 PHRASE_REQUIRED', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/search/record',
      payload: { phrase: '' },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.PHRASE_REQUIRED);

    const em = h.em();
    const rows = await em.find(SearchPhraseRecord, {});
    expect(rows).toHaveLength(0);
  });

  it('rejects phrase > 512 chars with 400 PHRASE_TOO_LONG', async () => {
    const tooLong = 'a'.repeat(513);
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/search/record',
      payload: { phrase: tooLong },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.PHRASE_TOO_LONG);

    const em = h.em();
    const rows = await em.find(SearchPhraseRecord, {});
    expect(rows).toHaveLength(0);
  });

  it('rejects negative resultCount with 400 RESULT_COUNT_INVALID', async () => {
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/search/record',
      payload: { phrase: 'red chair', resultCount: -1 },
    });
    expect(r.statusCode).toBe(400);
    const body = r.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.RESULT_COUNT_INVALID);
  });

  it('silently no-ops when phrase is below minimum_query_length (e.g. 2 chars)', async () => {
    // Default minimum_query_length is 3; a 2-char phrase passes the
    // route's shape validation (Zod min(1)) but the recorder skips
    // persistence so the analytics dataset is not flooded with stub
    // phrases (FR-002 / FR-013).
    const r = await h.app.inject({
      method: 'POST',
      url: '/api/v1/search/record',
      payload: { phrase: 'ab' },
    });
    expect(r.statusCode).toBe(202);

    // Settle.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const em = h.em();
    const rows = await em.find(SearchPhraseRecord, {});
    expect(rows).toHaveLength(0);
  });
});

/** Poll the table for up to 5 s waiting for a row to land. */
async function waitForRow(h: BackendServerHandle): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const em = h.em();
    const count = await em.count(SearchPhraseRecord, {});
    if (count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
