import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID, OTHER_TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { ReturnCaseAttachment } from '../../helpers/package-entities.js';

/**
 * `specs/180-off-platform-complaints/` T053 (Principle XI, data-model §2.3):
 * `ReturnCaseAttachment` is tenant-scoped — a pending upload and an attachment of one
 * organization are invisible under another's context, exactly as a row that does not
 * exist.
 */
describe('returns — attachments are tenant-scoped', () => {
  let h: BackendServerHandle;
  let pending: string;

  const asOrganization = <T>(organizationId: string, fn: () => Promise<T>): Promise<T> =>
    runWithTenantContext(
      { mode: 'single-org', organizationId, actor: { kind: 'system' }, reason: '180 T053' } as never,
      fn,
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    pending = randomUUID();
    await h.em().getKnex()('return_case_attachments').insert({
      id: pending,
      organization_id: TEST_ORGANIZATION_ID,
      // A pending upload always has an owner (`specs/181-guest-complaints/` data-model §3,
      // `return_case_attachments_owner_check`): here the customer who uploaded it.
      customer_account_id: TEST_CUSTOMER_ID,
      type: 'photo',
      storage_backend: 'local',
      storage_locator: `returns/${TEST_ORGANIZATION_ID}/${pending}`,
      expires_at: new Date(Date.now() + 3_600_000),
      created_at: new Date(),
    });
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is found under its own organization', async () => {
    const row = await asOrganization(TEST_ORGANIZATION_ID, () => h.em().fork().findOne(ReturnCaseAttachment, { id: pending }));
    expect(row?.id).toBe(pending);
  });

  it('is absent under another organization, as a row that does not exist', async () => {
    const row = await asOrganization(OTHER_TEST_ORGANIZATION_ID, () => h.em().fork().findOne(ReturnCaseAttachment, { id: pending }));
    const none = await asOrganization(OTHER_TEST_ORGANIZATION_ID, () =>
      h.em().fork().findOne(ReturnCaseAttachment, { id: randomUUID() }),
    );
    expect(row).toBeNull();
    expect(none).toBeNull();
  });
});
