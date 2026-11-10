import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type { ProjectViewer } from '../domain/visibility-rule.js';
import type { SqlFragment } from './project-access.js';
import {
  projectAttachmentReferenceDescriptor,
  type ProjectAssetRestrictionDeps,
} from './project-asset-references.js';

// `specs/166-asset-reference-visibility/` contracts/ports.md §1.1 (Projects) —
// the restriction's wiring. The SQL complement property over seeded rows is
// `backend/test/integration/projects/asset-reference-restriction.test.ts`
// (tasks.md T001 (f)).

const ASSET = '00000000-0000-4000-8000-0000000000a1';
const PROJECT = '00000000-0000-4000-8000-0000000000e1';

interface Statement {
  sql: string;
  params: unknown[];
}

function fakeEm(answer: () => unknown[]): { emFactory: () => EntityManager; statements: Statement[] } {
  const statements: Statement[] = [];
  const em = {
    async execute(sql: string, params: unknown[] = []) {
      statements.push({ sql, params });
      return answer();
    },
  };
  return { emFactory: () => em as unknown as EntityManager, statements };
}

function restrictionDeps(options: { canRead?: boolean; predicate?: SqlFragment | null; visible?: string[] } = {}) {
  let resolved = 0;
  const viewer: ProjectViewer = {
    adminUserId: '00000000-0000-4000-8000-00000000000b',
    canRead: options.canRead ?? true,
    seeAll: false,
    reach: { all: true, constraint: { kind: 'all' }, inScope: () => true },
  };
  const deps: ProjectAssetRestrictionDeps = {
    access: () => {
      resolved += 1;
      return {
        async visibleIds(ids: readonly string[]) {
          return new Set(viewer.canRead ? ids.filter((id) => (options.visible ?? []).includes(id)) : []);
        },
        async currentViewer() {
          return viewer;
        },
        async visibleProjectSql() {
          if (!viewer.canRead) return { sql: 'false', params: [] };
          return options.predicate === undefined ? { sql: 'p."visibility" = ?', params: ['everyone'] } : options.predicate;
        },
      };
    },
  };
  return { deps, resolved: () => resolved };
}

describe('the Projects asset-reference descriptor (feature 166)', () => {
  it('tags every hit with the asset it points at, in one statement', async () => {
    const { emFactory, statements } = fakeEm(() => [{ id: PROJECT, number: 'P-1', asset_id: ASSET }]);
    const descriptor = projectAttachmentReferenceDescriptor(emFactory, restrictionDeps().deps);

    expect(await descriptor.findReferences([ASSET])).toEqual([
      { kind: 'project_attachment', entityId: PROJECT, label: 'Project P-1', assetId: ASSET },
    ]);
    expect(statements).toHaveLength(1);
  });

  it('declares a reader restriction and resolves ProjectAccess per call, never at construction', async () => {
    const { emFactory } = fakeEm(() => []);
    const { deps, resolved } = restrictionDeps({ visible: [PROJECT] });
    const descriptor = projectAttachmentReferenceDescriptor(emFactory, deps);
    expect(descriptor.readerRestriction).toBeDefined();
    expect(resolved()).toBe(0);
    expect([...(await descriptor.readerRestriction!.visibleEntityIds([PROJECT]))]).toEqual([PROJECT]);
    expect(resolved()).toBeGreaterThan(0);
  });

  it('without projects:read, sees no Project and reports every referenced asset as hidden', async () => {
    const { emFactory, statements } = fakeEm(() => [{ asset_id: ASSET }]);
    const descriptor = projectAttachmentReferenceDescriptor(emFactory, restrictionDeps({ canRead: false, visible: [PROJECT] }).deps);

    expect([...(await descriptor.readerRestriction!.visibleEntityIds([PROJECT]))]).toEqual([]);
    expect(await descriptor.readerRestriction!.assetIdsWithHiddenReferences()).toEqual([ASSET]);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).not.toMatch(/is not true/);
  });

  it('hides nothing when the predicate is null (an unrestricted reader)', async () => {
    const { emFactory, statements } = fakeEm(() => [{ asset_id: ASSET }]);
    const descriptor = projectAttachmentReferenceDescriptor(emFactory, restrictionDeps({ predicate: null }).deps);
    expect(await descriptor.readerRestriction!.assetIdsWithHiddenReferences()).toEqual([]);
    expect(statements).toEqual([]);
  });

  it('writes the hidden set as the NULL-safe complement of the predicate', async () => {
    const { emFactory, statements } = fakeEm(() => [{ asset_id: ASSET }]);
    const descriptor = projectAttachmentReferenceDescriptor(emFactory, restrictionDeps().deps);
    expect(await descriptor.readerRestriction!.assetIdsWithHiddenReferences()).toEqual([ASSET]);
    expect(statements[0]!.sql).toContain('(p."visibility" = ?) is not true');
    expect(statements[0]!.params).toEqual(['everyone']);
  });

  it('lists every attached asset for allReferencedAssetIds without asking ProjectAccess', async () => {
    const { emFactory, statements } = fakeEm(() => [{ asset_id: ASSET }]);
    const { deps, resolved } = restrictionDeps();
    const descriptor = projectAttachmentReferenceDescriptor(emFactory, deps);
    expect(await descriptor.readerRestriction!.allReferencedAssetIds()).toEqual([ASSET]);
    expect(statements[0]!.sql).toMatch(/from "project_attachments"/);
    expect(resolved()).toBe(0);
  });
});
