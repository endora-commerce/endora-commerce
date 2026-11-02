import {
  FORM_ADDRESS_PARTS,
  FORM_FIELD_ERROR_CODES,
  resolveTexts,
  type AvailablePublicFormDefinition,
  type CmsPageStorefrontLinkScope,
  type FormDefinition,
  type FormField,
  type FormFieldErrorCode,
  type FormRestrictions,
  type FormStatus,
  type PublicFormDefinition,
  type PublicFormField,
  type PublicFormSection,
} from '@endora-commerce/contracts';

/**
 * The public read of a form (`specs/170-forms-module/` contracts/public-api.md §1, research R-7,
 * R-11): one version and one language become a `PublicFormDefinition`, with every operator text
 * resolved — own language, then the form's default language; the built-ins for messages and the
 * button are the storefront's, so an absent text is left out rather than filled here.
 *
 * **Never present**: recipients, retention, counts, the share flags, the submitter-e-mail marker,
 * the CAPTCHA secret, notes and the working copy. A draft, a deleted form and one that never
 * existed answer one identical `unavailable` body, so the read tells nobody which it was.
 *
 * Pure: the caller resolves the language against the channel, decides whether CAPTCHA is
 * configured, and resolves a "show a CMS page" confirmation to its path with
 * {@link confirmationPagePath}; without that path the confirmation is the message (FR-038).
 */

/** What the read is built from: the form's live status and the version it serves. */
export interface PublicReadSource {
  readonly formId: string;
  readonly key: string;
  readonly status: FormStatus;
  /** The served version; `null` while the form was never published. */
  readonly version: { readonly number: number; readonly definition: FormDefinition; readonly defaultLanguage: string } | null;
  /** Non-spam entries of the form, for the maximum (restrictions.maxEntries). */
  readonly acceptedEntryCount: number;
}

export interface PublicReadOptions {
  /** Already constrained to the channel's languages by the caller. */
  readonly language: string;
  readonly now: Date;
  /** The provider and its public key, when CAPTCHA is configured (R-14); `null` otherwise. */
  readonly captcha: { readonly provider: 'turnstile' | 'hcaptcha'; readonly siteKey: string } | null;
  /** The CMS page's path in `language`, for a `page` confirmation; absent → the message. */
  readonly confirmationPagePath?: string | null;
  /**
   * The builder preview (admin-api.md §1): a draft is laid out as if it were published, so the
   * operator sees the form they are building rather than the shopper's "unavailable".
   */
  readonly preview?: boolean;
}

type Availability = AvailablePublicFormDefinition['availability'];

/**
 * Whether a served form takes entries now: `closed` by status or after the window, `not_yet_open`
 * before it, `full` at the maximum of non-spam entries, `open` otherwise.
 */
export function formAvailability(
  status: FormStatus,
  restrictions: FormRestrictions,
  acceptedEntryCount: number,
  now: Date,
): Availability {
  if (status === 'closed') return 'closed';
  const at = now.getTime();
  if (restrictions.availableFrom !== null && at < Date.parse(restrictions.availableFrom)) return 'not_yet_open';
  if (restrictions.availableUntil !== null && at >= Date.parse(restrictions.availableUntil)) return 'closed';
  if (restrictions.maxEntries !== null && acceptedEntryCount >= restrictions.maxEntries) return 'full';
  return 'open';
}

/** `{ key: value }` without the keys whose value is `undefined` (the public schemas are strict). */
function defined<T extends Record<string, unknown>>(object: T): T {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as T;
}

type Text = (textId: string) => string | undefined;

function publicField(field: FormField, text: Text): PublicFormField {
  const at = (suffix: string): string | undefined => text(`fields.${field.id}.${suffix}`);
  if (field.type === 'content') {
    return defined({ type: 'content', id: field.id, width: field.width, visibility: field.visibility, content: at('content') ?? '' });
  }
  if (field.type === 'section_break') {
    return defined({ type: 'section_break', id: field.id, width: field.width, visibility: field.visibility, title: at('title') ?? '' });
  }
  const errors: Partial<Record<FormFieldErrorCode, string>> = {};
  for (const code of FORM_FIELD_ERROR_CODES) {
    const override = at(`errors.${code}`);
    if (override !== undefined) errors[code] = override;
  }
  const base = defined({
    id: field.id,
    key: field.key,
    width: field.width,
    required: field.required,
    visibility: field.visibility,
    label: at('label') ?? '',
    placeholder: at('placeholder'),
    help: at('help'),
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
  // `shareWithIntegrations` is the operator's, never the shopper's (FR-064).
  const { shareWithIntegrations: _share, ...settings } = field;
  void _share;
  switch (settings.type) {
    case 'text':
    case 'phone':
    case 'textarea':
      return defined({ ...settings, ...base, defaultValue: at('defaultText') ?? settings.defaultValue });
    case 'email': {
      // Which answer is the submitter's address is the operator's to know (Reply-To, confirmation).
      const { submitterEmail: _submitter, ...email } = settings;
      void _submitter;
      return defined({ ...email, ...base, defaultValue: at('defaultText') ?? email.defaultValue });
    }
    case 'select':
    case 'radio':
    case 'checkboxes':
      return defined({
        ...settings,
        ...base,
        options: settings.options.map((option) => ({
          id: option.id,
          value: option.value,
          label: at(`options.${option.id}`) ?? option.value,
        })),
      });
    case 'address':
      return {
        ...settings,
        ...base,
        parts: Object.fromEntries(
          FORM_ADDRESS_PARTS.map((part) => [part, { ...settings.parts[part], label: at(`parts.${part}.label`) ?? '' }]),
        ) as Extract<PublicFormField, { type: 'address' }>['parts'],
      };
    case 'privacy_consent':
    case 'marketing_consent':
    case 'terms':
      return { ...settings, ...base, content: at('content') ?? '' };
    default:
      return defined({ ...settings, ...base }) as PublicFormField;
  }
}

function publicSection(section: FormDefinition['sections'][number], text: Text): PublicFormSection {
  return defined({
    id: section.id,
    columns: section.columns,
    visibility: section.visibility,
    title: text(`sections.${section.id}.title`),
    description: text(`sections.${section.id}.description`),
    fields: section.fields.map((field) => publicField(field, text)),
  });
}

export function publicFormDefinition(
  source: PublicReadSource | null,
  formId: string,
  options: PublicReadOptions,
): PublicFormDefinition {
  const served = source !== null && source.version !== null && (source.status !== 'draft' || options.preview === true);
  if (!served) return { formId, availability: 'unavailable' };
  const { definition, defaultLanguage, number } = source.version!;
  const text = resolveTexts(definition, options.language, defaultLanguage);
  const status = source.status === 'draft' ? 'published' : source.status;
  const confirmation = definition.behaviour.confirmation;
  return {
    formId,
    key: source.key,
    version: number,
    language: options.language,
    availability: formAvailability(status, definition.restrictions, source.acceptedEntryCount, options.now),
    signedInOnly: definition.restrictions.signedInOnly,
    captcha: definition.behaviour.captchaRequired && options.captcha ? { ...options.captcha } : null,
    texts: defined({
      title: text('form.title'),
      description: text('form.description'),
      submitLabel: text('form.submitLabel'),
      closed: text('messages.closed'),
      notYetOpen: text('messages.notYetOpen'),
      full: text('messages.full'),
      signIn: text('messages.signIn'),
      success: text('messages.success'),
    }),
    sections: definition.sections.map((section) => publicSection(section, text)),
    confirmation:
      confirmation.type === 'redirect'
        ? { type: 'redirect', url: confirmation.url }
        : confirmation.type === 'page' && options.confirmationPagePath
          ? { type: 'page', path: options.confirmationPagePath }
          : { type: 'message' },
  };
}

/**
 * The path of a "show a CMS page" confirmation in one channel and language (FR-038, US2-8,
 * research R-2), or `null` — and the confirmation is the message — for every other confirmation,
 * for a page the channel does not serve (the port leaves it out), and while `cms` is absent.
 *
 * `cms` is switchable and this module only degrades without it, so its presence is decided **in
 * front of** the port and nothing here catches a refusal (`specs/conventions/module-activation.md`):
 * while `cms` is off the port is not asked at all.
 */
export async function confirmationPagePath(
  confirmation: FormDefinition['behaviour']['confirmation'],
  scope: CmsPageStorefrontLinkScope,
  ports: {
    readonly cmsPresent: () => boolean;
    readonly cmsPages: { findStorefrontLinks(ids: readonly string[], scope: CmsPageStorefrontLinkScope): Promise<{ url: string }[]> };
  },
): Promise<string | null> {
  if (confirmation.type !== 'page') return null;
  if (!ports.cmsPresent()) return null;
  const [link] = await ports.cmsPages.findStorefrontLinks([confirmation.cmsPageId], scope);
  return link?.url ?? null;
}
