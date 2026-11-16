/**
 * The audit-state rule for form entries (`specs/conventions/audit-state.md`, D-288, issue #470).
 * A `FormEntry` is `@CustomerScoped`, so the Commands that write it — and `forms.entries.export`,
 * recorded against the global form but writing about its entries (§5) — carry ids, codes, dates
 * and counts, never an answer, a note's body, the submitter's address or the search text.
 *
 * Each Command runs through the **real** `CommandBus` with a recording audit port; the
 * EntityManager is an in-memory stand-in. What is under test is what the Command hands the bus.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import type { RecordAuditInput } from '@endora-commerce/platform/kernel';
import { withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { FORMS_AUDIT_KEYS, FORMS_EXPORT_FILTER_AUDIT_KEYS, filterAuditState } from './entry-audit-state.js';
import { EntryService } from './entry-service.js';

const ADMIN = '00000000-0000-4000-8000-0000000004a1';
const ORG = randomUUID();
const FORM = randomUUID();
const ENTRY = randomUUID();
const CHANNEL = randomUUID();
const QUERY = 's470@example.test S470-TITLE';
const SENTINELS = [ORG, 's470@example.test', 'S470-TITLE', 'S470-DESC'];

function harness() {
  const entry = {
    id: ENTRY,
    formId: FORM,
    formVersionNumber: 1,
    status: 'read',
    salesChannelId: CHANNEL,
    language: 'en-US',
    submittedAt: new Date('2026-11-15T12:00:00.000Z'),
    pageUrl: '/contact',
    consents: [],
    customerAccountId: null,
    organizationId: ORG,
    submitterEmail: 's470@example.test',
    searchText: 'S470-TITLE',
    answers: { name: 'S470-TITLE' },
  };
  const tx = {
    findOne: async (entity: { name: string }) => (entity.name === 'FormEntry' ? entry : null),
    find: async (entity: { name: string }) => (entity.name === 'FormEntry' ? [entry] : []),
    count: async () => 1,
    execute: async () => [],
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: randomUUID(), createdAt: new Date(), ...data }),
    remove: () => undefined,
    persist: () => undefined,
  };
  const em = {
    fork: () => em,
    transactional: async <T>(fn: (scoped: unknown) => Promise<T>) => fn(tx),
    findOne: async (entity: { name: string }) =>
      entity.name === 'Form' ? { id: FORM, key: 'survey', name: 'Survey' } : entity.name === 'FormEntry' ? entry : null,
    find: async () => [],
  };
  const entries: RecordAuditInput[] = [];
  const audit = {
    recordWithin: (_em: unknown, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return input as never;
    },
  };
  const bus = new CommandBus({ em } as never, audit as never, new EventBus());
  const service = new EntryService({
    emFactory: () => em as never,
    commandBus: bus,
    channels: { listAll: async () => [] } as never,
  });
  const asAdmin = <T>(fn: () => Promise<T>) => withSystemScopeActingFor(ADMIN, 'forms audit sentinel test', fn);
  return { service, entries, asAdmin };
}

function expectKeysAllowlisted(entries: readonly RecordAuditInput[]): void {
  for (const entry of entries) {
    for (const state of [entry.stateBefore, entry.stateAfter]) {
      for (const key of Object.keys(state ?? {})) expect(FORMS_AUDIT_KEYS, `${entry.action}: ${key}`).toContain(key);
      const filter = (state as { filter?: Record<string, unknown> } | null)?.filter;
      for (const key of Object.keys(filter ?? {})) {
        expect(FORMS_EXPORT_FILTER_AUDIT_KEYS, `${entry.action} filter: ${key}`).toContain(key);
      }
    }
  }
}

describe('form entry audit state carries names, never values (#470)', () => {
  it('forms.entries.export records whether a query was given and its length, never its text', async () => {
    const h = harness();
    await h.asAdmin(() =>
      h.service.export({ formId: FORM, q: QUERY, status: ['new'], salesChannelId: CHANNEL, submittedFrom: '2026-11-01' }),
    );
    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => e.action)).toEqual(['forms.entries.export']);
    expect(h.entries[0]?.stateAfter).toEqual({
      formId: FORM,
      filter: {
        status: ['new'],
        submittedFrom: '2026-11-01',
        salesChannelId: CHANNEL,
        hasQuery: true,
        queryLength: QUERY.length,
      },
      rowCount: 1,
    });
  });

  it('forms.entries.export without a query records neither hasQuery nor queryLength', async () => {
    const h = harness();
    await h.asAdmin(() => h.service.export({ formId: FORM }));
    expectKeysAllowlisted(h.entries);
    expect(h.entries[0]?.stateAfter).toEqual({ formId: FORM, filter: {}, rowCount: 1 });
  });

  it('the entry Commands record the status and ids, never an answer, a note body or the address', async () => {
    const h = harness();
    await h.asAdmin(async () => {
      await h.service.changeStatus(ENTRY, 'closed', 'read');
      await h.service.addNote(ENTRY, 'S470-DESC note body');
      await h.service.delete(ENTRY);
      await h.service.deleteMany([ENTRY]);
    });
    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => e.action)).toEqual([
      'forms.entry.status_change',
      'forms.entry.note_add',
      'forms.entry.delete',
      'forms.entries.delete',
    ]);
  });

  it('filterAuditState names only allowlisted keys', () => {
    const state = filterAuditState({
      status: ['new', 'spam'],
      submittedFrom: '2026-11-01',
      submittedTo: '2026-11-30',
      salesChannelId: CHANNEL,
      q: QUERY,
    });
    for (const key of Object.keys(state)) expect(FORMS_EXPORT_FILTER_AUDIT_KEYS).toContain(key);
    expect(state).toEqual({
      status: ['new', 'spam'],
      submittedFrom: '2026-11-01',
      submittedTo: '2026-11-30',
      salesChannelId: CHANNEL,
      hasQuery: true,
      queryLength: QUERY.length,
    });
  });
});
