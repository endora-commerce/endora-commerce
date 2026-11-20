import { ApiError } from '@endora-commerce/admin-kit/lib';

/** The error code an API refusal carries, or `null` for anything else. */
export function apiErrorCode(err: unknown): string | null {
  return err instanceof ApiError ? err.envelope.error.code : null;
}

/** A list's load error: the server's message when it gave one, the kit's generic copy otherwise. */
export function loadErrorMessage(err: unknown): { message?: string } {
  return err instanceof ApiError ? { message: err.envelope.error.message } : {};
}
