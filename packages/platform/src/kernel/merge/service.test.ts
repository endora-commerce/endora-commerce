import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { MergeHostImplementation, MergeParticipant, ModuleManifest } from '@endora-commerce/contracts';
import { mergeDeclarationsFrom } from './declarations.js';
import { RecordMergeRegistry } from './registry.js';
import { PlatformRecordMergeService } from './service.js';

/**
 * `specs/192-organization-merge/` FR-002, FR-026, FR-070, R-9 — the aggregated
 * preview: the host's answer, every present participant's, an unresolvable
 * conflict as a refusal naming the participant, a participant whose module is
 * off neither called nor shown, and the completeness twin's modules.
 */

function manifest(id: string, merge: ModuleManifest['merge']): ModuleManifest {
  return { id, name: id, description: id, version: '1.0.0', dependencies: [], merge } as unknown as ModuleManifest;
}

const host: MergeHostImplementation<'organization'> = {
  host: 'organization',
  preview: async () => ({
    refusals: [],
    fields: [{ code: 'name', survivor: 'A', loser: 'B', default: 'survivor' }],
    customFields: [],
    counts: { 'OrganizationInvitation.organizationId': 1 },
    warnings: [],
  }),
  applyStructureBatch: async () => ({ moved: 0 }),
  finalize: async () => {},
};

function service(options: { present: Set<string>; called: string[] }) {
  const participant = (moduleId: string, conflict?: { code: string; resolution: string }): MergeParticipant<'organization'> => ({
    host: 'organization',
    preview: async () => {
      options.called.push(moduleId);
      return {
        counts: { [`${moduleId}.organizationId`]: 2 },
        conflicts: conflict ? [conflict] : [],
        warnings: [],
        refusals: [],
      };
    },
    applyBatch: async () => ({ moved: 0 }),
  });
  const declared = (moduleId: string) =>
    manifest(moduleId, {
      participates: [
        {
          host: 'organization',
          key: moduleId,
          phase: 'records',
          references: [{ entity: 'X', property: 'organizationId', disposition: 're_point' }],
        },
      ],
    });
  const registry = new RecordMergeRegistry();
  registry.registerHost('organizations', host);
  registry.registerParticipant('orders', 'organization', 'orders', participant('orders', { code: 'external-reference-clash', resolution: 'unresolvable' }));
  registry.registerParticipant('carts', 'organization', 'carts', participant('carts', { code: 'buying-for-self', resolution: 'cleared' }));
  registry.registerParticipant('crm', 'organization', 'crm', participant('crm'));
  registry.seal({
    declarations: mergeDeclarationsFrom([
      manifest('organizations', { hosts: [{ type: 'organization' }] }),
      declared('orders'),
      declared('carts'),
      declared('crm'),
    ]),
  });
  const em = { fork: () => em, findOne: async () => null } as unknown as EntityManager;
  return new PlatformRecordMergeService({
    emFactory: () => em,
    registry,
    isPresent: (moduleId) => options.present.has(moduleId),
    coverage: () => ({
      findings: [
        { kind: 'undeclared-reference', moduleId: 'invoices', entity: 'Invoice', property: 'organizationId', host: 'organization', message: '' },
        { kind: 'undeclared-reference', moduleId: 'returns', entity: 'ReturnCase', property: 'organizationId', host: 'organization', message: '' },
      ],
      uncoveredModules: ['invoices', 'returns'],
      sites: 2,
    }),
    enqueue: async () => {},
    publishChanged: async () => {},
  });
}

describe('PlatformRecordMergeService.preview', () => {
  it('aggregates the host and the present participants, and refuses on an unresolvable conflict naming the participant', async () => {
    const called: string[] = [];
    const preview = await service({ present: new Set(['organizations', 'orders', 'carts', 'crm', 'invoices']), called }).preview(
      'organization',
      '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000e2',
    );
    expect(preview.fields.map((f) => f.code)).toEqual(['name']);
    expect(preview.participants.map((p) => p.moduleId)).toEqual(['organizations', 'carts', 'crm', 'orders']);
    expect(preview.refusals).toEqual([
      { code: 'RECORD_MERGE_PARTICIPANT_CONFLICT', details: { module: 'orders', conflict: 'external-reference-clash' } },
      { code: 'RECORD_MERGE_PARTICIPATION_INCOMPLETE', details: { modules: ['invoices'] } },
    ]);
    expect(preview.incomplete).toEqual(['invoices']);
  });

  it('neither calls nor shows a participant whose module is off (FR-070)', async () => {
    const called: string[] = [];
    const preview = await service({ present: new Set(['organizations', 'carts']), called }).preview(
      'organization',
      '00000000-0000-4000-8000-0000000000e1',
      '00000000-0000-4000-8000-0000000000e2',
    );
    expect(called).toEqual(['carts']);
    expect(preview.participants.map((p) => p.moduleId)).toEqual(['organizations', 'carts']);
    expect(preview.incomplete).toEqual([]);
    expect(preview.refusals).toEqual([]);
  });
});
