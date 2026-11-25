import { describe, expect, it } from 'vitest';
import {
  MERGE_DISPOSITIONS,
  ORGANIZATION_MERGE_PHASES,
  PROJECT_MERGE_PHASES,
  RECORD_MERGE_HOST_PHASES,
  RECORD_MERGE_HOST_TYPES,
  RECORD_MERGE_STATES,
  RECORD_MERGE_STEP_STATES,
  analyseMergeCoverage,
  isHostReferenceProperty,
  moduleMergeDeclarationSchema,
  recordMergePreviewSchema,
  recordMergeRecordSchema,
  recordMergeScopeReason,
  mergeIdOfScopeReason,
  type MergeParticipantPreview,
  type MergeStepInput,
} from './record-merge.js';

/** `specs/192-organization-merge/` T003 — the platform's merge vocabulary. */
describe('record-merge vocabulary', () => {
  it('names the two hosts and their ordered phases (R-11)', () => {
    expect(RECORD_MERGE_HOST_TYPES).toEqual(['organization', 'project']);
    expect(ORGANIZATION_MERGE_PHASES).toEqual([
      'structure',
      'configuration',
      'addresses',
      'members',
      'records',
      'finalize',
    ]);
    expect(PROJECT_MERGE_PHASES).toEqual(['structure', 'records', 'finalize']);
    expect(RECORD_MERGE_HOST_PHASES.organization).toBe(ORGANIZATION_MERGE_PHASES);
    expect(RECORD_MERGE_HOST_PHASES.project).toBe(PROJECT_MERGE_PHASES);
  });

  it('closes the merge and step states and the dispositions', () => {
    expect(RECORD_MERGE_STATES).toEqual(['running', 'needs_attention', 'completed', 'cancelled']);
    expect(RECORD_MERGE_STEP_STATES).toEqual(['pending', 'running', 'done', 'failed', 'deferred']);
    expect(MERGE_DISPOSITIONS).toEqual([
      're_point',
      'union',
      'survivor_wins',
      'survivor_wins_fill_gaps',
      'sum',
      'stricter',
      'kept',
    ]);
  });

  it('round-trips the merge scope reason', () => {
    const reason = recordMergeScopeReason('6f2b3c1e-1a2b-4c3d-8e4f-123456789abc');
    expect(reason).toBe('record-merge:6f2b3c1e-1a2b-4c3d-8e4f-123456789abc');
    expect(mergeIdOfScopeReason(reason)).toBe('6f2b3c1e-1a2b-4c3d-8e4f-123456789abc');
    expect(mergeIdOfScopeReason('boot: something')).toBeNull();
    expect(mergeIdOfScopeReason(undefined)).toBeNull();
  });

  it('types the participant step input and preview', () => {
    const input: MergeStepInput = {
      mergeId: 'm',
      hostType: 'organization',
      survivorId: 's',
      loserId: 'l',
      hostContext: {},
      batchSize: 500,
    };
    const preview: MergeParticipantPreview = { counts: { 'Order.organizationId': 3 }, conflicts: [], warnings: [], refusals: [] };
    expect(input.batchSize).toBe(500);
    expect(preview.counts['Order.organizationId']).toBe(3);
  });
});

describe('moduleMergeDeclarationSchema (manifest `merge`)', () => {
  it('accepts a host and a participation', () => {
    const parsed = moduleMergeDeclarationSchema.parse({
      hosts: [{ type: 'organization' }],
      participates: [
        {
          host: 'organization',
          key: 'organization-records',
          phase: 'records',
          references: [
            { entity: 'Order', property: 'organizationId', disposition: 're_point' },
            {
              entity: 'PriceDisplayModeOverride',
              property: 'scopeId',
              polymorphic: { discriminator: 'scope', value: 'organization' },
              disposition: 'survivor_wins_fill_gaps',
            },
          ],
        },
      ],
    });
    expect(parsed.participates?.[0]?.references).toHaveLength(2);
  });

  it('refuses a participation in the finalize phase, a phase the host does not have, and a bad key', () => {
    const base = { host: 'organization', key: 'k', references: [{ entity: 'A', property: 'organizationId', disposition: 'kept' }] };
    expect(() => moduleMergeDeclarationSchema.parse({ participates: [{ ...base, phase: 'finalize' }] })).toThrow(/finalize/);
    expect(() => moduleMergeDeclarationSchema.parse({ participates: [{ ...base, phase: 'nowhere' }] })).toThrow(/phase/);
    expect(() =>
      moduleMergeDeclarationSchema.parse({ participates: [{ ...base, phase: 'records', key: 'Not Kebab' }] }),
    ).toThrow();
    expect(() =>
      moduleMergeDeclarationSchema.parse({
        participates: [
          { ...base, phase: 'records' },
          { ...base, phase: 'records' },
        ],
      }),
    ).toThrow(/twice/);
  });

  it('allows a kept-only declaration with no phase', () => {
    const parsed = moduleMergeDeclarationSchema.parse({
      participates: [
        {
          host: 'organization',
          key: 'security-log',
          references: [{ entity: 'ImpersonationReason', property: 'organizationId', disposition: 'kept' }],
        },
      ],
    });
    expect(parsed.participates?.[0]?.phase).toBeUndefined();
  });

  it('refuses a phased participation that moves nothing and a phase-less one that does', () => {
    expect(() =>
      moduleMergeDeclarationSchema.parse({
        participates: [
          {
            host: 'organization',
            key: 'x',
            references: [{ entity: 'A', property: 'organizationId', disposition: 're_point' }],
          },
        ],
      }),
    ).toThrow(/phase/);
  });
});

describe('preview and record shapes', () => {
  it('parses a preview', () => {
    const preview = recordMergePreviewSchema.parse({
      refusals: [{ code: 'RECORD_MERGE_PARTICIPATION_INCOMPLETE', details: { modules: ['orders'] } }],
      fields: [{ code: 'name', survivor: 'A', loser: 'B', default: 'survivor' }],
      customFields: [],
      participants: [
        { moduleId: 'orders', key: 'orders', phase: 'records', counts: { 'Order.organizationId': 2 }, conflicts: [], warnings: [] },
      ],
      incomplete: ['orders'],
    });
    expect(preview.incomplete).toEqual(['orders']);
  });

  it('parses a record with its steps', () => {
    const record = recordMergeRecordSchema.parse({
      id: '6f2b3c1e-1a2b-4c3d-8e4f-123456789abc',
      hostType: 'organization',
      survivorId: '6f2b3c1e-1a2b-4c3d-8e4f-123456789abd',
      loserId: '6f2b3c1e-1a2b-4c3d-8e4f-123456789abe',
      state: 'running',
      version: 1,
      source: null,
      actorKind: 'admin',
      actorAdminUserId: null,
      startedAt: '2026-11-25T10:00:00.000Z',
      completedAt: null,
      cancelledAt: null,
      needsAttentionAt: null,
      lastErrorCode: null,
      fieldChoices: { name: 'loser' },
      customFieldChoices: {},
      steps: [
        {
          moduleId: 'organizations',
          key: 'structure',
          phase: 'structure',
          state: 'pending',
          movedCount: 0,
          deferredReason: null,
          lastErrorCode: null,
          trailing: false,
        },
      ],
    });
    expect(record.steps[0]?.state).toBe('pending');
  });
});

describe('isHostReferenceProperty — the population rule (merge-participation-check §1)', () => {
  it.each([
    ['organizationId', 'orders', true],
    ['payerOrganizationId', 'orders', true],
    ['allowedOrganizationIds', 'catalog', true],
    ['organizationIds', 'x', true],
    ['organization', 'x', false],
    ['organizationRoleId', 'customer_accounts', false],
    ['parentId', 'organizations', false],
  ] as const)('organization: %s in %s → %s', (property, moduleId, expected) => {
    expect(isHostReferenceProperty('organization', moduleId, property)).toBe(expected);
  });

  it.each([
    ['projectId', 'tasks', true],
    ['sourceProjectId', 'crm', true],
    ['projectId', 'projects', false],
    ['projectIds', 'tasks', false],
  ] as const)('project: %s in %s → %s', (property, moduleId, expected) => {
    expect(isHostReferenceProperty('project', moduleId, property)).toBe(expected);
  });
});

describe('analyseMergeCoverage — one analysis, two hosts (R-9)', () => {
  const population = [
    { moduleId: 'orders', entity: 'Order', properties: ['id', 'organizationId', 'payerOrganizationId', 'scope'] },
    { moduleId: 'admin_users', entity: 'ImpersonationReason', properties: ['organizationId'] },
  ];

  it('reports every uncovered reference per module', () => {
    const result = analyseMergeCoverage({ population, declarations: [] });
    expect(result.findings.map((f) => `${f.kind}:${f.moduleId}:${f.entity}.${f.property}`)).toEqual([
      'undeclared-reference:admin_users:ImpersonationReason.organizationId',
      'undeclared-reference:orders:Order.organizationId',
      'undeclared-reference:orders:Order.payerOrganizationId',
    ]);
    expect(result.uncoveredModules).toEqual(['admin_users', 'orders']);
  });

  it('is clean when every reference is declared by its own module', () => {
    const result = analyseMergeCoverage({
      population,
      declarations: [
        {
          moduleId: 'orders',
          host: 'organization',
          key: 'orders',
          phase: 'records',
          references: [
            { entity: 'Order', property: 'organizationId', disposition: 're_point' },
            { entity: 'Order', property: 'payerOrganizationId', disposition: 're_point' },
          ],
        },
        {
          moduleId: 'admin_users',
          host: 'organization',
          key: 'security-log',
          references: [{ entity: 'ImpersonationReason', property: 'organizationId', disposition: 'kept' }],
        },
      ],
    });
    expect(result.findings).toEqual([]);
    expect(result.uncoveredModules).toEqual([]);
  });

  it('reports a missing property, a foreign declaration, a double coverage and a polymorphic discriminator that is not there', () => {
    const result = analyseMergeCoverage({
      population,
      declarations: [
        {
          moduleId: 'orders',
          host: 'organization',
          key: 'a',
          phase: 'records',
          references: [
            { entity: 'Order', property: 'organizationId', disposition: 're_point' },
            { entity: 'Order', property: 'ghostOrganizationId', disposition: 're_point' },
            { entity: 'Order', property: 'id', polymorphic: { discriminator: 'kind', value: 'organization' }, disposition: 're_point' },
          ],
        },
        {
          moduleId: 'orders',
          host: 'organization',
          key: 'b',
          phase: 'records',
          references: [
            { entity: 'Order', property: 'organizationId', disposition: 're_point' },
            { entity: 'ImpersonationReason', property: 'organizationId', disposition: 'kept' },
          ],
        },
      ],
    });
    const kinds = result.findings.map((f) => `${f.kind}:${f.entity}.${f.property}`);
    expect(kinds).toContain('declared-missing-property:Order.ghostOrganizationId');
    expect(kinds).toContain('declared-missing-property:Order.kind');
    expect(kinds).toContain('double-coverage:Order.organizationId');
    expect(kinds).toContain('foreign-declaration:ImpersonationReason.organizationId');
    expect(kinds).toContain('undeclared-reference:Order.payerOrganizationId');
  });

  it('lets a pending ledger cover a reference and reports a stale pending entry', () => {
    const result = analyseMergeCoverage({
      population,
      declarations: [
        {
          moduleId: 'admin_users',
          host: 'organization',
          key: 'security-log',
          references: [{ entity: 'ImpersonationReason', property: 'organizationId', disposition: 'kept' }],
        },
      ],
      pending: [
        { moduleId: 'orders', entity: 'Order', property: 'organizationId' },
        { moduleId: 'orders', entity: 'Order', property: 'payerOrganizationId' },
        { moduleId: 'admin_users', entity: 'ImpersonationReason', property: 'organizationId' },
        { moduleId: 'orders', entity: 'Gone', property: 'organizationId' },
      ],
    });
    expect(result.findings.map((f) => `${f.kind}:${f.entity}.${f.property}`).sort()).toEqual([
      'stale-pending:Gone.organizationId',
      'stale-pending:ImpersonationReason.organizationId',
    ]);
    expect(result.uncoveredModules).toEqual(['orders']);
  });
});
