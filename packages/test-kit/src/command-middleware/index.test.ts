import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { defineModuleErrorCodes, type ModuleManifest } from '@endora-commerce/contracts';
import { CommandBus, CommandRefusedError, type Command } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import { enterSystemScope, type AuditPort } from '@endora-commerce/platform/kernel';
import {
  expectCommandMiddleware,
  expectDeclaredRefusal,
  recordingCommandMiddleware,
  sealedCommandMiddlewareRegistry,
} from './index.js';

/**
 * `specs/189-command-middleware/` T050 (FR-040): the test kit's middleware
 * helpers run on the **real** `CommandBus`, with composition's own ordering,
 * gating, budgets and refusals — no in-memory bus to keep in step (R-17).
 */

const ACME = defineModuleErrorCodes(['ACME_HOLD_REFUSED'] as const);

function bus(middleware: ReturnType<typeof sealedCommandMiddlewareRegistry>): CommandBus {
  const em = {
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = { recordWithin: () => ({}) as never } as unknown as AuditPort;
  return new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), { middleware });
}

const write = (action: string, children: Command<unknown>[] = []): Command<string> => ({
  action,
  objectType: action.split('.')[0]!,
  objectId: `${action}-1`,
  async run(ctx) {
    for (const child of children) await ctx.run!(child);
    return { result: action };
  },
});

/** The module-facing scope a test outside a request runs a Command in. */
const inScope = <T>(fn: () => Promise<T>): Promise<T> => enterSystemScope('test-kit command middleware', fn);

describe('sealedCommandMiddlewareRegistry and recordingCommandMiddleware (189 T050)', () => {
  it('admits the root and its child, and observes one outcome once settled', async () => {
    const recorder = recordingCommandMiddleware();
    const registry = sealedCommandMiddlewareRegistry({
      declarations: [
        { moduleId: 'acme_hold', id: 'record', phase: 'admit', actions: '*' },
        { moduleId: 'acme_hold', id: 'observe', phase: 'observe', actions: '*' },
      ],
      middleware: [{ moduleId: 'acme_hold', entries: [recorder.admit({ id: 'record' }), recorder.observe({ id: 'observe' })] }],
    });
    await inScope(() => bus(registry).run(write('quote.convert', [write('organization.admin_patch')])));
    await registry.settled();
    expect(recorder.admitted.map((meta) => [meta.action, meta.lineage.depth])).toEqual([
      ['quote.convert', 0],
      ['organization.admin_patch', 1],
    ]);
    expect(recorder.observed).toHaveLength(1);
    expect(recorder.observed[0]!.commands.map((entry) => entry.action)).toEqual(['quote.convert', 'organization.admin_patch']);
  });

  it('refuses through the recorder, with composition’s own default origin and isPresent', async () => {
    const recorder = recordingCommandMiddleware();
    let present = true;
    const registry = sealedCommandMiddlewareRegistry({
      declarations: [{ moduleId: 'acme_hold', id: 'admit', phase: 'admit', actions: ['organization.'] }],
      middleware: [
        {
          moduleId: 'acme_hold',
          entries: [recorder.admit({ id: 'admit', refuseWhen: () => new CommandRefusedError(ACME.ACME_HOLD_REFUSED) })],
        },
      ],
      isPresent: () => present,
    });
    expect(registry.plan()[0]).toMatchObject({ origin: 'core' });
    await expect(inScope(() => bus(registry).run(write('organization.admin_patch')))).rejects.toThrow(CommandRefusedError);
    present = false;
    await expect(inScope(() => bus(registry).run(write('organization.admin_patch')))).resolves.toBe('organization.admin_patch');
  });

  it('refuses with composition’s own error, an admit from a package', () => {
    expect(() =>
      sealedCommandMiddlewareRegistry({
        declarations: [{ moduleId: 'acme_pkg', id: 'admit', phase: 'admit', actions: '*' }],
        middleware: [{ moduleId: 'acme_pkg', entries: [recordingCommandMiddleware().admit()] }],
        origins: { acme_pkg: 'package' },
      }),
    ).toThrow(/D-296\.3/);
  });
});

describe('expectCommandMiddleware (189 T050)', () => {
  const manifest = (commandMiddleware: ModuleManifest['commandMiddleware']) =>
    ({ id: 'acme_hold', commandMiddleware }) as Pick<ModuleManifest, 'id' | 'commandMiddleware' | 'errorCodes'>;
  const observe = { id: 'timing', phase: 'observe' as const, observe: () => undefined };
  const admit = { id: 'hold', phase: 'admit' as const, admit: () => undefined };

  it('passes when declaration and registration agree', () => {
    expect(() =>
      expectCommandMiddleware(
        manifest([
          { id: 'hold', phase: 'admit', actions: '*' },
          { id: 'timing', phase: 'observe', actions: '*' },
        ]),
        [admit, observe],
      ),
    ).not.toThrow();
  });

  it('fails with composition’s message on a mismatch, a missing registration and an undeclared one', () => {
    expect(() => expectCommandMiddleware(manifest([{ id: 'hold', phase: 'observe', actions: '*' }]), [admit])).toThrow(
      /'hold' as 'observe' but registers it as 'admit'/,
    );
    expect(() => expectCommandMiddleware(manifest([{ id: 'hold', phase: 'admit', actions: '*' }]), [])).toThrow(
      /never registers it/,
    );
    expect(() => expectCommandMiddleware(manifest([]), [observe])).toThrow(/does not declare/);
  });

  it('fails when a phase is declared that the origin does not allow', () => {
    expect(() =>
      expectCommandMiddleware(manifest([{ id: 'hold', phase: 'admit', actions: '*' }]), [admit], { origin: 'package' }),
    ).toThrow(/D-296\.3/);
    expect(() =>
      expectCommandMiddleware(manifest([{ id: 'timing', phase: 'observe', actions: '*' }]), [observe], { origin: 'package' }),
    ).not.toThrow();
  });

  it('applies the manifest rules defineModuleManifest applies', () => {
    expect(() =>
      expectCommandMiddleware(manifest([{ id: 'hold', phase: 'admit', actions: '*', timeoutMs: 900 }]), [admit]),
    ).toThrow(/maximum is 500/);
  });
});

describe('expectDeclaredRefusal (189 T050)', () => {
  const manifest = { id: 'acme_hold', errorCodes: [{ code: 'ACME_HOLD_REFUSED' }] } as unknown as Pick<
    ModuleManifest,
    'id' | 'errorCodes'
  >;

  it('passes for a refusal whose code the module declares', () => {
    expect(() => expectDeclaredRefusal(new CommandRefusedError(ACME.ACME_HOLD_REFUSED), manifest)).not.toThrow();
  });

  it('fails for an undeclared code, and for anything that is not a refusal', () => {
    const other = defineModuleErrorCodes(['ACME_OTHER'] as const);
    expect(() => expectDeclaredRefusal(new CommandRefusedError(other.ACME_OTHER), manifest)).toThrow(/ACME_OTHER/);
    expect(() => expectDeclaredRefusal(new Error('boom'), manifest)).toThrow(/CommandRefusedError/);
  });
});
