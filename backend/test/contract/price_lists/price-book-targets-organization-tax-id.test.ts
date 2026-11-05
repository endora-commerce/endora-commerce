import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeOrganizationName } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #767 — the price-book member picker labels an organization with its
 * name and, as the hint beside it, its tax id
 * (`GET /api/v1/admin/price-books/targets/organizations`). A personal (B2C)
 * Organization's tax id is an internal 32-hex placeholder, so the hint is
 * `null` for it; a company Organization's tax id is carried as before. Both the
 * by-id and the search shape are covered.
 */
const PLACEHOLDER_TAX_ID = '79963f233e3843bd84e144a8fcdd37f8';

type Items = { data: { items: Array<{ id: string; name: string; taxId: string | null }> } };

describe('price-book organization targets — tax id hint (#767)', () => {
  let h: BackendServerHandle;
  let original: { name: string; nameSearch: string; legalName: string | null; taxId: string; isPersonal: boolean };

  beforeAll(async () => {
    h = await setupBackendServer();
    const org = await h.em().findOneOrFail(Organization, { id: TEST_ORGANIZATION_ID });
    original = { name: org.name, nameSearch: org.nameSearch, legalName: org.legalName ?? null, taxId: org.taxId, isPersonal: org.isPersonal };
  });

  afterAll(async () => {
    await h.em().nativeUpdate(Organization, { id: TEST_ORGANIZATION_ID }, original);
    await teardownBackendServer(h);
  });

  async function hintsOf(kind: 'personal' | 'company') {
    const name = kind === 'personal' ? 'Jan Kowalski 767' : 'Acme 767';
    // `nativeUpdate` skips the entity hooks that maintain `name_search`, so the
    // folded column is written alongside the name the search will look for.
    await h.em().nativeUpdate(
      Organization,
      { id: TEST_ORGANIZATION_ID },
      kind === 'personal'
        ? { name, nameSearch: normalizeOrganizationName(name), legalName: null, taxId: PLACEHOLDER_TAX_ID, isPersonal: true }
        : { name, nameSearch: normalizeOrganizationName(name), legalName: 'Acme Sp. z o.o.', taxId: '5260250274', isPersonal: false },
    );
    const get = async (query: string) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/price-books/targets/organizations?${query}`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as Items).data.items.find((item) => item.id === TEST_ORGANIZATION_ID);
    };
    return { byId: await get(`ids=${TEST_ORGANIZATION_ID}`), bySearch: await get(`search=${encodeURIComponent(name)}`) };
  }

  it('hints a company Organization with its tax id', async () => {
    const { byId, bySearch } = await hintsOf('company');
    expect(byId).toMatchObject({ name: 'Acme 767', taxId: '5260250274' });
    expect(bySearch).toMatchObject({ name: 'Acme 767', taxId: '5260250274' });
  });

  it('never hints a personal Organization with its placeholder', async () => {
    const { byId, bySearch } = await hintsOf('personal');
    expect(byId).toMatchObject({ name: 'Jan Kowalski 767', taxId: null });
    expect(bySearch).toMatchObject({ name: 'Jan Kowalski 767', taxId: null });
  });
});
