import { asValue } from 'awilix';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hookableAction } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandActor } from '../../commands/command.js';
import type { CommandHookContext } from '../../commands/hooks/types.js';
import { HttpError } from '../../http/error-envelope.js';
import { createRootContainer } from '../container.js';
import { enterPlatformScope } from '../scope.js';
import { fieldSlotHook } from './field-slot-hook.js';

/**
 * `specs/193-admin-form-extensions/` T022 (FR-014, `contracts/field-slots.md`
 * §4): the platform's slot-field hook. An absent slice is a no-op; an invalid
 * one answers `422 FIELD_SLOT_INPUT_INVALID` with paths under
 * `extensions.<moduleId>`; a changed key the actor may not write answers
 * `403 FIELD_WRITE_FORBIDDEN`; what was written is noted for the audit entry.
 */

const CREATE = hookableAction<{ organization: { id: string } }>('organization.create', 'organization', ['beforeCommit']);
const UPDATE = hookableAction<{ organization: { id: string } }>('organization.admin_patch', 'organization', ['beforeCommit']);

const admin: CommandActor = { actorAdminUserId: 'admin-1', impersonatedCustomerAccountId: null, actorCustomerAccountId: null, kind: 'admin' };
const system: CommandActor = { actorAdminUserId: null, impersonatedCustomerAccountId: null, actorCustomerAccountId: null, kind: 'system' };

const Slice = z.strictObject({ code: z.string().max(8).optional(), tier: z.enum(['gold', 'silver']).optional() });

function hookCtx(extension: unknown, actor: CommandActor = admin) {
  const noted: string[][] = [];
  const ctx: CommandHookContext<unknown> = {
    action: 'organization.create',
    objectType: 'organization',
    objectId: 'org-1',
    data: { organization: { id: 'org-1' } },
    extension,
    em: {} as EntityManager,
    actor,
    module: { id: 'acme_erp' },
    run: async () => {
      throw new Error('not used');
    },
    noteAuditChanges: (fields) => void noted.push([...fields]),
  };
  return { ctx, noted };
}

/** Run inside a platform scope whose container answers `permissionService` with `granted`. */
function asAdmin<T>(granted: readonly string[], fn: () => Promise<T>): Promise<T> {
  const container = createRootContainer();
  container.register({
    permissionService: asValue({ hasPermission: async (_id: string, code: string) => granted.includes(code), isActiveAdministrator: async () => true }),
  });
  return enterPlatformScope({ mode: 'all', actor: { kind: 'admin', id: 'admin-1' } }, fn, { container, entryPoint: 'worker' });
}

function slotHook(written: unknown[] = []) {
  return fieldSlotHook({
    id: 'erp-code',
    on: [CREATE, UPDATE],
    schema: Slice,
    writePermissions: { tier: 'acme_erp:tier' },
    write: async (_ctx, slice) => {
      written.push(slice);
      return Object.keys(slice);
    },
  });
}

describe('fieldSlotHook (193 T022)', () => {
  it('returns one beforeCommit entry per writer it extends, with stable kebab-case ids', () => {
    const entries = slotHook();
    expect(entries.map((entry) => [entry.id, entry.on.action, entry.phase])).toEqual([
      ['erp-code-organization-create', 'organization.create', 'beforeCommit'],
      ['erp-code-organization-admin-patch', 'organization.admin_patch', 'beforeCommit'],
    ]);
    const single = fieldSlotHook({ id: 'erp-code', on: [CREATE], schema: Slice, write: async () => [] });
    expect(single.map((entry) => entry.id)).toEqual(['erp-code']);
  });

  it('is a no-op for an absent slice: nothing written, nothing noted', async () => {
    const written: unknown[] = [];
    const [entry] = slotHook(written);
    const { ctx, noted } = hookCtx(undefined);
    await entry!.handler(ctx as never);
    expect(written).toEqual([]);
    expect(noted).toEqual([]);
  });

  it('refuses an invalid slice with 422 FIELD_SLOT_INPUT_INVALID and paths under extensions.<moduleId>', async () => {
    const written: unknown[] = [];
    const [entry] = slotHook(written);
    const { ctx } = hookCtx({ code: 'TOO-LONG-CODE', tier: 'bronze', extra: 1 });
    const error = await Promise.resolve(entry!.handler(ctx as never)).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 422, code: 'FIELD_SLOT_INPUT_INVALID' });
    const paths = ((error as HttpError).details as { path: string }[]).map((detail) => detail.path).sort();
    expect(paths).toEqual(['extensions.acme_erp', 'extensions.acme_erp.code', 'extensions.acme_erp.tier']);
    expect(written).toEqual([]);
  });

  it('writes a valid slice and notes the changed field names', async () => {
    const written: unknown[] = [];
    const [entry] = slotHook(written);
    const { ctx, noted } = hookCtx({ code: 'A1' });
    await asAdmin([], () => Promise.resolve(entry!.handler(ctx as never)));
    expect(written).toEqual([{ code: 'A1' }]);
    expect(noted).toEqual([['code']]);
  });

  it('refuses a changed key the administrator may not write with 403 FIELD_WRITE_FORBIDDEN', async () => {
    const [entry] = slotHook();
    const { ctx, noted } = hookCtx({ code: 'A1', tier: 'gold' });
    const error = await asAdmin([], () => Promise.resolve(entry!.handler(ctx as never))).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ statusCode: 403, code: 'FIELD_WRITE_FORBIDDEN' });
    expect((error as HttpError).details).toEqual([
      { path: 'extensions.acme_erp.tier', permission: 'acme_erp:tier', reason: 'missing-permission', message: expect.any(String) },
    ]);
    expect(noted).toEqual([]);
  });

  it('admits the administrator holding the permission, and the system actor', async () => {
    const [entry] = slotHook();
    const granted = hookCtx({ tier: 'gold' });
    await asAdmin(['acme_erp:tier'], () => Promise.resolve(entry!.handler(granted.ctx as never)));
    expect(granted.noted).toEqual([['tier']]);
    const bySystem = hookCtx({ tier: 'gold' }, system);
    await Promise.resolve(entry!.handler(bySystem.ctx as never));
    expect(bySystem.noted).toEqual([['tier']]);
  });

  it('asks the permission of a key only when the write changed it', async () => {
    const [entry] = fieldSlotHook({
      id: 'erp-code',
      on: [CREATE],
      schema: Slice,
      writePermissions: { tier: 'acme_erp:tier' },
      // The stored tier was already gold: the module reports no change to it.
      write: async () => ['code'],
    });
    const { ctx, noted } = hookCtx({ code: 'A1', tier: 'gold' });
    await asAdmin([], () => Promise.resolve(entry!.handler(ctx as never)));
    expect(noted).toEqual([['code']]);
  });
});
