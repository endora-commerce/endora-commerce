import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ShoppingList, type ShoppingListRow } from '../../helpers/package-entities.js';

/**
 * Eager default-list provisioning — creating an org-attached customer (here via
 * the admin direct-member-create endpoint) emits `customer_account.created.v1`,
 * which the shopping_lists module consumes to create the customer's "Default"
 * list immediately, before any storefront read lazily provisions it.
 */
describe('Default shopping list — eager provisioning on customer create', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('provisions a Default list when an admin creates a customer', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/members`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: 'eager-default-list@example.com',
        password: 'stub-password-change-me-1234',
        firstName: 'Eager',
        lastName: 'Provision',
        role: 'regular_user',
      },
    });
    expect(res.statusCode).toBe(201);
    const customerId = (res.json() as { data: { id: string } }).data.id;

    // The event handler runs fire-and-forget (no ambient bus scope around the
    // request), so poll briefly for the provisioned list.
    let list: ShoppingListRow | null = null;
    for (let attempt = 0; attempt < 40 && !list; attempt += 1) {
      list = await withSystemScope('test poll', () =>
        h.em().findOne(ShoppingList, {
          customerAccountId: customerId,
          organizationId: TEST_ORGANIZATION_ID,
        }),
      );
      if (!list) await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(list).not.toBeNull();
    expect(list?.name).toBe('Default');
    expect(list?.isDefault).toBe(true);
  });
});
