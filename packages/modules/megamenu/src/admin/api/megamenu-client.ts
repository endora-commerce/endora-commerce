import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  ActivateBindingRequest,
  ActivateBindingResponse,
  AddBindingRequest,
  CreateMegamenuRequest,
  MegamenuBinding,
  MegamenuDetail,
  MegamenuSummary,
  PatchMegamenuRequest,
  PutItemsRequest,
} from '@endora-commerce/contracts';

export type {
  ActivateBindingRequest,
  ActivateBindingResponse,
  AddBindingRequest,
  CreateMegamenuRequest,
  MegamenuBinding,
  MegamenuDetail,
  MegamenuSummary,
  PatchMegamenuRequest,
  PutItemsRequest,
};

export interface ListMenusResponse {
  data: MegamenuSummary[];
  nextCursor: string | null;
}

export const megamenuClient = {
  listMenus(): Promise<ListMenusResponse> {
    return apiClient.get<ListMenusResponse>('/api/v1/admin/megamenu/menus');
  },

  async createMenu(body: CreateMegamenuRequest): Promise<MegamenuDetail> {
    const out = await apiClient.post<{ data: MegamenuDetail }>('/api/v1/admin/megamenu/menus', body);
    return out.data;
  },

  async getMenu(id: string): Promise<MegamenuDetail> {
    const out = await apiClient.get<{ data: MegamenuDetail }>(
      `/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}`,
    );
    return out.data;
  },

  async patchMenu(id: string, body: PatchMegamenuRequest): Promise<MegamenuDetail> {
    const out = await apiClient.patch<{ data: MegamenuDetail }>(
      `/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}`,
      body,
    );
    return out.data;
  },

  async deleteMenu(id: string): Promise<void> {
    await apiClient.delete(`/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}`);
  },

  async putItems(
    id: string,
    body: PutItemsRequest,
  ): Promise<{ data: MegamenuDetail; meta?: { warnings: Array<{ code: string; message: string }> } }> {
    return apiClient.put<{
      data: MegamenuDetail;
      meta?: { warnings: Array<{ code: string; message: string }> };
    }>(`/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}/items`, body);
  },

  async listBindings(id: string): Promise<MegamenuBinding[]> {
    const out = await apiClient.get<{ data: MegamenuBinding[] }>(
      `/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}/bindings`,
    );
    return out.data;
  },

  async addBinding(id: string, body: AddBindingRequest): Promise<MegamenuBinding> {
    const out = await apiClient.post<{ data: MegamenuBinding }>(
      `/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}/bindings`,
      body,
    );
    return out.data;
  },

  async removeBinding(id: string, salesChannelId: string, language: string): Promise<void> {
    await apiClient.delete(
      `/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}/bindings/${encodeURIComponent(salesChannelId)}/${encodeURIComponent(language)}`,
    );
  },

  async activate(id: string, body: ActivateBindingRequest): Promise<ActivateBindingResponse> {
    const out = await apiClient.post<{ data: ActivateBindingResponse }>(
      `/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}/activate`,
      body,
    );
    return out.data;
  },

  async deactivate(id: string, body: ActivateBindingRequest): Promise<void> {
    await apiClient.post(`/api/v1/admin/megamenu/menus/${encodeURIComponent(id)}/deactivate`, body);
  },
};
