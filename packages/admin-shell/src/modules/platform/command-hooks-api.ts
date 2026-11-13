import {
  commandOutboxFailureKey,
  type CommandHookPlanResponse,
  type CommandOutboxListResponse,
  type CommandOutboxRetryResponse,
  type CommandOutboxStatus,
} from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';

/**
 * The *Command hooks* screen's backend (`specs/176-command-hooks-outbox/`
 * FR-040). Three routes, three codes:
 *
 *  - the execution plan, behind `platform.modules.read`, as the interceptor
 *    plan is;
 *  - the outbox rows by status, behind `platform.command_outbox.read`;
 *  - the retry of a dead row, behind `platform.command_outbox.manage`.
 */

export const COMMAND_OUTBOX_READ = 'platform.command_outbox.read';
export const COMMAND_OUTBOX_MANAGE = 'platform.command_outbox.manage';

export async function getCommandHookPlan(): Promise<CommandHookPlanResponse> {
  return apiClient.get<CommandHookPlanResponse>('/api/v1/admin/command-hooks');
}

export async function listCommandOutbox(query: {
  status: CommandOutboxStatus;
  cursor?: string | null;
}): Promise<CommandOutboxListResponse> {
  const params = new URLSearchParams({ status: query.status });
  if (query.cursor) params.set('cursor', query.cursor);
  return apiClient.get<CommandOutboxListResponse>(`/api/v1/admin/command-outbox?${params.toString()}`);
}

export async function retryCommandOutboxEntry(id: string): Promise<CommandOutboxRetryResponse> {
  return apiClient.post<CommandOutboxRetryResponse>(
    `/api/v1/admin/command-outbox/${encodeURIComponent(id)}/retry`,
    {},
  );
}

/** The namespace the platform vocabulary (`_i18n`) is served under. */
const PLATFORM_SCOPE = 'core';

/**
 * The sentence for a stored failure code, or `null` when nobody translates it
 * (176 P4 architect ruling): the screen then shows the raw code, never an
 * invented sentence.
 *
 * Looked up in the row's **hook module** namespace first — the module whose
 * handler failed is the one that knows what its own code means — then in the
 * platform's, and in each under two keys: `errors.<code>`, where an
 * `HttpError` code already has its sentence, and
 * `commandOutbox.failure.<code>`, the family a code `errors.*` cannot hold
 * (the drain's `hook-unregistered`, a handler's `acme-erp-rejected`). The
 * requested language first, then English, as `t()` falls back.
 *
 * Read from the bundle rather than through `t()`, because a missing key is the
 * expected answer here and `t()` would report it as a defect.
 */
export function failureLabel(
  code: string,
  hookModule: string,
  bundle: Bundle,
  fallbackBundle: Bundle | undefined,
): string | null {
  const keys = [`errors.${code}`, commandOutboxFailureKey(code)];
  for (const source of [bundle, fallbackBundle]) {
    if (!source) continue;
    for (const scope of [hookModule, PLATFORM_SCOPE]) {
      for (const key of keys) {
        const value = source[scope]?.[key];
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
  }
  return null;
}
