import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { hookableAction } from '@endora-commerce/contracts';
import { CommandBus } from '../command-bus.js';
import type { Command } from '../command.js';
import { EventBus } from '../../events/bus.js';
import type { AuditPort } from '../../kernel/ports/audit.js';
import { runWithTenantContext } from '../../tenancy/tenant-context.js';
import { currentCommandHookOrigin, type CommandHookOrigin } from './origin.js';
import { CommandHookRegistry } from './registry.js';

/**
 * `specs/176-command-hooks-outbox/` T026 (FR-021): the hook running on this
 * async path is observable by code it calls — the owner-side accessor spec 178
 * writes asks it which module is writing — and by every Command the hook runs,
 * and by nothing outside it.
 */

const fakeEm = {
  async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
    return cb(fakeEm as unknown as EntityManager);
  },
};
const orm = { em: { fork: () => fakeEm } } as unknown as MikroORM;
const audit = { recordWithin: () => ({}) } as unknown as AuditPort;

const WIDGET_CREATE = hookableAction<unknown>('widget.create', 'widget', ['beforeCommit']);

describe('currentCommandHookOrigin (176 T026)', () => {
  it('is set inside the hook and inside the Commands it runs, and undefined outside', async () => {
    const registry = new CommandHookRegistry();
    const observed: Array<{ where: string; origin: CommandHookOrigin | undefined }> = [];
    const child: Command<null> = {
      action: 'note.create',
      objectType: 'note',
      objectId: 'n-1',
      async run() {
        observed.push({ where: 'child', origin: currentCommandHookOrigin() });
        return { result: null };
      },
    };
    registry.register('acme_erp', [
      {
        id: 'write-columns',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: async (ctx) => {
          observed.push({ where: 'hook', origin: currentCommandHookOrigin() });
          await Promise.resolve();
          observed.push({ where: 'hook-after-await', origin: currentCommandHookOrigin() });
          await ctx.run(child);
        },
      },
    ]);
    registry.seal({
      hookableActions: [{ moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] }],
      moduleDependencies: { widgets: [], acme_erp: ['widgets'] },
      commandHookOrder: {},
    });
    const bus = new CommandBus(orm, audit, new EventBus(), { hooks: registry });

    await runWithTenantContext({ mode: 'all', actor: { kind: 'admin', id: 'admin-1' } }, () =>
      bus.run({
        action: 'widget.create',
        objectType: 'widget',
        objectId: 'w-1',
        async run() {
          observed.push({ where: 'owner', origin: currentCommandHookOrigin() });
          return { result: null };
        },
        hookData: () => ({}),
      }),
    );

    const origin = { moduleId: 'acme_erp', hookId: 'write-columns', action: 'widget.create' };
    expect(observed).toEqual([
      { where: 'owner', origin: undefined },
      { where: 'hook', origin },
      { where: 'hook-after-await', origin },
      { where: 'child', origin },
    ]);
    expect(currentCommandHookOrigin()).toBeUndefined();
  });
});
