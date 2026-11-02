import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveTenantContext, systemTenantContext } from '@endora-commerce/platform/composition';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  MissingTenantContextError,
  runWithTenantContext,
  runWithoutTenantContext,
} from '../../../src/tenancy/tenant-context.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { resolveTransitiveParent, tenantClassifications } from '../../../src/tenancy/org-scoped.decorator.js';
import { FormEntry, FormEntryNote } from '../../helpers/package-entities.js';

/**
 * `specs/170-forms-module/` T014 — the Principle XI review of `research.md`, held at the data layer.
 *
 * Entries of organisation A, organisation B and an anonymous submitter are seeded under
 * `withSystemScope`; the guard alone — no `where` on the organisation — decides who reads which.
 * An unrestricted admin reads all three; an admin scoped to A reads A's and **never** the anonymous
 * one (the `allowed-set` predicate `organization_id IN (…)` cannot match NULL); no context fails
 * closed. A note has no tenant of its own and is classified through its entry.
 */
describe('forms tenancy (Principle XI review, FR-046)', () => {
  let h: BackendServerHandle;
  const orgA = randomUUID();
  const orgB = randomUUID();
  const accountA = randomUUID();
  const accountB = randomUUID();
  const formId = randomUUID();
  const versionId = randomUUID();
  const entryA = randomUUID();
  const entryB = randomUUID();
  const entryAnonymous = randomUUID();

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('forms tenancy test: seed entries across tenants', async () => {
      const connection = h.em().getConnection();
      const definition = JSON.stringify({ schemaVersion: 1, sections: [] });
      await connection.execute(
        `insert into "forms" ("id", "key", "name", "default_language", "definition") values (?, ?, 'Tenancy', 'en', ?::jsonb)`,
        [formId, `tenancy_${formId.slice(0, 8)}`, definition],
      );
      await connection.execute(
        `insert into "form_versions" ("id", "form_id", "number", "definition", "default_language") values (?, ?, 1, ?::jsonb, 'en')`,
        [versionId, formId, definition],
      );
      const insert = (id: string, account: string | null, organization: string | null) =>
        connection.execute(
          `insert into "form_entries"
             ("id", "form_id", "form_version_id", "form_version_number", "sales_channel_id", "language",
              "customer_account_id", "organization_id")
           values (?, ?, ?, 1, ?, 'en', ?, ?)`,
          [id, formId, versionId, randomUUID(), account, organization],
        );
      await insert(entryA, accountA, orgA);
      await insert(entryB, accountB, orgB);
      await insert(entryAnonymous, null, null);
      await connection.execute(`insert into "form_entry_notes" ("entry_id", "body") values (?, 'Called back')`, [entryA]);
    });
  });

  afterAll(async () => {
    await withSystemScope('forms tenancy test: clean up', async () => {
      await h.em().getConnection().execute(`delete from "forms" where "id" = ?`, [formId]);
    });
    await teardownBackendServer(h);
  });

  const entryIds = async (): Promise<string[]> =>
    (await h.em().fork().find(FormEntry, { formId })).map((entry) => entry.id).sort();

  it('an unrestricted admin reads every entry, anonymous included', async () => {
    const ctx = resolveTenantContext({ kind: 'admin', adminUserId: randomUUID() }, { allowAll: true });
    const ids = await runWithTenantContext(ctx, entryIds);
    expect(ids).toEqual([entryA, entryB, entryAnonymous].sort());
  });

  it('an admin scoped to A reads A’s entry and never the anonymous one (FR-046)', async () => {
    const ctx = resolveTenantContext(
      { kind: 'admin', adminUserId: randomUUID() },
      { allowAll: false, allowedOrganizationIds: [orgA] },
    );
    const ids = await runWithTenantContext(ctx, entryIds);
    expect(ids).toEqual([entryA]);
  });

  it('a customer reads only their own account’s entries', async () => {
    const ctx = resolveTenantContext({ kind: 'customer', customerAccountId: accountB, organizationId: orgB });
    const ids = await runWithTenantContext(ctx, entryIds);
    expect(ids).toEqual([entryB]);
  });

  it('the system scope reads every entry', async () => {
    const ids = await runWithTenantContext(systemTenantContext('forms tenancy test: system read'), entryIds);
    expect(ids).toEqual([entryA, entryB, entryAnonymous].sort());
  });

  it('no ambient context fails closed', async () => {
    await runWithoutTenantContext(async () => {
      await expect(h.em().fork().find(FormEntry, { formId })).rejects.toThrow(MissingTenantContextError);
    });
  });

  it('classifies the four entities as the review records', () => {
    const byName = new Map(tenantClassifications().map((meta) => [meta.className, meta]));
    expect(byName.get('Form')?.scope).toBe('global');
    expect(byName.get('FormVersion')?.scope).toBe('global');
    expect(byName.get('FormEntry')?.scope).toBe('customer');
    expect(byName.get('FormEntryNote')).toMatchObject({ scope: 'transitive', parentClassName: 'FormEntry', fk: 'entryId' });
  });

  it('reaches a note only through its entry’s customer scope', () => {
    const note = tenantClassifications().find((meta) => meta.className === 'FormEntryNote');
    expect(note).toBeDefined();
    expect(resolveTransitiveParent(note!)).toMatchObject({ className: 'FormEntry', scope: 'customer' });
    expect(FormEntryNote).toBeDefined();
  });
});
