import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formEntryDetailSchema,
  formEntryListResponseSchema,
  type FormEntryDetail,
  type FormEntrySummary,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  FORMS_ADMIN,
  acceptedEntryCount,
  auditRows,
  deleteForms,
  insertFormEntry,
  publishEntriesForm,
  readEntryRow,
  type PublishedForm,
} from '../../helpers/seed-forms.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * `specs/170-forms-module/` T071 — User Story 4: employees filter, search, open, annotate, classify
 * and delete entries (US4-1…US4-7, FR-048 – FR-053, research R-16, R-18).
 *
 * Entries are seeded across two forms, two channels, every status and a spread of times; the list
 * filters each way and pages by a keyset that an insert does not disturb; the detail is told in the
 * labels of the version the entry was sent to; opening it marks it read once, the status moves any
 * way with an *Undo* that refuses when the entry moved meanwhile, notes are kept with their author,
 * deletes take the notes with them, spam moves the form's counter, and every write is one audit row
 * that holds no answer.
 */
describe('forms — read and process entries (US4)', () => {
  let h: BackendServerHandle;
  const API = '/api/v1/admin/forms/entries';
  const RUN = randomUUID().slice(0, 8);
  const SENTINEL = `sentinel-${RUN}`;
  const created: string[] = [];
  let contact: PublishedForm;
  let survey: PublishedForm;
  let defaultChannel: string;
  let otherChannel: string;
  const base = Date.UTC(2026, 9, 1, 12, 0, 0);
  const at = (minutes: number) => new Date(base + minutes * 60_000);
  const seeded: Record<string, string> = {};

  function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies: FORMS_ADMIN,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function list(query: string): Promise<{ items: FormEntrySummary[]; nextCursor: string | null }> {
    const response = await call('GET', query);
    expect(response.statusCode, response.body).toBe(200);
    return formEntryListResponseSchema.parse((response.json() as { data: unknown }).data);
  }

  async function detail(id: string): Promise<FormEntryDetail> {
    const response = await call('GET', `/${id}`);
    expect(response.statusCode, response.body).toBe(200);
    return formEntryDetailSchema.parse((response.json() as { data: unknown }).data);
  }

  const idsOf = (page: { items: FormEntrySummary[] }) => page.items.map((item) => item.id);

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em().fork();
    defaultChannel = (await em.findOneOrFail(SalesChannel, { code: 'default' })).id;
    const channel = em.create(SalesChannel, {
      code: `forms-entries-${RUN}`,
      name: { 'en-US': `Forms entries ${RUN}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    otherChannel = channel.id;

    // Version 2 relabels the name and drops the message field.
    contact = await publishEntriesForm(h, `Contact ${RUN}`, { secondVersion: { label: 'Full name', withoutMessage: true } });
    survey = await publishEntriesForm(h, `Survey ${RUN}`);
    created.push(contact.detail.id, survey.detail.id);

    const add = async (name: string, entry: Omit<Parameters<typeof insertFormEntry>[1], 'form'> & { form?: PublishedForm }) => {
      seeded[name] = await insertFormEntry(h, { form: contact, ...entry });
    };
    await add('oldest', { salesChannelId: defaultChannel, submittedAt: at(0), status: 'closed', searchText: 'first' });
    await add('ada', {
      version: 1,
      salesChannelId: defaultChannel,
      submittedAt: at(10),
      answers: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        message: `Please call ${SENTINEL}`,
        address: { street: 'Main 1', city: 'Kraków', country: 'PL' },
        tags: ['doors', 'windows'],
        privacy: true,
      },
      consents: [{ fieldKey: 'privacy', kind: 'privacy', given: true, text: '<p>I accept the privacy policy</p>' }],
      submitterEmail: 'ada@example.com',
      searchText: `ada lovelace\nada@example.com\nplease call ${SENTINEL}`,
      pageUrl: '/contact?ref=mail',
      owner: { customerAccountId: randomUUID(), organizationId: randomUUID() },
    });
    await add('spam', { version: 2, salesChannelId: otherChannel, submittedAt: at(20), status: 'spam', searchText: 'buy now' });
    await add('read', { version: 2, salesChannelId: otherChannel, submittedAt: at(30), status: 'read', submitterEmail: 'grace@hopper.test' });
    await add('survey', { form: survey, salesChannelId: defaultChannel, submittedAt: at(40), searchText: 'survey answer' });
  }, 90_000);

  afterAll(async () => {
    if (h) {
      await deleteForms(h, created);
      if (otherChannel) await h.em().fork().nativeDelete(SalesChannel, { id: otherChannel });
    }
    await teardownBackendServer(h);
  });

  describe('the list (US4-1, FR-050)', () => {
    it('lists newest first, with the form’s name and version', async () => {
      const page = await list(`?formId=${contact.detail.id}`);
      expect(idsOf(page)).toEqual([seeded['read'], seeded['spam'], seeded['ada'], seeded['oldest']]);
      expect(page.items[0]).toMatchObject({ formName: `Contact ${RUN}`, formVersion: 2, status: 'read', salesChannelId: otherChannel });
      expect(page.items.find((item) => item.id === seeded['ada'])).toMatchObject({ attributed: true, submitterEmail: 'ada@example.com' });
    });

    it('filters by form', async () => {
      expect(idsOf(await list(`?formId=${survey.detail.id}`))).toEqual([seeded['survey']]);
    });

    it('filters by one or several statuses', async () => {
      expect(idsOf(await list(`?formId=${contact.detail.id}&status=spam`))).toEqual([seeded['spam']]);
      expect(idsOf(await list(`?formId=${contact.detail.id}&status=new&status=closed`))).toEqual([seeded['ada'], seeded['oldest']]);
    });

    it('filters by a date range, both ends included', async () => {
      const from = encodeURIComponent(at(10).toISOString());
      const to = encodeURIComponent(at(30).toISOString());
      expect(idsOf(await list(`?formId=${contact.detail.id}&submittedFrom=${from}&submittedTo=${to}`))).toEqual([
        seeded['read'],
        seeded['spam'],
        seeded['ada'],
      ]);
    });

    it('filters by channel', async () => {
      expect(idsOf(await list(`?formId=${contact.detail.id}&salesChannelId=${otherChannel}`))).toEqual([seeded['read'], seeded['spam']]);
    });

    it('searches the submitter’s e-mail and the text answers, ignoring case', async () => {
      expect(idsOf(await list(`?q=${encodeURIComponent('GRACE@hopper')}`))).toEqual([seeded['read']]);
      expect(idsOf(await list(`?q=${encodeURIComponent(SENTINEL.toUpperCase())}`))).toEqual([seeded['ada']]);
      expect(idsOf(await list(`?formId=${contact.detail.id}&q=${encodeURIComponent('%')}`))).toEqual([]);
    });

    it('pages by a keyset that a new entry does not disturb', async () => {
      const first = await list(`?formId=${contact.detail.id}&limit=2`);
      expect(idsOf(first)).toEqual([seeded['read'], seeded['spam']]);
      expect(first.nextCursor).not.toBeNull();
      // A newer entry arrives between the two pages.
      const newer = await insertFormEntry(h, { form: contact, version: 2, salesChannelId: defaultChannel, submittedAt: at(50) });
      const second = await list(`?formId=${contact.detail.id}&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
      expect(idsOf(second)).toEqual([seeded['ada'], seeded['oldest']]);
      expect(second.nextCursor).toBeNull();
      await call('DELETE', `/${newer}`);
    });
  });

  describe('the detail (US4-2, US1-6)', () => {
    it('tells the entry in its own version’s labels, keeps a field removed since, and shows its context', async () => {
      const entry = await detail(seeded['ada']!);
      expect(entry.answers.map((answer) => [answer.fieldKey, answer.label, answer.type])).toEqual([
        ['name', 'Name', 'text'],
        ['email', 'E-mail', 'email'],
        ['message', 'Message', 'textarea'],
        ['address', 'Address', 'address'],
        ['tags', 'Interests', 'checkboxes'],
        ['privacy', 'I accept the privacy policy', 'privacy_consent'],
      ]);
      expect(entry.answers.find((answer) => answer.fieldKey === 'address')!.value).toEqual({
        street: 'Main 1',
        city: 'Kraków',
        country: 'PL',
      });
      expect(entry.consents).toEqual([
        { fieldKey: 'privacy', kind: 'privacy', given: true, text: '<p>I accept the privacy policy</p>' },
      ]);
      expect(entry).toMatchObject({
        pageUrl: '/contact?ref=mail',
        language: 'en-US',
        salesChannelId: defaultChannel,
        submittedAt: at(10).toISOString(),
        formVersion: 1,
        attributed: true,
      });
      expect(entry.organizationId).not.toBeNull();
      expect(entry.customerAccountId).not.toBeNull();
    });

    it('reads without a side effect: GET leaves a new entry new', async () => {
      const id = await insertFormEntry(h, { form: survey, salesChannelId: defaultChannel, submittedAt: at(5) });
      await detail(id);
      await detail(id);
      expect((await readEntryRow(h, id))!['status']).toBe('new');
      expect(await auditRows(h, { objectType: 'form_entry', objectId: id })).toEqual([]);
    });
  });

  describe('processing (FR-048, FR-049, R-16)', () => {
    it('marks a new entry read once, auditing only the change', async () => {
      const id = await insertFormEntry(h, { form: survey, salesChannelId: defaultChannel, submittedAt: at(6) });
      const first = await call('POST', `/${id}/mark-read`);
      expect(formEntryDetailSchema.parse((first.json() as { data: unknown }).data).status).toBe('read');
      await call('POST', `/${id}/mark-read`);
      // A read entry moved on stays where it is.
      await call('PATCH', `/${id}/status`, { status: 'closed', expectedStatus: 'read' });
      await call('POST', `/${id}/mark-read`);
      expect((await readEntryRow(h, id))!['status']).toBe('closed');
      expect((await auditRows(h, { objectType: 'form_entry', objectId: id })).map((row) => row.action)).toEqual([
        'forms.entry.mark_read',
        'forms.entry.status_change',
      ]);
    });

    it('moves any status to any other, back to new included', async () => {
      const id = await insertFormEntry(h, { form: survey, salesChannelId: defaultChannel, submittedAt: at(7) });
      for (const [from, to] of [
        ['new', 'closed'],
        ['closed', 'read'],
        ['read', 'new'],
        ['new', 'spam'],
        ['spam', 'new'],
      ] as const) {
        const response = await call('PATCH', `/${id}/status`, { status: to, expectedStatus: from });
        expect(response.statusCode, response.body).toBe(200);
      }
      expect((await readEntryRow(h, id))!['status']).toBe('new');
    });

    it('undoes a change by re-issuing it, and refuses the undo once the entry moved (R-16)', async () => {
      const id = await insertFormEntry(h, { form: survey, salesChannelId: defaultChannel, submittedAt: at(8) });
      await call('PATCH', `/${id}/status`, { status: 'closed', expectedStatus: 'new' });
      const undo = await call('PATCH', `/${id}/status`, { status: 'new', expectedStatus: 'closed' });
      expect(undo.statusCode, undo.body).toBe(200);
      // Someone else moved it before a second undo of the same change.
      await call('PATCH', `/${id}/status`, { status: 'read', expectedStatus: 'new' });
      const stale = await call('PATCH', `/${id}/status`, { status: 'new', expectedStatus: 'closed' });
      expect(stale.statusCode).toBe(409);
      expect((stale.json() as { error: { code: string } }).error.code).toBe('FORM_ENTRY_STATUS_CONFLICT');
      expect((await readEntryRow(h, id))!['status']).toBe('read');
    });

    it('moves the form’s counter to and from spam (R-17 counter)', async () => {
      const form = await publishEntriesForm(h, `Counter ${RUN}`);
      created.push(form.detail.id);
      const id = await insertFormEntry(h, { form, salesChannelId: defaultChannel, submittedAt: at(9) });
      expect(await acceptedEntryCount(h, form.detail.id)).toBe(1);
      await call('PATCH', `/${id}/status`, { status: 'spam', expectedStatus: 'new' });
      expect(await acceptedEntryCount(h, form.detail.id)).toBe(0);
      await call('PATCH', `/${id}/status`, { status: 'read', expectedStatus: 'spam' });
      expect(await acceptedEntryCount(h, form.detail.id)).toBe(1);
      const spam = await insertFormEntry(h, { form, salesChannelId: defaultChannel, submittedAt: at(11), status: 'spam' });
      await call('DELETE', `/${spam}`);
      expect(await acceptedEntryCount(h, form.detail.id)).toBe(1);
      await call('DELETE', `/${id}`);
      expect(await acceptedEntryCount(h, form.detail.id)).toBe(0);
    });

    it('keeps notes with their author and time, newest last, and never exports them', async () => {
      const id = seeded['ada']!;
      const before = Date.now();
      const first = await call('POST', `/${id}/notes`, { body: `Called back ${SENTINEL}-note` });
      expect(first.statusCode, first.body).toBe(201);
      await call('POST', `/${id}/notes`, { body: 'Sent the offer.' });
      const entry = await detail(id);
      expect(entry.notes.map((note) => note.body)).toEqual([`Called back ${SENTINEL}-note`, 'Sent the offer.']);
      expect(entry.notes[0]!.authorAdminUserId).not.toBeNull();
      expect(new Date(entry.notes[0]!.createdAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
      const csv = await call('GET', `/export?formId=${contact.detail.id}`);
      expect(csv.statusCode, csv.body).toBe(200);
      expect(csv.body).not.toContain(`${SENTINEL}-note`);
      expect(csv.body).toContain(`Please call ${SENTINEL}`);
    });

    it('deletes one entry and many, with their notes (US4-7)', async () => {
      const one = await insertFormEntry(h, { form: survey, salesChannelId: defaultChannel, submittedAt: at(12) });
      const two = await insertFormEntry(h, { form: survey, salesChannelId: defaultChannel, submittedAt: at(13) });
      const three = await insertFormEntry(h, { form: survey, salesChannelId: defaultChannel, submittedAt: at(14) });
      for (const id of [one, two]) await call('POST', `/${id}/notes`, { body: 'note' });
      expect((await call('DELETE', `/${one}`)).statusCode).toBe(204);
      const bulk = await call('POST', '/delete', { ids: [two, three] });
      expect((bulk.json() as { data: unknown }).data).toEqual({ deleted: 2 });
      for (const id of [one, two, three]) expect(await readEntryRow(h, id)).toBeUndefined();
      const notes = await withSystemScope('forms entries test: notes left behind', async () =>
        (await h
          .em()
          .getConnection()
          .execute(`select count(*)::int as "n" from "form_entry_notes" where "entry_id" = any(?::uuid[])`, [
            `{${[one, two].join(',')}}`,
          ])) as Array<{ n: number }>,
      );
      expect(notes[0]!.n).toBe(0);
    });

    it('audits each write as one row naming ids and statuses — never an answer, an address or a note (FR-053)', async () => {
      const id = await insertFormEntry(h, {
        form: survey,
        salesChannelId: defaultChannel,
        submittedAt: at(15),
        answers: { name: SENTINEL, email: `${SENTINEL}@example.com` },
        submitterEmail: `${SENTINEL}@example.com`,
        searchText: SENTINEL,
      });
      await call('POST', `/${id}/mark-read`);
      await call('PATCH', `/${id}/status`, { status: 'closed', expectedStatus: 'read' });
      await call('POST', `/${id}/notes`, { body: `${SENTINEL} note body` });
      await call('DELETE', `/${id}`);
      const rows = await auditRows(h, { objectType: 'form_entry', objectId: id });
      expect(rows.map((row) => row.action)).toEqual([
        'forms.entry.mark_read',
        'forms.entry.status_change',
        'forms.entry.note_add',
        'forms.entry.delete',
      ]);
      expect(rows[1]).toMatchObject({ stateBefore: { status: 'read' }, stateAfter: { status: 'closed' } });
      expect(JSON.stringify(rows)).not.toContain(SENTINEL);

      const bulkOne = await insertFormEntry(h, { form: survey, salesChannelId: defaultChannel, submittedAt: at(16) });
      await call('POST', '/delete', { ids: [bulkOne] });
      const bulk = await auditRows(h, { action: 'forms.entries.delete' });
      expect(bulk.at(-1)!.stateAfter).toMatchObject({ deleted: 1 });

      await call('GET', `/export?formId=${survey.detail.id}&q=${encodeURIComponent('survey')}`);
      const exported = await auditRows(h, { action: 'forms.entries.export', objectId: survey.detail.id });
      expect(exported.at(-1)!.stateAfter).toMatchObject({ formId: survey.detail.id, filter: { q: 'survey' }, rowCount: 1 });
    });
  });
});
