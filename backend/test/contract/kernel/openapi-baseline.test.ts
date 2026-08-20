import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The API-surface freeze for feature 072 (T045).
 *
 * The whole kernel/DI programme claims that moving a module's wiring out of a
 * composition root changes nothing an API client can observe. That claim is
 * only worth what it is checked against, so the OpenAPI document — every path,
 * method, parameter, request body and response schema the platform serves — is
 * recorded as a fixture and compared byte-for-byte on every run.
 *
 * A conversion that drops a route, renames a parameter or changes a schema
 * fails **here**, naming the difference, rather than in whichever module suite
 * happens to notice first.
 *
 * Regenerating is deliberate, not automatic:
 *
 *   UPDATE_OPENAPI_BASELINE=1 pnpm --filter backend exec vitest run \
 *     test/contract/kernel/openapi-baseline.test.ts
 *
 * Do that when a feature genuinely adds or changes API surface, and review the
 * fixture diff as part of that change. Never do it to make this test pass while
 * converting a module — a conversion that moves the document is a bug.
 *
 * One exception has come up, and naming it is cheaper than the next person
 * rediscovering it. This document is recorded from the **test harness**, and
 * until feature 072 wave 3 the harness composed no payment provider at all —
 * `harness-parity` carried the four as an accepted divergence. Converting them
 * (T128/T130/T134/T135) made the harness compose what production always had, so
 * the fixture gained 348 lines: thirty paths, every one under `stripe`, `tpay`,
 * `payu` or `autopay`, with **zero deletions and no change to any existing
 * path, parameter, body or schema**. Production's surface did not move; the
 * baseline had simply been frozen against an incomplete composition.
 *
 * That is the shape to check for before regenerating during a conversion:
 * additions only, all under the converted module's own prefix. Anything else —
 * a removal, a renamed parameter, a moved schema — is the bug this test exists
 * to catch.
 */

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/openapi-baseline.json',
);

/** Stable serialization: sorted keys, so the fixture is diffable and order-free. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

describe('OpenAPI document — frozen against the feature 072 baseline', () => {
  let h: BackendServerHandle;
  let served: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json' });
    expect(res.statusCode).toBe(200);
    served = `${JSON.stringify(canonicalize(res.json()), null, 2)}\n`;
    if (process.env['UPDATE_OPENAPI_BASELINE'] === '1') {
      writeFileSync(FIXTURE_PATH, served, 'utf8');
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('has a recorded baseline', () => {
    expect(
      existsSync(FIXTURE_PATH),
      'test/fixtures/openapi-baseline.json is missing — record it with UPDATE_OPENAPI_BASELINE=1',
    ).toBe(true);
  });

  it('serves a document byte-identical to the baseline', () => {
    const recorded = readFileSync(FIXTURE_PATH, 'utf8');
    // Compare the parsed documents first: a structural mismatch produces a
    // readable diff, while a raw string comparison of a multi-hundred-KB
    // document produces an unreadable one.
    expect(JSON.parse(served)).toEqual(JSON.parse(recorded));
    expect(served).toBe(recorded);
  });
});
