import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CustomFieldValuePort,
  type OrganizationMergePreview,
  type OrganizationMergeRecord,
  type RecordMergeChoice,
  type RecordMergeState,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';
import { makeMergeCancelCommand } from '../commands/merge-cancel.command.js';
import { makeMergeResumeCommand } from '../commands/merge-resume.command.js';
import { makeMergeStartCommand, mergeRefusalError } from '../commands/merge-start.command.js';
import { Organization } from '../entities/organization.entity.js';
import { changedKeys } from '../services/organization-audit-state.js';
import { resolvedCustomFieldValues } from './organization-merge-rules.js';

/**
 * The Organization merge as an operation (`specs/192-organization-merge/`
 * `contracts/organization-merge.md` §1–§4): what the admin routes call, what
 * `organizationDetailsPort.previewMerge / resolveMerged / getMerge` read, and
 * what `organizationCommandPort.startMerge / resumeMerge / cancelMerge` will
 * call once that port exists (#1821). No permission and no reach is checked
 * here — the caller is the gate.
 */
export interface OrganizationMergeStartRequest {
  readonly loserId: string;
  readonly fieldChoices?: Readonly<Partial<Record<string, RecordMergeChoice>>>;
  readonly customFieldChoices?: Readonly<Record<string, RecordMergeChoice>>;
  readonly acknowledgeIrreversible?: boolean;
  /** D-293.6: the integration that asked, recorded on the merge and its audit entry. */
  readonly source?: string | null;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface OrganizationMergeServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: { run<T>(command: Command<T>): Promise<T> };
  readonly recordMerge: () => RecordMergeService;
  readonly customFieldValues?: () => Pick<CustomFieldValuePort, 'validateAndMerge'>;
}

function definedChoices(choices: Readonly<Partial<Record<string, RecordMergeChoice>>> | undefined): Record<string, RecordMergeChoice> {
  const out: Record<string, RecordMergeChoice> = {};
  for (const [key, value] of Object.entries(choices ?? {})) if (value !== undefined) out[key] = value;
  return out;
}

export class OrganizationMergeService {
  constructor(private readonly deps: OrganizationMergeServiceDeps) {}

  /** FR-002 — every refusal, per present participant what would follow, and the values that differ. Writes nothing. */
  preview(survivorId: string, loserId: string): Promise<OrganizationMergePreview> {
    return this.deps.recordMerge().preview('organization', survivorId, loserId);
  }

  /**
   * FR-003, FR-004 — re-checks everything the preview checked, refuses on the
   * first refusal (with every refusal in `details.refusals`), validates the
   * chosen custom-field values (FR-031), then runs the start Command and hands
   * the committed merge to the runner.
   */
  async start(survivorId: string, request: OrganizationMergeStartRequest): Promise<OrganizationMergeRecord> {
    if (request.acknowledgeIrreversible !== true) {
      throw new HttpError(
        422,
        ERROR_CODES.RECORD_MERGE_ACKNOWLEDGEMENT_REQUIRED,
        'A merge cannot be undone; confirm that before starting it.',
      );
    }
    const preview = await this.preview(survivorId, request.loserId);
    const first = preview.refusals[0];
    if (first !== undefined) {
      const error = mergeRefusalError(first);
      throw new HttpError(error.statusCode, error.code, error.message, {
        ...(first.details ?? {}),
        refusals: preview.refusals.map((refusal) => refusal.code),
      });
    }

    const customFieldChoices = definedChoices(request.customFieldChoices);
    await this.#validateCustomFieldChoices(survivorId, request.loserId, customFieldChoices);

    const participantCounts: Record<string, number> = {};
    for (const participant of preview.participants) {
      const total = Object.values(participant.counts).reduce((sum, count) => sum + count, 0);
      participantCounts[participant.moduleId] = (participantCounts[participant.moduleId] ?? 0) + total;
    }

    const mergeId = randomUUID();
    const record = await this.deps.commandBus.run(
      makeMergeStartCommand(
        { recordMerge: this.deps.recordMerge },
        {
          mergeId,
          survivorId,
          loserId: request.loserId,
          fieldChoices: definedChoices(request.fieldChoices),
          customFieldChoices,
          source: request.source ?? null,
          participantCounts,
          ...(request.extensions ? { extensions: request.extensions } : {}),
        },
      ),
    );
    await this.deps.recordMerge().announce(record.id);
    return (await this.deps.recordMerge().get(record.id)) ?? record;
  }

  async cancel(mergeId: string, expectedVersion: number): Promise<OrganizationMergeRecord> {
    const merge = await this.#require(mergeId);
    const record = await this.deps.commandBus.run(
      makeMergeCancelCommand(
        { recordMerge: this.deps.recordMerge },
        { mergeId, survivorId: merge.survivorId, loserId: merge.loserId, expectedVersion },
      ),
    );
    await this.deps.recordMerge().announce(mergeId);
    return record;
  }

  async resume(mergeId: string, expectedVersion: number): Promise<OrganizationMergeRecord> {
    const merge = await this.#require(mergeId);
    const record = await this.deps.commandBus.run(
      makeMergeResumeCommand(
        { recordMerge: this.deps.recordMerge },
        { mergeId, survivorId: merge.survivorId, loserId: merge.loserId, expectedVersion },
      ),
    );
    await this.deps.recordMerge().announce(mergeId);
    return record;
  }

  async get(mergeId: string): Promise<OrganizationMergeRecord | null> {
    const merge = await this.deps.recordMerge().get(mergeId);
    return merge !== null && merge.hostType === 'organization' ? merge : null;
  }

  list(filter: { readonly state?: RecordMergeState; readonly organizationId?: string }): Promise<OrganizationMergeRecord[]> {
    return this.deps.recordMerge().list({
      hostType: 'organization',
      ...(filter.state !== undefined ? { state: filter.state } : {}),
      ...(filter.organizationId !== undefined ? { recordId: filter.organizationId } : {}),
    });
  }

  /** FR-052 — the survivor's id for a merged Organization, else the id itself (one hop by construction). */
  async resolveMerged(id: string): Promise<string> {
    const archived = this.deps.recordMerge().archivedInto('organization', id);
    if (archived !== null) return archived;
    const row = await this.deps.emFactory().findOne(Organization, { id }, { fields: ['id', 'mergedIntoOrganizationId'] });
    return row?.mergedIntoOrganizationId ?? id;
  }

  async #require(mergeId: string): Promise<OrganizationMergeRecord> {
    const merge = await this.get(mergeId);
    if (merge === null) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Merge not found.');
    return merge;
  }

  async #validateCustomFieldChoices(
    survivorId: string,
    loserId: string,
    choices: Readonly<Record<string, RecordMergeChoice>>,
  ): Promise<void> {
    if (this.deps.customFieldValues === undefined) return;
    const em = this.deps.emFactory();
    const [survivor, loser] = await Promise.all([
      em.findOneOrFail(Organization, { id: survivorId }),
      em.findOneOrFail(Organization, { id: loserId }),
    ]);
    const current = { ...(survivor.customFieldValues ?? {}) };
    const resolved = resolvedCustomFieldValues(survivor, loser, choices);
    const changed = changedKeys(current, resolved);
    if (changed.length === 0) return;
    await this.deps.customFieldValues().validateAndMerge(
      'organization',
      current,
      Object.fromEntries(changed.map((key) => [key, resolved[key]])),
    );
  }
}
