import type { Command, CommandBus, CommandContext } from '@endora-commerce/platform/commands';
import { Form } from '../entities/form.entity.js';
import { FormEntry } from '../entities/form-entry.entity.js';
import { releaseCounters } from './entry-commands.js';

/**
 * Per-form retention (`specs/170-forms-module/` FR-054, research R-20, User Story 9): the entries of
 * a form with `retention_days` submitted before `now − days` are deleted by the maintenance tick,
 * notes by the foreign key's cascade, in batches of {@link RETENTION_BATCH}. Each batch is one
 * Command `forms.entries.retention_delete` on the form, whose audit state names the form, the
 * cutoff and the count — never an answer (FR-053). The form's counter moves by the non-spam ones.
 *
 * The pass runs inside the system scope the tick entered (every organisation's entries are due
 * alike); the probe reads the global `forms` table only.
 */

type Em = CommandContext['em'];

export const RETENTION_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant before which a period of `days` deletes, at `now`. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** `forms.entries.retention_delete` — at most `limit` entries of `formId` submitted before `cutoff`. */
export function retentionDeleteCommand(formId: string, cutoff: Date, limit = RETENTION_BATCH): Command<number> {
  return {
    action: 'forms.entries.retention_delete',
    objectType: 'form',
    objectId: formId,
    run: async ({ em }) => {
      const due = await em.find(
        FormEntry,
        { formId, submittedAt: { $lt: cutoff } },
        { fields: ['id', 'formId', 'status'], orderBy: { submittedAt: 'asc', id: 'asc' }, limit },
      );
      // Nothing due: an idle tick writes no audit row.
      if (due.length === 0) return { result: 0, skipAudit: true };
      // Notes go by the foreign key's cascade.
      await em.nativeDelete(FormEntry, { id: { $in: due.map((entry) => entry.id) } });
      await releaseCounters(em, due);
      return {
        result: due.length,
        before: null,
        after: { formId, cutoff: cutoff.toISOString(), deleted: due.length },
      };
    },
  };
}

export interface RetentionServiceDeps {
  readonly emFactory: () => Em;
  readonly commandBus: CommandBus;
}

export class RetentionService {
  constructor(private readonly deps: RetentionServiceDeps) {}

  /** Whether any form keeps its entries for a limited period — a global read, outside any scope. */
  async hasWork(): Promise<boolean> {
    const rows = (await this.deps
      .emFactory()
      .getConnection()
      .execute(`select exists (select 1 from "forms" where "retention_days" is not null) as "due"`)) as Array<{ due: boolean }>;
    return rows[0]?.due === true;
  }

  /** One pass: every form with a period, batch after batch until a batch comes back short. Answers the count. */
  async run(now: Date): Promise<number> {
    const forms = await this.deps
      .emFactory()
      .find(Form, { retentionDays: { $ne: null } }, { fields: ['id', 'retentionDays'], orderBy: { id: 'asc' } });
    let deleted = 0;
    for (const form of forms) {
      const cutoff = retentionCutoff(now, form.retentionDays!);
      for (;;) {
        const batch = await this.deps.commandBus.run(retentionDeleteCommand(form.id, cutoff));
        deleted += batch;
        if (batch < RETENTION_BATCH) break;
      }
    }
    return deleted;
  }

  /**
   * How many of the form's entries a period of `days` would delete now — counted through the
   * tenancy guard, in the caller's scope (the edge case's warning before saving).
   */
  async impact(formId: string, days: number, now: Date): Promise<number> {
    return this.deps.emFactory().count(FormEntry, { formId, submittedAt: { $lt: retentionCutoff(now, days) } });
  }
}
