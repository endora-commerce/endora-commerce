import { LockMode } from '@mikro-orm/core';
import type { FormEntryStatus } from '@endora-commerce/contracts';
import type { Command, CommandContext } from '@endora-commerce/platform/commands';
import { randomUUID } from 'crypto';
import { FormEntry } from '../entities/form-entry.entity.js';
import { FormEntryNote } from '../entities/form-entry-note.entity.js';
import { formEntryNotFound, formEntryStatusConflict } from './forms-errors.js';

/**
 * The Commands an employee's work on entries runs (`specs/170-forms-module/` data-model §8, research
 * R-16, Constitution XIII):
 *
 * | Action | Object |
 * | --- | --- |
 * | `forms.entry.mark_read` — `new` → `read` on open; a no-op, unaudited, otherwise | `form_entry` |
 * | `forms.entry.status_change` — any → any, named `expectedStatus` (the *Undo* re-issues it) | `form_entry` |
 * | `forms.entry.note_add` — append-only | `form_entry` |
 * | `forms.entry.delete` / `forms.entries.delete` (bulk) — irreversible, notes go by cascade | `form_entry` |
 *
 * **Every read is the tenancy guard's** (`FormEntry` is `@CustomerScoped`): an entry outside the
 * caller's organisations is not found, exactly like a missing one, and a bulk delete skips it.
 *
 * **The form's counter follows spam** (research Principle XI review): `accepted_entry_count` counts
 * the non-spam entries, so a move to spam, out of spam, and a delete of a non-spam entry adjust it
 * in the same transaction — on the `@GlobalEntity` form row, never by a widened count.
 *
 * **Audit states hold no answer** (FR-053, FR-055): the form, the status, counts — never an answer,
 * a consent text, the submitter's address, the search text or a note's body.
 */

type Em = CommandContext['em'];

/** One entry of the caller's scope, locked for the Command; 404 otherwise. */
async function lockedEntry(em: Em, id: string): Promise<FormEntry> {
  const entry = await em.findOne(FormEntry, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
  if (!entry) throw formEntryNotFound();
  return entry;
}

/** Move a form's non-spam counter by `delta`, never below zero. Shared with retention and erasure. */
export async function adjustCounter(em: Em, formId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  await em.execute(
    `update "forms" set "accepted_entry_count" = greatest("accepted_entry_count" + ?, 0) where "id" = ?`,
    [delta, formId],
  );
}

const counts = (status: FormEntryStatus): boolean => status !== 'spam';

export function markEntryReadCommand(id: string): Command<void> {
  return {
    action: 'forms.entry.mark_read',
    objectType: 'form_entry',
    objectId: id,
    run: async ({ em }) => {
      const entry = await lockedEntry(em, id);
      // Opened once: an entry already read, closed or spam stays where an employee put it.
      if (entry.status !== 'new') return { result: undefined, skipAudit: true };
      entry.status = 'read';
      return {
        result: undefined,
        before: { formId: entry.formId, status: 'new' },
        after: { formId: entry.formId, status: 'read' },
      };
    },
  };
}

export function changeEntryStatusCommand(id: string, status: FormEntryStatus, expectedStatus: FormEntryStatus): Command<void> {
  return {
    action: 'forms.entry.status_change',
    objectType: 'form_entry',
    objectId: id,
    run: async ({ em }) => {
      const entry = await lockedEntry(em, id);
      if (entry.status !== expectedStatus) throw formEntryStatusConflict(entry.status);
      const before = entry.status;
      entry.status = status;
      await adjustCounter(em, entry.formId, Number(counts(status)) - Number(counts(before)));
      return {
        result: undefined,
        before: { formId: entry.formId, status: before },
        after: { formId: entry.formId, status },
      };
    },
  };
}

export function addEntryNoteCommand(entryId: string, body: string): Command<FormEntryNote> {
  return {
    action: 'forms.entry.note_add',
    objectType: 'form_entry',
    objectId: entryId,
    run: async ({ em, actor }) => {
      const entry = await lockedEntry(em, entryId);
      const note = em.create(FormEntryNote, { entryId: entry.id, body, authorAdminUserId: actor.actorAdminUserId });
      return { result: note, before: null, after: { formId: entry.formId, noteId: note.id } };
    },
  };
}

export function deleteEntryCommand(id: string): Command<void> {
  return {
    action: 'forms.entry.delete',
    objectType: 'form_entry',
    objectId: id,
    run: async ({ em }) => {
      const entry = await lockedEntry(em, id);
      const before = { formId: entry.formId, status: entry.status, formVersion: entry.formVersionNumber };
      if (counts(entry.status)) await adjustCounter(em, entry.formId, -1);
      em.remove(entry);
      return { result: undefined, before, after: null };
    },
  };
}

/**
 * `forms.entries.delete` — the entries of `ids` the caller may see; the rest are skipped silently,
 * so the answer tells no more about them than a missing id would (FR-046).
 */
export function deleteEntriesCommand(ids: readonly string[]): Command<{ deleted: number }> {
  return {
    action: 'forms.entries.delete',
    objectType: 'form_entry',
    objectId: randomUUID(),
    run: async ({ em }) => {
      const entries = await em.find(FormEntry, { id: { $in: [...new Set(ids)] } }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      const byForm = new Map<string, number>();
      for (const entry of entries) {
        if (counts(entry.status)) byForm.set(entry.formId, (byForm.get(entry.formId) ?? 0) + 1);
        em.remove(entry);
      }
      for (const [formId, n] of byForm) await adjustCounter(em, formId, -n);
      return {
        result: { deleted: entries.length },
        before: null,
        after: { deleted: entries.length, formIds: [...new Set(entries.map((entry) => entry.formId))].sort() },
      };
    },
  };
}

/**
 * Move each form's counter by the non-spam entries among `entries`, which the calling Command is
 * deleting — retention and erasure, which select by time or by account rather than by id. Answers
 * how many entries go per form.
 */
export async function releaseCounters(
  em: Em,
  entries: readonly Pick<FormEntry, 'formId' | 'status'>[],
): Promise<Map<string, number>> {
  const perForm = new Map<string, number>();
  const counted = new Map<string, number>();
  for (const entry of entries) {
    perForm.set(entry.formId, (perForm.get(entry.formId) ?? 0) + 1);
    if (counts(entry.status)) counted.set(entry.formId, (counted.get(entry.formId) ?? 0) + 1);
  }
  for (const [formId, n] of counted) await adjustCounter(em, formId, -n);
  return perForm;
}
