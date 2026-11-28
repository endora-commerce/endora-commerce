import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  analyseMergeCoverage,
  type MergeCoverageResult,
  type MergePopulationEntity,
} from '@endora-commerce/contracts';
import type { MergeParticipationOwnership } from './declarations.js';

/**
 * The runtime twin of `check:merge-participation`
 * (`specs/192-organization-merge/` research R-9,
 * `contracts/merge-participation-check.md` §4).
 *
 * The same analysis the static check runs (`analyseMergeCoverage`, in
 * `@endora-commerce/contracts`), over a population derived from the ORM's
 * metadata rather than from source: so an installed package the static check
 * never read is held to the same rule. It does **not** read the pending
 * ledger — a reference the ledger lets stand still refuses a merge start, which
 * is what makes delivering participants one at a time safe (plan § *What ships
 * usefully before every port exists*).
 */

/** The platform's own references to a host, declared here because the kernel has no manifest. */
export const KERNEL_MERGE_PARTICIPATIONS: readonly MergeParticipationOwnership[] = [
  {
    moduleId: 'core',
    host: 'organization',
    key: 'kernel-logs',
    phase: undefined,
    trailing: false,
    batchSize: undefined,
    references: [
      // The command outbox: `organization_id` routes an already committed
      // Command's afterCommit delivery; the delivery log is history.
      { entity: 'CommandOutboxEntry', property: 'organizationId', disposition: 'kept' },
      // The audit log is never rewritten (FR-063): entries recorded against the
      // loser stay against it and are reached from the survivor's history
      // through the merge.
      {
        entity: 'AuditLogEntry',
        property: 'objectId',
        polymorphic: { discriminator: 'objectType', value: 'organization' },
        disposition: 'kept',
      },
    ],
  },
];

/** What the twin reads of one ORM entity's metadata. */
export interface EntityMetadataLike {
  readonly className: string;
  readonly properties: Readonly<Record<string, unknown>>;
  /** Where the class was declared, when the ORM recorded it. */
  readonly path?: string | undefined;
}

/** The persisted entity classes, each attributed to its module; an unattributable one is left out. */
export function populationFromMetadata(
  metadata: Iterable<EntityMetadataLike>,
  ownerOf: (className: string, path: string | undefined) => string | undefined,
): MergePopulationEntity[] {
  const population: MergePopulationEntity[] = [];
  for (const meta of metadata) {
    const moduleId = ownerOf(meta.className, meta.path);
    if (moduleId === undefined) continue;
    population.push({ moduleId, entity: meta.className, properties: Object.keys(meta.properties) });
  }
  return population;
}

export function runtimeMergeCoverage(input: {
  readonly population: readonly MergePopulationEntity[];
  readonly declarations: readonly MergeParticipationOwnership[];
}): MergeCoverageResult {
  return analyseMergeCoverage({
    population: input.population,
    declarations: [...input.declarations, ...KERNEL_MERGE_PARTICIPATIONS],
  });
}

/** The modules a merge start is refused for: holding an undeclared reference, and effectively present. */
export function incompleteModules(result: MergeCoverageResult, isPresent: (moduleId: string) => boolean): string[] {
  return result.uncoveredModules.filter((moduleId) => moduleId === 'core' || isPresent(moduleId));
}

const owners = new Map<string, string | undefined>();

/**
 * The module an entity file belongs to: the nearest `package.json` above it
 * that declares `endora.type: 'module'` (its `endora.id`) or
 * `endora.type: 'platform'` (`core`). The same declaration every generator
 * discovers a package by; nothing here knows a path layout.
 */
export function entityOwnerFromPath(path: string | undefined): string | undefined {
  if (path === undefined || path.length === 0) return undefined;
  let dir = dirname(path.replace(/^file:\/\//, ''));
  const visited: string[] = [];
  for (;;) {
    if (owners.has(dir)) {
      const known = owners.get(dir);
      for (const seen of visited) owners.set(seen, known);
      return known;
    }
    visited.push(dir);
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      let owner: string | undefined;
      try {
        const endora = (JSON.parse(readFileSync(manifest, 'utf8')) as { endora?: { type?: unknown; id?: unknown } }).endora;
        if (endora?.type === 'platform') owner = 'core';
        else if (endora?.type === 'module' && typeof endora.id === 'string') owner = endora.id;
      } catch {
        owner = undefined;
      }
      if (owner !== undefined) {
        for (const seen of visited) owners.set(seen, owner);
        return owner;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      for (const seen of visited) owners.set(seen, undefined);
      return undefined;
    }
    dir = parent;
  }
}
