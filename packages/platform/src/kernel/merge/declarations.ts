import {
  mergeDispositionMoves,
  type MergeDeclarationWithModule,
  type MergeParticipationReference,
  type ModuleManifest,
  type RecordMergeHostType,
} from '@endora-commerce/contracts';

/**
 * The composed `merge` declarations, each with the module that wrote it
 * (`specs/192-organization-merge/`, `contracts/merge-mechanism.md` §1).
 *
 * Data derived from the manifest set by the composition root, never read from a
 * manifest by the registry itself — the same shape as `hookableActionsFrom`.
 */
export interface MergeHostOwnership {
  readonly moduleId: string;
  readonly type: RecordMergeHostType;
}

export interface MergeParticipationOwnership extends MergeDeclarationWithModule {
  readonly trailing: boolean;
  readonly batchSize: number | undefined;
  readonly references: readonly MergeParticipationReference[];
}

export interface MergeCompositionDeclarations {
  readonly hosts: readonly MergeHostOwnership[];
  readonly participations: readonly MergeParticipationOwnership[];
}

/** Every composed module's `merge.hosts` and `merge.participates`, with its owner. */
export function mergeDeclarationsFrom(manifests: readonly ModuleManifest[]): MergeCompositionDeclarations {
  const hosts: MergeHostOwnership[] = [];
  const participations: MergeParticipationOwnership[] = [];
  for (const manifest of manifests) {
    for (const host of manifest.merge?.hosts ?? []) hosts.push({ moduleId: manifest.id, type: host.type });
    for (const participation of manifest.merge?.participates ?? []) {
      participations.push({
        moduleId: manifest.id,
        host: participation.host,
        key: participation.key,
        phase: participation.phase,
        trailing: participation.trailing === true,
        batchSize: participation.batchSize,
        references: participation.references,
      });
    }
  }
  return { hosts, participations };
}

/** Does this participation move anything — i.e. does it have a step? (`kept` and plain `survivor_wins` write nothing.) */
export function participationMoves(participation: Pick<MergeParticipationOwnership, 'references'>): boolean {
  return participation.references.some((reference) => mergeDispositionMoves(reference.disposition));
}
