import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, OPPORTUNITY_HOOKABLE_ACTIONS } from '@endora-commerce/contracts';
import { manifest } from '../../manifest.js';
import { OpportunityCommandService, type OpportunityCommandServiceDeps } from './opportunity-command-port.js';

const ID = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';

/**
 * `opportunityCommandPort` and `options.extensions`.
 *
 * `crm.opportunity.create` and `crm.opportunity.update` are hookable
 * (`specs/193-admin-form-extensions/` FR-111, issue #2006), so the methods
 * that run them — `create`, `update` and `setCustomFieldValues` — forward the
 * caller's `extensions` to the Command unread, and the bus decides who claims a
 * key (an unclaimed one is its `422 COMMAND_EXTENSION_UNCLAIMED`, held in
 * `opportunity-hookable-actions.test.ts`).
 *
 * Every other method runs a Command no module can hook, so the port still
 * refuses any key itself, before it reads anything — a transition runs its
 * guards and `.before` events before its Command reaches the bus
 * (`specs/186-aggregate-ports/` research R-21.5). **The first test keeps the
 * two lists in step**: declaring another action hookable fails it until the
 * method running that action forwards instead of refusing.
 */
function portWith(overrides: Partial<Record<keyof OpportunityCommandServiceDeps, unknown>> = {}) {
  const untouched = vi.fn(() => {
    throw new Error('a dependency was reached before the refusal');
  });
  const port = new OpportunityCommandService({
    emFactory: untouched,
    workflowRead: { loadGraph: untouched },
    opportunities: untouched,
    assignment: untouched,
    transitions: untouched,
    links: untouched,
    comments: untouched,
    records: { findById: async (id: string) => ({ id }) },
    ...overrides,
  } as unknown as OpportunityCommandServiceDeps);
  return { port, untouched };
}

describe('opportunityCommandPort — extensions on the hookable Commands (193 FR-111)', () => {
  it('the hookable actions are exactly the two the forwarding methods run', () => {
    expect((manifest.hookableActions ?? []).map((declaration) => declaration.action)).toEqual([
      OPPORTUNITY_HOOKABLE_ACTIONS.create.action,
      OPPORTUNITY_HOOKABLE_ACTIONS.update.action,
    ]);
  });

  it('create, update and setCustomFieldValues hand source and extensions to the service unread', async () => {
    const service = {
      create: vi.fn(async () => ID),
      update: vi.fn(async () => undefined),
      setCustomFieldValues: vi.fn(async () => undefined),
    };
    const { port } = portWith({ opportunities: () => service });
    const extensions = { nobody_claims_this: { anything: 1 } };

    await port.create({ title: 'T', organizationId: ORG, currency: 'PLN' }, { source: 'erp.sync', extensions });
    await port.update(ID, { title: 'T2' }, { extensions, expectedVersion: 3 });
    const merge = async (bag: Record<string, unknown>) => bag;
    await port.setCustomFieldValues(ID, merge, { extensions });

    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'T' }), {
      source: 'erp.sync',
      extensions,
    });
    expect(service.update).toHaveBeenCalledWith(ID, { title: 'T2' }, 3, { source: undefined, extensions });
    expect(service.setCustomFieldValues).toHaveBeenCalledWith(ID, merge, { source: undefined, extensions });
  });

  it('still refuses a malformed source on them before anything is read', async () => {
    const { port, untouched } = portWith();
    await expect(
      port.create({ title: 'T', organizationId: ORG, currency: 'PLN' }, { source: 'Not A Code', extensions: { x: {} } }),
    ).rejects.toMatchObject({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED });
    expect(untouched).not.toHaveBeenCalled();
  });
});

describe('opportunityCommandPort — the extensions pre-check on the other methods (R-21.5)', () => {
  const calls: ReadonlyArray<[string, (port: OpportunityCommandService) => Promise<unknown>]> = [
    ['transition', (port) => port.transition(ID, { to: 'qualified' }, { extensions: { nobody: {} } })],
    ['assign', (port) => port.assign(ID, { adminUserId: null }, { extensions: { nobody: {} } })],
    ['setTags', (port) => port.setTags(ID, { tagIds: [] }, { extensions: { nobody: {} } })],
    ['link', (port) => port.link(ID, { documentKind: 'order', documentId: ID } as never, { extensions: { nobody: {} } })],
    ['unlink', (port) => port.unlink(ID, ID, { extensions: { nobody: {} } })],
    ['addComment', (port) => port.addComment(ID, { body: 'x' } as never, { extensions: { nobody: {} } })],
    ['delete', (port) => port.delete(ID, { extensions: { nobody: {} } })],
  ];

  it.each(calls)('%s refuses a key with the bus’s code and details shape before any dependency is touched', async (_name, call) => {
    const { port, untouched } = portWith();
    await expect(call(port)).rejects.toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.COMMAND_EXTENSION_UNCLAIMED,
      details: [{ path: 'extensions.nobody', issue: expect.any(String) }],
    });
    expect(untouched).not.toHaveBeenCalled();
  });
});
