import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomFieldValuePort,
  HostMergePreview,
  MergeHostImplementation,
  MergeParticipant,
  MergeParticipantPreview,
  MergePreviewInput,
  MergeStepInput,
  RecordMergeStateChange,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';
import { makeProjectMergeFinalizeCommand } from '../commands/project-merge-finalize.command.js';
import { makeProjectMergeReassignCommand, projectRecordCounts } from '../commands/project-merge-reassign.command.js';
import { makeProjectMergeStructureCommand, projectStructureCounts } from '../commands/project-merge-structure.command.js';
import { Project } from '../entities/project.entity.js';
import type { ProjectMergeNotifier } from './project-merge-notifier.js';
import { customFieldDifferences, fieldDifferences, projectMergeRefusals } from './project-merge-rules.js';

/**
 * `projects` as the host of the `project` record type
 * (`specs/192-organization-merge/` US6, `contracts/merge-mechanism.md` §2,
 * `contracts/project-merge.md` §2): what the platform's runner calls for the
 * host's own phases, registered with `ctx.merge.host('project', …)`.
 *
 * It names no participant (Principle I): `tasks` moves its Tasks and their
 * references, `crm` its Opportunities' references, each in its own Command.
 */
export interface ProjectMergeHostDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
  readonly recordMerge: () => RecordMergeService;
  readonly customFieldValues?: () => CustomFieldValuePort;
  /** The bell entries on `needs_attention` and on completion (`contracts/events-and-webhooks.md` §3). */
  readonly notifier?: () => ProjectMergeNotifier;
}

export class ProjectMergeHost implements MergeHostImplementation<'project'> {
  readonly host = 'project' as const;

  constructor(private readonly deps: ProjectMergeHostDeps) {}

  async preview(input: { readonly survivorId: string; readonly loserId: string }): Promise<HostMergePreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const [survivor, loser] = await Promise.all([
      em.findOne(Project, { id: input.survivorId }),
      em.findOne(Project, { id: input.loserId }),
    ]);
    const refusals = projectMergeRefusals(survivor, loser, input);
    if (survivor === null || loser === null || refusals.length > 0) {
      return { refusals, fields: [], customFields: [], counts: {}, warnings: [] };
    }
    return {
      refusals,
      fields: fieldDifferences(survivor, loser),
      customFields: customFieldDifferences(survivor, loser),
      counts: await projectStructureCounts(em, input.survivorId, input.loserId),
      warnings: [],
    };
  }

  async applyStructureBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeProjectMergeStructureCommand({ recordMerge: this.deps.recordMerge }, input));
    return { moved };
  }

  async finalize(input: MergeStepInput): Promise<void> {
    await this.deps.commandBus.run(
      makeProjectMergeFinalizeCommand(
        {
          recordMerge: this.deps.recordMerge,
          ...(this.deps.customFieldValues ? { customFieldValues: this.deps.customFieldValues } : {}),
        },
        input,
      ),
    );
  }

  /** The runner's state announcement, committed by now: tell whom the merge concerns. */
  async onStateChanged(change: RecordMergeStateChange): Promise<void> {
    await this.deps.notifier?.().onStateChanged(change);
  }
}

/** The participation key of the host's own records step (`records` phase). */
export const PROJECT_RECORDS_PARTICIPATION_KEY = 'project-records';

/**
 * The host's own records — links, comments, attachments, references and read
 * markers — as a participant of its own host, so the `records` phase runs
 * them beside `tasks`' and `crm`'s steps, with the same counts, retries and
 * residue sweep (`contracts/participant-dispositions.md` §B).
 */
export class ProjectRecordsMergeParticipant implements MergeParticipant<'project'> {
  readonly host = 'project' as const;

  constructor(private readonly deps: Pick<ProjectMergeHostDeps, 'emFactory' | 'commandBus'>) {}

  async preview(input: MergePreviewInput): Promise<MergeParticipantPreview> {
    const counts = await projectRecordCounts(this.deps.emFactory().fork({ clear: true }), input.survivorId, input.loserId);
    return { counts, conflicts: [], warnings: [], refusals: [] };
  }

  async applyBatch(input: MergeStepInput): Promise<{ moved: number }> {
    const { moved } = await this.deps.commandBus.run(makeProjectMergeReassignCommand(input));
    return { moved };
  }
}
