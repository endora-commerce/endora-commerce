import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { FormDefinitionIssue } from '@endora-commerce/contracts';

/**
 * The sentence to show for a failed call. The backend already resolved `error.message` in the
 * reader's language (`errors.<CODE>` of this module's bundle), so it is shown as it arrived;
 * `fallback` is for a failure that never produced an envelope.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.envelope.error.message : fallback;
}

/** The publish refusals of a `FORM_DEFINITION_INVALID` answer, or `null` for any other failure. */
export function definitionIssuesOf(error: unknown): FormDefinitionIssue[] | null {
  if (!(error instanceof ApiError) || error.envelope.error.code !== 'FORM_DEFINITION_INVALID') return null;
  const issues = (error.envelope.error.details as { issues?: unknown } | undefined)?.issues;
  return Array.isArray(issues) ? (issues as FormDefinitionIssue[]) : [];
}
