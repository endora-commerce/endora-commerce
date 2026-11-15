import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { FORMS_ADMIN, deleteForms, insertFormEntry, publishEntriesForm } from '../../helpers/seed-forms.js';

/**
 * Issue #470 (D-288, `specs/conventions/audit-state.md` §2 and §5) — `forms.entries.export` is
 * recorded against the global form, but it writes about `@CustomerScoped` entries, and the
 * platform-wide audit screen, `GET /api/v1/admin/audit-log`, is read under `audit_log:read`
 * without Organization reach. The search text a caller typed is free text, so the entry records
 * whether a query was given and how long it was, never the text. The rows read are the ones this
 * test's own export produced, by the form id it created.
 */
describe('form entry exports in the platform audit log (#470)', () => {
  let h: BackendServerHandle;
  let formId: string;
  const QUERY = 's470@example.test S470-TITLE';

  beforeAll(async () => {
    h = await setupBackendServer();
    const channelId = (await h.em().fork().findOneOrFail(SalesChannel, { code: 'default' })).id;
    const form = await publishEntriesForm(h, `Export audit ${randomUUID().slice(0, 8)}`);
    formId = form.detail.id;
    await insertFormEntry(h, {
      form,
      salesChannelId: channelId,
      submittedAt: new Date(),
      submitterEmail: 's470@example.test',
      searchText: 's470@example.test S470-TITLE',
    });
  }, 60_000);

  afterAll(async () => {
    if (h) await deleteForms(h, formId ? [formId] : []);
    await teardownBackendServer(h);
  });

  it('an export with a search text leaves no trace of the text in GET /admin/audit-log', async () => {
    const exported = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/forms/entries/export?formId=${formId}&q=${encodeURIComponent(QUERY)}`,
      cookies: FORMS_ADMIN,
    });
    expect(exported.statusCode, exported.body).toBe(200);

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log?filter[action]=forms.entries.export',
      cookies: FORMS_ADMIN,
    });
    expect(read.statusCode, read.body).toBe(200);
    const rows = (read.json() as { data: Array<{ objectId: string; stateBefore: unknown; stateAfter: unknown }> }).data;
    const own = rows.filter((row) => row.objectId === formId);
    expect(own.length).toBeGreaterThanOrEqual(1);
    const recorded = JSON.stringify(own.map((row) => [row.stateBefore, row.stateAfter])).toLowerCase();
    for (const sentinel of ['s470@example.test', 's470-title']) expect(recorded, sentinel).not.toContain(sentinel);
    expect(own[0]!.stateAfter).toMatchObject({
      formId,
      filter: { hasQuery: true, queryLength: QUERY.length },
      rowCount: 1,
    });
  });
});
