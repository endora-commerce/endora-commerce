import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { ERROR_CODES, isUuidShape, type ObjectStoragePort } from '@endora-commerce/contracts';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { RETURNS_SETTING_CODES } from '../../../manifest.js';
import { ReturnCase } from '../../entities/return-case.entity.js';
import { ReturnCaseAttachment } from '../../entities/return-case-attachment.entity.js';
import { ReturnGuestVerification } from '../../entities/return-guest-verification.entity.js';
import { isAlreadyGone } from '../return-erasure-service.js';

/**
 * Erasing a guest's personal data (`specs/181-guest-complaints/` FR-070 – FR-073,
 * research R-9; contracts/settings-emails-events.md §5).
 *
 * One Command, `return_case.guest_data.erase`, serves both ways in:
 *
 * - **`retention`** — the daily `returns-maintenance` sweep, for every guest case closed
 *   (entered a terminal status) longer ago than `returns.guest_data_retention_days`,
 *   in batches of 100 inside the system scope;
 * - **`request`** — an operator holding `returns:erase_personal_data` (admin-api.md A5),
 *   in any status, read in the operator's tenant context so a restricted admin gets the
 *   404 of a case that does not exist (research R-1).
 *
 * It nulls the contact and the ship-back address, deletes every file — the bytes first,
 * then the row, so an object is never left unreachable — and stamps
 * `personal_data_erased_at`. Lines, purchase data, clauses, comments and the resolution
 * stay (G10). The entry records the trigger, the file count and the field names, never a
 * value (FR-073). The case row is locked for the transaction, so a sweep and a request
 * erasing one case at once leave one erasure and one entry.
 */

/** The retention a value outside the setting's documented range is read as (research R-9). */
export const GUEST_RETENTION_MIN_DAYS = 30;
export const GUEST_RETENTION_MAX_DAYS = 3650;
export const GUEST_RETENTION_DEFAULT_DAYS = 90;
/** How long a verification row lives (FR-026). */
export const GUEST_VERIFICATION_LIFETIME_DAYS = 7;
/** How many due cases one round of the sweep reads. */
export const GUEST_ERASURE_BATCH = 100;

export const RETURNS_GUEST_RETENTION_SCOPE_REASON = 'returns: guest data retention';
export const RETURNS_GUEST_VERIFICATION_PURGE_SCOPE_REASON = 'returns: delete guest verifications older than 7 days';

const DAY_MS = 86_400_000;
const ERASED_FIELDS = ['contact', 'returnAddress'] as const;

/**
 * The setting's value, clamped to 30 – 3 650 days: the settings store validates the type
 * only (research F17), so the range is enforced where the value is read. A value that is
 * not a finite number — or a setting that cannot be read — is the default.
 */
export function clampRetentionDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return GUEST_RETENTION_DEFAULT_DAYS;
  return Math.min(GUEST_RETENTION_MAX_DAYS, Math.max(GUEST_RETENTION_MIN_DAYS, Math.round(value)));
}

/** The platform-wide retention, clamped (it is read with no channel: data-model §5). */
export function createGuestRetentionReader(settings: Pick<SettingsReadPort, 'get'>): () => Promise<number> {
  return async () => {
    try {
      return clampRetentionDays(await settings.get(RETURNS_SETTING_CODES.GUEST_DATA_RETENTION_DAYS, null, z.number()));
    } catch {
      return GUEST_RETENTION_DEFAULT_DAYS;
    }
  };
}

/** When a guest case's data falls due: `closedAt` + the retention; `null` while open, erased, or for a customer's case. */
export function guestDataErasureDueAt(
  rc: { customerAccountId?: string | null; closedAt?: Date | null; personalDataErasedAt?: Date | null },
  retentionDays: number,
): Date | null {
  if (rc.customerAccountId != null || rc.personalDataErasedAt || !rc.closedAt) return null;
  return new Date(rc.closedAt.getTime() + retentionDays * DAY_MS);
}

export type GuestErasureTrigger = 'retention' | 'request';

export interface GuestDataErasureDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: Pick<CommandBus, 'run'>;
  /** `assets_library`'s object store, where the files' bytes are. */
  readonly storage: Pick<ObjectStoragePort, 'getForBackend'>;
  /** The clamped retention ({@link createGuestRetentionReader}). */
  readonly retentionDays: () => Promise<number>;
  readonly now?: () => Date;
}

export class GuestDataErasure {
  constructor(private readonly deps: GuestDataErasureDeps) {}

  /**
   * A5 — erase at once, in any status. Answers the stamp; an erased case answers the stamp
   * it already has and records nothing. A customer's case is `422 not_guest_case`.
   */
  async eraseOnRequest(caseId: string): Promise<{ personalDataErasedAt: string }> {
    if (!isUuidShape(caseId)) throw notFound();
    const at = await this.deps.commandBus.run(this.command(caseId, 'request', this.now()));
    if (at === null) throw notFound();
    return { personalDataErasedAt: at.toISOString() };
  }

  /** Whether any guest case could be due: one is closed and still holds its data. */
  async hasDueCases(): Promise<boolean> {
    const rows = (await this.deps
      .emFactory()
      .getConnection()
      .execute(
        `select exists (select 1 from "return_cases"
           where "customer_account_id" is null and "personal_data_erased_at" is null and "closed_at" is not null) as "any"`,
      )) as Array<{ any: boolean }>;
    return rows[0]?.any === true;
  }

  /**
   * The sweep's step: erase every guest case closed before `now` − retention, 100 at a
   * time, one Command each. Runs inside the system scope. Answers how many it erased.
   */
  async sweep(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - (await this.deps.retentionDays()) * DAY_MS);
    let erased = 0;
    for (;;) {
      const due = await this.deps.emFactory().find(
        ReturnCase,
        { customerAccountId: null, personalDataErasedAt: null, closedAt: { $lt: cutoff } },
        { fields: ['id'], orderBy: { closedAt: 'asc', id: 'asc' }, limit: GUEST_ERASURE_BATCH },
      );
      for (const rc of due) {
        if ((await this.deps.commandBus.run(this.command(rc.id, 'retention', now))) !== null) erased += 1;
      }
      if (due.length < GUEST_ERASURE_BATCH) return erased;
    }
  }

  /** FR-026 — every verification row older than 7 days goes, live session or not. */
  async purgeVerifications(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - GUEST_VERIFICATION_LIFETIME_DAYS * DAY_MS);
    // command-coverage-ignore: a verification row is a 7-day staging record that holds an
    // address and no case (research R-6); deleting it at the end of its life is housekeeping.
    return this.deps.emFactory().nativeDelete(ReturnGuestVerification, { createdAt: { $lt: cutoff } });
  }

  /**
   * `return_case.guest_data.erase`. Answers the stamp — the new one, or the one the case
   * already carried (no entry then) — or `null` when the case is not there for the reader.
   */
  private command(caseId: string, trigger: GuestErasureTrigger, at: Date): Command<Date | null> {
    return {
      action: 'return_case.guest_data.erase',
      objectType: 'return_case',
      objectId: caseId,
      run: async ({ em }) => {
        const rc = await em.findOne(ReturnCase, { id: caseId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!rc) return { result: null, skipAudit: true };
        if (rc.customerAccountId != null) {
          throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Only a guest’s case is erased here; a customer’s data goes with their account.', {
            code: 'not_guest_case',
          });
        }
        if (rc.personalDataErasedAt) return { result: rc.personalDataErasedAt, skipAudit: true };
        const files = await em.find(ReturnCaseAttachment, { returnCaseId: caseId });
        for (const row of files) await this.deleteObject(row);
        if (files.length > 0) await em.nativeDelete(ReturnCaseAttachment, { id: { $in: files.map((f) => f.id) } });
        await em.nativeUpdate(ReturnCase, { id: caseId }, { contact: null, returnAddress: null, personalDataErasedAt: at });
        return {
          result: at,
          before: null,
          after: { trigger, attachmentCount: files.length, fields: [...ERASED_FIELDS] },
        };
      },
    };
  }

  private async deleteObject(row: Pick<ReturnCaseAttachment, 'storageBackend' | 'storageLocator'>): Promise<void> {
    if (!row.storageBackend || !row.storageLocator) return;
    const store = await this.deps.storage.getForBackend(row.storageBackend as never);
    try {
      await store.delete({ locator: row.storageLocator });
    } catch (error) {
      // Already gone is deleted: a rolled-back run may have removed the bytes.
      if (!isAlreadyGone(error)) throw error;
    }
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}

function notFound(): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
}
