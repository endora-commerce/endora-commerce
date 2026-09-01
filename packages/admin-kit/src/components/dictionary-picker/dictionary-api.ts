/**
 * The two `dictionary` reads {@link CountryPicker} and {@link CurrencyPicker}
 * need, built here (feature 091, batch 8).
 *
 * Until these two components moved into the kit they called `dictionaries`'
 * own admin API client, which is a reach out of one module's admin surface
 * into another's — `taxes`, `credit_limits`, `delivery_methods` and
 * `inventory` each recorded one in
 * `backend/scripts/ledgers/cross-module-imports/`. The exit is P2's, the one
 * `sales-channel-picker`, `cms-picker` and `organization-picker` took: name
 * the endpoint and the published response type, which both sides already
 * compile, and depend on no module's code. `admin-kit-surface.md` R6's subject
 * is a module's **code**, and an HTTP path plus a schema out of
 * `@endora-commerce/contracts` is not that.
 *
 * Two of that client's fourteen methods, and only the `GET`s: a picker reads.
 */
import type {
  DictionaryCountriesPageResponse,
  DictionaryCurrenciesPageResponse,
} from '@endora-commerce/contracts';

// `apiClient` comes through the kit's published `lib` **barrel** for the reason
// `SalesChannelPicker.tsx` records at length: `vi.mock` keys on a resolved
// module id and the `exports` map declares no deep subpath, so the barrel is
// the only spelling an admin test outside this package can name. It is the
// same module record either way.
import { apiClient } from '../../lib/index.js';

const BASE = '/api/v1/admin/dictionary';

/**
 * Both dictionaries are small and closed sets — ~250 countries, ~180
 * currencies — so one page holds the whole of either and the picker filters in
 * the browser. This is the page size the module's own screens use.
 */
const PICKER_PAGE_SIZE = 250;

function pageQuery(): string {
  const params = new URLSearchParams();
  params.set('pageSize', String(PICKER_PAGE_SIZE));
  params.set('sort', 'sortOrder');
  return params.toString();
}

export function listDictionaryCountries(): Promise<DictionaryCountriesPageResponse> {
  return apiClient.get<DictionaryCountriesPageResponse>(`${BASE}/countries?${pageQuery()}`);
}

export function listDictionaryCurrencies(): Promise<DictionaryCurrenciesPageResponse> {
  return apiClient.get<DictionaryCurrenciesPageResponse>(`${BASE}/currencies?${pageQuery()}`);
}
