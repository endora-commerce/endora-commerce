import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  collectServiceFiles,
  isMigratedServicePath,
} from '../../../scripts/check-command-coverage.js';

/** Fixture path under a service dir so the migrated-scope check applies. */
const PATH = 'src/modules/catalog/services/thing.service.ts';

describe('command coverage check (feature 054, FR-009 / FR-010) — method-level', () => {
  it('flags an un-migrated sensitive write (mutation, no Command, no audit)', () => {
    const src = `
      export class ThingService {
        constructor(private em: () => any) {}
        async rename(id: string) {
          const em = this.em();
          const t = await em.findOne('Thing', { id });
          t.name = 'x';
          await em.persistAndFlush(t);
        }
      }`;
    const findings = analyzeSource(PATH, src);
    expect(findings.map((f) => f.kind)).toEqual(['unaudited-sensitive-write']);
    expect(findings[0]?.method).toBe('rename');
  });

  it('passes a write expressed as a Command (no manual audit)', () => {
    const src = `
      export class ThingService {
        constructor(private commandBus: any) {}
        rename(id: string) {
          return this.commandBus.run(new RenameThingCommand(id));
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('passes a legacy write that still audits by hand', () => {
    const src = `
      export class ThingService {
        constructor(private em: () => any, private auditLog: any) {}
        async rename(id: string) {
          const em = this.em();
          await em.persistAndFlush({ id });
          await this.auditLog.record({ action: 'thing.rename', objectType: 'thing', objectId: id });
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('flags a double-audit within a single method (Command AND manual record)', () => {
    const src = `
      export class ThingService {
        constructor(private commandBus: any, private auditLogService: any) {}
        async rename(id: string) {
          await this.commandBus.run(new RenameThingCommand(id));
          await this.auditLogService.record({ action: 'thing.rename', objectType: 'thing', objectId: id });
        }
      }`;
    const findings = analyzeSource(PATH, src);
    expect(findings.map((f) => f.kind)).toContain('double-audit');
  });

  it('does NOT false-positive a double-audit across different methods (mid-migration)', () => {
    // `patch` runs a Command; a separate legacy `audit()` helper still calls record().
    const src = `
      export class ThingService {
        constructor(private commandBus: any, private auditLog: any) {}
        patch(id: string) { return this.commandBus.run(new PatchCommand(id)); }
        private async audit(action: string) {
          await this.auditLog.record({ action, objectType: 'thing', objectId: '1' });
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('does NOT let a converted method mask an unaudited sibling in the same file', () => {
    // `adjust` is covered (Command); `grant` is a bare persist → still flagged.
    const src = `
      export class Svc {
        constructor(private em: () => any, private commandBus: any) {}
        adjust(input: any) { return this.commandBus.run(new AdjustCommand(input)); }
        async grant(input: any) {
          const em = this.em();
          const row = em.create('X', input);
          await em.persistAndFlush(row);
        }
      }`;
    const findings = analyzeSource(PATH, src);
    expect(findings.map((f) => f.method)).toEqual(['grant']);
  });

  it('treats a method that delegates to an audited runner as covered', () => {
    // `remove` mutates but delegates to `#runAudited` (a runner: it calls
    // commandBus.run), so its write is executed through the bus.
    const src = `
      export class Svc {
        constructor(private em: () => any, private commandBus: any) {}
        async remove(id: string) {
          await this.#runAudited('x.delete', id, async (em: any) => {
            const row = await em.findOne('X', { id });
            em.remove(row);
            return { result: undefined };
          });
        }
        async #runAudited(action: string, id: string, write: any) {
          return this.commandBus.run({ action, objectType: 'x', objectId: id, run: write });
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('treats a method that delegates to an audit-recorder helper as covered', () => {
    // `create` mutates but records via a private `writeAudit` helper (the mutation
    // and the `.record()` call live in different methods) — a very common shape.
    const src = `
      export class Svc {
        constructor(private em: () => any, private auditLog: any) {}
        async create(input: any) {
          const em = this.em();
          const row = em.create('X', input);
          await em.persistAndFlush(row);
          await this.writeAudit('x.create', row.id);
          return row;
        }
        private async writeAudit(action: string, id: string) {
          if (!this.auditLog) return;
          await this.auditLog.record({ action, objectType: 'x', objectId: id });
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('recognizes a `.audit` recorder receiver (e.g. InvoiceAuditRecorder) as an audit write', () => {
    const src = `
      export class Svc {
        constructor(private em: () => any, private audit?: any) {}
        async issue(orderId: string) {
          const em = this.em();
          const inv = em.create('Invoice', { orderId });
          await em.persistAndFlush(inv);
          if (this.audit) {
            await this.audit.record({ action: 'invoice.issued', objectType: 'invoice', objectId: inv.id });
          }
          return inv;
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('treats the recordAuditFromContext(...) primitive as an audit write', () => {
    const src = `
      import { recordAuditFromContext } from '../../../commands/index.js';
      export class Svc {
        constructor(private em: () => any, private auditLog: any) {}
        async create(input: any) {
          const em = this.em();
          const row = em.create('X', input);
          recordAuditFromContext(this.auditLog, em, { action: 'x.create', objectType: 'x', objectId: row.id });
          await em.persistAndFlush(row);
          return row;
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('treats a mutating private helper invoked by a covered method as covered (reverse delegation)', () => {
    // `patch` records audit and delegates the row writes to `applyGlobal` /
    // `applyProduct`; those helpers only persist within `patch`'s flush, so they
    // are part of the audited unit of work, not standalone unaudited writes.
    const src = `
      export class Svc {
        constructor(private em: () => any, private auditLog: any) {}
        async patch(input: any) {
          const em = this.em();
          if (input.global) await this.applyGlobal(em, input.global);
          if (input.product) await this.applyProduct(em, input.product);
          await em.flush();
          await this.auditLog.record({ action: 'threshold.update', objectType: 't', objectId: 'global' });
        }
        private async applyGlobal(em: any, patch: any) {
          const row = em.create('T', { scope: 'global' });
          em.persist(row);
        }
        private async applyProduct(em: any, patch: any) {
          const row = em.create('T', { scope: 'product' });
          em.persist(row);
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('still flags a mutating helper that no covered method calls', () => {
    // `assign` mutates and is called by nobody audited — genuinely unaudited.
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async assign(input: any) {
          const em = this.em();
          const row = em.create('B', input);
          await em.persistAndFlush(row);
        }
      }`;
    const findings = analyzeSource(PATH, src);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.method).toBe('assign');
  });

  it('treats a command-factory method (defines a Command literal) as covered', () => {
    const src = `
      export class Svc {
        constructor(private commandBus: any) {}
        remove(id: string) { return this.commandBus.run(this.#removeCommand(id)); }
        #removeCommand(id: string) {
          return {
            action: 'x.delete', objectType: 'x', objectId: id,
            run: async ({ em }: any) => { const r = await em.findOne('X', { id }); em.remove(r); return { result: null }; },
          };
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('respects the command-coverage-ignore escape hatch for bookkeeping writes', () => {
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async bumpCounter(id: string) {
          // command-coverage-ignore: bulk-operation progress bookkeeping, not a domain audit target
          const em = this.em();
          await em.nativeUpdate('BulkOperation', { id }, { processed: 1 });
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('scopes build-breaking to migrated modules', () => {
    expect(isMigratedServicePath('src/modules/catalog/services/x.ts', ['catalog'])).toBe(true);
    expect(isMigratedServicePath('src/modules/catalog/services/x.ts', ['pricing'])).toBe(false);
    expect(isMigratedServicePath('src/modules/catalog/services/x.ts', [])).toBe(false);
  });
});

/**
 * The other direction (issue #116).
 *
 * 185 methods carry the escape hatch and nothing ever re-read one, so a marker
 * written for a write that has since moved kept exempting a method that no
 * longer needs exempting — and the next write added there inherited the
 * exemption in silence. The sweep is what makes this a ratchet rather than an
 * allow-list, and its failure mode is the opposite of the flagging half's: it
 * must not call a marker dead because the write is expressed in a shape this
 * check cannot read. So both are pinned here.
 */
describe('the escape hatch is swept for staleness', () => {
  it('reports a marker on a method that writes nothing', () => {
    const src = `
      export class Svc {
        constructor(private em: () => any, private payments: any) {}
        async reflectRefund(id: string) {
          // command-coverage-ignore: the durable write is the payments module's
          const em = this.em();
          const payment = await em.findOne('Payment', { id });
          await this.payments.reflectRefund({ paymentId: payment.id });
        }
      }`;
    const findings = analyzeSource(PATH, src);
    expect(findings.map((f) => f.kind)).toEqual(['stale-ignore']);
    expect(findings[0]?.method).toBe('reflectRefund');
    // The marker's own line, not the method's — the finding has to point at the
    // comment somebody has to delete.
    expect(findings[0]?.line).toBe(5);
  });

  it('leaves a marker alone while its method still mutates', () => {
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async bumpCounter(id: string) {
          // command-coverage-ignore: bulk-operation progress bookkeeping
          const em = this.em();
          await em.nativeUpdate('BulkOperation', { id }, { processed: 1 });
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('leaves a marker alone over a raw SQL write the flagging half cannot see', () => {
    // `conn.execute` is not in MUTATION_METHODS, so this method is invisible to
    // the flagging half — and a staleness sweep sharing that vocabulary would
    // demand the deletion of a marker guarding a real, deliberate write.
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async heartbeat(runId: string) {
          // command-coverage-ignore: liveness signal written by the running job
          const em = this.em();
          await em.getConnection().execute(
            'update "import_runs" set "heartbeat_at" = now() where "id" = ?',
            [runId],
          );
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('leaves a marker alone when the write is one delegation away', () => {
    // `reserve` documents the decision for the whole path and delegates the
    // rows to a private helper. Reading only the marked method would report it.
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async reserve(input: any) {
          // command-coverage-ignore: runs inside the caller's order transaction
          return this.applyReservation(input);
        }
        private async applyReservation(input: any) {
          // command-coverage-ignore: the reservation path reserve() runs
          const em = this.em();
          em.persist(em.create('Reservation', input));
        }
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('terminates on a delegation cycle instead of recursing forever', () => {
    const src = `
      export class Svc {
        async a() {
          // command-coverage-ignore: nothing here
          return this.b();
        }
        async b() { return this.a(); }
      }`;
    expect(analyzeSource(PATH, src).map((f) => f.kind)).toEqual(['stale-ignore']);
  });
});

/**
 * The `--strict` assertion CI makes, inside the suite.
 *
 * The rollout is complete, so CI build-breaks on ANY finding in ANY module —
 * but that gate lived only in the `quality` job, and it was red on `master` for
 * a day while work continued (issue #93), because moving a function into a
 * `services/` file brought it into the check's scan for the first time. The
 * working agreement asks for typecheck + lint + tests before a push, so this is
 * where an unaudited write has to become visible as well.
 */
describe('the tree itself (what CI asserts with --strict)', () => {
  it('has no service method that mutates without a Command, an audit entry or a documented ignore', () => {
    const modulesRoot = fileURLToPath(new URL('../../../src/modules', import.meta.url));
    const findings = collectServiceFiles(modulesRoot).flatMap((file) =>
      analyzeSource(file.replace(modulesRoot, 'src/modules'), readFileSync(file, 'utf8')),
    );
    expect(findings.map((f) => `${f.filePath}:${f.line} → ${f.kind}: ${f.message}`)).toEqual([]);
  });
});
