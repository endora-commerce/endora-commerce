import { inputSurfaceFieldsResponseSchema, type InputSurfaceField } from '@endora-commerce/contracts';
import { apiGet, type RequestContext } from './client';

/**
 * Feature 175 — the custom fields a buyer may fill in at registration
 * (`specs/175-buyer-input-custom-fields/contracts/input-surface-read.md`,
 * research R-10).
 *
 * `GET /api/v1/custom-fields/input-surfaces/organization.register` answers the
 * fields an administrator opened on the registration surface, per entity type
 * — `organization` for the company, `customer` for the account owner — with
 * labels in the request's language. Anonymous and channel-independent, so it is
 * cached in the Data Cache under {@link REGISTRATION_CUSTOM_FIELDS_TAG}, which
 * `custom_fields` revalidates when a definition changes, with a 300 s ceiling
 * for a lost revalidation.
 *
 * It **fails closed** (FR-033), as `getRegistrationOptions` does: a failed
 * read, a 404 from a platform without `custom_fields`, or an answer of another
 * shape is "no extra fields", and the form renders as it did before.
 */

export const REGISTRATION_SURFACE = 'organization.register';

/** The tag `custom_fields` revalidates — its `inputSurfaceCacheTag(surface)`, letter for letter. */
export const REGISTRATION_CUSTOM_FIELDS_TAG = `custom-fields:input-surface:${REGISTRATION_SURFACE}`;

/** The open fields of each registration group, in display order. */
export interface RegistrationCustomFields {
  /** The company's fields — sent as `organization.customFieldValues`. */
  organization: InputSurfaceField[];
  /** The account owner's fields — sent as `firstUser.customFieldValues`. */
  customer: InputSurfaceField[];
}

export const NO_REGISTRATION_CUSTOM_FIELDS: RegistrationCustomFields = { organization: [], customer: [] };

export async function getRegistrationCustomFields(ctx: RequestContext = {}): Promise<RegistrationCustomFields> {
  try {
    const response = await apiGet<unknown>(`/api/v1/custom-fields/input-surfaces/${REGISTRATION_SURFACE}`, ctx, {
      revalidate: 300,
      tags: [REGISTRATION_CUSTOM_FIELDS_TAG],
    });
    const parsed = inputSurfaceFieldsResponseSchema.safeParse(response);
    if (!parsed.success) return NO_REGISTRATION_CUSTOM_FIELDS;
    const { entities } = parsed.data.data;
    return { organization: entities.organization ?? [], customer: entities.customer ?? [] };
  } catch {
    return NO_REGISTRATION_CUSTOM_FIELDS;
  }
}
