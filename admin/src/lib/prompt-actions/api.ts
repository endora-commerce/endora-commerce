import { apiClient } from '../api-client.js';
import type {
  ClarifyRequest,
  PromptActionRequestDto,
  PromptActionsCapability,
} from '@b2b/contracts';

/**
 * Typed client for the prompt-actions endpoints (feature 043,
 * contracts/prompt-actions-api.md). Bare-fetch helpers in the
 * admin-actions style; `usePromptRequest` owns state and polling.
 */

const BASE = '/api/v1/admin/prompt-actions';

export async function getPromptCapability(): Promise<PromptActionsCapability> {
  const res = await apiClient.get<{ data: PromptActionsCapability }>(`${BASE}/capability`);
  return res.data;
}

export async function submitPrompt(prompt: string): Promise<PromptActionRequestDto> {
  const res = await apiClient.post<{ data: PromptActionRequestDto }>(`${BASE}/requests`, {
    prompt,
  });
  return res.data;
}

export async function clarifyPrompt(
  id: string,
  answer: ClarifyRequest,
): Promise<PromptActionRequestDto> {
  const res = await apiClient.post<{ data: PromptActionRequestDto }>(
    `${BASE}/requests/${encodeURIComponent(id)}/clarify`,
    answer,
  );
  return res.data;
}

export async function confirmPrompt(id: string): Promise<PromptActionRequestDto> {
  const res = await apiClient.post<{ data: PromptActionRequestDto }>(
    `${BASE}/requests/${encodeURIComponent(id)}/confirm`,
  );
  return res.data;
}

export async function cancelPrompt(id: string): Promise<PromptActionRequestDto> {
  const res = await apiClient.post<{ data: PromptActionRequestDto }>(
    `${BASE}/requests/${encodeURIComponent(id)}/cancel`,
  );
  return res.data;
}

export async function getPromptRequest(id: string): Promise<PromptActionRequestDto> {
  const res = await apiClient.get<{ data: PromptActionRequestDto }>(
    `${BASE}/requests/${encodeURIComponent(id)}`,
  );
  return res.data;
}

export async function listUnseenPromptRequests(
  limit = 3,
): Promise<PromptActionRequestDto[]> {
  const res = await apiClient.get<{ data: PromptActionRequestDto[] }>(
    `${BASE}/requests?unseen=true&limit=${limit}`,
  );
  return res.data;
}

export async function markPromptRequestSeen(id: string): Promise<void> {
  await apiClient.post<void>(`${BASE}/requests/${encodeURIComponent(id)}/seen`);
}
