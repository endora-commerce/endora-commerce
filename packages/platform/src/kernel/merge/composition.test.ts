import { describe, expect, it, vi } from 'vitest';
import type {
  MergeHostImplementation,
  MergeParticipant,
  ModuleManifest,
} from '@endora-commerce/contracts';
import { mergeDeclarationsFrom } from './declarations.js';
import { RecordMergeRegistry, RecordMergeCompositionError } from './registry.js';
import { createModuleContext, createModuleRegistrationSink } from '../module-context.js';
import { createRootContainer } from '../container.js';
import { EventBus } from '../../events/bus.js';

/**
 * `specs/192-organization-merge/` T013, `contracts/merge-mechanism.md` §1 —
 * the composition refusals, raised when the registry is sealed (after the
 * last module registered, before any boot hook), each naming the module.
 */

const participant: MergeParticipant<'organization'> = {
  host: 'organization',
  preview: async () => ({ counts: {}, conflicts: [], warnings: [], refusals: [] }),
  applyBatch: async () => ({ moved: 0 }),
};
const host: MergeHostImplementation<'organization'> = {
  host: 'organization',
  preview: async () => ({ refusals: [], fields: [], customFields: [], counts: {}, warnings: [] }),
  applyStructureBatch: async () => ({ moved: 0 }),
  finalize: async () => {},
};

function manifest(id: string, merge: ModuleManifest['merge']): ModuleManifest {
  return { id, name: id, description: id, version: '1.0.0', dependencies: [], merge } as unknown as ModuleManifest;
}

const ORGS = manifest('organizations', { hosts: [{ type: 'organization' }] });
const ORDERS = manifest('orders', {
  participates: [
    {
      host: 'organization',
      key: 'orders',
      phase: 'records',
      references: [{ entity: 'Order', property: 'organizationId', disposition: 're_point' }],
    },
  ],
});
const AUDIT_KEPT = manifest('admin_users', {
  participates: [
    {
      host: 'organization',
      key: 'security-log',
      references: [{ entity: 'ImpersonationReason', property: 'organizationId', disposition: 'kept' }],
    },
  ],
});

function refusal(run: () => void): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a refusal');
}

describe('RecordMergeRegistry — composition', () => {
  it('seals a host and a participant that are declared and registered', () => {
    const registry = new RecordMergeRegistry();
    registry.registerHost('organizations', host);
    registry.registerParticipant('orders', 'organization', 'orders', participant);
    registry.seal({ declarations: mergeDeclarationsFrom([ORGS, ORDERS, AUDIT_KEPT]) });

    expect(registry.hostOf('organization')?.moduleId).toBe('organizations');
    expect(registry.participantsOf('organization').map((p) => `${p.moduleId}/${p.key}/${p.phase}`)).toEqual([
      'orders/orders/records',
    ]);
    // A kept-only participation has no step and needs no registration.
    expect(registry.declarationsOf('organization').map((d) => d.moduleId).sort()).toEqual(['admin_users', 'orders']);
  });

  it('refuses two modules declaring the same host type', () => {
    const registry = new RecordMergeRegistry();
    const error = refusal(() =>
      registry.seal({
        declarations: mergeDeclarationsFrom([ORGS, manifest('crm', { hosts: [{ type: 'organization' }] })]),
      }),
    );
    expect(error).toBeInstanceOf(RecordMergeCompositionError);
    expect(error.message).toMatch(/organizations.*crm|crm.*organizations/);
  });

  it('refuses a host implementation registered by a module that does not declare the host', () => {
    const registry = new RecordMergeRegistry();
    registry.registerHost('crm', host);
    const error = refusal(() => registry.seal({ declarations: mergeDeclarationsFrom([ORGS]) }));
    expect(error.message).toMatch(/crm/);
  });

  it('refuses a declared host with no implementation registered', () => {
    const registry = new RecordMergeRegistry();
    const error = refusal(() => registry.seal({ declarations: mergeDeclarationsFrom([ORGS]) }));
    expect(error.message).toMatch(/organizations.*ctx\.merge\.host/);
  });

  it('refuses a registration without a declaration', () => {
    const registry = new RecordMergeRegistry();
    registry.registerHost('organizations', host);
    registry.registerParticipant('carts', 'organization', 'carts', participant);
    const error = refusal(() => registry.seal({ declarations: mergeDeclarationsFrom([ORGS]) }));
    expect(error.message).toMatch(/carts.*carts.*declares no/);
  });

  it('refuses a declaration that moves records with no registration', () => {
    const registry = new RecordMergeRegistry();
    registry.registerHost('organizations', host);
    const error = refusal(() => registry.seal({ declarations: mergeDeclarationsFrom([ORGS, ORDERS]) }));
    expect(error.message).toMatch(/orders.*ctx\.merge\.participate/);
  });

  it('drops, with a warning, a participation whose host no composed module declares', () => {
    const warn = vi.fn();
    const registry = new RecordMergeRegistry({ warn });
    registry.registerParticipant('orders', 'organization', 'orders', participant);
    registry.seal({ declarations: mergeDeclarationsFrom([ORDERS]) });
    expect(registry.participantsOf('organization')).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('refuses a registration after sealing, and a second seal', () => {
    const registry = new RecordMergeRegistry();
    registry.registerHost('organizations', host);
    registry.seal({ declarations: mergeDeclarationsFrom([ORGS]) });
    expect(() => registry.registerParticipant('orders', 'organization', 'orders', participant)).toThrow(/sealed/);
    expect(() => registry.seal({ declarations: { hosts: [], participations: [] } })).toThrow(/already sealed/);
  });

  it('refuses a participant whose host type disagrees with its registration', () => {
    const registry = new RecordMergeRegistry();
    expect(() =>
      registry.registerParticipant('orders', 'project', 'orders', participant as unknown as MergeParticipant<'project'>),
    ).toThrow(/host/);
  });
});

describe('ctx.merge — the module context seam', () => {
  function context(moduleId: string, registry?: RecordMergeRegistry) {
    return createModuleContext({
      module: { id: moduleId, version: '1.0.0' },
      container: createRootContainer(),
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
      ...(registry ? { mergeRegistry: registry } : {}),
    });
  }

  it('stamps the module id on what it registers', () => {
    const registry = new RecordMergeRegistry();
    context('organizations', registry).merge.host('organization', host);
    context('orders', registry).merge.participate('organization', 'orders', participant);
    registry.seal({ declarations: mergeDeclarationsFrom([ORGS, ORDERS]) });
    expect(registry.hostOf('organization')?.moduleId).toBe('organizations');
    expect(registry.participantsOf('organization')[0]?.moduleId).toBe('orders');
  });

  it('is a no-op in a context built without a registry (a single module composed for a unit test)', () => {
    expect(() => context('orders').merge.participate('organization', 'orders', participant)).not.toThrow();
  });
});

describe('the host’s own structure participation', () => {
  const declared = (moduleId: string, phase = 'structure') =>
    manifest(moduleId, {
      ...(moduleId === 'organizations' ? { hosts: [{ type: 'organization' as const }] } : {}),
      participates: [
        {
          host: 'organization',
          key: 'host-structure',
          phase,
          references: [{ entity: 'OrganizationInvitation', property: 'organizationId', disposition: 're_point' }],
        },
      ],
    });

  it('is fulfilled by the host implementation, with no participant registered', () => {
    const registry = new RecordMergeRegistry();
    registry.registerHost('organizations', host);
    registry.seal({ declarations: mergeDeclarationsFrom([declared('organizations')]) });
    expect(registry.participantsOf('organization')).toEqual([]);
    expect(registry.declarationsOf('organization').map((d) => d.key)).toEqual(['host-structure']);
  });

  it('is refused under any other module, or outside the structure phase', () => {
    const registry = new RecordMergeRegistry();
    registry.registerHost('organizations', host);
    expect(() => registry.seal({ declarations: mergeDeclarationsFrom([ORGS, declared('carts')]) })).toThrow(/host module/);
    const second = new RecordMergeRegistry();
    second.registerHost('organizations', host);
    expect(() => second.seal({ declarations: mergeDeclarationsFrom([declared('organizations', 'records')]) })).toThrow(/structure phase/);
  });
});

describe('dispositions that write nothing', () => {
  it('needs no participant for a survivor-wins-only participation', () => {
    const registry = new RecordMergeRegistry();
    registry.registerHost('organizations', host);
    registry.seal({
      declarations: mergeDeclarationsFrom([
        ORGS,
        manifest('payment_methods', {
          participates: [
            {
              host: 'organization',
              key: 'allow-list',
              references: [{ entity: 'Link', property: 'organizationId', disposition: 'survivor_wins' }],
            },
          ],
        }),
      ]),
    });
    expect(registry.participantsOf('organization')).toEqual([]);
  });
});
