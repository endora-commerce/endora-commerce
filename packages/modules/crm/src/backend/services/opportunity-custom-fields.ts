import {
  ERROR_CODES,
  isCustomFieldValidationFailure,
  type CustomFieldValuePort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { isDeepStrictEqual } from 'util';

/** The custom-field hosts this module owns: an Opportunity, and a note on one (issue #2005). */
export type CrmCustomFieldHost = 'opportunity' | 'opportunity_note';

/**
 * The custom-field half of an Opportunity write (User Story 15;
 * `specs/143-crm-sales-opportunities/contracts/admin-api.md` §12a).
 *
 * `custom_fields` validates and merges; it writes nothing and audits nothing.
 * The bag this returns is assigned to the Opportunity **inside the
 * Opportunity's own Command**, so the values are persisted and audited by the
 * one write that changed them (Constitution XIII and XIV).
 *
 * `patch` absent means "nothing was said about the fields": the bag is
 * returned as it is and no definition is consulted — so a required field
 * defined after an Opportunity was created does not refuse an unrelated edit,
 * nor an Opportunity created with no operator in front of it. A caller that
 * wants the definitions enforced passes a bag, `{}` included.
 *
 * A value that breaks its definition is 422 `CUSTOM_FIELD_VALUE_INVALID` with
 * one issue per field. The code is `custom_fields`' own; this module declares
 * none for it.
 *
 * `host` is the entity type whose definitions apply — an Opportunity's by
 * default, a note's (`opportunity_note`, issue #2005) for a note's write.
 */
export async function mergeOpportunityCustomFields(
  customFields: CustomFieldValuePort,
  current: Record<string, unknown>,
  patch: Record<string, unknown> | undefined,
  host: CrmCustomFieldHost = 'opportunity',
): Promise<Record<string, unknown>> {
  if (patch === undefined) return current;
  try {
    return await customFields.validateAndMerge(host, current, patch);
  } catch (error) {
    if (isCustomFieldValidationFailure(error)) {
      throw new HttpError(
        422,
        ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
        'One or more custom fields are invalid.',
        error.errors.map((issue) => ({ path: issue.field, issue: issue.message })),
      );
    }
    throw error;
  }
}

/** The keys whose value differs between two bags, sorted — what an audit entry names instead of the values. */
export function changedCustomFieldKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !isDeepStrictEqual(before[key] ?? null, after[key] ?? null))
    .sort();
}

/**
 * A message is no custom-field host (issue #2005): a message sent with a
 * non-empty bag is refused `422 VALIDATION_FAILED`, before anything is read.
 * An empty bag is no value and is accepted.
 */
export function refuseMessageCustomFields(values: Record<string, unknown> | undefined): void {
  if (values === undefined || Object.keys(values).length === 0) return;
  throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'A message takes no custom-field values; only a note does.', [
    { path: 'customFieldValues', issue: 'not_allowed' },
  ]);
}
