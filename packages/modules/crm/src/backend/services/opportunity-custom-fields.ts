import {
  ERROR_CODES,
  isCustomFieldValidationFailure,
  type CustomFieldValuePort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

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
 */
export async function mergeOpportunityCustomFields(
  customFields: CustomFieldValuePort,
  current: Record<string, unknown>,
  patch: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  if (patch === undefined) return current;
  try {
    return await customFields.validateAndMerge('opportunity', current, patch);
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
