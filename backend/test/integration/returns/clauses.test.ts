import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { randomUUID } from 'node:crypto';
import { Organization, ReturnCase, ReturnCaseClause } from '../../helpers/package-entities.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';
import { makeMember, orderPlacedBy, releaseMembers, submitCase } from './organization-fixtures.js';
import { ADMIN_COOKIE, anyReasonId, resetReturnGraph, seedReturnableOrder } from './helpers.js';
import { allowOffPlatform, complaintReasonId, file, noOrderBody } from './off-platform-fixtures.js';

/**
 * `specs/180-off-platform-complaints/` T070, T071 (FR-B30 – FR-B32, D-1, research R-14):
 * clause configuration, and acceptance at filing.
 */
describe('returns — clauses', () => {
  let h: BackendServerHandle;
  let reader: { cookies: { b2b_session: string }; undo: () => void };
  let undoOffPlatform: () => Promise<void>;
  const API = '/api/v1/admin/returns/clauses';
  type Clause = { id: string; revision: number; mode: string; appliesTo: string; isActive: boolean };

  beforeAll(async () => {
    h = await setupBackendServer();
    await resetReturnGraph(h.em());
    reader = await seedCrmAdmin(h.em(), 'returns_reader_clauses', ['returns:read']);
    undoOffPlatform = await allowOffPlatform(h);
  });
  afterAll(async () => {
    reader.undo();
    releaseMembers();
    await undoOffPlatform();
    await teardownBackendServer(h);
  });

  /** The clauses this file created: the table starts empty per file (`volatileTables`), and `clear` empties only these. */
  const mine: string[] = [];
  const create = async (payload: Record<string, unknown>, cookies: Record<string, string> = ADMIN_COOKIE) => {
    const res = await h.app.inject({ method: 'POST', url: API, cookies, payload });
    if (res.statusCode === 201) mine.push((res.json() as { data: { id: string } }).data.id);
    return res;
  };
  const patch = (id: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `${API}/${id}`, cookies: ADMIN_COOKIE, payload });
  const remove = (id: string) => h.app.inject({ method: 'DELETE', url: `${API}/${id}`, cookies: ADMIN_COOKIE });
  const clauseOf = (res: { json: () => unknown }) => (res.json() as { data: Clause }).data;
  const clear = async () => h.em().fork().nativeDelete(ReturnCaseClause, { id: { $in: mine.splice(0) } });

  describe('configuration (T070)', () => {
    it('creates with the defaults both/must_accept, auditing without the text or the link', async () => {
      const res = await create({ label: { en: 'Terms' }, text: { en: 'SECRET-CLAUSE-TEXT' }, linkUrl: { en: 'https://shop.example/terms-secret' } });
      expect(res.statusCode, res.body).toBe(201);
      const clause = clauseOf(res);
      expect(clause).toMatchObject({ appliesTo: 'both', mode: 'must_accept', revision: 1, isActive: true });
      const entries = await h.em().fork().find(AuditLogEntry, { objectId: clause.id, action: 'return_case_clause.create' });
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).not.toMatch(/SECRET-CLAUSE-TEXT|terms-secret/);
      expect(entries[0]!.stateAfter).toMatchObject({ appliesTo: 'both', mode: 'must_accept', hasLink: true, revision: 1 });
    });

    it('refuses a label or text without the default language, and a non-https link', async () => {
      const missing = await create({ label: { pl: 'Warunki' }, text: { en: 'Text' } });
      expect(missing.statusCode).toBe(422);
      expect((missing.json() as { error: { details: { code: string } } }).error.details.code).toBe('default_language_required');
      expect((await create({ label: { en: 'T' }, text: { en: 'T' }, linkUrl: { en: 'http://shop.example' } })).statusCode).toBe(400);
    });

    it('raises the revision on an edit of what a customer reads, and not on a weight edit', async () => {
      const id = clauseOf(await create({ label: { en: 'Terms' }, text: { en: 'v1' } })).id;
      expect(clauseOf(await patch(id, { weight: 5 })).revision).toBe(1);
      expect(clauseOf(await patch(id, { text: { en: 'v2' } })).revision).toBe(2);
      expect(clauseOf(await patch(id, { mode: 'inform_only' })).revision).toBe(3);
      expect(clauseOf(await patch(id, { appliesTo: 'complaint' })).revision).toBe(4);
      expect(clauseOf(await patch(id, { linkUrl: { en: 'https://shop.example/t' } })).revision).toBe(5);
      expect(clauseOf(await patch(id, { label: { en: 'New' } })).revision).toBe(6);
      expect((await remove(id)).statusCode).toBe(200);
      const entries = await h.em().fork().find(AuditLogEntry, { objectId: id });
      expect(entries.map((e) => e.action)).toContain('return_case_clause.delete');
    });

    it('reads with returns:read and writes with returns:write', async () => {
      expect((await h.app.inject({ method: 'GET', url: API, cookies: reader.cookies })).statusCode).toBe(200);
      expect((await create({ label: { en: 'T' }, text: { en: 'T' } }, reader.cookies)).statusCode).toBe(403);
    });
  });

  describe('acceptance at filing (T071)', () => {
    async function orderCase(kind: 'return' | 'complaint', extra: Record<string, unknown> = {}) {
      const { orderId, itemIds } = await seedReturnableOrder(h.em());
      return file(h, { orderId, kind, lines: [{ orderItemId: itemIds[0], quantity: 1, reasonId: await anyReasonId(h.em()) }], ...extra });
    }
    const reasonOf = (res: { json: () => unknown }) =>
      (res.json() as { error: { code: string; details: { reason: string } } }).error;

    it('posts as before while no clause is configured', async () => {
      await clear();
      expect((await orderCase('return')).statusCode).toBe(201);
    });

    it('refuses a missing tick, a stale revision and an extra id; stores what was shown', async () => {
      await clear();
      const mustAccept = clauseOf(await create({ label: { en: 'Accept', pl: 'Akceptuj' }, text: { en: 'Must text', pl: 'Tekst' } }));
      const inform = clauseOf(await create({ label: { en: 'Info' }, text: { en: 'Info text' }, mode: 'inform_only', linkUrl: { en: 'https://shop.example/info' } }));
      const shown = [mustAccept, inform].map((c) => ({ id: c.id, revision: c.revision }));
      const accepted = [{ id: mustAccept.id, revision: mustAccept.revision }];

      const noTick = await orderCase('complaint', { shownClauses: shown, acceptedClauses: [] });
      expect(noTick.statusCode).toBe(422);
      expect(reasonOf(noTick)).toMatchObject({ code: ERROR_CODES.RETURN_CLAUSES_NOT_ACCEPTED, details: { reason: 'clause_not_accepted' } });

      const stale = await orderCase('complaint', { shownClauses: [{ id: mustAccept.id, revision: 99 }, shown[1]], acceptedClauses: accepted });
      expect(reasonOf(stale).details.reason).toBe('clauses_changed');

      const extra = await orderCase('complaint', { shownClauses: [...shown, { id: '00000000-0000-4000-8000-0000000000ff', revision: 1 }], acceptedClauses: accepted });
      expect(reasonOf(extra).details.reason).toBe('clauses_changed');

      const ok = await orderCase('complaint', { shownClauses: shown, acceptedClauses: accepted });
      expect(ok.statusCode, ok.body).toBe(201);
      const id = (ok.json() as { data: { id: string } }).data.id;

      // The stored copy survives an edit and a delete of the clause (FR-B32).
      await patch(mustAccept.id, { text: { en: 'Edited text' } });
      await remove(inform.id);
      const rc = await h.em().fork().findOneOrFail(ReturnCase, { id }, { filters: false });
      expect(rc.clausesAcceptedAt).toBeInstanceOf(Date);
      expect(rc.acceptedClauses).toHaveLength(2);
      expect(rc.acceptedClauses).toEqual(
        expect.arrayContaining([
          { clauseId: mustAccept.id, revision: 1, mode: 'must_accept', language: 'en', label: 'Accept', text: 'Must text', linkUrl: null },
          { clauseId: inform.id, revision: 1, mode: 'inform_only', language: 'en', label: 'Info', text: 'Info text', linkUrl: 'https://shop.example/info' },
        ]),
      );
    });

    it('stores the submission language’s copy, falling back to the default', async () => {
      await clear();
      const c = clauseOf(await create({ label: { en: 'Accept', pl: 'Akceptuj' }, text: { en: 'English only' }, appliesTo: 'complaint' }));
      const res = await file(h, noOrderBody(await complaintReasonId(h.em()), {
        shownClauses: [{ id: c.id, revision: 1 }],
        acceptedClauses: [{ id: c.id, revision: 1 }],
      }), { headers: { 'x-sales-channel': 'default', 'accept-language': 'pl' } });
      expect(res.statusCode, res.body).toBe(201);
      const stored = (res.json() as { data: { acceptedClauses: Array<{ language: string; label: string; text: string }> } }).data.acceptedClauses;
      expect(stored[0]).toMatchObject({ language: 'pl', label: 'Akceptuj', text: 'English only' });
    });

    it('expects no complaint-only clause on a return', async () => {
      await clear();
      await create({ label: { en: 'C' }, text: { en: 'C' }, appliesTo: 'complaint' });
      expect((await orderCase('return')).statusCode).toBe(201);
    });

    it('lets a consumer’s withdrawal submit without accepting a returns must_accept clause (D-1)', async () => {
      await clear();
      await create({ label: { en: 'Accept' }, text: { en: 'Text' }, appliesTo: 'return' });
      const em = h.em();
      const personalId = randomUUID();
      em.create(Organization, {
        id: personalId,
        name: `180 Consumer ${personalId.slice(0, 8)}`,
        taxId: null,
        status: 'active',
        vatStatus: 'vat_payer',
        isPersonal: true,
        registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      } as never);
      await em.flush();
      await bindOrganizationsToFixtureChannelsSql(em, [personalId]);
      const consumer = await makeMember(em, personalId, 'administrator', { label: 'Consumer180' });
      const res = await submitCase(h, consumer, await orderPlacedBy(em, consumer), { kind: 'return' });
      expect(res.statusCode, res.body).toBe(201);
      expect((res.json() as { data: { consumerWithdrawal: boolean } }).data.consumerWithdrawal).toBe(true);
    });
  });
});
