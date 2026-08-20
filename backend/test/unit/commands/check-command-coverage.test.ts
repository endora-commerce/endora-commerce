import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeSource,
  collectScannedFiles,
  isMigratedModulePath,
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
    expect(isMigratedModulePath('src/modules/catalog/services/x.ts', ['catalog'])).toBe(true);
    expect(isMigratedModulePath('src/modules/catalog/services/x.ts', ['pricing'])).toBe(false);
    expect(isMigratedModulePath('src/modules/catalog/services/x.ts', [])).toBe(false);
  });

  it('scopes build-breaking by module for a file outside services/ too', () => {
    // The scope test used to require `/services/` in the path, so every file the
    // widened walk added would have been report-only even in a migrated module.
    expect(isMigratedModulePath('src/modules/catalog/routes.admin.ts', ['catalog'])).toBe(true);
    expect(isMigratedModulePath('src/modules/catalog/workers/reindex.ts', ['catalog'])).toBe(true);
    expect(isMigratedModulePath('src/modules/blog/routes.admin.ts', ['catalog'])).toBe(false);
  });
});

/**
 * What "every service" was allowed to mean (issue #122).
 *
 * `collectServiceFiles` matched `**​/services/<file>.ts` — one level, nothing
 * else. Measured against the tree: **472 of 1152** module files, so 680 were
 * never opened, 78 of them containing a write signal. `pim_ergonode`'s import
 * phases, `product_feeds`' delivery adapters and queue scheduler, every
 * `workers/`, `queues/` and `jobs/` file, every `commands/` file and every
 * `routes*.ts` were outside it — which is to say the check never looked where a
 * queue consumer or an admin route writes.
 *
 * The boundary is now "every file a module owns", and the exclusions are
 * arguments rather than omissions — see the header of the check.
 */
describe('the scan reaches every file a module owns (issue #122)', () => {
  const modulesRoot = fileURLToPath(new URL('../../../src/modules', import.meta.url));
  const files = collectScannedFiles(modulesRoot).map((f) => f.replace(modulesRoot, ''));
  const has = (suffix: string): boolean => files.some((f) => f.endsWith(suffix));

  it('opens nested service directories, not just services/<file>.ts', () => {
    expect(has('/pim_ergonode/services/import/import-orchestrator.ts')).toBe(true);
    expect(has('/product_feeds/services/delivery/delivery.service.ts')).toBe(true);
    expect(has('/product_feeds/services/queues/feed-scheduler.ts')).toBe(true);
  });

  it('opens queue consumers — workers, queues and jobs', () => {
    expect(has('/product_feeds/workers/taxonomy-refresh-worker.ts')).toBe(true);
    expect(has('/pim_ergonode/queues/import-scheduler.ts')).toBe(true);
    expect(has('/assets_library/jobs/hard-delete-asset.job.ts')).toBe(true);
  });

  it('opens route files, command files and the composition seam', () => {
    expect(has('/autopay/routes.admin.ts')).toBe(true);
    expect(has('/product_feeds/commands/product-feed.commands.ts')).toBe(true);
    expect(has('/customer_accounts/backend.ts')).toBe(true);
  });

  it('opens CLI entry points and boot-time seeds', () => {
    expect(has('/admin_users/scripts/create-admin.ts')).toBe(true);
    expect(has('/product_feeds/seeds/predefined-templates.ts')).toBe(true);
  });

  it('still excludes migrations, tests, declarations and the audit writer', () => {
    expect(files.some((f) => f.includes('/migrations/'))).toBe(false);
    expect(files.some((f) => f.endsWith('.test.ts') || f.endsWith('.d.ts'))).toBe(false);
    expect(files.some((f) => f.includes('/audit_logs/'))).toBe(false);
  });

  it('reaches overlay modules and decorations under src/apps', () => {
    const appsRoot = fileURLToPath(new URL('../../../src/apps', import.meta.url));
    const overlay = collectScannedFiles(appsRoot).map((f) => f.replace(appsRoot, ''));
    expect(overlay.some((f) => f.endsWith('/decorations/pricing-service.ts'))).toBe(true);
    expect(overlay.some((f) => f.includes('/modules/example_overlay/'))).toBe(true);
  });
});

/**
 * The newly scanned categories, each driven red on synthetic input.
 *
 * `docs/docs/architecture/kernel.md` § "Writing a check that can go red": a
 * category the walk now reaches but the analyzer cannot flag would be the same
 * defect one layer down.
 */
describe('the analyzer flags a write in each newly scanned category', () => {
  const write = `
    const em = this.em();
    const row = em.create('X', { id });
    await em.persistAndFlush(row);`;

  it('flags a queue-worker processor that mutates', () => {
    const src = `
      export function makeProcessor(deps: any) {
        return async (job: any) => {
          const em = deps.emFactory();
          const run = await em.findOne('Run', { id: job.data.id });
          run.state = 'done';
          await em.persistAndFlush(run);
        };
      }`;
    const findings = analyzeSource('src/modules/pwa/workers/push-worker.ts', src);
    expect(findings.map((f) => f.kind)).toEqual(['unaudited-sensitive-write']);
  });

  it('flags an import phase in a nested service directory', () => {
    const src = `
      export class ProductPhase {
        constructor(private em: () => any) {}
        async apply(id: string) {${write}
        }
      }`;
    const findings = analyzeSource(
      'src/modules/pim_ergonode/services/import/product-phase.ts',
      src,
    );
    expect(findings.map((f) => f.method)).toEqual(['apply']);
  });

  it('flags a boot hook in backend.ts that mutates', () => {
    const src = `
      export function registerModule(ctx: any) {
        ctx.onBoot(async ({ em }: any) => {
          const row = em.create('Defaults', {});
          await em.persistAndFlush(row);
        });
      }`;
    const findings = analyzeSource('src/modules/customer_accounts/backend.ts', src);
    expect(findings.map((f) => f.kind)).toEqual(['unaudited-sensitive-write']);
  });

  it('flags a module-level helper in a commands file that nothing audited calls', () => {
    const src = `
      export async function orphanWrite(em: any, id: string) {
        const row = em.create('X', { id });
        await em.persistAndFlush(row);
      }`;
    const findings = analyzeSource('src/modules/product_feeds/commands/x.commands.ts', src);
    expect(findings.map((f) => f.method)).toEqual(['orphanWrite']);
  });

  it('clears a module-level helper the Command it belongs to calls', () => {
    // `replaceFields` writes inside the Command's own transaction — the shape
    // `product_feeds/commands/feed-template.commands.ts` uses. Delegation used
    // to be recognised only through `this.<name>()`, which a free function in a
    // commands file can never be.
    const src = `
      async function replaceFields(em: any, id: string) {
        const row = em.create('Field', { id });
        em.persist(row);
        await em.flush();
      }
      export function updateTemplateCommand(id: string) {
        return {
          action: 'feed_template.update',
          objectType: 'feed_template',
          objectId: id,
          run: async ({ em }: any) => {
            await replaceFields(em, id);
            return { result: null };
          },
        };
      }`;
    expect(analyzeSource('src/modules/product_feeds/commands/x.commands.ts', src)).toEqual([]);
  });
});

/**
 * Route files, per handler.
 *
 * A route registration function is not a unit of work — each handler is. Judging
 * the whole `registerXAdminRoutes` as one unit makes a single `commandBus.run`
 * anywhere in the file clear every other handler in it, which is the masking the
 * per-method rule was introduced to prevent, one level up.
 */
describe('a route file is judged per handler, not per registration function', () => {
  const ROUTES = 'src/modules/autopay/routes.admin.ts';

  it('flags the handler that writes and leaves the audited one alone', () => {
    const src = `
      export function registerAutopayAdminRoutes(app: any, deps: any) {
        app.post('/api/v1/admin/autopay/methods', { preHandler: gate }, async (request: any) => {
          return deps.commandBus.run(createMethodCommand(request.body));
        });
        app.put('/api/v1/admin/autopay/methods/:id', { preHandler: gate }, async (request: any) => {
          const em = deps.emFactory();
          const method = await em.findOne('PaymentMethod', { id: request.params.id });
          method.status = request.body.status;
          await em.persistAndFlush(method);
          return { data: method };
        });
      }`;
    const findings = analyzeSource(ROUTES, src);
    expect(findings.map((f) => f.kind)).toEqual(['unaudited-sensitive-write']);
    expect(findings[0]?.method).toBe('PUT /api/v1/admin/autopay/methods/:id');
  });

  it('does not report a double-audit across two different handlers', () => {
    // One handler runs a Command, another still audits by hand mid-migration.
    // Read as one unit, that file reports a double-audit that exists nowhere.
    const src = `
      export function registerOrganizationsAdminRoutes(app: any, deps: any) {
        app.post('/api/v1/admin/organizations', {}, async (request: any) => {
          return deps.commandBus.run(createOrgCommand(request.body));
        });
        app.put('/api/v1/admin/organizations/:id/notes', {}, async (request: any) => {
          const em = deps.emFactory();
          const org = await em.findOne('Organization', { id: request.params.id });
          org.notes = request.body.notes;
          await em.persistAndFlush(org);
          await deps.auditLog.record({ action: 'organization.notes', objectType: 'organization', objectId: org.id });
          return { data: org };
        });
      }`;
    expect(analyzeSource('src/modules/organizations/routes.admin.ts', src)).toEqual([]);
  });

  it('treats a handler that calls the file’s local `audit(...)` closure as covered', () => {
    // `organizations/routes.admin.ts` declares `const audit = async (…) => …`
    // *inside* the registration function and every write calls it. That closure
    // is not a top-level unit, so recorder delegation could not see it and all
    // six of its audited handlers were reported.
    const src = `
      export function registerOrganizationsAdminRoutes(app: any, deps: any) {
        const audit = async (request: any, action: string, id: string) => {
          await deps.auditLogService.record({ action, objectType: 'organization', objectId: id });
        };
        app.patch('/api/v1/admin/organizations/:id', {}, async (request: any) => {
          const em = deps.emFactory();
          const org = await em.findOne('Organization', { id: request.params.id });
          org.name = request.body.name;
          await em.flush();
          await audit(request, 'organization.admin_patch', org.id);
          return { data: org };
        });
      }`;
    expect(analyzeSource('src/modules/organizations/routes.admin.ts', src)).toEqual([]);
  });

  it('still flags the handler next to it that calls no such helper', () => {
    const src = `
      export function registerOrganizationsAdminRoutes(app: any, deps: any) {
        const audit = async (action: string, id: string) => {
          await deps.auditLogService.record({ action, objectType: 'organization', objectId: id });
        };
        app.patch('/api/v1/admin/organizations/:id', {}, async (request: any) => {
          const em = deps.emFactory();
          const org = await em.findOne('Organization', { id: request.params.id });
          org.name = request.body.name;
          await em.flush();
          await audit('organization.admin_patch', org.id);
        });
        app.delete('/api/v1/admin/organizations/:id/notes', {}, async (request: any) => {
          const em = deps.emFactory();
          await em.nativeDelete('OrganizationNote', { organizationId: request.params.id });
        });
      }`;
    const findings = analyzeSource('src/modules/organizations/routes.admin.ts', src);
    expect(findings.map((f) => f.method)).toEqual(['DELETE /api/v1/admin/organizations/:id/notes']);
  });

  it('does not treat a `map.get(key)` or `set.delete(key)` as a route registration', () => {
    const src = `
      export function build(cache: Map<string, string>) {
        const value = cache.get('a');
        cache.delete('a');
        return value;
      }`;
    expect(analyzeSource(ROUTES, src)).toEqual([]);
  });
});

/**
 * Narrowing, not exempting (issue #122).
 *
 * Widening the walk turned `remove` into the loudest word in the tree: 30 of the
 * 36 first-pass findings were `deps.<something>Service.remove(id)` in a route
 * handler — a call into an audited service, not an ORM mutation. An exemption
 * for each would have been a lie about 30 files; the detector was simply wrong
 * about what `remove` means off an arbitrary receiver.
 */
describe('a mutation name only counts off an EntityManager when the name is ambiguous', () => {
  const ROUTES = 'src/modules/dictionaries/routes.admin.ts';

  it('ignores `remove` on a service receiver', () => {
    const src = `
      export function registerDictionaryAdminRoutes(app: any, deps: any) {
        app.delete('/api/v1/admin/dictionary/countries/:code', {}, async (request: any, reply: any) => {
          await deps.countryService.remove(request.params.code);
          return reply.status(204).send();
        });
      }`;
    expect(analyzeSource(ROUTES, src)).toEqual([]);
  });

  it('ignores `remove` on a queue backend or a transport client', () => {
    const src = `
      export class Scheduler {
        constructor(private backend: any) {}
        async drop(id: string) {
          await this.backend.remove(id);
        }
      }`;
    expect(analyzeSource('src/modules/pim_ergonode/queues/import-scheduler.ts', src)).toEqual([]);
  });

  it('still flags `remove` on every EntityManager spelling in the tree', () => {
    for (const em of ['em', 'tem', 'cem', 'tx', 'txEm', 'targetEm']) {
      const src = `
        export class Svc {
          async drop(${em}: any, id: string) {
            const row = await ${em}.findOne('X', { id });
            ${em}.remove(row);
            await ${em}.flush();
          }
        }`;
      const findings = analyzeSource('src/modules/catalog/services/x.ts', src);
      expect(findings.map((f) => f.kind), em).toEqual(['unaudited-sensitive-write']);
    }
  });

  it('follows a chained `em.remove(a).remove(b).flush()`', () => {
    const src = `
      export class Svc {
        async drop(em: any, a: any, b: any) {
          await em.remove(a).remove(b).flush();
        }
      }`;
    expect(analyzeSource('src/modules/returns/services/x.ts', src).map((f) => f.kind)).toEqual([
      'unaudited-sensitive-write',
    ]);
  });

  // --- `create` joins the vocabulary (D-89) ---------------------------------

  it('flags `em.create` alone, with no persist and no flush in the unit', () => {
    // The entity is managed from that call, so the next flush inserts it
    // whoever calls it. This is the hole that let a CSV import rewrite
    // catalogue and stock unaudited for a year.
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async add(id: string) {
          this.em().create(Thing, { id });
        }
      }`;
    expect(analyzeSource('src/modules/price_lists/services/x.ts', src).map((f) => f.kind)).toEqual([
      'unaudited-sensitive-write',
    ]);
  });

  it('flags `em.create` on every EntityManager spelling', () => {
    for (const em of ['em', 'tem', 'cem', 'tx', 'txEm', 'targetEm']) {
      const src = `
        export class Svc {
          async add(${em}: any, id: string) {
            ${em}.create('X', { id });
          }
        }`;
      expect(analyzeSource('src/modules/catalog/services/x.ts', src).map((f) => f.kind), em).toEqual(
        ['unaudited-sensitive-write'],
      );
    }
  });

  it('ignores `create` on a service receiver — the `remove` narrowing’s twin', () => {
    // `create` is the name of nearly every service method in this tree, so
    // without the EntityManager narrowing the widening would manufacture a
    // finding on most route handlers rather than find one.
    const src = `
      export function registerAdminRoutes(app: any, deps: any) {
        app.post('/api/v1/admin/orders', {}, async (request: any, reply: any) => {
          const order = await deps.orderService.create(request.body);
          return reply.status(201).send(order);
        });
      }`;
    expect(analyzeSource('src/modules/orders/routes.admin.ts', src)).toEqual([]);
  });

  it('ignores `em.create` in a unit that runs a Command', () => {
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async add(id: string) {
          await this.commandBus.run(addThing(id));
          this.em().create(Thing, { id });
        }
      }`;
    expect(analyzeSource('src/modules/price_lists/services/x.ts', src)).toEqual([]);
  });

  it('does not see a field assignment on a managed entity, and says so in the header', () => {
    // The stated limit (D-89b), asserted rather than discovered. Teaching the
    // check to read assignments has to rewrite the header paragraph in the same
    // merge request, because this test goes red.
    const src = `
      export class Svc {
        async settle(order: any, ref: string) {
          order.status = 'paid';
          order.externalReference = ref;
        }
      }`;
    expect(analyzeSource('src/modules/orders/services/x.ts', src)).toEqual([]);
  });

  it('keeps an ambiguous `remove` counting for the staleness half', () => {
    // The asymmetry the sweep depends on: the flagging half declines to call
    // `scheduler.remove(id)` an ORM write, and the staleness half still counts
    // it, so a marker deliberately placed over one is not reported as dead.
    const src = `
      export class Svc {
        constructor(private deps: any) {}
        async drop(id: string) {
          // command-coverage-ignore: Redis-only, the durable row is the setting
          await this.deps.scheduler.remove(id);
        }
      }`;
    expect(analyzeSource('src/modules/product_feeds/services/x.ts', src)).toEqual([]);
  });
});

/**
 * Where a marker has to be to mean anything.
 *
 * Suppression was resolved by searching the unit's **full** start, which
 * includes every scrap of leading trivia — so a file header that merely
 * *mentions* `command-coverage-ignore` (four command files describe the module's
 * policy that way) silently exempted whatever declaration happened to come
 * first, and, once the sweep landed, reported that declaration as a stale
 * marker nobody had written.
 */
describe('a marker attaches to the unit it is written on', () => {
  const PATH = 'src/modules/product_feeds/commands/product-feed.commands.ts';

  it('ignores a file header that only mentions the token', () => {
    const src = `
      /**
       * Product Feed Commands.
       *
       * Deliberately NOT commands (each carries \`command-coverage-ignore\` at
       * its site): run status transitions and the reaper.
       */

      /** Envelope every module event carries. */
      function envelope() {
        return { eventId: '1', occurredAt: 'now' };
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('still honours a marker written in the unit’s own doc comment', () => {
    // `_lifecycle/services/presence-load.ts` spells its rationale out in JSDoc
    // above the function rather than inside it, and that has to keep working.
    const src = `
      /**
       * Boot convergence of the registry to the shipped manifest list.
       *
       * command-coverage-ignore: a system-invariant repair with no operator
       * behind it.
       */
      async function reconcileExistingModules(em: any, manifests: any[]) {
        for (const m of manifests) em.create('ModuleRegistration', { moduleId: m.id });
        await em.flush();
      }`;
    expect(analyzeSource('src/modules/_lifecycle/services/presence-load.ts', src)).toEqual([]);
  });

  it('ignores a file header even when the unit under it has no doc comment', () => {
    // `product_feeds/commands/taxonomy-revision.commands.ts`: the header quotes
    // the token, `envelope()` carries no JSDoc of its own, and a blank line
    // separates them. Taking "the last leading comment" alone still read it.
    const src = `
      /**
       * Taxonomy revision commands.
       *
       * The automated check carries a \`command-coverage-ignore\`; promotion
       * does not.
       */

      function envelope() {
        return { eventId: '1', occurredAt: 'now' };
      }`;
    expect(analyzeSource(PATH, src)).toEqual([]);
  });

  it('does not let a marker inside one route handler exempt its neighbour', () => {
    const src = `
      export function registerRoutes(app: any, deps: any) {
        app.post('/api/v1/admin/a', {}, async () => {
          // command-coverage-ignore: cache warm-up row, no operator behind it
          const em = deps.emFactory();
          await em.nativeUpdate('Cache', {}, { warmedAt: new Date() });
        });
        app.post('/api/v1/admin/b', {}, async (request: any) => {
          const em = deps.emFactory();
          const row = em.create('Thing', request.body);
          await em.persistAndFlush(row);
        });
      }`;
    const findings = analyzeSource('src/modules/catalog/routes.admin.ts', src);
    expect(findings.map((f) => f.method)).toEqual(['POST /api/v1/admin/b']);
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

  it('leaves a marker alone over a queue write that never reaches the database', () => {
    // `product_feeds/workers/taxonomy-refresh-worker.ts`. The marker says
    // "Redis-only" and is right; a sweep that knows only ORM and SQL calls it
    // dead the moment `workers/` comes into scope, and the fix is a deletion of
    // a correct decision.
    const src = `
      export async function removeTaxonomyRefreshSchedule(queue: any) {
        // command-coverage-ignore: Redis-only. Removing the Job Scheduler
        // projects an already-committed setting whose write Settings audits.
        await queue.removeJobScheduler('taxonomy-refresh').catch(() => undefined);
      }`;
    expect(analyzeSource('src/modules/product_feeds/workers/w.ts', src)).toEqual([]);
  });

  it('leaves a marker alone when the write is one delegation away', () => {
    // `reserve` documents the decision for the whole path and delegates the
    // rows to a private helper. Reading only the marked method would report it.
    // Asserted on `reserve` alone: the helper's own coverage is a separate
    // question, and answering both here is what made this fixture ambiguous
    // once D-89(c) gave the callee's marker a second meaning.
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async reserve(input: any) {
          // command-coverage-ignore: runs inside the caller's order transaction
          return this.applyReservation(input);
        }
        private async applyReservation(input: any) {
          const em = this.em();
          em.persist(em.create('Reservation', input));
        }
      }`;
    expect(analyzeSource(PATH, src).filter((f) => f.method === 'reserve')).toEqual([]);
  });

  it('reports the caller when the delegate carries a marker of its own (D-89c)', () => {
    // The mirror image, and the shape `payments/services/payment-reference-port.ts`
    // carried in the tree: an exemption on two public callers while the private
    // body did the `flush`, plus a third marker on the body added later with a
    // comment explaining that the check "reads the function that writes". The
    // write is already exempted where it happens, so the caller's marker is
    // provably guarding nothing — and until D-89(c) the transitive rule counted
    // the callee's write and kept it alive.
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
    const findings = analyzeSource(PATH, src);
    expect(findings.map((f) => f.kind)).toEqual(['stale-ignore']);
    expect(findings[0]?.method).toBe('reserve');
  });

  it('still leaves a marker alone when only some of the delegates carry one', () => {
    // The subtraction is per callee, not per unit: a marker whose *other*
    // delegate writes unexempted is still guarding something.
    const src = `
      export class Svc {
        constructor(private em: () => any) {}
        async reserve(input: any) {
          // command-coverage-ignore: runs inside the caller's order transaction
          await this.markAudited(input);
          return this.applyReservation(input);
        }
        private async markAudited(input: any) {
          // command-coverage-ignore: bookkeeping counter only
          const em = this.em();
          await em.nativeUpdate('Counter', { id: input.id }, { seen: 1 });
        }
        private async applyReservation(input: any) {
          const em = this.em();
          em.persist(em.create('Reservation', input));
        }
      }`;
    expect(analyzeSource(PATH, src).filter((f) => f.method === 'reserve')).toEqual([]);
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
  it('has no unit that mutates without a Command, an audit entry or a documented ignore', () => {
    const srcRoot = fileURLToPath(new URL('../../../src', import.meta.url));
    const findings = ['modules', 'apps'].flatMap((dir) =>
      collectScannedFiles(join(srcRoot, dir)).flatMap((file) =>
        analyzeSource(file.replace(srcRoot, 'src'), readFileSync(file, 'utf8')),
      ),
    );
    expect(findings.map((f) => `${f.filePath}:${f.line} → ${f.kind}: ${f.message}`)).toEqual([]);
  });
});
