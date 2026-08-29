import type {
  CreateWarehouseRequest,
  UpdateWarehouseRequest,
  Warehouse,
} from '@endora-commerce/contracts';
import { apiClient } from '@/lib/api-client';

interface ListResponse {
  items: Warehouse[];
  page: number;
  pageSize: number;
  total: number;
}

interface SingleResponse {
  data: Warehouse;
}

interface ListParams {
  page?: number;
  pageSize?: number;
  activeOnly?: boolean;
  withTotals?: boolean;
}

export const warehousesClient = {
  async list(params: ListParams = {}): Promise<ListResponse> {
    const search = new URLSearchParams();
    if (params.page !== undefined) search.set('page', String(params.page));
    if (params.pageSize !== undefined) search.set('pageSize', String(params.pageSize));
    if (params.activeOnly) search.set('activeOnly', 'true');
    if (params.withTotals === false) search.set('withTotals', 'false');
    const qs = search.toString();
    return apiClient.get<ListResponse>(
      `/api/v1/admin/warehouses${qs ? `?${qs}` : ''}`,
    );
  },
  async get(id: string): Promise<Warehouse> {
    const res = await apiClient.get<SingleResponse>(`/api/v1/admin/warehouses/${id}`);
    return res.data;
  },
  async create(body: CreateWarehouseRequest): Promise<Warehouse> {
    const res = await apiClient.post<SingleResponse>('/api/v1/admin/warehouses', body);
    return res.data;
  },
  async update(id: string, body: UpdateWarehouseRequest): Promise<Warehouse> {
    const res = await apiClient.patch<SingleResponse>(`/api/v1/admin/warehouses/${id}`, body);
    return res.data;
  },
  async remove(id: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/admin/warehouses/${id}`);
  },
};
