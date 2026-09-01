import type { SalesChannelDetail, SalesChannelListResponse } from '@endora-commerce/contracts';
// `apiClient` comes through the kit's published `lib` **barrel** rather than
// through `../../lib/api-client.js`: `vi.mock` keys on a resolved module id, so
// the barrel is the only spelling an admin test can name, and it resolves to
// the same file as `@endora-commerce/admin-kit/lib`.
import { apiClient } from '../../lib/index.js';

/**
 * The two sales-channel reads `ScopePicker` needs, built here (feature 091, P8).
 *
 * Until this component moved into the kit it called `sales_channels`' own admin
 * API client, which is a reach out of the platform's frontend into a module's
 * admin code — the one entry
 * `backend/scripts/ledgers/cross-module-imports/cms.ts` held. The exit is the
 * one P2 established for the three data-fetching pickers: name the endpoint and
 * the published response type, which both sides already compile, and depend on
 * no module's code. Both shapes are `@endora-commerce/contracts`', so nothing
 * about them is duplicated — only the two `GET`s the picker needs out of that
 * client's fifteen methods.
 */

/** Active channels, one large page — channels are few and unpaged in practice. */
export function listScopeSalesChannels(pageSize = 100): Promise<SalesChannelListResponse> {
  const qs = new URLSearchParams();
  qs.set('activeOnly', 'true');
  qs.set('pageSize', String(pageSize));
  return apiClient.get<SalesChannelListResponse>(`/api/v1/admin/sales-channels?${qs.toString()}`);
}

/** One channel by its code, for the language list a summary does not carry. */
export function fetchScopeSalesChannel(code: string): Promise<SalesChannelDetail> {
  return apiClient.get<SalesChannelDetail>(
    `/api/v1/admin/sales-channels/${encodeURIComponent(code)}`,
  );
}
