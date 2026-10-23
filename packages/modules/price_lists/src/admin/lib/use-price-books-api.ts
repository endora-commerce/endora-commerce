import { useMemo } from 'react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { createPriceBooksApi, type PriceBooksApi } from './price-books-api.js';

/** The editor's API client over the admin kit's transport, one per mounted screen. */
export function usePriceBooksApi(): PriceBooksApi {
  return useMemo(() => createPriceBooksApi(apiClient), []);
}
