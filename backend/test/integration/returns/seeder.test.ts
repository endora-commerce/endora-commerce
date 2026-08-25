import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ReturnsSeeder } from '../../../../packages/modules/returns/src/backend/services/returns-seeder.js';
import { ReturnReason, ReturnStatus, ReturnStatusTransition } from '../../helpers/package-entities.js';

/**
 * Feature 046 (T017) — idempotent default seeder.
 */
describe('returns — seeder', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('restores the default status graph + reasons when wiped, and is idempotent', async () => {
    const knex = h.em().getKnex();
    await knex('return_status_transitions').del();
    await knex('return_statuses').del();
    await knex('return_reasons').del();

    const seeder = new ReturnsSeeder(h.em);
    await seeder.ensureDefaults();

    expect(await h.em().count(ReturnStatus, {})).toBe(7);
    expect(await h.em().count(ReturnStatusTransition, {})).toBe(9);
    expect(await h.em().count(ReturnReason, {})).toBe(6);

    // Second run is a no-op (counts unchanged — no duplicates).
    await seeder.ensureDefaults();
    expect(await h.em().count(ReturnStatus, {})).toBe(7);
    expect(await h.em().count(ReturnReason, {})).toBe(6);
  });
});
