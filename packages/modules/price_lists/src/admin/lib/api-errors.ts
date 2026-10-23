import { ApiError } from '@endora-commerce/admin-kit/lib';

/**
 * Reading an API refusal (feature 161). The envelope's `message` is the
 * sentence the server already translated for the request's language
 * (`specs/conventions/module-i18n.md`, case 1); `code` is what a screen
 * branches on; `details` — `{ path, issue }[]` — says which field it was.
 */

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.envelope.error.code : null;
}

export function errorStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

/** The server's sentence, or `fallback` for anything that is not an API refusal. */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.envelope.error.message : fallback;
}

/** The request paths a refusal names (`details[].path`), in its order. */
export function errorPaths(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const details = error.envelope.error.details;
  if (!Array.isArray(details)) return [];
  return details.map((detail) => detail.path);
}
