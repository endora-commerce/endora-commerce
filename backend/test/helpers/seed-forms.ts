import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { formDetailSchema, type FormDefinitionInput, type FormDetail } from '@endora-commerce/contracts';
import { withSystemScope } from '../../src/tenancy/escape-hatch.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Fixtures shared by the `forms` entries tests (`specs/170-forms-module/` User Story 4): a published
 * form made through the admin API — so its versions are the module's own — and entries written
 * straight into `form_entries` under the system scope, so a test can name their owner, channel,
 * status and time.
 *
 * **Entry times are whole milliseconds**, as the submit Command writes them (`new Date()`): the
 * entries list pages by `(submitted_at, id)` and a cursor carries a JavaScript date.
 */

export const FORMS_ADMIN = { b2b_session: 'stub-admin-session' };
export const FORMS_LANGUAGE = 'en-US';

function detailOf(response: LightMyRequestResponse): FormDetail {
  if (response.statusCode >= 300) throw new Error(`[seed-forms] ${response.statusCode} ${response.body}`);
  return formDetailSchema.parse((response.json() as { data: unknown }).data);
}

/** A definition the publish rules accept: name, e-mail (the submitter's), message and a consent. */
export interface EntriesDefinitionVariant {
  /** The name field's label in this version. */
  readonly label?: string;
  readonly withPhone?: boolean;
  /** Leave the message field out of this version (a field removed later). */
  readonly withoutMessage?: boolean;
}

export function entriesDefinition(sectionId: string, extra: EntriesDefinitionVariant = {}): FormDefinitionInput {
  return {
    schemaVersion: 1,
    sections: [
      {
        id: sectionId,
        columns: 1,
        fields: [
          { id: 'f_name', type: 'text', key: 'name', required: true },
          { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
          ...(extra.withoutMessage ? [] : [{ id: 'f_msg', type: 'textarea' as const, key: 'message' }]),
          { id: 'f_addr', type: 'address', key: 'address', parts: {
            street: { enabled: true, required: false },
            line2: { enabled: false, required: false },
            postalCode: { enabled: true, required: false },
            city: { enabled: true, required: false },
            country: { enabled: true, required: false },
          } },
          {
            id: 'f_tags',
            type: 'checkboxes',
            key: 'tags',
            options: [
              { id: 'o1', value: 'doors' },
              { id: 'o2', value: 'windows' },
            ],
          },
          { id: 'f_privacy', type: 'privacy_consent', key: 'privacy', required: true },
          ...(extra.withPhone ? [{ id: 'f_phone', type: 'phone' as const, key: 'phone' }] : []),
        ],
      },
    ],
    behaviour: {
      confirmation: { type: 'message' },
      captchaRequired: false,
      confirmationEmail: { enabled: false, includeSummary: false },
    },
    restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
    texts: {
      [FORMS_LANGUAGE]: {
        'fields.f_name.label': extra.label ?? 'Name',
        'fields.f_mail.label': 'E-mail',
        'fields.f_msg.label': 'Message',
        'fields.f_addr.label': 'Address',
        'fields.f_tags.label': 'Interests',
        'fields.f_privacy.content': '<p>I accept the privacy policy</p>',
        'fields.f_phone.label': 'Phone',
      },
    },
  };
}

export interface PublishedForm {
  readonly detail: FormDetail;
  /** Version number → version id. */
  readonly versions: ReadonlyMap<number, string>;
}

/** Create, save and publish a form through the admin API; optionally publish a second version. */
export async function publishEntriesForm(
  h: BackendServerHandle,
  name: string,
  options: { secondVersion?: EntriesDefinitionVariant } = {},
): Promise<PublishedForm> {
  const call = (method: 'POST' | 'PUT', path: string, payload: unknown) =>
    h.app.inject({ method, url: `/api/v1/admin/forms${path}`, cookies: FORMS_ADMIN, payload: payload as Record<string, unknown> });
  let form = detailOf(await call('POST', '', { name, defaultLanguage: FORMS_LANGUAGE }));
  const sectionId = form.definition.sections[0]!.id;
  form = detailOf(await call('PUT', `/${form.id}`, { expectedRevision: form.revision, definition: entriesDefinition(sectionId) }));
  form = detailOf(await call('POST', `/${form.id}/publish`, { expectedRevision: form.revision }));
  if (options.secondVersion) {
    form = detailOf(
      await call('PUT', `/${form.id}`, {
        expectedRevision: form.revision,
        definition: entriesDefinition(sectionId, options.secondVersion),
      }),
    );
    form = detailOf(await call('POST', `/${form.id}/publish`, { expectedRevision: form.revision }));
  }
  const rows = (await h
    .em()
    .getConnection()
    .execute(`select "id", "number" from "form_versions" where "form_id" = ?`, [form.id])) as Array<{ id: string; number: number }>;
  return { detail: form, versions: new Map(rows.map((row) => [row.number, row.id])) };
}

export interface SeedEntry {
  readonly form: PublishedForm;
  readonly version?: number;
  readonly id?: string;
  readonly status?: 'new' | 'read' | 'closed' | 'spam';
  readonly salesChannelId: string;
  readonly language?: string;
  readonly submittedAt: Date;
  readonly answers?: Record<string, unknown>;
  readonly consents?: Array<{ fieldKey: string; kind: string; given: boolean; text: string }>;
  readonly submitterEmail?: string | null;
  readonly searchText?: string;
  readonly pageUrl?: string | null;
  readonly owner?: { customerAccountId: string; organizationId: string } | null;
}

/** One entry written as the submit Command would have, with the counter moved for a non-spam one. */
export async function insertFormEntry(h: BackendServerHandle, entry: SeedEntry): Promise<string> {
  const id = entry.id ?? randomUUID();
  const version = entry.version ?? 1;
  const status = entry.status ?? 'new';
  await withSystemScope('forms entries test: seed an entry', async () => {
    const connection = h.em().getConnection();
    await connection.execute(
      `insert into "form_entries"
         ("id", "form_id", "form_version_id", "form_version_number", "sales_channel_id", "language", "page_url",
          "submitted_at", "answers", "consents", "submitter_email", "search_text", "status",
          "customer_account_id", "organization_id")
       values (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.form.detail.id,
        entry.form.versions.get(version)!,
        version,
        entry.salesChannelId,
        entry.language ?? FORMS_LANGUAGE,
        entry.pageUrl ?? null,
        new Date(Math.floor(entry.submittedAt.getTime())).toISOString(),
        JSON.stringify(entry.answers ?? {}),
        JSON.stringify(entry.consents ?? []),
        entry.submitterEmail ?? null,
        entry.searchText ?? '',
        status,
        entry.owner?.customerAccountId ?? null,
        entry.owner?.organizationId ?? null,
      ],
    );
    if (status !== 'spam') {
      await connection.execute(`update "forms" set "accepted_entry_count" = "accepted_entry_count" + 1 where "id" = ?`, [
        entry.form.detail.id,
      ]);
    }
  });
  return id;
}

/** Remove the forms a test created; entries and notes go by cascade. */
export async function deleteForms(h: BackendServerHandle, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await withSystemScope('forms entries test: clean up', async () => {
    await h
      .em()
      .getConnection()
      .execute(`delete from "forms" where "id" = any(?::uuid[])`, [`{${ids.join(',')}}`]);
  });
}

/** A row of `form_entries` / the form's counter, read past the guard. */
export async function readEntryRow(h: BackendServerHandle, id: string): Promise<Record<string, unknown> | undefined> {
  return withSystemScope('forms entries test: read an entry as stored', async () => {
    const rows = (await h.em().getConnection().execute(`select * from "form_entries" where "id" = ?`, [id])) as Array<
      Record<string, unknown>
    >;
    return rows[0];
  });
}

export async function acceptedEntryCount(h: BackendServerHandle, formId: string): Promise<number> {
  const rows = (await h
    .em()
    .getConnection()
    .execute(`select "accepted_entry_count" as "n" from "forms" where "id" = ?`, [formId])) as Array<{ n: number }>;
  return rows[0]!.n;
}

/** The audit rows the Commands wrote, oldest first. */
export async function auditRows(
  h: BackendServerHandle,
  filter: { objectType?: string; objectId?: string; action?: string },
): Promise<Array<{ action: string; objectId: string; stateBefore?: unknown; stateAfter?: unknown }>> {
  return (await h.auditLogService.query(filter)).reverse();
}
