import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../../src/events/bus.js';
import { ApiInterceptorRegistry } from '../../../src/http/interceptors/index.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { MODULES } from '../../../src/composition.generated.js';
import { codeOnly } from '../../../scripts/lib/source-text.js';

/**
 * `BACKEND_ROLE=worker` composes the same application (T054).
 *
 * The queue-consumer process (`src/worker.ts`) is a second entry point into the
 * *same* composition — that is the whole point of Principle X's deployment
 * dial: `BACKEND_ROLE` decides whether this process consumes queues, not which
 * modules exist. A module list that differed by role would mean a job running
 * against a service graph no HTTP request ever exercises.
 *
 * What this asserts:
 *
 *  1. Composition is role-independent — the same generated list, the same
 *     order, the same registrations, whatever `BACKEND_ROLE` says.
 *  2. Composition itself serves nothing. Route registrars are collected as
 *     unexecuted plugins; a process that never builds a server never has them,
 *     and `worker.ts` never listens.
 *
 * **Why this is a unit test** (feature 112, FR-004). It sat under
 * `test/integration/kernel/` until 2026-09-05 and was never an integration
 * test: Constitution III *defines* that tree as the one that exercises "the
 * real database and the real module boundary (no mocking the DB)", and this
 * file opens no connection to Postgres, Redis or Meilisearch — it composes in
 * memory and reads `src/worker.ts` as text. Not one assertion changed with the
 * move; the fast, service-less job now runs it on every merge request rather
 * than only on `master`. The criterion is
 * `specs/112-test-tree-membership/contracts/test-tree-membership.md`.
 */

const WORKER_ENTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/worker.ts',
);

function log(): { info: () => void; warn: () => void; error: () => void } {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

/**
 * Compose the generated list into a bare container. Nothing is resolved: every
 * registration is lazy and no boot hook runs, so this needs no database and none
 * of the host *values* a real root registers.
 *
 * It does owe one host **seam**, and the sentence above used to say it owed
 * nothing at all. `pim_unopim` registers an API interceptor from
 * `registerModule` (feature 089, FR-003 — it refuses activating a second PIM
 * while one is active), and `ctx.interceptors` refuses a root that mounts no
 * registry rather than dropping the registration. That refusal is right —
 * a silently dropped interceptor is a refusal that stops refusing — so this root
 * mounts one, as both real roots do. It stays consistent with property 2 below:
 * an interceptor registered into a registry is collected, exactly like a route
 * plugin, and `buildServer` is what would dispatch it.
 */
function composeGeneratedList(): { ids: string[]; registrations: string[] } {
  const container = createRootContainer();
  const eventBus = new EventBus();
  const entries = [...MODULES];
  const before = new Set(Object.keys(container.registrations));
  const composed = composeModules(entries, {
    container,
    eventBus,
    log: log(),
    interceptorRegistry: new ApiInterceptorRegistry(),
  });
  const registrations = Object.keys(container.registrations)
    .filter((name) => !before.has(name))
    .sort();
  // Route plugins stay unexecuted — this is what "composition serves nothing"
  // means concretely.
  expect(composed.sink.plugins.every((p) => typeof p === 'function')).toBe(true);
  return { ids: entries.map((e) => e.id), registrations };
}

describe('T054 — the worker role', () => {
  const originalRole = process.env['BACKEND_ROLE'];

  afterEach(() => {
    if (originalRole === undefined) delete process.env['BACKEND_ROLE'];
    else process.env['BACKEND_ROLE'] = originalRole;
  });

  it('composes the same generated list as the API role', () => {
    process.env['BACKEND_ROLE'] = 'api';
    const api = composeGeneratedList();
    process.env['BACKEND_ROLE'] = 'worker';
    const worker = composeGeneratedList();

    expect(worker.ids).toEqual(api.ids);
    expect(worker.registrations).toEqual(api.registrations);
    // …and it is the generated list, not a subset of it.
    expect(new Set(worker.ids)).toEqual(new Set(MODULES.map((m) => m.id)));
    expect(worker.registrations.length).toBeGreaterThan(0);
  });

  it('registers no HTTP routes: the worker entry point never listens', () => {
    // Comments stripped: the file *documents* that it never listens, and a
    // check that a prose sentence satisfies is not a check. Through the shared
    // parser-backed helper (issue #241) — `check-entry-scope.ts` used to export
    // a regex pair for this and no longer strips anything at all, its own
    // questions being answered from the syntax tree since issue #237.
    const source = codeOnly(readFileSync(WORKER_ENTRY, 'utf8'), 'worker.ts');
    // The worker composes through the one composition root, which walks the
    // generated list…
    expect(source).toContain('composeApp');
    // …and serves no HTTP. `buildServer` is called only to run the module
    // plugins that register the queue consumers; binding a port here would put
    // a second, unrouted copy of the API on the network.
    expect(source).not.toMatch(/\.listen\s*\(/);
  });
});
