import { ApiError, apiBaseUrl } from '@endora-commerce/admin-kit/lib';
import type { ErrorEnvelope, OpportunityAttachment } from '@endora-commerce/contracts';

/**
 * Upload a file and attach it to an Opportunity in one request
 * (`contracts/admin-api.md` §7a). Gated by `crm:write` alone.
 *
 * The kit's `apiClient` speaks JSON only, so the multipart body goes through
 * `fetch` over the same origin and with the same session cookie. A refusal is
 * thrown as the client's own `ApiError`, so the sentence the backend resolved
 * — the media library's, when it is the library that refuses the file — is
 * shown as it arrived.
 */
export async function uploadOpportunityAttachment(
  opportunityId: string,
  file: File,
): Promise<OpportunityAttachment> {
  const body = new FormData();
  body.append('file', file, file.name);
  const response = await fetch(
    `${apiBaseUrl.replace(/\/+$/, '')}/api/v1/admin/crm/opportunities/${opportunityId}/attachments/upload`,
    { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }, body },
  );
  const payload = (await response.json().catch(() => null)) as
    | { data: OpportunityAttachment }
    | ErrorEnvelope
    | null;
  if (!response.ok || payload === null || !('data' in payload)) {
    throw new ApiError(
      response.status,
      payload !== null && 'error' in payload
        ? payload
        : { error: { code: 'INTERNAL', message: `HTTP ${response.status}` } },
    );
  }
  return payload.data;
}
