import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  ORGANIZATION_MERGE_EVENTS,
  type CustomFieldValuePort,
  type MergeStepInput,
  type OrganizationMergedEventV1,
  type OrganizationMergeFieldCode,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { RecordMergeService } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';
import { effectiveFieldChoices, resolvedCustomFieldValues } from '../merge/organization-merge-rules.js';
import { changedKeys } from '../services/organization-audit-state.js';
import { taxIdConflictOf } from '../services/tax-id-conflict.js';
import { taxIdExistsRefusal } from '../services/organization-write.js';

/**
 * `organization.merge.finalize` (`specs/192-organization-merge/` FR-030 –
 * FR-033, FR-051, FR-054; research R-7, R-14) — once per merge, after every
 * participant's step:
 *
 *  - the survivor takes the field values the operator chose from the loser
 *    (each field's default where nothing was chosen), the union of both order
 *    confirmation e-mail lists, and the chosen custom-field values, validated
 *    against the current definitions (FR-031);
 *  - a tax ID taken from the loser is released by the loser in the same write
 *    that archives it, and set on the survivor with the loser's latest VAT
 *    validation outcome (FR-033, R-14a) — the relaxed presence CHECK admits a
 *    merged company row without one, and the uniqueness rules of 177 hold at
 *    commit;
 *  - the loser is archived: soft-deleted, with its survivor, the time and the
 *    merge id (R-7);
 *  - `organization.merged.v1` is dispatched once, on commit.
 *
 * Idempotent: a loser already merged into this survivor answers with nothing
 * written, nothing audited and no event, so a resumed merge whose finalize had
 * committed cannot emit twice. Audit: field and custom-field names, never a
 * value (O-2).
 */
export interface MergeFinalizeDeps {
  readonly recordMerge: () => RecordMergeService;
  /** Validates the chosen custom-field values against the current definitions. Absent: no definitions to hold them to. */
  readonly customFieldValues?: () => Pick<CustomFieldValuePort, 'validateAndMerge'>;
}

export interface MergeFinalizeResult {
  readonly survivor: Organization;
  readonly finalized: boolean;
  readonly mergedAt: Date;
}

function unionEmails(a: readonly string[], b: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of [...a, ...b]) {
    const key = email.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(email.trim());
  }
  return out;
}

function applyField(survivor: Organization, loser: Organization, code: OrganizationMergeFieldCode): void {
  switch (code) {
    case 'name':
      survivor.name = loser.name;
      return;
    case 'legalName':
      survivor.legalName = loser.legalName ?? null;
      return;
    case 'vatStatus':
      survivor.vatStatus = loser.vatStatus;
      return;
    case 'registeredAddress':
      survivor.registeredAddress = { ...loser.registeredAddress };
      return;
    case 'customerGroupId':
      survivor.customerGroupId = loser.customerGroupId ?? null;
      return;
    case 'creditInheritanceMode':
      survivor.creditInheritanceMode = loser.creditInheritanceMode ?? null;
      return;
    case 'fulfilmentStrategy':
      survivor.fulfilmentStrategy = loser.fulfilmentStrategy ?? null;
      survivor.fulfilmentStrategyWarehouseOrder = loser.fulfilmentStrategyWarehouseOrder ?? null;
      return;
    case 'taxId':
      return; // applied with the loser's release, below
  }
}

export function makeMergeFinalizeCommand(deps: MergeFinalizeDeps, input: MergeStepInput): Command<MergeFinalizeResult> {
  const mergedAt = new Date();
  let source: string | null = null;
  return {
    action: 'organization.merge.finalize',
    objectType: 'organization',
    objectId: input.survivorId,
    run: async ({ em }: { em: EntityManager }) => {
      const ordered = [input.survivorId, input.loserId].sort();
      await em.execute('select "id" from "organizations" where "id" in (?, ?) order by "id" for update', ordered);
      const [survivor, loser] = await Promise.all([
        em.findOne(Organization, { id: input.survivorId }, { refresh: true }),
        em.findOne(Organization, { id: input.loserId }, { refresh: true }),
      ]);
      if (survivor === null || loser === null) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      if (loser.mergedIntoOrganizationId === survivor.id) {
        return { result: { survivor, finalized: false, mergedAt: loser.mergedAt ?? mergedAt }, skipAudit: true };
      }
      if (survivor.deletedAt || loser.deletedAt || survivor.mergedIntoOrganizationId || loser.mergedIntoOrganizationId) {
        throw new HttpError(409, ERROR_CODES.RECORD_MERGE_RECORD_UNAVAILABLE, 'These organizations cannot be merged.', {
          record: survivor.deletedAt || survivor.mergedIntoOrganizationId ? 'survivor' : 'loser',
        });
      }
      const merge = await deps.recordMerge().getWithin(em, input.mergeId);
      if (merge === null) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Merge not found.');
      source = merge.source;

      const before = {
        name: survivor.name,
        legalName: survivor.legalName ?? null,
        taxId: survivor.taxId ?? null,
        vatStatus: survivor.vatStatus,
        registeredAddress: { ...survivor.registeredAddress },
        customerGroupId: survivor.customerGroupId ?? null,
        creditInheritanceMode: survivor.creditInheritanceMode ?? null,
        fulfilmentStrategy: survivor.fulfilmentStrategy ?? null,
        fulfilmentStrategyWarehouseOrder: survivor.fulfilmentStrategyWarehouseOrder ?? null,
        orderConfirmationEmails: [...(survivor.orderConfirmationEmails ?? [])],
      };
      const beforeCustom = { ...(survivor.customFieldValues ?? {}) };

      const choices = effectiveFieldChoices(survivor, loser, merge.fieldChoices);
      for (const [code, choice] of Object.entries(choices) as [OrganizationMergeFieldCode, string][]) {
        if (choice === 'loser') applyField(survivor, loser, code);
      }
      const emails = unionEmails(survivor.orderConfirmationEmails ?? [], loser.orderConfirmationEmails ?? []);
      if (!isDeepStrictEqual(emails, survivor.orderConfirmationEmails ?? [])) survivor.orderConfirmationEmails = emails;

      // Custom fields (FR-031): the resolved bag, validated as an operator's
      // edit of the changed keys would be.
      const resolved = resolvedCustomFieldValues(survivor, loser, merge.customFieldChoices);
      const changed = changedKeys(beforeCustom, resolved);
      if (changed.length > 0) {
        const patch = Object.fromEntries(changed.map((key) => [key, resolved[key]]));
        survivor.customFieldValues =
          deps.customFieldValues !== undefined
            ? await deps.customFieldValues().validateAndMerge('organization', beforeCustom, patch)
            : resolved;
      }

      // The archive, and the tax ID's release, in one write of the loser.
      const taxIdTaken = choices.taxId === 'loser' && typeof loser.taxId === 'string' && loser.taxId.length > 0;
      const takenTaxId = taxIdTaken ? (loser.taxId as string) : null;
      loser.deletedAt = mergedAt;
      loser.mergedIntoOrganizationId = survivor.id;
      loser.mergedAt = mergedAt;
      loser.mergeId = input.mergeId;
      if (taxIdTaken) loser.taxId = null;
      try {
        await em.flush();
        if (takenTaxId !== null) {
          survivor.taxId = takenTaxId;
          survivor.vatValidatedAt = loser.vatValidatedAt ?? null;
          survivor.vatValidationProvider = loser.vatValidationProvider ?? null;
          survivor.vatValidationOutcome = loser.vatValidationOutcome ?? null;
        }
        await em.flush();
      } catch (error) {
        if (taxIdConflictOf(error) !== null) throw taxIdExistsRefusal();
        throw error;
      }
      // A pointer is never more than one hop: what was merged into the loser
      // earlier now points at the survivor, with the merge that put it there.
      const repointed = await em.execute<Array<{ id: string }>>(
        `update "organizations" set "merged_into_organization_id" = ? where "merged_into_organization_id" = ? returning "id"`,
        [survivor.id, loser.id],
      );

      const after = {
        ...before,
        name: survivor.name,
        legalName: survivor.legalName ?? null,
        taxId: survivor.taxId ?? null,
        vatStatus: survivor.vatStatus,
        registeredAddress: { ...survivor.registeredAddress },
        customerGroupId: survivor.customerGroupId ?? null,
        creditInheritanceMode: survivor.creditInheritanceMode ?? null,
        fulfilmentStrategy: survivor.fulfilmentStrategy ?? null,
        fulfilmentStrategyWarehouseOrder: survivor.fulfilmentStrategyWarehouseOrder ?? null,
        orderConfirmationEmails: [...(survivor.orderConfirmationEmails ?? [])],
      };
      return {
        result: { survivor, finalized: true, mergedAt },
        before: null,
        after: {
          mergeId: input.mergeId,
          loserId: input.loserId,
          changedFields: changedKeys(before, after),
          changedCustomFields: changedKeys(beforeCustom, survivor.customFieldValues ?? {}),
          taxIdTaken,
          ...(repointed.length > 0 ? { repointedMergedIds: repointed.map((row) => row.id).sort() } : {}),
        },
      };
    },
    event: ({ survivor, finalized }) => {
      if (!finalized) return undefined;
      const payload: OrganizationMergedEventV1 = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        organizationId: survivor.id,
        mergedOrganizationId: input.loserId,
        mergeId: input.mergeId,
        mergedAt: mergedAt.toISOString(),
        source,
      };
      return { eventName: ORGANIZATION_MERGE_EVENTS.MERGED, payload };
    },
  };
}
