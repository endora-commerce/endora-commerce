import { afterEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setEscapeHatchAuditSink,
  withOrgScope,
  withSystemScope,
  type EscapeHatchAuditRecord,
} from '../../tenancy/escape-hatch.js';
import { runWithTenantContext } from '../../tenancy/tenant-context.js';
import { resolveTenantContext, systemTenantContext } from '../../tenancy/resolve-tenant-context.js';
import { createRootContainer } from '../container.js';
import { enterPlatformScope, enterSystemScope } from '../scope.js';
import {
  ESCAPE_HATCH_AUDIT_ACTION,
  attachEscapeHatchAuditWriter,
  moduleFromStack,
  type EscapeHatchAuditWriter,
} from './escape-hatch-audit-writer.js';

/**
 * The persistent escape-hatch sink (owner decision of 2026-10-03). The row it
 * writes against a real database is asserted by
 * `backend/test/integration/kernel/production-boot.test.ts`; this file holds
 * the writer's own behaviour — aggregation, attribution, failure handling,
 * recursion — against an EntityManager double that records what was persisted.
 */

type Row = Record<string, unknown> & { stateAfter: Record<string, unknown> };

interface FakeDb {
  readonly em: () => EntityManager;
  readonly rows: Row[];
  flushes: number;
  failNext: number;
}

function fakeDb(): FakeDb {
  const db: FakeDb = {
    rows: [],
    flushes: 0,
    failNext: 0,
    em: () =>
      ({
        fork: () => {
          const staged: Row[] = [];
          return {
            create: (_entity: unknown, data: Row) => data,
            persist: (row: Row) => void staged.push(row),
            flush: async () => {
              db.flushes += 1;
              if (db.failNext > 0) {
                db.failNext -= 1;
                throw new Error('connection terminated');
              }
              db.rows.push(...staged);
            },
          };
        },
      }) as unknown as EntityManager,
  };
  return db;
}

const writers: EscapeHatchAuditWriter[] = [];
function attach(
  options: Parameters<typeof attachEscapeHatchAuditWriter>[0],
): EscapeHatchAuditWriter {
  const writer = attachEscapeHatchAuditWriter({ flushIntervalMs: 3_600_000, ...options });
  writers.push(writer);
  return writer;
}

/** Silence and observe the stderr line the writer chains to. */
function observePreviousSink(): EscapeHatchAuditRecord[] {
  const seen: EscapeHatchAuditRecord[] = [];
  setEscapeHatchAuditSink((record) => void seen.push(record));
  return seen;
}

afterEach(async () => {
  while (writers.length > 0) await writers.pop()!.detach();
  setEscapeHatchAuditSink((record) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'info', msg: 'tenant.escape_hatch', ...record })}\n`,
    );
  });
});

describe('every escape-hatch widening becomes an audit row', () => {
  it('writes a system widening as a tenant_scope row with its reason, scope and module', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });

    await withSystemScope('test: nightly reconciliation', async () => 1);
    expect(db.rows, 'nothing is written before the flush').toHaveLength(0);
    await writer.flush();

    expect(db.rows).toHaveLength(1);
    const row = db.rows[0]!;
    expect(row['action']).toBe(ESCAPE_HATCH_AUDIT_ACTION);
    expect(row['objectType']).toBe('tenant_scope');
    expect(row['objectId']).toBe('system');
    expect(row['actedAt']).toBeInstanceOf(Date);
    expect(row.stateAfter).toMatchObject({
      scope: 'system',
      reason: 'test: nightly reconciliation',
      organizationId: null,
      module: 'platform',
      occurrences: 1,
    });
  });

  it('names the target organisation of an org-pinned widening', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });

    await withOrgScope('11111111-1111-4111-8111-111111111111', 'test: per-org sweep', async () => 1);
    await writer.flush();

    expect(db.rows[0]?.['objectType']).toBe('organization');
    expect(db.rows[0]?.['objectId']).toBe('11111111-1111-4111-8111-111111111111');
    expect(db.rows[0]?.stateAfter['organizationId']).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('attributes the widening to the admin whose request made it, with the request id', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });
    const admin = resolveTenantContext({ kind: 'admin', adminUserId: 'admin-1' }, { allowAll: true });

    await enterPlatformScope(
      admin,
      () => withSystemScope('test: admin report across organisations', async () => 1),
      {
        container: createRootContainer(),
        requestMeta: { requestId: 'req-42', ipAddress: '10.0.0.1', userAgent: 'vitest' },
      },
    );
    await writer.flush();

    const row = db.rows[0]!;
    expect(row['actorAdminUserId']).toBe('admin-1');
    expect(row['requestId']).toBe('req-42');
    expect(row['ipAddress']).toBe('10.0.0.1');
    expect(row.stateAfter).toMatchObject({
      actor: { kind: 'admin', id: 'admin-1', context: null },
      entryPoint: 'http',
      requestIds: ['req-42'],
    });
  });

  it('records the impersonating admin and the customer acted for', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });
    const impersonated = resolveTenantContext({
      kind: 'customer',
      customerAccountId: 'cust-1',
      organizationId: 'org-1',
      impersonatorAdminUserId: 'admin-9',
    });

    await runWithTenantContext(impersonated, () =>
      withSystemScope('test: impersonated widening', async () => 1),
    );
    await writer.flush();

    expect(db.rows[0]?.['actorAdminUserId']).toBe('admin-9');
    expect(db.rows[0]?.['impersonatedCustomerAccountId']).toBe('cust-1');
    expect(db.rows[0]?.stateAfter['actor']).toEqual({ kind: 'customer', id: 'cust-1', context: null });
  });

  it('tells two system actors apart by the context the caller was already in', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });

    await runWithTenantContext(systemTenantContext('actor:anonymous'), () =>
      withSystemScope('test: system callers', async () => 1),
    );
    await runWithTenantContext(systemTenantContext('newsletter send'), () =>
      withSystemScope('test: system callers', async () => 1),
    );
    await writer.flush();

    expect(db.rows.map((row) => row.stateAfter['actor'])).toEqual([
      { kind: 'system', id: null, context: 'actor:anonymous' },
      { kind: 'system', id: null, context: 'newsletter send' },
    ]);
  });

  it('records the entry point a system scope starts', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });

    await enterSystemScope('test: operator command', async () => 1, {
      entryPoint: 'cli',
      container: createRootContainer(),
    });
    await writer.flush();

    expect(db.rows[0]?.stateAfter['entryPoint']).toBe('cli');
  });

  it('keeps the stderr line: the previous sink still receives every record', async () => {
    const seen = observePreviousSink();
    const db = fakeDb();
    attach({ em: db.em, log: () => {} });

    await withSystemScope('test: still on stderr', async () => 1);

    expect(seen).toEqual([{ scope: 'system', reason: 'test: still on stderr' }]);
  });
});

describe('a hot path is aggregated, never sampled', () => {
  it('collapses identical widenings in one window into one row that counts them', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });

    for (let i = 0; i < 250; i += 1) {
      await withSystemScope('test: per-request identity read', async () => 1);
    }
    await writer.flush();

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.stateAfter['occurrences']).toBe(250);
    expect(db.rows[0]?.['requestId'], 'many executions are not one request').toBeNull();
  });

  it('keeps different actors, organisations and reasons in different rows', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });
    const asAdmin = (id: string) =>
      resolveTenantContext({ kind: 'admin', adminUserId: id }, { allowAll: true });

    await runWithTenantContext(asAdmin('a'), () => withSystemScope('test: r1', async () => 1));
    await runWithTenantContext(asAdmin('b'), () => withSystemScope('test: r1', async () => 1));
    await withSystemScope('test: r2', async () => 1);
    await withOrgScope('org-x', 'test: r2', async () => 1);
    await writer.flush();

    expect(db.rows).toHaveLength(4);
  });

  it('keeps the request ids of an aggregate, capped, and says when it capped them', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });
    const admin = resolveTenantContext({ kind: 'admin', adminUserId: 'a' }, { allowAll: true });

    for (let i = 0; i < 25; i += 1) {
      await enterPlatformScope(admin, () => withSystemScope('test: capped', async () => 1), {
        container: createRootContainer(),
        requestMeta: { requestId: `req-${i}` },
      });
    }
    await writer.flush();

    const state = db.rows[0]!.stateAfter;
    expect(state['occurrences']).toBe(25);
    expect((state['requestIds'] as string[]).length).toBe(20);
    expect(state['requestIdsTruncated']).toBe(true);
  });

  it('flushes on its own once the threshold of distinct records is reached', async () => {
    observePreviousSink();
    const db = fakeDb();
    attach({ em: db.em, log: () => {}, flushThreshold: 3 });

    await withSystemScope('test: t1', async () => 1);
    await withSystemScope('test: t2', async () => 1);
    await withSystemScope('test: t3', async () => 1);
    await new Promise((resolve) => setImmediate(resolve));

    expect(db.rows).toHaveLength(3);
  });
});

describe('a failed write loses nothing', () => {
  it('retries the batch, merged with what arrived meanwhile, and says it failed', async () => {
    observePreviousSink();
    const db = fakeDb();
    const log: string[] = [];
    const writer = attach({ em: db.em, log: (line) => void log.push(line) });

    await withSystemScope('test: during an outage', async () => 1);
    db.failNext = 1;
    await writer.flush();
    expect(db.rows).toHaveLength(0);
    expect(writer.pendingCount).toBe(1);
    expect(log.join('\n')).toMatch(/tenant\.escape_hatch\.persist_failed/);

    await withSystemScope('test: during an outage', async () => 1);
    await writer.flush();

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]?.stateAfter['occurrences']).toBe(2);
  });

  it('prints what it could not write when it is detached', async () => {
    observePreviousSink();
    const db = fakeDb();
    const log: string[] = [];
    const writer = attachEscapeHatchAuditWriter({
      em: db.em,
      log: (line) => void log.push(line),
      flushIntervalMs: 3_600_000,
    });

    await withSystemScope('test: lost at shutdown', async () => 1);
    db.failNext = 1;
    await writer.detach();

    const unpersisted = log.filter((line) => line.includes('tenant.escape_hatch.unpersisted'));
    expect(unpersisted).toHaveLength(1);
    expect(JSON.parse(unpersisted[0]!)).toMatchObject({
      reason: 'test: lost at shutdown',
      occurrences: 1,
    });
  });

  it('folds records past the pending limit into an overflow row that keeps the count', async () => {
    observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {}, maxPendingKeys: 2 });

    await withSystemScope('test: o1', async () => 1);
    await withSystemScope('test: o2', async () => 1);
    await withSystemScope('test: o3', async () => 1);
    await withSystemScope('test: o4', async () => 1);
    await writer.flush();

    expect(db.rows).toHaveLength(3);
    const overflow = db.rows.find((row) => row.stateAfter['overflow'] === true);
    expect(overflow?.stateAfter['occurrences']).toBe(2);
    const total = db.rows.reduce((sum, row) => sum + (row.stateAfter['occurrences'] as number), 0);
    expect(total).toBe(4);
  });

  it('reports, without failing, the records of a run that never opened a database', async () => {
    observePreviousSink();
    const log: string[] = [];
    const writer = attachEscapeHatchAuditWriter({
      em: () => undefined,
      log: (line) => void log.push(line),
      flushIntervalMs: 3_600_000,
    });

    await withSystemScope('test: dry run', async () => 1);
    await writer.flush();
    expect(writer.pendingCount).toBe(1);
    await writer.detach();

    expect(log.join('\n')).toMatch(/tenant\.escape_hatch\.not_persisted/);
  });
});

describe('writing the audit row widens nothing', () => {
  it('reports no escape-hatch record while it persists', async () => {
    const seen = observePreviousSink();
    const db = fakeDb();
    const writer = attach({ em: db.em, log: () => {} });

    await withSystemScope('test: the only widening', async () => 1);
    await writer.flush();
    await writer.flush();

    expect(seen).toHaveLength(1);
    expect(writer.pendingCount).toBe(0);
    expect(db.rows).toHaveLength(1);
  });
});

describe('attachment', () => {
  it('restores the previous sink when the last writer detaches', async () => {
    const seen = observePreviousSink();
    const db = fakeDb();
    const writer = attachEscapeHatchAuditWriter({ em: db.em, flushIntervalMs: 3_600_000 });
    await writer.detach();

    await withSystemScope('test: after detach', async () => 1);

    expect(seen).toHaveLength(1);
    expect(db.rows).toHaveLength(0);
  });

  it('hands records to the most recent writer only, and back to the outer one after', async () => {
    observePreviousSink();
    const outerDb = fakeDb();
    const innerDb = fakeDb();
    const outer = attach({ em: outerDb.em, log: () => {} });
    const inner = attachEscapeHatchAuditWriter({ em: innerDb.em, flushIntervalMs: 3_600_000 });

    await withSystemScope('test: inner', async () => 1);
    await inner.detach();
    await withSystemScope('test: outer', async () => 1);
    await outer.flush();

    expect(innerDb.rows.map((row) => row.stateAfter['reason'])).toEqual(['test: inner']);
    expect(outerDb.rows.map((row) => row.stateAfter['reason'])).toEqual(['test: outer']);
  });
});

describe('module attribution', () => {
  const own = [
    'Error',
    '    at capture (/srv/app/node_modules/@endora-commerce/platform/dist/kernel/audit/escape-hatch-audit-writer.js:10:1)',
    '    at withSystemScope (/srv/app/node_modules/@endora-commerce/platform/dist/tenancy/escape-hatch.js:70:3)',
  ];

  it('names a module in this repository', () => {
    const stack = [
      ...own,
      '    at Object.resolveOrg (/repo/packages/modules/customer_accounts/dist/backend/index.js:429:20)',
    ].join('\n');
    expect(moduleFromStack(stack)).toBe('customer_accounts');
  });

  it('names an installed module package in an instance', () => {
    const stack = [
      ...own,
      '    at Worker.fn (/srv/app/node_modules/.pnpm/@endora-commerce+mod-product-feeds@0.100.0/node_modules/@endora-commerce/mod-product-feeds/dist/backend/q.js:5:1)',
    ].join('\n');
    expect(moduleFromStack(stack)).toBe('product_feeds');
  });

  it('names an overlay module', () => {
    const stack = [
      ...own,
      '    at run (/repo/backend/src/apps/example/modules/ledger_vendor_fixture/services/delivery-processor.ts:168:7)',
    ].join('\n');
    expect(moduleFromStack(stack)).toBe('ledger_vendor_fixture');
  });

  it('answers platform for the kernel, and host for an entry point of the application', () => {
    expect(
      moduleFromStack(
        [
          ...own,
          '    at enterSystemScope (/srv/app/node_modules/@endora-commerce/platform/dist/kernel/scope.js:9:3)',
          '    at composeApp (/srv/app/node_modules/@endora-commerce/platform/dist/composition/compose-app.js:582:9)',
        ].join('\n'),
      ),
    ).toBe('platform');
    expect(
      moduleFromStack(
        [...own, '    at main (/repo/backend/src/lifecycle/scripts/install.ts:105:6)'].join('\n'),
      ),
    ).toBe('host');
  });
});
