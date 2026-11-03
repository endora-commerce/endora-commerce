import type {
  CreateImportProfileRequest,
  ImportProfile,
  UpdateImportProfileRequest,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { fetchScopeSalesChannel, listScopeSalesChannels } from '@endora-commerce/admin-kit/components';

/**
 * The admin's reads and writes of import profiles (feature 170,
 * `contracts/import-profiles-and-csv.md` §1 and §4) and of the channel × language targets a
 * mapping row may name. Every profile route is gated `catalog:write`; the channel reads are the
 * sales-channel administration's own `GET`s, which the kit already wraps.
 */

const PROFILES = '/api/v1/admin/import-export/profiles';

export function listProductProfiles(): Promise<ImportProfile[]> {
  return apiClient
    .get<{ data: ImportProfile[] }>(`${PROFILES}?entity=products`)
    .then((res) => res.data);
}

export function createProfile(body: CreateImportProfileRequest): Promise<ImportProfile> {
  return apiClient.post<{ data: ImportProfile }>(PROFILES, body).then((res) => res.data);
}

export function updateProfile(id: string, body: UpdateImportProfileRequest): Promise<ImportProfile> {
  return apiClient
    .patch<{ data: ImportProfile }>(`${PROFILES}/${encodeURIComponent(id)}`, body)
    .then((res) => res.data);
}

export async function deleteProfile(id: string): Promise<void> {
  await apiClient.delete(`${PROFILES}/${encodeURIComponent(id)}`);
}

/** One channel × language a mapping row may target. */
export interface ChannelLanguageTarget {
  channelId: string;
  channelCode: string;
  languageCode: string;
}

/** Every active channel × each language it offers — channels are few, so one detail read each. */
export async function listChannelLanguageTargets(): Promise<ChannelLanguageTarget[]> {
  const list = await listScopeSalesChannels();
  const details = await Promise.all(list.items.map((item) => fetchScopeSalesChannel(item.code)));
  return details.flatMap((channel) =>
    channel.languages.map((languageCode) => ({
      channelId: channel.id,
      channelCode: channel.code,
      languageCode,
    })),
  );
}

/** The error codes of this module that have an operator-facing translation. */
const TRANSLATED_ERROR_CODES = new Set([
  'IMPORT_PROFILE_NAME_TAKEN',
  'IMPORT_PROFILE_NOT_FOUND',
  'IMPORT_PROFILE_REQUIRED',
]);

/** The message to show for a failed request: the module's translation of its own codes, else the server's. */
export function errorMessage(
  err: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  if (err instanceof ApiError) {
    const code = err.envelope.error.code;
    return TRANSLATED_ERROR_CODES.has(code) ? t(`errors.${code}`) : err.envelope.error.message;
  }
  return t(fallbackKey);
}
