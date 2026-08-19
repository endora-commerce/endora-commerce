import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../../src/events/bus.js';
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
 * registration is lazy and no boot hook runs, so this needs neither the host
 * values a real root registers nor a database.
 */
function composeGeneratedList(): { ids: string[]; registrations: string[] } {
  const container = createRootContainer();
  const eventBus = new EventBus();
  const entries = [...MODULES];
  const before = new Set(Object.keys(container.registrations));
  const composed = composeModules(entries, { container, eventBus, log: log() });
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
