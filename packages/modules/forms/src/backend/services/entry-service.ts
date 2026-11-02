import { AsyncResource } from 'node:async_hooks';
import {
  ERROR_CODES,
  resolveTexts,
  type FormEntryDetail,
  type FormEntryListQuery,
  type FormEntryStatus,
  type FormEntrySummary,
  type FormFieldType,
} from '@endora-commerce/contracts';
import type { Command, CommandBus, CommandContext } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelResolutionPort } from '@endora-commerce/platform/kernel';
import { Form } from '../entities/form.entity.js';
import { FormEntry } from '../entities/form-entry.entity.js';
import { FormEntryNote } from '../entities/form-entry-note.entity.js';
import { FormVersion } from '../entities/form-version.entity.js';
import {
  addEntryNoteCommand,
  changeEntryStatusCommand,
  deleteEntriesCommand,
  deleteEntryCommand,
  markEntryReadCommand,
} from './entry-commands.js';
import { entriesCsv, exportColumns, type ExportCursor, type ExportEntry } from './entry-export.js';
import { formEntryNotFound, formNotFound } from './forms-errors.js';

/**
 * The entries of the admin API (`specs/170-forms-module/` contracts/admin-api.md §2, User Story 4,
 * research R-16, R-18).
 *
 * **Every read goes through the tenancy guard** — `FormEntry` is `@CustomerScoped` and nothing here
 * widens it: an unrestricted administrator reads every entry, anonymous ones included; one confined
 * to some organisations reads theirs and no anonymous one; an entry they may not read is not found,
 * on every route, with the body a missing id gets (FR-046).
 *
 * **The list** is newest first and pages by a keyset on `(submitted_at, id)` — an entry arriving
 * between two pages moves nothing — filtered by form, statuses, a submission window, channel and a
 * case-insensitive substring of the submitter's e-mail or the text answers (`search_text`, the
 * trigram indexes). Entries are stamped by the submit Command with a JavaScript date, so a cursor
 * holds the exact time.
 *
 * **The detail** is told in the labels of the version the entry was sent to, in that version's
 * order, so a field renamed or removed since is still shown as the shopper saw it (US1-6). `GET`
 * has no side effect: opening the screen marks the entry read through its own route.
 *
 * **The export** is audited as one Command naming the filter and the row count, then streamed in
 * batches of 500 under the request's tenant context (`entry-export.ts`).
 */

type Em = CommandContext['em'];

export interface EntryServiceDeps {
  readonly emFactory: () => Em;
  readonly commandBus: CommandBus;
  /** `sales_channels` — the channel codes the export names its rows by. */
  readonly channels: SalesChannelResolutionPort;
}

export interface EntryFilter {
  readonly formId?: string | undefined;
  readonly status?: readonly FormEntryStatus[] | undefined;
  readonly submittedFrom?: string | undefined;
  readonly submittedTo?: string | undefined;
  readonly salesChannelId?: string | undefined;
  readonly q?: string | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id names no entry: the same 404 as a missing one. */
function entryId(id: string): string {
  if (!UUID.test(id)) throw formEntryNotFound();
  return id;
}

/** `%`, `_` and `\` are the caller's letters, not wildcards. */
function likePattern(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/** The guard-scoped conditions of a filter (the keyset is added by the caller). */
function whereOf(filter: EntryFilter): Record<string, unknown>[] {
  const and: Record<string, unknown>[] = [];
  if (filter.formId) and.push({ formId: filter.formId });
  if (filter.status && filter.status.length > 0) and.push({ status: { $in: [...filter.status] } });
  if (filter.submittedFrom) and.push({ submittedAt: { $gte: new Date(filter.submittedFrom) } });
  if (filter.submittedTo) and.push({ submittedAt: { $lte: new Date(filter.submittedTo) } });
  if (filter.salesChannelId) and.push({ salesChannelId: filter.salesChannelId });
  if (filter.q && filter.q.trim() !== '') {
    const pattern = likePattern(filter.q.trim());
    and.push({ $or: [{ submitterEmail: { $ilike: pattern } }, { searchText: { $ilike: pattern } }] });
  }
  return and;
}

/** Entries strictly after `cursor` in `(submitted_at desc, id desc)` order. */
function after(cursor: ExportCursor): Record<string, unknown> {
  return { $or: [{ submittedAt: { $lt: cursor.submittedAt } }, { submittedAt: cursor.submittedAt, id: { $lt: cursor.id } }] };
}

function encodeCursor(cursor: ExportCursor): string {
  return Buffer.from(JSON.stringify([cursor.submittedAt.toISOString(), cursor.id])).toString('base64url');
}

function decodeCursor(raw: string): ExportCursor {
  try {
    const [at, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as [unknown, unknown];
    const submittedAt = typeof at === 'string' ? new Date(at) : new Date(Number.NaN);
    if (typeof id === 'string' && UUID.test(id) && !Number.isNaN(submittedAt.getTime())) return { submittedAt, id };
  } catch {
    // Fall through to the refusal.
  }
  throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The page cursor is not valid.', {
    fields: [{ field: 'cursor', code: 'invalid' }],
  });
}

/** A consent's label: its shown text without markup. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The filter as its audit state records it: the values the caller chose, never a result. */
function filterAuditState(filter: EntryFilter): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  if (filter.status && filter.status.length > 0) state['status'] = [...filter.status];
  if (filter.submittedFrom) state['submittedFrom'] = filter.submittedFrom;
  if (filter.submittedTo) state['submittedTo'] = filter.submittedTo;
  if (filter.salesChannelId) state['salesChannelId'] = filter.salesChannelId;
  if (filter.q) state['q'] = filter.q;
  return state;
}

export class EntryService {
  constructor(private readonly deps: EntryServiceDeps) {}

  async list(query: FormEntryListQuery): Promise<{ items: FormEntrySummary[]; nextCursor: string | null }> {
    const em = this.deps.emFactory();
    const and = whereOf(query);
    if (query.cursor) and.push(after(decodeCursor(query.cursor)));
    const rows = await em.find(FormEntry, and.length > 0 ? { $and: and } : {}, {
      orderBy: { submittedAt: 'desc', id: 'desc' },
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const names = await this.#formNames(em, page.map((entry) => entry.formId));
    const last = page[page.length - 1];
    return {
      items: page.map((entry) => this.#summary(entry, names)),
      nextCursor: rows.length > query.limit && last ? encodeCursor({ submittedAt: last.submittedAt, id: last.id }) : null,
    };
  }

  async detail(id: string): Promise<FormEntryDetail> {
    const em = this.deps.emFactory();
    const entry = await em.findOne(FormEntry, { id: entryId(id) });
    if (!entry) throw formEntryNotFound();
    return this.#detail(em, entry);
  }

  async markRead(id: string): Promise<FormEntryDetail> {
    await this.deps.commandBus.run(markEntryReadCommand(entryId(id)));
    return this.detail(id);
  }

  async changeStatus(id: string, status: FormEntryStatus, expectedStatus: FormEntryStatus): Promise<FormEntryDetail> {
    await this.deps.commandBus.run(changeEntryStatusCommand(entryId(id), status, expectedStatus));
    return this.detail(id);
  }

  async addNote(id: string, body: string): Promise<FormEntryDetail['notes'][number]> {
    const note = await this.deps.commandBus.run(addEntryNoteCommand(entryId(id), body));
    return { id: note.id, body: note.body, authorAdminUserId: note.authorAdminUserId, createdAt: note.createdAt.toISOString() };
  }

  async delete(id: string): Promise<void> {
    await this.deps.commandBus.run(deleteEntryCommand(entryId(id)));
  }

  async deleteMany(ids: readonly string[]): Promise<{ deleted: number }> {
    return this.deps.commandBus.run(deleteEntriesCommand(ids));
  }

  /**
   * `GET …/forms/entries/export` — one form's entries as CSV (R-18). The Command audits the filter
   * and how many rows the caller's scope holds; the rows are then read batch by batch as the client
   * takes them, each read bound to this request's async context so the guard scopes it as it scoped
   * the count.
   */
  async export(filter: EntryFilter & { formId: string }): Promise<{ filename: string; chunks: AsyncIterable<string> }> {
    const em = this.deps.emFactory();
    const form = await em.findOne(Form, { id: filter.formId });
    if (!form) throw formNotFound();
    const versions = await em.find(FormVersion, { formId: form.id }, { orderBy: { number: 'asc' } });
    await this.deps.commandBus.run(exportEntriesCommand(form.id, filter));
    const channels = new Map((await this.deps.channels.listAll()).map((channel) => [channel.id, channel.code]));
    const conditions = whereOf(filter);
    const readBatch = AsyncResource.bind(async (cursor: ExportCursor | null, size: number): Promise<ExportEntry[]> => {
      // A fresh manager per batch: the identity map holds one batch, never the whole export.
      const batchEm = this.deps.emFactory();
      const and = cursor ? [...conditions, after(cursor)] : conditions;
      const rows = await batchEm.find(FormEntry, { $and: and }, { orderBy: { submittedAt: 'desc', id: 'desc' }, limit: size });
      return rows.map((entry) => ({
        id: entry.id,
        formVersionNumber: entry.formVersionNumber,
        status: entry.status,
        salesChannelId: entry.salesChannelId,
        language: entry.language,
        submittedAt: entry.submittedAt,
        pageUrl: entry.pageUrl,
        answers: entry.answers,
      }));
    });
    return {
      filename: `form-${form.key}-entries.csv`,
      chunks: entriesCsv({
        columns: exportColumns(versions.map((version) => ({ number: version.number, definition: version.definition }))),
        formKey: form.key,
        channelLabel: (id) => channels.get(id) ?? id,
        readBatch,
      }),
    };
  }

  async #formNames(em: Em, ids: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const forms = await em.find(Form, { id: { $in: unique } }, { fields: ['id', 'name'] });
    return new Map(forms.map((form) => [form.id, form.name]));
  }

  #summary(entry: FormEntry, names: ReadonlyMap<string, string>): FormEntrySummary {
    return {
      id: entry.id,
      formId: entry.formId,
      formName: names.get(entry.formId) ?? '',
      formVersion: entry.formVersionNumber,
      status: entry.status,
      salesChannelId: entry.salesChannelId,
      language: entry.language,
      submittedAt: entry.submittedAt.toISOString(),
      submitterEmail: entry.submitterEmail ?? null,
      attributed: entry.organizationId !== null && entry.organizationId !== undefined,
    };
  }

  async #detail(em: Em, entry: FormEntry): Promise<FormEntryDetail> {
    const [names, version, notes] = await Promise.all([
      this.#formNames(em, [entry.formId]),
      em.findOne(FormVersion, { id: entry.formVersionId }),
      em.find(FormEntryNote, { entryId: entry.id }, { orderBy: { createdAt: 'asc', id: 'asc' } }),
    ]);
    const answers: FormEntryDetail['answers'] = [];
    const told = new Set<string>();
    if (version) {
      const text = resolveTexts(version.definition, version.defaultLanguage, version.defaultLanguage);
      for (const section of version.definition.sections) {
        for (const field of section.fields) {
          if (!('key' in field) || !Object.prototype.hasOwnProperty.call(entry.answers, field.key)) continue;
          const content = text(`fields.${field.id}.content`);
          const label = text(`fields.${field.id}.label`) ?? (content ? plainText(content) : undefined) ?? field.key;
          answers.push({ fieldKey: field.key, label, type: field.type, value: entry.answers[field.key]! });
          told.add(field.key);
        }
      }
    }
    // An answer the version does not name (never expected) is still shown, by its key.
    for (const [key, value] of Object.entries(entry.answers)) {
      if (!told.has(key)) answers.push({ fieldKey: key, label: key, type: 'text' satisfies FormFieldType, value });
    }
    return {
      ...this.#summary(entry, names),
      pageUrl: entry.pageUrl ?? null,
      answers,
      consents: entry.consents,
      customerAccountId: entry.customerAccountId ?? null,
      organizationId: entry.organizationId ?? null,
      notes: notes.map((note) => ({
        id: note.id,
        body: note.body,
        authorAdminUserId: note.authorAdminUserId ?? null,
        createdAt: note.createdAt.toISOString(),
      })),
    };
  }
}

/**
 * `forms.entries.export` — the audit of an export (FR-053): the form, the filter the caller chose
 * and how many rows their scope holds; never a value of any row.
 */
function exportEntriesCommand(formId: string, filter: EntryFilter): Command<number> {
  return {
    action: 'forms.entries.export',
    objectType: 'form',
    objectId: formId,
    run: async ({ em }) => {
      const rowCount = await em.count(FormEntry, { $and: whereOf({ ...filter, formId }) });
      return { result: rowCount, before: null, after: { formId, filter: filterAuditState(filter), rowCount } };
    },
  };
}
