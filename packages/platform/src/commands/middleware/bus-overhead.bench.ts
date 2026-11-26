import { bench, describe } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '../command-bus.js';
import type { Command } from '../command.js';
import { CommandMiddlewareRegistry } from './registry.js';
import { EventBus, type EventBase } from '../../events/bus.js';
import type { AuditPort, RecordAuditInput } from '../../kernel/ports/audit.js';
import { runWithTenantContext, type TenantContext } from '../../tenancy/tenant-context.js';

/**
 * `specs/189-command-middleware/` T002 / T055 — the Command Bus overhead
 * micro-benchmark behind SC-002 and SC-003.
 *
 * One sample is 10 000 no-op Commands run one after another on the real
 * `CommandBus`, over a fake transactional EM and a recording audit port, so
 * what is measured is the bus's own path and nothing a database adds. Run by
 * hand, never in CI (plan.md *Performance Goals*):
 *
 *   pnpm --filter @endora-commerce/platform exec vitest bench --run \
 *     src/commands/middleware/bus-overhead.bench.ts
 *
 * SC-002 compares the `no middleware` median with the same bench on
 * `origin/master`; SC-003 is the difference between the two medians below,
 * divided by 10 000.
 */

const COMMANDS = 10_000;

function harness(middleware?: CommandMiddlewareRegistry): { bus: CommandBus; recorded: RecordAuditInput[] } {
  const recorded: RecordAuditInput[] = [];
  const fakeEm = {
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      return cb(fakeEm as unknown as EntityManager);
    },
  };
  const orm = { em: { fork: () => fakeEm } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, entry: RecordAuditInput) {
      recorded.push(entry);
      return {} as never;
    },
  } as unknown as AuditPort;
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), {
    getRequestMeta: () => ({ requestId: 'req-1', ipAddress: '127.0.0.1', userAgent: 'bench' }),
    ...(middleware ? { middleware } : {}),
  });
  return { bus, recorded };
}

const noop: Command<null> = {
  action: 'widget.touch',
  objectType: 'widget',
  objectId: 'w-1',
  async run() {
    return { result: null, after: { changedFields: [] } };
  },
};

const ctx: TenantContext = { mode: 'all', actor: { kind: 'admin', id: 'admin-1' } };

async function runMany(bus: CommandBus, recorded: RecordAuditInput[]): Promise<void> {
  await runWithTenantContext(ctx, async () => {
    for (let i = 0; i < COMMANDS; i += 1) await bus.run(noop);
  });
  recorded.length = 0;
}

/** SC-003 — one synchronous `admit` and one `observe`, both matching every Command. */
function withMiddleware(): CommandMiddlewareRegistry {
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const registry = new CommandMiddlewareRegistry({ log: quiet });
  registry.register('bench', [
    { id: 'admit', phase: 'admit', admit: () => undefined },
    { id: 'observe', phase: 'observe', observe: () => undefined },
  ]);
  registry.seal({
    declarations: [
      { moduleId: 'bench', id: 'admit', phase: 'admit', actions: '*' },
      { moduleId: 'bench', id: 'observe', phase: 'observe', actions: '*' },
    ],
    moduleDependencies: {},
    origins: { bench: 'deployment' },
  });
  return registry;
}

describe(`CommandBus — ${COMMANDS} no-op Commands`, () => {
  const plain = harness();
  const registry = withMiddleware();
  const middleware = harness(registry);
  bench('no middleware', () => runMany(plain.bus, plain.recorded), { iterations: 30, warmupIterations: 5 });
  // The observers' own work is included: the sample ends once none is in flight.
  bench(
    'one sync admit and one observe',
    async () => {
      await runMany(middleware.bus, middleware.recorded);
      await registry.settled();
    },
    { iterations: 30, warmupIterations: 5 },
  );
});
