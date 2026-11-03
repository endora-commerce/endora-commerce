import { LockMode } from '@mikro-orm/core';
import {
  FORMS_EVENTS,
  type AnswerValue,
  type FormConsentRecord,
  type FormEntrySubmittedEventV1,
} from '@endora-commerce/contracts';
import type { Command, CommandEvent } from '@endora-commerce/platform/commands';
import { randomUUID } from 'crypto';
import { Form } from '../../entities/form.entity.js';
import { FormEntry } from '../../entities/form-entry.entity.js';
import { formNotAccepting } from '../forms-errors.js';
import type { EntryOwner } from './attribution.js';

/**
 * The Command that stores an accepted submission (`specs/170-forms-module/` research R-12 step 8,
 * data-model §8, Constitution XIII): the entry, the form's counter and the audit row are one
 * transaction, and `forms.entry.submitted.v1` is dispatched once, after the commit — a rolled-back
 * submission publishes nothing.
 *
 * **The maximum holds under concurrency.** With a maximum set the form row is locked `for update`
 * and the count re-read under the lock, so of two submissions racing for the last place one commits
 * and the other is refused `full`; without one the counter is incremented in the database
 * (`accepted_entry_count + 1`), so no increment is lost and no submission waits for another.
 *
 * **The audit state holds no answer** (FR-053, FR-055): the form, the version, the channel, the
 * language and whether the entry is attributed — never an answer, a consent text, the submitter's
 * address, the search text or the owner's ids beyond the organisation the entry already names.
 */

export interface SubmitEntryInput {
  readonly formId: string;
  readonly formKey: string;
  readonly versionId: string;
  readonly versionNumber: number;
  /** The served version's maximum; `null` takes every submission. */
  readonly maxEntries: number | null;
  readonly salesChannelId: string;
  readonly language: string;
  readonly pageUrl: string | null;
  readonly answers: Record<string, AnswerValue>;
  readonly consents: FormConsentRecord[];
  readonly submitterEmail: string | null;
  readonly searchText: string;
  /**
   * The answers the event publishes (FR-064): those of the fields the entry's version marks
   * "Share with integrations" that were visible — `{}` when it marks none. Never audited.
   */
  readonly sharedAnswers: Record<string, AnswerValue>;
  readonly owner: EntryOwner;
}

/** What the submission answers and publishes. */
export interface SubmittedEntry {
  readonly entryId: string;
  readonly submittedAt: Date;
}

export function submitEntryCommand(input: SubmitEntryInput): Command<SubmittedEntry> {
  const entryId = randomUUID();
  return {
    action: 'forms.entry.submit',
    objectType: 'form_entry',
    objectId: entryId,
    run: async ({ em }) => {
      if (input.maxEntries !== null) {
        const form = await em.findOne(Form, { id: input.formId }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        if (!form || form.publishedVersionId === null) throw formNotAccepting('unavailable');
        if (form.status === 'closed') throw formNotAccepting('closed');
        if (form.acceptedEntryCount >= input.maxEntries) throw formNotAccepting('full');
        form.acceptedEntryCount += 1;
      } else {
        // In the database, on the Command's transaction: no increment is lost to a concurrent one.
        await em.execute(`update "forms" set "accepted_entry_count" = "accepted_entry_count" + 1 where "id" = ?`, [
          input.formId,
        ]);
      }
      const entry = em.create(FormEntry, {
        id: entryId,
        formId: input.formId,
        formVersionId: input.versionId,
        formVersionNumber: input.versionNumber,
        salesChannelId: input.salesChannelId,
        language: input.language,
        pageUrl: input.pageUrl,
        answers: input.answers,
        consents: input.consents,
        submitterEmail: input.submitterEmail,
        searchText: input.searchText,
        customerAccountId: input.owner.customerAccountId,
        organizationId: input.owner.organizationId,
      });
      return {
        result: { entryId, submittedAt: entry.submittedAt },
        before: null,
        after: {
          formId: input.formId,
          formVersion: input.versionNumber,
          salesChannelId: input.salesChannelId,
          language: input.language,
          status: entry.status,
          attributed: input.owner.organizationId !== null,
        },
      };
    },
    event: (result) => submittedEvent(input, result),
  };
}

/**
 * `forms.entry.submitted.v1` — the domain event and the webhook payload (events-and-webhook.md §1):
 * the envelope of the entry and its shared answers, never a note, a recipient, a consent text, the
 * submitter's address (unless its field is shared), the owner's account or the search text.
 */
function submittedEvent(input: SubmitEntryInput, result: SubmittedEntry): CommandEvent<FormEntrySubmittedEventV1> {
  return {
    eventName: FORMS_EVENTS.ENTRY_SUBMITTED,
    payload: {
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      eventType: FORMS_EVENTS.ENTRY_SUBMITTED,
      entryId: result.entryId,
      formId: input.formId,
      formKey: input.formKey,
      formVersion: input.versionNumber,
      salesChannelId: input.salesChannelId,
      organizationId: input.owner.organizationId,
      language: input.language,
      pageUrl: input.pageUrl,
      submittedAt: result.submittedAt.toISOString(),
      answers: input.sharedAnswers,
    },
  };
}
