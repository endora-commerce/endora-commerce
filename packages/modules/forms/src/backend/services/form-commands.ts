import { LockMode } from '@mikro-orm/core';
import {
  ERROR_CODES,
  FORMS_EVENTS,
  definitionIssues,
  slugify,
  type FormChangedEvent,
  type FormDefinition,
} from '@endora-commerce/contracts';
import type { Command, CommandContext, CommandEvent } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { getTenantContext, withSystemScope } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import { Form } from '../entities/form.entity.js';
import { FormEntry } from '../entities/form-entry.entity.js';
import { FormVersion } from '../entities/form-version.entity.js';
import {
  formDefinitionInvalid,
  formHasEntries,
  formKeyTaken,
  formNotFound,
  formRevisionConflict,
  formScopeRequired,
} from './forms-errors.js';

/**
 * The Commands every write of a form runs (`specs/170-forms-module/` data-model §8, Constitution
 * XIII) — one action per kind of change, each with its own audit row and, where the public read
 * changes, `forms.form.changed` on commit (FR-063):
 *
 * | Action | Event |
 * | --- | --- |
 * | `forms.form.create` | — |
 * | `forms.form.update` (name, key, default language, working copy) | — |
 * | `forms.form.publish` | `forms.form.changed` |
 * | `forms.form.close` / `forms.form.reopen` | `forms.form.changed` |
 * | `forms.form.duplicate` | — |
 * | `forms.form.delete` | `forms.form.changed` |
 * | `forms.form.recipients_update` | — (recipients are never in the public read, FR-056) |
 *
 * **Audit states carry no operator text** (FR-053, FR-055): ids, the key, the status, the revision,
 * version numbers and counts — never the name, a label or any other text of the definition. The
 * audit trail is not tenant-scoped, and a text may hold whatever its writer typed.
 *
 * Every write but create and duplicate names the revision it acts on (`expectedRevision`, R-26) and
 * re-reads the row under a lock, so of two writes of one revision the second is refused with 409
 * `FORM_REVISION_CONFLICT` rather than overwriting the first.
 */

type Em = CommandContext['em'];

/** A form as its audit state records it. */
export function formAuditState(form: Form): Record<string, unknown> {
  return {
    key: form.key,
    status: form.status,
    revision: form.revision,
    defaultLanguage: form.defaultLanguage,
    publishedVersionNumber: form.publishedVersionNumber,
    sectionCount: form.definition.sections.length,
    fieldCount: form.definition.sections.reduce((n, section) => n + section.fields.length, 0),
  };
}

function changedEvent(formId: string): CommandEvent<FormChangedEvent> {
  return {
    eventName: FORMS_EVENTS.FORM_CHANGED,
    payload: { eventId: randomUUID(), occurredAt: new Date().toISOString(), formId },
  };
}

/** One form, locked for the Command's transaction; 404 when it is gone. */
async function lockedForm(em: Em, id: string): Promise<Form> {
  const form = await em.findOne(Form, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
  if (!form) throw formNotFound();
  return form;
}

/** The locked form at the revision the caller named, else 409 `FORM_REVISION_CONFLICT`. */
async function lockedAt(em: Em, id: string, expectedRevision: number): Promise<Form> {
  const form = await lockedForm(em, id);
  if (form.revision !== expectedRevision) throw formRevisionConflict();
  return form;
}

/** 409 `FORM_KEY_TAKEN` when another form holds `key`. */
async function assertKeyFree(em: Em, key: string, exceptId: string | null): Promise<void> {
  const holder = await em.findOne(Form, { key }, { fields: ['id'] });
  if (holder && holder.id !== exceptId) throw formKeyTaken(key);
}

/** A key built from a name: lower-case ASCII, `_` between words, starting with a letter (R-4). */
export function keyFromName(name: string): string {
  const ascii = slugify(name, { separator: '_' });
  const lettered = ascii === '' ? 'form' : /^[a-z]/.test(ascii) ? ascii : `form_${ascii}`;
  return lettered.slice(0, 64).replace(/_+$/g, '');
}

/**
 * The first of `base`, `base_2`, `base_3`, … no form holds — the derived key of create and
 * duplicate. The unique index stays the last word on a race (mapped to `FORM_KEY_TAKEN` by the
 * service).
 */
async function freeKey(em: Em, base: string): Promise<string> {
  const rows = (await em.getConnection().execute(`select "key" from "forms" where "key" like ?`, [
    `${base.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
  ])) as Array<{ key: string }>;
  const taken = new Set(rows.map((row) => row.key));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`;
    const candidate = `${base.slice(0, 64 - suffix.length).replace(/_+$/g, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** A new form's working copy: one empty one-column section, the neutral behaviour (US1-1). */
export function emptyDefinition(sectionId: string, defaultLanguage: string, name: string): FormDefinition {
  return {
    schemaVersion: 1,
    sections: [{ id: sectionId, columns: 1, fields: [] }],
    behaviour: {
      confirmation: { type: 'message' },
      captchaRequired: false,
      confirmationEmail: { enabled: false, includeSummary: false },
    },
    restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
    texts: { [defaultLanguage]: { 'form.title': name } },
  };
}

/** `forms.form.create` — the result is the new form's id. */
export function createFormCommand(input: {
  readonly name: string;
  readonly key?: string | undefined;
  readonly defaultLanguage: string;
}): Command<string> {
  const id = randomUUID();
  return {
    action: 'forms.form.create',
    objectType: 'form',
    objectId: id,
    run: async ({ em, actor }) => {
      let key: string;
      if (input.key !== undefined) {
        await assertKeyFree(em, input.key, null);
        key = input.key;
      } else {
        key = await freeKey(em, keyFromName(input.name));
      }
      const form = em.create(Form, {
        id,
        key,
        name: input.name,
        defaultLanguage: input.defaultLanguage,
        definition: emptyDefinition(`section_${randomUUID().slice(0, 8)}`, input.defaultLanguage, input.name),
        createdByAdminUserId: actor.actorAdminUserId,
        updatedByAdminUserId: actor.actorAdminUserId,
      });
      return { result: id, before: null, after: formAuditState(form) };
    },
  };
}

export interface FormChanges {
  readonly name?: string | undefined;
  readonly key?: string | undefined;
  readonly defaultLanguage?: string | undefined;
  /** Shape-validated by the route; the publish rules are not asked here (FR-011). */
  readonly definition?: FormDefinition | undefined;
}

/** `forms.form.update` — the working copy and the live identity; the served version is untouched (FR-009). */
export function updateFormCommand(id: string, expectedRevision: number, changes: FormChanges): Command<void> {
  return {
    action: 'forms.form.update',
    objectType: 'form',
    objectId: id,
    run: async ({ em, actor }) => {
      const form = await lockedAt(em, id, expectedRevision);
      const before = formAuditState(form);
      if (changes.key !== undefined && changes.key !== form.key) {
        await assertKeyFree(em, changes.key, id);
        form.key = changes.key;
      }
      if (changes.name !== undefined) form.name = changes.name;
      if (changes.defaultLanguage !== undefined) form.defaultLanguage = changes.defaultLanguage;
      if (changes.definition !== undefined) form.definition = changes.definition;
      form.revision += 1;
      form.updatedByAdminUserId = actor.actorAdminUserId;
      return { result: undefined, before, after: formAuditState(form) };
    },
  };
}

/**
 * `forms.form.publish` — freezes the working copy as the next immutable version (FR-009, FR-010),
 * after `definitionIssues` finds nothing (FR-011, FR-033). A draft becomes published; a closed form
 * stays closed — reopening is explicit (data-model §1). An earlier version row is never written.
 */
export function publishFormCommand(id: string, expectedRevision: number): Command<void> {
  return {
    action: 'forms.form.publish',
    objectType: 'form',
    objectId: id,
    run: async ({ em, actor }) => {
      const form = await lockedAt(em, id, expectedRevision);
      const issues = definitionIssues(form.definition, form.defaultLanguage);
      if (issues.length > 0) throw formDefinitionInvalid(issues);
      const before = formAuditState(form);
      const version = em.create(FormVersion, {
        formId: id,
        number: form.publishedVersionNumber + 1,
        definition: structuredClone(form.definition),
        defaultLanguage: form.defaultLanguage,
        publishedByAdminUserId: actor.actorAdminUserId,
      });
      // The form names the version (an immediate foreign key): the version row is written first.
      await em.flush();
      form.publishedVersionId = version.id;
      form.publishedVersionNumber = version.number;
      if (form.status === 'draft') form.status = 'published';
      form.revision += 1;
      form.updatedByAdminUserId = actor.actorAdminUserId;
      return { result: undefined, before, after: { ...formAuditState(form), versionId: version.id } };
    },
    event: () => changedEvent(id),
  };
}

/** Each address once, compared without case, in the order given. */
function uniqueAddresses(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of list) {
    const address = raw.trim();
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    unique.push(address);
  }
  return unique;
}

/** The recipients as an audit state records them: how many, per channel — never an address. */
function recipientsAuditState(form: Form): Record<string, unknown> {
  return {
    revision: form.revision,
    recipientCount: form.recipients.length,
    channelRecipientCounts: Object.fromEntries(Object.entries(form.channelRecipients).map(([id, list]) => [id, list.length])),
  };
}

/**
 * `forms.form.recipients_update` — the default list and the per-channel lists of the shop
 * notification (FR-056, A-2), **live**: effective for the next entry without a publish, and never
 * part of a version (research R-3). A channel's list replaces the default on that channel; an empty
 * one stops the notification there. The audit state counts addresses and never names one.
 */
export function updateRecipientsCommand(
  id: string,
  expectedRevision: number,
  input: { readonly recipients: readonly string[]; readonly channelRecipients: Readonly<Record<string, readonly string[]>> },
): Command<void> {
  return {
    action: 'forms.form.recipients_update',
    objectType: 'form',
    objectId: id,
    run: async ({ em, actor }) => {
      const form = await lockedAt(em, id, expectedRevision);
      const before = recipientsAuditState(form);
      form.recipients = uniqueAddresses(input.recipients);
      form.channelRecipients = Object.fromEntries(
        Object.entries(input.channelRecipients).map(([channelId, list]) => [channelId, uniqueAddresses(list)]),
      );
      form.revision += 1;
      form.updatedByAdminUserId = actor.actorAdminUserId;
      return { result: undefined, before, after: recipientsAuditState(form) };
    },
  };
}

/** A status move the form cannot make from where it is (close a draft, reopen an open form). */
function notAMove(): HttpError {
  return new HttpError(409, ERROR_CODES.INVALID_TRANSITION, 'The form cannot make this change from its current status.');
}

/** `forms.form.close` (from published) and `forms.form.reopen` (from closed) — FR-008, US1-7. */
export function moveFormCommand(id: string, expectedRevision: number, to: 'closed' | 'published'): Command<void> {
  const from = to === 'closed' ? 'published' : 'closed';
  return {
    action: to === 'closed' ? 'forms.form.close' : 'forms.form.reopen',
    objectType: 'form',
    objectId: id,
    run: async ({ em, actor }) => {
      const form = await lockedAt(em, id, expectedRevision);
      if (form.status !== from) throw notAMove();
      const before = formAuditState(form);
      form.status = to;
      form.revision += 1;
      form.updatedByAdminUserId = actor.actorAdminUserId;
      return { result: undefined, before, after: formAuditState(form) };
    },
    event: () => changedEvent(id),
  };
}

/**
 * `forms.form.duplicate` — a new draft with the source's working copy and a suffixed key (FR-014);
 * no versions, no entries, no recipients beyond the source's. The result is the copy's id.
 */
export function duplicateFormCommand(sourceId: string, name: string | undefined): Command<string> {
  const id = randomUUID();
  return {
    action: 'forms.form.duplicate',
    objectType: 'form',
    objectId: id,
    run: async ({ em, actor }) => {
      const source = await em.findOne(Form, { id: sourceId });
      if (!source) throw formNotFound();
      const copy = em.create(Form, {
        id,
        key: await freeKey(em, `${source.key.slice(0, 59)}_copy`),
        name: name ?? source.name,
        defaultLanguage: source.defaultLanguage,
        definition: structuredClone(source.definition),
        recipients: [...source.recipients],
        channelRecipients: structuredClone(source.channelRecipients),
        retentionDays: source.retentionDays ?? null,
        createdByAdminUserId: actor.actorAdminUserId,
        updatedByAdminUserId: actor.actorAdminUserId,
      });
      return { result: id, before: null, after: { ...formAuditState(copy), sourceFormId: sourceId } };
    },
  };
}

/**
 * `forms.form.delete` (FR-013): the form, its versions and — confirmed — its entries and their notes
 * go, by the foreign keys' cascade.
 *
 * Entries are counted across every organisation (`withSystemScope`, the sanctioned widening): the
 * cascade removes every one of them whoever owns it, so whether the form "has entries" cannot be a
 * scoped question. Without `confirmEntriesDeletion` a form with entries is refused with 409
 * `FORM_HAS_ENTRIES`, its `entryCount` the caller's own scope's count. With it the caller must also
 * be unrestricted (`getTenantContext().mode === 'all'`), else 403 `FORM_SCOPE_REQUIRED` — a write
 * that crosses tenants by construction is no scoped administrator's (research Principle XI review).
 * The route has already asked for `forms:entries_write` when the confirmation is given.
 */
export function deleteFormCommand(id: string, expectedRevision: number, confirmEntriesDeletion = false): Command<void> {
  return {
    action: 'forms.form.delete',
    objectType: 'form',
    objectId: id,
    run: async ({ em }) => {
      const form = await lockedAt(em, id, expectedRevision);
      const anywhere = await withSystemScope('forms: a form with entries is not deleted without confirmation', () =>
        em.count(FormEntry, { formId: id }),
      );
      if (anywhere > 0) {
        if (!confirmEntriesDeletion) throw formHasEntries(await em.count(FormEntry, { formId: id }));
        if (getTenantContext()?.mode !== 'all') throw formScopeRequired();
      }
      const before = { ...formAuditState(form), deletedEntryCount: anywhere };
      em.remove(form);
      return { result: undefined, before, after: null };
    },
    event: () => changedEvent(id),
  };
}

/**
 * `forms.form.retention_update` (FR-054, A-2) — the form's retention period, **live**: the next
 * maintenance tick deletes by it, without a publish, and it is never part of a version. `null`
 * keeps every entry. The deletion it schedules removes entries of every organisation, so the caller
 * must be unrestricted (`getTenantContext().mode === 'all'`), else 403 `FORM_SCOPE_REQUIRED`
 * (research Principle XI review); the route has asked for `forms:write` and `forms:entries_write`.
 */
export function updateRetentionCommand(id: string, expectedRevision: number, retentionDays: number | null): Command<void> {
  return {
    action: 'forms.form.retention_update',
    objectType: 'form',
    objectId: id,
    run: async ({ em, actor }) => {
      if (getTenantContext()?.mode !== 'all') throw formScopeRequired();
      const form = await lockedAt(em, id, expectedRevision);
      const before = { revision: form.revision, retentionDays: form.retentionDays ?? null };
      form.retentionDays = retentionDays;
      form.revision += 1;
      form.updatedByAdminUserId = actor.actorAdminUserId;
      return { result: undefined, before, after: { revision: form.revision, retentionDays } };
    },
  };
}
