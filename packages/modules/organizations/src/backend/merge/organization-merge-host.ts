import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomFieldValuePort,
  HostMergePreview,
  MergeHostImplementation,
  MergeStepInput,
  RecordMergeStateChange,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { RecordMergeService, SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { makeMergeFinalizeCommand } from '../commands/merge-finalize.command.js';
import { makeMergeStructureCommand } from '../commands/merge-structure.command.js';
import { Organization } from '../entities/organization.entity.js';
import { runOrganizationWrite, taxIdExistsRefusal } from '../services/organization-write.js';
import type { OrganizationRoleCache } from '../services/organization-role-cache.js';
import type { OrganizationTreeService } from '../services/organization-tree-service.js';
import { customFieldDifferences, fieldDifferences, organizationMergeRefusals } from './organization-merge-rules.js';
import type { OrganizationMergeNotifier } from './organization-merge-notifier.js';
import { structureCounts } from './organization-merge-structure.js';

/**
 * `organizations` as the host of the `organization` record type
 * (`specs/192-organization-merge/` `contracts/merge-mechanism.md` §2,
 * `contracts/organization-merge.md` §2–§3): what the platform's runner calls
 * for the host's own phases. Registered with `ctx.merge.host('organization', …)`.
 *
 * It names no participant (Principle I): every other module's rows are moved by
 * that module's own participant, in the phases between `structure` and
 * `finalize`.
 */
export interface OrganizationMergeHostDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
  readonly recordMerge: () => RecordMergeService;
  readonly tree: () => OrganizationTreeService;
  readonly membership: () => Pick<SalesChannelMembershipPort, 'copyMemberships'>;
  readonly customFieldValues?: () => Pick<CustomFieldValuePort, 'validateAndMerge'>;
  readonly roleCache?: () => Pick<OrganizationRoleCache, 'dropAndAnnounce'>;
  readonly warn?: (message: string, error: unknown) => void;
  /** The bell entries on `needs_attention` and on completion (`contracts/events-and-webhooks.md` §3). */
  readonly notifier?: () => OrganizationMergeNotifier;
}

export class OrganizationMergeHost implements MergeHostImplementation<'organization'> {
  readonly host = 'organization' as const;

  constructor(private readonly deps: OrganizationMergeHostDeps) {}

  async preview(input: { readonly survivorId: string; readonly loserId: string }): Promise<HostMergePreview> {
    const em = this.deps.emFactory().fork({ clear: true });
    const [survivor, loser] = await Promise.all([
      em.findOne(Organization, { id: input.survivorId }),
      em.findOne(Organization, { id: input.loserId }),
    ]);
    const refusals = organizationMergeRefusals(survivor, loser, input);
    if (survivor === null || loser === null || refusals.some((r) => r.code.startsWith('RECORD_MERGE_'))) {
      return { refusals, fields: [], customFields: [], counts: {}, warnings: [] };
    }
    return {
      refusals,
      fields: fieldDifferences(survivor, loser),
      customFields: customFieldDifferences(survivor, loser),
      counts: await structureCounts(em, input.survivorId, input.loserId),
      warnings: [],
    };
  }

  async applyStructureBatch(input: MergeStepInput): Promise<{ moved: number }> {
    // The children's tree moves rewrite paths, which `per-tree-root`'s deferred
    // constraint judges at commit: mapped to the write's 409 like every other
    // tree write (177 T041a), so the step records a code rather than a 500.
    const result = await runOrganizationWrite(
      this.deps.commandBus,
      makeMergeStructureCommand(
        { recordMerge: this.deps.recordMerge, tree: this.deps.tree, membership: this.deps.membership },
        input,
      ),
      () => taxIdExistsRefusal(),
    );
    if (result.moved > 0) await this.#dropRoles(input.survivorId);
    return { moved: result.moved };
  }

  async finalize(input: MergeStepInput): Promise<void> {
    await runOrganizationWrite(
      this.deps.commandBus,
      makeMergeFinalizeCommand(
        {
          recordMerge: this.deps.recordMerge,
          ...(this.deps.customFieldValues ? { customFieldValues: this.deps.customFieldValues } : {}),
        },
        input,
      ),
      () => taxIdExistsRefusal(),
    );
    await this.#dropRoles(input.survivorId);
    await this.#dropRoles(input.loserId);
  }

  /** The runner's state announcement, committed by now: tell whom the merge concerns. */
  async onStateChanged(change: RecordMergeStateChange): Promise<void> {
    await this.deps.notifier?.().onStateChanged(change);
  }

  /** Committed by now: a role cache that cannot be dropped expires by itself. */
  async #dropRoles(organizationId: string): Promise<void> {
    await this.deps.roleCache?.().dropAndAnnounce(organizationId).catch((error: unknown) => {
      this.deps.warn?.(`organizations: role cache not dropped for ${organizationId} after a merge step`, error);
    });
  }
}
