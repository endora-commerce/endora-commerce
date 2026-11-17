import type { NewsletterCustomField } from '../entities/newsletter-custom-field.entity.js';

// The pure pieces of a subscriber write, shared by `NewsletterSubscriberService`
// and the subscribe Command it runs on the Command Bus (issue #1381): who owns
// the row, and which custom-field values it keeps.

/**
 * The owner identity a `newsletter_subscribers` row can be written from —
 * feature 087 Group B, D-187.
 *
 * The customer arm carries the organisation because
 * `newsletter_subscribers_organization_attribution_chk` requires it, and it is
 * a type of its own rather than a second optional field on
 * `SubscribeInput` because the caller's identity genuinely does not
 * include it: the only route that names an account
 * (`POST /api/v1/me/newsletter/subscribe`) reads it off the session, and the
 * organisation is a fact about that account which this service resolves through
 * `customer_accounts`' read port.
 *
 * Keeping the two apart is what makes "an owned subscriber with no
 * organisation" an unrepresentable argument to {@link ownerColumns} rather than
 * a line somebody has to remember. `SubscribeInput.customerAccountId` is
 * optional and nullable — the storefront route omits it entirely — so the shape
 * a forgotten stamp needs is exactly the shape the caller hands in; this type is
 * where it stops.
 */
export type ResolvedSubscriberOwner =
  | { kind: 'customer'; customerAccountId: string; organizationId: string }
  | { kind: 'anonymous' };

/**
 * The two attribution columns, written together from one resolved owner.
 *
 * **Both** of this module's write sites go through it — the `em.create` on a
 * first subscribe and the adoption of an already-ownerless row — which is what
 * one function has to cover here. It needs no de-association arm, unlike
 * `pwa`'s: nothing in `newsletter` ever clears `customer_account_id`, so the
 * ownerless arm below is only ever the *initial* state of a row and never a
 * transition into one.
 */
export function ownerColumns(owner: ResolvedSubscriberOwner): {
  customerAccountId: string | null;
  organizationId: string | null;
} {
  return owner.kind === 'customer'
    ? { customerAccountId: owner.customerAccountId, organizationId: owner.organizationId }
    : {
        customerAccountId: null,
        // FR-011 — a storefront sign-up belongs to no organisation, and the
        // constraint says nothing about it. On this table that is the ordinary
        // case: `POST /api/v1/newsletter/subscribe` passes no account. Who such
        // a row *should* belong to is R-6's open question and is not answered
        // here — in particular not by matching `email` against
        // `customer_accounts.email`, which is that question guessed.
        organizationId: null,
      };
}

export type CustomFieldValue = string | number | boolean | null;

/** The longest text a `text` custom field keeps (feature 169, research R-11). */
export const NEWSLETTER_CUSTOM_FIELD_TEXT_MAX = 500;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date written `YYYY-MM-DD` that exists (no 13th month, no 30 February). */
function isIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Whether `value` is one a field of `type` holds; `null` (clearing it) fits every type. */
function fitsCustomFieldType(type: NewsletterCustomField['type'], value: CustomFieldValue): boolean {
  if (value === null) return true;
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'date':
      return typeof value === 'string' && isIsoDate(value);
    case 'text':
      return typeof value === 'string' && value.length <= NEWSLETTER_CUSTOM_FIELD_TEXT_MAX;
    default:
      return false;
  }
}

/**
 * `specs/169-page-builder-contact-form/` FR-026, research R-11 — the custom
 * fields a subscriber ends up with: `current`, plus each `incoming` value whose
 * key is a defined field **and** whose value matches that field's type
 * (`boolean`, a finite `number`, a `YYYY-MM-DD` date that exists, a text of at
 * most 500 characters; `null` clears). Anything else is dropped rather than
 * refused, so none of the callers sharing this merge — the public subscribe,
 * the admin create and the self subscribe — gets a new 400. Before 169 only the
 * key was checked.
 */
export function mergeTypedCustomFields(
  defined: ReadonlyArray<Pick<NewsletterCustomField, 'key' | 'type'>>,
  current: Readonly<Record<string, CustomFieldValue>>,
  incoming: Readonly<Record<string, CustomFieldValue>>,
): Record<string, CustomFieldValue> {
  const types = new Map(defined.map((field) => [field.key, field.type]));
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const type = types.get(key);
    if (type && fitsCustomFieldType(type, value)) merged[key] = value;
  }
  return merged;
}
