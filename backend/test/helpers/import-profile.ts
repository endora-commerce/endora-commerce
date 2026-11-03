import { randomUUID } from 'node:crypto';
import type { PimLocaleMappingEntry } from '@endora-commerce/contracts';
import type { BackendServerHandle } from './test-server.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/contracts/import-profiles-and-csv.md` §1–§2)
 * — a products import needs an import profile (`422 IMPORT_PROFILE_REQUIRED` without one). Create
 * one through the admin route and answer its id; with no arguments it maps nothing and writes no
 * locale to Global, which is what a file of Global and scope columns only needs.
 */
export async function createImportProfile(
  h: BackendServerHandle,
  input: { sourceLanguageForGlobal?: string | null; localeMapping?: PimLocaleMappingEntry[]; name?: string } = {},
  cookies: Record<string, string> = { b2b_session: 'stub-admin-session' },
): Promise<string> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/import-export/profiles',
    cookies,
    payload: {
      name: input.name ?? `Test profile ${randomUUID().slice(0, 8)}`,
      entity: 'products',
      sourceLanguageForGlobal: input.sourceLanguageForGlobal ?? null,
      localeMapping: input.localeMapping ?? [],
    },
  });
  if (res.statusCode !== 201) throw new Error(`createImportProfile: ${res.statusCode} ${res.body}`);
  return (res.json() as { data: { id: string } }).data.id;
}
