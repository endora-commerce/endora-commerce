import { describe, expect, it } from 'vitest';
import {
  defineModuleManifest,
  missingPermissionRequirements,
  type ModuleManifest,
} from '@endora-commerce/contracts';
import {
  findPermissionDependencyDefects,
  permissionDependencyReadSize,
  permissionDependencyRefusal,
  type PermissionDependencyInput,
} from '../../helpers/permission-dependencies.js';
import { readSizeRefusal } from '../../../scripts/lib/read-size.js';
import { PermissionCatalogueService } from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';

/**
 * D-175 / feature 080 T057 — `requires`, red-first.
 *
 * One proof per finding the sweep can reach, plus the operator-facing
 * derivation the panel renders and the refusals that stop a green meaning "not
 * looking" (issue #113). Every fixture enters where a real run enters: manifests
 * in, through a **real** `PermissionCatalogueService`, findings out. Handing the
 * classifier a pre-built requirement map would prove the last function in the
 * chain and leave the merge — where a shared code's declarers are unioned, and
 * where the defect would actually live — unexercised (issue #130).
 */

function manifest(
  id: string,
  extra: Partial<Parameters<typeof defineModuleManifest>[0]> = {},
): { manifest: ModuleManifest } {
  return {
    manifest: defineModuleManifest({
      id,
      name: id,
      version: '1.0.0',
      dependencies: [],
      activation: { settingCode: `${id}.enabled`, default: true },
      ...extra,
    }),
  };
}

/** Manifests in; the requirement map and the vocabulary from the real merge. */
function input(manifests: ReadonlyArray<{ manifest: ModuleManifest }>): PermissionDependencyInput {
  const service = new PermissionCatalogueService({ registryEntries: manifests });
  return {
    requirements: service.listRequirementsByCode(),
    known: new Set(service.listKnownCodes()),
    owners: service.listOwnersByCode(),
  };
}

describe('permission dependencies — the shapes it refuses', () => {
  /**
   * The centre: a requirement naming a code nothing declares. Left unchecked it
   * advises an operator to grant something that does not exist, forever and
   * silently — the failure mode of every declaration added without a ratchet.
   */
  it('reports a requirement on a code the platform does not know', () => {
    const found = findPermissionDependencyDefects(
      input([
        manifest('quote_requests', {
          permissions: [
            { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:raed'] },
          ],
        }),
      ]),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('unknown-requirement');
    expect(found[0]?.requirement).toBe('price_lists:raed');
    expect(found[0]?.owners).toEqual(['quote_requests']);
  });

  /** A code requiring itself is satisfied by holding it, so it advises nothing. */
  it('reports a code that requires itself', () => {
    const found = findPermissionDependencyDefects(
      input([
        manifest('blog', {
          permissions: [{ code: 'blog.write', label: 'Author', requires: ['blog.write'] }],
        }),
      ]),
    );
    expect(found.map((f) => f.kind)).toEqual(['self-requirement']);
  });

  /**
   * The signal that was written and removed: a declaration naming one code
   * twice reaches this sweep de-duplicated, because the merge unions into a
   * `Set`. Kept as an assertion rather than deleted with the kind, so the next
   * author who reaches for `duplicate-requirement` finds out here why it is not
   * there instead of adding a signal that cannot fire.
   */
  it('cannot see a duplicate requirement, because the merge unions', () => {
    const built = input([
      manifest('blog', {
        permissions: [
          { code: 'blog.read', label: 'View' },
          { code: 'blog.write', label: 'Author', requires: ['blog.read', 'blog.read'] },
        ],
      }),
    ]);
    expect(built.requirements.get('blog.write')).toEqual(['blog.read']);
    expect(findPermissionDependencyDefects(built)).toEqual([]);
  });

  /**
   * The vocabulary, not the grantable set: a requirement on a switched-off
   * module's code is exactly when an operator most needs the sentence, so it is
   * not a finding. Proven through presence rather than asserted — the service is
   * told `price_lists` is absent and the sweep still passes.
   */
  it('does not report a requirement whose owner is switched off', () => {
    const manifests = [
      manifest('quote_requests', {
        permissions: [
          { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
        ],
      }),
      manifest('price_lists', {
        permissions: [{ code: 'price_lists:read', label: 'View pricing' }],
      }),
    ];
    const service = new PermissionCatalogueService({
      registryEntries: manifests,
      isModulePresent: (id) => id !== 'price_lists',
    });
    expect(service.listAssignableCodes()).not.toContain('price_lists:read');
    expect(
      findPermissionDependencyDefects({
        requirements: service.listRequirementsByCode(),
        known: new Set(service.listKnownCodes()),
        owners: service.listOwnersByCode(),
      }),
    ).toEqual([]);
  });

  /**
   * A shared code's declarers are unioned, and this is the case a per-declarer
   * map would lose: `integrations:manage` opens two surfaces and each may need
   * something the other does not.
   */
  it('unions the requirements of every declarer of a shared code', () => {
    const requirements = input([
      manifest('api_keys', {
        permissions: [
          { code: 'integrations:manage', label: 'Manage', requires: ['audit_log:read'] },
        ],
      }),
      manifest('webhooks', {
        permissions: [
          { code: 'integrations:manage', label: 'Manage', requires: ['customers:read'] },
        ],
      }),
      manifest('audit_logs', { permissions: [{ code: 'audit_log:read', label: 'Audit' }] }),
      manifest('customers', { permissions: [{ code: 'customers:read', label: 'Customers' }] }),
    ]).requirements;
    expect(requirements.get('integrations:manage')).toEqual(['audit_log:read', 'customers:read']);
  });
});

/**
 * The operator-facing derivation is `@endora-commerce/contracts`', so that the
 * role editor and this suite read one function rather than two — D-175's second
 * caution. It is exercised here over rows a real merge produced.
 */
describe('permission dependencies — what an operator is advised', () => {
  const rows = ([
    manifest('quote_requests', {
      permissions: [
        { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
      ],
    }),
    manifest('price_lists', {
      permissions: [{ code: 'price_lists:read', label: 'View pricing' }],
    }),
  ] as const);
  const catalogue = new PermissionCatalogueService({ registryEntries: rows }).listAssignable();

  it('names the code a role is missing', () => {
    expect(missingPermissionRequirements(['rfqs:handle'], catalogue)).toEqual([
      'price_lists:read',
    ]);
  });

  it('advises nothing once the role holds it', () => {
    expect(
      missingPermissionRequirements(['rfqs:handle', 'price_lists:read'], catalogue),
    ).toEqual([]);
  });

  /** A wildcard role holds everything; advising it to add a code is noise. */
  it('advises nothing to a wildcard role', () => {
    expect(missingPermissionRequirements(['*'], catalogue)).toEqual([]);
  });

  /**
   * A requirement with no row is skipped: for the role editor that is a code
   * with no checkbox — offering an operator one they cannot tick is the single
   * thing the panel must not do — and the author hears about it from
   * `unknown-requirement` instead.
   */
  it('does not advise a code the catalogue does not offer', () => {
    const broken = new PermissionCatalogueService({
      registryEntries: [
        manifest('quote_requests', {
          permissions: [{ code: 'rfqs:handle', label: 'Handle', requires: ['gone:code'] }],
        }),
      ],
    }).listAssignable();
    expect(missingPermissionRequirements(['rfqs:handle'], broken)).toEqual([]);
  });

  /**
   * The presence filter reaches the advisory: an absent owner's code has no
   * checkbox, so the panel stops advising it rather than pointing at a row that
   * is not on the screen.
   */
  it('stops advising a code whose owner is switched off', () => {
    const filtered = new PermissionCatalogueService({
      registryEntries: rows,
      isModulePresent: (id) => id !== 'price_lists',
    }).listAssignable();
    expect(missingPermissionRequirements(['rfqs:handle'], filtered)).toEqual([]);
  });
});

describe('permission dependencies — what it refuses to answer', () => {
  const built = input([
    manifest('quote_requests', {
      permissions: [
        { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
      ],
    }),
    manifest('price_lists', {
      permissions: [{ code: 'price_lists:read', label: 'View pricing' }],
    }),
  ]);

  it('answers nothing when there is nothing to answer about', () => {
    expect(permissionDependencyRefusal({ ...built, known: new Set() })).toMatch(/knows no/);
    expect(permissionDependencyRefusal({ ...built, owners: new Map() })).toMatch(/has an owner/);
    // The clause a careless implementation omits: a sweep whose subject is
    // declarations reports a cheerful zero when the merge stopped reading them.
    expect(permissionDependencyRefusal({ ...built, requirements: new Map() })).toMatch(
      /declares a requirement/,
    );
  });

  it('answers when it has read enough', () => {
    expect(permissionDependencyRefusal(built)).toBeNull();
  });

  it('refuses a read size whose merge came back short of the index', () => {
    expect(
      readSizeRefusal(
        permissionDependencyReadSize({
          declaringManifests: 49,
          mergedManifests: 12,
          requirements: 1,
        }),
      )?.kind,
    ).toBe('short-walk');
    expect(
      readSizeRefusal(
        permissionDependencyReadSize({ declaringManifests: 0, mergedManifests: 0, requirements: 0 }),
      )?.kind,
    ).toBe('read-nothing');
    expect(
      readSizeRefusal(
        permissionDependencyReadSize({
          declaringManifests: 49,
          mergedManifests: 49,
          requirements: 1,
        }),
      ),
    ).toBeNull();
  });
});
