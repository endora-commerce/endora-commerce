import type {
  Country,
  CreateCountryRequest,
  CreateDictionaryCurrencyRequest,
  CreateDictionaryLanguageRequest,
  DictionaryCountriesPageResponse,
  DictionaryCurrenciesPageResponse,
  DictionaryCurrency,
  DictionaryLanguagesPageResponse,
  DictionaryLanguage,
  DictionaryTranslation,
  DictionaryEntryType,
  LanguageCountry,
  UpdateCountryRequest,
  UpdateDictionaryCurrencyRequest,
  UpdateDictionaryLanguageRequest,
  UpsertTranslationRequest,
  UpsertLanguageCountryRequest,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
const BASE = '/api/v1/admin/dictionary';

export interface DictionaryListParams {
  page?: number;
  pageSize?: number;
  sort?: 'sortOrder' | 'label' | 'code' | 'region';
  search?: string;
}

export interface DictionaryAuditRow {
  dictionary: 'country' | 'currency' | 'language';
  consumer: string;
  tableName: string;
  columnName: string;
  code: string;
  count: number;
}

export interface DictionaryAuditResponse {
  data: DictionaryAuditRow[];
  meta: {
    generatedAt: string;
    total: number;
  };
}

function query(params: DictionaryListParams = {}): string {
  const sp = new URLSearchParams();
  if (params.page) sp.set('page', String(params.page));
  if (params.pageSize) sp.set('pageSize', String(params.pageSize));
  if (params.sort) sp.set('sort', params.sort);
  if (params.search) sp.set('search', params.search);
  const out = sp.toString();
  return out ? `?${out}` : '';
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

export const dictionaryClient = {
  listCountries(params?: DictionaryListParams): Promise<DictionaryCountriesPageResponse> {
    return apiClient.get(`${BASE}/countries${query(params)}`);
  },
  createCountry(input: CreateCountryRequest): Promise<{ data: Country }> {
    return apiClient.post(`${BASE}/countries`, input);
  },
  updateCountry(code: string, input: UpdateCountryRequest): Promise<{ data: Country }> {
    return apiClient.put(`${BASE}/countries/${enc(code)}`, input);
  },
  setDefaultCountry(code: string): Promise<{ data: Country }> {
    return apiClient.post(`${BASE}/countries/${enc(code)}/default`);
  },
  deleteCountry(code: string): Promise<void> {
    return apiClient.delete(`${BASE}/countries/${enc(code)}`);
  },

  listCurrencies(params?: DictionaryListParams): Promise<DictionaryCurrenciesPageResponse> {
    return apiClient.get(`${BASE}/currencies${query(params)}`);
  },
  createCurrency(input: CreateDictionaryCurrencyRequest): Promise<{ data: DictionaryCurrency }> {
    return apiClient.post(`${BASE}/currencies`, input);
  },
  updateCurrency(
    code: string,
    input: UpdateDictionaryCurrencyRequest,
  ): Promise<{ data: DictionaryCurrency }> {
    return apiClient.put(`${BASE}/currencies/${enc(code)}`, input);
  },
  setDefaultCurrency(code: string): Promise<{ data: DictionaryCurrency }> {
    return apiClient.post(`${BASE}/currencies/${enc(code)}/default`);
  },
  deleteCurrency(code: string): Promise<void> {
    return apiClient.delete(`${BASE}/currencies/${enc(code)}`);
  },

  listLanguages(params?: DictionaryListParams): Promise<DictionaryLanguagesPageResponse> {
    return apiClient.get(`${BASE}/languages${query(params)}`);
  },
  createLanguage(input: CreateDictionaryLanguageRequest): Promise<{ data: DictionaryLanguage }> {
    return apiClient.post(`${BASE}/languages`, input);
  },
  updateLanguage(
    code: string,
    input: UpdateDictionaryLanguageRequest,
  ): Promise<{ data: DictionaryLanguage }> {
    return apiClient.put(`${BASE}/languages/${enc(code)}`, input);
  },
  setDefaultLanguage(code: string): Promise<{ data: DictionaryLanguage }> {
    return apiClient.post(`${BASE}/languages/${enc(code)}/default`);
  },
  deleteLanguage(code: string): Promise<void> {
    return apiClient.delete(`${BASE}/languages/${enc(code)}`);
  },

  upsertLanguageCountry(
    languageCode: string,
    countryCode: string,
    input: UpsertLanguageCountryRequest = {},
  ): Promise<{ data: LanguageCountry }> {
    return apiClient.put(
      `${BASE}/languages/${enc(languageCode)}/countries/${enc(countryCode)}`,
      input,
    );
  },
  removeLanguageCountry(languageCode: string, countryCode: string): Promise<void> {
    return apiClient.delete(`${BASE}/languages/${enc(languageCode)}/countries/${enc(countryCode)}`);
  },

  listTranslations(
    entryType: DictionaryEntryType,
    entryCode: string,
  ): Promise<{ data: DictionaryTranslation[] }> {
    return apiClient.get(`${BASE}/translations/${enc(entryType)}/${enc(entryCode)}`);
  },
  upsertTranslation(
    entryType: DictionaryEntryType,
    entryCode: string,
    languageCode: string,
    input: UpsertTranslationRequest,
  ): Promise<{ data: DictionaryTranslation }> {
    return apiClient.put(
      `${BASE}/translations/${enc(entryType)}/${enc(entryCode)}/${enc(languageCode)}`,
      input,
    );
  },
  removeTranslation(
    entryType: DictionaryEntryType,
    entryCode: string,
    languageCode: string,
  ): Promise<void> {
    return apiClient.delete(
      `${BASE}/translations/${enc(entryType)}/${enc(entryCode)}/${enc(languageCode)}`,
    );
  },
  getOrphanAudit(): Promise<DictionaryAuditResponse> {
    return apiClient.get(`${BASE}/audit/orphans`);
  },
  invalidateCache(): Promise<{ data: { invalidated: boolean; invalidatedAt: string } }> {
    return apiClient.post(`${BASE}/cache/invalidate`, {});
  },
};
