# Data model: feature 169

No database table, column or migration is added by this feature. Everything below is a block prop
shape (stored inside page content JSON), a setting, a contract shape or an in-memory value.

Conventions: every new prop is optional; **unset renders today's markup byte for byte**. Types live
in `packages/cms-components/src/schema/component-types.ts` unless noted.

---

## 1. Existing blocks — props added (WP-A)

### 1.1 `cms.Accordion`

```ts
export type AccordionItemStyle = 'plain' | 'boxed' | 'filled'; // + 'filled'
```

| Prop | Shape | Unset | Notes |
| --- | --- | --- | --- |
| `itemStyle` | `'plain' \| 'boxed' \| 'filled'` | follows `variant` (today) | `filled`: root class `cmsc-pb-accordion--filled`; dividers fields hidden |

### 1.2 `cms.DownloadTile`

| Prop | Shape | Unset | Notes |
| --- | --- | --- | --- |
| `iconButtonSize` | `'s' \| 'm' \| 'l'` | today's 48 px | 48 / 72 / 112 px; class `cmsc-pb-download-tile--icon-<s\|m\|l>`; only with `linkLook: 'icon'` |
| `iconButtonStyle` | `'outline' \| 'filled'` | today's outline | `filled`: class `cmsc-pb-download-tile--icon-filled`; only with `linkLook: 'icon'` |

`'outline'` stored explicitly adds no class (same markup as unset). No px, no colour.

### 1.3 Carousel controls

No prop change. `CarouselShell` adds the root class `cmsc-pb-carousel--arrows-kept` while arrows
are kept disabled because every slide fits (`keptOff`); nothing else in the markup changes.

### 1.4 Listings

No prop change. `catalog.ProductSlider`, `catalog.ProductGrid`, `catalog.CategoryGrid`,
`catalog.CategoryList` render `null` on the storefront when they resolve no items
(`blog.LatestPosts` already does).

---

## 2. `cms.PageNavigation` (WP-B)

```ts
export interface PageNavigationItem {
  /** The link text. Translatable. */
  label?: string;
  /** A same-page element id, `SECTION_ANCHOR_RE`; stored without '#'. */
  anchor?: string;
}

export interface PageNavigationProps extends HideOnProps, BoxStyleProps {
  /** 1–20 items; an item with no label or an anchor failing the grammar is not rendered. */
  items?: PageNavigationItem[];
  /** The nav's accessible name. Translatable. Unset: the storefront catalogue's `cms.pageNavigation.label`. */
  label?: string;
  /** Unset: 'pill'. */
  look?: 'pill' | 'underline';
  /** Unset: false. */
  sticky?: boolean;
  /** Unset: 'start'. Responsive (`responsiveFields`). */
  align?: 'start' | 'center' | 'end' | ResponsiveProp<'start' | 'center' | 'end'>;
}
```

Markup contract:

```html
<nav class="cmsc-pb-page-nav cmsc-pb-page-nav--pill [cmsc-pb-page-nav--sticky] [cmsc-pb-page-nav--al-…]"
     aria-label="…">
  <ul class="cmsc-pb-page-nav__list">
    <li><a class="cmsc-pb-page-nav__link [cmsc-pb-page-nav__link--active]" href="#about"
           [aria-current="true"]>About</a></li>
  </ul>
</nav>
```

- Server HTML carries no active item (`aria-current` is set by the client island only).
- Sticky: `position: sticky; top: var(--cmsb-header-offset, 0px)`; the island writes the bar's
  height to `--cmsc-page-nav-h` on `document.documentElement` while mounted.
- Manifest declaration (`cms`): `name: 'cms.PageNavigation'`, `category: 'interactive'`,
  `translatable: [{ path: 'label' }, { path: 'items[].label' }]`, `labelKey:
  'blocks.pageNavigation.label'`, `responsiveFields: ['align', 'margin', 'padding', 'border']`.

---

## 3. `cms.ContactForm` (WP-C)

```ts
/** The fields the server knows. Order is the render order. */
export type ContactFormFieldKey = 'name' | 'email' | 'phone' | 'company' | 'subject' | 'choice' | 'message';

export interface ContactFormFieldConfig {
  /** Ignored for 'email' and 'message' (always shown). Unset: see defaults below. */
  show?: boolean;
  /** Translatable. Unset: the catalogue default `cms.contactForm.field.<key>`. */
  label?: string;
  /** Translatable. Unset: none. */
  placeholder?: string;
  /** Ignored for 'email' and 'message' (always required). Unset: false. */
  required?: boolean;
  /** With `columns: 2`. Unset: 'half' for name/email/phone/company/subject/choice, 'full' for message. */
  span?: 'half' | 'full';
}

export interface ContactFormChoiceConfig extends ContactFormFieldConfig {
  /** 1–30 options; the shopper's pick is sent as the option's label. Translatable. */
  options?: Array<{ label?: string }>;
}

export interface ContactFormConsentConfig {
  /** Inline rich text that may hold a link. Translatable (tiptap). Unset: catalogue default. */
  label?: InlineRichText | string;
}

export interface ContactFormMessages {
  /** Translatable. Unset: catalogue defaults `cms.contactForm.message.<key>`. */
  success?: string;
  error?: string;       // validation refused / generic failure
  unavailable?: string; // not configured, rate limited, server down
}

export interface ContactFormProps extends HideOnProps, BoxStyleProps {
  fields?: {
    name?: ContactFormFieldConfig;      // shown by default
    email?: ContactFormFieldConfig;     // always shown, required
    phone?: ContactFormFieldConfig;     // hidden by default
    company?: ContactFormFieldConfig;   // hidden by default
    subject?: ContactFormFieldConfig;   // hidden by default
    choice?: ContactFormChoiceConfig;   // hidden by default
    message?: ContactFormFieldConfig;   // always shown, required
  };
  privacyConsent?: ContactFormConsentConfig;                     // always shown, required
  marketingConsent?: ContactFormConsentConfig & { show?: boolean }; // hidden by default
  /** Unset: 1. */
  columns?: 1 | 2;
  /** Unset: 'boxed'. */
  fieldLook?: 'boxed' | 'underline' | 'pill';
  /** Unset: 'above'. 'hidden' keeps the label for assistive technology (visually hidden). */
  labelPosition?: 'above' | 'hidden';
  /** The submit button's look: `ButtonSpec` without `link` (label, style, fill, size, icon, iconPosition). */
  button?: Omit<ButtonSpec, 'link'>;
  /** Unset: 'start'. 'stretch' is a full-width button. */
  buttonAlign?: 'start' | 'center' | 'end' | 'stretch';
  messages?: ContactFormMessages;
  /** The form's accessible name. Translatable. Unset: catalogue `cms.contactForm.label`. */
  formLabel?: string;
}
```

Form markup contract (posted names are the backend contract's, §5):

```html
<form class="cmsc-pb-contact-form cmsc-pb-contact-form--cols-2 cmsc-pb-contact-form--look-boxed"
      method="post" action="/{lang?}/forms/contact" aria-label="…" novalidate?>
  <input type="hidden" name="returnTo" value="/current/path?query">
  <input type="hidden" name="anchor" value="section-anchor">   <!-- when inside an anchored section -->
  <input type="hidden" name="form" value="<block id>">
  <input type="hidden" name="choiceLabel" value="Region">       <!-- when choice shown -->
  <div class="cmsc-pb-contact-form__hp" aria-hidden="true">       <!-- honeypot, off-screen -->
    <label>Website<input name="website" tabindex="-1" autocomplete="off"></label>
  </div>
  … name, email, phone, company, subject, choice (select), message (textarea) …
  <label><input type="checkbox" name="privacyConsent" value="on" required> rich label</label>
  <label><input type="checkbox" name="marketingConsent" value="on"> rich label</label>
  <button type="submit" class="cmsc-btn …">Send</button>
  <p role="status" aria-live="polite" class="cmsc-pb-contact-form__outcome">…</p>
</form>
```

Manifest declaration (`cms`): `name: 'cms.ContactForm'`, `category: 'forms'`, translatable paths
`fields.*.label`, `fields.*.placeholder`, `fields.choice.options[].label`, `privacyConsent.label`
(tiptap), `marketingConsent.label` (tiptap), `button.label`, `messages.success`, `messages.error`,
`messages.unavailable`, `formLabel`; `responsiveFields: ['margin', 'padding', 'border']`.

### 3.1 Setting

```ts
// packages/modules/cms/src/manifest.ts — CMS_SETTING_CODES
CONTACT_FORM_RECIPIENTS: 'cms.contact_form_recipients',

{
  code: 'cms.contact_form_recipients',
  name: 'Contact form recipients',
  description: 'The e-mail addresses that receive the messages sent with the Contact form block on
    this sales channel — at most 10. Leave empty and the form answers that it is unavailable. Can be
    overridden per sales channel. Never shown on the storefront.',
  groupCode: 'cms_contact_form',   // new group { code: 'cms_contact_form', name: 'Contact form' }
  valueType: 'string_list',
  defaultValue: [],
}
```

Write validator (contributed to `settingWriteValidatorRegistry` from `cms`' existing contribution
hook): `codes: ['cms.contact_form_recipients']`; refuses (400 `VALIDATION_FAILED`, field
`value`) a proposed value that is not an array of 0–10 strings each passing the contract's e-mail
rule. Read: `settingsReadPort.get('cms.contact_form_recipients', channelId, z.array(z.string()))`
per request.

### 3.2 Error code

`CMS_CONTACT_FORM_UNAVAILABLE` — HTTP 409, "The contact form cannot send messages on this sales
channel: no recipients are configured." Four places (tasks standing rule 7).

### 3.3 The e-mail (in memory only)

| Field | Value |
| --- | --- |
| `messageId` | `cms-contact-<uuid v4>-<recipient index>` |
| `to` | one configured recipient |
| `replyTo` | the submitter's e-mail (new optional field, §5.3) |
| `subject` | `contactForm.mail.subject` in the channel's default language, param `{channel}` = channel name in that language |
| `text` / `html` | heading, then one line per **submitted** field with its translated label (`contactForm.mail.field.<key>`; the choice uses the submitted `choiceLabel`), the message, the consents (`contactForm.mail.consent.privacy` / `.marketing.yes` / `.marketing.no`), the page path; HTML-escaped |
| `kind` | `'cms.contact_form'` |
| `salesChannelId` | the request's resolved channel id |
| `meta` | **absent** — nothing the shopper typed reaches the delivery record |

---

## 4. `newsletter.Signup` — props added (WP-D)

```ts
export interface NewsletterSignupAttribute {
  /** A newsletter custom field key (`^[a-z][a-z0-9_]*$`, ≤ 64), picked in the editor. */
  key?: string;
  /** Snapshot of the field's type at pick time (types are immutable in the newsletter module). */
  type?: 'text' | 'number' | 'boolean' | 'date';
  /** Translatable. Unset: the key's label as picked (stored in `fieldLabel`). */
  label?: string;
  /** Snapshot of the field's own label, the fallback for `label`. */
  fieldLabel?: string;
  /** Translatable; ignored for boolean. */
  placeholder?: string;
  /** Boolean: must be ticked. Unset: false. */
  required?: boolean;
}

export interface NewsletterSignupMessages {
  // … existing keys …
  /** A required attribute left empty. Translatable. Unset: catalogue `newsletter.signup.fields`. */
  fields?: string;
}

export interface NewsletterSignupFormProps {
  // … existing props …
  /** 0–10 subscriber attributes, rendered after the e-mail field and before the topics. */
  attributes?: NewsletterSignupAttribute[];
}
```

`NewsletterSignupTopic.tagCode` keeps its shape (free-text code); only its editor field changes.

Posted names (added): `attr.<key>` (value; a ticked checkbox posts `on`) and one hidden
`attrSpec` per attribute, `"<key>|<type>|<0|1 required>"`. Manifest (`newsletter`) translatable
paths added: `attributes[].label`, `attributes[].placeholder`, `messages.fields`.

Storefront coercion (`storefront/app/newsletter/subscribe/route.ts`): `boolean` → `true` when `on`,
else `false`; `number` → `Number(value)` when finite, else dropped; `date` → kept when
`/^\d{4}-\d{2}-\d{2}$/`; `text` → trimmed, ≤ 500. A required attribute missing → `{ error: 'fields' }`.
At most 10 specs are read.

Newsletter backend (`subscriber.service.ts` `mergeCustomFields`): keeps a value only when its key
is defined **and** it matches the field's type (same rules; `null` clears); otherwise drops it.

---

## 5. Contracts

### 5.1 `packages/contracts/src/cms-contact-form.ts` (new, exported from the index)

See [contracts/contact-form-api.md](./contracts/contact-form-api.md) for the full Zod text.

```ts
export const CONTACT_FORM_LIMITS = { name: 200, phone: 50, company: 200, subject: 200,
  choiceLabel: 120, choice: 200, message: 5000, pagePath: 2048, honeypot: 500 } as const;
export const contactFormSubmissionSchema: z.ZodObject<…>;
export type ContactFormSubmission = z.infer<typeof contactFormSubmissionSchema>;
export const contactFormSubmissionResponseSchema = z.object({ status: z.literal('sent') });
```

### 5.2 Render context (`packages/cms-components/src/components/render-context.tsx`)

```ts
/** WP-B */ export interface CmsPageNavigationText { label?: string }
/** WP-C */ export interface CmsContactFormText {
  label?: string;
  field?: Partial<Record<'name' | 'email' | 'phone' | 'company' | 'subject' | 'choice' | 'message', string>>;
  choicePlaceholder?: string;
  /** Plain text used when the editor wrote no consent label (no link); the canvas warns the editor to add one with a link. */
  privacyConsent?: string;
  marketingConsent?: string;
  submit?: string;
  success?: string;
  error?: string;
  unavailable?: string;
  required?: string;         // the "required" marker's accessible text
}
/** WP-D */ export interface CmsNewsletterSignupText { fields?: string }

// CmsRenderContextValue / CmsRenderProvider gain, each optional:
pageNavigationText?: CmsPageNavigationText;   // WP-B
contactFormText?: CmsContactFormText;         // WP-C
newsletterSignupText?: CmsNewsletterSignupText; // WP-D
```

Absent (the editor), each block falls back to English.

### 5.3 `EmailMailerSendInput` (`packages/contracts/src/email.ts`)

```ts
/** Feature 169 — the Reply-To address; absent: none. Not recorded in the delivery record. */
replyTo?: string;
```

### 5.4 Storefront message catalogue keys (`storefront/lib/i18n/messages.ts`)

- WP-B: `cms.pageNavigation.label`.
- WP-C: `cms.contactForm.label`, `cms.contactForm.field.{name,email,phone,company,subject,choice,message}`,
  `cms.contactForm.choicePlaceholder`, `cms.contactForm.privacyConsent`, `cms.contactForm.marketingConsent`,
  `cms.contactForm.submit`, `cms.contactForm.message.{success,error,unavailable}`, `cms.contactForm.required`.
- WP-D: `newsletter.signup.fields`.

### 5.5 Module bundle keys

- `cms` (`packages/modules/cms/i18n/{en,pl}.json`):
  - WP-A: `blocks.accordion.fields.itemStyle.options.filled`;
    `blocks.downloadTile.fields.iconButtonSize.{label,options.s,options.m,options.l}`;
    `blocks.downloadTile.fields.iconButtonStyle.{label,options.outline,options.filled}`.
  - WP-B: `blocks.pageNavigation.{label,description}`, `blocks.pageNavigation.fields.*`.
  - WP-C: `blocks.contactForm.{label,description}`, `blocks.contactForm.fields.*`,
    `contactForm.mail.*`, `errors.CMS_CONTACT_FORM_UNAVAILABLE`,
    `actions.openContactFormSettings.{label,description}`.
- `newsletter` (`packages/modules/newsletter/i18n/{en,pl}.json`), WP-D:
  `blocks.signup.fields.attributes.*`, `blocks.signup.fields.messages.fields.fields.label` (the
  existing nesting of `messages`), the picker labels if the pickers live under the module's stem.
- `core` admin bundle (`packages/modules/_i18n/i18n/{en,pl}.json`, `pageBuilder.*`), for the shared
  pickers in `page-builder-admin`: WP-B `pageBuilder.anchorField.*` if new text is needed (it reuses
  `pageBuilder.linkField.anchors|selectAnchor|noAnchors|anchorHint`); WP-D
  `pageBuilder.newsletterTag.*`, `pageBuilder.newsletterField.*`.
